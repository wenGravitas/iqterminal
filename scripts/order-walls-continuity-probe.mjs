/**
 * Focused live Order Walls continuity probe. One staging chart/browser only;
 * waits for visible live data, then records current segment IDs, visible counts,
 * source snapshot/patch membership changes, scheduled draws, and RAF samples.
 * This is diagnostic instrumentation, not a matrix or performance acceptance.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { addIndicator } from './indicator-actions.mjs';

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baseUrl = arg('url', 'http://127.0.0.1:5173/');
const output = arg('output', 'artifacts/order-walls/staging-continuity-probe.json');
const hardBoundMs = 175_000;
const visibleTimeoutMs = 60_000;
const monitorMs = 70_000;
const startedAt = new Date().toISOString();
const runStart = performance.now();
const deadline = runStart + hardBoundMs;
const errors = [];
const requests = [];
let activeBrowser;
let browser;
let context;
let page;
let pageRuntime;
let boundExpired = false;
const boundTimer = setTimeout(() => { boundExpired = true; if (activeBrowser) void activeBrowser.close(); }, hardBoundMs - 2_000);
const result = {
  schemaVersion: 1,
  task: 'single focused live staging continuity probe; not a four-case matrix',
  baseUrl,
  startedAt,
  hardBoundMs,
  monitorMs,
  browser: null,
  sourceHashesAtStart: await sourceFingerprint(),
  hostBefore: hostSnapshot(),
  healthBefore: await readHealth(),
  status: 'running',
  limits: {
    observation: 'RAF samples and actual renderer draw samples are recorded while this page is active. The page-side probe adds lightweight JavaScript work.',
    identity: 'Segment IDs and visible segment IDs are sampled once per second and whenever the set changes; drawable keys are fingerprinted, not retained per frame.',
    scope: 'One Binance BTCUSDT USD-M perpetual chart, native Order Walls only, actual staging gateway and live feed; no fixtures and no history deletion.',
  },
};

try {
  if (boundExpired) throw new Error('Probe hard bound expired during preflight');
  await mkdir('artifacts/order-walls', { recursive: true });
  activeBrowser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--enable-webgl'], ignoreDefaultArgs: ['--enable-unsafe-swiftshader'] });
  browser = activeBrowser;
  result.browser = { version: browser.version(), executable: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1,
    ignoredDefaultArguments: ['--enable-unsafe-swiftshader'] };
  context = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('basis.theme.v1', 'dark'); } catch { /* origin not available yet */ }
  });
  page = await context.newPage();
  pageRuntime = watchRuntime(page);
  page.on('pageerror', error => errors.push({ at: new Date().toISOString(), message: error.message }));
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if (url.pathname.includes('/market-data/v1/depth-observations')) requests.push({
        at: new Date().toISOString(), method: request.method(), query: Object.fromEntries(url.searchParams), status: null,
      });
    } catch { /* ignore non-HTTP requests */ }
  });
  page.on('response', response => {
    try {
      const url = new URL(response.url());
      if (!url.pathname.includes('/market-data/v1/depth-observations')) return;
      const request = requests.findLast(item => item.status === null && item.query.from === url.searchParams.get('from')
        && item.query.to === url.searchParams.get('to') && item.query.after === url.searchParams.get('after'));
      if (request) request.status = response.status();
    } catch { /* ignore non-HTTP responses */ }
  });

  const remaining = () => Math.max(1_000, deadline - performance.now());
  const url = new URL(baseUrl);
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(30_000, remaining()) });
  await page.waitForFunction(() => window.__terminal?.stats?.().panels?.length > 0, undefined,
    { timeout: Math.min(20_000, remaining()) });

  const panelId = await page.evaluate(() => {
    const terminal = window.__terminal;
    const selected = [...terminal.panels].find(([, panel]) => {
      const series = panel.diagnostics().series;
      return series.venue === 'binance' && series.market === 'perpetual';
    }) ?? [...terminal.panels][0];
    if (!selected) throw new Error('No chart panel is available');
    for (const [id] of terminal.panels) if (id !== selected[0]) terminal.dock.getPanel(id)?.api.close();
    return selected[0];
  });
  let panel = page.locator(`.candle-panel[data-panel-id="${panelId}"]`);
  const series = await page.evaluate(id => window.__terminal.panels.get(id).diagnostics().series, panelId);
  if (series.venue !== 'binance' || series.market !== 'perpetual') await chooseChartMarket(panel, 'Binance · BTCUSDT USD-M Perp');
  if (await panel.getByLabel('Timeframe', { exact: true }).inputValue() !== '1m') {
    await panel.getByLabel('Timeframe', { exact: true }).selectOption('1m');
  }
  await page.waitForFunction(id => {
    const d = window.__terminal.panels.get(id)?.diagnostics();
    return d?.series?.venue === 'binance' && d?.series?.market === 'perpetual' && d?.bars >= 60 && d?.status?.state === 'live';
  }, panelId, { timeout: Math.min(45_000, remaining()) });
  const viewportBefore = await setInitialViewport(panelId);
  console.log(JSON.stringify({ stage: 'live-candles-ready', panelId, viewport: viewportBefore }));

  await page.evaluate(installEngineProbe, panelId);
  await addIndicator(panel, 'Order Walls');
  await setWallAggregation(panel, 50);
  await page.waitForFunction(id => {
    const d = window.__terminal.panels.get(id)?.diagnostics();
    return d?.orderWalls?.mounted && d.orderWalls.retainedSegments > 0 && d.orderWalls.retainedDrawables > 0;
  }, panelId, { timeout: Math.min(visibleTimeoutMs, remaining()) });

  result.baseline = await page.evaluate(id => {
    const p = window.__terminal.panels.get(id), e = p.engine, primitive = e.orderWalls;
    if (!primitive || !e.orderWallSegments || !(primitive.segments instanceof Map) || !(primitive.drawable instanceof Map)) {
      throw new Error('Runtime renderer maps are not inspectable; no probe instrumentation was installed');
    }
    const d = p.diagnostics();
    window.__wallContinuityProbe.activate(id);
    return { at: new Date().toISOString(), candle: d.last?.t ?? null, candleState: d.status?.state,
      wallState: d.orderWalls.status?.state ?? null, coverage: d.orderWalls.status?.coverage ?? null,
      provisional: d.orderWalls.status?.provisional ?? null, aggregation: d.orderWalls.settings?.aggregation,
      retainedSegments: d.orderWalls.retainedSegments, visibleDrawables: d.orderWalls.retainedDrawables,
      segmentIds: [...primitive.segments.keys()].sort(), visibleSegmentIds: [...new Set([...primitive.drawable.values()].map(line => line.segment.id))].sort(),
      viewport: { time: e.visibleTimeRange(), logical: e.visibleRange(), price: e.chart.panes()[0].priceScale.priceRange() } };
  }, panelId);
  result.viewportBefore = viewportBefore;
  result.sourceRuntimeAtBaseline = pageRuntime.snapshot();
  result.startedObservationAt = new Date().toISOString();
  console.log(JSON.stringify({ stage: 'wall-visible-baseline', at: result.startedObservationAt,
    retainedSegments: result.baseline.retainedSegments, visibleDrawables: result.baseline.visibleDrawables,
    wallState: result.baseline.wallState, coverage: result.baseline.coverage }));

  result.screenshots = { beforePan: 'artifacts/order-walls/staging-continuity-before.png', after: 'artifacts/order-walls/staging-continuity-after.png' };
  await page.screenshot({ path: result.screenshots.beforePan, fullPage: true });

  result.pan = await panAndRestore(page, panelId);
  const baselineCandle = result.baseline.candle;
  const observationStart = performance.now();
  const rolloverDeadline = Math.min(observationStart + 66_000, deadline - 5_000);
  while (performance.now() - observationStart < monitorMs && performance.now() < deadline - 5_000) {
    await page.waitForTimeout(500);
    const rollover = await page.evaluate(({ id, initial }) => {
      const d = window.__terminal.panels.get(id)?.diagnostics();
      return { observed: Number.isFinite(initial) && Number.isFinite(d?.last?.t) && d.last.t > initial,
        latestCandle: d?.last?.t ?? null, candleState: d?.status?.state ?? null };
    }, { id: panelId, initial: baselineCandle });
    if (!result.rollover?.observed && rollover.observed) {
      result.rollover = { observed: true, afterMs: Math.round(performance.now() - observationStart), ...rollover };
    }
    if (!result.rollover && performance.now() >= rolloverDeadline) result.rollover = { observed: false,
      waitedMs: Math.round(performance.now() - observationStart), latestCandle: rollover.latestCandle, candleState: rollover.candleState };
  }
  result.observationMs = Math.round(performance.now() - observationStart);
  result.final = await page.evaluate(id => {
    const p = window.__terminal.panels.get(id), e = p.engine, d = p.diagnostics(), primitive = e.orderWalls;
    return { at: new Date().toISOString(), candle: d.last?.t ?? null, candleState: d.status?.state ?? null,
      wall: d.orderWalls, heatmap: d.heatmap?.status ?? null,
      retainedSegmentCount: primitive?.segments?.size ?? 0, visibleDrawableCount: primitive?.drawable?.size ?? 0,
      retainedSegmentIds: primitive ? [...primitive.segments.keys()].sort() : [],
      visibleSegmentIds: primitive ? [...new Set([...primitive.drawable.values()].map(line => line.segment.id))].sort() : [],
      viewport: { time: e.visibleTimeRange(), logical: e.visibleRange(), price: e.chart.panes()[0].priceScale.priceRange() } };
  }, panelId);
  await page.screenshot({ path: result.screenshots.after, fullPage: true });
  result.probe = await page.evaluate(() => window.__wallContinuityProbe.finish());
  result.status = result.observationMs < 60_000 ? 'insufficient-observation-window'
    : result.rollover?.observed ? 'complete' : 'rollover-not-observed';
  console.log(JSON.stringify({ stage: 'probe-finished', status: result.status, observationMs: result.observationMs,
    rollover: result.rollover, summary: result.probe.summary }));
} catch (error) {
  result.status = boundExpired ? 'bound-expired' : 'incomplete';
  result.error = error instanceof Error ? error.message : String(error);
  if (page && !page.isClosed()) {
    try {
      result.latestPanel = await page.evaluate(() => {
        const p = [...window.__terminal.panels.values()][0], d = p?.diagnostics(), e = p?.engine, primitive = e?.orderWalls;
        return { candle: d?.last?.t ?? null, candleState: d?.status?.state ?? null, wall: d?.orderWalls ?? null,
          retainedSegmentIds: primitive ? [...primitive.segments.keys()].sort() : [],
          visibleSegmentIds: primitive ? [...new Set([...primitive.drawable.values()].map(line => line.segment.id))].sort() : [] };
      });
    } catch { /* retain current partial artifact */ }
  }
} finally {
  clearTimeout(boundTimer);
  result.endedAt = new Date().toISOString();
  result.durationMs = Math.round(performance.now() - runStart);
  result.sourceHashesAtEnd = await sourceFingerprint();
  result.sourceStable = JSON.stringify(result.sourceHashesAtStart) === JSON.stringify(result.sourceHashesAtEnd);
  result.runtime = pageRuntime ? { events: pageRuntime.events, stable: pageRuntime.events.mainNavigations.length <= 1
      && pageRuntime.events.workers.length === (result.sourceRuntimeAtBaseline?.workers ?? pageRuntime.events.workers.length)
      && pageRuntime.events.viteUpdates.length === 0 } : null;
  result.errors = errors;
  result.depthRequests = requests;
  result.hostAfter = hostSnapshot();
  result.healthAfter = await readHealth();
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}

function watchRuntime(target) {
  const events = { mainNavigations: [], workers: [], viteUpdates: [] };
  target.on('framenavigated', frame => { if (frame === target.mainFrame()) events.mainNavigations.push({ at: new Date().toISOString(), url: frame.url() }); });
  target.on('worker', worker => events.workers.push({ at: new Date().toISOString(), url: worker.url() }));
  target.on('websocket', socket => {
    let sameOrigin = false;
    try { sameOrigin = new URL(socket.url()).host === new URL(baseUrl).host; } catch { /* ignore */ }
    if (!sameOrigin) return;
    socket.on('framereceived', message => {
      const text = typeof message.payload === 'string' ? message.payload : message.payload?.toString('utf8') ?? '';
      if (/("type"\s*:\s*"(?:update|full-reload|prune|error)")/.test(text)) events.viteUpdates.push({ at: new Date().toISOString(), text: text.slice(0, 200) });
    });
  });
  return { events, snapshot: () => ({ mainNavigations: events.mainNavigations.length, workers: events.workers.length, viteUpdates: events.viteUpdates.length }) };
}

function installEngineProbe(id) {
  const p = window.__terminal.panels.get(id), engine = p?.engine;
  if (!engine) throw new Error('Selected chart engine is not mounted');
  const probe = window.__wallContinuityProbe = { active: false, panelId: id, raf: [], draws: [], changes: [], idSnapshots: [], zeroEvents: [], previousSegmentIds: null, previousVisibleIds: null, lastSnapshotAt: -Infinity, startedAt: 0, rafCount: 0 };
  const currentIds = () => [...(engine.orderWallSegments?.keys?.() ?? [])].sort();
  const currentVisibleIds = () => [...new Set([...(engine.orderWalls?.drawable?.values?.() ?? [])].map(line => line.segment.id))].sort();
  const status = () => p.orderWallsStatus ?? {};
  const hash = values => {
    let h = 2166136261;
    for (const value of values) for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const delta = (before, after) => {
    const old = new Set(before ?? []), next = new Set(after);
    return { added: [...next].filter(value => !old.has(value)), removed: [...old].filter(value => !next.has(value)) };
  };
  const trackChange = (operation, before, inputIds, statusValue, expectedRemoved = []) => {
    if (!probe.active) return;
    const after = currentIds(), difference = delta(before, after), visible = currentVisibleIds();
    const item = { atMs: Math.round(performance.now() - probe.startedAt), operation, state: statusValue?.state ?? status().state ?? null,
      coverageComplete: statusValue?.coverage?.complete ?? status().coverage?.complete ?? null,
      provisional: statusValue?.provisional ?? status().provisional ?? null,
      beforeSegments: before.length, afterSegments: after.length, incomingSegments: inputIds.length,
      addedIds: difference.added, removedIds: difference.removed, expectedRemovedIds: expectedRemoved,
      unexpectedRemovedIds: difference.removed.filter(value => !expectedRemoved.includes(value)), visibleDrawables: engine.orderWalls?.drawable?.size ?? 0,
      visibleSegmentIds: visible };
    probe.changes.push(item);
    if (before.length > 0 && after.length === 0) probe.zeroEvents.push({ ...item, kind: 'source-update-cleared-all-segments' });
  };
  for (const name of ['setOrderWallSnapshot', 'patchOrderWalls']) {
    const original = engine[name];
    if (typeof original !== 'function') continue;
    engine[name] = function (...args) {
      const before = currentIds();
      const inputIds = name === 'setOrderWallSnapshot' ? (args[0] ?? []).map(value => value.id)
        : (args[0] ?? []).filter(value => value.segment).map(value => value.id);
      const expectedRemoved = name === 'patchOrderWalls' ? (args[0] ?? []).filter(value => !value.segment).map(value => value.id) : [];
      const response = original.apply(this, args);
      trackChange(name === 'setOrderWallSnapshot' ? 'source-snapshot' : 'source-patch', before, inputIds, args[1], expectedRemoved);
      return response;
    };
  }
  probe.activate = panelId => {
    if (panelId !== id) return;
    probe.active = true;
    probe.startedAt = performance.now();
    probe.previousSegmentIds = currentIds();
    probe.previousVisibleIds = currentVisibleIds();
    probe.idSnapshots.push({ atMs: 0, segmentIds: probe.previousSegmentIds, visibleSegmentIds: probe.previousVisibleIds });
    const primitive = engine.orderWalls;
    if (!primitive) throw new Error('Order Walls primitive disappeared before probe activation');
    const originalDraw = primitive.draw;
    primitive.draw = function (...args) {
      const response = originalDraw.apply(this, args);
      if (!probe.active) return response;
      const atMs = Math.round(performance.now() - probe.startedAt);
      const row = { atMs, draws: this.stats.draws, retainedSegments: this.segments.size, visibleDrawables: this.drawable.size,
        rebuilds: this.stats.rebuilds, patchProjects: this.stats.patchProjects };
      probe.draws.push(row);
      if ((row.retainedSegments === 0 || row.visibleDrawables === 0) && status().state === 'live') probe.zeroEvents.push({ ...row, kind: 'scheduled-draw-zero-during-live-status', state: status().state });
      if (atMs - probe.lastSnapshotAt >= 1000 || row.retainedSegments === 0 || row.visibleDrawables === 0) {
        const segmentIds = currentIds(), visibleIds = currentVisibleIds();
        const segmentDelta = delta(probe.previousSegmentIds, segmentIds), visibleDelta = delta(probe.previousVisibleIds, visibleIds);
        probe.idSnapshots.push({ atMs, segmentIds, visibleSegmentIds: visibleIds,
          addedRetainedIds: segmentDelta.added, removedRetainedIds: segmentDelta.removed,
          addedVisibleIds: visibleDelta.added, removedVisibleIds: visibleDelta.removed });
        probe.lastSnapshotAt = atMs;
        probe.previousSegmentIds = segmentIds;
        probe.previousVisibleIds = visibleIds;
      }
      return response;
    };
    const raf = () => {
      if (!probe.active) return;
      const primitiveNow = engine.orderWalls, now = performance.now(), age = now - probe.startedAt;
      const st = status(), last = engine.latestCandle?.();
      const retainedCount = primitiveNow?.segments?.size ?? 0, drawableCount = primitiveNow?.drawable?.size ?? 0;
      const row = { atMs: Math.round(age), frame: ++probe.rafCount, candle: Number.isFinite(last?.time) ? last.time * 1000 : null,
        candleState: p.status?.state ?? null,
        wallState: st.state ?? null, coverageComplete: st.coverage?.complete ?? null, coveragePartial: st.coverage?.partial ?? null,
        provisional: st.provisional ?? null, lastConfirmedAt: st.lastConfirmedAt ?? null,
        retainedSegments: retainedCount, visibleDrawables: drawableCount,
        scheduledDraws: primitiveNow?.stats?.draws ?? 0, rebuilds: primitiveNow?.stats?.rebuilds ?? 0,
        patchProjects: primitiveNow?.stats?.patchProjects ?? 0 };
      probe.raf.push(row);
      if ((row.retainedSegments === 0 || row.visibleDrawables === 0) && row.candleState === 'live') probe.zeroEvents.push({ ...row, kind: 'raf-zero-during-live-candles' });
      if (age - probe.lastSnapshotAt >= 1000 || row.retainedSegments === 0 || row.visibleDrawables === 0) {
        const retained = currentIds(), visible = currentVisibleIds();
        row.segmentIdsHash = hash(retained); row.visibleSegmentIdsHash = hash(visible); row.visibleSegmentCount = visible.length;
        probe.idSnapshots.push({ atMs: row.atMs, segmentIds: retained, visibleSegmentIds: visible });
        probe.lastSnapshotAt = age;
      }
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  };
  const summarize = () => {
    const raf = probe.raf, draws = probe.draws, changes = probe.changes;
    const zeros = rows => rows.filter(row => row.retainedSegments === 0 || row.visibleDrawables === 0).length;
    const maxGap = rows => rows.length > 1 ? Math.max(...rows.slice(1).map((row, i) => row.atMs - rows[i].atMs)) : null;
    return { rafCount: raf.length, scheduledDrawCount: draws.length,
      zeroRetainedRafSamples: zeros(raf), zeroVisibleRafSamples: raf.filter(row => row.visibleDrawables === 0).length,
      zeroRetainedDraws: zeros(draws), zeroVisibleDraws: draws.filter(row => row.visibleDrawables === 0).length,
      zeroEventsDuringLiveStatus: probe.zeroEvents.filter(row => row.state === 'live' || row.candleState === 'live').length,
      sourceSnapshots: changes.filter(row => row.operation === 'source-snapshot').length,
      sourcePatchBatches: changes.filter(row => row.operation === 'source-patch').length,
      segmentAdditions: changes.reduce((n, row) => n + row.addedIds.length, 0),
      segmentRemovals: changes.reduce((n, row) => n + row.removedIds.length, 0),
      unexpectedRemovals: changes.flatMap(row => row.unexpectedRemovedIds).length,
      uniqueRetainedSetHashes: new Set(probe.idSnapshots.map(row => row.segmentIds.join('\u001f'))).size,
      uniqueVisibleSetHashes: new Set(probe.idSnapshots.map(row => row.visibleSegmentIds.join('\u001f'))).size,
      maxDrawGapMs: maxGap(draws), maxRafGapMs: maxGap(raf) };
  };
  probe.finish = () => {
    probe.active = false;
    return { durationMs: Math.round(performance.now() - probe.startedAt), rafSamples: probe.raf, scheduledDraws: probe.draws,
      sourceMembershipChanges: probe.changes, idSnapshots: probe.idSnapshots, zeroEvents: probe.zeroEvents,
      summary: summarize() };
  };
}

async function panAndRestore(target, id) {
  const before = await readViewport(target, id);
  const mark = requests.length;
  await target.evaluate(({ panelId, range, spacing }) => {
    const e = window.__terminal.panels.get(panelId).engine;
    e.setRange({ from: range.from - 2, to: range.to - 2 }); e.zoom(1.1);
    window.__wallContinuityPan = { panelId, range, spacing };
  }, { panelId: id, range: before.logicalRange, spacing: before.spacing });
  await target.waitForTimeout(300);
  await target.evaluate(() => {
    const { panelId, range, spacing } = window.__wallContinuityPan, e = window.__terminal.panels.get(panelId).engine;
    e.setRange(range); e.zoom(spacing / e.chart.timeScale.barSpacing);
  });
  await target.waitForTimeout(500);
  return { durationMs: 800, before, after: await readViewport(target, id), depthRequestsStarted: requests.length - mark };
}

async function readViewport(target, id) {
  return target.evaluate(panelId => {
    const e = window.__terminal.panels.get(panelId).engine;
    return { logicalRange: e.visibleRange(), timeRange: e.visibleTimeRange(), spacing: e.chart.timeScale.barSpacing,
      priceRange: e.chart.panes()[0].priceScale.priceRange() };
  }, id);
}
async function setInitialViewport(id) {
  return page.evaluate(panelId => {
    const p = window.__terminal.panels.get(panelId), e = p.engine, chart = e.chart;
    const data = chart.dataLayer, base = data.baseIndex;
    if (!Number.isFinite(base) || data.length < 60) throw new Error('Chart lacks enough live one-minute candle history');
    const range = { from: base - 12, to: base + 1 };
    const close = e.latestCandle()?.close ?? p.diagnostics().last?.c ?? 84_000;
    const priceRange = { min: Math.floor((close - 550) / 10) * 10, max: Math.ceil((close + 550) / 10) * 10 };
    e.setRange(range); chart.setAutoScale(false); chart.panes()[0].priceScale.setPriceRange(priceRange);
    return { logicalRange: range, timeRange: e.visibleTimeRange(), priceRange, close };
  }, id);
}
async function chooseChartMarket(panel, label) {
  await panel.getByRole('button', { name: 'Chart market', exact: true }).click();
  const picker = panel.locator('.market-picker');
  await picker.getByRole('radio', { name: label, exact: true }).check();
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
}
async function setWallAggregation(panel, dollars) {
  await panel.getByRole('button', { name: 'Order Walls settings', exact: true }).click();
  const settings = panel.locator('dialog.order-walls-settings');
  await settings.getByLabel('Price aggregation', { exact: true }).selectOption(String(dollars));
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function sourceFingerprint() {
  const files = [];
  async function walk(directory) { for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = `${directory}/${item.name}`;
    if (item.isDirectory()) await walk(name); else if (/\.(?:ts|tsx|js|css|html)$/.test(item.name)) files.push(name);
  } }
  await walk('src'); files.push('index.html');
  const result = {};
  for (const file of files.sort()) result[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  return result;
}
function hostSnapshot() {
  let memAvailableBytes = null;
  try { const text = readFileSync('/proc/meminfo', 'utf8'); memAvailableBytes = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024; } catch { /* optional */ }
  return { loadAverage: os.loadavg(), freeMemoryBytes: os.freemem(), memAvailableBytes, totalMemoryBytes: os.totalmem() };
}
async function readHealth() {
  try {
    const response = await fetch('http://127.0.0.1:18780/v1/health', { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return { httpStatus: response.status, collectorState: body.collector?.state, depthState: body.depth?.status?.state,
      depthCursor: body.depth?.head?.cursor, depthAt: body.depth?.head?.at, ingestionLagMs: body.metrics?.ingestionLagMs,
      queue: body.metrics?.queue, paused: body.disk?.paused, backlog: body.materializer?.backlog ?? null };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

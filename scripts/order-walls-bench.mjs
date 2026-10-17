/**
 * Bounded Order Walls measurement harness.
 *
 * `--mode=fixture` attaches explicit deterministic geometry to the real native
 * chart primitives on a diagnostic Vite page. It measures renderer work only.
 * `--mode=staging` measures the real worker, gateway, retained depth history,
 * and live source on the staged app. No server or source data is mutated.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { addIndicator } from './indicator-actions.mjs';

const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const mode = option('mode', 'fixture');
const baseUrl = option('url', mode === 'staging' ? 'http://127.0.0.1:5181/' : 'http://127.0.0.1:5180/');
const samples = Number(option('samples', '3'));
const output = option('output', `artifacts/order-walls/${mode}.json`);
const timeoutMs = Number(option('timeout-ms', '90000'));
const liveMs = Number(option('live-ms', '10000'));
const updates = Number(option('updates', '40'));
const updateDelayMs = Number(option('update-delay-ms', '100'));
const fixtureSegments = Number(option('fixture-segments', '20'));
const fixtureColumns = Number(option('fixture-columns', '60'));
const fixtureRows = Number(option('fixture-rows', '32'));
const workerDiagnosticsAckMs = 10000;
const workerDiagnosticsRetryMs = 10000;

if (!['fixture', 'staging'].includes(mode)) throw new Error('--mode must be fixture or staging');
if (!Number.isInteger(samples) || samples < 1 || samples > 3) throw new Error('--samples must be from 1 through 3');
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('--timeout-ms must be from 1000 through 300000');
if (!Number.isFinite(liveMs) || liveMs < 1000 || liveMs > 60000) throw new Error('--live-ms must be from 1000 through 60000');
if (!Number.isInteger(updates) || updates < 1 || updates > 1000) throw new Error('--updates must be from 1 through 1000');

const allCases = [
  { id: 'candles-only', walls: false, heatmap: false },
  { id: 'candles-order-walls', walls: true, heatmap: false },
  { id: 'candles-heatmap', walls: false, heatmap: true },
  { id: 'candles-both', walls: true, heatmap: true },
];
const selectedCase = option('case', '');
const cases = selectedCase ? allCases.filter(scenario => scenario.id === selectedCase) : allCases;
if (selectedCase && cases.length === 0) throw new Error(`Unknown --case ${selectedCase}; expected one of ${allCases.map(scenario => scenario.id).join(', ')}`);
function caseOrder(sample) {
  const shift = (sample - 1) % cases.length;
  return [...cases.slice(shift), ...cases.slice(0, shift)];
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
};
function sameViewport(actual, expected) {
  if (!actual?.logicalRange || !expected?.logicalRange || !actual?.priceRange || !expected?.priceRange) return false;
  return Math.abs(actual.logicalRange.from - expected.logicalRange.from) <= 0.05
    && Math.abs(actual.logicalRange.to - expected.logicalRange.to) <= 0.05
    && Math.abs(actual.priceRange.min - expected.priceRange.min) <= 0.01
    && Math.abs(actual.priceRange.max - expected.priceRange.max) <= 0.01;
}
async function readFixtureViewport(page, panelId) {
  return page.evaluate(id => {
    const engine = window.__terminal.panels.get(id).engine, chart = engine.chart;
    return { logicalRange: engine.visibleRange(), timeRange: engine.visibleTimeRange(),
      priceRange: chart.panes()[0].priceScale.priceRange() };
  }, panelId);
}
async function restoreFixtureViewport(page, panelId, expected) {
  const before = await readFixtureViewport(page, panelId);
  await page.evaluate(({ id, logicalRange, priceRange }) => {
    const engine = window.__terminal.panels.get(id).engine, chart = engine.chart;
    engine.setRange(logicalRange); chart.setAutoScale(false);
    chart.panes()[0].priceScale.setPriceRange(priceRange);
  }, { id: panelId, logicalRange: expected.logicalRange, priceRange: expected.priceRange });
  await page.waitForTimeout(100);
  const after = await readFixtureViewport(page, panelId);
  return { before, after, stable: sameViewport(after, expected) };
}
async function restoreStagingViewport(page, panelId, rangeMs, priceRange) {
  const before = await page.evaluate(id => {
    const engine = window.__terminal.panels.get(id).engine;
    return { timeRange: engine.visibleTimeRange(), priceRange: engine.chart.panes()[0].priceScale.priceRange() };
  }, panelId);
  const applied = await page.evaluate(({ id, range, prices }) => {
    const engine = window.__terminal.panels.get(id).engine, chart = engine.chart, data = chart.dataLayer;
    const from = data.timeToIndexFloat(range.from / 1000), to = data.timeToIndexFloat(range.to / 1000);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { applied: false, from, to };
    engine.setRange({ from, to }); chart.setAutoScale(false); chart.panes()[0].priceScale.setPriceRange(prices);
    return { applied: true, logicalRange: engine.visibleRange() };
  }, { id: panelId, range: rangeMs, prices: priceRange });
  await page.waitForTimeout(150);
  const after = await page.evaluate(id => {
    const engine = window.__terminal.panels.get(id).engine;
    return { timeRange: engine.visibleTimeRange(), priceRange: engine.chart.panes()[0].priceScale.priceRange() };
  }, panelId);
  const expected = { from: rangeMs.from / 1000, to: rangeMs.to / 1000 };
  const stable = applied.applied && before?.timeRange && after?.timeRange
    && Math.abs(after.timeRange.from - expected.from) <= 1.1
    && Math.abs(after.timeRange.to - expected.to) <= 1.1
    && Math.abs(after.priceRange.min - priceRange.min) <= 0.01
    && Math.abs(after.priceRange.max - priceRange.max) <= 0.01;
  return { before, applied, after, expected, stable };
}
const slug = value => value.replaceAll('+', '-').replaceAll(' ', '-').toLowerCase();
const startedAt = new Date().toISOString();
const sourceHashesAtStart = await sourceFingerprint();
const result = {
  schemaVersion: 1,
  mode,
  baseUrl,
  selectedCase: selectedCase || null,
  startedAt,
  machine: { platform: os.platform(), arch: os.arch(), release: os.release(), node: process.version },
  browser: null,
  sourceHashesAtStart,
  method: mode === 'fixture'
    ? 'Explicit deterministic segments and heatmap buckets injected into the native chart primitives. Renderer comparison only; no exchange or gateway calls.'
    : 'Actual Binance USD-M perpetual candles, staged raw depth-observation API, existing worker, live head stream, and native renderers. Fresh Playwright context per scenario-sample; warm reattach is tested at the same visible time bounds and records cache reuse and any fresh tail requests rather than assuming a cache hit.',
  cases: [],
  status: 'running',
  limits: {
    frameIntervals: 'Observed requestAnimationFrame gaps only; no FPS guarantee or inferred frame rate.',
    memory: 'Chromium JavaScript heap when exposed, worker cache counters, renderer-retained byte estimates, and summed benchmark Chromium process RSS. RSS may double-count shared pages and excludes some GPU/canvas allocations; host MemAvailable is also recorded.',
    rendering: 'Pi /usr/bin/chromium in Playwright headless mode, without forced SwiftShader arguments. Backend is recorded from the running app.',
  },
};

await mkdir('artifacts/order-walls', { recursive: true });
const executable = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const requestedArgs = ['--no-sandbox', '--enable-webgl'];
const ignoredDefaultArguments = ['--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: executable, headless: true,
  args: requestedArgs, ignoreDefaultArgs: ignoredDefaultArguments });
result.browser = { version: browser.version(), executable, headless: true, viewport: { width: 1366, height: 860 },
  deviceScaleFactor: 1, requestedArgs, ignoredDefaultArguments, graphics: null };
try {
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send('SystemInfo.getInfo');
  result.browser.graphics = {
    modelName: info.modelName,
    modelVersion: info.modelVersion,
    devices: info.gpu?.devices?.map(device => ({ vendorId: device.vendorId, deviceId: device.deviceId,
      vendorString: device.vendorString, deviceString: device.deviceString,
      driverVendor: device.driverVendor, driverVersion: device.driverVersion })) ?? [],
    auxAttributes: info.gpu?.auxAttributes,
    featureStatus: info.gpu?.featureStatus,
  };
  await cdp.detach();
} catch (error) {
  result.browser.graphics = { unavailable: error instanceof Error ? error.message : String(error) };
}
const runStarted = performance.now();

try {
  if (mode === 'fixture') await runFixture();
  else await runStaging();
} finally {
  result.endedAt = new Date().toISOString();
  result.sourceHashesAtEnd = await sourceFingerprint();
  result.sourceStableForRun = JSON.stringify(result.sourceHashesAtStart) === JSON.stringify(result.sourceHashesAtEnd);
  result.durationMs = Math.round(performance.now() - runStarted);
  await save();
  await browser.close();
}

async function save() {
  if (result.mode === 'staging') {
    if (result.invalidatedAt) result.status = 'invalidated';
    else if (result.stopReason) result.status = 'provisional-not-accepted';
    else if (result.cases.length === samples * cases.length
      && result.cases.every(item => item.stability?.valid && !item.failed)) result.status = 'complete';
    else if (result.endedAt) result.status = 'provisional-not-accepted';
  } else if (result.endedAt) result.status = result.sourceStableForRun ? 'complete' : 'invalidated';
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
}

async function sourceFingerprint() {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.(?:ts|tsx|js|css|html)$/.test(entry.name)) files.push(filename);
    }
  }
  await walk('src');
  files.push('index.html');
  const hashes = {};
  for (const filename of files.sort()) {
    hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
  }
  return hashes;
}

function watchRuntime(page) {
  const events = { mainNavigations: [], workers: [], viteUpdates: [] };
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) events.mainNavigations.push({ at: new Date().toISOString(), url: frame.url() });
  });
  page.on('worker', worker => events.workers.push({ at: new Date().toISOString(), url: worker.url() }));
  page.on('websocket', socket => {
    let sameOrigin = false;
    try { sameOrigin = new URL(socket.url()).host === new URL(baseUrl).host; } catch { /* ignore unrelated sockets */ }
    if (!sameOrigin) return;
    socket.on('framereceived', message => {
      const payload = typeof message.payload === 'string' ? message.payload : message.payload?.toString('utf8') ?? '';
      if (/"type"\s*:\s*"(?:update|full-reload|prune|error)"/.test(payload)) {
        events.viteUpdates.push({ at: new Date().toISOString(), payload: payload.slice(0, 300) });
      }
    });
  });
  return { events, snapshot: () => ({ mainNavigations: events.mainNavigations.length, workers: events.workers.length, viteUpdates: events.viteUpdates.length }) };
}

function hostState() {
  let processes = [];
  try {
    processes = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8' }).split('\n')
      .map(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return match ? { pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), command: match[4] } : null;
      }).filter(Boolean);
  } catch { /* optional host accounting */ }
  const count = expression => processes.filter(({ command }) => expression.test(command)).length;
  let memAvailableBytes = null;
  try {
    const line = readFileSync('/proc/meminfo', 'utf8').split('\n').find(value => value.startsWith('MemAvailable:'));
    const kibibytes = Number(line?.match(/\d+/)?.[0]);
    if (Number.isFinite(kibibytes)) memAvailableBytes = kibibytes * 1024;
  } catch { /* optional on non-Linux hosts */ }
  const browserPids = new Set();
  // The Chromium browser process is a direct child of this Node process; include its renderer/GPU descendants.
  for (const root of processes.filter(row => row.ppid === globalThis.process.pid && /(?:^|\/)chromium(?:\s|$)/.test(row.command))) browserPids.add(root.pid);
  let grew = true;
  while (grew) {
    grew = false;
    for (const process of processes) if (!browserPids.has(process.pid) && browserPids.has(process.ppid)) {
      browserPids.add(process.pid); grew = true;
    }
  }
  const browserProcesses = processes.filter(process => browserPids.has(process.pid));
  return { loadAverage: os.loadavg(), freeMemoryBytes: os.freemem(), memAvailableBytes, totalMemoryBytes: os.totalmem(),
    benchmarkBrowserRssBytes: browserProcesses.reduce((total, process) => total + process.rssKb * 1024, 0),
    benchmarkBrowserProcessCount: browserProcesses.length,
    benchmarkBrowserRssCaveat: 'Summed Chromium process RSS; shared pages may be counted more than once.',
    concurrent: { vite: count(/(?:^|\s)(?:vite|.*vite\/bin\/vite|dev:staging)(?:\s|$)/),
      build: count(/(?:pnpm|npm|node|tsc).*(?:\bbuild\b|\btsc\b)/),
      tests: count(/(?:pnpm|npm|node).*(?:vitest|playwright test)/),
      benchmark: count(/order-walls-bench\.mjs/) } };
}

function runtimeChanges(runtime, before) {
  const after = runtime.snapshot();
  const events = {
    mainNavigations: runtime.events.mainNavigations.slice(before.mainNavigations),
    workers: runtime.events.workers.slice(before.workers),
    viteUpdates: runtime.events.viteUpdates.slice(before.viteUpdates),
  };
  return { before, after, events,
    stable: Object.values(events).every(values => values.length === 0),
    invalidationReasons: Object.entries(events).filter(([, values]) => values.length).map(([name]) => name) };
}

async function frameMark(page) {
  return page.evaluate(() => ({ frames: window.__orderWallsBench?.frames.length ?? 0, heap: window.__orderWallsBench?.heap.length ?? 0 }));
}

function framesBetween(probe, from, to) {
  return frameSummary({ intervalsMs: probe.intervalsMs.slice(from.frames, to.frames),
    heapSamplesBytes: probe.heapSamplesBytes.slice(from.heap, to.heap) });
}

async function openPage({ fixture = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('basis.theme.v1', 'dark'); } catch { /* before origin is available */ }
  });
  const page = await context.newPage();
  const runtime = watchRuntime(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const network = trackNetwork(page);
  const target = new URL(baseUrl);
  if (fixture) target.searchParams.set('fixture', '1');
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__terminal?.stats?.().panels?.length > 0, undefined, { timeout: 30000 });
  return { context, page, errors, network, runtime };
}

function trackNetwork(page) {
  const records = [];
  const pending = new Set();
  const started = new WeakMap();
  const selected = request => {
    try {
      const url = new URL(request.url());
      if (!url.pathname.includes('/market-data/')) return null;
      const kind = url.pathname.includes('/depth-observations') ? 'wall-depth-history'
        : /\/history\//.test(url.pathname) || /\/heatmap|\/depth-history/.test(url.pathname) ? 'heatmap-history'
          : 'other-market-data';
      const query = {};
      for (const key of ['market', 'from', 'to', 'after', 'watermark', 'limit', 'rowPrice', 'timeMs']) {
        const value = url.searchParams.get(key);
        if (value !== null) query[key] = value;
      }
      return { path: url.pathname, kind, query };
    } catch { return null; }
  };
  page.on('request', request => {
    const info = selected(request);
    if (info) started.set(request, { ...info, startPerf: performance.now(), startAt: new Date().toISOString() });
  });
  const complete = request => {
    const before = started.get(request);
    if (!before) return;
    const task = (async () => {
      const response = await request.response().catch(() => null);
      const sizes = await request.sizes().catch(() => null);
      const contentLength = Number(response?.headers()['content-length']);
      records.push({
        path: before.path,
        kind: before.kind,
        query: before.query,
        startedAt: before.startAt,
        startPerf: before.startPerf,
        durationMs: request.timing().responseEnd >= 0 ? request.timing().responseEnd - request.timing().requestStart : null,
        status: response?.status() ?? null,
        contentLengthHeaderBytes: Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null,
        responseBodyBytes: sizes?.responseBodySize ?? null,
        transferSizeBytes: sizes?.responseBodySize !== undefined && sizes?.responseHeadersSize !== undefined
          ? sizes.responseBodySize + sizes.responseHeadersSize : null,
      });
    })().finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('requestfinished', complete);
  page.on('requestfailed', request => {
    const before = started.get(request);
    if (!before) return;
    records.push({ path: before.path, kind: before.kind, query: before.query, startedAt: before.startAt,
      startPerf: before.startPerf, status: null, failed: request.failure()?.errorText ?? 'request failed' });
  });
  return { records, async flush() { await Promise.allSettled([...pending]); } };
}

async function stats(page, { refreshWorker = false, workerAckTimeoutMs = 0 } = {}) {
  const beforeAck = refreshWorker ? await page.evaluate(({ ackTimeoutMs, retryMs }) => {
    const terminal = window.__terminal, now = performance.now();
    const probe = window.__orderWallsDiagnosticsProbe ??= {
      pending: false, pendingBefore: null, pendingAt: null, lastRequestAt: null,
      requestSeq: 0, ackSeq: 0, lastAckAt: null, lastAckedRequestSeq: 0, timedOutRequests: 0,
    };
    const current = terminal.feed.diagnostics;
    if (probe.pending && current !== probe.pendingBefore) {
      probe.pending = false;
      probe.pendingBefore = null;
      probe.pendingAt = null;
      probe.ackSeq++;
      probe.lastAckAt = now;
      probe.lastAckedRequestSeq = probe.requestSeq;
    } else if (probe.pending && now - probe.pendingAt >= ackTimeoutMs) {
      probe.pending = false;
      probe.pendingBefore = null;
      probe.pendingAt = null;
      probe.timedOutRequests++;
    }
    if (!probe.pending && (probe.lastRequestAt === null || now - probe.lastRequestAt >= retryMs)) {
      probe.pending = true;
      probe.pendingBefore = current;
      probe.pendingAt = now;
      probe.lastRequestAt = now;
      probe.requestSeq++;
      terminal.feed.send({ type: 'diagnostics' });
    }
    return { ackSeq: probe.ackSeq, requestSeq: probe.requestSeq, timedOutRequests: probe.timedOutRequests };
  }, { ackTimeoutMs: workerDiagnosticsAckMs, retryMs: workerDiagnosticsRetryMs }) : null;

  if (refreshWorker && workerAckTimeoutMs > 0 && beforeAck) {
    await page.waitForFunction(({ ackSeq, timedOutRequests }) => {
      const terminal = window.__terminal, probe = window.__orderWallsDiagnosticsProbe;
      if (probe?.pending && terminal.feed.diagnostics !== probe.pendingBefore) {
        probe.pending = false; probe.pendingBefore = null; probe.pendingAt = null;
        probe.ackSeq++; probe.lastAckAt = performance.now(); probe.lastAckedRequestSeq = probe.requestSeq;
      } else if (probe?.pending && performance.now() - probe.pendingAt >= 10000) {
        probe.pending = false; probe.pendingBefore = null; probe.pendingAt = null; probe.timedOutRequests++;
      }
      return (probe?.ackSeq ?? 0) > ackSeq || (probe?.timedOutRequests ?? 0) > timedOutRequests;
    }, beforeAck, { timeout: workerAckTimeoutMs }).catch(() => {});
  }

  return page.evaluate(() => {
    const now = performance.now(), probe = window.__orderWallsDiagnosticsProbe;
    const currentWorker = window.__terminal.feed.diagnostics;
    if (probe?.pending && currentWorker !== probe.pendingBefore) {
      probe.pending = false; probe.pendingBefore = null; probe.pendingAt = null;
      probe.ackSeq++; probe.lastAckAt = now; probe.lastAckedRequestSeq = probe.requestSeq;
    } else if (probe?.pending && now - probe.pendingAt >= 10000) {
      probe.pending = false; probe.pendingBefore = null; probe.pendingAt = null; probe.timedOutRequests++;
    }
    const ackAgeMs = probe?.lastAckAt === null || probe?.lastAckAt === undefined ? null : Math.round(now - probe.lastAckAt);
    const panels = [...window.__terminal.panels.values()];
    return {
      panels: panels.map(panel => panel.diagnostics()),
      worker: currentWorker,
      workerDiagnostics: probe ? { requestSeq: probe.requestSeq, ackSeq: probe.ackSeq,
        lastAckedRequestSeq: probe.lastAckedRequestSeq, pending: probe.pending,
        pendingMs: probe.pendingAt === null ? null : Math.round(now - probe.pendingAt),
        ackAgeMs, freshWithin10s: ackAgeMs !== null && ackAgeMs <= 10000,
        timedOutRequests: probe.timedOutRequests } : { requestSeq: 0, ackSeq: 0,
          lastAckedRequestSeq: 0, pending: false, pendingMs: null, ackAgeMs: null,
          freshWithin10s: false, timedOutRequests: 0 },
      historyApply: { ...window.__terminal.feed.historyApply },
      frameIntervals: [...window.__terminal.stats().frameIntervals],
      longTasks: [...window.__terminal.stats().longTasks],
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
}

async function prepareChart(page, { staging = false } = {}) {
  if (staging) {
    await page.waitForFunction(() => window.__terminal.stats().panels.some(panel => panel.series?.venue === 'binance'
      && panel.series?.market === 'perpetual' && panel.bars >= 60 && panel.status?.state === 'live'), undefined, { timeout: 60000 });
  } else {
    await page.waitForFunction(() => window.__terminal.fixture === true
      && window.__terminal.stats().panels.some(panel => panel.series?.venue === 'binance' && panel.bars === 5000), undefined, { timeout: 30000 });
  }
  const id = await page.evaluate(() => {
    const terminal = window.__terminal;
    const selected = [...terminal.panels].find(([, panel]) => panel.diagnostics().series.venue === 'binance'
      && panel.diagnostics().series.market === 'perpetual') ?? [...terminal.panels][0];
    if (!selected) throw new Error('No chart panel is available');
    for (const [panelId] of terminal.panels) if (panelId !== selected[0]) terminal.dock.getPanel(panelId)?.api.close();
    return selected[0];
  });
  let panel = page.locator(`.candle-panel[data-panel-id="${id}"]`);
  if (staging) {
    const series = await page.evaluate(panelId => window.__terminal.panels.get(panelId).diagnostics().series, id);
    if (series.venue !== 'binance' || series.market !== 'perpetual') await chooseChartMarket(panel, 'Binance · BTCUSDT USD-M Perp');
    if (await panel.getByLabel('Timeframe', { exact: true }).inputValue() !== '1m') await panel.getByLabel('Timeframe', { exact: true }).selectOption('1m');
    await page.waitForFunction(panelId => {
      const diagnostics = window.__terminal.panels.get(panelId)?.diagnostics();
      return diagnostics?.series?.venue === 'binance' && diagnostics?.series?.market === 'perpetual'
        && diagnostics?.bars >= 60 && diagnostics?.status?.state === 'live';
    }, id, { timeout: 60000 });
  }
  const view = await page.evaluate(panelId => {
    const p = window.__terminal.panels.get(panelId), engine = p.engine, chart = engine.chart;
    const data = chart.dataLayer, base = data.baseIndex;
    if (!Number.isFinite(base) || data.length < 60) throw new Error('Chart does not have enough one-minute candle history');
    const range = { from: base - 12, to: base + 1 };
    engine.setRange(range);
    chart.setAutoScale(false);
    const close = engine.latestCandle()?.close ?? p.diagnostics().last?.c ?? 84000;
    const prices = { min: Math.floor((close - 550) / 10) * 10, max: Math.ceil((close + 550) / 10) * 10 };
    chart.panes()[0].priceScale.setPriceRange(prices);
    return { logicalRange: range, timeRange: engine.visibleTimeRange(), priceRange: prices, close, bars: engine.barCount,
      series: p.diagnostics().series, candleState: p.diagnostics().status?.state };
  }, id);
  await page.waitForTimeout(120);
  return { id, panel, view };
}

async function startFrameProbe(page) {
  await page.evaluate(() => {
    const probe = window.__orderWallsBench = { frames: [], heap: [], previous: 0, running: true, callbacks: 0 };
    const sample = time => {
      if (!probe.running) return;
      if (probe.previous) probe.frames.push(time - probe.previous);
      probe.previous = time;
      probe.callbacks++;
      if (probe.callbacks % 15 === 0 && performance.memory) probe.heap.push(performance.memory.usedJSHeapSize);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function stopFrameProbe(page) {
  return page.evaluate(() => {
    const probe = window.__orderWallsBench;
    if (!probe) return { intervalsMs: [], heapSamplesBytes: [] };
    probe.running = false;
    return { intervalsMs: [...probe.frames], heapSamplesBytes: [...probe.heap], rafCallbacks: probe.callbacks };
  });
}

function frameSummary(probe) {
  const intervals = probe.intervalsMs;
  return {
    samples: intervals.length,
    p50Ms: percentile(intervals, .5), p95Ms: percentile(intervals, .95), maxMs: intervals.length ? Math.max(...intervals) : null,
    over16_7ms: intervals.filter(value => value > 16.7).length,
    over33ms: intervals.filter(value => value > 33).length,
    over50ms: intervals.filter(value => value > 50).length,
    over100ms: intervals.filter(value => value > 100).length,
    heapFirstBytes: probe.heapSamplesBytes[0] ?? null,
    heapMaxBytes: probe.heapSamplesBytes.length ? Math.max(...probe.heapSamplesBytes) : null,
    heapLastBytes: probe.heapSamplesBytes.at(-1) ?? null,
  };
}

function requestSummary(records, sincePerf = -Infinity) {
  const selected = records.filter(record => record.startPerf >= sincePerf);
  const byKind = {};
  for (const record of selected) {
    const row = byKind[record.kind] ??= { requests: 0, successful: 0, failed: 0, bodyBytes: 0, contentLengthBytes: 0,
      responseBodySizes: [], requestsByStatus: {} };
    row.requests++;
    if (record.status === null) row.failed++;
    else { row.successful++; row.requestsByStatus[record.status] = (row.requestsByStatus[record.status] ?? 0) + 1; }
    if (Number.isFinite(record.responseBodyBytes)) row.bodyBytes += record.responseBodyBytes;
    if (Number.isFinite(record.contentLengthHeaderBytes)) row.contentLengthBytes += record.contentLengthHeaderBytes;
    if (Number.isFinite(record.responseBodyBytes)) row.responseBodySizes.push(record.responseBodyBytes);
  }
  return { requestCount: selected.length, byKind, requests: selected.map(({ startPerf, ...record }) => record) };
}
function historyQueryBounds(records, sincePerf = -Infinity) {
  const bounds = {};
  for (const record of records) {
    if (record.startPerf < sincePerf || !['wall-depth-history', 'heatmap-history'].includes(record.kind)) continue;
    const from = Number(record.query?.from), to = Number(record.query?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const entries = bounds[record.kind] ??= [];
    if (!entries.some(value => value.from === from && value.to === to)) entries.push({ from, to });
  }
  return bounds;
}

function panelState(value, id) { return value.panels.find(panel => panel.id === id) ?? value.panels[0] ?? null; }
function fixtureRendererState(value) {
  if (!value) return value;
  const { settings, ...renderer } = value;
  return renderer;
}
function activeWallSubscription(worker, panelId) {
  const prefix = `order-walls:${panelId}:`;
  return (worker?.subscriptions ?? [])
    .filter(subscription => subscription.market === 'binance-perp' && subscription.id?.startsWith(prefix))
    .sort((a, b) => (b.generation ?? -1) - (a.generation ?? -1))[0] ?? null;
}

async function runFixture() {
  for (let sample = 1; sample <= samples; sample++) for (const scenario of caseOrder(sample)) {
    const sourceHashesBefore = await sourceFingerprint(), hostBefore = hostState();
    const { context, page, errors, network, runtime } = await openPage({ fixture: true });
    let runtimeBaseline = null;
    let fixtureViewportInvalid = false;
    const viewportVerification = {};
    try {
      const { id, view } = await prepareChart(page);
      runtimeBaseline = runtime.snapshot();
      const targetViewport = { logicalRange: view.logicalRange, priceRange: view.priceRange };
      const injection = await page.evaluate(({ panelId, scenario, fixtureSegments, fixtureColumns, fixtureRows, targetViewport }) => {
        const p = window.__terminal.panels.get(panelId), engine = p.engine, chart = engine.chart, data = chart.dataLayer;
        engine.setRange(targetViewport.logicalRange); chart.setAutoScale(false);
        chart.panes()[0].priceScale.setPriceRange(targetViewport.priceRange);
        const range = engine.visibleRange(), times = engine.visibleTimeRange();
        const intervalMs = 60_000, start = Math.floor(times.from * 1000 / intervalMs) * intervalMs;
        const end = Math.ceil(times.to * 1000 / intervalMs) * intervalMs;
        const visibleIntervals = Math.max(1, Math.ceil((end - start) / intervalMs));
        const close = engine.latestCandle()?.close ?? 84000, centre = Math.round(close / 10) * 10;
        const prices = chart.panes()[0].priceScale.priceRange();
        const firstPriceBand = Math.ceil(prices.min / 50) * 50;
        const priceBandCount = Math.max(1, Math.floor((prices.max - firstPriceBand - 50) / 50) + 1);
        const wallDuration = Math.max(intervalMs, Math.floor(visibleIntervals / 3) * intervalMs);
        const status = { state: 'live', tickSize: .1, lastConfirmedAt: end,
          coverage: { from: start, to: end, complete: true, partial: false },
          bookScope: { maxLevelsPerSide: 5000, bidComplete: true, askComplete: true } };
        const segments = Array.from({ length: scenario.walls ? fixtureSegments : 0 }, (_, index) => {
          const t0 = start + Math.floor(index / fixtureSegments * Math.max(1, visibleIntervals - 1)) * intervalMs;
          const t1 = Math.min(end, t0 + wallDuration);
          const band = Math.floor(index * priceBandCount / fixtureSegments);
          const price = firstPriceBand + band * 50;
          const openEnded = index % 4 === 0;
          return { id: `fixture-wall-${index}`, epoch: 'fixture-epoch-1', side: index % 2 ? 'ask' : 'bid', price, start: t0, end: openEnded ? null : t1,
            peakUsd: 250_000 + index * 1000, meanUsd: 180_000 + index * 500, durationMs: t1 - t0,
            percentile: 90 + index % 10, scopePartial: false, startKnown: true, valueRuns: [], valueRunsTruncated: false,
            endReason: openEnded ? null : 'removed', endKnown: !openEnded };
        });
        const buckets = [];
        if (scenario.heatmap) {
          const columnCount = Math.max(1, Math.min(fixtureColumns, Math.ceil((end - start) / intervalMs)));
          const rows = Math.max(1, Math.min(fixtureRows, 128));
          for (let column = 0; column < columnCount; column++) {
            const bucketStart = start + column * intervalMs, bucketEnd = bucketStart + intervalMs;
            const cells = new Float64Array(rows * 13);
            for (let row = 0; row < rows; row++) {
              const offset = row * 13, low = centre - Math.floor(rows / 2) * 10 + row * 10;
              const bid = .05 + ((column * 7 + row * 3) % 35) / 10, ask = .05 + ((column * 11 + row * 5) % 31) / 10;
              cells[offset] = low; cells[offset + 1] = bid * intervalMs; cells[offset + 2] = ask * intervalMs;
              cells[offset + 3] = bid * 1.4; cells[offset + 4] = ask * 1.4;
              cells[offset + 5] = intervalMs; cells[offset + 6] = intervalMs; cells[offset + 7] = intervalMs; cells[offset + 8] = intervalMs;
              cells[offset + 9] = bid * low * intervalMs; cells[offset + 10] = ask * low * intervalMs;
              cells[offset + 11] = bid * low * 1.4; cells[offset + 12] = ask * low * 1.4;
            }
            buckets.push({ id: `fixture-heat-${column}`, start: bucketStart, end: bucketEnd, epoch: 1, rowSize: 10, revision: 1,
              capacityLimited: false, cells, peaks: new Float64Array(0), timeMs: intervalMs });
          }
        }
        if (scenario.walls) {
          engine.setOrderWalls({ enabled: true, showHistory: true, method: 'relative', thresholdUsd: 500_000,
            relativeFloorUsd: 250_000, relativePercentile: 95, exitRatio: .85, minDurationMs: 0,
            aggregation: 50, colorMode: 'heat', opacity: .85, thicknessPx: 2 }, intervalMs);
          engine.setOrderWallSnapshot(segments, status);
        } else engine.setOrderWalls({ enabled: false, showHistory: true, method: 'relative', thresholdUsd: 500_000,
          relativeFloorUsd: 250_000, relativePercentile: 95, exitRatio: .85, minDurationMs: 0,
          aggregation: 50, colorMode: 'heat', opacity: .85, thicknessPx: 2 }, intervalMs);
        if (scenario.heatmap) {
          engine.setHeatmap({ enabled: true, rowPrice: 10, bucketMs: 500, candleMs: intervalMs, mode: 'average',
            contrast: 'enhanced', opacity: .85, intensity: 100, minimum: .01, labels: 'auto', bids: true, asks: true }, intervalMs);
          engine.updateHeatmap(buckets, true, start);
        } else engine.setHeatmap({ enabled: false, rowPrice: 10, bucketMs: 500, candleMs: intervalMs, mode: 'average',
          contrast: 'enhanced', opacity: .85, intensity: 100, minimum: .01, labels: 'auto', bids: true, asks: true }, intervalMs);
        const fixture = { intervalMs, start, end, centre, segments, buckets, status, updates: 0, dispatchMs: [], retentionStart: start };
        window.__orderWallsFixture = fixture;
        window.__orderWallsFixtureUpdate = sequence => {
          const started = performance.now();
          if (scenario.walls && fixture.segments.length) {
            const index = sequence % fixture.segments.length, previous = fixture.segments[index];
            const changed = { ...previous, peakUsd: previous.peakUsd + 1000 + sequence, meanUsd: previous.meanUsd + 500 };
            fixture.segments[index] = changed;
            engine.patchOrderWalls([{ id: changed.id, segment: changed }], fixture.status);
          }
          if (scenario.heatmap && fixture.buckets.length) {
            const index = fixture.buckets.length - 1, previous = fixture.buckets[index];
            const cells = new Float64Array(previous.cells); cells[1] += intervalMs * .01; cells[3] += .01;
            const changed = { ...previous, revision: previous.revision + 1, cells };
            fixture.buckets[index] = changed;
            engine.updateHeatmap([changed], false, fixture.retentionStart);
          }
          fixture.dispatchMs.push(performance.now() - started); fixture.updates++;
        };
        return { visibleRange: range, visibleTimeRange: times, start, end, centre, segmentCount: segments.length,
          bucketCount: buckets.length, heatmapCellRows: buckets.reduce((n, bucket) => n + bucket.cells.length / 13, 0),
          chartBackend: engine.backend, bars: engine.barCount, fixedPriceRange: prices,
          targetViewport,
          fixedFixtureSettings: { wallsEnabled: scenario.walls, heatmapEnabled: scenario.heatmap, wallAggregationDollars: 50,
            fixtureWallSegments: segments.length, priceBands: priceBandCount } };
      }, { panelId: id, scenario, fixtureSegments, fixtureColumns, fixtureRows, targetViewport });
      await page.waitForTimeout(250);
      viewportVerification.afterAttach = await restoreFixtureViewport(page, id, targetViewport);
      if (!viewportVerification.afterAttach.stable) {
        fixtureViewportInvalid = true;
        throw new Error(`Fixture viewport changed after feature attach: ${JSON.stringify(viewportVerification.afterAttach)}`);
      }
      const before = await stats(page);
      await startFrameProbe(page);
      const updatesFrameStart = await frameMark(page);
      const wallSubmissions = [];
      for (let index = 0; index < updates; index++) {
        const t0 = performance.now();
        await page.evaluate(sequence => window.__orderWallsFixtureUpdate(sequence), index);
        wallSubmissions.push(performance.now() - t0);
        await page.waitForTimeout(updateDelayMs);
      }
      const updatesFrameEnd = await frameMark(page);
      const beforePan = await stats(page);
      const panFrameStart = await frameMark(page);
      const panStart = performance.now();
      await page.evaluate(panelId => {
        const engine = window.__terminal.panels.get(panelId).engine, original = engine.visibleRange();
        const spacing = engine.chart.timeScale.barSpacing;
        engine.setRange({ from: original.from - 2, to: original.to - 2 }); engine.zoom(1.12);
        window.__orderWallsRestore = { panelId, original, spacing };
      }, id);
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const { panelId, original, spacing } = window.__orderWallsRestore;
        const engine = window.__terminal.panels.get(panelId).engine;
        engine.setRange(original); engine.zoom(spacing / engine.chart.timeScale.barSpacing);
      });
      await page.waitForTimeout(250);
      viewportVerification.afterPanZoomRestore = await restoreFixtureViewport(page, id, targetViewport);
      if (!viewportVerification.afterPanZoomRestore.stable) {
        fixtureViewportInvalid = true;
        throw new Error(`Fixture viewport changed after pan/zoom restore: ${JSON.stringify(viewportVerification.afterPanZoomRestore)}`);
      }
      const panZoomMs = performance.now() - panStart;
      const panFrameEnd = await frameMark(page);
      const holdFrameStart = await frameMark(page);
      await page.waitForTimeout(Math.max(0, liveMs - 550));
      viewportVerification.afterSteadyHold = await readFixtureViewport(page, id);
      if (!sameViewport(viewportVerification.afterSteadyHold, targetViewport)) {
        fixtureViewportInvalid = true;
        throw new Error(`Fixture viewport changed during steady hold: ${JSON.stringify({ expected: targetViewport, actual: viewportVerification.afterSteadyHold })}`);
      }
      const holdFrameEnd = await frameMark(page);
      const after = await stats(page);
      const probe = await stopFrameProbe(page);
      const sourceHashesAfter = await sourceFingerprint();
      const runtimeStability = runtimeChanges(runtime, runtimeBaseline);
      const explicitUpdateTimes = await page.evaluate(() => [...window.__orderWallsFixture.dispatchMs]);
      const image = `artifacts/order-walls/fixture-${slug(scenario.id)}-sample-${sample}.png`;
      await page.screenshot({ path: image, fullPage: true });
      const wall = panelState(after, id)?.orderWalls;
      const heat = panelState(after, id)?.heatmap;
      const item = {
        scenario: scenario.id, sample, source: 'explicit deterministic renderer fixture',
        sourceHashesBefore, sourceHashesAfter,
        stability: { sourceStable: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter), ...runtimeStability,
          fixtureViewportStable: Object.values(viewportVerification).every(value => value?.stable !== false),
          valid: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter) && runtimeStability.stable && !fixtureViewportInvalid },
        host: { before: hostBefore, after: hostState() },
        viewport: view, fixture: { ...injection, bucketCount: injection.bucketCount, heatmapCellRows: injection.heatmapCellRows,
          syntheticWallSegments: injection.segmentCount, wallAggregationDollars: 50 },
        viewportVerification,
        workload: { updateCount: updates, updateDelayMs, panZoomMs, liveWindowMs: liveMs },
        renderer: {
          wall: { before: fixtureRendererState(panelState(before, id)?.orderWalls), after: fixtureRendererState(wall) },
          heatmap: { before: fixtureRendererState(panelState(before, id)?.heatmap), after: fixtureRendererState(heat) },
          wallPatchRoundTripMs: { p50: percentile(wallSubmissions, .5), p95: percentile(wallSubmissions, .95), max: Math.max(...wallSubmissions) },
          explicitUpdateDispatchMs: { p50: percentile(explicitUpdateTimes, .5), p95: percentile(explicitUpdateTimes, .95), max: explicitUpdateTimes.length ? Math.max(...explicitUpdateTimes) : null },
        },
        frames: frameSummary(probe), phaseFrames: { updates: framesBetween(probe, updatesFrameStart, updatesFrameEnd),
          panZoom: framesBetween(probe, panFrameStart, panFrameEnd), steadyHold: framesBetween(probe, holdFrameStart, holdFrameEnd) }, longTasks: after.longTasks,
        screenshot: image, errors, network: requestSummary(network.records),
      };
      delete item.fixture.segments; delete item.fixture.buckets; delete item.fixture.status; delete item.fixture.updates; delete item.fixture.dispatchMs; delete item.fixture.retentionStart; delete item.fixture.intervalMs;
      result.cases.push(item); await save();
      if (!item.stability.valid) {
        result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability };
        await save();
        return;
      }
      console.log(JSON.stringify({ mode, scenario: scenario.id, sample, frames: item.frames, wall: item.renderer.wall.after && { segments: item.renderer.wall.after.retainedSegments, visible: item.renderer.wall.after.visible, renderMs: item.renderer.wall.after.p95RenderMs }, heatmap: item.renderer.heatmap.after && { bins: item.renderer.heatmap.after.bins, renderMs: item.renderer.heatmap.after.p95RenderMs }, screenshot: image }));
    } catch (error) {
      const sourceHashesAfter = await sourceFingerprint();
      const sourceStable = JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter);
      const runtimeStability = runtimeBaseline ? runtimeChanges(runtime, runtimeBaseline) : null;
      const valid = sourceStable && (runtimeStability?.stable ?? true) && !fixtureViewportInvalid;
      const item = { scenario: scenario.id, sample, failed: error instanceof Error ? error.message : String(error), errors,
        sourceHashesBefore, sourceHashesAfter, stability: { sourceStable, ...(runtimeStability ?? {}),
          fixtureViewportStable: !fixtureViewportInvalid, valid }, viewportVerification, network: requestSummary(network.records) };
      result.cases.push(item); await save(); console.error(JSON.stringify(item));
      if (!valid) { result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability, reason: item.failed }; await save(); return; }
    } finally {
      await network.flush(); await context.close();
    }
  }
}

async function runStaging() {
  for (let sample = 1; sample <= samples; sample++) for (const scenario of caseOrder(sample)) {
    const sourceHashesBefore = await sourceFingerprint(), hostBefore = hostState();
    const { context, page, errors, network, runtime } = await openPage();
    let runtimeBaseline = null;
    try {
      const sampleStartedAt = new Date().toISOString();
      const { id, panel, view } = await prepareChart(page, { staging: true });
      runtimeBaseline = runtime.snapshot();
      result.inProgress = { scenario: scenario.id, sample, phase: 'chart-ready', startedAt: sampleStartedAt,
        panelId: id, viewport: view };
      await save();
      const initialDiagnostics = await stats(page, { refreshWorker: true, workerAckTimeoutMs: workerDiagnosticsAckMs });
      if (!initialDiagnostics.worker?.orderWalls || typeof initialDiagnostics.worker.orderWalls.cacheHits !== 'number') {
        throw new Error(initialDiagnostics.workerDiagnostics?.timedOutRequests
          ? 'No worker diagnostics ACK within the bounded 10-second staging readiness check.'
          : 'This page is not a staging-mode diagnostic build. Start Vite with VITE_DATA_MODE=staging and use __terminal diagnostics.');
      }
      await startFrameProbe(page);
      const coldFrameStart = await frameMark(page);
      const loads = [], coldStart = performance.now();
      for (const [feature, enabled, name, definitionId] of [
        ['orderWalls', scenario.walls, 'Order Walls', 'native.order-walls'],
        ['heatmap', scenario.heatmap, 'Order-book Heatmap', 'native.orderbook-heatmap'],
      ]) if (enabled) {
        const startPerf = performance.now(), startAt = new Date().toISOString();
        await page.evaluate(() => { window.__orderWallsLoadMark = performance.now(); });
        await addIndicator(panel, name);
        if (feature === 'orderWalls') await setWallAggregation(panel, 50);
        const load = await waitFeature(page, id, feature, startPerf, timeoutMs, async progress => {
          result.inProgress = { scenario: scenario.id, sample, phase: 'cold', feature, startedAt: startAt,
            viewport: view, wallAggregationDollars: 50, progress };
          await save();
          console.log(JSON.stringify({ mode, event: 'staging-load-progress', scenario: scenario.id, sample,
            phase: 'cold', feature, ...progress }));
        });
        const diagnostic = await stats(page, { refreshWorker: true });
        const state = panelState(diagnostic, id);
        loads.push({ feature, boundary: 'immediately before native indicator attach through first paint and source history terminal state',
          startedAt: startAt, ...load,
          rendererAtEnd: feature === 'orderWalls' ? state?.orderWalls : state?.heatmap,
          workerAtEnd: feature === 'orderWalls' ? diagnostic.worker?.orderWalls : diagnostic.worker?.heatmap,
          historyApplyAtEnd: diagnostic.historyApply,
          requests: requestSummary(network.records, startPerf) });
        if (!load.complete) {
          const visibleTimeRange = await page.evaluate(panelId => window.__terminal.panels.get(panelId).engine.visibleTimeRange(), id);
          const cold = { loads, worker: diagnostic.worker?.orderWalls, historyApply: diagnostic.historyApply,
            requests: requestSummary(network.records, coldStart), apiQueryBounds: historyQueryBounds(network.records, coldStart),
            visibleTimeRange, durationMs: Math.round(performance.now() - coldStart) };
          const diagnosticFresh = load.workerDiagnostics?.freshWithin10s === true;
          await recordStagingStop({ page, scenario, sample, sampleStartedAt, sourceHashesBefore, hostBefore,
            runtime, runtimeBaseline, errors, network, id, view, cold,
            reason: diagnosticFresh
              ? `${feature} did not reach promoted complete history before its bounded load deadline`
              : `${feature} did not reach promoted complete history before its bounded load deadline; worker diagnostics ACK was not fresh` });
          return;
        }
      }
      result.inProgress = { scenario: scenario.id, sample, phase: 'live-pan-rollover', startedAt: sampleStartedAt,
        viewport: view, wallAggregationDollars: 50 };
      await save();
      const coldEnd = performance.now();
      const coldFrameEnd = await frameMark(page);
      const coldDiagnostics = await stats(page, { refreshWorker: true });
      await network.flush();
      const coldRequests = requestSummary(network.records, coldStart);
      const firstRange = activeWallSubscription(coldDiagnostics.worker?.orderWalls, id)?.range;
      const firstHistoryQuery = network.records.find(record => record.kind === 'wall-depth-history' || record.kind === 'heatmap-history')?.query;
      const coldRange = firstRange ?? (firstHistoryQuery ? { from: Number(firstHistoryQuery.from), to: Number(firstHistoryQuery.to) } : null);
      const coldVisibleTimeRange = await page.evaluate(panelId => window.__terminal.panels.get(panelId).engine.visibleTimeRange(), id);
      const cold = { loads, worker: coldDiagnostics.worker?.orderWalls, historyApply: coldDiagnostics.historyApply,
        requests: coldRequests, apiQueryBounds: historyQueryBounds(network.records, coldStart),
        visibleTimeRange: coldVisibleTimeRange, durationMs: Math.round(coldEnd - coldStart) };
      result.inProgress = { scenario: scenario.id, sample, phase: 'cold-complete', startedAt: sampleStartedAt,
        viewport: view, wallAggregationDollars: 50, cold };
      await save();
      const warmVisibleRangeMs = coldVisibleTimeRange && { from: coldVisibleTimeRange.from * 1000, to: coldVisibleTimeRange.to * 1000 };
      const warmFrozenNow = Date.now();
      let warmStart = null, warmStartedAt = null, warmRangeRestore = null, warmFrameStart = null, warmFrameEnd = null;
      if ((scenario.walls || scenario.heatmap) && (!coldRange || !warmVisibleRangeMs
        || !Number.isFinite(warmVisibleRangeMs.from) || !Number.isFinite(warmVisibleRangeMs.to))) {
        const cold = { loads, worker: coldDiagnostics.worker?.orderWalls, historyApply: coldDiagnostics.historyApply,
          requests: coldRequests, apiQueryBounds: historyQueryBounds(network.records, coldStart),
          visibleTimeRange: coldVisibleTimeRange, durationMs: Math.round(coldEnd - coldStart) };
        await recordStagingStop({ page, scenario, sample, sampleStartedAt, sourceHashesBefore, hostBefore,
          runtime, runtimeBaseline, errors, network, id, view, cold,
          reason: 'Cold feature history and visible-time bounds were not available for warm replay validation' });
        return;
      }
      if (scenario.walls || scenario.heatmap) {
        await page.evaluate(value => {
          if (!window.__orderWallsRealDateNow) window.__orderWallsRealDateNow = Date.now.bind(Date);
          Date.now = () => value;
        }, warmFrozenNow);
        warmRangeRestore = await restoreStagingViewport(page, id, warmVisibleRangeMs, view.priceRange);
        if (!warmRangeRestore.stable) {
          const cold = { loads, worker: coldDiagnostics.worker?.orderWalls, historyApply: coldDiagnostics.historyApply,
            requests: coldRequests, apiQueryBounds: historyQueryBounds(network.records, coldStart),
            visibleTimeRange: coldVisibleTimeRange, durationMs: Math.round(coldEnd - coldStart) };
          await recordStagingStop({ page, scenario, sample, sampleStartedAt, sourceHashesBefore, hostBefore,
            runtime, runtimeBaseline, errors, network, id, view, cold,
            warm: { sameViewportReplayAttempt: false, frozenPageNowMs: warmFrozenNow,
              visibleTimeBoundsMs: warmVisibleRangeMs, sameViewportRestore: warmRangeRestore },
            reason: 'Could not restore and verify the same staging visible time bounds for the warm replay attempt' });
          return;
        }
        warmStart = performance.now(); warmStartedAt = new Date().toISOString();
        warmFrameStart = await frameMark(page);
        for (const [enabled, name, definitionId] of [[scenario.walls, 'Order Walls', 'native.order-walls'], [scenario.heatmap, 'Order-book Heatmap', 'native.orderbook-heatmap']]) {
          if (!enabled) continue;
          await panel.locator(`.active-indicator[data-definition-id="${definitionId}"]`).getByRole('button', { name: `Remove ${name}`, exact: true }).click();
        }
        const warmLoads = [];
        for (const [feature, enabled, name] of [
          ['orderWalls', scenario.walls, 'Order Walls'], ['heatmap', scenario.heatmap, 'Order-book Heatmap'],
        ]) if (enabled) {
          const startPerf = performance.now(), startAt = new Date().toISOString();
          await addIndicator(panel, name);
          if (feature === 'orderWalls') await setWallAggregation(panel, 50);
          const loadResult = await waitFeature(page, id, feature, startPerf, timeoutMs, async progress => {
            result.inProgress = { scenario: scenario.id, sample, phase: 'warm', feature, startedAt: startAt,
              viewport: view, wallAggregationDollars: 50, cold, progress };
            await save();
            console.log(JSON.stringify({ mode, event: 'staging-load-progress', scenario: scenario.id, sample,
              phase: 'warm', feature, ...progress }));
          });
          const load = { feature, ...loadResult, requests: requestSummary(network.records, startPerf) };
          result.inProgress = { scenario: scenario.id, sample, phase: 'warm', feature, startedAt: startAt,
            viewport: view, wallAggregationDollars: 50, cold, progress: load };
          await save();
          warmLoads.push(load);
          if (!load.complete) {
            const warmDiagnostics = await stats(page, { refreshWorker: true });
            const warm = { startedAt: warmStartedAt, durationMs: Math.round(performance.now() - warmStart),
              sameViewportReplayAttempt: true, sameViewportRestore: warmRangeRestore,
              visibleTimeBoundsMs: warmVisibleRangeMs, frozenPageNowMs: warmFrozenNow,
              apiQueryBounds: historyQueryBounds(network.records, warmStart),
              workerCacheHits: { before: coldDiagnostics.worker?.orderWalls?.cacheHits ?? null,
                after: warmDiagnostics.worker?.orderWalls?.cacheHits ?? null,
                delta: (warmDiagnostics.worker?.orderWalls?.cacheHits ?? 0) - (coldDiagnostics.worker?.orderWalls?.cacheHits ?? 0) },
              loads: warmLoads, worker: warmDiagnostics.worker?.orderWalls, historyApply: warmDiagnostics.historyApply,
              requests: requestSummary(network.records, warmStart) };
            const cold = { loads, worker: coldDiagnostics.worker?.orderWalls, historyApply: coldDiagnostics.historyApply,
              requests: coldRequests, apiQueryBounds: historyQueryBounds(network.records, coldStart),
              visibleTimeRange: coldVisibleTimeRange, durationMs: Math.round(coldEnd - coldStart) };
            const diagnosticFresh = load.workerDiagnostics?.freshWithin10s === true;
            await recordStagingStop({ page, scenario, sample, sampleStartedAt, sourceHashesBefore, hostBefore,
              runtime, runtimeBaseline, errors, network, id, view, cold, warm,
              reason: diagnosticFresh
                ? `${feature} warm reattach did not reach promoted complete history before its bounded load deadline`
                : `${feature} warm reattach did not reach promoted complete history before its bounded load deadline; worker diagnostics ACK was not fresh` });
            return;
          }
        }
        await page.evaluate(() => { if (window.__orderWallsRealDateNow) Date.now = window.__orderWallsRealDateNow; });
        await page.waitForTimeout(250);
        const warmDiagnostics = await stats(page, { refreshWorker: true });
        warmFrameEnd = await frameMark(page);
        const warm = { startedAt: warmStartedAt, durationMs: Math.round(performance.now() - warmStart),
          sameViewportReplayAttempt: true, sameViewportRestore: warmRangeRestore,
          visibleTimeBoundsMs: warmVisibleRangeMs, frozenPageNowMs: warmFrozenNow,
          apiQueryBounds: historyQueryBounds(network.records, warmStart),
          workerCacheHits: { before: coldDiagnostics.worker?.orderWalls?.cacheHits ?? null, after: warmDiagnostics.worker?.orderWalls?.cacheHits ?? null,
            delta: (warmDiagnostics.worker?.orderWalls?.cacheHits ?? 0) - (coldDiagnostics.worker?.orderWalls?.cacheHits ?? 0) },
          loads: warmLoads, worker: warmDiagnostics.worker?.orderWalls, historyApply: warmDiagnostics.historyApply,
          requests: requestSummary(network.records, warmStart) };
        result.inProgress = { scenario: scenario.id, sample, phase: 'post-warm', startedAt: sampleStartedAt,
          viewport: view, wallAggregationDollars: 50, cold, warm };
        await save();
        const liveAndPan = await exerciseStaging(page, id, scenario, network, liveMs);
        const rollover = scenario.id === 'candles-both' && sample === samples ? await waitForRollover(page, id, 70000) : null;
        await network.flush();
        const finalDiagnostics = await stats(page, { refreshWorker: true });
        const sourceHashesAfter = await sourceFingerprint(), runtimeStability = runtimeChanges(runtime, runtimeBaseline), hostAfter = hostState();
        const probe = await stopFrameProbe(page);
        const image = `artifacts/order-walls/staging-${slug(scenario.id)}-sample-${sample}.png`;
        await page.screenshot({ path: image, fullPage: true });
        const item = {
          scenario: scenario.id, sample, source: 'actual staging mode and live Binance USD-M perpetual source',
          timerBoundary: 'new ephemeral browser context; candle chart live; fixed 12-minute logical viewport and fixed price bounds; cold timer starts before the first native indicator attach and includes applying fixed $50 wall aggregation',
          sourceHashesBefore, sourceHashesAfter,
          stability: { sourceStable: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter), ...runtimeStability,
            valid: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter) && runtimeStability.stable },
          host: { before: hostBefore, after: hostAfter }, wallAggregationDollars: 50,
          startedAt: sampleStartedAt,
          viewport: view,
          cold,
          warm, liveAndPan, rollover,
          final: { panels: finalDiagnostics.panels.map(p => ({ series: p.series, candleState: p.status?.state,
            latestCandle: p.last?.t ?? null, wall: p.orderWalls, heatmap: p.heatmap })), worker: finalDiagnostics.worker,
            historyApply: finalDiagnostics.historyApply, longTasks: finalDiagnostics.longTasks },
          frames: frameSummary(probe), phaseFrames: { cold: framesBetween(probe, coldFrameStart, coldFrameEnd),
            warm: warmFrameStart && warmFrameEnd ? framesBetween(probe, warmFrameStart, warmFrameEnd) : null,
            panZoom: framesBetween(probe, liveAndPan.frameMarks.panStart, liveAndPan.frameMarks.panEnd),
            steadyHold: framesBetween(probe, liveAndPan.frameMarks.steadyStart, liveAndPan.frameMarks.steadyEnd) }, screenshot: image, errors,
          requests: requestSummary(network.records),
        };
        // Keep a single sample-level timer and the exact per-feature boundaries in `loads`.
        delete result.inProgress;
        result.cases.push(item); await save();
        if (!item.stability.valid) {
          result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability };
          await save();
          return;
        }
        if (scenario.id === 'candles-both' && sample === samples) {
          item.footprintCoexistence = await footprintCoexistence(page, panel, id, errors);
          await save();
        }
        console.log(JSON.stringify({ mode, scenario: scenario.id, sample,
          coldLoads: loads.map(load => ({ feature: load.feature, firstVisibleMs: load.firstVisibleMs,
            coverageCompleteMs: load.coverageCompleteMs, terminalMs: load.terminalMs,
            historyCompleteMs: load.historyCompleteMs, complete: load.complete })),
          warmCacheHits: warm.workerCacheHits.delta, liveMs: liveAndPan.liveWindowMs, frames: item.frames, screenshot: image }));
      } else {
        result.inProgress = { scenario: scenario.id, sample, phase: 'live-pan-rollover', startedAt: sampleStartedAt,
          viewport: view, wallAggregationDollars: 50 };
        await save();
        const liveAndPan = await exerciseStaging(page, id, scenario, network, liveMs);
        const rollover = scenario.id === 'candles-both' && sample === samples ? await waitForRollover(page, id, 70000) : null;
        await network.flush();
        const finalDiagnostics = await stats(page, { refreshWorker: true });
        const sourceHashesAfter = await sourceFingerprint(), runtimeStability = runtimeChanges(runtime, runtimeBaseline), hostAfter = hostState();
        const probe = await stopFrameProbe(page);
        const image = `artifacts/order-walls/staging-${slug(scenario.id)}-sample-${sample}.png`;
        await page.screenshot({ path: image, fullPage: true });
        const item = { scenario: scenario.id, sample, source: 'actual staging mode and live Binance USD-M perpetual candles',
          timerBoundary: 'new ephemeral browser context through chart setup; fixed 12-minute logical viewport and fixed price bounds',
          sourceHashesBefore, sourceHashesAfter,
          stability: { sourceStable: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter), ...runtimeStability,
            valid: JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter) && runtimeStability.stable },
          host: { before: hostBefore, after: hostAfter }, wallAggregationDollars: 50,
          startedAt: sampleStartedAt,
          viewport: view, cold: { loads: [], worker: initialDiagnostics.worker?.orderWalls, historyApply: initialDiagnostics.historyApply, requests: requestSummary(network.records), durationMs: 0 },
          warm: null, liveAndPan, rollover,
          final: { panels: finalDiagnostics.panels.map(p => ({ series: p.series, candleState: p.status?.state, latestCandle: p.last?.t ?? null,
            wall: p.orderWalls, heatmap: p.heatmap })), worker: finalDiagnostics.worker, historyApply: finalDiagnostics.historyApply, longTasks: finalDiagnostics.longTasks },
          frames: frameSummary(probe), phaseFrames: { cold: framesBetween(probe, coldFrameStart, coldFrameEnd),
            panZoom: framesBetween(probe, liveAndPan.frameMarks.panStart, liveAndPan.frameMarks.panEnd),
            steadyHold: framesBetween(probe, liveAndPan.frameMarks.steadyStart, liveAndPan.frameMarks.steadyEnd) },
          screenshot: image, errors, requests: requestSummary(network.records) };
        delete result.inProgress;
        result.cases.push(item); await save();
        if (!item.stability.valid) {
          result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability };
          await save();
          return;
        }
        console.log(JSON.stringify({ mode, scenario: scenario.id, sample, liveMs: liveAndPan.liveWindowMs, frames: item.frames, screenshot: image }));
      }
    } catch (error) {
      await network.flush();
      const latestSnapshot = await stats(page).catch(() => null);
      const sourceHashesAfter = await sourceFingerprint();
      const sourceStable = JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter);
      const runtimeStability = runtimeBaseline ? runtimeChanges(runtime, runtimeBaseline) : null;
      const valid = sourceStable && (runtimeStability?.stable ?? true);
      const image = `artifacts/order-walls/staging-${slug(scenario.id)}-sample-${sample}-error.png`;
      try { await page.screenshot({ path: image, fullPage: true }); } catch { /* preserve the record when renderer capture is unavailable */ }
      const item = { scenario: scenario.id, sample, failed: error instanceof Error ? error.message : String(error), errors,
        diagnosticClass: error instanceof Error && /diagnostics ACK|Timeout 2000ms/.test(error.message)
          ? 'worker-diagnostics-ack-or-timeout' : 'harness-or-page-error',
        inProgressAtFailure: result.inProgress ?? null,
        latestPanelSnapshot: latestSnapshot ? { panels: latestSnapshot.panels,
          workerDiagnostics: latestSnapshot.workerDiagnostics, historyApply: latestSnapshot.historyApply,
          heapBytes: latestSnapshot.heapBytes } : null,
        screenshot: image,
        sourceHashesBefore, sourceHashesAfter, stability: { sourceStable, ...(runtimeStability ?? {}), valid },
        requests: requestSummary(network.records) };
      result.cases.push(item);
      result.stopReason = `Stopped at ${scenario.id} after ${item.diagnosticClass}: ${item.failed}`;
      delete result.inProgress;
      await save(); console.error(JSON.stringify({ scenario: scenario.id, sample, failed: item.failed,
        diagnosticClass: item.diagnosticClass, screenshot: image, stable: item.stability.valid }));
      if (!valid) result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability };
      return;
    } finally {
      await network.flush(); await context.close();
    }
  }
}

async function recordStagingStop({ page, scenario, sample, sampleStartedAt, sourceHashesBefore, hostBefore,
  runtime, runtimeBaseline, errors, network, id, view, cold, warm = null, reason }) {
  await network.flush();
  const finalDiagnostics = await stats(page).catch(() => null);
  const sourceHashesAfter = await sourceFingerprint();
  const runtimeStability = runtimeBaseline ? runtimeChanges(runtime, runtimeBaseline) : null;
  const hostAfter = hostState();
  const image = `artifacts/order-walls/staging-${slug(scenario.id)}-sample-${sample}-incomplete.png`;
  try { await page.screenshot({ path: image, fullPage: true }); } catch { /* keep diagnostic record even if the page is closing */ }
  const sourceStable = JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter);
  const item = { scenario: scenario.id, sample, source: 'actual staging mode and live Binance USD-M perpetual source',
    startedAt: sampleStartedAt, timerBoundary: 'new browser context; fixed 12-minute logical viewport and fixed price bounds; fixed $50 wall aggregation',
    sourceHashesBefore, sourceHashesAfter,
    stability: { sourceStable, ...(runtimeStability ?? {}), valid: sourceStable && (runtimeStability?.stable ?? true) },
    host: { before: hostBefore, after: hostAfter }, wallAggregationDollars: 50, viewport: view,
    failed: reason, cold, warm,
    final: finalDiagnostics ? { panels: finalDiagnostics.panels.map(panel => ({ series: panel.series, candleState: panel.status?.state,
      latestCandle: panel.last?.t ?? null, wall: panel.orderWalls, heatmap: panel.heatmap })), worker: finalDiagnostics.worker,
      workerDiagnostics: finalDiagnostics.workerDiagnostics, historyApply: finalDiagnostics.historyApply,
      longTasks: finalDiagnostics.longTasks } : null,
    screenshot: image, errors, requests: requestSummary(network.records) };
  result.cases.push(item);
  result.stopReason = reason;
  if (result.inProgress) item.inProgressAtStop = result.inProgress;
  delete result.inProgress;
  if (!item.stability.valid) result.invalidatedAt = { scenario: scenario.id, sample, stability: item.stability, reason };
  await save();
  console.error(JSON.stringify({ mode, scenario: scenario.id, sample, stopped: reason,
    stable: item.stability.valid, screenshot: image }));
}

async function footprintCoexistence(page, panel, panelId, errors) {
  const started = performance.now();
  const errorIndex = errors.length;
  const smokeScreenshot = 'artifacts/order-walls/staging-both-footprint-coexistence.png';
  const record = { scope: 'functional coexistence smoke after the measured candles + walls + heatmap case; excluded from performance timing',
    startedAt: new Date().toISOString(), passed: false, screenshot: smokeScreenshot };
  try {
    await addIndicator(panel, 'Footprint');
    await page.waitForFunction(id => {
      const state = window.__terminal.panels.get(id)?.diagnostics();
      return state?.footprint?.initialViewSet && state.footprint.bars > 0 && state.footprint.surfaceMounted;
    }, panelId, { timeout: 60000 });
    await page.waitForTimeout(250);
    const diagnostics = await page.evaluate(id => {
      const panel = window.__terminal.panels.get(id), state = panel?.diagnostics();
      return {
        activeIndicators: panel?.selection?.indicators?.map(value => value.definitionId) ?? [],
        footprint: state?.footprint,
        orderWalls: state?.orderWalls,
        heatmap: state?.heatmap,
      };
    }, panelId);
    const active = new Set(diagnostics.activeIndicators);
    record.diagnostics = diagnostics;
    record.passed = active.has('native.footprint') && active.has('native.order-walls')
      && active.has('native.orderbook-heatmap') && diagnostics.footprint.bars > 0
      && diagnostics.footprint.surfaceMounted && diagnostics.orderWalls.mounted
      && diagnostics.heatmap.mounted && diagnostics.heatmap.bins > 0;
    record.elapsedMs = Math.round(performance.now() - started);
    record.pageErrors = errors.slice(errorIndex);
    await page.screenshot({ path: smokeScreenshot, fullPage: true });
  } catch (error) {
    record.elapsedMs = Math.round(performance.now() - started);
    record.error = error instanceof Error ? error.message : String(error);
    record.pageErrors = errors.slice(errorIndex);
  }
  return record;
}

async function setWallAggregation(panel, dollars) {
  await panel.getByRole('button', { name: 'Order Walls settings', exact: true }).click();
  const settings = panel.locator('dialog.order-walls-settings');
  await settings.getByLabel('Price aggregation', { exact: true }).selectOption(String(dollars));
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function chooseChartMarket(panel, label) {
  await panel.getByRole('button', { name: 'Chart market', exact: true }).click();
  const picker = panel.locator('.market-picker');
  await picker.getByRole('radio', { name: label, exact: true }).check();
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function waitFeature(page, id, feature, startPerf, timeout, onProgress = async () => {}) {
  let firstVisibleMs = null, dataAtMs = null, coverageCompleteMs = null, terminalMs = null, historyCompleteMs = null;
  let last = null, completed = false, lastProgressAt = 0, lastProgressState = '';
  const startedAt = performance.now();
  const ackBaseline = await page.evaluate(() => window.__orderWallsDiagnosticsProbe?.ackSeq ?? 0);
  while (performance.now() - startedAt < timeout) {
    const value = await stats(page, { refreshWorker: true });
    const snapshot = await page.evaluate(({ panelId, value }) => {
      const p = window.__terminal.panels.get(panelId), d = p.diagnostics(), feed = window.__terminal.feed;
      const worker = value.worker?.orderWalls;
      const prefix = `order-walls:${panelId}:`;
      const wallSub = (worker?.subscriptions ?? []).filter(sub => sub.market === 'binance-perp' && sub.id?.startsWith(prefix))
        .sort((a, b) => (b.generation ?? -1) - (a.generation ?? -1))[0] ?? null;
      const heatGroup = value.worker?.heatmap?.groups?.find(group => group.market === 'perpetual');
      return { wall: d.orderWalls, heatmap: d.heatmap, worker: worker ? { ...worker, selectedSubscription: wallSub } : null,
        heatGroup, historyApply: value.historyApply, workerDiagnostics: value.workerDiagnostics };
    }, { panelId: id, value });
    last = snapshot;
    const metric = feature === 'orderWalls' ? snapshot.wall : snapshot.heatmap;
    const isVisible = feature === 'orderWalls' ? (metric?.visible ?? 0) > 0 : (metric?.bins ?? 0) > 0;
    const hasData = feature === 'orderWalls' ? (metric?.retainedSegments ?? 0) > 0 : (metric?.bytes ?? 0) > 0;
    const workerFresh = (snapshot.workerDiagnostics?.ackSeq ?? 0) > ackBaseline
      && snapshot.workerDiagnostics?.freshWithin10s === true;
    const terminal = workerFresh && (feature === 'orderWalls'
      ? snapshot.worker?.selectedSubscription?.initialized === true && snapshot.worker?.selectedSubscription?.busy === false
      : snapshot.heatGroup?.loading === false && Boolean(metric?.status));
    const coverageComplete = feature === 'orderWalls'
      ? metric?.status?.coverage?.complete === true && metric?.status?.state === 'live'
      : metric?.status?.state === 'live';
    const complete = feature === 'orderWalls'
      ? terminal && coverageComplete && metric?.status?.provisional !== true
      : terminal && coverageComplete;
    const now = performance.now();
    if (hasData && dataAtMs === null) dataAtMs = Math.round(now - startPerf);
    if (isVisible && firstVisibleMs === null) firstVisibleMs = Math.round(now - startPerf);
    if (coverageComplete && coverageCompleteMs === null) coverageCompleteMs = Math.round(now - startPerf);
    if (terminal && terminalMs === null) terminalMs = Math.round(now - startPerf);
    if (complete && historyCompleteMs === null) historyCompleteMs = Math.round(now - startPerf);
    const progress = {
      elapsedMs: Math.round(now - startPerf), firstVisibleMs, firstDataMs: dataAtMs,
      coverageCompleteMs, terminalMs, historyCompleteMs, complete,
      panel: { state: metric?.status?.state ?? null, provisional: metric?.status?.provisional ?? null,
        coverageComplete: metric?.status?.coverage?.complete ?? null, coveragePartial: metric?.status?.coverage?.partial ?? null,
        retained: feature === 'orderWalls' ? metric?.retainedSegments ?? 0 : metric?.bytes ?? 0,
        visible: feature === 'orderWalls' ? metric?.visible ?? 0 : metric?.bins ?? 0 },
      worker: { fresh: workerFresh, ackSeq: snapshot.workerDiagnostics?.ackSeq ?? 0,
        ackAgeMs: snapshot.workerDiagnostics?.ackAgeMs ?? null, pending: snapshot.workerDiagnostics?.pending ?? false,
        timedOutRequests: snapshot.workerDiagnostics?.timedOutRequests ?? 0,
        pages: snapshot.worker?.pages ?? null, records: snapshot.worker?.records ?? null,
        cursor: snapshot.worker?.selectedSubscription?.cursor ?? snapshot.worker?.cursor ?? null,
        watermark: snapshot.worker?.selectedSubscription?.watermark ?? snapshot.worker?.watermark ?? null,
        generation: snapshot.worker?.selectedSubscription?.generation ?? null,
        initialized: snapshot.worker?.selectedSubscription?.initialized ?? null,
        busy: snapshot.worker?.selectedSubscription?.busy ?? null,
        cacheHits: snapshot.worker?.cacheHits ?? null, replayMs: snapshot.worker?.replayMs ?? null },
    };
    const progressKey = JSON.stringify(progress);
    if (progressKey !== lastProgressState && (now - lastProgressAt >= 1000 || firstVisibleMs !== null || coverageCompleteMs !== null)) {
      lastProgressState = progressKey;
      lastProgressAt = now;
      await onProgress(progress);
    } else if (now - lastProgressAt >= 10000) {
      lastProgressState = progressKey;
      lastProgressAt = now;
      await onProgress(progress);
    }
    const terminalFailure = terminal && !['loading', 'syncing', 'live'].includes(metric?.status?.state);
    if (complete || terminalFailure) { completed = true; break; }
    await page.waitForTimeout(200);
  }
  const workerFresh = (last?.workerDiagnostics?.ackSeq ?? 0) > ackBaseline
    && last?.workerDiagnostics?.freshWithin10s === true;
  const finalTerminal = workerFresh && (feature === 'orderWalls'
    ? last?.worker?.selectedSubscription?.initialized === true && last?.worker?.selectedSubscription?.busy === false
    : last?.heatGroup?.loading === false && Boolean(last?.heatmap?.status));
  const finalCoverageComplete = feature === 'orderWalls'
    ? last?.wall?.status?.coverage?.complete === true && last?.wall?.status?.state === 'live'
    : last?.heatmap?.status?.state === 'live';
  const finalComplete = feature === 'orderWalls'
    ? finalTerminal && finalCoverageComplete && last?.wall?.status?.provisional !== true
    : finalTerminal && finalCoverageComplete;
  return { firstVisibleMs, firstDataMs: dataAtMs, coverageCompleteMs, terminalMs, historyCompleteMs,
    completed, timedOut: !completed, coverageComplete: finalCoverageComplete, terminal: finalTerminal,
    complete: finalComplete, endStatus: feature === 'orderWalls' ? last?.wall?.status : last?.heatmap?.status,
    worker: last?.worker, workerDiagnostics: last?.workerDiagnostics, heatGroup: last?.heatGroup,
    historyApply: last?.historyApply };
}

async function exerciseStaging(page, id, scenario, network, liveWindowMs) {
  const before = await stats(page, { refreshWorker: true });
  const wallBefore = activeWallSubscription(before.worker?.orderWalls, id);
  const viewportBefore = await page.evaluate(panelId => {
    const p = window.__terminal.panels.get(panelId), e = p.engine;
    return { range: e.visibleRange(), spacing: e.chart.timeScale.barSpacing, price: e.chart.panes()[0].priceScale.priceRange(), last: p.diagnostics().last?.t ?? null };
  }, id);
  const panFrameStart = await frameMark(page);
  const panStart = performance.now(), requestMark = network.records.length;
  await page.evaluate(({ panelId, range, spacing }) => {
    const e = window.__terminal.panels.get(panelId).engine;
    e.setRange({ from: range.from - 2, to: range.to - 2 }); e.zoom(1.1);
    window.__orderWallsPan = { panelId, range, spacing };
  }, { panelId: id, range: viewportBefore.range, spacing: viewportBefore.spacing });
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const { panelId, range, spacing } = window.__orderWallsPan, e = window.__terminal.panels.get(panelId).engine;
    e.setRange(range); e.zoom(spacing / e.chart.timeScale.barSpacing);
  });
  await page.waitForTimeout(500);
  const panZoomMs = Math.round(performance.now() - panStart);
  const panFrameEnd = await frameMark(page);
  const panRequests = requestSummary(network.records.slice(requestMark));
  const steadyFrameStart = await frameMark(page);
  const holdStart = performance.now(), holdStartedAt = new Date().toISOString(), samples = [];
  const endAt = holdStart + liveWindowMs;
  while (performance.now() < endAt) {
    const value = await stats(page, { refreshWorker: true });
    const panel = panelState(value, id);
    samples.push({ atMs: Math.round(performance.now() - holdStart), candleState: panel?.status?.state,
      latestCandle: panel?.last?.t ?? null, wallState: panel?.orderWalls?.status?.state ?? null,
      wallCoverageComplete: panel?.orderWalls?.status?.coverage?.complete ?? null, wallSegments: panel?.orderWalls?.retainedSegments ?? 0,
      visibleWalls: panel?.orderWalls?.visible ?? 0, wallDraws: panel?.orderWalls?.draws ?? 0,
      heatmapState: panel?.heatmap?.status?.state ?? null, heatmapBins: panel?.heatmap?.bins ?? 0,
      heatmapDraws: panel?.heatmap?.draws ?? 0,
      wallReplayMs: value.worker?.orderWalls?.replayMs ?? null,
      wallRecords: value.worker?.orderWalls?.records ?? null,
      wallCacheBytes: value.worker?.orderWalls?.cacheBytes ?? null,
      wallRange: value.worker?.orderWalls?.subscriptions?.filter(subscription => subscription.market === 'binance-perp'
        && subscription.id?.startsWith(`order-walls:${id}:`)).sort((a, b) => (b.generation ?? -1) - (a.generation ?? -1))[0]?.range ?? null,
      wallCursor: value.worker?.orderWalls?.subscriptions?.filter(subscription => subscription.market === 'binance-perp'
        && subscription.id?.startsWith(`order-walls:${id}:`)).sort((a, b) => (b.generation ?? -1) - (a.generation ?? -1))[0]?.cursor ?? null });
    await page.waitForTimeout(700);
  }
  const steadyFrameEnd = await frameMark(page);
  const after = await stats(page, { refreshWorker: true });
  const wallAfter = activeWallSubscription(after.worker?.orderWalls, id);
  return { panZoom: { durationMs: panZoomMs, requests: panRequests, viewportBefore,
    viewportAfter: await page.evaluate(panelId => { const p = window.__terminal.panels.get(panelId); return { range: p.engine.visibleRange(), time: p.engine.visibleTimeRange(), price: p.engine.chart.panes()[0].priceScale.priceRange() }; }, id) },
    frameMarks: { panStart: panFrameStart, panEnd: panFrameEnd, steadyStart: steadyFrameStart, steadyEnd: steadyFrameEnd },
    holdStartedAt, liveWindowMs: Math.round(performance.now() - holdStart), liveSamples: samples,
    workerHorizon: { before: wallBefore ?? null, after: wallAfter ?? null,
      toAdvanceMs: wallBefore && wallAfter ? wallAfter.range.to - wallBefore.range.to : null,
      cursorAdvance: wallBefore && wallAfter ? wallAfter.cursor - wallBefore.cursor : null },
    updateCounters: {
      wallPages: (after.worker?.orderWalls?.pages ?? 0) - (before.worker?.orderWalls?.pages ?? 0),
      wallRecords: (after.worker?.orderWalls?.records ?? 0) - (before.worker?.orderWalls?.records ?? 0),
      wallReplayMs: (after.worker?.orderWalls?.replayMs ?? 0) - (before.worker?.orderWalls?.replayMs ?? 0),
      wallBytes: (after.worker?.orderWalls?.bytes ?? 0) - (before.worker?.orderWalls?.bytes ?? 0),
      wallBatchApplyMs: (after.historyApply?.orderWallsMs ?? 0) - (before.historyApply?.orderWallsMs ?? 0),
      wallBatches: (after.historyApply?.orderWallsBatches ?? 0) - (before.historyApply?.orderWallsBatches ?? 0),
      heatmapBatchApplyMs: (after.historyApply?.heatmapMs ?? 0) - (before.historyApply?.heatmapMs ?? 0),
      heatmapBatches: (after.historyApply?.heatmapBatches ?? 0) - (before.historyApply?.heatmapBatches ?? 0),
    },
  };
}

async function waitForRollover(page, id, timeoutMs) {
  const before = await page.evaluate(panelId => {
    const p = window.__terminal.panels.get(panelId);
    return { candle: p.diagnostics().last?.t ?? null, wall: p.diagnostics().orderWalls.status, heatmap: p.diagnostics().heatmap.status };
  }, id);
  const startedAt = new Date().toISOString(), startPerf = performance.now();
  try {
    await page.waitForFunction(({ panelId, candle }) => {
      const current = window.__terminal.panels.get(panelId)?.diagnostics().last?.t;
      return Number.isFinite(current) && current > candle;
    }, { panelId: id, candle: before.candle }, { timeout: timeoutMs });
  } catch { /* report an unobserved rollover rather than making it an acceptance claim */ }
  await page.waitForTimeout(1200);
  const after = await page.evaluate(panelId => {
    const p = window.__terminal.panels.get(panelId), d = p.diagnostics();
    return { candle: d.last?.t ?? null, candleState: d.status?.state, wall: d.orderWalls, heatmap: d.heatmap,
      visibleRange: p.engine.visibleTimeRange(), priceRange: p.engine.chart.panes()[0].priceScale.priceRange() };
  }, id);
  return { startedAt, observed: after.candle !== null && before.candle !== null && after.candle > before.candle,
    durationMs: Math.round(performance.now() - startPerf), before, after };
}

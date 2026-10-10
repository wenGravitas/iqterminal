import { launch, url } from './browser.mjs';
import { writeFile } from 'node:fs/promises';

const browser = await launch(false);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const heap = await page.context().newCDPSession(page);
await heap.send('HeapProfiler.enable');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${url}/?fixture=1&fixtureTime=now`);
await page.waitForFunction(() => window.__terminal?.stats().panels.length === 2 && window.__terminal.stats().panels.every(panel => panel.bars === 5000));

const metadata = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, cores: navigator.hardwareConcurrency }));
const editorOpenedAt = Date.now();
await page.getByRole('button', { name: 'Indicators' }).first().click();
await page.locator('.script-editor-panel').waitFor({ state: 'visible' });
const editorOpenMs = Date.now() - editorOpenedAt;
const libraryPicker = page.getByRole('combobox', { name: 'Library' });
await libraryPicker.selectOption('builtin.ema-overlay');
await page.getByRole('button', { name: 'Preview inputs' }).click();
await page.waitForFunction(() => document.querySelector('.script-editor-status')?.textContent?.startsWith('Compiled'));
const chartId = await page.evaluate(() => (window.__terminal.dock.panels.find(panel => panel.view.contentComponent === 'candle')).id);
const applyStartedAt = Date.now();
await page.getByRole('button', { name: 'Apply' }).click();
await page.waitForFunction(() => document.querySelector('.script-editor-status')?.textContent === 'Applied. This chart now pins the exact immutable revision.');
const editorApplyMs = Date.now() - applyStartedAt;
await page.evaluate(id => {
  const terminal = window.__terminal;
  terminal.dock.getPanel('script-editor')?.api.close();
  terminal.dock.getPanel(id)?.api.setActive();
}, chartId);

async function setPanels(count) {
  await page.evaluate(count => {
    const terminal = window.__terminal;
    for (const panel of [...terminal.dock.panels]) {
      if (panel.view.contentComponent === 'candle' && terminal.dock.panels.filter(p => p.view.contentComponent === 'candle').indexOf(panel) >= count) panel.api.close();
    }
    const extraSeries = [
      { venue: 'binance', interval: '5m' }, { venue: 'hyperliquid', interval: '5m' },
      { venue: 'binance', interval: '1m' }, { venue: 'hyperliquid', interval: '1m' },
      { venue: 'binance', interval: '5m' }, { venue: 'hyperliquid', interval: '5m' },
    ];
    const charts = terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle');
    while (charts.length < count) {
      const index = charts.length;
      terminal.addChart(index === 1 ? { venue: 'hyperliquid', interval: '1m' } : extraSeries[index - 2]);
      charts.push(terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle').at(-1));
    }
    for (let index = 2; index < charts.length; index++) charts[index].api.moveTo({ group: charts[index - 2].api.group, position: 'below' });
  }, count);
  await page.waitForFunction(count => window.__terminal.stats().panels.length === count && window.__terminal.stats().panels.every(panel => panel.bars === 5000), count);
  await page.waitForTimeout(350);
}

async function prepareStudies(count, plan) {
  await setPanels(count);
  const setupStartedAt = Date.now();
  await page.evaluate(async plan => {
    const terminal = window.__terminal;
    const panels = terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle').map(panel => terminal.panels.get(panel.id));
    for (const panel of panels) for (const view of panel.studies.views()) panel.studies.remove(view.attachmentId);
    await terminal.library.ensureBuiltIns();
    for (const item of plan) {
      const record = await terminal.library.get(item.scriptId);
      const revision = record?.revisions.find(value => value.id === record.currentRevision);
      if (!record || !revision) throw new Error(`Missing benchmark script ${item.scriptId}`);
      await panels[item.panel].studies.apply({
        scriptId: record.id, source: revision.source, title: record.title,
        description: record.description, settings: item.settings ?? {},
      });
    }
  }, plan);
  const setupMs = Date.now() - setupStartedAt;
  await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 1000 }));
  return setupMs;
}

function planEma(count, except = new Set()) {
  return Array.from({ length: count }, (_, panel) => panel).filter(panel => !except.has(panel)).map(panel => ({ panel, scriptId: 'builtin.ema-overlay' }));
}

async function measure(label, count, plan, seconds = 5) {
  const setupMs = await prepareStudies(count, plan);
  if (plan.some(item => item.scriptId === 'builtin.binance-depth-band')) {
    await page.waitForFunction(() => {
      const panel = window.__terminal.panels.values().next().value;
      const view = panel?.studies.views().find(value => value.title === 'Binance depth band');
      return view?.status.startsWith('Depth live');
    }, undefined, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1100);
  }

  // Optional main-thread profile for the requested eight-active-study workload.
  // Keep it separate from the regular timing run because sampling adds overhead.
  const profileEnabled = process.env.BENCH_PROFILE === '1' && label.startsWith('8 charts · EMA on every chart');
  let profiler;
  if (profileEnabled) {
    profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
    await profiler.send('Profiler.start', { callCount: true });
  }

  await page.evaluate(() => {
    const terminal = window.__terminal;
    terminal.resetMetrics();
    window.__benchFrames = [];
    window.__benchPrevious = 0;
    window.__benchRunning = true;
    const sample = time => {
      if (!window.__benchRunning) return;
      if (window.__benchPrevious) window.__benchFrames.push(time - window.__benchPrevious);
      window.__benchPrevious = time;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const start = Date.now();
  let interactions = 0;
  while (Date.now() - start < seconds * 1000) {
    const box = await page.locator('.chart-stage:visible').first().boundingBox();
    if (box) {
      const x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + (interactions % 2 ? -50 : 50), y + (interactions % 2 ? 16 : -16), { steps: 4 });
      await page.mouse.up(); await page.mouse.wheel(0, interactions % 2 ? -24 : 24);
    }
    if (interactions % 4 === 0) await page.setViewportSize({ width: interactions % 8 ? 1366 : 1440, height: 768 });
    interactions++;
  }
  const interactionDurationMs = Date.now() - start;
  let cpuProfileTop = null;
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    const nodes = new Map(profile.nodes.map(node => [node.id, node]));
    const totals = new Map();
    profile.samples.forEach((id, index) => {
      const frame = nodes.get(id)?.callFrame;
      if (!frame) return;
      const file = frame.url.split('/').at(-1) || frame.url;
      const label = `${frame.functionName || '(anonymous)'} · ${file}:${frame.lineNumber + 1}`;
      totals.set(label, (totals.get(label) ?? 0) + (profile.timeDeltas[index] ?? 1000));
    });
    cpuProfileTop = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([functionName, microseconds]) => ({
      functionName, milliseconds: Math.round(microseconds / 1000),
    }));
    await profiler.detach();
  }
  await page.evaluate(() => { window.__benchRunning = false; window.__terminal.feed.send({ type: 'diagnostics' }); });
  await page.waitForTimeout(100);
  const result = await page.evaluate(({ label, setupMs, interactions, interactionDurationMs }) => {
    const stats = window.__terminal.stats();
    const percentile = (values, p) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    };
    const panels = [...window.__terminal.dock.panels]
      .filter(panel => panel.view.contentComponent === 'candle')
      .map(panel => window.__terminal.panels.get(panel.id));
    const studyViews = panels.flatMap(panel => panel.studies.views().map(view => ({
      panelId: panel.diagnostics().id, title: view.title, status: view.status,
      outputTail: view.outputs, diagnostics: view.diagnostics.length,
    })));
    const depth = panels.flatMap(panel => panel.studies.diagnostics().depthBands.map(band => ({ panelId: panel.diagnostics().id, ...band })));
    const frames = window.__benchFrames;
    return {
      label, setupMs, interactions, interactionDurationMs,
      visiblePanels: stats.panels.filter(panel => panel.visible).length,
      panels: stats.panels.map(panel => ({ id: panel.id, visible: panel.visible, bars: panel.bars, last: panel.last, draws: panel.renderer.draws })),
      activeStudyCount: studyViews.length,
      liveStudyWorkers: stats.panels.reduce((sum, panel) => sum + (panel.studies?.workers ?? 0), 0),
      failedStudyCount: studyViews.filter(view => view.diagnostics > 0 || /worker stopped|exceeded 500|calculation exceeded/i.test(view.status)).length,
      studies: studyViews,
      depth,
      fixtureMessages: stats.feed.syntheticMessages,
      longTasks: stats.longTasks,
      memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
      domNodes: document.querySelectorAll('*').length,
      frameMs: {
        samples: frames.length,
        p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), p99: percentile(frames, 0.99),
        max: Math.max(...frames),
      },
    };
  }, { label, setupMs, interactions, interactionDurationMs });
  if (cpuProfileTop) result.cpuProfileTop = cpuProfileTop;
  await heap.send('HeapProfiler.collectGarbage');
  result.mainHeapAfterGc = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 0 }));
  return result;
}

const one = await measure('1 chart · EMA + volume + Binance depth', 1, [
  { panel: 0, scriptId: 'builtin.ema-overlay' },
  { panel: 0, scriptId: 'builtin.volume-histogram' },
  { panel: 0, scriptId: 'builtin.binance-depth-band' },
]);
const two = await measure('2 charts · EMA on both + volume/depth on Binance', 2, [
  { panel: 0, scriptId: 'builtin.ema-overlay' }, { panel: 1, scriptId: 'builtin.ema-overlay' },
  { panel: 0, scriptId: 'builtin.volume-histogram' }, { panel: 0, scriptId: 'builtin.binance-depth-band' },
]);
const eightEma = await measure('8 charts · EMA on every chart (8-worker budget)', 8, planEma(8));
const eightMixed = await measure('8 charts · six EMA + volume/depth on Binance (8-worker budget)', 8, [
  ...planEma(8, new Set([6, 7])),
  { panel: 6, scriptId: 'builtin.volume-histogram' }, { panel: 6, scriptId: 'builtin.binance-depth-band' },
]);

const teardownStartedAt = Date.now();
await page.evaluate(() => {
  const terminal = window.__terminal;
  for (const panel of terminal.panels.values()) for (const view of panel.studies.views()) panel.studies.remove(view.attachmentId);
  for (const panel of [...terminal.dock.panels]) if (panel.view.contentComponent === 'candle' && terminal.dock.panels.filter(value => value.view.contentComponent === 'candle').indexOf(panel) >= 2) panel.api.close();
});
await page.waitForFunction(() => window.__terminal.stats().panels.every(panel => panel.studies?.workers === 0));
const teardownMs = Date.now() - teardownStartedAt;
await page.evaluate(() => window.__terminal.feed.send({ type: 'diagnostics' }));
await page.waitForFunction(() => window.__terminal.feed.diagnostics.depth?.subscribers === 0 && window.__terminal.feed.diagnostics.depth?.sockets === 0, undefined, { timeout: 5_000 }).catch(() => {});
await heap.send('HeapProfiler.collectGarbage');
const heapAfterTeardown = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
const nodesAfterTeardown = await page.evaluate(() => document.querySelectorAll('*').length);
const cycleCounts = [];
for (let i = 0; i < 10; i++) {
  const counts = await page.evaluate(async () => {
    const terminal = window.__terminal;
    const panel = terminal.panels.values().next().value;
    const record = await terminal.library.get('builtin.ema-overlay');
    const revision = record.revisions.find(value => value.id === record.currentRevision);
    const attachmentId = await panel.studies.apply({ scriptId: record.id, source: revision.source, title: record.title, description: record.description, settings: {} });
    const afterAdd = panel.studies.diagnostics().workers;
    panel.studies.remove(attachmentId);
    return { afterAdd, afterRemove: panel.studies.diagnostics().workers, domNodes: document.querySelectorAll('*').length };
  });
  cycleCounts.push(counts);
}
await page.waitForTimeout(150);
await heap.send('HeapProfiler.collectGarbage');
const final = await page.evaluate(() => ({ panels: window.__terminal.stats().panels.length, workers: window.__terminal.stats().panels.reduce((sum, panel) => sum + panel.studies.workers, 0), feed: window.__terminal.feed.diagnostics, domNodes: document.querySelectorAll('*').length }));
final.mainHeapAfterGc = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
const report = {
  mode: 'Supplemental diagnostic workload: explicit timestamp-aligned synthetic candle fixtures plus the genuine live Binance depth service; depth coverage remains snapshot-dependent.',
  browser: browser.version(), metadata, errors, editorOpenMs, editorApplyMs,
  workloads: [one, two, eightEma, eightMixed], teardownMs, heapAfterTeardown, nodesAfterTeardown, cycleCounts, final,
};
const output = process.env.BENCH_STUDIES_OUTPUT ?? 'artifacts/performance-openscript-studies.json';
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, mode: report.mode, browser: report.browser, metadata, errors, editorOpenMs, editorApplyMs, workloads: report.workloads.map(workload => ({ label: workload.label, activeStudyCount: workload.activeStudyCount, liveStudyWorkers: workload.liveStudyWorkers, failedStudyCount: workload.failedStudyCount, visiblePanels: workload.visiblePanels, frameMs: workload.frameMs, longTaskMaxMs: Math.max(0, ...workload.longTasks), heapMiB: workload.memory ? Math.round(workload.memory.used / 1048576 * 10) / 10 : null, mainHeapAfterGcMiB: workload.mainHeapAfterGc === null ? null : Math.round(workload.mainHeapAfterGc / 1048576 * 10) / 10, domNodes: workload.domNodes, fixtureMessages: workload.fixtureMessages, depth: workload.depth })), teardownMs, heapAfterTeardownMiB: heapAfterTeardown === null ? null : Math.round(heapAfterTeardown / 1048576 * 10) / 10, nodesAfterTeardown, cycleCounts, final }, null, 2));
await heap.detach();
await browser.close();

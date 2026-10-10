import { launch, url } from './browser.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await launch(false);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
const renderer = 'canvas2d';
const profileEnabled = process.env.BENCH_PROFILE === '1';
const fixedActions = process.env.BENCH_FIXED_ACTIONS === '1';
const interactionMode = fixedActions ? 'fixed-count' : 'response-paced-wall-clock';
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${url}/?fixture=1`);
await page.waitForFunction(() => window.__terminal?.stats().panels.length === 2 && window.__terminal.stats().panels.every(panel => panel.bars === 5000));
await page.waitForTimeout(1200);

const metadata = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, cores: navigator.hardwareConcurrency }));

async function setPanels(count) {
  await page.evaluate(count => {
    const terminal = window.__terminal;
    const dock = terminal.dock;
    for (const panel of dock.panels.slice(count)) panel.api.close();
    const extraSeries = [
      { venue: 'binance', interval: '5m' },
      { venue: 'hyperliquid', interval: '5m' },
      { venue: 'binance', interval: '1m' },
      { venue: 'hyperliquid', interval: '1m' },
      { venue: 'binance', interval: '5m' },
      { venue: 'hyperliquid', interval: '5m' },
    ];
    while (dock.panels.length < count) {
      const index = dock.panels.length;
      terminal.addChart(index === 1 ? { venue: 'hyperliquid', interval: '1m' } : extraSeries[index - 2]);
    }
    for (let index = 2; index < count; index++) {
      dock.panels[index].api.moveTo({ group: dock.panels[index - 2].api.group, position: 'bottom' });
    }
    if (count === 8) {
      const rowHeight = document.querySelector('#workspace').clientHeight / 4;
      for (const group of new Set(dock.panels.map(panel => panel.api.group))) {
        group.api.setSize({ height: rowHeight });
      }
    }
    terminal.feed.send({ type: 'fixture', rate: 1000 });
  }, count);
  await page.waitForFunction(count => window.__terminal.stats().panels.length === count && window.__terminal.stats().panels.every(panel => panel.bars === 5000), count);
  await page.waitForTimeout(700);
  const geometry = await page.locator('.chart-stage').evaluateAll(stages => stages.map(stage => {
    const rect = stage.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, inViewport: rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 };
  }));
  assert.equal(geometry.length, count);
  assert.ok(geometry.every(stage => stage.inViewport), `Every measured chart must fit in the viewport: ${JSON.stringify(geometry)}`);
  return geometry;
}

async function measure(label, count, seconds) {
  const viewportGeometry = await setPanels(count);
  let cpuProfileTop = null;
  let profiler;
  if (profileEnabled && count === 8) {
    profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
    await profiler.send('Profiler.start', { callCount: true });
  }
  await page.evaluate(() => {
    const terminal = window.__terminal;
    terminal.resetMetrics();
    window.__benchPanelNodes = [...document.querySelectorAll('.candle-panel')];
    window.__benchBefore = terminal.stats().panels.map(panel => panel.renderer);
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
  const interact = async () => {
    const surface = page.locator('.chart-stage:visible').first();
    const box = await surface.boundingBox();
    if (box) {
      const x = box.x + box.width * 0.5;
      const y = box.y + box.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (interactions % 2 ? -70 : 70), y + (interactions % 2 ? -25 : 25), { steps: 5 });
      await page.mouse.up();
      await page.mouse.wheel(0, interactions % 2 ? -30 : 30);
    }
    if (interactions % 4 === 0) await page.setViewportSize({ width: interactions % 8 ? 1366 : 1440, height: 768 });
    interactions++;
  };
  if (fixedActions) {
    for (let action = 0; action < 5; action++) await interact();
  } else {
    while (Date.now() - start < seconds * 1000) await interact();
  }
  const interactionDurationMs = Date.now() - start;
  if (fixedActions) await page.waitForTimeout(seconds * 1000);

  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    const nodes = new Map(profile.nodes.map(node => [node.id, node]));
    const totals = new Map();
    profile.samples.forEach((id, index) => {
      const frame = nodes.get(id)?.callFrame;
      if (!frame) return;
      const label = `${frame.functionName || '(anonymous)'} · ${frame.url.split('/').at(-1) || frame.url}:${frame.lineNumber + 1}`;
      totals.set(label, (totals.get(label) ?? 0) + (profile.timeDeltas[index] ?? 1000));
    });
    cpuProfileTop = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([functionName, microseconds]) => ({ functionName, milliseconds: Math.round(microseconds / 1000) }));
    await profiler.detach();
  }

  await page.evaluate(() => {
    window.__benchRunning = false;
    window.__terminal.feed.send({ type: 'diagnostics' });
  });
  await page.waitForTimeout(100);
  const run = await page.evaluate(label => {
    const stats = window.__terminal.stats();
    const panels = stats.panels;
    const bySeries = new Map();
    for (const panel of panels) {
      const key = `${panel.series.venue}:${panel.series.interval}`;
      const prior = bySeries.get(key);
      if (prior && (prior.last?.c !== panel.last?.c || prior.last?.v !== panel.last?.v)) bySeries.set(key, false);
      else if (!prior) bySeries.set(key, panel);
    }
    return {
      label,
      shellPanelIdentityPreserved: [...document.querySelectorAll('.candle-panel')].every((panel, index) => panel === window.__benchPanelNodes[index]),
      draws: panels.map((panel, index) => (panel.renderer?.draws ?? 0) - (window.__benchBefore[index]?.draws ?? 0)),
      frames: window.__benchFrames,
      panels: panels.map(({ id, visible, bars, renderer, status, series }) => ({ id, visible, bars, renderer, status, series })),
      sharedSeriesAgree: [...bySeries.values()].every(value => value !== false),
      feed: stats.feed,
      longTasks: [...stats.longTasks],
      memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
    };
  }, label);
  run.viewportGeometry = viewportGeometry;

  const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  };
  run.durationMs = Date.now() - start;
  run.interactions = interactions;
  run.interactionMode = interactionMode;
  run.interactionDurationMs = interactionDurationMs;
  run.stressWindowMs = fixedActions ? seconds * 1000 : null;
  run.visiblePanels = run.panels.filter(panel => panel.visible).length;
  if (cpuProfileTop) run.cpuProfileTop = cpuProfileTop;
  run.frameMs = {
    samples: run.frames.length,
    p50: percentile(run.frames, 0.5),
    p95: percentile(run.frames, 0.95),
    p99: percentile(run.frames, 0.99),
    max: Math.max(...run.frames),
  };
  delete run.frames;
  await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 0 }));
  return run;
}

const one = await measure('One visible chart, 5,000-bar deterministic fixtures; 1,000 synthetic wire messages/s', 1, 6);
const two = await measure('Two visible charts on native BTC perpetuals, 5,000 bars each; 1,000 synthetic wire messages/s', 2, 6);
const eight = await measure('Eight visible charts, 5,000 bars each, four shared series; 1,000 synthetic wire messages/s', 8, 10);

const hidden = await page.evaluate(() => {
  const terminal = window.__terminal;
  const hiddenPanel = terminal.dock.panels[7];
  const activePanel = terminal.dock.panels[0];
  hiddenPanel.api.moveTo({ group: terminal.dock.panels[0].api.group, position: 'center' });
  activePanel.api.setActive();
  return { id: hiddenPanel.id };
});
await page.waitForFunction(id => window.__terminal.stats().panels.some(panel => panel.id === id && !panel.visible), hidden.id);
await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 1000 }));
await page.waitForTimeout(300);
await page.evaluate(() => window.__terminal.feed.send({ type: 'diagnostics' }));
await page.waitForTimeout(100);
const hiddenBefore = await page.evaluate(id => {
  const stats = window.__terminal.stats();
  return { ...stats.panels.find(panel => panel.id === id), feed: stats.feed };
}, hidden.id);
await page.waitForTimeout(700);
await page.evaluate(() => window.__terminal.feed.send({ type: 'diagnostics' }));
await page.waitForTimeout(100);
const hiddenAfter = await page.evaluate(id => {
  const stats = window.__terminal.stats();
  return { ...stats.panels.find(panel => panel.id === id), feed: stats.feed };
}, hidden.id);
await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 0 }));
if (hiddenAfter.renderer.draws !== hiddenBefore.renderer.draws) throw new Error('Hidden chart drew during the synthetic feed burst');
if (!(hiddenAfter.feed.syntheticMessages > hiddenBefore.feed.syntheticMessages)) throw new Error('Hidden probe had no synthetic worker messages');
if (hiddenAfter.last?.c === hiddenBefore.last?.c) throw new Error('Hidden chart did not receive a current-candle update');
await page.evaluate(id => window.__terminal.dock.getPanel(id).api.setActive(), hidden.id);
await page.waitForTimeout(200);

await setPanels(2);
const lifecycle = [];
for (let index = 0; index < 10; index++) {
  await page.evaluate(index => {
    const terminal = window.__terminal;
    const existing = new Set(terminal.dock.panels.map(panel => panel.id));
    terminal.addChart({ venue: index % 2 ? 'binance' : 'hyperliquid', interval: '1m' });
    terminal.dock.panels.find(panel => !existing.has(panel.id))?.api.close();
  }, index);
  await page.waitForTimeout(150);
  lifecycle.push(await page.evaluate(() => ({
    panels: window.__terminal.stats().panels.length,
    memory: performance.memory?.usedJSHeapSize ?? null,
  })));
}

await page.evaluate(() => {
  window.__terminal.feed.send({ type: 'fixture', rate: 0 });
  window.__terminal.feed.send({ type: 'diagnostics' });
});
await page.waitForTimeout(150);
const final = await page.evaluate(() => window.__terminal.stats());
const report = {
  mode: `SYNTHETIC candle path, OpenAlgo renderer=${renderer}, production bundle with explicit diagnostic build flag`,
  interactionMode,
  browser: browser.version(),
  metadata,
  errors,
  one,
  two,
  eight,
  hidden: {
    id: hidden.id,
    visibleBefore: hiddenBefore.visible,
    visibleAfter: hiddenAfter.visible,
    drawsBefore: hiddenBefore.renderer.draws,
    drawsAfter: hiddenAfter.renderer.draws,
    drawDelta: hiddenAfter.renderer.draws - hiddenBefore.renderer.draws,
    syntheticMessagesBefore: hiddenBefore.feed.syntheticMessages,
    syntheticMessagesAfter: hiddenAfter.feed.syntheticMessages,
    hiddenCandleCloseBefore: hiddenBefore.last?.c,
    hiddenCandleCloseAfter: hiddenAfter.last?.c,
    hiddenCandleChanged: hiddenAfter.last?.c !== hiddenBefore.last?.c,
  },
  lifecycle,
  final,
};
const output = process.env.BENCH_OUTPUT ?? 'artifacts/performance.json';
await writeFile(output, JSON.stringify(report, null, 2));
const summary = value => ({
  durationMs: value.durationMs,
  interactions: value.interactions,
  visiblePanels: value.visiblePanels,
  frameMs: value.frameMs,
  longTaskCount: value.longTasks.length,
  longTaskMaxMs: Math.max(0, ...value.longTasks),
  heapMiB: value.memory ? Math.round(value.memory.used / 1048576 * 10) / 10 : null,
  backends: [...new Set(value.panels.map(panel => panel.renderer?.backend))],
});
console.log(JSON.stringify({
  output,
  mode: report.mode,
  interactionMode,
  browser: report.browser,
  metadata: report.metadata,
  errors,
  one: summary(one),
  two: summary(two),
  eight: { ...summary(eight), cpuProfileTop: eight.cpuProfileTop },
  hidden: report.hidden,
  lifecycle: lifecycle.map(({ panels }) => ({ panels })),
}, null, 2));
await browser.close();

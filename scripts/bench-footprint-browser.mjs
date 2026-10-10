import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { launch, url } from './browser.mjs';

const browser = await launch(false);
const errors = [];
const results = [];
const profileEnabled = process.env.BENCH_PROFILE === '1';
const selectedCounts = process.env.BENCH_COUNTS
  ? process.env.BENCH_COUNTS.split(',').map(Number)
  : profileEnabled ? [8] : [1, 2, 8];
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function makePage() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url + '/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => window.__terminal?.fixture === true
    && window.__terminal.stats().panels.length === 2
    && window.__terminal.stats().panels.every(panel => panel.bars === 5000));
  const worker = page.workers().find(candidate => candidate.url().includes('worker'));
  assert.ok(worker, 'The real market-data worker is running');
  await installSyntheticSocket(worker);
  return { page, worker };
}

async function installSyntheticSocket(worker) {
  await worker.evaluate(() => {
    const probe = self.__footprintBench = {
      sockets: [], closeCalls: 0, metadataRequests: 0, nextId: 1, lastTime: 0,
      sent: 0, batches: [], baseTime: Math.floor(Date.now() / 60_000) * 60_000 + 10_000,
    };
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      if (!String(input).includes('/fapi/v1/exchangeInfo?symbol=BTCUSDT')) return nativeFetch(input, init);
      probe.metadataRequests++;
      return Promise.resolve(new Response(JSON.stringify({ symbols: [{
        symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL',
        baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT',
        filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }],
      }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    class SyntheticSocket {
      constructor(socketUrl) {
        this.url = socketUrl;
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        probe.sockets.push(this);
      }
      open() { this.readyState = 1; this.onopen?.({}); }
      emit(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        probe.closeCalls++;
      }
      send() {}
    }
    SyntheticSocket.CONNECTING = 0;
    SyntheticSocket.OPEN = 1;
    SyntheticSocket.CLOSING = 2;
    SyntheticSocket.CLOSED = 3;
    globalThis.WebSocket = SyntheticSocket;
    probe.open = () => probe.sockets.forEach(socket => { if (socket.readyState === 0) socket.open(); });
    probe.sendBatch = count => {
      const socket = probe.sockets.find(value => value.readyState === 1);
      if (!socket) throw new Error('Synthetic Binance socket is not open');
      const started = performance.now();
      for (let index = 0; index < count; index++) {
        const id = probe.nextId++;
        const time = probe.baseTime + probe.sent;
        if (time < probe.lastTime) throw new Error('Synthetic exchange timestamps must increase monotonically');
        probe.lastTime = time;
        const price = (840000 + (id % 101)) / 10;
        socket.emit({
          e: 'aggTrade', E: time + 1, T: time, s: 'BTCUSDT',
          a: id, f: id * 2 + 1, l: id * 2 + 2, p: price.toFixed(1),
          q: (0.001 + (id % 4) * 0.001).toFixed(3), m: id % 2 === 0,
        });
        probe.sent++;
      }
      probe.batches.push(performance.now() - started);
    };
    probe.sendPaced = async (batches, batchSize, intervalMs) => {
      const start = performance.now();
      for (let index = 0; index < batches; index++) {
        const target = start + index * intervalMs;
        const delay = target - performance.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        probe.sendBatch(batchSize);
      }
      return { scheduledBatches: batches, observations: batches * batchSize, elapsedMs: performance.now() - start, intervalMs };
    };
  });
}

async function configure(page, worker, count) {
  await page.evaluate(count => {
    const terminal = window.__terminal;
    const panels = terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle');
    for (const panel of panels.slice(count)) panel.api.close();
    while (terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle').length < count) {
      terminal.addChart({ venue: 'binance', market: 'perpetual', interval: '1m' });
    }
    const charts = terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle');
    for (let index = 0; index < charts.length; index++) {
      const panel = terminal.panels.get(charts[index].id);
      const interval = count === 8 ? ['1m', '1m', '1m', '1m', '1m', '1m', '5m', '5m'][index] : '1m';
      panel.instrument.value = 'binance:perpetual';
      panel.interval.value = interval;
      panel.select();
      // Preserve the original benchmark's quote widths after the UI moved from ticks to USDT.
      panel.rowPrice.value = count === 2 ? '1' : (count === 8 ? String([0.1, 0.2, 0.5, 1, 2, 5, 0.1, 0.2][index]) : '1');
      panel.selectRowPrice();
      panel.chartType.value = 'footprint';
      panel.selectMode();
    }
    for (let index = 2; index < charts.length; index++) {
      charts[index].api.moveTo({ group: charts[index - 2].api.group, position: 'bottom' });
    }
    if (count === 8) {
      // Dockview initially gives the first group most of each column's height;
      // size every cell evenly so all eight native charts have enough space.
      const rowHeight = document.querySelector('#workspace').clientHeight / 4;
      const groups = [...new Set(charts.map(panel => panel.api.group))];
      for (const group of groups) group.api.setSize({ height: rowHeight });
    }
  }, count);
  await page.waitForFunction(count => window.__terminal.stats().panels.length === count
    && window.__terminal.stats().panels.every(panel => panel.series.venue === 'binance'
      && panel.series.market === 'perpetual' && panel.series.type === 'footprint'
      && panel.footprint.surfaceMounted), count);
  if (count === 8) {
    await page.waitForFunction(() => [...window.__terminal.panels.values()].every(panel => {
      const rect = panel.element.getBoundingClientRect();
      return rect.height >= 140 && rect.y >= 0 && rect.bottom <= innerHeight;
    }), undefined, { timeout: 5000 });
  }
  const openDeadline = Date.now() + 10_000;
  let opened = false;
  while (Date.now() < openDeadline && !opened) {
    opened = await worker.evaluate(() => {
      if (!self.__footprintBench.sockets.length) return false;
      self.__footprintBench.open();
      return self.__footprintBench.sockets.some(socket => socket.readyState === 1);
    });
    if (!opened) await sleep(50);
  }
  assert.ok(opened, 'Metadata resolves and the real worker opens its synthetic socket');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const terminal = window.__terminal;
    const feedWorker = terminal.feed.worker;
    const original = feedWorker.onmessage;
    const probe = window.__footprintPageBench = { ipc: [], frames: [], renderLatencies: [], pending: [], previousDraws: new Map(), running: true, previousFrame: 0 };
    feedWorker.onmessage = event => {
      const data = event.data;
      if (data?.type === 'footprint-patch' || data?.type === 'footprint-snapshot') probe.pending.push(performance.now());
      original.call(feedWorker, event);
    };
    for (const [id, panel] of terminal.panels) probe.previousDraws.set(id, panel.engine?.stats.draws ?? 0);
    const frame = time => {
      if (!probe.running) return;
      if (probe.previousFrame) probe.frames.push(time - probe.previousFrame);
      probe.previousFrame = time;
      let drew = false;
      for (const [id, panel] of terminal.panels) {
        const draws = panel.engine?.stats.draws ?? 0;
        const previous = probe.previousDraws.get(id) ?? 0;
        if (draws > previous) drew = true;
        probe.previousDraws.set(id, draws);
      }
      if (drew && probe.pending.length) {
        const now = performance.now();
        for (const arrived of probe.pending) probe.renderLatencies.push(now - arrived);
        probe.pending.length = 0;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    terminal.resetMetrics();
  });
}

async function waitForDiagnostics(page, expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let diagnostics = null;
  while (Date.now() < deadline) {
    await page.evaluate(() => window.__terminal.feed.send({ type: 'diagnostics' }));
    await page.waitForTimeout(80);
    diagnostics = await page.evaluate(() => window.__terminal.feed.diagnostics.footprint ?? null);
    const groups = diagnostics?.groups ?? [];
    const received = diagnostics?.counters?.accepted ?? 0;
    if (received >= expected && groups.length > 0
      && diagnostics.pending === 0
      && groups.every(group => !group.transportInFlight && group.transportPendingBars === 0)) return diagnostics;
  }
  throw new Error('Timed out waiting for worker acknowledgement and browser rendering: ' + JSON.stringify(diagnostics));
}

async function runFootprintLifecycleProbes(page, worker) {
  const screenshot = 'artifacts/performance-footprint-browser-8panels.png';
  await page.screenshot({ path: screenshot });
  const visual = await page.evaluate(() => [...window.__terminal.panels.values()].map(panel => {
    const rect = panel.element.getBoundingClientRect();
    let green = 0;
    let red = 0;
    for (const canvas of panel.element.querySelectorAll('canvas')) {
      const context = canvas.getContext('2d');
      if (!context) continue;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], a = pixels[offset + 3];
        if (a < 180) continue;
        if (g > r * 1.2 && g > b * 1.1 && g > 80) green++;
        if (r > g * 1.2 && r > b * 1.1 && r > 80) red++;
      }
    }
    return { id: panel.diagnostics().id, visible: panel.diagnostics().visible, mode: panel.diagnostics().series.type, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }, green, red };
  }));
  assert.equal(visual.length, 8);
  assert.ok(visual.every(panel => panel.visible && panel.mode === 'footprint' && panel.green + panel.red > 0
    && panel.rect.width >= 250 && panel.rect.height >= 140 && panel.rect.x >= 0 && panel.rect.y >= 0
    && panel.rect.right <= 1366 && panel.rect.bottom <= 768), 'Every visible panel fits the viewport and contains rendered bid/ask footprint colors: ' + JSON.stringify(visual));
  const nativeCells = await page.evaluate(() => [...window.__terminal.panels.values()].map(panel => {
    const bar = panel.footprintBars.at(-1);
    const cell = bar?.cells.find(value => value.bidVol > 0 && value.askVol > 0)
      ?? bar?.cells.find(value => value.bidVol > 0 || value.askVol > 0);
    if (!bar || !cell) return { id: panel.diagnostics().id, error: 'No native aggregate cell retained' };
    const chart = panel.engine.chart;
    const x = chart.timeToCoordinate(bar.time);
    const y = chart.priceToCoordinate(cell.price, 0);
    const hover = x === null || y === null ? null : panel.engine.footprintAt(x, y);
    return {
      id: panel.diagnostics().id, time: bar.time, cell: { ...cell }, x, y,
      hover: hover ? { time: hover.time, price: hover.price, cell: hover.cell } : null,
    };
  }));
  assert.ok(nativeCells.length === 8 && nativeCells.every(hit => hit.hover?.price === hit.cell.price
    && hit.hover.cell?.bidVol === hit.cell.bidVol && hit.hover.cell?.askVol === hit.cell.askVol),
  'Each visible panel exposes the actual rendered native Footprint cell to hitTest: ' + JSON.stringify(nativeCells));

  const moved = await page.evaluate(() => {
    const terminal = window.__terminal;
    const charts = terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle');
    const hidden = charts.at(-1);
    const reference = charts.at(-2);
    if (!hidden || !reference) throw new Error('Expected at least two footprint charts for the hidden-panel probe');
    hidden.api.moveTo({ group: reference.api.group, position: 'center' });
    reference.api.setActive();
    return { id: hidden.id, referenceId: reference.id };
  });
  await page.waitForFunction(id => !window.__terminal.panels.get(id)?.diagnostics().visible, moved.id);
  await page.waitForTimeout(120);
  const hiddenBefore = await page.evaluate(id => {
    const panel = window.__terminal.panels.get(id);
    return { draws: panel.engine.stats.draws, revision: panel.diagnostics().footprint.latest?.revision ?? 0 };
  }, moved.id);
  const before = await page.evaluate(() => window.__terminal.feed.diagnostics.footprint?.counters.accepted ?? 0);
  const hiddenSchedule = await worker.evaluate(() => self.__footprintBench.sendPaced(10, 100, 100));
  const hiddenDiagnostic = await waitForDiagnostics(page, before + hiddenSchedule.observations);
  await page.waitForFunction(id => {
    const panel = window.__terminal.panels.get(id);
    return !panel?.diagnostics().visible && (panel?.diagnostics().footprint.latest?.revision ?? 0) > 0;
  }, moved.id);
  await page.waitForTimeout(200);
  const hiddenAfter = await page.evaluate(id => {
    const panel = window.__terminal.panels.get(id);
    return { visible: panel.diagnostics().visible, draws: panel.engine.stats.draws, revision: panel.diagnostics().footprint.latest?.revision ?? 0 };
  }, moved.id);
  assert.equal(hiddenAfter.visible, false);
  assert.equal(hiddenAfter.draws, hiddenBefore.draws, 'A hidden chart receives bounded worker updates without painting');
  assert.ok(hiddenAfter.revision > hiddenBefore.revision, 'The hidden chart consumed the live aggregate revisions');
  await page.evaluate(id => window.__terminal.dock.getPanel(id)?.api.setActive(), moved.id);
  await page.waitForFunction(id => window.__terminal.panels.get(id)?.diagnostics().visible
    && window.__terminal.panels.get(id).engine.stats.draws > 0, moved.id);

  const heap = await page.context().newCDPSession(page);
  await heap.send('HeapProfiler.enable');
  await heap.send('HeapProfiler.collectGarbage');
  const beforeCycles = await page.evaluate(() => ({ heapBytes: performance.memory?.usedJSHeapSize ?? null, domNodes: document.querySelectorAll('*').length }));
  const closedId = moved.id;
  await page.evaluate(id => window.__terminal.dock.getPanel(id)?.api.close(), closedId);
  await page.waitForFunction(() => window.__terminal.stats().panels.length === 7);
  const stable = await waitForDiagnostics(page, hiddenDiagnostic.counters.accepted);
  const stableSubscribers = stable.subscribers;
  const cycles = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    await page.evaluate(() => window.__terminal.addChart({ venue: 'binance', market: 'perpetual', interval: '1m' }));
    await page.waitForFunction(() => window.__terminal.stats().panels.length === 8);
    const id = await page.evaluate(() => {
      const dockPanel = window.__terminal.dock.panels.filter(panel => panel.view.contentComponent === 'candle').at(-1);
      const panel = dockPanel && window.__terminal.panels.get(dockPanel.id);
      if (!panel) throw new Error('Added chart did not construct its native panel');
      panel.chartType.value = 'footprint';
      panel.selectMode();
      return dockPanel.id;
    });
    await page.waitForFunction(() => {
      window.__terminal.feed.send({ type: 'diagnostics' });
      return window.__terminal.feed.diagnostics.footprint?.subscribers === 8;
    });
    await page.evaluate(id => window.__terminal.dock.getPanel(id)?.api.close(), id);
    await page.waitForFunction(() => {
      window.__terminal.feed.send({ type: 'diagnostics' });
      return window.__terminal.stats().panels.length === 7
        && window.__terminal.feed.diagnostics.footprint?.subscribers === 7;
    });
    const settled = await waitForDiagnostics(page, hiddenDiagnostic.counters.accepted);
    assert.equal(settled.subscribers, stableSubscribers, 'Panel disposal returns the worker to its prior subscriber count');
    assert.ok(settled.groups.every(group => !group.transportInFlight && group.transportPendingBars === 0));
    cycles.push({ iteration: iteration + 1, panelsAfterAdd: 8, panelsAfterClose: 7, subscribers: settled.subscribers, groups: settled.groups.length });
  }
  await heap.send('HeapProfiler.collectGarbage');
  const afterCycles = await page.evaluate(() => ({ heapBytes: performance.memory?.usedJSHeapSize ?? null, domNodes: document.querySelectorAll('*').length }));
  await heap.detach();
  return { screenshot, visual, nativeCells, hidden: { before: hiddenBefore, after: hiddenAfter, addedObservations: hiddenSchedule.observations }, addCloseCycles: cycles, postGc: { before: beforeCycles, after: afterCycles, heapDeltaBytes: beforeCycles.heapBytes === null || afterCycles.heapBytes === null ? null : afterCycles.heapBytes - beforeCycles.heapBytes, domNodeDelta: afterCycles.domNodes - beforeCycles.domNodes } };
}

async function measure(count) {
  const { page, worker } = await makePage();
  const errorStart = errors.length;
  let profiler;
  let cpuProfileTop = null;
  try {
    await configure(page, worker, count);
    const dataGroups = await worker.evaluate(() => ({
      sockets: self.__footprintBench.sockets.length,
      metadataRequests: self.__footprintBench.metadataRequests,
    }));
    assert.equal(dataGroups.sockets, 1, 'Footprint configurations share one public Binance socket');
    assert.equal(dataGroups.metadataRequests, 1, 'Tick-size metadata is loaded once');
    if (profileEnabled && count === 8) {
      profiler = await page.context().newCDPSession(page);
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
      await profiler.send('Profiler.start', { callCount: true });
    }
    const schedule = await worker.evaluate(() => self.__footprintBench.sendPaced(50, 100, 100));
    const diagnostic = await waitForDiagnostics(page, schedule.observations);
    await page.waitForFunction(() => {
      const pages = [...window.__terminal.panels.values()];
      return pages.every(panel => panel.diagnostics().footprint.latest?.cellCount > 0
        && panel.diagnostics().footprint.primitiveSets > 0
        && panel.diagnostics().renderer?.draws > 0);
    });
    await page.waitForTimeout(200);
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      const nodes = new Map(profile.nodes.map(node => [node.id, node]));
      const totals = new Map();
      profile.samples.forEach((nodeId, index) => {
        const frame = nodes.get(nodeId)?.callFrame;
        if (!frame) return;
        const file = frame.url.split('/').at(-1) || frame.url;
        const label = (frame.functionName || '(anonymous)') + ' · ' + file + ':' + (frame.lineNumber + 1);
        totals.set(label, (totals.get(label) ?? 0) + (profile.timeDeltas[index] ?? 1000));
      });
      cpuProfileTop = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([functionName, microseconds]) => ({ functionName, milliseconds: Math.round(microseconds / 1000) }));
      await profiler.detach();
      profiler = undefined;
    }
    const measurements = await page.evaluate(() => {
      const probe = window.__footprintPageBench;
      probe.running = false;
      const stats = window.__terminal.stats();
      const panels = [...window.__terminal.panels.values()].map(panel => panel.diagnostics());
      const percentile = (values, p) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
      };
      return {
        visiblePanels: stats.panels.filter(panel => panel.visible).length,
        worker: stats.feed.footprint,
        panels: panels.map(panel => ({
          visible: panel.visible, mode: panel.series.type,
          bars: panel.footprint.bars, rows: panel.footprint.latest?.cellCount ?? 0,
          latestRevision: panel.footprint.latest?.revision ?? 0,
          primitiveSets: panel.footprint.primitiveSets,
          draws: panel.renderer?.draws ?? 0,
        })),
        frameMs: { samples: probe.frames.length, p50: percentile(probe.frames, .5), p95: percentile(probe.frames, .95), max: Math.max(0, ...probe.frames) },
        ipcToNextDrawMs: { samples: probe.renderLatencies.length, p50: percentile(probe.renderLatencies, .5), p95: percentile(probe.renderLatencies, .95), max: Math.max(0, ...probe.renderLatencies) },
        longTasksMs: [...stats.longTasks],
        errors: [],
      };
    });
    const workerMeasurements = await worker.evaluate(() => ({
      sent: self.__footprintBench.sent,
      socketCount: self.__footprintBench.sockets.length,
      socketCloseCalls: self.__footprintBench.closeCalls,
      batchCount: self.__footprintBench.batches.length,
      sendBatchMsP50: self.__footprintBench.batches.length ? [...self.__footprintBench.batches].sort((a,b)=>a-b)[Math.floor((self.__footprintBench.batches.length-1)*.5)] : null,
      sendBatchMsP95: self.__footprintBench.batches.length ? [...self.__footprintBench.batches].sort((a,b)=>a-b)[Math.floor((self.__footprintBench.batches.length-1)*.95)] : null,
    }));
    assert.equal(workerMeasurements.sent, schedule.observations);
    assert.ok(diagnostic.counters.accepted >= schedule.observations);
    assert.equal(measurements.panels.length, count);
    assert.ok(measurements.panels.every(panel => panel.rows > 0 && panel.latestRevision > 0 && panel.draws > 0));
    assert.equal(measurements.visiblePanels, count, 'Every chart remains visible during measurement');
    assert.equal(diagnostic.counters.accepted, schedule.observations, 'Worker accepted exactly the scheduled observations');
    if (count === 2) {
      assert.equal(diagnostic.groups.length, 1, 'Two equal configurations share one aggregation group');
      assert.equal(diagnostic.groups[0].clients, 2, 'The shared group retains both panel subscriptions');
    }
    const browserErrors = [...new Set(errors.slice(errorStart))];
    assert.deepEqual(browserErrors, [], 'No browser page errors occurred during the workload');
    const result = { panels: count, fixture: 'synthetic Binance USD-M aggTrade in the real worker, IPC acknowledgement, FeedClient, chart primitive and RAF', schedule, aggregation: diagnostic.counters, groups: diagnostic.groups.map(group => ({ clients: group.clients, key: group.key, cells: group.cells })), workerMeasurements, browser: { ...measurements, errors: browserErrors } };
    if (cpuProfileTop) result.cpuProfileTop = cpuProfileTop;
    results.push(result);
    if (count === 8 && !profileEnabled) result.lifecycle = await runFootprintLifecycleProbes(page, worker);
    await page.evaluate(() => {
      for (const panel of window.__terminal.panels.values()) {
        panel.chartType.value = 'candle';
        panel.selectMode();
      }
      window.__terminal.feed.send({ type: 'diagnostics' });
    });
    await page.waitForFunction(() => {
      window.__terminal.feed.send({ type: 'diagnostics' });
      return window.__terminal.feed.diagnostics.footprint?.subscribers === 0;
    }, undefined, { timeout: 5000 });
    const teardown = await worker.evaluate(() => ({
      sockets: self.__footprintBench.sockets.length,
      closeCalls: self.__footprintBench.closeCalls,
      ready: self.__footprintBench.sockets.map(socket => socket.readyState),
    }));
    assert.ok(teardown.closeCalls >= 1 && teardown.ready.every(state => state === 3), 'Last subscriber disposal closes the shared socket');
    result.teardown = teardown;
  } finally {
    await page.close();
  }
}

try {
  for (const count of selectedCounts) await measure(count);
  const report = {
    mode: profileEnabled ? 'profiled diagnostic fixture only; synthetic 100 aggregate trades every 100 ms for 5 s; timings include DevTools sampling overhead; production feed is not used' : 'explicit diagnostic fixture only; synthetic 100 aggregate trades every 100 ms for 5 s; production feed is not used',
    sameMachine: true,
    browserVersion: browser.version(),
    viewport: { width: 1366, height: 768, dpr: 1 },
    results,
    limitation: 'IPC-to-next-draw is sampled at the next RAF after chart draw counters advance; this is an end-to-end browser scheduling measure, not a device-wide performance acceptance claim.',
  };
  await writeFile(process.env.BENCH_OUTPUT || 'artifacts/performance-footprint-browser.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

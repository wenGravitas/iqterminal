import { test, expect, type Page } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, chooseChartMarket } from './indicator-actions';

async function installResizeTrace(page: Page) {
  await page.addInitScript(() => {
    const trace: any = (window as any).__chartResizeTrace = {
      armed: false, stage: null, observers: [], writes: [], chartResizes: [], draws: [], drawOrder: [],
    };
    trace.sample = () => {
      const canvas = trace.stage?.querySelector('canvas') as HTMLCanvasElement | undefined;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !canvas.width || !canvas.height) return { width: canvas?.width ?? 0, height: canvas?.height ?? 0, painted: 0, colors: 0 };
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0; const colors = new Set<string>();
      for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) {
        const px = Math.min(canvas.width - 1, Math.floor((x + .5) * canvas.width / 24));
        const py = Math.min(canvas.height - 1, Math.floor((y + .5) * canvas.height / 12));
        const i = (py * canvas.width + px) * 4;
        if (data[i + 3] > 0) { painted++; colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`); }
      }
      return { width: canvas.width, height: canvas.height, painted, colors: colors.size };
    };
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const relevant = entries.filter(entry => entry.target === trace.stage || (entry.target as Element).closest?.('.chart-stage') === trace.stage);
          const report = (phase: string) => trace.observers.push({ phase, pixels: trace.sample(),
            widths: relevant.map(entry => entry.contentRect.width) });
          if (trace.armed && relevant.length) report('before');
          callback(entries, observer);
          if (trace.armed && relevant.length) report('after');
        });
      }
    };
  });
}

test('keeps 5m Footprint and Order Walls painted across gestures and container resize', async ({ page }) => {
  await installResizeTrace(page);
  await installDepthFixture(page);
  await page.locator('#theme').selectOption('dark');
  const panel = page.locator('.candle-panel').first();
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].bars)).toBe(5000);

  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const record: any = { footprintEvents: 0, wallEvents: 0 };
    terminal.feed.subscribeFootprint = (_id: string, _series: unknown, _rowPrice: number, callback: (event: any) => void) => {
      record.footprint = callback;
      record.footprintEvents++;
      return () => { if (record.footprint === callback) record.footprint = undefined; };
    };
    terminal.feed.subscribeOrderWalls = (_id: string, request: unknown, callback: (event: any) => void) => {
      record.wall = callback;
      record.wallRequest = request;
      record.wallEvents++;
      return () => { if (record.wall === callback) record.wall = undefined; };
    };
    terminal.feed.updateOrderWallsViewport = () => {};
    terminal.feed.updateOrderWalls = () => {};
    terminal.injectFootprint = (event: any) => record.footprint?.(event);
    terminal.injectWalls = (event: any) => record.wall?.(event);
    (window as any).__panZoomFeed = record;
  });
  await addIndicator(panel, 'Footprint');
  await addIndicator(panel, 'Order Walls');

  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const owner = [...terminal.panels.values()][0] as any;
    const engine = owner.engine;
    const source = engine.series.getData().slice(-600);
    if (source.length !== 600) throw new Error(`Expected 600 native 5m fixture bars, got ${source.length}`);
    const bars = source.map((candle: any, index: number) => {
      const rowSize = 25;
      const firstPrice = Math.floor(candle.low / rowSize) * rowSize;
      const lastPrice = Math.ceil(candle.high / rowSize) * rowSize;
      const cells = [];
      for (let price = firstPrice, row = 0; price <= lastPrice; price += rowSize, row++) {
        const bidVol = .1 + (row % 7) * .2;
        const askVol = .15 + (row % 5) * .25;
        cells.push({ price, bidVol, askVol, bidNotional: price * bidVol, askNotional: price * askVol });
      }
      return { time: candle.time, revision: index + 1, cells, delta: cells.reduce((n: number, c: any) => n + c.askVol - c.bidVol, 0),
        minDelta: -2, maxDelta: 2, rowSize, source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade',
        coverage: 'observed', gapBefore: false, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        aggregateRecordCount: cells.length * 2 };
    });
    const first = bars[0].time * 1000;
    const last = bars.at(-1).time * 1000;
    const now = Date.now();
    const status = { state: 'live', message: 'Deterministic 5m footprint replay', lastUpdate: now, tickSize: .1, rowSize: 25,
      collectionStartedAt: first, firstTradeAt: first, lastTradeAt: last, eventTime: last, outages: 0, capacityDrops: 0,
      unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0, retentionStart: bars[0].time, coverage: 'continuous' };
    terminal.injectFootprint({ type: 'footprint-status', key: 'gesture-diagnostic', ids: [owner.params.api.id], status });
    terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id], bars, retentionStart: bars[0].time, status });
    const priceRange = engine.chart.panes()[0].priceScale.priceRange();
    const low = priceRange?.min ?? 82250, high = priceRange?.max ?? 83750;
    const segments = Array.from({ length: 300 }, (_, index) => {
      const price = low - 10 + (high - low + 20) * index / 299;
      const start = first + Math.max(0, Math.floor((last - first) * .25));
      return { id: `aligned-wall-${index}`, epoch: 1, side: index % 2 ? 'bid' : 'ask', price, start, end: null,
        peakUsd: 1_500_000, meanUsd: 900_000, durationMs: last - start, percentile: 98, scopePartial: true,
        startKnown: true, valueRuns: [{ at: start, usd: 900_000 + index * 100, percentile: 98 }],
        valueRunsTruncated: false, endReason: null, endKnown: false };
    });
    terminal.injectWalls({ type: 'order-wall-batch', key: 'gesture-diagnostic', ids: [owner.params.api.id], generation: 1,
      batchId: 1, kind: 'snapshot', segments, status: { state: 'live', message: 'Deterministic aligned wall replay', tickSize: .1,
        resolvedPriceWidth: 10, lastConfirmedAt: last + 300_000, retentionStart: first,
        coverage: { from: first, to: last + 300_000, complete: true, partial: false, gaps: [] } } });

    const diag: any = (window as any).__panZoomDiag = { bars, status, events: [] };
    const originalSetBars = engine.setFootprintBars.bind(engine);
    engine.setFootprintBars = (next: any[], preserveView?: boolean) => {
      diag.events.push({ at: performance.now(), type: 'setFootprintBars', count: next.length });
      return originalSetBars(next, preserveView);
    };
    const originalRestoreView = engine.restoreView.bind(engine);
    engine.restoreView = (view: any) => { diag.events.push({ at: performance.now(), type: 'restoreView' }); return originalRestoreView(view); };
    const indexSeries = engine.footprintIndexSeries;
    const originalSetData = indexSeries.setData.bind(indexSeries);
    indexSeries.setData = (...args: any[]) => { diag.events.push({ at: performance.now(), type: 'indexSeries.setData', count: args[0]?.length }); return originalSetData(...args); };
    const chartStage = owner.element.querySelector('.chart-stage') as HTMLElement;
    const resizeTrace = (window as any).__chartResizeTrace;
    resizeTrace.stage = chartStage;
    resizeTrace.clear = () => { for (const key of ['observers', 'writes', 'chartResizes', 'draws', 'drawOrder']) resizeTrace[key].length = 0; };
    for (const property of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property)!;
      Object.defineProperty(HTMLCanvasElement.prototype, property, { ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          const before = this[property];
          descriptor.set!.call(this, value);
          if (resizeTrace.armed && this.closest('.chart-stage') === chartStage) resizeTrace.writes.push({ property, before, value, same: before === value });
        } });
    }
    engine.chart.on('resize', () => { if (resizeTrace.armed) resizeTrace.chartResizes.push({ pixels: resizeTrace.sample() }); });
    const originalViewport = engine.onHeatmapViewport?.bind(engine);
    engine.onHeatmapViewport = (viewport: any) => {
      if (resizeTrace.armed) resizeTrace.drawOrder.push('order-walls-viewport');
      return originalViewport?.(viewport);
    };
    const originalDrawForTrace = engine.draw.bind(engine);
    engine.draw = () => {
      if (resizeTrace.armed) resizeTrace.draws.push({ phase: 'enter', pixels: resizeTrace.sample() });
      if (resizeTrace.armed) for (const [handle, callback] of engine.callbacks) {
        engine.callbacks.set(handle, () => { resizeTrace.drawOrder.push('renderer'); return callback(); });
      }
      const result = originalDrawForTrace();
      if (resizeTrace.armed) resizeTrace.draws.push({ phase: 'exit', pixels: resizeTrace.sample() });
      return result;
    };
    const samplePlot = () => {
      const stageRect = chartStage.getBoundingClientRect();
      const plot = engine.chart.plotRect(0);
      const left = plot.left, top = plot.top, width = plot.width, height = plot.height;
      const canvases = [...chartStage.querySelectorAll('canvas')] as HTMLCanvasElement[];
      const matching = canvases.filter(canvas => { const r = canvas.getBoundingClientRect();
        return stageRect.left + left < r.right && stageRect.left + left + width > r.left && stageRect.top + top < r.bottom && stageRect.top + top + height > r.top; });
      const output = matching.map(canvas => {
        const ctx = canvas.getContext('2d'); if (!ctx || !canvas.width || !canvas.height) return { pixels: 0, unique: 0, nonDominant: 0, meanLuma: 0, black: 0 };
        const r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, sy = canvas.height / r.height;
        const x0 = Math.max(0, Math.floor((stageRect.left + left - r.left) * sx));
        const y0 = Math.max(0, Math.floor((stageRect.top + top - r.top) * sy));
        const x1 = Math.min(canvas.width, Math.ceil((stageRect.left + left + width - r.left) * sx));
        const y1 = Math.min(canvas.height, Math.ceil((stageRect.top + top + height - r.top) * sy));
        const image = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const colors = new Map<string, number>(); let luma = 0, black = 0, pixels = 0;
        for (let y = 0; y < 28; y++) for (let x = 0; x < 56; x++) {
          const px = x0 + Math.min(x1 - x0 - 1, Math.floor((x + .5) * (x1 - x0) / 56));
          const py = y0 + Math.min(y1 - y0 - 1, Math.floor((y + .5) * (y1 - y0) / 28));
          const at = ((py - y0) * (x1 - x0) + px - x0) * 4;
          const color = `${image[at]},${image[at + 1]},${image[at + 2]}`;
          colors.set(color, (colors.get(color) ?? 0) + 1);
          luma += .2126 * image[at]! + .7152 * image[at + 1]! + .0722 * image[at + 2]!;
          if (image[at] === 0 && image[at + 1] === 0 && image[at + 2] === 0) black++;
          pixels++;
        }
        const dominant = Math.max(0, ...colors.values());
        return { pixels, unique: colors.size, nonDominant: pixels - dominant, meanLuma: +(luma / pixels).toFixed(2), black };
      });
      return { range: engine.visibleRange(), time: engine.visibleTimeRange(), plot: { width, height }, canvases: output,
        wall: engine.orderWallsDiagnostics(), seriesBars: engine.barCount };
    };
    diag.samplePlot = samplePlot;
  });

  await page.waitForTimeout(300);
  const stage = await panel.locator('.chart-stage').boundingBox();
  if (!stage) throw new Error('Chart stage missing');
  const before = await page.evaluate(() => (window as any).__panZoomDiag.samplePlot());
  await page.evaluate(() => { const trace = (window as any).__chartResizeTrace; trace.clear(); trace.armed = true; });
  await page.mouse.move(stage.x + stage.width * .48, stage.y + stage.height * .52);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(stage.x + stage.width * (.48 + step * .025), stage.y + stage.height * (.52 + step * .01), { steps: 2 });
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(180);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(250);

  const gesture = await page.evaluate(() => {
    const diag = (window as any).__panZoomDiag, terminal = (window as any).__terminal;
    const owner = [...terminal.panels.values()][0] as any;
    const afterGesture = diag.samplePlot();
    const resizeTrace = (window as any).__chartResizeTrace;
    const chartResizeTrace = { observers: resizeTrace.observers.slice(), writes: resizeTrace.writes.slice() };
    resizeTrace.armed = false;
    resizeTrace.clear(); resizeTrace.armed = true;
    const fire = (bars: any[], status: any) => terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id],
      bars, retentionStart: bars[0].time, status });
    for (const at of [80, 240, 400]) setTimeout(() => fire(diag.bars, { ...diag.status, message: 'Status refreshed with unchanged footprint bars' }), at);
    setTimeout(() => {
      diag.unchangedEvents = diag.events.length;
      diag.duplicateStatus = owner.footprintStatus.message;
      diag.updatedBars = structuredClone(diag.bars);
      const latest = diag.updatedBars.at(-1);
      const cell = latest.cells[0];
      latest.revision++;
      cell.bidVol += .05;
      cell.bidNotional = cell.price * cell.bidVol;
      latest.delta -= .05;
      latest.aggregateRecordCount++;
      fire(diag.updatedBars, { ...diag.status, message: 'Live footprint revision with updated cell volume' });
    }, 560);
    setTimeout(() => { resizeTrace.armed = false; }, 720);
    return { afterGesture, wall: owner.engine.orderWallsDiagnostics(), chartResizeTrace };
  });
  await page.waitForTimeout(1300);
  const after = await page.evaluate(() => {
    const diag = (window as any).__panZoomDiag, owner = [...(window as any).__terminal.panels.values()][0] as any;
    const resizeTrace = (window as any).__chartResizeTrace;
    return { counts: diag.events.reduce((out: any, event: any) => (out[event.type] = (out[event.type] ?? 0) + 1, out), {}),
      unchangedEvents: diag.unchangedEvents, finalRevision: owner.footprintBars.at(-1)?.revision,
      finalBidVol: owner.footprintBars.at(-1)?.cells[0]?.bidVol, duplicateStatus: diag.duplicateStatus, statusMessage: owner.footprintStatus.message,
      resizeTrace: { observers: resizeTrace.observers.slice(), writes: resizeTrace.writes.slice(),
        chartResizes: resizeTrace.chartResizes.slice(), draws: resizeTrace.draws.slice() } };
  });

  const forcedStart = await page.evaluate(() => {
    const trace = (window as any).__chartResizeTrace, owner = [...(window as any).__terminal.panels.values()][0] as any;
    const chartStage = owner.element.querySelector('.chart-stage') as HTMLElement;
    const before = chartStage.getBoundingClientRect(); const oldFlex = chartStage.style.flex;
    trace.clear(); trace.oldFlex = oldFlex; trace.armed = true;
    chartStage.style.flex = `0 0 ${before.width - .25}px`;
    return { beforeWidth: before.width, oldFlex, immediate: trace.sample() };
  });
  await page.waitForTimeout(100);
  const forcedResize = await page.evaluate(() => {
    const trace = (window as any).__chartResizeTrace;
    const result = { pixels: trace.sample(), observers: trace.observers.slice(), writes: trace.writes.slice(),
      chartResizes: trace.chartResizes.slice(), draws: trace.draws.slice(), drawOrder: trace.drawOrder.slice() };
    trace.armed = false;
    const owner = [...(window as any).__terminal.panels.values()][0] as any;
    (owner.element.querySelector('.chart-stage') as HTMLElement).style.flex = trace.oldFlex ?? '';
    return result;
  });
  await page.waitForTimeout(60);
  console.log(JSON.stringify({ gesture: { rangeChanged: JSON.stringify(gesture.afterGesture.range) !== JSON.stringify(before.range),
    resizeObservations: gesture.chartResizeTrace.observers.length, canvasWrites: gesture.chartResizeTrace.writes.length,
    basePlot: gesture.afterGesture.canvases[0] }, snapshotEvents: after.counts, unchangedSnapshotEvents: after.unchangedEvents,
    forcedResize: { before: forcedStart.immediate, observers: forcedResize.observers,
      resizeEventPixels: forcedResize.chartResizes.map((entry: any) => entry.pixels), drawPixels: forcedResize.draws, drawOrder: forcedResize.drawOrder } }));

  const prepend = await page.evaluate(() => {
    const terminal = (window as any).__terminal, diag = (window as any).__panZoomDiag;
    const owner = [...terminal.panels.values()][0] as any;
    const oldFirstTime = diag.updatedBars[0].time;
    const older = { ...structuredClone(diag.updatedBars[0]), time: oldFirstTime - 300, revision: 1 };
    diag.historyBars = [older, ...diag.updatedBars]; diag.events.length = 0;
    terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id],
      bars: diag.historyBars, retentionStart: older.time, status: diag.status });
    return { times: [owner.footprintBars[0].time, owner.engine.footprintBars[0].time], oldFirstTime,
      count: owner.footprintBars.length, events: diag.events.map((event: any) => event.type) };
  });

  const panelsBefore = await page.evaluate(() => {
    const dock = (window as any).__terminal.dock;
    dock.panels[1].api.moveTo({ group: dock.panels[0].api.group });
    dock.panels[1].api.setActive();
    const owner = [...(window as any).__terminal.panels.values()][0] as any;
    return { visible: owner.visible };
  });
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].visible)).toBe(false);
  const hidden = await page.evaluate(() => {
    const terminal = (window as any).__terminal, diag = (window as any).__panZoomDiag;
    const owner = [...terminal.panels.values()][0] as any;
    diag.events.length = 0;
    terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id],
      bars: diag.historyBars, retentionStart: diag.historyBars[0].time, status: diag.status });
    return { visible: owner.visible, count: owner.footprintBars.length, events: diag.events.map((event: any) => event.type) };
  });
  await page.evaluate(() => (window as any).__terminal.dock.panels[0].api.setActive());
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].visible)).toBe(true);
  const resumed = await page.evaluate(() => {
    const diag = (window as any).__panZoomDiag, owner = [...(window as any).__terminal.panels.values()][0] as any;
    return { count: owner.footprintBars.length, eventTypes: diag.events.map((event: any) => event.type), needsSync: owner.footprintNeedsSync };
  });

  const intervalSubs = await page.evaluate(() => (window as any).__panZoomFeed.footprintEvents);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('1m');
  await expect.poll(() => page.evaluate(() => (window as any).__panZoomFeed.footprintEvents)).toBeGreaterThan(intervalSubs);
  const timeframeReset = await page.evaluate(() => {
    const terminal = (window as any).__terminal, diag = (window as any).__panZoomDiag;
    const owner = [...terminal.panels.values()][0] as any;
    diag.events.length = 0;
    terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id],
      bars: diag.historyBars, retentionStart: diag.historyBars[0].time, status: diag.status });
    return { interval: owner.selection.interval, events: diag.events.map((event: any) => event.type) };
  });
  const sourceSubs = await page.evaluate(() => (window as any).__panZoomFeed.footprintEvents);
  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect.poll(() => page.evaluate(() => (window as any).__panZoomFeed.footprintEvents)).toBeGreaterThan(sourceSubs);
  const sourceReset = await page.evaluate(() => {
    const terminal = (window as any).__terminal, diag = (window as any).__panZoomDiag;
    const owner = [...terminal.panels.values()][0] as any;
    diag.events.length = 0;
    terminal.injectFootprint({ type: 'footprint-snapshot', key: 'gesture-diagnostic', ids: [owner.params.api.id],
      bars: diag.historyBars, retentionStart: diag.historyBars[0].time, status: diag.status });
    return { market: owner.selection.market, events: diag.events.map((event: any) => event.type) };
  });

  expect(gesture.afterGesture.range).not.toEqual(before.range);
  expect(gesture.wall.retainedSegments).toBe(300);
  expect(after.unchangedEvents).toBe(0);
  expect(after.counts.setFootprintBars).toBe(1);
  expect(after.counts['indexSeries.setData']).toBe(1);
  expect(after.counts.restoreView).toBe(1);
  expect(after.finalRevision).toBe(601);
  expect(after.finalBidVol).toBeCloseTo(.15, 10);
  expect(after.duplicateStatus).toBe('Status refreshed with unchanged footprint bars');
  expect(after.statusMessage).toBe('Live footprint revision with updated cell volume');
  expect(gesture.chartResizeTrace.writes).toHaveLength(0);
  expect(gesture.chartResizeTrace.observers).toHaveLength(0);
  expect(forcedResize.writes.some((write: any) => write.property === 'width' && write.same)).toBe(true);
  expect(gesture.afterGesture.canvases[0]?.nonDominant).toBeGreaterThan(0);
  expect(forcedResize.chartResizes.at(-1)?.pixels.painted).toBe(288);
  expect(forcedResize.observers.find((entry: any) => entry.phase === 'after')?.pixels.painted).toBe(288);
  expect(forcedResize.drawOrder.indexOf('order-walls-viewport')).toBeGreaterThanOrEqual(0);
  expect(forcedResize.drawOrder.indexOf('renderer')).toBeGreaterThan(forcedResize.drawOrder.indexOf('order-walls-viewport'));
  expect(prepend.count).toBe(601);
  expect(prepend.times[0]).toBeLessThan(prepend.oldFirstTime);
  expect(prepend.events).toContain('setFootprintBars');
  expect(panelsBefore.visible).toBe(false);
  expect(hidden.visible).toBe(false);
  expect(hidden.events).toEqual([]);
  expect(resumed.needsSync).toBe(false);
  expect(resumed.eventTypes).toContain('setFootprintBars');
  expect(timeframeReset.interval).toBe('1m');
  expect(timeframeReset.events).toContain('setFootprintBars');
  expect(sourceReset.market).toBe('spot');
  expect(sourceReset.events).toContain('setFootprintBars');
});

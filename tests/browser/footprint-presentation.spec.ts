import { compactVol } from 'openalgo-charts/profile';
import { addIndicator, expectHeatmapLiveQuiet, setFootprint, setPriceLevel, setUnits, footprintSettings } from './indicator-actions';
import { test, expect, type Page, type Worker } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { footprintColumn } from '../../src/chart/terminal-footprint';

async function freezeFixtureTimeToLatestCandle(page: Page, worker: Worker) {
  const fixedNow = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const latestStart = p.candles.at(-1)?.t;
    if (!Number.isFinite(latestStart)) throw new Error('Native fixture has no finite latest candle timestamp');
    return latestStart + 5_000;
  });
  await page.evaluate(at => {
    const start = performance.now();
    Date.now = () => at + performance.now() - start;
  }, fixedNow);
  await worker.evaluate(at => {
    const start = performance.now();
    Date.now = () => at + performance.now() - start;
  }, fixedNow);
}

test('footprint text scales with zoom and independent opacity settings persist without resetting collection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'dark' }); const worker = await installDepthFixture(page);
  await freezeFixtureTimeToLatestCandle(page, worker);
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order-book Heatmap');
  await expectHeatmapLiveQuiet(panel);
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      const time = Math.floor(Date.now()/60000)*60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells: [{ price: 83000, bidVol: .05, askVol: .45, bidNotional: 4150, askNotional: 37354.5 }],
        open: 83000, high: 83010, low: 83000, close: 83010, delta: .4, minDelta: -.05, maxDelta: .4, quoteDelta: 33204.5, minQuoteDelta: -4150, maxQuoteDelta: 33204.5, coverage: 'partial', gapBefore: false }],
        retentionStart: time, status: { state: 'live', message: 'Explicit test trades', lastUpdate: Date.now(), collectionStartedAt: Date.now(), coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprint?.cellFont)).toBeGreaterThanOrEqual(9);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).heatmapStatus.collectionStart)).not.toBeNull();
  await setUnits(panel, 'usdt');
  await expectHeatmapLiveQuiet(panel);
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const b = p.engine.heatmap.bins.find((b: any) => b.bid > 0);
    return b && p.engine.heatmap.hoverAt((b.x+b.right)/2, (b.y+b.bottom)/2)?.units;
  })).toBe('usdt');
  const before = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    p.engine.chart.timeScale.setBarSpacing(200); p.engine.chart.timeScale.setRightOffset(1);
    p.engine.chart.panes()[0].priceScale.setAutoScale(false);
    p.engine.chart.panes()[0].priceScale.setFixedRange({ min: 82925, max: 83100 }); p.engine.chart.setAutoScale(false);
    return p.heatmapStatus.collectionStart;
  });
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprint.cellFont)).toBeGreaterThanOrEqual(20);

  await page.screenshot({ path: 'artifacts/footprint-prominent-dark-1366x768.png' });
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(panel.getByLabel('Show VAH and VAL')).toBeChecked(); await panel.getByLabel('Show VAH and VAL').uncheck();
  await expect(panel.getByLabel('Histogram background opacity (%)')).toHaveValue('85'); await panel.getByLabel('Histogram background opacity (%)').fill('30');
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  const heatmapSettings = panel.locator('.heatmap-settings');
  await expect(heatmapSettings.getByLabel('Opacity', { exact: true })).toHaveValue('0.85'); await heatmapSettings.getByLabel('Opacity', { exact: true }).fill('0.65');
  await heatmapSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  const state = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return { opacity: p.engine.footprint.opacity, heatmap: p.selection.heatmap.opacity, start: p.heatmapStatus.collectionStart, bars: p.engine.footprintBars.length };
  });
  expect(state).toEqual({ opacity: .3, heatmap: .65, start: before, bars: 1 });
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.setViewportSize({ width: 720, height: 860 });
  await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.timeScale.setRightOffset(0));
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.plotRect(0).width)).toBeLessThan(360);
  await page.screenshot({ path: 'artifacts/footprint-prominent-light-720x860.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(400); await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const persisted = await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).selection);
  expect(persisted.footprint.showValueArea).toBe(false); expect(persisted.footprint.opacity).toBe(.3); expect(persisted.heatmap.opacity).toBe(.65); expect(errors).toEqual([]);
});

test('18-level footprint shows distinct VAH and VAL with transparent histogram backgrounds', async ({ page }) => {
  // Keep the entire extended profile away from plot-edge clipping.
  await page.setViewportSize({width:1920,height:1080});
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const paths = new WeakMap<CanvasRenderingContext2D, [number, number][]>();
    const pendingCellRects = new WeakMap<CanvasRenderingContext2D, { x: number; y: number; width: number; height: number }>();
    (window as any).__footprintVaStrokes = [];
    (window as any).__footprintPocStrokes = [];
    (window as any).__footprintTotals = [];
    (window as any).__footprintCellFills = [];
    const roundRect = prototype.roundRect;
    prototype.roundRect = function(x: number, y: number, width: number, height: number, radii?: number | DOMPointInit | Iterable<number | DOMPointInit>) {
      if (this.font.includes('ui-monospace')) pendingCellRects.set(this, { x, y, width, height });
      return roundRect.call(this, x, y, width, height, radii as any);
    };
    const fill = prototype.fill;
    prototype.fill = function() {
      const rect = pendingCellRects.get(this);
      if (rect) (window as any).__footprintCellFills.push({ ...rect, color: this.fillStyle, alpha: this.globalAlpha });
      pendingCellRects.delete(this);
      return fill.apply(this, arguments as any);
    };
    const NativePath2D = window.Path2D;
    class RecordedPath2D extends NativePath2D {
      points: [number, number][] = [];
      moveTo(x: number, y: number) { this.points.push([x, y]); return super.moveTo(x, y); }
      lineTo(x: number, y: number) { this.points.push([x, y]); return super.lineTo(x, y); }
    }
    Object.defineProperty(window, 'Path2D', { configurable: true, writable: true, value: RecordedPath2D });
    const fillText = prototype.fillText;
    prototype.fillText = function(text: string, x: number, y: number) {
      if (this.font.startsWith('9px ')) {
        (window as any).__footprintTotals.push({ text, x, y, align: this.textAlign, alpha: this.globalAlpha, font: this.font });
      }
      return fillText.apply(this, arguments as any);
    };
    const beginPath = prototype.beginPath;
    prototype.beginPath = function() { paths.set(this, []); return beginPath.call(this); };
    const moveTo = prototype.moveTo;
    prototype.moveTo = function(x: number, y: number) { paths.get(this)?.push([x, y]); return moveTo.call(this, x, y); };
    const lineTo = prototype.lineTo;
    prototype.lineTo = function(x: number, y: number) { paths.get(this)?.push([x, y]); return lineTo.call(this, x, y); };
    const stroke = prototype.stroke;
    prototype.stroke = function(path?: Path2D) {
      if (path && this.strokeStyle === '#6d3fa0') {
        (window as any).__footprintPocStrokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: this.getLineDash(), points: (path as RecordedPath2D).points });
      } else if (!path && this.strokeStyle === '#6d3fa0' && this.lineWidth >= 2) {
        (window as any).__footprintVaStrokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: this.getLineDash(), points: [...(paths.get(this) ?? [])] });
      }
      return stroke.apply(this, arguments as any);
    };
  });
  await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const t = (window as any).__terminal; t.profileSubscriptions = 0;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      t.profileSubscriptions++;
      const time = Math.floor(Date.now() / 60000) * 60, start = Date.now();
      const cells = Array.from({ length: 18 }, (_, index) => {
        const volume = 3 + (9 - Math.abs(index - 8)) * 5, bidVol = Math.floor(volume * .6);
        return { price: 83000 - index * rowSize, bidVol, askVol: volume - bidVol };
      });
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells,
        open: 83000 - rowSize, high: 83000 + rowSize, low: 83000 - rowSize * 2, close: 83000,
        delta: cells.reduce((total: number, cell: any) => total + cell.askVol - cell.bidVol, 0), coverage: 'partial', gapBefore: false }],
        retentionStart: time, status: { state: 'live', message: 'Explicit test trades', lastUpdate: start, collectionStartedAt: start, coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprintBars[0]?.cells.length)).toBe(18);
  const setup = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any;
    const rowSize = p.selection.rowPrice;
    p.engine.chart.timeScale.setBarSpacing(240); p.engine.chart.timeScale.setRightOffset(1);
    p.engine.chart.panes()[0].priceScale.setAutoScale(false);
    p.engine.chart.panes()[0].priceScale.setFixedRange({ min: 83000 - 17.5 * rowSize, max: 83000 + .5 * rowSize }); p.engine.chart.setAutoScale(false);
    return { rowSize, start: p.footprintStatus.collectionStartedAt };
  });
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(panel.getByLabel('Show VAH and VAL')).toBeChecked();
  await expect(panel.getByLabel('Histogram background opacity (%)')).toHaveValue('85');
  await page.getByRole('combobox', { name: 'Cell display', exact: true }).selectOption('volume-delta-candle');
  await expect(page.getByRole('combobox', { name: 'Totals position', exact: true })).toHaveCount(0);
  await panel.getByLabel('Histogram background opacity (%)').fill('30');
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__footprintVaStrokes.length)).toBeGreaterThan(0);
  const rendered = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, stats = p.engine.footprint.stats()[0];
    const dpr = window.devicePixelRatio, scale = p.engine.chart.panes()[0].priceScale;
    return { subscriptions: t.profileSubscriptions, collectionStart: p.footprintStatus.collectionStartedAt,
      opacity: p.engine.footprint.opacity, cells: p.engine.footprintBars[0].cells.length,
      vah: stats.vah, val: stats.val, poc: stats.poc, volume: stats.volume, delta: stats.delta,
      options: p.engine.footprint.options(), plotHeight: p.engine.chart.plotRect(0).height,
      dpr,
      expectedPocY: Math.round(scale.priceToY(stats.poc) * dpr), strokes: (window as any).__footprintVaStrokes,
      pocStrokes: (window as any).__footprintPocStrokes, cellFills: (window as any).__footprintCellFills,
      totals: (window as any).__footprintTotals };
  });
  expect(rendered).toMatchObject({ subscriptions: 1, collectionStart: setup.start, opacity: .3, cells: 18 });
  expect(rendered.vah).not.toBe(rendered.val);
  const pocStroke = rendered.pocStrokes.at(-1)!;
  expect(pocStroke).toMatchObject({ color: '#6d3fa0', width: 2, dash: [3, 2] });
  expect(pocStroke.points).toHaveLength(4);
  const levelStroke = rendered.strokes.at(-1)!;
  expect(levelStroke.color).toBe('#6d3fa0'); expect(levelStroke.width).toBeGreaterThanOrEqual(2);
  expect(levelStroke.points).toHaveLength(4);
  expect(pocStroke.points[0][0]).toBe(levelStroke.points[0][0]);
  expect(pocStroke.points[2][0]).toBe(levelStroke.points[1][0]);
  expect(pocStroke.points[0][0]).toBe(levelStroke.points[2][0]);
  expect(pocStroke.points[2][0]).toBe(levelStroke.points[3][0]);
  expect(levelStroke.points[0][1]).toBe(levelStroke.points[1][1]);
  expect(levelStroke.points[2][1]).toBe(levelStroke.points[3][1]);
  expect(levelStroke.points[0][1]).not.toBe(levelStroke.points[2][1]);
  const pocFills = [...new Map(rendered.cellFills
    .filter((rect: any) => rect.alpha === rendered.opacity && Math.abs(rect.y + rect.height / 2 - rendered.expectedPocY) <= 1)
    .map((rect: any) => [`${rect.x}:${rect.y}:${rect.width}:${rect.height}`, rect])).values()] as any[];
  expect(pocFills).toHaveLength(2);
  expect(rendered.totals).toEqual([]);
  expect(rendered.options.statsRows).toEqual([]);
  await page.screenshot({ path: '/tmp/footprint-poc-aligned.png' });
});

test('delta profile applies native presentation without restarting collection and persists', async ({ page }) => {
  await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const t = (window as any).__terminal; t.profileSubscriptions = 0;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      t.profileSubscriptions++;
      const time = Math.floor(Date.now() / 60000) * 60, start = Date.now();
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1,
        cells: [{ price: 83000, bidVol: 2, askVol: 12 }, { price: 82975, bidVol: 8, askVol: 3 }, { price: 82950, bidVol: 1, askVol: 3 }],
        open: 82960, high: 83020, low: 82955, close: 83010, delta: 7, minDelta: -5, maxDelta: 10, coverage: 'partial', gapBefore: false }],
        retentionStart: time, status: { state: 'live', message: 'Explicit test trades', lastUpdate: start, collectionStartedAt: start, coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprintBars.length)).toBe(1);
  const before = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any; t.profilePrimitive = p.engine.footprint;
    return { start: p.footprintStatus.collectionStartedAt, range: p.engine.visibleRange() };
  });
  await footprintSettings(panel);
  await page.getByRole('combobox', { name: 'Cell display', exact: true }).selectOption('delta-profile');
  await expect(page.getByRole('combobox', { name: 'Cells', exact: true })).toHaveValue('profile');
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  const after = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any;
    return { start: p.footprintStatus.collectionStartedAt, range: p.engine.visibleRange(), subscriptions: t.profileSubscriptions,
      samePrimitive: p.engine.footprint === t.profilePrimitive, options: p.engine.footprint.options(), delta: p.engine.footprint.stats()[0].delta };
  });
  expect(after).toMatchObject({ ...before, subscriptions: 1, samePrimitive: true, options: { displayMode: 'delta', cellStyle: 'profile' }, delta: 7 });
  await page.screenshot({ path: 'artifacts/footprint-delta-profile-1366x768.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(400); await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await footprintSettings(panel); await expect(page.getByRole('combobox', { name: 'Cell display', exact: true })).toHaveValue('delta-profile');
  await expect(page.getByRole('combobox', { name: 'Cells', exact: true })).toHaveValue('profile');
});

test('volume delta candle shows paired profiles without embedded totals or restarting collection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'dark' }); const worker = await installDepthFixture(page);
  await freezeFixtureTimeToLatestCandle(page, worker);
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const t = (window as any).__terminal; t.profileSubscriptions = 0;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      t.profileSubscriptions++;
      const time = Math.floor(Date.now() / 60000) * 60, start = Date.now();
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [0, 1, 2].map((n) => ({ time: time - (2-n)*60, rowSize, revision: 1,
        cells: [{ price: 83000, bidVol: 2, askVol: 12 }, { price: 82975, bidVol: 8, askVol: 3 }, { price: 82950, bidVol: 1, askVol: 3 }],
        open: 82960, high: 83020, low: 82955, close: 83010, delta: 7, minDelta: -5, maxDelta: 10, coverage: 'partial', gapBefore: false })),
        retentionStart: time, status: { state: 'live', message: 'Explicit test trades', lastUpdate: start, collectionStartedAt: start, coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await addIndicator(panel, 'Order-book Heatmap');
  await expectHeatmapLiveQuiet(panel);
  await worker.evaluate(() => {
    const socket = (self as any).__heatmapFixture.socket, previous = socket.last;
    socket.last++;
    socket.onmessage({ data: JSON.stringify({ e: 'depthUpdate', s: 'BTCUSDT', U: socket.last, u: socket.last, pu: previous,
      b: [[82930, 15]], a: [[83050, 10]] }) });
  });
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprintBars.length)).toBe(3);
  const before = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any; t.profilePrimitive = p.engine.footprint;
    return { start: p.footprintStatus.collectionStartedAt, range: p.engine.visibleRange() };
  });
  await footprintSettings(panel);
  await page.getByRole('combobox', { name: 'Cell display', exact: true }).selectOption('volume-delta-candle');
  await expect(page.getByRole('combobox', { name: 'Cells', exact: true })).toHaveValue('profile');
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  const after = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any;
    return { start: p.footprintStatus.collectionStartedAt, range: p.engine.visibleRange(), subscriptions: t.profileSubscriptions,
      samePrimitive: p.engine.footprint === t.profilePrimitive, options: p.engine.footprint.options(), delta: p.engine.footprint.stats()[0].delta };
  });
  expect(after).toMatchObject({ ...before, subscriptions: 1, samePrimitive: true, options: { displayMode: 'bidask', cellStyle: 'profile', statsPosition: 'bottom', statsRows: [], showCandle: true, showValueArea: true, textColorMode: 'dominant' }, delta: 7 });
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    p.engine.chart.timeScale.setBarSpacing(200); p.engine.chart.timeScale.setRightOffset(1);
    p.engine.chart.panes()[0].priceScale.setAutoScale(false);
    p.engine.chart.panes()[0].priceScale.setFixedRange({ min: 82900, max: 83075 }); p.engine.chart.setAutoScale(false);
  });
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprint.cellFont)).toBeGreaterThan(15);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.heatmap.bins.some((b: any) => b.low === 82925 && b.bid > 0))).toBe(true);
  await page.screenshot({ path: 'artifacts/footprint-volume-delta-candle-1366x768.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.plotRect(0).width)).toBeLessThan(360);
  await page.screenshot({ path: 'artifacts/footprint-volume-delta-candle-720x860.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(400); await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await footprintSettings(panel); await expect(page.getByRole('combobox', { name: 'Cell display', exact: true })).toHaveValue('volume-delta-candle');
  await expect(page.getByRole('combobox', { name: 'Cells', exact: true })).toHaveValue('profile');
  await expect(page.getByRole('combobox', { name: 'Totals position', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('smaller bid profile remains visible beneath enlarged quantity labels',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});await installDepthFixture(page);const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const t=(window as any).__terminal;
    t.feed.subscribeFootprint=(_id:string,_s:any,rowSize:number,callback:any)=>{
      const time=Math.floor(Date.now()/60000)*60;
      queueMicrotask(()=>callback({type:'footprint-snapshot',bars:[{time,rowSize,revision:1,cells:[{price:83012.5,bidVol:4.07,askVol:8.36}],open:83002,high:83021,low:83002,close:83018,delta:4.29,minDelta:0,maxDelta:4.29,coverage:'partial',gapBefore:false}],retentionStart:time,status:{state:'live',message:'Explicit profile test',lastUpdate:Date.now(),collectionStartedAt:Date.now(),coverage:'partial',tickSize:.1,rowSize}}));return()=>{};
    };
  });
  await setFootprint(panel,true);await footprintSettings(panel);await page.getByRole('combobox',{name:'Cell display',exact:true}).selectOption('volume-delta-candle');await panel.locator('.footprint-settings-dialog').getByRole('button',{name:'Apply',exact:true}).click();
  await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;p.engine.chart.timeScale.setBarSpacing(280);p.engine.chart.timeScale.setRightOffset(1);p.engine.chart.panes()[0].priceScale.setAutoScale(false);p.engine.chart.panes()[0].priceScale.setFixedRange({min:82925,max:83100});p.engine.chart.setAutoScale(false);});
  await expect.poll(()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.footprint.cellFont)).toBeGreaterThan(20);
  await panel.locator('.chart-stage').screenshot({path:'artifacts/footprint-profile-visible-bar.png'});
  await footprintSettings(panel);
  await page.getByRole('combobox',{name:'Cell display',exact:true}).selectOption('delta-profile');
  await expect(panel.getByLabel('Show execution candle',{exact:true})).toBeChecked();
  await panel.locator('.footprint-settings-dialog').getByRole('button',{name:'Apply',exact:true}).click();
  await page.waitForTimeout(100);
  await panel.locator('.chart-stage').screenshot({path:'artifacts/footprint-delta-visible-candle.png'});
  await footprintSettings(panel);await panel.getByLabel('Show execution candle',{exact:true}).uncheck();
  await panel.locator('.footprint-settings-dialog').getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.footprint.options().showCandle)).toBe(false);
  await page.waitForTimeout(100);
  await panel.locator('.chart-stage').screenshot({path:'artifacts/footprint-delta-hidden-candle.png'});
  await page.waitForTimeout(400);await page.reload();await footprintSettings(panel);
  await expect(panel.getByLabel('Show execution candle',{exact:true})).not.toBeChecked();
});

test('footprint quantity labels remain readable over low-contrast red and green fills', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const dock = terminal.dock;
    if (dock.panels.length > 1) dock.removePanel(dock.panels[1]);
    terminal.feed.subscribeFootprint = (_id: string, _series: any, rowSize: number, callback: any) => {
      const time = Math.floor(Date.now() / 60_000) * 60;
      const cells = [
        { price: 83075, bidVol: 52.2, askVol: 31.5 },
        { price: 83050, bidVol: 108, askVol: 5.9 },
        { price: 83025, bidVol: 86.6, askVol: 39.4 },
        { price: 83000, bidVol: 62.3, askVol: 22.8 },
        { price: 82975, bidVol: 3.7, askVol: 1.14 },
        { price: 82950, bidVol: .734, askVol: 0 },
      ];
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells, delta: -200 }],
        retentionStart: time, status: { state: 'live', message: 'Explicit contrast fixture', lastUpdate: Date.now(),
          collectionStartedAt: Date.now(), coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprintBars.length)).toBe(1);
  await page.evaluate(() => {
    const view = [...(window as any).__terminal.panels.values()][0] as any;
    view.engine.setFootprintOptions({ displayMode: 'bidask', cellStyle: 'ladder', textColorMode: 'side',
      buyColor: '#58a65c', buyTextColor: '#58a65c', sellColor: '#ad5858', sellTextColor: '#ad5858',
      showCandle: false, showPoc: false, showValueArea: false });
    view.engine.setFootprintOpacity(.35);
    view.engine.chart.timeScale.setBarSpacing(200);
    view.engine.chart.timeScale.setRightOffset(1);
    view.engine.chart.panes()[0].priceScale.setAutoScale(false);
    view.engine.chart.panes()[0].priceScale.setFixedRange({ min: 82925, max: 83125 });
    view.engine.chart.setAutoScale(false);
  });
  await page.waitForTimeout(150);
  await panel.locator('.chart-stage').screenshot({ path: 'artifacts/footprint-text-contrast-dark-1366x768.png' });

  await page.locator('#theme').selectOption('light');
  await page.evaluate(() => {
    const view = [...(window as any).__terminal.panels.values()][0] as any;
    view.engine.setFootprintOpacity(.85);
    view.engine.chart.timeScale.setBarSpacing(200);
  });
  await page.waitForTimeout(150);
  await panel.locator('.chart-stage').screenshot({ path: 'artifacts/footprint-text-contrast-light-1366x768.png' });
});

test('dense synthetic footprint stays crisp at DPR 1 and 2', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const captureDense = async (target: typeof page, path: string, scale: 'css' | 'device') => {
    await target.setViewportSize({ width: 1440, height: 768 });
    await target.emulateMedia({ colorScheme: 'dark' });
    await installDepthFixture(target);
    await target.locator('#theme').selectOption('dark');
    const panel = target.locator('.candle-panel').first();
    // Give the footprint its normal full-width chart surface so all twelve
    // bars can show representative BTC quantities without shrinking the font.
    await target.evaluate(() => {
      const dock = (window as any).__terminal.dock;
      if (dock.panels.length > 1) dock.removePanel(dock.panels[1]);
      const panel = [...(window as any).__terminal.panels.values()][0];
      if (!panel.objectTreeSidebarPreferences.collapsed) panel.toggleObjectsPanel();
    });
    await target.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.feed.subscribeFootprint = (_id: string, _series: any, rowSize: number, callback: any) => {
      const latest = Math.floor(Date.now() / 60_000) * 60;
      const quantities = [0, .734, 1.03, 12.4, 100];
      const bars = Array.from({ length: 12 }, (_, barIndex) => {
        const cells = Array.from({ length: 18 }, (_, rowIndex) => ({
          price: 83000 + (8.5 - rowIndex) * rowSize,
          bidVol: quantities[(barIndex + rowIndex * 3) % quantities.length]!,
          askVol: quantities[(barIndex * 5 + rowIndex * 2 + 1) % quantities.length]!,
        }));
        return {
          time: latest - (11 - barIndex) * 60,
          rowSize,
          revision: 1,
          cells,
          open: cells[8]!.price,
          high: cells[0]!.price + rowSize / 2,
          low: cells[17]!.price - rowSize / 2,
          close: cells[6]!.price,
          delta: cells.reduce((sum, cell) => sum + cell.askVol - cell.bidVol, 0),
          coverage: 'partial',
          gapBefore: false,
        };
      });
      const start = Date.now();
      queueMicrotask(() => callback({
        type: 'footprint-snapshot', bars, retentionStart: bars[0]!.time,
        status: { state: 'live', message: 'Explicit dense visual fixture', lastUpdate: start,
          collectionStartedAt: start, coverage: 'partial', tickSize: .1, rowSize },
      }));
      return () => {};
    };
    });
    await setFootprint(panel, true);
    await expect.poll(() => target.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprintBars.length)).toBe(12);
    await expect.poll(() => target.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.plotRect(0).width)).toBeGreaterThan(1200);
    const quantityTexts = [0, .734, 1.03, 12.4, 100].map(compactVol);
    const metrics = await target.evaluate((texts: string[]) => {
      const view = [...(window as any).__terminal.panels.values()][0] as any;
      const chart = view.engine.chart;
      chart.timeScale.setBarSpacing(100);
      chart.timeScale.setRightOffset(1);
      chart.panes()[0].priceScale.setAutoScale(false);
      chart.panes()[0].priceScale.setFixedRange({ min: 82750, max: 83250 });
      chart.setAutoScale(false);
      const footprint = view.engine.footprint;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `600 ${footprint.cellFont * window.devicePixelRatio}px ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace`;
      return { cellFont: footprint.cellFont, spacing: chart.timeScale.barSpacing,
        plotWidth: chart.plotRect(0).width, cellsPerBar: view.engine.footprintBars[0]?.cells.length,
        sampleVolumes: [...new Set(view.engine.footprintBars.flatMap((bar: any) => bar.cells.flatMap((cell: any) => [cell.bidVol, cell.askVol])))],
        quantityWidths: texts.map(value => ({ value, width: ctx.measureText(value).width })),
        options: footprint.options(), dpr: window.devicePixelRatio };
    }, quantityTexts);
    const normalGeometry = footprintColumn(metrics.options, metrics.spacing);
    const normalWidth = normalGeometry.cells / 2 * metrics.dpr;
    const normalPadding = 4 * metrics.dpr;
    expect(metrics).toMatchObject({ spacing: 100, cellsPerBar: 18, dpr: scale === 'device' ? 2 : 1 });
    expect(metrics.plotWidth).toBeGreaterThanOrEqual(12 * metrics.spacing);
    expect(metrics.sampleVolumes).toEqual(expect.arrayContaining([0, .734, 1.03, 12.4, 100]));
    expect(metrics.cellFont).toBeGreaterThanOrEqual(9);
    expect(metrics.cellFont).toBeLessThanOrEqual(12);
    expect(metrics.quantityWidths.every(({ width }: any) => width + normalPadding <= normalWidth)).toBe(true);
    await target.waitForTimeout(150);
    await target.screenshot({ path, scale });

    // At the original small zoom, long decimals must be omitted when they do
    // not fit. A short zero still fits; no precision is shortened to force it.
    await target.waitForTimeout(50);
    const narrow = await target.evaluate((texts: string[]) => {
      const view = [...(window as any).__terminal.panels.values()][0] as any;
      const chart = view.engine.chart;
      chart.timeScale.setBarSpacing(44);
      const footprint = view.engine.footprint;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `600 ${footprint.cellFont * window.devicePixelRatio}px ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace`;
      return { spacing: chart.timeScale.barSpacing, options: footprint.options(),
        widths: texts.map(value => ({ value, width: ctx.measureText(value).width })), dpr: window.devicePixelRatio };
    }, quantityTexts);
    const narrowGeometry = footprintColumn(narrow.options, narrow.spacing);
    const narrowWidth = narrowGeometry.cells / 2 * narrow.dpr;
    const narrowPadding = 4 * narrow.dpr;
    const decimalWidth = narrow.widths.find(({ value }: any) => value === '0.734')!.width;
    const zeroWidth = narrow.widths.find(({ value }: any) => value === '0')!.width;
    expect(narrow.spacing).toBe(44);
    expect(decimalWidth + narrowPadding).toBeGreaterThan(narrowWidth);
    expect(zeroWidth + narrowPadding).toBeLessThanOrEqual(narrowWidth);
  };

  await captureDense(page, 'artifacts/footprint-dense-12x18-1440x768.png', 'css');
  const highDensityPage = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  try {
    await captureDense(highDensityPage, 'artifacts/footprint-dense-12x18-1440x768-dpr2.png', 'device');
  } finally {
    await highDensityPage.close();
  }
});

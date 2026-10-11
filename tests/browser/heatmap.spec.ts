import { addIndicator, setFootprint, setPriceLevel, setUnits, footprintSettings } from './indicator-actions';
import { test, expect, type Page } from '@playwright/test';

import { installDepthFixture } from './depth-fixture';

async function expectCandleColumns(page: Page) {
  const columns = await page.evaluate(() => {
    const engine = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    const seen = new Set<string>();
    return engine.heatmap.bins.map((b: any) => {
      const key = `${b.columnStart}:${b.low}:${b.high}`;
      const duplicate = seen.has(key); seen.add(key);
      const index = engine.chart.dataLayer.timeToIndex(b.columnStart / 1000);
      const centre = engine.chart.timeScale.indexToX(index), spacing = engine.chart.timeScale.barSpacing;
      const opts = engine.footprintOptions, column = Math.max(.1, Math.min(opts.cellWidth ?? spacing * opts.widthFactor, spacing * .96));
      const candle = opts.showCandle && column >= 20 ? Math.min(9, column * .15) : 0;
      return { duplicate, leftError: b.x - (engine.mode === 'footprint' ? centre-column/2 : engine.chart.timeScale.indexToX(index - .5)),
        rightError: b.right - (engine.mode === 'footprint' ? centre+column/2 : engine.chart.timeScale.indexToX(index + .5)) };
    });
  });
  expect(columns.length).toBeGreaterThan(0);
  for (const c of columns) { expect(c.duplicate).toBe(false); expect(c.leftError).toBeCloseTo(0); expect(c.rightError).toBeCloseTo(0); }
}


test('worker heatmap shares depth studies, survives chart switching, hidden tabs and disposal', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const worker = await installDepthFixture(page), panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order-book Heatmap');
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.bins)).toBeGreaterThan(0);
  await expectCandleColumns(page);
  const first = await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap);
  expect(first.mounted).toBe(true);
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await panel.getByRole('button', { name: 'Add Binance depth band', exact: true }).click();
  await expect(panel.locator('.indicator-picker .dialog-status')).toContainText('added with its default settings', { timeout: 10000 });
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(1100);
  const diagnostics = await worker.evaluate(() => (self as any).__heatmapFixture);
  expect(diagnostics.sockets).toBe(1); expect(diagnostics.active).toBe(1);
  const heatStart = (await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.status)).collectionStart;
  // Supply session executed OHLC through a separate explicit test fixture, never depth disguised as volume.
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, _r: number, callback: any) => {
      const time = Math.floor(Date.now() / 60000) * 60;
      const status = { state: 'live', message: 'Explicit test observations', lastUpdate: Date.now(), tickSize: .1, rowSize: _r, collectionStartedAt: Date.now(), coverage: 'partial' };
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, revision: 1, rowSize: _r, open: 82990, high: 83010, low: 82980, close: 83000, delta: 1, minDelta: 0, maxDelta: 1, cells: [{ price: 83000, bidVol: 1, askVol: 2 }], coverage: 'partial', gapBefore: false }], retentionStart: time, status }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.surfaceMounted)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.bins)).toBeGreaterThan(0);
  await expectCandleColumns(page);
  const footprintStart = (await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.status)).collectionStart;
  expect(footprintStart).toBeGreaterThanOrEqual(heatStart);
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  await expect(panel.getByLabel('Price row (USDT)', { exact: true })).toBeDisabled();
  await expect(panel.getByLabel('Price row (USDT)', { exact: true })).toHaveValue('25');
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Close', exact: true }).click();
  const rows = () => page.evaluate(() => {
    const e = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    return e.heatmap.bins.map((b: any) => ({ low: b.low, high: b.high, y: b.y, bottom: b.bottom,
      topExpected: e.chart.panes()[0].priceScale.priceToY(b.high),
      bottomExpected: e.chart.panes()[0].priceScale.priceToY(b.low) }));
  });
  for (const row of await rows()) { expect(row.high-row.low).toBe(25); expect(row.y).toBeCloseTo(row.topExpected); expect(row.bottom).toBeCloseTo(row.bottomExpected); }
  const alignedHover = await page.evaluate(() => {
    const e = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    const b = e.heatmap.bins.find((b: any) => b.low === 83000);
    const x = b.x + (b.right-b.x)/4;
    return [e.footprintAt(x,b.y+.1)?.price, e.footprintAt(x,b.bottom-.1)?.price,
      e.footprintAt(x,b.y-.1)?.price ?? null, e.footprintAt(x,b.bottom+.1)?.price ?? null];
  });
  expect(alignedHover).toEqual([83000,83000,null,null]);
  const bucketPoint = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const bin = p.engine.heatmap.bins.find((b: any) => b.low === 83000), box = p.element.querySelector('.chart-stage').getBoundingClientRect();
    return { x: box.left + bin.x + (bin.right-bin.x)/4, y: box.top + (bin.y + bin.bottom) / 2 };
  });
  await page.mouse.move(bucketPoint.x, bucketPoint.y);
  await expect(panel.locator('.ohlc')).toContainText('83,000–83,025 USDT (upper exclusive)');
  await page.screenshot({ path: 'artifacts/footprint-fixed-bucket-1366x768.png' });
  await setPriceLevel(panel, '50');
  await expect.poll(async () => (await rows()).some((b: any) => b.high-b.low !== 50)).toBe(false);
  await expect.poll(async () => (await rows()).length).toBeGreaterThan(0);
  for (const row of await rows()) expect(row.low/50).toBeCloseTo(Math.round(row.low/50));
  expect(await worker.evaluate(() => (self as any).__heatmapFixture.sockets)).toBe(1);
  const hover = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const plot = p.engine.chart.plotRect(0);
    const bin = p.engine.heatmap.bins.find((b: any) => b.bid > 0 && b.x < plot.width && b.right > 0 && b.y < plot.height && b.bottom > 0);
    return bin ? { x: (Math.max(0, bin.x) + Math.min(plot.width, bin.right)) / 2,
      y: (Math.max(0, bin.y) + Math.min(plot.height, bin.bottom)) / 2 } : null;
  });
  expect(hover).not.toBeNull(); const bounds = await panel.locator('.chart-stage').boundingBox();
  await page.mouse.move(bounds!.x + hover!.x, bounds!.y + hover!.y);
  await expect(panel.locator('.heatmap-readout')).toContainText('Resting');
  await expect(panel.locator('.ohlc')).toContainText('BTC');
  await page.screenshot({ path: 'artifacts/orderbook-heatmap-footprint-1366x768.png' });
  await setFootprint(panel, false);
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  const candleStart = (await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.status)).collectionStart;
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  await panel.getByLabel('Opacity', { exact: true }).fill('0.3');
  await panel.locator('dialog.heatmap-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.status)).collectionStart).toBe(candleStart);
  // Hidden charts collect without painting; a second consumer keeps the book alive when the first closes.
  await page.evaluate(() => { const t = (window as any).__terminal; t.addChart({ venue: 'binance', interval: '1m', type: 'candle', heatmap: { enabled: true } }); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const t = (window as any).__terminal, dock = t.dock; t.heatmapHiddenId = dock.panels[2].id; dock.panels[2].api.moveTo({ group: dock.panels[0].api.group }); dock.getPanel([...t.panels.keys()][0]).api.setActive(); });
  const hiddenBefore = await page.evaluate(() => (window as any).__terminal.stats().panels[2]); await page.waitForTimeout(1100);
  const hiddenAfter = await page.evaluate(() => (window as any).__terminal.stats().panels[2]);
  expect(hiddenBefore.visible).toBe(false); expect(hiddenAfter.heatmap.draws).toBe(hiddenBefore.heatmap.draws);
  await page.evaluate(() => { const t = (window as any).__terminal; t.dock.getPanel(t.heatmapHiddenId).api.setActive(); });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[2].heatmap.draws)).toBeGreaterThan(hiddenAfter.heatmap.draws);
  expect(await worker.evaluate(() => (self as any).__heatmapFixture.sockets)).toBe(1);
  await page.evaluate(() => { const t = (window as any).__terminal; for (const p of [...t.dock.panels]) p.api.close(); });
  await expect.poll(() => worker.evaluate(() => (self as any).__heatmapFixture.active)).toBe(0); expect(errors).toEqual([]);
});

test('heatmap labels, settings, resize, unsupported instruments and saved layouts', async ({ page }) => {
  await installDepthFixture(page); const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order-book Heatmap');
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  // Explicit long session tiles exercise actual primitive LOD and labels, independent of wall-clock wait.
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, engine = p.engine;
    p.releaseHeatmap?.(); p.releaseHeatmap = undefined;
    const end = Date.now(), start = Math.floor((end - 60000) / 500) * 500, buckets = [];
    for (let time = start; time < end; time += 500) {
      const cells = new Float64Array([82980, 10000, 0, 20, 0, 500, 500, 500, 500, 829800000, 0, 1659600, 0, 82990, 15000, 0, 30, 0, 500, 500, 500, 500, 1244850000, 0, 2489700, 0, 83000, 0, 12500, 0, 25, 500, 500, 500, 500, 0, 1037500000, 0, 2075000]);
      buckets.push({ id: `fixture:${time}`, start: time, end: time + 500, epoch: 100, revision: 1, rowSize: 10, capacityLimited: false, cells, peaks: new Float64Array() });
    }
    engine.setSnapshot(Array.from({ length: 5 }, (_, i) => ({ t: Math.floor(end / 60000) * 60000 - (4-i)*60000, o: 82985+i*2, h: 83005+i*2, l: 82975+i*2, c: 82995+i*2, v: 2, revision: 1, closed: i<4 })), false);
    engine.updateHeatmap(buckets, true, start); engine.chart.timeScale.setBarSpacing(320); engine.chart.timeScale.setRightOffset(0);
    engine.chart.panes()[0].priceScale.setAutoScale(false); engine.chart.panes()[0].priceScale.setFixedRange({ min: 82950, max: 83050 });
    engine.chart.setAutoScale(false);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.labels)).toBeGreaterThan(0);
  await expectCandleColumns(page);
  // A forming tile revision changes quantities, never the candle column's bounds.
  const revision = await page.evaluate(() => {
    const engine = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    const before = engine.heatmap.bins.map((b: any) => ({ x: b.x, right: b.right, bid: b.bid }));
    const buckets = engine.heatmap.buckets.map((b: any) => {
      const cells = b.cells.slice(); for (let i = 0; i < cells.length; i += 13) { cells[i + 1] *= 2; cells[i + 9] *= 2; }
      return { ...b, revision: b.revision + 1, cells };
    });
    engine.updateHeatmap(buckets, true, buckets[0].start);
    return before;
  });
  await expect.poll(() => page.evaluate(() => {
    const engine = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    return Math.max(...engine.heatmap.bins.map((b: any) => b.bid));
  })).toBe(60);
  const revised = await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.heatmap.bins.map((b: any) => ({ x: b.x, right: b.right })));
  expect(revised).toEqual(revision.map(({ x, right }: { x: number; right: number }) => ({ x, right })));
  await page.screenshot({ path: 'artifacts/heatmap-quantity-labels-1366x768.png' });
  const beforeResize = await page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.draws);
  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.draws)).toBeGreaterThan(beforeResize);
  await page.screenshot({ path: 'artifacts/heatmap-quantity-labels-720x860.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  const plot = await panel.locator('.chart-stage').boundingBox();
  const priceRange = () => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.panes()[0].priceScale.priceRange());
  const beforeWheel = await priceRange();
  await page.mouse.move(plot!.x + plot!.width / 2, plot!.y + plot!.height / 2);
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => { const r = await priceRange(); return r.max - r.min; }).toBeLessThan(beforeWheel.max - beforeWheel.min);
  const beforePan = await priceRange();
  await page.mouse.down(); await page.mouse.move(plot!.x + plot!.width / 2 + 30, plot!.y + plot!.height / 2 + 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await priceRange()).min).not.toBe(beforePan.min);
  // The layer neither captures pan gestures nor forces autoscale back to captured book depth.
  await page.evaluate(() => { const p = [...(window as any).__terminal.panels.values()][0] as any; p.engine.chart.panes()[0].priceScale.setFixedRange({ min: 82950, max: 83050 }); p.engine.chart.setAutoScale(false); });

  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  await panel.getByLabel('Quantity labels', { exact: true }).selectOption('off');
  await panel.getByLabel('Price row (USDT)', { exact: true }).fill('1.25');
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.locator('dialog.heatmap-settings')).toBeVisible();
  await panel.getByLabel('Price row (USDT)', { exact: true }).fill('10');
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.labels)).toBe(0);
  await page.setViewportSize({ width: 720, height: 860 });
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  await page.screenshot({ path: 'artifacts/orderbook-heatmap-settings-720x860.png' });
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(400); await page.reload(); await page.waitForFunction(() => (window as any).__terminal?.stats().panels[0].series.heatmap.enabled);
  await expect(panel.getByRole('button', { name: 'Hide Order-book Heatmap', exact: true })).toHaveAttribute('aria-pressed','true');
  await panel.getByLabel('Instrument', { exact: true }).selectOption('binance:spot');
  await expect(panel.locator('.heatmap-notice')).toContainText('unavailable');
});

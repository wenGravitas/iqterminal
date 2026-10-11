import { test, expect } from '@playwright/test';

test('axis grid follows price/time transforms, settings persist on candles and footprint', async ({ page }) => {
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__axisPaint = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth?) {
      const panel = this.canvas.closest('.candle-panel');
      if (panel && panel === document.querySelector('.candle-panel') && (this.textBaseline === 'top' || this.textBaseline === 'middle')) {
        const paint = (window as any).__axisPaint;
        paint.push({ text, x, y, align: this.textAlign, baseline: this.textBaseline });
        if (paint.length > 200) paint.shift();
      }
      if (maxWidth === undefined) draw.call(this, text, x, y); else draw.call(this, text, x, y, maxWidth);
    };
  });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const geometry = () => page.evaluate(() => {
    const e = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    return { ...e.axisGrid.geometry, prices: e.axisGrid.geometry.price.map((t: any) => e.chart.panes()[0].priceScale.priceToY(t.value)),
      times: e.axisGrid.geometry.time.map((t: any) => e.chart.timeScale.indexToX(t.value)), native: (window as any).__axisPaint };
  });
  await expect.poll(async () => (await geometry()).time.length).toBeGreaterThan(0);
  // Capture a fresh native paint: axis labels and primitive use the same coordinates.
  await page.evaluate(() => { const e = ([...(window as any).__terminal.panels.values()][0] as any).engine; (window as any).__axisPaint = []; e.chart.setGridOptions({ vertLines: false, horzLines: false }); });
  await expect.poll(() => page.evaluate(() => (window as any).__axisPaint.length)).toBeGreaterThan(0);
  const before = await geometry();
  const dpr = await page.evaluate(() => devicePixelRatio);
  for (let i = 0; i < before.time.length; i++) {
    expect(before.time[i].coordinate).toBeCloseTo(before.times[i], 0);
    expect(before.native.some((p: any) => p.align === 'center' && p.baseline === 'top' && Math.abs(p.x / dpr - before.time[i].coordinate) < 1)).toBe(true);
  }
  for (let i = 0; i < before.price.length; i++) {
    expect(before.price[i].coordinate).toBeCloseTo(before.prices[i], 0);
    // Last-price tags may occlude individual ticks; other visible tick labels align.
  }
  expect(before.native.filter((p: any) => p.align === 'left' && p.baseline === 'middle').some((p: any) => before.price.some((t: any) => Math.abs(p.y / dpr - t.coordinate) < 1))).toBe(true);
  await page.evaluate(() => { const e = ([...(window as any).__terminal.panels.values()][0] as any).engine; e.chart.timeScale.scrollByPixels(35); });
  await expect.poll(async () => JSON.stringify((await geometry()).time)).not.toBe(JSON.stringify(before.time));
  const panned = await geometry();
  const stage = panel.locator('.chart-stage'), box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -120);
  await expect.poll(async () => JSON.stringify((await geometry()).price)).not.toBe(JSON.stringify(panned.price));
  const zoomed = await geometry();
  expect(zoomed.time).not.toEqual(panned.time);
  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await panel.getByLabel('Gridlines', { exact: true }).uncheck();
  await expect.poll(async () => (await geometry()).time.length + (await geometry()).price.length).toBe(0);
  await panel.locator('.chart-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'artifacts/chart-grid-off-1366x768.png' });
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, row: number, callback: any) => {
      const time = Math.floor(Date.now()/60000)*60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, revision: 1, rowSize: row, open: 83000, high: 83025, low: 82975, close: 83000,
        delta: 1, minDelta: 0, maxDelta: 1, cells: [{ price: 83000, bidVol: 1, askVol: 2 }], coverage: 'partial', gapBefore: false }], retentionStart: time,
        status: { state: 'live', message: 'Explicit test executions', lastUpdate: Date.now(), tickSize: .1, rowSize: row, collectionStartedAt: Date.now(), coverage: 'partial' } }));
      return () => {};
    };
  });
  await panel.getByLabel('Chart type', { exact: true }).selectOption('footprint');
  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await expect(panel.getByLabel('Gridlines')).not.toBeChecked(); await panel.getByLabel('Gridlines').check();
  await panel.locator('.chart-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(async () => (await geometry()).price.length).toBeGreaterThan(0);
  const footprint = await geometry();
  for (let i = 0; i < footprint.time.length; i++) expect(footprint.time[i].coordinate).toBeCloseTo(footprint.times[i], 0);
  await page.screenshot({ path: 'artifacts/chart-grid-footprint-1366x768.png' });
  await panel.getByLabel('Chart type', { exact: true }).selectOption('candle');
  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await panel.getByLabel('Gridlines').uncheck(); await panel.locator('.chart-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click(); await expect(panel.getByLabel('Gridlines')).not.toBeChecked();
  await page.setViewportSize({ width: 720, height: 860 }); await page.screenshot({ path: 'artifacts/chart-grid-settings-720x860.png' });
  expect(errors).toEqual([]);
});

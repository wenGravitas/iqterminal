import { expect, test } from '@playwright/test';
import { installTradeFixture } from './trade-fixture';

test('a ticker execution hovers at its exact price and time on matching charts only, then clears', async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  const worker = await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker').first();
  await expect.poll(() => worker.evaluate(() => (self as any).__tradeFixture.active)).toBe(1);

  const chart = await page.evaluate(() => {
    const panels = [...(window as any).__terminal.panels.values()];
    const binance = panels.find((panel: any) => panel.series.venue === 'binance' && panel.series.market === 'perpetual');
    const other = panels.find((panel: any) => panel.series.venue === 'hyperliquid' && panel.series.market === 'perpetual');
    if (!binance || !other) throw new Error('Fixture must include Binance and Hyperliquid perpetual charts');
    const range = binance.engine.chart.panes()[0].priceScale.priceRange();
    return {
      id: binance.params.api.id as string,
      otherId: other.params.api.id as string,
      price: (range.min + range.max) / 2,
      drawings: binance.engine.drawings.drawings().map((drawing: any) => drawing.id as string),
      objects: binance.engine.objects.list().map((item: any) => item.id as string),
    };
  });
  const emitted = await worker.evaluate(({ price }) => (self as any).__tradeFixture.emit(10, 'buy', undefined, 30_000, 'perpetual', price), { price: chart.price });
  if (!emitted) throw new Error('Fixture execution was not emitted');
  const executionId = 'binance:perpetual:BTCUSDT:agg:1';
  const row = ticker.locator(`.ticker-row[data-execution-id="${executionId}"]`);
  await expect(row).toHaveCount(1);
  await row.hover();
  const card = ticker.locator('.ticker-tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Trade Ticker');
  await expect(card).toContainText('Buy');
  await expect(card).toContainText('10 BTC');
  await expect(card).toContainText('USDT');
  await expect(row).not.toHaveAttribute('title');

  const inspection = () => page.evaluate(({ id, otherId, timeMs, price }) => {
    const terminal = (window as any).__terminal;
    const panel = terminal.panels.get(id);
    const other = terminal.panels.get(otherId);
    const chart = panel.engine.chart;
    const logicalIndex = chart.dataLayer.timeToIndexFloat(timeMs / 1000);
    const expectedX = chart.timeScale.indexToX(logicalIndex);
    const expectedY = chart.panes()[0].priceScale.priceToY(price);
    return {
      ray: panel.diagnostics().executionHoverRay,
      otherRay: other.diagnostics().executionHoverRay,
      expectedX,
      expectedY,
      drawings: panel.engine.drawings.drawings().map((drawing: any) => drawing.id),
      objects: panel.engine.objects.list().map((item: any) => item.id),
    };
  }, { id: chart.id, otherId: chart.otherId, timeMs: emitted.timeMs, price: emitted.price });
  await expect.poll(async () => (await inspection()).ray.active).toBe(true);
  const active = await inspection();
  expect(active.ray.geometry).toMatchObject({ executionId, timeMs: emitted.timeMs, price: emitted.price });
  expect(active.ray.geometry.logicalIndex).toBeGreaterThan(0);
  expect(Math.abs(active.ray.geometry.anchorX - active.expectedX)).toBeLessThan(0.01);
  expect(Math.abs(active.ray.geometry.y - active.expectedY)).toBeLessThan(0.01);
  expect(active.ray.geometry.endX).toBeGreaterThan(active.ray.geometry.startX);
  expect(active.otherRay.active).toBe(false);
  expect(active.drawings).toEqual(chart.drawings);
  expect(active.objects).toEqual(chart.objects);
  await page.screenshot({ path: testInfo.outputPath('ticker-execution-hover-ray.png') });

  await ticker.locator('.ticker-status').hover();
  await expect(card).toBeHidden();
  await expect.poll(async () => (await inspection()).ray.active).toBe(false);

  await row.hover();
  await expect.poll(async () => (await inspection()).ray.active).toBe(true);
  // Exercise a chart selection while the pointer remains over the same row: the
  // mismatching instrument clears immediately and returning to BTC perp restores it.
  await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.instrument.value = 'binance:spot';
    panel.select();
  }, chart.id);
  await expect.poll(async () => (await inspection()).ray.active).toBe(false);
  await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.instrument.value = 'binance:perpetual';
    panel.select();
  }, chart.id);
  await expect.poll(async () => (await inspection()).ray.active).toBe(true);

  const tickerId = await page.evaluate(() => [...(window as any).__terminal.tickers.keys()][0] as string);
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id)?.api.close(), tickerId);
  await expect.poll(async () => (await inspection()).ray.active).toBe(false);
});

test('double-click or Enter adds one editable native execution ray per matching chart', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const worker = await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker').first();
  await expect.poll(() => worker.evaluate(() => (self as any).__tradeFixture.active)).toBe(1);

  const charts = await page.evaluate(() => {
    const panels = [...(window as any).__terminal.panels.values()];
    const binance = panels.find((panel: any) => panel.series.venue === 'binance' && panel.series.market === 'perpetual');
    const other = panels.find((panel: any) => panel.series.venue === 'hyperliquid' && panel.series.market === 'perpetual');
    if (!binance || !other) throw new Error('Fixture must include Binance and Hyperliquid perpetual charts');
    return {
      id: binance.params.api.id as string,
      otherId: other.params.api.id as string,
      initialIds: binance.engine.drawings.drawings().map((drawing: any) => drawing.id as string),
      otherInitialIds: other.engine.drawings.drawings().map((drawing: any) => drawing.id as string),
      undoCount: binance.engine.drawings.historySteps().undo.length as number,
      price: (binance.engine.chart.panes()[0].priceScale.priceRange().min + binance.engine.chart.panes()[0].priceScale.priceRange().max) / 2,
    };
  });
  const first = await worker.evaluate(({ price }) => (self as any).__tradeFixture.emit(.25, 'buy', 71, 0, 'perpetual', price), { price: charts.price });
  if (!first) throw new Error('Fixture execution was not emitted');
  const firstRow = ticker.locator('.ticker-row[data-execution-id="binance:perpetual:BTCUSDT:agg:71"]');
  await expect(firstRow).toHaveCount(1);
  await expect(firstRow).not.toHaveAttribute('title');
  await firstRow.dblclick();

  const committed = () => page.evaluate(({ id, otherId }) => {
    const panels = (window as any).__terminal.panels;
    const panel = panels.get(id), other = panels.get(otherId);
    return {
      drawings: panel.engine.drawings.drawings().map((drawing: any) => ({ id: drawing.id, tool: drawing.tool, points: drawing.points, text: drawing.text, props: drawing.props })),
      historyCount: panel.engine.drawings.historySteps().undo.length,
      otherDrawings: other.engine.drawings.drawings().map((drawing: any) => drawing.id),
    };
  }, { id: charts.id, otherId: charts.otherId });
  await expect.poll(async () => (await committed()).drawings.length).toBe(charts.initialIds.length + 1);
  const firstCommitted = await committed();
  const firstRay = firstCommitted.drawings.find((drawing: any) => !charts.initialIds.includes(drawing.id));
  expect(firstRay).toMatchObject({ tool: 'horizontal-ray', points: [{ time: first.timeMs / 1000, price: first.price }] });
  expect(firstRay.text.value).toContain('BINANCE PERP · BUY · AGG PRINT');
  expect(firstRay.text.value).toContain('0.25 BTC @');
  expect(firstRay.props.iqterminal.version).toBe(1);
  expect(firstCommitted.historyCount).toBe(charts.undoCount + 1);
  expect(firstCommitted.otherDrawings).toEqual(charts.otherInitialIds);
  await page.screenshot({ path: testInfo.outputPath('ticker-execution-ray-saved.png') });

  await page.evaluate(({ id, drawingId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    if (!panel.engine.drawings.undo()) throw new Error('Ray undo was unavailable');
    if (panel.engine.drawings.drawings().some((drawing: any) => drawing.id === drawingId)) throw new Error('One undo did not remove the ray');
    if (!panel.engine.drawings.redo()) throw new Error('Ray redo was unavailable');
  }, { id: charts.id, drawingId: firstRay.id });
  await expect.poll(async () => (await committed()).drawings.length).toBe(charts.initialIds.length + 1);

  const second = await worker.evaluate(({ price }) => (self as any).__tradeFixture.emit(.5, 'sell', 72, 500, 'perpetual', price), { price: charts.price });
  if (!second) throw new Error('Fixture execution was not emitted');
  const secondRow = ticker.locator('.ticker-row[data-execution-id="binance:perpetual:BTCUSDT:agg:72"]');
  await expect(secondRow).toHaveCount(1);
  await secondRow.focus();
  await secondRow.press('Enter');
  await expect.poll(async () => (await committed()).drawings.length).toBe(charts.initialIds.length + 2);
  const result = await committed();
  const secondRay = result.drawings.find((drawing: any) => drawing.id !== firstRay.id && !charts.initialIds.includes(drawing.id));
  expect(secondRay).toMatchObject({ tool: 'horizontal-ray', points: [{ time: second.timeMs / 1000, price: second.price }] });
  expect(secondRay.text.value).toContain('BINANCE PERP · SELL · AGG PRINT');
  const secondObject = page.locator(`[data-panel-id="${charts.id}"] .chart-object-row[data-object-id="drawing:${secondRay.id}"]`);
  await expect(secondObject).toHaveCount(1);
  await secondObject.locator('button[data-object-action="settings"]').click();
  const settings = page.getByRole('dialog', { name: 'Drawing settings' });
  const textOnRay = settings.locator('[data-setting-path="text.value"]');
  await expect(textOnRay).toHaveValue(secondRay.text.value);
  const editedLabel = `${secondRay.text.value}\nREVIEWED`;
  await textOnRay.fill(editedLabel);
  await settings.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => page.evaluate(({ id, drawingId }) => (window as any).__terminal.panels.get(id).engine.drawings.get(drawingId).text.value, { id: charts.id, drawingId: secondRay.id })).toBe(editedLabel);
  const persisted = await page.evaluate(({ panelId, firstRayId, secondRayId }) => {
    const prefix = `iqterminal:drawings:${panelId}:`;
    return Object.keys(localStorage).filter(key => key.startsWith(prefix)).some(key => {
      const value = localStorage.getItem(key) ?? '';
      return value.includes(firstRayId) && value.includes(secondRayId);
    });
  }, { panelId: charts.id, firstRayId: firstRay.id, secondRayId: secondRay.id });
  expect(persisted).toBe(true);
});

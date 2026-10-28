import { expect, test, type Page } from '@playwright/test';
import { addIndicator, setFootprint } from './indicator-actions';
import { installDepthFixture } from './depth-fixture';

async function setup(page: Page) {
  await page.addInitScript(() => {
    const state = window as any; state.__tradeBubbleCommands = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, transfer?: any) {
      if (message.type?.startsWith('trade-bubbles-')) state.__tradeBubbleCommands.push(structuredClone(message));
      return post.call(this, message, transfer);
    };
  });
  const worker = await installDepthFixture(page);
  await page.evaluate(() => {
    const feed = (window as any).__terminal.feed;
    feed.subscribeFootprint = (id: string, _series: unknown, rowPrice: number, callback: (event: unknown) => void) => {
      const time = Math.floor(Date.now() / 60_000) * 60;
      const updatedAt = Date.now();
      queueMicrotask(() => callback({ type: 'footprint-snapshot', key: `fixture-footprint:${id}`, ids: [id], generation: 1, batchId: 1,
        bars: [{ time, revision: 1, rowSize: rowPrice, open: 99_990, high: 100_010, low: 99_980, close: 100_000, delta: 1, minDelta: 0, maxDelta: 1,
          cells: [{ price: 100_000, bidVol: 1, askVol: 2 }], coverage: 'partial', gapBefore: false }], retentionStart: time,
        status: { state: 'live', message: 'Explicit browser fixture', lastUpdate: updatedAt, tickSize: .1, rowSize: rowPrice, collectionStartedAt: updatedAt,
          firstTradeAt: updatedAt, lastTradeAt: updatedAt, eventTime: updatedAt, outages: 0, lateRecords: 0, capacityDrops: 0,
          unknownSideRecords: 0, unknownSideVolume: 0, coverage: 'partial', retentionStart: time } }));
      return () => {};
    };
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels.every((panel: any) => panel.bars === 5000))).toBe(true);
  return worker;
}

async function inject(page: Page, id: string, source: 'spot' | 'perpetual', sequence: number) {
  return page.evaluate(({ id, source, sequence }) => {
    const panel = (window as any).__terminal.panels.get(id), last = panel.diagnostics().last;
    const timeMs = last.t;
    const market = source === 'spot' ? 'spot' : 'perpetual';
    (window as any).__terminal.feed.send({ type: 'trade-bubbles-fixture', source: `binance:${source}`, records: [{
      venue: 'binance', market, nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade', executionId: `browser:${source}:${sequence}`,
      id: sequence, firstTradeId: sequence * 2, lastTradeId: sequence * 2 + 1,
      timeMs, receivedAtMs: Date.now(), eventTimeMs: Math.max(timeMs, Date.now()), price: last.c, quantity: 2, quoteNotionalText: '200000', side: 'buy',
    }] });
    return { timeMs, price: last.c };
  }, { id, source, sequence });
}

test('Trade Bubbles shares native order-flow charts and keeps collecting through ticker pause, close, hide, pan and source changes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setup(page);
  const charts = page.locator('.candle-panel'), panel = charts.nth(0), panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('The candle chart panel id is missing');

  await addIndicator(panel, 'Order-book Heatmap');
  await expect(panel.locator('.heatmap-notice')).toBeVisible();
  await addIndicator(panel, 'Order Walls');
  await expect(panel.locator('.order-walls-notice')).toBeVisible();
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().footprint.surfaceMounted, panelId)).toBe(true);
  await addIndicator(panel, 'Trade Bubbles');
  await expect(panel.locator('.trade-bubbles-status')).toContainText('Binance USD-M');
  expect(await page.locator('.trade-ticker').count()).toBe(0);

  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'binance', market: 'perpetual', interval: '5m' }));
  await expect(charts).toHaveCount(3);
  const sharedPanel = charts.nth(2), sharedId = await sharedPanel.getAttribute('data-panel-id');
  if (!sharedId) throw new Error('The second Binance chart panel id is missing');
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.setActive(), sharedId);
  await addIndicator(sharedPanel, 'Trade Bubbles');
  await sharedPanel.getByRole('button', { name: 'Trade Bubbles settings', exact: true }).click();
  await sharedPanel.locator('dialog.trade-bubble-settings').getByLabel('Minimum notional (USDT)', { exact: true }).fill('300000');
  await sharedPanel.locator('dialog.trade-bubble-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.tradeBubbles?.subscribers)).toBe(2);
  expect(await page.evaluate(() => (window as any).__terminal.feed.diagnostics.tradeBubbles?.fixture)).toBe(true);
  expect(await page.evaluate(() => (window as any).__terminal.feed.diagnostics.tradeBubbles?.subscribersState.map((item: any) => item.sources))).toEqual([
    ['binance:perpetual'], ['binance:perpetual'],
  ]);
  expect(await page.evaluate(() => (window as any).__terminal.feed.diagnostics.tradeBubbles?.subscribers)).toBe(2);

  const first = await inject(page, panelId, 'perpetual', 1);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(1);
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, sharedId)).toBe(0);
  const diagnostics = await page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics(), panelId);
  expect(diagnostics.tradeBubbles.layer.retained).toBe(1);
  expect(diagnostics.footprint.surfaceMounted).toBe(true);
  expect(diagnostics.heatmap.mounted).toBe(true);
  expect(diagnostics.orderWalls.settings.enabled).toBe(true);

  await page.evaluate(() => {
    const feed = (window as any).__terminal.feed;
    feed.subscribeTicker = () => () => {};
    feed.updateTicker = () => {};
  });
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker'); await expect(ticker).toBeVisible();
  const tickerId = await page.evaluate(() => [...(window as any).__terminal.tickers.keys()][0]);
  await ticker.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(ticker.getByRole('button', { name: 'Return to live', exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Trade Bubbles settings', exact: true }).click();
  const settings = panel.locator('dialog.trade-bubble-settings');
  await settings.getByLabel('Source mode', { exact: true }).selectOption('both');
  await settings.getByLabel('Trade Ticker profile to copy', { exact: true }).selectOption({ index: 1 });
  await settings.getByRole('button', { name: 'Copy tier snapshot', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().series.indicators.find((i: any) => i.definitionId === 'native.trade-bubbles').settings.sourceMode, panelId)).toBe('both');
  const sourceSubscriptions = await page.evaluate(() => (window as any).__tradeBubbleCommands.filter((message: any) => message.type === 'trade-bubbles-subscribe').length);
  const second = await inject(page, panelId, 'perpetual', 2);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(2);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.layer.hittable, panelId)).toBeGreaterThan(0);
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.close(), tickerId);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.tickers.size)).toBe(0);
  await inject(page, panelId, 'perpetual', 3);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(3);
  expect(await page.evaluate(() => (window as any).__tradeBubbleCommands.filter((message: any) => message.type === 'trade-bubbles-subscribe').length)).toBe(sourceSubscriptions);

  const marker = await page.evaluate(({ id, timeMs, price }) => {
    const panel = (window as any).__terminal.panels.get(id), chart = panel.engine.chart, plot = chart.plotRect(0);
    const index = chart.dataLayer.timeToIndexFloat(timeMs / 1000), x = chart.timeScale.indexToX(index), y = chart.panes()[0].priceScale.priceToY(price);
    const bounds = panel.chart.getBoundingClientRect();
    return { x: bounds.left + plot.left + Math.max(2, Math.min(plot.width - 2, x)), y: bounds.top + plot.top + y };
  }, { id: panelId, timeMs: second.timeMs, price: second.price });
  await page.mouse.move(marker.x, marker.y);
  await expect(panel.locator('.trade-bubbles-tooltip')).toBeVisible();
  await expect(panel.locator('.trade-bubbles-tooltip')).toContainText('UTC');
  await expect(panel.locator('.trade-bubbles-tooltip')).toContainText('Notional $200K USDT');
  await expect(panel.locator('.trade-bubbles-tooltip')).toContainText('underlying trade IDs');
  await page.screenshot({ path: 'artifacts/trade-bubbles-order-flow-1600x1000.png' });

  const beforePan = await page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles.layer.draws, panelId);
  await page.mouse.wheel(0, -180); await page.mouse.move(marker.x + 40, marker.y + 20);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles.layer.draws, panelId)).toBeGreaterThan(beforePan);
  const objectTree = panel.locator('.chart-objects-panel');
  const bubbleRow = objectTree.locator('.chart-object-row.kind-indicator').filter({ hasText: 'Trade Bubbles' });
  await bubbleRow.getByRole('button', { name: 'Hide object', exact: true }).click();
  await expect(panel.locator('.trade-bubbles-status')).toContainText('Hidden · still collecting');
  await inject(page, panelId, 'perpetual', 4);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(4);
  await bubbleRow.getByRole('button', { name: 'Show object', exact: true }).click();

  await panel.getByRole('button', { name: 'Trade Bubbles settings', exact: true }).click();
  const sourceSettings = panel.locator('dialog.trade-bubble-settings');
  await sourceSettings.getByLabel('Source mode', { exact: true }).selectOption('explicit');
  await sourceSettings.getByRole('button', { name: 'Choose explicit Trade Bubbles sources', exact: true }).click();
  const sourcePicker = panel.getByRole('dialog', { name: 'Select markets' });
  await sourcePicker.getByRole('checkbox', { name: 'Binance · BTCUSDT Spot', exact: true }).check();
  await sourcePicker.getByRole('button', { name: 'Apply', exact: true }).click();
  await sourceSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(0);
  const subscriptionsBeforeInterval = await page.evaluate(() => (window as any).__tradeBubbleCommands.filter((message: any) => message.type === 'trade-bubbles-subscribe').length);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().series.interval, panelId)).toBe('5m');
  expect(await page.evaluate(() => (window as any).__tradeBubbleCommands.filter((message: any) => message.type === 'trade-bubbles-subscribe').length)).toBe(subscriptionsBeforeInterval);
  await inject(page, panelId, 'spot', 5);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(1);

  await bubbleRow.getByRole('button', { name: 'Remove object', exact: true }).click();
  await expect(panel.locator('.trade-bubbles-status')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__tradeBubbleCommands.filter((message: any) => message.type === 'trade-bubbles-unsubscribe').length)).toBeGreaterThan(0);

  const bubbles = await page.evaluate(() => (window as any).__terminal.stats().panels.map((item: any) => item.tradeBubbles));
  expect(bubbles[0]).toBeUndefined();
  expect(errors).toEqual([]);
});

test('follow chart and explicit USDT sources report Hyperliquid incompatibility without a conversion', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const panel = page.locator('.candle-panel').nth(1), panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('The Hyperliquid chart panel id is missing');
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.setActive(), panelId);
  await addIndicator(panel, 'Trade Bubbles');
  await expect(panel.locator('.trade-bubbles-status')).toContainText('Follow chart is unavailable');

  await panel.getByRole('button', { name: 'Trade Bubbles settings', exact: true }).click();
  const settings = panel.locator('dialog.trade-bubble-settings');
  await settings.getByLabel('Source mode', { exact: true }).selectOption('explicit');
  await settings.getByRole('button', { name: 'Choose explicit Trade Bubbles sources', exact: true }).click();
  const picker = panel.getByRole('dialog', { name: 'Select markets' });
  await picker.getByRole('checkbox', { name: 'Binance · BTCUSDT Spot', exact: true }).check();
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.locator('.trade-bubbles-status')).toContainText('cannot be aligned');
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.resolution.state, panelId)).toBe('incompatible');
  expect(errors).toEqual([]);
});

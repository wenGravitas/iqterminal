import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, chooseChartMarket } from './indicator-actions';

test('Order Walls settings persist and remain a single viewport consumer alongside Heatmap', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installDepthFixture(page);
  const panelId = await page.locator('.candle-panel').first().getAttribute('data-panel-id');
  const panel = page.locator(`.candle-panel[data-panel-id="${panelId}"]`);
  await page.evaluate(() => {
    const feed = (window as any).__terminal.feed;
    const calls: { subscribe: unknown[]; settings: unknown[]; viewport: unknown[] } = (window as any).__orderWallsUiCalls = { subscribe: [], settings: [], viewport: [] };
    const subscribe = feed.subscribeOrderWalls.bind(feed);
    const update = feed.updateOrderWalls.bind(feed);
    const viewport = feed.updateOrderWallsViewport.bind(feed);
    feed.subscribeOrderWalls = (id: string, request: unknown, callback: unknown) => {
      calls.subscribe.push({ id, request });
      return subscribe(id, request, callback);
    };
    feed.updateOrderWalls = (id: string, settings: unknown) => {
      calls.settings.push({ id, settings });
      return update(id, settings);
    };
    feed.updateOrderWallsViewport = (id: string, from: number, to: number) => {
      calls.viewport.push({ id, from, to });
      return viewport(id, from, to);
    };
  });

  await addIndicator(panel, 'Order Walls');
  await expect(panel.locator('.active-indicator[data-definition-id="native.order-walls"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).__orderWallsUiCalls.subscribe.length)).toBe(1);
  await expect(panel.locator('.order-walls-notice')).toBeVisible();

  await panel.getByRole('button', { name: 'Order Walls settings', exact: true }).click();
  const settings = panel.locator('dialog.order-walls-settings');
  await settings.getByLabel('Detection mode', {exact:true}).selectOption('threshold');
  await settings.getByLabel('Detection', { exact: true }).selectOption('absolute');
  await expect(settings.getByLabel('Relative percentile', { exact: true })).toBeHidden();
  await settings.getByLabel('Absolute notional (USD)', { exact: true }).fill('725000');
  await settings.getByLabel('Price aggregation', { exact: true }).selectOption('50');
  await settings.getByLabel('Wall colour', { exact: true }).selectOption('bid-ask');
  await settings.getByLabel('Line thickness (px)', { exact: true }).fill('3');
  await settings.getByLabel('Opacity', { exact: true }).fill('.7');
  await settings.getByLabel('Show historical walls', { exact: true }).uncheck();
  await settings.getByLabel('Price lines and size tags (active walls)', { exact: true }).check();
  expect(await settings.locator('form').evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(true);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(settings).toBeHidden();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().series.indicators.find((i: any) => i.definitionId === 'native.order-walls')?.settings, panelId)).toMatchObject({
    method: 'absolute', thresholdUsd: 725000, aggregation: 50, colorMode: 'bid-ask', thicknessPx: 3, opacity: .7, showHistory: false, showPriceLines: true,
  });
  await expect.poll(() => page.evaluate(() => (window as any).__orderWallsUiCalls.settings.length)).toBe(1);

  await panel.getByRole('button', { name: 'Hide Order Walls', exact: true }).click();
  await expect(panel.locator('.order-walls-notice')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].orderWalls.mounted)).toBe(false);
  await panel.getByRole('button', { name: 'Show Order Walls', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].orderWalls.mounted)).toBe(true);
  await addIndicator(panel, 'Order-book Heatmap');
  await expect(panel.locator('.active-indicator[data-definition-id="native.orderbook-heatmap"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__orderWallsUiCalls.subscribe.length)).toBe(1);

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  const viewportCount = await page.evaluate(() => (window as any).__orderWallsUiCalls.viewport.length);
  await page.evaluate(() => {
    const engine = ([...(window as any).__terminal.panels.values()][0] as any).engine;
    const range = engine.visibleRange();
    if (range) engine.setRange({ from: range.from - 60, to: range.to - 60 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__orderWallsUiCalls.viewport.length)).toBeGreaterThan(viewportCount);
  await page.setViewportSize({ width: 900, height: 760 });
  expect(await page.evaluate(() => (window as any).__orderWallsUiCalls.subscribe.length)).toBe(1);

  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect.poll(() => page.evaluate(() => (window as any).__orderWallsUiCalls.subscribe.length)).toBe(2);
  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect(panel.locator('.active-indicator[data-definition-id="native.order-walls"]')).toContainText('Unavailable');
  expect(await page.evaluate(() => (window as any).__orderWallsUiCalls.subscribe.length)).toBe(2);

  await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const restored = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return { series: p.diagnostics().series, walls: p.diagnostics().series.indicators.find((i: any) => i.definitionId === 'native.order-walls') };
  });
  expect(restored.series.venue).toBe('hyperliquid');
  expect(restored.walls.settings).toMatchObject({ method: 'absolute', thresholdUsd: 725000, aggregation: 50, colorMode: 'bid-ask', thicknessPx: 3, opacity: .7, showHistory: false, showPriceLines: true });
  await expect(panel.locator('.active-indicator[data-definition-id="native.order-walls"]')).toContainText('Unavailable');
  expect(errors).toEqual([]);
});

test('wall tooltip uses the historical hit value and labels unknown bounds', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((p: any) => p.bars === 5000));
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  const text = await page.evaluate(id => {
    const p = (window as any).__terminal.panels.get(id);
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const segment = {
      id: 'fixture-wall', epoch: 1, side: 'bid', price: 83000, start, end: start + 5000,
      peakUsd: 170000, meanUsd: 80000, durationMs: 5000, percentile: 99,
      scopePartial: true, startKnown: false,
      valueRuns: [{ at: start, usd: 100000 }, { at: start + 2000, usd: 130000 }],
      valueRunsTruncated: false, endReason: 'censored', endKnown: false, censoredReason: 'depth sequence gap',
    };
    const hit = { segment, at: start + 3000, x: 1, y: 1, priceLow: 83000, priceHigh: 83050 };
    const status = { state: 'gap', coverage: { complete: false, partial: true, reason: 'depth sequence gap' } };
    const tooltip = p.orderWallsControls.tooltip(hit, p.diagnostics().series, status, start + 7000);
    p.heatmapControls.showSharedTooltip(tooltip);
    const knownExit = p.orderWallsControls.tooltip({ ...hit, segment: { ...segment, startKnown: true, endReason: 'removed', endKnown: true } }, p.diagnostics().series, status, start + 7000);
    const truncated = p.orderWallsControls.tooltip({ ...hit, segment: { ...segment, valueRuns: [{ at: start + 4000, usd: 140000 }], valueRunsTruncated: true } }, p.diagnostics().series, status, start + 7000);
    return { tooltip, knownExit, truncated };
  }, panelId);

  expect(text.tooltip).toContain('Binance · BTCUSDT USD-M Perp');
  expect(text.tooltip).toContain('Resting notional $130,000 at 2026-01-01 00:00:03.000 UTC');
  expect(text.tooltip).not.toContain('$80,000');
  expect(text.tooltip).not.toContain('$170,000');
  expect(text.tooltip).toContain('Observed since 2026-01-01 00:00:00.000 UTC · start unknown');
  expect(text.tooltip).toContain('Censored at last confirmed 2026-01-01 00:00:05.000 UTC · depth sequence gap');
  expect(text.tooltip).toContain('feed gap');
  expect(text.knownExit).toContain('Observed exit 2026-01-01 00:00:05.000 UTC · level removed');
  expect(text.knownExit).not.toContain('Censored at');
  expect(text.truncated).toContain('Historical notional unavailable · earlier value history was evicted');
  await expect(panel.locator('.heatmap-readout')).toHaveText(text.tooltip);
});

test('Order Walls distinguishes pending replay from an empty finished history',async({page})=>{
  await installDepthFixture(page);
  await page.evaluate(()=>{
    (window as any).__terminal.feed.subscribeOrderWalls=(_id:string,_request:unknown,callback:unknown)=>{
      (window as any).__wallProgressCallback=callback;return()=>{};
    };
  });
  const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Order Walls');
  await page.evaluate(()=>{
    const from=Date.UTC(2026,9,27,12),to=from+4*3600000;
    (window as any).__wallProgressCallback({kind:'patch',patches:[],status:{state:'loading',provisional:true,replay:{from,to,through:from+3600000}}});
  });
  await expect(panel.locator('.order-walls-notice')).toHaveText('Loading earlier order history. Current order sizes are still updating.');
  await expect(panel.locator('.order-walls-notice')).not.toContainText(/replay|loaded through|remaining history pending/i);
  await page.screenshot({path:'/tmp/iqterminal-order-walls-replay-progress.png'});
  await page.evaluate(()=>(window as any).__wallProgressCallback({kind:'patch',patches:[],status:{state:'live',provisional:false}}));
  await expect(panel.locator('.order-walls-notice')).not.toContainText('History replay');
});

import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function routeHyperliquid(page: import('@playwright/test').Page) {
  const apiRequests: any[] = [];
  let websocketConnections = 0;
  await page.context().route('https://api.hyperliquid.xyz/info', async route => {
    apiRequests.push(route.request().postDataJSON());
    await route.abort('blockedbyclient');
  });
  await page.context().routeWebSocket('wss://api.hyperliquid.xyz/ws', socket => {
    websocketConnections++;
    socket.close();
  });
  return { apiRequests, get websocketConnections() { return websocketConnections; } };
}

async function addComparison(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Market Comparison', exact: true }).click();
  const panel = page.locator('.market-comparison-panel').last();
  await expect(panel.locator('.market-comparison-status')).toContainText('5/5 connected', { timeout: 15_000 });
  return panel;
}

async function workerComparisonStats(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const terminal = (window as any).__terminal;
    terminal.feed.send({ type: 'diagnostics' });
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const value = terminal.feed.diagnostics.comparison;
      if (value) return value;
    }
    return terminal.feed.diagnostics.comparison ?? null;
  });
}

test('explicit development comparison fixtures render without reaching the public venue', async ({ page }) => {
  test.setTimeout(45_000);
  const transport = await routeHyperliquid(page);
  await page.goto('/?fixture=1');
  const panel = await addComparison(page);
  await expect(panel.locator('.market-comparison-legend-item')).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].sources.filter((source: any) => source.bars > 0).length)).toBe(5);
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ transport: 'fixture', subscriptions: 1, activeIdentities: 5, socket: 'connected' });
  expect(transport.apiRequests).toEqual([]);
  expect(transport.websocketConnections).toBe(0);
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(5);
  await expect(panel.locator('.market-comparison-message')).toBeHidden();
});

test('comparison controls rebase the full selected window and persist colors, visibility, theme, and timezone', async ({ page }) => {
  test.setTimeout(60_000);
  const transport = await routeHyperliquid(page);
  await page.goto('/?fixture=1');
  const panel = await addComparison(page);
  const initialStats = await workerComparisonStats(page);

  await panel.getByLabel('Comparison window').selectOption('24h');
  await panel.getByLabel('Candle interval').selectOption('1m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].sources.every((source: any) => source.bars >= 1_440))).toBe(true);
  await page.setViewportSize({ width: 500, height: 768 });
  const comparisonId = await page.evaluate(() => [...(window as any).__terminal.marketComparisons.keys()][0]);
  await page.evaluate((id: string) => (window as any).__terminal.dock.getPanel(id).api.setSize({ width: 240 }), comparisonId);
  await expect.poll(() => page.evaluate((id: string) => (window as any).__terminal.marketComparisons.get(id).element.getBoundingClientRect().width, comparisonId)).toBeLessThanOrEqual(245);
  const fullDayView = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const range = instance.chartHost.chart.getVisibleLogicalRange(), data = instance.primarySeries.getData();
    const first = Math.max(0, Math.ceil(range.from)), last = Math.min(data.length - 1, Math.floor(range.to));
    return { visibleDataBars: Math.max(0, last - first + 1), plotWidth: instance.chartHost.chart.plotRect(0)?.width ?? 0,
      viewportWidth: innerWidth, panelWidth: instance.element.getBoundingClientRect().width,
      stageWidth: instance.stage.getBoundingClientRect().width, range };
  });
  console.log(`Compact 24h comparison viewport: ${JSON.stringify(fullDayView)}`);
  expect(fullDayView.panelWidth).toBeGreaterThanOrEqual(235);
  expect(fullDayView.panelWidth).toBeLessThanOrEqual(245);
  expect(fullDayView.plotWidth).toBeGreaterThanOrEqual(144);
  expect(fullDayView.visibleDataBars, `24h/1m view was clamped at compact width: ${JSON.stringify(fullDayView)}`).toBeGreaterThanOrEqual(1_440);

  await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0], symbol = 'xyz:CL';
    const source = instance.sources.get(symbol), instrument = instance.config.instruments.find((item: any) => item.identity.symbol === symbol);
    const candles = source.candles.slice(-3);
    instance.onFeedEvent({ type: 'comparison-snapshot', ids: ['sparse-window-check'], identity: instrument.identity,
      candles, status: { ...source.status, historyPending: false, retainedBars: candles.length } });
  });
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.marketComparisons.values()][0].sources.get('xyz:CL').candles.length)).toBe(3);
  const sparseViewBars = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0], range = instance.chartHost.chart.getVisibleLogicalRange();
    const dataLength = instance.primarySeries.getData().length;
    return Math.max(0, Math.min(dataLength - 1, Math.floor(range.to)) - Math.max(0, Math.ceil(range.from)) + 1);
  });
  expect(sparseViewBars).toBeGreaterThanOrEqual(1_440);

  await panel.getByLabel('Candle interval').selectOption('5m');
  await expect(panel.locator('.market-comparison-status')).toContainText('5/5 connected', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].sources.every((source: any) => source.bars >= 288))).toBe(true);
  const fullWindowStats = await workerComparisonStats(page);
  expect(fullWindowStats.transport).toBe('fixture');
  expect(fullWindowStats.activeIdentities).toBe(5);
  expect(fullWindowStats.historyRequests).toBeGreaterThan(initialStats.historyRequests);

  await panel.getByRole('button', { name: 'Choose comparison markets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Select comparison markets' });
  await dialog.locator('[data-market-visible="xyz:SP500"]').uncheck();
  await dialog.locator('[data-market-color="xyz:GOLD"]').evaluate(input => {
    (input as HTMLInputElement).value = '#123abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.locator('.market-comparison-legend-item[data-visible="false"]')).toHaveCount(1);
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].settings.instruments.find((item: any) => item.identity.symbol === 'xyz:GOLD').color)).toBe('#123abc');

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('light');
  await page.locator('#market-pulse-trigger').click();
  await page.locator('[data-timezone="UTC"]').click();
  await expect(panel.locator('.market-comparison-baseline')).toContainText('UTC');

  await page.reload();
  const restored = page.locator('.market-comparison-panel');
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('.market-comparison-status')).toContainText('4/4 connected', { timeout: 15_000 });
  await expect(restored.getByLabel('Comparison window')).toHaveValue('24h');
  await expect(restored.getByLabel('Candle interval')).toHaveValue('5m');
  await expect(restored.locator('.market-comparison-legend-item[data-visible="false"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].settings.instruments.find((item: any) => item.identity.symbol === 'xyz:GOLD').color)).toBe('#123abc');
  expect(transport.apiRequests).toEqual([]);
  expect(transport.websocketConnections).toBe(0);
});

test('matching comparison panels share one upstream set, pause hidden chart drawing, and release repeated resources', async ({ page }) => {
  test.setTimeout(75_000);
  const transport = await routeHyperliquid(page);
  await page.goto('/?fixture=1');
  await addComparison(page);
  const firstId = await page.evaluate(() => [...(window as any).__terminal.marketComparisons.keys()][0]);
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 1, activeIdentities: 5, pendingHistory: 0, transport: 'fixture' });
  const onePanelStats = await workerComparisonStats(page);

  await page.evaluate(({ id }) => {
    const terminal = (window as any).__terminal;
    terminal.dock.addPanel({ id: 'market-comparison-shared', component: 'market-comparison', title: 'Market Comparison',
      params: terminal.marketComparisons.get(id).diagnostics().settings,
      position: { referencePanel: id, direction: 'within' }, minimumWidth: 240, minimumHeight: 160 });
  }, { id: firstId });
  const panels = page.locator('.market-comparison-panel');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(1).locator('.market-comparison-status')).toContainText('5/5 connected');
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 2, activeIdentities: 5, pendingHistory: 0 });
  const historiesAfterFirst = onePanelStats.historyRequests;
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 2, activeIdentities: 5, pendingHistory: 0,
    socketCreations: onePanelStats.socketCreations, historyRequests: historiesAfterFirst });
  const hiddenId = firstId!, visibleId = 'market-comparison-shared';
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().visible, hiddenId)).toBe(false);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().visible, visibleId)).toBe(true);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().visible, hiddenId)).toBe(false);
  expect(transport.apiRequests).toEqual([]);
  expect(transport.websocketConnections).toBe(0);

  await page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).params.api.setActive(), visibleId);
  await page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).params.api.setActive(), hiddenId);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().visible, hiddenId)).toBe(true);
  await page.waitForTimeout(120);
  const drawCount = await page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().drawStats, hiddenId);
  await page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).params.api.setActive(), visibleId);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().visible, hiddenId)).toBe(false);
  await page.waitForTimeout(250);
  expect(await page.evaluate(id => (window as any).__terminal.marketComparisons.get(id).diagnostics().drawStats, hiddenId)).toBe(drawCount);

  await page.evaluate(id => {
    const terminal = (window as any).__terminal, panel = terminal.dock.getPanel(id);
    if (!panel) throw new Error(`Missing panel ${id}`);
    terminal.dock.removePanel(panel);
  }, hiddenId);
  await expect(panels).toHaveCount(1);
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 1, activeIdentities: 5, pendingHistory: 0 });
  await page.evaluate(id => {
    const terminal = (window as any).__terminal, panel = terminal.dock.getPanel(id);
    if (!panel) throw new Error(`Missing panel ${id}`);
    terminal.dock.removePanel(panel);
  }, visibleId);
  await expect(panels).toHaveCount(0);
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 0, activeIdentities: 0, socket: 'closed' });

  for (let cycle = 0; cycle < 3; cycle++) {
    await addComparison(page);
    const id = await page.evaluate(() => [...(window as any).__terminal.marketComparisons.keys()][0]);
    await page.evaluate(panelId => {
      const terminal = (window as any).__terminal, panel = terminal.dock.getPanel(panelId);
      if (!panel) throw new Error(`Missing panel ${panelId}`);
      terminal.dock.removePanel(panel);
    }, id);
    await expect(page.locator('.market-comparison-panel')).toHaveCount(0);
    await expect.poll(() => workerComparisonStats(page)).toMatchObject({ subscriptions: 0, activeIdentities: 0, socket: 'closed' });
  }
  await expect.poll(() => workerComparisonStats(page)).toMatchObject({ socketCreations: 4, transport: 'fixture' });
  expect(transport.apiRequests).toEqual([]);
  expect(transport.websocketConnections).toBe(0);
});

test('keeps native crosshair prices and a stable timestamp baseline, then promotes the next visible market', async ({ page }) => {
  test.setTimeout(45_000);
  const transport = await routeHyperliquid(page);
  await page.goto('/?fixture=1');
  const panel = await addComparison(page);
  const before = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const source = instance.sources.get('BTC'), previous = source.candles.at(-1);
    const baselineTime = instance.currentBaselineTime(), baseline = instance.baselineClose('BTC');
    const time = previous.t / 1000, close = previous.c * 1.01;
    const changed = { ...previous, h: close, c: close, revision: previous.revision + 1, closed: false };
    const identity = instance.config.instruments.find((item: any) => item.identity.symbol === 'BTC').identity;
    instance.onFeedEvent({ type: 'comparison-patch', ids: ['crosshair-check'], identity, candles: [changed], status: source.status });
    instance.updateReadout({ time, bar: { time, close } });
    return { baselineTime, baseline, close, afterPatchBaselineTime: instance.currentBaselineTime(), readout: instance.readout.textContent };
  });
  expect(before.afterPatchBaselineTime).toBe(before.baselineTime);
  expect(before.readout).toContain(`BTC ${before.close.toLocaleString('en-US', { maximumFractionDigits: 4 })}`);
  expect(before.readout).toContain(`${((before.close / before.baseline - 1) * 100).toFixed(2)}%`);

  await panel.getByRole('button', { name: 'Choose comparison markets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Select comparison markets' });
  await dialog.locator('[data-market-visible="BTC"]').uncheck();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.marketComparisons.values()][0].diagnostics().primary)).toBe('xyz:XYZ100');
  await panel.getByRole('button', { name: 'Choose comparison markets' }).click();
  const visibleSymbols = await dialog.locator('[data-market-visible]:checked:not(:disabled)').evaluateAll(inputs =>
    inputs.map(input => (input as HTMLInputElement).dataset.marketVisible!));
  for (const symbol of visibleSymbols.slice(0, -1)) await dialog.locator(`[data-market-visible="${symbol}"]`).uncheck();
  const remainingVisible = dialog.locator('[data-market-visible]:checked');
  await expect(remainingVisible).toHaveCount(1);
  await expect(remainingVisible.first()).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(transport.apiRequests).toEqual([]);
  expect(transport.websocketConnections).toBe(0);
});

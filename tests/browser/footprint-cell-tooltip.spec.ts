import { expect, test } from '@playwright/test';
import { setFootprint, setUnits } from './indicator-actions';

test('footprint cell tooltip dwells, refreshes forming data, cancels on leave and drag, and fits desktop/narrow dark and ivory themes', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000 && panel.renderer.draws > 0));
  const panel = page.locator('.candle-panel').first();
  const tree = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await tree.isVisible()) await tree.click();
  await expect(panel.locator('.ohlc')).toHaveCount(0);

  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.cellTooltipCallback = undefined;
    terminal.feed.subscribeFootprint = (_id: string, _series: any, _rowPrice: number, callback: (event: any) => void) => {
      terminal.cellTooltipCallback = callback;
      return () => { if (terminal.cellTooltipCallback === callback) terminal.cellTooltipCallback = undefined; };
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__terminal.cellTooltipCallback)).toBe('function');

  const fixture = await panel.evaluate(element => {
    const id = (element as HTMLElement).dataset.panelId!;
    const terminal = (window as any).__terminal, target = terminal.panels.get(id), engine = target.engine;
    const time = engine.series.getData().at(-1).time;
    const close = engine.series.getData().at(-1).close;
    const price = Math.floor(close / 25) * 25;
    const bar = {
      time, revision: 1, cells: [{ price, bidVol: 0.125, askVol: 0.375, bidNotional: price * 0.125, askNotional: price * 0.375 }],
      delta: 0.25, minDelta: -0.125, maxDelta: 0.25,
      quoteDelta: price * 0.25, minQuoteDelta: -price * 0.125, maxQuoteDelta: price * 0.25,
      rowSize: 25, source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade', coverage: 'observed', gapBefore: false,
      open: price, high: price + 25, low: price, close: price + 10, aggregateRecordCount: 5,
    };
    const status = { state: 'live', message: 'Explicit test observations', lastUpdate: Date.now(), tickSize: 0.1, rowSize: 25,
      collectionStartedAt: Date.now(), firstTradeAt: Date.now(), lastTradeAt: Date.now(), eventTime: Date.now(), outages: 0,
      lateRecords: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0, retentionStart: time, coverage: 'observed' };
    terminal.cellTooltipCallback({ type: 'footprint-status', key: 'cell-tooltip', ids: [id], status });
    terminal.cellTooltipCallback({ type: 'footprint-snapshot', key: 'cell-tooltip', ids: [id], bars: [bar], retentionStart: time, status });
    const scale = engine.chart.panes()[engine.chart.primaryPaneIndex()].priceScale;
    scale.setAutoScale(false); scale.setPriceRange({ min: price - 250, max: price + 250 });
    const stage = (element as HTMLElement).querySelector<HTMLElement>('.chart-stage')!, rect = stage.getBoundingClientRect();
    const x = engine.chart.timeToCoordinate(time) - engine.chart.timeScale.barSpacing * 0.96 / 4;
    const y = engine.chart.priceToCoordinate(price + 12.5, 0);
    return { id, time, price, bar, point: { x: rect.left + x, y: rect.top + y } };
  });
  const stage = await panel.locator('.chart-stage').boundingBox();
  const localPoint = { x: fixture.point.x - stage!.x, y: fixture.point.y - stage!.y };
  await expect.poll(() => page.evaluate(({ id, point }) => (window as any).__terminal.panels.get(id).engine.footprintAt(
    point.x, point.y,
  )?.cell?.bidVol ?? null, { id: fixture.id, point: localPoint })).toBe(0.125);

  const sharedTooltip = panel.locator('.net-positioning-tooltip');
  await page.mouse.move(fixture.point.x, fixture.point.y);
  await expect.poll(() => panel.evaluate(element => {
    const id = (element as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id).hoveredFootprint?.cell?.bidVol ?? null;
  })).toBe(0.125);
  await page.waitForTimeout(180);
  await expect(sharedTooltip).toBeHidden();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(550);
  await expect(sharedTooltip).toBeHidden();
  await expect(panel.locator('.footprint-cell-tooltip')).toHaveCount(0);

  await page.mouse.move(fixture.point.x, fixture.point.y);
  const card = panel.locator('.footprint-cell-tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Footprint cell');
  await expect(card).toContainText('BTC');
  await expect(card.locator('[data-side=bid]')).toContainText('0.125 BTC');
  await expect(card.locator('[data-side=ask]')).toContainText('0.375 BTC');
  await expect(card.locator('[data-side=bid]')).toContainText(`${(fixture.price * 0.125).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`);

  await panel.evaluate((element, { time, bar }) => {
    const id = (element as HTMLElement).dataset.panelId!, terminal = (window as any).__terminal;
    const updated = { ...bar, revision: 2, cells: [{ ...bar.cells[0], bidVol: 0.2, askVol: 0.4,
      bidNotional: bar.cells[0].price * 0.2, askNotional: bar.cells[0].price * 0.4 }],
      delta: 0.2, minDelta: -0.2, maxDelta: 0.2,
      quoteDelta: bar.cells[0].price * 0.2, minQuoteDelta: -bar.cells[0].price * 0.2, maxQuoteDelta: bar.cells[0].price * 0.2 };
    terminal.cellTooltipCallback({ type: 'footprint-patch', key: 'cell-tooltip', ids: [id], bars: [updated], retentionStart: time });
  }, { time: fixture.time, bar: fixture.bar });
  await expect(card.locator('[data-side=bid]')).toContainText('0.2 BTC');
  await expect(card.locator('[data-side=ask]')).toContainText('0.4 BTC');
  await expect(card).not.toContainText('0.125 BTC');
  await panel.evaluate((element, time) => {
    const id = (element as HTMLElement).dataset.panelId!, terminal = (window as any).__terminal;
    const current = terminal.panels.get(id).footprintBars.find((item: any) => item.time === time);
    terminal.cellTooltipCallback({ type: 'footprint-patch', key: 'cell-tooltip', ids: [id], bars: [{ ...current,
      revision: current.revision + 1, coverage: 'gapped', gapBefore: true }], retentionStart: time });
  }, fixture.time);
  await expect(card.locator('.positioning-tooltip-status').last()).toContainText('Earlier data missing');

  await page.mouse.down();
  await page.mouse.move(fixture.point.x + 12, fixture.point.y + 5, { steps: 2 });
  await expect(sharedTooltip).toBeHidden();
  await page.mouse.up();
  await page.waitForTimeout(550);
  await expect(sharedTooltip).toBeHidden();
  await expect(panel.locator('.footprint-cell-tooltip')).toHaveCount(0);

  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const moveBack = async () => {
    const point = await panel.evaluate((element, { time, price }) => {
      const id = (element as HTMLElement).dataset.panelId!, engine = (window as any).__terminal.panels.get(id).engine;
      const rect = (element as HTMLElement).querySelector<HTMLElement>('.chart-stage')!.getBoundingClientRect();
      const local = { x: engine.chart.timeToCoordinate(time) - engine.chart.timeScale.barSpacing * 0.96 / 4,
        y: engine.chart.priceToCoordinate(price + 12.5, 0) };
      return { x: rect.left + local.x, y: rect.top + local.y, local };
    }, { time: fixture.time, price: fixture.price });
    await expect.poll(() => panel.evaluate((element, local) => {
      const id = (element as HTMLElement).dataset.panelId!;
      return (window as any).__terminal.panels.get(id).engine.footprintAt(local.x, local.y)?.cell?.bidVol ?? null;
    }, point.local)).toBe(0.2);
    await page.mouse.move(point.x, point.y);
    await expect(card).toBeVisible();
  };
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.mouse.move(1, 1);
  await moveBack();
  await theme.selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/footprint-cell-tooltip-dark-1366x768.png' });
  await theme.selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'artifacts/footprint-cell-tooltip-ivory-1366x768.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  await page.mouse.move(1, 1); await moveBack();
  const narrowGeometry = await card.evaluate(element => {
    const cardRect = element.getBoundingClientRect(), stageRect = element.closest<HTMLElement>('.chart-stage')!.getBoundingClientRect();
    return { left: cardRect.left - stageRect.left, top: cardRect.top - stageRect.top,
      right: cardRect.right - stageRect.right, bottom: cardRect.bottom - stageRect.bottom };
  });
  expect(narrowGeometry.left).toBeGreaterThanOrEqual(-1); expect(narrowGeometry.top).toBeGreaterThanOrEqual(-1);
  expect(narrowGeometry.right).toBeLessThanOrEqual(1); expect(narrowGeometry.bottom).toBeLessThanOrEqual(1);
  await theme.selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/footprint-cell-tooltip-dark-720x860.png' });
  await theme.selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'artifacts/footprint-cell-tooltip-ivory-720x860.png' });

  await setUnits(panel, 'usdt');
  await expect(panel.locator('.ohlc')).toHaveCount(0);
  await panel.evaluate((element, { time, bar }) => {
    const id = (element as HTMLElement).dataset.panelId!, terminal = (window as any).__terminal;
    const current = terminal.panels.get(id).footprintBars.find((item: any) => item.time === time) ?? bar;
    const updated = { ...current, revision: current.revision + 1,
      cells: [{ price: bar.cells[0].price, bidVol: bar.cells[0].bidVol, askVol: bar.cells[0].askVol }],
      delta: 0.2, minDelta: -0.2, maxDelta: 0.2,
      quoteDelta: undefined, minQuoteDelta: undefined, maxQuoteDelta: undefined };
    terminal.cellTooltipCallback({ type: 'footprint-patch', key: 'cell-tooltip', ids: [id], bars: [updated], retentionStart: time });
  }, { time: fixture.time, bar: fixture.bar });
  await expect(panel.locator('.panel-status')).toHaveAttribute('data-quote-availability', 'unavailable');
  await expect(panel.locator('.panel-status')).toContainText('USDT notional unavailable');
  await expect(panel.locator('.panel-status')).toContainText('select BTC');
  await expect(panel.locator('.ohlc')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, setFootprint } from './indicator-actions';

test('Footprint Totals owns a lower pane while sharing one footprint collection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();

  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.profileSubscriptions = 0;
    terminal.profileUnsubscriptions = 0;
    terminal.feed.subscribeFootprint = (_id: string, series: any, rowSize: number, callback: any) => {
      terminal.profileSubscriptions++;
      setTimeout(() => {
        const candlePanel = [...terminal.panels.values()][0] as any;
        const time = candlePanel.engine.latestBar.time;
        const bar = {
          time, rowSize, revision: 1,
          cells: [{ price: 83000, bidVol: 3, askVol: 7, bidNotional: 249000, askNotional: 581000 }],
          open: 83000, high: 83025, low: 82975, close: 83010,
          delta: 4, minDelta: -3, maxDelta: 4, quoteDelta: 332000,
          minQuoteDelta: -249000, maxQuoteDelta: 332000,
          source: series.market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade', granularity: 'aggregate-trade',
          coverage: 'partial', gapBefore: false, aggregateRecordCount: 1,
        };
        const now = Date.now();
        callback({
          type: 'footprint-snapshot', key: 'fixture', ids: [_id], bars: [bar],
          retentionStart: time, generation: terminal.profileSubscriptions, batchId: terminal.profileSubscriptions,
          status: { state: 'live', message: 'Explicit browser fixture', lastUpdate: now,
            tickSize: .1, rowSize, collectionStartedAt: now, firstTradeAt: now,
            lastTradeAt: now, eventTime: now, outages: 0, capacityDrops: 0,
            unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0,
            retentionStart: time, coverage: 'partial' },
        });
      }, 250);
      return () => { terminal.profileUnsubscriptions++; };
    };
  });

  await addIndicator(panel, 'Footprint Totals');
  const totals = panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]');
  await expect(totals).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const id = candlePanel.selection.indicators.find((item: any) => item.definitionId === 'native.footprint-totals').instanceId;
    return { view: candlePanel.engine.footprintTotalsDiagnostics().find((item: any) => item.id === id),
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(id), paneCount: candlePanel.engine.chart.panes().length,
      time: candlePanel.engine.latestBar.time, tooltip: candlePanel.engine.footprintTotalsTooltip(id, candlePanel.engine.latestBar.time),
      subscriptions: terminal.profileSubscriptions };
  })).toMatchObject({ paneIndex: 1, paneCount: 2, subscriptions: 1 });
  const observed = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const view = candlePanel.engine.footprintTotalsDiagnostics()[0];
    return { view, time: candlePanel.engine.latestBar.time,
      tooltip: candlePanel.engine.footprintTotalsTooltip(view.id, candlePanel.engine.latestBar.time),
      subscriptions: terminal.profileSubscriptions };
  });
  expect(observed.view).toMatchObject({ paneIndex: 1, statsBars: 1 });
  expect(observed.view.firstTime).toBe(observed.time);
  expect(observed.tooltip).toContain('Volume  10');
  expect(observed.tooltip).toContain('Delta  +4');
  expect(observed.subscriptions).toBe(1);
  await page.screenshot({ path: 'artifacts/footprint-totals/fixture-1366x768.png' });

  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileSubscriptions)).toBe(1);
  await panel.getByRole('button', { name: 'Hide Footprint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(0);
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].footprintTotals[0].statsBars)).toBe(1);

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, view = p.engine.footprintTotalsDiagnostics()[0];
    return view?.statsBars === 1 && view.lastTime === p.engine.latestBar.time;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileSubscriptions)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(1);
  await panel.getByRole('button', { name: 'Chart market', exact: true }).click();
  const marketPicker = panel.locator('.market-picker');
  await marketPicker.getByRole('radio', { name: 'Binance · BTCUSDT Spot', exact: true }).check();
  await marketPicker.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, view = p.engine.footprintTotalsDiagnostics()[0];
    return p.selection.market === 'spot' && p.selection.interval === '5m' && view?.statsBars === 1 && view.lastTime === p.engine.latestBar.time;
  })).toBe(true);

  await panel.getByRole('button', { name: 'Show Footprint', exact: true }).click();
  await panel.getByRole('button', { name: 'Remove Footprint Totals', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(2);
  await panel.getByRole('button', { name: 'Remove Footprint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(3);

  await addIndicator(panel, 'Footprint Totals');
  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const totalsSettings = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await totalsSettings.getByLabel('Bid volume', { exact: true }).uncheck();
  await totalsSettings.getByLabel('Ask volume', { exact: true }).uncheck();
  await totalsSettings.getByLabel('Trades', { exact: true }).check();
  await totalsSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const persisted = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()].find((item: any) => item.selection.indicators.some((indicator: any) => indicator.definitionId === 'native.footprint-totals')) as any;
    const indicator = candlePanel.selection.indicators.find((item: any) => item.definitionId === 'native.footprint-totals');
    return { rows: indicator.settings.rows, interval: candlePanel.selection.interval, market: candlePanel.selection.market,
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(indicator.instanceId) };
  });
  expect(persisted).toEqual({ rows: ['volume', 'delta', 'trades'], interval: '5m', market: 'spot', paneIndex: 1 });
  expect(errors).toEqual([]);
});

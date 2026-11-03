import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('one Net Longs & Shorts pane shares sources and settings, keeps independent side bands, and restores them', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const hostOpen = Math.floor(Date.now() / 60_000) * 60_000;
  const requests: string[] = [], routed: string[] = [], failed: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('requestfailed', request => failed.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.route('**/market-data/**', async route => {
    const url = new URL(route.request().url());
    routed.push(url.pathname);
    if (url.pathname.endsWith('/native-candles')) {
      const candles = Array.from({ length: 600 }, (_, index) => {
        const time = hostOpen - (599 - index) * 60_000, close = 82_000 + index * .1;
        return { t: time, o: close - .5, h: close + 1, l: close - 1, c: close, v: 10 + index % 20, revision: 1, closed: index < 599 };
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'binance-native-kline', candles }) });
    }
    if (!url.pathname.endsWith('/net-positioning')) return route.fulfill({ status: 503, json: { error: 'Explicit browser fixture: no runtime transport' } });
    const method = url.searchParams.get('method') ?? 'price-oi';
    const venues = (url.searchParams.get('venues') ?? 'binance').split(',').filter(venue => ['binance', 'hyperliquid', 'bybit'].includes(venue));
    requests.push(`${method}:${venues.join(',')}`);
    const intervals = Array.from({ length: 60 }, (_, age) => venues.flatMap(venue => [0, 1].map(half => {
      const end = hostOpen - age * 60_000 + (half + 1) * 30_000;
      const value = ((age * 7 + half * 3 + venue.length) % 15) - 7;
      const longs = venue === 'binance' ? value * 1.5 : -value;
      const shorts = venue === 'binance' ? -value * .75 : value * 1.2;
      const delta = longs + shorts;
      return {
        version: 1, method, status: 'available', venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', units: 'BTC',
        startTimeMs: end - 30_000, endTimeMs: end, attributionTimeMs: end, resolutionMs: 30_000, direction: delta === 0 ? 0 : Math.sign(delta),
        oiDeltaBtcDecimal: String(delta), netLongsBtcDecimal: String(longs), netShortsBtcDecimal: String(shorts), unclassifiedBtcDecimal: '0', qualityFlags: [],
        provenance: { openInterestEnd: { openInterestBtcDecimal: '100', sourceTimeMs: end, receivedAtMs: end, sourceTimeQuality: 'exchange-event', quality: 'complete' },
          priceStart: { price: 82_000 }, priceEnd: { price: 82_001 }, tradeCoverage: { fromMs: end - 30_000, toMs: end, complete: true, gap: false } },
      };
    })));
    const feed = { state: 'live', source: 'explicit-browser-fixture', lastObservedAt: Date.now(), expectedIntervalMs: 30_000, stale: false,
      unitVerification: { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC',
      venues, from: hostOpen - 4 * 60 * 60_000, to: Date.now(), intervals: intervals.flat(), truncated: false,
      unitVerification: Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' }])),
      feeds: Object.fromEntries(venues.map(venue => [venue, feed])), pendingIntervals: 0,
      history: 'explicit browser fixture; observed intervals only', semantics: 'test-only signed source fixture' }) });
  });

  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(2_000);
  const chartState = await page.evaluate(() => (window as any).__terminal.stats());
  expect(chartState.panels[0]?.bars, JSON.stringify({ chartState, routed, failed, errors })).toBeGreaterThan(0);
  await addIndicator(panel, 'Net Longs & Shorts');
  const id = 'native.net-longs-shorts-estimated';
  const row = panel.locator(`.active-indicator[data-definition-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect.poll(() => page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id);
    return view?.primitive.diagnostics().candleCount ?? 0;
  }, id)).toBeGreaterThan(0);

  const initial = await page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, view = p.engine.netPositioningPanes.get(id);
    return { panes: p.engine.netPositioningPanes.size, paneIndex: view.paneIndex, charts: chart.panes().length,
      bands: view.primitive.diagnostics().renderedBands.map((band: any) => band.side),
      settings: p.selection.indicators.find((item: any) => item.definitionId === id).settings,
      subscriptionCount: p.feed.protocolDiagnostics().subscriptions.netPositioning };
  }, id);
  expect(initial.panes).toBe(1);
  expect(initial.charts).toBe(2);
  expect(initial.bands).toEqual(['longs', 'shorts']);
  expect(initial.settings).toMatchObject({ showLongs: true, showShorts: true, reverseOrder: false });
  expect(initial.subscriptionCount).toBe(1);
  await page.screenshot({ path: '/tmp/net-positioning-combined-default.png' });

  const sources = panel.getByRole('group', { name: 'Net Longs & Shorts sources', exact: true });
  await expect(sources.locator('.net-positioning-source')).toHaveCount(3);
  const hyperliquid = sources.locator('[data-source="hyperliquid"]');
  if (await hyperliquid.getAttribute('aria-pressed') !== 'true') await hyperliquid.click();
  await expect(hyperliquid).toHaveAttribute('aria-pressed', 'true');

  await row.getByRole('button', { name: 'Net Longs & Shorts settings', exact: true }).click();
  const settings = panel.locator('.net-positioning-settings');
  await expect(settings.getByLabel('Show Longs')).toBeChecked();
  await expect(settings.getByLabel('Show Shorts')).toBeChecked();
  await expect(settings.getByLabel('Reverse order')).not.toBeChecked();
  await settings.getByLabel('Estimation inputs').selectOption('aggressor-flow-oi');
  await settings.getByLabel('Show Longs').uncheck();
  await settings.getByLabel('Reverse order').check();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id);
    return { bands: view.primitive.diagnostics().renderedBands.map((band: any) => band.side), settings: p.selection.indicators.find((item: any) => item.definitionId === id).settings,
      panes: p.engine.netPositioningPanes.size, subscriptions: p.feed.protocolDiagnostics().subscriptions.netPositioning };
  }, id)).toMatchObject({ bands: ['shorts'], settings: { method: 'aggressor-flow-oi', showLongs: false, showShorts: true, reverseOrder: true }, panes: 1, subscriptions: 1 });
  await page.screenshot({ path: '/tmp/net-positioning-combined-shorts-only.png' });

  await row.getByRole('button', { name: 'Net Longs & Shorts settings', exact: true }).click();
  await settings.getByLabel('Show Longs').check();
  await settings.getByLabel('Reverse order').check();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(id => [...(window as any).__terminal.panels.values()][0].engine.netPositioningPanes.get(id)
    .primitive.diagnostics().renderedBands.map((band: any) => band.side), id)).toEqual(['shorts', 'longs']);
  await page.screenshot({ path: '/tmp/net-positioning-combined-reversed.png' });
  await page.reload();
  const restoredPanel = page.locator('.candle-panel').first();
  const restoredRow = restoredPanel.locator(`.active-indicator[data-definition-id="${id}"]`);
  await expect(restoredRow).toBeVisible();
  await restoredRow.getByRole('button', { name: 'Net Longs & Shorts settings', exact: true }).click();
  const restoredSettings = restoredPanel.locator('.net-positioning-settings');
  await expect(restoredSettings.getByLabel('Estimation inputs')).toHaveValue('aggressor-flow-oi');
  await expect(restoredSettings.getByLabel('Show Longs')).toBeChecked();
  await expect(restoredSettings.getByLabel('Show Shorts')).toBeChecked();
  await expect(restoredSettings.getByLabel('Reverse order')).toBeChecked();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.netPositioningPanes.size)).toBe(1);
  await expect.poll(() => page.evaluate(id => [...(window as any).__terminal.panels.values()][0].engine.netPositioningPanes.get(id)
    .primitive.diagnostics().renderedBands.map((band: any) => band.side), id)).toEqual(['shorts', 'longs']);
  await expect.poll(() => requests.some(request => request.startsWith('aggressor-flow-oi:'))).toBe(true);
  expect(errors).toEqual([]);
});

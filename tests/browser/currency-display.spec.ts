import { test, expect, type Page } from '@playwright/test';
import { addIndicator } from './indicator-actions';

async function globalCurrency(page: Page, enabled: boolean, currency = 'quote') {
  await page.getByRole('button', { name: 'Global settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Global settings', exact: true });
  await dialog.getByLabel('Override indicator currencies').setChecked(enabled);
  await dialog.getByLabel('Default display currency').selectOption(currency);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('global quote override locks currency controls, preserves local choices and restores them after reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?fixture=1');
  const panel = page.locator('.candle-panel').first();
  await expect(panel).toBeVisible();
  await addIndicator(panel, 'Footprint');
  await addIndicator(panel, 'Order-book Heatmap');
  await addIndicator(panel, 'Footprint Totals');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel');
  await matrix.getByRole('button', { name: 'Depth Matrix settings' }).click();
  await matrix.getByLabel('Liquidity display unit').selectOption('usdt');
  await globalCurrency(page, true);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(matrix.getByLabel('Liquidity display unit')).toBeDisabled();
  await expect(matrix.getByLabel('Liquidity display unit')).toHaveValue('usdt');
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  const footprint = panel.locator('.footprint-settings-dialog');
  await expect(footprint.getByLabel('Footprint volume units')).toBeDisabled();
  await expect(footprint.getByLabel('Footprint volume units')).toHaveValue('usdt');
  await expect(footprint.locator('.global-currency-notice')).toContainText('Global currency setting is set to USDT');
  await page.screenshot({ path: '/tmp/currency-override-dark.png' });
  await footprint.getByRole('button', { name: 'Apply', exact: true }).click();
  const localUnits = () => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].selection.footprintUnits);
  expect(await localUnits()).toBe('btc');
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  const heatmap = panel.locator('.heatmap-settings');
  await expect(heatmap.getByLabel('Quantity units')).toBeDisabled();
  await expect(heatmap.getByLabel('Quantity units')).toHaveValue('usdt');
  await heatmap.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await localUnits()).toBe('btc');
  await globalCurrency(page, true, 'base');
  await expect(matrix.getByLabel('Liquidity display unit')).toHaveValue('btc');
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(footprint.getByLabel('Footprint volume units')).toHaveValue('btc');
  await expect(footprint.getByLabel('Footprint volume units')).toBeDisabled();
  await footprint.getByRole('button', { name: 'Close', exact: true }).click();
  await globalCurrency(page, false);
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(footprint.getByLabel('Footprint volume units')).toBeEnabled();
  await expect(footprint.getByLabel('Footprint volume units')).toHaveValue('btc');
  await expect(footprint.locator('.global-currency-notice')).toBeHidden();
  await footprint.getByRole('button', { name: 'Close', exact: true }).click();
  await matrix.getByRole('button', { name: 'Depth Matrix settings' }).click();
  await expect(matrix.getByLabel('Liquidity display unit')).toBeEnabled();
  await expect(matrix.getByLabel('Liquidity display unit')).toHaveValue('usdt');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await globalCurrency(page, true);
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(footprint.locator('.global-currency-notice')).toBeVisible();
  const bounds = await footprint.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(720);
  await page.screenshot({ path: '/tmp/currency-override-light-narrow.png' });
  expect(errors).toEqual([]);
});

test('saved quote preference scales positioning correctly on first load', async ({ page }) => {
  test.setTimeout(60_000);
  const open = Math.floor(Date.now() / 60_000) * 60_000;
  await page.addInitScript(() => localStorage.setItem('basis.currency-display.v1', JSON.stringify({ enabled: true, currency: 'quote' })));
  await page.context().route('**/market-data/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/native-candles')) return route.fulfill({ json: { source: 'binance-native-kline', candles: Array.from({ length: 1000 }, (_, i) => ({ t: open - (999 - i) * 60_000, o: 80000, h: 81000, l: 79000, c: 80000, v: 1, revision: 1, closed: i < 999 })) } });
    if (!path.endsWith('/net-positioning')) return route.continue();
    const interval = { version: 1, method: 'price-oi', status: 'available', venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', units: 'BTC', startTimeMs: open, endTimeMs: open + 30000, attributionTimeMs: open + 30000, resolutionMs: 30000, direction: 1, oiDeltaBtcDecimal: '2', netLongsBtcDecimal: '2', netShortsBtcDecimal: '0', unclassifiedBtcDecimal: '0', qualityFlags: [], provenance: { priceEnd: { price: 80000 } } };
    await route.fulfill({ json: { version: 1, method: 'price-oi', market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues: ['binance'], intervals: [interval], from: open - 3600000, to: open + 30000, unitVerification: {}, feeds: {}, truncated: false, pendingIntervals: 0, history: 'explicit browser fixture', semantics: 'explicit browser fixture' } });
  });
  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Net Longs — Estimated');
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p?.engine?.netPositioningPanes.get('native.net-longs-estimated');
    if (!view || !view.primitive.diagnostics().candleCount) return false;
    const extent = view.primitive.autoscaleInfo(), range = view.series.priceScale().priceRange();
    return view.primitive.displayCurrency === 'usdt' && extent?.max >= 160000 && range.max >= extent.max;
  })).toBe(true);
});

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/?fixture=1');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels[0]?.bars === 5000);
}

test('fresh and reset workspaces use one Binance chart with Object Tree hidden', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.candle-panel')).toHaveCount(1);
  await expect(page.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('.chart-objects-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Chart market', exact: true })).toContainText('Binance');
  await page.getByRole('button', { name: 'Add chart', exact: true }).click();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await page.locator('#reset').click();
  await expect(page.locator('.candle-panel')).toHaveCount(1);
  await expect(page.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('.chart-objects-panel')).toBeHidden();
  await page.screenshot({ path: '/tmp/iqterminal-single-chart-default.png' });
  await page.reload();
  await expect(page.locator('.candle-panel')).toHaveCount(1);
  await expect(page.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('.chart-objects-panel')).toBeHidden();
});

test('reload retains multiple charts, parameters, and explicit open Object Tree state', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Add chart', exact: true }).click();
  await page.locator('select[aria-label="Timeframe"]').first().selectOption('15m');
  const first = page.locator('.candle-panel').first();
  await first.locator('.chart-objects-toggle').click();
  await expect(first.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'false');
  await page.reload();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect(page.locator('select[aria-label="Timeframe"]').first()).toHaveValue('15m');
  await expect(page.locator('.chart-objects-panel').first()).toHaveAttribute('data-collapsed', 'false');
  await expect(page.locator('.chart-objects-panel').last()).toHaveAttribute('data-collapsed', 'true');
});

test('app teardown flushes a pending layout before Dockview removes the panels', async ({ page }) => {
  await ready(page);
  const saved = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '5m' });
    // This is the same teardown callback registered with Vite HMR. Invoke it
    // immediately, before the 250ms debounce can save the added chart.
    terminal.dispose();
    return JSON.parse(localStorage.getItem('basis.layout.v1')!);
  });
  expect(Object.values(saved.layout.panels)).toHaveLength(2);
  expect(Object.values(saved.layout.panels).some((p: any) => p.params.venue === 'hyperliquid' && p.params.interval === '5m')).toBe(true);
  await page.reload();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect(page.locator('select[aria-label="Timeframe"]').last()).toHaveValue('5m');
});

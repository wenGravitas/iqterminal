import { test, expect } from '@playwright/test';

test('compact venue tabs keep native controls and group-local numbering through reorder and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?fixture=1');
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.addChart({ venue: 'binance', market: 'spot', interval: '5m' });
    const [a, b, c] = t.dock.panels;
    b.api.moveTo({ group: a.api.group }); c.api.moveTo({ group: a.api.group }); a.api.setActive();
  });
  const tabs = page.locator('.dv-tab'); await expect(tabs).toHaveCount(3);
  await expect(page.locator('.chart-tab-ticker')).toHaveText(['BTCUSDT', 'BTC', 'BTCUSDT']);
  await expect(page.locator('.chart-tab-number')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.chart-tab-market')).toHaveText(['P', 'P', 'S']);
  expect(await page.locator('.chart-tab-logo').evaluateAll(images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('#add').focus();
  await page.keyboard.press('Alt+2');
  expect(await page.evaluate(() => (window as any).__terminal.dock.activePanel.api.getParameters().venue)).toBe('hyperliquid');
  // Editable controls keep ownership of key input.
  await page.locator('.candle-panel:visible').getByLabel('Timeframe', { exact: true }).focus();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('SELECT');
  await page.keyboard.press('Alt+1');
  expect(await page.evaluate(() => (window as any).__terminal.dock.activePanel.api.getParameters().venue)).toBe('hyperliquid');
  await page.evaluate(() => {
    const t = (window as any).__terminal, group = t.dock.activeGroup;
    group.panels[2].api.moveTo({ group, index: 0 });
  });
  await expect(page.locator('.chart-tab-market')).toHaveText(['S', 'P', 'P']);
  await expect(page.locator('.chart-tab-number')).toHaveText(['1', '2', '3']);
  await page.locator('#add').focus();
  await page.keyboard.press('Alt+1');
  expect(await page.evaluate(() => (window as any).__terminal.dock.activePanel.api.getParameters().market)).toBe('spot');
  await page.screenshot({ path: 'artifacts/chart-tabs-1366x768.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  await page.screenshot({ path: 'artifacts/chart-tabs-720x860.png' });
  await page.waitForTimeout(400); await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 3);
  await expect(page.locator('.chart-tab-number')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.chart-tab-market')).toHaveText(['S', 'P', 'P']);
  await tabs.first().getByRole('button', { name: /Close/ }).click();
  await expect(tabs).toHaveCount(2); await expect(page.locator('.chart-tab-number')).toHaveText(['1', '2']);
  expect(errors).toEqual([]);
});

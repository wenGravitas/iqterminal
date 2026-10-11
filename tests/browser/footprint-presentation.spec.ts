import { addIndicator, setFootprint, setPriceLevel, setUnits, footprintSettings } from './indicator-actions';
import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';

test('footprint text scales with zoom and independent opacity settings persist without resetting collection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'dark' }); await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order-book Heatmap');
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      const time = Math.floor(Date.now()/60000)*60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells: [{ price: 83000, bidVol: .05, askVol: .45, bidNotional: 4150, askNotional: 37354.5 }],
        open: 83000, high: 83010, low: 83000, close: 83010, delta: .4, minDelta: -.05, maxDelta: .4, quoteDelta: 33204.5, minQuoteDelta: -4150, maxQuoteDelta: 33204.5, coverage: 'partial', gapBefore: false }],
        retentionStart: time, status: { state: 'live', message: 'Explicit test trades', lastUpdate: Date.now(), collectionStartedAt: Date.now(), coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprint?.cellFont)).toBeGreaterThanOrEqual(9);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).heatmapStatus.collectionStart)).not.toBeNull();
  await setUnits(panel, 'usdt');
  await expect(panel.locator('.heatmap-notice')).toContainText('USDT');
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const b = p.engine.heatmap.bins.find((b: any) => b.bid > 0);
    return b && p.engine.heatmap.hoverAt((b.x+b.right)/2, (b.y+b.bottom)/2)?.units;
  })).toBe('usdt');
  const before = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    p.engine.chart.timeScale.setBarSpacing(200); p.engine.chart.timeScale.setRightOffset(1);
    p.engine.chart.panes()[0].priceScale.setAutoScale(false);
    p.engine.chart.panes()[0].priceScale.setFixedRange({ min: 82925, max: 83100 }); p.engine.chart.setAutoScale(false);
    return p.heatmapStatus.collectionStart;
  });
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.footprint.cellFont)).toBeGreaterThan(20);

  await page.screenshot({ path: 'artifacts/footprint-prominent-dark-1366x768.png' });
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(panel.getByLabel('Show VAH and VAL')).toBeChecked(); await panel.getByLabel('Show VAH and VAL').uncheck();
  await expect(panel.getByLabel('Cell opacity (%)')).toHaveValue('85'); await panel.getByLabel('Cell opacity (%)').fill('35');
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await panel.getByRole('button', { name: 'Order-book Heatmap settings', exact: true }).click();
  await expect(panel.getByLabel('Opacity', { exact: true })).toHaveValue('0.85'); await panel.getByLabel('Opacity', { exact: true }).fill('0.65');
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  const state = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return { opacity: p.engine.footprint.opacity, heatmap: p.selection.heatmap.opacity, start: p.heatmapStatus.collectionStart, bars: p.engine.footprintBars.length };
  });
  expect(state).toEqual({ opacity: .35, heatmap: .65, start: before, bars: 1 });
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.setViewportSize({ width: 720, height: 860 });
  await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.timeScale.setRightOffset(0));
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.chart.plotRect(0).width)).toBeLessThan(360);
  await page.screenshot({ path: 'artifacts/footprint-prominent-light-720x860.png' });
  await page.waitForTimeout(400); await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const persisted = await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).selection);
  expect(persisted.footprint.showValueArea).toBe(false); expect(persisted.footprint.opacity).toBe(.35); expect(persisted.heatmap.opacity).toBe(.65); expect(errors).toEqual([]);
});

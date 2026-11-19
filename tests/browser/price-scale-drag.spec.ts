import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('price-scale drag continues across panes and outside the chart until release', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await addIndicator(page.locator('.candle-panel').first(), 'Multi-Venue CVD');
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.panes().length)).toBeGreaterThan(1);
  const geometry = await page.evaluate(() => {
    const panel = [...(window as any).__terminal.panels.values()][0], chart = panel.engine.chart;
    const index = chart.primaryPaneIndex(), plot = chart.plotRect(index);
    const bounds = document.querySelector('.chart-stage')!.getBoundingClientRect();
    const scale = chart.panes()[index].priceScale;
    scale.setPriceRange({ min: 82000, max: 84000 }); scale.setAutoScale(false);
    return { x: bounds.left + plot.left + plot.width + 8,
      y: bounds.top + plot.top + plot.height - 35,
      boundary: bounds.top + plot.top + plot.height, bottom: bounds.bottom };
  });
  const span = () => page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0].engine.chart;
    const range = chart.panes()[chart.primaryPaneIndex()].priceScale.priceRange();
    return range.max - range.min;
  });
  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.down();
  for (const y of [geometry.boundary - 10, geometry.boundary + 20, geometry.bottom + 20]) {
    await page.mouse.move(geometry.x, y, { steps: 4 });
    expect(await span()).toBeCloseTo(2000 * Math.exp(.005 * (y - geometry.y)), 5);
  }
  await page.mouse.up();
  const released = await span();
  await page.mouse.move(geometry.x, geometry.y);
  expect(await span()).toBeCloseTo(released, 5);
});

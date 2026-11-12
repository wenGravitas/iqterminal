import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { selectTheme } from './footer-actions';

test('fixed range profile places through native tools, uses chart price steps and persists', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__profileLabels = [];
    CanvasRenderingContext2D.prototype.fillText = function(text: string, ...args: any[]) {
      if (String(text).startsWith('FRVP')) { const labels = (window as any).__profileLabels; labels.push(String(text)); if (labels.length > 30) labels.shift(); }
      return (fillText as any).call(this, text, ...args);
    };
  });
  await installDepthFixture(page);
  await selectTheme(page, 'dark');
  const panel = page.locator('.candle-panel').first();
  const coordinates = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const dock = (window as any).__terminal.dock;
    if (dock.panels.length > 1) dock.removePanel(dock.panels[1]);
    const chart = p.engine.chart;
    chart.setVisibleLogicalRange({ from: 4850, to: 5005 });
    return true;
  });
  expect(coordinates).toBe(true);
  await panel.locator('.drawing-sidebar-menu-toggle[data-drawing-group="positions"]').click();
  await panel.locator('.drawing-sidebar-flyout-tool[data-drawing-tool="fixed-range-volume-profile"]').click();
  const points = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, chart = p.engine.chart;
    const stage = p.element.querySelector('.chart-stage').getBoundingClientRect(), plot = chart.plotRect(chart.primaryPaneIndex());
    return [4900, 4980].map(index => ({ x: stage.left + plot.left + chart.timeScale.indexToX(index), y: stage.top + plot.top + plot.height * .6 }));
  });
  await page.mouse.click(points[0]!.x, points[0]!.y);
  await page.mouse.move(points[1]!.x, points[1]!.y);
  await page.mouse.click(points[1]!.x, points[1]!.y);
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.drawings().filter((d: any) => d.tool === 'fixed-range-volume-profile').length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__profileLabels.some((s: string) => s.includes('EST') && s.includes('Δ 0.1')))).toBe(true);
  await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.undo());
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.drawings().length)).toBe(0);
  await page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.redo());
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.drawings().length)).toBe(1);
  await panel.locator('.drawing-sidebar-select').click();
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'artifacts/fixed-range-profile-dark.png' });
  await selectTheme(page, 'light');
  await page.screenshot({ path: 'artifacts/fixed-range-profile-light.png' });
  // A price-step change invalidates statistical bins; it never picks an arbitrary row count.
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    p.engine.setFixedProfileStep(25); (window as any).__profileLabels = []; p.engine.refreshCaptionCurrency();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__profileLabels.some((s: string) => s.includes('Δ 25')))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal?.panels.values() ?? []][0] as any)?.engine.drawings.drawings().some((d: any) => d.tool === 'fixed-range-volume-profile'))).toBe(true);
});

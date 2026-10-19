import { test, expect } from '@playwright/test';

test('drawing sidebar groups tools, cycles anchor snapping, and fits a narrow chart pane', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);

  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const sidebar = panel.locator('.drawing-sidebar');
  const linesTrigger = sidebar.getByRole('button', { name: 'Open Lines tools', exact: true });
  const lineFlyout = panel.locator('.drawing-sidebar-flyout[data-drawing-group="lines"]');
  const textTrigger = sidebar.getByRole('button', { name: 'Open Text tools', exact: true });
  const textFlyout = panel.locator('.drawing-sidebar-flyout[data-drawing-group="text"]');

  expect(await sidebar.locator('.drawing-sidebar-group[data-drawing-group="positions"]').evaluate(group => group.nextElementSibling?.matches('.drawing-sidebar-group[data-drawing-group="text"]'))).toBe(true);
  expect(await panel.locator('.drawing-sidebar-direct-tool')).toHaveCount(0);
  const toolIds = await panel.locator('[data-drawing-tool]').evaluateAll(buttons => [...new Set(buttons.map(button => (button as HTMLElement).dataset.drawingTool))].filter(Boolean).sort());
  expect(toolIds).toEqual(['callout', 'fib-retracement', 'horizontal-line', 'horizontal-ray', 'long-position', 'rectangle', 'short-position', 'text', 'trend-line']);
  expect(await panel.evaluate(element => element.querySelectorAll('.chart-toolbar .drawing-sidebar-button').length)).toBe(0);

  const countDrawings = () => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId);
  expect(await countDrawings()).toBe(0);

  await textTrigger.click();
  await expect(textFlyout).toBeVisible();
  await expect(textFlyout.locator('.drawing-sidebar-flyout-tool')).toHaveCount(2);
  await expect(textFlyout.getByRole('button', { name: 'Use Text tool', exact: true })).toBeVisible();
  await expect(textFlyout.getByRole('button', { name: 'Use Callout tool', exact: true })).toBeVisible();
  await expect(textFlyout.locator('.drawing-sidebar-flyout-tool').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(textFlyout).toBeHidden();
  await expect(textTrigger).toBeFocused();

  await linesTrigger.click();
  await expect(lineFlyout).toBeVisible();
  await expect(linesTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(lineFlyout.locator('.drawing-sidebar-flyout-tool')).toHaveCount(3);
  await expect(lineFlyout.locator('.drawing-sidebar-flyout-tool').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(lineFlyout).toBeHidden();
  await expect(linesTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(linesTrigger).toBeFocused();

  await linesTrigger.click();
  await lineFlyout.getByRole('button', { name: 'Use Horizontal Line tool', exact: true }).click();
  await expect(lineFlyout).toBeHidden();
  const linesPrimary = sidebar.locator('.drawing-sidebar-group[data-drawing-group="lines"] .drawing-sidebar-primary');
  await expect(linesPrimary).toHaveAttribute('data-drawing-tool', 'horizontal-line');
  await expect(linesPrimary).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.activeTool(), panelId)).toBe('horizontal-line');
  expect(await countDrawings()).toBe(0);

  const anchor = sidebar.locator('.drawing-sidebar-snap');
  await expect(anchor).toHaveAttribute('data-magnet', 'weak');
  await expect(anchor).toHaveAttribute('aria-label', 'Anchor snapping: Weak');
  for (const mode of ['strong', 'off', 'weak'] as const) {
    await anchor.click();
    await expect(anchor).toHaveAttribute('data-magnet', mode);
    expect(await page.evaluate(id => {
      const view = (window as any).__terminal.panels.get(id);
      return { configured: view.selection.drawingMagnet, active: view.engine.drawings.magnetMode() };
    }, panelId)).toEqual({ configured: mode, active: mode });
  }
  expect(await countDrawings()).toBe(0);

  const layout = await page.evaluate(id => {
    const panel = document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!;
    const workspace = panel.querySelector<HTMLElement>('.chart-workspace')!;
    const rail = panel.querySelector<HTMLElement>('.drawing-sidebar')!;
    const chart = panel.querySelector<HTMLElement>('.chart-stage')!;
    const objectTree = panel.querySelector<HTMLElement>('.chart-objects-panel')!;
    const workspaceBox = workspace.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const chartBox = chart.getBoundingClientRect();
    return {
      paneWidth: workspaceBox.width,
      railWidth: railBox.width,
      chartWidth: chartBox.width,
      objectTreeWidth: objectTree.getBoundingClientRect().width,
      railHorizontalOverflow: rail.scrollWidth > rail.clientWidth,
    };
  }, panelId);
  expect(layout.paneWidth).toBeGreaterThan(500);
  expect(layout.paneWidth).toBeLessThan(700);
  expect(layout.railWidth).toBeGreaterThan(0);
  expect(layout.objectTreeWidth).toBe(280);
  expect(layout.chartWidth).toBeGreaterThan(320);
  expect(layout.railHorizontalOverflow).toBe(false);

  await linesTrigger.click();
  const flyoutBox = await lineFlyout.boundingBox();
  const workspaceBox = await panel.locator('.chart-workspace').boundingBox();
  expect(flyoutBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  if (!flyoutBox || !workspaceBox) throw new Error('Drawing flyout geometry is unavailable');
  expect(flyoutBox.x + flyoutBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width + 1);
  expect(flyoutBox.y + flyoutBox.height).toBeLessThanOrEqual(workspaceBox.y + workspaceBox.height + 1);

  const toolbarBox = await panel.locator('.chart-toolbar').boundingBox();
  if (!toolbarBox) throw new Error('Chart toolbar geometry is unavailable');
  await page.mouse.click(toolbarBox.x + toolbarBox.width - 3, toolbarBox.y + toolbarBox.height / 2);
  await expect(lineFlyout).toBeHidden();
  expect(await countDrawings()).toBe(0);
});

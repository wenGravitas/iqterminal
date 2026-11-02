import { test, expect } from '@playwright/test';

test('drawing sidebar groups tools, cycles anchor snapping, and fits a narrow chart pane', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.locator('#theme').selectOption('dark');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);

  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const sidebar = panel.locator('.drawing-sidebar');
  const rightSidebar = panel.getByRole('complementary', { name: 'Chart sidebar', exact: true });
  await expect(rightSidebar.getByRole('button')).toHaveCount(1);
  await expect(sidebar.locator('.chart-objects-toggle')).toHaveCount(0);
  const objectToggle = rightSidebar.locator('.chart-objects-toggle');
  await expect(objectToggle).toHaveAccessibleName('Close Object Tree');
  await objectToggle.click();
  await expect(panel.locator('.chart-objects-panel')).toBeHidden();
  await expect(rightSidebar).toBeVisible();
  await expect(objectToggle).toHaveAccessibleName('Open Object Tree');
  await objectToggle.click();
  await expect(panel.locator('.chart-objects-panel')).toBeVisible();
  const linesTrigger = sidebar.getByRole('button', { name: 'Open Lines tools', exact: true });
  const lineFlyout = panel.locator('.drawing-sidebar-flyout[data-drawing-group="lines"]');
  const textTrigger = sidebar.getByRole('button', { name: 'Open Text tools', exact: true });
  const textFlyout = panel.locator('.drawing-sidebar-flyout[data-drawing-group="text"]');
  await page.screenshot({ path: '/tmp/drawing-sidebar-refinement.png' });

  expect(await sidebar.locator('.drawing-sidebar-group[data-drawing-group="positions"]').evaluate(group => group.nextElementSibling?.matches('.drawing-sidebar-group[data-drawing-group="text"]'))).toBe(true);
  expect(await panel.locator('.drawing-sidebar-direct-tool')).toHaveCount(0);
  const toolIds = await panel.locator('[data-drawing-tool]').evaluateAll(buttons => [...new Set(buttons.map(button => (button as HTMLElement).dataset.drawingTool))].filter(Boolean).sort());
  expect(toolIds).toEqual(['arrow', 'brush', 'callout', 'date-range', 'fib-retracement', 'horizontal-line', 'horizontal-ray', 'long-position', 'path', 'price-range', 'rectangle', 'short-position', 'text', 'trend-line']);
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
  await expect(lineFlyout.locator('.drawing-sidebar-flyout-tool')).toHaveCount(6);
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
    const rightRail = panel.querySelector<HTMLElement>('.chart-sidebar')!;
    const workspaceBox = workspace.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const chartBox = chart.getBoundingClientRect();
    const select = rail.querySelector<HTMLElement>('.drawing-sidebar-select')!;
    const selectIcon = select.querySelector<SVGElement>('svg')!;
    const primary = rail.querySelector<HTMLElement>('.drawing-sidebar-group[data-drawing-group="lines"] .drawing-sidebar-primary')!;
    const primaryIcon = primary.querySelector<SVGElement>('svg')!;
    const trigger = rail.querySelector<HTMLElement>('.drawing-sidebar-group[data-drawing-group="lines"] .drawing-sidebar-menu-toggle')!;
    const box = (element: Element) => element.getBoundingClientRect();
    const centerX = (rect: DOMRect) => rect.left + rect.width / 2;
    const centerY = (rect: DOMRect) => rect.top + rect.height / 2;
    const selectBox = box(select), selectIconBox = box(selectIcon), primaryBox = box(primary), primaryIconBox = box(primaryIcon), triggerBox = box(trigger);
    const groupBox = box(primary.parentElement!);
    return {
      paneWidth: workspaceBox.width,
      railWidth: railBox.width,
      rightRailWidth: rightRail.getBoundingClientRect().width,
      rightRailInset: workspaceBox.right - rightRail.getBoundingClientRect().right,
      rightRailAfterTree: rightRail.getBoundingClientRect().left >= objectTree.getBoundingClientRect().right,
      chartWidth: chartBox.width,
      objectTreeWidth: objectTree.getBoundingClientRect().width,
      railHorizontalOverflow: rail.scrollWidth > rail.clientWidth,
      selectIconOffsetX: Math.abs(centerX(selectBox) - centerX(selectIconBox)),
      selectIconOffsetY: Math.abs(centerY(selectBox) - centerY(selectIconBox)),
      primaryIconOffsetX: Math.abs(centerX(primaryBox) - centerX(primaryIconBox)),
      primaryIconOffsetY: Math.abs(centerY(primaryBox) - centerY(primaryIconBox)),
      iconColumnOffset: Math.abs(centerX(selectIconBox) - centerX(primaryIconBox)),
      primaryTriggerGap: triggerBox.left - primaryBox.right,
      groupWidth: groupBox.width,
      groupHeight: groupBox.height,
      primaryHeight: primaryBox.height,
      triggerWidth: triggerBox.width,
    };
  }, panelId);
  expect(layout.paneWidth).toBeGreaterThan(500);
  expect(layout.paneWidth).toBeLessThan(700);
  expect(layout.railWidth).toBe(35);
  expect(layout.rightRailWidth).toBe(layout.railWidth);
  expect(layout.rightRailInset).toBe(4);
  expect(layout.rightRailAfterTree).toBe(true);
  expect(layout.objectTreeWidth).toBe(280);
  expect(layout.chartWidth).toBeGreaterThan(280);
  expect(layout.railHorizontalOverflow).toBe(false);
  expect(layout.iconColumnOffset).toBeLessThan(1);
  expect(layout.selectIconOffsetX).toBeLessThan(1);
  expect(layout.selectIconOffsetY).toBeLessThan(1);
  expect(layout.primaryIconOffsetX).toBeLessThan(1);
  expect(layout.primaryIconOffsetY).toBeLessThan(1);
  expect(layout.primaryTriggerGap).toBe(0);
  expect(layout.groupWidth).toBe(28);
  expect(layout.groupHeight).toBe(28);
  expect(layout.primaryHeight).toBe(28);
  expect(layout.triggerWidth).toBe(8);

  await linesTrigger.click();
  const flyoutBox = await lineFlyout.boundingBox();
  const workspaceBox = await panel.locator('.chart-workspace').boundingBox();
  expect(flyoutBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  if (!flyoutBox || !workspaceBox) throw new Error('Drawing flyout geometry is unavailable');
  expect(flyoutBox.x - workspaceBox.x).toBe(37);
  expect(flyoutBox.x + flyoutBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width + 1);
  expect(flyoutBox.y + flyoutBox.height).toBeLessThanOrEqual(workspaceBox.y + workspaceBox.height + 1);

  const toolbarBox = await panel.locator('.chart-toolbar').boundingBox();
  if (!toolbarBox) throw new Error('Chart toolbar geometry is unavailable');
  await page.mouse.click(toolbarBox.x + toolbarBox.width - 3, toolbarBox.y + toolbarBox.height / 2);
  await expect(lineFlyout).toBeHidden();
  expect(await countDrawings()).toBe(0);
});

test('drawing placement shows a crosshair from sidebar and floating tools and restores normal pointer modes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first(), sidebar = panel.locator('.drawing-sidebar'), stage = panel.locator('.chart-stage');
  const point = await panel.evaluate(element => { const p = [...(window as any).__terminal.panels.values()].find((p:any) => p.element === element), plot = p.engine.chart.plotRect(p.engine.chart.primaryPaneIndex()); return { x: plot.left + plot.width * .5, y: plot.top + plot.height * .5 }; });
  const cursor = () => stage.locator('canvas').first().evaluate(canvas => getComputedStyle(canvas).cursor);
  await sidebar.locator('[data-drawing-tool=trend-line].drawing-sidebar-primary').click();
  await stage.hover({ position: point });
  expect(await cursor()).toBe('crosshair');
  await stage.click({ position: point });
  await stage.hover({ position: { x: point.x + 25, y: point.y + 30 } });
  expect(await cursor()).toBe('crosshair');
  await stage.press('Escape');
  await expect(stage).not.toHaveAttribute('data-drawing-placement');
  await sidebar.getByRole('button', { name: 'Open Lines tools', exact: true }).click();
  const horizontal = panel.locator('.drawing-sidebar-flyout [data-drawing-tool=horizontal-line]');
  await horizontal.focus(); await page.keyboard.press('Shift+Enter');
  const floating = panel.getByRole('toolbar', { name: 'Floating drawing toolbar' });
  await floating.getByRole('button', { name: 'Use Horizontal Line tool', exact: true }).click();
  await stage.hover({ position: point }); expect(await cursor()).toBe('crosshair');
  await floating.getByRole('button', { name: 'Pointer', exact: true }).click();
  await expect(stage).not.toHaveAttribute('data-drawing-placement');
  expect(await sidebar.getByRole('button', { name: 'Select drawings', exact: true }).evaluate(button => getComputedStyle(button).cursor)).toBe('pointer');
  await floating.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(stage).not.toHaveAttribute('data-drawing-placement');
  await floating.getByRole('button', { name: 'Pointer', exact: true }).click();
});

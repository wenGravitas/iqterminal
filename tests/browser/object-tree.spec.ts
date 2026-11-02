import { expect, test, type Locator, type Page } from '@playwright/test';
import { addIndicator, chooseChartMarket } from './indicator-actions';

type DrawingMetadata = { id: string; visible?: boolean; intervals?: unknown; analysis?: string };
type DrawingSnapshot = { drawings: DrawingMetadata[]; range: unknown; interval?: string };

async function selectHorizontalLine(panel: Locator) {
  const sidebar = panel.locator('.drawing-sidebar');
  const direct = sidebar.locator('button.drawing-sidebar-direct-tool[data-drawing-tool="horizontal-line"]');
  if (await direct.isVisible()) { await direct.click(); return; }
  const primary = sidebar.locator('button.drawing-sidebar-primary[data-drawing-tool="horizontal-line"]');
  if (await primary.isVisible()) { await primary.click(); return; }
  const option = panel.locator('.drawing-sidebar-flyout-tool[data-drawing-tool="horizontal-line"]');
  await sidebar.locator(`.drawing-sidebar-menu-toggle[data-drawing-group="${await option.getAttribute('data-drawing-group')}"]`).click();
  await option.click();
}

async function placeLine(page: Page, panel: Locator, ordinal: number) {
  await selectHorizontalLine(panel);
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const point = await page.evaluate(({ id, ordinal }) => {
    const view = (window as any).__terminal.panels.get(id);
    const plot = view.engine.chart.plotRect(0);
    return { x: Math.round(plot.left + plot.width * (.35 + ordinal * .08)), y: Math.round(plot.top + plot.height * (.42 + ordinal * .04)) };
  }, { id: panelId, ordinal });
  await panel.locator('.chart-stage').click({ position: point });
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId)).toBe(ordinal + 1);
}

async function renameFolder(page: Page, node: Locator, name: string) {
  await node.focus();
  await page.keyboard.press('F2');
  const input = node.locator('input[data-tree-edit="folder"]');
  await input.fill(name);
  await input.press('Enter');
  await expect(node.locator(':scope > .chart-object-folder-row .chart-object-folder-name')).toHaveText(name);
}

test('Object Tree row actions use icons with state-aware tooltips', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  await placeLine(page, panel, 0);
  const row = panel.locator('.chart-object-row.kind-drawing').first();
  const titles = ['Hide object', 'Lock object', 'Duplicate drawing', 'Open object settings', 'Remove object', 'More drawing actions'];
  for (const title of titles) {
    const button = row.getByRole('button', { name: title, exact: true });
    await expect(button).toHaveAttribute('title', title);
    await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(button).toHaveText('');
  }
  await row.getByRole('button', { name: 'Hide object', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Show object', exact: true })).toHaveAttribute('title', 'Show object');
  await expect(row.locator('[data-object-action="visible"]')).toHaveAttribute('data-icon', 'hiddenEye');
  await row.getByRole('button', { name: 'Show object', exact: true }).click();
  await row.getByRole('button', { name: 'Lock object', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Unlock object', exact: true })).toHaveAttribute('title', 'Unlock object');
  await expect(row.locator('[data-object-action="lock"]')).toHaveAttribute('data-icon', 'lock');
  await row.getByRole('button', { name: 'Unlock object', exact: true }).click();
  await row.getByRole('button', { name: 'More drawing actions', exact: true }).click();
  const menu = page.locator('body > .chart-object-tree-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(row.locator('[data-object-action="more"] svg')).toHaveCount(1);
  await row.screenshot({ path: 'artifacts/object-tree-row-icons.png' });
});

test('folder sidebar pins choose icons, toggle nested contents in one undo step and persist', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  let panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Missing chart panel');
  for (let index = 0; index < 3; index++) await placeLine(page, panel, index);
  const drawingIds = await page.evaluate(id => {
    const drawings = (window as any).__terminal.panels.get(id).engine.drawings.drawings().map((item: any) => item.id);
    const entries = [{ type: 'folder', id: 'levels', name: 'Levels', children: [
      { type: 'drawing', drawingId: drawings[0] },
      { type: 'folder', id: 'nested', name: 'Nested', children: [{ type: 'drawing', drawingId: drawings[1] }] },
    ] }, { type: 'drawing', drawingId: drawings[2] }];
    localStorage.setItem(`iqterminal:object-tree:v1:${encodeURIComponent(id)}:binance%3Aperpetual:BTCUSDT`, JSON.stringify({ version: 1, revision: 1, entries }));
    return drawings;
  }, panelId);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  panel = page.locator(`[data-panel-id="${panelId}"]`);
  const folder = panel.locator('[role="treeitem"][data-tree-id="levels"]');
  const nested = panel.locator('[role="treeitem"][data-tree-id="nested"]');
  const picker = page.getByRole('dialog', { name: 'Folder sidebar icon', exact: true });
  const sidebar = panel.locator('.chart-sidebar');
  await folder.getByRole('button', { name: 'Show Levels in sidebar', exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('group', { name: 'Drawing icons', exact: true }).getByRole('button')).toHaveCount(95);
  await expect(picker.getByRole('group', { name: 'Letters', exact: true }).getByRole('button')).toHaveCount(26);
  await expect(picker.getByRole('group', { name: 'Numbers', exact: true }).getByRole('button')).toHaveCount(10);
  await page.screenshot({ path: 'artifacts/folder-sidebar-picker.png' });
  await picker.getByRole('button', { name: 'A', exact: true }).click();
  await expect(picker).toBeHidden();
  const parentToggle = sidebar.locator('[data-sidebar-folder="levels"]');
  await expect(parentToggle).toHaveText('A');
  await expect(parentToggle).toHaveAttribute('title', 'Levels');
  await nested.getByRole('button', { name: 'Show Nested in sidebar', exact: true }).click();
  await picker.getByRole('button', { name: 'fib retracement', exact: true }).click();
  const nestedToggle = sidebar.locator('[data-sidebar-folder="nested"]');
  await expect(nestedToggle.locator('svg')).toHaveCount(1);
  await expect(sidebar.getByRole('button')).toHaveCount(3);
  await panel.locator('.chart-objects-toggle').click();
  await expect(panel.locator('.chart-objects-panel')).toBeHidden();
  const visibility = () => page.evaluate(({ id, ids }) => {
    const draw = (window as any).__terminal.panels.get(id).engine.drawings;
    return ids.map((drawingId: string) => draw.get(drawingId).visible !== false);
  }, { id: panelId, ids: drawingIds });
  await parentToggle.click();
  expect(await visibility()).toEqual([false, false, true]);
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await visibility()).toEqual([true, true, true]);
  await parentToggle.click();
  await nestedToggle.click();
  expect(await visibility()).toEqual([false, true, true]);
  await expect(parentToggle).toHaveAttribute('data-visibility-state', 'mixed');
  await parentToggle.click();
  expect(await visibility()).toEqual([true, true, true]);
  await parentToggle.click({ button: 'right' });
  await picker.getByRole('button', { name: '9', exact: true }).click();
  await expect(parentToggle).toHaveText('9');
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await expect(parentToggle).toHaveText('9');
  await expect(nestedToggle.locator('svg')).toHaveCount(1);
  await panel.locator('.chart-objects-toggle').click();
  await renameFolder(page, folder, 'Support');
  await expect(parentToggle).toHaveAttribute('title', 'Support');
  await folder.getByRole('button', { name: 'Hide Support from sidebar', exact: true }).click();
  await expect(parentToggle).toHaveCount(0);
  await folder.getByRole('button', { name: 'Show Support in sidebar', exact: true }).click();
  await expect(picker.getByRole('button', { name: '9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(parentToggle).toHaveText('9');
  await folder.getByRole('button', { name: 'Choose sidebar icon for Support', exact: true }).click();
  await panel.locator('.chart-stage').click({ position: { x: 80, y: 100 } });
  await expect(picker).toBeHidden();
  await expect(page.locator('.candle-panel').nth(1).locator('.chart-sidebar [data-sidebar-folder]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/folder-sidebar-pins.png' });
  await folder.locator(':scope > .chart-object-folder-row [data-tree-action="menu"]').click();
  await page.getByRole('menuitem', { name: 'Delete folder (keep contents)', exact: true }).click();
  await expect(parentToggle).toHaveCount(0);
  await expect(nestedToggle).toBeVisible();
  expect(await visibility()).toEqual([true, true, true]);
});

test('chart drawing context menu opens settings, clones and deletes with undo', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  await placeLine(page, panel, 0);
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Select drawings', exact: true }).click();
  const point = await page.evaluate(id => {
    const engine = (window as any).__terminal.panels.get(id).engine;
    const drawing = engine.drawings.drawings()[0];
    const plot = engine.chart.plotRect(0);
    return { x: plot.left + plot.width * .65, y: engine.chart.priceToCoordinate(drawing.points[0].price, 0) };
  }, panelId);
  const count = () => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId);
  const menu = page.getByRole('menu', { name: 'Drawing actions', exact: true });
  const open = async () => {
    await panel.locator('.chart-stage').click({ button: 'right', position: point });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Delete', 'Clone', 'Settings']);
  };
  await open();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(panel.locator('.chart-stage')).toBeFocused();
  await open();
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Select drawings', exact: true }).click();
  await expect(menu).toBeHidden();
  await open();
  await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Drawing settings', exact: true });
  await expect(settings).toBeVisible();
  await expect(menu).toBeHidden();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open();
  await page.screenshot({ path: 'artifacts/chart-drawing-context-menu.png' });
  await menu.getByRole('menuitem', { name: 'Clone', exact: true }).click();
  await expect.poll(count).toBe(2);
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(count).toBe(1);
  await open();
  await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect.poll(count).toBe(0);
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(count).toBe(1);
  await panel.locator('.chart-stage').click({ button: 'right', position: { x: point.x, y: point.y + 80 } });
  await expect(menu).toBeHidden();
});

test('per-chart Object Tree resizes, nests by drag, and groups native visibility in one undo step', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const sidebar = panel.locator('.chart-objects-panel');
  const tree = sidebar.locator('.chart-object-tree');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(280);

  const beforeResize = await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    (window as any).__objectTreeEngine = view.engine;
    return { stageWidth: view.chart.getBoundingClientRect().width, sidebarWidth: view.objectsPanel.getBoundingClientRect().width, subscriptions: (window as any).__terminal.stats().feed.subscriptions, bars: view.engine.barCount };
  }, panelId);
  const separator = sidebar.locator('.chart-object-tree-resize');
  const resizeBox = await separator.boundingBox();
  if (!resizeBox) throw new Error('Object Tree resize separator is not laid out');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 - 50, resizeBox.y + 100);
  await page.mouse.up();
  await expect(sidebar.locator('.chart-object-tree-resize')).toHaveAttribute('aria-valuenow', '330');
  const afterResize = await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    return { sameEngine: view.engine === (window as any).__objectTreeEngine, stageWidth: view.chart.getBoundingClientRect().width, sidebarWidth: view.objectsPanel.getBoundingClientRect().width, subscriptions: (window as any).__terminal.stats().feed.subscriptions, bars: view.engine.barCount };
  }, panelId);
  expect(afterResize.sameEngine).toBe(true);
  expect(afterResize.sidebarWidth).toBeGreaterThan(beforeResize.sidebarWidth + 40);
  expect(afterResize.stageWidth).toBeLessThan(beforeResize.stageWidth - 40);
  expect(afterResize.subscriptions).toBe(beforeResize.subscriptions);
  expect(afterResize.bars).toBe(5000);
  const toggle=panel.locator('.chart-objects-toggle');
  await expect(toggle).toHaveAttribute('title','Close Object Tree');
  await expect(toggle).toHaveAccessibleName('Close Object Tree');
  const closeIcon=await toggle.locator('svg').innerHTML();
  await expect(sidebar.getByRole('button',{name:'Close Object Tree'})).toHaveAttribute('title','Close Object Tree');
  await sidebar.getByRole('button', { name: 'Close Object Tree' }).click();
  await expect(toggle).toHaveAttribute('title','Open Object Tree');
  await expect(toggle).toHaveAccessibleName('Open Object Tree');
  expect(await toggle.locator('svg').innerHTML()).not.toBe(closeIcon);
  await expect(sidebar).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
  await panel.locator('.chart-objects-toggle').click();
  await expect(toggle).toHaveAttribute('title','Close Object Tree');
  expect(await toggle.locator('svg').innerHTML()).toBe(closeIcon);
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  await expect(sidebar.locator('.chart-object-tree-resize')).toHaveAttribute('aria-valuenow', '330');

  await sidebar.getByRole('button', { name: 'New folder', exact: true }).click();
  const initialFolder = tree.locator('[role="treeitem"][data-tree-kind="folder"]').first();
  await renameFolder(page, initialFolder, 'Plans');
  await initialFolder.locator(':scope > .chart-object-folder-row .chart-object-tree-more').click();
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  const nestedInput = tree.locator('input[data-tree-edit="folder"]');
  const nestedFolderId = await nestedInput.getAttribute('data-tree-id');
  if (!nestedFolderId) throw new Error('Nested folder tree row has no id');
  const nestedFolder = tree.locator(`[role="treeitem"][data-tree-id="${nestedFolderId}"]`);
  await nestedInput.fill('Intraday');
  await nestedInput.press('Enter');
  await expect(nestedFolder.locator('.chart-object-folder-name')).toHaveText('Intraday');

  // The child folder can be reordered and removed without deleting its drawings.
  const archiveNew = sidebar.getByRole('button', { name: 'New folder', exact: true });
  await archiveNew.click();
  const archiveInput = tree.locator('input[data-tree-edit="folder"]');
  const archiveId = await archiveInput.getAttribute('data-tree-id');
  if (!archiveId) throw new Error('Archive folder tree row has no id');
  const archive = tree.locator(`[role="treeitem"][data-tree-id="${archiveId}"]`);
  await archiveInput.fill('Archive');
  await archiveInput.press('Enter');
  await expect(archive.locator('.chart-object-folder-name')).toHaveText('Archive');
  const plansName = tree.locator('.chart-object-folder-name').filter({ hasText: 'Plans' });
  const plans = plansName.locator('xpath=../..');
  await archive.locator('.chart-object-folder-name').dragTo(plans.locator(':scope > .chart-object-folder-row'));
  const plansChildren = plans.locator('.chart-object-children > [data-tree-kind="folder"] .chart-object-folder-name');
  await expect(plansChildren).toHaveCount(2);
  await expect(plansChildren.filter({ hasText: 'Archive' })).toHaveCount(1);
  await archive.locator(':scope > .chart-object-folder-row .chart-object-tree-more').click();
  await page.getByRole('menuitem', { name: 'Move to Folder · Root', exact: true }).click();
  await expect(archive).toHaveCount(1);
  expect(await archive.evaluate(node => node.parentElement?.classList.contains('chart-object-tree'))).toBe(true);
  await expect(plansChildren).toHaveCount(1);
  await archive.locator('.chart-object-tree-more').click();
  await page.getByRole('menuitem', { name: 'Delete folder (keep contents)' }).click();
  await expect(tree.locator('.chart-object-folder-name').filter({ hasText: 'Archive' })).toHaveCount(0);

  for (let index = 0; index < 3; index++) await placeLine(page, panel, index);
  const rootDrawings = tree.locator(':scope > [role="treeitem"][data-tree-kind="drawing"]');
  await expect(rootDrawings).toHaveCount(3);
  const nestedRow = nestedFolder.locator('.chart-object-folder-row');
  for (let index = 0; index < 3; index++) {
    const drawingName = rootDrawings.first().locator('.chart-object-name');
    await drawingName.dragTo(nestedRow);
  }
  await expect(nestedFolder.locator('.chart-object-children > [data-tree-kind="drawing"]')).toHaveCount(3);
  await expect(rootDrawings).toHaveCount(0);

  const drawingMetadata: DrawingSnapshot = await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    const drawings = view.engine.drawings.drawings();
    view.engine.drawings.updateMany(drawings.map((drawing: any, index: number) => ({
      id: drawing.id,
      patch: { visible: index === 2, intervals: { from: '1m', to: '15m' }, props: { ...drawing.props, iqterminalAnalysisInterval: '4h' } },
    })));
    return {
      drawings: view.engine.drawings.drawings().map((drawing: any) => ({ id: drawing.id, visible: drawing.visible, intervals: drawing.intervals, analysis: drawing.props.iqterminalAnalysisInterval })),
      range: view.engine.visibleRange(), interval: view.engine.drawings.interval(),
    };
  }, panelId);
  expect(drawingMetadata.drawings.filter(drawing => drawing.visible !== false)).toHaveLength(1);
  const folderVisibility = initialFolder.locator(':scope > .chart-object-folder-row .chart-object-folder-visibility');
  await expect(folderVisibility).toHaveAttribute('data-visibility-state', 'mixed');
  await folderVisibility.click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().every((drawing: any) => drawing.visible !== false), panelId)).toBe(true);
  const afterShow: DrawingSnapshot = await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    return { drawings: view.engine.drawings.drawings().map((drawing: any) => ({ id: drawing.id, visible: drawing.visible, intervals: drawing.intervals, analysis: drawing.props.iqterminalAnalysisInterval })), range: view.engine.visibleRange(), interval: view.engine.drawings.interval() };
  }, panelId);
  expect(afterShow.drawings.map(({ id, intervals, analysis }) => ({ id, intervals, analysis }))).toEqual(drawingMetadata.drawings.map(({ id, intervals, analysis }) => ({ id, intervals, analysis })));
  expect(afterShow.range).toEqual(drawingMetadata.range);
  expect(afterShow.interval).toBe(drawingMetadata.interval);
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterUndo: DrawingSnapshot = await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    return { drawings: view.engine.drawings.drawings().map((drawing: any) => ({ id: drawing.id, visible: drawing.visible, intervals: drawing.intervals, analysis: drawing.props.iqterminalAnalysisInterval })), range: view.engine.visibleRange() };
  }, panelId);
  expect(afterUndo.drawings.map(drawing => drawing.visible !== false)).toEqual(drawingMetadata.drawings.map(drawing => drawing.visible !== false));
  expect(afterUndo.drawings.map(({ id, intervals, analysis }) => ({ id, intervals, analysis }))).toEqual(drawingMetadata.drawings.map(({ id, intervals, analysis }) => ({ id, intervals, analysis })));
  expect(afterUndo.range).toEqual(drawingMetadata.range);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().every((drawing: any) => drawing.visible !== false), panelId)).toBe(true);
  await folderVisibility.click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().every((drawing: any) => drawing.visible === false), panelId)).toBe(true);

  const selectedDrawing = nestedFolder.locator('.chart-object-children > [data-tree-kind="drawing"]').first();
  const selectedDrawingId = await selectedDrawing.getAttribute('data-tree-id');
  if (!selectedDrawingId) throw new Error('Drawing tree row has no id');
  await selectedDrawing.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(({ id, drawingId }) => {
    const view = (window as any).__terminal.panels.get(id);
    return view.engine.drawings.selected() === drawingId;
  }, { id: panelId, drawingId: selectedDrawingId })).toBe(true);
  await selectedDrawing.focus();
  await page.keyboard.press('F2');
  const drawingNameInput = selectedDrawing.locator('input[data-tree-edit="drawing"]');
  await drawingNameInput.fill('Opening sweep');
  await drawingNameInput.press('Enter');
  await expect(selectedDrawing.locator('.chart-object-name')).toHaveText('Opening sweep');

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const restored = page.locator(`[data-panel-id="${panelId}"]`);
  const restoredTree = restored.locator('.chart-object-tree');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().every((drawing: any) => drawing.visible === false), panelId)).toBe(true);
  await expect(restored.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'false');
  await expect(restored.locator('.chart-object-tree-resize')).toHaveAttribute('aria-valuenow', '330');
  await expect(restoredTree.locator('.chart-object-folder-name').filter({ hasText: 'Plans' })).toBeVisible();
  await expect(restoredTree.locator('.chart-object-folder-name').filter({ hasText: 'Intraday' })).toBeVisible();
  await expect(restoredTree.locator('.chart-object-name').filter({ hasText: 'Opening sweep' })).toBeVisible();
  const treeKey = `iqterminal:object-tree:v1:${encodeURIComponent(panelId)}:${encodeURIComponent('binance:perpetual')}:${encodeURIComponent('BTCUSDT')}`;
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), treeKey);
  expect(saved).toMatchObject({ version: 1, entries: expect.any(Array) });
  const storedNested = saved.entries.find((entry: any) => entry.type === 'folder' && entry.name === 'Plans')?.children.find((entry: any) => entry.type === 'folder' && entry.name === 'Intraday');
  expect(storedNested?.children).toHaveLength(3);

  await restored.getByLabel('Timeframe', { exact: true }).selectOption('1h');
  await expect.poll(async () => (await restored.locator('.chart-object-tree .chart-object-folder-name').filter({ hasText: 'Plans' }).count())).toBe(1);
  await chooseChartMarket(restored, 'Hyperliquid · BTC Perp');
  await expect(restored.locator('.chart-object-folder-name')).toHaveCount(0);
  await chooseChartMarket(restored, 'Binance · BTCUSDT USD-M Perp');
  await expect(restored.locator('.chart-object-tree .chart-object-folder-name').filter({ hasText: 'Plans' })).toBeVisible();

  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'binance', market: 'perpetual', interval: '1m' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.panels.size)).toBe(3);
  await expect(page.locator('.candle-panel .chart-objects-panel')).toHaveCount(3);
  const secondPanelId = await page.evaluate(() => (window as any).__terminal.stats().panels.filter((item: any) => item.series.venue === 'binance' && item.series.market === 'perpetual')[1].id as string);
  const secondTree = page.locator(`[data-panel-id="${secondPanelId}"] .chart-object-tree`);
  await expect(secondTree.locator('.chart-object-folder-name')).toHaveCount(0);
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId)).toBe(3);
});

test('Object Tree handles hundreds of folders through delegated row actions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const key = `iqterminal:object-tree:v1:${encodeURIComponent(panelId)}:${encodeURIComponent('binance:perpetual')}:${encodeURIComponent('BTCUSDT')}`;
  const entries = Array.from({ length: 250 }, (_, index) => ({ type: 'folder', id: `folder-${index}`, name: `Folder ${index}`, children: [] }));
  await page.evaluate(({ key, entries }) => localStorage.setItem(key, JSON.stringify({ version: 1, revision: 1, entries })), { key, entries });
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const tree = page.locator(`[data-panel-id="${panelId}"] .chart-object-tree`);
  await expect(tree.locator('[role="treeitem"][data-tree-kind="folder"]')).toHaveCount(250);
  const lastFolder = tree.locator('[role="treeitem"][data-tree-id="folder-249"]');
  await lastFolder.locator('[data-tree-action="menu"]').click();
  const menu = page.locator('body > .chart-object-tree-menu');
  await expect(menu).toBeVisible();
  // Real pointer events must dismiss even where chart controls stop bubbling.
  await panel.locator('.chart-stage').click({ position: { x: 80, y: 100 } });
  await expect(menu).toBeHidden();
  await lastFolder.locator('[data-tree-action="menu"]').click();
  await expect(menu).toBeVisible();
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Select drawings', exact: true }).click();
  await expect(menu).toBeHidden();
  await lastFolder.locator('[data-tree-action="menu"]').click();
  await expect(menu).toBeVisible();
  await page.locator('.candle-panel').nth(1).locator('.chart-stage').click({ position: { x: 250, y: 100 } });
  await expect(menu).toBeHidden();
  await lastFolder.locator('[data-tree-action="menu"]').click();
  await expect(menu).toBeVisible();
  // Escape still dismisses after keyboard focus leaves the menu.
  await panel.locator('.drawing-sidebar').getByRole('button', { name: 'Select drawings', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(lastFolder).toBeFocused();
  await lastFolder.locator('[data-tree-action="menu"]').click();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = lastFolder.locator('input[data-tree-edit="folder"]');
  await rename.fill('Final folder');
  await rename.press('Enter');
  await expect(lastFolder.locator('.chart-object-folder-name')).toHaveText('Final folder');
  await expect(tree.locator('[role="treeitem"][data-tree-kind="folder"]')).toHaveCount(250);
});

test('invalid object-tree and sidebar records stay untouched and report session-only state', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const series = await page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().series, panelId);
  const treeKey = `iqterminal:object-tree:v1:${encodeURIComponent(panelId)}:${encodeURIComponent(`${series.venue}:${series.market}`)}:${encodeURIComponent(series.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT')}`;
  const preferencesKey = `iqterminal:object-tree-sidebar:v1:${encodeURIComponent(panelId)}`;
  const invalidTree = '{"version":88,"revision":0,"entries":[]}';
  const invalidPreferences = '{broken sidebar settings';
  await page.evaluate(({ treeKey, preferencesKey, invalidTree, invalidPreferences }) => {
    localStorage.setItem(treeKey, invalidTree);
    localStorage.setItem(preferencesKey, invalidPreferences);
  }, { treeKey, preferencesKey, invalidTree, invalidPreferences });
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const restored = page.locator(`[data-panel-id="${panelId}"]`);
  await expect(restored.locator('.chart-objects-panel')).toHaveAttribute('data-storage', 'degraded');
  await expect(restored.locator('.chart-object-tree-status')).toContainText('session memory');
  expect(await page.evaluate(({ treeKey, preferencesKey }) => ({ tree: localStorage.getItem(treeKey), preferences: localStorage.getItem(preferencesKey) }), { treeKey, preferencesKey })).toEqual({ tree: invalidTree, preferences: invalidPreferences });
  await expect(restored.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'true');
  await expect(restored.locator('.chart-objects-panel')).toBeHidden();
});


test('indicators share nested drawing folders, sidebar toggles and persistence without changing pane placement', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  let panel = page.locator('.candle-panel').first();
  const panelId = (await panel.getAttribute('data-panel-id'))!;
  await addIndicator(panel, 'Multi-Venue CVD'); await addIndicator(panel, 'Open Interest');
  await placeLine(page, panel, 0);
  let tree = panel.locator('.chart-object-tree');
  const indicator = (name: string) => tree.locator('[data-tree-kind="indicator"]').filter({ has: page.locator('.chart-object-name', { hasText: name }) });
  await expect(indicator('Multi-Venue CVD')).toHaveCount(1); await expect(indicator('Open Interest')).toHaveCount(1);
  await expect(panel.locator('.chart-object-inventory .kind-indicator')).toHaveCount(0);
  await expect(indicator('Multi-Venue CVD').locator('[data-object-action="lock"],[data-object-action="duplicate"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'New folder', exact: true }).click();
  let input = tree.locator('input[data-tree-edit="folder"]'); const folderId = (await input.getAttribute('data-tree-id'))!;
  await input.fill('Analysis'); await input.press('Enter');
  let folder = tree.locator(`[data-tree-kind="folder"][data-tree-id="${folderId}"]`);
  await folder.locator(':scope > .chart-object-folder-row .chart-object-tree-more').click();
  await page.getByRole('menuitem', { name: 'New subfolder', exact: true }).click();
  input = tree.locator('input[data-tree-edit="folder"]'); const nestedId = (await input.getAttribute('data-tree-id'))!;
  await input.fill('Signals'); await input.press('Enter');
  let nested = tree.locator(`[data-tree-kind="folder"][data-tree-id="${nestedId}"]`);
  const before = await page.evaluate(id => { const p = (window as any).__terminal.panels.get(id); return { pane: p.cvdView.paneIndex(), data: p.cvdData.demandDiagnostics(), range: p.engine.chart.getVisibleLogicalRange() }; }, panelId);
  await indicator('Multi-Venue CVD').locator('.chart-object-name').dragTo(nested.locator(':scope > .chart-object-folder-row'));
  await tree.locator('[data-tree-kind="drawing"] .chart-object-name').dragTo(nested.locator(':scope > .chart-object-folder-row'));
  await indicator('Open Interest').getByRole('button', { name: 'More indicator actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to Folder · Analysis / Signals', exact: true }).click();
  await expect(nested.locator(':scope > .chart-object-children > [data-tree-kind="indicator"]')).toHaveCount(2);
  const after = await page.evaluate(id => { const p = (window as any).__terminal.panels.get(id); return { pane: p.cvdView.paneIndex(), data: p.cvdData.demandDiagnostics(), range: p.engine.chart.getVisibleLogicalRange() }; }, panelId);
  expect(after.pane).toBe(before.pane); expect(after.range).toEqual(before.range);
  expect(after.data.subscriptionStarts).toBe(before.data.subscriptionStarts);
  await indicator('Multi-Venue CVD').getByRole('button', { name: 'Open object settings', exact: true }).click();
  await expect(panel.getByRole('dialog', { name: 'Multi-Venue CVD settings', exact: true })).toBeVisible();
  await panel.getByRole('dialog', { name: 'Multi-Venue CVD settings', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await folder.getByRole('button', { name: 'Show Analysis in sidebar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Folder sidebar icon', exact: true }).getByRole('button', { name: 'A', exact: true }).click();
  let pinned = panel.locator(`[data-sidebar-folder="${folderId}"]`);
  await pinned.click();
  await expect(nested.locator('[data-tree-kind="indicator"]')).toHaveCount(2);
  await expect(nested.locator('[data-object-action="visible"][data-icon="hiddenEye"]')).toHaveCount(3);
  await expect(pinned).toHaveAttribute('data-visibility-state', 'none');
  await pinned.click();
  await expect(nested.locator('[data-object-action="visible"][data-icon="eye"]')).toHaveCount(3);
  await indicator('Open Interest').getByRole('button', { name: 'Hide object', exact: true }).click();
  await expect(pinned).toHaveAttribute('data-visibility-state', 'mixed');
  await page.reload(); panel = page.locator(`[data-panel-id="${panelId}"]`); tree = panel.locator('.chart-object-tree');
  folder = tree.locator(`[data-tree-id="${folderId}"]`); nested = tree.locator(`[data-tree-id="${nestedId}"]`); pinned = panel.locator(`[data-sidebar-folder="${folderId}"]`);
  await expect(nested.locator('[data-tree-kind="indicator"]')).toHaveCount(2);
  await expect(indicator('Open Interest').getByRole('button', { name: 'Show object', exact: true })).toBeVisible();
  await expect(pinned).toHaveAttribute('data-visibility-state', 'mixed');
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect(nested.locator('[data-tree-kind="indicator"]')).toHaveCount(2);
  await pinned.click(); await expect(nested.locator('[data-object-action="visible"][data-icon="eye"]')).toHaveCount(3);
  await folder.locator(':scope > .chart-object-folder-row .chart-object-tree-more').click();
  await page.getByRole('menuitem', { name: 'Delete folder (keep contents)', exact: true }).click();
  await expect(tree.locator(`[data-tree-id="${folderId}"]`)).toHaveCount(0);
  await expect(tree.locator(`[data-tree-id="${nestedId}"] [data-tree-kind="indicator"]`)).toHaveCount(2);
  await indicator('Open Interest').getByRole('button', { name: 'Remove object', exact: true }).click();
  await expect(indicator('Open Interest')).toHaveCount(0); await expect(indicator('Multi-Venue CVD')).toHaveCount(1);
  expect(errors).toEqual([]);
  await panel.screenshot({ path: 'artifacts/object-tree-mixed.png' });
});

test('indicator tree rows respect dependent-study removal guards', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first(), tree = panel.locator('.chart-object-tree');
  await addIndicator(panel, 'Multi-Venue CVD');
  await panel.getByRole('button', { name: 'Add moving average to Multi-Venue CVD', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await add.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const cvd = tree.locator('[data-tree-kind="indicator"][data-tree-id="native.multi-venue-cvd"]');
  await expect(tree.locator('[data-tree-kind="indicator"]')).toHaveCount(2);
  await expect(cvd.getByRole('button', { name: 'Remove object', exact: true })).toHaveCount(0);
  await cvd.focus(); await page.keyboard.press('Delete'); await expect(cvd).toHaveCount(1);
  await cvd.getByRole('button', { name: 'More indicator actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const sma = tree.locator('[data-tree-kind="indicator"]').filter({ hasText: 'SMA' });
  await sma.getByRole('button', { name: 'Remove object', exact: true }).click();
  await expect(cvd.getByRole('button', { name: 'Remove object', exact: true })).toBeVisible();
  await cvd.getByRole('button', { name: 'Remove object', exact: true }).click();
  await expect(tree.locator('[data-tree-kind="indicator"]')).toHaveCount(0);
});

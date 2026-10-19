import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseChartMarket } from './indicator-actions';

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
  await expect(node.locator('.chart-object-folder-name')).toHaveText(name);
}

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
  await sidebar.getByRole('button', { name: 'Collapse object tree sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(28);
  await panel.getByRole('button', { name: /^Objects/ }).click();
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
  await expect(restored.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'false');
});

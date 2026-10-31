import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function managedPaneState(page: import('@playwright/test').Page, panelId: string) {
  return page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    const indicators = panel.selection.indicators;
    const cvd = indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const openInterest = indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const volume = indicators.find((item: any) => item.definitionId === 'script:builtin.volume-histogram');
    const sma = indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const group = panel.selection.composition.panes.find((pane: any) => [cvd?.instanceId, openInterest?.instanceId, volume?.instanceId]
      .filter(Boolean).every((member: string) => pane.memberIds.includes(member)));
    const actual = {
      cvd: panel.cvdView?.paneIndex() ?? -1,
      openInterest: panel.openInterestView?.paneIndex() ?? -1,
      volume: volume ? panel.studies.paneIndex(volume.instanceId) : -1,
      sma: sma ? panel.compositionApis.get(sma.instanceId)?.paneIndex ?? -1 : -1,
    };
    const panes = panel.engine.chart.panes().map((pane: any, index: number) => ({
      index,
      cvd: pane.element?.dataset?.cvd === 'true',
      openInterest: pane.element?.dataset?.openInterest === 'true',
      indicators: panel.engine.chart.indicators().filter((indicator: any) => indicator.paneIndex === index).map((indicator: any) => indicator.id),
      objects: panel.engine.objects.list().filter((object: any) => object.paneIndex === index).length,
      drawings: panel.engine.drawings.drawings().filter((drawing: any) => drawing.paneIndex === index).length,
    }));
    const managedIndex = [actual.sma, actual.openInterest, actual.volume, actual.cvd].find(index => index >= 0) ?? -1;
    const managedState = panel.selection.composition.panes.find((pane: any) => pane.id === group?.id);
    const geometry = managedIndex >= 0 ? { weight: panel.engine.chart.paneWeight(managedIndex),
      collapsed: panel.engine.chart.paneCollapsed(managedIndex), order: managedState?.order,
      savedWeight: managedState?.weight, savedCollapsed: managedState?.collapsed } : undefined;
    return { ids: { cvd: cvd?.instanceId, openInterest: openInterest?.instanceId, volume: volume?.instanceId, sma: sma?.instanceId },
      logicalPaneId: group?.id, members: group?.memberIds ?? [], instances: indicators.map((item: any) => ({ id: item.instanceId, definitionId: item.definitionId, paneId: item.paneId, visible: item.visible, placement: item.placement })),
      compositionPanes: panel.selection.composition.panes, actual, panes, paneCount: panes.length, geometry,
      resolutions: panel.diagnostics().managedPaneResolutions,
      cvd: { visible: cvd?.visible, dataDemand: cvd ? panel.cvdData?.demandDiagnostics() : undefined,
        outputAvailable: cvd ? panel.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`)?.available : false } };
  }, panelId);
}

async function moveToPane(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator,
  rowSelector: string, targetPaneId: string) {
  await panel.locator(rowSelector).getByRole('button', { name: /Move/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await dialog.getByLabel('Move to pane').selectOption(targetPaneId);
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('CVD, Open Interest and Volume restore into one live managed pane without scratch panes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');

  await addIndicator(panel, 'Multi-Venue CVD');
  const cvdRow = () => panel.locator('.active-indicator[data-definition-id="native.multi-venue-cvd"]');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), instance = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    return current.outputRegistry.get(`output:${instance.instanceId}:cvdTotalBtc`)?.available;
  }, panelId)).toBe(true);
  await cvdRow().getByRole('button', { name: 'Add moving average to Multi-Venue CVD', exact: true }).click();
  const addSma = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addSma.getByLabel('Indicator output').selectOption({ index: 0 });
  await addSma.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();
  await addIndicator(panel, 'Open Interest');
  await expect(panel.locator('.active-indicator[data-definition-id="native.raw-open-interest"]')).toBeVisible();
  await addIndicator(panel, 'Volume');
  const volumeRow = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect(volumeRow).toBeVisible();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), volume = current.selection.indicators.find((item: any) => item.definitionId === 'script:builtin.volume-histogram');
    return volume ? current.studies.paneIndex(volume.instanceId) : -1;
  }, panelId)).toBeGreaterThanOrEqual(1);
  const before = await managedPaneState(page, panelId);
  expect(before.ids.cvd).toBeTruthy();
  expect(before.ids.openInterest).toBeTruthy();
  expect(before.ids.volume).toBeTruthy();
  expect(before.logicalPaneId).toBeFalsy();

  const targetPaneId = await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    return panel.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd')?.paneId;
  }, panelId);
  if (!targetPaneId) throw new Error('CVD managed pane ID is missing.');
  await moveToPane(page, panel, '.active-indicator[data-definition-id="native.raw-open-interest"]', targetPaneId);
  await moveToPane(page, panel, '.active-indicator[data-definition-id="script:builtin.volume-histogram"]', targetPaneId);

  const combined = await managedPaneState(page, panelId);
  expect(combined.logicalPaneId).toBe(targetPaneId);
  expect(combined.members).toEqual(expect.arrayContaining([combined.ids.cvd, combined.ids.openInterest, combined.ids.volume]));
  expect(new Set(Object.values(combined.actual)).size).toBe(1);
  expect(Object.values(combined.actual).every(index => index >= 1)).toBe(true);
  expect(combined.paneCount).toBe(2);
  expect(combined.panes.filter((pane: any) => pane.cvd || pane.openInterest)).toHaveLength(1);

  await cvdRow().getByRole('button', { name: 'Hide Multi-Venue CVD', exact: true }).click();
  await expect(panel.locator('[data-cvd="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).cvdData.demandDiagnostics(), panelId))
    .toMatchObject({ demanded: true, subscribed: true });
  await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id), paneIndex = panel.openInterestView.paneIndex();
    panel.engine.chart.setPaneWeight(paneIndex, .4);
    panel.engine.chart.setPaneCollapsed(paneIndex, true);
  }, panelId);
  await expect.poll(async () => (await managedPaneState(page, panelId)).geometry)
    .toMatchObject({ weight: .4, collapsed: true, savedWeight: .4, savedCollapsed: true });

  await page.reload();
  await expect(page.locator(`[data-panel-id="${panelId}"] .active-indicator[data-definition-id="native.multi-venue-cvd"] button[aria-label="Show Multi-Venue CVD"]`)).toBeVisible();
  await expect(page.locator(`[data-panel-id="${panelId}"] .active-indicator[data-definition-id="native.raw-open-interest"]`)).toBeVisible();
  await expect(page.locator(`[data-panel-id="${panelId}"] .active-indicator[data-definition-id="script:builtin.volume-histogram"]`)).toBeVisible();
  await expect.poll(async () => {
    const state = await managedPaneState(page, panelId);
    return state.actual.cvd === -1 && state.actual.sma >= 1 && state.actual.sma === state.actual.openInterest && state.actual.sma === state.actual.volume
      && state.paneCount === 2 && state.logicalPaneId === targetPaneId;
  }, { timeout: 30_000 }).toBe(true);
  const restored = await managedPaneState(page, panelId);
  expect(restored.members).toEqual(expect.arrayContaining([restored.ids.cvd, restored.ids.openInterest, restored.ids.volume]));
  expect(restored.actual).toEqual({ cvd: -1, openInterest: restored.actual.sma, volume: restored.actual.sma, sma: restored.actual.sma });
  expect(restored.cvd).toMatchObject({ visible: false, outputAvailable: true, dataDemand: { demanded: true, subscribed: true } });
  expect(restored.paneCount).toBe(2);
  expect(restored.panes.filter((pane: any) => pane.cvd || pane.openInterest)).toHaveLength(1);
  expect(restored.geometry).toMatchObject({ weight: .4, collapsed: true, savedWeight: .4, savedCollapsed: true, order: 1 });
  expect(restored.resolutions).toEqual(expect.arrayContaining([
    expect.objectContaining({ paneId: targetPaneId, exceptInstanceId: restored.ids.openInterest, paneIndex: -1, chartPaneCount: 1 }),
    expect.objectContaining({ paneId: targetPaneId, exceptInstanceId: restored.ids.volume, paneIndex: restored.actual.volume }),
    expect.objectContaining({ paneId: targetPaneId, exceptInstanceId: restored.ids.sma, paneIndex: restored.actual.sma }),
  ]));
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('native SMA self-links and downstream cycles leave the saved chain untouched', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);

  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add an indicator', exact: true });
  await picker.getByRole('button', { name: 'Add Volume', exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();

  const volume = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await volume.locator('button[data-indicator-action="add-sma"]').click();
  let dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const firstId = await page.evaluate(id => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.definitionId === 'native.composition-sma')?.instanceId, panelId);
  if (!firstId) throw new Error('First native SMA identity is missing.');

  const firstOutputId = await page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).outputRegistry
    .get(`output:${firstId}:p0`)?.outputId, { id: panelId, firstId });
  if (!firstOutputId) throw new Error('First SMA output is missing.');
  await panel.locator(`.active-indicator[data-instance-id="${firstId}"]`).locator('button[data-indicator-action="add-sma"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Indicator output').selectOption(firstOutputId);
  await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const secondId = await page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.definitionId === 'native.composition-sma'
      && item.numericInputs?.source?.instanceId === firstId)?.instanceId, { id: panelId, firstId });
  if (!secondId) throw new Error('Second native SMA identity is missing.');
  const secondOutputId = await page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).outputRegistry
    .get(`output:${secondId}:p0`)?.outputId, { id: panelId, secondId });
  if (!secondOutputId) throw new Error('Second SMA output is missing.');
  await expect.poll(() => page.evaluate(({ id, secondId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    return Boolean(panel.outputRegistry.get(`output:${secondId}:p0`)?.available
      && panel.outputRegistry.consumerIsCurrent(secondId));
  }, { id: panelId, secondId })).toBe(true);

  const secondRow = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${secondId}"]`);
  await secondRow.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === secondId)?.visible, { id: panelId, secondId })).toBe(false);
  const before = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    return { studies: panel.selection.indicators.filter((item: any) => item.definitionId === 'native.composition-sma')
      .map((item: any) => ({ id: item.instanceId, source: item.numericInputs?.source?.outputId,
        settings: item.settings, paneId: item.paneId, plotScaleIds: item.plotScaleIds, visible: item.visible })),
      firstOutput: { revision: panel.outputRegistry.get(`output:${firstId}:p0`)?.revision,
        available: panel.outputRegistry.get(`output:${firstId}:p0`)?.available } };
  }, { id: panelId, firstId });

  const editFirst = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${firstId}"]`);
  await editFirst.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Indicator output').selectOption(firstOutputId);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dialog-status')).toContainText('dependency cycle');
  const afterSelf = await page.evaluate(({ id }) => (window as any).__terminal.panels.get(id).selection.indicators
    .filter((item: any) => item.definitionId === 'native.composition-sma')
    .map((item: any) => ({ id: item.instanceId, source: item.numericInputs?.source?.outputId,
      settings: item.settings, paneId: item.paneId, plotScaleIds: item.plotScaleIds, visible: item.visible })), { id: panelId });
  expect(afterSelf).toEqual(before.studies);
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const output = (window as any).__terminal.panels.get(id).outputRegistry.get(`output:${firstId}:p0`);
    return { revision: output?.revision, available: output?.available };
  }, { id: panelId, firstId })).toEqual(before.firstOutput);

  // SMA2 is hidden, but its saved edge remains part of the graph: SMA1 -> SMA2
  // would close the existing SMA2 -> SMA1 cycle.
  await dialog.getByLabel('Indicator output').selectOption(secondOutputId);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dialog-status')).toContainText('dependency cycle');
  const afterDownstream = await page.evaluate(({ id, firstId, secondId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    return { studies: panel.selection.indicators.filter((item: any) => item.definitionId === 'native.composition-sma')
      .map((item: any) => ({ id: item.instanceId, source: item.numericInputs?.source?.outputId,
        settings: item.settings, paneId: item.paneId, plotScaleIds: item.plotScaleIds, visible: item.visible })),
      consumer: panel.selection.indicators.find((item: any) => item.instanceId === secondId)?.numericInputs?.source?.instanceId,
      firstId };
  }, { id: panelId, firstId, secondId });
  expect(afterDownstream.studies).toEqual(before.studies);
  expect(afterDownstream.consumer).toBe(firstId);
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const output = (window as any).__terminal.panels.get(id).outputRegistry.get(`output:${firstId}:p0`);
    return { revision: output?.revision, available: output?.available };
  }, { id: panelId, firstId })).toEqual(before.firstOutput);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

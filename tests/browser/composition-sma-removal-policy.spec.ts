import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('native SMA engine removal is blocked by visible and hidden saved dependents', async ({ page }) => {
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
  const rows = panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  const firstRow = rows.nth(0), firstId = await firstRow.getAttribute('data-instance-id');
  if (!firstId) throw new Error('First native SMA identity is missing.');

  await firstRow.locator('button[data-indicator-action="add-sma"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const firstOutputId = await page.evaluate(({ id, firstId }) =>
    (window as any).__terminal.panels.get(id).outputRegistry.get(`output:${firstId}:p0`)?.outputId, { id: panelId, firstId });
  await dialog.getByLabel('Indicator output').selectOption(firstOutputId);
  await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const secondId = await page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.definitionId === 'native.composition-sma'
      && item.numericInputs?.source?.instanceId === firstId)?.instanceId, { id: panelId, firstId });
  if (!secondId) throw new Error('Second native SMA identity is missing.');
  const secondRow = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${secondId}"]`);
  await expect.poll(() => page.evaluate(({ id, firstId, secondId }) => {
    const panel = (window as any).__terminal.panels.get(id), output = panel.outputRegistry.get(`output:${firstId}:p0`);
    return Boolean(output?.available && panel.outputRegistry.consumerIsCurrent(secondId));
  }, { id: panelId, firstId, secondId })).toBe(true);

  // Recreating a provider API while the chain is already saved must carry the
  // same removal protection as its first attachment.
  const recreatedPolicy = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    const instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    panel.removeCompositionApi(firstId);
    return panel.syncCompositionSma(instance)?.policy();
  }, { id: panelId, firstId });
  expect(recreatedPolicy).toMatchObject({ removable: false });
  await expect.poll(() => page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).outputRegistry.consumerIsCurrent(secondId),
    { id: panelId, secondId })).toBe(true);

  const visibleRefusal = await page.evaluate(({ id, firstId, secondId }) => {
    const panel = (window as any).__terminal.panels.get(id), api = panel.compositionApis.get(firstId);
    const engineId = api.id, output = panel.outputRegistry.get(`output:${firstId}:p0`);
    const removed = api.remove();
    return { removed, sameApi: panel.compositionApis.get(firstId) === api,
      inChart: panel.engine.chart.indicators().some((item: any) => item.id === engineId),
      stillSelected: panel.selection.indicators.some((item: any) => item.instanceId === firstId),
      outputRevision: panel.outputRegistry.get(`output:${firstId}:p0`)?.revision,
      outputAvailable: panel.outputRegistry.get(`output:${firstId}:p0`)?.available,
      consumerCurrent: panel.outputRegistry.consumerIsCurrent(secondId), dependentRef: panel.selection.indicators
        .find((item: any) => item.instanceId === secondId)?.numericInputs?.source?.outputId,
      firstOutputId: output?.outputId, policy: api.policy() };
  }, { id: panelId, firstId, secondId });
  expect(visibleRefusal).toMatchObject({ removed: false, sameApi: true, inChart: true, stillSelected: true,
    outputAvailable: true, consumerCurrent: true, firstOutputId, policy: { removable: false } });

  await secondRow.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === secondId)?.visible, { id: panelId, secondId })).toBe(false);
  const hiddenRefusal = await page.evaluate(({ id, firstId, secondId }) => {
    const panel = (window as any).__terminal.panels.get(id), api = panel.compositionApis.get(firstId);
    const revision = panel.outputRegistry.get(`output:${firstId}:p0`)?.revision;
    return { removed: api.remove(), sameApi: panel.compositionApis.get(firstId) === api,
      outputRevision: panel.outputRegistry.get(`output:${firstId}:p0`)?.revision,
      consumerSaved: panel.selection.indicators.some((item: any) => item.instanceId === secondId
        && item.numericInputs?.source?.instanceId === firstId), policy: api.policy(), revision };
  }, { id: panelId, firstId, secondId });
  expect(hiddenRefusal).toMatchObject({ removed: false, sameApi: true, consumerSaved: true,
    outputRevision: hiddenRefusal.revision, policy: { removable: false } });

  await secondRow.locator('button[data-indicator-action="remove"]').click();
  await expect(rows).toHaveCount(1);
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const api = (window as any).__terminal.panels.get(id).compositionApis.get(firstId);
    return api ? api.policy().removable !== false : undefined;
  }, { id: panelId, firstId })).toBe(true);
  const allowedRemoval = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), api = panel.compositionApis.get(firstId);
    const engineId = api.id, policy = api.policy(), removed = api.remove();
    return { removed, policy, stillSelected: panel.selection.indicators.some((item: any) => item.instanceId === firstId),
      inChart: panel.engine.chart.indicators().some((item: any) => item.id === engineId) };
  }, { id: panelId, firstId });
  expect(allowedRemoval).toMatchObject({ removed: true, policy: {}, inChart: false });
});

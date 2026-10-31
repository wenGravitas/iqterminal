import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function addVolumeAndFirstSma(page: import('@playwright/test').Page) {
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
  const add = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await add.getByLabel('Indicator output').selectOption({ index: 0 });
  await add.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const firstId = await page.evaluate(id => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.definitionId === 'native.composition-sma')?.instanceId, panelId);
  if (!firstId) throw new Error('First native SMA identity is missing.');
  const source = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    const output = panel.studies.views().find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0];
    const instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    const ref = (value: any) => ({ kind: value.kind, version: value.version, instanceId: value.instanceId, outputId: value.outputId,
      plotKey: value.plotKey, schemaId: value.schemaId, domain: value.domain, contextId: value.contextId, unit: value.unit });
    return { volumeId: output?.instanceId, output: output?.outputId, sourceRef: ref(instance.numericInputs.source),
      paneId: instance.paneId, placement: instance.placement, scaleIds: instance.plotScaleIds };
  }, { id: panelId, firstId });
  if (!source.output) throw new Error('Volume numeric output is missing.');
  return { panel, panelId, firstId, source };
}

test('same-ID stale references stay unavailable until explicit selection and Apply rejects ref drift', async ({ page }) => {
  test.setTimeout(60_000);
  const { panel, panelId, firstId, source } = await addVolumeAndFirstSma(page);
  const staleContext = { ...source.sourceRef, contextId: `${source.sourceRef.contextId}:restored-stale` };
  await page.evaluate(({ id, firstId, staleRef }) => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.selection = { ...panel.selection, indicators: panel.selection.indicators.map((item: any) => item.instanceId === firstId
      ? { ...item, numericInputs: { ...item.numericInputs, source: staleRef } } : item) };
    panel.params.api.updateParameters(panel.selection); panel.save();
  }, { id: panelId, firstId, staleRef: staleContext });
  await page.waitForTimeout(300);
  let savedBefore = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  const row = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${firstId}"]`);
  await row.locator('button[data-indicator-action="settings"]').click();
  let dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  let output = dialog.getByLabel('Indicator output');
  let selected = await output.locator('option:checked').evaluate(option => ({ value: (option as HTMLOptionElement).value,
    disabled: (option as HTMLOptionElement).disabled }));
  expect(selected.disabled).toBe(true);
  expect(selected.value).not.toBe(source.output);
  expect(await output.locator('option').evaluateAll((options, outputId) => options.some(option =>
    (option as HTMLOptionElement).value === outputId && !(option as HTMLOptionElement).disabled), source.output)).toBe(true);
  await dialog.getByLabel('Length').fill('21');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="status"]')).toContainText(/saved output is unavailable/i);
  let state = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { ref: instance.numericInputs.source, settings: instance.settings, stored: localStorage.getItem('basis.layout.v1') };
  }, { id: panelId, firstId });
  expect(state.ref).toEqual(staleContext);
  expect(state.settings.length).toBe(20);
  expect(state.stored).toBe(savedBefore);

  await output.selectOption(source.output);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  let rebound = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    const output = panel.studies.views().find((view: any) => view.attachmentId === instance.numericInputs.source.instanceId)?.numericOutputs
      .find((item: any) => item.outputId === instance.numericInputs.source.outputId);
    const ref = (value: any) => ({ kind: value.kind, version: value.version, instanceId: value.instanceId, outputId: value.outputId,
      plotKey: value.plotKey, schemaId: value.schemaId, domain: value.domain, contextId: value.contextId, unit: value.unit });
    return { id: instance.instanceId, ref: ref(instance.numericInputs.source), output: ref(output), settings: instance.settings,
      paneId: instance.paneId, placement: instance.placement };
  }, { id: panelId, firstId });
  expect(rebound).toMatchObject({ id: firstId, ref: rebound.output, settings: { length: 21 }, paneId: source.paneId, placement: source.placement });

  const staleSchema = { ...rebound.ref, unit: null, schemaId: 'number:chart-candles-v1:p0:unknown:1' };
  await page.evaluate(({ id, firstId, staleRef }) => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.selection = { ...panel.selection, indicators: panel.selection.indicators.map((item: any) => item.instanceId === firstId
      ? { ...item, numericInputs: { ...item.numericInputs, source: staleRef } } : item) };
    panel.params.api.updateParameters(panel.selection); panel.save();
  }, { id: panelId, firstId, staleRef: staleSchema });
  await page.waitForTimeout(300);
  savedBefore = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await row.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  output = dialog.getByLabel('Indicator output');
  selected = await output.locator('option:checked').evaluate(option => ({ value: (option as HTMLOptionElement).value,
    disabled: (option as HTMLOptionElement).disabled }));
  expect(selected.disabled).toBe(true);
  expect(selected.value).not.toBe(source.output);
  await dialog.getByLabel('Length').fill('22');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="status"]')).toContainText(/saved output is unavailable/i);
  state = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { ref: instance.numericInputs.source, settings: instance.settings, stored: localStorage.getItem('basis.layout.v1') };
  }, { id: panelId, firstId });
  expect(state.ref).toEqual(staleSchema);
  expect(state.settings.length).toBe(21);
  expect(state.stored).toBe(savedBefore);
  await output.selectOption(source.output);
  await expect(dialog.getByLabel('Use the selected output scale')).toBeVisible();
  await dialog.getByLabel('Use the selected output scale').check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  const schemaRebound = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { id: instance.instanceId, ref: instance.numericInputs.source, settings: instance.settings };
  }, { id: panelId, firstId });
  expect(schemaRebound).toMatchObject({ id: firstId, ref: expect.objectContaining({ outputId: source.output, unit: source.sourceRef.unit }), settings: { length: 22 } });

  await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.selection = { ...panel.selection, indicators: panel.selection.indicators.map((item: any) => {
      if (item.instanceId !== firstId) return item;
      const { numericInputs, ...withoutInput } = item;
      return withoutInput;
    }) };
    panel.params.api.updateParameters(panel.selection); panel.save();
  }, { id: panelId, firstId });
  await page.waitForTimeout(300);
  savedBefore = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await row.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  output = dialog.getByLabel('Indicator output');
  const absentSelected = await output.locator('option:checked').evaluate(option => ({ value: (option as HTMLOptionElement).value,
    disabled: (option as HTMLOptionElement).disabled, label: option.textContent }));
  expect(absentSelected).toMatchObject({ value: '__missing_saved_numeric_input__', disabled: true });
  expect(absentSelected.label).toContain('Missing saved input');
  await dialog.getByLabel('Length').fill('23');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  const absentBeforeRebind = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { hasInputs: Boolean(instance.numericInputs), settings: instance.settings, stored: localStorage.getItem('basis.layout.v1') };
  }, { id: panelId, firstId });
  expect(absentBeforeRebind).toEqual({ hasInputs: false, settings: { length: 22, color: expect.any(String) }, stored: savedBefore });
  await output.selectOption(source.output);
  await dialog.getByLabel('Use the selected output scale').check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();

  await row.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Length').fill('23');
  await page.evaluate(({ id, outputId }) => {
    const panel = (window as any).__terminal.panels.get(id), original = panel.compositionControls.resolveLatest;
    panel.compositionControls.resolveLatest = (selectedId: string) => {
      const choice = original?.(selectedId);
      return selectedId === outputId && choice
        ? { ...choice, output: { ...choice.output, contextId: `${choice.output.contextId}:apply-time-drift` } }
        : choice;
    };
  }, { id: panelId, outputId: source.output });
  const driftBefore = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { ref: instance.numericInputs.source, settings: instance.settings, stored: localStorage.getItem('basis.layout.v1') };
  }, { id: panelId, firstId });
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="status"]')).toContainText(/changed while these settings were open/i);
  const driftAfter = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), instance = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { ref: instance.numericInputs.source, settings: instance.settings, stored: localStorage.getItem('basis.layout.v1') };
  }, { id: panelId, firstId });
  expect(driftAfter).toEqual(driftBefore);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('a missing SMA input blocks unsafe dependent replacement then recovers with the same placement', async ({ page }) => {
  test.setTimeout(60_000);
  const { panel, panelId, firstId, source } = await addVolumeAndFirstSma(page);
  await panel.locator(`.active-indicator[data-instance-id="${firstId}"]`).locator('button[data-indicator-action="add-sma"]').click();
  let dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const firstOutputId = await page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).outputRegistry
    .get(`output:${firstId}:p0`)?.outputId, { id: panelId, firstId });
  await dialog.getByLabel('Indicator output').selectOption(firstOutputId);
  await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const secondId = await page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.definitionId === 'native.composition-sma' && item.numericInputs?.source?.instanceId === firstId)?.instanceId,
    { id: panelId, firstId });
  if (!secondId) throw new Error('Downstream SMA identity is missing.');
  const secondRow = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${secondId}"]`);
  await secondRow.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === secondId)?.visible, { id: panelId, secondId })).toBe(false);

  const missingRef = { ...source.sourceRef, instanceId: 'missing-output-producer', outputId: 'output:missing-output-producer:p0',
    contextId: `${source.sourceRef.contextId}:missing-input` };
  const missingState = await page.evaluate(({ id, firstId, secondId, missingRef }) => {
    const panel = (window as any).__terminal.panels.get(id);
    panel.removeCompositionApi(secondId); panel.releaseCompositionSmaBinding(secondId);
    panel.removeCompositionApi(firstId); panel.releaseCompositionSmaBinding(firstId);
    const firstReleased = panel.outputRegistry.releaseOwner(firstId);
    const secondReleased = panel.outputRegistry.releaseOwner(secondId);
    panel.selection = { ...panel.selection, indicators: panel.selection.indicators.map((item: any) => item.instanceId === firstId
      ? { ...item, numericInputs: { ...item.numericInputs, source: missingRef } } : item) };
    panel.params.api.updateParameters(panel.selection); panel.save();
    return { firstReleased, secondReleased, firstOutput: panel.outputRegistry.get(`output:${firstId}:p0`),
      api: panel.compositionApis.get(firstId), consumerRefs: panel.selection.indicators
        .filter((item: any) => item.instanceId === secondId).map((item: any) => item.numericInputs?.source) };
  }, { id: panelId, firstId, secondId, missingRef });
  expect(missingState.firstReleased).toBe(true);
  expect(missingState.secondReleased).toBe(true);
  expect(missingState.firstOutput).toBeUndefined();
  expect(missingState.api).toBeUndefined();
  expect(missingState.consumerRefs).toEqual([expect.objectContaining({ instanceId: firstId, outputId: `output:${firstId}:p0` })]);

  await page.waitForTimeout(300);
  const firstRow = panel.locator(`.active-indicator[data-definition-id="native.composition-sma"][data-instance-id="${firstId}"]`);
  await firstRow.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const sourceSelect = dialog.getByLabel('Indicator output');
  const unavailable = await sourceSelect.locator('option:checked').evaluate(option => ({ value: (option as HTMLOptionElement).value,
    disabled: (option as HTMLOptionElement).disabled }));
  expect(unavailable).toEqual({ value: missingRef.outputId, disabled: true });
  await sourceSelect.selectOption(source.output);
  const savedBefore = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await dialog.getByLabel('Length').fill('24');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="status"]')).toContainText(/saved studies depend on its missing output/i);
  const blocked = await page.evaluate(({ id, firstId, missingRef }) => {
    const panel = (window as any).__terminal.panels.get(id), first = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { ref: first.numericInputs.source, settings: first.settings, stored: localStorage.getItem('basis.layout.v1'),
      output: panel.outputRegistry.get(`output:${firstId}:p0`) };
  }, { id: panelId, firstId, missingRef });
  expect(blocked).toMatchObject({ ref: missingRef, settings: { length: 20 }, stored: savedBefore });
  expect(blocked.output).toBeUndefined();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await secondRow.locator('button[data-indicator-action="remove"]').click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toHaveCount(1);
  await firstRow.locator('button[data-indicator-action="settings"]').click();
  dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Indicator output').selectOption(source.output);
  await dialog.getByLabel('Length').fill('24');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), output = panel.outputRegistry.get(`output:${firstId}:p0`);
    return Boolean(output?.available && panel.outputRegistry.consumerIsCurrent(firstId));
  }, { id: panelId, firstId })).toBe(true);
  const recovered = await page.evaluate(({ id, firstId }) => {
    const panel = (window as any).__terminal.panels.get(id), first = panel.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { id: first.instanceId, source: first.numericInputs.source, settings: first.settings, paneId: first.paneId,
      placement: first.placement, plotScaleIds: first.plotScaleIds };
  }, { id: panelId, firstId });
  expect(recovered).toMatchObject({ id: firstId, source: expect.objectContaining({ outputId: source.output }),
    settings: { length: 24 }, paneId: source.paneId, placement: source.placement, plotScaleIds: source.scaleIds });
});

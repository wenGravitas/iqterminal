import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('native SMA output chains through the chart registry without an engine source binding', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');

  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const picker = panel.getByRole('dialog', { name: 'Add an indicator', exact: true });
  await picker.getByRole('button', { name: 'Add Volume', exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  const volume = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect(volume).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const emaPicker = page.getByRole('dialog', { name: 'Add an indicator', exact: true });
  await emaPicker.locator('[data-add-script="builtin.ema-overlay"]').click();
  await emaPicker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((item: any) => item.scriptId === 'builtin.ema-overlay')?.attachmentId, panelId)).toBeTruthy();
  const unknownProvider = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const view = current.studies.views().find((item: any) => item.scriptId === 'builtin.ema-overlay');
    return { attachmentId: view?.attachmentId };
  }, panelId);
  expect(unknownProvider.attachmentId).toBeTruthy();
  await expect.poll(() => page.evaluate(({ id, attachmentId }) => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.attachmentId === attachmentId), { id: panelId, attachmentId: unknownProvider.attachmentId }))
    .toMatchObject({ movable: false, numericOutputs: [expect.objectContaining({ available: true, unit: null, composable: true })] });
  await expect(panel.locator(`.active-indicator[data-instance-id="${unknownProvider.attachmentId}"] button[data-indicator-action="move"]`)).toHaveCount(0);

  await volume.locator('button[data-indicator-action="add-sma"]').click();
  const firstDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await firstDialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await firstDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const firstRowInitial = panel.locator('.active-indicator[data-definition-id="native.composition-sma"]').first();
  await expect(firstRowInitial).toBeVisible();
  const firstId = await firstRowInitial.getAttribute('data-instance-id');
  const firstRow = panel.locator(`.active-indicator[data-instance-id="${firstId}"]`);
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return Boolean(current.outputRegistry.get(`output:${firstId}:p0`)?.available
      && current.compositionApis.get(firstId)?.settings().managedOutputToken);
  }, { id: panelId, firstId })).toBe(true);

  await firstRow.locator('button[data-indicator-action="add-sma"]').click();
  const secondDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const options = await secondDialog.getByLabel('Indicator output').locator('option').allTextContents();
  expect(options.some(option => option.includes('SMA 20 · Volume'))).toBe(true);
  const secondOutputId = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.outputRegistry.get(`output:${current.series.indicators.find((item: any) => item.definitionId === 'native.composition-sma')?.instanceId}:p0`)?.outputId;
  }, panelId);
  await secondDialog.getByLabel('Indicator output').selectOption(secondOutputId);
  await secondDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const secondRowInitial = panel.locator('.active-indicator[data-definition-id="native.composition-sma"]').nth(1);
  await expect(secondRowInitial).toBeVisible();
  const secondId = await secondRowInitial.getAttribute('data-instance-id');
  const secondRow = panel.locator(`.active-indicator[data-instance-id="${secondId}"]`);
  await expect.poll(() => page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.outputRegistry.get(`output:${firstId}:p0`);
    const second = current.outputRegistry.get(`output:${secondId}:p0`);
    const consumer = current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === secondId);
    return Boolean(first?.available && second?.available && consumer?.current);
  }, { id: panelId, firstId, secondId })).toBe(true);

  const chain = await page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.outputRegistry.get(`output:${firstId}:p0`);
    const second = current.outputRegistry.get(`output:${secondId}:p0`);
    const bars = current.candles;
    const volume = bars.map((bar: any) => bar.v);
    const firstExpected = volume.map((_: number, index: number) => index < 19 ? null : volume.slice(index - 19, index + 1).reduce((a: number, b: number) => a + b, 0) / 20);
    const secondExpected = firstExpected.map((_: number | null, index: number) => index < 19 || firstExpected.slice(index - 19, index + 1).some((value: number | null) => value === null)
      ? null : firstExpected.slice(index - 19, index + 1).reduce((a: number, b: number | null) => a + (b ?? 0), 0) / 20);
    return { first: first.values, firstExpected, second: second.values, secondExpected,
      persistedSettings: current.selection.indicators.filter((item: any) => item.definitionId === 'native.composition-sma').map((item: any) => item.settings) };
  }, { id: panelId, firstId, secondId });
  expect(chain.first).toEqual(chain.firstExpected);
  expect(chain.second).toHaveLength(chain.secondExpected.length);
  chain.secondExpected.forEach((expected: number | null, index: number) => {
    if (expected === null) expect(chain.second[index]).toBeNull();
    else expect(chain.second[index]).toBeCloseTo(expected, 12);
  });
  expect(chain.persistedSettings.every((settings: any) => !('managedOutputToken' in settings) && !('source' in settings))).toBe(true);

  const beforeHiddenProvider = await page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return { firstRevision: current.outputRegistry.get(`output:${firstId}:p0`)?.revision,
      secondRevision: current.outputRegistry.get(`output:${secondId}:p0`)?.revision };
  }, { id: panelId, firstId, secondId });
  await firstRow.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === firstId)?.visible, { id: panelId, firstId })).toBe(false);
  await expect.poll(() => page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).outputRegistry.diagnostics()
    .consumers.find((item: any) => item.instanceId === firstId)?.active, { id: panelId, firstId })).toBe(true);
  const visibilityBeforeRebind = await page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    const firstVisible = current.compositionApis.get(firstId)?.visible();
    const secondVisible = current.compositionApis.get(secondId)?.visible();
    current.outputRegistry.unregisterConsumer(firstId);
    current.outputRegistry.unregisterConsumer(secondId);
    return { firstVisible, secondVisible };
  }, { id: panelId, firstId, secondId });
  expect(visibilityBeforeRebind).toEqual({ firstVisible: false, secondVisible: true });
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await expect.poll(() => page.evaluate(({ id, firstId, secondId, firstRevision, secondRevision }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.outputRegistry.get(`output:${firstId}:p0`);
    const second = current.outputRegistry.get(`output:${secondId}:p0`);
    const consumers = current.outputRegistry.diagnostics().consumers;
    return Boolean(first && second && first.revision > firstRevision && second.revision > secondRevision
      && consumers.find((item: any) => item.instanceId === firstId)?.current
      && consumers.find((item: any) => item.instanceId === secondId)?.current);
  }, { id: panelId, firstId, secondId, ...beforeHiddenProvider }), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  const hiddenProviderUpdate = await page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.outputRegistry.get(`output:${firstId}:p0`);
    const second = current.outputRegistry.get(`output:${secondId}:p0`);
    const firstInstance = current.selection.indicators.find((item: any) => item.instanceId === firstId);
    const source = current.outputRegistry.get(firstInstance.numericInputs.source.outputId);
    const sourceWindow = source.values.slice(-20);
    const firstWindow = first.values.slice(-20);
    return { first: first.values.at(-1), firstExpected: sourceWindow.length === 20 && sourceWindow.every(Number.isFinite)
      ? sourceWindow.reduce((sum: number, value: number) => sum + value, 0) / 20 : null,
      second: second.values.at(-1), secondExpected: firstWindow.length === 20 && firstWindow.every(Number.isFinite)
        ? firstWindow.reduce((sum: number, value: number) => sum + value, 0) / 20 : null,
      firstConsumer: current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === firstId),
      secondConsumer: current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === secondId) };
  }, { id: panelId, firstId, secondId });
  expect(hiddenProviderUpdate.firstExpected).not.toBeNull();
  expect(hiddenProviderUpdate.secondExpected).not.toBeNull();
  expect(hiddenProviderUpdate.first).toBeCloseTo(hiddenProviderUpdate.firstExpected as number, 12);
  expect(hiddenProviderUpdate.second).toBeCloseTo(hiddenProviderUpdate.secondExpected as number, 12);
  expect(hiddenProviderUpdate.firstConsumer).toMatchObject({ active: true, current: true });
  expect(hiddenProviderUpdate.secondConsumer).toMatchObject({ active: true, current: true });
  expect(await page.evaluate(({ id, firstId, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return { firstVisible: current.compositionApis.get(firstId)?.visible(), secondVisible: current.compositionApis.get(secondId)?.visible() };
  }, { id: panelId, firstId, secondId })).toEqual({ firstVisible: false, secondVisible: true });
  await firstRow.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, firstId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === firstId)?.visible, { id: panelId, firstId })).toBe(true);

  // The built-in price EMA has an unknown unit. Replacing the BTC volume input
  // with it must be rejected while SMA 2 depends on SMA 1, both active and
  // after the hidden SMA's chart attachment is gone.
  const replacement = await page.evaluate(({ id, firstId, attachmentId }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.selection.indicators.find((item: any) => item.instanceId === firstId);
    const ema = current.studies.views().find((item: any) => item.attachmentId === attachmentId);
    const output = ema?.numericOutputs.find((item: any) => item.available);
    return { outputId: output?.outputId, unit: output?.unit, firstRef: { ...first.numericInputs.source } };
  }, { id: panelId, firstId, attachmentId: unknownProvider.attachmentId });
  expect(replacement.outputId).toBeTruthy();
  expect(replacement.unit).toBeNull();

  const firstSettings = firstRow.locator('button[data-indicator-action="settings"]');
  await firstSettings.click();
  let edit = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await edit.getByLabel('Indicator output').selectOption(replacement.outputId!);
  await expect(edit.getByLabel('Use the selected output scale')).toBeVisible();
  await edit.getByLabel('Use the selected output scale').check();
  const savedBeforeVisibleReject = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await edit.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(edit).toBeVisible();
  await expect(edit.locator('[role="status"]')).toContainText(/cannot change unit.*depend/i);
  const visibleReject = await page.evaluate(({ id, firstId, secondId, savedBefore }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.selection.indicators.find((item: any) => item.instanceId === firstId);
    const consumer = current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === secondId);
    return { source: first.numericInputs.source, stored: localStorage.getItem('basis.layout.v1'), storageUnchanged: localStorage.getItem('basis.layout.v1') === savedBefore,
      output: current.outputRegistry.get(`output:${firstId}:p0`), consumer };
  }, { id: panelId, firstId, secondId, savedBefore: savedBeforeVisibleReject });
  expect(visibleReject.source).toEqual(replacement.firstRef);
  expect(visibleReject.storageUnchanged).toBe(true);
  expect(visibleReject.output).toMatchObject({ unit: 'BTC', revision: expect.any(Number), available: true });
  expect(visibleReject.consumer).toMatchObject({ instanceId: secondId, active: true });
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();

  const secondById = panel.locator(`.active-indicator[data-instance-id="${secondId}"]`);
  await secondById.locator('button[data-indicator-action="visibility"]').click();
  await expect.poll(() => page.evaluate(({ id, secondId }) => (window as any).__terminal.panels.get(id).selection.indicators
    .find((item: any) => item.instanceId === secondId)?.visible, { id: panelId, secondId })).toBe(false);
  const detachedHidden = await page.evaluate(({ id, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    current.removeCompositionApi(secondId);
    return { saved: current.selection.indicators.find((item: any) => item.instanceId === secondId)?.numericInputs?.source,
      registered: current.outputRegistry.diagnostics().consumers.some((item: any) => item.instanceId === secondId) };
  }, { id: panelId, secondId });
  const secondSavedRef = await page.evaluate(({ id, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return current.selection.indicators.find((item: any) => item.instanceId === secondId)?.numericInputs?.source;
  }, { id: panelId, secondId });
  expect(detachedHidden.saved).toEqual(secondSavedRef);
  expect(secondSavedRef).toMatchObject({ instanceId: firstId, outputId: `output:${firstId}:p0`, unit: 'BTC' });
  expect(detachedHidden.registered).toBe(false);
  // The normal Dockview layout save is debounced by 250 ms after a visibility
  // change. Take the persistence baseline after that independent edit settles.
  await page.waitForTimeout(300);
  const savedBeforeHiddenReject = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  const hiddenApply = await page.evaluate(({ id, firstId, secondId, savedBefore }) => {
    const current = (window as any).__terminal.panels.get(id);
    const second = current.selection.indicators.find((item: any) => item.instanceId === secondId);
    const first = current.selection.indicators.find((item: any) => item.instanceId === firstId);
    return { firstRef: first.numericInputs.source, secondRef: second.numericInputs.source,
      output: current.outputRegistry.get(`output:${firstId}:p0`), outputRevision: current.outputRegistry.get(`output:${firstId}:p0`)?.revision,
      registered: current.outputRegistry.diagnostics().consumers.some((item: any) => item.instanceId === secondId),
      storageUnchanged: localStorage.getItem('basis.layout.v1') === savedBefore };
  }, { id: panelId, firstId, secondId, savedBefore: savedBeforeHiddenReject });
  expect(hiddenApply).toMatchObject({ firstRef: replacement.firstRef, secondRef: secondSavedRef, registered: false, storageUnchanged: true,
    output: { unit: 'BTC', available: true } });
  await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const original = current.outputRegistry.preflightReplacement.bind(current.outputRegistry);
    current.__r2Preflight = null;
    const save = current.save.bind(current);
    current.__r2SaveCalls = 0;
    current.save = () => { current.__r2SaveCalls++; save(); };
    current.outputRegistry.preflightReplacement = (output: any, consumers: any[]) => {
      current.__r2Preflight = { unit: output.unit, outputId: output.outputId,
        consumers: consumers.map(({ title, ref }) => ({ title, ref })) };
      return original(output, consumers);
    };
  }, panelId);
  await firstSettings.click();
  edit = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await edit.getByLabel('Indicator output').selectOption(replacement.outputId!);
  await edit.getByLabel('Use the selected output scale').check();
  await edit.getByRole('button', { name: 'Apply', exact: true }).click();
  const hiddenPreflight = await page.evaluate(id => (window as any).__terminal.panels.get(id).__r2Preflight, panelId);
  expect(hiddenPreflight).toMatchObject({ unit: null, outputId: `output:${firstId}:p0` });
  expect(hiddenPreflight.consumers).toEqual(expect.arrayContaining([
    expect.objectContaining({ ref: expect.objectContaining({ instanceId: firstId, outputId: `output:${firstId}:p0`, unit: 'BTC' }) }),
  ]));
  await expect(edit).toBeVisible();
  await expect(edit.locator('[role="status"]')).toContainText(/cannot change schema, unit or chart context.*depend/i);
  const hiddenReject = await page.evaluate(({ id, firstId, secondId, savedBefore }) => {
    const current = (window as any).__terminal.panels.get(id);
    const first = current.selection.indicators.find((item: any) => item.instanceId === firstId);
    const second = current.selection.indicators.find((item: any) => item.instanceId === secondId);
    return { source: first.numericInputs.source, storageUnchanged: localStorage.getItem('basis.layout.v1') === savedBefore,
      saveCalls: current.__r2SaveCalls, output: current.outputRegistry.get(`output:${firstId}:p0`), outputRevision: current.outputRegistry.get(`output:${firstId}:p0`)?.revision,
      consumer: current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === secondId),
      secondInput: second.numericInputs.source };
  }, { id: panelId, firstId, secondId, savedBefore: savedBeforeHiddenReject });
  expect(hiddenReject.source).toEqual(replacement.firstRef);
  expect(hiddenReject.storageUnchanged).toBe(true);
  expect(hiddenReject.saveCalls).toBe(0);
  expect(hiddenReject.outputRevision).toBe(hiddenApply.outputRevision);
  expect(hiddenReject.output).toMatchObject({ unit: 'BTC', available: true });
  expect(hiddenReject.consumer).toBeUndefined();
  expect(hiddenReject.secondInput).toEqual(secondSavedRef);
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();

  await secondRow.locator('button[data-indicator-action="remove"]').click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(({ id, secondId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return current.outputRegistry.get(`output:${secondId}:p0`) === undefined
      && !current.outputRegistry.diagnostics().consumers.some((item: any) => item.instanceId === secondId);
  }, { id: panelId, secondId })).toBe(true);
  await firstRow.locator('button[data-indicator-action="remove"]').click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(({ id, firstId }) => {
    const current = (window as any).__terminal.panels.get(id);
    return current.outputRegistry.get(`output:${firstId}:p0`) === undefined
      && current.outputRegistry.diagnostics().consumers.length === 0;
  }, { id: panelId, firstId })).toBe(true);
  await page.evaluate(({ id, attachmentId }) => (window as any).__terminal.panels.get(id).studies.remove(attachmentId),
    { id: panelId, attachmentId: unknownProvider.attachmentId });
});

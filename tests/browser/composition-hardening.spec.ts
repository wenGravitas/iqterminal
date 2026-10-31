import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function compositionState(page: import('@playwright/test').Page, panelId: string) {
  return page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    const volume = panel.studies.views().find((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = panel.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    const plot = panel.series.composition.plots.find((item: any) => item.producerInstanceId === sma?.instanceId && item.outputKey === 'p0');
    const api = sma && panel.compositionApis.get(sma.instanceId);
    return { volumeId: volume?.attachmentId, output: volume?.numericOutputs[0], smaId: sma?.instanceId,
      ref: sma?.numericInputs?.source, paneId: sma?.paneId, placement: sma?.placement,
      settings: sma?.settings, scaleId: sma?.plotScaleIds?.p0, plotPaneId: plot?.paneId,
      plotScaleId: plot && panel.series.composition.scales.find((scale: any) => scale.scaleId === plot.scaleId)?.engineScaleId,
      band: panel.series.composition.embeddedBands.find((item: any) => item.memberIds.includes(sma?.instanceId)),
      valueCount: api?.values().p0?.length };
  }, panelId);
}

test('editing a moved SMA preserves its output and pane; an unavailable saved source stays open on Apply', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  let panel = page.locator('.candle-panel').first();
  let panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');

  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const picker = panel.getByRole('dialog', { name: 'Add an indicator', exact: true });
  await picker.getByRole('button', { name: 'Add Volume', exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  const volumeRow = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await volumeRow.getByRole('button', { name: 'Add moving average to Volume', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addDialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await addDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();

  let state = await compositionState(page, panelId);
  let savedRef = state.ref;
  const savedScale = state.scaleId;
  const smaRow = () => panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await smaRow().getByRole('button', { name: /^Move SMA 20 · Volume$/ }).click();
  let move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption('@new');
  await expect(move.getByLabel('Move all studies in this pane together')).not.toBeChecked();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    return panel.series.indicators.find((item: any) => item.definitionId === 'native.composition-sma')?.paneId;
  }, panelId)).not.toBe(state.paneId);
  state = await compositionState(page, panelId);
  expect(state.ref).toEqual(savedRef);
  expect(state.scaleId).toBe(savedScale);

  await addIndicator(panel, 'Multi-Venue CVD');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), cvd = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    return current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`)?.available;
  }, panelId)).toBe(true);
  const cvdOutput = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), cvd = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const output = current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`);
    const scaleId = current.compositionOutputChoices().find((choice: any) => choice.output.outputId === output.outputId)?.output.scaleId;
    return { instanceId: cvd.instanceId, outputId: output.outputId, unit: output.unit, scaleId, available: output.available };
  }, panelId);
  expect(cvdOutput).toMatchObject({ unit: 'BTC' });

  await smaRow().getByRole('button', { name: 'SMA 20 · Volume settings', exact: true }).click();
  const inputDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await inputDialog.getByLabel('Indicator output').selectOption(cvdOutput.outputId);
  const selectedScale = inputDialog.getByLabel('Use the selected output scale');
  await expect(selectedScale).toBeVisible();
  await expect(selectedScale).not.toBeChecked();
  await inputDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  state = await compositionState(page, panelId);
  expect(state.ref.outputId).toBe(cvdOutput.outputId);
  expect(state.paneId).toBeTruthy();
  expect(state.paneId).not.toBe('@price');
  expect(state.placement).toBe('pane');
  expect(state.plotPaneId).toBe(state.paneId);
  expect(state.scaleId).toBe(savedScale);
  savedRef = state.ref;
  const preservedPane = state.paneId;

  await smaRow().getByRole('button', { name: 'SMA 20 · Multi-Venue CVD settings', exact: true }).click();
  const scaleDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const useCvdScale = scaleDialog.getByLabel('Use the selected output scale');
  await expect(useCvdScale).toBeVisible();
  await expect(useCvdScale).not.toBeChecked();
  await useCvdScale.check();
  await scaleDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  state = await compositionState(page, panelId);
  expect(state.ref).toEqual(savedRef);
  expect(state.paneId).toBe(preservedPane);
  expect(state.scaleId).toBe(cvdOutput.scaleId);

  await smaRow().getByRole('button', { name: 'SMA 20 · Multi-Venue CVD settings', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await editDialog.getByLabel('Length').fill('12');
  await editDialog.getByLabel('Line colour').fill('#e05454');
  await editDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => compositionState(page, panelId!)).toMatchObject({ ref: savedRef, settings: { length: 12, color: '#e05454' } });
  state = await compositionState(page, panelId);
  expect(state.paneId).toBeTruthy();
  expect(state.paneId).not.toBe('@price');
  expect(state.plotPaneId).toBe(state.paneId);
  expect(state.scaleId).toBe(cvdOutput.scaleId);

  await smaRow().getByRole('button', { name: 'Move SMA 12 · Multi-Venue CVD', exact: true }).click();
  move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption('@price');
  const together = move.getByLabel('Move all studies in this pane together');
  if (await together.isChecked()) await together.uncheck();
  const height = move.getByLabel('Embedded band height');
  await height.evaluate(element => { (element as HTMLInputElement).value = '30'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => compositionState(page, panelId!)).toMatchObject({ ref: savedRef, placement: 'overlay', band: { heightPercent: 30 } });
  state = await compositionState(page, panelId);
  expect(state.plotPaneId).toBe('@price');
  expect(state.scaleId).toBe(cvdOutput.scaleId);

  await page.reload();
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  panel = page.locator('.candle-panel').first();
  panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Restored fixture chart panel ID is missing.');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await expect.poll(() => compositionState(page, panelId)).toMatchObject({ ref: savedRef, placement: 'overlay', settings: { length: 12, color: '#e05454' }, band: { heightPercent: 30 } });

  const restored = await compositionState(page, panelId);
  await panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')
    .getByRole('button', { name: 'SMA 12 · Multi-Venue CVD settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add moving average', exact: true })).toBeVisible();
  const applyResult = await page.evaluate(({ id, sourceInstanceId }) => {
    // Simulate a producer withdrawal between opening settings and pressing Apply.
    const current = (window as any).__terminal.panels.get(id);
    current.outputRegistry.markUnavailable(sourceInstanceId, 'Synthetic unavailable-output race fixture.');
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Add moving average"]');
    const form = dialog?.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { open: Boolean(dialog?.open), message: dialog?.querySelector('[role="status"]')?.textContent ?? '',
      sourceAvailable: current.outputRegistry.outputsForOwner(sourceInstanceId).some((output: any) => output.available) };
  }, { id: panelId, sourceInstanceId: restored.ref.instanceId });
  expect(applyResult.open).toBe(true);
  expect(applyResult.sourceAvailable).toBe(false);
  expect(applyResult.message).toMatch(/unavailable/i);
  expect(restored.ref).toEqual(savedRef);
  await expect.poll(() => compositionState(page, panelId!)).toMatchObject({ ref: savedRef, settings: { length: 12, color: '#e05454' } });
});

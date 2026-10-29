import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ storageState: { cookies: [], origins: [] } });

async function readState(page: import('@playwright/test').Page, panelId: string, keepHandles = false) {
  return page.evaluate(({ panelId, keepHandles }) => {
    const panel = (window as any).__terminal.panels.get(panelId);
    const source = panel.studies.views().find((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sourceInstance = panel.series.indicators.find((instance: any) => instance.instanceId === source?.attachmentId);
    const smaInstance = panel.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    const sourceRuntime = source && panel.studies.studies.get(source.attachmentId);
    const sourceApi = source && panel.studies.apiForAttachment(source.attachmentId);
    const smaApi = smaInstance && panel.compositionApis.get(smaInstance.instanceId);
    const sourcePlot = source?.numericOutputs.find((output: any) => output.plotKey === 'p0');
    const sourceSeries = sourceApi?.series('p0');
    const smaSeries = smaApi?.series('p0');
    const chart = panel.engine.chart;
    const primaryScale = chart.panes()[chart.primaryPaneIndex()]?.priceScale;
    const primaryRange = primaryScale?.priceRange();
    const scale = sourceSeries?.priceScale();
    const embeddedBand = panel.series.composition.embeddedBands?.find((item: any) => item.memberIds.includes(source?.attachmentId));
    const sourcePane = sourceApi && chart.panes()[sourceApi.paneIndex];
    const sourcePaneRect = sourcePane?.element.getBoundingClientRect();
    const smaValues = smaApi?.values().p0 ?? [];
    const sourceValues = sourcePlot?.values ?? [];
    const sourceMaximum = sourceValues.reduce((maximum: number, value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(maximum, value) : maximum, 0);
    const expectedWindow = sourceValues.slice(-20);
    const expectedLast = expectedWindow.length === 20 && expectedWindow.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
      ? expectedWindow.reduce((sum: number, value: number) => sum + value, 0) / 20 : null;
    if (keepHandles && sourceRuntime && sourceApi && smaApi) {
      (window as any).__compositionRelease1Handles = { worker: sourceRuntime.worker, sourceApi, smaApi, bridge: sourceRuntime.bridge };
    }
    const originalHandles = (window as any).__compositionRelease1Handles;
    return {
      fixture: (window as any).__terminal.fixture,
      candles: panel.engine.barCount,
      latestCandle: panel.candles.at(-1) && { t: panel.candles.at(-1).t, c: panel.candles.at(-1).c, v: panel.candles.at(-1).v },
      source: source && {
        id: source.attachmentId, visible: source.visible, status: source.status,
        output: { available: sourcePlot.available, instanceId: sourcePlot.instanceId, outputId: sourcePlot.outputId,
          plotKey: sourcePlot.plotKey, unit: sourcePlot.unit, contextId: sourcePlot.contextId, scaleId: sourcePlot.scaleId,
          timesLength: sourcePlot.times.length, valuesLength: sourceValues.length, last: sourceValues.at(-1), revision: sourcePlot.revision },
        paneId: sourceInstance?.paneId, placement: sourceInstance?.placement,
        runtime: sourceRuntime && { workerAlive: sourceRuntime.worker.alive, generation: sourceRuntime.worker.currentGeneration,
          resultRevision: sourceRuntime.resultRevision, needsHistory: sourceRuntime.needsHistory, timesLength: sourceRuntime.result?.times?.length,
          values: sourceRuntime.result?.values?.p0?.slice(-22) },
        apiId: sourceApi?.id, apiPane: sourceApi?.paneIndex, apiScaleId: sourceApi?.plotPriceScaleId('p0'),
        fixedRange: scale?.fixedRange, scaleMargins: scale && { top: scale.options.marginTop, bottom: scale.options.marginBottom },
        expectedFixedMaximum: scale ? Math.max(1, sourceMaximum * 1.05) / Math.max(.08, 1 - scale.options.marginTop - scale.options.marginBottom) : null,
        maximumValue: sourceMaximum, scaleHeight: scale?.height, maximumY: scale?.priceToY(sourceMaximum),
        coordinates: scale && {
          scaleHeight: scale.height, zeroY: scale.priceToY(0), maximumY: scale.priceToY(sourceMaximum),
          bandHeightPercent: embeddedBand?.heightPercent ?? null,
          bandTopY: embeddedBand ? scale.height * (1 - embeddedBand.heightPercent / 100) : null,
          paneTop: sourcePaneRect?.top ?? null, paneHeight: sourcePaneRect?.height ?? null,
        },
      },
      sma: smaInstance && {
        id: smaInstance.instanceId, paneId: smaInstance.paneId, placement: smaInstance.placement,
        input: smaInstance.numericInputs?.source, settings: smaInstance.settings,
        apiPane: smaApi?.paneIndex, apiScaleId: smaApi?.plotPriceScaleId('p0'),
        seriesScaleId: smaSeries?.priceScaleId, valuesLength: smaValues.length, firstValues: smaValues.slice(0, 21),
        last: smaValues.at(-1), expectedLast, resultRevision: sourceRuntime?.resultRevision,
      },
      composition: panel.series.composition,
      primary: { autoScale: primaryScale?.autoScale, min: primaryRange?.min, max: primaryRange?.max },
      viewport: panel.engine.visibleRange(),
      handlesRetained: Boolean(originalHandles && sourceRuntime && sourceApi && smaApi
        && originalHandles.worker === sourceRuntime.worker && originalHandles.sourceApi === sourceApi
        && originalHandles.smaApi === smaApi && originalHandles.bridge === sourceRuntime.bridge),
      paneCount: chart.panes().length,
    };
  }, { panelId, keepHandles });
}

function assertEmbeddedBandCoordinates(state: any, heightPercent: number) {
  const coordinates = state.source?.coordinates;
  expect(coordinates, 'volume scale coordinates should be available').toBeTruthy();
  expect(coordinates.bandHeightPercent).toBe(heightPercent);
  expect(coordinates.scaleHeight).toBeGreaterThan(0);
  const height = coordinates.scaleHeight as number;
  const zeroY = coordinates.zeroY as number;
  const maximumY = coordinates.maximumY as number;
  const bandTopY = coordinates.bandTopY as number;
  const requestedBandHeight = height * heightPercent / 100;
  const renderedBarHeight = zeroY - maximumY;
  // The declared 0 baseline belongs at the bottom; the volume maximum must
  // stay inside the selected bottom band with a little headroom above it.
  expect(zeroY).toBeGreaterThanOrEqual(height - 1);
  expect(zeroY).toBeLessThanOrEqual(height + 1);
  expect(maximumY).toBeGreaterThanOrEqual(bandTopY - 1);
  expect(maximumY).toBeLessThanOrEqual(zeroY + 1);
  expect(renderedBarHeight).toBeGreaterThan(requestedBandHeight * 0.7);
  expect(renderedBarHeight).toBeLessThanOrEqual(requestedBandHeight + 1);
}

function bandCoordinateCapture(name: string, viewport: { width: number; height: number }, state: any) {
  const coordinates = state.source.coordinates;
  return {
    name, viewport, bandHeightPercent: coordinates.bandHeightPercent,
    paneTop: coordinates.paneTop, paneHeight: coordinates.paneHeight,
    scaleHeight: coordinates.scaleHeight, zeroY: coordinates.zeroY, maximumY: coordinates.maximumY,
    bandTopY: coordinates.bandTopY, renderedBarHeight: coordinates.zeroY - coordinates.maximumY,
  };
}

async function movePair(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, rowName: string, target: string, height?: number) {
  await panel.getByRole('button', { name: `Move ${rowName}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await dialog.getByLabel('Move to pane').selectOption(target);
  await dialog.getByLabel('Move all studies in this pane together').check();
  if (height !== undefined) {
    const control = dialog.getByLabel('Embedded band height');
    await expect(control).toBeVisible();
    await control.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, height);
    await expect(dialog.locator('output')).toHaveText(`${height}%`);
  }
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
}

test('duplicating a composed provider creates a new identity and keeps the consumer bound to its original output', async ({ page }) => {
  test.setTimeout(90_000);
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
  const volumeRows = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect(volumeRows.first()).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await volumeRows.first().getByRole('button', { name: 'Add moving average to Volume', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addDialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await addDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();

  const before = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const providers = current.studies.views().filter((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = current.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    return { providers: providers.map((view: any) => ({ id: view.attachmentId, outputId: view.numericOutputs[0]?.outputId })), input: sma?.numericInputs?.source };
  }, panelId);
  expect(before.providers).toHaveLength(1);
  const originalProviderId = before.providers[0]!.id;
  const originalInput = before.input;
  await volumeRows.first().getByRole('button', { name: 'Duplicate Volume', exact: true }).click();

  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .filter((view: any) => view.scriptId === 'builtin.volume-histogram').length, panelId)).toBe(2);
  const duplicated = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const providers = current.studies.views().filter((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = current.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    return { providers: providers.map((view: any) => ({ id: view.attachmentId, outputId: view.numericOutputs[0]?.outputId, available: view.numericOutputs[0]?.available })),
      input: sma?.numericInputs?.source, composition: current.series.composition };
  }, panelId);
  expect(new Set(duplicated.providers.map((item: any) => item.id)).size).toBe(2);
  expect(new Set(duplicated.providers.map((item: any) => item.outputId)).size).toBe(2);
  expect(duplicated.providers.every((item: any) => item.available)).toBe(true);
  expect(duplicated.input).toEqual(originalInput);
  const group = duplicated.composition.panes.find((pane: any) => pane.memberIds.includes(originalProviderId));
  expect(group?.memberIds).toContain(duplicated.providers.find((item: any) => item.id !== originalProviderId)?.id);
  expect(group?.memberIds).toContain(duplicated.input.instanceId);

  await expect.poll(() => page.evaluate(id => {
    const stored = JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null');
    const params = stored?.layout?.panels?.[id]?.params;
    return { providers: params?.indicators?.filter((item: any) => item.definitionId === 'script:builtin.volume-histogram').length,
      smaInput: params?.indicators?.find((item: any) => item.definitionId === 'native.composition-sma')?.numericInputs?.source };
  }, panelId)).toEqual({ providers: 2, smaInput: originalInput });

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await expect.poll(async () => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const providers = current.studies.views().filter((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = current.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    return providers.filter((view: any) => view.numericOutputs[0]?.available).length === 2
      && current.compositionApis.has(sma?.instanceId);
  }, panelId), { timeout: 30_000 }).toBe(true);
  const restored = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const providers = current.studies.views().filter((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = current.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    return { ids: providers.map((view: any) => view.attachmentId), outputIds: providers.map((view: any) => view.numericOutputs[0]?.outputId), input: sma?.numericInputs?.source };
  }, panelId);
  expect(new Set(restored.ids).size).toBe(2);
  expect(new Set(restored.outputIds).size).toBe(2);
  expect(restored.input).toEqual(originalInput);
});

test('Volume output SMA composes, moves, persists a bounded band and releases cleanly', async ({ page }) => {
  test.setTimeout(120_000);
  const bandCoordinates: ReturnType<typeof bandCoordinateCapture>[] = [];
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.setItem('basis.theme.v1', 'dark'));
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
  const volumeRow = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect(volumeRow).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);

  await volumeRow.click({ button: 'right' });
  const addDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await expect(addDialog).toBeVisible();
  await expect(addDialog.getByText('Input', { exact: true })).toBeVisible();
  await expect(addDialog.getByText('Calculation', { exact: true })).toBeVisible();
  await expect(addDialog.getByText('Display', { exact: true })).toBeVisible();
  await addDialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await addDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const smaRow = panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await expect(smaRow).toBeVisible();
  await expect(smaRow).toContainText('SMA 20 · Volume');
  await expect.poll(() => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    const source = panel.studies.views().find((view: any) => view.scriptId === 'builtin.volume-histogram');
    const sma = panel.series.indicators.find((instance: any) => instance.definitionId === 'native.composition-sma');
    return Boolean(source?.numericOutputs[0]?.available && sma && panel.compositionApis.has(sma.instanceId));
  }, panelId)).toBe(true);

  const lower = await readState(page, panelId, true);
  expect(lower.fixture).toBe(true);
  expect(lower.source).toMatchObject({ visible: true, placement: 'pane', runtime: { workerAlive: true, timesLength: 5000 }, output: { available: true, unit: 'BTC', timesLength: 5000, valuesLength: 5000 } });
  expect(lower.sma).toMatchObject({ placement: 'pane', settings: { length: 20 }, valuesLength: 5000 });
  expect(lower.sma.input).toMatchObject({ kind: 'indicator-output', instanceId: lower.source!.id,
    outputId: `output:${lower.source!.id}:p0`, plotKey: 'p0', unit: 'BTC', contextId: lower.source!.output.contextId, scaleId: lower.source!.output.scaleId });
  expect(lower.source!.apiScaleId).toBe(lower.source!.output.scaleId);
  expect(lower.sma!.apiScaleId).toBe(lower.source!.output.scaleId);
  const lowerProviderPlot = lower.composition.plots.find((plot: any) => plot.producerInstanceId === lower.source!.id && plot.outputKey === 'p0');
  const lowerSmaPlot = lower.composition.plots.find((plot: any) => plot.producerInstanceId === lower.sma!.id && plot.outputKey === 'p0');
  expect(lower.composition.plots).toHaveLength(2);
  expect(lowerProviderPlot.scaleId).toBe(lowerSmaPlot.scaleId);
  expect(lowerProviderPlot).toMatchObject({ plotId: `plot:output:${lower.source!.id}:p0`, paneId: lower.source!.paneId, visible: true });
  expect(lowerSmaPlot).toMatchObject({ plotId: `plot:output:${lower.sma!.id}:p0`, paneId: lower.sma!.paneId, visible: true });
  const logicalScaleId = lowerProviderPlot.scaleId;
  expect(lower.composition.scales).toMatchObject([{ scaleId: logicalScaleId, engineScaleId: lower.source!.output.scaleId,
    unit: 'BTC', policy: 'zero-based', bandMemberships: [] }]);
  expect(lower.source!.fixedRange.min).toBe(0);
  expect(lower.source!.fixedRange.max).toBeGreaterThan(lower.source!.output.last);
  expect(lower.source!.fixedRange.max).toBeCloseTo(lower.source!.expectedFixedMaximum, 6);
  expect(lower.source!.maximumY / lower.source!.scaleHeight).toBeGreaterThan(0.15);
  expect(lower.source!.maximumY / lower.source!.scaleHeight).toBeLessThan(0.3);
  expect(lower.sma!.firstValues.slice(0, 19)).toEqual(Array(19).fill(null));
  expect(lower.sma!.last).toBeCloseTo(lower.sma!.expectedLast, 8);

  await page.screenshot({ path: 'artifacts/composition-volume-sma-lower-1366x768.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => panel.locator('.chart-stage').evaluate(element => element.clientWidth)).toBeGreaterThan(300);
  await page.screenshot({ path: 'artifacts/composition-volume-sma-lower-720x860.png' });
  await page.setViewportSize({ width: 1366, height: 768 });

  await volumeRow.getByRole('button', { name: 'Hide Volume', exact: true }).click();
  await expect.poll(() => readState(page, panelId)).toMatchObject({ source: { visible: false, runtime: { workerAlive: true }, output: { available: true, valuesLength: 5000 } }, sma: { last: lower.sma!.last } });
  await volumeRow.getByRole('button', { name: 'Show Volume', exact: true }).click();

  const beforeMove = await readState(page, panelId);
  await movePair(page, panel, 'SMA 20 · Volume', '@price', 30);
  await expect.poll(() => readState(page, panelId)).toMatchObject({
    source: { placement: 'overlay', paneId: '@price', scaleMargins: { top: 0.7, bottom: 0.02 } },
    sma: { placement: 'overlay', paneId: '@price' },
    composition: { embeddedBands: [{ heightPercent: 30 }] },
    handlesRetained: true,
  });
  const embedded30 = await readState(page, panelId);
  assertEmbeddedBandCoordinates(embedded30, 30);
  expect(embedded30.source!.runtime).toMatchObject({ resultRevision: beforeMove.source!.runtime.resultRevision, generation: beforeMove.source!.runtime.generation });
  expect(embedded30.source!.runtime.values).toEqual(beforeMove.source!.runtime.values);
  expect(embedded30.sma!.input).toEqual(beforeMove.sma!.input);
  expect(embedded30.sma!.firstValues).toEqual(beforeMove.sma!.firstValues);
  expect(embedded30.primary).toEqual(beforeMove.primary);
  expect(embedded30.viewport).toEqual(beforeMove.viewport);
  expect(embedded30.source!.apiPane).toBe(embedded30.sma!.apiPane);
  expect(embedded30.source!.apiScaleId).toBe(embedded30.sma!.apiScaleId);
  expect(embedded30.composition.plots.map((plot: any) => plot.scaleId)).toEqual([logicalScaleId, logicalScaleId]);
  expect(embedded30.composition.plots.map((plot: any) => plot.paneId)).toEqual(['@price', '@price']);
  expect(embedded30.composition.scales).toMatchObject([{ scaleId: logicalScaleId, policy: 'zero-based',
    bandMemberships: [{ paneId: '@price', bandId: embedded30.composition.embeddedBands[0].id }] }]);
  expect(embedded30.source!.fixedRange.max).toBeCloseTo(embedded30.source!.expectedFixedMaximum, 6);
  expect(embedded30.source!.maximumY / embedded30.source!.scaleHeight).toBeGreaterThan(0.7);
  expect(embedded30.source!.maximumY / embedded30.source!.scaleHeight).toBeLessThan(0.8);

  await page.screenshot({ path: 'artifacts/composition-volume-sma-embedded-1366x768.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => panel.locator('.chart-stage').evaluate(element => element.clientWidth)).toBeGreaterThan(300);
  const embedded30Narrow = await readState(page, panelId);
  assertEmbeddedBandCoordinates(embedded30Narrow, 30);
  bandCoordinates.push(
    bandCoordinateCapture('embedded-1366x768', { width: 1366, height: 768 }, embedded30),
    bandCoordinateCapture('embedded-720x860', { width: 720, height: 860 }, embedded30Narrow),
  );
  await page.screenshot({ path: 'artifacts/composition-volume-sma-embedded-720x860.png' });
  await page.setViewportSize({ width: 1366, height: 768 });

  // Reopen on the existing main-pane band so changing its bounded height is a direct edit.
  await panel.getByRole('button', { name: 'Move SMA 20 · Volume', exact: true }).click();
  const editBand = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await expect(editBand.getByLabel('Move to pane')).toHaveValue('@price');
  await expect(editBand.getByLabel('Embedded band height')).toHaveValue('30');
  await editBand.getByLabel('Move all studies in this pane together').check();
  const existingHeight = editBand.getByLabel('Embedded band height');
  await existingHeight.evaluate(element => {
    const input = element as HTMLInputElement; input.value = '25'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(existingHeight).toHaveValue('25');
  await expect(editBand.locator('output')).toHaveText('25%');
  await editBand.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => readState(page, panelId)).toMatchObject({ composition: { embeddedBands: [{ heightPercent: 25 }] }, source: { scaleMargins: { top: 0.75, bottom: 0.02 } } });

  await expect.poll(() => page.evaluate(id => {
    const stored = JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null');
    const params = stored?.layout?.panels?.[id]?.params;
    return params?.composition?.embeddedBands?.[0]?.heightPercent;
  }, panelId)).toBe(25);
  const savedBeforeReload = await page.evaluate(id => {
    const stored = JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null');
    const params = stored?.layout?.panels?.[id]?.params;
    return { indicators: params?.indicators, composition: params?.composition };
  }, panelId);
  expect(savedBeforeReload.composition.embeddedBands[0].heightPercent).toBe(25);
  const providerId = lower.source!.id, smaId = lower.sma!.id, inputRef = lower.sma!.input;
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await expect.poll(async () => {
    const state = await readState(page, panelId);
    return Boolean(state.source?.output.available && state.sma?.input && state.sma?.valuesLength === 5000);
  }, { timeout: 30_000 }).toBe(true);
  const restored = await readState(page, panelId);
  expect(restored.composition.embeddedBands).toMatchObject([{ memberIds: [providerId, smaId], heightPercent: 25 }]);
  expect(restored.source).toMatchObject({ id: providerId, paneId: '@price', output: { available: true, valuesLength: 5000 } });
  expect(restored.sma).toMatchObject({ id: smaId, paneId: '@price', input: inputRef, placement: 'overlay', valuesLength: 5000 });
  expect(restored.composition.plots.map((plot: any) => plot.scaleId)).toEqual([logicalScaleId, logicalScaleId]);
  expect(restored.composition.scales).toMatchObject([{ scaleId: logicalScaleId, policy: 'zero-based',
    bandMemberships: [{ paneId: '@price' }] }]);
  expect(restored.source!.apiScaleId).toBe(restored.sma!.apiScaleId);
  expect(restored.source!.scaleMargins).toEqual({ top: 0.75, bottom: 0.02 });

  const restoredPanel = page.locator(`.candle-panel[data-panel-id="${panelId}"]`);
  await movePair(page, restoredPanel, 'SMA 20 · Volume', '@new');
  const lowerAgain = await readState(page, panelId);
  expect(lowerAgain.handlesRetained).toBe(false); // reload intentionally creates fresh runtime handles
  expect(lowerAgain.source).toMatchObject({ id: providerId, placement: 'pane', runtime: { workerAlive: true, timesLength: 5000 }, output: { available: true } });
  expect(lowerAgain.sma).toMatchObject({ id: smaId, placement: 'pane', input: inputRef, valuesLength: 5000 });
  expect(lowerAgain.source!.apiScaleId).toBe(lowerAgain.sma!.apiScaleId);
  expect(lowerAgain.composition.panes).toHaveLength(1);
  const endpointBaseline = lowerAgain.primary;
  await movePair(page, restoredPanel, 'SMA 20 · Volume', '@price', 10);
  const minimumBand = await readState(page, panelId);
  assertEmbeddedBandCoordinates(minimumBand, 10);
  bandCoordinates.push(bandCoordinateCapture('embedded-minimum-10-percent', { width: 1366, height: 768 }, minimumBand));
  expect(minimumBand.source!.scaleMargins).toEqual({ top: 0.9, bottom: 0.02 });
  expect(minimumBand.source!.maximumY / minimumBand.source!.scaleHeight).toBeGreaterThan(0.91);
  expect(minimumBand.source!.maximumY / minimumBand.source!.scaleHeight).toBeLessThan(0.94);
  expect(minimumBand.primary).toEqual(endpointBaseline);
  await movePair(page, restoredPanel, 'SMA 20 · Volume', '@price', 40);
  const maximumBand = await readState(page, panelId);
  assertEmbeddedBandCoordinates(maximumBand, 40);
  bandCoordinates.push(bandCoordinateCapture('embedded-maximum-40-percent', { width: 1366, height: 768 }, maximumBand));
  expect(maximumBand.source!.scaleMargins).toEqual({ top: 0.6, bottom: 0.02 });
  expect(maximumBand.source!.maximumY / maximumBand.source!.scaleHeight).toBeGreaterThan(0.62);
  expect(maximumBand.source!.maximumY / maximumBand.source!.scaleHeight).toBeLessThan(0.67);
  expect(maximumBand.primary).toEqual(endpointBaseline);
  expect(maximumBand.source!.fixedRange.max).toBeCloseTo(maximumBand.source!.expectedFixedMaximum, 6);

  // Simulate the visible chart's script host sleeping while the visible native
  // SMA still depends on a visually hidden Volume producer. The forming candle
  // advances while asleep; waking must replay the provider before its consumer.
  await restoredPanel.getByRole('button', { name: 'Hide Volume', exact: true }).click();
  await expect.poll(async () => (await readState(page, panelId)).source?.visible).toBe(false);
  const beforeSleep = await readState(page, panelId);
  await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    current.studies.setVisible(false);
    (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 });
  }, panelId);
  await expect.poll(async () => {
    const state = await readState(page, panelId);
    return Boolean(state.latestCandle && beforeSleep.latestCandle
      && state.latestCandle.t === beforeSleep.latestCandle.t
      && (state.latestCandle.c !== beforeSleep.latestCandle.c || state.latestCandle.v !== beforeSleep.latestCandle.v));
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await readState(page, panelId)).source?.runtime?.needsHistory, { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  const asleep = await readState(page, panelId);
  expect(asleep.source!.runtime.resultRevision).toBe(beforeSleep.source!.runtime.resultRevision);
  expect(asleep.source!.runtime.values).toEqual(beforeSleep.source!.runtime.values);
  expect(asleep.sma!.last).toBe(beforeSleep.sma!.last);
  await page.evaluate(id => (window as any).__terminal.panels.get(id).studies.setVisible(true), panelId);
  await expect.poll(async () => {
    const state = await readState(page, panelId);
    return Boolean(state.source!.runtime.resultRevision > beforeSleep.source!.runtime.resultRevision
      && !state.source!.runtime.needsHistory && state.sma!.last !== beforeSleep.sma!.last);
  }, { timeout: 30_000 }).toBe(true);
  const caughtUp = await readState(page, panelId);
  expect(caughtUp.source!.runtime.workerAlive).toBe(true);
  expect(caughtUp.source!.runtime.values).not.toEqual(beforeSleep.source!.runtime.values);
  expect(caughtUp.sma!.last).toBeCloseTo(caughtUp.sma!.expectedLast, 8);

  const outlierBaseline = await readState(page, panelId);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await expect.poll(async () => {
    const state = await readState(page, panelId);
    return Boolean(state.source!.maximumValue > outlierBaseline.source!.maximumValue * 2
      && state.source!.fixedRange.max > outlierBaseline.source!.fixedRange.max * 2
      && state.source!.fixedRange.max <= state.source!.expectedFixedMaximum + 1e-8);
  }, { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  const outlierUpdate = await readState(page, panelId);
  expect(outlierUpdate.source!.runtime.workerAlive).toBe(true);
  expect(outlierUpdate.source!.apiScaleId).toBe(outlierUpdate.sma!.apiScaleId);
  expect(outlierUpdate.source!.fixedRange.min).toBe(0);
  await movePair(page, restoredPanel, 'SMA 20 · Volume', '@new');
  const returned = await readState(page, panelId);
  expect(returned.source!.id).toBe(providerId);
  expect(returned.sma!.input).toEqual(inputRef);
  expect(returned.composition.embeddedBands).toEqual([]);

  await expect(restoredPanel.getByRole('button', { name: 'Remove Volume', exact: true })).toBeDisabled();
  await expect(restoredPanel.getByRole('button', { name: 'Remove Volume', exact: true })).toHaveAttribute('title', /depends on its output/);
  await restoredPanel.getByRole('button', { name: 'Remove SMA 20 · Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .filter((view: any) => view.scriptId === 'builtin.volume-histogram').length, panelId)).toBe(1);
  await restoredPanel.getByRole('button', { name: 'Remove Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    return { attached: panel.studies.diagnostics().attached, workers: panel.studies.diagnostics().workers, panes: panel.engine.chart.panes().length };
  }, panelId)).toEqual({ attached: 0, workers: 0, panes: 1 });
  await writeFile('artifacts/composition-band-coordinates.json', `${JSON.stringify({ source: 'explicit development fixture', runs: bandCoordinates }, null, 2)}\n`);
});

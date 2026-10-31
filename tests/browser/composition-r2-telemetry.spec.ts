import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('managed Volume → SMA update workload keeps data and UI work separately visible', async ({ page }) => {
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
  const volume = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.views()
    .find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available, panelId)).toBe(true);
  await volume.getByRole('button', { name: 'Add moving average to Volume', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await dialog.getByLabel('Indicator output').selectOption({ index: 0 });
  await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).compositionApis.size, panelId)).toBe(1);

  await page.evaluate(() => (window as any).__terminal.resetMetrics());
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await page.waitForTimeout(2_500);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(id => {
    const terminal = (window as any).__terminal;
    const panel = terminal.panels.get(id);
    return { panel: panel.diagnostics().compositionWork, studies: panel.studies.diagnostics().compositionWork,
      feedProtocol: terminal.stats().feedProtocol, feed: terminal.feed.diagnostics };
  }, panelId);
  if (process.env.R2_METRICS_PATH) await writeFile(process.env.R2_METRICS_PATH, JSON.stringify(metrics, null, 2));
  if (process.env.R2_BASELINE !== '1') {
    expect(metrics.studies.dataNotifications).toBeGreaterThan(0);
    expect(metrics.panel.indicatorReconciles).toBe(0);
    expect(metrics.panel.objectRefreshes).toBe(0);
    expect(metrics.panel.scriptObjectProviderSyncs).toBe(0);
    expect(metrics.studies.workers.some((worker: any) => worker.patchMessagesSent > 0)).toBe(true);
    expect(metrics.panel.sma.tailCalls).toBeGreaterThan(0);
  }
});

test('two managed Volume → SMA charts share one candle cache and clean up independently', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);

  const attachVolumeSma = async (panel: import('@playwright/test').Locator) => {
    await addIndicator(panel, 'Volume');
    const volume = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
    await volume.getByRole('button', { name: 'Add moving average to Volume', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
    await dialog.getByLabel('Indicator output').selectOption({ index: 0 });
    await dialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
    await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();
    return { volume, sma: panel.locator('.active-indicator[data-definition-id="native.composition-sma"]') };
  };

  const firstPanel = page.locator('.candle-panel').first();
  const firstPanelId = await firstPanel.getAttribute('data-panel-id');
  if (!firstPanelId) throw new Error('First fixture chart panel ID is missing.');
  const first = await attachVolumeSma(firstPanel);

  await page.getByRole('button', { name: 'Add chart', exact: true }).click();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  const secondPanel = page.locator('.candle-panel').nth(1);
  const secondPanelId = await secondPanel.getAttribute('data-panel-id');
  if (!secondPanelId) throw new Error('Second fixture chart panel ID is missing.');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id)?.diagnostics().bars, secondPanelId)).toBe(5000);
  const second = await attachVolumeSma(secondPanel);

  const links = await page.evaluate(() => [...(window as any).__terminal.panels.values()].map((panel: any) => {
    const sma = panel.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const source = sma && panel.studies.views().find((view: any) => view.attachmentId === sma.numericInputs.source.instanceId)
      ?.numericOutputs.find((output: any) => output.outputId === sma.numericInputs.source.outputId);
    return { id: panel.params.api.id, smaId: sma?.instanceId, sourceId: source?.instanceId,
      sourceAvailable: source?.available, revision: panel.outputRegistry.get(`output:${sma?.instanceId}:p0`)?.revision };
  }));
  expect(links).toHaveLength(2);
  expect(links.every((link: any) => link.sourceAvailable && link.sourceId !== link.smaId)).toBe(true);
  expect(new Set(links.map((link: any) => link.sourceId)).size).toBe(2);

  await page.evaluate(() => (window as any).__terminal.resetMetrics());
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await page.waitForTimeout(2_500);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = (window as any).__terminal.feed.diagnostics;
    return { series: diagnostics.series, clients: diagnostics.caches?.[0]?.clients };
  })).toMatchObject({ series: 1, clients: 2 });

  const metrics = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    return { panels: [...terminal.panels.values()].map((panel: any) => ({ id: panel.params.api.id,
      panel: panel.diagnostics().compositionWork, studies: panel.studies.diagnostics().compositionWork,
      workers: panel.studies.diagnostics().workers })),
      feedProtocol: terminal.stats().feedProtocol, feed: terminal.feed.diagnostics };
  });
  expect(metrics.panels).toHaveLength(2);
  expect(metrics.panels.every((entry: any) => entry.studies.dataNotifications > 0
    && entry.panel.indicatorReconciles === 0 && entry.panel.objectRefreshes === 0
    && entry.panel.scriptObjectProviderSyncs === 0 && entry.panel.sma.fullCalls === 0
    && entry.panel.sma.tailCalls > 0 && entry.studies.workers.some((worker: any) => worker.patchMessagesSent > 0))).toBe(true);
  expect(metrics.feedProtocol.subscriptions.candles).toBe(2);
  expect(metrics.feed).toMatchObject({ series: 1, subscriptions: 2, caches: [expect.objectContaining({ clients: 2 })] });

  await first.volume.getByRole('button', { name: 'Hide Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id), sma = panel.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    return { sourceVisible: panel.selection.indicators.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram')?.visible,
      consumerCurrent: panel.outputRegistry.consumerIsCurrent(sma.instanceId) };
  }, firstPanelId)).toEqual({ sourceVisible: false, consumerCurrent: true });
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.diagnostics().workers, firstPanelId)).toBe(1);
  const hiddenWorker = await page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().compositionWork.workers[0];
  }, firstPanelId);
  await first.sma.getByRole('button', { name: 'Remove SMA 20 · Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().workers === 1 && host.diagnostics().compositionWork.workers[0]?.alive;
  }, firstPanelId)).toBe(true);
  const beforePause = await page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().compositionWork.workers[0]?.patchCalls;
  }, firstPanelId);
  const secondBeforePause = await page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().compositionWork.workers[0]?.patchCalls;
  }, secondPanelId);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 0 }));
  const afterPause = await page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().compositionWork.workers[0]?.patchCalls;
  }, firstPanelId);
  const secondAfterPause = await page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return host.diagnostics().compositionWork.workers[0]?.patchCalls;
  }, secondPanelId);
  expect(afterPause).toBe(beforePause);
  expect(secondAfterPause).toBeGreaterThan(secondBeforePause!);
  expect(hiddenWorker.alive).toBe(true);
  await first.volume.getByRole('button', { name: 'Remove Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const host = (window as any).__terminal.panels.get(id).studies;
    return { attached: host.diagnostics().attached, workers: host.diagnostics().workers };
  }, firstPanelId)).toEqual({ attached: 0, workers: 0 });
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).studies.diagnostics().workers, secondPanelId)).toBe(1);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.caches?.[0]?.clients)).toBe(2);

  await second.sma.getByRole('button', { name: 'Remove SMA 20 · Volume', exact: true }).click();
  await second.volume.getByRole('button', { name: 'Remove Volume', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    return { attached: panel.studies.diagnostics().attached,
      workers: panel.studies.diagnostics().workers };
  }, secondPanelId)).toEqual({ attached: 0, workers: 0 });
  const cleanup = await page.evaluate(({ firstId, secondId }) => {
    const terminal = (window as any).__terminal;
    return { panels: [firstId, secondId].map(id => {
      const panel = terminal.panels.get(id);
      return { id, attached: panel.studies.diagnostics().attached, workers: panel.studies.diagnostics().workers };
    }), feed: terminal.feed.diagnostics, feedProtocol: terminal.stats().feedProtocol };
  }, { firstId: firstPanelId, secondId: secondPanelId });
  expect(cleanup.panels).toEqual([
    { id: firstPanelId, attached: 0, workers: 0 }, { id: secondPanelId, attached: 0, workers: 0 },
  ]);
  expect(cleanup.feed).toMatchObject({ series: 1, subscriptions: 2, caches: [expect.objectContaining({ clients: 2 })] });
  expect(cleanup.feedProtocol.subscriptions.candles).toBe(2);
  if (process.env.R2_MULTICHART_METRICS_PATH) await writeFile(process.env.R2_MULTICHART_METRICS_PATH,
    JSON.stringify({ ...metrics, cleanup }, null, 2));
});

import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function paneState(page: import('@playwright/test').Page, panelId: string) {
  return page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    const chart = panel.engine.chart;
    const host = panel.studies;
    return {
      panes: chart.panes().map((pane: any, index: number) => ({
        index,
        primary: index === chart.primaryPaneIndex(),
        elementClass: pane.element?.className ?? '',
        connected: Boolean(pane.element?.isConnected),
        indicators: chart.indicators().filter((item: any) => item.paneIndex === index).map((item: any) => ({ id: item.id, paneIndex: item.paneIndex })),
        objects: panel.engine.objects.list().filter((item: any) => item.paneIndex === index).map((item: any) => ({ id: item.id, kind: item.kind })),
        drawings: panel.engine.drawings.drawings().filter((item: any) => item.paneIndex === index).map((item: any) => ({ id: item.id, kind: item.kind })),
        managedMembers: panel.series.indicators.flatMap((instance: any) => {
          if (instance.placement === 'attachment') return [];
          const paneIndex = instance.script ? host.paneIndex(instance.instanceId) : panel.compositionApis.get(instance.instanceId)?.paneIndex ?? -1;
          return paneIndex === index ? [{ id: instance.instanceId, definitionId: instance.definitionId, paneId: instance.paneId, paneIndex }] : [];
        }),
      })),
      composition: panel.series.composition,
      indicators: panel.series.indicators.map((instance: any) => ({ id: instance.instanceId, definitionId: instance.definitionId, paneId: instance.paneId })),
      study: host.diagnostics(),
    };
  }, panelId);
}

async function movePair(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, target: string) {
  await panel.getByRole('button', { name: /Move SMA 20 · Volume/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await dialog.getByLabel('Move to pane').selectOption(target);
  await dialog.getByLabel('Move all studies in this pane together').check();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
}

test('managed pane cleanup trace reports every remaining occupant before provider removal', async ({ page }) => {
  test.setTimeout(45_000);
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
  const add = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await add.getByLabel('Indicator output').selectOption({ index: 0 });
  await add.getByRole('button', { name: 'Add SMA', exact: true }).click();

  await movePair(page, panel, '@new');
  await movePair(page, panel, '@price');
  await movePair(page, panel, '@new');
  await movePair(page, panel, '@new');
  const beforeSmaRemoval = await paneState(page, panelId);
  await panel.getByRole('button', { name: 'Remove SMA 20 · Volume', exact: true }).click();
  const beforeProviderRemoval = await paneState(page, panelId);
  console.log('ORPHAN PANE BEFORE PROVIDER REMOVAL', JSON.stringify({ beforeSmaRemoval, beforeProviderRemoval }));

  await panel.getByRole('button', { name: 'Remove Volume', exact: true }).click();
  await expect.poll(async () => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return { attached: current.studies.diagnostics().attached, workers: current.studies.diagnostics().workers, panes: current.engine.chart.panes().length };
  }, panelId)).toMatchObject({ attached: 0, workers: 0 });
  const afterRemoval = await paneState(page, panelId);
  console.log('ORPHAN PANE AFTER PROVIDER REMOVAL', JSON.stringify(afterRemoval));
  expect(afterRemoval.panes).toHaveLength(1);
});

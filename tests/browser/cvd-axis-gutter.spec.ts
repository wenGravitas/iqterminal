import { expect, test, type Page } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function readAxisLayout(page: Page, panelId: string) {
  return page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id), chart = panel.engine.chart;
    const cvdPane = panel.cvdView?.paneIndex() ?? (panel.orderFlowPaneIndex >= 0 ? panel.orderFlowPaneIndex : panel.openInterestView?.paneIndex() ?? -1);
    const cvdScale = panel.cvdView?.assignedScaleId;
    const cvd = panel.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const sma = panel.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma'
      && item.numericInputs?.source?.instanceId === cvd?.instanceId);
    const smaScale = sma ? panel.compositionApis.get(sma.instanceId)?.plotPriceScaleId('p0') : null;
    const cvdPlacement = cvdPane >= 0 && cvdScale ? chart.priceAxisPlacement(cvdPane, cvdScale) : null;
    return {
      cvdPane,
      cvdPaneConnected: panel.cvdView?.paneElement().isConnected,
      cvdPaneData: panel.cvdView?.paneElement().dataset,
      chartPanes: chart.panes().map((pane: any, index: number) => ({ index, cvd: pane.element.dataset.cvd, oi: pane.element.dataset.openInterest, paneId: pane.element.dataset.paneId })),
      cvdScale,
      cvdSide: cvdPlacement?.side,
      cvdScaleActive: cvdPane >= 0 && cvdScale ? chart.priceAxisState(cvdPane, cvdScale)?.active : false,
      smaScale,
      smaScaleActive: cvdPane >= 0 && smaScale ? chart.priceAxisState(cvdPane, smaScale)?.active : false,
      cvdPlotLeft: cvdPane >= 0 ? chart.plotRect(cvdPane)?.left : null,
      cvdLeftAxes: cvdPane >= 0 ? chart.priceAxisLayout(cvdPane).filter((slot: any) => slot.side === 'left').map((slot: any) => slot.scaleId) : [],
      cvdRightAxes: cvdPane >= 0 ? chart.priceAxisLayout(cvdPane).filter((slot: any) => slot.side === 'right').map((slot: any) => slot.scaleId) : [],
      panes: chart.panes().map((_: unknown, index: number) => ({
        left: chart.priceAxisLayout(index).filter((slot: any) => slot.side === 'left').map((slot: any) => slot.scaleId),
      })),
      oiSide: panel.openInterestView
        ? chart.priceAxisPlacement(panel.openInterestView.paneIndex(), panel.openInterestView.assignedScaleId)?.side
        : null,
    };
  }, panelId);
}

async function setCvdUnits(panel: import('@playwright/test').Locator, page: Page, unit: 'btc' | 'usdt') {
  await panel.locator('.active-indicator[data-definition-id="native.multi-venue-cvd"]')
    .getByRole('button', { name: 'Multi-Venue CVD settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Multi-Venue CVD settings' });
  await settings.getByLabel('CVD display unit', { exact: true }).selectOption(unit);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0].cvdView?.settings.units))).toBe(unit);
}

async function moveOpenInterest(page: Page, panel: import('@playwright/test').Locator, panelId: string, instanceId: string, targetPane: string) {
  const previousPane = await page.evaluate(({ id, instance }) => {
    return (window as any).__terminal.panels.get(id).selection.indicators.find((item: any) => item.instanceId === instance)?.paneId;
  }, { id: panelId, instance: instanceId });
  await panel.locator(`.active-indicator[data-instance-id="${instanceId}"]`)
    .getByRole('button', { name: 'Move Open Interest', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption(targetPane);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  if (targetPane === '@new') {
    await expect.poll(() => page.evaluate(({ id, instance, current }) => {
      return (window as any).__terminal.panels.get(id).selection.indicators.find((item: any) => item.instanceId === instance)?.paneId !== current;
    }, { id: panelId, instance: instanceId, current: previousPane })).toBe(true);
  } else {
    await expect.poll(() => page.evaluate(({ id, instance }) => {
      return (window as any).__terminal.panels.get(id).selection.indicators.find((item: any) => item.instanceId === instance)?.paneId;
    }, { id: panelId, instance: instanceId })).toBe(targetPane);
  }
}

test('standalone CVD keeps chart plots flush left while managed CVD/Open Interest retains assigned axes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');
  const close = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await close.isVisible()) await close.click();
  await addIndicator(panel, 'Multi-Venue CVD');
  await expect(panel.locator('[data-cvd="true"]')).toBeVisible();

  let layout = await readAxisLayout(page, panelId);
  expect(layout.cvdScaleActive).toBe(true);
  expect(layout.cvdRightAxes).toContain(layout.cvdScale);
  expect(layout.cvdLeftAxes).toEqual([]);
  expect(layout.cvdPlotLeft).toBeLessThan(8);
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left)).toEqual([]);

  const cvd = panel.locator('[data-cvd="true"]');
  await cvd.getByRole('button', { name: 'Aggregations', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ([...(window as any).__terminal.panels.values()][0].cvdView?.settings.mode))).toBe('aggregations');
  await setCvdUnits(panel, page, 'usdt');
  layout = await readAxisLayout(page, panelId);
  expect(layout.cvdScaleActive).toBe(true);
  expect(layout.cvdRightAxes).toContain(layout.cvdScale);
  expect(layout.cvdLeftAxes).toEqual([]);
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left)).toEqual([]);

  await addIndicator(panel, 'Open Interest');
  const ids = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), items = current.selection.indicators;
    return {
      cvd: items.find((item: any) => item.definitionId === 'native.multi-venue-cvd'),
      oi: items.find((item: any) => item.definitionId === 'native.raw-open-interest'),
    };
  }, panelId);
  expect(ids.cvd?.paneId).toBeTruthy();
  expect(ids.oi?.paneId).toBeTruthy();

  await moveOpenInterest(page, panel, panelId, ids.oi.instanceId, ids.cvd.paneId);
  await expect(panel.locator('[data-order-flow-chrome="true"]')).toHaveCount(1);
  layout = await readAxisLayout(page, panelId);
  expect(layout.cvdScaleActive).toBe(true);
  expect(layout.cvdSide).toBe('left');
  expect(layout.oiSide).toBe('right');
  expect(layout.cvdLeftAxes).toContain(layout.cvdScale);
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left)).toEqual([layout.cvdScale]);

  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), cvd = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    return current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalUsdt`)?.available;
  }, panelId)).toBe(true);
  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd.instanceId}"]`)
    .getByRole('button', { name: 'Add moving average to Multi-Venue CVD', exact: true }).click();
  const addSma = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addSma.getByLabel('Indicator output').selectOption(`output:${ids.cvd.instanceId}:cvdTotalUsdt`);
  await addSma.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const smaId = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), cvd = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    return current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma'
      && item.numericInputs?.source?.instanceId === cvd.instanceId)?.instanceId;
  }, panelId);
  await expect.poll(() => page.evaluate(({ id, sma }) => {
    const current = (window as any).__terminal.panels.get(id), api = current.compositionApis.get(sma);
    return Boolean(api && current.outputRegistry.get(`output:${sma}:p0`)?.available);
  }, { id: panelId, sma: smaId })).toBe(true);
  layout = await readAxisLayout(page, panelId);
  expect(layout.smaScale).toBe(layout.cvdScale);
  expect(layout.smaScaleActive).toBe(true);
  expect(layout.cvdLeftAxes).toContain(layout.smaScale);

  await setCvdUnits(panel, page, 'btc');
  layout = await readAxisLayout(page, panelId);
  expect(layout.cvdSide).toBe('left');
  expect(layout.cvdScaleActive).toBe(true);
  expect(layout.oiSide).toBe('right');
  expect(layout.cvdScale).not.toBe(layout.smaScale);
  expect(layout.smaScaleActive).toBe(true);
  expect(layout.cvdLeftAxes).toEqual(expect.arrayContaining([layout.cvdScale, layout.smaScale]));
  expect(layout.cvdLeftAxes).toHaveLength(2);
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left).sort()).toEqual([layout.cvdScale, layout.smaScale].sort());

  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd.instanceId}"]`)
    .getByRole('button', { name: 'Hide Multi-Venue CVD', exact: true }).click();
  await expect(panel.locator('[data-cvd="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).cvdView === undefined, panelId)).toBe(true);
  layout = await readAxisLayout(page, panelId);
  expect(layout.smaScaleActive).toBe(true);
  expect(layout.cvdLeftAxes).toEqual([layout.smaScale]);

  const smaRow = panel.locator(`.active-indicator[data-instance-id="${smaId}"]`);
  await smaRow.getByRole('button', { name: /Hide SMA/ }).click();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma')?.visible;
  }, panelId)).toBe(false);
  layout = await readAxisLayout(page, panelId);
  // Hidden SMA remains mapped to its independent scale for output demand, so
  // the live left axis must keep its placement for the later re-show.
  expect(layout.smaScaleActive).toBe(true);
  expect(layout.cvdLeftAxes).toEqual([layout.smaScale]);

  await smaRow.getByRole('button', { name: /Show SMA/ }).click();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    return Boolean(sma?.visible && current.compositionApis.get(sma.instanceId));
  }, panelId)).toBe(true);
  layout = await readAxisLayout(page, panelId);
  expect(layout.smaScaleActive).toBe(true);
  expect(layout.cvdLeftAxes).toEqual([layout.smaScale]);

  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd.instanceId}"]`)
    .getByRole('button', { name: 'Show Multi-Venue CVD', exact: true }).click();
  await expect(panel.locator('[data-cvd="true"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).cvdView?.paneIndex(), panelId)).toBeGreaterThanOrEqual(1);

  await moveOpenInterest(page, panel, panelId, ids.oi.instanceId, '@new');
  await expect(panel.locator('[data-order-flow-chrome="true"]')).toHaveCount(0);
  layout = await readAxisLayout(page, panelId);
  expect(layout.cvdScaleActive, JSON.stringify(layout)).toBe(true);
  expect(layout.cvdRightAxes).toContain(layout.cvdScale);
  expect(layout.cvdRightAxes).toContain(layout.smaScale);
  expect(layout.cvdLeftAxes).toEqual([]);
  expect(layout.cvdPlotLeft).toBeLessThan(8);
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left)).toEqual([]);

  await panel.locator(`.active-indicator[data-instance-id="${ids.oi.instanceId}"]`)
    .getByRole('button', { name: 'Remove Open Interest', exact: true }).click();
  await expect(panel.locator('[data-open-interest="true"]')).toHaveCount(0);
  layout = await readAxisLayout(page, panelId);
  expect(layout.cvdSide).toBe('right');
  expect(layout.panes.flatMap((pane: { left: string[] }) => pane.left)).toEqual([]);
});

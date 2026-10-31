import { expect, test, type Locator, type Page } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator } from './indicator-actions';

async function markFixtureCandlesLive(page: Page) {
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'fixture', rate: 1000 }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].status.state)).toBe('live');
}

async function tooltipForInfoButton(page: Page, info: Locator) {
  await expect(info).toHaveAttribute('aria-describedby', /indicator-title-tooltip-/);
  const id = await info.getAttribute('aria-describedby');
  return page.locator(`#${id}`);
}

test('collapsed pane keeps one name and actions row, and its info control is feed-neutral at 720px', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 720, height: 860 });
  await page.route('**/market-data/v1/net-positioning*', async route => {
    const url = new URL(route.request().url()), venues = (url.searchParams.get('venues') ?? 'binance').split(',');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1, method: url.searchParams.get('method') ?? 'price-oi', market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues,
      from: Number(url.searchParams.get('from') ?? 0), to: Number(url.searchParams.get('to') ?? Date.now()),
      unitVerification: {}, feeds: {}, intervals: [], truncated: false, pendingIntervals: 0, history: 'explicit UI fixture', semantics: 'explicit UI fixture',
    }) });
  });
  await installDepthFixture(page);
  await markFixtureCandlesLive(page);
  const panel = page.locator('.candle-panel').first();
  const closeObjects = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await closeObjects.isVisible()) await closeObjects.click();
  await addIndicator(panel, 'Net Longs — Estimated');

  const row = panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-longs-estimated"]');
  await expect(row).toBeVisible();
  const paneIndex = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.netPositioningPaneIndex('native.net-longs-estimated');
  });
  const controls = panel.locator(`.pane-layout-controls[data-pane-index="${paneIndex}"]`);
  await expect(controls.getByRole('button', { name: `Collapse pane ${paneIndex + 1} to header only`, exact: true })).toBeVisible();
  const sourceLegend = panel.locator(`.pane-indicator-host[data-pane-index="${paneIndex}"] .net-positioning-legend[aria-label="Net Longs sources"]`);
  await expect(sourceLegend).toBeVisible();
  await expect(sourceLegend.locator('.net-positioning-source')).toHaveCount(3);
  const rowList = panel.locator(`.pane-indicator-host[data-pane-index="${paneIndex}"] .pane-indicator-rows`);
  await rowList.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await sourceLegend.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const thirdVenueVisible = await sourceLegend.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    const view = element.getBoundingClientRect(), button = element.querySelectorAll<HTMLElement>('.net-positioning-source')[2]!.getBoundingClientRect();
    return button.left >= view.left && button.right <= view.right;
  });
  expect(thirdVenueVisible).toBe(true);
  await sourceLegend.evaluate(element => { element.scrollLeft = 0; });
  await rowList.evaluate(element => { element.scrollLeft = 0; });
  const before = await page.evaluate(() => {
    const terminal = (window as any).__terminal, p = [...terminal.panels.values()][0];
    return { request: p.diagnostics().netPositioning.request, subscribers: terminal.feed.currentNetPositioning.size,
      settings: JSON.stringify(p.selection.indicators.find((item: any) => item.definitionId === 'native.net-longs-estimated')?.settings) };
  });

  await controls.getByRole('button', { name: `Collapse pane ${paneIndex + 1} to header only`, exact: true }).click();
  const folded = panel.locator(`.pane-indicator-host[data-pane-index="${paneIndex}"][data-collapsed="true"]`);
  const foldedRow = folded.locator('.active-indicator[data-definition-id="native.net-longs-estimated"]');
  await expect(foldedRow).toBeVisible();
  await expect(foldedRow.getByRole('button', { name: 'About Net Longs — Estimated', exact: true })).toBeVisible();
  await expect(foldedRow.getByRole('button', { name: 'Remove Net Longs — Estimated', exact: true })).toBeVisible();
  await expect(folded.locator('.pane-layout-controls-inline').getByRole('button', { name: `Expand pane ${paneIndex + 1}`, exact: true })).toBeVisible();
  await expect(panel.locator('.active-indicator-rows > .active-indicator[data-definition-id="native.net-longs-estimated"]')).toHaveCount(0);
  await expect(folded.locator('.active-indicator')).toHaveCount(1);

  const info = foldedRow.getByRole('button', { name: 'About Net Longs — Estimated', exact: true });
  await info.click();
  const tooltip = await tooltipForInfoButton(page, info);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('estimates, not actual position counts');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  const after = await page.evaluate(() => {
    const terminal = (window as any).__terminal, p = [...terminal.panels.values()][0];
    return { request: p.diagnostics().netPositioning.request, subscribers: terminal.feed.currentNetPositioning.size,
      settings: JSON.stringify(p.selection.indicators.find((item: any) => item.definitionId === 'native.net-longs-estimated')?.settings) };
  });
  expect(after).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  await page.mouse.move(0, 0);
  await info.hover();
  const hoveredTooltip = await tooltipForInfoButton(page, info);
  await expect(hoveredTooltip).toBeVisible();
  await expect(hoveredTooltip).toContainText('estimates, not actual position counts');
  await page.mouse.move(0, 0);
  await expect(hoveredTooltip).toBeHidden();

  await info.evaluate((element: HTMLElement) => element.blur());
  await info.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  await info.focus();
  const focusedTooltip = await tooltipForInfoButton(page, info);
  await expect(focusedTooltip).toBeVisible();
  const focusedTooltipId = await focusedTooltip.getAttribute('id');
  await expect(info).toHaveAttribute('aria-describedby', new RegExp(focusedTooltipId!));
  await info.evaluate((element: HTMLElement) => element.blur());
  await expect(focusedTooltip).toBeHidden();

  await page.locator('#theme').selectOption('dark');
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim())).toBe('#090909');
  await page.screenshot({ path: 'artifacts/indicator-info-collapsed-720-dark.png' });
  await page.locator('#theme').selectOption('light');
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim())).toBe('#f6f4ee');
  await page.screenshot({ path: 'artifacts/indicator-info-collapsed-720-ivory.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'artifacts/indicator-info-collapsed-1366-ivory.png' });
  await page.locator('#theme').selectOption('dark');
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim())).toBe('#090909');
  await page.screenshot({ path: 'artifacts/indicator-info-collapsed-1366-dark.png' });

  await folded.locator('.pane-layout-controls-inline').getByRole('button', { name: `Expand pane ${paneIndex + 1}`, exact: true }).click();
  const expandedRow = panel.locator(`.pane-indicator-host[data-pane-index="${paneIndex}"][data-collapsed="false"] .active-indicator[data-definition-id="native.net-longs-estimated"]`);
  const expandedInfo = expandedRow.getByRole('button', { name: 'About Net Longs — Estimated', exact: true });
  await expect(expandedRow).toBeVisible();
  await expect(panel.locator(`.pane-indicator-layer > .pane-layout-controls[data-pane-index="${paneIndex}"]`)).toHaveCount(0);
  await expect(panel.locator(`.pane-indicator-host[data-pane-index="${paneIndex}"] > .pane-layout-controls`)).toHaveCount(1);

  await expandedInfo.evaluate(element => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const clickTooltip = await tooltipForInfoButton(page, expandedInfo);
  await expect(clickTooltip).toBeVisible();
  await page.locator('.chart-stage').last().click({ position: { x: 12, y: 12 } });
  await expect(clickTooltip).toBeHidden();
  await expect(expandedInfo).toHaveAttribute('aria-expanded', 'false');

  await expandedInfo.click();
  const deleteTooltip = await tooltipForInfoButton(page, expandedInfo);
  await expect(deleteTooltip).toBeVisible();
  await expandedRow.getByRole('button', { name: 'Remove Net Longs — Estimated', exact: true }).click();
  await expect(expandedRow).toHaveCount(0);
  await expect(deleteTooltip).toBeHidden();
});

test('healthy chart footer stays hidden and Effort shows only a plain unavailable message', async ({ page }) => {
  test.setTimeout(90_000);
  await installDepthFixture(page);
  await markFixtureCandlesLive(page);
  const panel = page.locator('.candle-panel').first();
  await expect(panel.locator('.chart-footer')).toBeHidden();
  await expect(panel.locator('.panel-status')).toBeHidden();
  await addIndicator(panel, 'Effort–Result');
  const status = panel.locator('.effort-status');
  await expect(status).toHaveText('Data unavailable.');
  await expect(status).not.toContainText(/SESSION ONLY|trade-price proxy|Unavailable/);
  const row = panel.locator('.active-indicator[data-definition-id="native.effort-result"]');
  await row.getByRole('button', { name: 'Effort–Result history', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Effort–Result retained events', exact: true })).toBeVisible();
});

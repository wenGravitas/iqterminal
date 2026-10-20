import { expect, test } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator } from './indicator-actions';

test('pane indicators use one local header while overlays stay in the main list', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__paneHeaderCanvasText = [];
    CanvasRenderingContext2D.prototype.fillText = function (text: string, ...args: any[]) {
      if (/Net Longs — Estimated|Net Shorts — Estimated|Footprint Totals/.test(text)) (window as any).__paneHeaderCanvasText.push(text);
      return Reflect.apply(original, this, [text, ...args]);
    };
  });
  await page.route('**/market-data/v1/net-positioning*', async route => {
    const url = new URL(route.request().url()), method = url.searchParams.get('method') ?? 'price-oi';
    const venues = (url.searchParams.get('venues') ?? 'binance').split(',');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues,
      from: Number(url.searchParams.get('from') ?? 0), to: Number(url.searchParams.get('to') ?? Date.now()),
      unitVerification: Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit layout fixture' }])),
      feeds: Object.fromEntries(venues.map(venue => [venue, { state: 'live', source: 'explicit-layout-fixture', stale: false, expectedIntervalMs: 30_000 }])),
      intervals: [], truncated: false, pendingIntervals: 0, history: 'explicit layout fixture', semantics: 'layout only',
    }) });
  });
  await installDepthFixture(page);
  await page.setViewportSize({ width: 2560, height: 1080 });
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Net Longs — Estimated');
  await addIndicator(panel, 'Net Shorts — Estimated');
  await addIndicator(panel, 'Footprint Totals');
  await addIndicator(panel, 'Order-book Heatmap');

  const paneRows = panel.locator('.pane-indicator-host > .active-indicator');
  const ids = ['native.net-longs-estimated', 'native.net-shorts-estimated', 'native.footprint-totals'];
  await expect(paneRows).toHaveCount(3);
  await expect(panel.locator('.active-indicator-rows > .active-indicator[data-definition-id="native.orderbook-heatmap"]')).toHaveCount(1);
  const mapping = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return [...document.querySelectorAll('.candle-panel .pane-indicator-host')].flatMap(host =>
      [...host.querySelectorAll<HTMLElement>('.active-indicator')].map(row => ({ id: row.dataset.definitionId, pane: Number((host as HTMLElement).dataset.paneIndex),
        expectedPane: row.dataset.definitionId === 'native.net-longs-estimated' ? p.engine.netPositioningPaneIndex('native.net-longs-estimated')
          : row.dataset.definitionId === 'native.net-shorts-estimated' ? p.engine.netPositioningPaneIndex('native.net-shorts-estimated')
            : p.engine.footprintTotalsPaneIndex('native.footprint-totals'),
        plot: p.engine.chart.plotRect(Number((host as HTMLElement).dataset.paneIndex)) })));
  });
  expect(mapping.map((item: any) => item.id).sort()).toEqual([...ids].sort());
  for (const item of mapping as any[]) { expect(item.pane).toBeGreaterThan(0); expect(item.pane).toBe(item.expectedPane); }
  expect(mapping.every((item: any) => item.plot && item.plot.width >= 150 && item.plot.height >= 36)).toBe(true);
  await page.screenshot({ path: 'artifacts/pane-indicator-headers/three-native-panes.png' });
  const positioningSubscriptions = await page.evaluate(() => (window as any).__terminal.feed.currentNetPositioning.size);
  expect(positioningSubscriptions).toBe(1);

  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    (window as any).__paneHeaderBeforeResize = { engine: p.engine, chart: p.engine.chart, request: p.diagnostics().netPositioning.request,
      subscribers: (window as any).__terminal.feed.currentNetPositioning.size,
      rows: [...document.querySelectorAll('.candle-panel .pane-indicator-host > .active-indicator')] };
  });
  await page.setViewportSize({ width: 1260, height: 1080 });
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], before = (window as any).__paneHeaderBeforeResize;
    const hosts = [...document.querySelectorAll('.candle-panel .pane-indicator-host')];
    const aligned = hosts.every(host => {
      const index = Number((host as HTMLElement).dataset.paneIndex), plot = p.engine.chart.plotRect(index), rect = (host as HTMLElement).getBoundingClientRect(), chartRect = p.element.querySelector('.chart-stage').getBoundingClientRect();
      return plot && Math.abs(rect.left - (chartRect.left + plot.left + 4)) < 2 && Math.abs(rect.top - (chartRect.top + plot.top)) < 2;
    });
    const controlsFit = [...p.element.querySelectorAll('.pane-layout-controls:not([hidden])')].every((host: HTMLElement) => {
      const stage = host.closest('.chart-stage')!.getBoundingClientRect(), rect = host.getBoundingClientRect();
      return rect.left >= stage.left && rect.right <= stage.right && rect.top >= stage.top && rect.bottom <= stage.bottom;
    });
    return p.engine === before.engine && p.engine.chart === before.chart && p.diagnostics().netPositioning.request === before.request
      && (window as any).__terminal.feed.currentNetPositioning.size === before.subscribers
      && before.rows.every((row: Element) => row.isConnected) && hosts.length === 3 && aligned
      && controlsFit
      && Math.min(...hosts.map(host => p.engine.chart.plotRect(Number((host as HTMLElement).dataset.paneIndex)).width)) >= 150;
  })).toBe(true);
  const longsIndex = mapping.find((item: any) => item.id === 'native.net-longs-estimated')!.pane;
  const totalsIndex = mapping.find((item: any) => item.id === 'native.footprint-totals')!.pane;
  await page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizePane(index), longsIndex);
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.chart.maximizedPane() !== null
      && document.querySelectorAll('.candle-panel .pane-indicator-host').length === 1
      && ['native.net-shorts-estimated', 'native.footprint-totals'].every(id => document.querySelector(`.active-indicator-rows > .active-indicator[data-definition-id="${id}"]`));
  })).toBe(true);
  await page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizePane(index), longsIndex);
  await expect(paneRows).toHaveCount(3);
  await page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.setPaneCollapsed(index, true), totalsIndex);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.candle-panel .pane-indicator-host').length === 2
    && document.querySelector('.active-indicator-rows > .active-indicator[data-definition-id="native.footprint-totals"]') !== null)).toBe(true);
  await page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.setPaneCollapsed(index, false), totalsIndex);
  await expect(paneRows).toHaveCount(3);
  await page.setViewportSize({ width: 2560, height: 1080 });

  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  const longs = panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-longs-estimated"]');
  await longs.getByRole('button', { name: 'Hide Net Longs — Estimated', exact: true }).click();
  await expect(panel.locator('.active-indicator-rows > .active-indicator[data-definition-id="native.net-longs-estimated"]')).toHaveCount(1);
  await panel.locator('.active-indicator[data-definition-id="native.net-longs-estimated"]')
    .getByRole('button', { name: 'Show Net Longs — Estimated', exact: true }).click();
  await expect(panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-longs-estimated"]')).toHaveCount(1);
  await panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-shorts-estimated"]')
    .getByRole('button', { name: 'Remove Net Shorts — Estimated', exact: true }).click();
  await expect(panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-shorts-estimated"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__paneHeaderCanvasText.length)).toBe(0);

  const initialPrimaryIndex = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.chart.primaryPaneIndex();
  });
  await panel.getByRole('button', { name: 'Move main pane down', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.primaryPaneIndex())).toBe(initialPrimaryIndex + 1);
  await expect(panel.getByRole('button', { name: 'Move main pane up', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Move main pane up', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.primaryPaneIndex())).toBe(initialPrimaryIndex);
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], index = p.engine.chart.primaryPaneIndex();
    return [...p.element.querySelectorAll('.pane-layout-controls button[aria-label="Collapse main pane to header only"]')]
      .some((button: HTMLButtonElement) => button.dataset.paneIndex === String(index));
  })).toBe(true);

  const secondaryMove = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, index = p.engine.netPositioningPaneIndex('native.net-longs-estimated');
    return { index, direction: index < chart.panes().length - 1 ? 1 : -1 };
  });
  const secondaryMoveLabel = (index: number, direction: number) => `Move pane ${index + 1} ${direction > 0 ? 'down' : 'up'}`;
  await panel.getByRole('button', { name: secondaryMoveLabel(secondaryMove.index, secondaryMove.direction), exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.netPositioningPaneIndex('native.net-longs-estimated');
  })).toBe(secondaryMove.index + secondaryMove.direction);
  const movedSecondaryIndex = secondaryMove.index + secondaryMove.direction;
  await panel.getByRole('button', { name: secondaryMoveLabel(movedSecondaryIndex, -secondaryMove.direction), exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.netPositioningPaneIndex('native.net-longs-estimated');
  })).toBe(secondaryMove.index);
  const secondaryControls = panel.locator(`.pane-layout-controls[data-pane-index="${secondaryMove.index}"]`);
  const paneLabel = `pane ${secondaryMove.index + 1}`;
  await secondaryControls.getByRole('button', { name: `Collapse ${paneLabel} to header only`, exact: true }).click();
  await expect.poll(() => page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.paneCollapsed(index), secondaryMove.index)).toBe(true);
  await expect(secondaryControls.getByRole('button', { name: `Expand ${paneLabel}`, exact: true })).toBeEnabled();
  await secondaryControls.getByRole('button', { name: `Expand ${paneLabel}`, exact: true }).click();
  await expect.poll(() => page.evaluate(index => [...(window as any).__terminal.panels.values()][0].engine.chart.paneCollapsed(index), secondaryMove.index)).toBe(false);
  await secondaryControls.getByRole('button', { name: `Maximize ${paneLabel}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizedPane())).toBe(secondaryMove.index);
  await expect(secondaryControls.getByRole('button', { name: 'Restore all panes', exact: true })).toBeEnabled();
  await secondaryControls.getByRole('button', { name: 'Restore all panes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizedPane())).toBe(null);

  const originalWeight = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return p.engine.chart.paneWeight(p.engine.chart.primaryPaneIndex());
  });
  await panel.getByRole('button', { name: 'Collapse main pane to header only', exact: true }).click();
  await expect(panel.locator('.primary-pane-collapsed-header')).toBeVisible();
  const collapsedLayout = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, pane = chart.panes()[chart.primaryPaneIndex()];
    return { height: pane.element.getBoundingClientRect().height, visibility: pane.element.style.visibility,
      weight: chart.paneWeight(chart.primaryPaneIndex()), chartHeight: p.element.querySelector('.chart-stage').clientHeight,
      otherOpen: chart.panes().some((item: any, index: number) => index !== chart.primaryPaneIndex() && !chart.paneCollapsed(index)) };
  });
  expect(collapsedLayout).toMatchObject({ visibility: 'hidden', otherOpen: true });
  expect(collapsedLayout.height).toBeGreaterThanOrEqual(20);
  expect(collapsedLayout.height).toBeLessThanOrEqual(36);
  await panel.getByRole('button', { name: 'Expand main pane', exact: true }).click();
  await expect(panel.locator('.primary-pane-collapsed-header')).toBeHidden();
  await expect.poll(() => page.evaluate(weight => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart;
    return Math.abs(chart.paneWeight(chart.primaryPaneIndex()) - weight) < 0.001
      && chart.panes()[chart.primaryPaneIndex()].element.style.visibility !== 'hidden';
  }, originalWeight)).toBe(true);

  await panel.getByRole('button', { name: 'Maximize main pane', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0].engine.chart;
    return chart.maximizedPane() === chart.primaryPaneIndex();
  })).toBe(true);
  await panel.getByRole('button', { name: 'Restore all panes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizedPane())).toBe(null);
});

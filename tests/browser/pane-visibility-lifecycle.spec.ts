import { expect, test } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, setFootprint } from './indicator-actions';

type PaneSnapshot = {
  paneCount: number;
  seriesCount: number;
  owners: Array<{ id: string; paneIndex: number; paneSeriesCount: number }>;
  headerRows: Array<{ id: string; paneIndex: number }>;
  legends: number;
  netSubscriptions: number;
  settings: Array<{ definitionId: string; settings: Record<string, unknown> }>;
  stableIdentity: boolean;
  stableHistory: boolean;
};

test('combined positioning and native indicator panes restore without orphan panes', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/market-data/v1/net-positioning*', async route => {
    const url = new URL(route.request().url());
    const method = url.searchParams.get('method') ?? 'price-oi';
    const venues = (url.searchParams.get('venues') ?? 'binance').split(',');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues,
      from: Number(url.searchParams.get('from') ?? 0), to: Number(url.searchParams.get('to') ?? Date.now()),
      unitVerification: Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: ['explicit pane lifecycle fixture'] }])),
      feeds: Object.fromEntries(venues.map(venue => [venue, { state: 'live', source: 'explicit-pane-lifecycle-fixture', stale: false, expectedIntervalMs: 30_000 }])),
      intervals: [], truncated: false, pendingIntervals: 0, history: 'explicit pane lifecycle fixture', semantics: 'pane lifecycle only',
    }) });
  });
  await installDepthFixture(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.feed.subscribeFootprint = () => () => undefined;
  });

  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const picker = panel.locator('.indicator-picker');
  await expect(picker.locator('[data-add-native="native.footprint-totals"]')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await setFootprint(panel, true);

  const definitions = [
    { name: 'Net Longs & Shorts', id: 'native.net-longs-shorts-estimated' },
    { name: 'Footprint Totals', id: 'native.footprint-totals' },
  ];
  for (const indicator of definitions) await addIndicator(panel, indicator.name);

  const snapshot = async (): Promise<PaneSnapshot> => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const p = [...terminal.panels.values()][0] as any;
    const chart = p.engine.chart;
    const owners = [
      ...p.engine.netPositioningDiagnostics().map((view: any) => ({ id: view.id, paneIndex: view.paneIndex, paneSeriesCount: chart.panes()[view.paneIndex]?.series().length ?? 0 })),
      ...p.engine.footprintTotalsDiagnostics().map((view: any) => ({ id: view.id, paneIndex: view.paneIndex, paneSeriesCount: chart.panes()[view.paneIndex]?.series().length ?? 0 })),
    ].sort((a: any, b: any) => a.paneIndex - b.paneIndex);
    const headerRows = [...document.querySelectorAll<HTMLElement>('.candle-panel .pane-indicator-host')].flatMap(host =>
      [...host.querySelectorAll<HTMLElement>('.active-indicator')].map(row => ({ id: row.dataset.definitionId!, paneIndex: Number(host.dataset.paneIndex) })))
      .sort((a, b) => a.paneIndex - b.paneIndex);
    const settings = p.selection.indicators
      .filter((indicator: any) => ['native.net-longs-shorts-estimated', 'native.footprint-totals'].includes(indicator.definitionId))
      .map((indicator: any) => ({ definitionId: indicator.definitionId, settings: structuredClone(indicator.settings) }))
      .sort((a: any, b: any) => a.definitionId.localeCompare(b.definitionId));
    const refs = (window as any).__paneVisibilityRefs;
    return {
      paneCount: chart.panes().length,
      seriesCount: chart.panes().reduce((count: number, pane: any) => count + pane.series().length, 0),
      owners,
      headerRows,
      legends: p.element.querySelectorAll('.net-positioning-legend').length,
      netSubscriptions: terminal.feed.currentNetPositioning.size,
      settings,
      stableIdentity: Boolean(refs && refs.engine === p.engine && refs.chart === chart),
      stableHistory: Boolean(refs && refs.histories === p.netPositioningHistories
        && refs.historyRows.every(([method, history]: [string, unknown]) => p.netPositioningHistories.get(method) === history)),
    };
  });

  await expect.poll(async () => (await snapshot()).owners.length).toBe(2);
  const baseline = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const chart = p.engine.chart;
    const histories = p.netPositioningHistories;
    (window as any).__paneVisibilityRefs = { engine: p.engine, chart, histories, historyRows: [...histories.entries()] };
    return { paneCount: chart.panes().length - 2, seriesCount: chart.panes().reduce((count: number, pane: any) => count + pane.series().length, 0) - 2 };
  });
  expect(baseline.paneCount).toBe(1);
  const afterAdd = await snapshot();
  expect(afterAdd.paneCount).toBe(baseline.paneCount + 2);
  expect(afterAdd.seriesCount).toBe(baseline.seriesCount + 2);
  expect(afterAdd.owners.map(view => view.id)).toEqual(expect.arrayContaining(definitions.map(item => item.id)));
  expect(afterAdd.netSubscriptions).toBe(1);
  const initialSettings = afterAdd.settings;

  await setFootprint(panel, false);
  await expect.poll(async () => (await snapshot()).owners.map(view => view.id)).toEqual(['native.net-longs-shorts-estimated']);
  const candleMode = await snapshot();
  expect(candleMode.paneCount).toBe(baseline.paneCount + 1);
  expect(candleMode.owners.map(owner => owner.paneSeriesCount)).toEqual([1]);
  expect(candleMode.settings).toEqual(initialSettings);
  expect(candleMode.netSubscriptions).toBe(1);
  expect(candleMode.stableIdentity).toBe(true);
  expect(candleMode.stableHistory).toBe(true);
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(0);
  await expect(panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await expect(panel.locator('.indicator-picker [data-add-native="native.footprint-totals"]')).toHaveCount(0);
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();

  await setFootprint(panel, true);
  await expect.poll(async () => (await snapshot()).owners.length).toBe(2);
  const footprintMode = await snapshot();
  expect(footprintMode.paneCount).toBe(baseline.paneCount + 2);
  expect(footprintMode.seriesCount).toBe(baseline.seriesCount + 2);
  expect(footprintMode.settings).toEqual(initialSettings);
  expect(footprintMode.netSubscriptions).toBe(1);
  expect(footprintMode.stableIdentity).toBe(true);
  expect(footprintMode.stableHistory).toBe(true);
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(1);
  await expect(panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(1);
  await expect(panel.locator('.chart-objects-panel').getByRole('button', { name: 'Footprint Totals', exact: true })).toHaveCount(1);

  const rows = panel.locator('.pane-indicator-host .pane-indicator-rows > .active-indicator');
  for (const indicator of definitions) {
    for (let cycle = 0; cycle < 3; cycle++) {
      await panel.locator(`.pane-indicator-host .active-indicator[data-definition-id="${indicator.id}"]`)
        .getByRole('button', { name: `Hide ${indicator.name}`, exact: true }).click();
      const visible = 1;
      await expect(rows).toHaveCount(visible);
      await expect.poll(async () => (await snapshot()).paneCount).toBe(baseline.paneCount + visible);
      const hidden = await snapshot();
      expect(hidden.seriesCount).toBe(baseline.seriesCount + visible);
      expect(hidden.owners.map(view => view.id)).not.toContain(indicator.id);
      expect(hidden.legends).toBe(hidden.owners.filter(view => view.id === 'native.net-longs-shorts-estimated').length);
      expect(hidden.netSubscriptions).toBe(indicator.id === 'native.net-longs-shorts-estimated' ? 0 : 1);
      expect(hidden.stableIdentity).toBe(true);
      expect(hidden.stableHistory).toBe(true);

      await panel.locator(`.active-indicator-rows .active-indicator[data-definition-id="${indicator.id}"]`)
        .getByRole('button', { name: `Show ${indicator.name}`, exact: true }).click();
      await expect(rows).toHaveCount(2);
      await expect.poll(async () => (await snapshot()).paneCount).toBe(baseline.paneCount + 2);
      const shown = await snapshot();
      expect(shown.seriesCount).toBe(baseline.seriesCount + 2);
      expect(shown.owners.map(view => view.id)).toEqual(expect.arrayContaining(definitions.map(item => item.id)));
      expect(shown.headerRows.map(row => row.id)).toEqual(expect.arrayContaining(definitions.map(item => item.id)));
      expect(shown.owners.map(view => view.paneIndex).sort()).toEqual([1, 2]);
      expect(shown.netSubscriptions).toBe(1);
      expect(shown.settings).toEqual(initialSettings);
      expect(shown.stableIdentity).toBe(true);
      expect(shown.stableHistory).toBe(true);
    }
  }

  await panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-longs-shorts-estimated"]')
    .getByRole('button', { name: 'Remove Net Longs & Shorts', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect.poll(async () => (await snapshot()).paneCount).toBe(baseline.paneCount + 1);
  const positioningRemoved = await snapshot();
  expect(positioningRemoved.owners.map(view => view.id)).toEqual(['native.footprint-totals']);
  expect(positioningRemoved.netSubscriptions).toBe(0);
  await addIndicator(panel, 'Net Longs & Shorts');
  await expect(rows).toHaveCount(2);
  await expect.poll(async () => (await snapshot()).paneCount).toBe(baseline.paneCount + 2);
  const positioningRestored = await snapshot();
  expect(positioningRestored.owners.map(view => view.id)).toContain('native.net-longs-shorts-estimated');
  expect(positioningRestored.netSubscriptions).toBe(1);
  expect(positioningRestored.stableIdentity).toBe(true);
  expect(positioningRestored.stableHistory).toBe(true);

  await panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.net-longs-shorts-estimated"]')
    .getByRole('button', { name: 'Remove Net Longs & Shorts', exact: true }).click();
  await panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.footprint-totals"]')
    .getByRole('button', { name: 'Hide Footprint Totals', exact: true }).click();
  await expect.poll(async () => (await snapshot()).paneCount).toBe(baseline.paneCount);
  const clean = await snapshot();
  expect(clean.seriesCount).toBe(baseline.seriesCount);
  expect(clean.owners).toEqual([]);
  expect(clean.legends).toBe(0);
  expect(clean.netSubscriptions).toBe(0);
  expect(clean.stableIdentity).toBe(true);
  expect(errors).toEqual([]);
});

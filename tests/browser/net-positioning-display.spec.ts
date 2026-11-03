import { openGlobalSettings, selectTheme } from './footer-actions';
import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: process.env.POSITIONING_DPR === '2' ? 2 : 1 });

type Venue = 'binance' | 'hyperliquid';
type Method = 'price-oi' | 'aggressor-flow-oi';
const POSITIONING_ID = 'native.net-longs-shorts-estimated';

function fixtureRow(method: Method, venue: Venue, open: number, half: number, age: number) {
  const end = open + half * 30_000, start = end - 30_000;
  let longs: number, shorts: number;
  if (age === 0) {
    longs = venue === 'binance' ? (half === 0 ? 120 : 35) : -45 - half * 8;
    shorts = venue === 'binance' ? (half === 0 ? -80 : -25) : 20 + half * 15;
  } else if (age === 1) { longs = 0; shorts = 0; }
  else if (age === 3 && venue === 'binance' && half === 1) return {
    version: 1, method, status: 'unavailable', reason: 'fixture gap', venue, market: 'perpetual', nativeSymbol: 'BTCUSDT', units: 'BTC',
    startTimeMs: start, endTimeMs: end, attributionTimeMs: end, resolutionMs: 30_000, direction: null,
    oiDeltaBtcDecimal: null, netLongsBtcDecimal: null, netShortsBtcDecimal: null, unclassifiedBtcDecimal: null, qualityFlags: ['fixture-gap'],
    provenance: { tradeCoverage: { fromMs: start, toMs: end, complete: false, gap: true } },
  };
  else if (age === 60) {
    longs = venue === 'binance' ? (half === 0 ? 2_000 : 0) : half === 0 ? -50 : -25;
    shorts = venue === 'binance' ? (half === 0 ? -1_500 : 0) : half === 0 ? 40 : 20;
  } else {
    const value = ((age * 7 + half * 3 + (venue === 'binance' ? 2 : 5)) % 17) - 8;
    longs = value * .75; shorts = value * -.45;
  }
  const unclassified = Math.abs(longs + shorts) * .08, delta = longs + shorts + unclassified;
  const price = 82_000 + age * 2 + (venue === 'binance' ? 0 : 1);
  return {
    version: 1, method, status: 'available', venue, market: 'perpetual', nativeSymbol: venue === 'binance' ? 'BTCUSDT' : 'BTC', units: 'BTC',
    startTimeMs: start, endTimeMs: end, attributionTimeMs: end, resolutionMs: 30_000, direction: delta >= 0 ? 1 : -1,
    oiDeltaBtcDecimal: String(delta), netLongsBtcDecimal: String(longs), netShortsBtcDecimal: String(shorts), unclassifiedBtcDecimal: String(unclassified), qualityFlags: ['explicit-playwright-fixture'],
    provenance: {
      openInterestStart: { openInterestBtcDecimal: '100', sourceTimeMs: start, receivedAtMs: start, sourceTimeQuality: 'exchange-event', quality: 'complete' },
      openInterestEnd: { openInterestBtcDecimal: String(100 + delta), sourceTimeMs: end, receivedAtMs: end, sourceTimeQuality: 'exchange-event', quality: 'complete' },
      priceStart: { price, priceDecimal: String(price), sourceTimeMs: start, receivedAtMs: start },
      priceEnd: { price: price + 1, priceDecimal: String(price + 1), sourceTimeMs: end, receivedAtMs: end }, maxPriceAgeMs: 0,
      tradeCoverage: { fromMs: start, toMs: end, complete: true, gap: false },
      aggressorBuyBtcDecimal: String(Math.max(0, delta)), aggressorSellBtcDecimal: String(Math.max(0, -delta)), tradeCount: 100,
    },
  };
}

async function addIndicator(panel: ReturnType<Page['locator']>, name: string) {
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await panel.locator('.indicator-picker').getByRole('button', { name: `Add ${name}`, exact: true }).click();
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();
}

async function setSources(panel: ReturnType<Page['locator']>, venues: Venue[]) {
  const sources = panel.getByRole('group', { name: 'Net Longs & Shorts sources', exact: true });
  for (const venue of ['binance', 'hyperliquid'] as const) {
    const button = sources.locator(`[data-source="${venue}"]`), pressed = await button.getAttribute('aria-pressed') === 'true';
    if (pressed !== venues.includes(venue)) await button.click();
  }
}

async function openSettings(panel: ReturnType<Page['locator']>) {
  await panel.locator(`.active-indicator[data-definition-id="${POSITIONING_ID}"]`)
    .getByRole('button', { name: 'Net Longs & Shorts settings', exact: true }).click();
  return panel.locator('.net-positioning-settings');
}

async function installAxisGridPaneProbe(page: Page) {
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, grid = p.engine.axisGrid;
    const state = window as any;
    state.__positioningGridCalls = [];
    const draw = grid.draw;
    grid.draw = function(ctx: CanvasRenderingContext2D, rc: any) {
      const paneIndex = chart.panes().findIndex((pane: any) => pane.priceScale === rc.priceScale);
      state.__positioningGridCalls.push({ paneIndex, primaryPaneIndex: chart.primaryPaneIndex(), maximizedPane: chart.maximizedPane() });
      return Reflect.apply(draw, this, [ctx, rc]);
    };
    chart.setGridOptions({ vertLines: false, horzLines: false });
    chart.invalidate((mask: any) => mask.invalidatePane(chart.primaryPaneIndex(), { level: 3, autoScale: false }));
  });
}

async function readAxisGridProbe(page: Page) {
  return page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, primary = chart.primaryPaneIndex();
    const scale = chart.panes()[primary].priceScale;
    return { primary, maximized: chart.maximizedPane(), calls: [...(window as any).__positioningGridCalls],
      lines: p.engine.axisGrid.geometry.price.map((tick: any) => ({ y: tick.coordinate, expected: scale.priceToY(tick.value) })) };
  });
}

test('combined positioning keeps independent signed bands, shared settings, hit targets and pane identity', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const state = window as any, original = CanvasRenderingContext2D.prototype.fillText;
    state.__netPositioningLabelPaints = [];
    CanvasRenderingContext2D.prototype.fillText = function(text: string, x: number, y: number, ...args: any[]) {
      if (/^\d{3,}$/.test(String(text))) {
        const paints = (window as any).__netPositioningLabelPaints; paints.push({ text: String(text), x, y, color: this.fillStyle });
        if (paints.length > 2000) paints.splice(0, paints.length - 2000);
      }
      return (original as any).call(this, text, x, y, ...args);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  let hostOpen = Math.floor(Date.now() / 60_000) * 60_000;
  await page.context().route('**/market-data/**', async route => {
    const url = new URL(route.request().url()), method = (url.searchParams.get('method') ?? 'price-oi') as Method;
    if (url.pathname.endsWith('/native-candles')) {
      const candles = Array.from({ length: 1_000 }, (_, index) => {
        const t = hostOpen - (999 - index) * 60_000, c = 82_000 + index * .25;
        return { t, o: c - .5, h: c + 1, l: c - 1, c, v: 10 + index % 20, revision: 1, closed: index < 999 };
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'binance-native-kline', candles }) });
    }
    if (url.pathname.endsWith('/footprints')) return route.fulfill({ status: 503, json: { error: 'Explicit fixture: no price-volume profile' } });
    if (!url.pathname.endsWith('/net-positioning')) return route.continue();
    const selected = (url.searchParams.get('venues') ?? 'binance').split(',').filter((venue): venue is Venue => venue === 'binance' || venue === 'hyperliquid');
    const intervals = Array.from({ length: 90 }, (_, age) => Array.from({ length: 2 }, (_, half) => selected.map(venue => fixtureRow(method, venue, hostOpen - age * 60_000, half, age))).flat()).flat();
    const verified = Object.fromEntries(selected.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' }]));
    const feed = { state: 'live', source: 'explicit-playwright-fixture', lastObservedAt: Date.now(), expectedIntervalMs: 30_000, stale: false,
      unitVerification: { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC',
      unitVerification: verified, from: hostOpen - 4 * 60 * 60_000, to: Date.now(), venues: selected, intervals: intervals.flat(), truncated: false,
      feeds: Object.fromEntries(selected.map(venue => [venue, feed])), pendingIntervals: 0,
      history: 'explicit browser fixture; observed intervals only', semantics: 'test-only signed source fixture' }) });
  });

  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  await selectTheme(page, 'dark');
  await expect(panel).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector('.candle-panel'), panels = [...((window as any).__terminal?.panels?.values?.() ?? [])];
    const panel = panels.find((item: any) => item.element === element);
    return panel?.engine?.latestBar && panel.engine.times.includes(panel.engine.latestBar.time);
  });
  hostOpen = await page.evaluate(() => {
    const element = document.querySelector('.candle-panel'), panels = [...(window as any).__terminal.panels.values()];
    return panels.find((item: any) => item.element === element).engine.latestBar.time * 1000;
  });
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('1m');
  await addIndicator(panel, 'Net Longs & Shorts');
  const row = panel.locator(`.active-indicator[data-definition-id="${POSITIONING_ID}"]`);
  const sources = panel.getByRole('group', { name: 'Net Longs & Shorts sources', exact: true });
  await expect(sources.locator('[data-source="binance"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(sources.locator('[data-source="hyperliquid"]')).toHaveAttribute('aria-pressed', 'false');
  await setSources(panel, ['binance', 'hyperliquid']);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes[0]?.candleCount)).toBe(90);
  await expect.poll(() => page.evaluate(id => [...(window as any).__terminal.panels.values()][0].engine.netPositioningPanes.get(id)
    .primitive.diagnostics().venues, POSITIONING_ID)).toEqual(['binance', 'hyperliquid']);

  const initial = await page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), diag = view.primitive.diagnostics();
    const state = window as any;
    state.__netPositioningRefs = { primitive: view.primitive, engine: p.engine, chart: p.engine.chart,
      rebuilds: p.diagnostics().netPositioning.histories.map((history: any) => history.candleRebuilds), request: p.diagnostics().netPositioning.request };
    return { panes: p.engine.netPositioningPanes.size, index: view.paneIndex, bands: diag.renderedBands.map((band: any) => band.side),
      scales: diag.visibleScaleBySide, settings: p.selection.indicators.find((item: any) => item.definitionId === id).settings,
      subscriptionCount: p.feed.protocolDiagnostics().subscriptions.netPositioning,
      rebuilds: p.diagnostics().netPositioning.histories.map((history: any) => history.candleRebuilds), request: p.diagnostics().netPositioning.request };
  }, POSITIONING_ID);
  expect(initial.panes).toBe(1);
  expect(initial.bands).toEqual(['longs', 'shorts']);
  expect(initial.settings).toMatchObject({ showLongs: true, showShorts: true, reverseOrder: false, method: 'price-oi' });
  expect(initial.subscriptionCount).toBe(1);
  expect(initial.scales.longs.min).toBeLessThan(0); expect(initial.scales.longs.max).toBeGreaterThan(0);
  expect(initial.scales.shorts.min).toBeLessThan(0); expect(initial.scales.shorts.max).toBeGreaterThan(0);

  await installAxisGridPaneProbe(page);
  await expect.poll(async () => (await readAxisGridProbe(page)).calls.length).toBeGreaterThan(0);
  const mainGrid = await readAxisGridProbe(page);
  expect(mainGrid.calls.every((call: any) => call.paneIndex === mainGrid.primary)).toBe(true);
  expect(mainGrid.lines.length).toBeGreaterThan(0);
  expect(mainGrid.lines.every((line: any) => Math.abs(line.y - line.expected) <= 1)).toBe(true);
  await page.evaluate(index => {
    const chart = [...(window as any).__terminal.panels.values()][0].engine.chart;
    (window as any).__positioningGridCalls.length = 0; chart.maximizePane(index); chart.invalidate((mask: any) => mask.invalidateGlobal(3));
  }, initial.index);
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizedPane())).toBe(initial.index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const maximizedGrid = await readAxisGridProbe(page);
  expect(maximizedGrid.calls.every((call: any) => call.paneIndex !== initial.index)).toBe(true);
  await page.evaluate(index => {
    const chart = [...(window as any).__terminal.panels.values()][0].engine.chart;
    chart.maximizePane(index); chart.invalidate((mask: any) => mask.invalidateGlobal(3));
  }, initial.index);
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.maximizedPane())).toBe(null);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const restoredGrid = await readAxisGridProbe(page);
  expect(restoredGrid.calls.some((call: any) => call.paneIndex === restoredGrid.primary)).toBe(true);
  expect(restoredGrid.lines.every((line: any) => Math.abs(line.y - line.expected) <= 1)).toBe(true);

  await page.evaluate(() => { (window as any).__netPositioningLabelPaints.length = 0; });
  await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0], i = p.engine.times.indexOf(time / 1000);
    p.engine.setRange({ from: Math.max(0, i - 3), to: i + 1 });
  }, hostOpen);
  await expect.poll(() => page.evaluate(() => (window as any).__netPositioningLabelPaints.some((item: any) => item.text === '155'))).toBe(true);
  const hit = await page.evaluate(({ id, time }) => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), primitive = view.primitive;
    const plot = p.engine.chart.plotRect(view.paneIndex);
    const segment = primitive.geometry.find((item: any) => item.side === 'longs' && item.timeMs === time && item.sourceId === 'binance' && !item.zero
      && item.bottom > item.top && item.right > 0 && item.left < plot.width && item.bottom > 0 && item.top < plot.height);
    if (!segment) return null;
    const x = (Math.max(0, segment.left) + Math.min(plot.width, segment.right)) / 2;
    const y = (Math.max(0, segment.top) + Math.min(plot.height, segment.bottom)) / 2;
    return { hit: primitive.hitTest(x, y, {}), tooltip: primitive.tooltip(time), x: plot.left + x, y: plot.top + y };
  }, { id: POSITIONING_ID, time: hostOpen });
  expect(hit).not.toBeNull(); expect(hit?.hit?.hoverKey).toContain('longs:binance'); expect(hit?.tooltip).toContain('Binance · BTCUSDT USD-M Perp longs segment');

  const stage = await panel.locator('.chart-stage').boundingBox();
  expect(stage).not.toBeNull();
  await page.mouse.move(stage!.x + hit!.x, stage!.y + hit!.y);
  const card = panel.locator('.net-positioning-tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Net Longs (Est.)');
  await expect(card).toContainText('BN[P]'); await expect(card).toContainText('HL[P]');
  await expect(card).toContainText('Total (2 venues)');
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('BTC');
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('USDT');
  const bounds = await card.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(stage!.x); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
  await page.screenshot({ path: '/tmp/net-positioning-tooltip-dark.png' });
  await selectTheme(page, 'light'); await page.screenshot({ path: '/tmp/net-positioning-tooltip-light.png' });
  await selectTheme(page, 'dark'); await page.mouse.move(0, 0); await expect(card).toBeHidden();

  await openGlobalSettings(page);
  const global = page.getByRole('dialog', { name: 'Global settings', exact: true });
  await global.getByLabel('Default display currency').selectOption('quote');
  await global.getByLabel('Override indicator currencies').check();
  await global.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.netPositioningDiagnostics().map((view: any) => view.currency))).toEqual(['usdt']);
  const quoteView = await page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), refs = (window as any).__netPositioningRefs;
    return { scale: view.primitive.diagnostics().visibleScaleBySide.longs,
      samePrimitive: view.primitive === refs.primitive, sameEngine: p.engine === refs.engine, sameChart: p.engine.chart === refs.chart };
  }, POSITIONING_ID);
  expect(quoteView.scale.max).toBeGreaterThan(5_000_000);
  expect(quoteView.samePrimitive).toBe(true); expect(quoteView.sameEngine).toBe(true); expect(quoteView.sameChart).toBe(true);
  const quoteHit = await page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), plot = p.engine.chart.plotRect(view.paneIndex);
    const segment = view.primitive.geometry.find((item: any) => item.side === 'longs' && item.sourceId === 'binance' && item.bottom > item.top
      && item.right > 0 && item.left < plot.width && item.bottom > 0 && item.top < plot.height);
    return segment ? { x: plot.left + (Math.max(0, segment.left) + Math.min(plot.width, segment.right)) / 2,
      y: plot.top + (Math.max(0, segment.top) + Math.min(plot.height, segment.bottom)) / 2 } : null;
  }, POSITIONING_ID);
  expect(quoteHit).not.toBeNull(); await page.mouse.move(stage!.x + quoteHit!.x, stage!.y + quoteHit!.y);
  await expect(card).toBeVisible(); await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('USDT');
  await expect(card.locator('.positioning-tooltip-secondary').first()).toContainText('BTC');
  await page.screenshot({ path: '/tmp/net-positioning-quote-hover.png' });
  await page.mouse.move(0, 0); await openGlobalSettings(page); await global.getByLabel('Override indicator currencies').uncheck();
  await global.getByRole('button', { name: 'Apply', exact: true }).click();

  const settings = await openSettings(panel);
  await expect(settings.getByLabel('Estimation inputs')).toHaveValue('price-oi');
  await expect(settings.getByLabel('Display mode')).toHaveValue('stacked');
  await expect(settings.getByLabel('Value labels')).toHaveValue('auto');
  await expect(settings.getByLabel('Show Longs')).toBeChecked(); await expect(settings.getByLabel('Show Shorts')).toBeChecked();
  await expect(settings.getByLabel('Reverse order')).not.toBeChecked();
  await settings.getByLabel('Display mode').selectOption('grouped');
  await settings.getByLabel('Value labels').selectOption('off');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), diag = view.primitive.diagnostics();
    return { display: diag.display, labels: diag.labels, bands: diag.renderedBands.map((band: any) => band.side), venues: diag.venues };
  }, POSITIONING_ID)).toEqual({ display: 'grouped', labels: 'off', bands: ['longs', 'shorts'], venues: ['binance', 'hyperliquid'] });
  const afterSettings = await page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id), refs = (window as any).__netPositioningRefs;
    return { sameEngine: p.engine === refs.engine, sameChart: p.engine.chart === refs.chart, samePrimitive: view.primitive === refs.primitive,
      rebuilds: p.diagnostics().netPositioning.histories.map((history: any) => history.candleRebuilds), request: p.diagnostics().netPositioning.request };
  }, POSITIONING_ID);
  expect(afterSettings.sameEngine).toBe(true); expect(afterSettings.sameChart).toBe(true); expect(afterSettings.samePrimitive).toBe(true);
  expect(afterSettings.rebuilds).toEqual(initial.rebuilds);
  expect(afterSettings.request).toBe(initial.request);

  const rollover = await page.evaluate(({ id, time }) => {
    const terminal = (window as any).__terminal, p = [...terminal.panels.values()][0], engine = p.engine, nextTime = time + 60_000;
    const nextBar = { t: nextTime, o: engine.latestBar.open, h: engine.latestBar.high + 1, l: engine.latestBar.low, c: engine.latestBar.close + .5, v: 1, revision: 1, closed: false };
    engine.applyPatch([nextBar]);
    const history = p.netPositioningHistories.get('price-oi'), previous = [...history.intervals.values()].find((row: any) => row.venue === 'binance');
    const end = nextTime + 30_000, provenance = { ...previous.provenance,
      openInterestStart: { ...previous.provenance.openInterestEnd, sourceTimeMs: end - 30_000 }, openInterestEnd: { ...previous.provenance.openInterestEnd, sourceTimeMs: end },
      priceStart: { ...previous.provenance.priceEnd, sourceTimeMs: end - 30_000 }, priceEnd: { ...previous.provenance.priceEnd, sourceTimeMs: end },
      tradeCoverage: { fromMs: end - 30_000, toMs: end, complete: true, gap: false } };
    const row = { ...previous, version: previous.version + 1, startTimeMs: end - 30_000, endTimeMs: end, attributionTimeMs: end,
      direction: 1, oiDeltaBtcDecimal: '15', netLongsBtcDecimal: '13', netShortsBtcDecimal: '2', unclassifiedBtcDecimal: '0', provenance };
    const changed = history.apply({ ...history.metadata(), from: end - 4 * 60 * 60_000, to: end, intervals: [row] }, [row], ['binance', 'hyperliquid']);
    p.renderNetPositioningMethod('price-oi', changed, false);
    engine.setRange({ from: engine.times.length - 34, to: engine.times.length });
    return { time: nextTime, tooltip: engine.netPositioningTooltip(id, nextTime), latest: engine.latestBar.time * 1000 };
  }, { id: POSITIONING_ID, time: hostOpen });
  expect(rollover.latest).toBe(rollover.time); expect(rollover.tooltip).toContain('Net longs +13 BTC');
  const identity = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], refs = (window as any).__netPositioningRefs;
    return { sameEngine: p.engine === refs.engine, sameChart: p.engine.chart === refs.chart, panes: p.engine.netPositioningPanes.size };
  });
  expect(identity).toEqual({ sameEngine: true, sameChart: true, panes: 1 });
  await page.screenshot({ path: '/tmp/net-positioning-display-regression.png' });
  await page.evaluate(() => { for (const p of (window as any).__terminal.panels.values()) if (!p.objectTreeSidebarPreferences.collapsed) p.toggleObjectsPanel(); });
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(sources.locator('button')).toHaveCount(3);
  expect((await sources.boundingBox())!.width).toBeGreaterThanOrEqual(46);
  await page.screenshot({ path: '/tmp/net-positioning-toggles-narrow-dark.png' });
  await selectTheme(page, 'light'); await page.screenshot({ path: '/tmp/net-positioning-toggles-narrow-light.png' });
  expect(errors).toEqual([]);
});

test('empty chart and combined positioning pane show loading, ready, empty and error states', async ({ page }) => {
  test.setTimeout(90_000);
  let releaseData!: () => void;
  const gate = new Promise<void>(resolve => { releaseData = resolve; });
  let mode: 'ready' | 'empty' | 'error' = 'ready', hostOpen = Math.floor(Date.now() / 60_000) * 60_000;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class DelayedCandles extends NativeWorker {
      set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        const worker = this, held: MessageEvent[] = [], state = window as any;
        state.__releaseLoadingCandles = () => { state.__loadingCandlesReleased = true; for (const event of held.splice(0)) handler?.call(worker, event); };
        super.onmessage = handler && function(event) {
          if (['snapshot', 'status'].includes(event.data?.type) && !state.__loadingCandlesReleased) { held.push(event); return; }
          handler.call(worker, event);
        };
      }
      get onmessage() { return super.onmessage; }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: DelayedCandles });
  });
  await page.route('**/market-data/v1/net-positioning*', async route => {
    await gate;
    if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Position source unavailable' }) });
    const url = new URL(route.request().url()), method = (url.searchParams.get('method') ?? 'price-oi') as Method;
    const venues = (url.searchParams.get('venues') ?? 'binance').split(',') as Venue[];
    const intervals = mode === 'empty' ? [] : venues.map(venue => fixtureRow(method, venue, hostOpen, 1, 0));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues,
      from: hostOpen - 3_600_000, to: Date.now(), unitVerification: {}, feeds: {}, intervals, truncated: false, pendingIntervals: 0,
      history: 'explicit loading fixture', semantics: 'explicit loading fixture' }) });
  });
  await page.route('**/market-data/v1/native-candles*', async route => {
    const candles = Array.from({ length: 1_000 }, (_, index) => ({ t: hostOpen - (999 - index) * 60_000, o: 82_000, h: 82_002, l: 81_998, c: 82_001, v: 10, revision: 1, closed: index < 999 }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'binance-native-kline', candles }) });
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  const main = panel.locator('.pane-data-state[data-instance-id="@price"]');
  await expect(main).toBeVisible(); await expect(main).toHaveAttribute('aria-busy', 'true');
  await addIndicator(panel, 'Net Longs & Shorts');
  const positioning = panel.locator(`.pane-data-state[data-instance-id="${POSITIONING_ID}"]`);
  await expect(positioning).toBeVisible();
  await expect(positioning).toContainText('Waiting for Net Longs & Shorts data…');
  expect(await positioning.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await positioning.locator('i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('pane-signal');
  await selectTheme(page, 'dark'); await page.screenshot({ path: '/tmp/pane-loading-dark.png' });
  await selectTheme(page, 'light'); await page.setViewportSize({ width: 720, height: 900 });
  await page.screenshot({ path: '/tmp/pane-loading-light-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await positioning.locator('i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.evaluate(() => (window as any).__releaseLoadingCandles()); await expect(main).toBeHidden();
  hostOpen = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.latestBar.time * 1000);
  releaseData(); await expect(positioning).toBeHidden();
  mode = 'empty'; await page.reload(); await page.evaluate(() => (window as any).__releaseLoadingCandles());
  await expect(positioning).toBeVisible(); await expect(positioning).toHaveAttribute('data-state', 'empty');
  await expect(positioning).toHaveAttribute('aria-busy', 'false'); await expect(positioning).toContainText('Waiting for estimates…');
  mode = 'error'; await page.reload(); await page.evaluate(() => (window as any).__releaseLoadingCandles());
  await expect(positioning).toBeVisible(); await expect(positioning).toHaveAttribute('data-state', 'error');
  await expect(positioning).toHaveAttribute('aria-busy', 'false');
  expect(errors).toEqual([]);
});

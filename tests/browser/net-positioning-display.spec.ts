import { expect, test, type Page } from '@playwright/test';

type Venue = 'binance' | 'hyperliquid';
type Method = 'price-oi' | 'aggressor-flow-oi';

function fixtureRow(method: Method, venue: Venue, open: number, half: number, age: number) {
  const end = open + half * 30_000, start = end - 30_000;
  let longs: number, shorts: number;
  if (age === 0) {
    longs = venue === 'binance' ? (half === 0 ? 120 : 35) : -45 - half * 8;
    shorts = venue === 'binance' ? (half === 0 ? -80 : -25) : 20 + half * 15;
  } else if (age === 1) { longs = 0; shorts = 0; }
  else if (age === 3 && venue === 'binance' && half === 1) return {
    version: 1, method, status: 'unavailable', reason: 'fixture gap', venue, market: 'perpetual', nativeSymbol: venue === 'binance' ? 'BTCUSDT' : 'BTC', units: 'BTC',
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

async function setSettings(panel: ReturnType<Page['locator']>, id: string, side: 'Longs' | 'Shorts', display: 'stacked' | 'grouped', labels: 'auto' | 'hover' | 'off', method: Method) {
  await panel.locator(`.active-indicator[data-definition-id="${id}"]`).getByRole('button', { name: `Net ${side} — Estimated settings`, exact: true }).click();
  const dialog = panel.locator('.net-positioning-settings');
  await dialog.getByLabel('Estimation inputs').selectOption(method);
  await dialog.getByLabel('Display mode').selectOption(display);
  await dialog.getByLabel('Value labels').selectOption(labels);
  await dialog.locator('input[type="checkbox"][value="binance"]').check();
  await dialog.locator('input[type="checkbox"][value="hyperliquid"]').check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function expectSettings(panel: ReturnType<Page['locator']>, id: string, side: 'Longs' | 'Shorts', expected: { method: Method; display: 'stacked' | 'grouped'; labels: 'auto' | 'hover' | 'off'; venues: Venue[] }) {
  await panel.locator(`.active-indicator[data-definition-id="${id}"]`).getByRole('button', { name: `Net ${side} — Estimated settings`, exact: true }).click();
  const dialog = panel.locator('.net-positioning-settings');
  await expect(dialog.getByLabel('Estimation inputs')).toHaveValue(expected.method);
  await expect(dialog.getByLabel('Display mode')).toHaveValue(expected.display);
  await expect(dialog.getByLabel('Value labels')).toHaveValue(expected.labels);
  expect(await dialog.locator('input[type="checkbox"]:checked').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(expected.venues);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

test('estimated positioning keeps signed source stacks, settings, hit targets and live pane identity', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  // Seed only the standalone candle-route fixture. Net-positioning rows are
  // generated after reading the chart's loaded last candle below.
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
    if (!url.pathname.endsWith('/net-positioning')) return route.continue();
    const selected = (url.searchParams.get('venues') ?? 'binance,hyperliquid').split(',').filter((venue): venue is Venue => venue === 'binance' || venue === 'hyperliquid');
    const intervals = Array.from({ length: 90 }, (_, age) => Array.from({ length: 2 }, (_, half) => selected.map(venue => fixtureRow(method, venue, hostOpen - age * 60_000, half, age))).flat()).flat();
    const verified = Object.fromEntries(selected.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' }]));
    const feed = { state: 'live', source: 'explicit-playwright-fixture', lastObservedAt: Date.now(), expectedIntervalMs: 30_000, stale: false,
      unitVerification: { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' } };
    requests.push(`${method}:${selected.join(',')}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC',
      unitVerification: verified, from: hostOpen - 4 * 60 * 60_000, to: Date.now(), venues: selected, intervals, truncated: false,
      feeds: Object.fromEntries(selected.map(venue => [venue, feed])), pendingIntervals: 0,
      history: 'explicit browser fixture; observed intervals only', semantics: 'test-only signed source fixture' }) });
  });

  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
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
  const longsId = 'native.net-longs-estimated', shortsId = 'native.net-shorts-estimated';
  await addIndicator(panel, 'Net Longs — Estimated');
  await addIndicator(panel, 'Net Shorts — Estimated');
  await setSettings(panel, longsId, 'Longs', 'stacked', 'auto', 'price-oi');
  await setSettings(panel, shortsId, 'Shorts', 'stacked', 'hover', 'aggressor-flow-oi');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes.map((pane: any) => pane.candleCount))).toEqual([90, 90]);
  const alignment = await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0], index = p.engine.times.indexOf(time / 1000);
    p.engine.setRange({ from: Math.max(0, index - 34), to: index + 1 }); return { time, index, range: p.engine.visibleRange() };
  }, hostOpen);
  expect(alignment.index).toBeGreaterThanOrEqual(0);

  const tooltip = (id: string, time: number) => page.evaluate(({ id, time }) => ([...(window as any).__terminal.panels.values()][0] as any).engine.netPositioningTooltip(id, time), { id, time });
  await expect.poll(() => tooltip(longsId, hostOpen)).toContain('positive +155 BTC');
  expect(await tooltip(longsId, hostOpen)).toContain('negative −98 BTC');
  expect(await tooltip(longsId, hostOpen - 60_000)).toContain('positive 0 BTC');
  expect(await tooltip(longsId, hostOpen - 3 * 60_000)).toContain('1/2 source intervals available');
  expect(await tooltip(longsId, hostOpen - 4 * 60_000)).toContain('Hyperliquid · BTC Perp');

  await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0];
    const engine = p.engine, index = engine.times.indexOf(time / 1000), spike = index - 60;
    engine.setRange({ from: Math.max(0, index - 34), to: index + 1 });
    (window as any).__netPositioningRefs = { engine, chart: engine.chart,
      primitives: ['native.net-longs-estimated', 'native.net-shorts-estimated'].map(id => engine.netPositioningPanes.get(id).primitive), indices: [1, 2],
      rebuilds: p.diagnostics().netPositioning.histories.map((history: any) => history.candleRebuilds), request: p.diagnostics().netPositioning.request };
    (window as any).__spikeIndex = spike;
  }, hostOpen);
  const before = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0]; return p.engine.netPositioningDiagnostics().map((pane: any) => pane.visibleScaleMaxBtc);
  });
  expect(before.every((value: number) => value < 2_000)).toBe(true);
  const spikeRange = await page.evaluate(() => { const p = [...(window as any).__terminal.panels.values()][0], i = (window as any).__spikeIndex, outlier = p.netPositioningHistories.get('price-oi').snapshot().find((c: any) => c.venues.binance?.netLongsBtc === 2_000); p.engine.setRange({ from: Math.max(0, i - 2), to: i + 3 }); return { requestedIndex: i, sourceIndex: outlier ? p.engine.times.indexOf(outlier.timeMs / 1000) : -1 }; });
  expect(spikeRange.sourceIndex).toBeGreaterThanOrEqual(spikeRange.requestedIndex - 2);
  expect(spikeRange.sourceIndex).toBeLessThan(spikeRange.requestedIndex + 3);
  await page.waitForTimeout(150);
  await expect.poll(() => page.evaluate(() => Math.max(...[...(window as any).__terminal.panels.values()][0].engine.netPositioningDiagnostics().map((pane: any) => pane.visibleScaleMaxBtc)))).toBeGreaterThanOrEqual(2_000);
  await page.evaluate(time => { const p = [...(window as any).__terminal.panels.values()][0], i = p.engine.times.indexOf(time / 1000); p.engine.setRange({ from: Math.max(0, i - 34), to: i + 1 }); }, hostOpen);

  await page.waitForTimeout(120);
  const hit = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], primitive = p.engine.netPositioningPanes.get('native.net-longs-estimated').primitive;
    const plot = p.engine.chart.plotRect(p.engine.netPositioningPaneIndex('native.net-longs-estimated'));
    const segment = primitive.geometry.find((item: any) => item.sourceId === 'binance' && !item.zero && item.bottom > item.top
      && item.right > 0 && item.left < plot.width && item.bottom > 0 && item.top < plot.height);
    if (!segment) return null;
    const x = (Math.max(0, segment.left) + Math.min(plot.width, segment.right)) / 2;
    const y = (Math.max(0, segment.top) + Math.min(plot.height, segment.bottom)) / 2;
    const result = primitive.hitTest(x, y, {});
    return { result, tooltip: primitive.tooltip(segment.timeMs) };
  });
  expect(hit).not.toBeNull(); expect(hit?.result?.hoverKey).toContain('binance'); expect(hit?.tooltip).toContain('Binance · BTCUSDT USD-M Perp segment');

  const longRow = panel.locator(`.active-indicator[data-definition-id="${longsId}"]`);
  await setSettings(panel, longsId, 'Longs', 'grouped', 'off', 'price-oi');
  await expectSettings(panel, longsId, 'Longs', { method: 'price-oi', display: 'grouped', labels: 'off', venues: ['binance', 'hyperliquid'] });
  const after = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], before = (window as any).__netPositioningRefs;
    return { stable: before.engine === p.engine && before.chart === p.engine.chart && before.primitives.every((primitive: any, i: number) => primitive === p.engine.netPositioningPanes.get(i ? 'native.net-shorts-estimated' : 'native.net-longs-estimated').primitive),
      indices: [p.engine.netPositioningPaneIndex('native.net-longs-estimated'), p.engine.netPositioningPaneIndex('native.net-shorts-estimated')],
      rebuilds: p.diagnostics().netPositioning.histories.map((history: any) => history.candleRebuilds), request: p.diagnostics().netPositioning.request };
  });
  expect(after.stable).toBe(true); expect(after.indices).toEqual([1, 2]);
  expect(after.rebuilds).toEqual(await page.evaluate(() => (window as any).__netPositioningRefs.rebuilds));
  expect(after.request).toBe(await page.evaluate(() => (window as any).__netPositioningRefs.request));

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes.length)).toBe(2);
  await expectSettings(panel, longsId, 'Longs', { method: 'price-oi', display: 'grouped', labels: 'off', venues: ['binance', 'hyperliquid'] });
  await panel.locator(`.active-indicator[data-definition-id="${longsId}"]`).getByRole('button', { name: 'Remove Net Longs — Estimated', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes.length)).toBe(1);
  await addIndicator(panel, 'Net Longs — Estimated');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes.length)).toBe(2);
  await expectSettings(panel, longsId, 'Longs', { method: 'price-oi', display: 'stacked', labels: 'auto', venues: ['binance'] });

  const rollover = await page.evaluate(() => {
    const terminal = (window as any).__terminal, p = [...terminal.panels.values()][0], engine = p.engine, old = engine.latestBar.time * 1000, nextTime = old + 60_000;
    (window as any).__rolloverIdentity = { panelId: p.params.api.id, engine, chart: engine.chart };
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
    return { time: nextTime, tooltip: engine.netPositioningTooltip('native.net-longs-estimated', nextTime), latest: engine.latestBar.time * 1000 };
  });
  expect(rollover.latest).toBe(rollover.time); expect(rollover.tooltip).toContain('Net longs +13 BTC');
  const rolloverIdentity = await page.evaluate(() => {
    const terminal = (window as any).__terminal, refs = (window as any).__rolloverIdentity;
    const panel = [...terminal.panels.values()].find((item: any) => item.params.api.id === refs.panelId);
    return { sameEngine: panel?.engine === refs.engine, sameChart: panel?.engine?.chart === refs.chart };
  });
  expect(rolloverIdentity).toEqual({ sameEngine: true, sameChart: true });
  await page.screenshot({ path: 'artifacts/net-positioning/display-fixture-regression-1366x768.png' });
  expect(errors).toEqual([]);
});

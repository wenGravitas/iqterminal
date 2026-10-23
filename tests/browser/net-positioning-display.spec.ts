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
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const sources = panel.getByRole('group', { name: `Net ${side} sources`, exact: true });
  for (const venue of ['binance', 'hyperliquid']) {
    const button = sources.locator(`[data-source="${venue}"]`);
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}

async function expectSettings(panel: ReturnType<Page['locator']>, id: string, side: 'Longs' | 'Shorts', expected: { method: Method; display: 'stacked' | 'grouped'; labels: 'auto' | 'hover' | 'off'; venues: Venue[] }) {
  await panel.locator(`.active-indicator[data-definition-id="${id}"]`).getByRole('button', { name: `Net ${side} — Estimated settings`, exact: true }).click();
  const dialog = panel.locator('.net-positioning-settings');
  await expect(dialog.getByLabel('Estimation inputs')).toHaveValue(expected.method);
  await expect(dialog.getByLabel('Display mode')).toHaveValue(expected.display);
  await expect(dialog.getByLabel('Value labels')).toHaveValue(expected.labels);
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);
  const sources = panel.getByRole('group', { name: `Net ${side} sources`, exact: true });
  expect(await sources.locator('[aria-pressed="true"]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.source))).toEqual(expected.venues);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

test('estimated positioning keeps signed source stacks, settings, hit targets and live pane identity', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
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

  // Capture a wide-bar view: amounts sit outside both signed stacks.
  await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0], i = p.engine.times.indexOf(time / 1000);
    p.engine.setRange({ from: i - 3, to: i + 1 });
  }, hostOpen);
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/net-positioning-outside-labels.png' });
  await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0], i = p.engine.times.indexOf(time / 1000);
    p.engine.setRange({ from: Math.max(0, i - 34), to: i + 1 });
  }, hostOpen);

  const tooltip = (id: string, time: number) => page.evaluate(({ id, time }) => ([...(window as any).__terminal.panels.values()][0] as any).engine.netPositioningTooltip(id, time), { id, time });
  await expect.poll(() => tooltip(longsId, hostOpen)).toContain('positive +155 BTC');
  await expect.poll(() => tooltip(longsId, hostOpen)).toContain('negative −98 BTC');
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
    return { result, tooltip: primitive.tooltip(segment.timeMs), x: plot.left + x, y: plot.top + y };
  });
  expect(hit).not.toBeNull(); expect(hit?.result?.hoverKey).toContain('binance'); expect(hit?.tooltip).toContain('Binance · BTCUSDT USD-M Perp segment');

  const stage = await panel.locator('.chart-stage').boundingBox();
  expect(stage).not.toBeNull();
  await page.mouse.move(stage!.x + hit!.x, stage!.y + hit!.y);
  const card = panel.locator('.net-positioning-tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Net Longs (Est.)');
  await expect(card).toContainText('Binance Perp');
  await expect(card).toContainText('Hyperliquid Perp');
  await expect(card).toContainText('Total (2 venues)');
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('BTC');
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('USDT');
  const bounds = await card.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(stage!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
  await page.evaluate(() => { const select = document.querySelector<HTMLSelectElement>('#theme')!; select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.screenshot({ path: '/tmp/net-positioning-tooltip-dark.png' });
  await page.evaluate(() => { const select = document.querySelector<HTMLSelectElement>('#theme')!; select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.screenshot({ path: '/tmp/net-positioning-tooltip-light.png' });
  await page.evaluate(() => { const select = document.querySelector<HTMLSelectElement>('#theme')!; select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  // Currency is a display projection: the same chart, source request and BTC history survive.
  await page.getByRole('button', { name: 'Global settings', exact: true }).click();
  const global = page.getByRole('dialog', { name: 'Global settings', exact: true });
  await expect(global.getByLabel('Default display currency')).toHaveValue('quote');
  await global.getByLabel('Override indicator currencies').check();
  await global.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.netPositioningDiagnostics().map((p:any) => p.currency))).toEqual(['usdt', 'usdt']);
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get('native.net-longs-estimated');
    const range = view.series.priceScale().priceRange(), extent = view.primitive.autoscaleInfo();
    return !!extent && range.min <= extent.min && range.max >= extent.max;
  })).toBe(true);
  const quoteHit = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get('native.net-longs-estimated');
    const plot = p.engine.chart.plotRect(view.paneIndex);
    const segment = view.primitive.geometry.find((s:any) => s.sourceId === 'binance' && s.bottom > s.top && s.right > 0 && s.left < plot.width && s.bottom > 0 && s.top < plot.height);
    return segment ? { x: plot.left + (Math.max(0, segment.left) + Math.min(plot.width, segment.right))/2, y: plot.top + (Math.max(0, segment.top)+Math.min(plot.height,segment.bottom))/2 } : null;
  });
  expect(quoteHit).not.toBeNull();
  await page.mouse.move(stage!.x + quoteHit!.x, stage!.y + quoteHit!.y);
  await expect(card).toBeVisible();
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('USDT');
  await expect(card.locator('.positioning-tooltip-secondary').first()).toContainText('BTC');
  await page.screenshot({ path: '/tmp/net-positioning-quote-hover.png' });
  await page.getByRole('button', { name: 'Global settings', exact: true }).click();
  await global.getByLabel('Override indicator currencies').uncheck();
  await global.getByRole('button', { name: 'Apply', exact: true }).click();

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

  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    p.engine.chart.movePane(p.engine.netPositioningPaneIndex('native.net-shorts-estimated'), -1);
  });
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    const saved = JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return saved.layout.panels[p.params.api.id].params.paneOrder;
  })).toEqual(['@price', shortsId, longsId]);
  const longSources = panel.getByRole('group', { name: 'Net Longs sources', exact: true });
  await longSources.locator('[data-source="binance"]').click();
  await longSources.locator('[data-source="hyperliquid"]').focus();
  await page.keyboard.press('Space');
  await expect(longSources.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(panel.getByRole('group', { name: 'Net Shorts sources', exact: true }).locator('[aria-pressed="true"]')).toHaveCount(2);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].netPositioning.panes.length)).toBe(2);
  await expect(longSources.locator('[aria-pressed="true"]')).toHaveCount(0);
  await longSources.locator('[data-source="binance"]').click();
  await longSources.locator('[data-source="hyperliquid"]').click();
  expect(await longSources.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return [p.engine.netPositioningPaneIndex('native.net-longs-estimated'), p.engine.netPositioningPaneIndex('native.net-shorts-estimated')];
  })).toEqual([2, 1]);
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
  await page.screenshot({ path: '/tmp/net-positioning-display-regression.png' });
  await page.evaluate(() => { for (const p of (window as any).__terminal.panels.values()) if (!p.objectTreeSidebarPreferences.collapsed) p.toggleObjectsPanel(); });
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(panel.getByRole('group', { name: 'Net Longs sources', exact: true }).locator('button')).toHaveCount(2);
  await page.screenshot({ path: '/tmp/net-positioning-toggles-narrow-dark.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.screenshot({ path: '/tmp/net-positioning-toggles-narrow-light.png' });
  expect(errors).toEqual([]);
});

test('empty chart and positioning panes show loading feedback, then ready, empty and error states', async ({ page }) => {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', venues,
      from: hostOpen - 3_600_000, to: Date.now(), unitVerification: {}, feeds: {}, intervals, truncated: false, pendingIntervals: 0, history: 'explicit loading fixture', semantics: 'explicit loading fixture' }) });
  });
  await page.route('**/market-data/v1/native-candles*', async route => {
    const candles = Array.from({ length: 1000 }, (_, index) => ({ t: hostOpen - (999 - index) * 60_000, o: 82_000, h: 82_002, l: 81_998, c: 82_001, v: 10, revision: 1, closed: index < 999 }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'binance-native-kline', candles }) });
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  const main = panel.locator('.pane-data-state[data-instance-id="@price"]');
  await expect(main).toBeVisible(); await expect(main).toHaveAttribute('aria-busy', 'true');
  await addIndicator(panel, 'Net Longs — Estimated'); await addIndicator(panel, 'Net Shorts — Estimated');
  const longs = panel.locator('.pane-data-state[data-instance-id="native.net-longs-estimated"]');
  const shorts = panel.locator('.pane-data-state[data-instance-id="native.net-shorts-estimated"]');
  await expect(longs).toBeVisible(); await expect(shorts).toBeVisible();
  await expect(longs).toContainText('Loading Net Longs');
  expect(await longs.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await longs.locator('i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('pane-signal');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.screenshot({ path: '/tmp/pane-loading-dark.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.screenshot({ path: '/tmp/pane-loading-light-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await longs.locator('i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.evaluate(() => (window as any).__releaseLoadingCandles());
  await expect(main).toBeHidden();
  hostOpen = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.latestBar.time * 1000);
  releaseData();
  await expect(longs).toBeHidden(); await expect(shorts).toBeHidden();
  mode = 'empty'; await page.reload(); await page.evaluate(() => (window as any).__releaseLoadingCandles());
  await expect(longs).toBeVisible(); await expect(longs).toHaveAttribute('data-state', 'empty');
  await expect(longs).toHaveAttribute('aria-busy', 'false'); await expect(longs).toContainText('No recorded estimates');
  mode = 'error'; await page.reload(); await page.evaluate(() => (window as any).__releaseLoadingCandles());
  await expect(longs).toBeVisible(); await expect(longs).toHaveAttribute('data-state', 'error');
  await expect(longs).toHaveAttribute('aria-busy', 'false');
  expect(errors).toEqual([]);
});

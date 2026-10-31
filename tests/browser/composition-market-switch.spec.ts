import { expect, test } from '@playwright/test';
import { addIndicator, chooseChartMarket } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('Binance perpetual to Hyperliquid retains native CVD and OI history and recovers the saved SMA', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');

  const closeTree = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await closeTree.isVisible()) await closeTree.click();
  await addIndicator(panel, 'Multi-Venue CVD');
  await addIndicator(panel, 'Open Interest');
  const cvdRow = panel.locator('.active-indicator[data-definition-id="native.multi-venue-cvd"]');
  const oiRow = panel.locator('.active-indicator[data-definition-id="native.raw-open-interest"]');
  await expect(cvdRow).toBeVisible();
  await expect(oiRow).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).cvdData.demandDiagnostics().subscribed, panelId)).toBe(true);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics().subscribed, panelId)).toBe(true);

  // Fixtures are explicitly selected with ?fixture=1 and supplied once. The
  // switch below must recover from the worker/controller caches without a
  // second fixture injection.
  await page.evaluate(() => {
    const now = Date.now(), step = 60_000, to = Math.floor(now / step) * step + step;
    const from = to - 60 * step;
    const buckets = (sourceIndex: number) => Array.from({ length: 60 }, (_, index) => ({
      time: from + index * step, base: (sourceIndex + 1) * (index + 1),
      quote: (sourceIndex + 1) * (index + 1) * 100_000, revision: 1,
    }));
    for (const [sourceIndex, source] of ['binance:spot', 'binance:perpetual'].entries()) {
      (window as any).__terminal.feed.send({ type: 'cvd-fixture', source, payload: {
        version: 1, source: `${source}:BTCUSDT`, stepMs: step, from, to, revision: 1, snapshot: true,
        watermark: to, baseUnit: 'BTC', quoteUnit: 'USDT', buckets: buckets(sourceIndex),
        coverage: { from, to, gaps: [] }, status: 'live', asOf: now,
      } });
    }
    const venues = ['binance', 'hyperliquid', 'bybit'];
    const unitVerification = Object.fromEntries(venues.map(venue => [venue, {
      status: 'verified', units: 'BTC', evidence: 'explicit browser recorder fixture',
    }]));
    const feeds = Object.fromEntries(venues.map(venue => [venue, { state: 'ready', source: `${venue} recorder fixture`,
      lastObservedAt: now - 30_000, expectedIntervalMs: 30_000, stale: false, unitVerification: unitVerification[venue] }]));
    const observations = venues.flatMap((venue, venueIndex) => Array.from({ length: 20 }, (_, index) => {
      const sourceTimeMs = Math.floor(now / 30_000) * 30_000 - 10 * 60_000 + index * 30_000;
      const value = 100 + venueIndex * 50 + index;
      return { venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT',
        sourceTimeMs, observedAtMs: sourceTimeMs + 500, epoch: 1, value, valueDecimal: String(value), units: 'BTC',
        source: `${venue} recorder fixture`, sourceTimeQuality: 'collector-sampled', quality: 'valid', gapBefore: false };
    }));
    (window as any).__terminal.feed.send({ type: 'raw-open-interest-fixture', payload: {
      version: 1, market: 'perpetual', nativeSymbol: 'BTC', semantics: 'observed-open-interest-level', units: 'BTC',
      from: now - 4 * 60 * 60_000, to: now, asOfMs: now, venues, unitVerification, observations,
      truncated: false, invalidRows: 0, expectedIntervalMs: 30_000, retentionDays: 7, feeds,
      history: 'Explicit browser fixture: persisted raw perpetual OI records.',
    } });
  });
  const read = () => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const indicators = current.selection.indicators;
    const cvd = indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const oi = indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const sma = indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const cvdOutput = current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`);
    const oiOutput = current.outputRegistry.get(`output:${oi.instanceId}:openInterestTotalBtc`);
    const smaOutput = sma && current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    const consumer = sma && current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === sma.instanceId);
    const times = current.candles.map((candle: any) => candle.t);
    const timelineMatches = (output: any) => Boolean(output && output.times.length === times.length
      && output.times.every((time: number, index: number) => time === times[index]));
    return {
      market: { venue: current.selection.venue, market: current.selection.market },
      bars: times.length, candles: { first: times[0], last: times.at(-1) },
      cvd: cvdOutput && { available: cvdOutput.available, contextId: cvdOutput.contextId, contextRevision: cvdOutput.contextRevision,
        valueCount: cvdOutput.values.length, nonNull: cvdOutput.values.filter((value: number | null) => value !== null).length,
        tail: cvdOutput.values.slice(-4), timelineMatches: timelineMatches(cvdOutput) },
      cvdData: current.cvdData.demandDiagnostics(),
      oi: oiOutput && { available: oiOutput.available, contextId: oiOutput.contextId, contextRevision: oiOutput.contextRevision,
        valueCount: oiOutput.values.length, nonNull: oiOutput.values.filter((value: number | null) => value !== null).length,
        tail: oiOutput.values.slice(-4), timelineMatches: timelineMatches(oiOutput) },
      oiData: current.openInterestData.diagnostics(),
      sma: sma && { instanceId: sma.instanceId, ref: sma.numericInputs?.source, settings: sma.settings },
      smaOutput: smaOutput && { available: smaOutput.available, valueCount: smaOutput.values.length,
        nonNull: smaOutput.values.filter((value: number | null) => value !== null).length,
        timelineMatches: timelineMatches(smaOutput) },
      consumer: consumer && { current: consumer.current, completedRevision: consumer.completedRevision,
        completedContextRevision: consumer.completedContextRevision },
    };
  }, panelId);
  await expect.poll(async () => {
    const state = await read();
    return Boolean(state.cvd?.available && state.oi?.available && state.cvd?.nonNull && state.oi?.nonNull);
  }).toBe(true);

  const firstOiOutputId = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), oi = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    return `output:${oi.instanceId}:openInterestTotalBtc`;
  }, panelId);
  await oiRow.getByRole('button', { name: 'Add moving average to Open Interest', exact: true }).click();
  const smaDialog = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await smaDialog.getByLabel('Indicator output').selectOption(firstOiOutputId);
  await smaDialog.getByLabel('Length').fill('3');
  await smaDialog.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toBeVisible();
  await expect.poll(async () => (await read()).consumer?.current).toBe(true);
  const before = await read();
  expect(before.market).toMatchObject({ venue: 'binance', market: 'perpetual' });
  expect(before.cvd).toMatchObject({ valueCount: 5000, available: true, timelineMatches: true });
  expect(before.oi).toMatchObject({ valueCount: 5000, available: true, timelineMatches: true });
  expect(before.smaOutput).toMatchObject({ valueCount: 5000, available: true, timelineMatches: true });
  expect(before.cvdData.sourceCount).toBeGreaterThan(0);
  expect(before.oiData.retainedObservations).toBe(60);
  const starts = { cvd: before.cvdData.subscriptionStarts, oi: before.oiData.subscriptionStarts };

  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return { venue: current.selection.venue, market: current.selection.market, bars: current.candles.length };
  }, panelId)).toEqual({ venue: 'hyperliquid', market: 'perpetual', bars: 5000 });
  await expect.poll(async () => (await read()).cvd?.contextId).toBe('hyperliquid:perpetual:BTC');
  await expect.poll(async () => (await read()).oi?.contextId).toBe('hyperliquid:perpetual:BTC');
  const switched = await read();
  expect(switched.cvdData.sourceCount).toBeGreaterThan(0);
  expect(switched.oiData.retainedObservations).toBe(60);
  expect(switched.cvdData.subscriptionStarts).toBe(starts.cvd);
  expect(switched.oiData.subscriptionStarts).toBe(starts.oi);
  expect(switched.cvd).toMatchObject({ available: true, valueCount: 5000, timelineMatches: true });
  expect(switched.oi).toMatchObject({ available: true, valueCount: 5000, timelineMatches: true });
  expect(switched.sma).toMatchObject({ instanceId: before.sma.instanceId,
    ref: { instanceId: before.sma.ref.instanceId, outputId: before.sma.ref.outputId } });
  expect(switched.sma.ref.contextId).toBe(switched.oi.contextId);
  expect(switched.smaOutput).toMatchObject({ available: true, valueCount: 5000, timelineMatches: true });
  await expect.poll(async () => (await read()).consumer?.current).toBe(true);

  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return { venue: current.selection.venue, market: current.selection.market, bars: current.candles.length };
  }, panelId)).toEqual({ venue: 'binance', market: 'spot', bars: 5000 });
  await expect.poll(async () => (await read()).oiData.subscribed).toBe(false);
  const spot = await read();
  expect(spot.oi).toMatchObject({ available: false, valueCount: 5000, timelineMatches: true });
  expect(spot.oiData.retainedObservations).toBe(0);
  expect(spot.sma).toMatchObject({ instanceId: before.sma.instanceId,
    ref: { instanceId: before.sma.ref.instanceId, outputId: before.sma.ref.outputId } });
  expect(spot.sma.ref.contextId).toBe('binance:spot:BTCUSDT');

  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return { venue: current.selection.venue, market: current.selection.market, bars: current.candles.length };
  }, panelId)).toEqual({ venue: 'hyperliquid', market: 'perpetual', bars: 5000 });
  await expect.poll(async () => (await read()).consumer?.current).toBe(true);
  const returned = await read();
  expect(returned.oiData).toMatchObject({ subscribed: true, retainedObservations: 60,
    subscriptionStarts: starts.oi + 1 });
  expect(returned.oi).toMatchObject({ available: true, valueCount: 5000, timelineMatches: true });
  expect(returned.sma).toMatchObject({ instanceId: before.sma.instanceId,
    ref: { instanceId: before.sma.ref.instanceId, outputId: before.sma.ref.outputId } });
  expect(returned.sma.ref.contextId).toBe(returned.oi.contextId);
  expect(returned.smaOutput).toMatchObject({ available: true, valueCount: 5000, timelineMatches: true });
});

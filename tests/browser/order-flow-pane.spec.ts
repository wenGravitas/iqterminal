import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function injectOrderFlowFixture(page: import('@playwright/test').Page, panelId: string, revision = 701) {
  return page.evaluate(({ id, revision }) => {
    const current = (window as any).__terminal.panels.get(id), now = Date.now(), step = 60_000;
    const tail = current.candles.slice(-25), base = tail[0]!.t, coverageTo = tail.at(-1)!.t + step;
    for (const source of ['binance:spot', 'binance:perpetual']) {
      const factor = source === 'binance:spot' ? 1 : 2;
      current.feed.send({ type: 'cvd-fixture', source, payload: { version: 1, source: `${source}:BTCUSDT`, stepMs: step,
        from: base, to: coverageTo, revision, snapshot: true, watermark: revision, baseUnit: 'BTC', quoteUnit: 'USDT',
        buckets: tail.map((candle: any, index: number) => ({ time: candle.t, base: factor * (index + 1),
          quote: factor * (index + 1) * 100, revision })),
        coverage: { from: base, to: coverageTo, gaps: [] }, status: 'live', asOf: now } });
    }

    // 480 observations per venue is 1,440 rows: the maximum expected four-hour
    // sample volume for three 30-second sources, while older chart bars remain
    // deliberately unobserved.
    const venues = ['binance', 'hyperliquid', 'bybit'], samplesPerVenue = 480, sampleStep = 30_000;
    const rawLast = Math.min(now - 1, current.candles.at(-1)!.t + step - 1);
    const rawFrom = rawLast - (samplesPerVenue - 1) * sampleStep, rawTo = rawLast + 1;
    const unitVerification = Object.fromEntries(venues.map(venue => [venue,
      { status: 'verified', units: 'BTC', evidence: 'explicit combined-pane fixture' }]));
    const feeds = Object.fromEntries(venues.map(venue => [venue, { state: 'ready', source: `${venue} fixture`,
      lastObservedAt: rawTo - 1_000, expectedIntervalMs: sampleStep, stale: false, unitVerification: unitVerification[venue] }]));
    const observations = venues.flatMap((venue, venueIndex) => Array.from({ length: samplesPerVenue }, (_, index) => {
      const sourceTimeMs = rawFrom + index * sampleStep, value = 1_000 + venueIndex * 100 + index + (revision - 701) * 5;
      return { venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', sourceTimeMs,
        observedAtMs: sourceTimeMs + 500, epoch: 1, value, valueDecimal: String(value), units: 'BTC', source: `${venue} fixture`,
        sourceTimeQuality: 'collector-sampled', quality: 'valid', gapBefore: false };
    }));
    const payload = { version: 1, market: 'perpetual', nativeSymbol: 'BTC', semantics: 'observed-open-interest-level',
      units: 'BTC', from: rawFrom, to: rawTo, asOfMs: now, venues, unitVerification, observations,
      truncated: false, invalidRows: 0, expectedIntervalMs: sampleStep, retentionDays: 7, feeds,
      history: 'Explicit combined-pane fixture: verified raw perpetual Open Interest levels.' };
    current.feed.send({ type: 'raw-open-interest-fixture', payload });
    return { base, candlesInChart: current.candles.length, candleFixtureCount: tail.length,
      rawRows: observations.length, observationsPerVenue: samplesPerVenue };
  }, { id: panelId, revision });
}

test('managed Order Flow combines CVD, raw Open Interest, Volume and default SMA with one pane chrome', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Fixture chart panel ID is missing.');
  const close = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await close.isVisible()) await close.click();
  const priceRangeBefore = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart;
    return chart.panes()[chart.primaryPaneIndex()].priceScale.priceRange();
  }, panelId);

  await addIndicator(panel, 'Multi-Venue CVD');
  await addIndicator(panel, 'Open Interest');
  await addIndicator(panel, 'Volume');
  const volumeRow = panel.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]');
  await expect(volumeRow).toBeVisible();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const view = current.studies.views().find((entry: any) => entry.scriptId === 'builtin.volume-histogram');
    return { attached: Boolean(view), outputAvailable: Boolean(view?.numericOutputs[0]?.available),
      status: view?.status ?? null, diagnostics: view?.diagnostics ?? [], host: current.studies.diagnostics() };
  }, panelId), { timeout: 30_000 }).toMatchObject({ attached: true, outputAvailable: true });
  const ids = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), items = current.selection.indicators;
    const cvd = items.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const oi = items.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const volume = items.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
    return { cvd: cvd.instanceId, oi: oi.instanceId, volume: volume.instanceId, cvdPane: cvd.paneId, oiPane: oi.paneId };
  }, panelId);

  // Move Open Interest into the existing CVD pane, then place Volume in that
  // same lower pane and reserve its existing zero-based band.
  await panel.locator(`.active-indicator[data-instance-id="${ids.oi}"]`).getByRole('button', { name: 'Move Open Interest', exact: true }).click();
  let move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption(ids.cvdPane);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), item = current.selection.indicators.find((entry: any) => entry.definitionId === 'native.raw-open-interest');
    return item.paneId;
  }, panelId)).toBe(ids.cvdPane);

  await panel.locator(`.active-indicator[data-instance-id="${ids.volume}"]`).getByRole('button', { name: 'Move Volume', exact: true }).click();
  move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption(ids.cvdPane);
  await move.getByLabel('Use a bottom band for zero-based outputs').check();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), item = current.selection.indicators.find((entry: any) => entry.script?.scriptId === 'builtin.volume-histogram');
    return item.paneId;
  }, panelId)).toBe(ids.cvdPane);
  await expect(panel.locator('[data-order-flow-chrome="true"]')).toHaveCount(1);
  const chrome = panel.locator('[data-order-flow-chrome="true"]');
  await expect(chrome.locator('.order-flow-header > strong')).toHaveText('Order Flow');
  await expect(panel.locator('[data-cvd="true"] .cvd-controls')).toBeHidden();
  await expect(panel.locator('[data-open-interest="true"] .open-interest-toolbar')).toBeHidden();
  await expect(panel.locator('.pane-indicator-host')).toHaveCount(0);

  const fixture = await injectOrderFlowFixture(page, panelId);
  expect(fixture).toMatchObject({ candlesInChart: 5000, candleFixtureCount: 25, rawRows: 1440, observationsPerVenue: 480 });
  await page.evaluate(id => (window as any).__terminal.panels.get(id).feed.send({ type: 'diagnostics' }), panelId);
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.feed.diagnostics.rawOpenInterest?.snapshots ?? 0;
  }, panelId)).toBeGreaterThan(0);
  const projectionDebug = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), frame = current.openInterestData.viewFrame(), payload = current.openInterestData.payload;
    const points = [...frame.lines].map(([venue, line]: [string, any]) => [venue, line.points.slice(-25).map((point: any) => ({
      t: point.time, source: point.sourceTimeMs, age: point.ageMs, quality: point.quality, value: point.value }))]);
    return { now: Date.now(), hostTail: current.candles.slice(-25).map((candle: any) => candle.t),
      payload: payload && { from: payload.from, to: payload.to, asOf: payload.asOfMs, rows: payload.observations.length,
        first: payload.observations[0]?.sourceTimeMs, last: payload.observations.at(-1)?.sourceTimeMs },
      worker: current.feed.diagnostics.rawOpenInterest, history: current.openInterestData.history.diagnostics(), points };
  }, panelId);
  console.log('Order Flow OI alignment', JSON.stringify(projectionDebug));

  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), oi = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const output = current.outputRegistry.get(`output:${oi.instanceId}:openInterestTotalBtc`);
    const latest = output?.values.slice(-20) ?? [];
    return output?.available && latest.length === 20 && latest.every((value: number | null) => value !== null && Number.isFinite(value));
  }, panelId)).toBe(true);
  await panel.locator(`.active-indicator[data-instance-id="${ids.oi}"]`).getByRole('button', { name: 'Add moving average to Open Interest', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  const totalId = `output:${ids.oi}:openInterestTotalBtc`;
  await add.getByLabel('Indicator output').selectOption(totalId);
  await add.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const smaRow = panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await expect(smaRow).toBeVisible();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), oi = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const source = current.outputRegistry.get(`output:${oi.instanceId}:openInterestTotalBtc`), derived = current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    return Boolean(source?.available && derived?.available && current.outputRegistry.consumerIsCurrent(sma.instanceId));
  }, panelId)).toBe(true);
  const mean = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), oi = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const source = current.outputRegistry.get(`output:${oi.instanceId}:openInterestTotalBtc`), derived = current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    const trailing = source.values.slice(-20), expected = trailing.reduce((sum: number, value: number) => sum + value, 0) / 20;
    const frame = current.openInterestData.viewFrame();
    return { length: sma.settings.length, expected, actual: derived.values.at(-1), quality: source.quality,
      trailingValues: trailing, availableSourceValues: source.values.filter((value: number | null) => value !== null).length,
      frameQuality: frame.quality, totalHead: frame.lines.get('total')?.points.slice(0, 3), totalTail: frame.lines.get('total')?.points.slice(-3),
      venueHeads: ['binance', 'hyperliquid', 'bybit'].map(venue => frame.lines.get(venue)?.points.slice(0, 2)),
      candles: current.candles.length, rows: current.orderFlowPaneState?.(undefined)?.rows ?? [],
      cvdHidden: current.cvdView?.controlRow?.hidden, oiHidden: current.openInterestView?.toolbar?.hidden };
  }, panelId);
  console.log('OI projection', JSON.stringify({ frameQuality: mean.frameQuality, quality: mean.quality, totalHead: mean.totalHead, totalTail: mean.totalTail, venueHeads: mean.venueHeads }));
  expect(mean.length).toBe(20); expect(mean.candles).toBe(5000); expect(mean.availableSourceValues).toBeGreaterThan(20);
  expect(mean.trailingValues).toHaveLength(20); expect(mean.trailingValues.every((value: number | null) => value !== null && Number.isFinite(value))).toBe(true);
  expect(mean.quality).toBe('partial'); expect(mean.frameQuality).toBe('partial'); expect(mean.actual).toBeCloseTo(mean.expected, 8);
  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd}"]`).getByRole('button', { name: 'Add moving average to Multi-Venue CVD', exact: true }).click();
  const addCvdSma = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addCvdSma.getByLabel('Indicator output').selectOption(`output:${ids.cvd}:cvdTotalBtc`);
  await addCvdSma.getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), cvd = current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma'
      && item.numericInputs?.source?.instanceId === cvd.instanceId);
    const output = sma && current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    return Boolean(output?.available && current.outputRegistry.consumerIsCurrent(sma.instanceId));
  }, panelId)).toBe(true);
  const smaIds = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), items = current.selection.indicators;
    const cvd = items.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const oi = items.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const oiSma = items.find((item: any) => item.definitionId === 'native.composition-sma' && item.numericInputs?.source?.instanceId === oi.instanceId);
    const cvdSma = items.find((item: any) => item.definitionId === 'native.composition-sma' && item.numericInputs?.source?.instanceId === cvd.instanceId);
    const cvdOutput = current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`), cvdSmaOutput = current.outputRegistry.get(`output:${cvdSma.instanceId}:p0`);
    const closedWindow = cvdOutput.values.slice(-21, -1);
    return { cvd: cvdSma.instanceId, oi: oiSma.instanceId, debug: { length: cvdSma.settings.length, sourceQuality: cvdOutput.quality,
      sourceTail: cvdOutput.values.slice(-30), resets: cvdOutput.resets, derivedTail: cvdSmaOutput.values.slice(-30),
      derivedQuality: cvdSmaOutput.quality, derivedResets: cvdSmaOutput.resets,
      latestCandle: current.candles.at(-1)?.t, latestCandleClosed: current.candles.at(-1)?.closed,
      latestReset: cvdOutput.resets.at(-1), latestDailyReset: cvdOutput.resets.filter((reset: any) => reset.reason === 'daily UTC CVD reset').at(-1),
      closedWindow, expectedPreviousClosedSma: closedWindow.every((value: number | null) => value !== null)
        ? closedWindow.reduce((sum: number, value: number | null) => sum + (value ?? 0), 0) / closedWindow.length : null,
      previousClosedSma: cvdSmaOutput.values.at(-2), latestSma: cvdSmaOutput.values.at(-1), sourceTailTimes: cvdOutput.times.slice(-30) } };
  }, panelId);
  console.log('CVD SMA alignment', JSON.stringify(smaIds.debug));
  expect(smaIds.debug.sourceQuality).toBe('partial');
  expect(smaIds.debug.derivedQuality).toBe('partial');
  expect(smaIds.debug.derivedResets).toEqual(smaIds.debug.resets);
  expect(smaIds.debug.latestCandleClosed).toBe(false);
  expect(smaIds.debug.closedWindow).toHaveLength(20);
  expect(smaIds.debug.closedWindow.every((value: number | null) => value !== null && Number.isFinite(value))).toBe(true);
  expect(smaIds.debug.expectedPreviousClosedSma).not.toBeNull();
  expect(smaIds.debug.previousClosedSma).toBeCloseTo(smaIds.debug.expectedPreviousClosedSma!, 8);
  expect(smaIds.debug.latestSma).toBeNull();
  expect(smaIds.debug.latestReset).toMatchObject({ fromTime: smaIds.debug.latestCandle, reason: 'Incomplete or interrupted signed execution coverage' });
  expect(smaIds.debug.latestDailyReset?.fromTime ?? Number.POSITIVE_INFINITY).toBeLessThan(smaIds.debug.latestCandle);
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.studies.views().find((view: any) => view.scriptId === 'builtin.volume-histogram')?.numericOutputs[0]?.available;
  }, panelId)).toBe(true);

  // Simulate twenty 50 ms updates to the same forming candle without a time
  // or close-state change. Native projections should do no full-history work,
  // publish no numeric outputs, and invalidate no pane UI.
  const nativeTickTelemetry = await page.evaluate(async ({ id, cvdSmaId, oiSmaId }) => {
    const current = (window as any).__terminal.panels.get(id), model = current.cvdData.model, oi = current.openInterestData;
    const calls = { cvdProjection: 0, oiProjection: 0, outputEvents: 0, uiInvalidations: 0 };
    const originalCvdProjection = model.projectNumericOutputs.bind(model), originalOiProjection = oi.buildFrame.bind(oi);
    const originalInvalidate = current.orderFlowPaneView.invalidate.bind(current.orderFlowPaneView);
    const candle = current.candles.at(-1), originalCandle = { ...candle };
    const originalRegistryRevision = current.outputRegistry.latestRevision();
    const readRevision = (owner: string, plot: string) => current.outputRegistry.get(`output:${owner}:${plot}`)?.revision ?? -1;
    const revisions = () => ({
      volume: readRevision(current.selection.indicators.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram').instanceId, 'p0'),
      cvd: readRevision(current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd').instanceId, 'cvdTotalBtc'),
      oi: readRevision(current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest').instanceId, 'openInterestTotalBtc'),
      cvdSma: readRevision(cvdSmaId, 'p0'), oiSma: readRevision(oiSmaId, 'p0'),
    });
    const beforeRevisions = revisions();
    model.projectNumericOutputs = (...args: any[]) => { calls.cvdProjection++; return originalCvdProjection(...args); };
    oi.buildFrame = (...args: any[]) => { calls.oiProjection++; return originalOiProjection(...args); };
    current.orderFlowPaneView.invalidate = (...args: any[]) => { calls.uiInvalidations++; return originalInvalidate(...args); };
    const release = current.outputRegistry.subscribeOutputs(() => calls.outputEvents++);
    try {
      for (let tick = 1; tick <= 20; tick++) {
        candle.c = originalCandle.c + tick * 0.01;
        candle.h = Math.max(originalCandle.h, candle.c);
        candle.revision = originalCandle.revision + tick;
        current.cvdData.setHostCandles(current.candles);
        oi.setHostCandles(current.candles);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return { calls, originalRegistryRevision, finalRegistryRevision: current.outputRegistry.latestRevision(),
        beforeRevisions, afterRevisions: revisions() };
    } finally {
      release(); Object.assign(candle, originalCandle);
      model.projectNumericOutputs = originalCvdProjection; oi.buildFrame = originalOiProjection;
      current.orderFlowPaneView.invalidate = originalInvalidate;
    }
  }, { id: panelId, cvdSmaId: smaIds.cvd, oiSmaId: smaIds.oi });
  expect(nativeTickTelemetry.calls).toEqual({ cvdProjection: 0, oiProjection: 0, outputEvents: 0, uiInvalidations: 0 });
  expect(nativeTickTelemetry.finalRegistryRevision).toBe(nativeTickTelemetry.originalRegistryRevision);
  expect(nativeTickTelemetry.afterRevisions).toEqual(nativeTickTelemetry.beforeRevisions);

  await expect(chrome.getByRole('button', { name: /CVD venue lines/ })).toBeVisible();
  await expect(chrome.getByRole('button', { name: /CVD aggregation lines/ })).toBeVisible();
  await expect(chrome.getByRole('button', { name: 'Multi-Venue CVD settings', exact: true })).toBeVisible();
  await expect(chrome.getByRole('button', { name: 'Open Interest settings', exact: true })).toBeVisible();
  await expect(chrome.locator('.order-flow-value').filter({ hasText: 'Volume' })).toBeVisible();
  await expect(chrome.locator('.order-flow-value').filter({ hasText: 'SMA 20' })).toHaveCount(2);
  await expect(chrome.locator(`[data-order-flow-row="sma:${smaIds.oi}"]`)).toBeVisible();
  await expect(chrome.locator(`[data-order-flow-row="sma:${smaIds.cvd}"]`)).toBeVisible();
  await expect(chrome.locator('.order-flow-chrome')).toHaveCount(0);
  await expect(chrome.locator('.order-flow-tooltip')).toHaveCount(1);
  await expect(panel.locator('.cvd-controls')).toBeHidden();
  await expect(panel.locator('.cvd-status')).toBeHidden();
  await expect(panel.locator('.cvd-tooltip')).toBeHidden();
  await expect(panel.locator('.open-interest-toolbar')).toBeHidden();
  await expect(panel.locator('.open-interest-status')).toBeHidden();
  await expect(panel.locator('.open-interest-provenance')).toBeHidden();
  await expect(panel.locator('.open-interest-tooltip')).toBeHidden();
  await expect(chrome.locator('button[data-pane-action]')).toHaveCount(4);

  const axisGeometry = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart, paneIndex = current.orderFlowPaneIndex;
    const items = current.selection.indicators;
    const cvd = items.find((item: any) => item.definitionId === 'native.multi-venue-cvd');
    const oi = items.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const volume = items.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
    const cvdSma = items.find((item: any) => item.definitionId === 'native.composition-sma' && item.numericInputs?.source?.instanceId === cvd.instanceId);
    const oiSma = items.find((item: any) => item.definitionId === 'native.composition-sma' && item.numericInputs?.source?.instanceId === oi.instanceId);
    const volumePlot = current.selection.composition.plots.find((plot: any) => plot.producerInstanceId === volume.instanceId && plot.outputKey === 'p0');
    const volumeScale = current.selection.composition.scales.find((scale: any) => scale.scaleId === volumePlot?.scaleId);
    const rows = current.orderFlowPaneState().rows;
    const cvdScale = current.cvdView.assignedScaleId, oiScale = current.openInterestView.assignedScaleId;
    const cvdSmaScale = current.compositionApis.get(cvdSma.instanceId).plotPriceScaleId('p0');
    const oiSmaScale = current.compositionApis.get(oiSma.instanceId).plotPriceScaleId('p0');
    return { paneIndex, paneCount: chart.panes().length, cvdScale, oiScale, cvdSmaScale, oiSmaScale,
      cvdSide: chart.priceAxisPlacement(paneIndex, cvdScale)?.side, oiSide: chart.priceAxisPlacement(paneIndex, oiScale)?.side,
      volumeScale: volumeScale?.engineScaleId, volumeSide: volumeScale && chart.priceAxisPlacement(paneIndex, volumeScale.engineScaleId)?.side,
      volumePolicy: volumeScale?.policy, band: current.selection.composition.embeddedBands.find((band: any) => band.memberIds.includes(volume.instanceId)),
      rows: rows.map((row: any) => ({ source: row.source, name: row.name, scale: row.scale })),
      primaryRange: chart.panes()[chart.primaryPaneIndex()].priceScale.priceRange() };
  }, panelId);
  expect(axisGeometry.cvdScale).not.toBe(axisGeometry.oiScale);
  expect(axisGeometry.cvdSmaScale).toBe(axisGeometry.cvdScale);
  expect(axisGeometry.oiSmaScale).toBe(axisGeometry.oiScale);
  expect(axisGeometry.cvdSide).toBe('left'); expect(axisGeometry.oiSide).toBe('right');
  expect(axisGeometry.volumeSide).toBe('hidden'); expect(axisGeometry.volumePolicy).toBe('zero-based');
  expect(axisGeometry.band).toBeTruthy(); expect(axisGeometry.paneCount).toBe(2);
  expect(axisGeometry.primaryRange.min).toBeCloseTo(priceRangeBefore.min, 6);
  expect(axisGeometry.primaryRange.max).toBeCloseTo(priceRangeBefore.max, 6);
  expect(axisGeometry.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'cvd', scale: 'L' }), expect.objectContaining({ source: 'open-interest', scale: 'R' }),
    expect.objectContaining({ source: 'volume', scale: 'V' }), expect.objectContaining({ source: 'sma', scale: 'L' }),
    expect.objectContaining({ source: 'sma', scale: 'R' }),
  ]));
  const layoutGeometry = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart, index = current.orderFlowPaneIndex;
    const pane = chart.panes()[index].element, paneRect = pane.getBoundingClientRect(), plot = chart.plotRect(index);
    const header = pane.querySelector('.order-flow-header'), headerRect = header.getBoundingClientRect();
    const legend = pane.querySelector('.order-flow-legend'), legendRect = legend.getBoundingClientRect();
    const valueRects = [...legend.querySelectorAll('.order-flow-value')].map((element: Element) => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    });
    const status = pane.querySelector('.order-flow-status'), statusRect = status.getBoundingClientRect();
    const volume = current.selection.indicators.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
    const band = current.selection.composition.embeddedBands.find((item: any) => item.memberIds.includes(volume.instanceId));
    const stageRect = current.element.querySelector('.chart-stage').getBoundingClientRect();
    const stageTop = stageRect.top;
    const bandTop = stageTop + plot.top + plot.height * (1 - band.heightPercent / 100);
    return { plotLeft: plot.left - (paneRect.left - stageRect.left), headerLeft: headerRect.left - paneRect.left, headerBottom: headerRect.bottom,
      legend: { left: legendRect.left, right: legendRect.right, top: legendRect.top, bottom: legendRect.bottom,
      clientWidth: legend.clientWidth, scrollWidth: legend.scrollWidth, clientHeight: legend.clientHeight, scrollHeight: legend.scrollHeight },
      values: valueRects, statusHidden: status.hidden, statusTop: statusRect.top, statusBottom: statusRect.bottom, bandTop };
  }, panelId);
  expect(layoutGeometry.headerLeft).toBeGreaterThanOrEqual(layoutGeometry.plotLeft);
  expect(layoutGeometry.legend.scrollWidth).toBeLessThanOrEqual(layoutGeometry.legend.clientWidth + 1);
  expect(layoutGeometry.values.length).toBeGreaterThanOrEqual(7);
  expect(layoutGeometry.values.every(rect => rect.width > 0 && rect.left >= layoutGeometry.legend.left - 1
    && rect.right <= layoutGeometry.legend.right + 1 && rect.top >= layoutGeometry.legend.top - 1
    && rect.bottom <= layoutGeometry.legend.bottom + 1)).toBe(true);
  expect(layoutGeometry.statusHidden).toBe(false);
  expect(layoutGeometry.legend.bottom).toBeLessThanOrEqual(layoutGeometry.bandTop + 1);
  expect(layoutGeometry.statusTop).toBeGreaterThanOrEqual(layoutGeometry.headerBottom + 1);
  expect(layoutGeometry.statusBottom).toBeLessThanOrEqual(layoutGeometry.bandTop + 1);
  console.log('Order Flow layout geometry', JSON.stringify(layoutGeometry));
  await page.screenshot({ path: 'artifacts/order-flow-r2-1366x768.png' });

  // The one managed tooltip owns crosshair presentation; neither source view
  // should reveal its standalone tooltip when the pointer enters this pane.
  const hover = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart, paneIndex = current.orderFlowPaneIndex;
    const stage = current.element.querySelector('.chart-stage').getBoundingClientRect(), plot = chart.plotRect(paneIndex);
    const time = current.candles.at(-2)!.t / 1000, index = chart.dataLayer.timeToIndexFloat(time);
    return { x: stage.left + plot.left + chart.timeScale.indexToX(index), y: stage.top + plot.top + plot.height * .55 };
  }, panelId);
  await page.mouse.move(hover.x, hover.y);
  await expect(chrome.locator('.order-flow-tooltip')).toBeVisible();
  await expect(panel.locator('.cvd-tooltip')).toBeHidden();
  await expect(panel.locator('.open-interest-tooltip')).toBeHidden();
  await page.evaluate(() => { (window as any).__orderFlowPersistentTotal = document.querySelector('.order-flow-chrome [data-order-flow-row="oi:total"]'); });
  await chrome.getByRole('button', { name: 'CVD aggregation lines', exact: true }).click();
  await expect(chrome.getByRole('button', { name: 'CVD aggregation lines', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.cvd-controls')).toBeHidden();
  await expect(panel.locator('.open-interest-toolbar')).toBeHidden();
  await chrome.getByRole('button', { name: 'CVD venue lines', exact: true }).click();
  await expect(chrome.getByRole('button', { name: 'CVD venue lines', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('.order-flow-chrome [data-order-flow-row="oi:total"]')
    === (window as any).__orderFlowPersistentTotal)).toBe(true);
  const beforeUpdate = mean.trailingValues.at(-1)!;
  const update = await injectOrderFlowFixture(page, panelId, 702);
  expect(update).toMatchObject({ candlesInChart: 5000, rawRows: 1440 });
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), oi = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    return current.outputRegistry.get(`output:${oi.instanceId}:openInterestTotalBtc`)?.values.at(-1);
  }, panelId)).toBe(beforeUpdate + 15);
  expect(await page.evaluate(() => document.querySelector('.order-flow-chrome [data-order-flow-row="oi:total"]')
    === (window as any).__orderFlowPersistentTotal)).toBe(true);
  await expect(panel.locator('.cvd-tooltip')).toBeHidden(); await expect(panel.locator('.open-interest-tooltip')).toBeHidden();

  // Hiding a demanded source keeps the managed chrome in place and does not
  // restore the source toolbar or the generic indicator header in that pane.
  await panel.locator(`.active-indicator[data-instance-id="${ids.oi}"]`).getByRole('button', { name: 'Hide Open Interest', exact: true }).click();
  await expect(panel.locator('[data-order-flow-chrome="true"]')).toHaveCount(1);
  await expect(panel.locator('[data-open-interest="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.openInterestData.diagnostics().demanded && current.openInterestData.diagnostics().subscribed;
  }, panelId)).toBe(true);
  await expect(chrome).toBeVisible();
  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd}"]`).getByRole('button', { name: 'Hide Multi-Venue CVD', exact: true }).click();
  await expect(panel.locator('[data-cvd="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), state = current.cvdData.demandDiagnostics();
    return state.demanded && state.subscribed;
  }, panelId)).toBe(true);
  await expect(chrome).toBeVisible();
  await expect(chrome.getByRole('button', { name: 'Multi-Venue CVD settings', exact: true })).toBeVisible();
  await panel.locator(`.active-indicator[data-instance-id="${ids.oi}"]`).getByRole('button', { name: 'Show Open Interest', exact: true }).click();
  await panel.locator(`.active-indicator[data-instance-id="${ids.cvd}"]`).getByRole('button', { name: 'Show Multi-Venue CVD', exact: true }).click();
  await expect(panel.locator('[data-cvd="true"]')).toHaveCount(1);
  await expect(panel.locator('[data-open-interest="true"]')).toHaveCount(1);
  await expect(chrome.locator('.order-flow-value').filter({ hasText: 'Volume' })).toBeVisible();
  await page.setViewportSize({ width: 720, height: 860 });
  await expect(chrome.locator('.order-flow-header > strong')).toBeVisible();
  await expect(chrome.getByRole('button', { name: 'Multi-Venue CVD settings', exact: true })).toBeVisible();
  await expect(chrome.locator('.order-flow-value').filter({ hasText: 'Volume' })).toBeVisible();
  const narrowLegend = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart;
    const paneIndex = current.orderFlowPaneIndex, pane = chart.panes()[paneIndex].element, paneRect = pane.getBoundingClientRect();
    const stageRect = current.element.querySelector('.chart-stage').getBoundingClientRect();
    const stageTop = stageRect.top;
    const plot = chart.plotRect(paneIndex), headerRect = pane.querySelector('.order-flow-header').getBoundingClientRect();
    const legend = pane.querySelector('.order-flow-legend')!, legendRect = legend.getBoundingClientRect();
    const status = pane.querySelector('.order-flow-status')!, statusRect = status.getBoundingClientRect();
    const volume = current.selection.indicators.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
    const band = current.selection.composition.embeddedBands.find((item: any) => item.memberIds.includes(volume.instanceId));
    const buttons = [...legend.querySelectorAll('.order-flow-value')].map((element: Element) => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return { plotLeft: plot.left - (paneRect.left - stageRect.left), headerLeft: headerRect.left - paneRect.left, width: legend.clientWidth, scrollWidth: legend.scrollWidth,
      height: legend.clientHeight, scrollHeight: legend.scrollHeight, left: legendRect.left, right: legendRect.right,
      top: legendRect.top, bottom: legendRect.bottom, headerBottom: headerRect.bottom, statusHidden: status.hidden,
      statusBottom: statusRect.bottom, bandTop: stageTop + plot.top + plot.height * (1 - band.heightPercent / 100), buttons };
  }, panelId);
  expect(narrowLegend.headerLeft).toBeGreaterThanOrEqual(narrowLegend.plotLeft);
  expect(narrowLegend.scrollWidth).toBeLessThanOrEqual(narrowLegend.width + 1);
  expect(narrowLegend.buttons.every(rect => rect.left >= narrowLegend.left - 1 && rect.right <= narrowLegend.right + 1
    && rect.top >= narrowLegend.top - 1 && rect.bottom <= narrowLegend.bottom + 1)).toBe(true);
  expect(narrowLegend.bottom).toBeLessThanOrEqual(narrowLegend.bandTop + 1);
  expect(narrowLegend.statusHidden).toBe(false);
  expect(narrowLegend.statusBottom).toBeLessThanOrEqual(narrowLegend.bandTop + 1);
  console.log('Order Flow narrow legend geometry', JSON.stringify(narrowLegend));
  await expect(panel.locator('.cvd-tooltip')).toBeHidden();
  await expect(panel.locator('.open-interest-tooltip')).toBeHidden();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'artifacts/order-flow-r2-720x860.png' });

  // Pane commands remain reachable through the shared header. Add an unrelated
  // native pane so the managed pane can move down and back without swapping the
  // primary price pane.
  await page.setViewportSize({ width: 1366, height: 768 });
  await addIndicator(panel, 'Market Conditions');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.panes().length, panelId)).toBe(3);
  let paneIndex = await page.evaluate(id => (window as any).__terminal.panels.get(id).orderFlowPaneIndex, panelId);
  expect(paneIndex).toBe(1);
  await chrome.getByRole('button', { name: `Collapse pane ${paneIndex + 1} to header only`, exact: true }).click();
  await expect.poll(() => page.evaluate(({ id, index }) => (window as any).__terminal.panels.get(id).engine.chart.paneCollapsed(index), { id: panelId, index: paneIndex })).toBe(true);
  await chrome.getByRole('button', { name: `Expand pane ${paneIndex + 1}`, exact: true }).click();
  await expect.poll(() => page.evaluate(({ id, index }) => (window as any).__terminal.panels.get(id).engine.chart.paneCollapsed(index), { id: panelId, index: paneIndex })).toBe(false);
  await chrome.getByRole('button', { name: `Maximize pane ${paneIndex + 1}`, exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.maximizedPane(), panelId)).toBe(paneIndex);
  await chrome.getByRole('button', { name: 'Restore all panes', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.maximizedPane(), panelId)).toBe(null);

  const resizePoint = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), chart = current.engine.chart, index = current.orderFlowPaneIndex;
    const stage = current.element.querySelector('.chart-stage'), rect = stage.getBoundingClientRect(), paneRect = chart.panes()[index].element.getBoundingClientRect();
    const targetY = paneRect.top - rect.top, layout = (chart as any)._layout;
    let hit: { y: number; divider: number } | undefined;
    for (let y = 1; y < stage.clientHeight; y++) {
      const divider = layout?._dividerAt?.(y);
      if (divider === null || divider === undefined || divider < 0) continue;
      if (!hit || Math.abs(y - targetY) < Math.abs(hit.y - targetY)) hit = { y, divider };
    }
    const plot = chart.plotRect(index);
    return hit && plot ? { x: rect.left + plot.left + plot.width / 2, y: rect.top + hit.y, divider: hit.divider,
      target: index, initialWeight: chart.paneWeight(index) } : undefined;
  }, panelId);
  expect(resizePoint).toBeTruthy();
  await page.mouse.move(resizePoint!.x, resizePoint!.y);
  await page.mouse.down(); await page.mouse.move(resizePoint!.x, resizePoint!.y + 32, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(({ id, original }) => {
    const current = (window as any).__terminal.panels.get(id), index = current.orderFlowPaneIndex;
    return Math.abs(current.engine.chart.paneWeight(index) - original);
  }, { id: panelId, original: resizePoint!.initialWeight })).toBeGreaterThan(.005);
  const resized = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), index = current.orderFlowPaneIndex;
    const record = current.selection.composition.panes.find((pane: any) => pane.memberIds.includes(current.selection.indicators.find((item: any) => item.definitionId === 'native.multi-venue-cvd').instanceId));
    return { weight: current.engine.chart.paneWeight(index), savedWeight: record?.weight, paneCount: current.engine.chart.panes().length };
  }, panelId);
  expect(resized.paneCount).toBe(3); expect(resized.savedWeight).toBeCloseTo(resized.weight, 3);

  await chrome.getByRole('button', { name: `Move pane ${paneIndex + 1} down`, exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).orderFlowPaneIndex, panelId)).toBe(paneIndex + 1);
  await expect(panel.locator('.pane-indicator-host[data-pane-index="1"]')).toContainText('Market Conditions');
  await chrome.getByRole('button', { name: `Move pane ${paneIndex + 2} up`, exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).orderFlowPaneIndex, panelId)).toBe(paneIndex);
  await panel.locator('.active-indicator[data-definition-id="native.market-conditions"]')
    .getByRole('button', { name: 'Remove Market Conditions', exact: true }).click();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.panes().length, panelId)).toBe(2);
  expect(errors).toEqual([]);
  expect(fixture.candleFixtureCount).toBe(25);
});

test('combined native panes share raw Open Interest across charts and release it on sleep and final removal', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);

  const charts = page.locator('.candle-panel');
  const first = charts.nth(0);
  const firstId = await first.getAttribute('data-panel-id');
  if (!firstId) throw new Error('First fixture chart panel ID is missing.');
  await addIndicator(first, 'Multi-Venue CVD');
  await addIndicator(first, 'Open Interest');
  await addIndicator(first, 'Volume');
  await expect.poll(() => page.evaluate(id => {
    const items = (window as any).__terminal.panels.get(id).selection.indicators;
    return ['native.multi-venue-cvd', 'native.raw-open-interest'].every(definitionId => items.some((item: any) => item.definitionId === definitionId))
      && items.some((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
  }, firstId)).toBe(true);
  const firstIds = await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id), items = panel.selection.indicators;
    return {
      cvd: items.find((item: any) => item.definitionId === 'native.multi-venue-cvd').instanceId,
      oi: items.find((item: any) => item.definitionId === 'native.raw-open-interest').instanceId,
      volume: items.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram').instanceId,
      cvdPane: items.find((item: any) => item.definitionId === 'native.multi-venue-cvd').paneId,
    };
  }, firstId);
  const move = async (panel: import('@playwright/test').Locator, id: string, targetPane: string, volume = false) => {
    await panel.locator(`.active-indicator[data-instance-id="${id}"]`).locator('button[data-indicator-action="move"]').click();
    const dialog = page.getByRole('dialog', { name: 'Move indicator', exact: true });
    await dialog.getByLabel('Move to pane').selectOption(targetPane);
    if (volume) await dialog.getByLabel('Use a bottom band for zero-based outputs').check();
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(() => page.evaluate(({ panelId, instanceId }) => {
      const current = (window as any).__terminal.panels.get(panelId);
      return current.selection.indicators.find((item: any) => item.instanceId === instanceId)?.paneId;
    }, { panelId: firstId, instanceId: id })).toBe(targetPane);
  };
  await move(first, firstIds.oi, firstIds.cvdPane);
  await move(first, firstIds.volume, firstIds.cvdPane, true);
  await expect(first.locator('[data-order-flow-chrome="true"]')).toHaveCount(1);
  await expect(first.locator('[data-cvd="true"] .cvd-controls')).toBeHidden();
  await expect(first.locator('[data-open-interest="true"] .open-interest-toolbar')).toBeHidden();
  await expect(first.locator('.order-flow-value').filter({ hasText: 'Volume' })).toBeVisible();

  await page.getByRole('button', { name: 'Add chart', exact: true }).click();
  await expect(charts).toHaveCount(2);
  const second = charts.nth(1);
  const secondId = await second.getAttribute('data-panel-id');
  if (!secondId) throw new Error('Second fixture chart panel ID is missing.');
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id)?.diagnostics().bars, secondId)).toBe(5000);
  await addIndicator(second, 'Open Interest');
  const secondOpenInterest = second.locator('.active-indicator[data-definition-id="native.raw-open-interest"]');
  await expect(secondOpenInterest).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics().subscribed, secondId)).toBe(true);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.subscribers)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest)).toBe(2);

  const fixture = await page.evaluate(() => {
    const now = Date.now(), from = now - 4 * 60 * 60_000, venues = ['binance', 'hyperliquid', 'bybit'];
    const unitVerification = Object.fromEntries(venues.map(venue => [venue,
      { status: 'verified', units: 'BTC', evidence: 'explicit combined multi-chart browser fixture' }]));
    const feeds = Object.fromEntries(venues.map(venue => [venue, { state: 'ready', source: `${venue} fixture`,
      lastObservedAt: now - 1_000, expectedIntervalMs: 30_000, stale: false, unitVerification: unitVerification[venue] }]));
    const observations = venues.flatMap((venue, venueIndex) => Array.from({ length: 60 }, (_, index) => {
      const sourceTimeMs = now - 30 * 60_000 + index * 30_000, value = 1_000 + venueIndex * 100 + index;
      return { venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', sourceTimeMs,
        observedAtMs: sourceTimeMs + 500, epoch: 1, value, valueDecimal: String(value), units: 'BTC', source: `${venue} fixture`,
        sourceTimeQuality: 'collector-sampled', quality: 'valid', gapBefore: false };
    }));
    (window as any).__terminal.feed.send({ type: 'raw-open-interest-fixture', payload: { version: 1, market: 'perpetual', nativeSymbol: 'BTC',
      semantics: 'observed-open-interest-level', units: 'BTC', from, to: now, asOfMs: now, venues, unitVerification,
      observations, truncated: false, invalidRows: 0, expectedIntervalMs: 30_000, retentionDays: 7, feeds,
      history: 'Explicit combined multi-chart fixture: raw verified perpetual Open Interest levels.' } });
    return { rows: observations.length, venues: venues.length, from, to: now };
  });
  expect(fixture).toMatchObject({ rows: 180, venues: 3 });
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics().retainedObservations, firstId)).toBe(180);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics().retainedObservations, secondId)).toBe(180);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  const oiState = (id: string) => page.evaluate(panelId => {
    const panel = (window as any).__terminal.panels.get(panelId), oi = panel.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const outputId = `output:${oi.instanceId}:openInterestTotalBtc`, output = panel.outputRegistry.get(outputId);
    const sma = panel.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const smaOutput = sma ? panel.outputRegistry.get(`output:${sma.instanceId}:p0`) : undefined;
    return { data: panel.openInterestData.diagnostics(), outputId, output: output && { revision: output.revision, available: output.available,
        valueCount: output.values.length, tail: output.values.slice(-20) }, smaId: sma?.instanceId,
      smaOutput: smaOutput && { revision: smaOutput.revision, available: smaOutput.available, tail: smaOutput.values.slice(-20) },
      smaCurrent: sma ? panel.outputRegistry.consumerIsCurrent(sma.instanceId) : false,
      panes: panel.engine.chart.panes().length, visible: panel.params.api.isVisible };
  }, id);
  await expect.poll(async () => (await oiState(firstId)).output?.available).toBe(true);
  await expect.poll(async () => (await oiState(secondId)).output?.available).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = (window as any).__terminal.feed.diagnostics.rawOpenInterest;
    return diagnostics && { fixtureSelected: diagnostics.fixtureSelected, subscribers: diagnostics.subscribers,
      requests: diagnostics.requests, snapshots: diagnostics.snapshots };
  })).toMatchObject({ fixtureSelected: true, subscribers: 2, requests: 0, snapshots: 2 });

  const secondInitial = await oiState(secondId);
  expect(secondInitial.data).toMatchObject({ demanded: true, subscribed: true, retainedObservations: 180 });
  expect(secondInitial.output).toMatchObject({ available: true, valueCount: 5000 });
  await secondOpenInterest.getByRole('button', { name: 'Add moving average to Open Interest', exact: true }).click();
  const addSma = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await addSma.getByLabel('Indicator output').selectOption(secondInitial.outputId);
  await addSma.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const secondSma = second.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await expect(secondSma).toBeVisible();
  await expect.poll(async () => (await oiState(secondId)).smaCurrent).toBe(true);
  await secondOpenInterest.getByRole('button', { name: 'Hide Open Interest', exact: true }).click();
  await expect(second.locator('[data-open-interest="true"]')).toHaveCount(0);
  await expect.poll(async () => (await oiState(secondId)).data).toMatchObject({ demanded: true, subscribed: true });
  const hiddenSource = await oiState(secondId);
  expect(hiddenSource.smaCurrent).toBe(true);
  expect(hiddenSource.output?.tail).toEqual(secondInitial.output?.tail);

  const beforeSleep = await oiState(secondId);
  const sleeperId = 'order-flow-sleep-sentinel';
  await page.evaluate(({ referenceId, panelId }) => {
    const dock = (window as any).__terminal.dock;
    dock.addPanel({ id: panelId, component: 'candle', title: 'Sleep Sentinel',
      params: { venue: 'binance', market: 'perpetual', interval: '1m', type: 'candle', studies: [] },
      position: { referencePanel: referenceId, direction: 'within' }, minimumWidth: 220, minimumHeight: 140 });
  }, { referenceId: secondId, panelId: sleeperId });
  await expect(charts).toHaveCount(3);
  await expect.poll(async () => (await oiState(secondId)).visible).toBe(false);
  await expect.poll(async () => (await oiState(secondId)).data).toMatchObject({ demanded: true, hostVisible: false, subscribed: false });
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.subscribers)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest)).toBe(1);
  const asleep = await oiState(secondId);
  expect(asleep.data.subscriptionStops).toBe(beforeSleep.data.subscriptionStops + 1);
  expect(asleep.smaCurrent).toBe(false);

  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.setActive(), secondId);
  await expect.poll(async () => (await oiState(secondId)).visible).toBe(true);
  await expect.poll(async () => (await oiState(secondId)).data).toMatchObject({ demanded: true, hostVisible: true, subscribed: true });
  await expect.poll(async () => (await oiState(secondId)).smaCurrent).toBe(true);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = (window as any).__terminal.feed.diagnostics.rawOpenInterest;
    return diagnostics && { subscribers: diagnostics.subscribers, requests: diagnostics.requests, snapshots: diagnostics.snapshots };
  })).toMatchObject({ subscribers: 2, requests: 0, snapshots: 3 });
  const awake = await oiState(secondId);
  expect(awake.data.subscriptionStarts).toBe(beforeSleep.data.subscriptionStarts + 1);
  expect(awake.data.retainedObservations).toBe(180);
  expect(awake.output?.tail).toEqual(beforeSleep.output?.tail);
  expect(awake.smaOutput?.available).toBe(true);
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.close(), sleeperId);
  await expect(charts).toHaveCount(2);
  await expect.poll(async () => (await oiState(secondId)).visible).toBe(true);

  await secondSma.getByRole('button', { name: /Remove SMA 20/ }).click();
  await expect.poll(async () => (await oiState(secondId)).data).toMatchObject({ demanded: false, subscribed: false });
  await secondOpenInterest.getByRole('button', { name: 'Remove Open Interest', exact: true }).click();
  await expect(second.locator('.active-indicator[data-definition-id="native.raw-open-interest"]')).toHaveCount(0);
  await expect(second.locator('.active-indicator[data-definition-id="native.composition-sma"]')).toHaveCount(0);
  await expect(second.locator('[data-open-interest="true"]')).toHaveCount(0);
  await expect(second.locator('[data-order-flow-chrome="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(({ id, outputId }) => {
    const panel = (window as any).__terminal.panels.get(id);
    return { panes: panel.engine.chart.panes().length, apis: panel.compositionApis.size,
      orphanOutput: panel.outputRegistry.diagnostics().outputs.some((output: any) => output.outputId === outputId) };
  }, { id: secondId, outputId: secondInitial.outputId })).toEqual({ panes: 1, apis: 0, orphanOutput: false });
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.subscribers)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest)).toBe(1);
  const cleanup = await page.evaluate(({ firstPanelId, secondPanelId }) => {
    const terminal = (window as any).__terminal;
    return { mode: document.querySelector('.brand')?.textContent?.trim(),
      worker: terminal.feed.diagnostics.rawOpenInterest, protocol: terminal.feed.protocolDiagnostics(),
      first: terminal.panels.get(firstPanelId).openInterestData.diagnostics(),
      second: { hasDataController: Boolean(terminal.panels.get(secondPanelId).openInterestData),
        panes: terminal.panels.get(secondPanelId).engine.chart.panes().length,
        apis: terminal.panels.get(secondPanelId).compositionApis.size },
      firstOrderFlowRows: terminal.panels.get(firstPanelId).orderFlowPaneState().rows.map((row: any) => row.source) };
  }, { firstPanelId: firstId, secondPanelId: secondId });
  expect(cleanup.worker).toMatchObject({ fixtureSelected: true, subscribers: 1, requests: 0 });
  expect(cleanup.protocol.subscriptions.rawOpenInterest).toBe(1);
  expect(cleanup.second).toEqual({ hasDataController: false, panes: 1, apis: 0 });
  expect(cleanup.firstOrderFlowRows).toContain('volume');

  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.close(), firstId);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.subscribers)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest)).toBe(0);
  await expect.poll(() => page.evaluate(() => {
    const feed = (window as any).__terminal.feed;
    return { cvdClients: feed.diagnostics.cvd?.clients, cvdSubscriptions: feed.protocolDiagnostics().subscriptions.cvd };
  })).toEqual({ cvdClients: 0, cvdSubscriptions: 0 });
  const finalCleanup = await page.evaluate(id => {
    const terminal = (window as any).__terminal, remaining = terminal.panels.get(id);
    return { panels: terminal.panels.size, chartBars: remaining?.diagnostics().bars,
      chartVisible: remaining?.engine.visible, chartPanes: remaining?.engine.chart.panes().length,
      rawOISubscribers: terminal.feed.diagnostics.rawOpenInterest?.subscribers,
      rawOIListeners: terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest,
      cvdClients: terminal.feed.diagnostics.cvd?.clients,
      cvdListeners: terminal.feed.protocolDiagnostics().subscriptions.cvd };
  }, secondId);
  expect(finalCleanup).toEqual({ panels: 1, chartBars: 5000, chartVisible: true, chartPanes: 1,
    rawOISubscribers: 0, rawOIListeners: 0, cvdClients: 0, cvdListeners: 0 });
  expect(errors).toEqual([]);
  await writeFile('artifacts/composition-r2-combined-multichart.json', JSON.stringify({ fixture, initial: secondInitial,
    hiddenSource, beforeSleep, asleep: { data: asleep.data, visible: asleep.visible }, awake: { data: awake.data,
      output: awake.output, smaCurrent: awake.smaCurrent }, cleanup, finalCleanup }, null, 2));
});

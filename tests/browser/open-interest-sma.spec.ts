import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('explicit raw BTC Open Interest fixture feeds a chart-scoped SMA and survives an independent move and hidden source', async ({ page }) => {
  test.setTimeout(90_000);
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

  await addIndicator(panel, 'Open Interest');
  const openInterest = () => panel.locator('.active-indicator[data-definition-id="native.raw-open-interest"]');
  await expect(openInterest()).toBeVisible();
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics().subscribed, panelId)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.protocolDiagnostics().subscriptions.rawOpenInterest)).toBe(1);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.fixtureSelected)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.subscribers)).toBe(1);

  const inject = async (bump: number) => page.evaluate(bumpValue => {
    const now = Date.now(), from = now - 4 * 60 * 60_000, venues = ['binance', 'hyperliquid', 'bybit'];
    const unitVerification = Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit browser recorder fixture' }]));
    const feeds = Object.fromEntries(venues.map(venue => [venue, { state: 'ready', source: `${venue}-recorder fixture`, lastObservedAt: now - 30_000,
      expectedIntervalMs: 30_000, stale: false, unitVerification: unitVerification[venue] }]));
    const observations = venues.flatMap((venue, venueIndex) => Array.from({ length: 20 }, (_, index) => {
      const sourceTimeMs = now - 600_000 + index * 30_000, value = 100 + venueIndex * 50 + index + bumpValue;
      return { venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', sourceTimeMs, observedAtMs: sourceTimeMs + 500,
        epoch: 1, value, valueDecimal: String(value), units: 'BTC', source: `${venue}-recorder fixture`, sourceTimeQuality: 'collector-sampled',
        quality: 'valid', gapBefore: index === 10 };
    }));
    (window as any).__terminal.feed.send({ type: 'raw-open-interest-fixture', payload: { version: 1, market: 'perpetual', nativeSymbol: 'BTC',
      semantics: 'observed-open-interest-level', units: 'BTC', from, to: now, asOfMs: now, venues, unitVerification, observations,
      truncated: false, invalidRows: 0, expectedIntervalMs: 30_000, retentionDays: 7, feeds, history: 'Explicit browser fixture: persisted raw perpetual OI records.' } });
  }, bump);
  await inject(0);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.rawOpenInterest?.history?.retained)).toBe(60);

  const read = () => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), instance = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    const totalId = `output:${instance.instanceId}:openInterestTotalBtc`, source = current.outputRegistry.get(totalId);
    const sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    const derivedSource = sma && current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    const consumer = sma && current.outputRegistry.diagnostics().consumers.find((item: any) => item.instanceId === sma.instanceId);
    const frame = current.openInterestData.viewFrame();
    const compact = (output: any) => output && ({ revision: output.revision, contextRevision: output.contextRevision, available: output.available,
      quality: output.quality, quantity: output.quantity, unit: output.unit, timestampConvention: output.timestampConvention,
      resets: output.resets, valueCount: output.values.length, nonNullCount: output.values.filter((value: number | null) => value !== null).length,
      tail: output.values.slice(-20) });
    return { instanceId: instance.instanceId, output: compact(source), totalId, frame: { quality: frame.quality,
      lines: [...frame.lines.values()].map((line: any) => ({ id: line.id, points: line.points.slice(-2) })) }, smaId: sma?.instanceId,
      sma, derived: compact(derivedSource), consumer, sourcePane: current.openInterestView?.paneIndex() ?? -1,
      smaPane: sma ? current.compositionApis.get(sma.instanceId)?.paneIndex ?? -1 : -1,
      smaApiVisible: sma ? current.compositionApis.get(sma.instanceId)?.visible() : undefined,
      seriesInterval: current.openInterestData.series.interval,
      data: current.openInterestData.diagnostics() };
  }, panelId);
  await expect.poll(async () => (await read()).output?.available).toBe(true);
  const initial = await read();
  expect(initial.output).toMatchObject({ available: true, quantity: 'level', unit: 'BTC', timestampConvention: 'candle-open', quality: 'partial' });
  expect(initial.output.nonNullCount).toBeGreaterThan(0);
  expect(initial.output.resets.length).toBeGreaterThan(0);
  expect(initial.frame.lines.find((line: any) => line.id === 'total')?.points.at(-1)).toMatchObject({ unit: 'BTC', source: 'verified perpetual venues' });
  expect(initial.frame.lines.find((line: any) => line.id === 'binance')?.points.at(-1)).toMatchObject({ source: 'binance-recorder fixture', sourceTimeQuality: 'collector-sampled' });

  await openInterest().getByRole('button', { name: 'Add moving average to Open Interest', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add moving average', exact: true });
  await add.getByLabel('Indicator output').selectOption(initial.totalId);
  await add.getByLabel('Length').fill('3');
  await add.getByRole('button', { name: 'Add SMA', exact: true }).click();
  const smaRow = () => panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await expect(smaRow()).toBeVisible();
  await expect.poll(async () => (await read()).consumer?.current).toBe(true);
  const chained = await read();
  expect(chained.sma.numericInputs.source).toMatchObject({ instanceId: initial.instanceId, outputId: initial.totalId, unit: 'BTC' });
  expect(chained.derived?.available).toBe(true);
  expect(chained.derived.nonNullCount).toBeGreaterThan(0);
  expect(chained.sourcePane).toBe(chained.smaPane);

  await smaRow().locator('button[data-indicator-action="move"]').click();
  const move = page.getByRole('dialog', { name: 'Move indicator', exact: true });
  await move.getByLabel('Move to pane').selectOption('@new');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(async () => { const state = await read(); return state.sourcePane !== state.smaPane && state.smaPane >= 0; }).toBe(true);
  const moved = await read();
  expect(moved.sma.numericInputs.source).toEqual(chained.sma.numericInputs.source);

  await openInterest().getByRole('button', { name: 'Hide Open Interest', exact: true }).click();
  await expect(panel.locator('[data-open-interest="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).openInterestData.diagnostics(), panelId))
    .toMatchObject({ demanded: true, subscribed: true });
  const before = await read();
  await inject(100);
  await expect.poll(async () => { const state = await read(); return state.output?.revision > before.output.revision
    && state.derived?.revision > before.derived.revision && state.consumer?.current; }).toBe(true);
  const after = await read();
  expect(after.sma.numericInputs.source).toEqual(before.sma.numericInputs.source);
  expect(after.output.tail).not.toEqual(before.output.tail);
  expect(after.derived.tail).not.toEqual(before.derived.tail);
  expect(after.data).toMatchObject({ demanded: true, subscribed: true });

  const beforeTimeframe = await read();
  await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    const sma = current.selection.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
    current.outputRegistry.unregisterConsumer(sma.instanceId);
  }, panelId);
  await expect.poll(async () => (await read()).consumer).toBeUndefined();
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id);
    return current.selection.interval;
  }, panelId)).toBe('5m');
  await expect.poll(async () => (await read()).seriesInterval).toBe('5m');
  const fiveMinute = await read();
  expect(fiveMinute.data.contextRevision).toBe(beforeTimeframe.data.contextRevision + 1);
  expect(fiveMinute.data.subscriptionStarts).toBe(beforeTimeframe.data.subscriptionStarts);
  expect(fiveMinute.data.subscribed).toBe(true);
  expect(fiveMinute.output.contextRevision).toBe(fiveMinute.data.contextRevision);
  expect(fiveMinute.output.valueCount).toBe(5000);
  expect(fiveMinute.output.tail).not.toEqual(beforeTimeframe.output.tail);
  const tailTimes = await page.evaluate(id => {
    const current = (window as any).__terminal.panels.get(id), instance = current.selection.indicators.find((item: any) => item.definitionId === 'native.raw-open-interest');
    return current.outputRegistry.get(`output:${instance.instanceId}:openInterestTotalBtc`).times.slice(-10);
  }, panelId);
  expect(tailTimes.every((time: number, index: number) => index === 0 || time - tailTimes[index - 1]! === 5 * 60_000)).toBe(true);
  await expect.poll(async () => (await read()).consumer?.current).toBe(true);
  const rebound = await read();
  expect(rebound.smaApiVisible).toBe(true);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('OpenAlgo 2.6 comparison handles share a common percentage baseline and preserve price gaps', async ({ page }) => {
  await page.goto('/?fixture=1');
  const result = await page.evaluate(async () => {
    // The installed browser build is the authority for this host integration.
    // @ts-expect-error Vite's optimized browser entry is available only in the browser dev server.
    const charts = await import(/* @vite-ignore */ '/node_modules/.vite/deps/openalgo-charts.js') as typeof import('openalgo-charts');
    const host = document.createElement('div');
    Object.assign(host.style, { width: '800px', height: '500px', position: 'fixed', left: '-1200px', top: '0' });
    document.body.append(host);
    const chart = charts.createChart(host, { renderer: 'canvas2d', timezone: 'UTC', branding: false, watermark: false });
    const times = [1_800_000_000, 1_800_000_060, 1_800_000_120, 1_800_000_180];
    const item = (time: number, close: number) => ({ time, open: close, high: close, low: close, close });
    const primary = chart.addSeries('line', { style: { color: '#c7c7c7', priceLineVisible: false, lastValueVisible: false } });
    primary.setData([item(times[0]!, 100), item(times[1]!, 110), item(times[2]!, 105), item(times[3]!, 120)]);
    const comparisons = charts.comparisonController(chart, { mode: 'percentage', baseline: 'common' });
    const nasdaq = comparisons.add({ symbol: 'xyz:XYZ100', color: '#70b9b0', bars: [item(times[0]!, 5000), item(times[1]!, 5500), item(times[3]!, 6000)] });
    const gold = comparisons.add({ symbol: 'xyz:GOLD', color: '#d2aa59', bars: [item(times[0]!, 2000), item(times[1]!, 2200), item(times[2]!, 2100), item(times[3]!, 2400)] });
    comparisons.setBaseline('common');
    chart.fitContent();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const baselineTime = comparisons.baselineTime();
    const primaryBaseline = primary.getData().find(bar => bar.time === baselineTime)?.close ?? null;
    const nasdaqBaseline = nasdaq.barAt(baselineTime ?? -1)?.close ?? null;
    const goldBaseline = gold.barAt(baselineTime ?? -1)?.close ?? null;
    const y = [
      primary.priceScale().priceToY(110),
      nasdaq.priceScale().priceToY(5500),
      gold.priceScale().priceToY(2200),
    ];
    const gap = nasdaq.barAt(times[2]!);
    const alignment = nasdaq.alignment();
    const sameNasdaqSeries = nasdaq.series;
    nasdaq.setBars([item(times[0]!, 5000), item(times[1]!, 5500), item(times[2]!, 5250), item(times[3]!, 6000)]);
    const updateRetainedHandle = sameNasdaqSeries === nasdaq.series;
    const actualPriceAfterUpdate = nasdaq.barAt(times[3]!)?.close ?? null;
    const priceScales = [primary.priceScale().options.mode, nasdaq.priceScale().options.mode, gold.priceScale().options.mode];
    comparisons.destroy(); chart.destroy(); host.remove();
    return { baselineTime, primaryBaseline, nasdaqBaseline, goldBaseline, y, gap, alignment, updateRetainedHandle, actualPriceAfterUpdate, priceScales };
  });

  expect(result.baselineTime).toBe(1_800_000_000);
  expect([result.primaryBaseline, result.nasdaqBaseline, result.goldBaseline]).toEqual([100, 5000, 2000]);
  expect(result.priceScales).toEqual(['percentage', 'percentage', 'percentage']);
  expect(result.y[0]).toBeCloseTo(result.y[1], 5);
  expect(result.y[0]).toBeCloseTo(result.y[2], 5);
  expect(result.gap).toBeNull();
  expect(result.alignment).toMatchObject({ bars: 4, matched: 3, gaps: 1 });
  expect(result.updateRetainedHandle).toBe(true);
  expect(result.actualPriceAfterUpdate).toBe(6000);
});

test('common mode reports no baseline without a shared timestamp and keeps the available subset comparable', async ({ page }) => {
  await page.goto('/?fixture=1');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite's optimized browser entry is available only in the browser dev server.
    const charts = await import(/* @vite-ignore */ '/node_modules/.vite/deps/openalgo-charts.js') as typeof import('openalgo-charts');
    const host = document.createElement('div');
    Object.assign(host.style, { width: '640px', height: '420px', position: 'fixed', left: '-1200px', top: '0' });
    document.body.append(host);
    const chart = charts.createChart(host, { renderer: 'canvas2d', timezone: 'UTC', branding: false, watermark: false });
    const t = [1_800_000_000, 1_800_000_060, 1_800_000_120, 1_800_000_180];
    const item = (time: number, close: number) => ({ time, open: close, high: close, low: close, close });
    const primary = chart.addSeries('line', { style: { color: '#c7c7c7', priceLineVisible: false, lastValueVisible: false } });
    primary.setData([item(t[0]!, 100), item(t[1]!, 110)]);
    const comparisons = charts.comparisonController(chart, { mode: 'percentage', baseline: 'common' });
    const nonOverlapping = comparisons.add({ symbol: 'xyz:SP500', color: '#c99755', bars: [item(t[2]!, 5000), item(t[3]!, 5500)] });
    comparisons.setBaseline('common'); chart.fitContent();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const noCommon = { baseline: comparisons.baselineTime(), sourceBarAtPrimary: nonOverlapping.barAt(t[0]!), alignment: nonOverlapping.alignment() };
    comparisons.remove(nonOverlapping);
    const available = comparisons.add({ symbol: 'xyz:XYZ100', color: '#65b4a8', bars: [item(t[0]!, 5000), item(t[1]!, 5500)] });
    comparisons.setBaseline('common'); chart.fitContent();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const withAvailableSource = {
      baseline: comparisons.baselineTime(),
      availableSources: comparisons.list().map(handle => handle.symbol),
      primaryY: primary.priceScale().priceToY(110),
      comparisonY: available.priceScale().priceToY(5500),
      price: available.barAt(t[1]!)?.close ?? null,
    };
    comparisons.destroy(); chart.destroy(); host.remove();
    return { noCommon, withAvailableSource };
  });

  expect(result.noCommon.baseline).toBeNull();
  expect(result.noCommon.sourceBarAtPrimary).toBeNull();
  expect(result.withAvailableSource).toMatchObject({ baseline: 1_800_000_000, availableSources: ['xyz:XYZ100'], price: 5500 });
  expect(result.withAvailableSource.primaryY).toBeCloseTo(result.withAvailableSource.comparisonY, 5);
});

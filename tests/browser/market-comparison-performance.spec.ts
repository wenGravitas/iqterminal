import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('records local chart draw intervals under repeated five-line fixture updates', async ({ page }) => {
  test.setTimeout(60_000);
  const publicRequests: string[] = [];
  await page.context().route('https://api.hyperliquid.xyz/info', async route => {
    publicRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Market Comparison', exact: true }).click();
  const panel = page.locator('.market-comparison-panel');
  await expect(panel.locator('.market-comparison-status')).toContainText('5/5 connected', { timeout: 15_000 });
  await panel.getByLabel('Comparison window').selectOption('24h');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].sources.every((source: any) => source.bars >= 1_440))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.feed.send({ type: 'diagnostics' });
    return terminal.feed.diagnostics.comparison?.transport;
  })).toBe('fixture');
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    for (const panel of [...terminal.dock.panels]) if (panel.view.contentComponent === 'candle') terminal.dock.removePanel(panel);
  });
  await expect.poll(() => page.evaluate(() => {
    const panel = [...(window as any).__terminal.marketComparisons.values()][0];
    const range = panel.chartHost.chart.getVisibleLogicalRange(), length = panel.primarySeries.getData().length;
    return Math.max(0, Math.min(length - 1, Math.floor(range.to)) - Math.max(0, Math.ceil(range.from)) + 1);
  })).toBeGreaterThanOrEqual(1_440);

  const result = await page.evaluate(async () => {
    const terminal = (window as any).__terminal;
    const panel = [...terminal.marketComparisons.values()][0];
    const beforeDraws = panel.diagnostics().drawStats;
    terminal.resetMetrics();
    panel.chartHost.stats.frameIntervalsMs.length = 0;
    panel.chartHost.stats.lastDrawAt = 0;
    const start = performance.now();
    let submittedUpdateFrames = 0;
    await new Promise<void>(resolve => {
      const update = () => {
        if (performance.now() - start >= 8_000) { resolve(); return; }
        const symbol = ['BTC', 'xyz:XYZ100', 'xyz:SP500', 'xyz:GOLD', 'xyz:CL'][submittedUpdateFrames % 5];
        const instrument = panel.config.instruments.find((item: any) => item.identity.symbol === symbol);
        const source = panel.sources.get(symbol), previous = source?.candles.at(-1);
        if (instrument && previous) {
          const delta = Math.sin(submittedUpdateFrames / 11) * 0.00002;
          const close = previous.c * (1 + delta);
          panel.onFeedEvent({ type: 'comparison-patch', ids: ['local-perf-sample'], identity: instrument.identity,
            candles: [{ ...previous, o: previous.o, h: Math.max(previous.h, close), l: Math.min(previous.l, close), c: close,
              revision: submittedUpdateFrames + 100, closed: false }],
            status: { state: 'live', connection: 'connected', message: 'Explicit synthetic benchmark update',
              lastCandleAt: Date.now(), quietMs: 0, retainedBars: source.candles.length } });
        }
        submittedUpdateFrames++;
        requestAnimationFrame(update);
      };
      requestAnimationFrame(update);
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const stats = terminal.stats(), comparison = panel.diagnostics();
    const range = panel.chartHost.chart.getVisibleLogicalRange(), dataLength = panel.primarySeries.getData().length;
    const intervals = [...comparison.drawIntervalsMs].sort((a: number, b: number) => a - b);
    const percentile = (fraction: number) => intervals.length ? Math.round(intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))] * 10) / 10 : null;
    const tasks = [...stats.longTasks].sort((a: number, b: number) => a - b);
    return {
      durationMs: Math.round(performance.now() - start),
      submittedUpdateFrames,
      observedChartDraws: comparison.drawStats - beforeDraws,
      drawIntervalCount: intervals.length,
      observedDrawIntervalMs: { p50: percentile(.5), p95: percentile(.95), max: intervals.at(-1) === undefined ? null : Math.round(intervals.at(-1) * 10) / 10 },
      longTasks: { count: tasks.length, p95Ms: tasks.length ? Math.round(tasks[Math.min(tasks.length - 1, Math.floor(tasks.length * .95))] * 10) / 10 : 0,
        maxMs: tasks.length ? Math.round(tasks.at(-1)! * 10) / 10 : 0 },
      retainedBars: comparison.sources.map((source: any) => ({ symbol: source.symbol, bars: source.bars })),
      visibleDataBars: Math.max(0, Math.min(dataLength - 1, Math.floor(range.to)) - Math.max(0, Math.ceil(range.from)) + 1),
      plotWidth: panel.chartHost.chart.plotRect(0)?.width ?? 0,
      visible: comparison.visible,
      transport: terminal.feed.diagnostics.comparison?.transport,
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, viewport: `${innerWidth}x${innerHeight}` },
    };
  });
  console.log(`Local Market Comparison fixture measurements: ${JSON.stringify(result)}`);
  expect(result.transport).toBe('fixture');
  expect(result.retainedBars).toHaveLength(5);
  expect(result.retainedBars.every((source: any) => source.bars >= 1_440)).toBe(true);
  expect(result.visibleDataBars).toBeGreaterThanOrEqual(1_440);
  expect(result.submittedUpdateFrames).toBeGreaterThan(20);
  expect(result.observedChartDraws).toBeGreaterThan(20);
  expect(result.drawIntervalCount).toBeGreaterThan(20);
  expect(publicRequests).toEqual([]);
});

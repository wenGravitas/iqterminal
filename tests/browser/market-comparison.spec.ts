import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function expectRightLabelsMatchLegend(page: import('@playwright/test').Page) {
  const snapshot = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const baselineTime = instance.currentBaselineTime();
    const sources: Array<{ symbol: string; baselineTime: number | null; latest: { t: number; c: number; revision: number } | null; expected: string | null }> = instance.config.instruments.filter((item: any) => item.visible).map((item: any) => {
      const symbol = item.identity.symbol, source = instance.sources.get(symbol), latest = source?.candles.at(-1);
      const baseline = instance.baselineClose(symbol), percent = latest && baseline ? (latest.c / baseline - 1) * 100 : null;
      return { symbol, baselineTime, latest: latest ? { t: latest.t, c: latest.c, revision: latest.revision } : null,
        expected: percent === null ? null : `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%` };
    });
    const labels = [...document.querySelectorAll<HTMLElement>('.market-comparison-right-label')].map(label => ({ text: label.textContent ?? '', title: label.title }));
    const legend: Array<{ symbol: string; value: string; title: string }> = [...document.querySelectorAll<HTMLElement>('.market-comparison-legend-item')].map(row => ({
      symbol: row.children[1]?.textContent ?? '', value: row.children[2]?.textContent ?? '', title: row.title,
    }));
    const expectedRows = sources.map(source => {
      const market = legend.find(row => row.title.startsWith(`${source.symbol} ·`));
      const shortLabel = market?.symbol ?? '';
      return { ...source, shortLabel, text: `${shortLabel} ${source.expected ?? ''}` };
    });
    const matches = expectedRows.length === labels.length && expectedRows.every((row: (typeof expectedRows)[number]) => row.expected !== null && row.baselineTime !== null
      && legend.some(value => value.symbol === row.shortLabel && value.value === row.expected)
      && labels.some(label => label.text === row.text && label.title.endsWith(`from ${new Date(row.baselineTime! * 1000).toISOString()}`)));
    return { baselineTime, sources, labels, legend, matches };
  });
  expect(snapshot.matches, JSON.stringify(snapshot, null, 2)).toBe(true);
}

test('direct Hyperliquid comparison history and stream render, configure, and restore', async ({ page }) => {
  test.setTimeout(90_000);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('api.hyperliquid.xyz/info')) requests.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Market Comparison', exact: true }).click();
  const panel = page.locator('.market-comparison-panel');
  await expect(panel).toHaveCount(1);
  await expect(panel.locator('.market-comparison-legend-item')).toHaveCount(5);
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(panel.locator('.market-comparison-status')).toContainText('5/5 connected', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    return instance.config.instruments.every((item: any) => {
      const candles = instance.sources.get(item.identity.symbol)?.candles ?? [];
      return candles.length > 0 && candles[0]!.t <= candles.at(-1)!.t - (240 - 1) * 60_000;
    });
  }), { timeout: 60_000 }).toBe(true);
  const historyCoverage: Array<{ symbol: string; count: number; statusRetainedBars: number; first: number; last: number;
    baselineTime: number | null; baselineClose: number | null; gaps: Array<{ from: number; to: number; minutes: number }>;
    ordered: boolean; minuteAligned: boolean; coversFourHours: boolean; containsBaseline: boolean }> = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const baselineTime = instance.currentBaselineTime();
    return instance.config.instruments.map((item: any) => {
      const symbol = item.identity.symbol, source = instance.sources.get(symbol), candles = source.candles;
      const times = candles.map((candle: any) => candle.t);
      const gaps = times.slice(1).map((time: number, index: number) => ({ from: times[index], to: time, minutes: (time - times[index]) / 60_000 }))
        .filter((gap: any) => gap.minutes > 1);
      const baselineClose = instance.baselineClose(symbol);
      return { symbol, count: candles.length, statusRetainedBars: source.status.retainedBars,
        first: times[0], last: times.at(-1), baselineTime, baselineClose, gaps,
        ordered: times.every((time: number, index: number) => index === 0 || time > times[index - 1]),
        minuteAligned: times.every((time: number) => time % 60_000 === 0),
        coversFourHours: times.length > 0 && times[0] <= times.at(-1) - (240 - 1) * 60_000,
        containsBaseline: times.includes(baselineTime * 1000) };
    });
  });
  console.log(`Live comparison history coverage: ${JSON.stringify(historyCoverage)}`);
  expect(historyCoverage).toHaveLength(5);
  for (const source of historyCoverage) {
    expect(source.count).toBeGreaterThan(0);
    expect(source.count).toBeLessThanOrEqual(5000);
    expect(source.ordered, `${source.symbol} must retain venue timestamps in order`).toBe(true);
    expect(source.minuteAligned, `${source.symbol} must retain UTC minute timestamps`).toBe(true);
    expect(source.coversFourHours, `${source.symbol} must span the requested 4h window`).toBe(true);
    expect(source.containsBaseline, `${source.symbol} must contain the common baseline`).toBe(true);
  }
  expect(historyCoverage.every(source => source.baselineTime === historyCoverage[0]!.baselineTime)).toBe(true);
  const initialView = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const range = instance.chartHost.chart.getVisibleLogicalRange();
    const last = instance.primarySeries.getData().length - 1;
    const firstVisible = Math.max(0, Math.ceil(range.from)), lastVisible = Math.min(last, Math.floor(range.to));
    return { range, visibleDataBars: Math.max(0, lastVisible - firstVisible + 1), requestedBars: 240 };
  });
  expect(initialView.visibleDataBars, `initial 4h view was clamped: ${JSON.stringify(initialView)}`).toBeGreaterThanOrEqual(initialView.requestedBars);
  await page.screenshot({ path: '/tmp/iqterminal-market-comparison.png' });
  const diagnostics = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__terminal.stats().marketComparisons[0])));
  console.log(`Market Comparison browser diagnostics: ${JSON.stringify(diagnostics)}`);
  const boxes = await panel.evaluate(element => [...element.querySelectorAll('.market-comparison-stage,.market-comparison-canvas-host,canvas')].map(node => ({ name: node.className || node.tagName, rect: node.getBoundingClientRect().toJSON(), display: getComputedStyle(node).display, position: getComputedStyle(node).position })));
  console.log(`Market Comparison layout boxes: ${JSON.stringify(boxes)}`);
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(5);
  const rightLabels = await panel.locator('.market-comparison-right-label').evaluateAll(labels => labels.map(label => {
    const rect = label.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom };
  }).sort((a, b) => a.top - b.top));
  expect(rightLabels.every((label, index) => index === 0 || rightLabels[index - 1]!.bottom <= label.top + 0.5)).toBe(true);
  await expectRightLabelsMatchLegend(page);

  const beforePan = await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const chart = instance.chartHost.chart, range = chart.getVisibleLogicalRange();
    return { baseline: instance.diagnostics().baselineTime, baselineLabel: document.querySelector('.market-comparison-baseline')?.textContent, range: { from: range.from, to: range.to } };
  });
  await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0], chart = instance.chartHost.chart;
    const range = chart.getVisibleLogicalRange(); chart.setVisibleLogicalRange({ from: range.from - 12, to: range.to - 12 });
  });
  const afterPan = await page.evaluate(() => ({ baseline: [...(window as any).__terminal.marketComparisons.values()][0].diagnostics().baselineTime,
    baselineLabel: document.querySelector('.market-comparison-baseline')?.textContent }));
  expect(afterPan.baseline).toBeLessThan(beforePan.baseline);
  expect(afterPan.baselineLabel).not.toBe(beforePan.baselineLabel);
  await expect(panel.locator('.market-comparison-follow')).toHaveAttribute('data-state', 'paused');
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.marketComparisons.values()][0].config.follow)).toBe('paused');
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(5);
  await expectRightLabelsMatchLegend(page);
  await panel.locator('.market-comparison-follow').click();
  await expect(panel.locator('.market-comparison-follow')).toHaveAttribute('data-state', 'live');
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.marketComparisons.values()][0].diagnostics().baselineTime)).toBeGreaterThan(afterPan.baseline);

  await page.evaluate(() => {
    const instance = [...(window as any).__terminal.marketComparisons.values()][0];
    const identity = instance.config.instruments.find((item: any) => item.identity.symbol === 'xyz:CL').identity;
    instance.onFeedEvent({ type: 'comparison-status', ids: ['browser-check'], identity, status: {
      state: 'unavailable', connection: 'disconnected', message: 'Market unavailable for partial-failure check',
      lastCandleAt: null, quietMs: null, retainedBars: 243,
    } });
  });
  await expect(panel.locator('.market-comparison-legend-item[data-state="unavailable"]')).toHaveCount(1);
  await expect(panel.locator('.market-comparison-message')).toBeHidden();
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(4);
  await expect(panel.locator('.market-comparison-status')).toContainText('CL: Market unavailable for partial-failure check');
  await expect(panel.getByRole('button', { name: 'RETRY', exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Choose comparison markets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Select comparison markets' });
  await expect(dialog).toContainText('HIP-3 macro proxies');
  await dialog.locator('[data-market-selected="xyz:SILVER"]').check();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.locator('.market-comparison-legend-item')).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null')?.version)).toBe(6);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null'));
  expect(Object.values(saved.layout.panels).some((item: any) => item.contentComponent === 'market-comparison'
    && item.params.instruments.some((instrument: any) => instrument.identity.symbol === 'xyz:SILVER'))).toBe(true);

  await page.reload();
  const restored = page.locator('.market-comparison-panel');
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('.market-comparison-legend-item')).toHaveCount(6);
  await expect(restored.locator('.market-comparison-status')).toContainText('connected', { timeout: 60_000 });
});

test('staging build keeps comparison requests on the direct Hyperliquid public API', async ({ page }) => {
  test.skip(process.env.VITE_DATA_MODE !== 'staging', 'Run against a VITE_DATA_MODE=staging build.');
  test.setTimeout(90_000);
  const requests: { url: string; body: any }[] = [];
  page.on('request', request => {
    if (request.url().includes('api.hyperliquid.xyz')) {
      let body: any = null;
      try { body = request.postDataJSON(); } catch { /* WebSocket and non-JSON requests have no info body. */ }
      requests.push({ url: request.url(), body });
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Market Comparison', exact: true }).click();
  const panel = page.locator('.market-comparison-panel');
  await expect(panel.locator('.market-comparison-status')).toContainText('5/5 connected', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketComparisons[0].sources.filter((source: any) => source.bars > 0).length), { timeout: 60_000 }).toBe(5);

  const worker = await page.evaluate(async () => {
    const terminal = (window as any).__terminal;
    terminal.feed.send({ type: 'diagnostics' });
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (terminal.feed.diagnostics.comparison) return terminal.feed.diagnostics;
    }
    return terminal.feed.diagnostics;
  });
  expect(worker.comparison).toMatchObject({ transport: 'direct', activeIdentities: 5, socket: 'connected' });
  expect(worker.staging).toBeTruthy();
  expect(requests.length).toBeGreaterThan(0);
  expect(new Set(requests.map(request => request.url))).toEqual(new Set(['https://api.hyperliquid.xyz/info']));
  expect(requests.some(request => request.body?.type === 'meta' && request.body.dex === 'xyz')).toBe(true);
  expect(new Set(requests.filter(request => request.body?.type === 'candleSnapshot').map(request => request.body.req.coin)))
    .toEqual(new Set(['BTC', 'xyz:XYZ100', 'xyz:SP500', 'xyz:GOLD', 'xyz:CL']));
  await expect(panel.locator('.market-comparison-right-label')).toHaveCount(5);
});

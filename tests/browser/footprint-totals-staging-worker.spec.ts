import { expect, test, type BrowserContext, type Route } from '@playwright/test';
import { addIndicator, setFootprint } from './indicator-actions';

const STEP_MS = 5 * 60_000;
const STEP_SECONDS = STEP_MS / 1000;
const FOUR_HOURS_MS = 4 * 60 * 60_000;
const TAIL_REASON = 'not yet confirmed by durable execution watermark';

type HistoryRequest = { from: number; to: number; interval: string; rowPrice: number; requestIndex: number };

function bar(timeMs: number, delta: number, revision: number, coverage: 'partial' | 'observed' = 'observed') {
  const bidVol = Math.max(0, -delta), askVol = Math.max(0, delta), price = 83_000;
  return {
    time: timeMs / 1000, revision, rowSize: 25,
    cells: delta === 0 ? [] : [{ price, bidVol, askVol, bidNotional: bidVol * price, askNotional: askVol * price }],
    open: price, high: price + 25, low: price - 25, close: price + 10,
    delta, minDelta: Math.min(0, delta), maxDelta: Math.max(0, delta),
    quoteDelta: delta * price, minQuoteDelta: Math.min(0, delta) * price, maxQuoteDelta: Math.max(0, delta) * price,
    source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade', coverage, gapBefore: false,
    aggregateRecordCount: delta === 0 ? 0 : 1,
  };
}

function intervalMs(interval: string) {
  return interval === '5m' ? STEP_MS : interval === '1m' ? 60_000 : 300_000;
}

function historyDelta(timeMs: number, currentStart: number, correction: boolean) {
  if (correction && timeMs >= currentStart - 51 * STEP_MS && timeMs <= currentStart - 2 * STEP_MS) return 100;
  if (timeMs === currentStart - 3 * STEP_MS) return 60;
  if (timeMs === currentStart - 2 * STEP_MS) return -80;
  if (timeMs === currentStart - STEP_MS) return -40;
  return 20;
}

function nativeCandles(interval: string) {
  const step = intervalMs(interval), currentStart = Math.floor(Date.now() / step) * step;
  return Array.from({ length: 1000 }, (_, index) => {
    const t = currentStart - (999 - index) * step;
    const close = 83_000 + (index % 7) * 5;
    return { t, o: close - 5, h: close + 15, l: close - 15, c: close, v: 10 + index % 30, revision: 1, closed: t < currentStart };
  });
}

function stagingStatus(lastUpdate = Date.now()) {
  return { state: 'live', message: 'Explicit worker-backed staging browser fixture', lastUpdate };
}

function historyCoverage(from: number, to: number) {
  return { from, to, complete: true, gaps: [] };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installWorkerStagingFixture(context: BrowserContext) {
  let releaseNativeBootstrap!: () => void;
  const nativeBootstrapGate = new Promise<void>(resolve => { releaseNativeBootstrap = resolve; });
  const fixture = {
    nativeBootstrapHeld: false,
    releaseNativeBootstrap: () => releaseNativeBootstrap(),
    nativeRequests: [] as Array<{ interval: string; count: number }>,
    bootstrapRequests: [] as string[],
    preparedRequests: [] as HistoryRequest[],
    currentStart: 0,
    correction: false,
    externalHttp: [] as string[],
  };

  await context.route('**/market-data/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/market-data/v1/native-candles') {
      const interval = url.searchParams.get('interval') ?? '1m', candles = nativeCandles(interval);
      fixture.nativeRequests.push({ interval, count: candles.length });
      // Hold the first bootstrap until the real DedicatedWorker has installed
      // its synthetic socket, so no public connection can escape before it.
      fixture.nativeBootstrapHeld = true;
      await nativeBootstrapGate;
      await fulfillJson(route, { source: 'binance-native-kline', candles });
      return;
    }
    if (url.pathname === '/market-data/v1/footprints') {
      const interval = url.searchParams.get('interval') ?? '5m', step = intervalMs(interval);
      let now = Date.now(), start = Math.floor(now / step) * step;
      const boundaryDelay = start + 2500 - now;
      if (boundaryDelay > 0) await new Promise(resolve => setTimeout(resolve, boundaryDelay));
      now = Date.now();
      fixture.currentStart = Math.floor(now / step) * step;
      fixture.bootstrapRequests.push(url.search);
      const currentStart = fixture.currentStart;
      const prior = [
        bar(currentStart - 3 * step, 60, 1),
        bar(currentStart - 2 * step, -80, 1),
        bar(currentStart - step, -40, 1),
        bar(currentStart, 0, 1, 'partial'),
      ];
      const coverage = {
        confirmedFrom: currentStart - 100 * step,
        confirmedTo: now - 1500,
        gaps: [{ from: now - 1500, to: now, reason: TAIL_REASON }],
      };
      await fulfillJson(route, {
        version: 1, source: 'binance-usdm-aggtrade', bars: prior,
        watermark: 100, cursor: 100, coverage, tickSize: 0.1,
        status: stagingStatus(now),
      });
      return;
    }
    if (url.pathname === '/market-data/v2/history/footprints') {
      const from = Number(url.searchParams.get('from'));
      const to = Number(url.searchParams.get('to'));
      const interval = url.searchParams.get('interval') ?? '5m';
      const rowPrice = Number(url.searchParams.get('rowPrice'));
      const step = intervalMs(interval);
      fixture.preparedRequests.push({ from, to, interval, rowPrice, requestIndex: fixture.preparedRequests.length });
      if (![from, to, rowPrice].every(Number.isFinite) || from >= to || to - from > FOUR_HOURS_MS || rowPrice !== 25) {
        await fulfillJson(route, { error: `Invalid or over-cap fixture history request: ${url.search}` }, 400);
        return;
      }
      const tiles = [];
      for (let start = from; start < to; start += step) {
        const delta = interval === '5m' ? historyDelta(start, fixture.currentStart, fixture.correction) : 20;
        tiles.push({ from: start, revision: fixture.correction ? 2 : 1,
          bar: { ...bar(start, delta, fixture.correction ? 2 : 1), rowSize: rowPrice },
          coverage: historyCoverage(start, start + step) });
      }
      await fulfillJson(route, { version: 1, feed: 'binance:perpetual:BTCUSDT:aggregate-trade', state: 'ready', tiles });
      return;
    }
    if (url.pathname === '/market-data/v1/level-watches') {
      await fulfillJson(route, { version: 1, cursor: 0, watches: [], events: [] });
      return;
    }
    await fulfillJson(route, { error: `No explicit fixture route for ${url.pathname}` }, 404);
  });

  // A staging browser integration fixture must never reach public exchange APIs.
  await context.route(/^https:\/\/(?:fapi\.binance\.com|api\.binance\.com|api\.hyperliquid\.xyz)\//, async route => {
    fixture.externalHttp.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  return fixture;
}

async function installSyntheticWorkerSocket(worker: import('@playwright/test').Worker) {
  await worker.evaluate(() => {
    const state: any = (self as any).__deltaFlipWorkerFixture = {
      sockets: [] as any[], subscriptions: [] as any[], acks: [] as number[],
      externalSockets: [] as string[], executions: 0,
    };
    class SyntheticSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = SyntheticSocket.CONNECTING;
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;
      footprint = false;
      readonly url: string;
      constructor(url: string | URL) {
        this.url = String(url);
        if (!this.url.includes('/market-data/v1/stream') && !this.url.includes('/market-data/v1/level-watches/stream')) state.externalSockets.push(this.url);
        state.sockets.push(this);
        queueMicrotask(() => { this.readyState = SyntheticSocket.OPEN; this.onopen?.({}); });
      }
      send(raw: string) {
        if (this.url.includes('/market-data/v1/level-watches/stream')) {
          this.emit({ version: 1, cursor: 0, watches: [], events: [] });
          return;
        }
        let message: any;
        try { message = JSON.parse(String(raw)); } catch { return; }
        if (message.type === 'ack' && Number.isFinite(message.cursor)) { state.acks.push(message.cursor); return; }
        if (message.type !== 'subscribe') return;
        this.footprint = message.interval === undefined;
        state.subscriptions.push({ interval: message.interval, after: message.after, footprint: this.footprint, url: this.url });
        const now = Date.now();
        this.emit({ type: 'health', watermark: { id: this.footprint ? 100 : 0 }, collector: { state: 'live', lastUpdate: now } });
      }
      emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
      close() { if (this.readyState === SyntheticSocket.CLOSED) return; this.readyState = SyntheticSocket.CLOSED; this.onclose?.({}); }
    }
    (globalThis as any).WebSocket = SyntheticSocket;
    state.sendExecution = (currentStart: number) => {
      const socket = state.sockets.find((candidate: any) => candidate.footprint && candidate.readyState === SyntheticSocket.OPEN);
      if (!socket) throw new Error('Synthetic staging footprint socket is not open');
      const timeMs = Date.now(), coverage = {
        confirmedFrom: currentStart - 100 * 5 * 60_000,
        confirmedTo: Math.max(currentStart + 1, timeMs - 1500),
        gaps: [{ from: Math.max(currentStart + 1, timeMs - 1500), to: timeMs, reason: 'not yet confirmed by durable execution watermark' }],
      };
      state.executions++;
      socket.emit({ type: 'executions', version: 1, after: 100, cursor: 101, watermark: 101,
        executions: [{ id: 101, timeMs, price: 83_000, quantity: 60, quoteNotional: 4_980_000, side: 'buy', market: 'perpetual' }],
        coverage, collector: { state: 'live', lastUpdate: timeMs }, sentAt: timeMs });
      return timeMs;
    };
    state.snapshot = () => ({ subscriptions: state.subscriptions, acks: state.acks, externalSockets: state.externalSockets, executions: state.executions });
  });
}

async function workerFixtureState(worker: import('@playwright/test').Worker) {
  return worker.evaluate(() => (self as any).__deltaFlipWorkerFixture.snapshot());
}

async function readFlip(page: import('@playwright/test').Page, time: number) {
  return page.evaluate(at => {
    const panel = [...(window as any).__terminal.panels.values()][0] as any;
    const engine = panel.engine, id = 'native.footprint-totals';
    const index = engine.chart.dataLayer.timeToIndex(at);
    const x = engine.chart.timeScale.indexToX(index);
    return engine.footprintTotalsHover(id, at, x, 39)?.deltaFlip ?? null;
  }, time);
}

test('staging worker history warms delta flips, accepts corrections, and streams a live preview', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installWorkerStagingFixture(context);

  // No ?fixture=1: this uses VITE_DATA_MODE=staging and the actual dedicated feed worker.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => fixture.nativeBootstrapHeld, { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.workers().some(worker => worker.url().includes('worker')), { timeout: 20_000 }).toBe(true);
  const worker = page.workers().find(candidate => candidate.url().includes('worker'));
  expect(worker, 'the real market-data DedicatedWorker is running').toBeTruthy();
  await installSyntheticWorkerSocket(worker!);
  fixture.releaseNativeBootstrap();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  const panel = page.locator('.candle-panel').first();
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal;
    return t.feed.protocolDiagnostics().commandTypes['footprint-subscribe'] ?? 0;
  }), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => fixture.bootstrapRequests.some(query => query.includes('interval=5m')), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => fixture.preparedRequests.some(request => request.interval === '5m'), { timeout: 30_000 }).toBe(true);
  const beforeTotalsRequests = fixture.preparedRequests.length;
  await addIndicator(panel, 'Footprint Totals');
  await expect.poll(() => fixture.preparedRequests.length, { timeout: 30_000 }).toBeGreaterThan(beforeTotalsRequests);

  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.send({ type: 'diagnostics' });
    const chart = [...t.panels.values()][0] as any;
    const totals = chart.engine.footprintTotalsDiagnostics()[0];
    return { fixture: t.fixture, mode: t.feed.feedStatusSnapshot().find((item: any) => item.kind === 'candles')?.mode,
      staging: t.feed.diagnostics.staging?.source, flipEnabled: totals?.deltaFlip.enabled,
      lookback: totals?.deltaFlip.lookback, summaries: totals?.deltaFlip.summaries };
  }), { timeout: 30_000 }).toMatchObject({ fixture: false, mode: 'recorded', staging: 'staging', flipEnabled: true, lookback: 50 });
  await expect.poll(async () => (await workerFixtureState(worker!)).subscriptions.some((item: any) => item.footprint), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => fixture.preparedRequests.some(request => request.interval === '5m'), { timeout: 30_000 }).toBe(true);

  const currentStart = fixture.currentStart;
  expect(currentStart).toBeGreaterThan(0);
  await worker!.evaluate(start => (self as any).__deltaFlipWorkerFixture.sendExecution(start), currentStart);
  await expect.poll(async () => (await workerFixtureState(worker!)).acks.includes(101), { timeout: 20_000 }).toBe(true);
  const currentTime = currentStart / 1000;
  const negativeTime = currentTime - 2 * STEP_SECONDS;
  const panelInstanceId = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].params.api.id);

  // Narrow the viewport to a few recent bars; the separate summary range must
  // still span the full 50-bar reference window plus the predecessor.
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const last = p.engine.series.getData().length - 1;
    p.engine.chart.setVisibleLogicalRange({ from: last - 4, to: last + 1 });
  });
  await expect.poll(() => readFlip(page, currentTime), { timeout: 30_000 }).toMatchObject({
    kind: 'flip', direction: 'positive', strengthBand: 'strong', lifecycle: 'live', previousDelta: -40, currentDelta: 60,
  });
  await expect.poll(() => readFlip(page, negativeTime), { timeout: 20_000 }).toMatchObject({
    kind: 'flip', direction: 'negative', strengthBand: 'strong', lifecycle: 'closed', previousDelta: 60, currentDelta: -80,
  });

  const fiveMinuteRequests = fixture.preparedRequests.filter(request => request.interval === '5m');
  expect(fiveMinuteRequests.length).toBeGreaterThanOrEqual(3);
  expect(fiveMinuteRequests.every(request => request.to - request.from <= FOUR_HOURS_MS)).toBe(true);
  const requestedFrom = Math.min(...fiveMinuteRequests.map(request => request.from));
  const requestedTo = Math.max(...fiveMinuteRequests.map(request => request.to));
  expect(requestedFrom).toBeLessThanOrEqual(currentStart - 51 * STEP_MS);
  expect(requestedTo).toBeGreaterThanOrEqual(currentStart);
  expect(requestedTo - requestedFrom).toBeGreaterThan(FOUR_HOURS_MS);

  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await settings.getByLabel('Highlight highest value in each row', { exact: true }).check();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  const livePoint = await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, engine = p.engine;
    const pane = engine.footprintTotalsPaneIndex('native.footprint-totals'), plot = engine.chart.plotRect(pane);
    const x = engine.chart.timeScale.indexToX(engine.chart.dataLayer.timeToIndex(time));
    return { x: plot.left + x, y: plot.top + 39 };
  }, currentTime);
  const stage = await panel.locator('.chart-stage').boundingBox();
  await page.mouse.move(stage!.x + livePoint.x, stage!.y + livePoint.y);
  const totalsTooltip = panel.locator('.footprint-totals-tooltip');
  await expect(totalsTooltip).toBeVisible();
  await expect(totalsTooltip.locator('.footprint-totals-tooltip-flip')).toContainText('Positive delta flip · Strong · Live');
  await expect(totalsTooltip.locator('.footprint-totals-tooltip-flip')).toContainText('Relative strength 2.0×');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-staging-worker-live-dark.png' });

  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, engine = p.engine;
    const pane = engine.chart.panes()[engine.footprintTotalsPaneIndex('native.footprint-totals')];
    return { pixelRatio: pane.base.pixelRatio, mediaWidth: pane.base.mediaWidth, bitmapWidth: pane.base.element.width };
  }, currentTime), { timeout: 10_000 }).toMatchObject({ pixelRatio: 2 });
  const narrowBitmap = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, engine = p.engine;
    const pane = engine.chart.panes()[engine.footprintTotalsPaneIndex('native.footprint-totals')];
    return { pixelRatio: pane.base.pixelRatio, mediaWidth: pane.base.mediaWidth, bitmapWidth: pane.base.element.width };
  });
  expect(Math.abs(narrowBitmap.bitmapWidth - narrowBitmap.mediaWidth * 2)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(200);
  const narrowPoint = await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, engine = p.engine;
    const pane = engine.footprintTotalsPaneIndex('native.footprint-totals'), plot = engine.chart.plotRect(pane);
    const x = engine.chart.timeScale.indexToX(engine.chart.dataLayer.timeToIndex(time));
    return { x: plot.left + x, y: plot.top + 39 };
  }, currentTime);
  const narrowStage = await panel.locator('.chart-stage').boundingBox();
  expect(narrowStage).toBeTruthy();
  await page.mouse.move(narrowStage!.x + narrowPoint.x, narrowStage!.y + narrowPoint.y);
  await expect(totalsTooltip.locator('.footprint-totals-tooltip-flip')).toContainText('Positive delta flip · Strong · Live');
  await expect(totalsTooltip.locator('.footprint-totals-tooltip-flip')).toContainText('Relative strength 2.0×');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-staging-worker-live-narrow-dpr2-dark.png', scale: 'device' });

  // A changed prepared-tile revision in the offscreen pre-pair window must
  // flow through the worker/client/panel path and regrade the same live pair.
  fixture.correction = true;
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const data = p.engine.series.getData(), last = data.length - 1;
    p.engine.chart.setVisibleLogicalRange({ from: last - 5, to: last + 1 });
  });
  await expect.poll(() => fixture.preparedRequests.filter(request => request.interval === '5m').length, { timeout: 20_000 })
    .toBeGreaterThan(fiveMinuteRequests.length);
  await expect.poll(() => readFlip(page, currentTime), { timeout: 30_000 }).toMatchObject({
    kind: 'flip', direction: 'positive', strengthBand: 'small', lifecycle: 'live', previousDelta: -40, currentDelta: 60,
  });

  const integration = await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.send({ type: 'diagnostics' });
    const p = [...t.panels.values()][0] as any;
    return { fixture: t.fixture, staging: t.feed.diagnostics.staging,
      totals: p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip,
      mode: t.feed.feedStatusSnapshot().find((item: any) => item.kind === 'candles')?.mode };
  });
  expect(integration.fixture).toBe(false);
  expect(integration.mode).toBe('recorded');
  expect(integration.staging?.source).toBe('staging');
  expect(integration.totals.summaries).toBeGreaterThan(50);
  expect(fixture.nativeRequests.every(request => request.count <= 1000)).toBe(true);
  expect(fixture.nativeRequests.some(request => request.interval === '5m' && request.count === 1000)).toBe(true);
  expect(fixture.externalHttp).toEqual([]);
  const streamState = await workerFixtureState(worker!);
  expect(streamState.externalSockets).toEqual([]);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ kind: 'worker-backed-staging-fixture-not-live-venue', chartId: panelInstanceId,
    nativeBootstrapCounts: fixture.nativeRequests, preparedChunks: fiveMinuteRequests.map(({ from, to }) => ({ from, to, spanMs: to - from })),
    contextSpanMs: requestedTo - requestedFrom, currentTime, negativeTime,
    streamSubscriptions: streamState.subscriptions, clientAcks: streamState.acks, syntheticExecutions: streamState.executions,
    liveFlip: await readFlip(page, currentTime), errors }));
});

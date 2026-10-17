import { describe, expect, it, vi } from 'vitest';
import { OpenAlgoCandleChart } from '../src/chart/openalgo';
import { DEFAULT_ORDER_WALLS_SETTINGS, OrderWallDetector,
  type OrderWallDepthRecord, type OrderWallSegment, type OrderWallsSettings } from '../src/feed/order-walls';
import type { DepthHeadNotice, StagingHeatmapService } from '../src/feed/staging-heatmap';
import { StagingOrderWallsService } from '../src/feed/staging-order-walls';
import type { Event } from '../src/feed/protocol';

const base = 1_800_000_000_000;
const historyFrom = base - 440_000;
const price = 50_000;
const scope = { bids: { complete: true }, asks: { complete: true } };
const settings = (aggregation: 10 | 50 | 100, thresholdUsd = 200): OrderWallsSettings => ({
  ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, method: 'absolute', thresholdUsd, aggregation, minDurationMs: 0,
});

type RawBookScope = typeof scope;
type RawRecord = { kind: OrderWallDepthRecord['kind']; at: number; cursor: number; epoch: number;
  bids?: ReadonlyArray<readonly [number, number]>; asks?: ReadonlyArray<readonly [number, number]>;
  bookScope?: RawBookScope; reason?: string };
type Query = { from: number; to: number; after: number; limit: number; watermark?: number; market?: string };
type RawLevel = [string, string];
type ApiPage = {
  version: 1; market: 'perpetual' | 'spot'; instrument: string; feed: string; from: number; to: number; watermark: number;
  head: { cursor: number; epoch: number; at: number };
  page: { after: number; nextAfter: number; hasMore: boolean; limit: number; observations: number; sameMillisecondClosed: true };
  seed?: { at: number; cursor: number; epoch: number; bids: RawLevel[]; asks: RawLevel[]; bookScope: RawBookScope };
  observations: Array<{ kind: RawRecord['kind']; at: number; cursor: number; epoch: number; bids?: RawLevel[]; asks?: RawLevel[];
    bookScope?: RawBookScope; reason?: string }>;
  coverage: { confirmedTo: number; partial: boolean; seedAt: number | null; earliestRetainedAt: number; gaps: Array<{ at: number; cursor: number; epoch: number; reason: string }> };
};
type WallBatch = Extract<Event, { type: 'order-wall-batch' }>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function within<T>(promise: Promise<T>, label: string, ms = 2_500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function pageResponse(data: ApiPage): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => data } as unknown as Response;
}

function rawLevels(levels: ReadonlyArray<readonly [number, number]> = []): RawLevel[] {
  return levels.map(([p, q]) => [String(p), String(q)]);
}

class HoldRequest {
  readonly entered = deferred<Query>();
  private gate = deferred<void>();
  private used = false;
  constructor(private match: (query: Query) => boolean) {}
  async wait(query: Query) {
    if (this.used || !this.match(query)) return false;
    this.used = true; this.entered.resolve(query); await this.gate.promise; return true;
  }
  release() { this.gate.resolve(); }
}

/** Small deterministic copy of the prepared-depth page contract used by the service. */
class FakeDepthApi {
  readonly calls: Query[] = [];
  readonly holds: HoldRequest[] = [];
  records: RawRecord[];
  headAt: number;
  request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const query: Query = { from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')),
      after: Number(url.searchParams.get('after')), limit: Number(url.searchParams.get('limit')),
      ...(url.searchParams.has('watermark') ? { watermark: Number(url.searchParams.get('watermark')) } : {}),
      ...(url.searchParams.has('market') ? { market: url.searchParams.get('market')! } : {}) };
    this.calls.push(query);
    const response = pageResponse(this.makePage(query));
    for (const hold of this.holds) if (await hold.wait(query)) break;
    return response;
  });

  constructor(records: RawRecord[], headAt: number) {
    this.records = records.slice().sort((a, b) => a.cursor - b.cursor); this.headAt = headAt;
  }
  hold(match: (query: Query) => boolean) { const gate = new HoldRequest(match); this.holds.push(gate); return gate; }
  append(record: RawRecord) {
    this.records.push(record); this.records.sort((a, b) => a.cursor - b.cursor); this.headAt = Math.max(this.headAt, record.at);
  }
  maxCursor() { return Math.max(0, ...this.records.map(record => record.cursor)); }

  seedAt(at: number, watermark = this.maxCursor()) {
    const prior = this.records.filter(record => record.cursor <= watermark && record.at <= at).sort((a, b) => a.cursor - b.cursor);
    const bids = new Map<number, number>(), asks = new Map<number, number>();
    let epoch = prior[0]?.epoch ?? 1, cursor = 0, known = false;
    for (const record of prior) {
      cursor = Math.max(cursor, record.cursor);
      if (record.kind === 'gap') { bids.clear(); asks.clear(); known = false; continue; }
      if (record.kind === 'snapshot' || record.kind === 'checkpoint') {
        bids.clear(); asks.clear(); epoch = record.epoch; known = true;
        for (const [p, q] of record.bids ?? []) if (q > 0) bids.set(p, q);
        for (const [p, q] of record.asks ?? []) if (q > 0) asks.set(p, q);
        continue;
      }
      if (!known || epoch !== record.epoch) continue;
      for (const [bookSide, levels] of [[bids, record.bids], [asks, record.asks]] as const) {
        for (const [p, q] of levels ?? []) q === 0 ? bookSide.delete(p) : bookSide.set(p, q);
      }
    }
    return known ? { at, cursor, epoch, bids: rawLevels([...bids]), asks: rawLevels([...asks]), bookScope: scope } : undefined;
  }

  private makePage(query: Query): ApiPage {
    const watermark = query.watermark ?? this.maxCursor();
    const headRecord = this.records.filter(record => record.cursor <= watermark).at(-1);
    const selected = this.records.filter(record => record.cursor > query.after && record.cursor <= watermark
      && record.at > query.from && record.at <= query.to).sort((a, b) => a.cursor - b.cursor);
    const limit = Math.min(query.limit || 256, 256), rows = selected.slice(0, limit);
    const nextAfter = rows.at(-1)?.cursor ?? query.after;
    const gaps = this.records.filter(record => record.kind === 'gap' && record.cursor <= watermark
      && record.at >= query.from && record.at <= query.to)
      .map(record => ({ at: record.at, cursor: record.cursor, epoch: record.epoch, reason: record.reason ?? 'Fixture source gap' }));
    const market = query.market === 'spot' ? 'spot' : 'perpetual';
    return { version: 1, market, instrument: market === 'spot' ? 'binance:spot:BTCUSDT' : 'binance:perpetual:BTCUSDT',
      feed: market === 'spot' ? 'binance:spot:BTCUSDT:spot-diff-depth' : 'usd-m-standard-diff-depth-rpi-excluded',
      from: query.from, to: query.to, watermark,
      head: { cursor: watermark, epoch: headRecord?.epoch ?? 1, at: headRecord?.at ?? query.from },
      page: { after: query.after, nextAfter, hasMore: selected.length > rows.length, limit, observations: rows.length, sameMillisecondClosed: true },
      ...(query.after === 0 && this.seedAt(query.from, watermark) ? { seed: this.seedAt(query.from, watermark)! } : {}),
      observations: rows.map(record => ({ kind: record.kind, at: record.at, cursor: record.cursor, epoch: record.epoch,
        ...(record.bids ? { bids: rawLevels(record.bids) } : {}), ...(record.asks ? { asks: rawLevels(record.asks) } : {}),
        ...(record.bookScope ? { bookScope: scope } : {}), ...(record.reason ? { reason: record.reason } : {}) })),
      coverage: { confirmedTo: Math.min(query.to, this.headAt), partial: false, seedAt: query.from,
        earliestRetainedAt: historyFrom, gaps } };
  }
}

function makeHeads(initial: ReadonlyMap<string, DepthHeadNotice> = new Map()) {
  const callbacks = new Map<string, (notice: DepthHeadNotice) => void>();
  const source = { observeDepthHeads(id: string, _market: 'spot' | 'perpetual', _after: number, next: (notice: DepthHeadNotice) => void) {
    callbacks.set(id, next);
    const current = initial.get(id); if (current) next(current);
    return () => { if (callbacks.get(id) === next) callbacks.delete(id); };
  } } as unknown as StagingHeatmapService;
  return { source, send: (id: string, notice: DepthHeadNotice) => callbacks.get(id)?.(notice) };
}

function routeMarketApis(perpetual: FakeDepthApi, spot: FakeDepthApi): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    return (url.searchParams.get('market') === 'spot' ? spot : perpetual).request(input);
  }) as typeof fetch;
}

function makeChartHarness(): any {
  const chart = Object.create(OpenAlgoCandleChart.prototype) as any;
  Object.assign(chart, { orderWalls: null, orderWallSegments: new Map<string, OrderWallSegment>(), orderWallValueQueue: [],
    orderWallValueQueueStart: 0, orderWallValueCount: 0, orderWallStatus: { state: 'loading' } });
  return chart;
}

function applyBatch(chart: any, event: WallBatch) {
  if (event.kind === 'snapshot') chart.setOrderWallSnapshot(event.segments ?? [], event.status);
  else chart.patchOrderWalls(event.patches ?? [], event.status);
}

function recordsForWarmHistory(): RawRecord[] {
  const records: RawRecord[] = [{ kind: 'snapshot', at: historyFrom - 1, cursor: 0, epoch: 1, bids: [], asks: [], bookScope: scope }];
  for (let cursor = 1; cursor <= 2_200; cursor++) {
    const at = historyFrom + cursor * 200;
    let bids: ReadonlyArray<readonly [number, number]> = [[40_000, 0.000001]];
    if (cursor === 500 || cursor === 1_000) bids = [[price, 0.003], [price + 50, 0.003]];
    if (cursor === 550) bids = [[price, 0], [price + 50, 0]];
    records.push({ kind: 'delta', at, cursor, epoch: 1, bids, asks: [], bookScope: scope });
  }
  return records;
}

function epochRecords(epoch: number, headCursor: number, wallPrice: number, quantity: number, headAt: number): RawRecord[] {
  return [
    { kind: 'snapshot', at: base - 80_000, cursor: 0, epoch, bids: [[wallPrice, quantity]], asks: [], bookScope: scope },
    ...Array.from({ length: headCursor }, (_, index): RawRecord => {
      const cursor = index + 1;
      return { kind: 'delta', at: cursor === headCursor ? headAt : base - 30_000 + cursor * 500,
        cursor, epoch, bids: [[wallPrice, quantity + cursor * 0.0001]], asks: [], bookScope: scope };
    }),
  ];
}

function busyHistoryRecords() {
  const records: RawRecord[] = [{ kind: 'snapshot', at: historyFrom - 1, cursor: 0, epoch: 1,
    bids: [[price, 0.03]], asks: [], bookScope: scope }];
  for (let cursor = 1; cursor <= 2_200; cursor++) records.push({ kind: 'delta', at: historyFrom + cursor * 200,
    cursor, epoch: 1, bids: [[price, 0.03 + cursor % 5 * 0.001]], asks: [], bookScope: scope });
  return records;
}

function normalized(segments: OrderWallSegment[]) {
  return segments.map(segment => ({ ...segment, id: '<render-id>' })).sort((a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
}

function reference(api: FakeDepthApi, from: number, to: number, cursor: number, detection: OrderWallsSettings) {
  const seed = api.seedAt(from, cursor);
  if (!seed) throw new Error('Fixture has no usable depth seed at the requested range start');
  const records: OrderWallDepthRecord[] = [{ kind: 'snapshot', at: seed.at, cursor: seed.cursor, epoch: seed.epoch,
    bids: seed.bids.map(([p, q]) => [Number(p), Number(q)] as const), asks: seed.asks.map(([p, q]) => [Number(p), Number(q)] as const),
    bookScope: { bidComplete: true, askComplete: true } }, ...api.records.filter(record => record.cursor > seed.cursor
      && record.cursor <= cursor && record.at > from && record.at <= to).map(record => ({ kind: record.kind, at: record.at,
        cursor: record.cursor, epoch: record.epoch, ...(record.bids ? { bids: record.bids } : {}), ...(record.asks ? { asks: record.asks } : {}),
        ...(record.bookScope ? { bookScope: { bidComplete: record.bookScope.bids.complete, askComplete: record.bookScope.asks.complete } } : {}),
        ...(record.reason ? { reason: record.reason } : {}) }))];
  const detector = new OrderWallDetector(detection, 0.1, 10);
  detector.processBatch(records); detector.confirmHead(to, cursor);
  return detector.snapshot(to);
}

describe('staging Order Walls warm replay and bounded live-tail handoff', () => {
  it('reuses a clean cached superset for a nested forward window and replays it with the new aggregation', async () => {
    let now = base;
    const api = new FakeDepthApi(recordsForWarmHistory(), base), heads = makeHeads();
    const events = new Map<string, WallBatch[]>(), charts = new Map<string, any>();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      const id = event.ids[0]!;
      const list = events.get(id) ?? []; list.push(event); events.set(id, list);
      const chart = charts.get(id) ?? makeChartHarness(); charts.set(id, chart); applyBatch(chart, event);
    }, api.request, () => now);
    const oldSettings = settings(10), nextSettings = settings(100);
    service.command({ type: 'order-wall-subscribe', id: 'warm-source', request: {
      market: 'binance-perp', from: historyFrom, to: base, settings: oldSettings, followLive: false,
    } });
    await vi.waitFor(() => expect(service.diagnostics()).toMatchObject({ cacheEntries: 1, records: 2_200, failures: 0 }));

    const nestedFrom = historyFrom + 100_000, nestedTo = base + 300;
    now = nestedTo;
    service.command({ type: 'order-wall-subscribe', id: 'warm-nested', request: {
      market: 'binance-perp', from: nestedFrom, to: nestedTo, settings: nextSettings, followLive: true,
    } });
    heads.send('warm-nested', { type: 'head', cursor: 2_200, at: base, epoch: 1 });
    await vi.waitFor(() => expect(service.diagnostics()).toMatchObject({ cacheHits: 1, failures: 0 }));
    await vi.waitFor(() => expect([...charts.get('warm-nested')?.orderWallSegments.values() ?? []]
      .some((segment: OrderWallSegment) => segment.end !== null && segment.start <= nestedFrom + 1_000)).toBe(true));

    // A clean superset should project its cursor at the nested left edge and fetch only the new tail.
    expect(api.calls.some(query => query.from === nestedFrom && query.after === 0)).toBe(false);
    await vi.waitFor(() => expect(api.calls.some(query => query.from === nestedFrom && query.after > 0)).toBe(true));
    api.append({ kind: 'delta', at: base + 200, cursor: 2_201, epoch: 1,
      bids: [[price, 0.004], [price + 50, 0.004]], asks: [], bookScope: scope });
    heads.send('warm-nested', { type: 'head', cursor: 2_201, at: base + 200, epoch: 1 });
    await vi.waitFor(() => expect([...charts.get('warm-nested')?.orderWallSegments.values() ?? []]
      .some((segment: OrderWallSegment) => segment.end === null && segment.valueRuns.some(point => point.at === base + 200 && Math.abs(point.usd - 400.2) < 0.01))).toBe(true));
    await vi.waitFor(() => expect(events.get('warm-nested')?.at(-1)?.status.lastConfirmedAt).toBe(base + 200));

    // Warm reuse replays the complete cached prefix, so the reference must retain
    // knowledge of crossings that happened before the nested viewport begins.
    const expected = reference(api, historyFrom, base + 200, 2_201, nextSettings);
    expect(normalized([...charts.get('warm-nested').orderWallSegments.values()])).toEqual(normalized(expected));
    service.dispose();
  });

  it('yields between cached pages so a new head is accepted, then cancels an obsolete cached generation', async () => {
    let now = base;
    const api = new FakeDepthApi(recordsForWarmHistory(), base), heads = makeHeads();
    const events: WallBatch[] = [], chart = makeChartHarness();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event); applyBatch(chart, event);
      const closedPagePatch = event.kind === 'patch' && event.patches?.some(patch => patch.segment?.end !== null);
      if (armHeadDuringCache && closedPagePatch) {
        armHeadDuringCache = false;
        queueMicrotask(() => {
          cursorAtYield = service.diagnostics().subscriptions[0]?.cursor;
          api.append({ kind: 'delta', at: base + 100, cursor: 2_201, epoch: 1,
            bids: [[price, 0.004], [price + 50, 0.004]], asks: [], bookScope: scope });
          heads.send('cache-yield', { type: 'head', cursor: 2_201, at: base + 100, epoch: 1 });
        });
      } else if (armCancelAtYield && closedPagePatch) {
        armCancelAtYield = false;
        oldGenerationAtCancel = event.generation;
        queueMicrotask(() => service.command({ type: 'order-wall-viewport', id: 'cache-yield',
          from: historyFrom + 50_000, to: base + 100 }));
      }
    }, api.request, () => now);
    let armHeadDuringCache = false, armCancelAtYield = false;
    let cursorAtYield: number | undefined, oldGenerationAtCancel: number | undefined;
    service.command({ type: 'order-wall-subscribe', id: 'cache-yield', request: {
      market: 'binance-perp', from: historyFrom, to: base, settings: settings(50), followLive: true,
    } });
    heads.send('cache-yield', { type: 'head', cursor: 2_200, at: base, epoch: 1 });
    await vi.waitFor(() => expect(service.diagnostics()).toMatchObject({ cacheEntries: 1, failures: 0 }));
    await vi.waitFor(() => expect(service.diagnostics().subscriptions[0]?.initialized).toBe(true));

    armHeadDuringCache = true;
    service.command({ type: 'order-wall-settings', id: 'cache-yield', settings: settings(100) });
    await vi.waitFor(() => expect(cursorAtYield).toBeDefined());
    expect(cursorAtYield).toBeLessThan(2_200);
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()]
      .some((segment: OrderWallSegment) => segment.end === null && segment.valueRuns.some(point => point.at === base + 100 && Math.abs(point.usd - 400.2) < 0.01))).toBe(true));
    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({ lastConfirmedAt: base + 100, provisional: false }));

    armCancelAtYield = true;
    const beforeCancel = events.length;
    service.command({ type: 'order-wall-settings', id: 'cache-yield', settings: settings(100, 250) });
    await vi.waitFor(() => expect(oldGenerationAtCancel).toBeDefined());
    await vi.waitFor(() => expect(events.slice(beforeCancel).some(event => event.generation !== oldGenerationAtCancel)).toBe(true));
    const newGenerationIndex = events.findIndex((event, index) => index >= beforeCancel && event.generation !== oldGenerationAtCancel);
    await vi.waitFor(() => expect(service.diagnostics().subscriptions[0]?.initialized).toBe(true));
    expect(events.slice(newGenerationIndex).some(event => event.generation === oldGenerationAtCancel)).toBe(false);
    service.dispose();
  });

  it('rejects a warm cache from an old depth epoch before promotion, including a mid-yield head and cursor collision', async () => {
    const epochFrom = base - 50_000, oldPrice = 50_000, currentPrice = 51_000, spotPrice = 48_000;
    const oldRows = epochRecords(1, 20, oldPrice, 0.08, base - 1_000);
    const spotRows = epochRecords(1, 20, spotPrice, 0.09, base - 1_000);

    const harness = (perpetual: FakeDepthApi, spot: FakeDepthApi, heads: ReturnType<typeof makeHeads>) => {
      const events = new Map<string, WallBatch[]>(), charts = new Map<string, any>();
      const service = new StagingOrderWallsService(heads.source, event => {
        if (event.type !== 'order-wall-batch') return;
        const id = event.ids[0]!;
        const list = events.get(id) ?? []; list.push(event); events.set(id, list);
        const chart = charts.get(id) ?? makeChartHarness(); charts.set(id, chart); applyBatch(chart, event);
      }, routeMarketApis(perpetual, spot), () => base + 100);
      return { service, events, charts };
    };
    const prime = async (service: StagingOrderWallsService, withSpot: boolean) => {
      service.command({ type: 'order-wall-subscribe', id: 'cache-perpetual', request: {
        market: 'binance-perp', from: epochFrom, to: base, settings: settings(50), followLive: false,
      } });
      await vi.waitFor(() => expect(service.diagnostics().subscriptions.find(sub => sub.id === 'cache-perpetual'))
        .toMatchObject({ initialized: true, busy: false }));
      if (withSpot) {
        service.command({ type: 'order-wall-subscribe', id: 'cache-spot', request: {
          market: 'binance-spot', from: epochFrom, to: base, settings: settings(50), followLive: false,
        } });
        await vi.waitFor(() => expect(service.diagnostics().subscriptions.find(sub => sub.id === 'cache-spot'))
          .toMatchObject({ initialized: true, busy: false }));
      }
      expect(service.diagnostics().cacheEntries).toBe(withSpot ? 2 : 1);
    };
    const waitForCurrentBook = async (service: StagingOrderWallsService, events: Map<string, WallBatch[]>, charts: Map<string, any>, id: string) => {
      await vi.waitFor(() => expect(service.diagnostics().subscriptions.find(sub => sub.id === id))
        .toMatchObject({ initialized: true, replayPromoted: true, busy: false }));
      await vi.waitFor(() => expect(events.get(id)?.at(-1)?.status.provisional).toBe(false));
      const active = [...charts.get(id)?.orderWallSegments.values() ?? []]
        .filter((segment: OrderWallSegment) => segment.end === null);
      expect(active.some((segment: OrderWallSegment) => segment.epoch === 2 && segment.price === currentPrice)).toBe(true);
      expect(active.some((segment: OrderWallSegment) => segment.epoch === 1 && segment.price === oldPrice)).toBe(false);
    };

    // The equal-cursor case catches a numeric watermark that appears to match
    // even though its source epoch was replaced. The head is synchronously
    // known from the observer before `load()` can inspect the cache.
    const firstPerp = new FakeDepthApi(oldRows, base - 1_000), firstSpot = new FakeDepthApi(spotRows, base - 1_000);
    const firstHeads = makeHeads(new Map([['known-new-epoch', { type: 'head', cursor: 20, at: base + 100, epoch: 2 }]]));
    const first = harness(firstPerp, firstSpot, firstHeads);
    await prime(first.service, true);
    firstPerp.records = epochRecords(2, 20, currentPrice, 0.08, base + 100);
    firstPerp.headAt = base + 100;
    const perpCallsBefore = firstPerp.calls.length;
    first.service.command({ type: 'order-wall-subscribe', id: 'known-new-epoch', request: {
      market: 'binance-perp', from: epochFrom, to: base, settings: settings(50), followLive: true,
    } });
    await waitForCurrentBook(first.service, first.events, first.charts, 'known-new-epoch');
    expect(firstPerp.calls.slice(perpCallsBefore).some(query => query.from === epochFrom && query.after === 0)).toBe(true);
    const spotCallsBefore = firstSpot.calls.length;
    first.service.command({ type: 'order-wall-subscribe', id: 'spot-cache-survives', request: {
      market: 'binance-spot', from: epochFrom, to: base, settings: settings(50), followLive: false,
    } });
    await vi.waitFor(() => expect(first.service.diagnostics().subscriptions.find(sub => sub.id === 'spot-cache-survives'))
      .toMatchObject({ initialized: true, busy: false }));
    expect(firstSpot.calls).toHaveLength(spotCallsBefore);
    expect(first.service.diagnostics().cacheHits).toBeGreaterThan(0);
    expect([...first.charts.get('spot-cache-survives').orderWallSegments.values()]
      .some((segment: OrderWallSegment) => segment.epoch === 1 && segment.price === spotPrice && segment.end === null)).toBe(true);
    first.service.dispose();

    // The lower-cursor case arrives after readCache selected the old page but
    // while its required macrotask yield still gives the worker a chance to
    // observe a fresh head. It must invalidate/restart before old data owns the
    // current chart.
    const secondPerp = new FakeDepthApi(oldRows, base - 1_000), secondSpot = new FakeDepthApi([], base);
    const secondHeads = makeHeads(), second = harness(secondPerp, secondSpot, secondHeads);
    await prime(second.service, false);
    secondPerp.records = epochRecords(2, 2, currentPrice, 0.08, base + 100);
    secondPerp.headAt = base + 100;
    const secondCallsBefore = secondPerp.calls.length;
    second.service.command({ type: 'order-wall-subscribe', id: 'head-during-cache-yield', request: {
      market: 'binance-perp', from: epochFrom, to: base, settings: settings(50), followLive: true,
    } });
    expect(second.service.diagnostics().cacheHits).toBe(1);
    expect(secondPerp.calls).toHaveLength(secondCallsBefore);
    secondHeads.send('head-during-cache-yield', { type: 'head', cursor: 2, at: base + 100, epoch: 2 });
    await waitForCurrentBook(second.service, second.events, second.charts, 'head-during-cache-yield');
    expect(secondPerp.calls.slice(secondCallsBefore).some(query => query.from === epochFrom && query.after === 0)).toBe(true);
    second.service.dispose();
  }, 20_000);

  it('bridges an asynchronous canonical page to the advancing live tail and promotes without chasing heads', async () => {
    let now = base;
    const api = new FakeDepthApi(busyHistoryRecords(), base), heads = makeHeads();
    const pageTwo = api.hold(query => query.from === historyFrom && query.after === 256);
    const events: WallBatch[] = [], chart = makeChartHarness();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event); applyBatch(chart, event);
    }, api.request, () => now);
    service.command({ type: 'order-wall-subscribe', id: 'moving-tail', request: {
      market: 'binance-perp', from: historyFrom, to: base, settings: settings(10), followLive: true,
    } });
    heads.send('moving-tail', { type: 'head', cursor: 2_200, at: base, epoch: 1 });
    await within(pageTwo.entered.promise, 'initial replay page two');
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].some((segment: OrderWallSegment) => segment.end === null)).toBe(true));
    const liveId = [...chart.orderWallSegments.values()].find((segment: OrderWallSegment) => segment.end === null)?.id;
    expect(liveId).toBeDefined();

    api.append({ kind: 'delta', at: base + 100, cursor: 2_201, epoch: 1, bids: [[price, 0.05]], asks: [], bookScope: scope });
    heads.send('moving-tail', { type: 'head', cursor: 2_201, at: base + 100, epoch: 1 });
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].some((segment: OrderWallSegment) => segment.end === null
      && segment.valueRuns.some((point: { at: number }) => point.at === base + 100))).toBe(true));
    api.append({ kind: 'delta', at: base + 200, cursor: 2_202, epoch: 1, bids: [[price, 0.06]], asks: [], bookScope: scope });
    heads.send('moving-tail', { type: 'head', cursor: 2_202, at: base + 200, epoch: 1 });
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].find((segment: OrderWallSegment) => segment.end === null)?.valueRuns
      .some((point: { at: number; usd: number }) => point.at === base + 200 && Math.abs(point.usd - 3_000) < 0.01)).toBe(true));
    api.append({ kind: 'delta', at: base + 300, cursor: 2_203, epoch: 1, bids: [[price, 0.07]], asks: [], bookScope: scope });
    heads.send('moving-tail', { type: 'head', cursor: 2_203, at: base + 300, epoch: 1 });
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].find((segment: OrderWallSegment) => segment.end === null)?.valueRuns
      .some((point: { at: number; usd: number }) => point.at === base + 300 && Math.abs(point.usd - 3_500) < 0.01)).toBe(true));

    const acceptedLiveReads = api.calls.filter(query => query.from === base && query.after >= 2_200);
    expect(acceptedLiveReads[0]?.after).toBe(2_200);
    expect(acceptedLiveReads.every((query, index) => query.after > 0
      && (index === 0 || query.after > acceptedLiveReads[index - 1]!.after))).toBe(true);
    pageTwo.release();
    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({ lastConfirmedAt: base + 300, provisional: false }));
    expect(api.calls.some(query => query.from === historyFrom && query.watermark === 2_203)).toBe(false);
    expect([...chart.orderWallSegments.values()].find((segment: OrderWallSegment) => segment.end === null)?.id).toBe(liveId);
    expect(normalized([...chart.orderWallSegments.values()])).toEqual(normalized(reference(api, historyFrom, base + 300, 2_203, settings(10))));
    service.dispose();
  }, 20_000);

  it('refills an evicted live-tail prefix durably and preserves the source gap boundary', async () => {
    let now = base;
    const records = busyHistoryRecords(), api = new FakeDepthApi(records, base), heads = makeHeads();
    const pageTwo = api.hold(query => query.from === historyFrom && query.after === 256);
    const events: WallBatch[] = [], chart = makeChartHarness();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event); applyBatch(chart, event);
    }, api.request, () => now);
    service.command({ type: 'order-wall-subscribe', id: 'overflow-tail', request: {
      market: 'binance-perp', from: historyFrom, to: base, settings: settings(10), followLive: true,
    } });
    heads.send('overflow-tail', { type: 'head', cursor: 2_200, at: base, epoch: 1 });
    await within(pageTwo.entered.promise, 'overflow initial replay page two');
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].some((segment: OrderWallSegment) => segment.end === null)).toBe(true));
    api.append({ kind: 'delta', at: base + 100, cursor: 2_201, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope });
    heads.send('overflow-tail', { type: 'head', cursor: 2_201, at: base + 100, epoch: 1 });
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].find((segment: OrderWallSegment) => segment.end === null)?.valueRuns
      .some((point: { at: number }) => point.at === base + 100)).toBe(true));
    const tailCount = 4_500;
    let finalAt = base + 100, finalCursor = 2_202;
    for (let index = 1; index <= tailCount; index++) {
      const cursor = 2_201 + index, at = base + 100 + index * 10;
      finalCursor = cursor; finalAt = at;
      if (index === 2_500) api.append({ kind: 'gap', at, cursor, epoch: 1, reason: 'Fixture retained-depth continuity gap' });
      else if (index === 2_501) api.append({ kind: 'snapshot', at, cursor, epoch: 1,
        bids: [[price, 0.05]], asks: [], bookScope: scope });
      else api.append({ kind: 'delta', at, cursor, epoch: 1,
        bids: [[price, 0.03 + index % 7 * 0.001]], asks: [], bookScope: scope });
    }
    now = finalAt;
    heads.send('overflow-tail', { type: 'head', cursor: finalCursor, at: finalAt, epoch: 1 });
    await vi.waitFor(() => {
      const sub = service.diagnostics().subscriptions[0];
      expect(service.diagnostics().liveTailEvictions).toBeGreaterThan(0);
      expect(sub?.liveCursor).toBe(finalCursor);
      expect(sub?.liveTailBuffer).toMatchObject({ through: finalCursor });
      expect(sub?.liveTailBuffer?.records).toBeLessThanOrEqual(4_000);
      expect(sub?.liveTailBuffer?.after).toBeGreaterThan(sub?.cursor ?? Infinity);
      expect(sub?.liveTailBuffer?.firstCursor).toBeGreaterThan(sub?.cursor ?? Infinity);
    }, { timeout: 10_000 });
    await vi.waitFor(() => expect([...chart.orderWallSegments.values()].some((segment: OrderWallSegment) => segment.epoch === 1 && segment.end === null
      && segment.start >= base + 100 + 2_501 * 10)).toBe(true), { timeout: 10_000 });

    pageTwo.release();
    await vi.waitFor(() => expect(api.calls.some(query => query.from === historyFrom && query.after === 2_200
      && query.watermark !== undefined && query.watermark > 2_200 && query.watermark < finalCursor)).toBe(true), { timeout: 10_000 });
    await vi.waitFor(() => expect(service.diagnostics().replayBridgeRecords).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(events.at(-1)?.status.lastConfirmedAt).toBe(finalAt), { timeout: 10_000 });
    await vi.waitFor(() => expect(events.at(-1)?.status.provisional).toBe(false), { timeout: 10_000 });

    const wallEpisodes = [...chart.orderWallSegments.values()].filter((segment: OrderWallSegment) => segment.side === 'bid' && segment.price === price)
      .sort((a, b) => a.start - b.start);
    expect(wallEpisodes).toHaveLength(2);
    expect(wallEpisodes[0]).toMatchObject({ epoch: 1, endReason: 'censored', endKnown: false });
    expect(wallEpisodes[1]).toMatchObject({ epoch: 1, end: null, endReason: null });
    expect(wallEpisodes[0]?.id).not.toBe(wallEpisodes[1]?.id);
    expect(normalized(wallEpisodes)).toEqual(normalized(reference(api, historyFrom, finalAt, finalCursor, settings(10))));
    service.dispose();
  }, 20_000);
});

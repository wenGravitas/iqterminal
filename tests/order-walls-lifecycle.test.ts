import { describe, expect, it, vi } from 'vitest';
import { OpenAlgoCandleChart } from '../src/chart/openalgo';
import { DEFAULT_ORDER_WALLS_SETTINGS, OrderWallDetector, orderWallValueAt,
  type OrderWallDepthRecord, type OrderWallPatch, type OrderWallSegment, type OrderWallsSettings } from '../src/feed/order-walls';
import type { DepthHeadNotice, StagingHeatmapService } from '../src/feed/staging-heatmap';
import { StagingOrderWallsService } from '../src/feed/staging-order-walls';
import type { Event } from '../src/feed/protocol';

const base = 1_800_000_000_000;
const viewportFrom = base - 600_000;
const pageSize = 256;
const price = 50_000;
type RawBookScope = { bids: { complete: boolean }; asks: { complete: boolean } };
const scope: RawBookScope = { bids: { complete: true }, asks: { complete: true } };
const settings: OrderWallsSettings = {
  ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const,
  enabled: true,
  method: 'absolute',
  thresholdUsd: 100,
  aggregation: 10,
  minDurationMs: 0,
};

type RawLevel = [string, string];
interface RawRecord {
  kind: OrderWallDepthRecord['kind'];
  at: number;
  cursor: number;
  epoch: string | number;
  bids?: ReadonlyArray<readonly [number, number]>;
  asks?: ReadonlyArray<readonly [number, number]>;
  bookScope?: RawBookScope;
  reason?: string;
}
interface Query {
  from: number;
  to: number;
  after: number;
  limit: number;
  watermark?: number;
  market?: string;
}
interface ApiPage {
  version: 1;
  market: 'perpetual' | 'spot';
  instrument: string;
  feed: string;
  from: number;
  to: number;
  watermark: number;
  head: { cursor: number; at: number; epoch: number };
  page: { after: number; nextAfter: number; hasMore: boolean; limit: number; observations: number; sameMillisecondClosed: true };
  seed?: { at: number; cursor: number; epoch: string | number; bids: RawLevel[]; asks: RawLevel[]; bookScope: typeof scope };
  observations: Array<{ kind: RawRecord['kind']; at: number; cursor: number; epoch: string | number;
    bids?: RawLevel[]; asks?: RawLevel[]; bookScope?: typeof scope; reason?: string }>;
  coverage: { confirmedTo: number; partial: boolean; seedAt: number | null; earliestRetainedAt?: number; gaps: Array<{ at: number; cursor: number; epoch: string | number; reason: string }> };
}
type WallBatch = Extract<Event, { type: 'order-wall-batch' }>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function rawLevel(levels: ReadonlyArray<readonly [number, number]> = []): RawLevel[] {
  return levels.map(([p, q]) => [String(p), String(q)]);
}

function pageResponse(data: ApiPage, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => data,
  } as unknown as Response;
}

function errorResponse(message: string, status = 500): Response {
  return { ok: false, status, headers: { get: () => null }, json: async () => ({ error: message }) } as unknown as Response;
}

class HoldRequest {
  readonly entered = deferred<Query>();
  private releaseGate = deferred<void>();
  private used = false;
  constructor(private match: (query: Query) => boolean) {}
  async wait(query: Query) {
    if (this.used || !this.match(query)) return false;
    this.used = true;
    this.entered.resolve(query);
    await this.releaseGate.promise;
    return true;
  }
  release() { this.releaseGate.resolve(); }
}

/** Deterministic stand-in for the durable depth API. Cursors and pages follow its public contract. */
class FakeDepthApi {
  records: RawRecord[];
  headAt: number;
  earliestRetainedAt = viewportFrom;
  readonly calls: Query[] = [];
  readonly holds: HoldRequest[] = [];
  fail?: (query: Query) => string | undefined;
  request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const query: Query = {
      from: Number(url.searchParams.get('from')),
      to: Number(url.searchParams.get('to')),
      after: Number(url.searchParams.get('after')),
      limit: Number(url.searchParams.get('limit')),
      ...(url.searchParams.has('watermark') ? { watermark: Number(url.searchParams.get('watermark')) } : {}),
      ...(url.searchParams.has('market') ? { market: url.searchParams.get('market')! } : {}),
    };
    this.calls.push(query);
    const failed = this.fail?.(query);
    if (failed) { this.fail = undefined; return errorResponse(failed); }
    const data = this.makePage(query);
    for (const hold of this.holds) if (await hold.wait(query)) break;
    return pageResponse(data);
  });

  constructor(records: RawRecord[], headAt: number) { this.records = records.slice().sort((a, b) => a.cursor - b.cursor); this.headAt = headAt; }
  hold(match: (query: Query) => boolean) { const gate = new HoldRequest(match); this.holds.push(gate); return gate; }
  append(record: RawRecord) { this.records.push(record); this.records.sort((a, b) => a.cursor - b.cursor); this.headAt = Math.max(this.headAt, record.at); }

  makeSeed(at: number, watermark: number) {
    const prior = this.records.filter(record => record.cursor <= watermark && record.at <= at).sort((a, b) => a.cursor - b.cursor);
    const bids = new Map<number, number>(), asks = new Map<number, number>();
    let epoch: string | number = prior[0]?.epoch ?? 1, cursor = 0;
    let known = false;
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
      for (const [side, levels] of [[bids, record.bids], [asks, record.asks]] as const) {
        for (const [p, q] of levels ?? []) q === 0 ? side.delete(p) : side.set(p, q);
      }
    }
    if (!known) return undefined;
    return { at, cursor, epoch, bids: rawLevel([...bids]), asks: rawLevel([...asks]), bookScope: scope };
  }

  private makePage(query: Query): ApiPage {
    const watermark = query.watermark ?? Math.max(0, ...this.records.map(record => record.cursor));
    const watermarkRecord = this.records.filter(record => record.cursor <= watermark).sort((a, b) => a.cursor - b.cursor).at(-1);
    const selected = this.records.filter(record => record.cursor > query.after && record.cursor <= watermark
      && record.at > query.from && record.at <= query.to).sort((a, b) => a.cursor - b.cursor);
    const rows = selected.slice(0, Math.min(query.limit || pageSize, pageSize));
    const nextAfter = rows.at(-1)?.cursor ?? query.after;
    const gaps = this.records.filter((record): record is RawRecord & { reason: string } => record.kind === 'gap'
      && record.cursor <= watermark && record.at >= query.from && record.at <= query.to)
      .map(({ at, cursor, epoch, reason }) => ({ at, cursor, epoch, reason: reason ?? 'fixture source gap' }));
    const page: ApiPage = {
      version: 1,
      market: 'perpetual',
      instrument: 'binance:perpetual:BTCUSDT',
      // The v1 raw depth endpoint returns the stable venue source suffix, not
      // the qualified prepared-history manifest feed ID.
      feed: 'usd-m-standard-diff-depth-rpi-excluded',
      from: query.from,
      to: query.to,
      watermark,
      head: { cursor: watermark, at: watermarkRecord?.at ?? 0, epoch: Number(watermarkRecord?.epoch ?? 0) },
      page: { after: query.after, nextAfter, hasMore: selected.length > rows.length,
        limit: Math.min(query.limit || pageSize, pageSize), observations: rows.length, sameMillisecondClosed: true },
      ...(query.after === 0 ? { seed: this.makeSeed(query.from, watermark) } : {}),
      observations: rows.map(record => ({ kind: record.kind, at: record.at, cursor: record.cursor, epoch: record.epoch,
        ...(record.bids ? { bids: rawLevel(record.bids) } : {}), ...(record.asks ? { asks: rawLevel(record.asks) } : {}),
        ...(record.bookScope ? { bookScope: scope } : {}), ...(record.reason ? { reason: record.reason } : {}) })),
      coverage: { confirmedTo: Math.min(query.to, this.headAt), partial: false,
        seedAt: query.from, earliestRetainedAt: this.earliestRetainedAt, gaps },
    };
    return page;
  }
}

function makeHeads() {
  let callback: ((notice: DepthHeadNotice) => void) | undefined;
  const source = {
    observeDepthHeads(_id: string, _market: 'spot' | 'perpetual', _after: number, next: (notice: DepthHeadNotice) => void) {
      callback = next;
      return () => { callback = undefined; };
    },
  } as unknown as StagingHeatmapService;
  return { source, send: (notice: DepthHeadNotice) => callback?.(notice) };
}

function makeChartHarness(): any {
  const chart = Object.create(OpenAlgoCandleChart.prototype) as any;
  Object.assign(chart, {
    orderWalls: null,
    orderWallSegments: new Map<string, OrderWallSegment>(),
    orderWallValueQueue: [],
    orderWallValueQueueStart: 0,
    orderWallValueCount: 0,
    orderWallStatus: { state: 'loading' },
  });
  return chart;
}

function applyBatch(chart: ReturnType<typeof makeChartHarness>, event: WallBatch) {
  if (event.kind === 'snapshot') chart.setOrderWallSnapshot(event.segments ?? [], event.status);
  else chart.patchOrderWalls(event.patches ?? [], event.status);
}

function activeWall(chart: ReturnType<typeof makeChartHarness>): OrderWallSegment | undefined {
  const segments = [...chart.orderWallSegments.values()] as OrderWallSegment[];
  return segments.find(segment => segment.side === 'bid' && segment.price === price && segment.end === null);
}

function sourceRecords(): RawRecord[] {
  const records: RawRecord[] = [{ kind: 'snapshot', at: viewportFrom - 1, cursor: 0, epoch: 1,
    bids: [[price, 0.02]], asks: [], bookScope: scope }];
  for (let cursor = 1; cursor <= 2_200; cursor++) {
    const at = viewportFrom + cursor * 200;
    const quantity = 0.02 + (cursor % 101) * 0.0001;
    records.push({ kind: 'delta', at, cursor, epoch: 1, bids: [[price, quantity]], asks: [], bookScope: scope });
  }
  records.push({ kind: 'delta', at: base, cursor: 2_201, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope });
  return records;
}

function normalizedSegments(segments: OrderWallSegment[]) {
  return segments.map(segment => ({ ...segment, id: '<render-id>' }))
    .sort((a, b) => a.side.localeCompare(b.side) || a.price - b.price || a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
}

function referenceSegments(api: FakeDepthApi, from: number, finalAt: number, cursor: number) {
  const seed = api.makeSeed(from, cursor);
  if (!seed) throw new Error('Fixture did not produce a retained seed at the requested viewport start');
  const records: OrderWallDepthRecord[] = [{ kind: 'snapshot', at: seed.at, cursor: seed.cursor, epoch: seed.epoch,
    bids: seed.bids.map(([p, q]) => [Number(p), Number(q)] as const), asks: seed.asks.map(([p, q]) => [Number(p), Number(q)] as const),
    bookScope: { bidComplete: true, askComplete: true } }, ...api.records.filter(record => record.cursor > seed.cursor
      && record.cursor <= cursor && record.at > from && record.at <= finalAt).map(record => ({
        kind: record.kind, at: record.at, cursor: record.cursor, epoch: record.epoch,
        ...(record.bids ? { bids: record.bids } : {}), ...(record.asks ? { asks: record.asks } : {}),
        ...(record.bookScope ? { bookScope: { bidComplete: record.bookScope.bids.complete, askComplete: record.bookScope.asks.complete } } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
      }))];
  const detector = new OrderWallDetector(settings, 0.1, 10);
  detector.processBatch(records);
  detector.confirmHead(finalAt, cursor);
  return detector.snapshot(finalAt);
}

describe('staging Order Walls replay and live lifecycle', () => {
  it('preserves the fixed replay and live wall while the follow-live viewport slides', async () => {
    let now = base;
    const api = new FakeDepthApi(sourceRecords(), base);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const chart = makeChartHarness();
    const heldHistory = api.hold(query => query.from === viewportFrom && query.watermark === undefined && query.after === 0);
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event); applyBatch(chart, event);
    }, api.request, () => now);

    service.command({ type: 'order-wall-subscribe', id: 'sliding', request: {
      market: 'binance-perp', from: viewportFrom, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 2_201, at: base, epoch: 1 });
    await heldHistory.entered.promise;
    await vi.waitFor(() => expect(activeWall(chart)).toBeDefined());
    const liveId = activeWall(chart)!.id;
    const originalGeneration = service.diagnostics().subscriptions[0]!.generation;

    now = base + 60_000;
    service.command({ type: 'order-wall-viewport', id: 'sliding', from: viewportFrom + 60_000, to: base + 60_000 });
    now = base + 120_000;
    service.command({ type: 'order-wall-viewport', id: 'sliding', from: viewportFrom + 120_000, to: base + 120_000 });
    expect(service.diagnostics().subscriptions[0]).toMatchObject({
      generation: originalGeneration, range: { from: viewportFrom, to: base }, busy: true, initialized: false,
    });
    expect(api.calls.filter(query => query.from === viewportFrom && query.after === 0 && query.watermark === undefined)).toHaveLength(1);

    api.append({ kind: 'delta', at: base + 100, cursor: 2_202, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 2_202, at: base + 100, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)?.valueRuns.some(point => point.at === base + 100 && point.usd === 1_500)).toBe(true));
    expect(activeWall(chart)?.id).toBe(liveId);

    heldHistory.release();
    await vi.waitFor(() => expect(service.diagnostics().subscriptions[0]).toMatchObject({ initialized: true, cursor: 2_202 }), { timeout: 5_000 });
    expect(service.diagnostics().failures).toBe(0);
    expect(api.calls.filter(query => query.from === viewportFrom && query.after === 0 && query.watermark === undefined)).toHaveLength(1);
    expect(activeWall(chart)?.id).toBe(liveId);
    expect(events.at(-1)?.status.lastConfirmedAt).toBe(base + 100);
    service.dispose();
  });

  it('reports coverage and retention for the sliding viewport while keeping the canonical replay range fixed', async () => {
    let now = base;
    const api = new FakeDepthApi([
      { kind: 'snapshot', at: viewportFrom - 1, cursor: 1, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 2, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ], base);
    api.earliestRetainedAt = viewportFrom + 30_000;
    const heads = makeHeads(), events: WallBatch[] = [];
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type === 'order-wall-batch') events.push(event);
    }, api.request, () => now);
    service.command({ type: 'order-wall-subscribe', id: 'viewport-coverage', request: {
      market: 'binance-perp', from: viewportFrom, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 2, at: base, epoch: 1 });
    await vi.waitFor(() => expect(events.at(-1)?.status.coverage).toMatchObject({
      from: viewportFrom, to: base, partial: true, reason: 'Requested range begins before retained depth history.',
    }));

    now = base + 60_000;
    const nextFrom = viewportFrom + 60_000, nextTo = base + 60_000;
    service.command({ type: 'order-wall-viewport', id: 'viewport-coverage', from: nextFrom, to: nextTo });
    expect(service.diagnostics().subscriptions[0]?.range).toEqual({ from: viewportFrom, to: base });
    expect(events.at(-1)?.status.coverage).toMatchObject({ from: nextFrom, to: nextTo, partial: true });
    api.append({ kind: 'delta', at: nextTo, cursor: 3, epoch: 1, bids: [[price, 0.05]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 3, at: nextTo, epoch: 1 });

    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({
      state: 'live', coverage: { from: nextFrom, to: nextTo, complete: true, partial: false },
    }));
    expect(service.diagnostics().subscriptions[0]?.range).toEqual({ from: viewportFrom, to: base });
    expect(events.at(-1)?.status.retentionStart).toBe(api.earliestRetainedAt);
    service.dispose();
  });

  it('bootstraps an epoch replacement at its reset cursor and source time', async () => {
    const api = new FakeDepthApi([
      { kind: 'snapshot', at: base - 10_000, cursor: 1, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 20, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ], base);
    const heldReplacement = api.hold(query => query.watermark === 2);
    const heads = makeHeads();
    const service = new StagingOrderWallsService(heads.source, () => {}, api.request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'epoch-cursor-reset', request: {
      market: 'binance-perp', from: base - 30_000, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 20, at: base, epoch: 1 });
    await vi.waitFor(() => expect(service.diagnostics().subscriptions[0]?.initialized).toBe(true));

    api.append({ kind: 'snapshot', at: base - 5_000, cursor: 2, epoch: 2, bids: [[price, 0.06]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 2, at: base - 5_000, epoch: 2 });
    const replacement = await heldReplacement.entered.promise;
    expect(replacement).toMatchObject({ watermark: 2, after: 0, from: base - 5_000, to: base - 4_999, limit: 256 });
    expect(api.calls.some(query => query.watermark === 20 && query.to === base + 1)).toBe(true);
    heldReplacement.release();
    service.dispose();
  });

  it('keeps latest depth current during blocked multi-page history and promotes canonical history through a late head', async () => {
    let now = base;
    const api = new FakeDepthApi(sourceRecords(), base);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const chart = makeChartHarness();
    const pageTwo = api.hold(query => query.from === viewportFrom && query.after === 256);
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event);
      applyBatch(chart, event);
    }, api.request, () => now);

    service.command({ type: 'order-wall-subscribe', id: 'lifecycle', request: {
      market: 'binance-perp', from: viewportFrom, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 2_201, at: base, epoch: 1 });

    await pageTwo.entered.promise;
    await vi.waitFor(() => expect(events.some(event => event.kind === 'snapshot' && event.segments?.some(segment => segment.end === null))).toBe(true));
    const currentGeometryIndex = events.findIndex(event => event.kind === 'snapshot' && event.segments?.some(segment => segment.end === null));
    const firstLiveId = activeWall(chart)?.id;
    expect(firstLiveId).toBeDefined();
    expect(api.calls.filter(query => query.from === viewportFrom && query.after === 0)).toHaveLength(1);

    // The chart moves 500ms beyond the original viewport without restarting its history replay.
    now = base + 500;
    service.command({ type: 'order-wall-viewport', id: 'lifecycle', from: viewportFrom, to: base + 500 });
    expect(api.calls.filter(query => query.from === viewportFrom && query.after === 0)).toHaveLength(1);

    api.append({ kind: 'delta', at: base + 100, cursor: 2_202, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 2_202, at: base + 100, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)?.valueRuns.some(point => point.at === base + 100 && point.usd === 1_500)).toBe(true));
    expect(activeWall(chart)?.id).toBe(firstLiveId);
    expect(events.at(-1)?.status.lastConfirmedAt).toBe(base + 100);

    api.append({ kind: 'delta', at: base + 300, cursor: 2_203, epoch: 1, bids: [[price, 0.05]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 2_203, at: base + 300, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)?.valueRuns.some(point => point.at === base + 300 && point.usd === 2_500)).toBe(true));
    expect(activeWall(chart)?.id).toBe(firstLiveId);
    pageTwo.release();
    // The canonical detector drains the already processed live pages directly,
    // so moving heads do not force a durable reread while promotion is pending.
    await vi.waitFor(() => expect(events.some(event => event.kind === 'patch'
      && event.patches?.some(patch => patch.replaceValueRuns === true))).toBe(true));
    await vi.waitFor(() => expect(events.at(-1)?.status.lastConfirmedAt).toBe(base + 300));

    const afterCurrentGeometry = events.slice(currentGeometryIndex + 1);
    expect(afterCurrentGeometry.every(event => event.kind === 'patch')).toBe(true);
    expect(afterCurrentGeometry.some(event => event.patches?.some(patch => patch.replaceValueRuns === true))).toBe(true);
    expect(api.calls.filter(query => query.from === viewportFrom && query.after === 0)).toHaveLength(1);
    expect(api.calls.some(query => query.from === viewportFrom && query.watermark === 2_203)).toBe(false);
    expect(activeWall(chart)?.id).toBe(firstLiveId);

    const expected = referenceSegments(api, viewportFrom, base + 300, 2_203);
    const rendered = [...chart.orderWallSegments.values()];
    expect(normalizedSegments(rendered)).toEqual(normalizedSegments(expected));

    api.append({ kind: 'delta', at: base + 500, cursor: 2_204, epoch: 1, bids: [[price, 0.06]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 2_204, at: base + 500, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)?.valueRuns.some(point => point.at === base + 500 && point.usd === 3_000)).toBe(true));
    expect(activeWall(chart)?.id).toBe(firstLiveId);
    service.dispose();
  });

  it('applies canonical value-run replacement through the actual chart wrapper even when run counts match', () => {
    const chart = makeChartHarness();
    const original: OrderWallSegment = {
      id: 'live-render-id', epoch: 1, side: 'bid', price, start: base - 1_000, end: null,
      peakUsd: 2_000, meanUsd: 1_500, durationMs: 1_000, percentile: 100,
      scopePartial: false, startKnown: false,
      valueRuns: [{ at: base - 1_000, usd: 1_000, percentile: 100 }, { at: base - 500, usd: 2_000, percentile: 100 }],
      valueRunsTruncated: false, endReason: null, endKnown: false,
    };
    chart.setOrderWallSnapshot([original], { state: 'live', lastConfirmedAt: base });
    const canonical: OrderWallSegment = {
      ...original,
      start: base - 5_000,
      startKnown: true,
      durationMs: 5_000,
      meanUsd: 1_750,
      valueRuns: [{ at: base - 4_000, usd: 1_500, percentile: 100 }, { at: base - 2_000, usd: 2_000, percentile: 100 }],
    };
    const patch = { id: original.id, segment: canonical, replaceValueRuns: true } as OrderWallPatch;
    chart.patchOrderWalls([patch], { state: 'live', lastConfirmedAt: base });

    expect(chart.orderWallSegments.get(original.id)).toEqual(canonical);
    expect(orderWallValueAt(chart.orderWallSegments.get(original.id)!, base - 3_000)).toBe(1_500);
    expect(orderWallValueAt(chart.orderWallSegments.get(original.id)!, base - 1_500)).toBe(2_000);
  });

  it('does not join a wall through a recorded gap or a changed depth epoch', async () => {
    const from = base - 5_000;
    const records: RawRecord[] = [
      { kind: 'snapshot', at: from - 1, cursor: 0, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base - 3_000, cursor: 1, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
      { kind: 'gap', at: base - 2_000, cursor: 2, epoch: 1, reason: 'fixture source gap' },
      { kind: 'snapshot', at: base - 1_000, cursor: 3, epoch: 2, bids: [[price, 0.05]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 4, epoch: 2, bids: [[price, 0.06]], asks: [], bookScope: scope },
    ];
    const api = new FakeDepthApi(records, base);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type === 'order-wall-batch') events.push(event);
    }, api.request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'gap-epoch', request: { market: 'binance-perp', from, to: base, settings } });
    heads.send({ type: 'head', cursor: 4, at: base, epoch: 2 });
    await vi.waitFor(() => expect(events.at(-1)?.status.lastConfirmedAt).toBe(base));
    await vi.waitFor(() => expect(events.some(event => event.patches?.some(patch => patch.replaceValueRuns))).toBe(true));

    const rendered = events.reduce((map, event) => {
      if (event.kind === 'snapshot') {
        map.clear();
        for (const segment of event.segments ?? []) map.set(segment.id, segment);
      } else for (const patch of event.patches ?? []) patch.segment ? map.set(patch.id, patch.segment) : map.delete(patch.id);
      return map;
    }, new Map<string, OrderWallSegment>());
    const walls = [...rendered.values()].filter(segment => segment.side === 'bid' && segment.price === price).sort((a, b) => a.start - b.start);
    expect(walls).toHaveLength(2);
    expect(walls[0]).toMatchObject({ start: from, end: base - 3_000, startKnown: false, endReason: 'censored', endKnown: false });
    expect(walls[1]).toMatchObject({ start: base - 1_000, end: null, startKnown: false, endReason: null });
    expect(walls[0]?.id).not.toBe(walls[1]?.id);
    expect(events.some(event => event.status.state === 'gap')).toBe(true);
    service.dispose();
  });

  it('ignores a held replay response after the viewport changes and keeps the current wall visible', async () => {
    const fromA = base - 40_000, fromB = base - 30_000;
    const api = new FakeDepthApi([
      { kind: 'snapshot', at: base - 100_000, cursor: 0, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 1, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ], base);
    const oldPage = api.hold(query => query.from === fromA && query.after === 0);
    const newPage = api.hold(query => query.from === fromB && query.after === 0);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const chart = makeChartHarness();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event);
      applyBatch(chart, event);
    }, api.request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'cancelled-replay', request: {
      market: 'binance-perp', from: fromA, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 1, at: base, epoch: 1 });
    await oldPage.entered.promise;
    await vi.waitFor(() => expect(activeWall(chart)).toBeDefined());
    const visibleId = activeWall(chart)?.id;

    service.command({ type: 'order-wall-viewport', id: 'cancelled-replay', from: fromB, to: base });
    await newPage.entered.promise;
    const beforeOldResponse = events.length;
    expect(activeWall(chart)?.id).toBe(visibleId);
    oldPage.release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(events).toHaveLength(beforeOldResponse);
    expect(activeWall(chart)?.id).toBe(visibleId);

    newPage.release();
    await vi.waitFor(() => expect(events.some(event => event.kind === 'patch'
      && event.patches?.some(patch => patch.replaceValueRuns === true))).toBe(true));
    expect(activeWall(chart)?.id).toBe(visibleId);
    service.dispose();
  });

  it('reports a failed live read as stale without censoring the active wall or inventing a source gap', async () => {
    const records: RawRecord[] = [
      { kind: 'snapshot', at: base - 10_000, cursor: 1, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 2, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ];
    const api = new FakeDepthApi(records, base);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const chart = makeChartHarness();
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event);
      applyBatch(chart, event);
    }, api.request, () => base + 100);
    service.command({ type: 'order-wall-subscribe', id: 'transport', request: { market: 'binance-perp', from: base - 20_000, to: base, settings } });
    heads.send({ type: 'head', cursor: 2, at: base, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)).toBeDefined());
    api.fail = query => query.after === 2 && query.to >= base + 101 ? 'upstream temporarily unavailable' : undefined;
    heads.send({ type: 'head', cursor: 3, at: base + 100, epoch: 1 });
    await vi.waitFor(() => expect(events.at(-1)?.status.state).toBe('stale'));

    expect(events.at(-1)?.status.message).toContain('upstream temporarily unavailable');
    expect(events.some(event => event.status.state === 'gap')).toBe(false);
    expect(activeWall(chart)?.end).toBeNull();
    expect(api.calls.some(query => query.to >= base + 101)).toBe(true);
    service.dispose();
  });

  it('censors the confirmed old-epoch wall on reset and waits for a fresh head before bootstrapping again', async () => {
    const api = new FakeDepthApi([
      { kind: 'snapshot', at: base - 10_000, cursor: 1, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 2, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ], base);
    const heads = makeHeads();
    const chart = makeChartHarness();
    const events: WallBatch[] = [];
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event);
      applyBatch(chart, event);
    }, api.request, () => base);

    service.command({ type: 'order-wall-subscribe', id: 'reset', request: {
      market: 'binance-perp', from: base - 30_000, to: base, settings,
    } });
    heads.send({ type: 'head', cursor: 2, at: base, epoch: 1 });
    await vi.waitFor(() => expect(activeWall(chart)?.epoch).toBe(1));
    const old = activeWall(chart)!;

    const callsBeforeReset = api.calls.length;
    heads.send({ type: 'reset', message: 'collector replaced the depth epoch' });
    await vi.waitFor(() => expect(chart.orderWallSegments.get(old.id)?.endReason).toBe('censored'));
    expect(chart.orderWallSegments.get(old.id)).toMatchObject({ end: base, endKnown: false, epoch: 1 });
    await vi.waitFor(() => expect(events.some(event => event.status.state === 'gap')).toBe(true));
    expect(api.calls.slice(callsBeforeReset).filter(query => query.watermark !== undefined)).toHaveLength(0);

    api.append({ kind: 'snapshot', at: base + 50, cursor: 3, epoch: 2, bids: [[price, 0.05]], asks: [], bookScope: scope });
    api.append({ kind: 'delta', at: base + 100, cursor: 4, epoch: 2, bids: [[price, 0.06]], asks: [], bookScope: scope });
    heads.send({ type: 'head', cursor: 4, at: base + 100, epoch: 2 });
    await vi.waitFor(() => expect(activeWall(chart)?.epoch).toBe(2));
    const current = activeWall(chart)!;
    expect(current.id).not.toBe(old.id);
    expect([...chart.orderWallSegments.values()].some(segment => segment.epoch === 1
      && segment.endReason === 'censored' && segment.end === base)).toBe(true);
    expect(api.calls.some(query => query.watermark === 4)).toBe(true);
    expect(api.calls.find(query => query.watermark === 4)).toMatchObject({ from: base + 100, to: base + 101, limit: 256 });
    service.dispose();
  });

  it('keeps a stale notice visible when a held bootstrap resolves and clears it only on a fresh head', async () => {
    const api = new FakeDepthApi([
      { kind: 'snapshot', at: base - 10_000, cursor: 1, epoch: 1, bids: [[price, 0.03]], asks: [], bookScope: scope },
      { kind: 'delta', at: base, cursor: 2, epoch: 1, bids: [[price, 0.04]], asks: [], bookScope: scope },
    ], base);
    const heldBootstrap = api.hold(query => query.watermark === 2);
    const heads = makeHeads();
    const events: WallBatch[] = [];
    const chart = makeChartHarness();
    const noWallSettings = { ...settings, thresholdUsd: 100_000 };
    const service = new StagingOrderWallsService(heads.source, event => {
      if (event.type !== 'order-wall-batch') return;
      events.push(event);
      applyBatch(chart, event);
    }, api.request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'stale-bootstrap', request: {
      market: 'binance-perp', from: base - 30_000, to: base, settings: noWallSettings,
    } });
    heads.send({ type: 'head', cursor: 2, at: base, epoch: 1 });
    await heldBootstrap.entered.promise;

    heads.send({ type: 'stale', message: 'staging depth heartbeat stale' });
    expect(events.at(-1)?.status).toMatchObject({ state: 'stale', message: 'staging depth heartbeat stale' });
    heldBootstrap.release();
    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({ state: 'stale', message: 'staging depth heartbeat stale' }));

    const liveReadsBeforeFreshHead = api.calls.filter(query => query.watermark !== undefined).length;
    heads.send({ type: 'head', cursor: 2, at: base, epoch: 1 });
    await vi.waitFor(() => expect(events.at(-1)?.status.state).not.toBe('stale'));
    expect(events.at(-1)?.status.message).not.toBe('staging depth heartbeat stale');
    expect(events.at(-1)?.kind).toBe('patch');
    expect(events.at(-1)?.patches).toEqual([]);
    expect(api.calls.filter(query => query.watermark !== undefined)).toHaveLength(liveReadsBeforeFreshHead);
    expect(activeWall(chart)).toBeUndefined();
    service.dispose();
  });
});

for(const market of ['spot','perpetual'] as const)it(`Top Levels ${market} live bootstrap reconciles to the same ordered episodes and ranks`,async()=>{
 const topSettings:OrderWallsSettings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native',topLevels:2};
 const records:RawRecord[]=[{kind:'snapshot',at:viewportFrom-1,cursor:0,epoch:1,bids:[[50000,10],[49999,9],[49998,8]],asks:[[50001,12],[50002,11],[50003,10]],bookScope:scope},
  {kind:'delta',at:viewportFrom+100,cursor:1,epoch:1,bids:[[50000,11]],asks:[]},
  {kind:'delta',at:base-1000,cursor:2,epoch:1,bids:[[49998,20]],asks:[]},
  {kind:'delta',at:base,cursor:3,epoch:1,bids:[[50000,12]],asks:[[50001,13]]}];
 const api=new FakeDepthApi(records,base),heads=makeHeads(),chart=makeChartHarness(),events:WallBatch[]=[];
 const held=api.hold(q=>q.watermark===undefined);
 const request:typeof fetch=async(input,init)=>{const response=await api.request(input);const data=await response.json();
  if(market==='spot'){data.market='spot';data.instrument='binance:spot:BTCUSDT';data.feed='binance:spot:BTCUSDT:spot-diff-depth';}
  return pageResponse(data);
 };
 const service=new StagingOrderWallsService(heads.source,e=>{if(e.type==='order-wall-batch'){events.push(e);applyBatch(chart,e);}},request,()=>base);
 service.command({type:'order-wall-subscribe',id:'top-reconcile',request:{market:market==='spot'?'binance-spot':'binance-perp',from:viewportFrom,to:base,followLive:true,settings:topSettings}});
 await held.entered.promise;heads.send({type:'head',cursor:3,at:base,epoch:1});
 await vi.waitFor(()=>expect(events.at(-1)?.status.provisional).toBe(true));
 const generation=service.diagnostics().subscriptions[0]!.generation;
 service.command({type:'order-wall-viewport',id:'top-reconcile',from:viewportFrom,to:base,autoPriceWidth:1000});
 expect(service.diagnostics().subscriptions[0]!.generation).toBe(generation);
 held.release();await vi.waitFor(()=>expect(service.diagnostics().subscriptions[0]?.replayPromoted).toBe(true));
 const seed=api.makeSeed(viewportFrom,3)!;
 const reference=new OrderWallDetector(topSettings,market==='spot'?.01:.1);
 reference.processBatch([{kind:'snapshot',at:seed.at,cursor:seed.cursor,epoch:seed.epoch,bids:seed.bids.map(([p,q])=>[Number(p),Number(q)] as const),asks:seed.asks.map(([p,q])=>[Number(p),Number(q)] as const),bookScope:{bidComplete:true,askComplete:true}},...records.filter(r=>r.cursor>seed.cursor).map(r=>({...r,bookScope:{bidComplete:true,askComplete:true}}))]);
 reference.confirmHead(base,3);
 expect(normalizedSegments([...chart.orderWallSegments.values()])).toEqual(normalizedSegments(reference.snapshot()));
 expect([...chart.orderWallSegments.values()].filter((s:any)=>s.end===null)).toHaveLength(4);
 expect(events.at(-1)?.status.provisional).toBe(false);
 expect(api.calls.every(q=>market==='spot'?q.market==='spot':q.market===undefined)).toBe(true);
 service.dispose();
});

it('keeps overlapping Top Levels episode IDs across an earlier pan without merging same-price re-entries',async()=>{
 const topSettings:OrderWallsSettings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native',topLevels:1};
 const api=new FakeDepthApi([
  {kind:'snapshot',at:viewportFrom-200000,cursor:0,epoch:1,bids:[[50000,10],[49999,9]],asks:[[50001,10]],bookScope:scope},
  {kind:'delta',at:base-50000,cursor:1,epoch:1,bids:[[49999,20]],asks:[]},
  {kind:'delta',at:base-30000,cursor:2,epoch:1,bids:[[49999,1]],asks:[]},
  {kind:'delta',at:base-10000,cursor:3,epoch:1,bids:[[49999,30]],asks:[]},
  {kind:'delta',at:base,cursor:4,epoch:1,bids:[],asks:[]},
 ],base);api.earliestRetainedAt=viewportFrom-200000;
 const heads=makeHeads(),chart=makeChartHarness();const service=new StagingOrderWallsService(heads.source,e=>{if(e.type==='order-wall-batch')applyBatch(chart,e);},api.request,()=>base);
 service.command({type:'order-wall-subscribe',id:'pan-identity',request:{market:'binance-perp',from:viewportFrom,to:base,followLive:false,settings:topSettings}});
 await vi.waitFor(()=>expect(service.diagnostics().subscriptions[0]?.replayPromoted).toBe(true));
 const episodes=()=>[...chart.orderWallSegments.values()].filter((s:any)=>s.price===50000&&s.end!==null).sort((a:any,b:any)=>a.end-b.end) as OrderWallSegment[];
 const before=episodes();expect(before).toHaveLength(2);expect(before[0]!.id).not.toBe(before[1]!.id);
 const generation=service.diagnostics().subscriptions[0]!.generation;
 service.command({type:'order-wall-viewport',id:'pan-identity',from:viewportFrom-100000,to:base,autoPriceWidth:1000});
 await vi.waitFor(()=>{expect(service.diagnostics().subscriptions[0]?.generation).toBeGreaterThan(generation);expect(service.diagnostics().subscriptions[0]?.replayPromoted).toBe(true);});
 expect(episodes().map(s=>s.id)).toEqual(before.map(s=>s.id));expect(episodes()[0]!.start).toBe(viewportFrom-100000);
 expect(episodes().map(s=>s.endReason)).toEqual(['rank-exit','rank-exit']);service.dispose();
});

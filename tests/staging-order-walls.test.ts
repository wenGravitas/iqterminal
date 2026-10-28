import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_WALLS_SETTINGS, type OrderWallRequest } from '../src/feed/order-walls';
import type { DepthHeadNotice, StagingHeatmapService } from '../src/feed/staging-heatmap';
import { StagingOrderWallsService } from '../src/feed/staging-order-walls';

const base = 1_800_000_000_000;
const pageLimit = 256;

function response(market: string, from: number, to: number, watermark: number, after: number, nextAfter: number, observations: unknown[], seed?: unknown, gaps: unknown[] = [],
  coverage: Partial<{ confirmedTo: number; partial: boolean; reason: string }> = {}) {
  return { ok: true, headers: { get: () => null }, json: async () => ({
    // v1 raw depth observations use the venue source ID (the perpetual feed
    // is intentionally not the prepared-history manifest's qualified ID).
    version: 1, market, instrument: market === 'spot' ? 'binance:spot:BTCUSDT' : 'binance:perpetual:BTCUSDT',
    feed: market === 'spot' ? 'binance:spot:BTCUSDT:spot-diff-depth' : 'usd-m-standard-diff-depth-rpi-excluded', from, to, watermark,
    head: { cursor: watermark, at: base, epoch: Number((observations.at(-1) as any)?.epoch ?? (seed as any)?.epoch ?? 1) },
    page: { after, nextAfter, hasMore: false, limit: pageLimit, observations: observations.length, sameMillisecondClosed: true },
    ...(seed ? { seed } : {}), observations,
    coverage: { confirmedTo: base, partial: false, seedAt: base - 500, gaps, ...coverage },
  }) } as unknown as Response;
}

describe('staging Order Walls live head catch-up', () => {
  it('reports the ordered replay frontier while later pages are still pending', async () => {
    const heads = { observeDepthHeads() { return () => {}; } } as unknown as StagingHeatmapService;
    const events: any[] = [];
    let release!: (page: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const request = vi.fn(async (input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.searchParams.get('after') !== '0') return pending;
      const page = response('perpetual', base - 1000, base, 2, 0, 1,
        [{ kind: 'snapshot', at: base - 750, cursor: 1, epoch: 1, bids: [['50000','1']], asks: [] }]);
      const json = await page.json(); json.page.hasMore = true;
      return { ...page, json: async () => json } as Response;
    });
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'progress', request: {
      market: 'binance-perp', from: base - 1000, to: base, followLive: false,
      settings: { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true },
    } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(events.at(-1).status.replay).toEqual({ from: base - 1000, to: base, through: base - 750 });
    release(response('perpetual', base - 1000, base, 2, 1, 2,
      [{ kind: 'delta', at: base - 1, cursor: 2, epoch: 1, bids: [], asks: [] }]));
    await vi.waitFor(() => expect(service.diagnostics().subscriptions[0]?.replayPromoted).toBe(true));
    expect(events.at(-1).status.replay).toBeUndefined();
    service.dispose();
  });

  it('accepts the raw USD-M feed identity used by v1 depth observations', async () => {
    const heads = { observeDepthHeads() { return () => {}; } } as unknown as StagingHeatmapService;
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      return Promise.resolve(response('perpetual', Number(url.searchParams.get('from')), Number(url.searchParams.get('to')), 1, 0, 1,
        [{ kind: 'delta', at: base, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [] }]));
    });
    const service = new StagingOrderWallsService(heads, () => {}, request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'test', request: {
      market: 'binance-perp', from: base - 1_000, to: base,
      settings: { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true },
    } });

    await vi.waitFor(() => expect(service.diagnostics()).toMatchObject({ pages: 1, records: 1, failures: 0 }));
    const url = new URL(String(request.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toContain('/depth-observations');
    expect(url.searchParams.get('limit')).toBe(String(pageLimit));
    service.dispose();
  });

  it('reconstructs a live head from the nearest checkpoint warmup using the bounded page query', async () => {
    let notify!: (notice: DepthHeadNotice) => void;
    const heads = { observeDepthHeads(_id: string, _market: 'spot'|'perpetual', _after: number, callback: (notice: DepthHeadNotice) => void) {
      notify = callback; return () => {};
    } } as unknown as StagingHeatmapService;
    const calls: URL[] = [], events: any[] = [];
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost'); calls.push(url);
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      if (!url.searchParams.has('watermark')) {
        return Promise.resolve(response('perpetual', from, to, 5, 0, 1, [], {
          at: from - 1, cursor: 1, epoch: 1, bids: [], asks: [],
          bookScope: { bids: { complete: true }, asks: { complete: true } },
        }));
      }
      return Promise.resolve({ ok: true, headers: { get: () => null }, json: async () => ({
        version: 1, market: 'perpetual', instrument: 'binance:perpetual:BTCUSDT',
        feed: 'usd-m-standard-diff-depth-rpi-excluded', from, to, watermark: 5,
        head: { cursor: 5, at: base, epoch: 1 },
        page: { after: 0, nextAfter: 5, hasMore: false, limit: pageLimit, observations: 4, sameMillisecondClosed: true },
        // The durable API returns its checkpoint plus all intervening deltas,
        // including the warmup deltas before the one-millisecond query window.
        seed: { at: base - 10_000, cursor: 1, epoch: 1, bids: [['50000', '0.001']], asks: [],
          bookScope: { bids: { complete: true }, asks: { complete: true } } },
        observations: [
          { kind: 'delta', at: base - 5_000, cursor: 2, epoch: 1, bids: [['50000', '0.003']], asks: [] },
          { kind: 'delta', at: base - 3_000, cursor: 3, epoch: 1, bids: [['50000', '0.004']], asks: [] },
          { kind: 'delta', at: base - 1_000, cursor: 4, epoch: 1, bids: [['50000', '0.005']], asks: [] },
          { kind: 'delta', at: base, cursor: 5, epoch: 1, bids: [['50000', '0.006']], asks: [] },
        ],
        coverage: { confirmedTo: base, partial: false, seedAt: base - 10_000, earliestRetainedAt: base - 100_000, gaps: [] },
      }) } as unknown as Response);
    });
    const settings = { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true, method: 'absolute' as const,
      thresholdUsd: 100, aggregation: 50 as const, minDurationMs: 0 };
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'head-warmup', request: {
      market: 'binance-perp', from: base - 30_000, to: base, settings, followLive: true,
    } });
    notify({ type: 'head', cursor: 5, at: base, epoch: 1 });

    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({ state: 'live', provisional: false,
      lastConfirmedAt: base }));
    const bootstrap = calls.find(url => url.searchParams.has('watermark'))!;
    expect(bootstrap).toBeDefined();
    expect(bootstrap.searchParams.get('from')).toBe(String(base));
    expect(bootstrap.searchParams.get('to')).toBe(String(base + 1));
    expect(bootstrap.searchParams.get('limit')).toBe(String(pageLimit));
    const active = events.flatMap(event => event.kind === 'snapshot' ? event.segments ?? []
      : (event.patches ?? []).flatMap((patch: any) => patch.segment ? [patch.segment] : []))
      .find(segment => segment.end === null && segment.price === 50_000);
    expect(active?.start).toBe(base - 5_000);
    expect(calls.every(url => url.searchParams.get('limit') === String(pageLimit))).toBe(true);
    service.dispose();
  });

  it('clears a transient unconfirmed exclusive tail after the current live head confirms the viewport', async () => {
    let notify!: (notice: DepthHeadNotice) => void;
    const heads = { observeDepthHeads(_id: string, _market: 'spot'|'perpetual', _after: number, callback: (notice: DepthHeadNotice) => void) {
      notify = callback; return () => {};
    } } as unknown as StagingHeatmapService;
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      const hasWatermark = url.searchParams.has('watermark');
      return Promise.resolve(response('perpetual', from, to, 1, 0, 1, [], {
        at: base - 500, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [],
        bookScope: { bids: { complete: true }, asks: { complete: true } },
      }, [], { confirmedTo: hasWatermark ? base : base - 1, partial: true,
        reason: 'Durable depth watermark has not confirmed the requested tail' }));
    });
    const events: any[] = [];
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'tail-confirmed', request: {
      market: 'binance-perp', from: base - 1_000, to: base,
      settings: { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true },
    } });
    notify({ type: 'head', cursor: 1, at: base, epoch: 1 });

    await vi.waitFor(() => expect(events.at(-1)?.status).toMatchObject({
      state: 'live', provisional: false, coverage: { from: base - 1_000, to: base, complete: true, partial: false },
    }));
    expect(events.at(-1)?.status.coverage.reason).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it.each([
    { endOffset: 1, complete: true },
    { endOffset: 2, complete: false },
  ])('uses inclusive confirmedTo against exclusive viewport end (head + $endOffset ms)', async ({ endOffset, complete }) => {
    const heads = { observeDepthHeads() { return () => {}; } } as unknown as StagingHeatmapService;
    const events: any[] = [];
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      return Promise.resolve(response('perpetual', from, to, 1, 0, 1, [], {
        at: base, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [],
        bookScope: { bids: { complete: true }, asks: { complete: true } },
      }, [], { confirmedTo: base, partial: false }));
    });
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base + 2);
    service.command({ type: 'order-wall-subscribe', id: `inclusive-end-${endOffset}`, request: {
      market: 'binance-perp', from: base - 1_000, to: base + endOffset,
      followLive: false, settings: { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true },
    } });

    await vi.waitFor(() => expect(events.at(-1)?.status?.coverage).toMatchObject({
      to: base + endOffset, complete, partial: !complete,
    }));
    service.dispose();
  });

  it('keeps real coverage gaps when a later live page only confirms the transient tail', async () => {
    let notify!: (notice: DepthHeadNotice) => void;
    const heads = { observeDepthHeads(_id: string, _market: 'spot'|'perpetual', _after: number, callback: (notice: DepthHeadNotice) => void) {
      notify = callback; return () => {};
    } } as unknown as StagingHeatmapService;
    const gap = { at: base - 250, cursor: 0, epoch: 1, reason: 'Depth continuity unavailable' };
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      const hasWatermark = url.searchParams.has('watermark');
      return Promise.resolve(response('perpetual', from, to, 1, 0, 1, [], {
        at: base - 500, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [],
        bookScope: { bids: { complete: true }, asks: { complete: true } },
      }, hasWatermark ? [] : [gap], { confirmedTo: hasWatermark ? base : base - 1, partial: true,
        reason: hasWatermark ? 'Durable depth watermark has not confirmed the requested tail' : 'Depth continuity gaps are present in the requested range' }));
    });
    const events: any[] = [];
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    service.command({ type: 'order-wall-subscribe', id: 'tail-with-gap', request: {
      market: 'binance-perp', from: base - 1_000, to: base,
      settings: { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true },
    } });
    notify({ type: 'head', cursor: 1, at: base, epoch: 1 });

    await vi.waitFor(() => expect(events.at(-1)?.status?.state).toBe('gap'));
    expect(events.at(-1)?.status).toMatchObject({ state: 'gap', coverage: { complete: false, partial: true,
      reason: 'Depth continuity gaps are present in the requested range' } });
    expect(request).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('drains a head received during initial replay without requiring another head notification', async () => {
    let notify!: (notice: DepthHeadNotice) => void;
    const heads = { observeDepthHeads(_id: string, _market: 'spot'|'perpetual', _after: number, callback: (notice: DepthHeadNotice) => void) {
      notify = callback; return () => {};
    } } as unknown as StagingHeatmapService;
    let finishInitial!: (value: Response) => void;
    const calls: URL[] = [];
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost'); calls.push(url);
      if (calls.length === 1) return new Promise<Response>(resolve => { finishInitial = resolve; });
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      return Promise.resolve(response('perpetual', from, to, 2, 1, 2,
        [{ kind: 'delta', at: base, cursor: 2, epoch: 1, bids: [['50000', '0.03']], asks: [] }]));
    });
    const events: any[] = [];
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    const settings = { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true, method: 'absolute' as const, thresholdUsd: 100 };
    const wallRequest: OrderWallRequest = { market: 'binance-perp', from: base - 1_000, to: base, settings };
    service.command({ type: 'order-wall-subscribe', id: 'test', request: wallRequest });
    notify({ type: 'head', cursor: 2, at: base, epoch: 1 });

    const from = Number(calls[0]!.searchParams.get('from')), to = Number(calls[0]!.searchParams.get('to'));
    finishInitial(response('perpetual', from, to, 1, 0, 1, [], {
      at: base - 500, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [],
      bookScope: { bids: { complete: true }, asks: { complete: true } },
    }, [{ at: base - 250, cursor: 0, epoch: 1, reason: 'Malformed delta was skipped.' }]));
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(events.at(-1)?.status?.lastConfirmedAt).toBe(base));
    const replayCatchup = calls.find(url => url.searchParams.get('watermark') === '2' && url.searchParams.get('after') === '1');
    // The live page was already accepted into the bounded tail buffer, so the
    // canonical lane drains cursor 2 without issuing a duplicate durable read.
    expect(replayCatchup).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(events.some(event => event.patches?.some((patch: any) =>
      patch.valuePoints?.some((point: any) => point.at === base && point.usd === 1_500)
      || patch.segment?.valueRuns?.some((point: any) => point.at === base && point.usd === 1_500)))).toBe(true);
    expect(events.at(-1)?.status?.state).toBe('gap');
    expect(events.at(-1)?.status?.coverage?.partial).toBe(true);
    service.dispose();
  });

  it('replays the bounded normalized timeline cache after detection settings change', async () => {
    const heads = { observeDepthHeads() { return () => {}; } } as unknown as StagingHeatmapService;
    const request = vi.fn((input: RequestInfo|URL) => {
      const url = new URL(String(input), 'http://localhost');
      return Promise.resolve(response('perpetual', Number(url.searchParams.get('from')), Number(url.searchParams.get('to')), 1, 0, 1, [], {
        at: base - 500, cursor: 1, epoch: 1, bids: [['50000', '0.02']], asks: [],
        bookScope: { bids: { complete: true }, asks: { complete: true } },
      }));
    });
    const events: any[] = [];
    const service = new StagingOrderWallsService(heads, event => events.push(event), request, () => base);
    const settings = { ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const, enabled: true, method: 'absolute' as const, thresholdUsd: 100 };
    service.command({ type: 'order-wall-subscribe', id: 'test', request: { market: 'binance-perp', from: base - 1_000, to: base, settings } });
    await vi.waitFor(() => expect(events.at(-1)?.status?.state).toBe('stale'));

    service.command({ type: 'order-wall-settings', id: 'test', settings: { ...settings, thresholdUsd: 700 } });
    await vi.waitFor(() => expect(service.diagnostics().cacheHits).toBe(1));
    await vi.waitFor(() => expect(events.at(-1)?.patches?.some((patch: any) => patch.segment?.price === 50_000)).toBe(true));
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.diagnostics()).toMatchObject({ cacheEntries: 1, cacheHits: 1 });
    service.dispose();
  });
});

it('bounds the published replay mirror, preserves live levels, and explicitly evicts cache entries without declaring removals',()=>{
 const heads={observeDepthHeads(){return()=>{};}} as unknown as StagingHeatmapService;
 const events:any[]=[];const service=new StagingOrderWallsService(heads,e=>events.push(e),()=>new Promise<Response>(()=>{}),()=>base);
 service.command({type:'order-wall-subscribe',id:'bounded-publication',request:{market:'binance-perp',from:base-1000,to:base,settings:{...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true}}});
 const sub=(service as any).subscriptions.get('bounded-publication');
 const segment=(id:string,end:number|null)=>({id,epoch:1,side:'bid',price:50000,start:base-1000,end,peakUsd:100,meanUsd:100,durationMs:1000,percentile:null,scopePartial:true,startKnown:false,valueRuns:[],valueRunsTruncated:false,endReason:end===null?null:'rank-exit',endKnown:end!==null,detectionMode:'top-levels'});
 const patches=[{id:'live-protected',segment:segment('live-protected',null)},...Array.from({length:20030},(_,i)=>({id:'closed-'+i,segment:segment('closed-'+i,base)}))];
 (service as any).publish(sub,'patch',patches,{state:'loading',coverage:{from:base-1000,to:base,complete:false,partial:true}});
 expect(service.diagnostics().subscriptions[0]!.publishedSegments).toBe(20020);
 expect(events.at(-1).status.episodeHistoryLimited).toBe(true);
 expect(events.at(-1).patches.filter((p:any)=>p.segment===null)).toHaveLength(11);
 expect(events.at(-1).patches.some((p:any)=>p.id==='live-protected'&&p.segment===null)).toBe(false);
 expect(events.at(-1).patches.filter((p:any)=>p.segment).every((p:any)=>p.segment.endReason===null||p.segment.endReason==='rank-exit')).toBe(true);
 service.dispose();
});

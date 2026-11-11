import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_WALLS_SETTINGS, orderWallsSettings, type OrderWallMarket, type OrderWallsSettings } from '../src/feed/order-walls';
import { OrderWallsArchiveService } from '../src/feed/order-walls-archive-service';
import {
  OrderWallsArchiveProjector,
  loadOrderWallsArchive,
  orderWallsArchiveProfileId,
  OrderWallsArchiveCurrentPoller,
  orderWallsArchiveAvailability,
  orderWallsArchiveCurrentRequest,
  type OrderWallsArchiveCandidate,
  type OrderWallsArchivePage,
  type OrderWallsArchiveRequest,
} from '../src/feed/order-walls-archive';
import { preparedDepthFeed } from '../src/feed/prepared-history';

const from = 1_800_000_000_000, to = from + 60_000;
const profiles = {
  'binance-spot': { id: 'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1', market: 'spot' as const, instrument: 'binance:spot:BTCUSDT' },
  'binance-perp': { id: 'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1', market: 'perpetual' as const, instrument: 'binance:perpetual:BTCUSDT' },
};
const candidate = (patch: Partial<OrderWallsArchiveCandidate> = {}): OrderWallsArchiveCandidate => ({
  entryId: 'epoch-1:bid:74480:10', side: 'bid', price: '74480.00', quantity: '2.00000000', notional: '148960.00000000', rank: 1,
  startedAt: from + 1_000, startCursor: 10, startEpoch: 1, startKnown: true,
  ...patch,
});
const request = (patch: Partial<OrderWallsArchiveRequest> = {}) => ({
  market: 'binance-spot' as const, from, to, settings: orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, mode: 'top-levels' }),
  ...patch,
});
const profile = (market: OrderWallMarket = 'binance-spot', bandPercent = 10, aggregation = 'native', id?: string,
  confirmationMs = 0, selectionTopN = 10, minimumNotionalUsd: string | null = null) => {
  const spot = market === 'binance-spot', instrument = profiles[market as keyof typeof profiles].instrument;
  const feed = preparedDepthFeed(spot ? 'spot' : 'perpetual');
  return {
    id: id ?? (bandPercent === 10 && aggregation === 'native' ? profiles[market as keyof typeof profiles].id :
      `binance-${spot ? 'spot' : 'usdm'}-btcusdt-feed-${feed.split(':').at(-1)!.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')}-band-${String(bandPercent).replace('.','_')}pct-agg-${aggregation === 'native' ? 'native' : `${aggregation}usdt`}-top10-a1-s1`),
    version: 1, market: profiles[market as keyof typeof profiles].market,
    venue: 'binance' as const, instrument, feed,
    aggregation, bandPercent, midpointBasis: 'best-observed-bid-ask', topN: 10, algorithmVersion: 1, schemaVersion: 1,
    confirmationMs, selectionTopN, minimumNotionalUsd,
    exactDerivations: { bandPercent: [bandPercent], topNMax: 10, minimumNotional: true, confirmation: true, confirmationCrossings: confirmationMs > 0 },
  };
};
const coverage = (overrides: Partial<OrderWallsArchivePage['coverage']> = {}) => ({
  availableFrom: from - 7 * 86_400_000, requestedFrom: from, requestedTo: to, confirmedTo: to - 1,
  gaps: [], partial: false, status: 'complete' as const, bookScope: { bidComplete: false, askComplete: false, outerCoverage: 'snapshot-bounded' }, ...overrides,
});
const page = (patch: Partial<OrderWallsArchivePage> = {}): OrderWallsArchivePage => ({
  version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
  from, to, watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
  patches: [], coverage: coverage(), ...patch,
});
const side = (upserts: OrderWallsArchiveCandidate[] = [], removals: OrderWallsArchivePage['patches'][number]['bids']['removals'] = []) => ({ upserts, removals });
const archivePatch = (cursor: number, at: number, patch: Partial<OrderWallsArchivePage['patches'][number]> = {}): OrderWallsArchivePage['patches'][number] => ({
  kind: 'patch', cursor, at, epoch: 1, midpoint: '78016.00', bids: side(), asks: side(), ...patch,
});

function publishedSegments(events:any[]){
  const rows=new Map<string,any>();
  for(const event of events.filter(event=>event.type==='order-wall-batch')){
    if(event.kind==='snapshot'){rows.clear();for(const row of event.segments??[])rows.set(row.id,row);}
    else for(const patch of event.patches??[]){if(patch.segment)rows.set(patch.id,patch.segment);else rows.delete(patch.id);}
  }
  return [...rows.values()];
}

describe('Order Walls archive profile selection', () => {
  it('historical gaps are explicitly scoped to a view with no current subscription',async()=>{
    const events:any[]=[],ready=page({coverage:coverage({status:'partial',partial:true,gaps:[{at:from+100,reason:'Recorded history gap'}]})});
    const service=new OrderWallsArchiveService(event=>events.push(event),(async()=>Response.json(ready))as any,()=>to);
    try{
      service.subscribe('history-only',{market:'binance-spot',from,to,settings:request().settings,followLive:false});for(let i=0;i<100;i++)await Promise.resolve();
      const history=events.filter(event=>event.ids?.includes('history-only'));expect(history.every(event=>event.status.currentSubscribed===false)).toBe(true);
      expect(history.at(-1).status.archive).toMatchObject({state:'partial',requestComplete:true});
      service.subscribe('current',{market:'binance-spot',from,to,settings:request().settings,followLive:true});expect(events.filter(event=>event.ids?.includes('current'))[0].status.currentSubscribed).toBe(true);
    }finally{service.dispose();}
  });
  it('selects the exact native Top10 profile for Binance spot and USD-M perpetual', () => {
    for (const market of ['binance-spot', 'binance-perp'] as const) {
      expect(orderWallsArchiveAvailability(market, request({ market }).settings)).toMatchObject({ exact: true, profileId: profiles[market].id, requestedBandPercent: 10 });
    }
  });

  it('strictly validates qualified USD-M feeds for current and historical pages', async () => {
    const settings = request({ market: 'binance-perp' }).settings;
    const current = {
      version: 1, profile: profile('binance-perp'), market: 'perpetual', instrument: 'binance:perpetual:BTCUSDT',
      feed: preparedDepthFeed('perpetual'), watermark: 20,
      head: { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true },
      state: { bids: [], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'backfilling',
      coverage: { availableFrom: from - 1_000, confirmedTo: to - 1, status: 'partial', partial: true, gaps: [] },
    };
    const currentRequest = orderWallsArchiveCurrentRequest(request({ market: 'binance-perp', settings }))!;
    const currentFetcher = vi.fn(async () => new Response(JSON.stringify(current), { status: 200 }));
    let validatedCurrent: unknown;
    let poller!: OrderWallsArchiveCurrentPoller;
    const currentPage = new Promise<void>(resolve => {
      poller = new OrderWallsArchiveCurrentPoller({ request: currentRequest, fetcher: currentFetcher as unknown as typeof fetch,
        onPage: page => { validatedCurrent = page; poller.stop(); resolve(); }, intervalMs: 100 });
    });
    poller.start();
    try {
      await currentPage;
      expect(validatedCurrent).toMatchObject({ profile: { feed: preparedDepthFeed('perpetual') }, profileStatus: 'backfilling' });
      expect(currentFetcher).toHaveBeenCalledTimes(1);
    } finally { poller.stop(); }

    const historical = page({ profile: profile('binance-perp'), market: 'perpetual',
      instrument: 'binance:perpetual:BTCUSDT', feed: preparedDepthFeed('perpetual'), profileStatus: 'backfilling' });
    const historyFetcher = vi.fn(async () => new Response(JSON.stringify(historical), { status: 200 }));
    const result = await loadOrderWallsArchive({ request: request({ market: 'binance-perp', settings }),
      fetcher: historyFetcher as unknown as typeof fetch });
    expect(result.status.archive).toMatchObject({ state: 'complete', profileStatus: 'backfilling', exact: true,
      feed: preparedDepthFeed('perpetual') });

    const shortSlug = { ...historical, feed: 'usd-m-standard-diff-depth-rpi-excluded',
      profile: { ...historical.profile, feed: 'usd-m-standard-diff-depth-rpi-excluded' } };
    const shortSlugFetcher = vi.fn(async () => new Response(JSON.stringify(shortSlug), { status: 200 }));
    await expect(loadOrderWallsArchive({ request: request({ market: 'binance-perp', settings }),
      fetcher: shortSlugFetcher as unknown as typeof fetch })).rejects.toThrow('Invalid Order Walls archive page contract');
  });

  it('does not claim that Top10 in a 10% band exactly answers a narrower band', () => {
    const custom = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', searchRangePercent: 2 });
    const availability = orderWallsArchiveAvailability('binance-spot', custom);
    expect(availability.exact).toBe(false);
    expect(availability.admissionRequired).toBe(true);
    expect(availability.profileId).toBe(orderWallsArchiveProfileId('binance-spot', custom));
  });

  it('keys nonzero confirmation profiles by delay, selected TopN, and minimum filter', () => {
    const custom = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', topLevels: 3,
      minimumNotionalEnabled: true, minimumNotionalUsd: 250_000.5, minDurationMs: 700.5 });
    const id = orderWallsArchiveProfileId('binance-spot', custom)!;
    expect(id).toContain('-confirm-700_5ms-n3-minusd-250000_5');
    expect(orderWallsArchiveAvailability('binance-spot', custom)).toMatchObject({ exact: false, admissionRequired: true, profileId: id });
    expect(orderWallsArchiveCurrentRequest(request({ settings: custom }))).toMatchObject({
      profile: id, confirmationMs: 700.5, selectionTopN: 3, minimumNotionalUsd: '250000.5',
    });
  });

  it('keeps nonzero confirmation unavailable until the matching profile materializes crossings', async () => {
    const requestedTo = from + 6_001;
    const settings = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', minDurationMs: 5_000,
      topLevels: 2, minimumNotionalEnabled: true, minimumNotionalUsd: 150_000 });
    const id = orderWallsArchiveProfileId('binance-spot', settings)!;
    const observed = candidate({ startedAt: from + 1_000, confirmationAt: from + 6_000, notional: '160000', quantity: '2' });
    const body = page({ from: from - 5_000, to: requestedTo, profile: profile('binance-spot', 10, 'native', id, 5_000, 2, '150000'),
      coverage: coverage({ requestedFrom: from - 5_000, requestedTo, confirmedTo: requestedTo - 1 }),
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: from + 6_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(20, from + 6_000, { bids: side([observed]) })],
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const result = await loadOrderWallsArchive({ request: request({ settings, to: requestedTo }), fetcher: fetcher as unknown as typeof fetch });
    expect(result.status.archive).toMatchObject({ state: 'complete', exact: true, profileId: id });
    expect(result.segments[0]).toMatchObject({ start: from + 1_000, durationMs: 5_000 });
  });

  it('keeps Threshold Walls outside the Top Levels archive profile', () => {
    const legacy = orderWallsSettings({ mode: 'threshold', method: 'absolute', thresholdUsd: 123_456, aggregation: 'auto' });
    expect(orderWallsArchiveAvailability('binance-spot', legacy)).toMatchObject({ exact: false, reason: expect.stringContaining('Threshold Walls') });
  });
});

describe('OrderWallsArchiveProjector', () => {
  it('retains exact decimals and assigns deterministic ids across a paged reload', () => {
    const settings = request().settings;
    const seed = { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: false, askComplete: false } };
    const observed = candidate();
    const first = page({
      seed,
      watermark: 20,
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([observed]) })],
      coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }),
    });
    const second = page({
      watermark: 20,
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(20, from + 8_000, { bids: side([candidate({ quantity: '2.12500000', notional: '158090.00000000', rank: 2 })]) })],
      coverage: coverage({ confirmedTo: to - 1 }),
    });
    const one = new OrderWallsArchiveProjector(settings, from, to);
    one.applyPage(first); one.applyPage(second);
    const two = new OrderWallsArchiveProjector(settings, from, to);
    two.applyPage(first); two.applyPage(second);
    expect(one.snapshot()).toEqual(two.snapshot());
    expect(one.snapshot()).toHaveLength(1);
    expect(one.snapshot()[0]).toMatchObject({ priceExact: '74480.00', start: from + 1_000, rank: 2 });
    expect(one.snapshot()[0]!.valueRuns.at(-1)).toMatchObject({ quantityExact: '2.12500000', notionalExact: '158090.00000000' });
  });

  it('treats a carry-in as active at the requested edge without inventing its original start', () => {
    const projector = new OrderWallsArchiveProjector(request().settings, from, to);
    projector.applyPage(page({ seed: { at: from, cursor: 5, epoch: 1, midpoint: '78016.00', bids: [candidate({ startedAt: from - 50_000, startKnown: false })], asks: [], bookScope: { bidComplete: true, askComplete: true } } }));
    expect(projector.snapshot()[0]).toMatchObject({ start: from, startKnown: false, end: null });
  });

  it('ends rank exits as selection exits, and censors gaps at last confirmed time', () => {
    const projector = new OrderWallsArchiveProjector(request().settings, from, to);
    const initial = candidate();
    projector.applyPage(page({
      seed: { at: from, cursor: 9, epoch: 1, midpoint: '78016.00', bids: [initial], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      patches: [
        archivePatch(11, from + 10_000, { bids: side([], [{ entryId: initial.entryId, side: 'bid', price: initial.price, at: from + 10_000, cursor: 11, epoch: 1, reason: 'rank-exit', lastConfirmedAt: from + 10_000, lastConfirmedCursor: 11 }]) }),
        { ...archivePatch(12, from + 20_000, { kind: 'gap', reason: 'Depth continuity gap', bids: side([], [{ entryId: 'next', side: 'bid', price: '74490.00', at: from + 20_000, cursor: 12, epoch: 1, reason: 'gap', lastConfirmedAt: from + 10_000, lastConfirmedCursor: 11 }]) }), asks: side() },
      ],
      coverage: coverage({ confirmedTo: from + 10_000, status: 'partial', partial: true, gaps: [{ from: from + 10_000, to: from + 20_000, reason: 'Depth continuity gap' }] }),
    }));
    expect(projector.snapshot()[0]).toMatchObject({ end: from + 10_000, endReason: 'rank-exit', endKnown: true });
  });

  it('uses an exact confirmation crossing while retaining the original eligibility start', () => {
    const settings: OrderWallsSettings = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', topLevels: 1,
      minimumNotionalEnabled: true, minimumNotionalUsd: 150_000, minDurationMs: 5_000 });
    const projector = new OrderWallsArchiveProjector(settings, from, to);
    const high = candidate({ notional: '160000.00', quantity: '2.00', startedAt: from + 3_000, startCursor: 11 });
    const confirmed = candidate({ ...high, confirmationAt: from + 8_000 });
    projector.applyPage(page({
      seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      patches: [
        archivePatch(11, from + 3_000, { bids: side([high]) }),
        archivePatch(12, from + 8_000, { bids: side([confirmed]) }),
        archivePatch(13, from + 10_000, { bids: side([], [{ entryId: high.entryId, side: 'bid', price: high.price, at: from + 10_000, cursor: 13, epoch: 1, reason: 'rank-exit', lastConfirmedAt: from + 10_000, lastConfirmedCursor: 13 }]) }),
      ],
      coverage: coverage({ confirmedTo: from + 11_000 }),
    }));
    expect(projector.snapshot()).toHaveLength(1);
    expect(projector.snapshot()[0]).toMatchObject({ start: from + 3_000, end: from + 10_000, endReason: 'rank-exit' });
  });

  it('compares archive notional decimals exactly at a minimum threshold', () => {
    const settings = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', minimumNotionalEnabled: true, minimumNotionalUsd: 100_000 });
    const projector = new OrderWallsArchiveProjector(settings, from, to);
    const below = candidate({ notional: '99999.999999999999999999', quantity: '1.00' });
    const meets = candidate({ notional: '100000.000000000000001', quantity: '1.00' });
    projector.applyPage(page({
      seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      patches: [archivePatch(10, from + 1_000, { bids: side([below]) }), archivePatch(11, from + 2_000, { bids: side([meets]) })],
      coverage: coverage({ confirmedTo: from + 3_000 }),
    }));
    expect(projector.snapshot()).toHaveLength(1);
    expect(projector.snapshot()[0]!.valueRuns[0]!.notionalExact).toBe('100000.000000000000001');
  });

  it('retains a long-lived archive wall with exact values beyond the legacy per-wall run limit', () => {
    const updates = Array.from({ length: 2_500 }, (_, index) => candidate({
      entryId: 'long-lived-archive-wall', startedAt: from + 1_000, startCursor: 10, startEpoch: 1, startKnown: true,
      quantity: `1.${String(index + 1).padStart(8, '0')}`,
      notional: `100000.${String(index + 1).padStart(8, '0')}`,
      rank: index % 8 + 1,
    }));
    const seed = candidate({ entryId: 'long-lived-archive-wall', startedAt: from + 1_000, startCursor: 10,
      startEpoch: 1, startKnown: true });
    const patches = updates.map((value, index) => archivePatch(11 + index, from + 1_001 + index, { bids: side([value]) }));
    const projector = new OrderWallsArchiveProjector(request().settings, from, to);
    projector.applyPage(page({ watermark: 11 + updates.length, head: { cursor: 11 + updates.length, at: to - 1, epoch: 1 },
      seed: { at: from + 1_000, cursor: 10, epoch: 1, midpoint: '78016.00', bids: [seed], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 0, nextAfter: 11 + updates.length, hasMore: false, lastAt: from + 1_001 + updates.length - 1,
        limit: 256, sameMillisecondClosed: true },
      patches, coverage: coverage({ confirmedTo: from + 1_001 + updates.length - 1 }) }));

    const segment = projector.snapshot()[0]!;
    const reference = [seed, ...updates].map((value, index) => ({
      at: index === 0 ? from + 1_000 : from + 1_000 + index,
      usd: Number(value.notional), percentile: null, rank: value.rank, quantity: Number(value.quantity),
      quantityExact: value.quantity, notionalExact: value.notional,
    }));
    expect(segment.valueRuns).toEqual(reference);
    expect(segment.valueRunsTruncated).toBe(false);
    expect(projector.diagnostics()).toMatchObject({ retainedSegments: 1, valueRuns: updates.length + 1,
      largestSegmentRuns: updates.length + 1, episodeHistoryLimited: false, valueHistoryLimited: false });
  });

  it('emits only appended values and leaves a closed historical segment untouched', () => {
    const projector = new OrderWallsArchiveProjector(request().settings, from, to);
    const live = candidate({entryId:'live'}), closed = candidate({entryId:'closed',price:'74450.00'});
    projector.applyPage(page({seed:{at:from,cursor:1,epoch:1,midpoint:'78016.00',bids:[live,closed],asks:[],bookScope:{bidComplete:true,askComplete:true}},
      patches:[archivePatch(2,from+2000,{bids:side([],[{entryId:'closed',side:'bid',price:closed.price,at:from+2000,cursor:2,epoch:1,reason:'rank-exit',lastConfirmedAt:from+2000,lastConfirmedCursor:2}])})]}));
    const before = projector.snapshot().find(segment=>segment.id.includes('closed'))!;
    const value = {...live,quantity:'3.00000000',notional:'223440.00000000'};
    const patches = projector.applyPage(page({page:{after:20,nextAfter:21,hasMore:false,lastAt:to,limit:256,sameMillisecondClosed:true},
      watermark:21,head:{cursor:21,at:to,epoch:1},patches:[archivePatch(21,to,{bids:side([value])})],coverage:coverage({confirmedTo:to})}));
    expect(patches.some(patch=>patch.id===before.id)).toBe(false);
    const append=patches.find(patch=>patch.segment?.end===null)!;
    expect(append.replaceValueRuns).toBe(false);
    expect(append.segment?.valueRuns).toEqual([]);
    expect(append.valuePoints).toHaveLength(1);
    expect(append.valuePoints![0]!.quantityExact).toBe(value.quantity);
    expect(projector.snapshot().find(segment=>segment.id===before.id)).toBe(before);
  });

  it('uses an archive pre-roll to confirm carry-in across the visible left edge', () => {
    const settings = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', minDurationMs: 5_000 });
    const queryFrom = from - 5_000;
    const id = orderWallsArchiveProfileId('binance-spot', settings)!;
    const seedCandidate = candidate({ startedAt: queryFrom - 10_000, startKnown: true, confirmationAt: queryFrom - 5_000 });
    const body = page({ from: queryFrom, profile: profile('binance-spot', 10, 'native', id, 5_000, settings.topLevels),
      seed: { at: queryFrom, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [seedCandidate], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      coverage: coverage({ requestedFrom: queryFrom, confirmedTo: from + 1_000 }) });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(body), { status: 200 }));
    return loadOrderWallsArchive({ request: request({ settings }), fetcher: fetcher as unknown as typeof fetch }).then(result => {
      expect(new URL(String(fetcher.mock.calls[0]![0]), 'http://localhost').searchParams.get('from')).toBe(String(queryFrom));
      expect(result.segments[0]).toMatchObject({ start: queryFrom - 10_000, startKnown: true });
    });
  });
});

describe('loadOrderWallsArchive', () => {
  it('keeps request coverage separate from global profile backfill and clamps page prefixes', async () => {
    const settings = request().settings;
    const wall = candidate({ startedAt: from, startCursor: 0, startKnown: true });
    const common = { watermark: 20, head: { cursor: 20, at: to + 10_000, epoch: 1 }, profileStatus: 'backfilling' as const,
      coverage: coverage({ confirmedTo: to, status: 'partial', partial: true, reason: 'Requested band scope is partial' }) };
    const first = page({ ...common, seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [wall], asks: [],
      bookScope: { bidComplete: false, askComplete: false } },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([candidate({ ...wall, quantity: '3', notional: '223440' })]) })] });
    const second = page({ ...common,
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: from + 8_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(20, from + 8_000, { bids: side([candidate({ ...wall, quantity: '4', notional: '297920' })]) })] });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      new URL(String(url), 'http://localhost').searchParams.get('after') === '0' ? first : second), { status: 200 }));
    const updates: any[] = [];
    const result = await loadOrderWallsArchive({ request: request({ settings }), fetcher: fetcher as unknown as typeof fetch,
      onUpdate: update => updates.push({ ...update, segments: update.segments?.map(segment => ({ ...segment, valueRuns: [...segment.valueRuns] })) }) });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ kind: 'snapshot', status: { archive: {
      state: 'loading', profileStatus: 'backfilling', confirmedTo: to, loadedThrough: from + 1_000,
    } } });
    expect(updates[0].segments[0]).toMatchObject({ start: from, durationMs: 1_000, end: null });
    expect(result.status.archive).toMatchObject({ state: 'partial', profileStatus: 'backfilling', confirmedTo: to, loadedThrough: to });
    expect(result.segments[0]).toMatchObject({ start: from, durationMs: to - from, end: null });
  });

  it('retries a transient page failure at the same fixed-watermark cursor', async () => {
    const wall = candidate({ entryId: 'retry-wall', startedAt: from + 1_000, startCursor: 10 });
    const first = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([wall]) })],
      coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }) });
    const terminal = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(20, to - 1, { bids: side([candidate({ ...wall, quantity: '3', notional: '223440' })]) })] });
    const afters: number[] = [], metrics: any[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const after = Number(new URL(String(url), 'http://localhost').searchParams.get('after'));
      afters.push(after);
      if (after === 0) return new Response(JSON.stringify(first), { status: 200 });
      if (afters.filter(value => value === 10).length === 1) throw new DOMException('signal timed out', 'TimeoutError');
      return new Response(JSON.stringify(terminal), { status: 200 });
    });

    const result = await loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch,
      onPageMetrics: metric => metrics.push(metric) });

    expect(afters).toEqual([0, 10, 10]);
    expect(result).toMatchObject({ pages: 2, cursor: 20, status: { archive: { state: 'complete', requestComplete: true } } });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.valueRuns).toHaveLength(2);
    expect(metrics.map(metric => metric.attempts)).toEqual([1, 2]);
  });

  it('resumes an exhausted page without replaying the validated prefix or reporting a source gap', async () => {
    const wall = candidate({ entryId: 'resume-wall', startedAt: from + 1_000, startCursor: 10 });
    const first = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([wall]) })],
      coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }) });
    const terminal = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(20, to - 1, { bids: side([candidate({ ...wall, quantity: '3', notional: '223440' })]) })] });
    const afters: number[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const after = Number(new URL(String(url), 'http://localhost').searchParams.get('after'));
      afters.push(after);
      if (after === 0) return new Response(JSON.stringify(first), { status: 200 });
      if (afters.filter(value => value === 10).length <= 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(terminal), { status: 200 });
    });

    const interrupted = await loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch });

    expect(interrupted).toMatchObject({ pages: 1, cursor: 10, status: { state: 'loading', archive: {
      state: 'partial', requestComplete: false, resumeAfter: 10, gaps: [], loadedThrough: from + 1_000,
    } } });
    expect(interrupted.segments).toHaveLength(1);
    expect(interrupted.segments[0]).toMatchObject({ archiveEntryId: wall.entryId, end: null });
    expect(interrupted.resume).toBeDefined();

    const resumed = await loadOrderWallsArchive({ request: request(), resume: interrupted.resume,
      fetcher: fetcher as unknown as typeof fetch });

    expect(afters).toEqual([0, 10, 10, 10, 10]);
    expect(resumed).toMatchObject({ pages: 2, cursor: 20, status: { archive: { state: 'complete', requestComplete: true } } });
    expect(resumed.segments).toHaveLength(1);
    expect(resumed.segments[0]).toMatchObject({ archiveEntryId: wall.entryId, end: null });
    expect(resumed.segments[0]?.valueRuns).toHaveLength(2);
  });

  it('cancels a scheduled page retry promptly when its request becomes obsolete', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed'); });
    try {
      const pending = loadOrderWallsArchive({ request: request(), signal: abort.signal,
        fetcher: fetcher as unknown as typeof fetch });
      for (let index = 0; index < 20; index++) await Promise.resolve();
      expect(fetcher).toHaveBeenCalledTimes(1);
      abort.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('completes a multi-batch archive whose transferred bytes exceed the former cumulative limit', async () => {
    const pageCount = 65, perPagePadding = 'x'.repeat(1_100_000);
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const after = Number(new URL(String(url), 'http://localhost').searchParams.get('after'));
      const ordinal = after + 1;
      const body = page({
        watermark: pageCount, head: { cursor: pageCount, at: to - 1, epoch: 1 },
        page: { after, nextAfter: ordinal, hasMore: ordinal < pageCount, lastAt: from + ordinal, limit: 256, sameMillisecondClosed: true },
        patches: [archivePatch(ordinal, from + ordinal)],
        coverage: coverage({ confirmedTo: to - 1 }),
      });
      return new Response(JSON.stringify({ ...body, transportPadding: perPagePadding }), { status: 200 });
    });

    const result = await loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch });
    expect(result.pages).toBe(pageCount);
    expect(result.cursor).toBe(pageCount);
    expect(result.bytes).toBeGreaterThan(64 * 1024 * 1024);
    expect(result.status.archive).toMatchObject({ state: 'complete', exact: true, confirmedTo: to - 1, rangeComplete: true });
    expect(result.status.episodeHistoryLimited).toBeUndefined();
    expect(result.status.valueHistoryLimited).toBeUndefined();
  }, 30_000);

  it('rejects a single archive page that exceeds its bounded response size', async () => {
    const body = page({ transportPadding: 'x'.repeat(4 * 1024 * 1024 + 1) } as Partial<OrderWallsArchivePage>);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch }))
      .rejects.toThrow('exceeded its response-size limit');
  });

  it('holds one watermark across pages and publishes the closed archive timeline', async () => {
    const settings = request().settings, observed: Array<{ kind: string; watermark?: number }> = [];
    const pageMetrics: Array<{ requestedAfter: number; responseBytes: number; responseHeadersMs: number; responseBodyReadMs: number;
      jsonParseMs: number; validationMs: number; projectorApplyMs: number; updateCallbackMs: number; eventLoopYieldDelayMs: number }> = [];
    const first = page({
      watermark: 20, seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: false, askComplete: false } },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([candidate()]) })], coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }),
    });
    const second = page({
      watermark: 20, page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(20, from + 8_000, { bids: side([candidate({ quantity: '3.00000000', notional: '223440.00000000' })]) })],
    });
    const mockedFetcher = vi.fn(async (url: RequestInfo | URL) => {
      const after = Number(new URL(String(url), 'http://localhost').searchParams.get('after'));
      const response = after === 0 ? first : second;
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-length': '100' } });
    });
    const result = await loadOrderWallsArchive({ request: request(), fetcher: mockedFetcher as unknown as typeof fetch,
      onUpdate: update => observed.push({ kind: update.kind, watermark: update.watermark }), onPageMetrics: metrics => pageMetrics.push(metrics) });
    expect(mockedFetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(mockedFetcher.mock.calls[1]![0]), 'http://localhost').searchParams.get('watermark')).toBe('20');
    expect(result.status.archive).toMatchObject({ state: 'complete', exact: true, confirmedTo: to - 1 });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.valueRuns.at(-1)).toMatchObject({ quantityExact: '3.00000000', notionalExact: '223440.00000000' });
    expect(observed.map(item => item.kind)).toEqual(['snapshot', 'patch']);
    expect(pageMetrics).toHaveLength(2);
    expect(pageMetrics.every(metrics => metrics.responseBytes > 0 && metrics.responseHeadersMs >= 0 && metrics.responseBodyReadMs >= 0
      && metrics.jsonParseMs >= 0 && metrics.validationMs >= 0 && metrics.projectorApplyMs >= 0
      && metrics.updateCallbackMs >= 0 && metrics.eventLoopYieldDelayMs >= 0)).toBe(true);
  });

  it('does not report full range coverage when terminal pages stop short of the requested extent', async () => {
    const short = page({ coverage: coverage({ confirmedTo: to - 10_000, status: 'complete', partial: false }) });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(short), { status: 200 }));
    const result = await loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch });
    expect(result.status.archive).toMatchObject({ requestComplete: true, rangeComplete: false, state: 'partial' });
    expect(result.status.archive?.reason).toMatch(/full requested time extent/);
  });

  it('requests a canonical custom profile and reports server unavailability explicitly', async () => {
    const unavailable = orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'top-levels', searchRangePercent: 2 });
    const body = page({ profile: profile('binance-spot', 2), coverage: coverage({ status: 'unavailable', partial: true, reason: 'Custom interval predates retained source.' }) });
    const mockedFetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(body), { status: 200 }));
    const result = await loadOrderWallsArchive({ request: request({ settings: unavailable }), fetcher: mockedFetcher as unknown as typeof fetch });
    expect(mockedFetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(mockedFetcher.mock.calls[0]![0]), 'http://localhost').searchParams.get('profile')).toBe(orderWallsArchiveProfileId('binance-spot', unavailable));
    expect(result.status.archive).toMatchObject({ state: 'unavailable', exact: false });
    expect(result.status.message).toContain('predates retained source');
  });

  it('rejects pages that split same-millisecond cursor groups or change watermark', async () => {
    const split = page({ page: { after: 0, nextAfter: 0, hasMore: false, lastAt: from, limit: 256, sameMillisecondClosed: false } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(split), { status: 200 }));
    await expect(loadOrderWallsArchive({ request: request(), fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow('Invalid Order Walls archive page contract');
  });

  it('accepts a bootstrap seed cursor and retains the first fixed head when later archive pages omit it', async () => {
    const first = page({
      seed: { at: from, cursor: 5, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 5, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([candidate()]) })], coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }),
    });
    const second = page({
      head: undefined,
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(20, from + 8_000, { bids: side([candidate({ notional: '150000.00' })]) })],
    });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const after = Number(new URL(String(url), 'http://localhost').searchParams.get('after'));
      return new Response(JSON.stringify(after === 0 ? first : second), { status: 200 });
    });
    const result = await loadOrderWallsArchive({ request: request(), fetcher });
    expect(result.watermark).toBe(20);
    expect(result.head).toMatchObject({ cursor: 20, at: to - 1, epoch: 1 });
    expect(result.segments).toHaveLength(1);
  });
});

describe('OrderWallsArchiveCurrentPoller', () => {
  it('bounds current catch-up pages per poll and resumes from the last applied cursor', async () => {
    vi.useFakeTimers();
    const currentRequest = { profile: profiles['binance-spot'].id, market: 'spot' as const, instrument: 'binance:spot:BTCUSDT',
      aggregation: 'native', bandPercent: 10, after: 100, limit: 1 };
    const wall = candidate({ entryId: 'paged-wall', startCursor: 105, startedAt: from + 5_000 });
    const first = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 110, head: { cursor: 110, at: from + 10_000, epoch: 1, midpoint: '78016.00', valid: true },
      page: { after: 100, nextAfter: 105, hasMore: true, lastAt: from + 5_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(105, from + 5_000, { bids: side([wall]) })], profileStatus: 'ready',
      coverage: { availableFrom: from - 1_000, confirmedTo: from + 10_000, status: 'complete', gaps: [] },
    };
    const second = {
      ...first, page: { after: 105, nextAfter: 110, hasMore: false, lastAt: from + 10_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(110, from + 10_000, { bids: side([candidate({ ...wall, quantity: '3', notional: '223440' })]) })],
    };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      new URL(String(url), 'http://localhost').searchParams.get('after') === '100' ? first : second), { status: 200 }));
    const seen: number[] = [], statuses: string[] = [], confirmedTimes: number[] = [];
    const poller = new OrderWallsArchiveCurrentPoller({ request: currentRequest, fetcher: fetcher as unknown as typeof fetch,
      maxPagesPerPoll: 1, intervalMs: 1_000, onPage: page => {
        seen.push(...page.patches.map(patch => patch.cursor)); confirmedTimes.push(page.coverage?.confirmedTo ?? 0);
      },
      onStatus: status => statuses.push(status.state) });
    const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
    try {
      poller.start();
      await flush();
      expect(seen).toEqual([105]);
      expect(confirmedTimes).toEqual([from + 5_000]);
      expect(poller.stats.yieldedPolls).toBe(1);
      expect(statuses).toContain('catching-up');
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(seen).toEqual([105, 110]);
      expect(confirmedTimes).toEqual([from + 5_000, from + 10_000]);
      expect(poller.stats.cursor).toBe(110);
      expect(statuses.at(-1)).toBe('ready');
      expect(new URL(String(fetcher.mock.calls[1]![0]), 'http://localhost').searchParams.get('after')).toBe('105');
      expect(new URL(String(fetcher.mock.calls[1]![0]), 'http://localhost').searchParams.has('watermark')).toBe(false);
    } finally {
      poller.stop();
      vi.useRealTimers();
    }
  });

  it('rejects an H3 head inside an H2 page batch and resumes from the last applied cursor', async () => {
    const currentRequest = { profile: profiles['binance-spot'].id, market: 'spot' as const, instrument: 'binance:spot:BTCUSDT', aggregation: 'native', bandPercent: 10, after: 100, limit: 1 };
    const newWall = candidate({ entryId: 'new-wall', startCursor: 105, startedAt: from + 5_000 });
    const entering = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 110, head: { cursor: 110, at: from + 10_000, epoch: 1, midpoint: '78016.00', valid: true },
      page: { after: 100, nextAfter: 105, hasMore: true, lastAt: from + 5_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(105, from + 5_000, { bids: side([newWall]) })], profileStatus: 'ready',
      coverage: { availableFrom: from - 1000, confirmedTo: from + 10_000, status: 'complete', gaps: [] },
    };
    const h3DuringH2 = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 110, head: { cursor: 115, at: from + 20_000, epoch: 1, midpoint: '78016.00', valid: true },
      page: { after: 105, nextAfter: 110, hasMore: false, lastAt: from + 10_000, limit: 1, sameMillisecondClosed: true },
      patches: [archivePatch(110, from + 10_000, { bids: side([newWall]) })], profileStatus: 'ready',
      coverage: { availableFrom: from - 1000, confirmedTo: from + 20_000, status: 'complete', gaps: [] },
    };
    const h3Catchup = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 115, head: { cursor: 115, at: from + 20_000, epoch: 1, midpoint: '78016.00', valid: true },
      page: { after: 105, nextAfter: 115, hasMore: false, lastAt: from + 20_000, limit: 2, sameMillisecondClosed: true },
      patches: [archivePatch(110, from + 10_000, { bids: side([newWall]) }),
        archivePatch(115, from + 20_000, { bids: side([], [{ entryId: newWall.entryId, side: 'bid', price: newWall.price, at: from + 20_000,
          cursor: 115, epoch: 1, reason: 'rank-exit', lastConfirmedAt: from + 20_000, lastConfirmedCursor: 115 }]) })], profileStatus: 'ready',
      coverage: { availableFrom: from - 1000, confirmedTo: from + 20_000, status: 'complete', gaps: [] },
    };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url), 'http://localhost'), after = Number(parsed.searchParams.get('after'));
      const pinned = parsed.searchParams.get('watermark');
      const body = after === 100 ? entering : after === 105 && pinned === '110' ? h3DuringH2 : h3Catchup;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const seen: number[] = [], synced: Array<{ cursor: number; at: number; epoch: number }> = [];
    const projector = new OrderWallsArchiveProjector(request().settings, from, Number.MAX_SAFE_INTEGER);
    let poller!: OrderWallsArchiveCurrentPoller;
    poller = new OrderWallsArchiveCurrentPoller({ request: currentRequest, fetcher: fetcher as unknown as typeof fetch, intervalMs: 10,
      onSynced: head => synced.push(head),
      onPage: page => {
        seen.push(...page.patches.map(patch => patch.cursor));
        projector.applyCurrentPage(page, from);
        if (page.watermark === 110 && page.page.hasMore) expect(page.coverage?.confirmedTo).toBe(from + 5_000);
        if (page.watermark === 110 && !page.page.hasMore) {
          expect(page.head).toMatchObject({ cursor: 110, at: from + 10_000 });
          expect(page.coverage?.confirmedTo).toBe(from + 10_000);
          expect(projector.snapshot().find(segment => segment.archiveEntryId === newWall.entryId)).toMatchObject({ end: null, durationMs: 5_000 });
        }
        if (seen.includes(115)) poller.stop();
      } });
    poller.start();
    await new Promise(resolve => setTimeout(resolve, 650));
    poller.stop();
    expect(seen).toEqual([105, 110, 115]);
    expect(synced).toEqual([{ cursor: 115, at: from + 20_000, epoch: 1 }]);
    expect(poller.stats.cursor).toBe(115);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetcher.mock.calls[2]![0]), 'http://localhost').searchParams.get('after')).toBe('105');
    expect(new URL(String(fetcher.mock.calls[2]![0]), 'http://localhost').searchParams.has('watermark')).toBe(false);
  });

  it('does not join current state across a historical request that ends before the fixed head', async () => {
    vi.useFakeTimers();
    const shortTo = from + 10_000, headAt = from + 20_000;
    const settings = request().settings;
    const currentCandidate = candidate({ startedAt: headAt, startCursor: 20, startKnown: false });
    const bootstrap = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: headAt, epoch: 1, midpoint: '78016.00', valid: true },
      state: { bids: [currentCandidate], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: headAt, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: headAt, status: 'complete', gaps: [] },
    };
    const currentUpdate = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 30, head: { cursor: 30, at: headAt + 10_000, epoch: 1, midpoint: '78016.00', valid: true },
      page: { after: 20, nextAfter: 30, hasMore: false, lastAt: headAt + 10_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(30, headAt + 10_000, { bids: side([candidate({ ...currentCandidate, quantity: '3', notional: '223440' })]) })],
      profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: headAt + 10_000, status: 'complete', gaps: [] },
    };
    const history = page({ to: shortTo, head: { cursor: 20, at: headAt, epoch: 1 },
      seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00',
        bids: [candidate({ startedAt: from, startCursor: 10, startKnown: true })], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: shortTo - 1, limit: 256, sameMillisecondClosed: true },
      coverage: coverage({ requestedFrom: from, requestedTo: shortTo, confirmedTo: shortTo - 1 }) });
    let currentPolls = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) {
        currentPolls++;
        return new Response(JSON.stringify(currentPolls === 1 ? bootstrap : currentUpdate), { status: 200 });
      }
      return new Response(JSON.stringify(history), { status: 200 });
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => shortTo);
    const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
    try {
      service.subscribe('short-history', { market: 'binance-spot', from, to: shortTo, settings, followLive: true });
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      const published = events.filter(event => event.type === 'order-wall-batch').flatMap(event => event.patches ?? []);
      expect(published.some((patch: any) => patch.segment?.start === headAt + 10_000 && patch.segment.currentSelection === true && patch.segment.presentationKind === 'current-snapshot' && patch.segment.durationMs === 0 && patch.segment.valueRuns.length === 1)).toBe(true);
      expect(published.some((patch: any) => patch.segment?.start === from)).toBe(false);
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });
});

describe('OrderWallsArchiveService fixed-watermark identity bridge', () => {
  it('publishes validated historical prefixes through the loaded boundary while current walls stay live', async () => {
    vi.useFakeTimers();
    const historyWall = candidate({ entryId: 'archive-prefix', startedAt: from, startCursor: 0, startKnown: true });
    const currentWall = candidate({ entryId: 'live-at-head', startedAt: to - 1, startCursor: 20, startKnown: false });
    const current = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true },
      state: { bids: [currentWall], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'backfilling',
      coverage: { availableFrom: from - 1_000, confirmedTo: to - 1, status: 'partial', partial: true, gaps: [] },
    };
    const historyPages = [
      page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 }, profileStatus: 'backfilling',
        seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [historyWall], asks: [], bookScope: { bidComplete: true, askComplete: true } },
        page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 1, sameMillisecondClosed: true },
        patches: [archivePatch(10, from + 1_000, { bids: side([candidate({ ...historyWall, quantity: '3', notional: '223440' })]) })],
        coverage: coverage({ confirmedTo: to - 1, status: 'partial', partial: true }) }),
      page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 }, profileStatus: 'backfilling',
        page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 1, sameMillisecondClosed: true },
        patches: [archivePatch(20, to - 1, { bids: side([candidate({ ...historyWall, quantity: '4', notional: '297920' })]) })],
        coverage: coverage({ confirmedTo: to - 1, status: 'partial', partial: true }) }),
    ];
    let finishHistory!: (response: Response) => void;
    const fetcher = vi.fn(async (url: RequestInfo | URL,init?:RequestInit) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) return new Response(JSON.stringify(current), { status: 200 });
      const after = Number(parsed.searchParams.get('after'));
      return after === 0 ? new Response(JSON.stringify(historyPages[0]), { status: 200 })
        : await new Promise<Response>((resolve,reject) => { finishHistory = resolve;init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}); });
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
    try {
      service.subscribe('backfilling-prefix', { market: 'binance-spot', from, to, settings: request().settings, followLive: true });
      await flush();
      const prefix = events.filter(event => event.type === 'order-wall-batch').at(-1);
      const historicalPrefix = publishedSegments(events).find((segment: any) => segment.archiveEntryId === historyWall.entryId);
      expect(prefix?.status).toMatchObject({ state: 'live', archive: {
        state: 'loading', profileStatus: 'backfilling', confirmedTo: to - 1, loadedThrough: from + 1_000,
      } });
      expect(historicalPrefix).toMatchObject({ start: from, durationMs: 1_000 });
      expect(publishedSegments(events).some((segment: any) => segment.currentSelection && segment.end === null)).toBe(true);

      finishHistory(new Response(JSON.stringify(historyPages[1]), { status: 200 }));
      await flush();
      const terminal = events.filter(event => event.type === 'order-wall-batch').at(-1);
      expect(terminal?.status).toMatchObject({ state: 'live', archive: {
        state: 'partial', profileStatus: 'backfilling', confirmedTo: to - 1, loadedThrough: to - 1,
      } });
      expect(publishedSegments(events).some((segment: any) => segment.archiveEntryId === historyWall.entryId)).toBe(true);
      expect(publishedSegments(events).some((segment: any) => segment.currentSelection && segment.end === null)).toBe(true);
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps history progress heartbeats separate from chart segment patches while current walls stay live', async () => {
    vi.useFakeTimers();
    const currentCandidate = candidate({ entryId: 'current-checkpoint', startedAt: to - 1, startCursor: 20, startKnown: false });
    const bootstrap = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true },
      state: { bids: [currentCandidate], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: to - 1, status: 'complete', gaps: [] },
    };
    const historyPages = [
      page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
        page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 256, sameMillisecondClosed: true },
        patches: [archivePatch(10, from + 1_000)], coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }) }),
      page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
        page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
        patches: [archivePatch(20, to - 1)], coverage: coverage({ confirmedTo: to - 1 }) }),
    ];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) return new Response(JSON.stringify(bootstrap), { status: 200 });
      const after = Number(parsed.searchParams.get('after'));
      return new Response(JSON.stringify(historyPages[after === 0 ? 0 : 1]), { status: 200 });
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    try {
      service.subscribe('live-during-history', { market: 'binance-spot', from, to, settings: request().settings, followLive: true });
      for (let index = 0; index < 50; index++) await Promise.resolve();
      const batches = events.filter(event => event.type === 'order-wall-batch');
      expect(batches.some(event => event.kind === 'patch' && event.status.archive?.state === 'loading'
        && event.patches?.length === 0)).toBe(true);
      expect(batches.flatMap(event => event.patches ?? []).every((patch: any) => 'segment' in patch)).toBe(true);
      expect(batches.at(-1)?.segments?.some((segment: any) => segment.currentSelection)).toBe(true);
      expect(service.diagnostics().historyPageTiming).toMatchObject({ totalPages: 2, retainedSamples: 2, completeSample: true });
      expect(service.diagnostics().historyPageTiming.p95.projectorApplyMs).toEqual(expect.any(Number));
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('shares one fixed-watermark history job and current group across matching charts', async () => {
    vi.useFakeTimers();
    const currentCandidate = candidate({ entryId: 'shared-current', startedAt: to - 1, startCursor: 20, startKnown: false });
    const current = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true },
      state: { bids: [currentCandidate], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: to - 1, status: 'complete', gaps: [] },
    };
    const archive = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(20, to - 1)], coverage: coverage({ confirmedTo: to - 1 }) });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      new URL(String(url), 'http://localhost').pathname.endsWith('/current') ? current : archive), { status: 200 }));
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    const flush = async () => { for (let index = 0; index < 80; index++) await Promise.resolve(); };
    try {
      const subscription = { market: 'binance-spot' as const, from, to, settings: request().settings, followLive: true };
      service.subscribe('restore-current', {...subscription,currentOnly:true});await flush();
      expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/archive?'))).toHaveLength(0);
      expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/current?'))).toHaveLength(1);
      service.subscribe('shared-one', subscription);
      service.subscribe('shared-two', subscription);service.unsubscribe('restore-current');
      await flush();

      const diagnostics = service.diagnostics();
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/archive?'))).toHaveLength(1);
      expect(diagnostics.historyRequests).toBe(1);
      expect(diagnostics.historyJobs).toBe(1);
      expect(diagnostics.historyConsumers).toBe(2);
      expect(diagnostics.groups).toBe(1);
      for (const id of ['shared-one', 'shared-two']) {
        const batches = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes(id));
        expect(batches.at(-1)?.status).toMatchObject({ state: 'live', archive: { state: 'complete' } });
        expect(batches.at(-1)?.segments?.some((segment: any) => segment.currentSelection && segment.end === null)).toBe(true);
      }

      service.updateViewport('shared-one', from + 10_000, to - 10_000, false);
      await flush();
      expect(service.diagnostics()).toMatchObject({ historyRequests: 1, historyJobs: 1, historyConsumers: 2, groups: 1 });

      service.unsubscribe('shared-one');
      expect(service.diagnostics()).toMatchObject({ historyJobs: 1, historyConsumers: 1, groups: 1 });
      service.unsubscribe('shared-two');
      expect(service.diagnostics()).toMatchObject({ historyJobs: 0, historyConsumers: 0, groups: 0 });
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('uses the latest visible range when it arrives before the current bootstrap',async()=>{
    let release!:(value:Response)=>void;
    const urls:string[]=[],signals:AbortSignal[]=[];
    const current={version:1,profile:profile(),market:'spot',instrument:profiles['binance-spot'].instrument,feed:preparedDepthFeed('spot'),
      watermark:20,head:{cursor:20,at:to-1,epoch:1,valid:true,midpoint:'78016.00',bookScope:{bidComplete:true,askComplete:true}},
      state:{bids:[candidate()],asks:[]},
      page:{after:0,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},patches:[],profileStatus:'ready',
      coverage:{availableFrom:from-1000,confirmedTo:to-1,status:'complete',gaps:[]}};
    const fetcher:any=(url:unknown,init:any)=>{urls.push(String(url));signals.push(init.signal);
      if(String(url).includes('/current?'))return new Promise(resolve=>{release=resolve;});
      return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
    const service=new OrderWallsArchiveService(()=>{},fetcher,()=>to);
    const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      service.subscribe('delayed-current',{market:'binance-spot',from:from-10000000,to,settings:request().settings,followLive:true});await flush();
      service.updateViewport('delayed-current',from,to,false);
      expect(signals[0].aborted).toBe(false);
      release(new Response(JSON.stringify(current)));await flush();
      const history=urls.filter(url=>url.includes('/archive?'));expect(history).toHaveLength(2);
      expect(new URL(history.at(-1)!,'http://localhost').searchParams.get('from')).toBe(String(from));
      expect(new URL(history.at(-1)!,'http://localhost').searchParams.get('to')).toBe(String(to));
      expect(urls.filter(url=>url.includes('/current?'))).toHaveLength(1);
    }finally{service.dispose();}
  });

  it('cancels an offscreen initial prefix when a much narrower visible viewport arrives',async()=>{
    const signals:AbortSignal[]=[];
    const fetcher:any=(_url:unknown,init:any)=>{signals.push(init.signal);return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});};
    const service=new OrderWallsArchiveService(()=>{},fetcher,()=>to);
    try{
      service.subscribe('visible-priority',{market:'binance-spot',from,to:to+10000000,settings:request().settings,followLive:false});
      for(let i=0;i<40;i++)await Promise.resolve();
      service.updateViewport('visible-priority',from+(to-from)/2,to,false);
      for(let i=0;i<40;i++)await Promise.resolve();
      expect(signals[0]?.aborted).toBe(true);
      expect(service.diagnostics().historyRequests).toBe(2);
    }finally{service.dispose();}
  });

  it('shows bounded warm history immediately and validates independently without erasing good walls',async()=>{
    const initial=candidate({entryId:'warm-wall',startedAt:from-100,startCursor:1,startKnown:false});
    const ready=page({page:{after:1,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},seed:{at:from,cursor:1,epoch:1,midpoint:'78016.00',bids:[initial],asks:[],bookScope:{bidComplete:true,askComplete:true}}});
    let release!:(value:Response)=>void,calls=0;
    const fetcher:any=(_url:unknown,init:any)=>++calls===1?Promise.resolve(new Response(JSON.stringify(ready))):new Promise((resolve,reject)=>{release=resolve;init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
    const events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to);
    const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      const subscription={market:'binance-spot' as const,from,to,settings:request().settings,followLive:false};
      service.subscribe('warm-one',subscription);await flush();
      expect(service.diagnostics().warmEntries).toBe(1);service.unsubscribe('warm-one');
      service.subscribe('warm-two',subscription);await flush();
      const cached=events.filter(event=>event.type==='order-wall-batch'&&event.ids.includes('warm-two')&&event.segments?.length);
      expect(cached.at(-1)?.status.archive.requestComplete).toBe(false);
      expect(cached.at(-1)?.segments[0].archiveEntryId).toBe('warm-wall');
      expect(calls).toBe(2);expect(service.diagnostics()).toMatchObject({historyJobs:1,warmEntries:1});
      release(new Response(JSON.stringify(ready)));await flush();
      const final=events.filter(event=>event.type==='order-wall-batch'&&event.ids.includes('warm-two')).at(-1);
      expect(final.status.archive.requestComplete).toBe(true);
      expect(service.diagnostics().warmBytes).toBeLessThanOrEqual(32*1024*1024);
      service.unsubscribe('warm-two');expect(service.diagnostics()).toMatchObject({historyJobs:0,historyConsumers:0,groups:0});
    }finally{service.dispose();}
    expect(service.diagnostics()).toMatchObject({warmEntries:0,warmBytes:0});
  });

  it('retains active wall presentation across long-open peers and expires only after final idle release',async()=>{
    vi.useFakeTimers();
    const initial=candidate({entryId:'idle-wall',startedAt:from-100,startCursor:1,startKnown:false});
    const ready=page({page:{after:1,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},seed:{at:from,cursor:1,epoch:1,midpoint:'78016.00',bids:[initial],asks:[],bookScope:{bidComplete:true,askComplete:true}}});
    let calls=0;const fetcher:any=(_url:unknown,init:any)=>++calls===1?Promise.resolve(new Response(JSON.stringify(ready))):new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    const events:any[]=[],service=new OrderWallsArchiveService(event=>events.push(event),fetcher,()=>to),subscription={market:'binance-spot' as const,from,to,settings:request().settings,followLive:false};
    const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      service.subscribe('idle-a',subscription);await flush();expect(service.diagnostics().warmEntries).toBe(1);
      await vi.advanceTimersByTimeAsync(120000);expect(service.diagnostics().warmEntries).toBe(1);service.subscribe('idle-b',subscription);await flush();
      service.unsubscribe('idle-a');await vi.advanceTimersByTimeAsync(60000);service.unsubscribe('idle-b');
      await vi.advanceTimersByTimeAsync(59999);service.subscribe('idle-c',subscription);await flush();
      const cached=events.filter(event=>event.type==='order-wall-batch'&&event.ids.includes('idle-c')&&event.segments?.length).at(-1);
      expect(cached?.segments[0].archiveEntryId).toBe('idle-wall');expect(cached?.status.archive.requestComplete).toBe(false);expect(calls).toBe(2);
      service.unsubscribe('idle-c');await vi.advanceTimersByTimeAsync(59999);expect(service.diagnostics().warmEntries).toBe(1);
      await vi.advanceTimersByTimeAsync(1);expect(service.diagnostics()).toMatchObject({warmEntries:0,warmBytes:0,historyConsumers:0,historyJobs:0,warmReplayConsumers:0});
    }finally{service.dispose();vi.useRealTimers();}
  });

  it.each(['viewport','current-only'])('releases unused wall cache interest on %s without extending unrelated data',async(mode)=>{
    vi.useFakeTimers();
    const initial=candidate({entryId:'released-idle',startedAt:from-100,startCursor:1,startKnown:false}),ready=page({page:{after:1,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},seed:{at:from,cursor:1,epoch:1,midpoint:'78016.00',bids:[initial],asks:[],bookScope:{bidComplete:true,askComplete:true}}});
    let calls=0;const fetcher:any=(_url:unknown,init:any)=>++calls===1?Promise.resolve(new Response(JSON.stringify(ready))):new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    const service=new OrderWallsArchiveService(()=>{},fetcher,()=>to),subscription={market:'binance-spot' as const,from,to,settings:request().settings,followLive:false},flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      service.subscribe('idle-original',subscription);await flush();await vi.advanceTimersByTimeAsync(120000);expect(service.diagnostics().warmEntries).toBe(1);
      if(mode==='viewport')service.updateViewport('idle-original',from-60000,to-60000,false);
      else{service.subscribe('idle-current-only',{...subscription,currentOnly:true});service.unsubscribe('idle-original');}
      await flush();await vi.advanceTimersByTimeAsync(60000);expect(service.diagnostics()).toMatchObject({warmEntries:0,warmBytes:0});
    }finally{service.dispose();vi.useRealTimers();}
  });

  it('active wall interests cannot exceed the two-entry cache or retain evicted data',async()=>{
    vi.useFakeTimers();
    const initial=candidate({entryId:'bounded-idle',startedAt:from-100,startCursor:1,startKnown:false}),ready=page({page:{after:1,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},seed:{at:from,cursor:1,epoch:1,midpoint:'78016.00',bids:[initial],asks:[],bookScope:{bidComplete:true,askComplete:true}}});
    const service=new OrderWallsArchiveService(()=>{},(async()=>new Response(JSON.stringify(ready))) as typeof fetch,()=>to),flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      for(const topLevels of [8,9,10]){service.subscribe('bounded-'+topLevels,{market:'binance-spot',from,to,settings:{...request().settings,topLevels},followLive:false});await flush();}
      await vi.advanceTimersByTimeAsync(120000);expect(service.diagnostics()).toMatchObject({subscriptions:3,warmEntries:2});expect(service.diagnostics().warmBytes).toBeLessThanOrEqual(32*1024*1024);
      for(const topLevels of [8,9,10])service.unsubscribe('bounded-'+topLevels);await vi.advanceTimersByTimeAsync(60000);expect(service.diagnostics()).toMatchObject({subscriptions:0,warmEntries:0,warmBytes:0,historyConsumers:0,warmReplayConsumers:0});
    }finally{service.dispose();vi.useRealTimers();}
  });

  it('cancels a shared history fetch only for its last consumer and on service disposal', async () => {
    let finishShared!: (response: Response) => void, sharedSignal: AbortSignal | undefined;
    const sharedFetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      sharedSignal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { finishShared = resolve; });
    });
    const events: any[] = [], service = new OrderWallsArchiveService(event => events.push(event), sharedFetcher as unknown as typeof fetch, () => to);
    const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
    const subscription = { market: 'binance-spot' as const, from, to, settings: request().settings, followLive: false };
    try {
      service.subscribe('cancel-one', subscription);
      service.subscribe('cancel-two', subscription);
      await flush();
      expect(sharedFetcher).toHaveBeenCalledTimes(1);
      expect(service.diagnostics()).toMatchObject({ historyJobs: 1, historyConsumers: 2 });

      service.unsubscribe('cancel-one');
      expect(sharedSignal?.aborted).toBe(false);
      expect(service.diagnostics()).toMatchObject({ historyJobs: 1, historyConsumers: 1 });
      service.unsubscribe('cancel-two');
      expect(sharedSignal?.aborted).toBe(true);
      expect(service.diagnostics()).toMatchObject({ historyJobs: 0, historyConsumers: 0 });
      finishShared(new Response(JSON.stringify(page()), { status: 200 }));
      await flush();
    } finally {
      service.dispose();
    }

    let finishDisposed!: (response: Response) => void, disposedSignal: AbortSignal | undefined;
    const disposedFetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      disposedSignal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { finishDisposed = resolve; });
    });
    const disposedService = new OrderWallsArchiveService(() => {}, disposedFetcher as unknown as typeof fetch, () => to);
    disposedService.subscribe('disposed-job', subscription);
    await flush();
    expect(disposedSignal?.aborted).toBe(false);
    disposedService.dispose();
    expect(disposedSignal?.aborted).toBe(true);
    finishDisposed(new Response(JSON.stringify(page()), { status: 200 }));
    await flush();
  });

  it('loads ready canonical history without waiting for a current bootstrap',async()=>{
    const events:any[]=[],wall=candidate({entryId:'ready-with-delayed-current'});
    const historical=page({patches:[archivePatch(10,from+1000,{bids:side([wall])})]});
    let currentSignal:AbortSignal|undefined;
    const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
      if(new URL(String(input),'http://localhost').pathname.endsWith('/current'))return new Promise<Response>((_resolve,reject)=>{
        currentSignal=init?.signal??undefined;currentSignal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
      });
      return Promise.resolve(new Response(JSON.stringify(historical),{status:200}));
    });
    const service=new OrderWallsArchiveService(event=>events.push(event),fetcher as typeof fetch,()=>to);
    try{
      service.subscribe('independent-history',{market:'binance-spot',from,to,settings:request().settings,followLive:true});
      for(let i=0;i<120;i++)await Promise.resolve();
      expect(currentSignal?.aborted).toBe(false);
      const displayed=new Map<string,any>();
      for(const event of events){if(event.kind==='snapshot'){displayed.clear();for(const row of event.segments??[])displayed.set(row.id,row);}else for(const patch of event.patches??[]){if(patch.segment)displayed.set(patch.id,patch.segment);else displayed.delete(patch.id);}}
      expect([...displayed.values()].some(row=>row.archiveEntryId===wall.entryId)).toBe(true);
      expect(events.at(-1).status.archive.requestComplete).toBe(true);
      expect([...displayed.values()].some(row=>row.presentationKind==='current-snapshot')).toBe(false);
    }finally{service.dispose();}
    expect(currentSignal?.aborted).toBe(true);
  });

  it('commits an already-ready shared replacement without restoring obsolete loading metadata',async()=>{
    const oldTo=from+30*60000,targetTo=oldTo+60000,wall=candidate({entryId:'shared-canonical'}),events:any[]=[];let reads=0;
    const bootstrap={version:1,profile:profile(),market:'spot',instrument:profiles['binance-spot'].instrument,feed:preparedDepthFeed('spot'),
      watermark:30,head:{cursor:30,at:targetTo-1,epoch:1,valid:true,midpoint:'78016.00'},state:{bids:[wall],asks:[]},
      page:{after:0,nextAfter:30,hasMore:false,lastAt:targetTo-1,limit:256,sameMillisecondClosed:true},patches:[],profileStatus:'ready',coverage:{availableFrom:from-1000,confirmedTo:targetTo-1,status:'complete',gaps:[]}};
    const fetcher=async(input:RequestInfo|URL)=>{const url=new URL(String(input),'http://localhost');if(url.pathname.endsWith('/current'))return Response.json(bootstrap);
      reads++;const end=Number(url.searchParams.get('to'));return Response.json(page({to:end,watermark:30,head:{cursor:30,at:end-1,epoch:1},page:{after:0,nextAfter:30,hasMore:false,lastAt:end-1,limit:256,sameMillisecondClosed:true},patches:[archivePatch(10,from+1000,{bids:side([wall])})],coverage:coverage({requestedTo:end,confirmedTo:end-1})}));};
    const service=new OrderWallsArchiveService(event=>events.push(event),fetcher as typeof fetch,()=>oldTo),flush=async()=>{for(let i=0;i<150;i++)await Promise.resolve();};
    try{
      service.subscribe('ready-target',{...request(),to:targetTo,followLive:true});await flush();
      service.subscribe('old-view',{...request(),to:oldTo,followLive:true});await flush();expect(reads).toBe(2);
      service.updateViewport('old-view',from,targetTo,true);await flush();
      const latest=events.filter(event=>event.ids?.includes('old-view')).at(-1);
      expect(latest.status.archive).toMatchObject({to:targetTo,loadedThrough:targetTo-1,requestComplete:true,rangeComplete:true});
      expect(reads).toBe(2);expect(service.diagnostics()).toMatchObject({groups:1,historyJobs:1,historyConsumers:2});
      expect(publishedSegments(events.filter(event=>event.ids?.includes('old-view'))).some(row=>row.archiveEntryId===wall.entryId&&!row.presentationKind)).toBe(true);
    }finally{service.dispose();}
  });

  for(const pending of ['catching-up','stale'] as const)it(`does not publish cached current state as live for a late join while ${pending}`,async()=>{
    vi.useFakeTimers();const events:any[]=[],wall=candidate({entryId:'late-selected'});let finish!:(response:Response)=>void;
    const head=(cursor:number,at:number)=>({cursor,at,epoch:1,valid:true,midpoint:'78016.00'});
    const current=(after:number,next:number,more:boolean)=>({version:1,profile:profile(),market:'spot',instrument:profiles['binance-spot'].instrument,feed:preparedDepthFeed('spot'),
      watermark:after===0?20:30,head:head(after===0?20:30,from+(after===0?15000:30000)),...(after===0?{state:{bids:[wall],asks:[]}}:{}),
      page:{after,nextAfter:next,hasMore:more,lastAt:from+(next===20?15000:next===25?25000:30000),limit:256,sameMillisecondClosed:true},
      patches:after===0?[]:[archivePatch(next,from+(next===25?25000:30000),{bids:side([candidate({...wall,quantity:String(next),notional:String(next*74480)})])})],profileStatus:'ready',
      coverage:{availableFrom:from-1000,confirmedTo:from+(next===20?15000:next===25?25000:30000),status:'complete',gaps:[]}});
    const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=new URL(String(input),'http://localhost');if(!url.pathname.endsWith('/current'))return Response.json(page());
      const after=Number(url.searchParams.get('after'));if(after===0)return Response.json(current(0,20,false));
      if(pending==='stale')throw new TypeError('Explicit current transport failure');
      if(after===20)return Response.json(current(20,25,true));
      return new Promise<Response>((resolve,reject)=>{finish=resolve;init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
    };
    const service=new OrderWallsArchiveService(event=>events.push(event),fetcher as typeof fetch,()=>to),flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      service.subscribe('first-current',{...request(),followLive:true});await flush();await vi.advanceTimersByTimeAsync(1000);await flush();
      service.subscribe('late-current',{...request(),followLive:true});await flush();
      expect(publishedSegments(events.filter(event=>event.ids?.includes('late-current'))).some(row=>row.presentationKind==='current-snapshot')).toBe(false);
      expect(events.filter(event=>event.ids?.includes('late-current')).at(-1).status.state).toBe(pending==='stale'?'gap':'loading');
      if(pending==='catching-up'){
        finish(Response.json(current(25,30,false)));await flush();
        const rows=publishedSegments(events.filter(event=>event.ids?.includes('late-current'))),point=rows.find(row=>row.presentationKind==='current-snapshot');
        expect(point).toMatchObject({start:from+30000,durationMs:0,currentSelection:true});expect(point.valueRuns).toHaveLength(1);expect(point.valueRuns[0].quantityExact).toBe('30');
      }
    }finally{service.dispose();vi.useRealTimers();}
  });

  it('uses current side coverage for complete-partial-complete snapshots without changing the candidate',async()=>{
    vi.useFakeTimers();const events:any[]=[],wall=candidate({entryId:'coverage-snapshot'});
    const fetcher=async(input:RequestInfo|URL)=>{const url=new URL(String(input),'http://localhost');if(!url.pathname.endsWith('/current'))return Response.json(page());
      const after=Number(url.searchParams.get('after')),cursor=after===0?20:after===20?30:40,at=from+cursor*1000;
      return Response.json({version:1,profile:profile(),market:'spot',instrument:profiles['binance-spot'].instrument,feed:preparedDepthFeed('spot'),
        watermark:cursor,head:{cursor,at,epoch:1,valid:true,midpoint:'78016.00',bookScope:{bidComplete:cursor!==30,askComplete:true}},
        ...(after===0?{state:{bids:[wall],asks:[]}}:{}),page:{after,nextAfter:cursor,hasMore:false,lastAt:at,limit:256,sameMillisecondClosed:true},patches:[],profileStatus:'ready',
        coverage:{availableFrom:from-1000,confirmedTo:at,status:'complete',gaps:[]}});};
    const service=new OrderWallsArchiveService(event=>events.push(event),fetcher as typeof fetch,()=>to),flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
    try{
      service.subscribe('coverage',{...request(),followLive:true});await flush();
      const point=()=>publishedSegments(events).find(row=>row.presentationKind==='current-snapshot');
      const first=point();expect(first.scopePartial).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);await flush();expect(point()).toMatchObject({id:first.id,scopePartial:true,durationMs:0});
      expect(point().valueRuns[0].quantityExact).toBe(first.valueRuns[0].quantityExact);
      await vi.advanceTimersByTimeAsync(1000);await flush();expect(point()).toMatchObject({id:first.id,scopePartial:false,durationMs:0});
      expect(point().valueRuns).toHaveLength(1);expect(point().valueRuns[0].notionalExact).toBe(first.valueRuns[0].notionalExact);
    }finally{service.dispose();vi.useRealTimers();}
  });

  it('keeps good history across a roll and replaces it with a full canonical revision including timestamp-ahead episodes', async () => {
    vi.useFakeTimers();
    const settings = request().settings, wideTo = from + 30 * 60_000, roll = 60_000, rolledTo = wideTo + roll;
    const head1 = { cursor: 20, at: wideTo - 1, epoch: 1 };
    const head2 = { cursor: 30, at: rolledTo - 1, epoch: 1 };
    const wall = candidate({ entryId: 'roll-forward-wall', startedAt: from + 1_000, startCursor: 10 });
    const currentWall = candidate({ ...wall, entryId: 'roll-current-checkpoint', startedAt: head1.at, startCursor: 20,
      startKnown: false, quantity: '2.50000000', notional: '186200.00000000' });
    const currentBootstrap = {
      version: 1, profile: profile(), market: 'spot' as const, instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: head1.cursor, head: { ...head1, midpoint: '78016.00', valid: true }, state: { bids: [currentWall], asks: [] },
      page: { after: 0, nextAfter: head1.cursor, hasMore: false, lastAt: head1.at, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: head1.at, status: 'complete', gaps: [] },
    };
    const currentDelta = {
      ...currentBootstrap, watermark: head2.cursor, head: { ...head2, midpoint: '78016.00', valid: true }, state: undefined,
      page: { after: head1.cursor, nextAfter: head2.cursor, hasMore: false, lastAt: head2.at, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(head2.cursor, head2.at, { bids: side([candidate({ ...currentWall, quantity: '3.00000000', notional: '223440.00000000' })]) })],
      coverage: { availableFrom: from - 1_000, confirmedTo: head2.at, status: 'complete', gaps: [] },
    };
    const historyFirst = page({ to: wideTo, watermark: head1.cursor, head: head1,
      seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([wall]) })],
      coverage: coverage({ requestedTo: wideTo, confirmedTo: from + 1_000, status: 'partial', partial: true, gaps: [{from:from+500,to:from+500,reason:'Corrected old gap'}] }) });
    const historyTerminal = page({ to: wideTo, watermark: head1.cursor, head: head1,
      page: { after: 10, nextAfter: head1.cursor, hasMore: false, lastAt: head1.at, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(head1.cursor, head1.at, { bids: side([candidate({ ...wall, quantity: '2.50000000', notional: '186200.00000000' })]) })],
      coverage: coverage({ requestedTo: wideTo, confirmedTo: head1.at,gaps:[{from:from+500,to:from+500,reason:'Corrected old gap'}] }) });
    const ahead = candidate({ entryId: 'timestamp-ahead-wall', price: '100.1', quantity: '1', notional: '100.1', startedAt: wideTo + 1_000, startCursor: 15 });
    const historyExtension = page({ from, to: rolledTo, watermark: head2.cursor, head: head2, seed: historyFirst.seed,
      page: { after: 0, nextAfter: head2.cursor, hasMore: false, lastAt: head2.at, limit: 256, sameMillisecondClosed: true },
      patches: [...historyFirst.patches,
        archivePatch(15, wideTo + 1_000, { bids: side([ahead]) }),
        archivePatch(16, wideTo + 2_000, { bids: side([candidate({ ...ahead, rank: 9 })]) }),
        ...historyTerminal.patches,
        archivePatch(head2.cursor, head2.at, { bids: side([candidate({ ...wall, quantity: '3.00000000', notional: '223440.00000000' })]) })],
      coverage: coverage({ requestedFrom: from, requestedTo: rolledTo, confirmedTo: head2.at }) });
    let currentBootstraps=0;
    let finishReplacement!: (response: Response) => void;
    let finishHistory!: (response: Response) => void;
    let historyPendingSignal: AbortSignal | undefined;
    const archiveRequests: Array<{ from: number; to: number; after: number; watermark: number | null }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(String(input), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) {
        const after = Number(parsed.searchParams.get('after'));
        if(after===0)currentBootstraps++;
        return new Response(JSON.stringify(after === 0 ? currentBootstrap : currentDelta), { status: 200 });
      }
      const query = { from: Number(parsed.searchParams.get('from')), to: Number(parsed.searchParams.get('to')),
        after: Number(parsed.searchParams.get('after')), watermark: parsed.searchParams.has('watermark') ? Number(parsed.searchParams.get('watermark')) : null };
      archiveRequests.push(query);
      if (query.after === 0 && query.to === rolledTo) return new Promise<Response>(resolve => { finishReplacement = resolve; });
      if (query.after === 0) return new Response(JSON.stringify(historyFirst), { status: 200 });
      if (query.from === from && query.after === 10) {
        historyPendingSignal = init?.signal ?? undefined;
        return new Promise<Response>(resolve => { finishHistory = resolve; });
      }
      throw new Error(`Unexpected archive request ${JSON.stringify(query)}`);
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => wideTo);
    const flush = async () => { for (let index = 0; index < 120; index++) await Promise.resolve(); };
    try {
      service.subscribe('roll-forward', { market: 'binance-spot', from, to: wideTo, settings, followLive: true });
      await flush();
      expect(archiveRequests.map(call => call.after)).toEqual([0, 10]);
      service.updateViewport('roll-forward', from + roll, wideTo + roll, true);
      expect(historyPendingSignal?.aborted).toBe(false);
      expect(service.diagnostics()).toMatchObject({ historyRequests: 1, historyJobs: 1, historyConsumers: 1, groups: 1 });

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      expect(archiveRequests.map(call => call.after)).toEqual([0, 10]);
      expect(events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('roll-forward')
        && event.segments?.some((segment: any) => segment.archiveEntryId === wall.entryId)).length).toBeGreaterThan(0);

      finishHistory(new Response(JSON.stringify(historyTerminal), { status: 200 }));
      await flush();
      expect(archiveRequests.at(-1)).toEqual({ from, to: rolledTo, after: 0, watermark: null });
      expect(service.diagnostics()).toMatchObject({ groups: 1, historyJobs: 1 });
      const retained = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('roll-forward')).at(-1);
      expect(retained?.kind).toBe('patch');
      expect(retained?.patches).toEqual([]);
      expect(retained?.status).toMatchObject({ state: 'live', archive: { requestComplete: false, loadedThrough: head1.at } });
      expect(retained.status.archive.gaps).toContainEqual({from:from+500,to:from+500,reason:'Corrected old gap'});
      finishReplacement(new Response(JSON.stringify({...historyExtension,profile:{...historyExtension.profile,id:'invalid-replacement-profile'}}), {status:200}));
      await flush();
      const failed=events.filter(event=>event.type==='order-wall-batch'&&event.ids.includes('roll-forward')).at(-1);
      expect(failed.status).toMatchObject({state:'live',archive:{requestComplete:false,loadedThrough:head1.at}});
      expect(failed.kind).toBe('patch');expect(failed.patches).toEqual([]);
      service.retry('roll-forward');await flush();
      expect(currentBootstraps).toBe(1);
      finishReplacement(new Response(JSON.stringify(historyExtension), { status: 200 }));
      await flush();
      const latest = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('roll-forward')).at(-1);
      expect(latest?.status.archive).toMatchObject({ from, to: rolledTo, requestComplete: true, rangeComplete: true, state: 'complete' });
      expect(latest?.segments?.filter((segment: any) => segment.archiveEntryId === wall.entryId)).toHaveLength(1);
      expect(latest?.segments?.find((segment: any) => segment.archiveEntryId === wall.entryId)?.valueRuns.at(-1)).toMatchObject({ at: head2.at, notionalExact: '223440.00000000' });
      expect(latest.status.archive.gaps).toEqual([]);
      const reference = new OrderWallsArchiveProjector(settings, from, rolledTo); reference.applyPage(historyExtension);
      const actual = latest.segments.filter((segment: any) => segment.presentationKind !== 'current-snapshot').map(({ currentSelection: _selected, ...segment }: any) => segment);
      expect(actual).toEqual(reference.snapshot());
      expect(actual.some((segment: any) => segment.archiveEntryId === ahead.entryId)).toBe(true);
      expect(service.diagnostics()).toMatchObject({ historyRequests: 2, historyJobs: 1, historyConsumers: 1, groups: 1 });
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps current walls live through exhausted history retries and resumes the prefix at its saved cursor', async () => {
    vi.useFakeTimers();
    const settings = request().settings;
    const historyWall = candidate({ entryId: 'retry-live-history', startedAt: from + 1_000, startCursor: 10 });
    const currentWall = candidate({ ...historyWall, entryId: 'retry-live-checkpoint', startKnown: false });
    const head = { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true };
    const currentBootstrap = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head, state: { bids: [currentWall], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: to - 1, status: 'complete', gaps: [] },
    };
    const currentDelta = { ...currentBootstrap, state: undefined,
      page: { ...currentBootstrap.page, after: 20, nextAfter: 20 } };
    const historicalFirst = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 0, nextAfter: 10, hasMore: true, lastAt: from + 1_000, limit: 256, sameMillisecondClosed: true },
      patches: [archivePatch(10, from + 1_000, { bids: side([historyWall]) })],
      coverage: coverage({ confirmedTo: from + 1_000, status: 'partial', partial: true }) });
    const historicalTerminal = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      page: { after: 10, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true },
      coverage: coverage({ confirmedTo: to - 1 }) });
    const historyAfter: number[] = [], currentAfter: number[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) {
        const after = Number(parsed.searchParams.get('after'));
        currentAfter.push(after);
        return new Response(JSON.stringify(after === 0 ? currentBootstrap : currentDelta), { status: 200 });
      }
      const after = Number(parsed.searchParams.get('after'));
      historyAfter.push(after);
      if (after === 0) return new Response(JSON.stringify(historicalFirst), { status: 200 });
      if (historyAfter.filter(value => value === 10).length <= 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(historicalTerminal), { status: 200 });
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
    const chartSegments = () => {
      const segments = new Map<string, any>();
      for (const event of events.filter(item => item.type === 'order-wall-batch' && item.ids.includes('retry-live'))) {
        if (event.kind === 'snapshot') {
          segments.clear();
          for (const segment of event.segments ?? []) segments.set(segment.id, segment);
        } else for (const patch of event.patches ?? []) {
          if (patch.segment) segments.set(patch.id, patch.segment);
          else segments.delete(patch.id);
        }
      }
      return [...segments.values()];
    };
    try {
      service.subscribe('retry-live', { market: 'binance-spot', from, to, settings, followLive: true });
      await flush();
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();

      const interrupted = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('retry-live')).at(-1);
      expect(historyAfter).toEqual([0, 10, 10, 10]);
      expect(currentAfter.length).toBeGreaterThan(1);
      expect(interrupted?.status).toMatchObject({ state: 'live', archive: {
        state: 'partial', requestComplete: false, resumeAfter: 10, gaps: [], loadedThrough: from + 1_000,
      } });
      expect(chartSegments().some((segment: any) => segment.archiveEntryId === historyWall.entryId && segment.end === null)).toBe(true);
      expect(chartSegments().some((segment: any) => segment.currentSelection && segment.end === null)).toBe(true);

      service.retry('retry-live');
      const resuming = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('retry-live')).at(-1);
      expect(resuming?.status).toMatchObject({ state: 'live', message: 'Resuming the validated Order Walls history prefix.',
        archive: { state: 'loading', requestComplete: false, rangeComplete: false } });
      expect(resuming?.status.archive?.resumeAfter).toBeUndefined();
      await flush();

      const resumed = events.filter(event => event.type === 'order-wall-batch' && event.ids.includes('retry-live')).at(-1);
      expect(historyAfter).toEqual([0, 10, 10, 10, 10]);
      expect(resumed?.status).toMatchObject({ state: 'live', archive: { state: 'complete', requestComplete: true } });
      expect(chartSegments().filter((segment: any) => segment.archiveEntryId === historyWall.entryId)).toHaveLength(1);
      expect(chartSegments().some((segment: any) => segment.currentSelection && segment.end === null)).toBe(true);
      expect(service.diagnostics()).toMatchObject({ groups: 1, historyRequests: 1 });
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  });

  it('reports an invalid current checkpoint as unavailable instead of a live empty book', async () => {
    const settings = request().settings;
    const current = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 0, head: { cursor: 0, at: 0, epoch: 0, midpoint: null, valid: false }, state: { bids: [], asks: [] },
      page: { after: 0, nextAfter: 0, hasMore: false, lastAt: null, limit: 256, sameMillisecondClosed: true }, patches: [], profileStatus: 'ready',
      coverage: { availableFrom: null, confirmedTo: null, partial: true, status: 'unavailable', reason: 'No synchronized source state', gaps: [] },
    };
    const historical = page({ watermark: 0, head: { cursor: 0, at: 0, epoch: 0 },
      page: { after: 0, nextAfter: 0, hasMore: false, lastAt: 0, limit: 256, sameMillisecondClosed: true },
      coverage: coverage({ availableFrom: null, confirmedTo: 0, status: 'unavailable', partial: true, reason: 'No archived source state' }) });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      new URL(String(url), 'http://localhost').pathname.endsWith('/current') ? current : historical), { status: 200 }));
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    try {
      service.subscribe('invalid-current', { market: 'binance-spot', from, to, settings, followLive: true });
      for (let index = 0; index < 40; index++) await Promise.resolve();
      const batches = events.filter(event => event.type === 'order-wall-batch');
      expect(batches.at(-1)?.status.state).toBe('unavailable');
      expect(batches.at(-1)?.segments).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it('keeps a valid current lane live while its historical profile is still backfilling', async () => {
    const settings = request().settings;
    const current = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1, midpoint: '78016.00', valid: true }, state: { bids: [], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: to - 1, limit: 256, sameMillisecondClosed: true }, patches: [], profileStatus: 'backfilling',
      coverage: { availableFrom: null, confirmedTo: to - 1, partial: true, status: 'partial', reason: 'Observed band scope is incomplete', gaps: [] },
    };
    const unavailableHistory = page({ watermark: 20, head: { cursor: 20, at: to - 1, epoch: 1 },
      coverage: coverage({ availableFrom: null, status: 'unavailable', partial: true, reason: 'Historical profile is still backfilling' }) });
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      new URL(String(url), 'http://localhost').pathname.endsWith('/current') ? current : unavailableHistory), { status: 200 }));
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => to);
    try {
      service.subscribe('valid-current-backfill', { market: 'binance-spot', from, to, settings, followLive: true });
      for (let index = 0; index < 40; index++) await Promise.resolve();
      const latest = events.filter(event => event.type === 'order-wall-batch').at(-1);
      expect(latest?.status.state).toBe('live');
      expect(latest?.status.archive?.state).toBe('unavailable');
      expect(latest?.segments).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  const runScenario = async (checkpointMismatch = false, currentGap = false, invalidCurrent = false) => {
    vi.useFakeTimers();
    const headAt = from + 15_000, requestTo = from + 60_000;
    const first = candidate({ entryId: 'archive-first-episode', startedAt: from + 1_000, startCursor: 10, startEpoch: 1, startKnown: true });
    const second = candidate({ entryId: 'archive-second-episode', startedAt: headAt, startCursor: 20, startEpoch: 1, startKnown: true });
    const checkpoint = candidate({ ...second, entryId: 'current-checkpoint-episode', startedAt: headAt, startCursor: 20,
      startKnown: false, ...(checkpointMismatch ? { quantity: '1.25', notional: '93100.00' } : {}) });
    const changed = candidate({ ...checkpoint, quantity: checkpointMismatch ? '1.5' : '3.00000000',
      notional: checkpointMismatch ? '111720.00' : '223440.00000000' });
    const postGap = candidate({ entryId: 'current-after-gap', startedAt: headAt + 2_000, startCursor: 30,
      startEpoch: 2, startKnown: true });
    const settings = request().settings;
    const bootstrap = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 20, head: { cursor: 20, at: headAt, epoch: 1, midpoint: '78016.00', valid: true }, state: { bids: [checkpoint], asks: [] },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: headAt, limit: 256, sameMillisecondClosed: true },
      patches: [], profileStatus: 'ready', coverage: { availableFrom: from - 1_000, confirmedTo: headAt, status: 'complete', gaps: [] },
    };
    const currentDelta = {
      version: 1, profile: profile(), market: 'spot', instrument: 'binance:spot:BTCUSDT', feed: 'binance:spot:BTCUSDT:spot-diff-depth',
      watermark: 30, head: { cursor: 30, at: headAt + 5_000, epoch: currentGap ? 2 : 1, midpoint: '78016.00', valid: !invalidCurrent },
      page: { after: 20, nextAfter: 30, hasMore: false, lastAt: headAt + 5_000, limit: 256, sameMillisecondClosed: true },
      patches: currentGap
        ? [{ ...archivePatch(25, headAt + 1_000, { epoch: 2, kind: 'gap', reason: 'Depth replacement epoch' }) },
          archivePatch(30, headAt + 2_000, { epoch: 2, bids: side([postGap]) })]
        : [archivePatch(30, headAt + 5_000, { bids: side([changed]) })], profileStatus: 'ready',
      coverage: { availableFrom: from - 1_000, confirmedTo: headAt + 5_000, status: currentGap ? 'partial' : 'complete',
        gaps: currentGap ? [{ from: headAt + 1_000, to: headAt + 1_000, reason: 'Depth replacement epoch' }] : [] },
    };
    const historical = page({ to: requestTo, watermark: 20, head: { cursor: 20, at: headAt, epoch: 1 },
      seed: { at: from, cursor: 0, epoch: 1, midpoint: '78016.00', bids: [], asks: [], bookScope: { bidComplete: true, askComplete: true } },
      page: { after: 0, nextAfter: 20, hasMore: false, lastAt: headAt, limit: 256, sameMillisecondClosed: true },
      patches: [
        archivePatch(10, from + 1_000, { bids: side([first]) }),
        archivePatch(15, from + 5_000, { bids: side([], [{ entryId: first.entryId, side: 'bid', price: first.price,
          at: from + 5_000, cursor: 15, epoch: 1, reason: 'rank-exit', lastConfirmedAt: from + 5_000, lastConfirmedCursor: 15 }]) }),
        archivePatch(20, headAt, { bids: side([second]) }),
      ], coverage: coverage({ requestedFrom: from, requestedTo: requestTo, availableFrom: from - 1_000, confirmedTo: headAt }),
    });
    let currentPolls = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/current')) {
        currentPolls++;
        return new Response(JSON.stringify(currentPolls === 1 ? bootstrap : currentDelta), { status: 200 });
      }
      return new Response(JSON.stringify(historical), { status: 200 });
    });
    const events: any[] = [];
    const service = new OrderWallsArchiveService(event => events.push(event), fetcher as unknown as typeof fetch, () => requestTo);
    const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
    try {
      service.subscribe('identity-bridge', { market: 'binance-spot', from, to: requestTo, settings, followLive: true });
      await flush();
      const before = new Map<string, any>();
      for (const event of events.filter(item=>item.type==='order-wall-batch')) {
        if(event.kind==='snapshot'){before.clear();for(const segment of event.segments??[])before.set(segment.id,segment);}
        else for(const patch of event.patches??[]){if(patch.segment)before.set(patch.id,patch.segment);else before.delete(patch.id);}
      }
      const historyBefore=JSON.stringify([...before.values()].filter(segment=>segment.presentationKind!=='current-snapshot'));
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      const segments = new Map<string, any>();
      for (const event of events.filter(item => item.type === 'order-wall-batch')) {
        if (event.kind === 'snapshot') {
          segments.clear(); for (const segment of event.segments ?? []) segments.set(segment.id, segment);
        } else for (const patch of event.patches ?? []) {
          if (patch.segment) segments.set(patch.id, patch.segment); else segments.delete(patch.id);
        }
      }
      return { historyBefore, segments: [...segments.values()], status: events.filter(item => item.type === 'order-wall-batch').at(-1)?.status };
    } finally {
      service.dispose();
      vi.useRealTimers();
    }
  };

  it('keeps canonical episode identities and financial bytes unchanged while selected snapshots update', async () => {
    const {segments,historyBefore}=await runScenario(false);
    expect(segments).toHaveLength(3);
    expect(JSON.stringify(segments.filter(segment=>segment.presentationKind!=='current-snapshot'))).toBe(historyBefore);
    expect(segments.find(segment=>segment.archiveEntryId==='archive-first-episode')).toMatchObject({endReason:'rank-exit',currentSelection:false});
    const historical=segments.find(segment=>segment.archiveEntryId==='archive-second-episode');
    expect(historical).toMatchObject({start:from+15_000,startKnown:true,end:null,currentSelection:false});
    expect(historical.valueRuns.at(-1)).toMatchObject({quantityExact:'2.00000000',notionalExact:'148960.00000000'});
    const point=segments.find(segment=>segment.presentationKind==='current-snapshot');
    expect(point).toMatchObject({archiveEntryId:'current-checkpoint-episode',start:from+20_000,durationMs:0,startKnown:false,currentSelection:true});
    expect(point.valueRuns).toHaveLength(1);expect(point.valueRuns[0]).toMatchObject({at:from+20_000,quantityExact:'3.00000000',notionalExact:'223440.00000000'});
    expect(point.id).not.toBe(historical.id);
  });

  it('never censors or remaps canonical history when a same-price current snapshot disagrees', async () => {
    const {segments,historyBefore}=await runScenario(true);
    expect(JSON.stringify(segments.filter(segment=>segment.presentationKind!=='current-snapshot'))).toBe(historyBefore);
    expect(segments.find(segment=>segment.archiveEntryId==='archive-second-episode')).toMatchObject({end:null,endReason:null,currentSelection:false});
    expect(segments.find(segment=>segment.archiveEntryId==='current-checkpoint-episode')).toMatchObject({presentationKind:'current-snapshot',start:from+20_000,durationMs:0,currentSelection:true});
  });

  it('replaces only current snapshot identities after a current gap and epoch change', async () => {
    const {segments,historyBefore}=await runScenario(false,true);
    expect(segments).toHaveLength(3);
    expect(JSON.stringify(segments.filter(segment=>segment.presentationKind!=='current-snapshot'))).toBe(historyBefore);
    expect(segments.find(segment=>segment.archiveEntryId==='archive-second-episode')).toMatchObject({end:null,endReason:null});
    expect(segments.find(segment=>segment.archiveEntryId==='current-after-gap')).toMatchObject({presentationKind:'current-snapshot',start:from+20_000,startKnown:false,durationMs:0,currentSelection:true});
    expect(segments.some(segment=>segment.archiveEntryId==='current-checkpoint-episode')).toBe(false);
  });

  it('removes current snapshot markers when their source becomes invalid, preserving canonical rows',async()=>{
    const {segments,status,historyBefore}=await runScenario(false,false,true);
    expect(segments.every(segment=>segment.presentationKind!=='current-snapshot')).toBe(true);
    expect(JSON.stringify(segments)).toBe(historyBefore);
    expect(status.state).toBe('gap');
  });

  it('reports current gaps independently of the canonical revision coverage', async () => {
    const {status}=await runScenario(false,true);
    expect(status.currentGaps).toContainEqual({from:from+16_000,to:from+16_000,reason:'Depth replacement epoch'});
    expect(status.archive.gaps).toEqual([]);
  });

});


it('holds shared history admission until wall response bodies finish',async()=>{
 const bodies:ReadableStreamDefaultController<Uint8Array>[]=[],aborts=Array.from({length:3},()=>new AbortController());
 const fetcher:any=async()=>new Response(new ReadableStream<Uint8Array>({start(controller){bodies.push(controller);}}));
 const work=aborts.map((abort,index)=>loadOrderWallsArchive({request:request({from:from+index*60000,to:to+index*60000}),signal:abort.signal,fetcher}).catch(()=>undefined));
 try{
  for(let i=0;i<100;i++)await Promise.resolve();expect(bodies).toHaveLength(2);
  bodies[0]!.close();for(let i=0;i<100;i++)await Promise.resolve();expect(bodies).toHaveLength(3);
 }finally{for(const abort of aborts)abort.abort();for(const body of bodies)try{body.close();}catch{}await Promise.allSettled(work);}
});

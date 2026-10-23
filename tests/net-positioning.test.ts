import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetPositioningHistory, netPositioningQuote, type NetPositioningObservation, type NetPositioningPayload, type NetPositioningVenue } from '../src/feed/net-positioning';
import { StagingNetPositioningService } from '../src/feed/staging-net-positioning';

const minute = 60_000;
const base = 1_800_000_000_000;

function observation(endTimeMs: number, patch: Partial<NetPositioningObservation> = {}): NetPositioningObservation {
  return {
    version: 1, method: 'price-oi', status: 'available', venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', units: 'BTC',
    startTimeMs: endTimeMs - 30_000, endTimeMs, attributionTimeMs: endTimeMs, resolutionMs: 30_000, direction: 1,
    oiDeltaBtcDecimal: '0.3', netLongsBtcDecimal: '0.1', netShortsBtcDecimal: '0.2', unclassifiedBtcDecimal: '0', qualityFlags: [],
    provenance: { openInterestStart: { openInterestBtcDecimal: '10' }, openInterestEnd: { openInterestBtcDecimal: '10.3' } }, ...patch,
  };
}

function payload(intervals: NetPositioningObservation[], to: number, venues: NetPositioningVenue[] = ['binance']): NetPositioningPayload {
  return { version: 1, method: 'price-oi', market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', unitVerification: {},
    from: to - 4 * 60 * minute, to, venues, intervals, truncated: false, feeds: {}, pendingIntervals: 0,
    history: 'Observed intervals only.', semantics: 'estimated-side-activity-from-observed-open-interest' };
}

describe('NetPositioningHistory', () => {
  it('projects each interval at its own recorded price, preserves signed BTC, and rejects missing prices', () => {
    const history = new NetPositioningHistory('price-oi', minute);
    const rows = [observation(base + 30_000, { netLongsBtcDecimal: '2', netShortsBtcDecimal: '-1', provenance: { priceEnd: { priceDecimal: '80000' } } }),
      observation(base + 45_000, { netLongsBtcDecimal: '-1', netShortsBtcDecimal: '2', provenance: { priceEnd: { price: 90000 } } })];
    history.replace(payload(rows, base + minute), ['binance']);
    const data = history.get(base)!.venues.binance!;
    expect(netPositioningQuote(data, 'longs')).toBe(70000);
    expect(netPositioningQuote(data, 'shorts')).toBe(100000);
    expect(data.netLongsBtc).toBe(1);
    const missing = { ...rows[1]!, version: 2, provenance: {} };
    history.apply(payload([], base + minute), [missing], ['binance']);
    expect(netPositioningQuote(history.get(base)!.venues.binance!, 'longs')).toBeNull();
    expect(netPositioningQuote(data, 'longs')).toBe(70000);
  });

  it('uses exact decimal aggregation and rebuilds only the candle touched by a versioned interval update', () => {
    const history = new NetPositioningHistory('price-oi', minute);
    const first = observation(base + 30_000, { netLongsBtcDecimal: '0.1', netShortsBtcDecimal: '0.2' });
    const close = observation(base + minute, { netLongsBtcDecimal: '0.2', netShortsBtcDecimal: '0.1' });
    const next = observation(base + minute + 30_000);
    history.replace(payload([first, close, next], base + 2 * minute), ['binance']);

    const before = history.diagnostics().candleRebuilds;
    expect(history.snapshot()).toHaveLength(2);
    expect(history.get(base)?.venues.binance).toMatchObject({ netLongsBtc: 0.1, netShortsBtc: 0.2, availableIntervals: 1 });
    expect(history.get(base + minute)?.venues.binance).toMatchObject({ netLongsBtc: 0.3, netShortsBtc: 0.3, availableIntervals: 2 });

    const revision = { ...first, version: 2, netLongsBtcDecimal: '0.4', provenance: { ...first.provenance, openInterestEnd: { openInterestBtcDecimal: '10.6' } } };
    const changed = history.apply(payload([], base + 2 * minute), [revision], ['binance']);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.timeMs).toBe(base);
    expect(history.get(base)?.venues.binance?.netLongsBtc).toBe(0.4);
    expect(history.diagnostics().candleRebuilds - before).toBe(1);
    expect(history.diagnostics().intervalUpdates).toBe(4);
  });

  it('attributes by effective end time across candle boundaries and prunes by interval end', () => {
    const history = new NetPositioningHistory('price-oi', minute);
    const cutoff = base;
    const old = observation(base - 1, { netLongsBtcDecimal: '5' });
    const before = observation(base + minute - 1, { netLongsBtcDecimal: '0.1' });
    const atBoundary = observation(base + minute, { netLongsBtcDecimal: '0.2' });
    const retained = observation(base + minute + 20_000, { netLongsBtcDecimal: '0.25' });
    history.replace(payload([old, before, atBoundary, retained], cutoff + 4 * 60 * minute), ['binance']);

    expect(history.diagnostics().historyIntervals).toBe(3);
    expect(history.snapshot()).toHaveLength(2);
    expect(history.get(base)?.venues.binance).toMatchObject({ netLongsBtc: 0.1, availableIntervals: 1 });
    expect(history.get(base + minute)?.venues.binance).toMatchObject({ netLongsBtc: 0.45, availableIntervals: 2 });
  });

  it('keeps unavailable intervals explicit and does not count them as observed zero values', () => {
    const history = new NetPositioningHistory('price-oi', minute);
    const unavailable = observation(base + 30_000, { status: 'unavailable', netLongsBtcDecimal: null, netShortsBtcDecimal: null, oiDeltaBtcDecimal: null, unclassifiedBtcDecimal: null, reason: 'source gap' });
    history.replace(payload([unavailable], base + minute), ['binance']);
    expect(history.get(base)?.venues.binance).toMatchObject({ availableIntervals: 0, unavailableIntervals: 1 });
  });

  it('includes OI-unavailable intervals in aggressor-flow coverage', () => {
    const history = new NetPositioningHistory('aggressor-flow-oi', minute);
    const unavailable = observation(base + 30_000, { method: 'aggressor-flow-oi', status: 'unavailable', netLongsBtcDecimal: null, netShortsBtcDecimal: null, oiDeltaBtcDecimal: null, unclassifiedBtcDecimal: null, reason: 'source gap' });
    history.replace({ ...payload([], base + minute), method: 'aggressor-flow-oi', intervals: [unavailable] }, ['binance']);
    expect(history.get(base)?.venues.binance).toMatchObject({ availableIntervals: 0, unavailableIntervals: 1, flowAvailableIntervals: 0, flowUnavailableIntervals: 1 });
  });
});

describe('StagingNetPositioningService', () => {
  afterEach(() => vi.useRealTimers());

  it('merges same-method pane subscriptions and polls only the advancing overlap after the first read', async () => {
    vi.useFakeTimers();
    let now = base;
    const queries: URL[] = [];
    const emit = vi.fn();
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      queries.push(url);
      const venues = (url.searchParams.get('venues') ?? '').split(',').filter(Boolean) as NetPositioningVenue[];
      return new Response(JSON.stringify(payload([], Number(url.searchParams.get('to')), venues)));
    });
    const service = new StagingNetPositioningService(emit, true, request as typeof fetch, () => now);
    service.subscribe('longs', { methods: ['price-oi'], venues: ['binance'] });
    service.subscribe('shorts', { methods: ['price-oi'], venues: ['binance', 'hyperliquid'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(queries[0]?.searchParams.get('venues')).toBe('binance,hyperliquid');
    expect(Number(queries[0]?.searchParams.get('from'))).toBe(base - 4 * 60 * minute);

    now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(Number(queries[1]?.searchParams.get('from'))).toBe(base - 90_000);
    expect(queries[1]?.searchParams.get('venues')).toBe('binance,hyperliquid');
    service.dispose();
  });

  it('publishes full selected-venue metadata when cached and newly selected venues use separate ranges', async () => {
    vi.useFakeTimers();
    let now = base;
    const queries: URL[] = [];
    const events: import('../src/feed/net-positioning').NetPositioningEvent[] = [];
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      queries.push(url);
      const to = Number(url.searchParams.get('to'));
      const venues = (url.searchParams.get('venues') ?? '').split(',').filter(Boolean) as NetPositioningVenue[];
      const body = payload(venues.map((venue, index) => observation(to - index * 1_000, { venue, nativeSymbol: venue === 'binance' ? 'BTCUSDT' : 'BTC' })), to, venues);
      body.feeds = Object.fromEntries(venues.map(venue => [venue, { state: 'live', lastObservedAt: to, stale: false }])) as NetPositioningPayload['feeds'];
      body.unitVerification = Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC' }])) as NetPositioningPayload['unitVerification'];
      return new Response(JSON.stringify(body));
    });
    const service = new StagingNetPositioningService(event => events.push(event), true, request as typeof fetch, () => now);
    service.subscribe('chart', { methods: ['price-oi'], venues: ['binance'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(queries).toHaveLength(1);

    now += 5_000;
    service.subscribe('chart', { methods: ['price-oi'], venues: ['binance', 'hyperliquid'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(queries.slice(1).map(query => query.searchParams.get('venues'))).toEqual(['binance', 'hyperliquid']);
    const latest = [...events].reverse().find((event): event is Extract<typeof event, { type: 'net-positioning-patch' }> => event.type === 'net-positioning-patch');
    expect(latest?.payload.venues).toEqual(['binance', 'hyperliquid']);
    expect(latest?.payload.feeds).toMatchObject({ binance: { state: 'live' }, hyperliquid: { state: 'live' } });
    expect(latest?.payload.unitVerification).toMatchObject({ binance: { status: 'verified', units: 'BTC' }, hyperliquid: { status: 'verified', units: 'BTC' } });
    expect(latest?.intervals.map(row => row.venue)).toEqual(['hyperliquid']);
    service.dispose();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceFootprintService, type FootprintTransport } from '../src/feed/footprint-service';
import {
  FootprintAccumulator,
  FOOTPRINT_MAX_BARS,
  parseBinanceAggTrade,
  parseBinanceBtcUsdtTickSize,
  type AggTradeObservation,
} from '../src/feed/footprint';
import type { Event, Series } from '../src/feed/protocol';

const base = 1_800_000_000_000;
const record = (id: number, timeMs = base + 1_000, patch: Record<string, unknown> = {}) => ({
  e: 'aggTrade', E: timeMs + 2, s: 'BTCUSDT', st: 1, a: id, f: id * 3, l: id * 3 + 2,
  T: timeMs, p: '83000.10', q: '0.004', nq: '0.001', m: false, ...patch,
});
const observation = (id: number, timeMs: number, price: number, side: AggTradeObservation['side'] = 'buy'): AggTradeObservation => ({
  venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
  executionId: `binance:perpetual:BTCUSDT:agg:${id}`, id, firstTradeId: id * 3, lastTradeId: id * 3 + 2,
  timeMs, eventTimeMs: timeMs + 2, price, quantity: 0.001, side,
});
const exchangeInfo = {
  symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', pricePrecision: 2,
    filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }],
};
function tradeOf(raw: unknown) {
  const result = parseBinanceAggTrade(raw);
  if (!('trade' in result)) throw new Error('Expected a valid aggregate observation');
  return result.trade;
}
function rejectionOf(raw: unknown) {
  const result = parseBinanceAggTrade(raw);
  if (!('rejected' in result)) throw new Error('Expected a rejected aggregate observation');
  return result.rejected;
}

describe('Binance USD-M aggregate trade normalization', () => {
  it('uses independent agg and individual-trade IDs, q, UTC trade time, and maker-side aggressor', () => {
    const parsed = parseBinanceAggTrade(record(5_933_014, base + 1_234, { f: 100, l: 105, p: '82777.90', q: '0.004', nq: '0.001', m: true }));
    expect(parsed).toMatchObject({ trade: {
      venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
      executionId: 'binance:perpetual:BTCUSDT:agg:5933014', id: 5_933_014, firstTradeId: 100, lastTradeId: 105,
      timeMs: base + 1_234, price: 82_777.9, quantity: 0.004, side: 'sell',
    } });
    expect(tradeOf(record(6, base, { m: false }))).toMatchObject({ side: 'buy', quantity: 0.004 });
  });

  it('rejects wrong contract, malformed maker flags, reversed trade ranges, and invalid values', () => {
    expect(rejectionOf(record(1, base, { st: 2 }))).toBe('contract');
    expect(rejectionOf(record(1, base, { m: 'true' }))).toBe('maker-side');
    expect(rejectionOf(record(1, base, { f: 9, l: 8 }))).toBe('trade-id');
    expect(rejectionOf(record(1, base, { q: '0' }))).toBe('quantity');
    expect(rejectionOf(record(1, base, { p: '0x1.2' }))).toBe('price');
    expect(rejectionOf(record(1, base, { q: '1e308' }))).toBe('quantity');
    expect(rejectionOf(record(1, base, { q: '9007199254740992' }))).toBe('quantity');
    expect(rejectionOf(record(1, 8_640_000_000_000_001))).toBe('time');
    expect(rejectionOf(record(1, 8_640_000_000_000_000, { E: 8_640_000_000_000_001 }))).toBe('time');
    expect(tradeOf(record(1, base, { p: '83000.15' }))).toBeTruthy();
    expect(parseBinanceBtcUsdtTickSize(exchangeInfo)).toBe(0.1);
    expect(parseBinanceBtcUsdtTickSize({ symbols: [...exchangeInfo.symbols, ...exchangeInfo.symbols] })).toBeNull();
    expect(parseBinanceBtcUsdtTickSize({ symbols: [{ ...exchangeInfo.symbols[0], filters: [{ filterType: 'PRICE_FILTER', tickSize: '0' }] }] })).toBeNull();
  });
});

describe('bounded footprint accumulator', () => {
  it('aggregates classified observations on an integer tick grid and revises bars', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1);
    expect(book.ingest(observation(1, base + 1_000, 83_000.1, 'sell'))).toBe('applied');
    expect(book.ingest(observation(2, base + 2_000, 83_000.2, 'buy'))).toBe('applied');
    const bar = book.snapshot()[0]!;
    expect(bar).toMatchObject({ revision: 2, coverage: 'partial', source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade', aggregateRecordCount: 2, open: 83_000.1, high: 83_000.2, low: 83_000.1, close: 83_000.2, delta: 0, minDelta: -0.001, maxDelta: 0 });
    expect(bar.cells).toHaveLength(2);
    expect(bar.cells[0]).toMatchObject({ bidVol: 0, askVol: 0.001 });
    expect(bar.cells[0]!.price).toBeCloseTo(83_000.2, 8);
    expect(bar.cells[1]).toMatchObject({ bidVol: 0.001, askVol: 0 });
    expect(bar.cells[1]!.price).toBeCloseTo(83_000.1, 8);
    expect('tradeCount' in bar).toBe(false);
    expect(book.ingest(observation(3, base + 3_000, 83_000.15))).toBe('invalid-grid');
    expect(book.latest?.revision).toBe(2);
  });

  it('marks explicit outages and late records on affected bars without inventing empty bars', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1);
    book.ingest(observation(1, base + 1_000, 83_000.1));
    book.markGap();
    expect(book.latest?.coverage).toBe('gapped');
    book.ingest(observation(2, base + 2_000, 83_000.2));
    expect(book.outages).toBe(1);
    book.ingest(observation(3, base + 120_000, 83_000.3));
    const bars = book.snapshot();
    expect(bars.map(item => item.time)).toHaveLength(2);
    expect(bars[1]).toMatchObject({ coverage: 'observed', gapBefore: false });
    expect(book.markCoverageGap(base + 120_500)).toBe(true);
    expect(book.latest).toMatchObject({ coverage: 'gapped', revision: 2 });
  });

  it('does not label a previously closed healthy bar gapped by an outage in a later empty interval', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1);
    book.ingest(observation(1, base + 1_000, 83_000.1));
    book.markGap(base + 60_500);
    expect(book.latest).toMatchObject({ time: base / 1000, coverage: 'partial' });
    book.ingest(observation(2, base + 61_000, 83_000.2));
    expect(book.snapshot()).toMatchObject([
      { time: base / 1000, coverage: 'partial', gapBefore: false },
      { time: base / 1000 + 60, coverage: 'partial', gapBefore: true },
    ]);
  });

  it('keeps advancing through more than 300 intervals while the global cell cap is full', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1, { maxCells: 1, maxCellsPerBar: 1 });
    for (let index = 0; index < FOOTPRINT_MAX_BARS + 75; index++) {
      const result = book.ingest(observation(index + 1, base + index * 60_000 + 1_000, 83_000.1 + (index % 4) / 10));
      expect(result).toBe('applied');
      expect(book.barCount).toBeLessThanOrEqual(FOOTPRINT_MAX_BARS);
      expect(book.cellCount).toBeLessThanOrEqual(1);
    }
    expect(book.snapshot()).toHaveLength(1);
    expect(book.snapshot()[0]!.aggregateRecordCount).toBe(1);
  });

  it('enforces hard retention ceilings when a caller asks for larger limits', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1, { maxBars: FOOTPRINT_MAX_BARS * 10 });
    for (let index = 0; index < FOOTPRINT_MAX_BARS + 20; index++) {
      expect(book.ingest(observation(index + 1, base + index * 60_000 + 1_000, 83_000.1))).toBe('applied');
    }
    expect(book.barCount).toBe(FOOTPRINT_MAX_BARS);
    expect(book.snapshot()[0]!.time).toBe(base / 1000 + 20 * 60);
    expect(book.cellCount).toBe(FOOTPRINT_MAX_BARS);
  });

  it('rejects a per-bar capacity row without changing OHLC or fabricating a row', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1, { maxCellsPerBar: 1, maxCells: 4 });
    book.ingest(observation(1, base + 1_000, 83_000.1));
    book.ingest(observation(2, base + 61_000, 83_000.1));
    expect(book.ingest(observation(3, base + 62_000, 83_000.2))).toBe('capacity');
    expect(book.snapshot()).toHaveLength(2);
    expect(book.snapshot()[1]).toMatchObject({ aggregateRecordCount: 1, coverage: 'capacity-limited', open: 83_000.1, close: 83_000.1, cells: [{ price: 83_000.1 }] });
    expect('tradeCount' in book.snapshot()[0]!).toBe(false);
  });

  it('rejects an aggregate that would exceed finite safe volume totals', () => {
    const book = new FootprintAccumulator('1m', 0.1, 1);
    expect(book.ingest({ ...observation(1, base + 1_000, 83_000.1), quantity: Number.MAX_SAFE_INTEGER })).toBe('applied');
    expect(book.ingest({ ...observation(2, base + 2_000, 83_000.1), quantity: 1 })).toBe('capacity');
    expect(book.snapshot()[0]).toMatchObject({ aggregateRecordCount: 1, coverage: 'capacity-limited', cells: [{ askVol: Number.MAX_SAFE_INTEGER }] });
    expect(book.cellCount).toBe(1);
  });
});

class MockSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  update(raw: unknown) { this.onmessage?.({ data: JSON.stringify(raw) }); }
}

let service: BinanceFootprintService;
afterEach(() => { service?.dispose(); vi.useRealTimers(); });

function setup(autoAcknowledge = true, measureAggregation = false) {
  vi.useFakeTimers();
  const sockets: MockSocket[] = [];
  const events: Event[] = [];
  let now = base;
  const transport: FootprintTransport = {
    metadata: vi.fn(async () => exchangeInfo),
    socket: () => { const socket = new MockSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
    now: () => now,
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  service = new BinanceFootprintService(event => {
    events.push(event);
    if (autoAcknowledge && (event.type === 'footprint-status' || event.type === 'footprint-snapshot' || event.type === 'footprint-patch')) {
      service.acknowledge(event.key, event.generation, event.batchId);
    }
  }, transport, { maxBars: 12 }, measureAggregation);
  return { sockets, events, transport, advance: async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms); } };
}

describe('shared Binance footprint worker service', () => {
  it('shares equivalent quote widths and validates configured rows against fetched PRICE_FILTER metadata', async () => {
    const test = setup();
    const one: Series = { venue: 'binance', market: 'perpetual', interval: '1m' };
    service.subscribe('first', one, 25);
    service.subscribe('same-grid', one, 25.000000000000004);
    await test.advance(0);
    const group = service.diagnostics().groups[0]!;
    expect(group).toMatchObject({ clients: 2, rowPrice: 25, rowTicks: 250, rowSize: 25 });

    service.subscribe('half-tick', one, 25.05);
    const invalid = test.events.filter((event): event is Extract<Event, { type: 'footprint-status' }> => event.type === 'footprint-status').at(-1);
    expect(invalid?.status).toMatchObject({ state: 'failed', tickSize: 0.1, rowSize: null });
    expect(invalid?.status.message).toContain('must be an exact multiple of the BTCUSDT tick size $0.1');
    service.subscribe('outside-cap', one, 10_001);
    const capped = test.events.at(-1);
    expect(capped?.type === 'footprint-status' ? capped.status.message : '').toContain('no more than $10,000 USDT');
    expect((service.diagnostics().groups as any[]).map(group => group.rowTicks)).toEqual([250, null]);
  });

  it('derives rowTicks from a non-default verified exchange tick size', async () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [], events: Event[] = [];
    let now = base;
    const transport: FootprintTransport = {
      metadata: vi.fn(async () => ({ ...exchangeInfo, symbols: [{ ...exchangeInfo.symbols[0], filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.50' }] }] })),
      socket: () => { const socket = new MockSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
      now: () => now, setInterval, clearInterval, setTimeout, clearTimeout,
    };
    service = new BinanceFootprintService(event => {
      events.push(event);
      if (event.type.startsWith('footprint-') && 'generation' in event && 'batchId' in event) service.acknowledge(event.key, event.generation, event.batchId);
    }, transport);
    service.subscribe('custom-grid', { venue: 'binance', market: 'perpetual', interval: '1m' }, 25);
    now++;
    await vi.advanceTimersByTimeAsync(0);
    expect(service.diagnostics().groups[0]).toMatchObject({ rowPrice: 25, rowTicks: 50, rowSize: 25 });
    expect(sockets).toHaveLength(1);
    expect(events.some(event => event.type === 'footprint-status' && event.status.state === 'failed')).toBe(false);
  });

  it('reports bounded aggregate flush timing only when diagnostics enable it', async () => {
    const test = setup(true, true);
    service.subscribe('timed', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
    await test.advance(0);
    test.sockets[0]!.open();
    for (let id = 1; id <= 3; id++) test.sockets[0]!.update(record(id, base + id * 1_000));
    await test.advance(100);
    const counters = service.diagnostics().counters;
    expect(counters).toMatchObject({ aggregationObservations: 3 });
    expect(counters.aggregationBatches).toBeGreaterThan(0);
    expect(Number.isFinite(counters.aggregationTotalMs)).toBe(true);
    expect(Number.isFinite(counters.aggregationMaxMs)).toBe(true);
    expect(counters.aggregationTotalMs).toBeGreaterThanOrEqual(counters.aggregationMaxMs);
  });

  it('coalesces a stalled client to one in-flight envelope and one bounded latest replacement', async () => {
    const test = setup(false);
    service.subscribe('slow', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
    const first = test.events[0];
    expect(first?.type).toBe('footprint-status');
    await test.advance(0);
    test.sockets[0]!.open();

    for (let id = 1; id <= 25; id++) test.sockets[0]!.update(record(id, base + id * 60_000 + 1_000));
    await test.advance(100);
    for (let id = 26; id <= 50; id++) test.sockets[0]!.update(record(id, base + id * 60_000 + 1_000));
    await test.advance(100);

    expect(test.events).toHaveLength(1);
    const stalled = service.diagnostics() as { groups: { bars: number; transportInFlight: boolean; transportInFlightBars: number; transportPendingBars: number; transportSnapshotPending: boolean }[] };
    expect(stalled.groups[0]).toMatchObject({ bars: 12, transportInFlight: true, transportInFlightBars: 0, transportPendingBars: 12, transportSnapshotPending: false });

    if (!first || first.type !== 'footprint-status') throw new Error('Expected initial status envelope');
    service.acknowledge(first.key, first.generation, first.batchId);
    const replacement = test.events[1];
    expect(replacement?.type).toBe('footprint-patch');
    if (!replacement || replacement.type !== 'footprint-patch') throw new Error('Expected coalesced footprint patch');
    expect(replacement.bars).toHaveLength(12);
    expect(replacement.bars[0]!.time).toBe(base / 1000 + 39 * 60);
    expect(replacement.bars.at(-1)?.aggregateRecordCount).toBe(1);
    expect(replacement.status.state).toBe('live');
    const staleGeneration = replacement.generation + 1;
    service.acknowledge(replacement.key, staleGeneration, replacement.batchId);
    expect((service.diagnostics() as { groups: { transportInFlight: boolean }[] }).groups[0]!.transportInFlight).toBe(true);
    service.acknowledge(replacement.key, replacement.generation, replacement.batchId);
    expect((service.diagnostics() as { groups: { transportInFlight: boolean; transportPendingBars: number }[] }).groups[0]).toMatchObject({ transportInFlight: false, transportPendingBars: 0 });
  });

  it('shares the socket per instrument while grouping intervals and row settings independently', async () => {
    const test = setup();
    const one: Series = { venue: 'binance', market: 'perpetual', interval: '1m' };
    const five: Series = { ...one, interval: '5m' };
    service.subscribe('a', one, 1);
    const initialStatus = test.events.find((event): event is Extract<Event, { type: 'footprint-status' }> => event.type === 'footprint-status');
    expect(initialStatus?.type === 'footprint-status' ? initialStatus.status.collectionStartedAt : null).toBe(base);
    service.subscribe('b', one, 1);
    service.subscribe('c', five, 2);
    await test.advance(0);
    expect(test.sockets).toHaveLength(1);
    test.sockets[0]!.open();
    test.sockets[0]!.update(record(1, base + 1_000, { p: '83000.10', m: true }));
    test.sockets[0]!.update(record(2, base + 1_000, { p: '83000.20', m: false }));
    await test.advance(100);
    const diagnostics = service.diagnostics() as { subscribers: number; groups: { clients: number; bars: number; buyVolume: number; sellVolume: number; maxBars: number }[]; counters: { accepted: number } };
    expect(diagnostics).toMatchObject({ subscribers: 3, counters: { accepted: 2 } });
    expect(diagnostics.groups).toHaveLength(2);
    expect(diagnostics.groups.find(group => group.clients === 2)).toMatchObject({ bars: 1, buyVolume: 0.004, sellVolume: 0.004, maxBars: 12 });
    expect(test.events.some(event => event.type === 'footprint-patch' && event.ids.includes('a') && event.ids.includes('b'))).toBe(true);
    service.unsubscribe('a');
    expect((service.diagnostics() as { subscribers: number }).subscribers).toBe(2);
    service.unsubscribe('b');
    service.unsubscribe('c');
    expect((service.diagnostics() as { sockets: number; subscribers: number })).toMatchObject({ sockets: 0, subscribers: 0 });
  });

  it('marks socket outages on retained bars and recovers same-bar coverage at the next boundary', async () => {
    const test = setup();
    service.subscribe('a', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
    await test.advance(0);
    test.sockets[0]!.open();
    test.sockets[0]!.update(record(1, base + 5_000));
    await test.advance(100);
    test.sockets[0]!.close();
    await test.advance(100);
    const outagePatch = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(outagePatch?.type === 'footprint-patch' ? outagePatch.bars[0] : undefined).toMatchObject({ coverage: 'gapped', revision: 2 });
    await test.advance(1_500);
    test.sockets[1]!.open();
    test.sockets[1]!.update(record(2, base + 10_000));
    await test.advance(100);
    test.sockets[1]!.update(record(3, base + 60_000 + 10_000));
    await test.advance(100);
    const laterPatch = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(laterPatch?.type === 'footprint-patch' ? laterPatch.bars.at(-1) : undefined).toMatchObject({ coverage: 'observed', gapBefore: false });
    const diagnostics = service.diagnostics() as { groups: { outages: number }[] };
    expect(diagnostics.groups[0]!.outages).toBe(1);
  });

  it('orders crossed IDs by trade time inside the reorder window and marks late post-flush records', async () => {
    const test = setup();
    service.subscribe('a', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
    await test.advance(0);
    test.sockets[0]!.open();
    // The higher aggregate ID arrives first but has the earlier trade time.
    test.sockets[0]!.update(record(2, base + 1_000, { p: '83000.20' }));
    test.sockets[0]!.update(record(1, base + 2_000, { p: '83000.10' }));
    await test.advance(100);
    const firstPatch = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(firstPatch?.type === 'footprint-patch' ? firstPatch.bars[0] : undefined).toMatchObject({ aggregateRecordCount: 2, coverage: 'partial' });
    expect(service.diagnostics()).toMatchObject({ lastTradeId: 2, lastTradeTime: base + 2_000, counters: { accepted: 2, late: 0, duplicates: 0 } });

    test.sockets[0]!.update(record(2, base + 3_000, { p: '83000.20' }));
    await test.advance(100);
    expect(service.diagnostics()).toMatchObject({ counters: { accepted: 2, duplicates: 1, late: 0 } });

    test.sockets[0]!.update(record(3, base + 500, { p: '83000.30' }));
    await test.advance(100);
    const latePatch = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(latePatch?.type === 'footprint-patch' ? latePatch.bars[0] : undefined).toMatchObject({ aggregateRecordCount: 2, coverage: 'gapped' });
    expect(service.diagnostics()).toMatchObject({ counters: { accepted: 2, late: 1 }, groups: [{ lateRecords: 1 }] });
  });

  it('marks retained bar coverage gapped when a live socket falls silent, then resumes', async () => {
    const test = setup();
    service.subscribe('a', { venue: 'binance', market: 'perpetual', interval: '1m' }, 1);
    await test.advance(0);
    test.sockets[0]!.open();
    test.sockets[0]!.update(record(1, base + 5_000));
    await test.advance(100);
    await test.advance(16_000);
    expect(test.events.some(event => event.type === 'footprint-status' && event.status.state === 'stale' && event.status.coverage === 'gapped')).toBe(true);
    const gapPatch = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(gapPatch?.type === 'footprint-patch' ? gapPatch.bars[0] : undefined).toMatchObject({ coverage: 'gapped', revision: 2 });

    test.sockets[0]!.update(record(2, base + 20_000));
    await test.advance(100);
    test.sockets[0]!.update(record(3, base + 60_000 + 20_000));
    await test.advance(100);
    const resumed = test.events.filter(event => event.type === 'footprint-patch').at(-1);
    expect(resumed?.type === 'footprint-patch' ? resumed.bars.at(-1) : undefined).toMatchObject({ coverage: 'observed', gapBefore: false });
    expect((service.diagnostics() as { groups: { outages: number }[] }).groups[0]!.outages).toBe(1);
  });
});

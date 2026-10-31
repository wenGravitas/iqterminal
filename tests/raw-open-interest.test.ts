import { describe, expect, it, vi } from 'vitest';
import {
  RAW_OPEN_INTEREST_MAX_AGE_MS,
  RAW_OPEN_INTEREST_VENUES,
  RawOpenInterestHistory,
  validateRawOpenInterestPayload,
  type RawOpenInterestObservation,
  type RawOpenInterestPayload,
  type RawOpenInterestVenue,
} from '../src/feed/raw-open-interest';
import { StagingRawOpenInterestService } from '../src/feed/staging-raw-open-interest';
import { projectOpenInterest } from '../src/indicators/open-interest-data';

const now = 1_800_000_000_000;
const from = now - 4 * 60 * 60_000;

function observation(venue: RawOpenInterestVenue, sourceTimeMs: number, value: number, patch: Partial<RawOpenInterestObservation> = {}): RawOpenInterestObservation {
  return { venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', sourceTimeMs,
    observedAtMs: sourceTimeMs + 500, epoch: 1, value, valueDecimal: String(value), units: 'BTC', source: `${venue}-recorder`,
    sourceTimeQuality: 'collector-sampled', quality: 'valid', gapBefore: false, ...patch };
}

function payload(venues: RawOpenInterestVenue[], observations: RawOpenInterestObservation[], patch: Partial<RawOpenInterestPayload> = {}): RawOpenInterestPayload {
  return { version: 1, market: 'perpetual', nativeSymbol: 'BTC', semantics: 'observed-open-interest-level', units: 'BTC',
    from, to: now, asOfMs: now, venues: [...venues],
    unitVerification: Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'recorder contract' }])),
    observations, truncated: false, invalidRows: 0, expectedIntervalMs: 30_000, retentionDays: 7, feeds: {}, history: 'Raw persisted recorder observations.', ...patch };
}

function projected(rows: RawOpenInterestObservation[], times: number[], options: {
  venues?: RawOpenInterestVenue[]; verification?: Partial<RawOpenInterestPayload['unitVerification']>;
  intervalMs?: number; at?: number; truncated?: boolean; invalidRows?: number;
} = {}) {
  const selected = options.venues ?? ['binance'];
  const body = payload(selected, rows, { unitVerification: { ...payload(selected, []).unitVerification, ...options.verification },
    truncated: options.truncated ?? false, invalidRows: options.invalidRows ?? 0, asOfMs: options.at ?? now, to: options.at ?? now });
  const history = new RawOpenInterestHistory(); history.merge(body);
  return projectOpenInterest(history, body, selected, times, options.intervalMs ?? 60_000, options.at ?? now);
}

describe('raw Open Interest payload and bounded history', () => {
  it('validates the requested BTC perpetual contract and rejects duplicate or wrong-market rows', () => {
    const valid = payload(['binance'], [observation('binance', now - 1_000, 1.25)]);
    expect(validateRawOpenInterestPayload(valid, ['binance'], from, now).observations).toHaveLength(1);
    expect(() => validateRawOpenInterestPayload({ ...valid, observations: [...valid.observations, ...valid.observations] }, ['binance'], from, now)).toThrow(/duplicate/);
    expect(() => validateRawOpenInterestPayload({ ...valid, market: 'spot' }, ['binance'], from, now)).toThrow(/version 1/);
    expect(() => validateRawOpenInterestPayload(valid, ['bybit'], from, now)).toThrow(/venue set/);
  });

  it('deduplicates repeated endpoints, accepts a newer correction and keeps epochs distinct', () => {
    const cache = new RawOpenInterestHistory();
    const first = observation('binance', now - 10_000, 10);
    cache.merge(payload(['binance'], [first]));
    cache.merge(payload(['binance'], [first]));
    expect(cache.diagnostics()).toMatchObject({ retained: 1, duplicateRows: 1, changed: 1 });

    const correction = observation('binance', first.sourceTimeMs, 11, { observedAtMs: first.observedAtMs + 1 });
    cache.merge(payload(['binance'], [correction]));
    cache.merge(payload(['binance'], [observation('binance', first.sourceTimeMs, 9, { epoch: 2 })]));
    expect(cache.observations(['binance'], from, now).map(row => [row.epoch, row.value])).toEqual([[1, 11], [2, 9]]);
    expect(cache.diagnostics()).toMatchObject({ retained: 2, changed: 3 });
  });
});

describe('raw Open Interest host-candle projection', () => {
  it('holds an observed level only while fresh and computes age at each candle as-of end', () => {
    const base = now - 180_000, row = observation('binance', base + 10_000, 12.5);
    const frame = projected([row], [base, base + 60_000], { at: now });
    const points = frame.lines.get('binance')!.points;
    expect(points[0]).toMatchObject({ value: 12.5, sourceTimeMs: row.sourceTimeMs, ageMs: 49_999, quality: 'complete' });
    expect(points[1]).toMatchObject({ value: null, sourceTimeMs: row.sourceTimeMs, quality: 'stale' });
    expect(points[1]!.ageMs).toBeGreaterThan(RAW_OPEN_INTEREST_MAX_AGE_MS);
  });

  it('does not use a future observation for an earlier candle or interpolate across it', () => {
    const base = now - 120_000, future = observation('binance', base + 60_000, 7);
    const frame = projected([future], [base, base + 60_000], { at: now });
    expect(frame.lines.get('binance')!.points.map(point => point.value)).toEqual([null, 7]);
  });

  it('sums only verified BTC venue levels and marks omitted, invalid or unverified coverage partial', () => {
    const base = now - 30_000;
    const frame = projected([observation('binance', base + 1_000, 2), observation('hyperliquid', base + 2_000, 3),
      observation('bybit', base + 3_000, 99)], [base], { at: now, venues: [...RAW_OPEN_INTEREST_VENUES],
      verification: { bybit: { status: 'unverified', units: 'BTC', evidence: 'unit evidence pending' } } });
    expect(frame.lines.get('total')!.points[0]).toMatchObject({ value: 5, quality: 'partial', unit: 'BTC' });
    expect(frame.lines.get('bybit')!.points[0]).toMatchObject({ value: null, quality: 'partial' });

    const badUnit = projected([observation('binance', base + 1_000, 99, { units: 'USD' })], [base], { at: now });
    expect(badUnit.lines.get('binance')!.points[0]).toMatchObject({ value: null, quality: 'partial', unit: 'USD' });
  });

  it('marks epochs, explicit gaps, long observation gaps and omitted raw rows as reset segments', () => {
    const base = now - 360_000;
    const rows = [observation('binance', base + 10_000, 1),
      observation('binance', base + 50_000, 2, { epoch: 2, gapBefore: true }),
      observation('binance', base + 140_000, 3)];
    const frame = projected(rows, [base, base + 30_000, base + 120_000], { at: now, intervalMs: 30_000, invalidRows: 2 });
    const points = frame.lines.get('binance')!.points;
    expect(points[0]).toMatchObject({ value: 1, reset: true, quality: 'partial' });
    expect(points[1]).toMatchObject({ value: 2, reset: true, epoch: 2 });
    expect(points[2]).toMatchObject({ value: 3, reset: true });
    expect(frame.lines.get('total')!.points.some(point => point.reset)).toBe(true);
  });

  it('detects a discontinuity inside a coarse host candle even when that sample is not itself summed', () => {
    const base = now - 300_000;
    const rows = [observation('binance', base + 10_000, 1), observation('binance', base + 100_000, 2),
      observation('binance', base + 280_000, 3)];
    const frame = projected(rows, [base], { at: now, intervalMs: 300_000 });
    expect(frame.lines.get('binance')!.points[0]).toMatchObject({ value: 3, reset: true, quality: 'partial' });
  });

  it('preserves explicit truncation quality and reset metadata', () => {
    const base = now - 30_000;
    const frame = projected([observation('binance', base + 1_000, 1)], [base], { at: now, truncated: true });
    expect(frame).toMatchObject({ quality: 'partial', truncated: true });
    expect(frame.lines.get('total')!.points[0]).toMatchObject({ value: 1, reset: true, quality: 'partial' });
  });
});

describe('shared worker raw Open Interest polling', () => {
  it('uses one union poll for simultaneous subscribers and sends each a scoped snapshot', async () => {
    const events: any[] = [], calls: URL[] = [];
    const request: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost'); calls.push(url);
      const requested = url.searchParams.get('venues')!.split(',') as RawOpenInterestVenue[];
      const lower = Number(url.searchParams.get('from')), upper = Number(url.searchParams.get('to'));
      return { ok: true, status: 200, json: async () => payload(requested, requested.map((venue, index) => observation(venue, upper - 1_000 + index, index + 1)), { from: lower, to: upper, asOfMs: upper }) } as Response;
    });
    const service = new StagingRawOpenInterestService(event => events.push(event), true, request, () => now);
    service.subscribe('one', { venues: ['binance'] });
    service.subscribe('two', { venues: ['binance', 'bybit'] });

    await vi.waitFor(() => expect(events.filter(event => event.type === 'raw-open-interest-snapshot')).toHaveLength(2));
    expect(request).toHaveBeenCalledTimes(1);
    expect(calls[0]!.searchParams.get('venues')).toBe('binance,bybit');
    expect(events.find(event => event.ids[0] === 'one').payload.venues).toEqual(['binance']);
    expect(events.find(event => event.ids[0] === 'two').payload.venues).toEqual(['binance', 'bybit']);
    expect(service.diagnostics()).toMatchObject({ requests: 1, subscribers: 2, history: { retained: 2 } });
    service.dispose();
  });

  it('aborts the in-flight request after the last consumer releases it and suppresses cancellation errors', async () => {
    const events: any[] = []; let signal: AbortSignal | undefined;
    const request: typeof fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined; signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const service = new StagingRawOpenInterestService(event => events.push(event), true, request, () => now);
    service.subscribe('one', { venues: ['binance'] });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    service.unsubscribe('one');
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await vi.waitFor(() => expect(service.diagnostics().subscribers).toBe(0));
    expect(events.filter(event => event.type === 'raw-open-interest-error')).toEqual([]);
    service.dispose();
  });

  it('keeps fixture selection explicit and never issues a raw-data request in fixture mode', () => {
    const events: any[] = [], request = vi.fn(async () => { throw new Error('must not request'); });
    const service = new StagingRawOpenInterestService(event => events.push(event), false, request as typeof fetch, () => now);
    service.subscribe('fixture-view', { venues: ['binance'] });
    expect(request).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'raw-open-interest-error', ids: ['fixture-view'] });
    service.dispose();
  });

  it('accepts an explicit validated payload only after fixture selection and keeps fixtures out of polling', () => {
    const events: any[] = [], request = vi.fn(async () => { throw new Error('must not request'); });
    const service = new StagingRawOpenInterestService(event => events.push(event), true, request as typeof fetch, () => now);
    const fixture = payload(['binance'], [observation('binance', now - 10_000, 42)]);
    expect(service.setFixture(fixture)).toBe(false);
    service.setFixtureSelected(true);
    service.subscribe('fixture-view', { venues: ['binance'] });
    expect(events.at(-1)).toMatchObject({ type: 'raw-open-interest-error', ids: ['fixture-view'] });
    expect(service.setFixture(fixture)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'raw-open-interest-snapshot', ids: ['fixture-view'], payload: { observations: [expect.objectContaining({ value: 42 })] } });
    expect(request).not.toHaveBeenCalled();
    expect(service.diagnostics()).toMatchObject({ fixtureSelected: true, requests: 0, history: { retained: 1 } });
    service.dispose();
  });
});

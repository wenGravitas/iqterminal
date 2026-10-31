import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryScheduler } from '../src/feed/history-scheduler';
import {
  comparisonIdentity, comparisonIdentityKey, comparisonMarkets, validateComparisonCandle,
  type ComparisonIdentity, type ComparisonRequest,
} from '../src/feed/comparison';
import { ComparisonService, fetchComparisonHistory, parseComparisonLive, type ComparisonTransport } from '../src/feed/comparison-service';
import type { Candle } from '../src/feed/protocol';
import { defaultMarketComparisonConfig, marketComparisonConfig, validMarketComparisonConfig } from '../src/market-comparison/model';
import { PANEL_BUDGET, restoreValue } from '../src/layout';

const now = Date.UTC(2026, 9, 29, 12, 0);

function candle(t: number, close = 100, revision = 1): Candle {
  return { t, o: close, h: close + 1, l: close - 1, c: close, v: 1, revision, closed: t + 59_999 < now };
}

function raw(identity: ComparisonIdentity, t: number, close = 100, revision = 1) {
  return { s: identity.symbol, i: identity.interval, t, T: t + 59_999, o: close, h: close + 1, l: close - 1, c: close, v: '1', n: revision };
}

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
  close() { this.readyState = 3; this.onclose?.({} as CloseEvent); }
}

function harness(options: { omitTime?: number; names?: Record<string, string[]>; history?: (identity: ComparisonIdentity, from: number, to: number, signal: AbortSignal) => Promise<Candle[]> } = {}) {
  const events: any[] = [], sockets: FakeSocket[] = [], historyCalls: { identity: ComparisonIdentity; from: number; to: number; signal: AbortSignal }[] = [];
  const transport: ComparisonTransport = {
    metadata: vi.fn(async (dex: string) => new Set(options.names?.[dex] ?? (dex ? ['XYZ100', 'SP500', 'GOLD', 'CL', 'SILVER'] : ['BTC']))),
    history: vi.fn(async (identity, from, to, signal) => {
      historyCalls.push({ identity, from, to, signal });
      if (options.history) return options.history(identity, from, to, signal);
      const step = identity.interval === '1m' ? 60_000 : identity.interval === '5m' ? 300_000 : 900_000;
      const result: Candle[] = [];
      for (let time = Math.ceil(from / step) * step; time <= Math.floor(now / step) * step && time < to; time += step) {
        if (time !== options.omitTime) result.push({ ...candle(time), closed: time + step <= now });
      }
      return result;
    }),
    socket: vi.fn(() => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; }),
    now: () => now,
    random: () => 0,
  };
  const scheduler = new HistoryScheduler(2, () => performance.now());
  const service = new ComparisonService(event => events.push(event), transport, scheduler);
  return { events, sockets, historyCalls, transport, scheduler, service };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(60);
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Hyperliquid Market Comparison contract', () => {
  it('keeps the bounded catalogue and exact perpetual identity; rejects mismatched candle rows', () => {
    expect(comparisonMarkets.map(market => market.id)).toEqual(['BTC', 'xyz:XYZ100', 'xyz:SP500', 'xyz:GOLD', 'xyz:CL', 'xyz:SILVER']);
    const identity = comparisonIdentity('xyz:GOLD', '5m');
    expect(identity).toEqual({ provider: 'hyperliquid', venue: 'hyperliquid', marketType: 'perpetual', symbol: 'xyz:GOLD', interval: '5m', priceBasis: 'candle-close' });
    expect(comparisonIdentityKey(identity)).toBe('hyperliquid:hyperliquid:perpetual:xyz:GOLD:5m:candle-close');
    expect(validateComparisonCandle(raw(identity, now - 300_000), identity, now, true)).toMatchObject({ t: now - 300_000, c: 100 });
    expect(validateComparisonCandle({ ...raw(identity, now - 300_000), s: 'GOLD' }, identity, now, true)).toBeNull();
    expect(validateComparisonCandle({ ...raw(identity, now - 300_000), i: '1m' }, identity, now, true)).toBeNull();
    expect(parseComparisonLive({ channel: 'candle', data: raw(comparisonIdentity('BTC', '5m'), now - 300_000) }, identity, now)).toEqual([]);
    expect(marketComparisonConfig({ instruments: [] }).instruments).toEqual(defaultMarketComparisonConfig().instruments);
    expect(validMarketComparisonConfig(defaultMarketComparisonConfig())).toBe(true);
  });

  it('requests the complete 4h then 24h one-minute window and preserves source gaps when widening', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const gap = now - 2 * 60 * 60_000;
    const h = harness({ omitTime: gap });
    const request: ComparisonRequest = { interval: '1m', window: '4h', symbols: ['BTC'] };
    h.service.subscribe('panel', request);
    await settle();
    expect(h.historyCalls).toHaveLength(1);
    expect(h.historyCalls[0]!.from).toBeLessThanOrEqual(now - 4 * 60 * 60_000);
    expect(h.events.filter(event => event.type === 'comparison-snapshot').at(-1)!.candles.some((bar: Candle) => bar.t === gap)).toBe(false);
    h.service.subscribe('panel', { ...request, window: '24h' });
    await settle();
    expect(h.historyCalls.at(-1)!.from).toBeLessThanOrEqual(now - 24 * 60 * 60_000);
    const snapshot = h.events.filter(event => event.type === 'comparison-snapshot').at(-1)!;
    expect(snapshot.candles.length).toBeGreaterThanOrEqual(1_440);
    expect(snapshot.candles.length).toBeLessThanOrEqual(1_500);
    expect(snapshot.candles.some((bar: Candle) => bar.t === gap)).toBe(false);
    expect(h.service.diagnostics().retainedBars).toBe(snapshot.candles.length);
    h.service.dispose();
  });

  it('shares metadata, history and one exact upstream subscription for two panel consumers, then applies live revisions', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const h = harness(), request: ComparisonRequest = { interval: '1m', window: '4h', symbols: ['BTC'] };
    h.service.subscribe('one', request); h.service.subscribe('two', request);
    await settle();
    expect(h.transport.metadata).toHaveBeenCalledTimes(1);
    expect(h.historyCalls).toHaveLength(1);
    expect(h.service.diagnostics()).toMatchObject({ subscriptions: 2, activeIdentities: 1 });
    const socket = h.sockets[0]!; socket.open(); await settle();
    expect(socket.sent.filter((message: any) => message.method === 'subscribe')).toEqual([{ method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '1m' } }]);
    const t = now - 60_000;
    socket.message({ channel: 'candle', data: raw(comparisonIdentity('BTC', '1m'), t, 101, 2) });
    await settle();
    const patch = h.events.filter(event => event.type === 'comparison-patch').at(-1)!;
    expect(patch.candles).toEqual([expect.objectContaining({ t, c: 101, revision: 2 })]);
    expect(patch.ids).toEqual(['one', 'two']);
    h.service.unsubscribe('one');
    expect(h.service.diagnostics().activeIdentities).toBe(1);
    h.service.unsubscribe('two');
    expect(socket.sent.filter((message: any) => message.method === 'unsubscribe')).toHaveLength(1);
    expect(h.service.diagnostics()).toMatchObject({ subscriptions: 0, activeIdentities: 0, socket: 'closed' });
    h.service.dispose();
  });

  it('does not let an older in-flight history row overwrite a newer forming live candle', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let resolveHistory!: (bars: Candle[]) => void;
    let holdFirst = true;
    const h = harness({ history: async () => holdFirst ? await new Promise<Candle[]>(resolve => { resolveHistory = resolve; }) : [candle(now - 120_000)] });
    h.service.subscribe('panel', { interval: '1m', window: '4h', symbols: ['BTC'] });
    await settle();
    expect(h.historyCalls).toHaveLength(1);
    const socket = h.sockets[0]!; socket.open(); await Promise.resolve();
    const t = now - 60_000;
    socket.message({ channel: 'candle', data: raw(comparisonIdentity('BTC', '1m'), t, 101, 7) });
    holdFirst = false;
    resolveHistory([candle(t - 60_000, 99, 0), candle(t, 100, 0)]);
    await settle();
    const snapshot = h.events.filter(event => event.type === 'comparison-snapshot').at(-1)!;
    expect(snapshot.candles.find((bar: Candle) => bar.t === t)).toMatchObject({ c: 101, revision: 7 });
    expect(h.historyCalls).toHaveLength(2);
    h.service.dispose();
  });

  it('ignores an obsolete interval response after the same panel advances its request identity', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let resolveOld!: (bars: Candle[]) => void, oldStarted = false;
    const h = harness({ history: async (identity) => {
      if (identity.interval === '1m') { oldStarted = true; return new Promise<Candle[]>(resolve => { resolveOld = resolve; }); }
      return [candle(now - 5 * 60_000)];
    } });
    h.service.subscribe('panel', { interval: '1m', window: '4h', symbols: ['BTC'] }); await settle();
    expect(oldStarted).toBe(true);
    h.service.subscribe('panel', { interval: '5m', window: '4h', symbols: ['BTC'] }); await settle();
    expect(h.events.filter(event => event.type === 'comparison-snapshot').every(event => event.identity.interval === '5m')).toBe(true);
    resolveOld([candle(now - 60_000)]); await settle();
    expect(h.events.filter(event => event.type === 'comparison-snapshot').every(event => event.identity.interval === '5m')).toBe(true);
    expect(h.service.diagnostics().activeIdentities).toBe(1);
    h.service.dispose();
  });

  it('uses exact metadata misses as unavailable and shares the cached miss without substituting another symbol', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const h = harness({ names: { xyz: ['xyz:XYZ100', 'xyz:SP500', 'xyz:GOLD', 'xyz:CL'] } });
    h.service.subscribe('first', { interval: '1m', window: '4h', symbols: ['xyz:SILVER'] }); await settle();
    h.service.subscribe('second', { interval: '1m', window: '4h', symbols: ['xyz:SILVER'] }); await settle();
    const statuses = h.events.filter(event => event.type === 'comparison-status');
    expect(h.transport.metadata).toHaveBeenCalledTimes(1);
    expect(h.historyCalls).toHaveLength(0);
    expect(h.sockets).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({ identity: comparisonIdentity('xyz:SILVER', '1m'), status: { state: 'unavailable' } });
    expect(h.service.diagnostics()).toMatchObject({ subscriptions: 2, activeIdentities: 1, retainedBars: 0 });
    h.service.dispose();
  });

  it('cancels queued history on last unsubscribe and ignores metadata that resolves after disposal of a panel', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let unblock!: () => void;
    const queue = new HistoryScheduler(1, () => performance.now()), blocker = new AbortController();
    const blocked = queue.read('blocker', 'cvd', blocker.signal, () => new Promise<void>(resolve => { unblock = resolve; }));
    await Promise.resolve();
    let resolveMetadata!: (value: Set<string>) => void;
    const h = harness({ names: { '': ['BTC'] }, history: async () => [] });
    const metadata = h.transport.metadata as ReturnType<typeof vi.fn>;
    metadata.mockImplementationOnce(() => new Promise<Set<string>>(resolve => { resolveMetadata = resolve; }));
    // Use the same saturated scheduler so cancellation must remove queued work before transport starts.
    const service = new ComparisonService(event => h.events.push(event), h.transport, queue);
    service.subscribe('cancelled', { interval: '1m', window: '4h', symbols: ['BTC'] });
    await Promise.resolve();
    resolveMetadata(new Set(['BTC'])); await settle();
    expect(queue.diagnostics().queued).toBe(1);
    service.unsubscribe('cancelled'); await settle();
    expect(h.historyCalls).toHaveLength(0);
    expect(queue.diagnostics().queued).toBe(0);
    unblock(); await blocked; service.dispose(); h.service.dispose();
  });

  it('keeps the five-thousand-bar and patch bounds and reconnects the same candle subscription', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const h = harness({ history: async identity => [candle(now - 60_000)] });
    h.service.subscribe('panel', { interval: '1m', window: '4h', symbols: ['BTC'] }); await settle();
    const first = h.sockets[0]!; first.open(); await settle(); first.close();
    await vi.advanceTimersByTimeAsync(1_500); await settle();
    expect(h.sockets).toHaveLength(2);
    const second = h.sockets[1]!; second.open(); await settle();
    expect(second.sent).toContainEqual({ method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '1m' } });
    const identity = comparisonIdentity('BTC', '1m');
    const rows = Array.from({ length: 5_100 }, (_, index) => raw(identity, now - (5_099 - index) * 60_000, 100 + index / 100));
    second.message({ channel: 'candle', data: rows }); await settle();
    expect(h.service.diagnostics().retainedBars).toBe(5_000);
    expect(h.service.diagnostics().pendingCandles).toBeLessThanOrEqual(512);
    const last = h.events.filter(event => event.type === 'comparison-snapshot' || event.type === 'comparison-patch').at(-1)!;
    expect(last.type).toBe('comparison-snapshot');
    expect(last.candles).toHaveLength(5_000);
    expect(last.candles[0]!.t).toBe(now - 4_999 * 60_000);
    h.service.dispose();
  });

  it('fetches native Hyperliquid candle history with an exact 5,000-row guard', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const identity = comparisonIdentity('xyz:XYZ100', '1m'), rows = [raw(identity, now - 60_000), raw(identity, now - 120_000)];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(rows)));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchComparisonHistory(identity, now - 300_000, now, new AbortController().signal);
    expect(result.map(bar => bar.t)).toEqual([now - 120_000, now - 60_000]);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ type: 'candleSnapshot', req: { coin: 'xyz:XYZ100', interval: '1m', startTime: now - 300_000, endTime: now } });
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify([raw(comparisonIdentity('BTC', '1m'), now - 60_000)])));
    await expect(fetchComparisonHistory(identity, now - 60_000, now, new AbortController().signal)).rejects.toThrow('mismatched xyz:XYZ100 1m candle');
  });
});

describe('Market Comparison persistence and engine budget', () => {
  it('persists v1 config in v6 layouts while keeping version 1 to 5 candles restorable', () => {
    const config = defaultMarketComparisonConfig();
    const comparison = { contentComponent: 'market-comparison', params: config };
    const chart = { contentComponent: 'candle', params: { venue: 'binance', market: 'perpetual', interval: '1m', type: 'candle' } };
    const legacyLayout = { grid: {}, panels: { 'chart-old': chart } } as any;
    for (const version of [1, 2, 3, 4, 5]) expect(restoreValue(JSON.stringify({ version, layout: legacyLayout }))).toEqual(legacyLayout);
    const layout = { grid: {}, panels: { 'market-comparison-one': comparison } } as any;
    expect(restoreValue(JSON.stringify({ version: 6, layout }))).toEqual(layout);
    expect(restoreValue(JSON.stringify({ version: 5, layout }))).toBeNull();
    const atBudget = { grid: {}, panels: Object.fromEntries([
      ...Array.from({ length: PANEL_BUDGET - 1 }, (_, index) => [`chart-${index}`, chart]),
      ['market-comparison-one', comparison],
    ]) } as any;
    const overBudget = { grid: {}, panels: { ...atBudget.panels, 'market-comparison-two': comparison } };
    expect(restoreValue(JSON.stringify({ version: 6, layout: atBudget }))).toEqual(atBudget);
    expect(restoreValue(JSON.stringify({ version: 6, layout: overBudget }))).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { TradeBubbleService, type TradeBubbleTransport } from '../src/feed/trade-bubbles-service';
import type { AggTradeObservation } from '../src/feed/footprint';
import type { TradeBubbleBatch } from '../src/trade-bubbles/model';
import type { Status } from '../src/feed/protocol';
import { TickerTape } from '../src/ticker/model';

const now = Date.UTC(2026, 9, 26, 12);
const series = (market: 'spot' | 'perpetual' = 'perpetual', interval: '1m' | '5m' = '1m') => ({ venue: 'binance' as const, market, interval });
function trade(id: number, market: 'spot' | 'perpetual' = 'perpetual'): AggTradeObservation {
  const timeMs = now + id;
  return {
    venue: 'binance', market, nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade', executionId: `binance:${market}:${id}`,
    id, firstTradeId: id * 2, lastTradeId: id * 2 + 1, timeMs, eventTimeMs: timeMs, price: 100_000, quantity: 2,
    quoteNotionalText: '200000', side: id % 2 ? 'buy' : 'sell',
  };
}
const live: Status = { state: 'live', message: 'connected', lastUpdate: now };
const stale: Status = { state: 'stale', message: 'disconnected; reconnecting', lastUpdate: now };

function harness() {
  let advance: (() => void) | undefined;
  const callbacks = new Map<string, (items: readonly AggTradeObservation[], status: Status, liveSince: number) => void>();
  const release = vi.fn();
  const feed = { subscribeExecutions: vi.fn((id: string, callback: typeof callbacks extends Map<string, infer T> ? T : never) => {
    callbacks.set(id, callback as any);
    return () => { release(id); callbacks.delete(id); };
  }), retry: vi.fn() };
  const events: TradeBubbleBatch[] = [];
  const transport: TradeBubbleTransport = {
    now: () => now,
    setInterval: callback => { advance = callback; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: () => { advance = undefined; },
  };
  const service = new TradeBubbleService({ perpetual: feed, spot: feed }, event => events.push(event), transport);
  const flush = () => advance?.();
  const ack = (event = events.at(-1)!) => service.ack(event.ids[0]!, event.generation, event.batchId);
  return { service, feed, callbacks, release, events, flush, ack };
}

describe('Trade Bubbles shared execution service', () => {
  it('shares one exchange execution consumer per market across chart timeframes and refreshes without a new source subscription', () => {
    const f = harness();
    f.service.subscribe('chart-a', { series: series('perpetual', '1m'), settings: {} }); f.ack();
    f.service.subscribe('chart-b', { series: series('perpetual', '5m'), settings: {} }); f.ack();
    expect(f.feed.subscribeExecutions).toHaveBeenCalledTimes(1);
    f.callbacks.get('trade-bubbles:binance:perpetual')!([trade(1)], live, now); f.flush();
    const first = f.events.filter(event => !event.snapshot);
    expect(first).toHaveLength(2);
    expect(first.map(event => event.records[0]?.id)).toEqual(['binance:perpetual:1', 'binance:perpetual:1']);
    first.forEach(event => f.service.ack(event.ids[0]!, event.generation, event.batchId));
    f.service.update('chart-a', { series: series('perpetual', '5m'), settings: {} }, 1);
    expect(f.feed.subscribeExecutions).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)).toMatchObject({ snapshot: true, records: [{ id: 'binance:perpetual:1' }] });
    f.service.dispose();
  });

  it('retains dedup state across reconnects and filter updates, reports gaps, and clears prior-source prints on source changes', () => {
    const f = harness();
    f.service.subscribe('chart', { series: series(), settings: {} }); f.ack();
    const callback = f.callbacks.get('trade-bubbles:binance:perpetual')!;
    callback([trade(7)], live, now); f.flush(); f.ack();
    callback([], stale, now + 1); f.flush(); f.ack();
    callback([trade(7)], live, now + 2); f.flush();
    const duplicate = f.events.at(-1)!;
    expect(duplicate.records).toEqual([]);
    expect(duplicate.status.gaps).toBe(1);
    expect(f.service.diagnostics().duplicateRecords).toBe(1);
    f.ack();
    f.service.update('chart', { series: series('spot'), settings: {} }, 2);
    expect(f.events.at(-1)).toMatchObject({ snapshot: true, records: [] });
    expect(f.feed.subscribeExecutions).toHaveBeenCalledTimes(2);
    expect(f.release).toHaveBeenCalledWith('trade-bubbles:binance:perpetual');
    expect(f.service.diagnostics().caches).toMatchObject({ 'binance:perpetual': 0, 'binance:spot': 0 });
    f.service.dispose();
  });

  it('keeps per-chart bounded retention and transport batches under dense execution bursts', () => {
    const f = harness();
    f.service.subscribe('chart', { series: series(), settings: {} }); f.ack();
    const burst = Array.from({ length: 3000 }, (_, index) => trade(index + 1));
    f.callbacks.get('trade-bubbles:binance:perpetual')!(burst, live, now); f.flush();
    const event = f.events.at(-1)!;
    expect(f.service.diagnostics().subscribersState[0]).toMatchObject({ retained: 2048, pending: 0, dropped: 2744 });
    expect(event.records).toHaveLength(256);
    expect(event.snapshot).toBe(false);
    f.ack();
    const secondBurst = Array.from({ length: 1000 }, (_, index) => trade(index + 4000));
    f.callbacks.get('trade-bubbles:binance:perpetual')!(secondBurst, live, now); f.flush();
    const bounded = f.events.at(-1)!;
    expect(bounded.snapshot).toBe(false);
    expect(bounded.records).toHaveLength(256);
    expect(bounded.status.dropped).toBe(3488);
    expect(f.service.diagnostics().caches['binance:perpetual']).toBeLessThanOrEqual(8192);
    f.service.dispose();
  });

  it('does not create a fallback source for unsupported charts and only accepts explicitly enabled fixtures', () => {
    const f = harness();
    f.service.subscribe('unsupported', { series: { venue: 'hyperliquid', market: 'perpetual', interval: '1m' }, settings: {} });
    expect(f.feed.subscribeExecutions).not.toHaveBeenCalled();
    expect(f.events.at(-1)?.status.availability).toBe('unavailable');
    f.ack();
    f.service.setFixture(true);
    f.service.ingestFixture('binance:perpetual', [trade(9)]);
    expect(f.service.diagnostics().subscribersState[0]?.retained).toBe(0);
    f.service.unsubscribe('unsupported');

    f.service.subscribe('fixture', { series: series(), settings: {} }); f.ack();
    f.service.ingestFixture('binance:perpetual', [trade(10)]);
    expect(f.service.diagnostics().subscribersState[0]?.retained).toBe(1);
    expect(f.events.at(-1)?.status.message).toContain('Explicit binance:perpetual fixture');
    f.service.dispose();
  });

  it('shares both selected venue consumers across charts and releases each source only after its final chart leaves', () => {
    const f = harness();
    f.service.subscribe('both-chart', { series: series(), settings: { sourceMode: 'both' } });
    const initialA = f.events.at(-1)!; f.ack(initialA);
    f.service.subscribe('spot-chart', { series: series('spot'), settings: {} });
    const initialB = f.events.at(-1)!; f.ack(initialB);
    expect(f.feed.subscribeExecutions).toHaveBeenCalledTimes(2);
    f.callbacks.get('trade-bubbles:binance:spot')!([trade(11, 'spot')], live, now);
    f.callbacks.get('trade-bubbles:binance:perpetual')!([trade(12)], live, now); f.flush();
    const updates = f.events.filter(event => !event.snapshot);
    expect(updates.map(event => event.records.map(record => record.id).sort()).sort()).toEqual([
      ['binance:perpetual:12', 'binance:spot:11'], ['binance:spot:11'],
    ].sort());
    updates.forEach(event => f.service.ack(event.ids[0]!, event.generation, event.batchId));
    f.service.unsubscribe('spot-chart');
    expect(f.release).toHaveBeenCalledTimes(0); // both-chart still needs Spot
    f.service.unsubscribe('both-chart');
    expect(f.release).toHaveBeenCalledTimes(2);
    f.service.dispose();
  });

  it('replays only records accepted by the new filter without resubscribing the exchange feed', () => {
    const f = harness();
    f.service.subscribe('chart', { series: series(), settings: {} }); f.ack();
    f.callbacks.get('trade-bubbles:binance:perpetual')!([trade(20)], live, now); f.flush(); f.ack();
    f.service.update('chart', { series: series('perpetual', '5m'), settings: { minimumNotionalUsdt: 250_000 } }, 1);
    expect(f.feed.subscribeExecutions).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)).toMatchObject({ snapshot: true, configRevision: 1, records: [] });
    f.service.dispose();
  });

  it('collects directly from the shared execution service while a ticker tape is paused', () => {
    const f = harness(), tickerTape = new TickerTape(); tickerTape.pause();
    f.service.subscribe('chart', { series: series(), settings: {} }); f.ack();
    f.callbacks.get('trade-bubbles:binance:perpetual')!([trade(31)], live, now); f.flush();
    expect(tickerTape.paused).toBe(true);
    expect(f.events.at(-1)?.records.map(record => record.id)).toEqual(['binance:perpetual:31']);
    f.service.dispose();
  });

  it('retries only active shared execution sources', () => {
    const f = harness();
    f.service.subscribe('chart', { series: series('spot'), settings: {} }); f.ack();
    f.service.retry();
    expect(f.feed.retry).toHaveBeenCalledTimes(1);
    f.service.dispose();
  });
});

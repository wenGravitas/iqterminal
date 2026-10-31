import { afterEach, expect, it, vi } from 'vitest';
import { FeedClient } from '../src/feed/client';
import { keyOf } from '../src/feed/protocol';
import { tickerConfig } from '../src/ticker/model';

class WorkerMock {
  static instance: WorkerMock;
  onmessage: ((event: { data: any }) => void) | null = null;
  messages: any[] = [];
  constructor() { WorkerMock.instance = this; }
  postMessage(command: unknown) { this.messages.push(command); }
  terminate() {}
  emit(data: unknown) { this.onmessage?.({ data }); }
}

afterEach(() => vi.unstubAllGlobals());

it('tracks only active candle subscription tokens and ignores late status after replacement or release', () => {
  vi.stubGlobal('Worker', WorkerMock);
  const feed = new FeedClient();
  const worker = WorkerMock.instance;
  const statusUpdates = vi.fn();
  const baselineCommands = worker.messages.length;
  const stopObserving = feed.subscribeFeedStatuses(statusUpdates);
  expect(worker.messages).toHaveLength(baselineCommands);

  const oldSeries = { venue: 'binance', market: 'spot', interval: '1m' } as const;
  const nextSeries = { venue: 'hyperliquid', market: 'perpetual', interval: '1m' } as const;
  const releaseOld = feed.subscribe('chart', oldSeries, vi.fn());
  const oldToken = worker.messages.at(-1).id;
  worker.emit({ type: 'status', key: keyOf(oldSeries), ids: [oldToken], status: { state: 'live', message: 'Native candle stream', lastUpdate: 1_000 } });
  expect(feed.feedStatusSnapshot()).toMatchObject([{ source: 'binance:spot', state: 'live', observed: true }]);

  const releaseNext = feed.subscribe('chart', nextSeries, vi.fn());
  const nextToken = worker.messages.at(-1).id;
  expect(feed.feedStatusSnapshot()).toMatchObject([{ source: 'hyperliquid:perpetual', state: 'starting', observed: false }]);
  releaseOld();
  worker.emit({ type: 'status', key: keyOf(oldSeries), ids: [oldToken], status: { state: 'failed', message: 'late old status', lastUpdate: 2_000 } });
  expect(feed.feedStatusSnapshot()).toMatchObject([{ source: 'hyperliquid:perpetual', state: 'starting' }]);

  worker.emit({ type: 'status', key: keyOf(oldSeries), ids: [nextToken], status: { state: 'failed', message: 'wrong key', lastUpdate: 3_000 } });
  expect(feed.feedStatusSnapshot()[0]?.state).toBe('starting');
  worker.emit({ type: 'status', key: keyOf(nextSeries), ids: [nextToken], status: { state: 'failed', message: 'native stream failed', lastUpdate: 4_000 } });
  expect(feed.feedStatusSnapshot()).toMatchObject([{ source: 'hyperliquid:perpetual', state: 'failed', message: 'native stream failed' }]);
  releaseNext();
  worker.emit({ type: 'status', key: keyOf(nextSeries), ids: [nextToken], status: { state: 'live', message: 'late release status', lastUpdate: 5_000 } });
  expect(feed.feedStatusSnapshot()).toEqual([]);
  expect(statusUpdates).toHaveBeenCalled();
  stopObserving(); feed.dispose();
});

it('ignores stale ticker configuration statuses and refreshes source metadata when markets change', () => {
  vi.stubGlobal('Worker', WorkerMock);
  const feed = new FeedClient();
  const worker = WorkerMock.instance;
  const release = feed.subscribeTicker('ticker-panel', tickerConfig({ markets: ['binance:perpetual'] }), vi.fn());
  const command = worker.messages.at(-1);
  const batch = (configRevision: number, state: string, message: string, lastUpdate: number) => ({
    type: 'ticker-batch', ids: [command.id], configRevision, generation: configRevision + 1, batchId: lastUpdate,
    records: [], status: { state, message, lastUpdate }, dropped: 0,
  });
  worker.emit(batch(0, 'failed', 'old market failed', 1_000));
  expect(feed.feedStatusSnapshot()).toMatchObject([{ state: 'failed', source: 'Binance USD-M Perpetual' }]);

  feed.updateTicker('ticker-panel', tickerConfig({ markets: ['bybit:perpetual'] }));
  const pending = feed.feedStatusSnapshot()[0]!;
  expect(pending).toMatchObject({ state: 'starting', source: 'Bybit Perpetual', observed: false });
  worker.emit(batch(0, 'failed', 'stale previous selection', 2_000));
  expect(feed.feedStatusSnapshot()[0]).toMatchObject({ state: 'starting', source: 'Bybit Perpetual' });
  worker.emit(batch(1, 'live', 'Direct Bybit session prints', 3_000));
  expect(feed.feedStatusSnapshot()[0]).toMatchObject({ state: 'live', source: 'Bybit Perpetual', message: 'Direct Bybit session prints' });
  release();
  expect(feed.feedStatusSnapshot()).toEqual([]);
  feed.dispose();
});

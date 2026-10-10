import { afterEach, expect, it, vi } from 'vitest';
import { FeedClient } from '../src/feed/client';
import { footprintKeyOf, type Command, type Event } from '../src/feed/protocol';

class WorkerMock {
  static instance: WorkerMock;
  onmessage: ((event: MessageEvent<Event>) => void) | null = null;
  messages: Command[] = [];
  terminated = false;
  constructor() { WorkerMock.instance = this; }
  postMessage(command: Command) { this.messages.push(command); }
  terminate() { this.terminated = true; }
  reply(event: Event) { this.onmessage?.({ data: event } as MessageEvent<Event>); }
}

const series = { venue: 'binance', market: 'perpetual', interval: '1m' } as const;
const clients: FeedClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubGlobal('Worker', WorkerMock);
  const client = new FeedClient(); clients.push(client);
  return { client, worker: WorkerMock.instance };
}
function token(worker: WorkerMock) {
  const request = worker.messages.slice().reverse().find(command => command.type === 'footprint-subscribe');
  if (!request || request.type !== 'footprint-subscribe') throw new Error('Expected footprint subscription');
  return request.id;
}
function batch(ids: string[], batchId: number): Event {
  return { type: 'footprint-patch', key: footprintKeyOf(series, 10), ids,
    bars: [], retentionStart: null, generation: 7, batchId,
    status: { state: 'live', message: 'Collecting', lastUpdate: 1, tickSize: 0.1, rowSize: 1,
      collectionStartedAt: 1, firstTradeAt: null, lastTradeAt: null, eventTime: null,
      outages: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0,
      lateRecords: 0, retentionStart: null, coverage: 'waiting' } };
}

it('rejects obsolete subscriptions and acknowledges batches even after the consumer disappears', () => {
  const { client, worker } = setup();
  const first = vi.fn(), current = vi.fn();
  const closeOld = client.subscribeFootprint('chart', series, 10, first);
  const oldToken = token(worker);
  const closeCurrent = client.subscribeFootprint('chart', series, 10, current);
  const currentToken = token(worker);
  closeOld();
  worker.reply(batch([oldToken], 1));
  expect(first).not.toHaveBeenCalled(); expect(current).not.toHaveBeenCalled();
  expect(worker.messages.at(-1)).toMatchObject({ type: 'footprint-ack', generation: 7, batchId: 1 });
  worker.reply(batch([currentToken], 2));
  expect(current).toHaveBeenCalledOnce();
  closeCurrent();
  worker.reply(batch([currentToken], 3));
  expect(current).toHaveBeenCalledOnce();
  expect(worker.messages.at(-1)).toMatchObject({ type: 'footprint-ack', generation: 7, batchId: 3 });
  client.dispose();
  expect(worker.terminated).toBe(true);
  expect(worker.onmessage).toBeNull();
});

it('acknowledges a shared batch after callback failure and continues delivering to other consumers', () => {
  const { client, worker } = setup();
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  client.subscribeFootprint('bad', series, 10, () => { throw new Error('Subscriber failed'); });
  const badToken = token(worker);
  const good = vi.fn();
  client.subscribeFootprint('good', series, 10, good);
  worker.reply(batch([badToken, token(worker)], 9));
  expect(errorLog).toHaveBeenCalledOnce(); expect(good).toHaveBeenCalledOnce();
  expect(worker.messages.at(-1)).toMatchObject({ type: 'footprint-ack', generation: 7, batchId: 9 });
});

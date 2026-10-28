import type { NormalizedExecution, AggTradeObservation } from './footprint';
import type { Market, Status } from './protocol';
import type {
  TradeBubbleBatch, TradeBubbleRecord, TradeBubbleSettings, TradeBubbleSource,
  TradeBubbleStatus,
} from '../trade-bubbles/model';
import {
  makeTradeBubbleRecord, resolveTradeBubbleSources, tradeBubbleSettings,
  TRADE_BUBBLE_BATCH_LIMIT, TRADE_BUBBLE_MAX_RECORDS,
} from '../trade-bubbles/model';

type ExecutionConsumer = (trades: readonly AggTradeObservation[], status: Status, liveSince: number) => void;
type ExecutionFeed = { subscribeExecutions(id: string, consumer: ExecutionConsumer): () => void; retry?(): void };
export type TradeBubbleFeeds = Partial<Record<Market, ExecutionFeed>>;
export interface TradeBubbleRequest { series: import('./protocol').Series; settings: unknown }
export interface TradeBubbleTransport {
  now(): number;
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

const browserTransport: TradeBubbleTransport = {
  now: Date.now,
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: timer => globalThis.clearInterval(timer),
};
const SHARED_CACHE_LIMIT = 8192;
const PRIORITY: Record<Status['state'], number> = { failed: 5, stale: 4, reconnecting: 3, loading: 2, live: 1 };

interface Subscriber {
  id: string;
  request: TradeBubbleRequest;
  settings: TradeBubbleSettings;
  sources: TradeBubbleSource[];
  availability: TradeBubbleStatus['availability'];
  availabilityMessage: string;
  configRevision: number;
  generation: number;
  retained: TradeBubbleRecord[];
  pending: TradeBubbleRecord[];
  statuses: Map<TradeBubbleSource, Status>;
  gapCount: number;
  dropped: number;
  snapshotPending: boolean;
  dirty: boolean;
  inFlight?: number;
}

/** One worker-side fanout owns at most one normalized-execution consumer per Binance market. */
export class TradeBubbleService {
  private subscribers = new Map<string, Subscriber>();
  private releases = new Map<TradeBubbleSource, () => void>();
  private cache = new Map<TradeBubbleSource, NormalizedExecution[]>([
    ['binance:spot', []], ['binance:perpetual', []],
  ]);
  private recentIds = new Map<TradeBubbleSource, Set<string>>([
    ['binance:spot', new Set()], ['binance:perpetual', new Set()],
  ]);
  private lastState = new Map<TradeBubbleSource, Status['state']>();
  private nextGeneration = 0;
  private nextBatchId = 0;
  private timer?: ReturnType<typeof setInterval>;
  private fixture = false;
  private publishedRecords = 0;
  private duplicateRecords = 0;

  constructor(
    private readonly feeds: TradeBubbleFeeds,
    private readonly emit: (event: TradeBubbleBatch) => void,
    private readonly transport: TradeBubbleTransport = browserTransport,
  ) {}

  subscribe(id: string, request: TradeBubbleRequest, configRevision = 0) {
    if (!id) return;
    const previous = this.subscribers.get(id);
    this.subscribers.delete(id);
    const settings = tradeBubbleSettings(request.settings);
    const resolution = resolveTradeBubbleSources(settings, request.series);
    const statuses = new Map<TradeBubbleSource, Status>();
    for (const source of resolution.compatible) {
      const status = previous?.statuses.get(source);
      if (status) statuses.set(source, status);
    }
    const subscriber: Subscriber = {
      id, request: { series: { ...request.series }, settings }, settings,
      sources: resolution.compatible, availability: resolution.state, availabilityMessage: resolution.message,
      configRevision, generation: ++this.nextGeneration, retained: [], pending: [], statuses,
      gapCount: previous?.gapCount ?? 0, dropped: previous?.dropped ?? 0, snapshotPending: true, dirty: true,
    };
    this.subscribers.set(id, subscriber);
    this.rebuildFromCache(subscriber);
    this.reconcileFeeds();
    if (!this.timer) this.timer = this.transport.setInterval(() => this.flush(), 100);
    this.flush();
  }

  update(id: string, request: TradeBubbleRequest, configRevision: number) {
    if (!this.subscribers.has(id)) return;
    this.subscribe(id, request, configRevision);
  }

  unsubscribe(id: string) {
    this.subscribers.delete(id);
    this.reconcileFeeds();
    if (!this.subscribers.size && this.timer) {
      this.transport.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  ack(id: string, generation: number, batchId: number) {
    const subscriber = this.subscribers.get(id);
    if (subscriber?.generation !== generation || subscriber.inFlight !== batchId) return;
    subscriber.inFlight = undefined;
    this.flushSubscriber(subscriber);
  }

  retry() {
    for (const source of this.releases.keys()) this.feeds[this.sourceMarket(source)]?.retry?.();
  }

  setFixture(enabled: boolean) {
    this.fixture = enabled;
    this.reconcileFeeds();
    for (const subscriber of this.subscribers.values()) {
      if (enabled) {
        subscriber.availabilityMessage = 'Fixture mode is explicit; waiting for a Trade Bubbles fixture.';
        for (const source of subscriber.sources) subscriber.statuses.set(source, { state: 'loading', message: subscriber.availabilityMessage, lastUpdate: 0 });
      }
      subscriber.dirty = true;
    }
    this.flush();
  }

  /** Explicit diagnostic fixture injection. Never called as a transport fallback. */
  ingestFixture(source: TradeBubbleSource, executions: readonly NormalizedExecution[], now = this.transport.now()) {
    if (!this.fixture || ![...this.subscribers.values()].some(subscriber => subscriber.sources.includes(source))) return;
    this.ingest(source, executions, now);
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.sources.includes(source)) continue;
      subscriber.statuses.set(source, { state: 'live', message: `Explicit ${source} fixture`, lastUpdate: now });
      subscriber.dirty = true;
    }
    this.flush();
  }

  private sourceMarket(source: TradeBubbleSource): Market { return source.endsWith(':spot') ? 'spot' : 'perpetual'; }

  private ensureFeed(source: TradeBubbleSource) {
    if (this.fixture || this.releases.has(source)) return;
    const market = this.sourceMarket(source), feed = this.feeds[market];
    if (!feed) {
      for (const subscriber of this.subscribers.values()) if (subscriber.sources.includes(source)) {
        subscriber.statuses.set(source, { state: 'failed', message: `Binance ${market} execution feed is unavailable`, lastUpdate: 0 });
        subscriber.dirty = true;
      }
      return;
    }
    this.releases.set(source, feed.subscribeExecutions(`trade-bubbles:${source}`, (trades, status) => {
      this.updateStatus(source, status);
      if (trades.length) this.ingest(source, trades, this.transport.now());
      for (const subscriber of this.subscribers.values()) {
        if (subscriber.sources.includes(source)) subscriber.dirty = true;
      }
    }));
  }

  private updateStatus(source: TradeBubbleSource, status: Status) {
    const previous = this.lastState.get(source);
    if (previous === 'live' && status.state !== 'live') {
      for (const subscriber of this.subscribers.values()) if (subscriber.sources.includes(source)) subscriber.gapCount++;
    }
    this.lastState.set(source, status.state);
    for (const subscriber of this.subscribers.values()) if (subscriber.sources.includes(source)) subscriber.statuses.set(source, status);
  }

  private ingest(source: TradeBubbleSource, executions: readonly NormalizedExecution[], now: number) {
    const seen = this.recentIds.get(source)!;
    const cache = this.cache.get(source)!;
    const fresh: NormalizedExecution[] = [];
    for (const execution of executions) {
      if (!execution || typeof execution.executionId !== 'string' || seen.has(execution.executionId)) { this.duplicateRecords++; continue; }
      seen.add(execution.executionId);
      if (seen.size > SHARED_CACHE_LIMIT) seen.delete(seen.values().next().value!);
      fresh.push(execution);
    }
    if (!fresh.length) return;
    cache.push(...fresh);
    if (cache.length > SHARED_CACHE_LIMIT) cache.splice(0, cache.length - SHARED_CACHE_LIMIT);
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.sources.includes(source)) continue;
      for (const execution of fresh) this.append(subscriber, execution, now);
    }
  }

  private append(subscriber: Subscriber, execution: NormalizedExecution, receivedAt: number) {
    const record = makeTradeBubbleRecord(execution, receivedAt, subscriber.settings);
    if (!record) return;
    subscriber.retained.push(record);
    if (subscriber.retained.length > TRADE_BUBBLE_MAX_RECORDS) subscriber.retained.shift();
    if (subscriber.pending.length >= TRADE_BUBBLE_BATCH_LIMIT) { subscriber.pending.shift(); subscriber.dropped++; }
    subscriber.pending.push(record);
    subscriber.dirty = true;
  }

  private rebuildFromCache(subscriber: Subscriber) {
    subscriber.retained = [];
    subscriber.pending = [];
    for (const source of subscriber.sources) for (const execution of this.cache.get(source)!) {
      this.append(subscriber, execution, execution.receivedAtMs ?? execution.timeMs);
    }
    subscriber.pending = [];
    subscriber.snapshotPending = true;
  }

  private reconcileFeeds() {
    const wanted = new Set<TradeBubbleSource>();
    if (!this.fixture) for (const subscriber of this.subscribers.values()) for (const source of subscriber.sources) wanted.add(source);
    for (const [source, release] of this.releases) if (!wanted.has(source)) {
      this.releases.delete(source); release(); this.lastState.delete(source); this.cache.get(source)?.splice(0); this.recentIds.get(source)?.clear();
    }
    for (const source of wanted) this.ensureFeed(source);
  }

  private status(subscriber: Subscriber): TradeBubbleStatus {
    if (subscriber.availability !== 'compatible') return {
      state: 'failed', availability: subscriber.availability, message: subscriber.availabilityMessage,
      lastUpdate: 0, gaps: subscriber.gapCount, dropped: subscriber.dropped,
    };
    if (this.fixture && !subscriber.sources.some(source => subscriber.statuses.get(source)?.state === 'live')) return {
      state: 'loading', availability: 'compatible', message: 'Fixture mode is explicit; waiting for a Trade Bubbles fixture.',
      lastUpdate: 0, gaps: subscriber.gapCount, dropped: subscriber.dropped,
    };
    const sources = subscriber.sources.map(source => [source, subscriber.statuses.get(source)] as const);
    if (!sources.length) return { state: 'failed', availability: 'unavailable', message: 'No compatible execution source selected.', lastUpdate: 0, gaps: subscriber.gapCount, dropped: subscriber.dropped };
    const ordered = [...sources].sort((a, b) => PRIORITY[(b[1]?.state ?? 'loading')] - PRIORITY[(a[1]?.state ?? 'loading')]);
    const state = ordered[0]?.[1]?.state ?? 'loading';
    const live = sources.every(([, value]) => value?.state === 'live');
    const names = subscriber.sources.map(source => source === 'binance:spot' ? 'Spot' : 'USD-M Perp');
    const detail = this.fixture ? sources.map(([source, value]) => value?.message ?? `${source} fixture waiting`).join(' · ')
      : live ? `Collecting Binance ${names.join(' + ')} aggregate executions · no backfill`
      : ordered.map(([source, value]) => `${source.endsWith(':spot') ? 'Spot' : 'USD-M Perp'}: ${value?.message ?? 'connecting'}`).join(' · ');
    return { state: live ? 'live' : state, availability: 'compatible', message: `${detail}${subscriber.gapCount ? ` · ${subscriber.gapCount} connection gap(s)` : ''}${subscriber.dropped ? ` · ${subscriber.dropped} batch records dropped` : ''}`,
      lastUpdate: Math.max(0, ...sources.map(([, value]) => value?.lastUpdate ?? 0)), gaps: subscriber.gapCount, dropped: subscriber.dropped };
  }

  private flushSubscriber(subscriber: Subscriber) {
    if (!subscriber.dirty || subscriber.inFlight !== undefined) return;
    const snapshot = subscriber.snapshotPending;
    const records = snapshot ? [...subscriber.retained] : subscriber.pending.splice(0);
    subscriber.snapshotPending = false;
    subscriber.dirty = false;
    subscriber.inFlight = ++this.nextBatchId;
    this.publishedRecords += records.length;
    this.emit({ type: 'trade-bubbles-batch', ids: [subscriber.id], configRevision: subscriber.configRevision,
      generation: subscriber.generation, batchId: subscriber.inFlight, snapshot, records, status: this.status(subscriber) });
  }

  flush() { for (const subscriber of this.subscribers.values()) this.flushSubscriber(subscriber); }

  diagnostics() {
    return { subscribers: this.subscribers.size, feeds: [...this.releases.keys()], fixture: this.fixture,
      caches: Object.fromEntries([...this.cache].map(([source, items]) => [source, items.length])),
      subscribersState: [...this.subscribers.values()].map(subscriber => ({ id: subscriber.id, sources: [...subscriber.sources], retained: subscriber.retained.length,
        pending: subscriber.pending.length, dropped: subscriber.dropped, inFlight: subscriber.inFlight !== undefined, status: this.status(subscriber) })),
      publishedRecords: this.publishedRecords, duplicateRecords: this.duplicateRecords };
  }

  dispose() {
    for (const id of [...this.subscribers.keys()]) this.unsubscribe(id);
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }
}

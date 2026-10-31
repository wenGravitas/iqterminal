import type { Candle } from './protocol';
import { HistoryScheduler, historyScheduler } from './history-scheduler';
import {
  comparisonIdentity,
  comparisonIdentityKey,
  comparisonMarket,
  comparisonMarkets,
  comparisonStepMs,
  comparisonWindowMs,
  validComparisonInterval,
  validComparisonRequest,
  validateComparisonCandle,
  type ComparisonConnectionState,
  type ComparisonEvent,
  type ComparisonFeedDiagnostics,
  type ComparisonIdentity,
  type ComparisonRequest,
  type ComparisonStatus,
  type ComparisonWindow,
} from './comparison';

const INFO_URL = 'https://api.hyperliquid.xyz/info';
const SOCKET_URL = 'wss://api.hyperliquid.xyz/ws';
const MAX_RETAINED_BARS = 5000;
const MAX_PATCH_QUEUE = 512;
const MAX_CACHE_ENTRIES = 18;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_HISTORY_CONCURRENCY = 2;

export class ComparisonHttpError extends Error {
  constructor(message: string, readonly hard = false, readonly retryAfter = 0) { super(message); }
}

export interface ComparisonTransport {
  metadata(dex: string, signal: AbortSignal): Promise<Set<string>>;
  history(identity: ComparisonIdentity, startTime: number, endTime: number, signal: AbortSignal): Promise<Candle[]>;
  socket(url: string): WebSocket;
  now(): number;
  random(): number;
}

export async function fetchComparisonMetadata(dex: string, signal: AbortSignal): Promise<Set<string>> {
  const response = await fetch(INFO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta', ...(dex ? { dex } : {}) }), signal,
  });
  if (!response.ok) throw new ComparisonHttpError(`Metadata HTTP ${response.status}`, response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status), Number(response.headers.get('Retry-After') ?? 0) * 1000);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { universe?: unknown }).universe)) {
    throw new ComparisonHttpError('Invalid Hyperliquid perpetual metadata response', true);
  }
  const names = new Set<string>();
  for (const row of (payload as { universe: unknown[] }).universe) {
    if (row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string') names.add((row as { name: string }).name);
  }
  return names;
}

export async function fetchComparisonHistory(identity: ComparisonIdentity, startTime: number, endTime: number, signal: AbortSignal): Promise<Candle[]> {
  const response = await fetch(INFO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin: identity.symbol, interval: identity.interval, startTime, endTime } }), signal,
  });
  if (!response.ok) throw new ComparisonHttpError(`History HTTP ${response.status}`, response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status), Number(response.headers.get('Retry-After') ?? 0) * 1000);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || payload.length > MAX_RETAINED_BARS) throw new ComparisonHttpError('Hyperliquid history exceeded the 5,000-candle response limit or was not an array', true);
  const now = Date.now();
  const candles: Candle[] = [];
  for (const raw of payload) {
    const candle = validateComparisonCandle(raw, identity, now, false);
    if (!candle) throw new ComparisonHttpError(`History returned a mismatched ${identity.symbol} ${identity.interval} candle`, true);
    candles.push(candle);
  }
  if (!candles.length) throw new ComparisonHttpError(`No valid ${identity.symbol} ${identity.interval} history in the requested window`, true);
  const deduped = new Map<number, Candle>();
  for (const candle of candles) deduped.set(candle.t, candle);
  return [...deduped.values()].sort((a, b) => a.t - b.t);
}

export function parseComparisonLive(raw: unknown, identity: ComparisonIdentity, now = Date.now()): Candle[] {
  if (!raw || typeof raw !== 'object') return [];
  const message = raw as { channel?: unknown; data?: unknown };
  if (message.channel !== 'candle') return [];
  const rows = Array.isArray(message.data) ? message.data : [message.data];
  return rows.map(row => validateComparisonCandle(row, identity, now, true)).filter((candle): candle is Candle => candle !== null);
}

const liveTransport: ComparisonTransport = {
  metadata: fetchComparisonMetadata,
  history: fetchComparisonHistory,
  socket: url => new WebSocket(url),
  now: Date.now,
  random: Math.random,
};

const fixturePrice = (symbol: string) => symbol === 'BTC' ? 100_000 : symbol.endsWith('XYZ100') ? 5_000
  : symbol.endsWith('SP500') ? 5_500 : symbol.endsWith('GOLD') ? 2_000 : symbol.endsWith('CL') ? 100 : 50;

/** Deterministic in-worker source selected only by the explicit development fixture command. */
export function createComparisonFixtureTransport(now: () => number = Date.now): ComparisonTransport {
  return {
    metadata: async dex => new Set(comparisonMarkets.filter(market => market.dex === dex).map(market => market.symbol)),
    history: async (identity, startTime, endTime, signal) => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const step = comparisonStepMs[identity.interval], current = now();
      const lastClosed = Math.floor(current / step) * step - step;
      const first = Math.ceil(startTime / step) * step;
      const end = Math.min(lastClosed, Math.floor(endTime / step) * step - step);
      const marketIndex = comparisonMarkets.findIndex(market => market.id === identity.symbol);
      const base = fixturePrice(identity.symbol);
      const candles: Candle[] = [];
      for (let t = first, index = 0; t <= end && candles.length < MAX_RETAINED_BARS; t += step, index++) {
        const close = base * (1 + marketIndex * 0.0002 + index * 0.00001 + Math.sin(index / 23 + marketIndex) * 0.002);
        candles.push({ t, o: close, h: close * 1.0005, l: close * 0.9995, c: close, v: 1 + (index % 10), revision: 0, closed: true });
      }
      return candles;
    },
    socket: () => new ComparisonFixtureSocket(now) as unknown as WebSocket,
    now,
    random: () => 0.5,
  };
}

class ComparisonFixtureSocket {
  readyState = 0;
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  url = 'fixture://hyperliquid/ws';
  binaryType: BinaryType = 'blob';
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  private subscriptions = new Set<string>();

  constructor(private now: () => number) {
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.call(this as unknown as WebSocket, new Event('open'));
    });
  }

  send(data: string) {
    if (this.readyState !== 1) throw new DOMException('Socket is not open', 'InvalidStateError');
    let message: { method?: string; subscription?: { type?: string; coin?: string; interval?: string } };
    try { message = JSON.parse(data) as typeof message; } catch { return; }
    const subscription = message.subscription;
    if (subscription?.type !== 'candle' || !subscription.coin || !subscription.interval) return;
    const key = `${subscription.coin}|${subscription.interval}`;
    if (message.method === 'unsubscribe') { this.subscriptions.delete(key); return; }
    if (message.method !== 'subscribe') return;
    this.subscriptions.add(key);
    const interval = subscription.interval;
    if (!validComparisonInterval(interval)) return;
    const step = comparisonStepMs[interval], t = Math.floor(this.now() / step) * step;
    const base = fixturePrice(subscription.coin), close = base * 1.001;
    queueMicrotask(() => {
      if (this.readyState !== 1 || !this.subscriptions.has(key)) return;
      const data = JSON.stringify({ channel: 'candle', data: { t, T: t + step - 1, s: subscription.coin, i: interval,
        o: String(close), h: String(close * 1.0005), l: String(close * 0.9995), c: String(close), v: '2', n: 1 } });
      this.onmessage?.call(this as unknown as WebSocket, { data } as MessageEvent);
    });
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    const event = { code, reason, wasClean: true } as CloseEvent;
    queueMicrotask(() => this.onclose?.call(this as unknown as WebSocket, event));
  }
}

interface StoredCandle { candle: Candle; source: 'history' | 'live' }
interface Entry {
  identity: ComparisonIdentity;
  key: string;
  subscriptionKey: string;
  ids: Set<string>;
  bars: Map<number, StoredCandle>;
  patches: Map<number, Candle>;
  overflow: boolean;
  status: ComparisonStatus;
  historyAbort?: AbortController;
  historyGeneration: number;
  historyFrom?: number;
  refreshAfterHistory: boolean;
  loadedFrom?: number;
  retryAt: number;
  attempts: number;
  desiredFrom: number;
  validated: boolean;
  activeOnSocket: boolean;
  cacheUntil?: number;
  lastStatusEmission: number;
}

interface MetadataRecord { symbols?: Set<string>; promise?: Promise<Set<string>>; expiresAt: number }
interface Connection {
  ws?: WebSocket;
  state: ComparisonFeedDiagnostics['socket'];
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>;
  openedAt?: number;
}

/**
 * One comparison-only Hyperliquid stream. Full source identity owns history,
 * validation and cache; panels share each identity while it is selected.
 */
export class ComparisonService {
  private entries = new Map<string, Entry>();
  private subscriptions = new Map<string, Set<string>>();
  private windows = new Map<string, ComparisonWindow>();
  private metadata = new Map<string, MetadataRecord>();
  private subscriptionEntries = new Map<string, Entry>();
  private subscribedUpstream = new Set<string>();
  private connection: Connection = { state: 'closed', attempts: 0 };
  private online = true;
  private dead = false;
  private flushTimer: ReturnType<typeof setInterval>;
  private checkTimer: ReturnType<typeof setInterval>;
  private readonly metaAbort = new AbortController();
  private readonly transport: ComparisonTransport;
  private readonly histories: HistoryScheduler;
  private readonly transportMode: ComparisonFeedDiagnostics['transport'];
  private socketCreations = 0;
  private historyRequests = 0;

  constructor(
    private emit: (event: ComparisonEvent) => void,
    transport: ComparisonTransport = liveTransport,
    histories: HistoryScheduler = historyScheduler,
    transportMode?: ComparisonFeedDiagnostics['transport'],
  ) {
    this.transport = transport;
    this.histories = histories;
    this.transportMode = transportMode ?? (transport === liveTransport ? 'direct' : 'injected');
    this.flushTimer = setInterval(() => this.flush(), 50);
    this.checkTimer = setInterval(() => this.check(), 1000);
  }

  command(command: { type: 'comparison-subscribe'; id: string; request: ComparisonRequest } | { type: 'comparison-unsubscribe' | 'comparison-retry'; id: string }) {
    if (command.type === 'comparison-subscribe') this.subscribe(command.id, command.request);
    else if (command.type === 'comparison-unsubscribe') this.unsubscribe(command.id);
    else this.retry(command.id);
  }

  subscribe(id: string, request: ComparisonRequest) {
    if (!validComparisonRequest(request) || this.dead) return;
    this.unsubscribe(id);
    const keys = new Set<string>();
    this.subscriptions.set(id, keys);
    this.windows.set(id, request.window);
    for (const symbol of request.symbols) {
      const identity = comparisonIdentity(symbol, request.interval);
      const entry = this.entry(identity);
      entry.ids.add(id);
      entry.cacheUntil = undefined;
      keys.add(entry.key);
      this.recalculateWindow(entry);
      if (entry.bars.size) this.sendSnapshot(entry, [id]);
      this.sendStatus(entry, [id]);
      if (entry.validated) this.activate(entry);
      else void this.validateAndActivate(entry, entry.historyGeneration);
    }
  }

  unsubscribe(id: string) {
    const keys = this.subscriptions.get(id);
    this.subscriptions.delete(id);
    this.windows.delete(id);
    if (!keys) return;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.ids.delete(id);
      this.recalculateWindow(entry);
      if (entry.ids.size) continue;
      entry.cacheUntil = this.transport.now() + CACHE_TTL_MS;
      entry.historyGeneration++;
      entry.historyAbort?.abort(); entry.historyAbort = undefined; entry.historyFrom = undefined;
      this.unsubscribeUpstream(entry);
    }
    this.pruneCache();
    if (![...this.entries.values()].some(entry => entry.ids.size && entry.validated)) this.closeConnection();
  }

  private entry(identity: ComparisonIdentity): Entry {
    const key = comparisonIdentityKey(identity);
    let entry = this.entries.get(key);
    if (entry) return entry;
    if (this.entries.size >= MAX_CACHE_ENTRIES) {
      const victim = [...this.entries.values()].filter(item => !item.ids.size).sort((a, b) => (a.cacheUntil ?? 0) - (b.cacheUntil ?? 0))[0];
      if (victim) this.evict(victim);
    }
    if (this.entries.size >= MAX_CACHE_ENTRIES) throw new Error('Comparison cache capacity reached');
    const market = comparisonMarket(identity.symbol)!;
    const now = this.transport.now();
    entry = {
      identity, key, subscriptionKey: `${identity.symbol}|${identity.interval}`, ids: new Set(),
      bars: new Map(), patches: new Map(), overflow: false,
      status: { state: 'loading', connection: 'connecting', message: 'Checking Hyperliquid perpetual metadata', historyPending: false, lastCandleAt: null, quietMs: null, retainedBars: 0 },
      historyGeneration: 0, retryAt: 0, attempts: 0,
      refreshAfterHistory: false,
      desiredFrom: now - comparisonWindowMs['4h'] - comparisonStepMs[identity.interval] * 2,
      validated: false, activeOnSocket: false, lastStatusEmission: 0,
    };
    this.entries.set(key, entry);
    this.subscriptionEntries.set(entry.subscriptionKey, entry);
    return entry;
  }

  private recalculateWindow(entry: Entry) {
    const windows = [...entry.ids].map(id => this.windows.get(id)).filter((value): value is ComparisonWindow => value !== undefined);
    const duration = windows.reduce((maximum, window) => Math.max(maximum, comparisonWindowMs[window]), 0) || comparisonWindowMs['4h'];
    const step = comparisonStepMs[entry.identity.interval];
    const now = this.transport.now();
    const requested = Math.floor((now - duration - step * 2) / step) * step;
    entry.desiredFrom = Math.max(now - MAX_RETAINED_BARS * step, requested);
    if (entry.historyAbort && entry.historyFrom !== undefined && entry.desiredFrom < entry.historyFrom) {
      // One fetch remains in flight; its completion will detect and fill the wider window.
    } else if (entry.ids.size && entry.validated && entry.loadedFrom !== undefined && entry.loadedFrom > entry.desiredFrom) {
      this.fetchHistory(entry, true);
    }
  }

  private async getMetadata(dex: string): Promise<Set<string>> {
    const now = this.transport.now();
    const cached = this.metadata.get(dex);
    if (cached?.symbols && cached.expiresAt > now) return cached.symbols;
    if (cached?.promise) return cached.promise;
    const record: MetadataRecord = { expiresAt: now + 5 * 60_000 };
    const promise = this.transport.metadata(dex, this.metaAbort.signal).then(symbols => {
      if (this.dead) return symbols;
      record.symbols = symbols; record.expiresAt = this.transport.now() + 5 * 60_000; record.promise = undefined;
      return symbols;
    }).catch(error => {
      if (this.metadata.get(dex) === record) this.metadata.delete(dex);
      throw error;
    });
    record.promise = promise;
    this.metadata.set(dex, record);
    return promise;
  }

  private async validateAndActivate(entry: Entry, generation: number) {
    const market = comparisonMarket(entry.identity.symbol);
    if (!market) return;
    try {
      const metadata = await this.getMetadata(market.dex);
      if (!this.isCurrent(entry, generation)) return;
      if (!metadata.has(market.symbol)) {
        this.setStatus(entry, 'unavailable', `Unavailable on Hyperliquid ${market.dex || 'perpetuals'} · exact symbol ${market.symbol} is absent from metadata`, 'disconnected');
        return;
      }
      entry.validated = true;
      this.activate(entry);
    } catch (error) {
      if (!this.isCurrent(entry, generation)) return;
      const message = error instanceof Error ? error.message : 'Hyperliquid metadata unavailable';
      entry.attempts++;
      entry.retryAt = entry.attempts < 5 ? this.transport.now() + this.backoff(entry.attempts) : 0;
      this.setStatus(entry, 'failed', `${message}${entry.retryAt ? ' · retrying' : ' · use Retry'}`, 'disconnected');
    }
  }

  private isCurrent(entry: Entry, generation: number) {
    return !this.dead && entry.ids.size > 0 && this.entries.get(entry.key) === entry && entry.historyGeneration === generation;
  }

  private activate(entry: Entry) {
    if (this.dead || !this.online || !entry.ids.size || !entry.validated) return;
    this.connect();
    if (this.connection.ws?.readyState === 1) this.subscribeUpstream(entry);
    this.fetchHistory(entry);
  }

  private retry(id: string) {
    const keys = this.subscriptions.get(id);
    if (!keys) return;
    this.connection.attempts = 0;
    this.connection.state = this.connection.ws ? 'reconnecting' : 'closed';
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.attempts = 0; entry.retryAt = 0;
      const dex = comparisonMarket(entry.identity.symbol)!.dex;
      this.metadata.delete(dex);
      entry.validated = false;
      entry.historyGeneration++;
      entry.historyAbort?.abort(); entry.historyAbort = undefined; entry.historyFrom = undefined;
      this.setStatus(entry, entry.bars.size ? 'stale' : 'loading', 'Retrying direct Hyperliquid history and stream', 'connecting');
      void this.validateAndActivate(entry, entry.historyGeneration);
    }
  }

  private fetchHistory(entry: Entry, force = false) {
    if (entry.historyAbort) { if (force || entry.desiredFrom < (entry.historyFrom ?? entry.desiredFrom)) entry.refreshAfterHistory = true; return; }
    if (!this.online || this.dead || !entry.ids.size || !entry.validated) return;
    if (!force && entry.loadedFrom !== undefined && entry.loadedFrom <= entry.desiredFrom && this.isRecent(entry)) return;
    const now = this.transport.now();
    const startTime = Math.max(now - MAX_RETAINED_BARS * comparisonStepMs[entry.identity.interval], entry.desiredFrom);
    const endTime = now + comparisonStepMs[entry.identity.interval];
    const generation = ++entry.historyGeneration;
    const abort = new AbortController();
    entry.historyAbort = abort; entry.historyFrom = startTime; entry.retryAt = 0;
    this.historyRequests++;
    entry.status = { ...entry.status, historyPending: true };
    this.setStatus(entry, entry.bars.size ? 'stale' : 'loading', entry.bars.size ? 'Refreshing bounded history' : 'Loading Hyperliquid candle history', this.connection.ws?.readyState === 1 ? 'connected' : 'connecting');
    void this.histories.read(`${entry.key}:${startTime}`, 'comparison', abort.signal,
      signal => this.transport.history(entry.identity, startTime, endTime, signal), 0)
      .then(candles => {
        if (!this.isCurrent(entry, generation)) return;
        this.merge(entry, candles, 'history');
        entry.loadedFrom = startTime;
        entry.attempts = 0;
        const needsRefresh = entry.desiredFrom < startTime || entry.refreshAfterHistory;
        entry.status = { ...entry.status, historyPending: needsRefresh };
        this.sendSnapshot(entry);
        entry.patches.clear(); entry.overflow = false;
        const connected = this.connection.ws?.readyState === 1 ? 'connected' : 'disconnected';
        this.setStatus(entry, connected === 'connected' ? 'live' : 'stale', connected === 'connected' ? 'History ready · candle stream connected' : 'History ready · waiting for stream', connected);
        if (needsRefresh) { entry.refreshAfterHistory = false; this.fetchHistory(entry, true); }
      })
      .catch(error => {
        if (!this.isCurrent(entry, generation)) return;
        if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        entry.status = { ...entry.status, historyPending: entry.refreshAfterHistory };
        const message = error instanceof Error ? error.message : 'Hyperliquid history unavailable';
        entry.attempts++;
        const hard = error instanceof ComparisonHttpError && error.hard;
        const retryDelay = error instanceof ComparisonHttpError ? error.retryAfter : 0;
        entry.retryAt = !hard && entry.attempts < 5 ? this.transport.now() + Math.max(retryDelay, this.backoff(entry.attempts)) : 0;
        this.setStatus(entry, entry.bars.size ? 'stale' : 'failed', `${message}${entry.retryAt ? ' · retrying' : ' · use Retry'}`, this.connection.ws?.readyState === 1 ? 'connected' : 'disconnected');
      })
      .finally(() => {
        if (entry.historyGeneration === generation) {
          entry.historyAbort = undefined; entry.historyFrom = undefined;
          if (entry.refreshAfterHistory && entry.ids.size && this.online) { entry.refreshAfterHistory = false; this.fetchHistory(entry, true); }
        }
      });
  }

  private isRecent(entry: Entry) {
    const last = this.sorted(entry).at(-1);
    return Boolean(last && this.transport.now() - last.t <= comparisonStepMs[entry.identity.interval] * 2);
  }

  private merge(entry: Entry, candles: readonly Candle[], source: 'history' | 'live') {
    const changed: Candle[] = [];
    for (const candle of candles) {
      if (!validateComparisonCandle({ s: entry.identity.symbol, i: entry.identity.interval, t: candle.t, T: candle.t + comparisonStepMs[entry.identity.interval] - 1,
        o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, n: candle.revision }, entry.identity, this.transport.now(), source === 'live')) continue;
      const old = entry.bars.get(candle.t);
      if (old) {
        if (source === 'history' && old.source === 'live') continue;
        if (source === 'live' && old.source === 'live' && candle.revision < old.candle.revision) continue;
        const previous = old.candle;
        if (previous.o === candle.o && previous.h === candle.h && previous.l === candle.l && previous.c === candle.c && previous.v === candle.v
          && previous.revision === candle.revision && previous.closed === candle.closed) continue;
      }
      entry.bars.set(candle.t, { candle, source });
      changed.push(candle);
    }
    if (entry.bars.size > MAX_RETAINED_BARS) {
      const times = [...entry.bars.keys()].sort((a, b) => a - b);
      for (const time of times.slice(0, times.length - MAX_RETAINED_BARS)) entry.bars.delete(time);
    }
    for (const candle of changed) {
      if (entry.patches.size >= MAX_PATCH_QUEUE && !entry.patches.has(candle.t)) { entry.patches.clear(); entry.overflow = true; }
      entry.patches.set(candle.t, candle);
    }
    if (source === 'live' && changed.length) entry.status = { ...entry.status, lastCandleAt: this.transport.now(), quietMs: 0 };
  }

  private connect() {
    if (this.dead || !this.online || ![...this.entries.values()].some(entry => entry.ids.size && entry.validated)) return;
    if (this.connection.ws && this.connection.ws.readyState <= 1) return;
    clearTimeout(this.connection.timer);
    const connection = this.connection;
    connection.state = connection.attempts ? 'reconnecting' : 'connecting';
    const ws = this.transport.socket(SOCKET_URL);
    this.socketCreations++;
    connection.ws = ws;
    for (const entry of this.entries.values()) if (entry.ids.size && entry.validated) this.sendStatus(entry);
    const opening = setTimeout(() => { if (ws.readyState === 0) ws.close(); }, 12_000);
    ws.onopen = () => {
      clearTimeout(opening);
      connection.state = 'connected'; connection.attempts = 0; connection.openedAt = this.transport.now();
      this.subscribedUpstream.clear();
      for (const entry of this.entries.values()) {
        if (!entry.ids.size || !entry.validated) continue;
        this.subscribeUpstream(entry);
        this.fetchHistory(entry, true);
        this.setStatus(entry, entry.bars.size ? 'live' : 'loading', entry.bars.size ? 'Candle stream connected · repairing recent history' : 'Candle stream connected · loading history', 'connected');
      }
      connection.heartbeat = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ method: 'ping' }));
          if (this.transport.now() - (connection.openedAt ?? this.transport.now()) > 60_000 && this.transport.now() - this.lastSocketMessage > 60_000) ws.close();
        }
      }, 25_000);
    };
    ws.onmessage = event => {
      this.lastSocketMessage = this.transport.now();
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message || typeof message !== 'object') return;
      const raw = message as { channel?: unknown; data?: unknown };
      if (raw.channel !== 'candle') return;
      const rows = Array.isArray(raw.data) ? raw.data : [raw.data];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const data = row as { s?: unknown; i?: unknown };
        if (typeof data.s !== 'string' || typeof data.i !== 'string') continue;
        const entry = this.subscriptionEntries.get(`${data.s}|${data.i}`);
        if (!entry || !entry.ids.size || !entry.validated) continue;
        const candles = parseComparisonLive({ channel: 'candle', data: row }, entry.identity, this.transport.now());
        if (!candles.length) continue;
        this.merge(entry, candles, 'live');
        if (entry.loadedFrom !== undefined) this.setStatus(entry, 'live', 'Candle stream connected', 'connected');
      }
    };
    ws.onerror = () => {
      for (const entry of this.entries.values()) if (entry.ids.size) this.setStatus(entry, entry.bars.size ? 'stale' : 'loading', 'Hyperliquid candle stream unavailable', 'disconnected');
    };
    ws.onclose = () => {
      clearTimeout(opening); clearInterval(connection.heartbeat); connection.heartbeat = undefined;
      if (connection.ws !== ws) return;
      connection.ws = undefined; connection.state = 'closed'; this.subscribedUpstream.clear();
      for (const entry of this.entries.values()) entry.activeOnSocket = false;
      if (this.dead || !this.online) return;
      const active = [...this.entries.values()].filter(entry => entry.ids.size && entry.validated);
      if (!active.length) return;
      connection.attempts++;
      for (const entry of active) this.setStatus(entry, 'stale', 'Stream disconnected · history retained · reconnecting', 'disconnected');
      if (connection.attempts <= 5) {
        connection.state = 'reconnecting';
        connection.timer = setTimeout(() => this.connect(), this.backoff(connection.attempts));
      } else {
        connection.state = 'failed';
        for (const entry of active) this.setStatus(entry, 'stale', 'Stream reconnect limit reached · use Retry', 'disconnected');
      }
    };
  }

  private lastSocketMessage = 0;

  private subscribeUpstream(entry: Entry) {
    const ws = this.connection.ws;
    if (!ws || ws.readyState !== 1 || !entry.ids.size || entry.activeOnSocket) return;
    ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: entry.identity.symbol, interval: entry.identity.interval } }));
    entry.activeOnSocket = true;
    this.subscribedUpstream.add(entry.subscriptionKey);
  }

  private unsubscribeUpstream(entry: Entry) {
    const ws = this.connection.ws;
    if (entry.activeOnSocket && ws?.readyState === 1) {
      ws.send(JSON.stringify({ method: 'unsubscribe', subscription: { type: 'candle', coin: entry.identity.symbol, interval: entry.identity.interval } }));
    }
    entry.activeOnSocket = false;
    this.subscribedUpstream.delete(entry.subscriptionKey);
  }

  private closeConnection() {
    clearTimeout(this.connection.timer); clearInterval(this.connection.heartbeat);
    const ws = this.connection.ws;
    this.connection.ws = undefined; this.connection.state = 'closed'; this.connection.attempts = 0;
    this.subscribedUpstream.clear();
    for (const entry of this.entries.values()) entry.activeOnSocket = false;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); }
  }

  private flush() {
    for (const entry of this.entries.values()) {
      if (!entry.ids.size || entry.loadedFrom === undefined || !entry.patches.size) continue;
      const candles = entry.overflow ? this.sorted(entry) : [...entry.patches.values()].sort((a, b) => a.t - b.t);
      const type = entry.overflow ? 'comparison-snapshot' : 'comparison-patch';
      entry.patches.clear(); entry.overflow = false;
      this.emit({ type, ids: [...entry.ids], identity: entry.identity, candles, status: this.snapshotStatus(entry) });
    }
  }

  private sendSnapshot(entry: Entry, ids = [...entry.ids]) {
    if (!ids.length) return;
    this.emit({ type: 'comparison-snapshot', ids, identity: entry.identity, candles: this.sorted(entry), status: this.snapshotStatus(entry) });
  }

  private sendStatus(entry: Entry, ids = [...entry.ids]) {
    if (!ids.length) return;
    this.emit({ type: 'comparison-status', ids, identity: entry.identity, status: this.snapshotStatus(entry) });
  }

  private setStatus(entry: Entry, state: ComparisonStatus['state'], message: string, connection: ComparisonConnectionState) {
    entry.status = { ...entry.status, state, message, connection, retainedBars: entry.bars.size,
      quietMs: entry.status.lastCandleAt === null ? null : Math.max(0, this.transport.now() - entry.status.lastCandleAt) };
    this.sendStatus(entry);
  }

  private snapshotStatus(entry: Entry): ComparisonStatus {
    const quietMs = entry.status.lastCandleAt === null ? null : Math.max(0, this.transport.now() - entry.status.lastCandleAt);
    let connection: ComparisonConnectionState = 'disconnected';
    if (this.connection.ws?.readyState === 1) connection = 'connected';
    else if (this.connection.state === 'connecting' || this.connection.state === 'reconnecting') connection = 'connecting';
    return { ...entry.status, connection, quietMs, retainedBars: entry.bars.size };
  }

  private sorted(entry: Entry): Candle[] {
    return [...entry.bars.values()].map(row => row.candle).sort((a, b) => a.t - b.t);
  }

  private backoff(attempt: number) { return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (.75 + this.transport.random() * .5); }

  private check() {
    const now = this.transport.now();
    for (const entry of this.entries.values()) {
      if (entry.retryAt && now >= entry.retryAt) {
        entry.retryAt = 0;
        if (!entry.validated) void this.validateAndActivate(entry, entry.historyGeneration);
        else this.fetchHistory(entry, true);
      }
      if (entry.ids.size && now - entry.lastStatusEmission >= 5000) {
        entry.lastStatusEmission = now;
        this.sendStatus(entry);
      }
      if (!entry.ids.size && entry.cacheUntil !== undefined && now >= entry.cacheUntil) this.evict(entry);
    }
    if (this.connection.state === 'closed' && [...this.entries.values()].some(entry => entry.ids.size && entry.validated)) this.connect();
    this.pruneCache();
  }

  private evict(entry: Entry) {
    if (entry.ids.size || this.entries.get(entry.key) !== entry) return;
    entry.historyGeneration++; entry.historyAbort?.abort();
    this.entries.delete(entry.key);
    this.subscriptionEntries.delete(entry.subscriptionKey);
    this.unsubscribeUpstream(entry);
  }

  private pruneCache() {
    if (this.entries.size <= MAX_CACHE_ENTRIES) return;
    const candidates = [...this.entries.values()].filter(entry => !entry.ids.size).sort((a, b) => (a.cacheUntil ?? 0) - (b.cacheUntil ?? 0));
    while (this.entries.size > MAX_CACHE_ENTRIES && candidates.length) this.evict(candidates.shift()!);
  }

  setOnline(online: boolean) {
    this.online = online;
    if (!online) {
      for (const entry of this.entries.values()) if (entry.ids.size) this.setStatus(entry, entry.bars.size ? 'stale' : 'loading', 'Offline · cached history retained', 'disconnected');
      this.closeConnection();
      return;
    }
    this.connection.attempts = 0;
    for (const entry of this.entries.values()) if (entry.ids.size) {
      entry.retryAt = 0;
      if (!entry.validated) void this.validateAndActivate(entry, entry.historyGeneration);
      else this.activate(entry);
    }
  }

  diagnostics(): ComparisonFeedDiagnostics {
    return {
      subscriptions: this.subscriptions.size,
      activeIdentities: [...this.entries.values()].filter(entry => entry.ids.size).length,
      transport: this.transportMode,
      socket: this.connection.state,
      socketCreations: this.socketCreations,
      historyRequests: this.historyRequests,
      reconnectAttempts: this.connection.attempts,
      retainedBars: [...this.entries.values()].reduce((sum, entry) => sum + entry.bars.size, 0),
      pendingCandles: [...this.entries.values()].reduce((sum, entry) => sum + entry.patches.size, 0),
      pendingHistory: [...this.entries.values()].filter(entry => Boolean(entry.historyAbort)).length,
      metadataCaches: this.metadata.size,
    };
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    clearInterval(this.flushTimer); clearInterval(this.checkTimer);
    this.metaAbort.abort(); this.closeConnection();
    for (const entry of this.entries.values()) { entry.historyGeneration++; entry.historyAbort?.abort(); entry.ids.clear(); entry.patches.clear(); }
    this.entries.clear(); this.subscriptions.clear(); this.windows.clear(); this.metadata.clear(); this.subscriptionEntries.clear();
  }
}

import { BinanceDepthBook, DEPTH_BANDS_PERCENT, type DepthDiff, type DepthSnapshot } from './depth-book';
import { type DepthObservation, type DepthStatus, type Event, validDepthBand } from './protocol';

const DEPTH_SOCKET = 'wss://fstream.binance.com/public/ws/btcusdt@depth@100ms';
const DEPTH_SNAPSHOT = 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000';
const SAMPLE_MS = 1000;
const HISTORY_LIMIT = 3600;
const SNAPSHOT_TIMEOUT_MS = 12_000;

export interface DepthTransport {
  snapshot(signal: AbortSignal): Promise<DepthSnapshot>;
  socket(url: string): WebSocket;
  now(): number;
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const browserTransport: DepthTransport = {
  async snapshot(signal) {
    const response = await fetch(DEPTH_SNAPSHOT, { signal });
    if (!response.ok) throw new Error(`Depth snapshot HTTP ${response.status}`);
    return parseSnapshot(await response.json());
  },
  socket: url => new WebSocket(url),
  now: () => Date.now(),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: timer => globalThis.clearInterval(timer),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: timer => globalThis.clearTimeout(timer),
};

/** One shared Binance BTCUSDT USD-M book, sampled independently from chart FPS. */
export class BinanceDepthService {
  private ids = new Map<string, number>();
  private observers = new Map<string, (book: BinanceDepthBook | null, now: number, epoch: number) => void>();
  private get consumerCount() { return this.ids.size + this.observers.size; }
  observeBook(id: string, callback: (book: BinanceDepthBook | null, now: number, epoch: number) => void) {
    const first = this.consumerCount === 0;
    this.observers.set(id, callback);
    callback(this.status.state === 'live' ? this.book : null, this.transport.now(), this.epoch);
    if (first) this.start();
    return () => { this.observers.delete(id); if (!this.consumerCount) this.stop(); };
  }
  private notifyBook() { for (const callback of this.observers.values()) callback(this.status.state === 'live' ? this.book : null, this.transport.now(), this.epoch); }
  private readonly book = new BinanceDepthBook();
  private readonly history: DepthObservation[] = [];
  private status: DepthStatus = { state: 'syncing', message: 'Depth study is not attached', lastUpdate: 0, collectionStartedAt: null };
  private ws?: WebSocket;
  private abort?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private openingTimer?: ReturnType<typeof setTimeout>;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private attempts = 0;
  private sampleCount = 0;
  private online = true;
  private disposed = false;
  private collectionStartedAt: number | null = null;

  constructor(private readonly emit: (event: Event) => void, private readonly transport: DepthTransport = browserTransport) {}

  subscribe(id: string, bandPercent: number) {
    if (!id || !validDepthBand(bandPercent) || this.disposed) return;
    const first = this.consumerCount === 0;
    this.ids.set(id, bandPercent);
    this.emit({ type: 'depth-status', ids: [id], status: this.currentStatus() });
    this.emit({ type: 'depth-history', ids: [id], bandPercent, observations: this.history.filter(o => o.bandPercent === bandPercent) });
    if (first) this.start();
  }

  unsubscribe(id: string) {
    this.ids.delete(id);
    if (this.consumerCount === 0) this.stop();
  }

  setOnline(online: boolean) {
    if (this.online === online || this.disposed) return;
    this.online = online;
    if (!online) {
      this.epoch++;
      this.abort?.abort();
      this.closeSocket();
      this.clearRetry();
      this.book.beginSync();
      this.setStatus('stale', 'Offline · Binance depth paused');
    } else if (this.consumerCount) {
      this.attempts = 0;
      this.start();
    }
  }

  retry() {
    if (!this.online || !this.consumerCount || this.disposed) return;
    this.attempts = 0;
    this.start(true);
  }

  getStatus(): DepthStatus { return this.currentStatus(); }

  diagnostics() {
    return {
      subscribers: this.ids.size,
      bookObservers: this.observers.size,
      sockets: this.ws && this.ws.readyState <= 1 ? 1 : 0,
      state: this.status.state,
      lastUpdateId: this.book.lastUpdateId,
      buffered: this.book.bufferedCount,
      samples: this.sampleCount,
      snapshotBidBoundary: this.book.snapshotBidBoundary,
      snapshotAskBoundary: this.book.snapshotAskBoundary,
      collectionStartedAt: this.collectionStartedAt,
      synthetic: false,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.ids.clear();
    this.observers.clear();
    this.abort?.abort();
    this.clearRetry();
    if (this.snapshotTimer) this.transport.clearTimeout(this.snapshotTimer);
    if (this.sampleTimer) this.transport.clearInterval(this.sampleTimer);
    this.closeSocket();
    this.history.length = 0;
  }

  private start(force = false) {
    if (this.disposed || !this.online || !this.consumerCount) return;
    if (force) {
      this.epoch++;
      this.abort?.abort();
      this.clearRetry();
      if (this.snapshotTimer) this.transport.clearTimeout(this.snapshotTimer);
      this.closeSocket();
      this.book.beginSync();
    } else if (this.ws && this.ws.readyState <= 1) return;
    this.epoch++;
    const epoch = this.epoch;
    this.book.beginSync();
    this.setStatus('syncing', 'Connecting to Binance BTCUSDT USD-M depth');
    const socket = this.transport.socket(DEPTH_SOCKET);
    this.ws = socket;
    const opening = this.openingTimer = this.transport.setTimeout(() => { if (socket.readyState === 0) socket.close(); }, 12_000);
    socket.onopen = () => {
      if (this.epoch !== epoch || this.ws !== socket) return;
      this.transport.clearTimeout(opening);
      this.attempts = 0;
      this.abort?.abort();
      const controller = new AbortController();
      this.abort = controller;
      void this.fetchSnapshot(epoch, controller);
      if (!this.sampleTimer) this.sampleTimer = this.transport.setInterval(() => this.sample(), SAMPLE_MS);
    };
    socket.onmessage = event => {
      if (this.epoch !== epoch || this.ws !== socket) return;
      const update = parseDiff(event.data);
      if (!update) return;
      const result = this.book.push(update, this.transport.now());
      if (result === 'gap') this.reconnect('Sequence gap · resynchronizing depth');
      else if (result === 'applied') {
        this.status = { ...this.status, lastUpdate: this.transport.now() };
        if (this.status.state !== 'live') this.setStatus('live', this.liveMessage());
        else this.notifyBook();
      }
    };
    socket.onerror = () => {
      if (this.epoch === epoch) this.reconnect('Binance depth connection error · reconnecting');
    };
    socket.onclose = () => {
      this.transport.clearTimeout(opening);
      if (this.epoch !== epoch || this.disposed || !this.consumerCount || !this.online) return;
      this.ws = undefined;
      this.abort?.abort();
      this.book.beginSync();
      this.setStatus('stale', 'Binance depth disconnected · resynchronizing');
      this.scheduleRetry();
    };
  }

  private async fetchSnapshot(epoch: number, controller: AbortController) {
    const timeout = this.transport.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
    try {
      const snapshot = await this.transport.snapshot(controller.signal);
      if (this.disposed || epoch !== this.epoch || this.abort !== controller || this.ws?.readyState !== 1) return;
      if (!this.book.applySnapshot(snapshot, this.transport.now())) {
        if (this.snapshotTimer) this.transport.clearTimeout(this.snapshotTimer);
        this.snapshotTimer = this.transport.setTimeout(() => {
          if (this.epoch === epoch && this.ws?.readyState === 1 && !this.abort?.signal.aborted) void this.fetchSnapshot(epoch, controller);
        }, 250);
        return;
      }
      this.collectionStartedAt ??= this.book.snapshotStartedAt;
      this.status = { ...this.status, lastUpdate: this.book.lastReceivedAt || this.transport.now() };
      this.setStatus('live', this.liveMessage());
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      this.setStatus('stale', error instanceof Error ? `${error.message} · retrying` : 'Depth snapshot failed · retrying');
      this.reconnect('Depth snapshot failed · reconnecting');
    } finally { this.transport.clearTimeout(timeout); }
  }

  private sample() {
    if (this.status.state !== 'live' || !this.consumerCount) return;
    if (this.transport.now() - this.book.lastReceivedAt > 5000) { this.reconnect('Depth silent for 5s · resynchronizing'); return; }
    const now = this.transport.now();
    const activeBands = new Set(this.ids.values());
    const observations = [...activeBands].map(band => this.book.measure(band, now)).filter((value): value is DepthObservation => value !== null);
    if (!observations.length) return;
    this.sampleCount++;
    this.history.push(...observations);
    if (this.history.length > HISTORY_LIMIT * DEPTH_BANDS_PERCENT.length) this.history.splice(0, this.history.length - HISTORY_LIMIT * DEPTH_BANDS_PERCENT.length);
    const byBand = new Map<number, string[]>();
    for (const [id, band] of this.ids) {
      const list = byBand.get(band) ?? [];
      list.push(id); byBand.set(band, list);
    }
    for (const [bandPercent, ids] of byBand) {
      const observation = observations.find(value => value.bandPercent === bandPercent);
      if (observation) this.emit({ type: 'depth-sample', ids, observation });
    }
  }

  private liveMessage() {
    const bid = this.book.snapshotBidBoundary;
    const ask = this.book.snapshotAskBoundary;
    return `Synchronized · 1,000-level snapshot · bid edge ${bid?.toFixed(1) ?? 'unknown'} / ask edge ${ask?.toFixed(1) ?? 'unknown'} · 1s sampled observations`;
  }

  private currentStatus(): DepthStatus { return { ...this.status, collectionStartedAt: this.collectionStartedAt }; }
  private setStatus(state: DepthStatus['state'], message: string) {
    const next: DepthStatus = {
      state, message, lastUpdate: this.status.lastUpdate,
      collectionStartedAt: this.collectionStartedAt,
      snapshotBidBoundary: this.book.snapshotBidBoundary,
      snapshotAskBoundary: this.book.snapshotAskBoundary,
    };
    if (state === this.status.state && message === this.status.message && next.lastUpdate === this.status.lastUpdate) return;
    this.status = next;
    this.notifyBook();
    this.emit({ type: 'depth-status', ids: [...this.ids.keys()], status: next });
  }

  private reconnect(message: string) {
    this.epoch++;
    this.abort?.abort();
    if (this.snapshotTimer) this.transport.clearTimeout(this.snapshotTimer);
    this.closeSocket();
    this.book.beginSync();
    this.setStatus('syncing', message);
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.disposed || !this.online || !this.consumerCount || this.retryTimer) return;
    this.attempts++;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempts - 1, 6));
    this.retryTimer = this.transport.setTimeout(() => { this.retryTimer = undefined; this.start(); }, delay);
  }

  private clearRetry() {
    if (this.retryTimer) this.transport.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private closeSocket() {
    if (this.openingTimer) this.transport.clearTimeout(this.openingTimer); this.openingTimer = undefined;
    const socket = this.ws;
    this.ws = undefined;
    if (!socket) return;
    socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
    socket.close();
  }

  private stop() {
    this.epoch++;
    this.abort?.abort();
    this.clearRetry();
    if (this.snapshotTimer) this.transport.clearTimeout(this.snapshotTimer);
    if (this.sampleTimer) this.transport.clearInterval(this.sampleTimer);
    this.snapshotTimer = undefined; this.sampleTimer = undefined;
    this.closeSocket();
    this.book.beginSync();
    this.history.length = 0; this.collectionStartedAt = null;
    this.setStatus('syncing', 'Depth is not attached');
  }
}

function parseSnapshot(value: unknown): DepthSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Malformed Binance depth snapshot');
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.lastUpdateId) || !Array.isArray(raw.bids) || !Array.isArray(raw.asks)) throw new Error('Malformed Binance depth snapshot');
  return {
    lastUpdateId: raw.lastUpdateId as number,
    bids: checkedLevels(raw.bids),
    asks: checkedLevels(raw.asks),
  };
}

function checkedLevels(value: unknown[]): (readonly [string | number, string | number])[] {
  if (value.length > 1000) throw new Error('Binance returned more than 1,000 depth levels');
  return value.map(item => {
    if (!Array.isArray(item) || item.length !== 2 || ![item[0], item[1]].every(part => typeof part === 'string' || typeof part === 'number')) throw new Error('Malformed Binance depth level');
    if (!Number.isFinite(Number(item[0])) || Number(item[0]) <= 0 || Number(item[0]) > Number.MAX_SAFE_INTEGER || !Number.isFinite(Number(item[1])) || Number(item[1]) < 0 || Number(item[1]) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid Binance depth quantity');
    return [item[0] as string | number, item[1] as string | number] as const;
  });
}

function parseDiff(value: unknown): DepthDiff | null {
  if (typeof value === 'string' && value.length > 1024 * 1024) return null;
  let raw: unknown;
  try { raw = typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.e !== 'depthUpdate' || d.s !== 'BTCUSDT' || !Number.isSafeInteger(d.U) || !Number.isSafeInteger(d.u) || !Number.isSafeInteger(d.pu) || !Array.isArray(d.b) || !Array.isArray(d.a)) return null;
  const levels = (rows: unknown[]) => rows.every(row => Array.isArray(row) && row.length === 2 && row.every(part => typeof part === 'string' || typeof part === 'number') && Number.isFinite(Number(row[0])) && Number(row[0]) > 0 && Number(row[0]) <= Number.MAX_SAFE_INTEGER && Number.isFinite(Number(row[1])) && Number(row[1]) >= 0 && Number(row[1]) <= Number.MAX_SAFE_INTEGER);
  if (d.b.length > 10000 || d.a.length > 10000 || !levels(d.b) || !levels(d.a)) return null;
  return { U: d.U as number, u: d.u as number, pu: d.pu as number, b: d.b as DepthDiff['b'], a: d.a as DepthDiff['a'] };
}

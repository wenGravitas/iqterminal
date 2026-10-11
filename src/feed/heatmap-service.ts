import type { Event } from './protocol';
import { footprintTicksForPrice } from './protocol';
import { parseBinanceBtcUsdtTickSize } from './footprint';
import { BinanceDepthService } from './depth-service';
import { HEATMAP_LIMITS, LiquidityCollector, heatmapKey, validResolution, type HeatmapResolution, type HeatmapStatus, type LiquidityBucket } from './heatmap-model';
import type { BinanceDepthBook } from './depth-book';
interface Group { ids: Set<string>; resolution: HeatmapResolution; generation: number; collector?: LiquidityCollector;
  pending: Map<string, LiquidityBucket>; snapshot: boolean; inFlight?: number; message?: string }
export interface HeatmapTransport { now(): number; metadata(signal: AbortSignal): Promise<unknown>; setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>; clearInterval(timer: ReturnType<typeof setInterval>): void }
const transport: HeatmapTransport = { now: () => Date.now(),
  metadata: async signal => { const r = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT', { signal }); if (!r.ok) throw new Error(`Heatmap metadata HTTP ${r.status}`); return r.json(); },
  setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: t => clearInterval(t) };
/** Shares the existing synchronized worker book. One acknowledged envelope and bounded replacement queue per resolution. */
export class BinanceHeatmapService {
  private groups = new Map<string, Group>(); private clients = new Map<string, string>();
  private release?: () => void; private timer?: ReturnType<typeof setInterval>; private abort?: AbortController;
  private tick: number | null = null; private generation = 0; private batch = 0;
  private book: BinanceDepthBook | null = null; private epoch = 0; private lastBookAt = 0; private metadataError = '';
  readonly stats = { transitions: 0, processingMs: 0, flushMs: 0, publications: 0 };
  constructor(private depth: BinanceDepthService, private emit: (event: Event) => void, private t: HeatmapTransport = transport) {}
  subscribe(id: string, resolution: HeatmapResolution) {
    if (!id || !validResolution(resolution)) return;
    this.unsubscribe(id); const key = heatmapKey(resolution);
    let group = this.groups.get(key);
    if (!group) {
      if (this.groups.size >= HEATMAP_LIMITS.configurations) {
        this.emit({ type: 'heatmap-batch', ids: [id], key, generation: 0, batchId: ++this.batch, snapshot: true, buckets: [], status: { state: 'failed', message: 'Four heatmap resolutions maximum · reuse a resolution or disable another heatmap', tickSize: this.tick, collectionStart: null, retentionStart: null, capacityLimited: true } }); return;
      }
      group = { ids: new Set(), resolution: { ...resolution }, generation: ++this.generation, pending: new Map(), snapshot: true };
      this.groups.set(key, group); this.initialize(group);
    }
    group.ids.add(id); this.clients.set(id, key); group.snapshot = true;
    if (!this.release) {
      this.release = this.depth.observeBook('orderbook-heatmap', (book, now, epoch) => {
        const started = performance.now(); this.stats.transitions++;
        this.book = book; this.lastBookAt = now; this.epoch = epoch;
        for (const g of this.groups.values()) g.collector?.transition(book, now, epoch);
        this.stats.processingMs += performance.now() - started;
      });
      this.timer = this.t.setInterval(() => this.flush(), 500);
    }
    if (this.tick === null && !this.abort) void this.loadMetadata();
    this.publish(key, group);
  }
  retry() { if (this.tick === null && !this.abort && this.groups.size) void this.loadMetadata(); }
  unsubscribe(id: string) {
    const key = this.clients.get(id); this.clients.delete(id); if (!key) return;
    const group = this.groups.get(key); group?.ids.delete(id);
    if (group && !group.ids.size) this.groups.delete(key);
    if (!this.groups.size) { this.release?.(); this.release = undefined; if (this.timer) this.t.clearInterval(this.timer); this.timer = undefined; this.abort?.abort(); this.abort = undefined; this.book = null; }
  }
  ack(key: string, generation: number, batchId: number) {
    const g = this.groups.get(key); if (!g || g.generation !== generation || g.inFlight !== batchId) return;
    g.inFlight = undefined; if (g.snapshot || g.pending.size) this.publish(key, g);
  }
  private async loadMetadata() {
    const controller = new AbortController(); this.abort = controller; this.metadataError = '';
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const raw = await this.t.metadata(controller.signal);
      if (this.abort !== controller || controller.signal.aborted || !this.groups.size) return;
      this.tick = parseBinanceBtcUsdtTickSize(raw);
      if (this.tick === null) throw new Error('Invalid Binance tick metadata');
      for (const g of this.groups.values()) this.initialize(g);
    } catch (e) { if (this.abort === controller && this.groups.size) this.metadataError = e instanceof Error ? `${e.message} · disable/re-enable to retry` : 'Metadata unavailable'; }
    finally { clearTimeout(timeout); if (this.abort === controller) this.abort = undefined; }
  }
  private initialize(g: Group) {
    if (this.tick === null) return;
    if (footprintTicksForPrice(g.resolution.rowPrice, this.tick) === null) { g.message = `Price level must be a multiple of $${this.tick} USDT`; return; }
    g.collector = new LiquidityCollector(g.resolution, this.tick);
    g.collector.transition(this.book, this.t.now(), this.epoch);
  }
  private status(g: Group): HeatmapStatus {
    const stale = !this.book || this.t.now() - this.lastBookAt > 5000;
    const depthStatus = this.depth.getStatus();
    return { state: g.message || this.metadataError ? 'failed' : stale ? depthStatus.state === 'live' ? 'stale' : depthStatus.state === 'unsupported' ? 'failed' : depthStatus.state : g.collector ? 'live' : 'syncing',
      message: g.message || this.metadataError || (!g.collector ? 'Loading exchange tick size…' : stale ? `${depthStatus.message} · gaps remain unknown` : 'Observed resting liquidity · BTC · session only'),
      tickSize: this.tick, collectionStart: g.collector?.collectionStart ?? null, retentionStart: g.collector?.retentionStart ?? null,
      capacityLimited: g.collector?.capacityLimited ?? false };
  }
  flush() {
    const started = performance.now(), now = this.t.now();
    for (const [key, g] of this.groups) {
      if (this.book && now - this.lastBookAt > 5000) g.collector?.transition(null, Math.min(now, this.lastBookAt + 5000), this.epoch);
      else g.collector?.advance(now);
      const start = g.collector?.retentionStart;
      for (const b of g.collector?.changes() ?? []) g.pending.set(b.id, b);
      if (start !== null && start !== undefined) for (const [id, b] of g.pending) if (b.end <= start) g.pending.delete(id);
      this.publish(key, g);
    }
    this.stats.flushMs += performance.now() - started;
  }
  private publish(key: string, g: Group) {
    if (g.inFlight || !g.ids.size) return;
    const batchId = ++this.batch, snapshot = g.snapshot;
    const buckets = snapshot ? g.collector?.snapshot() ?? [] : [...g.pending.values()];
    g.snapshot = false; g.pending.clear(); g.inFlight = batchId; this.stats.publications++;
    this.emit({ type: 'heatmap-batch', key, ids: [...g.ids], generation: g.generation, batchId, snapshot, buckets, status: this.status(g) });
  }
  diagnostics() { return { ...this.stats, configurations: this.groups.size, consumers: this.clients.size, tickSize: this.tick,
    groups: [...this.groups.values()].map(g => ({ ...g.collector?.diagnostics(), subscribers: g.ids.size, pending: g.pending.size, inFlight: g.inFlight !== undefined })) }; }
  dispose() { for (const id of [...this.clients.keys()]) this.unsubscribe(id); }
}

import { FootprintAccumulator } from './footprint';
import { footprintTicksForPrice } from './protocol';
import { duration, footprintKeyOf, keyOf, marketOf, validCandle, type Candle, type Command, type Event, type FootprintBar, type FootprintStatus, type Series } from './protocol';

type Envelope = Extract<Event, { type: 'footprint-status' | 'footprint-snapshot' | 'footprint-patch' }>;
interface Group {
  key: string; series: Series; rowPrice?: number; ids: Set<string>; generation: number;
  abort?: AbortController; busy: boolean; inFlight?: number; pending?: Envelope;
  bars: FootprintBar[]; candles: Candle[]; lastUpdate: number; failures: number; retryAt: number;
  lastStatus?: FootprintStatus; accumulator?: FootprintAccumulator; cursor?: number; from?: number; ws?: WebSocket; streamAt?: number; lastCoverage?: any; lagMs?: number;
}
export const stagingMarket = (series: Series) => series.venue === 'binance' && marketOf(series) === 'perpetual';

/** Worker-owned snapshot restore + durable cursor replay, with bounded shared caches and acknowledged IPC. */
export class StagingFeedService {
  private groups = new Map<string, Group>();
  private clients = new Map<string, string>();
  private sequence = 0; private batch = 0; private online = true;
  private timer: ReturnType<typeof setInterval>; private dead = false;
  constructor(private emit: (event: Event) => void, private request: typeof fetch = (...args) => fetch(...args), private now = Date.now, private socket: (url: string) => WebSocket = url => new WebSocket(url)) {
    this.timer = setInterval(() => this.refresh(), 1000);
  }
  command(c: Command) {
    if (c.type === 'subscribe' || c.type === 'footprint-subscribe') {
      if (!stagingMarket(c.series)) return;
      this.unsubscribe(c.id);
      const rowPrice = c.type === 'footprint-subscribe' ? c.rowPrice : undefined;
      const key = rowPrice === undefined ? keyOf(c.series) : footprintKeyOf(c.series, rowPrice);
      let group = this.groups.get(key);
      if (!group) {
        if (this.groups.size >= 16) return;
        group = { key, series: c.series, rowPrice, ids: new Set(), generation: ++this.sequence,
          busy: false, bars: [], candles: [], lastUpdate: 0, failures: 0, retryAt: 0 };
        this.groups.set(key, group);
      }
      group.ids.add(c.id); this.clients.set(c.id, key);
      if (group.candles.length) this.emit({ type: 'snapshot', key, ids: [c.id], candles: group.candles });
      if (group.bars.length && group.lastStatus) this.publish(group, { type: 'footprint-snapshot', key, ids: [...group.ids], generation: group.generation, batchId: 0, bars: group.bars, retentionStart: group.bars[0]?.time ?? null, status: group.lastStatus });
      this.status(group, 'loading', rowPrice === undefined ? 'Staging · loading native Binance candles' : 'Staging · loading retained aggregate executions');
      if (!group.ws) void this.load(group);
    } else if (c.type === 'unsubscribe' || c.type === 'footprint-unsubscribe') this.unsubscribe(c.id);
    else if (c.type === 'footprint-ack') {
      const g = this.groups.get(c.key);
      if (g?.generation === c.generation && g.inFlight === c.batchId) {
        g.inFlight = undefined; const pending = g.pending; g.pending = undefined;
        if (pending) this.publish(g, pending);
      }
    } else if (c.type === 'retry' || c.type === 'footprint-retry') {
      for (const g of this.groups.values()) if (c.type === 'footprint-retry' || g.ids.has(c.id)) { g.retryAt = 0; g.failures = 0; g.ws?.close(); g.ws = undefined; if (g.rowPrice !== undefined && g.cursor !== undefined) this.connect(g); else void this.load(g); }
    } else if (c.type === 'online') {
      this.online = c.online;
      for (const g of this.groups.values()) {
        if (!c.online) { g.abort?.abort(); g.ws?.close(); g.ws = undefined; this.status(g, 'stale', 'Staging · offline; retained data preserved'); }
        else { g.retryAt = 0; if (g.rowPrice !== undefined && g.cursor !== undefined) this.connect(g); else void this.load(g); }
      }
    }
  }
  private unsubscribe(id: string) {
    const key = this.clients.get(id); this.clients.delete(id); const g = key && this.groups.get(key);
    if (!g) return; g.ids.delete(id);
    if (!g.ids.size) { g.abort?.abort(); g.ws?.close(); g.accumulator?.dispose(); this.groups.delete(g.key); }
  }
  private refresh() {
    for (const g of this.groups.values()) {
      if (g.ws && g.streamAt && this.now() - g.streamAt > 15000) { g.ws.close(); g.ws = undefined; this.status(g, 'stale', 'Staging · stream heartbeat expired; replay pending'); }
      if (!g.ws && this.online && this.now() >= g.retryAt) { if (g.rowPrice !== undefined && g.cursor !== undefined) this.connect(g); else void this.load(g); }
    }
  }
  private connect(g: Group) {
    if (g.ws || !this.online || this.dead || this.groups.get(g.key) !== g) return;
    if (g.rowPrice !== undefined && g.lastUpdate && this.now() - g.lastUpdate >= 4 * 3600000) { g.cursor = undefined; g.accumulator?.dispose(); g.accumulator = undefined; this.status(g, 'loading', 'Staging · resume exceeds bounded replay window; reloading retained history'); void this.load(g); return; }
    try {
      const base = typeof location === 'undefined' ? 'http://127.0.0.1:5173' : location.origin;
      const ws = this.socket(base.replace(/^http/, 'ws') + '/market-data/v1/stream'); g.ws = ws; g.streamAt = this.now();
      ws.onopen = () => { if (g.ws !== ws) return; ws.send(JSON.stringify({ type: 'subscribe', after: g.cursor ?? 0, from: Math.max(g.from ?? this.now() - 900000, this.now() - 4 * 3600000 + 1000), ...(g.rowPrice === undefined ? { interval: g.series.interval } : {}) })); };
      ws.onmessage = event => {
        if (g.ws !== ws || this.dead || !this.online) return;
        try {
          const receivedAt = this.now(); g.streamAt = receivedAt; const data = JSON.parse(String(event.data));
          if (data.type === 'reset') { g.cursor = undefined; g.accumulator?.dispose(); g.accumulator = undefined; throw new Error(data.reason); }
          if (data.type === 'health') {
            const catchingUp = g.rowPrice !== undefined && g.cursor !== undefined && g.cursor < (data.watermark?.id ?? g.cursor);
            const live = !catchingUp && data.collector?.state === 'live' && this.now() - data.collector.lastUpdate < 15000;
            this.status(g, live ? 'live' : catchingUp ? 'reconnecting' : 'stale', `Staging · ${live ? 'streaming' : catchingUp ? 'replaying durable cursor' : 'ingestion recovering/stale'} · delivery ${g.lagMs ?? 0}ms`); return;
          }
          if (g.rowPrice === undefined && data.type === 'native-candle') {
            if (data.source !== 'binance-native-kline' || data.interval !== g.series.interval || !validCandle(data.candle)) throw new Error('Invalid streamed native candle');
            const c = data.candle as Candle; const old = g.candles.find(b => b.t === c.t);
            if (old && old.revision > c.revision) return;
            const map = new Map(g.candles.map(b => [b.t, b])); map.set(c.t, c); g.candles = [...map.values()].sort((a,b) => a.t-b.t).slice(-1000); g.lastUpdate = this.now();
            this.emit({ type: 'patch', key: g.key, ids: [...g.ids], candles: [c] }); this.status(g, 'live', 'Staging · Binance native kline stream'); return;
          }
          if (data.type !== 'executions' || !g.accumulator || data.version !== 1 || data.after !== g.cursor || !Number.isSafeInteger(data.cursor) || data.cursor <= (g.cursor ?? 0) || !Array.isArray(data.executions) || !data.executions.length || data.executions.length > 1000 || !data.coverage) throw new Error('Invalid durable execution batch');
          let previous = g.cursor!;
          for (const t of data.executions) {
            if (!Number.isSafeInteger(t.id) || t.id <= previous || ![t.timeMs,t.price,t.quantity,t.quoteNotional].every(Number.isFinite) || t.price <= 0 || t.quantity <= 0 || !['buy','sell'].includes(t.side)) throw new Error('Invalid execution cursor/values');
            previous = t.id;
          }
          if (previous !== data.cursor) throw new Error('Batch cursor mismatch');
          for (const t of data.executions) { if (t.id !== g.cursor! + 1) g.accumulator.markGap(t.timeMs); g.accumulator.ingest(t); g.cursor = t.id; }
          g.lastUpdate = data.collector.lastUpdate; const priorGaps = g.lastCoverage?.gaps?.filter((x:any)=>x.reason !== 'not yet confirmed by durable execution watermark') ?? []; data.coverage.gaps = [...new Map([...data.coverage.gaps, ...priorGaps].map((x:any)=>[`${x.from}:${x.to}:${x.reason}`,x])).values()].slice(-512);
          g.lastCoverage = data.coverage; g.lagMs = Math.max(0, this.now() - data.sentAt);
          const previousBars = new Map(g.bars.map(b => [b.time,b]));
          const bars = g.accumulator.snapshot();
          g.bars = bars.map(b => { const start=b.time*1000,end=start+duration[g.series.interval]; const gaps=data.coverage.gaps.filter((x:any)=>x.reason !== 'not yet confirmed by durable execution watermark');
            return { ...b, coverage: b.coverage === 'capacity-limited' ? b.coverage : gaps.some((x:any)=>x.to>start&&x.from<end) ? 'gapped' : start>=data.coverage.confirmedFrom && end<=data.coverage.confirmedTo ? 'observed' : 'partial' }; });
          const dirty = new Set(g.accumulator.drainDirty().map(b => b.time));
          const status = this.footprintStatus(g, data.collector.state === 'live' && g.cursor === data.watermark ? 'live' : 'reconnecting', `Staging · durable execution stream · delivery ${g.lagMs}ms`, data); status.transport = { cursor: g.cursor!, backendSentAtMs: data.sentAt, workerReceivedAtMs: receivedAt, workerAppliedAtMs: this.now() }; g.lastStatus = status;
          this.publish(g, { type: 'footprint-patch', key:g.key, ids:[...g.ids], generation:g.generation,batchId:0,bars:g.bars.filter(b=>dirty.has(b.time) || previousBars.get(b.time)?.coverage !== b.coverage),retentionStart:g.bars[0]?.time??null,status });
          ws.send(JSON.stringify({ type:'ack',cursor:g.cursor })); g.failures=0;
        } catch (e) { this.status(g, 'stale', `Staging stream · ${e instanceof Error ? e.message : 'invalid data'} · replay pending`); ws.close(); }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => { if (g.ws !== ws) return; g.ws=undefined; g.failures=Math.min(10,g.failures+1); g.retryAt=this.now()+Math.min(30000,500*2**g.failures); this.status(g,'stale','Staging · disconnected; retained data preserved; cursor replay pending'); };
    } catch (e) { g.retryAt=this.now()+2000; this.status(g,'stale',`Staging stream unavailable · ${String(e)}`); }
  }
  private publish(g: Group, event: Envelope) {
    if (g.inFlight) {
      // Coalescing deltas must retain the latest complete bounded state; an empty
      // later patch cannot erase an update waiting behind an acknowledgement.
      if (event.type === 'footprint-status' && g.pending && g.pending.type !== 'footprint-status') g.pending = { ...g.pending, status: event.status };
      else g.pending = event.type === 'footprint-patch' ? { ...event, type: 'footprint-snapshot', bars: g.bars } : event;
      return;
    }
    const next = { ...event, ids: [...g.ids], batchId: ++this.batch };
    g.inFlight = next.batchId; this.emit(next);
  }
  private footprintStatus(g: Group, state: FootprintStatus['state'], message: string, data?: any): FootprintStatus {
    const coverage = data?.coverage;
    const historicalGaps = coverage?.gaps?.filter((gap: any) => gap.reason !== 'not yet confirmed by durable execution watermark') ?? [];
    return { state, message, lastUpdate: g.lastUpdate, tickSize: data?.tickSize ?? null, rowSize: g.rowPrice ?? null,
      collectionStartedAt: coverage?.confirmedFrom ?? null, firstTradeAt: g.bars[0]?.time ? g.bars[0].time * 1000 : null,
      lastTradeAt: coverage?.confirmedTo ?? null, eventTime: null, outages: historicalGaps.length, capacityDrops: data?.aggregation?.capacityDrops ?? g.accumulator?.drops ?? 0,
      unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0, retentionStart: g.bars[0]?.time ?? null,
      coverage: historicalGaps.length ? 'gapped' : g.bars.some(b => b.coverage === 'capacity-limited') ? 'capacity-limited' : 'partial' };
  }
  private status(g: Group, state: FootprintStatus['state'], message: string) {
    if (g.rowPrice === undefined) this.emit({ type: 'status', key: g.key, ids: [...g.ids], status: { state, message, lastUpdate: g.lastUpdate } });
    else this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0, status: g.lastStatus ? { ...g.lastStatus, state, message } : this.footprintStatus(g, state, message) });
  }
  private async load(g: Group) {
    if (g.busy || !this.online || this.dead || this.now() < g.retryAt) return;
    g.busy = true; const abort = new AbortController(); g.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      // Identical UTC boundaries across timeframe changes; each response captures one committed watermark.
      const to = this.now(), from = Math.floor((to - 15 * 60000) / 60000) * 60000;
      const path = g.rowPrice === undefined ? `/v1/native-candles?interval=${g.series.interval}`
        : `/v1/footprints?from=${from}&to=${to}&interval=${g.series.interval}&rowPrice=${g.rowPrice}`;
      const response = await this.request(`/market-data${path}`, { signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (this.groups.get(g.key) !== g || this.dead || !this.online) return;
      if (g.rowPrice === undefined) {
        if (data.source !== 'binance-native-kline' || !Array.isArray(data.candles) || data.candles.length > 1000 || !data.candles.every(validCandle)) throw new Error('Invalid staging native candles');
        const previous = new Map(g.candles.map(c => [c.t, c]));
        const changes = data.candles.filter((c: Candle) => {
          const old = previous.get(c.t);
          return !old || ['o', 'h', 'l', 'c', 'v', 'closed'].some(field => (old as any)[field] !== (c as any)[field]);
        });
        const initial = !g.candles.length;
        g.candles = data.candles; g.lastUpdate = this.now();
        if (initial || changes.length) this.emit({ type: initial ? 'snapshot' : 'patch', key: g.key, ids: [...g.ids], candles: initial ? g.candles : changes });
        g.cursor = 0; g.from = from; this.status(g, 'live', 'Staging · native Binance candle history loaded; connecting stream');
      } else {
        if (data.version !== 1 || data.source !== 'binance-usdm-aggtrade' || !Array.isArray(data.bars) || data.bars.length > 300 || !data.bars.every(validBackendBar) || !Number.isSafeInteger(data.watermark) || !data.coverage || !Number.isFinite(data.tickSize)) throw new Error('Invalid staging footprint contract');
        const oldBars = g.bars;
        g.bars = data.bars; g.cursor = data.cursor ?? data.watermark; g.from = from;
        const ticks = footprintTicksForPrice(g.rowPrice!, data.tickSize); if (ticks === null) throw new Error('Invalid staging tick size');
        g.accumulator = new FootprintAccumulator(g.series.interval, data.tickSize, ticks); g.accumulator.restore(g.bars);
        g.lastCoverage = data.coverage; g.lastUpdate = Number(data.status?.lastUpdate ?? 0);
        const live = data.status?.state === 'live' && this.now() - g.lastUpdate < 15000;
        const status = this.footprintStatus(g, live ? 'live' : 'stale', `Staging · retained aggTrades · ${g.bars.length} bars · ${data.coverage.gaps.length} coverage gap(s)${live ? '' : ' · ingestion recovering/stale'}`, data);
        g.lastStatus = status;
        const snapshot = !oldBars.length || oldBars[0]?.time !== g.bars[0]?.time;
        const previous = new Map(oldBars.map(b => [b.time, b]));
        const changed = snapshot ? g.bars : g.bars.filter(b => JSON.stringify(previous.get(b.time)) !== JSON.stringify(b));
        this.publish(g, { type: snapshot ? 'footprint-snapshot' : 'footprint-patch', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0, bars: changed, retentionStart: g.bars[0]?.time ?? null, status });
      }
      g.failures = 0; g.retryAt = 0; this.connect(g);
    } catch (error) {
      if (this.groups.get(g.key) !== g || this.dead) return;
      g.failures = Math.min(10, g.failures + 1); g.retryAt = this.now() + Math.min(30000, 1000 * 2 ** g.failures);
      this.status(g, g.bars.length || g.candles.length ? 'stale' : 'failed', `Staging unavailable · ${error instanceof Error ? error.message : 'request failed'} · retrying; Retry available`);
    } finally { clearTimeout(timeout); g.busy = false; g.abort = undefined; }
  }
  diagnostics() { return { source: 'staging', transport: 'websocket', streams: [...this.groups.values()].map(g => ({ key:g.key, cursor:g.cursor, connected:!!g.ws, deliveryMs:g.lagMs, lastHeartbeat:g.streamAt })), groups: this.groups.size, subscriptions: this.clients.size, retainedBars: [...this.groups.values()].reduce((n, g) => n + g.bars.length + g.candles.length, 0) }; }
  dispose() { this.dead = true; clearInterval(this.timer); for (const g of this.groups.values()) { g.abort?.abort(); g.ws?.close(); g.accumulator?.dispose(); } this.groups.clear(); this.clients.clear(); }
}

export function validBackendBar(b: any): b is FootprintBar {
  return b && Number.isSafeInteger(b.time) && b.time > 0 && Number.isSafeInteger(b.revision)
    && ['partial', 'observed', 'gapped', 'capacity-limited'].includes(b.coverage)
    && b.source === 'binance-usdm-aggtrade' && b.granularity === 'aggregate-trade'
    && [b.open, b.high, b.low, b.close, b.delta, b.minDelta, b.maxDelta, b.rowSize].every(Number.isFinite)
    && b.low > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close)
    && Array.isArray(b.cells) && b.cells.length <= 512 && b.cells.every((c: any) => [c.price, c.bidVol, c.askVol, c.bidNotional, c.askNotional].every(Number.isFinite) && c.bidVol >= 0 && c.askVol >= 0 && c.bidNotional >= 0 && c.askNotional >= 0);
}

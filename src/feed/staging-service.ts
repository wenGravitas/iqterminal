import {PreparedFootprints} from './prepared-footprints';
import {historyScheduler} from './history-scheduler';
import { FOOTPRINT_MAX_BARS, FOOTPRINT_MAX_CELLS, FootprintAccumulator } from './footprint';
import { footprintTicksForPrice } from './protocol';
import { duration, footprintAnalysisSourceKey, footprintKeyOf, keyOf, marketOf, validCandle, type Candle, type Command, type Event, type FootprintAnalysisSummary, type FootprintBar, type FootprintStatus, type Series } from './protocol';
import { DEFAULT_DELTA_FLIP_LOOKBACK, MAX_DELTA_FLIP_LOOKBACK, MAX_FOOTPRINT_ANALYSIS_SUMMARIES, durableFootprintAnalysisSummary, withoutLiveFootprintPreview } from '../chart/footprint-delta-flips';

type Envelope = Extract<Event, { type: 'footprint-status' | 'footprint-snapshot' | 'footprint-patch' }>;
interface View {from:number;to:number;candidateFrom:number;key:string;analysisEnabled:boolean;analysisLookback:number;abort?:AbortController;busy?:boolean;loaded?:boolean;validatedAt?:number;}
async function readStagingJson(response:Response,label:string){
  const text=await response.text();let data:any;
  try{data=JSON.parse(text);}catch(error){
    if(!response.ok){const detail=text.trim().replace(/\s+/g,' ').slice(0,180);throw Error(`${label} HTTP ${response.status}${detail?`: ${detail}`:''}`);}
    const incomplete=error instanceof Error&&/unexpected end of json input/i.test(error.message);
    throw Error(`${label} returned ${incomplete?'incomplete':'invalid'} JSON`);
  }
  if(!response.ok){const detail=typeof data?.error==='string'?data.error:text.trim().replace(/\s+/g,' ').slice(0,180);throw Error(`${label} HTTP ${response.status}${detail?`: ${detail}`:''}`);}
  return data;
}
interface Group {
  preparedTimes:Set<number>;views:Map<string,View>;
  key: string; series: Series; rowPrice?: number; ids: Set<string>; generation: number;
  abort?: AbortController; busy: boolean; inFlight?: number; pending?: Envelope;
  bars: FootprintBar[]; candles: Candle[]; lastUpdate: number; failures: number; retryAt: number;
  analysisSummaries: Map<number, FootprintAnalysisSummary>; liveSummaryVersions: Map<number, number>; quoteAvailable: Map<number, boolean>;
  streamRevision: number; appliedExecutionThroughMs: number | null;
  history?: { next: number; target: number; watermark: number }; historyAbort?: AbortController; historyBusy?: boolean; historyError?: string;
  lastStatus?: FootprintStatus; accumulator?: FootprintAccumulator; cursor?: number; from?: number; ws?: WebSocket; streamAt?: number; lastCoverage?: any; lagMs?: number;
}
export const stagingMarket = (series: Series) => series.venue === 'binance';
const NATIVE_CANDLE_HISTORY_TIMEOUT_MS = 60_000;
const FOOTPRINT_BOOTSTRAP_TIMEOUT_MS = 20_000;
const footprintSource = (market: ReturnType<typeof marketOf>) => market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade';

/** Worker-owned snapshot restore + durable cursor replay, with bounded shared caches and acknowledged IPC. */
export class StagingFeedService {
  private prepared:PreparedFootprints;private usePrepared=import.meta.env.VITE_HISTORY_TILES!=='0';
  private groups = new Map<string, Group>();
  private clients = new Map<string, string>();
  private sequence = 0; private batch = 0; private online = true;
  private timer: ReturnType<typeof setInterval>; private dead = false;
  constructor(private emit: (event: Event) => void, private request: typeof fetch = (...args) => fetch(...args), private now = Date.now, private socket: (url: string) => WebSocket = url => new WebSocket(url)) {
    this.prepared=new PreparedFootprints(request);this.timer = setInterval(() => this.refresh(), 1000);
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
        group = { preparedTimes:new Set(),views:new Map(),key, series: c.series, rowPrice, ids: new Set(), generation: ++this.sequence,
          busy: false, bars: [], candles: [], lastUpdate: 0, failures: 0, retryAt: 0,
          analysisSummaries: new Map(), liveSummaryVersions: new Map(), quoteAvailable: new Map(), streamRevision: 0, appliedExecutionThroughMs: null };
        this.groups.set(key, group);
      }
      group.ids.add(c.id); this.clients.set(c.id, key);
      if (group.candles.length) this.emit({ type: 'snapshot', key, ids: [c.id], candles: group.candles });
      if (group.bars.length && group.lastStatus) this.publish(group, { type: 'footprint-snapshot', key, ids: [...group.ids], generation: group.generation, batchId: 0, bars: group.bars, analysisSummaries: [...group.analysisSummaries.values()], retentionStart: group.bars[0]?.time ?? null, status: group.lastStatus });
      this.status(group, 'loading', rowPrice === undefined ? 'Staging · loading native Binance candles' : 'Staging · loading retained aggregate executions');
      if (!group.ws) void this.load(group);
    } else if (c.type === 'footprint-viewport') {
      const key = this.clients.get(c.id), g = key ? this.groups.get(key) : undefined;
      if (!g || g.rowPrice === undefined || !this.usePrepared || !Number.isFinite(c.from) || !Number.isFinite(c.to) || c.from >= c.to) return;
      const step = duration[g.series.interval];
      const to = Math.min(Math.ceil(c.to / step) * step, Math.floor(this.now() / step) * step);
      const from = Math.max(step, Math.floor(Math.max(c.from, c.to - 14_400_000) / step) * step);
      if (from >= to) return;
      const analysisEnabled = c.analysis?.enabled === true;
      const requestedLookback = c.analysis?.lookback;
      const analysisLookback = typeof requestedLookback === 'number' && Number.isFinite(requestedLookback)
        ? Math.max(20, Math.min(MAX_DELTA_FLIP_LOOKBACK, Math.trunc(requestedLookback))) : DEFAULT_DELTA_FLIP_LOOKBACK;
      const rawCandidateFrom = typeof c.analysis?.candidateFrom === 'number' && Number.isFinite(c.analysis.candidateFrom)
        ? c.analysis.candidateFrom : c.from;
      const candidateFrom = Math.max(step, Math.floor(rawCandidateFrom / step) * step);
      const viewKey = `${from}:${to}:${candidateFrom}:${analysisEnabled ? analysisLookback : 0}`;
      const old = g.views.get(c.id);
      if (old?.key === viewKey) return;
      old?.abort?.abort();
      g.views.set(c.id, { from, to, candidateFrom, key: viewKey, analysisEnabled, analysisLookback });
      this.status(g, g.lastStatus?.state ?? 'loading', 'Staging · loading visible footprints');
      if (g.accumulator) void this.loadViewport(g, c.id);
    } else if (c.type === 'unsubscribe' || c.type === 'footprint-unsubscribe') this.unsubscribe(c.id);
    else if (c.type === 'footprint-ack') {
      const g = this.groups.get(c.key);
      if (g?.generation === c.generation && g.inFlight === c.batchId) {
        g.inFlight = undefined; const pending = g.pending; g.pending = undefined;
        if (pending) this.publish(g, pending);
      }
    } else if (c.type === 'retry' || c.type === 'footprint-retry') {
      for (const g of this.groups.values()) if (c.type === 'footprint-retry' || g.ids.has(c.id)) { g.retryAt = 0; g.failures = 0; g.ws?.close(); g.ws = undefined; if (g.rowPrice !== undefined && g.cursor !== undefined) { this.connect(g); if (g.history) void this.loadOlder(g); } else void this.load(g); }
    } else if (c.type === 'online') {
      this.online = c.online;
      for (const g of this.groups.values()) {
        if (!c.online) {for(const v of g.views.values())v.abort?.abort();g.abort?.abort(); g.historyAbort?.abort(); g.ws?.close(); g.ws = undefined; this.status(g, 'stale', 'Staging · offline; retained data preserved'); }
        else { g.retryAt = 0; if (g.rowPrice !== undefined && g.cursor !== undefined) { this.connect(g); if (g.history) void this.loadOlder(g); } else void this.load(g); }
      }
    }
  }
  private unsubscribe(id: string) {
    const key = this.clients.get(id); this.clients.delete(id); const g = key && this.groups.get(key);
    if (!g) return;g.views.get(id)?.abort?.abort();g.views.delete(id);g.ids.delete(id);
    if (!g.ids.size) {for(const v of g.views.values())v.abort?.abort();g.abort?.abort(); g.historyAbort?.abort(); g.ws?.close(); g.accumulator?.dispose(); this.groups.delete(g.key); }
  }
  private refresh() {
    for (const g of this.groups.values()) {
      if (g.rowPrice !== undefined) this.expireLivePreviews(g);
      if (g.ws && g.streamAt && this.now() - g.streamAt > 15000) { g.ws.close(); g.ws = undefined; this.status(g, 'stale', 'Staging · stream heartbeat expired; replay pending'); }
      if (!g.ws && this.online && this.now() >= g.retryAt) { if (g.rowPrice !== undefined && g.cursor !== undefined) { this.connect(g); if (g.history) void this.loadOlder(g); } else void this.load(g); }
      if(this.online&&this.usePrepared&&g.accumulator)for(const [id,v] of g.views)if((!v.loaded||this.now()-(v.validatedAt??0)>30000)&&!v.busy&&this.now()>=g.retryAt)void this.loadViewport(g,id);
      if (this.online && g.history && g.history.next > g.history.target && !g.historyBusy && !g.historyError && g.cursor !== undefined) void this.loadOlder(g);
    }
  }
  private expireLivePreviews(g: Group) {
    const now = this.now();
    let changed = false;
    for (const [time, summary] of g.analysisSummaries) {
      if (!summary.ended && summary.previewEligible && now >= summary.coverageEvidence.toMs) {
        g.analysisSummaries.set(time, { ...summary, previewEligible: false });
        changed = true;
      }
    }
    if (changed) this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation,
      batchId: 0, status: g.lastStatus ?? this.footprintStatus(g, 'loading', 'Staging · updating footprint preview'),
      analysisSummaries: [...g.analysisSummaries.values()] });
  }
  private connect(g: Group) {
    if (g.ws || !this.online || this.dead || this.groups.get(g.key) !== g) return;
    if (g.rowPrice !== undefined && g.lastUpdate && this.now() - g.lastUpdate >= 4 * 3600000) { g.cursor = undefined; g.accumulator?.dispose(); g.accumulator = undefined; this.status(g, 'loading', 'Staging · resume exceeds bounded replay window; reloading retained history'); void this.load(g); return; }
    try {
      const base = typeof location === 'undefined' ? 'http://127.0.0.1:5173' : location.origin;
      const url = new URL('/market-data/v1/stream', base.replace(/^http/, 'ws'));
      if (marketOf(g.series) === 'spot') url.searchParams.set('market', 'spot');
      const ws = this.socket(url.href); g.ws = ws; g.streamAt = this.now();
      ws.onopen = () => { if (g.ws !== ws) return; ws.send(JSON.stringify({ type: 'subscribe', after: g.cursor ?? 0, from: Math.max(g.from ?? this.now() - 900000, this.now() - 4 * 3600000 + 1000), ...(g.rowPrice === undefined ? { interval: g.series.interval } : {}), ...(marketOf(g.series) === 'spot' ? { market: 'spot' } : {}) })); };
      ws.onmessage = event => {
        if (g.ws !== ws || this.dead || !this.online) return;
        try {
          const receivedAt = this.now(); g.streamAt = receivedAt; const data = JSON.parse(String(event.data));
          if (data.type === 'reset') { g.historyAbort?.abort(); g.history = undefined; g.cursor = undefined; g.accumulator?.dispose(); g.accumulator = undefined; g.analysisSummaries.clear(); g.liveSummaryVersions.clear(); g.quoteAvailable.clear(); g.appliedExecutionThroughMs = null; throw new Error(data.reason); }
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
            if (t.market !== undefined && t.market !== marketOf(g.series)) throw new Error('Execution market mismatch');
            previous = t.id;
          }
          if (previous !== data.cursor) throw new Error('Batch cursor mismatch');
          for (const t of data.executions) { if (t.id !== g.cursor! + 1) g.accumulator.markGap(t.timeMs); g.accumulator.ingest({ ...t, quoteNotionalText: String(t.quoteNotional), market: marketOf(g.series) }); g.cursor = t.id; g.appliedExecutionThroughMs = Math.max(g.appliedExecutionThroughMs ?? 0, t.timeMs); }
          g.lastUpdate = data.collector.lastUpdate; const priorGaps = g.lastCoverage?.gaps?.filter((x:any)=>x.reason !== 'not yet confirmed by durable execution watermark') ?? []; data.coverage.gaps = [...new Map([...data.coverage.gaps, ...priorGaps].map((x:any)=>[`${x.from}:${x.to}:${x.reason}`,x])).values()].slice(-512);
          g.lastCoverage = data.coverage; g.lagMs = Math.max(0, this.now() - data.sentAt);
          const caughtUp = g.cursor === data.watermark;
          const streamRevision = ++g.streamRevision;
          const previousBars = new Map(g.bars.map(b => [b.time,b]));
          const bars = g.accumulator.snapshot();
          retainMutableQuoteAvailability(g, bars);
          const liveBars:FootprintBar[] = bars.map(b => {
            if (!g.quoteAvailable.has(b.time)) g.quoteAvailable.set(b.time, hasQuoteProjection(b));
            const source = applyQuoteAvailability(b, g.quoteAvailable.get(b.time) === true);
            const start=source.time*1000,end=start+duration[g.series.interval]; const gaps=data.coverage.gaps.filter((x:any)=>x.reason !== 'not yet confirmed by durable execution watermark');
            return { ...source, coverage: source.coverage === 'capacity-limited' ? source.coverage : gaps.some((x:any)=>x.to>start&&x.from<end) ? 'gapped' : start>=data.coverage.confirmedFrom && end<=data.coverage.confirmedTo ? 'observed' : 'partial' };
          });
          const canPreview = data.collector?.state === 'live' && this.now() - Number(data.collector?.lastUpdate ?? 0) <= 15_000;
          this.updateDurableSummaries(g, liveBars, data.coverage, g.appliedExecutionThroughMs ?? 0, caughtUp, streamRevision, canPreview);
          const liveStart=Math.floor(this.now()/duration[g.series.interval])*duration[g.series.interval];
          const candidates=[...g.bars,...liveBars.filter(b=>b.time*1000>=liveStart||!g.preparedTimes.has(b.time))];g.bars=this.usePrepared?boundedFootprintHistory(candidates,this.visibleTimes(g,candidates)):liveBars;
          const dirty = new Set(g.accumulator.drainDirty().map(b => b.time));
          const status = this.footprintStatus(g, data.collector.state === 'live' && g.cursor === data.watermark ? 'live' : 'reconnecting', `Staging · durable execution stream · delivery ${g.lagMs}ms`, data); status.transport = { cursor: g.cursor!, backendSentAtMs: data.sentAt, workerReceivedAtMs: receivedAt, workerAppliedAtMs: this.now() }; g.lastStatus = status;
          this.publish(g, { type: 'footprint-patch', key:g.key, ids:[...g.ids], generation:g.generation,batchId:0,
            bars:g.bars.filter(b=>dirty.has(b.time) || previousBars.get(b.time)?.coverage !== b.coverage),
            analysisSummaries: [...g.analysisSummaries.values()], retentionStart:g.bars[0]?.time??null,status });
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
      if (event.type === 'footprint-status' && g.pending && g.pending.type !== 'footprint-status') {
        g.pending = { ...g.pending, status: event.status, analysisSummaries: [...g.analysisSummaries.values()] };
      } else if (event.type === 'footprint-patch') {
        g.pending = { ...event, type: 'footprint-snapshot', bars: g.bars, analysisSummaries: [...g.analysisSummaries.values()] };
      } else if (event.type === 'footprint-status' && event.analysisSummaries) {
        g.pending = { ...event, analysisSummaries: [...g.analysisSummaries.values()] };
      } else g.pending = event;
      return;
    }
    const next = { ...event, ids: [...g.ids], batchId: ++this.batch };
    g.inFlight = next.batchId; this.emit(next);
  }
  private footprintStatus(g: Group, state: FootprintStatus['state'], message: string, data?: any): FootprintStatus {
    const coverage = data?.coverage;
    const historicalGaps = coverage?.gaps?.filter((gap: any) => gap.reason !== 'not yet confirmed by durable execution watermark') ?? [];
    return { history:this.historyState(g),state, message: this.historyMessage(g, message), lastUpdate: g.lastUpdate, tickSize: data?.tickSize ?? null, rowSize: g.rowPrice ?? null,
      collectionStartedAt: coverage?.confirmedFrom ?? null, firstTradeAt: g.bars[0]?.time ? g.bars[0].time * 1000 : null,
      lastTradeAt: coverage?.confirmedTo ?? null, eventTime: null, outages: historicalGaps.length, capacityDrops: data?.aggregation?.capacityDrops ?? g.accumulator?.drops ?? 0,
      unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0, retentionStart: g.bars[0]?.time ?? null,
      coverage: historicalGaps.length ? 'gapped' : g.bars.some(b => b.coverage === 'capacity-limited') ? 'capacity-limited' : 'partial' };
  }
  private status(g: Group, state: FootprintStatus['state'], message: string) {
    if (g.rowPrice === undefined) this.emit({ type: 'status', key: g.key, ids: [...g.ids], status: { state, message, lastUpdate: g.lastUpdate } });
    else {
      if (state !== 'live') this.revokeLivePreviews(g);
      const status = g.lastStatus ? { ...g.lastStatus, history:this.historyState(g), state, message: this.historyMessage(g, message) } : this.footprintStatus(g, state, message);
      g.lastStatus = status;
      this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
        status, analysisSummaries: [...g.analysisSummaries.values()] });
    }
  }

  private revokeLivePreviews(g: Group) {
    for (const [time, summary] of g.analysisSummaries) {
      const revoked = withoutLiveFootprintPreview(summary);
      if (revoked !== summary) g.analysisSummaries.set(time, revoked);
    }
  }
  private async load(g: Group) {
    if (g.busy || !this.online || this.dead || this.now() < g.retryAt) return;
    g.busy = true; const abort = new AbortController(); g.abort = abort;
    // A full retained candle history can take about 45s to transfer through the
    // staging tunnel. Keep the short bound for the smaller footprint bootstrap.
    const timeoutMs = g.rowPrice === undefined ? NATIVE_CANDLE_HISTORY_TIMEOUT_MS : FOOTPRINT_BOOTSTRAP_TIMEOUT_MS;
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    try {
      // Identical UTC boundaries across timeframe changes; each response captures one committed watermark.
      const to = this.now(), from = Math.floor((to - 15 * 60000) / duration[g.series.interval]) * duration[g.series.interval];
      const marketQuery = marketOf(g.series) === 'spot' ? '&market=spot' : '';
      const path = g.rowPrice === undefined ? `/v1/native-candles?interval=${g.series.interval}${marketQuery}`
        : `/v1/footprints?from=${from}&to=${to}&interval=${g.series.interval}&rowPrice=${g.rowPrice}${marketQuery}`;
      const response = await this.request(`/market-data${path}`, { signal: abort.signal });
      const data = await readStagingJson(response,'Staging history');
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
        const source = footprintSource(marketOf(g.series));
        if (data.version !== 1 || data.source !== source || !Array.isArray(data.bars) || data.bars.length > 300 || !data.bars.every((bar: unknown) => validBackendBar(bar, marketOf(g.series))) || !Number.isSafeInteger(data.watermark) || !data.coverage || !Number.isFinite(data.tickSize)) throw new Error('Invalid staging footprint contract');
        const oldBars = g.bars;
        g.bars = data.bars; g.cursor = data.cursor ?? data.watermark; g.from = from;
        g.analysisSummaries.clear(); g.liveSummaryVersions.clear(); g.quoteAvailable.clear();
        const caughtUp = g.cursor === data.watermark;
        g.appliedExecutionThroughMs = caughtUp ? data.coverage.confirmedTo
          : Math.max(0, ...g.bars.map(bar => bar.time * 1000));
        for (const bar of g.bars) g.quoteAvailable.set(bar.time, hasQuoteProjection(bar));
        g.bars = g.bars.map(bar => applyQuoteAvailability(bar, g.quoteAvailable.get(bar.time) === true));
        const ticks = footprintTicksForPrice(g.rowPrice!, data.tickSize); if (ticks === null) throw new Error('Invalid staging tick size');
        g.accumulator = new FootprintAccumulator(g.series.interval, data.tickSize, ticks); g.accumulator.restore(g.bars);
        retainMutableQuoteAvailability(g, g.accumulator.snapshot());
        const analysisSourceKey = footprintAnalysisSourceKey(marketOf(g.series), g.series.interval);
        for (const bar of g.bars) this.mergeSummary(g, durableFootprintAnalysisSummary(
          applyQuoteAvailability(bar, g.quoteAvailable.get(bar.time) === true), analysisSourceKey, g.series.interval,
          data.coverage, g.appliedExecutionThroughMs ?? 0, caughtUp, this.now(), data.status?.state === 'live'));
        g.preparedTimes.clear();for(const v of g.views.values()){v.loaded=false;v.validatedAt=undefined;}
        g.lastCoverage = data.coverage; g.lastUpdate = Number(data.status?.lastUpdate ?? 0);
        const live = data.status?.state === 'live' && this.now() - g.lastUpdate < 15000;
        const status = this.footprintStatus(g, live ? 'live' : 'stale', `Staging · retained aggTrades · ${g.bars.length} bars · ${data.coverage.gaps.length} coverage gap(s)${live ? '' : ' · ingestion recovering/stale'}`, data);
        g.lastStatus = status;
        const snapshot = !oldBars.length || oldBars[0]?.time !== g.bars[0]?.time;
        const previous = new Map(oldBars.map(b => [b.time, b]));
        const changed = snapshot ? g.bars : g.bars.filter(b => JSON.stringify(previous.get(b.time)) !== JSON.stringify(b));
        this.publish(g, { type: snapshot ? 'footprint-snapshot' : 'footprint-patch', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
          bars: changed, analysisSummaries: [...g.analysisSummaries.values()], retentionStart: g.bars[0]?.time ?? null, status });
      }
      g.failures = 0; g.retryAt = 0; this.connect(g);
      if (g.rowPrice !== undefined && !this.usePrepared) {
        const step = duration[g.series.interval];
        const end = Math.floor(from / step) * step;
        const target = Math.max(Math.floor((to - (FOOTPRINT_MAX_BARS - 1) * step) / step) * step, Math.floor(data.coverage.confirmedFrom / step) * step);
        g.history = { next: end, target, watermark: data.watermark };
        void this.loadOlder(g);
      }
    } catch (error) {
      if (this.groups.get(g.key) !== g || this.dead) return;
      g.failures = Math.min(10, g.failures + 1); g.retryAt = this.now() + Math.min(30000, 1000 * 2 ** g.failures);
      this.status(g, g.bars.length || g.candles.length ? 'stale' : 'failed', `Staging unavailable · ${error instanceof Error ? error.message : 'request failed'} · retrying; Retry available`);
    } finally { clearTimeout(timeout); g.busy = false; g.abort = undefined; }
  }
  private async loadViewport(g: Group, id: string) {
    const view = g.views.get(id);
    if (!view || view.busy || !g.accumulator) return;
    view.busy = true; view.abort = new AbortController();
    const requestLiveVersion = g.streamRevision;
    const step = duration[g.series.interval];
    // A flip at the first visible candle needs its predecessor plus N reference
    // deltas. Disabled analysis has no offscreen warmup demand.
    const analysisFrom = view.analysisEnabled ? Math.max(step, view.candidateFrom - (view.analysisLookback + 1) * step) : view.from;
    try {
      await this.prepared.load(view.from, view.to, g.series.interval, g.rowPrice!, view.abort.signal,
        (bars, complete, validated, analysis) => {
          if (view.abort!.signal.aborted || g.views.get(id) !== view || this.groups.get(g.key) !== g || !g.accumulator) return;
          if (!bars.every((bar: unknown) => validBackendBar(bar, marketOf(g.series)))) throw Error('Invalid historical footprint bars');
          const beforeBarsKey = barRevisionKey(g.bars);
          const wasLoaded = view.loaded === true;
          const wasValidated = view.validatedAt !== undefined;
          let summariesChanged = false;
          if (analysis) {
            for (const time of analysis.removedTimes) {
              if ((g.liveSummaryVersions.get(time) ?? 0) > requestLiveVersion) continue;
              summariesChanged = g.analysisSummaries.delete(time) || summariesChanged;
            }
            for (const summary of analysis.summaries) {
              if ((g.liveSummaryVersions.get(summary.time) ?? 0) > requestLiveVersion) continue;
              const allowPreview = g.lastStatus?.state === 'live' && this.now() - g.lastStatus.lastUpdate <= 15_000;
              const safeSummary = allowPreview ? summary : withoutLiveFootprintPreview(summary);
              summariesChanged = this.mergeSummary(g, safeSummary) || summariesChanged;
            }
            this.trimAnalysisSummaries(g);
          }
          // Closed viewport responses replace presentation bars only. They never
          // advance the durable live cursor or replace its accumulator state.
          const liveStart = Math.floor(this.now() / step) * step;
          for (const bar of bars) g.preparedTimes.add(bar.time);
          if (complete && validated) for (let at = view.from; at < Math.min(view.to, liveStart); at += step) g.preparedTimes.add(at / 1000);
          // Prepared projections are independent presentation/analysis data.
          // They must not seed the mutable accumulator's quote anchor.
          const presentationBars = bars.map(bar => applyQuoteAvailability(bar, hasQuoteProjection(bar)));
          const candidates = [...g.bars.filter(bar => !complete || !validated || bar.time * 1000 < view.from || bar.time * 1000 >= Math.min(view.to, liveStart)),
            ...presentationBars.filter(bar => bar.time * 1000 < liveStart)];
          g.bars = boundedFootprintHistory(candidates, this.visibleTimes(g, candidates));
          const retained = new Set(g.bars.map(bar => bar.time));
          g.preparedTimes = new Set([...g.preparedTimes].sort((a, b) => Number(retained.has(b)) - Number(retained.has(a)) || b - a).slice(0, FOOTPRINT_MAX_BARS));
          view.loaded = complete; if (complete && validated) view.validatedAt = this.now();
          const status = this.footprintStatus(g, g.lastStatus?.state ?? 'loading',
            `Staging · ${validated ? 'validated' : 'cached; validating'} visible footprints${complete ? '' : ' · loading history'}`,
            { coverage: g.lastCoverage, tickSize: .1 });
          g.lastStatus = status;
          const barsChanged = beforeBarsKey !== barRevisionKey(g.bars);
          if (barsChanged) this.publish(g, { type: 'footprint-snapshot', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
            bars: g.bars, analysisSummaries: [...g.analysisSummaries.values()], retentionStart: g.bars[0]?.time ?? null, status });
          else if (summariesChanged || wasLoaded !== complete || wasValidated !== (complete && validated)) this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
            status, analysisSummaries: [...g.analysisSummaries.values()] });
        }, marketOf(g.series), analysisFrom);
    } catch (error) {
      if (!view.abort.signal.aborted) {
        g.historyError = error instanceof Error ? error.message : String(error); g.retryAt = this.now() + 2000;
        this.status(g, 'stale', `Staging visible footprints · ${g.historyError}`);
      }
    } finally {
      view.busy = false;
    }
  }
  private updateDurableSummaries(g: Group, bars: readonly FootprintBar[], coverage: unknown, appliedThroughMs: number, caughtUp: boolean, streamRevision: number, allowPreview: boolean) {
    const changed: FootprintAnalysisSummary[] = [];
    const sourceKey = footprintAnalysisSourceKey(marketOf(g.series), g.series.interval);
    for (const bar of bars) {
      const summary = durableFootprintAnalysisSummary(bar, sourceKey, g.series.interval, coverage, appliedThroughMs, caughtUp, this.now(), allowPreview);
      if (this.mergeSummary(g, summary)) {
        g.liveSummaryVersions.set(bar.time, streamRevision);
        changed.push(summary);
      }
    }
    this.trimAnalysisSummaries(g);
    return changed;
  }

  private mergeSummary(g: Group, summary: FootprintAnalysisSummary) {
    const previous = g.analysisSummaries.get(summary.time);
    if (previous && previous.revisionSource === summary.revisionSource) {
      if (previous.revision > summary.revision) return false;
      if (previous.revision === summary.revision && summary.revisionSource === 'prepared-content-hash'
        && previous.coverageEvidence.validated && !summary.coverageEvidence.validated) return false;
    }
    if (previous && JSON.stringify(previous) === JSON.stringify(summary)) return false;
    g.analysisSummaries.set(summary.time, summary);
    return true;
  }

  private trimAnalysisSummaries(g: Group) {
    const limit = MAX_FOOTPRINT_ANALYSIS_SUMMARIES;
    if (g.analysisSummaries.size <= limit) return;
    const step = duration[g.series.interval];
    const visible = new Set<number>(), context = new Set<number>();
    for (const view of g.views.values()) {
      for (let at = Math.floor(view.candidateFrom / step) * step; at < view.to; at += step) visible.add(at / 1000);
      if (view.analysisEnabled) for (let at = Math.max(step, view.candidateFrom - (view.analysisLookback + 1) * step); at < view.candidateFrom; at += step) context.add(at / 1000);
    }
    const ordered = [...g.analysisSummaries.keys()].sort((a, b) => Number(visible.has(b)) - Number(visible.has(a))
      || Number(context.has(b)) - Number(context.has(a)) || b - a);
    const keep = new Set(ordered.slice(0, limit));
    for (const time of g.analysisSummaries.keys()) if (!keep.has(time)) g.analysisSummaries.delete(time);
    for (const time of g.liveSummaryVersions.keys()) if (!keep.has(time)) g.liveSummaryVersions.delete(time);
  }

  private visibleTimes(g:Group,bars:FootprintBar[]){return new Set(bars.filter(b=>b.time===g.accumulator?.latestTime||[...g.views.values()].some(v=>b.time*1000>=v.from&&b.time*1000<v.to)).map(b=>b.time));}
  private historyState(g:Group){const views=[...g.views.values()];return {views:views.length,ready:views.every(v=>v.loaded===true),validated:views.every(v=>v.loaded===true&&v.validatedAt!==undefined)};}
  private historyMessage(g: Group, message: string) {
    return message + (g.historyError ? ` · older history incomplete: ${g.historyError} · Retry available` : g.historyBusy ? ` · loading older history (${g.bars.length} bars)` : '');
  }
  /** Load complete, disjoint older bars at one durable watermark; live bars always win. */
  private async loadOlder(g: Group) {
    if (!g.history || g.historyBusy || !this.online || this.dead) return;
    g.historyBusy = true; g.historyError = undefined;
    const abort = new AbortController(); g.historyAbort = abort;
    const step = duration[g.series.interval];
    let pageMs = Math.min(4 * 3600000, Math.max(step, 30 * 60000));
    try {
      while (g.history.next > g.history.target && !abort.signal.aborted && this.online) {
        const history: NonNullable<Group['history']> = g.history;
        const requestLiveVersion = g.streamRevision;
        const to = history.next, from = Math.max(history.target, to - pageMs);
        const marketQuery = marketOf(g.series) === 'spot' ? '&market=spot' : '';
        const path = `/market-data/v1/footprints?from=${from}&to=${to}&interval=${g.series.interval}&rowPrice=${g.rowPrice}&watermark=${history.watermark}${marketQuery}`;
        let data: any;
        for (let attempt = 0; ; attempt++) {
          const r = await this.request(path, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
          data = await r.json();
          if (r.ok) break;
          if (/250000|smaller range/i.test(data.error) && pageMs > step) { pageMs = Math.max(step, Math.floor(pageMs / 2 / step) * step); break; }
          if (/capacity/i.test(data.error) && attempt < 5) { await new Promise<void>(resolve => { const timer = setTimeout(done, Math.min(4000, 500 * 2 ** attempt)); function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); } abort.signal.addEventListener('abort', done, { once: true }); }); if (!abort.signal.aborted) continue; }
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        if (abort.signal.aborted || this.groups.get(g.key) !== g || !g.accumulator || g.history !== history) return;
        if (!data.bars) continue; // Retry the smaller complete-bar page.
        if (data.version !== 1 || data.watermark !== history.watermark || !Array.isArray(data.bars) || data.bars.length > 300 || !data.bars.every((b: any) => validBackendBar(b, marketOf(g.series)) && b.time * 1000 >= from && b.time * 1000 < to)) throw new Error('Invalid older footprint history');
        const analysisSourceKey = footprintAnalysisSourceKey(marketOf(g.series), g.series.interval);
        for (const bar of data.bars as FootprintBar[]) {
          if ((g.liveSummaryVersions.get(bar.time) ?? 0) <= requestLiveVersion) {
            this.mergeSummary(g, durableFootprintAnalysisSummary(bar, analysisSourceKey, g.series.interval,
              data.coverage, Math.min(Number(data.coverage?.confirmedTo ?? 0), g.appliedExecutionThroughMs ?? Infinity), true, this.now(), false));
          }
        }
        this.trimAnalysisSummaries(g);
        const merged = boundedFootprintHistory([...data.bars, ...g.bars]);
        const full = merged.length === FOOTPRINT_MAX_BARS || merged.length < data.bars.length + g.bars.length;
        g.accumulator.restore(merged); retainMutableQuoteAvailability(g, g.accumulator.snapshot()); g.bars = merged; history.next = from;
        const status = this.footprintStatus(g, g.lastStatus?.state ?? 'loading', 'Staging · retained history and durable live executions', { coverage: g.lastCoverage, tickSize: data.tickSize });
        g.lastStatus = status;
        this.publish(g, { type: 'footprint-snapshot', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
          bars: g.bars, analysisSummaries: [...g.analysisSummaries.values()], retentionStart: g.bars[0]?.time ?? null, status });
        if (full) { history.next = history.target; break; }
      }
    } catch (e) { if (!abort.signal.aborted) g.historyError = e instanceof Error ? e.message : 'request failed'; }
    finally {
      g.historyBusy = false;
      if (g.historyAbort === abort) g.historyAbort = undefined;
      if (!this.dead && this.groups.get(g.key) === g && !abort.signal.aborted) this.status(g, g.lastStatus?.state ?? 'live', 'Staging · retained history and durable live executions');
    }
  }
  diagnostics() { return { scheduler:historyScheduler.diagnostics(),source: 'staging', transport: 'websocket', streams: [...this.groups.values()].map(g => ({ key:g.key, cursor:g.cursor, connected:!!g.ws, deliveryMs:g.lagMs, lastHeartbeat:g.streamAt })), groups: this.groups.size, subscriptions: this.clients.size, retainedLiveBars:[...this.groups.values()].reduce((n,g)=>n+(g.accumulator?.barCount??0),0),preparedClosedBars:[...this.groups.values()].reduce((n,g)=>n+g.preparedTimes.size,0),retainedBars: [...this.groups.values()].reduce((n, g) => n + g.bars.length + g.candles.length, 0) }; }
  dispose() { this.prepared.dispose();this.dead = true; clearInterval(this.timer); for (const g of this.groups.values()) { g.abort?.abort(); g.historyAbort?.abort();for(const v of g.views.values())v.abort?.abort();g.ws?.close(); g.accumulator?.dispose(); } this.groups.clear(); this.clients.clear(); }
}

function hasQuoteProjection(bar: FootprintBar) {
  return [bar.quoteDelta, bar.minQuoteDelta, bar.maxQuoteDelta].every(value => typeof value === 'number' && Number.isFinite(value))
    && bar.cells.length > 0
    && bar.cells.every(cell => typeof cell.bidNotional === 'number' && Number.isFinite(cell.bidNotional) && cell.bidNotional >= 0
      && typeof cell.askNotional === 'number' && Number.isFinite(cell.askNotional) && cell.askNotional >= 0);
}

function applyQuoteAvailability(bar: FootprintBar, available: boolean): FootprintBar {
  if (!available) {
    const withoutQuote: FootprintBar = { ...bar, cells: bar.cells.map(cell => {
      const { bidNotional: _bid, askNotional: _ask, ...rest } = cell;
      return rest;
    }) };
    delete withoutQuote.quoteDelta; delete withoutQuote.minQuoteDelta; delete withoutQuote.maxQuoteDelta;
    return withoutQuote;
  }
  return bar;
}

function retainMutableQuoteAvailability(g: Group, bars: readonly FootprintBar[]) {
  const mutableTimes = new Set(bars.map(bar => bar.time));
  for (const time of g.quoteAvailable.keys()) if (!mutableTimes.has(time)) g.quoteAvailable.delete(time);
  for (const bar of bars) if (!g.quoteAvailable.has(bar.time)) g.quoteAvailable.set(bar.time, hasQuoteProjection(bar));
}

function barRevisionKey(bars: readonly FootprintBar[]) {
  return bars.map(bar => `${bar.time}:${bar.revision}`).join('|');
}

export function validBackendBar(b: any, market: ReturnType<typeof marketOf> = 'perpetual'): b is FootprintBar {
  return b && Number.isSafeInteger(b.time) && b.time > 0 && Number.isSafeInteger(b.revision)
    && ['partial', 'observed', 'gapped', 'capacity-limited'].includes(b.coverage)
    && b.source === footprintSource(market) && b.granularity === 'aggregate-trade'
    && [b.open, b.high, b.low, b.close, b.delta, b.minDelta, b.maxDelta, b.rowSize].every(Number.isFinite)
    && b.low > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close)
    && [b.quoteDelta, b.minQuoteDelta, b.maxQuoteDelta].every((value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value)))
    && Array.isArray(b.cells) && b.cells.length <= 512 && b.cells.every((c: any) => [c.price, c.bidVol, c.askVol].every(Number.isFinite)
      && [c.bidNotional, c.askNotional].every((value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0))
      && c.bidVol >= 0 && c.askVol >= 0);
}

/** Whole oldest bars are evicted; a historical response never overwrites a newer live bar. */
export function boundedFootprintHistory(bars: FootprintBar[],visible?:Set<number>): FootprintBar[] {
  if(visible?.size){const candidates=[...new Map(bars.map(b=>[b.time,b])).values()].sort((a,b)=>Number(visible.has(b.time))-Number(visible.has(a.time))||b.time-a.time),kept:FootprintBar[]=[];let cells=0;for(const b of candidates){if(kept.length===FOOTPRINT_MAX_BARS)break;if(cells+b.cells.length>FOOTPRINT_MAX_CELLS)continue;kept.push(b);cells+=b.cells.length;}return kept.sort((a,b)=>a.time-b.time);}
  const sorted = [...new Map(bars.map(b => [b.time, b])).values()].sort((a, b) => a.time - b.time).slice(-FOOTPRINT_MAX_BARS);
  let cells = sorted.reduce((n, b) => n + b.cells.length, 0), start = 0;
  while (cells > FOOTPRINT_MAX_CELLS && start < sorted.length) cells -= sorted[start++]!.cells.length;
  return sorted.slice(start);
}

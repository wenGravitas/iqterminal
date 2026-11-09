import {historyTaskYieldMode} from './history-task-yield';
import {pastCandleViewport,snapCandleViewportBoundary} from './candle-viewport';
import {NativeCandlePresentationCache} from './native-candle-presentation-cache';
import {NativeCandleHistory,type NativeCandleVersion} from './native-candle-history';
import {historyRequestTraces} from './history-trace';
import {PreparedFootprints, type PreparedFootprintProgress} from './prepared-footprints';
import {historyScheduler} from './history-scheduler';
import { FOOTPRINT_MAX_BARS, FOOTPRINT_MAX_CELLS, FootprintAccumulator } from './footprint';
import { footprintTicksForPrice } from './protocol';
import { duration, instrumentKey, instrumentOf, footprintAnalysisSourceKey, footprintKeyOf, keyOf, marketOf, validCandle, type Candle, type Command, type Event, type FootprintAnalysisSummary, type FootprintBar, type FootprintStatus, type Series } from './protocol';
import { DEFAULT_DELTA_FLIP_LOOKBACK, MAX_DELTA_FLIP_LOOKBACK, MAX_FOOTPRINT_ANALYSIS_SUMMARIES, durableFootprintAnalysisSummary, withoutLiveFootprintPreview } from '../chart/footprint-delta-flips';

type Envelope = Extract<Event, { type: 'footprint-status' | 'footprint-snapshot' | 'footprint-patch' }>;
interface View {consumers:Set<string>;retryRequested?:boolean;progress?:PreparedFootprintProgress;error?:string;retryAt?:number;from:number;to:number;candidateFrom:number;key:string;analysisEnabled:boolean;analysisLookback:number;abort?:AbortController;busy?:boolean;loaded?:boolean;validatedAt?:number;}
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
  native?: { readOrder:number;history?:NativeCandleHistory;ready:boolean; error?:string; retryAt:number; failures:number; sequence:number; receivedAt?:number; sourceState?:string; versions:Map<number,{sequence:number;revision:number}> };
  preparedTimes:Set<number>;views:Map<string,View>;
  key: string; series: Series; rowPrice?: number; ids: Set<string>; generation: number;
  abort?: AbortController; busy: boolean; inFlight?: number; pending?: Envelope;
  bars: FootprintBar[]; candles: Candle[]; lastUpdate: number; failures: number; retryAt: number; bootstrapRetry?:boolean;
  analysisSummaries: Map<number, FootprintAnalysisSummary>; liveSummaryVersions: Map<number, number>; quoteAvailable: Map<number, boolean>;
  streamRevision: number; appliedExecutionThroughMs: number | null;
  history?: { next: number; target: number; watermark: number }; historyAbort?: AbortController; historyBusy?: boolean; historyError?: string;
  lastStatus?: FootprintStatus; accumulator?: FootprintAccumulator; cursor?: number; from?: number; ws?: WebSocket; streamAt?: number; lastCoverage?: any; lagMs?: number;
}
/** Whitespace is outside the eligible past range; four hours bounds a request, not a view. */
export function footprintPastViewport(from: number, to: number, now: number, step: number) {
  const range=pastCandleViewport(from,to,now,step);return {from:Math.max(step,range.from),to:range.to};
}

export const stagingMarket = (series: Series) => series.venue === 'binance';
const NATIVE_CANDLE_HISTORY_TIMEOUT_MS = 60_000;
const NATIVE_HISTORY_BULK_MIN_BARS = 32;
const FOOTPRINT_BOOTSTRAP_TIMEOUT_MS = 20_000;
const footprintSource = (market: ReturnType<typeof marketOf>) => market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade';

/** Worker-owned snapshot restore + durable cursor replay, with bounded shared caches and acknowledged IPC. */
export class StagingFeedService {
  private nativePresentation=new NativeCandlePresentationCache();
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
          native: rowPrice === undefined ? {readOrder:0,ready:false,retryAt:0,failures:0,sequence:0,versions:new Map()} : undefined,
          analysisSummaries: new Map(), liveSummaryVersions: new Map(), quoteAvailable: new Map(), streamRevision: 0, appliedExecutionThroughMs: null };
        this.groups.set(key, group);
      }
      if(group.native&&!group.native.history){
        const g=group;
        group.native.history=new NativeCandleHistory(group.series,{request:this.request,now:this.now,presentation:this.nativePresentation,nativeBars:()=>g.candles,
          version:()=>({stream:g.native!.sequence,request:++g.native!.readOrder}),
          apply:(id,bars,version,at)=>this.applyNativeHistory(g,id,bars,version,at),
          changed:()=>{if(!this.dead&&this.groups.get(g.key)===g)this.nativeStatus(g);}});
      }
      group.ids.add(c.id); this.clients.set(c.id, key);
      if (group.candles.length) this.emit({ type: 'snapshot', key, ids: [c.id], candles: group.candles });
      if (group.bars.length && group.lastStatus) this.publish(group, { type: 'footprint-snapshot', key, ids: [...group.ids], generation: group.generation, batchId: 0, bars: group.bars, analysisSummaries: [...group.analysisSummaries.values()], retentionStart: group.bars[0]?.time ?? null, status: group.lastStatus });
      this.status(group, 'loading', rowPrice === undefined ? 'Staging · loading native Binance candles' : 'Staging · loading retained aggregate executions');
      if (group.native) { this.connect(group); if(!group.native.ready)void this.load(group); this.nativeStatus(group); }
      else if (!group.ws) void this.load(group);
    } else if(c.type==='candle-viewport'){
      const key=this.clients.get(c.id),g=key?this.groups.get(key):undefined;
      if(g?.native&&this.usePrepared){g.native.history?.viewport(c.id,c.from,c.to,c.known);this.nativeStatus(g);}
    } else if (c.type === 'footprint-viewport') {
      const key = this.clients.get(c.id), g = key ? this.groups.get(key) : undefined;
      if (!g || g.rowPrice === undefined || !this.usePrepared || !Number.isFinite(c.from) || !Number.isFinite(c.to) || c.from >= c.to) return;
      const step = duration[g.series.interval];
      const { from, to } = footprintPastViewport(c.from, c.to, this.now(), step);
      if (from >= to) return;
      const analysisEnabled = c.analysis?.enabled === true;
      const requestedLookback = c.analysis?.lookback;
      const analysisLookback = typeof requestedLookback === 'number' && Number.isFinite(requestedLookback)
        ? Math.max(20, Math.min(MAX_DELTA_FLIP_LOOKBACK, Math.trunc(requestedLookback))) : DEFAULT_DELTA_FLIP_LOOKBACK;
      const rawCandidateFrom = typeof c.analysis?.candidateFrom === 'number' && Number.isFinite(c.analysis.candidateFrom)
        ? c.analysis.candidateFrom : c.from;
      const candidateFrom = Math.max(step, Math.floor(snapCandleViewportBoundary(rawCandidateFrom,step) / step) * step);
      const viewKey = `${from}:${to}:${candidateFrom}:${analysisEnabled ? analysisLookback : 0}`;
      const old = g.views.get(c.id);
      if (old?.key === viewKey) return;
      this.releaseViewport(g,c.id);
      // The restore preload overlaps its visible chart. Share the same logical
      // demand, including validation/progress, rather than rereading ready chunks.
      const shared=[...g.views.values()].find(view=>view.key===viewKey);
      if(shared){shared.consumers.add(c.id);g.views.set(c.id,shared);this.status(g,g.lastStatus?.state??'loading',g.lastStatus?.message??'Staging · loading visible footprints');return;}
      g.views.set(c.id, {consumers:new Set([c.id]), from, to, candidateFrom, key: viewKey, analysisEnabled, analysisLookback });
      this.status(g, g.lastStatus?.state ?? 'loading', 'Staging · loading visible footprints');
      void this.loadViewport(g, c.id,'viewport');
    } else if (c.type === 'unsubscribe' || c.type === 'footprint-unsubscribe') this.unsubscribe(c.id);
    else if (c.type === 'footprint-ack') {
      const g = this.groups.get(c.key);
      if (g?.generation === c.generation && g.inFlight === c.batchId) {
        g.inFlight = undefined; const pending = g.pending; g.pending = undefined;
        if (pending) this.publish(g, pending);
      }
    } else if (c.type === 'retry' || c.type === 'footprint-retry') {
      const groups=[...this.groups.values()].filter(g=>c.type==='footprint-retry'
        ?g.rowPrice!==undefined&&(!c.id||g.ids.has(c.id)):g.ids.has(c.id));
      const failedViews=(g:Group)=>[...g.views].filter(([id,v])=>v.error&&(c.type!=='footprint-retry'||!c.id||id===c.id));
      const historyOnly=this.usePrepared&&groups.some(g=>failedViews(g).length>0);
      for(const g of groups){
        const failed=this.usePrepared?failedViews(g):[];
        if(failed.length){const retried=new Set<View>();for(const [id,v] of failed){if(retried.has(v)||v.busy)continue;retried.add(v);v.retryAt=0;v.error=undefined;v.loaded=false;v.retryRequested=true;void this.loadViewport(g,id,'retry');}continue;}
        if(historyOnly)continue;
        if(g.native){
          if(c.id&&g.native.history?.progress(c.id)?.retryable){g.native.history.retry(c.id);if(!g.native.error)continue;}
          if(g.native.error){g.native.error=undefined;g.native.retryAt=0;g.native.failures=0;void this.load(g);this.nativeStatus(g);}
          else if(!g.ws){g.retryAt=0;this.connect(g);if(!g.native.ready)void this.load(g);}
          continue;
        }
        if(g.rowPrice!==undefined&&g.cursor===undefined)g.bootstrapRetry=true;
        g.retryAt=0;g.failures=0;g.ws?.close();g.ws=undefined;
        if(g.rowPrice!==undefined&&g.cursor!==undefined){this.connect(g);if(g.history)void this.loadOlder(g);}else void this.load(g);
      }
    } else if (c.type === 'online') {
      this.online = c.online;
      for (const g of this.groups.values()) {
        if (!c.online) {for(const v of g.views.values())v.abort?.abort();g.abort?.abort(); g.historyAbort?.abort(); g.ws?.close(); g.ws = undefined;g.native?.history?.setOnline(false); this.status(g, 'stale', 'Staging · offline; retained data preserved'); }
        else { g.retryAt = 0; if(g.native){this.connect(g);if(!g.native.ready)void this.load(g);g.native.history?.setOnline(true);} else if (g.rowPrice !== undefined && g.cursor !== undefined) { this.connect(g); if (g.history) void this.loadOlder(g); } else void this.load(g); }
      }
    }
  }
  private releaseViewport(g:Group,id:string){
    const view=g.views.get(id);if(!view)return;g.views.delete(id);view.consumers.delete(id);if(!view.consumers.size)view.abort?.abort();
  }
  private unsubscribe(id: string) {
    const key = this.clients.get(id); this.clients.delete(id); const g = key && this.groups.get(key);
    if (!g) return;g.native?.history?.release(id);this.releaseViewport(g,id);g.ids.delete(id);
    if (!g.ids.size) {g.native?.history?.dispose();for(const v of g.views.values())v.abort?.abort();g.abort?.abort(); g.historyAbort?.abort(); g.ws?.close(); g.accumulator?.dispose(); this.groups.delete(g.key); }
  }
  private readonly historyLoadAttempts:Array<{at:number;cause:string;consumer:string;generation:number;from:number;to:number;viewKey:string;previousProgressId?:string;loaded:boolean;validated:boolean}>=[];
  private refresh() {
    this.nativePresentation.expire();
    for (const g of this.groups.values()) {
      if (g.rowPrice !== undefined) this.expireLivePreviews(g);
      if (g.ws && g.streamAt && this.now() - g.streamAt > 15000) { g.ws.close(); g.ws = undefined; this.status(g, 'stale', 'Staging · stream heartbeat expired; replay pending'); }
      if (!g.ws && this.online && this.now() >= g.retryAt) { if(g.native)this.connect(g); else if (g.rowPrice !== undefined && g.cursor !== undefined) { this.connect(g); if (g.history) void this.loadOlder(g); } else void this.load(g); }
      if(g.native&&this.online){
        if(!g.native.ready&&!g.busy&&this.now()>=g.native.retryAt)void this.load(g);
        if(g.ws&&g.native.receivedAt!==undefined&&this.now()-g.native.receivedAt>15000)this.nativeStatus(g);
      }
      if(this.online&&this.usePrepared)for(const [id,v] of g.views)if((!v.loaded||this.now()-(v.validatedAt??0)>30000)&&!v.busy&&this.now()>=(v.retryAt??0))void this.loadViewport(g,id,'refresh');
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
            if(g.native){g.native.sourceState=data.collector?.state;this.nativeStatus(g);return;}
            const catchingUp = g.rowPrice !== undefined && g.cursor !== undefined && g.cursor < (data.watermark?.id ?? g.cursor);
            const live = !catchingUp && data.collector?.state === 'live' && this.now() - data.collector.lastUpdate < 15000;
            this.status(g, live ? 'live' : catchingUp ? 'reconnecting' : 'stale', `Staging · ${live ? 'streaming' : catchingUp ? 'replaying durable cursor' : 'ingestion recovering/stale'} · delivery ${g.lagMs ?? 0}ms`); return;
          }
          if (g.rowPrice === undefined && data.type === 'native-candle') {
            if (data.source !== 'binance-native-kline' || data.interval !== g.series.interval || !validCandle(data.candle)) throw new Error('Invalid streamed native candle');
            const c = data.candle as Candle; const old = g.candles.find(b => b.t === c.t);
            const native=g.native!,version=native.versions.get(c.t);
            // REST revisions are receipt times; compare exchange revisions only
            // with other native events, and never reopen a finalized candle.
            if ((version && version.revision > c.revision) || (old?.closed && (!c.closed || old.revision > c.revision))) return;
            const initial=!g.candles.length;
            native.versions.set(c.t,{sequence:++native.sequence,revision:c.revision});
            const map = new Map(g.candles.map(b => [b.t, b])); map.set(c.t, c); this.retainNative(g,map);
            native.receivedAt=receivedAt;g.lastUpdate=receivedAt;g.failures=0;g.retryAt=0;
            this.emit({ type: initial?'snapshot':'patch', key: g.key, ids: [...g.ids], candles: initial?g.candles:[c],nativeVersion:{stream:native.sequence},...(initial?{merge:true}:{}) }); if(c.closed===true)native.history?.confirmClosed([c]);this.nativeStatus(g); return;
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
    if (g.rowPrice === undefined) {
      const text=message+(g.native?.error?` · history: ${g.native.error} · Retry available`:g.native&&!g.native.ready?' · history loading':'');
      for(const id of g.ids)this.emit({type:'status',key:g.key,ids:[id],status:{state,message:text,lastUpdate:g.lastUpdate,
        ...(g.native?{nativeHistory:{state:g.native.error?'failed' as const:g.native.ready?'ready' as const:'loading' as const,error:g.native.error,loadedBars:g.candles.length,viewport:g.native.history?.progress(id)}}:{})}});
    }
    else {
      if (state !== 'live') this.revokeLivePreviews(g);
      const status = g.lastStatus ? { ...g.lastStatus, history:this.historyState(g), state, message: this.historyMessage(g, message) } : this.footprintStatus(g, state, message);
      g.lastStatus = status;
      this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
        status, analysisSummaries: [...g.analysisSummaries.values()] });
    }
  }

  private nativeStatus(g:Group){
    const native=g.native!;
    const fresh=!!g.ws&&(native.sourceState===undefined||native.sourceState==='live')&&native.receivedAt!==undefined&&this.now()-native.receivedAt<=15000;
    const state=fresh?'live':native.receivedAt!==undefined?'stale':native.error&&!g.candles.length?'failed':'loading';
    this.status(g,state,fresh?'Staging · Binance native candle stream':native.receivedAt!==undefined?'Staging · native candle updates stale; awaiting current data':'Staging · awaiting native candle stream');
  }
  private retainNative(g:Group,map:Map<number,Candle>){
    g.candles=[...map.values()].sort((a,b)=>a.t-b.t).slice(-1000);
    const retained=new Set(g.candles.map(c=>c.t));
    for(const time of g.native!.versions.keys())if(!retained.has(time))g.native!.versions.delete(time);
  }
  private applyNativeHistory(g:Group,id:string,bars:Candle[],version:NativeCandleVersion,at:number){
    if(this.dead||!this.online||this.groups.get(g.key)!==g||!g.ids.has(id))return [];
    const accepted:Candle[]=[],covered:number[]=[],currentByTime=new Map(g.candles.map(c=>[c.t,c]));
    for(const candle of bars){
      const current=currentByTime.get(candle.t),stream=g.native!.versions.get(candle.t);
      // Presentation cannot replace any bar already owned by the native group.
      if(version.request===0&&current)continue;
      if(current?.closed&&!candle.closed)continue;
      if(stream&&(stream.sequence>version.stream||!candle.closed||candle.t+duration[g.series.interval]>at)){
        if(current?.closed)covered.push(candle.t);continue;
      }
      accepted.push(candle);covered.push(candle.t);
    }
    if(accepted.length)this.emit({type:'snapshot',merge:true,nativeVersion:version,key:g.key,ids:[id],candles:accepted});
    return covered;
  }
  private revokeLivePreviews(g: Group) {
    for (const [time, summary] of g.analysisSummaries) {
      const revoked = withoutLiveFootprintPreview(summary);
      if (revoked !== summary) g.analysisSummaries.set(time, revoked);
    }
  }
  private async load(g: Group) {
    if (g.busy || !this.online || this.dead || this.now() < (g.native?.retryAt??g.retryAt)) return;
    g.busy = true; const bootstrapRetry = g.bootstrapRetry === true;
    const nativeSequence=g.native?.sequence??0,nativeRequestedAt=this.now();
    const nativeReadVersion=g.native?{stream:nativeSequence,request:++g.native.readOrder}:undefined;
    const abort = new AbortController(); g.abort = abort;
    // A full retained candle history can take about 45s to transfer through the
    // staging tunnel. Keep the short bound for the smaller footprint bootstrap.
    const timeoutMs = g.rowPrice === undefined ? NATIVE_CANDLE_HISTORY_TIMEOUT_MS : FOOTPRINT_BOOTSTRAP_TIMEOUT_MS;
    let timedOut=false;
    const timeout = setTimeout(() => {timedOut=true;abort.abort();}, timeoutMs);
    try {
      // Identical UTC boundaries across timeframe changes; each response captures one committed watermark.
      const to = this.now(), from = Math.floor((to - 15 * 60000) / duration[g.series.interval]) * duration[g.series.interval];
      const marketQuery = marketOf(g.series) === 'spot' ? '&market=spot' : '';
      const path = g.rowPrice === undefined ? `/v1/native-candles?interval=${g.series.interval}${marketQuery}`
        : this.usePrepared ? `/v2/history/footprint-current?interval=${g.series.interval}&rowPrice=${g.rowPrice}${marketQuery}${bootstrapRetry?'&retry=1':''}`
        : `/v1/footprints?from=${from}&to=${to}&interval=${g.series.interval}&rowPrice=${g.rowPrice}${marketQuery}`;
      const response = await this.request(`/market-data${path}`, { signal: abort.signal });
      const data = await readStagingJson(response,'Staging history');
      if (this.groups.get(g.key) !== g || this.dead || !this.online || abort.signal.aborted) return;
      // Only the request that carried Retry may acknowledge it. A normal poll
      // already in flight must leave a later explicit Retry queued.
      if(g.rowPrice!==undefined&&this.usePrepared&&bootstrapRetry)g.bootstrapRetry=false;
      if (g.rowPrice !== undefined && this.usePrepared && data.state && data.state !== 'ready') {
        g.retryAt = this.now() + 1000;
        this.status(g, data.state === 'unavailable' ? 'failed' : 'loading', data.error ?? 'Staging · preparing authoritative current execution state');
        return;
      }
      if (g.rowPrice === undefined) {
        if (data.source !== 'binance-native-kline' || data.market!==undefined&&data.market!==marketOf(g.series) || data.instrument!==undefined&&data.instrument!==`${instrumentKey(g.series)}:${instrumentOf(g.series).native}` || !Array.isArray(data.candles) || data.candles.length > 1000 || !data.candles.every(validCandle)) throw new Error('Invalid staging native candles');
        const initial=!g.candles.length,map=new Map(g.candles.map(c=>[c.t,c])),changes:Candle[]=[],confirmed:Candle[]=[];
        for(const c of data.candles as Candle[]){
          const old=map.get(c.t),version=g.native!.versions.get(c.t);
          // The REST response has no exchange event cursor. It may repair closed
          // history observed before this request, but cannot replace a stream
          // update received in flight or a live/forming bar with ambiguous order.
          if(old?.closed&&!c.closed)continue;
          if(version&&(version.sequence>nativeSequence||!c.closed||c.t+duration[g.series.interval]>nativeRequestedAt))continue;
          map.set(c.t,c);if(c.closed===true)confirmed.push(c);
          if(!old||['o','h','l','c','v','closed','quoteVolume'].some(field=>(old as any)[field]!==(c as any)[field]))changes.push(c);
        }
        this.retainNative(g,map);g.native!.ready=true;g.native!.error=undefined;g.native!.retryAt=0;g.native!.failures=0;
        // Large historical imports must rebuild the chart series once rather
        // than rebuilding its data/accessibility indexes for every old bar.
        // Merge at the consumer preserves older displayed bars beyond this
        // worker's bounded replay cache; forming source state is already merged.
        const bulk=!initial&&changes.length>=NATIVE_HISTORY_BULK_MIN_BARS;
        if(initial||changes.length)this.emit({type:initial||bulk?'snapshot':'patch',key:g.key,ids:[...g.ids],candles:initial||bulk?g.candles:changes,nativeVersion:nativeReadVersion,...(initial||bulk?{merge:true}:{})});
        g.native!.history?.confirmClosed(confirmed);this.nativeStatus(g);
      } else {
        const source = footprintSource(marketOf(g.series));
        if (data.version !== 1 || data.source !== source || !Array.isArray(data.bars) || data.bars.length > 300 || !data.bars.every((bar: unknown) => validBackendBar(bar, marketOf(g.series))) || !Number.isSafeInteger(data.watermark) || !data.coverage || !Number.isFinite(data.tickSize)) throw new Error('Invalid staging footprint contract');
        const bootstrapBars = data.bars as FootprintBar[];
        g.bars = boundedFootprintHistory([...bootstrapBars, ...g.bars.filter(bar => g.preparedTimes.has(bar.time))]); g.cursor = data.cursor ?? data.watermark; g.from = data.coverage?.from ?? from;
        g.liveSummaryVersions.clear(); g.quoteAvailable.clear();
        const caughtUp = g.cursor === data.watermark;
        g.appliedExecutionThroughMs = caughtUp ? data.coverage.confirmedTo
          : Math.max(0, ...g.bars.map(bar => bar.time * 1000));
        for (const bar of bootstrapBars) g.quoteAvailable.set(bar.time, hasQuoteProjection(bar));
        g.bars = g.bars.map(bar => applyQuoteAvailability(bar, g.preparedTimes.has(bar.time) ? hasQuoteProjection(bar) : g.quoteAvailable.get(bar.time) === true));
        const ticks = footprintTicksForPrice(g.rowPrice!, data.tickSize); if (ticks === null) throw new Error('Invalid staging tick size');
        g.accumulator = new FootprintAccumulator(g.series.interval, data.tickSize, ticks); g.accumulator.restore(bootstrapBars);
        retainMutableQuoteAvailability(g, g.accumulator.snapshot());
        const analysisSourceKey = footprintAnalysisSourceKey(marketOf(g.series), g.series.interval);
        for (const bar of bootstrapBars) if (!g.preparedTimes.has(bar.time)) this.mergeSummary(g, durableFootprintAnalysisSummary(
          applyQuoteAvailability(bar, g.quoteAvailable.get(bar.time) === true), analysisSourceKey, g.series.interval,
          data.coverage, g.appliedExecutionThroughMs ?? 0, caughtUp, this.now(), data.status?.state === 'live'));

        g.lastCoverage = data.coverage; g.lastUpdate = Number(data.status?.lastUpdate ?? 0);
        const live = data.status?.state === 'live' && this.now() - g.lastUpdate < 15000;
        const status = this.footprintStatus(g, live ? 'live' : 'stale', `Staging · retained aggTrades · ${g.bars.length} bars · ${data.coverage.gaps.length} coverage gap(s)${live ? '' : ' · ingestion recovering/stale'}`, data);
        g.lastStatus = status;
        // Authoritative bootstrap replaces the presentation atomically, including
        // retained prepared bars. A live append would auto-follow and move a
        // restored range even when this first forming bar is contiguous.
        this.publish(g, { type: 'footprint-snapshot', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
          bars: g.bars, analysisSummaries: [...g.analysisSummaries.values()], retentionStart: g.bars[0]?.time ?? null, status });
      }
      if(!g.native){g.failures = 0; g.retryAt = 0;} this.connect(g);
      if (g.rowPrice !== undefined && !this.usePrepared) {
        const step = duration[g.series.interval];
        const end = Math.floor(from / step) * step;
        const target = Math.max(Math.floor((to - (FOOTPRINT_MAX_BARS - 1) * step) / step) * step, Math.floor(data.coverage.confirmedFrom / step) * step);
        g.history = { next: end, target, watermark: data.watermark };
        void this.loadOlder(g);
      }
    } catch (error) {
      if (this.groups.get(g.key) !== g || this.dead || (abort.signal.aborted&&!timedOut)) return;
      if(g.native){
        if(!this.online)return;
        g.native.failures=Math.min(10,g.native.failures+1);g.native.retryAt=this.now()+Math.min(30000,1000*2**g.native.failures);
        g.native.error=error instanceof Error?error.message:'request failed';this.nativeStatus(g);return;
      }
      g.failures = Math.min(10, g.failures + 1); g.retryAt = this.now() + Math.min(30000, 1000 * 2 ** g.failures);
      this.status(g, g.bars.length || g.candles.length ? 'stale' : 'failed', `Staging unavailable · ${error instanceof Error ? error.message : 'request failed'} · retrying; Retry available`);
    } finally { clearTimeout(timeout); g.busy = false; g.abort = undefined; }
  }
  private async loadViewport(g: Group, id: string,cause='unspecified') {
    const view = g.views.get(id);
    if (!view || view.busy || !this.online) return;
    if(import.meta.env.VITE_DIAGNOSTICS==='1'){this.historyLoadAttempts.push({at:performance.now(),cause,consumer:id,generation:g.generation,from:view.from,to:view.to,viewKey:view.key,previousProgressId:view.progress?.viewId,loaded:view.loaded===true,validated:view.validatedAt!==undefined});if(this.historyLoadAttempts.length>16)this.historyLoadAttempts.shift();}
    view.busy = true; const abort=new AbortController();view.abort=abort;
    const retry = view.retryRequested === true; view.retryRequested = false;
    const requestLiveVersion = g.streamRevision;
    const step = duration[g.series.interval];
    // A flip at the first visible candle needs its predecessor plus N reference
    // deltas. Disabled analysis has no offscreen warmup demand.
    const analysisFrom = view.analysisEnabled ? Math.max(step, view.candidateFrom - (view.analysisLookback + 1) * step) : view.from;
    try {
      await this.prepared.load(view.from, view.to, g.series.interval, g.rowPrice!, abort.signal,
        (bars, complete, validated, analysis, progress) => {
          if (abort.signal.aborted || !view.consumers.size || this.groups.get(g.key) !== g) return;
          if (!bars.every((bar: unknown) => validBackendBar(bar, marketOf(g.series)))) throw Error('Invalid historical footprint bars');
          if (progress) view.progress = progress;
          view.error = undefined; view.retryAt = 0;
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
              summariesChanged = this.mergeSummary(g, safeSummary, analysis.invalidatedTimes?.includes(summary.time)) || summariesChanged;
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
          const removed = new Set(progress?.slots.filter(slot => slot.validated && slot.state === 'empty').map(slot => slot.from / 1000) ?? []);
          const candidates = [...g.bars.filter(bar => !removed.has(bar.time)),
            ...presentationBars.filter(bar => bar.time * 1000 < liveStart)];
          g.bars = boundedFootprintHistory(candidates, this.visibleTimes(g, candidates));
          const retained = new Set(g.bars.map(bar => bar.time));
          if (view.progress) view.progress = { ...view.progress, capacityLimited: presentationBars.some(bar => !retained.has(bar.time)) };
          if (view.progress?.capacityLimited) { view.loaded = false; view.error = 'Configured footprint bar/cell budget cannot retain the requested view'; view.retryAt = Infinity; }
          g.preparedTimes = new Set([...g.preparedTimes].sort((a, b) => Number(retained.has(b)) - Number(retained.has(a)) || b - a).slice(0, FOOTPRINT_MAX_BARS));
          view.loaded = complete && !view.progress?.capacityLimited; if (view.loaded && validated) view.validatedAt = this.now();
          const status = this.footprintStatus(g, g.lastStatus?.state ?? 'loading',
            g.lastStatus?.message ?? 'Staging · connecting live executions',
            { coverage: g.lastCoverage, tickSize: marketOf(g.series) === 'spot' ? .01 : .1 });
          g.lastStatus = status;
          const barsChanged = beforeBarsKey !== barRevisionKey(g.bars);
          if (barsChanged) this.publish(g, { type: 'footprint-snapshot', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
            bars: g.bars, analysisSummaries: [...g.analysisSummaries.values()], retentionStart: g.bars[0]?.time ?? null, status });
          else if (summariesChanged || wasLoaded !== complete || wasValidated !== (complete && validated)) this.publish(g, { type: 'footprint-status', key: g.key, ids: [...g.ids], generation: g.generation, batchId: 0,
            status, analysisSummaries: [...g.analysisSummaries.values()] });
        }, marketOf(g.series), analysisFrom, retry);
    } catch (error) {
      if (!abort.signal.aborted) {
        view.error = error instanceof Error ? error.message : String(error); view.retryAt = this.now() + 5000;
        this.status(g, g.lastStatus?.state ?? 'loading', g.lastStatus?.message ?? 'Staging · connecting live executions');
      }
    } finally {
      if(view.abort===abort)view.busy = false;
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

  private mergeSummary(g: Group, summary: FootprintAnalysisSummary, invalidate = false) {
    const previous = g.analysisSummaries.get(summary.time);
    if (previous && previous.revisionSource === summary.revisionSource) {
      if (previous.revision > summary.revision) return false;
      if (previous.revision === summary.revision && summary.revisionSource === 'prepared-content-hash'
        && previous.coverageEvidence.validated && !summary.coverageEvidence.validated && !invalidate) return false;
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
  private historyState(g:Group){
    const views=[...new Set(g.views.values())];
    return {views:views.length,ready:views.every(v=>v.loaded===true),validated:views.every(v=>v.loaded===true&&v.validatedAt!==undefined),
      error:views.find(v=>v.error)?.error, ranges:views.map(v=>({from:v.from,to:v.to,progress:v.progress})),
      capacityLimited: views.some(v=>v.progress?.capacityLimited===true)};
  }
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
  diagnostics() { return {historyLoadAttempts:this.historyLoadAttempts.map(attempt=>({...attempt})), nativePresentation:this.nativePresentation.diagnostics(),scheduler:historyScheduler.diagnostics(),requests:historyRequestTraces(),config:{historyTaskYield:historyTaskYieldMode(),dataMode:import.meta.env.VITE_DATA_MODE??'direct',historyTiles:this.usePrepared,build:import.meta.env.VITE_BUILD_COMMIT??'unknown'},views:[...this.groups.values()].flatMap(g=>[...new Set(g.views.values())].map(v=>({key:g.key,consumers:v.consumers.size,from:v.from,to:v.to,loaded:v.loaded,error:v.error,progress:v.progress}))),source: 'staging', transport: 'websocket', streams: [...this.groups.values()].map(g => ({ key:g.key, cursor:g.cursor, connected:!!g.ws, deliveryMs:g.lagMs, lastHeartbeat:g.streamAt, native:g.native?{historyReady:g.native.ready,historyLoading:g.busy,historyError:g.native.error,historyRetryAt:g.native.retryAt,lastCandleReceivedAt:g.native.receivedAt,retainedStreamVersions:g.native.versions.size,viewportHistory:g.native.history?.diagnostics()}:undefined })), groups: this.groups.size, subscriptions: this.clients.size, retainedLiveBars:[...this.groups.values()].reduce((n,g)=>n+(g.accumulator?.barCount??0),0),preparedClosedBars:[...this.groups.values()].reduce((n,g)=>n+g.preparedTimes.size,0),retainedBars: [...this.groups.values()].reduce((n, g) => n + g.bars.length + g.candles.length, 0) }; }
  dispose() { this.nativePresentation.clear();this.prepared.dispose();this.dead = true; clearInterval(this.timer); for (const g of this.groups.values()) { g.abort?.abort(); g.historyAbort?.abort();for(const v of g.views.values())v.abort?.abort();g.ws?.close(); g.accumulator?.dispose();g.native?.history?.dispose(); } this.groups.clear(); this.clients.clear(); }
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

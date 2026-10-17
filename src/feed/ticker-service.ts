import { TICKER_BATCH_LIMIT, TICKER_MAX_WIDGETS, TickerPipeline, tickerConfig, type ClassifiedTrade, type TickerBatch } from '../ticker/model';
import type { Status } from './protocol';
import type { BinanceFootprintService } from './footprint-service';
import type { Market } from './protocol';
type ExecutionFeed = Pick<BinanceFootprintService, 'subscribeExecutions'>;
type ExecutionFeeds = ExecutionFeed | Partial<Record<Market, ExecutionFeed>>;
interface Subscriber { id: string; configRevision: number; gaps: number; generation: number; pipeline: TickerPipeline; pending: ClassifiedTrade[]; status: Status; marketStatuses: Map<Market,Status>; dirty: boolean; dropped: number; inFlight?: number; releases: (() => void)[] }
/** Classify off the UI thread; one shared execution service also owns footprints. */
export class TickerService {
  private subscribers = new Map<string, Subscriber>(); private generation = 0; private batch = 0; private publishedRecords = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private executions: ExecutionFeeds, private emit: (e: TickerBatch) => void, private now = Date.now) {}
  subscribe(id: string, value: unknown, configRevision = 0) {
    this.unsubscribe(id); if (this.subscribers.size >= TICKER_MAX_WIDGETS) return;
    const config = tickerConfig(value), selectedMarkets = [...new Set(config.markets.flatMap(market => market === 'binance:spot' ? ['spot' as const] : market === 'binance:perpetual' ? ['perpetual' as const] : []))];
    const marketStatuses = new Map<Market,Status>(selectedMarkets.map(market => [market,{state:'loading',message:`Waiting for Binance ${market} prints`,lastUpdate:0}]));
    const s: Subscriber = { id, configRevision, gaps: 0, generation: ++this.generation, pipeline: new TickerPipeline(config,this.now()), pending: [], status: { state: 'loading', message: selectedMarkets.length ? 'Collecting reported prints…' : 'Select a supported market', lastUpdate: 0 }, marketStatuses, dirty: true, dropped: 0, releases: [] };
    this.subscribers.set(id,s);
    for (const market of selectedMarkets) {
      const feed = this.executionFeed(market);
      if (!feed) { marketStatuses.set(market,{state:'failed',message:`Binance ${market} execution feed is unavailable`,lastUpdate:0});continue; }
      const consumerId = selectedMarkets.length === 1 ? id : `${id}:${market}`;
      s.releases.push(feed.subscribeExecutions(consumerId, (trades,status,liveSince) => {
        if (this.subscribers.get(id) !== s) return;
        const previous=s.marketStatuses.get(market);if(previous?.state==='live'&&status.state!=='live')s.gaps++;
        s.marketStatuses.set(market,status);s.status=this.combinedStatus(s);s.dirty=true;
        for (const trade of trades) { const record = s.pipeline.accept(trade,this.now(),liveSince); if (!record) continue;
          if (s.pending.length === TICKER_BATCH_LIMIT) { s.pending.shift(); s.dropped++; }
          s.pending.push(record);
        }
      }));
    }
    s.status=this.combinedStatus(s);
    if (!this.timer) this.timer = setInterval(() => this.flush(),100);
    this.flush();
  }
  private executionFeed(market:Market):ExecutionFeed|undefined {
    const source=this.executions as ExecutionFeed & Partial<Record<Market,ExecutionFeed>>;
    return typeof source.subscribeExecutions==='function' ? market==='perpetual'?source:undefined : source[market];
  }
  private combinedStatus(s:Subscriber):Status {
    const statuses=[...s.marketStatuses.entries()];if(!statuses.length)return {state:'loading',message:'Select a supported market',lastUpdate:0};
    const priority:Record<Status['state'],number>={failed:5,stale:4,reconnecting:3,loading:2,live:1};
    statuses.sort((a,b)=>priority[b[1].state]-priority[a[1].state]);const state=statuses[0]![1].state;
    const live=s.marketStatuses.size>0&&[...s.marketStatuses.values()].every(item=>item.state==='live');
    const markets=[...s.marketStatuses.keys()].map(market=>market==='spot'?'Spot':'USD-M Perp');
    const lastUpdate=Math.max(0,...[...s.marketStatuses.values()].map(item=>item.lastUpdate));
    const message=live?`Direct Binance · ${markets.join(' + ')} session prints · no backfill${s.gaps?` · ${s.gaps} connection gap(s)`:''}`:statuses.map(([market,item])=>`${market==='spot'?'Spot':'USD-M Perp'}: ${item.message}`).join(' · ');
    return {state:live?'live':state,message,lastUpdate};
  }
  update(id: string, value: unknown, configRevision: number) {
    const s = this.subscribers.get(id); if (!s) return; const config = tickerConfig(value);
    if (JSON.stringify(config.markets) !== JSON.stringify(s.pipeline.config.markets)) { this.subscribe(id,config,configRevision); return; }
    s.pipeline.config = config; s.configRevision = configRevision; s.generation = ++this.generation; s.inFlight = undefined; s.pending = []; s.dirty = true; this.flush();
  }
  ack(id: string, generation: number, batchId: number) { const s = this.subscribers.get(id); if (s?.generation === generation && s.inFlight === batchId) { s.inFlight = undefined; this.flush(); } }
  flush() { for (const s of this.subscribers.values()) {
    if (s.inFlight || !s.dirty) continue;
    const records = s.pending.splice(0); s.dirty = false;
    // Buffered data can still paint; freshness is rechecked by the notification service on arrival.
    this.publishedRecords += records.length; s.inFlight = ++this.batch; this.emit({ type: 'ticker-batch', ids: [s.id], configRevision: s.configRevision, generation: s.generation, batchId: s.inFlight, records, status: s.status, dropped: s.dropped });
  } }
  unsubscribe(id: string) { const s = this.subscribers.get(id); this.subscribers.delete(id); s?.releases.forEach(release=>release()); if (!this.subscribers.size) { clearInterval(this.timer); this.timer = undefined; } }
  diagnostics() { return { publishedBatches: this.batch, publishedRecords: this.publishedRecords, widgets: this.subscribers.size, subscribers: [...this.subscribers.values()].map(s => ({ id: s.id, pending: s.pending.length, retained: s.pipeline.retained.length, inFlight: Boolean(s.inFlight), dropped: s.dropped })) }; }
  dispose() { for (const id of [...this.subscribers.keys()]) this.unsubscribe(id); }
}

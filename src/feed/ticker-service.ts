import { TICKER_BATCH_LIMIT, TICKER_MAX_WIDGETS, TickerPipeline, tickerConfig, type ClassifiedTrade, type TickerBatch } from '../ticker/model';
import type { Status } from './protocol';
import type { BinanceFootprintService } from './footprint-service';
interface Subscriber { id: string; configRevision: number; gaps: number; generation: number; pipeline: TickerPipeline; pending: ClassifiedTrade[]; status: Status; dirty: boolean; dropped: number; inFlight?: number; release?: () => void }
/** Classify off the UI thread; one shared execution service also owns footprints. */
export class TickerService {
  private subscribers = new Map<string, Subscriber>(); private generation = 0; private batch = 0; private publishedRecords = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private executions: BinanceFootprintService, private emit: (e: TickerBatch) => void, private now = Date.now) {}
  subscribe(id: string, value: unknown, configRevision = 0) {
    this.unsubscribe(id); if (this.subscribers.size >= TICKER_MAX_WIDGETS) return;
    const config = tickerConfig(value), s: Subscriber = { id, configRevision, gaps: 0, generation: ++this.generation, pipeline: new TickerPipeline(config,this.now()), pending: [], status: { state: 'loading', message: config.markets.length ? 'Collecting reported prints…' : 'Select a supported market', lastUpdate: 0 }, dirty: true, dropped: 0 };
    this.subscribers.set(id,s);
    if (config.markets.includes('binance:perpetual')) s.release = this.executions.subscribeExecutions(id, (trades,status,liveSince) => {
      if (this.subscribers.get(id) !== s) return;
      if (s.status.state === 'live' && status.state !== 'live') s.gaps++;
      s.status = { ...status, message: status.state === 'live' ? `Direct Binance · session prints · no backfill${s.gaps ? ` · ${s.gaps} connection gap(s)` : ''}` : status.message }; s.dirty = true;
      for (const trade of trades) { const record = s.pipeline.accept(trade,this.now(),liveSince); if (!record) continue;
        if (s.pending.length === TICKER_BATCH_LIMIT) { s.pending.shift(); s.dropped++; }
        s.pending.push(record);
      }
    });
    if (!this.timer) this.timer = setInterval(() => this.flush(),100);
    this.flush();
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
  unsubscribe(id: string) { const s = this.subscribers.get(id); this.subscribers.delete(id); s?.release?.(); if (!this.subscribers.size) { clearInterval(this.timer); this.timer = undefined; } }
  diagnostics() { return { publishedBatches: this.batch, publishedRecords: this.publishedRecords, widgets: this.subscribers.size, subscribers: [...this.subscribers.values()].map(s => ({ id: s.id, pending: s.pending.length, retained: s.pipeline.retained.length, inFlight: Boolean(s.inFlight), dropped: s.dropped })) }; }
  dispose() { for (const id of [...this.subscribers.keys()]) this.unsubscribe(id); }
}

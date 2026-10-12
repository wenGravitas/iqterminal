import { executionMarkets } from '../markets';
import type { ConnectionKey, Status } from '../feed/protocol';
import type { NormalizedExecution } from '../feed/footprint';
export type TickerUnit = 'BTC' | 'USDT';
export const SOUNDS = ['silent', 'bell', 'chime', 'alarm'] as const;
export type Sound = typeof SOUNDS[number];
export interface Tier { id: string; name: string; minimum: number; unit: TickerUnit; buyColor: string; sellColor: string; bold: boolean; pulse: boolean; sound: Sound; volume: number; toast: boolean }
export const TICKER_COLUMNS = [
  {id:"venueIcon",title:"E",label:"Venue icon",width:28},
  {id:"venue",title:"Venue",label:"Venue",width:68},
  {id:"marketType",title:"Type",label:"Market type",width:42},
  {id:"side",title:"Side",label:"Aggressor side",width:35},
  {id:"price",title:"Price USDT",label:"Price",width:100},
  {id:"quantity",title:"Size BTC",label:"Size BTC",width:100},
  {id:"notional",title:"Notional USDT",label:"Notional USDT",width:120},
] as const;
export type TickerColumn = typeof TICKER_COLUMNS[number]["id"];
/** Editable combo accepts ordinary numbers and compact K/M values. */
export function parseDisplayMinimum(text:string):number|null {
  const match=/^\s*(\d+(?:\.\d*)?|\.\d+)\s*([km]?)\s*$/i.exec(text);
  if(!match)return null;const value=Number(match[1])*(match[2].toLowerCase()==="m"?1e6:match[2].toLowerCase()==="k"?1e3:1);
  return Number.isFinite(value)&&value<=1e12?value:null;
}
export interface TickerConfig { version: 1; columns: TickerColumn[]; markets: ConnectionKey[]; scope: ConnectionKey[]; tiers: Tier[]; displayMinimum: number; displayUnit: TickerUnit; side: 'both' | 'buy' | 'sell' | 'unknown'; muted: boolean; histogram: boolean; histogramSeconds: number; histogramOpacity: number }
export interface ClassifiedTrade { execution: NormalizedExecution; receivedAt: number; tier: Tier | null; notify: boolean }
export interface TickerBatch { type: 'ticker-batch'; ids: string[]; configRevision: number; generation: number; batchId: number; records: ClassifiedTrade[]; status: Status; dropped: number }
export const TICKER_MAX_ROWS = 500, TICKER_BATCH_LIMIT = 256, TICKER_MAX_RECENT = 8192, TICKER_MAX_WIDGETS = 8;
export function defaultTiers(): Tier[] {
  return [0,100000,1000000].map((minimum, i) => ({ id: `tier-${i}`, name: ['Small','Large','Very large'][i], minimum, unit: 'USDT', buyColor: ['#426b4a','#65b873','#85d894'][i], sellColor: ['#79534e','#d17872','#e8a29c'][i], bold: i > 0, pulse: i === 2, sound: (['silent','bell','alarm'] as const)[i], volume: .5, toast: i === 2 }));
}
const finite = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : fallback;
export function validateTiers(value: unknown): Tier[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new Error('Use 1–12 tiers.');
  const ids = new Set<string>(), thresholds = new Set<number>(); let unit: TickerUnit | undefined;
  return value.map((v: any) => {
    if (!v || typeof v.id !== 'string' || !/^[\w-]{1,80}$/.test(v.id) || ids.has(v.id)) throw new Error('Tier identities must be unique.'); ids.add(v.id);
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60) throw new Error('Give each tier a name (up to 60 characters).');
    if (typeof v.minimum !== 'number' || !Number.isFinite(v.minimum) || v.minimum < 0 || v.minimum > 1e12 || thresholds.has(v.minimum)) throw new Error('Thresholds must be positive or zero, finite and unique.'); thresholds.add(v.minimum);
    if (v.unit !== 'BTC' && v.unit !== 'USDT' || unit && unit !== v.unit) throw new Error('One ladder uses one unit: BTC or USDT.'); unit = v.unit;
    if (![v.buyColor,v.sellColor].every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) throw new Error('Choose valid buy and sell colours.');
    if (typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1) throw new Error('Sound volume must be between 0 and 1.');
    if (!SOUNDS.includes(v.sound)) throw new Error('Unknown sound.');
    return { id: v.id, name: v.name.trim(), minimum: v.minimum, unit: v.unit, buyColor: v.buyColor, sellColor: v.sellColor,
      bold: v.bold === true, pulse: v.pulse === true, sound: v.sound, volume: finite(v.volume,.5,1), toast: v.toast === true };
  }).sort((a,b) => a.minimum-b.minimum);
}
export function tickerConfig(value: unknown): TickerConfig {
  const v = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  const selected = Object.hasOwn(v,'markets') ? executionMarkets(v.markets) : ['binance:perpetual' as const];
  let tiers = defaultTiers(); try { if (v.tiers) tiers = validateTiers(v.tiers); } catch { /* recover corrupt persisted tiers */ }
  return { version: 1, columns: TICKER_COLUMNS.filter(col=>!Array.isArray(v.columns)||v.columns.includes(col.id)).map(col=>col.id), markets: selected, scope: Object.hasOwn(v,'scope') ? executionMarkets(v.scope) : [...selected], tiers,
    displayMinimum: finite(v.displayMinimum,0,1e12), displayUnit: v.displayUnit === 'BTC' ? 'BTC' : 'USDT',
    side: v.side === 'buy' || v.side === 'sell' || v.side === 'unknown' ? v.side : 'both', muted: v.muted === true, histogram: v.histogram !== false, histogramSeconds: Math.max(5,Math.round(finite(v.histogramSeconds,60,300))), histogramOpacity: finite(v.histogramOpacity,.18,.6) };
}
export function tradeSize(e: NormalizedExecution, unit: TickerUnit) { return unit === 'BTC' ? e.quantity : e.quantity * e.price; }
export function classify(e: NormalizedExecution, config: TickerConfig): Tier | null {
  const market = `${e.venue}:${e.market}`;
  if (!config.scope.includes(market as ConnectionKey)) return null;
  if (e.nativeSymbol !== 'BTCUSDT' || e.venue !== 'binance') return null;
  let winner: Tier | null = null;
  for (const tier of config.tiers) if (tradeSize(e,tier.unit) >= tier.minimum && (!winner || tier.minimum > winner.minimum)) winner = tier;
  return winner;
}
export function displayed(e: NormalizedExecution, c: TickerConfig) { return c.markets.includes(`${e.venue}:${e.market}` as ConnectionKey) && (c.side === 'both' || e.side === c.side) && tradeSize(e,c.displayUnit) >= c.displayMinimum; }
/** No presentation filters or pause state are inputs to classification. */
export class TickerPipeline {
  readonly retained: ClassifiedTrade[] = []; private recent = new Set<string>();
  constructor(public config: TickerConfig, private startedAt: number) {}
  accept(execution: NormalizedExecution, now: number, liveSince: number): ClassifiedTrade | null {
    if (this.recent.has(execution.executionId) || !this.config.markets.includes(`${execution.venue}:${execution.market}` as ConnectionKey)) return null;
    this.recent.add(execution.executionId); if (this.recent.size > TICKER_MAX_RECENT) this.recent.delete(this.recent.values().next().value!);
    const record = { execution, receivedAt: now, tier: classify(execution,this.config), notify: execution.timeMs >= Math.max(this.startedAt,liveSince) && now-execution.timeMs <= 3000 && execution.timeMs-now <= 1000 };
    this.retained.push(record); if (this.retained.length > TICKER_MAX_ROWS) this.retained.shift(); return record;
  }
}
/** UI scrolling pauses a snapshot, not ingestion. */
export class TickerTape {
  rows: ClassifiedTrade[] = []; private frozen: ClassifiedTrade[] | null = null; private frozenAt: number | null = null;
  ingest(records: ClassifiedTrade[]) { this.rows.push(...records); if (this.rows.length > TICKER_MAX_ROWS) this.rows.splice(0,this.rows.length-TICKER_MAX_ROWS); }
  pause(now=Date.now()) { this.frozen = [...this.rows]; this.frozenAt=now; }
  live() { this.frozen = null; this.frozenAt=null; }
  snapshot(now=Date.now()) { return { records: this.frozen ?? this.rows, now: this.frozenAt ?? now }; }
  get paused() { return this.frozen !== null; }
  visible(config: TickerConfig) { return (this.frozen ?? this.rows).filter(r => displayed(r.execution,config)).slice(-100).reverse(); }
}

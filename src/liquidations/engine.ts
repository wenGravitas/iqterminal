import { LIQUIDATION_MAX_EVENTS, liquidationValue, type LiquidationEvent, type LiquidationVenue, type LiquidatedSide } from './model';
import type { BurstRule, LiquidationSettings } from './settings';

export class LiquidationCache {
  readonly events = new Map<string,LiquidationEvent>();
  dropped = 0;
  merge(values: readonly LiquidationEvent[]) {
    let changed = false;
    for (const event of values) if (!this.events.has(event.id)) { this.events.set(event.id,event); changed = true; }
    if (this.events.size > LIQUIDATION_MAX_EVENTS) {
      const sorted = this.sorted(); const excess = sorted.length - LIQUIDATION_MAX_EVENTS;
      for (const event of sorted.slice(0,excess)) this.events.delete(event.id);
      this.dropped += excess;
    }
    return changed;
  }
  sorted() { return [...this.events.values()].sort((a,b)=>a.timeMs-b.timeMs || a.id.localeCompare(b.id)); }
  clear() { this.events.clear(); }
}
export interface LiquidationBar { time: number; longs: Record<LiquidationVenue,number>; shorts: Record<LiquidationVenue,number>; count: number }
export function selectedLiquidation(event: LiquidationEvent, settings: Pick<LiquidationSettings,'venues'|'side'|'minimum'|'units'>) {
  const value = liquidationValue(event,settings.units);
  return settings.venues.includes(event.venue) && (settings.side === 'BOTH' || settings.side === event.liquidatedSide) && (value === null ? settings.minimum === 0 : value >= settings.minimum);
}
/** Millisecond UTC bucket boundaries, independent of browser timezone or arrival order. */
export function liquidationBars(events: readonly LiquidationEvent[], settings: LiquidationSettings, intervalMs: number): LiquidationBar[] {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw Error('Invalid liquidation candle interval');
  const bars = new Map<number,LiquidationBar>();
  for (const event of events) if (selectedLiquidation(event,settings) && liquidationValue(event,settings.units) !== null) {
    const time = Math.floor(event.timeMs/intervalMs)*intervalMs;
    let bar = bars.get(time); if (!bar) { bar={ time,longs:{bybit:0,binance:0},shorts:{bybit:0,binance:0},count:0 }; bars.set(time,bar); }
    bar[event.liquidatedSide==='LONG'?'longs':'shorts'][event.venue] += liquidationValue(event,settings.units)!; bar.count++;
  }
  return [...bars.values()].sort((a,b)=>a.time-b.time);
}
export function liquidationSummary(events: readonly LiquidationEvent[], venues: readonly LiquidationVenue[], now: number) {
  return [60000,300000,900000].map(windowMs=>{
    let longs=0,shorts=0,unknown=0,count=0;
    for (const event of events) if (venues.includes(event.venue) && event.timeMs > now-windowMs && event.timeMs <= now) {
      if (event.quoteNotional === null) unknown++; else if(event.liquidatedSide==='LONG') longs+=event.quoteNotional; else shorts+=event.quoteNotional;
      count++;
    }
    return {windowMs,longs,shorts,total:longs+shorts,count,unknown,ratio:shorts>0?longs/shorts:null};
  });
}
export interface LiquidationBurst { id: string; side: LiquidatedSide; from: number; to: number; notional: number; count: number; venues: Partial<Record<LiquidationVenue,number>>; events: LiquidationEvent[]; notify: boolean }
/** A continuing cluster has one identity until an event-time quiet gap exceeds
 * its window. Cooldown suppresses alerts, never cluster visibility. */
export class LiquidationBurstDetector {
  private recent = new Map<string,LiquidationEvent>();
  private active = new Map<LiquidatedSide,LiquidationBurst>();
  private lastAlert = new Map<LiquidatedSide,number>();
  private clock = 0;
  readonly bursts: LiquidationBurst[] = [];
  ingest(event: LiquidationEvent, rule: BurstRule, eligible: boolean, now: number) {
    if (this.recent.has(event.id) || event.quoteNotional === null) return;
    this.clock=Math.max(this.clock,event.timeMs);
    if (event.timeMs < this.clock-rule.windowMs) return;
    this.recent.set(event.id,event);
    for (const [id,e] of this.recent) if(e.timeMs<this.clock-rule.windowMs)this.recent.delete(id);
    while(this.recent.size>4096)this.recent.delete(this.recent.keys().next().value!);
    const existing=this.active.get(event.liquidatedSide);
    if (existing && event.timeMs > existing.to+rule.windowMs) this.active.delete(event.liquidatedSide);
    let burst=this.active.get(event.liquidatedSide);
    if(burst){
      burst.events.push(event);if(burst.events.length>500)burst.events.shift();burst.count++;burst.notional+=event.quoteNotional;burst.venues[event.venue]=(burst.venues[event.venue]??0)+event.quoteNotional;
      burst.from=Math.min(burst.from,event.timeMs);burst.to=Math.max(burst.to,event.timeMs);burst.notify=false;return burst;
    }
    const events=[...this.recent.values()].filter(e=>e.liquidatedSide===event.liquidatedSide&&e.timeMs>=this.clock-rule.windowMs).sort((a,b)=>a.timeMs-b.timeMs||a.id.localeCompare(b.id));
    const notional=events.reduce((n,e)=>n+e.quoteNotional!,0);
    if(events.length<rule.count||notional<rule.minimum)return;
    const venues:LiquidationBurst['venues']={};for(const e of events)venues[e.venue]=(venues[e.venue]??0)+e.quoteNotional!;
    const fresh=eligible&&rule.alerts&&now-event.timeMs<=3000&&event.timeMs-now<=1000&&now-(this.lastAlert.get(event.liquidatedSide)??-Infinity)>=rule.cooldownMs;
    burst={id:`burst:${event.liquidatedSide}:${events[0]!.id}`,side:event.liquidatedSide,from:events[0]!.timeMs,to:events.at(-1)!.timeMs,notional,count:events.length,venues,events:[...events],notify:fresh};
    this.active.set(event.liquidatedSide,burst);this.bursts.push(burst);if(this.bursts.length>16)this.bursts.shift();
    if(fresh)this.lastAlert.set(event.liquidatedSide,now);
    return burst;
  }
}

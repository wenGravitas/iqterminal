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
export type LiquidationBurstState = 'active' | 'completed' | 'uncertain';
export interface LiquidationBurstBucket { from:number; to:number; notional:number; count:number; venues:Partial<Record<LiquidationVenue,number>> }
export interface LiquidationBurst {
  id:string; side:LiquidatedSide; from:number; to:number; notional:number; count:number;
  venues:Partial<Record<LiquidationVenue,number>>; events:LiquidationEvent[]; notify:boolean;
  state:LiquidationBurstState; closedAt:number|null; quality:'complete'|'partial'; coverageGap:boolean; retainedEventCount:number;
  histogram:LiquidationBurstBucket[]; histogramStepMs:number;
}
export interface LiquidationBurstCoverageProof {
  healthy:boolean; observedFrom:number; verifiedThrough:number; gaps:readonly {from:number;to:number}[];
}
export const liquidationBurstDurationMs=(burst:Pick<LiquidationBurst,'from'|'to'>)=>Math.max(0,burst.to-burst.from);
/** Fixed burst-only background reference: $10m reported USDT maps to full width. */
export const LIQUIDATION_BURST_BACKGROUND_REFERENCE_USDT=10_000_000;
export const liquidationBurstBackgroundWidth=(notional:number)=>Math.max(0,Math.min(100,notional/LIQUIDATION_BURST_BACKGROUND_REFERENCE_USDT*100));
/** A sub-second span is intentionally not assigned an arbitrary rate. */
export const liquidationBurstAveragePerSecond=(burst:Pick<LiquidationBurst,'from'|'to'|'notional'>)=>{
  const duration=liquidationBurstDurationMs(burst);return duration>=1000?burst.notional/(duration/1000):null;
};
export const liquidationBurstHistogram=(burst:Pick<LiquidationBurst,'notional'|'histogram'>)=>burst.histogram.map(bucket=>({
  ...bucket,durationMs:Math.max(1,bucket.to-bucket.from),ratePerSecond:bucket.notional/Math.max(1,(bucket.to-bucket.from)/1000),
  shareOfReportedNotional:burst.notional>0?bucket.notional/burst.notional:null,
}));
const BURST_RECENT_LIMIT=4096,BURST_SEEN_LIMIT=LIQUIDATION_MAX_EVENTS,BURST_EVENT_LIMIT=500,BURST_HISTOGRAM_LIMIT=128,BURST_SUMMARY_LIMIT=32,BURST_HISTOGRAM_STEP=1000;
const assumedProof=(time:number):LiquidationBurstCoverageProof=>({healthy:true,observedFrom:-Infinity,verifiedThrough:time,gaps:[]});
function provesQuiet(burst:LiquidationBurst,rule:BurstRule,proof:LiquidationBurstCoverageProof){
  const through=burst.to+rule.windowMs;
  return proof.healthy&&proof.observedFrom<=burst.to&&proof.verifiedThrough>through&&!proof.gaps.some(gap=>gap.from<through&&gap.to>burst.to);
}
function gapTouchesBurst(burst:LiquidationBurst,through:number,proof:LiquidationBurstCoverageProof){return proof.gaps.some(gap=>gap.from<through&&gap.to>burst.from);}
function addBurstReport(burst:LiquidationBurst,event:LiquidationEvent){
  const value=event.quoteNotional;if(value===null)return;
  burst.events.push(event);if(burst.events.length>BURST_EVENT_LIMIT)burst.events.shift();burst.retainedEventCount=burst.events.length;
  burst.count++;burst.notional+=value;burst.venues[event.venue]=(burst.venues[event.venue]??0)+value;
  burst.from=Math.min(burst.from,event.timeMs);burst.to=Math.max(burst.to,event.timeMs);burst.notify=false;
  const step=burst.histogramStepMs,start=Math.floor(event.timeMs/step)*step,end=start+step;
  let bucket=burst.histogram.find(row=>event.timeMs>=row.from&&event.timeMs<row.to);
  if(!bucket){bucket={from:start,to:end,notional:0,count:0,venues:{}};const at=burst.histogram.findIndex(row=>row.from>start);if(at<0)burst.histogram.push(bucket);else burst.histogram.splice(at,0,bucket);}
  bucket.notional+=value;bucket.count++;bucket.venues[event.venue]=(bucket.venues[event.venue]??0)+value;
  while(burst.histogram.length>BURST_HISTOGRAM_LIMIT)rebinBurstHistogram(burst,burst.histogramStepMs*2);
}
function rebinBurstHistogram(burst:LiquidationBurst,step:number){
  const buckets=new Map<number,LiquidationBurstBucket>();
  for(const row of burst.histogram){
    const from=Math.floor(row.from/step)*step;let bucket=buckets.get(from);
    if(!bucket){bucket={from,to:from+step,notional:0,count:0,venues:{}};buckets.set(from,bucket);}
    bucket.notional+=row.notional;bucket.count+=row.count;
    for(const venue of ['bybit','binance'] as const)if(row.venues[venue]!==undefined)bucket.venues[venue]=(bucket.venues[venue]??0)+row.venues[venue]!;
  }
  burst.histogram=[...buckets.values()].sort((a,b)=>a.from-b.from);burst.histogramStepMs=step;
}
/** A continuing cluster keeps one identity; only verified quiet can confirm its end. */
export class LiquidationBurstDetector {
  private recent=new Map<string,LiquidationEvent>();private seen=new Map<string,true>();private active=new Map<LiquidatedSide,LiquidationBurst>();
  private completed:LiquidationBurst[]=[];private lastAlert=new Map<LiquidatedSide,number>();private clock=0;
  get bursts(){return [...this.active.values(),...this.completed].sort((a,b)=>a.to-b.to||a.id.localeCompare(b.id));}
  get activeBursts(){return [...this.active.values()].sort((a,b)=>a.side.localeCompare(b.side));}
  ingest(event:LiquidationEvent,rule:BurstRule,eligible:boolean,now:number,proof=assumedProof(event.timeMs)){
    if(this.seen.has(event.id)||event.quoteNotional===null)return;
    this.clock=Math.max(this.clock,event.timeMs);if(event.timeMs<this.clock-rule.windowMs)return;
    this.seen.set(event.id,true);while(this.seen.size>BURST_SEEN_LIMIT)this.seen.delete(this.seen.keys().next().value!);
    this.recent.set(event.id,event);for(const[id,row]of this.recent)if(row.timeMs<this.clock-rule.windowMs)this.recent.delete(id);
    while(this.recent.size>BURST_RECENT_LIMIT)this.recent.delete(this.recent.keys().next().value!);
    const side=event.liquidatedSide;
    // Check ended rows before the current side slot: a late report from an
    // older cluster must never be appended to a newer active burst.
    const late=[...this.completed].reverse().find(row=>row.side===side&&event.timeMs>=row.from&&event.timeMs<=row.to+rule.windowMs);
    if(late){
      const oldTo=late.to;addBurstReport(late,event);
      if(event.timeMs>oldTo){
        if(!this.active.has(side)){late.state='active';late.closedAt=null;this.completed=this.completed.filter(row=>row!==late);this.active.set(side,late);}
        else{late.state='uncertain';late.closedAt=Math.max(late.closedAt??0,event.timeMs);late.quality='partial';}
      }
      return late;
    }
    let burst=this.active.get(side);
    if(burst&&event.timeMs>burst.to+rule.windowMs){
      const gap=gapTouchesBurst(burst,burst.to+rule.windowMs,proof);if(gap)burst.coverageGap=true;
      const complete=provesQuiet(burst,rule,proof),quality=burst.coverageGap||gap||!complete?'partial':'complete';
      this.close(burst,complete?'completed':'uncertain',event.timeMs,quality);
      burst=undefined;
    }
    if(burst){addBurstReport(burst,event);burst.state='active';return burst;}
    const events=[...this.recent.values()].filter(row=>row.liquidatedSide===side&&row.timeMs>=this.clock-rule.windowMs).sort((a,b)=>a.timeMs-b.timeMs||a.id.localeCompare(b.id));
    const notional=events.reduce((sum,row)=>sum+row.quoteNotional!,0);if(events.length<rule.count||notional<rule.minimum)return;
    const fresh=eligible&&rule.alerts&&now-event.timeMs<=3000&&event.timeMs-now<=1000&&now-(this.lastAlert.get(side)??-Infinity)>=rule.cooldownMs;
    const id=`burst:${side}:${events[0]!.id}`;
    burst={id,side,from:events[0]!.timeMs,to:events.at(-1)!.timeMs,notional:0,count:0,venues:{},events:[],notify:fresh,state:'active',closedAt:null,quality:proof.healthy?'complete':'partial',coverageGap:false,retainedEventCount:0,histogram:[],histogramStepMs:BURST_HISTOGRAM_STEP};
    for(const row of events)addBurstReport(burst,row);burst.notify=fresh;
    this.active.set(side,burst);
    if(fresh)this.lastAlert.set(side,now);return burst;
  }
  advance(now:number,rule:BurstRule,proof:LiquidationBurstCoverageProof){
    const closed:LiquidationBurst[]=[];
    for(const burst of [...this.active.values()]){
      if(gapTouchesBurst(burst,burst.to+rule.windowMs,proof)){burst.coverageGap=true;burst.quality='partial';}
      if(now<=burst.to+rule.windowMs)continue;
      if(!provesQuiet(burst,rule,proof)){burst.quality='partial';burst.state='uncertain';continue;}
      // Once the observed interval was partial, a later quiet heartbeat may
      // close the row but cannot repair missing coverage retroactively.
      this.close(burst,'completed',burst.to+rule.windowMs+1,burst.quality);closed.push(burst);
    }
    return closed;
  }
  private close(burst:LiquidationBurst,state:'completed'|'uncertain',closedAt:number,quality:'complete'|'partial'){
    this.active.delete(burst.side);burst.state=state;burst.closedAt=closedAt;burst.quality=quality;burst.notify=false;
    this.completed=this.completed.filter(row=>row.id!==burst.id);this.completed.push(burst);this.completed.sort((a,b)=>a.to-b.to||a.id.localeCompare(b.id));
    while(this.completed.length>BURST_SUMMARY_LIMIT)this.completed.shift();
  }
}

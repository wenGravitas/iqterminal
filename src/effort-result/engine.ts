import type { NormalizedExecution } from '../feed/footprint';
import { DETECTOR_VERSION, calculationSettings, sourceKey, type EffortSettings, type EffortSource } from './settings';
export const W=30000, MAX_LEVELS=2048, MAX_IDS=131072, MAX_EVENTS=2048, MAX_POINTS=7200;
interface Cell { buy:number;sell:number;unknown:number;buyFirst:number;buyLast:number;sellFirst:number;sellLast:number }
export interface Second { start:number;open:number;close:number;high:number;low:number;buy:number;sell:number;unknown:number;valid:boolean;receivedFirst?:number;receivedLast?:number;levels:[number,Cell][] }
interface MutableSecond extends Omit<Second,'levels'> { levels:Map<number,Cell>;first:number;last:number;boundary?:number }
export interface Reference { start:number;end:number;buy:number;sell:number;range:number }
export interface Evidence { windowStart:number;windowEnd:number;availableAt:number;buy:number;sell:number;unknown:number;effort:number;dominance:number;progress:number;endpoint:number;range:number;scale:number;concentration:number;parts:number;spanMs:number;intensity:number;coverage:'observed';low:number;high:number;buffer:number;side:1|-1 }
export type EventState='detected'|'rejection-observed'|'breakthrough-observed'|'expired-unresolved'|'interrupted-unknown';
export interface EffortEvent { id:string;schema:1;detectorVersion:string;key:string;source:EffortSource;settings:ReturnType<typeof calculationSettings>;initial:Evidence;lastEvidence:Evidence;state:EventState;end:number|null;outcomeAvailableAt:number|null;alertedAt:Partial<Record<EventState,number>>;notified:EventState[];additionalVolume:number;evidenceThrough:number;rejectionRun:number;breakthroughRun:number;reason?:string;qualityWarnings?:{at:number;executionTime:number;reason:string}[] }
export interface Point { time:number;availableAt:number;value:number|null;reason:string }
export interface SavedEffort { schema:1;key:string;savedAt:number;references:Reference[];events:EffortEvent[] }
export interface Evaluation { value:number|null;reason:string;references:number;ranges:number;evidence?:Evidence }
export const percentileRank=(values:readonly number[],x:number)=>values.length?values.reduce((n,v)=>n+(v<x?1:v===x?.5:0),0)/values.length:0;
const bps=(a:number,b:number)=>10000*Math.log(a/b);
const median=(xs:number[])=>{xs.sort((a,b)=>a-b);const n=xs.length;return n%2?xs[n>>1]:(xs[n/2-1]+xs[n/2])/2;};
const overlap=(a:number,b:number,c:number,d:number)=>a<=d&&c<=b;
/** DOM-free causal engine shared by live worker and replay. All times are milliseconds. */
export class EffortEngine {
 readonly key:string;readonly events:EffortEvent[]=[];readonly points:Point[]=[];readonly references:Reference[]=[];
 private pending=new Map<number,MutableSecond>();private seconds:Second[]=[];private ids=new Map<string,number>();
 private idOrder:{id:string;time:number}[]=[];private idHead=0;
 private next:number|null=null;private maxTime=-Infinity;private finalized=-Infinity;private lastPrice=NaN;private epoch?:string;
 private qualityUntil=-Infinity;private qualityReason='Collecting executions';private startAt=Infinity;
 private rolling:Second[]=[];private rollingBuy=0;private rollingSell=0;private rollingUnknown=0;private highs:Second[]=[];private lows:Second[]=[];
 correctionCount=0;capacityCount=0;duplicates=0;processed=0;zoneScans=0;last:Evaluation={value:null,reason:'Warming up',references:0,ranges:0};
 constructor(readonly source:EffortSource,readonly settings:EffortSettings){this.key=sourceKey(source,settings);}
 ingest(t:NormalizedExecution,receivedAt:number,epoch:string){
  if(t.venue!==this.source.venue||t.market!==this.source.market||t.nativeSymbol!==this.source.nativeSymbol||t.granularity!==this.source.granularity)return;
  if(this.epoch!==undefined&&this.epoch!==epoch)this.interrupt(receivedAt,'Source epoch changed');this.epoch=epoch;
  if(this.ids.has(t.executionId)){this.duplicates++;return;}
  if(![t.price,t.quantity,t.timeMs,receivedAt].every(Number.isFinite)||t.price<=0||t.quantity<=0||t.timeMs<=0||!Number.isSafeInteger(t.timeMs)||typeof t.executionId!=='string'||!t.executionId||t.executionId.length>512||!['buy','sell','unknown'].includes(t.side)){this.interrupt(receivedAt,'Invalid execution');return;}
  if(t.timeMs<this.finalized){this.correct(receivedAt,t.timeMs,'Late execution outside finalized watermark');return;}
  if(this.ids.size>=MAX_IDS){this.capacityCount++;this.interrupt(receivedAt,'Execution identity capacity exceeded');this.ids.clear();this.idOrder=[];this.idHead=0;}
  this.ids.set(t.executionId,t.timeMs);this.idOrder.push({id:t.executionId,time:t.timeMs});while(this.idHead<this.idOrder.length&&this.idOrder[this.idHead].time<this.maxTime-2*W){this.ids.delete(this.idOrder[this.idHead++].id);}if(this.idHead>8192){this.idOrder.splice(0,this.idHead);this.idHead=0;}
  const tick=Math.round(t.price/this.source.tickSize);if(Math.abs(tick*this.source.tickSize-t.price)>this.source.tickSize*1e-5){this.interrupt(receivedAt,'Invalid native tick price');return;}
  const start=Math.floor(t.timeMs/1000)*1000;this.next??=start;this.startAt=Math.min(this.startAt,start);
  // Unobserved intervals are never materialized as a long run of zero-volume windows.
  if(t.timeMs-this.maxTime>15000&&Number.isFinite(this.maxTime)){this.interrupt(receivedAt,'Execution transport gap over 15 seconds');this.pending.clear();this.seconds=[];this.rolling=[];this.highs=[];this.lows=[];this.rollingBuy=this.rollingSell=this.rollingUnknown=0;this.next=start;this.lastPrice=NaN;}
  let sec=this.pending.get(start);if(!sec){sec={start,open:t.price,close:t.price,high:t.price,low:t.price,buy:0,sell:0,unknown:0,valid:true,levels:new Map(),first:t.timeMs,last:t.timeMs,receivedFirst:t.receivedAtMs??receivedAt,receivedLast:t.receivedAtMs??receivedAt};this.pending.set(start,sec);}
  sec.receivedFirst=Math.min(sec.receivedFirst??Infinity,t.receivedAtMs??receivedAt);sec.receivedLast=Math.max(sec.receivedLast??-Infinity,t.receivedAtMs??receivedAt);if(t.timeMs===start)sec.boundary=t.price;const quantity=t.quantity;sec[t.side]+=quantity;sec.high=Math.max(sec.high,t.price);sec.low=Math.min(sec.low,t.price);if(t.timeMs<sec.first){sec.first=t.timeMs;sec.open=t.price;}if(t.timeMs>=sec.last){sec.last=t.timeMs;sec.close=t.price;}
  let cell=sec.levels.get(tick);if(!cell&&sec.levels.size>=MAX_LEVELS){sec.valid=false;this.capacityCount++;this.qualityReason='Price histogram capacity exceeded';}else{cell??={buy:0,sell:0,unknown:0,buyFirst:Infinity,buyLast:-Infinity,sellFirst:Infinity,sellLast:-Infinity};cell[t.side]+=quantity;if(t.side!=='unknown'){const first=t.side==='buy'?'buyFirst':'sellFirst',last=t.side==='buy'?'buyLast':'sellLast';cell[first]=Math.min(cell[first],t.timeMs);cell[last]=Math.max(cell[last],t.timeMs);}sec.levels.set(tick,cell);}
  this.maxTime=Math.max(this.maxTime,t.timeMs);this.processed++;
 }
 /** Advance only from observed exchange execution time, not a host clock pretending to be exchange time. */
 advance(availableAt:number,emitSignals=true){const watermark=this.maxTime-this.settings.latenessMs;if(this.next===null)return;while(this.next+1000<=watermark){const start=this.next;this.next+=1000;const pending=this.pending.get(start);this.pending.delete(start);const valid=start>=this.qualityUntil&&start>=this.startAt&&Number.isFinite(this.lastPrice);
   const sec:Second=pending?{...pending,open:pending.boundary??(Number.isFinite(this.lastPrice)?this.lastPrice:pending.open),valid:valid&&pending.valid,levels:[...pending.levels]}:{start,open:this.lastPrice,close:this.lastPrice,high:this.lastPrice,low:this.lastPrice,buy:0,sell:0,unknown:0,valid,levels:[]};
   sec.high=Math.max(sec.high,sec.open);sec.low=Math.min(sec.low,sec.open);this.lastPrice=sec.close;this.finalized=start+1000;this.seconds.push(sec);while(this.seconds.length>61)this.seconds.shift();
   this.rolling.push(sec);this.rollingBuy+=sec.buy;this.rollingSell+=sec.sell;this.rollingUnknown+=sec.unknown;while(this.highs.length&&this.highs.at(-1)!.high<=sec.high)this.highs.pop();while(this.lows.length&&this.lows.at(-1)!.low>=sec.low)this.lows.pop();this.highs.push(sec);this.lows.push(sec);const cutoff=start+1000-W;while(this.rolling.length&&this.rolling[0].start<cutoff){const old=this.rolling.shift()!;this.rollingBuy-=old.buy;this.rollingSell-=old.sell;this.rollingUnknown-=old.unknown;}while(this.highs.length&&this.highs[0].start<cutoff)this.highs.shift();while(this.lows.length&&this.lows[0].start<cutoff)this.lows.shift();
   if(emitSignals)this.reduceOutcomes(sec,availableAt);
   const end=start+1000,window=this.rolling;this.last=emitSignals?this.evaluate(window,end,availableAt):{value:null,reason:'Restoring server calibration · historical inputs issue no signals',references:this.references.filter(r=>r.end<=end-W).length,ranges:this.references.filter(r=>r.end<=end-W&&r.end>end-W-7200000).length};if(emitSignals)this.points.push({time:end,availableAt,value:this.last.value,reason:this.last.reason});while(this.points.length>MAX_POINTS)this.points.shift();if(this.last.evidence)this.detect(this.last.evidence);
   if(end%W===0&&(this.references.at(-1)?.end??-Infinity)<end&&window.length===30&&window.every(s=>s.valid)&&window[0].start===end-W&&window.reduce((n,s)=>n+s.unknown,0)<=this.settings.unknownFraction*window.reduce((n,s)=>n+s.buy+s.sell+s.unknown,0))this.references.push({start:end-W,end,buy:window.reduce((n,s)=>n+s.buy,0),sell:window.reduce((n,s)=>n+s.sell,0),range:bps(Math.max(...window.map(s=>s.high)),Math.min(...window.map(s=>s.low)))});
   while(this.references.length&&(this.references[0].end<end-86400000-W||this.references.length>2882))this.references.shift();this.prune(end);
  }}
 evaluate(window:readonly Second[],end:number,availableAt:number):Evaluation {
  const start=end-W,eligible=this.references.filter(r=>r.end<=start&&r.end>start-86400000),ranges=eligible.filter(r=>r.end>start-7200000),state={references:eligible.length,ranges:ranges.length};
  if(window.length!==30||window[0].start!==start||window.some(s=>!s.valid))return {...state,value:null,reason:this.qualityReason};
  if(eligible.length<500||ranges.length<100)return {...state,value:null,reason:`Warming up: ${eligible.length}/500 effort · ${ranges.length}/100 range windows`};
  const incremental=window===this.rolling;const B=incremental?this.rollingBuy:window.reduce((n,s)=>n+s.buy,0),A=incremental?this.rollingSell:window.reduce((n,s)=>n+s.sell,0),U=incremental?this.rollingUnknown:window.reduce((n,s)=>n+s.unknown,0),V=B+A+U,D=B-A;
  if(!V)return {...state,value:0,reason:'Ready · no executions in observed analysis window'};
  if(U/V>this.settings.unknownFraction)return {...state,value:null,reason:'Unknown-side coverage exceeds limit'};
  const none={...state,value:0,reason:'Ready · no directional stall'};if(!D)return none;
  const side:1|-1=D>0?1:-1,Q=side===1?B:A;if(!eligible.some(r=>(side===1?r.buy:r.sell)>0))return {...state,value:null,reason:'Unavailable · side-specific reference history is all zero'};const effort=percentileRank(eligible.map(r=>side===1?r.buy:r.sell),Q),dominance=Math.abs(D)/V;
  if(Q<=0||effort<this.settings.effort||dominance<this.settings.dominance)return none;
  const m0=window[0].open,mEnd=window.at(-1)!.close,hi=incremental?this.highs[0].high:Math.max(...window.map(s=>s.high)),lo=incremental?this.lows[0].low:Math.min(...window.map(s=>s.low)),scale=Math.max(median(ranges.map(r=>r.range)),4*10000*this.source.tickSize/m0),progress=Math.max(0,side*bps(side===1?hi:lo,m0)),endpoint=bps(mEnd,m0),range=bps(hi,lo);
  if(progress>this.settings.progress*scale||Math.abs(endpoint)>this.settings.endpoint*scale||range>this.settings.range*scale)return none;
  this.zoneScans++;const tickSize=this.source.tickSize,hTicks=Math.ceil(Math.max(2,.10*m0*scale/10000/tickSize)),width=2*hTicks;
  const histogram=new Map<number,number>(),field=side===1?'buy':'sell';for(const sec of window)for(const [tick,c]of sec.levels)if(c[field])histogram.set(tick,(histogram.get(tick)??0)+c[field]);
  const prices=[...histogram.keys()].sort((a,b)=>a-b);let best=-1,bestLow=0,bestDistance=Infinity,sum=0,left=0;
  // For each rightmost occupied tick, the optimal tied centre lies in [right-width, next-left].
  for(let right=0;right<prices.length;right++){sum+=histogram.get(prices[right])!;while(prices[right]-prices[left]>width)sum-=histogram.get(prices[left++])!;
   const minLow=prices[right]-width,maxLow=prices[left],ideal=mEnd/tickSize-hTicks;const candidates=[Math.max(minLow,Math.min(maxLow,Math.floor(ideal))),Math.max(minLow,Math.min(maxLow,Math.ceil(ideal)))];for(const lower of candidates){const distance=Math.abs(lower+hTicks-mEnd/tickSize);if(sum>best||sum===best&&(distance<bestDistance||distance===bestDistance&&lower<bestLow)){best=sum;bestLow=lower;bestDistance=distance;}}
  }
  if(best/Q<this.settings.concentration)return none;const parts=Array(6).fill(0);let first=Infinity,last=-Infinity;
  for(const sec of window)for(const [tick,c]of sec.levels)if(tick>=bestLow&&tick<=bestLow+width&&c[field]){parts[Math.floor((sec.start-start)/5000)]+=c[field];first=Math.min(first,side===1?c.buyFirst:c.sellFirst);last=Math.max(last,side===1?c.buyLast:c.sellLast);}
  const persistent=parts.filter(v=>v>=this.settings.partFraction*best).length,spanMs=last-first,low=bestLow*tickSize,high=(bestLow+width)*tickSize,buffer=hTicks*tickSize;
  if(persistent<this.settings.persistentParts||spanMs<W*this.settings.durationFraction||mEnd<low-buffer||mEnd>high+buffer)return none;
  const evidence:Evidence={windowStart:start,windowEnd:end,availableAt,buy:B,sell:A,unknown:U,effort,dominance,progress,endpoint,range,scale,concentration:best/Q,parts:persistent,spanMs,intensity:-side*100*effort*(1-Math.min(1,progress/scale)),coverage:'observed',low,high,buffer,side};
  return {...state,value:evidence.intensity,reason:'Directional flow stalled',evidence};
 }
 private detect(e:Evidence){const matches=this.events.filter(p=>p.initial.side===e.side&&overlap(p.initial.low,p.initial.high,e.low,e.high));const prior=matches.find(p=>p.state==='detected')??matches.at(-1);
  if(prior&&prior.state==='detected'){prior.lastEvidence=e;return;}
  if(prior&&(e.windowStart<prior.evidenceThrough||e.availableAt-(prior.outcomeAvailableAt??prior.initial.availableAt)<this.settings.cooldownSeconds*1000))return;
  this.events.push({id:`${this.key}:${e.windowEnd}:${e.side}:${e.low}`,schema:1,detectorVersion:DETECTOR_VERSION,key:this.key,source:{...this.source},settings:calculationSettings(this.settings),initial:{...e},lastEvidence:{...e},state:'detected',end:null,outcomeAvailableAt:null,alertedAt:{},notified:[],additionalVolume:0,evidenceThrough:e.windowEnd,rejectionRun:0,breakthroughRun:0});
 }
 private reduceOutcomes(sec:Second,availableAt:number){for(const e of this.events){if(e.state!=='detected')continue;if(!sec.valid){this.finish(e,'interrupted-unknown',sec.start+1000,availableAt,'Invalid or unobserved outcome interval');continue;}
  // Count each observed future second once, even when later windows no longer pass the detector.
  if(sec.start>=e.evidenceThrough){for(const [tick,c]of sec.levels)if(tick*this.source.tickSize>=e.initial.low&&tick*this.source.tickSize<=e.initial.high)e.additionalVolume+=e.initial.side===1?c.buy:c.sell;e.evidenceThrough=sec.start+1000;}
  // Both the observed close and its interval must follow actual signal availability.
  if(sec.start<e.initial.availableAt||(sec.receivedFirst!==undefined&&sec.receivedFirst<=e.initial.availableAt)){e.rejectionRun=0;e.breakthroughRun=0;continue;}
  if(sec.start+1000>e.initial.availableAt+e.settings.outcomeSeconds*1000){this.finish(e,'expired-unresolved',e.initial.availableAt+e.settings.outcomeSeconds*1000,availableAt);continue;}
  const below=sec.close<e.initial.low-e.initial.buffer,above=sec.close>e.initial.high+e.initial.buffer;
  e.rejectionRun=(e.initial.side===1?below:above)?e.rejectionRun+1:0;e.breakthroughRun=(e.initial.side===1?above:below)?e.breakthroughRun+1:0;
  if(e.rejectionRun>=3)this.finish(e,'rejection-observed',sec.start+1000,availableAt);else if(e.breakthroughRun>=3)this.finish(e,'breakthrough-observed',sec.start+1000,availableAt);
 }}
 private finish(e:EffortEvent,state:EventState,end:number,availableAt:number,reason?:string){e.state=state;e.end=Math.max(e.initial.availableAt,end);e.outcomeAvailableAt=availableAt;e.reason=reason;}
 interrupt(at:number,reason:string){this.qualityReason=reason;this.qualityUntil=Math.max(this.qualityUntil,Number.isFinite(this.maxTime)?this.maxTime+W:at+W);for(const sec of this.pending.values())sec.valid=false;for(const e of this.events)if(e.state==='detected')this.finish(e,'interrupted-unknown',at,at,reason);this.last={...this.last,value:null,reason};if(this.points.length&&this.points.at(-1)!.value!==null){this.points.push({time:Number.isFinite(this.finalized)?this.finalized:at,availableAt:at,value:null,reason});if(this.points.length>MAX_POINTS)this.points.shift();}}
 correct(at:number,executionTime:number,reason:string){this.correctionCount++;for(let i=this.references.length-1;i>=0;i--)if(this.references[i].start<=executionTime&&this.references[i].end>executionTime)this.references.splice(i,1);for(const e of this.events)if(e.initial.windowStart<=executionTime&&e.initial.windowEnd>executionTime){e.qualityWarnings??=[];if(e.qualityWarnings.length<32)e.qualityWarnings.push({at,executionTime,reason});}this.interrupt(at,reason);}
 private prune(now:number){const cutoff=now-this.settings.retentionDays*86400000;while(this.events.length&&this.events[0].initial.availableAt<cutoff)this.events.shift();while(this.events.length>MAX_EVENTS){this.events.shift();this.capacityCount++;this.qualityReason='Event retention capacity reached';}}
 save(now:number):SavedEffort{return {schema:1,key:this.key,savedAt:now,references:this.references.map(r=>({...r})),events:structuredClone(this.events)};}
 restore(raw:SavedEffort,now:number){if(raw?.schema!==1||raw.key!==this.key||!Number.isFinite(raw.savedAt)||raw.savedAt>now||!Array.isArray(raw.references)||!Array.isArray(raw.events))return false;
  this.references.splice(0);let previous=-Infinity;for(const r of raw.references.slice(-2882)){if(r.start%W||r.end-r.start!==W||r.start<previous||r.end>now||r.end<now-86400000-W||![r.buy,r.sell,r.range].every(x=>Number.isFinite(x)&&x>=0))continue;this.references.push({...r});previous=r.end;}
  this.events.splice(0);for(const e of raw.events.slice(-MAX_EVENTS))if(e&&e.schema===1&&e.key===this.key&&e.initial&&e.settings&&Array.isArray(e.notified)&&['detected','rejection-observed','breakthrough-observed','expired-unresolved','interrupted-unknown'].includes(e.state)&&[e.initial.low,e.initial.high,e.initial.buffer,e.initial.availableAt,e.initial.scale].every(Number.isFinite)&&e.initial.low>0&&e.initial.high>=e.initial.low&&e.initial.scale>0&&e.initial.availableAt<=now&&e.initial.availableAt>=now-this.settings.retentionDays*86400000){const copy=structuredClone(e);if(copy.state==='detected')this.finish(copy,'interrupted-unknown',now,now,'Collection interrupted by reload');copy.notified=[...new Set([...copy.notified,'detected' as EventState,copy.state])];this.events.push(copy);}return true;
 }
 diagnostics(){return {processed:this.processed,seconds:this.seconds.length,pending:this.pending.size,ids:this.ids.size,references:this.references.length,events:this.events.length,points:this.points.length,zoneScans:this.zoneScans,duplicates:this.duplicates,corrections:this.correctionCount,capacity:this.capacityCount};}
}
export interface ReplayInput { trade:NormalizedExecution;receivedAt:number;epoch:string;interruption?:string;correctionTime?:number }
export interface ReplayFrame { trades:readonly NormalizedExecution[];receivedAt:number;epoch:string;interruption?:string;correctionTime?:number }
export function replay(source:EffortSource,settings:EffortSettings,inputs:readonly (ReplayInput|ReplayFrame)[],calibration?:SavedEffort){const engine=new EffortEngine(source,settings);if(calibration&&inputs.length&&!engine.restore(calibration,inputs[0].receivedAt))throw new Error('Replay calibration schema/source/settings/age mismatch');let prior=-Infinity;for(const input of inputs){if(!Number.isFinite(input.receivedAt)||input.receivedAt<prior||typeof input.epoch!=='string')throw new Error('Replay requires ordered actual availability times and explicit source epochs');prior=input.receivedAt;if(input.interruption)engine.interrupt(input.receivedAt,input.interruption);if(input.correctionTime!==undefined)engine.correct(input.receivedAt,input.correctionTime,'Replay source correction');for(const trade of 'trades' in input?input.trades:[input.trade])engine.ingest(trade,input.receivedAt,input.epoch);engine.advance(input.receivedAt);}return engine;}

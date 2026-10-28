import { instruments, type ConnectionKey } from './protocol';
export const CVD_ID='native.multi-venue-cvd', CVD_STEP=60000, CVD_MAX_POINTS=10082;
export const CVD_SOURCES=['binance:spot','binance:perpetual','bybit:perpetual'] as const;
export type CvdSource=typeof CVD_SOURCES[number];
export type CvdAnchor='daily'|'weekly'|'continuous'|'custom';
export interface CvdGroup {id:string;name:string;markets:ConnectionKey[];revision:number}
export interface CvdSettings {
  sources:CvdSource[]; groups:CvdGroup[]; mode:'venues'|'aggregations'; hidden:string[];
  anchor:CvdAnchor; origin:number; custom:number; units:'btc'|'usdt';
  colors:Record<string,string>; totalWidth:number; componentWidth:number; paneWeight:number;
}
export const cvdSourceLabel=(id:string)=>id==='binance:spot'?'BN[S] BTCUSDT':id==='binance:perpetual'?'BN[P] BTCUSDT':id==='bybit:perpetual'?'BY[P] BTCUSDT':id;
export function compatibleCvdSources(raw:unknown):CvdSource[]{return Array.isArray(raw)?CVD_SOURCES.filter(id=>raw.includes(id)):[];}
export function cvdSettings(raw:unknown, now=Date.now()):CvdSettings {
  const v=raw&&typeof raw==='object'?raw as Record<string,any>:{};
  const time=(x:unknown,fallback:number)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0&&x<=8640000000000000?x:fallback;
  const origin=time(v.origin,Math.ceil((now-7*86400000)/CVD_STEP)*CVD_STEP);
  const colors=Object.fromEntries(Object.entries(v.colors&&typeof v.colors==='object'?v.colors:{}).filter(([key,value])=>key.length<100&&typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)).slice(0,32)) as Record<string,string>;
  const groups:CvdGroup[]=Array.isArray(v.groups)?v.groups.slice(0,16).filter((g:any)=>g&&typeof g.id==='string'&&/^[\w-]{1,80}$/.test(g.id)&&typeof g.name==='string').map((g:any)=>({id:g.id,name:g.name.slice(0,60),markets:compatibleCvdSources(g.markets),revision:time(g.revision,1)})):[];
  return {sources:Object.hasOwn(v,'sources')?compatibleCvdSources(v.sources):['binance:spot','binance:perpetual'],groups,mode:v.mode==='aggregations'?'aggregations':'venues',
    hidden:Array.isArray(v.hidden)?[...new Set(v.hidden.filter((s:any)=>typeof s==='string'&&s.length<100))].slice(0,32) as string[]:[],
    anchor:['weekly','continuous','custom'].includes(v.anchor)?v.anchor:'daily',origin,custom:time(v.custom,origin),units:v.units==='usdt'?'usdt':'btc',colors,
    totalWidth:typeof v.totalWidth==='number'&&Number.isFinite(v.totalWidth)?Math.max(2,Math.min(4,v.totalWidth)):2,componentWidth:typeof v.componentWidth==='number'&&Number.isFinite(v.componentWidth)?Math.max(1,Math.min(2,v.componentWidth)):1,paneWeight:typeof v.paneWeight==='number'&&Number.isFinite(v.paneWeight)?Math.max(.08,Math.min(3,v.paneWeight)):.28};
}
export function cvdAnchorAt(time:number,s:Pick<CvdSettings,'anchor'|'origin'|'custom'>){
  if(s.anchor==='continuous')return Math.ceil(s.origin/CVD_STEP)*CVD_STEP;
  if(s.anchor==='custom')return Math.ceil(s.custom/CVD_STEP)*CVD_STEP;
  const day=Math.floor(time/86400000)*86400000;
  return s.anchor==='daily'?day:day-((new Date(day).getUTCDay()+6)%7)*86400000;
}
export interface CvdBucket {time:number;base:number;quote:number;revision:number}
export interface CvdCoverage {from:number;to:number;gaps:{from:number;to:number;reason?:string}[]}
export interface CvdPayload {version:1;source:string;stepMs:number;from:number;to:number;revision:number;snapshot:boolean;watermark:number;baseUnit:'BTC';quoteUnit:'USDT';buckets:CvdBucket[];coverage:CvdCoverage;status:'live'|'stale'|'awaiting'|'unavailable';asOf:number;message?:string}
export interface CvdPoint {time:number;period:number;base:number;quote:number;observed:boolean;available:boolean;partial:boolean;reset:boolean}
export interface CvdSeries {source:CvdSource;points:CvdPoint[];snapshot:boolean;removeBefore:number;coverage:CvdCoverage;status:CvdPayload['status'];message:string;asOf:number}
export interface CvdRequest {sources:CvdSource[];anchor:CvdAnchor;origin:number;custom:number}
export type CvdEvent={type:'cvd-batch';ids:string[];generation:number;batchId:number;series:CvdSeries[]};
export function validateCvdPayload(value:any, source:CvdSource):CvdPayload {
  if(value?.version!==1||value.source!==`${source}:BTCUSDT`||value.stepMs!==CVD_STEP||value.baseUnit!=='BTC'||value.quoteUnit!=='USDT'
    ||!Array.isArray(value.buckets)||value.buckets.length>CVD_MAX_POINTS||!Number.isSafeInteger(value.revision)||!Number.isSafeInteger(value.watermark)
    ||!Number.isSafeInteger(value.from)||value.from%CVD_STEP||!Number.isSafeInteger(value.to)||value.to<=value.from||value.to-value.from>(CVD_MAX_POINTS*CVD_STEP)
    ||!['live','stale','awaiting','unavailable'].includes(value.status)||typeof value.snapshot!=='boolean'||!Number.isFinite(value.asOf)
    ||!Number.isFinite(value.coverage?.from)||!Number.isFinite(value.coverage?.to)||!Array.isArray(value.coverage?.gaps)||value.coverage.gaps.length>1024)throw Error('Invalid signed execution history');
  const seen=new Set<number>();
  for(const b of value.buckets){if(!Number.isSafeInteger(b.time)||b.time%CVD_STEP||b.time<value.from||b.time>=value.to||seen.has(b.time)||![b.base,b.quote].every(Number.isFinite)||!Number.isSafeInteger(b.revision)||b.revision>value.revision)throw Error('Invalid/duplicate CVD bucket');seen.add(b.time);}
  for(const gap of value.coverage.gaps)if(![gap.from,gap.to].every(Number.isFinite)||gap.from>=gap.to)throw Error('Invalid execution coverage');
  return value;
}
/** Replacement deltas -> cumulative suffix. Prefix checkpoints survive pruning; no UI state/viewport input. */
export class CvdCalculation {
  private buckets=new Map<number,CvdBucket>();private points:CvdPoint[]=[];
  private sorted:CvdBucket[]=[];private orderDirty=false;
  private prefix?:CvdPoint;private coverageKey='';private confirmedTo=0;private request:CvdRequest;
  constructor(request:CvdRequest){this.request=request;}
  apply(payload:CvdPayload):CvdSeries['points'] {
    let first=Infinity;
    if(this.prefix&&payload.from<this.prefix.time)this.prefix=undefined;
    const key=JSON.stringify([Math.ceil(payload.coverage.from/CVD_STEP)*CVD_STEP,payload.coverage.gaps]);
    if(key!==this.coverageKey){first=payload.from;this.coverageKey=key;}
    else if(payload.coverage.to!==this.confirmedTo)first=Math.floor(Math.min(this.confirmedTo||payload.coverage.to,payload.coverage.to)/CVD_STEP)*CVD_STEP;
    this.confirmedTo=payload.coverage.to;
    if(payload.snapshot){
      const incoming=new Set(payload.buckets.map(b=>b.time));
      for(const [time]of this.buckets)if(time>=payload.from&&!incoming.has(time)){this.buckets.delete(time);this.orderDirty=true;first=Math.min(first,time);}
    }
    for(const b of payload.buckets){const old=this.buckets.get(b.time);if(!old||(payload.snapshot||b.revision>=old.revision)&&(b.base!==old.base||b.quote!==old.quote||b.revision!==old.revision)){if(!old)this.orderDirty=true;this.buckets.set(b.time,b);first=Math.min(first,b.time);}}
    for(const point of this.points)if(point.time-CVD_STEP<payload.from)this.prefix=point;
    for(const time of this.buckets.keys())if(time<payload.from){this.buckets.delete(time);this.orderDirty=true;}
    this.points=this.points.filter(point=>point.time-CVD_STEP>=payload.from);
    if(first===Infinity)return [];
    if(this.orderDirty){this.sorted=[...this.buckets.values()].sort((a,b)=>a.time-b.time);this.orderDirty=false;}
    // Binary-search the corrected suffix; the unchanged cumulative prefix is reused.
    let lo=0,hi=this.points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.points[mid]!.time-CVD_STEP<first)lo=mid+1;else hi=mid;}
    const next:CvdPoint[]=this.points.slice(0,lo);let previous=next.at(-1)??this.prefix;
    let left=0,right=this.sorted.length;while(left<right){const mid=(left+right)>>>1;if(this.sorted[mid]!.time<first)left=mid+1;else right=mid;}
    for(let index=left;index<this.sorted.length;index++) {
      const b=this.buckets.get(this.sorted[index]!.time)!;
      const anchor=cvdAnchorAt(b.time,this.request);
      if(b.time<anchor)continue;
      const same=previous?.period===anchor;
      const start=Math.max(b.time,payload.coverage.from), end=Math.min(b.time+CVD_STEP,payload.coverage.to);
      const gap=payload.coverage.gaps.some(g=>g.from<b.time+CVD_STEP&&g.to>b.time);
      const observed=start<end&&!gap;
      const full=b.time>=payload.coverage.from&&b.time+CVD_STEP<=payload.coverage.to&&!gap;
      const contiguous=same&&previous!.time===b.time;
      const reset=!same;
      // A live forming bucket is provisional, not proof of missing past flow.
      const forming=b.time<=payload.asOf&&payload.asOf<b.time+CVD_STEP;
      const partial=(same?previous!.partial:false)||(!same&&b.time!==anchor)||b.time<payload.coverage.from||gap||(!full&&!forming)||(same&&!contiguous);
      const point={time:b.time+CVD_STEP,period:anchor,base:(same?previous!.base:0)+b.base,quote:(same?previous!.quote:0)+b.quote,
        observed,available:(same?previous!.available:false)||observed||b.base!==0||b.quote!==0,partial,reset};
      next.push(point);previous=point;
    }
    this.points=next;
    return next.slice(lo);
  }
  snapshot(){return this.points;}
}
/** Visibility never enters membership; overlapping named groups do not enter the total calculation. */
export function cvdValues(sources:readonly CvdSource[], values:ReadonlyMap<string,{value:number;observed:boolean;partial:boolean}>, groups:readonly CvdGroup[]){
  const included=[...new Set(sources)], sum=(ids:readonly string[])=>{
    let value=0,available=false,partial=false;
    for(const id of [...new Set(ids)]){const p=values.get(id);if(p){value+=p.value;available=true;partial||=p.partial||!p.observed;}else partial=true;}
    return {value:available?value:null,partial};
  };
  return {total:sum(included),groups:groups.map(g=>({id:g.id,name:g.name,filtered:g.markets.some(id=>!included.includes(id as CvdSource)),...sum(g.markets.filter(id=>included.includes(id as CvdSource)))}))};
}
export const cvdDefaultColor=(id:string)=>id==='binance:spot'?'#c39b58':id==='binance:perpetual'?'#719aca': ['#a68bc2','#72ac9a','#cc8972','#c1a5b9','#a4b575','#b5a16f'][[...id].reduce((a,c)=>(a*31+c.charCodeAt(0))%997,0)%6]!;

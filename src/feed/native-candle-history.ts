import {pastCandleViewport} from './candle-viewport';
import type {NativeCandlePresentationCache} from './native-candle-presentation-cache';
import {duration,instrumentKey,instrumentOf,marketOf,validCandle,type Candle,type Series} from './protocol';
import {historyScheduler,type HistoryScheduler} from './history-scheduler';
import {NATIVE_CHART_BAR_BUDGET,NATIVE_VISIBLE_BAR_BUDGET,type NativeCandleVersion} from './native-candle-state';
import {historyViewId,tracedHistoryJson} from './history-trace';
export type {NativeCandleVersion} from './native-candle-state';
export interface NativeCandleViewProgress {
 from:number;to:number;requestedSlots:number;loadedSlots:number;
 state:'loading'|'ready'|'partial'|'failed'|'capacity-limited';
 capacityLimited:boolean;retryable:boolean;error?:string;
 cachedSlots?:number;
 unloaded:Array<{from:number;to:number;reason:'not-returned'|'capacity'}>;unloadedTruncated:boolean;
}
interface View {leases:Array<()=>void>;trace:string;cached?:NativeCandleViewProgress;from:number;to:number;loadFrom:number;key:string;known:Set<number>;received:Set<number>;presented:Set<number>;abort:AbortController;busy:boolean;error?:string;attempted:boolean}
interface Page {candles:Candle[];version:NativeCandleVersion;at:number}
/** Exact native OHLC only, via the existing collector API. An optional bounded
 * presentation cache is independently revalidated; chart retention stays5000.
 * Requests share the normal history scheduler and consumer-specific cancellation. */
export class NativeCandleHistory {
 private views=new Map<string,View>();private dead=false;private online=true;
 readonly metrics={requests:0,receivedBars:0,presentedBars:0,applyMs:0};
 constructor(private series:Series,private options:{request:typeof fetch;version:()=>NativeCandleVersion;now:()=>number;
  apply:(id:string,bars:Candle[],version:NativeCandleVersion,at:number)=>number[];changed:()=>void;scheduler?:HistoryScheduler;presentation?:NativeCandlePresentationCache;nativeBars?:()=>readonly Candle[]}){}
 viewport(id:string,rawFrom:number,rawTo:number,knownTimes:number[]){
  if(this.dead||!Number.isFinite(rawFrom)||!Number.isFinite(rawTo)||rawFrom<0||rawFrom>=rawTo||rawTo>8.64e15
   ||!Array.isArray(knownTimes)||knownTimes.length>NATIVE_CHART_BAR_BUDGET||!knownTimes.every(Number.isSafeInteger))return;
  const step=duration[this.series.interval],eligible=pastCandleViewport(rawFrom,rawTo,this.options.now(),step),to=eligible.to;
  const from=Math.min(eligible.from,to),loadFrom=Math.max(from,to-NATIVE_VISIBLE_BAR_BUDGET*step),key=`${from}:${to}`;
  const known=new Set(knownTimes.filter(t=>t>=loadFrom&&t<to&&t%step===0));
  const old=this.views.get(id);
  if(old?.key===key){
   old.known=new Set([...known].filter(t=>!old.presented.has(t)));old.cached=undefined;
   if(old.busy&&this.missing(old).length===0){
    // Another native delivery satisfied this consumer. Releasing its interest
    // leaves any peer of the shared HTTP request intact.
    old.abort.abort();this.views.set(id,{...old,cached:undefined,abort:new AbortController(),busy:false,error:undefined,attempted:true});this.options.changed();
   }else if(!old.busy){
    old.received.clear();
    if(!this.missing(old).length){old.error=undefined;old.attempted=true;old.cached=undefined;}
    else if(!old.attempted&&!old.error)void this.load(id,old);
   }
   return;
  }
  old?.abort.abort();for(const release of old?.leases??[])release();
  const view:View={leases:[],trace:historyViewId(),from,to,loadFrom,key,known,received:new Set(),presented:new Set(),abort:new AbortController(),busy:false,attempted:false};
  this.views.set(id,view);
  for(let end=to;end>loadFrom;){const start=Math.max(loadFrom,end-1000*step),release=this.options.presentation?.retain(this.presentationKey(start,end));if(release)view.leases.push(release);end=start;}
  const native=this.options.nativeBars?.()??[];
  if(this.online)for(let end=to;end>loadFrom;){const start=Math.max(loadFrom,end-1000*step),key=this.presentationKey(start,end),owned=native.filter(c=>c.closed===true&&c.t%step===0&&c.t>=start&&c.t<end);
   for(const bar of owned)view.known.add(bar.t);this.options.presentation?.seed(key,owned);
   const rows=this.options.presentation?.read(key)?.filter(c=>!view.known.has(c.t));
   if(rows?.length){const covered=this.options.apply(id,rows,{stream:0,request:0},this.options.now());for(const time of covered)if(time>=start&&time<end)view.presented.add(time);this.metrics.presentedBars+=covered.length;}end=start;}
  void this.load(id,view);
 }
 private presentationKey(from:number,to:number){return JSON.stringify([instrumentKey(this.series),instrumentOf(this.series).native,this.series.interval,from,to]);}
 private missing(v:View){
  const step=duration[this.series.interval],ranges:Array<{from:number;to:number}>=[];
  for(let t=v.loadFrom;t<v.to;t+=step)if(!v.known.has(t)&&!v.received.has(t)){
   const last=ranges.at(-1);if(last?.to===t)last.to=t+step;else ranges.push({from:t,to:t+step});
  }
  return ranges;
 }
 progress(id:string):NativeCandleViewProgress|undefined{
  const v=this.views.get(id);if(!v)return;if(v.cached)return v.cached;
  const step=duration[this.series.interval],missing=this.missing(v),capacityLimited=v.loadFrom>v.from;
  const unloaded:NativeCandleViewProgress['unloaded']=[...(capacityLimited?[{from:v.from,to:v.loadFrom,reason:'capacity' as const}]:[]),...missing.map(r=>({...r,reason:'not-returned' as const}))];
  return v.cached={from:v.from,to:v.to,requestedSlots:(v.to-v.from)/step,loadedSlots:(v.to-v.loadFrom)/step-missing.reduce((n,r)=>n+(r.to-r.from)/step,0),
   state:v.error?'failed':v.busy?'loading':capacityLimited?'capacity-limited':missing.length?'partial':'ready',capacityLimited,retryable:!!v.error||!v.busy&&missing.length>0,
   ...(v.error?{error:v.error}:{}),...(v.presented.size?{cachedSlots:v.presented.size}:{}),unloaded:unloaded.slice(0,64),unloadedTruncated:unloaded.length>64};
 }
 /** Only the authoritative native bootstrap/stream may acknowledge cache slots.
  * Viewport known-times can echo presentation and cannot do so on their own. */
 confirmClosed(bars:readonly Candle[]){
  const closed=bars.filter(bar=>bar.closed===true);let changed=false;
  for(const [id,v]of this.views){const relevant=closed.filter(bar=>bar.t%duration[this.series.interval]===0&&bar.t>=v.loadFrom&&bar.t<v.to);if(!relevant.length)continue;
   changed=true;v.cached=undefined;
   const step=duration[this.series.interval];for(let end=v.to;end>v.loadFrom;){const start=Math.max(v.loadFrom,end-1000*step);this.options.presentation?.seed(this.presentationKey(start,end),relevant.filter(bar=>bar.t>=start&&bar.t<end));end=start;}
   for(const bar of relevant){v.presented.delete(bar.t);v.received.add(bar.t);}
   if(!this.missing(v).length){v.error=undefined;if(v.busy){v.abort.abort();this.views.set(id,{...v,cached:undefined,abort:new AbortController(),busy:false,attempted:true});}}
  }
  if(changed)this.options.changed();
 }
 retry(id:string){const v=this.views.get(id);if(!v||v.busy)return false;v.error=undefined;v.attempted=false;void this.load(id,v);return true;}
 private async load(id:string,v:View){
  if(v.busy||!this.online||this.dead||this.views.get(id)!==v||v.abort.signal.aborted)return;
  v.busy=true;v.error=undefined;v.cached=undefined;this.options.changed();
  try{
   // Snapshot the missing plan once. A sparse/absent source is reported partial,
   // never polled in an infinite attempt to manufacture an empty covered range.
   const step=duration[this.series.interval];
   for(let to=v.to;to>v.loadFrom;){
    const from=Math.max(v.loadFrom,to-1000*step);
    let missing=false;for(let t=from;t<to;t+=step)if(!v.known.has(t)&&!v.received.has(t)){missing=true;break;}
    if(!missing){to=from;continue;}
    const params=new URLSearchParams({interval:this.series.interval,from:String(from)});
    if(marketOf(this.series)==='spot')params.set('market','spot');
    const url='/market-data/v1/native-candles?'+params;
    const eligibleAt=performance.now();
    const page=await (this.options.scheduler??historyScheduler).read(url,'candles',v.abort.signal,async signal=>{
     const version=this.options.version(),at=this.options.now();this.metrics.requests++;
     const data=await tracedHistoryJson(this.options.request,url,AbortSignal.any([signal,AbortSignal.timeout(60000)]),v.trace,eligibleAt,{maxDecodedBytes:2*1024*1024});
     if(data.source!=='binance-native-kline'||data.instrument!==undefined&&data.instrument!==`${instrumentKey(this.series)}:${instrumentOf(this.series).native}`||data.market!==undefined&&data.market!==marketOf(this.series)||!Array.isArray(data.candles)||data.candles.length>1000||!data.candles.every(validCandle))throw Error('Invalid native candle history identity');
     let prior=-1;for(const c of data.candles as Candle[]){if(c.t<from||c.t%step||c.t<=prior)throw Error('Invalid native candle history time ordering');prior=c.t;}
     return {candles:data.candles,version,at} as Page;
    });
    if(this.dead||this.views.get(id)!==v||v.abort.signal.aborted)return;
    this.options.presentation?.put(this.presentationKey(from,to),page.candles.filter(c=>c.t>=from&&c.t<to&&c.closed));
    const bars=page.candles.filter(c=>c.t>=from&&c.t<to&&c.closed&&!v.known.has(c.t)&&!v.received.has(c.t));
    const applyAt=performance.now(),covered=this.options.apply(id,bars,page.version,page.at);this.metrics.receivedBars+=covered.length;this.metrics.applyMs+=performance.now()-applyAt;
    for(const t of covered)if(t>=v.loadFrom&&t<v.to){v.received.add(t);v.presented.delete(t);}
    v.cached=undefined;this.options.changed();to=from;
   }
   v.attempted=true;
  }catch(error){if(!v.abort.signal.aborted&&this.views.get(id)===v){v.error=error instanceof Error?error.message:'Native candle history failed';v.cached=undefined;}}
  finally{v.busy=false;v.cached=undefined;if(!this.dead&&this.views.get(id)===v&&!v.abort.signal.aborted)this.options.changed();}
 }
 setOnline(online:boolean){
  if(this.online===online)return;this.online=online;
  for(const [id,v]of this.views){v.abort.abort();const next={...v,cached:undefined,known:new Set(v.known),received:new Set(v.received),presented:new Set(v.presented),abort:new AbortController(),busy:false,error:undefined};this.views.set(id,next);if(online)void this.load(id,next);}
  this.options.changed();
 }
 release(id:string){const view=this.views.get(id);view?.abort.abort();for(const release of view?.leases??[])release();this.views.delete(id);}
 dispose(){this.dead=true;for(const id of this.views.keys())this.release(id);}
 diagnostics(){return {...this.metrics,retainedOHLC:0,views:this.views.size,busy:[...this.views.values()].filter(v=>v.busy).length,retainedTimes:[...this.views.values()].reduce((n,v)=>n+new Set([...v.known,...v.received]).size,0)};}
}

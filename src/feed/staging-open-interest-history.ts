/** Dedicated-worker history owner. It never owns the live polling lifecycle. */
import {OI_HISTORY_CLIENT_LIMITS as LIMIT,oiHistoryRange,oiHistoryKey,planOiHistory,validateOiHistoryPayload,type OiHistoryPayload,type OiHistoryRange} from './raw-open-interest-history';
export type OiHistoryEvent=
 |{type:'raw-open-interest-history';ids:string[];key:string;payload:OiHistoryPayload}
 |{type:'raw-open-interest-history-status';ids:string[];range:OiHistoryRange;state:'loading'|'unavailable'|'partial'|'ready';reason?:'capacity'|'network'|'invalid'|'disabled'|'retry-budget'};
interface Demand {range:OiHistoryRange;windows:OiHistoryRange[];sent:Map<string,number>;known:Set<string>;blocked:Set<string>}
interface Cached {payload:OiHistoryPayload;bytes:number;serial:number}
interface Attempt {count:number;retryAt:number;retryable:boolean}
class ReadFailure extends Error {constructor(readonly reason:'network'|'invalid'|'disabled',readonly retryable:boolean){super('Historical OI unavailable');}}
/** Response limits apply to decoded bytes, including chunked/gzipped fetch bodies. */
export async function readOiHistoryResponse(response:Response,request:OiHistoryRange,signal:AbortSignal){
 if(!response.ok){await response.body?.cancel();throw new ReadFailure(response.status===404?'disabled':'network',[429,500,502,503,504].includes(response.status));}
 if(Number(response.headers.get('content-length')??0)>LIMIT.responseBytes){await response.body?.cancel();throw new ReadFailure('invalid',false);}
 if(!response.body)throw new ReadFailure('invalid',false);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,done=false;
 let cancelling:Promise<void>|undefined;const cancel=()=>cancelling??=reader.cancel().catch(()=>{}),abort=()=>{void cancel();};
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){done=true;break;}size+=part.value.byteLength;if(size>LIMIT.responseBytes)throw new ReadFailure('invalid',false);chunks.push(part.value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try{return {payload:validateOiHistoryPayload(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),request),bytes:size};}catch{throw new ReadFailure('invalid',false);}
 }finally{signal.removeEventListener('abort',abort);try{if(cancelling)await cancelling;else if(!done)await cancel();}finally{reader.releaseLock();}}
}
export class StagingOpenInterestHistory {
 private enabled:boolean;private dead=false;private disabledByServer=false;private demands=new Map<string,Demand>();private cache=new Map<string,Cached>();private attempts=new Map<string,Attempt>();
 private active?:{controller:AbortController;work:Promise<void>};private timer?:ReturnType<typeof setTimeout>;private serial=0;private cursor=0;private cacheBytes=0;
 readonly stats={requests:0,hits:0,failures:0,evictions:0,receivedBytes:0,capacityViews:0};
 constructor(private readonly emit:(event:OiHistoryEvent)=>void,enabled=false,private readonly request:typeof fetch=(...args)=>fetch(...args),private readonly now:()=>number=Date.now){this.enabled=enabled;}
 setViewport(id:string,value:OiHistoryRange,known:readonly string[]=[]){
  if(!this.enabled||this.dead)return;
  if(typeof id!=='string'||!id||id.length>160||!this.demands.has(id)&&this.demands.size>=LIMIT.subscribers||!Array.isArray(known)||known.length>LIMIT.windows||known.some(k=>typeof k!=='string'||k.length>160))throw Error('Historical OI consumer capacity');
  const range=oiHistoryRange(value,Number.MAX_SAFE_INTEGER),plan=planOiHistory(range,this.now()),previous=this.demands.get(id),keys=new Set(plan.windows.map(oiHistoryKey));
  const sent=new Map([...(previous?.sent??[])].filter(([key])=>keys.has(key)));
  this.demands.set(id,{range,windows:plan.windows,sent,known:new Set(known.filter(k=>keys.has(k))),blocked:new Set([...(previous?.blocked??[])].filter(k=>keys.has(k)))});
  if(!plan.windows.length)this.emit({type:'raw-open-interest-history-status',ids:[id],range,state:'ready'});
  else if(plan.capacityLimited){this.stats.capacityViews++;this.emit({type:'raw-open-interest-history-status',ids:[id],range,state:'partial',reason:'capacity'});}
  if(this.disabledByServer&&plan.windows.some(w=>!this.cache.has(oiHistoryKey(w))&&!known.includes(oiHistoryKey(w))))this.emit({type:'raw-open-interest-history-status',ids:[id],range,state:'unavailable',reason:'disabled'});
  this.schedule(0);
 }
 unsubscribe(id:string){this.demands.delete(id);if(!this.demands.size){clearTimeout(this.timer);this.timer=undefined;this.active?.controller.abort();}else this.schedule(0);}
 setEnabled(enabled:boolean){
  this.enabled=enabled;if(!enabled){clearTimeout(this.timer);this.timer=undefined;this.active?.controller.abort();this.demands.clear();this.cache.clear();this.attempts.clear();this.cacheBytes=0;this.disabledByServer=false;}
 }
 /** Explicit operator/user retry; navigation itself does not reset budgets. */
 retry(id:string){if(!this.enabled||this.dead)return;const demand=this.demands.get(id);if(!demand)return;this.disabledByServer=false;for(const range of demand.windows){const key=oiHistoryKey(range);this.attempts.delete(key);demand.sent.delete(key);demand.known.delete(key);for(const d of this.demands.values())d.blocked.delete(key);const cached=this.cache.get(key);if(cached){this.cacheBytes-=cached.bytes;this.cache.delete(key);}}this.schedule(0);}
 private schedule(ms:number){if(this.dead||!this.enabled||!this.demands.size||this.active)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;this.pump();},ms);}
 private deliver(key:string,cached:Cached,fresh=false){
  const ids:string[]=[];for(const [id,demand]of this.demands)if(demand.windows.some(w=>oiHistoryKey(w)===key)&&(fresh||!demand.known.has(key))&&demand.sent.get(key)!==cached.serial){demand.sent.set(key,cached.serial);ids.push(id);}
  if(ids.length){this.cache.delete(key);this.cache.set(key,cached);this.emit({type:'raw-open-interest-history',ids,key,payload:cached.payload});}
 }
 private interested(key:string){return [...this.demands].filter(([,d])=>d.windows.some(w=>oiHistoryKey(w)===key)).map(([id])=>id);}
 private pump(){
  if(this.dead||!this.enabled||this.active||!this.demands.size)return;
  const demands=[...this.demands.values()];let retryAt=Infinity,selected:OiHistoryRange|undefined;
  for(let offset=0;offset<demands.length&&!selected;offset++){
   const demand=demands[(this.cursor+offset)%demands.length]!;
   for(const range of demand.windows){
    const key=oiHistoryKey(range),cached=this.cache.get(key),attempt=this.attempts.get(key);
    if(demand.blocked.has(key))continue;
    if(cached){if(demand.sent.get(key)!==cached.serial&&!demand.known.has(key)){this.stats.hits++;this.deliver(key,cached);this.schedule(0);return;}}
    if(demand.known.has(key)||this.disabledByServer)continue;
    if(attempt){if(!attempt.retryable||attempt.count>=LIMIT.attempts)continue;if(attempt.retryAt>this.now()){retryAt=Math.min(retryAt,attempt.retryAt);continue;}}
    else if(cached||demand.sent.has(key))continue;
    selected=range;break;
   }
  }
  if(!selected){if(Number.isFinite(retryAt))this.schedule(Math.max(1,retryAt-this.now()));return;}
  this.cursor=(this.cursor+1)%demands.length;
  const range=structuredClone(selected),key=oiHistoryKey(range),controller=new AbortController();
  const work=Promise.resolve().then(()=>this.fetchTurn(key,range,controller));this.active={controller,work};
  void work.finally(()=>{if(this.active?.work===work)this.active=undefined;this.schedule(0);}).catch(()=>{});
 }
 private async fetchTurn(key:string,range:OiHistoryRange,controller:AbortController){
  if(controller.signal.aborted||this.dead||!this.enabled)return;
  const previousAttempt=this.attempts.get(key),attempt={count:(previousAttempt?.count??0)+1,retryAt:0,retryable:false};this.attempts.delete(key);this.attempts.set(key,attempt);
  while(this.attempts.size>LIMIT.cacheWindows*2){const old=[...this.attempts.keys()].find(k=>k!==key&&!this.interested(k).length);if(!old)break;this.attempts.delete(old);}
  // At most 15 keys per active consumer are materialized; refuse further
  // bookkeeping rather than evict another active request's retry budget.
  if(this.attempts.size>LIMIT.cacheWindows*2){this.attempts.delete(key);for(const d of this.demands.values())if(d.windows.some(w=>oiHistoryKey(w)===key))d.blocked.add(key);this.emit({type:'raw-open-interest-history-status',ids:this.interested(key),range,state:'partial',reason:'capacity'});return;}
  this.emit({type:'raw-open-interest-history-status',ids:this.interested(key),range,state:'loading'});
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},LIMIT.timeoutMs);
  try{
   this.stats.requests++;const params=new URLSearchParams({from:String(range.from),to:String(range.to),venues:range.venues.join(','),market:'perpetual'});
   const response=await this.request(`/market-data/v2/history/raw-open-interest?${params}`,{signal:controller.signal});
   const result=await readOiHistoryResponse(response,range,controller.signal);
   if(controller.signal.aborted||this.dead||!this.enabled)return;
   const prior=this.cache.get(key);if(prior)this.cacheBytes-=prior.bytes;this.cache.delete(key);
   const cached={...result,serial:++this.serial};this.cache.set(key,cached);this.cacheBytes+=result.bytes;this.stats.receivedBytes+=result.bytes;
   while(this.cache.size>LIMIT.cacheWindows||this.cacheBytes>LIMIT.cacheBytes){const oldest=this.cache.keys().next().value!;this.cacheBytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest);this.stats.evictions++;}
   const retryable=result.payload.hot.state==='unavailable'||result.payload.warm.state==='unavailable'||result.payload.warm.state==='publication-asof'&&result.payload.warm.venues.some(v=>v.failures.some(f=>f.reason==='origin'));
   attempt.retryable=retryable;attempt.retryAt=this.now()+LIMIT.retryMs;this.deliver(key,cached,true);
  }catch(error){
   if(controller.signal.aborted&&!timedOut||this.dead||!this.enabled)return;
   this.stats.failures++;const failure=error instanceof ReadFailure?error:new ReadFailure('network',true);attempt.retryable=failure.retryable;attempt.retryAt=this.now()+LIMIT.retryMs;
   if(failure.reason==='disabled')this.disabledByServer=true;
   this.emit({type:'raw-open-interest-history-status',ids:failure.reason==='disabled'?[...this.demands.keys()]:this.interested(key),range,state:'unavailable',reason:attempt.count>=LIMIT.attempts?'retry-budget':failure.reason});
  }finally{clearTimeout(timeout);if(controller.signal.aborted&&!timedOut&&this.enabled&&!this.dead&&this.attempts.get(key)===attempt){if(previousAttempt)this.attempts.set(key,previousAttempt);else this.attempts.delete(key);}}
 }
 diagnostics(){return {enabled:this.enabled,closed:this.dead,disabledByServer:this.disabledByServer,subscribers:this.demands.size,active:!!this.active,cacheWindows:this.cache.size,cacheBytes:this.cacheBytes,attemptKeys:this.attempts.size,...this.stats};}
 async close(){this.dead=true;this.setEnabled(false);await this.active?.work.catch(()=>{});}
}

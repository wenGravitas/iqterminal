import {receiveWallBatch} from './prepared-wall-batch-reader';
import {yieldHistoryTask} from './history-task-yield';
import {WALL_POINT_TRANSPORT,WALL_PRODUCT_POINT_TRANSPORT,decodeWallPointTransport} from '../shared/order-wall-point-transport';
import {historyScheduler} from './history-scheduler';
import type {PreparedWallFetched} from './prepared-wall-history';
interface Part {index:number;bytes:number;hash:string}
interface Options {url:string;key:string;revision:string;parts:Part[];fetcher:typeof fetch;signal:AbortSignal;maxParts?:8|32;pointTransport?:boolean|2}
interface Slot {promise:Promise<PreparedWallFetched>;resolve:(value:PreparedWallFetched)=>void;reject:(reason:unknown)=>void}
interface Group {identity:string;abort:AbortController;slots:Map<number,Slot>;refs:number;finished?:boolean}
const groups=new Map<string,Group>();
const aborted=()=>new DOMException('Aborted','AbortError');
class TemporaryBatchResponse extends Error {constructor(message:string,readonly retryAfterMs=0){super(message);}}
function retryDelay(ms:number,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(aborted());return;}
  const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(aborted());};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
  signal.addEventListener('abort',cancel,{once:true});
 });
}
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,'0')).join('');
function deferred():Slot {let resolve!:Slot['resolve'],reject!:Slot['reject'];const promise=new Promise<PreparedWallFetched>((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return {promise,resolve,reject};}
/** A shared request keeps its scheduler admission through EOF, but publishes
 * hash-validated member promises as bytes arrive. At most one bounded batch is
 * retained per reader. Cancellation removes only that reader's reference. */
export function acquireWallBatch(options:Options){
 const {url,parts,signal,fetcher}=options;if(signal.aborted)throw aborted();
 const identity=JSON.stringify([options.key,options.revision,parts,options.pointTransport??false]);let group=groups.get(url);
 if(group&&group.identity!==identity)throw Error('Prepared wall shared batch identity mismatch');
 if(!group){
  group={identity,abort:new AbortController(),slots:new Map(parts.map(p=>[p.index,deferred()])),refs:0};groups.set(url,group);
  const work=group;
  const attemptRead=(attempt:number)=>historyScheduler.read(url,'order-walls',work.abort.signal,async upstream=>{
   const started=performance.now(),response=await fetcher(url,{signal:upstream}),responseHeadersMs=performance.now()-started;
   if(!response.ok){
    await response.body?.cancel();const message='Prepared wall batch HTTP '+response.status;
    // Retry only a response that published no members. Hash/identity/source
    // failures and interrupted bodies remain explicit failures, never replays.
    const retryAfter=response.headers.get('retry-after');
    // Honor bounded server backoff. A longer or unrecognized directive is an
    // explicit failure for user Retry, rather than an aggressive retry loop.
    const seconds=retryAfter===null?0:/^\d+$/.test(retryAfter)?Number(retryAfter):Infinity;
    if([408,502,503,504].includes(response.status)&&seconds<=2)throw new TemporaryBatchResponse(message,seconds*1000);
    throw Error(message);
   }
   const first=parts[0]!.index,next=parts.at(-1)!.index+1,expectedBytes=parts.reduce((n,p)=>n+p.bytes+1,0);
   if(response.headers.get('x-iq-wall-start')!==String(first)||response.headers.get('x-iq-wall-next')!==String(next)
    ||response.headers.get('x-iq-wall-parts')!==String(parts.length)||response.headers.get('x-iq-chunk-key')!==options.key
    ||response.headers.get('x-iq-source-revision')!==options.revision){await response.body?.cancel();throw Error('Prepared wall batch identity mismatch');}
   let wireParts=parts.map(p=>p.bytes),wireBytes=expectedBytes;
   if(options.pointTransport){const sizes=response.headers.get('x-iq-wall-part-bytes');try{wireParts=sizes&&sizes.length<=512?JSON.parse(sizes):[];}catch{wireParts=[];}
    if(response.headers.get('x-iq-wall-transport')!==(options.pointTransport===2?WALL_PRODUCT_POINT_TRANSPORT:WALL_POINT_TRANSPORT)||response.headers.get('x-iq-canonical-bytes')!==String(expectedBytes)||!Array.isArray(wireParts)||wireParts.length!==parts.length||wireParts.some((size,i)=>!Number.isSafeInteger(size)||size<2||size>parts[i]!.bytes)) {await response.body?.cancel();throw Error('Prepared wall point transport identity mismatch');}
    wireBytes=wireParts.reduce((n,size)=>n+size+1,0);if(response.headers.get('x-iq-decoded-bytes')!==String(wireBytes)){await response.body?.cancel();throw Error('Prepared wall point transport byte identity mismatch');}
   }else if(response.headers.has('x-iq-wall-transport')){await response.body?.cancel();throw Error('Unexpected prepared wall point transport');}
   if(expectedBytes>8*1024*1024||parts.length>(options.maxParts??8)||!response.body){await response.body?.cancel();throw Error('Prepared wall batch byte capacity');}
   // Receive independently of cooperative decode. The manifest bounds this
   // single buffer; admission stays held until validation/application finishes.
   const receiver=receiveWallBatch(response.body,wireBytes,upstream);
   try{
    for(const [i,part] of parts.entries()){
     const bodyStarted=performance.now(),wireSize=wireParts[i]!,framed=await receiver.exact(wireSize+1),raw=framed.subarray(0,wireSize);
     if(framed[wireSize]!==10)throw Error('Prepared wall batch part content hash mismatch');
     upstream.throwIfAborted();const bodyReadMs=performance.now()-bodyStarted,parse=performance.now();
     let body:unknown,canonical:Uint8Array=raw,jsonParseMs=0,validationMs=0,validationYieldMs=0;
     if(options.pointTransport){body=JSON.parse(new TextDecoder().decode(raw));jsonParseMs=performance.now()-parse;const validationAt=performance.now();let yielded=performance.now();
      const decoded=await decodeWallPointTransport(body,async()=>{upstream.throwIfAborted();if(performance.now()-yielded>=8){const at=performance.now();await yieldHistoryTask(upstream,'user-visible');validationYieldMs+=performance.now()-at;yielded=performance.now();}},{bytes:raw.byteLength,max:part.bytes},options.pointTransport===2?2:1);body=decoded.value;if(decoded.changed)canonical=new TextEncoder().encode(JSON.stringify(body));
      if(canonical.byteLength!==part.bytes||await digest(canonical)!==part.hash)throw Error('Prepared wall batch part content hash mismatch');validationMs=performance.now()-validationAt;
     }else{const validationAt=performance.now();if(await digest(raw)!==part.hash)throw Error('Prepared wall batch part content hash mismatch');validationMs=performance.now()-validationAt;const at=performance.now();body=JSON.parse(new TextDecoder().decode(raw));jsonParseMs=performance.now()-at;}
     upstream.throwIfAborted();
     // EOF/trailing-byte validation must precede the terminal member. Earlier
     // validated members remain an honest resumable prefix on a truncated tail.
     if(i===parts.length-1)await receiver.finish();
     const headers=new Headers(response.headers);if(i>0)headers.set('content-length','0');
     if(i===parts.length-1)work.finished=true;
     work.slots.get(part.index)!.resolve({response:i===0?response:new Response(null,{headers}),body,bytes:part.bytes,responseHeadersMs:i===0?responseHeadersMs:0,bodyReadMs,jsonParseMs,validationMs,validationYieldMs,attempts:attempt});
    }
   }finally{await receiver.close();}
  });
  void (async()=>{
   for(let attempt=1;attempt<=3;attempt++){
    try{await attemptRead(attempt);return;}
    catch(error){
     if(!(error instanceof TemporaryBatchResponse)||attempt===3||work.abort.signal.aborted)throw error;
     // Admission is released before backoff/requeue, so another visible chart
     // can progress. The same shared group and consumer cursors stay intact.
     await retryDelay(Math.max(250*attempt,error.retryAfterMs),work.abort.signal);
    }
   }
  })().catch(error=>{for(const slot of work.slots.values())slot.reject(error);});
 }
 const selected=group;selected.refs++;let released=false;
 const release=()=>{if(released)return;released=true;signal.removeEventListener('abort',release);if(--selected.refs===0){if(!selected.finished)selected.abort.abort();if(groups.get(url)===selected)groups.delete(url);}};
 signal.addEventListener('abort',release,{once:true});
 return {release,read:async(index:number)=>{
  if(released||signal.aborted)throw aborted();const slot=selected.slots.get(index);if(!slot)throw Error('Prepared wall batch index mismatch');
  return new Promise<PreparedWallFetched>((resolve,reject)=>{
   const cancel=()=>{signal.removeEventListener('abort',cancel);reject(aborted());};signal.addEventListener('abort',cancel,{once:true});
   void slot.promise.then(value=>{signal.removeEventListener('abort',cancel);resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
  });
 }};
}

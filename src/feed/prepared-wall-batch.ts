import {historyScheduler} from './history-scheduler';
import type {PreparedWallFetched} from './prepared-wall-history';
interface Part {index:number;bytes:number;hash:string}
interface Options {url:string;key:string;revision:string;parts:Part[];fetcher:typeof fetch;signal:AbortSignal;maxParts?:8|32}
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
 const identity=JSON.stringify([options.key,options.revision,parts]);let group=groups.get(url);
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
   if(expectedBytes>8*1024*1024||parts.length>(options.maxParts??8)||!response.body){await response.body?.cancel();throw Error('Prepared wall batch byte capacity');}
   const reader=response.body.getReader();let chunk:Uint8Array=new Uint8Array(0),offset=0,received=0,complete=false;
   const cancelReader=()=>{void reader.cancel(aborted()).catch(()=>{});};
   upstream.addEventListener('abort',cancelReader,{once:true});if(upstream.aborted)cancelReader();
   async function pull(){
    upstream.throwIfAborted();const item=await reader.read();if(item.done)return false;
    received+=item.value.byteLength;if(received>expectedBytes)throw Error('Prepared wall batch byte identity mismatch');
    chunk=item.value;offset=0;return true;
   }
   async function exact(length:number){
    const result=new Uint8Array(length);let written=0;
    while(written<length){if(offset===chunk.byteLength&&!await pull())throw Error('Prepared wall batch byte identity mismatch');
     const n=Math.min(length-written,chunk.byteLength-offset);result.set(chunk.subarray(offset,offset+n),written);written+=n;offset+=n;}
    return result;
   }
   try{
    for(const [i,part] of parts.entries()){
     const bodyStarted=performance.now(),framed=await exact(part.bytes+1),raw=framed.subarray(0,part.bytes);
     if(framed[part.bytes]!==10||await digest(raw)!==part.hash)throw Error('Prepared wall batch part content hash mismatch');
     upstream.throwIfAborted();const bodyReadMs=performance.now()-bodyStarted,parse=performance.now(),body:unknown=JSON.parse(new TextDecoder().decode(raw)),jsonParseMs=performance.now()-parse;
     // EOF/trailing-byte validation must precede the terminal member. Earlier
     // validated members remain an honest resumable prefix on a truncated tail.
     if(i===parts.length-1){if(offset!==chunk.byteLength||await pull()||received!==expectedBytes)throw Error('Prepared wall batch byte identity mismatch');complete=true;}
     const headers=new Headers(response.headers);if(i>0)headers.set('content-length','0');
     if(i===parts.length-1)work.finished=true;
     work.slots.get(part.index)!.resolve({response:i===0?response:new Response(null,{headers}),body,bytes:part.bytes,responseHeadersMs:i===0?responseHeadersMs:0,bodyReadMs,jsonParseMs,attempts:attempt});
    }
   }finally{upstream.removeEventListener('abort',cancelReader);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
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

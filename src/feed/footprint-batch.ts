import {historyScheduler} from './history-scheduler';
import {recordHistoryTrace,type HistoryRequestTrace} from './history-trace';

const path='/market-data/v2/history/footprints-batch';
const maxFrameBytes=8*1024*1024+4096;
export class FootprintBatchUnsupported extends Error {}
type Member={from:number;to:number;interval:string;rowPrice:number;market:string;known?:string;job?:string;retry?:boolean};
type Delivery={index:number;data?:any;error?:Error;metrics?:Record<string,number>};
type Accept=(index:number,data:any,error?:Error)=>Promise<void>;
type Consumer={signal:AbortSignal;accept:Accept;chain:Promise<void>;resolve:()=>void;reject:(error:unknown)=>void;cancel:()=>void};
type Work={abort:AbortController;consumers:Set<Consumer>;frames:Delivery[]};
const pools=new WeakMap<typeof fetch,Map<string,Work>>();
const unsupportedUntil=new WeakMap<typeof fetch,number>();
const same=(a:any,b:Member)=>a&&['from','to','interval','rowPrice','market'].every(k=>a[k]===b[k as keyof Member]);
export function footprintBatchMember(url:string):Member{
 const p=new URL(url,'http://localhost').searchParams;
 return {from:Number(p.get('from')),to:Number(p.get('to')),interval:p.get('interval')!,rowPrice:Number(p.get('rowPrice')),market:p.get('market')??'perpetual',known:p.get('known')??'',...(p.has('job')?{job:p.get('job')!}:{}),...(p.has('retry')?{retry:p.get('retry')==='1'}:{})};
}

/** Strict progressive framing. Withhold the final member until end AND EOF;
 * a truncated stream must not make the final visible chunk complete. */
export async function decodeFootprintBatch(response:Response,members:Member[],signal:AbortSignal,accept:(delivery:Delivery)=>Promise<void>,timing={decodeMs:0,applyMs:0}){
 if(response.headers.get('x-iq-footprint-batch')!=='1'||response.headers.get('x-iq-batch-chunks')!==String(members.length)||!response.headers.get('content-type')?.startsWith('application/x-ndjson')||!response.body)throw Error('Invalid footprint batch response');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',decodedBytes=0,index=0,failed=0,ended=false,pending:Delivery|undefined;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 const frame=async(line:string)=>{
  if(ended)throw Error('Unexpected footprint batch trailing frame');
  if(new TextEncoder().encode(line).byteLength>maxFrameBytes)throw Error('Footprint batch frame byte capacity');
  const parseAt=performance.now(),value=JSON.parse(line);timing.decodeMs+=performance.now()-parseAt;
  if(value?.version!==1)throw Error('Invalid footprint batch version');
  if(value.kind==='end'){
   if(index!==members.length||value.members!==members.length||value.failed!==failed)throw Error('Invalid footprint batch end');ended=true;return;
  }
  if(index>=members.length||value.index!==index||!same(value.request,members[index]!)||!['chunk','error'].includes(value.kind))throw Error('Invalid footprint batch member identity/order');
  let delivery:Delivery;
  if(value.kind==='error'){
   if(!value.error||typeof value.error.message!=='string'||value.error.message.length>500||!['query','capacity','invalid-content'].includes(value.error.category)||typeof value.error.retryable!=='boolean')throw Error('Invalid footprint batch error');
   failed++;delivery={index,error:Object.assign(new Error(value.error.message),{category:value.error.category,retryable:value.error.retryable})};
  }else{if(!value.data||typeof value.data!=='object')throw Error('Invalid footprint batch data');delivery={index,data:value.data,metrics:value.metrics};}
  index++;if(index===members.length)pending=delivery;else{const at=performance.now();await accept(delivery);timing.applyMs+=performance.now()-at;}
 };
 try{
  for(;;){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;
   decodedBytes+=value.byteLength;if(decodedBytes>(members.length+1)*maxFrameBytes)throw Error('Footprint batch response byte capacity');
   const decodeAt=performance.now();buffer+=decoder.decode(value,{stream:true});timing.decodeMs+=performance.now()-decodeAt;let newline:number;
   while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);await frame(line);signal.throwIfAborted();await new Promise<void>(resolve=>setTimeout(resolve,0));}
   if(buffer.length>maxFrameBytes)throw Error('Footprint batch frame byte capacity');
  }
  buffer+=decoder.decode();if(buffer||!ended||!pending)throw Error('Truncated footprint batch response');signal.throwIfAborted();const at=performance.now();await accept(pending);timing.applyMs+=performance.now()-at;return decodedBytes;
 }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Coalesce identical bounded waves, including revision hints/commands. A panel
 * releases only its own interest. The shared scheduler owns one slot until EOF. */
export function readFootprintBatch(request:typeof fetch,urls:string[],signal:AbortSignal,accept:Accept,viewId:string,priority=0):Promise<void>{
 if(signal.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
 if((unsupportedUntil.get(request)??0)>performance.now())return Promise.reject(new FootprintBatchUnsupported());
 if(!urls.length||urls.length>6)return Promise.reject(Error('Footprint batch member capacity'));
 const members=urls.map(footprintBatchMember),body=JSON.stringify({version:1,requests:members}),key=path+body;
 let pool=pools.get(request);if(!pool){pool=new Map();pools.set(request,pool);}
 let work=pool.get(key),fresh=false;if(!work){fresh=true;work={abort:new AbortController(),consumers:new Set(),frames:[]};pool.set(key,work);}
 const shared=work;let terminal=false;
 const remove=(c:Consumer,error?:unknown)=>{if(!shared.consumers.delete(c))return;c.signal.removeEventListener('abort',c.cancel);if(error!==undefined)c.reject(error);else c.resolve();if(!shared.consumers.size){if(pool!.get(key)===shared)pool!.delete(key);if(!terminal)shared.abort.abort();}};
 const deliver=(c:Consumer,d:Delivery)=>{c.chain=c.chain.then(async()=>{if(shared.consumers.has(c)&&!c.signal.aborted)await c.accept(d.index,d.data,d.error);}).catch(error=>remove(c,error));return c.chain;};
 const result=new Promise<void>((resolve,reject)=>{
  const c:Consumer={signal,accept,chain:Promise.resolve(),resolve,reject,cancel:()=>remove(c,signal.reason??new DOMException('Aborted','AbortError'))};shared.consumers.add(c);signal.addEventListener('abort',c.cancel,{once:true});for(const frame of shared.frames)void deliver(c,frame);
 });
 if(fresh){
  const eligibleAt=performance.now();
  void historyScheduler.read(key,'footprint',shared.abort.signal,async scheduled=>{
   const combined=AbortSignal.any([scheduled,AbortSignal.timeout(30_000)]),wireAt=performance.now();
   const trace:HistoryRequestTrace={id:viewId,url:path,eligibleAt,wireAt,queueMs:wireAt-eligibleAt,requestedFrom:Math.min(...members.map(m=>m.from)),requestedTo:Math.max(...members.map(m=>m.to)),chunks:members.length};recordHistoryTrace(trace);
   try{
    const response=await request(path,{method:'POST',headers:{'Content-Type':'application/json','X-IQ-View-Id':viewId},body,signal:combined});trace.headersAt=performance.now();trace.headerMs=trace.headersAt-wireAt;trace.requestId=response.headers.get('x-iq-request-id')??undefined;
    for(const [name,header]of [['proxyQueueMs','x-iq-proxy-queue-ms'],['proxyHeaderMs','x-iq-proxy-header-ms']]as const){const value=response.headers.get(header);if(value!==null)trace[name]=Number(value);}
    if([404,405,501].includes(response.status)){await response.body?.cancel();unsupportedUntil.set(request,performance.now()+60_000);throw new FootprintBatchUnsupported();}
    if(!response.ok){await response.body?.cancel();throw Error(`Footprint batch HTTP ${response.status}`);}
    const timing={decodeMs:0,applyMs:0};
    try{trace.decodedBytes=await decodeFootprintBatch(response,members,combined,async delivery=>{
     for(const [field,name]of [['dbQueries','queries'],['dbReadRows','readRows'],['dbReadBytes','readBytes']]as const){const value=delivery.metrics?.[name];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)trace[field]=(trace[field]??0)+value;}
     trace.slots=(trace.slots??0)+(delivery.data?.tiles?.length??0);if(delivery.data?.state)trace.state=delivery.data.state;
     shared.frames.push(delivery);await Promise.all([...shared.consumers].map(c=>deliver(c,delivery)));
    },timing);}
    finally{trace.decodeMs=timing.decodeMs;trace.applyMs=timing.applyMs;}
    trace.receivedAt=performance.now();trace.streamMs=trace.receivedAt-trace.headersAt;
    // Stream elapsed overlaps decode/apply and yielding; never sum as exclusive phases.
    const length=response.headers.get('content-length');if(length!==null)trace.encodedBytes=Number(length);
    // Concurrent batches share a URL; Resource Timing alone cannot correlate
    // their encoded bytes safely. Browser network receipts capture those sizes.
   }catch(error){trace.error=error instanceof Error?error.message:String(error);throw error;}
  },priority).then(()=>{terminal=true;for(const c of [...shared.consumers])remove(c);},error=>{terminal=true;for(const c of [...shared.consumers])remove(c,error);}).finally(()=>{if(pool!.get(key)===shared)pool!.delete(key);shared.frames.length=0;});
 }
 return result;
}

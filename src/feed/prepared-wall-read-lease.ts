import {HistoryScheduler} from './history-scheduler';
/** One bounded control lane keeps lease renewal/cancellation independent of
 * long history body reads. No slot is held between renewals. */
export const wallReadControlScheduler=new HistoryScheduler(1);
const endpoint='/market-data/v2/history/walls/reader';
export interface PreparedWallReadLease {signal:AbortSignal;assertActive:()=>void;release:()=>void}
export async function acquirePreparedWallReadLease(identity:{canonicalKey:string;projectionKey?:string},fetcher:typeof fetch,signal:AbortSignal):Promise<PreparedWallReadLease>{
 if(!/^[a-f0-9]{64}$/.test(identity.canonicalKey)||identity.projectionKey!==undefined&&!/^[a-f0-9]{64}$/.test(identity.projectionKey))throw Error('Invalid wall reader lease identity');
 const consumer=crypto.randomUUID(),abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,expires=0,closed=false,failure:Error|undefined;
 const combined=AbortSignal.any([signal,abort.signal]);
 const release=()=>{
  if(closed)return;closed=true;clearTimeout(timer);signal.removeEventListener('abort',release);abort.abort();
  const url='/market-data/v2/history/walls/preparation?'+new URLSearchParams({consumer});
  void wallReadControlScheduler.read(url,'order-walls',AbortSignal.timeout(2000),async upstream=>{
   const response=await fetcher(url,{method:'DELETE',signal:upstream});await response.body?.cancel();if(!response.ok&&response.status!==404)throw Error('Wall reader release HTTP '+response.status);
  }).catch(()=>{});
 };
 const assertActive=()=>{if(failure)throw failure;combined.throwIfAborted();if(closed||performance.now()>=expires){failure=Error('Wall history reader lease expired; Retry available with good bars retained');release();throw failure;}};
 async function renew(){
  const sent=performance.now();
  const response=await wallReadControlScheduler.read(endpoint+'#'+consumer,'order-walls',AbortSignal.any([combined,AbortSignal.timeout(3000)]),async upstream=>{
   const r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consumer,...identity}),signal:upstream});
   if(!r.ok){await r.body?.cancel();throw Error('Wall reader lease HTTP '+r.status);}
   const reader=r.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
   if(!reader)throw Error('Invalid wall reader lease response body');
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();throw Error('Invalid wall reader lease response size');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
   return JSON.parse(text);
  });
  if(response.version!==1||response.leaseMs!==15000||response.canonicalKey!==identity.canonicalKey||response.projectionKey!==identity.projectionKey)throw Error('Invalid wall reader lease identity');
  // The send clock is conservative: no cross-host timestamp subtraction.
  expires=sent+response.leaseMs;assertActive();
  timer=setTimeout(()=>{void renew().catch(error=>{failure=Error('Wall history reader lease lost; Retry available: '+String(error?.message??error).slice(0,200));release();});},5000);
 }
 signal.throwIfAborted();signal.addEventListener('abort',release,{once:true});
 try{await renew();return {signal:combined,assertActive,release};}catch(error){release();throw error;}
}

import {wallInputCapacity} from './wall-input-capacity';
import {validateWallEligibleDiscovery,type WallEligibleDiscovery} from './wall-history-horizon';
import {wallReadControlScheduler} from './prepared-wall-read-lease';
import {historyHttpError} from './history-http-error';
import {historyScheduler} from './history-scheduler';
import {WALL_PROJECTION_CORE_SHA256} from '../shared/order-walls-projection-version';
import type {PreparedWallRequest} from './prepared-wall-history';
export interface WallPreparationProgress {
 id:string;phase:'source'|'canonical'|'projection'|'ready';state:'building'|'paused'|'failed'|'ready';pages:number;projectionPages:number;selectedParts?:number;
 category?:string;error?:string;retryable?:boolean;
 sourceCoverage?:{availableFrom:number|null;confirmedTo:number|null;gapCount:number;gapsTruncated:boolean};
}
/** History progress stays separate from the live feed's freshness state. */
export function wallPreparationReason(value:WallPreparationProgress){
 const parts=`${value.phase}; ${value.pages} canonical / ${value.projectionPages} projected input pages${value.selectedParts===undefined?'':` / ${value.selectedParts} selected parts`}.`;
 return value.state==='paused'?`Wall history preparation paused: ${value.error??'waiting for processing capacity; resumes automatically.'} (${parts})`:`Preparing wall history: ${parts}`;
}
export class PreparedWallPreparationError extends Error {
 constructor(message:string,readonly category:string,readonly retryable:boolean){super(message);this.name='PreparedWallPreparationError';}
}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function progress(raw:any,request:PreparedWallRequest):WallPreparationProgress {
 const r=raw?.request,inputLimit=raw?.inputCapacity===undefined?128:wallInputCapacity(raw.inputCapacity).canonicalParts;
 if(!raw||! /^[a-f0-9]{64}$/.test(raw.id??'')||!r||r.market!==request.market||r.profile!==request.profile||r.from!==request.from||r.to!==request.to
  ||!['source','canonical','projection','ready'].includes(raw.phase)||!['building','paused','failed','ready'].includes(raw.state)
  ||!integer(raw.pages)||raw.pages>inputLimit||!integer(raw.projectionPages)||raw.projectionPages>inputLimit||raw.state==='ready'&&raw.phase!=='ready'
  ||raw.parts!==undefined&&(!integer(raw.parts)||raw.parts>512)
  ||raw.retryable!==undefined&&typeof raw.retryable!=='boolean'
  ||raw.category!==undefined&&!['source-changed','source-unavailable','capacity','invalid-content','query'].includes(raw.category))throw Error('Invalid wall preparation progress identity');
 let sourceCoverage:WallPreparationProgress['sourceCoverage'];
 if(raw.coverage){const c=raw.coverage;if(![c.availableFrom,c.confirmedTo].every(v=>v===null||integer(v))||!integer(c.gapCount)||typeof c.gapsTruncated!=='boolean')throw Error('Invalid wall preparation source coverage');
  sourceCoverage={availableFrom:c.availableFrom,confirmedTo:c.confirmedTo,gapCount:c.gapCount,gapsTruncated:c.gapsTruncated};}
 return {id:raw.id,phase:raw.phase,state:raw.state,pages:raw.pages,projectionPages:raw.projectionPages,...(raw.parts===undefined?{}:{selectedParts:raw.parts}),...(raw.category?{category:raw.category}:{}),
  ...(raw.error?{error:String(raw.error).slice(0,500)}:{}),...(raw.retryable!==undefined?{retryable:raw.retryable}:{}),...(sourceCoverage?{sourceCoverage}:{})};
}
function delay(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
 const done=()=>{signal.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,ms);
 const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',cancel,{once:true});
});}
const readerHandoffs=new WeakMap<object,()=>void>();
/** Local ownership only; never serialized or inferred from untrusted discovery fields. */
export function releasePreparedWallHandoff(found:unknown){if(found&&typeof found==='object')readerHandoffs.get(found)?.();}
/** Waiting never holds a scheduler/socket slot. A unique interest identity avoids
 * coalescing requests with different lease ownership into one admitted consumer. */
export async function discoverPreparedWallAdmission(options:{request:PreparedWallRequest;url:string;projection:boolean;fetcher:typeof fetch;signal:AbortSignal;
 retainForReader?:boolean;resolveEligibility?:boolean;onEligibility?:(value:WallEligibleDiscovery)=>void;decode:(response:Response,max:number)=>Promise<any>;onPreparation?:(value:WallPreparationProgress)=>void;retry?:{token:string;newRevision?:boolean}}){
 const {projection,fetcher,signal}=options,consumer=crypto.randomUUID();let request=options.request,url=options.url,eligibility:WallEligibleDiscovery|undefined,job:string|undefined,leased=false;
 let transferred=false;
 const result=(found:any)=>{
  const value=eligibility?{...found,eligibility}:found;
  if(options.retainForReader&&leased&&value?.state==='ready'&&value.readerLease){
   let done=false;const finish=()=>{if(done)return;done=true;signal.removeEventListener('abort',finish);readerHandoffs.delete(value);release();};
   readerHandoffs.set(value,finish);signal.addEventListener('abort',finish,{once:true});transferred=true;
  }return value;
 };
 const release=()=>{
  const cancel='/market-data/v2/history/walls/preparation?'+new URLSearchParams({consumer});
  void wallReadControlScheduler.read(cancel,'order-walls',AbortSignal.timeout(2000),async upstream=>{
   const response=await fetcher(cancel,{method:'DELETE',signal:upstream});await response.body?.cancel();
   if(!response.ok&&response.status!==404)throw Error('Wall preparation release HTTP '+response.status);
  },-1).catch(()=>{}); // Expiring server leases bound work if cancellation cannot arrive.
 };
 try{for(;;){
  const found=await historyScheduler.read(url+'#consumer='+consumer+(projection?'&projection='+WALL_PROJECTION_CORE_SHA256:''),'order-walls',signal,async upstream=>{
   const headers:Record<string,string>={'X-IQ-Wall-Consumer':consumer,...(projection?{'X-IQ-Wall-Projection':WALL_PROJECTION_CORE_SHA256,'X-IQ-Wall-Projection-Only':'1'}:{}),...(job?{'X-IQ-Wall-Job':job}:{}),...(options.resolveEligibility&&!eligibility?{'X-IQ-Wall-Resolve-Eligible':'1'}:{}),
    ...(options.retry?{'X-IQ-Wall-Retry':options.retry.token,...(options.retry.newRevision?{'X-IQ-Wall-New-Revision':'1'}:{})}:{})};
   const response=await fetcher(url,{signal:upstream,headers});
   if(!response.ok){if(response.status===404){await response.body?.cancel();return null;}throw await historyHttpError(response,upstream,'Prepared wall discovery');}
   return options.decode(response,8*1024*1024);
  });
  if(found?.preparation)leased=true;
  signal.throwIfAborted();
  if(options.resolveEligibility&&!eligibility){
   // Older gateways may ignore the opt-in. Let the caller use its explicit
   // horizon compatibility path; do not poll a future unbounded legacy job.
   if(!found?.eligibility){if(found?.preparation)leased=true;return found;}
   eligibility=validateWallEligibleDiscovery(found.eligibility,options.request);request=eligibility.request;
   const pinned=new URL(url,'http://localhost');pinned.searchParams.set('to',String(request.to));url=pinned.pathname+pinned.search;
   if((found.state==='future')!==(request.to===request.from))throw Error('Invalid eligible wall discovery state');
   options.onEligibility?.(eligibility);signal.throwIfAborted();
  }
  if(!found?.preparation)return result(found);
  leased=true;const p=found.preparation;
  if(p.version!==1||!integer(p.leaseMs)||p.leaseMs<1000||p.leaseMs>60000||!integer(p.pollMs)||p.pollMs<250||p.pollMs>2000||p.pollMs*2>p.leaseMs)throw Error('Invalid wall preparation polling bounds');
  const value=progress(p.job,request);job=value.id;
  if(value.state==='failed')throw new PreparedWallPreparationError(value.error??'Wall history preparation failed',value.category??'query',value.retryable!==false);
  if(value.state==='ready'){
   if(found.state!=='ready')throw new PreparedWallPreparationError('Prepared wall source changed; retry the view as a new revision','source-changed',true);
   return result(found);
  }
  options.onPreparation?.(value);await delay(p.pollMs,signal);
 }}finally{if(leased&&!transferred)release();}
}

import {historyScheduler} from './history-scheduler';
import {WallResidentHistory,WALL_RESIDENT_LIMITS,type WallInterval} from './wall-resident-history';
import type {OrderWallArchiveStatus,OrderWallStatus,OrderWallSegment} from './order-walls';
import type {OrderWallsArchiveResult} from './order-walls-archive';
export interface ArchivedWallRequest extends WallInterval {market:'spot'|'perpetual';profile:string}
export interface ArchivedWallShard {key:string;partition:string;request:ArchivedWallRequest;canonicalKey:string;projectionKey:string;sourceToken:string;catalogueState:'complete'|'partial'}
interface Span extends WallInterval {state:'archived'|'unavailable'|'ambiguous';shard?:string}
export interface ArchivedWallPlan {version:1;kind:'iq-archived-wall-range-plan-v1';delivery:{version:1;archiveOnlyReads:true};request:ArchivedWallRequest;revision:string;shards:ArchivedWallShard[];spans:Span[];coverage:{scope:'catalogue-only';nativeVerified:false;requestComplete:false;state:'archived'|'partial'|'unavailable'};financialAcceptance:false;retirementAuthorized:false}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const interval=(v:any)=>v&&Number.isSafeInteger(v.from)&&Number.isSafeInteger(v.to)&&v.from>0&&v.to>v.from;
const same=(a:ArchivedWallRequest,b:ArchivedWallRequest)=>a.market===b.market&&a.profile===b.profile&&a.from===b.from&&a.to===b.to;
const intersects=(a:WallInterval,b:WallInterval)=>a.from<b.to&&b.from<a.to;
export async function validateArchivedWallPlan(value:any,request:ArchivedWallRequest):Promise<ArchivedWallPlan>{
 if(!interval(request)||request.to-request.from>366*86400000||value?.version!==1||value.kind!=='iq-archived-wall-range-plan-v1'||value.delivery?.version!==1||value.delivery.archiveOnlyReads!==true||!value.request||!same(value.request,request)||!hex(value.revision)||!Array.isArray(value.shards)||value.shards.length>512||!Array.isArray(value.spans)||!value.spans.length||value.spans.length>1025||value.financialAcceptance!==false||value.retirementAuthorized!==false||value.coverage?.scope!=='catalogue-only'||value.coverage.nativeVerified!==false||value.coverage.requestComplete!==false)throw Error('Invalid archived wall range plan');
 const shards=new Map<string,ArchivedWallShard>();
 for(const s of value.shards){if(!s||!hex(s.key)||shards.has(s.key)||!hex(s.partition)||!hex(s.canonicalKey)||!hex(s.projectionKey)||!hex(s.sourceToken)||!interval(s.request)||s.request.to-s.request.from>48*3600000||s.request.market!==request.market||s.request.profile!==request.profile||!['complete','partial'].includes(s.catalogueState))throw Error('Invalid archived wall shard identity');shards.set(s.key,s);}
 let at=request.from;const used=new Set<string>();
 for(const s of value.spans){if(!interval(s)||s.from!==at||s.to>request.to||!['archived','unavailable','ambiguous'].includes(s.state))throw Error('Invalid archived wall span chain');at=s.to;
  if(s.state==='archived'){const native=shards.get(s.shard);if(!native||native.request.from>s.from||native.request.to<s.to)throw Error('Invalid archived wall ownership scope');used.add(s.shard);}else if(s.shard!==undefined)throw Error('Unverified archived wall span selection');}
 if(at!==request.to||used.size!==shards.size)throw Error('Incomplete archived wall plan');
 const state=value.spans.every((s:Span)=>s.state==='archived')?'archived':value.spans.every((s:Span)=>s.state==='unavailable')?'unavailable':'partial';
 if(value.coverage.state!==state)throw Error('Invalid archived wall metadata coverage');
 const bytes=new TextEncoder().encode(JSON.stringify({request:value.request,shards:value.shards,spans:value.spans})),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==value.revision)throw Error('Archived wall plan hash mismatch');
 return structuredClone(value) as ArchivedWallPlan;
}
export async function readArchivedWallPlan(request:ArchivedWallRequest,fetcher:typeof fetch,signal:AbortSignal){
 if(!interval(request)||request.to-request.from>366*86400000)throw Error('Historical range exceeds the supported time bounds');
 const url='/market-data/v2/history/walls/archive-ranges?'+new URLSearchParams({market:request.market,profile:request.profile,from:String(request.from),to:String(request.to)});
 return historyScheduler.read(url,'order-walls',signal,async upstream=>{
  const response=await fetcher(url,{signal:upstream});if(response.status===404){await response.body?.cancel();return null;}if(!response.ok){await response.body?.cancel();throw Error('Historical range metadata is temporarily unavailable');}
  const reader=response.body?.getReader();if(!reader)throw Error('Empty archived wall plan');const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw Error('Archived wall metadata byte capacity');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}upstream.throwIfAborted();return validateArchivedWallPlan(JSON.parse(new TextDecoder().decode(bytes)),request);
 });
}
interface Native {shard:ArchivedWallShard;revision:string;status:OrderWallArchiveStatus;segments:ReadonlyMap<string,OrderWallSegment>}
/** One metadata/native read at a time. View changes coalesce without cancelling
 * a useful shard or clearing independent resident records. */
export class ArchivedWallRangeSession {
 /** More small immutable owners share the unchanged total record/run/byte caps. */
 readonly resident=new WallResidentHistory({...WALL_RESIDENT_LIMITS,chunks:64});
 private abort=new AbortController();private pending=false;private running=false;private disposed=false;private force=false;private view:WallInterval;private error?:string;
 private native=new Map<string,Native>();private owners=new Map<string,string>();
 constructor(private readonly identity:Pick<ArchivedWallRequest,'market'|'profile'>,view:WallInterval,private readonly base:OrderWallArchiveStatus,private readonly fetcher:typeof fetch,private readonly load:(shard:ArchivedWallShard,signal:AbortSignal)=>Promise<OrderWallsArchiveResult>,private readonly changed:()=>void,private readonly unsupported:()=>void){this.view={...view};}
 navigate(view:WallInterval){if(this.disposed)return;const next={from:Math.floor(view.from),to:Math.ceil(view.to)};if(!interval(next)||next.to-next.from>366*86400000){this.error='Historical range exceeds the supported time bounds';this.notify();return;}this.view=next;this.pending=true;void this.run();}
 retry(){this.force=true;this.pending=true;void this.run();}
 dispose(){this.disposed=true;this.abort.abort();this.native.clear();this.owners.clear();this.resident.clear();}
 private notify(){if(!this.disposed)this.changed();}
 private prune(){const keys=new Set(this.resident.chunks.map(c=>c.key));for(const key of this.owners.keys())if(!keys.has(key))this.owners.delete(key);const used=new Set(this.owners.values());for(const key of this.native.keys())if(!used.has(key))this.native.delete(key);}
 private async read(shard:ArchivedWallShard,revalidate:boolean){
  const cached=this.native.get(shard.key);if(cached&&!revalidate)return cached;
  const result=await this.load(shard,this.abort.signal);this.abort.signal.throwIfAborted();const a=result.status.archive,id=result.preparedIdentity;
  if(!result.preparedPresentationComplete||!hex(result.preparedPresentationRevision)||!a?.exact||!a.requestComplete||a.state==='unavailable'||a.state==='loading'||a.state==='building'||a.profileId!==shard.request.profile||a.from!==shard.request.from||a.to!==shard.request.to||result.preparedSourceToken!==shard.sourceToken||id?.canonicalKey!==shard.canonicalKey||id.projectionKey!==shard.projectionKey||id.sourceToken!==shard.sourceToken||result.status.valueHistoryLimited||result.status.episodeHistoryLimited)throw Error('Historical shard could not be verified; retained history kept');
  if(cached){if(cached.revision!==result.preparedPresentationRevision)throw Error('Historical revision changed; retained history kept');return cached;}
  return {shard,revision:result.preparedPresentationRevision,status:a,segments:result.presentation??new Map(result.segments.map(s=>[s.id,s]))};
 }
 private admit(data:Native,scope:WallInterval){
  const adjacent=this.resident.chunks.find(c=>this.owners.get(c.key)===data.shard.key&&(c.to===scope.from||scope.to===c.from));
  const key=adjacent?.key??data.shard.key+':'+scope.from,chunk={key,from:Math.min(scope.from,adjacent?.from??scope.from),to:Math.max(scope.to,adjacent?.to??scope.to),revision:data.revision,sourceToken:data.shard.sourceToken,status:data.status,segments:data.segments};
  const admitted=adjacent?this.resident.expand(chunk,this.view):this.resident.admit(chunk,this.view);if(!admitted.ok)throw Error('Historical display capacity reached; retained history kept');
  this.owners.set(key,data.shard.key);this.native.set(data.shard.key,data);this.prune();this.notify();
 }
 private async run(){
  if(this.running||this.disposed)return;this.running=true;this.notify();
  try{while(this.pending&&!this.disposed){this.pending=false;const view={...this.view},force=this.force;this.force=false;if(!force&&!this.resident.missing(view).length)continue;this.error=undefined;
   const plan=await readArchivedWallPlan({...this.identity,...view},this.fetcher,this.abort.signal);this.abort.signal.throwIfAborted();
   if(!plan){if(!this.resident.size){this.unsupported();return;}throw Error('Historical range service is unavailable; retained history kept');}
   const spans=plan.spans.filter(s=>s.state==='archived').sort((a,b)=>Math.abs(a.from+a.to-view.from-view.to)-Math.abs(b.from+b.to-view.from-view.to));
   if(plan.spans.some(s=>s.state==='ambiguous'))this.error='Historical revisions overlap; retained history kept';else if(plan.spans.some(s=>s.state==='unavailable'))this.error='Some requested history is unavailable';
   for(const span of spans){if(this.pending)break;const shard=plan.shards.find(s=>s.key===span.shard)!;
    const scopes=this.resident.missing(view).map(g=>({from:Math.max(g.from,span.from),to:Math.min(g.to,span.to)})).filter(g=>g.from<g.to);
    if(!scopes.length){if(force&&this.native.has(shard.key))await this.read(shard,true);else if(force&&!this.native.has(shard.key))this.error='Historical selection changed; retained history kept';continue;}
    try{const data=await this.read(shard,force);for(const scope of scopes)this.admit(data,scope);}catch(error){if(this.abort.signal.aborted)throw error;this.error=error instanceof Error?error.message.slice(0,256):'Historical shard unavailable; retained history kept';}
   }
  }}catch(error){if(!this.abort.signal.aborted)this.error=error instanceof Error?error.message.slice(0,256):'Historical range unavailable; retained history kept';}
  finally{this.running=false;this.notify();if(this.pending&&!this.disposed)void this.run();}
 }
 status():OrderWallStatus {
  const chunks=this.resident.chunks,missing=this.resident.missing(this.view),gaps=[...new Map(chunks.flatMap(c=>c.status.gaps.filter(g=>g.to>=Math.max(c.from,this.view.from)&&g.from<Math.min(c.to,this.view.to))).map(g=>[JSON.stringify(g),g])).values()],loading=this.running||this.pending,complete=!missing.length&&!gaps.length&&!this.error&&chunks.filter(c=>intersects(c,this.view)).every(c=>c.status.rangeComplete&&!c.status.gapsTruncated),reason=this.error??(loading?'Loading missing history; retained history remains visible':missing.length?'Some requested history is not loaded':gaps.length?'Loaded history includes source gaps':undefined);
  const archive:OrderWallArchiveStatus={...this.base,...this.view,state:loading?'loading':complete?'complete':'partial',exact:true,requestComplete:!loading&&!missing.length&&!this.error,rangeComplete:complete,loadedFrom:chunks[0]?.from,loadedThrough:chunks.length?Math.max(...chunks.map(c=>c.to-1)):undefined,residentRanges:chunks.map(c=>({from:c.from,to:c.to})),unloadedRanges:missing,gaps:gaps.slice(-256),gapsTruncated:gaps.length>256||chunks.some(c=>c.status.gapsTruncated),reason};
  return {state:loading?'loading':complete?'live':'gap',coverage:{...this.view,complete,partial:!complete},archive,...(reason?{message:reason}:{})};
 }
 diagnostics(){return {running:this.running,pending:this.pending,nativeShards:this.native.size,...this.resident.diagnostics(),view:this.view,error:this.error};}
}

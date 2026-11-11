import {acquirePreparedWallReadLease} from './prepared-wall-read-lease';
import {historyHttpError} from './history-http-error';
import {acquireWallBatch} from './prepared-wall-batch';
import {readPreparedWallProjection,type ProjectionProgress} from './prepared-wall-projection';
import {type OrderWallsProjectionSettings,type OrderWallsArchiveProfile,type OrderWallSegment,type OrderWallsArchiveCoverage} from '../shared/order-walls-projection';
import {WALL_PROJECTION_CORE_SHA256} from '../shared/order-walls-projection-version';
import {historyScheduler} from './history-scheduler';
import {discoverPreparedWallAdmission,type WallPreparationProgress} from './prepared-wall-admission';
import type {OrderWallsArchivePage} from './order-walls-archive';
type Head={cursor:number;epoch:number;at:number};
export interface PreparedWallRequest {market:'spot'|'perpetual';profile:string;from:number;to:number;watermark?:number;head?:Head}
interface Part {index:number;hash:string;canonicalHash:string;bytes:number;after:number;nextAfter:number}
interface Manifest {version:5;key:string;complete:true;watermark:number;head:Head;after:number;request:PreparedWallRequest&{sourceRevision:string};sourceProof:Source;parts:Part[]}
interface ProjectionSource {version:1;kind:'wall-projection-source-v1';key:string;request:PreparedWallRequest;sourceProof:Source;watermark:number;head:Head}
type SourceSnapshot=Manifest|ProjectionSource;
interface Source extends PreparedWallRequest {version:1;kind:'wall-source-sha256-xor-v1';token:string;eligible:boolean;watermark:number;head:Head;maxCursor?:number;anchor?:{cursor:number;epoch:number;at:number;hash:string}|null}
export interface PreparedWallFetched {response:Response;body:unknown;bytes:number;responseHeadersMs:number;bodyReadMs:number;jsonParseMs:number;validationMs?:number;validationYieldMs?:number;attempts:number}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const head=(value:any):value is Head=>value&&[value.cursor,value.epoch,value.at].every(integer);
const sameRequest=(a:PreparedWallRequest,b:PreparedWallRequest)=>a.market===b.market&&a.profile===b.profile&&a.from===b.from&&a.to===b.to;
/** A quiet/out-of-range head advance need not invalidate an older bootstrap.
 * Permit backward transport rebinding only when the independently validated
 * source proves every financial input/carry-in fits inside that older fence. */
function sourceFitsFence(manifest:SourceSnapshot,source:Source,target:Head){
 if(target.cursor>=manifest.watermark)return true;
 const anchor=source.anchor,stored=manifest.sourceProof.anchor,max=source.maxCursor;
 return typeof max==='number'&&integer(max)&&max<=target.cursor&&manifest.sourceProof.maxCursor===max
  &&anchor&&stored&&integer(anchor.cursor)&&anchor.cursor<=target.cursor&&integer(anchor.epoch)&&integer(anchor.at)&&anchor.at<manifest.request.from&&hex(anchor.hash)
  &&anchor.cursor===stored.cursor&&anchor.epoch===stored.epoch&&anchor.at===stored.at&&anchor.hash===stored.hash
  &&(!('parts' in manifest)||manifest.parts.every((part,index)=>part.after<=target.cursor&&(index===manifest.parts.length-1||part.nextAfter<=target.cursor)));
}
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,'0')).join('');
const sourceUrl=(path:string,r:PreparedWallRequest)=>'/market-data/v2/history/walls/'+path+'?'+new URLSearchParams({market:r.market,profile:r.profile,from:String(r.from),to:String(r.to)});
function validSource(value:any,r:PreparedWallRequest):value is Source{return value?.version===1&&value.kind==='wall-source-sha256-xor-v1'&&value.eligible===true&&hex(value.token)&&sameRequest(value,r)&&integer(value.watermark)&&head(value.head)&&value.head.cursor===value.watermark&&value.head.at>=r.to-1;}
/** Bounded decode remains inside the shared request admission. Browser fetch has
 * already decoded HTTP gzip; bound decoded bytes as well as the wire response. */
async function readBytes(response:Response,max:number){
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('Prepared wall response byte capacity');}chunks.push(value);}}finally{reader.releaseLock();}
 else{const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.byteLength;if(size>max)throw Error('Prepared wall response byte capacity');chunks.push(bytes);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 return bytes;
}
async function readBody(response:Response,max:number,expectedHash?:string){
 const start=performance.now(),bytes=await readBytes(response,max);
 if(expectedHash&&await hash(bytes)!==expectedHash)throw Error('Prepared wall part content hash mismatch');
 const bodyReadMs=performance.now()-start,parse=performance.now();
 const body:unknown=JSON.parse(new TextDecoder().decode(bytes));return {body,bytes:bytes.byteLength,bodyReadMs,jsonParseMs:performance.now()-parse};
}
async function validateManifest(value:any,source:Source,r:PreparedWallRequest):Promise<Manifest>{
 if(value?.version!==5||!hex(value.key)||value.complete!==true||!sameRequest(value.request??{},r)||!validSource(value.sourceProof,r)||value.sourceProof.token!==source.token
  ||!integer(value.watermark)||value.watermark>source.watermark||value.request.watermark!==value.watermark||value.sourceProof.watermark!==value.watermark
  ||!head(value.head)||value.head.cursor!==value.watermark||value.head.at<r.to-1||JSON.stringify(value.head)!==JSON.stringify(value.sourceProof.head)||value.after!==value.watermark
  ||!hex(value.request.sourceRevision)||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>128)throw Error('Invalid prepared wall manifest identity');
 for(let i=0;i<value.parts.length;i++){
  const part=value.parts[i];if(part.index!==i||!hex(part.hash)||!hex(part.canonicalHash)||!integer(part.bytes)||part.bytes<1||part.bytes>4*1024*1024
   ||!integer(part.after)||!integer(part.nextAfter)||part.nextAfter<part.after||part.nextAfter>value.watermark||i&&part.after!==value.parts[i-1].nextAfter
   ||i<value.parts.length-1&&part.nextAfter<=part.after)throw Error('Invalid prepared wall part chain');
 }
 if(value.parts.at(-1).nextAfter!==value.watermark||await hash(new TextEncoder().encode(JSON.stringify(value.parts.map((p:Part)=>p.canonicalHash))))!==value.request.sourceRevision)throw Error('Invalid prepared wall manifest revision');
 return value;
}
/** This fence authenticates the selected projection only. It deliberately has
 * no canonical page list, page revision or continuation capability. */
async function validateProjectionSource(value:any,source:Source,r:PreparedWallRequest):Promise<ProjectionSource>{
 if(value?.version!==1||value.kind!=='wall-projection-source-v1'||'parts' in value||'after' in value||!hex(value.key)||!sameRequest(value.request??{},r)
   ||!validSource(value.sourceProof,r)||value.sourceProof.token!==source.token||!integer(value.watermark)||value.watermark>source.watermark
   ||value.sourceProof.watermark!==value.watermark||!head(value.head)||value.head.cursor!==value.watermark
   ||JSON.stringify(value.head)!==JSON.stringify(value.sourceProof.head)
   ||await hash(new TextEncoder().encode(JSON.stringify({version:5,market:r.market,profile:r.profile,from:r.from,to:r.to,watermark:value.watermark,sourceToken:source.token})))!==value.key)
  throw Error('Invalid prepared wall projection source identity');
 return value;
}
/** Only transport metadata is rebound, after the server proves every canonical
 * carry-in/in-range input unchanged. Financial patches, seeds, gaps and their
 * cursor/timestamp order remain byte-equivalent to the prepared snapshot. */
export function rebasePreparedWallPage(raw:any,manifest:Manifest,part:Part,target:Head){
 if(!sameRequest({...raw,profile:raw?.profile?.id},manifest.request)||raw.profile?.id!==manifest.request.profile||raw.watermark!==manifest.watermark||JSON.stringify(raw.head)!==JSON.stringify(manifest.head)
  ||raw.page?.after!==part.after||raw.page.nextAfter!==part.nextAfter||raw.page.hasMore!==(part.index<manifest.parts.length-1))throw Error('Prepared wall page identity mismatch');
 if(!sourceFitsFence(manifest,manifest.sourceProof,target)||target.at<manifest.request.to-1)throw Error('Prepared wall source fence cannot cover request');
 if(target.cursor<manifest.watermark&&(raw.patches?.some((patch:any)=>!integer(patch.cursor)||patch.cursor>target.cursor)||raw.seed&&(!integer(raw.seed.cursor)||raw.seed.cursor>target.cursor)))throw Error('Prepared wall financial input exceeds bootstrap fence');
 const {profileStatus: _mutableProfileStatus,...canonical}=raw;
 return {...canonical,watermark:target.cursor,head:{...target},snapshot:`${manifest.request.profile}:${target.cursor}:${raw.from}:${raw.to}`,
  page:{...raw.page,nextAfter:raw.page.hasMore?raw.page.nextAfter:target.cursor}} as OrderWallsArchivePage;
}
export class PreparedWallSourceChangedError extends Error {constructor(){super('Prepared wall source changed or cannot be revalidated; restart revision with displayed history retained');this.name='PreparedWallSourceChangedError';}}
export type PreparedWallReuseLookup=(revision:string,segments:number)=>Promise<ReadonlyMap<string,OrderWallSegment>|undefined>|undefined;
interface ReusedProjection {projector?:undefined;presentation:ReadonlyMap<string,OrderWallSegment>;presentationRevision:string;coverage:OrderWallsArchiveCoverage;profile:OrderWallsArchiveProfile;head:Head;confirmedAt:number;midpoint:string|null;parts:0;bytes:0}
export interface PreparedWallReader {sourceToken:string;read:(after:number)=>Promise<PreparedWallFetched>;dispose:()=>void;
 reuseProjection:(settings:OrderWallsProjectionSettings,lookup:PreparedWallReuseLookup,validateProfile:(profile:OrderWallsArchiveProfile)=>void)=>Promise<ReusedProjection|null>;
 readProjection:(settings:OrderWallsProjectionSettings,onProgress:(value:ProjectionProgress)=>void,validateProfile?:(profile:OrderWallsArchiveProfile)=>void)=>Promise<(NonNullable<Awaited<ReturnType<typeof readPreparedWallProjection>>>&{head:Head})|null>}
function waitCached<T>(value:Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();return new Promise((resolve,reject)=>{
  const cancel=()=>{signal.removeEventListener('abort',cancel);reject(signal.reason);};signal.addEventListener('abort',cancel,{once:true});
  void value.then(result=>{signal.removeEventListener('abort',cancel);resolve(result);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
 });
}
/** At most two immutable parts are prefetched. Every read uses the shared
 * scheduler and a consumer-specific cancellation signal; no outer admission is
 * held while waiting for another admitted request. */
export async function discoverPreparedWallHistory(request:PreparedWallRequest,fetcher:typeof fetch,signal:AbortSignal,settings?:OrderWallsProjectionSettings,options:Omit<Parameters<typeof discoverPreparedWallAdmission>[0],'request'|'url'|'projection'|'fetcher'|'signal'|'decode'>={}){
 return discoverPreparedWallAdmission({request,url:sourceUrl('discover',request),projection:Boolean(settings&&settings.topLevels===8&&!settings.minimumNotionalEnabled&&settings.minDurationMs===0),fetcher,signal,...options,decode:async(response,max)=>(await readBody(response,max)).body});
}
export async function preparedWallReader(request:PreparedWallRequest,fetcher:typeof fetch,signal:AbortSignal,resumeSourceToken?:string,settings?:OrderWallsProjectionSettings,options:{discovery?:unknown;onPreparation?:(value:WallPreparationProgress)=>void;retry?:{token:string;newRevision?:boolean}}={}):Promise<PreparedWallReader|null>{
 const projection=Boolean(settings&&settings.topLevels===8&&!settings.minimumNotionalEnabled&&settings.minDurationMs===0);
 const found:any=options.discovery??await discoverPreparedWallHistory(request,fetcher,signal,settings,options);
 if(!found||found.state!=='ready'){if(resumeSourceToken)throw new PreparedWallSourceChangedError();return null;}
 if(!validSource(found.source,request))throw Error('Invalid prepared wall source validation');
 const source:Source=found.source;if(resumeSourceToken&&source.token!==resumeSourceToken)throw new PreparedWallSourceChangedError();
 if(found.representation!==undefined&&found.representation!=='projection-v1')throw Error('Invalid prepared wall representation');
 if(found.representation==='projection-v1'&&(!projection||!found.projection||found.manifest||found.delivery))throw Error('Invalid projection-only wall delivery');
 const manifest:SourceSnapshot=found.representation==='projection-v1'?await validateProjectionSource(found.sourceSnapshot,source,request):await validateManifest(found.manifest,source,request);
 const canonicalManifest=found.representation==='projection-v1'?undefined:manifest as Manifest;
 const target=request.watermark===undefined?source.head:request.head;
 if(!head(target)||target.cursor!==(request.watermark??source.watermark)||!sourceFitsFence(manifest,source,target)||target.cursor>source.watermark||target.at<request.to-1){if(resumeSourceToken)throw new PreparedWallSourceChangedError();return null;}
 if(found.readerLease&&(found.readerLease.version!==1||found.readerLease.leaseMs!==15000))throw Error('Invalid wall reader lease capability');
 const lease=found.readerLease?await acquirePreparedWallReadLease({canonicalKey:manifest.key,...(projection&&found.projection?.manifest?.key?{projectionKey:found.projection.manifest.key}:{})},fetcher,signal):undefined;
 if(lease){const original=fetcher;fetcher=(input,init)=>{const headers:Record<string,string>={};new Headers(init?.headers).forEach((value,key)=>headers[key]=value);headers['X-IQ-Wall-Reader']=lease.consumer;return original(input,{...init,headers});};}
 const abort=new AbortController(),consumer=AbortSignal.any([signal,abort.signal,...(lease?[lease.signal]:[])]);
 const assertActive=()=>{lease?.assertActive();consumer.throwIfAborted();};
 const leaseFailure=(error:unknown):never=>{lease?.assertActive();throw error;};
 consumer.addEventListener('abort',()=>lease?.release(),{once:true});
 async function validateRevision(){
  assertActive();
  const latest=await historyScheduler.read(sourceUrl('source',request),'order-walls',consumer,async upstream=>{
   const response=await fetcher(sourceUrl('source',request),{signal:upstream});if(!response.ok)throw await historyHttpError(response,upstream,'Prepared wall source validation');
   return (await readBody(response,128*1024)).body;
  }).catch(leaseFailure);
  assertActive();
  if(!validSource(latest,request)||latest.token!==source.token||latest.watermark<target!.cursor)throw new PreparedWallSourceChangedError();
 }
 const pending=new Map<number,Promise<PreparedWallFetched>>();let expectedAfter:number|undefined;
 const batchEnabled=Boolean(canonicalManifest)&&found.delivery?.version===2&&found.delivery.maxDecodedBytes===8*1024*1024&&found.delivery.maxParts===8;
 let currentBatch:{start:number;next:number;handle:ReturnType<typeof acquireWallBatch>}|undefined;
 function batchAt(startIndex:number){
  const manifest=canonicalManifest;if(!manifest)throw Error('Canonical wall pages were not advertised');
  const parts:Part[]=[];let bytes=0;
  for(const part of manifest.parts.slice(startIndex,startIndex+8)){if(bytes+part.bytes+1>8*1024*1024)break;parts.push(part);bytes+=part.bytes+1;}
  const url='/market-data/v2/history/walls/batch?'+new URLSearchParams({market:request.market,key:manifest.key,start:String(startIndex),version:'2'});
  return {start:startIndex,next:startIndex+parts.length,handle:acquireWallBatch({url,key:manifest.key,revision:manifest.request.sourceRevision,parts,fetcher,signal:consumer})};
 }

 function prefetch(index:number,priority:number){
  const manifest=canonicalManifest;if(!manifest)return;
  if(index>=manifest.parts.length||pending.has(index))return;
  const part=manifest.parts[index],url='/market-data/v2/history/walls/part?'+new URLSearchParams({market:request.market,key:manifest.key,hash:part.hash});
  const promise=historyScheduler.read(url,'order-walls',consumer,async upstream=>{
   const start=performance.now(),response=await fetcher(url,{signal:upstream}),responseHeadersMs=performance.now()-start;
   if(!response.ok){await response.body?.cancel();throw Error('Prepared wall part HTTP '+response.status);}
   const decoded=await readBody(response,4*1024*1024,part.hash);
   if(decoded.bytes!==part.bytes)throw Error('Prepared wall part byte identity mismatch');
   return {response,...decoded,responseHeadersMs,attempts:1};
  },priority);
  pending.set(index,promise);void promise.catch(()=>{});
 }
 return {sourceToken:source.token,dispose:()=>{abort.abort();lease?.release();pending.clear();currentBatch?.handle.release();currentBatch=undefined;},reuseProjection:async(settings,lookup,validateProfile)=>{
  assertActive();const m=found.projection?.manifest;
  const normalized={topLevels:settings.topLevels,minimumNotionalEnabled:settings.minimumNotionalEnabled,minimumNotionalUsd:settings.minimumNotionalEnabled?settings.minimumNotionalUsd:0,minDurationMs:settings.minDurationMs};
  if(!m||m.core!==WALL_PROJECTION_CORE_SHA256||JSON.stringify(m.settings)!==JSON.stringify(normalized))return null;
  if(m.active?.valueHistoryLimited||m.active?.episodeHistoryLimited)return null;
  if(m.version!==2||m.complete!==true||m.sourceKey!==manifest.key||m.sourceToken!==source.token||m.profile?.id!==request.profile||m.profile.market!==request.market
    ||m.active?.from!==request.from||m.active.to!==request.to||m.active.cursor!==manifest.watermark||m.active.epoch!==manifest.head.epoch
    ||!Array.isArray(m.closed)||!Array.isArray(m.active.segments)||m.closed.length+m.active.segments.length>100000)throw Error('Invalid prepared wall reuse identity');
  validateProfile(m.profile);
  // The exact complete manifest hash must match an already authenticated cache.
  // A cache miss uses the ordinary full importer and all its structural checks.
  const revision=await hash(new TextEncoder().encode(JSON.stringify(m))),cached=lookup(revision,m.closed.length+m.active.segments.length);
  if(!cached)return null;
  const validation=validateRevision();void validation.catch(()=>{});
  const [presentation]=await Promise.all([waitCached(cached,consumer),validation]);assertActive();
  if(!presentation||presentation.size!==m.closed.length+m.active.segments.length)return null;
  return {presentation,presentationRevision:revision,coverage:m.coverage,profile:m.profile,head:target!,confirmedAt:m.active.confirmedTo,midpoint:m.active.midpoint,parts:0,bytes:0};
 },readProjection:async(settings,onProgress,validateProfile)=>{
  const result=await readPreparedWallProjection(found.projection,{sourceKey:manifest.key,sourceToken:source.token,watermark:manifest.watermark,epoch:manifest.head.epoch,
   from:request.from,to:request.to,profile:request.profile,market:request.market,settings,fetcher,signal:consumer,outputHead:{cursor:target!.cursor,epoch:target!.epoch},validateProfile,validateCompletion:validateRevision},value=>{assertActive();onProgress(value);}).catch(leaseFailure);
  assertActive();return result?{...result,head:target!}:null;
 },read:async after=>{
  assertActive();const manifest=canonicalManifest;if(!manifest)throw Error('Canonical wall pages were not advertised');
  if(expectedAfter!==undefined&&after!==expectedAfter)throw Error('Prepared wall continuation cursor mismatch');
  const index=after===0?0:manifest.parts.findIndex(part=>part.after===after);if(index<0)throw Error('Prepared wall resume cursor is not a part boundary');
  let result:PreparedWallFetched;
  if(batchEnabled&&index>0){
   if(!currentBatch||index<currentBatch.start||index>=currentBatch.next){currentBatch?.handle.release();currentBatch=batchAt(index);}
   result=await currentBatch.handle.read(index).catch(leaseFailure);
   if(index+1===currentBatch.next){currentBatch.handle.release();currentBatch=undefined;}
  }
  else{prefetch(index,0);if(!batchEnabled)prefetch(index+1,1);result=await pending.get(index)!.catch(leaseFailure);pending.delete(index);}
  const body=rebasePreparedWallPage(result.body,manifest,manifest.parts[index]!,target);
  expectedAfter=body.page.nextAfter;
  if(!body.page.hasMore){
   // Independent revision validation precedes the terminal publication. A
   // source correction cannot turn a painted prefix into early completion.
   await validateRevision();
  }
  assertActive();return {...result,body};
 }};
}

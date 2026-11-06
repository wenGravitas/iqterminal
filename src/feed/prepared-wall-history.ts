import {historyScheduler} from './history-scheduler';
import type {OrderWallsArchivePage} from './order-walls-archive';
type Head={cursor:number;epoch:number;at:number};
export interface PreparedWallRequest {market:'spot'|'perpetual';profile:string;from:number;to:number;watermark?:number;head?:Head}
interface Part {index:number;hash:string;canonicalHash:string;bytes:number;after:number;nextAfter:number}
interface Manifest {version:5;key:string;complete:true;watermark:number;head:Head;after:number;request:PreparedWallRequest&{sourceRevision:string};sourceProof:Source;parts:Part[]}
interface Source extends PreparedWallRequest {version:1;kind:'wall-source-sha256-xor-v1';token:string;eligible:boolean;watermark:number;head:Head}
export interface PreparedWallFetched {response:Response;body:unknown;bytes:number;responseHeadersMs:number;bodyReadMs:number;jsonParseMs:number;attempts:number}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const head=(value:any):value is Head=>value&&[value.cursor,value.epoch,value.at].every(integer);
const sameRequest=(a:PreparedWallRequest,b:PreparedWallRequest)=>a.market===b.market&&a.profile===b.profile&&a.from===b.from&&a.to===b.to;
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,'0')).join('');
const sourceUrl=(path:string,r:PreparedWallRequest)=>'/market-data/v2/history/walls/'+path+'?'+new URLSearchParams({market:r.market,profile:r.profile,from:String(r.from),to:String(r.to)});
function validSource(value:any,r:PreparedWallRequest):value is Source{return value?.version===1&&value.kind==='wall-source-sha256-xor-v1'&&value.eligible===true&&hex(value.token)&&sameRequest(value,r)&&integer(value.watermark)&&head(value.head)&&value.head.cursor===value.watermark&&value.head.at>=r.to;}
/** Bounded decode remains inside the shared request admission. Browser fetch has
 * already decoded HTTP gzip; bound decoded bytes as well as the wire response. */
async function readBody(response:Response,max:number,expectedHash?:string){
 const start=performance.now(),reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('Prepared wall response byte capacity');}chunks.push(value);}}finally{reader.releaseLock();}
 else{const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.byteLength;if(size>max)throw Error('Prepared wall response byte capacity');chunks.push(bytes);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 if(expectedHash&&await hash(bytes)!==expectedHash)throw Error('Prepared wall part content hash mismatch');
 const bodyReadMs=performance.now()-start,parse=performance.now();
 const body:unknown=JSON.parse(new TextDecoder().decode(bytes));return {body,bytes:size,bodyReadMs,jsonParseMs:performance.now()-parse};
}
async function validateManifest(value:any,source:Source,r:PreparedWallRequest):Promise<Manifest>{
 if(value?.version!==5||!hex(value.key)||value.complete!==true||!sameRequest(value.request??{},r)||!validSource(value.sourceProof,r)||value.sourceProof.token!==source.token
  ||!integer(value.watermark)||value.watermark>source.watermark||value.request.watermark!==value.watermark||value.sourceProof.watermark!==value.watermark
  ||!head(value.head)||value.head.cursor!==value.watermark||value.head.at<r.to||JSON.stringify(value.head)!==JSON.stringify(value.sourceProof.head)||value.after!==value.watermark
  ||!hex(value.request.sourceRevision)||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>128)throw Error('Invalid prepared wall manifest identity');
 for(let i=0;i<value.parts.length;i++){
  const part=value.parts[i];if(part.index!==i||!hex(part.hash)||!hex(part.canonicalHash)||!integer(part.bytes)||part.bytes<1||part.bytes>4*1024*1024
   ||!integer(part.after)||!integer(part.nextAfter)||part.nextAfter<part.after||part.nextAfter>value.watermark||i&&part.after!==value.parts[i-1].nextAfter
   ||i<value.parts.length-1&&part.nextAfter<=part.after)throw Error('Invalid prepared wall part chain');
 }
 if(value.parts.at(-1).nextAfter!==value.watermark||await hash(new TextEncoder().encode(JSON.stringify(value.parts.map((p:Part)=>p.canonicalHash))))!==value.request.sourceRevision)throw Error('Invalid prepared wall manifest revision');
 return value;
}
/** Only transport metadata is rebound, after the server proves every canonical
 * carry-in/in-range input unchanged. Financial patches, seeds, gaps and their
 * cursor/timestamp order remain byte-equivalent to the prepared snapshot. */
export function rebasePreparedWallPage(raw:any,manifest:Manifest,part:Part,target:Head){
 if(!sameRequest({...raw,profile:raw?.profile?.id},manifest.request)||raw.profile?.id!==manifest.request.profile||raw.watermark!==manifest.watermark||JSON.stringify(raw.head)!==JSON.stringify(manifest.head)
  ||raw.page?.after!==part.after||raw.page.nextAfter!==part.nextAfter||raw.page.hasMore!==(part.index<manifest.parts.length-1))throw Error('Prepared wall page identity mismatch');
 if(target.cursor<manifest.watermark||target.at<manifest.request.to)throw Error('Prepared wall source fence cannot cover request');
 const {profileStatus: _mutableProfileStatus,...canonical}=raw;
 return {...canonical,watermark:target.cursor,head:{...target},snapshot:`${manifest.request.profile}:${target.cursor}:${raw.from}:${raw.to}`,
  page:{...raw.page,nextAfter:raw.page.hasMore?raw.page.nextAfter:target.cursor}} as OrderWallsArchivePage;
}
export class PreparedWallSourceChangedError extends Error {constructor(){super('Prepared wall source changed or cannot be revalidated; restart revision with displayed history retained');this.name='PreparedWallSourceChangedError';}}
export interface PreparedWallReader {sourceToken:string;read:(after:number)=>Promise<PreparedWallFetched>;dispose:()=>void}
/** At most two immutable parts are prefetched. Every read uses the shared
 * scheduler and a consumer-specific cancellation signal; no outer admission is
 * held while waiting for another admitted request. */
export async function preparedWallReader(request:PreparedWallRequest,fetcher:typeof fetch,signal:AbortSignal,resumeSourceToken?:string):Promise<PreparedWallReader|null>{
 const discovery=sourceUrl('discover',request);
 const found=await historyScheduler.read(discovery,'order-walls',signal,async upstream=>{
  const response=await fetcher(discovery,{signal:upstream});
  if(!response.ok){await response.body?.cancel();if(response.status===404)return null;throw Error('Prepared wall discovery HTTP '+response.status);}
  return (await readBody(response,128*1024)).body as any;
 });
 if(!found||found.state!=='ready'){if(resumeSourceToken)throw new PreparedWallSourceChangedError();return null;}
 if(!validSource(found.source,request))throw Error('Invalid prepared wall source validation');
 const source:Source=found.source;if(resumeSourceToken&&source.token!==resumeSourceToken)throw new PreparedWallSourceChangedError();
 const manifest=await validateManifest(found.manifest,source,request);
 const target=request.watermark===undefined?source.head:request.head;
 if(!head(target)||target.cursor!==(request.watermark??source.watermark)||target.cursor<manifest.watermark||target.cursor>source.watermark||target.at<request.to){if(resumeSourceToken)throw new PreparedWallSourceChangedError();return null;}
 const abort=new AbortController(),consumer=AbortSignal.any([signal,abort.signal]);
 const pending=new Map<number,Promise<PreparedWallFetched>>();let expectedAfter:number|undefined;
 function prefetch(index:number,priority:number){
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
 return {sourceToken:source.token,dispose:()=>{abort.abort();pending.clear();},read:async after=>{
  if(consumer.aborted)throw new DOMException('Aborted','AbortError');
  if(expectedAfter!==undefined&&after!==expectedAfter)throw Error('Prepared wall continuation cursor mismatch');
  const index=after===0?0:manifest.parts.findIndex(part=>part.after===after);if(index<0)throw Error('Prepared wall resume cursor is not a part boundary');
  prefetch(index,0);prefetch(index+1,1);
  const result=await pending.get(index)!;pending.delete(index);
  const body=rebasePreparedWallPage(result.body,manifest,manifest.parts[index]!,target);
  expectedAfter=body.page.nextAfter;
  if(!body.page.hasMore){
   // Independent revision validation precedes the terminal publication. A
   // source correction cannot turn a painted prefix into early completion.
   const latest=await historyScheduler.read(sourceUrl('source',request),'order-walls',consumer,async upstream=>{
    const response=await fetcher(sourceUrl('source',request),{signal:upstream});if(!response.ok){await response.body?.cancel();throw Error('Prepared wall source validation HTTP '+response.status);}
    return (await readBody(response,128*1024)).body;
   });
   if(!validSource(latest,request)||latest.token!==source.token||latest.watermark<target.cursor)throw new PreparedWallSourceChangedError();
  }
  return {...result,body};
 }};
}

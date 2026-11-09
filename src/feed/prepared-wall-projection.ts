import {yieldHistoryTask} from './history-task-yield';
import {OrderWallsArchiveProjector,type OrderWallsProjectionSettings,type OrderWallSegment,type WallProjectionCheckpoint,type OrderWallsArchiveCoverage,type OrderWallsArchiveProfile} from '../shared/order-walls-projection';
import {WALL_PROJECTION_CORE_SHA256} from '../shared/order-walls-projection-version';
import {acquireWallBatch} from './prepared-wall-batch';
interface Part {hash:string;bytes:number;records:number}
interface RecordRow {order:number;segment:OrderWallSegment;valueRunOrder:number[];offset:number;totalRuns:number}
export interface PreparedWallProjectionManifest {version:2;key:string;sourceKey:string;sourceToken:string;core:string;complete:true;settings:OrderWallsProjectionSettings;active:WallProjectionCheckpoint;activeOrder:number[];closed:Array<Array<[number,number]>>;parts:Part[];coverage:OrderWallsArchiveCoverage;profile:OrderWallsArchiveProfile}
interface Context {sourceKey:string;sourceToken:string;watermark:number;epoch:number;from:number;to:number;profile:string;market:'spot'|'perpetual';settings:OrderWallsProjectionSettings;fetcher:typeof fetch;signal:AbortSignal;outputHead?:{cursor:number;epoch:number};validateProfile?:(profile:OrderWallsArchiveProfile)=>void;validateCompletion?:()=>Promise<void>}
export interface ProjectionProgress {segments:OrderWallSegment[];presentation:ReadonlyMap<string,OrderWallSegment>;presentationThrough:number;parts:number;bytes:number;decodeMs:number;mergeMs:number;metrics?:{attempts:number;responseHeadersMs:number;bodyReadMs:number;jsonParseMs:number;validationMs:number;mergeMs:number;yieldMs:number;encodedBytes:number;requestId?:string}}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,'0')).join('');
const normalized=(s:OrderWallsProjectionSettings)=>({topLevels:s.topLevels,minimumNotionalEnabled:s.minimumNotionalEnabled,minimumNotionalUsd:s.minimumNotionalEnabled?s.minimumNotionalUsd:0,minDurationMs:s.minDurationMs});
const yieldTask=yieldHistoryTask;
/** Configuration mismatch is a compatible fallback. A malformed advertised
 * snapshot is an explicit failure, never an excuse to claim empty coverage. */
export async function readPreparedWallProjection(advertised:any,context:Context,onProgress:(value:ProjectionProgress)=>void){
 if(!advertised)return null;
 const {manifest:m,delivery}=advertised;
 const pointTransport=delivery?.productTransport===1?2:delivery?.pointTransport===1?1:0;
 if(m?.core!==WALL_PROJECTION_CORE_SHA256||JSON.stringify(m.settings)!==JSON.stringify(normalized(context.settings)))return null;
 if(delivery?.version!==1||delivery.maxParts!==32||delivery.maxDecodedBytes!==8*1024*1024)return null;
 if(m.version!==2||!hex(m.key)||!m.complete||m.sourceKey!==context.sourceKey||m.sourceToken!==context.sourceToken||m.profile?.id!==context.profile||m.profile.market!==context.market
  ||m.active?.from!==context.from||m.active.to!==context.to||m.active.cursor!==context.watermark||m.active.epoch!==context.epoch
  ||!Array.isArray(m.parts)||m.parts.length>512||!Array.isArray(m.closed)||m.closed.length>100000||!Array.isArray(m.activeOrder)||m.activeOrder.length!==m.active.segments?.length
  ||m.closed.length+m.activeOrder.length>100000||await digest(new TextEncoder().encode(JSON.stringify({version:2,sourceKey:context.sourceKey,core:WALL_PROJECTION_CORE_SHA256,settings:normalized(context.settings)})))!==m.key)throw Error('Invalid prepared wall projection identity');
 if(context.outputHead&&![context.outputHead.cursor,context.outputHead.epoch].every(integer))throw Error('Invalid prepared wall output fence');
 const manifest=m as PreparedWallProjectionManifest,hashes=new Set<string>();let decodedBytes=0;
 context.validateProfile?.(manifest.profile);
 for(const p of manifest.parts){if(!hex(p.hash)||hashes.has(p.hash)||!integer(p.bytes)||p.bytes<1||p.bytes>4*1024*1024||!integer(p.records)||p.records<1)throw Error('Invalid prepared wall projection part');hashes.add(p.hash);decodedBytes+=p.bytes;}
 if(decodedBytes>64*1024*1024)throw Error('Prepared wall projection byte capacity');
 const coordinates=new Map<string,{group:number;fragment:number}>(),fragments:Array<Array<RecordRow|undefined>>=[];
 for(const [group,pairs] of manifest.closed.entries()){
  if(!Array.isArray(pairs)||!pairs.length)throw Error('Invalid prepared wall projection coordinates');fragments.push(new Array(pairs.length).fill(undefined));
  for(const [fragment,pair] of pairs.entries()){
   if(!Array.isArray(pair)||pair.length!==2||!pair.every(integer)||pair[0]>=manifest.parts.length||pair[1]>=manifest.parts[pair[0]]!.records||coordinates.has(pair.join(':')))throw Error('Invalid prepared wall projection coordinates');
   coordinates.set(pair.join(':'),{group,fragment});
  }
 }
 // The active checkpoint is independently validated before any presentation.
 OrderWallsArchiveProjector.restoreCheckpoint(manifest.active,context.settings,context.from,context.to);
 const presentation=new Map<string,OrderWallSegment>(),retained:Array<Omit<RecordRow,'offset'|'totalRuns'>>=[];
 for(const [i,segment] of manifest.active.segments.entries()){
  if(segment.end!==null||!integer(manifest.activeOrder[i]))throw Error('Invalid prepared wall projection active order');
  presentation.set(segment.id,segment);retained.push({order:manifest.activeOrder[i]!,segment,valueRunOrder:manifest.active.valueRunOrder[i]!});
 }
 let bytes=0,parts=0,decodeMs=0,mergeMs=0,runs=manifest.active.segments.reduce((n,segment)=>n+segment.valueRuns.length,0);
 context.signal.throwIfAborted();onProgress({segments:manifest.active.segments,presentation,presentationThrough:manifest.active.confirmedTo,parts,bytes,decodeMs,mergeMs});
 function acquire(start:number){
  if(start>=manifest.parts.length)return undefined;
  const selected:Array<Part&{index:number}>=[];let size=0;
  for(let i=start;i<Math.min(start+32,manifest.parts.length);i++){const part=manifest.parts[i]!;if(size+part.bytes+1>8*1024*1024)break;selected.push({...part,index:i});size+=part.bytes+1;}
  if(!selected.length)throw Error('Prepared wall projection batch capacity');
  const url='/market-data/v2/history/walls/projection-batch?'+new URLSearchParams({market:context.market,key:manifest.key,start:String(start),version:pointTransport===2?'3':pointTransport===1?'2':'1'});
  return {selected,next:start+selected.length,handle:acquireWallBatch({url,key:manifest.key,revision:manifest.sourceToken,parts:selected,fetcher:context.fetcher,signal:context.signal,maxParts:32,pointTransport:pointTransport===2?2:pointTransport===1})};
 }
 let current=acquire(0),next:ReturnType<typeof acquire>;
 try{while(current){
  context.signal.throwIfAborted();
  for(const part of current.selected){
   const fetched=await current.handle.read(part.index),rows=fetched.body as RecordRow[];decodeMs+=fetched.jsonParseMs+(fetched.validationMs??0);bytes+=fetched.bytes;parts++;
   if(!Array.isArray(rows)||rows.length!==part.records)throw Error('Prepared wall projection record count mismatch');
   // Do not fill both shared history slots before the first authenticated
   // member arrives. Visible native prices can enter the free slot while the
   // first wall response waits for headers/body; later batches still pipeline.
   if(part.index===current.selected[0]!.index)next=acquire(current.next);
   const began=performance.now(),ready:Array<Omit<RecordRow,'offset'|'totalRuns'>>=[];let yielded=performance.now(),yieldMs=0;
   for(const [row,value] of rows.entries()){
    const coordinate=coordinates.get(part.index+':'+row);if(!coordinate)continue;
    const group=fragments[coordinate.group]!;group[coordinate.fragment]=value;
    if(group.some(fragment=>fragment===undefined))continue;
    const first=group[0]!,{valueRuns:_values,...header}=first.segment;let count=0;
    for(const record of group as RecordRow[]){const {valueRuns,...nextHeader}=record.segment;
     if(record.offset!==count||record.totalRuns!==first.totalRuns||record.order!==first.order||!integer(record.order)||record.segment.end===null||JSON.stringify(header)!==JSON.stringify(nextHeader)||!Array.isArray(valueRuns)||record.valueRunOrder?.length!==valueRuns.length)throw Error('Prepared wall projection fragment identity mismatch');count+=valueRuns.length;
    }
    if(count!==first.totalRuns)throw Error('Prepared wall projection fragment coverage mismatch');
    const completed={order:first.order,segment:{...first.segment,valueRuns:(group as RecordRow[]).flatMap(record=>record.segment.valueRuns)},valueRunOrder:(group as RecordRow[]).flatMap(record=>record.valueRunOrder)};
    ready.push(completed);retained.push(completed);fragments[coordinate.group]=[];
    if(performance.now()-yielded>=8){const before=performance.now();await yieldTask(context.signal);yieldMs+=performance.now()-before;context.signal.throwIfAborted();yielded=performance.now();}
   }
   if(ready.length){
    runs+=ready.reduce((n,record)=>n+record.segment.valueRuns.length,0);if(runs>1000000)throw Error('Prepared wall projection retained capacity');
    // Validate only this bounded new batch. Previously imported closed history
    // is neither cloned nor sorted during progressive publication.
    OrderWallsArchiveProjector.restoreCheckpoint({...manifest.active,candidates:[],seenGaps:[],segments:ready.map(row=>row.segment),valueRunOrder:ready.map(row=>row.valueRunOrder)},context.settings,context.from,context.to);
    for(const record of ready){if(presentation.has(record.segment.id))throw Error('Prepared wall projection duplicate identity');presentation.set(record.segment.id,record.segment);}
   }
   const partMergeMs=performance.now()-began-yieldMs;mergeMs+=partMergeMs;context.signal.throwIfAborted();onProgress({segments:ready.map(row=>row.segment),presentation,presentationThrough:manifest.active.confirmedTo,parts,bytes,decodeMs,mergeMs,metrics:{attempts:fetched.attempts,responseHeadersMs:fetched.responseHeadersMs,bodyReadMs:fetched.bodyReadMs,jsonParseMs:fetched.jsonParseMs,validationMs:fetched.validationMs??0,mergeMs:partMergeMs,yieldMs:yieldMs+(fetched.validationYieldMs??0),encodedBytes:Number(fetched.response.headers.get('content-length')??0),requestId:fetched.response.headers.get('x-iq-request-id')??undefined}});await yieldTask(context.signal);
  }
  current.handle.release();current=next;next=undefined;
 }}finally{current?.handle.release();next?.handle.release();}
 if(retained.length!==manifest.closed.length+manifest.active.segments.length||new Set(retained.map(record=>record.order)).size!==retained.length)throw Error('Prepared wall projection incomplete identities');
 // All immutable records have passed content and per-part financial checks. Start the
 // independent source read now so transport can run while final CPU assembly
 // finishes. Neither this read nor progressive presentation certifies completion
 // alone. Observe rejection immediately, including when final assembly throws.
 const validation=context.validateCompletion?.();void validation?.catch(()=>{});
 if(validation){await yieldTask(context.signal);context.signal.throwIfAborted();}
 retained.sort((a,b)=>a.order-b.order);context.signal.throwIfAborted();
 // outputHead is the transport fence already admitted by the source-proof
 // reader. Financial rows/order and active candidates remain untouched. The
 // reader still revalidates the source before returning this final projector.
 const projector=OrderWallsArchiveProjector.restoreCheckpoint({...manifest.active,...(context.outputHead??{}),segments:retained.map(row=>row.segment),valueRunOrder:retained.map(row=>row.valueRunOrder)},context.settings,context.from,context.to);
 // Authenticate the complete presentation description, not merely its source
 // input token: corrections can change part hashes or selected metadata.
 const presentationRevision=await digest(new TextEncoder().encode(JSON.stringify(manifest)));
 await validation;context.signal.throwIfAborted();
 return {projector,coverage:manifest.coverage,profile:manifest.profile,presentation,presentationRevision,parts,bytes,decodeMs,mergeMs};
}

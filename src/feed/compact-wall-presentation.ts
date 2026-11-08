import type {OrderWallSegment} from '../shared/order-walls-projection';
export interface CompactWallPresentation {version:1;identity:string;segments:number;runs:number;bytes:number;retainedBytes:number;decodedBytes:number;chunks:Array<{body:Uint8Array;hash:string;decodedBytes:number;rows:number}>}
interface Row {index:number;offset:number;total:number;segment:OrderWallSegment}
const MAX_DECODED=64*1024*1024,MAX_ENCODED=16*1024*1024,MAX_PART=1024*1024,TARGET=128*1024;
const yieldTask=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),v=>v.toString(16).padStart(2,'0')).join('');
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
async function transform(bytes:Uint8Array,compress:boolean,max:number,signal:AbortSignal){
 signal.throwIfAborted();
 const stream=new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(compress?new CompressionStream('gzip'):new DecompressionStream('gzip'));
 const reader=stream.getReader(),parts:Uint8Array[]=[];let size=0;
 const cancel=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>max)throw Error('Compact wall cache byte capacity');parts.push(value);}}
 finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
 const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result;
}
// Bound work before JSON.stringify, including JSON's worst-case string escaping.
// Canonical segment/point metadata is flat; a future nested extension remains
// displayable but needs an explicit codec revision rather than unbounded work.
function metadataBound(value:object,omitRuns=false){
 let bytes=2048;for(const [key,item] of Object.entries(value)){
  if(omitRuns&&key==='valueRuns')continue;bytes+=key.length*6;
  if(typeof item==='string')bytes+=item.length*6;
  else if(item!==null&&typeof item==='object')throw Error('Compact wall cache metadata capacity');
  if(bytes>MAX_PART)throw Error('Compact wall cache fragment capacity');
 }return bytes;
}
/** Optional background work: one bounded fragment/stream at a time. Exact
 * presentation only; no cursor/accumulator or display-resolution reduction. */
export async function compactWallPresentation(identity:string,segments:readonly OrderWallSegment[],signal:AbortSignal):Promise<CompactWallPresentation>{
 if(typeof CompressionStream!=='function'||!identity||identity.length>8192||segments.length>100000)throw Error('Compact wall cache unavailable or capacity');
 const result:CompactWallPresentation={version:1,identity,segments:segments.length,runs:0,bytes:0,retainedBytes:0,decodedBytes:0,chunks:[]};
 let rows:string[]=[],size=2,yielded=performance.now();
 const flush=async()=>{
  if(!rows.length)return;signal.throwIfAborted();const raw=new TextEncoder().encode('['+rows.join(',')+']');
  if(raw.length>MAX_PART||result.decodedBytes+raw.length>MAX_DECODED||result.chunks.length>=1024)throw Error('Compact wall cache decoded capacity');
  const body=await transform(raw,true,MAX_ENCODED-result.bytes,signal);
  if(result.bytes+body.length>MAX_ENCODED)throw Error('Compact wall cache encoded capacity');
  result.chunks.push({body,hash:await hash(raw),decodedBytes:raw.length,rows:rows.length});result.bytes+=body.length;result.decodedBytes+=raw.length;rows=[];size=2;await yieldTask();signal.throwIfAborted();yielded=performance.now();
 };
 for(const [index,segment] of segments.entries()){
  const total=segment.valueRuns.length,headerBytes=metadataBound(segment,true)+128;result.runs+=total;if(result.runs>1000000)throw Error('Compact wall cache value capacity');let offset=0;
  do{
   signal.throwIfAborted();let count=0,bound=headerBytes;
   while(offset+count<total&&count<256){const pointBytes=metadataBound(segment.valueRuns[offset+count]!);if(headerBytes+pointBytes>MAX_PART)throw Error('Compact wall cache fragment capacity');if(count&&bound+pointBytes>TARGET)break;bound+=pointBytes;count++;}
   const row:Row={index,offset,total,segment:{...segment,valueRuns:segment.valueRuns.slice(offset,offset+count)}},text=JSON.stringify(row),bytes=new TextEncoder().encode(text).length;
   if(bytes+2>MAX_PART)throw Error('Compact wall cache fragment capacity');
   if(size+bytes+1>TARGET)await flush();rows.push(text);size+=bytes+1;offset+=count;
   if(performance.now()-yielded>=8){await yieldTask();signal.throwIfAborted();yielded=performance.now();}
  }while(offset<total);
 }
 await flush();result.retainedBytes=result.bytes+result.chunks.length*256+identity.length*2+256;if(result.retainedBytes>MAX_ENCODED)throw Error('Compact wall cache metadata capacity');return result;
}
/** Decode at most one bounded chunk before yielding. Partial delivery remains
 * a cached revision, never proof that fresh requested coverage is complete. */
export async function replayCompactWallPresentation(value:CompactWallPresentation,identity:string,signal:AbortSignal,publish:(segments:OrderWallSegment[])=>void){
 if(value.version!==1||value.identity!==identity||!integer(value.segments)||value.segments>100000||!integer(value.runs)||value.runs>1000000||!integer(value.bytes)||value.bytes>MAX_ENCODED||!integer(value.retainedBytes)||value.retainedBytes>MAX_ENCODED||!integer(value.decodedBytes)||value.decodedBytes>MAX_DECODED||!Array.isArray(value.chunks)||value.chunks.length>1024)throw Error('Invalid compact wall cache identity');
 if(value.retainedBytes!==value.bytes+value.chunks.length*256+identity.length*2+256)throw Error('Invalid compact wall cache retained total');
 let index=0,runs=0,decoded=0,encoded=0,pending:Row|undefined,header:string|undefined;const ids=new Set<string>();
 for(const chunk of value.chunks){
  signal.throwIfAborted();if(!(chunk.body instanceof Uint8Array)||!integer(chunk.decodedBytes)||chunk.decodedBytes<2||chunk.decodedBytes>MAX_PART||!integer(chunk.rows)||chunk.rows<1)throw Error('Invalid compact wall cache chunk');
  encoded+=chunk.body.length;decoded+=chunk.decodedBytes;if(encoded>value.bytes||decoded>value.decodedBytes)throw Error('Invalid compact wall cache byte total');
  const raw=await transform(chunk.body,false,chunk.decodedBytes,signal);
  if(raw.length!==chunk.decodedBytes||await hash(raw)!==chunk.hash)throw Error('Compact wall cache content hash mismatch');
  const rows:Row[]=JSON.parse(new TextDecoder().decode(raw)),ready:OrderWallSegment[]=[];
  if(!Array.isArray(rows)||rows.length!==chunk.rows)throw Error('Invalid compact wall cache rows');
  for(const row of rows){
   if(!row||row.index!==index||!integer(row.offset)||!integer(row.total)||row.total>100000||!row.segment||typeof row.segment.id!=='string'||!Array.isArray(row.segment.valueRuns)||row.segment.valueRuns.length>256)throw Error('Invalid compact wall cache fragment');
   const {valueRuns,...meta}=row.segment,nextHeader=JSON.stringify(meta);
   if(!pending){if(row.offset!==0||ids.has(row.segment.id))throw Error('Invalid compact wall cache segment order');pending={...row,segment:{...row.segment,valueRuns:[]}};header=nextHeader;}
   if(row.total!==pending.total||row.offset!==pending.segment.valueRuns.length||nextHeader!==header||row.offset+valueRuns.length>row.total||row.total>row.offset&&!valueRuns.length)throw Error('Invalid compact wall cache fragment coverage');
   pending.segment.valueRuns.push(...valueRuns);
   if(pending.segment.valueRuns.length===pending.total){ready.push(pending.segment);ids.add(pending.segment.id);runs+=pending.total;if(runs>value.runs)throw Error('Invalid compact wall cache value total');pending=undefined;header=undefined;index++;}
  }
  signal.throwIfAborted();if(ready.length)publish(ready);await yieldTask();
 }
 signal.throwIfAborted();if(pending||index!==value.segments||runs!==value.runs||decoded!==value.decodedBytes||encoded!==value.bytes)throw Error('Incomplete compact wall cache coverage');
}

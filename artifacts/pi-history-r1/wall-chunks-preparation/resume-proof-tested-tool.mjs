/** Explicit bounded real-source equivalence proof, not a chart latency gate. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {advanceWallChunk,WALL_CHUNK_MS,wallChunkSourceRevision,readWallChunkPart} from '../src/wall-history-chunks.ts';
import {atomicWrite} from '../src/history-state.ts';
if(process.env.IQ_PREPARE_WALL_CHUNKS!=='1')throw Error('Explicit wall preparation proof opt-in required');
const [market,fromArg,output]=process.argv.slice(2),from=Number(fromArg),totalStarted=performance.now();
const maxSteps=Number(process.env.IQ_WALL_PREPARE_MAX_PAGES??64);
assert.ok(['spot','perpetual'].includes(market)&&Number.isSafeInteger(from)&&from%WALL_CHUNK_MS===0&&output);
assert.ok(Number.isInteger(maxSteps)&&maxSteps>=1&&maxSteps<=64);
const profile=market==='spot'?'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1':'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1';
const base='http://127.0.0.1:18780',to=from+WALL_CHUNK_MS;
await mkdir(output,{recursive:true});
const load=async(r)=>{
 const params=new URLSearchParams({market,profile,from:String(from),to:String(to),after:String(r.after??0),display:'1'});
 if(r.watermark!==undefined)params.set('watermark',String(r.watermark));
 const start=performance.now(),res=await fetch(base+'/v1/order-walls/archive?'+params,{signal:AbortSignal.timeout(30000),headers:{'X-IQ-View-Id':'wall-chunk-reference'}});
 assert.equal(res.status,200);
 const reader=res.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>8*1024*1024){await reader.cancel();throw Error('Bounded reference response byte budget');}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 const page=JSON.parse(Buffer.concat(chunks).toString());
 console.log(JSON.stringify({kind:'canonical-page',after:r.after??0,nextAfter:page.page?.nextAfter,ms:performance.now()-start,bytes,queries:res.headers.get('x-iq-db-queries'),readRows:res.headers.get('x-iq-db-read-rows'),readBytes:res.headers.get('x-iq-db-read-bytes')}));
 return page;
};
let baseline,reference,resumed=false;
try{baseline=JSON.parse(await readFile(join(output,'baseline.json'),'utf8'));resumed=true;}
catch(e){if(e.code!=='ENOENT')throw e;}
if(baseline){
 assert.deepEqual({market:baseline.request.market,profile:baseline.request.profile,from:baseline.request.from,to:baseline.request.to},{market,profile,from,to});
 reference=JSON.parse(gunzipSync(await readFile(join(output,'reference.json.gz'))));
 assert.equal(wallChunkSourceRevision(reference),baseline.request.sourceRevision,'Saved reference checksum differs');
}else{
 const health=await(await fetch(base+'/v2/history/health',{signal:AbortSignal.timeout(30000)})).json();
 reference=[];let after=0,watermark;const referenceStarted=performance.now();
 for(let n=0;n<64;n++){
  const page=await load({after,watermark});watermark??=page.watermark;assert.equal(page.watermark,watermark);reference.push(page);after=page.page.nextAfter;
  if(!page.page.hasMore)break;assert.ok(n<63,'bounded reference did not complete');
 }
 const request={market,profile,from,to,watermark,sourceRevision:wallChunkSourceRevision(reference)};
 baseline={request,referenceMs:performance.now()-referenceStarted,sourceBuild:health.build,toolHash:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')};
 await atomicWrite(join(output,'reference.json.gz'),gzipSync(JSON.stringify(reference)));
 await atomicWrite(join(output,'baseline.json'),JSON.stringify(baseline));
}
const request=baseline.request,prepareStarted=performance.now();let state;
for(let n=0;n<maxSteps;n++){
 state=await advanceWallChunk(join(output,'chunks'),request,load);
 console.log(JSON.stringify({kind:'prepare-progress',resumed,key:state.key,parts:state.parts.length,complete:state.complete,after:state.after,elapsedMs:performance.now()-prepareStarted}));
 if(state.complete)break;
}
if(!state.complete){console.log(JSON.stringify({kind:'preparation-pending',resumed,request,key:state.key,parts:state.parts.length,after:state.after,totalInvocationMs:performance.now()-totalStarted}));process.exit(0);}
const canonical=p=>{const {profileStatus,...data}=p;return data;};
const prepared=[];let gzipBytes=0,rawBytes=0,decodeMs=0;
for(const part of state.parts){
 const {body}=await readWallChunkPart(join(output,'chunks'),state.key,part.hash),t=performance.now(),text=gunzipSync(body).toString();
 assert.equal(createHash('sha256').update(text).digest('hex'),part.hash);
 prepared.push(JSON.parse(text));decodeMs+=performance.now()-t;gzipBytes+=body.byteLength;
}
assert.deepEqual(prepared.map(canonical),reference.map(canonical));
for(const page of reference)rawBytes+=Buffer.byteLength(JSON.stringify(page));
const result={kind:'prepared-wall-hour-independent-reference',...request,sourceBuild:baseline.sourceBuild,toolHash:baseline.toolHash,resumed,arch:process.arch,node:process.version,parts:state.parts.length,patches:reference.reduce((s,p)=>s+p.patches.length,0),rawBytes,preparedGzipBytes:gzipBytes,ratio:gzipBytes/rawBytes,decodeMs,referenceMs:baseline.referenceMs,prepareAndReadbackMs:performance.now()-prepareStarted,totalInvocationMs:performance.now()-totalStarted,coverage:state.coverage,complete:state.complete,result:'exact-canonical-page-match',scope:'one bounded real hour; reference/readback phases overlap total; no rendered or 30h latency claim'};
await atomicWrite(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

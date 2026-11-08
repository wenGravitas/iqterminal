/** Actual client service over pinned captured files. No network/browser/fresh
 * SQL proof or latency gate. This reports a capacity failure honestly. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
const [modulePath,input,sourcePath,output]=process.argv.slice(2);assert.ok(output);
execFileSync('git',['diff','--quiet','--','src','scripts/verify-wall-warm-capacity.mjs','scripts/wall-presentation-cache-benchmark-entry.ts']);
const clientCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {OrderWallsArchiveService}=await import(pathToFileURL(resolve(modulePath)).href),source=JSON.parse(await readFile(sourcePath,'utf8')),manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8'));
assert.equal(source.manifest.key,manifest.sourceKey);assert.equal(source.source.token,manifest.sourceToken);assert.equal(source.state,'ready');
const encodedParts=[];for(const part of manifest.parts){
 const encoded=await readFile(join(input,part.hash+'.json.gz'));assert.equal(createHash('sha256').update(encoded).digest('hex'),part.compressedHash);
 const bytes=gunzipSync(encoded,{maxOutputLength:4*1024*1024});assert.equal(bytes.length,part.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),part.hash);encodedParts.push(bytes);
}
const samples=[],requests=[];
const fetcher=async input=>{
 const u=new URL(String(input),'http://offline');requests.push(u.pathname);
 if(u.pathname.endsWith('/discover'))return Response.json({...source,projection:{manifest,delivery:{version:1,maxParts:32,maxDecodedBytes:8*1024*1024}}});
 if(u.pathname.endsWith('/source'))return Response.json(source.source);
 if(u.pathname.endsWith('/projection-batch')){
  const start=Number(u.searchParams.get('start'));let next=start,size=0;
  while(next<Math.min(start+32,manifest.parts.length)&&size+manifest.parts[next].bytes+1<=8*1024*1024){size+=manifest.parts[next].bytes+1;next++;}
  let index=start;return new Response(new ReadableStream({pull(controller){if(index===next){controller.close();return;}const row=new Uint8Array(encodedParts[index].length+1);row.set(encodedParts[index++]);row[row.length-1]=10;controller.enqueue(row);}}),{headers:{'x-iq-wall-start':String(start),'x-iq-wall-next':String(next),'x-iq-wall-parts':String(next-start),'x-iq-chunk-key':manifest.key,'x-iq-source-revision':manifest.sourceToken}});
 }
 throw Error('Unexpected fixture request '+u.pathname);
};
for(let run=1;run<=5;run++){
 const retained=new Map();let complete=false,last;const started=performance.now();
 const service=new OrderWallsArchiveService(event=>{
  if(event.kind==='snapshot'){retained.clear();for(const segment of event.segments??[])retained.set(segment.id,segment);}
  else for(const patch of event.patches??[]){if(patch.segment)retained.set(patch.id,patch.segment);else retained.delete(patch.id);}
  if(event.status.archive?.requestComplete){complete=true;last=event.status.archive;}
 },fetcher,()=>manifest.active.to+1000);
 try{
  service.subscribe('pinned',{market:'binance-spot',from:manifest.active.from,to:manifest.active.to,settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0},followLive:false});
  while(!complete){if(performance.now()-started>15000)throw Error('Offline complete-coverage assertion timed out');await new Promise(r=>setTimeout(r,5));}
  const segments=[...retained.values()].sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price),hash=createHash('sha256');
  // currentSelection is service presentation metadata, outside the canonical hash.
  for(const {currentSelection:_current,...segment} of segments)hash.update(JSON.stringify(segment));
  const financialHash=hash.digest('hex');assert.equal(financialHash,'cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e');assert.equal(segments.length,8293);
  const runs=segments.reduce((n,s)=>n+s.valueRuns.length,0);assert.equal(runs,49154);assert.equal(last.gaps.length,35);
  // Completion is published synchronously before the resolved loader's cache
  // admission callback. Wait for that same job to settle, never start another.
  await new Promise(r=>setTimeout(r,0));
  const diag=service.diagnostics();assert.equal(diag.warmEntries,0);assert.equal(diag.warmCapacityMisses,1);
  service.unsubscribe('pinned');samples.push({run,scope:'Offline file-to-client service correctness/capacity; no paint claim',financialHash,segments:segments.length,runs,gaps:last.gaps.length,elapsedMs:performance.now()-started,requested:{from:manifest.active.from,to:manifest.active.to},archive:last,diagnostics:diag,afterUnsubscribe:service.diagnostics()});
 }finally{service.dispose();}
}
await writeFile(output,JSON.stringify({scope:'Five offline Pi production-service loads over captured immutable prepared parts; source proof is pinned input, not fresh SQL validation; not a browser latency or actual-route warm gate',clientCommit,sourceToken:manifest.sourceToken,sourceKey:manifest.sourceKey,projectionKey:manifest.key,core:manifest.core,node:process.version,arch:process.arch,moduleSha256:createHash('sha256').update(await readFile(modulePath)).digest('hex'),samples,requests},null,2)+'\n');console.log(JSON.stringify(samples.map(s=>({run:s.run,elapsedMs:s.elapsedMs,warmEntries:s.diagnostics.warmEntries,warmCapacityMisses:s.diagnostics.warmCapacityMisses}))));

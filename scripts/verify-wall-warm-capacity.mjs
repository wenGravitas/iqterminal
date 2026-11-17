/** Actual client service over pinned in-memory fixture responses. No network,
 * browser, fresh SQL/storage timing or latency acceptance gate. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
const [modulePath,input,sourcePath,output]=process.argv.slice(2);assert.ok(output);
const workingSource=process.env.IQ_FILE_WORKING_SOURCE==='1';
if(!workingSource)execFileSync('git',['diff','--quiet','--','src','scripts/verify-wall-warm-capacity.mjs','scripts/wall-presentation-cache-benchmark-entry.ts']);
const clientCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {OrderWallsArchiveService}=await import(pathToFileURL(resolve(modulePath)).href),source=JSON.parse(await readFile(sourcePath,'utf8')),manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8'));
const expected=manifest.profile.market==='spot'?{segments:8293,runs:49154,gaps:35,hash:'cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e',market:'binance-spot'}:{segments:23850,runs:104112,gaps:47,hash:'de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6',market:'binance-perp'};
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
const samplesRequested=Number(process.env.IQ_FILE_SAMPLES??5);assert.ok(Number.isInteger(samplesRequested)&&samplesRequested>=1&&samplesRequested<=5);
const until=async(predicate,message)=>{const at=performance.now();while(!predicate()){if(performance.now()-at>20000)throw Error(message);await new Promise(r=>setTimeout(r,5));}};
for(let run=1;run<=samplesRequested;run++){
 const resourcesBefore={load:(await readFile('/proc/loadavg','utf8')).trim(),memory:await readFile('/proc/meminfo','utf8'),process:process.memoryUsage()},cpuBefore=process.cpuUsage();
 const retained=new Map();let complete=false,last,runs=0,holdFresh=false,releaseFresh,firstCachedMs=null,warmStarted=0;
 const freshGate=new Promise(resolve=>releaseFresh=resolve),started=performance.now();
 const service=new OrderWallsArchiveService(event=>{
  if(event.kind==='snapshot'){retained.clear();runs=0;for(const segment of event.segments??[]){retained.set(segment.id,segment);runs+=segment.valueRuns.length;}}
  else for(const patch of event.patches??[]){const old=retained.get(patch.id);if(old)runs-=old.valueRuns.length;if(patch.segment){retained.set(patch.id,patch.segment);runs+=patch.segment.valueRuns.length;}else retained.delete(patch.id);}
  last=event.status.archive;
  if(holdFresh&&retained.size&&firstCachedMs===null)firstCachedMs=performance.now()-warmStarted;
  if(last?.requestComplete)complete=true;
 },async(input,init)=>{
  if(holdFresh&&String(input).includes('/discover?')){
   await new Promise((resolve,reject)=>{const cancel=()=>reject(new DOMException('Aborted','AbortError'));init?.signal?.addEventListener('abort',cancel,{once:true});freshGate.then(()=>{init?.signal?.removeEventListener('abort',cancel);resolve();});});
  }
  return fetcher(input);
 },()=>manifest.active.to+1000);
 const subscription={market:expected.market,from:manifest.active.from,to:manifest.active.to,settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0},followLive:false};
 const validate=()=>{
  const segments=[...retained.values()].sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price),hash=createHash('sha256');
  for(const {currentSelection:_current,...segment} of segments)hash.update(JSON.stringify(segment));
  const financialHash=hash.digest('hex');assert.equal(financialHash,expected.hash);assert.equal(segments.length,expected.segments);assert.equal(runs,expected.runs);assert.equal(last.gaps.length,expected.gaps);return financialHash;
 };
 try{
  service.subscribe('pinned',subscription);await until(()=>complete,'Offline full history did not validate');const seedReadyMs=performance.now()-started,financialHash=validate();
  await until(()=>service.diagnostics().warmEntries===1&&service.diagnostics().warmBuilds===0,'Compact cache did not become ready');
  const cacheReadyMs=performance.now()-started,seedDiagnostics=service.diagnostics();assert.equal(seedDiagnostics.warmCompactEntries,1);assert.equal(seedDiagnostics.warmCapacityMisses,0);assert.ok(seedDiagnostics.warmBytes<=16*1024*1024);
  service.unsubscribe('pinned');retained.clear();runs=0;complete=false;holdFresh=true;warmStarted=performance.now();service.subscribe('warm',subscription);
  await until(()=>retained.size===expected.segments&&runs===expected.runs&&service.diagnostics().warmReplayJobs===0,'Compact cached view did not replay every financial record');const fullCachedMs=performance.now()-warmStarted;validate();assert.equal(complete,false);assert.equal(last.requestComplete,false);
  const cachedDiagnostics=service.diagnostics();assert.equal(cachedDiagnostics.warmReplayConsumers,1);assert.equal(cachedDiagnostics.projections.length,0);
  holdFresh=false;releaseFresh();await until(()=>complete,'Independent fresh validation did not complete');validate();
  await until(()=>service.diagnostics().warmBuilds===0,'Fresh revision left a cache build');
  const validatedMs=performance.now()-warmStarted,diag=service.diagnostics();assert.equal(diag.warmRevisionReuses,1);assert.equal(diag.warmCompactBuilds,1);
  service.unsubscribe('warm');const afterUnsubscribe=service.diagnostics();assert.equal(afterUnsubscribe.warmReplayConsumers,0);assert.equal(afterUnsubscribe.projections.length,0);
  samples.push({run,scope:'Offline actual client service and compact warm coverage; no browser/paint claim',financialHash,segments:expected.segments,runs:expected.runs,gaps:expected.gaps,seedReadyMs,cacheReadyMs,encodingAfterReadyMs:cacheReadyMs-seedReadyMs,firstCachedContentMs:firstCachedMs,fullCachedContentMs:fullCachedMs,independentValidatedMs:validatedMs,requested:{from:manifest.active.from,to:manifest.active.to},archive:last,seedDiagnostics,cachedDiagnostics,diagnostics:diag,afterUnsubscribe,resourcesBefore,resourcesAfter:{load:(await readFile('/proc/loadavg','utf8')).trim(),process:process.memoryUsage(),cpu:process.cpuUsage(cpuBefore)}});
 }finally{releaseFresh();service.dispose();}
}

await writeFile(output,JSON.stringify({scope:'Offline Pi fresh service instances and compact warm reuse over preloaded captured immutable responses; source proof is pinned input, not fresh SQL validation; not browser paint or an actual-route warm gate',clientCommit,workingSource,sourceToken:manifest.sourceToken,sourceKey:manifest.sourceKey,projectionKey:manifest.key,core:manifest.core,node:process.version,arch:process.arch,moduleSha256:createHash('sha256').update(await readFile(modulePath)).digest('hex'),samples,requests},null,2)+'\n');console.log(JSON.stringify(samples.map(s=>({run:s.run,seedReadyMs:s.seedReadyMs,encodingAfterReadyMs:s.encodingAfterReadyMs,firstCachedContentMs:s.firstCachedContentMs,fullCachedContentMs:s.fullCachedContentMs,warmBytes:s.diagnostics.warmBytes}))));

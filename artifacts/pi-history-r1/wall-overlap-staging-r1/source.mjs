/** Isolated canonical overlap proof over retained real source. Writes derived
 * files only under a new explicitly selected root; no serving cache publication. */
import assert from 'node:assert/strict';
import {getHeapStatistics} from 'node:v8';
import {mkdir,readFile,cp,appendFile,statfs,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzip as unzip} from 'node:zlib';import {promisify} from 'node:util';
import {advancePreparedWallView,readWallChunkManifest,readWallChunkPart} from '../src/wall-history-chunks.ts';
import {wallSourceVersion} from '../src/wall-source-version.ts';
import {queryTiming} from '../src/query-timing.ts';
import {OrderWallsArchiveProjector} from '../src/shared/order-walls-projection.ts';
assert.ok(getHeapStatistics().heap_size_limit<=320*1024**2,'Run isolated verification with --max-old-space-size=256');
if(process.env.IQ_WALL_OVERLAP_VERIFY!=='1')throw Error('Explicit isolated canonical overlap verification required');
const sql=new URL(process.env.CH_URL??'http://invalid');assert.equal(sql.hostname,'127.0.0.1');assert.equal(sql.port,'18790');
process.env.CH_PASSWORD??=process.env.CH_APP_PASSWORD;
const [existingText,outputText,keysText]=process.argv.slice(2),existing=resolve(existingText??''),output=resolve(outputText??''),keys=(keysText??'').split(',');
assert.ok(existing.startsWith('/home/daz/')&&output.startsWith('/home/daz/')&&output!==existing&&keys.length===2&&keys.every(k=>/^[a-f0-9]{64}$/.test(k)));
await mkdir(output);const disk=await statfs(output);assert.ok(Number(disk.bavail)*Number(disk.bsize)>20*1024**3);
const log=async value=>{const text=JSON.stringify(value);await appendFile(join(output,'observations.jsonl'),text+'\n');console.log(text);};
const timed=async(label,fn)=>{const timing={priority:'background',dbMs:0,decodeMs:0,queries:0,bytes:0,readRows:0,readBytes:0,sqlQueueMs:0,requestId:'wall-overlap-'+label},at=performance.now(),cpu=process.cpuUsage();const result=await queryTiming.run(timing,fn);await log({kind:'step',label,elapsedMs:performance.now()-at,cpu:process.cpuUsage(cpu),timing,memory:process.memoryUsage()});return result;};
const gunzip=promisify(unzip),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fold(root,manifest){const projector=new OrderWallsArchiveProjector({topLevels:8,minimumNotionalEnabled:false,minimumNotionalUsd:0,minDurationMs:0},manifest.request.from,manifest.request.to);for(const part of manifest.parts){const {body}=await readWallChunkPart(root,manifest.key,part.hash),bytes=await gunzip(body,{maxOutputLength:part.bytes});assert.equal(bytes.length,part.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),part.hash);projector.applyPage(JSON.parse(bytes));await new Promise(r=>setImmediate(r));}assert.equal(projector.historyLimited,false);return {financialHash:digest(projector.snapshot()),selectedHash:digest(projector.selectedState()),segments:projector.snapshot().length,valueRuns:projector.snapshot().reduce((n,s)=>n+s.valueRuns.length,0)};}
const results=[];
for(const key of keys){
 const old=await readWallChunkManifest(join(existing,'canonical'),key),market=old.request.market,step=market==='spot'?300000:900000;
 const freshOld=await timed(market+'-validate-overlap',()=>wallSourceVersion(old.sourceProof));assert.equal(freshOld.token,old.sourceProof.token,'Old canonical source changed; reuse is ineligible');
 const request={...old.request,from:old.request.from+step,to:old.request.to+step},proof=await timed(market+'-pin-target',()=>wallSourceVersion(request));assert.ok(proof.eligible,proof.reason);
 const reuseRoot=join(output,market+'-reuse'),referenceRoot=join(output,market+'-reference');await mkdir(reuseRoot);await mkdir(referenceRoot);await cp(join(existing,'canonical',key),join(reuseRoot,key),{recursive:true});
 const manifests={};for(const mode of market==='spot'?['reference','reuse']:['reuse','reference']){
  const root=mode==='reuse'?reuseRoot:referenceRoot;let state,pages=0;const at=performance.now();
  do{state=await timed(market+'-'+mode+'-'+pages,()=>advancePreparedWallView(root,proof,mode==='reuse'?{reuse:{sourceKey:key,validatedForToken:proof.token}}:{}));assert.ok(++pages<=128);await new Promise(r=>setTimeout(r,25));}while(!state.complete);
  manifests[mode]=state;await log({kind:'canonical-complete',market,mode,elapsedMs:performance.now()-at,pages,sourceKey:state.key,sourceToken:proof.token,coverage:state.coverage});
 }
 assert.equal(manifests.reuse.key,manifests.reference.key);assert.equal(manifests.reuse.request.sourceRevision,manifests.reference.request.sourceRevision,'Canonical page sequence differs');assert.deepEqual(manifests.reuse.parts,manifests.reference.parts);assert.deepEqual(manifests.reuse.seed,manifests.reference.seed);assert.deepEqual(manifests.reuse.coverage,manifests.reference.coverage);
 const reference=await fold(referenceRoot,manifests.reference),reused=await fold(reuseRoot,manifests.reuse);assert.deepEqual(reused,reference);
 const result={kind:'exact-canonical-overlap',market,request:{market,profile:proof.profile,from:proof.from,to:proof.to},oldSourceKey:key,newSourceKey:manifests.reuse.key,oldSourceToken:old.sourceProof.token,newSourceToken:proof.token,oldWatermark:old.watermark,newWatermark:proof.watermark,pages:manifests.reuse.parts.length,...reused,coverage:manifests.reuse.coverage,scope:'One real-source reference/reuse materialization per market; includes fresh source proofs, exact canonical bytes, closed-wall financial and selected state. Not five-run chart latency/current/foreground acceptance.'};results.push(result);await log(result);
}
await writeFile(join(output,'result.json'),JSON.stringify({build:process.env.IQ_BUILD_COMMIT??'unknown',results},null,2)+'\n');

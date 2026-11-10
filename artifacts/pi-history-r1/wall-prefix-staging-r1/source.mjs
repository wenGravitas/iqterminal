/** Exact forward-extension proof; isolated derived files and background reads.
 * All observed times are same-process monotonic, not browser loading gates. */
import assert from 'node:assert/strict';import {getHeapStatistics} from 'node:v8';
import {mkdir,readFile,cp,appendFile,writeFile,statfs} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {readWallChunkManifest,advancePreparedWallView} from '../src/wall-history-chunks.ts';
import {advancePreparedWallProjection,restorePreparedWallProjection,readPreparedWallProjectionManifest} from '../src/wall-history-projection.ts';
import {wallSourceVersion} from '../src/wall-source-version.ts';import {queryTiming} from '../src/query-timing.ts';
assert.equal(process.env.IQ_WALL_PREFIX_VERIFY,'1','Explicit isolated prefix proof required');assert.ok(getHeapStatistics().heap_size_limit<=320*1024**2);
const sql=new URL(process.env.CH_URL??'http://invalid');assert.equal(sql.hostname,'127.0.0.1');assert.equal(sql.port,'18790');process.env.CH_PASSWORD??=process.env.CH_APP_PASSWORD;
const [existingText,outputText,keysText]=process.argv.slice(2),existing=resolve(existingText??''),output=resolve(outputText??''),keys=(keysText??'').split(',');
assert.ok(existing.startsWith('/home/daz/')&&output.startsWith('/home/daz/')&&existing!==output&&keys.length===2&&keys.every(k=>/^[a-f0-9]{64}$/.test(k)));
await mkdir(output);assert.ok(Number((await statfs(output)).bavail)*Number((await statfs(output)).bsize)>20*1024**3);
const canonical=join(output,'canonical'),referenceCanonical=join(output,'reference-canonical'),reuse=join(output,'projection-reuse'),reference=join(output,'projection-reference');for(const p of [canonical,referenceCanonical,reuse,reference])await mkdir(p);
const log=async value=>{const text=JSON.stringify(value);await appendFile(join(output,'observations.jsonl'),text+'\n');console.log(text);};
const timed=async(label,fn)=>{const timing={priority:'background',dbMs:0,decodeMs:0,queries:0,bytes:0,readRows:0,readBytes:0,sqlQueueMs:0,requestId:'wall-prefix-'+label},at=performance.now(),cpu=process.cpuUsage();const result=await queryTiming.run(timing,fn);await log({kind:'step',label,elapsedMs:performance.now()-at,cpu:process.cpuUsage(cpu),timing,memory:process.memoryUsage(),...(result?.nextPage!==undefined?{nextPage:result.nextPage,prefixInstall:result.prefixInstall,reusedPrefixPages:result.reusedPrefixPages,complete:result.complete}:{})});return result;};
const settings={topLevels:8,minimumNotionalEnabled:false,minimumNotionalUsd:0,minDurationMs:0},results=[];
async function build(label,step,max){let state;const at=performance.now();for(let n=0;n<max;n++){state=await timed(label+'-'+n,step);await new Promise(r=>setTimeout(r,25));if(state.complete){await log({kind:'build-complete',label,steps:n+1,elapsedMs:performance.now()-at,reusedPrefixPages:state.reusedPrefixPages,sourceKey:state.sourceKey??state.key,projectionKey:state.sourceKey?state.key:undefined});return state;}}throw Error('Bounded preparation step limit');}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const key of keys){
 const prior=await readWallChunkManifest(join(existing,'canonical'),key),market=prior.request.market,step=market==='spot'?300000:900000;
 const base=await timed(market+'-base-proof',()=>wallSourceVersion(prior.sourceProof));assert.equal(base.token,prior.sourceProof.token,'Existing source changed');
 // Pin both horizons before materialization. No artificial head/epoch rewriting.
 const target=await timed(market+'-target-proof',()=>wallSourceVersion({...prior.request,to:prior.request.to+step}));assert.ok(target.eligible,target.reason);assert.ok(target.watermark>=base.watermark);
 await cp(join(existing,'canonical',key),join(canonical,key),{recursive:true});
 const baseSource=await build(market+'-canonical-base',()=>advancePreparedWallView(canonical,base,{reuse:{sourceKey:key,validatedForToken:base.token}}),128);
 const baseProjection=await build(market+'-projection-base',()=>advancePreparedWallProjection(reuse,canonical,baseSource.key,settings),128);assert.ok(baseProjection.extensionPrefix);
 const fresh=await timed(market+'-revalidate-base',()=>wallSourceVersion(base));assert.equal(fresh.token,base.token);
 const source=await build(market+'-canonical-target',()=>advancePreparedWallView(canonical,target,{reuse:{sourceKey:baseSource.key,validatedForToken:target.token}}),128);
 const independent=await build(market+'-canonical-reference',()=>advancePreparedWallView(referenceCanonical,target),128);
 assert.equal(source.request.sourceRevision,independent.request.sourceRevision);assert.deepEqual(source.parts,independent.parts);assert.deepEqual(source.seed,independent.seed);assert.deepEqual(source.coverage,independent.coverage);
 const projected={};for(const mode of market==='spot'?['reference','reuse']:['reuse','reference'])projected[mode]=await build(market+'-projection-'+mode,()=>advancePreparedWallProjection(mode==='reuse'?reuse:reference,mode==='reuse'?canonical:referenceCanonical,source.key,settings,mode==='reuse'?{reuseProjectionKey:baseProjection.key}:{}),640);
 assert.ok(projected.reuse.reusedPrefixPages>0,'Real prefix was not eligible; no reuse performance claim');
 assert.deepEqual(projected.reuse.parts,projected.reference.parts);assert.deepEqual(projected.reuse.entries,projected.reference.entries);assert.deepEqual(projected.reuse.active,projected.reference.active);
 const a=await restorePreparedWallProjection(reuse,projected.reuse),b=await restorePreparedWallProjection(reference,projected.reference);assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.selectedState(),b.selectedState());assert.equal(a.historyLimited,false);
 const result={kind:'exact-projection-prefix-extension',market,from:target.from,to:target.to,baseTo:base.to,baseSourceKey:baseSource.key,baseProjectionKey:baseProjection.key,sourceKey:source.key,projectionKey:projected.reuse.key,sourceToken:target.token,baseWatermark:base.watermark,targetWatermark:target.watermark,baseEpoch:base.head.epoch,targetEpoch:target.head.epoch,canonicalPages:source.parts.length,reusedPrefixPages:projected.reuse.reusedPrefixPages,financialHash:digest(a.snapshot()),selectedHash:digest(a.selectedState()),segments:a.snapshot().length,valueRuns:a.snapshot().reduce((n,s)=>n+s.valueRuns.length,0),coverage:source.coverage,scope:'One actual default same-start/end-extended window per market. Canonical input matches independent DB pages; prefix output matches full fresh fold byte/identity/value/queue and selected state. No live cursor seeding, browser latency or five-run acceptance.'};results.push(result);await log(result);
}
await writeFile(join(output,'result.json'),JSON.stringify({build:process.env.IQ_BUILD_COMMIT??'unknown',runtime:{node:process.version,arch:process.arch},results},null,2)+'\n');

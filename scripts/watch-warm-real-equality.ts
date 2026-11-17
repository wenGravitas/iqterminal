/** Exact prepared financial/client comparison, outside timed browser work. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readPreparedWallProjection} from '../src/feed/prepared-wall-projection';
import {PreparedWallPartCache} from '../src/feed/prepared-wall-part-cache';
import {acquirePreparedWallReadLease} from '../src/feed/prepared-wall-read-lease';
import {WALL_PROJECTION_CORE_SHA256} from '../src/shared/order-walls-projection-version';
const root='artifacts/watch-ack-warm-acceptance',label=process.env.IQ_EQUALITY_COHORT??'final-current';assert.match(label,/^[a-z-]+$/);const cohort=JSON.parse(readFileSync(root+'/'+label+'/browser-result.json','utf8')),receiptName=label==='fresh-current'?'real-equality':'final-real-equality';
const cutoff=Date.parse(JSON.parse(readFileSync(root+'/manifest.json','utf8')).experimentCutoffUtc);
assert.ok(Date.now()+300000<cutoff);
const baseline=await import(new URL('./baseline-importer.mjs',import.meta.url).href),base='http://127.0.0.1:4204',cache=new PreparedWallPartCache();
const phases=['parent','extension-1','extension-2','reopen-complete'];
for(const phase of phases){
 const capture=cohort.captures.find((r:any)=>r.phase===phase);assert.ok(capture);const a=capture.status.archive;
 const request={market:'perpetual',profile:a.profileId,from:a.from,to:a.eligibleTo??a.to};
 const signal=AbortSignal.timeout(120000);let lease:Awaited<ReturnType<typeof acquirePreparedWallReadLease>>|undefined;
 const fetcher:typeof fetch=(input,init)=>{const headers=new Headers(init?.headers);headers.set('Origin',base);if(lease)headers.set('X-IQ-Wall-Reader',lease.consumer);return fetch(new URL(String(input),base),{...init,headers});};
 try{
  const q=new URLSearchParams(Object.entries(request).map(([k,v])=>[k,String(v)]));
  const response=await fetcher('/market-data/v2/history/walls/discover?'+q,{signal,headers:{'X-IQ-Wall-Projection':WALL_PROJECTION_CORE_SHA256,'X-IQ-Wall-Projection-Only':'1','X-IQ-Request-Id':'latency-equality-'+phase}});
  assert.ok(response.ok);const d=await response.json(),m=d.projection?.manifest;assert.equal(d.state,'ready');assert.ok(m);
  lease=await acquirePreparedWallReadLease({canonicalKey:m.sourceKey,projectionKey:m.key},fetcher,signal);
  const validateCompletion=async()=>{lease!.assertActive();const r=await fetcher('/market-data/v2/history/walls/source?'+q,{signal});assert.ok(r.ok);const s=await r.json();assert.equal(s.token,m.sourceToken);assert.ok(s.eligible);};
  const context={sourceKey:m.sourceKey,sourceToken:m.sourceToken,watermark:m.active.cursor,epoch:m.active.epoch,from:m.active.from,to:m.active.to,profile:m.profile.id,market:m.profile.market,settings:m.settings,fetcher,signal,restoreProjector:false,validateCompletion};
  const reference=await baseline.readPreparedWallProjection(d.projection,context,()=>{}),actual=await readPreparedWallProjection(d.projection,{...context,partCache:cache},()=>{});
  assert.ok(reference&&actual);assert.deepEqual(actual.segments,reference.segments);assert.deepEqual(actual.coverage,reference.coverage);assert.deepEqual(actual.profile,reference.profile);assert.equal(actual.confirmedAt,reference.confirmedAt);assert.equal(actual.presentationRevision,reference.presentationRevision);
  const chartPhase=phase==='reopen-complete'?'reopen':phase,chartPath=root+'/'+label+'/'+chartPhase+'-chart-financial.json',chart=existsSync(chartPath)?JSON.parse(readFileSync(chartPath,'utf8')):undefined;
  const strip=(s:any)=>{const{currentSelection,...row}=s;return row;},displayed=new Map<string,any>((chart?.segments??[]).map((s:any)=>[s.id,strip(s)]));let closedExact=0,active=0;const missing:string[]=[],mismatched:string[]=[];
  for(const s of chart?reference.segments:[]){if(s.end===null){active++;continue;}const next=displayed.get(s.id);if(!next)missing.push(s.id);else{try{assert.deepEqual(next,s);closedExact++;}catch{mismatched.push(s.id);}}}
  const receipt={cohort:label,phase,request,sourceRecords:d.source.records,sourceWatermark:d.source.watermark,chartCaptured:Boolean(chart),sourceToken:m.sourceToken,projection:m.key,manifestRevision:actual.presentationRevision,parts:m.parts.length,segments:actual.segments.length,runs:actual.segments.reduce((n:any,s:any)=>n+s.valueRuns.length,0),financialSha256:createHash('sha256').update(JSON.stringify(actual.segments)).digest('hex'),exactPreparedEquality:true,chartClosedExact:closedExact,chartActiveReference:active,chartMissingClosed:missing,chartMismatchedClosed:mismatched,coverage:actual.coverage,finalization:actual.finalization,cache:cache.diagnostics()};
  appendFileSync(root+'/'+receiptName+'.jsonl',JSON.stringify(receipt)+'\n');assert.equal(mismatched.length,0,'Changed closed financial rows reached the chart');assert.equal(missing.length,0,'Required closed financial rows absent from the chart');
 }finally{lease?.release();}
}
cache.dispose();assert.equal(cache.diagnostics().accountedBytes,0);
writeFileSync(root+'/'+receiptName+'-complete.json',JSON.stringify({phases,producer:'Unchanged canonical/financial producer from prior capacity proof; only HTTP encoding changes',reference:'Unchanged task-baseline0ff6b61 financial importer',scope:label==='fresh-current'?'All prepared financial rows exact; every closed prepared segment exact in real chart. Current active overlays assessed independently.':'All four final prepared outputs exact against unchanged baseline importer. Final saved reopen closed chart rows also checked; chart data dump taken only after its completed paint, outside timed workflow. Producer/importer/value algorithms unchanged; compact replay separately exact on fixed real inputs.'},null,2));

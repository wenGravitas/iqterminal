/** Offline real-source worker import comparison. The interval is an event-loop
 * responsiveness probe, not an exchange feed or a chart/loading acceptance. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';import {build} from 'vite';
import {chromium} from './test-browser-launch.mjs';
assert.equal(process.env.IQ_WALL_IMPORT_BENCH,'1','Explicit offline worker benchmark opt-in required');
const label=process.env.IQ_BENCH_LABEL;assert.match(label??'',/^[a-zA-Z0-9_-]{1,70}$/);
const out=resolve('artifacts/pi-history-r1/'+label),temp=await mkdtemp(join(tmpdir(),'iq-wall-import-'));await mkdir(out);let browser;
const baseline='4e2ab28',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const old=execFileSync('git',['show',baseline+':src/shared/order-walls-projection.ts']),candidate=await readFile('src/shared/order-walls-projection.ts');
 for(const [name,body] of [['old',old],['candidate',candidate]]){await writeFile(join(temp,name+'.ts'),body);await writeFile(join(out,name+'.ts'),body);}
 await writeFile(join(out,'executed.mjs'),await readFile(new URL(import.meta.url)));
 await writeFile(join(temp,'entry.ts'),"export {OrderWallsArchiveProjector as Old} from './old';export {OrderWallsArchiveProjector as Candidate} from './candidate';");
 await build({configFile:false,logLevel:'error',build:{lib:{entry:join(temp,'entry.ts'),name:'ImportBench',formats:['iife'],fileName:()=> 'import.js'},outDir:join(temp,'bundle'),minify:false,sourcemap:true}});
 const bundle=await readFile(join(temp,'bundle/import.js'),'utf8');await writeFile(join(out,'import.js'),bundle);await writeFile(join(out,'import.js.map'),await readFile(join(temp,'bundle/import.js.map')));
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
 const page=await browser.newPage();await page.route('http://127.0.0.1/iq-wall-import',route=>route.fulfill({contentType:'text/html',body:'Offline import probe'}));await page.goto('http://127.0.0.1/iq-wall-import');
 const results=[];
 for(const [market,input,expected] of [['spot','artifacts/pi-history-r1/wall-presentation-cache-r1/input-spot','cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e'],['perpetual','artifacts/pi-history-r1/compact-warm-r1/input-perpetual','de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6']]){
  const manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')),parts=[];
  for(const part of manifest.parts){const body=gunzipSync(await readFile(join(input,part.hash+'.json.gz')),{maxOutputLength:4*1024*1024});assert.equal(sha(body),part.hash);parts.push(JSON.parse(body));}
  const retained=manifest.active.segments.map((segment,i)=>({segment,order:manifest.activeOrder[i],valueRunOrder:manifest.active.valueRunOrder[i]}));
  for(const pairs of manifest.closed){const rows=pairs.map(([part,row])=>parts[part][row]);retained.push({order:rows[0].order,segment:{...rows[0].segment,valueRuns:rows.flatMap(r=>r.segment.valueRuns)},valueRunOrder:rows.flatMap(r=>r.valueRunOrder)});}
  retained.sort((a,b)=>a.order-b.order);const state={...manifest.active,segments:retained.map(r=>r.segment),valueRunOrder:retained.map(r=>r.valueRunOrder)};
  const check=createHash('sha256');for(const segment of [...state.segments].sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price))check.update(JSON.stringify(segment));assert.equal(check.digest('hex'),expected);
  const text=JSON.stringify(state);await writeFile(join(out,market+'-input.json.gz'),gzipSync(text));
  const samples=[];
  for(let run=1;run<=5;run++)for(const variant of run%2?['old','cooperative']:['cooperative','old']){
   const value=await page.evaluate(async({bundle,state,variant})=>{
    const code=bundle+`;self.onmessage=async({data:{state,variant}})=>{try{
     const sleep=()=>new Promise(r=>setTimeout(r,0)),clock=()=>performance.now(),ticks=[],slices=[];let previous=clock(),sliceStart,started;
     const timer=setInterval(()=>{const now=clock();if(started!==undefined)ticks.push(now-previous);previous=now;},10);
     await new Promise(r=>setTimeout(r,50));started=clock();sliceStart=started;
     const work={now:clock,budgetMs:8,check:()=>{},yield:async()=>{slices.push(clock()-sliceStart);await sleep();sliceStart=clock();}};
     const p=variant==='old'?ImportBench.Old.restoreCheckpoint(state,state.settings,state.from,state.to,state.namespace):await ImportBench.Candidate.restoreCheckpointCooperatively(state,state.settings,state.from,state.to,work,state.namespace);
     const complete=clock(),restoreMs=complete-started;slices.push(complete-sliceStart);await new Promise(r=>setTimeout(r,20));clearInterval(timer);
     const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
     self.postMessage({restoreMs,ticks,slices,checkpointHash:await hash(p.checkpoint()),queueHash:await hash(p.valueRunQueue),diagnostics:p.diagnostics()});
    }catch(e){self.postMessage({error:String(e)});}};`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);
    try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker import observation expired')),30000);worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage({state,variant});});}
    finally{worker.terminate();URL.revokeObjectURL(url);}
   },{bundle,state,variant});
   const sample={market,run,variant,...value};samples.push(sample);await appendFile(join(out,'samples.jsonl'),JSON.stringify(sample)+'\n');assert.ok(!sample.error,JSON.stringify(sample));
  }
  for(let run=1;run<=5;run++){const a=samples.find(s=>s.run===run&&s.variant==='old'),b=samples.find(s=>s.run===run&&s.variant==='cooperative');assert.equal(b.checkpointHash,a.checkpointHash);assert.equal(b.queueHash,a.queueHash);assert.deepEqual(b.diagnostics,a.diagnostics);}
  results.push({market,input,inputSha256:sha(text),sourceToken:manifest.sourceToken,segments:state.segments.length,valueRuns:state.segments.reduce((n,s)=>n+s.valueRuns.length,0),samples});console.log(JSON.stringify({market,exactCheckpointAndQueue:true,samples:samples.length}));
 }
 await writeFile(join(out,'results.json'),JSON.stringify({baseline:execFileSync('git',['rev-parse',baseline],{encoding:'utf8'}).trim(),oldCore:sha(old),candidateCore:sha(candidate),browser:browser.version(),scope:'Actual Pi headless Chromium dedicated-worker import of captured canonical wall checkpoints. Five alternating old/cooperative pairs per market, fresh worker per sample. Timed restore includes cooperative waits; input transfer and checkpoint/queue hashing are outside it. Ten-millisecond interval probes worker event-loop opportunities, not current execution delivery. Not chart paint, source, cold build, route loading, foreground UX or performance-release acceptance.',results},null,2)+'\n');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}

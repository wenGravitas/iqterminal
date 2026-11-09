/** Explicit offline Pi worker scheduling comparison, not chart/live acceptance. */
import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';import {chromium} from './test-browser-launch.mjs';
if(process.env.IQ_WALL_WORKER_YIELD!=='1')throw Error('Explicit offline worker opt-in required');
const output=resolve(process.argv[2]);await mkdir(output);const temp=await mkdtemp(join(tmpdir(),'iq-worker-yield-'));let browser;
try{
 const entry=join(temp,'entry.ts');await writeFile(entry,`export {encodeWallPointTransport,decodeWallPointTransport} from ${JSON.stringify(resolve('src/shared/order-wall-point-transport.ts'))};export {yieldHistoryTask} from ${JSON.stringify(resolve('src/feed/history-task-yield.ts'))};`);
 await writeFile(join(temp,'vite.config.mjs'),`export default {logLevel:'error',build:{lib:{entry:${JSON.stringify(entry)},name:'WallYieldProbe',formats:['iife'],fileName:()=> 'worker.js'},outDir:${JSON.stringify(join(temp,'bundle'))},minify:false,sourcemap:true}}`);
 const compiled=spawnSync(resolve('node_modules/.bin/vite'),['build','--config',join(temp,'vite.config.mjs')],{encoding:'utf8'});await writeFile(join(output,'compile.txt'),(compiled.stdout??'')+(compiled.stderr??''));assert.equal(compiled.status,0);
 const bundle=await readFile(join(temp,'bundle/worker.js'),'utf8');await writeFile(join(output,'worker.js'),bundle);await writeFile(join(output,'worker.js.map'),await readFile(join(temp,'bundle/worker.js.map')));await writeFile(join(output,'executed.mjs'),await readFile(new URL(import.meta.url)));
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
 await writeFile(join(output,'environment.json'),JSON.stringify({browser:browser.version(),node:process.version,arch:process.arch,sourceBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),candidateHelperSha256:createHash('sha256').update(await readFile('src/feed/history-task-yield.ts')).digest('hex'),load:(await readFile('/proc/loadavg','utf8')).trim(),memory:await readFile('/proc/meminfo','utf8'),scope:'Actual Pi headless Chromium dedicated worker; compiler terminal before measurement. Captured immutable canonical batches, no API/exchange reads or chart paint. Message heartbeat is synthetic scheduling input, not current feed confirmation.'},null,2));
 const results=[];
 for(const market of ['spot','perp']){
  const inputPath=resolve(`artifacts/pi-history-r1/product-codec-frames-r2/${market}-batch.gz`),canonical=gunzipSync(await readFile(inputPath),{maxOutputLength:8*1024*1024}),expected=createHash('sha256').update(canonical).digest('hex'),context=await browser.newContext();
  await context.route('http://127.0.0.1/yield-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit offline worker scheduling probe</title>'}));await context.route('http://127.0.0.1/yield-input',r=>r.fulfill({path:inputPath,contentType:'application/gzip'}));
  const page=await context.newPage();await page.exposeFunction('persistSample',sample=>appendFile(join(output,'progress.jsonl'),JSON.stringify({market,...sample})+'\n'));await page.goto('http://127.0.0.1/yield-probe');
  const measured=await page.evaluate(async({bundle,expected})=>{
   const workerMain=()=>{
    let ticks=0,lastTick=0,maxGap=0,running=false,control;
    const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const encode=new TextEncoder();
    onmessage=async({data})=>{
     if(data.type==='tick'){if(running){const now=performance.now();ticks++;maxGap=Math.max(maxGap,now-lastTick);lastTick=now;}return;}
     if(data.type==='cancel'){control?.abort();return;}
     if(data.type!=='start')return;
     try{
      if(typeof scheduler?.postTask!=='function')throw Error('Native scheduler unavailable');
      const response=await fetch('http://127.0.0.1/yield-input'),raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(raw.byteLength>8*1024*1024||await hash(raw)!==data.expected)throw Error('Canonical input identity');
      const lines=new TextDecoder().decode(raw).split('\n');if(lines.pop()!=='')throw Error('Canonical framing');
      const wire=[];for(const line of lines)wire.push(JSON.stringify((await WallYieldProbe.encodeWallPointTransport(JSON.parse(line),undefined,2)).value));
      async function sample(variant,run){
       control=new AbortController();const began=performance.now();let yielded=began,yieldMs=0,yields=0; ticks=0;lastTick=began;maxGap=0;running=true;
       for(const [i,text] of wire.entries()){
        const budget={bytes:encode.encode(text).length,max:encode.encode(lines[i]).length};
        const decoded=await WallYieldProbe.decodeWallPointTransport(JSON.parse(text),async()=>{control.signal.throwIfAborted();if(performance.now()-yielded>=8){const at=performance.now();if(variant==='timer')await new Promise(resolve=>setTimeout(resolve,0));else await WallYieldProbe.yieldHistoryTask(control.signal);yieldMs+=performance.now()-at;yields++;yielded=performance.now();}},budget,2);
        if(JSON.stringify(decoded.value)!==lines[i]||budget.bytes!==budget.max)throw Error('Canonical restore mismatch');
       }
       running=false;return {variant,run,elapsedMs:performance.now()-began,yieldMs,yields,heartbeatMessages:ticks,maxHeartbeatGapMs:Math.max(maxGap,performance.now()-lastTick),exact:true};
      }
      const warmups=[await sample('timer',0),await sample('background',0)],samples=[];
      for(let run=1;run<=5;run++)for(const variant of run%2?['timer','background']:['background','timer']){const value=await sample(variant,run);samples.push(value);postMessage({type:'sample',value});}
      control=new AbortController();postMessage({type:'cancel-ready'});let cancelled=false;
      try{for(let i=0;i<20;i++)await WallYieldProbe.decodeWallPointTransport(JSON.parse(wire.reduce((a,b)=>a.length>b.length?a:b)),()=>WallYieldProbe.yieldHistoryTask(control.signal),undefined,2);}catch(e){if(e.name!=='AbortError')throw e;cancelled=true;}
      if(!cancelled)throw Error('Cancellation did not interrupt scheduled decode');
      postMessage({type:'done',value:{nativePostTask:true,canonicalSha256:data.expected,canonicalBytes:raw.byteLength,parts:lines.length,warmups,samples,cancelled}});
     }catch(e){postMessage({type:'error',message:String(e),stack:e.stack});}
    };
   };
   const url=URL.createObjectURL(new Blob([bundle,'\n('+workerMain.toString()+')()'],{type:'text/javascript'})),worker=new Worker(url),writes=[];let ticker,deadline;
   try{return await new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Offline worker observation deadline')),120000);worker.onerror=e=>reject(Error(e.message));worker.onmessage=({data})=>{if(data.type==='sample')writes.push(window.persistSample(data.value));else if(data.type==='cancel-ready')worker.postMessage({type:'cancel'});else if(data.type==='error')reject(Error(data.message+'\n'+data.stack));else if(data.type==='done')Promise.all(writes).then(()=>resolve(data.value),reject);};ticker=setInterval(()=>worker.postMessage({type:'tick'}),8);worker.postMessage({type:'start',expected});});}finally{clearInterval(ticker);clearTimeout(deadline);worker.terminate();URL.revokeObjectURL(url);}
  },{bundle,expected});
  results.push({market,...measured});await writeFile(join(output,'results.json'),JSON.stringify({scope:'Five alternating samples per scheduling variant/market in actual Pi Chromium worker, after explicitly separate warmups. Same exact production decoder/product tuples/canonical parts; only checkpoint continuation differs. Decode elapsed includes JSON parse/stringify/equality/budget checks. Message counts/gaps use worker-local delivery clocks. Synthetic message heartbeats and cancellation are not actual live confirmation, chart, route or loading acceptance. No cross-host timestamps or loading p95.',results},null,2)+'\n');await context.close();
 }
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}

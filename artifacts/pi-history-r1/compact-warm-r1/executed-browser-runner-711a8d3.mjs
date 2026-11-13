/** Headless native Chromium worker correctness only. Opens no i3 window. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from './test-browser-launch.mjs';
if(process.env.IQ_COMPACT_BROWSER_VERIFY!=='1')throw Error('Explicit offline headless verification required');
const [input,bundlePath,output]=process.argv.slice(2);assert.ok(output);
execFileSync('git',['diff','--quiet','--','src','scripts/verify-compact-wall-browser.mjs','scripts/compact-wall-browser-entry.ts']);
const clientCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')),parts=[];
for(const part of manifest.parts){const raw=gunzipSync(await readFile(join(input,part.hash+'.json.gz')),{maxOutputLength:4*1024*1024});assert.equal(createHash('sha256').update(raw).digest('hex'),part.hash);parts.push(JSON.parse(raw));}
const segments=[...manifest.active.segments];for(const group of manifest.closed){const fragments=group.map(([part,row])=>parts[part][row]);segments.push({...fragments[0].segment,valueRuns:fragments.flatMap(row=>row.segment.valueRuns)});}
segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price);
const hash=createHash('sha256');for(const segment of segments)hash.update(JSON.stringify(segment));const expected=hash.digest('hex');
assert.equal(expected,manifest.profile.market==='spot'?'cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e':'de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6');
const bundle=await readFile(bundlePath,'utf8'),browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader']});
try{
 const page=await browser.newPage();await page.route('http://127.0.0.1/iq-compact-codec-fixture',route=>route.fulfill({contentType:'text/html',body:'<title>Explicit offline compact cache verification</title>'}));await page.goto('http://127.0.0.1/iq-compact-codec-fixture');
 const result=await page.evaluate(async({bundle,segments})=>{
  const workerSource=bundle+`;self.onmessage=async({data})=>{try{const input=data.segments,start=performance.now(),signal=new AbortController().signal;const packed=await CompactWallCodec.compactWallPresentation('browser-pinned',input,signal),restored=[];await CompactWallCodec.replayCompactWallPresentation(packed,'browser-pinned',signal,rows=>restored.push(...rows));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(restored.map(row=>JSON.stringify(row)).join(''))))].map(n=>n.toString(16).padStart(2,'0')).join('');let callbacks=0,cancelled=false;const abort=new AbortController();try{await CompactWallCodec.replayCompactWallPresentation(packed,'browser-pinned',abort.signal,()=>{callbacks++;abort.abort();});}catch(error){cancelled=error.name==='AbortError';}self.postMessage({segments:restored.length,runs:restored.reduce((n,s)=>n+s.valueRuns.length,0),bytes:packed.retainedBytes,chunks:packed.chunks.length,digest,cancelled,callbacks,workerElapsedMs:performance.now()-start,compressionStream:typeof CompressionStream,decompressionStream:typeof DecompressionStream});}catch(error){self.postMessage({error:String(error.stack??error)});}};`;
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(url),start=performance.now();
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Headless worker verification timed out')),45000);worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message));};worker.onmessage=event=>{clearTimeout(timer);resolve({...event.data,windowRoundTripMs:performance.now()-start});};worker.postMessage({segments});});}finally{worker.terminate();URL.revokeObjectURL(url);}
 },{bundle,segments});
 assert.equal(result.error,undefined);assert.equal(result.digest,expected);assert.equal(result.segments,segments.length);assert.equal(result.runs,segments.reduce((n,s)=>n+s.valueRuns.length,0));assert.equal(result.cancelled,true);assert.equal(result.callbacks,1);
 await writeFile(output,JSON.stringify({scope:'Headless system Chromium native worker codec/cancellation correctness using exact captured financial data; no chart, paint, live source or foreground Pi acceptance. Window/worker monotonic durations are separate overlapping observations, not exclusive phases.',clientCommit,market:manifest.profile.market,sourceToken:manifest.sourceToken,core:manifest.core,bundleSha256:createHash('sha256').update(bundle).digest('hex'),browser:browser.version(),rendering:'Headless SwiftShader; codec uses native CompressionStream in a dedicated Worker; no i3 window',...result},null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}

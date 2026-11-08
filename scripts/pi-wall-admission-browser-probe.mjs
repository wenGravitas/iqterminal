/** Explicit offline browser protocol check, not real-chart/source/performance acceptance. */
import {chromium} from './test-browser-launch.mjs';import {build} from 'vite';
import {mkdtemp,writeFile,readFile,mkdir,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {routeTestBrowser} from './test-browser-workspace.mjs';
if(process.env.IQ_WALL_ADMISSION_FIXTURE_PROBE!=='1')throw Error('Explicit offline fixture opt-in required');
const output=resolve(process.env.IQ_ADMISSION_OUTPUT??'artifacts/pi-history-r1/wall-client-admission-browser.json'),temp=await mkdtemp(join(tmpdir(),'iq-wall-admission-browser-'));
await mkdir(dirname(output),{recursive:true});
const entry=join(temp,'entry.js');await writeFile(entry,`export {discoverPreparedWallAdmission} from ${JSON.stringify(resolve('src/feed/prepared-wall-admission.ts'))};export {historyScheduler} from ${JSON.stringify(resolve('src/feed/history-scheduler.ts'))};`);
await build({configFile:false,logLevel:'warn',build:{outDir:temp,emptyOutDir:false,lib:{entry,name:'WallAdmissionProbe',formats:['iife'],fileName:()=> 'probe.js'}}});
const bundle=await readFile(join(temp,'probe.js'),'utf8'),bundlePath=output.replace(/\.json$/,'.bundle.js');await copyFile(join(temp,'probe.js'),bundlePath);
const records=[],consumers=new Map(),request={market:'spot',profile:'explicit-offline-profile',from:1000,to:2000};
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
try{
 const page=await browser.newPage();const routed=await routeTestBrowser();assert.equal(routed,true);
 await page.route('http://127.0.0.1:4181/wall-admission-fixture',route=>route.fulfill({contentType:'text/html',body:'<title>Explicit offline wall admission check</title><pre id="status">Checking consumer cancellation</pre>'}));
 await page.route('**/admission/discover',async route=>{
  const headers=route.request().headers(),consumer=headers['x-iq-wall-consumer'];assert.ok(consumer);const count=(consumers.get(consumer)??0)+1;consumers.set(consumer,count);
  if(count>1)assert.equal(headers['x-iq-wall-job'],'a'.repeat(64));records.push({method:'GET',consumer,count,job:headers['x-iq-wall-job'],retry:headers['x-iq-wall-retry']});
  await route.fulfill({contentType:'application/json',body:JSON.stringify({state:count>=3?'ready':'building',preparation:{version:1,leaseMs:15000,pollMs:250,
   job:{id:'a'.repeat(64),request,phase:count>=3?'ready':count===2?'projection':'canonical',state:count>=3?'ready':'building',pages:3,projectionPages:count>=3?3:0}}})});
 });
 await page.route('**/market-data/v2/history/walls/preparation?*',route=>{assert.equal(route.request().method(),'DELETE');records.push({method:'DELETE',consumer:new URL(route.request().url()).searchParams.get('consumer')});return route.fulfill({contentType:'application/json',body:'{"released":true}'});});
 await page.goto('http://127.0.0.1:4181/wall-admission-fixture');await page.addScriptTag({content:bundle});
 const result=await page.evaluate(async request=>{
  const api=globalThis.WallAdmissionProbe,a=new AbortController(),b=new AbortController(),progress=[],slotSamples=[];
  const options={request,url:'/admission/discover',projection:false,fetcher:fetch.bind(globalThis),decode:r=>r.json(),retry:{token:'explicit-browser-retry-1'}};
  const first=api.discoverPreparedWallAdmission({...options,signal:a.signal,onPreparation:p=>{progress.push({view:'canceled',phase:p.phase});a.abort();}}).then(()=>({aborted:false}),error=>({aborted:error.name==='AbortError'}));
  const second=api.discoverPreparedWallAdmission({...options,signal:b.signal,onPreparation:p=>{progress.push({view:'survivor',phase:p.phase});document.querySelector('#status').textContent='Surviving view: '+p.phase;setTimeout(()=>slotSamples.push(api.historyScheduler.diagnostics().active),10);}});
  const [canceled,ready]=await Promise.all([first,second]);await new Promise(resolve=>setTimeout(resolve,50));document.querySelector('#status').textContent='Offline check passed: canceled interest released; peer ready';
  return {canceled,ready:ready.state,progress,slotSamples,active:api.historyScheduler.diagnostics().active,peerAborted:b.signal.aborted};
 },request);
 await page.waitForTimeout(100);assert.equal(result.canceled.aborted,true);assert.equal(result.ready,'ready');assert.equal(result.peerAborted,false);assert.equal(result.active,0);assert.ok(result.slotSamples.length>=2&&result.slotSamples.every(n=>n===0));
 assert.equal(consumers.size,2);assert.deepEqual([...consumers.values()].sort(),[1,3]);assert.equal(new Set(records.filter(r=>r.method==='DELETE').map(r=>r.consumer)).size,2);assert.ok(records.filter(r=>r.method==='GET').every(r=>r.retry==='explicit-browser-retry-1'));
 const evidence={scope:'explicit offline native Chromium admission/cancellation check; not real-chart/source/Pi latency acceptance',implementationBuild:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),rendering:'headed-normal-Chromium-gles',workspace:9,
  scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),bundleSha256:createHash('sha256').update(bundle).digest('hex'),records,result};
 await writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();}

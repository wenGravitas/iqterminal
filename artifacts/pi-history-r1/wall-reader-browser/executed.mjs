/** Explicit offline browser protocol check; no chart/source/performance gate. */
import {chromium} from '@playwright/test';import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {routeTestBrowser} from './test-browser-workspace.mjs';
const output='artifacts/pi-history-r1/wall-reader-browser';mkdirSync(output,{recursive:true});
const entry=join(mkdtempSync(join(tmpdir(),'iq-wall-reader-browser-')),'entry.ts'),bundle=resolve(output,'client.mjs');
writeFileSync(entry,`export {acquirePreparedWallReadLease,wallReadControlScheduler} from ${JSON.stringify(resolve('src/feed/prepared-wall-read-lease.ts'))};\nexport {historyScheduler} from ${JSON.stringify(resolve('src/feed/history-scheduler.ts'))};\n`);
execFileSync(process.env.IQ_ESBUILD??resolve('../iqterminal-server-perf-history/node_modules/.bin/esbuild'),[entry,'--bundle','--platform=browser','--format=esm','--outfile='+bundle]);
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox']});
const requests=[],counts=new Map();let firstConsumer;
try{
 const context=await browser.newContext();await context.route('**/wall-reader-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>IQTerminal reader lease protocol check</title>'}));
 await context.route('**/wall-reader-client.mjs',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(bundle)}));
 await context.route('**/market-data/v2/history/walls/reader',r=>{
  const body=r.request().postDataJSON();firstConsumer??=body.consumer;const n=(counts.get(body.consumer)??0)+1;counts.set(body.consumer,n);const status=body.consumer===firstConsumer&&n>1?503:200;
  requests.push({kind:'retain',consumer:body.consumer,canonicalKey:body.canonicalKey,projectionKey:body.projectionKey,status});return r.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{version:1,leaseMs:15000,canonicalKey:body.canonicalKey,projectionKey:body.projectionKey}:{error:'Explicit fixture fails one renewal'})});
 });
 await context.route('**/market-data/v2/history/walls/preparation?*',r=>{requests.push({kind:'release',consumer:new URL(r.request().url()).searchParams.get('consumer')});return r.fulfill({contentType:'application/json',body:'{}'});});
 const page=await context.newPage(),workspaceVerified=await routeTestBrowser();await page.goto('http://127.0.0.1:4181/wall-reader-probe');
 const result=await page.evaluate(async()=>{
  const m=await import('/wall-reader-client.mjs'),busy=new AbortController(),history=[0,1].map(i=>m.historyScheduler.read('busy-'+i,'order-walls',busy.signal,signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))).catch(()=>{}));
  const keys={canonicalKey:'a'.repeat(64),projectionKey:'b'.repeat(64)},a=await m.acquirePreparedWallReadLease(keys,fetch.bind(window),new AbortController().signal),b=await m.acquirePreparedWallReadLease(keys,fetch.bind(window),new AbortController().signal);
  await new Promise(r=>setTimeout(r,6600));let error;try{a.assertActive();}catch(e){error=String(e);}
  b.assertActive();const during={firstAborted:a.signal.aborted,peerAborted:b.signal.aborted,error,history:m.historyScheduler.diagnostics(),control:m.wallReadControlScheduler.diagnostics()};
  a.release();b.release();busy.abort();await Promise.all(history);await new Promise(r=>setTimeout(r,300));return {during,after:{history:m.historyScheduler.diagnostics(),control:m.wallReadControlScheduler.diagnostics()}};
 });
 if(!workspaceVerified||!result.during.firstAborted||result.during.peerAborted||!result.during.error?.includes('lease lost')||result.during.history.active!==2||result.after.history.active||result.after.control.active||requests.filter(r=>r.kind==='release').length!==2)throw Error('Reader browser protocol verification failed: '+JSON.stringify({workspaceVerified,result,requests}));
 writeFileSync(output+'/result.json',JSON.stringify({scope:'Explicit offline headed Chromium reader-lease protocol check; no financial source, chart paint or latency acceptance',clientBuild:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),workspaceVerified,bundleSha256:createHash('sha256').update(readFileSync(bundle)).digest('hex'),result,requests},null,2));console.log(JSON.stringify({workspaceVerified,...result}));
}finally{await browser.close();}

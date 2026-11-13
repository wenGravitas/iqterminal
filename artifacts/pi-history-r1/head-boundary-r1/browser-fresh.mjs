import{chromium}from'../../../scripts/test-browser-launch.mjs';
import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{resolve}from'node:path';
const root=resolve('artifacts/pi-history-r1/head-boundary-r1'),bundle=readFileSync(root+'/browser-client-fresh.mjs');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.route('**/__head-boundary-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit offline wall protocol check</title>'}));
 await page.route('**/__head-boundary-client.mjs',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('http://127.0.0.1:4191/__head-boundary-probe');
 const result=await page.evaluate(async()=>await(await import('/__head-boundary-client.mjs')).run());
 writeFileSync(root+'/browser-result-fresh.json',JSON.stringify({frontendCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),candidateDiffSha256:createHash('sha256').update(execFileSync('git',['diff','--','src/feed/prepared-wall-history.ts'])).digest('hex'),bundleSha256:createHash('sha256').update(bundle).digest('hex'),browser:browser.version(),headless:true,buildEnvironment:{VITE_DATA_MODE:"staging",VITE_HISTORY_TILES:"1",DEV:false,PROD:true},...result},null,2)+'\n');console.log(JSON.stringify({result:result.result,headless:true,browser:browser.version()}));
}finally{await browser.close();}

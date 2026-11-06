/** Explicit offline protocol probe. It does not connect to retained/live source. */
import {chromium} from '@playwright/test';
import {routeTestBrowser} from './test-browser-workspace.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.env.IQ_RETRY_FIXTURE_PROBE!=='1')throw Error('Set IQ_RETRY_FIXTURE_PROBE=1 for this explicit offline fixture');
const bundle=readFileSync(process.env.IQ_RETRY_BUNDLE,'utf8'),output=process.env.IQ_RETRY_OUTPUT??'/tmp/iq-wall-batch-retry-browser.json';
const text='[{"exact":"123.0000000000001"}]',hash=createHash('sha256').update(text).digest('hex');
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
try{
 const page=await browser.newPage();await routeTestBrowser();let calls=0;
 await page.route('http://127.0.0.1:4181/retry-fixture',r=>r.fulfill({contentType:'text/html',body:'<title>Explicit wall batch retry fixture</title>'}));
 await page.route('**/retry-batch',r=>{calls++;return calls===1?r.fulfill({status:408,body:''}):r.fulfill({status:200,headers:{'content-type':'application/x-ndjson','x-iq-wall-start':'0','x-iq-wall-next':'1','x-iq-wall-parts':'1','x-iq-chunk-key':'fixture','x-iq-source-revision':'revision'},body:text+'\n'});});
 await page.goto('http://127.0.0.1:4181/retry-fixture');await page.addScriptTag({content:bundle});
 const result=await page.evaluate(async({text,hash})=>{
  const a=window.WallBatchRetry.acquireWallBatch({url:'/retry-batch',key:'fixture',revision:'revision',parts:[{index:0,bytes:new TextEncoder().encode(text).length,hash}],fetcher:fetch,signal:new AbortController().signal});
  try{const value=await a.read(0);return {attempts:value.attempts,body:value.body};}finally{a.release();}
 },{text,hash});
 if(calls!==2||result.attempts!==2||JSON.stringify(result.body)!==text)throw Error('Retry browser protocol mismatch');
 const evidence={scope:'explicit offline fixture; not source/latency acceptance',browser:browser.version(),workspace:9,calls,...result,bundleSha256:createHash('sha256').update(bundle).digest('hex')};
 mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser.close();}

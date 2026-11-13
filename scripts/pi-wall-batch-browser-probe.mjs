/** Actual Chromium HTTP/gzip framing probe. No chart/latency acceptance claim. */
import {chromium} from './test-browser-launch.mjs';
import {routeTestBrowser} from './test-browser-workspace.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
const [manifestFile,output]=process.argv.slice(2);if(!manifestFile||!output)throw Error('manifest evidence and output JSONL required');
const input=JSON.parse(readFileSync(manifestFile,'utf8')),manifest=input.manifest??input,base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4181';
mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});writeFileSync(output,'');
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
try{
 const page=await browser.newPage();await routeTestBrowser();
 // An explicit empty transport-probe page prevents chart CPU from contaminating
 // this framing check. Real chart acceptance uses pi-history-bench separately.
 await page.route(base+'/transport-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>IQTerminal transport probe</title>'}));await page.goto(base+'/transport-probe');
 const initial=await page.evaluate(async({base,manifest})=>{
  const part=manifest.parts[0],response=await fetch(base+'/market-data/v2/history/walls/part?'+new URLSearchParams({market:manifest.request.market,key:manifest.key,hash:part.hash}));
  const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!response.ok||hash!==part.hash||bytes.byteLength!==part.bytes)throw Error('Initial canonical part mismatch');return {kind:'real-chromium-initial-part',index:0,hash,bytes:bytes.byteLength};
 },{base,manifest});appendFileSync(output,JSON.stringify(initial)+'\n');
 let start=1;
 while(start<manifest.parts.length){
  const result=await page.evaluate(async({base,manifest,start})=>{
   const url=base+'/market-data/v2/history/walls/batch?'+new URLSearchParams({market:manifest.request.market,key:manifest.key,start:String(start),version:'2'}),at=performance.now();
   const response=await fetch(url),bytes=new Uint8Array(await response.arrayBuffer());if(!response.ok)throw Error('Batch HTTP '+response.status);
   const next=Number(response.headers.get('x-iq-wall-next'));if(next<=start||next>manifest.parts.length||bytes.byteLength>8*1024*1024)throw Error('Batch bounds');
   let offset=0;const parts=[];
   for(const part of manifest.parts.slice(start,next)){
    const raw=bytes.subarray(offset,offset+part.bytes),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==part.hash||bytes[offset+part.bytes]!==10)throw Error('Exact browser-decoded part hash mismatch '+JSON.stringify({index:part.index,bytes:bytes.byteLength,partBytes:part.bytes,actualHash:hash,expectedHash:part.hash,separator:bytes[offset+part.bytes]??null}));
    const page=JSON.parse(new TextDecoder().decode(raw));if(page.page.after!==part.after||page.page.nextAfter!==part.nextAfter)throw Error('Canonical continuation mismatch');
    offset+=part.bytes+1;parts.push({index:part.index,hash,after:part.after,nextAfter:part.nextAfter});
   }
   if(offset!==bytes.byteLength)throw Error('Unexpected trailing bytes');
   return {kind:'real-chromium-single-stream-gzip-batch',start,next,parts,bytes:bytes.byteLength,elapsedMs:performance.now()-at,requestId:response.headers.get('x-iq-request-id'),serverTiming:response.headers.get('server-timing'),cache:response.headers.get('x-iq-batch-cache')};
  },{base,manifest,start});
  appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({start:result.start,next:result.next,bytes:result.bytes,exact:true}));start=result.next;
 }
 appendFileSync(output,JSON.stringify({kind:'browser-transport-complete',parts:start,key:manifest.key,market:manifest.request.market,request:manifest.request,coverageScope:'All immutable canonical member bytes verified; this is not a chart paint or current-source validation gate.'})+'\n');
}finally{await browser.close();}

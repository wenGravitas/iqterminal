/** Native Pi browser transport probe, exact pinned batches through Vite/SSH.
 * This does not paint a chart and cannot pass a history-loading gate. */
import {preview} from 'vite';import {chromium} from '@playwright/test';
import {routeTestBrowser} from './test-browser-workspace.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const [referencePath,output]=process.argv.slice(2);if(!referencePath||!output)throw Error('Pinned encoding reference and new output directory required');
const reference=JSON.parse(await readFile(referencePath,'utf8')),batches=reference.results.filter(s=>s.variant==='gzip6'&&s.run===1).map(s=>({start:s.start,key:s.key,sha256:s.decodedSha256,bytes:s.decodedBytes}));
if(!batches.length)throw Error('No pinned batches');await mkdir(output,{recursive:false});
const proxy=Object.fromEntries(['gzip','br'].map(encoding=>['/'+encoding+'/market-data',{target:'http://127.0.0.1:18794',headers:{'accept-encoding':encoding},rewrite:path=>path.replace(new RegExp('^/'+encoding+'/market-data'),'')}]));
const server=await preview({mode:'staging',preview:{host:'127.0.0.1',port:4182,strictPort:true,proxy}}),samples=[];let browser;
const resources=()=>({load:execFileSync('cat',['/proc/loadavg'],{encoding:'utf8'}).trim(),mem:execFileSync('cat',['/proc/meminfo'],{encoding:'utf8'}),processes:execFileSync('ps',['-eo','pid,ppid,pcpu,rss,comm','--sort=-pcpu'],{encoding:'utf8'}).split('\n').slice(0,12)});
try{
 browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
 // Alternate codecs to avoid assigning all later route conditions to one codec.
 for(let run=1;run<=5;run++)for(const encoding of (run%2?['gzip','br']:['br','gzip'])){
  const before=resources(),context=await browser.newContext();
  await context.route('**/encoding-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>IQTerminal exact wall encoding transport probe</title>'}));
  const page=await context.newPage();await routeTestBrowser();await page.goto('http://127.0.0.1:4182/encoding-probe');
  const result=await page.evaluate(async({encoding,batches})=>{
   const at=performance.now();const results=await Promise.all(batches.map(async b=>{
    const path='/'+encoding+'/market-data/v2/history/walls/projection-batch?'+new URLSearchParams({market:'spot',key:b.key,start:String(b.start),version:'1'}),start=performance.now(),response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000)}),headersMs=performance.now()-start,body=await response.arrayBuffer(),receivedMs=performance.now()-start,hashAt=performance.now(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(v=>v.toString(16).padStart(2,'0')).join(''),hashMs=performance.now()-hashAt;
    if(!response.ok||response.headers.get('Content-Encoding')!==encoding||sha256!==b.sha256||body.byteLength!==b.bytes)throw Error('Exact prepared transport validation failed');
    return {start:b.start,status:response.status,encoding:response.headers.get('Content-Encoding'),wireBytes:Number(response.headers.get('Content-Length')),decodedBytes:body.byteLength,sha256,headersMs,receivedMs,hashMs,serverEncodingMs:Number(response.headers.get('X-IQ-Encoding-Ms')),cache:response.headers.get('X-IQ-Batch-Cache'),build:response.headers.get('X-IQ-Encoding-Build')};
   }));return {elapsedMs:performance.now()-at,results};
  },{encoding,batches});
  samples.push({run,encoding,before,...result,after:resources()});await writeFile(output+'/samples.json',JSON.stringify(samples,null,2));await context.close();
 }
 await writeFile(output+'/environment.json',JSON.stringify({scope:'Native Pi Chromium exact selected-batch transport through separate SSH port 18794 and Vite preview 4182; empty browser contexts, server prepared; no chart paint/load gate',browser:browser.version(),node:process.version,arch:process.arch,clientSource:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workspace:9,referenceSha256:createHash('sha256').update(await readFile(referencePath)).digest('hex')},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}

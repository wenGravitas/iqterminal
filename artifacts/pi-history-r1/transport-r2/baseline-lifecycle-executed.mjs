/** Real prepared history, one persistent page/worker, bounded close/reopen
 * cycles. GC occurs only after paint/validation/cache settling, outside timing.
 * This measures open/close retention; pan/switch/concurrent-live gates remain separate. */
import {chromium} from './test-browser-launch.mjs';
import {browserWorkerHeaps} from './browser-worker-heaps.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=process.env.IQ_LIFECYCLE_URL,build=process.env.IQ_LIFECYCLE_BUILD,label=process.env.IQ_LIFECYCLE_LABEL;
if(!base||!label||!/^[a-f0-9]{40}$/.test(build??''))throw Error('Explicit URL, label and exact build required');
execFileSync('git',['cat-file','-e',build+'^{commit}']);
const reference=JSON.parse(readFileSync(process.env.IQ_LIFECYCLE_REFERENCES,'utf8')).cases['walls-30h-perp-15m'];
if(!reference||reference.to-reference.from!==30*3600000||reference.sourceFrom!==reference.from-900000||reference.sourceTo!==reference.to+900000)throw Error('Exact full30h USD-M reference required');
const cycles=Number(process.env.IQ_LIFECYCLE_CYCLES??8);if(!Number.isInteger(cycles)||cycles<5||cycles>20)throw Error('Cycles must be5..20');
const dir='artifacts/pi-history-r1/transport-r2';mkdirSync(dir,{recursive:true});const path=`${dir}/${label}.jsonl`;writeFileSync(path,'');
const source=readFileSync(new URL(import.meta.url));writeFileSync(`${dir}/${label}-executed.mjs`,source);
const scriptSha256=createHash('sha256').update(source).digest('hex');
const params={venue:'binance',market:'perpetual',interval:'15m',type:'candle',rowPrice:25,historyViewport:{from:reference.from,to:reference.to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}]};
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['chart-bench'],activeView:'chart-bench',id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{'chart-bench':{id:'chart-bench',contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
try{
 const root=await browser.newBrowserCDPSession();const environment={version:await root.send('Browser.getVersion'),system:await root.send('SystemInfo.getInfo')};await root.detach();
 writeFileSync(`${dir}/${label}-environment.json`,JSON.stringify(environment,null,2)+'\n');
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:new URL(base).origin,localStorage:[{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})},{name:'basis.theme.v1',value:'dark'}]}]}});
 const page=await context.newPage(),main=await context.newCDPSession(page);await main.send('HeapProfiler.enable');
 await page.addInitScript(reference=>{
  window.__life={start:0,first:null,complete:null};
  function frame(){const t=window.__terminal,p=t?.panels.get('chart-bench'),d=p?.engine.orderWallsDiagnostics(),a=p?.orderWallsStatus?.archive,v=p?.engine.visibleTimeRange();
   const visible=document.documentElement.dataset.appState==='ready'&&getComputedStyle(document.getElementById('startup-splash')).visibility==='hidden';
   const matches=v&&Math.abs(v.from-reference.from/1000)<900&&Math.abs(v.to-reference.to/1000)<900;
   if(visible&&matches&&d.visibleHistorical>0){window.__life.first??=performance.now()-window.__life.start;
    if(a?.requestComplete&&a.exact&&a.from===reference.sourceFrom&&a.to===reference.sourceTo&&a.gaps.length===reference.gaps&&d.archiveSegments===reference.segments&&d.segments===reference.segments&&d.archiveValueRuns===reference.valueRuns&&d.inputRevision===d.paintedRevision&&d.pendingProjectionSegments===0&&d.pendingReferenceSegments===0&&!d.valueHistoryLimited&&!d.episodeHistoryLimited)window.__life.complete??=performance.now()-window.__life.start;
   }requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 },reference);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 for(let cycle=0;cycle<=cycles;cycle++){
  if(cycle)await page.evaluate(params=>{window.__life={start:performance.now(),first:null,complete:null};window.__terminal.dock.addPanel({id:'chart-bench',component:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumWidth:220,minimumHeight:140});},params);
  await page.waitForFunction(()=>window.__terminal?.panels.get('chart-bench')?.candles.length>0,null,{timeout:12000});
  await page.evaluate(r=>{const p=window.__terminal.panels.get('chart-bench'),d=p.engine.chart.dataLayer;p.engine.setRange({from:d.timeToIndexFloat(r.from/1000),to:d.timeToIndexFloat(r.to/1000)});},reference);
  let paintFailure=null;try{await page.waitForFunction(()=>window.__life.complete!==null,null,{timeout:12000});}catch(e){paintFailure=String(e);}
  const marks=await page.evaluate(()=>({...window.__life}));
  async function diagnostics(){await page.evaluate(()=>{window.__life.prior=window.__terminal.feed.diagnostics;window.__terminal.feed.send({type:'diagnostics'});});await page.waitForFunction(()=>window.__terminal.feed.diagnostics!==window.__life.prior,null,{timeout:5000});return page.evaluate(()=>window.__terminal.feed.diagnostics);}
  let diagnostic=await diagnostics();const limit=Date.now()+15000;
  while(diagnostic.orderWallsArchive.warmBuilds>0&&Date.now()<limit){await page.waitForTimeout(100);diagnostic=await diagnostics();}
  if(diagnostic.fixture||diagnostic.staging?.config?.build!==build||diagnostic.staging?.config?.dataMode!=='staging'||diagnostic.staging?.config?.historyTiles!==true)throw Error('Wrong actual build/mode');
  const paint=await page.evaluate(()=>window.__terminal.panels.get('chart-bench').engine.orderWallsDiagnostics());
  const heap=await browserWorkerHeaps(browser);await main.send('HeapProfiler.collectGarbage');const mainHeap=await main.send('Runtime.getHeapUsage');
  const record={phase:'open',cycle,build,scriptSha256,reference,marks,paintFailure,latencyScope:'Actual painted content since reopen; no force GC before these marks. Initial navigation and diagnostic waiting are separate.',diagnostic,paint,heap,mainHeap,errors:[...errors]};appendFileSync(path,JSON.stringify(record)+'\n');console.log(JSON.stringify({cycle,firstMs:marks.first,completeMs:marks.complete,projectors:diagnostic.orderWallsArchive.projections.length,workerHeap:heap.workers.map(w=>w.heap.usedSize),paintFailure}));
  if(cycle===cycles)await page.screenshot({path:`${dir}/${label}-final.png`});
  await page.evaluate(()=>window.__terminal.dock.getPanel('chart-bench').api.close());
  diagnostic=await diagnostics();const closedHeap=await browserWorkerHeaps(browser);await main.send('HeapProfiler.collectGarbage');
  appendFileSync(path,JSON.stringify({phase:'closed',cycle,diagnostic,heap:closedHeap,mainHeap:await main.send('Runtime.getHeapUsage')})+'\n');
 }
 await context.close();
}finally{await browser.close();}

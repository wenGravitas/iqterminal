/** Real prepared history, one persistent page/worker, bounded close/reopen
 * cycles. GC occurs only after paint/validation/cache settling, outside timing.
 * This measures open/close retention; pan/switch/concurrent-live gates remain separate. */
import {chromium} from './test-browser-launch.mjs';
import {browserWorkerHeaps} from './browser-worker-heaps.mjs';
import {finishResponseTraces,nativeClosedCoverage} from './benchmark-traces.mjs';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=process.env.IQ_LIFECYCLE_URL,build=process.env.IQ_LIFECYCLE_BUILD,label=process.env.IQ_LIFECYCLE_LABEL;
if(!base||!label||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(label)||!/^[a-f0-9]{40}$/.test(build??''))throw Error('Explicit URL, label and exact build required');
execFileSync('git',['cat-file','-e',build+'^{commit}']);
const reference=JSON.parse(readFileSync(process.env.IQ_LIFECYCLE_REFERENCES,'utf8')).cases['walls-30h-perp-15m'];
if(!reference||reference.to-reference.from!==30*3600000||reference.sourceFrom!==reference.from-900000||reference.sourceTo!==reference.to+900000)throw Error('Exact full30h USD-M reference required');
const cycles=Number(process.env.IQ_LIFECYCLE_CYCLES??8);if(!Number.isInteger(cycles)||cycles<5||cycles>20)throw Error('Cycles must be5..20');
const snapshotCycle=Number(process.env.IQ_LIFECYCLE_SNAPSHOT_CYCLE??-1);
const collectGarbage=process.env.IQ_LIFECYCLE_GC!=='0';
const resource=()=>({loadavg:readFileSync('/proc/loadavg','utf8'),meminfo:readFileSync('/proc/meminfo','utf8'),cpu:readFileSync('/proc/stat','utf8').split('\n').slice(0,5),vmstat:readFileSync('/proc/vmstat','utf8').split('\n').filter(s=>/^(pswpin|pswpout|pgmajfault) /.test(s)),temperature:readFileSync('/sys/class/thermal/thermal_zone0/temp','utf8')});
const dir='artifacts/pi-history-r1/transport-r2';mkdirSync(dir,{recursive:true});const path=`${dir}/${label}.jsonl`;writeFileSync(path,'',{flag:'wx'});
const source=readFileSync(new URL(import.meta.url));writeFileSync(`${dir}/${label}-executed.mjs`,source);
const scriptSha256=createHash('sha256').update(source).digest('hex');
const heapHelper=readFileSync(new URL('./browser-worker-heaps.mjs',import.meta.url)),heapHelperSha256=createHash('sha256').update(heapHelper).digest('hex');writeFileSync(`${dir}/${label}-worker-heaps-executed.mjs`,heapHelper);
const params={venue:'binance',market:'perpetual',interval:'15m',type:'candle',rowPrice:25,historyViewport:{from:reference.from,to:reference.to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}]};
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['chart-bench'],activeView:'chart-bench',id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{'chart-bench':{id:'chart-bench',contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
try{
 const root=await browser.newBrowserCDPSession();const environment={version:await root.send('Browser.getVersion'),system:await root.send('SystemInfo.getInfo')};await root.detach();
 writeFileSync(`${dir}/${label}-environment.json`,JSON.stringify(environment,null,2)+'\n');
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:new URL(base).origin,localStorage:[{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})},{name:'basis.theme.v1',value:'dark'}]}]}});
 const page=await context.newPage(),main=await context.newCDPSession(page);await main.send('HeapProfiler.enable');
 let activeCycle=0;const requests=[],responseTasks=[],requestRecords=new WeakMap();
 page.on('request',request=>{if(!request.url().includes('/market-data/')||request.url().includes('/stream'))return;const record={cycle:activeCycle,url:request.url()};requests.push(record);requestRecords.set(request,record);});
 page.on('response',response=>{const record=requestRecords.get(response.request());if(!record)return;record.status=response.status();responseTasks.push((async()=>{try{record.headers=await response.allHeaders();record.finishedError=await response.finished();record.sizes=await response.request().sizes();record.timing=response.request().timing();}catch(e){record.traceError=String(e);}})());});
 await page.addInitScript(reference=>{
  window.__life={start:0,first:null,complete:null,handoffs:[]};
  // Browser-local monotonic observations only: do not subtract worker clocks.
  // Wrap the public subscription boundary before subsequent reopen cycles.
  // Retain metadata for at most12 batches, never financial payload references.
  function traceSubscriptions(){
   const feed=window.__terminal?.feed;if(!feed||feed.__lifecycleTrace)return;
   feed.__lifecycleTrace=true;const subscribe=feed.subscribeOrderWalls;
   feed.subscribeOrderWalls=function(id,request,callback){return subscribe.call(this,id,request,event=>{
    const life=window.__life,rows=event.segments??event.patches?.map(p=>p.segment).filter(Boolean)??[];
    const trace=life.handoffs.length<12?{at:performance.now()-life.start,kind:event.kind,rows:rows.length,archiveState:event.status.archive?.state,complete:event.status.archive?.requestComplete,from:request.from,to:request.to,first:rows[0]?{start:rows[0].start,end:rows[0].end,price:rows[0].price}:null}:null;
    const begin=performance.now();try{return callback(event);}finally{if(trace){trace.applyMs=performance.now()-begin;const p=window.__terminal.panels.get('chart-bench');trace.visibleRange=p?.engine.visibleTimeRange();trace.geometry=p?.engine.orderWallsDiagnostics();life.handoffs.push(trace);}}
   });};
  }
  function frame(){const t=window.__terminal,p=t?.panels.get('chart-bench'),d=p?.engine.orderWallsDiagnostics(),a=p?.orderWallsStatus?.archive,v=p?.engine.visibleTimeRange();
   traceSubscriptions();const visible=document.documentElement.dataset.appState==='ready'&&getComputedStyle(document.getElementById('startup-splash')).visibility==='hidden';
   const matches=v&&Math.abs(v.from-reference.from/1000)<900&&Math.abs(v.to-reference.to/1000)<900;
   if(visible&&matches&&d.visibleHistorical>0){window.__life.first??=performance.now()-window.__life.start;
    if(a?.requestComplete&&a.exact&&a.from===reference.sourceFrom&&a.to===reference.sourceTo&&a.gaps.length===reference.gaps&&d.archiveSegments===reference.segments&&d.segments===reference.segments&&d.archiveValueRuns===reference.valueRuns&&d.inputRevision===d.paintedRevision&&d.pendingProjectionSegments===0&&d.pendingReferenceSegments===0&&!d.valueHistoryLimited&&!d.episodeHistoryLimited)window.__life.complete??=performance.now()-window.__life.start;
   }requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 },reference);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 for(let cycle=0;cycle<=cycles;cycle++){
  activeCycle=cycle;
  if(cycle)await page.evaluate(params=>{window.__life={start:performance.now(),first:null,complete:null,handoffs:[]};window.__terminal.dock.addPanel({id:'chart-bench',component:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumWidth:220,minimumHeight:140});},params);
  await page.waitForFunction(()=>window.__terminal?.panels.get('chart-bench')?.candles.length>0,null,{timeout:12000});
  await page.evaluate(r=>{const p=window.__terminal.panels.get('chart-bench'),d=p.engine.chart.dataLayer;p.engine.setRange({from:d.timeToIndexFloat(r.from/1000),to:d.timeToIndexFloat(r.to/1000)});},reference);
  let paintFailure=null;try{await page.waitForFunction(()=>window.__life.complete!==null,null,{timeout:12000});}catch(e){paintFailure=String(e);}
  const marks=await page.evaluate(()=>({...window.__life}));
  async function diagnostics(){await page.evaluate(()=>{window.__life.prior=window.__terminal.feed.diagnostics;window.__terminal.feed.send({type:'diagnostics'});});await page.waitForFunction(()=>window.__terminal.feed.diagnostics!==window.__life.prior,null,{timeout:5000});return page.evaluate(()=>window.__terminal.feed.diagnostics);}
  let diagnostic=await diagnostics();const limit=Date.now()+15000;
  while((diagnostic.orderWallsArchive.warmBuilds>0||diagnostic.orderWallsArchive.historyActiveJobs>0)&&Date.now()<limit){await page.waitForTimeout(100);diagnostic=await diagnostics();}
  if(diagnostic.fixture||diagnostic.staging?.config?.build!==build||diagnostic.staging?.config?.dataMode!=='staging'||diagnostic.staging?.config?.historyTiles!==true)throw Error('Wrong actual build/mode');
  const paint=await page.evaluate(()=>window.__terminal.panels.get('chart-bench').engine.orderWallsDiagnostics());
  let snapshotBytes=0;
  const heap=await browserWorkerHeaps(browser,{collectGarbage,queryProjectors:process.env.IQ_LIFECYCLE_QUERY_OWNERS==='1',...(cycle===snapshotCycle?{snapshotChunk:(_target,chunk)=>{snapshotBytes+=Buffer.byteLength(chunk);if(snapshotBytes>160*1024*1024)throw Error('Owned-worker snapshot capacity');appendFileSync(`${dir}/${label}-worker.heapsnapshot`,chunk);}}:{})});if(collectGarbage)await main.send('HeapProfiler.collectGarbage');const mainHeap=await main.send('Runtime.getHeapUsage');
  const native=await page.evaluate(r=>({closed:Math.floor(Date.now()/900000)*900000,times:window.__terminal.panels.get('chart-bench').candles.filter(c=>c.closed&&c.t>=r.from&&c.t<r.to).map(c=>c.t)}),reference);
  const traceFinalization=await finishResponseTraces(responseTasks);
  const record={phase:'open',cycle,build,scriptSha256,heapHelperSha256,reference,marks,paintFailure,latencyScope:'Actual painted content since reopen; initial navigation and post-observation diagnostics are separate. Prior-cycle forced GC, if enabled, disqualifies natural warm latency acceptance.',settledReadVerified:diagnostic.orderWallsArchive.historyActiveJobs===0&&diagnostic.orderWallsArchive.warmBuilds===0,nativeCoverage:nativeClosedCoverage(native.times,reference,900000,native.closed),nativeClosedTimes:native.times,nativeClosedBoundary:native.closed,traceFinalization,requests:requests.filter(r=>r.cycle===cycle),resource:resource(),diagnostic,paint,heap,mainHeap,errors:[...errors]};appendFileSync(path,JSON.stringify(record)+'\n');console.log(JSON.stringify({cycle,firstMs:marks.first,completeMs:marks.complete,projectors:diagnostic.orderWallsArchive.projections.length,workerHeap:heap.workers.map(w=>w.heap.usedSize),paintFailure}));
  if(cycle===cycles)await page.screenshot({path:`${dir}/${label}-final.png`});
  await page.evaluate(()=>window.__terminal.dock.getPanel('chart-bench').api.close());
  diagnostic=await diagnostics();const closedHeap=await browserWorkerHeaps(browser,{collectGarbage});if(collectGarbage)await main.send('HeapProfiler.collectGarbage');
  appendFileSync(path,JSON.stringify({phase:'closed',cycle,diagnostic,heap:closedHeap,mainHeap:await main.send('Runtime.getHeapUsage'),resource:resource()})+'\n');
 }
 await context.close();
}finally{await browser.close();}

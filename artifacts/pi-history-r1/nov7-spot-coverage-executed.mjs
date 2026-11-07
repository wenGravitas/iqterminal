import {finishResponseTraces} from './benchmark-traces.mjs';
import {routeTestBrowser} from './test-browser-workspace.mjs';
/** Actual Pi/client-route benchmark. No fixtures; bounded observations are failures,
 * not eventual-completion acceptance. Run against an explicitly started build. */
import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4180',label=process.env.IQ_BENCH_LABEL??'baseline';
const dir='artifacts/pi-history-r1';mkdirSync(dir,{recursive:true});
const windowFile=`${dir}/windows.json`;
const windows=existsSync(windowFile)?JSON.parse(readFileSync(windowFile,'utf8')):{end:Math.floor(Date.now()/3600000)*3600000-3600000};
writeFileSync(windowFile,JSON.stringify(windows,null,2)+'\n');
const cases=[{name:'footprint-4h-5m',kind:'footprint',hours:4,interval:'5m',step:300000,market:'perpetual'},
 {name:'footprint-24h-1h',kind:'footprint',hours:24,interval:'1h',step:3600000,market:'perpetual'},
 {name:'walls-30h-spot-5m',kind:'walls',hours:30,interval:'5m',step:300000,market:'spot'},
 {name:'walls-30h-perp-15m',kind:'walls',hours:30,interval:'15m',step:900000,market:'perpetual'},
 {name:'current-footprint-5m',kind:'footprint',hours:4,interval:'5m',step:300000,market:'perpetual',now:true},
 {name:'current-walls-15m',kind:'walls',hours:1,interval:'15m',step:900000,market:'perpetual',now:true}];
if(process.env.IQ_BENCH_BUILD&&!/^[a-f0-9]{40}$/.test(process.env.IQ_BENCH_BUILD))throw Error('IQ_BENCH_BUILD must be the full 40-character deployed client commit');
const samples=Number(process.env.IQ_BENCH_SAMPLES??5),selected=process.env.IQ_BENCH_CASE;
const observationMs=Number(process.env.IQ_BENCH_OBSERVATION_MS??12000),fitWalls=process.env.IQ_BENCH_FIT_WALLS==='1';
const keepCurrent=process.env.IQ_BENCH_KEEP_CURRENT==='1',cpuProfile=process.env.IQ_BENCH_CPU_PROFILE==='1';
const executedSource=readFileSync(new URL(import.meta.url)),scriptSha256=createHash('sha256').update(executedSource).digest('hex');
writeFileSync(`${dir}/${label}-executed.mjs`,executedSource);
const traceHelperSource=readFileSync(new URL('./benchmark-traces.mjs',import.meta.url)),traceHelperSha256=createHash('sha256').update(traceHelperSource).digest('hex');writeFileSync(`${dir}/${label}-trace-helper-executed.mjs`,traceHelperSource);
const output=`${dir}/${label}-samples.jsonl`,observations=`${dir}/${label}-observations.jsonl`;writeFileSync(output,'');writeFileSync(observations,'');
const resource=()=>({at:new Date().toISOString(),uptime:readFileSync('/proc/uptime','utf8').trim(),load:readFileSync('/proc/loadavg','utf8').trim(),mem:readFileSync('/proc/meminfo','utf8'),cpu:readFileSync('/proc/stat','utf8').split('\n').slice(0,5),vmstat:readFileSync('/proc/vmstat','utf8').split('\n').filter(line=>/^(pswpin|pswpout|pgmajfault|pgfault) /.test(line)),temperatureMilliC:readFileSync('/sys/class/thermal/thermal_zone0/temp','utf8').trim(),cpuFrequencyKHz:readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq','utf8').trim(),monotonicMs:performance.now(),processes:execFileSync('ps',['-eo','pid,ppid,pcpu,rss,comm','--sort=-pcpu'],{encoding:'utf8'}).split('\n').slice(0,16)});
const browser=await chromium.launch({headless:process.env.IQ_BENCH_HEADLESS==='1',executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
try {for(const item of cases.filter(c=>!selected||c.name.includes(selected)))for(let run=1;run<=samples;run++){
 const end=item.now?Math.floor(Date.now()/item.step)*item.step+item.step:windows.end;
 const requested={from:end-item.hours*3600000,to:end},requests=[],errors=[],before=resource();
 const params={venue:'binance',market:item.market,interval:item.interval,type:item.kind==='footprint'?'footprint':'candle',rowPrice:25,historyViewport:requested,studies:[]};
 if(item.kind==='walls')params.indicators=[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}];
 const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['chart-bench'],activeView:'chart-bench',id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{'chart-bench':{id:'chart-bench',contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:new URL(base).origin,localStorage:[{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})},{name:'basis.theme.v1',value:'dark'},{name:'iqterminal:object-tree-sidebar:v1:chart-bench',value:JSON.stringify({version:1,width:280,collapsed:true})}]}]}});
 const page=await context.newPage();await routeTestBrowser();await page.addInitScript(({kind,requested,step})=>{
  const b=window.__bench={frames:[],tasks:[],marks:{firstHistoryAt:null,completeAt:null,firstCurrentAt:null}};let last=performance.now(),sampleAt=0;
  // RAF now is the frame start; it can predate a long chart draw. Record the
  // observation clock only after reading actual painted-content diagnostics.
  function frame(now){b.frames.push(now-last);last=now;if(b.frames.length>2000)b.frames.shift();
   if(now-sampleAt>=80){sampleAt=now;const p=window.__terminal?.panels.get('chart-bench'),e=p?.engine;
    const shell=document.getElementById('app-shell'),splash=document.getElementById('startup-splash');
    const uncovered=document.documentElement.dataset.appState==='ready'&&shell&&splash&&getComputedStyle(shell).visibility==='visible'&&getComputedStyle(splash).visibility==='hidden';
    if(e&&uncovered){const view=e.visibleTimeRange(),matches=view&&Math.abs(view.from-requested.from/1000)<step/1000&&Math.abs(view.to-requested.to/1000)<step/1000;
     if(kind==='footprint'){
      const paint=e.footprintPaintDiagnostics?.(),times=paint?.times?.map(t=>t*1000)??[],closed=Math.floor(Date.now()/step)*step,history=p.footprintStatus?.history;
      if(matches&&times.some(t=>t>=requested.from&&t<Math.min(requested.to,closed)))b.marks.firstHistoryAt??=performance.now();
      if(p.footprintStatus?.state==='live'&&times.includes(closed))b.marks.firstCurrentAt??=performance.now();
      const empty=new Set((history?.ranges??[]).flatMap(r=>(r.progress?.slots??[]).filter(slot=>slot.validated&&slot.state==='empty').map(slot=>slot.from)));
      const expected=[];for(let t=requested.from;t<Math.min(requested.to,closed);t+=step)expected.push(t);
      if(matches&&history?.validated&&!history.capacityLimited&&expected.length&&expected.every(t=>times.includes(t)||empty.has(t)))b.marks.completeAt??=performance.now();
     }else{
      const d=e.orderWallsDiagnostics(),archive=p.orderWallsStatus?.archive;
      if(matches&&d.visibleHistorical>0)b.marks.firstHistoryAt??=performance.now();
      if(d.visibleCurrent>0&&p.orderWallsStatus?.state==='live')b.marks.firstCurrentAt??=performance.now();
      if(matches&&d.visibleHistorical>0&&archive?.requestComplete&&archive.exact&&archive.from<=requested.from&&archive.to>=requested.to&&archive.loadedThrough>=requested.to&&!d.valueHistoryLimited&&!d.episodeHistoryLimited)b.marks.completeAt??=performance.now();
     }
    }
   }requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
  new PerformanceObserver(list=>b.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
 },{kind:item.kind,requested,step:item.step});
 const requestRecords=new WeakMap();
 const relevant=request=>request.url().includes('/market-data/')&&!request.url().includes('/stream');
 context.on('request',request=>{if(!relevant(request))return;const record={url:request.url(),status:null,at:performance.now(),transferState:'request-started',viewId:request.headers()['x-iq-view-id']??null};requestRecords.set(request,record);requests.push(record);});
 context.on('requestfailed',request=>{if(!relevant(request))return;const record=requestRecords.get(request);if(record){record.requestFailure=request.failure()?.errorText;record.transferState='failed';}});
 const responseTasks=[];context.on('response',response=>{if(!response.url().includes('/market-data/')||response.url().includes('/stream'))return;
  const record=requestRecords.get(response.request())??{url:response.url(),at:performance.now()};if(!requestRecords.has(response.request()))requests.push(record);record.status=response.status();record.headersAt=performance.now();record.transferState='headers-pending';
  responseTasks.push((async()=>{try{record.headers=await response.allHeaders();record.requestTiming=response.request().timing();record.transferState='receiving';const finished=await response.finished().catch(error=>error);record.sizes=await response.request().sizes().catch(()=>null);record.requestTiming=response.request().timing();record.finishedError=finished?String(finished):null;record.transferState=finished?'failed':'complete';}catch(error){record.traceError=String(error);record.transferState='trace-error';}})());
 });page.on('pageerror',error=>errors.push(error.message));
 const profiler=cpuProfile?await context.newCDPSession(page):null;if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 const started=performance.now();let firstCurrentMs=null,firstHistoryMs=null,completeMs=null,viewportAt=null,last=null,exception=null;const referenceFrames=[];
 try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
  // A supplemental coverage observation must also observe a delayed native
  // bootstrap. Normal latency runs retain the unchanged 12s failure boundary.
  await page.waitForFunction(()=>window.__terminal?.panels.get('chart-bench')?.engine?.chart.dataLayer.length>0,null,
    {timeout:observationMs>12000?Math.max(1,observationMs-(performance.now()-started)):12000});
  viewportAt=performance.now();if(item.kind==='walls')await page.evaluate(range=>{const p=window.__terminal.panels.get('chart-bench'),d=p.engine.chart.dataLayer;p.engine.setRange({from:d.timeToIndexFloat(range.from/1000),to:d.timeToIndexFloat(range.to/1000)});},requested);
  const deadline=started+observationMs;
  while(performance.now()<deadline){
   last=await page.evaluate(({kind,range,fitWalls})=>{const p=window.__terminal.panels.get('chart-bench'),e=p.engine,diag=p.diagnostics();if(fitWalls&&kind==='walls'&&!window.__bench.fitApplied&&e.fitOrderWalls())window.__bench.fitApplied=performance.now();const bars=p.footprintBars.filter(b=>b.time*1000>=range.from&&b.time*1000<range.to),history=p.footprintStatus?.history,wall=p.orderWallsStatus,render=e.orderWallsDiagnostics();return {viewport:e.visibleTimeRange(),config:p.selection,footprint:{times:bars.map(b=>b.time*1000),cells:bars.reduce((n,b)=>n+b.cells.length,0),status:p.footprintStatus,paint:e.footprintPaintDiagnostics?.(),sets:e.stats.footprintSets,surface:e.footprintSurfaceMounted},wall:{status:wall,render,segments:e.orderWallSegments.size,current:[...e.orderWallSegments.values()].filter(s=>s.currentSelection&&s.end===null).map(s=>({id:s.id,price:s.price,start:s.start}))},renderer:diag.renderer,visibility:document.visibilityState,focused:document.hasFocus(),heap:performance.memory?.usedJSHeapSize,frames:window.__bench.frames,tasks:window.__bench.tasks,now:performance.now(),marks:{...window.__bench.marks}};},{kind:item.kind,range:requested,fitWalls});
   if(keepCurrent&&item.kind==='walls'&&referenceFrames.length<1000){const r=last.wall.render;referenceFrames.push({at:last.now,draws:r.draws,retained:r.retainedSegments,referenceSegments:r.referenceSegments,referenceValueScans:r.referenceValueScans,referenceRebuilds:r.referenceRebuilds,retainedReferenceSegments:r.retainedReferenceSegments,referenceExtentValues:r.referenceExtentValues,referenceMs:r.lastReferenceMs,paintMs:r.lastPaintMs});}
   if(firstCurrentMs===null&&last.marks.firstCurrentAt!==null)firstCurrentMs=last.marks.firstCurrentAt;
   if(item.now&&last.marks.firstCurrentAt!==null&&!keepCurrent)break;
   const viewMatches=last.viewport&&Math.abs(last.viewport.from-requested.from/1000)<item.step/1000&&Math.abs(last.viewport.to-requested.to/1000)<item.step/1000;
   const painted=last.footprint.paint?.times?.map(t=>t*1000);
   const useful=item.kind==='footprint'?viewMatches&&last.footprint.times.length>0&&last.footprint.cells>0&&last.footprint.sets>0&&(!painted||painted.some(t=>t>=requested.from&&t<requested.to)):last.wall.render.visible>0&&last.wall.render.archiveSegments>0;
   if(firstHistoryMs===null&&last.marks.firstHistoryAt!==null)firstHistoryMs=last.marks.firstHistoryAt;
   const all=item.kind==='footprint'?Array.from({length:item.hours*3600000/item.step},(_,i)=>requested.from+i*item.step).every(t=>last.footprint.times.includes(t)&&(!painted||painted.includes(t)))&&last.footprint.status.history?.validated===true&&viewMatches:
    last.wall.status?.archive?.requestComplete===true&&last.wall.status.archive.from<=requested.from&&last.wall.status.archive.to>=requested.to&&['complete','partial'].includes(last.wall.status.archive.state)&&last.wall.status.archive.exact===true&&last.wall.status.archive.loadedThrough>=requested.to;
   if(all&&useful&&last.marks.completeAt!==null){completeMs=last.marks.completeAt;break;}
   await new Promise(r=>setTimeout(r,80));
  }
  await page.screenshot({path:`${dir}/${label}-${item.name}-${run}.png`});
 }catch(error){exception=String(error);await page.screenshot({path:`${dir}/${label}-${item.name}-${run}-failure.png`}).catch(()=>{});}
 if(profiler){const {profile}=await profiler.send('Profiler.stop');writeFileSync(`${dir}/${label}-${item.name}-${run}.cpuprofile`,JSON.stringify(profile));}
 const browserTimings=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').slice(0,256).map(e=>e.toJSON())})).catch(()=>null);
 await page.evaluate(()=>window.__terminal?.feed.send({type:'diagnostics'})).catch(()=>{});await new Promise(r=>setTimeout(r,150));
 const paintMarks=last?.marks??null;
 const diagnostics=await page.evaluate(()=>window.__terminal?.feed.diagnostics).catch(()=>null);
 const actualEnvironment=diagnostics?.staging?.config;
 const environmentVerification={expectedBuild:process.env.IQ_BENCH_BUILD??null,actual:actualEnvironment??null,fixture:diagnostics?.fixture??null,
  valid:diagnostics?.fixture===false&&actualEnvironment?.dataMode==='staging'&&actualEnvironment?.historyTiles===true&&(!process.env.IQ_BENCH_BUILD||actualEnvironment?.build===process.env.IQ_BENCH_BUILD)};
 if(!environmentVerification.valid)exception??='Unverified or incorrect staging/history/build environment; sample cannot certify a gate';
 appendFileSync(observations,JSON.stringify({phase:'observed-before-context-close',label,case:item.name,run,build:process.env.IQ_BENCH_BUILD,requested,deadlineMs:observationMs,environmentVerification,paintMarks,last,diagnostics,requests,exception})+'\n');
 await context.close();appendFileSync(observations,JSON.stringify({phase:'context-closed',label,case:item.name,run})+'\n');const traceFinalization=await finishResponseTraces(responseTasks);const result={traceFinalization,traceHelperSha256,timingBasis:'navigation-relative-painted-content-observation-v2',appVisibilityGuard:true,environmentVerification,scriptSha256,cpuProfile,browserTimings,label,case:item.name,run,build:process.env.IQ_BENCH_BUILD,rendering:process.env.IQ_BENCH_HEADLESS==='1'?'headless-gles':'headed-normal-chromium-gles',route:base,emptyBrowserCache:true,requested,started,viewportAt,firstCurrentMs,firstHistoryMs,completeMs,deadlineMs:observationMs,extendedCoverageObservation:observationMs>12000,fitWalls,keepCurrent,referenceFrames,last,paintMarks,diagnostics,requests,errors,exception,before,after:resource()};appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({case:item.name,run,firstCurrentMs,firstHistoryMs,completeMs,exception,bars:last?.footprint.times.length,wall:last?.wall.status?.archive}));
}}finally{await browser.close();}

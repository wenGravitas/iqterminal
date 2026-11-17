import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
/** Real staging traffic. Current-only execution subscriber receives no viewport demand. */
import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4185',label=process.env.IQ_BENCH_LABEL,build=process.env.IQ_BENCH_BUILD,backend=process.env.IQ_BENCH_BACKEND;
assert.equal(process.env.IQ_ROUTE_R2_STARTUP,'1','Explicit staging current-concurrency opt-in required');
assert.match(label??'',/^[a-zA-Z0-9_-]{1,80}$/);for(const commit of [build,backend])assert.match(commit??'',/^[a-f0-9]{40}$/);
const windowFile=process.env.IQ_CURRENT_WINDOWS??'artifacts/pi-history-r1/windows.json',end=JSON.parse(readFileSync(windowFile,'utf8')).end;assert.ok(Number.isSafeInteger(end)&&end>0&&end%3600000===0,'Pinned closed-hour window required');
const dir=`artifacts/pi-forwarded-route-r2/${label}`;const cohort=process.env.IQ_STARTUP_COHORT;assert.equal(cohort,'startup');const taskManifest=JSON.parse(readFileSync('artifacts/pi-forwarded-route-r2/manifest.json'));const cutoff=taskManifest.experimentCutoffEpoch*1000;assert.ok(Date.now()<cutoff,'Checkpoint reserve started; no new cohort');let observationMs=20000,seq=0;const requestId=()=>`pi-route-r2-${cohort}-${++seq}-${randomUUID().slice(0,8)}`;mkdirSync(dir,{recursive:false});
writeFileSync(dir+'/executed.mjs',readFileSync(new URL(import.meta.url)));writeFileSync(dir+'/input-windows.json',JSON.stringify({end},null,2));
const sampleCount=Number(process.env.IQ_CURRENT_SAMPLES??5),cpuProfile=process.env.IQ_CURRENT_CPU_PROFILE==='1';assert.ok(Number.isInteger(sampleCount)&&sampleCount>=1&&sampleCount<=5,'One to five explicitly scoped samples required');
const output=`${dir}/samples.jsonl`;writeFileSync(output,'');
const resource=()=>({load:readFileSync('/proc/loadavg','utf8'),memory:readFileSync('/proc/meminfo','utf8'),cpu:readFileSync('/proc/stat','utf8').split('\n').filter(s=>/^cpu\b/.test(s)),vmstat:readFileSync('/proc/vmstat','utf8').split('\n').filter(s=>/^(pswpin|pswpout|pgmajfault) /.test(s))});
const ledgerPath=`artifacts/pi-forwarded-route-r2/${cohort}-cohort-ledger.json`;
writeFileSync(ledgerPath,JSON.stringify({cohort,startUtc:new Date().toISOString(),client:build,gateway:backend,sampleCount,deadlineUtc:taskManifest.deadlineUtc,checkpointUtc:taskManifest.experimentCutoffUtc,policy:'Exactly five predeclared fresh contexts; preserve all failures; no reruns',phase:'starting'},null,2),{flag:'wx'});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
let custom;
async function diagnostics(page){
 await page.evaluate(()=>{window.__probeDiagnosticsPrior=window.__terminal.feed.diagnostics;window.__terminal.feed.send({type:'diagnostics'});});
 await page.waitForFunction(()=>window.__terminal.feed.diagnostics!==window.__probeDiagnosticsPrior,null,{timeout:3000});
 return page.evaluate(()=>{delete window.__probeDiagnosticsPrior;return window.__terminal.feed.diagnostics;});
}
const executionStream=d=>d?.staging?.streams?.find(s=>s.key.endsWith(':footprint:5m:p25'));

async function health(context,path){
 const start=performance.now(),id=requestId();let probe;
 try{const response=await context.request.get(`${base}/market-data${path}`,{timeout:12000,headers:{'X-IQ-Request-Id':id}}),text=await response.text();
  probe={requestId:id,status:response.status(),headers:response.headers(),elapsedMs:performance.now()-start,decodedBytes:Buffer.byteLength(text)};
  const body=JSON.parse(text);return response.ok()?{...body,_probe:probe}:{error:`Health HTTP ${response.status()}`,body,_probe:probe};
 }catch(error){return {error:String(error),_probe:probe??{requestId:id,elapsedMs:performance.now()-start}};}
}
try{for(let run=1;run<=sampleCount;run++)for(const scenario of ['concurrent-history']){
 assert.ok(Date.now()+150000<cutoff,'Insufficient experiment budget for another planned context');observationMs=15000;
 const id='chart-current-probe',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current probe',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 if(scenario==='concurrent-history'){for(const [hid,interval,hours] of [['chart-history-five','5m',4],['chart-history-hour','1h',24]]){layout.panels[hid]={id:hid,contentComponent:'candle',tabComponent:'compact-chart',title:'Concurrent history',params:{venue:'binance',market:'perpetual',interval,type:'footprint',rowPrice:25,historyViewport:{from:end-hours*3600000,to:end},studies:[]},minimumHeight:140,minimumWidth:220};layout.grid.root.data.push({type:'leaf',data:{views:[hid],activeView:hid,id:hid},size:640});}}
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage(),failures=[],requests=[],pending=new Map();
 context.on('request',r=>{if(r.url().includes('/market-data/'))pending.set(r,{url:r.url(),at:performance.now()});});
 const recordByRequest=new WeakMap();
 await context.route('**/market-data/**',async route=>{const r=route.request(),id=requestId(),record=pending.get(r);if(record){record.id=id;recordByRequest.set(r,record);}await route.continue({headers:{...r.headers(),'x-iq-request-id':id}});});
 context.on('response',async response=>{const r=recordByRequest.get(response.request());if(r){r.status=response.status();r.headers=await response.allHeaders();}});
 const finish=(r,state)=>{const record=pending.get(r);if(!record)return;pending.delete(r);requests.push({...record,elapsedMs:performance.now()-record.at,state,timing:r.timing()});};
 context.on('requestfinished',r=>finish(r,'finished'));context.on('requestfailed',r=>finish(r,'failed'));
 context.on('requestfailed',r=>{if(r.url().includes('/market-data/'))failures.push({url:r.url(),error:r.failure()?.errorText});});
 const profiler=cpuProfile?await context.newCDPSession(page):null;if(profiler)await profiler.send('Profiler.enable');
 const derivedBefore=await health(context,'/v2/history/health');
 const sourceBefore=await health(context,'/v1/health'),hostBefore=resource();
 let error,baselineDiagnostics;
 try{
  assert.ok(!derivedBefore.error&&!sourceBefore.error,'Startup health failed: '+JSON.stringify({derivedBefore,sourceBefore}));
  assert.equal(derivedBefore.build,backend,JSON.stringify(derivedBefore));
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>window.__terminal?.panels.has('chart-current-probe'),null,{timeout:15000});
  await page.evaluate(()=>{
   const p=window.__probe={started:performance.now(),firstAt:null,lastUpdate:0,updates:[],states:[],frames:[],tasks:[]};let prior=performance.now();
   const frame=now=>{p.frames.push(now-prior);prior=now;if(p.frames.length>2000)p.frames.shift();requestAnimationFrame(frame);};requestAnimationFrame(frame);
   new PerformanceObserver(list=>p.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   window.__probeRelease=window.__terminal.feed.subscribeFootprint('pi-current-only',{venue:'binance',market:'perpetual',interval:'5m'},25,event=>{
    const status=event.status;if(!status)return;p.states.push({at:performance.now(),state:status.state,message:status.message,transport:status.transport,coverage:status.coverage});if(p.states.length>1000)p.states.shift();
    if(status.state==='live'&&status.lastUpdate>p.lastUpdate){p.firstAt??=performance.now();p.lastUpdate=status.lastUpdate;p.updates.push({at:performance.now(),sourceAt:status.lastUpdate,batchId:event.batchId});}
   });
  });
  await page.waitForFunction(()=>window.__probe.firstAt!==null,null,{timeout:12000});
  const confirmationDeadline=performance.now()+5000;
  do{baselineDiagnostics=await diagnostics(page);if(executionStream(baselineDiagnostics)?.executionProof?.confirmedAckBatches>=1)break;await new Promise(resolve=>setTimeout(resolve,200));}while(performance.now()<confirmationDeadline);
  assert.ok(executionStream(baselineDiagnostics)?.executionProof?.confirmedAckBatches>=1,'Live badge without a confirmed execution ACK chain');
  if(profiler)await profiler.send('Profiler.start');
  await page.evaluate(({scenario,end})=>{
   const t=window.__terminal,p=window.__probe;p.observeStart=performance.now();p.updates=[];
   if(scenario==='concurrent-history'){
    // Both saved historical views were created before current bootstrap.
    setTimeout(()=>{const panel=t.panels.get('chart-history-hour');panel?.engine.restoreHistoryTimeRange({from:end-25*3600000,to:end-3600000});},3000);
    setTimeout(()=>{const panel=t.panels.get('chart-history-hour');panel?.engine.restoreHistoryTimeRange({from:end-24*3600000,to:end});},3500);
   }
  },{scenario,end});
  await page.waitForTimeout(observationMs);
  await diagnostics(page);
 }catch(e){error=String(e);}
 if(profiler){try{const {profile}=await profiler.send('Profiler.stop');writeFileSync(`${dir}/${scenario}-${run}.cpuprofile`,JSON.stringify(profile));}catch(profileError){error??=String(profileError);}finally{await profiler.detach();}}
 const measurement=await page.evaluate(()=>{
  const p=window.__probe;if(!p)return null;const now=performance.now(),times=[p.observeStart??p.started,...p.updates.map(e=>e.at),now],gaps=times.slice(1).map((t,i)=>t-times[i]);
  return {...p,now,bootstrapMs:p.firstAt===null?null:p.firstAt-p.started,maxReceiveGapMs:Math.max(...gaps),heap:performance.memory?.usedJSHeapSize,diagnostics:window.__terminal.feed.diagnostics,panels:[...window.__terminal.panels.values()].map(p=>({id:p.params.api.id,footprint:p.diagnostics().footprint,renderer:p.diagnostics().renderer}))};
 }).catch(()=>null);
 const environment=await page.evaluate(()=>({fixture:window.__terminal.feed.diagnostics?.fixture,config:window.__terminal.feed.diagnostics?.staging?.config})).catch(()=>null);
 if(!error)try{assert.equal(environment.fixture,false);assert.equal(environment.config?.dataMode,'staging');assert.equal(environment.config?.historyTiles,true);assert.equal(environment.config?.build,build);if(process.env.IQ_BENCH_YIELD_MODE)assert.equal(environment.config?.historyTaskYield,process.env.IQ_BENCH_YIELD_MODE);}catch(e){error=String(e);}
 const derivedAfter=await health(context,'/v2/history/health');
 const sourceAfter=await health(context,'/v1/health');
 if(!error&&[derivedAfter,sourceAfter].some(probe=>probe.error))error='Post-observation health failed: '+JSON.stringify({derivedAfter,sourceAfter});
 const finalProof=executionStream(measurement?.diagnostics)?.executionProof,baselineProof=executionStream(baselineDiagnostics)?.executionProof;
 if(!error&&(!finalProof||!baselineProof||finalProof.lastConfirmedAckCursor<=baselineProof.lastConfirmedAckCursor||finalProof.disconnects>baselineProof.disconnects||finalProof.errors>baselineProof.errors))error='Current execution confirmation did not advance independently without disconnect/error';
 await page.screenshot({path:`${dir}/${scenario}-${run}.png`}).catch(()=>{});
 await page.evaluate(()=>{window.__probeRelease?.();for(const panel of [...window.__terminal.dock.panels])if(panel.id!=='chart-current-probe')window.__terminal.dock.removePanel(panel);window.__terminal.feed.send({type:'diagnostics'});}).catch(()=>{});await page.waitForTimeout(250);
 const released=await diagnostics(page).catch(()=>null);
 const result={cohort,currentStartsWithHistories:scenario==='concurrent-history',firstLiveNavigationMs:measurement?.firstAt,route:base,sourceWindowEnd:end,cpuProfile,sampleCount,currentExecutionConnected:executionStream(measurement?.diagnostics)?.connected===true,baselineDiagnostics,currentExecutionProof:executionStream(measurement?.diagnostics)?.executionProof,baselineExecutionProof:executionStream(baselineDiagnostics)?.executionProof,windowFile,scenario,run,build:process.env.IQ_BENCH_BUILD,backend,environment,observationMs,rendering:'headless system Chromium; Canvas renderer recorded per panel; not normal foreground Pi UX acceptance',custom,requests,pendingAtObservation:[...pending.values()],measurement,sourceBefore,sourceAfter,derivedBefore,derivedAfter,failures,error,released,hostBefore,host:resource()};
 if(error)process.exitCode=1;appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({scenario,run,bootstrapMs:measurement?.bootstrapMs,updates:measurement?.updates.length,maxReceiveGapMs:measurement?.maxReceiveGapMs,error}));await context.close();if(error)console.error('Preserved failed planned context: '+error);
}}finally{await browser.close();writeFileSync(`artifacts/pi-forwarded-route-r2/${cohort}-cohort-done.json`,JSON.stringify({endedUtc:new Date().toISOString(),exitCode:process.exitCode??0}));}

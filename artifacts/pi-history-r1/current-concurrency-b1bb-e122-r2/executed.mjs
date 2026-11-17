import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
/** Real staging traffic. Current-only execution subscriber receives no viewport demand. */
import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4185',label=process.env.IQ_BENCH_LABEL,build=process.env.IQ_BENCH_BUILD,backend=process.env.IQ_BENCH_BACKEND;
assert.equal(process.env.IQ_CURRENT_CONCURRENCY,'1','Explicit staging current-concurrency opt-in required');
assert.match(label??'',/^[a-zA-Z0-9_-]{1,80}$/);for(const commit of [build,backend])assert.match(commit??'',/^[a-f0-9]{40}$/);
const dir=`artifacts/pi-history-r1/${label}`,end=JSON.parse(readFileSync('artifacts/pi-history-r1/windows.json','utf8')).end,observationMs=20000;mkdirSync(dir,{recursive:false});
writeFileSync(dir+'/executed.mjs',readFileSync(new URL(import.meta.url)));
const output=`${dir}/samples.jsonl`;writeFileSync(output,'');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
let custom;
async function health(context,path){
 const start=performance.now();let probe;
 try{const response=await context.request.get(`${base}/market-data${path}`,{timeout:12000}),text=await response.text();
  probe={status:response.status(),headers:response.headers(),elapsedMs:performance.now()-start,decodedBytes:Buffer.byteLength(text)};
  const body=JSON.parse(text);return response.ok()?{...body,_probe:probe}:{error:`Health HTTP ${response.status()}`,body,_probe:probe};
 }catch(error){return {error:String(error),_probe:probe??{elapsedMs:performance.now()-start}};}
}
try{for(let run=1;run<=5;run++)for(const scenario of (run%2?['current-only','concurrent-history']:['concurrent-history','current-only'])){
 if(scenario==='concurrent-history'&&!custom){
  const profile='binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-3pct-agg-native-top10-a1-s1';
  const params=new URLSearchParams({market:'perpetual',profile,from:String(end-30*3600000),to:String(end),limit:'1'});
  try{const response=await fetch(`${base}/market-data/v1/order-walls/archive?${params}`,{signal:AbortSignal.timeout(15000)});custom={status:response.status,body:await response.json()};}catch(error){custom={error:String(error)};}
 }
 const id='chart-current-probe',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current probe',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage(),failures=[],requests=[],pending=new Map();
 context.on('request',r=>{if(r.url().includes('/market-data/'))pending.set(r,{url:r.url(),at:performance.now()});});
 const finish=(r,state)=>{const record=pending.get(r);if(!record)return;pending.delete(r);requests.push({...record,elapsedMs:performance.now()-record.at,state,timing:r.timing()});};
 context.on('requestfinished',r=>finish(r,'finished'));context.on('requestfailed',r=>finish(r,'failed'));
 context.on('requestfailed',r=>{if(r.url().includes('/market-data/'))failures.push({url:r.url(),error:r.failure()?.errorText});});
 const derivedBefore=await health(context,'/v2/history/health');
 assert.equal(derivedBefore.build,backend);const sourceBefore=await health(context,'/v1/health');
 let error;
 try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>window.__terminal?.panels.has('chart-current-probe'),null,{timeout:15000});
  await page.evaluate(()=>{
   const p=window.__probe={started:performance.now(),firstAt:null,lastUpdate:0,updates:[],states:[],frames:[],tasks:[]};let prior=performance.now();
   const frame=now=>{p.frames.push(now-prior);prior=now;if(p.frames.length>2000)p.frames.shift();requestAnimationFrame(frame);};requestAnimationFrame(frame);
   new PerformanceObserver(list=>p.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   window.__probeRelease=window.__terminal.feed.subscribeFootprint('pi-current-only',{venue:'binance',market:'perpetual',interval:'5m'},25,event=>{
    const status=event.status;if(!status)return;p.states.push({at:performance.now(),state:status.state,message:status.message});if(p.states.length>1000)p.states.shift();
    if(status.state==='live'&&status.lastUpdate>p.lastUpdate){p.firstAt??=performance.now();p.lastUpdate=status.lastUpdate;p.updates.push({at:performance.now(),sourceAt:status.lastUpdate,batchId:event.batchId});}
   });
  });
  await page.waitForFunction(()=>window.__probe.firstAt!==null,null,{timeout:12000});
  await page.evaluate(({scenario,end})=>{
   const t=window.__terminal,p=window.__probe;p.observeStart=performance.now();p.updates=[];
   if(scenario==='concurrent-history'){
    for(const [id,interval,hours] of [['chart-history-five','5m',4],['chart-history-hour','1h',24]])t.dock.addPanel({id,component:'candle',title:'Concurrent history',params:{venue:'binance',market:'perpetual',interval,type:'footprint',rowPrice:25,historyViewport:{from:end-hours*3600000,to:end},studies:[]},position:{referencePanel:t.dock.activePanel,direction:'right'},minimumWidth:220,minimumHeight:140});
    setTimeout(()=>{const panel=t.panels.get('chart-history-hour');panel?.engine.restoreHistoryTimeRange({from:end-25*3600000,to:end-3600000});},3000);
    setTimeout(()=>{const panel=t.panels.get('chart-history-hour');panel?.engine.restoreHistoryTimeRange({from:end-24*3600000,to:end});},3500);
   }
  },{scenario,end});
  await page.waitForTimeout(observationMs);
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(200);
 }catch(e){error=String(e);}
 const measurement=await page.evaluate(()=>{
  const p=window.__probe;if(!p)return null;const now=performance.now(),times=[p.observeStart??p.started,...p.updates.map(e=>e.at),now],gaps=times.slice(1).map((t,i)=>t-times[i]);
  return {...p,now,bootstrapMs:p.firstAt===null?null:p.firstAt-p.started,maxReceiveGapMs:Math.max(...gaps),heap:performance.memory?.usedJSHeapSize,diagnostics:window.__terminal.feed.diagnostics,panels:[...window.__terminal.panels.values()].map(p=>({id:p.params.api.id,footprint:p.diagnostics().footprint,renderer:p.diagnostics().renderer}))};
 }).catch(()=>null);
 const environment=await page.evaluate(()=>({fixture:window.__terminal.feed.diagnostics?.fixture,config:window.__terminal.feed.diagnostics?.staging?.config})).catch(()=>null);
 if(!error)try{assert.equal(environment.fixture,false);assert.deepEqual(environment.config,{dataMode:'staging',historyTiles:true,build});}catch(e){error=String(e);}
 const derivedAfter=await health(context,'/v2/history/health');
 const sourceAfter=await health(context,'/v1/health');
 await page.screenshot({path:`${dir}/${scenario}-${run}.png`}).catch(()=>{});
 await page.evaluate(()=>{window.__probeRelease?.();for(const panel of [...window.__terminal.dock.panels])if(panel.id!=='chart-current-probe')window.__terminal.dock.removePanel(panel);window.__terminal.feed.send({type:'diagnostics'});}).catch(()=>{});await page.waitForTimeout(250);
 const released=await page.evaluate(()=>window.__terminal.feed.diagnostics).catch(()=>null);
 const result={scenario,run,build:process.env.IQ_BENCH_BUILD,backend,environment,observationMs,rendering:'headless system Chromium; Canvas renderer recorded per panel; not normal foreground Pi UX acceptance',custom,requests,pendingAtObservation:[...pending.values()],measurement,sourceBefore,sourceAfter,derivedBefore,derivedAfter,failures,error,released,host:{load:readFileSync('/proc/loadavg','utf8'),memory:readFileSync('/proc/meminfo','utf8')}};
 if(error)process.exitCode=1;appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({scenario,run,bootstrapMs:measurement?.bootstrapMs,updates:measurement?.updates.length,maxReceiveGapMs:measurement?.maxReceiveGapMs,error}));await context.close();
}}finally{await browser.close();}

import {routeTestBrowser} from './test-browser-workspace.mjs';
/** Real staging traffic. Current-only execution subscriber receives no viewport demand. */
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const base='http://127.0.0.1:4181',dir='artifacts/pi-history-r1',end=JSON.parse(readFileSync(`${dir}/windows.json`,'utf8')).end;
const output=`${dir}/${process.env.IQ_BENCH_LABEL??'current-concurrency'}.jsonl`;writeFileSync(output,'');
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
let custom;
try{for(const scenario of ['current-only','concurrent-history'])for(let run=1;run<=Number(process.env.IQ_BENCH_SAMPLES??5);run++){
 if(scenario==='concurrent-history'&&!custom){
  const profile='binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-3pct-agg-native-top10-a1-s1';
  const params=new URLSearchParams({market:'perpetual',profile,from:String(end-30*3600000),to:String(end),limit:'1'});
  try{const response=await fetch(`${base}/market-data/v1/order-walls/archive?${params}`,{signal:AbortSignal.timeout(15000)});custom={status:response.status,body:await response.json()};}catch(error){custom={error:String(error)};}
 }
 const id='chart-current-probe',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current probe',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage(),failures=[];await routeTestBrowser();
 context.on('requestfailed',r=>{if(r.url().includes('/market-data/'))failures.push({url:r.url(),error:r.failure()?.errorText});});
 const derivedBefore=await context.request.get(`${base}/market-data/v2/history/health`).then(r=>r.json()).catch(error=>({error:String(error)}));
 const sourceBefore=await context.request.get(`${base}/market-data/v1/health`).then(r=>r.json()).catch(error=>({error:String(error)}));
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
  await page.waitForTimeout(10000);
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(200);
 }catch(e){error=String(e);}
 const measurement=await page.evaluate(()=>{
  const p=window.__probe;if(!p)return null;const now=performance.now(),times=[p.observeStart??p.started,...p.updates.map(e=>e.at),now],gaps=times.slice(1).map((t,i)=>t-times[i]);
  return {...p,now,bootstrapMs:p.firstAt===null?null:p.firstAt-p.started,maxReceiveGapMs:Math.max(...gaps),heap:performance.memory?.usedJSHeapSize,diagnostics:window.__terminal.feed.diagnostics,panels:[...window.__terminal.panels.values()].map(p=>({id:p.params.api.id,footprint:p.diagnostics().footprint,renderer:p.diagnostics().renderer}))};
 }).catch(()=>null);
 const derivedAfter=await context.request.get(`${base}/market-data/v2/history/health`).then(r=>r.json()).catch(error=>({error:String(error)}));
 const sourceAfter=await context.request.get(`${base}/market-data/v1/health`).then(r=>r.json()).catch(e=>({error:String(e)}));
 await page.screenshot({path:`${dir}/${process.env.IQ_BENCH_LABEL??'concurrency'}-${scenario}-${run}.png`}).catch(()=>{});
 await page.evaluate(()=>{window.__probeRelease?.();for(const panel of [...window.__terminal.dock.panels])if(panel.id!=='chart-current-probe')window.__terminal.dock.removePanel(panel);window.__terminal.feed.send({type:'diagnostics'});}).catch(()=>{});await page.waitForTimeout(250);
 const released=await page.evaluate(()=>window.__terminal.feed.diagnostics).catch(()=>null);
 const result={scenario,run,build:process.env.IQ_BENCH_BUILD,backend:process.env.IQ_BENCH_BACKEND??'unknown',rendering:'headed-normal-chromium-gles',custom,measurement,sourceBefore,sourceAfter,derivedBefore,derivedAfter,failures,error,released,host:{load:readFileSync('/proc/loadavg','utf8'),memory:readFileSync('/proc/meminfo','utf8')}};
 appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({scenario,run,bootstrapMs:measurement?.bootstrapMs,updates:measurement?.updates.length,maxReceiveGapMs:measurement?.maxReceiveGapMs,error}));await context.close();
}}finally{await browser.close();}

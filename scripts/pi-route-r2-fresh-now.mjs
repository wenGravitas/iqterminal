/** One bounded current-ending wall smoke per market; never a latency certification. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {chromium} from './test-browser-launch.mjs';
const base='http://127.0.0.1:4202',dir='artifacts/pi-forwarded-route-r2/fresh-now-usdm';
assert.equal(process.env.IQ_STARTUP_WALL_SMOKE,'1');
assert.ok(Date.now()+90000<JSON.parse(readFileSync('artifacts/pi-forwarded-route-r2/manifest.json')).experimentCutoffEpoch*1000);
const build=JSON.parse(readFileSync('artifacts/pi-forwarded-route-r2/diagnostic-build.json')).commit;
mkdirSync(dir,{recursive:false});writeFileSync(dir+'/executed.mjs',readFileSync(new URL(import.meta.url)));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
try{for(const [market,interval] of [['perpetual','15m']]){
 const to=Date.now(),requested={from:to-30*3600000,to},id='chart-walls-smoke';
 const params={venue:'binance',market,interval,type:'candle',historyViewport:requested,studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}]};
 const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current ending 30h walls',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage();
 const requests=[],errors=[];context.on('requestfailed',r=>errors.push({url:r.url(),error:r.failure()?.errorText}));
 context.on('response',r=>{if(r.url().includes('/market-data/'))requests.push({url:r.url(),status:r.status()});});
 await page.addInitScript(({requested})=>{
  window.__wallSmoke={firstCurrent:null,firstHistory:null,completeClaim:null,historyPaints:0,last:null};
  const frame=()=>{const p=window.__terminal?.panels.get('chart-walls-smoke'),b=window.__wallSmoke;if(p){const d=p.engine.orderWallsDiagnostics(),s=p.orderWallsStatus,v=p.engine.visibleTimeRange(),a=s?.archive;
   const match=v&&Math.abs(v.from-requested.from/1000)<900&&Math.abs(v.to-requested.to/1000)<900;
   if(d.visibleCurrent>0&&s?.state==='live')b.firstCurrent??=performance.now();
   if(match&&d.visibleHistorical>0){b.firstHistory??=performance.now();b.historyPaints++;}
   // This is a claim plus paint check, not an independent canonical reference.
   if(match&&a?.requestComplete&&a.exact&&a.from<=requested.from&&a.to>=requested.to&&a.loadedThrough>=requested.to&&d.inputRevision===d.paintedRevision&&!d.pendingProjectionSegments&&!d.pendingReferenceSegments&&!d.valueHistoryLimited&&!d.episodeHistoryLimited)b.completeClaim??=performance.now();
   b.last={status:s,render:d,viewport:v,nativeCandles:p.candles.length,renderer:p.diagnostics().renderer,heap:performance.memory?.usedJSHeapSize,at:performance.now()};}
   requestAnimationFrame(frame);};requestAnimationFrame(frame);
 },{requested});
 const began=performance.now();let error;
 try{await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>window.__terminal?.panels.get('chart-walls-smoke')?.engine.chart.dataLayer.length>0,null,{timeout:12000});
  await page.evaluate(r=>{const e=window.__terminal.panels.get('chart-walls-smoke').engine,d=e.chart.dataLayer;e.setRange({from:d.timeToIndexFloat(r.from/1000),to:d.timeToIndexFloat(r.to/1000)});},requested);
  while(performance.now()-began<60000){const done=await page.evaluate(()=>window.__wallSmoke.completeClaim!==null&&window.__wallSmoke.firstCurrent!==null);if(done)break;await page.waitForTimeout(Math.min(250,Math.max(1,60000-(performance.now()-began))));}
 }catch(e){error=String(e);}
 const result=await page.evaluate(()=>({measurement:window.__wallSmoke,config:window.__terminal?.feed.diagnostics?.staging?.config})).catch(()=>null);
 await page.screenshot({path:`${dir}/${market}.png`}).catch(()=>{});
 appendFileSync(dir+'/samples.jsonl',JSON.stringify({market,interval,requested,build,route:base,emptyBrowserCache:true,preparedServer:'Rolling default profile; actual state recorded, not assumed ready',scope:'Representative headless smoke, at most60s per view. completeClaim is not independent financial certification.',elapsedMs:performance.now()-began,...result,requests,errors,error})+'\n');
 console.log(JSON.stringify({market,firstCurrent:result?.measurement?.firstCurrent,firstHistory:result?.measurement?.firstHistory,completeClaim:result?.measurement?.completeClaim,archive:result?.measurement?.last?.status?.archive,error}));await context.close();
}}finally{await browser.close();}

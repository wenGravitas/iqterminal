import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:5173',from=1795122000000,to=1795148100000,id='chart-history-repair';
const mode=process.env.WALL_PROBE_MODE??'optimized',directory=process.env.WALL_PROBE_DIR??'/tmp/iq-walls-profile';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/walls/discover?**',async route=>{const headers={...route.request().headers()};if(mode==='baseline')delete headers['x-iq-wall-reader-consumer'];await route.continue({headers});});
await context.addInitScript(({from,to,id})=>{
 const firstPaint=()=>{const p=window.__terminal?.panels.get(id),d=p?.engine.orderWallsDiagnostics();if(d?.visibleHistorical>0){window.__wallFirstPaint=performance.now();return;}requestAnimationFrame(firstPaint);};requestAnimationFrame(firstPaint);
 window.__wallStartup=[];const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(['order-wall-subscribe','order-wall-unsubscribe'].includes(message?.type))window.__wallStartup.push({at:performance.now(),type:message.type,id:message.id,request:message.request});return post.call(this,message,...args);};
 const indicator=(definitionId,settings,placement='overlay',settingsVersion=1)=>({instanceId:definitionId,definitionId,settingsVersion,visible:true,source:{kind:'chart'},placement,settings});
 const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'5m',type:'footprint',rowPrice:25,footprintUnits:'usdt',historyViewport:{from,to},studies:[],indicators:[
  indicator('native.footprint',{rowPrice:25,units:'usdt',view:{displayMode:'volume-delta-candle',showCandle:true}}),
  indicator('native.order-walls',{enabled:true,mode:'top-levels',topLevels:8,aggregation:'native',searchRangePercent:10,showHistory:true},'overlay',2),
  indicator('native.footprint-totals',{rows:['volume','delta'],highlightDeltaFlips:true,deltaFlipLookback:50,deltaFlipMinimumStrength:.25},'new-pane')
 ]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));localStorage.setItem('basis.theme.v1','dark');
},{from,to,id});
const events=[],requests=[],finished=[];page.on('requestfinished',r=>{if(r.url().includes('/walls'))finished.push({url:r.url(),timing:r.timing()});}); page.on('request',r=>{if(r.url().includes('/walls'))requests.push({at:performance.now(),url:r.url()});}); const start=performance.now(); page.on('response',r=>{if(r.url().includes('/walls'))events.push({at:performance.now()-start,status:r.status(),url:r.url()});});
try{
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(id=>{const p=window.__terminal?.panels.get(id);return p?.orderWallsStatus?.archive?.requestComplete && p.engine.orderWallsDiagnostics().visibleHistorical>0 && !p.engine.orderWallsDiagnostics().pendingPaintWork},id,{timeout:90000});
 await page.evaluate(()=>window.__terminal.feed.worker.postMessage({type:'diagnostics'}));await page.waitForFunction(()=>Boolean(window.__terminal.feed.diagnostics.orderWallsArchive));
 await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'})); await page.waitForFunction(()=>window.__terminal.feed.diagnostics.orderWallsArchive); const completedMs=performance.now()-start; const state=await page.evaluate(id=>{
  const p=window.__terminal.panels.get(id),s=[...p.engine.orderWallSegments.values()],pane=p.engine.footprintTotalsPanes.get('native.footprint-totals').primitive;
  const time=1795143900,reference=Array.from({length:50},(_,i)=>p.footprintAnalysisSummaries.get(time-(i+2)*300));
  const magnitudes=reference.map(s=>Math.abs(s.quoteDelta)).sort((a,b)=>a-b);
  return {range:p.engine.visibleTimeRange(),market:p.selection.market,interval:p.selection.interval,footprintBars:p.footprintBars.length,summaries:p.footprintAnalysisSummaries.size,
   previous:p.footprintAnalysisSummaries.get(time-300),candidate:p.footprintAnalysisSummaries.get(time),referenceBars:reference.length,referenceValidated:reference.every(s=>s.coverageEvidence.validated&&s.coverageEvidence.complete&&s.ended&&!s.gapBefore),medianAbsoluteQuoteDelta:(magnitudes[24]+magnitudes[25])/2,
   flip:pane.deltaFlips.get(time),totals:p.engine.footprintTotalsDiagnostics(),wallSegments:s.length,wallEarliest:Math.min(...s.map(s=>s.start)),wallStatus:p.orderWallsStatus,wallDiagnostics:p.engine.orderWallsDiagnostics(),firstWallPaintMs:window.__wallFirstPaint,startup:window.__wallStartup,profile:window.__terminal.stats(),resources:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script'||r.initiatorType==='other').map(r=>({name:r.name,start:r.startTime,duration:r.duration,transfer:r.transferSize,body:r.decodedBodySize}))};
 },id);
 assert.equal(state.wallSegments,3627);assert.equal(state.wallDiagnostics.visibleHistorical,8629);assert.equal(state.wallDiagnostics.archiveValueRuns,23239);assert.equal(state.wallStatus.archive.gaps.length,6);assert.equal(state.wallStatus.archive.requestComplete,true);assert.equal(state.referenceValidated,true);assert.deepEqual(errors,[]);
 const batch=requests.find(r=>r.url.includes('/projection-batch'));assert.ok(batch);const earlyReaders=requests.filter(r=>r.url.endsWith('/walls/reader')&&r.at<batch.at);assert.equal(earlyReaders.length,mode==='baseline'?1:0);
 await mkdir(directory,{recursive:true});await page.screenshot({path:directory+'/combined-live.png'});
 const report={mode,completedMs,evidence:'real staging data through local development proxy; isolated headless Chromium profile; no fixtures',origin,from,to,elapsedMs:performance.now()-start,requests:requests.map(r=>({...r,at:r.at-start})),events,finished,state,errors,performanceAcceptance:false};
 await writeFile(directory+'/combined-live.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:'pass',completedMs:report.completedMs,elapsedMs:report.elapsedMs,range:state.range,referenceBars:state.referenceBars,median:state.medianAbsoluteQuoteDelta,strength:state.flip.strength,walls:state.wallSegments,paintedSpans:state.wallDiagnostics.visibleHistorical,gaps:state.wallStatus.archive.gaps.length,paintComplete:!state.wallDiagnostics.pendingPaintWork}));
}finally{await browser.close();}

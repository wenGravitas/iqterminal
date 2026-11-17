/** Bounded real-route retained-navigation observation. No fixture/fetch replacement.
 * History blocking begins only after validated content paints. Pixel readback
 * makes frame intervals diagnostic, not foreground performance certification. */
import {chromium} from './test-browser-launch.mjs';
import {currentExecutionProof} from './current-execution-proof.mjs';
import {browserWorkerHeaps} from './browser-worker-heaps.mjs';
import {writeFileSync,existsSync} from 'node:fs';
const label=process.argv[2],market=process.argv[3]??'perpetual',base='http://127.0.0.1:4189';
if(!/^[a-z0-9-]+$/.test(label??'')||!['spot','perpetual'].includes(market))throw Error('Unique label and spot/perpetual required');
const out=`artifacts/persistent-wall-navigation/${label}`;if(existsSync(out+'.json'))throw Error('Evidence already exists');
const withCurrent=process.argv[4]==='with-current';
if(process.argv[4]&&!withCurrent)throw Error('Unknown observation option');
const to=Date.now(),from=to-30*3600000,interval=market==='spot'?'5m':'15m';
const params={venue:'binance',market,interval,type:'candle',rowPrice:25,historyViewport:{from,to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}]};
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['chart-live'],activeView:'chart-live',id:'1'},size:1280}],size:720},width:1280,height:720,orientation:'HORIZONTAL'},panels:{'chart-live':{id:'chart-live',contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
const report={scope:'Real route and source; headless software rendering; readback-instrumented navigation; not foreground Pi performance',startedUtc:new Date().toISOString(),market,from,to,requests:[],errors:[],samples:[],blocked:[],withCurrent,executionSamples:[]};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info']});
let page;
try{
 const root=await browser.newBrowserCDPSession();report.environment={version:await root.send('Browser.getVersion'),system:await root.send('SystemInfo.getInfo')};await root.detach();
 const context=await browser.newContext({viewport:{width:1280,height:720},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})},{name:'basis.theme.v1',value:'dark'}]}]}});page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));page.on('response',response=>{if(response.url().includes('/market-data/'))report.requests.push({url:response.url(),status:response.status(),timing:response.request().timing()});});
 await page.addInitScript(()=>{
  window.__wallLive={firstCurrent:null,firstHistory:null,complete:null,active:false,frames:[]};
  const original=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){const p=window.__wallLive;
   if(p.active&&image?.dataset?.iqWallLayer==='retained'){const gl=image.getContext('webgl2'),pixels=new Uint8Array(image.width*image.height*4);gl.readPixels(0,0,image.width,image.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let nonempty=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])nonempty++;p.frames.push({at:performance.now(),nonempty});}
   return original.call(this,image,...args);
  };
  function observe(){const p=window.__terminal?.panels.get('chart-live'),d=p?.engine?.orderWallsDiagnostics(),s=p?.orderWallsStatus,w=window.__wallLive;
   if(d){if(w.firstCurrent===null&&d.visibleCurrent>0)w.firstCurrent=d.paintedAtMono;if(w.firstHistory===null&&d.visibleHistorical>0)w.firstHistory=d.paintedAtMono;
    if(w.complete===null&&d.visibleHistorical>0&&s?.archive?.requestComplete&&s.archive.exact&&s.archive.state!=='unavailable'&&!s.archive.unloadedRanges?.length&&!d.pendingPaintWork&&d.paintedRevision===d.inputRevision)w.complete=d.paintedAtMono;}
   requestAnimationFrame(observe);
  }requestAnimationFrame(observe);
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__terminal?.panels.get('chart-live')?.engine,null,{timeout:20000});
 if(withCurrent)await page.evaluate(()=>{
  window.__wallCurrentStates=[];
  window.__wallCurrentRelease=window.__terminal.feed.subscribeFootprint('navigation-current',{venue:'binance',market:'perpetual',interval:'5m'},25,event=>{
   if(event.status){window.__wallCurrentStates.push({at:performance.now(),state:event.status.state,message:event.status.message});if(window.__wallCurrentStates.length>256)window.__wallCurrentStates.shift();}
  });
 });
 async function executionSample(){
  if(!withCurrent)return;
  const sample=await page.evaluate(async()=>{const f=window.__terminal.feed,prior=f.diagnostics;f.send({type:'diagnostics'});
   const until=performance.now()+3000;while(f.diagnostics===prior&&performance.now()<until)await new Promise(r=>setTimeout(r,25));
   if(f.diagnostics===prior)throw Error('Execution diagnostics did not refresh');
   return {at:performance.now(),stream:f.diagnostics.staging?.streams.find(s=>s.executionProof),states:window.__wallCurrentStates.slice()};
  });report.executionSamples.push(sample);return sample;
 }
 const until=Date.now()+180000;
 while(Date.now()<until){const sample=await page.evaluate(()=>{const p=window.__terminal.panels.get('chart-live');return {at:performance.now(),status:p.orderWallsStatus,draw:p.engine.orderWallsDiagnostics(),marks:{firstCurrent:window.__wallLive.firstCurrent,firstHistory:window.__wallLive.firstHistory,complete:window.__wallLive.complete}};});report.samples.push(sample);await executionSample();if(sample.marks.complete!==null)break;await page.waitForTimeout(1000);}
 await page.evaluate(()=>{window.__terminal.feed.send({type:'diagnostics'});});await page.waitForTimeout(400);report.workerBefore=await page.evaluate(()=>window.__terminal.feed.diagnostics);
 if(report.workerBefore?.fixture||report.workerBefore?.staging?.config?.dataMode!=='staging'||report.workerBefore?.staging?.config?.historyTiles!==true)throw Error('Wrong actual data mode');
 report.loaded=await page.evaluate(()=>window.__wallLive.complete!==null);
 if(report.loaded){
  const hash=()=>page.evaluate(async()=>{const rows=[...window.__terminal.panels.get('chart-live').engine.orderWallSegments.values()].filter(row=>!row.currentSelection&&row.presentationKind!=='current-snapshot');const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));return {segments:rows.length,runs:rows.reduce((n,row)=>n+row.valueRuns.length,0),sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};});
  report.financialBefore=await hash();
  await context.route('**/market-data/**',route=>{const u=new URL(route.request().url());if(route.request().method()==='GET'&&(u.pathname.includes('/history/walls/')&&!/\/(reader|preparation)/.test(u.pathname)||u.pathname.endsWith('/order-walls/archive'))){report.blocked.push(u.pathname+u.search);return route.abort('blockedbyclient');}return route.continue();});
  report.navigation=await page.evaluate(async({from,to})=>{const e=window.__terminal.panels.get('chart-live').engine,d=e.chart.dataLayer,left=d.timeToIndexFloat(from/1000),right=d.timeToIndexFloat(to/1000),width=right-left,center=e.latestCandle().close,before=e.orderWallsDiagnostics();window.__wallLive.active=true;e.chart.setAutoScale(false);
   for(let i=0;i<36;i++){const shift=.02*Math.sin(i/4),half=.4+.02*Math.sin(i/6),mid=(left+right)/2;e.setRange({from:mid+(shift-half)*width,to:mid+(shift+half)*width});e.chart.panes()[0].priceScale.setPriceRange({min:center*(.98+.002*Math.sin(i/5)),max:center*(1.02+.002*Math.sin(i/5))});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
   window.__wallLive.active=false;return {before,after:e.orderWallsDiagnostics(),frames:window.__wallLive.frames};
  },{from,to});report.financialAfter=await hash();report.heap=await browserWorkerHeaps(browser,{collectGarbage:true});
  report.contract={noHistoryRequests:report.blocked.length===0,noSampledBlank:report.navigation.frames.length>0&&report.navigation.frames.every(f=>f.nonempty>0),noHistoryRebuild:report.navigation.before.retainedRenderer.historyBuilds===report.navigation.after.retainedRenderer.historyBuilds,financialUnchanged:report.financialBefore.sha256===report.financialAfter.sha256};
 }
 if(withCurrent){
  const after=await executionSample(),baseline=report.executionSamples.find(s=>s.stream?.executionProof?.confirmedAckBatches>0);
  report.execution={baseline,after,proof:currentExecutionProof({baselineExecutionProof:baseline?.stream?.executionProof,currentExecutionProof:after?.stream?.executionProof,currentExecutionConnected:after?.stream?.socketReadyState===1,measurement:{observeStart:baseline?.at??Infinity,states:after?.states}})};
  await page.evaluate(()=>{window.__wallCurrentRelease?.();window.__wallCurrentRelease=undefined;});
 }
 await page.screenshot({path:out+'.png'});await page.evaluate(()=>{window.__terminal.dock.removePanel(window.__terminal.dock.panels.find(p=>p.id==='chart-live'));window.__terminal.feed.send({type:'diagnostics'});});await page.waitForTimeout(500);report.workerAfter=await page.evaluate(()=>window.__terminal.feed.diagnostics);
}catch(error){report.failure=String(error);}
finally{await browser.close();report.finishedUtc=new Date().toISOString();writeFileSync(out+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,loaded:report.loaded,failure:report.failure,marks:report.samples.at(-1)?.marks,status:report.samples.at(-1)?.status,contract:report.contract,errors:report.errors}));}

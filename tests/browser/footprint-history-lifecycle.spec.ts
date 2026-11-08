import {test,expect,type BrowserContext} from '@playwright/test';
import {addIndicator,setFootprint} from './indicator-actions';
const HOUR=3600000;
function executionBar(time:number,step:number){return {time:time/1000,revision:1,rowSize:25,cells:[{price:80000,bidVol:3,askVol:5,bidNotional:240000,askNotional:400000}],open:80000,high:80025,low:79975,close:80010,delta:2,minDelta:0,maxDelta:2,quoteDelta:160000,minQuoteDelta:0,maxQuoteDelta:160000,aggregateRecordCount:2,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false};}

import {installHealthyStagingWorker} from './staging-worker-fixture';
test.beforeEach(async({context})=>installHealthyStagingWorker(context));
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus&&!page.isClosed())console.log('FAILED_HISTORY_STATE',JSON.stringify(await page.evaluate(()=>{const terminal=(window as any).__terminal;return terminal?[...terminal.panels.values()].map((p:any)=>({diagnostics:p.diagnostics(),nativeBars:p.candles.length,pending:p.pendingHistoryView,nativeDemand:p.nativeCandleDemand,visibility:document.visibilityState,primitiveBars:p.engine.footprint?.bars?.map((b:any)=>b.time),sliceKey:p.engine.footprintSliceKey,indexData:p.engine.footprintIndexSeries?.getData().map((b:any)=>b.time),indices:p.footprintBars.map((b:any)=>[b.time,p.engine.chart.dataLayer.timeToIndex(b.time)]),layerLength:p.engine.chart.dataLayer.length,queuedRefresh:p.engine.visibleCallbacks.has(p.engine.footprintRefresh),schedulerDirty:p.scheduler.dirty.has(p.engine),schedulerFrame:p.scheduler.frame,engineVisible:p.engine.visible,dead:p.engine.disposed})):null;})));});
test('saved candle wall history starts before native candles and restores without an offscreen current bootstrap',async({page,context})=>{
 test.setTimeout(45000);await installHealthyStagingWorker(context,false);
 const step=300000,now=Date.now(),to=Math.floor(now/step)*step-24*HOUR,from=to-30*HOUR,id='chart-saved-walls',requests:string[]=[];
 let releaseNative!:()=>void;const gate=new Promise<void>(resolve=>releaseNative=resolve);
 await context.addInitScript(({from,to,id})=>{const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'spot',interval:'5m',type:'candle',historyViewport:{from,to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,aggregation:'native',searchRangePercent:10,showHistory:true}}]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{from,to,id});
 await context.route('**/market-data/**',async route=>{const u=new URL(route.request().url());requests.push(u.pathname+u.search);const json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){await gate;return json({source:'binance-native-kline',candles:Array.from({length:1000},(_,i)=>({t:Math.floor(now/step)*step-(999-i)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<999}))});}
  if(u.pathname.endsWith('/walls/discover'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Explicit fixture holds financial history unavailable"}'});
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect.poll(()=>requests.filter(path=>path.includes('/walls/discover')).length).toBeGreaterThan(0);
  expect(requests.some(path=>path.includes('/archive/current'))).toBe(false);for(const path of requests.filter(path=>path.includes('/walls/discover'))){const u=new URL(path,'http://fixture');expect(Number(u.searchParams.get('from'))).toBe(from-step);expect(Number(u.searchParams.get('to'))).toBe(to+step);}
  releaseNative();await expect.poll(()=>page.evaluate(id=>(window as any).__terminal?.panels.get(id)?.candles.length??0,id)).toBe(1000);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal?.panels.get(id)?.engine.visibleTimeRange(),id)).toEqual({from:from/1000,to:to/1000});
  expect(requests.some(path=>path.includes('/archive/current'))).toBe(false);
 }finally{releaseNative();}
});
for(const mode of ['footprint','candle-totals'] as const)test(`prepared ${mode} history paints while the authoritative live bootstrap is delayed`,async({page,context})=>{
 test.setTimeout(45000);
 const now=Date.now(),end=Math.floor(now/HOUR)*HOUR,requests:Array<{from:number;to:number}>=[];
 let releaseCurrent!:()=>void;const currentGate=new Promise<void>(resolve=>releaseCurrent=resolve);
 await context.routeWebSocket('**/market-data/v1/stream',socket=>{socket.onMessage(()=>{});});
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),interval=u.searchParams.get('interval')??'1m',step=interval==='1h'?HOUR:interval==='5m'?300000:60000;
  const json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>{const t=Math.floor(now/step)*step-(99-i)*step;return {t,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:t<Math.floor(now/step)*step};})});
  if(u.pathname.endsWith('/footprint-current')){await currentGate;return json({version:1,state:'building'});}
  if(u.pathname.endsWith('/footprints')){
   const from=Number(u.searchParams.get('from')),to=Number(u.searchParams.get('to'));requests.push({from,to});
   const tiles=[];for(let at=from;at<to;at+=step)tiles.push({from:at,revision:1,bar:executionBar(at,step),coverage:{from:at,to:at+step,complete:true,gaps:[]}});
   return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles});
  }
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
 const panel=page.locator('.candle-panel').first();await panel.getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('1h');
 if(mode==='footprint')await setFootprint(panel,true);
 await addIndicator(panel,'Footprint Totals');
 await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintBars.length;})).toBeGreaterThan(2);
 await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.engine.footprintTotalsDiagnostics()[0]?.statsBars??0;})).toBeGreaterThan(2);
 expect(requests.every(request=>request.to-request.from<=4*HOUR)).toBe(true);
 expect(await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintStatus.state;})).toBe('loading');
 await page.screenshot({path:`artifacts/pi-history-r1/${mode}-delayed-live.png`});
 // Restored absolute history demand includes future whitespace without losing closed slots.
 await page.evaluate(({from,to})=>{const p=[...(window as any).__terminal.panels.values()][0] as any;p.engine.restoreHistoryTimeRange({from,to});p.engine.refreshCaptionCurrency();},{from:end-5*HOUR,to:end+3*HOUR});
 await expect.poll(()=>page.evaluate(({from,to})=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintBars.filter((b:any)=>b.time*1000>=from&&b.time*1000<to).length;},{from:end-5*HOUR,to:end})).toBe(5);
 await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return Math.round(p.engine.visibleTimeRange().from*1000);})).toBe(end-5*HOUR);
 await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return Math.round(p.engine.visibleTimeRange().to*1000);})).toBe(end+3*HOUR);
 await page.screenshot({path:`artifacts/pi-history-r1/${mode}-five-closed-hours.png`});
 releaseCurrent();
});

test('a late native candle snapshot cannot move a restored 24h footprint range',async({page,context})=>{
 test.setTimeout(45000);const end=Math.floor(Date.now()/HOUR)*HOUR,from=end-24*HOUR;
 let releaseNative!:()=>void;const nativeGate=new Promise<void>(resolve=>releaseNative=resolve);
 await page.addInitScript(({from,to})=>{
  const id='chart-delayed-native',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 },{from,to:end});
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){await nativeGate;return json({source:'binance-native-kline',candles:Array.from({length:1000},(_,i)=>({t:end-(999-i)*HOUR,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<999}))});}
  if(u.pathname.endsWith('/footprint-current'))return json({version:1,state:'building'});
  if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/');await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-delayed-native');return p?.engine.footprintPaintDiagnostics()?.times.length??0;})).toBe(24);
 const view=()=>page.evaluate(()=>{const p=(window as any).__terminal.panels.get('chart-delayed-native');return p.engine.visibleTimeRange();});
 expect(await view()).toEqual({from:from/1000,to:end/1000});releaseNative();
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-native').candles.length)).toBe(1000);
 expect(await view()).toEqual({from:from/1000,to:end/1000});
 await page.screenshot({path:'artifacts/pi-history-r1/late-native-24h-footprint.png'});
});

for(const future of [false,true])test(future?'a delayed current bootstrap retains five closed bars and future whitespace':'a delayed current bootstrap cannot expand a restored past footprint range',async({page,context})=>{
 const now=Date.now(),current=Math.floor(now/HOUR)*HOUR,end=current-(future?0:24)*HOUR,from=end-(future?5:24)*HOUR,to=future?current+3*HOUR:end;
 let releaseCurrent!:()=>void;const gate=new Promise<void>(resolve=>releaseCurrent=resolve);
 await context.addInitScript(({from,to})=>{const id='chart-delayed-current',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{from,to});
 await context.routeWebSocket('**/market-data/v1/stream',socket=>socket.onMessage(()=>{}));
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:[]});
  if(u.pathname.endsWith('/footprint-current')){await gate;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:current,to:now,confirmedFrom:from,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(current,HOUR)],status:{state:'live',lastUpdate:now}});}
  if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-delayed-current');return p?.engine.footprintPaintDiagnostics()?.times.length??0;})).toBe(future?5:24);
 const view=()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-current').engine.visibleTimeRange());
 expect(await view()).toEqual({from:from/1000,to:to/1000});releaseCurrent();
 await expect.poll(()=>page.evaluate(current=>(window as any).__terminal.panels.get('chart-delayed-current').footprintBars.some((bar:any)=>bar.time===current/1000),current)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-current').engine.footprintPaintDiagnostics()?.times.length??0)).toBe(future?6:24);
 expect(await view()).toEqual({from:from/1000,to:to/1000});
 await page.screenshot({path:`artifacts/pi-history-r1/late-current-${future?'future-whitespace':'24h'}-footprint.png`});
});

test('candle-chart Footprint Totals follows the visible range instead of a saved footprint-only range',async({page,context})=>{
 const end=Math.floor(Date.now()/HOUR)*HOUR;
 await context.addInitScript(({end,HOUR})=>{const id='chart-candle-saved-footprint',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'candle',historyViewport:{from:end-48*HOUR,to:end-24*HOUR},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{end,HOUR});
 await context.routeWebSocket('**/market-data/v1/stream',socket=>socket.onMessage(()=>{}));
 await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:end-(99-i)*HOUR,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});
  if(u.pathname.endsWith('/footprint-current'))return json({version:1,state:'building'});
  if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.get('chart-candle-saved-footprint')?.candles.length===100);
 await addIndicator(page.locator('.candle-panel').first(),'Footprint Totals');
 await page.evaluate(({from,to})=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.restoreHistoryTimeRange({from,to}),{from:end-5*HOUR,to:end});
 await expect.poll(()=>page.evaluate(({end,HOUR})=>{const p=(window as any).__terminal.panels.get('chart-candle-saved-footprint');return p.footprintBars.filter((bar:any)=>bar.time*1000>=end-5*HOUR&&bar.time*1000<end).length;},{end,HOUR})).toBe(5);
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.footprintTotalsDiagnostics()[0]?.statsBars??0)).toBeGreaterThanOrEqual(5);
 await page.screenshot({path:'artifacts/pi-history-r1/candle-totals-saved-footprint-range.png'});
});

test('failed live Totals exposes scoped Retry while healthy native candles and closed history remain',async({page,context})=>{
 const now=Date.now(),current=Math.floor(now/HOUR)*HOUR;let nativeRequests=0,retries=0;
 await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),step=u.searchParams.get('interval')==='1h'?HOUR:300000,json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:Math.floor(now/step)*step-(99-i)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});}
  if(u.pathname.endsWith('/footprint-current')){if(u.searchParams.get('retry')!=='1'&&!retries)return json({version:1,state:'unavailable',error:'Retained current job failed',job:{failed:true,retryable:true}});if(u.searchParams.get('retry')==='1')retries++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:current,to:now,confirmedFrom:current-24*HOUR,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(current,HOUR)],status:{state:'live',lastUpdate:now}});}
  if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/step},(_,i)=>({from:a+i*step,revision:1,bar:executionBar(a+i*step,step),coverage:{from:a+i*step,to:a+(i+1)*step,complete:true,gaps:[]}}))});}
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
 const panel=page.locator('.candle-panel').first();await panel.getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('1h');await addIndicator(panel,'Footprint Totals');
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('failed');
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].status.state)).toBe('live');
 const before=nativeRequests;await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Retry market data',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('live');
 expect(retries).toBe(1);expect(nativeRequests).toBe(before);
 // This fixture retains only99closed native bars for a202slotview. Its honest
 // partial status keeps Retry after Totals has recovered; the next click is
 // scoped to native history and must not restart the healthy Totals job.
 await expect(panel).toContainText('Native prices partial');
 await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toBeVisible();
 const nativeSockets=()=>page.workers()[0].evaluate(()=>(globalThis as any).__stagingNativeFixture.sockets.flatMap((s:any,i:number)=>s.command?.interval==='1h'&&s.readyState===1?[i]:[]));
 const sockets=await nativeSockets();
 await panel.getByRole('button',{name:'Retry market data',exact:true}).click();
 await expect.poll(()=>nativeRequests).toBe(before+1);expect(retries).toBe(1);
 expect(await nativeSockets()).toEqual(sockets);
 expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
});

for(const historyBars of [3,1000])test(`native candles paint before ${historyBars}-bar history and history Retry preserves live state`,async({page,context})=>{
 test.setTimeout(45000);const now=Date.now(),step=60000,current=Math.floor(now/step)*step;let historyRequests=0,viewportRequests=0,socketCount=0;
 // This lifecycle fixture intentionally has one forming candle and no rollover.
 // Pin both realms so a slow run crossing a minute cannot invent an absent closed slot.
 await context.addInitScript(fixed=>{Date.now=()=>fixed;},now);
 let releaseHistory!:()=>void;const historyGate=new Promise<void>(resolve=>releaseHistory=resolve);
 let releaseRecovery!:()=>void;const recoveryGate=new Promise<void>(resolve=>releaseRecovery=resolve);
 await page.exposeFunction('iqNativeHistoryRecovery',()=>releaseRecovery());
 page.on('console',message=>{if(message.text()==='iq-native-regression-socket')socketCount++;});
 await context.addInitScript(()=>{
  const id='chart-native-independent',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 });
 await context.route('**/assets/worker-*.js',async route=>{
  const response=await route.fetch(),script=await response.text();if(!script.includes('Invalid durable execution batch'))throw Error('Expected staging feed worker');
  const transport=`Date.now=()=>${now};globalThis.WebSocket=class {
   readyState=0;timer;onopen;onmessage;onclose;onerror;
   constructor(){setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});},0);}
   send(wire){const command=JSON.parse(wire);if(!command.interval)return;console.info('iq-native-regression-socket');const update=()=>{this.onmessage?.({data:JSON.stringify({type:'native-candle',source:'binance-native-kline',interval:command.interval,candle:{t:${current},o:80000,h:80100,l:79900,c:80060,v:8,revision:Date.now(),closed:false}})});this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()}})});};update();this.timer=setInterval(update,250);}
   close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
  };`;
  await route.fulfill({response,body:transport+'\n'+script});
 });
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/native-candles')){
   // This bootstrap fixture has only its advertised3/1000bars. Requests for
   // other native slots are separate, explicit partial source, not bootstrap.
   if(u.searchParams.has('from')){viewportRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:[]})});}
   historyRequests++;if(historyRequests===1){await historyGate;return route.fulfill({status:502,body:'history route unavailable'});}
   await recoveryGate;return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:Array.from({length:historyBars},(_,i)=>current-(historyBars-1-i)*step).map(t=>({t,o:80000,h:80100,l:79900,c:80010,v:1,revision:9999999999999,closed:t<current}))})});
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,cursor:0,watches:[],events:[]})});
 });
 await page.goto('/');
 const read=()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-native-independent');return p?{candles:p.candles,status:p.status,barCount:p.engine.barCount,view:p.engine.visibleTimeRange(),bulk:(window as any).__nativeHistoryApply}:null;});
 await expect.poll(async()=>{const state=await read();return state?.status.state==='live'&&state.barCount===1&&state.candles.at(-1)?.c===80060;}).toBe(true);
 await expect(page.getByText('Candle history loading · 1 bar displayed',{exact:true})).toBeVisible();expect(historyRequests).toBe(1);
 await page.screenshot({path:`artifacts/pi-history-r1/native-current-before-history-${historyBars}.png`});
 let retainedView;
 if(historyBars===1000){
  await page.evaluate(({current,step})=>{
   const p=(window as any).__terminal.panels.get('chart-native-independent'),live=p.candles.at(-1);
   p.candles=Array.from({length:5000},(_,i)=>({...live,t:current-(4999-i)*step,c:80040,v:4,closed:i<4999}));p.candles[p.candles.length-1]=live;
   p.engine.setSnapshot(p.candles,true);p.engine.restoreHistoryTimeRange({from:current-180*step,to:current+2*step});
   const work=(window as any).__nativeHistoryApply={snapshots:0,multiBarPatches:0,snapshotMs:[] as number[]},snapshot=p.engine.setSnapshot.bind(p.engine),patch=p.engine.applyPatch.bind(p.engine);
   p.engine.setSnapshot=(...args:any[])=>{const start=performance.now();try{return snapshot(...args);}finally{work.snapshots++;work.snapshotMs.push(performance.now()-start);}};
   p.engine.applyPatch=(bars:any[])=>{if(bars.length>1)work.multiBarPatches++;return patch(bars);};
  },{current,step});retainedView=(await read())?.view;
 }
 // Keep the simulated failure present until explicit Retry. Native history's
 // legitimate background retry can otherwise recover before Playwright clicks
 // on a loaded Pi, correctly removing the action while its locator is waiting.
 await page.evaluate(()=>{const feed=(window as any).__terminal.feed,retry=feed.retry.bind(feed);feed.retry=(id:string)=>{void (window as any).iqNativeHistoryRecovery();return retry(id);};});
 releaseHistory();await expect(page.getByText(/Candle history incomplete · Staging history HTTP 502/)).toBeVisible();
 expect((await read())?.status.state).toBe('live');await page.getByRole('button',{name:'Retry market data',exact:true}).click();
 await expect.poll(async()=>{const state=await read();return state?.status.nativeHistory?.state==='ready'&&state.barCount===(historyBars===1000?5000:3);}).toBe(true);
 if(historyBars===1000){expect((await read())?.view).toEqual(retainedView);expect((await read())?.candles[0].c).toBe(80040);expect((await read())?.candles[4000].c).toBe(80010);expect((await read())?.bulk).toMatchObject({snapshots:1,multiBarPatches:0});}
 expect((await read())?.candles.at(-1)?.c).toBe(80060);expect(socketCount).toBe(1);expect(historyRequests).toBe(2);expect(viewportRequests).toBeLessThanOrEqual(1);
 await expect(page.getByText(/Candle history incomplete/)).toHaveCount(0);
 await page.screenshot({path:`artifacts/pi-history-r1/native-history-recovered-live-retained-${historyBars}.png`});
});

test('saved footprint reads start before the delayed UI bundle and hand off one worker',async({page,context})=>{
 test.setTimeout(45000);const now=Date.now(),end=Math.floor(now/HOUR)*HOUR,from=end-24*HOUR;
 let releaseMain!:()=>void,mainBlocked=false,currentRequests=0,nativeRequests=0,workers=0;const mainGate=new Promise<void>(resolve=>releaseMain=resolve),ranges:Array<{from:number;to:number}>=[];
 page.on('worker',()=>workers++);
 await context.addInitScript(({from,to})=>{
  const id='chart-early-ui',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));localStorage.setItem('basis.theme.v1','dark');
 },{from,to:end});
 await context.route('**/assets/main-*.js',async route=>{mainBlocked=true;await mainGate;await route.continue();});
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:[{t:end,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:false}]});}
  if(u.pathname.endsWith('/footprint-current')){currentRequests++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:end,to:now,confirmedFrom:from,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(end,HOUR)],status:{state:'live',lastUpdate:Date.now()}});}
  if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));ranges.push({from:a,to:b});return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>mainBlocked&&currentRequests>0&&nativeRequests>0&&ranges.length>=6).toBe(true);
  expect(await page.evaluate(()=>Boolean((window as any).__terminal))).toBe(false);await expect(page.locator('#startup-splash')).toBeVisible();expect(workers).toBe(1);
  expect(ranges.every(r=>r.to-r.from<=4*HOUR)).toBe(true);releaseMain();
  await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-early-ui');return p?.engine.footprintPaintDiagnostics()?.times.filter((t:number)=>t*1000>=p.selection.historyViewport.from&&t*1000<p.selection.historyViewport.to).length??0;})).toBe(24);
  await expect(page.locator('#startup-splash')).toBeHidden();expect(workers).toBe(1);expect(currentRequests).toBe(1);expect(nativeRequests).toBe(1);
  const view=await page.evaluate(()=>(window as any).__terminal.panels.get('chart-early-ui').engine.visibleTimeRange());expect(view).toEqual({from:from/1000,to:end/1000});
  await page.screenshot({path:'artifacts/pi-history-r1/early-ui-saved-24h.png'});
 }finally{releaseMain();}
});

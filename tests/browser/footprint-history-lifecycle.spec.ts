import {test,expect,type BrowserContext} from '@playwright/test';
import {addIndicator,setFootprint} from './indicator-actions';
const HOUR=3600000;
function executionBar(time:number,step:number){return {time:time/1000,revision:1,rowSize:25,cells:[{price:80000,bidVol:3,askVol:5,bidNotional:240000,askNotional:400000}],open:80000,high:80025,low:79975,close:80010,delta:2,minDelta:0,maxDelta:2,quoteDelta:160000,minQuoteDelta:0,maxQuoteDelta:160000,aggregateRecordCount:2,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false};}

async function installHealthyStagingWorker(context:BrowserContext){
 // The feed owns WebSockets inside a dedicated worker. Install this explicit
 // deterministic transport in the worker bundle, so the unrelated native feed
 // stays healthy even when no staging tunnel exists. Page socket routes do not
 // establish that precondition for the worker.
 await context.route('**/assets/worker-*.js',async route=>{
  const response=await route.fetch();const script=await response.text();
  if(!script.includes('Invalid durable execution batch'))return route.fulfill({response});
  const transport=`globalThis.WebSocket=class {
   static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
   readyState=0;timer;onopen;onmessage;onclose;onerror;
   constructor(){setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});},0);}
   send(wire){const command=JSON.parse(wire),steps={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};const health=()=>{if(command.interval){const step=steps[command.interval];this.onmessage?.({data:JSON.stringify({type:'native-candle',source:'binance-native-kline',interval:command.interval,candle:{t:Math.floor(Date.now()/step)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:Date.now(),closed:false}})});}this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()},watermark:{id:1}})});};health();clearInterval(this.timer);this.timer=setInterval(health,500);}
   close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
  };`;
  await route.fulfill({response,body:transport+'\n'+script});
 });
}
test.beforeEach(async({context})=>installHealthyStagingWorker(context));
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
 expect(retries).toBe(1);expect(nativeRequests).toBe(before);await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
});

for(const historyBars of [3,1000])test(`native candles paint before ${historyBars}-bar history and history Retry preserves live state`,async({page,context})=>{
 test.setTimeout(45000);const now=Date.now(),step=60000,current=Math.floor(now/step)*step;let historyRequests=0,socketCount=0;
 let releaseHistory!:()=>void;const historyGate=new Promise<void>(resolve=>releaseHistory=resolve);
 page.on('console',message=>{if(message.text()==='iq-native-regression-socket')socketCount++;});
 await context.addInitScript(()=>{
  const id='chart-native-independent',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 });
 await context.route('**/assets/worker-*.js',async route=>{
  const response=await route.fetch(),script=await response.text();if(!script.includes('Invalid durable execution batch'))throw Error('Expected staging feed worker');
  const transport=`globalThis.WebSocket=class {
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
   historyRequests++;if(historyRequests===1){await historyGate;return route.fulfill({status:502,body:'history route unavailable'});}
   return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:Array.from({length:historyBars},(_,i)=>current-(historyBars-1-i)*step).map(t=>({t,o:80000,h:80100,l:79900,c:80010,v:1,revision:9999999999999,closed:t<current}))})});
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
   p.engine.setSnapshot(p.candles,true);p.engine.restoreHistoryTimeRange({from:(current-180*step)/1000,to:(current+2*step)/1000});
   const work=(window as any).__nativeHistoryApply={snapshots:0,multiBarPatches:0,snapshotMs:[] as number[]},snapshot=p.engine.setSnapshot.bind(p.engine),patch=p.engine.applyPatch.bind(p.engine);
   p.engine.setSnapshot=(...args:any[])=>{const start=performance.now();try{return snapshot(...args);}finally{work.snapshots++;work.snapshotMs.push(performance.now()-start);}};
   p.engine.applyPatch=(bars:any[])=>{if(bars.length>1)work.multiBarPatches++;return patch(bars);};
  },{current,step});retainedView=(await read())?.view;
 }
 releaseHistory();await expect(page.getByText(/Candle history incomplete · Staging history HTTP 502/)).toBeVisible();
 expect((await read())?.status.state).toBe('live');await page.getByRole('button',{name:'Retry market data',exact:true}).click();
 await expect.poll(async()=>{const state=await read();return state?.status.nativeHistory?.state==='ready'&&state.barCount===(historyBars===1000?5000:3);}).toBe(true);
 if(historyBars===1000){expect((await read())?.view).toEqual(retainedView);expect((await read())?.candles[0].c).toBe(80040);expect((await read())?.candles[4000].c).toBe(80010);expect((await read())?.bulk).toMatchObject({snapshots:1,multiBarPatches:0});}
 expect((await read())?.candles.at(-1)?.c).toBe(80060);expect(socketCount).toBe(1);expect(historyRequests).toBe(2);
 await expect(page.getByText(/Candle history incomplete/)).toHaveCount(0);
 await page.screenshot({path:`artifacts/pi-history-r1/native-history-recovered-live-retained-${historyBars}.png`});
});

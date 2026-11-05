import {test,expect} from '@playwright/test';
import {addIndicator,setFootprint} from './indicator-actions';
const HOUR=3600000;
function executionBar(time:number,step:number){return {time:time/1000,revision:1,rowSize:25,cells:[{price:80000,bidVol:3,askVol:5,bidNotional:240000,askNotional:400000}],open:80000,high:80025,low:79975,close:80010,delta:2,minDelta:0,maxDelta:2,quoteDelta:160000,minQuoteDelta:0,maxQuoteDelta:160000,aggregateRecordCount:2,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false};}
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
 expect(await view()).toEqual({from:from/1000,to:to/1000});
 await page.screenshot({path:`artifacts/pi-history-r1/late-current-${future?'future-whitespace':'24h'}-footprint.png`});
});

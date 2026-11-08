import {test,expect,type BrowserContext} from '@playwright/test';
import {installHealthyStagingWorker} from './staging-worker-fixture';
// Saved absolute candle ranges belong to visible wall history; plain candles intentionally restore at the current tail.
const STEP=300000,HOUR=3600000,id='chart-native-context';
const bar=(t:number,price=80040,closed=true)=>({t,o:80000,h:80050,l:79990,c:price,v:2,quoteVolume:price*2,revision:1,closed});
async function saved(context:BrowserContext,from:number,to:number,interval='5m'){
 await context.addInitScript(({from,to,id,interval})=>{
  const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'spot',interval,type:'candle',historyViewport:{from,to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,aggregation:'native',searchRangePercent:10,showHistory:true}}]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 },{from,to,id,interval});
}
test('native30hpricecontext paints before bootstrap and retains current volume and newer historical reads',async({page,context})=>{
 test.setTimeout(45000);await installHealthyStagingWorker(context,false);
 const now=Date.now(),current=Math.floor(now/STEP)*STEP,to=current-72*HOUR,from=to-30*HOUR;await saved(context,from,to);
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),requests:string[]=[];
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){
   requests.push(u.pathname+u.search);
   if(u.searchParams.has('from'))return json({source:'binance-native-kline',market:'spot',instrument:'BTCUSDT',candles:Array.from({length:1000},(_,i)=>bar(Number(u.searchParams.get('from'))+i*STEP))});
   await gate;return json({source:'binance-native-kline',market:'spot',instrument:'BTCUSDT',candles:Array.from({length:1000},(_,i)=>({...bar(current-(999-i)*STEP,80010,i<999),revision:9999999999999,v:1}))});
  }
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(({id,from,to})=>{const p=(window as any).__terminal?.panels.get(id);return p?.candles.filter((c:any)=>c.t>=from&&c.t<to).length??0;},{id,from,to})).toBe(360);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.visibleTimeRange(),id)).toEqual({from:from/1000,to:to/1000});
  const pre=await page.evaluate(({id,from})=>{const p=(window as any).__terminal.panels.get(id);return {status:p.status,first:p.candles.find((c:any)=>c.t===from)};},{id,from});
  expect(pre.status.nativeHistory).toMatchObject({state:'loading',viewport:{state:'ready',loadedSlots:360,requestedSlots:360}});expect(pre.first).toMatchObject({c:80040,quoteVolume:160080});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.screenshot({path:'artifacts/pi-history-r1/native-visible-r1/native30h-before-bootstrap.png'});
  await page.workers()[0].evaluate(()=>{(globalThis as any).__stagingNativeFixture.emitCandles=true;});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).status.state,id)).toBe('live');
  release();await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).status.nativeHistory.state,id)).toBe('ready');
  const after=await page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id);return {history:p.candles.filter((c:any)=>c.t>=from&&c.t<to),last:p.candles.at(-1),view:p.engine.visibleTimeRange(),status:p.status};},{id,from,to});
  expect(after.history).toHaveLength(360);expect(after.history.every((c:any)=>c.c===80040&&c.quoteVolume===160080)).toBe(true);expect(after.last.v).toBe(8);
  expect(after.view).toEqual({from:from/1000,to:to/1000});expect(after.status.state).toBe('live');expect(after.status.nativeHistory.viewport).toMatchObject({state:'ready',loadedSlots:360});
  expect(requests.filter(u=>u.includes('from='))).toHaveLength(1);
  await expect(page.locator('.candle-panel').first()).toContainText('Native prices loaded · 360/360 closed bars');
 }finally{release();}
});
test('nativepricepan preserves the requested past and current bars within the5000barbudget',async({page,context})=>{
 test.setTimeout(60000);await installHealthyStagingWorker(context);
 const STEP=60000; //4998bars fit the existing seven-day saved-range bound at1m.
 const current=Math.floor(Date.now()/STEP)*STEP,to=current-8*86400000,from=to-4998*STEP;await saved(context,from,to,'1m');
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.endsWith('/native-candles')){
   const start=u.searchParams.has('from')?Number(u.searchParams.get('from')):current-999*STEP;
   return json({source:'binance-native-kline',market:'spot',instrument:'BTCUSDT',candles:Array.from({length:1000},(_,i)=>bar(start+i*STEP,80040,start+i*STEP+STEP<=current))});
  }
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect.poll(()=>page.evaluate(id=>(window as any).__terminal?.panels.get(id)?.status.nativeHistory?.viewport?.loadedSlots??0,id),{timeout:30000}).toBe(4998);
 const old=await page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id);return {count:p.candles.length,visible:p.candles.filter((c:any)=>c.t>=from&&c.t<to).length,versions:p.nativeCandleVersions.size()};},{id,from,to});
 expect(old.count).toBe(5000);expect(old.visible).toBe(4998);expect(old.versions).toBeGreaterThanOrEqual(4998);expect(old.versions).toBeLessThanOrEqual(5000);
 await page.locator('.chart-stage').first().click({position:{x:400,y:200}});
 const nextFrom=from-10*86400000,nextTo=nextFrom+6*HOUR;
 await page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id),d=p.engine.chart.dataLayer;p.engine.setRange({from:d.timeToIndexFloat(from/1000),to:d.timeToIndexFloat(to/1000)});},{id,from:nextFrom,to:nextTo});
 await expect.poll(()=>page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id);return p.candles.filter((c:any)=>c.t>=from&&c.t<to).length;},{id,from:nextFrom,to:nextTo}),{timeout:15000}).toBe(360);
 const next=await page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id);return {count:p.candles.length,latest:p.candles.at(-1),versions:p.nativeCandleVersions.size(),visible:p.engine.visibleTimeRange(),history:p.status.nativeHistory.viewport};},{id,from:nextFrom,to:nextTo});
 expect(next.count).toBe(5000);expect(next.versions).toBeLessThanOrEqual(5000);expect(next.latest.t).toBeGreaterThanOrEqual(current);expect(next.history).toMatchObject({state:'ready',loadedSlots:360,requestedSlots:360,capacityLimited:false});
 expect(next.visible).toEqual({from:nextFrom/1000,to:nextTo/1000});
});

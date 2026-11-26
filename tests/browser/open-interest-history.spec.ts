import {test,expect} from '@playwright/test';
import {installHealthyStagingWorker} from './staging-worker-fixture';
import {oiHistoryWire} from '../helpers/oi-history-wire';
import type {OiHistoryRange} from '../../src/feed/raw-open-interest-history';
const HOUR=3600000,STEP=60000,id='chart-oi-history';
test.use({storageState:{cookies:[],origins:[]}});
test('explicit staging transport loads OI history through the real worker and reuses it across navigation',async({page,context})=>{
 test.skip(process.env.IQ_TEST_OI_HISTORY!=='1','Requires the explicit VITE_OI_HISTORY=1 staging diagnostics build');test.setTimeout(60000);
 await installHealthyStagingWorker(context);const now=Math.floor(Date.now()/STEP)*STEP,start=now-16*HOUR,shard=Math.floor((now-12*HOUR)/(4*HOUR))*4*HOUR,target={from:shard+HOUR,to:shard+2*HOUR};
 await context.addInitScript(id=>{
  const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[],indicators:[{instanceId:'oi-history',definitionId:'native.raw-open-interest',settingsVersion:1,visible:true,source:{kind:'chart'},placement:'pane',settings:{venues:['binance','hyperliquid','bybit'],hidden:[],paneWeight:.28}}]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 },id);
 const calls:OiHistoryRange[]=[];let offline=false;
 const observations=(r:OiHistoryRange)=>r.venues.flatMap((venue,vi)=>Array.from({length:Math.min(480,Math.floor((r.to-r.from)/30000))},(_,i)=>({venue,market:'perpetual',nativeSymbol:venue==='hyperliquid'?'BTC':'BTCUSDT',sourceTimeMs:r.from+i*30000+1000,observedAtMs:Date.now()-1,epoch:0,value:(vi+1)*100,valueDecimal:((vi+1)*100).toFixed(8),units:'BTC',source:'explicit-staging-history-fixture',sourceTimeQuality:'exchange-event',quality:'valid',gapBefore:i===0})));
 await context.route('**/market-data/**',async route=>{
  const url=new URL(route.request().url()),json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(url.pathname.endsWith('/native-candles')){const step=url.searchParams.get('interval')==='5m'?5*STEP:STEP,base=Math.floor(start/step)*step;return json({source:'binance-native-kline',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',candles:Array.from({length:Math.floor(16*HOUR/step)},(_,i)=>({t:base+i*step,o:80000,h:80050,l:79950,c:80010,v:1,quoteVolume:80010,revision:1,closed:true}))});}
  if(url.pathname.endsWith('/raw-open-interest')){
   const r:OiHistoryRange={from:Number(url.searchParams.get('from')),to:Number(url.searchParams.get('to')),venues:url.searchParams.get('venues')!.split(',') as any};
   if(url.pathname.includes('/v2/')){calls.push(r);if(offline)return json({error:'Explicit test origin outage'},503);return json({...oiHistoryWire(r,Date.now()),observations:observations(r)});}
   return json({version:1,market:'perpetual',nativeSymbol:'BTC',semantics:'observed-open-interest-level',units:'BTC',...r,asOfMs:Date.now(),observations:observations(r),truncated:false,invalidRows:0,expectedIntervalMs:30000,retentionDays:7,feeds:{},unitVerification:Object.fromEntries(r.venues.map(v=>[v,{status:'verified',units:'BTC',evidence:'Explicit browser fixture contract'}])),history:'Explicit deterministic staging transport.'});
  }
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect.poll(()=>page.evaluate(id=>(window as any).__terminal?.panels.get(id)?.openInterestData?.diagnostics().subscribed,id)).toBe(true);
 await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).candles.length,id)).toBeGreaterThan(900);
 const navigate=async(from:number,to:number)=>page.evaluate(({id,from,to})=>{const p=(window as any).__terminal.panels.get(id),a=p.candles.findIndex((c:any)=>c.t>=from),b=p.candles.findIndex((c:any)=>c.t>=to);p.engine.setRange({from:a,to:b});p.updateOpenInterestHistoryViewport();},{id,from,to});
 await navigate(target.from,target.to);
 await expect.poll(()=>page.evaluate(({id,target})=>{const p=(window as any).__terminal.panels.get(id);return p.openInterestData.history.observations(['binance'],target.from,target.to).length;},{id,target})).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).openInterestData.diagnostics().historyCoverage.length,id)).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(({id,target})=>(window as any).__terminal.panels.get(id).openInterestData.viewFrame().lines.get('binance').points.some((p:any)=>p.time>=target.from&&p.time<target.to&&p.value!==null),{id,target})).toBe(true);
 await page.evaluate(()=>(window as any).__terminal.feed.send({type:'diagnostics'}));
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.feed.diagnostics.rawOpenInterestHistory?.active)).toBe(false);
 const workerRequests=await page.evaluate(()=>(window as any).__terminal.feed.diagnostics.rawOpenInterestHistory.requests);
 const targetCalls=()=>calls.filter(r=>r.from===shard);expect(targetCalls()).toHaveLength(1);
 const before=await page.evaluate(({id,target})=>{const p=(window as any).__terminal.panels.get(id);return p.openInterestData.history.observations(['binance'],target.from,target.to).map((r:any)=>[r.sourceTimeMs,r.valueDecimal,r.epoch]);},{id,target});
 offline=true;await navigate(now-HOUR,now);await navigate(target.from,target.to);
 await expect.poll(()=>page.evaluate(({id,target})=>{const p=(window as any).__terminal.panels.get(id);return p.openInterestData.history.observations(['binance'],target.from,target.to).length;},{id,target})).toBe(before.length);
 expect(targetCalls()).toHaveLength(1);
 await page.evaluate(()=>(window as any).__terminal.feed.send({type:'diagnostics'}));
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.feed.diagnostics.rawOpenInterestHistory.requests)).toBe(workerRequests);
 expect(await page.evaluate(({id,target})=>{const p=(window as any).__terminal.panels.get(id);return p.openInterestData.history.observations(['binance'],target.from,target.to).map((r:any)=>[r.sourceTimeMs,r.valueDecimal,r.epoch]);},{id,target})).toEqual(before);
 await page.locator('.candle-panel').first().getByLabel('Timeframe',{exact:true}).selectOption('5m',{timeout:5000});
 await expect.poll(()=>page.evaluate(id=>{const p=(window as any).__terminal.panels.get(id);return p.openInterestData.series.interval==='5m'&&p.candles.length>100&&p.candles[1].t-p.candles[0].t===5*60000;},id)).toBe(true);
 await navigate(target.from,target.to);
 await expect.poll(()=>page.evaluate(({id,target})=>(window as any).__terminal.panels.get(id).openInterestData.viewFrame().lines.get('binance').points.some((p:any)=>p.time>=target.from&&p.time<target.to&&p.value!==null),{id,target})).toBe(true);
 expect(targetCalls()).toHaveLength(1);
 expect(await page.evaluate(({id,target})=>(window as any).__terminal.panels.get(id).openInterestData.history.observations(['binance'],target.from,target.to).map((r:any)=>[r.sourceTimeMs,r.valueDecimal,r.epoch]),{id,target})).toEqual(before);
 expect(errors).toEqual([]);
});

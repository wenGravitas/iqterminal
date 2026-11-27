import {test,expect} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
for(const count of [4,1,0])test(`production worker preserves archive presentation across ${count}/4 native revalidation and reopen`,async({page,context})=>{
 test.setTimeout(30000);const from=Date.UTC(2026,0,1),to=from+240000,H='a'.repeat(64);let warm=0,native=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await context.route('**/__native-archive-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit native archive fixture</title>'}));
 await context.route('**/src/feed/worker.ts',async route=>{const response=await route.fetch();await route.fulfill({response,body:`globalThis.WebSocket=class {static OPEN=1;static CONNECTING=0;readyState=0;send(){}close(){this.readyState=3}};\n`+await response.text()});});
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(value:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  if(u.pathname==='/market-data/v2/history/native-candles'){
   warm++;expect(Number(u.searchParams.get('from'))).toBe(from);expect(Number(u.searchParams.get('to'))).toBe(to);
   return json({version:1,kind:'archived-native-kline-observations-v1',scope:{venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',interval:'1m'},from,to,stepMs:60000,bars:Array.from({length:4},(_,i)=>({timeMs:from+i*60000,closeTimeMs:from+(i+1)*60000-1,open:'80000',high:'80010',low:'79990',close:'80001',baseVolume:'2',quoteVolume:'160000',trades:'18446744073709551615',takerBuyBaseVolume:'1',takerBuyQuoteVolume:'80000'})),coverage:{state:'complete',missing:[]},publications:[{id:H,revision:H,observedAtMs:to}],publicationSnapshot:{kind:'iq-archive-publication-asof-v1',checkpoint:H,generation:1,catalogueHead:{version:1,origin:H,authority:H,sequence:1,hash:H,partitions:1,rawBytes:1,proofs:0,proofBytes:0},frontier:{source:'18a5dd2ab0375e452c782bf6e6109420251a28e7b07c2574c586114ae3e99352',state:'unavailable',reason:'no-independent-frontier-v1'},assurance:{sourceAuthorityVerified:false,currentReconciled:false,retirementAuthorized:false,nativeActivationAuthorized:false}},nativeExchangeCandles:true,sourceAuthorityVerified:false,currentReconciled:false,financialAccepted:false,retirementAuthorized:false,partial:false});
  }
  if(u.pathname==='/market-data/v1/native-candles'){
   if(!u.searchParams.has('from'))return json({source:'binance-native-kline',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',candles:[]});
   native++;await gate;return json({source:'binance-native-kline',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',candles:Array.from({length:count},(_,i)=>({t:from+i*60000,o:80000,h:80010,l:79990,c:80002,v:3,revision:2,closed:true}))});
  }
  return json({});
 });
 await page.goto('/__native-archive-fixture');const handle=await page.evaluateHandle(({from,to})=>{
  const worker=new Worker('/src/feed/worker.ts',{type:'module'}),events:any[]=[];worker.onmessage=e=>events.push(e.data);worker.postMessage({type:'subscribe',id:'archive',series:{venue:'binance',market:'perpetual',interval:'1m'}});worker.postMessage({type:'candle-viewport',id:'archive',from,to,known:[]});return {worker,events};
 },{from,to});
 try{
  await expect.poll(()=>handle.evaluate(h=>h.events.filter((e:any)=>e.type==='snapshot'&&e.nativeVersion?.request===0).flatMap((e:any)=>e.candles).length)).toBe(4);
  expect(await handle.evaluate(h=>h.events.filter((e:any)=>e.type==='snapshot'&&e.nativeVersion?.request===0).flatMap((e:any)=>e.candles).every((c:any)=>c.c===80001))).toBe(true);
  expect(warm).toBe(1);await expect.poll(()=>native).toBe(1);release();
  if(count)await expect.poll(()=>handle.evaluate(h=>h.events.filter((e:any)=>e.type==='snapshot'&&e.nativeVersion?.request>0).flatMap((e:any)=>e.candles).filter((c:any)=>c.c===80002).length)).toBe(count);
  await expect.poll(()=>handle.evaluate(h=>h.events.filter((e:any)=>e.type==='status'&&e.status.nativeHistory?.viewport).at(-1)?.status.nativeHistory.viewport.state)).toBe(count===4?'ready':'partial');
  expect(warm).toBe(1);
  await handle.evaluate((h,{from,to})=>{h.worker.postMessage({type:'unsubscribe',id:'archive'});h.worker.postMessage({type:'subscribe',id:'reopened',series:{venue:'binance',market:'perpetual',interval:'1m'}});h.worker.postMessage({type:'candle-viewport',id:'reopened',from,to,known:[]});},{from,to});
  await expect.poll(()=>handle.evaluate(h=>h.events.filter((e:any)=>e.type==='snapshot'&&e.ids?.includes('reopened')&&e.nativeVersion?.request===0).flatMap((e:any)=>e.candles).map((c:any)=>c.c))).toEqual(Array.from({length:4},(_,i)=>i<count?80002:80001));
  await expect.poll(()=>native).toBe(2);await expect.poll(()=>handle.evaluate(h=>h.events.filter((e:any)=>e.type==='status'&&e.ids?.includes('reopened')&&e.status.nativeHistory?.viewport).at(-1)?.status.nativeHistory.viewport.state)).toBe(count===4?'ready':'partial');expect(warm).toBe(1);
 }finally{release();await handle.evaluate(h=>h.worker.terminate());await handle.dispose();}
});

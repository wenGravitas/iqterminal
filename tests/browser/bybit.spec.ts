import { test,expect } from '@playwright/test';
import { installTradeFixture } from './trade-fixture';
import { addIndicator } from './indicator-actions';
test('Bybit ticker selections, execution labels, CVD membership and persistence',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1600,height:1000});const worker=await installTradeFixture(page);
 await page.getByRole('button',{name:'Close Hyperliquid · BTC Perp · 1m',exact:true}).click();
 const objectClose=page.locator('.candle-panel').first().locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});if(await objectClose.isVisible())await objectClose.click();
 await worker.evaluate(()=>{
  const Original=self.WebSocket,probe:any=(self as any).__bybitFixture={active:0,socket:null};
  class Socket{readyState=0;onopen:any;onmessage:any;onerror:any;onclose:any;constructor(){probe.socket=this;probe.active++;setTimeout(()=>{this.readyState=1;this.onopen?.();},10);}send(){}close(){if(this.readyState===3)return;this.readyState=3;probe.active--;this.onclose?.();}}
  self.WebSocket=new Proxy(Original,{construct(target,args){return String(args[0]).includes('stream.bybit.com/v5/public/linear')?new Socket():Reflect.construct(target,args);}}) as any;
  probe.emit=()=>{const now=Date.now();probe.socket.onmessage?.({data:JSON.stringify({topic:'publicTrade.BTCUSDT',type:'snapshot',ts:now,data:[{s:'BTCUSDT',i:'bybit-fixture-one',T:now,S:'Sell',p:'80000.10',v:'1.25'}]})});};
 });
 await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
 await ticker.getByRole('button',{name:'Ticker markets',exact:true}).click();const picker=ticker.locator('.market-picker').first();
 await picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true}).uncheck();await picker.getByRole('checkbox',{name:'Bybit · BTCUSDT Perp',exact:true}).check();await picker.getByRole('button',{name:'Apply',exact:true}).click();
 await expect.poll(()=>worker.evaluate(()=>(self as any).__bybitFixture.socket?.readyState)).toBe(1);await worker.evaluate(()=>(self as any).__bybitFixture.emit());
 const row=ticker.locator('.ticker-row').first();await expect(row).toContainText('Bybit');await expect(row).toHaveAttribute('data-execution-id','bybit:perpetual:BTCUSDT:trade:bybit-fixture-one');await expect(row).toHaveAttribute('aria-label',/Bybit perpetual sell execution/);
 const chart=page.locator('.candle-panel').first();await addIndicator(chart,'Multi-Venue CVD');const pane=chart.locator('[data-cvd=true]');
 await pane.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();const cvdPicker=chart.getByRole('dialog',{name:'Select markets'});
 await cvdPicker.getByRole('checkbox',{name:'Bybit · BTCUSDT Perp',exact:true}).check();await cvdPicker.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(pane).toContainText('BY[P] BTCUSDT');await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].cvdView.diagnostics().sources.length)).toBe(3);
 await expect.poll(()=>page.evaluate(()=>{const layout=JSON.parse(localStorage.getItem('basis.layout.v1')!);return JSON.stringify(layout).includes('bybit:perpetual');})).toBe(true);
 await page.screenshot({path:'/tmp/bybit-ticker-cvd.png'});expect(errors).toEqual([]);
 await page.reload();await expect(page.locator('[data-cvd=true]')).toContainText('BY[P] BTCUSDT');
});
test('Bybit net longs and shorts use the third independent venue and retain recorded data',async({page})=>{
 test.setTimeout(90000);const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const now=Math.floor(Date.now()/60000)*60000;
 await page.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/native-candles'))return route.fulfill({json:{source:'binance-native-kline',candles:Array.from({length:500},(_,i)=>({t:now-(499-i)*60000,o:80000,h:80010,l:79990,c:80001,v:10,revision:1,closed:i<499}))}});
  if(!u.pathname.endsWith('/net-positioning'))return route.fulfill({json:{version:1,collector:{state:'live'},executions:[],coverage:{from:now-4*3600000,to:now,confirmedFrom:now-4*3600000,confirmedTo:now,complete:true,gaps:[]},watermark:0,cursor:0,tickSize:.1}});
  const venues=u.searchParams.get('venues')!.split(','),method=u.searchParams.get('method');requests.push(venues.join(','));
  const intervals=venues.flatMap(venue=>Array.from({length:30},(_,i)=>{const end=now-i*60000;return {version:1,method,status:'available',venue,market:'perpetual',nativeSymbol:venue==='hyperliquid'?'BTC':'BTCUSDT',units:'BTC',startTimeMs:end-30000,endTimeMs:end,attributionTimeMs:end,resolutionMs:30000,direction:1,oiDeltaBtcDecimal:'2',netLongsBtcDecimal:'2',netShortsBtcDecimal:'0',unclassifiedBtcDecimal:'0',qualityFlags:[],provenance:{priceStart:{price:80000},priceEnd:{price:80001}}};}));
  const units={status:'verified',units:'BTC',evidence:'Explicit Bybit browser fixture'};
  return route.fulfill({json:{version:1,method,venues,market:'perpetual',nativeSymbol:'BTC',units:'BTC',from:Number(u.searchParams.get('from')),to:Number(u.searchParams.get('to')),intervals,unitVerification:Object.fromEntries(venues.map(v=>[v,units])),feeds:Object.fromEntries(venues.map(v=>[v,{state:'live',lastObservedAt:Date.now(),stale:false,unitVerification:units}])),pendingIntervals:0,truncated:false}});
 });
 await page.goto('/');const chart=page.locator('.candle-panel').first();await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars)).toBeGreaterThan(0);
 const close=chart.locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});if(await close.isVisible())await close.click();
 for(const side of ['Longs','Shorts']){
  await addIndicator(chart,`Net ${side} — Estimated`);const sources=chart.getByRole('group',{name:`Net ${side} sources`,exact:true});
  const bybit=sources.getByRole('button',{name:'Show Bybit BTCUSDT Perpetual',exact:true});await expect(bybit).toHaveAttribute('aria-pressed','false');await bybit.click();await expect(bybit).toHaveAttribute('aria-pressed','true');
  await sources.locator('[data-source="hyperliquid"]').click();
 }
 await expect.poll(()=>requests.some(v=>v.split(',').sort().join(',')==='binance,bybit,hyperliquid')).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].netPositioning.panes.every((p:any)=>p.venues.includes('bybit')&&p.candleCount>0))).toBe(true);
 await page.screenshot({path:'/tmp/bybit-net-positioning.png'});expect(errors).toEqual([]);
 await page.setViewportSize({width:720,height:860});
 for(const side of ['Longs','Shorts'])await expect.poll(()=>chart.getByRole('group',{name:`Net ${side} sources`,exact:true}).evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.screenshot({path:'/tmp/bybit-net-positioning-narrow.png'});
 await page.reload();await expect(chart.getByRole('group',{name:'Net Longs sources',exact:true}).locator('[data-source="bybit"]')).toHaveAttribute('aria-pressed','true');
});

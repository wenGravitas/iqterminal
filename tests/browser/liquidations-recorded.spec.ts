import {test,expect}from '@playwright/test';
import {addIndicator}from './indicator-actions';
test('isolated persisted liquidation fixtures reach the real worker, ticker and chart over HTTP/WS',async({page})=>{
 test.skip(process.env.IQ_LIQUIDATION_RECORDED_TEST!=='1','Requires explicit isolated backend fixture service');test.setTimeout(120000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5174/');
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars??0),{timeout:60000}).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Liquidations',exact:true}).click();const ticker=page.locator('.liquidation-ticker');await expect.poll(()=>ticker.locator('[data-event-id]').count(),{timeout:30000}).toBeGreaterThan(0);
 const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Liquidations');const diag=()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].liquidationsView?.diagnostics());await expect.poll(async()=>(await diag())?.painted??0,{timeout:30000}).toBeGreaterThan(0);
 const before=(await diag()).batch.revision;await expect.poll(async()=>(await diag()).batch.revision,{timeout:15000}).toBeGreaterThan(before);
 await expect.poll(()=>page.evaluate(()=>{const t=(window as any).__terminal;t.feed.send({type:'diagnostics'});return t.feed.diagnostics.liquidations?.sockets;})).toBe(1);
 const data=await diag();expect(data.batch.coverage.head).toBeGreaterThanOrEqual(4);expect(data.batch.events.some((e:any)=>e.venue==='bybit')).toBe(true);expect(data.batch.events.some((e:any)=>e.venue==='binance')).toBe(true);expect(errors).toEqual([]);
 await page.screenshot({path:'/tmp/liquidations-recorded-integration.png'});console.log(JSON.stringify({kind:'isolated-persisted-fixtures-not-real-exchange-events',sourceCount:data.batch.coverage.sources.length,events:data.batch.events.length,painted:data.painted,head:data.batch.coverage.head,revision:data.batch.revision,errors}));
});

import {test,expect} from '@playwright/test';
import {topLevelsFixture} from '../fixtures/top-levels-depth';
import {addIndicator,chooseChartMarket,setFootprint} from './indicator-actions';
for(const theme of ['dark','light'])test(`Top Levels Spot 5m has stable episodes, clear styles and persistent controls (${theme})`,async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>localStorage.setItem('basis.theme.v1',theme),theme);
 await page.setViewportSize({width:1600,height:1000});await page.goto('/?fixture=1&fixtureTime=now');
 await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars>0));
 const id=await page.locator('.candle-panel').first().getAttribute('data-panel-id');
 await page.evaluate(id=>{const t=(window as any).__terminal;for(const p of [...t.dock.panels])if(p.id!==id)t.dock.removePanel(p);t.feed.subscribeOrderWalls=(_id:string,request:any,callback:any)=>{(window as any).__topRequest=request;(window as any).__topCallback=callback;return()=>{};};},id);
 const panel=page.locator(`.candle-panel[data-panel-id="${id}"]`);
 await chooseChartMarket(panel,'Binance · BTCUSDT Spot');await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');
 await page.waitForFunction(()=>(window as any).__terminal.stats().panels[0]?.bars>0);
 await addIndicator(panel,'Order Walls');
 const input=await page.evaluate(id=>{const p=(window as any).__terminal.panels.get(id),bar=p.engine.latestCandle();return {center:Math.round(bar.close/100)*100,to:bar.time*1000};},id);
 const fixture=topLevelsFixture(input.center,input.to,'spot');
 await page.evaluate(({id,fixture})=>{const p=(window as any).__terminal.panels.get(id),engine=p.engine;engine.setOrderWalls(fixture.settings,300000);(window as any).__topCallback({kind:'snapshot',segments:fixture.segments,status:fixture.status});
  const base=engine.chart.dataLayer.baseIndex;engine.setRange({from:base-48,to:base+2});engine.chart.setAutoScale(false);engine.chart.panes()[0].priceScale.setPriceRange({min:fixture.center-510,max:fixture.center+510});
 },{id,fixture:{...fixture,rows:undefined,center:input.center}});
 await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics().visible,id)).toBeGreaterThan(16);
 expect(await page.evaluate(()=>(window as any).__topRequest)).toMatchObject({market:'binance-spot',settings:{mode:'top-levels',topLevels:8,aggregation:'native',highContrast:true,visibleRangeOnly:true}});
 await panel.getByRole('button',{name:'Order Walls settings',exact:true}).click();const dialog=panel.locator('.order-walls-settings');
 await expect(dialog.getByLabel('Detection mode',{exact:true})).toHaveValue('top-levels');
 await expect(dialog.getByLabel('High Contrast',{exact:true})).toBeChecked();await expect(dialog.getByLabel('Visible Range Only',{exact:true})).toBeChecked();
 await expect(dialog.getByLabel('Price aggregation',{exact:true})).toHaveValue('native');expect(await dialog.locator('details').evaluate(e=>(e as HTMLDetailsElement).open)).toBe(false);
 await dialog.getByLabel('Price lines and size tags (active walls)',{exact:true}).check();expect(await dialog.locator('form').evaluate(e=>(e as HTMLFormElement).checkValidity())).toBe(true);await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog).toBeHidden();
 const ids=await page.evaluate(id=>[...(window as any).__terminal.panels.get(id).engine.orderWallSegments.keys()],id);
 await page.evaluate(id=>{const e=(window as any).__terminal.panels.get(id).engine,r=e.visibleRange();e.setRange({from:r.from+2,to:r.to-5});e.chart.panes()[0].priceScale.setPriceRange({min:83000,max:85000});},id);
 expect(await page.evaluate(id=>[...(window as any).__terminal.panels.get(id).engine.orderWallSegments.keys()],id)).toEqual(ids);
 await page.evaluate(({id,center})=>{const e=(window as any).__terminal.panels.get(id).engine,base=e.chart.dataLayer.baseIndex;e.setRange({from:base-48,to:base+2});e.chart.panes()[0].priceScale.setPriceRange({min:center-510,max:center+510});},{id,center:input.center});
 await page.screenshot({path:`artifacts/order-walls/top-levels-spot-5m-${theme}.png`});
 if(theme==='dark'){
  await page.evaluate(({center,to})=>{(window as any).__terminal.feed.subscribeFootprint=(_id:string,_series:any,rowSize:number,callback:any)=>{
   const bars=Array.from({length:40},(_,j)=>({time:to/1000-(39-j)*300,rowSize,revision:1,open:center,high:center+150,low:center-150,close:center+5,delta:1,minDelta:-1,maxDelta:2,quoteDelta:center,minQuoteDelta:-center,maxQuoteDelta:2*center,coverage:'partial',gapBefore:false,
    cells:Array.from({length:13},(_,i)=>({price:center-150+i*25,bidVol:1+(i+j)%5,askVol:1+(i+j+2)%7,bidNotional:(center-150+i*25)*(1+(i+j)%5),askNotional:(center-150+i*25)*(1+(i+j+2)%7)}))}));
   queueMicrotask(()=>callback({type:'footprint-snapshot',bars,retentionStart:bars[0].time,status:{state:'live',message:'Explicit synthetic Spot footprint',lastUpdate:Date.now(),collectionStartedAt:Date.now(),coverage:'partial',tickSize:.01,rowSize}}));return()=>{};
  };},{center:input.center,to:input.to});
  await setFootprint(panel,true);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.surfaceMounted,id)).toBe(true);
  expect(await page.evaluate(id=>[...(window as any).__terminal.panels.get(id).engine.orderWallSegments.keys()],id)).toEqual(ids);
  await page.screenshot({path:'artifacts/order-walls/top-levels-spot-5m-footprint.png'});
  await setFootprint(panel,false);
 }
 const diagnostics=await page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics(),id);
 console.log(JSON.stringify({kind:'realistic-synthetic-depth-not-live',theme,market:'binance-spot',timeframe:'5m',episodes:fixture.segments.length,active:fixture.segments.filter(s=>s.end===null).length,diagnostics}));
 await page.reload();await page.waitForFunction(()=>(window as any).__terminal?.panels.size===1);
 expect(await page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().series.indicators.find((i:any)=>i.definitionId==='native.order-walls').settings,id)).toMatchObject({mode:'top-levels',topLevels:8,aggregation:'native',highContrast:true,visibleRangeOnly:true,showPriceLines:true});
 expect(errors).toEqual([]);
});

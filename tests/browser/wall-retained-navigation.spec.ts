import {test,expect} from '@playwright/test';
import {addIndicator,chooseChartMarket} from './indicator-actions';
import {twoChartWorkspaceState} from './workspace-state';

test.use({storageState:async({baseURL},use)=>use(twoChartWorkspaceState(baseURL!))});
test('retained GPU component preserves exact source, mapped positions, styles, hover and disposal',async({page})=>{
 await page.goto('/tests/browser/fixtures/wall-navigation.html');
 const result=await page.evaluate(()=>(window as any).checkWallGpuCorrectness());
 expect(result.results).toHaveLength(32);expect(result.resources).toMatchObject({contexts:0,owners:0,bufferBytes:0});
});

for(const market of ['spot','perpetual'] as const)test(`compiled ${market} 30h chart keeps walls throughout camera gestures`,async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.drawImage;
  (window as any).__wallFrames={active:false,frames:[]};
  CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,image:any,...args:any[]){
   const probe=(window as any).__wallFrames;
   if(probe.active&&image?.dataset?.iqWallLayer==='retained'){
    const gl=image.getContext('webgl2'),pixels=new Uint8Array(image.width*image.height*4);gl.readPixels(0,0,image.width,image.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let nonempty=0;for(let at=3;at<pixels.length;at+=4)if(pixels[at])nonempty++;
    probe.frames.push({at:performance.now(),nonempty,width:image.width,height:image.height});
   }
   return (original as any).call(this,image,...args);
  } as any;
 });
 await page.goto('/?fixture=1&fixtureTime=now');await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars>1000));
 const id=await page.locator('.candle-panel').first().getAttribute('data-panel-id'),panel=page.locator(`.candle-panel[data-panel-id="${id}"]`);
 await page.evaluate(id=>{const t=(window as any).__terminal;for(const p of [...t.dock.panels])if(p.id!==id)t.dock.removePanel(p);
  (window as any).__wallReplay={subscribes:0,viewports:0};t.feed.subscribeOrderWalls=(_id:string,_request:any,callback:any)=>{(window as any).__wallReplay.subscribes++;(window as any).__wallReplay.callback=callback;return()=>{};};
  t.feed.updateOrderWallsViewport=()=>{(window as any).__wallReplay.viewports++;};
 },id);
 await chooseChartMarket(panel,market==='spot'?'Binance · BTCUSDT Spot':'Binance · BTCUSDT USD-M Perp');
 const interval=market==='spot'?300000:900000;await panel.getByLabel('Timeframe',{exact:true}).selectOption(market==='spot'?'5m':'15m');
 await page.waitForFunction(()=>(window as any).__terminal.stats().panels[0]?.bars>1000);await addIndicator(panel,'Order Walls');
 const input=await page.evaluate(({id,interval})=>{
  const p=(window as any).__terminal.panels.get(id),e=p.engine,base=e.chart.dataLayer.baseIndex,center=Math.round(e.latestCandle().close/100)*100;
  const to=e.chart.dataLayer.indexToTimeFloat(base-1)*1000,from=to-30*3600000,segments=[];
  for(let hour=0;hour<60;hour++)for(let level=0;level<16;level++){
   if(hour===20)continue;const start=from+hour*1800000,price=center+(level<8?-1:1)*(100+(level%8)*25);
   segments.push({id:`resident-${hour}-${level}`,archiveEntryId:`entry-${hour}-${level}`,epoch:1,side:level<8?'bid':'ask',price,start,end:start+1700000,peakUsd:1000000,meanUsd:500000,durationMs:1700000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'rank-exit',detectionMode:'top-levels',rank:level%8+1,valueRunsTruncated:false,valueRuns:Array.from({length:8},(_,i)=>({at:start+i*200000,usd:price*(1+(i+level)%8),quantity:1+(i+level)%8,rank:level%8+1,percentile:null}))});
  }
  const status={state:'live',tickSize:interval===300000?.01:.1,currentSubscribed:true,lastConfirmedAt:to,archive:{profileId:'explicit-retained-replay',from,to,eligibleTo:to,confirmedTo:to-1,loadedThrough:to-1,requestComplete:true,rangeComplete:true,exact:true,state:'partial',requestedTopN:8,requestedBandPercent:10,profileBandPercent:10,gaps:[{from:from+20*1800000,to:from+21*1800000,reason:'Explicit fixture source gap'}]}};
  (window as any).__wallReplay.callback({kind:'snapshot',segments,status});
  const range={from:base-1-30*3600000/interval,to:base+1};e.setRange(range);e.chart.setAutoScale(false);e.chart.panes()[0].priceScale.setPriceRange({min:center-400,max:center+400});
  return {range,center,from,to,segments:segments.length};
 },{id,interval});
 await expect.poll(()=>page.evaluate(id=>{const d=(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics();return d.retainedRenderer?.active&&!d.pendingPaintWork&&d.visibleHistorical>0;},id)).toBe(true);
 const before=await page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics().retainedRenderer,id);
 await page.evaluate(()=>{(window as any).__wallFrames.active=true;});
 // Real chart APIs exercise the same camera transforms at each RAF, while the
 // original saved history callback is deliberately never replayed.
 await page.evaluate(async({id,input})=>{
  const e=(window as any).__terminal.panels.get(id).engine;
  for(let i=0;i<36;i++){const shift=Math.sin(i/4)*3,zoom=1+.12*Math.sin(i/6),width=(input.range.to-input.range.from)*zoom;
   e.setRange({from:input.range.to-width+shift,to:input.range.to+shift});e.chart.panes()[0].priceScale.setPriceRange({min:input.center-380+25*Math.sin(i/5),max:input.center+380+25*Math.sin(i/5)});
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  }
 },{id,input});
 const stage=await panel.locator('.chart-stage').boundingBox();expect(stage).not.toBeNull();
 await page.mouse.move(stage!.x+stage!.width*.55,stage!.y+stage!.height*.5);await page.mouse.down();await page.mouse.move(stage!.x+stage!.width*.6,stage!.y+stage!.height*.52,{steps:12});await page.mouse.up();
 await page.setViewportSize({width:1150,height:760});await page.waitForTimeout(150);
 await page.evaluate(({id,input})=>{const e=(window as any).__terminal.panels.get(id).engine;e.setRange(input.range);e.chart.panes()[0].priceScale.setPriceRange({min:input.center-400,max:input.center+400});},{id,input});
 await page.waitForTimeout(150);
 const result=await page.evaluate(id=>{const p=(window as any).__terminal.panels.get(id);(window as any).__wallFrames.active=false;return {frames:(window as any).__wallFrames.frames,renderer:p.engine.orderWallsDiagnostics().retainedRenderer,replay:{subscribes:(window as any).__wallReplay.subscribes,viewports:(window as any).__wallReplay.viewports}};},id);
 expect(result.frames.length).toBeGreaterThanOrEqual(36);expect(result.frames.every((frame:any)=>frame.nonempty>0)).toBe(true);
 expect(result.renderer.builds).toBe(before.builds);expect(result.renderer.bufferUploads).toBe(before.bufferUploads);expect(result.renderer.mappingInvalidations).toBe(before.mappingInvalidations);expect(result.replay.subscribes).toBe(1);
 expect(errors).toEqual([]);console.log(JSON.stringify({kind:'compiled-controlled-render-replay-not-live',market,interval,input,before,result}));
});

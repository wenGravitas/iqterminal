import {test,expect} from '@playwright/test';
import {addIndicator,chooseChartMarket} from './indicator-actions';
import {twoChartWorkspaceState} from './workspace-state';

test.use({storageState:async({baseURL},use)=>use(twoChartWorkspaceState(baseURL!))});
test('retained GPU component preserves exact source, mapped positions, styles, hover and disposal',async({page})=>{
 await page.goto('/tests/browser/fixtures/wall-navigation.html');
 const result=await page.evaluate(()=>(window as any).checkWallGpuCorrectness());
 expect(result.results).toHaveLength(32);expect(result.resources).toMatchObject({contexts:0,owners:0,bufferBytes:0});
});

test('eight charts share bounded resources and release them through reopen and current updates',async({page})=>{
 await page.goto('/tests/browser/fixtures/wall-navigation.html');
 const result=await page.evaluate(()=>(window as any).checkWallResourceLifecycle());
 expect(result.samples).toHaveLength(4);console.log(JSON.stringify({kind:'controlled-resource-lifecycle',...result}));
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
  const status={state:'live',tickSize:interval===300000?.01:.1,currentSubscribed:true,lastConfirmedAt:to,archive:{profileId:'explicit-retained-replay',from,to,eligibleTo:to,confirmedTo:to-1,loadedThrough:to-1,requestComplete:true,rangeComplete:false,exact:true,state:'partial',requestedTopN:8,requestedBandPercent:10,profileBandPercent:10,gaps:[{from:from+20*1800000,to:from+21*1800000,reason:'Explicit fixture source gap'}]}};
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

test('compiled chart retains overlap while its real archive adapter fetches only missing intervals',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?fixture=1&fixtureTime=now');await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars>1000));
 const id=await page.locator('.candle-panel').first().getAttribute('data-panel-id'),panel=page.locator(`.candle-panel[data-panel-id="${id}"]`);
 await chooseChartMarket(panel,'Binance · BTCUSDT USD-M Perp');await panel.getByLabel('Timeframe',{exact:true}).selectOption('15m');await page.waitForFunction(()=>(window as any).__terminal.stats().panels[0]?.bars>1000);
 await page.evaluate(async id=>{
  const t=(window as any).__terminal;for(const p of [...t.dock.panels])if(p.id!==id)t.dock.removePanel(p);
  const iframe=document.createElement('iframe');iframe.hidden=true;iframe.src='/tests/browser/fixtures/wall-navigation.html';document.body.append(iframe);await new Promise<void>(resolve=>iframe.onload=()=>resolve());
  const e=t.panels.get(id).engine,base=e.chart.dataLayer.baseIndex,center=Math.round(e.latestCandle().close/100)*100;
  const range={from:base-122,to:base-2};e.setRange(range);e.chart.setAutoScale(false);e.chart.panes()[0].priceScale.setPriceRange({min:center-400,max:center+400});
  const probe:any={reads:[],events:[],current:[],range,center,held:[],hold:false};(window as any).__residentProbe=probe;
  const profile={id:'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',feed:'binance:perpetual:BTCUSDT:usd-m-standard-diff-depth-rpi-excluded',version:1,venue:'binance',aggregation:'native',bandPercent:10,midpointBasis:'best-observed-bid-ask',topN:10,algorithmVersion:1,schemaVersion:1,confirmationMs:0,selectionTopN:10,minimumNotionalUsd:null,exactDerivations:{bandPercent:[10],topNMax:10,minimumNotional:true,confirmation:true,confirmationCrossings:false}};
  const fetcher=async(input:any,init:any)=>{
   const url=new URL(String(input),location.origin);if(url.pathname.endsWith('/current')){
    const after=Number(url.searchParams.get('after')),cursor=after?after+1:100,at=Date.now();probe.current.push({after,cursor,at});probe.currentStart??=at;
    const candidate={entryId:'current-probe',side:'bid',price:String(center-100),quantity:String(cursor),notional:String((center-100)*cursor),rank:1,startedAt:probe.currentStart,startCursor:100,startEpoch:1,startKnown:true};
    return new Response(JSON.stringify({version:1,profile,market:profile.market,instrument:profile.instrument,feed:profile.feed,watermark:cursor,head:{cursor,at,epoch:1,valid:true,midpoint:String(center)},...(after?{}:{state:{bids:[candidate],asks:[]}}),page:{after,nextAfter:cursor,hasMore:false,lastAt:at,limit:256,sameMillisecondClosed:true},patches:after?[{kind:'patch',cursor,at,epoch:1,midpoint:String(center),bids:{upserts:[candidate],removals:[]},asks:{upserts:[],removals:[]}}]:[],coverage:{availableFrom:at-86400000,confirmedTo:at,status:'complete',gaps:[]},profileStatus:'ready'}));
   }
   const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));probe.reads.push({from,to});
   if(probe.hold)await new Promise<void>(resolve=>probe.held.push(resolve));
   const bids:any[]=[],asks:any[]=[];for(let side=0;side<2;side++)for(let i=0;i<8;i++){const price=center+(side?1:-1)*(100+25*i),candidate={entryId:`real-adapter-${side}-${i}`,side:side?'ask':'bid',price:String(price),quantity:'2.00000000',notional:String(price*2),rank:i+1,startedAt:from-100000,startCursor:0,startEpoch:1,startKnown:true};(side?asks:bids).push(candidate);}
   return new Response(JSON.stringify({version:1,profile,market:profile.market,instrument:profile.instrument,feed:profile.feed,from,to,watermark:20,head:{cursor:20,at:to-1,epoch:1},seed:{at:from,cursor:0,epoch:1,midpoint:String(center),bids,asks,bookScope:{bidComplete:true,askComplete:true}},page:{after:0,nextAfter:20,hasMore:false,lastAt:to-1,limit:256,sameMillisecondClosed:true},patches:[],coverage:{availableFrom:from-86400000,requestedFrom:from,requestedTo:to,confirmedTo:to-1,gaps:[],partial:false,status:'complete',bookScope:{bidComplete:true,askComplete:true}}}));
  };
  const callbacks=new Map();const service=(iframe.contentWindow as any).createResidentWallService((event:any)=>{probe.events.push({kind:event.kind,count:event.segments?.length,patches:event.patches?.length,status:event.status});callbacks.get(event.ids[0])?.(event);},fetcher,Date.now);probe.service=service;
  t.feed.subscribeOrderWalls=(key:string,request:any,callback:any)=>{callbacks.set(key,callback);service.subscribe(key,{...request,followLive:true});return()=>{callbacks.delete(key);service.unsubscribe(key);};};
  t.feed.updateOrderWallsViewport=(key:string,from:number,to:number)=>service.updateViewport(key,from,to,false);
  t.feed.updateOrderWalls=(key:string,settings:any)=>service.updateSettings(key,settings);
 },id);
 await addIndicator(panel,'Order Walls');await expect.poll(()=>page.evaluate(id=>{const d=(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics();return d.retainedRenderer?.active&&!d.pendingPaintWork&&d.visibleHistorical>0;},id)).toBe(true);
 const initial=await page.evaluate(id=>({reads:(window as any).__residentProbe.reads.slice(),renderer:(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics().retainedRenderer}),id);expect(initial.reads).toHaveLength(1);
 // Delay only the missing interval, not existing history or the current lane.
 await page.evaluate(id=>{const p=(window as any).__residentProbe;p.hold=true;const e=(window as any).__terminal.panels.get(id).engine;e.setRange({from:p.range.from-12,to:p.range.to-12});},id);
 await expect.poll(()=>page.evaluate(()=>(window as any).__residentProbe.reads.length)).toBe(2);
 const pending=await page.evaluate(id=>{const p=(window as any).__residentProbe,d=(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics();return {renderer:d.retainedRenderer,reads:p.reads.slice(),status:p.events.at(-1).status,empty:p.events.slice(1).some((e:any)=>e.kind==='snapshot'&&e.count===0),current:p.current.slice()};},id);
 expect(pending.renderer.visibleHistorical).toBeGreaterThan(0);expect(pending.renderer.historyBuilds).toBe(initial.renderer.historyBuilds);expect(pending.empty).toBe(false);expect(pending.current.filter((sample:any)=>sample.after===0)).toHaveLength(1);expect(pending.reads[1].to).toBe(initial.reads[0].from);
 await expect.poll(()=>page.evaluate(()=>(window as any).__residentProbe.current.length)).toBeGreaterThanOrEqual(pending.current.length+1);
 const advancing=await page.evaluate(id=>{const p=(window as any).__residentProbe;return {current:p.current.slice(),status:p.events.at(-1).status,renderer:(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics().retainedRenderer};},id);
 expect(advancing.status.state).toBe('live');expect(advancing.renderer.historyBuilds).toBe(initial.renderer.historyBuilds);expect(advancing.current.at(-1).after).toBe(advancing.current.at(-2).cursor);
 await page.evaluate(()=>{const p=(window as any).__residentProbe;p.hold=false;for(const resolve of p.held.splice(0))resolve();});
 await expect.poll(()=>page.evaluate(id=>{const p=(window as any).__residentProbe,d=(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics();return p.events.at(-1).status.archive.unloadedRanges?.length===0&&!d.pendingPaintWork;},id)).toBe(true);
 await page.evaluate(id=>{const p=(window as any).__residentProbe;(window as any).__terminal.panels.get(id).engine.setRange(p.range);},id);await page.waitForTimeout(300);
 const final=await page.evaluate(id=>{const p=(window as any).__residentProbe,d=(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics();return {reads:p.reads,diagnostics:p.service.diagnostics().resident,renderer:d.retainedRenderer,status:p.events.at(-1).status};},id);
 expect(final.reads).toHaveLength(2);expect(final.renderer.visibleHistorical).toBeGreaterThan(0);expect(errors).toEqual([]);console.log(JSON.stringify({kind:'compiled-real-adapter-controlled-source-not-live',initial,pending,advancing,final}));
 await page.evaluate(()=>(window as any).__residentProbe.service.dispose());
});

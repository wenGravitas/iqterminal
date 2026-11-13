# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: footprint-history-lifecycle.spec.ts >> native candles paint before 1000-bar history and history Retry preserves live state
- Location: tests/browser/footprint-history-lifecycle.spec.ts:153:35

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    2
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - main "Chart workspace" [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e14]:
          - region "Binance · BTCUSDT USD-M Perp · 1m" [ref=e21]:
            - tablist [ref=e24]:
              - tab "Binance · BTCUSDT USD-M Perp · 1m" [selected] [ref=e25] [cursor=pointer]:
                - generic "Binance · BTCUSDT USD-M Perp · 1m · Alt+1" [ref=e26]:
                  - generic [ref=e27]:
                    - generic [aria-hidden] [ref=e28]: "1"
                    - generic [ref=e30]: BTCUSDT
                    - generic [aria-hidden] [ref=e31]: P
                  - button "Close Binance · BTCUSDT USD-M Perp · 1m" [ref=e32]
            - tabpanel "Binance · BTCUSDT USD-M Perp · 1m" [ref=e36]
          - status [ref=e37]
          - alert [ref=e38]
        - generic [ref=e40]:
          - generic [ref=e42]:
            - button "Chart market" [ref=e43] [cursor=pointer]: Binance · BTCUSDT USD-M Perp
            - combobox "Timeframe" [ref=e44] [cursor=pointer]:
              - option "1m" [selected]
              - option "5m"
              - option "15m"
              - option "1h"
              - option "4h"
            - button "Indicators" [ref=e45] [cursor=pointer]
            - button "Chart settings" [ref=e46] [cursor=pointer]
            - button "Latest" [ref=e49] [cursor=pointer]
            - button "Camera actions" [ref=e52] [cursor=pointer]
            - generic [ref=e56]: USDT quote · BTC volume · USDT settlement · UTC
            - button "Watch level" [ref=e57] [cursor=pointer]
            - group "Main chart controls" [ref=e58]:
              - button "Move main pane up" [disabled] [ref=e59]
              - button "Move main pane down" [disabled] [ref=e62]
              - button "Collapse main pane to header only" [disabled] [ref=e65]
              - button "Maximize main pane" [disabled] [ref=e68]
          - generic [ref=e71]:
            - complementary "Drawing tools and actions" [ref=e72]:
              - group "Drawings" [ref=e73]:
                - button "Select drawings" [pressed] [ref=e74] [cursor=pointer]
                - generic [ref=e78]:
                  - button "Use Trend Line tool" [ref=e79] [cursor=pointer]
                  - button "Open Lines tools" [ref=e82] [cursor=pointer]
                - generic [ref=e85]:
                  - button "Use Rectangle tool" [ref=e86] [cursor=pointer]
                  - button "Open Shapes and Fibonacci tools" [ref=e89] [cursor=pointer]
                - generic [ref=e92]:
                  - button "Use Long Position tool" [ref=e93] [cursor=pointer]
                  - button "Open Position tools" [ref=e97] [cursor=pointer]
                - generic [ref=e100]:
                  - button "Use Text tool" [ref=e101] [cursor=pointer]
                  - button "Open Text tools" [ref=e104] [cursor=pointer]
                - 'button "Anchor snapping: Weak" [pressed] [ref=e108] [cursor=pointer]'
                - button "Undo" [ref=e112] [cursor=pointer]
                - button "Redo" [ref=e115] [cursor=pointer]
                - button "Erase" [ref=e118] [cursor=pointer]
                - button "Toggle floating drawing toolbar" [ref=e121] [cursor=pointer]
                - button "Style" [ref=e125] [cursor=pointer]
                - button "Templates" [ref=e128] [cursor=pointer]
                - status [ref=e131]
            - application "Binance · BTCUSDT USD-M Perp candlestick chart" [ref=e133]:
              - generic [ref=e134]: Financial chart, 5000 bars, latest price 80,060.0
            - complementary "Chart sidebar" [ref=e138]:
              - group "Chart panels" [ref=e139]:
                - button "Open Object Tree" [ref=e140] [cursor=pointer]: "1"
          - status [ref=e145]:
            - generic "Native prices partial · 180/181 closed bars · 11-08 07:25–11-08 10:26 UTC" [ref=e146]
            - button "Retry market data" [ref=e147] [cursor=pointer]: Retry
    - contentinfo "Application status and workspace navigation" [ref=e148]:
      - generic [ref=e149]:
        - generic [ref=e150]: BASIS
        - 'button "Workspace: Main Workspace" [ref=e151] [cursor=pointer]':
          - generic [ref=e154]: Main Workspace
          - generic [aria-hidden] [ref=e155]: ▾
        - navigation "Pinned workspaces"
      - button "Add Widget" [ref=e156] [cursor=pointer]: + Add ▾
      - generic [ref=e157]:
        - button "Hyperliquid trading status" [ref=e158] [cursor=pointer]: HL · disconnected
        - button "Notifications" [ref=e159] [cursor=pointer]
        - generic [ref=e163]:
          - 'button "Connection status: 1 monitored feed live" [ref=e164] [cursor=pointer]':
            - generic [ref=e168]: 1 monitored feed live
          - 'button "Market Pulse · Local · Africa/Nairobi · 2 open: CME BTC, Crypto; 0 unknown · open session timeline" [ref=e169] [cursor=pointer]':
            - generic [ref=e173]: 13:26:11
            - generic [ref=e174]: UTC+03
            - generic [ref=e175]: 2 OPEN
        - button "Application menu" [ref=e180] [cursor=pointer]
      - status [ref=e183]
  - complementary "Notifications"
```

# Test source

```ts
  108 |  await context.addInitScript(({end,HOUR})=>{const id='chart-candle-saved-footprint',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'candle',historyViewport:{from:end-48*HOUR,to:end-24*HOUR},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{end,HOUR});
  109 |  await context.routeWebSocket('**/market-data/v1/stream',socket=>socket.onMessage(()=>{}));
  110 |  await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  111 |   if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:end-(99-i)*HOUR,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});
  112 |   if(u.pathname.endsWith('/footprint-current'))return json({version:1,state:'building'});
  113 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  114 |   return json({version:1,cursor:0,watches:[],events:[]});
  115 |  });
  116 |  await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.get('chart-candle-saved-footprint')?.candles.length===100);
  117 |  await addIndicator(page.locator('.candle-panel').first(),'Footprint Totals');
  118 |  await page.evaluate(({from,to})=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.restoreHistoryTimeRange({from,to}),{from:end-5*HOUR,to:end});
  119 |  await expect.poll(()=>page.evaluate(({end,HOUR})=>{const p=(window as any).__terminal.panels.get('chart-candle-saved-footprint');return p.footprintBars.filter((bar:any)=>bar.time*1000>=end-5*HOUR&&bar.time*1000<end).length;},{end,HOUR})).toBe(5);
  120 |  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.footprintTotalsDiagnostics()[0]?.statsBars??0)).toBeGreaterThanOrEqual(5);
  121 |  await page.screenshot({path:'artifacts/pi-history-r1/candle-totals-saved-footprint-range.png'});
  122 | });
  123 | 
  124 | test('failed live Totals exposes scoped Retry while healthy native candles and closed history remain',async({page,context})=>{
  125 |  const now=Date.now(),current=Math.floor(now/HOUR)*HOUR;let nativeRequests=0,retries=0;
  126 |  await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),step=u.searchParams.get('interval')==='1h'?HOUR:300000,json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  127 |   if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:Math.floor(now/step)*step-(99-i)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});}
  128 |   if(u.pathname.endsWith('/footprint-current')){if(u.searchParams.get('retry')!=='1'&&!retries)return json({version:1,state:'unavailable',error:'Retained current job failed',job:{failed:true,retryable:true}});if(u.searchParams.get('retry')==='1')retries++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:current,to:now,confirmedFrom:current-24*HOUR,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(current,HOUR)],status:{state:'live',lastUpdate:now}});}
  129 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/step},(_,i)=>({from:a+i*step,revision:1,bar:executionBar(a+i*step,step),coverage:{from:a+i*step,to:a+(i+1)*step,complete:true,gaps:[]}}))});}
  130 |   return json({version:1,cursor:0,watches:[],events:[]});
  131 |  });
  132 |  await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
  133 |  const panel=page.locator('.candle-panel').first();await panel.getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('1h');await addIndicator(panel,'Footprint Totals');
  134 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('failed');
  135 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
  136 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].status.state)).toBe('live');
  137 |  const before=nativeRequests;await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Retry market data',exact:true}).click();
  138 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('live');
  139 |  expect(retries).toBe(1);expect(nativeRequests).toBe(before);
  140 |  // This fixture retains only99closed native bars for a202slotview. Its honest
  141 |  // partial status keeps Retry after Totals has recovered; the next click is
  142 |  // scoped to native history and must not restart the healthy Totals job.
  143 |  await expect(panel).toContainText('Native prices partial');
  144 |  await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toBeVisible();
  145 |  const nativeSockets=()=>page.workers()[0].evaluate(()=>(globalThis as any).__stagingNativeFixture.sockets.flatMap((s:any,i:number)=>s.command?.interval==='1h'&&s.readyState===1?[i]:[]));
  146 |  const sockets=await nativeSockets();
  147 |  await panel.getByRole('button',{name:'Retry market data',exact:true}).click();
  148 |  await expect.poll(()=>nativeRequests).toBe(before+1);expect(retries).toBe(1);
  149 |  expect(await nativeSockets()).toEqual(sockets);
  150 |  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
  151 | });
  152 | 
  153 | for(const historyBars of [3,1000])test(`native candles paint before ${historyBars}-bar history and history Retry preserves live state`,async({page,context})=>{
  154 |  test.setTimeout(45000);const now=Date.now(),step=60000,current=Math.floor(now/step)*step;let historyRequests=0,viewportRequests=0,socketCount=0;
  155 |  let releaseHistory!:()=>void;const historyGate=new Promise<void>(resolve=>releaseHistory=resolve);
  156 |  let releaseRecovery!:()=>void;const recoveryGate=new Promise<void>(resolve=>releaseRecovery=resolve);
  157 |  await page.exposeFunction('iqNativeHistoryRecovery',()=>releaseRecovery());
  158 |  page.on('console',message=>{if(message.text()==='iq-native-regression-socket')socketCount++;});
  159 |  await context.addInitScript(()=>{
  160 |   const id='chart-native-independent',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  161 |   localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
  162 |  });
  163 |  await context.route('**/assets/worker-*.js',async route=>{
  164 |   const response=await route.fetch(),script=await response.text();if(!script.includes('Invalid durable execution batch'))throw Error('Expected staging feed worker');
  165 |   const transport=`globalThis.WebSocket=class {
  166 |    readyState=0;timer;onopen;onmessage;onclose;onerror;
  167 |    constructor(){setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});},0);}
  168 |    send(wire){const command=JSON.parse(wire);if(!command.interval)return;console.info('iq-native-regression-socket');const update=()=>{this.onmessage?.({data:JSON.stringify({type:'native-candle',source:'binance-native-kline',interval:command.interval,candle:{t:${current},o:80000,h:80100,l:79900,c:80060,v:8,revision:Date.now(),closed:false}})});this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()}})});};update();this.timer=setInterval(update,250);}
  169 |    close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
  170 |   };`;
  171 |   await route.fulfill({response,body:transport+'\n'+script});
  172 |  });
  173 |  await context.route('**/market-data/**',async route=>{
  174 |   const u=new URL(route.request().url());
  175 |   if(u.pathname.endsWith('/native-candles')){
  176 |    // This bootstrap fixture has only its advertised3/1000bars. Requests for
  177 |    // other native slots are separate, explicit partial source, not bootstrap.
  178 |    if(u.searchParams.has('from')){viewportRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:[]})});}
  179 |    historyRequests++;if(historyRequests===1){await historyGate;return route.fulfill({status:502,body:'history route unavailable'});}
  180 |    await recoveryGate;return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:Array.from({length:historyBars},(_,i)=>current-(historyBars-1-i)*step).map(t=>({t,o:80000,h:80100,l:79900,c:80010,v:1,revision:9999999999999,closed:t<current}))})});
  181 |   }
  182 |   return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,cursor:0,watches:[],events:[]})});
  183 |  });
  184 |  await page.goto('/');
  185 |  const read=()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-native-independent');return p?{candles:p.candles,status:p.status,barCount:p.engine.barCount,view:p.engine.visibleTimeRange(),bulk:(window as any).__nativeHistoryApply}:null;});
  186 |  await expect.poll(async()=>{const state=await read();return state?.status.state==='live'&&state.barCount===1&&state.candles.at(-1)?.c===80060;}).toBe(true);
  187 |  await expect(page.getByText('Candle history loading · 1 bar displayed',{exact:true})).toBeVisible();expect(historyRequests).toBe(1);
  188 |  await page.screenshot({path:`artifacts/pi-history-r1/native-current-before-history-${historyBars}.png`});
  189 |  let retainedView;
  190 |  if(historyBars===1000){
  191 |   await page.evaluate(({current,step})=>{
  192 |    const p=(window as any).__terminal.panels.get('chart-native-independent'),live=p.candles.at(-1);
  193 |    p.candles=Array.from({length:5000},(_,i)=>({...live,t:current-(4999-i)*step,c:80040,v:4,closed:i<4999}));p.candles[p.candles.length-1]=live;
  194 |    p.engine.setSnapshot(p.candles,true);p.engine.restoreHistoryTimeRange({from:current-180*step,to:current+2*step});
  195 |    const work=(window as any).__nativeHistoryApply={snapshots:0,multiBarPatches:0,snapshotMs:[] as number[]},snapshot=p.engine.setSnapshot.bind(p.engine),patch=p.engine.applyPatch.bind(p.engine);
  196 |    p.engine.setSnapshot=(...args:any[])=>{const start=performance.now();try{return snapshot(...args);}finally{work.snapshots++;work.snapshotMs.push(performance.now()-start);}};
  197 |    p.engine.applyPatch=(bars:any[])=>{if(bars.length>1)work.multiBarPatches++;return patch(bars);};
  198 |   },{current,step});retainedView=(await read())?.view;
  199 |  }
  200 |  // Keep the simulated failure present until explicit Retry. Native history's
  201 |  // legitimate background retry can otherwise recover before Playwright clicks
  202 |  // on a loaded Pi, correctly removing the action while its locator is waiting.
  203 |  await page.evaluate(()=>{const feed=(window as any).__terminal.feed,retry=feed.retry.bind(feed);feed.retry=(id:string)=>{void (window as any).iqNativeHistoryRecovery();return retry(id);};});
  204 |  releaseHistory();await expect(page.getByText(/Candle history incomplete · Staging history HTTP 502/)).toBeVisible();
  205 |  expect((await read())?.status.state).toBe('live');await page.getByRole('button',{name:'Retry market data',exact:true}).click();
  206 |  await expect.poll(async()=>{const state=await read();return state?.status.nativeHistory?.state==='ready'&&state.barCount===(historyBars===1000?5000:3);}).toBe(true);
  207 |  if(historyBars===1000){expect((await read())?.view).toEqual(retainedView);expect((await read())?.candles[0].c).toBe(80040);expect((await read())?.candles[4000].c).toBe(80010);expect((await read())?.bulk).toMatchObject({snapshots:1,multiBarPatches:0});}
> 208 |  expect((await read())?.candles.at(-1)?.c).toBe(80060);expect(socketCount).toBe(1);expect(historyRequests).toBe(2);expect(viewportRequests).toBeLessThanOrEqual(1);
      |                                                                                                                                             ^ Error: expect(received).toBeLessThanOrEqual(expected)
  209 |  await expect(page.getByText(/Candle history incomplete/)).toHaveCount(0);
  210 |  await page.screenshot({path:`artifacts/pi-history-r1/native-history-recovered-live-retained-${historyBars}.png`});
  211 | });
  212 | 
  213 | test('saved footprint reads start before the delayed UI bundle and hand off one worker',async({page,context})=>{
  214 |  test.setTimeout(45000);const now=Date.now(),end=Math.floor(now/HOUR)*HOUR,from=end-24*HOUR;
  215 |  let releaseMain!:()=>void,mainBlocked=false,currentRequests=0,nativeRequests=0,workers=0;const mainGate=new Promise<void>(resolve=>releaseMain=resolve),ranges:Array<{from:number;to:number}>=[];
  216 |  page.on('worker',()=>workers++);
  217 |  await context.addInitScript(({from,to})=>{
  218 |   const id='chart-early-ui',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  219 |   localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));localStorage.setItem('basis.theme.v1','dark');
  220 |  },{from,to:end});
  221 |  await context.route('**/assets/main-*.js',async route=>{mainBlocked=true;await mainGate;await route.continue();});
  222 |  await context.route('**/market-data/**',async route=>{
  223 |   const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  224 |   if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:[{t:end,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:false}]});}
  225 |   if(u.pathname.endsWith('/footprint-current')){currentRequests++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:end,to:now,confirmedFrom:from,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(end,HOUR)],status:{state:'live',lastUpdate:Date.now()}});}
  226 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));ranges.push({from:a,to:b});return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  227 |   return json({version:1,cursor:0,watches:[],events:[]});
  228 |  });
  229 |  try{
  230 |   await page.goto('/',{waitUntil:'domcontentloaded'});
  231 |   await expect.poll(()=>mainBlocked&&currentRequests>0&&nativeRequests>0&&ranges.length>=6).toBe(true);
  232 |   expect(await page.evaluate(()=>Boolean((window as any).__terminal))).toBe(false);await expect(page.locator('#startup-splash')).toBeVisible();expect(workers).toBe(1);
  233 |   expect(ranges.every(r=>r.to-r.from<=4*HOUR)).toBe(true);releaseMain();
  234 |   await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-early-ui');return p?.engine.footprintPaintDiagnostics()?.times.filter((t:number)=>t*1000>=p.selection.historyViewport.from&&t*1000<p.selection.historyViewport.to).length??0;})).toBe(24);
  235 |   await expect(page.locator('#startup-splash')).toBeHidden();expect(workers).toBe(1);expect(currentRequests).toBe(1);expect(nativeRequests).toBe(1);
  236 |   const view=await page.evaluate(()=>(window as any).__terminal.panels.get('chart-early-ui').engine.visibleTimeRange());expect(view).toEqual({from:from/1000,to:end/1000});
  237 |   await page.screenshot({path:'artifacts/pi-history-r1/early-ui-saved-24h.png'});
  238 |  }finally{releaseMain();}
  239 | });
  240 | 
```
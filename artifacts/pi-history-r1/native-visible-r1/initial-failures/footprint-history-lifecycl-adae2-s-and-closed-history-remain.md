# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: footprint-history-lifecycle.spec.ts >> failed live Totals exposes scoped Retry while healthy native candles and closed history remain
- Location: tests/browser/footprint-history-lifecycle.spec.ts:123:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "live"
Received: "failed"

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - main "Chart workspace" [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e14]:
          - region "Binance · BTCUSDT USD-M Perp · 1h" [ref=e21]:
            - tablist [ref=e24]:
              - tab "Binance · BTCUSDT USD-M Perp · 1h" [selected] [ref=e25] [cursor=pointer]:
                - generic "Binance · BTCUSDT USD-M Perp · 1h · Alt+1" [ref=e26]:
                  - generic [ref=e27]:
                    - generic [aria-hidden] [ref=e28]: "1"
                    - generic [ref=e30]: BTCUSDT
                    - generic [aria-hidden] [ref=e31]: P
                  - button "Close Binance · BTCUSDT USD-M Perp · 1h" [ref=e32]
            - tabpanel "Binance · BTCUSDT USD-M Perp · 1h" [ref=e36]
          - status [ref=e37]
          - alert [ref=e38]
        - generic [ref=e40]:
          - generic [ref=e42]:
            - button "Chart market" [ref=e43] [cursor=pointer]: Binance · BTCUSDT USD-M Perp
            - combobox "Timeframe" [ref=e44] [cursor=pointer]:
              - option "1m"
              - option "5m"
              - option "15m"
              - option "1h" [selected]
              - option "4h"
            - button "Indicators" [ref=e45] [cursor=pointer]
            - button "Chart settings" [ref=e46] [cursor=pointer]
            - button "Latest" [ref=e49] [cursor=pointer]
            - button "Camera actions" [ref=e52] [cursor=pointer]
            - generic [ref=e56]: USDT quote · BTC volume · USDT settlement · UTC
            - button "Watch level" [ref=e57] [cursor=pointer]
            - group "Main chart controls" [ref=e58]:
              - button "Move main pane up" [disabled] [ref=e59]
              - button "Move main pane down" [ref=e62] [cursor=pointer]
              - button "Collapse main pane to header only" [ref=e65] [cursor=pointer]
              - button "Maximize main pane" [ref=e68] [cursor=pointer]
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
              - generic [ref=e134]: Financial chart, 100 bars, latest price 80,010.0
              - generic:
                - generic:
                  - generic [ref=e138]:
                    - generic "Footprint Totals" [ref=e140]
                    - generic [ref=e141]:
                      - button "Hide Footprint Totals" [pressed] [ref=e142] [cursor=pointer]
                      - button "Footprint Totals settings" [ref=e145] [cursor=pointer]
                      - button "About Footprint Totals" [ref=e148] [cursor=pointer]
                      - button "Remove Footprint Totals" [ref=e151] [cursor=pointer]
                  - group "Pane 2 controls" [ref=e154]:
                    - button "Move pane 2 up" [ref=e155] [cursor=pointer]
                    - button "Move pane 2 down" [disabled] [ref=e158]
                    - button "Collapse pane 2 to header only" [ref=e161] [cursor=pointer]
                    - button "Maximize pane 2" [ref=e164] [cursor=pointer]
            - complementary "Chart sidebar" [ref=e170]:
              - group "Chart panels" [ref=e171]:
                - button "Open Object Tree" [ref=e172] [cursor=pointer]: "2"
          - status [ref=e177]:
            - generic "Live totals unavailable · Native prices partial · 99/202 closed bars · 10-30 18:00–11-08 04:00 UTC · History validated · 202/202 slots · 10-30 18:00–04:00 UTC" [ref=e178]
            - button "Retry market data" [active] [ref=e179] [cursor=pointer]: Retry
    - contentinfo "Application status and workspace navigation" [ref=e180]:
      - generic [ref=e181]:
        - generic [ref=e182]: BASIS
        - 'button "Workspace: Main Workspace" [ref=e183] [cursor=pointer]':
          - generic [ref=e186]: Main Workspace
          - generic [aria-hidden] [ref=e187]: ▾
        - navigation "Pinned workspaces"
      - button "Add Widget" [ref=e188] [cursor=pointer]: + Add ▾
      - generic [ref=e189]:
        - button "Hyperliquid trading status" [ref=e190] [cursor=pointer]: HL · disconnected
        - button "Notifications" [ref=e191] [cursor=pointer]
        - generic [ref=e195]:
          - 'button "Connection status: 1 monitored feed live" [ref=e196] [cursor=pointer]':
            - generic [ref=e200]: 1 monitored feed live
          - 'button "Market Pulse · Local · Africa/Nairobi · 2 open: CME BTC, Crypto; 0 unknown · open session timeline" [ref=e201] [cursor=pointer]':
            - generic [ref=e205]: 07:35:55
            - generic [ref=e206]: UTC+03
            - generic [ref=e207]: 2 OPEN
        - button "Application menu" [ref=e212] [cursor=pointer]
      - status [ref=e215]
  - complementary "Notifications"
```

# Test source

```ts
  37  |    const from=Number(u.searchParams.get('from')),to=Number(u.searchParams.get('to'));requests.push({from,to});
  38  |    const tiles=[];for(let at=from;at<to;at+=step)tiles.push({from:at,revision:1,bar:executionBar(at,step),coverage:{from:at,to:at+step,complete:true,gaps:[]}});
  39  |    return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles});
  40  |   }
  41  |   return json({version:1,cursor:0,watches:[],events:[]});
  42  |  });
  43  |  await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
  44  |  const panel=page.locator('.candle-panel').first();await panel.getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('1h');
  45  |  if(mode==='footprint')await setFootprint(panel,true);
  46  |  await addIndicator(panel,'Footprint Totals');
  47  |  await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintBars.length;})).toBeGreaterThan(2);
  48  |  await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.engine.footprintTotalsDiagnostics()[0]?.statsBars??0;})).toBeGreaterThan(2);
  49  |  expect(requests.every(request=>request.to-request.from<=4*HOUR)).toBe(true);
  50  |  expect(await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintStatus.state;})).toBe('loading');
  51  |  await page.screenshot({path:`artifacts/pi-history-r1/${mode}-delayed-live.png`});
  52  |  // Restored absolute history demand includes future whitespace without losing closed slots.
  53  |  await page.evaluate(({from,to})=>{const p=[...(window as any).__terminal.panels.values()][0] as any;p.engine.restoreHistoryTimeRange({from,to});p.engine.refreshCaptionCurrency();},{from:end-5*HOUR,to:end+3*HOUR});
  54  |  await expect.poll(()=>page.evaluate(({from,to})=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.footprintBars.filter((b:any)=>b.time*1000>=from&&b.time*1000<to).length;},{from:end-5*HOUR,to:end})).toBe(5);
  55  |  await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return Math.round(p.engine.visibleTimeRange().from*1000);})).toBe(end-5*HOUR);
  56  |  await expect.poll(()=>page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return Math.round(p.engine.visibleTimeRange().to*1000);})).toBe(end+3*HOUR);
  57  |  await page.screenshot({path:`artifacts/pi-history-r1/${mode}-five-closed-hours.png`});
  58  |  releaseCurrent();
  59  | });
  60  | 
  61  | test('a late native candle snapshot cannot move a restored 24h footprint range',async({page,context})=>{
  62  |  test.setTimeout(45000);const end=Math.floor(Date.now()/HOUR)*HOUR,from=end-24*HOUR;
  63  |  let releaseNative!:()=>void;const nativeGate=new Promise<void>(resolve=>releaseNative=resolve);
  64  |  await page.addInitScript(({from,to})=>{
  65  |   const id='chart-delayed-native',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  66  |   localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
  67  |  },{from,to:end});
  68  |  await context.route('**/market-data/**',async route=>{
  69  |   const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  70  |   if(u.pathname.endsWith('/native-candles')){await nativeGate;return json({source:'binance-native-kline',candles:Array.from({length:1000},(_,i)=>({t:end-(999-i)*HOUR,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<999}))});}
  71  |   if(u.pathname.endsWith('/footprint-current'))return json({version:1,state:'building'});
  72  |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  73  |   return json({version:1,cursor:0,watches:[],events:[]});
  74  |  });
  75  |  await page.goto('/');await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-delayed-native');return p?.engine.footprintPaintDiagnostics()?.times.length??0;})).toBe(24);
  76  |  const view=()=>page.evaluate(()=>{const p=(window as any).__terminal.panels.get('chart-delayed-native');return p.engine.visibleTimeRange();});
  77  |  expect(await view()).toEqual({from:from/1000,to:end/1000});releaseNative();
  78  |  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-native').candles.length)).toBe(1000);
  79  |  expect(await view()).toEqual({from:from/1000,to:end/1000});
  80  |  await page.screenshot({path:'artifacts/pi-history-r1/late-native-24h-footprint.png'});
  81  | });
  82  | 
  83  | for(const future of [false,true])test(future?'a delayed current bootstrap retains five closed bars and future whitespace':'a delayed current bootstrap cannot expand a restored past footprint range',async({page,context})=>{
  84  |  const now=Date.now(),current=Math.floor(now/HOUR)*HOUR,end=current-(future?0:24)*HOUR,from=end-(future?5:24)*HOUR,to=future?current+3*HOUR:end;
  85  |  let releaseCurrent!:()=>void;const gate=new Promise<void>(resolve=>releaseCurrent=resolve);
  86  |  await context.addInitScript(({from,to})=>{const id='chart-delayed-current',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{from,to});
  87  |  await context.routeWebSocket('**/market-data/v1/stream',socket=>socket.onMessage(()=>{}));
  88  |  await context.route('**/market-data/**',async route=>{
  89  |   const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  90  |   if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:[]});
  91  |   if(u.pathname.endsWith('/footprint-current')){await gate;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:current,to:now,confirmedFrom:from,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(current,HOUR)],status:{state:'live',lastUpdate:now}});}
  92  |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  93  |   return json({version:1,cursor:0,watches:[],events:[]});
  94  |  });
  95  |  await page.goto('/');
  96  |  await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-delayed-current');return p?.engine.footprintPaintDiagnostics()?.times.length??0;})).toBe(future?5:24);
  97  |  const view=()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-current').engine.visibleTimeRange());
  98  |  expect(await view()).toEqual({from:from/1000,to:to/1000});releaseCurrent();
  99  |  await expect.poll(()=>page.evaluate(current=>(window as any).__terminal.panels.get('chart-delayed-current').footprintBars.some((bar:any)=>bar.time===current/1000),current)).toBe(true);
  100 |  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-delayed-current').engine.footprintPaintDiagnostics()?.times.length??0)).toBe(future?6:24);
  101 |  expect(await view()).toEqual({from:from/1000,to:to/1000});
  102 |  await page.screenshot({path:`artifacts/pi-history-r1/late-current-${future?'future-whitespace':'24h'}-footprint.png`});
  103 | });
  104 | 
  105 | test('candle-chart Footprint Totals follows the visible range instead of a saved footprint-only range',async({page,context})=>{
  106 |  const end=Math.floor(Date.now()/HOUR)*HOUR;
  107 |  await context.addInitScript(({end,HOUR})=>{const id='chart-candle-saved-footprint',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'candle',historyViewport:{from:end-48*HOUR,to:end-24*HOUR},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},{end,HOUR});
  108 |  await context.routeWebSocket('**/market-data/v1/stream',socket=>socket.onMessage(()=>{}));
  109 |  await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  110 |   if(u.pathname.endsWith('/native-candles'))return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:end-(99-i)*HOUR,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});
  111 |   if(u.pathname.endsWith('/footprint-current'))return json({version:1,state:'building'});
  112 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  113 |   return json({version:1,cursor:0,watches:[],events:[]});
  114 |  });
  115 |  await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.get('chart-candle-saved-footprint')?.candles.length===100);
  116 |  await addIndicator(page.locator('.candle-panel').first(),'Footprint Totals');
  117 |  await page.evaluate(({from,to})=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.restoreHistoryTimeRange({from,to}),{from:end-5*HOUR,to:end});
  118 |  await expect.poll(()=>page.evaluate(({end,HOUR})=>{const p=(window as any).__terminal.panels.get('chart-candle-saved-footprint');return p.footprintBars.filter((bar:any)=>bar.time*1000>=end-5*HOUR&&bar.time*1000<end).length;},{end,HOUR})).toBe(5);
  119 |  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.get('chart-candle-saved-footprint').engine.footprintTotalsDiagnostics()[0]?.statsBars??0)).toBeGreaterThanOrEqual(5);
  120 |  await page.screenshot({path:'artifacts/pi-history-r1/candle-totals-saved-footprint-range.png'});
  121 | });
  122 | 
  123 | test('failed live Totals exposes scoped Retry while healthy native candles and closed history remain',async({page,context})=>{
  124 |  const now=Date.now(),current=Math.floor(now/HOUR)*HOUR;let nativeRequests=0,retries=0;
  125 |  await context.route('**/market-data/**',route=>{const u=new URL(route.request().url()),step=u.searchParams.get('interval')==='1h'?HOUR:300000,json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  126 |   if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:Array.from({length:100},(_,i)=>({t:Math.floor(now/step)*step-(99-i)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:i<99}))});}
  127 |   if(u.pathname.endsWith('/footprint-current')){if(u.searchParams.get('retry')!=='1'&&!retries)return json({version:1,state:'unavailable',error:'Retained current job failed',job:{failed:true,retryable:true}});if(u.searchParams.get('retry')==='1')retries++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:current,to:now,confirmedFrom:current-24*HOUR,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(current,HOUR)],status:{state:'live',lastUpdate:now}});}
  128 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/step},(_,i)=>({from:a+i*step,revision:1,bar:executionBar(a+i*step,step),coverage:{from:a+i*step,to:a+(i+1)*step,complete:true,gaps:[]}}))});}
  129 |   return json({version:1,cursor:0,watches:[],events:[]});
  130 |  });
  131 |  await page.goto('/');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
  132 |  const panel=page.locator('.candle-panel').first();await panel.getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('1h');await addIndicator(panel,'Footprint Totals');
  133 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('failed');
  134 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
  135 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].status.state)).toBe('live');
  136 |  const before=nativeRequests;await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Retry market data',exact:true}).click();
> 137 |  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintStatus.state)).toBe('live');
      |                                                                                                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  138 |  expect(retries).toBe(1);expect(nativeRequests).toBe(before);await expect(panel.getByRole('button',{name:'Retry market data',exact:true})).toHaveCount(0);
  139 |  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].footprintBars.length)).toBeGreaterThan(2);
  140 | });
  141 | 
  142 | for(const historyBars of [3,1000])test(`native candles paint before ${historyBars}-bar history and history Retry preserves live state`,async({page,context})=>{
  143 |  test.setTimeout(45000);const now=Date.now(),step=60000,current=Math.floor(now/step)*step;let historyRequests=0,socketCount=0;
  144 |  let releaseHistory!:()=>void;const historyGate=new Promise<void>(resolve=>releaseHistory=resolve);
  145 |  let releaseRecovery!:()=>void;const recoveryGate=new Promise<void>(resolve=>releaseRecovery=resolve);
  146 |  await page.exposeFunction('iqNativeHistoryRecovery',()=>releaseRecovery());
  147 |  page.on('console',message=>{if(message.text()==='iq-native-regression-socket')socketCount++;});
  148 |  await context.addInitScript(()=>{
  149 |   const id='chart-native-independent',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  150 |   localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
  151 |  });
  152 |  await context.route('**/assets/worker-*.js',async route=>{
  153 |   const response=await route.fetch(),script=await response.text();if(!script.includes('Invalid durable execution batch'))throw Error('Expected staging feed worker');
  154 |   const transport=`globalThis.WebSocket=class {
  155 |    readyState=0;timer;onopen;onmessage;onclose;onerror;
  156 |    constructor(){setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});},0);}
  157 |    send(wire){const command=JSON.parse(wire);if(!command.interval)return;console.info('iq-native-regression-socket');const update=()=>{this.onmessage?.({data:JSON.stringify({type:'native-candle',source:'binance-native-kline',interval:command.interval,candle:{t:${current},o:80000,h:80100,l:79900,c:80060,v:8,revision:Date.now(),closed:false}})});this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()}})});};update();this.timer=setInterval(update,250);}
  158 |    close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
  159 |   };`;
  160 |   await route.fulfill({response,body:transport+'\n'+script});
  161 |  });
  162 |  await context.route('**/market-data/**',async route=>{
  163 |   const u=new URL(route.request().url());
  164 |   if(u.pathname.endsWith('/native-candles')){
  165 |    historyRequests++;if(historyRequests===1){await historyGate;return route.fulfill({status:502,body:'history route unavailable'});}
  166 |    await recoveryGate;return route.fulfill({contentType:'application/json',body:JSON.stringify({source:'binance-native-kline',candles:Array.from({length:historyBars},(_,i)=>current-(historyBars-1-i)*step).map(t=>({t,o:80000,h:80100,l:79900,c:80010,v:1,revision:9999999999999,closed:t<current}))})});
  167 |   }
  168 |   return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,cursor:0,watches:[],events:[]})});
  169 |  });
  170 |  await page.goto('/');
  171 |  const read=()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-native-independent');return p?{candles:p.candles,status:p.status,barCount:p.engine.barCount,view:p.engine.visibleTimeRange(),bulk:(window as any).__nativeHistoryApply}:null;});
  172 |  await expect.poll(async()=>{const state=await read();return state?.status.state==='live'&&state.barCount===1&&state.candles.at(-1)?.c===80060;}).toBe(true);
  173 |  await expect(page.getByText('Candle history loading · 1 bar displayed',{exact:true})).toBeVisible();expect(historyRequests).toBe(1);
  174 |  await page.screenshot({path:`artifacts/pi-history-r1/native-current-before-history-${historyBars}.png`});
  175 |  let retainedView;
  176 |  if(historyBars===1000){
  177 |   await page.evaluate(({current,step})=>{
  178 |    const p=(window as any).__terminal.panels.get('chart-native-independent'),live=p.candles.at(-1);
  179 |    p.candles=Array.from({length:5000},(_,i)=>({...live,t:current-(4999-i)*step,c:80040,v:4,closed:i<4999}));p.candles[p.candles.length-1]=live;
  180 |    p.engine.setSnapshot(p.candles,true);p.engine.restoreHistoryTimeRange({from:(current-180*step)/1000,to:(current+2*step)/1000});
  181 |    const work=(window as any).__nativeHistoryApply={snapshots:0,multiBarPatches:0,snapshotMs:[] as number[]},snapshot=p.engine.setSnapshot.bind(p.engine),patch=p.engine.applyPatch.bind(p.engine);
  182 |    p.engine.setSnapshot=(...args:any[])=>{const start=performance.now();try{return snapshot(...args);}finally{work.snapshots++;work.snapshotMs.push(performance.now()-start);}};
  183 |    p.engine.applyPatch=(bars:any[])=>{if(bars.length>1)work.multiBarPatches++;return patch(bars);};
  184 |   },{current,step});retainedView=(await read())?.view;
  185 |  }
  186 |  // Keep the simulated failure present until explicit Retry. Native history's
  187 |  // legitimate background retry can otherwise recover before Playwright clicks
  188 |  // on a loaded Pi, correctly removing the action while its locator is waiting.
  189 |  await page.evaluate(()=>{const feed=(window as any).__terminal.feed,retry=feed.retry.bind(feed);feed.retry=(id:string)=>{void (window as any).iqNativeHistoryRecovery();return retry(id);};});
  190 |  releaseHistory();await expect(page.getByText(/Candle history incomplete · Staging history HTTP 502/)).toBeVisible();
  191 |  expect((await read())?.status.state).toBe('live');await page.getByRole('button',{name:'Retry market data',exact:true}).click();
  192 |  await expect.poll(async()=>{const state=await read();return state?.status.nativeHistory?.state==='ready'&&state.barCount===(historyBars===1000?5000:3);}).toBe(true);
  193 |  if(historyBars===1000){expect((await read())?.view).toEqual(retainedView);expect((await read())?.candles[0].c).toBe(80040);expect((await read())?.candles[4000].c).toBe(80010);expect((await read())?.bulk).toMatchObject({snapshots:1,multiBarPatches:0});}
  194 |  expect((await read())?.candles.at(-1)?.c).toBe(80060);expect(socketCount).toBe(1);expect(historyRequests).toBe(2);
  195 |  await expect(page.getByText(/Candle history incomplete/)).toHaveCount(0);
  196 |  await page.screenshot({path:`artifacts/pi-history-r1/native-history-recovered-live-retained-${historyBars}.png`});
  197 | });
  198 | 
  199 | test('saved footprint reads start before the delayed UI bundle and hand off one worker',async({page,context})=>{
  200 |  test.setTimeout(45000);const now=Date.now(),end=Math.floor(now/HOUR)*HOUR,from=end-24*HOUR;
  201 |  let releaseMain!:()=>void,mainBlocked=false,currentRequests=0,nativeRequests=0,workers=0;const mainGate=new Promise<void>(resolve=>releaseMain=resolve),ranges:Array<{from:number;to:number}>=[];
  202 |  page.on('worker',()=>workers++);
  203 |  await context.addInitScript(({from,to})=>{
  204 |   const id='chart-early-ui',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:{from,to},studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  205 |   localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));localStorage.setItem('basis.theme.v1','dark');
  206 |  },{from,to:end});
  207 |  await context.route('**/assets/main-*.js',async route=>{mainBlocked=true;await mainGate;await route.continue();});
  208 |  await context.route('**/market-data/**',async route=>{
  209 |   const u=new URL(route.request().url()),json=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  210 |   if(u.pathname.endsWith('/native-candles')){nativeRequests++;return json({source:'binance-native-kline',candles:[{t:end,o:80000,h:80025,l:79975,c:80010,v:8,revision:1,closed:false}]});}
  211 |   if(u.pathname.endsWith('/footprint-current')){currentRequests++;return json({version:1,state:'ready',source:'binance-usdm-aggtrade',market:'perpetual',tickSize:.1,watermark:1,cursor:1,coverage:{from:end,to:now,confirmedFrom:from,confirmedTo:now,gaps:[],complete:true},bars:[executionBar(end,HOUR)],status:{state:'live',lastUpdate:Date.now()}});}
  212 |   if(u.pathname.endsWith('/footprints')){const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));ranges.push({from:a,to:b});return json({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(b-a)/HOUR},(_,i)=>({from:a+i*HOUR,revision:1,bar:executionBar(a+i*HOUR,HOUR),coverage:{from:a+i*HOUR,to:a+(i+1)*HOUR,complete:true,gaps:[]}}))});}
  213 |   return json({version:1,cursor:0,watches:[],events:[]});
  214 |  });
  215 |  try{
  216 |   await page.goto('/',{waitUntil:'domcontentloaded'});
  217 |   await expect.poll(()=>mainBlocked&&currentRequests>0&&nativeRequests>0&&ranges.length>=6).toBe(true);
  218 |   expect(await page.evaluate(()=>Boolean((window as any).__terminal))).toBe(false);await expect(page.locator('#startup-splash')).toBeVisible();expect(workers).toBe(1);
  219 |   expect(ranges.every(r=>r.to-r.from<=4*HOUR)).toBe(true);releaseMain();
  220 |   await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__terminal?.panels.get('chart-early-ui');return p?.engine.footprintPaintDiagnostics()?.times.filter((t:number)=>t*1000>=p.selection.historyViewport.from&&t*1000<p.selection.historyViewport.to).length??0;})).toBe(24);
  221 |   await expect(page.locator('#startup-splash')).toBeHidden();expect(workers).toBe(1);expect(currentRequests).toBe(1);expect(nativeRequests).toBe(1);
  222 |   const view=await page.evaluate(()=>(window as any).__terminal.panels.get('chart-early-ui').engine.visibleTimeRange());expect(view).toEqual({from:from/1000,to:end/1000});
  223 |   await page.screenshot({path:'artifacts/pi-history-r1/early-ui-saved-24h.png'});
  224 |  }finally{releaseMain();}
  225 | });
  226 | 
```
import {test,expect} from '@playwright/test';
import {projectionOnlyFixture} from '../helpers/prepared-wall-fixture';
import {installHealthyStagingWorker} from './staging-worker-fixture';

test('a negotiated projection paints exact historical walls before independent source validation completes',async({page,context},testInfo)=>{
 const step=300000,now=Date.now(),end=Math.floor(now/step)*step-2*3600000,start=end-30*3600000,id='chart-projection-source';
 const f=projectionOnlyFixture(true,end+step,start-step);let release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),requests:Array<{path:string;headers:Record<string,string>}>=[];
 await installHealthyStagingWorker(context);
 await context.addInitScript(({id,start,end})=>{
  const params={venue:'binance',market:'spot',interval:'5m',type:'candle',historyViewport:{from:start,to:end},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,aggregation:'native',searchRangePercent:10,showHistory:true}}]};
  const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Projection source fixture',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 },{id,start,end});
 await context.route('**/market-data/**',async route=>{
  const u=new URL(route.request().url()),json=(value:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  requests.push({path:u.pathname,headers:route.request().headers()});
  if(u.pathname.endsWith('/native-candles')){
   const first=u.searchParams.has('from')?Number(u.searchParams.get('from')):Math.floor(now/step)*step,last=u.searchParams.has('to')?Number(u.searchParams.get('to')):first+step;
   return json({source:'binance-native-kline',market:'spot',instrument:'binance:spot:BTCUSDT',candles:Array.from({length:Math.min(1000,Math.ceil((last-first)/step))},(_,i)=>({t:first+i*step,o:100,h:101,l:99,c:100,v:2,quoteVolume:200,revision:1,closed:first+i*step+step<=now}))});
  }
  if(u.pathname.endsWith('/discover')){
   expect(Number(u.searchParams.get('from'))).toBe(f.context.from);expect(Number(u.searchParams.get('to'))).toBe(f.context.to);
   expect(route.request().headers()['x-iq-wall-projection-only']).toBe('1');return json(f.discovery);
  }
  if(u.pathname.endsWith('/horizon'))return json({version:1,kind:'wall-source-horizon-v1',market:'spot',profile:f.source.profile,head:f.source.head,availableFrom:f.context.from-3600000});
  if(u.pathname.endsWith('/projection-batch'))return route.fulfill({contentType:'application/x-ndjson',body:f.texts.join('\n')+'\n',headers:{'x-iq-wall-start':'0','x-iq-wall-next':String(f.texts.length),'x-iq-wall-parts':String(f.texts.length),'x-iq-chunk-key':f.manifest.key,'x-iq-source-revision':f.source.token}});
  if(u.pathname.endsWith('/source')){await gate;return json(f.source);}
  if(u.pathname.endsWith('/part')||u.pathname.endsWith('/batch'))throw Error('Projection response must not fetch canonical pages');
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>requests.some(r=>r.path.endsWith('/source'))).toBe(true);
  await expect.poll(()=>page.evaluate(id=>{const p=(window as any).__terminal?.panels.get(id),d=p?.engine.orderWallsDiagnostics();return d?{visible:d.visibleHistorical,painted:d.paintedRevision===d.inputRevision,complete:p.orderWallsStatus?.archive?.requestComplete}:null;},id)).toMatchObject({painted:true,complete:false});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.orderWallsDiagnostics().visibleHistorical,id)).toBeGreaterThan(0);
  release();await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).orderWallsStatus?.archive?.requestComplete,id)).toBe(true);
  const actual=await page.evaluate(id=>{const p=(window as any).__terminal.panels.get(id);return {segments:[...p.engine.orderWallSegments.values()].map(({currentSelection:_selection,presentationKind:_kind,...row}:any)=>row),status:p.orderWallsStatus,live:p.status.state,view:p.engine.visibleTimeRange(),render:p.engine.orderWallsDiagnostics()};},id);
  expect(actual.segments).toEqual(f.full.segments);expect(actual.status.archive).toMatchObject({from:f.context.from,to:f.context.to,loadedThrough:f.context.to,exact:true});
  expect(actual.live).toBe('live');expect(actual.view).toEqual({from:start/1000,to:end/1000});
  expect(requests.some(r=>r.path.endsWith('/part')||r.path.endsWith('/batch'))).toBe(false);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const screenshot=testInfo.outputPath('projection-source-fixture.png');await page.screenshot({path:screenshot});await testInfo.attach('projection-source-fixture',{path:screenshot,contentType:'image/png'});
  await testInfo.attach('projection-source-proof.json',{body:JSON.stringify({scope:'Explicit deterministic transport in a real compiled chart; no source-data, latency or foreground acceptance.',requests,actual,canonicalReference:f.full.segments},null,2),contentType:'application/json'});
 }finally{release();}
});

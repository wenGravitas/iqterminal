import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {installHealthyStagingWorker} from './staging-worker-fixture';

test('compiled chart requested ranges match automatic preparation across rollover and source lag',async({page,context},testInfo)=>{
 const contract=JSON.parse(readFileSync('tests/fixtures/wall-default-ranges.json','utf8'));
 expect(contract.version).toBe(1);expect(contract.cases).toHaveLength(48);
 await installHealthyStagingWorker(context);
 await context.addInitScript(()=>{
  const id='chart-wall-range-contract',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Range contract',params:{venue:'binance',market:'perpetual',interval:'15m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));
 });
 await context.route('**/market-data/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,cursor:0,watches:[],events:[],candles:[]})}));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>(window as any).__terminal?.panels.get('chart-wall-range-contract')?.engine);
 await page.evaluate(()=>(window as any).__terminal.feed.send({type:'diagnostics'}));
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.feed.diagnostics?.staging?.config)).toMatchObject({dataMode:'staging',historyTiles:true});
 const environment=await page.evaluate(()=>(window as any).__terminal.feed.diagnostics.staging.config);
 if(process.env.IQ_RANGE_CLIENT_BUILD)expect(environment.build).toBe(process.env.IQ_RANGE_CLIENT_BUILD);
 const actual=await page.evaluate(cases=>{
  const panel=(window as any).__terminal.panels.get('chart-wall-range-contract'),calculate=panel.orderWallsRange;
  return cases.map((item:any)=>{
   const original=Date.now;let range;
   try{Date.now=()=>item.now;range=calculate.call({selection:{interval:item.interval}},item.visible.from,item.visible.to);}
   finally{Date.now=original;}
   return {interval:item.interval,now:item.now,sourceAt:item.sourceAt,range,preparedFrom:item.closed.from,
    formerPreparedFrom:Math.floor(Math.min(item.now,item.sourceAt)/item.step)*item.step-30*3600000-2*item.step};
  });
 },contract.cases);
 for(let i=0;i<actual.length;i++){
  expect(actual[i].range,JSON.stringify(actual[i])).toEqual(contract.cases[i].requested);
  expect(actual[i].preparedFrom).toBe(actual[i].range.from);
  expect(actual[i].formerPreparedFrom).not.toBe(actual[i].range.from);
 }
 await testInfo.attach('compiled-chart-and-default-planner.json',{body:JSON.stringify({scope:'Compiled production chart range method with explicit fixture transport. No financial source, loading latency or foreground UX acceptance.',frontendEnvironment:environment,backendBuild:contract.build,backendSourceSha256:contract.sourceSha256,cases:actual},null,2),contentType:'application/json'});
});

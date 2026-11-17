/** Controlled warm three-chart workload for both paired windows. No profiling. */
import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='artifacts/pi-forwarded-route-r2',manifest=JSON.parse(readFileSync(dir+'/manifest.json')),cutoff=manifest.experimentCutoffEpoch*1000,base='http://127.0.0.1:4202';
assert.equal(process.env.IQ_ROUTE_R2_WORKLOAD,'1');assert.ok(Date.now()<cutoff);
const end=JSON.parse(readFileSync('artifacts/pi-history-integration-startup-r1/diagnostic-windows.json')).end,id='chart-current-probe';
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:640}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
for(const [hid,interval,hours] of [['chart-history-five','5m',4],['chart-history-hour','1h',24]]){layout.panels[hid]={id:hid,contentComponent:'candle',tabComponent:'compact-chart',title:'Prepared footprint',params:{venue:'binance',market:'perpetual',interval,type:'footprint',rowPrice:25,historyViewport:{from:end-hours*3600000,to:end},studies:[]},minimumHeight:140,minimumWidth:220};layout.grid.root.data.push({type:'leaf',data:{views:[hid],activeView:hid,id:hid},size:640});}
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage();let seq=0;
await context.route('**/market-data/**',r=>r.continue({headers:{...r.request().headers(),'x-iq-request-id':`pi-route-r2-workload-${++seq}`}}));
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>window.__terminal?.panels.size===3,null,{timeout:15000});
 await page.evaluate(()=>{window.__routeRelease=window.__terminal.feed.subscribeFootprint('r2-current',{venue:'binance',market:'perpetual',interval:'5m'},25,()=>{});});
 await page.waitForTimeout(15000);
 writeFileSync(dir+'/workload-ready.json',JSON.stringify({pid:process.pid,build:JSON.parse(readFileSync(dir+'/diagnostic-build.json')).commit,sourceWindowEnd:end,panels:3,browser:'headless system Chromium',cache:'One persistent context preloaded before baseline; retained through matched comparison',readyUtc:new Date().toISOString()}));
 while(Date.now()<cutoff){
  const control=existsSync(dir+'/workload-control.json')?JSON.parse(readFileSync(dir+'/workload-control.json')):{};if(control.stop)break;
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(100);
  const sample=await page.evaluate(()=>({mono:performance.now(),diagnostics:window.__terminal.feed.diagnostics,panels:[...window.__terminal.panels.values()].map(p=>({id:p.params.api.id,footprint:p.footprintStatus?.history,native:p.status?.nativeHistory,work:p.diagnostics().compositionWork})),heap:performance.memory?.usedJSHeapSize}));
  appendFileSync(dir+'/workload.jsonl',JSON.stringify({utc:Date.now(),phase:control.phase??'preload',...sample})+'\n');await page.waitForTimeout(4900);
 }
 await page.evaluate(()=>window.__routeRelease?.());
}finally{await browser.close();writeFileSync(dir+'/workload-done.json',JSON.stringify({at:new Date().toISOString()}));}

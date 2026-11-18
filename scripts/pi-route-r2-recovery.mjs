/** One labelled injected recovery check on the real candidate route. */
import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='artifacts/pi-forwarded-route-r2',manifest=JSON.parse(readFileSync(dir+'/manifest.json')),base='http://127.0.0.1:4202';
assert.equal(process.env.IQ_ROUTE_R2_RECOVERY,'1');assert.ok(Date.now()<manifest.experimentCutoffEpoch*1000);
const end=JSON.parse(readFileSync('artifacts/pi-history-integration-startup-r1/diagnostic-windows.json')).end,id='chart-current-probe';
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:640}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
for(const [hid,interval,hours] of [['chart-history-five','5m',4],['chart-history-hour','1h',24]]){layout.panels[hid]={id:hid,contentComponent:'candle',tabComponent:'compact-chart',title:'Prepared footprint',params:{venue:'binance',market:'perpetual',interval,type:'footprint',rowPrice:25,historyViewport:{from:end-hours*3600000,to:end},studies:[]},minimumHeight:140,minimumWidth:220};layout.grid.root.data.push({type:'leaf',data:{views:[hid],activeView:hid,id:hid},size:640});}

const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage();let allow=false,seq=0,injected=0;const requests=[];let before,after,error,retained;
await context.route('**/market-data/**',async route=>{const r=route.request(),u=new URL(r.url()),rid=`pi-route-r2-recovery-${++seq}`;requests.push({id:rid,path:u.pathname,interval:u.searchParams.get('interval'),retry:u.searchParams.get('retry'),injected:!allow&&u.pathname.endsWith('/footprint-current')&&u.searchParams.get('interval')==='1h'});
 if(!allow&&u.pathname.endsWith('/footprint-current')&&u.searchParams.get('interval')==='1h'){injected++;return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,state:'unavailable',error:'Explicit r2 recovery injection; not historical incident evidence',job:{failed:true,retryable:true}})});}
 return route.continue({headers:{...r.headers(),'x-iq-request-id':rid}});
});
async function diag(){await page.evaluate(()=>{window.__beforeDiag=window.__terminal.feed.diagnostics;window.__terminal.feed.send({type:'diagnostics'});});await page.waitForFunction(()=>window.__terminal.feed.diagnostics!==window.__beforeDiag,null,{timeout:3000});return page.evaluate(()=>window.__terminal.feed.diagnostics);}
const proof=d=>d.staging.streams.find(s=>s.key.endsWith(':footprint:5m:p25'))?.executionProof;
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
 await page.waitForFunction(()=>{const t=window.__terminal,p=t?.panels.get('chart-history-hour');return p?.footprintStatus.state==='failed'&&p.footprintBars.length>=24;},null,{timeout:12000});
 await page.waitForTimeout(3000);before=await diag();assert.ok(proof(before)?.confirmedAckBatches>0,'Healthy unrelated5m execution feed missing');
 retained=await page.evaluate(()=>window.__terminal.panels.get('chart-history-hour').footprintBars.map(b=>b.time));await page.screenshot({path:dir+'/recovery-before.png'});
 allow=true;await page.evaluate(()=>window.__terminal.panels.get('chart-history-hour').retry.click());
 await page.waitForFunction(()=>window.__terminal.panels.get('chart-history-hour').footprintStatus.state==='live',null,{timeout:12000});await page.waitForTimeout(3000);after=await diag();
 const b=proof(before),a=proof(after);assert.equal(a.socketStarts,b.socketStarts);assert.equal(a.disconnects,b.disconnects);assert.equal(a.errors,b.errors);assert.ok(a.lastConfirmedAckCursor>b.lastConfirmedAckCursor);
 const times=await page.evaluate(()=>window.__terminal.panels.get('chart-history-hour').footprintBars.map(b=>b.time));assert.ok(retained.every(t=>times.includes(t)),'Good closed history lost');await page.screenshot({path:dir+'/recovery-after.png'});
}catch(e){error=String(e);process.exitCode=1;}
finally{writeFileSync(dir+'/recovery.json',JSON.stringify({scope:'Explicit1h current-bootstrap failure injection; real staging history/native/5m execution route. Recovery proof only, not historical cause.',build:JSON.parse(readFileSync(dir+'/diagnostic-build.json')).commit,injected,requests,before,after,retained,error,result:error?'failed':'passed'},null,2));await browser.close();}

/** One headless genuine-source current-native smoke, never a loading gate. */
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
import {chromium} from '../../../scripts/test-browser-launch.mjs';
const base='http://127.0.0.1:4185',id='chart-serving-smoke',expected='638caabff4d4a441c3706898dc8602274a4d41d6';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});let result;
try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(id=>{const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current native smoke',params:{venue:'binance',market:'perpetual',interval:'15m',type:'candle',studies:[],indicators:[],tradingOverlay:false},minimumWidth:220,minimumHeight:140}},activeGroup:'1'};localStorage.setItem('basis.theme.v1','dark');localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));},id);
 const started=performance.now();await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
 await page.waitForFunction(id=>{const p=window.__terminal?.panels.get(id);return p?.status.state==='live'&&p.candles.length&&p.engine.stats.draws>0;},id,{timeout:12000});
 const first=await page.evaluate(id=>{const p=window.__terminal.panels.get(id);return {clientAt:performance.now(),status:p.status,last:p.candles.at(-1),count:p.candles.length,draws:p.engine.stats.draws};},id),firstObservationMs=performance.now()-started;
 await page.waitForFunction(({id,after})=>window.__terminal.panels.get(id).status.lastUpdate>after,{id,after:first.status.lastUpdate},{timeout:12000});
 await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(200);
 const final=await page.evaluate(id=>{const p=window.__terminal.panels.get(id);return {status:p.status,last:p.candles.at(-1),count:p.candles.length,diagnostics:window.__terminal.feed.diagnostics};},id);
 assert.equal(final.diagnostics.fixture,false);assert.deepEqual(final.diagnostics.staging.config,{dataMode:'staging',historyTiles:true,build:expected});assert.equal(final.status.state,'live');assert.equal(errors.length,0);
 const response=await context.request.get(base+'/market-data/v2/history/health'),health=await response.json();assert.equal(response.status(),200);assert.equal(health.build,'95114d0cb236e9de54fb535d58b901d5ac4a2d79');
 const cdp=await browser.newBrowserCDPSession(),system=await cdp.send('SystemInfo.getInfo');await page.screenshot({path:'artifacts/pi-history-r1/serving-proxy-budget-r1/live-native.png'});
 result={scope:'Single headless genuine staging current-native candle smoke through Pi SSH/Vite. Both native paint and a subsequent live update observed. Not footprint/wall first-useful, five-sample loading, confirmation-gap, historical coverage, custom-profile or foreground acceptance.',clientBuild:expected,backendBuild:health.build,firstObservationMs,first,final,system,errors};await context.close();
}catch(error){result={...result,error:String(error)};process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/pi-history-r1/serving-proxy-budget-r1/live-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({firstObservationMs:result?.firstObservationMs,error:result?.error}));}

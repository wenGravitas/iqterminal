import {chromium} from './test-browser-launch.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const url=process.env.IQ_MAP_BENCH_URL??'http://127.0.0.1:4183/';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1366,height:850}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/liquidation-map/'))requests.push({url:r.url(),status:r.status()});});
await page.addInitScript(()=>localStorage.setItem('basis.theme.v1','dark'));
const snapshot=()=>page.evaluate(()=>{const p=[...window.__terminal.panels.values()][0];return{series:p.diagnostics().series,map:p.liquidationMapView?.diagnostics(),heap:performance.memory?.usedJSHeapSize};});
const ready=()=>page.waitForFunction(()=>[...window.__terminal?.panels.values()??[]][0]?.liquidationMapView?.diagnostics().columns>0,{},{timeout:60000});
const add=async()=>{const panel=page.locator('.candle-panel').first();await panel.getByRole('button',{name:'Indicators',exact:true}).click();await panel.getByRole('button',{name:'Add Liquidation Map',exact:true}).click();await panel.locator('.indicator-picker').getByRole('button',{name:'Done',exact:true}).click();await ready();};
try{
 const started=Date.now();await page.goto(url);await page.locator('.candle-panel').first().waitFor();const firstContentMs=Date.now()-started;
 await page.waitForFunction(()=>[...window.__terminal?.panels.values()??[]][0]?.diagnostics().bars>100,{},{timeout:60000});const candlesReadyMs=Date.now()-started;
 await add();const coldReadyMs=Date.now()-started,cold=await snapshot();
 let time=Date.now(),before=requests.length;await page.locator('.candle-panel').first().getByRole('button',{name:'Remove Liquidation Map',exact:true}).click();await add();const warm={elapsedMs:Date.now()-time,requests:requests.length-before,snapshot:await snapshot()};
 const panel=page.locator('.candle-panel').first();await panel.getByRole('button',{name:'Liquidation Map settings',exact:true}).click();const dialog=panel.getByRole('dialog',{name:'Liquidation Map settings'});await dialog.getByLabel('Price grouping (native quote)',{exact:true}).fill('250');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 const original=await panel.getByLabel('Timeframe',{exact:true}).inputValue(),next=original==='5m'?'15m':'5m';time=Date.now();await panel.getByLabel('Timeframe',{exact:true}).selectOption(next);await ready();const changed=await snapshot();await panel.getByLabel('Timeframe',{exact:true}).selectOption(original);await ready();const timeframe={elapsedMs:Date.now()-time,original,next,changed,returned:await snapshot()};
 await page.waitForTimeout(700);time=Date.now();before=requests.length;await page.reload();await ready();const reload={elapsedMs:Date.now()-time,requests:requests.length-before,snapshot:await snapshot()};
 const initial=reload.snapshot.map?.sources?.find(s=>s.venue==='bybit')?.asOf;
 time=Date.now();let liveUpdated=false;try{await page.waitForFunction(previous=>[...window.__terminal.panels.values()][0].liquidationMapView?.diagnostics().sources?.some(s=>s.venue==='bybit'&&s.asOf>previous),initial,{timeout:90000});liveUpdated=true;}catch{errors.push('No newer Bybit collection sample observed within 90 seconds');}
 const final=await snapshot();const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/liquidation-map/')).map(r=>({name:r.name,duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize,serverTiming:r.serverTiming})));
 const report={version:1,environment:'Pi5 headless Chromium; actual staging feeds; no quiet/foreground claim',url,firstContentMs,candlesReadyMs,coldReadyMs,cold,warm,timeframe,reload,live:{updated:liveUpdated,elapsedMs:Date.now()-time,final},requests,resources,errors,loadAverage:(await readFile('/proc/loadavg','utf8')).trim()};
 await writeFile(process.env.IQ_MAP_BENCH_OUTPUT??'artifacts/liquidation-map/lifecycle.json',JSON.stringify(report,null,2));console.log(JSON.stringify({firstContentMs,candlesReadyMs,coldReadyMs,warmMs:warm.elapsedMs,warmRequests:warm.requests,reloadMs:reload.elapsedMs,liveUpdated,errors}));
}finally{await browser.close();}

import {launch} from './browser.mjs';import {addIndicator} from './indicator-actions.mjs';import {writeFile} from 'node:fs/promises';
const output=process.argv[2]??'artifacts/wide-heatmap-diagnosis.json',fixed=process.argv.includes('--fixed');
const browser=await launch(false),started=Date.now(),events=[],samples=[];let page;
try{
 page=await browser.newPage({viewport:{width:1280,height:800}});const starts=new Map();
 page.on('request',r=>{if(r.url().includes('/heatmap?'))starts.set(r,Date.now());});
 page.on('requestfailed',r=>{if(starts.has(r)){const e={at:Date.now()-started,ms:Date.now()-starts.get(r),query:r.url().split('?')[1],failure:r.failure()};events.push(e);console.log(JSON.stringify(e));}});
 page.on('response',async r=>{if(!starts.has(r.request()))return;try{const d=await r.json();const e={at:Date.now()-started,ms:Date.now()-starts.get(r.request()),query:r.url().split('?')[1],status:r.status(),error:d.error,records:d.inputRecords,cells:d.cells?.length,head:d.watermark};events.push(e);console.log(JSON.stringify(e));}catch{}});
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.__terminal?.stats().panels[0]?.bars>0);const panel=page.locator('.candle-panel').first();await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');if(fixed){await page.waitForFunction(()=>window.__terminal?.stats().panels[0]?.bars>=900);await page.evaluate(()=>{const p=[...window.__terminal.panels.values()][0],last=p.engine.chart.dataLayer.baseIndex;p.engine.setRange({from:last-60,to:last-12});});}await addIndicator(panel,'Order-book Heatmap');
 for(let i=0;i<(fixed?36:18);i++){await page.waitForTimeout(10000);const sample=await page.evaluate(()=>{const p=[...window.__terminal.panels.values()][0],s=p.diagnostics();return {status:p.heatmapStatus,buckets:p.engine.heatmap?.buckets.length,range:s.range,min:s.min,max:s.max};});samples.push({at:Date.now()-started,...sample});console.log('STATE',JSON.stringify(samples.at(-1)));if(sample.status?.state==='live')break;}
}finally{await writeFile(output,JSON.stringify({started,fixed,events,samples},null,2)+'\n');await browser.close();}

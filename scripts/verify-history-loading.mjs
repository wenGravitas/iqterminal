// Read-only live validation: real retained history, no collector restarts or fixtures.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launch} from './browser.mjs';
import {addIndicator} from './indicator-actions.mjs';
const browser=await launch(false), result={source:'Pi browser -> private SSH tunnel -> staging, no fixtures or server restart',errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1500,height:900}});
 page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForFunction(()=>window.__terminal?.stats().panels[0]?.bars>0);
 const panel=page.locator('.candle-panel').first();
 await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');
 await addIndicator(panel,'Footprint');
 await page.waitForFunction(()=>window.__terminal?.stats().panels[0]?.footprint.initialViewSet);
 await addIndicator(panel,'Order-book Heatmap');
 const progress=setInterval(async()=>{try{console.log(await page.evaluate(()=>{const p=window.__terminal?.stats().panels[0];return {bars:p?.footprint.bars,history:p?.footprint.status.message,heatmap:p?.heatmap.status?.state};}));}catch{}},20000);
 try {
  await page.waitForFunction(()=>{const p=window.__terminal?.stats().panels[0];return p?.footprint.bars>=299&&!p.footprint.status.message.includes('loading older');},undefined,{timeout:360000});
  await page.waitForFunction(()=>[...window.__terminal.panels.values()][0].heatmapStatus?.state==='live',undefined,{timeout:180000});
 }finally{clearInterval(progress);}
 result.footprint=await page.evaluate(()=>{const p=window.__terminal.stats().panels[0],b=[...window.__terminal.panels.values()][0].engine.footprintBars;return {bars:p.footprint.bars,status:p.footprint.status,first:b[0].time,last:b.at(-1).time};});
 result.heatmap=await page.evaluate(()=>{const p=[...window.__terminal.panels.values()][0],b=p.engine.heatmap.buckets;return {status:p.heatmapStatus,buckets:b.length,first:b[0]?.start,last:b.at(-1)?.end};});
 assert.ok(result.footprint.bars<=300);assert.ok(result.footprint.last-result.footprint.first>23*3600);assert.ok(!result.footprint.status.message.includes('incomplete'));assert.ok(result.heatmap.buckets>0);assert.deepEqual(result.errors,[]);
 // A closed historical bar is compared at its captured durable cursor.
 result.parity=await page.evaluate(async()=>{const p=[...window.__terminal.panels.values()][0],bar=p.engine.footprintBars[Math.floor(p.engine.footprintBars.length/2)],from=bar.time*1000,cursor=p.footprintStatus.transport?.cursor;const response=await fetch(`/market-data/v1/footprints?from=${from}&to=${from+300000}&interval=5m&rowPrice=25${cursor?`&watermark=${cursor}`:''}`);const data=await response.json();if(!response.ok)throw new Error(data.error);return {time:bar.time,local:bar,server:data.bars[0]};});
 assert.deepEqual(result.parity.local.cells,result.parity.server.cells);assert.equal(result.parity.local.delta,result.parity.server.delta);
 await page.screenshot({path:'artifacts/history-loading-live.png'});
 await writeFile('artifacts/history-loading-live.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({footprint:result.footprint,heatmap:result.heatmap,errors:result.errors,closedBarParity:true}));
}finally{await browser.close();}

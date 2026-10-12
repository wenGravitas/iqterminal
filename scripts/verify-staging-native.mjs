import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launch} from './browser.mjs';
const browser=await launch(false);
try {
 const context=await browser.newContext();const page=await context.newPage();const errors=[];let historyRequests=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/market-data/v1/native-candles'))historyRequests++;});
 await page.goto('http://127.0.0.1:5173/');
 const streamed=()=>page.waitForFunction(()=>window.__terminal && [...window.__terminal.panels.values()][0].status.message.includes('native kline stream'),null,{timeout:45000});
 await streamed();
 const before=await page.evaluate(()=>[...window.__terminal.panels.values()][0].diagnostics().last);
 await page.waitForFunction(old=>{const p=[...window.__terminal.panels.values()][0];const c=p.diagnostics().last;return c && (c.t>old.t || c.v>old.v);},before,{timeout:15000});
 const after=await page.evaluate(()=>[...window.__terminal.panels.values()][0].diagnostics().last);
 const count=historyRequests;await context.setOffline(true);await page.waitForFunction(()=>[...window.__terminal.panels.values()][0].status.state==='stale',null,{timeout:15000});await context.setOffline(false);await streamed();
 assert.ok(historyRequests>count,'Native reconnect repaired history with native REST');assert.deepEqual(errors,[]);
 const result={actualPi:true,fixture:false,nativeSource:'binance-native-kline',liveVolumeAdvanced:true,nativeHistoryReloadOnReconnect:true,before,after,historyRequests,errors};
 await writeFile('artifacts/staging-native-stream.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}

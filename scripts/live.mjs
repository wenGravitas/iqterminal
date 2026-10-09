import {launch,url} from './browser.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await launch(false);const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));const report={mode:'REAL direct browser exchange smoke, no fixtures',browser:browser.version(),started:new Date().toISOString(),intervals:[],errors};
await page.goto(url);
for(const interval of ['1m','5m','15m','1h','4h']){
  if(interval!=='1m'){await page.locator('select[aria-label=Timeframe]').first().selectOption(interval);await page.locator('select[aria-label=Timeframe]').last().selectOption(interval);}
  let ready=true;try{await page.waitForFunction(()=>window.__terminal.stats().panels.every(p=>p.bars>0&&p.status.state==='live'),{},{timeout:35000});}catch{ready=false;}
  const before=await page.evaluate(()=>window.__terminal.stats().panels);await page.waitForTimeout(4000);const after=await page.evaluate(()=>window.__terminal.stats().panels);
  report.intervals.push({interval,ready,before,after,updates:after.map((p,i)=>({venue:p.series.venue,historyLoaded:p.bars>0,live:p.status.state==='live',currentChanged:JSON.stringify(p.last)!==JSON.stringify(before[i].last),freshnessAdvanced:p.status.lastUpdate>before[i].status.lastUpdate}))});
}
await page.screenshot({path:'artifacts/live-terminal.png'});await writeFile('artifacts/live-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();

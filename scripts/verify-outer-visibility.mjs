import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launch} from './browser.mjs';
import {addIndicator} from './indicator-actions.mjs';
const browser=await launch(false), evidence={errors:[],source:'actual Pi dev proxy to staging',fixtures:false};
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(60000);await page.emulateMedia({colorScheme:'dark'});
 page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForFunction(()=>window.__terminal?.stats().panels.length===2);
 const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Footprint');await addIndicator(panel,'Order-book Heatmap');
 await page.waitForFunction(()=>window.__terminal.stats().panels[0].footprint.initialViewSet);
 await page.evaluate(()=>{const p=[...window.__terminal.panels.values()][0],c=p.engine.chart,last=c.dataLayer.baseIndex;c.timeScale.setVisibleLogicalRange({from:last-3,to:last+1});c.panes()[0].priceScale.setFixedRange({min:72000,max:94000});c.setAutoScale(false);});
 await page.waitForFunction(()=>{const p=[...window.__terminal.panels.values()][0];return p.heatmapStatus?.state==='live'&&p.engine.heatmap?.bins.some(b=>b.low<75000&&b.bid>0)&&p.engine.heatmap.bins.some(b=>b.high>92000&&b.ask>0);});
 evidence.observed=await page.evaluate(()=>{
  const p=[...window.__terminal.panels.values()][0],h=p.engine.heatmap;
  const outer=h.bins.filter(b=>(b.low<80000||b.high>88000)&&(b.bid>0||b.ask>0));
  window.__outerSaved=h.update;h.update=()=>{}; // Hold the same displayed real observations for the colour comparison only.
  return {status:p.heatmapStatus,positiveOuterBins:outer.length,partialOuterBins:outer.filter(b=>b.incomplete).length,low:Math.min(...outer.map(b=>b.low)),high:Math.max(...outer.map(b=>b.high))};
 });
 const signature=()=>page.evaluate(()=>[...window.__terminal.panels.values()][0].engine.heatmap.bins.map(b=>[b.columnStart,b.low,b.high,b.bid,b.ask,b.bidQuote,b.askQuote,b.incomplete,b.bidObserved,b.askObserved]));
 const before=await signature();
 for(const contrast of ['muted','enhanced']){
  const draws=await page.evaluate(contrast=>{const p=[...window.__terminal.panels.values()][0],h=p.engine.heatmap;h.setOptions({...p.selection.heatmap,contrast});return h.stats.draws;},contrast);
  await page.waitForFunction(n=>[...window.__terminal.panels.values()][0].engine.heatmap.stats.draws>n,draws);
  assert.deepEqual(await signature(),before);
  await page.screenshot({path:`artifacts/outer-liquidity-${contrast}-live.png`});
 }
 await page.setViewportSize({width:720,height:860});
 await page.waitForTimeout(250);
 await page.screenshot({path:'artifacts/outer-liquidity-enhanced-live-720x860.png'});
 assert.ok(evidence.observed.positiveOuterBins>0);assert.ok(evidence.observed.partialOuterBins>0);assert.deepEqual(evidence.errors,[]);
 evidence.quantitiesAndCoverageUnchanged=true;
 await page.evaluate(()=>{[...window.__terminal.panels.values()][0].engine.heatmap.update=window.__outerSaved;delete window.__outerSaved;});
 await writeFile('artifacts/outer-liquidity-live.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();}

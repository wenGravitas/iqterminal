// Explicit test transport drives the real worker/book/collector/IPC/primitive. No production liquidity fixtures.
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { launch, url } from './browser.mjs';
const directory = await mkdtemp(join(tmpdir(), 'iqterminal-heatmap-browser-')), browser = await launch(false);
try {
  await build({configFile:false,logLevel:'silent',build:{lib:{entry:'tests/browser/depth-fixture.ts',formats:['es'],fileName:()=>'fixture.mjs'},outDir:directory,emptyOutDir:false,minify:false}});
  const {installDepthFixture} = await import(pathToFileURL(join(directory,'fixture.mjs')).href);
  const results=[];
  for(const count of [1,2,8]) {
    const page=await browser.newPage({viewport:{width:1366,height:768}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
    // Helper uses page's origin; resolve relative navigations against this diagnostic preview.
    const goto=page.goto.bind(page); page.goto=(address,...args)=>goto(address.startsWith('/')?url+address:address,...args);
    const worker=await installDepthFixture(page,500,true);
    await page.evaluate(count=>{
      const t=window.__terminal,d=t.dock;for(const p of d.panels.slice(1))p.api.close();
      const first=[...t.panels.values()][0];first.changeHeatmap({...first.selection.heatmap,enabled:true,rowPrice:1});
      while(d.panels.length<count)t.addChart({venue:'binance',market:'perpetual',interval:'1m',type:'candle',heatmap:{enabled:true,rowPrice:1}});
      for(let i=2;i<count;i++)d.panels[i].api.moveTo({group:d.panels[i-2].api.group,position:'bottom'});
      if(count===8){const height=document.querySelector('#workspace').clientHeight/4;for(const g of new Set(d.panels.map(p=>p.api.group)))g.api.setSize({height});}
    },count);
    await page.waitForFunction(()=>window.__terminal.stats().panels.every(p=>p.heatmap.status?.state==='live'));
    await worker.evaluate(()=>self.__heatmapFixture.populate());
    await page.waitForFunction(()=>window.__terminal.stats().panels.every(p=>p.heatmap.bytes>1000));
    await page.evaluate(()=>{const t=window.__terminal;for(const p of t.panels.values()){const s=p.engine.chart.panes()[0].priceScale;s.setFixedRange({min:83280,max:83720});p.engine.chart.setAutoScale(false);} t.feed.send({type:'fixture',rate:1000});t.resetMetrics();t.heatFrames=[];t.heatPrevious=0;t.heatSampling=true;const sample=time=>{if(!t.heatSampling)return;if(t.heatPrevious)t.heatFrames.push(time-t.heatPrevious);t.heatPrevious=time;requestAnimationFrame(sample);};requestAnimationFrame(sample);});
    await page.waitForTimeout(500);
    for(let i=0;i<12;i++) {await page.evaluate(i=>{for(const p of window.__terminal.panels.values()){const r=p.engine.visibleRange();p.engine.setRange({from:r.from+(i%2?2:-2),to:r.to+(i%2?2:-2)});p.engine.zoom(i%2?1/1.08:1.08);}},i);await page.waitForTimeout(250);}
    await page.waitForTimeout(1000);await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(200);
    const report=await page.evaluate(()=>{const t=window.__terminal,s=t.stats();t.heatSampling=false;return {...s,frameIntervals:t.heatFrames,longTasks:s.longTasks,memory:performance.memory?.usedJSHeapSize};});
    const q=(v,p)=>{const s=[...v].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*p)]??null;};
    assert.ok(report.panels.every(p=>p.visible && p.bars===5000), "All measured panels must be visible with the fixture history");assert.ok(report.feed.heatmap.groups[0].evictions>0, "Retention fixture must actually exercise eviction");assert.equal(await worker.evaluate(()=>self.__heatmapFixture.sockets),1); assert.ok(report.panels.every(p=>p.heatmap.bytes<=2097152));assert.deepEqual(errors,[]);
    const before=report.feed.heatmap; const startDraws=report.panels.map(p=>p.heatmap.draws);
    let hidden;
    if(count>1){await page.evaluate(()=>{const t=window.__terminal,d=t.dock,ids=[...t.panels.keys()];t.hiddenHeatmapId=ids[1];d.getPanel(ids[1]).api.moveTo({group:d.getPanel(ids[0]).api.group});d.getPanel(ids[0]).api.setActive();});await page.waitForTimeout(300);const a=await page.evaluate(()=>{const t=window.__terminal;return t.panels.get(t.hiddenHeatmapId).diagnostics();});await page.waitForTimeout(1100);const b=await page.evaluate(()=>{const t=window.__terminal;return t.panels.get(t.hiddenHeatmapId).diagnostics();});hidden={drawDelta:b.heatmap.draws-a.heatmap.draws,bytes:b.heatmap.bytes};assert.equal(hidden.drawDelta,0);}
    for(let i=0;i<5;i++){
      await page.evaluate(count=>{const t=window.__terminal;if(count===8)t.dock.panels.at(-1).api.close();t.addChart({venue:'binance',interval:'1m',type:'candle',heatmap:{enabled:true,rowPrice:1}});},count);
      await page.waitForTimeout(100);
      if(count<8)await page.evaluate(count=>{const t=window.__terminal;while(t.dock.panels.length>count)t.dock.panels.at(-1).api.close();},count);
    }
    await page.evaluate(()=>{for(const p of [...window.__terminal.dock.panels])p.api.close();});await page.waitForTimeout(200);assert.equal(await worker.evaluate(()=>self.__heatmapFixture.active),0);await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(100);const teardown=await page.evaluate(()=>{const s=window.__terminal.stats();return{panels:s.domPanels,heatmap:s.feed.heatmap,mainHeapBytes:performance.memory?.usedJSHeapSize};});assert.equal(teardown.panels,0);assert.equal(teardown.heatmap.configurations,0);assert.equal(teardown.heatmap.consumers,0);
    results.push({panels:count,rafP50Ms:q(report.frameIntervals,.5),rafP95Ms:q(report.frameIntervals,.95),longTasks:report.longTasks,mainHeapBytes:report.memory,heatmaps:report.panels.map(p=>p.heatmap),worker:before,hidden,teardown,errors});
    await page.close();
  }
  const report={scope:'Diagnostic only: synthetic synchronized 100ms depth diffs, prepopulated retention, real worker+IPC+Canvas2D; 5000 native candle fixtures and 1000 candle revisions/s. Host counters include startup. Main heap excludes workers/canvases.',browser:browser.version(),results};
  await writeFile('artifacts/performance-heatmap-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(results.map(r=>({panels:r.panels,rafP95:r.rafP95Ms,heapMiB:r.mainHeapBytes/1048576,renderP95:r.heatmaps.map(h=>h.p95RenderMs),worker:r.worker,hidden:r.hidden})),null,2));
}finally{await browser.close();await rm(directory,{recursive:true,force:true});}

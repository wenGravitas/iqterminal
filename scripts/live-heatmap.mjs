import { addIndicator } from './indicator-actions.mjs';
// Ordinary-build read-only live instrumentation. No liquidity substitution or diagnostic globals.
import { launch, url } from './browser.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await launch(false);
try {
  const page=await browser.newPage({viewport:{width:1366,height:768}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>document.querySelectorAll('.candle-panel').length===2);
  assert.equal(await page.evaluate(()=>!!window.__terminal),false,'Ordinary build without test fixtures');
  const worker=page.workers()[0];assert.ok(worker);
  await worker.evaluate(()=>{
    const probe=self.__liveHeatmap={sockets:0,active:0,diffs:[],snapshot:null,batches:[]}, NativeSocket=self.WebSocket, nativeFetch=self.fetch.bind(self);
    self.fetch=async(...args)=>{const r=await nativeFetch(...args);if(String(args[0]).includes('/depth?')){const data=await r.clone().json();probe.snapshot={...data,receivedAt:Date.now()};}return r;};
    self.WebSocket=class extends NativeSocket{
      constructor(...args){super(...args);if(!String(args[0]).includes('@depth'))return;probe.sockets++;probe.active++;this.addEventListener('close',()=>probe.active--);this.addEventListener('message',e=>{try{const d=JSON.parse(e.data);if(d.e==='depthUpdate'){probe.diffs.push({...d,receivedAt:Date.now()});if(probe.diffs.length>10000)probe.diffs.shift();}}catch{}});}
    };
    const post=self.postMessage.bind(self);self.postMessage=(message,...args)=>{if(message.type==='heatmap-batch'&&message.buckets.length){probe.batches.push({...message,buckets:message.buckets.map(b=>({...b,cells:Array.from(b.cells),peaks:Array.from(b.peaks)})),wireThrough:probe.diffs.length});if(probe.batches.length>4)probe.batches.shift();}return post(message,...args);};
  });
  const panel=page.locator('.candle-panel').first();await addIndicator(panel, 'Order-book Heatmap');
  await page.waitForFunction(()=>document.querySelector('.heatmap-notice')?.textContent?.includes('live'),undefined,{timeout:35000});await page.waitForTimeout(3000);
  const capture=await worker.evaluate(()=>self.__liveHeatmap);assert.ok(capture.snapshot?.bids?.length);assert.equal(capture.sockets,1);assert.ok(capture.batches.length);
  const snap=capture.snapshot, book={bid:new Map(snap.bids.map(([p,q])=>[+p,+q])),ask:new Map(snap.asks.map(([p,q])=>[+p,+q]))};
  const eligible=capture.diffs.filter(d=>d.u>=snap.lastUpdateId), bridge=eligible.findIndex(d=>d.U<=snap.lastUpdateId&&d.u>=snap.lastUpdateId);assert.ok(bridge>=0,'Actual diff stream bridges real REST snapshot');
  const batch=capture.batches.at(-1), wire=eligible.slice(bridge).filter(d=>capture.diffs.indexOf(d)<batch.wireThrough); // objects originate from eligible; indexOf remains exact.
  let last=snap.lastUpdateId;const states=[];
  for(const [index,d]of wire.entries()) {if(index)assert.equal(d.pu,last,'Real wire continuity');for(const [side,rows]of [['bid',d.b],['ask',d.a]])for(const [p,q]of rows){if(+q===0)book[side].delete(+p);else book[side].set(+p,+q);}last=d.u;states.push({at:d.receivedAt,bid:new Map(book.bid),ask:new Map(book.ask)});}
  const bidEdge=Math.min(...snap.bids.map(([p])=>+p)),askEdge=Math.max(...snap.asks.map(([p])=>+p));const comparisons=[];
  for(const b of batch.buckets) {
    assert.ok(b.end>b.start&&b.rowSize===10);assert.ok(b.start>=batch.status.collectionStart);
    const duration=b.end-b.start;
    for(let i=0;i<b.cells.length;i+=13) {
      const price=b.cells[i], high=price+b.rowSize;
      // Fully covered rows only. Partial edges are intentionally subtotal/incomplete.
      if(b.cells[i+7]<duration||b.cells[i+8]<duration)continue;
      for(const [side,areaIndex]of [['bid',i+1],['ask',i+2]]) {
        let area=0,seen=0;
        for(let j=0;j<states.length;j++){
          const from=Math.max(b.start,states[j].at),to=Math.min(b.end,states[j+1]?.at??b.end);if(to<=from)continue;
          let qty=0;for(const [p,q]of states[j][side])if(p>=price&&p<high&&p>=bidEdge&&p<=askEdge)qty+=q;
          area+=qty*(to-from);seen+=to-from;
        }
        if(seen<duration-2)continue;
        const actual=b.cells[areaIndex]/duration,expected=area/duration;
        // Adjacent instrumentation/service receipt clocks can differ by 1–2 ms; use an explicit temporal tolerance.
        const tolerance=.01+Math.max(1,actual,expected)*.025;
        assert.ok(Math.abs(actual-expected)<=tolerance,`${side} observed time-weighted row ${price}: ${actual} vs ${expected}`);
        comparisons.push({start:b.start,end:b.end,price,side,actual,expected,tolerance});
      }
    }
  }
  assert.ok(comparisons.length,'Live time-weighted resting quantities reconciled against real synchronized snapshot/diff states');
  await page.screenshot({path:'artifacts/orderbook-heatmap-live-candles-1366x768.png'});
  await panel.getByRole('button',{name:'Indicators',exact:true}).click();await panel.getByRole('button',{name:'Add Binance depth band',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.indicator-picker .dialog-status')?.textContent?.includes('added with its default settings'),undefined,{timeout:10000});
  await panel.locator('.indicator-picker').getByRole('button',{name:'Done',exact:true}).click();
  await addIndicator(panel, 'Footprint');await page.waitForFunction(()=>document.querySelector('.candle-panel .ohlc')?.textContent?.includes('BTC'),undefined,{timeout:35000});await page.waitForTimeout(1200);
  const after=await worker.evaluate(()=>self.__liveHeatmap);assert.equal(after.sockets,1);assert.equal(after.active,1);assert.ok(after.batches.at(-1).status.collectionStart>=batch.status.collectionStart);assert.equal(after.batches.at(-1).key,'25:500');assert.ok(after.batches.at(-1).buckets.every(b=>b.rowSize===25&&b.priceOffset===0));
  await page.screenshot({path:'artifacts/orderbook-heatmap-live-footprint-1366x768.png'});
  assert.deepEqual(errors,[]);const report={scope:'Ordinary-build actual Binance snapshot/diff; no fixtures; host receipt time weighted replay with documented 2.5% temporal tolerance',depthSocketCount:after.sockets,snapshotLevels:{bids:snap.bids.length,asks:snap.asks.length},realDiffs:after.diffs.length,collectionStart:batch.status.collectionStart,comparisons,heatmapSettingsPersistAcrossChartType:true,footprintAlignedResolution:25,footprintCollectionStart:after.batches.at(-1).status.collectionStart,depthStudyApplied:true,errors};
  await writeFile(process.env.HEATMAP_LIVE_OUTPUT??'artifacts/orderbook-heatmap-live-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,comparisons:comparisons.slice(0,4)},null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}

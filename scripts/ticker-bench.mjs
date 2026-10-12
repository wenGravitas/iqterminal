import { launch, url } from './browser.mjs';
import { installTradeFixture } from '../tests/browser/trade-fixture.ts';
import { writeFile } from 'node:fs/promises';
const browser=await launch(true),page=await browser.newPage({baseURL:url,viewport:{width:1366,height:768}});let errors=[];page.on('pageerror',e=>errors.push(e.message));
// Fixture installation is explicit and uses real shared normalization and worker classification.
await page.goto(url);const worker=await installTradeFixture(page);const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
const runs=[];
for(const count of [0,1,2,8]){
  await page.evaluate(count=>{const t=window.__terminal;for(const p of [...t.dock.panels])if(p.view.contentComponent==='trade-ticker')t.dock.removePanel(p);t.tickerTimes=[];t.probeFrames=[];t.probeRun=true;let last=performance.now();const tick=now=>{if(!t.probeRun)return;t.probeFrames.push(now-last);last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);for(let n=0;n<count;n++)t.addTicker();for(const p of t.tickers.values()){const draw=p.draw.bind(p);p.draw=()=>{const s=performance.now();draw();t.tickerTimes.push(performance.now()-s);};}t.resetMetrics();},count);
  if(count){await page.waitForFunction(() => window.__terminal.tickers.size>0);await worker.evaluate(()=>{const p=self.__tradeFixture;p.loop=setInterval(()=>{for(let n=0;n<50;n++)p.emit(.02,n%2?'buy':'sell');},100);});}
  const before=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
  await page.waitForTimeout(6000);await worker.evaluate(()=>clearInterval(self.__tradeFixture.loop));
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(250);
  const result=await page.evaluate(()=>{const t=window.__terminal;t.probeRun=false;const times=t.tickerTimes.sort((a,b)=>a-b),frames=t.probeFrames.slice().sort((a,b)=>a-b);return{rowPaintP95Ms:times[Math.floor(times.length*.95)]??null,frameIntervalP95Ms:frames[Math.floor(frames.length*.95)]??null,longTasks:t.stats().longTasks,tickers:[...t.tickers.values()].map(p=>p.diagnostics()),feed:t.feed.diagnostics};});
  const after=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value;runs.push({count,seconds:6,aggregatePrintsPerSecond:count?500:0,heapBefore:before,heapAfter:after,...result});
}
await page.evaluate(()=>{const t=window.__terminal;for(const p of [...t.dock.panels])if(p.view.contentComponent==='trade-ticker')t.dock.removePanel(p);t.feed.send({type:'diagnostics'});});await page.waitForTimeout(250);
const teardown=await worker.evaluate(()=>({active:self.__tradeFixture.active,socketOpens:self.__tradeFixture.sockets}));
await writeFile('artifacts/ticker-bench.json',JSON.stringify({fixture:true,renderer:'Canvas2D with headless SwiftShader',userAgent:await page.evaluate(()=>navigator.userAgent),runs,teardown,errors},null,2));await browser.close();console.log(JSON.stringify({runs:runs.map(r=>({count:r.count,p95:r.rowPaintP95Ms,frameP95:r.frameIntervalP95Ms,heapDelta:r.heapAfter-r.heapBefore,retained:r.tickers.map(t=>t.retained),worker:r.feed.tickers})),teardown,errors},null,2));

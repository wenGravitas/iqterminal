// Real Pi Chromium -> same-origin Vite proxy -> loopback SSH tunnel -> staging.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch } from './browser.mjs';
import { addIndicator } from './indicator-actions.mjs';
const browser = await launch(false);
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.TERMINAL_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__terminal?.panels.size === 2);
  const panel = page.locator('.candle-panel').first(); await addIndicator(panel, 'Footprint');
  const loaded = () => page.waitForFunction(() => {
    const p = window.__terminal && [...window.__terminal.panels.values()][0];
    return p && p.footprintBars.length > 3 && p.footprintStatus.state === 'live' && p.status.state === 'live';
  }, null, { timeout: 90000 });
  await loaded();
  const before = await page.evaluate(() => {
    const p = [...window.__terminal.panels.values()][0];
    return { bars: p.footprintBars, source: p.footprintStatus.message, native: p.status.message };
  });
  assert.match(before.source, /Staging/); assert.match(before.native, /native (klines|kline|Binance)/);
  // Select a fixed complete five-minute block well inside the rolling cache;
  // eviction of its oldest minute during a clock boundary is expected behavior.
  const stableTo = Math.floor(before.bars.at(-1).time / 300) * 300;
  const complete = before.bars.filter(b => b.coverage === 'observed' && b.time >= stableTo - 300 && b.time < stableTo);
  assert.equal(complete.length, 5);
  await page.waitForTimeout(2500); await page.reload(); await loaded();
  const after = await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintBars);
  for (const bar of complete) assert.deepEqual(after.find(b => b.time === bar.time), bar, 'Complete retained bar reproduced after reload');
  const tail = after.at(-1); await page.waitForFunction(({ time, revision }) => {
    const p = [...window.__terminal.panels.values()][0];
    return p.footprintBars.some(b => b.time > time || b.time === time && b.revision > revision);
  }, { time: tail.time, revision: tail.revision }, { timeout: 15000 });
  // Observe receipt -> worker application -> a subsequent chart draw on the actual Pi.
  const latency = await page.evaluate(async () => {
    const p = [...window.__terminal.panels.values()][0]; const samples = []; let last = 0; let pending = null;
    const started = performance.now();
    while (performance.now() - started < 10000) {
      await new Promise(requestAnimationFrame);
      const t = p.footprintStatus.transport; const draws = p.engine.stats.draws;
      if (pending && draws > pending.draws) { samples.push({ ...pending.t, chartDrawObservedAtMs: Date.now(), rendererDrawObservedAfterWorkerMs: Date.now() - pending.t.workerAppliedAtMs }); pending = null; }
      if (t && t.cursor !== last) { last = t.cursor; pending = { t, draws }; }
    }
    return samples;
  });
  assert.ok(latency.length > 3, 'Actual streaming updates reached chart draws');
  const applied = await page.evaluate(() => { const p=[...window.__terminal.panels.values()][0]; return {bars:p.footprintBars,cursor:p.footprintStatus.transport.cursor}; });
  const replayParity = await page.evaluate(async ({ bars,cursor }) => {
    const from=bars[0].time*1000,to=(bars.at(-1).time+60)*1000;
    return (await (await fetch(`/market-data/v1/footprints?from=${from}&to=${to}&interval=1m&rowPrice=25&watermark=${cursor}`)).json()).bars;
  },applied);
  const values = bars => bars.map(({time,open,high,low,close,delta,minDelta,maxDelta,quoteDelta,minQuoteDelta,maxQuoteDelta,aggregateRecordCount,cells})=>({time,open,high,low,close,delta,minDelta,maxDelta,quoteDelta,minQuoteDelta,maxQuoteDelta,aggregateRecordCount,cells}));
  assert.deepEqual(values(applied.bars),values(replayParity),'Actual streamed Pi values equal database history at its applied cursor');
  const retained = await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintBars.length);
  await context.setOffline(true);
  await page.waitForFunction(() => [...window.__terminal.panels.values()][0].footprintStatus.state === 'stale', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintBars.length), retained);
  await context.setOffline(false); await loaded();
  const reconciled = await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintBars);
  for (const bar of complete) assert.deepEqual(reconciled.find(b => b.time === bar.time), bar);
  // Restart staging while this Pi chart remains subscribed; reconcile through its cursor.
  const preRestart = await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintStatus.transport.cursor);
  execFileSync('ssh', ['-o','BatchMode=yes','staging','cd /opt/iqterminal && docker compose restart app'], { timeout:60000 });
  await page.waitForFunction(cursor => { const p = [...window.__terminal.panels.values()][0]; return p.footprintStatus.state === 'live' && p.footprintStatus.transport?.cursor > cursor; }, preRestart, { timeout:90000 });
  const restartBars = await page.evaluate(() => [...window.__terminal.panels.values()][0].footprintBars);
  for (const bar of complete) assert.deepEqual(restartBars.find(b=>b.time===bar.time),bar);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await page.waitForFunction(() => {
    const p = [...window.__terminal.panels.values()][0]; return p.selection.interval === '5m' && p.footprintBars.length > 1 && p.footprintStatus.state === 'live' && p.status.state === 'live';
  }, null, { timeout: 30000 });
  const fiveMinute = await page.evaluate(time => [...window.__terminal.panels.values()][0].footprintBars.find(b=>b.time===time), stableTo-300);
  assert.ok(fiveMinute && fiveMinute.coverage === 'observed');
  const volume = bars => bars.reduce((total,b)=>b.cells.reduce((s,c)=>[s[0]+c.bidVol+c.askVol,s[1]+c.bidNotional+c.askNotional],total),[0,0]);
  const oneTotals=volume(complete),fiveTotals=volume([fiveMinute]);
  assert.ok(Math.abs(oneTotals[0]-fiveTotals[0])<1e-8);assert.ok(Math.abs(oneTotals[1]-fiveTotals[1])<1e-5);
  const final = await page.evaluate(() => {
    const p = [...window.__terminal.panels.values()][0]; return { bars: p.footprintBars.length, status: p.footprintStatus };
  });
  await page.screenshot({ path: 'artifacts/staging-footprint-pi.png' });
  // Ask the real backend for an interval straddling its actual recording start.
  // Only request bounds are changed; responses and coverage are not mocked.
  const gapBounds = await page.evaluate(async () => {
    const c = await (await fetch('/market-data/v1/coverage')).json();
    return { from: c.confirmedFrom - 120000, to: c.confirmedFrom + 120000 };
  });
  const worker = page.workers()[0];
  await worker.evaluate(({ from, to }) => {
    const original = self.fetch.bind(self);
    self.fetch = (input, options) => {
      if (typeof input === 'string' && input.startsWith('/market-data/v1/footprints?')) {
        const u = new URL(input, self.location.origin); u.searchParams.set('from', String(from)); u.searchParams.set('to', String(to)); input = u.pathname + u.search;
      }
      return original(input, options);
    };
  }, gapBounds);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('1m');
  await page.waitForFunction(() => [...window.__terminal.panels.values()][0].footprintStatus.coverage === 'gapped', null, { timeout: 30000 });
  assert.match(await panel.locator('.chart-footer').innerText(), /gapped coverage/);
  await page.screenshot({ path: 'artifacts/staging-coverage-gap-pi.png' });
  assert.deepEqual(errors, []);
  const result = { actualPiBrowser: true, fixture: false, historicalBars: before.bars.length, completeBarsReproduced: complete.length,
    verifiedCompleteInterval: { from: (stableTo - 300) * 1000, to: stableTo * 1000 },
    liveRevisionAdvanced: true, actualCursorHandoffParity: {cursor:applied.cursor,bars:applied.bars.length}, offlineRetained: retained, reconnectReconciled: true, timeframeChanged: true, timeframeVolumeParity: { oneMinute:oneTotals, fiveMinute:fiveTotals },
    actualUnrecordedCoverageGapVisible: true, backendRestartReconciledInPi: true, latencySamples:latency, gapBounds, final, errors };
  await writeFile('artifacts/staging-browser-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }

import { addIndicator, setPriceLevel, setUnits } from './indicator-actions.mjs';
// Ordinary-build real Binance smoke. Read-only instrumentation observes actual
// worker WebSockets/messages; it neither mocks trades nor enables app diagnostics.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { launch, url } from './browser.mjs';
const rowPrice = Number(process.env.LIVE_FOOTPRINT_ROW_PRICE ?? 25);
assert.ok(Number.isFinite(rowPrice) && rowPrice > 0 && rowPrice <= 10000, 'Valid requested row width');
const browser = await launch(false);
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.candle-panel').length === 2);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => !!window.__terminal), false, 'Use an ordinary build without diagnostic globals');
  const worker = page.workers()[0];
  assert.ok(worker, 'Feed worker exists');
  await worker.evaluate(() => {
    const state = self.__liveFootprintProbe = { wire: [], batches: [], sockets: 0 };
    const NativeWebSocket = self.WebSocket;
    self.WebSocket = class extends NativeWebSocket {
      constructor(address, protocols) {
        super(address, protocols);
        if (!String(address).includes('@aggTrade')) return;
        state.sockets++;
        this.addEventListener('message', event => {
          try {
            const trade = JSON.parse(event.data);
            if (trade.e === 'aggTrade' && state.wire.length < 20000) state.wire.push(trade);
          } catch {}
        });
      }
    };
    const post = self.postMessage.bind(self);
    self.postMessage = (message, ...options) => {
      if (message.type === 'footprint-patch' && message.bars.length) {
        state.batches.push({ bars: structuredClone(message.bars), wire: state.wire.slice(), capturedAt: Date.now() });
        if (state.batches.length > 4) state.batches.shift();
      }
      return post(message, ...options);
    };
  });
  const panel = page.locator('.candle-panel').first();
  const priceLevel = panel.locator('input.footprint-row-price');
  assert.equal(await priceLevel.inputValue(), '25');
  await addIndicator(panel, 'Footprint');
  if (rowPrice !== 25) await setPriceLevel(panel, rowPrice);
  assert.equal(await priceLevel.inputValue(), String(rowPrice));
  await page.waitForFunction(() => document.querySelector('.candle-panel .panel-status')?.getAttribute('data-state') === 'live' && document.querySelector('.candle-panel .ohlc')?.textContent?.includes('BTC'), undefined, { timeout: 35_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/footprint-live-no-studies-1366x768.png' });
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  const addEma = page.getByRole('button', { name: 'Add EMA overlay', exact: true });
  for (let attempt = 0; attempt < 12; attempt++) {
    await addEma.click();
    await page.waitForTimeout(1500);
    if ((await panel.locator('.indicator-picker .dialog-status').textContent())?.includes('added with its default settings')) break;
  }
  const studyApplyMessage = await panel.locator('.indicator-picker .dialog-status').textContent();
  assert.ok(studyApplyMessage?.includes('added with its default settings'), `EMA applied: ${studyApplyMessage}`);
  assert.ok(page.workers().length >= 2, 'Dedicated script worker exists');
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(8000);
  const captured = await worker.evaluate(() => self.__liveFootprintProbe);
  assert.ok(captured.batches.length, 'Real footprint replacement batches arrived');
  const latest = captured.batches.at(-1);
  const unique = new Map();
  for (const trade of latest.wire) {
    if (trade.s !== 'BTCUSDT' || trade.st === 2 || typeof trade.m !== 'boolean') continue;
    unique.set(trade.a, trade);
  }
  const comparisons = latest.bars.map(bar => {
    assert.equal(bar.rowSize, rowPrice, 'Real worker snapshots use the requested USDT width');
    assert.ok(bar.cells.every(cell => Math.abs(cell.price / rowPrice - Math.round(cell.price / rowPrice)) < 1e-8), 'Rows align to the requested quote grid');
    const observations = [...unique.values()].filter(trade => Math.floor(trade.T / 60000) * 60 === bar.time).sort((a, b) => a.T - b.T || a.a - b.a);
    const expected = observations.reduce((totals, trade) => {
      totals[trade.m ? 'bid' : 'ask'] += Number(trade.q);
      return totals;
    }, { bid: 0, ask: 0 });
    const actual = bar.cells.reduce((totals, cell) => ({ bid: totals.bid + cell.bidVol, ask: totals.ask + cell.askVol }), { bid: 0, ask: 0 });
    const expectedNotional = observations.reduce((totals, trade) => { totals[trade.m ? 'bid' : 'ask'] += Number(trade.p) * Number(trade.q); return totals; }, { bid: 0, ask: 0 });
    const actualNotional = bar.cells.reduce((totals, cell) => ({ bid: totals.bid + cell.bidNotional, ask: totals.ask + cell.askNotional }), { bid: 0, ask: 0 });
    for (const side of ['bid', 'ask']) assert.ok(Math.abs(expectedNotional[side] - actualNotional[side]) < 1e-5, `${side} execution notional reconciles`);
    assert.ok(Math.abs(bar.quoteDelta - (actualNotional.ask - actualNotional.bid)) < 1e-5, 'Notional delta reconciles');
    for (const key of ['bid', 'ask']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key} volume reconciles`);
    assert.ok(Math.abs(bar.delta - (actual.ask - actual.bid)) < 1e-8, 'Delta reconciles');
    assert.equal(bar.aggregateRecordCount, observations.length);
    assert.equal(bar.open, Number(observations[0].p));
    assert.equal(bar.close, Number(observations.at(-1).p));
    assert.equal(bar.high, Math.max(...observations.map(trade => Number(trade.p))));
    assert.equal(bar.low, Math.min(...observations.map(trade => Number(trade.p))));
    return { time: bar.time, revision: bar.revision, coverage: bar.coverage, aggregateObservations: observations.length, rowSize: bar.rowSize, rows: bar.cells.length, expected, actual, expectedNotional, actualNotional, volume: actual.bid + actual.ask, delta: bar.delta, ohlc: [bar.open, bar.high, bar.low, bar.close] };
  });
  assert.equal(captured.sockets, 1, 'One execution socket');
  const readout = await panel.locator('.ohlc').textContent();
  const status = await panel.locator('.panel-status').textContent();
  assert.ok(readout?.includes('BTC'), 'Rendered footprint readout has BTC units');
  assert.equal(errors.length, 0, 'No page errors');
  await page.screenshot({ path: 'artifacts/footprint-live-1366x768.png' });
  const units = panel.getByLabel('Footprint volume units', { exact: true });
  await setUnits(panel, 'usdt');
  assert.equal(await units.inputValue(), 'usdt');
  assert.ok((await panel.locator('.ohlc').textContent())?.includes('USDT'), 'Notional readout labelled');
  await page.screenshot({ path: 'artifacts/footprint-units-live-usdt-1366x768.png' });
  assert.equal((await worker.evaluate(() => self.__liveFootprintProbe)).sockets, 1, 'Unit switch retains the shared feed');
  await setUnits(panel, 'btc');
  assert.equal(await units.inputValue(), 'btc');
  const hyperliquid = page.locator('.candle-panel').last();
  await page.waitForFunction(() => document.querySelectorAll('.candle-panel')[1]?.querySelector('.panel-status')?.getAttribute('data-state') === 'live', undefined, { timeout: 35_000 });
  const hyperliquidStatus = await hyperliquid.locator('.panel-status').textContent();
  await panel.getByRole('button', { name: 'Remove Footprint', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.candle-panel .panel-status')?.getAttribute('data-state') === 'live', undefined, { timeout: 35_000 });
  const candleStatus = await panel.locator('.panel-status').textContent();
  assert.equal(await panel.getByRole('button', { name: 'Footprint settings', exact: true }).isVisible(), false);
  assert.ok((await panel.locator('.ohlc').textContent())?.includes('V'), 'Native candle volume readout restored');
  assert.equal(errors.length, 0, 'No page errors after returning to native candles');
  const report = { priceLevelUsdt: rowPrice, mode: 'Ordinary production build, real Binance USD-M aggTrade, no fixtures', browser: browser.version(), workerProbe: 'Read-only wrapping of actual WebSocket and postMessage; no messages substituted', socketCount: captured.sockets, capturedWireCount: captured.wire.length, comparisons, studyApplyMessage, scriptWorkerPresent: page.workers().length >= 2, readout, status, candleStatus, hyperliquidStatus, errors };
  await writeFile(process.env.LIVE_FOOTPRINT_OUTPUT || 'artifacts/footprint-live-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

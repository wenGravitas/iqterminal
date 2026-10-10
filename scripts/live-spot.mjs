import { writeFile } from 'node:fs/promises';
import { launch, url } from './browser.mjs';

const browser = await launch(false);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
const cancelledRequests = [];
const spotRest = [];
const socketSessions = [];
let spotKlineFrames = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => {
  const failure = request.failure()?.errorText ?? 'unknown request failure';
  if (failure === 'net::ERR_ABORTED') cancelledRequests.push(`${request.url()}: cancelled during instrument switch`);
  else errors.push(`${request.url()}: ${failure}`);
});
page.on('response', response => {
  if (response.url().startsWith('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT')) {
    spotRest.push({ status: response.status(), url: response.url() });
  }
});
page.on('websocket', socket => {
  const spotSocket = socket.url().startsWith('wss://data-stream.binance.vision/stream');
  socketSessions.push({ url: socket.url(), spot: spotSocket });
  if (spotSocket) socket.on('framereceived', event => {
    try {
      const message = JSON.parse(String(event.payload));
      const data = message?.data ?? message;
      if (data?.e === 'kline' && data?.s === 'BTCUSDT' && data?.k?.i === '1m') spotKlineFrames++;
    } catch { /* subscription acknowledgements and non-JSON frames are not candle evidence */ }
  });
});

const report = {
  mode: 'REAL public Binance Spot smoke, no fixtures',
  browser: browser.version(),
  started: new Date().toISOString(),
  url,
  errors,
  cancelledRequests,
};

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__terminal?.stats().panels.length >= 2, undefined, { timeout: 15_000 });
  await page.locator('select[aria-label="Instrument"]').first().selectOption('binance:spot');
  await page.waitForFunction(() => {
    const panel = [...window.__terminal.panels.values()][0];
    const diagnostics = panel?.diagnostics();
    return panel?.series.market === 'spot' && diagnostics?.bars > 0 && diagnostics?.status.state === 'live'
      && panel.engine?.series?.getData?.().length > 0;
  }, undefined, { timeout: 45_000 });
  const before = await page.evaluate(() => {
    const panel = [...window.__terminal.panels.values()][0];
    return panel.diagnostics();
  });
  await page.waitForFunction(previous => {
    const panel = [...window.__terminal.panels.values()][0];
    return panel?.diagnostics().status.lastUpdate > previous;
  }, before.status.lastUpdate, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/live-spot-terminal.png' });
  const chart = await page.evaluate(() => {
    const panel = [...window.__terminal.panels.values()][0];
    const diagnostics = panel.diagnostics();
    const bars = panel.engine.series.getData();
    const last = bars.at(-1);
    return {
      series: panel.series,
      metadata: panel.element.querySelector('.instrument-meta')?.textContent?.trim() ?? '',
      title: panel.params.api.title,
      status: diagnostics.status,
      bars: diagnostics.bars,
      nativeBars: bars.length,
      nativeLast: last ?? null,
      nativeLastMatches: Boolean(last && diagnostics.last && last.time === Math.floor(diagnostics.last.t / 1000) && last.close === diagnostics.last.c),
      diagnosticLast: diagnostics.last,
      diagnosticsGlobal: typeof window.__terminal,
      fixtureBrand: document.querySelector('.brand')?.textContent?.includes('FIXTURE') ?? false,
    };
  });
  Object.assign(report, {
    interval: '1m',
    spotRest,
    socketSessions,
    spotKlineFrames,
    chart,
  });
  await writeFile('artifacts/live-spot-results.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!spotRest.some(response => response.status === 200)) throw new Error('Spot public REST klines did not return HTTP 200.');
  if (!socketSessions.some(session => session.spot)) throw new Error('The dedicated Spot market-data WebSocket did not open.');
  if (spotKlineFrames < 1) throw new Error('No native Spot BTCUSDT 1m kline WebSocket frame was observed.');
  if (chart.series.market !== 'spot' || chart.status.state !== 'live' || chart.bars < 1 || chart.nativeBars < 1) throw new Error('Spot native chart did not become live with bars.');
  if (!chart.nativeLastMatches) throw new Error('Native chart OHLCV does not match the selected Spot candle.');
  if (chart.diagnosticsGlobal !== 'object' || chart.fixtureBrand) throw new Error('Smoke must use diagnostics without fixture mode.');
  if (errors.length) throw new Error(`Browser reported ${errors.length} errors.`);
} catch (error) {
  await writeFile('artifacts/live-spot-results.json', `${JSON.stringify({ ...report, spotRest, socketSessions, spotKlineFrames, failure: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}

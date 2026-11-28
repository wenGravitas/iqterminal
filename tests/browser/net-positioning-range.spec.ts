import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('Net Longs and Shorts drag totals clear on release and click ranges pin until closed', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const hostOpen = Math.floor(Date.now() / 60_000) * 60_000;
  const requests: string[] = [], routed: string[] = [], failed: string[] = [], errors: string[] = [];
  // Worker-owned live sockets must not revise the deterministic candle geometry
  // between capturing bar coordinates and clicking the second endpoint.
  await page.context().routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => {errors.push(error.message);console.error('Browser error:',error.message);});
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('requestfailed', request => failed.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.route('**/market-data/**', async route => {
    const url = new URL(route.request().url());
    routed.push(url.pathname);
    if (url.pathname.endsWith('/native-candles')) {
      const candles = Array.from({ length: 600 }, (_, index) => {
        const time = hostOpen - (599 - index) * 60_000, close = 82_000 + index * .1;
        return { t: time, o: close - .5, h: close + 1, l: close - 1, c: close, v: 10 + index % 20, revision: 1, closed: index < 599 };
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'binance-native-kline', candles }) });
    }
    if (!url.pathname.endsWith('/net-positioning')) return route.fulfill({ status: 503, json: { error: 'Explicit browser fixture: no runtime transport' } });
    const method = url.searchParams.get('method') ?? 'price-oi';
    const venues = (url.searchParams.get('venues') ?? 'binance').split(',').filter(venue => ['binance', 'hyperliquid', 'bybit'].includes(venue));
    requests.push(`${method}:${venues.join(',')}`);
    const intervals = Array.from({ length: 60 }, (_, age) => venues.flatMap(venue => [0, 1].map(half => {
      const end = hostOpen - age * 60_000 + (half + 1) * 30_000;
      const value = ((age * 7 + half * 3 + venue.length) % 15) - 7;
      const longs = venue === 'binance' ? value * 1.5 : -value;
      const shorts = venue === 'binance' ? -value * .75 : value * 1.2;
      const delta = longs + shorts;
      return {
        version: 1, method, status: 'available', venue, market: 'perpetual', nativeSymbol: venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT', units: 'BTC',
        startTimeMs: end - 30_000, endTimeMs: end, attributionTimeMs: end, resolutionMs: 30_000, direction: delta === 0 ? 0 : Math.sign(delta),
        oiDeltaBtcDecimal: String(delta), netLongsBtcDecimal: String(longs), netShortsBtcDecimal: String(shorts), unclassifiedBtcDecimal: '0', qualityFlags: [],
        provenance: { openInterestEnd: { openInterestBtcDecimal: '100', sourceTimeMs: end, receivedAtMs: end, sourceTimeQuality: 'exchange-event', quality: 'complete' },
          priceStart: { price: 82_000 }, priceEnd: { price: 82_001 }, tradeCoverage: { fromMs: end - 30_000, toMs: end, complete: true, gap: false } },
      };
    })));
    const feed = { state: 'live', source: 'explicit-browser-fixture', lastObservedAt: Date.now(), expectedIntervalMs: 30_000, stale: false,
      unitVerification: { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC',
      venues, from: hostOpen - 4 * 60 * 60_000, to: Date.now(), intervals: intervals.flat(), truncated: false,
      unitVerification: Object.fromEntries(venues.map(venue => [venue, { status: 'verified', units: 'BTC', evidence: 'explicit browser fixture' }])),
      feeds: Object.fromEntries(venues.map(venue => [venue, feed])), pendingIntervals: 0,
      history: 'explicit browser fixture; observed intervals only', semantics: 'test-only signed source fixture' }) });
  });

  await page.addInitScript(()=>localStorage.setItem('basis.theme.v1','dark'));
  await page.goto('/');
  const panel = page.locator('.candle-panel').first();
  await expect(panel).toBeVisible({timeout:30000});
  await page.waitForTimeout(2_000);
  const chartState = await page.evaluate(() => (window as any).__terminal.stats());
  expect(chartState.panels[0]?.bars, JSON.stringify({ chartState, routed, failed, errors })).toBeGreaterThan(0);
  await addIndicator(panel, 'Net Longs & Shorts');
  const id = 'native.net-longs-shorts-estimated';
  const row = panel.locator(`.active-indicator[data-definition-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect.poll(() => page.evaluate(id => {
    const p = [...(window as any).__terminal.panels.values()][0], view = p.engine.netPositioningPanes.get(id);
    return view?.primitive.diagnostics().candleCount ?? 0;
  }, id)).toBeGreaterThan(0);

  // Data arrival precedes the visible-chart paint. Keep the fixture window on
  // screen, then wait for usable geometry rather than racing the scheduler.
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    p.engine.setRange({ from: p.engine.times.length - 34, to: p.engine.times.length });
  });
  let points: any;
  await expect.poll(async () => {
    points = await page.evaluate(id=>{
    const p=[...(window as any).__terminal.panels.values()][0],view=p.engine.netPositioningPanes.get(id),plot=p.engine.chart.plotRect(view.paneIndex),rect=p.chart.getBoundingClientRect();
    const bars=[...view.primitive.geometry].filter((g:any)=>g.side==='longs'&&g.sourceId==='binance'&&g.left>=0&&g.right<=plot.width&&g.bottom-g.top>3).sort((a:any,b:any)=>a.timeMs-b.timeMs);
    const point=(g:any)=>({x:rect.left+plot.left+(g.left+g.right)/2,y:rect.top+plot.top+(g.top+g.bottom)/2,time:g.timeMs});
    if (bars.length < 11) return null;
    const first=bars[Math.max(0,bars.length-10)],last=bars[Math.max(0,bars.length-6)];
    const expected=[...view.primitive.candles.values()].filter((c:any)=>c.timeMs>=first.timeMs&&c.timeMs<=last.timeMs).reduce((n:number,c:any)=>n+(c.venues.binance?.netLongsBtc??0),0);
    return {expected,a:point(first),b:point(last),range:{...p.engine.chart.timeScale.visibleRange()}};
    },id);
    return points !== null;
  }).toBe(true);
  const box=panel.locator('.net-positioning-measure-box'),card=panel.locator('.net-positioning-measure-tooltip');
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:6});
  await expect(box).toBeVisible();await expect(card).toContainText('Release to clear');await expect(card).toContainText('Net Longs (Est.)');
  const quantity=`${points.expected>0?'+':points.expected<0?'−':''}${Math.abs(points.expected).toLocaleString('en-US',{maximumFractionDigits:3})} BTC`;
  await expect(card.locator('.positioning-tooltip-heading strong').last()).toHaveText(quantity);
  const count=(points.b.time-points.a.time)/60000+1;await expect(card).toContainText(`${count} bars`);
  await page.screenshot({path:'/tmp/net-positioning-range-drag.png'});
  await page.mouse.up();await expect(box).toBeHidden();await expect(card).toBeHidden();
  expect(await page.evaluate(()=>({...[...(window as any).__terminal.panels.values()][0].engine.chart.timeScale.visibleRange()}))).toEqual(points.range);
  await page.mouse.click(points.b.x,points.b.y);await page.mouse.move(points.a.x,points.a.y,{steps:4});await page.mouse.click(points.a.x,points.a.y);
  await expect(card).toContainText('Pinned range');await expect(card).toContainText(`${count} bars`);await expect(box).toHaveAttribute('data-pinned','true');
  await page.mouse.move(12,12);await expect(card).toBeVisible();
  await expect(card.locator('.positioning-tooltip-heading strong').last()).toHaveText(quantity);
  const bounds=await box.boundingBox(),tooltipBounds=await card.boundingBox();
  expect(tooltipBounds!.x+tooltipBounds!.width<=bounds!.x || tooltipBounds!.x>=bounds!.x+bounds!.width).toBe(true);
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBounds!.x+tooltipBounds!.width).toBeLessThanOrEqual(1920);
  await page.screenshot({path:'/tmp/net-positioning-range-pinned.png'});
  await card.getByRole('button',{name:'Close range totals'}).click();await expect(card).toBeHidden();await expect(box).toBeHidden();
  await page.mouse.click(points.a.x,points.a.y);await page.keyboard.press('Escape');await expect(card).toBeHidden();
  // Match the compact pane from the live report. Both cumulative plots must
  // retain painted bars after pane resizing, without replacing their data.
  await page.evaluate(id=>{
    const p=[...(window as any).__terminal.panels.values()][0],chart=p.engine.chart,view=p.engine.netPositioningPanes.get(id);
    const panes=chart.panes(),height=panes.reduce((sum:number,pane:any)=>sum+pane.base.mediaHeight,0);
    const other=panes.reduce((sum:number,_pane:any,index:number)=>index===view.paneIndex?sum:sum+chart.paneWeight(index),0);
    chart.setPaneWeight(view.paneIndex,116*other/(height-116));
  },id);
  await expect.poll(()=>page.evaluate(id=>{
    const p=[...(window as any).__terminal.panels.values()][0],view=p.engine.netPositioningPanes.get(id);
    return {height:Math.round(p.engine.chart.panes()[view.paneIndex].base.mediaHeight),sides:[...new Set(view.primitive.geometry.map((g:any)=>g.side))].sort()};
  },id)).toEqual({height:116,sides:['longs','shorts']});
  await page.screenshot({path:'/tmp/net-positioning-compact-fixed.png'});

});

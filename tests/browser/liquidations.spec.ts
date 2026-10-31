import {test,expect}from '@playwright/test';
import {addIndicator,chooseChartMarket}from './indicator-actions';
const state=(page:any)=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].liquidationsView?.diagnostics());
async function setup(page:any){await page.goto('/?fixture=1&fixtureTime=now');await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);const close=page.getByRole('button',{name:/^Close /});if(await close.count()>1)await close.nth(1).click();const panel=page.locator('.candle-panel').first();const tree=panel.locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});if(await tree.isVisible())await tree.click();return panel;}
test('liquidation ticker, stacked native pane, marker settings and workspace persist',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1920,height:1080});const panel=await setup(page);
 await page.getByRole('button',{name:'Liquidations',exact:true}).click();const ticker=page.locator('.liquidation-ticker');await expect(ticker).toBeVisible();await expect.poll(()=>ticker.locator('[data-event-id]').count()).toBeGreaterThan(0);await expect(ticker.locator('.ticker-status')).toContainText('Binance sampled');await expect(ticker.locator('.liquidation-summary')).toContainText('15m');
 await addIndicator(panel,'Liquidations');await expect(panel.locator('[data-liquidations=true]')).toBeVisible();await expect.poll(async()=>(await state(page))?.painted).toBeGreaterThan(0);
 expect((await state(page)).batch.bars.some((b:any)=>b.longs.bybit+b.longs.binance>0)).toBe(true);expect((await state(page)).batch.bars.some((b:any)=>b.shorts.bybit+b.shorts.binance>0)).toBe(true);
 await panel.getByRole('button',{name:'Liquidations settings',exact:true}).click();const dialog=panel.getByRole('dialog',{name:'Liquidations settings',exact:true});await dialog.getByLabel('Show liquidations on price chart',{exact:true}).check();await dialog.getByLabel('Minimum marker notional (USDT)',{exact:true}).fill('0');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect.poll(async()=>(await state(page)).markers).toBeGreaterThan(0);expect((await state(page)).markers).toBeLessThanOrEqual(80);
 for(const theme of ['dark','light']as const){await page.getByLabel('Theme',{exact:true}).selectOption(theme);await page.screenshot({path:`/tmp/liquidations-${theme}.png`});}
 await ticker.getByRole('button',{name:'Pause liquidation tape',exact:true}).click();await expect(ticker.getByRole('button',{name:'Resume liquidation tape',exact:true})).toBeVisible();await ticker.getByRole('button',{name:'Resume liquidation tape',exact:true}).click();
 await ticker.getByLabel('Liquidation side',{exact:true}).selectOption('LONG');await expect.poll(async()=>ticker.locator('[data-event-id]').evaluateAll(rows=>rows.every(r=>r.textContent?.includes('LONG')))).toBe(true);
 await ticker.getByRole('button',{name:'Liquidation Ticker settings',exact:true}).click();const settings=ticker.getByRole('dialog',{name:'Liquidation Ticker settings',exact:true});await settings.getByLabel('Minimum displayed liquidation size',{exact:true}).fill('100');await settings.getByLabel('Show quantity',{exact:true}).uncheck();await settings.getByRole('button',{name:'Apply',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('basis.layout.v1')!);return(Object.values(s.layout.panels)as any[]).find(p=>p.contentComponent==='liquidation-ticker')?.params.minimum;})).toBe(100);
 await panel.getByRole('button',{name:'Hide Liquidations',exact:true}).click();await expect(panel.locator('[data-liquidations=true]')).toHaveCount(0);await expect(ticker.locator('[data-event-id]').first()).toBeVisible();await panel.getByRole('button',{name:'Show Liquidations',exact:true}).click();await expect.poll(async()=>(await state(page))?.painted).toBeGreaterThan(0);
 await page.reload();await expect(page.locator('.liquidation-ticker')).toBeVisible();await expect.poll(async()=>(await state(page))?.settings.markers).toBe(true);
 await page.setViewportSize({width:720,height:860});await page.screenshot({path:'/tmp/liquidations-narrow.png'});expect(errors).toEqual([]);
});
test('liquidation subscriptions share ingestion and replay never generates stale notifications',async({page})=>{
 test.setTimeout(90000);const panel=await setup(page);await addIndicator(panel,'Liquidations');await expect.poll(async()=>(await state(page))?.painted).toBeGreaterThan(0);await page.getByRole('button',{name:'Liquidations',exact:true}).click();await page.getByRole('button',{name:'Liquidations',exact:true}).click();await expect(page.locator('.liquidation-ticker')).toHaveCount(2);
 await page.evaluate(()=>(window as any).__terminal.feed.send({type:'diagnostics'}));
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.feed.diagnostics.liquidations?.clients)).toBe(3);expect(await page.evaluate(()=>(window as any).__terminal.feed.diagnostics.liquidations.sockets)).toBe(0);
 const before=await page.evaluate(()=>(window as any).__terminal.notifications.gate.delivered);
 await page.evaluate(()=>{const t=(window as any).__terminal,p=[...t.panels.values()][0],sample=p.liquidationsView.diagnostics().batch.events[0],now=Date.now();t.feed.send({type:'liquidation-fixture',live:false,events:[{...sample,id:'historical-alert-suppressed',timeMs:now-10000,receivedAtMs:now,baseQuantity:100,quoteNotional:8000000}]});});
 await expect.poll(async()=>(await state(page)).batch.events.some((e:any)=>e.id==='historical-alert-suppressed')).toBe(true);expect(await page.evaluate(()=>(window as any).__terminal.notifications.gate.delivered)).toBe(before);
 const ticker=page.locator('.liquidation-ticker').first();await ticker.getByRole('button',{name:'History',exact:true}).click();const history=ticker.getByRole('dialog',{name:'Liquidation history'});await history.getByRole('button',{name:'Load history'}).click();await expect(ticker.getByRole('button',{name:'Play replay',exact:true})).toBeVisible();await ticker.getByRole('button',{name:'Play replay',exact:true}).click();await expect(ticker.getByRole('button',{name:'Pause replay',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__terminal.notifications.gate.delivered)).toBe(before);
 await chooseChartMarket(panel,'Hyperliquid · BTC Perp');await expect.poll(async()=>(await state(page))?.bars).toBeGreaterThan(0);
});
test('fresh worker burst alerts, continuation and pause stay bounded', async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await setup(page);
  await page.getByRole('button', { name: 'Liquidations', exact: true }).click();
  const ticker = page.locator('.liquidation-ticker');
  await expect.poll(() => ticker.locator('[data-event-id]').count()).toBeGreaterThan(0);
  await ticker.getByRole('button', { name: 'Liquidation Ticker settings', exact: true }).click();
  const settings = ticker.getByRole('dialog', { name: 'Liquidation Ticker settings', exact: true });
  await settings.getByLabel('Burst rolling window (seconds)', { exact: true }).fill('10');
  await settings.getByLabel('Burst minimum aggregate notional (USDT)', { exact: true }).fill('1');
  await settings.getByLabel('Burst minimum event count', { exact: true }).fill('2');
  await settings.getByLabel('Enable burst alerts', { exact: true }).check();
  await settings.getByLabel('Burst sound', { exact: true }).selectOption('silent');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await addIndicator(panel, 'Liquidations');
  await expect.poll(async () => (await state(page))?.painted).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as any).__terminal.notifications.gate.delivered);
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const tickerPanel = terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
    const tickerView = tickerPanel?.view.content;
    const sample = tickerView?.latest?.events.find((event: any) => event.venue === 'bybit');
    if (!tickerView || !sample) throw new Error('Worker burst check needs the subscribed ticker batch.');
    const now = Date.now();
    const report = (id: string, timeMs: number) => ({
      ...sample, id, liquidatedSide: 'SHORT', forcedDirection: 'BUY', timeMs, eventTimeMs: timeMs, receivedAtMs: now,
      baseQuantity: .01, quoteNotional: 830,
    });
    terminal.feed.send({ type: 'liquidation-fixture', live: true, events: [
      report('fresh-worker-burst-1', now - 300), report('fresh-worker-burst-2', now - 100),
    ] });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.gate.delivered)).toBeGreaterThan(before);
  await expect(page.locator('.notification-toasts')).toContainText('SHORT LIQUIDATION BURST');
  const active = ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=SHORT]');
  await expect(active).toBeVisible();
  await expect(active).toContainText('SHORTS');
  await expect(active).toContainText('ACTIVE');
  const activeBurstId = await page.evaluate(() =>
    (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content.latest.bursts.find((burst: any) => burst.id === 'burst:SHORT:fresh-worker-burst-1' && burst.state === 'active')?.id,
  );
  expect(activeBurstId).toBeTruthy();
  const testBurstId = activeBurstId!;
  const frozen = await active.textContent();
  await ticker.getByRole('button', { name: 'Pause liquidation tape', exact: true }).click();
  await expect(ticker.getByRole('button', { name: 'Resume liquidation tape', exact: true })).toBeVisible();
  await page.evaluate(burstId => {
    const terminal = (window as any).__terminal;
    const tickerPanel = terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
    const tickerView = tickerPanel?.view.content;
    const sample = tickerView?.latest?.events.find((event: any) => event.venue === 'bybit');
    if (!tickerView || !sample) throw new Error('Paused continuation needs the subscribed ticker batch.');
    const now = Date.now();
    const activeBurst = tickerView.latest.bursts.find((burst: any) => burst.id === burstId);
    if (!activeBurst) throw new Error('The fresh worker burst is no longer active.');
    terminal.feed.send({ type: 'liquidation-fixture', live: true, events: [{
      ...sample, id: 'paused-worker-burst-continuation', liquidatedSide: 'SHORT', forcedDirection: 'BUY',
      timeMs: activeBurst.to + 200, eventTimeMs: activeBurst.to + 200, receivedAtMs: now, baseQuantity: .01, quoteNotional: 830,
    }] });
  }, testBurstId);
  await expect.poll(() => page.evaluate(() =>
    (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content.latest.events.some((event: any) => event.id === 'paused-worker-burst-continuation'),
  )).toBe(true);
  await expect(active).toHaveText(frozen!);
  await ticker.getByRole('button', { name: 'Resume liquidation tape', exact: true }).click();
  await expect.poll(() => page.evaluate(burstId => {
    const batch = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content.latest;
    return batch.bursts.find((burst: any) => burst.id === burstId)?.count;
  }, testBurstId)).toBe(3);
  await expect.poll(() => active.textContent()).not.toBe(frozen);
  await panel.getByRole('button', { name: 'Remove Liquidations', exact: true }).click();
  await expect(panel.locator('[data-liquidations=true]')).toHaveCount(0);
  await expect(ticker.locator('[data-event-id]').first()).toBeVisible();
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.liquidations?.clients ?? 0)).toBe(1);
});

test('explicit deterministic burst presentation fixture covers both sides and compact dock widths', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  const panel = await setup(page);
  await page.getByRole('button', { name: 'Liquidations', exact: true }).click();
  const ticker = page.locator('.liquidation-ticker');
  await expect.poll(() => ticker.locator('[data-event-id]').count()).toBeGreaterThan(0);
  const panelId = await panel.getAttribute('data-panel-id');
  expect(panelId).toBeTruthy();
  const fixture = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const dockPanel = terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
    const view = dockPanel?.view.content;
    if (!view) throw new Error('Liquidation presentation fixture cannot find the Dockview ticker renderer.');
    view.release?.(); view.release = undefined;
    clearInterval(view.refreshTimer); view.refreshTimer = undefined;
    view.feed.updateLiquidations = () => {};
    const batch = view.latest;
    if (!batch) throw new Error('Liquidation presentation fixture needs an initial batch.');
    const now = Date.now(), baseTime = Math.floor(now / 1000) * 1000;
    const sample = batch.events.find((event: any) => event.venue === 'bybit') ?? batch.events[0];
    const makeEvent = (id: string, side: 'LONG' | 'SHORT', venue: 'bybit' | 'binance', timeMs: number, notional: number) => ({
      ...sample, id, venue, instrument: `${venue}:perpetual:BTCUSDT`, market: 'perpetual', nativeSymbol: 'BTCUSDT',
      liquidatedSide: side, forcedDirection: side === 'LONG' ? 'SELL' : 'BUY', timeMs, eventTimeMs: timeMs, receivedAtMs: now,
      reportedPrice: 67000, reportedPriceText: '67000', priceType: venue === 'bybit' ? 'bankruptcy' : 'average-fill',
      baseQuantity: notional / 67000, baseQuantityText: String(notional / 67000),
      quantityBasis: venue === 'bybit' ? 'reported-executed-size' : 'reported-cumulative-filled',
      quoteNotional: notional, quoteNotionalText: String(notional),
      notionalBasis: venue === 'bybit' ? 'bankruptcy-price-times-size' : 'average-fill-times-cumulative-filled',
      source: venue === 'bybit' ? 'bybit-v5-allLiquidation' : 'binance-usdm-forceOrder',
      reportingCoverage: venue === 'bybit' ? 'all-reported-liquidations' : 'latest-per-symbol-1000ms',
      provenance: { ...sample.provenance, sideMeaning: venue === 'bybit' ? 'liquidated-position' : 'forced-order',
        reportedSide: venue === 'bybit' ? side === 'LONG' ? 'Sell' : 'Buy' : side === 'LONG' ? 'SELL' : 'BUY',
        forcedDirectionBasis: venue === 'bybit' ? 'opposite-reported-position-side' : 'reported-order-side' },
    });
    const makeBurst = (id: string, side: 'LONG' | 'SHORT', status: 'active' | 'completed', startOffset: number, amounts: number[]) => {
      const events = amounts.map((notional, index) => makeEvent(`${id}-report-${index + 1}`, side, index % 2 ? 'binance' : 'bybit', baseTime - startOffset + index * 1000 + 250, notional));
      const venues = { bybit: 0, binance: 0 };
      for (const event of events) venues[event.venue as 'bybit' | 'binance'] += event.quoteNotional;
      const histogram = events.map(event => ({
        from: Math.floor(event.timeMs / 1000) * 1000, to: Math.floor(event.timeMs / 1000) * 1000 + 1000,
        notional: event.quoteNotional, count: 1, venues: { [event.venue]: event.quoteNotional },
      }));
      return {
        id, side, from: events[0].timeMs, to: events.at(-1).timeMs,
        notional: amounts.reduce((sum, amount) => sum + amount, 0), count: events.length, venues, events, notify: false,
        state: status, closedAt: status === 'completed' ? events.at(-1).timeMs + 13000 : null,
        quality: 'complete', coverageGap: false, retainedEventCount: events.length,
        histogram, histogramStepMs: 1000,
      };
    };
    const longs = makeBurst('presentation-long-active', 'LONG', 'active', 9000, [250000, 650000, 1150000, 450000]);
    const shorts = makeBurst('presentation-short-active', 'SHORT', 'active', 8000, [1200000, 1750000, 2050000, 850000]);
    const completed = makeBurst('presentation-short-completed', 'SHORT', 'completed', 30000, [500000, 700000, 450000, 900000]);
    const scaleControl = makeEvent('presentation-independent-scale-report', 'LONG', 'bybit', now - 200, 8000000);
    batch.events = [...longs.events, ...shorts.events, ...completed.events, scaleControl].sort((a: any, b: any) => b.timeMs - a.timeMs);
    batch.bursts = [completed, longs, shorts]; batch.burstAlerts = [];
    const summaryLongs = batch.events.filter((event: any) => event.liquidatedSide === 'LONG').reduce((sum: number, event: any) => sum + event.quoteNotional, 0);
    const summaryShorts = batch.events.filter((event: any) => event.liquidatedSide === 'SHORT').reduce((sum: number, event: any) => sum + event.quoteNotional, 0);
    batch.summary = [60000, 300000, 900000].map(windowMs => ({
      windowMs, longs: summaryLongs, shorts: summaryShorts, total: summaryLongs + summaryShorts,
      count: batch.events.length, unknown: 0, ratio: summaryShorts > 0 ? summaryLongs / summaryShorts : null,
    }));
    batch.coverage = { asOf: now, head: 120, retentionDays: 7, semantics: 'reported-events-only', sources: [
      { venue: 'bybit', state: 'live', observedFrom: now - 60000, verifiedThrough: now, lastEventAt: now - 1000, lastTrafficAt: now, gaps: [], message: 'Explicit presentation fixture', rejected: 0, dropped: 0, reconnects: 0 },
      { venue: 'binance', state: 'live', observedFrom: now - 60000, verifiedThrough: now, lastEventAt: now - 1000, lastTrafficAt: now, gaps: [], message: 'Explicit presentation fixture', rejected: 0, dropped: 0, reconnects: 0 },
    ] };
    view.draw();
    return { kind: 'explicit-deterministic-ui-presentation-fixture-not-worker-flow-or-live-data', ids: [longs.id, shorts.id, completed.id], totals: [longs.notional, shorts.notional, completed.notional] };
  });
  expect(fixture.kind).toBe('explicit-deterministic-ui-presentation-fixture-not-worker-flow-or-live-data');
  await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=LONG]')).toContainText('2.50M USDT');
  await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=SHORT]')).toContainText('5.85M USDT');
  await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-activity-bar')).toHaveCount(8);
  await expect(ticker.locator('.liquidation-completed-row .liquidation-burst-card')).toContainText('COMPLETED');
  await expect(ticker.locator('.liquidation-tape-table tbody .liquidation-report-row')).toHaveCount(13);
  const summary = ticker.locator('.liquidation-completed-row .liquidation-burst-card').first();
  const quality = summary.getByRole('button', { name: /Open observed coverage evidence for SHORT burst/ });
  await quality.click();
  const inspector = ticker.getByRole('dialog', { name: 'Liquidation burst details' });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Coverage evidence');
  await expect(inspector).toContainText('quiet check through');
  await expect(inspector).toContainText('Binance reports are sampled cumulative snapshots and may overlap. This total is reported activity, not verified unique liquidation volume.');
  await expect(inspector).toContainText('verified through');
  await inspector.getByRole('button', { name: 'Constituents', exact: true }).click();
  await expect(inspector.locator('.liquidation-constituent-table tbody tr')).toHaveCount(4);
  await expect(inspector.locator('.liquidation-burst-inspector-note')).toContainText('detector retention');
  const focus = inspector.getByRole('button', { name: /Focus chart at bybit report time/ }).first();
  await focus.focus();
  const focusLabel = await focus.getAttribute('aria-label');
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const dockPanel = terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
    const view = dockPanel?.view.content;
    if (!view) throw new Error('Liquidation presentation fixture lost its Dockview ticker renderer.');
    view.latest.events.push({ ...view.latest.events[0], id: 'presentation-fixture-keyed-rerender' });
    view.draw();
  });
  await expect.poll(() => focus.getAttribute('aria-label')).toBe(focusLabel);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(focusLabel);
  await inspector.getByRole('button', { name: 'Coverage evidence', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Coverage evidence', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await inspector.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(quality).toBeFocused();
  await ticker.getByRole('button', { name: 'Pause liquidation tape', exact: true }).focus();
  await page.mouse.move(0, 0);
  await expect(ticker.locator('.liquidation-burst-hover')).toBeHidden();

  const scaleBefore = await page.evaluate(() => {
    const long = document.querySelector<HTMLElement>('.liquidation-active-bursts .liquidation-burst-card[data-side="LONG"] .liquidation-burst-size-fill')!;
    const short = document.querySelector<HTMLElement>('.liquidation-active-bursts .liquidation-burst-card[data-side="SHORT"] .liquidation-burst-size-fill')!;
    const ordinary = document.querySelector<HTMLElement>('.liquidation-report-row[data-event-id="presentation-independent-scale-report"]')!;
    return { longWidth: long.style.width, shortWidth: short.style.width, reportWidth: ordinary.style.getPropertyValue('--liquidation-report-width') };
  });
  await page.evaluate(() => {
    const view = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content;
    const burst = view.latest.bursts.find((item: any) => item.id === 'presentation-long-active');
    burst.notional += 1000000; burst.venues.bybit += 1000000; burst.histogram[0].notional += 1000000; burst.histogram[0].venues.bybit += 1000000;
    view.draw();
  });
  const scaleAfter = await page.evaluate(() => ({
    longWidth: document.querySelector<HTMLElement>('.liquidation-active-bursts .liquidation-burst-card[data-side="LONG"] .liquidation-burst-size-fill')!.style.width,
    shortWidth: document.querySelector<HTMLElement>('.liquidation-active-bursts .liquidation-burst-card[data-side="SHORT"] .liquidation-burst-size-fill')!.style.width,
    reportWidth: document.querySelector<HTMLElement>('.liquidation-report-row[data-event-id="presentation-independent-scale-report"]')!.style.getPropertyValue('--liquidation-report-width'),
  }));
  expect(scaleAfter.longWidth).not.toBe(scaleBefore.longWidth);
  expect(scaleAfter.shortWidth).toBe(scaleBefore.shortWidth);
  expect(scaleAfter.reportWidth).toBe(scaleBefore.reportWidth);
  await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=LONG]')).toContainText('3.50M USDT');

  await page.evaluate(() => {
    const view = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content;
    const burst = view.latest.bursts.find((item: any) => item.id === 'presentation-short-completed');
    delete burst.histogram; delete burst.histogramStepMs; view.draw();
  });
  const legacyActivity = ticker.locator('.liquidation-completed-row .liquidation-burst-card[data-burst-id="presentation-short-completed"] .liquidation-burst-activity');
  await expect(legacyActivity).toHaveAttribute('aria-label', 'Activity histogram unavailable in this batch; no bars are inferred.');
  await expect(legacyActivity.locator('.liquidation-burst-activity-bar')).toHaveCount(0);
  await page.evaluate(() => {
    const view = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker').view.content;
    const burst = view.latest.bursts.find((item: any) => item.id === 'presentation-short-completed');
    const events = burst.events;
    burst.histogram = events.map((event: any) => ({ from: Math.floor(event.timeMs / 1000) * 1000, to: Math.floor(event.timeMs / 1000) * 1000 + 1000,
      notional: event.quoteNotional, count: 1, venues: { [event.venue]: event.quoteNotional } }));
    burst.histogramStepMs = 1000; view.draw();
  });

  await page.evaluate(() => {
    const panel = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
    panel.group.api.setSize({ width: 320 });
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const summaryRows = ticker.locator('.liquidation-summary-window');
  await expect(summaryRows).toHaveCount(3);
  await expect.poll(() => summaryRows.evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
  await expect.poll(() => ticker.locator('.liquidation-summary').evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  )).toBe(1);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const activeLongQuality = ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=LONG] .liquidation-burst-quality');
  await activeLongQuality.focus();
  const hoverCard = ticker.locator('.liquidation-burst-hover');
  await expect(hoverCard).toBeVisible();
  await expect(hoverCard).toContainText('Observed coverage; open the coverage button for verification, gaps and retention.');
  await expect(hoverCard).toContainText('Bybit value uses bankruptcy price.');
  const hoverActivityBars = hoverCard.locator('.liquidation-burst-detail-activity-bar');
  await expect(hoverActivityBars).toHaveCount(4);
  await expect.poll(() => hoverActivityBars.evaluateAll(bars => bars.every(bar => {
    const style = getComputedStyle(bar);
    return parseFloat(style.height) > 0 && parseFloat(style.width) > 0 && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }))).toBe(true);
  const hoverLayout = await hoverCard.evaluate(element => {
    const metrics = element.querySelector<HTMLElement>('.liquidation-burst-detail-metrics')!;
    const card = element.getBoundingClientRect(), host = element.closest('.liquidation-ticker')!.getBoundingClientRect();
    return { height: element.clientHeight, width: element.clientWidth, scrollHeight: element.scrollHeight, scrollWidth: element.scrollWidth,
      metricTracks: getComputedStyle(metrics).gridTemplateColumns.trim().split(/\s+/).length,
      insideHost: card.left >= host.left && card.right <= host.right && card.top >= host.top && card.bottom <= host.bottom };
  });
  expect(hoverLayout.height).toBeLessThan(380);
  expect(hoverLayout.scrollHeight).toBeLessThanOrEqual(hoverLayout.height);
  expect(hoverLayout.scrollWidth).toBeLessThanOrEqual(hoverLayout.width);
  expect(hoverLayout.metricTracks).toBe(1);
  expect(hoverLayout.insideHost).toBe(true);
  await page.screenshot({ path: 'artifacts/liquidations/burst-tape-presentation-fixture-1366x768-320px-dock-hover-dark.png' });
  await ticker.getByRole('button', { name: 'Pause liquidation tape', exact: true }).focus();
  await page.mouse.move(0, 0);
  await expect(hoverCard).toBeHidden();

  const capture = async (width: number, height: number, theme: 'dark' | 'light', dockTarget = 320) => {
    await page.setViewportSize({ width, height });
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.evaluate(target => {
      const panel = (window as any).__terminal.dock.panels.find((item: any) => item.view.contentComponent === 'liquidation-ticker');
      panel.group.api.setSize({ width: target });
    }, dockTarget);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=LONG]')).toBeVisible();
    await expect(ticker.locator('.liquidation-active-bursts .liquidation-burst-card[data-side=SHORT]')).toBeVisible();
    const geometry = await ticker.evaluate(element => ({
      dockWidth: element.clientWidth,
      dockGroupWidth: element.closest('.dv-groupview')?.clientWidth ?? element.clientWidth,
    }));
    expect(geometry.dockWidth).toBeGreaterThanOrEqual(dockTarget - 24);
    expect(geometry.dockWidth).toBeLessThanOrEqual(dockTarget + 12);
    const path = `artifacts/liquidations/burst-tape-presentation-fixture-${width}x${height}-${dockTarget}px-dock-${theme}.png`;
    await page.screenshot({ path });
    return { path, ...geometry };
  };
  const captures = [];
  captures.push(await capture(1366, 768, 'dark'));
  captures.push(await capture(1366, 768, 'light'));
  captures.push(await capture(1366, 768, 'dark', 500));
  captures.push(await capture(720, 860, 'dark'));
  captures.push(await capture(720, 860, 'light'));
  await ticker.getByRole('button', { name: 'Liquidation Ticker settings', exact: true }).click();
  const settings = ticker.getByRole('dialog', { name: 'Liquidation Ticker settings', exact: true });
  await settings.getByLabel('Show bursts in tape', { exact: true }).uncheck();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(ticker.locator('.liquidation-active-bursts')).toBeHidden();
  await expect(ticker.locator('.liquidation-completed-row')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return (Object.values(saved.layout.panels) as any[]).find(item => item.contentComponent === 'liquidation-ticker')?.params.showBursts;
  })).toBe(false);
  await page.reload();
  const reloadedTicker = page.locator('.liquidation-ticker');
  await expect(reloadedTicker).toBeVisible();
  await expect(reloadedTicker.locator('.liquidation-active-bursts')).toBeHidden();
  await expect(reloadedTicker.locator('.liquidation-completed-row')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ kind: fixture.kind, captures }));
});

test('liquidation bar tooltip matches positioning cards with side-specific venue totals and bounded placement', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const panel = await setup(page);
  await addIndicator(panel, 'Liquidations');
  await expect.poll(async () => (await state(page))?.painted).toBeGreaterThan(0);
  const card = panel.locator('.liquidation-tooltip');
  const hover = async (side: 'LONG' | 'SHORT') => {
    const hit = await page.evaluate(side => {
      const p = [...(window as any).__terminal.panels.values()][0];
      const view = p.liquidationsView, chart = p.engine.chart, plot = chart.plotRect(view.paneIndex());
      const bars = view.diagnostics().batch.bars;
      for (const bar of [...bars].reverse()) {
        const values = side === 'LONG' ? bar.longs : bar.shorts;
        const total = values.bybit + values.binance;
        const x = chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(bar.time / 1000));
        const y = view.anchor.priceScale().priceToY((side === 'LONG' ? -1 : 1) * total / 2);
        if (total > 0 && x > 20 && x < plot.width - 20 && y > 15 && y < plot.height - 15) {
          return { x: plot.left + x, y: plot.top + y, total, values, time: bar.time };
        }
      }
      return null;
    }, side);
    expect(hit).not.toBeNull();
    const stage = await panel.locator('.chart-stage').boundingBox(); expect(stage).not.toBeNull();
    await page.mouse.move(0, 0);
    await page.mouse.move(stage!.x + hit!.x, stage!.y + hit!.y);
    await expect(card).toBeVisible();
    await expect(card.locator('.positioning-tooltip-heading')).toContainText(side === 'LONG' ? 'Long liquidations' : 'Short liquidations');
    await expect(card).toContainText('BY[P]'); await expect(card).toContainText('BN[P]');
    await expect(card.locator('.positioning-tooltip-row')).toHaveCount(2);
    await expect(card.locator('.positioning-tooltip-total')).toContainText('Reported (2 venues)');
    for (const venue of ['bybit', 'binance'] as const) {
      await expect(card.locator(`[data-venue="${venue}"] .positioning-tooltip-amount`)).toContainText(hit!.values[venue].toLocaleString('en-US', { maximumFractionDigits: 3 }));
    }
    await expect(card.locator('.positioning-tooltip-status')).toContainText('cumulative snapshots may overlap');
    await expect(card.locator('.positioning-tooltip-status')).toContainText('Reported events only');
    const bounds = (await card.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(stage!.x);
    expect(bounds.y).toBeGreaterThanOrEqual(stage!.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage!.x + stage!.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(stage!.y + stage!.height);
    expect(await card.evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth)).toBe(true);
  };
  for (const theme of ['dark', 'light'] as const) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await hover('LONG');
    await expect(card.locator('.positioning-tooltip-heading')).toContainText('USDT');
    await page.screenshot({ path: `/tmp/liquidations-tooltip-${theme}.png` });
    await hover('SHORT');
  }
  const beforeUnits = (await state(page)).batch.batchId;
  await panel.getByRole('button', { name: 'Liquidations settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Liquidations settings', exact: true });
  await settings.getByLabel('Liquidation display unit', { exact: true }).selectOption('BTC');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await state(page)).settings.units).toBe('BTC');
  await expect.poll(async () => (await state(page)).batch.batchId).toBeGreaterThan(beforeUnits);
  await page.setViewportSize({ width: 720, height: 860 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await hover('LONG'); await expect(card.locator('.positioning-tooltip-heading')).toContainText('BTC');
  await page.screenshot({ path: '/tmp/liquidations-tooltip-narrow.png' });
  await page.mouse.move(0, 0); await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test('liquidation venue toggles filter the pane, survive reload, and stay accessible in compact headers', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const panel = await setup(page); await addIndicator(panel, 'Liquidations');
  await expect.poll(async () => (await state(page))?.painted).toBeGreaterThan(0);
  const legend = panel.getByRole('group', { name: 'Liquidation venues', exact: true });
  const bybit = legend.getByRole('button', { name: 'Show Bybit liquidation reports', exact: true });
  const binance = legend.getByRole('button', { name: 'Show Binance liquidation reports', exact: true });
  await expect(bybit).toHaveAttribute('aria-pressed', 'true');
  await expect(binance).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    (window as any).__liquidationVenueEngine = p.engine;
    return p.engine.chart.timeScale.visibleRange();
  });
  await bybit.click();
  await expect(bybit).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await state(page)).batch.bars.every((bar: any) => bar.longs.bybit === 0 && bar.shorts.bybit === 0)).toBe(true);
  expect((await state(page)).settings.venues).toEqual(['binance']);
  await binance.focus(); await binance.press('Space');
  await expect(binance).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await state(page)).bars).toBe(0);
  await expect(panel.locator('.liquidation-pane-status')).toContainText('Choose an exchange.');
  await bybit.focus(); await bybit.press('Space');
  await expect(bybit).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).painted).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).batch.events.every((event: any) => event.venue === 'bybit')).toBe(true);
  const after = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0];
    return { sameEngine: p.engine === (window as any).__liquidationVenueEngine, range: p.engine.chart.timeScale.visibleRange() };
  });
  expect(after.sameEngine).toBe(true); expect(after.range).toEqual(before);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.screenshot({ path: '/tmp/liquidations-venues-dark.png' });
  await page.reload();
  await expect.poll(async () => (await state(page))?.settings.venues).toEqual(['bybit']);
  await expect(bybit).toHaveAttribute('aria-pressed', 'true');
  await expect(binance).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 430, height: 860 });
  await expect(bybit).toHaveAttribute('data-compact', 'true');
  await expect(bybit.locator('span')).toBeHidden();
  await expect(bybit).toBeVisible(); await expect(binance).toBeVisible();
  const stage = (await panel.locator('.chart-stage').boundingBox())!, bounds = (await legend.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(stage.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x + stage.width);
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.screenshot({ path: '/tmp/liquidations-venues-compact.png' });
  await binance.focus(); await binance.press('Enter');
  await expect(binance).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).settings.venues.length).toBe(2);
  expect(errors).toEqual([]);
});

test('liquidation coverage gaps stop at now across forming bars, pan, resize and themes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const root = window as any;
    root.__liquidationShadeRects = [];
    const native = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x: number, y: number, width: number, height: number) {
      const color = String(this.fillStyle).toLowerCase();
      if (this.globalAlpha === .06 && (color === '#858585' || color === '#485567')) {
        const rect = this.canvas.getBoundingClientRect();
        root.__liquidationShadeRects.push({ x, y, width, height, color, canvasLeft: rect.left, canvasTop: rect.top, canvasWidth: rect.width });
      }
      return native.call(this, x, y, width, height);
    };
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  const panel = await setup(page); await addIndicator(panel, 'Liquidations');
  await expect.poll(async () => (await state(page))?.painted).toBeGreaterThan(0);
  const panelId = await panel.getAttribute('data-panel-id'); expect(panelId).toBeTruthy();
  await page.waitForTimeout(250);
  await page.evaluate(id => {
    const root = window as any, view = root.__terminal.panels.get(id).liquidationsView;
    view.release?.(); view.release = undefined;
    let batch = view.batch;
    Object.defineProperty(view, 'batch', { configurable: true, get: () => batch, set: value => { if (!root.__liquidationFixtureBatchLocked) batch = value; } });
    root.__liquidationFixtureBatchLocked = true;
    view.feed.updateLiquidations = () => {};
  }, panelId!);
  const panelState = () => page.evaluate(id => (window as any).__terminal.panels.get(id).liquidationsView.diagnostics(), panelId!);

  const installFixture = async (phase: 'initial' | 'replace' | 'append') => {
    const before = (await panelState()).draws;
    const fixture = await page.evaluate(({ id, phase }) => {
      const p = (window as any).__terminal.panels.get(id), view = p.liquidationsView, engine = p.engine, now = Date.now(), interval = 60_000;
      const floor = (time: number) => Math.floor(time / interval) * interval;
      const bar = (time: number, value: number) => ({ time: floor(time), longs: { bybit: value, binance: 0 }, shorts: { bybit: value / 2, binance: 0 } });
      const pastGap = { from: floor(now - 120 * interval), to: floor(now - 108 * interval), reason: 'fixture-disconnect' };
      const verifiedThrough = now - 30 * interval;
      const originalBars = [bar(now - 160 * interval, 140), bar(now - 12 * interval, 240)];
      const bars = [...originalBars];
      if (phase === 'replace') bars[1] = bar(now - 12 * interval, 480);
      if (phase === 'append') { bars[1] = bar(now - 12 * interval, 480); bars.push(bar(now - interval, 360)); }
      const source = { observedFrom: now - 7 * 86400_000, lastEventAt: verifiedThrough, lastTrafficAt: verifiedThrough,
        message: 'Explicit browser coverage fixture', rejected: 0, dropped: 0, reconnects: 1 };
      view.batch.coverage = { asOf: now - 60 * interval, head: 1, retentionDays: 7, semantics: 'reported-events-only', sources: [
        { ...source, venue: 'bybit', state: 'stale', verifiedThrough, gaps: [pastGap] },
        { ...source, venue: 'binance', state: 'live', lastEventAt: now, lastTrafficAt: now, verifiedThrough: now, gaps: [] },
      ] };
      view.batch.bars = bars;
      const base = engine.chart.dataLayer.baseIndex;
      engine.setRange({ from: base - 220, to: base + 40 });
      (window as any).__liquidationFixture = { now, pastGap, verifiedThrough, phase, barTimes: bars.map((item: any) => item.time) };
      (window as any).__liquidationShadeRects = [];
      view.draw();
      return { now, pastGap, verifiedThrough, phase, bars: bars.map((item: any) => ({ time: item.time, long: item.longs.bybit })) };
    }, { id: panelId!, phase });
    await expect.poll(async () => (await panelState()).draws).toBeGreaterThan(before);
    await page.waitForTimeout(70);
    expect((await panelState()).batch.bars.map((bar: any) => bar.time)).toContain(fixture.bars.at(-1)?.time);
    return fixture;
  };

  const verifyCoveragePaint = async () => {
    const result = await page.evaluate(id => {
      const p = (window as any).__terminal.panels.get(id), chart = p.engine.chart, view = p.liquidationsView;
      const fixture = (window as any).__liquidationFixture, plot = chart.plotRect(view.paneIndex());
      const xAt = (time: number) => chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(time / 1000));
      const nowX = xAt(fixture.now), gapStart = xAt(fixture.pastGap.from), gapEnd = xAt(fixture.pastGap.to), tailStart = xAt(fixture.verifiedThrough);
      const rects = ((window as any).__liquidationShadeRects as any[]).filter(rect => Math.abs(rect.canvasLeft - (document.querySelector('.chart-stage')!.getBoundingClientRect().left + plot.left)) < 3);
      const uniqueRects = [...new Map(rects.map(rect => [`${Math.round(rect.x)}:${Math.round(rect.width)}`, rect])).values()];
      return { nowX, gapStart, gapEnd, tailStart, plotWidth: plot.width, rects: uniqueRects, futureOnly: chart.dataLayer.timeToIndexFloat(fixture.now / 1000) < chart.timeScale.visibleRange().to };
    }, panelId!);
    expect(result.futureOnly).toBe(true);
    expect(result.rects).toHaveLength(2);
    expect(result.rects.every((rect: any) => rect.x + rect.width <= result.nowX + 2)).toBe(true);
    expect(result.rects.some((rect: any) => Math.abs(rect.x - result.gapStart) <= 2 && Math.abs(rect.x + rect.width - result.gapEnd) <= 2)).toBe(true);
    expect(result.rects.some((rect: any) => Math.abs(rect.x - result.tailStart) <= 2 && Math.abs(rect.x + rect.width - result.nowX) <= 2)).toBe(true);
    return result;
  };

  await installFixture('initial');
  await installFixture('replace');
  expect((await panelState()).batch.bars).toHaveLength(2);
  const rangeBeforePan = await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.timeScale.visibleRange(), panelId!);
  const stage = (await panel.locator('.chart-stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width * .65, stage.y + stage.height * .32);
  await page.mouse.down(); await page.mouse.move(stage.x + stage.width * .58, stage.y + stage.height * .32, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.chart.timeScale.visibleRange(), panelId!)).not.toEqual(rangeBeforePan);
  await page.waitForTimeout(220);
  await installFixture('append');
  expect((await panelState()).batch.bars).toHaveLength(3);
  let paint = await verifyCoveragePaint();

  const capture = async (width: number, height: number, theme: 'dark' | 'light') => {
    await page.setViewportSize({ width, height });
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (width !== 1366) { await page.waitForTimeout(220); await installFixture('append'); }
    paint = await verifyCoveragePaint();
    await expect.poll(async () => (await panelState()).batch.bars).toHaveLength(3);
    await expect(panel.locator('.liquidation-pane-status')).toContainText('Some exchange data is delayed.');
    await expect(panel.locator('.liquidation-pane-status')).toContainText('Some reports may be missing.');
    const path = `artifacts/liquidations/coverage-now-${width}x${height}-${theme}.png`;
    await page.screenshot({ path });
    return { path, plotWidth: paint.plotWidth, overlayRects: paint.rects.length, futureOverlayRects: paint.rects.filter((rect: any) => rect.x + rect.width > paint.nowX + 2).length };
  };
  const captures = [];
  captures.push(await capture(1366, 768, 'dark'));
  captures.push(await capture(1366, 768, 'light'));
  captures.push(await capture(720, 860, 'light'));
  captures.push(await capture(720, 860, 'dark'));
  expect(errors).toEqual([]);
  expect(captures.every(item => item.futureOverlayRects === 0)).toBe(true);
  console.log(JSON.stringify({ kind: 'explicit liquidation coverage fixture on installed chart engine', bars: (await panelState()).batch.bars.map((bar: any) => bar.time), pastGap: (await page.evaluate(() => (window as any).__liquidationFixture.pastGap)), captures }));
});

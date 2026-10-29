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
test('fresh burst alerts use shared notifications; inspection and removing a consumer preserve the tape',async({page})=>{
 test.setTimeout(90000);const panel=await setup(page);await page.getByRole('button',{name:'Liquidations',exact:true}).click();const ticker=page.locator('.liquidation-ticker');await expect.poll(()=>ticker.locator('[data-event-id]').count()).toBeGreaterThan(0);
 await ticker.getByRole('button',{name:'Liquidation Ticker settings',exact:true}).click();const dialog=ticker.getByRole('dialog');await dialog.getByLabel('Burst rolling window (seconds)',{exact:true}).fill('1');await dialog.getByLabel('Burst minimum aggregate notional (USDT)',{exact:true}).fill('1');await dialog.getByLabel('Burst minimum event count',{exact:true}).fill('2');await dialog.getByLabel('Enable burst alerts',{exact:true}).check();await dialog.getByLabel('Burst sound',{exact:true}).selectOption('silent');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await addIndicator(panel,'Liquidations');await expect.poll(async()=>(await state(page))?.painted).toBeGreaterThan(0);await page.waitForTimeout(1200);const before=await page.evaluate(()=>(window as any).__terminal.notifications.gate.delivered);
 await page.evaluate(()=>{const t=(window as any).__terminal,p=[...t.panels.values()][0],sample=p.liquidationsView.diagnostics().batch.events.find((e:any)=>e.venue==='bybit'),now=Date.now();t.feed.send({type:'liquidation-fixture',live:true,events:[0,1].map(i=>({...sample,id:`fresh-burst-browser-${i}`,liquidatedSide:'SHORT',forcedDirection:'BUY',timeMs:now+i,receivedAtMs:now,baseQuantity:.01,quoteNotional:830}))});});
 await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.notifications.gate.delivered)).toBeGreaterThan(before);await expect(ticker.locator('.liquidation-bursts')).toContainText('SHORT LIQUIDATION BURST');await expect(page.locator('.notification-toasts')).toContainText('SHORT LIQUIDATION BURST');
 const burst=ticker.locator('.liquidation-bursts details').last();await burst.locator('summary').click();await expect(burst).toHaveAttribute('open','');await expect(burst).toContainText('BYBIT');
 await panel.getByRole('button',{name:'Remove Liquidations',exact:true}).click();await expect(panel.locator('[data-liquidations=true]')).toHaveCount(0);await expect(ticker.locator('[data-event-id]').first()).toBeVisible();await page.evaluate(()=>(window as any).__terminal.feed.send({type:'diagnostics'}));await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.feed.diagnostics.liquidations.clients)).toBe(1);
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
  await expect(panel.locator('.liquidation-pane-status')).toContainText('No liquidation venues selected');
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

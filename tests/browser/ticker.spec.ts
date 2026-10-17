import { test, expect } from '@playwright/test';
import { installTradeFixture } from './trade-fixture';
import { addIndicator, chooseChartMarket } from './indicator-actions';

test('clear trades empties the panel tape without resetting the shared feed',async({page})=>{
  const worker=await installTradeFixture(page);await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(10));const rows=ticker.locator('.ticker-table .ticker-row');await expect(rows).toHaveCount(1);await expect(rows.first()).toHaveAttribute('data-execution-id','binance:perpetual:BTCUSDT:agg:1');
  const before=await worker.evaluate(()=>(self as any).__tradeFixture.sockets);
  await ticker.getByRole('button',{name:'Clear trades',exact:true}).click();await expect(rows).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(0);
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(5));await expect(rows).toHaveCount(1);await expect(rows.first()).toHaveAttribute('data-execution-id','binance:perpetual:BTCUSDT:agg:2');
  expect(await worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);expect(await worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(before);
});

test('ticker reported prints, tiers, notifications, pause, shared footprint socket and persistence',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({colorScheme:'dark'});const worker=await installTradeFixture(page);
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);
  await ticker.getByRole('button',{name:'Enable audio',exact:true}).click();await expect(ticker.getByRole('button',{name:'Audio enabled'})).toBeVisible();
  await ticker.getByRole('button',{name:'Ticker markets',exact:true}).click();const picker=ticker.locator('.market-picker').first();await picker.getByRole('searchbox',{name:'Search markets'}).fill('BTCUSDT');await expect(picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true})).toBeChecked();await expect(picker.getByRole('checkbox',{name:'Binance · BTCUSDT Spot',exact:true})).toBeEnabled();await picker.getByRole('button',{name:'Cancel',exact:true}).click();
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(10));await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);await expect(ticker.locator('.ticker-table .ticker-row')).toContainText('1M USDT');await expect(page.locator('.notification-toast')).toContainText('Very large');
  await worker.evaluate(()=>{const p=(self as any).__tradeFixture;p.emit(10,'buy',1);});await page.waitForTimeout(250);await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);
  await ticker.getByRole('button',{name:'Pause',exact:true}).click();await worker.evaluate(()=>(self as any).__tradeFixture.emit(1,'sell'));await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(2);await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);await ticker.getByRole('button',{name:'Return to live'}).click();await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(2);
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();const settings=ticker.locator('.ticker-settings');await settings.getByLabel('Minimum displayed size',{exact:true}).fill('2000000');await settings.getByRole('button',{name:'Apply',exact:true}).click();await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(0);
  await page.waitForTimeout(1100);const delivery=await page.evaluate(()=>(window as any).__terminal.notifications.diagnostics().delivered);await worker.evaluate(()=>(self as any).__tradeFixture.emit(10));await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.notifications.diagnostics().delivered)).toBeGreaterThan(delivery);await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(0);
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();const tier=settings.locator('.ticker-tier-table tbody tr').last();await tier.getByLabel('Tier name',{exact:true}).fill('Whale');await tier.getByLabel('Minimum size',{exact:true}).fill('1500000');await tier.getByRole('button',{name:'Test Tier'}).click();await expect(settings.locator('.ticker-tier-preview .ticker-row')).toHaveCount(1);const retained=await page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained);expect(retained).toBe(3);await settings.getByRole('button',{name:'Apply',exact:true}).click();expect(await worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(1);
  const chart=page.locator('.candle-panel').first();await addIndicator(chart,'Footprint');await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(1);
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(25,'sell'));await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);
  await page.evaluate(()=>{const t=(window as any).__terminal;const p=t.dock.panels.find((p:any)=>p.view.contentComponent==='trade-ticker');p.api.setSize({width:720});});await page.waitForTimeout(200);await page.screenshot({path:'artifacts/trade-ticker-1366x768.png'});
  await page.waitForTimeout(400);await page.reload();await expect(page.locator('.trade-ticker')).toHaveCount(1);await page.locator('.trade-ticker').getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await expect(page.locator('.ticker-settings').getByLabel('Minimum displayed size',{exact:true})).toHaveValue('2000000');await expect(page.locator('.ticker-settings .ticker-tier-table tbody tr').last().getByLabel('Tier name',{exact:true})).toHaveValue('Whale');expect(errors).toEqual([]);
});

test('ticker header controls remain accessible without horizontal scroll at narrow width',async({page})=>{
  await installTradeFixture(page);
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await expect(ticker.getByRole('button',{name:'Pause',exact:true}).locator('svg')).toHaveCount(1);
  await expect(ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).locator('svg')).toHaveCount(1);
  await expect(ticker.getByRole('button',{name:'Enable audio',exact:true}).locator('svg')).toHaveCount(1);
  await expect(page.locator('.candle-panel').first().getByRole('button',{name:'Latest',exact:true}).locator('svg')).toHaveCount(1);
  await page.evaluate(()=>{const panel=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='trade-ticker');panel.api.setSize({width:594});});
  const toolbar=ticker.locator('.ticker-toolbar');let dimensions=await toolbar.evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
  expect(dimensions.clientWidth).toBeGreaterThan(500);expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await ticker.screenshot({path:'artifacts/trade-ticker-pane-594.png'});
  await page.setViewportSize({width:594,height:780});
  dimensions=await toolbar.evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.screenshot({path:'artifacts/trade-ticker-594x780.png'});
});

test('chart single market picker, independent ticker instances, hidden rendering and complete teardown',async({page})=>{
  const worker=await installTradeFixture(page);const chart=page.locator('.candle-panel').first();await chooseChartMarket(chart,'Binance · BTCUSDT Spot');await expect(chart.getByRole('button',{name:'Chart market',exact:true})).toContainText('Spot');await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].series.market)).toBe('spot');
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();await expect(page.locator('.trade-ticker')).toHaveCount(2);await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);await worker.evaluate(()=>(self as any).__tradeFixture.emit(.5));await expect(page.locator('.trade-ticker').first().locator('.ticker-table .ticker-row')).toHaveCount(1);await expect(page.locator('.trade-ticker').last().locator('.ticker-table .ticker-row')).toHaveCount(1);
  await page.evaluate(()=>{const t=(window as any).__terminal,panels=t.dock.panels.filter((p:any)=>p.view.contentComponent==='trade-ticker');panels[1].api.moveTo({group:panels[0].api.group});panels[0].api.setActive();});
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()].filter((p:any)=>!p.diagnostics().visible).length)).toBe(1);const hidden=await page.evaluate(()=>[...(window as any).__terminal.tickers.values()].find((p:any)=>!p.diagnostics().visible).diagnostics().draws);await worker.evaluate(()=>(self as any).__tradeFixture.emit(.2));await page.waitForTimeout(450);expect(await page.evaluate(()=>[...(window as any).__terminal.tickers.values()].find((p:any)=>!p.diagnostics().visible).diagnostics().draws)).toBe(hidden);
  await page.setViewportSize({width:720,height:860});await page.screenshot({path:'artifacts/trade-ticker-720x860.png'});
  await page.evaluate(()=>{const t=(window as any).__terminal;for(const p of [...t.dock.panels])if(p.view.contentComponent==='trade-ticker')t.dock.removePanel(p);});await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(0);await expect(page.locator('.trade-ticker')).toHaveCount(0);
});

test('Spot ticker receives Spot prints with isolated market identity and tape',async({page})=>{
  const worker=await installTradeFixture(page);
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();
  const tickers=page.locator('.trade-ticker'),perpetual=tickers.nth(0),spot=tickers.nth(1);
  await spot.getByRole('button',{name:'Ticker markets',exact:true}).click();const picker=spot.locator('.market-picker').first();
  await picker.getByRole('searchbox',{name:'Search markets'}).fill('BTCUSDT');
  const perpetualChoice=picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true}),spotChoice=picker.getByRole('checkbox',{name:'Binance · BTCUSDT Spot',exact:true});
  await expect(spotChoice).toBeEnabled();await perpetualChoice.uncheck();await spotChoice.check();await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(2);
  await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.byMarket.spot?.readyState===1&&(self as any).__tradeFixture.byMarket.perpetual?.readyState===1)).toBe(true);
  await worker.evaluate(()=>{const fixture=(self as any).__tradeFixture;fixture.emit(.01,'buy',undefined,0,'spot');fixture.emit(.02,'sell',undefined,0,'perpetual');});
  const perpetualRows=perpetual.locator('.ticker-table .ticker-row'),spotRows=spot.locator('.ticker-table .ticker-row');
  await expect(perpetualRows).toHaveCount(1);await expect(spotRows).toHaveCount(1);
  await expect(perpetualRows.first()).toHaveAttribute('data-execution-id','binance:perpetual:BTCUSDT:agg:1');
  await expect(spotRows.first()).toHaveAttribute('data-execution-id','binance:spot:BTCUSDT:agg:1');
  await expect(perpetualRows.first().locator('td').nth(3)).toHaveText('Perp');await expect(spotRows.first().locator('td').nth(3)).toHaveText('Spot');
});

test('virtual tape scrolls retained prints without stopping ingestion and keyboard picker cancels its draft',async({page})=>{
  const worker=await installTradeFixture(page);await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker');await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);
  await worker.evaluate(()=>{for(let n=0;n<120;n++)(self as any).__tradeFixture.emit(.01);});await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(120);
  await expect.poll(()=>ticker.locator('.ticker-table .ticker-row').count()).toBeLessThan(100);const latest=await ticker.locator('.ticker-table .ticker-row').first().getAttribute('data-execution-id');
  await ticker.locator('.ticker-viewport').evaluate(e=>e.scrollTop=500);await expect(ticker.getByRole('button',{name:'Return to live'})).toBeVisible();await expect.poll(()=>ticker.locator('.ticker-table .ticker-row').first().getAttribute('data-execution-id')).not.toBe(latest);
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(.01));await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(121);await ticker.getByRole('button',{name:'Return to live'}).click();await expect(ticker.locator('.ticker-table .ticker-row').first()).toHaveAttribute('data-execution-id','binance:perpetual:BTCUSDT:agg:121');
  await ticker.getByRole('button',{name:'Ticker markets',exact:true}).click();const picker=ticker.locator('.market-picker');const option=picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true});await option.focus();await option.press('Space');await expect(picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true})).not.toBeChecked();await expect(picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true})).toBeFocused();await picker.getByRole('button',{name:'Cancel',exact:true}).click();expect(await worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);
});

test('compact tier table edits every setting, validates duplicates and keeps cancel draft-only',async({page})=>{
  const worker=await installTradeFixture(page);await page.emulateMedia({colorScheme:'dark'});await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker');await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();const settings=ticker.locator('.ticker-settings'),rows=settings.locator('.ticker-tier-table tbody tr');await expect(rows).toHaveCount(3);
  await expect.poll(()=>settings.locator('.ticker-tiers').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(160);await page.screenshot({path:'artifacts/ticker-settings-table-1366x768.png'});await page.setViewportSize({width:720,height:860});await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:'artifacts/ticker-settings-table-720x860.png'});await page.setViewportSize({width:1366,height:768});await page.emulateMedia({colorScheme:'dark'});
  const first=rows.first();await first.getByLabel('Tier name',{exact:true}).fill('Quiet');await first.getByLabel('Sound volume (%)',{exact:true}).fill('35');await first.getByLabel('Brief pulse',{exact:true}).check();await first.getByLabel('Show toast',{exact:true}).check();await first.getByLabel('Sound',{exact:true}).selectOption('chime');await first.getByLabel('Minimum size',{exact:true}).fill('100000');await settings.getByRole('button',{name:'Apply',exact:true}).click();await expect(settings.locator('.dialog-status')).toContainText('unique');await expect(settings).toBeVisible();await first.getByLabel('Minimum size',{exact:true}).fill('0');
  await settings.getByRole('button',{name:'Add tier'}).click();await expect(rows).toHaveCount(4);await expect(rows.last().getByLabel('Tier name',{exact:true})).toBeFocused();await rows.last().getByRole('button',{name:'Delete tier'}).click();await expect(rows).toHaveCount(3);await settings.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().settings.tiers[0])).toMatchObject({name:'Quiet',volume:.35,pulse:true,toast:true,sound:'chime'});
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await settings.getByLabel('Ladder unit',{exact:true}).selectOption('BTC');for(let i=0;i<3;i++)await rows.first().getByRole('button',{name:'Delete tier'}).click();await expect(settings).toContainText('No tiers');await settings.getByRole('button',{name:'Add tier'}).click();await settings.getByRole('button',{name:'Apply',exact:true}).click();await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().settings.tiers[0].unit)).toBe('BTC');
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await rows.first().getByLabel('Tier name',{exact:true}).fill('Discard me');await settings.getByRole('button',{name:'Cancel',exact:true}).click();await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await expect(rows.first().getByLabel('Tier name',{exact:true})).toHaveValue('New tier');
  expect(await worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(1);
});

test('quick BTC/USDT size combo and optional columns preserve feeds and saved settings',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const worker=await installTradeFixture(page);
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await worker.evaluate(()=>{const p=(self as any).__tradeFixture;p.emit(.5);p.emit(2);});await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(2);
  const minimum=ticker.getByRole('combobox',{name:'Minimum trade size',exact:true});await minimum.fill('100K');await minimum.press('Tab');await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);
  await ticker.getByLabel('Trade size filter unit',{exact:true}).selectOption('BTC');await minimum.fill('1');await minimum.press('Tab');await expect(ticker.locator('.ticker-table .ticker-row')).toHaveCount(1);
  const icon=ticker.locator('.ticker-table .ticker-venue-icon').first();await expect(icon).toHaveAttribute('alt','Binance');expect(await icon.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();const settings=ticker.locator('.ticker-settings');await expect(settings.getByLabel('Minimum displayed size',{exact:true})).toHaveValue('1');await expect(settings.getByLabel('Time UTC (required)',{exact:true})).toBeDisabled();
  for(const name of ['Venue','Market type','Aggressor side','Price','Size BTC','Notional USDT'])await settings.getByLabel(name+' column',{exact:true}).uncheck();await settings.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(ticker.locator('.ticker-table th:visible')).toHaveText(['Time UTC','E']);await expect(ticker.locator('.ticker-table .ticker-row').first().locator('td:visible')).toHaveCount(2);
  expect(await worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(1);
  await page.screenshot({path:'artifacts/ticker-filter-columns-1366x768.png'});await page.setViewportSize({width:720,height:860});await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await page.screenshot({path:'artifacts/ticker-filter-columns-720x860.png'});await settings.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForTimeout(400);await page.reload();await expect(page.locator('.trade-ticker .ticker-table th:visible')).toHaveText(['Time UTC','E']);await expect(page.locator('.trade-ticker').getByLabel('Trade size filter unit',{exact:true})).toHaveValue('BTC');await expect(page.locator('.trade-ticker').getByRole('combobox',{name:'Minimum trade size',exact:true})).toHaveValue('1');expect(errors).toEqual([]);
});

test('inward buy/sell bars share a scale, freeze on pause and persist appearance',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});const worker=await installTradeFixture(page);await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();
  await page.evaluate(()=>{const t=(window as any).__terminal;const p=t.dock.panels.find((p:any)=>p.view.contentComponent==='trade-ticker');p.api.setSize({width:850});});
  const ticker=page.locator('.trade-ticker'),rows=ticker.locator('.ticker-table .ticker-row');
  await worker.evaluate(()=>{const f=(self as any).__tradeFixture;f.emit(20,'buy');f.emit(10,'sell');f.emit(5,'buy');f.emit(2,'sell');});await expect(rows).toHaveCount(4);
  const widths=()=>rows.evaluateAll(rows=>rows.map(row=>({side:(row as HTMLElement).dataset.aggressor,width:(row as HTMLElement).style.getPropertyValue('--ticker-bar-width'),background:getComputedStyle(row).backgroundImage})));
  const initial=await widths();expect(initial.map(r=>r.width)).toEqual(['4.5%','11.25%','22.5%','45%']);expect(initial[0].background).toContain('to right');expect(initial[1].background).toContain('to left');
  await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).fill('1M');await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).press('Tab');await expect(rows).toHaveCount(2);expect((await widths()).map(r=>r.width)).toEqual(['22.5%','45%']);
  await ticker.getByRole('button',{name:'Pause',exact:true}).click();await worker.evaluate(()=>(self as any).__tradeFixture.emit(40,'sell'));await page.waitForTimeout(300);expect((await widths()).map(r=>r.width)).toEqual(['22.5%','45%']);await ticker.getByRole('button',{name:'Return to live'}).click();await expect(rows).toHaveCount(3);expect((await widths()).map(r=>r.width)).toEqual(['45%','11.25%','22.5%']);
  await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).fill('0');await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).press('Tab');await expect(rows).toHaveCount(5);await page.waitForTimeout(550);
  await page.screenshot({path:'artifacts/ticker-volume-bars-1366x768.png'});
  await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();const settings=ticker.locator('.ticker-settings');await settings.getByLabel('Scale window (seconds)',{exact:true}).fill('0');await settings.getByRole('button',{name:'Apply',exact:true}).click();await expect(settings.getByRole('status')).toContainText('5–300');await settings.getByLabel('Scale window (seconds)',{exact:true}).fill('30');await settings.getByLabel('Bar opacity (%)',{exact:true}).fill('25');await settings.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(ticker.locator('.ticker-table')).toHaveCSS('--ticker-bar-opacity','0.25');expect(await worker.evaluate(()=>(self as any).__tradeFixture.sockets)).toBe(1);
  await page.setViewportSize({width:720,height:860});await page.locator('#theme').selectOption('light');await ticker.getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await page.screenshot({path:'artifacts/ticker-volume-bars-720x860.png'});await settings.getByLabel('Show volume bars',{exact:true}).uncheck();await settings.getByRole('button',{name:'Apply',exact:true}).click();expect((await widths()).every(r=>r.width==='0%')).toBe(true);
  await page.waitForTimeout(400);await page.reload();await page.locator('.trade-ticker').getByRole('button',{name:'Trade Ticker settings',exact:true}).click();await expect(page.locator('.ticker-settings').getByLabel('Show volume bars',{exact:true})).not.toBeChecked();await expect(page.locator('.ticker-settings').getByLabel('Scale window (seconds)',{exact:true})).toHaveValue('30');await expect(page.locator('.ticker-settings').getByLabel('Bar opacity (%)',{exact:true})).toHaveValue('25');
});

test('visible histogram rows stay proportional across window expiry, raw eviction and a new maximum',async({page})=>{
  const worker=await installTradeFixture(page);await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await page.evaluate(()=>{const panel=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='trade-ticker');panel.api.setSize({width:850});});
  await ticker.getByLabel('Trade size filter unit',{exact:true}).selectOption('USDT');
  const minimum=ticker.getByRole('combobox',{name:'Minimum trade size',exact:true});await minimum.fill('100K');await minimum.press('Tab');
  await worker.evaluate(()=>{const fixture=(self as any).__tradeFixture;fixture.emit(11.996,'sell',undefined,70000);fixture.emit(2.757,'sell',undefined,70000);fixture.emit(5.849,'buy',undefined,41000);});
  const rows=ticker.locator('.ticker-table .ticker-row');await expect(rows).toHaveCount(3);
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(3);
  for(let batch=0;batch<5;batch++){
    await worker.evaluate(()=>{for(let i=0;i<100;i++)(self as any).__tradeFixture.emit(.01,'sell');});
    await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(Math.min(500,103+batch*100));
  }
  await expect(rows).toHaveCount(3);
  const geometry=()=>rows.evaluateAll(items=>items.map(row=>{const element=row as HTMLElement,rect=element.getBoundingClientRect();return{size:row.children[6].textContent,side:element.dataset.aggressor,width:parseFloat(element.style.getPropertyValue('--ticker-bar-width')),painted:rect.width*parseFloat(element.style.getPropertyValue('--ticker-bar-width'))/100,gradient:getComputedStyle(element).backgroundImage,rowWidth:rect.width};}));
  const initial=await geometry();expect(initial.map(row=>row.size)).toEqual(['5.849 BTC','2.757 BTC','11.996 BTC']);
  expect(initial.map(row=>row.side)).toEqual(['buy','sell','sell']);expect(initial[0].width).toBeCloseTo(5.849/11.996*45,4);expect(initial[1].width).toBeCloseTo(2.757/11.996*45,4);expect(initial[2].width).toBe(45);
  for(const row of initial){expect(row.painted).toBeCloseTo(row.rowWidth*row.width/100,3);expect(row.gradient).toContain(row.side==='buy'?'to left':'to right');const stops=[...row.gradient.matchAll(/([\d.]+)%/g)].map(stop=>Number(stop[1]));expect(stops[0]).toBeCloseTo(row.width,3);expect(stops[1]).toBeCloseTo(row.width,3);}
  const handles=await rows.elementHandles();
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(20,'buy'));await expect(rows).toHaveCount(4);
  const updated=await geometry();expect(updated.map(row=>row.size)).toEqual(['20 BTC','5.849 BTC','2.757 BTC','11.996 BTC']);
  expect(updated[0].width).toBe(45);
  expect(updated[1].width).toBeCloseTo(5.849/20*45,4);expect(updated[2].width).toBeCloseTo(2.757/20*45,4);expect(updated[3].width).toBeCloseTo(11.996/20*45,4);
  expect(await handles[0].getAttribute('data-execution-id')).toBe('binance:perpetual:BTCUSDT:agg:504');
  expect(await handles[1].getAttribute('data-execution-id')).toBe('binance:perpetual:BTCUSDT:agg:3');
  expect(await handles[2].getAttribute('data-execution-id')).toBe('binance:perpetual:BTCUSDT:agg:2');
});

test('hidden prints cannot evict an already printed matching trade',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const worker=await installTradeFixture(page);
  await page.getByRole('button',{name:'Trade Ticker',exact:true}).click();const ticker=page.locator('.trade-ticker').first();
  await expect.poll(()=>worker.evaluate(()=>(self as any).__tradeFixture.active)).toBe(1);
  await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).fill('100K');await ticker.getByRole('combobox',{name:'Minimum trade size',exact:true}).press('Tab');
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(10));const row=ticker.locator('.ticker-row');await expect(row).toHaveCount(1);const id=await row.getAttribute('data-execution-id'),text=await row.textContent();
  for(let batch=0;batch<6;batch++){await worker.evaluate(()=>{for(let n=0;n<100;n++)(self as any).__tradeFixture.emit(.01);});await page.waitForTimeout(300);}
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.tickers.values()][0].diagnostics().retained)).toBe(500);
  await expect(row).toHaveCount(1);await expect(row).toHaveAttribute('data-execution-id',id!);await expect(row).toHaveText(text!);
  await worker.evaluate(()=>(self as any).__tradeFixture.emit(2));await expect(row).toHaveCount(2);await expect(row.last()).toHaveAttribute('data-execution-id',id!);
  await ticker.getByRole('button',{name:'Pause',exact:true}).click();await worker.evaluate(()=>(self as any).__tradeFixture.emit(3));await page.waitForTimeout(350);await expect(row).toHaveCount(2);await ticker.getByRole('button',{name:'Return to live'}).click();await expect(row).toHaveCount(3);expect(errors).toEqual([]);
});

import { installDepthFixture } from './depth-fixture';
import { expect,test } from '@playwright/test';
import { addIndicator, chooseChartMarket, expectHeatmapLiveQuiet, setFootprint } from './indicator-actions';
test('Market Conditions switches modes in one native pane and persists configuration',async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?fixture=1');await page.setViewportSize({width:1920,height:1080});
 const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Market Conditions');
 const surface=panel.locator('.market-conditions-surface'),summary=surface.locator('.market-conditions-summary');
 await expect(summary).toContainText('VOL:');await expect(summary).toContainText('TRADEABILITY:');await expect(summary).not.toContainText('WARMING');
 const pane=await surface.evaluate(el=>{const parent=el.parentElement!;parent.dataset.conditionsTest='same-pane';return parent.dataset.conditionsTest;});expect(pane).toBe('same-pane');
 await surface.getByLabel('Market Conditions display mode').selectOption('detailed');
 await expect(surface).toHaveAttribute('data-mode','detailed');await expect(page.locator('[data-conditions-test="same-pane"] .market-conditions-surface')).toHaveCount(1);
 await surface.getByRole('button',{name:'Market Conditions settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Market Conditions settings',exact:true});await dialog.getByLabel('Plot ATR',{exact:true}).check();await dialog.getByLabel('Plot BBW',{exact:true}).check();await dialog.getByLabel('HV Enabled',{exact:true}).check();await dialog.getByLabel('Plot HV',{exact:true}).check();await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().marketConditions.timeframes[0]?.latest?.hv?.['20'])).toBeGreaterThan(0);
 const axes=await page.evaluate(()=>{const view=([...(window as any).__terminal.panels.values()][0] as any).conditionsView;const hv=view.series.get('hv:20');return {separate:hv.priceScale()!==view.anchor.priceScale(),range:view.anchor.priceScale().priceRange(),last:hv.getData().at(-1)?.close};});
 expect(axes.separate).toBe(true);expect(axes.range).toEqual({min:0,max:100});expect(axes.last).toBeGreaterThan(0);
 await surface.getByLabel('Market Conditions display mode').selectOption('dashboard');
 await expect(surface.locator('tbody tr')).toHaveCount(6);await expect(surface.locator('tbody')).toContainText('1d');await expect(surface.locator('tbody')).not.toContainText('WARMING');
 await surface.getByRole('button',{name:'Inspect 4h Market Conditions'}).click();await expect(surface.locator('.market-conditions-detail')).toContainText('4h');
 await surface.getByRole('button',{name:'Market Conditions settings',exact:true}).click();await dialog.getByLabel('Timeframes',{exact:true}).fill('1d, 15m, 5m');await dialog.getByLabel('Density',{exact:true}).selectOption('detailed');await dialog.getByLabel('Volatility enters extreme',{exact:true}).check();await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(surface.locator('tbody tr')).toHaveCount(3);await expect(surface.locator('tbody tr').first()).toHaveAttribute('data-timeframe','1d');
 await page.waitForTimeout(400);await page.reload();const restored=page.locator('.market-conditions-surface');await expect(restored).toHaveAttribute('data-mode','dashboard');await expect(restored).toHaveAttribute('data-density','detailed');await expect(restored.locator('tbody tr')).toHaveCount(3);
 await restored.getByLabel('Market Conditions component').selectOption('volatility');await expect(restored.locator('.market-conditions-summary')).not.toContainText('TRADEABILITY:');
 await restored.getByLabel('Market Conditions component').selectOption('tradeability');await expect(restored.locator('.market-conditions-summary')).not.toContainText('VOL:');
 await page.locator('.candle-panel').first().getByRole('combobox',{name:'Timeframe',exact:true}).selectOption('5m');
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().marketConditions.timeframes[0]?.interval)).toBe('5m');
 await chooseChartMarket(page.locator('.candle-panel').first(),'Hyperliquid · BTC Perp');
 await expect(restored).toHaveAttribute('aria-label',/Hyperliquid/);await expect(restored).toHaveAttribute('data-mode','dashboard');
 await restored.getByRole('button',{name:'Market Conditions settings',exact:true}).click();await expect(dialog.getByLabel('Volatility enters extreme',{exact:true})).toBeChecked();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(errors).toEqual([]);
});
test('two charts share same calculations and native pane removal releases consumers',async({page})=>{
 test.setTimeout(60000);await page.goto('/?fixture=1');
 const panels=page.locator('.candle-panel');await addIndicator(panels.nth(0),'Market Conditions');await addIndicator(panels.nth(1),'Market Conditions');
 // Bind the second indicator to the same explicit BTC venue without changing its host chart.
 const second=panels.nth(1).locator('.market-conditions-surface');await second.getByRole('button',{name:'Market Conditions settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Market Conditions settings',exact:true});await dialog.getByLabel('Source',{exact:true}).selectOption('binance:perpetual');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().marketConditions.calculations.find((c:any)=>c.consumers===2)?.consumers)).toBe(2);
 const row=panels.nth(1).locator('.active-indicator[data-definition-id="native.market-conditions"]');
 await row.getByRole('button',{name:'Hide Market Conditions',exact:true}).click();await expect(second).toHaveCount(0);
 await row.getByRole('button',{name:'Market Conditions settings',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Source',{exact:true})).toHaveValue('binance:perpetual');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await row.getByRole('button',{name:'Show Market Conditions',exact:true}).click();await expect(second).toHaveCount(1);
 await row.locator('[data-indicator-action="remove"]').click();await expect(second).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().marketConditions.calculations[0]?.consumers)).toBe(1);
});

test('Market Conditions coexists with Footprint, Totals and Heatmap on the shared chart',async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await installDepthFixture(page);await page.setViewportSize({width:1920,height:1080});
 const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Market Conditions');await expect(panel.locator('.market-conditions-summary')).not.toContainText('WARMING');
 await page.evaluate(()=>{
  const terminal=(window as any).__terminal,p=[...terminal.panels.values()][0] as any;
  const candles=p.candles.slice(-10);
  terminal.feed.subscribeFootprint=(_id:string,series:any,rowSize:number,callback:any)=>{
   const timer=setTimeout(()=>{const now=Date.now();callback({type:'footprint-snapshot',key:'explicit-coexistence-fixture',ids:[_id],generation:1,batchId:1,retentionStart:candles[0].t/1000,
    bars:candles.map((c:any)=>({time:c.t/1000,rowSize,revision:1,open:c.o,high:c.h,low:c.l,close:c.c,cells:[{price:Math.floor(c.c/rowSize)*rowSize,bidVol:2,askVol:3,bidNotional:2*c.c,askNotional:3*c.c}],delta:1,minDelta:0,maxDelta:1,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,aggregateRecordCount:1})),
    status:{state:'live',message:'Explicit coexistence fixture',lastUpdate:now,tickSize:.1,rowSize,collectionStartedAt:now,coverage:'partial',outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0}});},30);
   return()=>clearTimeout(timer);
  };
 });
 await setFootprint(panel,true);await addIndicator(panel,'Footprint Totals');await addIndicator(panel,'Order-book Heatmap');
 await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().footprint.bars)).toBeGreaterThan(0);
 await expectHeatmapLiveQuiet(panel);await expect(panel.locator('.pane-indicator-host .active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(1);
 await expect(panel.locator('.market-conditions-summary')).toContainText('TRADEABILITY:');await expect(panel.locator('.market-conditions-summary')).not.toContainText('WARMING');
 expect(errors).toEqual([]);
});

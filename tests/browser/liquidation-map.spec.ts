import { test, expect } from '@playwright/test';
import { addIndicator } from './indicator-actions';
test('Liquidation Map persists settings, hides the primitive, and disposes its view', async ({ page }) => {
    page.on('pageerror', e => console.log('MAP PAGE ERROR', e.message));
    await page.goto('/?fixture=1');
    await page.waitForFunction(() => (window as any).__terminal?.panels.size > 0);
    const panel = page.locator('.candle-panel').first();
    await addIndicator(panel, 'Liquidation Map');
    await panel.getByRole('button', { name: 'Liquidation Map settings', exact: true }).click();
    const dialog = panel.getByRole('dialog', { name: 'Liquidation Map settings' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Price grouping (native quote)', { exact: true }).fill('250');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toBeHidden();
    const settings = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].diagnostics().series.indicators.find((i: any) => i.definitionId === 'native.liquidation-map').settings);
    expect(settings.priceWidth).toBe(250);
    await panel.getByRole('button', { name: 'Hide Liquidation Map', exact: true }).click();
    expect(await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].liquidationMapView.primitive.visible)).toBe(false);
    await panel.getByRole('button', { name: 'Show Liquidation Map', exact: true }).click();
    await panel.getByRole('button', { name: 'Remove Liquidation Map', exact: true }).click();
    await expect(panel.locator('[data-definition-id="native.liquidation-map"]')).toHaveCount(0);
    expect(await page.evaluate(() => Boolean([...(window as any).__terminal.panels.values()][0].liquidationMapView))).toBe(false);
});
test('explicit fixture map hover and latest profile use matching stock timestamps', async({page})=>{
 await page.goto('/?fixture=1');await page.waitForFunction(()=>[...(window as any).__terminal?.panels.values()??[]][0]?.diagnostics().bars>20);
 const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Footprint Totals');await addIndicator(panel,'Liquidation Map');
 const target=await page.evaluate(()=>{
  const p=[...(window as any).__terminal.panels.values()][0] as any,v=p.liquidationMapView,c=p.engine.chart;
  clearTimeout(v.timer);v.subscription?.dispose();v.subscription=undefined;
  const plot=c.plotRect(c.primaryPaneIndex()),scale=c.panes()[c.primaryPaneIndex()].priceScale,range=scale.priceRange(),price=range.min+(range.max-range.min)*.04;
  const old=Math.floor(c.dataLayer.indexToTimeFloat(c.timeScale.xToIndex(plot.width*.5))*1000)-1000,latest=old+60000;
  const cell={freshUntil:Date.now()+120000,low:Math.floor(price/100)*100,high:Math.floor(price/100)*100+100,quantity:2,side:'long',venue:'hyperliquid',kind:'observed',scenario:'fixture',leverage:null,quote:'USD',nativePrice:price,modelVersion:'fixture-only',riskVersion:'fixture-only'};
  v.settings={...v.settings,minimum:0,profile:true,profileCrosshair:false};v.primitive.settings=v.settings;
  v.primitive.columns=[{at:old,availableAt:old,revision:1,cells:[cell],quality:['fixture-only']},{at:latest,availableAt:latest,revision:2,cells:[{...cell,quantity:4}],quality:['fixture-only']}];v.primitive.update();
  return{profileX:plot.left+plot.width-10,mapX:plot.left+plot.width*.5,y:plot.top+scale.priceToY(price),latest:new Date(latest).toISOString()};
 });
 const box=(await panel.locator('.chart-stage').boundingBox())!;
 await page.mouse.move(box.x+target.profileX,box.y+target.y);
 const profile=panel.locator('.positioning-tooltip').filter({hasText:'Profile snapshot'});
 await expect(profile).toBeVisible();await expect(profile.locator('time')).toHaveAttribute('datetime',target.latest);await expect(profile).toContainText('Mean 4.00');
 await expect(profile).toHaveClass(/net-positioning-tooltip/);
 const bounds=await profile.boundingBox();const plot=await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0] as any;return p.engine.chart.plotRect(p.engine.chart.primaryPaneIndex());});
 expect(bounds!.y).toBeGreaterThanOrEqual(box.y+plot.top);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(box.y+plot.top+plot.height);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(box.x+plot.left+plot.width);
 await page.screenshot({path:'/tmp/iq-liquidation-map-tooltip.png'});
 await page.mouse.move(box.x+target.mapX,box.y+target.y);
 await expect(panel.locator('.positioning-tooltip').filter({hasText:'Mean 2.00'})).toBeVisible();
});

test('explicit fixture shows a loading message until the first shared-worker response arrives',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/market-data/v1/liquidation-map/tiles?**',async route=>{
  await gate;const u=new URL(route.request().url());
  await route.fulfill({json:{version:1,semantics:'conditional-exposure',columns:[],sources:[],head:1,next:null,from:Number(u.searchParams.get('from')),to:Number(u.searchParams.get('to')),resolution:Number(u.searchParams.get('resolution')),priceWidth:100,asOf:Date.now()}});
 });
 try{
  await page.goto('/?fixture=1');await page.waitForFunction(()=>(window as any).__terminal?.panels.size>0);
  const panel=page.locator('.candle-panel').first();await addIndicator(panel,'Liquidation Map');
  const status=panel.locator('.liquidation-map-status');await expect(status).toContainText('Loading Liquidation Map');await expect(status).toBeVisible();await page.screenshot({path:'/tmp/iq-map-loading-message.png'});
  release();await expect(status).toBeEmpty();await expect(status).toBeHidden();
 }finally{release();}
});

test('journal-generated fixture ends at native crossing and stays ended after rebound and browser reload',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('basis.theme.v1','terminal'));
 const {readFile}=await import('node:fs/promises');const replay=JSON.parse(await readFile(new URL('../fixtures/liquidation-map-retirement.json',import.meta.url),'utf8'));
 expect(replay.fixtureOnly).toBe(true);expect(replay.reloadedCohorts).toBe(0);expect(replay.retiredLong).toBe(1);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const install=async(stage:'before'|'rebound')=>{
  await page.waitForFunction(()=>[...(window as any).__terminal?.panels.values()??[]][0]?.diagnostics().bars>20);
  const panel=page.locator('.candle-panel').first();if(!await panel.getByRole('button',{name:'Liquidation Map settings',exact:true}).count())await addIndicator(panel,'Liquidation Map');
  return page.evaluate(({replay,stage})=>{
   const p=[...(window as any).__terminal.panels.values()][0] as any,v=p.liquidationMapView,c=p.engine.chart;clearTimeout(v.timer);v.subscription?.dispose();v.subscription=undefined;
   c.timeScale.setBarSpacing(60);c.timeScale.setRightOffset(0);const last=c.dataLayer.indexToTimeFloat(c.dataLayer.length-3)*1000;
   const scale=c.panes()[c.primaryPaneIndex()].priceScale,range=JSON.parse(sessionStorage.getItem('iq-map-replay-range')??JSON.stringify(scale.priceRange()));sessionStorage.setItem('iq-map-replay-range',JSON.stringify(range));scale.setAutoScale(false);scale.setFixedRange(range);const low=Math.floor((range.min+(range.max-range.min)*.25)/5)*5;
   const columns=(stage==='before'?replay.columns.slice(0,1):replay.columns).map((col:any)=>({...col,at:last+col.at-replay.base,availableAt:last+col.availableAt-replay.base,validUntil:stage==='before'?undefined:col.validUntil===undefined?undefined:last+col.validUntil-replay.base,cells:col.cells.map((cell:any)=>({...cell,low,high:low+5,nativePrice:low,freshUntil:Date.now()+120000,markSourceTime:Date.now()}))}));
   v.settings={...v.settings,minimum:0,leverage:[10],profile:false,opacity:1,resolution:240000,priceWidth:5,fixedMaximum:1};v.primitive.settings=v.settings;v.primitive.columns=columns;v.primitive.profile={...columns.at(-1),cells:[]};v.primitive.geometry=undefined;v.primitive.update();
   v.status.textContent='EXPLICIT JOURNAL REPLAY FIXTURE · native mark 100 → 89 at +50s → 101 at +150s · conserved unknown inventory';
   return{last,until:columns[0].validUntil,cells:columns.map((c:any)=>c.cells.length)};
  },{replay,stage});
 };
 await page.goto('/?fixture=1');const before=await install('before');expect(before.cells).toEqual([1]);
 await page.waitForTimeout(100);await page.screenshot({path:'/tmp/iq-map-retirement-before.png'});
 const after=await install('rebound');expect(after.until).toBe(after.last+50000);expect(after.cells).toEqual([1,0,0]);
 await page.waitForTimeout(100);await page.screenshot({path:'/tmp/iq-map-retirement-rebound.png'});
 await page.reload();const restored=await install('rebound');expect(restored.until).toBe(restored.last+50000);expect(restored.cells).toEqual([1,0,0]);
 await page.waitForTimeout(100);await page.screenshot({path:'/tmp/iq-map-retirement-reload.png'});expect(errors).toEqual([]);
});

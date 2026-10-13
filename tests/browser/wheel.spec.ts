import {test,expect} from '@playwright/test';

test('default wheel separates time from price, modifiers and saved legacy mode work',async({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?fixture=1');
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars===5000&&p.renderer.draws>0));
  const panel=page.locator('.candle-panel').first();
  // Default time zoom keeps automatic price scaling enabled.
  const autoStage=(await panel.locator('.chart-stage').boundingBox())!;
  await page.mouse.move(autoStage.x+autoStage.width*.35,autoStage.y+autoStage.height*.4);
  const autoBefore=await page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing);
  await page.mouse.wheel(0,-100);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing)).toBeCloseTo(autoBefore*1.1,6);
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.chart.panes()[0].priceScale.autoScale)).toBe(true);
  const point=await page.evaluate(()=>{
    const c=[...(window as any).__terminal.panels.values()][0].engine.chart,p=c.plotRect(0),b=document.querySelector('.chart-stage')!.getBoundingClientRect();
    c.panes()[0].priceScale.setAutoScale(false);
    return {x:Math.round(p.left+p.width*.35),y:Math.round(p.top+p.height*.4),left:b.left,top:b.top,right:p.left+p.width,axis:b.width-10};
  });
  const read=()=>page.evaluate(({x,y,right})=>{
    const c=[...(window as any).__terminal.panels.values()][0].engine.chart,s=c.panes()[0].priceScale;
    return {spacing:c.timeScale.barSpacing,range:s.priceRange(),time:c.coordinateToTime(x),right:c.coordinateToTime(right),price:c.coordinateToPrice(y,0)};
  },point);
  const before=await read();
  await page.mouse.move(point.left+point.x,point.top+point.y);
  await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await read()).spacing).toBeGreaterThan(before.spacing);
  const normal=await read();
  expect(normal.spacing).toBeCloseTo(before.spacing*1.1,6);
  expect(normal.range).toEqual(before.range);
  expect(normal.right).toBeCloseTo(before.right,5);
  expect(normal.time).not.toBeCloseTo(before.time,3);
  await page.keyboard.down('Control'); await page.mouse.wheel(0,-100); await page.keyboard.up('Control');
  await expect.poll(async()=>(await read()).spacing).toBeGreaterThan(normal.spacing);
  const focused=await read(); expect(focused.time).toBeCloseTo(normal.time,5); expect(focused.range).toEqual(before.range);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0,100); await page.keyboard.up('Shift');
  await expect.poll(async()=>(await read()).time).not.toBe(focused.time);
  const panned=await read(); expect(panned.spacing).toBeCloseTo(focused.spacing,6);
  await page.mouse.move(point.left+point.axis,point.top+point.y); await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await read()).range.max-(await read()).range.min).toBeLessThan(panned.range.max-panned.range.min);
  expect((await read()).spacing).toBeCloseTo(panned.spacing,6);
  await panel.getByRole('button',{name:'Chart settings',exact:true}).click();
  await expect(panel.getByRole('combobox',{name:'Mouse wheel behavior'})).toHaveValue('tradingview');
  await panel.getByRole('combobox',{name:'Mouse wheel behavior'}).selectOption('both-axes');
  await panel.locator('.chart-settings').getByRole('button',{name:'Close',exact:true}).click();
  const legacyBefore=await read();
  await page.mouse.move(point.left+point.x,point.top+point.y); await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await read()).spacing).toBeGreaterThan(legacyBefore.spacing);
  const legacy=await read(); expect(legacy.range.max-legacy.range.min).toBeLessThan(legacyBefore.range.max-legacyBefore.range.min);
  expect(legacy.time).toBeCloseTo(legacyBefore.time,5); expect(legacy.price).toBeCloseTo(legacyBefore.price!,6);
  await page.reload();
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars===5000));
  await panel.getByRole('button',{name:'Chart settings',exact:true}).click();
  await expect(panel.getByRole('combobox',{name:'Mouse wheel behavior'})).toHaveValue('both-axes');
  expect(errors).toEqual([]);
});

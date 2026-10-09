import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/?fixture=1');await page.waitForFunction(()=>document.querySelectorAll('.candle-panel').length===2);});
test('charts render, controls persist, corrupt layout recovers',async({page})=>{
  await expect(page.locator('select[aria-label=Instrument]')).toHaveCount(2);await expect(page.locator('canvas.gpu')).toHaveCount(2);
  await page.locator('select[aria-label=Timeframe]').first().selectOption('15m');await page.waitForTimeout(400);await page.reload();await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('15m');
  await page.evaluate(()=>localStorage.setItem('basis.layout.v1','{broken'));await page.reload();await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('1m');
});
test('add, grouping, tab reorder, split docking, resize, close/empty, restore',async({page})=>{
  await page.getByRole('button',{name:'Add chart',exact:true}).first().click();await expect(page.locator('.candle-panel')).toHaveCount(3);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;d.panels[2].api.moveTo({group:d.panels[0].api.group,position:'center',index:0});});
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;d.panels[0].api.moveTo({group:d.panels[1].api.group,position:'below'});});
  await expect(page.locator('.dv-groupview')).toHaveCount(3);await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(400);await page.reload();await expect(page.locator('.candle-panel')).toHaveCount(3);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;for(const p of [...d.panels])p.api.close();});await expect(page.getByText('No charts open')).toBeVisible();await page.waitForTimeout(300);await page.reload();await expect(page.getByText('No charts open')).toBeVisible();await page.getByRole('button',{name:'Add chart',exact:true}).last().click();await expect(page.locator('.candle-panel')).toHaveCount(1);
});
test('hidden panels suspend GPU work, pan survives activation, context restores',async({page})=>{
  await page.waitForFunction(()=>(window as any).__terminal.stats().panels.every((p:any)=>p.bars===5000));
  await page.locator('canvas.overlay').first().hover();await page.mouse.wheel(0,80);const view=await page.evaluate(()=>(window as any).__terminal.stats().panels[0]);
  await page.evaluate(()=>{const t=(window as any).__terminal;t.feed.send({type:'fixture',rate:1000});const d=t.dock;d.panels[1].api.moveTo({group:d.panels[0].api.group,position:'center'});});await page.waitForTimeout(200);
  const before=await page.evaluate(()=>(window as any).__terminal.stats().panels.find((p:any)=>!p.visible));await page.waitForTimeout(600);const after=await page.evaluate(()=>(window as any).__terminal.stats().panels.find((p:any)=>!p.visible));expect(after.renderer.draws).toBe(before.renderer.draws);expect(after.renderer.uploads).toBe(before.renderer.uploads);await page.evaluate(id=>(window as any).__terminal.dock.getPanel(id).api.setActive(),view.id);const restored=await page.evaluate(id=>(window as any).__terminal.stats().panels.find((p:any)=>p.id===id),view.id);expect(restored.spacing).toBe(view.spacing);expect(restored.right).toBe(view.right);
  await page.evaluate(()=>{const t=(window as any).__terminal;const p=[...t.panels.values()].find((p:any)=>p.visible) as any;p.contextLoss(false);});await expect(page.getByText('WebGL context lost · waiting for restoration')).toBeVisible();await page.waitForTimeout(100);await page.evaluate(()=>{const t=(window as any).__terminal;([ ...t.panels.values()].find((p:any)=>p.visible) as any).contextLoss(true);});await page.waitForTimeout(300);await expect(page.getByText('WebGL context lost · waiting for restoration')).toHaveCount(0);
});
test('unavailable direct endpoint displays recoverable error',async({page})=>{await page.route('https://fapi.binance.com/**',r=>r.fulfill({status:451,body:'unavailable'}));await page.goto('/');await expect(page.getByText(/History HTTP 451/)).toBeVisible({timeout:20000});await expect(page.getByRole('button',{name:'Retry market data'}).first()).toBeVisible();});
test('native tab drag groups charts and splitter drag resizes',async({page})=>{
  const tab=page.locator('.dv-tab').first(),target=page.locator('.dv-tab').last();
  await tab.dragTo(target);await expect(page.locator('.dv-groupview')).toHaveCount(1);
  await page.getByRole('button',{name:'Add chart',exact:true}).first().click();await expect(page.locator('.dv-groupview')).toHaveCount(2);
  const sash=page.locator('.dv-sash.dv-enabled').first();const box=await sash.boundingBox();if(!box)throw new Error('Splitter absent');const before=await page.locator('.dv-groupview').first().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+100,box.y+box.height/2,{steps:10});await page.mouse.up();const after=await page.locator('.dv-groupview').first().boundingBox();expect(Math.abs(after!.width-before!.width)).toBeGreaterThan(20);
});

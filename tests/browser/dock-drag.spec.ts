import {test,expect} from '@playwright/test';

for(const theme of ['dark','light'])test(`tab pointer drag previews immediately, docks, splits and cleans up (${theme})`,async({page})=>{
  await page.addInitScript(theme=>localStorage.setItem('basis.theme.v1',theme),theme);
  await page.goto('/?fixture=1');
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars>0));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const tab=page.locator('.dv-tab').first(),target=page.locator('.dv-groupview').last();
  const a=(await tab.boundingBox())!,b=(await target.boundingBox())!;
  await page.evaluate(()=>{(window as any).nativeTabDrags=0;document.addEventListener('dragstart',()=>{(window as any).nativeTabDrags++;});});
  await page.mouse.move(a.x+30,a.y+12);await page.mouse.down();
  await page.mouse.move(a.x+40,a.y+22);
  // Inspect the first movement directly: retrying until visible would hide the reported delay.
  expect(await page.locator('.dv-tab-ghost-drag').count()).toBe(1);
  const ghost=page.locator('.dv-tab-ghost-drag');
  expect(await ghost.textContent()).toContain('BTCUSDT');
  expect(await ghost.locator('.compact-chart-tab').evaluate(el=>getComputedStyle(el).display)).toBe('flex');
  expect(await ghost.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:3});
  expect(await page.locator('.dv-drop-target-selection,.dv-drop-target-anchor').count()).toBeGreaterThan(0);
  await page.screenshot({path:`/tmp/iqterminal-tab-drag-${theme}.png`});
  await page.mouse.up();await expect(page.locator('.dv-groupview')).toHaveCount(1);
  await expect(ghost).toHaveCount(0);
  // Reorder within the group using the same pointer backend.
  const tabs=page.locator('.dv-tabs-container .dv-tab');
  const firstLabel=await tabs.first().textContent();
  const reorderFrom=(await tabs.first().boundingBox())!,reorderTo=(await tabs.last().boundingBox())!;
  await page.mouse.move(reorderFrom.x+30,reorderFrom.y+12);await page.mouse.down();
  await page.mouse.move(reorderFrom.x+40,reorderFrom.y+24);
  await page.mouse.move(reorderTo.x+reorderTo.width-8,reorderTo.y+12,{steps:3});await page.mouse.up();
  await expect(page.locator('.dv-groupview')).toHaveCount(1);
  expect(await tabs.first().textContent()).not.toBe(firstLabel);
  // Split a grouped tab back into a second pane.
  const c=(await tabs.first().boundingBox())!,g=(await page.locator('.dv-groupview').boundingBox())!;
  await page.mouse.move(c.x+30,c.y+12);await page.mouse.down();await page.mouse.move(c.x+40,c.y+24);
  await page.mouse.move(g.x+g.width/2,g.y+g.height-20,{steps:3});await page.mouse.up();
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  // Cancelling an in-progress pointer drag leaves no ghost or drop highlight.
  const d=(await page.locator('.dv-tab').first().boundingBox())!;
  await page.mouse.move(d.x+30,d.y+12);await page.mouse.down();await page.mouse.move(d.x+40,d.y+24);
  expect(await ghost.count()).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse'})));
  await page.mouse.up();await expect(ghost).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).nativeTabDrags)).toBe(0);
  await page.reload();await expect(page.locator('.dv-groupview')).toHaveCount(2);
  expect(errors).toEqual([]);
});

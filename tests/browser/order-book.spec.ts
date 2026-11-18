import {test,expect} from '@playwright/test';
import {addWidget,selectTheme} from './footer-actions';
test.setTimeout(60000);
const diagnostic=()=>{const t=(window as any).__terminal;return t.dock.panels.filter((p:any)=>p.view.contentComponent==='order-book').map((p:any)=>p.view.content.diagnostics());};
test('unified menu, presentation-only controls, modes, preferences, hover and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const post=Worker.prototype.postMessage;(window as any).__bookCommands=[];Worker.prototype.postMessage=function(message:any,...rest:any[]){if(message?.type?.startsWith('depth-matrix'))(window as any).__bookCommands.push(message);return (post as any).call(this,message,...rest);};});
 await page.goto('/?fixture=1');await page.waitForFunction(()=>Boolean((window as any).__terminal));await page.getByRole('button',{name:'Add Widget',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Add Widget',exact:true});await expect(menu.getByRole('button',{name:'Add Order Book',exact:true})).toHaveCount(1);await expect(menu.getByRole('button',{name:'Add Depth Matrix',exact:true})).toHaveCount(0);
 await menu.getByRole('button',{name:'Add Order Book',exact:true}).click();
 const panel=page.locator('.depth-matrix-panel');await expect(panel.getByLabel('Mode',{exact:true})).toHaveValue('compact');
 await expect(panel.locator('.order-book-compact-head')).toContainText('USDT/full width');
 await expect.poll(async()=> (await page.evaluate(diagnostic))[0].pendingSettings).toBe(false);
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=> (window as any).__bookCommands.length),anchor=(await page.evaluate(diagnostic))[0].referenceAnchor;
 await panel.getByLabel('Show',{exact:true}).selectOption('levels');await panel.getByLabel('Venue lines',{exact:true}).selectOption('0');
 for(let i=0;i<3;i++){await panel.getByLabel('Mode',{exact:true}).selectOption('single');await expect(panel.locator('.depth-matrix-book')).toHaveCount(2);await panel.getByLabel('Mode',{exact:true}).selectOption('compact');}
 await expect(panel.getByLabel('Show',{exact:true})).toHaveValue('levels');await expect(panel.getByLabel('Venue lines',{exact:true})).toHaveValue('0');
 expect((await page.evaluate(diagnostic))[0].referenceAnchor).toEqual(anchor);expect(await page.evaluate(()=> (window as any).__bookCommands.length)).toBe(before);
 const scroll=panel.locator('.depth-matrix-scroll'),canvas=panel.locator('.order-book-compact-canvas');const bounds=await scroll.boundingBox();await canvas.dispatchEvent('pointermove',{clientX:bounds!.x+150,clientY:bounds!.y+bounds!.height/2});await expect(panel.locator('.depth-matrix-tooltip')).toContainText('USDT');
 await panel.getByLabel('Group',{exact:true}).selectOption('250');await expect.poll(async()=> (await page.evaluate(diagnostic))[0].pendingSettings).toBe(false);expect((await page.evaluate(diagnostic))[0].settings.bucketWidth).toBe('250');
 await selectTheme(page,'light');await page.setViewportSize({width:720,height:860});await expect(canvas).toBeVisible();await page.screenshot({path:'artifacts/order-book/compact-light-narrow.png'});
 await page.setViewportSize({width:1366,height:900});await selectTheme(page,'dark');await panel.getByLabel('Show',{exact:true}).selectOption('both');await panel.getByLabel('Venue lines',{exact:true}).selectOption('2');await page.screenshot({path:'artifacts/order-book/compact-dark.png'});
 await page.waitForTimeout(300);await page.reload();await expect(panel.getByLabel('Group',{exact:true})).toHaveValue('250');await expect(panel.getByLabel('Mode',{exact:true})).toHaveValue('compact');await expect(panel.getByLabel('Show',{exact:true})).toHaveValue('both');
 await panel.getByLabel('Mode',{exact:true}).selectOption('single');await expect(panel.locator('.depth-matrix-book')).toHaveCount(2);await page.waitForTimeout(300);await page.reload();await expect(panel.getByLabel('Mode',{exact:true})).toHaveValue('single');expect(errors).toEqual([]);
});
test('independent instances retain modes and hidden widgets stop painting',async({page})=>{
 await page.goto('/?fixture=1');await addWidget(page,'Order Book');await addWidget(page,'Order Book');
 const panels=page.locator('.depth-matrix-panel');await expect(panels).toHaveCount(2);await panels.nth(1).getByLabel('Mode',{exact:true}).selectOption('single');await expect(panels.nth(0).getByLabel('Mode',{exact:true})).toHaveValue('compact');await expect(panels.nth(1).locator('.depth-matrix-book')).toHaveCount(2);
 const hiddenId=await page.evaluate(()=>{const d=(window as any).__terminal.dock,b=d.panels.filter((p:any)=>p.view.contentComponent==='order-book');const id=b[0].id;b[0].api.moveTo({group:b[1].api.group});b[1].api.setActive();return id;});
 await expect(panels.nth(0)).toBeHidden();await page.waitForTimeout(100);const hidden=(await page.evaluate(diagnostic)).find((p:any)=>!p.visible);await page.waitForTimeout(350);expect((await page.evaluate(diagnostic)).find((p:any)=>!p.visible).paints).toEqual(hidden.paints);
 await page.evaluate(id=> (window as any).__terminal.dock.getPanel(id).api.setActive(),hiddenId);await expect(panels.nth(0)).toBeVisible();
});
test('legacy active and inactive workspaces restore once in Single with identity and preferences',async({page})=>{
 await page.goto('/?fixture=1');await addWidget(page,'Order Book');await page.waitForTimeout(250);
 const ids=await page.evaluate(()=>{
  const registry=JSON.parse(localStorage.getItem('iqterminal:workspaces:v1')!),active=registry.workspaces.find((w:any)=>w.id===registry.activeId);
  const entry=Object.values(active.layout.panels).find((p:any)=>p.contentComponent==='order-book') as any;
  entry.contentComponent='depth-matrix';entry.title='Depth Matrix';entry.params={sources:['binance-perpetual','binance-spot'],referenceSourceId:'binance-perpetual',bucketWidth:'250',columnWidth:130,unit:'usdt',scale:'shared',wallMode:'off'};
  const inactive=structuredClone(active);inactive.id='workspace-legacy-inactive';inactive.name='Legacy inactive';inactive.panelState={};inactive.layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[entry.id],activeView:entry.id,id:'legacy-group'},size:700}],size:900},width:1366,height:900,orientation:'HORIZONTAL'},panels:{[entry.id]:entry},activeGroup:'legacy-group'};registry.workspaces.push(inactive);localStorage.setItem('iqterminal:workspaces:v1',JSON.stringify(registry));return {panel:entry.id,inactive:inactive.id};
 });
 await page.reload();const panel=page.locator('.depth-matrix-panel');await expect(panel).toHaveCount(1);await expect(panel.getByLabel('Mode',{exact:true})).toHaveValue('single');
 const inspect=()=>page.evaluate(()=>{const t=(window as any).__terminal;return {panels:t.dock.panels.filter((p:any)=>p.view.contentComponent==='order-book').map((p:any)=>({id:p.id,settings:p.view.content.diagnostics().settings})),inactive:t.workspaces.registry.workspaces.find((w:any)=>w.id==='workspace-legacy-inactive').layout};});
 expect((await inspect()).panels).toMatchObject([{id:ids.panel,settings:{mode:'single',columnWidth:130,unit:'usdt',scale:'shared',wallMode:'off',sources:['binance-perpetual','binance-spot']}}]);
 expect(Object.values((await inspect()).inactive.panels).filter((p:any)=>p.contentComponent==='depth-matrix')).toHaveLength(0);
 await page.evaluate(id=>(window as any).__terminal.workspaces.switchTo(id),ids.inactive);await expect(panel).toHaveCount(1);await expect(panel.getByLabel('Mode',{exact:true})).toHaveValue('single');await page.reload();await expect(panel).toHaveCount(1);expect((await inspect()).panels[0].id).toBe(ids.panel);
});

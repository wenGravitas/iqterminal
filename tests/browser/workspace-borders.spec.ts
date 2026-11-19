import { test, expect, type Page } from '@playwright/test';
const sides = ['left', 'right', 'top', 'bottom'] as const;
async function ready(page: Page) {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.dock.panels.length)).toBe(2);
}
async function move(page: Page, side: string) {
  await page.locator('.dv-tab').first().click({ button: 'right' });
  await page.getByText(`Move to ${side}`, { exact: true }).click();
}
for (const side of sides) test(`native ${side} border preserves chart and reloads`, async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const t = (window as any).__terminal; (window as any).__before = new Map(t.panels); });
  await move(page, `${side} border`);
  await expect(page.getByRole('button', { name: `Collapse ${side} border`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const t = (window as any).__terminal; return [...(window as any).__before].every(([id,p]: any) => t.panels.get(id) === p); })).toBe(true);
  await page.getByRole('button', { name: `Collapse ${side} border`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Expand ${side} border`, exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__terminal.workspaces.saveCurrent());
  await page.reload();
  await page.screenshot({ path: `artifacts/border-${side}-restored.png` });
  await expect(page.getByRole('button', { name: `Expand ${side} border`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Expand ${side} border`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Collapse ${side} border`, exact: true })).toBeVisible();
});
test('edge drop uses native pointer drag and returning the final tab removes the border', async ({ page }) => {
  await ready(page);
  const tab = await page.locator('.dv-tab').first().boundingBox();
  const root = await page.locator('.dockview-theme-basis').boundingBox();
  await page.mouse.move(tab!.x + 25, tab!.y + 12); await page.mouse.down();
  await page.mouse.move(root!.x + root!.width - 3, root!.y + root!.height / 2, { steps: 20 });
  await expect(page.locator('.workspace-border-targets')).toHaveAttribute('data-active','right');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Collapse right border', exact: true })).toBeVisible();
  const id = await page.evaluate(() => { const d = (window as any).__terminal.dock; return d.groups.find((g: any) => g.api.location.type === 'edge').panels[0].id; });
  await page.evaluate(id => { const d = (window as any).__terminal.dock; d.getPanel(id).api.setActive(); }, id);
  // Context menu belongs to the same native tab regardless of its location.
  const edgeTab = page.locator('.dv-groupview').filter({ has: page.getByRole('button', { name: 'Collapse right border', exact: true }) }).locator('.dv-tab').first();
  await edgeTab.click({ button: 'right' });
  await page.getByText('Move to central workspace', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__terminal.dock.getEdgeGroup('right'))).toBe(false);
});
test('border transfers, resize, tab order, workspace switches and last central panel', async ({ page }) => {
  await ready(page);
  await move(page, 'bottom border');
  await page.evaluate(() => {
    const d = (window as any).__terminal.dock;
    const edge = d.groups.find((g: any) => g.api.location.type === 'edge');
    const other = d.panels.find((p: any) => p.api.location.type === 'grid');
    other.api.moveTo({ group: edge, index: 0 });
    edge.api.setSize({ height: 310 });
  });
  const saved = await page.evaluate(() => {
    const t = (window as any).__terminal; t.workspaces.saveCurrent();
    return { id: t.workspaces.active.id, edge: t.dock.toJSON().edgeGroups.bottom, params: Object.fromEntries(t.dock.panels.map((p: any) => [p.id, p.params])) };
  });
  await page.evaluate(() => (window as any).__terminal.workspaces.create('Border switch', false));
  await page.evaluate(id => (window as any).__terminal.workspaces.switchTo(id), saved.id);
  expect(await page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom)).toEqual(saved.edge);
  // A border-only workspace can create a central group without losing a widget.
  await move(page, 'central workspace');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.dock.groups.filter((g: any) => g.api.location.type === 'grid').length)).toBe(1);
  await move(page, 'left border');
  expect(await page.evaluate(() => (window as any).__terminal.dock.panels.length)).toBe(2);
});

test('collapsed charts are not scheduled and moving does not rebuild their engines', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const t = (window as any).__terminal; (window as any).__engines = new Map([...t.panels].map(([id,p]: any) => [id,p.engine])); });
  await move(page, 'right border');
  await page.getByRole('button', { name: 'Collapse right border', exact: true }).click();
  expect(await page.evaluate(() => { const t = (window as any).__terminal; const p = [...t.panels.values()].find((p: any) => p.params.api.location.type === 'edge') as any; return p.engine.visible; })).toBe(false);
  await page.getByRole('button', { name: 'Expand right border', exact: true }).click();
  expect(await page.evaluate(() => { const t = (window as any).__terminal; return [...t.panels].every(([id,p]: any) => (window as any).__engines.get(id) === p.engine); })).toBe(true);
});

async function dragTab(page: Page, tab: ReturnType<Page['locator']>, x: number, y: number) {
  const box = await tab.boundingBox();
  await page.mouse.move(box!.x + Math.min(30, box!.width / 2), box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(x, y, { steps: 20 }); await page.mouse.up();
}

test('pointer transfers across borders, reorders tabs, cancels invalid drags and resizes', async ({ page }) => {
  await ready(page);
  const root = await page.locator('#workspace').boundingBox();
  await dragTab(page, page.locator('.dv-tab').first(), root!.x + 3, root!.y + root!.height / 2);
  await expect(page.getByRole('button', { name: 'Collapse left border', exact: true })).toBeVisible();
  const left = page.locator('.dv-groupview').filter({ has: page.getByRole('button', { name: 'Collapse left border', exact: true }) });
  await dragTab(page, left.locator('.dv-tab'), root!.x + root!.width / 2, root!.y + root!.height - 3);
  await expect(page.getByRole('button', { name: 'Collapse bottom border', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse left border', exact: true })).toHaveCount(0);
  const bottom = page.locator('.dv-groupview').filter({ has: page.getByRole('button', { name: 'Collapse bottom border', exact: true }) });
  const header = await bottom.locator('.dv-tabs-and-actions-container').boundingBox();
  const central = page.locator('.dv-groupview').filter({ hasNot: page.locator('.workspace-border-toggle:not([hidden])') });
  await dragTab(page, central.locator('.dv-tab'), header!.x + header!.width / 2, header!.y + header!.height / 2);
  await expect(bottom.locator('.dv-tab')).toHaveCount(2);
  const before = await page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom.group.views);
  const second = await bottom.locator('.dv-tab').nth(1).boundingBox();
  await dragTab(page, bottom.locator('.dv-tab').first(), second!.x + second!.width - 3, second!.y + second!.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom.group.views)).toEqual([...before].reverse());
  const firstSlot = await bottom.locator('.dv-tab').first().boundingBox();
  await dragTab(page, bottom.locator('.dv-tab').nth(1), firstSlot!.x + 2, firstSlot!.y + firstSlot!.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom.group.views)).toEqual(before);
  const snapshot = await page.evaluate(() => (window as any).__terminal.dock.toJSON());
  const first = await bottom.locator('.dv-tab').first().boundingBox();
  await page.mouse.move(first!.x + 30, first!.y + 12); await page.mouse.down(); await page.mouse.move(400, 200, { steps: 10 });
  await expect(page.locator('.workspace-border-targets')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__terminal.dock.toJSON())).toEqual(snapshot);
  await expect(page.locator('.workspace-border-targets')).toBeHidden();
  const size = await page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom.size);
  const sash = page.locator('.dv-shell > .dv-split-view-container .dv-sash.dv-enabled').filter({ visible: true });
  const boxes = await sash.evaluateAll(nodes => nodes.map(node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }));
  const horizontal = boxes.find(box => box.width > 100 && box.height < 20)!;
  expect(horizontal).toBeTruthy();
  await page.mouse.move(horizontal.x + horizontal.width / 2, horizontal.y + horizontal.height / 2); await page.mouse.down();
  await page.mouse.move(horizontal.x + horizontal.width / 2, horizontal.y - 60, { steps: 15 }); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__terminal.dock.toJSON().edgeGroups.bottom.size)).toBeGreaterThan(size + 30);
});

test('border resize retains expensive chart subscriptions and history', async ({ page }) => {
  const { installDepthFixture } = await import('./depth-fixture');
  const { addIndicator } = await import('./indicator-actions');
  const worker = await installDepthFixture(page);
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order Walls');
  await addIndicator(panel, 'Order-book Heatmap');
  await addIndicator(panel, 'Footprint');
  await expect.poll(() => page.evaluate(() => { const p=[...(window as any).__terminal.panels.values()].find((p:any)=>p.selection.type==='footprint') as any; return !!p?.selection.historyViewport && p.footprintHasInitialView; })).toBe(true);
  await move(page, 'right border');
  await expect(page.getByRole('button', { name: 'Collapse right border', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__terminal.feed.resetProtocolDiagnostics());
  await worker.evaluate(() => { const original=self.fetch.bind(self); (self as any).__borderFetches=[]; self.fetch=((...args:Parameters<typeof fetch>)=>{(self as any).__borderFetches.push(String(args[0]));return original(...args);}) as typeof fetch; });
  const before = await worker.evaluate(() => { const p=(self as any).__heatmapFixture; return { sockets:p.sockets, active:p.active }; });
  const state = await page.evaluate(async () => {
    const t=(window as any).__terminal, p=[...t.panels.values()].find((p:any)=>p.params.api.location.type==='edge') as any;
    const engine=p.engine, bars=p.candles, config=JSON.stringify(p.selection), logos=[...document.querySelectorAll('.chart-tab-logo')];
    for (const width of [350,400,450,400,350,300]) { t.dock.getEdgeGroup('right').setSize({width}); await new Promise(requestAnimationFrame); }
    return { stableTabDom:logos.every(node=>node.isConnected), sameEngine:engine===p.engine, sameBars:bars===p.candles, configBefore:JSON.parse(config), configAfter:JSON.parse(JSON.stringify(p.selection)), protocol:t.feed.protocolDiagnostics() };
  });
  expect(state.stableTabDom).toBe(true); expect(state.sameEngine).toBe(true); expect(state.sameBars).toBe(true); expect(state.configAfter).toEqual(state.configBefore);
  for (const [command,count] of Object.entries(state.protocol.commandTypes)) if (/subscribe|unsubscribe|retry/.test(command)) expect(count,command).toBe(0);
  expect(await worker.evaluate(() => { const p=(self as any).__heatmapFixture; return { sockets:p.sockets, active:p.active }; })).toEqual(before);
  expect(await worker.evaluate(()=>(self as any).__borderFetches)).toEqual([]);
  await page.getByRole('button',{name:'Collapse right border',exact:true}).click();
  await page.getByRole('button',{name:'Expand right border',exact:true}).click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await worker.evaluate(()=>(self as any).__borderFetches)).toEqual([]);
});

test('Pi Chromium border resize frame timing and narrow viewport geometry', async ({ page }) => {
  test.setTimeout(120000);
  const { writeFile } = await import('node:fs/promises');
  await ready(page);
  const measure = (resize: boolean) => page.evaluate(async resize => {
    const t=(window as any).__terminal; t.resetMetrics();
    const intervals:number[]=[]; let last=performance.now();
    for(let i=0;i<90;i++) { if(resize) (t.dock.getEdgeGroup('right') ?? t.dock.groups[0].api).setSize({width:300+(i%60)*2}); await new Promise<void>(resolve=>requestAnimationFrame(now=>{intervals.push(now-last);last=now;resolve();})); }
    const sorted=intervals.slice(5).sort((a,b)=>a-b);
    return { p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),chartFrameIntervals:[...t.stats().frameIntervals],longTasks:[...t.stats().longTasks] };
  }, resize);
  await page.waitForFunction(()=>(window as any).__terminal.stats().panels.every((p:any)=>p.bars===5000));
  const repeat=async()=>{await measure(true);const samples=[];for(let i=0;i<3;i++)samples.push(await measure(true));return {...samples[1],p95:samples.map(s=>s.p95!).sort((a,b)=>a-b)[1],samples};};
  const idle=await measure(false);
  const baseline=await repeat();
  await move(page,'right border');
  const resizing=await repeat();
  const renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return gl&&ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';});
  await writeFile(process.env.IQ_BORDER_TIMING_FILE??'artifacts/workspace-borders-pi-timing.json',JSON.stringify({environment:'Raspberry Pi 5 Chromium headless; fixture data; baseline is equivalent central pane resize',renderer,idle,baseline,resizing},null,2));
  await page.screenshot({path:'artifacts/workspace-borders-desktop.png'});
  await page.setViewportSize({width:640,height:600});
  await page.getByRole('button',{name:'Collapse right border',exact:true}).click();
  await expect(page.getByRole('button',{name:'Expand right border',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/workspace-borders-narrow.png'});
  expect(resizing.p95!).toBeLessThan(Math.max(50,baseline.p95!*1.5));
});

test('registered order book, monitoring and trade-history widgets share saved borders', async ({ page }) => {
  const { installDepthFixture } = await import('./depth-fixture');
  await installDepthFixture(page);
  for (const [widget,side] of [['depth','right'],['watches','left'],['trade-history','bottom']] as const) {
    await page.evaluate(widget => { const t=(window as any).__terminal; t.widgetRegistry.find((w:any)=>w.id===widget).create(); const p=t.dock.activePanel; const tab=p.group.element.querySelectorAll('.dv-tab')[p.group.panels.indexOf(p)]; tab.setAttribute('data-border-test-target','true'); },widget);
    await page.locator('[data-border-test-target]').click({button:'right'});
    await page.getByText(`Move to ${side} border`,{exact:true}).click();
    await page.locator('[data-border-test-target]').evaluateAll(nodes=>nodes.forEach(node=>node.removeAttribute('data-border-test-target')));
    await expect(page.getByRole('button',{name:`Collapse ${side} border`,exact:true})).toBeVisible();
  }
  const before=await page.evaluate(()=>{const t=(window as any).__terminal;t.workspaces.saveCurrent();return t.dock.toJSON();});
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.dock.panels.length)).toBe(Object.keys(before.panels).length);
  const after=await page.evaluate(()=>(window as any).__terminal.dock.toJSON());
  for(const side of ['left','right','bottom'])expect(after.edgeGroups[side].group.views).toEqual(before.edgeGroups[side].group.views);
  for(const id of Object.keys(before.panels).filter(id=>!id.startsWith('chart-')))expect(after.panels[id].params).toEqual(before.panels[id].params);
});

import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/?fixture=1');
  await page.waitForFunction(()=>document.querySelectorAll('.candle-panel').length===2);
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((panel:any)=>panel.bars===5000&&panel.renderer.draws>0));
});

test('held mouse drags time and price, live patches preserve the view, Latest restores autoscale',async({page})=>{
  const read=()=>page.evaluate(()=>{
    const panel=(window as any).__terminal.panels.values().next().value;
    const d=panel.diagnostics();
    return {range:d.range,min:d.min,max:d.max,autoPrice:d.autoPrice,spacing:d.spacing};
  });
  const before=await read(),box=(await page.locator('.chart-stage canvas').first().boundingBox())!;
  const x=box.x+box.width*.45,y=box.y+box.height*.48;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y+55,{steps:5});await page.mouse.up();
  const dragged=await read();
  expect(dragged.range!.to).toBeLessThan(before.range!.to);
  expect(dragged.max-dragged.min).toBeCloseTo(before.max-before.min,1);
  expect(dragged.autoPrice).toBe(false);
  await page.mouse.wheel(0,80);
  const zoomed=await read();
  expect(zoomed.spacing).not.toBeCloseTo(dragged.spacing,3);
  await page.evaluate(()=>(window as any).__terminal.feed.send({type:'fixture',rate:1000}));
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].status.state)).toBe('live');
  const updated=await read();
  expect(updated.range!.from).toBeCloseTo(zoomed.range!.from,2);
  expect(updated.range!.to).toBeCloseTo(zoomed.range!.to,2);
  expect(updated.min).toBeCloseTo(zoomed.min,1);expect(updated.max).toBeCloseTo(zoomed.max,1);
  await page.evaluate(()=>(window as any).__terminal.feed.send({type:'fixture',rate:0}));
  await page.getByRole('button',{name:'Latest',exact:true}).first().click();
  expect((await read()).autoPrice).toBe(true);
  await page.locator('.chart-stage').first().press('Home');expect((await read()).autoPrice).toBe(true);
  await page.mouse.dblclick(x,y);expect((await read()).autoPrice).toBe(true);
});

test('charts render, controls persist, corrupt layout recovers',async({page})=>{
  await expect(page.locator('select[aria-label=Instrument]')).toHaveCount(2);
  await expect(page.locator('.chart-stage canvas')).toHaveCount(4);
  await page.locator('select[aria-label=Timeframe]').first().selectOption('15m');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].bars)).toBe(5000);
  await page.getByRole('link',{name:'Third-party licences'}).click();
  await expect(page).toHaveURL(/\/licenses\/$/);
  await expect(page.getByRole('heading',{name:'OpenAlgo Charts 2.6.0'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Full Apache License 2.0'})).toHaveAttribute('href','/licenses/openalgo-charts/LICENSE');
  await page.goto('/?fixture=1');
  await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('15m');
  await page.reload();
  await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('15m');
  await page.evaluate(()=>localStorage.setItem('basis.layout.v1','{broken'));
  await page.reload();await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('1m');
});

test('add, grouping, tab reorder, split docking, resize, close/empty, restore',async({page})=>{
  await page.getByRole('button',{name:'Add chart',exact:true}).first().click();await expect(page.locator('.candle-panel')).toHaveCount(3);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;d.panels[2].api.moveTo({group:d.panels[0].api.group,position:'center',index:0});});
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;d.panels[0].api.moveTo({group:d.panels[1].api.group,position:'below'});});
  await expect(page.locator('.dv-groupview')).toHaveCount(3);await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(400);await page.reload();await expect(page.locator('.candle-panel')).toHaveCount(3);
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;for(const p of [...d.panels])p.api.close();});await expect(page.getByText('No charts open')).toBeVisible();await page.waitForTimeout(300);await page.reload();await expect(page.getByText('No charts open')).toBeVisible();await page.getByRole('button',{name:'Add chart',exact:true}).last().click();await expect(page.locator('.candle-panel')).toHaveCount(1);
});

test('hidden panels suspend chart frames and panned views survive activation in Canvas2D',async({page})=>{
  const visible=page.locator('.chart-stage canvas').first(),box=(await visible.boundingBox())!;
  const x=box.x+box.width*.4,y=box.y+box.height*.4;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-35,y,{steps:4});await page.mouse.up();
  await page.mouse.wheel(0,80);
  await page.waitForTimeout(700);
  const view=await page.evaluate(()=>(window as any).__terminal.stats().panels[0]);
  await page.evaluate(()=>{const t=(window as any).__terminal;t.feed.send({type:'fixture',rate:1000});const d=t.dock;d.panels[1].api.moveTo({group:d.panels[0].api.group,position:'center'});});await page.waitForTimeout(200);
  const before=await page.evaluate(()=>{const t=(window as any).__terminal,p=t.stats().panels.find((panel:any)=>!panel.visible);return {...p,readout:document.querySelector(`[data-panel-id="${p.id}"] .ohlc`)?.textContent};});
  await page.waitForTimeout(600);
  const after=await page.evaluate(()=>{const t=(window as any).__terminal,p=t.stats().panels.find((panel:any)=>!panel.visible);return {...p,readout:document.querySelector(`[data-panel-id="${p.id}"] .ohlc`)?.textContent};});
  expect(after.renderer.draws).toBe(before.renderer.draws);
  expect(after.last.c).not.toBe(before.last.c);
  expect(after.readout).toBe(before.readout);
  await page.evaluate(id=>(window as any).__terminal.dock.getPanel(id).api.setActive(),view.id);
  const restored=await page.evaluate(id=>(window as any).__terminal.stats().panels.find((panel:any)=>panel.id===id),view.id);
  expect(restored.spacing).toBe(view.spacing);expect(restored.range.to).toBeCloseTo(view.range.to,2);
  expect(restored.renderer.backend).toBe('canvas2d');
  await page.evaluate(()=>(window as any).__terminal.feed.send({type:'fixture',rate:0}));
  await expect(page.locator('.ohlc').first()).not.toBeEmpty();
});

test('series applies late history corrections, remains capped at 5,000 bars, and chart closes cleanly',async({page})=>{
  const panelId=await page.evaluate(()=>[...(window as any).__terminal.panels.keys()][0]);
  const before=await page.evaluate(id=>{
    const panel=(window as any).__terminal.panels.get(id),bars=panel.engine.series.getData(),target=bars[10];
    const corrected={t:target.time*1000,o:target.open,h:target.high+8,l:target.low,c:target.close+8,v:(target.volume??0)+1,revision:999999,closed:false};
    panel.engine.applyPatch([corrected]);
    const last=bars.at(-1);
    const next={t:(last.time+60)*1000,o:last.close,h:last.close+20,l:last.close-20,c:last.close+1,v:7,revision:1000000,closed:false};
    panel.engine.applyPatch([next]);
    return {corrected:corrected.c,targetTime:target.time,firstTime:bars[0].time,nextTime:next.t/1000,barCount:panel.engine.barCount,backend:panel.engine.backend};
  },panelId);
  expect(before.barCount).toBe(5000);
  const data=await page.evaluate(({id,targetTime})=>{
    const panel=(window as any).__terminal.panels.get(id),bars=panel.engine.series.getData();
    return {length:bars.length,first:bars[0].time,last:bars.at(-1).time,corrected:bars.find((bar:any)=>bar.time===targetTime)?.close};
  },{id:panelId,targetTime:before.targetTime});
  expect(data.length).toBe(5000);expect(data.last).toBe(before.nextTime);expect(data.first).toBe(before.firstTime+60);expect(data.corrected).toBe(before.corrected);
  expect(before.backend).toBe('canvas2d');
  await page.evaluate(id=>(window as any).__terminal.dock.getPanel(id).api.close(),panelId);
  await expect(page.locator('.candle-panel')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.has(id),panelId)).toBe(false);
});

test('unavailable direct endpoint displays recoverable error',async({page})=>{
  await page.route('https://fapi.binance.com/**',route=>route.fulfill({status:451,body:'unavailable'}));
  await page.goto('/');
  await expect(page.getByText(/History HTTP 451/)).toBeVisible({timeout:20000});
  await expect(page.getByRole('button',{name:'Retry market data'}).first()).toBeVisible();
});

test('native tab drag groups charts and splitter drag resizes',async({page})=>{
  const tab=page.locator('.dv-tab').first(),target=page.locator('.dv-tab').last();
  await tab.dragTo(target);await expect(page.locator('.dv-groupview')).toHaveCount(1);
  await page.getByRole('button',{name:'Add chart',exact:true}).first().click();await expect(page.locator('.dv-groupview')).toHaveCount(2);
  const sash=page.locator('.dv-sash.dv-enabled').first();const box=await sash.boundingBox();if(!box)throw new Error('Splitter absent');const before=await page.locator('.dv-groupview').first().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+100,box.y+box.height/2,{steps:10});await page.mouse.up();const after=await page.locator('.dv-groupview').first().boundingBox();expect(Math.abs(after!.width-before!.width)).toBeGreaterThan(20);
});

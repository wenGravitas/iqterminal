import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.beforeEach(async({page})=>{
  await page.goto('/?fixture=1');
  await page.waitForFunction(()=>document.querySelectorAll('.candle-panel').length===2);
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((panel:any)=>panel.bars===5000&&panel.renderer.draws>0&&panel.autoPrice&&panel.max-panel.min>100));
});

test('tab cycling is per group, editable, pausable, and removed with its Dockview group',async({page})=>{
  const groups=await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    const dock=terminal.dock;
    const original=[...dock.groups];
    original.forEach((group:any,index:number)=>dock.addPanel({
      id:`cycle-tab-${index}`,component:'candle',title:`Cycle ${index+1}`,
      params:{venue:index===0?'binance':'hyperliquid',market:'perpetual',interval:'1m',type:'candle',studies:[]},
      position:{referencePanel:group.activePanel,direction:'within'},
    }));
    return dock.groups.map((group:any)=>({
      id:group.id,
      active:group.activePanel.id,
      panels:group.panels.map((panel:any)=>panel.id),
    }));
  });
  expect(groups).toHaveLength(2);
  await expect(page.locator('.tab-cycle-actions:not([hidden])')).toHaveCount(2);
  const firstAction=page.locator(`.tab-cycle-actions[data-group-id="${groups[0].id}"]`);
  const secondId=groups[1].id;
  const secondAction=page.locator(`.tab-cycle-actions[data-group-id="${secondId}"]`);
  await firstAction.getByRole('button',{name:'Cycle tabs'}).click();
  const dialog=page.getByRole('dialog',{name:'Cycle group tabs'});
  const interval=dialog.getByRole('spinbutton',{name:'Seconds per tab'});
  await expect(interval).toHaveValue('10');
  await interval.fill('1');
  await dialog.getByRole('button',{name:'Start'}).click();
  const manualTarget=groups[0].panels.find((id:string)=>id!==groups[0].active)!;
  await page.evaluate((id:string)=>(window as any).__terminal.dock.getPanel(id).api.setActive(),manualTarget);
  const current=(id:string)=>page.evaluate((groupId:string)=>{
    const group=(window as any).__terminal.dock.groups.find((item:any)=>item.id===groupId);
    return group?.activePanel?.id;
  },id);
  const untouchedSecond=await current(secondId);
  await page.waitForTimeout(500);
  expect(await current(groups[0].id)).toBe(manualTarget);
  await expect.poll(()=>current(groups[0].id),{timeout:2500}).not.toBe(manualTarget);
  expect(await current(secondId)).toBe(untouchedSecond);

  await firstAction.getByRole('button',{name:'Cycle tabs'}).click();
  await expect(dialog.getByRole('button',{name:'Restart'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Stop'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await firstAction.getByRole('button',{name:'Cycle tabs'}).click();
  const beforeStop=await current(groups[0].id);
  await dialog.getByRole('button',{name:'Stop'}).click();
  await expect(firstAction.getByRole('button',{name:'Cycle tabs'})).toHaveAttribute('aria-pressed','false');
  await page.waitForTimeout(1100);
  expect(await current(groups[0].id)).toBe(beforeStop);

  await secondAction.getByRole('button',{name:'Cycle tabs'}).click();
  const secondDialog=page.getByRole('dialog',{name:'Cycle group tabs'});
  await secondDialog.getByRole('spinbutton',{name:'Seconds per tab'}).fill('1');
  await secondDialog.getByRole('button',{name:'Start'}).click();
  const firstAfterStop=await current(groups[0].id);
  await page.evaluate(groupId=>{
    const dock=(window as any).__terminal.dock;
    const group=dock.groups.find((item:any)=>item.id===groupId);
    if(group)dock.removeGroup(group);
  },secondId);
  await expect(secondAction).toHaveCount(0);
  await page.waitForTimeout(1100);
  expect(await current(groups[0].id)).toBe(firstAfterStop);

  await page.evaluate(id=>(window as any).__terminal.dock.getPanel(id)?.api.close(),`cycle-tab-0`);
  await expect(firstAction).toBeHidden();
  expect(await firstAction.boundingBox()).toBeNull();

  await page.getByRole('button',{name:'Reset layout'}).click();
  await expect(page.locator('.tab-cycle-actions:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.candle-panel')).toHaveCount(2);
});

async function openLibraryEditor(page:any) {
  await page.getByRole('button',{name:'Indicators',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add an indicator'}).getByRole('button',{name:'Manage library'}).click();
  await expect(page.locator('.script-editor-panel')).toBeVisible();
}

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
  await expect(page.getByRole('link',{name:'Full Apache License 2.0'}).first()).toHaveAttribute('href','/licenses/openalgo-charts/LICENSE');
  await page.goto('/?fixture=1');
  await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('15m');
  await page.reload();
  await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('15m');
  await page.evaluate(()=>localStorage.setItem('basis.layout.v1','{broken'));
  await page.reload();await expect(page.locator('select[aria-label=Timeframe]').first()).toHaveValue('1m');
});

test('Binance Spot stays a distinct BTCUSDT series and legacy layouts keep defaulting to Perp',async({page})=>{
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    const layout=terminal.dock.toJSON();
    const binance=Object.values(layout.panels).find((panel:any)=>panel.params?.venue==='binance') as any;
    if(binance)delete binance.params.market;
    localStorage.setItem('basis.layout.v1',JSON.stringify({version:1,layout}));
  });
  await page.reload();
  const instrument=page.locator('select[aria-label=Instrument]').first();
  await expect(instrument).toHaveValue('binance:perpetual');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].series.market)).toBe('perpetual');

  await instrument.selectOption('binance:spot');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].series)).toMatchObject({venue:'binance',market:'spot',interval:'1m'});
  const panel=page.locator('.candle-panel').first();
  await expect(panel.locator('.instrument-meta')).toContainText('USDT quote · BTC volume');
  await expect(panel.locator('.chart-stage')).toHaveAttribute('aria-label','Binance · BTCUSDT Spot candlestick chart');

  await panel.getByRole('button',{name:'Indicators'}).click();
  const picker=page.getByRole('dialog',{name:'Add an indicator'});
  const depth=picker.locator('[data-add-script="builtin.binance-depth-band"]');
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveAttribute('title','Depth studies require Binance BTCUSDT USD-M Perp');
  await expect.poll(()=>page.evaluate(()=> (window as any).__terminal.feed.diagnostics.depth?.subscribers ?? 0)).toBe(0);
  await picker.locator('[data-add-script="builtin.ema-overlay"]').getByText('EMA overlay',{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.diagnostics().context)).toEqual({symbol:'BTCUSDT',exchange:'Binance Spot',interval:'1m'});
  await picker.getByRole('button',{name:'Manage library'}).click();
  const editor=page.locator('.script-editor-panel');
  await page.getByRole('combobox',{name:'Library'}).selectOption('builtin.binance-depth-band');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  await expect.poll(()=>page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    const view=panel.studies.views().find((item:any)=>item.scriptId==='builtin.binance-depth-band');
    return {status:view?.status,outputs:view?.outputs,subscribers:(window as any).__terminal.feed.diagnostics.depth?.subscribers ?? 0};
  })).toMatchObject({status:expect.stringContaining('Binance BTCUSDT USD-M Perp only'),outputs:{p0:null,p1:null},subscribers:0});
  await expect(page.getByRole('combobox',{name:'Target chart'}).locator('option').filter({hasText:/Binance · BTCUSDT Spot · 1m/})).toHaveCount(1);

  await page.reload();
  await expect(page.locator('select[aria-label=Instrument]').first()).toHaveValue('binance:spot');
  await expect.poll(()=>page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    return {context:panel.studies.diagnostics().context,depth:panel.studies.views().find((view:any)=>view.scriptId==='builtin.binance-depth-band')?.status,subscribers:(window as any).__terminal.feed.diagnostics.depth?.subscribers ?? 0};
  })).toMatchObject({context:{symbol:'BTCUSDT',exchange:'Binance Spot',interval:'1m'},depth:expect.stringContaining('Binance BTCUSDT USD-M Perp only'),subscribers:0});
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

test('indicator picker adds from the title and native legend controls isolate settings, open source, and remove workers',async({page})=>{
  const firstPanel=page.locator('.candle-panel').first();
  await firstPanel.getByRole('button',{name:'Indicators'}).click();
  const picker=page.getByRole('dialog',{name:'Add an indicator'});
  const ema=picker.locator('.indicator-option').filter({hasText:'EMA overlay'});
  await expect(ema).toBeEnabled();
  await ema.getByText('EMA overlay',{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.diagnostics().attached)).toBe(1);
  await expect(picker.locator('.dialog-status')).toContainText('added with its default settings');
  await ema.getByText('EMA overlay',{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.diagnostics().attached)).toBe(2);
  const initial=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().map((view:any)=>({id:view.attachmentId,settings:view.settings,revision:view.revisionId,scriptId:view.scriptId})));
  expect(initial).toHaveLength(2);
  await picker.getByRole('button',{name:'Done'}).click();

  const secondPanel=page.locator('.candle-panel').nth(1);
  await secondPanel.getByRole('button',{name:'Indicators'}).click();
  const secondPicker=page.getByRole('dialog',{name:'Add an indicator'});
  const depth=secondPicker.locator('.indicator-option[data-add-script="builtin.binance-depth-band"]');
  await expect(depth).toBeDisabled();
  await expect(depth).toContainText('Binance BTCUSDT USD-M Perp only');
  await secondPicker.getByRole('button',{name:'Done'}).click();

  const canvas=page.locator('.chart-stage canvas').first();
  const box=(await canvas.boundingBox())!;
  const clickLegend=async(xOffset:number,rowOffset:number)=>{
    await page.mouse.move(box.x+150,box.y+rowOffset);
    await page.waitForTimeout(80);
    await page.mouse.click(box.x+xOffset,box.y+rowOffset);
  };
  const settings=page.getByRole('dialog',{name:'Study settings'});
  await clickLegend(210,48);
  await expect(settings).toBeVisible();
  const length=settings.locator('[data-input-key="length"]');
  await expect(length).toHaveValue('20');
  await length.fill('0');
  await settings.getByRole('button',{name:'Apply'}).click();
  await expect(settings.locator('.dialog-status')).toContainText('Check the highlighted setting values');
  expect(await page.evaluate(id=>[...(window as any).__terminal.panels.values()][0].studies.views().find((view:any)=>view.attachmentId===id)?.settings.length,initial[1].id)).toBeUndefined();
  await length.fill('8');
  await settings.getByRole('button',{name:'Apply'}).click();
  await expect(settings).not.toBeVisible();
  const changed=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().map((view:any)=>({id:view.attachmentId,settings:view.settings})));
  expect(changed.find((view:any)=>view.id===initial[0].id)?.settings.length).toBeUndefined();
  expect(changed.find((view:any)=>view.id===initial[1].id)?.settings.length).toBe(8);

  await clickLegend(228,32);
  const editor=page.locator('.script-editor-panel');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Attached study'})).toHaveValue(initial[0].id);
  const source=await page.evaluate(async({scriptId,revisionId})=>{
    const record=await (window as any).__terminal.library.get(scriptId);
    return record.revisions.find((item:any)=>item.id===revisionId)?.source;
  },{scriptId:initial[0].scriptId,revisionId:initial[0].revision});
  await expect(page.getByLabel('OpenScript source')).toHaveValue(source);
  await page.evaluate(()=> (window as any).__terminal.dock.getPanel('script-editor').api.close());
  await expect(editor).toHaveCount(0);
  await expect(canvas).toBeVisible();
  await clickLegend(236,48);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.diagnostics().attached)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.diagnostics().workers)).toBe(1);
});

test('declining a dirty native source switch keeps the editor chart and attachment target',async({page})=>{
  const addEma=async(index:number)=>{
    const panel=page.locator('.candle-panel').nth(index);
    await panel.getByRole('button',{name:'Indicators'}).click();
    const picker=page.getByRole('dialog',{name:'Add an indicator'});
    await picker.locator('.indicator-option[data-add-script="builtin.ema-overlay"]').getByText('EMA overlay',{exact:true}).click();
    await expect.poll(()=>page.evaluate(i=>[...(window as any).__terminal.panels.values()][i].studies.diagnostics().attached,index)).toBe(1);
    await picker.getByRole('button',{name:'Done'}).click();
  };
  await addEma(0);await addEma(1);
  const pins=await page.evaluate(()=>[...(window as any).__terminal.panels.entries()].map(([id,panel]:any)=>({id,pin:panel.studies.views()[0]})));
  const clickSource=async(index:number)=>{
    const canvas=page.locator('.candle-panel').nth(index).locator('.chart-stage canvas').first(),box=(await canvas.boundingBox())!;
    await page.mouse.move(box.x+150,box.y+32);await page.waitForTimeout(80);await page.mouse.click(box.x+228,box.y+32);
  };
  await clickSource(0);
  const editor=page.locator('.script-editor-panel');
  await expect(editor).toBeVisible();
  const target=page.getByRole('combobox',{name:'Target chart'}),attachment=page.getByRole('combobox',{name:'Attached study'}),source=page.getByLabel('OpenScript source');
  await expect(target).toHaveValue(pins[0].id);await expect(attachment).toHaveValue(pins[0].pin.attachmentId);
  const draft=`${await source.inputValue()}\n// retained after cancelling source navigation`;
  await source.fill(draft);

  const dialogHandled=page.waitForEvent('dialog').then(async dialog=>{
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('unsaved editor draft');
    await dialog.dismiss();
  });
  await clickSource(1);
  await dialogHandled;
  await expect(target).toHaveValue(pins[0].id);
  await expect(attachment).toHaveValue(pins[0].pin.attachmentId);
  await expect(source).toHaveValue(draft);

  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  const after=await page.evaluate(()=>[...(window as any).__terminal.panels.entries()].map(([id,panel]:any)=>({id,views:panel.studies.views()})));
  expect(after.find((panel:any)=>panel.id===pins[0].id)?.views[0].revisionId).not.toBe(pins[0].pin.revisionId);
  expect(after.find((panel:any)=>panel.id===pins[1].id)?.views[0].revisionId).toBe(pins[1].pin.revisionId);
});

test('one synthetic depth observation creates native sparse markers that follow a forming-bar revision',async({page})=>{
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,feed=terminal.feed;
    feed.subscribeDepth=(_id:string,_band:number,callback:(event:any)=>void)=>{
      (window as any).__syntheticDepthCapture={callback};
      return ()=>{delete (window as any).__syntheticDepthCapture;};
    };
  });
  await page.getByRole('button',{name:'Indicators',exact:true}).first().click();
  const picker=page.getByRole('dialog',{name:'Add an indicator'});
  await picker.locator('.indicator-option[data-add-script="builtin.binance-depth-band"]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.diagnostics().attached)).toBe(1);
  await picker.getByRole('button',{name:'Done'}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).__syntheticDepthCapture))).toBe(true);

  const observation=await page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    const bar=panel.engine.series.getData().at(-1);
    const synthetic={sampledAt:bar.time*1000+1000,mid:84000,bandPercent:0.05,bidBase:1,askBase:1,bidQuote:200000,askQuote:800000,bidCovered:true,askCovered:true};
    (window as any).__syntheticDepthCapture.callback({type:'depth-history',ids:[],bandPercent:0.05,observations:[synthetic]});
    return {time:bar.time,observation:synthetic};
  });

  const readMarkers=()=>page.evaluate((barTime:number)=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    const study=[...panel.studies.studies.values()][0];
    const values=study.api.values();
    const bid=values.p0.at(-1),ask=values.p1.at(-1);
    const stage=panel.element.querySelector('.chart-stage') as HTMLElement;
    const stageRect=stage.getBoundingClientRect();
    const chart=panel.engine.chart;
    const x=chart.timeToCoordinate(barTime);
    const y=chart.priceToCoordinate(bid,study.api.paneIndex);
    if(y===null)return {bid,ask,x,y,green:0};
    const absoluteX=stageRect.left+x,absoluteY=stageRect.top+y;
    let green=0;
    for(const canvas of [...stage.querySelectorAll('canvas')] as HTMLCanvasElement[]){
      const rect=canvas.getBoundingClientRect(),sx=canvas.width/rect.width,sy=canvas.height/rect.height;
      const cx=Math.round((absoluteX-rect.left)*sx),cy=Math.round((absoluteY-rect.top)*sy);
      if(cx<0||cy<0||cx>=canvas.width||cy>=canvas.height)continue;
      const context=canvas.getContext('2d');if(!context)continue;
      const left=Math.max(0,cx-8),top=Math.max(0,cy-8),width=Math.min(canvas.width-1,cx+8)-left+1,height=Math.min(canvas.height-1,cy+8)-top+1;
      const pixels=context.getImageData(left,top,width,height).data;
      for(let index=0;index<pixels.length;index+=4){
        const red=pixels[index]!,channelGreen=pixels[index+1]!,blue=pixels[index+2]!,alpha=pixels[index+3]!;
        if(alpha>0&&channelGreen>150&&channelGreen>red*1.35&&channelGreen>blue*1.1)green++;
      }
    }
    return {bid,ask,x,y,green};
  },observation.time);
  await expect.poll(async()=>{
    const marker=await readMarkers();
    return marker.bid===200000&&marker.ask===800000&&marker.green>0;
  }).toBe(true);
  const before=await readMarkers();

  await page.evaluate(({barTime,synthetic})=>{
    (window as any).__syntheticDepthCapture.callback({type:'depth-sample',ids:[],observation:{...synthetic,sampledAt:barTime*1000+2000,bidQuote:1200000}});
  },{barTime:observation.time,synthetic:observation.observation});
  await expect.poll(async()=>{
    const marker=await readMarkers();
    return marker.bid===1200000&&marker.ask===800000&&marker.green>0&&Math.abs(marker.y-before.y)>2;
  }).toBe(true);
  const after=await readMarkers();
  expect(after.y).not.toBe(before.y);
  expect(after.green).toBeGreaterThan(0);
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

test('OpenScript editor previews inputs, applies immutable revisions, retains last good study and restores attachments',async({page})=>{
  await openLibraryEditor(page);
  const library=page.getByRole('combobox',{name:'Library'});
  await library.selectOption('builtin.ema-overlay');
  await page.getByRole('button',{name:'Preview inputs'}).click();
  const length=page.locator('.script-inputs [data-input-key="length"]');
  await expect(length).toBeVisible();
  await length.fill('8');
  await page.getByLabel('Title').fill('EMA Local Check');
  await page.getByLabel('Description').fill('A locally saved EMA revision.');
  await page.getByRole('button',{name:'Save copy'}).click();
  await expect(library).toHaveValue(/script-/);
  await expect(page.locator('.script-editor-status')).toContainText('as a new local script');
  await page.getByRole('button',{name:'Apply'}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    return panel.studies?.views().length??0;
  })).toBe(1);
  await expect(page.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
  const first=await page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    const view=panel.studies.views()[0];
    return {id:view.attachmentId,revision:view.revisionId,settings:view.settings,slots:panel.engine.chart.indicators().length};
  });
  expect(first.settings.length).toBe(8);
  expect(first.slots).toBeGreaterThan(0);

  const source=page.getByLabel('OpenScript source');
  const valid=await source.inputValue();
  await source.fill(valid.replace('width = 2','width = 3'));
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.script-editor-status')).toContainText(/Saved revision/);
  const savedCurrent=await page.evaluate(id=>(window as any).__terminal.library.get(id),await library.inputValue());
  expect(savedCurrent.currentRevision).not.toBe(first.revision);
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views()[0].revisionId)).toBe(first.revision);
  await page.getByRole('button',{name:'Apply'}).click();
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views()[0].revisionId)).toBe(savedCurrent.currentRevision);
  const updated=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views()[0]);
  expect(updated.revisionId).toBe(savedCurrent.currentRevision);
  expect(updated.settings.length).toBe(8);

  await source.fill('version 1\nstudy("Invalid")\nplot(close +, "Broken")');
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(page.locator('.script-editor-status')).toContainText(/expected|invalid|error/i);
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().map((view:any)=>view.revisionId))).toEqual([updated.revisionId]);

  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('.script-editor-panel')).toBeVisible();
  await expect.poll(()=>page.evaluate(revision=>[...(window as any).__terminal.panels.values()].some((panel:any)=>panel.studies?.views().some((view:any)=>view.revisionId===revision)),updated.revisionId),{timeout:10000}).toBe(true);
});

test('OpenScript package roundtrip, visibility, repeat removal and loop budget keep the feed responsive',async({page})=>{
  await openLibraryEditor(page);
  const editor=page.locator('.script-editor-panel');
  await expect(editor).toBeVisible();
  const library=page.getByRole('combobox',{name:'Library'});
  await library.selectOption('builtin.ema-overlay');
  await page.getByRole('button',{name:'Save copy'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('as a new local script');
  const originalId=await library.inputValue();

  const downloadReady=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export package'}).click();
  const download=await downloadReady;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await expect(editor.locator('.script-editor-status')).toContainText('Exported');
  const path=await download.path();
  if(!path) throw new Error('OpenScript package export did not create a file.');
  await page.locator('input[type=file]').setInputFiles({name:download.suggestedFilename(),mimeType:'application/json',buffer:await readFile(path)});
  await expect(editor.locator('.script-editor-status')).toContainText('Imported', {timeout:10_000});
  const importedId=await library.inputValue();
  expect(importedId).not.toBe(originalId);
  const hashes=await page.evaluate(async({originalId,importedId})=>{
    const t=(window as any).__terminal;
    const [original,imported]=await Promise.all([t.library.get(originalId),t.library.get(importedId)]);
    return {original:original.revisions.find((r:any)=>r.id===original.currentRevision)?.contentHash,imported:imported.revisions.find((r:any)=>r.id===imported.currentRevision)?.contentHash};
  },{originalId,importedId});
  expect(hashes.imported).toBe(hashes.original);

  const sourceDownloadReady=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export source'}).click();
  const sourceDownload=await sourceDownloadReady;
  expect(sourceDownload.suggestedFilename()).toMatch(/\.oscript$/);
  await expect(editor.locator('.script-editor-status')).toContainText('Exported');
  const sourcePath=await sourceDownload.path();
  if(!sourcePath) throw new Error('OpenScript source export did not create a file.');
  await page.locator('input[type=file]').setInputFiles({name:sourceDownload.suggestedFilename(),mimeType:'text/plain',buffer:await readFile(sourcePath)});
  await expect(editor.locator('.script-editor-status')).toContainText('Imported', {timeout:10_000});
  const plainId=await library.inputValue();
  expect(plainId).not.toBe(importedId);
  expect(await page.getByLabel('OpenScript source').inputValue()).toContain('plot(average, "EMA"');

  const panel=()=>page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0];
    const d=p.diagnostics();
    return {workers:d.studies.workers,attached:d.studies.attached,visible:p.studies.views()[0]?.visible};
  });
  for(let cycle=0;cycle<3;cycle++){
    await page.getByRole('button',{name:'Apply'}).click();
    await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
    await expect.poll(async()=>(await panel()).workers).toBe(1);
    const visible=page.locator('.script-attachment input[type="checkbox"]').first();
    await visible.uncheck();
    await expect.poll(async()=>(await panel()).visible).toBe(false);
    await visible.check();
    await expect.poll(async()=>(await panel()).visible).toBe(true);
    await page.locator('.script-attachment button[data-action="remove"]').click();
    await expect.poll(async()=>(await panel()).workers).toBe(0);
    await expect.poll(async()=>(await panel()).attached).toBe(0);
  }

  await page.evaluate(()=> (window as any).__terminal.feed.send({type:'fixture',rate:1000}));
  await page.waitForTimeout(300);
  await page.evaluate(()=> (window as any).__terminal.feed.send({type:'diagnostics'}));
  await expect.poll(()=>page.evaluate(()=>Number((window as any).__terminal.feed.diagnostics.syntheticMessages??0))).toBeGreaterThan(0);
  const feedBefore=await page.evaluate(()=>Number((window as any).__terminal.feed.diagnostics.syntheticMessages??0));
  const before=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().last.c);
  const source=page.getByLabel('OpenScript source');
  await source.fill('version 1\nstudy("Loop budget proof")\nlimits(loops = 1000000)\nx = 0\nfor i = 0 to 1000000\n    x = x + close\nplot(x, "Runaway")');
  const began=Date.now();
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText(/loop|budget/i,{timeout:5000});
  const elapsed=Date.now()-began;
  expect(elapsed).toBeLessThan(2500);
  await page.waitForTimeout(350);
  await page.evaluate(()=> (window as any).__terminal.feed.send({type:'diagnostics'}));
  await expect.poll(()=>page.evaluate(()=>Number((window as any).__terminal.feed.diagnostics.syntheticMessages??0))).toBeGreaterThan(feedBefore+20);
  const after=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().last.c);
  expect(after).not.toBe(before);
  await expect.poll(async()=>(await panel()).workers).toBe(0);
});

test('two attachments keep independent inputs and unsupported depth states stay explicit',async({page})=>{
  await openLibraryEditor(page);
  const editor=page.locator('.script-editor-panel');
  const target=page.getByRole('combobox',{name:'Target chart'});
  const library=page.getByRole('combobox',{name:'Library'});
  const newAttachment=page.getByRole('combobox',{name:'Attached study'});
  await library.selectOption('builtin.ema-overlay');
  await page.getByRole('button',{name:'Preview inputs'}).click();
  const length=page.locator('.script-inputs [data-input-key="length"]');
  await length.fill('8');
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().length)).toBe(1);
  await newAttachment.selectOption('');
  await expect(newAttachment).toHaveValue('');
  await page.locator('.script-inputs [data-input-key="length"]').fill('13');
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().length)).toBe(2);
  const settings=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().map((view:any)=>view.settings.length));
  expect(settings.sort((a:number,b:number)=>a-b)).toEqual([8,13]);
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].diagnostics().studies.workers)).toBe(2);

  await library.selectOption('builtin.binance-depth-band');
  const depthSource=page.getByLabel('OpenScript source');
  const validDepth=await depthSource.inputValue();
  await depthSource.fill(validDepth.replace('input(0.05, "Depth band (%)", min = 0.01, max = 0.25, step = 0.01)','input(0.5, "Depth band (%)", min = 0.01, max = 5, step = 0.01)'));
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText(/0\.01% and 0\.25%/);
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].studies.views().length)).toBe(2);

  await depthSource.fill(validDepth);
  await target.selectOption({label:'Hyperliquid · BTC Perp · 1m'});
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()].find((p:any)=>p.diagnostics().series.venue==='hyperliquid')?.diagnostics().bars)).toBe(5000);
  await page.getByRole('button',{name:'Apply'}).click();
  await expect(editor.locator('.script-editor-status')).toContainText('Applied. This chart now pins the exact immutable revision.');
  await page.evaluate(()=> (window as any).__terminal.feed.send({type:'diagnostics'}));
  await page.waitForTimeout(100);
  const unsupported=await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()].find((item:any)=>item.series.venue==='hyperliquid');
    return {view:p.studies.views()[0],depth:(window as any).__terminal.feed.diagnostics.depth};
  });
  expect(unsupported.view.status).toContain('Binance BTCUSDT USD-M Perp only');
  expect(Object.values(unsupported.view.outputs)).toEqual([null,null]);
  expect(unsupported.depth.subscribers).toBe(0);
  await expect.poll(()=>page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()].find((item:any)=>item.series.venue==='hyperliquid');
    const notice=panel?.element.querySelector('.depth-notice') as HTMLElement|null;
    return notice ? {hidden:notice.hidden,text:notice.textContent} : null;
  })).toEqual({hidden:false,text:expect.stringContaining('Binance BTCUSDT USD-M Perp only')});
  await expect.poll(()=>page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()].find((item:any)=>item.series.venue==='hyperliquid');
    return (panel?.element.querySelector('.depth-notice') as HTMLElement|null)?.textContent ?? '';
  })).toContain('earlier candles: no depth history');
});

test('a damaged local-library row is isolated from charts and built-in examples',async({page})=>{
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('iqterminal.openscript.library',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('scripts'))request.result.createObjectStore('scripts',{keyPath:'id'});};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('scripts','readwrite');tx.objectStore('scripts').put({id:'damaged-row'});
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
    db.close();
  });
  await openLibraryEditor(page);
  await expect(page.locator('.script-editor-panel')).toBeVisible();
  await expect(page.locator('.script-editor-status')).toContainText('1 damaged record hidden');
  await expect(page.getByRole('combobox',{name:'Library'}).locator('option')).toHaveCount(4);
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect.poll(()=>page.evaluate(()=>Math.min(...(window as any).__terminal.stats().panels.map((panel:any)=>panel.bars)))).toBe(5000);
});

test('the script library upgrades an older IndexedDB database with no object store',async({page})=>{
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('iqterminal.openscript.library',1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    db.close();
  });
  await openLibraryEditor(page);
  await expect(page.locator('.script-editor-panel')).toBeVisible();
  await expect(page.locator('.script-editor-status')).toContainText('Local library ready.');
  const schema=await page.evaluate(async()=>new Promise<{version:number;stores:string[]}>((resolve,reject)=>{
    const request=indexedDB.open('iqterminal.openscript.library');
    request.onsuccess=()=>{const db=request.result;const result={version:db.version,stores:[...db.objectStoreNames]};db.close();resolve(result);};
    request.onerror=()=>reject(request.error);
  }));
  expect(schema).toEqual({version:2,stores:['scripts']});
  await expect(page.locator('.candle-panel')).toHaveCount(2);
});

test('a local storage quota failure is reported while chart data stays available',async({page})=>{
  await openLibraryEditor(page);
  await expect(page.locator('.script-editor-status')).toContainText('Local library ready.');
  await page.evaluate(()=>{
    const objectStore=IDBObjectStore.prototype as any;
    const original=objectStore.put;
    objectStore.put=function(this:IDBObjectStore,...args:unknown[]){
      if(this.name==='scripts')throw new DOMException('The local storage quota has been exceeded.','QuotaExceededError');
      return original.apply(this,args);
    };
  });
  await page.getByRole('button',{name:'Save copy'}).click();
  await expect(page.locator('.script-editor-status')).toContainText(/quota/i);
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect.poll(()=>page.evaluate(()=>Math.min(...(window as any).__terminal.stats().panels.map((panel:any)=>panel.bars)))).toBe(5000);
});

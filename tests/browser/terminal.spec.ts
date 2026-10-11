import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

test.beforeEach(async({page})=>{
  await page.goto('/?fixture=1');
  await page.waitForFunction(()=>document.querySelectorAll('.candle-panel').length===2);
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((panel:any)=>panel.bars===5000&&panel.renderer.draws>0&&panel.autoPrice&&panel.max-panel.min>100));
});

test('chart type picker exposes live Footprint only for Binance USD-M',async({page})=>{
  const selectors=page.locator('select[aria-label="Chart type"]');
  await expect(selectors).toHaveCount(2);
  const order=await page.locator('.chart-toolbar').first().locator('select').evaluateAll(selects=>selects.map(select=>select.getAttribute('aria-label')));
  expect(order).toEqual(['Instrument','Chart type','Timeframe']);
  const binance=selectors.nth(0),hyperliquid=selectors.nth(1);
  await expect(binance).toHaveValue('candle');
  await expect(binance.locator('option')).toHaveText(['Candle','Footprint']);
  await expect(binance.locator('option[value="footprint"]')).toBeEnabled();
  await expect(hyperliquid).toHaveValue('candle');
  await expect(hyperliquid.locator('option')).toHaveText(['Candle','Footprint · USD-M only']);
  await expect(hyperliquid.locator('option[value="footprint"]')).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels.map((panel:any)=>panel.bars))).toEqual([5000,5000]);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels.map((panel:any)=>panel.footprint.surfaceMounted))).toEqual([false,false]);
  await expect(page.locator('.footprint-settings-button').first()).toBeHidden();
  await expect(page.getByRole('spinbutton',{name:'Price level (USDT)'}).first()).toBeHidden();

  await page.setViewportSize({width:720,height:860});
  const widths=await selectors.evaluateAll(selects=>selects.map(select=>select.getBoundingClientRect().width));
  expect(widths).toHaveLength(2);
  for(const width of widths){expect(width).toBeGreaterThanOrEqual(85);expect(width).toBeLessThanOrEqual(95);}
  const toolbar=page.locator('.chart-toolbar').first();
  const cue=page.getByRole('button',{name:'Scroll chart controls right'}).first();
  await expect(cue).toBeVisible();
  expect(await toolbar.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeGreaterThan(2);
  await cue.click();
  await expect.poll(()=>toolbar.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  // More layer controls can require another scroll step; both toolbar ends remain reachable.
  for(let step=0;step<3 && await page.getByRole('button',{name:'Scroll chart controls right'}).first().isVisible();step++){
    await page.getByRole('button',{name:'Scroll chart controls right'}).first().click();
    await page.waitForTimeout(350);
  }
  await expect(page.getByRole('button',{name:'Scroll chart controls left'}).first()).toBeVisible();
});

test('Footprint mode owns a separate subscription, renders bar revisions, and restores row settings',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    const target=[...terminal.panels.values()][0];
    const subscriptions:Array<any>=[];
    let listener:((event:any)=>void)|undefined;
    terminal.feed.subscribeFootprint=(id:any,series:any,rowPrice:any,callback:any)=>{
      subscriptions.push({id,series,rowPrice});listener=callback;
      queueMicrotask(()=>callback({type:'footprint-status',key:'test',ids:[id],status:{state:'live',message:'Live',lastUpdate:Date.now(),tickSize:.1,rowSize:rowPrice,collectionStartedAt:Date.now(),firstTradeAt:null,lastTradeAt:null,eventTime:null,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:null,coverage:'waiting'}}));
      return ()=>{subscriptions.push({released:id});if(listener===callback)listener=undefined;};
    };
    terminal.injectFootprint=(event:any)=>listener?.(event);
    terminal.footprintSubscriptions=subscriptions;
  });
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].series.type)).toBe('footprint');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.surfaceMounted)).toBe(true);
  const footprintSettings=panel.getByRole('button',{name:'Footprint display settings'});
  await expect(footprintSettings).toBeVisible();
  await footprintSettings.click();
  await expect(panel.getByRole('dialog',{name:'Footprint display settings'})).toBeVisible();
  await expect(panel.getByLabel('Cell display')).toBeVisible();
  await expect(panel.getByLabel('Diagonal imbalances')).toBeChecked();
  await panel.getByLabel('Minimum dominant volume (BTC)').fill('0.02');
  await panel.getByLabel('Diagonal imbalances').uncheck();
  await panel.locator('dialog.footprint-settings-dialog').getByRole('button',{name:'Apply'}).click();
  await expect(panel.locator('dialog.footprint-settings-dialog')).toBeHidden();
  const disabledImbalanceOptions=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id).engine.footprint.options();
  });
  expect(disabledImbalanceOptions).toMatchObject({imbalanceThreshold:Number.MAX_VALUE,textColorMode:'contrast',stackedImbalances:0,
    pocStyle:'outline',pocColor:'#858585',buyColor:'#58a65c',buyTextColor:'#58a65c',sellColor:'#ad5858',sellTextColor:'#ad5858',radius:0});
  await footprintSettings.click();
  await expect(panel.getByLabel('Diagonal imbalances')).not.toBeChecked();
  await expect(panel.getByLabel('Minimum dominant volume (BTC)')).toHaveValue('0.02');
  await panel.getByLabel('Diagonal imbalances').check();
  await panel.getByLabel('Stacked imbalance brackets').check();
  await panel.locator('dialog.footprint-settings-dialog').getByRole('button',{name:'Apply'}).click();
  const enabledImbalanceOptions=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id).engine.footprint.options();
  });
  expect(enabledImbalanceOptions).toMatchObject({imbalanceThreshold:0.02,textColorMode:'imbalance',stackedImbalances:2,
    pocStyle:'outline',pocColor:'#858585',buyColor:'#58a65c',buyTextColor:'#58a65c',sellColor:'#ad5858',sellTextColor:'#ad5858',radius:0});
  const now=Date.now();
  const barTime=Math.floor(now/60_000)*60;
  const makeBar=(revision:number,close:number,coverage:'partial'|'gapped'='partial',time=barTime)=>({time,revision,cells:[{price:84_000,bidVol:0.05,askVol:0.02}],delta:-0.03,minDelta:-0.05,maxDelta:0,rowSize:1,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage,gapBefore:coverage==='gapped',open:84_000,high:84_000.2,low:83_999.9,close,aggregateRecordCount:2});
  const callback=await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    return terminal.footprintSubscriptions[0];
  });
  expect(callback.series).toMatchObject({venue:'binance',market:'perpetual',interval:'1m'});
  expect(callback.rowPrice).toBe(25);
  const rowPrice=panel.getByRole('spinbutton',{name:'Price level (USDT)'});
  await expect(rowPrice).toHaveValue('25');
  await expect(panel.locator('.footprint-row-prefix')).toHaveText('$');
  await rowPrice.evaluate((element:HTMLInputElement)=>{element.value='1';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintSubscriptions.filter((item:any)=>item.rowPrice!==undefined).map((item:any)=>item.rowPrice))).toEqual([25,1]);
  await expect(panel.locator('.instrument-meta')).toContainText('Price level (USDT) · $1');
  const panelId=panel.getAttribute('data-panel-id');
  const status={state:'live',message:'Live · partial first interval; Binance aggTrade observations only',lastUpdate:now,tickSize:.1,rowSize:1,collectionStartedAt:now,firstTradeAt:now,lastTradeAt:now,eventTime:now,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:barTime,coverage:'partial'};
  await page.evaluate(({panelId,barTime,now,status,bar})=>{
    const t=(window as any).__terminal;
    t.injectFootprint({type:'footprint-status',key:'test',ids:[panelId],status});
    t.injectFootprint({type:'footprint-snapshot',key:'test',ids:[panelId],bars:[bar],retentionStart:barTime});
  },{panelId,barTime,now,status,bar:makeBar(1,84_000.1)});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.close)).toBe(84_000.1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing)).toBe(80);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].rightOffset)).toBe(1);
  const firstRevision=await page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest.revision);
  await page.evaluate(({panelId,barTime,now,status,bar})=>(window as any).__terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[panelId],bars:[bar],retentionStart:barTime}),{panelId,barTime,now,status,bar:makeBar(2,84_000.2)});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.revision)).toBeGreaterThan(firstRevision);
  await page.setViewportSize({width:720,height:860});
  await expect.poll(()=>panel.locator('.chart-stage').evaluate(element=>element.clientWidth)).toBeLessThan(400);
  const narrowStageWidth=await panel.locator('.chart-stage').evaluate(element=>element.clientWidth);
  expect(narrowStageWidth).toBeGreaterThan(280);
  const hoveredCell=await panel.evaluate((element,barTime)=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const target=(window as any).__terminal.panels.get(id);
    const chart=target.engine.chart;
    const x=chart.timeToCoordinate(barTime);
    const y=chart.priceToCoordinate(84_000.5,0);
    if(x===null||y===null) throw new Error(`Expected visible footprint cell coordinates, got ${x}, ${y}`);
    const stage=(element as HTMLElement).querySelector<HTMLElement>('.chart-stage')!;
    const rect=stage.getBoundingClientRect();
    return {x:rect.left+x,y:rect.top+y};
  },barTime);
  await page.mouse.move(hoveredCell.x,hoveredCell.y);
  await expect.poll(()=>panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id)?.hoveredFootprint?.cell?.price ?? null;
  })).toBe(84_000);
  const initialHover=await panel.locator('.ohlc').evaluate(element=>({text:element.textContent,mode:(element as HTMLElement).dataset.mode,lines:element.textContent?.split('\n').length}));
  expect(initialHover.mode).toBe('footprint');
  expect(initialHover.lines).toBe(4);
  expect(initialHover.text?.split('\n')[0]).toBe('84,000–84,001 USDT (upper exclusive) · bid 0.050 / ask 0.020 BTC');
  const initialReadoutGeometry=await panel.locator('.ohlc').evaluate(element=>({height:element.clientHeight,scrollTop:element.scrollTop}));
  expect(initialReadoutGeometry.height).toBeGreaterThan(24);
  expect(initialReadoutGeometry.scrollTop).toBe(0);
  await page.mouse.move(1,1);
  await expect(panel.locator('.ohlc')).toContainText('Bid');
  await expect(panel.locator('.ohlc')).toContainText('[partial]');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.initialViewSet)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing)).toBe(80);

  const beforeDockGeometry=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const p=(window as any).__terminal.panels.get(id);
    return {width:element.querySelector<HTMLElement>('.chart-stage')!.clientWidth,spacing:p.diagnostics().spacing};
  });
  const docked=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const t=(window as any).__terminal;
    const other=t.dock.panels.find((item:any)=>item.id!==id)!;
    t.dock.getPanel(id).api.moveTo({group:other.api.group,position:'center'});
    t.dock.getPanel(id).api.setActive();
    return {id,otherId:other.id};
  });
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().visible,docked.id)).toBe(true);
  await panel.evaluate(element=>new Promise<void>(resolve=>{
    const stage=element.querySelector<HTMLElement>('.chart-stage')!;
    let lastWidth=-1,stableFrames=0;
    const sample=()=>{
      const width=stage.clientWidth;
      stableFrames=width===lastWidth?stableFrames+1:0;
      lastWidth=width;
      if(stableFrames>=3)resolve();else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const dockedGeometry=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const p=(window as any).__terminal.panels.get(id);
    return {width:element.querySelector<HTMLElement>('.chart-stage')!.clientWidth,spacing:p.diagnostics().spacing};
  });
  const hiddenView=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const t=(window as any).__terminal,p=t.panels.get(id),range=p.engine.visibleRange();
    p.engine.setRange({from:range.from-2,to:range.to-2});
    const before=p.diagnostics();
    const currentRange=p.engine.visibleRange();
    const currentTimeRange=p.engine.visibleTimeRange();
    const geometry={width:element.querySelector<HTMLElement>('.chart-stage')!.clientWidth,spacing:before.spacing};
    const other=t.dock.panels.find((item:any)=>item.id!==id)!;
    other.api.setActive();
    return {id,range:currentRange,timeRange:currentTimeRange,geometry,sets:before.footprint.primitiveSets};
  });
  expect(dockedGeometry.width).toBeGreaterThan(beforeDockGeometry.width);
  expect(dockedGeometry.spacing).toBeCloseTo(beforeDockGeometry.spacing,5);
  expect(hiddenView.geometry.width).toBe(dockedGeometry.width);
  expect(hiddenView.geometry.spacing).toBeCloseTo(dockedGeometry.spacing,5);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().visible,hiddenView.id)).toBe(false);
  await page.evaluate(({id,barTime,now,status,bar})=>(window as any).__terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[id],bars:[bar],retentionStart:barTime}),{id:hiddenView.id,barTime,now,status,bar:makeBar(3,84_000.3,'gapped')});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.latest.revision,hiddenView.id)).toBe(3);
  await expect.poll(()=>page.evaluate(id=>{
    const p=(window as any).__terminal.panels.get(id);return {needsSync:p.diagnostics().footprint.needsSync,sets:p.diagnostics().footprint.primitiveSets};
  },hiddenView.id)).toMatchObject({needsSync:true,sets:hiddenView.sets});
  await panel.evaluate(el=>{
    const id=(el as HTMLElement).dataset.panelId!;(window as any).__terminal.dock.getPanel(id).api.setActive();
  });
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.needsSync,hiddenView.id)).toBe(false);
  const reactivatedView=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;return (window as any).__terminal.panels.get(id).engine.visibleRange();
  });
  const reactivatedTimeRange=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;return (window as any).__terminal.panels.get(id).engine.visibleTimeRange();
  });
  expect(reactivatedTimeRange.from).toBeCloseTo(hiddenView.timeRange.from,3);
  expect(reactivatedTimeRange.to).toBeCloseTo(hiddenView.timeRange.to,3);
  expect(reactivatedView.from).toBeCloseTo(hiddenView.range.from,2);
  expect(reactivatedView.to).toBeCloseTo(hiddenView.range.to,2);
  await expect(panel.locator('.ohlc')).toContainText('[gapped · gap before]');

  const historicalRight=await panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;const engine=(window as any).__terminal.panels.get(id).engine;
    const range=engine.visibleRange();engine.setRange({from:range.from-3,to:range.to-3});
    return engine.visibleRange().to;
  });
  await page.evaluate(({id,barTime,bar})=>(window as any).__terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[id],bars:[bar],retentionStart:barTime}),
    {id:hiddenView.id,barTime,bar:makeBar(4,84_000.4,'partial',barTime+60)});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.bars,hiddenView.id)).toBe(2);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).engine.visibleRange().to,hiddenView.id)).toBeLessThan(historicalRight+1);
  await panel.getByRole('button',{name:'Latest',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>{
    const engine=(window as any).__terminal.panels.get(id).engine;
    return {spacing:engine.chart.timeScale.barSpacing,rightOffset:engine.chart.timeScale.rightOffset};
  },hiddenView.id)).toEqual({spacing:80,rightOffset:1});

  const offscreenPatch=await page.evaluate(id=>{
    const p=(window as any).__terminal.panels.get(id);
    const range=p.engine.visibleTimeRange();
    const latest=p.footprintBars.at(-1);
    const oldest=p.engine.chart.dataLayer.indexToTime(0);
    const time=Math.floor((oldest+(range.from-oldest)/2)/60)*60;
    if(!(time<range.from&&time>oldest)) throw new Error(`Expected historical execution bar outside visible chart range: candidate=${time}, range=${range.from}..${range.to}, oldest=${oldest}, latest=${latest.time}`);
    return {time,sets:p.diagnostics().footprint.primitiveSets,bars:p.diagnostics().footprint.bars};
  },hiddenView.id);
  await page.evaluate(({id,time,bar})=>(window as any).__terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[id],bars:[bar]}),
    {id:hiddenView.id,time:offscreenPatch.time,bar:makeBar(1,83_999.9,'partial',offscreenPatch.time)});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.bars,hiddenView.id)).toBe(offscreenPatch.bars+1);
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.primitiveSets,hiddenView.id)).toBe(offscreenPatch.sets);
  const visibleSets=await page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.primitiveSets,hiddenView.id);
  const revisedVisible=await page.evaluate(id=>{
    const p=(window as any).__terminal.panels.get(id),last=p.footprintBars.at(-1);
    return {time:last.time,revision:last.revision+1};
  },hiddenView.id);
  await page.evaluate(({id,time,revision,bar})=>(window as any).__terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[id],bars:[bar]}),
    {id:hiddenView.id,time:revisedVisible.time,revision:revisedVisible.revision,bar:makeBar(revisedVisible.revision,84_000.6,'partial',revisedVisible.time)});
  await expect.poll(()=>page.evaluate(id=>(window as any).__terminal.panels.get(id).diagnostics().footprint.primitiveSets,hiddenView.id)).toBeGreaterThan(visibleSets);

  await panel.getByRole('spinbutton',{name:'Price level (USDT)'}).evaluate((element:HTMLInputElement)=>{element.value='5';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintSubscriptions.filter((item:any)=>item.rowPrice!==undefined).map((item:any)=>item.rowPrice))).toEqual([25,1,5]);
  await expect(panel.locator('.instrument-meta')).toContainText('Price level (USDT) · $5');
  await expect.poll(()=>panel.evaluate(element=>{
    const id=(element as HTMLElement).dataset.panelId!;
    return JSON.parse(localStorage.getItem('basis.layout.v1')||'{}').layout?.panels?.[id]?.params;
  })).toMatchObject({type:'footprint',rowPrice:5});
  await page.setViewportSize({width:720,height:860});
  await panel.locator('.chart-toolbar').evaluate(toolbar=>{toolbar.scrollLeft=toolbar.scrollWidth;});
  await expect(panel.getByRole('button',{name:'Latest',exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Footprint display settings'})).toBeVisible();
  const releasesBeforeModeChange=await page.evaluate(()=>(window as any).__terminal.footprintSubscriptions.filter((item:any)=>item.released).length);
  await panel.locator('select[aria-label="Chart type"]').selectOption('candle');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintSubscriptions.filter((item:any)=>item.released).length)).toBeGreaterThan(releasesBeforeModeChange);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.surfaceMounted)).toBe(false);
  await expect(panel.getByRole('button',{name:'Footprint display settings'})).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].bars)).toBe(5000);
});

test('tab cycling is per group, editable, pausable, and removed with its Dockview group',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
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
  const anchor=await firstAction.boundingBox(), menu=await dialog.boundingBox();
  expect(menu!.x).toBeCloseTo(Math.max(6,anchor!.x),0); expect(menu!.y).toBeGreaterThan(anchor!.y);
  expect(menu!.y-anchor!.y).toBeLessThan(36); expect(menu!.width).toBeLessThan(240);
  await page.screenshot({path:'artifacts/tab-cycle-menu-dark-1366x768.png'});

  await interval.fill('0');
  await dialog.getByRole('button',{name:'Start tab cycling',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('whole number');
  await interval.fill('1');
  await dialog.getByRole('button',{name:'Start tab cycling',exact:true}).click();
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
  await expect(dialog.getByRole('button',{name:'Pause tab cycling',exact:true})).toBeVisible();
  await expect(firstAction.getByRole('button',{name:'Cycle tabs'}).locator('svg[data-icon="pause"]')).toBeVisible();
  await page.screenshot({path:'artifacts/tab-cycle-menu-running-1366x768.png'});
  await interval.fill('2'); await interval.press('Tab');
  await expect(firstAction.getByRole('button',{name:'Cycle tabs'})).toHaveAttribute('title',/2s per tab/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await firstAction.getByRole('button',{name:'Cycle tabs'}).click();
  const beforeStop=await current(groups[0].id);
  await dialog.getByRole('button',{name:'Pause tab cycling',exact:true}).click();
  await expect(firstAction.getByRole('button',{name:'Cycle tabs'})).toHaveAttribute('aria-pressed','false');
  await page.waitForTimeout(1100);
  expect(await current(groups[0].id)).toBe(beforeStop);
  await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('light');
  await page.setViewportSize({width:720,height:860});
  await firstAction.getByRole('button',{name:'Cycle tabs'}).click();
  await expect(dialog).toBeVisible();
  const narrowMenu=await dialog.boundingBox();
  expect(narrowMenu!.x).toBeGreaterThanOrEqual(0); expect(narrowMenu!.x+narrowMenu!.width).toBeLessThanOrEqual(720);
  await page.screenshot({path:'artifacts/tab-cycle-menu-light-720x860.png'});
  await page.locator('.chart-stage').last().click({position:{x:40,y:80}});
  await expect(dialog).toBeHidden();
  await page.setViewportSize({width:1366,height:768});


  await secondAction.getByRole('button',{name:'Cycle tabs'}).click();
  const secondDialog=page.getByRole('dialog',{name:'Cycle group tabs'});
  await secondDialog.getByRole('spinbutton',{name:'Seconds per tab'}).fill('1');
  await secondDialog.getByRole('button',{name:'Start tab cycling',exact:true}).click();
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
  expect(zoomed.max-zoomed.min).toBeGreaterThan(dragged.max-dragged.min);
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
  await page.evaluate(()=>{const d=(window as any).__terminal.dock;d.panels[0].api.moveTo({group:d.panels[1].api.group,position:'bottom'});});
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

test('Footprint price level defaults to $25, rejects off-grid edits, and restores a validated $50 width',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    const subscriptions:number[]=[];
    const target=[...terminal.panels.values()][0];
    target.persistenceWrites={parameters:0,saves:0};
    const updateParameters=target.params.api.updateParameters.bind(target.params.api);
    target.params.api.updateParameters=(value:any)=>{target.persistenceWrites.parameters++;updateParameters(value);};
    const save=target.save.bind(target);
    target.save=()=>{target.persistenceWrites.saves++;save();};
    terminal.footprintPersistenceWrites=()=>({...target.persistenceWrites});
    let active:((event:any)=>void)|undefined;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,rowPrice:number,callback:any)=>{
      subscriptions.push(rowPrice);active=callback;
      queueMicrotask(()=>callback({type:'footprint-status',key:'test',ids:[],status:{state:'live',message:'Live',lastUpdate:Date.now(),tickSize:.1,rowSize:rowPrice,collectionStartedAt:Date.now(),firstTradeAt:null,lastTradeAt:null,eventTime:null,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:null,coverage:'waiting'}}));
      return ()=>{if(active===callback)active=undefined;};
    };
    terminal.footprintSubscriptions=subscriptions;
    terminal.injectFootprint=(event:any)=>active?.(event);
  });
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  const price=panel.getByRole('spinbutton',{name:'Price level (USDT)'});
  await expect(price).toHaveValue('25');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.params.api.getParameters().rowPrice)).toBe(25);
  const writesAt25=await page.evaluate(()=>(window as any).__terminal.footprintPersistenceWrites());
  await price.evaluate((element:HTMLInputElement)=>{element.value='50';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintSubscriptions)).toEqual([25,50]);
  const panelId=await panel.getAttribute('data-panel-id');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('basis.layout.v1')||'{}').layout?.panels?.[[...(window as any).__terminal.panels.values()][0].params.api.id]?.params?.rowPrice)).toBe(50);
  const writesAt50=await page.evaluate(()=>(window as any).__terminal.footprintPersistenceWrites());
  expect(writesAt50.parameters).toBe(writesAt25.parameters+1);
  expect(writesAt50.saves).toBe(writesAt25.saves+1);
  const time=Math.floor(Date.now()/60_000)*60;
  await page.evaluate(({panelId,time})=>{
    const terminal=(window as any).__terminal;
    const now=Date.now();
    terminal.injectFootprint({type:'footprint-snapshot',key:'test',ids:[panelId],retentionStart:time,bars:[{time,revision:1,cells:[{price:83_000,bidVol:.1,askVol:.2}],delta:.1,minDelta:0,maxDelta:.1,rowSize:50,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,open:83_000,high:83_001,low:83_000,close:83_001,aggregateRecordCount:2}],status:{state:'live',message:'Live',lastUpdate:now,tickSize:.1,rowSize:50,collectionStartedAt:now,firstTradeAt:now,lastTradeAt:now,eventTime:now,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:time,coverage:'partial'}});
  },{panelId,time});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.close)).toBe(83_001);
  const writesAfterSnapshot=await page.evaluate(()=>(window as any).__terminal.footprintPersistenceWrites());
  await page.evaluate(({panelId,time})=>{
    const terminal=(window as any).__terminal;const now=Date.now();
    const status={state:'live',message:'Live',lastUpdate:now,tickSize:.1,rowSize:50,collectionStartedAt:now,firstTradeAt:now,lastTradeAt:now,eventTime:now,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:time,coverage:'partial'};
    terminal.injectFootprint({type:'footprint-status',key:'test',ids:[panelId],status});
    terminal.injectFootprint({type:'footprint-patch',key:'test',ids:[panelId],retentionStart:time,status,bars:[{time,revision:2,cells:[{price:83_000,bidVol:.2,askVol:.3}],delta:.1,minDelta:0,maxDelta:.1,rowSize:50,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,open:83_000,high:83_001,low:83_000,close:83_001,aggregateRecordCount:3}]});
  },{panelId,time});
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.revision)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintPersistenceWrites())).toEqual(writesAfterSnapshot);
  await price.evaluate((element:HTMLInputElement)=>{element.value='25.05';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>price.evaluate((element:HTMLInputElement)=>element.validationMessage)).toContain('tick size, $0.1');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.footprintSubscriptions)).toEqual([25,50]);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.close)).toBe(83_001);
  await expect.poll(()=>panel.evaluate(element=>JSON.parse(localStorage.getItem('basis.layout.v1')||'{}').layout?.panels?.[(element as HTMLElement).dataset.panelId!]?.params?.rowPrice)).toBe(50);
  await panel.locator('select[aria-label="Chart type"]').selectOption('candle');
  await page.reload();
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.length===2);
  await expect.poll(()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0]?.selection.rowPrice))).toBe(50);
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,rowPrice:number,callback:any)=>{
      queueMicrotask(()=>callback({type:'footprint-status',key:'test',ids:[],status:{state:'live',message:'Live',lastUpdate:Date.now(),tickSize:.1,rowSize:rowPrice,collectionStartedAt:Date.now(),firstTradeAt:null,lastTradeAt:null,eventTime:null,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:null,coverage:'waiting'}}));
      return ()=>{};
    };
  });
  const restored=page.locator('.candle-panel').first();
  await restored.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await expect(restored.getByRole('spinbutton',{name:'Price level (USDT)'})).toHaveValue('50');
});

test('two-trade 1 USDT footprint row remains on-screen without an indicator scale',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,_rowPrice:any,callback:any)=>{
      terminal.syntheticFootprintCallback=callback;
      return ()=>{delete terminal.syntheticFootprintCallback;};
    };
    const target=[...terminal.panels.values()][0];
    for(const view of target.studies.views())target.studies.remove(view.attachmentId);
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.panels.values().next().value.studies.views().length)).toBe(0);
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.surfaceMounted)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).__terminal.syntheticFootprintCallback))).toBe(true);
  await panel.getByRole('spinbutton',{name:'Price level (USDT)'}).evaluate((element:HTMLInputElement)=>{element.value='1';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).__terminal.syntheticFootprintCallback))).toBe(true);

  const fixture=await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    const panel=[...terminal.panels.values()][0];
    const time=panel.engine.series.getData().at(-1).time;
    const bar={
      time,revision:2,
      cells:[{price:83000,bidVol:0.143,askVol:0.147}],
      delta:0.004,minDelta:-0.143,maxDelta:0.004,rowSize:1,
      source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'observed',gapBefore:false,
      open:83000.1,high:83000.2,low:83000.1,close:83000.2,aggregateRecordCount:2,
    };
    const now=Date.now();
    const status={state:'live',message:'Live · two aggregate observations',lastUpdate:now,tickSize:.1,rowSize:1,collectionStartedAt:now,firstTradeAt:now,lastTradeAt:now,eventTime:now,outages:0,capacityDrops:0,unknownSideRecords:0,unknownSideVolume:0,lateRecords:0,retentionStart:time,coverage:'observed'};
    terminal.syntheticFootprintCallback({type:'footprint-status',key:'synthetic',ids:[panel.params.api.id],status});
    const original=CanvasRenderingContext2D.prototype.fillText;
    (window as any).__footprintFillText=[];
    CanvasRenderingContext2D.prototype.fillText=function(text:any,...args:any[]){
      const value=String(text);
      if(value.includes('.143')||value.includes('.147')){
        const metrics=this.measureText(value);
        (window as any).__footprintFillText.push({value,font:this.font,x:args[0],y:args[1],align:this.textAlign,width:metrics.width,
          ascent:metrics.actualBoundingBoxAscent,descent:metrics.actualBoundingBoxDescent,fillStyle:String(this.fillStyle),globalAlpha:this.globalAlpha,canvas:this.canvas});
      }
      return (original as any).call(this,text,...args);
    };
    terminal.syntheticFootprintCallback({type:'footprint-snapshot',key:'synthetic',ids:[panel.params.api.id],bars:[bar],retentionStart:time});
    return {time,bar};
  });

  const probe=()=>page.evaluate(({time,price})=>{
    const panel=[...(window as any).__terminal.panels.values()][0];
    const chart=panel.engine.chart,stage=panel.element.querySelector('.chart-stage') as HTMLElement;
    const rect=stage.getBoundingClientRect();
    const rowSize=panel.footprintBars.find((bar:any)=>bar.time===time)?.rowSize??1;
    const x=chart.timeToCoordinate(time),y=chart.priceToCoordinate(price+rowSize/2,0);
    const indexBar=panel.engine.footprintIndexSeries?.getData().at(-1);
    const hover=typeof x==='number'&&typeof y==='number'?panel.engine.footprintAt(x,y):null;
    const canvases=[...stage.querySelectorAll('canvas')] as HTMLCanvasElement[];
    const covering=typeof x==='number'&&typeof y==='number'?canvases.filter(canvas=>{
      const r=canvas.getBoundingClientRect();return rect.left+x>=r.left&&rect.left+x<r.right&&rect.top+y>=r.top&&rect.top+y<r.bottom&&r.width>100&&r.height>100;
    }).length:0;
    const rowA=chart.priceToCoordinate(price+rowSize,0),rowB=chart.priceToCoordinate(price,0);
    const rowTop=rect.top+Math.min(rowA??y,rowB??y),rowBottom=rect.top+Math.max(rowA??y,rowB??y);
    const labels=(window as any).__footprintFillText.map((label:any)=>{
      const canvas=label.canvas as HTMLCanvasElement,cr=canvas.getBoundingClientRect();
      const sx=canvas.width/cr.width,sy=canvas.height/cr.height;
      const absX=cr.left+label.x/sx,absY=cr.top+label.y/sy;
      const textLeft=label.align==='center'?label.x-label.width/2:label.align==='right'?label.x-label.width:label.x;
      const left=Math.max(0,Math.floor(textLeft-1)),right=Math.min(canvas.width,Math.ceil(textLeft+label.width+1));
      const top=Math.max(0,Math.floor(label.y-label.ascent-1)),bottom=Math.min(canvas.height,Math.ceil(label.y+label.descent+1));
      const pixels=canvas.getContext('2d')!.getImageData(left,top,right-left,bottom-top).data;
      const rgb=label.fillStyle.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)/i);
      const hex=label.fillStyle.match(/^#([\da-f]{6})$/i);
      const target=rgb?[Number(rgb[1]),Number(rgb[2]),Number(rgb[3])]:hex?[0,2,4].map(i=>parseInt(hex[1]!.slice(i,i+2),16)):null;
      let glyphPixels=0;
      if(target)for(let i=0;i<pixels.length;i+=4){
        const r=pixels[i]!,g=pixels[i+1]!,b=pixels[i+2]!,a=pixels[i+3]!;
        if(a>0&&Math.abs(r-target[0]!)<26&&Math.abs(g-target[1]!)<26&&Math.abs(b-target[2]!)<26)glyphPixels++;
      }
      const inNativeRow=absY>=rowTop&&absY<=rowBottom&&Math.abs(absY-(rect.top+y))<=12;
      const inPlot=absX>=rect.left&&absX<=rect.right&&absY>=rowTop&&absY<=rowBottom;
      return {value:label.value,font:label.font,x:label.x,y:label.y,align:label.align,width:label.width,
        fillStyle:label.fillStyle,absolute:{x:absX,y:absY},row:{top:rowTop,bottom:rowBottom,center:rect.top+y},
        column:absX<rect.left+x?'bid':absX>rect.left+x?'ask':'center',inNativeRow,inPlot,exactColorGlyphPixels:glyphPixels,
        canvas:{top:cr.top,left:cr.left,width:cr.width,height:cr.height}};
    });
    return {
      range:panel.engine.footprintIndexSeries?.priceScale().priceRange(),
      x,y,stage:{width:rect.width,height:rect.height},covering,
      footprintFont:panel.engine.footprint?.options().font,dpr:window.devicePixelRatio,
      actualOHLC:indexBar&&{open:indexBar.open,high:indexBar.high,low:indexBar.low,close:indexBar.close},
      hover:hover&&{price:hover.price,bid:hover.cell?.bidVol,ask:hover.cell?.askVol},
      labels,
      cellLabels:labels.filter((label:any)=>label.inNativeRow&&label.inPlot),
    };
  },{time:fixture.time,price:fixture.bar.cells[0].price});

  await expect.poll(async()=>{
    const result=await probe();
    return Boolean(result.hover&&result.hover.bid===0.143&&result.hover.ask===0.147);
  }).toBe(true);
  await expect(panel.locator('.panel-status')).not.toHaveClass(/no-data/);
  const result=await probe();
  expect(result.actualOHLC).toEqual({open:83000.1,high:83000.2,low:83000.1,close:83000.2});
  expect(result.range.min).toBeLessThanOrEqual(83000.0);
  expect(result.range.max).toBeGreaterThanOrEqual(83000.0);
  expect(result.y).toBeGreaterThan(0);
  expect(result.y).toBeLessThan(result.stage.height-20);
  expect(result.covering).toBeGreaterThan(0);
  expect(result.hover).toEqual({price:83000,bid:0.143,ask:0.147});
  expect(result.footprintFont).toBe(9);
  expect(result.cellLabels).toHaveLength(2);
  const bidCellLabel=result.cellLabels.find((label:any)=>label.value==='0.143');
  const askCellLabel=result.cellLabels.find((label:any)=>label.value==='0.147');
  expect(bidCellLabel).toMatchObject({inNativeRow:true,inPlot:true,column:'bid'});
  expect(askCellLabel).toMatchObject({inNativeRow:true,inPlot:true,column:'ask'});
  expect(bidCellLabel.exactColorGlyphPixels).toBeGreaterThan(3);
  expect(askCellLabel.exactColorGlyphPixels).toBeGreaterThan(3);
  await page.screenshot({path:'artifacts/footprint-two-trade-no-study-1366x768.png'});
  await writeFile('artifacts/footprint-two-trade-no-study.json',JSON.stringify({
    scenario:'two aggTrade observations at 83000.1 and 83000.2; one 1 USDT ladder row centered at 83000.0',
    attachedStudies:0,
    observationCount:fixture.bar.aggregateRecordCount,
    footprintOptions:{font:result.footprintFont,devicePixelRatio:result.dpr},
    row:{price:fixture.bar.cells[0].price,bid:fixture.bar.cells[0].bidVol,ask:fixture.bar.cells[0].askVol,rowSize:fixture.bar.rowSize},
    nativeRange:result.range,
    supportOHLC:result.actualOHLC,
    coordinate:{x:result.x,y:result.y,stage:result.stage,canvasLayersCovering:result.covering},
    nativeHover:result.hover,
    cellLabels:result.cellLabels,
    otherMatchingCanvasLabels:result.labels.filter((label:any)=>!label.inNativeRow||!label.inPlot),
  },null,2));
  await expect(panel.locator('.ohlc')).toContainText('Bid 0.143 · Ask 0.147 · Δ 0.004 BTC');
  const center=await panel.evaluate((element,time)=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const target=(window as any).__terminal.panels.get(id),chart=target.engine.chart;
    const x=chart.timeToCoordinate(time),y=chart.priceToCoordinate(83000,0);
    const rect=element.querySelector<HTMLElement>('.chart-stage')!.getBoundingClientRect();
    return {x:rect.left+x,y:rect.top+y};
  },fixture.time);
  await page.mouse.move(center.x,center.y);
  await expect(panel.locator('.ohlc')).toContainText('83,000–83,001 USDT (upper exclusive) · bid 0.143 / ask 0.147 BTC');
  await panel.evaluate((element,{time,bar})=>{
    const id=(element as HTMLElement).dataset.panelId!;
    const updated={...bar,revision:bar.revision+1,cells:[{price:83000,bidVol:0.243,askVol:0.347}],delta:0.104,minDelta:-0.243,maxDelta:0.104};
    (window as any).__terminal.syntheticFootprintCallback({type:'footprint-patch',key:'synthetic',ids:[id],bars:[updated],retentionStart:time});
  },{time:fixture.time,bar:fixture.bar});
  await expect(panel.locator('.ohlc')).toContainText('83,000–83,001 USDT (upper exclusive) · bid 0.243 / ask 0.347 BTC');
  await expect(panel.locator('.ohlc')).toContainText('V 0.590 · Bid 0.243 · Ask 0.347 · Δ 0.104 BTC');
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

test('a single $25 footprint row opens at text height and respects manual price zoom',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,_price:any,callback:any)=>{
      terminal.singleRowCallback=callback;
      return ()=>{delete terminal.singleRowCallback;};
    };
  });
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,target=[...terminal.panels.values()][0];
    const time=target.engine.series.getData().at(-1).time;
    terminal.singleRowCallback({type:'footprint-snapshot',key:'test',ids:[target.params.api.id],retentionStart:time,bars:[{
      time,revision:1,cells:[{price:82975,bidVol:.165,askVol:.003}],delta:-.162,minDelta:-.165,maxDelta:0,
      rowSize:25,open:82981.7,high:82981.7,low:82981.7,close:82981.7,
      source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,aggregateRecordCount:2,
    }]});
  });
  const rowHeight=()=>page.evaluate(()=>{
    const chart=[...(window as any).__terminal.panels.values()][0].engine.chart;
    return Math.abs(chart.priceToCoordinate(83000,0)-chart.priceToCoordinate(82975,0));
  });
  await expect.poll(rowHeight).toBeGreaterThan(10);
  await expect.poll(rowHeight).toBeLessThanOrEqual(17);
  await page.setViewportSize({width:720,height:860});
  await expect.poll(rowHeight).toBeGreaterThan(10);
  await expect.poll(rowHeight).toBeLessThanOrEqual(17);
  await page.screenshot({path:'artifacts/footprint-single-row-720x860.png'});
  const stage=(await panel.locator('.chart-stage').boundingBox())!;
  const originalHeight=await rowHeight();
  await page.mouse.move(Math.round(stage.x+stage.width*.4),Math.round(stage.y+stage.height*.4));
  await page.mouse.wheel(0,-100);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing)).toBeGreaterThan(80);
  await expect.poll(rowHeight).toBeGreaterThan(originalHeight);
  await page.mouse.wheel(0,100);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].spacing)).toBeCloseTo(80,6);
  await expect.poll(rowHeight).toBeCloseTo(originalHeight,6);
  const manual=await page.evaluate(()=>{
    const scale=[...(window as any).__terminal.panels.values()][0].engine.chart.panes()[0].priceScale;
    scale.setAutoScale(false);
    scale.setPriceRange({min:82950,max:83000});
    return scale.priceRange();
  });
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.chart.panes()[0].priceScale.priceRange())).toEqual(manual);
  await panel.locator('select[aria-label="Chart type"]').selectOption('candle');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.surfaceMounted)).toBe(false);
});

test('plot wheel zooms both axes around the cursor and Latest restores autoscale',async({page})=>{
  const point=await page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0],plot=panel.engine.chart.plotRect(0);
    const bounds=panel.element.querySelector('.chart-stage').getBoundingClientRect();
    const screenX=Math.round(bounds.left+plot.left+plot.width*.35),screenY=Math.round(bounds.top+plot.top+plot.height*.4);
    return {x:screenX-bounds.left,y:screenY-bounds.top,screenX,screenY};
  });
  const read=()=>page.evaluate(({x,y})=>{
    const chart=[...(window as any).__terminal.panels.values()][0].engine.chart,scale=chart.panes()[0].priceScale;
    const range=scale.priceRange();
    return {spacing:chart.timeScale.barSpacing,span:range.max-range.min,price:chart.coordinateToPrice(y,0),time:chart.coordinateToTime(x),auto:scale.autoScale};
  },point);
  const before=await read();
  await page.mouse.move(point.screenX,point.screenY);
  await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await read()).spacing).toBeGreaterThan(before.spacing);
  const inside=await read();
  expect(inside.span).toBeLessThan(before.span);
  expect(inside.price).toBeCloseTo(before.price!,6);
  expect(inside.time).toBeCloseTo(before.time,4);
  expect(inside.auto).toBe(false);
  await page.mouse.wheel(0,100);
  await expect.poll(async()=>(await read()).spacing).toBeCloseTo(before.spacing,6);
  const outside=await read();
  expect(outside.span).toBeCloseTo(before.span,6);
  expect(outside.price).toBeCloseTo(before.price!,6);
  await page.getByRole('button',{name:'Latest',exact:true}).first().click();
  await expect.poll(async()=>(await read()).auto).toBe(true);
});

test('footprint execution feedback fades on the overlay and stops for reduced motion or disposal',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,_width:any,callback:any)=>{
      terminal.pulseCallback=callback;return ()=>{delete terminal.pulseCallback;};
    };
  });
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,target=[...terminal.panels.values()][0],engine=target.engine;
    const time=engine.series.getData().at(-1).time;
    const bar={time,revision:1,cells:[{price:83000,bidVol:.1,askVol:.2}],rowSize:25,delta:.1,minDelta:-.1,maxDelta:.1,
      open:83000,high:83000,low:83000,close:83000,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,aggregateRecordCount:2};
    terminal.pulseBar=bar;
    terminal.pulseCallback({type:'footprint-snapshot',key:'test',ids:[target.params.api.id],bars:[structuredClone(bar)],retentionStart:time});
    terminal.pulseDraws={base:0,overlay:0};
    const base=engine.footprint.draw.bind(engine.footprint),overlay=engine.footprintActivity.draw.bind(engine.footprintActivity);
    engine.footprint.draw=(...args:any[])=>{terminal.pulseDraws.base++;base(...args);};
    engine.footprintActivity.draw=(...args:any[])=>{terminal.pulseDraws.overlay++;overlay(...args);};
    terminal.pulseUpdate=()=>{
      bar.revision++;bar.cells=[{price:83000,bidVol:.1+bar.revision*.01,askVol:.2}];
      terminal.pulseCallback({type:'footprint-patch',key:'test',ids:[target.params.api.id],bars:[structuredClone(bar)],retentionStart:time});
      return engine.footprintActivity.size;
    };
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest?.revision)).toBe(1);
  await page.waitForTimeout(100);
  const before=await page.evaluate(()=>(window as any).__terminal.pulseDraws.base);
  expect(await page.evaluate(()=>(window as any).__terminal.pulseUpdate())).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.pulseDraws.overlay)).toBeGreaterThan(3);
  await page.screenshot({path:'artifacts/footprint-activity-pulse-1366x768.png'});
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.footprintActivity.size)).toBe(0);
  const counts=await page.evaluate(()=>(window as any).__terminal.pulseDraws);
  expect(counts.base-before).toBeLessThanOrEqual(3);
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>(window as any).__terminal.pulseDraws)).toEqual(counts);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.evaluate(()=>(window as any).__terminal.pulseUpdate())).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  expect(await page.evaluate(()=>(window as any).__terminal.pulseUpdate())).toBe(1);
  await panel.locator('select[aria-label="Chart type"]').selectOption('candle');
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.footprintActivity.size)).toBe(0);
});

test('footprint last-price line tracks executions within rows and $1 rows remain distinct',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,_width:any,callback:any)=>{terminal.priceLineCallback=callback;return ()=>{};};
    const native=CanvasRenderingContext2D.prototype.fillText;
    terminal.priceLabels=[];
    CanvasRenderingContext2D.prototype.fillText=function(text:any,x:number,y:number,maxWidth?:number){terminal.priceLabels.push(String(text));return maxWidth===undefined?native.call(this,text,x,y):native.call(this,text,x,y,maxWidth);};
  });
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await panel.getByRole('spinbutton',{name:'Price level (USDT)'}).evaluate((element:HTMLInputElement)=>{element.value='1';element.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,target=[...terminal.panels.values()][0],time=target.engine.series.getData().at(-1).time;
    const bar={time,revision:1,cells:[{price:83000,bidVol:.1,askVol:.2}],rowSize:1,delta:.1,minDelta:-.1,maxDelta:.1,
      open:83000.1,high:83000.2,low:83000.1,close:83000.2,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,aggregateRecordCount:2};
    terminal.priceLineBar=bar;
    terminal.priceLineCallback({type:'footprint-snapshot',key:'test',ids:[target.params.api.id],bars:[structuredClone(bar)],retentionStart:time});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.priceLabels.includes('83,000.2'))).toBe(true);
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,bar=terminal.priceLineBar,target=[...terminal.panels.values()][0];
    bar.revision=2;bar.high=bar.close=83000.4;
    terminal.priceLineCallback({type:'footprint-patch',key:'test',ids:[target.params.api.id],bars:[structuredClone(bar)],retentionStart:bar.time});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.priceLabels.includes('83,000.4'))).toBe(true);
  expect(await page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest.cellCount)).toBe(1);
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,bar=terminal.priceLineBar,target=[...terminal.panels.values()][0];
    bar.revision=3;bar.high=bar.close=83001.2;bar.cells=[{price:83001,bidVol:0,askVol:.1},...bar.cells];
    terminal.priceLineCallback({type:'footprint-patch',key:'test',ids:[target.params.api.id],bars:[structuredClone(bar)],retentionStart:bar.time});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal.priceLabels.includes('83,001.2'))).toBe(true);
  expect(await page.evaluate(()=>(window as any).__terminal.stats().panels[0].footprint.latest.cellCount)).toBe(2);
  await page.screenshot({path:'artifacts/footprint-execution-price-line-1366x768.png'});
});

test('footprint BTC/USDT toggle preserves collection and viewport, updates totals and persists per panel',async({page})=>{
  const panel=page.locator('.candle-panel').first();
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal;
    terminal.unitSubscriptions=0;
    terminal.feed.subscribeFootprint=(_id:any,_series:any,_width:any,callback:any)=>{terminal.unitSubscriptions++;terminal.unitsCallback=callback;return ()=>{};};
  });
  const units=panel.getByRole('button',{name:'Footprint volume units',exact:true});
  await expect(units).toBeHidden();
  await panel.locator('select[aria-label="Chart type"]').selectOption('footprint');
  await expect(units).toHaveText('BTC');
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,target=[...terminal.panels.values()][0],time=target.engine.series.getData().at(-1).time;
    terminal.unitsCallback({type:'footprint-snapshot',key:'test',ids:[target.params.api.id],retentionStart:time,bars:[{
      time,revision:1,cells:[{price:83000,bidVol:.001,askVol:.002,bidNotional:83.0001,askNotional:166.0008}],rowSize:25,
      delta:.001,minDelta:-.001,maxDelta:.001,quoteDelta:83.0007,minQuoteDelta:-83.0001,maxQuoteDelta:83.0007,
      open:83000.1,high:83000.4,low:83000.1,close:83000.4,source:'binance-usdm-aggtrade',granularity:'aggregate-trade',coverage:'partial',gapBefore:false,aggregateRecordCount:2,
    }]});
    terminal.unitRaw=structuredClone(target.footprintBars);
  });
  await expect(panel.locator('.ohlc')).toContainText('Bid 0.001 · Ask 0.002');
  const before=await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.visibleRange());
  await units.click();
  await expect(units).toHaveText('USDT');
  await expect(units).toHaveAttribute('aria-pressed','true');
  await expect(panel.locator('.ohlc')).toContainText('Bid 83 · Ask 166');
  await expect(panel.locator('.ohlc')).toContainText('USDT');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.latestFootprintStats()?.bidVolume)).toBe(83.0001);
  const cellPoint=await page.evaluate(()=>{
    const target=[...(window as any).__terminal.panels.values()][0],chart=target.engine.chart,bar=target.footprintBars[0];
    const bounds=target.element.querySelector('.chart-stage').getBoundingClientRect();
    return {x:bounds.left+chart.timeToCoordinate(bar.time)+12,y:bounds.top+chart.priceToCoordinate(83000+bar.rowSize/2,0)};
  });
  await page.mouse.move(cellPoint.x,cellPoint.y);
  await expect(panel.locator('.ohlc')).toContainText('bid 83 / ask 166 USDT');
  expect(await page.evaluate(()=>(window as any).__terminal.unitSubscriptions)).toBe(1);
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.visibleRange())).toEqual(before);
  expect(await page.evaluate(()=>JSON.stringify([...(window as any).__terminal.panels.values()][0].footprintBars)==JSON.stringify((window as any).__terminal.unitRaw))).toBe(true);
  await page.screenshot({path:'artifacts/footprint-units-usdt-1366x768.png'});
  await page.setViewportSize({width:720,height:860});
  await units.scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/footprint-units-usdt-720x860.png'});
  await units.click();
  await expect(units).toHaveText('BTC');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.latestFootprintStats()?.bidVolume)).toBe(.001);
  await units.click();
  await expect.poll(()=>panel.evaluate(element=>JSON.parse(localStorage.getItem('basis.layout.v1')||'{}').layout?.panels?.[(element as HTMLElement).dataset.panelId!]?.params?.footprintUnits)).toBe('usdt');
  await page.reload();
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.length===2);
  await expect(page.getByRole('button',{name:'Footprint volume units',exact:true}).first()).toHaveText('USDT');
  expect(await page.evaluate(()=>[...(window as any).__terminal.panels.values()][1].selection.footprintUnits)).toBe('btc');
});

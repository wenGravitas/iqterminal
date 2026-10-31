import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';
import { fullWindowSmaRange } from '../../src/scripts/composition';

test.use({ storageState: { cookies: [], origins: [] } });

test('CVD output feeds a managed SMA, preserves reset/quality metadata, and moves with its pane adapter', async ({ page }) => {
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('.brand')).toContainText('FIXTURE');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel=page.locator('.candle-panel').first();
  const panelId=await panel.getAttribute('data-panel-id');if(!panelId)throw new Error('Fixture chart panel ID is missing.');
  const close=panel.locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});if(await close.isVisible())await close.click();
  await addIndicator(panel,'Multi-Venue CVD');
  const cvdRow=()=>panel.locator('.active-indicator[data-definition-id="native.multi-venue-cvd"]');
  await expect(cvdRow()).toBeVisible();
  await expect.poll(()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    return current.outputRegistry.get(`output:${cvd.instanceId}:cvdTotalBtc`)?.available;
  },panelId)).toBe(true);

  await panel.locator('[data-cvd=true]').getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  const picker=panel.getByRole('dialog',{name:'Select markets'});
  await picker.getByLabel('Aggregation name',{exact:true}).fill('R2 aggregation consumer');
  await picker.getByRole('button',{name:'Save selection as aggregation'}).click();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    const group=cvd.settings.groups[0];return Boolean(group&&current.outputRegistry.outputsForOwner(cvd.instanceId).some((output:any)=>output.title.includes(group.name)&&output.unit==='BTC'&&output.available));
  },panelId)).toBe(true);
  await page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    const [first,...rest]=cvd.settings.groups;
    current.changeIndicator(cvd.instanceId,{settings:{...cvd.settings,groups:[{...first,markets:['binance:spot']},...rest]}});
  },panelId);
  await expect.poll(()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    return cvd.settings.groups[0]?.markets;
  },panelId)).toEqual(['binance:spot']);

  await cvdRow().getByRole('button',{name:'Add moving average to Multi-Venue CVD',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add moving average',exact:true});
  const groupOption=await add.getByLabel('Indicator output').locator('option').evaluateAll((options,name)=>{
    const option=options.find((candidate:any)=>candidate.textContent?.includes(name)&&candidate.textContent?.includes('(BTC)')) as HTMLOptionElement|undefined;
    return option?{value:option.value,label:option.textContent}:null;
  },'R2 aggregation consumer');
  expect(groupOption).toBeTruthy();
  await add.getByLabel('Indicator output').selectOption(groupOption!.value);
  await add.getByRole('button',{name:'Add SMA',exact:true}).click();
  const smaRow=()=>panel.locator('.active-indicator[data-definition-id="native.composition-sma"]');
  await expect(smaRow()).toBeVisible();
  await expect.poll(()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.cvdView,sma=current.selection.indicators.find((item:any)=>item.definitionId==='native.composition-sma');
    return sma&&current.compositionApis.get(sma.instanceId)?.paneIndex===cvd.paneIndex();
  },panelId)).toBe(true);

  await smaRow().getByRole('button',{name:/settings$/,exact:false}).click();
  const edit=page.getByRole('dialog',{name:'Add moving average',exact:true});
  await edit.getByLabel('Length').fill('3');await edit.getByRole('button',{name:'Apply',exact:true}).click();
  const read=()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    const sma=current.selection.indicators.find((item:any)=>item.definitionId==='native.composition-sma');
    const source=current.outputRegistry.get(sma.numericInputs.source.outputId),derived=current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    const cvdView=current.cvdView;
    const refs=(window as any).__cvdCompositionMoveRefs??=((window as any).__cvdCompositionMoveRefs={view:cvdView,data:current.cvdData});
    return {cvdId:cvd.instanceId,smaId:sma.instanceId,source,derived,ref:sma.numericInputs.source,
      cvdPane:cvdView?.paneIndex()??-1,smaPane:current.compositionApis.get(sma.instanceId)?.paneIndex,
      paneId:cvd.paneId,composition:current.selection.composition,sameView:refs.view===cvdView,sameData:refs.data===current.cvdData,
      settings:cvd.settings,dataDiagnostics:current.cvdData.demandDiagnostics(),
      subscriptions:current.cvdData.demandDiagnostics().subscriptionStarts,
      scales:{btc:current.cvdOutputScaleId?.(cvd,'BTC'),usdt:current.cvdOutputScaleId?.(cvd,'USDT')},
      gapTime:(window as any).__cvdGapTime,
    };
  },panelId);
  await expect.poll(async()=>{const state=await read();return state.derived?.values?.length>0&&state.source?.available;}).toBe(true);
  const initial=await read();
  expect(initial.source).toMatchObject({timestampConvention:'candle-open',unit:'BTC',quality:expect.stringMatching(/complete|partial|stale/)});
  expect(initial.derived).toMatchObject({timestampConvention:initial.source.timestampConvention,quality:initial.source.quality,resets:initial.source.resets});
  expect(initial.scales.btc).not.toBe(initial.scales.usdt);
  expect(initial.composition.panes.find((pane:any)=>pane.id===initial.paneId)?.memberIds).toEqual([initial.cvdId,initial.smaId]);

  await cvdRow().getByRole('button',{name:'Move Multi-Venue CVD',exact:true}).click();
  const move=page.getByRole('dialog',{name:'Move indicator',exact:true});
  await move.getByLabel('Move to pane').selectOption('@new');
  await move.getByLabel('Move all studies in this pane together').check();
  await move.getByRole('button',{name:'Move',exact:true}).click();
  await expect.poll(async()=>{const state=await read();return state.cvdPane===state.smaPane&&state.paneId!==initial.paneId;}).toBe(true);
  const moved=await read();
  expect(moved.sameView).toBe(true);expect(moved.sameData).toBe(true);expect(moved.ref).toEqual(initial.ref);
  expect(moved.subscriptions).toBe(initial.subscriptions);
  expect(moved.scales).toEqual(initial.scales);

  const cvdPane=panel.locator('[data-cvd=true]');
  await cvdPane.getByRole('button',{name:'Aggregations',exact:true}).click();
  await cvdPane.getByRole('button',{name:'Hide line: R2 aggregation consumer',exact:true}).click();
  await cvdPane.getByRole('button',{name:'Venues',exact:true}).click();
  await panel.getByRole('button',{name:'Multi-Venue CVD settings',exact:true}).click();
  const cvdSettings=panel.getByRole('dialog',{name:'Multi-Venue CVD settings'});
  await cvdSettings.getByLabel('CVD display unit',{exact:true}).selectOption('usdt');
  await cvdSettings.getByRole('button',{name:'Apply',exact:true}).click();
  const afterCosmetics=await read();
  expect(afterCosmetics.ref).toEqual(initial.ref);expect(afterCosmetics.source.revision).toBe(initial.source.revision);
  expect(afterCosmetics.dataDiagnostics.dataRevision).toBe(initial.dataDiagnostics.dataRevision);
  expect(afterCosmetics.dataDiagnostics.outputRevisions).toEqual(initial.dataDiagnostics.outputRevisions);
  expect(afterCosmetics.subscriptions).toBe(initial.subscriptions);
  expect(afterCosmetics.derived.values).toEqual(initial.derived.values);
  expect(afterCosmetics.source.available).toBe(true);
  await cvdRow().getByRole('button',{name:'Hide Multi-Venue CVD',exact:true}).click();
  await expect(panel.locator('[data-cvd=true]')).toHaveCount(0);
  const hiddenSource=await read();
  expect(hiddenSource.dataDiagnostics).toMatchObject({demanded:true,subscribed:true});
  expect(hiddenSource.source.available).toBe(true);expect(hiddenSource.ref).toEqual(initial.ref);

  await page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),now=Date.now(),step=60_000,base=Math.floor((now-18*step)/step)*step,to=base+15*step;
    for(const source of ['binance:spot','binance:perpetual']){
      const factor=1;
      current.feed.send({type:'cvd-fixture',source,payload:{version:1,source:`${source}:BTCUSDT`,stepMs:step,from:base,to,revision:101,snapshot:true,watermark:501,
        baseUnit:'BTC',quoteUnit:'USDT',buckets:Array.from({length:15},(_,index)=>({time:base+index*step,base:factor*(index+1),quote:factor*(index+1)*100,revision:101})),
        coverage:{from:base,to,gaps:[]},status:'live',asOf:to}});
    }
    const candles=Array.from({length:12},(_,index)=>{const minute=index<6?index:index+1;return{t:base+minute*step,o:100,h:101,l:99,c:100,v:1,revision:index+1,closed:true};});
    current.candles=candles;current.engine.setSnapshot(candles,false);current.studies.setSnapshot(candles);current.cvdData.setHostCandles(candles);current.cvdView?.setHostCandles(candles);
    (window as any).__cvdGapTime=base+7*step;
  },panelId);
  await expect.poll(async()=>{const state=await read();return state.source?.times?.length===12&&state.source.resets.some((reset:any)=>reset.fromTime===state.gapTime);}).toBe(true);
  const gapped=await read(),resetIndex=gapped.source.times.indexOf(gapped.gapTime);
  expect(gapped.source.quality).toBe('partial');
  expect(gapped.derived.quality).toBe(gapped.source.quality);
  expect(gapped.derived.resets).toEqual(gapped.source.resets);
  expect(gapped.source.timestampConvention).toBe('candle-open');
  expect(gapped.derived.values[resetIndex]).toBeNull();
  expect(gapped.derived.values[resetIndex+1]).toBeNull();
  expect(gapped.derived.values[resetIndex+2]).not.toBeNull();

  const groupState=()=>page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    const group=cvd.settings.groups[0],output=current.outputRegistry.outputsForOwner(cvd.instanceId).find((item:any)=>item.title.includes(group.name)&&item.unit==='BTC');
    const venueKey=group.markets[0]==='binance:spot'?'cvdVenueBinanceSpotBtc':'cvdVenueBinancePerpetualBtc';
    const selectedVenue=current.outputRegistry.get(`output:${cvd.instanceId}:${venueKey}`);
    const sma=current.selection.indicators.find((item:any)=>item.definitionId==='native.composition-sma'),derived=current.outputRegistry.get(`output:${sma.instanceId}:p0`);
    return {group:{id:group.id,name:group.name,markets:[...group.markets]},output:{revision:output.revision,contextRevision:output.contextRevision,title:output.title,values:[...output.values],times:[...output.times],resets:[...output.resets]},
      selectedVenue:{plotKey:selectedVenue?.plotKey,values:[...(selectedVenue?.values??[])]},
      derived:{revision:derived.revision,contextRevision:derived.contextRevision,values:[...derived.values],times:[...derived.times],resets:[...derived.resets]},subscriptions:current.cvdData.demandDiagnostics().subscriptionStarts,
      consumerCurrent:current.outputRegistry.consumerIsCurrent(sma.instanceId)};
  },panelId);
  const beforeRename=await groupState();
  expect(beforeRename.group.markets).toEqual(['binance:spot']);
  const renamed='R2 aggregation renamed';
  await page.evaluate(({id,name})=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    current.changeIndicator(cvd.instanceId,{settings:{...cvd.settings,groups:cvd.settings.groups.map((group:any)=>({...group,name}))}});
  },{id:panelId,name:renamed});
  await expect.poll(async()=>{const state=await groupState();return state.output.title;}).toContain(renamed);
  const afterRename=await groupState();
  expect(afterRename.group.markets).toEqual(beforeRename.group.markets);
  expect(afterRename.output.contextRevision).toBe(beforeRename.output.contextRevision);
  expect(afterRename.output.revision).toBeGreaterThan(beforeRename.output.revision);
  expect(afterRename.output.values).toEqual(beforeRename.output.values);

  await page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),sma=current.selection.indicators.find((item:any)=>item.definitionId==='native.composition-sma');
    current.outputRegistry.unregisterConsumer(sma.instanceId);
  },panelId);
  await expect.poll(async()=> (await groupState()).consumerCurrent).toBe(false);
  await page.evaluate(id=>{
    const current=(window as any).__terminal.panels.get(id),cvd=current.selection.indicators.find((item:any)=>item.definitionId==='native.multi-venue-cvd');
    current.changeIndicator(cvd.instanceId,{settings:{...cvd.settings,groups:cvd.settings.groups.map((group:any)=>({...group,markets:['binance:perpetual']}))}});
  },panelId);
  await expect.poll(async()=> (await groupState()).group.markets).toEqual(['binance:perpetual']);
  await expect.poll(async()=> (await groupState()).consumerCurrent).toBe(true);
  const afterMembership=await groupState();
  expect(afterMembership.output.values).toEqual(afterMembership.selectedVenue.values);
  expect(afterMembership.output.contextRevision).toBe(afterRename.output.contextRevision+1);
  expect(afterMembership.output.revision).toBeGreaterThan(afterRename.output.revision);
  expect(afterMembership.derived.values).toEqual(fullWindowSmaRange(afterMembership.output.values,3,0,
    afterMembership.output.values.length,afterMembership.output.times,afterMembership.output.resets));
  expect(afterMembership.derived.contextRevision).toBeGreaterThan(afterRename.derived.contextRevision);
  expect(afterMembership.subscriptions).toBe(afterRename.subscriptions);
  expect(afterMembership.consumerCurrent).toBe(true);
  expect(errors).toEqual([]);
});

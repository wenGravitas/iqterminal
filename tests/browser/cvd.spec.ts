import {test,expect,type Page}from '@playwright/test';
import {addIndicator}from './indicator-actions';
async function setup(page:Page){
  await page.addInitScript(()=>{
    const state=window as any;state.__cvdCommands=[];const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message:any,transfer?:any){if(message.type?.startsWith('cvd-'))state.__cvdCommands.push(message);return post.call(this,message,transfer);};
  });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const closes=page.getByRole('button',{name:/^Close /});if(await closes.count()>1)await closes.nth(1).click();
  const panel=page.locator('.candle-panel').first(),close=panel.locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});if(await close.isVisible())await close.click();
  await addIndicator(panel,'Multi-Venue CVD');
  await expect(panel.locator('[data-cvd=true]')).toBeVisible();
  return panel;
}
const state=(page:Page)=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].cvdView?.diagnostics());
const subscribeCount=(page:Page)=>page.evaluate(()=>(window as any).__cvdCommands.filter((m:any)=>m.type==='cvd-subscribe').length);
test('CVD pane reuses sources, separates visibility and membership, persists named group copies and anchors',async({page})=>{
  test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const panel=await setup(page),pane=panel.locator('[data-cvd=true]');
  await expect.poll(async()=>(await state(page))?.sources.length).toBe(2);
  await expect.poll(async()=>(await state(page))?.segments).toBeGreaterThan(0);
  const initial=await state(page),total=initial.lines.find((l:any)=>l.id==='total').latest.value,subs=await subscribeCount(page);
  const toolbarBox=(await pane.locator('.cvd-toolbar').boundingBox())!,legendBox=(await pane.locator('.cvd-legend').boundingBox())!,dividerBox=(await pane.getByRole('separator').boundingBox())!;
  expect(Math.abs(toolbarBox.y-legendBox.y)).toBeLessThan(1);expect(toolbarBox.x+toolbarBox.width).toBeLessThan(dividerBox.x);expect(dividerBox.x).toBeLessThan(legendBox.x);
  const optionsBox=(await pane.locator('.cvd-controls').boundingBox())!,actionsBox=(await panel.locator(`.pane-layout-controls[data-pane-index="${initial.paneIndex}"]`).boundingBox())!,titleBox=(await panel.locator(`.pane-indicator-host[data-pane-index="${initial.paneIndex}"]`).boundingBox())!;
  expect(Math.abs(optionsBox.y+optionsBox.height/2-actionsBox.y-actionsBox.height/2)).toBeLessThan(3);expect(optionsBox.x+optionsBox.width).toBeLessThanOrEqual(actionsBox.x-4);expect(titleBox.x+titleBox.width).toBeLessThanOrEqual(optionsBox.x-4);
  await expect.poll(()=>page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView,r=v.primitive.autoscaleInfo(),scale=v.anchor.priceScale(),plot=v.chart.plotRect(v.paneIndex());return Math.abs(scale.priceToY(r.min)-scale.priceToY(r.max))/plot.height;})).toBeGreaterThan(.45);
  await expect.poll(()=>page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView,r=v.primitive.autoscaleInfo();return v.anchor.priceScale().priceToY(r.max)-v.controlRow.offsetTop-v.controlRow.offsetHeight;})).toBeGreaterThan(5);

  expect(initial.sources.map((s:any)=>s.source)).toEqual(['binance:spot','binance:perpetual']);
  await panel.screenshot({path:'/tmp/cvd-venues-dark.png'});
  await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0];(window as any).__cvdIdentity={view:p.cvdView,chart:p.engine.chart,pane:p.cvdView.paneIndex()};});
  await pane.getByRole('button',{name:'Hide line: BN[S] BTCUSDT',exact:true}).click();
  expect((await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(total);
  expect(await subscribeCount(page)).toBe(subs);
  await pane.getByRole('button',{name:'Aggregations',exact:true}).click();
  await expect(pane.locator('.cvd-status')).toContainText('No aggregations selected');
  expect((await state(page)).settings.sources).toEqual(initial.settings.sources);
  expect(await subscribeCount(page)).toBe(subs);
  await pane.getByRole('button',{name:'Venues',exact:true}).click();
  await pane.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  const picker=panel.getByRole('dialog',{name:'Select markets'});
  await expect(picker.getByRole('checkbox',{name:'Hyperliquid · BTC Perp',exact:true})).toBeDisabled();
  await picker.getByLabel('Aggregation name',{exact:true}).fill('My flow basket');
  await picker.getByRole('button',{name:'Save selection as aggregation'}).click();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  expect(errors).toEqual([]);
  await expect(picker).not.toBeVisible();
  await pane.getByRole('button',{name:'Aggregations',exact:true}).click();
  await expect.poll(async()=>{const s=await state(page);return s.lines.some((l:any)=>l.id===s.settings.groups[0]?.id);}).toBe(true);
  const grouped=await state(page),group=grouped.lines.find((l:any)=>l.id!=='total');
  expect(group.latest.value).toBe(total);expect(await subscribeCount(page)).toBe(subs);
  expect(await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0],old=(window as any).__cvdIdentity;return p.cvdView===old.view&&p.engine.chart===old.chart&&p.cvdView.paneIndex()===old.pane;})).toBe(true);
  await pane.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  await picker.getByRole('checkbox',{name:'Binance · BTCUSDT Spot',exact:true}).uncheck();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await state(page)).sources.length).toBe(1);
  await expect(pane.locator('.cvd-legend')).toContainText('[filtered]');
  const current=await state(page);expect(current.settings.sources).toEqual(['binance:perpetual']);
  expect(current.lines.find((l:any)=>l.id==='total').latest.value).toBe(current.sources[0].latest.base);
  const origin=current.settings.origin,subscribed=await subscribeCount(page);
  await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');
  await expect.poll(async()=>(await state(page)).segments).toBeGreaterThan(0);
  expect((await state(page)).settings.origin).toBe(origin);expect(await subscribeCount(page)).toBe(subscribed);
  await panel.getByRole('button',{name:'Multi-Venue CVD settings',exact:true}).click();
  const settings=panel.getByRole('dialog',{name:'Multi-Venue CVD settings'});
  await settings.getByLabel('Reset mode',{exact:true}).selectOption('weekly');
  await settings.getByLabel('CVD display unit',{exact:true}).selectOption('usdt');
  await settings.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await state(page)).settings.anchor).toBe('weekly');
  await expect(pane.locator('.cvd-legend')).toContainText('USDT');
  expect((await state(page)).settings.colors.total).toBeUndefined(); // untouched total stays theme-adaptive
  for(const theme of ['dark','light']as const){
    await page.getByLabel('Theme',{exact:true}).selectOption(theme);
    await expect.poll(()=>pane.evaluate(e=>getComputedStyle(e).getPropertyValue('--chart').trim())).toBe(theme==='dark'?'#090909':'#f6f4ee');
    await panel.screenshot({path:`/tmp/cvd-${theme}.png`});
  }
  await expect.poll(()=>page.evaluate(()=>{
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);return(Object.values(saved.layout.panels)as any[]).find(p=>p.contentComponent==='candle').params.indicators.find((i:any)=>i.definitionId==='native.multi-venue-cvd')?.settings.anchor;
  })).toBe('weekly');
  await page.reload();await expect.poll(async()=>(await state(page))?.settings.anchor).toBe('weekly');
  expect((await state(page)).settings.groups[0].name).toBe('My flow basket');
  await page.setViewportSize({width:720,height:860});
  await pane.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  await picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true}).uncheck();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(pane.locator('.cvd-status')).toHaveText('No sources selected');
  await expect(pane.getByRole('button',{name:'Select included CVD sources and aggregations'})).toBeVisible();
  await page.screenshot({path:'/tmp/cvd-empty-narrow.png'});
  await panel.getByRole('button',{name:'Remove Multi-Venue CVD',exact:true}).click();
  await expect(pane).toHaveCount(0);expect(errors).toEqual([]);
});
test('CVD global currency, crosshair, incomplete coverage and corrected history remain honest',async({page})=>{
  test.setTimeout(90_000);const panel=await setup(page),pane=panel.locator('[data-cvd=true]');
  await expect.poll(async()=>(await state(page))?.segments).toBeGreaterThan(0);
  const subscriptions=await subscribeCount(page);
  await page.getByRole('button',{name:'Global settings',exact:true}).click();
  const global=page.getByRole('dialog',{name:'Global settings'});
  await global.getByLabel('Override indicator currencies').check();await global.getByLabel('Default display currency').selectOption('quote');await global.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(pane.locator('.cvd-legend')).toContainText('USDT');expect(await subscribeCount(page)).toBe(subscriptions);
  await panel.getByRole('button',{name:'Multi-Venue CVD settings',exact:true}).click();
  const dialog=panel.getByRole('dialog',{name:'Multi-Venue CVD settings'});
  await expect(dialog.getByLabel('CVD display unit',{exact:true})).toBeDisabled();await expect(dialog).toContainText('Global currency setting');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const before=await state(page);
  await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0],now=Date.now(),day=Math.floor(now/86400000)*86400000,from=day,to=day+180000;
    for(const source of ['binance:spot','binance:perpetual']){
      const buckets=[100,-40,20].map((base,index)=>({time:from+index*60000,base,quote:base*(100+index),revision:100}));
      (window as any).__terminal.feed.send({type:'cvd-fixture',source,payload:{version:1,source:source+':BTCUSDT',stepMs:60000,from,to,revision:100,snapshot:true,watermark:500,baseUnit:'BTC',quoteUnit:'USDT',buckets,coverage:{from,to,gaps:[]},status:'live',asOf:to}});
    }
  });
  await expect.poll(async()=>(await state(page)).sources.every((s:any)=>s.latest.base===80)).toBe(true);
  await expect.poll(async()=>(await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(16000);
  // Expose exactly the injected interval in the host viewport without changing CVD origin.
  await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0],day=Math.floor(Date.now()/86400000)*86400000;
    const candles=Array.from({length:5},(_,i)=>({t:day+i*60000,o:100,h:110,l:90,c:100,v:1,closed:true}));
    p.engine.setSnapshot(candles,false);p.cvdView.setHostCandles(candles);p.engine.resetView();
  });
  const box=(await pane.boundingBox())!;
  // Only a few bars are present; hover an actual shared time-axis coordinate.
  const x=await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0],c=p.engine.chart;return c.timeScale.indexToX(c.dataLayer.timeToIndexFloat(Math.floor(Date.now()/86400000)*86400+120));});
  const chartBox=(await panel.locator('.chart-stage').boundingBox());
  await page.mouse.move((chartBox?.x??box.x)+x,box.y+box.height*.7);
  await expect(pane.locator('.cvd-tooltip')).toBeVisible();await expect(pane.locator('.cvd-tooltip')).toContainText('USDT');
  expect((await state(page)).settings.origin).toBe(before.settings.origin);
  const total=(await state(page)).lines.find((l:any)=>l.id==='total').latest.value;
  await page.mouse.wheel(0,-160);await page.mouse.move(box.x+200,box.y+box.height*.75);await page.mouse.down();await page.mouse.move(box.x+260,box.y+box.height*.75,{steps:4});await page.mouse.up();
  expect((await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(total);
  // Revise one historical minute, replay it, then lose and recover the connection without filling the gap.
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,day=Math.floor(Date.now()/86400000)*86400000;
    const payload={version:1,source:'binance:spot:BTCUSDT',stepMs:60000,from:day,to:day+180000,revision:101,snapshot:false,watermark:501,baseUnit:'BTC',quoteUnit:'USDT',
      buckets:[{time:day+60000,base:-10,quote:-1010,revision:101}],coverage:{from:day,to:day+180000,gaps:[{from:day+60000,to:day+120000}]},status:'stale',asOf:day+180000};
    terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload});terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload});
  });
  await expect.poll(async()=>(await state(page)).sources[0].latest.base).toBe(110);
  await expect(pane.locator('.cvd-status')).toContainText('Source stale');
  await expect(pane.locator('.cvd-status')).toContainText('available since');
  await page.evaluate(()=>{const terminal=(window as any).__terminal,day=Math.floor(Date.now()/86400000)*86400000;terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload:{version:1,source:'binance:spot:BTCUSDT',stepMs:60000,from:day,to:day+180000,revision:102,snapshot:false,watermark:501,baseUnit:'BTC',quoteUnit:'USDT',buckets:[],coverage:{from:day,to:day+180000,gaps:[{from:day+60000,to:day+120000}]},status:'live',asOf:day+180000}});});
  await expect(pane.locator('.cvd-status')).toContainText('Partial history');
  await expect.poll(async()=>(await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(19030);
});

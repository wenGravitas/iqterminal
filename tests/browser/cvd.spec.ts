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
const dataState=(page:Page)=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].cvdData?.demandDiagnostics());
const subscribeCount=(page:Page)=>page.evaluate(()=>(window as any).__cvdCommands.filter((m:any)=>m.type==='cvd-subscribe').length);
async function cvdHoverTargets(page:Page){
  return page.evaluate(()=>{
    const panel=[...(window as any).__terminal.panels.values()][0],view=panel.cvdView,chart=view.chart,plot=chart.plotRect(view.paneIndex());
    if(!plot)return[];
    const stage=panel.element.querySelector('.chart-stage') as HTMLElement,rect=stage.getBoundingClientRect(),lines=[...view.model.lines.values()].filter((line:any)=>!view.settings.hidden.includes(line.id));
    const sampleAt=(line:any,time:number,x:number,period:number)=>{
      const points=line.points;let low=0,high=points.length;while(low<high){const mid=(low+high)>>>1;if(points[mid].time<time)low=mid+1;else high=mid;}
      for(const start of [low-1,low]){
        const first=points[start],last=points[start+1];
        if(!first||!last||first.value==null||last.value==null||!Number.isFinite(first.value)||!Number.isFinite(last.value)||first.period!==period||last.period!==period||last.time-first.time<=0||last.time-first.time>60_000||time<first.time||time>last.time)continue;
        const x0=chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(first.time/1000)),x1=chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(last.time/1000));
        if(x1<=x0||x<x0||x>x1)continue;const ratio=(x-x0)/(x1-x0);return first.value+(last.value-first.value)*ratio;
      }
      return undefined;
    };
    const targets=[] as {id:string;time:number;x:number;y:number;separation:number;score:number}[];
    for(const line of lines){
      const points=line.points;
      for(let i=0;i<points.length-1;i++){
        const first=points[i],last=points[i+1];if(first.value==null||last.value==null||!Number.isFinite(first.value)||!Number.isFinite(last.value)||first.period!==last.period||last.time-first.time<=0||last.time-first.time>60_000)continue;
        const x0=chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(first.time/1000)),x1=chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(last.time/1000));
        if(x1<=x0)continue;
        for(const fraction of [.34,.66]){
          const x=x0+(x1-x0)*fraction;if(x<24||x>plot.width-24)continue;
          const logical=chart.timeScale.xToIndex(x),time=chart.dataLayer.indexToTimeFloat(logical)*1000;if(!Number.isFinite(time))continue;
          const value=sampleAt(line,time,x,first.period);if(value==null)continue;
          const y=plot.top+view.anchor.priceScale().priceToY(value);if(y<plot.top||y>plot.top+plot.height)continue;
          let separation=Infinity;
          for(const other of lines){if(other.id===line.id)continue;const otherValue=sampleAt(other,time,x,first.period);if(otherValue==null)continue;
            separation=Math.min(separation,Math.abs(view.anchor.priceScale().priceToY(otherValue)-view.anchor.priceScale().priceToY(value)));}
          const score=separation*1000-Math.abs(x-plot.width/2);
          targets.push({id:line.id,time,x:rect.left+plot.left+x,y:rect.top+y,separation,score});
        }
      }
    }
    return targets.sort((a,b)=>b.score-a.score);
  });
}
test('CVD pane reuses sources, separates visibility and membership, persists named group copies and anchors',async({page})=>{
  test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const panel=await setup(page),pane=panel.locator('[data-cvd=true]');
  await expect.poll(async()=>(await state(page))?.sources.length).toBe(2);
  await expect.poll(async()=>(await state(page))?.segments).toBeGreaterThan(0);
  const initial=await state(page),total=initial.lines.find((l:any)=>l.id==='total').latest.value,subs=await subscribeCount(page),dataBeforeCosmetics=await dataState(page);
  const header=panel.locator(`.pane-indicator-host[data-pane-index="${initial.paneIndex}"]`),controls=header.locator('.cvd-controls');
  const toolbarBox=(await controls.locator('.cvd-toolbar').boundingBox())!,legendBox=(await controls.locator('.cvd-legend').boundingBox())!,dividerBox=(await controls.getByRole('separator').boundingBox())!;
  expect(Math.abs(toolbarBox.y-legendBox.y)).toBeLessThan(1);expect(toolbarBox.x+toolbarBox.width).toBeLessThan(dividerBox.x);expect(dividerBox.x).toBeLessThan(legendBox.x);
  const optionsBox=(await controls.boundingBox())!,actionsBox=(await header.locator('.pane-layout-controls-inline').boundingBox())!,titleBox=(await header.locator('.active-indicator').boundingBox())!,copyBox=(await header.locator('.active-indicator-copy').boundingBox())!,indicatorActionsBox=(await header.locator('.active-indicator-actions').boundingBox())!;
  const copyRight=copyBox.x+copyBox.width;
  expect(Math.abs(optionsBox.y+optionsBox.height/2-actionsBox.y-actionsBox.height/2)).toBeLessThan(3);expect(optionsBox.x+optionsBox.width).toBeLessThanOrEqual(actionsBox.x);expect(copyRight).toBeLessThanOrEqual(indicatorActionsBox.x);expect(indicatorActionsBox.x-copyRight).toBeLessThanOrEqual(3);expect(titleBox.width).toBeLessThan(295);
  await expect.poll(()=>page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView,r=v.primitive.autoscaleInfo(),scale=v.anchor.priceScale(),plot=v.chart.plotRect(v.paneIndex());return Math.abs(scale.priceToY(r.min)-scale.priceToY(r.max))/plot.height;})).toBeGreaterThan(.45);
  await expect.poll(()=>page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView,r=v.primitive.autoscaleInfo();return v.anchor.priceScale().priceToY(r.max)-30;})).toBeGreaterThan(5);

  expect(initial.sources.map((s:any)=>s.source)).toEqual(['binance:spot','binance:perpetual']);
  await panel.screenshot({path:'/tmp/cvd-venues-dark.png'});
  await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0];(window as any).__cvdIdentity={view:p.cvdView,chart:p.engine.chart,pane:p.cvdView.paneIndex()};});
  await controls.getByRole('button',{name:'Hide line: BN[S] BTCUSDT',exact:true}).click();
  expect((await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(total);
  expect(await subscribeCount(page)).toBe(subs);
  await controls.getByRole('button',{name:'Aggregations',exact:true}).click();
  await expect(pane.locator('.cvd-status')).toContainText('Choose an exchange group in Sources.');
  expect((await state(page)).settings.sources).toEqual(initial.settings.sources);
  expect(await subscribeCount(page)).toBe(subs);
  await controls.getByRole('button',{name:'Venues',exact:true}).click();
  const dataAfterCosmetics=await dataState(page);
  expect(dataAfterCosmetics.subscriptionStarts).toBe(dataBeforeCosmetics.subscriptionStarts);
  expect(dataAfterCosmetics.outputRevisions).toEqual(dataBeforeCosmetics.outputRevisions);
  expect(dataAfterCosmetics.outputPublications).toBe(dataBeforeCosmetics.outputPublications);
  await controls.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  const picker=panel.getByRole('dialog',{name:'Select markets'});
  await expect(picker.getByRole('checkbox',{name:'Hyperliquid · BTC Perp',exact:true})).toBeDisabled();
  await picker.getByLabel('Aggregation name',{exact:true}).fill('My flow basket');
  await picker.getByRole('button',{name:'Save selection as aggregation'}).click();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  expect(errors).toEqual([]);
  await expect(picker).not.toBeVisible();
  await controls.getByRole('button',{name:'Aggregations',exact:true}).click();
  await expect.poll(async()=>{const s=await state(page);return s.lines.some((l:any)=>l.id===s.settings.groups[0]?.id);}).toBe(true);
  const grouped=await state(page),group=grouped.lines.find((l:any)=>l.id!=='total');
  expect(group.latest.value).toBe(total);expect(await subscribeCount(page)).toBe(subs);
  expect(await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0],old=(window as any).__cvdIdentity;return p.cvdView===old.view&&p.engine.chart===old.chart&&p.cvdView.paneIndex()===old.pane;})).toBe(true);
  await controls.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  await picker.getByRole('checkbox',{name:'Binance · BTCUSDT Spot',exact:true}).uncheck();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await state(page)).sources.length).toBe(1);
  await expect(controls.locator('.cvd-legend')).toContainText('[filtered]');
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
  await expect(controls.locator('.cvd-legend')).toContainText('USDT');
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
  const narrowControls=panel.locator('.pane-indicator-host .pane-indicator-rows > .cvd-controls');
  await expect(narrowControls).toHaveAttribute('data-pane-header','true');
  const narrowHeader=await narrowControls.evaluate(control=>{
    const host=control.closest<HTMLElement>('.pane-indicator-host')!,rowList=control.closest<HTMLElement>('.pane-indicator-rows')!;
    const row=rowList.querySelector<HTMLElement>('.active-indicator')!,copy=row.querySelector<HTMLElement>('.active-indicator-copy')!,actions=row.querySelector<HTMLElement>('.active-indicator-actions')!;
    const actionRect=actions.getBoundingClientRect(),copyRect=copy.getBoundingClientRect(),rowRect=row.getBoundingClientRect(),optionsRect=control.getBoundingClientRect();
    const paneActions=host.querySelector<HTMLElement>('.pane-layout-controls-inline')!;
    return {actionsTouchTitle:actionRect.left-copyRect.right,actionsInsideRow:actionRect.right<=rowRect.right+1,
      optionsAfterActions:optionsRect.left>=actionRect.right,optionsBeforePaneActions:optionsRect.right<=paneActions.getBoundingClientRect().left+2,
      overflowEscape:rowList.scrollWidth>rowList.clientWidth};
  });
  expect(narrowHeader.actionsTouchTitle).toBeLessThanOrEqual(3);
  expect(narrowHeader.actionsInsideRow).toBe(true);
  expect(narrowHeader.optionsAfterActions).toBe(true);
  expect(narrowHeader.optionsBeforePaneActions||narrowHeader.overflowEscape).toBe(true);
  await narrowControls.getByRole('button',{name:'Select included CVD sources and aggregations'}).click();
  await picker.getByRole('checkbox',{name:'Binance · BTCUSDT USD-M Perp',exact:true}).uncheck();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(pane.locator('.cvd-status')).toHaveText('Choose at least one exchange.');
  await expect(narrowControls.getByRole('button',{name:'Select included CVD sources and aggregations'})).toBeVisible();
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
  await expect(panel.locator('.pane-indicator-host .cvd-controls .cvd-legend')).toContainText('USDT');expect(await subscribeCount(page)).toBe(subscriptions);
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
  const card=panel.locator('.chart-stage .cvd-tooltip'),dot=panel.locator('.chart-stage .cvd-hover-dot');
  const box=(await pane.boundingBox())!;
  // Hover a visible, rendered CVD segment. The marker is hidden until the existing 500 ms dwell expires.
  const firstTargets=await cvdHoverTargets(page),firstTarget=firstTargets.find(target=>target.id!=='total'&&target.separation>=8)??firstTargets[0];
  expect(firstTarget).toBeTruthy();
  await page.mouse.move(firstTarget.x,firstTarget.y);
  await page.waitForTimeout(300);await expect(card).toBeHidden();await expect(dot).toBeHidden();
  await page.waitForTimeout(260);await expect(card).toBeVisible();await expect(dot).toBeVisible();await expect(card).toContainText('USDT');
  const firstHover=await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0],v=p.cvdView,button=v.lineButtons.get(v.hoverDot.dataset.lineId);
    const r=v.hoverDot.getBoundingClientRect();return {line:v.hoverDot.dataset.lineId,time:Number(v.hoverDot.dataset.hoverTime),x:r.left+r.width/2,y:r.top+r.height/2,
      color:v.hoverDot.style.getPropertyValue('--cvd-hover-color').trim(),sourceColor:button?.style.getPropertyValue('--source-color').trim(),hovered:(v.tooltip as HTMLElement).querySelector<HTMLElement>('[data-hovered="true"]')?.dataset.lineId};});
  expect(firstHover.line).toBe(firstTarget.id);expect(firstHover.hovered).toBe(firstTarget.id);expect(firstHover.color).toBe(firstHover.sourceColor==='var(--text)'?await pane.evaluate(e=>getComputedStyle(e).getPropertyValue('--text').trim()):firstHover.sourceColor);
  expect(Math.abs(firstHover.x-firstTarget.x)).toBeLessThan(3);expect(Math.abs(firstHover.y-firstTarget.y)).toBeLessThan(3);
  expect((await state(page)).settings.origin).toBe(before.settings.origin);
  const total=(await state(page)).lines.find((l:any)=>l.id==='total').latest.value;
  await page.mouse.wheel(0,-160);await page.mouse.move(box.x+200,box.y+box.height*.75);await page.mouse.down();
  expect(await page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView;return v.tooltip.hidden;})).toBe(true);
  await page.mouse.move(box.x+260,box.y+box.height*.75,{steps:4});await page.mouse.up();
  const afterRelease=await page.evaluate(()=>{const v=[...(window as any).__terminal.panels.values()][0].cvdView;return {down:v.hoverPointerDown,blocked:v.tooltipBlockedUntilMove,tooltipHidden:v.tooltip.hidden};});
  expect(afterRelease).toEqual({down:false,blocked:true,tooltipHidden:true});
  expect((await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(total);
  // Revise one historical minute, replay it, then lose and recover the connection without filling the gap.
  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,day=Math.floor(Date.now()/86400000)*86400000;
    const payload={version:1,source:'binance:spot:BTCUSDT',stepMs:60000,from:day,to:day+180000,revision:101,snapshot:false,watermark:501,baseUnit:'BTC',quoteUnit:'USDT',
      buckets:[{time:day+60000,base:-10,quote:-1010,revision:101}],coverage:{from:day,to:day+180000,gaps:[{from:day+60000,to:day+120000}]},status:'stale',asOf:day+180000};
    terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload});terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload});
  });
  await expect.poll(async()=>(await state(page)).sources[0].latest.base).toBe(110);
  await expect(pane.locator('.cvd-status')).toHaveText('Some exchange data is delayed.');
  await page.evaluate(()=>{const p=[...(window as any).__terminal.panels.values()][0];p.engine.resetView();});
  const staleTargets=await cvdHoverTargets(page),staleTarget=staleTargets.find(target=>target.id!=='total'&&target.separation>=8)??staleTargets[0];
  expect(staleTarget).toBeTruthy();await page.mouse.move(0,0);await page.mouse.move(staleTarget.x,staleTarget.y,{steps:2});await page.waitForTimeout(550);
  await expect(card).toBeVisible();await expect(card).toContainText('Source stale');await expect(card).toContainText('available since');
  await page.evaluate(()=>{const terminal=(window as any).__terminal,day=Math.floor(Date.now()/86400000)*86400000;terminal.feed.send({type:'cvd-fixture',source:'binance:spot',payload:{version:1,source:'binance:spot:BTCUSDT',stepMs:60000,from:day,to:day+180000,revision:102,snapshot:false,watermark:501,baseUnit:'BTC',quoteUnit:'USDT',buckets:[],coverage:{from:day,to:day+180000,gaps:[{from:day+60000,to:day+120000}]},status:'live',asOf:day+180000}});});
  await expect(pane.locator('.cvd-status')).toHaveText('Some data is missing.');
  await expect(card).toContainText('Partial history');
  await expect(card).toContainText('available since');
  await expect.poll(async()=>(await state(page)).lines.find((l:any)=>l.id==='total').latest.value).toBe(19030);
});

test('CVD hover dot follows minute segments inside five-minute bars and hides at nulls, gaps, hidden lines and disposal',async({page})=>{
  test.setTimeout(120_000);const panel=await setup(page),pane=panel.locator('[data-cvd=true]');
  await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].cvdView.series.interval)).toBe('5m');
  const from=Math.floor(Date.now()/300_000)*300_000-1_500_000;
  await page.evaluate(({from})=>{
    const terminal=(window as any).__terminal,to=from+11*60_000;
    for(const [source,start,step]of [['binance:spot',100,11],['binance:perpetual',500,7]]as const){
      const buckets=Array.from({length:11},(_,index)=>({time:from+index*60_000,base:start+index*step,quote:(start+index*step)*(1000+index),revision:200}));
      terminal.feed.send({type:'cvd-fixture',source,payload:{version:1,source:source+':BTCUSDT',stepMs:60_000,from,to,revision:200,snapshot:true,watermark:700,baseUnit:'BTC',quoteUnit:'USDT',buckets,coverage:{from,to,gaps:[]},status:'live',asOf:to}});
    }
    const panel=[...terminal.panels.values()][0],candles=Array.from({length:5},(_,index)=>({t:from+index*300_000,o:100,h:110,l:90,c:100,v:1,closed:true}));
    panel.engine.setSnapshot(candles,false);panel.cvdView.setHostCandles(candles);panel.engine.chart.timeScale.setVisibleLogicalRange({from:0,to:candles.length-1});panel.engine.resetView();
  },{from});
  await page.waitForTimeout(100);
  await page.evaluate(()=>{const chart=[...(window as any).__terminal.panels.values()][0].engine.chart;chart.timeScale.setBarSpacing(80);chart.timeScale.setRightOffset(1);});
  await expect.poll(async()=>(await state(page)).sources.every((source:any)=>source.points===11)).toBe(true);
  await expect.poll(async()=>(await state(page)).segments).toBeGreaterThan(0);
  const targets=await cvdHoverTargets(page),interior=(time:number)=>{const offset=((time%300_000)+300_000)%300_000;return offset>10_000&&offset<290_000;};
  const first=targets.find(target=>target.id==='total'&&target.separation>18&&interior(target.time));
  expect(first,'a visible minute CVD segment inside a five-minute host candle').toBeTruthy();
  const second=targets.find(target=>target.id==='total'&&target.separation>18&&interior(target.time)
    &&Math.floor(target.time/300_000)===Math.floor(first!.time/300_000)&&Math.abs(target.time-first!.time)>10_000&&Math.abs(target.x-first!.x)>4);
  expect(second,'a second position on the same line and host candle').toBeTruthy();
  const card=panel.locator('.chart-stage .cvd-tooltip'),dot=panel.locator('.chart-stage .cvd-hover-dot'),controls=panel.locator('.pane-indicator-host .cvd-controls');
  await page.mouse.move(first!.x,first!.y);await page.waitForTimeout(280);await expect(card).toBeHidden();await expect(dot).toBeHidden();
  await page.waitForTimeout(260);await expect(card).toBeVisible();await expect(dot).toBeVisible();
  await expect(card.locator('.positioning-tooltip-sources + small')).toHaveText('Available history complete');
  const firstDot=await dot.boundingBox();expect(firstDot).toBeTruthy();
  expect(Math.abs(firstDot!.x+firstDot!.width/2-first!.x)).toBeLessThan(3);
  expect(Math.abs(firstDot!.y+firstDot!.height/2-first!.y)).toBeLessThan(3);
  expect(await dot.getAttribute('data-line-id')).toBe('total');
  expect(Math.abs(Number(await dot.getAttribute('data-hover-time'))-first!.time)).toBeLessThan(1);
  expect(await card.locator('[data-hovered="true"]').getAttribute('data-line-id')).toBe('total');
  expect(await card.locator('.positioning-tooltip-value').first().evaluate(element=>getComputedStyle(element).color))
    .toBe(await card.evaluate(element=>getComputedStyle(element).color));

  await page.mouse.move(second!.x,second!.y);await expect.poll(async()=>Math.abs(Number(await dot.getAttribute('data-hover-time'))-second!.time)<1).toBe(true);
  await page.waitForTimeout(150);const secondDot=await dot.boundingBox();expect(secondDot).toBeTruthy();
  expect(Math.abs(secondDot!.x+secondDot!.width/2-second!.x)).toBeLessThan(3);
  expect(Math.abs(secondDot!.y+secondDot!.height/2-second!.y)).toBeLessThan(3);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await dot.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');
  expect(await card.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');
  const rehost=await page.evaluate(()=>{
    const view=[...(window as any).__terminal.panels.values()][0].cvdView,chart=view.chart,home=view.paneControlHome,control=view.paneControlElement(),original=view.paneIndex();
    view.moveToPaneIndex(chart.panes().length);const moved=control.parentElement===view.paneElement();
    view.setPaneControlHost(home);const reattached=control.parentElement===home;
    view.moveToPaneIndex(original);view.setPaneControlHost(home);
    return {moved,reattached,restored:control.parentElement===home,pane:view.paneIndex()};
  });
  expect(rehost).toMatchObject({moved:true,reattached:true,restored:true});
  expect(rehost.pane).toBe((await state(page)).paneIndex);

  // A settings update hides the hovered line and immediately cancels its card.
  await controls.locator('.cvd-legend [data-line="total"]').click();
  await expect(card).toBeHidden();await expect(dot).toBeHidden();
  // Leave only the Spot line visible so neither total nor Perpetual can mask its missing samples.
  await controls.locator('.cvd-legend [data-line="binance:perpetual"]').click();
  await page.evaluate(({from})=>{
    const terminal=(window as any).__terminal,to=from+11*60_000;
    for(const [source,start,step]of [['binance:spot',100,11],['binance:perpetual',500,7]]as const){
      const buckets=Array.from({length:11},(_,index)=>{
        if(index===5||(source==='binance:spot'&&index===3))return undefined;
        return {time:from+index*60_000,base:start+index*step,quote:(start+index*step)*(1000+index),revision:201};
      }).filter(Boolean);
      const gaps=[{from:from+3*60_000,to:from+4*60_000},{from:from+5*60_000,to:from+6*60_000}];
      terminal.feed.send({type:'cvd-fixture',source,payload:{version:1,source:source+':BTCUSDT',stepMs:60_000,from,to,revision:201,snapshot:true,watermark:701,baseUnit:'BTC',quoteUnit:'USDT',buckets,coverage:{from,to,gaps},status:'live',asOf:to}});
    }
  },{from});
  await expect.poll(()=>page.evaluate(({from})=>{
    const view=[...(window as any).__terminal.panels.values()][0].cvdView,points=view.model.lines.get('binance:spot')?.points??[];
    return points.find((point:any)=>point.time===from+4*60_000)?.value===null&&points.find((point:any)=>point.time===from+6*60_000)?.value===null;
  },{from})).toBe(true);
  for(const minute of [3,5]){
    const noSegment=await page.evaluate(({from,minute})=>{
      const panel=[...(window as any).__terminal.panels.values()][0],view=panel.cvdView,chart=view.chart,stage=panel.element.querySelector('.chart-stage').getBoundingClientRect(),plot=chart.plotRect(view.paneIndex());
      const points=view.model.lines.get('binance:spot').points,time=from+minute*60_000+30_000;
      let before,after;for(const point of points){if(point.time<time&&point.value!=null)before=point;if(point.time>time&&point.value!=null){after=point;break;}}
      const x=chart.timeScale.indexToX(chart.dataLayer.timeToIndexFloat(time/1000));
      const y=plot.top+view.anchor.priceScale().priceToY(before&&after?(before.value+after.value)/2:0);
      return {x:stage.left+plot.left+x,y:stage.top+y,inside:x>=24&&x<=plot.width-24&&y>=plot.top&&y<=plot.top+plot.height};
    },{from,minute});
    expect(noSegment.inside).toBe(true);
    await page.mouse.move(0,0);await page.mouse.move(noSegment.x,noSegment.y,{steps:2});await page.waitForTimeout(550);
    await expect(card).toBeHidden();await expect(dot).toBeHidden();
  }
  await panel.getByRole('button',{name:'Remove Multi-Venue CVD',exact:true}).click();
  await expect(pane).toHaveCount(0);await expect(card).toHaveCount(0);await expect(dot).toHaveCount(0);
});

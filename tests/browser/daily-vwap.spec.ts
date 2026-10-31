import { test, expect } from '@playwright/test';
import { addIndicator, chooseChartMarket } from './indicator-actions';

test('Daily VWAP renders blue/green daily segments, updates correctly and persists native controls', async ({page}) => {
  test.setTimeout(90_000);
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1366,height:768});
  await page.addInitScript(()=>{
    const state=window as any; state.__vwapPaint=[]; state.__vwapMessages=[]; state.__vwapText=[];
    const stroke=CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke=function(...args:any[]){
      if(this.strokeStyle==='#2962ff'||this.strokeStyle==='#4b9b38')state.__vwapPaint.push({color:this.strokeStyle,width:this.lineWidth,alpha:this.globalAlpha});
      return (stroke as any).apply(this,args);
    };
    const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(value:any,...args:any[]){if(value==='ABV'||value==='BLW')state.__vwapText.push(value);return(fillText as any).call(this,value,...args);};
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message:any,transfer?:any){state.__vwapMessages.push(message.type);return post.call(this,message,transfer);};
  });
  await page.goto('/?fixture=1&fixtureTime=now');
  const closeCharts=page.getByRole('button',{name:/^Close /});
  if(await closeCharts.count()>1)await closeCharts.nth(1).click();
  const panel=page.locator('.candle-panel').first();
  const collapse=panel.locator('.chart-objects-panel').getByRole('button',{name:'Close Object Tree',exact:true});
  if(await collapse.isVisible())await collapse.click();
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.series.getData().length)).toBe(5000);
  const before=await page.evaluate(()=>(window as any).__vwapMessages.filter((m:string)=>m==='subscribe').length);
  await addIndicator(panel,'Daily VWAP');
  const row=panel.locator('.active-indicator[data-definition-id="native.daily-vwap"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('UTC 00:00');
  const diagnostics=()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.dailyVwapDiagnostics());
  await expect.poll(async()=>(await diagnostics()).settings).toMatchObject({readout:true,secondDeviation:false,thirdDeviation:false});
  await expect.poll(async()=>(await diagnostics()).segments).toBeGreaterThan(0);
  await expect.poll(async()=>(await diagnostics()).readoutGeometry).not.toBeNull();
  await expect.poll(()=>page.evaluate(()=>(window as any).__vwapText.includes('ABV')&&(window as any).__vwapText.includes('BLW'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).__vwapPaint.some((p:any)=>p.color==='#2962ff'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).__vwapPaint.some((p:any)=>p.color==='#4b9b38'))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const p=[...(window as any).__terminal.panels.values()][0], latest=p.engine.dailyVwapDiagnostics().latest;
    const range=p.engine.series.priceScale().priceRange();
    return latest.value>=range.min && latest.value<=range.max;
  })).toBe(true);
  for(const theme of ['dark','light']as const){
    await page.getByLabel('Theme',{exact:true}).selectOption(theme);
    await expect.poll(()=>panel.evaluate(element=>getComputedStyle(element).getPropertyValue('--chart').trim())).toBe(theme==='dark'?'#090909':'#f6f4ee');
    await panel.screenshot({path:`/tmp/daily-vwap-${theme}.png`});
  }
  await page.setViewportSize({width:720,height:860});
  for(const theme of ['dark','light']as const){
    await page.getByLabel('Theme',{exact:true}).selectOption(theme);
    await expect.poll(()=>panel.evaluate(element=>getComputedStyle(element).getPropertyValue('--chart').trim())).toBe(theme==='dark'?'#090909':'#f6f4ee');
    await expect.poll(async()=>{
      const geometry=(await diagnostics()).readoutGeometry;
      if(!geometry||geometry.x<0||geometry.y<0||geometry.x+geometry.width>geometry.plotWidth||geometry.y+geometry.height>geometry.plotHeight)return false;
      const rightOfEnd=geometry.x>geometry.lineX+2;
      const clearOfTail=geometry.y+geometry.height<=geometry.curveMinY||geometry.y>=geometry.curveMaxY;
      return rightOfEnd||clearOfTail;
    }).toBe(true);
    await panel.screenshot({path:`/tmp/daily-vwap-${theme}-narrow.png`});
  }
  await page.setViewportSize({width:1366,height:768});
  await panel.getByRole('button',{name:'Daily VWAP settings',exact:true}).click();
  const dialog=panel.getByRole('dialog',{name:'Daily VWAP settings'});
  await expect(dialog).toContainText('00:00 UTC');
  await expect(dialog.getByLabel('Show time above/below readout',{exact:true})).toBeChecked();
  await expect(dialog.getByLabel('Show second deviation zone (±2×)',{exact:true})).not.toBeChecked();
  await expect(dialog.getByLabel('Show third deviation zone (±3×)',{exact:true})).not.toBeChecked();
  await dialog.getByLabel('Show second deviation zone (±2×)',{exact:true}).check();
  await dialog.getByLabel('Show third deviation zone (±3×)',{exact:true}).check();
  await dialog.getByLabel('Band multiplier (standard deviations)',{exact:true}).fill('2');
  await dialog.getByLabel('Band fill opacity',{exact:true}).fill('.08');
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).settings).toMatchObject({multiplier:2,secondDeviation:true,thirdDeviation:true,readout:true});
  await panel.getByRole('button',{name:'Hide Daily VWAP',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).mounted).toBe(false);
  await panel.getByRole('button',{name:'Show Daily VWAP',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).points).toBe(5000);
  expect(await page.evaluate(()=>(window as any).__vwapMessages.filter((m:string)=>m==='subscribe').length)).toBe(before);
  await expect.poll(()=>page.evaluate(()=>{
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return (Object.values(saved.layout.panels)as any[]).find(p=>p.contentComponent==='candle').params.indicators.find((i:any)=>i.definitionId==='native.daily-vwap')?.settings;
  })).toMatchObject({multiplier:2,secondDeviation:true,thirdDeviation:true,readout:true});
  await page.reload();
  await expect.poll(async()=>(await diagnostics()).settings).toMatchObject({multiplier:2,secondDeviation:true,thirdDeviation:true,readout:true});
  // Explicit fixture-only deterministic engine inputs exercise forming replacements and day reset.
  const controlled=await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0];p.release?.();p.release=undefined;
    const day=Math.floor(Date.now()/86400000)*86400000;
    const candle=(t:number,price:number,v:number)=>({t,o:price,h:price,l:price,c:price,v,closed:false});
    p.engine.setSnapshot([candle(day,100,1),candle(day+60000,110,3)],false);
    const initial=p.engine.dailyVwapDiagnostics().latest;
    p.engine.applyPatch([candle(day+60000,120,5)]);
    const replaced=p.engine.dailyVwapDiagnostics().latest;
    p.engine.applyPatch([candle(day+86400000,200,2)]);
    return {initial,replaced,reset:p.engine.dailyVwapDiagnostics().latest};
  });
  expect(controlled.initial.value).toBe(107.5);
  expect(controlled.replaced.value).toBeCloseTo(700/6);
  expect(controlled.reset).toMatchObject({value:200,deviation:0,breakBefore:true});
  // Source changes rebind the same overlay and never leave old-price contributions behind.
  await chooseChartMarket(panel,'Hyperliquid · BTC Perp');
  await expect.poll(async()=>(await diagnostics()).points).toBe(5000);
  await expect(row).not.toContainText('Unavailable');
  await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m');
  await expect.poll(async()=>(await diagnostics()).intervalSeconds).toBe(300);
  await expect.poll(async()=>(await diagnostics()).points).toBe(5000);
  await expect.poll(async()=>(await diagnostics()).latest.partial).toBe(false);
  const dailyGuard=await page.evaluate(()=>{
    const e=[...(window as any).__terminal.panels.values()][0].engine, settings=e.dailyVwapDiagnostics().settings;
    e.setDailyVwap(settings,86400);const points=e.dailyVwapDiagnostics().points;e.setDailyVwap(settings,300);return points;
  });
  expect(dailyGuard).toBe(0);
  await panel.getByLabel('Timeframe',{exact:true}).selectOption('1m');
  await expect.poll(async()=>(await diagnostics()).points).toBe(5000);
  await panel.getByRole('button',{name:'Remove Daily VWAP',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).mounted).toBe(false);
  expect(errors).toEqual([]);
});

test('naked daily VWAP gaps reach the axis, toggle persistently and clear on a wick touch', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  const panel=page.locator('.candle-panel').first();
  await expect.poll(()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.series.getData().length)).toBe(5000);
  await addIndicator(panel,'Daily VWAP');
  const diagnostics=()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].engine.dailyVwapDiagnostics());
  await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0];p.release?.();p.release=undefined;
    const day=Math.floor(Date.now()/86400000)*86400000-2*86400000;
    const bars=Array.from({length:2882},(_,i)=>{
      const price=i<1440?100:i<2880?120:140;
      return {t:day+i*60000,o:price,h:price,l:price,c:price,v:1,closed:true};
    });
    p.engine.setSnapshot(bars,false);
    p.engine.chart.setVisibleLogicalRange({from:1400,to:2950});
  });
  await expect.poll(async()=>(await diagnostics()).nakedGaps?.map((g:any)=>g.value)).toEqual([100,120]);
  await expect.poll(async()=>(await diagnostics()).gapGeometry?.length).toBe(2);
  const geometry=(await diagnostics()).gapGeometry;
  expect(geometry.every((g:any)=>g.fromX>=0&&g.fromX<g.toX&&g.y>0)).toBe(true);
  expect(geometry.map((g:any)=>g.fromX).some((x:number)=>x>0)).toBe(true);
  for(const theme of ['dark','light']as const){
    await page.getByLabel('Theme',{exact:true}).selectOption(theme);
    await panel.screenshot({path:`/tmp/daily-vwap-gaps-${theme}.png`});
  }
  await panel.getByRole('button',{name:'Daily VWAP settings',exact:true}).click();
  const dialog=panel.getByRole('dialog',{name:'Daily VWAP settings'});
  const toggle=dialog.getByLabel('Show naked previous VWAP gaps',{exact:true});
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).gapGeometry?.length).toBe(0);
  await expect.poll(()=>page.evaluate(()=>{
    const saved=JSON.parse(localStorage.getItem('basis.layout.v1')!);
    return (Object.values(saved.layout.panels)as any[]).find(p=>p.contentComponent==='candle').params.indicators.find((i:any)=>i.definitionId==='native.daily-vwap')?.settings.nakedGaps;
  })).toBe(false);
  await panel.getByRole('button',{name:'Daily VWAP settings',exact:true}).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await diagnostics()).gapGeometry?.length).toBe(2);
  await page.evaluate(()=>{
    const e=[...(window as any).__terminal.panels.values()][0].engine;
    const last=e.series.getData().at(-1);
    e.applyPatch([{t:last.time*1000,o:140,h:140,l:120,c:140,v:1,closed:false}]);
  });
  await expect.poll(async()=>(await diagnostics()).nakedGaps?.map((g:any)=>g.value)).toEqual([100]);
  await expect.poll(async()=>(await diagnostics()).gapGeometry?.length).toBe(1);
  expect(errors).toEqual([]);
});

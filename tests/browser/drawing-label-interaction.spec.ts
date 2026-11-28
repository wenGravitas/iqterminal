import {test,expect} from '@playwright/test';

test.use({storageState:{cookies:[],origins:[]},deviceScaleFactor:process.env.DRAWING_LABEL_DPR==='2'?2:1});

test('offscreen positioning labels select, multi-select, open properties and delete through native drawing actions',async({page})=>{
  test.setTimeout(60000);
  await page.addInitScript(()=>{
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text:string,x:number,y:number,maxWidth?:number){
      if(/^BN\[P\] (413\.096|156) BTC$/.test(String(text))){
        const box=this.canvas.getBoundingClientRect(),t=this.getTransform(),sx=this.canvas.width/box.width,sy=this.canvas.height/box.height;
        ((window as any).__drawingLabels??={})[text]={x:box.left+(t.a*x+t.c*y+t.e+this.measureText(text).width*.4)/sx,y:box.top+(t.b*x+t.d*y+t.f)/sy};
      }
      if(maxWidth===undefined)original.call(this,text,x,y);else original.call(this,text,x,y,maxWidth);
    };
  });
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(()=>(window as any).__terminal?.stats().panels[0]?.bars>0);
  const ids=await page.evaluate(()=>{
    const p=[...(window as any).__terminal.panels.values()][0] as any,chart=p.engine.chart,draw=p.engine.drawings;
    const range=chart.getVisibleLogicalRange(),time=chart.dataLayer.indexToTimeFloat((range.from+range.to)/2),price=p.engine.series.getData().at(-1).close;
    return [413.096,156].map((amount,index)=>draw.add({tool:'rectangle',paneIndex:chart.primaryPaneIndex(),points:[{time,price:price*(index?.1:2)},{time:time+120,price:price*(index?.11:2.01)}],style:{color:'#00cccc',extendRight:true},text:{value:'BN[P] · Net Longs · candle VA 70% (proxy)',fontSize:10},props:{iqterminal:{version:1},iqterminalLabelState:'custom',iqterminalLabel:'BN[P] · Net Longs · candle VA 70% (proxy)',positioningRange:{venue:'binance',side:'longs',baseAmount:amount,quoteAmount:amount*price}}}).id);
  });
  await page.waitForFunction(()=>(window as any).__drawingLabels?.['BN[P] 413.096 BTC']&&(window as any).__drawingLabels?.['BN[P] 156 BTC']);
  const positions=await page.evaluate(()=>(window as any).__drawingLabels);
  const selection=()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.selection());
  const first=positions['BN[P] 413.096 BTC'],second=positions['BN[P] 156 BTC'];
  await page.mouse.click(first.x,first.y);await expect.poll(selection).toEqual([ids[0]]);
  await page.keyboard.down('Shift');await page.mouse.click(second.x,second.y);await page.keyboard.up('Shift');
  await expect.poll(selection).toEqual(ids);
  await page.locator('.candle-panel').first().getByRole('button',{name:'Delete selected drawings',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.drawings().length)).toBe(0);
  await page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.undo());
  await page.mouse.move(first.x,first.y);await page.mouse.dblclick(first.x,first.y);
  const dialog=page.getByRole('dialog',{name:'Drawing settings',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.mouse.click(first.x,first.y,{button:'right'});
  const menu=page.getByRole('menu',{name:'Drawing actions',exact:true});await expect(menu).toBeVisible();
  await page.screenshot({path:'/tmp/drawing-label-actions.png'});
  await menu.getByRole('menuitem',{name:'Settings',exact:true}).click();await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.mouse.click(first.x,first.y,{button:'right'});await menu.getByRole('menuitem',{name:'Delete',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>([...(window as any).__terminal.panels.values()][0] as any).engine.drawings.drawings().length)).toBe(1);
});

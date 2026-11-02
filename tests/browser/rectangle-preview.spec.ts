import {test,expect} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
for(const dpr of [1,2]) test.describe(`rectangle preview DPR ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  test('shows the held drag, commits one undo step and retains click placement previews',async({page})=>{
    await page.addInitScript(()=>{const original=CanvasRenderingContext2D.prototype.strokeRect;(window as any).__rectangles=[];CanvasRenderingContext2D.prototype.strokeRect=function(x,y,width,height){if(Math.abs(width)>80&&Math.abs(height)>60)(window as any).__rectangles.push({x,y,width,height});return original.call(this,x,y,width,height);};});
    await page.goto('/?fixture=1');await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);const panel=page.locator('.candle-panel').first(),stage=panel.locator('.chart-stage'),box=(await stage.boundingBox())!;
    const tool=async()=>panel.locator('.drawing-sidebar-primary[data-drawing-tool="rectangle"]').click();
    const state=()=>page.evaluate(()=>{const e=[...(window as any).__terminal.panels.values()][0].engine;return{count:e.drawings.drawings().length,undo:e.drawings.canUndo(),preview:e.rectangleDragPreview.active};});
    await tool();await page.mouse.move(box.x+250,box.y+140);await page.mouse.down();await page.mouse.move(box.x+550,box.y+320,{steps:8});await expect.poll(async()=>(await state()).preview).toBe(true);await expect.poll(()=>page.evaluate(()=>(window as any).__rectangles.length)).toBeGreaterThan(0);expect(await state()).toEqual({count:0,undo:false,preview:true});expect(await page.evaluate(()=>{try{[...(window as any).__terminal.panels.values()][0].engine.captureJournalImage();return false;}catch{return true;}})).toBe(true);
    await stage.screenshot({path:`artifacts/rectangle-drag-preview-dpr${dpr}.png`});await page.mouse.up();await expect.poll(async()=>(await state()).count).toBe(1);expect((await state()).preview).toBe(false);await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await state()).count).toBe(0);expect((await state()).undo).toBe(false);
    await tool();await stage.click({position:{x:250,y:140}});await page.evaluate(()=>(window as any).__rectangles=[]);await stage.hover({position:{x:550,y:320}});await expect.poll(()=>page.evaluate(()=>(window as any).__rectangles.length)).toBeGreaterThan(0);expect((await state()).preview).toBe(false);await page.keyboard.press('Escape');expect((await state()).count).toBe(0);
    await tool();await page.mouse.move(box.x+250,box.y+140);await page.mouse.down();await page.mouse.move(box.x+550,box.y+320,{steps:4});await expect.poll(async()=>(await state()).preview).toBe(true);await page.keyboard.press('Escape');await page.mouse.up();expect(await state()).toEqual({count:0,undo:false,preview:false});
  });
});

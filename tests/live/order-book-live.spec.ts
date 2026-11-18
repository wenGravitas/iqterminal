import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {addWidget} from '../browser/footer-actions';
const state=()=> (window as any).__terminal.dock.panels.filter((p:any)=>p.view.contentComponent==='order-book').map((p:any)=>p.view.content.diagnostics());
test('isolated candidate renders current committed Spot and Perp heads; headless Pi diagnostics only',async({page,context})=>{
 const requests:string[]=[];context.on('request',r=>{if(r.url().includes('/v1/depth-matrix?'))requests.push(r.url());});
 await page.addInitScript(()=>{(window as any).__longTasks=[];(window as any).__commands=[];new PerformanceObserver(list=>{(window as any).__longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({entryTypes:['longtask']});const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message:any,...rest:any[]){if(message?.type?.startsWith('depth-matrix'))(window as any).__commands.push(message);return (post as any).call(this,message,...rest);};});
 const started=Date.now();await page.goto('/');const panel=page.locator('.depth-matrix-panel');
 await expect.poll(async()=>{const s=await page.evaluate(state).catch(()=>[]);return s[0]?.columns.filter((c:any)=>c.state==='live').length;},{timeout:30000}).toBe(2);
 await expect(panel.locator('.order-book-compact-head')).toContainText('USDT/full width');
 const initialUsableMs=Date.now()-started;
 const instrument=async()=>page.evaluate(()=>{for(const entry of (window as any).__terminal.dock.panels.filter((p:any)=>p.view.contentComponent==='order-book')){const p=entry.view.content;if(p.__phases)continue;p.__phases={render:[],canvas:[]};for(const [key,method] of [['render','render'],['canvas','drawCanvases']]){const original=p[method];p[method]=function(...args:any[]){const start=performance.now();try{return original.apply(this,args);}finally{p.__phases[key].push(performance.now()-start);}};}}});
 await instrument();
 const samples:any[]=[];const sample=async()=>samples.push(await page.evaluate(()=>({at:Date.now(),heap:(performance as any).memory?.usedJSHeapSize,books:(window as any).__terminal.dock.panels.filter((p:any)=>p.view.contentComponent==='order-book').map((p:any)=>({...p.view.content.diagnostics(),phases:p.view.content.__phases,visibleRows:p.view.content.rowLayout.visible(p.view.content.scroll.scrollTop-24,p.view.content.scroll.scrollTop+p.view.content.scroll.clientHeight-24).reduce((n:number,x:number,i:number)=>i?x-n:x,0)}))})));
 await sample();await page.waitForTimeout(3000);await sample();
 const commands=await page.evaluate(()=>(window as any).__commands.length);
 for(let i=0;i<8;i++){await panel.getByLabel('Show',{exact:true}).selectOption(i%2?'both':'levels');await page.waitForTimeout(50);}
 expect(await page.evaluate(()=>(window as any).__commands.length)).toBe(commands);
 await sample();await addWidget(page,'Order Book');const panels=page.locator('.depth-matrix-panel');await panels.nth(1).getByLabel('Mode',{exact:true}).selectOption('single');
 await expect.poll(async()=> (await page.evaluate(state)).every((p:any)=>p.columns.filter((c:any)=>c.state==='live').length===2),{timeout:30000}).toBe(true);
 await instrument();await page.waitForTimeout(6000);await sample();await page.waitForTimeout(6000);await sample();
 const final=await page.evaluate(()=>({longTasks:(window as any).__longTasks,commands:(window as any).__commands}));
 const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??null;};
 writeFileSync('artifacts/order-book/live-headless-pi.json',JSON.stringify({evidence:'Live committed-source candidate on actual Pi 5, headless browser; NOT foreground/compositor acceptance',initialUsableMs,requests:requests.length,uniqueRequestGrids:new Set(requests).size,redrawOnlyCommands:0,samples:samples.map(s=>({...s,books:s.books.map((p:any)=>({...p,paints:undefined,interactions:undefined,paintP95Ms:percentile(p.paints,.95),steadyRenderP95Ms:percentile(p.phases?.render??[],.95),steadyCanvasP95Ms:percentile(p.phases?.canvas??[],.95),inputToRenderCompletionP95Ms:percentile(p.interactions,.95)}))})),longTasks:final.longTasks,commands:final.commands.map((c:any)=>c.type)},null,2));
});

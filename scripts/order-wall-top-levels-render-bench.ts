/** Explicit fixture browser measurement on this host; no live connectivity claims. */
import {createRequire} from 'node:module';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import os from 'node:os';
import {topLevelsFixture} from '../tests/fixtures/top-levels-depth';
const {chromium}=createRequire(resolve('package.json'))('@playwright/test');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
const started=performance.now();
try{
 await page.goto((process.env.TOP_BENCH_URL??'http://127.0.0.1:5173/')+'?fixture=1&fixtureTime=now');
 await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars>0));
 const input=await page.evaluate(()=>{const t=(window as any).__terminal,[p]=t.panels.values();for(const panel of [...t.dock.panels])if(panel.id!==p.params.api.id)t.dock.removePanel(panel);
  const e=p.engine,bar=e.latestCandle();return {id:p.params.api.id,center:Math.round(bar.close/100)*100,to:bar.time*1000};});
 const generatedAt=performance.now(),fixture=topLevelsFixture(input.center,input.to),generateMs=performance.now()-generatedAt;
 fixture.settings.showPriceLines=process.env.TOP_BENCH_TAGS==='1';
 const profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
 const result=await page.evaluate(async({input,fixture}:any)=>{
  const t=(window as any).__terminal,e=t.panels.get(input.id).engine,chart=e.chart,base=chart.dataLayer.baseIndex;
  e.setRange({from:base-240,to:base+2});chart.setAutoScale(false);chart.panes()[0].priceScale.setPriceRange({min:input.center-510,max:input.center+510});
  const frames:number[]=[];let previous=0,running=true;const framesTick=(at:number)=>{if(previous)frames.push(at-previous);previous=at;if(running)requestAnimationFrame(framesTick);};requestAnimationFrame(framesTick);
  e.setOrderWalls({...fixture.settings,enabled:false},60000);
  for(let i=0;i<60;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const idleBaseline=frames.splice(0);previous=0;
  let baselineHost:any;
  const baselinePrimitive={attached(host:any){baselineHost=host;},draw(){},zOrder(){return 'normal';}};
  chart.addPrimitive(baselinePrimitive,{anchor:'primary-pane'});
  const baselinePointer:number[]=[];
  for(let i=1;i<=90;i++){
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));baselineHost.requestUpdate();
    if(i%10===0){const at=performance.now();document.querySelector('.candle-panel canvas')?.dispatchEvent(new PointerEvent('pointermove',{clientX:400+i,clientY:300,bubbles:true,pointerType:'mouse'}));await new Promise<void>(resolve=>requestAnimationFrame(()=>{baselinePointer.push(performance.now()-at);resolve();}));}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  chart.removePrimitive(baselinePrimitive);
  const baseline=frames.splice(0);previous=0;const attachAt=performance.now();e.setOrderWalls(fixture.settings,60000);e.setOrderWallSnapshot(fixture.segments,fixture.status);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));const coldAttachMs=performance.now()-attachAt;
  const initial=e.orderWallsDiagnostics(),drawsBefore=initial.draws,projectsBefore=initial.patchProjects;
  const applicationMs:number[]=[],pointerToRaf:number[]=[],retained=[...e.orderWallSegments.values()].filter((s:any)=>s.end===null);
  for(let i=1;i<=90;i++){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   const at=fixture.to+i*100,patches=retained.map((s:any,j:number)=>({id:s.id,segment:{...s,durationMs:at-s.start,valueRuns:[]},valuePoints:[{at,usd:s.valueRuns.at(-1).usd*(1+.01*Math.sin(i+j)),percentile:null,rank:s.rank,quantity:s.valueRuns.at(-1).quantity*(1+.01*Math.sin(i+j))}]}));
   const begin=performance.now();e.patchOrderWalls(patches,{...fixture.status,lastConfirmedAt:at});applicationMs.push(performance.now()-begin);
   if(i%10===0){const pointerAt=performance.now();const canvas=document.querySelector('.candle-panel canvas');canvas?.dispatchEvent(new PointerEvent('pointermove',{clientX:400+i,clientY:300,bubbles:true,pointerType:'mouse'}));await new Promise<void>(resolve=>requestAnimationFrame(()=>{pointerToRaf.push(performance.now()-pointerAt);resolve();}));}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  running=false;return {idleBaselineRafIntervals:idleBaseline,baselineRafIntervals:baseline,baselinePointerToRaf:baselinePointer,overlayRafIntervals:frames,applicationMs,pointerToRaf,coldAttachMs,initial,final:e.orderWallsDiagnostics(),drawsDelta:e.orderWallsDiagnostics().draws-drawsBefore,patchProjectsDelta:e.orderWallsDiagnostics().patchProjects-projectsBefore,chartBars:e.barCount};
 },{input,fixture:{...fixture,rows:undefined}});
 const profile=(await profiler.send('Profiler.stop')).profile;await profiler.detach();
 const p=(a:number[],q:number)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*q)]??0;
 const output={priceTags:fixture.settings.showPriceLines,kind:'synthetic-real-browser-software-renderer-not-live-fps-acceptance',hardware:{model:readFileSync('/proc/device-tree/model','utf8').replaceAll('\0',''),arch:os.arch(),load:os.loadavg()},elapsedMs:performance.now()-started,generateMs,result,summary:{idleBaselineRafP95:p(result.idleBaselineRafIntervals,.95),baselinePointerP95:p(result.baselinePointerToRaf,.95),baselineRafP95:p(result.baselineRafIntervals,.95),overlayRafP95:p(result.overlayRafIntervals,.95),applicationP95:p(result.applicationMs,.95),pointerToRafP95:p(result.pointerToRaf,.95)},errors};
 mkdirSync('artifacts/order-walls',{recursive:true});writeFileSync(fixture.settings.showPriceLines?'artifacts/order-walls/top-levels-render-tags.cpuprofile':'artifacts/order-walls/top-levels-render.cpuprofile',JSON.stringify(profile));writeFileSync(fixture.settings.showPriceLines?'artifacts/order-walls/top-levels-render-tags-bench.json':'artifacts/order-walls/top-levels-render-bench.json',JSON.stringify(output,null,2)+'\n');await page.screenshot({path:'artifacts/order-walls/top-levels-render-bench.png'});console.log(JSON.stringify({...output,result:{...result,baselineRafIntervals:undefined,overlayRafIntervals:undefined,applicationMs:undefined,pointerToRaf:undefined}},null,2));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}

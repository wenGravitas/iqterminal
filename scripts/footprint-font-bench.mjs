/** Explicit offline actual-Pi Canvas comparison. No API, exchange or fixtures
 * in the product. Captured canonical source is replayed only in this harness. */
import assert from 'node:assert/strict';import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {chromium} from './test-browser-launch.mjs';
assert.equal(process.env.IQ_FOOT_FONT_BENCH,'1','Explicit offline font comparison opt-in required');
const output=resolve(process.argv[2]);await mkdir(output);const temp=await mkdtemp(join(tmpdir(),'iq-foot-font-'));let browser;
try{
 const controlRef=process.env.IQ_FOOT_FONT_CONTROL??'8aaab36a2e4c305633877de7438f6b0883f5b4c1',candidatePath=resolve(process.env.IQ_FOOT_FONT_CANDIDATE??'src/chart/terminal-footprint.ts');
 const control=execFileSync('git',['show',controlRef+':src/chart/terminal-footprint.ts'],{encoding:'utf8'}),candidate=await readFile(candidatePath,'utf8');assert.notEqual(control,candidate,'Select an experimental candidate explicitly; the rejected trial is no longer product source');
 await writeFile(join(temp,'candidate.ts'),candidate);
 await writeFile(join(temp,'control.ts'),control);await writeFile(join(output,'control.ts'),control);await writeFile(join(output,'candidate.ts'),candidate);await writeFile(join(output,'executed.mjs'),await readFile(new URL(import.meta.url)));
 const entry=join(temp,'entry.ts');await writeFile(entry,`export {TerminalFootprint as Control} from './control';export {TerminalFootprint as Candidate} from './candidate';export {DEFAULT_FOOTPRINT_OPTIONS} from 'openalgo-charts/profile';export {footprintForUnits} from ${JSON.stringify(resolve('src/chart/footprint-units.ts'))};`);
 const config=join(temp,'vite.config.mjs');await writeFile(config,`export default {logLevel:'error',resolve:{alias:[{find:'openalgo-charts/profile',replacement:${JSON.stringify(resolve('node_modules/openalgo-charts/dist/openalgo-charts.profile.mjs'))}}]},build:{lib:{entry:${JSON.stringify(entry)},name:'FontComparison',formats:['iife'],fileName:()=> 'comparison.js'},outDir:${JSON.stringify(join(temp,'bundle'))},minify:false,sourcemap:true}}`);
 const built=spawnSync(resolve('node_modules/.bin/vite'),['build','--config',config],{encoding:'utf8'});await writeFile(join(output,'compile.txt'),(built.stdout??'')+(built.stderr??''));assert.equal(built.status,0);
 const bundle=await readFile(join(temp,'bundle/comparison.js'),'utf8');await writeFile(join(output,'comparison.js'),bundle);await writeFile(join(output,'comparison.js.map'),await readFile(join(temp,'bundle/comparison.js.map')));
 const source='artifacts/pi-history-r1/current-continuity-r1',bars={};for(const [kind,files] of [['hour',['source-1h-1794139200000.json','source-1h-1794153600000.json','source-1h-1794168000000.json','source-1h-1794182400000.json','source-1h-1794196800000.json','source-1h-1794211200000.json']],['five',['source-5m-1794211200000.json']]]){bars[kind]=[];for(const file of files){const data=JSON.parse(await readFile(join(source,file),'utf8'));assert.equal(data.state,'ready');assert.equal(data.missing.length,0);bars[kind].push(...data.tiles.map(t=>t.bar));}}
 await writeFile(join(output,'input.json'),JSON.stringify(bars));browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
 const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle});
 const result=await page.evaluate(async bars=>{
  const {Control,Candidate,footprintForUnits,DEFAULT_FOOTPRINT_OPTIONS:defaults}=window.FontComparison,results=[];
  for(const kind of ['hour','five'])for(const cellStyle of ['ladder','profile'])for(const dpr of [1,2])for(const units of ['btc','usdt']){
   const input=bars[kind].map(b=>footprintForUnits(b,units)).map(b=>{if(!b)throw Error('Missing canonical quote fields');return {...b,cells:b.cells.map(c=>({...c,price:c.price+b.rowSize/2}))};}),wide=cellStyle==='ladder'&&dpr===2,selected=wide?input.slice(-3):input;
   const width=960,height=600,spacing=wide?240:width/(selected.length+1),min=Math.min(...selected.map(b=>b.low))-50,max=Math.max(...selected.map(b=>b.high))+50;
   const options={...defaults,font:9,widthFactor:.84,cellStyle,displayMode:'bidask',showCandle:true,showPoc:true,pocStyle:'outline',showValueArea:true,statsPosition:wide?'bar':'bottom',statsRows:['volume','delta'],tableRows:[]};
   const theme={background:dpr===2?'#f6f4ee':'#090909',axisText:dpr===2?'#202934':'#cccccc',upColor:'#58a65c',downColor:'#ad5858'};
   const timeIndex=new Map(selected.map((b,i)=>[b.time,i])),rc={dpr,plotWidth:width,plotHeight:height,theme,timeScale:{barSpacing:spacing,visibleRange:()=>({from:0,to:selected.length-1}),indexToX:i=>spacing*(i+.5)},priceScale:{priceRange:()=>({min,max}),priceToY:p=>height-(p-min)*height/(max-min)},dataLayer:{timeToIndex:t=>timeIndex.get(t)}};
   const observer=document.createElement('canvas');observer.width=width*dpr;observer.height=height*dpr;const readback=observer.getContext('2d',{willReadFrequently:true});
   const variants={};for(const [name,Type] of [['control',Control],['candidate',Candidate]]){const canvas=document.createElement('canvas');canvas.width=width*dpr;canvas.height=height*dpr;const ctx=canvas.getContext('2d'),primitive=new Type(options);primitive.setBars(structuredClone(selected));variants[name]={canvas,ctx,primitive};}
   function prepare(v){const c=v.ctx;c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.fillStyle=theme.background;c.fillRect(0,0,width*dpr,height*dpr);c.font='10px sans-serif';c.textAlign='left';c.textBaseline='alphabetic';}
   function draw(name){const v=variants[name];prepare(v);const at=performance.now();v.primitive.draw(v.ctx,rc);const drawMs=performance.now()-at,flush=performance.now(),pixels=(()=>{readback.drawImage(v.canvas,0,0);return readback.getImageData(0,0,width*dpr,height*dpr);})();return {drawMs,flushMs:performance.now()-flush,pixels};}
   const warmups={};for(const name of ['control','candidate']){const r=draw(name);warmups[name]={drawMs:r.drawMs,flushMs:r.flushMs};}
   const samples=[];for(let run=1;run<=5;run++){
    const pair={};for(const name of run%2?['control','candidate']:['candidate','control']){await new Promise(r=>setTimeout(r,0));pair[name]=draw(name);}
    const a=new Uint32Array(pair.control.pixels.data.buffer),b=new Uint32Array(pair.candidate.pixels.data.buffer);if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error('Pixel mismatch '+JSON.stringify({kind,cellStyle,dpr,run}));
    if(JSON.stringify(variants.control.primitive.stats())!==JSON.stringify(variants.candidate.primitive.stats()))throw Error('Financial stats mismatch');
    samples.push({run,control:{drawMs:pair.control.drawMs,flushMs:pair.control.flushMs},candidate:{drawMs:pair.candidate.drawMs,flushMs:pair.candidate.flushMs},exactPixels:true,exactStats:true});
   }
   const fontWrites={};const descriptor=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'font');for(const name of ['control','candidate']){const v=variants[name];let writes=0;Object.defineProperty(v.ctx,'font',{configurable:true,get(){return descriptor.get.call(this);},set(value){writes++;descriptor.set.call(this,value);}});prepare(v);writes=0;v.primitive.draw(v.ctx,rc);fontWrites[name]=writes;delete v.ctx.font;}
   results.push({kind,cellStyle,dpr,units,wide,bars:selected.length,cells:selected.reduce((n,b)=>n+b.cells.length,0),warmups,samples,fontWrites});
   observer.width=0;observer.height=0;
   for(const v of Object.values(variants)){v.primitive.detached();v.canvas.width=0;v.canvas.height=0;}
  }
  return results;
 },bars);
 await writeFile(join(output,'results.json'),JSON.stringify({scope:'Actual Pi headless Chromium Canvas2D, captured canonical source. Five alternating draw pairs per scene after separate warmups; exact RGBA pixels/stats. Primary contexts keep their default drawing backend; a separate willReadFrequently observer canvas reads pixels. Draw submission and observer copy/readback durations are separate, not FPS/history/current acceptance. Aggregate execution counts are not supplied as native individual-trade counts. Font-write counting is a separate untimed draw to avoid observer bias.',browser:browser.version(),controlCommit:execFileSync('git',['rev-parse',controlRef],{encoding:'utf8'}).trim(),candidatePath,controlSha256:createHash('sha256').update(control).digest('hex'),candidateSha256:createHash('sha256').update(candidate).digest('hex'),result},null,2)+'\n');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}

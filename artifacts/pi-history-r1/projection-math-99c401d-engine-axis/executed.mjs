/** Explicit offline captured-data CPU/geometry check. Not route, GPU-completion,
 * frame-rate or foreground Pi loading acceptance. Never opens a headed window. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {chromium} from './test-browser-launch.mjs';
if(process.env.IQ_WALL_PROJECTION_MATH!=='1')throw Error('Explicit offline projection benchmark opt-in required');
const label=process.env.IQ_PROJECTION_LABEL;assert.ok(label&&/^[a-zA-Z0-9_-]{1,80}$/.test(label));
const out=resolve('artifacts/pi-history-r1/projection-math-'+label);await mkdir(out,{recursive:false});
const baseline='563904d',candidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
execFileSync('git',['diff','--quiet','--','src']);
const temp=await mkdtemp(join(tmpdir(),'iq-wall-math-'));let browser;
try{
 const source=resolve('src/chart/order-walls.ts'),old=execFileSync('git',['show',baseline+':src/chart/order-walls.ts'],{encoding:'utf8'}).replace(/from\s+(['"])(\.[^'"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(resolve(dirname(source),path)));
 await writeFile(join(temp,'baseline.ts'),old);await writeFile(join(temp,'entry.ts'),`export {OrderWallsPrimitive as Baseline} from './baseline';export {OrderWallsPrimitive as Candidate} from ${JSON.stringify(source)};export {createChart} from ${JSON.stringify(fileURLToPath(import.meta.resolve('openalgo-charts')))};`);
 await build({configFile:false,logLevel:'error',build:{lib:{entry:join(temp,'entry.ts'),name:'ProjectionBench',formats:['iife'],fileName:()=> 'primitive.js'},outDir:join(temp,'bundle'),emptyOutDir:true,minify:false,sourcemap:true}});
 const bundle=await readFile(join(temp,'bundle/primitive.js'),'utf8');await writeFile(join(out,'primitive.js'),bundle);await writeFile(join(out,'primitive.js.map'),await readFile(join(temp,'bundle/primitive.js.map')));await writeFile(join(out,'executed.mjs'),await readFile(new URL(import.meta.url)));
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
 const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo');
 await writeFile(join(out,'environment.json'),JSON.stringify({baseline,candidate,browser:browser.version(),system,canvas:'Canvas2D willReadFrequently=true readback hint; no GPU backend inference',timeAxis:'Existing OpenAlgo DataLayer over an explicit1000-slot UTC grid fixture; captured wall data is exact'},null,2));
 const cases=[];
 for(const [market,input,step,expected] of [
  ['spot','artifacts/pi-history-r1/wall-presentation-cache-r1/input-spot',300000,'cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e'],
  ['perpetual','artifacts/pi-history-r1/compact-warm-r1/input-perpetual',900000,'de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6']]){
  const manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')),parts=[];
  for(const part of manifest.parts){const raw=gunzipSync(await readFile(join(input,part.hash+'.json.gz')),{maxOutputLength:4*1024*1024});assert.equal(createHash('sha256').update(raw).digest('hex'),part.hash);parts.push(JSON.parse(raw));}
  const segments=[...manifest.active.segments];for(const group of manifest.closed){const fragments=group.map(([part,row])=>parts[part][row]);segments.push({...fragments[0].segment,valueRuns:fragments.flatMap(row=>row.segment.valueRuns)});}
  segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price);const hash=createHash('sha256');for(const segment of segments)hash.update(JSON.stringify(segment));assert.equal(hash.digest('hex'),expected);
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('http://127.0.0.1/iq-projection-math',route=>route.fulfill({contentType:'text/html',body:'<canvas width="1600" height="1000"></canvas>'}));await page.goto('http://127.0.0.1/iq-projection-math');await page.addScriptTag({content:bundle});
  const results=await page.evaluate(async({segments,step})=>{
   const from=1793696400000,to=1793804400000,canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),enc=new TextEncoder();
   const host=document.createElement('div');document.body.append(host);const chart=ProjectionBench.createChart(host,{width:1600,height:1000}),DataLayer=chart.dataLayer.constructor;chart.destroy();host.remove();
   const dataLayer=new DataLayer(),series=dataLayer.createSeries();dataLayer.setSeriesData(series,Array.from({length:1000},(_,i)=>({time:(from+i*step)/1000,open:1,high:1,low:1,close:1})));
   const contextAttributes=ctx.getContextAttributes();
   const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const settings={enabled:true,mode:'top-levels',aggregation:'native',topLevels:8,searchRangePercent:10,minDurationMs:0,showHistory:true,opacity:.6,thicknessPx:2,colorMode:'heat',highContrast:true,visibleRangeOnly:true,strengthThickness:true,historyEpisodes:2000,showPriceLines:false};
   const status={state:'live',tickSize:.1,lastConfirmedAt:to,archive:{loadedThrough:to,presentationThrough:to}};
   const rc=(pan=0)=>({timeScale:{visibleRange:()=>({from:pan,to:(to-from)/step+pan}),indexToX:i=>(i-pan)/(to-from)*step*1600,xToIndex:x=>pan+x/1600*(to-from)/step},priceScale:{priceRange:()=>({min:75000,max:81000}),priceToY:p=>(81000-p)/6000*1000},dataLayer,plotWidth:1600,plotHeight:1000,dpr:1,theme:{background:'#000',axisText:'#aaa'}});
   const rows=[];
   for(let run=1;run<=5;run++)for(const variant of run%2?['Baseline','Candidate']:['Candidate','Baseline']){
    const primitive=new ProjectionBench[variant](settings,step),begin=performance.now();primitive.setSnapshot(segments,status);const snapshotMs=performance.now()-begin;
    const stages=[];
    for(const [stage,pan] of [['initial',0],['pan',6],['restore',0]]){
     ctx.clearRect(0,0,1600,1000);const started=performance.now();primitive.draw(ctx,rc(pan));const drawCallMs=performance.now()-started;
     // Readback/hashing is correctness work outside the timed synchronous draw.
     const geometry=[...primitive.drawable.values()].map(({segment,...line})=>({id:segment.id,...line}));
     stages.push({stage,drawCallMs,contextAttributes,diagnostics:primitive.diagnostics(),geometry:await digest(enc.encode(JSON.stringify(geometry))),pixels:await digest(ctx.getImageData(0,0,1600,1000).data)});
    }
    rows.push({run,variant,snapshotMs,stages});primitive.detached();
   }
   return rows;
  },{segments,step});
  await writeFile(join(out,market+'-samples.json'),JSON.stringify({market,baseline,candidate,results,errors},null,2));
  for(let run=1;run<=5;run++){const a=results.find(r=>r.run===run&&r.variant==='Baseline'),b=results.find(r=>r.run===run&&r.variant==='Candidate');for(let i=0;i<a.stages.length;i++){assert.equal(a.stages[i].geometry,b.stages[i].geometry,`${market}/${run}/${a.stages[i].stage} geometry`);assert.equal(a.stages[i].pixels,b.stages[i].pixels,`${market}/${run}/${a.stages[i].stage} pixels`);}}
  assert.deepEqual(errors,[]);cases.push({market,sourceToken:manifest.sourceToken,segments:segments.length,runs:segments.reduce((n,s)=>n+s.valueRuns.length,0),inputFinancialHash:expected,results,errors});await context.close();console.log(JSON.stringify({market,exactGeometryAndPixels:true,runs:results.length}));
 }
 const receipt={baseline:execFileSync('git',['rev-parse',baseline],{encoding:'utf8'}).trim(),candidate,browser:browser.version(),system,scope:'Offline captured canonical data on Pi; five alternating synchronous Canvas draw CPU samples per variant/market/stage. Readback/hashing is excluded. Canvas2D willReadFrequently=true readback hint; no raster backend inference. Real OpenAlgo DataLayer on a1000-slot explicit UTC time-axis fixture (constant OHLC1 is not financial source data). Not full app, live route, current concurrency, GPU completion, FPS, or foreground loading acceptance.',cases};await writeFile(join(out,'results.json'),JSON.stringify(receipt,null,2));
}finally{if(browser)await browser.close();await rm(temp,{recursive:true,force:true});}

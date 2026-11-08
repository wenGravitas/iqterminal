/** Explicit offline real-wall visible-mapping equivalence/CPU check. Not route, GPU-completion,
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
if(process.env.IQ_WALL_VISIBLE_MAPPING!=='1')throw Error('Explicit offline projection benchmark opt-in required');
const label=process.env.IQ_MAPPING_LABEL;assert.ok(label&&/^[a-zA-Z0-9_-]{1,80}$/.test(label));
const out=resolve('artifacts/pi-history-r1/visible-mapping-'+label);await mkdir(out,{recursive:false});
const baseline='9586faf',candidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
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
   const from=1793696400000,to=1793804400000,slots=(to-from)/step,canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),enc=new TextEncoder();
   const host=document.createElement('div');document.body.append(host);const chart=ProjectionBench.createChart(host,{width:1600,height:1000}),DataLayer=chart.dataLayer.constructor;chart.destroy();host.remove();
   const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const settings={enabled:true,mode:'top-levels',aggregation:'native',topLevels:8,searchRangePercent:10,minDurationMs:0,showHistory:true,opacity:.6,thicknessPx:2,colorMode:'heat',highContrast:true,visibleRangeOnly:true,strengthThickness:true,historyEpisodes:2000,showPriceLines:false};
   const status={state:'live',tickSize:.1,lastConfirmedAt:to,archive:{loadedThrough:to,presentationThrough:to}};
   const initial=Array.from({length:slots+3},(_,i)=>({time:(from+i*step)/1000,open:1,high:1,low:1,close:1}));
   const results=[];
   for(let run=1;run<=5;run++){
    const states={};for(const variant of ['Baseline','Candidate']){const dataLayer=new DataLayer(),series=dataLayer.createSeries();dataLayer.setSeriesData(series,initial);const primitive=new ProjectionBench[variant](settings,step);primitive.setSnapshot(segments,status);states[variant]={dataLayer,series,primitive,bars:[...initial],offset:0,pan:0,dpr:1};}
    const rc=s=>({timeScale:{visibleRange:()=>({from:s.offset+s.pan,to:slots+s.offset+s.pan}),indexToX:i=>(i-s.offset-s.pan)/slots*1600,xToIndex:x=>s.offset+s.pan+x/1600*slots},priceScale:{priceRange:()=>({min:75000,max:81000}),priceToY:p=>(81000-p)/6000*1000},dataLayer:s.dataLayer,plotWidth:1600,plotHeight:1000,dpr:s.dpr,theme:{background:'#000',axisText:'#aaa'}});
    for(const stage of ['initial','idle','outside-tail','prefix-padding','inside-correction','pan','restore','dpr2']){
     for(const [variant,s]of Object.entries(states)){
      if(stage==='outside-tail')s.bars.push({...initial.at(-1),time:(from+1000*step)/1000});
      if(stage==='prefix-padding'){s.bars.unshift({...initial[0],time:(from-step)/1000});s.offset++;}
      if(stage==='inside-correction'){const i=s.offset+Math.floor(slots/2);s.bars[i]={...s.bars[i],time:s.bars[i].time+step/4000};}
      if(['outside-tail','prefix-padding','inside-correction'].includes(stage))s.dataLayer.setSeriesData(s.series,s.bars);
      // The old coarse key cannot detect an interior correction. A fresh old
      // snapshot is the independent full-projection reference for this stage.
      if(stage==='inside-correction'&&variant==='Baseline')s.primitive.setSnapshot(segments,status);
      if(stage==='pan')s.pan=3;if(stage==='restore')s.pan=0;if(stage==='dpr2')s.dpr=2;
     }
     canvas.width=1600*states.Candidate.dpr;canvas.height=1000*states.Candidate.dpr;
     const pair={};
     for(const variant of run%2?['Baseline','Candidate']:['Candidate','Baseline']){
      const s=states[variant];ctx.clearRect(0,0,canvas.width,canvas.height);const started=performance.now();s.primitive.draw(ctx,rc(s));const drawCallMs=performance.now()-started;
      const geometry=[...s.primitive.drawable.values()].map(({segment,...line})=>({id:segment.id,...line})),pixels=await digest(ctx.getImageData(0,0,canvas.width,canvas.height).data);
      pair[variant]={drawCallMs,geometry,pixels,diagnostics:s.primitive.diagnostics()};
     }
     const a=pair.Baseline,b=pair.Candidate;let financialShapeEqual=a.geometry.length===b.geometry.length,maxCoordinateDelta=0;
     for(let i=0;i<Math.min(a.geometry.length,b.geometry.length);i++){
      const x=a.geometry[i],y=b.geometry[i];for(const key of Object.keys(x))if(['x','right','y'].includes(key))maxCoordinateDelta=Math.max(maxCoordinateDelta,Math.abs(x[key]-y[key]));else if(!Object.is(x[key],y[key]))financialShapeEqual=false;
     }
     const metrics={};for(const [variant,p]of Object.entries(pair))metrics[variant]={drawCallMs:p.drawCallMs,geometrySha256:await digest(enc.encode(JSON.stringify(p.geometry))),pixelsSha256:p.pixels,diagnostics:p.diagnostics};
     results.push({run,stage,financialShapeEqual,maxCoordinateDelta,equalPixels:a.pixels===b.pixels,methods:metrics});
    }
    for(const s of Object.values(states))s.primitive.detached();
   }
   return results;
  },{segments,step});
  await writeFile(join(out,market+'-samples.json'),JSON.stringify({market,baseline,candidate,results,errors},null,2));
  for(const row of results){assert.equal(row.financialShapeEqual,true,`${market}/${row.run}/${row.stage} financial fields`);assert.ok(row.maxCoordinateDelta<=1e-8,`${market}/${row.run}/${row.stage} coordinate roundoff ${row.maxCoordinateDelta}`);assert.equal(row.equalPixels,true,`${market}/${row.run}/${row.stage} pixels`);}
  assert.deepEqual(errors,[]);cases.push({market,sourceToken:manifest.sourceToken,segments:segments.length,runs:segments.reduce((n,s)=>n+s.valueRuns.length,0),inputFinancialHash:expected,results,errors});await context.close();console.log(JSON.stringify({market,exactFinancialFieldsAndPixels:true,stageSamples:results.length}));
 }
 const receipt={baseline:execFileSync('git',['rev-parse',baseline],{encoding:'utf8'}).trim(),candidate,browser:browser.version(),system,scope:'Offline captured canonical walls on actual Pi; five alternating synchronous Canvas draw CPU samples per variant/market/stage. Actual OpenAlgo DataLayer over an explicit UTC axis fixture (OHLC1 is not financial source). Original financial input hashes/geometry fields and every readback pixel must match; coordinate-only roundoff <=1e-8 CSS pixels is recorded, not applied to runtime data. Readback/hashing excluded from draw timing. Includes idle scan overhead and conservative correction invalidation. Canvas2D willReadFrequently=true hint; no raster backend inference. Not app/live-route/current-concurrency, GPU completion, FPS, cold build or foreground acceptance.',cases};await writeFile(join(out,'results.json'),JSON.stringify(receipt,null,2));
}finally{if(browser)await browser.close();await rm(temp,{recursive:true,force:true});}

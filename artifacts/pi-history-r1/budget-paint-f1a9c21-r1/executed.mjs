/** Explicit offline real-wall closed-paint equivalence/CPU check. Not route, GPU-completion,
 * frame-rate or foreground Pi loading acceptance. Never opens a headed window. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium} from './test-browser-launch.mjs';
if(process.env.IQ_WALL_BUDGET_PAINT!=='1')throw Error('Explicit offline closed-paint benchmark opt-in required');
const label=process.env.IQ_PAINT_LABEL;assert.ok(label&&/^[a-zA-Z0-9_-]{1,80}$/.test(label));
const out=resolve('artifacts/pi-history-r1/budget-paint-'+label);await mkdir(out,{recursive:false});
const baseline='ae22752',candidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
execFileSync('git',['diff','--quiet','--','src']);
const temp=await mkdtemp(join(tmpdir(),'iq-wall-math-'));let browser;
try{
 const source=resolve('src/chart/order-walls.ts'),old=execFileSync('git',['show',baseline+':src/chart/order-walls.ts'],{encoding:'utf8'}).replace(/from\s+(['"])(\.[^'"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(resolve(dirname(source),path)));
 await writeFile(join(temp,'baseline.ts'),old);await writeFile(join(temp,'entry.ts'),`export {OrderWallsPrimitive as Baseline} from './baseline';export {OrderWallsPrimitive as Candidate} from ${JSON.stringify(source)};export {createChart} from ${JSON.stringify(fileURLToPath(import.meta.resolve('openalgo-charts')))};`);
 await writeFile(join(temp,'vite.config.mjs'),'export default '+`{logLevel:'error',build:{lib:{entry:${JSON.stringify(join(temp,'entry.ts'))},name:'ProjectionBench',formats:['iife'],fileName:()=> 'primitive.js'},outDir:${JSON.stringify(join(temp,'bundle'))},emptyOutDir:true,minify:false,sourcemap:true}}`);
 const built=spawnSync(resolve('node_modules/.bin/vite'),['build','--config',join(temp,'vite.config.mjs')],{encoding:'utf8'});await writeFile(join(out,'compile.log'),(built.stdout??'')+(built.stderr??'')+JSON.stringify({status:built.status,error:built.error?.message,signal:built.signal}));assert.equal(built.status,0,'Isolated compiler failed');
 const bundle=await readFile(join(temp,'bundle/primitive.js'),'utf8');await writeFile(join(out,'primitive.js'),bundle);await writeFile(join(out,'primitive.js.map'),await readFile(join(temp,'bundle/primitive.js.map')));await writeFile(join(out,'executed.mjs'),await readFile(new URL(import.meta.url)));
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
 const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo');
 await writeFile(join(out,'environment.json'),JSON.stringify({baseline,candidate,browser:browser.version(),system,driverGcExposed:Boolean(global.gc),driverArguments:process.execArgv,canvas:'Canvas2D willReadFrequently=true readback hint; no GPU backend inference',timeAxis:'Existing OpenAlgo DataLayer over an explicit1000-slot UTC grid fixture; captured wall data is exact'},null,2));
 const cases=[];
 for(const [market,input,step,expected] of [
  ['spot','artifacts/pi-history-r1/wall-presentation-cache-r1/input-spot',300000,'cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e'],
  ['perpetual','artifacts/pi-history-r1/compact-warm-r1/input-perpetual',900000,'de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6']]){
  const manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')),parts=[];
  for(const part of manifest.parts){const raw=gunzipSync(await readFile(join(input,part.hash+'.json.gz')),{maxOutputLength:4*1024*1024});assert.equal(createHash('sha256').update(raw).digest('hex'),part.hash);parts.push(JSON.parse(raw));}
  let segments=[...manifest.active.segments];for(const group of manifest.closed){const fragments=group.map(([part,row])=>parts[part][row]);segments.push({...fragments[0].segment,valueRuns:fragments.flatMap(row=>row.segment.valueRuns)});}
  segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price);const hash=createHash('sha256');for(const segment of segments)hash.update(JSON.stringify(segment));assert.equal(hash.digest('hex'),expected);
  const inputInfo={segments:segments.length,runs:segments.reduce((n,s)=>n+s.valueRuns.length,0)},inputFile=join(out,market+'-input.json.gz');await writeFile(inputFile,gzipSync(JSON.stringify({segments})));segments=undefined;parts.length=0;global.gc?.();
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('http://127.0.0.1/iq-projection-math',route=>route.fulfill({contentType:'text/html',body:'<canvas width="1600" height="1000"></canvas>'}));await page.route('http://127.0.0.1/iq-projection-input',route=>route.fulfill({path:inputFile,contentType:'application/gzip'}));await page.goto('http://127.0.0.1/iq-projection-math');await page.addScriptTag({content:bundle});
  const measured=await page.evaluate(async({step})=>{
   const input=await fetch('/iq-projection-input');const {segments}=await new Response(input.body.pipeThrough(new DecompressionStream('gzip'))).json();
   const from=1793696400000,to=1793804400000,slots=(to-from)/step,canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),enc=new TextEncoder();
   const host=document.createElement('div');document.body.append(host);const chart=ProjectionBench.createChart(host,{width:1600,height:1000}),DataLayer=chart.dataLayer.constructor;chart.destroy();host.remove();
   const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const settings={enabled:true,mode:'top-levels',aggregation:'native',topLevels:8,searchRangePercent:10,minDurationMs:0,showHistory:true,opacity:.6,thicknessPx:2,colorMode:'heat',highContrast:true,visibleRangeOnly:true,strengthThickness:true,historyEpisodes:2000,showPriceLines:false};
   const status={state:'live',tickSize:.1,lastConfirmedAt:to,archive:{loadedThrough:to,presentationThrough:to}};
   const renderSource=segments.find(s=>s.end!==null&&s.price>75000&&s.price<81000&&s.valueRuns.length>1&&s.end>from);if(!renderSource)throw Error('No bounded rendering source');
   const renderTail={...renderSource,id:'render-tail-fixture',archiveEntryId:'render-tail-fixture',start:to-60000,end:null,endKnown:false,endReason:null,currentSelection:true,durationMs:60000,valueRuns:[{...renderSource.valueRuns[0],at:to-60000}]};
   const exercised=[...segments,renderTail];
   const initial=Array.from({length:slots+3},(_,i)=>({time:(from+i*step)/1000,open:1,high:1,low:1,close:1}));
   const results=[];
   for(let run=1;run<=5;run++){
    const states={};for(const variant of ['Baseline','Candidate']){const dataLayer=new DataLayer(),series=dataLayer.createSeries();dataLayer.setSeriesData(series,initial);const primitive=new ProjectionBench[variant](settings,step);primitive.attached({requestUpdate(){}});primitive.setSnapshot(exercised,status);states[variant]={dataLayer,series,primitive,bars:[...initial],offset:0,pan:0,dpr:1,tail:renderTail,status};}
    const rc=s=>({timeScale:{visibleRange:()=>({from:s.offset+s.pan,to:slots+s.offset+s.pan}),indexToX:i=>(i-s.offset-s.pan)/slots*1600,xToIndex:x=>s.offset+s.pan+x/1600*slots},priceScale:{priceRange:()=>({min:75000,max:81000}),priceToY:p=>(81000-p)/6000*1000},dataLayer:s.dataLayer,plotWidth:1600,plotHeight:1000,dpr:s.dpr,theme:{background:'#000',axisText:'#aaa'}});
    for(const stage of ['initial','idle','append1','append2','append3','append4','append5','close-tail','reopen-tail','closed-correction','remove-closed','reference','pan','restore','dpr2','style','threshold']){
     for(const [variant,s]of Object.entries(states)){
      if(stage.startsWith('append')){const i=Number(stage.slice(6)),point=renderSource.valueRuns[i%renderSource.valueRuns.length];s.status={...status,lastConfirmedAt:to+i*1000};s.tail={...s.tail,durationMs:60000+i*1000,valueRuns:[...s.tail.valueRuns,{...point,at:to-60000+i*5000}]};s.primitive.patch([{id:s.tail.id,segment:s.tail,valuePoints:[s.tail.valueRuns.at(-1)]}],s.status);}
      if(stage==='close-tail'){s.tail={...s.tail,end:to,currentSelection:false,endKnown:true};s.primitive.patch([{id:s.tail.id,segment:s.tail}],s.status);}
      if(stage==='reopen-tail'){s.tail={...s.tail,end:null,currentSelection:true,endKnown:false};s.primitive.patch([{id:s.tail.id,segment:s.tail,replaceValueRuns:true}],s.status);}
      if(stage==='closed-correction'){const revised={...renderSource,valueRuns:[{...renderSource.valueRuns[0],usd:renderSource.valueRuns[0].usd*1.01},...renderSource.valueRuns.slice(1)]};s.primitive.patch([{id:revised.id,segment:revised,replaceValueRuns:true}],s.status);}
      if(stage==='remove-closed')s.primitive.patch([{id:renderSource.id,segment:null}],s.status);
      if(stage==='reference'){s.tail={...s.tail,valueRuns:[...s.tail.valueRuns,{...s.tail.valueRuns.at(-1),at:to-20000,usd:s.primitive.diagnostics().referenceMaximum*4}]};s.primitive.patch([{id:s.tail.id,segment:s.tail,valuePoints:[s.tail.valueRuns.at(-1)]}],s.status);}
      if(stage==='pan')s.pan=3;if(stage==='restore')s.pan=0;if(stage==='dpr2')s.dpr=2;
      if(stage==='style')s.primitive.setSettings({...settings,colorMode:'bid-ask'});
      if(stage==='threshold')s.primitive.patch([{id:'threshold-fixture',segment:{...renderTail,id:'threshold-fixture',archiveEntryId:undefined,detectionMode:'threshold',valueRuns:[],percentile:99}}],s.status);
     }
     canvas.width=1600*states.Candidate.dpr;canvas.height=1000*states.Candidate.dpr;
     const pair={};
     for(const variant of run%2?['Baseline','Candidate']:['Candidate','Baseline']){
      const s=states[variant],started=performance.now();let drawCallMs=0,maxDrawCallMs=0,frameCalls=0;
      for(;;){
       ctx.clearRect(0,0,canvas.width,canvas.height);const call=performance.now();s.primitive.draw(ctx,rc(s));const ms=performance.now()-call;
       drawCallMs+=ms;maxDrawCallMs=Math.max(maxDrawCallMs,ms);frameCalls++;
       const d=s.primitive.diagnostics();
       if(!d.pendingProjectionSegments&&!d.pendingReferenceSegments&&!d.pendingPaintWork&&d.inputRevision===d.paintedRevision)break;
       if(frameCalls>=2000)throw Error('Preparation did not settle '+variant+'/'+stage);
       await new Promise(requestAnimationFrame);
      }
      const wallTimeMs=performance.now()-started;
      const pixels=await digest(ctx.getImageData(0,0,canvas.width,canvas.height).data);
      pair[variant]={drawCallMs,maxDrawCallMs,frameCalls,wallTimeMs,pixels,diagnostics:s.primitive.diagnostics()};
     }
     const a=pair.Baseline,b=pair.Candidate,oldLines=states.Baseline.primitive.drawable,newLines=states.Candidate.primitive.drawable;
     let financialShapeEqual=oldLines.size===newLines.size,maxCoordinateDelta=0;
     const next=newLines.values(),coordinates=['x','right','y'],fields=['key','runIndex','from','to','percentile','usd','low','high'];
     for(const x of oldLines.values()){
      const y=next.next().value;if(!y){financialShapeEqual=false;break;}
      if(Object.keys(x).filter(key=>!['segment','paintOrder',...coordinates,...fields].includes(key)).length)throw Error('Uncompared drawable field');
      if(x.segment.id!==y.segment.id)financialShapeEqual=false;
      for(const key of coordinates)maxCoordinateDelta=Math.max(maxCoordinateDelta,Math.abs(x[key]-y[key]));
      for(const key of fields)if(!Object.is(x[key],y[key]))financialShapeEqual=false;
     }
     const oldSegments=states.Baseline.primitive.segments,newSegments=states.Candidate.primitive.segments;
     if(oldSegments.size!==newSegments.size)financialShapeEqual=false;
     for(const [id,value]of oldSegments){const other=newSegments.get(id);if(value!==other&&JSON.stringify(value)!==JSON.stringify(other))financialShapeEqual=false;}
     const metrics={};for(const [variant,p]of Object.entries(pair))metrics[variant]={drawCallMs:p.drawCallMs,maxDrawCallMs:p.maxDrawCallMs,frameCalls:p.frameCalls,wallTimeMs:p.wallTimeMs,drawableCount:variant==='Baseline'?oldLines.size:newLines.size,pixelsSha256:p.pixels,diagnostics:p.diagnostics};
     results.push({run,stage,financialShapeEqual,maxCoordinateDelta,equalPixels:a.pixels===b.pixels,methods:metrics});
    }
    for(const s of Object.values(states))s.primitive.detached();
   }
   const financialHash=await digest(enc.encode(segments.map(segment=>JSON.stringify(segment)).join('')));
   return {results,financialHash};
  },{step});
  const {results,financialHash}=measured;assert.equal(financialHash,expected,'Original financial input mutated');
  await writeFile(join(out,market+'-samples.json'),JSON.stringify({market,baseline,candidate,results,errors},null,2));
  for(const row of results){assert.equal(row.financialShapeEqual,true,`${market}/${row.run}/${row.stage} financial fields`);assert.ok(row.maxCoordinateDelta<=1e-8,`${market}/${row.run}/${row.stage} coordinate roundoff ${row.maxCoordinateDelta}`);assert.equal(row.equalPixels,true,`${market}/${row.run}/${row.stage} pixels`);}
  assert.deepEqual(errors,[]);cases.push({market,sourceToken:manifest.sourceToken,...inputInfo,inputFinancialHash:expected,results,errors});await context.close();console.log(JSON.stringify({market,exactFinancialFieldsAndPixels:true,stageSamples:results.length}));
 }
 const receipt={baseline:execFileSync('git',['rev-parse',baseline],{encoding:'utf8'}).trim(),candidate,browser:browser.version(),system,scope:'Offline captured canonical walls plus explicitly synthetic tail/revision exercise inputs on actual Pi; five alternating completed Canvas preparations per variant/market/stage. Both primitives are attached; Candidate yields across actual RAFs until no pending geometry/reference/paint work and the latest revision is painted. drawCallMs sums elapsed calls, maxDrawCallMs is the maximum individual call, wallTimeMs also includes RAF waits. These are overlapping measures and must not be added. No route/loading or concurrent live gate is implied. Compiler runs in a child that exits before Chromium. Gzipped financial input is read by Chromium directly rather than serialized through CDP; driver-only GC (when exposed) runs outside the measurements, never browser GC. Added renderer-only tail and correction inputs are not venue observations. Geometry is compared directly without copying it into diagnostic arrays. Internal paintOrder ordinal is excluded from geometry comparison; all incumbent drawable fields remain exact. Actual OpenAlgo DataLayer over an explicit UTC axis fixture (OHLC1 is not financial source). Original financial input hashes/geometry fields and every completed readback pixel must match; coordinate-only roundoff <=1e-8 CSS pixels is recorded, not applied to runtime data. Readback/hashing excluded from draw timing. Includes current append, close/reopen, correction/removal, reference/style/view invalidation and mixed Threshold fallback. Closed path counts and style visits are recorded; no whole-app heap plateau is inferred. Canvas2D willReadFrequently=true hint; no raster backend inference. Not app/live-route/current-concurrency, GPU completion, FPS, cold build or foreground acceptance.',cases};await writeFile(join(out,'results.json'),JSON.stringify(receipt,null,2));
}finally{if(browser)await browser.close();await rm(temp,{recursive:true,force:true});}

import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {routeTestBrowser} from './test-browser-workspace.mjs';
const base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4181',dir='artifacts/pi-history-r1',end=JSON.parse(readFileSync(`${dir}/windows.json`,'utf8')).end;
const range={from:end-24*3600000,to:end},id='chart-warm-footprint',output=`${dir}/${process.env.IQ_BENCH_LABEL??'warm-footprint'}.jsonl`;writeFileSync(output,'');
const params={venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,historyViewport:range,studies:[]};
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Warm footprint',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
if(!/^[a-f0-9]{40}$/.test(process.env.IQ_BENCH_BUILD??'')||!/^[a-f0-9]{40}$/.test(process.env.IQ_BENCH_BACKEND??''))throw Error('Exact client/API build IDs required');
const apiHealth=await (await fetch(base+'/market-data/v2/history/health')).json();if(apiHealth.build!==process.env.IQ_BENCH_BACKEND)throw Error('Unexpected API build');
const browser=await chromium.launch({headless:process.env.IQ_BENCH_HEADLESS==='1',executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles','--enable-precise-memory-info']});
const session=await browser.newBrowserCDPSession();writeFileSync(`${dir}/${process.env.IQ_BENCH_LABEL??'warm-footprint'}-browser-environment.json`,JSON.stringify({version:await session.send('Browser.getVersion'),systemInfo:await session.send('SystemInfo.getInfo'),apiBuild:apiHealth.build},null,2)+'\n');await session.detach();
try{for(let run=1;run<=Number(process.env.IQ_BENCH_SAMPLES??5);run++){
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),page=await context.newPage();await routeTestBrowser();let error,coldReady=false,measurement;
 try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(({id,range})=>{const p=window.__terminal?.panels.get(id),paint=p?.engine.footprintPaintDiagnostics(),view=p?.engine.visibleTimeRange();return view&&Math.abs(view.from-range.from/1000)<.001&&Math.abs(view.to-range.to/1000)<.001&&p?.footprintStatus.history?.validated&&paint&&Array.from({length:24},(_,i)=>range.from/1000+i*3600).every(t=>paint.times.includes(t));},{id,range},{timeout:12000});coldReady=true;
  await page.evaluate(id=>window.__terminal.dock.removePanel(window.__terminal.dock.getPanel(id)),id);await page.waitForTimeout(200);
  await page.evaluate(({id,params,range})=>{
   const marks=window.__warm={started:performance.now(),firstPaintAt:null,validatedAt:null,historyAtFirstPaint:null};
   const frame=()=>{const p=window.__terminal.panels.get(id),paint=p?.engine.footprintPaintDiagnostics(),view=p?.engine.visibleTimeRange();
    if(view&&Math.abs(view.from-range.from/1000)<.001&&Math.abs(view.to-range.to/1000)<.001&&paint&&paint.at>=marks.started&&Array.from({length:24},(_,i)=>range.from/1000+i*3600).every(t=>paint.times.includes(t))){if(marks.firstPaintAt===null){marks.firstPaintAt=performance.now();marks.historyAtFirstPaint=JSON.parse(JSON.stringify(p.footprintStatus.history));}if(p.footprintStatus.history?.validated&&marks.validatedAt===null)marks.validatedAt=performance.now();}
    if(marks.validatedAt===null&&performance.now()-marks.started<12000)requestAnimationFrame(frame);
   };requestAnimationFrame(frame);
   window.__terminal.dock.addPanel({id,component:'candle',title:'Warm footprint',params,minimumWidth:220,minimumHeight:140});
  },{id,params,range});
  await page.waitForFunction(()=>window.__warm.validatedAt!==null,null,{timeout:12000});
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(200);
  measurement=await page.evaluate(()=>({...window.__warm,heap:performance.memory?.usedJSHeapSize,diagnostics:window.__terminal.feed.diagnostics}));
  const actual=measurement.diagnostics?.staging?.config;measurement.environmentVerified=measurement.diagnostics?.fixture===false&&actual?.dataMode==='staging'&&actual?.historyTiles===true&&actual?.build===process.env.IQ_BENCH_BUILD;if(!measurement.environmentVerified)throw Error('Unverified actual client environment');
 }catch(e){error=String(e);measurement=await page.evaluate(()=>window.__warm??null).catch(()=>null);}
 await page.screenshot({path:`${dir}/${process.env.IQ_BENCH_LABEL??'warm-footprint'}-${run}.png`}).catch(()=>{});
 const result={run,range,coldReady,measurement,error,build:process.env.IQ_BENCH_BUILD,backend:process.env.IQ_BENCH_BACKEND,rendering:process.env.IQ_BENCH_HEADLESS==='1'?'headless-gles':'headed-normal-chromium-gles',route:base};appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({run,coldReady,usefulMs:measurement?.firstPaintAt-measurement?.started,validationMs:measurement?.validatedAt-measurement?.started,error}));await context.close();
}}finally{await browser.close();}

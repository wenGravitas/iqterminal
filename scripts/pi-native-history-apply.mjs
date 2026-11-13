/** Explicit deterministic Pi chart-kernel diagnostic, not a source/latency gate. */
import {chromium} from './test-browser-launch.mjs';
import {routeTestBrowser} from './test-browser-workspace.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=process.env.IQ_BENCH_URL??'http://127.0.0.1:4181',label=process.env.IQ_APPLY_LABEL??'native-history-apply';
const dir='artifacts/pi-history-r1';mkdirSync(dir,{recursive:true});
const script=readFileSync(new URL(import.meta.url));writeFileSync(`${dir}/${label}-executed.mjs`,script);
const scriptSha256=createHash('sha256').update(script).digest('hex');
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage();await routeTestBrowser();
 await page.addInitScript(()=>{const id='chart-apply',layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));localStorage.setItem('basis.theme.v1','dark');});
 await page.goto(base+'/?fixture=1');await page.waitForFunction(()=>window.__terminal?.fixture&&window.__terminal.panels.get('chart-apply')?.engine?.barCount>=1000);
 await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForFunction(()=>window.__terminal.feed.diagnostics?.fixture===true);
 const diagnostics=await page.evaluate(()=>window.__terminal.feed.diagnostics);
 if(process.env.IQ_BENCH_BUILD&&diagnostics.staging?.config.build!==process.env.IQ_BENCH_BUILD)throw Error('Unexpected compiled client build');
 const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 const result=await page.evaluate(async()=>{
  const p=window.__terminal.panels.get('chart-apply'),e=p.engine;p.release?.();
  const step=60000,end=1793952000000,rows=Array.from({length:1000},(_,i)=>({t:end-(999-i)*step,o:80000+i%20,h:80050+i%20,l:79950+i%20,c:80010+i%20,v:2+i%7,quoteVolume:(2+i%7)*80010,revision:i+1,closed:i<999}));
  const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const samples=[];let reference;
  for(let run=1;run<=5;run++)for(const method of run%2?['patch','snapshot']:['snapshot','patch']){
   e.setSnapshot(rows.slice(-1),false);e.resetView();await frames();const before=e.visibleTimeRange(),start=performance.now();
   if(method==='patch')e.applyPatch(rows.slice(0,-1));else e.setSnapshot(rows,true);
   const applyMs=performance.now()-start,after=e.visibleTimeRange(),data=JSON.stringify(e.series.getData());
   reference??=data;if(data!==reference)throw Error('Native history apply methods produced different canonical bars');
   await frames();samples.push({run,method,applyMs,before,after,bars:e.barCount});
  }
  return {fixture:window.__terminal.fixture,samples,canonicalEquivalent:true,renderer:p.diagnostics().renderer,userAgent:navigator.userAgent};
 });
 const {profile}=await cdp.send('Profiler.stop');writeFileSync(`${dir}/${label}.cpuprofile`,JSON.stringify(profile));
 await page.screenshot({path:`${dir}/${label}.png`});
 writeFileSync(`${dir}/${label}.json`,JSON.stringify({kind:'deterministic-chart-kernel-diagnostic-not-acceptance',scriptSha256,build:process.env.IQ_BENCH_BUILD??'unspecified',base,rendering:'normal-headed-chromium-gles',profilerEnabled:true,diagnostics,...result,architecture:process.arch,model:readFileSync('/proc/device-tree/model','utf8').replace(/\0/g,''),resources:{load:readFileSync('/proc/loadavg','utf8'),mem:readFileSync('/proc/meminfo','utf8')}},null,2)+'\n');
 console.log(JSON.stringify(result));await context.close();
}finally{await browser.close();}

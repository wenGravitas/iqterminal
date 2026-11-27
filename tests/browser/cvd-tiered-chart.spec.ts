import {test,expect} from '@playwright/test';
import {recordedMinuteWire} from '../helpers/recorded-minute-wire';
import type {MinuteHistoryRequest} from '../../src/feed/recorded-minute-history';
test.use({storageState:{cookies:[],origins:[]}});
for(const mode of ['warm','native-correction'] as const)test(`opt-in tiered CVD ${mode} renders the real chart and retains history through a timeframe change and origin outage`,async({page,context})=>{
 test.skip(process.env.IQ_TEST_CVD_TIERED_CHART!=='1','Explicit isolated staging chart fixture');test.setTimeout(60000);
 const M=60000,H=3600000,D=86400000,end=Math.floor(Date.now()/D)*D,start=end-2*D,id='chart-tiered-cvd',source='binance:perpetual';
 await context.addInitScript(({id,start})=>{
  const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1600}],size:1000},width:1600,height:1000,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[],indicators:[{instanceId:'tiered-cvd',definitionId:'native.multi-venue-cvd',settingsVersion:1,visible:true,source:{kind:'chart'},placement:'pane',settings:{sources:['binance:perpetual'],anchor:'daily',origin:start,custom:start}}]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
  localStorage.setItem('basis.layout.v1',JSON.stringify({version:5,layout}));const post=Worker.prototype.postMessage;(window as any).__tieredCvdCommands=[];Worker.prototype.postMessage=function(message:any,transfer?:any){if(message.type?.startsWith('cvd-'))(window as any).__tieredCvdCommands.push(message);return post.call(this,message,transfer);};
 },{id,start});
 // Explicit unrelated candle socket fixture. The production CVD worker/service
 // and HTTP path remain intact; no public exchange connection is used here.
 await context.route('**/src/feed/worker.ts*',async route=>{
  const response=await route.fetch(),script=await response.text();return route.fulfill({response,body:`globalThis.WebSocket=class {static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=0;timer;onopen;onmessage;onclose;onerror;constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.({});},0);}send(){const health=()=>this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()},watermark:{id:1}})});health();clearInterval(this.timer);this.timer=setInterval(health,500);}close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}};\n`+script});
 });
 let lease:any,offline=false,revision=0,corrected=false,releaseCorrection!:()=>void;const correctionGate=new Promise<void>(r=>releaseCorrection=r),repairHeaders:string[]=[];const archiveCalls:string[]=[];
 await context.route('**/market-data/**',async route=>{
  const req=route.request(),url=new URL(req.url()),json=(v:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
  if(url.pathname.endsWith('/native-candles')){const step=({'1m':M,'5m':5*M,'15m':15*M,'30m':30*M,'1h':H,'4h':4*H,'1d':D} as Record<string,number>)[url.searchParams.get('interval')??'5m']!;return json({source:'binance-native-kline',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',candles:Array.from({length:Math.min(1000,(end-start)/step)},(_,i)=>({t:start+i*step,o:80000,h:80050,l:79950,c:80010,v:1,quoteVolume:80010,revision:1,closed:true}))});}
  const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to')),rows=[];
  for(let t=Math.ceil(from/H)*H;t<to;t+=H)rows.push({time:t,base:'1.00000001',quote:'10.0000001',firstId:String(t/H),lastId:String(t/H),records:'1'});
  if(url.pathname==='/market-data/v2/cvd'){if(mode==='native-correction'&&req.headers()['x-iq-history-priority']==='background'){repairHeaders.push(req.headers()['x-iq-history-priority']!);await Promise.race([correctionGate,new Promise(r=>setTimeout(r,10000))]);}if(corrected)for(const row of rows)if(row.time===end-H){row.base='2.00000002';row.quote='20.0000002';}const asOf=Date.now();return json({version:2,semantics:'native-recorded-execution-minute-observations',source:source+':BTCUSDT',incarnation:'12345678-1234-4abc-8abc-123456789abc',revision:++revision,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:asOf,snapshot:true,stepMs:M,from,to,retainedFrom:mode==='warm'?end:start,watermark:'10000000',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:rows,coverage:{from,to:Math.min(to,asOf),gaps:[]},status:'live',asOf,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false});}
  if(url.pathname.includes('/history/recorded-minute')){
   if(req.method()==='DELETE')return json({version:1,released:true});
   const request:MinuteHistoryRequest={dataset:'cvd',venue:'binance',market:'perpetual',from,to};
   if(req.method()==='POST'){const p=recordedMinuteWire({...request,to:from+M}).publicationSnapshot;lease={kind:'iq-recorded-minute-observation-lease-v1',id:'12345678-1234-4abc-8abc-123456789abc',checkpoint:p.checkpoint,generation:p.generation,catalogueHead:p.catalogueHead,witness:'f'.repeat(64),source:p.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return json({version:1,token:'e'.repeat(64),lease});}
   archiveCalls.push(req.url());if(offline)return json({},503);const p=recordedMinuteWire(request),sample=p.bars[0];p.bars=rows.map(({time,...r})=>({...sample,...r,timeMs:time,open:'10',high:'10',low:'10',close:'10',baseVolume:r.base,quoteVolume:r.quote}));return json({...p,observationLease:lease});
  }
  return json({version:1,cursor:0,watches:[],events:[]});
 });
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/',{waitUntil:'domcontentloaded'});
 const state=()=>page.evaluate(id=>{const p=(window as any).__terminal?.panels.get(id),s=p?.cvdData?.model.sources.get('binance:perpetual');return {bars:p?.candles.length,points:s?.points.length,last:s?.points.at(-1),partial:s?.points.some((p:any)=>p.partial),segments:p?.cvdView?.diagnostics().segments};},id);
 await expect.poll(state,{timeout:30000}).toMatchObject({bars:576,points:576,partial:false,last:{baseText:'24.00000024'}});await expect.poll(async()=>(await state()).segments).toBeGreaterThan(0);
 let expected='24.00000024';if(mode==='native-correction'){corrected=true;releaseCorrection();expected='25.00000025';await expect.poll(state,{timeout:15000}).toMatchObject({partial:false,last:{baseText:expected}});expect(repairHeaders.length).toBeGreaterThan(0);}
 const requests=archiveCalls.length;expect(requests).toBe(mode==='warm'?48:0);offline=true;
 await page.locator('.candle-panel').first().getByLabel('Timeframe',{exact:true}).selectOption('1h');
 await expect.poll(state).toMatchObject({bars:48,points:48,partial:false,last:{baseText:expected}});await expect.poll(async()=>(await state()).segments).toBeGreaterThan(0);expect(archiveCalls).toHaveLength(requests);
 await page.evaluate(id=>{const p=(window as any).__terminal.panels.get(id);p.engine.setRange({from:6,to:24});},id);
 await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));expect(archiveCalls).toHaveLength(requests);
 expect(await page.evaluate(()=>(window as any).__tieredCvdCommands.filter((c:any)=>c.type==='cvd-subscribe').length)).toBe(1);expect(errors).toEqual([]);
});

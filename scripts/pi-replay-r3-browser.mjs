/** Metadata-only observation of the real worker and real WebSockets. */
import {chromium} from './test-browser-launch.mjs';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='artifacts/pi-replay-history-r3',base='http://127.0.0.1:4202';

function replayMessageMetadata(text){
 const type=/"type"\s*:\s*"([^"]+)"/.exec(text)?.[1];
 if(type!=='executions')return {type};
 const boundary=text.indexOf(',"executions":[');if(boundary<0)throw Error('Missing execution array boundary');
 const header=JSON.parse(text.slice(0,boundary)+'}');
 return {type,after:header.after,cursor:header.cursor,watermark:header.watermark};
}
if(process.argv.includes('--self-test')){
 assert.deepEqual(replayMessageMetadata('{"type":"executions","after":10,"cursor":11,"watermark":12,"executions":[{"private":"never parsed or returned"}]}'),{type:'executions',after:10,cursor:11,watermark:12});
 assert.deepEqual(replayMessageMetadata('{"type":"health"}'),{type:'health'});console.log('Replay header metadata assertions passed');process.exit(0);
}
assert.ok(Date.now()+240000<JSON.parse(readFileSync(dir+'/manifest.json')).experimentCutoffEpoch*1000);
const prefix=`{
const metadata=${replayMessageMetadata.toString()};
const Original=globalThis.WebSocket,trace=globalThis.__replayTrace={events:[],sockets:[],gate:0,targetFrom:null};
const log=(event,extra={})=>{trace.events.push({event,mono:performance.now(),...extra});if(trace.events.length>4096)trace.events.shift();};
globalThis.WebSocket=class extends Original{
 constructor(...args){super(...args);this.traceId=trace.sockets.length;trace.sockets.push(this);log('attempt',{id:this.traceId,readyState:this.readyState});this.addEventListener('open',()=>log('open',{id:this.traceId,readyState:this.readyState}));this.addEventListener('close',e=>log('close',{id:this.traceId,code:e.code,reason:e.reason,readyState:this.readyState}));this.addEventListener('error',()=>log('error',{id:this.traceId,readyState:this.readyState}));this.addEventListener('message',e=>{const start=performance.now(),text=String(e.data),meta=metadata(text),type=meta.type;log('message',{id:this.traceId,type,bytes:new TextEncoder().encode(text).length,...meta});setTimeout(()=>log('message-task-complete',{id:this.traceId,type,ms:performance.now()-start}));});}
 send(wire){let c;try{c=JSON.parse(wire);}catch{}if(c?.type==='subscribe'){this.subscription=c;if(!c.interval&&trace.targetFrom===c.from&&Date.now()<trace.gate){log('injected-subscription-pause',{id:this.traceId,after:c.after,from:c.from});return;}}if(c?.type==='subscribe'||c?.type==='ack')log('send',{id:this.traceId,command:c,readyState:this.readyState});return super.send(wire);}
};}
`;
const id='chart-current-probe',end=JSON.parse(readFileSync('artifacts/pi-history-integration-startup-r1/diagnostic-windows.json')).end;
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:640}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Current',params:{venue:'binance',market:'perpetual',interval:'5m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
for(const [hid,interval,hours]of[['chart-history-five','5m',4],['chart-history-hour','1h',24]]){layout.panels[hid]={id:hid,contentComponent:'candle',tabComponent:'compact-chart',title:'Prepared footprint',params:{venue:'binance',market:'perpetual',interval,type:'footprint',rowPrice:25,historyViewport:{from:end-hours*3600000,to:end},studies:[]},minimumHeight:140,minimumWidth:220};layout.grid.root.data.push({type:'leaf',data:{views:[hid],activeView:hid,id:hid},size:640});}
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});let worker,error;
try{
const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}});
await context.grantPermissions(['local-network-access'],{origin:base});
await context.route('**/assets/worker-*.js',async route=>{const response=await route.fetch(),script=await response.text();await route.fulfill({response,body:(script.includes('Invalid durable execution batch')?prefix:'')+script});});
const page=await context.newPage();page.on('console',m=>appendFileSync(dir+'/E-permitted-console.jsonl',JSON.stringify({type:m.type(),text:m.text()})+'\n'));page.on('websocket',s=>s.on('socketerror',error=>appendFileSync(dir+'/E-permitted-console.jsonl',JSON.stringify({url:s.url(),error})+'\n')));page.on('worker',w=>{if(w.url().includes('worker-'))worker=w;});
await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
let injected=false,gateAt=0;const start=Date.now();
while(Date.now()-start<210000){
 if(!worker||!await worker.evaluate(()=>!!globalThis.__replayTrace).catch(()=>false)){worker=page.workers().find(w=>w.url().includes('worker-'));await page.waitForTimeout(500);continue;}
 await page.evaluate(()=>window.__terminal?.feed.send({type:'diagnostics'}));await page.waitForTimeout(100);
 const state=await page.evaluate(()=>({diagnostics:window.__terminal?.feed.diagnostics,panels:[...window.__terminal?.panels.values()??[]].map(p=>({id:p.params.api.id,status:p.footprintStatus,barCount:p.bars?.length}))}));
 const trace=await worker.evaluate(()=>({events:globalThis.__replayTrace.events,sockets:globalThis.__replayTrace.sockets.map(s=>({id:s.traceId,url:s.url,readyState:s.readyState,subscription:s.subscription}))}));
 appendFileSync(dir+'/E-permitted-browser-samples.jsonl',JSON.stringify({utc:new Date().toISOString(),phase:injected?'recovery':'baseline',...state,trace})+'\n');
 if(!injected&&Date.now()-start>15000){
 const chosen=await worker.evaluate(()=>{const t=globalThis.__replayTrace,s=t.sockets.findLast(s=>s.readyState===1&&s.subscription&&!s.subscription.interval&&t.events.some(e=>e.id===s.traceId&&e.event==='send'&&e.command.type==='ack'));if(!s)return null;t.targetFrom=s.subscription.from;t.gate=Date.now()+90000;const ack=t.events.findLast(e=>e.id===s.traceId&&e.event==='send'&&e.command.type==='ack');s.close(1000,'R3 scoped recovery test');return {id:s.traceId,subscription:s.subscription,lastAck:ack.command.cursor,gateUntil:t.gate};});
 if(chosen){injected=true;gateAt=Date.now();writeFileSync(dir+'/E-permitted-injected-recovery.json',JSON.stringify({scope:'Injected scoped subscription pause, not proof of historical cause',...chosen}));}
 }
 if(injected&&Date.now()-gateAt>150000)break;
 await page.waitForTimeout(1900);
}
await page.screenshot({path:dir+'/E-permitted-browser.png'});
writeFileSync(dir+'/E-permitted-browser-final.json',JSON.stringify({injected,elapsedMs:Date.now()-start,trace:await worker?.evaluate(()=>({events:globalThis.__replayTrace.events,sockets:globalThis.__replayTrace.sockets.map(s=>({id:s.traceId,url:s.url,readyState:s.readyState,subscription:s.subscription}))})),diagnostics:await page.evaluate(()=>window.__terminal?.feed.diagnostics)},null,2));
}catch(e){error=String(e);writeFileSync(dir+'/E-permitted-browser-error.json',JSON.stringify({error}));}finally{await browser.close();}if(error)throw Error(error);

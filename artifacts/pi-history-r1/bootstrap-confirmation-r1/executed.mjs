/** Explicit transport fault injection against real HTTP staging history. This
 * is a functional status/paint regression, not live performance acceptance. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from './test-browser-launch.mjs';
assert.equal(process.env.IQ_BOOTSTRAP_CONFIRMATION_FAULT,'1','Explicit transport-fault opt-in required');
const upstream=process.env.IQ_BENCH_URL??'http://127.0.0.1:4187',build=process.env.IQ_BENCH_BUILD,label=process.env.IQ_BENCH_LABEL;
assert.match(build??'',/^[a-f0-9]{40}$/);assert.match(label??'',/^[a-zA-Z0-9_-]{1,70}$/);
const dir=`artifacts/pi-history-r1/${label}`;mkdirSync(dir);writeFileSync(dir+'/executed.mjs',readFileSync(new URL(import.meta.url)));
// An isolated loopback proxy reaches dedicated-worker WebSockets too. It
// forwards real HTTP unchanged and holds stream delivery after a valid upgrade.
// No server/exchange socket is opened for a held stream; no packet is fabricated.
const held=[],sockets=new Set(),proxyErrors=[];
const proxy=http.createServer((req,res)=>{const target=new URL(req.url,upstream),out=http.request(target,{method:req.method,headers:{...req.headers,host:target.host}},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);});out.setTimeout(15000,()=>out.destroy(Error('Fault harness HTTP forwarding timeout')));out.on('error',e=>{proxyErrors.push(e.message);if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(out);res.on('close',()=>out.destroy());});
proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',e=>proxyErrors.push(e.message));});
proxy.on('upgrade',(req,socket)=>{if(new URL(req.url,upstream).pathname!='/market-data/v1/stream'){socket.destroy();return;}held.push({url:req.url,at:performance.now()});const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.on('data',()=>{});});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${proxy.address().port}`;
const end=Math.floor(Date.now()/3600000)*3600000,range={from:end-5*3600000,to:end+3*3600000};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});
const results=[];
try{for(const type of ['footprint','candle']){
 const id='chart-confirmation',totals={instanceId:'totals-confirmation',definitionId:'native.footprint-totals',settingsVersion:1,visible:true,source:{kind:'chart'},placement:'pane',settings:{highlightDeltaFlips:false}},params={venue:'binance',market:'perpetual',interval:'1h',type,rowPrice:25,historyViewport:range,studies:[],tradingOverlay:false,indicators:type==='candle'?[totals]:[]};
 const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Awaiting live confirmation',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
 const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.theme.v1',value:'dark'},{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})}]}]}}),requests=[],pageErrors=[],heldStart=held.length;
 await context.addInitScript(()=>{
  window.__confirmationEvents=[];const Native=window.Worker;
  window.Worker=new Proxy(Native,{construct(target,args){const worker=Reflect.construct(target,args);worker.addEventListener('message',({data:e})=>{if(!e?.type?.startsWith('footprint-'))return;const events=window.__confirmationEvents;events.push({at:performance.now(),type:e.type,key:e.key,status:e.status,times:e.bars?.map(b=>b.time)});if(events.length>500)events.shift();});return worker;}});
 });
 context.on('requestfinished',r=>{if(r.url().includes('/market-data/'))requests.push({url:r.url(),timing:r.timing()});});
 const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));let error;
 try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(id=>window.__terminal?.panels.has(id),id,{timeout:15000});
  await page.waitForFunction(({id,end,type})=>{const p=window.__terminal.panels.get(id),d=p?.diagnostics(),h=d?.footprint.status.history;return h?.validated&&d.footprint.bars>=5&&(type==='footprint'?d.footprint.paint?.times.length>=5:d.footprintTotals.some(t=>t.mounted));},{id,end,type},{timeout:30000});
  assert.ok(held.length>heldStart,'No stream interception proved; cannot certify transport fault');
  const initial=await page.evaluate(()=>window.__confirmationEvents);assert.ok(initial.some(e=>e.times?.length&&e.status?.state==='loading'&&e.status.message?.includes('awaiting live execution stream')),'Seeded snapshot must be displayable while awaiting live confirmation');
  assert.ok(!initial.some(e=>e.status?.state==='live'),'Held transport must never become live from HTTP/history alone');
  await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));await page.waitForTimeout(250);
  const state=await page.evaluate(id=>({panel:window.__terminal.panels.get(id).diagnostics(),feed:window.__terminal.feed.diagnostics,events:window.__confirmationEvents}),id);
  assert.equal(state.feed.staging.config.build,build);assert.equal(state.feed.staging.config.dataMode,'staging');assert.equal(state.feed.staging.config.historyTiles,true);
  const stream=state.feed.staging.streams.find(s=>s.key.endsWith(':footprint:1h:p25'));assert.equal(stream.executionProof.appliedBatches,0);assert.equal(stream.executionProof.acksSent,0);
  const ready=state.panel.footprint.status.history.ranges.find(r=>r.from===range.from&&r.to===end);assert.equal(ready.progress.requestedSlots,5);assert.equal(ready.progress.validatedSlots,5);
  await page.screenshot({path:`${dir}/${type}.png`});results.push({type,range,expectedClosed:{from:range.from,to:end,slots:5},intercepts:held.slice(heldStart),requests,pageErrors,state});
 }catch(e){error=String(e);process.exitCode=1;results.push({type,error,intercepts:held.slice(heldStart),requests,pageErrors,state:await page.evaluate(()=>({events:window.__confirmationEvents,panels:[...window.__terminal?.panels.values()??[]].map(p=>p.diagnostics())})).catch(()=>null)});await page.screenshot({path:`${dir}/${type}-failure.png`}).catch(()=>{});}
 finally{await context.close();}
 console.log(JSON.stringify({type,error,intercepts:held.length-heldStart}));
}}finally{writeFileSync(dir+'/results.json',JSON.stringify({build,upstream,route:base,proxyErrors,scope:'Headless actual Pi; real staging HTTP/prepared source via isolated fault proxy, deliberately held WebSocket transport. Functional status/history regression only.',results},null,2));await browser.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));}

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {createServer,loadConfigFromFile,preview} from 'vite';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const until=async(predicate,message)=>{const start=performance.now();while(!predicate()){if(performance.now()-start>2000)throw Error(message);await new Promise(r=>setTimeout(r,10));}};
function request(url){
 let headers,body='',error;const started=performance.now();
 const req=http.get(url,res=>{headers=res.headers;res.on('data',chunk=>body+=chunk);res.on('error',e=>{error=e.code;});});
 req.on('error',e=>{error=e.code;});
 return {req,started,get headers(){return headers;},get body(){return body;},get error(){return error;}};
}
const receipts=[];
for(const mode of ['dev','production-preview'])test(`${mode}: reserved current sockets and upstream cancellation`,async()=>{
 const currentReceived=[],currentClosed=[];let activeTotal=0,activeHistorical=0,rejections=0;
 const grant=(res,current)=>{
  if(activeTotal>=4||!current&&activeHistorical>=3){rejections++;res.writeHead(503);res.end('{"error":"fixture admission"}');return false;}
  activeTotal++;if(!current)activeHistorical++;let done=false;
  const release=()=>{if(done)return;done=true;activeTotal--;if(!current)activeHistorical--;};res.once('finish',release);res.once('close',release);return true;
 };
 const received=[],closed=[],history=http.createServer((req,res)=>{
  if(!grant(res,false))return;const id=new URL(req.url,'http://fixture').searchParams.get('id');received.push(id);
  res.on('close',()=>closed.push(id));
  if(id==='released'){res.setHeader('server-timing','fixture;dur=1');res.setHeader('x-iq-request-id','fixture-upstream');res.end('{"ready":true}');}
 });
 const secondHistory=http.createServer(history.listeners('request')[0]);
 const current=http.createServer((req,res)=>{if(!grant(res,true))return;const id=new URL(req.url,'http://fixture').searchParams.get('id');currentReceived.push(id);res.once('close',()=>currentClosed.push(id));if(id?.endsWith('-current-hold'))return;res.setHeader('server-timing','fixture;dur=1');res.setHeader('x-iq-request-id','fixture-current');res.end('{"healthy":true}');});
 let server,proxy;const opened=[];
 try{
  await listen(history);await listen(secondHistory);await listen(current);
  const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});assert.ok(loaded?.config.server?.proxy);
  const config=loaded.config;proxy=config.server.proxy;const budget=config.plugins.find(plugin=>plugin.name==='staging-loopback-only').api.proxyBudget;
  for(const [route,option] of Object.entries(proxy))if(typeof option==='object')option.target=`http://127.0.0.1:${(route==='/market-data/v1/liquidations'?secondHistory:String(option.target).endsWith(':18781')?current:history).address().port}`;
  if(mode==='dev'){server=await createServer({...config,configFile:false,mode:'staging',server:{...config.server,host:'127.0.0.1',port:0,strictPort:true,proxy}});await server.listen();}
  else server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:0,strictPort:true,proxy}});
  const base=`http://127.0.0.1:${server.httpServer.address().port}`,samples=[];
  for(let run=1;run<=5;run++){
   const before=received.length,prefix=mode+'-'+run;
   const bulk=Array.from({length:2},(_,i)=>request(`${base}/market-data/${i===0?'v2/history/walls/batch':'v1/liquidations'}?id=${prefix}-${i+1}`));opened.push(...bulk);
   await until(()=>received.length===before+2,'Two bulk history slots did not reach the upstream');
   const bulkQueued=request(`${base}/market-data/v2/history/walls/batch?id=${prefix}-bulk-queued`);opened.push(bulkQueued);
   await new Promise(r=>setTimeout(r,30));assert.equal(received.length,before+2,'Bulk history consumed a reserved native slot');
   const native=Array.from({length:1},(_,i)=>request(`${base}/market-data/v1/native-candles?id=${prefix}-${i}`)),held=[...native,...bulk];opened.push(...native);
   await until(()=>received.length===before+3,'Reserved native sockets queued behind saturated bulk history');
   const canceled=request(`${base}/market-data/v1/native-candles?id=${prefix}-canceled`),next=request(`${base}/market-data/v1/native-candles?id=released`);opened.push(canceled,next);
   await new Promise(r=>setTimeout(r,50));assert.equal(received.length,before+3,'Historical socket budget was exceeded');
   const health=request(`${base}/market-data/v2/history/health`);opened.push(health);
   await until(()=>health.body==='{"healthy":true}','Current health queued behind saturated history sockets');
   const currentMs=performance.now()-health.started;assert.ok(currentMs<1000,`Fixture current latency ${currentMs}ms`);
   assert.equal(health.headers['x-iq-request-id'],'fixture-current');
   assert.match(health.headers['server-timing'],/fixture;dur=1.*proxyqueue;dur=.*proxyheader;dur=/);
   assert.ok(Number(health.headers['x-iq-proxy-queue-ms'])>=0);
   const currentHold=request(`${base}/market-data/v2/history/current?id=${prefix}-current-hold`);opened.push(currentHold);
   await until(()=>currentReceived.includes(prefix+'-current-hold'),'Current reserve did not admit the held request');
   const currentCanceled=request(`${base}/market-data/v2/history/health?id=${prefix}-current-canceled`),currentNext=request(`${base}/market-data/v2/history/health?id=${prefix}-current-next`);opened.push(currentCanceled,currentNext);
   await until(()=>budget.diagnostics().waitingCurrent===2,'Current overflow did not queue behind the total serving cap');assert.ok(!currentReceived.includes(prefix+'-current-next'),'Current overflow bypassed the aggregate serving cap');
   currentCanceled.req.destroy();await until(()=>budget.diagnostics().waitingCurrent===1,'Proxy did not acknowledge queued current cancellation');currentHold.req.destroy();
   await until(()=>currentClosed.includes(prefix+'-current-hold'),'Current cancellation did not reach upstream');
   await until(()=>currentNext.body==='{"healthy":true}','Queued current read did not resume after cancellation');
   assert.ok(!currentReceived.includes(prefix+'-current-canceled'),'Canceled current interest reached upstream');
   bulkQueued.req.destroy();canceled.req.destroy();await new Promise(r=>setTimeout(r,30));
   held[0].req.destroy();await until(()=>closed.includes(prefix+'-0'),'Active cancellation did not reach upstream');
   await until(()=>next.body==='{"ready":true}','Released upstream socket did not serve the surviving queued request');
   assert.ok(!received.includes(prefix+'-bulk-queued'),'Canceled queued bulk request reached the upstream');
   assert.ok(!received.includes(prefix+'-canceled'),'Canceled queued request reached the upstream');
   assert.equal(next.headers['x-iq-request-id'],'fixture-upstream');
   const queueMs=Number(next.headers['x-iq-proxy-queue-ms']);assert.ok(queueMs>=50,`Queued history wait missing: ${queueMs}`);
   for(const item of held)item.req.destroy();
   await until(()=>held.every((_,i)=>closed.includes(prefix+'-'+i)),'History requests leaked after consumer cancellation');
   // Borrow the third shared slot fairly: two independent native reads may
   // run beside one bulk read, then the queued bulk proceeds on cancellation.
   const dynamicBefore=received.length,dynamicPrefix=prefix+'-dynamic';
   const pair=Array.from({length:2},(_,i)=>request(`${base}/market-data/v1/native-candles?id=${dynamicPrefix}-${i}`));opened.push(...pair);
   await until(()=>received.length===dynamicBefore+2,'Independent native history was serialized behind bootstrap');
   const dynamicBulk=Array.from({length:2},(_,i)=>request(`${base}/market-data/${i===0?'v2/history/walls/batch':'v1/liquidations'}?id=${dynamicPrefix}-${i+2}`));opened.push(...dynamicBulk);
   await until(()=>received.length===dynamicBefore+3,'Bulk history did not borrow the available shared slot');
   await new Promise(r=>setTimeout(r,30));assert.equal(received.length,dynamicBefore+3,'Aggregate native/bulk admission exceeded the gateway historical cap');
   pair[0].req.destroy();await until(()=>closed.includes(dynamicPrefix+'-0'),'Native cancellation did not release shared admission');
   await until(()=>received.length===dynamicBefore+4,'Queued bulk work did not progress after native cancellation');
   for(const item of [...pair,...dynamicBulk])item.req.destroy();
   await until(()=>[0,1,2,3].every(i=>closed.includes(dynamicPrefix+'-'+i)),'Shared admission retained obsolete requests');
   samples.push({run,currentMs,survivingQueueMs:queueMs,currentHeaders:health.headers,historyHeaders:next.headers,queuedCancellationNeverOnWire:true,activeCancellationReachedUpstream:true});
  }
  await until(()=>budget.diagnostics().active===0,'Proxy retained completed admissions');assert.deepEqual(budget.diagnostics(),{active:0,historicalActive:0,currentActive:0,nativeActive:0,bulkActive:0,waitingCurrent:0,waitingHistorical:0,closed:false});
  assert.equal(rejections,0,'The local proxy overcommitted actual upstream admission');
  receipts.push({mode,samples,upstreamRejections:rejections,totalActiveLimit:4,currentWaitingReserve:16,historyMaxSockets:3,nativeHistoryMaxSockets:2,bulkHistoryMaxSockets:2,currentMaxSockets:4,received,closed,scope:'Real Vite HTTP proxy with isolated fixture upstreams; no exchange, browser paint, Pi route or financial coverage acceptance'});
 }finally{
  for(const item of opened)item.req.destroy();
  if(proxy)for(const option of Object.values(proxy))if(typeof option==='object'&&option.agent&&typeof option.agent.destroy==='function')option.agent.destroy();
  if(mode==='dev')await server?.close();else if(server)await new Promise(resolve=>server.httpServer.close(resolve));
  history.closeAllConnections();secondHistory.closeAllConnections();current.closeAllConnections();await new Promise(resolve=>history.close(resolve));await new Promise(resolve=>secondHistory.close(resolve));await new Promise(resolve=>current.close(resolve));
 }
});
test.after(async()=>{await writeFile(process.env.IQ_PROXY_RECEIPT??'/tmp/iq-staging-proxy-capacity.json',JSON.stringify(receipts,null,2)+'\n');});

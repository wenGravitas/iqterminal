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
 const received=[],closed=[],history=http.createServer((req,res)=>{
  const id=new URL(req.url,'http://fixture').searchParams.get('id');received.push(id);
  res.on('close',()=>closed.push(id));
  if(id==='released'){res.setHeader('server-timing','fixture;dur=1');res.setHeader('x-iq-request-id','fixture-upstream');res.end('{"ready":true}');}
 });
 const current=http.createServer((req,res)=>{res.setHeader('server-timing','fixture;dur=1');res.setHeader('x-iq-request-id','fixture-current');res.end('{"healthy":true}');});
 let server,proxy;const opened=[];
 try{
  await listen(history);await listen(current);
  const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});assert.ok(loaded?.config.server?.proxy);
  const config=loaded.config;proxy=config.server.proxy;
  for(const option of Object.values(proxy))if(typeof option==='object')option.target=`http://127.0.0.1:${(String(option.target).endsWith(':18781')?current:history).address().port}`;
  if(mode==='dev'){server=await createServer({...config,configFile:false,mode:'staging',server:{...config.server,host:'127.0.0.1',port:0,strictPort:true,proxy}});await server.listen();}
  else server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:0,strictPort:true,proxy}});
  const base=`http://127.0.0.1:${server.httpServer.address().port}`,samples=[];
  for(let run=1;run<=5;run++){
   const before=received.length,prefix=mode+'-'+run,held=Array.from({length:4},(_,i)=>request(`${base}/market-data/v1/native-candles?id=${prefix}-${i}`));opened.push(...held);
   await until(()=>received.length===before+4,'Four bounded history sockets did not reach the upstream');
   const canceled=request(`${base}/market-data/v1/native-candles?id=${prefix}-canceled`),next=request(`${base}/market-data/v1/native-candles?id=released`);opened.push(canceled,next);
   await new Promise(r=>setTimeout(r,50));assert.equal(received.length,before+4,'Historical socket budget was exceeded');
   const health=request(`${base}/market-data/v2/history/health`);opened.push(health);
   await until(()=>health.body==='{"healthy":true}','Current health queued behind saturated history sockets');
   const currentMs=performance.now()-health.started;assert.ok(currentMs<1000,`Fixture current latency ${currentMs}ms`);
   assert.equal(health.headers['x-iq-request-id'],'fixture-current');
   assert.match(health.headers['server-timing'],/fixture;dur=1.*proxyqueue;dur=.*proxyheader;dur=/);
   assert.ok(Number(health.headers['x-iq-proxy-queue-ms'])>=0);
   canceled.req.destroy();await new Promise(r=>setTimeout(r,30));
   held[0].req.destroy();await until(()=>closed.includes(prefix+'-0'),'Active cancellation did not reach upstream');
   await until(()=>next.body==='{"ready":true}','Released upstream socket did not serve the surviving queued request');
   assert.ok(!received.includes(prefix+'-canceled'),'Canceled queued request reached the upstream');
   assert.equal(next.headers['x-iq-request-id'],'fixture-upstream');
   const queueMs=Number(next.headers['x-iq-proxy-queue-ms']);assert.ok(queueMs>=50,`Queued history wait missing: ${queueMs}`);
   for(const item of held)item.req.destroy();
   await until(()=>held.every((_,i)=>closed.includes(prefix+'-'+i)),'History requests leaked after consumer cancellation');
   samples.push({run,currentMs,survivingQueueMs:queueMs,currentHeaders:health.headers,historyHeaders:next.headers,queuedCancellationNeverOnWire:true,activeCancellationReachedUpstream:true});
  }
  receipts.push({mode,samples,historyMaxSockets:4,currentMaxSockets:4,received,closed,scope:'Real Vite HTTP proxy with isolated fixture upstreams; no exchange, browser paint, Pi route or financial coverage acceptance'});
 }finally{
  for(const item of opened)item.req.destroy();
  if(proxy)for(const option of Object.values(proxy))if(typeof option==='object'&&option.agent&&typeof option.agent.destroy==='function')option.agent.destroy();
  if(mode==='dev')await server?.close();else if(server)await new Promise(resolve=>server.httpServer.close(resolve));
  history.closeAllConnections();current.closeAllConnections();await new Promise(resolve=>history.close(resolve));await new Promise(resolve=>current.close(resolve));
 }
});
test.after(async()=>{await writeFile(process.env.IQ_PROXY_RECEIPT??'/tmp/iq-staging-proxy-capacity.json',JSON.stringify(receipts,null,2)+'\n');});

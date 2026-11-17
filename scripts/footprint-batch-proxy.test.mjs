import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGzip,constants} from 'node:zlib';
import {createServer,loadConfigFromFile,preview} from 'vite';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const until=async predicate=>{const deadline=performance.now()+2000;while(!predicate()){if(performance.now()>deadline)throw Error('Fixture condition timed out');await new Promise(resolve=>setTimeout(resolve,5));}};
for(const mode of ['dev','production-preview'])test(`${mode}: progressive POST body, reserved health and queued/active cancellation`,async()=>{
 const bodies=[],closed=[],aborts=[];
 const history=http.createServer(async(req,res)=>{
  if(req.url==='/v1/native-candles'){res.end('{"native":true}');return;}
  assert.equal(req.url,'/v2/history/footprints-batch');assert.equal(req.method,'POST');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());bodies.push(body);
  const id=bodies.length;res.once('close',()=>closed.push(id));
  res.writeHead(200,{'content-type':'application/x-ndjson','content-encoding':'gzip','x-iq-footprint-batch':'1','x-iq-batch-chunks':'6'});
  const gzip=createGzip({level:1});gzip.on('error',()=>{});res.once('close',()=>gzip.destroy());gzip.pipe(res);gzip.write('{"version":1,"kind":"chunk","index":0}\n');gzip.flush(constants.Z_SYNC_FLUSH);
 });
 const current=http.createServer((_req,res)=>res.end('{"healthy":true}'));let server,proxy;
 try{
  await listen(history);await listen(current);
  const loaded=await loadConfigFromFile({command:'serve',mode:'staging'}),config=loaded.config;proxy=config.server.proxy;
  const budget=config.plugins.find(plugin=>plugin.name==='staging-loopback-only').api.proxyBudget;
  for(const option of Object.values(proxy))if(typeof option==='object')option.target=`http://127.0.0.1:${(String(option.target).endsWith(':18781')?current:history).address().port}`;
  if(mode==='dev'){server=await createServer({...config,configFile:false,mode:'staging',server:{...config.server,port:0,strictPort:true,proxy}});await server.listen();}
  else server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:0,strictPort:true,proxy}});
  const base=`http://127.0.0.1:${server.httpServer.address().port}`,body={version:1,requests:Array.from({length:6},(_,index)=>({from:1800000000000+index*14400000,to:1800000000000+(index+1)*14400000,interval:'1h',rowPrice:25,market:'perpetual',known:'',retry:index===0}))};
  const post=()=>{const abort=new AbortController();aborts.push(abort);return {abort,promise:fetch(base+'/market-data/v2/history/footprints-batch',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify(body)})};};
  const active=[post(),post()];
  for(const item of active){const response=await item.promise;assert.equal(response.headers.get('x-iq-footprint-batch'),'1');const reader=response.body.getReader(),prefix=await reader.read();assert.match(new TextDecoder().decode(prefix.value),/"kind":"chunk"/);item.reader=reader;}
  assert.deepEqual(bodies,[body,body]);
  const queued=post(),rejected=assert.rejects(queued.promise,error=>error.name==='AbortError');await until(()=>budget.diagnostics().waitingHistorical===1);queued.abort.abort();await rejected;await until(()=>budget.diagnostics().waitingHistorical===0);assert.equal(bodies.length,2);
  const start=performance.now(),health=await fetch(base+'/market-data/v2/history/health');assert.deepEqual(await health.json(),{healthy:true});assert.ok(performance.now()-start<1000,'Fixture health queued behind batch transfers');
  assert.deepEqual(await (await fetch(base+'/market-data/v1/native-candles')).json(),{native:true});
  for(const item of active)item.abort.abort();await until(()=>closed.length===2&&budget.diagnostics().active===0);assert.equal(bodies.length,2);
 }finally{for(const abort of aborts)abort.abort();if(proxy)for(const option of Object.values(proxy))if(typeof option==='object'&&option.agent&&typeof option.agent.destroy==='function')option.agent.destroy();if(mode==='dev')await server?.close();else if(server)await new Promise(resolve=>server.httpServer.close(resolve));history.closeAllConnections();current.closeAllConnections();await Promise.all([new Promise(resolve=>history.close(resolve)),new Promise(resolve=>current.close(resolve))]);}
});

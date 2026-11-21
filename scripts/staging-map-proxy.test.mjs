import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createServer,loadConfigFromFile,preview} from 'vite';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const until=async(fn)=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture admission timeout');};
const get=url=>new Promise((resolve,reject)=>http.get(url,r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve(body));}).on('error',reject));
for(const mode of ['dev','production-preview'])test(`${mode}: liquidation map bypasses occupied bulk lanes with one independent socket`,{timeout:10000},async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'iq-map-proxy-'));
 let bulkCount=0,mapActive=0,mapPeak=0,server;const held=[];
 const bulk=http.createServer((_q,r)=>{bulkCount++;held.push(r);}),map=http.createServer((_q,r)=>{mapPeak=Math.max(mapPeak,++mapActive);setTimeout(()=>{r.end('{"fresh":true}');mapActive--;},20);});
 try{
  await listen(bulk);await listen(map);const loaded=await loadConfigFromFile({command:'serve',mode:'staging'}),config=loaded.config,proxy=config.server.proxy;config.cacheDir=cacheDir;config.optimizeDeps={noDiscovery:true,entries:[]};
  for(const [path,option] of Object.entries(proxy))option.target=`http://127.0.0.1:${(path==='/market-data/v1/liquidation-map'?map:bulk).address().port}`;
  if(mode==='dev'){server=await createServer({...config,configFile:false,mode:'staging',server:{...config.server,port:0,proxy}});await server.listen();}else server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:0,proxy}});
  const base=`http://127.0.0.1:${server.httpServer.address().port}`,a=get(base+'/market-data/v2/history/walls/batch'),b=get(base+'/market-data/v1/liquidations');a.catch(()=>{});b.catch(()=>{});
  await until(()=>bulkCount===2);
  const before=Date.now(),values=await Promise.all([get(base+'/market-data/v1/liquidation-map/health'),get(base+'/market-data/v1/liquidation-map/tiles')]);
  assert.deepEqual(values,['{"fresh":true}','{"fresh":true}']);assert.ok(held.every(r=>!r.writableEnded),'Map waited for bulk completion');assert.equal(mapPeak,1);assert.equal(bulkCount,2);
  for(const response of held)response.end('{}');await Promise.all([a,b]);
 }finally{
  for(const response of held)response.end('{}');
  if(mode==='dev')await server?.close();else if(server)await new Promise(r=>server.httpServer.close(r));
  bulk.closeAllConnections();map.closeAllConnections();await Promise.all([new Promise(r=>bulk.close(r)),new Promise(r=>map.close(r))]);await rm(cacheDir,{recursive:true,force:true});
 }
});

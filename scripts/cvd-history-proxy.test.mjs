import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,loadConfigFromFile,preview} from 'vite';
import {createStagingStaticServer} from './staging-static-server.mjs';
import routes from './staging-proxy-routes.json' with {type:'json'};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
for(const mode of ['dev','preview','static'])test(`${mode}: exact CVD and observation leases retain paths, methods, token headers and retry metadata`,async()=>{
 // Explicit loopback fixture only. No provider, collector or live-performance claim.
 const seen=[],root=await mkdtemp(join(tmpdir(),'iq-cvd-proxy-'));
 const history=http.createServer((req,res)=>{seen.push({path:req.url,method:req.method,token:req.headers['x-iq-minute-lease']});res.writeHead(req.url.startsWith('/v2/cvd')?503:200,{'content-type':'application/json','retry-after':'2'});res.end(JSON.stringify(seen.at(-1)));});
 let server,config;
 try{
  await listen(history);await writeFile(join(root,'index.html'),'<!doctype html><title>Proxy fixture</title>');await writeFile(join(root,'release.json'),'{}');
  const target=`http://127.0.0.1:${history.address().port}`;
  if(mode==='static'){
   server=createStagingStaticServer({staticRoot:root,releaseFile:join(root,'release.json'),routes,upstreams:Object.fromEntries([...new Set(routes.map(r=>r.upstream))].map(k=>[k,target])),port:0});
   if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  }else{
   config=(await loadConfigFromFile({command:'serve',mode:'staging'})).config;
   const proxy=config.server.proxy;
   // Check actual target selection before replacing transports, not route semantics.
   for(const path of ['/market-data/v2/cvd','/market-data/v2/history/recorded-minute-leases','/market-data/v2/history/recorded-minutes']){
    const selected=Object.keys(proxy).find(prefix=>path.startsWith(prefix));assert.equal(selected,'/market-data');
   }
   for(const option of Object.values(proxy))option.target=target;
   const common={...config,configFile:false,root,logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]}};
   if(mode==='dev'){server=await createServer({...common,server:{...config.server,port:0,strictPort:true}});await server.listen();}
   else server=await preview({...common,preview:{host:'127.0.0.1',port:0,strictPort:true,proxy}});
  }
  const transport=mode==='static'?server:server.httpServer,base=`http://127.0.0.1:${transport.address().port}`;
  for(const [method,path,token] of [
   ['GET','/v2/cvd?venue=binance&market=spot&symbol=BTCUSDT'],
   ['GET','/v2/cvd?venue=bybit&market=perpetual&symbol=BTCUSDT'],
   ['POST','/v2/history/recorded-minute-leases?market=spot'],
   ['GET','/v2/history/recorded-minutes?market=spot','fixture-private-token'],
   ['DELETE','/v2/history/recorded-minute-leases','fixture-private-token'],
  ]){
   const response=await fetch(base+'/market-data'+path,{method,headers:token?{'X-IQ-Minute-Lease':token}:{},signal:AbortSignal.timeout(3000)});
   assert.equal(response.status,path.startsWith('/v2/cvd')?503:200);assert.equal(response.headers.get('retry-after'),'2');
   assert.deepEqual(await response.json(),{method,path,...(token?{token}:{})});
  }
  assert.equal(seen.length,5);
 }finally{
  config?.plugins.find(p=>p.name==='staging-loopback-only')?.api.proxyBudget.close();
  for(const agent of new Set(Object.values(config?.server?.proxy??{}).map(p=>p.agent).filter(Boolean)))agent.destroy();
  if(mode==='dev')await server?.close();else {const transport=mode==='static'?server:server?.httpServer;if(transport){transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));}}
  history.closeAllConnections();await new Promise(resolve=>history.close(resolve));await rm(root,{recursive:true,force:true});
 }
});

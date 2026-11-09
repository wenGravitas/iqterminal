import {test,expect} from 'vitest';import http from 'node:http';import type {Duplex} from 'node:stream';import {createHash} from 'node:crypto';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createServer,loadConfigFromFile,type ProxyOptions} from 'vite';
async function listen(server:http.Server){await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));return (server.address() as {port:number}).port;}
async function until(check:()=>boolean){const end=performance.now()+2000;while(!check()){if(performance.now()>end)throw Error('Local fixture admission deadline');await new Promise(r=>setTimeout(r,10));}}
test('watch reads and stream use the current route while all historical proxy slots are occupied',async()=>{
 // Explicit local transport fixture; no collector, exchange, API or live watch action.
 const held:http.ServerResponse[]=[],closed=new Set<string>(),currentPaths:string[]=[],upgraded=new Set<Duplex>(),controllers:AbortController[]=[],pending:Promise<unknown>[]=[];
 const history=http.createServer((req,res)=>{held.push(res);res.once('close',()=>closed.add(req.url!));}),current=http.createServer((req,res)=>{currentPaths.push(req.url!);res.setHeader('Content-Type','application/json');res.end('{"fixture":true}');});
 current.on('upgrade',(req,socket)=>{currentPaths.push(req.url!);upgraded.add(socket);socket.once('close',()=>upgraded.delete(socket));const accept=createHash('sha1').update(req.headers['sec-websocket-key']!+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');});
 const historyPort=await listen(history),currentPort=await listen(current),root=await mkdtemp(join(tmpdir(),'iq-watch-proxy-'));let server:Awaited<ReturnType<typeof createServer>>|undefined,ws:WebSocket|undefined;
 try{
  await writeFile(join(root,'index.html'),'<!doctype html><title>Explicit proxy fixture</title>');const loaded=await loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts'));if(!loaded)throw Error('Missing staging config');const config=loaded.config,proxy=config.server!.proxy!;
  // Replace only transport destinations; preserve real routing, agents and budget.
  for(const [path,option] of Object.entries(proxy)){if(typeof option==='string')continue;(option as ProxyOptions).target=`http://127.0.0.1:${path.includes('/level-watches')||path==='/market-data/v1/health'?currentPort:historyPort}`;}
  server=await createServer({...config,configFile:false,root,logLevel:'silent',server:{...config.server,port:0,strictPort:true},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();const port=(server.httpServer!.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
  for(const path of ['/market-data/v2/history/fixture?one','/market-data/v2/history/fixture?two','/market-data/v1/native-candles?interval=5m']){const control=new AbortController();controllers.push(control);pending.push(fetch(base+path,{signal:control.signal}).catch(()=>{}));}
  await until(()=>held.length===3);
  const watch=await fetch(base+'/market-data/v1/level-watches',{signal:AbortSignal.timeout(2000)});expect(watch.status).toBe(200);expect(await watch.json()).toEqual({fixture:true});expect(currentPaths).toContain('/v1/level-watches');expect(held).toHaveLength(3);
  const health=await fetch(base+'/market-data/v1/health',{signal:AbortSignal.timeout(2000)});expect(health.status).toBe(200);await health.text();
  ws=new WebSocket(`ws://127.0.0.1:${port}/market-data/v1/level-watches/stream`);await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('Watch stream queued behind history')),2000);ws!.addEventListener('open',()=>{clearTimeout(timer);done();},{once:true});ws!.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Watch stream fixture error'));},{once:true});});expect(currentPaths).toContain('/v1/level-watches/stream');expect(held).toHaveLength(3);
  controllers[0]!.abort();await until(()=>closed.has('/v2/history/fixture?one'));
  for(let cycle=0;cycle<3;cycle++){const path='/v2/history/fixture?cycle='+cycle,control=new AbortController();controllers.push(control);pending.push(fetch(base+'/market-data'+path,{signal:control.signal}).catch(()=>{}));await until(()=>held.length===4+cycle);control.abort();await until(()=>closed.has(path));}
  expect(closed.has('/v2/history/fixture?two')).toBe(false);expect(closed.has('/v1/native-candles?interval=5m')).toBe(false);
 }finally{
  for(const c of controllers)c.abort();for(const r of held)r.destroy();ws?.close();for(const socket of upgraded)socket.destroy();await Promise.allSettled(pending);await server?.close();history.closeAllConnections();current.closeAllConnections();await Promise.all([new Promise<void>(r=>history.close(()=>r())),new Promise<void>(r=>current.close(()=>r()))]);await rm(root,{recursive:true,force:true});
 }
},10000);

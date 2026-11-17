import {loadConfigFromFile,preview} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const out='artifacts/pi-history-r1/projection-source-r1';
const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});if(!loaded?.config.server?.proxy)throw Error('Established staging proxy required');
const config=loaded.config,proxy=config.server.proxy;
const expected=JSON.parse(await readFile('artifacts/pi-history-r1/transport-r2/preview-range-fix.json','utf8')).routes;
for(const [path,target] of Object.entries(expected)){const actual=proxy[path];if((typeof actual==='string'?actual:actual?.target)!==target)throw Error('Comparison proxy route mismatch: '+path);}
const server=await preview({...config,configFile:false,mode:'staging',build:{...config.build,outDir:out+'/dist'},preview:{host:'127.0.0.1',port:4201,strictPort:true,proxy}});
await writeFile(out+'/preview.json',JSON.stringify({pid:process.pid,port:4201,build:'7eb4a00b60daf344188eebc0659a8a82862113e8',dataMode:'staging',historyTiles:true,routes:Object.fromEntries(Object.entries(proxy).map(([path,value])=>[path,typeof value==='string'?value:value.target]))},null,2)+'\n');
console.log('Exact production staging preview on loopback4201');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const value of Object.values(proxy))if(typeof value==='object'&&value.agent&&typeof value.agent.destroy==='function')value.agent.destroy();server.httpServer.close(()=>process.exit(0));});

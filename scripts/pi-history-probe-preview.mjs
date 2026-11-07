/** Separate production preview for a private isolated staging-history gateway. */
import {loadConfigFromFile,preview} from 'vite';import {writeFile} from 'node:fs/promises';
if(process.env.IQ_HISTORY_PROBE_PREVIEW!=='1')throw Error('Explicit isolated preview opt-in required');
const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});if(!loaded?.config.server?.proxy)throw Error('Missing established staging proxy configuration');
const config=loaded.config,proxy=config.server.proxy;
for(const value of Object.values(proxy))if(typeof value==='object'&&value.target==='http://127.0.0.1:18780')value.target='http://127.0.0.1:18794';
// Retain the separate current/health agents and existing private loopback guard.
const server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:4182,strictPort:true,proxy}});
const routes=Object.fromEntries(Object.entries(proxy).map(([path,value])=>[path,typeof value==='string'?value:value.target]));
if(process.env.IQ_HISTORY_PROBE_RECEIPT)await writeFile(process.env.IQ_HISTORY_PROBE_RECEIPT,JSON.stringify({port:4182,pid:process.pid,routes,scope:'Production dist; history via isolated SSH18794, current/health via existing independent18781'},null,2));
console.log(JSON.stringify({port:4182,pid:process.pid,routes}));
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;stopping=true;for(const value of Object.values(proxy))if(typeof value==='object'&&value.agent&&typeof value.agent.destroy==='function')value.agent.destroy();server.httpServer.close(()=>process.exit(0));});

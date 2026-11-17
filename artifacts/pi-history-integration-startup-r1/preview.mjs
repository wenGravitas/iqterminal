import {loadConfigFromFile,preview} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const dir='artifacts/pi-history-integration-startup-r1',phase=process.env.IQ_STARTUP_PHASE??'diagnostic';
if(!['diagnostic','verification'].includes(phase))throw Error('Explicit diagnostic/verification phase required');
const manifest=JSON.parse(await readFile(`${dir}/${phase}-build.json`,'utf8'));if(manifest.exitCode!==0||!/^[a-f0-9]{40}$/.test(manifest.commit))throw Error('Verified build manifest required');
const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});if(!loaded?.config.server?.proxy)throw Error('Established staging proxy required');
const config=loaded.config,proxy=config.server.proxy;
for(const [path,option]of Object.entries(proxy)){const target=typeof option==='string'?option:option.target;if(!['http://127.0.0.1:18880','http://127.0.0.1:18881'].includes(target))throw Error('Unexpected route '+path);}
const server=await preview({...config,configFile:false,mode:'staging',build:{...config.build,outDir:manifest.outDir},preview:{host:'127.0.0.1',port:4202,strictPort:true,proxy}});
await writeFile(`${dir}/preview-${phase}.json`,JSON.stringify({pid:process.pid,port:4202,build:manifest.commit,phase,buildFlags:manifest.flags,startupTrace:process.env.IQ_STARTUP_TRACE==='1',routes:Object.fromEntries(Object.entries(proxy).map(([p,o])=>[p,typeof o==='string'?o:o.target]))},null,2)+'\n');
console.log('Integrated startup candidate '+manifest.commit+' on loopback4202');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const option of Object.values(proxy))if(typeof option==='object'&&option.agent&&typeof option.agent.destroy==='function')option.agent.destroy();server.httpServer.close(()=>process.exit(0));});

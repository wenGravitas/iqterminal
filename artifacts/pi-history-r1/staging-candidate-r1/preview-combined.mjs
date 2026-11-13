import {loadConfigFromFile,preview} from 'vite';import {writeFile} from 'node:fs/promises';
const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});if(!loaded?.config.server?.proxy)throw Error('Established staging proxy required');
const config=loaded.config,proxy=config.server.proxy,out='artifacts/pi-history-r1/staging-candidate-r1';
const server=await preview({...config,configFile:false,mode:'staging',build:{...config.build,outDir:out+'/dist-combined'},preview:{host:'127.0.0.1',port:4194,strictPort:true,proxy}});
await writeFile(out+'/preview-combined.json',JSON.stringify({pid:process.pid,port:4194,build:'9a526dcbe5495405205b10da78c4328a6e3d6831',dataMode:'staging',historyTiles:true,routes:Object.fromEntries(Object.entries(proxy).map(([path,value])=>[path,typeof value==='string'?value:value.target]))},null,2)+'\n');
console.log('Production staging preview on loopback4194');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const value of Object.values(proxy))if(typeof value==='object'&&value.agent&&typeof value.agent.destroy==='function')value.agent.destroy();server.httpServer.close(()=>process.exit(0));});

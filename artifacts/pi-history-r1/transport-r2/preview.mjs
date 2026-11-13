import {loadConfigFromFile,preview} from 'vite';import {writeFile} from 'node:fs/promises';
const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});if(!loaded?.config.server?.proxy)throw Error('Established staging proxy required');
const config=loaded.config,proxy=config.server.proxy,out='artifacts/pi-history-r1/transport-r2';
const server=await preview({...config,configFile:false,mode:'staging',build:{...config.build,outDir:out+'/dist'},preview:{host:'127.0.0.1',port:4196,strictPort:true,proxy}});
await writeFile(out+'/preview-validation.json',JSON.stringify({pid:process.pid,port:4196,build:'168918c163522dd7366c623bd753dc847ce4b632',dataMode:'staging',historyTiles:true,routes:Object.fromEntries(Object.entries(proxy).map(([path,value])=>[path,typeof value==='string'?value:value.target]))},null,2)+'\n');
console.log('Production staging preview on loopback4196');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const value of Object.values(proxy))if(typeof value==='object'&&value.agent&&typeof value.agent.destroy==='function')value.agent.destroy();server.httpServer.close(()=>process.exit(0));});

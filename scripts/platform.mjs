import {launch,url} from './browser.mjs';import{writeFile}from'node:fs/promises';
const b=await launch(false),p=await b.newPage();const result={};
for(const [name,address] of [['blank','about:blank'],['idleTerminal',url+'/?fixture=1']]){await p.goto(address);await p.waitForTimeout(1500);result[name]=await p.evaluate(()=>new Promise(resolve=>{const values=[];let previous=0;const tick=t=>{if(previous)values.push(t-previous);previous=t;if(values.length<120)requestAnimationFrame(tick);else resolve(values);};requestAnimationFrame(tick);}));}
const session=await b.newBrowserCDPSession();result.system=await session.send('SystemInfo.getInfo').catch(e=>({error:e.message}));console.log(JSON.stringify(result));await writeFile('artifacts/platform.json',JSON.stringify(result,null,2));await b.close();

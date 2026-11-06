/** Pinned one-hour transport diagnostic. No rendering or 30h gate claim. */
import http from 'node:http';import https from 'node:https';import {gunzip as gunzipCallback} from 'node:zlib';import {promisify} from 'node:util';import {createHash} from 'node:crypto';import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
const gunzip=promisify(gunzipCallback),[base,expectedFile,output,countArg]=process.argv.slice(2),count=Number(countArg??5);
if(!base||!expectedFile||!output||!Number.isInteger(count)||count<1||count>5)throw Error('base pinned-manifest.json output.jsonl samples(1..5) required');
const expected=JSON.parse(readFileSync(expectedFile,'utf8')),market=expected.request.market,key=expected.key;
writeFileSync(output,'');
async function request(url,agent,signal){
 const started=performance.now();let socketAt,connectedAt,headersAt,wireBytes=0;
 return await new Promise((resolve,reject)=>{
  const fail=e=>{e.record={url:url.toString(),failed:String(e),totalMs:performance.now()-started,queueMs:socketAt===undefined?null:socketAt-started,headerWaitMs:headersAt===undefined?null:headersAt-socketAt,wireBytes};reject(e);};
  const transport=url.protocol==='https:'?https:http;
  const req=transport.get(url,{agent,signal,headers:{'Accept-Encoding':'gzip','X-IQ-View-Id':'prepared-wall-route-diagnostic'}},res=>{
   headersAt=performance.now();const chunks=[];
   if(res.statusCode!==200){res.resume();fail(Error(`HTTP ${res.statusCode}`));return;}
   res.on('data',chunk=>{wireBytes+=chunk.byteLength;if(wireBytes>4*1024*1024+1024){req.destroy(Error('Diagnostic wire byte budget'));return;}chunks.push(chunk);});
   res.on('error',fail);res.on('end',async()=>{try{
    const receivedAt=performance.now(),wire=Buffer.concat(chunks),decompressAt=performance.now();
    const raw=res.headers['content-encoding']==='gzip'?await gunzip(wire):wire,decompressedAt=performance.now();if(raw.byteLength>4*1024*1024)throw Error('Diagnostic decoded byte budget');
    const data=JSON.parse(raw.toString()),parsedAt=performance.now(),hash=createHash('sha256').update(raw).digest('hex'),finished=performance.now();
    resolve({data,hash,record:{url:url.toString(),status:res.statusCode,totalMs:finished-started,queueMs:socketAt-started,connectWithinHeaderMs:connectedAt?connectedAt-socketAt:null,headerWaitMs:headersAt-socketAt,transferMs:receivedAt-headersAt,decompressMs:decompressedAt-decompressAt,jsonParseMs:parsedAt-decompressedAt,hashMs:finished-parsedAt,wireBytes,decodedBytes:raw.byteLength,headers:res.headers}});
   }catch(e){fail(e);}});
  });
  req.on('socket',socket=>{socketAt=performance.now();if(socket.connecting)socket.once('connect',()=>{connectedAt=performance.now();});});req.on('error',fail);
 });
}
for(let run=1;run<=count;run++){
 const origin=new URL(base),agent=origin.protocol==='https:'?new https.Agent({keepAlive:true,maxSockets:2}):new http.Agent({keepAlive:true,maxSockets:2});
 const started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000),requests=[],errors=[];let firstVerifiedPartMs=null,completeMs=null,parts=0,manifest;
 const read=async(path)=>{try{const result=await request(new URL(base.replace(/\/$/,'')+path),agent,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));requests.push(result.record);return result;}catch(e){if(e.record)requests.push(e.record);throw e;}};
 try{
  const found=await read(`/v2/history/walls/manifest?market=${market}&key=${key}`);manifest=found.data;
  if(JSON.stringify(manifest)!==JSON.stringify(expected))throw Error('Manifest differs from pinned sample');
  let next=0;
  await Promise.all(Array.from({length:2},async()=>{while(next<manifest.parts.length&&!controller.signal.aborted){const part=manifest.parts[next++];try{
   const result=await read(`/v2/history/walls/part?market=${market}&key=${key}&hash=${part.hash}`);
   if(result.hash!==part.hash||result.record.headers['x-iq-source-revision']!==manifest.request.sourceRevision||Number(result.record.headers['x-iq-db-queries'])!==0)throw Error('Prepared part reference/hash/DB validation failed');
   parts++;firstVerifiedPartMs??=performance.now()-started;
  }catch(e){errors.push({part:part.index,message:String(e)});}}}));
  if(parts===manifest.parts.length&&!errors.length)completeMs=performance.now()-started;
  else if(controller.signal.aborted)errors.push({stage:'run-deadline',message:'45-second diagnostic observation ended with incomplete received coverage'});
 }catch(e){errors.push({stage:'manifest-or-run',message:String(e)});}finally{clearTimeout(timer);agent.destroy();}
 const result={kind:'prepared-wall-one-hour-route-diagnostic',run,base,market,key,from:expected.request.from,to:expected.request.to,watermark:expected.watermark,sourceRevision:expected.request.sourceRevision,arch:process.arch,node:process.version,firstVerifiedPartMs,completeMs,partsReceived:parts,partsRequested:expected.parts.length,coverage:expected.coverage,requests,errors,totalMs:performance.now()-started,scope:'No HTTP cache; new two-socket agent per run; request phase durations overlap across parallel parts, connect is within header wait; no browser paint or 30h acceptance claim'};
 appendFileSync(output,JSON.stringify(result)+'\n');console.log(JSON.stringify({run,base,parts,firstVerifiedPartMs,completeMs,errors}));
}

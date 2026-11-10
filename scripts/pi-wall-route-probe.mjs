/** Read-only comparison of identical immutable wall bytes. Timings stay on
 * each observing host; these are transport samples, never chart paint gates. */
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const [configFile,base,label]=process.argv.slice(2);
const target=new URL(base);
if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash)throw Error('Explicit loopback HTTP route required');
if(!/^[a-zA-Z0-9._-]{1,80}$/.test(label??''))throw Error('Explicit route label required');
const config=JSON.parse(readFileSync(configFile,'utf8'));
if(config.version!==1||!Array.isArray(config.cases)||config.cases.length!==2)throw Error('Expected two pinned immutable batch identities');
function control(path,method,body){
 return new Promise((resolve,reject)=>{
  const url=new URL(target.pathname.replace(/\/$/,'')+path,target);
  const request=http.request(url,{method,agent:false,headers:body?{'Content-Type':'application/json'}:{}},response=>{
   let text='';response.on('data',chunk=>{text+=chunk;if(text.length>4096)response.destroy(Error('Control response byte limit'));});
   response.on('error',reject);response.on('end',()=>{try{if(response.statusCode!==200)throw Error('Lease control HTTP '+response.statusCode);resolve(JSON.parse(text));}catch(error){reject(error);}});
  });
  const timer=setTimeout(()=>request.destroy(Error('Lease control deadline')),10000);
  request.on('close',()=>clearTimeout(timer));request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
 });
}
for(const item of config.cases){
 if(!['spot','perpetual'].includes(item.market)||![item.key,item.canonicalKey,item.sourceToken].every(value=>/^[a-f0-9]{64}$/.test(value??'')))throw Error('Invalid pinned identity');
 for(let run=1;run<=5;run++){
  const consumer=randomUUID(),lease={consumer,canonicalKey:item.canonicalKey,projectionKey:item.key};let renew,leaseError,pendingRenewal;
  const url=new URL(target);
  url.pathname=target.pathname.replace(/\/$/,'')+'/v2/history/walls/projection-batch';
  url.search=new URLSearchParams({market:item.market,key:item.key,start:'0',version:'3'});
  let headersMs=null,start=performance.now();
  try{
   const retained=await control('/v2/history/walls/reader','POST',lease);
   if(retained.leaseMs!==15000||retained.canonicalKey!==item.canonicalKey||retained.projectionKey!==item.key)throw Error('Lease identity mismatch');
   renew=setInterval(()=>{if(pendingRenewal)return;pendingRenewal=control('/v2/history/walls/reader','POST',lease).catch(error=>{leaseError=String(error);}).finally(()=>{pendingRenewal=undefined;});},5000);
   start=performance.now();
   const result=await new Promise((resolve,reject)=>{
    const request=http.get(url,{headers:{'Accept-Encoding':'br','X-IQ-Wall-Reader':consumer},agent:false},response=>{
     headersMs=performance.now()-start;let bytes=0;const hash=createHash('sha256');
     response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){response.destroy(Error('Bounded wire byte limit'));return;}hash.update(chunk);});
     response.on('error',reject);
     response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes,sha256:hash.digest('hex'),complete:response.complete}));
    });
    const timer=setTimeout(()=>request.destroy(Error('Transport observation deadline 60s')),60000);
    request.on('close',()=>clearTimeout(timer));request.on('error',reject);
   });
   const totalMs=performance.now()-start;
   const valid=!leaseError&&result.status===200&&result.complete&&result.headers['content-encoding']==='br'&&Number(result.headers['content-length'])===result.bytes&&result.headers.etag==='"'+result.sha256+'"'&&result.headers['x-iq-source-revision']===item.sourceToken;
   console.log(JSON.stringify({kind:'immutable-wall-route',label,market:item.market,key:item.key,run,at:new Date().toISOString(),headersMs,totalMs,transferAfterHeadersMs:totalMs-headersMs,...result,leaseError,valid,scope:'First bounded immutable batch after acknowledged reader lease; not full history, decoded financial equivalence, current continuity or painted latency'}));
  }catch(error){console.log(JSON.stringify({kind:'immutable-wall-route',label,market:item.market,key:item.key,run,headersMs,totalMs:performance.now()-start,valid:false,error:String(error)}));}
  finally{clearInterval(renew);await pendingRenewal;try{await control('/v2/history/walls/preparation?consumer='+consumer,'DELETE');}catch(error){console.log(JSON.stringify({kind:'release-error',label,market:item.market,run,error:String(error)}));}}
 }
}

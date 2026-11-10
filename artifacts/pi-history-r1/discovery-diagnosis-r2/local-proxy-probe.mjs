/** Explicit synthetic transport diagnosis only; no browser or venue data. */
import http from 'node:http';import{createHash}from'node:crypto';import{performance}from'node:perf_hooks';import{loadConfigFromFile,preview}from'vite';
if(process.env.IQ_PROXY_LOCAL_PROBE!=='1')throw Error('Explicit synthetic proxy diagnosis required');
const body=Buffer.alloc(496022);for(let i=0;i<body.length;i++)body[i]=(i*31+i%251)%256;
const sha=createHash('sha256').update(body).digest('hex');
const backend=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':body.length});res.end(body);});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));let server,proxy;
async function read(url){const at=performance.now();return new Promise((resolve,reject)=>{const req=http.get(url,{agent:false},res=>{const headersMs=performance.now()-at;let bytes=0;const hash=createHash('sha256');res.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);});res.on('error',reject);res.on('end',()=>{const actual=hash.digest('hex');if(res.statusCode!==200||!res.complete||bytes!==body.length||actual!==sha)return reject(Error('Transport identity mismatch'));resolve({headersMs,totalMs:performance.now()-at,bytes,sha256:actual,headers:res.headers});});});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('Local diagnostic timeout')));});}
try{
 const {config}=await loadConfigFromFile({command:'serve',mode:'staging'});proxy=config.server.proxy;
 for(const option of Object.values(proxy))if(typeof option==='object')option.target='http://127.0.0.1:'+backend.address().port;
 server=await preview({...config,configFile:false,mode:'staging',preview:{host:'127.0.0.1',port:0,strictPort:true,proxy}});
 const via='http://127.0.0.1:'+server.httpServer.address().port+'/market-data/v2/history/walls/projection-batch',direct='http://127.0.0.1:'+backend.address().port+'/v2/history/walls/projection-batch';
 for(let run=1;run<=5;run++)for(const [route,url]of run%2?[['direct',direct],['preview',via]]:[['preview',via],['direct',direct]])console.log(JSON.stringify({run,route,...await read(url),load:(await import('node:fs')).readFileSync('/proc/loadavg','utf8').trim(),scope:'Synthetic local496022byte HTTP body through incumbent production-preview proxy; no SSH, financial data, browser paint or performance acceptance'}));
}finally{
 if(proxy)for(const option of Object.values(proxy))if(typeof option==='object'&&option.agent?.destroy)option.agent.destroy();
 if(server){server.httpServer.closeAllConnections();await new Promise(r=>server.httpServer.close(r));}
 backend.closeAllConnections();await new Promise(r=>backend.close(r));
}

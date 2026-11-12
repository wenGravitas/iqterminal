import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse,ClientRequest} from 'node:http';
import type {ProxyOptions} from 'vite';

const admissionStarts=new WeakMap<IncomingMessage,number>();
interface State {start:number;id?:string;socketAt?:number;assignedAt?:number;counts?:()=>unknown;terminal?:boolean}
const states=new WeakMap<IncomingMessage,State>();
const enabled=process.env.IQ_STARTUP_TRACE==='1',loop=enabled?monitorEventLoopDelay({resolution:20}):undefined;loop?.enable();
let records=0,blocked=false,dropped=0;
const relevant=(r:IncomingMessage)=>/^\/market-data\/(?:v2\/history\/|v1\/(?:health|native-candles|footprints|order-walls\/archive))/.test(r.url??'');
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_:.-]{1,120}$/.test(v);
function trace(request:IncomingMessage,event:string,extra:Record<string,unknown>={}){
 const s=states.get(request);if(!enabled||!s?.id||records>=4096)return;
 if(blocked){dropped++;return;}
 const line=JSON.stringify({kind:'startup-proxy',id:s.id,event,ms:performance.now()-s.start,path:(request.url??'').split('?')[0],counts:s.counts?.(),eventLoopMaxMs:loop&&Number.isFinite(loop.max)?loop.max/1e6:0,dropped,...extra})+'\n';
 records++;if(!process.stdout.write(line)){blocked=true;process.stdout.once('drain',()=>{blocked=false;});}
}
/** Start before admission, so a request that never obtains a socket still has
 * a client/proxy/gateway correlation identity and a bounded terminal record. */
export function markProxyAdmission(request:IncomingMessage,start:number,response?:ServerResponse,counts?:()=>unknown){
 admissionStarts.set(request,start);
 if(!relevant(request))return;
 request.headers??={};const supplied=request.headers['x-iq-request-id'];const id=validId(supplied)?supplied:randomUUID();request.headers['x-iq-request-id']=id;
 const s:State={start,id,counts};states.set(request,s);response?.setHeader('X-IQ-Request-Id',id);trace(request,'arrival');
 if(!enabled)return;
 request.once('aborted',()=>trace(request,'client-aborted'));
 request.once('error',(e:NodeJS.ErrnoException)=>trace(request,'client-error',{code:e.code}));
 response?.once('finish',()=>{s.terminal=true;trace(request,'response-finish',{status:response.statusCode});});
 response?.once('close',()=>trace(request,'response-close',{finished:s.terminal===true,status:response.statusCode}));
}
export function markProxyDispatch(request:IncomingMessage){trace(request,'admitted');}
/** All durations use the proxy monotonic clock. They are nested within client
 * header wait, not additional exclusive network phases. No bodies are retained. */
export const observeStagingProxy:NonNullable<ProxyOptions['configure']>=(proxy)=>{
 proxy.on('start',(request:IncomingMessage)=>{const prior=states.get(request);states.set(request,{...prior,start:admissionStarts.get(request)??prior?.start??performance.now()});admissionStarts.delete(request);trace(request,'proxy-start');});
 proxy.on('proxyReq',(upstream:ClientRequest,request:IncomingMessage)=>{
  const state=states.get(request);if(!state)return;state.socketAt=performance.now();if(state.id)upstream.setHeader('X-IQ-Request-Id',state.id);
  trace(request,'upstream-request',{reusedSocket:upstream.reusedSocket});
  upstream.once('socket',socket=>{state.assignedAt=performance.now();trace(request,'socket-assigned',{connecting:socket.connecting});socket.once('connect',()=>trace(request,'socket-connected'));});
  // A pooled socket is usually assigned before http-proxy emits proxyReq.
  if(upstream.socket){state.assignedAt=performance.now();trace(request,'socket-assigned',{connecting:upstream.socket.connecting,reusedSocket:upstream.reusedSocket});if(upstream.socket.connecting)upstream.socket.once('connect',()=>trace(request,'socket-connected'));}
  upstream.once('finish',()=>trace(request,'upstream-request-finish'));
  upstream.once('timeout',()=>trace(request,'upstream-timeout'));
  upstream.once('error',(e:NodeJS.ErrnoException)=>trace(request,'upstream-error',{code:e.code}));
  upstream.once('close',()=>trace(request,'upstream-close'));
 });
 proxy.on('proxyRes',(response,request:IncomingMessage)=>{
  const state=states.get(request);if(!state||state.socketAt===undefined)return;
  const queue=Math.max(0,state.socketAt-state.start).toFixed(2),header=Math.max(0,performance.now()-state.socketAt).toFixed(2);
  response.headers['x-iq-proxy-queue-ms']=queue;response.headers['x-iq-proxy-header-ms']=header;
  trace(request,'upstream-headers',{status:response.statusCode,queueMs:Number(queue),headerMs:Number(header)});
  response.once('end',()=>trace(request,'upstream-response-end'));response.once('aborted',()=>trace(request,'upstream-response-aborted'));
  const existing=response.headers['server-timing'];response.headers['server-timing']=[...(Array.isArray(existing)?existing:existing?[existing]:[]),`proxyqueue;dur=${queue}`,`proxyheader;dur=${header}`].join(', ');
 });
 proxy.on('error',(error,request)=>trace(request as IncomingMessage,'proxy-error',{code:(error as NodeJS.ErrnoException).code}));
};

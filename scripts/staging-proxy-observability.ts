import {performance} from 'node:perf_hooks';
import type {IncomingMessage} from 'node:http';
import type {ProxyOptions} from 'vite';

/** Durations share the proxy's monotonic clock; they are nested inside the
 * client's header wait, never additional exclusive network phases. Weak keys
 * retain no completed or cancelled request bodies/history. */
export const observeStagingProxy:NonNullable<ProxyOptions['configure']>=(proxy)=>{
 const requests=new WeakMap<IncomingMessage,{start:number;socketAt?:number}>();
 proxy.on('start',(request:IncomingMessage)=>{requests.set(request,{start:performance.now()});});
 proxy.on('proxyReq',(_upstream,request:IncomingMessage)=>{
  const state=requests.get(request);if(state)state.socketAt=performance.now();
 });
 proxy.on('proxyRes',(response,request:IncomingMessage)=>{
  const state=requests.get(request);requests.delete(request);
  if(!state||state.socketAt===undefined)return;
  const queue=Math.max(0,state.socketAt-state.start).toFixed(2),header=Math.max(0,performance.now()-state.socketAt).toFixed(2);
  response.headers['x-iq-proxy-queue-ms']=queue;
  response.headers['x-iq-proxy-header-ms']=header;
  const existing=response.headers['server-timing'];
  response.headers['server-timing']=[...(Array.isArray(existing)?existing:existing?[existing]:[]),`proxyqueue;dur=${queue}`,`proxyheader;dur=${header}`].join(', ');
 });
};

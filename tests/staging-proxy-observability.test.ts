import {test,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {StagingProxyBudget} from '../scripts/staging-proxy-budget';
import {markProxyAdmission,observeStagingProxy} from '../scripts/staging-proxy-observability';
class Response extends EventEmitter {destroyed=false;statusCode=200;headers:Record<string,unknown>={};setHeader(k:string,v:unknown){this.headers[k]=v;}writeHead(s:number,h:Record<string,unknown>){this.statusCode=s;Object.assign(this.headers,h);return this;}end(){this.emit('finish');}destroy(){this.destroyed=true;this.emit('close');}}
function request(id?:unknown){return Object.assign(new EventEmitter(),{url:'/market-data/v2/history/footprint-current?interval=5m&rowPrice=25',headers:id?{'x-iq-request-id':id}:{}}) as unknown as IncomingMessage;}
test('request identity exists even when capacity refuses work before any upstream headers',()=>{
 const budget=new StagingProxyBudget(()=> 'current');let started=0;
 for(let i=0;i<20;i++)budget.middleware(request(),new Response() as unknown as ServerResponse,()=>started++);
 const r=request('client-startup:failed'),res=new Response();budget.middleware(r,res as unknown as ServerResponse,()=>started++);
 expect(started).toBe(4);expect(res.statusCode).toBe(503);expect(res.headers['X-IQ-Request-Id']).toBe('client-startup:failed');expect(r.headers['x-iq-request-id']).toBe('client-startup:failed');budget.close();
});
test('proxy preserves a safe client ID through dispatch and replaces unsafe header values',()=>{
 const req=request('client-startup:1'),res=new Response();markProxyAdmission(req,performance.now(),res as unknown as ServerResponse);
 const proxy=new EventEmitter();(observeStagingProxy as any)(proxy);proxy.emit('start',req);
 const headers:Record<string,string>={},upstream=Object.assign(new EventEmitter(),{setHeader:(k:string,v:string)=>{headers[k]=v;},socket:{connecting:false},reusedSocket:true});proxy.emit('proxyReq',upstream,req);
 expect(headers['X-IQ-Request-Id']).toBe('client-startup:1');
 const unsafe=request(['multiple','ids']);markProxyAdmission(unsafe,performance.now(),new Response() as unknown as ServerResponse);expect(unsafe.headers['x-iq-request-id']).toMatch(/^[a-f0-9-]{36}$/);
});

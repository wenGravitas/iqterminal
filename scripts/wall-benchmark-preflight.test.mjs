import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {wallBenchmarkSourceRequest,wallBenchmarkPreflight,openColdWallBenchmarkPanel} from './wall-benchmark-preflight.mjs';
const reference={from:2000,to:3000,sourceFrom:1000,sourceTo:4000,sourceToken:'a'.repeat(64)};
const proof=()=>({...wallBenchmarkSourceRequest('spot',reference),version:1,kind:'wall-source-sha256-xor-v1',eligible:true,token:reference.sourceToken});
test('source preflight uses only the original source read and rejects changed identity',async()=>{
 let requests=[];const server=createServer((req,res)=>{requests.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(proof()));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await wallBenchmarkPreflight('http://127.0.0.1:'+server.address().port,'spot',reference);assert.equal(result.state,'eligible');assert.equal(result.jobsRequested,false);assert.equal(requests.length,1);const url=new URL(requests[0],'http://localhost');assert.equal(url.pathname,'/market-data/v2/history/walls/source');assert.equal(url.searchParams.get('from'),'1000');assert.equal(url.searchParams.get('to'),'4000');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('changed token and unavailable source refuse baseline acceptance without altering reference',async()=>{
 const original=structuredClone(reference);
 for(const [change,reason]of [[p=>({...p,token:'b'.repeat(64)}),'reference-source-changed'],[p=>({...p,eligible:false}),'source-ineligible']]){const result=await wallBenchmarkPreflight('http://localhost','spot',reference,{fetcher:async()=>Response.json(change(proof()))});assert.equal(result.state,'refused');assert.equal(result.reason,reason);}
 assert.deepEqual(reference,original);
});
test('malformed context, HTTP failure and oversized bodies never qualify',async()=>{
 for(const response of [Response.json({...proof(),from:5}),new Response('offline',{status:503}),new Response(' '.repeat(65537))]){const result=await wallBenchmarkPreflight('http://localhost','spot',reference,{fetcher:async()=>response});assert.equal(result.state,'refused');assert.equal(result.reason,'source-unavailable');}
});
test('explicit cancellation does not qualify or retry',async()=>{
 let calls=0;const abort=new AbortController();abort.abort();const result=await wallBenchmarkPreflight('http://localhost','spot',reference,{signal:abort.signal,fetcher:async(_url,{signal})=>{calls++;signal.throwIfAborted();}});assert.equal(result.reason,'source-cancelled-or-timeout');assert.equal(calls,1);
});
test('bad range, market and token fail before transport',async()=>{
 let calls=0;for(const [market,ref]of [['unsupported',reference],['spot',{...reference,sourceFrom:2500}],['spot',{...reference,sourceToken:'bad'}]])await assert.rejects(wallBenchmarkPreflight('http://localhost',market,ref,{fetcher:async()=>{calls++;}}));assert.equal(calls,0);
});
test('historical panel is constructed after live startup and starts a fresh timing boundary',async()=>{
 const order=[],panels=new Map([['owned',{selection:{historyViewport:undefined}}]]),added=[];globalThis.document={documentElement:{dataset:{appState:'ready'}}};globalThis.window={__wallRoute:{firstHistory:1,settled:2,complete:3,frames:[10],tasks:[20]},__terminal:{panels,dock:{getPanel:id=>({id}),removePanel:p=>{order.push('remove');panels.delete(p.id);},addPanel:p=>{order.push('add');panels.set(p.id,p);added.push(p);}}}};
 try{const page={waitForFunction:async(fn,arg)=>{order.push('wait');assert.equal(Boolean(fn(arg)),true);},evaluate:async(fn,arg)=>fn(arg)},params={historyViewport:{from:2000,to:3000},indicators:[{definitionId:'native.order-walls'}]};const result=await openColdWallBenchmarkPanel(page,'owned',params);assert.deepEqual(order,['wait','remove','wait','add']);assert.equal(added[0].params,params);assert.deepEqual(result.historyViewport,params.historyViewport);assert.ok(result.start>0);assert.equal(window.__wallRoute.firstHistory,null);assert.equal(window.__wallRoute.settled,null);assert.deepEqual(window.__wallRoute.frames,[]);}finally{delete globalThis.window;delete globalThis.document;}
});

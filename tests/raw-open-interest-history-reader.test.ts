import {oiHistoryWire} from './helpers/oi-history-wire';
import {it,expect,vi,afterEach} from 'vitest';
import {validateOiHistoryPayload,oiHistoryKey,planOiHistory,OI_HISTORY_CLIENT_LIMITS as LIMIT,type OiHistoryRange} from '../src/feed/raw-open-interest-history';
import {StagingOpenInterestHistory,readOiHistoryResponse,type OiHistoryEvent} from '../src/feed/staging-open-interest-history';
import {OpenInterestDataController} from '../src/indicators/open-interest-data';
import {ChartNumericOutputRegistry} from '../src/scripts/output-registry';
import type {FeedClient} from '../src/feed/client';
import type {RawOpenInterestEvent} from '../src/feed/raw-open-interest';
const hour=3600000,now=1800000000000,from=Math.floor((now-30*24*hour)/(4*hour))*4*hour;
const range:OiHistoryRange={from,to:from+4*hour,venues:['binance']};
const hash=(s:string)=>s.repeat(64);
const wire=(r:OiHistoryRange=range)=>oiHistoryWire(r,now);
function requested(input:RequestInfo|URL):OiHistoryRange{const u=new URL(String(input),'http://localhost');return {from:Number(u.searchParams.get('from')),to:Number(u.searchParams.get('to')),venues:u.searchParams.get('venues')!.split(',') as any};}
const response=(r:OiHistoryRange=range)=>new Response(JSON.stringify(wire(r)),{status:200});
async function flush(ms=20){await vi.advanceTimersByTimeAsync(ms);}
afterEach(()=>vi.useRealTimers());

it('preserves exact observation and original epoch while keeping native and publication clocks separate',()=>{
 const p=validateOiHistoryPayload(wire(),range);expect(p.observations[0]).toMatchObject({valueDecimal:'123.00000001',epoch:0,observedAtMs:range.to+24*hour,gapBefore:true});expect(p.hot).toMatchObject({asOfMs:now});expect(p.warm).toMatchObject({venues:[{publication:{checkpoint:hash('9'),generation:1,frontier:'unavailable'}}]});expect('asOfMs'in p).toBe(false);expect(p.currentReconciled).toBe(false);
});
it('refuses wrong clocks, authority claims, mixed snapshots and inconsistent range coverage',()=>{
 for(const mutate of [(p:any)=>p.timeBasis='observedAtMs',(p:any)=>p.financialAccepted=true,(p:any)=>p.warm.venues[0].publicationSnapshot.generation=0,(p:any)=>p.warm.venues[0].publicationSnapshot.catalogueHead={...p.warm.catalogueHead,hash:hash('a')},(p:any)=>p.warm.venues[0].coverage.missing=[{from:range.from,to:range.to}],(p:any)=>p.warm.venues[0].coverage.partitions=[],(p:any)=>p.observations.push({...p.observations[0]}),(p:any)=>p.observations[0].epoch=-1]){const p=wire();mutate(p);expect(()=>validateOiHistoryPayload(p,range)).toThrow();}
 const r:OiHistoryRange={...range,venues:['binance','bybit']},p=wire(r);p.warm.venues[1].publicationSnapshot.checkpoint=hash('b');expect(()=>validateOiHistoryPayload(p,r)).toThrow();
});
it('requires truthful partial/truncation metadata and full native conflict identities',()=>{
 const p=wire();p.warm={state:'unavailable'};expect(()=>validateOiHistoryPayload(p,range)).toThrow();p.partial=true;expect(validateOiHistoryPayload(p,range).warm.state).toBe('unavailable');
 const c=wire();c.observations=[];c.conflicts=[{venue:'binance',nativeSymbol:'BTCUSDT',sourceTimeMs:from+1,observedAtMs:now,epoch:0}];c.partial=true;expect(validateOiHistoryPayload(c,range).conflicts[0]).toMatchObject({market:'perpetual',epoch:0});
 c.conflicts[0].market='spot';expect(()=>validateOiHistoryPayload(c,range)).toThrow();
});
it('plans a bounded centre-first set for wide historical views and excludes current live-only views',()=>{
 const start=from-365*24*hour,plan=planOiHistory({from:start,to:start+1000*hour,venues:['binance']},now);expect(plan.windows).toHaveLength(15);expect(plan.capacityLimited).toBe(true);expect(plan.windows[0]!.from).toBe(start+124*4*hour);
 expect(planOiHistory({from:now-hour,to:now,venues:['binance']},now).windows).toEqual([]);
});
it('limits decoded streaming bytes and rejects malformed UTF-8 without admitting a response',async()=>{
 const cancel=vi.fn();const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(LIMIT.responseBytes));c.enqueue(new Uint8Array(1));},cancel});
 await expect(readOiHistoryResponse(new Response(stream),range,new AbortController().signal)).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
 await expect(readOiHistoryResponse(new Response(new Uint8Array([0xff,0xff])),range,new AbortController().signal)).rejects.toThrow();
});
it('default-off reader performs no input or fetch access',async()=>{
 const poison=new Proxy({},{get(){throw Error('unselected input');}}),request=vi.fn();const reader=new StagingOpenInterestHistory(()=>{},false,request);reader.setViewport(poison as any,poison as any,poison as any);expect(request).not.toHaveBeenCalled();await reader.close();
});
it('coalesces identical demands and reopens cached ranges after unsubscribe without a remote request',async()=>{
 vi.useFakeTimers();const events:OiHistoryEvent[]=[],request=vi.fn(async(input:RequestInfo|URL)=>response(requested(input))),reader=new StagingOpenInterestHistory(e=>events.push(e),true,request,()=>now);
 try{reader.setViewport('a',range);reader.setViewport('b',range);await flush();expect(request).toHaveBeenCalledOnce();expect(events.find(e=>e.type==='raw-open-interest-history')).toMatchObject({ids:['a','b']});reader.unsubscribe('a');reader.unsubscribe('b');reader.setViewport('c',range);await flush();expect(request).toHaveBeenCalledOnce();expect(events.at(-1)).toMatchObject({type:'raw-open-interest-history',ids:['c']});reader.setViewport('known',range,[oiHistoryKey(range)]);await flush();expect(request).toHaveBeenCalledOnce();}finally{await reader.close();}
});
it('retains a completed obsolete viewport response in cache without delivering it into the newer viewport',async()=>{
 vi.useFakeTimers();let finish!:(r:Response)=>void,calls=0;const events:OiHistoryEvent[]=[],request=vi.fn(async(input:RequestInfo|URL)=>++calls===1?new Promise<Response>(r=>finish=r):response(requested(input))),reader=new StagingOpenInterestHistory(e=>events.push(e),true,request,()=>now);
 try{reader.setViewport('a',range);await flush();const other={...range,from:from+8*hour,to:from+12*hour};reader.setViewport('a',other);finish(response());await flush();expect(request).toHaveBeenCalledTimes(2);expect(events.filter(e=>e.type==='raw-open-interest-history')).toHaveLength(1);expect(events.at(-1)).toMatchObject({key:oiHistoryKey(other)});reader.setViewport('a',range);await flush();expect(request).toHaveBeenCalledTimes(2);expect(events.at(-1)).toMatchObject({key:oiHistoryKey(range)});}finally{await reader.close();}
});
it('shares a fresh read with other interested consumers even when they already retain the prior range',async()=>{
 vi.useFakeTimers();const events:OiHistoryEvent[]=[],request=vi.fn(async(input:RequestInfo|URL)=>response(requested(input))),reader=new StagingOpenInterestHistory(e=>events.push(e),true,request,()=>now);
 try{reader.setViewport('a',range);reader.setViewport('b',range);await flush();reader.setViewport('a',range,[oiHistoryKey(range)]);reader.setViewport('b',range,[oiHistoryKey(range)]);reader.retry('a');await flush();expect(request).toHaveBeenCalledTimes(2);expect(events.at(-1)).toMatchObject({type:'raw-open-interest-history',ids:['a','b']});}finally{await reader.close();}
});
it('uses finite retry budgets and stops all automatic work after an HTTP 404',async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);const request=vi.fn(async()=>new Response('{}',{status:503})),reader=new StagingOpenInterestHistory(()=>{},true,request,Date.now);
 try{reader.setViewport('a',range);await flush(3*LIMIT.retryMs+100);expect(request).toHaveBeenCalledTimes(3);await flush(10*LIMIT.retryMs);expect(request).toHaveBeenCalledTimes(3);reader.retry('a');await flush(3*LIMIT.retryMs+100);expect(request).toHaveBeenCalledTimes(6);}finally{await reader.close();}
 const missing=vi.fn(async()=>new Response('{}',{status:404})),other=new StagingOpenInterestHistory(()=>{},true,missing,()=>now);try{other.setViewport('a',{...range,to:from+200*hour});await flush(10000);expect(missing).toHaveBeenCalledOnce();expect(other.diagnostics().disabledByServer).toBe(true);}finally{await other.close();}
});
it('caller cancellation neither consumes a failure retry nor prevents later reacquisition',async()=>{
 vi.useFakeTimers();let firstSignal:AbortSignal|undefined;let calls=0;const request=vi.fn((input:RequestInfo|URL,options?:RequestInit)=>++calls===1?new Promise<Response>((_r,reject)=>{firstSignal=options!.signal!;firstSignal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))); }):Promise.resolve(response(requested(input)))),reader=new StagingOpenInterestHistory(()=>{},true,request,()=>now);
 try{reader.setViewport('a',range);await flush();reader.unsubscribe('a');await flush();expect(firstSignal?.aborted).toBe(true);reader.setViewport('a',range);await flush();expect(request).toHaveBeenCalledTimes(2);expect(reader.diagnostics().failures).toBe(0);expect(reader.diagnostics().cacheWindows).toBe(1);}finally{await reader.close();}
});
it('keeps cached history available to a new consumer after the server disables the endpoint',async()=>{
 vi.useFakeTimers();let missing=false;const events:OiHistoryEvent[]=[],request=vi.fn(async(input:RequestInfo|URL)=>missing?new Response('{}',{status:404}):response(requested(input))),reader=new StagingOpenInterestHistory(e=>events.push(e),true,request,()=>now);
 try{reader.setViewport('a',range);await flush();missing=true;reader.setViewport('a',{...range,from:from-8*hour,to:from-4*hour});await flush();expect(reader.diagnostics().disabledByServer).toBe(true);reader.unsubscribe('a');reader.setViewport('new',range);await flush();expect(events.at(-1)).toMatchObject({type:'raw-open-interest-history',ids:['new']});expect(request).toHaveBeenCalledTimes(2);}finally{await reader.close();}
});
it('aborts and drains an in-flight response reader even if the response source ignores fetch cancellation',async()=>{
 let released!:()=>void;const cancelled=vi.fn(()=>new Promise<void>(r=>released=r));const response=new Response(new ReadableStream({cancel:cancelled})),controller=new AbortController();let settled=false;
 const pending=readOiHistoryResponse(response,range,controller.signal).finally(()=>settled=true);controller.abort();await Promise.resolve();expect(cancelled).toHaveBeenCalledOnce();expect(settled).toBe(false);released();await expect(pending).rejects.toThrow();
});
it('bounds cache entries and active retry bookkeeping under disjoint multi-consumer demands',async()=>{
 vi.useFakeTimers();const events:OiHistoryEvent[]=[],request=vi.fn(async(input:RequestInfo|URL)=>response(requested(input))),reader=new StagingOpenInterestHistory(e=>events.push(e),true,request,()=>now);
 try{for(let i=0;i<3;i++)reader.setViewport(String(i),{...range,from:from-(i+1)*100*hour,to:from-i*100*hour});await flush(2000);expect(reader.diagnostics().cacheWindows).toBeLessThanOrEqual(16);expect(reader.diagnostics().cacheBytes).toBeLessThanOrEqual(LIMIT.cacheBytes);expect(reader.diagnostics().attemptKeys).toBeLessThanOrEqual(32);expect(request).toHaveBeenCalledTimes(32);expect(events.some(e=>e.type==='raw-open-interest-history-status'&&e.reason==='capacity')).toBe(true);await flush(10000);expect(request).toHaveBeenCalledTimes(32);}finally{await reader.close();}
});
it('close drains an admitted fetch and rejects its late result without repopulating cache',async()=>{
 vi.useFakeTimers();let release!:(value:Response)=>void;const request=vi.fn(()=>new Promise<Response>(r=>release=r)),reader=new StagingOpenInterestHistory(()=>{},true,request,()=>now);reader.setViewport('a',range);await flush();let closed=false;const closing=reader.close().then(()=>closed=true);await Promise.resolve();expect(closed).toBe(false);release(response());await closing;expect(reader.diagnostics()).toMatchObject({closed:true,cacheWindows:0,cacheBytes:0});
});
it('connects historical coverage to the resident controller without clearing live rows or turning archive failure into a live error',()=>{
 vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});let receive!:(event:RawOpenInterestEvent)=>void;
 const feed={subscribeRawOpenInterest:vi.fn((_id:unknown,_request:unknown,listener:typeof receive)=>{receive=listener;return vi.fn();}),updateRawOpenInterestViewport:vi.fn()};
 const registry=new ChartNumericOutputRegistry('history-bridge'),model=new OpenInterestDataController('history-bridge','oi',feed as unknown as FeedClient,registry,{}, {venue:'binance',interval:'1m'},()=>now,{},true);
 try{
  const requested:OiHistoryRange={...range,venues:['binance','hyperliquid','bybit']},body=wire(requested);for(const row of body.observations)row.sourceTimeMs=from+hour+1000;
  const payload=validateOiHistoryPayload(body,requested),key=oiHistoryKey(requested);
  model.setHostCandles([{t:from+hour,o:1,h:1,l:1,c:1,v:1,revision:1,closed:true}]);model.setViewport(from+hour,from+hour+60000);model.setDataDemand(true);expect(feed.updateRawOpenInterestViewport).toHaveBeenCalledOnce();
  receive({type:'raw-open-interest-snapshot',ids:['oi'],context:'recorder',payload:{version:1,market:'perpetual',nativeSymbol:'BTC',semantics:'observed-open-interest-level',units:'BTC',from:now-4*hour,to:now,asOfMs:now,venues:requested.venues,unitVerification:Object.fromEntries(requested.venues.map(v=>[v,{status:'verified' as const,units:'BTC',evidence:'explicit unit test fixture'}])),observations:body.observations.map((r:any)=>({...r,sourceTimeMs:now-30000,observedAtMs:now-29000})),truncated:false,invalidRows:0,expectedIntervalMs:30000,retentionDays:7,feeds:{},history:'Explicit fixture metadata.'}});
  receive({type:'raw-open-interest-history-status',ids:['oi'],range:requested,state:'loading'});expect(model.history.diagnostics().retained).toBe(3);
  receive({type:'raw-open-interest-history',ids:['oi'],key,payload});expect(model.history.diagnostics().retained).toBe(6);expect(model.viewFrame().lines.get('binance')!.points[0]!.value).toBe(123.00000001);expect(model.diagnostics().historyCoverage[0]).toMatchObject({publication:{checkpoint:hash('9'),generation:1},hotAsOfMs:now});
  model.setViewport(from+hour,from+hour+60000);expect(feed.updateRawOpenInterestViewport.mock.calls.at(-1)![3]).toEqual([key]);
  const calls=feed.updateRawOpenInterestViewport.mock.calls.length;model.setViewport(from+hour,from+hour+60000);expect(feed.updateRawOpenInterestViewport).toHaveBeenCalledTimes(calls);
  receive({type:'raw-open-interest-history-status',ids:['oi'],range:requested,state:'unavailable',reason:'network'});expect(model.history.diagnostics().retained).toBe(6);expect(model.diagnostics().feedError).toBe('');expect(model.viewFrame().lines.get('binance')!.points[0]!.value).toBe(123.00000001);
 }finally{model.dispose();registry.dispose();vi.unstubAllGlobals();}
});

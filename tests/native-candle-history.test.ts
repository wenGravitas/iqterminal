import {NativeCandlePresentationCache} from '../src/feed/native-candle-presentation-cache';
import capturedSpot from './fixtures/native-candles-spot-canonical.json';
import {expect,test,vi} from 'vitest';
import {NativeCandleHistory} from '../src/feed/native-candle-history';
import {NativeCandleVersions,retainNativeViewport,NATIVE_CHART_BAR_BUDGET,NATIVE_VISIBLE_BAR_BUDGET} from '../src/feed/native-candle-state';
import {HistoryScheduler} from '../src/feed/history-scheduler';
import type {Candle,Series} from '../src/feed/protocol';
const from=Date.UTC(2026,10,3,11),step=300000,series={venue:'binance',market:'spot',interval:'5m'} as const;
const candle=(t:number):Candle&{quoteVolume:number}=>({t,o:80000,h:80010,l:79990,c:80001,v:2,quoteVolume:160002,revision:1,closed:true});
const rows=(start:number,count:number,interval=step)=>Array.from({length:count},(_,i)=>candle(start+i*interval));
const reply=(candles:Candle[],extra={})=>new Response(JSON.stringify({source:'binance-native-kline',market:'spot',instrument:'binance:spot:BTCUSDT',candles,...extra}));
function harness(request?:typeof fetch,s:Series=series,now=from+40*86400000,presentation?:NativeCandlePresentationCache){
 const applied:Array<{id:string;bars:Candle[];version:unknown}>=[],urls:string[]=[],states:any[]=[];let version=0;
 const history=new NativeCandleHistory(s,{now:()=>now,version:()=>({stream:0,request:++version}),scheduler:new HistoryScheduler(2),presentation,
  request:(async(url,init)=>{urls.push(String(url));return request?request(url,init):reply(rows(Number(new URL(String(url),'http://test').searchParams.get('from')),1000));}) as typeof fetch,
  apply:(id,bars,v)=>{applied.push({id,bars,version:v});return bars.map(c=>c.t);},changed:()=>{states.push(history.progress('a'));}});
 return {history,urls,applied,states};
}
test('30h of exact native prices loads all360slots without waiting for a current bootstrap',async()=>{
 const h=harness();try{h.history.viewport('a',from,from+30*3600000,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));
  expect(h.urls).toHaveLength(1);expect(h.applied.flatMap(p=>p.bars)).toEqual(rows(from,360));expect(h.history.progress('a')).toMatchObject({requestedSlots:360,loadedSlots:360,capacityLimited:false,unloaded:[]});
  expect(h.applied[0].version).toEqual({stream:0,request:1});expect(h.history.diagnostics().retainedOHLC).toBe(0);
 }finally{h.history.dispose();}
});
test('future whitespace requests identical five eligible closed1hbars and excludes the forming hour',async()=>{
 const day=Date.UTC(2026,10,3),hour=3600000,now=day+16*hour+19*60000,all=[];
 for(const right of [19,23]){const h=harness((async url=>reply(rows(Number(new URL(String(url),'http://test').searchParams.get('from')),1000,hour))) as typeof fetch,{...series,interval:'1h'},now);try{
  h.history.viewport('a',day+11*hour,day+right*hour,[day+16*hour]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));
  expect(h.applied.flatMap(p=>p.bars).map(c=>c.t)).toEqual([11,12,13,14,15].map(t=>day+t*hour));all.push(h.urls);
 }finally{h.history.dispose();}}
 expect(all[0]).toEqual(all[1]);
});
test('2500slots load nearest useful pages first, never complete after the first page',async()=>{
 const h=harness();try{h.history.viewport('a',from,from+2500*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));
  expect(h.urls.map(u=>Number(new URL(u,'http://test').searchParams.get('from')))).toEqual([from+1500*step,from+500*step,from]);
  expect(h.states.some(p=>p?.loadedSlots===1000&&p.state==='loading')).toBe(true);expect(h.applied.flatMap(p=>p.bars)).toHaveLength(2500);
 }finally{h.history.dispose();}
});
test('sparse cached slots cause at most one request per1000slotchunk, not one request per hole',async()=>{
 const h=harness(),end=from+2500*step;try{h.history.viewport('a',from,end,rows(from,2500).filter((_,i)=>i%2===0).map(c=>c.t));await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));
  expect(h.urls).toHaveLength(3);expect(h.applied.flatMap(p=>p.bars)).toHaveLength(1250);
 }finally{h.history.dispose();}
});
test('a failed native history retries after recovery without discarding its good prefix or polling healthy builds',async()=>{
 let fail=true;const h=harness((async url=>fail?new Response('',{status:503}):reply(rows(Number(new URL(String(url),'http://test').searchParams.get('from')),1000))) as typeof fetch);
 try{h.history.viewport('a',from,from+10*step,[from]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('failed'));
  expect(h.history.progress('a')).toMatchObject({loadedSlots:1,error:'History HTTP 503',retryable:true});
  for(let i=0;i<5;i++)h.history.viewport('a',from,from+10*step,[from]);expect(h.urls).toHaveLength(1);
  fail=false;h.history.retry('a');await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));expect(h.urls).toHaveLength(2);expect(h.history.progress('a')?.error).toBeUndefined();
 }finally{h.history.dispose();}
});
test('empty source remains partial and never becomes a fabricated empty covered interval',async()=>{
 const h=harness((async()=>reply([])) as typeof fetch);try{h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('partial'));
  expect(h.history.progress('a')).toMatchObject({loadedSlots:0,requestedSlots:5,unloaded:[{from,to:from+5*step,reason:'not-returned'}]});expect(h.urls).toHaveLength(1);
 }finally{h.history.dispose();}
});
test('shared native request survives cancellation of one consumer; last release cancels upstream',async()=>{
 let finish!:(r:Response)=>void,signal!:AbortSignal;const h=harness((async(_u,init)=>{signal=init!.signal!;return new Promise<Response>(r=>finish=r);}) as typeof fetch);
 try{h.history.viewport('a',from,from+5*step,[]);h.history.viewport('b',from,from+5*step,[]);await vi.waitFor(()=>expect(h.urls).toHaveLength(1));
  h.history.release('a');expect(signal.aborted).toBe(false);finish(reply(rows(from,5)));await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('ready'));expect(h.applied.map(p=>p.id)).toEqual(['b']);
  h.history.viewport('c',from+100*step,from+105*step,[]);await vi.waitFor(()=>expect(h.urls).toHaveLength(2));h.history.release('c');expect(signal.aborted).toBe(true);finish(reply(rows(from+100*step,5)));
 }finally{h.history.dispose();}
});
test('a viewport supplied by the bootstrap releases only its share of a queued/native read',async()=>{
 let finish!:(r:Response)=>void,signal!:AbortSignal;const h=harness((async(_u,init)=>{signal=init!.signal!;return new Promise<Response>(r=>finish=r);}) as typeof fetch);
 try{h.history.viewport('a',from,from+5*step,[]);h.history.viewport('b',from,from+5*step,[]);await vi.waitFor(()=>expect(h.urls).toHaveLength(1));
  h.history.viewport('a',from,from+5*step,rows(from,5).map(c=>c.t));expect(h.history.progress('a')?.state).toBe('ready');expect(signal.aborted).toBe(false);
  finish(reply(rows(from,5)));await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('ready'));expect(h.applied.map(p=>p.id)).toEqual(['b']);
 }finally{h.history.dispose();}
});
test('late obsolete view data is ignored and release drops all retained metadata',async()=>{
 const done=new Map<number,(r:Response)=>void>();const h=harness((async u=>new Promise<Response>(r=>done.set(Number(new URL(String(u),'http://test').searchParams.get('from')),r))) as typeof fetch);
 try{h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(done.has(from)).toBe(true));h.history.viewport('a',from+100*step,from+105*step,[]);await vi.waitFor(()=>expect(done.size).toBe(2));
  done.get(from+100*step)!(reply(rows(from+100*step,5)));await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));done.get(from)!(reply(rows(from,5)));await new Promise(r=>setTimeout(r,0));
  expect(h.applied.flatMap(p=>p.bars).map(c=>c.t)).toEqual(rows(from+100*step,5).map(c=>c.t));h.history.release('a');expect(h.history.diagnostics()).toMatchObject({views:0,busy:0,retainedTimes:0});
 }finally{h.history.dispose();}
});
for(const shape of ['source','market','instrument','ordering','alignment'])test(`invalid ${shape} cannot certify native coverage`,async()=>{
 const h=harness((async()=>shape==='source'?reply(rows(from,2),{source:'derived-executions'}):shape==='market'?reply(rows(from,2),{market:'perpetual'}):shape==='instrument'?reply(rows(from,2),{instrument:'ETHUSDT'}):shape==='ordering'?reply(rows(from,2).reverse()):reply([candle(from+1)])) as typeof fetch);
 try{h.history.viewport('a',from,from+2*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('failed'));expect(h.applied).toHaveLength(0);expect(h.history.progress('a')?.loadedSlots).toBe(0);}finally{h.history.dispose();}
});
test('oversized decoded native payload is cancelled at its bound',async()=>{
 let cancelled=false;const h=harness((async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;}}))) as typeof fetch);
 try{h.history.viewport('a',from,from+step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('failed'));expect(cancelled).toBe(true);expect(h.history.progress('a')?.error).toContain('byte capacity');}finally{h.history.dispose();}
});
test('real chart budget stays5000 and capacity limits do not claim the full10000slotview',async()=>{
 const h=harness();try{h.history.viewport('a',from,from+10000*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('capacity-limited'));
  expect(h.urls).toHaveLength(5);expect(h.history.progress('a')).toMatchObject({requestedSlots:10000,loadedSlots:NATIVE_VISIBLE_BAR_BUDGET,capacityLimited:true,retryable:false});
  expect(h.history.progress('a')?.unloaded[0]).toEqual({from,to:from+(10000-NATIVE_VISIBLE_BAR_BUDGET)*step,reason:'capacity'});
 }finally{h.history.dispose();}
});
test('viewport retention preserves all requested360bars and latest two prices without raising5000',()=>{
 const input=rows(from,6000),out=retainNativeViewport(input,from,from+360*step);expect(out).toHaveLength(NATIVE_CHART_BAR_BUDGET);
 expect(out.slice(0,360)).toEqual(input.slice(0,360));expect(out.slice(-2)).toEqual(input.slice(-2));expect(out.every(c=>input.includes(c))).toBe(true);
});
test('native revisions separate REST read order from stream order and stay bounded by retained bars',()=>{
 const versions=new NativeCandleVersions(),c=candle(from);
 expect(versions.accept(c,{stream:0,request:2})).toBe(true);expect(versions.accept({...c,revision:9999},{stream:0,request:1},c)).toBe(false);
 expect(versions.accept(c,{stream:3},c)).toBe(true);expect(versions.accept(c,{stream:2,request:3},c)).toBe(false);expect(versions.accept(c,{stream:3,request:4},c)).toBe(true);
 expect(versions.accept({...c,closed:false},{stream:4},c)).toBe(false);
 for(const bar of rows(from+step,6000))versions.accept(bar,{stream:3,request:5});versions.retain([c]);expect(versions.size()).toBe(1);versions.clear();expect(versions.size()).toBe(0);
});

test('bootstrap recovery clears a historical failure when all requested native slots become available',async()=>{
 const h=harness((async()=>new Response('',{status:503})) as typeof fetch);try{
  h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('failed'));
  h.history.viewport('a',from,from+5*step,rows(from,5).map(c=>c.t));expect(h.history.progress('a')).toMatchObject({state:'ready',loadedSlots:5,retryable:false});expect(h.history.progress('a')?.error).toBeUndefined();expect(h.urls).toHaveLength(1);
 }finally{h.history.dispose();}
});
test('offline cancels native work and resumes only missing slots without duplicating the validated prefix',async()=>{
 let blocked=true,finish!:(r:Response)=>void,signal!:AbortSignal;
 const h=harness((async(u,init)=>{
  const start=Number(new URL(String(u),'http://test').searchParams.get('from'));
  if(start===from&&blocked){signal=init!.signal!;return new Promise<Response>(r=>finish=r);}return reply(rows(start,1000));
 }) as typeof fetch);try{
  h.history.viewport('a',from,from+1500*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.loadedSlots).toBe(1000));await vi.waitFor(()=>expect(signal).toBeDefined());
  h.history.setOnline(false);expect(signal.aborted).toBe(true);blocked=false;h.history.setOnline(true);
  await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));finish(reply(rows(from,1000)));await new Promise(r=>setTimeout(r,0));
  const times=h.applied.flatMap(p=>p.bars.map(c=>c.t));expect(times).toHaveLength(1500);expect(new Set(times).size).toBe(1500);
 }finally{h.history.dispose();}
});

test('captured staging native identity accepts exact Spot OHLC and base/quote volume',async()=>{
 const source=capturedSpot,first=source.candles[0]!,h=harness((async()=>new Response(JSON.stringify(source))) as typeof fetch);
 try{h.history.viewport('a',first.t,first.t+2*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));expect(h.applied.flatMap(p=>p.bars)).toEqual(source.candles);}finally{h.history.dispose();}
});
test('the canonical USD-M namespace is accepted independently of Spot',async()=>{
 const h=harness((async()=>reply(rows(from,2),{market:'perpetual',instrument:'binance:perpetual:BTCUSDT'})) as typeof fetch,{venue:'binance',market:'perpetual',interval:'5m'});
 try{h.history.viewport('a',from,from+2*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));expect(h.applied.flatMap(p=>p.bars)).toEqual(rows(from,2));}finally{h.history.dispose();}
});
test('a different canonical market cannot be smuggled through a native symbol match',async()=>{
 const h=harness((async()=>reply(rows(from,2),{instrument:'binance:perpetual:BTCUSDT'})) as typeof fetch);
 try{h.history.viewport('a',from,from+2*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('failed'));expect(h.applied).toHaveLength(0);}finally{h.history.dispose();}
});

test('warm native presentation paints immediately but echoed known-times cannot certify or cancel fresh validation',async()=>{
 const cache=new NativeCandlePresentationCache();let count=0,finish!:(r:Response)=>void,signal!:AbortSignal;
 const h=harness((async(_u,init)=>{count++;if(count===1)return reply(rows(from,5));signal=init!.signal!;return new Promise<Response>(r=>finish=r);}) as typeof fetch,series,from+86400000,cache);
 try{
  h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));h.history.release('a');h.applied.length=0;
  h.history.viewport('b',from,from+5*step,[]);expect(h.applied).toHaveLength(1);expect(h.applied[0]).toMatchObject({id:'b',version:{stream:0,request:0},bars:rows(from,5)});
  expect(h.history.progress('b')).toMatchObject({state:'loading',loadedSlots:0,cachedSlots:5});
  await vi.waitFor(()=>expect(count).toBe(2));h.history.viewport('b',from,from+5*step,rows(from,5).map(c=>c.t));expect(signal.aborted).toBe(false);expect(h.history.progress('b')).toMatchObject({state:'loading',loadedSlots:0,cachedSlots:5});
  const corrected=rows(from,5).map(c=>({...c,c:80002,quoteVolume:160004,revision:2}));finish(reply(corrected));await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('ready'));
  expect(h.applied.at(-1)?.bars).toEqual(corrected);expect(h.history.progress('b')).toMatchObject({loadedSlots:5});expect(h.history.progress('b')?.cachedSlots).toBeUndefined();
 }finally{h.history.dispose();}
});
test('a cached view keeps good prices through failure and retries independently without claiming missing fresh source',async()=>{
 const cache=new NativeCandlePresentationCache();let mode='seed';const h=harness((async()=>mode==='failed'?new Response('',{status:503}):mode==='empty'?reply([]):reply(rows(from,5))) as typeof fetch,series,from+86400000,cache);
 try{
  h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));h.history.release('a');h.applied.length=0;mode='failed';
  h.history.viewport('b',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('failed'));expect(h.applied[0].bars).toEqual(rows(from,5));expect(h.history.progress('b')).toMatchObject({loadedSlots:0,cachedSlots:5,retryable:true});
  mode='empty';h.history.retry('b');await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('partial'));expect(h.history.progress('b')).toMatchObject({loadedSlots:0,cachedSlots:5});expect(cache.diagnostics().rows).toBe(0);
  mode='ready';h.history.retry('b');await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('ready'));expect(h.history.progress('b')?.error).toBeUndefined();expect(h.history.progress('b')?.cachedSlots).toBeUndefined();
 }finally{h.history.dispose();}
});
test('authoritative closed native bootstrap can validate a cached view and cancel only its redundant history request',async()=>{
 const cache=new NativeCandlePresentationCache();let count=0,finish!:(r:Response)=>void,signal!:AbortSignal;const h=harness((async(_u,init)=>{if(++count===1)return reply(rows(from,5));signal=init!.signal!;return new Promise<Response>(r=>finish=r);}) as typeof fetch,series,from+86400000,cache);
 try{h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));h.history.release('a');h.history.viewport('b',from,from+5*step,[]);await vi.waitFor(()=>expect(count).toBe(2));
  h.history.confirmClosed(rows(from,5));expect(h.history.progress('b')).toMatchObject({state:'ready',loadedSlots:5});expect(h.history.progress('b')?.cachedSlots).toBeUndefined();expect(signal.aborted).toBe(true);finish(reply(rows(from,5)));
 }finally{h.history.dispose();}
});

test('an authoritative bootstrap that wins the page read seeds warm native presentation before group release',async()=>{
 const cache=new NativeCandlePresentationCache();let count=0,finish!:(r:Response)=>void;const h=harness((async()=>{count++;return new Promise<Response>(resolve=>finish=resolve);}) as typeof fetch,series,from+86400000,cache);
 try{
  h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(count).toBe(1));h.history.confirmClosed(rows(from,5));expect(h.history.progress('a')).toMatchObject({state:'ready',loadedSlots:5});expect(cache.diagnostics().rows).toBe(5);finish(reply(rows(from,5)));h.history.release('a');h.applied.length=0;
  h.history.viewport('b',from,from+5*step,[]);expect(h.applied[0]).toMatchObject({version:{stream:0,request:0},bars:rows(from,5)});expect(h.history.progress('b')).toMatchObject({state:'loading',cachedSlots:5,loadedSlots:0});
 }finally{h.history.dispose();}
});
test('native bars already owned before viewport creation seed warm presentation without an extra history request',async()=>{
 const cache=new NativeCandlePresentationCache(),applied:any[]=[],request=vi.fn();
 const history=new NativeCandleHistory(series,{now:()=>from+86400000,version:()=>({stream:0,request:1}),request,presentation:cache,nativeBars:()=>rows(from,5),apply:(_id,bars)=>{applied.push(bars);return bars.map(c=>c.t);},changed:()=>{}});
 try{history.viewport('a',from,from+5*step,[]);expect(history.progress('a')).toMatchObject({state:'ready',loadedSlots:5});expect(cache.diagnostics().rows).toBe(5);expect(applied).toEqual([]);expect(request).not.toHaveBeenCalled();}finally{history.dispose();}
});
test('a long-open view remains warm after release and pan/dispose release bounded key leases',async()=>{
 let clock=0,calls=0;const cache=new NativeCandlePresentationCache(()=>clock),h=harness((async()=>{calls++;return reply(rows(from,5));}) as typeof fetch,series,from+86400000,cache);
 try{
  h.history.viewport('a',from,from+5*step,[]);await vi.waitFor(()=>expect(h.history.progress('a')?.state).toBe('ready'));expect(cache.diagnostics().activeLeases).toBe(1);
  clock=120000;cache.expire();h.history.release('a');expect(cache.diagnostics()).toMatchObject({rows:5,activeLeases:0});h.applied.length=0;
  h.history.viewport('b',from,from+5*step,[]);expect(h.applied[0]).toMatchObject({version:{stream:0,request:0},bars:rows(from,5)});expect(h.history.progress('b')).toMatchObject({loadedSlots:0,cachedSlots:5});
  await vi.waitFor(()=>expect(calls).toBe(2));await vi.waitFor(()=>expect(h.history.progress('b')?.state).toBe('ready'));
  h.history.viewport('b',from-step,from+4*step,[]);expect(cache.diagnostics()).toMatchObject({activeLeases:1,retainedKeys:1});
 }finally{h.history.dispose();}
 expect(cache.diagnostics()).toMatchObject({activeLeases:0,retainedKeys:0});clock+=60000;expect(cache.diagnostics()).toMatchObject({entries:0,rows:0});
});

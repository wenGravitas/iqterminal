import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { StagingFeedService, stagingMarket, validBackendBar, boundedFootprintHistory } from '../src/feed/staging-service';
import { FootprintAccumulator } from '../src/feed/footprint';
import { preparedFootprintAnalysisSummary } from '../src/chart/footprint-delta-flips';
import { footprintAnalysisSourceKey } from '../src/feed/protocol';
import { footprintForUnits } from '../src/chart/footprint-units';
import type { Event } from '../src/feed/protocol';
beforeEach(()=>vi.stubEnv('VITE_HISTORY_TILES','0'));afterEach(() => {vi.useRealTimers();vi.unstubAllEnvs();});
const series = { venue: 'binance', market: 'perpetual', interval: '1m' } as const;
const bar = { time: 60, revision: 2, cells: [{ price: 84000, bidVol: 1, askVol: 2, bidNotional: 84000, askNotional: 168002 }],
  open: 84000, high: 84001, low: 84000, close: 84001, delta: 1, minDelta: -1, maxDelta: 1, rowSize: 25,
  source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade', coverage: 'observed', gapBefore: false, aggregateRecordCount: 2 } as const;
const response = () => ({ version: 1, source: 'binance-usdm-aggtrade', watermark: 10, tickSize: .1, bars: [bar],
  coverage: { confirmedFrom: 60000, confirmedTo: 180000, gaps: [] }, status: { state: 'live', lastUpdate: 900000 } });
class Socket {
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  sent: any[] = []; closed = false;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; this.onclose?.(); }
  receive(data: any) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const trade = (id: number) => ({ id,timeMs:60002+id,price:84001,quantity:1,quoteNotional:84001,side:'buy' });
const packet = (after:number, ids:number[]) => ({type:'executions',version:1,after,cursor:ids.at(-1),watermark:ids.at(-1),executions:ids.map(trade),coverage:response().coverage,collector:{state:'live',lastUpdate:900000},sentAt:900000,tickSize:.1});
test('native candle bootstrap preserves a valid full response that takes 45 seconds',async()=>{
 vi.useFakeTimers();const events:Event[]=[],series={venue:'binance',market:'perpetual',interval:'5m'} as const;
 const candles=[{t:600000,o:84000,h:84100,l:83900,c:84050,v:12,revision:1,closed:true}];let requestSignal:AbortSignal|undefined;
 const request=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   requestSignal=init?.signal as AbortSignal;
   await new Promise<void>((resolve,reject)=>{
     const timer=setTimeout(resolve,45_000);
     requestSignal?.addEventListener('abort',()=>{clearTimeout(timer);reject(requestSignal?.reason??new DOMException('Aborted','AbortError'));},{once:true});
   });
   return new Response(JSON.stringify({source:'binance-native-kline',candles}));
 });
 const service=new StagingFeedService(e=>events.push(e),request,()=>900000,()=>new Socket() as any);
 try{
   service.command({type:'subscribe',id:'slow-candles',series});
   await vi.advanceTimersByTimeAsync(44_999);
   expect(request).toHaveBeenCalledTimes(1);expect(requestSignal?.aborted).toBe(false);
   expect(events.some(event=>event.type==='snapshot')).toBe(false);
   await vi.advanceTimersByTimeAsync(1);
   expect(requestSignal?.aborted).toBe(false);
   expect(events.find(event=>event.type==='snapshot')).toMatchObject({type:'snapshot',candles});
   expect(events.some(event=>event.type==='status'&&(event as any).status.state==='failed')).toBe(false);
 }finally{service.dispose();}
});
test('native candle bootstrap keeps an empty upstream HTTP error status visible',async()=>{
 vi.useFakeTimers();const events:Event[]=[];
 const service=new StagingFeedService(e=>events.push(e),async()=>new Response('',{status:502}),()=>900000,()=>new Socket() as any);
 try{
   service.command({type:'subscribe',id:'bad-gateway',series});await vi.advanceTimersByTimeAsync(1);
   const status=events.filter((event:any)=>event.type==='status').at(-1) as any;
   expect(status.status).toMatchObject({state:'failed'});
   expect(status.status.message).toContain('HTTP 502');
   expect(status.status.message).not.toContain('Unexpected end of JSON');
 }finally{service.dispose();}
});
test('native candle bootstrap identifies incomplete JSON from a successful response',async()=>{
 vi.useFakeTimers();const events:Event[]=[];
 const service=new StagingFeedService(e=>events.push(e),async()=>new Response(''),()=>900000,()=>new Socket() as any);
 try{
   service.command({type:'subscribe',id:'truncated-json',series});await vi.advanceTimersByTimeAsync(1);
   const status=events.filter((event:any)=>event.type==='status').at(-1) as any;
   expect(status.status).toMatchObject({state:'failed'});
   expect(status.status.message).toContain('Staging history returned incomplete JSON');
 }finally{service.dispose();}
});
async function setup(bootstrap:any=response()) {
  vi.useFakeTimers(); const events: Event[] = []; const sockets: Socket[]=[];const socketUrls:string[]=[];
  const request=vi.fn(async()=>new Response(JSON.stringify(bootstrap)));
  const service=new StagingFeedService(e=>events.push(e),request,()=>900000,url=>{socketUrls.push(url);const s=new Socket();sockets.push(s);return s as unknown as WebSocket;});
  service.command({type:'footprint-subscribe',id:'a',series,rowPrice:25});await vi.advanceTimersByTimeAsync(1);
  const ack=()=>{const e:any=events.at(-1);service.command({type:'footprint-ack',key:e.key,generation:e.generation,batchId:e.batchId});};
  ack();ack();sockets[0]!.onopen?.();return {service,events,sockets,socketUrls,request,ack};
}
test('fresh bootstrap displays its forming bar but awaits an actual live stream confirmation',async()=>{
 const bootstrap={...response(),bars:[{...bar,time:900}],coverage:{confirmedFrom:900000,confirmedTo:900001,gaps:[]}};
 const {service,events,sockets,ack}=await setup(bootstrap);
 try{
  const seeded:any=events.find(e=>e.type==='footprint-snapshot');expect(seeded.bars).toHaveLength(1);expect(seeded.bars[0].time).toBe(900);expect(seeded.status.state).toBe('loading');expect(seeded.status.message).toContain('awaiting live execution stream');
  expect(service.diagnostics().streams[0]!.executionProof).toMatchObject({appliedBatches:0,acksSent:0});
  const live=packet(10,[11]);live.executions[0]!.timeMs=900001;live.coverage=bootstrap.coverage;sockets[0]!.receive(live);ack();expect((events.at(-1) as any).status.state).toBe('live');expect((events.at(-1) as any).bars[0].aggregateRecordCount).toBe(3);expect(service.diagnostics().streams[0]!.executionProof).toMatchObject({appliedBatches:1,acksSent:1,lastAppliedCursor:11});
 }finally{service.dispose();}
});
test('history seeds shared accumulator; durable batches update incrementally without periodic HTTP',async()=>{
  const {service,events,sockets,socketUrls,request}=await setup();
  expect(new URL(socketUrls[0]!).pathname).toBe('/market-data/v1/stream');
  expect(new URL(socketUrls[0]!).searchParams.has('market')).toBe(false);
  expect(sockets[0]!.sent[0].after).toBe(10);
  sockets[0]!.receive(packet(10,[11,12]));
  const patch:any=events.at(-1);expect(patch.type).toBe('footprint-patch');expect(patch.bars[0].aggregateRecordCount).toBe(4);expect(patch.bars[0].cells[0].askVol).toBe(4);expect(patch.bars[0].cells[0].askNotional).toBeUndefined();
  expect(sockets[0]!.sent.at(-1)).toEqual({type:'ack',cursor:12});
  await vi.advanceTimersByTimeAsync(4000);expect(request).toHaveBeenCalledTimes(1);service.dispose();
});
test('reconnect resumes last applied cursor and stale old-socket messages cannot double count',async()=>{
  const {service,events,sockets,ack}=await setup();sockets[0]!.receive(packet(10,[11]));ack();
  sockets[0]!.close();ack();service.command({type:'online',online:false});service.command({type:'online',online:true});
  sockets[1]!.onopen?.();expect(sockets[1]!.sent[0].after).toBe(11);
  ack();sockets[0]!.receive(packet(11,[12]));sockets[1]!.receive(packet(11,[12]));ack();
  expect((events.at(-1) as any).bars[0].aggregateRecordCount).toBe(4);service.dispose();
});
test('invalid cursor batch preserves data and visible failure; no direct venue fallback',async()=>{
  const {service,events,sockets,request}=await setup();sockets[0]!.receive(packet(9,[10,11]));
  expect(sockets[0]!.closed).toBe(true);expect((events.at(-1) as any).status.state).toBe('stale');expect(service.diagnostics().retainedBars).toBe(1);
  expect(request.mock.calls.every(([url]:any)=>url.startsWith('/market-data/'))).toBe(true);service.dispose();
});
test('execution proof counts validated applied batches and confirms only a prior same-socket ACK',async()=>{
 const {service,sockets,ack}=await setup();
 try{
  const proof=()=>service.diagnostics().streams[0]!.executionProof!;
  sockets[0]!.receive(packet(10,[11,12]));ack();expect(proof()).toMatchObject({socketStarts:1,appliedBatches:1,appliedExecutions:2,acksSent:1,confirmedAckBatches:0,lastAfter:10,lastAppliedCursor:12,sourceCursorJumps:0});
  const retained=proof();sockets[0]!.receive(packet(12,[13]));ack();expect(proof()).toMatchObject({appliedBatches:2,appliedExecutions:3,acksSent:2,confirmedAckBatches:1,lastConfirmedAckCursor:12,lastAfter:12,lastAppliedCursor:13,errors:0,disconnects:0});expect(retained.appliedBatches).toBe(1);
  sockets[0]!.close();service.command({type:'online',online:false});service.command({type:'online',online:true});sockets[1]!.onopen?.();
  sockets[0]!.receive(packet(13,[14]));expect(proof().appliedBatches).toBe(2);
  sockets[1]!.receive(packet(13,[14]));ack();expect(proof()).toMatchObject({socketStarts:2,disconnects:1,appliedBatches:3,confirmedAckBatches:1,lastAppliedCursor:14});
  sockets[1]!.receive(packet(14,[15]));expect(proof()).toMatchObject({appliedBatches:4,confirmedAckBatches:2,lastConfirmedAckCursor:14});
 }finally{service.dispose();}
});
test('invalid or reset streams cannot manufacture successful execution confirmation; source jumps stay explicit',async()=>{
 for(const mode of ['invalid','reset','jump']){
  const {service,sockets}=await setup();
  try{
   sockets[0]!.receive(mode==='invalid'?packet(9,[10,11]):mode==='reset'?{type:'reset',reason:'source reset'}:packet(10,[12]));
   const proof=service.diagnostics().streams[0]!.executionProof!;
   expect(proof.confirmedAckBatches).toBe(0);
   if(mode==='jump')expect(proof).toMatchObject({appliedBatches:1,sourceCursorJumps:1,errors:0});
   else expect(proof).toMatchObject({appliedBatches:0,acksSent:0,errors:1,disconnects:1,resets:mode==='reset'?1:0});
  }finally{service.dispose();}
 }
});
test('delayed UI ACK coalesces complete bounded state and subscriptions share stream',async()=>{
  const {service,events,sockets,ack,request}=await setup();sockets[0]!.receive(packet(10,[11]));sockets[0]!.receive(packet(11,[12]));
  service.command({type:'footprint-subscribe',id:'b',series,rowPrice:25});await vi.advanceTimersByTimeAsync(1);ack();
  const latest:any=events.at(-1);expect(latest.type).toBe('footprint-snapshot');expect(latest.ids).toEqual(['a','b']);expect(latest.bars[0].aggregateRecordCount).toBe(4);expect(request).toHaveBeenCalledTimes(1);expect(sockets).toHaveLength(1);service.dispose();
});
test('a new historical viewer cannot downgrade a healthy shared live execution feed',async()=>{
 const {service,events,sockets,ack,request}=await setup();
 try{
  sockets[0]!.receive(packet(10,[11]));ack();const start=events.length,proof=service.diagnostics().streams[0]!.executionProof;
  service.command({type:'footprint-subscribe',id:'second-chart',series,rowPrice:25});ack();ack();
  const statuses=events.slice(start).filter((e:any)=>e.status).map((e:any)=>e.status);
  expect(statuses.length).toBeGreaterThan(0);expect(statuses.every(status=>status.state==='live')).toBe(true);
  expect(service.diagnostics().streams[0]!.executionProof).toEqual(proof);expect(request).toHaveBeenCalledTimes(1);expect(sockets).toHaveLength(1);
  sockets[0]!.receive(packet(11,[12]));ack();expect(service.diagnostics().streams[0]!.executionProof).toMatchObject({lastAppliedCursor:12,confirmedAckBatches:1,disconnects:0,errors:0});
 }finally{service.dispose();}
});
test('restore plus replay has parity with uninterrupted aggregation, including extrema and quote volume',()=>{
  const all=new FootprintAccumulator('1m',.1,250);const resumed=new FootprintAccumulator('1m',.1,250);
  const rows=Array.from({length:100},(_,i)=>({...trade(i+1),timeMs:60001+i*1000,side:i%2?'sell':'buy'}));
  rows.slice(0,47).forEach(t=>all.ingest(t as any));resumed.restore(all.snapshot());rows.slice(47).forEach(t=>{all.ingest(t as any);resumed.ingest(t as any);});expect(resumed.snapshot()).toEqual(all.snapshot());
});
test('unsupported venues and malformed footprint values are rejected while Binance Spot is staged',()=>{
 const spotBar={...bar,source:'binance-spot-aggtrade'} as const;
 expect(stagingMarket({...series,market:'spot'})).toBe(true);expect(stagingMarket({venue:'hyperliquid',interval:'1m'})).toBe(false);expect(validBackendBar(bar)).toBe(true);expect(validBackendBar(spotBar,'spot')).toBe(true);expect(validBackendBar(spotBar)).toBe(false);expect(validBackendBar({...bar,cells:[{...bar.cells[0],askNotional:NaN}]})).toBe(false);
});

test('Spot footprints select Spot history and replay the Spot durable execution stream',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[],urls:string[]=[],socketUrls:string[]=[],spotBar={...bar,source:'binance-spot-aggtrade'};
 const spotResponse={...response(),source:'binance-spot-aggtrade',bars:[spotBar]};
 const request:any=async(url:string)=>{urls.push(url);return new Response(JSON.stringify(spotResponse));};
 let service:StagingFeedService|undefined;service=new StagingFeedService(e=>{events.push(e);if(e.type.startsWith('footprint-'))service?.command({type:'footprint-ack',key:(e as any).key,generation:(e as any).generation,batchId:(e as any).batchId});},request,()=>900000,url=>{socketUrls.push(url);const socket=new Socket();sockets.push(socket);return socket as any;});
 try{
   service.command({type:'footprint-subscribe',id:'spot',series:{...series,market:'spot'},rowPrice:25});
   await vi.advanceTimersByTimeAsync(0);
   expect(new URL(urls[0]!, 'http://localhost').searchParams.get('market')).toBe('spot');
   expect(new URL(socketUrls[0]!).pathname).toBe('/market-data/v1/stream');
   expect(new URL(socketUrls[0]!).searchParams.get('market')).toBe('spot');
   sockets[0]!.onopen?.();expect(sockets[0]!.sent[0]).toMatchObject({type:'subscribe',market:'spot'});
   sockets[0]!.receive({...packet(10,[11]),executions:[{...trade(11),timeMs:60003,market:'spot'}],coverage:spotResponse.coverage});
   expect((events.filter(event=>event.type==='footprint-patch').at(-1) as any).bars[0].source).toBe('binance-spot-aggtrade');
 }finally{service.dispose();vi.useRealTimers();}
});

test('older complete pages use one watermark, preserve live changes and restore bounded history',async()=>{
 vi.useFakeTimers(); const now=120*60000, events:any[]=[], sockets:Socket[]=[], urls:string[]=[];let resolveOlder:any;
 const latest={...bar,time:Math.floor((now-60000)/60000)*60};
 const initial={...response(),bars:[latest],watermark:10,cursor:10,coverage:{confirmedFrom:100*60000,confirmedTo:now,gaps:[]},status:{state:'live',lastUpdate:now}};
 const older={...bar,time:100*60};
 const request:any=async(url:string)=>{urls.push(url);if(url.includes('watermark='))return new Promise(r=>resolveOlder=()=>r(new Response(JSON.stringify({...initial,bars:[older]}))));return new Response(JSON.stringify(initial));};
 let service:StagingFeedService|undefined;
 try{service=new StagingFeedService(e=>{events.push(e);if(e.type.startsWith('footprint-'))service?.command({type:'footprint-ack',key:(e as any).key,generation:(e as any).generation,batchId:(e as any).batchId});},request,()=>now,()=>{const s=new Socket();sockets.push(s);return s as any;});
 service.command({type:'footprint-subscribe',id:'a',series,rowPrice:25});await vi.advanceTimersByTimeAsync(0);
 expect(urls).toHaveLength(2);expect(urls[1]).toContain('watermark=10');const p=new URL(urls[1]!,'http://localhost').searchParams;expect(Number(p.get('to'))).toBe(105*60000);expect(Number(p.get('from'))).toBe(100*60000);
 sockets[0]!.receive({...packet(10,[11]),executions:[{...trade(11),timeMs:latest.time*1000+1}],coverage:initial.coverage,collector:initial.status,sentAt:now});
 resolveOlder();await vi.advanceTimersByTimeAsync(0);
 const full=events.filter(e=>e.type==='footprint-snapshot').at(-1);expect(full.bars.map((b:any)=>b.time)).toEqual([older.time,latest.time]);expect(full.bars[1].aggregateRecordCount).toBe(3);expect(service.diagnostics().streams[0].cursor).toBe(11);expect(sockets[0]!.sent.at(-1)).toEqual({type:'ack',cursor:11});
 }finally{service?.dispose();vi.useRealTimers();}
});

test('history merge keeps latest live revision and evicts whole oldest bars at both bounds',()=>{
 const bars=Array.from({length:301},(_,i)=>({...bar,time:60+i*60,cells:Array.from({length:100},()=>({...bar.cells[0]}))}));
 const newest={...bars.at(-1)!,revision:99};const merged=boundedFootprintHistory([...bars,newest]);
 expect(merged).toHaveLength(180);expect(merged[0]!.time).toBe(bars[121]!.time);expect(merged.at(-1)!.revision).toBe(99);
 expect(boundedFootprintHistory(bars.map(b=>({...b,cells:[...bar.cells]})))).toHaveLength(300);
});
test('prepared closed totals never seed the live cursor accumulator or double count replay',async()=>{vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets}=await setup();const g=[...(service as any).groups.values()][0];let closed:any={...bar,revision:1000,aggregateRecordCount:4,cells:[{...bar.cells[0],askVol:4,askNotional:336004}]};(service as any).prepared={load:async(_f:any,_t:any,_i:any,_r:any,_s:any,p:any)=>p([closed],true,true),dispose(){}};try{service.command({type:'footprint-viewport',id:'a',from:60000,to:120000});await vi.advanceTimersByTimeAsync(0);expect(g.cursor).toBe(10);expect(g.accumulator.snapshot()[0].cells[0].askVol).toBe(2);expect(g.bars[0].cells[0].askVol).toBe(4);sockets[0]!.receive(packet(10,[11,12]));expect(g.cursor).toBe(12);expect(g.accumulator.snapshot()[0].cells[0].askVol).toBe(4);expect(g.bars[0].cells[0].askVol).toBe(4);closed={...closed,revision:2000,cells:[{...closed.cells[0],askVol:6}]};await (service as any).loadViewport(g,'a');sockets[0]!.receive(packet(12,[13]));expect(g.bars[0].revision).toBe(2000);expect(g.bars[0].cells[0].askVol).toBe(6);expect(g.cursor).toBe(13);}finally{service.dispose();}});
test('analysis warmup is opt-in and its failure leaves healthy visible staging data live',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_HISTORY_TILES','1');
 const now=9_000_000,events:Event[]=[],sockets:Socket[]=[],urls:string[]=[];
 const initial={...response(),status:{state:'live',lastUpdate:now}};
 const request=vi.fn(async(url:RequestInfo|URL)=>{
   const value=String(url);urls.push(value);
   if(value.includes('/v2/history/footprints')){
     const query=new URL(value,'http://localhost').searchParams;
     if(Number(query.get('from'))<4_020_000)return new Response(JSON.stringify({error:'optional warmup unavailable'}),{status:503});
     return new Response(JSON.stringify({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:[{from:Number(query.get('from')),revision:1,bar:null,coverage:{from:Number(query.get('from')),to:Number(query.get('to')),complete:true,gaps:[]}}]}));
   }
   return new Response(JSON.stringify(initial));
 });
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,url=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;});
 try{
   service.command({type:'footprint-subscribe',id:'a',series,rowPrice:25});await vi.advanceTimersByTimeAsync(0);
   const start=4_020_000,end=start+60_000;
   service.command({type:'footprint-viewport',id:'a',from:start,to:end,analysis:{enabled:true,lookback:50}});await vi.advanceTimersByTimeAsync(0);
   expect(urls.filter(url=>url.includes('/v2/history/footprints'))).toHaveLength(2);
   expect(events.filter((event:any)=>event.type==='footprint-status').some((event:any)=>event.status.state==='stale')).toBe(false);
   expect([...(service as any).groups.values()][0].bars).toHaveLength(1);
   const before=urls.filter(url=>url.includes('/v2/history/footprints')).length;
   service.command({type:'footprint-viewport',id:'a',from:start,to:end,analysis:{enabled:false,lookback:50}});await vi.advanceTimersByTimeAsync(0);
   expect(urls.filter(url=>url.includes('/v2/history/footprints'))).toHaveLength(before+1);
 }finally{service.dispose();vi.useRealTimers();}
});
test('bootstrap and prepared projections keep an unknown quote anchor unavailable until a new reliable candle',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets}=await setup();const g=[...(service as any).groups.values()][0];
 const preparedBars=Array.from({length:40},(_,i)=>({...bar,time:60+i*60,revision:100+i}));
 (service as any).prepared={load:async(...args:any[])=>args[5](preparedBars,true,true),dispose(){}};
 try{
   service.command({type:'footprint-viewport',id:'a',from:60_000,to:120_000,analysis:{enabled:false,lookback:50}});await vi.advanceTimersByTimeAsync(0);
   expect(g.quoteAvailable.get(bar.time)).toBe(false);
   expect(g.quoteAvailable.size).toBeLessThanOrEqual(g.accumulator.snapshot().length);
   sockets[0]!.receive(packet(10,[11]));
   expect(g.quoteAvailable.get(bar.time)).toBe(false);
   expect(g.analysisSummaries.get(bar.time)?.quoteDelta).toBeUndefined();
   expect(footprintForUnits(g.bars.find((item:any)=>item.time===bar.time),'btc')).not.toBeNull();
   expect(footprintForUnits(g.bars.find((item:any)=>item.time===bar.time),'usdt')).toBeNull();
   const next=packet(11,[12]);next.executions[0]!.timeMs=180_002;next.executions[0]!.quoteNotional=80_000;sockets[0]!.receive(next);
   expect(g.quoteAvailable.get(180)).toBe(true);
   expect(g.analysisSummaries.get(180)?.quoteDelta).toBe(80_000);
   expect(g.quoteAvailable.get(bar.time)).toBe(false);
 }finally{service.dispose();}
});

test('analysis warmup starts N+1 bars before the oldest rendered candidate beyond the dense four-hour cap',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service}=await setup();
 const step=60_000,epoch=1_800_000_000_000,now=epoch+30*3_600_000;
 (service as any).now=()=>now;
 let captured:any[]|undefined;
 (service as any).prepared={load:async(...args:any[])=>{captured=args;args[5]([],true,true);},dispose(){}};
 const requestedFrom=epoch+20*3_600_000,requestedTo=now,candidateFrom=epoch+25*3_600_000;
 try{
   service.command({type:'footprint-viewport',id:'a',from:requestedFrom,to:requestedTo,analysis:{enabled:true,lookback:50,candidateFrom}});
   await vi.advanceTimersByTimeAsync(1);
   const view=[...(service as any).groups.values()][0].views.get('a');
   expect(view.from).toBe(requestedFrom);
   expect(view.candidateFrom).toBe(candidateFrom);
   expect(captured?.[0]).toBe(view.from); // The viewport spans bounded four-hour requests, not a four-hour total cap.
   expect(captured?.[1]).toBe(requestedTo);
   expect(captured?.[7]).toBe(candidateFrom-51*step); // Summary-only context covers the rendered old candidate.
 }finally{service.dispose();}
});
test('unrelated live ticks do not block a prepared correction to an unchanged closed summary',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets}=await setup();const g=[...(service as any).groups.values()][0];let finishLoad!:()=>void;
 const corrected={...bar,revision:1000,delta:-7,cells:bar.cells.map(cell=>({...cell}))};
 const correction=preparedFootprintAnalysisSummary(corrected,{from:60_000,to:120_000,complete:true,gaps:[]},footprintAnalysisSourceKey('perpetual','1m'),'1m',true,900_000);
 (service as any).prepared={load:async(...args:any[])=>new Promise<void>(resolve=>{const publish=args[5];finishLoad=()=>{publish([corrected],true,true,{from:60_000,to:120_000,summaries:[correction],removedTimes:[]});resolve();};}),dispose(){}};
 try{
   service.command({type:'footprint-viewport',id:'a',from:60_000,to:120_000,analysis:{enabled:false,lookback:50}});await vi.advanceTimersByTimeAsync(0);
   const unrelated=packet(10,[11]);unrelated.executions[0]!.timeMs=180_002;
   sockets[0]!.receive(unrelated);
   expect(g.liveSummaryVersions.has(bar.time)).toBe(false);
   finishLoad();await vi.advanceTimersByTimeAsync(0);
   expect(g.analysisSummaries.get(bar.time)).toMatchObject({revision:1000,revisionSource:'prepared-content-hash',delta:-7});
 }finally{service.dispose();}
});
test('visible historical bars outrank a full offscreen live cache',()=>{const older=Array.from({length:48},(_,i)=>({...bar,time:(i+1)*60,cells:[...bar.cells]})),recent=Array.from({length:300},(_,i)=>({...bar,time:(i+1000)*60,cells:[...bar.cells]}));const kept=boundedFootprintHistory([...recent,...older],new Set([...older.map(b=>b.time),recent.at(-1)!.time]));expect(kept).toHaveLength(300);expect(older.every(b=>kept.some(k=>k.time===b.time))).toBe(true);expect(kept.at(-1)?.time).toBe(recent.at(-1)?.time);});

test('future whitespace does not consume visible hourly history or impose a four-hour view cap',async()=>{
 const {footprintPastViewport}=await import('../src/feed/staging-service');
 const hour=3600000,day=Date.UTC(2026,10,4),now=day+16*hour+19*60000;
 for(const endHour of [16,19,30])expect(footprintPastViewport(day+11*hour,day+endHour*hour,now,hour)).toEqual({from:day+11*hour,to:day+16*hour});
 expect(footprintPastViewport(day-8*hour,day+19*hour,now,hour)).toEqual({from:day-8*hour,to:day+16*hour});
 expect(footprintPastViewport(day+3*hour,day+7*hour,now,hour)).toEqual({from:day+3*hour,to:day+7*hour});
});

test('prepared hourly history renders before a delayed live bootstrap and remains separate on restore',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_HISTORY_TILES','1');
 const hour=3600000,day=Date.UTC(2026,10,4),now=day+16*hour+19*60000,events:Event[]=[],sockets:Socket[]=[];
 let finishBootstrap!:(response:Response)=>void;
 const request:any=async(url:string)=>{
  if(url.endsWith('/footprints-batch'))return new Response(null,{status:405});
  if(!url.includes('/v2/history/footprints'))return new Promise<Response>(resolve=>finishBootstrap=resolve);
  const q=new URL(url,'http://localhost').searchParams,from=Number(q.get('from')),to=Number(q.get('to'));
  return new Response(JSON.stringify({version:1,feed:'binance:perpetual:BTCUSDT:aggregate-trade',state:'ready',tiles:Array.from({length:(to-from)/hour},(_,i)=>{
   const at=from+i*hour;return {from:at,revision:100+i,bar:{...bar,time:at/1000,rowSize:25},coverage:{from:at,to:at+hour,complete:true,gaps:[]}};
  })}));
 };
 let service:StagingFeedService|undefined;
 service=new StagingFeedService(event=>{events.push(event);if(event.type.startsWith('footprint-'))queueMicrotask(()=>service?.command({type:'footprint-ack',key:(event as any).key,generation:(event as any).generation,batchId:(event as any).batchId}));},request,()=>now,()=>{const socket=new Socket();sockets.push(socket);return socket as any;});
 try {
  service.command({type:'footprint-subscribe',id:'delayed',series:{...series,interval:'1h'},rowPrice:25});
  service.command({type:'footprint-viewport',id:'delayed',from:day+11*hour,to:day+19*hour});
  await vi.advanceTimersByTimeAsync(1);
  const g=[...(service as any).groups.values()][0];
  expect(g.accumulator).toBeUndefined();expect(g.bars.map((b:any)=>b.time)).toEqual([11,12,13,14,15].map(h=>(day+h*hour)/1000));
  expect(events.some((e:any)=>e.type==='footprint-snapshot'&&e.bars.length===5)).toBe(true);
  const initial={...response(),bars:[{...bar,time:(day+16*hour)/1000,rowSize:25}],coverage:{...response().coverage,confirmedFrom:day,confirmedTo:now,from:day+16*hour,to:now,gaps:[]},status:{state:'live',lastUpdate:now}};
  finishBootstrap(new Response(JSON.stringify(initial)));await vi.advanceTimersByTimeAsync(1);
  expect(g.bars).toHaveLength(6);expect(g.accumulator.snapshot()).toHaveLength(1);
  expect([...g.analysisSummaries.values()].filter((s:any)=>s.coverageEvidence.provenance==='prepared-tile')).toHaveLength(5);
  expect(g.lastStatus.history).toMatchObject({ready:true,validated:true});
 } finally {service.dispose();}
});

test.each([undefined,'a'])('history retry (%s) retains healthy native/footprint sockets and acknowledged cursors',async(id)=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets,request,ack}=await setup();
 sockets[0]!.receive(packet(10,[11]));ack();
 request.mockImplementation(async(input?:any)=>new Response(JSON.stringify(String(input).includes('native-candles')?{source:'binance-native-kline',candles:[]}:{...response(),bars:[{...bar,time:900,rowSize:50}]})));
 service.command({type:'subscribe',id:'healthy-native',series});
 service.command({type:'footprint-subscribe',id:'healthy-footprint',series:{...series,interval:'5m'},rowPrice:50});await vi.advanceTimersByTimeAsync(0);
 const healthy=[...(service as any).groups.values()].filter((group:any)=>!group.ids.has('a')).map((group:any)=>({group,socket:group.ws,cursor:group.cursor}));
 const g=[...(service as any).groups.values()][0],socket=g.ws,cursor=g.cursor;
 let fail=true;
 (service as any).prepared={load:async(...args:any[])=>{if(fail)throw Error('Historical worker temporarily unavailable');args[5]([],true,true);},dispose(){}};
 try{
  service.command({type:'footprint-viewport',id:'a',from:60000,to:120000});await vi.advanceTimersByTimeAsync(0);
  expect(g.lastStatus.state).toBe('live');expect(g.lastStatus.history.error).toContain('temporarily unavailable');expect(g.bars).toHaveLength(1);
  fail=false;service.command({type:'footprint-retry',...(id?{id}:{})});await vi.advanceTimersByTimeAsync(0);
  expect(g.lastStatus.history.error).toBeUndefined();expect(g.lastStatus.history.ready).toBe(true);
  expect(g.ws).toBe(socket);expect(g.cursor).toBe(cursor);expect(sockets).toHaveLength(3);expect(sockets.every(socket=>!socket.closed)).toBe(true);
  for(const item of healthy){expect(item.group.ws).toBe(item.socket);expect(item.group.cursor).toBe(item.cursor);}
 }finally{service.dispose();}
});

test('explicit bootstrap retry reaches its failed current job once, then resumes ordinary polling',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_HISTORY_TILES','1');let now=900000,resumed=false;
 const urls:string[]=[],events:Event[]=[];
 const request=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input),'http://localhost');urls.push(url.toString());
  if(url.searchParams.get('retry')==='1'){resumed=true;return new Response(JSON.stringify({state:'building'}));}
  return new Response(JSON.stringify(resumed?{...response(),state:'ready'}:{state:'unavailable',error:'Previous current build failed'}));});
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,()=>new Socket() as any);
 try{
  service.command({type:'footprint-subscribe',id:'current-retry',series,rowPrice:25});await vi.advanceTimersByTimeAsync(0);
  now+=1001;await vi.advanceTimersByTimeAsync(1001);expect(urls.every(url=>!new URL(url).searchParams.has('retry'))).toBe(true);
  service.command({type:'footprint-retry',id:'current-retry'});await vi.advanceTimersByTimeAsync(0);
  expect(urls.filter(url=>new URL(url).searchParams.get('retry')==='1')).toHaveLength(1);
  now+=1001;await vi.advanceTimersByTimeAsync(1001);
  const group=[...(service as any).groups.values()][0];expect(group.lastStatus.state).toBe('loading');expect(group.lastStatus.message).toContain('awaiting live execution stream');expect(group.cursor).toBe(10);expect(group.executionProof).toMatchObject({appliedBatches:0,acksSent:0});
  expect(new URL(urls.at(-1)!).searchParams.has('retry')).toBe(false);
 }finally{service.dispose();}
});

test('a normal bootstrap response cannot consume a Retry queued while it was in flight',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_HISTORY_TILES','1');let now=900000,release!:()=>void,normal=0;
 const gate=new Promise<void>(resolve=>release=resolve),urls:string[]=[];
 const request=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input),'http://localhost');urls.push(url.toString());
  if(url.searchParams.get('retry')==='1')return new Response(JSON.stringify({...response(),state:'ready'}));
  if(++normal===2)await gate;
  return new Response(JSON.stringify({state:'unavailable',error:'Previous current build failed'}));});
 const service=new StagingFeedService(()=>{},request,()=>now,()=>new Socket() as any);
 try{
  service.command({type:'footprint-subscribe',id:'queued-retry',series,rowPrice:25});await vi.advanceTimersByTimeAsync(0);
  now+=1001;await vi.advanceTimersByTimeAsync(1001);expect(normal).toBe(2);
  service.command({type:'footprint-retry',id:'queued-retry'});release();await vi.advanceTimersByTimeAsync(0);
  now+=1001;await vi.advanceTimersByTimeAsync(1001);
  expect(urls.filter(url=>new URL(url).searchParams.get('retry')==='1')).toHaveLength(1);
  const group=[...(service as any).groups.values()][0];expect(group.lastStatus.state).toBe('loading');expect(group.lastStatus.message).toContain('awaiting live execution stream');expect(group.cursor).toBe(10);expect(group.executionProof).toMatchObject({appliedBatches:0,acksSent:0});
 }finally{service.dispose();}
});

test('explicit canonical invalidation revokes a same-revision prepared summary without resetting live state',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets}=await setup();const g=[...(service as any).groups.values()][0];
 const closed={...bar,revision:1000,cells:bar.cells.map(cell=>({...cell}))};
 const summary=preparedFootprintAnalysisSummary(closed,{from:60000,to:120000,complete:true,gaps:[]},footprintAnalysisSourceKey('perpetual','1m'),'1m',true,900000)!;
 let pending=false;
 (service as any).prepared={load:async(...args:any[])=>args[5]([closed],!pending,true,{from:60000,to:120000,summaries:[pending?{...summary,coverageEvidence:{...summary.coverageEvidence,validated:false}}:summary],removedTimes:[],invalidatedTimes:pending?[60]:[]}),dispose(){}};
 try{
  service.command({type:'footprint-viewport',id:'a',from:60000,to:120000});await vi.advanceTimersByTimeAsync(0);
  expect(g.analysisSummaries.get(60).coverageEvidence.validated).toBe(true);const cursor=g.cursor,accumulator=g.accumulator;
  pending=true;await (service as any).loadViewport(g,'a');
  expect(g.analysisSummaries.get(60).coverageEvidence.validated).toBe(false);expect(g.bars.find((b:any)=>b.time===60).revision).toBe(1000);
  expect(g.cursor).toBe(cursor);expect(g.accumulator).toBe(accumulator);expect(sockets[0].closed).toBe(false);
  expect((service as any).historyState(g).validated).toBe(false);
  pending=false;await (service as any).loadViewport(g,'a');expect(g.analysisSummaries.get(60).coverageEvidence.validated).toBe(true);
 }finally{service.dispose();}
});

test('native current starts before delayed history and late REST receipt revisions cannot overwrite stream candles',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[];let resolve!: (r:Response)=>void;
 const request=vi.fn(()=>new Promise<Response>(r=>resolve=r));let now=900000;
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,()=>{const s=new Socket();sockets.push(s);return s as any;});
 const live={t:900000,o:84000,h:84100,l:83900,c:84080,v:8,revision:900010,closed:false};
 try{
  service.command({type:'subscribe',id:'native',series});
  expect(sockets).toHaveLength(1);sockets[0]!.onopen?.();
  expect(sockets[0]!.sent[0]).toMatchObject({interval:'1m',after:0});
  sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:live});
  expect(events.find(e=>e.type==='snapshot')).toMatchObject({candles:[live]});
  resolve(new Response(JSON.stringify({source:'binance-native-kline',candles:[{...live,t:840000,closed:true},{...live,c:84010,v:1,revision:999999}]})));
  await vi.advanceTimersByTimeAsync(1);
  const patches=events.filter(e=>e.type==='patch');expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({candles:[expect.objectContaining({t:840000,closed:true})]});
  now=900020;sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:{...live,c:84090,revision:900020}});
  expect(events.filter(e=>e.type==='patch').at(-1)).toMatchObject({candles:[expect.objectContaining({c:84090})]});
  expect((events.filter(e=>e.type==='status').at(-1) as any).status).toMatchObject({state:'live'});
 }finally{service.dispose();}
});
test('native history Retry keeps healthy current socket, retains bars and clears recovered history error',async()=>{
 vi.useFakeTimers();vi.setSystemTime(900000);const events:Event[]=[],sockets:Socket[]=[];let reject!:(e:Error)=>void;
 const live={t:900000,o:84000,h:84100,l:83900,c:84080,v:8,revision:900010,closed:false};
 const request=vi.fn().mockImplementationOnce(()=>new Promise((_r,j)=>reject=j)).mockResolvedValueOnce(new Response(JSON.stringify({source:'binance-native-kline',candles:[{...live,t:840000,closed:true}]})));
 const service=new StagingFeedService(e=>events.push(e),request,Date.now,()=>{const s=new Socket();sockets.push(s);return s as any;});
 try{
  service.command({type:'subscribe',id:'native',series});expect(sockets).toHaveLength(1);
  sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:live});
  reject(Error('history unavailable'));await vi.advanceTimersByTimeAsync(1);
  expect((events.filter(e=>e.type==='status').at(-1) as any).status).toMatchObject({state:'live',message:expect.stringContaining('history unavailable')});
  service.command({type:'retry',id:'native'});await vi.advanceTimersByTimeAsync(1);
  expect(sockets).toHaveLength(1);expect(sockets[0]!.closed).toBe(false);expect(service.diagnostics().retainedBars).toBe(2);
  const status=(events.filter(e=>e.type==='status').at(-1) as any).status;expect(status.state).toBe('live');expect(status.message).not.toContain('history unavailable');
  sockets[0]!.close();await vi.advanceTimersByTimeAsync(2001);expect(sockets).toHaveLength(2);expect(request).toHaveBeenCalledTimes(2);
 }finally{service.dispose();}
});
test('native collector heartbeats do not certify a missing or expired candle stream as live',async()=>{
 vi.useFakeTimers();let now=900000;const events:Event[]=[],sockets:Socket[]=[];
 const service=new StagingFeedService(e=>events.push(e),()=>new Promise(()=>{}),()=>now,()=>{const s=new Socket();sockets.push(s);return s as any;});
 const health=()=>sockets[0]!.receive({type:'health',collector:{state:'live',lastUpdate:now}});
 try{
  service.command({type:'subscribe',id:'native',series});expect(sockets).toHaveLength(1);health();
  expect((events.filter(e=>e.type==='status').at(-1) as any).status.state).not.toBe('live');
  sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:{t:900000,o:84000,h:84100,l:83900,c:84080,v:8,revision:900010,closed:false}});
  now+=16000;health();
  expect((events.filter(e=>e.type==='status').at(-1) as any).status).toMatchObject({state:'stale',message:expect.stringContaining('native candle')});
 }finally{service.dispose();}
});

test('native REST receipt revisions do not suppress subsequent exchange revisions or reopen closed candles',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[];
 const current={t:900000,o:84000,h:84100,l:83900,c:84020,v:2,revision:999999,closed:false};
 const service=new StagingFeedService(e=>events.push(e),async()=>new Response(JSON.stringify({source:'binance-native-kline',candles:[current]})),()=>900000,()=>{const s=new Socket();sockets.push(s);return s as any;});
 const send=(candle:typeof current)=>sockets.at(-1)!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle});
 try{
  service.command({type:'subscribe',id:'native',series});await vi.advanceTimersByTimeAsync(1);
  send({...current,c:84050,v:5,revision:900005});
  expect(events.filter(e=>e.type==='patch').at(-1)).toMatchObject({candles:[expect.objectContaining({c:84050,v:5,revision:900005})]});
  send({...current,c:84060,v:6,revision:900006,closed:true});const count=events.filter(e=>e.type==='patch').length;
  send({...current,c:84030,v:3,revision:900003});send({...current,c:84070,v:7,revision:900007});
  expect(events.filter(e=>e.type==='patch')).toHaveLength(count);
  service.command({type:'online',online:false});service.command({type:'online',online:true});expect(sockets).toHaveLength(2);
  sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:{...current,c:84090,revision:900009}});
  expect(events.filter(e=>e.type==='patch')).toHaveLength(count);
 }finally{service.dispose();}
});
test('native stream revision bookkeeping stays bounded across rollover and unsubscribe',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[];
 const service=new StagingFeedService(e=>events.push(e),async()=>new Response(JSON.stringify({source:'binance-native-kline',candles:[]})),()=>900000,()=>{const s=new Socket();sockets.push(s);return s as any;});
 try{
  service.command({type:'subscribe',id:'native',series});await vi.advanceTimersByTimeAsync(1);
  for(let i=0;i<1200;i++)sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:{t:(i+1)*60000,o:84000,h:84100,l:83900,c:84080,v:8,revision:i+1,closed:false}});
  expect(service.diagnostics().retainedBars).toBe(1000);expect(service.diagnostics().streams[0]?.native?.retainedStreamVersions).toBe(1000);
  service.command({type:'unsubscribe',id:'native'});expect(service.diagnostics().retainedBars).toBe(0);expect(service.diagnostics().streams).toEqual([]);expect(sockets[0]!.closed).toBe(true);
 }finally{service.dispose();}
});

test('native closed REST repairs survive replay of older cached closed stream events',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[];
 const closed={t:840000,o:84000,h:84100,l:83900,c:84080,v:8,revision:900000,closed:true};
 const service=new StagingFeedService(e=>events.push(e),async()=>new Response(JSON.stringify({source:'binance-native-kline',candles:[closed]})),()=>900000,()=>{const s=new Socket();sockets.push(s);return s as any;});
 try{
  service.command({type:'subscribe',id:'native',series});await vi.advanceTimersByTimeAsync(1);
  sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:{...closed,c:84050,v:5,revision:899000}});
  expect(events.filter(e=>e.type==='patch')).toEqual([]);
  expect(events.find(e=>e.type==='snapshot')).toMatchObject({candles:[closed]});
 }finally{service.dispose();}
});

test('large native backfill uses one merging snapshot while retaining the independently streamed current candle',async()=>{
 vi.useFakeTimers();const events:Event[]=[],sockets:Socket[]=[];let resolve!:(r:Response)=>void;
 const service=new StagingFeedService(e=>events.push(e),()=>new Promise<Response>(r=>resolve=r),()=>90000000,()=>{const s=new Socket();sockets.push(s);return s as any;});
 const current={t:90000000,o:84000,h:84100,l:83900,c:84080,v:8,revision:90000001,closed:false};
 try{
  service.command({type:'subscribe',id:'native',series});sockets[0]!.receive({type:'native-candle',source:'binance-native-kline',interval:'1m',candle:current});
  const candles=Array.from({length:1000},(_,i)=>({...current,t:current.t-(999-i)*60000,c:84010,v:1,revision:99999999,closed:i<999}));
  resolve(new Response(JSON.stringify({source:'binance-native-kline',candles})));await vi.advanceTimersByTimeAsync(1);
  const updates=events.filter(e=>e.type==='snapshot'||e.type==='patch');expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({type:'snapshot',merge:true});
  expect((updates[1] as any).candles).toHaveLength(1000);expect((updates[1] as any).candles.at(-1)).toEqual(current);
  expect(service.diagnostics().retainedBars).toBe(1000);expect(sockets).toHaveLength(1);
 }finally{service.dispose();}
});

test('saved native history loads before delayed bootstrap and late receipts carry a lower read order',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');vi.useFakeTimers();
 const day=Date.UTC(2026,10,3),hour=3600000,now=day+16*hour+19*60000,source={...series,interval:'1h'} as const;
 const c=(t:number,closed=true)=>({t,o:84000,h:84010,l:83990,c:84001,v:2,quoteVolume:168002,revision:1,closed});
 const historical=[11,12,13,14,15].map(h=>c(day+h*hour)),events:Event[]=[],sockets:Socket[]=[];let finish!:(r:Response)=>void;
 const request=vi.fn(async(input:any)=>String(input).includes('from=')?new Response(JSON.stringify({source:'binance-native-kline',candles:historical})):await new Promise<Response>(r=>finish=r));
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,()=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;});
 try{
  service.command({type:'subscribe',id:'native-view',series:source});service.command({type:'candle-viewport',id:'native-view',from:day+11*hour,to:day+19*hour,known:[]});await vi.advanceTimersByTimeAsync(0);
  const delivered=events.find(e=>e.type==='snapshot'&&e.nativeVersion?.request!==undefined) as Extract<Event,{type:'snapshot'|'patch'}>;
  expect(delivered).toMatchObject({type:'snapshot',merge:true,ids:['native-view'],candles:historical,nativeVersion:{stream:0,request:2}});
  expect(events.filter(e=>e.type==='status').at(-1)).toMatchObject({status:{nativeHistory:{state:'loading',viewport:{state:'ready',requestedSlots:5,loadedSlots:5}}}});
  const live={...c(day+16*hour,false),c:84009,v:9,revision:2};sockets[0].receive({type:'native-candle',source:'binance-native-kline',interval:'1h',candle:live});
  finish(new Response(JSON.stringify({source:'binance-native-kline',candles:[{...historical[0],c:83999,revision:99999},{...live,c:83999,v:1,revision:99999}]})));await vi.advanceTimersByTimeAsync(0);
  const older=events.filter(e=>e.type==='snapshot'||e.type==='patch').at(-1) as Extract<Event,{type:'snapshot'|'patch'}>;
  expect(older.nativeVersion).toEqual({stream:0,request:1});expect(older.candles.some(c=>c.t===live.t)).toBe(false);
  expect(events.filter(e=>e.type==='status').at(-1)).toMatchObject({status:{state:'live',nativeHistory:{state:'ready',viewport:{state:'ready',loadedSlots:5}}}});
  expect(sockets).toHaveLength(1);expect(sockets[0].closed).toBe(false);
 }finally{service.dispose();}
});

test('native visible-history Retry clears recovery status without reconnecting a healthy current stream',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');vi.useFakeTimers();
 const day=Date.UTC(2026,10,3),hour=3600000,now=day+16*hour+19*60000,source={...series,interval:'1h'} as const;
 const candles=[11,12,13,14,15].map(h=>({t:day+h*hour,o:84000,h:84001,l:83999,c:84000,v:2,revision:1,closed:true}));
 const events:Event[]=[],sockets:Socket[]=[],headers:Headers[]=[];let fail=true;
 const request=vi.fn(async(input:any,init?:RequestInit)=>{
  if(!String(input).includes('from='))return new Response(JSON.stringify({source:'binance-native-kline',candles:[]}));
  headers.push(new Headers(init?.headers));return fail?new Response('',{status:503}):new Response(JSON.stringify({source:'binance-native-kline',candles}));
 });
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,()=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;});
 try{
  service.command({type:'subscribe',id:'native-view',series:source});await vi.advanceTimersByTimeAsync(0);
  sockets[0].receive({type:'native-candle',source:'binance-native-kline',interval:'1h',candle:{...candles[0],t:day+16*hour,closed:false}});
  service.command({type:'candle-viewport',id:'native-view',from:day+11*hour,to:day+19*hour,known:[]});await vi.advanceTimersByTimeAsync(0);
  expect(events.filter(e=>e.type==='status').at(-1)).toMatchObject({status:{state:'live',nativeHistory:{state:'ready',viewport:{state:'failed',error:'History HTTP 503'}}}});
  fail=false;service.command({type:'retry',id:'native-view'});await vi.advanceTimersByTimeAsync(0);
  const latest=events.filter(e=>e.type==='status').at(-1) as Extract<Event,{type:'status'}>;
  expect(latest.status.state).toBe('live');expect(latest.status.nativeHistory?.viewport).toMatchObject({state:'ready',loadedSlots:5,retryable:false});expect(latest.status.nativeHistory?.viewport?.error).toBeUndefined();
  expect(sockets).toHaveLength(1);expect(sockets[0].closed).toBe(false);expect(headers).toHaveLength(2);expect(headers[0].get('X-IQ-View-Id')).toBe(headers[1].get('X-IQ-View-Id'));
  expect(service.diagnostics().retainedBars).toBe(1);
 }finally{service.dispose();}
});

test('native cache survives group release, preserves healthy live state on validation failure and retries only that history view',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const from=Date.UTC(2026,10,3,11),step=300000,now=from+10*86400000,series={venue:'binance',market:'spot',interval:'5m'} as const;
 const candle=(t:number,closed=true)=>({t,o:80000,h:80010,l:79990,c:80001,v:2,quoteVolume:160002,revision:1,closed}),past=Array.from({length:5},(_,i)=>candle(from+i*step));
 const events:Event[]=[],sockets:Socket[]=[];let reads=0,fail!:(r:Response)=>void;
 const request=vi.fn(async(url:RequestInfo|URL)=>{
  const historical=new URL(String(url),'http://test').searchParams.has('from');
  if(historical&&++reads===2)return new Promise<Response>(resolve=>fail=resolve);
  return new Response(JSON.stringify({source:'binance-native-kline',market:'spot',instrument:'binance:spot:BTCUSDT',candles:historical?past:[candle(now,false)]}));
 });
 const service=new StagingFeedService(e=>events.push(e),request,()=>now,()=>{const s=new Socket();sockets.push(s);return s as any;});
 try{
  service.command({type:'subscribe',id:'a',series});service.command({type:'candle-viewport',id:'a',from,to:from+5*step,known:[]});
  await vi.waitFor(()=>expect((service.diagnostics().streams[0] as any).native.viewportHistory.receivedBars).toBe(5));
  service.command({type:'unsubscribe',id:'a'});expect(service.diagnostics()).toMatchObject({groups:0,nativePresentation:{entries:1,rows:5}});expect(sockets[0].closed).toBe(true);
  events.length=0;service.command({type:'subscribe',id:'b',series});sockets[1].receive({type:'native-candle',source:'binance-native-kline',interval:'5m',candle:{...candle(now,false),v:8,revision:2}});
  service.command({type:'candle-viewport',id:'b',from,to:from+5*step,known:[]});
  expect(events.find((e:any)=>e.type==='snapshot'&&e.nativeVersion?.request===0)).toMatchObject({candles:past,nativeVersion:{stream:0,request:0}});
  await vi.waitFor(()=>expect(reads).toBe(2));fail(new Response('',{status:503}));
  await vi.waitFor(()=>expect((events.filter(e=>e.type==='status').at(-1) as any).status).toMatchObject({state:'live',nativeHistory:{viewport:{state:'failed',cachedSlots:5,loadedSlots:0}}}));
  service.command({type:'retry',id:'b'});await vi.waitFor(()=>expect((events.filter(e=>e.type==='status').at(-1) as any).status.nativeHistory.viewport).toMatchObject({state:'ready',loadedSlots:5}));
  expect(sockets).toHaveLength(2);expect(sockets[1].closed).toBe(false);expect((events.filter(e=>e.type==='status').at(-1) as any).status.state).toBe('live');
 }finally{service.dispose();}
 expect(service.diagnostics().nativePresentation.rows).toBe(0);
});

test('an empty fresh bootstrap cannot validate retained native bars and presentation cannot overwrite a group-owned bar',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const c={t:600000,o:84000,h:84100,l:83900,c:84050,v:12,revision:2,closed:true};let empty=false;const events:Event[]=[];
 const request=vi.fn(async()=>new Response(JSON.stringify({source:'binance-native-kline',candles:empty?[]:[c]})));
 const service=new StagingFeedService(e=>events.push(e),request,()=>900000,()=>new Socket() as any),series={venue:'binance',market:'perpetual',interval:'5m'} as const;
 try{
  service.command({type:'subscribe',id:'a',series});await vi.waitFor(()=>expect((service.diagnostics().streams[0] as any).native.historyReady).toBe(true));
  const group=[...(service as any).groups.values()][0],history=group.native.history,confirm=vi.spyOn(history,'confirmClosed');
  const before=events.length;expect((service as any).applyNativeHistory(group,'a',[{...c,c:84000,revision:1}],{stream:0,request:0},900000)).toEqual([]);expect(events).toHaveLength(before);expect(group.candles[0]).toEqual(c);
  empty=true;group.native.error='temporary bootstrap failure';service.command({type:'retry',id:'a'});await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(confirm).toHaveBeenCalled());
  expect(confirm).toHaveBeenLastCalledWith([]);expect(group.candles[0]).toEqual(c);
 }finally{service.dispose();}
});

for(const mismatch of [{market:'spot'},{instrument:'binance:perpetual:ETHUSDT'}])test(`native bootstrap rejects mismatched source identity before seeding presentation ${JSON.stringify(mismatch)}`,async()=>{
 const events:Event[]=[],request=async()=>new Response(JSON.stringify({source:'binance-native-kline',market:'perpetual',instrument:'binance:perpetual:BTCUSDT',candles:[{t:600000,o:84000,h:84100,l:83900,c:84050,v:12,revision:1,closed:true}],...mismatch}));
 const service=new StagingFeedService(e=>events.push(e),request,()=>900000,()=>new Socket() as any);
 try{service.command({type:'subscribe',id:'identity',series});await vi.waitFor(()=>expect(events.some((event:any)=>event.type==='status'&&event.status.state==='failed')).toBe(true));expect(events.some(event=>event.type==='snapshot')).toBe(false);expect(service.diagnostics().nativePresentation.rows).toBe(0);}finally{service.dispose();}
});

test('saved-view handoff shares a prepared footprint job and releases only the departing consumer',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service,sockets}=await setup(),g=[...(service as any).groups.values()][0];
 let publish!:Function,finish!:()=>void,signal!:AbortSignal;
 const load=vi.fn(async(...args:any[])=>{signal=args[4];publish=args[5];await new Promise<void>(resolve=>finish=resolve);});
 (service as any).prepared={load,dispose(){}};
 try{
  service.command({type:'footprint-viewport',id:'a',from:60000,to:180000});
  publish([bar],false,true);const job=g.views.get('a'),socket=sockets[0],accumulator=g.accumulator,cursor=g.cursor;
  service.command({type:'footprint-subscribe',id:'visible',series,rowPrice:25});
  service.command({type:'footprint-viewport',id:'visible',from:60000,to:180000});
  expect(load).toHaveBeenCalledTimes(1);expect(g.views.get('visible')).toBe(job);expect((service as any).historyState(g).ranges).toHaveLength(1);expect(service.diagnostics().views[0].consumers).toBe(2);
  service.command({type:'footprint-unsubscribe',id:'a'});
  expect(signal.aborted).toBe(false);expect(socket.closed).toBe(false);expect(g.cursor).toBe(cursor);expect(g.accumulator).toBe(accumulator);
  publish([bar,{...bar,time:120}],true,true);finish();await vi.advanceTimersByTimeAsync(0);
  expect(g.views.get('visible').loaded).toBe(true);expect(g.bars.map((b:any)=>b.time)).toContain(120);
  service.command({type:'footprint-unsubscribe',id:'visible'});expect(signal.aborted).toBe(true);
  service.command({type:'footprint-subscribe',id:'reopened',series,rowPrice:25});service.command({type:'footprint-viewport',id:'reopened',from:60000,to:180000});expect(load).toHaveBeenCalledTimes(2);
 }finally{finish?.();service.dispose();}
});

test('panning one footprint consumer preserves its peer job and failed shared Retry submits once',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service}=await setup(),g=[...(service as any).groups.values()][0];const calls:any[][]=[];
 (service as any).prepared={load:vi.fn(async(...args:any[])=>{calls.push(args);await new Promise<void>(resolve=>args[4].addEventListener('abort',()=>resolve(),{once:true}));}),dispose(){}};
 try{
  service.command({type:'footprint-viewport',id:'a',from:60000,to:180000});
  service.command({type:'footprint-subscribe',id:'peer',series,rowPrice:25});service.command({type:'footprint-viewport',id:'peer',from:60000,to:180000});
  expect(calls).toHaveLength(1);const original=g.views.get('a');
  service.command({type:'footprint-viewport',id:'peer',from:120000,to:240000});expect(calls).toHaveLength(2);expect(calls[0][4].aborted).toBe(false);
  service.command({type:'footprint-viewport',id:'peer',from:60000,to:180000});expect(calls).toHaveLength(2);expect(calls[1][4].aborted).toBe(true);expect(g.views.get('peer')).toBe(original);
  // A shared settled failure is one retry interest, even with two subscribers.
  original.abort.abort();original.busy=false;original.error='temporary build failure';original.retryAt=Infinity;
  service.command({type:'footprint-retry'});expect(calls).toHaveLength(3);expect(original.retryRequested).toBe(false);
 }finally{service.dispose();}
});


test('an aborted shared footprint attempt cannot publish through a replacement attempt controller',async()=>{
 vi.stubEnv('VITE_HISTORY_TILES','1');const {service}=await setup(),g=[...(service as any).groups.values()][0],calls:any[][]=[],finish:Array<()=>void>=[];
 (service as any).prepared={load:vi.fn(async(...args:any[])=>{calls.push(args);await new Promise<void>(resolve=>finish.push(resolve));}),dispose(){}};
 try{
  service.command({type:'footprint-viewport',id:'a',from:60000,to:180000});
  service.command({type:'online',online:false});expect(calls[0][4].aborted).toBe(true);finish[0]();await vi.advanceTimersByTimeAsync(0);
  service.command({type:'online',online:true});void (service as any).loadViewport(g,'a');expect(calls).toHaveLength(2);
  calls[1][5]([{...bar,revision:2000}],true,true);expect(g.bars.find((b:any)=>b.time===60).revision).toBe(2000);
  calls[0][5]([{...bar,revision:9999}],true,true);expect(g.bars.find((b:any)=>b.time===60).revision).toBe(2000);expect(g.views.get('a').busy).toBe(true);
 }finally{for(const resolve of finish)resolve();service.dispose();}
});

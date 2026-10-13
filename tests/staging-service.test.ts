import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { StagingFeedService, stagingMarket, validBackendBar, boundedFootprintHistory } from '../src/feed/staging-service';
import { FootprintAccumulator } from '../src/feed/footprint';
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
async function setup() {
  vi.useFakeTimers(); const events: Event[] = []; const sockets: Socket[]=[];
  const request=vi.fn(async()=>new Response(JSON.stringify(response())));
  const service=new StagingFeedService(e=>events.push(e),request,()=>900000,()=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;});
  service.command({type:'footprint-subscribe',id:'a',series,rowPrice:25});await vi.advanceTimersByTimeAsync(1);
  const ack=()=>{const e:any=events.at(-1);service.command({type:'footprint-ack',key:e.key,generation:e.generation,batchId:e.batchId});};
  ack();ack();sockets[0]!.onopen?.();return {service,events,sockets,request,ack};
}
test('history seeds shared accumulator; durable batches update incrementally without periodic HTTP',async()=>{
  const {service,events,sockets,request}=await setup();
  expect(sockets[0]!.sent[0].after).toBe(10);
  sockets[0]!.receive(packet(10,[11,12]));
  const patch:any=events.at(-1);expect(patch.type).toBe('footprint-patch');expect(patch.bars[0].aggregateRecordCount).toBe(4);expect(patch.bars[0].cells[0].askNotional).toBe(336004);
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
test('delayed UI ACK coalesces complete bounded state and subscriptions share stream',async()=>{
  const {service,events,sockets,ack,request}=await setup();sockets[0]!.receive(packet(10,[11]));sockets[0]!.receive(packet(11,[12]));
  service.command({type:'footprint-subscribe',id:'b',series,rowPrice:25});await vi.advanceTimersByTimeAsync(1);ack();
  const latest:any=events.at(-1);expect(latest.type).toBe('footprint-snapshot');expect(latest.ids).toEqual(['a','b']);expect(latest.bars[0].aggregateRecordCount).toBe(4);expect(request).toHaveBeenCalledTimes(1);expect(sockets).toHaveLength(1);service.dispose();
});
test('restore plus replay has parity with uninterrupted aggregation, including extrema and quote volume',()=>{
  const all=new FootprintAccumulator('1m',.1,250);const resumed=new FootprintAccumulator('1m',.1,250);
  const rows=Array.from({length:100},(_,i)=>({...trade(i+1),timeMs:60001+i*1000,side:i%2?'sell':'buy'}));
  rows.slice(0,47).forEach(t=>all.ingest(t as any));resumed.restore(all.snapshot());rows.slice(47).forEach(t=>{all.ingest(t as any);resumed.ingest(t as any);});expect(resumed.snapshot()).toEqual(all.snapshot());
});
test('unsupported markets and malformed footprint values are rejected',()=>{
 expect(stagingMarket({...series,market:'spot'})).toBe(false);expect(stagingMarket({venue:'hyperliquid',interval:'1m'})).toBe(false);expect(validBackendBar(bar)).toBe(true);expect(validBackendBar({...bar,cells:[{...bar.cells[0],askNotional:NaN}]})).toBe(false);
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

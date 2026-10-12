import { afterEach, expect, test, vi } from 'vitest';
import { StagingFeedService, stagingMarket, validBackendBar } from '../src/feed/staging-service';
import { FootprintAccumulator } from '../src/feed/footprint';
import type { Event } from '../src/feed/protocol';
afterEach(() => vi.useRealTimers());
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

import { describe,it,expect,vi,afterEach } from 'vitest';
import { MarketService,type Transport } from '../src/feed/service';
import { type Candle,type Event } from '../src/feed/protocol';
const b=(t=1791558000000,c=83000):Candle=>({t,o:83000,h:83010,l:82990,c,v:10,revision:0,closed:false});
class Socket {
  readyState=0;sent:unknown[]=[];onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
  send(s:string){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}open(){this.readyState=1;this.onopen?.();}
  candle(c:Candle){this.onmessage?.({data:JSON.stringify({e:'kline',E:c.revision,k:{s:'BTCUSDT',i:'1m',t:c.t,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v,x:c.closed}})});}
}
let service:MarketService;afterEach(()=>{service?.dispose();vi.useRealTimers();});
function setup(load:Transport['history']){vi.useFakeTimers();const sockets:Socket[]=[];const events:Event[]=[];const history=vi.fn(load);service=new MarketService(e=>events.push(e),{history,socket:()=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;},now:()=>Date.now(),random:()=>.5});return {sockets,events,history};}
describe('worker service lifecycle',()=>{
  it('deduplicates history and socket; ref-count cleanup',async()=>{const x=setup(async()=>[b()]);service.subscribe('a',{venue:'binance',interval:'1m'});service.subscribe('b',{venue:'binance',interval:'1m'});expect(x.history).toHaveBeenCalledTimes(1);expect(x.sockets).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);service.unsubscribe('a');expect(service.diagnostics().series).toBe(1);service.unsubscribe('b');expect(service.diagnostics()).toMatchObject({series:0,subscriptions:0,sockets:0});});
  it('buffers live while history loads; old history cannot overwrite',async()=>{let resolve!:(bars:Candle[])=>void;const x=setup(()=>new Promise(r=>resolve=r));service.subscribe('a',{venue:'binance',interval:'1m'});x.sockets[0].open();x.sockets[0].candle({...b(),c:83005,v:15,revision:20});resolve([b()]);await vi.advanceTimersByTimeAsync(100);const snapshot=x.events.find(e=>e.type==='snapshot');expect(snapshot&&'candles' in snapshot?snapshot.candles[0].v:0).toBe(15);});
  it('switch cancels obsolete response and emits no old snapshot',async()=>{let resolve!:(bars:Candle[])=>void;const x=setup(s=>s.interval==='1m'?new Promise(r=>resolve=r):Promise.resolve([b()]));service.subscribe('a',{venue:'binance',interval:'1m'});service.subscribe('a',{venue:'binance',interval:'5m'});resolve([b()]);await vi.advanceTimersByTimeAsync(100);expect(x.events.filter(e=>e.type==='snapshot').every(e=>'key' in e&&e.key.endsWith('5m'))).toBe(true);});
  it('reconnect resubscribes and repairs gap without regressing live',async()=>{const x=setup(async()=>[b()]);service.subscribe('a',{venue:'binance',interval:'1m'});await vi.advanceTimersByTimeAsync(1);x.sockets[0].open();await vi.advanceTimersByTimeAsync(1);x.sockets[0].candle({...b(),c:83005,revision:50});x.sockets[0].close();await vi.advanceTimersByTimeAsync(2100);expect(x.sockets.length).toBe(2);x.sockets[1].open();await vi.advanceTimersByTimeAsync(250);expect(x.history.mock.calls.length).toBeGreaterThan(1);expect(service.entries.values().next().value?.data.snapshot()[0].c).toBe(83005);expect(x.sockets[1].sent).toHaveLength(1);});
  it('hard rejection stops history retries and keeps other venue usable',async()=>{const {HttpError}=await import('../src/feed/adapters');const x=setup(async s=>{if(s.venue==='binance')throw new HttpError('HTTP 451',true);return [b()];});service.subscribe('a',{venue:'binance',interval:'1m'});service.subscribe('b',{venue:'hyperliquid',interval:'1m'});await vi.advanceTimersByTimeAsync(60000);expect(x.history.mock.calls.filter(c=>c[0].venue==='binance')).toHaveLength(1);expect(x.events.some(e=>e.type==='snapshot'&&e.key.startsWith('hyperliquid'))).toBe(true);});
});
it('Binance control messages are coalesced and limited below venue rate cap',async()=>{
  const x=setup(async()=>[b()]);service.subscribe('a',{venue:'binance',interval:'1m'});x.sockets[0].open();await vi.advanceTimersByTimeAsync(50);
  for(const interval of ['5m','15m','1h','4h','1m'] as const)service.subscribe('a',{venue:'binance',interval});await vi.advanceTimersByTimeAsync(1000);
  expect(x.sockets[0].sent.length).toBeLessThanOrEqual(6);
});
it('valid updates become stale after silence without dropping retained candles',async()=>{
  const x=setup(async()=>[b()]);service.subscribe('a',{venue:'binance',interval:'1m'});x.sockets[0].open();await vi.advanceTimersByTimeAsync(1);x.sockets[0].candle({...b(),revision:50});await vi.advanceTimersByTimeAsync(16001);
  expect(x.events.some(e=>e.type==='status'&&e.status.state==='stale')).toBe(true);expect(service.entries.values().next().value?.data.bars.size).toBe(1);
});

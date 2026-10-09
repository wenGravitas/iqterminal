import { describe,it,expect } from 'vitest';
import { Reconciler,PatchQueue,MAX_BARS } from '../src/feed/reconcile';
import { CandleStore,Viewport,candleGeometry } from '../src/chart/model';
import { parseLive,hyperCandle } from '../src/feed/adapters';
import { restoreValue } from '../src/layout';
import { type Candle } from '../src/feed/protocol';
const bar=(t=1791558000000,c=83000.01,v=10,revision=0):Candle=>({t,o:83000,h:83001,l:82999,c,v,revision,closed:false});
describe('candle reconciliation',()=>{
  it('live wins history overlap; snapshots idempotent; volume replaces',()=>{const r=new Reconciler();r.merge([bar(undefined,83000.3,12,10)]);r.merge([bar()]);expect(r.snapshot()[0].c).toBe(83000.3);r.merge([bar(undefined,83000.4,14,11)]);r.merge([bar(undefined,83000.4,14,11)]);expect(r.snapshot()).toHaveLength(1);expect(r.snapshot()[0].v).toBe(14);});
  it('rollover and late data remain sorted unique; older revisions rejected',()=>{const r=new Reconciler();const t=bar().t;r.merge([bar(t+60000),bar(t),bar(t-60000)]);r.merge([bar(t,83000.5,5,20),bar(t,83000.1,3,10)]);expect(r.snapshot().map(b=>b.t)).toEqual([t-60000,t,t+60000]);expect(r.snapshot()[1].c).toBe(83000.5);});
  it('bounds cache and recovers patch queue overflow with snapshot flag',()=>{const r=new Reconciler(),q=new PatchQueue();r.merge(Array.from({length:5100},(_,i)=>bar(bar().t+i*60000)));expect(r.bars.size).toBe(MAX_BARS);for(const c of r.snapshot())q.add(c);expect(q.overflow).toBe(true);expect(q.drain().length).toBeLessThanOrEqual(512);});
  it('coalesces every affected timestamp and keeps full rollover',()=>{const q=new PatchQueue(),t=bar().t;for(let n=0;n<1000;n++)q.add(bar(t+(n%3)*60000,83000+n/1000,n,n));const patch=q.drain();expect(patch).toHaveLength(3);expect(patch.map(b=>b.v)).toEqual([999,997,998]);});
  it('rejects malformed OHLC',()=>{const r=new Reconciler();r.merge([{...bar(),h:82000},{...bar(),v:NaN}]);expect(r.bars.size).toBe(0);});
});
describe('owned model',()=>{
  it('round trips index/price at large timestamp and price precision',()=>{const s=new CandleStore();s.patch([bar()]);expect(s.time[0]).toBe(1791558000000);expect(s.close[0]).toBe(83000.01);const v=new Viewport();v.resize(900,500);v.latest(1);v.autoscale(s);expect(v.index(v.x(.23))).toBeCloseTo(.23,10);expect(v.price(v.y(83000.01))).toBeCloseTo(83000.01,10);});
  it('cursor anchored zoom and bounded zoom out',()=>{const v=new Viewport();v.resize(900,500);v.latest(1000);const i=v.index(342);v.zoom(342,1.5);expect(v.index(342)).toBeCloseTo(i,10);v.zoom(342,.00001);expect(v.spacing).toBe(3);});
  it('visible range autoscale excludes distant prices; flat/empty finite',()=>{const s=new CandleStore();s.patch([bar(),{...bar(bar().t+60000),o:90000,h:90000,l:90000,c:90000}]);const v=new Viewport();v.resize(200,300);v.right=0;v.autoscale(s);expect(v.max).toBeLessThan(84000);v.right=2;v.autoscale(s);expect(v.max).toBeGreaterThan(v.min);s.length=0;v.autoscale(s);expect(Number.isFinite(v.y(.5))).toBe(true);});
  it('known body/wick geometry; doji minimum; bounded sorted typed storage',()=>{const s=new CandleStore();s.patch([{t:1000,o:10,h:13,l:8,c:12,v:1,revision:0,closed:false}]);const v=new Viewport();v.plot={x:0,y:0,width:100,height:100};v.min=0;v.max=20;v.right=0;v.spacing=10;expect(candleGeometry(s,v,0)).toEqual([99.5,35,1,25,1,97,40,6,10,1]);s.patch([{...s.at(0),c:10}]);expect(candleGeometry(s,v,0)[8]).toBe(1);s.reset(Array.from({length:5100},(_,i)=>bar(1000+i*60000)));expect(s.length).toBe(5000);expect(s.time[0]).toBe(6001000);});
});
describe('wire identity and storage',()=>{
  it('venue and interval identity enforced; cumulative volume normalized once',()=>{const wire={e:'kline',E:5,k:{s:'BTCUSDT',i:'1m',t:1791558000000,o:'83000',h:'83001',l:'82999',c:'83000.1',v:'12',x:false}};expect(parseLive(wire,{venue:'binance',interval:'1m'})[0].v).toBe(12);expect(parseLive(wire,{venue:'binance',interval:'5m'})).toEqual([]);expect(hyperCandle({s:'ETH',i:'1m'}, {venue:'hyperliquid',interval:'1m'})).toBeNull();});
  it('corrupt/unknown/oversized layouts recover',()=>{expect(restoreValue('{bad')).toBeNull();expect(restoreValue(JSON.stringify({version:99}))).toBeNull();expect(restoreValue(JSON.stringify({version:1,layout:{grid:{},panels:{'chart-x':{contentComponent:'ai',params:{venue:'binance',interval:'1m'}}}}}))).toBeNull();});
});

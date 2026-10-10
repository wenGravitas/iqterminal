import { describe,it,expect } from 'vitest';
import { Reconciler,PatchQueue,MAX_BARS } from '../src/feed/reconcile';
import { parseLive,hyperCandle } from '../src/feed/adapters';
import { restoreValue } from '../src/layout';
import { formatPrice } from '../src/chart/format';
import { type Candle } from '../src/feed/protocol';
const bar=(t=1791558000000,c=83000.01,v=10,revision=0):Candle=>({t,o:83000,h:83001,l:82999,c,v,revision,closed:false});
describe('candle reconciliation',()=>{
  it('live wins history overlap; snapshots idempotent; volume replaces',()=>{const r=new Reconciler();r.merge([bar(undefined,83000.3,12,10)]);r.merge([bar()]);expect(r.snapshot()[0].c).toBe(83000.3);r.merge([bar(undefined,83000.4,14,11)]);r.merge([bar(undefined,83000.4,14,11)]);expect(r.snapshot()).toHaveLength(1);expect(r.snapshot()[0].v).toBe(14);});
  it('rollover and late data remain sorted unique; older revisions rejected',()=>{const r=new Reconciler();const t=bar().t;r.merge([bar(t+60000),bar(t),bar(t-60000)]);r.merge([bar(t,83000.5,5,20),bar(t,83000.1,3,10)]);expect(r.snapshot().map(b=>b.t)).toEqual([t-60000,t,t+60000]);expect(r.snapshot()[1].c).toBe(83000.5);});
  it('bounds cache and recovers patch queue overflow with snapshot flag',()=>{const r=new Reconciler(),q=new PatchQueue();r.merge(Array.from({length:5100},(_,i)=>bar(bar().t+i*60000)));expect(r.bars.size).toBe(MAX_BARS);for(const c of r.snapshot())q.add(c);expect(q.overflow).toBe(true);expect(q.drain().length).toBeLessThanOrEqual(512);});
  it('coalesces every affected timestamp and keeps full rollover',()=>{const q=new PatchQueue(),t=bar().t;for(let n=0;n<1000;n++)q.add(bar(t+(n%3)*60000,83000+n/1000,n,n));const patch=q.drain();expect(patch).toHaveLength(3);expect(patch.map(b=>b.v)).toEqual([999,997,998]);});
  it('rejects malformed OHLC',()=>{const r=new Reconciler();r.merge([{...bar(),h:82000},{...bar(),v:NaN}]);expect(r.bars.size).toBe(0);});
});
describe('wire identity and storage',()=>{
  it('venue and interval identity enforced; cumulative volume normalized once',()=>{const wire={e:'kline',E:5,k:{s:'BTCUSDT',i:'1m',t:1791558000000,o:'83000',h:'83001',l:'82999',c:'83000.1',v:'12',x:false}};expect(parseLive(wire,{venue:'binance',interval:'1m'})[0].v).toBe(12);expect(parseLive(wire,{venue:'binance',interval:'5m'})).toEqual([]);expect(hyperCandle({s:'ETH',i:'1m'}, {venue:'hyperliquid',interval:'1m'})).toBeNull();});
  it('corrupt/unknown/oversized layouts recover',()=>{expect(restoreValue('{bad')).toBeNull();expect(restoreValue(JSON.stringify({version:99}))).toBeNull();expect(restoreValue(JSON.stringify({version:1,layout:{grid:{},panels:{'chart-x':{contentComponent:'ai',params:{venue:'binance',interval:'1m'}}}}}))).toBeNull();});
  it('restores a persisted USD-M Footprint chart while legacy candle layouts remain valid',()=>{
    const layout={grid:{},panels:{'chart-footprint':{contentComponent:'candle',params:{venue:'binance',market:'perpetual',interval:'1m',type:'footprint',rowTicks:20,footprint:{displayMode:'delta',cellStyle:'heatmap',showPoc:false,stackedImbalances:true,imbalanceRatio:4,imbalanceThreshold:0.02}}}}} as any;
    expect(restoreValue(JSON.stringify({version:2,layout}))).toEqual(layout);
    const legacy={...layout,panels:{'chart-footprint':{...layout.panels['chart-footprint'],params:{venue:'binance',interval:'1m',type:'candle'}}}};
    expect(restoreValue(JSON.stringify({version:1,layout:legacy}))).toEqual(legacy);
  });
});
describe('chart price formatting',()=>{
  it('matches Intl exactly for repeated, negative zero, nonfinite, and cache-evicted values',()=>{
    const oracle=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
    const initial=[-0,0,83000.25,-1.25,NaN,Infinity,-Infinity];
    for(const value of initial)expect(formatPrice(value)).toBe(oracle.format(value));
    for(let value=0;value<700;value++)expect(formatPrice(value+0.125)).toBe(oracle.format(value+0.125));
    for(const value of initial)expect(formatPrice(value)).toBe(oracle.format(value));
    expect(formatPrice(83000.25)).toBe(oracle.format(83000.25));
  });
});

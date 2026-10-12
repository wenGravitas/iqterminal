import { expect, it } from 'vitest';
import { histogramScale, histogramWidth } from '../src/ticker/histogram';
import { tickerConfig, TickerTape, type ClassifiedTrade } from '../src/ticker/model';
const now=1791745000000;
function record(quantity:number,side:'buy'|'sell'|'unknown'='buy',timeMs=now,price=100000):ClassifiedTrade{return {execution:{venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',executionId:String(quantity)+side+timeMs,granularity:'aggregate-trade',timeMs,eventTimeMs:timeMs,quantity,price,side},receivedAt:timeMs,tier:null,notify:false};}
it('shares a linear scale across buy/sell, independent of minimum, side and tier scope',()=>{
  const c=tickerConfig({displayMinimum:1e9,side:'buy',scope:[]}),rows=[record(20),record(10,'sell'),record(2)];
  const scale=histogramScale(rows,c,now);expect(scale).toMatchObject({maximum:2e6,count:3,buy:2.2e6,sell:1e6});
  expect(histogramWidth(rows[0],scale.maximum,c)).toBe(45);expect(histogramWidth(rows[1],scale.maximum,c)).toBe(22.5);
});
it('uses exchange timestamps, expires the window, excludes unselected and unknown prints',()=>{
  const c=tickerConfig({histogramSeconds:60});const boundary=record(2,'buy',now-60000);
  const other={...record(100),execution:{...record(100).execution,venue:'hyperliquid' as const}};
  expect(histogramScale([boundary,record(100,'sell',now-60001),record(999,'unknown'),record(99,'buy',now+1),other],c,now)).toMatchObject({count:1,maximum:200000});
  expect(histogramScale([boundary],c,now+1).maximum).toBe(0);
  expect(histogramWidth(record(1,'unknown'),2,c)).toBe(0);expect(histogramWidth(record(1),0,c)).toBe(0);
});
it('uses BTC or actual USDT notional, bounds widths and respects off',()=>{
  const c=tickerConfig({displayUnit:'BTC'}),r=record(4,'sell',now,200000);
  expect(histogramScale([r],c,now).maximum).toBe(4);expect(histogramScale([r],{...c,displayUnit:'USDT'},now).maximum).toBe(800000);
  expect(histogramWidth(r,2,c)).toBe(45);expect(histogramWidth(r,4,{...c,histogram:false})).toBe(0);
});
it('freezes reference history AND clock while paused, then resumes bounded live history',()=>{
  const tape=new TickerTape(),c=tickerConfig({});tape.ingest([record(2)]);tape.pause(now);
  tape.ingest([record(20,'sell',now+10000)]);const frozen=tape.snapshot(now+70000);
  expect(histogramScale(frozen.records,c,frozen.now).maximum).toBe(200000);expect(frozen.records.length).toBe(1);
  tape.live();const live=tape.snapshot(now+10000);expect(histogramScale(live.records,c,live.now).maximum).toBe(2e6);
  tape.ingest(Array.from({length:600},()=>record(1)));expect(tape.snapshot().records.length).toBe(500);
});
it('defaults old layouts safely and preserves off/zero opacity through persistence',()=>{
  expect(tickerConfig({})).toMatchObject({histogram:true,histogramSeconds:60,histogramOpacity:.18});
  expect(tickerConfig({histogramSeconds:1000,histogramOpacity:4})).toMatchObject({histogramSeconds:300,histogramOpacity:.6});
  expect(tickerConfig({histogramSeconds:0,histogramOpacity:NaN})).toMatchObject({histogramSeconds:5,histogramOpacity:.18});
  const c=tickerConfig({histogram:false,histogramSeconds:30,histogramOpacity:0});expect(tickerConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
});

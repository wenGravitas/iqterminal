import { expect, it } from 'vitest';
import { footprintForUnits } from '../src/chart/footprint-units';
import { FootprintAccumulator, type AggTradeObservation } from '../src/feed/footprint';
import { config } from '../src/panel';

it('stores exact execution notional and projects units without changing canonical bars or price OHLC',()=>{
  const book=new FootprintAccumulator('1m',.1,250);
  const trade=(id:number,price:number,quantity:number,side:'buy'|'sell'):AggTradeObservation=>({
    venue:'binance',market:'perpetual',nativeSymbol:'BTCUSDT',granularity:'aggregate-trade',id,executionId:`agg:${id}`,
    firstTradeId:id,lastTradeId:id,timeMs:1800000001000+id,eventTimeMs:1800000001000+id,price,quantity,side});
  book.ingest(trade(1,83002.1,.001,'sell'));book.ingest(trade(2,83008.2,.002,'buy'));
  const raw=book.latest!,saved=structuredClone(raw),quote=footprintForUnits(raw,'usdt')!;
  expect(footprintForUnits(raw,'btc')).toBe(raw);
  expect(quote.cells).toHaveLength(1);
  expect(quote.cells[0].bidVol).toBeCloseTo(83.0021,10);
  expect(quote.cells[0].askVol).toBeCloseTo(166.0164,10);
  expect(quote.cells[0].bidVol).not.toBe(raw.cells[0].price*raw.cells[0].bidVol);
  expect(quote.delta).toBeCloseTo(83.0143,10);
  expect(quote.minDelta).toBeCloseTo(-83.0021,10);
  expect(quote.maxDelta).toBeCloseTo(83.0143,10);
  expect(quote).toMatchObject({open:raw.open,high:raw.high,low:raw.low,close:raw.close,time:raw.time,rowSize:25,revision:2});
  expect(raw).toEqual(saved);
  expect(footprintForUnits({...raw,cells:[{price:83000,bidVol:.001,askVol:.002}]},'usdt')).toBeNull();
});
it('migrates and validates per-panel units independently of timeframe and price width',()=>{
  expect(config({}).footprintUnits).toBe('btc');
  expect(config({footprintUnits:'invented'}).footprintUnits).toBe('btc');
  expect(config({footprintUnits:'usdt',rowPrice:25}).footprintUnits).toBe('usdt');
});

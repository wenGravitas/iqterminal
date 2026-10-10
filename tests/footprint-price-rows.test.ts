import { expect, it } from 'vitest';
import { FootprintAccumulator, type AggTradeObservation } from '../src/feed/footprint';

const timeMs = 1_800_000_001_000;
const execution = (id: number, price: number, side: 'buy' | 'sell'): AggTradeObservation => ({
  venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT',
  granularity: 'aggregate-trade', executionId: `binance:perpetual:BTCUSDT:agg:${id}`,
  id, firstTradeId: id, lastTradeId: id, timeMs: timeMs + id,
  eventTimeMs: timeMs + id, price, quantity: 0.001, side,
});

it('groups real execution quantities into 25 and 50 USDT rows without changing OHLC or totals', () => {
  const trades = [execution(1, 83_002.1, 'sell'), execution(2, 83_008.2, 'buy'), execution(3, 83_023.3, 'buy')];
  const narrow = new FootprintAccumulator('1m', 0.1, 250);
  const wide = new FootprintAccumulator('1m', 0.1, 500);
  for (const trade of trades) {
    expect(narrow.ingest(trade)).toBe('applied');
    expect(wide.ingest(trade)).toBe('applied');
  }
  expect(narrow.latest?.cells.map(({ price, bidVol, askVol }) => ({ price, bidVol, askVol }))).toEqual([
    { price: 83_025, bidVol: 0, askVol: 0.001 },
    { price: 83_000, bidVol: 0.001, askVol: 0.001 },
  ]);
  expect(wide.latest?.cells.map(({ price, bidVol, askVol }) => ({ price, bidVol, askVol }))).toEqual([{ price: 83_000, bidVol: 0.001, askVol: 0.002 }]);
  for (const bar of [narrow.latest, wide.latest]) {
    expect(bar).toMatchObject({ open: 83_002.1, high: 83_023.3, low: 83_002.1, close: 83_023.3,
      delta: 0.001, minDelta: -0.001, maxDelta: 0.001, aggregateRecordCount: 3 });
    expect(bar!.cells.reduce((sum, cell) => sum + cell.bidVol + cell.askVol, 0)).toBeCloseTo(0.003, 12);
  }
  expect(narrow.latest?.rowSize).toBe(25);
  expect(wide.latest?.rowSize).toBe(50);
});

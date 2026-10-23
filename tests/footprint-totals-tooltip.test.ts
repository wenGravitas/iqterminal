import { expect, it } from 'vitest';
import { otherFootprintTotals } from '../src/footprint-totals-tooltip';
import type { FootprintBar } from '../src/feed/protocol';
const bar = (time: number, bid: number, ask: number, price: number): FootprintBar => ({ time, rowSize: 25, revision: 1,
  cells: [{ price: 100, bidVol: bid, askVol: ask, bidNotional: bid * price, askNotional: ask * price }],
  open: price, high: price, low: price, close: price, delta: ask - bid, minDelta: Math.min(0, ask - bid), maxDelta: Math.max(0, ask - bid),
  quoteDelta: (ask - bid) * price, minQuoteDelta: Math.min(0, ask - bid) * price, maxQuoteDelta: Math.max(0, ask - bid) * price, coverage: 'observed', gapBefore: false, source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade', aggregateRecordCount: 1 });
it('shows exact execution notionals and cumulative delta over the same displayed candles without mutation', () => {
  const bars = [bar(60, 2, 1, 110), bar(120, 1, 3, 125), bar(180, 8, 1, 90)], saved = structuredClone(bars);
  expect(otherFootprintTotals(bars, [60, 120, 180], 120, 'usdt')).toMatchObject({ volume: 500, bidVolume: 125, askVolume: 375, delta: 250, minDelta: 0, maxDelta: 250, cvd: 140 });
  expect(otherFootprintTotals(bars, [120, 180], 120, 'btc')).toMatchObject({ volume: 4, delta: 2, cvd: 2 });
  expect(bars).toEqual(saved);
});
it('keeps missing notional unavailable, including an incomplete cumulative counterpart', () => {
  const first = { ...bar(60, 2, 1, 110), quoteDelta: undefined }, last = bar(120, 1, 3, 125);
  expect(otherFootprintTotals([first, last], [60, 120], 60, 'usdt')).toEqual({});
  expect(otherFootprintTotals([first, last], [60, 120], 120, 'usdt')).toMatchObject({ volume: 500, cvd: null });
});

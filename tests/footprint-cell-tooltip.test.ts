import { describe, expect, it } from 'vitest';
import type { FootprintHover } from 'openalgo-charts/profile';
import type { FootprintBar } from '../src/feed/protocol';
import { footprintCellTooltipData } from '../src/footprint-cell-tooltip';

const rawBar: FootprintBar = {
  time: 1_798_704_000,
  revision: 4,
  cells: [
    { price: 67_000, bidVol: 0.2, askVol: 0.3, bidNotional: 13_401.25, askNotional: 20_103.5 },
    { price: 67_001, bidVol: 0.1, askVol: 0.05, bidNotional: 6_701.4, askNotional: 3_350.6 },
  ],
  delta: 0.05,
  minDelta: -0.2,
  maxDelta: 0.3,
  quoteDelta: 6_702.25,
  minQuoteDelta: -13_401.25,
  maxQuoteDelta: 20_103.5,
  rowSize: 1,
  source: 'binance-usdm-aggtrade',
  granularity: 'aggregate-trade',
  coverage: 'observed',
  gapBefore: true,
  open: 67_000,
  high: 67_002,
  low: 67_000,
  close: 67_001,
  aggregateRecordCount: 9,
};

const hover = (price: number | null, time = rawBar.time): FootprintHover => ({
  time,
  price,
  // The chart primitive may expose unit-projected values. These are deliberately
  // different from the source values so the test catches using hover.cell as data.
  cell: price === null ? null : { price, bidVol: 999, askVol: 888 },
  stats: { time, volume: 1.5, bidVolume: 1, askVolume: 0.5, delta: -0.5, minDelta: -1, maxDelta: 0, deltaPct: -33, cvd: 4, trades: 9, poc: 67_000, vah: 67_002, val: 67_000 },
});

describe('footprint cell tooltip data', () => {
  it('uses actual per-cell quote notionals for USDT while retaining observed BTC amounts', () => {
    const data = footprintCellTooltipData(rawBar, hover(67_000), 'usdt', { interval: '1m', timezone: 'UTC' });

    expect(data).toMatchObject({
      priceLow: 67_000, priceHigh: 67_001, units: 'usdt',
      bid: { value: 13_401.25, otherValue: 0.2 },
      ask: { value: 20_103.5, otherValue: 0.3 },
      total: 33_504.75, delta: 6_702.25,
      coverage: 'observed', gapBefore: true,
    });
    expect(data?.stamp).toContain('UTC');
  });

  it('uses BTC volume as primary and actual notionals as secondary in BTC mode', () => {
    const data = footprintCellTooltipData(rawBar, hover(67_000), 'btc', { interval: '5m', timezone: 'UTC' });

    expect(data).toMatchObject({
      interval: '5m', units: 'btc',
      bid: { value: 0.2, otherValue: 13_401.25 },
      ask: { value: 0.3, otherValue: 20_103.5 },
      total: 0.5,
    });
    expect(data?.delta).toBeCloseTo(0.1);
  });

  it('keeps unavailable quote amounts unavailable instead of estimating from candle close', () => {
    const incomplete = { ...rawBar, cells: [{ price: 67_000, bidVol: 0.2, askVol: 0.3 }] };
    const data = footprintCellTooltipData(incomplete, hover(67_000), 'usdt', { interval: '1m', timezone: 'UTC', quoteUnavailableHint: 'select BTC' });

    expect(data).toMatchObject({
      bid: { value: null, otherValue: 0.2 },
      ask: { value: null, otherValue: 0.3 },
      total: null, delta: null, quoteUnavailableHint: 'select BTC',
    });
  });

  it('only accepts a painted cell whose raw bar time and lower-bound price match', () => {
    expect(footprintCellTooltipData(rawBar, hover(null), 'btc', { interval: '1m', timezone: 'UTC' })).toBeNull();
    expect(footprintCellTooltipData(rawBar, hover(67_000, rawBar.time + 60), 'btc', { interval: '1m', timezone: 'UTC' })).toBeNull();
    expect(footprintCellTooltipData(rawBar, hover(67_002), 'btc', { interval: '1m', timezone: 'UTC' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_WALLS_SETTINGS,
  OrderWallDetector,
  orderWallMarket,
  orderWallValueAt,
  orderWallValuePointAt,
  resolveAutoOrderWallPriceWidth,
  orderWallsSettings,
  type OrderWallDepthRecord,
  type OrderWallsSettings,
} from '../src/feed/order-walls';

const base = 1_800_000_000_000;
const settings = (patch: Partial<OrderWallsSettings> = {}) => orderWallsSettings({
  ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const,
  aggregation: 'auto',
  ...patch,
  enabled: true,
});
const record = (kind: OrderWallDepthRecord['kind'], at: number, cursor: number,
  patch: Partial<OrderWallDepthRecord> = {}): OrderWallDepthRecord => ({
  kind, at, cursor, epoch: 1, bids: [], asks: [], ...patch,
});
const level = (price: number, usd: number): readonly [number, number] => [price, usd / price];

describe('Order Walls settings and market identity', () => {
  it('normalizes bounded defaults and preserves distinct Binance Spot and USD-M identities', () => {
    expect(orderWallsSettings({ relativePercentile: 101, opacity: -1, aggregation: 37 })).toMatchObject({
      relativePercentile: 95, opacity: 0.85, aggregation: 'auto', showHistory: true, thicknessPx: 2,
    });
    expect(orderWallMarket({ venue: 'binance', market: 'spot' })).toBe('binance-spot');
    expect(orderWallMarket({ venue: 'binance', market: 'perpetual' })).toBe('binance-perp');
    expect(orderWallMarket({ venue: 'hyperliquid', market: 'perpetual' })).toBe('hyperliquid');
  });
});

describe('Order Wall detector', () => {
  it('resolves Auto from visible price span while respecting venue tick size', () => {
    const zoomed = resolveAutoOrderWallPriceWidth(49_999, 50_001, 300, 0.1);
    const wide = resolveAutoOrderWallPriceWidth(49_000, 51_000, 300, 0.1);
    expect(zoomed).toBe(0.1);
    expect(wide).toBe(100);
    const detector = new OrderWallDetector(settings({ aggregation: 'auto' }), 0.1, wide);
    expect(detector.priceWidth()).toBe(wide);
    expect(detector.status(base, base + 1).resolvedPriceWidth).toBe(wide);
  });

  it('stores historical percentile changes even when wall notional is unchanged', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100 }), 1);
    const start = detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 500), level(200, 1_000)] })]);
    const id = start[0]!.id;
    expect(start[0]!.segment!.valueRuns[0]).toMatchObject({ usd: 500, percentile: 50 });
    const rankChange = detector.processBatch([record('delta', base + 100, 2, { bids: [[200, 0]] })]);
    expect(rankChange[0]!.id).toBe(id);
    expect(rankChange[0]!.valuePoints).toEqual([{ at: base + 100, usd: 500, percentile: 100 }]);
    const active = rankChange[0]!.segment!;
    expect(orderWallValuePointAt(active, base + 50)).toMatchObject({ usd: 500, percentile: 50 });
    expect(orderWallValuePointAt(active, base + 150)).toMatchObject({ usd: 500, percentile: 100 });
  });

  it('uses exact quote notional after price aggregation and explicit zero removals', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 500, aggregation: 10 }), 0.1);
    const seed = detector.processBatch([record('snapshot', base, 1, {
      bids: [level(100.1, 200.2), level(109.9, 329.7)], bookScope: { bidComplete: true, askComplete: true },
    })]);
    expect(seed).toHaveLength(1);
    expect(seed[0]!.segment).toMatchObject({ side: 'bid', price: 100, start: base, peakUsd: 529.9 });

    const close = detector.processBatch([record('delta', base + 100, 2, { bids: [[109.9, 0]] })]);
    expect(close[0]!.segment).toMatchObject({ end: base + 100, durationMs: 100, meanUsd: 529.9 });
    expect(detector.snapshot()).toHaveLength(1);
  });

  it('includes out-of-viewport levels in the whole-book relative percentile', () => {
    const detector = new OrderWallDetector(settings({ method: 'relative', relativeFloorUsd: 1,
      relativePercentile: 95, aggregation: 'auto' }), 1);
    const visible = Array.from({ length: 19 }, (_, i) => level(1_000 + i, 100));
    visible.push(level(1_020, 250));
    const before = detector.processBatch([record('snapshot', base, 1, { bids: visible,
      bookScope: { bidComplete: true, askComplete: true } })]);
    expect(before.map(p => p.segment?.price)).toContain(1_020);

    // These remote levels are outside any hypothetical viewport, but belong to
    // the observed book and move its p95 cutoff from $100 to $300.
    const after = detector.processBatch([record('delta', base + 100, 2, {
      bids: [level(2_000, 300), level(2_010, 400)],
    })]);
    expect(after.find(p => p.segment?.price === 1_020)?.segment).toMatchObject({ end: base + 100 });
    expect(detector.snapshot().some(s => s.price === 1_020 && s.end === null)).toBe(false);
  });

  it('applies all same-millisecond changes before deciding whether a wall exists', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 500 }), 0.1);
    detector.processBatch([record('snapshot', base, 1, { bids: [level(50_000, 100)] })]);
    const patches = detector.processBatch([
      record('delta', base + 100, 2, { bids: [level(50_000, 600)] }),
      record('delta', base + 100, 3, { bids: [[50_000, 0]] }),
    ]);
    expect(patches).toEqual([]);
    expect(detector.snapshot()).toEqual([]);
  });

  it('uses exit hysteresis and censors active segments at the last confirmed time on a gap', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100, exitRatio: 0.85 }), 1);
    detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 120)] })]);
    expect(detector.processBatch([record('delta', base + 100, 2, { bids: [level(100, 90)] })])[0]!.segment).toMatchObject({ end: null, durationMs: 100 });
    const close = detector.processBatch([record('delta', base + 200, 3, { bids: [level(100, 84)] })]);
    expect(close[0]!.segment).toMatchObject({ start: base, end: base + 200, durationMs: 200 });

    detector.processBatch([record('snapshot', base + 300, 4, { bids: [level(100, 120)] })]);
    const gap = detector.processBatch([record('gap', base + 10_000, 5, { reason: 'stream stale' })]);
    expect(gap[0]!.segment).toMatchObject({ start: base + 300, end: base + 300, durationMs: 0,
      endKnown: false, endReason: 'censored', censoredReason: 'stream stale' });
    expect(detector.status(base, base + 10_000).state).toBe('gap');
    expect(detector.processBatch([record('delta', base + 10_100, 6, { bids: [level(100, 200)] })])).toEqual([]);
  });

  it('reconciles same-epoch periodic checkpoints without fragmenting a wall across candle boundaries', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100 }), 1);
    const start = base + 59_900;
    const initial = detector.processBatch([record('snapshot', start, 1, { bids: [level(100, 150)],
      bookScope: { bidComplete: true, askComplete: true } })]);
    const id = initial[0]!.id;
    expect(initial[0]!.segment).toMatchObject({ start, startKnown: false, end: null });

    detector.processBatch([record('delta', base + 60_100, 2, { bids: [level(100, 175)] })]);
    const checkpoint = detector.processBatch([record('checkpoint', base + 120_000, 3, {
      bids: [level(100, 175)], bookScope: { bidComplete: true, askComplete: true },
    })]);
    expect(checkpoint).toHaveLength(1);
    expect(checkpoint[0]!.id).toBe(id);
    expect(checkpoint[0]!.segment).toMatchObject({ id, start, end: null });

    const later = detector.processBatch([record('delta', base + 180_000, 4, { bids: [level(100, 200)] })]);
    expect(later).toHaveLength(1);
    expect(later[0]!.id).toBe(id);
    expect(detector.snapshot().filter(segment => segment.side === 'bid' && segment.price === 100)).toHaveLength(1);

    const closed = detector.processBatch([record('delta', base + 240_000, 5, { bids: [[100, 0]] })]);
    expect(closed[0]!.id).toBe(id);
    expect(closed[0]!.segment).toMatchObject({ start, end: base + 240_000, endKnown: true,
      endReason: 'removed', durationMs: base + 240_000 - start });
  });

  it('ignores duplicate cursor pages and resumes only from a replacement snapshot', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100 }), 1);
    detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 150)] })]);
    detector.processBatch([record('gap', base + 100, 2)]);
    expect(detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 150)] })])).toEqual([]);
    const resumed = detector.processBatch([record('snapshot', base + 200, 3, { bids: [level(100, 150)] })]);
    expect(resumed[0]!.segment).toMatchObject({ start: base + 200, end: null });
  });

  it('keeps durable cursor order when receive timestamps regress and clamps duration explicitly', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100 }), 1);
    detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 120)] })]);
    const result = detector.processBatch([
      record('delta', base + 200, 2, { bids: [level(100, 150)] }),
      record('delta', base + 100, 3, { bids: [[100, 0]] }),
    ]);
    expect(result[0]!.segment).toMatchObject({ end: base + 200, endKnown: true, endReason: 'removed' });
    expect(detector.snapshot()).toHaveLength(1);
    expect(detector.status(base, base + 200)).toMatchObject({ clockRegressed: true,
      coverage: { partial: true, complete: false } });
  });

  it('returns the piecewise constant notional at a historical cursor time', () => {
    const detector = new OrderWallDetector(settings({ method: 'absolute', thresholdUsd: 100 }), 1);
    detector.processBatch([record('snapshot', base, 1, { bids: [level(100, 1_000_000)] })]);
    detector.processBatch([record('delta', base + 100, 2, { bids: [level(100, 3_000_000)] })]);
    const closed = detector.processBatch([record('delta', base + 200, 3, { bids: [[100, 0]] })])[0]!.segment!;
    expect(closed.valueRunsTruncated).toBe(false);
    expect(orderWallValueAt(closed, base + 50)).toBe(1_000_000);
    expect(orderWallValueAt(closed, base + 150)).toBe(3_000_000);
    expect(orderWallValueAt(closed, base + 200)).toBe(0);
    expect(orderWallValueAt(closed, base + 201)).toBeNull();
  });
});

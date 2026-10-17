import { describe, expect, it } from 'vitest';
import type { PrimitiveRenderContext } from 'openalgo-charts';
import { DEFAULT_ORDER_WALLS_SETTINGS, resolveAutoOrderWallPriceWidth, type OrderWallSegment } from '../src/feed/order-walls';
import { OrderWallsPrimitive } from '../src/chart/order-walls';

const base = 1_704_067_200_000;

function context({ from = 0, to = 2, xPerIndex = 100, dpr = 2 }: { from?: number; to?: number; xPerIndex?: number; dpr?: number } = {}): PrimitiveRenderContext {
  const timeScale = {
    visibleRange: () => ({ from, to }),
    indexToX: (index: number) => 50 + (index - from) * xPerIndex,
    xToIndex: (x: number) => from + (x - 50) / xPerIndex,
  };
  const priceScale = {
    priceRange: () => ({ min: 90, max: 120 }),
    priceToY: () => 100,
  };
  const dataLayer = {
    length: 3, baseIndex: 2,
    indexToTime: (index: number) => base / 1000 + index * 60,
    indexToTimeFloat: (index: number) => base / 1000 + index * 60,
    timeToIndexFloat: (seconds: number) => (seconds - base / 1000) / 60,
  };
  return { timeScale, priceScale, dataLayer, plotWidth: 500, plotHeight: 300, dpr } as unknown as PrimitiveRenderContext;
}

interface CapturedPath { color: string; points: Array<[number, number]> }
function canvas(styles: string[] = [], paths: CapturedPath[] = []): CanvasRenderingContext2D {
  let points: Array<[number, number]> = [];
  const value: Record<string, any> = { save() {}, beginPath() { points = []; }, rect() {}, clip() {}, setLineDash() {},
    moveTo(x: number, y: number) { points.push([x, y]); }, lineTo(x: number, y: number) { points.push([x, y]); },
    stroke() { styles.push(value.strokeStyle); paths.push({ color: value.strokeStyle, points: [...points] }); }, restore() {} };
  return value as unknown as CanvasRenderingContext2D;
}

describe('Order Walls chart hit testing', () => {
  it('maps CSS pointer x to the same event time at DPR 2 used by projected geometry', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 99,
      scopePartial: false, startKnown: true, valueRuns: [], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000 });
    const paths: CapturedPath[] = [];
    primitive.draw(canvas([], paths), context());

    // x=150 CSS px is logical index 1. Multiplying it by DPR would select 2.5.
    const hit = primitive.orderWallAt(150, 100);
    expect(hit?.at).toBe(base + 60_000);
    expect(paths).toEqual([{ color: '#37c4d2', points: [[100, 200], [500, 200]] }]);
  });

  it('keeps each historical wall span in the colour of its contemporaneous percentile', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 50 },
        { at: base + 60_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000, resolvedPriceWidth: 50 });
    const styles: string[] = [];
    primitive.draw(canvas(styles), context());

    expect(styles).toEqual(['#37c4d2', '#ff884d']);
    expect(primitive.orderWallAt(100, 100)).toMatchObject({ at: base + 30_000, percentile: 50, priceHigh: 150 });
    expect(primitive.orderWallAt(200, 100)).toMatchObject({ at: base + 90_000, percentile: 100, priceHigh: 150 });
  });

  it('coalesces contiguous same-colour runs while retaining per-run time hover and subpixel union', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall-runs', epoch: 1, side: 'bid', price: 100, start: base, end: base + 300,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 300, percentile: 99,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98.1 },
        { at: base + 100, usd: 10_000, percentile: 98.5 },
        { at: base + 200, usd: 10_000, percentile: 98.9 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 300 });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());

    // The three minimum-one-pixel spans overlap in CSS space, but share one
    // source interval chain and style. The path is their union, not a darkened
    // stack of three alpha strokes.
    expect(styles).toEqual(['#37c4d2']);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.color).toBe('#37c4d2');
    expect(paths[0]?.points[0]).toEqual([100, 200]);
    expect(paths[0]?.points[1]?.[0]).toBeCloseTo(102.6667, 3);
    expect(paths[0]?.points[1]?.[1]).toBe(200);
    expect(primitive.orderWallAt(50.2, 100)).toMatchObject({ at: base + 120, percentile: 98.5 });
  });

  it('keeps mixed percentile color boundaries as separate strokes', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall-color-groups', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98.1 },
        { at: base + 20_000, usd: 10_000, percentile: 98.5 },
        { at: base + 40_000, usd: 10_000, percentile: 99.1 },
        { at: base + 60_000, usd: 10_000, percentile: 99.8 },
        { at: base + 80_000, usd: 10_000, percentile: 99.95 },
        { at: base + 100_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000 });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());

    expect(styles).toEqual(['#37c4d2', '#f1cb59', '#ff884d']);
    expect(paths.map(path => path.points.map(point => point.map(value => Number(value.toFixed(3)))))).toEqual([
      [[100, 200], [233.333, 200]],
      [[233.333, 200], [366.667, 200]],
      [[366.667, 200], [500, 200]],
    ]);
  });

  it('keeps separate wall episodes apart across time gaps even with the same color', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment = (id: string, start: number): OrderWallSegment => ({
      id, epoch: 1, side: 'bid', price: 100, start, end: start + 60_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 60_000, percentile: 98.5,
      scopePartial: false, startKnown: true,
      valueRuns: [{ at: start, usd: 10_000, percentile: 98.5 }], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    });
    primitive.setSnapshot([segment('first-episode', base), segment('later-episode', base + 180_000)], {
      state: 'live', lastConfirmedAt: base + 240_000,
    });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context({ to: 5 }));

    expect(styles).toEqual(['#37c4d2', '#37c4d2']);
    expect(paths).toEqual([
      { color: '#37c4d2', points: [[100, 200], [300, 200]] },
      { color: '#37c4d2', points: [[700, 200], [900, 200]] },
    ]);
  });

  it('coalesces bid/ask runs per episode without changing side colors or zoomed hover time', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, colorMode: 'bid-ask' }, 60_000);
    const segment = (id: string, side: 'bid' | 'ask'): OrderWallSegment => ({
      id, epoch: 1, side, price: 100, start: base, end: base + 60_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 60_000, percentile: 98,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98 },
        { at: base + 30_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    });
    primitive.setSnapshot([segment('bid-episode', 'bid'), segment('ask-episode', 'ask')], {
      state: 'live', lastConfirmedAt: base + 60_000,
    });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());
    expect(styles).toEqual(['#2ebc79', '#ed5964']);
    expect(paths).toHaveLength(2);

    const zoomPaths: CapturedPath[] = [];
    primitive.draw(canvas([], zoomPaths), context({ to: 1, xPerIndex: 200, dpr: 2 }));
    expect(zoomPaths[0]?.points).toEqual([[100, 200], [500, 200]]);
    expect(primitive.orderWallAt(150, 100)?.at).toBe(base + 30_000);
  });

  it('keeps Auto selected while zoom changes the shared detector and chart band width', () => {
    const settings = { ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, aggregation: 'auto' as const };
    const primitive = new OrderWallsPrimitive(settings, 60_000);
    const segment: OrderWallSegment = {
      id: 'auto-wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [{ at: base, usd: 10_000, percentile: 100 }], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], {
      state: 'live', tickSize: 0.1,
      resolvedPriceWidth: resolveAutoOrderWallPriceWidth(49_999, 50_001, 300, 0.1),
      lastConfirmedAt: base + 120_000,
    });
    primitive.draw(canvas(), context());
    expect(primitive.orderWallAt(100, 100)?.priceHigh).toBeCloseTo(100.1);

    primitive.setStatus({
      state: 'live', tickSize: 0.1,
      resolvedPriceWidth: resolveAutoOrderWallPriceWidth(49_000, 51_000, 300, 0.1),
      lastConfirmedAt: base + 120_000,
    });
    primitive.draw(canvas(), context());
    expect(settings.aggregation).toBe('auto');
    expect(primitive.orderWallAt(100, 100)?.priceHigh).toBe(200);
  });
});

import { describe, expect, it } from 'vitest';
import { PriceScale, TimeScale, type PrimitiveRenderContext } from 'openalgo-charts';
import { AxisGrid, axisGridGeometry } from '../src/chart/axis-grid';
import { config } from '../src/panel';

function context(times = Array.from({ length: 120 }, (_, i) => 1704067200 + i * 60)) {
  const timeScale = new TimeScale({ barSpacing: 20 }); timeScale.setWidth(500); timeScale.setBaseIndex(times.length - 1);
  const priceScale = new PriceScale(); priceScale.setHeight(320); priceScale.setPriceRange({ min: 100, max: 200 });
  return { timeScale, priceScale, plotWidth: 500, plotHeight: 320, dpr: 1,
    dataLayer: { baseIndex: times.length - 1, indexToTime: (i: number) => times[i] } } as unknown as PrimitiveRenderContext;
}

describe('axis-bound chart grid', () => {
  it('uses actual price ticks and candle indexes, and follows pan and both zoom axes', () => {
    const rc = context(); rc.timeScale.setVisibleLogicalRange({ from: 90.25, to: 115.25 });
    const before = axisGridGeometry(rc, () => 40);
    expect(before.price.length).toBeGreaterThan(0); expect(before.time.length).toBeGreaterThan(0);
    for (const tick of before.price) expect(tick.coordinate).toBeCloseTo(rc.priceScale.priceToY(tick.value), 0);
    for (const tick of before.time) expect(tick.coordinate).toBeCloseTo(rc.timeScale.indexToX(tick.value), 0);
    rc.timeScale.scrollByPixels(2);
    const panned = axisGridGeometry(rc, () => 40);
    const common = before.time.find(t => panned.time.some(p => p.value === t.value))!;
    expect(panned.time.find(t => t.value === common.value)!.coordinate - common.coordinate).toBeCloseTo(2);
    rc.timeScale.zoomAtX(250, 2); rc.priceScale.setPriceRange({ min: 125, max: 175 });
    const zoomed = axisGridGeometry(rc, () => 40);
    expect(zoomed).not.toEqual(panned);
    expect(zoomed.price.every(t => t.value >= 125 && t.value <= 175)).toBe(true);
  });
  it('handles empty data, irregular footprint times, midnight and label collisions without future bars', () => {
    expect(axisGridGeometry(context([]), () => 40).time).toEqual([]);
    const rc = context([1704067140, 1704067200, 1704067500, 1704067560]);
    rc.timeScale.setBarSpacing(110); rc.timeScale.setRightOffset(0);
    const lines = axisGridGeometry(rc, () => 100).time;
    expect(lines.some(t => t.value === 1)).toBe(true);
    expect(lines.every(t => t.value >= 0 && t.value <= 3)).toBe(true);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.coordinate - lines[i - 1]!.coordinate).toBeGreaterThanOrEqual(104);
  });
  it('defaults legacy or corrupt layouts to grid on and preserves explicit off across chart types', () => {
    for (const grid of [undefined, null, 'false', 0, {}]) expect(config({ grid }).grid).toBe(true);
    for (const type of ['candle', 'footprint']) expect(config({ type, grid: false }).grid).toBe(false);
  });
  it('requests scheduled redraws, clears geometry when disabled and releases its host on disposal', () => {
    const grid = new AxisGrid(); let requests = 0; grid.attached({ requestUpdate: () => requests++ });
    grid.geometry = { price: [{ value: 1, coordinate: 2 }], time: [] }; grid.setEnabled(false);
    expect(grid.geometry).toEqual({ price: [], time: [] }); expect(requests).toBe(1);
    grid.detached(); grid.setEnabled(true); expect(requests).toBe(1);
  });
});

it('defaults old layouts to TradingView wheel mode and preserves explicit legacy choice', () => {
  expect(config({}).wheelMode).toBe('tradingview');
  expect(config({ wheelMode: 'unknown' }).wheelMode).toBe('tradingview');
  expect(config({ wheelMode: 'both-axes' }).wheelMode).toBe('both-axes');
  expect(config(config({ wheelMode: 'both-axes' })).wheelMode).toBe('both-axes');
});

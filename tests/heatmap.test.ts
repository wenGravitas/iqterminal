import { describe, it, expect } from 'vitest';
import { BinanceDepthBook } from '../src/feed/depth-book';
import { LiquidityCollector, groupBook, HEATMAP_LIMITS, HEATMAP_STRIDE, heatmapSettings, heatmapKey, validResolution, type ReadonlyDepthView } from '../src/feed/heatmap-model';
import { heatmapBins, timestampToLogical, intensityIndex, OrderBookHeatmap } from '../src/chart/orderbook-heatmap';
import { config } from '../src/panel';

const state = (bid = 20, ask = 5): ReadonlyDepthView => ({ snapshotBidBoundary: 90, snapshotAskBoundary: 120,
  visitLevels: cb => { cb('bid', 100, bid); cb('ask', 110, ask); } });
function cell(collector: LiquidityCollector, price = 100) { const b = collector.snapshot()[0]!; const index = Array.from(b.cells).findIndex((v, i) => i % HEATMAP_STRIDE === 0 && v === price); return { b, values: Array.from(b.cells.slice(index, index + HEATMAP_STRIDE)) }; }
const bins = (c: LiquidityCollector, options = heatmapSettings(null), pricePixel = 1) => heatmapBins(c.snapshot(), options, 60000, t => t === 0 ? 0 : undefined, i => (i + .5) * 600, p => 200 - p * pricePixel, 600, 300);

describe('resting liquidity tiles', () => {
  it('duration-weights irregular absolute replacements and never adds repeated wall quantity', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1);
    c.transition(state(), 0, 1); c.transition(state(), 100, 1); c.transition(state(40), 400, 1); c.advance(500);
    const v = cell(c).values;
    expect(v[1]! / 500).toBe(24); expect(v[3]).toBe(40); expect(v[5]).toBe(500);
    expect(bins(c).find(b => b.low === 100)?.bid).toBe(24);
  });
  it('captures instantaneous peaks at identical observation timestamps without adding duration', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1);
    c.transition(state(50), 0, 1); c.transition(state(20), 0, 1); c.advance(500);
    expect(cell(c).values[3]).toBe(50); expect(cell(c).values[1]! / 500).toBe(20);
  });
  it('combines simultaneous price quantities, duration-weighted time and true observed coarse peaks', () => {
    const s = (a: number, b: number): ReadonlyDepthView => ({ snapshotBidBoundary: 0.1, snapshotAskBoundary: 8,
      visitLevels: cb => { cb('bid', 2, a); cb('bid', 3, b); } });
    const c = new LiquidityCollector({ rowPrice: 1, bucketMs: 500 }, .1);
    c.transition(s(20, 0), 0, 1); c.transition(s(0, 20), 250, 1); c.advance(500);
    const out = heatmapBins(c.snapshot(), heatmapSettings({ mode: 'peak' }), 60000, () => 0, i => (i + .5) * 7, p => 100 - p, 100, 150);
    expect(out.find(b => b.low === 0)?.bid).toBe(20); // Summing row peaks would falsely show 40.
    const average = out.find(b => b.low === 0)!;
    expect(average.high).toBe(4);
    expect(intensityIndex(2, 10, 10)).toBe(intensityIndex(4, 20, 10));
  });
  it('retains partial snapshot-edge rows, known-empty interior rows, and unknown outside rows', () => {
    const book: ReadonlyDepthView = { snapshotBidBoundary: 95, snapshotAskBoundary: 115, visitLevels: cb => { cb('bid', 96, 2); cb('bid', 80, 900); cb('ask', 114, 3); } };
    const { rows } = groupBook(book, 10, 1);
    expect(rows.map(r => r.rowLow)).toEqual([90, 100, 110]);
    expect(rows[0]).toMatchObject({ bid: 2, bidComplete: false, bidObserved: true });
    expect(rows[1]).toMatchObject({ bid: 0, ask: 0, bidComplete: true, askComplete: true });
    expect(rows[2]).toMatchObject({ ask: 3, askComplete: false });
    expect(() => groupBook(book, 1.25, .1)).toThrow(/multiple/);
  });
  it('keeps raw outage gaps and marks a merged candle column incomplete', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1);
    c.transition(state(), 100, 1); c.transition(null, 200, 2); c.transition(state(40), 400, 3); c.advance(500);
    expect(new Set(c.snapshot().map(b => b.epoch))).toEqual(new Set([1, 3]));
    expect(c.snapshot().every(b => b.end <= 200 || b.start >= 400)).toBe(true);
    const row = bins(c).find(b => b.low === 100)!;
    expect(row).toMatchObject({ bid: 30, observedDuration: 200, incomplete: true, partial: true, x: 0, right: 600 });
    expect(bins(c, heatmapSettings({ mode: 'peak' })).find(b => b.low === 100)?.bid).toBe(40);
    const long = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1);
    long.transition(state(), 0, 1); long.advance(60000); expect(long.snapshot().at(-1)!.end).toBe(5000);
    long.advance(61000); expect(long.snapshot().at(-1)!.end).toBe(5000);
  });
  it('matches fixed lower-bound footprint rows, boundary assignments and simultaneous coarse peaks', () => {
    const book: ReadonlyDepthView = { snapshotBidBoundary: 80, snapshotAskBoundary: 140,
      visitLevels: cb => { cb('bid', 87.4, 1); cb('bid', 87.5, 2); cb('bid', 100, 3); cb('ask', 112.4, 4); cb('ask', 112.5, 5); } };
    const rows = groupBook(book, 25, .1).rows;
    expect(rows.find(r => r.rowLow === 100)).toMatchObject({ bid: 3, ask: 9 });
    expect(rows.find(r => r.rowLow === 75)).toMatchObject({ bid: 3, bidComplete: false });
    expect(rows.find(r => r.rowLow === 100)).toMatchObject({ ask: 9 });
    const c = new LiquidityCollector({ rowPrice: 25, bucketMs: 500, rowAlignment: 'footprint' }, .1);
    c.transition(book, 0, 1); c.advance(500);
    const tile = c.snapshot()[0]!; expect(tile.priceOffset).toBe(0);
    const rendered = heatmapBins(c.snapshot(), { ...heatmapSettings(null), rowAlignment: 'footprint', rowPrice: 25 }, 60000,
      () => 0, i => (i+.5)*100, p => 200-p*.1, 600, 300);
    // Footprint mode keeps its price grid even when rows are too short for labels.
    expect(rendered.find(r => r.low === 100)).toMatchObject({ high: 125, bid: 3, ask: 9 });
    expect(rendered.find(r => r.low === 100)!.bottom-rendered.find(r => r.low === 100)!.y).toBeCloseTo(2.5);
    expect(heatmapKey(c.resolution)).toBe('25:500');
    expect(heatmapKey({ rowPrice: 25, bucketMs: 500 })).toBe('25:500');
    expect(validResolution({ rowPrice: 25, bucketMs: 500, rowAlignment: 'invalid' } as any)).toBe(false);
    const peaks = Array.from(tile.peaks); const offset = peaks.findIndex((v, i) => i%4 === 0 && v === 2 && peaks[i+1] === 100);
    expect(peaks.slice(offset+2, offset+4)).toEqual([3, 9]);
  });
  it('bounds allocation, evicts oldest buckets and records capacity-limited grids', () => {
    const c = new LiquidityCollector({ rowPrice: .1, bucketMs: 250 }, .1);
    c.transition(state(), 0, 1);
    for (let i = 1; i <= 1000; i++) c.advance(i * 250);
    expect(c.diagnostics().bytes).toBeLessThanOrEqual(HEATMAP_LIMITS.bytes);
    expect(c.cellCount).toBeLessThanOrEqual(HEATMAP_LIMITS.cells);
    expect(c.snapshot().length).toBeLessThanOrEqual(HEATMAP_LIMITS.buckets);
    expect(c.evictions).toBeGreaterThan(0); expect(c.snapshot()[0]!.capacityLimited).toBe(true);
    expect(c.changes().length).toBeLessThanOrEqual(HEATMAP_LIMITS.buckets);
  });
  it('follows snapshot/diff replacement and zero deletion; ignores obsolete overlaps', () => {
    const book = new BinanceDepthBook(); book.push({ U: 100, u: 101, pu: 99, b: [], a: [] }, 0);
    expect(book.applySnapshot({ lastUpdateId: 100, bids: [[90, 1], [100, 20]], asks: [[110, 5], [120, 1]] }, 0)).toBe(true);
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(book, 0, 1);
    expect(book.push({ U: 102, u: 103, pu: 101, b: [[100, 0]], a: [[110, 10]] }, 250)).toBe('applied');
    c.transition(book, 250, 1); c.advance(500);
    expect(cell(c).values[1]! / 500).toBe(10);
    expect(cell(c, 110).values[2]! / 500).toBe(7.5);
    expect(book.push({ U: 100, u: 101, pu: 99, b: [[100, 999]], a: [] }, 300)).toBe('invalid');
    expect(book.lastUpdateId).toBe(103);
  });
});
describe('heatmap chart boundary', () => {
  it('fits quantity-only labels and aligns footprint ladder bounds including its candle gutter', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(state(), 0, 1); c.advance(500);
    const p = new OrderBookHeatmap(60000); p.update(c.snapshot(), true, 0);
    p.setFootprintLayout({ widthFactor: .96, showCandle: true });
    const labels: { text: string; font: string }[] = [];
    const context = { font: '', save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
      fillText(text: string) { labels.push({ text, font: this.font }); }, moveTo() {}, lineTo() {}, stroke() {} };
    const rc = { dpr: 1, plotWidth: 600, plotHeight: 300,
      timeScale: { barSpacing: 100, visibleRange: () => ({ from: 0, to: 2 }), indexToX: (i: number) => (i+.5)*100 },
      priceScale: { priceRange: () => ({ min: 80, max: 120 }), priceToY: (v: number) => 600-v*5 },
      dataLayer: { timeToIndex: () => 0, indexToTime: () => 0 } };
    p.draw(context as any, rc as any);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) { expect(label.text).toMatch(/^\d+\.\d{2}$/); expect(parseFloat(label.font)).toBeGreaterThan(10); }
    expect(p.hoverAt(10, 95)).toBeNull(); expect(p.hoverAt(11, 95)?.side).toBe('bid');
    expect(p.hoverAt(97, 95)?.side).toBe('bid'); expect(p.hoverAt(98, 95)).toBeNull();
    p.setFootprintLayout(); p.draw(context as any, rc as any); expect(p.hoverAt(1, 95)?.side).toBe('bid');
  });
  it('maps every observation in a candle to its fixed logical centre', () => {
    const index = (s: number) => new Map([[0, 0], [60, 1], [180, 2]]).get(s);
    expect(timestampToLogical(30000, 60000, index)).toBe(0);
    expect(timestampToLogical(90000, 60000, index)).toBe(1);
    expect(timestampToLogical(120000, 60000, index)).toBeNull();
    expect(timestampToLogical(180000, 60000, index)).toBe(2);
    expect(timestampToLogical(190000, 300000, s => s === 0 ? 0 : undefined)).toBe(0);
  });
  it('keeps LOD readouts separate across missing host time keys', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(state(), 0, 1); c.advance(500);
    const base = c.snapshot()[0]!;
    const buckets = Array.from({ length: 360 }, (_, i) => ({ ...base, id: String(i), start: i * 500, end: (i + 1) * 500 }));
    // Even compressed neighbouring columns must not bridge an unmapped interval.
    const out = heatmapBins(buckets, heatmapSettings(null), 60000, t => new Map([[0, 0], [120, 1]]).get(t), i => (i+.5)*2, p => 200-p, 100, 300);
    expect(out.filter(b => b.low === 100).map(b => [b.start, b.end])).toEqual([[0, 60000], [120000, 180000]]);
  });

  it('updates one full candle column in place and opens a new column only at UTC boundaries', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1);
    const project = () => heatmapBins(c.snapshot(), heatmapSettings(null), 60000,
      t => t / 60, i => (i + .5) * 100, p => 200 - p, 600, 300).filter(b => b.low === 100);
    c.transition(state(20), 59000, 1); c.advance(59100);
    expect(project()).toHaveLength(1);
    expect(project()[0]).toMatchObject({ x: 0, right: 100, bid: 20, start: 59000, end: 59100 });
    c.transition(state(40), 59500, 1); c.advance(60000);
    expect(project()).toHaveLength(1);
    expect(project()[0]).toMatchObject({ x: 0, right: 100, bid: 30, observedDuration: 1000, partial: true });
    c.advance(60500);
    expect(project().map(b => [b.x, b.right, b.bid])).toEqual([[0, 100, 30], [100, 200, 40]]);
    const fiveMinute = heatmapBins(c.snapshot(), heatmapSettings(null), 300000,
      () => 0, i => (i + .5) * 100, p => 200-p, 600, 300).filter(b => b.low === 100);
    expect(fiveMinute).toHaveLength(1); expect(fiveMinute[0]!.bid).toBeCloseTo(100/3);
  });

  it('reuses retained price projections across navigation and invalidates revised quantities', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(state(), 0, 1); c.advance(100);
    const primitive = new OrderBookHeatmap(60000); primitive.update(c.snapshot(), true, 0);
    let pan = 0;
    const rc = { dpr: 1, plotWidth: 600, plotHeight: 300,
      timeScale: { visibleRange: () => ({ from: pan, to: pan + 2 }), indexToX: (i: number) => (i+.5)*600-pan },
      priceScale: { priceRange: () => ({ min: 80, max: 120 }), priceToY: (p: number) => 200-p },
      dataLayer: { timeToIndex: (t: number) => t === 0 ? 0 : undefined, indexToTime: () => 0 } };
    const context = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, fillText() {}, moveTo() {}, lineTo() {}, stroke() {} };
    primitive.draw(context as any, rc as any); const builds = primitive.diagnostics().priceCacheBuilds;
    pan = 1; primitive.draw(context as any, rc as any); expect(primitive.diagnostics().priceCacheBuilds).toBe(builds);
    c.transition(state(30), 250, 1); c.advance(500); primitive.update(c.changes(), false, 0); primitive.draw(context as any, rc as any);
    expect(primitive.diagnostics().priceCacheBuilds).toBeGreaterThan(builds);
    expect(primitive.hoverAt(1, 95)?.bin.bid).toBe(25);
    primitive.detached(); expect(primitive.diagnostics().cachedPriceTiles).toBe(0);
  });

  it('fills the whole row when only one side passes the quantity filter', () => {
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(state(), 0, 1); c.advance(500);
    const p = new OrderBookHeatmap(60000); p.update(c.snapshot(), true, 0);
    const fills: number[][] = [];
    const context = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(...args: number[]) { fills.push(args); }, fillText() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const rc = { dpr: 1, plotWidth: 600, plotHeight: 300,
      timeScale: { visibleRange: () => ({ from: 0, to: 2 }), indexToX: (i: number) => (i+.5)*100 },
      priceScale: { priceRange: () => ({ min: 80, max: 120 }), priceToY: (v: number) => 200-v },
      dataLayer: { timeToIndex: () => 0, indexToTime: () => 0 } };
    p.draw(context as any, rc as any);
    expect(fills).toContainEqual([0, 90, 100, 10]);
    expect(p.hoverAt(50, 91)?.side).toBe('bid'); expect(p.hoverAt(50, 99)?.side).toBe('bid');
  });

  it('validates settings, migrates absent layouts and clears caches on detach', () => {
    expect(config({ venue: 'binance', interval: '1m' }).heatmap).toMatchObject({ enabled: false, rowPrice: 10, bucketMs: 500 });
    const opts = heatmapSettings({ enabled: true, rowPrice: Infinity, opacity: 99, mode: 'unsafe', bucketMs: 250 });
    expect(opts).toMatchObject({ enabled: true, rowPrice: 10, opacity: .45, mode: 'average', bucketMs: 250 });
    const c = new LiquidityCollector({ rowPrice: 10, bucketMs: 500 }, 1); c.transition(state(), 0, 1); c.advance(500);
    const primitive = new OrderBookHeatmap(60000); primitive.update(c.snapshot(), true, 0);
    expect(primitive.stats.bytes).toBeGreaterThan(0); primitive.detached(); expect(primitive.stats.bytes).toBe(0); expect(primitive.autoscaleInfo()).toBeNull();
  });
});

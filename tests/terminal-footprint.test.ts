import { expect, test } from 'vitest';
import { DEFAULT_FOOTPRINT_OPTIONS } from 'openalgo-charts/profile';
import { TerminalFootprint } from '../src/chart/terminal-footprint';
import { config } from '../src/panel';

test('installed footprint draws larger fitted text and translucent cells without fading text or footer', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, widthFactor: .96, pocStyle: 'outline', statsPosition: 'bottom', statsRows: ['volume', 'delta'] });
  p.setBars([{ time: 0, delta: 32710, rowSize: 25, open: 100, high: 110, low: 100, close: 110, cells: [{ price: 112.5, bidVol: 3990, askVol: 36700 }] }]);
  const outlines: { width: number; color: string }[] = [];
  const fills: number[] = [], labels: { alpha: number; font: string }[] = [];
  const canvas: any = { globalAlpha: 1, font: '', measureText(text: string) { return { width: text.length * parseFloat(this.font.replace('600 ', '')) * .6 }; },
    strokeRect() { outlines.push({ width: this.lineWidth, color: this.strokeStyle }); },
    fill() { fills.push(this.globalAlpha); }, fillText() { labels.push({ alpha: this.globalAlpha, font: this.font }); } };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  let spacing = 200, dpr = 1;
  const rc: any = { get dpr() { return dpr; }, plotWidth: 600, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { get barSpacing() { return spacing; }, visibleRange: () => ({ from: 0, to: 2 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 75, max: 150 }), priceToY: (v: number) => 600 - v*4 },
    dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(fills).toEqual([.85, .85]);
  expect(outlines).toContainEqual({ width: 1, color: '#ffffff' });
  expect(p.cellFont).toBe(24);
  expect(labels.some(l => l.font.startsWith('600 24px'))).toBe(true);
  expect(labels.every(l => l.alpha === 1)).toBe(true);
  expect(labels.some(l => l.font.startsWith('8.5px'))).toBe(true);
  spacing = 80; p.setCellOpacity(.3); fills.length = 0; p.draw(ctx, rc);
  expect(p.cellFont).toBeLessThan(24); expect(fills).toEqual([.3, .3]);
  dpr = 2; labels.length = 0; p.draw(ctx, rc);
  expect(labels.some(l => l.font.startsWith(`600 ${p.cellFont*2}px`))).toBe(true);
});

test('footprint opacity migrates and validates independently of heatmap opacity', () => {
  expect(config({}).footprint.opacity).toBe(.85);
  expect(config({ footprint: { opacity: NaN } }).footprint.opacity).toBe(.85);
  expect(config({ footprint: { opacity: 2 }, heatmap: { opacity: .3 } })).toMatchObject({ footprint: { opacity: 1 }, heatmap: { opacity: .3 } });
});

test('bid and ask cells leave a central execution-candle gutter with matching hover', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, cellStyle: 'ladder', widthFactor: .84, showCandle: true, showPoc: false, showValueArea: true, valueAreaColor: '#858585', statsRows: [] });
  p.setBars([{ time: 0, rowSize: 25, open: 100, high: 120, low: 100, close: 110, delta: 1, cells: [{ price: 112.5, bidVol: 2, askVol: 3 }] }]);
  const cells: number[][] = [], candles: number[][] = [], dashes: number[][] = [], lines: number[][] = [];
  const target: any = { globalAlpha: 1, font: '', measureText: () => ({ width: 10 }), roundRect: (...args: number[]) => cells.push(args), fillRect: (...args: number[]) => candles.push(args), setLineDash: (dash: number[]) => dashes.push(dash), moveTo: (...args: number[]) => lines.push(args), lineTo: (...args: number[]) => lines.push(args) };
  const ctx = new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {} });
  const rc: any = { dpr: 1, plotWidth: 600, plotHeight: 400, theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 200, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 75, max: 150 }), priceToY: (v: number) => 600-v*4 }, dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(cells).toHaveLength(2);
  expect(cells[0][0] + cells[0][2]).toBeLessThan(140);
  expect(cells[1][0]).toBeGreaterThan(160);
  expect(candles).toHaveLength(2);
  expect(candles[1][0] + candles[1][2]/2).toBe(150);
  expect(candles[1][2]).toBe(8);
  expect(p.hoverAt(80, 150)?.cell?.bidVol).toBe(2);
  expect(p.hoverAt(220, 150)?.cell?.askVol).toBe(3);
  expect(p.hoverAt(150, 150)).toBeNull();
  expect(p.options().showCandle).toBe(true);
  expect(dashes).toContainEqual([1, 3]);
  expect(lines).toHaveLength(4);
  [[66, 100], [234, 100], [66, 200], [234, 200]].forEach((point, i) => point.forEach((v, j) => expect(lines[i][j]).toBeCloseTo(v)));
  expect(cells[0][0]).toBeCloseTo(66); expect(cells[1][0] + cells[1][2]).toBeCloseTo(234);
  p.setOptions({ showValueArea: false }); lines.length = 0; p.draw(ctx, rc); expect(lines).toEqual([]);
  p.detached(); expect(p.hoverAt(80, 150)).toBeNull();
});

test('small footprint panes retain visible price space above compact statistics', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, statsPosition: 'bottom', statsRows: ['volume', 'bidVolume', 'askVolume', 'delta'] });
  p.setBars([]);
  const rc: any = { dpr: 1, plotHeight: 70, timeScale: { barSpacing: 80 }, priceScale: { priceRange: () => ({ min: 0, max: 100 }), priceToY: (p: number) => 70-p }, dataLayer: { timeToIndex: () => undefined } };
  p.draw({} as any, rc);
  expect(p.options().statsRowHeight).toBe(8);
  expect(70 - 4*p.options().statsRowHeight).toBeGreaterThan(35);
});

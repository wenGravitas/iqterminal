import { afterAll, expect, test } from 'vitest';
import { DEFAULT_FOOTPRINT_OPTIONS } from 'openalgo-charts/profile';
import { TerminalFootprint } from '../src/chart/terminal-footprint';
import { config } from '../src/panel';

class RecordedPath2D {
  commands: { kind: 'moveTo' | 'lineTo'; x: number; y: number }[] = [];
  moveTo(x: number, y: number) { this.commands.push({ kind: 'moveTo', x, y }); }
  lineTo(x: number, y: number) { this.commands.push({ kind: 'lineTo', x, y }); }
}
const nativePath2D = globalThis.Path2D;
Object.defineProperty(globalThis, 'Path2D', { configurable: true, writable: true, value: RecordedPath2D });
afterAll(() => {
  if (nativePath2D) Object.defineProperty(globalThis, 'Path2D', { configurable: true, writable: true, value: nativePath2D });
  else delete (globalThis as any).Path2D;
});

function expectPocMarkers(path: RecordedPath2D) {
  const commands = path.commands;
  expect(commands).toHaveLength(4);
  expect(commands.map(({ kind }) => kind)).toEqual(['moveTo', 'lineTo', 'moveTo', 'lineTo']);
  const left = commands[0]!.x, right = commands[2]!.x, top = commands[0]!.y, bottom = commands[1]!.y;
  expect(commands[1]).toMatchObject({ x: left, y: bottom });
  expect(commands[2]).toMatchObject({ y: top });
  expect(commands[3]).toMatchObject({ x: right, y: bottom });
  expect(bottom).toBeGreaterThan(top);
  expect(right).toBeGreaterThan(left);
}

test('installed footprint draws larger fitted text and translucent cells without fading text or footer', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, widthFactor: .96, pocStyle: 'outline', statsPosition: 'bottom', statsRows: ['volume', 'delta'] });
  p.setBars([{ time: 0, delta: 32710, rowSize: 25, open: 100, high: 110, low: 100, close: 110, cells: [{ price: 112.5, bidVol: 3990, askVol: 36700 }] }]);
  const outlines: { width: number; color: string }[] = [];
  const fills: number[] = [], labels: { alpha: number; font: string; x: number; y: number; color: string }[] = [];
  const canvas: any = { globalAlpha: 1, font: '', measureText(text: string) { return { width: text.length * parseFloat(this.font.replace('600 ', '')) * .6 }; },
    save() {}, restore() {}, setLineDash() {}, stroke(path?: RecordedPath2D) { if (path) outlines.push({ width: this.lineWidth, color: this.strokeStyle }); },
    fill() { fills.push(this.globalAlpha); }, fillText(_text: string, x: number, y: number) { labels.push({ alpha: this.globalAlpha, font: this.font, x, y, color: this.fillStyle }); } };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  let spacing = 200, dpr = 1;
  const rc: any = { get dpr() { return dpr; }, plotWidth: 600, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { get barSpacing() { return spacing; }, visibleRange: () => ({ from: 0, to: 2 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 75, max: 150 }), priceToY: (v: number) => 600 - v*4 },
    dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(fills).toEqual([.85, .85]);
  expect(outlines).toContainEqual({ width: 2, color: '#6d3fa0' });
  expect(p.cellFont).toBe(24);
  expect(labels.some(l => l.font.startsWith('600 24px'))).toBe(true);
  expect(labels.every(l => l.alpha === 1)).toBe(true);
  expect(labels.filter(l => l.font.startsWith('600 ')).every(l => Number.isInteger(l.x) && Number.isInteger(l.y))).toBe(true);
  expect(labels.filter(l => l.font.startsWith('600 ')).every(l => !l.color.startsWith('rgba('))).toBe(true);
  expect(labels.some(l => l.font.startsWith('8.5px'))).toBe(true);
  spacing = 80; p.setCellOpacity(.3); fills.length = 0; p.draw(ctx, rc);
  expect(p.cellFont).toBeGreaterThanOrEqual(9); expect(p.cellFont).toBeLessThan(24); expect(fills).toEqual([.3, .3]);
  spacing = 200; dpr = 2; labels.length = 0; p.draw(ctx, rc);
  expect(labels.some(l => l.font.startsWith(`600 ${p.cellFont*2}px`)), `cellFont=${p.cellFont}; styleFont=${p.options().font}; fonts=${labels.map(l => l.font).join('|')}`).toBe(true);
});

for (const theme of [
  { name: 'dark', background: '#090909' },
  { name: 'light', background: '#f6f4ee' },
]) for (const opacity of [0, .3, .85, 1]) {
  test(`quantity text stays readable over red and green footprint fills in ${theme.name} theme at ${opacity} opacity`, () => {
    const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, widthFactor: .9,
      displayMode: 'bidask', cellStyle: 'ladder', textColorMode: 'side',
      textColor: '#777777', buyColor: '#58a65c', buyTextColor: '#58a65c', sellColor: '#ad5858', sellTextColor: '#ad5858',
      showCandle: false, showPoc: false, showValueArea: false, statsRows: [], tableRows: [] });
    p.setCellOpacity(opacity);
    p.setBars([{ time: 0, rowSize: 25, delta: 0, cells: [
      { price: 112.5, bidVol: 52.2, askVol: 31.5 },
      { price: 87.5, bidVol: 108, askVol: 5.9 },
      { price: 62.5, bidVol: 86.6, askVol: 39.4 },
      { price: 37.5, bidVol: 62.3, askVol: 22.8 },
      { price: 12.5, bidVol: 3.7, askVol: 1.14 },
      { price: -12.5, bidVol: .734, askVol: 0 },
    ] }]);

    let pathRect: number[] | null = null;
    const paints: { rect: number[]; color: string; alpha: number; kind: string }[] = [];
    const labels: { text: string; color: string; background: string; backgroundAlpha: number; alpha: number }[] = [];
    const canvas: any = { globalAlpha: 1, font: '', fillStyle: '', textAlign: 'center',
      measureText(text: string) { return { width: text.length * 6 }; },
      roundRect(...args: number[]) { pathRect = args.slice(0, 4); },
      fill() { if (pathRect) paints.push({ rect: pathRect, color: this.fillStyle, alpha: this.globalAlpha, kind: 'roundRect' }); pathRect = null; },
      fillRect(...args: number[]) { paints.push({ rect: args.slice(0, 4), color: this.fillStyle, alpha: this.globalAlpha, kind: 'fillRect' }); },
      fillText(text: string, x: number, y: number) {
        const width = this.measureText(text).width, left = x - width / 2, centreX = left + width / 2;
        const bg = [...paints].reverse().find(({ rect }) => centreX >= rect[0]! && centreX <= rect[0]! + rect[2]!
          && y >= rect[1]! && y <= rect[1]! + rect[3]!);
        if (bg) labels.push({ text, color: this.fillStyle, background: bg.color, backgroundAlpha: bg.alpha, alpha: this.globalAlpha });
      },
    };
    const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
    const rc: any = { dpr: 1, plotWidth: 600, plotHeight: 400,
      theme: { background: theme.background, axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
      timeScale: { barSpacing: 160, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
      priceScale: { priceRange: () => ({ min: -25, max: 125 }), priceToY: (value: number) => 400 - (value + 25) * 400 / 150 },
      dataLayer: { timeToIndex: () => 0 } };
    p.draw(ctx, rc);

    expect(labels.map(label => label.text)).toEqual(['52.2', '31.5', '108', '5.9', '86.6', '39.4', '62.3', '22.8', '3.7', '1.14', '0.734', '0']);
    const cellFills = paints.filter(paint => paint.kind === 'roundRect');
    expect(cellFills).toHaveLength(12);
    expect(cellFills.every(paint => paint.alpha === opacity)).toBe(true);
    for (const label of labels) {
      const foreground = testRgb(label.color), cell = testRgb(label.background), base = testRgb(theme.background);
      const background = compositeForTest(cell, base, cell.a * label.backgroundAlpha);
      expect(testContrast(foreground, background), `${label.text}: ${label.color} over ${label.background} at ${opacity}`).toBeGreaterThanOrEqual(4.5);
      expect(label.alpha).toBe(1);
    }
  });
}

test('native value area draws distinct readable VAH and VAL boundaries beside the POC and faded cells', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, widthFactor: .9,
    displayMode: 'bidask', cellStyle: 'ladder', showCandle: true, showPoc: true, pocStyle: 'outline', showValueArea: true,
    valueAreaColor: '#ffffff', statsRows: [], tableRows: [] });
  p.setCellOpacity(.3);
  const cells = Array.from({ length: 18 }, (_, index) => {
    const volume = 3 + (9 - Math.abs(index - 8)) * 5;
    const bidVol = Math.floor(volume * .6);
    return { price: 450 - index * 25, bidVol, askVol: volume - bidVol };
  });
  p.setBars([{ time: 0, rowSize: 25, delta: 0, open: 250, high: 325, low: 225, close: 275, cells }]);

  let path: [number, number][] = [];
  const valueAreaStrokes: { color: string; alpha: number; width: number; dash: number[]; points: [number, number][] }[] = [];
  const pocOutlines: { color: string; alpha: number; width: number; dash: number[]; path: RecordedPath2D }[] = [];
  const cellFillAlphas: number[] = [], candleFillAlphas: number[] = [], textAlphas: number[] = [];
  const canvas: any = { globalAlpha: 1, fillStyle: '', strokeStyle: '#fff', lineWidth: 1, dash: [] as number[], font: '',
    measureText(text: string) { return { width: text.length * 6 }; },
    save() {}, restore() {}, beginPath() { path = []; }, rect() {}, clip() {}, closePath() {},
    moveTo(x: number, y: number) { path.push([x, y]); }, lineTo(x: number, y: number) { path.push([x, y]); },
    setLineDash(values: number[]) { this.dash = [...values]; },
    stroke(marker?: RecordedPath2D) {
      if (marker) pocOutlines.push({ color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, dash: [...this.dash], path: marker });
      else valueAreaStrokes.push({ color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, dash: [...this.dash], points: [...path] });
    },
    roundRect() {}, fill() { cellFillAlphas.push(this.globalAlpha); },
    fillRect() { candleFillAlphas.push(this.globalAlpha); }, fillText() { textAlphas.push(this.globalAlpha); },
  };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  const rc: any = { dpr: 1, plotWidth: 600, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 160, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 0, max: 500 }), priceToY: (value: number) => 400 - value * .8 },
    dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);

  const stats = p.stats()[0]!;
  expect(stats.vah).not.toBe(stats.val);
  expect(valueAreaStrokes).toHaveLength(1);
  expect(valueAreaStrokes[0]!.points).toHaveLength(4);
  const points = valueAreaStrokes[0]!.points;
  expect(points[0]![1]).toBe(points[1]![1]);
  expect(points[2]![1]).toBe(points[3]![1]);
  const actualYs = [points[0]![1], points[2]![1]].sort((a, b) => a - b);
  const align = (value: number) => Math.round(value) + .5;
  const expectedYs = [align(400 - (stats.vah + 12.5) * .8), align(400 - (stats.val - 12.5) * .8)].sort((a, b) => a - b);
  expect(actualYs).toEqual(expectedYs);
  expect(valueAreaStrokes[0]).toMatchObject({ color: '#6d3fa0', alpha: 1, width: 2, dash: [3, 2] });
  expect(pocOutlines).toHaveLength(1);
  expect(pocOutlines[0]).toMatchObject({ color: '#6d3fa0', alpha: 1, width: 2, dash: [3, 2] });
  expectPocMarkers(pocOutlines[0]!.path);
  expect(pocOutlines[0]!.path.commands[0]!.x).toBe(points[0]![0]);
  expect(pocOutlines[0]!.path.commands[2]!.x).toBe(points[1]![0]);
  expect(cellFillAlphas.length).toBeGreaterThan(0);
  expect(cellFillAlphas.every(alpha => alpha === .3)).toBe(true);
  expect(candleFillAlphas.length).toBe(2);
  expect(candleFillAlphas.every(alpha => alpha === 1)).toBe(true);
  expect(textAlphas.length).toBeGreaterThan(0);
  expect(textAlphas.every(alpha => alpha === 1)).toBe(true);

  p.setOptions({ showValueArea: false }); valueAreaStrokes.length = 0; pocOutlines.length = 0; p.draw(ctx, rc);
  expect(valueAreaStrokes).toHaveLength(0); expect(pocOutlines).toHaveLength(1);
  p.setOptions({ showValueArea: true, showPoc: false }); valueAreaStrokes.length = 0; pocOutlines.length = 0; p.draw(ctx, rc);
  expect(valueAreaStrokes).toHaveLength(1); expect(pocOutlines).toHaveLength(0);
});

function testRgb(value: string) {
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex) return { r: parseInt(hex[1]!.slice(0, 2), 16), g: parseInt(hex[1]!.slice(2, 4), 16), b: parseInt(hex[1]!.slice(4, 6), 16), a: 1 };
  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!match) throw new Error(`Unsupported test color ${value}`);
  const [r, g, b, alpha = 1] = match[1]!.split(/[\s,/]+/).map(Number);
  return { r: r!, g: g!, b: b!, a: alpha! };
}

function compositeForTest(foreground: ReturnType<typeof testRgb>, background: ReturnType<typeof testRgb>, alpha: number) {
  return { r: foreground.r * alpha + background.r * (1 - alpha), g: foreground.g * alpha + background.g * (1 - alpha), b: foreground.b * alpha + background.b * (1 - alpha), a: 1 };
}

function testContrast(first: ReturnType<typeof testRgb>, second: ReturnType<typeof testRgb>) {
  const luminance = (color: ReturnType<typeof testRgb>) => {
    const linear = (value: number) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; };
    return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

for (const dpr of [1, 2]) test(`partial profile bars use a thin keyline that restores canvas state at DPR ${dpr}`, () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, widthFactor: .9,
    displayMode: 'volume', cellStyle: 'profile', textColorMode: 'contrast',
    buyColor: '#58a65c', sellColor: '#ad5858', showCandle: false, showPoc: false, showValueArea: false,
    statsRows: [], tableRows: [] });
  p.setCellOpacity(.85);
  p.setBars([{ time: 0, rowSize: 25, delta: 83.7, cells: [
    { price: 112.5, bidVol: 0, askVol: 52.2 },
    { price: 87.5, bidVol: 0, askVol: 31.5 },
    { price: 62.5, bidVol: 0, askVol: 0 },
  ] }]);
  const strokes: { text: string; color: string; width: number; join: string; dash: number[]; shadowBlur: number; shadowColor: string }[] = [];
  const labels: string[] = [], profileFillAlphas: number[] = [];
  const canvas: any = { globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '#345678', lineWidth: 3, lineJoin: 'bevel', textAlign: 'center',
    shadowBlur: 4, shadowColor: '#ff0000', shadowOffsetX: 2, shadowOffsetY: 3, dash: [2, 6], stack: [] as any[],
    measureText(text: string) { return { width: text.length * parseFloat(this.font.match(/600 ([\d.]+)px/)?.[1] ?? '20') * .6 }; },
    save() { this.stack.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineJoin: this.lineJoin, dash: [...this.dash],
      shadowBlur: this.shadowBlur, shadowColor: this.shadowColor, shadowOffsetX: this.shadowOffsetX, shadowOffsetY: this.shadowOffsetY }); },
    restore() { Object.assign(this, this.stack.pop()); },
    setLineDash(value: number[]) { this.dash = [...value]; },
    roundRect() {}, fill() { profileFillAlphas.push(this.globalAlpha); },
    fillRect() {},
    fillText(text: string) { labels.push(text); },
  };
  canvas.strokeText = function(text: string) {
    strokes.push({ text, color: this.strokeStyle, width: this.lineWidth, join: this.lineJoin, dash: [...this.dash], shadowBlur: this.shadowBlur, shadowColor: this.shadowColor });
  };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  const rc: any = { dpr, plotWidth: 600, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 200, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 50, max: 150 }), priceToY: (value: number) => 400 - value * 2 },
    dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(labels).toEqual(['52.2', '31.5', '0']);
  expect(profileFillAlphas.length).toBeGreaterThan(0);
  expect(profileFillAlphas.every(alpha => alpha === .85)).toBe(true);
  expect(strokes).toEqual([{ text: '31.5', color: 'rgb(0, 0, 0)', width: dpr, join: 'round', dash: [], shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' }]);
  expect({ strokeStyle: canvas.strokeStyle, lineWidth: canvas.lineWidth, lineJoin: canvas.lineJoin, dash: canvas.dash,
    shadowBlur: canvas.shadowBlur, shadowColor: canvas.shadowColor, shadowOffsetX: canvas.shadowOffsetX, shadowOffsetY: canvas.shadowOffsetY })
    .toEqual({ strokeStyle: '#345678', lineWidth: 3, lineJoin: 'bevel', dash: [2, 6], shadowBlur: 4, shadowColor: '#ff0000', shadowOffsetX: 2, shadowOffsetY: 3 });
});

test('footprint opacity migrates and validates independently of heatmap opacity', () => {
  expect(config({}).footprint.opacity).toBe(.85);
  expect(config({ footprint: { opacity: NaN } }).footprint.opacity).toBe(.85);
  expect(config({ footprint: { opacity: 2 }, heatmap: { opacity: .3 } })).toMatchObject({ footprint: { opacity: 1 }, heatmap: { opacity: .3 } });
});

test('bid and ask cells leave a central execution-candle gutter with matching hover', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, cellStyle: 'ladder', widthFactor: .84, showCandle: true, showPoc: false, showValueArea: true, valueAreaColor: '#858585', statsRows: [] });
  p.setBars([{ time: 0, rowSize: 25, open: 100, high: 120, low: 100, close: 110, delta: 1, cells: [{ price: 112.5, bidVol: 2, askVol: 3 }] }]);
  const valueAreaStrokes: { color: string; alpha: number; width: number }[] = [];
  const cells: number[][] = [], candles: number[][] = [], dashes: number[][] = [], lines: number[][] = [];
  const target: any = { stroke() { valueAreaStrokes.push({ color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth }); }, globalAlpha: 1, font: '', measureText: () => ({ width: 10 }), roundRect: (...args: number[]) => cells.push(args), fillRect: (...args: number[]) => candles.push(args), setLineDash: (dash: number[]) => dashes.push(dash), moveTo: (...args: number[]) => lines.push(args), lineTo: (...args: number[]) => lines.push(args) };
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
  expect(dashes).toContainEqual([3, 2]);
  expect(valueAreaStrokes).toContainEqual({ color: '#6d3fa0', alpha: 1, width: 2 });
  expect(lines).toHaveLength(4);
  [[58.5, 100.5], [242.5, 100.5], [58.5, 200.5], [242.5, 200.5]].forEach((point, i) => point.forEach((v, j) => expect(lines[i][j]).toBeCloseTo(v)));
  expect(cells[0][0]).toBeCloseTo(66); expect(cells[1][0] + cells[1][2]).toBeCloseTo(234);
  p.setOptions({ showValueArea: false }); lines.length = 0; p.draw(ctx, rc); expect(lines).toEqual([]);
  p.detached(); expect(p.hoverAt(80, 150)).toBeNull();
});

for (const dpr of [1, 2]) {
  test(`footprint cell geometry, text and value-area guides align to backing pixels at DPR ${dpr}`, () => {
    const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, cellStyle: 'ladder', displayMode: 'bidask', showCandle: true,
      showPoc: true, pocStyle: 'outline', showValueArea: true, valueAreaColor: '#ffffff', statsRows: [], tableRows: [] });
    p.setBars([{ time: 0, rowSize: 25, delta: 4, cells: [
      { price: 112.5, bidVol: 2, askVol: 8 }, { price: 87.5, bidVol: 3, askVol: 1 },
    ], open: 95, high: 120, low: 90, close: 110 }]);
    const rects: number[][] = [], candles: number[][] = [], text: { font: string; x: number; y: number }[] = [], lines: number[][] = [];
    const guides: { color: string; width: number }[] = [], outlines: { path: RecordedPath2D; color: string; width: number; dash: number[] }[] = [];
    let dash: number[] = [];
    const canvas: any = { globalAlpha: 1, font: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
      measureText(value: string) { return { width: value.length * parseFloat(this.font.replace('600 ', '')) * .6 }; },
      save() {}, restore() {}, beginPath() {}, fill() {},
      roundRect(...args: number[]) { rects.push(args); }, fillRect(...args: number[]) { candles.push(args); },
      fillText(_value: string, x: number, y: number) { text.push({ font: this.font, x, y }); },
      moveTo(...args: number[]) { lines.push(args); }, lineTo(...args: number[]) { lines.push(args); },
      stroke(path?: RecordedPath2D) {
        if (path) outlines.push({ path, color: this.strokeStyle, width: this.lineWidth, dash: [...dash] });
        else guides.push({ color: this.strokeStyle, width: this.lineWidth });
      }, setLineDash(value: number[]) { dash = value; },
    };
    const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
    const rc: any = { dpr, plotWidth: 600, plotHeight: 400,
      theme: { background: '#f6f4ee', axisText: '#485567', upColor: '#167260', downColor: '#b54436' },
      timeScale: { barSpacing: 44, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150.25 },
      priceScale: { priceRange: () => ({ min: 50, max: 150 }), priceToY: (value: number) => 600 - value * 3.17 },
      dataLayer: { timeToIndex: () => 0 } };
    p.draw(ctx, rc);

    const offset = dpr === 1 ? .5 : 0;
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.every(([x, y, width, height]) => [x, y, width, height].every(Number.isInteger))).toBe(true);
    const cellLabels = text.filter(label => label.font.startsWith('600 '));
    expect(cellLabels.length).toBeGreaterThan(0);
    expect(cellLabels.every(label => Number.isInteger(label.x) && Number.isInteger(label.y))).toBe(true);
    expect(cellLabels.every(({ font }) => Number.isInteger(Number(font.match(/^600 ([\d.]+)px/)?.[1])))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.flat().every(value => Number.isInteger(value - offset))).toBe(true);
    expect(guides).toContainEqual({ color: '#6d3fa0', width: 2 * dpr });
    expect(candles).toHaveLength(2);
    expect(candles.flat().every(Number.isInteger)).toBe(true);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]).toMatchObject({ color: '#6d3fa0', width: 2 * dpr, dash: [3 * dpr, 2 * dpr] });
    expectPocMarkers(outlines[0]!.path);
    expect(outlines[0]!.path.commands[0]!.x).toBe(lines[0]![0]);
    expect(outlines[0]!.path.commands[2]!.x).toBe(lines[1]![0]);
    expect(outlines[0]!.path.commands.every(({ x, y }) => Number.isInteger(x - offset) && Number.isInteger(y - offset))).toBe(true);
  });
}

for (const dpr of [1, 2]) test(`narrow POC bars keep only two dotted row marks at DPR ${dpr}`, () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, cellStyle: 'ladder', displayMode: 'volume',
    showCandle: false, showPoc: true, pocStyle: 'outline', showValueArea: false, statsRows: [], tableRows: [] });
  p.setBars([{ time: 0, rowSize: 25, delta: 2, cells: [{ price: 50, bidVol: 1, askVol: 3 }] }]);
  const paths: { path: RecordedPath2D; color: string; alpha: number; width: number; dash: number[] }[] = [];
  const savedPocStates: any[] = [], restoredPocStates: any[] = [], stateStack: any[] = [];
  let awaitingPocRestore = false;
  const canvas: any = { globalAlpha: .4, strokeStyle: '#123456', lineWidth: 3, dash: [2, 6],
    save() { stateStack.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, dash: [...this.dash] }); },
    restore() {
      Object.assign(this, stateStack.pop());
      if (awaitingPocRestore) { restoredPocStates.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, dash: [...this.dash] }); awaitingPocRestore = false; }
    },
    setLineDash(value: number[]) { this.dash = [...value]; },
    measureText: () => ({ width: 10 }), roundRect() {}, fill() {},
    stroke(path?: RecordedPath2D) {
      if (path) {
        paths.push({ path, color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, dash: [...this.dash] });
        savedPocStates.push(stateStack.at(-1)); awaitingPocRestore = true;
      }
    },
  };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  const rc: any = { dpr, plotWidth: 12, plotHeight: 100,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 80, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 6 },
    priceScale: { priceRange: () => ({ min: 0, max: 100 }), priceToY: (value: number) => 100 - value },
    dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(paths).toHaveLength(1);
  expect(paths[0]).toMatchObject({ color: '#6d3fa0', alpha: 1, width: 2 * dpr, dash: [3 * dpr, 2 * dpr] });
  expectPocMarkers(paths[0]!.path);
  expect(Math.abs(paths[0]!.path.commands[2]!.x - paths[0]!.path.commands[0]!.x)).toBeLessThanOrEqual(12 * dpr + 1);
  expect(paths[0]!.dash).toEqual([3 * dpr, 2 * dpr]);
  expect(savedPocStates).toHaveLength(1);
  expect(savedPocStates[0]!.dash).toEqual([2, 6]);
  expect(restoredPocStates).toEqual(savedPocStates);
  p.setOptions({ showPoc: false }); paths.length = 0; p.draw(ctx, rc);
  expect(paths).toEqual([]);
});

test('small footprint panes retain visible price space above compact statistics', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, statsPosition: 'bottom', statsRows: ['volume', 'bidVolume', 'askVolume', 'delta'] });
  p.setBars([]);
  const rc: any = { dpr: 1, plotHeight: 70, timeScale: { barSpacing: 80 }, priceScale: { priceRange: () => ({ min: 0, max: 100 }), priceToY: (p: number) => 70-p }, dataLayer: { timeToIndex: () => undefined } };
  p.draw({} as any, rc);
  expect(p.options().statsRowHeight).toBe(8);
  expect(70 - 4*p.options().statsRowHeight).toBeGreaterThan(35);
});

test('paired volume profiles place unlabeled per-bar totals outside the native POC row', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, cellStyle: 'profile', displayMode: 'bidask', showCandle: true,
    showPoc: true, pocStyle: 'outline', showValueArea: true, valueAreaColor: '#858585', statsPosition: 'bar', statsRows: ['volume', 'delta'], tableRows: [] });
  p.setBars([{ time: 0, delta: 5, rowSize: 25, open: 100, high: 125, low: 100, close: 125,
    cells: [{ price: 112.5, bidVol: 2, askVol: 12 }, { price: 137.5, bidVol: 8, askVol: 3 }] }]);
  const profiles: number[][] = [], rects: number[][] = [], labels: { text: string; font: string; x: number; y: number; align: string; color: string; alpha: number }[] = [];
  const dashes: number[][] = [], pocPaths: RecordedPath2D[] = [];
  const canvas: any = { globalAlpha: 1, font: '', measureText(text: string) { return { width: text.length * 6 }; },
    roundRect: (...args: number[]) => profiles.push(args), fillRect: (...args: number[]) => rects.push(args),
    fillText(text: string, x: number, y: number) { labels.push({ text, font: this.font, x, y, align: this.textAlign, color: this.fillStyle, alpha: this.globalAlpha }); },
    stroke(path?: RecordedPath2D) { if (path) pocPaths.push(path); }, setLineDash: (dash: number[]) => dashes.push(dash) };
  const ctx = new Proxy(canvas, { get: (t, key) => key in t ? t[key] : () => {} });
  const rc: any = { dpr: 1, plotWidth: 600, plotHeight: 400, theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 200, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 50, max: 200 }), priceToY: (v: number) => 600-v*3 }, dataLayer: { timeToIndex: () => 0 } };
  p.draw(ctx, rc);
  expect(profiles[0][2] / profiles[1][2]).toBeCloseTo(8 / 3); // Highest price is drawn first; widths share the same maximum.
  expect(rects.some(r => r[0]+r[2]/2 === 150 && r[2] >= 2 && r[2] <= 8)).toBe(true);
  expect(profiles).toHaveLength(4); // No under-bar card background.
  expect(dashes).toContainEqual([3,2]);
  expect(p.stats()[0]).toMatchObject({ volume: 25, delta: 5 });
  expect(pocPaths).toHaveLength(1); expectPocMarkers(pocPaths[0]!);
  const leftMark = pocPaths[0]!.commands[0]!.x, rightMark = pocPaths[0]!.commands[2]!.x;
  const totals = labels.filter(label => label.x < leftMark || label.x > rightMark);
  expect(totals.map(({ text }) => text)).toEqual(['25', '+5']);
  expect(totals.map(({ align }) => align)).toEqual(['right', 'left']);
  expect(totals.every(({ font, alpha }) => font === '9px ui-monospace, SFMono-Regular, Menlo, monospace' && alpha === 1)).toBe(true);
  const pocY = Math.round(600 - p.stats()[0]!.poc * 3);
  expect(totals.map(({ y }) => y)).toEqual([pocY, pocY]);
  expect(Math.abs(totals[0]!.x - (leftMark - 3))).toBeLessThanOrEqual(.5);
  expect(Math.abs(totals[1]!.x - (rightMark + 3))).toBeLessThanOrEqual(.5);
  expect(Math.abs((leftMark - 1) - totals[0]!.x - 2)).toBeLessThanOrEqual(.5);
  expect(Math.abs(totals[1]!.x - (rightMark + 1) - 2)).toBeLessThanOrEqual(.5);
  expect(totals[0]!.color).toBe('rgb(204, 204, 204)'); expect(totals[1]!.color).toBe('rgb(88, 166, 92)');
});

test('POC-row totals use the full gap, track POC updates and remain outside the markers', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, cellStyle: 'profile', displayMode: 'bidask',
    showCandle: false, showPoc: true, pocStyle: 'outline', showValueArea: false, statsPosition: 'bar', statsRows: ['volume', 'delta'], tableRows: [] });
  const bars = [
    { time: 0, rowSize: 25, delta: 12_345_676, cells: [
      { price: 150, bidVol: 1, askVol: 12_345_677 }, { price: 125, bidVol: 1, askVol: 1 },
    ] },
    { time: 1, rowSize: 25, delta: -12_345_678, cells: [{ price: 100, bidVol: 12_345_678, askVol: 0 }] },
  ];
  p.setBars(bars);
  const labels: { text: string; x: number; y: number; align: string; font: string }[] = [];
  const paths: RecordedPath2D[] = [];
  let spacing = 140;
  const canvas: any = { font: '', textAlign: 'center', fillStyle: '', globalAlpha: 1,
    measureText(text: string) { return { width: text.length * 5.4 }; },
    fillText(text: string, x: number, y: number) {
      if (this.font === '9px ui-monospace, SFMono-Regular, Menlo, monospace') labels.push({ text, x, y, align: this.textAlign, font: this.font });
    },
    stroke(path?: RecordedPath2D) { if (path) paths.push(path); },
  };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  const rc: any = { dpr: 1, plotWidth: 400, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { get barSpacing() { return spacing; }, visibleRange: () => ({ from: 0, to: 2 }), indexToX: (index: number) => 100 + index * spacing },
    priceScale: { priceRange: () => ({ min: 0, max: 200 }), priceToY: (value: number) => 200 - value },
    dataLayer: { timeToIndex: (time: number) => time } };

  p.draw(ctx, rc);
  expect(p.stats().map(stat => stat.poc)).toEqual([150, 100]);
  expect(labels).toHaveLength(4); // Different POC rows may share the same horizontal gap.
  expect(labels.map(label => label.y)).toEqual([50, 50, 100, 100]);
  expect(labels.map(label => label.align)).toEqual(['right', 'left', 'right', 'left']);
  expect(labels.map(label => label.text)).toEqual(['12.3M', '+12.3M', '12.3M', '-12.3M']);
  expect(labels.every(label => label.font === '9px ui-monospace, SFMono-Regular, Menlo, monospace')).toBe(true);
  expect(paths).toHaveLength(2);

  const updated = [
    { ...bars[0]!, cells: [
      { price: 150, bidVol: 1, askVol: 1 }, { price: 125, bidVol: 1, askVol: 12_345_677 },
    ] },
    { ...bars[1]!, cells: [{ price: 125, bidVol: 12_345_678, askVol: 0 }] },
  ];
  p.setBars(updated); labels.length = 0; paths.length = 0; p.draw(ctx, rc);
  expect(p.stats().map(stat => stat.poc)).toEqual([125, 125]);
  expect(labels).toHaveLength(3); // The shifted markers leave less inter-bar room, so an overlapping flank is suppressed.
  expect(labels.map(label => label.y)).toEqual([75, 75, 75]);
  const labelBounds = labels.map(({ text, x, align }) => align === 'right'
    ? [x - text.length * 5.4, x] as const : [x, x + text.length * 5.4] as const).sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < labelBounds.length; index++) expect(labelBounds[index - 1]![1]).toBeLessThanOrEqual(labelBounds[index]![0]);
  expect(paths).toHaveLength(2);

  p.setOptions({ showPoc: false }); labels.length = 0; paths.length = 0; p.draw(ctx, rc);
  expect(paths).toHaveLength(0);
  expect(labels).toHaveLength(4); // The POC switch controls marks, not row-aligned totals.
  expect(labels.every(label => label.y === Math.round(rc.priceScale.priceToY(125)))).toBe(true);
});

test('POC markers keep two CSS pixels of ink clearance from painted POC cells across DPRs', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, cellStyle: 'profile', displayMode: 'bidask',
    showCandle: false, showPoc: true, pocStyle: 'outline', showValueArea: false, statsRows: [], tableRows: [] });
  p.setBars([{ time: 0, rowSize: 25, delta: -10, cells: [
    { price: 150, bidVol: 1, askVol: 24 }, { price: 125, bidVol: 40, askVol: 0 },
  ] }]);
  const fills: number[][] = [], paths: RecordedPath2D[] = [];
  let pending: number[] | null = null;
  const canvas: any = { globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    measureText: () => ({ width: 1 }), roundRect(...args: number[]) { pending = args; },
    fill() { if (pending) fills.push(pending); pending = null; },
    stroke(path?: RecordedPath2D) { if (path) paths.push(path); }, setLineDash() {}, save() {}, restore() {} };
  const ctx = new Proxy(canvas, { get: (target, key) => key in target ? target[key] : () => {} });
  const rc: any = { dpr: 1, plotWidth: 600, plotHeight: 400,
    theme: { background: '#090909', axisText: '#cccccc', upColor: '#58a65c', downColor: '#ad5858' },
    timeScale: { barSpacing: 200, visibleRange: () => ({ from: 0, to: 1 }), indexToX: () => 150 },
    priceScale: { priceRange: () => ({ min: 50, max: 175 }), priceToY: (value: number) => 600 - value * 3 },
    dataLayer: { timeToIndex: () => 0 } };
  expect(p.stats()[0]!.poc).toBe(125);
  for (const dpr of [1, 2]) {
    fills.length = 0; paths.length = 0; rc.dpr = dpr; p.draw(ctx, rc);
    expect(fills).toHaveLength(3);
    const pocY = rc.priceScale.priceToY(p.stats()[0]!.poc) * dpr;
    const pocFill = fills.find(([, y, , height]) => Math.abs(y + height / 2 - pocY) <= dpr)!;
    expect(pocFill).toBeDefined();
    expect(paths).toHaveLength(1);
    const markerWidth = Math.max(1, Math.round(dpr)) * 2;
    const leftInkEdge = paths[0]!.commands[0]!.x + markerWidth / 2;
    const rightInkEdge = paths[0]!.commands[2]!.x - markerWidth / 2;
    expect((pocFill[0]! - leftInkEdge) / dpr).toBeCloseTo(2, 5);
    expect((rightInkEdge - (pocFill[0]! + pocFill[2]!)) / dpr).toBeCloseTo(2, 5);
  }
});

test('POC marks align with VA guide endpoints through pan and edge clipping',()=>{
  const p=new TerminalFootprint({...DEFAULT_FOOTPRINT_OPTIONS,cellStyle:'profile',displayMode:'volume',widthFactor:.5,showCandle:false,showPoc:true,pocStyle:'outline',showValueArea:true,valueAreaColor:'#ffffff',statsRows:[],tableRows:[]});
  p.setBars([{time:0,rowSize:25,delta:3,cells:[{price:112.5,bidVol:0,askVol:2},{price:87.5,bidVol:0,askVol:1}]}]);
  const lines:number[][]=[],outlines:RecordedPath2D[]=[],fills:number[][]=[];let pending:number[]|null=null;
  const canvas:any={globalAlpha:1,font:'',measureText:()=>({width:1}),roundRect(...args:number[]){pending=args.slice(0,4);},fill(){if(pending)fills.push(pending);pending=null;},beginPath(){},moveTo:(...args:number[])=>lines.push(args),lineTo:(...args:number[])=>lines.push(args),stroke:(path?:RecordedPath2D)=>{if(path)outlines.push(path);}};
  const ctx=new Proxy(canvas,{get:(target,key)=>key in target?target[key]:()=>{}});
  const rc:any={dpr:1,plotWidth:600,plotHeight:400,theme:{background:'#090909',axisText:'#cccccc',upColor:'#58a65c',downColor:'#ad5858'},timeScale:{barSpacing:200,visibleRange:()=>({from:0,to:1}),indexToX:()=>150},priceScale:{priceRange:()=>({min:50,max:150}),priceToY:(price:number)=>600-price*4},dataLayer:{timeToIndex:()=>0}};
  p.draw(ctx,rc);
  expect(lines).toHaveLength(4);expect(outlines).toHaveLength(1);expectPocMarkers(outlines[0]!);
  expect(lines[1][0]-lines[0][0]).toBe(116);expect(lines[3][0]-lines[2][0]).toBe(116);
  expect((lines[1][0]+lines[0][0])/2).toBe(150.5);expect((lines[3][0]+lines[2][0])/2).toBe(150.5);
  expect(outlines[0]!.commands[0]!.x).toBe(lines[0][0]);expect(outlines[0]!.commands[2]!.x).toBe(lines[1][0]);
  lines.length=0;outlines.length=0;fills.length=0;rc.plotWidth=205;p.draw(ctx,rc);
  expect(lines).toHaveLength(4);expect(outlines).toHaveLength(1);
  expect(lines[0][0]).toBe(92.5);expect(lines[1][0]).toBe(205.5);expect(lines[2][0]).toBe(92.5);expect(lines[3][0]).toBe(205.5);
  expect(outlines[0]!.commands[2]!.x).toBe(lines[1][0]);
  expect(outlines[0]!.commands[0]!.x).toBe(lines[0][0]);
  lines.length=0;outlines.length=0;fills.length=0;rc.plotWidth=600;rc.timeScale.indexToX=()=>50;p.draw(ctx,rc);
  expect(lines).toHaveLength(4);expect(outlines).toHaveLength(1);
  expect(lines[0][0]).toBe(.5);expect(lines[1][0]).toBe(108.5);expect(lines[2][0]).toBe(.5);expect(lines[3][0]).toBe(108.5);
  expect(outlines[0]!.commands[0]!.x).toBe(lines[0][0]);
});

test('large profile labels do not erase a smaller proportional bid bar', () => {
  const p = new TerminalFootprint({ ...DEFAULT_FOOTPRINT_OPTIONS, font: 9, cellStyle: 'profile', displayMode: 'bidask', showCandle: true, showPoc: false, statsRows: [], tableRows: [] });
  p.setBars([{ time: 0, rowSize: 25, delta: 4.29, open: 100, high: 115, low: 100, close: 115, cells: [{ price: 112.5, bidVol: 4.07, askVol: 8.36 }] }]);
  const profiles:number[][]=[], rectangles:{color:string;args:number[]}[]=[], labels:string[]=[];
  const canvas:any={globalAlpha:1,font:'',measureText(text:string){return{width:text.length*parseFloat(this.font.replace('600 ',''))*.6};},roundRect:(...args:number[])=>profiles.push(args),fillRect(...args:number[]){rectangles.push({color:this.fillStyle,args});},fillText(text:string){labels.push(text);} };
  const ctx=new Proxy(canvas,{get:(t,key)=>key in t?t[key]:()=>{}});
  const rc:any={dpr:1,plotWidth:400,plotHeight:400,theme:{background:'#090909',axisText:'#cccccc',upColor:'#58a65c',downColor:'#ad5858'},timeScale:{barSpacing:160,visibleRange:()=>({from:0,to:1}),indexToX:()=>150},priceScale:{priceRange:()=>({min:75,max:150}),priceToY:(v:number)=>600-v*4},dataLayer:{timeToIndex:()=>0}};
  p.draw(ctx,rc);
  expect(p.cellFont).toBeGreaterThan(20);
  expect(profiles).toHaveLength(2);
  expect(profiles[0][2]/profiles[1][2]).toBeCloseTo(4.07/8.36);
  expect(rectangles.filter(r=>r.color===rc.theme.background)).toHaveLength(0);
  expect(rectangles).toHaveLength(2); // Actual candle wick/body are preserved.
  expect(labels).toEqual(['4.07','8.36']);
});

for(const displayMode of ['bidask','delta','volume'] as const)for(const cellStyle of ['ladder','profile'] as const){
  test(`${displayMode}/${cellStyle} draws and can hide the execution candle as its forming OHLC revises`,()=>{
    const p=new TerminalFootprint({...DEFAULT_FOOTPRINT_OPTIONS,displayMode,cellStyle,showCandle:true,showPoc:false,statsRows:[],tableRows:[]});
    const bar={time:0,rowSize:25,open:100,high:120,low:95,close:110,delta:1,cells:[{price:112.5,bidVol:2,askVol:3}]};p.setBars([bar]);
    const rectangles:number[][]=[];const canvas:any={globalAlpha:1,font:'',measureText:()=>({width:1}),fillRect:(...args:number[])=>rectangles.push(args)};
    const ctx=new Proxy(canvas,{get:(t,key)=>key in t?t[key]:()=>{}});
    const rc:any={dpr:1,plotWidth:600,plotHeight:400,theme:{background:'#090909',axisText:'#cccccc',upColor:'#58a65c',downColor:'#ad5858'},timeScale:{barSpacing:200,visibleRange:()=>({from:0,to:1}),indexToX:()=>150},priceScale:{priceRange:()=>({min:75,max:150}),priceToY:(v:number)=>600-v*4},dataLayer:{timeToIndex:()=>0}};
    p.draw(ctx,rc);expect(rectangles).toHaveLength(2);expect(rectangles[1][2]).toBe(8);expect(rectangles[1][3]).toBe(40);
    if(displayMode==='bidask')expect(rectangles[1][0]+4).toBe(150);else expect(rectangles[1][0]+8).toBeLessThan(150-200*.9/2);
    p.setBars([{...bar,high:125,close:125}]);rectangles.length=0;p.draw(ctx,rc);expect(rectangles[1][3]).toBe(100);
    p.setOptions({showCandle:false});rectangles.length=0;p.draw(ctx,rc);expect(rectangles).toEqual([]);
  });
}

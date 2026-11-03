import { describe, expect, it } from 'vitest';
import { PriceScale } from 'openalgo-charts';
import { groupedSourceSlot, layoutNetPositioningSources, netPositioningBands, roundDprBoundary } from '../src/chart/net-positioning-layout';
import { NetPositioningPane, netPositioningSourceColors, netPositioningTextColor } from '../src/chart/net-positioning';
import type { NetPositioningCandle, NetVenueCandle } from '../src/feed/net-positioning';

function venueValue(venue: 'binance' | 'hyperliquid', longs: number): NetVenueCandle {
  return { venue, netLongsBtc: longs, netShortsBtc: longs, unclassifiedBtc: 0, oiDeltaBtc: longs,
    netLongsBtcDecimal: String(longs), netShortsBtcDecimal: String(longs), unclassifiedBtcDecimal: '0', oiDeltaBtcDecimal: String(longs),
    aggressorBuyBtc: null, aggressorSellBtc: null, flowAvailableIntervals: 0, flowUnavailableIntervals: 0,
    availableIntervals: 1, unavailableIntervals: 0, minResolutionMs: 30_000, maxResolutionMs: 30_000, observations: [] };
}

describe('net positioning display layout', () => {
  it('uses green longs and red shorts across themes while retaining saved overrides', () => {
    const dark = netPositioningSourceColors('dark'), light = netPositioningSourceColors('light'), terminal = netPositioningSourceColors('terminal'), ios = netPositioningSourceColors('ios');
    expect(dark).toEqual({ binance: '#58a65c', hyperliquid: '#85c98b', bybit: '#b1d677' });
    expect(light).toEqual({ binance: '#167260', hyperliquid: '#44853e', bybit: '#626e20' });
    expect(terminal).toEqual({ binance: '#38d984', hyperliquid: '#79eaa4', bybit: '#a8e7b8' });
    expect(ios).toEqual({ binance: '#248a3d', hyperliquid: '#30a450', bybit: '#55985f' });
    expect(netPositioningTextColor(dark.binance, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(dark.hyperliquid, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(light.binance, '#f6f4ee')).toBe('#f5f5f5');
    expect(netPositioningTextColor(light.hyperliquid, '#f6f4ee')).toBe('#111111');
    expect(dark.binance).not.toBe(dark.hyperliquid);
    const longs = new NetPositioningPane('net-longs'), shorts = new NetPositioningPane('net-shorts');
    longs.setThemeColors(dark, 'longs');
    shorts.setThemeColors(netPositioningSourceColors('dark', 'shorts'), 'shorts');
    expect(shorts.sourceColor('binance', 'shorts')).toBe('#ad5858');
    expect(shorts.sourceColor('hyperliquid', 'shorts')).toBe('#d98a8a');
    longs.setColorOverrides({ binance: '#abc' });
    longs.setThemeColors(light, 'longs');
    expect(longs.sourceColor('binance', 'longs')).toBe('#abc');
    expect(longs.sourceColor('hyperliquid', 'longs')).toBe(light.hyperliquid);
  });

  it('places Longs above Shorts by default, reverses their order, and expands a visible side to the full pane', () => {
    const normal = netPositioningBands(230, true, true);
    expect(normal.map(band => band.side)).toEqual(['longs', 'shorts']);
    expect(normal[0]!.bottom).toBe(normal[1]!.top);
    expect(normal[0]!.baseline).toBeLessThan(normal[1]!.baseline);
    const reversed = netPositioningBands(230, true, true, true);
    expect(reversed.map(band => band.side)).toEqual(['shorts', 'longs']);
    const onlyLongs = netPositioningBands(230, true, false);
    expect(onlyLongs).toHaveLength(1);
    expect(onlyLongs[0]!.bottom).toBeGreaterThan(normal[0]!.bottom);
    expect(netPositioningBands(230, false, false)).toEqual([]);
  });

  it('stacks three or more signed sources independently around zero and preserves quality states', () => {
    const result = layoutNetPositioningSources([
      { sourceId: 'binance:perpetual', value: 120 },
      { sourceId: 'hyperliquid:perpetual', value: -50 },
      { sourceId: 'okx:perpetual', value: 30, quality: 'partial' },
      { sourceId: 'zero:perpetual', value: 0 },
      { sourceId: 'missing:perpetual', value: null },
    ], 'stacked');

    expect(result.segments).toEqual([
      { sourceId: 'binance:perpetual', value: 120, start: 0, end: 120, sign: 'positive', quality: 'complete' },
      { sourceId: 'hyperliquid:perpetual', value: -50, start: 0, end: -50, sign: 'negative', quality: 'complete' },
      { sourceId: 'okx:perpetual', value: 30, start: 120, end: 150, sign: 'positive', quality: 'partial' },
      { sourceId: 'zero:perpetual', value: 0, start: 0, end: 0, sign: 'zero', quality: 'complete' },
      { sourceId: 'missing:perpetual', value: null, start: null, end: null, sign: 'none', quality: 'missing' },
    ]);
    expect(result).toMatchObject({ positiveTotal: 150, negativeTotal: -50, signedTotal: 100 });
  });

  it('keeps grouped source values unchanged and never converts them to absolute magnitudes', () => {
    const result = layoutNetPositioningSources([
      { sourceId: 'a', value: -4 }, { sourceId: 'b', value: 0 }, { sourceId: 'c', value: 7 },
    ], 'grouped');
    expect(result.segments.map(({ sourceId, value, start, end, sign }) => ({ sourceId, value, start, end, sign }))).toEqual([
      { sourceId: 'a', value: -4, start: 0, end: -4, sign: 'negative' },
      { sourceId: 'b', value: 0, start: 0, end: 0, sign: 'zero' },
      { sourceId: 'c', value: 7, start: 0, end: 7, sign: 'positive' },
    ]);
    expect(result.signedTotal).toBe(3);
  });

  it('recomputes each source boundary independently after signs change', () => {
    const changed = layoutNetPositioningSources([
      { sourceId: 'a', value: -8 }, { sourceId: 'b', value: 3 }, { sourceId: 'c', value: -2 },
    ], 'stacked');
    expect(changed.segments.map(({ start, end }) => [start, end])).toEqual([[0, -8], [0, 3], [-8, -10]]);
    expect(changed).toMatchObject({ positiveTotal: 3, negativeTotal: -10, signedTotal: -7 });
  });

  it('rounds cumulative segment boundaries once at device-pixel precision', () => {
    const result = layoutNetPositioningSources([
      { sourceId: 'a', value: 1.25 }, { sourceId: 'b', value: 2.5 }, { sourceId: 'c', value: -1.25 },
    ], 'stacked');
    const cssY = (value: number) => 80 - value * 3.35;
    const a = result.segments[0]!, b = result.segments[1]!;
    expect(roundDprBoundary(cssY(a.end!), 2)).toBe(roundDprBoundary(cssY(b.start!), 2));
    expect(roundDprBoundary(10.24, 2)).toBe(20);
    expect(roundDprBoundary(10.24, Number.NaN)).toBe(10);
  });

  it('uses a full-width grouped bar for one selected source and stable registry slots for several', () => {
    const one = groupedSourceSlot('c', ['c'], ['a', 'b', 'c'], 40, 30)!;
    const withMissingB = groupedSourceSlot('c', ['a', 'b', 'c'], ['a', 'b', 'c'], 40, 30)!;
    const withoutSelectedB = groupedSourceSlot('c', ['a', 'c'], ['a', 'b', 'c'], 40, 30)!;
    expect(one).toEqual({ left: 25, width: 30 });
    expect(withoutSelectedB).toEqual(withMissingB);
    expect(withMissingB.width).toBeLessThan(30);
  });

  it('marks non-finite inputs unavailable instead of drawing a fabricated zero', () => {
    const result = layoutNetPositioningSources([
      { sourceId: 'nan', value: Number.NaN, quality: 'complete' },
      { sourceId: 'infinity', value: Number.POSITIVE_INFINITY, quality: 'partial' },
      { sourceId: 'missing', value: null },
    ], 'stacked');
    expect(result.segments).toMatchObject([
      { value: null, start: null, end: null, sign: 'none', quality: 'unavailable' },
      { value: null, start: null, end: null, sign: 'none', quality: 'unavailable' },
      { value: null, start: null, end: null, sign: 'none', quality: 'missing' },
    ]);
  });

  it('keeps independent signed scale extents for each side over the visible interval', () => {
    const pane = new NetPositioningPane('net-combined');
    pane.setSettings('price-oi', ['binance', 'hyperliquid'], 60_000, 'stacked');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }]);
    const candles: NetPositioningCandle[] = [
      { timeMs: 0, venues: { binance: venueValue('binance', 1), hyperliquid: venueValue('hyperliquid', 2) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', 10), hyperliquid: venueValue('hyperliquid', -4) } },
    ];
    pane.setSnapshot(candles);
    pane.setVisibleRange(0, 1);
    expect(pane.diagnostics().visibleScaleBySide.longs).toMatchObject({ min: 0, max: 3 });
    expect(pane.diagnostics().visibleScaleBySide.shorts).toMatchObject({ min: 0, max: 3 });
    pane.setVisibleRange(1, 2);
    expect(pane.diagnostics().visibleScaleBySide.longs).toMatchObject({ min: -4, max: 10 });
    expect(pane.diagnostics().visibleScaleBySide.shorts).toMatchObject({ min: -4, max: 10 });
    pane.setSettings('price-oi', ['binance', 'hyperliquid'], 60_000, 'grouped');
    expect(pane.diagnostics().visibleScaleBySide.longs).toMatchObject({ min: -4, max: 10 });
    expect(pane.diagnostics().visibleScaleBySide.shorts).toMatchObject({ min: -4, max: 10 });
  });

  it.each([1, 2])('keeps zero ticks and signed bar origins on the assigned autoscale at compact heights and DPR %s', dpr => {
    const pane = new NetPositioningPane('compact-negative');
    pane.setSettings('price-oi', ['binance', 'hyperliquid'], 60_000, 'stacked', 'off', false, true);
    pane.setHostSnapshot([{ t: 0, closed: true }]);
    pane.setSnapshot([{ timeMs: 0, venues: { binance: venueValue('binance', -7), hyperliquid: venueValue('hyperliquid', 0) } }]);
    pane.setVisibleRange(0, 1);

    const scale = new PriceScale();
    scale.setHeight(70);
    const range = pane.autoscaleInfo()!;
    scale.autoscale(range.min, range.max);
    pane.setPriceScale(scale);
    pane.afterAutoscale();
    expect(scale.autoScale).toBe(true);
    expect(scale.options.marginTop * scale.height).toBeGreaterThanOrEqual(38);

    const strokes: number[] = [], rectangles: { x: number; y: number; width: number; height: number }[] = [];
    const pathY: number[] = [];
    const ctx = {
      lineWidth: 1, fillStyle: '', strokeStyle: '', globalAlpha: 1,
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo(_x: number, y: number) { pathY.push(y); },
      lineTo(_x: number, y: number) { pathY.push(y); }, stroke() { if (pathY.length >= 2) strokes.push(pathY.at(-1)!); },
      fillRect(x: number, y: number, width: number, height: number) { rectangles.push({ x, y, width, height }); },
      strokeRect() {}, measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }), fillText() {},
    } as unknown as CanvasRenderingContext2D;
    pane.draw(ctx, { dpr, plotWidth: 220, plotHeight: 70, timeScale: { visibleRange: () => ({ from: 0, to: 1 }), barSpacing: 80, indexToX: () => 100 }, priceScale: scale, theme: { axisText: '#aaa', background: '#090909' } } as any);

    const scaleZero = pane.diagnostics().renderedBands[0]!.baseline;
    expect(scaleZero).toBeGreaterThanOrEqual(38);
    expect(strokes.some(y => Math.abs(y / dpr - scaleZero) * dpr <= 1)).toBe(true);
    const segments = (pane as any).geometry as { value: number; top: number; bottom: number; zero: boolean }[];
    const negative = segments.find(segment => segment.value < 0)!;
    const zero = segments.find(segment => segment.zero)!;
    expect(Math.abs(negative.top - scaleZero) * dpr).toBeLessThanOrEqual(1);
    expect(Math.abs((zero.top + zero.bottom) / 2 - scaleZero) * dpr).toBeLessThanOrEqual(1);
    expect(rectangles.some(rect => rect.height === Math.max(1, Math.round(dpr))
      && Math.abs((rect.y + rect.height / 2) / dpr - scaleZero) * dpr <= 1)).toBe(true);
  });

  it('does not change a manually held positioning range or margins', () => {
    const pane = new NetPositioningPane('manual-positioning');
    const scale = new PriceScale();
    scale.setHeight(70);
    scale.setPriceRange({ min: -12, max: 0 });
    scale.setAutoScale(false);
    pane.setPriceScale(scale);
    const before = scale.priceRange();
    pane.afterAutoscale();
    expect(scale.autoScale).toBe(false);
    expect(scale.priceRange()).toEqual(before);
    expect(scale.options.marginTop).toBe(.1);
  });

  it('moves each side scale window to the live right edge after the host appends a candle', () => {
    const pane = new NetPositioningPane('net-combined');
    pane.setSettings('price-oi', ['binance'], 60_000, 'stacked');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }, { t: 120_000, closed: false }]);
    pane.setSnapshot([
      { timeMs: 0, venues: { binance: venueValue('binance', 100) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', 1) } },
      { timeMs: 120_000, venues: { binance: venueValue('binance', 2) } },
    ]);
    pane.setVisibleRange(0, 3);
    expect(pane.diagnostics().visibleScaleBySide.longs.max).toBe(100);

    pane.patchHostCandles([{ t: 180_000, o: 1, h: 1, l: 1, c: 1, v: 0, closed: false, revision: 1 }]);
    pane.patch([{ timeMs: 180_000, venues: { binance: venueValue('binance', 4) } }]);
    pane.setVisibleRange(1, 4);
    expect(pane.diagnostics().visibleScaleBySide.longs.max).toBe(4);
  });
});

it.each([1, 2])('places signed amount glyphs outside complete stacks at DPR %s', dpr => {
  for (const side of ['longs', 'shorts'] as const) {
    const pane = new NetPositioningPane(`outside-${side}`);
    pane.setSettings('price-oi', ['binance', 'hyperliquid'], 60_000, 'stacked', 'auto', side === 'longs', side === 'shorts');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }]);
    pane.setSnapshot([
      { timeMs: 0, venues: { binance: venueValue('binance', 100), hyperliquid: venueValue('hyperliquid', 200) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', -100), hyperliquid: venueValue('hyperliquid', -200) } },
    ]);
    const amounts: { x: number; y: number }[] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, strokeRect() {},
      measureText: () => ({ width: 18 * dpr, actualBoundingBoxAscent: 7 * dpr, actualBoundingBoxDescent: 2 * dpr }),
      fillText: (text: string, x: number, y: number) => { if (/^\d/.test(text)) amounts.push({ x, y }); },
    } as unknown as CanvasRenderingContext2D;
    pane.draw(ctx, { dpr, plotWidth: 300, plotHeight: 300, timeScale: { visibleRange: () => ({ from: 0, to: 2 }), barSpacing: 80, indexToX: (i: number) => 80 + i * 130 },
      priceScale: { priceToY: (value: number) => (500 - value) * .3 }, theme: { axisText: '#aaa', background: '#090909' } } as any);
    const positive = amounts.filter(p => p.x < 150 * dpr), negative = amounts.filter(p => p.x > 150 * dpr);
    expect(positive).toHaveLength(2); expect(negative).toHaveLength(2);
    // The assigned native scale maps the positive and negative stack ends to y=60 and y=240.
    const baseline = pane.diagnostics().renderedBands[0]!.baseline * dpr;
    for (const p of positive) expect(p.y).toBeLessThan(baseline);
    for (const p of negative) expect(p.y).toBeGreaterThan(baseline);
    expect(Math.abs(positive[0].y - positive[1].y)).toBeGreaterThanOrEqual(11 * dpr);
    expect(Math.abs(negative[0].y - negative[1].y)).toBeGreaterThanOrEqual(11 * dpr);
  }
});

it.each([1, 2])('keeps narrow three-digit labels visible at clipped pane edges without overlaps at DPR %s', dpr => {
  for (const side of ['longs', 'shorts'] as const) {
    const pane = new NetPositioningPane(`narrow-${side}`);
    pane.setSettings('price-oi', ['binance'], 60_000, 'stacked', 'auto', side === 'longs', side === 'shorts');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }]);
    pane.setSnapshot([
      { timeMs: 0, venues: { binance: venueValue('binance', 123) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', -456) } },
    ]);
    const labels: { text: string; x: number; y: number; color: string }[] = [];
    const ctx = {
      fillStyle: '', save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, strokeRect() {},
      measureText: () => ({ width: 26 * dpr, actualBoundingBoxAscent: 9 * dpr, actualBoundingBoxDescent: 3 * dpr }),
      fillText(this: { fillStyle: string }, text: string, x: number, y: number) { if (/^\d+$/.test(text)) labels.push({ text, x, y, color: this.fillStyle }); },
    } as unknown as CanvasRenderingContext2D;
    pane.draw(ctx, { dpr, plotWidth: 180, plotHeight: 150, timeScale: { visibleRange: () => ({ from: 0, to: 2 }), barSpacing: 32, indexToX: (i: number) => 50 + i * 32 },
      priceScale: { priceToY: (value: number) => 35 - value * .2 }, theme: { axisText: '#aaa', background: '#090909' } } as any);
    expect(labels.map(label => label.text).sort()).toEqual(['123', '456']);
    expect(labels.every(label => label.x >= 0 && label.x <= 180 * dpr)).toBe(true);
    const band = pane.diagnostics().renderedBands[0]!;
    expect(labels.every(label => label.y - 9 * dpr >= (band.top + 15) * dpr && label.y + 3 * dpr <= (band.bottom - 2) * dpr)).toBe(true);
    expect(Math.abs(labels[0]!.x - labels[1]!.x)).toBeGreaterThanOrEqual(32 * dpr);
    expect(labels.every(label => label.color !== '#090909')).toBe(true);
  }
});

it.each([1,2])('uses the host column geometry without a 64px cap at DPR %s',dpr=>{
 const pane=new NetPositioningPane('width',(x,spacing)=>({left:x-spacing*.76/2,width:spacing*.76}));
 pane.setSettings('price-oi',['binance'],60000,'stacked','off',false,true);pane.setHostSnapshot([{t:0,closed:true}]);pane.setSnapshot([{timeMs:0,venues:{binance:venueValue('binance',10)}}]);
 const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){},fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
 for(const spacing of [80,160,300]){
  pane.draw(ctx,{dpr,plotWidth:500,plotHeight:300,timeScale:{visibleRange:()=>({from:0,to:1}),barSpacing:spacing,indexToX:()=>250},priceScale:{priceToY:(v:number)=>200-v},theme:{}} as any);
  const g=(pane as any).geometry[0];expect(g.left).toBeCloseTo(Math.round((250-spacing*.76/2)*dpr)/dpr);expect(g.right-g.left).toBeCloseTo((Math.round((250+spacing*.76/2)*dpr)-Math.round((250-spacing*.76/2)*dpr))/dpr);
 }
});

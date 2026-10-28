import { describe, expect, it } from 'vitest';
import { groupedSourceSlot, layoutNetPositioningSources, roundDprBoundary } from '../src/chart/net-positioning-layout';
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
    const dark = netPositioningSourceColors('dark'), light = netPositioningSourceColors('light');
    expect(dark).toEqual({ binance: '#58a65c', hyperliquid: '#85c98b', bybit: '#b1d677' });
    expect(light).toEqual({ binance: '#167260', hyperliquid: '#44853e', bybit: '#626e20' });
    expect(netPositioningTextColor(dark.binance, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(dark.hyperliquid, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(light.binance, '#f6f4ee')).toBe('#f5f5f5');
    expect(netPositioningTextColor(light.hyperliquid, '#f6f4ee')).toBe('#111111');
    expect(dark.binance).not.toBe(dark.hyperliquid);
    const longs = new NetPositioningPane('net-longs', 'longs'), shorts = new NetPositioningPane('net-shorts', 'shorts');
    longs.setThemeColors(dark);
    shorts.setThemeColors(netPositioningSourceColors('dark', 'shorts'));
    expect(shorts.sourceColor('binance')).toBe('#ad5858');
    expect(shorts.sourceColor('hyperliquid')).toBe('#d98a8a');
    longs.setColorOverrides({ binance: '#abc' });
    longs.setThemeColors(light);
    expect(longs.sourceColor('binance')).toBe('#abc');
    expect(longs.sourceColor('hyperliquid')).toBe(light.hyperliquid);
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

  it('autoscale follows only the visible interval and changes extents for stacked versus grouped display', () => {
    const pane = new NetPositioningPane('net-longs', 'longs');
    pane.setSettings('longs', 'price-oi', ['binance', 'hyperliquid'], 60_000, 'stacked');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }]);
    const candles: NetPositioningCandle[] = [
      { timeMs: 0, venues: { binance: venueValue('binance', 1), hyperliquid: venueValue('hyperliquid', 2) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', 10), hyperliquid: venueValue('hyperliquid', -4) } },
    ];
    pane.setSnapshot(candles);
    pane.setVisibleRange(0, 1);
    expect(pane.autoscaleInfo()).toMatchObject({ min: 0, max: 3.6 });
    pane.setVisibleRange(1, 2);
    expect(pane.autoscaleInfo()?.min).toBeCloseTo(-6.8, 10);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(12.8, 10);
    pane.setSettings('longs', 'price-oi', ['binance', 'hyperliquid'], 60_000, 'grouped');
    expect(pane.autoscaleInfo()?.min).toBeCloseTo(-5.96, 10);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(11.96, 10);
  });

  it('moves its autoscale window to the new live right edge after the host appends a candle', () => {
    const pane = new NetPositioningPane('net-longs', 'longs');
    pane.setSettings('longs', 'price-oi', ['binance'], 60_000, 'stacked');
    pane.setHostSnapshot([{ t: 0, closed: true }, { t: 60_000, closed: true }, { t: 120_000, closed: false }]);
    pane.setSnapshot([
      { timeMs: 0, venues: { binance: venueValue('binance', 100) } },
      { timeMs: 60_000, venues: { binance: venueValue('binance', 1) } },
      { timeMs: 120_000, venues: { binance: venueValue('binance', 2) } },
    ]);
    pane.setVisibleRange(0, 3);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(114, 10);

    pane.patchHostCandles([{ t: 180_000, o: 1, h: 1, l: 1, c: 1, v: 0, closed: false, revision: 1 }]);
    pane.patch([{ timeMs: 180_000, venues: { binance: venueValue('binance', 4) } }]);
    pane.setVisibleRange(1, 4);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(4.56, 10);
  });
});

it.each([1, 2])('places signed amount glyphs outside complete stacks at DPR %s', dpr => {
  for (const side of ['longs', 'shorts'] as const) {
    const pane = new NetPositioningPane(`outside-${side}`, side);
    pane.setSettings(side, 'price-oi', ['binance', 'hyperliquid'], 60_000, 'stacked', 'auto');
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
    // The positive stack ends at y=84; the negative stack ends at y=246.
    for (const p of positive) expect(p.y + 2 * dpr).toBeLessThan(84 * dpr);
    for (const p of negative) expect(p.y - 7 * dpr).toBeGreaterThan(246 * dpr);
    expect(Math.abs(positive[0].y - positive[1].y)).toBeGreaterThanOrEqual(11 * dpr);
    expect(Math.abs(negative[0].y - negative[1].y)).toBeGreaterThanOrEqual(11 * dpr);
  }
});

it.each([1,2])('uses the host column geometry without a 64px cap at DPR %s',dpr=>{
 const pane=new NetPositioningPane('width','shorts',(x,spacing)=>({left:x-spacing*.76/2,width:spacing*.76}));
 pane.setSettings('shorts','price-oi',['binance'],60000,'stacked','off');pane.setHostSnapshot([{t:0,closed:true}]);pane.setSnapshot([{timeMs:0,venues:{binance:venueValue('binance',10)}}]);
 const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){},fillRect(){},strokeRect(){},fillText(){},measureText(){return {width:0};}};
 for(const spacing of [80,160,300]){
  pane.draw(ctx,{dpr,plotWidth:500,plotHeight:300,timeScale:{visibleRange:()=>({from:0,to:1}),barSpacing:spacing,indexToX:()=>250},priceScale:{priceToY:(v:number)=>200-v},theme:{}} as any);
  const g=(pane as any).geometry[0];expect(g.left).toBeCloseTo(Math.round((250-spacing*.76/2)*dpr)/dpr);expect(g.right-g.left).toBeCloseTo((Math.round((250+spacing*.76/2)*dpr)-Math.round((250-spacing*.76/2)*dpr))/dpr);
 }
});

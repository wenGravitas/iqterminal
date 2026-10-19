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
  it('uses a source-stable amber and blue palette across both signs and themes while retaining saved overrides', () => {
    const dark = netPositioningSourceColors('dark'), light = netPositioningSourceColors('light');
    expect(dark).toEqual({ binance: '#c39b58', hyperliquid: '#719aca' });
    expect(light).toEqual({ binance: '#946820', hyperliquid: '#3e71a6' });
    expect(netPositioningTextColor(dark.binance, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(dark.hyperliquid, '#090909')).toBe('#111111');
    expect(netPositioningTextColor(light.binance, '#f6f4ee')).toBe('#f5f5f5');
    expect(netPositioningTextColor(light.hyperliquid, '#f6f4ee')).toBe('#f5f5f5');
    expect(dark.binance).not.toBe(dark.hyperliquid);
    const longs = new NetPositioningPane('net-longs', 'longs'), shorts = new NetPositioningPane('net-shorts', 'shorts');
    for (const pane of [longs, shorts]) pane.setThemeColors(dark);
    expect(longs.sourceColor('binance')).toBe(shorts.sourceColor('binance'));
    expect(longs.sourceColor('hyperliquid')).toBe(shorts.sourceColor('hyperliquid'));
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
    expect(pane.autoscaleInfo()).toMatchObject({ min: 0, max: 3.24 });
    pane.setVisibleRange(1, 2);
    expect(pane.autoscaleInfo()?.min).toBeCloseTo(-5.12, 10);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(11.12, 10);
    pane.setSettings('longs', 'price-oi', ['binance', 'hyperliquid'], 60_000, 'grouped');
    expect(pane.autoscaleInfo()?.min).toBeCloseTo(-5.12, 10);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(11.12, 10);
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
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(108, 10);

    pane.patchHostCandles([{ t: 180_000, o: 1, h: 1, l: 1, c: 1, v: 0, closed: false, revision: 1 }]);
    pane.patch([{ timeMs: 180_000, venues: { binance: venueValue('binance', 4) } }]);
    pane.setVisibleRange(1, 4);
    expect(pane.autoscaleInfo()?.max).toBeCloseTo(4.32, 10);
  });
});

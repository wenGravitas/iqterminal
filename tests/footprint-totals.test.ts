import { describe, expect, it, vi } from 'vitest';
import type { FootprintBarStats } from 'openalgo-charts/profile';
import { FootprintTotalsPane, footprintStatText, footprintTotalsPreferredHeight } from '../src/chart/footprint-totals';
import { blendFootprintTotalsColor, FOOTPRINT_TOTALS_ROW_LABELS, footprintTotalsCellColor, footprintTotalsRowMax } from '../src/chart/footprint-totals-style';

const stats: FootprintBarStats = {
  time: 60, volume: 12.345, bidVolume: 8, askVolume: 4.345, delta: -3.655,
  minDelta: -4, maxDelta: 0, deltaPct: -29.6, cvd: -22, trades: null,
  poc: 42_500, vah: 42_600, val: 42_400,
};

describe('Footprint Totals pane', () => {
  it('sizes the pane to its header, selected rows, and bottom rule', () => {
    expect(footprintTotalsPreferredHeight(0)).toBe(32);
    expect(footprintTotalsPreferredHeight(2)).toBe(62);
    expect(footprintTotalsPreferredHeight(4)).toBe(92);
    expect(footprintTotalsPreferredHeight(6)).toBe(122);
    expect(footprintTotalsPreferredHeight(4, 18)).toBe(104);
    expect(footprintTotalsPreferredHeight(12, 15)).toBe(167);
    expect(footprintTotalsPreferredHeight(4, 2)).toBe(64);
  });

  it('formats the same Footprint stats values and retains unknown row values as unavailable', () => {
    expect(footprintStatText(stats, 'volume')).toBe('12.3');
    expect(footprintStatText(stats, 'delta')).toBe('-3.65');
    expect(footprintStatText(stats, 'deltaPct')).toBe('-29.6%');
    expect(footprintStatText(stats, 'trades')).toBe('—');
  });

  it('matches the native footer row labels and per-row 10–50% color tint rules', () => {
    const colors = { background: '#111111', axisText: '#eeeeee', buy: '#55aa66', sell: '#dd5555' };
    expect(FOOTPRINT_TOTALS_ROW_LABELS).toMatchObject({
      volume: 'Total Volume', bidVolume: 'Total Bid Volume', askVolume: 'Total Ask Volume', cvd: 'Cumulative Delta',
    });
    expect(footprintTotalsCellColor('volume', 5, 10, colors)).toBe('rgb(83, 83, 83)');
    expect(footprintTotalsCellColor('bidVolume', 8, 8, colors)).toBe('rgb(119, 51, 51)');
    expect(footprintTotalsCellColor('askVolume', -4, 4, colors)).toBe('rgb(51, 94, 60)');
    expect(footprintTotalsCellColor('delta', 2, 4, colors)).toBe('rgb(37, 63, 43)');
    expect(footprintTotalsCellColor('delta', -2, 4, colors)).toBe('rgb(78, 37, 37)');
    expect(blendFootprintTotalsColor('#111111', '#eeeeee', .09)).toBe('rgb(37, 37, 37)');
    expect(footprintTotalsRowMax([stats, { ...stats, time: 120, volume: 32 }], 'volume')).toBe(32);
  });

  it('draws selected rows at the host candle time index and provides matching crosshair values', () => {
    const pane = new FootprintTotalsPane('totals');
    const requestUpdate = vi.fn(); pane.attached({ requestUpdate } as any);
    pane.setSettings(['volume', 'delta', 'trades'], 'btc'); pane.setStats([stats]);
    const labels: Array<{ text: string; x: number; y: number }> = [];
    const cells: Array<{ x: number; y: number; width: number; height: number; color: string }> = [];
    let fillStyle = '';
    const ctx: any = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(x: number, y: number, width: number, height: number) { cells.push({ x, y, width, height, color: fillStyle }); }, moveTo() {}, lineTo() {}, stroke() {},
      fillText(text: string, x: number, y: number) { labels.push({ text, x, y }); },
      measureText(text: string) { return { width: text.length * 5 }; },
      set fillStyle(value: string) { fillStyle = value; }, set globalAlpha(_value: number) {}, set font(_value: string) {},
      set textBaseline(_value: string) {}, set textAlign(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
    };
    pane.draw(ctx, {
      dpr: 1,
      theme: { background: '#111111', axisText: '#eeeeee', grid: '#333333', upColor: '#55aa66', downColor: '#dd5555' },
      plotWidth: 300, plotHeight: 100,
      dataLayer: { timeToIndex: (time: number) => time === stats.time ? 2 : undefined },
      timeScale: { barSpacing: 24, indexToX: (index: number) => index * 24 + 154 },
    } as any);
    expect(labels).toContainEqual({ text: '12.3', x: 202, y: 37.5 });
    expect(labels).toContainEqual({ text: 'Total Volume', x: 5, y: 37.5 });
    expect(cells).toContainEqual({ x: 190, y: 31, width: 23, height: 14, color: 'rgb(128, 128, 128)' });
    expect(pane.tooltip(60)).toContain('Total Volume  12.3');
    expect(pane.tooltip(60)).toContain('Delta  -3.65');
    expect(pane.tooltip(60)).toContain('Trades  —');
    expect(pane.tooltip(61)).toBeNull();
    expect(pane.diagnostics()).toMatchObject({ mounted: true, rows: ['volume', 'delta', 'trades'], units: 'btc', statsBars: 1 });
    expect(requestUpdate).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { FootprintBarStats } from 'openalgo-charts/profile';
import { FootprintTotalsPane, footprintStatText } from '../src/chart/footprint-totals';

const stats: FootprintBarStats = {
  time: 60, volume: 12.345, bidVolume: 8, askVolume: 4.345, delta: -3.655,
  minDelta: -4, maxDelta: 0, deltaPct: -29.6, cvd: -22, trades: null,
  poc: 42_500, vah: 42_600, val: 42_400,
};

describe('Footprint Totals pane', () => {
  it('formats the same Footprint stats values and retains unknown row values as unavailable', () => {
    expect(footprintStatText(stats, 'volume')).toBe('12.3');
    expect(footprintStatText(stats, 'delta')).toBe('-3.65');
    expect(footprintStatText(stats, 'deltaPct')).toBe('-29.6%');
    expect(footprintStatText(stats, 'trades')).toBe('—');
  });

  it('draws selected rows at the host candle time index and provides matching crosshair values', () => {
    const pane = new FootprintTotalsPane('totals');
    const requestUpdate = vi.fn(); pane.attached({ requestUpdate } as any);
    pane.setSettings(['volume', 'delta', 'trades'], 'btc'); pane.setStats([stats]);
    const labels: Array<{ text: string; x: number; y: number }> = [];
    const ctx: any = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillText(text: string, x: number, y: number) { labels.push({ text, x, y }); },
      set fillStyle(_value: string) {}, set globalAlpha(_value: number) {}, set font(_value: string) {},
      set textBaseline(_value: string) {}, set textAlign(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
    };
    pane.draw(ctx, {
      dpr: 1,
      theme: { background: '#111111', axisText: '#eeeeee', grid: '#333333', upColor: '#55aa66', downColor: '#dd5555' },
      plotWidth: 300, plotHeight: 100,
      dataLayer: { timeToIndex: (time: number) => time === stats.time ? 2 : undefined },
      timeScale: { barSpacing: 24, indexToX: (index: number) => index * 24 + 10 },
    } as any);
    expect(labels).toContainEqual({ text: '12.3', x: 58, y: expect.any(Number) });
    expect(pane.tooltip(60)).toContain('Volume  12.3');
    expect(pane.tooltip(60)).toContain('Delta  -3.65');
    expect(pane.tooltip(60)).toContain('Trades  —');
    expect(pane.tooltip(61)).toBeNull();
    expect(pane.diagnostics()).toMatchObject({ mounted: true, rows: ['volume', 'delta', 'trades'], units: 'btc', statsBars: 1 });
    expect(requestUpdate).toHaveBeenCalled();
  });
});

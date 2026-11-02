import { describe, expect, it } from 'vitest';
import type { HitContext } from 'openalgo-charts/draw';
import { measureDrawingDistance } from '../src/chart/drawing-measure-hit';

const context = (pts: HitContext['pts'], dpr = 1) => ({ pts, rc: { dpr } } as HitContext);
describe('measure hit areas match the native painted spans', () => {
  it.each([1, 2])('hits a zero-price measure along its visible 60px line at DPR %s', dpr => {
    const hit = context([{ x: 100, y: 200 }, { x: 100, y: 200 }], dpr);
    expect(measureDrawingDistance('price-range', 135, 200, hit)).toBe(0);
    expect(measureDrawingDistance('price-range', 160, 200, hit)).toBe(0);
    expect(measureDrawingDistance('price-range', 180, 200, hit)).toBe(20);
  });
  it('hits a zero-time measure along its visible 40px line', () => {
    const hit = context([{ x: 100, y: 200 }, { x: 100, y: 200 }]);
    expect(measureDrawingDistance('date-range', 100, 225, hit)).toBe(0);
    expect(measureDrawingDistance('date-range', 100, 260, hit)).toBe(20);
  });
  it('preserves filled expanded regions in either anchor direction', () => {
    for (const pts of [[{ x: 100, y: 200 }, { x: 200, y: 300 }], [{ x: 200, y: 300 }, { x: 100, y: 200 }]]) {
      for (const tool of ['price-range', 'date-range'] as const) {
        expect(measureDrawingDistance(tool, 150, 250, context(pts))).toBe(0);
        expect(measureDrawingDistance(tool, 220, 250, context(pts))).toBe(20);
      }
    }
  });
});

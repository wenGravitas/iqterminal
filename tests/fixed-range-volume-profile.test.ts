import { expect, test } from 'vitest';
import { fixedProfile } from '../src/chart/fixed-range-volume-profile';
const bars = [{ time: 10, open: 100, high: 102, low: 100, close: 101, volume: 30 }, { time: 20, open: 101, high: 101, low: 101, close: 101, volume: 20 }];
test('fixed chart buckets conserve volume, include range endpoints and grow value area from POC', () => {
  const p = fixedProfile(bars, 20, 10, 1);
  expect(p.rows.map(r => r.volume)).toEqual([10, 30, 10]);
  expect(p.total).toBe(50); expect(p.rows.reduce((n, r) => n + r.volume, 0)).toBe(50);
  expect([p.poc, p.val, p.vah]).toEqual([1, 0, 1]);
  expect(p.partial).toBe(false);
  expect(fixedProfile(bars, 10, 10, 1).total).toBe(30);
});
test('price rows stay on chart ticks, with decimal-boundary tolerance and changing price steps', () => {
  const sample = [{ ...bars[0]!, low: .3, high: .5, volume: 30 }];
  const p = fixedProfile(sample, 10, 10, .1);
  expect(p.rows).toHaveLength(3);
  expect(p.rows.map(r => r.volume)).toEqual([10, 10, 10]);
  expect(fixedProfile(sample, 10, 10, .01).rows).toHaveLength(21);
});
test('missing history and volume stay explicit, and oversized tick ranges remain bounded', () => {
  expect(fixedProfile(bars, 0, 30, 1).partial).toBe(true);
  expect(fixedProfile([{ ...bars[0]!, volume: undefined }], 10, 10, 1).status).toContain('No volume');
  expect(fixedProfile(bars, 10, 20, .000001).status).toContain('100,000');
  expect(fixedProfile([], 10, 20, .1).rows).toEqual([]);
});
test('forming candle and historical corrections replace the volume estimate', () => {
  expect(fixedProfile([{ ...bars[0]!, volume: 60 }, bars[1]!], 10, 20, 1).total).toBe(80);
  expect(fixedProfile(bars, 10, 20, 0).rows).toEqual([]);
});

import { describe, expect, it } from 'vitest';
import { fullWindowSma, fullWindowSmaTail } from '../src/scripts/composition';

describe('composition SMA numerical contract', () => {
  it('uses the declared numeric source values rather than candle-price magnitude', () => {
    const volumeBtc = [0.004, 0.006, 0.008, 0.01, 0.012];
    const values = fullWindowSma(volumeBtc, 3);
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBeCloseTo(0.006, 12);
    expect(values[3]).toBeCloseTo(0.008, 12);
    expect(values[4]).toBeCloseTo(0.01, 12);
  });

  it('requires a complete contiguous window and breaks across nulls', () => {
    expect(fullWindowSma([2, 4, 6, null, 8, 10, 12], 3)).toEqual([null, null, 4, null, null, null, 10]);
  });

  it('replaces the forming value in place and recomputes bounded historical corrections deterministically', () => {
    const initial = [10, 20, 30, 40, 50];
    const formingReplacement = [10, 20, 30, 40, 80];
    expect(fullWindowSma(initial, 3)).toEqual([null, null, 20, 30, 40]);
    expect(fullWindowSma(formingReplacement, 3)).toEqual([null, null, 20, 30, 50]);

    const corrected = [10, 20, 90, 40, 50];
    const recalculated = fullWindowSma(corrected, 3);
    expect(recalculated).toEqual([null, null, 40, 50, 60]);
    expect(fullWindowSmaTail(corrected, 3, 2)).toEqual(recalculated.slice(2));
    expect(fullWindowSmaTail(corrected, 3, 5)).toEqual([]);
  });
});

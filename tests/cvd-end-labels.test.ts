import { describe, expect, it } from 'vitest';
import { cvdEndLabels, cvdLabelGutterWidth } from '../src/chart/cvd-end-labels';
import type { CvdLine } from '../src/chart/cvd-model';
const line = (id: string, value: number | null, partial = false): CvdLine => ({ id, name: id === 'total' ? 'Total' : id,
  filtered: false, points: [{ time: 60000, period: 0, value, partial }] });
describe('CVD end labels', () => {
  it('uses only current finite points, respects hidden lines, and keeps partial units explicit', () => {
    const { rows } = cvdEndLabels([line('total', 50, true), line('binance:spot', -10), line('gap', null), line('hidden', 2), line('invalid', NaN)], ['hidden'], 'BTC', 200, value => 100 - value);
    expect(rows.map(row => row.id)).toEqual(['total', 'binance:spot']);
    expect(rows[0]).toMatchObject({ text: '+50 BTC*', partial: true, direction: 'up' });
    expect(rows[1]).toMatchObject({ name: 'BN[S]', direction: 'down' });
    expect(cvdEndLabels([line('total', 0)], [], 'USDT', 100, () => 50).rows[0]).toMatchObject({ text: '0 USDT', direction: 'equal' });
  });
  it('separates collisions, clamps to the pane, and bounds crowded labels', () => {
    const labels = cvdEndLabels([line('total', 1), line('one', 1), line('two', 1)], [], 'BTC', 100, () => 99);
    for (let index = 0; index < labels.rows.length; index++) {
      expect(labels.rows[index]!.y).toBeGreaterThanOrEqual(7);
      expect(labels.rows[index]!.y).toBeLessThanOrEqual(93);
      if (index) expect(labels.rows[index]!.y - labels.rows[index - 1]!.y).toBeGreaterThanOrEqual(14);
    }
    expect(cvdEndLabels([line('total', 1), line('one', 2), line('two', 3)], [], 'BTC', 28, () => 1).omitted).toBe(1);
  });
  it('leaves a usable shared timeline and bounds the reserved strip', () => {
    expect(cvdLabelGutterWidth(1000)).toBe(148);
    expect(cvdLabelGutterWidth(300)).toBe(88);
    expect(cvdLabelGutterWidth(100)).toBe(20);
    expect(cvdLabelGutterWidth(50)).toBe(0);
  });
});

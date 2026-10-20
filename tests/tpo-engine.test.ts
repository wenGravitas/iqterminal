import { describe, expect, it } from 'vitest';
import {
  calculateNakedLevels, calculateTpoSession, DAY_MS, DEFAULT_TPO_SETTINGS, MINUTE_MS,
  tpoBracketLabel, type TpoMinute, type TpoSession,
} from '../src/indicators/tpo-engine';

const day = Date.UTC(2026, 9, 19);
const bar = (time: number, low: number, high = low, revision = 1): TpoMinute => ({ time, open: low, low, high, close: high, revision, closed: true });
const settings = (patch: Partial<typeof DEFAULT_TPO_SETTINGS> = {}) => ({ ...DEFAULT_TPO_SETTINGS, tickSize: 1, rowTicks: 1, ...patch });

describe('UTC TPO engine', () => {
  it('anchors sessions at UTC midnight and keeps the next midnight out of the prior session', () => {
    const session = calculateTpoSession(day, [bar(day - MINUTE_MS, 10), bar(day, 20), bar(day + DAY_MS - MINUTE_MS, 30), bar(day + DAY_MS, 40)], settings());
    expect(session).not.toBeNull();
    expect(session).toMatchObject({ day, observedMinutes: 2, expectedMinutes: 1_440, gaps: 1_438, complete: false });
    expect(session!.rows.flatMap(row => row.brackets)).toEqual([0, 47]);
  });

  it('gives each bracket one TPO per touched row and adapts automatic rows to extreme spans', () => {
    const session = calculateTpoSession(day, [
      bar(day, 100, 102), bar(day + MINUTE_MS, 101, 102),
      bar(day + 30 * MINUTE_MS, 102, 104),
    ], settings({ bracketMinutes: 30, rowTicks: 'auto' }));
    expect(session!.bracketCount).toBe(48);
    expect(session!.rows.every(row => row.count === new Set(row.brackets).size)).toBe(true);
    expect(session!.rows.length).toBeLessThanOrEqual(96);
    expect(session!.rows.reduce((sum, row) => sum + row.count, 0)).toBe(6);
  });

  it('quantizes prices onto exchange ticks and honors a manual multi-tick row size', () => {
    const session = calculateTpoSession(day, [bar(day, 100.01, 100.31)], settings({ tickSize: 0.1, rowTicks: 2, bracketMinutes: 60 }));
    expect(session!.rowTicks).toBe(2);
    expect(session!.rows.map(row => row.firstTick)).toEqual([1000, 1002, 1004]);
    expect(session!.bracketCount).toBe(24);
  });

  it('selects POC by max count, then closest to profile midpoint, then lower price', () => {
    const session = calculateTpoSession(day, [bar(day, 100), bar(day + 60 * MINUTE_MS, 103)], settings({ bracketMinutes: 60, valueAreaPercent: 50 }));
    expect(session!.rows.map(row => row.firstTick)).toEqual([100, 101, 102, 103]);
    expect(session!.poc).toBe(100);
  });

  it('expands a tied value area downward and includes adjacent occupied rows until the percentage is met', () => {
    const session = calculateTpoSession(day, [bar(day, 100), bar(day + 30 * MINUTE_MS, 102), bar(day + 60 * MINUTE_MS, 104)], settings({ valueAreaPercent: 50 }));
    expect(session!.poc).toBe(102);
    expect(session!.val).toBe(100);
    expect(session!.vah).toBe(103);
    expect(session!.rows.filter(row => row.count === 0).map(row => row.firstTick)).toEqual([101, 103]);
  });

  it('reports incomplete opening range and initial balance rather than filling missing minutes', () => {
    const session = calculateTpoSession(day, [bar(day, 100, 102), bar(day + 29 * MINUTE_MS, 99, 103), bar(day + 59 * MINUTE_MS, 98, 104)], settings());
    expect(session!.openingRange).toMatchObject({ high: 103, low: 99, observedMinutes: 2, expectedMinutes: 30, complete: false });
    expect(session!.initialBalance).toMatchObject({ high: 104, low: 98, observedMinutes: 3, expectedMinutes: 60, complete: false });
    expect(session).toMatchObject({ elapsedMinutes: 60, expectedMinutes: 60, futureMinutes: 1_380, gaps: 57 });
  });

  it('separates elapsed gaps from future minutes while a UTC day and OR are developing', () => {
    const asOf = day + 10 * MINUTE_MS;
    const session = calculateTpoSession(day, [bar(day, 100), bar(day + 9 * MINUTE_MS, 102)], settings(), asOf);
    expect(session).toMatchObject({ elapsedMinutes: 10, expectedMinutes: 10, missingMinutes: 8, futureMinutes: 1_430, complete: false });
    expect(session!.openingRange).toMatchObject({ windowMinutes: 30, elapsedMinutes: 10, observedMinutes: 2, expectedMinutes: 10, missingMinutes: 8, futureMinutes: 20, complete: false });
  });

  it('bounds pathological manual row counts and exposes the effective row size', () => {
    const session = calculateTpoSession(day, [bar(day, 1, 1_000_000)], settings({ rowTicks: 1 }));
    expect(session!.capacityLimited).toBe(true);
    expect(session!.requestedRowTicks).toBe(1);
    expect(session!.rowTicks).toBeGreaterThan(1);
    expect(session!.rows.length).toBeLessThanOrEqual(2_048);
  });

  it('labels 30-minute brackets through X then a-x, and disambiguates further cycles', () => {
    expect(tpoBracketLabel(0)).toBe('A');
    expect(tpoBracketLabel(23)).toBe('X');
    expect(tpoBracketLabel(24)).toBe('a');
    expect(tpoBracketLabel(47)).toBe('x');
    expect(tpoBracketLabel(48)).toBe('A2');
    expect(tpoBracketLabel(95)).toBe('x2');
  });
});

const nakedSession = (patch: Partial<TpoSession> = {}): TpoSession => ({
  day, bracketMinutes: 30, bracketCount: 48, rowTicks: 1, requestedRowTicks: 1, capacityLimited: false, tickSize: 1, rows: [],
  poc: 100, vah: 102, val: 98, totalTpos: 3, valueAreaPercent: 70,
  openingRange: null, initialBalance: null, observedMinutes: 1_440,
  elapsedMinutes: 1_440, missingMinutes: 0, expectedMinutes: 1_440, futureMinutes: 0,
  gaps: 0, firstObserved: day, lastObserved: day + DAY_MS - MINUTE_MS, complete: true, ...patch,
});

describe('naked TPO levels', () => {
  it('ignores touches on the origin day, records first touch, and retains the current coverage end', () => {
    const end = day + DAY_MS;
    const levels = calculateNakedLevels([nakedSession()], [
      bar(day, 98, 102), // Origin-session candle must not test its own levels.
      bar(end, 90, 91), bar(end + MINUTE_MS, 99, 101), bar(end + 2 * MINUTE_MS, 101, 103),
    ], end + 3 * MINUTE_MS);
    expect(levels.find(level => level.kind === 'POC')).toMatchObject({ state: 'tested', firstTouch: end + MINUTE_MS, to: end + 3 * MINUTE_MS, missingMinutes: 0 });
    expect(levels.find(level => level.kind === 'VAH')).toMatchObject({ state: 'tested', firstTouch: end + 2 * MINUTE_MS, to: end + 3 * MINUTE_MS });
    expect(levels.find(level => level.kind === 'VAL')).toMatchObject({ state: 'active', firstTouch: null, to: end + 3 * MINUTE_MS });
  });

  it('marks a candidate unknown when a gap could hide an earlier touch', () => {
    const end = day + DAY_MS;
    const levels = calculateNakedLevels([nakedSession()], [bar(end, 90, 91), bar(end + 2 * MINUTE_MS, 99, 101)], end + 3 * MINUTE_MS);
    expect(levels.find(level => level.kind === 'POC')).toMatchObject({ state: 'unknown', firstTouch: end + 2 * MINUTE_MS, missingMinutes: 1 });
  });

  it('keeps tested state unknown across a gap even when a later candle touches', () => {
    const end = day + DAY_MS;
    const levels = calculateNakedLevels([nakedSession()], [bar(end, 90, 91), bar(end + MINUTE_MS, 99, 101)], end + 2 * MINUTE_MS);
    expect(levels.find(level => level.kind === 'POC')!.state).toBe('tested');
    const missing = calculateNakedLevels([nakedSession()], [bar(end, 90, 91), bar(end + 2 * MINUTE_MS, 99, 101)], end + 3 * MINUTE_MS);
    expect(missing.find(level => level.kind === 'POC')!.state).toBe('unknown');
  });

  it('does not create levels from unfinished profiles or touch them on their origin session', () => {
    const end = day + DAY_MS;
    const incomplete = nakedSession({ complete: false });
    expect(calculateNakedLevels([incomplete], [bar(day, 98, 102), bar(end, 98, 102)], end + MINUTE_MS)).toEqual([]);
  });
});

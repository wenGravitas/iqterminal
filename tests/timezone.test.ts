import { describe, expect, it } from 'vitest';
import {
  TIMEZONE_STORAGE_KEY, detectLocalTimezone, formatCalendarDate, formatClockTime, formatCompactZoneLabel, formatDateTime, formatZoneOffset, loadTimezonePreference,
  formatTickerTime, parseTimezonePreference, resolveTimezone, saveTimezonePreference,
} from '../src/timezone';

describe('Market Pulse display-zone preference', () => {
  it('defaults to detected Local and validates corrupted or unavailable values', () => {
    expect(parseTimezonePreference('local')).toBe('local');
    expect(parseTimezonePreference('UTC')).toBe('UTC');
    expect(parseTimezonePreference('America/New_York')).toBeNull();
    expect(loadTimezonePreference(() => null)).toBe('local');
    expect(loadTimezonePreference(() => 'broken')).toBe('local');
    expect(loadTimezonePreference(() => { throw new Error('blocked'); })).toBe('local');
    expect(resolveTimezone('local', 'America/New_York')).toBe('America/New_York');
    expect(resolveTimezone('UTC', 'America/New_York')).toBe('UTC');
    expect(resolveTimezone('local', 'not/a-zone')).toBe('UTC');
    expect(detectLocalTimezone().length).toBeGreaterThan(0);
  });

  it('persists outside the workspace layout and formats existing instants in the selected zone', () => {
    let key = '', value = '';
    expect(saveTimezonePreference('UTC', (nextKey, nextValue) => { key = nextKey; value = nextValue; })).toBe(true);
    expect(key).toBe(TIMEZONE_STORAGE_KEY); expect(value).toBe('UTC');
    expect(saveTimezonePreference('local', () => { throw new Error('blocked'); })).toBe(false);
    const instant = Date.parse('2026-07-01T12:00:00.000Z');
    expect(formatClockTime(instant, 'UTC')).toBe('12:00:00');
    expect(formatClockTime(instant, 'America/New_York')).toBe('08:00:00');
    expect(formatDateTime(instant, 'Australia/Sydney')).toContain('22:00');
    expect(formatZoneOffset(instant, 'UTC')).toBe('UTC+00:00');
    expect(formatZoneOffset(instant, 'America/New_York')).toBe('UTC−04:00');
    expect(formatCalendarDate(instant, 'America/New_York')).toContain('Wed, 01 Jul 2026');
    expect(formatCompactZoneLabel(instant, 'local', 'America/New_York')).toBe('EDT');
    expect(formatCompactZoneLabel(instant, 'local', 'Asia/Kolkata')).toBe('UTC+05:30');
    expect(formatCompactZoneLabel(instant, 'UTC', 'America/New_York')).toBe('UTC');
    expect(formatTickerTime(instant + 123, 'UTC')).toBe('12:00:00.123');
    expect(formatTickerTime(instant + 123, 'America/New_York')).toBe('08:00:00.123');
  });
});

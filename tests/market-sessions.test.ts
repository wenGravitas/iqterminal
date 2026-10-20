import { describe, expect, it } from 'vitest';
import {
  CALENDAR_COVERAGE, MARKET_ORDER, buildSessionSchedule, formatCountdown, statusAt, timelineTicks, timelineWindow,
} from '../src/market-sessions';
import { formatClockTime } from '../src/timezone';

const at = (value: string) => Date.parse(value);
const schedule = (from: string, through: string) => buildSessionSchedule(at(from), at(through));

describe('Market Pulse session calendars', () => {
  it('uses explicit annual holiday coverage and reports weekdays outside it as unknown', () => {
    expect(CALENDAR_COVERAGE).toEqual({ from: 2026, through: 2027 });
    expect(MARKET_ORDER).toEqual(['nyse', 'lse', 'tse', 'asx', 'cme-btc', 'crypto']);
    const plan = schedule('2028-01-03T00:00:00Z', '2028-01-04T00:00:00Z');
    const status = statusAt(plan, 'nyse', at('2028-01-03T15:00:00Z'));
    expect(status.state).toBe('unknown'); expect(status.reason).toContain('2028');
  });

  it('converts New York, London, and Sydney session hours through their DST changes', () => {
    const nySpring = schedule('2026-03-09T12:00:00Z', '2026-03-09T21:00:00Z').nyse;
    expect(nySpring.find(v => v.kind === 'open')?.startMs).toBe(at('2026-03-09T13:30:00Z'));
    const londonSpring = schedule('2026-03-30T06:00:00Z', '2026-03-30T17:00:00Z').lse;
    expect(londonSpring.find(v => v.kind === 'open')?.startMs).toBe(at('2026-03-30T07:00:00Z'));
    const sydneySummer = schedule('2026-01-04T22:00:00Z', '2026-01-05T08:00:00Z').asx;
    expect(sydneySummer.find(v => v.kind === 'open')?.startMs).toBe(at('2026-01-04T23:00:00Z'));
    const sydneyWinter = schedule('2026-07-05T22:00:00Z', '2026-07-06T08:00:00Z').asx;
    expect(sydneyWinter.find(v => v.kind === 'open')?.startMs).toBe(at('2026-07-06T00:00:00Z'));
  });

  it('closes NYSE and LSE for listed holidays, applies early closes, and counts the next opening', () => {
    const thanksgiving = schedule('2026-11-26T13:00:00Z', '2026-12-01T12:00:00Z');
    const closed = statusAt(thanksgiving, 'nyse', at('2026-11-26T15:00:00Z'));
    expect(closed.state).toBe('closed'); expect(closed.reason).toBe('Thanksgiving Day');

    const early = statusAt(thanksgiving, 'nyse', at('2026-11-27T18:10:00Z'));
    expect(early.state).toBe('closed'); expect(early.reason).toContain('early close');
    expect(early.transitionAt).toBe(at('2026-11-30T14:30:00Z')); expect(early.transition).toBe('opens');

    const london = schedule('2026-12-24T07:00:00Z', '2026-12-29T17:00:00Z');
    expect(london.lse.find(v => v.tradeDate === '2026-12-24')?.endMs).toBe(at('2026-12-24T12:30:00Z'));
    expect(statusAt(london, 'lse', at('2026-12-25T10:00:00Z')).reason).toBe('Christmas Day');
  });

  it('models Tokyo lunch as two intervals and applies JPX cash-market holidays', () => {
    const plan = schedule('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z');
    const sessions = plan.tse.filter(v => v.tradeDate === '2026-10-20' && v.kind === 'open');
    expect(sessions.map(v => [v.startMs, v.endMs])).toEqual([
      [at('2026-10-20T00:00:00Z'), at('2026-10-20T02:30:00Z')],
      [at('2026-10-20T03:30:00Z'), at('2026-10-20T06:30:00Z')],
    ]);
    expect(statusAt(plan, 'tse', at('2026-10-20T03:00:00Z'))).toMatchObject({ state: 'closed', reason: 'Scheduled lunch break', transitionAt: at('2026-10-20T03:30:00Z') });
    const holiday = schedule('2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(statusAt(holiday, 'tse', at('2026-11-23T04:00:00Z'))).toMatchObject({ state: 'closed', reason: 'Labor Thanksgiving Day' });
  });

  it('applies ASX early close dates and preserves weekend closures', () => {
    const plan = schedule('2026-12-24T00:00:00Z', '2026-12-29T12:00:00Z');
    expect(plan.asx.find(v => v.tradeDate === '2026-12-24')?.endMs).toBe(at('2026-12-24T03:10:00Z'));
    expect(statusAt(plan, 'asx', at('2026-12-24T03:15:00Z')).reason).toContain('early close');
    expect(statusAt(plan, 'asx', at('2026-12-26T02:00:00Z'))).toMatchObject({ state: 'closed', reason: 'Weekend' });
  });

  it('shows CME Bitcoin maintenance and crypto 24/7 as separate schedules', () => {
    const plan = schedule('2026-10-23T00:00:00Z', '2026-10-25T12:00:00Z');
    expect(plan['cme-btc'].some(v => v.kind === 'maintenance' && v.startMs === at('2026-10-24T07:00:00Z') && v.endMs === at('2026-10-24T09:00:00Z'))).toBe(true);
    expect(statusAt(plan, 'cme-btc', at('2026-10-24T07:30:00Z'))).toMatchObject({ state: 'closed', transition: 'resumes', transitionAt: at('2026-10-24T09:00:00Z') });
    expect(statusAt(plan, 'cme-btc', at('2026-10-24T09:00:00Z')).state).toBe('active');
    expect(statusAt(plan, 'crypto', at('2026-10-24T07:30:00Z'))).toMatchObject({ state: 'active', transitionAt: null });
  });

  it('treats the CME 24/7 regime start as a real boundary and keeps future unknown calendars unconfirmed', () => {
    const launch = schedule('2026-05-29T20:00:00Z', '2026-06-01T12:00:00Z');
    expect(statusAt(launch, 'cme-btc', at('2026-05-29T20:59:00Z'))).toMatchObject({ state: 'unknown', reason: expect.stringContaining('29 May 2026') });
    expect(statusAt(launch, 'cme-btc', at('2026-05-29T21:01:00Z'))).toMatchObject({ state: 'closed', transition: 'resumes', transitionAt: at('2026-05-29T21:02:00Z') });
    expect(statusAt(launch, 'cme-btc', at('2026-05-29T21:03:00Z'))).toMatchObject({ state: 'active', transition: 'maintenance' });

    const weekend = schedule('2027-12-31T20:00:00Z', '2028-01-05T12:00:00Z');
    expect(statusAt(weekend, 'nyse', at('2028-01-01T16:00:00Z'))).toMatchObject({
      state: 'closed', reason: expect.stringContaining('Weekend'), transition: 'unknown', transitionAt: at('2028-01-03T05:00:00Z'),
    });
    expect(statusAt(weekend, 'nyse', at('2028-01-03T15:00:00Z'))).toMatchObject({ state: 'unknown', reason: expect.stringContaining('2028') });
  });

  it('keeps a rolling timeline at 24 elapsed hours and lets selected-zone hourly ticks skip or repeat at DST', () => {
    const springNow = at('2026-03-08T06:30:00Z');
    const spring = timelineWindow(springNow, 'America/New_York');
    expect(spring.endMs - spring.startMs).toBe(86_400_000);
    expect(springNow - spring.startMs).toBeGreaterThan(12 * 3_600_000);
    expect(springNow - spring.startMs).toBeLessThan(13 * 3_600_000);
    expect(spring.nextRollMs).toBeGreaterThan(springNow);
    expect(spring.nextRollMs).toBeLessThanOrEqual(springNow + 3_600_000);
    const springHours = timelineTicks(spring.startMs, spring.endMs, 1).map(ms => formatClockTime(ms, 'America/New_York'));
    expect(springHours).toContain('01:00:00'); expect(springHours).not.toContain('02:00:00'); expect(springHours).toContain('03:00:00');

    const fallNow = at('2026-11-01T05:30:00Z');
    const fall = timelineWindow(fallNow, 'America/New_York');
    expect(fall.endMs - fall.startMs).toBe(86_400_000);
    expect(fallNow - fall.startMs).toBeGreaterThan(12 * 3_600_000);
    expect(fallNow - fall.startMs).toBeLessThan(13 * 3_600_000);
    const fallHours = timelineTicks(fall.startMs, fall.endMs, 1).map(ms => formatClockTime(ms, 'America/New_York'));
    expect(fallHours.filter(value => value === '01:00:00')).toHaveLength(2);
  });

  it('formats next-transition countdowns from fixed instants', () => {
    const now = at('2026-10-20T10:00:00Z');
    expect(formatCountdown(at('2026-10-20T12:03:40Z'), now)).toBe('2h 03m');
    expect(formatCountdown(at('2026-10-21T12:00:00Z'), now)).toBe('1d 02h');
    expect(formatCountdown(now, now)).toBe('0s');
  });
});

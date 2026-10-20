export type MarketId = 'crypto' | 'cme-btc' | 'nyse' | 'lse' | 'tse' | 'asx';
export type SessionState = 'active' | 'closed' | 'unknown';
export type IntervalKind = 'open' | 'maintenance' | 'unknown';

export interface MarketInterval {
  market: MarketId;
  startMs: number;
  endMs: number;
  kind: IntervalKind;
  label: string;
  reason?: string;
  tradeDate?: string;
}

export interface MarketStatus {
  market: MarketId;
  state: SessionState;
  reason: string;
  transitionAt: number | null;
  transition: 'opens' | 'closes' | 'resumes' | 'maintenance' | 'unknown' | null;
  zone: string;
}

export const CALENDAR_COVERAGE = Object.freeze({ from: 2026, through: 2027 });

interface Segment { start: string; end: string; label: string }
interface CashMarket {
  id: Exclude<MarketId, 'crypto' | 'cme-btc'>;
  name: string;
  short: string;
  zone: string;
  weekdays: readonly number[];
  segments: readonly Segment[];
  holidays: Readonly<Record<string, string>>;
  earlyClose: Readonly<Record<string, { time: string; reason: string }>>;
}

const NYSE: CashMarket = {
  id: 'nyse', name: 'NYSE', short: 'NYSE', zone: 'America/New_York', weekdays: [1, 2, 3, 4, 5],
  segments: [{ start: '09:30', end: '16:00', label: 'Core' }],
  holidays: {
    '2026-01-01': 'New Year’s Day', '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': 'Washington’s Birthday',
    '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day observed',
    '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
    '2027-01-01': 'New Year’s Day', '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': 'Washington’s Birthday',
    '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth observed', '2027-07-05': 'Independence Day observed',
    '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day observed',
  },
  earlyClose: {
    '2026-11-27': { time: '13:00', reason: 'Day after Thanksgiving · early close' },
    '2026-12-24': { time: '13:00', reason: 'Christmas Eve · early close' },
    '2027-11-26': { time: '13:00', reason: 'Day after Thanksgiving · early close' },
  },
};

const LSE: CashMarket = {
  id: 'lse', name: 'London Stock Exchange', short: 'LSE', zone: 'Europe/London', weekdays: [1, 2, 3, 4, 5],
  segments: [{ start: '08:00', end: '16:30', label: 'SETS' }],
  holidays: {
    '2026-01-01': 'New Year’s Day', '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday', '2026-05-04': 'Early May bank holiday',
    '2026-05-25': 'Spring bank holiday', '2026-08-31': 'Summer bank holiday', '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day substitute',
    '2027-01-01': 'New Year’s Day', '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-05-03': 'Early May bank holiday',
    '2027-05-31': 'Spring bank holiday', '2027-08-30': 'Summer bank holiday', '2027-12-27': 'Christmas Day substitute', '2027-12-28': 'Boxing Day substitute',
  },
  earlyClose: {
    '2026-12-24': { time: '12:30', reason: 'Christmas Eve · early close' },
    '2026-12-31': { time: '12:30', reason: 'Year-end · early close' },
    '2027-12-24': { time: '12:30', reason: 'Christmas Eve · early close' },
    '2027-12-31': { time: '12:30', reason: 'Year-end · early close' },
  },
};

const TSE: CashMarket = {
  id: 'tse', name: 'Tokyo Stock Exchange', short: 'TSE', zone: 'Asia/Tokyo', weekdays: [1, 2, 3, 4, 5],
  segments: [{ start: '09:00', end: '11:30', label: 'Morning' }, { start: '12:30', end: '15:30', label: 'Afternoon' }],
  holidays: {
    '2026-01-01': 'New Year’s Day', '2026-01-02': 'Market holiday', '2026-01-03': 'Market holiday', '2026-01-12': 'Coming of Age Day',
    '2026-02-11': 'National Foundation Day', '2026-02-23': 'Emperor’s Birthday', '2026-03-20': 'Vernal Equinox', '2026-04-29': 'Showa Day',
    '2026-05-04': 'Greenery Day', '2026-05-05': 'Children’s Day', '2026-05-06': 'Constitution Day observed', '2026-07-20': 'Marine Day',
    '2026-08-11': 'Mountain Day', '2026-09-21': 'Respect for the Aged Day', '2026-09-22': 'National holiday', '2026-09-23': 'Autumnal Equinox',
    '2026-10-12': 'Sports Day', '2026-11-03': 'Culture Day', '2026-11-23': 'Labor Thanksgiving Day', '2026-12-31': 'Market holiday',
    '2027-01-01': 'New Year’s Day', '2027-01-02': 'Market holiday', '2027-01-03': 'Market holiday', '2027-01-11': 'Coming of Age Day',
    '2027-02-11': 'National Foundation Day', '2027-02-23': 'Emperor’s Birthday', '2027-03-22': 'Vernal Equinox observed', '2027-04-29': 'Showa Day',
    '2027-05-03': 'Constitution Memorial Day', '2027-05-04': 'Greenery Day', '2027-05-05': 'Children’s Day', '2027-07-19': 'Marine Day',
    '2027-08-11': 'Mountain Day', '2027-09-20': 'Respect for the Aged Day', '2027-09-23': 'Autumnal Equinox', '2027-10-11': 'Sports Day',
    '2027-11-03': 'Culture Day', '2027-11-23': 'Labor Thanksgiving Day', '2027-12-31': 'Market holiday',
  },
  earlyClose: {},
};

const ASX: CashMarket = {
  id: 'asx', name: 'ASX cash market', short: 'ASX', zone: 'Australia/Sydney', weekdays: [1, 2, 3, 4, 5],
  segments: [{ start: '10:00', end: '16:00', label: 'Cash' }],
  holidays: {
    '2026-01-01': 'New Year’s Day', '2026-01-26': 'Australia Day', '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday',
    '2026-06-08': 'King’s Birthday', '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day observed',
    '2027-01-01': 'New Year’s Day', '2027-01-26': 'Australia Day', '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday',
    '2027-06-14': 'King’s Birthday', '2027-12-27': 'Christmas Day observed', '2027-12-28': 'Boxing Day observed',
  },
  earlyClose: {
    '2026-12-24': { time: '14:10', reason: 'Before Christmas · early close' },
    '2026-12-31': { time: '14:10', reason: 'Year-end · early close' },
    '2027-12-24': { time: '14:10', reason: 'Before Christmas · early close' },
    '2027-12-31': { time: '14:10', reason: 'Year-end · early close' },
  },
};

const CASH_MARKETS: readonly CashMarket[] = [NYSE, LSE, TSE, ASX];
export const MARKET_META: Readonly<Record<MarketId, { name: string; short: string; zone: string }>> = {
  crypto: { name: 'Crypto spot & perpetuals', short: '24/7', zone: 'UTC' },
  'cme-btc': { name: 'CME Bitcoin Globex', short: 'CME BTC', zone: 'America/Chicago' },
  nyse: { name: NYSE.name, short: NYSE.short, zone: NYSE.zone },
  lse: { name: LSE.name, short: LSE.short, zone: LSE.zone },
  tse: { name: TSE.name, short: TSE.short, zone: TSE.zone },
  asx: { name: ASX.name, short: ASX.short, zone: ASX.zone },
};

export const MARKET_ORDER: readonly MarketId[] = ['nyse', 'lse', 'tse', 'asx', 'cme-btc', 'crypto'];
const DAY_MS = 86_400_000;

const localPartsFormatter = new Map<string, Intl.DateTimeFormat>();
function localParts(epochMs: number, zone: string) {
  let formatter = localPartsFormatter.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    localPartsFormatter.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(epochMs).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as Record<string, number>;
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second! };
}

function dateKey(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function keyAt(epochMs: number, zone: string) { const p = localParts(epochMs, zone); return dateKey(p.year, p.month, p.day); }
function weekdayOf(key: string) { const [year, month, day] = key.split('-').map(Number); return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay(); }
function incrementDate(key: string, amount: number) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function datesForRange(startMs: number, endMs: number, zone: string): string[] {
  let key = incrementDate(keyAt(startMs, zone), -1);
  const last = incrementDate(keyAt(endMs, zone), 1);
  const dates: string[] = [];
  while (key <= last && dates.length < 40) { dates.push(key); key = incrementDate(key, 1); }
  return dates;
}
function wallClockMs(key: string, time: string, zone: string): number {
  const [year, month, day] = key.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = localParts(guess, zone), observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const correction = desired - observed;
    if (!correction) return guess;
    guess += correction;
  }
  return guess;
}
function parseTime(time: string) { const [hour, minute] = time.split(':').map(Number); return hour! * 60 + minute!; }

function addCashMarketIntervals(market: CashMarket, startMs: number, endMs: number): MarketInterval[] {
  const result: MarketInterval[] = [];
  for (const date of datesForRange(startMs, endMs, market.zone)) {
    const [year] = date.split('-').map(Number), weekday = weekdayOf(date);
    if (!market.weekdays.includes(weekday)) continue;
    if (year! < CALENDAR_COVERAGE.from || year! > CALENDAR_COVERAGE.through) {
      const dayStart = wallClockMs(date, '00:00', market.zone), dayEnd = wallClockMs(incrementDate(date, 1), '00:00', market.zone);
      if (dayStart < endMs && dayEnd > startMs) result.push({ market: market.id, startMs: dayStart, endMs: dayEnd, kind: 'unknown', label: 'Calendar unknown', reason: `No annual holiday calendar for ${year}` , tradeDate: date });
      continue;
    }
    if (market.holidays[date]) continue;
    const early = market.earlyClose[date];
    for (const segment of market.segments) {
      if (early && parseTime(early.time) <= parseTime(segment.start)) continue;
      const open = wallClockMs(date, segment.start, market.zone);
      const regularClose = early ? early.time : segment.end;
      const close = wallClockMs(date, regularClose, market.zone);
      if (open < endMs && close > startMs) result.push({ market: market.id, startMs: open, endMs: close, kind: 'open', label: segment.label, reason: early?.reason, tradeDate: date });
    }
  }
  return result;
}

function addCmeIntervals(startMs: number, endMs: number): MarketInterval[] {
  const zone = MARKET_META['cme-btc'].zone;
  const effective = Date.parse('2026-05-29T21:00:00.000Z'); // 16:00 CDT; CME's 24/7 regime begins here.
  const result: MarketInterval[] = [];
  if (startMs < effective) result.push({
    market: 'cme-btc', startMs, endMs: Math.min(endMs, effective), kind: 'unknown',
    label: 'Schedule unknown', reason: 'CME 24/7 baseline began 29 May 2026; earlier hours are not modeled',
  });
  const knownStart = Math.max(startMs, effective);
  if (knownStart >= endMs) return result;
  const breaks: MarketInterval[] = [];
  for (const date of datesForRange(knownStart, endMs, zone)) {
    const weekday = weekdayOf(date);
    if (weekday >= 1 && weekday <= 5) {
      const start = wallClockMs(date, '16:00', zone), end = wallClockMs(date, '16:02', zone);
      if (start < endMs && end > knownStart) breaks.push({ market: 'cme-btc', startMs: start, endMs: end, kind: 'maintenance', label: '2-minute maintenance', reason: 'Scheduled Globex maintenance', tradeDate: date });
    }
    if (weekday === 6) {
      const start = wallClockMs(date, '02:00', zone), end = wallClockMs(date, '04:00', zone);
      if (start < endMs && end > knownStart) breaks.push({ market: 'cme-btc', startMs: start, endMs: end, kind: 'maintenance', label: 'Saturday maintenance', reason: 'Scheduled Globex maintenance', tradeDate: date });
    }
  }
  breaks.sort((a, b) => a.startMs - b.startMs);
  const scheduled: MarketInterval[] = result;
  let cursor = knownStart;
  for (const pause of breaks) {
    const breakStart = Math.max(knownStart, pause.startMs), breakEnd = Math.min(endMs, pause.endMs);
    if (breakStart > cursor) scheduled.push({ market: 'cme-btc', startMs: cursor, endMs: breakStart, kind: 'open', label: 'Globex' });
    scheduled.push({ ...pause, startMs: breakStart, endMs: breakEnd });
    cursor = Math.max(cursor, breakEnd);
  }
  if (cursor < endMs) scheduled.push({ market: 'cme-btc', startMs: cursor, endMs, kind: 'open', label: 'Globex' });
  return scheduled;
}

export function buildSessionSchedule(startMs: number, endMs: number): Record<MarketId, MarketInterval[]> {
  const crypto: MarketInterval[] = [{ market: 'crypto', startMs, endMs, kind: 'open', label: '24/7', reason: 'Scheduled 24/7; venue outages are not monitored' }];
  return {
    crypto,
    'cme-btc': addCmeIntervals(startMs, endMs),
    nyse: addCashMarketIntervals(NYSE, startMs, endMs),
    lse: addCashMarketIntervals(LSE, startMs, endMs),
    tse: addCashMarketIntervals(TSE, startMs, endMs),
    asx: addCashMarketIntervals(ASX, startMs, endMs),
  };
}

function holidayReason(market: MarketId, epochMs: number): string {
  if (market === 'crypto' || market === 'cme-btc') return 'Scheduled maintenance';
  const definition = CASH_MARKETS.find(item => item.id === market)!;
  const date = keyAt(epochMs, definition.zone), [year] = date.split('-').map(Number);
  const weekday = weekdayOf(date);
  if (weekday === 0 || weekday === 6) return 'Weekend';
  if (year! < CALENDAR_COVERAGE.from || year! > CALENDAR_COVERAGE.through) return `Calendar unknown for ${year}`;
  const holiday = definition.holidays[date];
  if (holiday) return holiday;
  const time = localParts(epochMs, definition.zone), minute = time.hour * 60 + time.minute;
  const early = definition.earlyClose[date];
  if (early && minute >= parseTime(early.time)) return early.reason;
  const isBetweenSegments = definition.segments.some((segment, index) => index > 0 && minute >= parseTime(definition.segments[index - 1]!.end) && minute < parseTime(segment.start));
  if (isBetweenSegments) return 'Scheduled lunch break';
  return 'Outside regular hours';
}

export function statusAt(schedule: Record<MarketId, MarketInterval[]>, market: MarketId, nowMs: number): MarketStatus {
  const zone = MARKET_META[market].zone, intervals = schedule[market];
  const current = intervals.find(interval => interval.startMs <= nowMs && nowMs < interval.endMs);
  if (current?.kind === 'unknown') return { market, state: 'unknown', reason: current.reason ?? 'Calendar unknown', transitionAt: null, transition: null, zone };
  if (market === 'crypto') return { market, state: 'active', reason: '24/7 baseline · venue outages are not monitored', transitionAt: null, transition: null, zone };
  if (current?.kind === 'open') {
    const nextIsMaintenance = market === 'cme-btc' && intervals.some(interval => interval.kind === 'maintenance' && interval.startMs === current.endMs);
    return { market, state: 'active', reason: current.reason ?? current.label, transitionAt: current.endMs, transition: nextIsMaintenance ? 'maintenance' : 'closes', zone };
  }
  if (current?.kind === 'maintenance') {
    return { market, state: 'closed', reason: current.reason ?? current.label, transitionAt: current.endMs, transition: 'resumes', zone };
  }
  const nextOpen = intervals.find(interval => interval.kind === 'open' && interval.startMs > nowMs);
  const nextUnknown = intervals.find(interval => interval.kind === 'unknown' && interval.startMs > nowMs);
  if (nextUnknown && (!nextOpen || nextUnknown.startMs < nextOpen.startMs)) {
    return { market, state: 'closed', reason: `${holidayReason(market, nowMs)} · next schedule is unverified`, transitionAt: nextUnknown.startMs, transition: 'unknown', zone };
  }
  if (nextOpen) return { market, state: 'closed', reason: holidayReason(market, nowMs), transitionAt: nextOpen.startMs, transition: market === 'cme-btc' ? 'resumes' : 'opens', zone };
  const reason = holidayReason(market, nowMs);
  if (reason.startsWith('Calendar unknown')) return { market, state: 'unknown', reason, transitionAt: null, transition: null, zone };
  return { market, state: 'closed', reason, transitionAt: null, transition: null, zone };
}

export function formatCountdown(targetMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  if (days) return `${days}d ${String(hours).padStart(2, '0')}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  return `${remainder}s`;
}

export function timelineWindow(nowMs: number, displayZone: string): { startMs: number; endMs: number; nextRollMs: number } {
  const p = localParts(nowMs, displayZone);
  const hourStart = nowMs - (p.minute * 60_000 + p.second * 1000 + new Date(nowMs).getUTCMilliseconds());
  const startMs = hourStart - 12 * 3_600_000;
  return { startMs, endMs: startMs + DAY_MS, nextRollMs: hourStart + 3_600_000 };
}

export function timelineTicks(startMs: number, endMs: number, everyHours = 4): number[] {
  const step = everyHours * 3_600_000;
  // `startMs` is aligned to the selected zone's hour. Stepping by elapsed
  // hours lets DST repeats/skips appear as real elapsed hours.
  const first = startMs;
  const ticks: number[] = [];
  for (let value = first; value < endMs; value += step) ticks.push(value);
  return ticks;
}


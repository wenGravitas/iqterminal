/** Pure UTC market profile calculations. Prices are converted to exchange ticks before rows are built. */
export const MINUTE_MS = 60_000;
export const DAY_MS = 1_440 * MINUTE_MS;
export const TPO_ENGINE_VERSION = 1;

export interface TpoMinute {
  /** UTC minute opening time in milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  revision?: number;
  closed?: boolean;
}

export interface TpoSettings {
  tickSize: number;
  bracketMinutes: 15 | 30 | 60;
  /** `auto` groups ticks into no more than about this many rows. */
  rowTicks: number | 'auto';
  valueAreaPercent: number;
  openingRangeMinutes: number;
  openingRangeMidpoint: boolean;
  initialBalanceMinutes: number;
  initialBalanceCompletedOnly: boolean;
  /** Retention bound for completed session levels; display-only consumers may omit it. */
  nakedDays?: number;
}

export interface TpoRow {
  /** Row's first exchange tick, anchored at tick zero. */
  firstTick: number;
  /** Number of exchange ticks represented by this row. */
  rowTicks: number;
  /** One entry per bracket that traded anywhere in this price row. */
  brackets: number[];
  count: number;
}

export interface TpoRange {
  high: number;
  low: number;
  midpoint: number;
  from: number;
  to: number;
  windowMinutes: number;
  elapsedMinutes: number;
  observedMinutes: number;
  missingMinutes: number;
  expectedMinutes: number;
  futureMinutes: number;
  complete: boolean;
}

export interface TpoSession {
  day: number;
  bracketMinutes: 15 | 30 | 60;
  bracketCount: number;
  rowTicks: number;
  requestedRowTicks: number | 'auto';
  capacityLimited: boolean;
  tickSize: number;
  rows: TpoRow[];
  poc: number;
  vah: number;
  val: number;
  totalTpos: number;
  valueAreaPercent: number;
  openingRange: TpoRange | null;
  initialBalance: TpoRange | null;
  observedMinutes: number;
  elapsedMinutes: number;
  missingMinutes: number;
  expectedMinutes: number;
  futureMinutes: number;
  gaps: number;
  firstObserved: number | null;
  lastObserved: number | null;
  complete: boolean;
}

export interface TpoNakedLevel {
  id: string;
  originDay: number;
  kind: 'POC' | 'VAH' | 'VAL';
  price: number;
  state: 'active' | 'tested' | 'unknown';
  from: number;
  to: number;
  firstTouch: number | null;
  /** Number of missing one-minute intervals from the origin close to the first touch/end. */
  missingMinutes: number;
}

export const DEFAULT_TPO_SETTINGS: TpoSettings = {
  tickSize: 0.1,
  bracketMinutes: 30,
  rowTicks: 'auto',
  valueAreaPercent: 70,
  openingRangeMinutes: 30,
  openingRangeMidpoint: false,
  initialBalanceMinutes: 60,
  initialBalanceCompletedOnly: false,
};

function isMinute(value: TpoMinute): boolean {
  return Number.isSafeInteger(value.time) && value.time > 0
    && value.time % MINUTE_MS === 0
    && [value.open, value.high, value.low, value.close].every(Number.isFinite)
    && value.low > 0
    && value.high >= Math.max(value.open, value.close, value.low)
    && value.low <= Math.min(value.open, value.close);
}

function normaliseMinutes(minutes: readonly TpoMinute[], day: number): TpoMinute[] {
  const byTime = new Map<number, TpoMinute>();
  for (const minute of minutes) {
    if (!isMinute(minute) || minute.time < day || minute.time >= day + DAY_MS) continue;
    const old = byTime.get(minute.time);
    if (!old || (minute.revision ?? 0) >= (old.revision ?? 0)) byTime.set(minute.time, minute);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function priceTick(price: number, tickSize: number, direction: 'floor' | 'ceil'): number {
  const raw = price / tickSize;
  const nearest = Math.round(raw);
  const tolerance = Math.max(1, Math.abs(raw)) * Number.EPSILON * 16;
  if (Math.abs(raw - nearest) <= tolerance) return nearest;
  return direction === 'floor' ? Math.floor(raw) : Math.ceil(raw);
}

function chooseRowTicks(lowTick: number, highTick: number, requested: number | 'auto'): number {
  if (typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0) return requested;
  const tickSpan = Math.max(1, highTick - lowTick + 1);
  return Math.max(1, Math.ceil(tickSpan / 96));
}

function rowFirstTick(tick: number, rowTicks: number): number {
  return Math.floor(tick / rowTicks) * rowTicks;
}

function coverageCounts(minutes: readonly TpoMinute[], from: number, windowMinutes: number, coverageEnd: number) {
  const elapsedMinutes = Math.min(windowMinutes, Math.max(0, Math.floor((coverageEnd - from) / MINUTE_MS)));
  const expectedMinutes = elapsedMinutes;
  const first = lowerBound(minutes, from);
  const last = lowerBound(minutes, from + elapsedMinutes * MINUTE_MS);
  const observedMinutes = last - first;
  return {
    windowMinutes,
    elapsedMinutes,
    observedMinutes,
    expectedMinutes,
    missingMinutes: Math.max(0, expectedMinutes - observedMinutes),
    futureMinutes: windowMinutes - elapsedMinutes,
  };
}

function rangeFor(minutes: readonly TpoMinute[], day: number, durationMinutes: number, coverageEnd: number): TpoRange | null {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const bounded = Math.min(1_440, Math.max(1, Math.floor(durationMinutes)));
  const from = day;
  const to = day + bounded * MINUTE_MS;
  let high = -Infinity;
  let low = Infinity;
  let observedMinutes = 0;
  for (const minute of minutes) {
    if (minute.time < from || minute.time >= to || minute.time >= coverageEnd) continue;
    high = Math.max(high, minute.high);
    low = Math.min(low, minute.low);
    observedMinutes++;
  }
  if (!observedMinutes) return null;
  const coverage = coverageCounts(minutes, from, bounded, coverageEnd);
  return { high, low, midpoint: (high + low) / 2, from, to, ...coverage, complete: coverage.futureMinutes === 0 && coverage.missingMinutes === 0 };
}

/**
 * Computes one UTC day's profile from 1-minute OHLC. Each bracket adds at most one TPO to a row.
 * For 30-minute brackets, A-X is followed by a-x; 15-minute profiles use A-X, a-x, A2-X2,
 * and so on. Value-area expansion uses the larger adjacent row; an exact tie expands downward.
 */
export function calculateTpoSession(day: number, input: readonly TpoMinute[], settings: TpoSettings, coverageEnd?: number): TpoSession | null {
  if (!Number.isSafeInteger(day) || day % DAY_MS !== 0) throw new RangeError('day must be a UTC day boundary');
  if (!Number.isFinite(settings.tickSize) || settings.tickSize <= 0) throw new RangeError('tickSize must be positive');
  const minutes = normaliseMinutes(input, day);
  if (!minutes.length) return null;
  const asOf = Number.isFinite(coverageEnd) ? coverageEnd! : minutes.at(-1)!.time + MINUTE_MS;

  const bracketMinutes = settings.bracketMinutes === 15 || settings.bracketMinutes === 60 ? settings.bracketMinutes : 30;
  const bracketCount = 1_440 / bracketMinutes;
  const ranges = new Map<number, { low: number; high: number }>();
  let minTick = Infinity;
  let maxTick = -Infinity;
  for (const minute of minutes) {
    const lowTick = priceTick(minute.low, settings.tickSize, 'floor');
    const highTick = priceTick(minute.high, settings.tickSize, 'ceil');
    const bracket = Math.floor((minute.time - day) / (bracketMinutes * MINUTE_MS));
    if (bracket < 0 || bracket >= bracketCount) continue;
    minTick = Math.min(minTick, lowTick);
    maxTick = Math.max(maxTick, highTick);
    const old = ranges.get(bracket);
    ranges.set(bracket, { low: Math.min(old?.low ?? Infinity, lowTick), high: Math.max(old?.high ?? -Infinity, highTick) });
  }
  if (!Number.isFinite(minTick) || !Number.isFinite(maxTick)) return null;
  const requestedRowTicks = typeof settings.rowTicks === 'number' && Number.isSafeInteger(settings.rowTicks) && settings.rowTicks > 0 ? settings.rowTicks : 'auto';
  const firstProfileTick = rowFirstTick(minTick, chooseRowTicks(minTick, maxTick, settings.rowTicks));
  const lastProfileTick = rowFirstTick(maxTick, chooseRowTicks(minTick, maxTick, settings.rowTicks));
  const rowCount = Math.floor((lastProfileTick - firstProfileTick) / chooseRowTicks(minTick, maxTick, settings.rowTicks)) + 1;
  const capacityLimited = rowCount > 2_048;
  const rowTicks = capacityLimited ? Math.max(chooseRowTicks(minTick, maxTick, settings.rowTicks), Math.ceil((maxTick - minTick + 1) / 2_048)) : chooseRowTicks(minTick, maxTick, settings.rowTicks);
  const counts = new Map<number, Set<number>>();
  for (const [bracket, range] of ranges) {
    const first = rowFirstTick(range.low, rowTicks);
    const last = rowFirstTick(range.high, rowTicks);
    for (let tick = first; tick <= last; tick += rowTicks) {
      let brackets = counts.get(tick);
      if (!brackets) counts.set(tick, brackets = new Set());
      brackets.add(bracket);
    }
  }
  const firstRow = rowFirstTick(minTick, rowTicks);
  const lastRow = rowFirstTick(maxTick, rowTicks);
  const rows: TpoRow[] = [];
  for (let firstTick = firstRow; firstTick <= lastRow; firstTick += rowTicks) {
    const brackets = counts.get(firstTick) ?? new Set<number>();
    rows.push({ firstTick, rowTicks, brackets: [...brackets].sort((a, b) => a - b), count: brackets.size });
  }
  const totalTpos = rows.reduce((sum, row) => sum + row.count, 0);
  let pocIndex = 0;
  const medianTick = (minTick + maxTick) / 2;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i], best = rows[pocIndex];
    const rowCenter = row.firstTick + (rowTicks - 1) / 2;
    const bestCenter = best.firstTick + (rowTicks - 1) / 2;
    if (row.count > best.count
      || (row.count === best.count && Math.abs(rowCenter - medianTick) < Math.abs(bestCenter - medianTick))
      || (row.count === best.count && Math.abs(rowCenter - medianTick) === Math.abs(bestCenter - medianTick) && row.firstTick < best.firstTick)) pocIndex = i;
  }
  const requestedPercent = Number.isFinite(settings.valueAreaPercent) ? settings.valueAreaPercent : 70;
  const valueAreaPercent = Math.min(100, Math.max(1, requestedPercent));
  const target = Math.ceil(totalTpos * valueAreaPercent / 100);
  let lo = pocIndex;
  let hi = pocIndex;
  let accumulated = rows[pocIndex].count;
  while (accumulated < target && (lo > 0 || hi + 1 < rows.length)) {
    const below = lo > 0 ? rows[lo - 1].count : -1;
    const above = hi + 1 < rows.length ? rows[hi + 1].count : -1;
    if (below >= above) accumulated += rows[--lo].count;
    else accumulated += rows[++hi].count;
  }
  const center = (firstTick: number) => (firstTick + (rowTicks - 1) / 2) * settings.tickSize;
  const poc = center(rows[pocIndex].firstTick);
  const val = rows[lo].firstTick * settings.tickSize;
  const vah = (rows[hi].firstTick + rowTicks) * settings.tickSize;
  const coverage = coverageCounts(minutes, day, 1_440, asOf);
  const observedMinutes = coverage.observedMinutes;
  const expectedMinutes = coverage.expectedMinutes;
  const gaps = coverage.missingMinutes;
  const openingRange = rangeFor(minutes, day, settings.openingRangeMinutes, asOf);
  const initialBalance = rangeFor(minutes, day, settings.initialBalanceMinutes, asOf);
  return {
    day, bracketMinutes, bracketCount, rowTicks, requestedRowTicks, capacityLimited, tickSize: settings.tickSize, rows,
    poc, vah, val, totalTpos, valueAreaPercent, openingRange, initialBalance,
    observedMinutes, elapsedMinutes: coverage.elapsedMinutes, missingMinutes: coverage.missingMinutes, expectedMinutes, futureMinutes: coverage.futureMinutes, gaps,
    firstObserved: minutes[0].time, lastObserved: minutes.at(-1)!.time,
    complete: coverage.futureMinutes === 0 && gaps === 0,
  };
}

/** Labels bracket columns without silently reusing the 24-letter alphabet for longer days. */
export function tpoBracketLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) return '';
  const alphabetIndex = index % 48;
  const base = alphabetIndex < 24 ? String.fromCharCode(65 + alphabetIndex) : String.fromCharCode(97 + alphabetIndex - 24);
  const cycle = Math.floor(index / 48);
  return cycle ? `${base}${cycle + 1}` : base;
}

function lowerBound(minutes: readonly TpoMinute[], time: number): number {
  let lo = 0, hi = minutes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (minutes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Computes the first later one-minute candle that spans each completed session level.
 * Any gap between origin end and touch (or the supplied coverage end) makes the level unknown;
 * a gap can hide an earlier touch, so it is never reported as a proven naked level.
 */
export function calculateNakedLevels(
  sessions: readonly TpoSession[],
  input: readonly TpoMinute[],
  coverageEnd: number,
  limitDays = 90,
): TpoNakedLevel[] {
  const valid = input.filter(isMinute).slice().sort((a, b) => a.time - b.time);
  if (!valid.length || !Number.isFinite(coverageEnd)) return [];
  const days = [...sessions].filter(session => session.complete).sort((a, b) => b.day - a.day).slice(0, Math.max(1, Math.floor(limitDays))).sort((a, b) => a.day - b.day);
  const levels: TpoNakedLevel[] = [];
  for (const session of days) {
    const originEnd = session.day + DAY_MS;
    const candidates: Array<[TpoNakedLevel['kind'], number]> = [['POC', session.poc], ['VAH', session.vah], ['VAL', session.val]];
    for (const [kind, price] of candidates) {
      const startIndex = lowerBound(valid, originEnd);
      let touch: TpoMinute | undefined;
      for (let i = startIndex; i < valid.length && valid[i].time < coverageEnd; i++) {
        if (valid[i].low <= price && valid[i].high >= price) { touch = valid[i]; break; }
      }
      const end = touch?.time ?? coverageEnd;
      const elapsedMinutes = Math.max(0, Math.floor((end - originEnd) / MINUTE_MS));
      const missingMinutes = coverageCounts(valid, originEnd, elapsedMinutes, end).missingMinutes;
      const state = missingMinutes ? 'unknown' : touch ? 'tested' : 'active';
      levels.push({
        id: `${session.day}:${kind}:${price}`,
        originDay: session.day,
        kind,
        price,
        state,
        from: originEnd,
        to: coverageEnd,
        firstTouch: touch?.time ?? null,
        missingMinutes,
      });
    }
  }
  return levels;
}

export function tpoSessionKey(sourceKey: string, settings: Pick<TpoSettings, 'bracketMinutes' | 'rowTicks' | 'valueAreaPercent' | 'tickSize'>, day: number): string {
  return `${TPO_ENGINE_VERSION}:${sourceKey}:${settings.bracketMinutes}:${settings.rowTicks}:${settings.valueAreaPercent}:${settings.tickSize}:${day}`;
}

import type { Candle } from '../feed/protocol';

export const KEY_LEVELS_ID = 'native.utc-key-levels';
export interface KeyLevelSettings { previousHigh: boolean; previousLow: boolean; todayOpen: boolean }
export const DEFAULT_KEY_LEVELS: KeyLevelSettings = { previousHigh: true, previousLow: true, todayOpen: true };
export function keyLevelSettings(value: unknown): KeyLevelSettings {
  const v = value && typeof value === 'object' ? value as Partial<KeyLevelSettings> : {};
  return { previousHigh: v.previousHigh !== false, previousLow: v.previousLow !== false, todayOpen: v.todayOpen !== false };
}
export interface KeyLevel { id: 'previous-high'|'previous-low'|'today-open'; label: string; price: number; startTime: number }

/** Derive levels solely from complete canonical UTC daily candles. */
export function calculateUtcKeyLevels(candles: readonly Candle[], nowMs: number, settings = DEFAULT_KEY_LEVELS): KeyLevel[] {
  const day = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const daily = candles.filter(c => Number.isFinite(c.t) && c.t % 86_400_000 === 0 &&
    [c.o,c.h,c.l,c.c].every(Number.isFinite) && c.o > 0 && c.h >= c.l && c.l > 0).sort((a,b)=>a.t-b.t);
  const today = daily.find(c => c.t === day); // today's open is valid while its daily candle is forming
  const previous = daily.find(c => c.t === day - 86_400_000 && c.closed && c.t + 86_400_000 <= nowMs);
  const result: KeyLevel[] = [];
  // Prior-day values become knowable only at today's UTC boundary.
  if (settings.previousHigh && previous) result.push({id:'previous-high',label:'PDH',price:previous.h,startTime:day/1000});
  if (settings.previousLow && previous) result.push({id:'previous-low',label:'PDL',price:previous.l,startTime:day/1000});
  if (settings.todayOpen && today) result.push({id:'today-open',label:'DO',price:today.o,startTime:day/1000});
  return result;
}

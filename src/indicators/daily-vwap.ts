import type { Bar } from 'openalgo-charts';
export const DAILY_VWAP_ID = 'native.daily-vwap';
export const VWAP_DAY_SECONDS = 86400;
export interface DailyVwapSettings {
  source: 'hlc3' | 'hl2' | 'close'; bands: boolean; nakedGaps: boolean; multiplier: number;
  lineColor: string; bandColor: string; lineWidth: number; fillOpacity: number;
}
export const DEFAULT_DAILY_VWAP: DailyVwapSettings = {
  source: 'hlc3', bands: true, nakedGaps: true, multiplier: 1, lineColor: '#2962ff', bandColor: '#4b9b38', lineWidth: 1, fillOpacity: .04,
};
export function dailyVwapSettings(value: unknown): DailyVwapSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const numeric = (key: keyof DailyVwapSettings, min: number, max: number) => typeof raw[key] === 'number' && Number.isFinite(raw[key])
    ? Math.max(min, Math.min(max, raw[key] as number)) : DEFAULT_DAILY_VWAP[key] as number;
  const color = (key: 'lineColor' | 'bandColor') => typeof raw[key] === 'string' && /^#[\da-f]{6}$/i.test(raw[key] as string) ? raw[key] as string : DEFAULT_DAILY_VWAP[key];
  return { source: raw.source === 'hl2' || raw.source === 'close' ? raw.source : 'hlc3', bands: raw.bands !== false, nakedGaps: raw.nakedGaps !== false,
    multiplier: numeric('multiplier', .1, 5), lineColor: color('lineColor'), bandColor: color('bandColor'),
    lineWidth: numeric('lineWidth', 1, 3), fillOpacity: numeric('fillOpacity', 0, .3) };
}
export interface VwapPoint { time: number; day: number; value: number | null; deviation: number; partial: boolean; breakBefore: boolean }
export interface NakedVwapGap { time: number; availableAt: number; value: number }
interface State { day: number; weight: number; mean: number; m2: number; partial: boolean }
/** Candle-volume weighted HLC3 by default; weighted Welford avoids price-squared cancellation.
 * Changed/replaced bars replay only their suffix, so cumulative forming volume is never added twice.
 */
export class DailyVwapCalculation {
  private inputs: number[][] = [];
  private states: State[] = [];
  readonly points: VwapPoint[] = [];
  nakedGaps: NakedVwapGap[] = [];
  private key = '';
  update(bars: readonly Bar[], source: DailyVwapSettings['source'], intervalSeconds: number) {
    const key = `${source}:${intervalSeconds}`;
    let first = 0;
    if (key === this.key) {
      while (first < bars.length && first < this.inputs.length) {
        const b = bars[first]!, input = this.inputs[first]!;
        if (![b.time,b.high,b.low,b.close,b.volume ?? 0].every((value,index) => value === input[index])) break;
        first++;
      }
    }
    const changed = first !== bars.length || first !== this.inputs.length;
    this.key = key; this.inputs.length = first; this.states.length = first; this.points.length = first;
    let previous = this.states.at(-1);
    for (let index = first; index < bars.length; index++) {
      const bar = bars[index]!, day = Math.floor(bar.time / VWAP_DAY_SECONDS) * VWAP_DAY_SECONDS;
      const gap = index > 0 && bar.time !== bars[index - 1]!.time + intervalSeconds;
      let state: State = previous?.day === day ? { ...previous } : { day, weight: 0, mean: 0, m2: 0, partial: bar.time !== day };
      const price = source === 'close' ? bar.close : source === 'hl2' ? (bar.high + bar.low) / 2 : (bar.high + bar.low + bar.close) / 3;
      const volume = bar.volume ?? 0;
      if (gap && previous?.day === day) state.partial = true;
      if (![price,volume].every(Number.isFinite) || price <= 0 || volume < 0) state.partial = true;
      else if (volume > 0) {
        const weight = state.weight + volume, delta = price - state.mean;
        const mean = state.mean + volume / weight * delta;
        state.m2 += volume * delta * (price - mean); state.mean = mean; state.weight = weight;
      }
      this.inputs.push([bar.time,bar.high,bar.low,bar.close,volume]); this.states.push(state);
      this.points.push({ time: bar.time, day, value: state.weight > 0 ? state.mean : null,
        deviation: state.weight > 0 ? Math.sqrt(Math.max(0,state.m2 / state.weight)) : 0,
        partial: state.partial, breakBefore: !previous || previous.day !== day || gap });
      previous = state;
    }
    if (changed) this.updateNakedGaps(bars, intervalSeconds);
    return this.points;
  }
  private updateNakedGaps(bars: readonly Bar[], intervalSeconds: number) {
    let active: NakedVwapGap[] = [];
    for (let index = 1; index < bars.length; index++) {
      const bar = bars[index]!, previous = this.points[index - 1]!, point = this.points[index]!;
      // Missing observations cannot prove a level remained untouched.
      if (bar.time !== bars[index - 1]!.time + intervalSeconds ||
          !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low) {
        active = [];
        continue;
      }
      if (point.day !== previous.day && !previous.partial && previous.value !== null) {
        active.push({ time: previous.time, availableAt: bar.time, value: previous.value });
      }
      // Include the first new-day bar and inclusive wick touches, even at zero volume.
      active = active.filter(level => bar.low > level.value || bar.high < level.value);
    }
    this.nakedGaps = active;
  }
}

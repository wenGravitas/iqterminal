import type { FootprintStatRow } from 'openalgo-charts/profile';
import type { FootprintBar } from './feed/protocol';
import type { FootprintUnits } from './chart/footprint-units';
import { footprintForUnits } from './chart/footprint-units';
import type { FootprintTotalsPane } from './chart/footprint-totals';
import type { DeltaFlipAssessment } from './chart/footprint-delta-flips';

export type TotalsHover = NonNullable<ReturnType<FootprintTotalsPane['hoverSummary']>>;
const SIGNED = new Set<FootprintStatRow>(['delta', 'minDelta', 'maxDelta', 'cvd', 'deltaPct']);

/** Same displayed candle population as the table, using actual execution notionals. */
export function otherFootprintTotals(bars: readonly FootprintBar[], displayedTimes: readonly number[], time: number, units: FootprintUnits): Partial<Record<FootprintStatRow, number | null>> {
  const byTime = new Map(bars.map(bar => [bar.time, bar]));
  const project = (at: number) => { const bar = byTime.get(at); return bar ? footprintForUnits(bar, units) : null; };
  const bar = project(time);
  if (!bar) return {};
  let bid = 0, ask = 0;
  for (const cell of bar.cells) { bid += cell.bidVol; ask += cell.askVol; }
  let cvd: number | null = 0;
  for (const at of displayedTimes) {
    if (at > time) break;
    const prior = project(at);
    if (!prior) { cvd = null; break; }
    cvd += prior.delta;
  }
  return { volume: bid + ask, bidVolume: bid, askVolume: ask, delta: bar.delta, minDelta: bar.minDelta ?? null, maxDelta: bar.maxDelta ?? null, cvd };
}

export function renderFootprintTotalsTooltip(element: HTMLElement, data: TotalsHover, other: Partial<Record<FootprintStatRow, number | null>>, context: { interval: string; source: string; coverage: string; gapBefore: boolean }) {
  const node = (tag: string, className: string, text = '') => { const result = document.createElement(tag); result.className = className; result.textContent = text; return result; };
  const date = new Date(data.time * 1000);
  const stamp = `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${date.toISOString().slice(11, 16)} UTC`;
  const header = node('div', 'positioning-tooltip-header'); header.append(node('span', '', stamp), node('span', 'positioning-tooltip-muted', context.interval));
  const title = node('div', 'positioning-tooltip-heading'); title.append(node('strong', '', 'Footprint Totals'), node('span', 'positioning-tooltip-muted', data.units.toUpperCase()));
  const rows = node('div', 'positioning-tooltip-sources');
  const format = (value: number | null | undefined, key: FootprintStatRow, unit: FootprintUnits) => {
    const suffix = key === 'trades' ? '' : key === 'deltaPct' ? '%' : ` ${unit.toUpperCase()}`;
    if (value == null || !Number.isFinite(value)) return `N/A${suffix}`;
    const amount = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: key === 'trades' ? 0 : unit === 'btc' && key !== 'deltaPct' ? 6 : 2 });
    return `${value < 0 ? '−' : value > 0 && SIGNED.has(key) ? '+' : ''}${amount}${suffix}`;
  };
  for (const metric of data.rows) {
    const row = node('div', 'footprint-totals-tooltip-row'); row.dataset.hovered = String(metric.key === data.hoveredRow);
    const direction = SIGNED.has(metric.key) && metric.value != null ? metric.value < 0 ? ' negative' : metric.value > 0 ? ' positive' : '' : '';
    const amount = node('span', `positioning-tooltip-amount positioning-tooltip-value${direction}`, format(metric.value, metric.key, data.units));
    if (metric.key !== 'trades' && metric.key !== 'deltaPct') amount.append(node('small', 'positioning-tooltip-secondary', format(other[metric.key], metric.key, data.units === 'btc' ? 'usdt' : 'btc')));
    row.append(node('span', 'positioning-tooltip-label', metric.label), amount); rows.append(row);
  }
  const flip = data.deltaFlip as DeltaFlipAssessment | null;
  const flipInfo = flip?.kind === 'flip' ? node('div', 'positioning-tooltip-muted', '') : null;
  if (flip?.kind === 'flip' && flipInfo) {
    const formatDelta = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: data.units === 'btc' ? 6 : 2 })} ${data.units.toUpperCase()}`;
    const grade = flip.strengthBand === 'small' ? 'Small' : flip.strengthBand === 'medium' ? 'Medium'
      : flip.strengthBand === 'strong' ? 'Strong' : flip.strengthBand === 'below-minimum' ? 'Below minimum' : 'Strength unavailable';
    const lifecycle = flip.lifecycle === 'live' ? 'Live' : 'Closed';
    const strength = flip.strength === null
      ? `Strength unavailable — ${flip.unavailableReason === 'insufficient-history' ? 'insufficient history' : flip.unavailableReason === 'zero-baseline' ? 'reference median is zero' : 'USDT notional projection unavailable'}`
      : `Relative strength ${flip.strength.toFixed(1)}×${flip.strengthBand === 'below-minimum' ? ` · below ${Number(data.deltaFlipMinimumStrength ?? 0).toFixed(2)}× minimum` : ''}`;
    flipInfo.className = 'footprint-totals-tooltip-flip';
    const swing = `${Math.abs(flip.rawSwing).toLocaleString('en-US', { maximumFractionDigits: data.units === 'btc' ? 6 : 2 })} ${data.units.toUpperCase()}`;
    flipInfo.textContent = `${flip.direction === 'positive' ? 'Positive' : 'Negative'} delta flip · ${grade} · ${lifecycle}\n${formatDelta(flip.previousDelta)} → ${formatDelta(flip.currentDelta)} · swing ${swing}\n${strength}`;
  }
  const previewLimitation = data.deltaFlipUnavailableReason === 'preview-provenance-unknown'
    ? node('div', 'footprint-totals-tooltip-flip', 'Live preview unavailable — coverage provenance is unknown') : null;
  const footer = node('div', 'positioning-tooltip-total positioning-tooltip-muted', `${context.coverage}${context.gapBefore ? ' · gap before' : ''}`);
  const source = node('div', 'positioning-tooltip-muted positioning-tooltip-status', context.source);
  element.replaceChildren(header, title, rows, ...(flipInfo ? [flipInfo] : previewLimitation ? [previewLimitation] : []), footer, source);
}

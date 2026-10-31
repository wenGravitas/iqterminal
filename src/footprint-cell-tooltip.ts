import type { FootprintHover } from 'openalgo-charts/profile';
import type { FootprintBar } from './feed/protocol';
import type { FootprintUnits } from './chart/footprint-units';
import { formatCalendarDate, formatCompactZoneLabel, formatDateTime, getTimezonePreference } from './timezone';

export interface FootprintCellTooltipContext {
  interval: string;
  timezone: string;
  quoteUnavailableHint?: string;
}

export interface FootprintCellTooltipSide {
  /** Value for the selected display unit, or null when the source did not report it. */
  value: number | null;
  /** The independently observed value in the other unit, or null when unavailable. */
  otherValue: number | null;
}

export interface FootprintCellTooltipData {
  time: number;
  interval: string;
  timezone: string;
  date: string;
  stamp: string;
  priceLow: number;
  priceHigh: number;
  units: FootprintUnits;
  bid: FootprintCellTooltipSide;
  ask: FootprintCellTooltipSide;
  total: number | null;
  delta: number | null;
  coverage: FootprintBar['coverage'];
  gapBefore: boolean;
  quoteUnavailableHint?: string;
}

/**
 * Build a compact tooltip from the canonical bar. `hover.cell` is only used to
 * confirm that the pointer is over a painted cell; its projected values may be
 * in another unit, so the raw bar remains the source of all amounts.
 */
export function footprintCellTooltipData(
  bar: FootprintBar,
  hover: FootprintHover,
  units: FootprintUnits,
  context: FootprintCellTooltipContext,
): FootprintCellTooltipData | null {
  if (hover.cell === null || hover.price === null || hover.time !== bar.time || !Number.isFinite(hover.price)) return null;
  const cell = bar.cells.find(item => item.price === hover.price);
  if (!cell || !Number.isFinite(bar.rowSize) || bar.rowSize <= 0) return null;

  const bidQuote = finiteNonNegative(cell.bidNotional);
  const askQuote = finiteNonNegative(cell.askNotional);
  const bidBase = finiteNonNegative(cell.bidVol);
  const askBase = finiteNonNegative(cell.askVol);
  const bid = units === 'btc' ? { value: bidBase, otherValue: bidQuote } : { value: bidQuote, otherValue: bidBase };
  const ask = units === 'btc' ? { value: askBase, otherValue: askQuote } : { value: askQuote, otherValue: askBase };
  const total = bid.value === null || ask.value === null ? null : bid.value + ask.value;
  const delta = bid.value === null || ask.value === null ? null : ask.value - bid.value;
  const timeMs = bar.time * 1000;
  return {
    time: bar.time,
    interval: context.interval,
    timezone: context.timezone,
    date: formatCalendarDate(timeMs, context.timezone),
    stamp: `${formatDateTime(timeMs, context.timezone)} ${formatCompactZoneLabel(timeMs, getTimezonePreference(), context.timezone)}`,
    priceLow: cell.price,
    priceHigh: cell.price + bar.rowSize,
    units,
    bid,
    ask,
    total,
    delta,
    coverage: bar.coverage,
    gapBefore: bar.gapBefore,
    quoteUnavailableHint: units === 'usdt' && (bid.value === null || ask.value === null) ? context.quoteUnavailableHint : undefined,
  };
}

/** Render with the shared compact indicator-tooltip structure and styles. */
export function renderFootprintCellTooltip(element: HTMLElement, data: FootprintCellTooltipData) {
  const node = (tag: string, className: string, text = '') => {
    const result = document.createElement(tag);
    result.className = className;
    result.textContent = text;
    return result;
  };
  const unit = data.units.toUpperCase();
  const otherUnit = data.units === 'btc' ? 'USDT' : 'BTC';
  const header = node('div', 'positioning-tooltip-header');
  header.append(node('span', '', data.stamp), node('span', 'positioning-tooltip-muted', data.interval));

  const heading = node('div', 'positioning-tooltip-heading');
  heading.append(node('strong', '', 'Footprint cell'), node('span', 'positioning-tooltip-muted', unit));
  const price = node('div', 'positioning-tooltip-muted positioning-tooltip-status',
    `${formatPrice(data.priceLow)}–${formatPrice(data.priceHigh)} USDT · upper bound excluded`);

  const rows = node('div', 'positioning-tooltip-sources');
  const maximum = Math.max(data.bid.value ?? 0, data.ask.value ?? 0, 0);
  for (const side of [
    { label: 'BID', direction: 'bid', color: 'var(--down, #ad5858)', amount: data.bid },
    { label: 'ASK', direction: 'ask', color: 'var(--up, #58a65c)', amount: data.ask },
  ]) {
    const row = node('div', 'positioning-tooltip-row');
    row.dataset.side = side.direction;
    const swatch = node('span', 'positioning-tooltip-swatch');
    swatch.style.backgroundColor = side.color;
    const track = node('span', 'positioning-tooltip-track');
    const fill = node('span', 'positioning-tooltip-fill');
    fill.style.backgroundColor = side.color;
    fill.style.width = `${maximum > 0 && side.amount.value !== null ? side.amount.value / maximum * 100 : 0}%`;
    track.append(fill);
    const amount = node('span', 'positioning-tooltip-amount', formatAmount(side.amount.value, unit));
    amount.append(node('small', 'positioning-tooltip-secondary', formatAmount(side.amount.otherValue, otherUnit)));
    row.append(swatch, node('span', 'positioning-tooltip-label', side.label), track, amount);
    rows.append(row);
  }

  const footer = node('div', 'positioning-tooltip-total');
  footer.append(
    node('span', 'positioning-tooltip-muted', `Cell total · ${formatAmount(data.total, unit)}`),
    node('strong', `positioning-tooltip-value${(data.delta ?? 0) < 0 ? ' negative' : (data.delta ?? 0) > 0 ? ' positive' : ''}`,
      `Δ ${formatAmount(data.delta, unit)}`),
  );
  const qualityText = data.coverage === 'observed' ? 'Observed activity'
    : data.coverage === 'partial' ? 'Some trades may be missing'
      : data.coverage === 'gapped' ? 'Earlier data missing'
        : 'Some trades may be missing · capacity limited';
  const earlierGap = data.gapBefore && data.coverage !== 'gapped' ? ' · Earlier data missing' : '';
  const quality = node('div', 'positioning-tooltip-muted positioning-tooltip-status',
    `${qualityText}${earlierGap}${data.quoteUnavailableHint ? ` · ${data.quoteUnavailableHint}` : ''}`);
  element.replaceChildren(header, heading, price, rows, footer, quality);
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatAmount(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return `N/A ${unit}`;
  const digits = unit === 'BTC' ? 6 : 2;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })} ${unit}`;
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

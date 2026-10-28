import { matrixDetailValue, matrixExactPrice } from './depth-matrix-presentation';
import type { DepthMatrixColumn, MatrixCoverage, MatrixRow } from './feed/depth-matrix';
import type { ClassifiedTrade } from './ticker/model';
import type { QuantityCurrency } from './currency-display';
import { instrumentOf } from './feed/protocol';
import { marketName } from './markets';
import { formatCalendarDate, formatTickerTime } from './timezone';

const node = (tag: string, className: string, text = '') => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
const number = (value: number, digits: number) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const coverageLabels: Record<MatrixCoverage, string> = { observed: 'observed', 'known-empty': 'known empty', partial: 'partial', unknown: 'unknown', stale: 'stale', disconnected: 'disconnected', syncing: 'syncing' };
export function depthSideObserved(quantity: number, coverage: MatrixCoverage) { return quantity > 0 || coverage === 'observed' || coverage === 'known-empty'; }
function amount(primary: string, secondary?: string, direction = '') {
  const element = node('span', `positioning-tooltip-amount positioning-tooltip-value ${direction}`, primary);
  if (secondary) element.append(node('small', 'positioning-tooltip-secondary', secondary));
  return element;
}
function metric(label: string, primary: string, secondary?: string, direction = '') {
  const element = node('div', 'market-tooltip-metric'); element.append(node('span', '', label), amount(primary, secondary, direction)); return element;
}
export function renderDepthMatrixCard(element: HTMLElement, data: { low: string; high: string; units: QuantityCurrency; column?: DepthMatrixColumn; row?: MatrixRow; age: string; midpoint?: string | null; reference?: boolean }) {
  const header = node('div', 'positioning-tooltip-header'); header.append(node('span', '', `$${data.low}–$${data.high}`), node('span', 'positioning-tooltip-muted', 'USDT'));
  const heading = node('div', 'positioning-tooltip-heading'); heading.append(node('strong', '', 'Depth Matrix'), node('span', 'positioning-tooltip-muted', data.column?.state === 'live' && data.column.message.startsWith('Fixture:') ? 'FIXTURE' : data.column?.state.toUpperCase() ?? 'NO BOOK'));
  const source = node('div', 'positioning-tooltip-muted positioning-tooltip-status', data.column?.label ?? 'No synchronized source');
  const rows = node('div', 'positioning-tooltip-sources');
  const maximum = Math.max(data.row?.bidQuantity ?? 0, data.row?.askQuantity ?? 0, 1e-12);
  for (const side of ['bid', 'ask'] as const) {
    const quantity = data.row?.[side === 'bid' ? 'bidQuantity' : 'askQuantity'] ?? 0, notional = data.row?.[side === 'bid' ? 'bidNotional' : 'askNotional'] ?? 0;
    const coverage = data.row?.[side === 'bid' ? 'bidCoverage' : 'askCoverage'] ?? 'unknown';
    const available = !!data.row && depthSideObserved(quantity, coverage);
    const row = node('div', 'positioning-tooltip-row'); row.dataset.side = side;
    const color = side === 'bid' ? 'var(--up)' : 'var(--down)';
    const swatch = node('span', 'positioning-tooltip-swatch'); swatch.style.background = color;
    const track = node('span', 'positioning-tooltip-track'), fill = node('span', 'positioning-tooltip-fill'); fill.style.background = color; fill.style.width = `${available ? quantity / maximum * 100 : 0}%`; track.append(fill);
    const base = `${matrixDetailValue(quantity, 8, false)} BTC`, quote = `${matrixDetailValue(notional, 2)} USDT`;
    row.append(swatch, node('span', 'positioning-tooltip-label', side.toUpperCase()), track, amount(available ? data.units === 'btc' ? base : quote : 'Not observed', available ? data.units === 'btc' ? quote : base : undefined));
    rows.append(row, node('div', 'positioning-tooltip-quality', `${side.toUpperCase()} · ${coverageLabels[coverage]}`));
  }
  const footer = node('div', 'positioning-tooltip-total positioning-tooltip-muted', `${data.age} · price range [low, high)`);
  const status = node('div', 'positioning-tooltip-status positioning-tooltip-muted', data.row ? data.column?.message ?? '' : `No synchronized row data${data.column ? ` · ${data.column.message}` : ''}`);
  const midpoint = node('div', 'positioning-tooltip-muted positioning-tooltip-status', data.midpoint == null ? ''
    : `${data.reference ? 'Selected reference' : 'Venue'} midpoint $${matrixExactPrice(data.midpoint)} · marker identifies bucket`);
  element.replaceChildren(header, heading, source, rows, footer, midpoint, status);
}

export interface TickerCardContext { timezone: string; units: QuantityCurrency; paused: boolean; histogram?: { maximum: number; seconds: number; start: number } }
export function renderTickerCard(element: HTMLElement, record: ClassifiedTrade, context: TickerCardContext) {
  const execution = record.execution, quoteUnit = instrumentOf(execution).quote;
  const header = node('div', 'positioning-tooltip-header'); header.append(node('span', '', formatCalendarDate(execution.timeMs, context.timezone)), node('span', '', formatTickerTime(execution.timeMs, context.timezone)));
  const direction = execution.side === 'buy' ? 'positive' : execution.side === 'sell' ? 'negative' : '';
  const heading = node('div', 'positioning-tooltip-heading'); heading.append(node('strong', '', 'Trade Ticker'), node('strong', `positioning-tooltip-value ${direction}`, execution.side === 'unknown' ? 'Unknown side' : execution.side === 'buy' ? 'Buy' : 'Sell'));
  const source = node('div', 'positioning-tooltip-muted positioning-tooltip-status', marketName(`${execution.venue}:${execution.market}`));
  const rows = node('div', 'positioning-tooltip-sources');
  rows.append(metric('Price', `${number(execution.price, 2)} ${quoteUnit}`));
  const base = `${number(execution.quantity, 8)} BTC`, quote = `${number(execution.quantity * execution.price, 2)} ${quoteUnit}`;
  rows.append(metric('Size', context.units === 'btc' ? base : quote, context.units === 'btc' ? quote : base, direction));
  if (record.tier) rows.append(metric('Tier', record.tier.name));
  if (context.histogram) rows.append(metric(`${context.histogram.seconds}s bar scale`, `${number(context.histogram.maximum, context.units === 'btc' ? 8 : 2)} ${context.units === 'btc' ? 'BTC' : quoteUnit}`, `${context.paused ? 'Frozen' : 'Rolling maximum'}${execution.timeMs < context.histogram.start ? ' · older visible print included' : ''}`));
  const footer = node('div', 'positioning-tooltip-total positioning-tooltip-muted', `${context.timezone} · ${execution.granularity} (reported print)`);
  const hint = node('div', 'positioning-tooltip-status positioning-tooltip-muted', 'Hover previews matching charts. Double-click or Enter saves a ray.');
  element.replaceChildren(header, heading, source, rows, footer, hint);
}

/** Same above/below placement as the chart cards, bounded by the widget. */
export function positionMarketCard(element: HTMLElement, host: HTMLElement, anchor: { left: number; top: number; right: number; bottom: number }) {
  element.hidden = false;
  const bounds = host.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight;
  const above = anchor.top - bounds.top - height - 8;
  const x = (anchor.left + anchor.right) / 2 - bounds.left - width / 2;
  const y = above >= 4 ? above : anchor.bottom - bounds.top + 8;
  element.style.left = `${Math.max(4, Math.min(bounds.width - width - 4, x))}px`;
  element.style.top = `${Math.max(4, Math.min(bounds.height - height - 4, y))}px`;
}

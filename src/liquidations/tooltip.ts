import { venueBadge, venueIconPath } from '../chart/venue-label';
import type { LiquidationBar } from './engine';
import type { LiquidatedSide, LiquidationVenue } from './model';
import { liquidationColour } from './colors';

interface LiquidationTooltipData {
  bar: LiquidationBar;
  side: LiquidatedSide;
  venues: readonly LiquidationVenue[];
  units: 'BTC' | 'USDT';
  intervalMs: number;
  quality: string;
  light: boolean;
}

/** Match the positioning card without describing reported liquidations as net
 * positioning, signed flow, or complete exchange-wide liquidation volume. */
export function renderLiquidationTooltip(element: HTMLElement, data: LiquidationTooltipData) {
  const node = (tag: string, className: string, text = '') => {
    const result = document.createElement(tag);
    result.className = className; result.textContent = text; return result;
  };
  const quantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: data.units === 'BTC' && value > 0 && value < .001 ? 8 : 3 });
  const values = data.side === 'LONG' ? data.bar.longs : data.bar.shorts;
  const total = data.venues.reduce((sum, venue) => sum + values[venue], 0);
  const colour = liquidationColour(data.side, data.light);
  const date = new Date(data.bar.time);
  const stamp = `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${date.toISOString().slice(11, 16)} UTC`;
  const interval = data.intervalMs >= 3_600_000 ? `${data.intervalMs / 3_600_000}h` : `${data.intervalMs / 60_000}m`;
  const header = node('div', 'positioning-tooltip-header');
  header.append(node('span', '', stamp), node('span', 'positioning-tooltip-muted', interval));
  const heading = node('div', 'positioning-tooltip-heading');
  const totalValue = node('strong', 'positioning-tooltip-value', `${quantity(total)} ${data.units}`);
  totalValue.style.color = colour;
  heading.append(node('strong', '', `${data.side === 'LONG' ? 'Long' : 'Short'} liquidations`), totalValue);
  const rows = node('div', 'positioning-tooltip-sources');
  const max = Math.max(...data.venues.map(venue => values[venue]), Number.MIN_VALUE);
  for (const venue of data.venues) {
    const row = node('div', 'positioning-tooltip-row'); row.dataset.venue = venue;
    const swatch = node('span', 'positioning-tooltip-swatch'); swatch.style.backgroundColor = colour;
    const label = node('span', 'positioning-tooltip-label positioning-tooltip-venue');
    label.setAttribute('aria-label', venue === 'bybit' ? 'Bybit perpetual' : 'Binance perpetual');
    const icon = document.createElement('img'); icon.src = venueIconPath(venue); icon.alt = ''; icon.width = 12; icon.height = 12;
    label.append(icon, document.createTextNode(venueBadge(venue)));
    const track = node('span', 'positioning-tooltip-track');
    const fill = node('span', 'positioning-tooltip-fill');
    fill.style.width = `${values[venue] / max * 100}%`; fill.style.backgroundColor = colour; track.append(fill);
    const amount = node('span', 'positioning-tooltip-amount', `${quantity(values[venue])} ${data.units}`);
    amount.append(node('small', 'positioning-tooltip-secondary', venue === 'bybit' ? data.units === 'BTC' ? 'Reported size' : 'Bankruptcy price' : 'Sampled reports'));
    row.append(swatch, label, track, amount); rows.append(row);
  }
  const footer = node('div', 'positioning-tooltip-total');
  const amount = node('strong', 'positioning-tooltip-value', `${quantity(total)} ${data.units}`); amount.style.color = colour;
  footer.append(node('span', 'positioning-tooltip-muted', `Reported (${data.venues.length} ${data.venues.length === 1 ? 'venue' : 'venues'})`), amount);
  const status = node('div', 'positioning-tooltip-muted positioning-tooltip-status', data.quality);
  element.replaceChildren(header, heading, rows, footer, status);
}

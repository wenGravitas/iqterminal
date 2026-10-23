import type { NetPositioningPane } from './chart/net-positioning';

type Summary = NonNullable<ReturnType<NetPositioningPane['hoverSummary']>>;
const quantity = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 3 })}`;

export function renderPositioningTooltip(element: HTMLElement, data: Summary) {
  const node = (tag: string, className: string, text = '') => {
    const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
  };
  const date = new Date(data.timeMs);
  const stamp = `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${date.toISOString().slice(11, 16)} UTC`;
  const interval = data.intervalMs >= 3_600_000 ? `${data.intervalMs / 3_600_000}h` : `${data.intervalMs / 60_000}m`;
  const header = node('div', 'positioning-tooltip-header');
  header.append(node('span', '', stamp), node('span', 'positioning-tooltip-muted', interval));
  const title = node('div', 'positioning-tooltip-heading');
  const incomplete = data.sources.some(source => source.quality !== 'complete');
  const available = data.sources.some(source => source.value !== null);
  const unit = data.currency === 'btc' ? 'BTC' : 'USD quote';
  const total = available ? `${quantity(data.total)} ${unit}` : 'Unavailable';
  const direction = data.total < 0 ? 'negative' : 'positive';
  title.append(node('strong', '', `Net ${data.side === 'longs' ? 'Longs' : 'Shorts'} (Est.)`), node('strong', `positioning-tooltip-value ${direction}`, total));
  const rows = node('div', 'positioning-tooltip-sources');
  const max = Math.max(...data.sources.map(source => Math.abs(source.value ?? 0)), 1);
  for (const source of data.sources) {
    const row = node('div', 'positioning-tooltip-row');
    const swatch = node('span', 'positioning-tooltip-swatch'); swatch.style.backgroundColor = source.color;
    const label = node('span', 'positioning-tooltip-label', source.label);
    const track = node('span', 'positioning-tooltip-track'), fill = node('span', 'positioning-tooltip-fill');
    fill.style.width = `${Math.abs(source.value ?? 0) / max * 100}%`; fill.style.backgroundColor = source.color; track.append(fill);
    const sourceUnit = data.currency === 'btc' ? 'BTC' : source.sourceId === 'binance' ? 'USDT' : 'USD';
    const amount = node('span', 'positioning-tooltip-amount', source.value === null ? `N/A ${sourceUnit}` : `${quantity(source.value)} ${sourceUnit}`);
    const other = data.currency === 'btc' ? source.quoteValue : source.baseValue;
    amount.append(node('small', 'positioning-tooltip-secondary', other === null ? `N/A ${data.currency === 'btc' ? source.sourceId === 'binance' ? 'USDT' : 'USD' : 'BTC'}` : `${quantity(other)} ${data.currency === 'btc' ? source.sourceId === 'binance' ? 'USDT' : 'USD' : 'BTC'}`));
    row.append(swatch, label, track, amount);
    rows.append(row);
    if (source.quality !== 'complete') rows.append(node('div', 'positioning-tooltip-quality', `${source.label}: ${source.quality}`));
  }
  const footer = node('div', 'positioning-tooltip-total');
  footer.append(node('span', 'positioning-tooltip-muted', `${incomplete ? 'Subtotal' : 'Total'} (${data.sources.length} venues)`), node('strong', `positioning-tooltip-value ${direction}`, available ? quantity(data.total) : 'N/A'));
  const otherValues = data.sources.map(source => data.currency === 'btc' ? source.quoteValue : source.baseValue);
  const otherTotal = otherValues.some(value => value === null) ? null : otherValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  footer.lastElementChild?.append(node('small', 'positioning-tooltip-secondary', otherTotal === null ? 'Other currency unavailable' : `${quantity(otherTotal)} ${data.currency === 'btc' ? 'USD quote' : 'BTC'}`));
  const status = node('div', 'positioning-tooltip-muted positioning-tooltip-status', `${data.method === 'price-oi' ? 'Price + OI' : 'Aggressor Flow + OI'}${data.provisional ? ' · Forming bar' : ''} · Quote estimated at source interval ending prices`);
  element.replaceChildren(header, title, rows, footer, status);
}

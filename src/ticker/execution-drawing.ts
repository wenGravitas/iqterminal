import type { NormalizedExecution } from '../feed/footprint';

const quantityFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const priceFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const quoteFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Plain-text details for one venue-reported execution, kept on its native ray. */
export function executionRayLabel(execution: NormalizedExecution) {
  const venue = execution.venue === 'binance' ? 'BINANCE' : execution.venue === 'bybit' ? 'BYBIT' : 'HYPERLIQUID';
  const market = execution.market === 'spot' ? 'SPOT' : 'PERP';
  const side = execution.side === 'unknown' ? 'UNKNOWN' : execution.side.toUpperCase();
  const granularity = execution.granularity === 'aggregate-trade' ? 'AGG PRINT' : 'TRADE';
  const quote = execution.venue !== 'hyperliquid' ? 'USDT' : 'USD';
  const notional = Number(execution.quoteNotionalText);
  const quoteValue = Number.isFinite(notional) ? notional : execution.price * execution.quantity;
  const time = Number.isFinite(execution.timeMs) ? new Date(execution.timeMs).toISOString().slice(11, 23) : 'unknown time';
  return `${venue} ${market} · ${side} · ${granularity}\n${quantityFormat.format(execution.quantity)} BTC @ ${priceFormat.format(execution.price)} ${quote} · ${quoteFormat.format(quoteValue)} ${quote} · ${time} UTC`;
}

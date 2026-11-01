import Decimal from 'decimal.js';
import { hyperliquidPriceQuantum, marketIocLimit, validateOrderNotional, validatePrice } from '../src/trading/model.ts';

export const TARGET_NOTIONAL = new Decimal('11.5');
export const MAX_ORDER_NOTIONAL = new Decimal('13.5');
export const MAX_POSITION_NOTIONAL = new Decimal('15');
export const IOC_SLIPPAGE_BPS = 50;
export const MAX_POSITION_LIFETIME_MS = 60_000;
export const RECONCILE_TIMEOUT_MS = 12_000;

export function safePublicError(error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.slice(0, 240).replace(/0x[\da-f]{64,}/gi, '[redacted hex]');
}

export function executionOptIn(args, env) {
  const accepted = args.filter(arg => arg === '--execute-testnet');
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter(arg => arg !== '--execute-testnet' && arg !== '--dry-run');
  if (unknown.length) throw new Error('Only --execute-testnet is supported; mainnet actions are not supported.');
  if (accepted.length > 1) throw new Error('Pass --execute-testnet at most once.');
  if (dryRun && accepted.length) throw new Error('Do not combine --dry-run with --execute-testnet.');
  const envValue = env.HYPERLIQUID_TESTNET_EXECUTION_OPT_IN;
  if (envValue && envValue !== '1') throw new Error('HYPERLIQUID_TESTNET_EXECUTION_OPT_IN must be exactly 1.');
  if (dryRun) return false;
  return accepted.length === 1 || envValue === '1';
}

export function assertTestnetEnvironment(env) {
  for (const [name, value] of Object.entries(env)) {
    if (!value || !/(?:HYPERLIQUID|^HL_|TRADING).*(?:NETWORK|API_URL|RPC_URL|ENDPOINT)/i.test(name)) continue;
    if (/NETWORK/i.test(name)) {
      if (String(value).trim().toLowerCase() !== 'testnet') {
        throw new Error(`${name} must be testnet; this runner refuses a mainnet or unknown network selection.`);
      }
      continue;
    }
    let hostname = '';
    try { hostname = new URL(String(value)).hostname.toLowerCase(); } catch { /* reject below */ }
    const expectedHost = /RPC_URL/i.test(name) ? 'rpc.hyperliquid-testnet.xyz' : 'api.hyperliquid-testnet.xyz';
    if (hostname !== expectedHost) throw new Error(`${name} must use the fixed Hyperliquid testnet endpoint.`);
  }
}

function positive(value, label) {
  let result;
  try { result = new Decimal(value); } catch { throw new Error(`${label} is unavailable`); }
  if (!result.isFinite() || !result.gt(0)) throw new Error(`${label} is unavailable`);
  return result;
}

function quantizedPrice(value, szDecimals, rounding) {
  const price = positive(value, 'BTC price');
  const quantum = hyperliquidPriceQuantum(price, szDecimals);
  const quantized = price.div(quantum).toDecimalPlaces(0, rounding).mul(quantum);
  const text = quantized.toFixed(Math.max(0, quantized.decimalPlaces()));
  const error = validatePrice(text, szDecimals);
  if (error) throw new Error(`The live BTC metadata cannot produce a valid order price: ${error}`);
  return text;
}

function ceilSize(notional, price, szDecimals) {
  const unit = new Decimal(10).pow(-szDecimals);
  return new Decimal(notional).div(price).div(unit).toDecimalPlaces(0, Decimal.ROUND_CEIL).mul(unit).toFixed(szDecimals);
}

function boundedNotional(size, price, label) {
  const amount = positive(size, `${label} size`).mul(positive(price, `${label} price`));
  if (amount.lt(10) || amount.gt(MAX_ORDER_NOTIONAL)) {
    throw new Error(`${label} notional ${amount.toFixed(2)} is outside the $10 to $13.50 safe test range.`);
  }
  return amount.toFixed(2);
}

export function buildAcceptancePlan({ markPrice, midPrice, szDecimals }) {
  const mark = positive(markPrice, 'Live BTC mark price');
  const mid = positive(midPrice, 'Live BTC midpoint');
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) throw new Error('Live BTC size precision is unavailable.');
  if (mark.minus(mid).abs().div(mid).gt('0.02')) throw new Error('Live BTC mark and midpoint differ by more than 2%; refusing stale or inconsistent prices.');

  const gtcPrice = quantizedPrice(mark.mul('0.70'), szDecimals, Decimal.ROUND_FLOOR);
  const modifiedGtcPrice = quantizedPrice(mark.mul('0.72'), szDecimals, Decimal.ROUND_FLOOR);
  const gtcSize = ceilSize(TARGET_NOTIONAL, gtcPrice, szDecimals);
  const gtcNotional = boundedNotional(gtcSize, gtcPrice, 'Initial GTC');
  const modifiedGtcNotional = boundedNotional(gtcSize, modifiedGtcPrice, 'Modified GTC');
  const iocLimitPrice = marketIocLimit(mid.toString(), 'buy', IOC_SLIPPAGE_BPS, szDecimals);
  const iocSize = ceilSize(TARGET_NOTIONAL, iocLimitPrice, szDecimals);
  const iocLimitNotional = boundedNotional(iocSize, iocLimitPrice, 'Protected IOC');
  const takeProfitPrice = quantizedPrice(mark.mul('1.05'), szDecimals, Decimal.ROUND_CEIL);
  const stopLossPrice = quantizedPrice(mark.mul('0.95'), szDecimals, Decimal.ROUND_FLOOR);
  if (validateOrderNotional(iocSize, iocLimitPrice)) throw new Error('The IOC size is below Hyperliquid’s minimum order notional.');
  return {
    gtc: { side: 'buy', size: gtcSize, price: gtcPrice, notional: gtcNotional, modifiedPrice: modifiedGtcPrice, modifiedNotional: modifiedGtcNotional },
    entryIoc: { side: 'buy', size: iocSize, limitPrice: iocLimitPrice, limitNotional: iocLimitNotional, slippageBps: IOC_SLIPPAGE_BPS },
    takeProfit: { side: 'sell', triggerPrice: takeProfitPrice, limitPrice: takeProfitPrice },
    stopLoss: { side: 'sell', triggerPrice: stopLossPrice, limitPrice: stopLossPrice },
    targetNotional: TARGET_NOTIONAL.toFixed(2), maxOrderNotional: MAX_ORDER_NOTIONAL.toFixed(2),
    maxPositionNotional: MAX_POSITION_NOTIONAL.toFixed(2), maxPositionLifetimeSeconds: MAX_POSITION_LIFETIME_MS / 1000,
  };
}

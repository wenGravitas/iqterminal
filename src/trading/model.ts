import Decimal from 'decimal.js';

export type TradingNetwork = 'testnet' | 'mainnet';
export type FeedState = 'disconnected' | 'connecting' | 'live' | 'stale' | 'failed';
export type OrderPhase = 'submitting' | 'resting' | 'partiallyFilled' | 'filled' | 'triggering' | 'canceled' | 'rejected' | 'unknown';
export type TradingOrderOperationKind = 'modify' | 'cancel';
export type TradingOrderOperationPhase = 'pending' | 'reconciling' | 'unknown' | 'rejected';

export interface TradingOrderOperation {
  orderId: number;
  resolvedOrderId?: number;
  possibleOrderIds?: number[];
  priorOrderIds: number[];
  cloid: string | null;
  side: 'buy' | 'sell';
  reduceOnly: boolean;
  trigger: boolean;
  orderKind: TradingOrder['kind'];
  kind: TradingOrderOperationKind;
  phase: TradingOrderOperationPhase;
  createdAt: number;
  updatedAt: number;
  message: string;
  requestedPrice?: string;
  requestedSize?: string;
}

export interface TradingPosition {
  coin: string;
  size: string;
  side: 'long' | 'short';
  entryPrice: string | null;
  unrealizedPnl: string | null;
  liquidationPrice: string | null;
  leverage: string | null;
}

export interface TradingOrder {
  coin: string;
  id: number;
  cloid: string | null;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  originalSize: string;
  timestamp: number;
  status: string;
  reduceOnly: boolean;
  trigger: boolean;
  triggerPrice: string | null;
  triggerMarket: boolean;
  kind: 'limit' | 'takeProfit' | 'stopLoss' | 'trigger';
}

export interface TradingFill {
  id: string;
  coin: string;
  orderId: number | null;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  time: number;
  fee: string;
  closedPnl: string;
}

export interface TradingSnapshot {
  network: TradingNetwork;
  principal: string;
  feedState: FeedState;
  lastMessageAt: number;
  lastSnapshotAt: number;
  accountValue: string | null;
  marginUsed: string | null;
  withdrawable: string | null;
  totalNotional: string | null;
  positions: TradingPosition[];
  orders: TradingOrder[];
  fills: TradingFill[];
  /** Exact exchange mutation states for open BTC orders; never inferred as canceled. */
  orderOperations?: TradingOrderOperation[];
  midPrice: string | null;
  midPriceUpdatedAt: number;
  markPrice: string | null;
  markPriceUpdatedAt: number;
  szDecimals: number | null;
  btcAsset: number | null;
  /** Live BTC universe cap from the venue's current metadata. */
  btcMaxLeverage?: number | null;
  /** Current configured BTC leverage from activeAssetData. */
  btcLeverage?: number | null;
  /** Venue-reported per-direction trade capacity from activeAssetData. */
  btcAvailableToTrade?: [string, string] | null;
  agentAddress: string | null;
  agentAuthorized: boolean;
  agentValidUntil: number | null;
  error: string | null;
}

export interface OrderIntent {
  side: 'buy' | 'sell';
  size: string;
  price: string;
  reduceOnly: boolean;
  tif: 'Gtc' | 'Ioc';
  cloid: string;
}

export interface OrderAttempt {
  cloid: string;
  network: TradingNetwork;
  principal: string;
  intent: OrderIntent;
  phase: OrderPhase;
  createdAt: number;
  updatedAt: number;
  exchangeId: number | null;
  /** Cumulative confirmed fill size when known. Older stored attempts may omit it. */
  filledSize?: string;
  /** Current remaining size when known. Older stored attempts may omit it. */
  remainingSize?: string;
  message: string;
}

export const TRADING_SNAPSHOT_KEY = 'basis.hyperliquid.trading.v1';
export const TRADING_PANEL_ID = 'hyperliquid-trading';
export const TRADING_DEFAULTS = Object.freeze({
  network: 'testnet' as TradingNetwork,
  address: '',
  slippageBps: 50,
});

export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function validDecimalText(value: string) {
  return /^(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

export function positiveDecimal(value: string) {
  try {
    const parsed = new Decimal(value.trim());
    return parsed.isFinite() && parsed.gt(0) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateSize(value: string, szDecimals: number): string | null {
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) return 'BTC size precision is not available yet';
  if (!validDecimalText(value)) return 'Enter a decimal BTC size without exponent notation';
  const amount = positiveDecimal(value);
  if (!amount) return 'Enter a positive size';
  if (amount.decimalPlaces() > szDecimals) return `Size allows at most ${szDecimals} decimal places`;
  return null;
}

export function validateOrderNotional(size: string, limitPrice: string): string | null {
  const amount = positiveDecimal(size), price = positiveDecimal(limitPrice);
  if (!amount || !price) return 'A positive order size and limit price are required';
  if (amount.mul(price).lt(10)) return 'Hyperliquid BTC orders must be at least $10 notional at the limit price';
  return null;
}

export function validateLeverage(value: number, maxLeverage: number | null | undefined): string | null {
  if (!Number.isSafeInteger(value) || value < 1) return 'Leverage must be a positive whole number';
  if (!Number.isSafeInteger(maxLeverage) || !maxLeverage || maxLeverage < 1) return 'Current BTC maximum leverage is unavailable; refresh account metadata';
  return value <= maxLeverage ? null : `BTC leverage exceeds the current venue maximum of ${maxLeverage}x`;
}

/** Margin needed for a new/increased non-reduce-only order under the actual BTC leverage setting. */
export function validateAvailableMargin(size: string, price: string, leverage: number | null | undefined, availableMargin: string | null, alreadyReservedNotional = '0'): string | null {
  const amount = positiveDecimal(size), limit = positiveDecimal(price);
  if (!amount || !limit) return 'A positive order size and price are required to check available margin';
  if (!Number.isSafeInteger(leverage) || !leverage || leverage < 1) return 'Current BTC leverage is unavailable; refresh active asset data before opening exposure';
  const available = nonnegativeDecimal(availableMargin ?? '');
  if (!available) return 'Available account margin is unavailable from the fresh account snapshot';
  const reserved = nonnegativeDecimal(alreadyReservedNotional);
  if (!reserved) return 'Current order reservation is unavailable for margin validation';
  const required = Decimal.max(amount.mul(limit).minus(reserved), 0).div(leverage);
  if (required.gt(available)) return `Insufficient available margin: this order needs about $${required.toFixed(2)} at ${leverage}x; $${available.toFixed(2)} is available`;
  return null;
}

export function validateReduceOnlyOrder(side: OrderIntent['side'], size: string, position: TradingPosition | undefined): string | null {
  if (!position) return 'A reduce-only BTC order requires a current open BTC position';
  const reducingSide = position.side === 'long' ? 'sell' : 'buy';
  if (side !== reducingSide) return `Reduce-only ${position.side} orders must use the ${reducingSide.toUpperCase()} side`;
  const amount = positiveDecimal(size), available = positiveDecimal(position.size);
  if (!amount || !available) return 'Current BTC position size is unavailable for reduce-only validation';
  if (amount.gt(available)) return `Reduce-only size exceeds the current ${position.side} position of ${position.size} BTC`;
  return null;
}

export function validateTriggerOrientation(kind: 'takeProfit' | 'stopLoss', side: OrderIntent['side'], triggerPrice: string, markPrice: string | null): string | null {
  const trigger = positiveDecimal(triggerPrice), mark = positiveDecimal(markPrice ?? '');
  if (!trigger || !mark) return 'A fresh live BTC mark is required to validate trigger direction';
  const takeProfitAbove = side === 'sell';
  const correctlyOriented = kind === 'takeProfit'
    ? takeProfitAbove ? trigger.gt(mark) : trigger.lt(mark)
    : takeProfitAbove ? trigger.lt(mark) : trigger.gt(mark);
  if (correctlyOriented) return null;
  return kind === 'takeProfit'
    ? `Take-profit trigger must be beyond the live mark (${side === 'sell' ? 'above' : 'below'} ${mark.toString()})`
    : `Stop-loss trigger must be beyond the live mark (${side === 'sell' ? 'below' : 'above'} ${mark.toString()})`;
}

export function closePositionSize(positionSize: string, percent: 25 | 50 | 100, szDecimals: number): string {
  const amount = positiveDecimal(positionSize);
  if (!amount) throw new RangeError('The current BTC position size is unavailable');
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) throw new RangeError('BTC size precision is not available');
  const rounded = amount.mul(percent).div(100).toDecimalPlaces(szDecimals, Decimal.ROUND_DOWN);
  if (!rounded.gt(0)) throw new RangeError(`Close ${percent}% rounds below the minimum BTC size`);
  return rounded.toFixed(Math.max(0, rounded.decimalPlaces()));
}

export function validatePrice(value: string, szDecimals: number): string | null {
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) return 'BTC price precision is not available yet';
  if (!validDecimalText(value)) return 'Enter a decimal price without exponent notation';
  const price = positiveDecimal(value);
  if (!price) return 'Enter a positive price';
  if (price.decimalPlaces() > 6 - szDecimals) return `Price allows at most ${6 - szDecimals} decimal places`;
  if (!price.isInteger() && price.sd() > 5) return 'Non-integer prices allow at most 5 significant figures';
  return null;
}

/** Hyperliquid perps require <= 5 significant figures and <= 6-szDecimals fractional places. */
export function hyperliquidPriceQuantum(priceValue: string | Decimal, szDecimals: number): Decimal {
  const price = priceValue instanceof Decimal ? priceValue : new Decimal(priceValue);
  if (!price.isFinite() || !price.gt(0) || !Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) {
    throw new RangeError('Price and size precision metadata must be positive and valid');
  }
  const maxFractionDigits = 6 - szDecimals;
  const exponent = price.e - 4;
  const significant = new Decimal(10).pow(exponent);
  const decimalFloor = new Decimal(10).pow(-maxFractionDigits);
  return Decimal.max(significant, decimalFloor);
}

/** Price protection for IOC market orders; rounds outward to a valid Hyperliquid price quantum. */
export function marketIocLimit(midValue: string, side: 'buy' | 'sell', slippageBps: number, szDecimals: number): string {
  const mid = positiveDecimal(midValue);
  if (!mid) throw new RangeError('A fresh positive Hyperliquid BTC mid price is required');
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new RangeError('Slippage must be 10–500 basis points');
  const factor = new Decimal(10_000 + (side === 'buy' ? slippageBps : -slippageBps)).div(10_000);
  const bound = mid.mul(factor);
  const quantum = hyperliquidPriceQuantum(bound, szDecimals);
  const rounding = side === 'buy' ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR;
  const quantized = bound.div(quantum).toDecimalPlaces(0, rounding).mul(quantum);
  const text = quantized.toFixed(Math.max(0, quantized.decimalPlaces()));
  const error = validatePrice(text, szDecimals);
  if (error) throw new RangeError(`Unable to construct a valid market IOC limit: ${error}`);
  return text;
}

export function orderIntent(input: Omit<OrderIntent, 'cloid'>, cloid = newClientOrderId()): OrderIntent {
  return { ...input, cloid };
}

export function newClientOrderId(random: Crypto = crypto): string {
  const bytes = random.getRandomValues(new Uint8Array(16));
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function orderPhaseFromStatus(status: string): OrderPhase {
  const normalized = status.toLowerCase();
  if (normalized === 'partiallyfilled' || normalized === 'partially filled' || normalized === 'partial') return 'partiallyFilled';
  if (normalized === 'filled') return 'filled';
  if (normalized === 'canceled' || normalized.endsWith('canceled')) return 'canceled';
  if (normalized === 'rejected' || normalized.endsWith('rejected')) return 'rejected';
  if (normalized === 'triggered' || normalized === 'waitingfortrigger' || normalized === 'waiting for trigger') return 'triggering';
  if (normalized === 'open' || normalized === 'resting' || normalized === 'working') return 'resting';
  return 'unknown';
}

/** Open-order `size` is the remainder; `originalSize` is the requested total. */
export function orderFilledSize(order: Pick<TradingOrder, 'size' | 'originalSize'>) {
  const original = positiveDecimal(order.originalSize);
  let remaining: Decimal;
  try { remaining = new Decimal(order.size); } catch { return '0'; }
  if (!original || !remaining.isFinite() || remaining.lt(0)) return '0';
  return Decimal.max(original.minus(remaining), 0).toString();
}
function nonnegativeDecimal(value: string) {
  try { const parsed = new Decimal(value); return parsed.isFinite() && parsed.gte(0) ? parsed : null; }
  catch { return null; }
}

export function reconcileOrderAttempt(attempt: OrderAttempt, orders: readonly TradingOrder[], status?: string): OrderAttempt {
  const order = orders.find(item => item.cloid?.toLowerCase() === attempt.cloid.toLowerCase()
    || attempt.exchangeId !== null && item.id === attempt.exchangeId);
  const now = Date.now();
  if (order) {
    const statusPhase = orderPhaseFromStatus(order.status);
    const filledSize = statusPhase === 'filled' ? (positiveDecimal(order.originalSize)?.toString() ?? attempt.intent.size) : orderFilledSize(order);
    const remainingSize = statusPhase === 'filled' ? '0' : order.size;
    const filled = positiveDecimal(filledSize);
    const remaining = nonnegativeDecimal(remainingSize);
    const phase = statusPhase === 'filled' ? 'filled'
      : statusPhase === 'canceled' || statusPhase === 'rejected' || statusPhase === 'triggering' ? statusPhase
        : filled && filled.gt(0) && remaining && remaining.gt(0) ? 'partiallyFilled'
          : remaining && remaining.isZero() && filled && filled.gt(0) ? 'unknown'
            : 'resting';
    const message = phase === 'partiallyFilled'
      ? `Partially filled ${filledSize} of ${order.originalSize}; ${remainingSize} BTC remains open`
      : phase === 'filled' ? 'Order status confirms the full requested size filled'
        : phase === 'unknown' ? 'Observed fills cover the order size; waiting for authoritative order status'
          : `Found in the live open-order snapshot · ${order.status}`;
    return { ...attempt, phase, exchangeId: order.id, filledSize, remainingSize, updatedAt: now, message };
  }
  if (status) {
    const phase = orderPhaseFromStatus(status);
    if (phase === 'filled') {
      return { ...attempt, phase, filledSize: attempt.intent.size, remainingSize: '0', updatedAt: now, message: `Exchange order status: ${status}` };
    }
    if (phase === 'partiallyFilled') return { ...attempt, phase, updatedAt: now, message: `Exchange order status: ${status}` };
    if (phase === 'resting' && attempt.phase === 'partiallyFilled') {
      return { ...attempt, updatedAt: now, message: `Exchange order remains open · ${attempt.filledSize ?? 'some'} BTC filled · ${attempt.remainingSize ?? 'unknown'} BTC remaining` };
    }
    if (phase !== 'unknown') return { ...attempt, phase, updatedAt: now, message: `Exchange order status: ${status}` };
  }
  return attempt;
}

const PRICE_FRESHNESS_MS = 5_000;
function isFreshQuote(price: string | null, updatedAt: number, now: number) {
  return price !== null && updatedAt > 0 && now >= updatedAt && now - updatedAt <= PRICE_FRESHNESS_MS
    && positiveDecimal(price) !== null;
}

export function isFreshMidPrice(snapshot: TradingSnapshot, now = Date.now()) {
  return isFreshQuote(snapshot.midPrice, snapshot.midPriceUpdatedAt, now);
}

export function isFreshMarkPrice(snapshot: TradingSnapshot, now = Date.now()) {
  return isFreshQuote(snapshot.markPrice, snapshot.markPriceUpdatedAt, now);
}

export function isFreshPrice(snapshot: TradingSnapshot, now = Date.now()) {
  return snapshot.feedState === 'live' && isFreshMidPrice(snapshot, now);
}


import { compareDecimalText, multiplyDecimalText } from '../feed/decimal';
import { LIQUIDATION_MAX_MESSAGE_RECORDS, type LiquidationEvent, type LiquidationParse, type LiquidationReject, type LiquidationVenue } from './model';

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 8_640_000_000_000_000;
/** Bound decimal work at the untrusted wire boundary; products retain exact text. */
function decimal(value: unknown, zero = false): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{1,20}(?:\.\d{1,18})?$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER || (zero ? n < 0 : n <= 0)) return null;
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole!.replace(/^0+(?=\d)/, '')}${trimmed ? `.${trimmed}` : ''}`;
}
const rejected = (reason: LiquidationReject, index = -1): LiquidationParse => ({ events: [], rejected: [{ index, reason }], ignored: false });
const ignored = (): LiquidationParse => ({ events: [], rejected: [], ignored: true });
function base(venue: LiquidationVenue, timeMs: number, eventTimeMs: number, receivedAtMs: number) {
  return {
    version: 1 as const, kind: 'actual-liquidation-report' as const,
    nativeEventId: null, identityBasis: 'reported-fields-and-occurrence' as const,
    venue, instrument: `${venue}:perpetual:BTCUSDT` as const, market: 'perpetual' as const, nativeSymbol: 'BTCUSDT' as const,
    contract: { type: 'linear-perpetual' as const, base: 'BTC' as const, quote: 'USDT' as const, settlement: 'USDT' as const,
      nativeQuantityUnit: 'BTC' as const, basePerNativeUnit: '1' as const },
    timeMs, eventTimeMs, receivedAtMs,
  };
}
function notional(price: string, quantity: string): { text: string; value: number } | null {
  const text = multiplyDecimalText(price, quantity), value = Number(text);
  // Exact strings remain the authority; finite Number values are for the renderer.
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? { text, value } : null;
}

/** Bybit S is POSITION side: Buy = liquidated long; p is BANKRUPTCY price.
 * Parse every record, keeping valid siblings when one record is malformed.
 * https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation
 */
export function parseBybitLiquidations(raw: unknown, receivedAtMs: number): LiquidationParse {
  const envelope = object(raw);
  if (!envelope || typeof envelope.topic !== 'string' || !envelope.topic.startsWith('allLiquidation.')) return ignored();
  if (envelope.topic !== 'allLiquidation.BTCUSDT') return rejected('symbol');
  if (envelope.type !== 'snapshot' || !Array.isArray(envelope.data)) return rejected('envelope');
  if (!timestamp(envelope.ts) || !timestamp(receivedAtMs)) return rejected('time');
  if (envelope.data.length > LIQUIDATION_MAX_MESSAGE_RECORDS) return rejected('capacity');
  const result: LiquidationParse = { events: [], rejected: [], ignored: false }, counts = new Map<string, number>();
  for (let index = 0; index < envelope.data.length; index++) {
    const record = object(envelope.data[index]);
    const reject = (reason: LiquidationReject) => result.rejected.push({ index, reason });
    if (!record) { reject('envelope'); continue; }
    if (record.s !== 'BTCUSDT') { reject('symbol'); continue; }
    if (!timestamp(record.T)) { reject('time'); continue; }
    if (record.S !== 'Buy' && record.S !== 'Sell') { reject('side'); continue; }
    const price = decimal(record.p), quantity = decimal(record.v);
    if (price === null) { reject('price'); continue; }
    if (quantity === null) { reject('quantity'); continue; }
    const value = notional(price, quantity);
    if (!value) { reject('notional'); continue; }
    const key = `bybit:perpetual:BTCUSDT:liq:${record.T}:${record.S}:${price}:${quantity}`;
    const occurrence = counts.get(key) ?? 0; counts.set(key, occurrence + 1);
    result.events.push({
      ...base('bybit', record.T, envelope.ts, receivedAtMs), id: `${key}:${occurrence}`,
      liquidatedSide: record.S === 'Buy' ? 'LONG' : 'SHORT', forcedDirection: record.S === 'Buy' ? 'SELL' : 'BUY',
      reportedPrice: Number(price), reportedPriceText: price, priceType: 'bankruptcy',
      baseQuantity: Number(quantity), baseQuantityText: quantity, quantityBasis: 'reported-executed-size',
      quoteNotional: value.value, quoteNotionalText: value.text, notionalBasis: 'bankruptcy-price-times-size',
      source: 'bybit-v5-allLiquidation', reportingCoverage: 'all-reported-liquidations',
      provenance: { identityLimitation: 'no-native-event-id', reportedSide: record.S, sideMeaning: 'liquidated-position', forcedDirectionBasis: 'opposite-reported-position-side', occurrence, recordIndex: index },
    });
  }
  return result;
}

/** Binance S is forced ORDER direction. z/ap describe cumulative filled size
 * and average fill price; q/p are original size/order price and are not fills.
 * The stream reports the latest event per symbol per second, not complete volume.
 * https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
 */
export function parseBinanceLiquidations(raw: unknown, receivedAtMs: number): LiquidationParse {
  const wrapper = object(raw), envelope = object(wrapper?.data) ?? wrapper;
  if (!envelope || envelope.e !== 'forceOrder') return ignored();
  const order = object(envelope.o);
  if (!order) return rejected('envelope');
  if (order.s !== 'BTCUSDT') return rejected('symbol', 0);
  if (envelope.st !== undefined && envelope.st !== 1 || order.st !== undefined && order.st !== 1) return rejected('contract', 0);
  if (!timestamp(envelope.E) || !timestamp(order.T) || !timestamp(receivedAtMs)) return rejected('time', 0);
  if (order.S !== 'BUY' && order.S !== 'SELL') return rejected('side', 0);
  const original = decimal(order.q), quantity = decimal(order.z, true), lastFilled = decimal(order.l, true);
  if (original === null || quantity === null || lastFilled === null || compareDecimalText(quantity, original) > 0 || compareDecimalText(lastFilled, quantity) > 0) return rejected('quantity', 0);
  const orderPrice = decimal(order.p), average = decimal(order.ap, true);
  if (orderPrice === null || average === null) return rejected('price', 0);
  // Retain reports without an average fill; never use their order limit as executed notional.
  const filled = Number(average) > 0, price = filled ? average : orderPrice;
  const value = filled ? notional(average, quantity) : null;
  if (filled && !value) return rejected('notional', 0);
  if (typeof order.X !== 'string' || order.X.length > 32 || !/^[A-Z_]+$/.test(order.X)) return rejected('envelope', 0);
  const key = `binance:perpetual:BTCUSDT:liq:${order.T}:${order.S}:${original}:${orderPrice}:${average}:${quantity}:${lastFilled}:${order.X}`;
  const event: LiquidationEvent = {
    ...base('binance', order.T, envelope.E, receivedAtMs), id: `${key}:0`,
    liquidatedSide: order.S === 'SELL' ? 'LONG' : 'SHORT', forcedDirection: order.S,
    reportedPrice: Number(price), reportedPriceText: price, priceType: filled ? 'average-fill' : 'order-limit',
    baseQuantity: Number(quantity), baseQuantityText: quantity, quantityBasis: 'reported-cumulative-filled',
    quoteNotional: value?.value ?? null, quoteNotionalText: value?.text ?? null,
    notionalBasis: filled ? 'average-fill-times-cumulative-filled' : 'unavailable',
    source: 'binance-usdm-forceOrder', reportingCoverage: 'latest-per-symbol-1000ms',
    provenance: { identityLimitation: 'no-native-event-id', reportedSide: order.S, sideMeaning: 'forced-order', forcedDirectionBasis: 'reported-order-side', occurrence: 0, recordIndex: 0,
      originalQuantityText: original, orderPriceText: orderPrice, averageFillPriceText: average, lastFilledQuantityText: lastFilled, orderStatus: order.X },
  };
  return { events: [event], rejected: [], ignored: false };
}

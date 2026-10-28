import { multiplyDecimalText } from './decimal';
import type { NormalizedExecution } from './footprint';

const decimal = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && /^\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v)) && Number(v) > 0;
/** V5 linear publicTrade: S is the taker side; v is native BTC quantity. */
export function parseBybitTrades(value: unknown, receivedAtMs = Date.now()): NormalizedExecution[] {
  const message = value as any;
  if (message?.topic !== 'publicTrade.BTCUSDT') return [];
  if (message.type !== 'snapshot' || !Number.isSafeInteger(message.ts) || message.ts <= 0 || !Array.isArray(message.data) || message.data.length > 1024) throw Error('Invalid Bybit trade envelope');
  return message.data.map((v: any) => {
    if (v?.s !== 'BTCUSDT' || !['Buy','Sell'].includes(v.S) || typeof v.i !== 'string' || !/^[\w-]{1,128}$/.test(v.i)
      || !Number.isSafeInteger(v.T) || v.T <= 0 || !decimal(v.p) || !decimal(v.v)) throw Error('Invalid Bybit BTCUSDT execution');
    return { venue:'bybit', market:'perpetual', nativeSymbol:'BTCUSDT', granularity:'individual-trade',
      executionId:`bybit:perpetual:BTCUSDT:trade:${v.i}`, timeMs:v.T, eventTimeMs:message.ts, receivedAtMs,
      price:Number(v.p), quantity:Number(v.v), priceText:v.p, quantityText:v.v, quoteNotionalText:multiplyDecimalText(v.p,v.v), side:v.S==='Buy'?'buy':'sell' };
  });
}

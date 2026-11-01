import { positiveDecimal, type TradingSnapshot } from './model';

export type TradingLevelKind = 'mark' | 'entry' | 'liquidation' | 'takeProfit' | 'stopLoss' | 'trigger' | 'order';
export interface TradingLevel {
  key: string;
  kind: TradingLevelKind;
  label: string;
  price: number;
  priceText: string;
  orderId?: number;
  side?: 'buy' | 'sell';
  editable: boolean;
}

function level(key: string, kind: TradingLevelKind, label: string, text: string | null, extra: Pick<TradingLevel, 'orderId' | 'side' | 'editable'> = { editable: false }): TradingLevel | null {
  if (!text) return null;
  const parsed = positiveDecimal(text);
  if (!parsed || !parsed.isFinite()) return null;
  const price = parsed.toNumber();
  return Number.isFinite(price) && price > 0 ? { key, kind, label, price, priceText: text, ...extra } : null;
}

/** Convert authoritative account data into bounded display-only chart levels. */
export function tradingLevels(snapshot: TradingSnapshot): TradingLevel[] {
  const levels: TradingLevel[] = [];
  const position = snapshot.positions.find(item => item.coin === 'BTC');
  if (position) {
    const pnl = position.unrealizedPnl === null ? '' : ` · uPnL ${position.unrealizedPnl}`;
    const entry = level('position-entry', 'entry', `Entry ${position.side.toUpperCase()}${pnl}`, position.entryPrice);
    const liquidation = level('position-liquidation', 'liquidation', 'Liquidation', position.liquidationPrice);
    if (entry) levels.push(entry);
    if (liquidation) levels.push(liquidation);
  }
  const mark = level('mark', 'mark', 'HL mark', snapshot.markPrice);
  if (mark) levels.push(mark);
  for (const order of snapshot.orders.filter(item => item.coin === 'BTC').slice(0, 75)) {
    const priceText = order.trigger ? order.triggerPrice : order.price;
    const kind: TradingLevelKind = order.kind === 'takeProfit' ? 'takeProfit'
      : order.kind === 'stopLoss' ? 'stopLoss' : order.kind === 'trigger' ? 'trigger' : 'order';
    const prefix = kind === 'takeProfit' ? 'TP' : kind === 'stopLoss' ? 'SL' : kind === 'trigger' ? 'Trigger' : 'Order';
    const item = level(`order-${order.id}`, kind, `${prefix} ${order.side.toUpperCase()} ${order.size}${order.reduceOnly ? ' RO' : ''}`, priceText, {
      orderId: order.id, side: order.side, editable: !order.trigger || (kind === 'takeProfit' || kind === 'stopLoss') && priceText !== null,
    });
    if (item) levels.push(item);
  }
  return levels;
}

import { describe, expect, it } from 'vitest';
import {
  closePositionSize, hyperliquidPriceQuantum, isEvmAddress, marketIocLimit, newClientOrderId, normalizeAddress,
  orderPhaseFromStatus, reconcileOrderAttempt, validateOrderNotional, validatePrice, validateSize,
  type OrderAttempt, type TradingSnapshot,
} from '../src/trading/model';
import { tradingLevels } from '../src/trading/levels';

describe('Hyperliquid BTC trading validation', () => {
  it('accepts only normalized EVM principal addresses', () => {
    const address = `  0x${'aB'.repeat(20)}  `;
    expect(isEvmAddress(address)).toBe(true);
    expect(normalizeAddress(address)).toBe(`0x${'ab'.repeat(20)}`);
    expect(isEvmAddress('0x1234')).toBe(false);
  });

  it('enforces BTC size and Hyperliquid price precision before SDK submission', () => {
    expect(validateSize('0.00123', 5)).toBeNull();
    expect(validateSize('0.001234', 5)).toContain('at most 5');
    expect(validateSize('1e-3', 5)).toContain('without exponent');
    expect(validateSize('1', 7)).toContain('precision is not available');
    expect(validatePrice('123.45', 2)).toBeNull();
    expect(validatePrice('123.456', 4)).toContain('at most 2');
    expect(validatePrice('12345.6', 5)).toContain('5 significant figures');
    expect(validatePrice('1e5', 5)).toContain('without exponent');
  });

  it('constructs outward rounded protected IOC limits without floating point arithmetic', () => {
    const buy = marketIocLimit('100000', 'buy', 50, 5);
    const sell = marketIocLimit('100000', 'sell', 50, 5);
    expect(Number(buy)).toBeGreaterThanOrEqual(100_500);
    expect(Number(sell)).toBeLessThanOrEqual(99_500);
    expect(validatePrice(buy, 5)).toBeNull();
    expect(validatePrice(sell, 5)).toBeNull();
    expect(hyperliquidPriceQuantum('1234.56', 5).toString()).toBe('0.1');
    expect(() => marketIocLimit('0', 'buy', 50, 5)).toThrow(/fresh positive/);
    expect(() => marketIocLimit('100', 'buy', 0, 5)).toThrow(/Slippage/);
  });

  it('rounds close presets down to BTC size precision and enforces the $10 order minimum', () => {
    expect(closePositionSize('0.013579', 25, 5)).toBe('0.00339');
    expect(closePositionSize('0.013579', 50, 5)).toBe('0.00678');
    expect(closePositionSize('0.013579', 100, 5)).toBe('0.01357');
    expect(() => closePositionSize('0.00001', 25, 5)).toThrow(/rounds below/);
    expect(validateOrderNotional('0.0001', '84000')).toContain('$10');
    expect(validateOrderNotional('0.0002', '84000')).toBeNull();
  });

  it('creates a valid deterministic client order ID from browser randomness', () => {
    const fakeCrypto = { getRandomValues: (bytes: Uint8Array) => { bytes.fill(0xab); return bytes; } } as unknown as Crypto;
    expect(newClientOrderId(fakeCrypto)).toBe(`0x${'ab'.repeat(16)}`);
  });

  it('maps terminal exchange statuses and reconciles attempts by cloid', () => {
    expect(orderPhaseFromStatus('open')).toBe('resting');
    expect(orderPhaseFromStatus('siblingFilledCanceled')).toBe('canceled');
    expect(orderPhaseFromStatus('perpMarginRejected')).toBe('rejected');
    const attempt: OrderAttempt = {
      cloid: `0x${'01'.repeat(16)}`, network: 'testnet', principal: `0x${'02'.repeat(20)}`,
      intent: { side: 'buy', size: '0.01', price: '100000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'01'.repeat(16)}` },
      phase: 'unknown', createdAt: 1, updatedAt: 1, exchangeId: null, filledSize: '0', remainingSize: '0.01', message: 'pending',
    };
    const orders: TradingSnapshot['orders'] = [{
      coin: 'BTC', id: 55, cloid: attempt.cloid, side: 'buy', price: '100000', size: '0.01', originalSize: '0.01',
      timestamp: 2, status: 'open', reduceOnly: false, trigger: false, triggerPrice: null,
      triggerMarket: false, kind: 'limit',
    }];
    expect(reconcileOrderAttempt(attempt, orders)).toMatchObject({ phase: 'resting', exchangeId: 55 });
    const partiallyFilled = reconcileOrderAttempt(attempt, [{ ...orders[0]!, size: '0.007' }]);
    expect(partiallyFilled).toMatchObject({ phase: 'partiallyFilled', exchangeId: 55, filledSize: '0.003', remainingSize: '0.007' });
    expect(reconcileOrderAttempt(partiallyFilled, [], 'unknownOid').phase).toBe('partiallyFilled');
    expect(reconcileOrderAttempt(partiallyFilled, [], 'filled')).toMatchObject({ phase: 'filled', filledSize: '0.01', remainingSize: '0' });
    expect(reconcileOrderAttempt(attempt, [], 'filled').phase).toBe('filled');
  });
});

describe('Hyperliquid trading chart levels', () => {
  it('projects authoritative BTC mark, position PnL, liquidation and TP/SL/order levels', () => {
    const snapshot: TradingSnapshot = {
      network: 'testnet', principal: `0x${'11'.repeat(20)}`, feedState: 'live', lastMessageAt: Date.now(), lastSnapshotAt: Date.now(),
      accountValue: '1000', marginUsed: '150', withdrawable: '850', totalNotional: '1200',
      positions: [{ coin: 'BTC', size: '0.01', side: 'long', entryPrice: '99000', unrealizedPnl: '10.5', liquidationPrice: '80000', leverage: '5' }],
      orders: [
        { coin: 'BTC', id: 1, cloid: null, side: 'sell', price: '105000', size: '0.01', originalSize: '0.01', timestamp: 1, status: 'open', reduceOnly: true, trigger: true, triggerPrice: '104000', triggerMarket: true, kind: 'takeProfit' },
        { coin: 'BTC', id: 2, cloid: null, side: 'sell', price: '95000', size: '0.01', originalSize: '0.01', timestamp: 2, status: 'open', reduceOnly: true, trigger: true, triggerPrice: '96000', triggerMarket: true, kind: 'stopLoss' },
        { coin: 'BTC', id: 3, cloid: null, side: 'buy', price: '97000', size: '0.01', originalSize: '0.01', timestamp: 3, status: 'open', reduceOnly: false, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit' },
        { coin: 'ETH', id: 4, cloid: null, side: 'buy', price: '3000', size: '1', originalSize: '1', timestamp: 4, status: 'open', reduceOnly: false, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit' },
      ],
      fills: [], midPrice: '100001', markPrice: '100002', szDecimals: 5, btcAsset: 0,
      agentAddress: null, agentAuthorized: false, agentValidUntil: null, error: null,
    };
    const levels = tradingLevels(snapshot);
    expect(levels.map(level => level.kind)).toEqual(['entry', 'liquidation', 'mark', 'takeProfit', 'stopLoss', 'order']);
    expect(levels[0]?.label).toContain('uPnL 10.5');
    expect(levels.find(level => level.kind === 'takeProfit')).toMatchObject({ priceText: '104000', editable: true, orderId: 1 });
    expect(levels.find(level => level.kind === 'stopLoss')).toMatchObject({ priceText: '96000', editable: true, orderId: 2 });
    expect(levels.find(level => level.kind === 'order')).toMatchObject({ price: 97000, editable: true, orderId: 3 });
    expect(levels.some(level => level.price === 3000)).toBe(false);
  });

  it('drops malformed prices and bounds visible order-level work', () => {
    const snapshot: TradingSnapshot = {
      network: 'mainnet', principal: `0x${'22'.repeat(20)}`, feedState: 'live', lastMessageAt: 1, lastSnapshotAt: 1,
      accountValue: null, marginUsed: null, withdrawable: null, totalNotional: null, positions: [],
      orders: Array.from({ length: 100 }, (_, index) => ({
        coin: 'BTC', id: index, cloid: null, side: 'buy' as const, price: String(100_000 + index), size: '0.01', originalSize: '0.01',
        timestamp: index, status: 'open', reduceOnly: false, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit' as const,
      })),
      fills: [], midPrice: null, markPrice: 'not-a-price', szDecimals: 5, btcAsset: 0,
      agentAddress: null, agentAuthorized: false, agentValidUntil: null, error: null,
    };
    const levels = tradingLevels(snapshot);
    expect(levels).toHaveLength(75);
    expect(levels.every(level => level.kind === 'order')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { IndicatorLifecycle, nativeInstance, validateInstances } from '../src/indicators/model';
import type { AggTradeObservation } from '../src/feed/footprint';
import { defaultTiers } from '../src/ticker/model';
import {
  TRADE_BUBBLES_ID, TRADE_BUBBLE_DEFAULT_SETTINGS, bubbleTradeSize, executionNotionalUsdt,
  makeTradeBubbleRecord, resolveTradeBubbleSources, topTradeBubbles, tradeBubbleColor,
  tradeBubbleRadius, tradeBubbleSettings,
} from '../src/trade-bubbles/model';

const series = (venue: 'binance' | 'hyperliquid' = 'binance', market: 'spot' | 'perpetual' = 'perpetual', interval: '1m' | '5m' = '1m') => ({ venue, market, interval });
function execution(id: number, values: Partial<AggTradeObservation> = {}): AggTradeObservation {
  const timeMs = Date.UTC(2026, 9, 26, 12) + id * 1000;
  return {
    venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
    executionId: `binance:perpetual:BTCUSDT:agg:${id}`, id, firstTradeId: id * 2, lastTradeId: id * 2 + 1,
    timeMs, eventTimeMs: timeMs, price: 100_000, quantity: 1.2, quoteNotionalText: '120000.25',
    side: 'buy', ...values,
  };
}

describe('Trade Bubbles settings, sources, sizing and culling', () => {
  it('restores bounded versioned settings and persists a validated native singleton', () => {
    expect(TRADE_BUBBLE_DEFAULT_SETTINGS.minimumNotionalUsdt).toBe(100_000);
    const settings = tradeBubbleSettings({ minimumNotionalUsdt: 1, radiusCapNotional: 2, maximumVisible: 9999, opacity: NaN, tiers: 'bad' });
    expect(settings.minimumNotionalUsdt).toBe(100_000);
    expect(settings.radiusCapNotional).toBe(100_000);
    expect(settings.maximumVisible).toBe(500);
    expect(settings.opacity).toBe(.78);
    expect(settings.tiers).toEqual(defaultTiers());
    const instance = nativeInstance(TRADE_BUBBLES_ID, { ...settings });
    expect(validateInstances(JSON.parse(JSON.stringify([instance])))).toEqual([instance]);
    const corrupt = nativeInstance(TRADE_BUBBLES_ID, { sourceMode: 'explicit', sources: ['bad'], tiers: [] });
    expect(validateInstances([corrupt])[0]!.settings).toMatchObject({ sourceMode: 'explicit', sources: [], minimumNotionalUsdt: 100_000 });
    expect(validateInstances([{ ...instance, settingsVersion: 2 }])[0]!.settingsVersion).toBe(2);
  });

  it('resolves follow, explicit and both sources without converting incompatible quotes', () => {
    expect(resolveTradeBubbleSources({}, series('binance', 'spot')).compatible).toEqual(['binance:spot']);
    expect(resolveTradeBubbleSources({}, series('binance')).compatible).toEqual(['binance:perpetual']);
    expect(resolveTradeBubbleSources({ sourceMode: 'both' }, series('binance', 'spot')).compatible).toEqual(['binance:spot', 'binance:perpetual']);
    const hyperliquid = resolveTradeBubbleSources({}, series('hyperliquid'));
    expect(hyperliquid.state).toBe('unavailable');
    expect(hyperliquid.message).toContain('Follow chart is unavailable');
    const explicit = resolveTradeBubbleSources({ sourceMode: 'explicit', sources: ['binance:spot'] }, series('hyperliquid'));
    expect(explicit.state).toBe('incompatible');
    expect(explicit.compatible).toEqual([]);
    expect(explicit.message).toContain('without a validated conversion');
  });

  it('uses exact quote notional when available and filters side, notional, and copied BTC/USDT tiers', () => {
    const buy = execution(1), sell = execution(2, { executionId: 'sell-id', id: 2, firstTradeId: 4, lastTradeId: 5, side: 'sell' });
    expect(executionNotionalUsdt(buy)).toBe(120_000.25);
    expect(executionNotionalUsdt(execution(4, { quoteNotionalText: 'broken' }))).toBe(120_000);
    expect(bubbleTradeSize(buy, 'BTC')).toBe(1.2);
    expect(bubbleTradeSize(buy, 'USDT')).toBe(120_000);
    const settings = { minimumNotionalUsdt: 100_000, side: 'buy', tierChoice: 'tier-1' };
    expect(makeTradeBubbleRecord(buy, buy.timeMs + 10, settings)?.tier?.name).toBe('Large');
    expect(makeTradeBubbleRecord(sell, sell.timeMs + 10, settings)).toBeNull();
    expect(makeTradeBubbleRecord(execution(3, { quoteNotionalText: '99999.99' }), 0, settings)).toBeNull();
    const tiers = defaultTiers().map((tier, index) => ({ ...tier, unit: 'BTC' as const, minimum: [0, .1, 1][index]! }));
    const btc = makeTradeBubbleRecord(buy, 0, { minimumNotionalUsdt: 100_000, tiers, tierChoice: 'tier-2' });
    expect(btc?.tier?.name).toBe('Very large');
    expect(tradeBubbleColor(btc!, { colorMode: 'tier' })).toBe(btc!.tier!.buyColor);
    expect(tradeBubbleColor({ ...btc!, tier: null }, { colorMode: 'side', buyColor: '#123456' })).toBe('#123456');
  });

  it('copies validated Trade Ticker tiers into an independent snapshot with the same classification and colours', () => {
    const source = defaultTiers().map((tier, index) => ({ ...tier, minimum: [0, 50_000, 250_000][index]! }));
    const snapshot = tradeBubbleSettings({ tiers: structuredClone(source) }).tiers;
    const sample = execution(10), record = makeTradeBubbleRecord(sample, sample.timeMs, { tiers: snapshot });
    expect(record?.tier).toMatchObject({ id: 'tier-1', name: 'Large', buyColor: source[1]!.buyColor, sellColor: source[1]!.sellColor });
    source[1]!.buyColor = '#abcdef';
    expect(snapshot[1]!.buyColor).not.toBe('#abcdef');
    expect(record).not.toHaveProperty('notify');
  });

  it('keeps hidden native instances mounted until removal disposes their chart handle', () => {
    const calls: string[] = [];
    const lifecycle = new IndicatorLifecycle(instance => {
      calls.push(`create:${instance.instanceId}`);
      return { updateSettings: () => { calls.push('settings'); }, setVisible: value => { calls.push(`visible:${value}`); }, dispose: () => { calls.push('dispose'); } };
    });
    const instance = nativeInstance(TRADE_BUBBLES_ID, { ...TRADE_BUBBLE_DEFAULT_SETTINGS });
    lifecycle.reconcile([instance]);
    lifecycle.reconcile([{ ...instance, visible: false }]);
    expect(calls).toEqual([`create:${TRADE_BUBBLES_ID}`, 'visible:false']);
    lifecycle.reconcile([]);
    expect(calls.at(-1)).toBe('dispose');
    lifecycle.dispose();
    expect(calls.filter(call => call === 'dispose')).toHaveLength(1);
  });

  it('maps disk area across the configured size range and culls deterministically by exact notional', () => {
    const settings = tradeBubbleSettings({ minimumNotionalUsdt: 100_000, radiusCapNotional: 1_000_000, minRadius: 3, maxRadius: 14 });
    const start = tradeBubbleRadius(100_000, settings) ** 2;
    const middle = tradeBubbleRadius(550_000, settings) ** 2;
    const end = tradeBubbleRadius(1_000_000, settings) ** 2;
    expect(start).toBe(9); expect(end).toBe(196); expect(middle).toBeCloseTo((start + end) / 2);
    const records = [100, 400, 300, 200].map((notional, index) => ({ id: `stable-${index}`, notionalUsdt: notional } as any));
    expect(topTradeBubbles(records, 2).map(item => item.id)).toEqual(['stable-1', 'stable-2']);
    expect(topTradeBubbles(records, 2).map(item => item.id)).toEqual(topTradeBubbles(records, 2).map(item => item.id));
  });
});

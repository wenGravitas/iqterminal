import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  richOrders: [] as Record<string, unknown>[],
  frontendHandlers: [] as Array<() => Promise<unknown>>,
  frontendCalls: 0,
  basicOpenOrdersCalls: 0,
  openOrdersListener: null as ((value: unknown) => void) | null,
  orderUpdatesListener: null as ((value: unknown) => void) | null,
  websocketSockets: [] as EventTarget[],
  subscriptionListeners: [] as Array<{ kind: string; listener: (value: unknown) => void }>,
  activeSubscriptionCount: 0,
  statusResult: { status: 'unknownOid' } as Record<string, unknown>,
}));

vi.mock('@nktkas/hyperliquid', () => {
  class HttpTransport {
    isTestnet: boolean;
    apiUrl: string;
    rpcUrl: string;
    constructor(options: { isTestnet?: boolean; apiUrl?: string; rpcUrl?: string } = {}) {
      this.isTestnet = options.isTestnet ?? false;
      this.apiUrl = options.apiUrl ?? (this.isTestnet ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz');
      this.rpcUrl = options.rpcUrl ?? (this.isTestnet ? 'https://rpc.hyperliquid-testnet.xyz' : 'https://rpc.hyperliquid.xyz');
    }
  }
  class WebSocketTransport {
    socket = new EventTarget();
    constructor(_options?: unknown) { state.websocketSockets.push(this.socket); }
    close() { this.socket.dispatchEvent(new Event('close')); }
  }
  class InfoClient {
    async clearinghouseState() { return { marginSummary: { accountValue: '100', totalMarginUsed: '0', totalNtlPos: '0' }, assetPositions: [], withdrawable: '100' }; }
    async openOrders() { state.basicOpenOrdersCalls++; return []; }
    async frontendOpenOrders() { state.frontendCalls++; return state.frontendHandlers.shift()?.() ?? state.richOrders; }
    async userFills() { return []; }
    async meta() { return { universe: [{ name: 'BTC', index: 0, szDecimals: 5, maxLeverage: 40 }] }; }
    async activeAssetData() { return { leverage: { type: 'cross', value: 8 }, availableToTrade: ['2', '3'], maxTradeSzs: ['4', '5'], markPx: '85000' }; }
    async extraAgents() { return []; }
    async orderStatus() { return state.statusResult; }
  }
  class SubscriptionClient {
    private registrations = new Map<string, { listener: (value: unknown) => void; handle: { unsubscribe(): Promise<void> } }>();
    private subscription(kind: string, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) {
      state.subscriptionListeners.push({ kind, listener });
      const current = this.registrations.get(kind);
      if (current?.listener === listener) return current.handle;
      const registration = { listener, handle: { unsubscribe: async () => {
        if (this.registrations.get(kind) !== registration) return;
        this.registrations.delete(kind); state.activeSubscriptionCount--;
      } } };
      this.registrations.set(kind, registration); state.activeSubscriptionCount++;
      return registration.handle;
    }
    async clearinghouseState(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener({ marginSummary: { accountValue: '100' }, assetPositions: [] }); return this.subscription('Account', listener, options); }
    async openOrders(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) {
      state.openOrdersListener = listener;
      listener([]);
      return this.subscription('Open-order', listener, options);
    }
    async orderUpdates(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) {
      state.orderUpdatesListener = listener;
      listener([]);
      return this.subscription('Order-update', listener, options);
    }
    async userFills(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener([]); return this.subscription('Fill', listener, options); }
    async allMids(listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener({ mids: { BTC: '85000' } }); return this.subscription('Mid-price', listener, options); }
    async activeAssetCtx(_params: unknown, listener: (value: unknown) => void, options?: { onError?: (error: unknown) => void }) { listener({ ctx: { markPx: '85000' } }); return this.subscription('Mark-price', listener, options); }
  }
  class ExchangeClient {}
  return { HttpTransport, WebSocketTransport, InfoClient, SubscriptionClient, ExchangeClient };
});

import { HyperliquidTradingAdapter } from '../src/trading/hyperliquid-adapter';

const PRINCIPAL = `0x${'22'.repeat(20)}`;

function richOrder(kind: 'takeProfit' | 'stopLoss', oid: number, cloid: string) {
  const takeProfit = kind === 'takeProfit';
  return {
    coin: 'BTC', isPositionTpsl: false, isTrigger: true, limitPx: takeProfit ? '90000' : '80000', oid,
    orderType: takeProfit ? 'Take Profit Limit' : 'Stop Loss Limit', origSz: '0.00010', reduceOnly: true,
    side: 'A', sz: '0.00010', timestamp: 1, triggerCondition: takeProfit ? 'Price above' : 'Price below',
    triggerPx: takeProfit ? '90000' : '80000', cloid,
  };
}

async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }

describe('Hyperliquid adapter order metadata', () => {
  beforeEach(() => {
    state.richOrders = [];
    state.frontendHandlers = [];
    state.frontendCalls = 0;
    state.basicOpenOrdersCalls = 0;
    state.openOrdersListener = null;
    state.orderUpdatesListener = null;
    state.websocketSockets.length = 0;
    state.subscriptionListeners.length = 0;
    state.activeSubscriptionCount = 0;
    state.statusResult = { status: 'unknownOid' };
  });

  afterEach(() => vi.clearAllMocks());

  it('uses rich frontend snapshots so native reduce-only TP and SL are not normalized as plain limits', async () => {
    state.richOrders = [richOrder('takeProfit', 10, `0x${'10'.repeat(16)}`), richOrder('stopLoss', 11, `0x${'11'.repeat(16)}`)];
    const adapter = new HyperliquidTradingAdapter();
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, () => {}, () => {});
    const snapshot = await adapter.readSnapshot();
    expect(snapshot.market.maxLeverage).toBe(40);
    expect(snapshot.activeAssetData).toEqual({ leverage: 8, availableToTrade: ['2', '3'] });
    expect(snapshot.orders.map(order => [order.kind, order.trigger, order.reduceOnly])).toEqual([
      ['takeProfit', true, true], ['stopLoss', true, true],
    ]);
    expect(state.frontendCalls).toBeGreaterThan(0);
    expect(state.basicOpenOrdersCalls).toBe(0);
    await adapter.disconnect();
  });

  it('refreshes rich order metadata after a cache-miss minimal open-order event', async () => {
    const updates: { type: string; value?: unknown[] }[] = [];
    const adapter = new HyperliquidTradingAdapter();
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, update => updates.push(update as { type: string; value?: unknown[] }), () => {});
    state.richOrders = [richOrder('takeProfit', 12, `0x${'12'.repeat(16)}`)];
    state.openOrdersListener?.([{ coin: 'BTC', side: 'A', limitPx: '90000', sz: '0.00010', oid: 12, timestamp: 2, origSz: '0.00010', cloid: `0x${'12'.repeat(16)}` }]);
    await flush();
    const latest = updates.filter(update => update.type === 'open-orders').at(-1)?.value as Array<{ kind: string; trigger: boolean; reduceOnly: boolean }>;
    expect(latest).toEqual([expect.objectContaining({ kind: 'takeProfit', trigger: true, reduceOnly: true })]);
    await adapter.disconnect();
  });

  it('enriches a cache-miss minimal order update through orderStatus before emitting it', async () => {
    const cloid = `0x${'13'.repeat(16)}`;
    state.statusResult = { status: 'order', order: { order: richOrder('stopLoss', 13, cloid), status: 'triggered', statusTimestamp: 3 } };
    const updates: { type: string; value?: Array<{ kind: string; trigger: boolean; reduceOnly: boolean; status: string }> }[] = [];
    const adapter = new HyperliquidTradingAdapter();
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, update => updates.push(update as typeof updates[number]), () => {});
    state.orderUpdatesListener?.([{ order: { coin: 'BTC', side: 'A', limitPx: '80000', sz: '0.00010', oid: 13, timestamp: 3, origSz: '0.00010', cloid }, status: 'triggered', statusTimestamp: 3 }]);
    await flush();
    const latest = updates.filter(update => update.type === 'order-updates').at(-1)?.value;
    expect(latest).toEqual([expect.objectContaining({ kind: 'stopLoss', trigger: true, reduceOnly: true, status: 'triggered' })]);
    await adapter.disconnect();
  });

  it('ignores a delayed rich refresh after switching principal and network', async () => {
    const adapter = new HyperliquidTradingAdapter();
    const oldUpdates: { type: string; value?: unknown[] }[] = [];
    const nextUpdates: { type: string; value?: unknown[] }[] = [];
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, update => oldUpdates.push(update as typeof oldUpdates[number]), () => {});
    await flush();
    const oldOpenOrdersCount = oldUpdates.filter(update => update.type === 'open-orders').length;

    let resolveDelayed!: (value: Record<string, unknown>[]) => void;
    const delayed = new Promise<Record<string, unknown>[]>(resolve => { resolveDelayed = resolve; });
    state.frontendHandlers.push(() => delayed);
    const oldOpenOrdersListener = state.openOrdersListener;
    oldOpenOrdersListener?.([]);
    await flush();

    const nextPrincipal = `0x${'33'.repeat(20)}`;
    state.richOrders = [richOrder('stopLoss', 22, `0x${'22'.repeat(16)}`)];
    await adapter.connect({ network: 'mainnet', principal: nextPrincipal }, update => nextUpdates.push(update as typeof nextUpdates[number]), () => {});
    await flush();
    resolveDelayed([richOrder('takeProfit', 99, `0x${'99'.repeat(16)}`)]);
    await flush();

    state.orderUpdatesListener?.([{ order: { coin: 'BTC', side: 'A', limitPx: '80000', sz: '0.00010', oid: 22, timestamp: 4, origSz: '0.00010' }, status: 'triggered' }]);
    await flush();
    const latest = nextUpdates.filter(update => update.type === 'order-updates').at(-1)?.value as Array<{ id: number; kind: string; trigger: boolean; reduceOnly: boolean }>;
    expect(latest).toEqual([expect.objectContaining({ id: 22, kind: 'stopLoss', trigger: true, reduceOnly: true })]);
    expect(oldUpdates.filter(update => update.type === 'open-orders')).toHaveLength(oldOpenOrdersCount);
    await adapter.disconnect();
  });

  it('coalesces a burst of minimal open-order events into one dirty rerun', async () => {
    const adapter = new HyperliquidTradingAdapter();
    const updates: { type: string; value?: unknown[] }[] = [];
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, update => updates.push(update as typeof updates[number]), () => {});
    await flush();
    const callsBeforeBurst = state.frontendCalls;
    const emittedBeforeBurst = updates.filter(update => update.type === 'open-orders').length;

    let resolveFirst!: (value: Record<string, unknown>[]) => void;
    let resolveSecond!: (value: Record<string, unknown>[]) => void;
    const first = new Promise<Record<string, unknown>[]>(resolve => { resolveFirst = resolve; });
    const second = new Promise<Record<string, unknown>[]>(resolve => { resolveSecond = resolve; });
    state.frontendHandlers.push(() => first, () => second);
    const listener = state.openOrdersListener;
    listener?.([]);
    await flush();
    listener?.([]);
    listener?.([]);
    await flush();
    expect(state.frontendCalls).toBe(callsBeforeBurst + 1);

    resolveFirst([richOrder('takeProfit', 30, `0x${'30'.repeat(16)}`)]);
    await flush();
    expect(state.frontendCalls).toBe(callsBeforeBurst + 2);
    state.richOrders = [richOrder('stopLoss', 31, `0x${'31'.repeat(16)}`)];
    resolveSecond(state.richOrders);
    await flush();

    const emitted = updates.filter(update => update.type === 'open-orders').map(update => update.value).slice(emittedBeforeBurst);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual([expect.objectContaining({ id: 31, kind: 'stopLoss', reduceOnly: true })]);
    expect(state.frontendCalls).toBe(callsBeforeBurst + 2);
    await adapter.disconnect();
  });

  it('reports transient socket close, awaits fresh resubscribe acknowledgements, and reuses listeners', async () => {
    const updates: { type: string }[] = [], errors: string[] = [];
    const adapter = new HyperliquidTradingAdapter();
    await adapter.connect({ network: 'testnet', principal: PRINCIPAL }, update => updates.push(update), kind => errors.push(kind));
    const socket = state.websocketSockets.at(-1)!;
    const initialListeners = [...state.subscriptionListeners];
    expect(initialListeners).toHaveLength(6);
    expect(state.activeSubscriptionCount).toBe(6);
    socket.dispatchEvent(new Event('close'));
    socket.dispatchEvent(new Event('error'));
    await flush();
    expect(errors).toEqual(['Transport']);
    expect(updates.filter(update => update.type === 'subscriptions-ready')).toHaveLength(1);

    socket.dispatchEvent(new Event('open'));
    await flush();
    expect(updates.filter(update => update.type === 'subscriptions-ready').at(-1)).toMatchObject({ type: 'subscriptions-ready', orderUpdates: true, fills: true, reconnected: true });
    const reconnectedListeners = state.subscriptionListeners.slice(initialListeners.length);
    expect(reconnectedListeners).toHaveLength(6);
    for (const first of initialListeners) {
      expect(reconnectedListeners.find(item => item.kind === first.kind)?.listener).toBe(first.listener);
    }
    expect(state.activeSubscriptionCount).toBe(6);

    socket.dispatchEvent(new Event('close'));
    socket.dispatchEvent(new Event('open'));
    await flush();
    expect(state.activeSubscriptionCount).toBe(6);
    expect(state.subscriptionListeners).toHaveLength(18);
    await adapter.disconnect();
    expect(state.activeSubscriptionCount).toBe(0);
    const errorCount = errors.length, openCount = updates.filter(update => update.type === 'transport-open').length;
    socket.dispatchEvent(new Event('close'));
    socket.dispatchEvent(new Event('open'));
    expect(errors).toHaveLength(errorCount);
    expect(updates.filter(update => update.type === 'transport-open')).toHaveLength(openCount);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAccount } from 'viem/accounts';
import { accountScope, type ExecutionAccount, type InstrumentSpec, type OrderIntent, type VenueOrder } from '../src/trading/foundation/domain';
import { rehearsalAccounts } from '../src/trading/foundation/simulator';
import { PublicTradingAdapter, ReadBudget } from '../src/trading/foundation/public-adapters';
import { HyperliquidTestnetAdapter, LighterTestnetAdapter } from '../src/trading/foundation/testnet-adapters';

const state = vi.hoisted(() => ({ configs: [] as any[], orders: [] as any[], changes: [] as any[], cancels: [] as any[], subaccount: `0x${'2'.repeat(40)}`, agent: `0x${'3'.repeat(40)}`, authorized: true }));
vi.mock('@nktkas/hyperliquid', () => ({
  HttpTransport: class { apiUrl = 'https://api.hyperliquid-testnet.xyz'; isTestnet = true; },
  InfoClient: class {
    async extraAgents() { return state.authorized ? [{ address: state.agent, validUntil: Date.now() + 60_000 }] : []; }
    async subAccounts() { return [{ subAccountUser: state.subaccount }]; }
    async meta() { return { universe: [{ name: 'ETH' }, { name: 'BTC' }] }; }
    async orderStatus() { return { status: 'order', order: { status: 'canceled' } }; }
  },
  ExchangeClient: class {
    constructor(config: unknown) { state.configs.push(config); }
    async order(value: unknown) { state.orders.push(value); return { response: { data: { statuses: [{ resting: { oid: 12 } }] } } }; }
    async modify(value: unknown) { state.changes.push(value); return {}; }
    async cancel(value: unknown) { state.cancels.push(value); return {}; }
  },
}));
const real = (index: number): ExecutionAccount => ({ ...rehearsalAccounts()[index], mode: 'read-only' });
function market(account: ExecutionAccount) {
  const spec: InstrumentSpec = { venue: account.identity.venue, environment: 'testnet', base: 'BTC', quote: 'USDC', payoff: 'linear', marketId: 1, sizeDecimals: 5, priceDecimals: 1, significantFigures: null,
    minSize: '0.00001', minNotional: '10', maxLeverage: '5', makerFeeBps: '0', takerFeeBps: '0', capabilities: { limit: true, protectedIoc: true, postOnly: true, modify: true, reduceOnly: true, conditionalExits: true, nativeTwap: false, signing: 'testnet-service' } };
  return { spec, quote: { venue: account.identity.venue, environment: account.environment, base: 'BTC' as const, bid: '100000', ask: '100001', mark: '100000', triggerSource: 'Fixture mark', asOf: Date.now() } };
}
function intent(account: ExecutionAccount): OrderIntent { return { id: 'native-entry', planId: 'plan', accountId: account.id, scope: accountScope(account), environment: 'testnet', venue: account.identity.venue, base: 'BTC', side: 'buy', size: '0.01234', price: '100000.1', kind: 'limit', reduceOnly: false, clientOrderId: account.identity.venue === 'hyperliquid' ? `0x${'4'.repeat(32)}` : '123456789', expiresAt: Date.now() + 30_000 }; }
function known(account: ExecutionAccount): VenueOrder { return { accountId: account.id, symbol: 'BTC', orderId: '12', clientOrderId: intent(account).clientOrderId, nativeMarketId: 1, productKind: 'perp', nativeType: 'limit', nativeTimeInForce: 'good-till-time', side: 'buy', size: '0.01234', price: '100000.1', reduceOnly: false, status: 'open' }; }
function lighterFetch(account: ExecutionAccount): typeof fetch { return async url => new Response(JSON.stringify(String(url).includes('orderBooks')
  ? { code: 200, order_books: [{ market_id: 1, symbol: 'BTC', market_type: 'perp' }, { market_id: 0, symbol: 'ETH', market_type: 'perp' }] }
  : { code: 200, accounts: [{ account_index: (account.identity as any).accountIndex, l1_address: (account.identity as any).owner,
  total_asset_value: '2000', available_balance: '1900', positions: [], pending_order_count: 0, account_trading_mode: 0 }] })); }
beforeEach(() => { state.configs = []; state.orders = []; state.changes = []; state.cancels = []; state.authorized = true; state.subaccount = `0x${'2'.repeat(40)}`; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Hyperliquid principal versus execution routing', () => {
  it('supplies explicit vaultAddress through SDK for every subaccount mutation', async () => {
    const account = real(1), adapter = new HyperliquidTestnetAdapter(account, { address: state.agent } as LocalAccount);
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    await adapter.submit(intent(account)); await adapter.modify(intent(account), known(account)); await adapter.cancel(known(account), 'cancel');
    expect(state.configs[0].defaultVaultAddress).toBe(state.subaccount); expect(state.configs[0].transport.isTestnet).toBe(true);
    expect(state.orders[0].orders[0]).toMatchObject({ a: 1, b: true, s: '0.01234' }); expect(state.changes).toHaveLength(1); expect(state.cancels[0]).toEqual({ cancels: [{ a: 1, o: 12 }] });
  });
  it('master account never inherits the previously selected execution address', () => {
    new HyperliquidTestnetAdapter(real(1), { address: state.agent } as LocalAccount);
    new HyperliquidTestnetAdapter(real(0), { address: state.agent } as LocalAccount);
    expect(state.configs[1].defaultVaultAddress).toBeUndefined();
  });
  it('rejects an unrelated subaccount before any exchange call', async () => {
    const account = real(1), adapter = new HyperliquidTestnetAdapter(account, { address: state.agent } as LocalAccount); state.subaccount = `0x${'9'.repeat(40)}`;
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account)); await expect(adapter.submit(intent(account))).rejects.toThrow(/does not belong/); expect(state.orders).toHaveLength(0);
  });
  it('revoked agent blocks order/cancel and mainnet constructor fails', async () => {
    const account = real(0), adapter = new HyperliquidTestnetAdapter(account, { address: state.agent } as LocalAccount); state.authorized = false;
    await expect(adapter.cancel(known(account), 'cancel')).rejects.toThrow(/authorized/);
    expect(() => new HyperliquidTestnetAdapter({ ...account, environment: 'mainnet' }, { address: state.agent } as LocalAccount)).toThrow(/testnet/);
  });
  it('queries execution principal and includes exposure outside BTC/ETH in account risk', async () => {
    const account = real(1), requests: any[] = [];
    const adapter = new PublicTradingAdapter(account, async (_url, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      return new Response(JSON.stringify(body.type === 'clearinghouseState' ? { marginSummary: { accountValue: '2000', totalNtlPos: '50' }, withdrawable: '1900', assetPositions: [{ position: { coin: 'SOL', szi: '1', entryPx: '50', positionValue: '50', unrealizedPnl: '0' } }] } : []));
    });
    const snapshot = await adapter.readAccount(); expect(requests.every(r => r.user === state.subaccount)).toBe(true); expect(snapshot.positions[0].symbol).toBe('SOL');
  });
});

describe('Lighter native signing representation and identity', () => {
  it('preserves emergency cancellation reads after the normal budget is exhausted', async () => {
    const account = real(2), budget = new ReadBudget(), sent: any[] = [];
    for (let i = 0; i < 40; i++) budget.take();
    const adapter = new LighterTestnetAdapter(account, async command => { sent.push(command); return { code: 200 }; }, lighterFetch(account), budget);
    await adapter.cancel(known(account), 'emergency-cancel'); expect(sent[0].operation).toBe('cancel');
    await expect(adapter.readAccount()).rejects.toThrow(/budget/);
  });
  it('does not dispatch after a plan expires during account validation', async () => {
    const account = real(2), order = intent(account), sent = vi.fn(async () => ({ code: 200 })), baseFetch = lighterFetch(account);
    const adapter = new LighterTestnetAdapter(account, sent, async (...args) => { const value = await baseFetch(...args); order.expiresAt = Date.now() - 1; return value; }, new ReadBudget());
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    await expect(adapter.submit(order)).rejects.toThrow(/expired before signing/); expect(sent).not.toHaveBeenCalled();
  });
  it('rejects spot-to-perp substitution and changes to native order kind', async () => {
    const account = real(2), sent = vi.fn(async () => ({ code: 200 })), adapter = new LighterTestnetAdapter(account, sent, lighterFetch(account), new ReadBudget());
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    await expect(adapter.modify({ ...intent(account), kind: 'post-only' }, known(account))).rejects.toThrow(/kind or time in force/);
    await expect(adapter.cancel({ ...known(account), productKind: 'spot' }, 'wrong-product')).rejects.toThrow(/Uncertified/);
    expect(sent).not.toHaveBeenCalled();
  });
  const sdkOrder = { order_index: 12, client_order_index: 123456789, market_index: 1, owner_account_index: 1, market_symbol: 'BTC', market_kind: 'perps',
    remaining_base_amount: '0.01', price: '100000.1', is_ask: false, reduce_only: false, status: 'open' };
  it('normalizes a pinned SDK-shaped working order and blocks an overlapping BTC plan', async () => {
    const account = real(2), adapter = new LighterTestnetAdapter(account, async () => ({ code: 200, orders: [sdkOrder] }), lighterFetch(account), new ReadBudget());
    const snapshot = await adapter.readAccount(); expect(snapshot.ordersComplete).toBe(true); expect(snapshot.orders[0]).toMatchObject({ symbol: 'BTC', orderId: '12', accountId: account.id });
  });
  it.each([{ owner_account_index: 2 }, { market_index: 99 }, { market_kind: 'spot' }, { market_symbol: 'ETH' }])('rejects forged or ambiguous native order identity %o', async change => {
    const account = real(2), adapter = new LighterTestnetAdapter(account, async () => ({ code: 200, orders: [{ ...sdkOrder, ...change }] }), lighterFetch(account), new ReadBudget());
    await expect(adapter.readAccount()).rejects.toThrow(/identity is unverified/);
  });
  it.each(['limit', 'post-only', 'ioc', 'stop-loss', 'take-profit'] as const)('constructs real %s command using authoritative integer scales', async kind => {
    const account = real(2), sent: any[] = [], adapter = new LighterTestnetAdapter(account, async command => { sent.push(command); return { code: 200, transactionId: 'tx-hash' }; }, lighterFetch(account), new ReadBudget());
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    const result = await adapter.submit({ ...intent(account), kind, ...(kind === 'stop-loss' || kind === 'take-profit' ? { reduceOnly: true, triggerPrice: '99000.1' } : {}) });
    expect(sent[0]).toMatchObject({ accountIndex: 1, apiKeyIndex: 2, marketId: 1, baseAmount: '1234', price: '1000001', clientOrderIndex: '123456789', kind });
    expect(result).toMatchObject({ status: 'acknowledged', transactionId: 'tx-hash', orderId: null }); expect(result.message).toContain('not a confirmed fill');
  });
  it('scopes authenticated orders and modification to configured account/key indices', async () => {
    const account = real(3), sent: any[] = [], adapter = new LighterTestnetAdapter(account, async command => { sent.push(command); return { code: 200, orders: [] }; }, lighterFetch(account), new ReadBudget());
    vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    expect((await adapter.readAccount()).ordersComplete).toBe(true); await adapter.modify(intent(account), known(account));
    expect(sent[0]).toMatchObject({ operation: 'orders', accountIndex: 2, apiKeyIndex: 2 }); expect(sent[1]).toMatchObject({ operation: 'modify', orderIndex: '12', accountIndex: 2 });
    await expect(adapter.modify(intent(account), known(real(2)))).rejects.toThrow(/another account/);
  });
  it('rejects over-precision and master-account index substitution before signing', async () => {
    const account = real(2), transport = vi.fn(async () => ({ code: 200 })), adapter = new LighterTestnetAdapter(account, transport, lighterFetch(account), new ReadBudget()); vi.spyOn(adapter, 'readMarket').mockResolvedValue(market(account));
    await expect(adapter.submit({ ...intent(account), size: '0.000001' })).rejects.toThrow(/precision/);
    await expect(adapter.submit(intent(real(3)))).rejects.toThrow(/identity/); expect(transport).not.toHaveBeenCalled();
  });
});

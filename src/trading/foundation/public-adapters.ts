import Decimal from 'decimal.js';
import { accountScope, assertIntentScope, assertOrderScope, type BaseAsset, type ExecutionAccount, type ExecutionQuote, type ExecutionSnapshot, type InstrumentSpec, type MutationResult, type OrderIntent, type TradingAdapter, type VenueOrder } from './domain.ts';
import { validateAccount } from './accounts.ts';

export const VENUE_ENDPOINTS = Object.freeze({
  hyperliquid: { testnet: 'https://api.hyperliquid-testnet.xyz', mainnet: 'https://api.hyperliquid.xyz' },
  lighter: { testnet: 'https://api.testnet.lighter.xyz', mainnet: 'https://mainnet.zklighter.elliot.ai' },
});
export const LIGHTER_TESTNET_CHAIN_ID = 300;
export const LIGHTER_SIGNER_COMMIT = '71dc79cd3cd499825f88b01adede2fe8aa183955';
type Row = Record<string, any>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
function decimal(v: unknown, label: string, fallback?: string): string {
  if ((typeof v === 'string' || typeof v === 'number') && /^-?(?:\d+\.?\d*|\.\d+)$/.test(String(v)) && new Decimal(v).isFinite()) return String(v);
  if (fallback !== undefined) return fallback;
  throw Error(`Venue did not return ${label}`);
}
function integer(v: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw Error(`Venue returned invalid ${label}`);
  return n;
}
/** Shared conservative IP/owner read budget; leave cancellation/protection to the signing owner. */
export class ReadBudget {
  private timestamps: number[] = [];
  take(now = Date.now(), emergency = false) {
    this.timestamps = this.timestamps.filter(t => t > now - 60_000);
    if (this.timestamps.length >= (emergency ? 60 : 40)) throw Error('Read budget exhausted; wait before refreshing (emergency capacity reserved)');
    this.timestamps.push(now);
  }
}
const budgets = new Map<string, ReadBudget>();
export class PublicTradingAdapter implements TradingAdapter {
  private abort = new AbortController();
  private endpoint: string;
  constructor(readonly account: ExecutionAccount, private fetcher: typeof fetch = fetch, private budget?: ReadBudget) {
    validateAccount(account);
    if (account.mode !== 'read-only') throw Error('Public adapter requires an explicitly read-only account');
    this.endpoint = VENUE_ENDPOINTS[account.identity.venue][account.environment];
  }
  protected takeBudget(emergency = false, count = 1) {
    if (this.account.identity.venue !== 'lighter') return;
    const budget = this.budget ?? budgets.get(this.endpoint) ?? new ReadBudget();
    if (!this.budget) budgets.set(this.endpoint, budget);
    for (let i = 0; i < count; i++) budget.take(Date.now(), emergency);
  }
  protected async request(path: string, body?: unknown, signal?: AbortSignal, emergency = false): Promise<Row | Row[]> {
    if (this.abort.signal.aborted) throw Error('Account connection disposed');
    this.takeBudget(emergency);
    const response = await this.fetcher.call(globalThis, `${this.endpoint}${path}`, { method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([this.abort.signal, ...(signal ? [signal] : []), AbortSignal.timeout(12_000)]), cache: 'no-store' });
    if (!response.ok) throw Error(`${this.account.identity.venue} read failed (${response.status}); no fixture fallback`);
    const data = await response.json();
    if (row(data).code !== undefined && ![0, 200].includes(row(data).code)) throw Error('Venue rejected account/market read');
    return data;
  }
  async readAccount(signal?: AbortSignal, emergency = false): Promise<ExecutionSnapshot> {
    const account = this.account, identity = account.identity;
    const common = { accountId: account.id, scope: accountScope(account), environment: account.environment, venue: identity.venue,
      asOf: 0, permission: 'read-only' as const };
    if (identity.venue === 'hyperliquid') {
      const user = (identity.executionAddress ?? identity.principal).toLowerCase();
      const [accountRaw, orderRaw, fillRaw] = await Promise.all([
        this.request('/info', { type: 'clearinghouseState', user }, signal),
        this.request('/info', { type: 'frontendOpenOrders', user }, signal),
        this.request('/info', { type: 'userFills', user }, signal),
      ]);
      const a = row(accountRaw), margin = row(a.marginSummary);
      return { ...common, asOf: Date.now(), equity: decimal(margin.accountValue, 'equity'), availableMargin: decimal(a.withdrawable, 'available margin'),
        grossNotional: decimal(margin.totalNtlPos, 'gross notional'),
        positions: rows(a.assetPositions).map(p => row(p.position)).filter(p => !new Decimal(decimal(p.szi, 'position size')).isZero()).map(p => ({
          symbol: String(p.coin), size: decimal(p.szi, 'size'), entryPrice: decimal(p.entryPx, 'entry'),
          notional: decimal(p.positionValue, 'position value'), unrealizedPnl: decimal(p.unrealizedPnl, 'unrealized PnL'),
        })), orders: rows(orderRaw).map(o => ({ accountId: account.id, symbol: String(o.coin), orderId: String(o.oid), clientOrderId: o.cloid ?? null,
          size: decimal(o.sz, 'order size'), price: decimal(o.limitPx, 'order price'), side: o.side === 'B' ? 'buy' : 'sell', reduceOnly: o.reduceOnly === true, status: 'open' })),
        fills: rows(fillRaw).slice(-200).map(f => ({ accountId: account.id, id: String(f.tid ?? f.hash), orderId: String(f.oid), symbol: String(f.coin), side: f.side === 'B' ? 'buy' : 'sell', size: decimal(f.sz, 'fill size'), price: decimal(f.px, 'fill price'), fee: decimal(f.fee, 'fee'), time: integer(f.time, 'fill time') })),
        ordersComplete: Array.isArray(orderRaw), tier: 'venue fees from metadata', marginMode: 'cross', imposedDelayMs: 0 };
    }
    const a = rows(row(await this.request(`/api/v1/account?by=index&value=${identity.accountIndex}`, undefined, signal, emergency)).accounts)
      .find(a => a.account_index === identity.accountIndex);
    if (!a || String(a.l1_address).toLowerCase() !== identity.owner.toLowerCase()) throw Error('Lighter account index does not belong to the configured L1 owner');
    return { ...common, asOf: Date.now(), equity: decimal(a.total_asset_value, 'total account value'), availableMargin: decimal(a.available_balance, 'available balance'),
      grossNotional: Decimal.sum(0, ...rows(a.positions).map(p => new Decimal(decimal(p.position_value, 'position value')).abs())).toFixed(),
      positions: rows(a.positions).filter(p => !new Decimal(decimal(p.position, 'position')).isZero()).map(p => ({ symbol: String(p.symbol),
        size: new Decimal(decimal(p.position, 'size')).mul(p.sign === -1 ? -1 : 1).toFixed(), entryPrice: decimal(p.avg_entry_price, 'entry'), notional: decimal(p.position_value, 'notional'), unrealizedPnl: decimal(p.unrealized_pnl, 'PnL') })),
      orders: [], fills: [], ordersComplete: a.pending_order_count === 0,
      tier: 'unverified (no automatic tier change)', marginMode: a.account_trading_mode === 1 ? 'unified' : a.account_trading_mode === 0 ? 'cross' : 'unknown', imposedDelayMs: null };
  }
  async readMarket(base: BaseAsset, signal?: AbortSignal): Promise<{ spec: InstrumentSpec; quote: ExecutionQuote }> {
    if (!['BTC', 'ETH'].includes(base)) throw Error('Only explicit native BTC/ETH perpetual markets are supported');
    const venue = this.account.identity.venue, environment = this.account.environment;
    const capabilities = { limit: true, protectedIoc: true, postOnly: true, modify: true, reduceOnly: true, conditionalExits: true, nativeTwap: false, signing: environment === 'testnet' ? 'testnet-service' as const : 'none' as const };
    if (venue === 'hyperliquid') {
      const [raw, book] = await Promise.all([this.request('/info', { type: 'metaAndAssetCtxs' }, signal), this.request('/info', { type: 'l2Book', coin: base }, signal)]);
      const data = raw as unknown as unknown[], universe = rows(row(data[0]).universe), marketId = universe.findIndex(x => x.name === base);
      if (marketId < 0 || universe[marketId].isDelisted) throw Error(`No active native Hyperliquid ${base} perpetual mapping`);
      const u = universe[marketId], ctx = rows(data[1])[marketId], levels = row(book).levels;
      const sizeDecimals = integer(u.szDecimals, 'size decimals', 6);
      const quote = { venue, environment, base, bid: decimal(rows(levels?.[0])[0]?.px, 'bid'), ask: decimal(rows(levels?.[1])[0]?.px, 'ask'), mark: decimal(ctx?.markPx, 'mark'), triggerSource: 'Hyperliquid mark', asOf: Date.now() };
      return { spec: { venue, environment, base, quote: 'USDC', payoff: 'linear', marketId, sizeDecimals, priceDecimals: 6 - sizeDecimals, significantFigures: 5,
        minSize: new Decimal(10).pow(-sizeDecimals).toFixed(), minNotional: '10', maxLeverage: decimal(u.maxLeverage, 'maximum leverage'),
        // Conservative base taker estimate; account-specific fee tiers require signed acceptance.
        makerFeeBps: '1.5', takerFeeBps: '4.5', capabilities }, quote };
    }
    const books = rows(row(await this.request('/api/v1/orderBooks', undefined, signal)).order_books)
      .filter(x => x.symbol === base && x.market_type === 'perp' && x.status === 'active');
    if (books.length !== 1) throw Error(`Expected one active native Lighter ${base}/USDC perpetual; found ${books.length}`);
    const b = books[0], marketId = integer(b.market_id, 'market index');
    if (b.multiplier !== undefined && !new Decimal(b.multiplier).eq(1)) throw Error('Nonlinear or multiplied Lighter contracts are not certified');
    const [details, bookRaw] = await Promise.all([this.request(`/api/v1/orderBookDetails?market_id=${marketId}`, undefined, signal), this.request(`/api/v1/orderBookOrders?market_id=${marketId}&limit=5`, undefined, signal)]);
    const d = rows(row(details).order_book_details)[0], o = row(bookRaw);
    if (!d || d.symbol !== base || d.market_id !== marketId) throw Error('Lighter market detail identity mismatch');
    const spec: InstrumentSpec = { venue, environment, base, quote: 'USDC', payoff: 'linear', marketId,
      sizeDecimals: integer(b.supported_size_decimals, 'size decimals', 12), priceDecimals: integer(b.supported_price_decimals, 'price decimals', 12), significantFigures: null,
      minSize: decimal(b.min_base_amount, 'minimum base'), minNotional: decimal(b.min_quote_amount, 'minimum quote'),
      maxLeverage: d.default_initial_margin_fraction ? new Decimal(10_000).div(d.default_initial_margin_fraction).toFixed() : '1',
      makerFeeBps: new Decimal(decimal(b.maker_fee, 'maker fee')).mul(100).toFixed(), takerFeeBps: new Decimal(decimal(b.taker_fee, 'taker fee')).mul(100).toFixed(), capabilities };
    return { spec, quote: { venue, environment, base, bid: decimal(rows(o.bids)[0]?.price, 'bid'), ask: decimal(rows(o.asks)[0]?.price, 'ask'),
      mark: decimal(d.mark_price, 'mark price'), triggerSource: 'Lighter mark', asOf: Date.now() } };
  }
  async submit(intent: OrderIntent): Promise<MutationResult> { assertIntentScope(this.account, intent); throw Error('Public account connection is read-only; connect the authorized testnet service to sign'); }
  async modify(intent: OrderIntent, order: VenueOrder): Promise<MutationResult> { assertIntentScope(this.account, intent); assertOrderScope(this.account, order); throw Error('Public account connection is read-only'); }
  async cancel(order: VenueOrder, _intentId: string): Promise<MutationResult> { assertOrderScope(this.account, order); throw Error('Public account connection is read-only'); }
  dispose() { this.abort.abort(); }
}

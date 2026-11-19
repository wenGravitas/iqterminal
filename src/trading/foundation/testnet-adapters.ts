import Decimal from 'decimal.js';
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import type { AbstractWallet } from '@nktkas/hyperliquid/signing';
import type { LocalAccount } from 'viem/accounts';
import { accountScope, assertIntentScope, assertOrderScope, type ExecutionAccount, type ExecutionSnapshot, type InstrumentSpec, type MutationResult, type OrderIntent, type VenueOrder } from './domain.ts';
import { PublicTradingAdapter, ReadBudget, VENUE_ENDPOINTS } from './public-adapters.ts';
import { validateInstrumentOrder } from './risk.ts';

export interface LighterSignerCommand {
  operation: 'place' | 'modify' | 'cancel' | 'orders' | 'history'; accountIndex: number; apiKeyIndex: number;
  marketId?: number; clientOrderIndex?: string; orderIndex?: string;
  baseAmount?: string; price?: string; isAsk?: boolean; kind?: OrderIntent['kind']; reduceOnly?: boolean; triggerPrice?: string;
  expiresAt?: number;
}
export interface LighterSignerResponse { code: number; transactionId?: string; orders?: unknown[]; message?: string; limits?: { user_tier_name: string; current_maker_fee_tick: number; current_taker_fee_tick: number } }
export type LighterSignerTransport = (command: LighterSignerCommand) => Promise<LighterSignerResponse>;
export class PreDispatchRejectedError extends Error {}
export function assertIntentDeadline(intent: Pick<OrderIntent, 'expiresAt'>) {
  if (!Number.isFinite(intent.expiresAt) || intent.expiresAt <= Date.now()) throw new PreDispatchRejectedError('Plan expired before signing; review a fresh plan');
}
export function lighterInteger(value: string, decimals: number, max: string): string {
  const d = new Decimal(value).mul(new Decimal(10).pow(decimals));
  if (!d.isFinite() || d.lt(0) || !d.isInteger() || d.gt(max)) throw Error('Lighter value cannot be represented exactly at the authoritative instrument scale');
  return d.toFixed(0);
}
export function validateTestnetIntent(account: ExecutionAccount, intent: OrderIntent, spec: InstrumentSpec) {
  assertIntentScope(account, intent);
  if (account.environment !== 'testnet' || account.mode !== 'read-only') throw Error('Signed adapters support explicitly configured real testnet accounts only');
  assertIntentDeadline(intent);
  if (spec.environment !== 'testnet' || spec.venue !== account.identity.venue || spec.base !== intent.base) throw Error('Signing metadata scope mismatch');
  if (!/^[\w:-]{1,160}$/.test(intent.id) || !/^[\w:-]{1,100}$/.test(intent.planId)) throw Error('Invalid intent identifier');
  if (!['limit', 'ioc', 'post-only', 'stop-loss', 'take-profit'].includes(intent.kind) || !['buy', 'sell'].includes(intent.side) || typeof intent.reduceOnly !== 'boolean') throw Error('Unsupported order command');
  validateInstrumentOrder(intent.size, intent.price, spec);
  if (intent.kind === 'stop-loss' || intent.kind === 'take-profit') {
    if (!intent.reduceOnly || !intent.triggerPrice) throw Error('Conditional exits require a trigger and reduce-only scope');
    validateInstrumentOrder(intent.size, intent.triggerPrice, spec);
  }
}

/** Real Hyperliquid SDK signing. The public account is the execution address; agent authorization belongs to the principal. */
export class HyperliquidTestnetAdapter extends PublicTradingAdapter {
  private exchange: ExchangeClient;
  private info: InfoClient;
  constructor(account: ExecutionAccount, private signer: LocalAccount, fetcher: typeof fetch = fetch) {
    super(account, fetcher);
    if (account.environment !== 'testnet' || account.identity.venue !== 'hyperliquid') throw Error('Hyperliquid signer is testnet-only');
    const transport = new HttpTransport({ isTestnet: true, timeout: 12_000 });
    if (transport.apiUrl !== `${VENUE_ENDPOINTS.hyperliquid.testnet}`) throw Error('Unexpected Hyperliquid testnet endpoint');
    this.info = new InfoClient({ transport });
    this.exchange = new ExchangeClient({ transport, wallet: signer as AbstractWallet,
      ...(account.identity.executionAddress ? { defaultVaultAddress: account.identity.executionAddress as `0x${string}` } : {}),
      defaultExpiresAfter: () => Date.now() + 15_000 });
  }
  private async authorize() {
    if (this.account.identity.venue !== 'hyperliquid') throw Error('Identity changed');
    const identity = this.account.identity;
    if (identity.executionAddress) {
      const accounts = await this.info.subAccounts({ user: identity.principal as `0x${string}` });
      if (!accounts?.some(a => a.subAccountUser.toLowerCase() === identity.executionAddress!.toLowerCase())) throw Error('Execution subaccount does not belong to the configured principal');
    }
    const agents = await this.info.extraAgents({ user: identity.principal as `0x${string}` });
    if (!agents.some(a => a.address.toLowerCase() === this.signer.address.toLowerCase() && (a.validUntil === null || a.validUntil > Date.now()))) throw Error('Agent is not currently authorized for this testnet principal');
  }
  override async readAccount(signal?: AbortSignal): Promise<ExecutionSnapshot> {
    const snapshot = await super.readAccount(signal), i = this.account.identity;
    if (i.venue !== 'hyperliquid') throw Error('Wrong account identity');
    const user = (i.executionAddress ?? i.principal) as `0x${string}`;
    const [btc, eth] = await Promise.all([this.info.activeAssetData({ user, coin: 'BTC' }), this.info.activeAssetData({ user, coin: 'ETH' })]);
    snapshot.leverageByInstrument = { BTC: String(btc.leverage.value), ETH: String(eth.leverage.value) };
    snapshot.permission = 'testnet-authorized'; return snapshot;
  }
  private order(intent: OrderIntent, spec: InstrumentSpec) {
    if (!/^0x[\da-f]{32}$/i.test(intent.clientOrderId)) throw Error('Hyperliquid client order ID must be 128-bit hex');
    const trigger = intent.kind === 'stop-loss' || intent.kind === 'take-profit';
    return { a: spec.marketId, b: intent.side === 'buy', p: intent.price, s: intent.size, r: intent.reduceOnly,
      t: trigger ? { trigger: { isMarket: true, triggerPx: intent.triggerPrice!, tpsl: intent.kind === 'stop-loss' ? 'sl' as const : 'tp' as const } }
        : { limit: { tif: intent.kind === 'ioc' ? 'Ioc' as const : intent.kind === 'post-only' ? 'Alo' as const : 'Gtc' as const } }, c: intent.clientOrderId as `0x${string}` };
  }
  override async submit(intent: OrderIntent): Promise<MutationResult> {
    const { spec } = await this.readMarket(intent.base); validateTestnetIntent(this.account, intent, spec); await this.authorize();
    assertIntentDeadline(intent);
    const response = await this.exchange.order({ orders: [this.order(intent, spec)], grouping: 'na' }, { expiresAfter: Math.min(intent.expiresAt, Date.now() + 15_000) });
    const status = response.response.data.statuses[0];
    const rejected = typeof status === 'object' && 'error' in status;
    const id = typeof status === 'object' && 'resting' in status ? status.resting.oid : typeof status === 'object' && 'filled' in status ? status.filled.oid : null;
    return { intentId: intent.id, status: rejected ? 'rejected' : 'acknowledged', orderId: id === null ? null : String(id), transactionId: null, message: rejected ? 'Hyperliquid rejected the order' : 'Venue acknowledgment received; reconcile orders/fills before claiming protection or flat' };
  }
  override async modify(intent: OrderIntent, order: VenueOrder): Promise<MutationResult> {
    assertOrderScope(this.account, order); const { spec } = await this.readMarket(intent.base);
    validateTestnetIntent(this.account, intent, spec); if (order.symbol !== intent.base || order.reduceOnly !== intent.reduceOnly || order.side !== intent.side) throw Error('Modification cannot change account, market, direction or reduction scope'); await this.authorize();
    assertIntentDeadline(intent);
    await this.exchange.modify({ oid: Number(order.orderId), order: this.order(intent, spec) }, { expiresAfter: Math.min(intent.expiresAt, Date.now() + 15_000) });
    return { intentId: intent.id, status: 'acknowledged', orderId: order.orderId, transactionId: null, message: 'Modification acknowledged; reconcile replacement identity' };
  }
  override async cancel(order: VenueOrder, intentId: string): Promise<MutationResult> {
    assertOrderScope(this.account, order); await this.authorize();
    // Cancellation is independent of chart/quote freshness. Metadata only maps native asset ID.
    const meta = await this.info.meta(), marketId = meta.universe.findIndex(x => x.name === order.symbol);
    if (marketId < 0 || !['BTC', 'ETH'].includes(order.symbol)) throw Error('Uncertified cancellation instrument');
    await this.exchange.cancel({ cancels: [{ a: marketId, o: Number(order.orderId) }] });
    return { intentId, status: 'acknowledged', orderId: order.orderId, transactionId: null, message: 'Cancel acknowledged; authoritative absence still required' };
  }
  async reconcile(clientOrderId: string) {
    const i = this.account.identity;
    if (i.venue !== 'hyperliquid') throw Error('Wrong reconciliation identity');
    const result = await this.info.orderStatus({ user: (i.executionAddress ?? i.principal) as `0x${string}`, oid: clientOrderId as `0x${string}` });
    if (result.status !== 'order') return 'unknown';
    return /cancel|reject|filled/i.test(result.order.status) ? 'terminal' : 'working';
  }
}

/** Official native Lighter signer is injected by the restricted local testnet service. */
export class LighterTestnetAdapter extends PublicTradingAdapter {
  constructor(account: ExecutionAccount, private transport: LighterSignerTransport, fetcher: typeof fetch = fetch, budget?: ReadBudget) {
    super(account, fetcher, budget);
    if (account.environment !== 'testnet' || account.identity.venue !== 'lighter') throw Error('Lighter signer is testnet-only');
  }
  private scope(): Pick<LighterSignerCommand, 'accountIndex' | 'apiKeyIndex'> {
    const i = this.account.identity;
    if (i.venue !== 'lighter') throw Error('Account is not Lighter');
    return { accountIndex: i.accountIndex, apiKeyIndex: i.apiKeyIndex };
  }
  private signed(command: LighterSignerCommand, emergency = false) {
    // Authenticated orders include the tier read; mutations reserve nonce-read + sendTx capacity.
    this.takeBudget(emergency, command.operation === 'history' ? 1 : 2);
    return this.transport(command);
  }
  override async readAccount(signal?: AbortSignal, emergency = false): Promise<ExecutionSnapshot> {
    const snapshot = await super.readAccount(signal, emergency);
    const result = await this.signed({ operation: 'orders', ...this.scope() }, emergency);
    if (result.code !== 200 || !Array.isArray(result.orders) || result.orders.length > 512) throw Error('Authenticated Lighter open-order reconciliation failed');
    const metadata = result.orders.length ? await this.request('/api/v1/orderBooks', undefined, signal, emergency) as Record<string, any> : { order_books: [] };
    snapshot.orders = result.orders.map((value: any) => {
      const identity = this.account.identity;
      const kind = value.market_kind === 'perps' ? 'perp' : value.market_kind === 'spot' ? 'spot' : null;
      const markets = metadata.order_books?.filter((m: any) => m.market_id === value.market_index && m.market_type === kind && m.symbol === value.market_symbol);
      if (identity.venue !== 'lighter' || value.owner_account_index !== identity.accountIndex || !kind || markets?.length !== 1
        || !Number.isSafeInteger(value.order_index) || !Number.isSafeInteger(value.client_order_index)
        || typeof value.is_ask !== 'boolean' || typeof value.reduce_only !== 'boolean'
        || !new Decimal(value.remaining_base_amount).isFinite() || !new Decimal(value.price).gt(0)) throw Error('Authenticated Lighter order account or native market identity is unverified');
      return { accountId: this.account.id, symbol: value.market_symbol, orderId: String(value.order_index), clientOrderId: String(value.client_order_index),
        nativeMarketId: value.market_index, productKind: kind, nativeType: value.type, nativeTimeInForce: value.time_in_force,
        size: String(value.remaining_base_amount), price: String(value.price), side: value.is_ask ? 'sell' as const : 'buy' as const, reduceOnly: value.reduce_only, status: String(value.status) };
    });
    snapshot.ordersComplete = true; snapshot.permission = 'testnet-authorized';
    snapshot.tier = result.limits?.user_tier_name ?? 'unverified';
    snapshot.imposedDelayMs = /^standard$/i.test(snapshot.tier) ? 300 : null;
    return snapshot;
  }
  private command(intent: OrderIntent, spec: InstrumentSpec): LighterSignerCommand {
    if (!/^\d{1,15}$/.test(intent.clientOrderId) || new Decimal(intent.clientOrderId).gt('281474976710655')) throw Error('Lighter client index must fit 48 bits');
    return { operation: 'place', ...this.scope(), marketId: spec.marketId, clientOrderIndex: intent.clientOrderId,
      baseAmount: lighterInteger(intent.size, spec.sizeDecimals, '9223372036854775807'), price: lighterInteger(intent.price, spec.priceDecimals, '4294967295'),
      isAsk: intent.side === 'sell', kind: intent.kind, reduceOnly: intent.reduceOnly,
      triggerPrice: intent.triggerPrice ? lighterInteger(intent.triggerPrice, spec.priceDecimals, '4294967295') : '0', expiresAt: intent.expiresAt };
  }
  private result(intentId: string, response: LighterSignerResponse, orderId: string | null = null): MutationResult {
    return { intentId, status: response.code === 200 ? 'acknowledged' : 'rejected', orderId, transactionId: response.transactionId ?? null,
      message: response.code === 200 ? 'Lighter transaction accepted; not a confirmed fill' : 'Lighter rejected transaction' };
  }
  override async submit(intent: OrderIntent) {
    const { spec } = await this.readMarket(intent.base); validateTestnetIntent(this.account, intent, spec);
    await super.readAccount(); // Owner/index check immediately before every mutation.
    assertIntentDeadline(intent);
    return this.result(intent.id, await this.signed(this.command(intent, spec)));
  }
  override async modify(intent: OrderIntent, order: VenueOrder) {
    assertOrderScope(this.account, order);
    const { spec } = await this.readMarket(intent.base); validateTestnetIntent(this.account, intent, spec);
    if (order.symbol !== intent.base || order.productKind !== 'perp' || order.nativeMarketId !== spec.marketId || order.reduceOnly !== intent.reduceOnly || order.side !== intent.side) throw Error('Modification cannot change account, native product, market, direction or reduction scope');
    const nativeKind = order.nativeType === 'limit' ? order.nativeTimeInForce === 'post-only' ? 'post-only' : order.nativeTimeInForce === 'immediate-or-cancel' ? 'ioc' : order.nativeTimeInForce === 'good-till-time' ? 'limit' : null
      : order.nativeType === 'market' ? 'ioc' : order.nativeType === 'stop-loss' ? 'stop-loss' : order.nativeType === 'take-profit' ? 'take-profit' : null;
    if (nativeKind !== intent.kind) throw Error('Lighter native modification cannot change order kind or time in force');
    await super.readAccount();
    assertIntentDeadline(intent);
    return this.result(intent.id, await this.signed({ ...this.command(intent, spec), operation: 'modify', orderIndex: order.orderId }), order.orderId);
  }
  override async cancel(order: VenueOrder, intentId: string) {
    assertOrderScope(this.account, order); await super.readAccount(undefined, true);
    if (!['BTC', 'ETH'].includes(order.symbol) || order.productKind !== 'perp' || !Number.isSafeInteger(order.nativeMarketId)) throw Error('Uncertified cancellation instrument');
    // Do not require healthy quotes to cancel a known native market order.
    const data = await this.request('/api/v1/orderBooks', undefined, undefined, true) as Record<string, any>, market = data.order_books?.find((x: any) => x.symbol === order.symbol && x.market_type === 'perp' && x.market_id === order.nativeMarketId);
    if (!market) throw Error('Native cancel market mapping unavailable');
    return this.result(intentId, await this.signed({ operation: 'cancel', ...this.scope(), marketId: market.market_id, orderIndex: order.orderId }, true), order.orderId);
  }
  async reconcile(clientOrderId: string, base?: string) {
    const result = await this.signed({ operation: 'history', ...this.scope() }, true);
    if (result.code !== 200 || !Array.isArray(result.orders)) return 'unknown';
    const i = this.account.identity;
    const order = result.orders.find((o: any) => String(o.client_order_index) === clientOrderId && i.venue === 'lighter' && o.owner_account_index === i.accountIndex && o.market_kind === 'perps' && o.market_symbol === base) as Record<string, unknown> | undefined;
    return order && /cancel|filled|reject/i.test(String(order.status)) ? 'terminal' : 'unknown';
  }
}

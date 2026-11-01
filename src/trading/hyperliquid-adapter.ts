import {
  ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport,
  type ISubscription,
} from '@nktkas/hyperliquid';
import type { CancelParameters, ModifyParameters, OrderParameters, UpdateLeverageParameters } from '@nktkas/hyperliquid/api/exchange';
import type { AbstractWallet } from '@nktkas/hyperliquid/signing';
import type { LocalAccount } from 'viem/accounts';
import Decimal from 'decimal.js';
import type { TradingFill, TradingNetwork, TradingOrder, TradingPosition } from './model';
import type {
  TradingVenueAccount, TradingVenueAdapter, TradingVenueAuthorization, TradingVenueConfiguration,
  TradingVenueMarketMetadata, TradingVenueModifyRequest, TradingVenueOrderRequest,
  TradingVenueOrderResult, TradingVenueOrderStatus, TradingVenueSnapshot, TradingVenueUpdate,
} from './venue-adapter';

type RecordValue = Record<string, unknown>;
const BTC = 'BTC';

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? value as RecordValue : {};
}

function decimalString(value: unknown): string | null {
  if (typeof value === 'string' && value.length < 100 && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePosition(value: unknown): TradingPosition | null {
  const position = record(record(value).position ?? value);
  const size = decimalString(position.szi);
  if (!size || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(size)) return null;
  const amount = new Decimal(size);
  if (!amount.isFinite() || amount.isZero() || position.coin !== BTC) return null;
  const leverage = record(position.leverage);
  return {
    coin: BTC, size: amount.abs().toString(), side: amount.gt(0) ? 'long' : 'short',
    entryPrice: decimalString(position.entryPx), unrealizedPnl: decimalString(position.unrealizedPnl),
    liquidationPrice: decimalString(position.liquidationPx), leverage: decimalString(leverage.value),
  };
}

function normalizeAccount(value: unknown): TradingVenueAccount {
  const root = record(record(value).clearinghouseState ?? value);
  const margin = record(root.marginSummary);
  const positions = Array.isArray(root.assetPositions)
    ? root.assetPositions.map(normalizePosition).filter((item): item is TradingPosition => item !== null) : [];
  return {
    accountValue: decimalString(margin.accountValue), marginUsed: decimalString(margin.totalMarginUsed),
    withdrawable: decimalString(root.withdrawable), totalNotional: decimalString(margin.totalNtlPos), positions,
  };
}

function normalizeOrder(value: unknown): TradingOrder | null {
  const wrapper = record(value);
  const order = record(wrapper.order ?? value);
  if (order.coin !== BTC) return null;
  const id = safeInteger(order.oid), price = decimalString(order.limitPx ?? order.p), size = decimalString(order.sz ?? order.s);
  if (id === null || !price || !size) return null;
  const trigger = typeof order.triggerCondition === 'string' && order.triggerCondition !== 'N/A';
  const triggerPrice = trigger ? decimalString(order.triggerPx) : null;
  const orderType = typeof order.orderType === 'string' ? order.orderType.toLowerCase() : '';
  const kind = orderType.includes('take profit') ? 'takeProfit' : orderType.includes('stop') ? 'stopLoss' : trigger ? 'trigger' : 'limit';
  return {
    coin: BTC, id, cloid: typeof order.cloid === 'string' ? order.cloid.toLowerCase() : null,
    side: order.side === 'B' || order.side === 'buy' ? 'buy' : 'sell', price, size,
    originalSize: decimalString(order.origSz) ?? size, timestamp: safeInteger(order.timestamp) ?? 0,
    status: typeof wrapper.status === 'string' ? wrapper.status : 'open',
    reduceOnly: order.reduceOnly === true, trigger, triggerPrice, triggerMarket: orderType.includes('market'), kind,
  };
}

function normalizeOrders(value: unknown): TradingOrder[] {
  const rows = Array.isArray(value) ? value : Array.isArray(record(value).orders) ? record(value).orders as unknown[] : [];
  return rows.map(normalizeOrder).filter((item): item is TradingOrder => item !== null);
}

function normalizeFills(value: unknown): TradingFill[] {
  const root = record(value);
  const rows = Array.isArray(value) ? value : Array.isArray(root.fills) ? root.fills as unknown[] : [];
  const result: TradingFill[] = [];
  for (const entry of rows) {
    const fill = record(entry);
    if (fill.coin !== BTC) continue;
    const price = decimalString(fill.px), size = decimalString(fill.sz), time = safeInteger(fill.time);
    if (!price || !size || time === null) continue;
    result.push({
      id: `${String(fill.tid ?? fill.hash ?? fill.oid)}:${time}`, coin: BTC, orderId: safeInteger(fill.oid),
      side: fill.side === 'B' || fill.side === 'buy' ? 'buy' : 'sell', price, size, time,
      fee: decimalString(fill.fee) ?? '0', closedPnl: decimalString(fill.closedPnl) ?? '0',
    });
  }
  return result;
}

function normalizeMarket(value: unknown): TradingVenueMarketMetadata {
  const universe = record(value).universe;
  if (!Array.isArray(universe)) return { instrumentId: null, sizeDecimals: null };
  const index = universe.findIndex(item => record(item).name === BTC);
  if (index < 0) return { instrumentId: null, sizeDecimals: null };
  const asset = record(universe[index]);
  const instrumentId = safeInteger(asset.index) ?? index;
  const sizeDecimals = safeInteger(asset.szDecimals);
  return { instrumentId, sizeDecimals: sizeDecimals !== null && sizeDecimals <= 6 ? sizeDecimals : null };
}

function normalizeAuthorizations(value: unknown): TradingVenueAuthorization[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter(item => typeof item.address === 'string').map(item => ({
    address: (item.address as string).toLowerCase(), name: typeof item.name === 'string' ? item.name.slice(0, 80) : '',
    validUntil: item.validUntil === null ? null : safeInteger(item.validUntil),
  }));
}

function orderOutcome(response: unknown, requestedSize: string): TradingVenueOrderResult {
  const root = record(response);
  if (root.status === 'err') {
    const message = typeof root.response === 'string' ? root.response : 'Hyperliquid rejected the order';
    return { outcome: 'rejected', orderId: null, filledSize: '0', averagePrice: null, message: message.slice(0, 180) };
  }
  const statuses = record(record(root.response).data).statuses;
  const item = Array.isArray(statuses) ? statuses[0] : undefined;
  if (typeof item === 'string') {
    return item.toLowerCase().includes('trigger')
      ? { outcome: 'triggering', orderId: null, filledSize: '0', averagePrice: null, message: 'Waiting for mark-price trigger' }
      : { outcome: 'unknown', orderId: null, filledSize: '0', averagePrice: null, message: 'Order accepted; waiting for exchange reconciliation' };
  }
  const status = record(item), resting = record(status.resting), filled = record(status.filled);
  const requested = new Decimal(requestedSize);
  const filledSize = decimalString(filled.totalSz);
  const amount = filledSize ? new Decimal(filledSize) : null;
  if (typeof resting.oid === 'number') {
    if (amount?.isFinite() && amount.gt(0) && amount.lt(requested)) {
      return { outcome: 'resting', orderId: resting.oid, filledSize: amount.toString(), averagePrice: decimalString(filled.avgPx), message: `Partially filled ${amount.toString()} BTC; remainder is resting` };
    }
    return { outcome: 'resting', orderId: resting.oid, filledSize: '0', averagePrice: null, message: 'Resting on Hyperliquid' };
  }
  if (typeof filled.oid === 'number') {
    const actual = amount?.isFinite() ? amount : requested;
    return {
      outcome: actual.lt(requested) ? 'filled' : 'filled', orderId: filled.oid, filledSize: actual.toString(), averagePrice: decimalString(filled.avgPx),
      message: `Filled ${filledSize ?? requestedSize} @ ${decimalString(filled.avgPx) ?? ''}`.trim(),
    };
  }
  if (typeof status.error === 'string') return { outcome: 'rejected', orderId: null, filledSize: '0', averagePrice: null, message: status.error.slice(0, 180) };
  return { outcome: 'unknown', orderId: null, filledSize: '0', averagePrice: null, message: 'Exchange response did not include an order status' };
}

function statusText(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('partial')) return 'partiallyFilled';
  if (normalized.includes('fill')) return 'filled';
  if (normalized.includes('cancel')) return 'canceled';
  if (normalized.includes('reject')) return 'rejected';
  if (normalized.includes('trigger')) return 'triggering';
  if (normalized.includes('open') || normalized.includes('resting') || normalized.includes('working')) return 'resting';
  return 'unknown';
}

function mutationError(response: unknown): string | null {
  const root = record(response);
  if (root.status === 'err') return typeof root.response === 'string' ? root.response.slice(0, 180) : 'Hyperliquid rejected the action';
  const statuses = record(record(root.response).data).statuses;
  if (!Array.isArray(statuses)) return null;
  const failed = statuses.map(record).find(item => typeof item.error === 'string');
  return failed && typeof failed.error === 'string' ? failed.error.slice(0, 180) : null;
}

/** Hyperliquid implementation of the venue-neutral account and mutation contract. */
export class HyperliquidTradingAdapter implements TradingVenueAdapter {
  private configuration: TradingVenueConfiguration | null = null;
  private http: HttpTransport | null = null;
  private info: InfoClient | null = null;
  private websocket: WebSocketTransport | null = null;
  private subscriptions: SubscriptionClient | null = null;
  private exchange: ExchangeClient | null = null;
  private activeSubscriptions: ISubscription[] = [];

  async connect(configuration: TradingVenueConfiguration, onUpdate: (update: TradingVenueUpdate) => void, onError: (kind: string, error: unknown) => void) {
    await this.disconnect();
    this.configuration = { ...configuration };
    this.http = this.httpTransport(configuration.network);
    this.info = new InfoClient({ transport: this.http });
    this.websocket = new WebSocketTransport({ isTestnet: configuration.network === 'testnet', timeout: 15_000, resubscribe: true });
    this.subscriptions = new SubscriptionClient({ transport: this.websocket });
    const user = configuration.principal as `0x${string}`;
    const stream = (handler: (value: unknown) => void) => (value: unknown) => {
      try { handler(value); } catch (error) { onError('Feed normalization', error); }
    };
    const failed = (kind: string) => (error: unknown) => onError(kind, error);
    const client = this.subscriptions;
    const tasks = [
      client.clearinghouseState({ user, dex: '' }, stream(value => onUpdate({ type: 'account', value: normalizeAccount(value) })), { onError: failed('Account') }),
      client.openOrders({ user, dex: '' }, stream(value => onUpdate({ type: 'open-orders', value: normalizeOrders(value) })), { onError: failed('Open-order') }),
      client.orderUpdates({ user }, stream(value => onUpdate({ type: 'order-updates', value: normalizeOrders(value) })), { onError: failed('Order-update') }),
      client.userFills({ user, aggregateByTime: false }, stream(value => onUpdate({ type: 'fills', value: normalizeFills(value), snapshot: record(value).isSnapshot === true })), { onError: failed('Fill') }),
      client.allMids(stream(value => onUpdate({ type: 'mid-price', value: decimalString(record(record(value).mids)[BTC]) })), { onError: failed('Mid-price') }),
      client.activeAssetCtx({ coin: BTC }, stream(value => onUpdate({ type: 'mark-price', value: decimalString(record(record(value).ctx).markPx) })), { onError: failed('Mark-price') }),
    ];
    const settled = await Promise.allSettled(tasks);
    this.activeSubscriptions = settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
    return {
      activeSubscriptions: this.activeSubscriptions.length,
      failedSubscriptions: settled.filter(item => item.status === 'rejected').length,
    };
  }

  async disconnect() {
    const active = this.activeSubscriptions;
    this.activeSubscriptions = [];
    const websocket = this.websocket;
    this.websocket = null; this.subscriptions = null; this.info = null; this.configuration = null;
    this.setSigningAccount(null);
    for (const subscription of active) { try { await subscription.unsubscribe(); } catch { /* already closed */ } }
    websocket?.close();
    this.http = null;
  }

  async readSnapshot(): Promise<TradingVenueSnapshot> {
    const info = this.requireInfo();
    const user = this.requirePrincipal();
    const [account, orders, fills, metadata] = await Promise.all([
      info.clearinghouseState({ user }), info.openOrders({ user }), info.userFills({ user }), info.meta(),
    ]);
    return { account: normalizeAccount(account), orders: normalizeOrders(orders), fills: normalizeFills(fills), market: normalizeMarket(metadata) };
  }

  async readAuthorizations(): Promise<TradingVenueAuthorization[]> {
    return normalizeAuthorizations(await this.requireInfo().extraAgents({ user: this.requirePrincipal() }));
  }

  setSigningAccount(account: LocalAccount | null) {
    this.exchange = account && this.configuration
      ? new ExchangeClient({ transport: this.httpTransport(this.configuration.network), wallet: account as AbstractWallet })
      : null;
  }

  async placeOrder(request: TradingVenueOrderRequest): Promise<TradingVenueOrderResult> {
    const type = request.type.kind === 'trigger'
      ? { trigger: { isMarket: request.type.execution === 'market', triggerPx: request.type.triggerPrice, tpsl: request.type.trigger === 'takeProfit' ? 'tp' as const : 'sl' as const } }
      : { limit: { tif: request.type.timeInForce } };
    const response = await this.requireExchange().order({
      orders: [{ a: request.instrumentId, b: request.intent.side === 'buy', p: request.intent.price, s: request.intent.size,
        r: request.intent.reduceOnly, t: type, c: request.intent.cloid }],
      grouping: request.grouping === 'position-protection' ? 'positionTpsl' : 'na',
    } as OrderParameters);
    return orderOutcome(response, request.intent.size);
  }

  async modifyOrder(request: TradingVenueModifyRequest): Promise<void> {
    const type = request.type.kind === 'trigger'
      ? { trigger: { isMarket: request.type.execution === 'market', triggerPx: request.type.triggerPrice, tpsl: request.type.trigger === 'takeProfit' ? 'tp' as const : 'sl' as const } }
      : { limit: { tif: request.type.timeInForce } };
    const response = await this.requireExchange().modify({
      oid: request.orderId,
      order: { a: request.instrumentId, b: request.side === 'buy', p: request.price, s: request.size, r: request.reduceOnly, t: type,
        ...(request.clientOrderId ? { c: request.clientOrderId as `0x${string}` } : {}) },
    } as ModifyParameters);
    const error = mutationError(response);
    if (error) throw new Error(`Hyperliquid rejected modification: ${error}`);
  }

  async cancelOrder(instrumentId: number, orderId: number): Promise<void> {
    const response = await this.requireExchange().cancel({ cancels: [{ a: instrumentId, o: orderId }] } as CancelParameters);
    const error = mutationError(response);
    if (error) throw new Error(`Hyperliquid rejected cancellation: ${error}`);
  }

  async setLeverage(instrumentId: number, leverage: number, marginMode: 'cross' | 'isolated'): Promise<void> {
    const response = await this.requireExchange().updateLeverage({ asset: instrumentId, isCross: marginMode === 'cross', leverage } as UpdateLeverageParameters);
    const error = mutationError(response);
    if (error) throw new Error(`Hyperliquid rejected leverage update: ${error}`);
  }

  async readOrderStatus(clientOrderId: string): Promise<TradingVenueOrderStatus> {
    const result = await this.requireInfo().orderStatus({ user: this.requirePrincipal(), oid: clientOrderId as `0x${string}` });
    if (result.status !== 'order') return { status: 'unknown', order: null };
    const order = normalizeOrder({ order: result.order.order, status: result.order.status });
    return { status: statusText(result.order.status), order };
  }

  private requireInfo() {
    if (!this.info) throw new Error('Trading venue adapter is not connected');
    return this.info;
  }

  private requireExchange() {
    if (!this.exchange) throw new Error('Unlock an authorized agent wallet before trading');
    return this.exchange;
  }

  private requirePrincipal() {
    if (!this.configuration) throw new Error('Trading venue adapter is not connected');
    return this.configuration.principal as `0x${string}`;
  }

  private httpTransport(network: TradingNetwork) {
    return new HttpTransport({ isTestnet: network === 'testnet', timeout: 15_000 });
  }
}

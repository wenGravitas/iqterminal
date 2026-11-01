import {
  ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport,
  type ISubscription,
} from '@nktkas/hyperliquid';
import { ApiRequestError } from '@nktkas/hyperliquid/api/exchange';
import type { CancelParameters, ModifyParameters, OrderParameters, UpdateLeverageParameters } from '@nktkas/hyperliquid/api/exchange';
import type { AbstractWallet } from '@nktkas/hyperliquid/signing';
import type { LocalAccount } from 'viem/accounts';
import Decimal from 'decimal.js';
import type { TradingFill, TradingNetwork, TradingOrder, TradingPosition } from './model';
import type {
  TradingVenueAccount, TradingVenueAdapter, TradingVenueAuthorization, TradingVenueConfiguration,
  TradingVenueActiveAssetData, TradingVenueMarketMetadata, TradingVenueModifyRequest, TradingVenueOrderRequest,
  TradingVenueModifyResult, TradingVenueOrderResult, TradingVenueOrderStatus, TradingVenueSnapshot, TradingVenueUpdate,
} from './venue-adapter';
import { TradingVenueRejectedError } from './venue-adapter';

type RecordValue = Record<string, unknown>;
const BTC = 'BTC';
const MAX_KNOWN_ORDERS = 512;

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

function normalizeOrder(value: unknown, known?: TradingOrder): TradingOrder | null {
  const wrapper = record(value);
  const order = record(wrapper.order ?? value);
  const coin = typeof order.coin === 'string' ? order.coin : known?.coin;
  if (coin !== BTC) return null;
  if (!known && !Object.hasOwn(order, 'reduceOnly')) return null;
  const id = safeInteger(order.oid) ?? known?.id ?? null;
  const price = decimalString(order.limitPx ?? order.p) ?? known?.price ?? null;
  const size = decimalString(order.sz ?? order.s) ?? known?.size ?? null;
  if (id === null || !price || !size) return null;
  const hasTriggerMetadata = Object.hasOwn(order, 'isTrigger') || Object.hasOwn(order, 'triggerCondition') || Object.hasOwn(order, 'orderType');
  const trigger = order.isTrigger === true
    || typeof order.triggerCondition === 'string' && order.triggerCondition !== 'N/A'
    || !hasTriggerMetadata && known?.trigger === true;
  const triggerPrice = trigger ? decimalString(order.triggerPx) ?? known?.triggerPrice ?? null : null;
  const orderType = typeof order.orderType === 'string' ? order.orderType.toLowerCase() : '';
  const kind = orderType.includes('take profit') ? 'takeProfit'
    : orderType.includes('stop') ? 'stopLoss'
      : trigger ? known?.kind === 'takeProfit' || known?.kind === 'stopLoss' ? known.kind : 'trigger'
        : hasTriggerMetadata ? 'limit' : known?.kind ?? 'limit';
  return {
    coin: BTC, id, cloid: typeof order.cloid === 'string' ? order.cloid.toLowerCase() : known?.cloid ?? null,
    side: order.side === 'B' || order.side === 'buy' ? 'buy' : order.side === 'A' || order.side === 'sell' ? 'sell' : known?.side ?? 'sell', price, size,
    originalSize: decimalString(order.origSz) ?? known?.originalSize ?? size, timestamp: safeInteger(order.timestamp) ?? known?.timestamp ?? 0,
    status: typeof wrapper.status === 'string' ? wrapper.status : known?.status ?? 'open',
    reduceOnly: typeof order.reduceOnly === 'boolean' ? order.reduceOnly : known?.reduceOnly ?? false,
    trigger, triggerPrice, triggerMarket: orderType ? orderType.includes('market') : known?.triggerMarket ?? false, kind,
  };
}

function sameKnownOrder(left: TradingOrder, right: TradingOrder) {
  return left.id === right.id || Boolean(left.cloid && right.cloid && left.cloid.toLowerCase() === right.cloid.toLowerCase());
}

function findKnownOrder(orders: readonly TradingOrder[], id: number | null, cloid: string | null) {
  const normalizedCloid = cloid?.toLowerCase() ?? null;
  if (normalizedCloid) {
    const byCloid = orders.find(order => order.cloid?.toLowerCase() === normalizedCloid);
    if (byCloid) return byCloid;
  }
  const byId = id === null ? undefined : orders.find(order => order.id === id);
  // Do not borrow rich metadata from a different client order that happens to have the same oid.
  return byId && (!normalizedCloid || !byId.cloid || byId.cloid.toLowerCase() === normalizedCloid) ? byId : undefined;
}

function boundedOrders(orders: readonly TradingOrder[]) {
  const unique: TradingOrder[] = [];
  for (const order of orders) {
    const previous = unique.findIndex(item => sameKnownOrder(item, order));
    if (previous >= 0) unique.splice(previous, 1);
    unique.push(order);
  }
  return unique.slice(-MAX_KNOWN_ORDERS);
}

function normalizeOrders(value: unknown, knownOrders: readonly TradingOrder[] = []): TradingOrder[] {
  const rows = Array.isArray(value) ? value : Array.isArray(record(value).orders) ? record(value).orders as unknown[] : [];
  return rows.map(row => {
    const wrapper = record(row), raw = record(wrapper.order ?? row);
    const id = safeInteger(raw.oid), cloid = typeof raw.cloid === 'string' ? raw.cloid.toLowerCase() : null;
    const previous = findKnownOrder(knownOrders, id, cloid);
    return normalizeOrder(row, previous);
  }).filter((item): item is TradingOrder => item !== null);
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
  if (!Array.isArray(universe)) return { instrumentId: null, sizeDecimals: null, maxLeverage: null };
  const index = universe.findIndex(item => record(item).name === BTC);
  if (index < 0) return { instrumentId: null, sizeDecimals: null, maxLeverage: null };
  const asset = record(universe[index]);
  const instrumentId = safeInteger(asset.index) ?? index;
  const sizeDecimals = safeInteger(asset.szDecimals);
  const maxLeverage = safeInteger(asset.maxLeverage);
  return {
    instrumentId, sizeDecimals: sizeDecimals !== null && sizeDecimals <= 6 ? sizeDecimals : null,
    maxLeverage: maxLeverage !== null && maxLeverage > 0 ? maxLeverage : null,
  };
}

function normalizeActiveAssetData(value: unknown): TradingVenueActiveAssetData {
  const root = record(value);
  const leverage = record(root.leverage).value;
  const configuredLeverage = typeof leverage === 'number' && Number.isSafeInteger(leverage) && leverage > 0 ? leverage : null;
  const available = root.availableToTrade;
  const availableToTrade: [string, string] | null = Array.isArray(available) && available.length === 2
    ? [decimalString(available[0]) ?? '', decimalString(available[1]) ?? '']
    : null;
  return {
    leverage: configuredLeverage,
    availableToTrade: availableToTrade && availableToTrade.every(value => value !== '') ? availableToTrade : null,
  };
}

function definiteMutationRejection(action: string, error: unknown): TradingVenueRejectedError | null {
  if (error instanceof TradingVenueRejectedError) return error;
  if (error instanceof ApiRequestError) return new TradingVenueRejectedError(`Hyperliquid rejected ${action}: ${error.message.slice(0, 180)}`);
  return null;
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

function modifiedOrderId(response: unknown): number | null {
  const root = record(response), details = record(root.response), data = record(details.data);
  const direct = safeInteger(details.orderId) ?? safeInteger(data.orderId);
  if (direct !== null) return direct;
  const statuses = Array.isArray(data.statuses) ? data.statuses : [];
  for (const statusValue of statuses) {
    const status = record(statusValue);
    const resting = safeInteger(record(status.resting).oid);
    const filled = safeInteger(record(status.filled).oid);
    const triggering = safeInteger(record(status.waitingForTrigger).oid);
    const id = resting ?? filled ?? triggering;
    if (id !== null) return id;
  }
  const single = record(data.status);
  return safeInteger(record(single.resting).oid) ?? safeInteger(record(single.filled).oid)
    ?? safeInteger(record(single.waitingForTrigger).oid);
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
  private knownOrders: TradingOrder[] = [];
  private transportListeners: {
    socket: WebSocketTransport['socket'];
    close: (event: Event) => void;
    error: (event: Event) => void;
    open: (event: Event) => void;
  } | null = null;
  private generation = 0;

  async connect(configuration: TradingVenueConfiguration, onUpdate: (update: TradingVenueUpdate) => void, onError: (kind: string, error: unknown) => void) {
    const generation = ++this.generation;
    await this.teardown();
    if (generation !== this.generation) return { activeSubscriptions: 0, failedSubscriptions: 0 };
    const activeConfiguration = { ...configuration };
    this.configuration = activeConfiguration;
    this.http = this.httpTransport(activeConfiguration.network);
    if (configuration.network === 'testnet'
      && (!this.http.isTestnet || new URL(this.http.apiUrl).hostname !== 'api.hyperliquid-testnet.xyz')) {
      this.http = null;
      this.configuration = null;
      throw new Error('Hyperliquid testnet adapter transport did not resolve to the official testnet API endpoint');
    }
    this.info = new InfoClient({ transport: this.http });
    this.websocket = new WebSocketTransport({ isTestnet: activeConfiguration.network === 'testnet', timeout: 15_000, resubscribe: true });
    this.subscriptions = new SubscriptionClient({ transport: this.websocket });
    const user = activeConfiguration.principal as `0x${string}`;
    const info = this.info;
    const websocket = this.websocket;
    const isCurrent = () => generation === this.generation && this.info === info && this.configuration === activeConfiguration;
    let transportUnavailable = false;
    let subscriptionCycle = 0;
    let resumeSubscriptions: (() => void) | null = null;
    const transportFailure = () => {
      if (!isCurrent() || transportUnavailable) return;
      transportUnavailable = true;
      subscriptionCycle++;
      onError('Transport', new Error('Hyperliquid websocket transport disconnected; waiting for account streams to resume'));
    };
    const transportOpen = () => {
      if (!isCurrent() || !transportUnavailable) return;
      transportUnavailable = false;
      // Re-await the same public subscription methods with the same listener
      // functions. The SDK replaces each subscription promise on open, so these
      // calls wait for the new server acknowledgements without registering
      // duplicate listeners.
      resumeSubscriptions?.();
    };
    const transportListeners = { socket: websocket.socket, close: transportFailure, error: transportFailure, open: transportOpen };
    websocket.socket.addEventListener('close', transportListeners.close);
    websocket.socket.addEventListener('error', transportListeners.error);
    websocket.socket.addEventListener('open', transportListeners.open);
    this.transportListeners = transportListeners;
    const stream = (kind: string, handler: (value: unknown) => void | Promise<void>) => (value: unknown) => {
      if (!isCurrent()) return;
      try {
        const pending = handler(value);
        if (pending instanceof Promise) void pending.catch(error => { if (isCurrent()) onError(kind, error); });
      } catch (error) { if (isCurrent()) onError(kind, error); }
    };
    const failed = (kind: string) => (error: unknown) => { if (isCurrent()) onError(kind, error); };
    const client = this.subscriptions;
    if (!info) throw new Error('Trading venue Info client did not initialize');
    try {
      const seedOrders = await info.frontendOpenOrders({ user, dex: '' });
      if (!isCurrent()) return { activeSubscriptions: 0, failedSubscriptions: 0 };
      this.knownOrders = boundedOrders(normalizeOrders(seedOrders));
    } catch (error) {
      if (!isCurrent()) return { activeSubscriptions: 0, failedSubscriptions: 0 };
      await this.disconnect();
      throw error;
    }
    let requestedRefresh = 0;
    let completedRefresh = 0;
    let refreshPromise: Promise<void> | null = null;
    const publishRichOpenOrders = () => {
      if (!isCurrent()) return Promise.resolve();
      requestedRefresh++;
      if (refreshPromise) return refreshPromise;
      const pending = (async () => {
        while (isCurrent() && completedRefresh < requestedRefresh) {
          const revision = requestedRefresh;
          let rawOrders: unknown;
          try { rawOrders = await info.frontendOpenOrders({ user, dex: '' }); }
          catch (error) {
            if (!isCurrent()) return;
            completedRefresh = revision;
            onError('Open-order metadata', error);
            continue;
          }
          if (!isCurrent()) return;
          // Discard stale snapshots and fetch once more after the current event burst.
          if (revision !== requestedRefresh) continue;
          const orders = boundedOrders(normalizeOrders(rawOrders));
          this.knownOrders = orders;
          completedRefresh = revision;
          onUpdate({ type: 'open-orders', value: orders });
        }
      })().finally(() => {
        if (refreshPromise === pending) refreshPromise = null;
        if (isCurrent() && completedRefresh < requestedRefresh) void publishRichOpenOrders();
      });
      refreshPromise = pending;
      return pending;
    };
    const listeners = {
      account: stream('Feed normalization', value => onUpdate({ type: 'account', value: normalizeAccount(value) })),
      openOrders: stream('Open-order metadata', () => publishRichOpenOrders()),
      orderUpdates: stream('Order-update metadata', async value => {
        const rows = Array.isArray(value) ? value : Array.isArray(record(value).orders) ? record(value).orders as unknown[] : [];
        const updates: TradingOrder[] = [];
        for (const row of rows) {
          const wrapper = record(row), raw = record(wrapper.order ?? row);
          const id = safeInteger(raw.oid), cloid = typeof raw.cloid === 'string' ? raw.cloid.toLowerCase() : null;
          const known = findKnownOrder(this.knownOrders, id, cloid);
          let normalized = normalizeOrder(row, known);
          if (!normalized && id !== null) {
            if (isCurrent()) {
              const authoritative = await info.orderStatus({ user, oid: id });
              if (!isCurrent()) return;
              if (authoritative.status === 'order') {
                const orderRecord = record(authoritative.order);
                const authoritativeOrder = record(orderRecord.order);
                normalized = normalizeOrder({ order: authoritativeOrder, status: orderRecord.status }, findKnownOrder(this.knownOrders, safeInteger(authoritativeOrder.oid), typeof authoritativeOrder.cloid === 'string' ? authoritativeOrder.cloid : null));
              }
            }
          }
          if (!normalized) {
            onError('Order-update metadata', new Error('Order type could not be confirmed from the authoritative Info API.'));
            return;
          }
          updates.push(normalized);
        }
        if (!isCurrent()) return;
        let known = [...this.knownOrders];
        for (const order of updates) {
          known = known.filter(item => !sameKnownOrder(item, order));
          if (!['canceled', 'filled', 'rejected', 'triggered'].includes(order.status.toLowerCase())) known.push(order);
        }
        this.knownOrders = boundedOrders(known);
        onUpdate({ type: 'order-updates', value: updates });
      }),
      fills: stream('Feed normalization', value => onUpdate({ type: 'fills', value: normalizeFills(value), snapshot: record(value).isSnapshot === true })),
      midPrice: stream('Mid-price', value => onUpdate({ type: 'mid-price', value: decimalString(record(record(value).mids)[BTC]) })),
      markPrice: stream('Mark-price', value => onUpdate({ type: 'mark-price', value: decimalString(record(record(value).ctx).markPx) })),
    };
    const subscriptionSpecs = [
      { kind: 'Account', start: () => client.clearinghouseState({ user, dex: '' }, listeners.account, { onError: failed('Account') }) },
      { kind: 'Open-order', start: () => client.openOrders({ user, dex: '' }, listeners.openOrders, { onError: failed('Open-order') }) },
      { kind: 'Order-update', start: () => client.orderUpdates({ user }, listeners.orderUpdates, { onError: failed('Order-update') }) },
      { kind: 'Fill', start: () => client.userFills({ user, aggregateByTime: false }, listeners.fills, { onError: failed('Fill') }) },
      { kind: 'Mid-price', start: () => client.allMids(listeners.midPrice, { onError: failed('Mid-price') }) },
      { kind: 'Mark-price', start: () => client.activeAssetCtx({ coin: BTC }, listeners.markPrice, { onError: failed('Mark-price') }) },
    ] as const;
    const subscribeAll = async (reconnected: boolean) => {
      const cycle = ++subscriptionCycle;
      const settled = await Promise.allSettled(subscriptionSpecs.map(spec => Promise.resolve().then(spec.start)));
      const activeSubscriptions = settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
      if (!isCurrent()) {
        await Promise.allSettled(activeSubscriptions.map(subscription => subscription.unsubscribe()));
        return { activeSubscriptions: 0, failedSubscriptions: settled.filter(item => item.status === 'rejected').length };
      }
      // A newer disconnect/open cycle owns subscription state. These handles
      // share the same SDK registration, so stale cycles must not unsubscribe them.
      if (cycle !== subscriptionCycle) return { activeSubscriptions: 0, failedSubscriptions: settled.filter(item => item.status === 'rejected').length };
      for (const [index, item] of settled.entries()) {
        if (item.status === 'rejected') failed(subscriptionSpecs[index]!.kind)(item.reason);
      }
      this.activeSubscriptions = activeSubscriptions;
      onUpdate({ type: 'subscriptions-ready',
        orderUpdates: settled[2]?.status === 'fulfilled', fills: settled[3]?.status === 'fulfilled', reconnected });
      return {
        activeSubscriptions: this.activeSubscriptions.length,
        failedSubscriptions: settled.filter(item => item.status === 'rejected').length,
      };
    };
    resumeSubscriptions = () => { void subscribeAll(true); };
    return subscribeAll(false);
  }

  async disconnect() {
    this.generation++;
    await this.teardown();
  }

  private async teardown() {
    const active = this.activeSubscriptions;
    this.activeSubscriptions = [];
    const websocket = this.websocket;
    const transportListeners = this.transportListeners;
    this.transportListeners = null;
    this.websocket = null; this.subscriptions = null; this.info = null; this.configuration = null;
    this.http = null; this.exchange = null;
    this.knownOrders = [];
    if (transportListeners) {
      transportListeners.socket.removeEventListener('close', transportListeners.close);
      transportListeners.socket.removeEventListener('error', transportListeners.error);
      transportListeners.socket.removeEventListener('open', transportListeners.open);
    }
    for (const subscription of active) { try { await subscription.unsubscribe(); } catch { /* already closed */ } }
    websocket?.close();
  }

  async readSnapshot(): Promise<TradingVenueSnapshot> {
    const info = this.requireInfo();
    const user = this.requirePrincipal();
    const configuration = this.configuration;
    const generation = this.generation;
    const [account, orders, fills, metadata, activeAssetData] = await Promise.all([
      info.clearinghouseState({ user }), info.frontendOpenOrders({ user }), info.userFills({ user }), info.meta(),
      info.activeAssetData({ user, coin: BTC }),
    ]);
    if (generation !== this.generation || info !== this.info || configuration !== this.configuration) throw new Error('Trading venue connection changed while reading the account snapshot');
    const normalizedOrders = boundedOrders(normalizeOrders(orders, this.knownOrders));
    this.knownOrders = normalizedOrders;
    return {
      account: normalizeAccount(account), orders: normalizedOrders, fills: normalizeFills(fills), market: normalizeMarket(metadata),
      activeAssetData: normalizeActiveAssetData(activeAssetData),
    };
  }

  async readAuthorizations(): Promise<TradingVenueAuthorization[]> {
    const info = this.requireInfo();
    const principal = this.requirePrincipal();
    const configuration = this.configuration;
    const generation = this.generation;
    const result = await info.extraAgents({ user: principal });
    if (generation !== this.generation || info !== this.info || configuration !== this.configuration) throw new Error('Trading venue connection changed while reading agent authorizations');
    return normalizeAuthorizations(result);
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

  async modifyOrder(request: TradingVenueModifyRequest): Promise<TradingVenueModifyResult> {
    const type = request.type.kind === 'trigger'
      ? { trigger: { isMarket: request.type.execution === 'market', triggerPx: request.type.triggerPrice, tpsl: request.type.trigger === 'takeProfit' ? 'tp' as const : 'sl' as const } }
      : { limit: { tif: request.type.timeInForce } };
    try {
      const response = await this.requireExchange().modify({
        oid: request.orderId,
        order: { a: request.instrumentId, b: request.side === 'buy', p: request.price, s: request.size, r: request.reduceOnly, t: type,
          ...(request.clientOrderId ? { c: request.clientOrderId as `0x${string}` } : {}) },
      } as ModifyParameters);
      const error = mutationError(response);
      if (error) throw new TradingVenueRejectedError(`Hyperliquid rejected modification: ${error}`);
      return { orderId: modifiedOrderId(response) };
    } catch (error) {
      throw definiteMutationRejection('modification', error) ?? error;
    }
  }

  async cancelOrder(instrumentId: number, orderId: number): Promise<void> {
    try {
      const response = await this.requireExchange().cancel({ cancels: [{ a: instrumentId, o: orderId }] } as CancelParameters);
      const error = mutationError(response);
      if (error) throw new TradingVenueRejectedError(`Hyperliquid rejected cancellation: ${error}`);
    } catch (error) {
      throw definiteMutationRejection('cancellation', error) ?? error;
    }
  }

  async setLeverage(instrumentId: number, leverage: number, marginMode: 'cross' | 'isolated'): Promise<void> {
    try {
      const response = await this.requireExchange().updateLeverage({ asset: instrumentId, isCross: marginMode === 'cross', leverage } as UpdateLeverageParameters);
      const error = mutationError(response);
      if (error) throw new TradingVenueRejectedError(`Hyperliquid rejected leverage update: ${error}`);
    } catch (error) {
      throw definiteMutationRejection('leverage update', error) ?? error;
    }
  }

  async readOrderStatus(clientOrderId: string): Promise<TradingVenueOrderStatus> {
    const info = this.requireInfo();
    const principal = this.requirePrincipal();
    const configuration = this.configuration;
    const generation = this.generation;
    const result = await info.orderStatus({ user: principal, oid: clientOrderId as `0x${string}` });
    if (generation !== this.generation || info !== this.info || configuration !== this.configuration) throw new Error('Trading venue connection changed while reading order status');
    if (result.status !== 'order') return { status: 'unknown', order: null };
    const rawOrder = result.order.order;
    const orderId = safeInteger(rawOrder.oid);
    const cloid = typeof rawOrder.cloid === 'string' ? rawOrder.cloid : null;
    const known = findKnownOrder(this.knownOrders, orderId, cloid);
    const order = normalizeOrder({ order: rawOrder, status: result.order.status }, known);
    if (order) {
      this.knownOrders = boundedOrders(this.knownOrders.filter(item => !sameKnownOrder(item, order)).concat(
        ['canceled', 'filled', 'rejected', 'triggered'].includes(order.status.toLowerCase()) ? [] : [order],
      ));
    }
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

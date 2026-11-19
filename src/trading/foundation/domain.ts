/** Shared browser/service contracts. Monetary and venue-scaled values are decimal strings. */
export type Venue = 'hyperliquid' | 'lighter';
export type Environment = 'testnet' | 'mainnet';
export type BaseAsset = 'BTC' | 'ETH';
export type Side = 'buy' | 'sell';
export type ExecutionIdentity =
  | { venue: 'hyperliquid'; principal: string; executionAddress: string | null }
  | { venue: 'lighter'; owner: string; accountIndex: number; apiKeyIndex: number };

export interface ExecutionAccount {
  id: string;
  name: string;
  environment: Environment;
  mode: 'read-only' | 'simulated';
  identity: ExecutionIdentity;
  policy: { maxRiskCash: string; maxGrossNotional: string; maxLeverage: string };
}
export interface CopyGroup { id: string; name: string; accountIds: string[] }
export interface AccountRegistry { version: 1; accounts: ExecutionAccount[]; groups: CopyGroup[]; selectedId: string | null }
export interface VenueCapabilities {
  limit: boolean; protectedIoc: boolean; postOnly: boolean; modify: boolean;
  reduceOnly: boolean; conditionalExits: boolean; nativeTwap: boolean;
  signing: 'testnet-service' | 'none';
}
export interface InstrumentSpec {
  venue: Venue; environment: Environment; base: BaseAsset; quote: 'USDC'; payoff: 'linear';
  marketId: number; sizeDecimals: number; priceDecimals: number; significantFigures: number | null;
  minSize: string; minNotional: string; maxLeverage: string;
  makerFeeBps: string; takerFeeBps: string; capabilities: VenueCapabilities;
}
export interface Exposure { symbol: string; size: string; entryPrice: string; notional: string; unrealizedPnl: string }
export interface VenueOrder {
  accountId: string; symbol: string; orderId: string; clientOrderId: string | null;
  size: string; price: string; side: Side; reduceOnly: boolean; status: string;
  nativeMarketId?: number; productKind?: 'perp' | 'spot';
  nativeType?: string; nativeTimeInForce?: string;
}
export interface Fill {
  accountId: string; id: string; orderId: string; symbol: string; side: Side;
  size: string; price: string; fee: string; time: number;
}
export interface ExecutionSnapshot {
  accountId: string; scope: string; environment: Environment; venue: Venue; asOf: number;
  equity: string; availableMargin: string; grossNotional: string; positions: Exposure[];
  orders: VenueOrder[]; fills: Fill[]; ordersComplete: boolean;
  tier: string; marginMode: 'cross' | 'unified' | 'unknown'; imposedDelayMs: number | null;
  permission: 'read-only' | 'testnet-authorized' | 'simulated';
  leverageByInstrument?: Partial<Record<BaseAsset, string>>;
}
export interface ExecutionQuote {
  venue: Venue; environment: Environment; base: BaseAsset; bid: string; ask: string; mark: string;
  triggerSource: string; asOf: number;
}
export interface ExitAllocation { price: string; percent: string }
export interface TradePlan {
  id: string; version: number; base: BaseAsset; side: Side; entry: string; stop: string;
  risk: { mode: 'equity-percent' | 'fixed-cash'; value: string };
  stopMode: 'absolute' | 'relative-distance'; targets: ExitAllocation[];
  stopPercent: string; slippageBps: string; maxDriftBps: string; maxDelayMs: number;
  createdAt: number;
}
export interface AccountAllocation {
  accountId: string; scope: string; planId: string; base: BaseAsset; venue: Venue;
  environment: Environment; requestedRisk: string; executableRisk: string;
  size: string; entry: string; stop: string; notional: string; margin: string;
  estimatedFees: string; stopCoveragePercent: string; targets: ExitAllocation[];
  status: 'ready' | 'blocked'; reasons: string[];
}
export interface RiskReservation {
  id: string; accountId: string; scope: string; base: BaseAsset; planId: string;
  risk: string; margin: string; notional: string; phase: 'reserved' | 'unknown' | 'filled';
}
export interface OrderIntent {
  id: string; planId: string; accountId: string; scope: string; environment: Environment;
  venue: Venue; base: BaseAsset; side: Side; size: string; price: string;
  kind: 'limit' | 'ioc' | 'post-only' | 'stop-loss' | 'take-profit';
  reduceOnly: boolean; triggerPrice?: string; clientOrderId: string;
  expiresAt: number;
}
export interface MutationResult {
  intentId: string; status: 'acknowledged' | 'rejected' | 'unknown';
  orderId: string | null; transactionId: string | null; message: string;
}
export interface TradingAdapter {
  readonly account: ExecutionAccount;
  readAccount(signal?: AbortSignal): Promise<ExecutionSnapshot>;
  readMarket(base: BaseAsset, signal?: AbortSignal): Promise<{ spec: InstrumentSpec; quote: ExecutionQuote }>;
  submit(intent: OrderIntent): Promise<MutationResult>;
  modify(intent: OrderIntent, order: VenueOrder): Promise<MutationResult>;
  cancel(order: VenueOrder, intentId: string): Promise<MutationResult>;
  dispose(): void;
}

export function accountScope(account: ExecutionAccount): string {
  const i = account.identity;
  return i.venue === 'hyperliquid'
    ? `${i.venue}:${account.environment}:${(i.executionAddress ?? i.principal).toLowerCase()}`
    : `${i.venue}:${account.environment}:${i.accountIndex}`;
}
export function credentialScope(account: ExecutionAccount): string {
  const i = account.identity;
  return i.venue === 'hyperliquid' ? `${i.venue}:${account.environment}:${i.principal.toLowerCase()}`
    : `${accountScope(account)}:key:${i.apiKeyIndex}`;
}
export function assertIntentScope(account: ExecutionAccount, intent: OrderIntent) {
  if (intent.accountId !== account.id || intent.scope !== accountScope(account)
    || intent.environment !== account.environment || intent.venue !== account.identity.venue) throw Error('Order account, environment or execution identity does not match');
  if (!['BTC', 'ETH'].includes(intent.base)) throw Error('Only certified BTC/ETH perpetual mappings are accepted');
}
export function assertOrderScope(account: ExecutionAccount, order: VenueOrder) {
  if (order.accountId !== account.id) throw Error('Order belongs to another account');
}

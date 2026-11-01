import type { LocalAccount } from 'viem/accounts';
import type {
  OrderIntent, TradingFill, TradingNetwork, TradingOrder, TradingPosition,
} from './model';

export interface TradingVenueConfiguration {
  network: TradingNetwork;
  principal: string;
}

export interface TradingVenueAccount {
  accountValue: string | null;
  marginUsed: string | null;
  withdrawable: string | null;
  totalNotional: string | null;
  positions: TradingPosition[];
}

export interface TradingVenueMarketMetadata {
  instrumentId: number | null;
  sizeDecimals: number | null;
}

export interface TradingVenueSnapshot {
  account: TradingVenueAccount;
  orders: TradingOrder[];
  fills: TradingFill[];
  market: TradingVenueMarketMetadata;
}

export interface TradingVenueAuthorization {
  address: string;
  name: string;
  validUntil: number | null;
}

export type TradingVenueUpdate =
  | { type: 'account'; value: TradingVenueAccount }
  | { type: 'open-orders'; value: TradingOrder[] }
  | { type: 'order-updates'; value: TradingOrder[] }
  | { type: 'fills'; value: TradingFill[]; snapshot: boolean }
  | { type: 'mid-price'; value: string | null }
  | { type: 'mark-price'; value: string | null };

export type TradingVenueOrderType =
  | { kind: 'limit'; timeInForce: OrderIntent['tif'] }
  | { kind: 'trigger'; trigger: 'takeProfit' | 'stopLoss'; triggerPrice: string; execution: 'limit' | 'market' };

export interface TradingVenueOrderRequest {
  instrument: 'BTC-PERP';
  instrumentId: number;
  intent: OrderIntent;
  type: TradingVenueOrderType;
  grouping: 'independent' | 'position-protection';
}

export interface TradingVenueModifyRequest {
  instrument: 'BTC-PERP';
  instrumentId: number;
  orderId: number;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  reduceOnly: boolean;
  clientOrderId: string | null;
  type: TradingVenueOrderType;
}

export interface TradingVenueOrderResult {
  outcome: 'resting' | 'filled' | 'triggering' | 'rejected' | 'unknown';
  orderId: number | null;
  filledSize: string | null;
  averagePrice: string | null;
  message: string;
}

export interface TradingVenueOrderStatus {
  status: string;
  order: TradingOrder | null;
}

export interface TradingVenueAdapter {
  connect(
    configuration: TradingVenueConfiguration,
    onUpdate: (update: TradingVenueUpdate) => void,
    onError: (kind: string, error: unknown) => void,
  ): Promise<{ activeSubscriptions: number; failedSubscriptions: number }>;
  disconnect(): Promise<void>;
  readSnapshot(): Promise<TradingVenueSnapshot>;
  readAuthorizations(): Promise<TradingVenueAuthorization[]>;
  setSigningAccount(account: LocalAccount | null): void;
  placeOrder(request: TradingVenueOrderRequest): Promise<TradingVenueOrderResult>;
  modifyOrder(request: TradingVenueModifyRequest): Promise<void>;
  cancelOrder(instrumentId: number, orderId: number): Promise<void>;
  setLeverage(instrumentId: number, leverage: number, marginMode: 'cross' | 'isolated'): Promise<void>;
  readOrderStatus(clientOrderId: string): Promise<TradingVenueOrderStatus>;
}

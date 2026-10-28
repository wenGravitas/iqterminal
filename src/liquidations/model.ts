/** Actual venue reports only. Estimated liquidation pools must use another model. */
export type LiquidationVenue = 'bybit' | 'binance';
export type LiquidationMarket = `${LiquidationVenue}:perpetual:BTCUSDT`;
export type LiquidatedSide = 'LONG' | 'SHORT';
export type ForcedDirection = 'BUY' | 'SELL';
export type LiquidationPriceType = 'bankruptcy' | 'average-fill' | 'order-limit';

export interface LiquidationEvent {
  version: 1;
  kind: 'actual-liquidation-report';
  /** Deterministic report identity, not an invented exchange order/trade ID. */
  id: string;
  nativeEventId: null;
  identityBasis: 'reported-fields-and-occurrence';
  venue: LiquidationVenue;
  instrument: LiquidationMarket;
  market: 'perpetual';
  nativeSymbol: 'BTCUSDT';
  contract: {
    type: 'linear-perpetual'; base: 'BTC'; quote: 'USDT'; settlement: 'USDT';
    nativeQuantityUnit: 'BTC'; basePerNativeUnit: '1';
  };
  timeMs: number;
  eventTimeMs: number;
  receivedAtMs: number;
  liquidatedSide: LiquidatedSide;
  forcedDirection: ForcedDirection;
  reportedPrice: number;
  reportedPriceText: string;
  priceType: LiquidationPriceType;
  baseQuantity: number;
  baseQuantityText: string;
  quantityBasis: 'reported-executed-size' | 'reported-cumulative-filled';
  /** Bybit bankruptcy-price valuation is not execution proceeds or trigger value. */
  quoteNotional: number | null;
  quoteNotionalText: string | null;
  notionalBasis: 'bankruptcy-price-times-size' | 'average-fill-times-cumulative-filled' | 'unavailable';
  source: 'bybit-v5-allLiquidation' | 'binance-usdm-forceOrder';
  reportingCoverage: 'all-reported-liquidations' | 'latest-per-symbol-1000ms';
  provenance: {
    /** Neither stream publishes an order ID; identical independent reports can be ambiguous. */
    identityLimitation: 'no-native-event-id';
    reportedSide: 'Buy' | 'Sell' | 'BUY' | 'SELL';
    sideMeaning: 'liquidated-position' | 'forced-order';
    forcedDirectionBasis: 'opposite-reported-position-side' | 'reported-order-side';
    occurrence: number;
    recordIndex: number;
    originalQuantityText?: string;
    orderPriceText?: string;
    averageFillPriceText?: string;
    lastFilledQuantityText?: string;
    orderStatus?: string;
  };
}

export type LiquidationReject = 'envelope' | 'capacity' | 'symbol' | 'contract' | 'time' | 'side' | 'price' | 'quantity' | 'notional';
export interface LiquidationParse {
  events: LiquidationEvent[];
  rejected: { index: number; reason: LiquidationReject }[];
  ignored: boolean;
}

export const LIQUIDATION_MAX_MESSAGE_RECORDS = 4096;
export const LIQUIDATION_MAX_EVENTS = 20000;
export const LIQUIDATION_BATCH_SIZE = 256;
export interface LiquidationGap { from: number; to: number; reason: string }
export interface LiquidationSourceState {
  venue: LiquidationVenue; state: 'connecting' | 'live' | 'stale' | 'disconnected';
  observedFrom: number; verifiedThrough: number; lastEventAt: number | null;
  lastTrafficAt: number; gaps: LiquidationGap[]; message: string;
  rejected: number; dropped: number; reconnects: number;
}
export interface LiquidationCoverage {
  sources: LiquidationSourceState[]; asOf?: number; retentionDays: number; head: number;
  /** A healthy connection can be quiet; this is not proof of no exchange liquidations. */
  semantics: 'reported-events-only';
}
export interface StoredLiquidation { cursor: number; event: LiquidationEvent }
export interface LiquidationHistory {
  version: 1; records: StoredLiquidation[]; head: number; next: string | null;
  coverage: LiquidationCoverage; from: number; to: number;
}
export const liquidationValue = (event: LiquidationEvent, unit: 'BTC' | 'USDT') => unit === 'BTC' ? event.baseQuantity : event.quoteNotional;
export const LIQUIDATION_SOURCES = Object.freeze({
  bybit: { url: 'wss://stream.bybit.com/v5/public/linear', topic: 'allLiquidation.BTCUSDT' },
  binance: { url: 'wss://fstream.binance.com/market/ws/btcusdt@forceOrder', topic: 'btcusdt@forceOrder' },
});

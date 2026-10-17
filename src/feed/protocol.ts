import type { HeatmapResolution, HeatmapStatus, LiquidityBucket } from './heatmap-model';
export const intervals = ['1m', '5m', '15m', '1h', '4h'] as const;
export type Interval = typeof intervals[number];
export type Venue = 'binance' | 'hyperliquid';
export type Market = 'spot' | 'perpetual';
/** `market` is optional at deserialization boundaries so legacy layouts default to perpetual. */
export interface Series { venue: Venue; interval: Interval; market?: Market }
export interface CanonicalSeries extends Series { market: Market }
export interface InstrumentInfo { label: string; native: string; base: string; quote: string; settlement?: string; kind: string }
export const instruments: Record<string, InstrumentInfo> = {
  'binance:spot': { label: 'Binance · BTCUSDT Spot', native: 'BTCUSDT', base: 'BTC', quote: 'USDT', kind: 'spot market' },
  'binance:perpetual': { label: 'Binance · BTCUSDT USD-M Perp', native: 'BTCUSDT', base: 'BTC', quote: 'USDT', settlement: 'USDT', kind: 'linear USD-M perpetual' },
  'hyperliquid:perpetual': { label: 'Hyperliquid · BTC Perp', native: 'BTC', base: 'BTC', quote: 'USD', settlement: 'USDC', kind: 'linear perpetual' },
};
export const duration: Record<Interval, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
export const depthBandsPercent = Object.freeze(Array.from({ length: 25 }, (_, i) => (i + 1) / 100));
export const depthSeriesNames = Object.freeze([
  'iq_depth_bid_base_v1', 'iq_depth_ask_base_v1', 'iq_depth_bid_quote_v1', 'iq_depth_ask_quote_v1',
] as const);
export function marketOf(s: Pick<Series, 'venue' | 'market'>): Market { return s.market ?? 'perpetual'; }
export function instrumentKey(s: Pick<Series, 'venue' | 'market'>): ConnectionKey {
  return `${s.venue}:${marketOf(s)}` as ConnectionKey;
}
export function instrumentOf(s: Pick<Series, 'venue' | 'market'>): InstrumentInfo { return instruments[instrumentKey(s)]!; }
export function instrumentLabel(s: Pick<Series, 'venue' | 'market'>) { return instrumentOf(s).label; }
export function connectionKey(s: Pick<Series, 'venue' | 'market'>): ConnectionKey { return instrumentKey(s); }
export type ConnectionKey = 'binance:spot' | 'binance:perpetual' | 'hyperliquid:perpetual';
export const keyOf = (s: Series) => `${connectionKey(s)}:${instrumentOf(s).native}:${s.interval}`;
export function seriesForInstrument(key: string, interval: Interval): CanonicalSeries | null {
  if (key === 'binance:spot') return { venue: 'binance', market: 'spot', interval };
  if (key === 'binance:perpetual') return { venue: 'binance', market: 'perpetual', interval };
  if (key === 'hyperliquid:perpetual') return { venue: 'hyperliquid', market: 'perpetual', interval };
  return null;
}
export function canonicalSeries(value: unknown): CanonicalSeries | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<Series>;
  if (!((s.venue === 'binance' || s.venue === 'hyperliquid') && intervals.includes(s.interval as Interval))) return null;
  const market = s.market ?? 'perpetual';
  if (market !== 'spot' && market !== 'perpetual') return null;
  if (s.venue === 'hyperliquid' && market !== 'perpetual') return null;
  return { venue: s.venue, market, interval: s.interval as Interval };
}
export function supportsDepth(s: Series) { return s.venue === 'binance'; }
/** Script depth-series consumers still use the direct USD-M book adapter. */
export function supportsScriptDepth(s: Series) { return s.venue === 'binance' && marketOf(s) === 'perpetual'; }
// All times are UTC epoch milliseconds; volume is cumulative base BTC, never a delta.
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; revision: number; closed: boolean }
export type FeedState = 'loading' | 'live' | 'reconnecting' | 'stale' | 'failed';
export interface Status { state: FeedState; message: string; lastUpdate: number }
export type DepthState = 'syncing' | 'live' | 'stale' | 'failed' | 'unsupported';
export interface DepthStatus { state: DepthState; message: string; lastUpdate: number; collectionStartedAt: number | null; snapshotBidBoundary?: number | null; snapshotAskBoundary?: number | null }
export interface DepthObservation {
  sampledAt: number;
  mid: number;
  bandPercent: number;
  bidBase: number | null;
  bidQuote: number | null;
  askBase: number | null;
  askQuote: number | null;
  bidCovered: boolean;
  askCovered: boolean;
}
/** Row widths are quoted directly in USDT and aligned to the exchange PRICE_FILTER grid. */
export const FOOTPRINT_DEFAULT_ROW_PRICE = 25;
export const FOOTPRINT_MAX_ROW_PRICE = 10_000;
/** Prior UI presets, retained only for persisted-layout migration. */
export const legacyFootprintRowTicks = Object.freeze([1, 2, 5, 10, 20, 50] as const);
export type FootprintRowTicks = number;
export function validFootprintRowPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= FOOTPRINT_MAX_ROW_PRICE;
}
/** Collapse harmless Number input noise so equivalent widths share one worker group. */
export function canonicalFootprintRowPrice(value: number): number {
  return validFootprintRowPrice(value) ? Number(value.toPrecision(15)) : value;
}
/** Convert a user-facing quote width to the real exchange tick grid, without rounding off-grid values. */
export function footprintTicksForPrice(rowPrice: number, tickSize: number): number | null {
  if (!validFootprintRowPrice(rowPrice) || !Number.isFinite(tickSize) || tickSize <= 0) return null;
  const count = rowPrice / tickSize;
  const nearest = Math.round(count);
  // Tolerate floating-point noise (e.g. 0.3 / 0.1), while rejecting meaningful
  // fractions such as a half tick even for very small tick sizes.
  const tolerance = Math.min(1e-7, Math.max(1, Math.abs(count)) * Number.EPSILON * 8);
  return Number.isSafeInteger(nearest) && nearest > 0 && Math.abs(count - nearest) <= tolerance ? nearest : null;
}
export const footprintKeyOf = (series: Series, rowPrice: number) =>
  `${connectionKey(series)}:${instrumentOf(series).native}:footprint:${series.interval}:p${canonicalFootprintRowPrice(rowPrice)}`;
export interface FootprintCell {
  /** Inclusive lower bound; the upper bound is price + bar.rowSize (exclusive). */
  price: number; bidVol: number; askVol: number;
  /** Exact observed sum of execution price * base quantity, not bucket price * volume. */
  bidNotional?: number; askNotional?: number;
}
/** Live classified Binance aggTrade observations only; there is no classified history. */
export interface FootprintBar {
  /** UTC interval opening time in seconds; normalized execution timeMs stays milliseconds. */
  time: number;
  revision: number;
  cells: FootprintCell[];
  delta: number;
  /** Extremes along the received aggregate-observation path; not intrafill extrema. */
  minDelta: number;
  maxDelta: number;
  quoteDelta?: number;
  minQuoteDelta?: number;
  maxQuoteDelta?: number;
  rowSize: number;
  source: 'binance-usdm-aggtrade' | 'binance-spot-aggtrade';
  granularity: 'aggregate-trade';
  coverage: 'partial' | 'observed' | 'gapped' | 'capacity-limited';
  gapBefore: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  aggregateRecordCount: number;
}
export interface FootprintStatus extends Status {
  history?: {ready:boolean;validated:boolean;views:number};
  transport?: { cursor: number; backendSentAtMs: number; workerReceivedAtMs: number; workerAppliedAtMs: number };
  tickSize: number | null;
  rowSize: number | null;
  collectionStartedAt: number | null;
  firstTradeAt: number | null;
  lastTradeAt: number | null;
  eventTime: number | null;
  outages: number;
  capacityDrops: number;
  unknownSideRecords: number;
  unknownSideVolume: number;
  lateRecords: number;
  retentionStart: number | null;
  coverage: 'waiting' | 'partial' | 'continuous' | 'gapped' | 'capacity-limited' | 'unclassified';
}
export type Command = {type:'footprint-viewport';id:string;from:number;to:number} | { type: 'heatmap-viewport'; id: string; viewport: import('./staging-heatmap').HeatmapViewport } | { type: 'ticker-update'; id: string; configRevision: number; config: import('../ticker/model').TickerConfig } | { type: 'ticker-subscribe'; id: string; configRevision: number; config: import('../ticker/model').TickerConfig } | { type: 'ticker-unsubscribe'; id: string } | { type: 'ticker-ack'; id: string; generation: number; batchId: number } | { type: 'heatmap-subscribe'; id: string; resolution: HeatmapResolution; market?: Market } | { type: 'heatmap-unsubscribe'; id: string } | { type: 'heatmap-ack'; key: string; generation: number; batchId: number } | { type: 'subscribe'; id: string; series: Series } | { type: 'unsubscribe'; id: string } | { type: 'retry'; id: string } | { type: 'online'; online: boolean } | { type: 'diagnostics' } | { type: 'fixture'; rate: number } | { type: 'depth-subscribe'; id: string; bandPercent: number } | { type: 'depth-unsubscribe'; id: string } | { type: 'depth-retry' } | { type: 'footprint-subscribe'; id: string; series: Series; rowPrice: number } | { type: 'footprint-unsubscribe'; id: string } | { type: 'footprint-retry' } | { type: 'footprint-ack'; key: string; generation: number; batchId: number };
export type Event = import('../ticker/model').TickerBatch | { type: 'heatmap-batch'; ids: string[]; key: string; generation: number; batchId: number; snapshot: boolean; buckets: LiquidityBucket[]; status: HeatmapStatus } | { type: 'snapshot' | 'patch'; key: string; ids: string[]; candles: Candle[] } | { type: 'status'; key: string; ids: string[]; status: Status } | { type: 'depth-status'; ids: string[]; status: DepthStatus } | { type: 'depth-history'; ids: string[]; bandPercent: number; observations: DepthObservation[] } | { type: 'depth-sample'; ids: string[]; observation: DepthObservation } | { type: 'footprint-snapshot' | 'footprint-patch'; key: string; ids: string[]; bars: FootprintBar[]; retentionStart: number | null; generation: number; batchId: number; status: FootprintStatus } | { type: 'footprint-status'; key: string; ids: string[]; status: FootprintStatus; generation: number; batchId: number } | { type: 'diagnostics'; data: Record<string, unknown> };
export function validSeries(s: unknown): s is Series {
  return canonicalSeries(s) !== null;
}
export function validCandle(c: Candle): boolean {
  return [c.t,c.o,c.h,c.l,c.c,c.v,c.revision].every(Number.isFinite) && Number.isSafeInteger(c.t) && c.t > 0 && c.l > 0 && c.v >= 0 && c.h >= Math.max(c.o,c.c,c.l) && c.l <= Math.min(c.o,c.c);
}
export function validDepthBand(value: unknown): value is number {
  return typeof value === 'number' && depthBandsPercent.includes(value);
}

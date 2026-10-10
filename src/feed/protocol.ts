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
export function supportsDepth(s: Series) { return s.venue === 'binance' && marketOf(s) === 'perpetual'; }
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
export type Command = { type: 'subscribe'; id: string; series: Series } | { type: 'unsubscribe'; id: string } | { type: 'retry'; id: string } | { type: 'online'; online: boolean } | { type: 'diagnostics' } | { type: 'fixture'; rate: number } | { type: 'depth-subscribe'; id: string; bandPercent: number } | { type: 'depth-unsubscribe'; id: string } | { type: 'depth-retry' };
export type Event = { type: 'snapshot' | 'patch'; key: string; ids: string[]; candles: Candle[] } | { type: 'status'; key: string; ids: string[]; status: Status } | { type: 'depth-status'; ids: string[]; status: DepthStatus } | { type: 'depth-history'; ids: string[]; bandPercent: number; observations: DepthObservation[] } | { type: 'depth-sample'; ids: string[]; observation: DepthObservation } | { type: 'diagnostics'; data: Record<string, unknown> };
export function validSeries(s: unknown): s is Series {
  return canonicalSeries(s) !== null;
}
export function validCandle(c: Candle): boolean {
  return [c.t,c.o,c.h,c.l,c.c,c.v,c.revision].every(Number.isFinite) && Number.isSafeInteger(c.t) && c.t > 0 && c.l > 0 && c.v >= 0 && c.h >= Math.max(c.o,c.c,c.l) && c.l <= Math.min(c.o,c.c);
}
export function validDepthBand(value: unknown): value is number {
  return typeof value === 'number' && depthBandsPercent.includes(value);
}

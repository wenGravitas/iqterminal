export const intervals = ['1m', '5m', '15m', '1h', '4h'] as const;
export type Interval = typeof intervals[number];
export type Venue = 'binance' | 'hyperliquid';
export interface Series { venue: Venue; interval: Interval }
export const instruments = {
  binance: { label: 'Binance · BTCUSDT Perp', native: 'BTCUSDT', quote: 'USDT', collateral: 'USDT', kind: 'linear perpetual' },
  hyperliquid: { label: 'Hyperliquid · BTC Perp', native: 'BTC', quote: 'USD', collateral: 'USDC', kind: 'linear perpetual' },
} as const;
export const duration: Record<Interval, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
export const keyOf = (s: Series) => `${s.venue}:${instruments[s.venue].native}:${s.interval}`;
// All times are UTC epoch milliseconds; volume is cumulative base BTC, never a delta.
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; revision: number; closed: boolean }
export type FeedState = 'loading' | 'live' | 'reconnecting' | 'stale' | 'failed';
export interface Status { state: FeedState; message: string; lastUpdate: number }
export type Command = { type: 'subscribe'; id: string; series: Series } | { type: 'unsubscribe'; id: string } | { type: 'retry'; id: string } | { type: 'online'; online: boolean } | { type: 'diagnostics' } | { type: 'fixture'; rate: number };
export type Event = { type: 'snapshot' | 'patch'; key: string; ids: string[]; candles: Candle[] } | { type: 'status'; key: string; ids: string[]; status: Status } | { type: 'diagnostics'; data: Record<string, unknown> };
export function validSeries(s: unknown): s is Series {
  if (!s || typeof s !== 'object') return false;
  const v = s as Series;
  return (v.venue === 'binance' || v.venue === 'hyperliquid') && intervals.includes(v.interval);
}
export function validCandle(c: Candle): boolean {
  return [c.t,c.o,c.h,c.l,c.c,c.v,c.revision].every(Number.isFinite) && Number.isSafeInteger(c.t) && c.t > 0 && c.l > 0 && c.v >= 0 && c.h >= Math.max(c.o,c.c,c.l) && c.l <= Math.min(c.o,c.c);
}

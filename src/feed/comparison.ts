import type { Candle, Interval } from './protocol';

export const comparisonIntervals = ['1m', '5m', '15m'] as const;
export type ComparisonInterval = typeof comparisonIntervals[number];
export const comparisonWindows = ['1h', '4h', '24h'] as const;
export type ComparisonWindow = typeof comparisonWindows[number];

export interface ComparisonMarketDefinition {
  id: string;
  symbol: string;
  label: string;
  shortLabel: string;
  dex: string;
  description: string;
}

/** Bounded Release 1 Hyperliquid perpetual catalogue. Symbols are provider-native. */
export const comparisonMarkets = [
  { id: 'BTC', symbol: 'BTC', label: 'BTC', shortLabel: 'BTC', dex: '', description: 'Hyperliquid validator-operated BTC perpetual' },
  { id: 'xyz:XYZ100', symbol: 'xyz:XYZ100', label: 'XYZ100 · Nasdaq proxy', shortLabel: 'XYZ100', dex: 'xyz', description: 'HIP-3 perpetual proxy; not a CME future, cash index, ETF, or spot instrument' },
  { id: 'xyz:SP500', symbol: 'xyz:SP500', label: 'SP500 · S&P 500 proxy', shortLabel: 'SP500', dex: 'xyz', description: 'HIP-3 perpetual proxy; not a CME future, cash index, ETF, or spot instrument' },
  { id: 'xyz:GOLD', symbol: 'xyz:GOLD', label: 'GOLD · gold proxy', shortLabel: 'GOLD', dex: 'xyz', description: 'HIP-3 perpetual proxy; not a COMEX future, cash metal, ETF, or spot instrument' },
  { id: 'xyz:CL', symbol: 'xyz:CL', label: 'CL · oil proxy', shortLabel: 'CL', dex: 'xyz', description: 'HIP-3 perpetual proxy; not a NYMEX future, cash commodity, ETF, or spot instrument' },
  { id: 'xyz:SILVER', symbol: 'xyz:SILVER', label: 'SILVER · silver proxy', shortLabel: 'SILVER', dex: 'xyz', description: 'HIP-3 perpetual proxy; not a COMEX future, cash metal, ETF, or spot instrument' },
] as const satisfies readonly ComparisonMarketDefinition[];

export type ComparisonMarketId = typeof comparisonMarkets[number]['id'];
export type ComparisonMarket = typeof comparisonMarkets[number];

export interface ComparisonIdentity {
  provider: 'hyperliquid';
  venue: 'hyperliquid';
  marketType: 'perpetual';
  symbol: ComparisonMarketId;
  interval: ComparisonInterval;
  priceBasis: 'candle-close';
}

export interface ComparisonRequest {
  interval: ComparisonInterval;
  window: ComparisonWindow;
  symbols: ComparisonMarketId[];
}

export type ComparisonFeedState = 'loading' | 'live' | 'stale' | 'failed' | 'unavailable';
export type ComparisonConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ComparisonStatus {
  state: ComparisonFeedState;
  connection: ComparisonConnectionState;
  message: string;
  historyPending?: boolean;
  lastCandleAt: number | null;
  quietMs: number | null;
  retainedBars: number;
}

export type ComparisonEvent =
  | { type: 'comparison-snapshot' | 'comparison-patch'; ids: string[]; identity: ComparisonIdentity; candles: Candle[]; status: ComparisonStatus }
  | { type: 'comparison-status'; ids: string[]; identity: ComparisonIdentity; status: ComparisonStatus };

export interface ComparisonFeedDiagnostics {
  subscriptions: number;
  activeIdentities: number;
  transport: 'direct' | 'fixture' | 'injected';
  socket: 'closed' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  socketCreations: number;
  historyRequests: number;
  reconnectAttempts: number;
  retainedBars: number;
  pendingCandles: number;
  pendingHistory: number;
  metadataCaches: number;
}

export const comparisonStepMs: Record<ComparisonInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
};

export const comparisonWindowMs: Record<ComparisonWindow, number> = {
  '1h': 3_600_000,
  '4h': 14_400_000,
  '24h': 86_400_000,
};

const byId = new Map<string, ComparisonMarket>(comparisonMarkets.map(market => [market.id, market]));

export function comparisonMarket(symbol: unknown): ComparisonMarket | null {
  return typeof symbol === 'string' ? byId.get(symbol) ?? null : null;
}

export function validComparisonInterval(value: unknown): value is ComparisonInterval {
  return typeof value === 'string' && comparisonIntervals.includes(value as ComparisonInterval);
}

export function validComparisonWindow(value: unknown): value is ComparisonWindow {
  return typeof value === 'string' && comparisonWindows.includes(value as ComparisonWindow);
}

export function comparisonIdentity(symbol: ComparisonMarketId, interval: ComparisonInterval): ComparisonIdentity {
  return { provider: 'hyperliquid', venue: 'hyperliquid', marketType: 'perpetual', symbol, interval, priceBasis: 'candle-close' };
}

export function comparisonIdentityKey(identity: ComparisonIdentity): string {
  return `${identity.provider}:${identity.venue}:${identity.marketType}:${identity.symbol}:${identity.interval}:${identity.priceBasis}`;
}

export function validComparisonIdentity(value: unknown): value is ComparisonIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<ComparisonIdentity>;
  return identity.provider === 'hyperliquid' && identity.venue === 'hyperliquid'
    && identity.marketType === 'perpetual' && identity.priceBasis === 'candle-close'
    && comparisonMarket(identity.symbol) !== null && validComparisonInterval(identity.interval);
}

export function validComparisonRequest(value: unknown): value is ComparisonRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<ComparisonRequest>;
  if (!validComparisonInterval(request.interval) || !validComparisonWindow(request.window)
    || !Array.isArray(request.symbols) || request.symbols.length > comparisonMarkets.length) return false;
  const seen = new Set<string>();
  for (const symbol of request.symbols) {
    if (!comparisonMarket(symbol) || seen.has(symbol)) return false;
    seen.add(symbol);
  }
  return true;
}

export function validateComparisonCandle(raw: unknown, identity: ComparisonIdentity, now = Date.now(), live = false): Candle | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.s !== identity.symbol || data.i !== identity.interval) return null;
  const candle: Candle = {
    t: Number(data.t), o: Number(data.o), h: Number(data.h), l: Number(data.l), c: Number(data.c),
    v: Number(data.v), revision: live ? Number(data.n) : 0,
    closed: Number(data.T) < now,
  };
  const step = comparisonStepMs[identity.interval];
  if (![candle.t, candle.o, candle.h, candle.l, candle.c, candle.v, candle.revision].every(Number.isFinite)
    || !Number.isSafeInteger(candle.t) || candle.t <= 0 || candle.t % step !== 0
    || candle.o <= 0 || candle.h <= 0 || candle.l <= 0 || candle.c <= 0 || candle.v < 0 || candle.revision < 0
    || candle.h < Math.max(candle.o, candle.c, candle.l) || candle.l > Math.min(candle.o, candle.c)) return null;
  return candle;
}

export function intervalFromNative(value: Interval): ComparisonInterval | null {
  return validComparisonInterval(value) ? value : null;
}

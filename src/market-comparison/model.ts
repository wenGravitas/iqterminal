import {
  comparisonIdentity,
  comparisonMarkets,
  comparisonMarket,
  validComparisonIdentity,
  validComparisonInterval,
  validComparisonWindow,
  type ComparisonIdentity,
  type ComparisonInterval,
  type ComparisonMarketId,
  type ComparisonRequest,
  type ComparisonWindow,
} from '../feed/comparison';

export const MARKET_COMPARISON_CONFIG_VERSION = 1;
export const MARKET_COMPARISON_PRESENTATION = 'common-percent' as const;

export interface MarketComparisonInstrumentConfig {
  identity: ComparisonIdentity;
  color: string;
  visible: boolean;
}

export interface MarketComparisonConfig {
  version: typeof MARKET_COMPARISON_CONFIG_VERSION;
  interval: ComparisonInterval;
  window: ComparisonWindow;
  presentation: typeof MARKET_COMPARISON_PRESENTATION;
  follow: 'live' | 'paused';
  instruments: MarketComparisonInstrumentConfig[];
}

export const MARKET_COMPARISON_COLORS: Record<ComparisonMarketId, string> = {
  BTC: '#d1d1d1',
  'xyz:XYZ100': '#65b4a8',
  'xyz:SP500': '#c99755',
  'xyz:GOLD': '#d4b55e',
  'xyz:CL': '#8da9c1',
  'xyz:SILVER': '#b7a4c8',
};

const DEFAULT_MARKETS: readonly ComparisonMarketId[] = ['BTC', 'xyz:XYZ100', 'xyz:SP500', 'xyz:GOLD', 'xyz:CL'];

export function defaultMarketComparisonConfig(): MarketComparisonConfig {
  const interval = '1m' as const;
  return {
    version: MARKET_COMPARISON_CONFIG_VERSION,
    interval,
    window: '4h',
    presentation: MARKET_COMPARISON_PRESENTATION,
    follow: 'live',
    instruments: DEFAULT_MARKETS.map(symbol => ({
      identity: comparisonIdentity(symbol, interval),
      color: MARKET_COMPARISON_COLORS[symbol],
      visible: true,
    })),
  };
}

export function marketComparisonConfig(value: unknown): MarketComparisonConfig {
  const fallback = defaultMarketComparisonConfig();
  if (!validMarketComparisonConfig(value)) return fallback;
  const candidate = value as MarketComparisonConfig;
  return { version: MARKET_COMPARISON_CONFIG_VERSION, interval: candidate.interval, window: candidate.window,
    presentation: MARKET_COMPARISON_PRESENTATION, follow: candidate.follow,
    instruments: candidate.instruments.map(item => ({ identity: { ...item.identity }, color: item.color.toLowerCase(), visible: item.visible })) };
}

export function validMarketComparisonConfig(value: unknown): value is MarketComparisonConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MarketComparisonConfig>;
  if (candidate.version !== MARKET_COMPARISON_CONFIG_VERSION || !validComparisonInterval(candidate.interval)
    || !validComparisonWindow(candidate.window) || candidate.presentation !== MARKET_COMPARISON_PRESENTATION
    || (candidate.follow !== 'live' && candidate.follow !== 'paused') || !Array.isArray(candidate.instruments)
    || candidate.instruments.length < 1 || candidate.instruments.length > comparisonMarkets.length) return false;
  const seen = new Set<string>();
  for (const raw of candidate.instruments) {
    if (!raw || typeof raw !== 'object') return false;
    const item = raw as Partial<MarketComparisonInstrumentConfig>;
    if (!validComparisonIdentity(item.identity) || item.identity.interval !== candidate.interval
      || seen.has(item.identity.symbol) || typeof item.visible !== 'boolean'
      || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) return false;
    if (!comparisonMarket(item.identity.symbol)) return false;
    seen.add(item.identity.symbol);
  }
  return candidate.instruments.some(item => item.visible);
}

export function comparisonRequest(config: MarketComparisonConfig): ComparisonRequest {
  return { interval: config.interval, window: config.window,
    symbols: config.instruments.filter(item => item.visible).map(item => item.identity.symbol) };
}

export function setMarketComparisonInterval(config: MarketComparisonConfig, interval: ComparisonInterval): MarketComparisonConfig {
  return marketComparisonConfig({ ...config, interval,
    instruments: config.instruments.map(item => ({ ...item, identity: { ...item.identity, interval } })) });
}

export function setMarketComparisonSymbols(config: MarketComparisonConfig, symbols: readonly ComparisonMarketId[]): MarketComparisonConfig {
  const unique = [...new Set(symbols)].slice(0, comparisonMarkets.length);
  if (!unique.length) return config;
  const previous = new Map(config.instruments.map(item => [item.identity.symbol, item]));
  const instruments = unique.map(symbol => {
    const old = previous.get(symbol);
    return old ? { ...old } : { identity: comparisonIdentity(symbol, config.interval), color: MARKET_COMPARISON_COLORS[symbol], visible: true };
  });
  return marketComparisonConfig({ ...config, instruments });
}

export function setMarketComparisonVisibility(config: MarketComparisonConfig, symbol: ComparisonMarketId, visible: boolean): MarketComparisonConfig {
  const instruments = config.instruments.map(item => item.identity.symbol === symbol ? { ...item, visible } : item);
  return marketComparisonConfig({ ...config, instruments });
}

export function setMarketComparisonColor(config: MarketComparisonConfig, symbol: ComparisonMarketId, color: string): MarketComparisonConfig {
  const instruments = config.instruments.map(item => item.identity.symbol === symbol ? { ...item, color } : item);
  return marketComparisonConfig({ ...config, instruments });
}

export function comparisonLabels(config: MarketComparisonConfig) {
  return config.instruments.map(item => ({ ...comparisonMarket(item.identity.symbol)!, ...item }));
}

export type { ComparisonInterval, ComparisonWindow };

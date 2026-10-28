import type { NormalizedExecution } from '../feed/footprint';
import { instrumentOf, type ConnectionKey, type FeedState, type Series } from '../feed/protocol';
import { classify, defaultTiers, tickerConfig, tradeSize, validateTiers, type Tier } from '../ticker/model';

export const TRADE_BUBBLES_ID = 'native.trade-bubbles';
export const TRADE_BUBBLES_SETTINGS_VERSION = 1;
export const TRADE_BUBBLE_SOURCES = ['binance:spot', 'binance:perpetual'] as const;
export type TradeBubbleSource = typeof TRADE_BUBBLE_SOURCES[number];
export type TradeBubbleSourceMode = 'follow-chart' | 'explicit' | 'both';
export type TradeBubbleSide = 'both' | 'buy' | 'sell';
export type TradeBubbleColorMode = 'tier' | 'side';
export type TradeBubbleLabels = 'off' | 'tier' | 'notional' | 'both';

export interface TradeBubbleSettings {
  version: 1;
  sourceMode: TradeBubbleSourceMode;
  sources: TradeBubbleSource[];
  minimumNotionalUsdt: number;
  side: TradeBubbleSide;
  tierChoice: 'all' | string;
  tiers: Tier[];
  colorMode: TradeBubbleColorMode;
  buyColor: string;
  sellColor: string;
  opacity: number;
  minRadius: number;
  maxRadius: number;
  radiusCapNotional: number;
  maximumVisible: number;
  labels: TradeBubbleLabels;
}

export const TRADE_BUBBLE_MAX_RECORDS = 2048;
export const TRADE_BUBBLE_BATCH_LIMIT = 256;
export const TRADE_BUBBLE_MAX_VISIBLE = 500;
export const TRADE_BUBBLE_DEFAULT_SETTINGS: TradeBubbleSettings = Object.freeze({
  version: TRADE_BUBBLES_SETTINGS_VERSION,
  sourceMode: 'follow-chart',
  sources: [],
  minimumNotionalUsdt: 100_000,
  side: 'both',
  tierChoice: 'all',
  tiers: defaultTiers(),
  colorMode: 'tier',
  buyColor: '#58a65c',
  sellColor: '#ad5858',
  opacity: .78,
  minRadius: 3,
  maxRadius: 14,
  radiusCapNotional: 1_000_000,
  maximumVisible: 120,
  labels: 'tier',
});

const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function tradeBubbleSettings(value: unknown): TradeBubbleSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  let tiers = defaultTiers();
  try { if (raw.tiers) tiers = validateTiers(raw.tiers); } catch { /* retain defaults for corrupt saved snapshots */ }
  const sourceMode: TradeBubbleSourceMode = raw.sourceMode === 'explicit' || raw.sourceMode === 'both' ? raw.sourceMode : 'follow-chart';
  const sourceValues: unknown[] = Array.isArray(raw.sources) ? raw.sources : [];
  const sources = sourceValues.length
    ? TRADE_BUBBLE_SOURCES.filter((source) => sourceValues.includes(source))
    : [];
  const requestedMinimum = finite(raw.minimumNotionalUsdt, TRADE_BUBBLE_DEFAULT_SETTINGS.minimumNotionalUsdt, 100_000, 1e12);
  const minRadius = finite(raw.minRadius, TRADE_BUBBLE_DEFAULT_SETTINGS.minRadius, 1, 24);
  const maxRadius = finite(raw.maxRadius, TRADE_BUBBLE_DEFAULT_SETTINGS.maxRadius, 2, 32);
  const selectedTier = typeof raw.tierChoice === 'string' && tiers.some(tier => tier.id === raw.tierChoice) ? raw.tierChoice : 'all';
  const color = (candidate: unknown, fallback: string) => typeof candidate === 'string' && /^#[\da-f]{6}$/i.test(candidate) ? candidate : fallback;
  return {
    version: TRADE_BUBBLES_SETTINGS_VERSION,
    sourceMode,
    sources,
    minimumNotionalUsdt: requestedMinimum,
    side: raw.side === 'buy' || raw.side === 'sell' ? raw.side : 'both',
    tierChoice: selectedTier,
    tiers,
    colorMode: raw.colorMode === 'side' ? 'side' : 'tier',
    buyColor: color(raw.buyColor, TRADE_BUBBLE_DEFAULT_SETTINGS.buyColor),
    sellColor: color(raw.sellColor, TRADE_BUBBLE_DEFAULT_SETTINGS.sellColor),
    opacity: finite(raw.opacity, TRADE_BUBBLE_DEFAULT_SETTINGS.opacity, .1, 1),
    minRadius: Math.min(minRadius, maxRadius),
    maxRadius: Math.max(minRadius, maxRadius),
    radiusCapNotional: Math.max(requestedMinimum, finite(raw.radiusCapNotional, TRADE_BUBBLE_DEFAULT_SETTINGS.radiusCapNotional, 100_000, 1e12)),
    maximumVisible: Math.round(finite(raw.maximumVisible, TRADE_BUBBLE_DEFAULT_SETTINGS.maximumVisible, 1, TRADE_BUBBLE_MAX_VISIBLE)),
    labels: raw.labels === 'off' || raw.labels === 'notional' || raw.labels === 'both' ? raw.labels : 'tier',
  };
}

export interface TradeBubbleSourceResolution {
  requested: TradeBubbleSource[];
  compatible: TradeBubbleSource[];
  incompatible: TradeBubbleSource[];
  state: 'compatible' | 'incompatible' | 'unavailable';
  message: string;
}

export function requestedTradeBubbleSources(settingsValue: unknown, series: Series): TradeBubbleSource[] {
  const settings = tradeBubbleSettings(settingsValue);
  if (settings.sourceMode === 'both') return [...TRADE_BUBBLE_SOURCES];
  if (settings.sourceMode === 'explicit') return [...settings.sources];
  if (series.venue !== 'binance') return [];
  return [series.market === 'spot' ? 'binance:spot' : 'binance:perpetual'];
}

/** Sources are only price-aligned on a BTC/USDT Binance chart in Release 1. */
export function resolveTradeBubbleSources(settingsValue: unknown, series: Series): TradeBubbleSourceResolution {
  const settings = tradeBubbleSettings(settingsValue);
  const requested = requestedTradeBubbleSources(settings, series);
  if (settings.sourceMode === 'follow-chart' && series.venue !== 'binance') {
    return { requested: [], compatible: [], incompatible: [], state: 'unavailable', message: 'Follow chart is unavailable: Release 1 executions are supported on Binance BTCUSDT Spot and USD-M Perpetual charts.' };
  }
  if (!requested.length) {
    return { requested, compatible: [], incompatible: [], state: 'unavailable', message: 'Choose a Binance BTCUSDT execution source.' };
  }
  const instrument = instrumentOf(series);
  const compatible = series.venue === 'binance' && instrument.base === 'BTC' && instrument.quote === 'USDT' ? requested : [];
  const incompatible = requested.filter(source => !compatible.includes(source));
  if (incompatible.length) {
    return { requested, compatible, incompatible, state: 'incompatible', message: `${incompatible.join(' + ')} is quoted in USDT and cannot be aligned to this ${instrument.quote} chart without a validated conversion.` };
  }
  return { requested, compatible, incompatible, state: 'compatible', message: `Binance ${requested.map(source => source.endsWith(':spot') ? 'Spot' : 'USD-M Perp').join(' + ')} · BTC/USDT` };
}

export interface TradeBubbleRecord {
  id: string;
  execution: NormalizedExecution;
  notionalUsdt: number;
  tier: Tier | null;
  receivedAt: number;
}

export interface TradeBubbleStatus {
  state: FeedState;
  availability: TradeBubbleSourceResolution['state'];
  message: string;
  lastUpdate: number;
  gaps: number;
  dropped: number;
}

export interface TradeBubbleBatch {
  type: 'trade-bubbles-batch';
  ids: string[];
  configRevision: number;
  generation: number;
  batchId: number;
  snapshot: boolean;
  records: TradeBubbleRecord[];
  status: TradeBubbleStatus;
}

export function executionNotionalUsdt(execution: NormalizedExecution): number {
  const exact = execution.quoteNotionalText === undefined ? NaN : Number(execution.quoteNotionalText);
  const value = Number.isFinite(exact) && exact > 0 ? exact : execution.price * execution.quantity;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Convert a normalized execution once, preserving source ID and exchange trade grouping. */
export function makeTradeBubbleRecord(execution: NormalizedExecution, receivedAt: number, settingsValue: unknown): TradeBubbleRecord | null {
  const settings = tradeBubbleSettings(settingsValue);
  const source = `${execution.venue}:${execution.market}` as ConnectionKey;
  if (!TRADE_BUBBLE_SOURCES.includes(source as TradeBubbleSource) || execution.venue !== 'binance' || execution.nativeSymbol !== 'BTCUSDT') return null;
  if (!Number.isFinite(execution.timeMs) || !Number.isFinite(execution.price) || !Number.isFinite(execution.quantity)
    || execution.timeMs <= 0 || execution.price <= 0 || execution.quantity <= 0) return null;
  if (settings.side !== 'both' && execution.side !== settings.side) return null;
  const notionalUsdt = executionNotionalUsdt(execution);
  if (notionalUsdt < settings.minimumNotionalUsdt) return null;
  const market = source as TradeBubbleSource;
  const classification = tickerConfig({ markets: [market], scope: [market], tiers: settings.tiers });
  const tier = classify(execution, classification);
  if (settings.tierChoice !== 'all' && tier?.id !== settings.tierChoice) return null;
  return { id: execution.executionId, execution, notionalUsdt, tier, receivedAt };
}

/** Bubble radius is chosen so visible disk area scales linearly across the configured notional range. */
export function tradeBubbleRadius(notional: number, settingsValue: unknown): number {
  const settings = tradeBubbleSettings(settingsValue);
  const span = Math.max(1, settings.radiusCapNotional - settings.minimumNotionalUsdt);
  const fraction = Math.max(0, Math.min(1, (notional - settings.minimumNotionalUsdt) / span));
  return Math.sqrt(settings.minRadius ** 2 + fraction * (settings.maxRadius ** 2 - settings.minRadius ** 2));
}

export function tradeBubbleColor(record: TradeBubbleRecord, settingsValue: unknown): string {
  const settings = tradeBubbleSettings(settingsValue);
  if (settings.colorMode === 'tier' && record.tier) return record.execution.side === 'buy' ? record.tier.buyColor : record.execution.side === 'sell' ? record.tier.sellColor : '#858585';
  return record.execution.side === 'buy' ? settings.buyColor : record.execution.side === 'sell' ? settings.sellColor : '#858585';
}

/** Keep the largest exact executions when pixels cannot show every retained bubble. */
export function topTradeBubbles(records: readonly TradeBubbleRecord[], maximum: number): TradeBubbleRecord[] {
  return [...records].sort((a, b) => b.notionalUsdt - a.notionalUsdt || a.id.localeCompare(b.id)).slice(0, Math.max(0, Math.floor(maximum)));
}

export function bubbleTierSummary(settingsValue: unknown): string {
  const settings = tradeBubbleSettings(settingsValue);
  const tier = settings.tiers.find(item => item.id === settings.tierChoice);
  return tier ? tier.name : 'all tiers';
}

export function bubbleTradeSize(execution: NormalizedExecution, unit: 'BTC' | 'USDT'): number {
  return tradeSize(execution, unit);
}

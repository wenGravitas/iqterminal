import { OrderWallRankIndex } from './order-wall-rank';
import type { Series } from './protocol';

export const ORDER_WALLS_ID = 'native.order-walls';
export const ORDER_WALL_MAX_LEVELS_PER_SIDE = 5_000;
export const ORDER_WALL_MAX_SEGMENTS = 20_000;
export const ORDER_WALL_MAX_VALUE_RUNS = 50_000;
export const ORDER_WALL_MAX_VALUE_RUNS_PER_SEGMENT = 2_048;

export type OrderWallAggregation = 'auto' | 'native' | 10 | 25 | 50 | 100 | 250;
export type OrderWallColorMode = 'heat' | 'bid-ask';
export interface OrderWallsSettings {
  enabled: boolean;
  mode: 'top-levels' | 'threshold';
  topLevels: number;
  searchRangePercent: number;
  minimumNotionalEnabled: boolean;
  minimumNotionalUsd: number;
  highContrast: boolean;
  visibleRangeOnly: boolean;
  strengthThickness: boolean;
  historyEpisodes: number;
  showHistory: boolean;
  showPriceLines: boolean;
  method: 'relative' | 'absolute';
  thresholdUsd: number;
  relativeFloorUsd: number;
  /** Percentile on a 0-100 scale; 95 means p95. */
  relativePercentile: number;
  exitRatio: number;
  minDurationMs: number;
  aggregation: OrderWallAggregation;
  colorMode: OrderWallColorMode;
  opacity: number;
  thicknessPx: number;
}

export const DEFAULT_ORDER_WALLS_SETTINGS: Readonly<OrderWallsSettings> = Object.freeze({
  enabled: false,
  mode: 'top-levels', topLevels: 8, searchRangePercent: 10,
  minimumNotionalEnabled: false, minimumNotionalUsd: 100_000,
  highContrast: true, visibleRangeOnly: true, strengthThickness: true, historyEpisodes: 2000,
  showHistory: true,
  showPriceLines: false,
  method: 'relative',
  thresholdUsd: 500_000,
  relativeFloorUsd: 250_000,
  relativePercentile: 95,
  exitRatio: 0.85,
  minDurationMs: 0,
  aggregation: 'native',
  colorMode: 'heat',
  opacity: 0.85,
  thicknessPx: 3,
});

const aggregations: readonly OrderWallAggregation[] = ['auto', 'native', 10, 25, 50, 100, 250];
const bounded = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

export function orderWallsSettings(value: unknown): OrderWallsSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  // Explicit old settings keep Threshold Walls; new instances carry the new mode.
  const mode = v.mode === 'threshold' || v.mode !== 'top-levels' && ('method' in v || 'relativePercentile' in v) ? 'threshold' : 'top-levels';
  let aggregation = aggregations.find(item => item === v.aggregation) ?? (mode === 'threshold' ? 'auto' : DEFAULT_ORDER_WALLS_SETTINGS.aggregation);
  if(mode === 'threshold' && v.aggregation === undefined) aggregation = 'auto';
  if(mode === 'top-levels' && aggregation === 'auto') aggregation = 'native';
  return {
    enabled: v.enabled === true, mode,
    topLevels: Math.floor(bounded(v.topLevels, 1, 10, 8)),
    searchRangePercent: bounded(v.searchRangePercent, .01, 10, 10),
    minimumNotionalEnabled: v.minimumNotionalEnabled === true,
    minimumNotionalUsd: bounded(v.minimumNotionalUsd, 0, 1_000_000_000_000, 100_000),
    highContrast: v.highContrast !== false, visibleRangeOnly: v.visibleRangeOnly !== false, strengthThickness: v.strengthThickness !== false,
    historyEpisodes: Math.floor(bounded(v.historyEpisodes, 16, ORDER_WALL_MAX_SEGMENTS, mode === 'threshold' ? ORDER_WALL_MAX_SEGMENTS : 2000)),
    showHistory: v.showHistory !== false,
    showPriceLines: v.showPriceLines === true,
    method: v.method === 'absolute' ? 'absolute' : 'relative',
    thresholdUsd: bounded(v.thresholdUsd, 1, 1_000_000_000_000, DEFAULT_ORDER_WALLS_SETTINGS.thresholdUsd),
    relativeFloorUsd: bounded(v.relativeFloorUsd, 1, 1_000_000_000_000, DEFAULT_ORDER_WALLS_SETTINGS.relativeFloorUsd),
    relativePercentile: bounded(v.relativePercentile, 50, 99.9, DEFAULT_ORDER_WALLS_SETTINGS.relativePercentile),
    exitRatio: bounded(v.exitRatio, 0.1, 1, DEFAULT_ORDER_WALLS_SETTINGS.exitRatio),
    minDurationMs: bounded(v.minDurationMs, 0, 60_000, DEFAULT_ORDER_WALLS_SETTINGS.minDurationMs),
    aggregation,
    colorMode: v.colorMode === 'bid-ask' ? 'bid-ask' : 'heat',
    opacity: bounded(v.opacity, 0, 1, DEFAULT_ORDER_WALLS_SETTINGS.opacity),
    thicknessPx: bounded(v.thicknessPx, 1, 4, mode === 'threshold' ? 2 : DEFAULT_ORDER_WALLS_SETTINGS.thicknessPx),
  };
}

export type OrderWallMarket = 'binance-spot' | 'binance-perp' | 'hyperliquid';
export function orderWallMarket(series: Pick<Series, 'venue' | 'market'>): OrderWallMarket {
  if (series.venue === 'hyperliquid') return 'hyperliquid';
  return series.market === 'spot' ? 'binance-spot' : 'binance-perp';
}

export interface OrderWallRequest {
  market: OrderWallMarket;
  from: number;
  to: number;
  settings: OrderWallsSettings;
  /** Resolved only for `aggregation: auto`; never persisted with the visible setting. */
  autoPriceWidth?: number;
  /** True only while the visible chart is at the current durable depth tail. */
  followLive?: boolean;
}
export interface OrderWallCoverage {
  from: number;
  to: number;
  complete: boolean;
  partial: boolean;
  reason?: string;
}
export interface OrderWallBookScope {
  maxLevelsPerSide: number;
  bidComplete: boolean;
  askComplete: boolean;
  bidFloor?: number;
  askCeiling?: number;
}
export interface OrderWallStatus {
  state: 'loading' | 'live' | 'stale' | 'gap' | 'unavailable';
  message?: string;
  tickSize?: number;
  /** Effective quote-price bucket width used for detection and display. */
  resolvedPriceWidth?: number;
  /** Last host-received depth state; active lines stop here until another observation arrives. */
  lastConfirmedAt?: number;
  /** Lowest time with retained source observations, when the source provides it. */
  retentionStart?: number;
  coverage?: OrderWallCoverage;
  bookScope?: OrderWallBookScope;
  /** Host receive timestamps regressed; event cursor order was kept and times clamped. */
  clockRegressed?: boolean;
  /** Latest-book bootstrap is visible while ordered viewport replay is still catching up. */
  provisional?: boolean;
  /** Ordered history processed so far; a blank unreplayed interval is not a no-wall result. */
  rankingScope?: { mid: number; lower: number; upper: number; partial: boolean; bidCount: number; askCount: number };
  valueHistoryLimited?: boolean;
  episodeHistoryLimited?: boolean;
  replay?: { from: number; to: number; through: number };
}
export interface OrderWallSegment {
  id: string;
  /** Depth-book generation that bounds continuity for this segment. */
  epoch: string | number;
  side: 'bid' | 'ask';
  price: number;
  start: number;
  end: number | null;
  peakUsd: number;
  meanUsd: number;
  durationMs: number;
  percentile: number | null;
  scopePartial: boolean;
  /** False when a seed already contains the qualifying level at the timeline's left edge. */
  startKnown: boolean;
  detectionMode?: OrderWallsSettings['mode'];
  rank?: number;
  valueRuns: OrderWallValuePoint[];
  valueRunsTruncated: boolean;
  /** Closed by a confirmed below-threshold observation, an explicit removal, or a gap/epoch censor. */
  endReason: 'below-threshold' | 'removed' | 'censored' | 'rank-exit' | 'out-of-range' | 'below-minimum' | null;
  endKnown: boolean;
  censoredReason?: string;
}
export interface OrderWallValuePoint { at: number; usd: number; percentile: number | null; rank?: number | null; quantity?: number }
export interface OrderWallHit {
  segment: OrderWallSegment;
  at: number;
  x: number;
  y: number;
  priceLow: number;
  priceHigh: number;
  percentile: number | null;
}
/** Patch id is the segment id, including for a null removal. */
export interface OrderWallPatch { id: string; segment: OrderWallSegment | null; valuePoints?: OrderWallValuePoint[]; replaceValueRuns?: boolean }
export interface OrderWallBatch {
  kind: 'snapshot' | 'patch';
  segments?: OrderWallSegment[];
  patches?: OrderWallPatch[];
  status: OrderWallStatus;
}

export type OrderWallDepthRecord = {
  kind: 'delta' | 'checkpoint' | 'gap' | 'snapshot';
  at: number;
  cursor: number;
  epoch: string | number;
  bids?: ReadonlyArray<readonly [price: number, quantity: number]>;
  asks?: ReadonlyArray<readonly [price: number, quantity: number]>;
  bookScope?: Partial<OrderWallBookScope>;
  reason?: string;
};

interface WallState {
  id: string;
  epoch: string | number;
  side: 'bid' | 'ask';
  price: number;
  start: number;
  lastAt: number;
  currentUsd: number;
  peakUsd: number;
  usdMs: number;
  percentile: number | null;
  scopePartial: boolean;
  startKnown: boolean;
  rank?: number;
  quantity?: number;
  valueHistory: { runs: OrderWallValuePoint[]; truncated: boolean; segment?: OrderWallSegment };
}
interface PriceBucket { price: number; usd: number }

/**
 * Replays absolute book-level replacements into price buckets and emits wall segments.
 * A snapshot/checkpoint starts a known book state; gaps censor active segments at the
 * last confirmed observation and require a fresh snapshot before detection resumes.
 */
export class OrderWallDetector {
  private valueRunQueue: Array<{ history: WallState['valueHistory']; point: OrderWallValuePoint }> = [];
  private valueRunQueueStart = 0;
  private valueRunCount = 0;
  private valueHistoryLimited = false;
  private episodeHistoryLimited = false;
  private bidRank = new OrderWallRankIndex();
  private askRank = new OrderWallRankIndex();
  private bidPrices = new OrderWallRankIndex();
  private askPrices = new OrderWallRankIndex();
  private rankingScope?: OrderWallStatus['rankingScope'];
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private bidBucketNotionals = new Map<number, number>();
  private askBucketNotionals = new Map<number, number>();
  private bidBucketCounts = new Map<number, number>();
  private askBucketCounts = new Map<number, number>();
  /** Per-bucket insertion order lets a changed bucket retain full-scan FP summation. */
  private bidBucketPrices = new Map<number, Set<number>>();
  private askBucketPrices = new Map<number, Set<number>>();
  private active = new Map<string, WallState>();
  private segments = new Map<string, OrderWallSegment>();
  private lastAt: number | null = null;
  private lastCursor = -1;
  private epoch: string | number | null = null;
  private awaitingSnapshot = true;
  private sawGap = false;
  private clockRegressed = false;
  private bookScope: OrderWallBookScope = {
    maxLevelsPerSide: ORDER_WALL_MAX_LEVELS_PER_SIDE,
    bidComplete: false,
    askComplete: false,
  };

  constructor(private settings: OrderWallsSettings, private tickSize: number, private autoPriceWidth = tickSize) {
    this.settings = orderWallsSettings(settings);
    if (!Number.isFinite(tickSize) || tickSize <= 0) throw new RangeError('Order walls require a valid exchange tick size');
    if (!Number.isFinite(autoPriceWidth) || autoPriceWidth < tickSize) this.autoPriceWidth = tickSize;
  }

  updateSettings(settings: OrderWallsSettings) {
    const priorWidth = this.priceWidth(), priorMode = this.settings.mode;
    this.settings = orderWallsSettings(settings);
    if (this.priceWidth() !== priorWidth || this.settings.mode !== priorMode) this.rebuildBucketNotionals();
  }
  priceWidth() { return this.settings.aggregation === 'native' ? this.tickSize : this.settings.aggregation === 'auto' ? this.autoPriceWidth : this.settings.aggregation; }
  setAutoPriceWidth(width: number) {
    if (!Number.isFinite(width) || width < this.tickSize) return;
    const priorWidth = this.priceWidth();
    this.autoPriceWidth = width;
    if (this.priceWidth() !== priorWidth) this.rebuildBucketNotionals();
  }

  /** Advance confirmation when the durable cursor barrier proves no changes were omitted. */
  confirmHead(at: number, cursor: number): OrderWallPatch[] {
    if (this.awaitingSnapshot || !Number.isFinite(at) || at < (this.lastAt ?? at) || !Number.isSafeInteger(cursor) || cursor < this.lastCursor) return [];
    const patches: OrderWallPatch[] = [];
    for (const state of this.active.values()) {
      this.accumulate(state, at); state.lastAt = at;
      patches.push({ id: state.id, segment: this.toSegment(state, null) });
    }
    this.lastAt = at; this.lastCursor = cursor;
    return patches;
  }

  /** Close active walls at the last confirmed observation when the source resets. */
  censor(reason: string): OrderWallPatch[] {
    return this.closeForGap(reason, this.lastAt ?? 0);
  }

  processBatch(records: readonly OrderWallDepthRecord[]): OrderWallPatch[] {
    const ordered = records.filter(validRecord).slice().sort((a, b) => a.cursor - b.cursor);
    const changed = new Map<string, OrderWallPatch>();
    let at: number | undefined, lastQueuedAt = this.lastAt ?? -Infinity, sameTime: OrderWallDepthRecord[] = [];
    const flush = () => {
      if (at === undefined || !sameTime.length) return;
      let touched = false;
      const seedAtTime = sameTime.some(record => record.kind === 'snapshot' || record.kind === 'checkpoint');
      const removed = new Set<string>();
      for (const record of sameTime) {
        if (record.cursor <= this.lastCursor) continue;
        if (record.kind === 'delta') for (const [side, levels] of [['bid', record.bids], ['ask', record.asks]] as const) {
          for (const [price, quantity] of levels ?? []) if (quantity === 0) removed.add(segmentKey(side, this.bucketPrice(price)));
        }
        const patches = this.acceptRecord(record);
        for (const patch of patches) mergePatch(changed, patch);
        touched ||= record.kind !== 'gap';
        this.lastCursor = record.cursor;
      }
      if (touched && !this.awaitingSnapshot) {
        for (const patch of this.evaluate(at, !seedAtTime, removed, seedAtTime)) mergePatch(changed, patch);
      }
      sameTime = [];
    };
    for (const record of ordered) {
      if (record.cursor <= this.lastCursor) continue;
      let effectiveAt = record.at;
      if (effectiveAt < lastQueuedAt) {
        this.clockRegressed = true;
        effectiveAt = lastQueuedAt;
      }
      lastQueuedAt = effectiveAt;
      const normalized = effectiveAt === record.at ? record : { ...record, at: effectiveAt };
      if (at !== undefined && at !== effectiveAt) flush();
      at = effectiveAt;
      sameTime.push(normalized);
    }
    flush();
    return [...changed.values()];
  }

  private acceptRecord(record: OrderWallDepthRecord): OrderWallPatch[] {
    if (this.lastAt !== null && record.at < this.lastAt) return [];
    if (record.kind === 'gap') return this.closeForGap(record.reason, record.at);
    if (record.kind === 'snapshot' || record.kind === 'checkpoint') {
      const continuesEpoch = record.kind === 'checkpoint' && !this.awaitingSnapshot && this.epoch === record.epoch;
      const patches = continuesEpoch ? [] : this.censorActive(this.lastAt ?? record.at,
        this.epoch === null ? 'Depth book started from a replacement snapshot.' : 'Depth epoch changed; prior wall end is unknown.');
      this.bids.clear(); this.asks.clear();
    this.bidRank.clear(); this.askRank.clear(); this.bidPrices.clear(); this.askPrices.clear(); this.rankingScope = undefined;
      this.bidBucketNotionals.clear(); this.askBucketNotionals.clear();
      this.bidBucketCounts.clear(); this.askBucketCounts.clear();
      this.bidBucketPrices.clear(); this.askBucketPrices.clear();
      this.epoch = record.epoch;
      this.awaitingSnapshot = false;
      this.sawGap = false;
      this.applyLevels(this.bids, this.bidBucketNotionals, this.bidBucketCounts, this.bidBucketPrices, record.bids ?? []);
      this.applyLevels(this.asks, this.askBucketNotionals, this.askBucketCounts, this.askBucketPrices, record.asks ?? []);
      this.setScope(record.bookScope);
      this.lastAt = record.at;
      this.trimBook();
      return patches;
    }
    if (this.awaitingSnapshot || this.epoch !== record.epoch) {
      this.awaitingSnapshot = true;
      return this.closeForGap('Depth epoch changed before a replacement snapshot', record.at);
    }
    this.applyLevels(this.bids, this.bidBucketNotionals, this.bidBucketCounts, this.bidBucketPrices, record.bids ?? []);
    this.applyLevels(this.asks, this.askBucketNotionals, this.askBucketCounts, this.askBucketPrices, record.asks ?? []);
    if (record.bookScope) this.setScope(record.bookScope);
    this.lastAt = record.at;
    this.trimBook();
    return [];
  }

  private closeForGap(reason: string | undefined, _at: number): OrderWallPatch[] {
    const end = this.lastAt;
    const patches = this.censorActive(end ?? 0, reason ?? 'Depth continuity gap; prior wall end is unknown.');
    this.bids.clear(); this.asks.clear();
    this.bidRank.clear(); this.askRank.clear(); this.bidPrices.clear(); this.askPrices.clear(); this.rankingScope = undefined;
    this.bidBucketNotionals.clear(); this.askBucketNotionals.clear();
    this.bidBucketCounts.clear(); this.askBucketCounts.clear();
    this.bidBucketPrices.clear(); this.askBucketPrices.clear();
    this.awaitingSnapshot = true;
    this.sawGap = true;
    this.epoch = null;
    this.bookScope = { maxLevelsPerSide: ORDER_WALL_MAX_LEVELS_PER_SIDE, bidComplete: false, askComplete: false };
    return patches;
  }

  private applyLevels(map: Map<number, number>, notionals: Map<number, number>, counts: Map<number, number>,
    bucketPrices: Map<number, Set<number>>,
    levels: ReadonlyArray<readonly [number, number]>) {
    const changedBuckets = new Set<number>();
    for (const [price, quantity] of levels) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) continue;
      const previous = map.get(price) ?? 0;
      if(this.settings.mode==='top-levels'&&this.settings.aggregation!=='native')(map === this.bids ? this.bidPrices : this.askPrices).set(price, price * quantity, quantity);
      const bucket = this.bucketPrice(price);
      if (quantity === 0) {
        if (previous === 0) continue;
        map.delete(price);
        bucketPrices.get(bucket)?.delete(price);
        changedBuckets.add(bucket);
      } else {
        map.set(price, quantity);
        if (previous === 0) {
          const prices = bucketPrices.get(bucket) ?? new Set<number>();
          prices.add(price);
          bucketPrices.set(bucket, prices);
        }
        changedBuckets.add(bucket);
      }
    }
    for (const bucket of changedBuckets) {
      const prices = bucketPrices.get(bucket);
      if (!prices?.size) {
        bucketPrices.delete(bucket); counts.delete(bucket); notionals.delete(bucket);
        if(this.settings.mode==='top-levels')(map === this.bids ? this.bidRank : this.askRank).set(bucket, 0);
        continue;
      }
      // Threshold Walls preserves its original summation order. Top Levels uses
      // deterministic tree sums so identical checkpoints cannot reorder ranks.
      let usd = 0;
      if(this.settings.mode==='top-levels'&&this.settings.aggregation!=='native')usd=(map===this.bids?this.bidPrices:this.askPrices).sum(bucket,bucket+this.priceWidth());
      else for (const price of prices) usd += price * map.get(price)!;
      counts.set(bucket, prices.size);
      notionals.set(bucket, usd);
      if(this.settings.mode==='top-levels')(map === this.bids ? this.bidRank : this.askRank).set(bucket, usd, this.settings.aggregation==='native'?map.get(bucket)??0:0);
    }
  }

  private setScope(scope?: Partial<OrderWallBookScope>) {
    if (!scope) {
      this.bookScope = { maxLevelsPerSide: ORDER_WALL_MAX_LEVELS_PER_SIDE, bidComplete: false, askComplete: false };
      return;
    }
    this.bookScope = {
      maxLevelsPerSide: ORDER_WALL_MAX_LEVELS_PER_SIDE,
      bidComplete: scope.bidComplete === true,
      askComplete: scope.askComplete === true,
      ...(Number.isFinite(scope.bidFloor) ? { bidFloor: scope.bidFloor } : {}),
      ...(Number.isFinite(scope.askCeiling) ? { askCeiling: scope.askCeiling } : {}),
    };
  }

  private trimBook() {
    if (this.bids.size > ORDER_WALL_MAX_LEVELS_PER_SIDE) {
      const prices = [...this.bids.keys()].sort((a, b) => b - a);
      this.applyLevels(this.bids, this.bidBucketNotionals, this.bidBucketCounts,
        this.bidBucketPrices, prices.slice(ORDER_WALL_MAX_LEVELS_PER_SIDE).map(price => [price, 0] as const));
      this.bookScope.bidComplete = false;
      this.bookScope.bidFloor = Math.max(this.bookScope.bidFloor ?? -Infinity, prices[ORDER_WALL_MAX_LEVELS_PER_SIDE - 1]!);
    }
    if (this.asks.size > ORDER_WALL_MAX_LEVELS_PER_SIDE) {
      const prices = [...this.asks.keys()].sort((a, b) => a - b);
      this.applyLevels(this.asks, this.askBucketNotionals, this.askBucketCounts,
        this.askBucketPrices, prices.slice(ORDER_WALL_MAX_LEVELS_PER_SIDE).map(price => [price, 0] as const));
      this.bookScope.askComplete = false;
      this.bookScope.askCeiling = Math.min(this.bookScope.askCeiling ?? Infinity, prices[ORDER_WALL_MAX_LEVELS_PER_SIDE - 1]!);
    }
  }

  protected bucketPrice(price: number) {
    // Native exchange prices are already discrete. Flooring price/tick can
    // merge adjacent cents at BTC magnitudes because division loses an ULP.
    if(this.settings.aggregation==='native')return price;
    const width = this.priceWidth();
    return Number((Math.floor(price / width + 1e-10) * width).toPrecision(15));
  }
  private rebuildBucketNotionals() {
    this.bidRank.clear(); this.askRank.clear(); this.bidPrices.clear(); this.askPrices.clear();
    if(this.settings.mode==='top-levels'&&this.settings.aggregation!=='native'){for(const[p,q]of this.bids)this.bidPrices.set(p,p*q,q);for(const[p,q]of this.asks)this.askPrices.set(p,p*q,q);}
    this.bidBucketNotionals.clear(); this.askBucketNotionals.clear();
    this.bidBucketCounts.clear(); this.askBucketCounts.clear();
    this.bidBucketPrices.clear(); this.askBucketPrices.clear();
    this.rebuildSideBuckets(this.bids, this.bidBucketNotionals, this.bidBucketCounts, this.bidBucketPrices);
    this.rebuildSideBuckets(this.asks, this.askBucketNotionals, this.askBucketCounts, this.askBucketPrices);
  }
  private rebuildSideBuckets(levels: Map<number, number>, notionals: Map<number, number>, counts: Map<number, number>,
    bucketPrices: Map<number, Set<number>>) {
    for (const [price, quantity] of levels) {
      const bucket = this.bucketPrice(price);
      notionals.set(bucket, (notionals.get(bucket) ?? 0) + price * quantity);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      const prices = bucketPrices.get(bucket) ?? new Set<number>();
      prices.add(price); bucketPrices.set(bucket, prices);
    }
    const index = levels === this.bids ? this.bidRank : this.askRank;
    if(this.settings.mode==='top-levels')for (const [price, usd] of notionals) {const value=this.settings.aggregation==='native'?usd:(levels===this.bids?this.bidPrices:this.askPrices).sum(price,price+this.priceWidth());notionals.set(price,value);index.set(price,value,this.settings.aggregation==='native'?levels.get(price)??0:0);}
  }
  protected collectBuckets(_levels: Map<number, number>, notionals: Map<number, number>): PriceBucket[] {
    return [...notionals].map(([price, usd]) => ({ price, usd })).sort((a, b) => a.price - b.price);
  }

  private threshold(all: PriceBucket[]) {
    if (this.settings.method === 'absolute') return this.settings.thresholdUsd;
    const positive = all.map(item => item.usd).filter(value => value > 0).sort((a, b) => a - b);
    if (!positive.length) return this.settings.relativeFloorUsd;
    const index = Math.min(positive.length - 1, Math.ceil(this.settings.relativePercentile / 100 * positive.length) - 1);
    return Math.max(this.settings.relativeFloorUsd, positive[index]!);
  }

  private evaluate(at: number, startKnown: boolean, removed: ReadonlySet<string>, checkpoint: boolean): OrderWallPatch[] {
    if (this.settings.mode === 'top-levels') return this.evaluateTop(at, startKnown, removed, checkpoint);
    const bidBuckets = this.collectBuckets(this.bids, this.bidBucketNotionals);
    const askBuckets = this.collectBuckets(this.asks, this.askBucketNotionals);
    const threshold = this.threshold([...bidBuckets, ...askBuckets]);
    const byKey = new Map<string, { bucket: PriceBucket; side: 'bid' | 'ask' }>();
    for (const [side, buckets] of [['bid', bidBuckets], ['ask', askBuckets]] as const) {
      for (const bucket of buckets) byKey.set(segmentKey(side, bucket.price), { bucket, side });
    }
    const changes: OrderWallPatch[] = [];
    for (const [key, state] of [...this.active]) {
      const current = byKey.get(key)?.bucket.usd ?? 0;
      if (current < threshold * this.settings.exitRatio) {
        const coveredByCheckpoint = checkpoint && (state.side === 'bid'
          ? this.bookScope.bidComplete || (this.bookScope.bidFloor !== undefined && state.price >= this.bookScope.bidFloor)
          : this.bookScope.askComplete || (this.bookScope.askCeiling !== undefined && state.price <= this.bookScope.askCeiling));
        const endReason: OrderWallSegment['endReason'] = current === 0
          ? removed.has(key) || coveredByCheckpoint ? 'removed' : 'censored'
          : 'below-threshold';
        const end = endReason === 'censored' ? state.lastAt : at;
        this.accumulate(state, end); state.lastAt = end;
        const exitPoint = endReason === 'censored' ? undefined : this.addValueRun(state, at, current,
          this.percentileFor(current, [...bidBuckets, ...askBuckets]));
        this.active.delete(key);
        const closed = this.toSegment(state, end, end, endReason,
          endReason === 'censored' ? 'Checkpoint no longer confirms this price level.' : undefined);
        if (closed.durationMs >= this.settings.minDurationMs) {
          this.remember(closed); changes.push({ id: state.id, segment: closed, ...(exitPoint ? { valuePoints: [exitPoint] } : {}) });
        } else changes.push({ id: state.id, segment: null });
      } else {
        this.accumulate(state, at); state.lastAt = at;
        state.currentUsd = current;
        state.peakUsd = Math.max(state.peakUsd, current);
        state.percentile = this.percentileFor(current, [...bidBuckets, ...askBuckets]);
        const valuePoint = this.addValueRun(state, at, current, state.percentile);
        state.scopePartial = !this.bookScope.bidComplete || !this.bookScope.askComplete;
        changes.push({ id: state.id, segment: this.toSegment(state, null), ...(valuePoint ? { valuePoints: [valuePoint] } : {}) });
      }
      byKey.delete(key);
    }
    for (const [key, { bucket, side }] of byKey) {
      if (bucket.usd < threshold) continue;
      const state: WallState = {
        id: `${this.epoch ?? 'unknown'}:${side}:${bucket.price}:${at}:${this.lastCursor}`,
        epoch: this.epoch ?? 'unknown',
        side, price: bucket.price, start: at, lastAt: at, currentUsd: bucket.usd,
        peakUsd: bucket.usd, usdMs: 0, percentile: this.percentileFor(bucket.usd, [...bidBuckets, ...askBuckets]),
        scopePartial: !this.bookScope.bidComplete || !this.bookScope.askComplete,
        startKnown, valueHistory: { runs: [], truncated: false },
      };
      this.active.set(key, state);
      const valuePoint = this.addValueRun(state, at, bucket.usd, state.percentile);
      changes.push({ id: state.id, segment: this.toSegment(state, null), ...(valuePoint ? { valuePoints: [valuePoint] } : {}) });
    }
    return changes;
  }

  private evaluateTop(at: number, startKnown: boolean, removed: ReadonlySet<string>, checkpoint: boolean): OrderWallPatch[] {
    const nativePrices=this.settings.aggregation==='native', bids=nativePrices?this.bidRank:this.bidPrices, asks=nativePrices?this.askRank:this.askPrices;
    const bid = bids.max, ask = asks.min;
    if (bid === undefined || ask === undefined || bid >= ask) {
      this.rankingScope = undefined;
      return this.censorActive(Math.min(at,...[...this.active.values()].map(s=>s.lastAt)), 'A valid two-sided contemporaneous book is required for the ranking range.');
    }
    // Projection membership evictions outside the retained nearest book are
    // unknown removals. Tighten reported scope to the prices actually retained.
    if(!this.bookScope.bidComplete&&bids.min!==undefined)this.bookScope.bidFloor=Math.max(this.bookScope.bidFloor??-Infinity,bids.min);
    if(!this.bookScope.askComplete&&asks.max!==undefined)this.bookScope.askCeiling=Math.min(this.bookScope.askCeiling??Infinity,asks.max);
    const mid = (bid + ask) / 2, width = this.priceWidth(), native = this.settings.aggregation === 'native';
    const lower = mid * (1 - this.settings.searchRangePercent / 100), upper = mid * (1 + this.settings.searchRangePercent / 100);
    const partial = (this.bookScope.bidFloor !== undefined ? lower < this.bookScope.bidFloor : !this.bookScope.bidComplete)
      || (this.bookScope.askCeiling !== undefined ? upper > this.bookScope.askCeiling : !this.bookScope.askComplete);
    const bidLow = lower;
    const askHigh = upper;
    const minimum = this.settings.minimumNotionalEnabled ? this.settings.minimumNotionalUsd : 0;
    const bidLevels = this.bidRank.top(this.settings.topLevels, native ? bidLow : Math.ceil(bidLow / width - 1e-10) * width, mid, minimum);
    const askLevels = this.askRank.top(this.settings.topLevels, native ? mid : Math.floor(mid / width) * width,
      native ? askHigh : Math.floor(askHigh / width + 1e-10) * width - width, minimum);
    this.rankingScope = { mid, lower, upper, partial, bidCount: bidLevels.length, askCount: askLevels.length };
    const selected = new Map<string, { side: 'bid' | 'ask'; price: number; usd: number; rank: number; quantity: number }>();
    for (const [side, levels, prices, book] of [['bid', bidLevels, this.bidBucketPrices, this.bids], ['ask', askLevels, this.askBucketPrices, this.asks]] as const) {
      levels.forEach((level, i) => {
        const quantity = native ? book.get(level.price)??0 : (side==='bid'?this.bidPrices:this.askPrices).sum(level.price,level.price+width,true);
        selected.set(segmentKey(side, level.price), { ...level, side, rank: i + 1, quantity });
      });
    }
    const changes: OrderWallPatch[] = [];
    for (const [key, state] of this.active) {
      const next = selected.get(key);
      const scopeKnown = state.side === 'bid'
        ? this.bookScope.bidComplete || this.bookScope.bidFloor !== undefined && state.price >= this.bookScope.bidFloor
        : this.bookScope.askComplete || this.bookScope.askCeiling !== undefined && state.price + (native ? 0 : width) <= this.bookScope.askCeiling;
      if (!next) {
        const usd = (state.side === 'bid' ? this.bidBucketNotionals : this.askBucketNotionals).get(state.price) ?? 0;
        const outside = state.side === 'bid' ? state.price < lower || state.price > mid : state.price > upper || state.price + width < mid;
        const reason: OrderWallSegment['endReason'] = usd > 0
          ? outside ? 'out-of-range' : usd < minimum ? 'below-minimum' : 'rank-exit'
          : !scopeKnown ? 'censored' : removed.has(key) || checkpoint ? 'removed' : 'censored';
        const end = reason === 'censored' ? state.lastAt : at;
        this.accumulate(state, end); state.lastAt = end;
        let point: OrderWallValuePoint | undefined;
        if (reason !== 'censored') {
          state.rank = undefined;
          let quantity = 0;
          const prices = state.side === 'bid' ? this.bidBucketPrices : this.askBucketPrices, book = state.side === 'bid' ? this.bids : this.asks;
          quantity = native ? book.get(state.price)??0 : (state.side==='bid'?this.bidPrices:this.askPrices).sum(state.price,state.price+width,true);
          state.quantity = quantity; point = this.addValueRun(state, at, usd, null);
        }
        this.active.delete(key);
        const closed = this.toSegment(state, end, end, reason, reason === 'censored' ? 'Price level is no longer confirmed within observed book coverage.' : undefined);
        if (closed.durationMs >= this.settings.minDurationMs) { this.remember(closed); changes.push({ id: state.id, segment: closed, ...(point ? { valuePoints: [point] } : {}) }); }
        else changes.push({ id: state.id, segment: null });
      } else {
        this.accumulate(state, at); state.lastAt = at; state.currentUsd = next.usd; state.quantity = next.quantity; state.rank = next.rank;
        state.peakUsd = Math.max(state.peakUsd, next.usd); state.scopePartial ||= partial;
        const point = this.addValueRun(state, at, next.usd, null);
        changes.push({ id: state.id, segment: this.toSegment(state, null), ...(point ? { valuePoints: [point] } : {}) });
      }
      selected.delete(key);
    }
    for (const [key, level] of selected) {
      const state: WallState = { ...level, id: `${this.epoch ?? 'unknown'}:${level.side}:${level.price}:${at}:${this.lastCursor}`,
        epoch: this.epoch ?? 'unknown', start: at, lastAt: at, currentUsd: level.usd, peakUsd: level.usd, usdMs: 0,
        percentile: null, scopePartial: partial, startKnown, valueHistory: { runs: [], truncated: false } };
      this.active.set(key, state); const point = this.addValueRun(state, at, level.usd, null);
      changes.push({ id: state.id, segment: this.toSegment(state, null), ...(point ? { valuePoints: [point] } : {}) });
    }
    return changes;
  }

  private percentileFor(value: number, all: PriceBucket[]) {
    const positives = all.map(item => item.usd).filter(item => item > 0);
    if (!positives.length) return null;
    return positives.filter(item => item <= value).length / positives.length * 100;
  }

  private accumulate(state: WallState, at: number) {
    if (at > state.lastAt) state.usdMs += state.currentUsd * (at - state.lastAt);
  }

  private addValueRun(state: WallState, at: number, usd: number, percentile: number | null): OrderWallValuePoint | undefined {
    const history = state.valueHistory, last = history.runs.at(-1);
    if (last && last.usd === usd && last.percentile === percentile && last.rank === state.rank && last.quantity === state.quantity) return undefined;
    const point: OrderWallValuePoint = { at, usd, percentile, ...(this.settings.mode === 'top-levels' ? { rank: state.rank ?? null, quantity: state.quantity } : {}) }; history.runs.push(point); this.valueRunQueue.push({ history, point }); this.valueRunCount++;
    while (history.runs.length > ORDER_WALL_MAX_VALUE_RUNS_PER_SEGMENT) this.trimOldestValueRun({ history, point: history.runs[0]! });
    while (this.valueRunCount > ORDER_WALL_MAX_VALUE_RUNS) {
      const oldest = this.valueRunQueue[this.valueRunQueueStart++];
      if (oldest) this.trimOldestValueRun(oldest);
    }
    if (this.valueRunQueueStart > 4_096 && this.valueRunQueueStart * 2 > this.valueRunQueue.length) {
      this.valueRunQueue = this.valueRunQueue.slice(this.valueRunQueueStart); this.valueRunQueueStart = 0;
    }
    return point;
  }

  private trimOldestValueRun(entry: { history: WallState['valueHistory']; point: OrderWallValuePoint }) {
    if (entry.history.runs[0] !== entry.point) return;
    entry.history.runs.shift(); entry.history.truncated = true; this.valueHistoryLimited = true; entry.history.segment && (entry.history.segment.valueRunsTruncated = true);
    this.valueRunCount = Math.max(0, this.valueRunCount - 1);
  }

  private toSegment(state: WallState, end: number | null, observedThrough = end ?? state.lastAt,
    endReason: OrderWallSegment['endReason'] = end === null ? null : 'censored', censoredReason?: string): OrderWallSegment {
    const durationMs = Math.max(0, observedThrough - state.start);
    const totalUsdMs = state.usdMs + state.currentUsd * Math.max(0, observedThrough - state.lastAt);
    const segment: OrderWallSegment = { id: state.id, epoch: state.epoch, side: state.side, price: state.price, start: state.start, end,
      peakUsd: state.peakUsd, meanUsd: durationMs ? totalUsdMs / durationMs : state.currentUsd,
      durationMs, percentile: state.percentile, scopePartial: state.scopePartial, startKnown: state.startKnown,
      valueRuns: state.valueHistory.runs, valueRunsTruncated: state.valueHistory.truncated,
      ...(this.settings.mode === 'top-levels' ? { detectionMode: 'top-levels', rank: state.rank } : {}),
      endReason, endKnown: endReason === 'removed' || endReason === 'below-threshold' || endReason === 'rank-exit' || endReason === 'out-of-range' || endReason === 'below-minimum',
      ...(endReason === 'censored' && censoredReason ? { censoredReason } : {}) };
    state.valueHistory.segment = segment;
    return segment;
  }

  private censorActive(end: number, reason: string): OrderWallPatch[] {
    const patches: OrderWallPatch[] = [];
    for (const [key, state] of this.active) {
      const closed = this.toSegment(state, end, end, 'censored', reason);
      this.active.delete(key);
      if (closed.durationMs >= this.settings.minDurationMs) { this.remember(closed); patches.push({ id: state.id, segment: closed }); }
      else patches.push({ id: state.id, segment: null });
    }
    return patches;
  }

  private remember(segment: OrderWallSegment) {
    this.segments.set(segment.id, segment);
    while (this.segments.size > ORDER_WALL_MAX_SEGMENTS) { this.segments.delete(this.segments.keys().next().value!); this.episodeHistoryLimited = true; }
  }

  diagnostics() { return { rank: { bid: { ...this.bidRank.metrics }, ask: { ...this.askRank.metrics } }, bookLevels: this.bids.size + this.asks.size, active: this.active.size, historical: this.segments.size, valueRuns: this.valueRunCount }; }

  snapshot(now = this.lastAt ?? 0): OrderWallSegment[] {
    const result = [...this.segments.values()];
    for (const state of this.active.values()) result.push(this.toSegment(state, null, Math.max(state.lastAt, now)));
    return result;
  }

  status(from: number, to: number): OrderWallStatus {
    const rankingUnavailable=this.settings.mode==='top-levels'&&!this.awaitingSnapshot&&!this.rankingScope;
    return { state: this.awaitingSnapshot ? this.sawGap ? 'gap' : 'loading' : this.lastAt === null ? 'loading' : rankingUnavailable ? 'stale' : 'live',
      tickSize: this.tickSize, resolvedPriceWidth: this.priceWidth(),
      ...(this.lastAt !== null ? { lastConfirmedAt: this.lastAt } : {}),
      ...(this.clockRegressed ? { clockRegressed: true } : {}),
      ...(this.awaitingSnapshot ? { message: 'Waiting for a confirmed depth snapshot after a gap' } : {}),
      ...(this.episodeHistoryLimited ? {episodeHistoryLimited:true} : {}),
      ...(this.valueHistoryLimited ? {valueHistoryLimited:true} : {}),
      ...(rankingUnavailable ? {message:'A valid two-sided observed book is required; Top Levels ranking is unknown.'} : {}),
      coverage: { from, to, complete: !this.awaitingSnapshot && !this.clockRegressed && !rankingUnavailable && !this.valueHistoryLimited && !this.episodeHistoryLimited,
        partial: !this.bookScope.bidComplete || !this.bookScope.askComplete || this.clockRegressed || rankingUnavailable || this.valueHistoryLimited || this.episodeHistoryLimited,
        ...(this.clockRegressed ? { reason: 'Host receive-time regression was clamped in cursor order; event duration may be understated.' } : {}) },
      ...(this.rankingScope ? { rankingScope: { ...this.rankingScope } } : {}),
      bookScope: { ...this.bookScope } };
  }
}

/** Select a stable 1/2/5 quote-price increment that occupies about 12 CSS pixels. */
export function resolveAutoOrderWallPriceWidth(low: number, high: number, height: number, tickSize: number): number {
  if (![low, high, height, tickSize].every(Number.isFinite) || high <= low || height <= 0 || tickSize <= 0) return tickSize;
  const ideal = Math.max(tickSize, (high - low) * 12 / height);
  const magnitude = 10 ** Math.floor(Math.log10(ideal));
  const normalized = ideal / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(tickSize, Number((nice * magnitude).toPrecision(12)));
}

function segmentKey(side: 'bid' | 'ask', price: number) { return `${side}:${price}`; }
/** Return the observed piecewise-constant notional at a historical cursor time. */
export function orderWallValueAt(segment: OrderWallSegment, at: number): number | null {
  return orderWallValuePointAt(segment, at)?.usd ?? null;
}
export function orderWallValuePointAt(segment: OrderWallSegment, at: number): OrderWallValuePoint | null {
  if (!Number.isFinite(at) || at < segment.start || (segment.end !== null && at > segment.end)) return null;
  const runs = segment.valueRuns;
  if (!runs?.length || (segment.valueRunsTruncated && at < runs[0]!.at)) return null;
  let low = 0, high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (runs[mid]!.at <= at) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? null : runs[low - 1]!;
}

function mergePatch(changes: Map<string, OrderWallPatch>, patch: OrderWallPatch) {
  const prior = changes.get(patch.id);
  const valuePoints = prior?.valuePoints || patch.valuePoints
    ? [...(prior?.valuePoints ?? []), ...(patch.valuePoints ?? [])]
    : undefined;
  changes.set(patch.id, { ...patch, ...(valuePoints?.length ? { valuePoints } : {}) });
}

function validRecord(record: OrderWallDepthRecord) {
  return !!record && Number.isFinite(record.at) && Number.isFinite(record.cursor) && record.cursor >= 0 &&
    (record.kind === 'delta' || record.kind === 'checkpoint' || record.kind === 'gap' || record.kind === 'snapshot') &&
    (typeof record.epoch === 'string' || typeof record.epoch === 'number');
}

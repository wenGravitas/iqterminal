export type MatrixCoverage = 'observed' | 'known-empty' | 'partial' | 'unknown' | 'stale' | 'disconnected' | 'syncing';
export type MatrixState = 'syncing' | 'live' | 'gap' | 'stale' | 'disconnected';
/** Opaque registry key: a rendered column can represent one instrument or a future aggregate. */
export type DepthMatrixSource = string;
export type DepthMatrixUnit = 'btc' | 'usdt';
export type DepthMatrixScale = 'per-source' | 'shared';
export interface DepthMatrixSettings {
  sources: DepthMatrixSource[]; bucketWidth: string;
  columnWidth: number; unit: DepthMatrixUnit; scale: DepthMatrixScale;
  wallMode: 'off' | 'absolute' | 'relative'; wallThreshold: number;
}
export interface DepthMatrixViewport { low: string; high: string }
export type MatrixLevel = readonly [price: string | number, quantity: string | number] | { price: string | number; quantity: string | number };
export interface MatrixRecord {
  kind: 'snapshot' | 'checkpoint' | 'delta' | 'gap';
  at: number; cursor: number; epoch: number | string;
  bids?: readonly MatrixLevel[]; asks?: readonly MatrixLevel[];
  bookScope?: { bidComplete?: boolean; askComplete?: boolean; bidFloor?: string | number; askCeiling?: string | number;
    bidTruncated?: boolean; askTruncated?: boolean };
}
export interface MatrixRow {
  index: string; low: string; high: string;
  bidQuantity: number; askQuantity: number; bidNotional: number; askNotional: number;
  bidCoverage: MatrixCoverage; askCoverage: MatrixCoverage;
}
export interface DepthMatrixColumn {
  source: DepthMatrixSource; label: string; state: MatrixState | 'unavailable'; message: string;
  rows: MatrixRow[]; bestBid: string | null; bestAsk: string | null; mid: string | null;
  quantityUnit: 'BTC'; notionalUnit: 'USDT'; lastAt: number; ageMs: number | null; cursor: number; epoch: number | string | null;
}
export interface DepthMatrixSourceDefinition {
  label: string; venue: string; instrument: string; market?: 'spot' | 'perpetual';
  /** Raw resting quantity multiplied by this factor is the common BTC quantity. */
  quantityToBtc: number; supported: boolean;
}
export const DEPTH_MATRIX_SOURCE_REGISTRY: Readonly<Record<string, DepthMatrixSourceDefinition>> = Object.freeze({
  'binance-spot': { label: 'Binance · BTCUSDT Spot', venue: 'Binance', instrument: 'BTCUSDT Spot', market: 'spot', quantityToBtc: 1, supported: true },
  'binance-perpetual': { label: 'Binance · BTCUSDT USD-M Perp', venue: 'Binance', instrument: 'BTCUSDT USD-M Perp', market: 'perpetual', quantityToBtc: 1, supported: true },
  'bybit-spot': { label: 'Bybit · BTCUSDT Spot', venue: 'Bybit', instrument: 'BTCUSDT Spot', quantityToBtc: 1, supported: false },
  'bybit-perpetual': { label: 'Bybit · BTCUSDT Perp', venue: 'Bybit', instrument: 'BTCUSDT Perp', quantityToBtc: 1, supported: false },
  'hyperliquid-perpetual': { label: 'Hyperliquid · BTC Perp', venue: 'Hyperliquid', instrument: 'BTC Perp', quantityToBtc: 1, supported: false },
});
export const DEPTH_MATRIX_SOURCES: readonly DepthMatrixSource[] = Object.freeze(Object.keys(DEPTH_MATRIX_SOURCE_REGISTRY));
export const DEPTH_MATRIX_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  Object.entries(DEPTH_MATRIX_SOURCE_REGISTRY).map(([id, value]) => [id, value.label])));
export const DEPTH_MATRIX_MAX_SOURCES = 8;
export function depthMatrixSourceDefinition(source: DepthMatrixSource): DepthMatrixSourceDefinition | undefined {
  return DEPTH_MATRIX_SOURCE_REGISTRY[source];
}
export function depthMatrixSourceLabel(source: DepthMatrixSource) {
  return depthMatrixSourceDefinition(source)?.label ?? `Unconfigured · ${source}`;
}
export const DEFAULT_DEPTH_MATRIX_SETTINGS: Readonly<DepthMatrixSettings> = Object.freeze({
  sources: ['binance-spot', 'binance-perpetual'] as DepthMatrixSource[], bucketWidth: '100', columnWidth: 95, unit: 'btc', scale: 'per-source', wallMode: 'relative', wallThreshold: 2.5,
});

export function depthMatrixSettings(value: unknown): DepthMatrixSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const available = Array.isArray(raw.sources) ? raw.sources.filter((x): x is DepthMatrixSource => typeof x === 'string' && /^[a-z0-9][a-z0-9:-]{0,63}$/i.test(x)) : [...DEFAULT_DEPTH_MATRIX_SETTINGS.sources];
  const sources = [...new Set(available)].slice(0, DEPTH_MATRIX_MAX_SOURCES);
  const parsedWidth = typeof raw.bucketWidth === 'string' || typeof raw.bucketWidth === 'number' ? normalizedPrice(raw.bucketWidth) : null;
  const validWidth = parsedWidth !== null && decimal(parsedWidth)!.coefficient > 0n;
  const columnWidth = typeof raw.columnWidth === 'number' && Number.isFinite(raw.columnWidth) ? Math.max(65, Math.min(150, Math.round(raw.columnWidth))) : 95;
  return { sources, bucketWidth: validWidth ? parsedWidth! : DEFAULT_DEPTH_MATRIX_SETTINGS.bucketWidth,
    columnWidth, unit: raw.unit === 'usdt' ? 'usdt' : 'btc', scale: raw.scale === 'shared' ? 'shared' : 'per-source',
    wallMode: raw.wallMode === 'off' ? 'off' : raw.wallMode === 'absolute' ? 'absolute' : 'relative',
    wallThreshold: typeof raw.wallThreshold === 'number' && Number.isFinite(raw.wallThreshold) ? Math.max(.1, Math.min(1000, raw.wallThreshold)) : 2.5 };
}

const MAX_LEVELS_PER_SIDE = 5_000;
const MAX_VISIBLE_ROWS = 2_000;
const MAX_SAFE_DECIMALS = 18;
type Decimal = { coefficient: bigint; scale: number };

function decimal(value: string | number | bigint): Decimal | null {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || raw.length > 64) return null;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_SAFE_DECIMALS * 2) return null;
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) { coefficient *= pow10(-scale); scale = 0; }
  if (scale > MAX_SAFE_DECIMALS) return null;
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}

function pow10(scale: number) { return 10n ** BigInt(scale); }
function scaled(value: Decimal, scale: number) { return value.coefficient * pow10(scale - value.scale); }
function floorDiv(n: bigint, d: bigint) { const q = n / d, r = n % d; return r < 0n ? q - 1n : q; }
function compareDecimal(a: string | number, b: string | number) {
  const x = decimal(a), y = decimal(b);
  if (!x || !y) return NaN;
  const scale = Math.max(x.scale, y.scale);
  const left = scaled(x, scale), right = scaled(y, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
function formatDecimal(coefficient: bigint, scale: number) {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0) digits = digits.padStart(scale + 1, '0').slice(0, -scale) + '.' + digits.padStart(scale + 1, '0').slice(-scale);
  if (digits.includes('.')) digits = digits.replace(/0+$/, '').replace(/\.$/, '');
  return `${negative ? '-' : ''}${digits}`;
}

/** Stable absolute buckets use exact decimal arithmetic: [low, high). */
export function matrixBucketIndex(price: string | number, width: string | number): string | null {
  const p = decimal(price), w = decimal(width);
  if (!p || !w || p.coefficient < 0n || w.coefficient <= 0n) return null;
  const scale = Math.max(p.scale, w.scale);
  return floorDiv(scaled(p, scale), scaled(w, scale)).toString();
}

export function matrixBucketBounds(index: string | bigint, width: string | number): { low: string; high: string } | null {
  const w = decimal(width);
  if (!w || w.coefficient <= 0n) return null;
  let i: bigint;
  try { i = BigInt(index); } catch { return null; }
  return { low: formatDecimal(i * w.coefficient, w.scale), high: formatDecimal((i + 1n) * w.coefficient, w.scale) };
}
export function matrixDefaultViewport(mid: number | null, width: string) {
  if (mid === null) return { low: '0', high: matrixBucketBounds('160', width)!.low };
  const center = matrixBucketIndex(mid, width);
  const centerIndex = BigInt(center ?? '0');
  const first = centerIndex > 80n ? centerIndex - 80n : 0n;
  const last = first + 160n;
  return { low: matrixBucketBounds(first, width)!.low, high: matrixBucketBounds(last, width)!.low };
}

function normalizedPrice(value: string | number) {
  const parsed = decimal(value);
  return parsed ? formatDecimal(parsed.coefficient, parsed.scale) : null;
}
function levelPair(level: MatrixLevel): readonly [string | number, string | number] {
  if (Array.isArray(level)) return level as readonly [string | number, string | number];
  const object = level as { price: string | number; quantity: string | number };
  return [object.price, object.quantity];
}
export function normalizedBtcQuantity(value: number | string, quantityToBtc = 1) {
  const quantity = Number(value) * quantityToBtc;
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}
export function formatDepthMatrixCellValue(value: number, unit: DepthMatrixUnit) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (unit === 'btc') {
    if (value < .001) return '<0.001';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    const decimals = value >= 100_000 ? 0 : value >= 10_000 ? 1 : value >= 1_000 ? 2 : 3;
    return trimNumberZeros(value.toFixed(decimals));
  }
  if (value < 1) return '<1';
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m`
    : value >= 10_000 ? `${(value / 1_000).toFixed(0)}k`
      : value < 100 ? trimNumberZeros(value.toFixed(2)) : value.toFixed(0);
}
export function formatDepthMatrixTooltipValue(quantityBtc: number, notionalUsdt: number) {
  const quantity = quantityBtc > 0 && quantityBtc < .000000005 ? '<0.00000001' : quantityBtc.toFixed(8);
  const notional = notionalUsdt > 0 && notionalUsdt < .005 ? '<0.01' : notionalUsdt.toFixed(2);
  return `${quantity} BTC / ${notional} USDT`;
}
function trimNumberZeros(value: string) { return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'); }
/** Shared histogram scales use one full cell-width denominator for each side. */
export function depthMatrixScaleTarget(values: Iterable<number>) {
  let target = 0;
  for (const value of values) if (Number.isFinite(value) && value > target) target = value;
  return target;
}
export function smoothDepthMatrixScale(target: number, previous?: number, elapsedMs = 1000, timeConstantMs = 5000) {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 0;
  const safePrevious = previous !== undefined && Number.isFinite(previous) && previous > 0 ? previous : safeTarget;
  if (safeTarget >= safePrevious) return safeTarget;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(60_000, elapsedMs)) : 0;
  const timeConstant = Number.isFinite(timeConstantMs) && timeConstantMs > 0 ? timeConstantMs : 5000;
  const progress = 1 - Math.exp(-elapsed / timeConstant);
  return Math.max(safeTarget, safePrevious + (safeTarget - safePrevious) * progress);
}
export function depthMatrixBarWidth(value: number, scale: number, availableWidth: number) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(availableWidth) || availableWidth <= 0) return 0;
  return Math.max(1, Math.min(availableWidth, value / scale * availableWidth));
}
function parseLevels(values: readonly MatrixLevel[] | undefined, quantityToBtc: number) {
  const levels = new Map<string, number>();
  for (const level of (values ?? []).slice(0, MAX_LEVELS_PER_SIDE * 2)) {
    const [priceValue, rawQuantity] = levelPair(level);
    const price = normalizedPrice(priceValue), quantity = normalizedBtcQuantity(rawQuantity, quantityToBtc);
    if (price !== null && quantity !== null) {
      if (quantity === 0) levels.delete(price); else levels.set(price, quantity);
    }
  }
  return levels;
}
function trimLevels(levels: Map<string, number>, side: 'bid' | 'ask') {
  if (levels.size <= MAX_LEVELS_PER_SIDE) return undefined;
  const prices = [...levels.keys()].sort(compareDecimal);
  const removedCount = prices.length - MAX_LEVELS_PER_SIDE;
  const removed = side === 'bid' ? prices.slice(0, removedCount) : prices.slice(MAX_LEVELS_PER_SIDE);
  for (const price of removed) levels.delete(price);
  return side === 'bid' ? prices[removedCount] : prices[MAX_LEVELS_PER_SIDE - 1];
}
function validScope(value: string | number | undefined) {
  if (value === undefined || decimal(value) === null) return undefined;
  return normalizedPrice(value) ?? undefined;
}
function maxBound(a: string | undefined, b: string | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return compareDecimal(a, b) >= 0 ? a : b;
}
function minBound(a: string | undefined, b: string | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return compareDecimal(a, b) <= 0 ? a : b;
}
function effectiveCoverageBound(side: 'bid' | 'ask', advertised: string | undefined, deepestReturned: string | null, complete: boolean | undefined, truncated: boolean | undefined) {
  if (complete !== false && truncated !== true) return advertised;
  const deepest = deepestReturned ?? undefined;
  return side === 'bid' ? maxBound(advertised, deepest) : minBound(advertised, deepest);
}

export class DepthMatrixBook {
  private bids = new Map<string, number>();
  private asks = new Map<string, number>();
  private epoch: number | string | null = null;
  private cursor = 0;
  private at = 0;
  private bidFloor?: string;
  private askCeiling?: string;
  private bidComplete = false;
  private askComplete = false;
  private bestBid: string | null = null;
  private bestAsk: string | null = null;
  private deepestBid: string | null = null;
  private deepestAsk: string | null = null;
  private _state: MatrixState = 'syncing';
  private _message = 'Waiting for a synchronized depth snapshot.';

  constructor(private readonly quantityToBtc = 1) {}

  get state() { return this._state; }
  get message() { return this._message; }
  get lastAt() { return this.at; }
  get lastCursor() { return this.cursor; }
  get lastEpoch() { return this.epoch; }
  get quote() {
    return { bestBid: this.bestBid, bestAsk: this.bestAsk,
      mid: this.bestBid !== null && this.bestAsk !== null ? (Number(this.bestBid) + Number(this.bestAsk)) / 2 : null };
  }

  apply(record: MatrixRecord): boolean {
    if (!Number.isSafeInteger(record.cursor) || record.cursor < 0 || !Number.isFinite(record.at) || record.at <= 0) return false;
    if (record.kind === 'gap') {
      if (this.epoch === record.epoch && record.cursor <= this.cursor) return true;
      this.invalidate('Depth history contains a sequence gap; waiting for a new snapshot.'); return true;
    }
    if (record.kind === 'snapshot' || record.kind === 'checkpoint') {
      if (this._state === 'live' && this.epoch === record.epoch && record.cursor <= this.cursor) return true;
      const bids = parseLevels(record.bids, this.quantityToBtc), asks = parseLevels(record.asks, this.quantityToBtc);
      if (!bids.size || !asks.size) { this.invalidate('Depth snapshot is empty or malformed.'); return false; }
      this.bids = bids; this.asks = asks;
      const bidTrimmed = trimLevels(this.bids, 'bid'), askTrimmed = trimLevels(this.asks, 'ask');
      this.epoch = record.epoch; this.cursor = record.cursor; this.at = record.at;
      this.refreshQuote();
      this.bidFloor = effectiveCoverageBound('bid', validScope(record.bookScope?.bidFloor), this.deepestBid, record.bookScope?.bidComplete, record.bookScope?.bidTruncated);
      this.askCeiling = effectiveCoverageBound('ask', validScope(record.bookScope?.askCeiling), this.deepestAsk, record.bookScope?.askComplete, record.bookScope?.askTruncated);
      this.bidComplete = record.bookScope?.bidComplete === true && !bidTrimmed; this.askComplete = record.bookScope?.askComplete === true && !askTrimmed;
      if (this.bestBid === null || this.bestAsk === null || compareDecimal(this.bestBid, this.bestAsk) >= 0) {
        this.invalidate('Depth book is empty or crossed; waiting for a new snapshot.'); return false;
      }
      this._state = 'live'; this._message = 'Synchronized depth';
      return true;
    }
    if ((this._state === 'gap' || this._state === 'syncing') || this.epoch === null) return false;
    if (record.epoch === this.epoch && record.cursor <= this.cursor) return true;
    if (record.epoch !== this.epoch || record.cursor !== this.cursor + 1) {
      this.invalidate(record.epoch !== this.epoch ? 'Depth epoch changed; waiting for a new snapshot.' : 'Depth cursor skipped; waiting for a new snapshot.');
      return false;
    }
    this.applyPatches(this.bids, record.bids, 'bid');
    this.applyPatches(this.asks, record.asks, 'ask');
    const bidTrimmed = trimLevels(this.bids, 'bid'), askTrimmed = trimLevels(this.asks, 'ask');
    if (bidTrimmed) { this.deepestBid = bidTrimmed; this.bidFloor = maxBound(this.bidFloor, bidTrimmed); }
    if (askTrimmed) { this.deepestAsk = askTrimmed; this.askCeiling = minBound(this.askCeiling, askTrimmed); }
    if (this.bestBid !== null && !this.bids.has(this.bestBid)) this.bestBid = maxDecimal([...this.bids.keys()]);
    if (this.bestAsk !== null && !this.asks.has(this.bestAsk)) this.bestAsk = minDecimal([...this.asks.keys()]);
    if (record.bookScope) {
      const bidFloor = validScope(record.bookScope.bidFloor), askCeiling = validScope(record.bookScope.askCeiling);
      if (record.bookScope.bidComplete !== undefined) this.bidComplete = record.bookScope.bidComplete;
      if (record.bookScope.askComplete !== undefined) this.askComplete = record.bookScope.askComplete;
      if (bidFloor !== undefined || record.bookScope.bidComplete !== undefined || record.bookScope.bidTruncated !== undefined)
        this.bidFloor = effectiveCoverageBound('bid', bidFloor ?? this.bidFloor, this.deepestBid, record.bookScope.bidComplete, record.bookScope.bidTruncated);
      if (askCeiling !== undefined || record.bookScope.askComplete !== undefined || record.bookScope.askTruncated !== undefined)
        this.askCeiling = effectiveCoverageBound('ask', askCeiling ?? this.askCeiling, this.deepestAsk, record.bookScope.askComplete, record.bookScope.askTruncated);
    }
    this.cursor = record.cursor; this.at = record.at;
    if (this.bestBid === null || this.bestAsk === null || compareDecimal(this.bestBid, this.bestAsk) >= 0) {
      this.invalidate('Depth book is empty or crossed; waiting for a new snapshot.'); return false;
    }
    this._state = 'live'; this._message = 'Synchronized depth';
    return true;
  }

  setTransport(state: 'live' | 'stale' | 'disconnected' | 'syncing', message: string) {
    if (state === 'syncing') this.clear(state, message);
    else { this._state = state; this._message = message; }
  }

  project(low: string | number, high: string | number, width: string | number): MatrixRow[] {
    const lo = matrixBucketIndex(low, width), hi = matrixBucketIndex(high, width);
    if (lo === null || hi === null || compareDecimal(low, high) >= 0) return [];
    const first = BigInt(lo);
    let last = BigInt(hi);
    const nextBounds = matrixBucketBounds(hi, width);
    if (nextBounds && compareDecimal(nextBounds.low, high) === 0) last--;
    const count = last - first + 1n;
    if (count <= 0n || count > BigInt(MAX_VISIBLE_ROWS)) return [];
    const rows = new Map<string, MatrixRow>();
    for (let i = first; i <= last; i++) {
      const index = i.toString(), bounds = matrixBucketBounds(index, width)!;
      rows.set(index, { index, ...bounds, bidQuantity: 0, askQuantity: 0, bidNotional: 0, askNotional: 0,
        bidCoverage: 'unknown', askCoverage: 'unknown' });
    }
    if (this._state === 'gap' || this._state === 'syncing') {
      const coverage: MatrixCoverage = 'syncing';
      for (const row of rows.values()) {
        row.bidCoverage = coverage; row.askCoverage = coverage;
        if (this._state === 'gap') { row.bidCoverage = 'syncing'; row.askCoverage = 'syncing'; }
      }
      return [...rows.values()];
    }
    const bestBid = this.bestBid, bestAsk = this.bestAsk;
    for (const [price, quantity] of this.bids) {
      const index = matrixBucketIndex(price, width), row = index === null ? undefined : rows.get(index);
      if (row) { row.bidQuantity += quantity; row.bidNotional += Number(price) * quantity; }
    }
    for (const [price, quantity] of this.asks) {
      const index = matrixBucketIndex(price, width), row = index === null ? undefined : rows.get(index);
      if (row) { row.askQuantity += quantity; row.askNotional += Number(price) * quantity; }
    }
    for (const row of rows.values()) {
      row.bidCoverage = this.coverage('bid', row.low, row.high, row.bidQuantity > 0, bestBid, bestAsk);
      row.askCoverage = this.coverage('ask', row.low, row.high, row.askQuantity > 0, bestBid, bestAsk);
      if (this._state === 'stale' || this._state === 'disconnected') {
        row.bidCoverage = this._state; row.askCoverage = this._state;
      }
    }
    return [...rows.values()];
  }

  private applyPatches(target: Map<string, number>, values: readonly MatrixLevel[] | undefined, side: 'bid' | 'ask') {
    const oldBest = side === 'bid' ? this.bestBid : this.bestAsk;
    const oldDeepest = side === 'bid' ? this.deepestBid : this.deepestAsk;
    const changed: string[] = [];
    for (const level of (values ?? [])) {
      const [rawPrice, rawQuantity] = levelPair(level);
      const price = normalizedPrice(rawPrice), quantity = normalizedBtcQuantity(rawQuantity, this.quantityToBtc);
      if (price === null || quantity === null) continue;
      if (quantity === 0) target.delete(price); else { target.set(price, quantity); changed.push(price); }
    }
    let best = oldBest !== null && target.has(oldBest) ? oldBest : (side === 'bid' ? maxDecimal([...target.keys()]) : minDecimal([...target.keys()]));
    let deepest = oldDeepest !== null && target.has(oldDeepest) ? oldDeepest : (side === 'bid' ? minDecimal([...target.keys()]) : maxDecimal([...target.keys()]));
    for (const price of changed) {
      if (!target.has(price)) continue;
      if (best === null || (side === 'bid' ? compareDecimal(price, best) > 0 : compareDecimal(price, best) < 0)) best = price;
      if (deepest === null || (side === 'bid' ? compareDecimal(price, deepest) < 0 : compareDecimal(price, deepest) > 0)) deepest = price;
    }
    if (side === 'bid') { this.bestBid = best; this.deepestBid = deepest; }
    else { this.bestAsk = best; this.deepestAsk = deepest; }
  }
  private coverage(side: 'bid' | 'ask', low: string, high: string, observed: boolean, bestBid: string | null, bestAsk: string | null): MatrixCoverage {
    if (this._state !== 'live') return this._state === 'stale' ? 'stale' : this._state === 'disconnected' ? 'disconnected' : 'syncing';
    if (bestBid === null || bestAsk === null || compareDecimal(bestBid, bestAsk) >= 0) return 'unknown';
    const boundary = side === 'bid' ? this.bidFloor : this.askCeiling;
    if (boundary === undefined) return observed ? 'partial' : 'unknown';
    // An uncrossed synchronized book also proves bids above best bid and asks below best ask empty.
    const overlapsKnown = side === 'bid' ? compareDecimal(high, boundary) > 0 : compareDecimal(low, boundary) < 0;
    const fullyCovered = side === 'bid'
      ? compareDecimal(low, boundary) >= 0
      : compareDecimal(high, boundary) <= 0;
    if (fullyCovered) return observed ? 'observed' : 'known-empty';
    if (observed || overlapsKnown) return 'partial';
    return 'unknown';
  }
  private invalidate(message: string) {
    this.clear('gap', message);
  }
  private clear(state: MatrixState, message: string) {
    this.bids.clear(); this.asks.clear(); this.epoch = null; this.cursor = 0; this.at = 0;
    this.bidFloor = undefined; this.askCeiling = undefined; this.bidComplete = false; this.askComplete = false; this.bestBid = null; this.bestAsk = null; this.deepestBid = null; this.deepestAsk = null;
    this._state = state; this._message = message;
  }
  private refreshQuote() {
    this.bestBid = maxDecimal([...this.bids.keys()]); this.bestAsk = minDecimal([...this.asks.keys()]);
    this.deepestBid = minDecimal([...this.bids.keys()]); this.deepestAsk = maxDecimal([...this.asks.keys()]);
  }
}

function maxDecimal(values: string[]) {
  return values.reduce<string | null>((best, value) => best === null || compareDecimal(value, best) > 0 ? value : best, null);
}
function minDecimal(values: string[]) {
  return values.reduce<string | null>((best, value) => best === null || compareDecimal(value, best) < 0 ? value : best, null);
}


import { duration, type FootprintBar, type FootprintCell, type FootprintRowTicks, type Interval } from './protocol';
import type { Market, Venue } from './protocol';

export const FOOTPRINT_MAX_BARS = 300;
export const FOOTPRINT_MAX_CELLS = 18_000;
export const FOOTPRINT_MAX_CELLS_PER_BAR = 512;
export const FOOTPRINT_MAX_PENDING = 2_048;
export const FOOTPRINT_MAX_RECENT_IDS = 8_192;
export const FOOTPRINT_FLUSH_MS = 100;
const MAX_DATE_TIME_MS = 8_640_000_000_000_000;
export interface FootprintLimits { maxBars: number; maxCells: number; maxCellsPerBar: number }
export const DEFAULT_FOOTPRINT_LIMITS: Readonly<FootprintLimits> = Object.freeze({
  maxBars: FOOTPRINT_MAX_BARS, maxCells: FOOTPRINT_MAX_CELLS, maxCellsPerBar: FOOTPRINT_MAX_CELLS_PER_BAR,
});

export type AggressorSide = 'buy' | 'sell' | 'unknown';

export type ExecutionGranularity = 'individual-trade' | 'aggregate-trade';
/** Canonical observation shape reusable by venue adapters without weakening BTCUSDT parsing. */
export interface NormalizedExecution {
  venue: Venue;
  market: Market;
  nativeSymbol: string;
  granularity: ExecutionGranularity;
  /** Venue-scoped stable identity, e.g. binance:perpetual:BTCUSDT:agg:123. */
  executionId: string;
  timeMs: number;
  eventTimeMs: number;
  price: number;
  quantity: number;
  side: AggressorSide;
}

/** Binance-specific wire sequence fields retained for ordered aggTrade ingestion. */
export interface AggTradeObservation extends NormalizedExecution {
  venue: 'binance';
  market: 'perpetual';
  nativeSymbol: 'BTCUSDT';
  granularity: 'aggregate-trade';
  id: number;
  firstTradeId: number;
  lastTradeId: number;
}

export type AggTradeReject = 'market' | 'contract' | 'symbol' | 'maker-side' | 'trade-id' | 'time' | 'price' | 'quantity';
export type AggTradeParse = { trade: AggTradeObservation } | { ignored: true } | { rejected: AggTradeReject };

/**
 * Decode Binance's public USD-M aggregate-trade record. `q` is the published
 * aggregate quantity (including RPI); `nq` is intentionally never substituted.
 * Binance's strict boolean maker flag is the taker-side classifier.
 */
export function parseBinanceAggTrade(raw: unknown): AggTradeParse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ignored: true };
  const value = raw as Record<string, unknown>;
  if (value.e !== 'aggTrade') return { ignored: true };
  if (value.st !== undefined && value.st !== 1) return { rejected: 'contract' };
  if (value.s !== 'BTCUSDT') return { rejected: 'symbol' };
  if (typeof value.m !== 'boolean') return { rejected: 'maker-side' };

  const id = safeInteger(value.a);
  const firstTradeId = safeInteger(value.f);
  const lastTradeId = safeInteger(value.l);
  // `a` is the aggregate-trade sequence; `f`/`l` are the underlying trade
  // sequence. Binance does not promise these unrelated counters overlap.
  if (id === null || firstTradeId === null || lastTradeId === null || firstTradeId > lastTradeId) return { rejected: 'trade-id' };

  const timeMs = safeInteger(value.T);
  const eventTimeMs = safeInteger(value.E);
  if (timeMs === null || eventTimeMs === null || timeMs <= 0 || eventTimeMs < timeMs
    || timeMs > MAX_DATE_TIME_MS || eventTimeMs > MAX_DATE_TIME_MS) return { rejected: 'time' };
  const price = positiveNumber(value.p);
  if (price === null) return { rejected: 'price' };
  const quantity = positiveNumber(value.q);
  if (quantity === null) return { rejected: 'quantity' };

  return {
    trade: {
      venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
      executionId: `binance:perpetual:BTCUSDT:agg:${id}`,
      id, firstTradeId, lastTradeId, timeMs, eventTimeMs, price, quantity,
      side: value.m ? 'sell' : 'buy',
    },
  };
}

/** Public USD-M contract metadata: use PRICE_FILTER.tickSize, never pricePrecision. */
export function parseBinanceBtcUsdtTickSize(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const symbols = (raw as Record<string, unknown>).symbols;
  if (!Array.isArray(symbols)) return null;
  const matches = symbols.filter((entry): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as Record<string, unknown>).symbol === 'BTCUSDT');
  if (matches.length !== 1) return null;
  const symbol = matches[0]!;
  if (symbol.status !== 'TRADING' || symbol.contractType !== 'PERPETUAL' || symbol.baseAsset !== 'BTC'
    || symbol.quoteAsset !== 'USDT' || symbol.marginAsset !== 'USDT') return null;
  if (!Array.isArray(symbol.filters)) return null;
  const filters = symbol.filters.filter((entry): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as Record<string, unknown>).filterType === 'PRICE_FILTER');
  if (filters.length !== 1) return null;
  const tickSize = positiveNumber(filters[0]!.tickSize);
  return tickSize !== null && tickSize <= 1 ? tickSize : null;
}

interface MutableCell { row: number; bidVol: number; askVol: number; bidNotional: number; askNotional: number }
interface MutableBar {
  time: number;
  revision: number;
  cells: Map<number, MutableCell>;
  delta: number;
  minDelta: number;
  maxDelta: number;
  quoteDelta: number;
  minQuoteDelta: number;
  maxQuoteDelta: number;
  open: number;
  high: number;
  low: number;
  close: number;
  aggregateRecordCount: number;
  coverage: FootprintBar['coverage'];
  gapBefore: boolean;
}

/** Bounded integer-grid accumulator; no per-tick cell-array cloning or sorting. */
export class FootprintAccumulator {
  private bars: MutableBar[] = [];
  private current?: MutableBar;
  private dirty = new Set<MutableBar>();
  private cells = 0;
  private outageCount = 0;
  private capacityDrops = 0;
  private nextGapBefore = false;
  private nextPartial = true;
  private readonly limits: FootprintLimits;

  constructor(readonly interval: Interval, readonly tickSize: number, readonly rowTicks: FootprintRowTicks, limits: Partial<FootprintLimits> = {}) {
    if (!Number.isFinite(tickSize) || tickSize <= 0) throw new RangeError('Footprint tick size must be positive and finite');
    if (!Number.isInteger(rowTicks) || rowTicks <= 0) throw new RangeError('Footprint row ticks must be a positive integer');
    this.limits = {
      maxBars: boundedLimit(limits.maxBars, FOOTPRINT_MAX_BARS),
      maxCells: boundedLimit(limits.maxCells, FOOTPRINT_MAX_CELLS),
      maxCellsPerBar: boundedLimit(limits.maxCellsPerBar, FOOTPRINT_MAX_CELLS_PER_BAR),
    };
  }

  get barCount() { return this.bars.length; }
  get cellCount() { return this.cells; }
  /** Explicit transport outages only; empty UTC intervals are not assumed to be outages. */
  get outages() { return this.outageCount; }
  get drops() { return this.capacityDrops; }
  get latestTime() { return this.current?.time ?? null; }
  get oldestTime() { return this.bars[0]?.time ?? null; }
  get latest() { return this.current ? freezeBar(this.current, this.tickSize * this.rowTicks) : null; }

  /** Restore a validated bounded durable snapshot before cursor replay. */
  restore(bars: FootprintBar[]) {
    if (bars.length > this.limits.maxBars || bars.reduce((n, b) => n + b.cells.length, 0) > this.limits.maxCells
      || bars.some((b, i) => b.rowSize !== this.tickSize * this.rowTicks || b.cells.length > this.limits.maxCellsPerBar || (i > 0 && b.time <= bars[i - 1]!.time))) throw new Error('Invalid footprint snapshot bounds');
    this.dispose();
    this.bars = bars.map(b => ({ ...b, quoteDelta: b.quoteDelta ?? 0, minQuoteDelta: b.minQuoteDelta ?? 0, maxQuoteDelta: b.maxQuoteDelta ?? 0,
      cells: new Map(b.cells.map(c => { const row = Math.round(c.price / b.rowSize); return [row, { row, bidVol: c.bidVol, askVol: c.askVol, bidNotional: c.bidNotional ?? 0, askNotional: c.askNotional ?? 0 }]; })) }));
    this.current = this.bars.at(-1); this.cells = bars.reduce((n, b) => n + b.cells.length, 0); this.nextPartial = !this.current;
  }

  ingest(trade: AggTradeObservation): 'applied' | 'late' | 'unknown-side' | 'capacity' | 'invalid-grid' {
    if (trade.side === 'unknown') return 'unknown-side';
    if (![trade.timeMs, trade.price, trade.quantity].every(Number.isFinite)
      || trade.timeMs <= 0 || trade.price <= 0 || trade.quantity <= 0
      || trade.price > Number.MAX_SAFE_INTEGER || trade.quantity > Number.MAX_SAFE_INTEGER) return 'invalid-grid';
    const tickIndex = Math.round(trade.price / this.tickSize);
    const exactTickPrice = tickIndex * this.tickSize;
    const tolerance = Math.max(1, Math.abs(trade.price)) * Number.EPSILON * 4;
    if (!Number.isSafeInteger(tickIndex) || Math.abs(exactTickPrice - trade.price) > tolerance) return 'invalid-grid';

    // Fixed lower-bound buckets: [N * rowSize, (N + 1) * rowSize).
    const row = Math.floor(tickIndex / this.rowTicks);
    if (!Number.isSafeInteger(row)) return 'invalid-grid';
    const barTime = Math.floor(trade.timeMs / duration[this.interval]) * duration[this.interval] / 1000;
    if (this.current && barTime < this.current.time) return 'late';

    let bar: MutableBar;
    if (this.current?.time === barTime) {
      bar = this.current;
      // An outage recovered within the same UTC bar. That bar stays explicitly
      // gapped, but the later boundary starts fully observed again.
      this.nextPartial = false;
      this.nextGapBefore = false;
    } else {
      // Time with no trades is not evidence of a transport outage. Only explicit
      // socket/offline signals call markGap().
      if (this.bars.length >= this.limits.maxBars) {
        this.evictOldest();
      }
      this.makeRoomForBarCell();
      if (this.cells >= this.limits.maxCells) { this.capacityDrops++; return 'capacity'; }
      bar = {
        time: barTime, revision: 0, cells: new Map(), delta: 0, minDelta: 0, maxDelta: 0,
        quoteDelta: 0, minQuoteDelta: 0, maxQuoteDelta: 0,
        open: trade.price, high: trade.price, low: trade.price, close: trade.price, aggregateRecordCount: 0,
        coverage: this.nextPartial ? 'partial' : 'observed', gapBefore: this.nextGapBefore,
      };
      this.nextPartial = false;
      this.nextGapBefore = false;
      this.bars.push(bar);
      this.current = bar;
    }

    let cell = bar.cells.get(row);
    if (!cell) {
      // Reject a per-bar overflow before evicting an unrelated older bar to
      // satisfy the global cell budget.
      if (bar.cells.size >= this.limits.maxCellsPerBar) {
        this.capacityDrops++;
        bar.coverage = 'capacity-limited';
        bar.revision++;
        this.dirty.add(bar);
        return 'capacity';
      }
      this.makeRoomForCell();
      if (this.cells >= this.limits.maxCells) {
        this.capacityDrops++;
        bar.coverage = 'capacity-limited';
        bar.revision++;
        this.dirty.add(bar);
        return 'capacity';
      }
    }
    if (!cell) {
      cell = { row, bidVol: 0, askVol: 0, bidNotional: 0, askNotional: 0 };
      bar.cells.set(row, cell);
      this.cells++;
    }
    const nextBid = cell.bidVol + (trade.side === 'sell' ? trade.quantity : 0);
    const nextAsk = cell.askVol + (trade.side === 'buy' ? trade.quantity : 0);
    const nextDelta = bar.delta + (trade.side === 'sell' ? -trade.quantity : trade.quantity);
    const notional = trade.price * trade.quantity;
    const nextBidNotional = cell.bidNotional + (trade.side === 'sell' ? notional : 0);
    const nextAskNotional = cell.askNotional + (trade.side === 'buy' ? notional : 0);
    const nextQuoteDelta = bar.quoteDelta + (trade.side === 'sell' ? -notional : notional);
    if ([nextBid, nextAsk, nextDelta].some(value => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      || ![nextBidNotional, nextAskNotional, nextQuoteDelta].every(Number.isFinite)) {
      if (cell.bidVol === 0 && cell.askVol === 0) { bar.cells.delete(row); this.cells--; }
      this.capacityDrops++;
      bar.coverage = 'capacity-limited';
      bar.revision++;
      this.dirty.add(bar);
      return 'capacity';
    }
    cell.bidVol = nextBid;
    cell.askVol = nextAsk;
    cell.bidNotional = nextBidNotional;
    cell.askNotional = nextAskNotional;
    bar.quoteDelta = nextQuoteDelta;
    bar.minQuoteDelta = Math.min(bar.minQuoteDelta, nextQuoteDelta);
    bar.maxQuoteDelta = Math.max(bar.maxQuoteDelta, nextQuoteDelta);
    bar.delta = nextDelta;
    bar.minDelta = Math.min(bar.minDelta, nextDelta);
    bar.maxDelta = Math.max(bar.maxDelta, nextDelta);
    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.close = trade.price;
    bar.aggregateRecordCount++;
    bar.revision++;
    this.dirty.add(bar);
    return 'applied';
  }

  /** Mark one explicit observation outage without inventing empty bars. */
  markGap(outageTimeMs?: number) {
    this.outageCount++;
    const currentStartMs = this.current ? this.current.time * 1000 : null;
    const currentEndMs = currentStartMs === null ? null : currentStartMs + duration[this.interval];
    const overlapsCurrent = currentStartMs !== null && (outageTimeMs === undefined
      || (outageTimeMs >= currentStartMs && outageTimeMs < currentEndMs!));
    if (this.current && overlapsCurrent) {
      this.current.coverage = 'gapped';
      this.current.revision++;
      this.dirty.add(this.current);
    }
    this.nextPartial = true;
    this.nextGapBefore = true;
  }

  /** Mark an affected retained bar when a late record cannot be applied in order. */
  markCoverageGap(timeMs: number) {
    const time = Math.floor(timeMs / duration[this.interval]) * duration[this.interval] / 1000;
    const bar = this.bars.find(item => item.time === time);
    if (!bar || bar.coverage === 'capacity-limited') return false;
    bar.coverage = 'gapped';
    bar.revision++;
    this.dirty.add(bar);
    return true;
  }

  snapshot(): FootprintBar[] { return this.bars.map(bar => freezeBar(bar, this.tickSize * this.rowTicks)); }

  drainDirty(): FootprintBar[] {
    const changed = [...this.dirty].sort((a, b) => a.time - b.time).map(bar => freezeBar(bar, this.tickSize * this.rowTicks));
    this.dirty.clear();
    return changed;
  }

  dispose() {
    this.bars = []; this.current = undefined; this.dirty.clear(); this.cells = 0;
    this.outageCount = 0; this.capacityDrops = 0; this.nextPartial = true; this.nextGapBefore = false;
  }

  private makeRoomForCell() {
    while (this.cells >= this.limits.maxCells && this.bars.length > 1) this.evictOldest();
  }

  private makeRoomForBarCell() {
    // A new timeframe bar may evict the whole retained horizon if the configured
    // cell cap is already full. Never append a phantom empty bar on rejection.
    while (this.cells >= this.limits.maxCells && this.bars.length > 0) this.evictOldest();
  }

  private evictOldest() {
    const evicted = this.bars.shift();
    if (!evicted) return;
    this.cells -= evicted.cells.size;
    this.dirty.delete(evicted);
    if (this.current === evicted) {
      this.current = undefined;
      this.nextPartial = true;
    }
  }
}

function freezeBar(bar: MutableBar, rowSize: number): FootprintBar {
  const cells: FootprintCell[] = [...bar.cells.values()]
    .sort((a, b) => b.row - a.row)
    .map(cell => ({ price: cell.row * rowSize, bidVol: cell.bidVol, askVol: cell.askVol,
      bidNotional: cell.bidNotional, askNotional: cell.askNotional }));
  return {
    time: bar.time, revision: bar.revision, cells, delta: bar.delta, minDelta: bar.minDelta, maxDelta: bar.maxDelta,
    quoteDelta: bar.quoteDelta, minQuoteDelta: bar.minQuoteDelta, maxQuoteDelta: bar.maxQuoteDelta,
    rowSize, open: bar.open, high: bar.high, low: bar.low, close: bar.close, aggregateRecordCount: bar.aggregateRecordCount,
    source: 'binance-usdm-aggtrade', granularity: 'aggregate-trade',
    coverage: bar.coverage, gapBefore: bar.gapBefore,
  };
}

function boundedLimit(value: number | undefined, hardMaximum: number) {
  if (value === undefined) return hardMaximum;
  if (!Number.isInteger(value) || value < 1) throw new RangeError('Footprint retention limits must be positive integers');
  return Math.min(value, hardMaximum);
}

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

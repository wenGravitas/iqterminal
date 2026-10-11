/** Storage-ready session liquidity, independent of chart engine types. Times are host-observed UTC ms. */
export const HEATMAP_STRIDE = 9;
// row-low, bid BTC*ms, ask BTC*ms, bid peak, ask peak, bid/ask observed ms, bid/ask complete ms.
export interface LiquidityBucket {
  id: string; start: number; end: number; epoch: number; rowSize: number;
  priceOffset?: number; // Lower-bound grid offset, zero for fixed price-multiple buckets.
  revision: number; capacityLimited: boolean; cells: Float64Array;
  /** factor, row low, simultaneous bid peak, simultaneous ask peak for power-of-two price bins. */
  peaks: Float64Array;
}
/** Footprint flag affects rendering LOD only; all collection uses fixed lower bounds. */
export interface HeatmapResolution { rowPrice: number; bucketMs: 250 | 500; rowAlignment?: 'footprint' }
export interface HeatmapSettings extends HeatmapResolution {
  enabled: boolean; mode: 'average' | 'peak'; opacity: number; intensity: number;
  minimum: number; labels: 'auto' | 'off'; bids: boolean; asks: boolean;
}
export interface HeatmapStatus {
  state: 'syncing' | 'live' | 'stale' | 'failed'; message: string; tickSize: number | null;
  collectionStart: number | null; retentionStart: number | null; capacityLimited: boolean;
}
export const HEATMAP_LIMITS = Object.freeze({ configurations: 4, buckets: 240, rows: 128, cells: 16384, bytes: 2 * 1024 * 1024 });
export const DEFAULT_HEATMAP: HeatmapSettings = Object.freeze({ enabled: false, rowPrice: 10, bucketMs: 500,
  mode: 'average', opacity: .45, intensity: 100, minimum: .01, labels: 'auto', bids: true, asks: true });
export function heatmapSettings(value: unknown): HeatmapSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const bounded = (key: string, low: number, high: number, fallback: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) && Number(v[key]) >= low && Number(v[key]) <= high ? Number(v[key]) : fallback;
  return { enabled: v.enabled === true, rowPrice: bounded('rowPrice', .000001, 10000, 10), bucketMs: v.bucketMs === 250 ? 250 : 500,
    mode: v.mode === 'peak' ? 'peak' : 'average', opacity: bounded('opacity', .05, .8, .45), intensity: bounded('intensity', .01, 10000, 100),
    minimum: bounded('minimum', 0, 10000, .01), labels: v.labels === 'off' ? 'off' : 'auto', bids: v.bids !== false, asks: v.asks !== false };
}
export function heatmapKey(resolution: HeatmapResolution) { return `${resolution.rowPrice}:${resolution.bucketMs}`; }
export function validResolution(v: HeatmapResolution) { return v && (v.rowAlignment === undefined || v.rowAlignment === 'footprint') && [250, 500].includes(v.bucketMs) && Number.isFinite(v.rowPrice) && v.rowPrice > 0 && v.rowPrice <= 10000; }
export interface LiquidityState { rowLow: number; bid: number; ask: number; bidObserved: boolean; askObserved: boolean; bidComplete: boolean; askComplete: boolean }
export interface ReadonlyDepthView {
  snapshotBidBoundary: number | null; snapshotAskBoundary: number | null;
  visitLevels(visitor: (side: 'bid' | 'ask', price: number, size: number) => void): void;
}
/** Group simultaneous levels. Outside conservative snapshot edges is never treated as known empty. */
export function groupBook(book: ReadonlyDepthView, rowSize: number, tickSize: number): { rows: LiquidityState[]; limited: boolean } {
  const low = book.snapshotBidBoundary, high = book.snapshotAskBoundary;
  if (low === null || high === null || !(high > low)) return { rows: [], limited: false };
  const rowTicks = Math.round(rowSize / tickSize);
  if (rowTicks < 1 || Math.abs(rowTicks * tickSize - rowSize) > tickSize * 1e-6) throw new RangeError('Heatmap price level must be a multiple of the exchange tick size');
  const offset = 0;
  const grid = (price: number) => Math.floor(Math.round(price / tickSize) / rowTicks);
  const first = grid(low), last = grid(high), count = last - first + 1;
  const start = count > HEATMAP_LIMITS.rows ? Math.floor((first + last - HEATMAP_LIMITS.rows + 1) / 2) : first;
  const rows: LiquidityState[] = Array.from({ length: Math.min(count, HEATMAP_LIMITS.rows) }, (_, i) => {
    const rowLow = (start + i) * rowTicks * tickSize + offset, rowHigh = rowLow + rowSize;
    return { rowLow, bid: 0, ask: 0, bidObserved: rowHigh > low, askObserved: rowLow <= high,
      bidComplete: rowLow >= low - tickSize * 1e-6, askComplete: rowHigh <= high + tickSize * 1e-6 };
  });
  book.visitLevels((side, price, size) => {
    if (price < low || price > high) return; // Never import untrustworthy outer updates.
    const index = grid(price) - start;
    if (index >= 0 && index < rows.length) rows[index]![side] += size;
  });
  return { rows, limited: count > HEATMAP_LIMITS.rows };
}

/** Integrate piecewise-constant observed book states; irregular message frequency does not change weighting. */
export class LiquidityCollector {
  private buckets = new Map<string, LiquidityBucket>();
  private dirty = new Set<string>();
  private state: LiquidityState[] = [];
  private at: number | null = null;
  private epoch = 0;
  private limited = false;
  private nextRevision = 0;
  collectionStart: number | null = null;
  evictions = 0;
  constructor(readonly resolution: HeatmapResolution, readonly tickSize: number,
    private limits = HEATMAP_LIMITS) {}
  transition(book: ReadonlyDepthView | null, now: number, epoch: number) {
    this.advance(now);
    const grouped = book ? groupBook(book, this.resolution.rowPrice, this.tickSize) : { rows: [], limited: false };
    this.state = grouped.rows; this.limited = grouped.limited; this.at = now; this.epoch = epoch;
    if (this.state.length) {
      this.collectionStart ??= now;
      const bucket = this.ensureBucket(now);
      // Even multiple supplied updates at the same millisecond contribute observed peaks.
      this.observePeaks(bucket);
      const first = bucket.cells[0]!;
      for (const row of this.state) {
        const i = Math.round((row.rowLow - first) / bucket.rowSize) * HEATMAP_STRIDE;
        if (i < 0 || i >= bucket.cells.length) { bucket.capacityLimited = true; continue; }
        bucket.cells[i + 3] = Math.max(bucket.cells[i + 3]!, row.bid);
        bucket.cells[i + 4] = Math.max(bucket.cells[i + 4]!, row.ask);
      }
    }
  }
  advance(now: number) {
    if (this.at === null || now <= this.at) return;
    if (!this.state.length) { this.at = now; return; }
    // Bound work after suspended worker timers. Unobserved >5s is a gap, not an extrapolated wall.
    const end = Math.min(now, this.at + 5000);
    while (this.at < end) {
      const boundary = Math.floor(this.at / this.resolution.bucketMs) * this.resolution.bucketMs;
      const until = Math.min(end, boundary + this.resolution.bucketMs), dt = until - this.at;
      const id = `${boundary}:${this.epoch}`;
      const fresh = !this.buckets.has(id);
      const bucket = this.ensureBucket(this.at);
      if (fresh) this.observePeaks(bucket);
      // Covered rows can shift within a bucket. Retain initial row grid and mark truncation if needed.
      const first = bucket.cells[0] ?? 0;
      for (const row of this.state) {
        const index = Math.round((row.rowLow - first) / bucket.rowSize), offset = index * HEATMAP_STRIDE;
        if (index < 0 || offset >= bucket.cells.length) { bucket.capacityLimited = true; continue; }
        const c = bucket.cells;
        c[offset + 1]! += row.bid * dt; c[offset + 2]! += row.ask * dt;
        c[offset + 3] = Math.max(c[offset + 3]!, row.bid); c[offset + 4] = Math.max(c[offset + 4]!, row.ask);
        if (row.bidObserved) c[offset + 5]! += dt;
        if (row.askObserved) c[offset + 6]! += dt;
        if (row.bidComplete) c[offset + 7]! += dt;
        if (row.askComplete) c[offset + 8]! += dt;
      }
      bucket.end = until; bucket.revision = ++this.nextRevision; bucket.capacityLimited ||= this.limited;
      this.dirty.add(id); this.at = until;
    }
    if (end < now) { this.at = now; this.state = []; }
  }
  private ensureBucket(now: number) {
    const boundary = Math.floor(now / this.resolution.bucketMs) * this.resolution.bucketMs, id = `${boundary}:${this.epoch}`;
    let b = this.buckets.get(id);
    if (!b) {
      this.makeRoom(this.state.length);
      b = { id, start: now, end: now, epoch: this.epoch, rowSize: this.resolution.rowPrice, priceOffset: this.priceOffset, revision: 0,
        capacityLimited: this.limited, cells: new Float64Array(this.state.length * HEATMAP_STRIDE), peaks: this.makePeaks() };
      this.state.forEach((row, i) => { b!.cells[i * HEATMAP_STRIDE] = row.rowLow; }); this.buckets.set(id, b);
    }
    return b;
  }
  private get priceOffset() { return 0; }
  private makePeaks() {
    const entries: number[] = [];
    for (let factor = 2; factor <= 128; factor *= 2) {
      const size = this.resolution.rowPrice * factor;
      const low = Math.floor((this.state[0]!.rowLow - this.priceOffset) / size + 1e-8), high = Math.floor((this.state.at(-1)!.rowLow - this.priceOffset) / size + 1e-8);
      for (let i = low; i <= high; i++) entries.push(factor, i * size + this.priceOffset, 0, 0);
    }
    return new Float64Array(entries);
  }
  private observePeaks(b: LiquidityBucket) {
    for (let factor = 2; factor <= 128; factor *= 2) {
      const size = factor * b.rowSize, sums = new Map<number, [number, number]>();
      for (const row of this.state) {
        const key = Math.floor((row.rowLow - this.priceOffset) / size + 1e-8), pair = sums.get(key) ?? [0, 0];
        pair[0] += row.bid; pair[1] += row.ask; sums.set(key, pair);
      }
      for (let i = 0; i < b.peaks.length; i += 4) if (b.peaks[i] === factor) {
        const sum = sums.get(Math.round((b.peaks[i + 1]! - this.priceOffset) / size));
        if (sum) { b.peaks[i + 2] = Math.max(b.peaks[i + 2]!, sum[0]); b.peaks[i + 3] = Math.max(b.peaks[i + 3]!, sum[1]); }
      }
    }
  }
  private makeRoom(rows: number) {
    while (this.buckets.size && (this.buckets.size >= this.limits.buckets || this.cellCount + rows > this.limits.cells || this.bytes + rows * (HEATMAP_STRIDE + 8) * 8 + 1024 > this.limits.bytes)) {
      const key = this.buckets.keys().next().value!;
      this.buckets.delete(key); this.dirty.delete(key); this.evictions++;
    }
  }
  get cellCount() { let n = 0; for (const b of this.buckets.values()) n += b.cells.length / HEATMAP_STRIDE; return n; }
  get bytes() { let n = 0; for (const b of this.buckets.values()) n += b.cells.byteLength + b.peaks.byteLength + 256; return n; }
  get retentionStart() { return this.buckets.values().next().value?.start ?? null; }
  get capacityLimited() { return this.limited; }
  snapshot() { return [...this.buckets.values()].filter(b => b.end > b.start).map(copyBucket); }
  changes() { const result = [...this.dirty].map(id => this.buckets.get(id)).filter((b): b is LiquidityBucket => b !== undefined && b.end > b.start).map(copyBucket); this.dirty.clear(); return result; }
  diagnostics() { return { buckets: this.buckets.size, cells: this.cellCount, bytes: this.bytes, evictions: this.evictions, dirty: this.dirty.size }; }
}
function copyBucket(b: LiquidityBucket): LiquidityBucket { return { ...b, cells: b.cells.slice(), peaks: b.peaks.slice() }; }

import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { FootprintOptions } from 'openalgo-charts/profile';
import { DEFAULT_HEATMAP, HEATMAP_LIMITS, HEATMAP_STRIDE, type HeatmapSettings, type LiquidityBucket } from '../feed/heatmap-model';

/** Map observations to their candle centre. Missing host intervals have no display slot. */
export function timestampToLogical(timeMs: number, intervalMs: number, indexOf: (seconds: number) => number | undefined): number | null {
  const open = Math.floor(timeMs / intervalMs) * intervalMs, index = indexOf(open / 1000);
  return index === undefined ? null : index;
}
export interface HeatmapBin {
  start: number; end: number; columnStart: number; columnEnd: number; observedDuration: number; partial: boolean;
  low: number; high: number; epoch: number;
  bid: number; ask: number; bidObserved: boolean; askObserved: boolean; incomplete: boolean;
  x: number; right: number; y: number; bottom: number;
}
interface Aggregate extends HeatmapBin { duration: number; bidArea: number; askArea: number; bidPeak: number; askPeak: number }
/** Quantities, never colour values, are aggregated. Fixed density scaling is independent of viewport. */
export function heatmapBins(buckets: readonly LiquidityBucket[], options: HeatmapSettings, intervalMs: number,
  indexOf: (seconds: number) => number | undefined, xOf: (index: number) => number, yOf: (price: number) => number,
  width: number, height: number, priceRows: typeof groupPriceRows = groupPriceRows): HeatmapBin[] {
  const bins = new Map<string, Aggregate>();
  for (const b of buckets) {
    const index = timestampToLogical(b.start, intervalMs, indexOf);
    if (index === null) continue;
    const columnStart = Math.floor(b.start / intervalMs) * intervalMs, columnEnd = columnStart + intervalMs;
    // One fixed-width column per host candle, including the forming candle. Its
    // display slot is not an observation of future liquidity: retain actual times.
    const x = xOf(index - .5), right = xOf(index + .5);
    if (right <= 0 || x >= width || b.end <= b.start) continue;
    const rowHeight = Math.abs(yOf(b.rowSize) - yOf(0));
    const factor = options.rowAlignment === 'footprint' ? 1 : Math.min(128, Math.max(1, 2 ** Math.ceil(Math.log2(4 / Math.max(.0001, rowHeight)))));
    const priceSize = b.rowSize * factor;
    const duration = b.end - b.start;
    for (const g of priceRows(b, factor)) {
      const low = g.low, high = low + priceSize;
      const priceKey = Math.round(low / priceSize);
      const y = yOf(high), bottom = yOf(low);
      if (bottom < 0 || y > height) continue;
      const key = `${columnStart}:${priceKey}:${factor}`;
      let a = bins.get(key);
      if (!a) { a = { start: b.start, end: b.end, columnStart, columnEnd, observedDuration: 0, partial: true, low, high, epoch: b.epoch, bid: 0, ask: 0, bidObserved: false, askObserved: false,
        incomplete: false, x, right, y, bottom, duration: 0, bidArea: 0, askArea: 0, bidPeak: 0, askPeak: 0 }; bins.set(key, a); }
      else if (a.end !== b.start || a.epoch !== b.epoch) a.incomplete = true;
      // Gaps contribute no duration or zero quantity. Multiple epochs in one
      // candle share its column but are explicitly marked incomplete.
      a.end = b.end; a.duration += duration;
      a.bidArea += g.bidArea; a.askArea += g.askArea; a.bidPeak = Math.max(a.bidPeak, g.bidPeak); a.askPeak = Math.max(a.askPeak, g.askPeak);
      a.bidObserved ||= g.bidObserved; a.askObserved ||= g.askObserved; a.incomplete ||= g.incomplete;
    }
  }
  return [...bins.values()].map(a => ({ ...a, observedDuration: a.duration, partial: a.start > a.columnStart || a.end < a.columnEnd, bid: options.mode === 'peak' ? a.bidPeak : a.bidArea / a.duration,
    ask: options.mode === 'peak' ? a.askPeak : a.askArea / a.duration }));
}

interface PriceRow {
  low: number; bidArea: number; askArea: number; bidPeak: number; askPeak: number;
  bidObserved: boolean; askObserved: boolean; incomplete: boolean;
}
/** Projection of one immutable tile, reusable across pans and time zoom. */
function groupPriceRows(b: LiquidityBucket, factor: number): PriceRow[] {
  const priceSize = b.rowSize * factor, duration = b.end - b.start, groups = new Map<number, PriceRow>();
  for (let i = 0; i < b.cells.length; i += HEATMAP_STRIDE) {
    const c = b.cells, offset = b.priceOffset ?? 0, key = Math.floor((c[i]! - offset) / priceSize + 1e-8);
    const g = groups.get(key) ?? { low: key * priceSize + offset, bidArea: 0, askArea: 0, bidPeak: 0, askPeak: 0, bidObserved: false, askObserved: false, incomplete: b.capacityLimited };
    g.bidArea += c[i + 1]!; g.askArea += c[i + 2]!;
    g.bidPeak = Math.max(g.bidPeak, c[i + 3]!); g.askPeak = Math.max(g.askPeak, c[i + 4]!);
    g.bidObserved ||= c[i + 5]! > 0; g.askObserved ||= c[i + 6]! > 0;
    g.incomplete ||= c[i + 7]! < duration || c[i + 8]! < duration; groups.set(key, g);
  }
  if (factor > 1) for (const g of groups.values()) {
    g.incomplete ||= g.low < b.cells[0]! || g.low + priceSize > b.cells[b.cells.length - HEATMAP_STRIDE]! + b.rowSize;
    // Worker peaks are maxima of simultaneous row sums, not sums of individual maxima.
    for (let i = 0; i < b.peaks.length; i += 4) if (b.peaks[i] === factor && Math.abs(b.peaks[i + 1]! - g.low) < b.rowSize * 1e-6) {
      g.bidPeak = b.peaks[i + 2]!; g.askPeak = b.peaks[i + 3]!; break;
    }
  }
  return [...groups.values()];
}

const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
export const LIQUIDITY_PALETTE = Array.from({ length: 256 }, (_, n) => {
  const position = n / 255 * 4, i = Math.min(3, Math.floor(position)), f = position - i;
  const color = stops[i]!.map((value, channel) => Math.round(value + (stops[i + 1]![channel]! - value) * f));
  return `rgb(${color.join(',')})`;
});
/** Choose contrast after compositing liquidity opacity over the actual chart background. */
export function liquidityTextColor(index: number, opacity: number, background: string) {
  const fill = LIQUIDITY_PALETTE[index]!.match(/\d+/g)!.map(Number);
  const hex = /^#[\da-f]{6}$/i.test(background) ? background : '#090909';
  const channels = fill.map((value, i) => (value * opacity + parseInt(hex.slice(1+i*2,3+i*2),16)*(1-opacity))/255);
  const linear = channels.map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  const luminance = linear[0]!*.2126 + linear[1]!*.7152 + linear[2]!*.0722;
  return luminance > .179 ? '#000000' : '#ffffff';
}
export function intensityIndex(quantity: number, priceWidth: number, fixedScale: number) {
  // Density in BTC per $10 prevents wider price bins looking like stronger individual walls.
  return Math.round(255 * Math.min(1, Math.log1p(quantity * 10 / priceWidth / fixedScale) / Math.log(2)));
}
export class OrderBookHeatmap implements IPrimitive {
  private footprintLayout?: Pick<FootprintOptions, 'widthFactor' | 'cellWidth' | 'showCandle'>;
  private host?: PrimitiveHost; private buckets: LiquidityBucket[] = []; private options: HeatmapSettings = { ...DEFAULT_HEATMAP };
  private version = 0; private cacheKey = ''; private bins: HeatmapBin[] = [];
  private durations: number[] = [];
  private priceCache = new Map<string, { revision: number; factor: number; rows: PriceRow[] }>();
  diagnostics() { const sorted = [...this.durations].sort((a, b) => a-b); return { ...this.stats, cachedPriceTiles: this.priceCache.size, cachedPriceRows: [...this.priceCache.values()].reduce((n, v) => n + v.rows.length, 0), p95RenderMs: sorted[Math.floor((sorted.length-1)*.95)] ?? 0 }; }
  readonly stats = { priceCacheBuilds: 0, draws: 0, rebuilds: 0, renderMs: 0, maxRenderMs: 0, labels: 0, bins: 0, bytes: 0 };
  constructor(private intervalMs: number) {}
  zOrder() { return 'bottom' as const; }
  autoscaleInfo() { return null; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.buckets = []; this.bins = []; this.stats.bytes = 0; this.priceCache.clear(); }
  setInterval(intervalMs: number) { if (this.intervalMs !== intervalMs) { this.intervalMs = intervalMs; this.cacheKey = ''; this.host?.requestUpdate(); } }
  setOptions(options: HeatmapSettings) { this.options = { ...options }; this.version++; this.host?.requestUpdate(); }
  setFootprintLayout(options?: Pick<FootprintOptions, 'widthFactor' | 'cellWidth' | 'showCandle'>) {
    this.footprintLayout = options ? { ...options } : undefined; this.version++; this.host?.requestUpdate();
  }
  update(buckets: LiquidityBucket[], snapshot: boolean, retentionStart: number | null) {
    const map = new Map(snapshot ? [] : this.buckets.map(b => [b.id, b]));
    for (const b of buckets) {
      if (!(b.cells instanceof Float64Array) || !(b.peaks instanceof Float64Array) || b.cells.length > HEATMAP_LIMITS.rows * HEATMAP_STRIDE || b.peaks.length > 1200 || b.end <= b.start || !Number.isFinite(b.start + b.end + b.rowSize) || b.rowSize <= 0) continue;
      if (!map.has(b.id) || b.revision > map.get(b.id)!.revision) map.set(b.id, b);
    }
    this.buckets = [...map.values()].filter(b => retentionStart !== null && b.end > retentionStart).sort((a, b) => a.start - b.start).slice(-HEATMAP_LIMITS.buckets);
    let bytes = this.buckets.reduce((n, b) => n + b.cells.byteLength + b.peaks.byteLength + 256, 0);
    while (bytes > HEATMAP_LIMITS.bytes && this.buckets.length) { const b = this.buckets.shift()!; bytes -= b.cells.byteLength + b.peaks.byteLength + 256; }
    const retained = new Set(this.buckets.map(b => b.id));
    for (const id of this.priceCache.keys()) if (!retained.has(id)) this.priceCache.delete(id);
    this.stats.bytes = bytes; this.version++; this.host?.requestUpdate();
  }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const started = performance.now(), o = this.options, dpr = rc.dpr;
    const range = rc.timeScale.visibleRange(), prices = rc.priceScale.priceRange();
    const key = `${this.version}:${this.intervalMs}:${range.from}:${range.to}:${prices.min}:${prices.max}:${rc.plotWidth}:${rc.plotHeight}:${dpr}:${rc.dataLayer.indexToTime(0)}`;
    if (this.cacheKey !== key) {
      this.bins = heatmapBins(this.buckets, o, this.intervalMs, t => rc.dataLayer.timeToIndex(t), i => rc.timeScale.indexToX(i), p => rc.priceScale.priceToY(p), rc.plotWidth, rc.plotHeight, (b, factor) => {
        const cached = this.priceCache.get(b.id);
        if (cached?.revision === b.revision && cached.factor === factor) return cached.rows;
        const rows = groupPriceRows(b, factor); this.priceCache.set(b.id, { revision: b.revision, factor, rows }); this.stats.priceCacheBuilds++;
        return rows;
      });
      if (this.footprintLayout) {
        // Public 2.6.0 Footprint geometry: reserve the slim candle before the ladder.
        const o = this.footprintLayout, spacing = rc.timeScale.barSpacing;
        const column = Math.max(.1, Math.min(o.cellWidth ?? spacing * o.widthFactor, spacing * .96));
        const candle = o.showCandle && column >= 20 ? Math.min(9, column * .15) : 0;
        for (const bin of this.bins) {
          const centre = (bin.x + bin.right) / 2;
          bin.x = centre - column / 2 + candle; bin.right = bin.x + Math.max(.1, column - candle);
        }
      }
      this.cacheKey = key; this.stats.rebuilds++;
    }
    this.stats.draws++; this.stats.labels = 0; this.stats.bins = this.bins.length;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of this.bins) {
      const sides = this.visibleSides(b);
      const w = b.right - b.x, h = b.bottom - b.y;
      for (const side of sides) {
        const quantity = b[side]; if (quantity < o.minimum) continue;
        // If both sides occupy a coarse row, keep separate vertical halves and readouts.
        const split = sides.length === 2, y = b.y + (split && side === 'bid' ? h / 2 : 0), height = split ? h / 2 : h;
        ctx.globalAlpha = o.opacity * (b.incomplete ? .55 : 1);
        const intensity = intensityIndex(quantity, b.high - b.low, o.intensity);
        ctx.fillStyle = LIQUIDITY_PALETTE[intensity]!;
        ctx.fillRect(b.x * dpr, y * dpr, w * dpr, height * dpr);
        if (b.incomplete && w > 4 && height > 4) {
          ctx.strokeStyle = '#858585'; ctx.globalAlpha = .3; ctx.lineWidth = dpr;
          ctx.beginPath(); ctx.moveTo(b.x * dpr, (y + height) * dpr); ctx.lineTo(Math.min(b.right, b.x + height) * dpr, y * dpr); ctx.stroke();
        }
        const text = quantity.toFixed(2), labelLeft = Math.max(0, b.x), labelRight = Math.min(rc.plotWidth, b.right);
        const labelTop = Math.max(0, y), labelBottom = Math.min(rc.plotHeight, y + height);
        const labelWidth = labelRight - labelLeft, labelHeight = labelBottom - labelTop;
        const font = Math.min(24, labelHeight * .8, (labelWidth - 8) / (text.length * .62));
        if (o.labels === 'auto' && font >= 9 && labelHeight >= 14) {
          ctx.globalAlpha = 1; ctx.fillStyle = liquidityTextColor(intensity, o.opacity * (b.incomplete ? .55 : 1), rc.theme?.background ?? '#090909');
          ctx.font = `${font * dpr}px ui-monospace, monospace`;
          ctx.fillText(text, (labelLeft + labelWidth / 2) * dpr, (labelTop + labelHeight / 2) * dpr, (labelWidth - 8) * dpr); this.stats.labels++;
        }
      }
    }
    ctx.restore(); const elapsed = performance.now() - started; this.durations.push(elapsed); if (this.durations.length > 512) this.durations.shift(); this.stats.renderMs += elapsed; this.stats.maxRenderMs = Math.max(this.stats.maxRenderMs, elapsed);
  }
  private visibleSides(b: HeatmapBin) {
    return (['bid', 'ask'] as const).filter(side => (side === 'bid' ? this.options.bids && b.bidObserved : this.options.asks && b.askObserved) && b[side] > 0 && b[side] >= this.options.minimum);
  }
  hoverAt(x: number, y: number): { bin: HeatmapBin; side: 'bid' | 'ask'; mode: 'average' | 'peak' } | null {
    for (const b of this.bins) if (x >= b.x && x < b.right && y >= b.y && y < b.bottom) {
      const sides = this.visibleSides(b);
      const side = sides.length === 2 ? y >= (b.y + b.bottom) / 2 ? 'bid' : 'ask' : sides[0];
      if (!side) return null;
      return { bin: b, side, mode: this.options.mode };
    }
    return null;
  }
  hitTest(x: number, y: number) { const h = this.hoverAt(x, y); return h ? { externalId: 'orderbook-heatmap', hoverKey: `${h.bin.start}:${h.bin.low}:${h.side}`, zOrder: 'bottom' as const, distance: 0 } : null; }
}

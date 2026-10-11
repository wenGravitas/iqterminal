import type { PrimitiveRenderContext, PrimitiveHost } from 'openalgo-charts';
import { Footprint, compactVol, type FootprintBar, type FootprintOptions, type FootprintHover } from 'openalgo-charts/profile';

/** Presentation wrapper for pinned OpenAlgo 2.6.0, using its public drawing boundary. */
export function footprintColumn(options: FootprintOptions, spacing: number) {
  const column = Math.max(.1, Math.min(options.cellWidth ?? spacing * options.widthFactor, spacing * .96));
  const gap = options.showCandle && options.displayMode === 'bidask' && column >= 32
    ? Math.min(24, Math.max(12, column * .12)) : 0;
  return { column, gap, cells: column - gap };
}
export class TerminalFootprint extends Footprint {
  private style: FootprintOptions;
  private rowSize = 0;
  private longest = 1;
  private opacity = .85;
  cellFont = 9;
  private dpr = 1;
  private bars: readonly FootprintBar[] = [];
  private rc?: PrimitiveRenderContext;
  override detached() { super.detached(); this.rc = undefined; this.bars = []; this.centres = []; this.gap = 0; }
  private gap = 0;
  private renderWidth = -1;
  private statsHeight = 15;
  private configuringDraw = false;
  override attached(host: PrimitiveHost) {
    super.attached({ ...host, requestUpdate: () => { if (!this.configuringDraw) host.requestUpdate(); } });
  }
  private centres: number[] = [];
  private cellText = false;
  private valueAreaPath = false;
  private shiftedX(x: number) {
    const centre = this.centres.find(c => Math.abs(x / this.dpr - c) <= this.renderWidth / 2 + 1);
    return centre === undefined ? x : x + (x / this.dpr < centre ? -this.gap / 2 : this.gap / 2) * this.dpr;
  }
  private readonly contexts = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();
  constructor(options: FootprintOptions) { super({ ...options, showCandle: false }); this.style = { ...options }; this.statsHeight = options.statsRowHeight; }
  setCellOpacity(opacity: number) { this.opacity = Math.max(0, Math.min(1, opacity)); }
  override options() { return { ...this.style, statsRowHeight: this.statsHeight, statsRows: [...this.style.statsRows], tableRows: [...this.style.tableRows] }; }
  override setOptions(options: Partial<FootprintOptions>) {
    this.style = { ...this.style, ...options }; this.renderWidth = -1;
    super.setOptions({ ...options, showCandle: false });
  }
  override setBars(bars: readonly FootprintBar[]) {
    this.bars = bars;
    this.rowSize = bars[0]?.rowSize ?? 0;
    this.longest = 1;
    for (const bar of bars) for (const cell of bar.cells) {
      for (const value of [cell.bidVol, cell.askVol, cell.bidVol + cell.askVol, cell.askVol - cell.bidVol]) {
        this.longest = Math.max(this.longest, compactVol(value / this.style.volumeDivisor).length);
      }
    }
    super.setBars(bars);
  }
  override draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.dpr = rc.dpr;
    this.valueAreaPath = false;
    const o = this.style, spacing = rc.timeScale.barSpacing;
    const geometry = footprintColumn(o, spacing);
    this.rc = rc; this.gap = geometry.gap;
    const rows = o.tableRows.length || (o.statsPosition === 'bottom' ? o.statsRows.length : 0);
    const statsHeight = rows ? Math.min(o.statsRowHeight, Math.max(8, Math.floor(rc.plotHeight * .4 / rows))) : o.statsRowHeight;
    if (this.renderWidth !== geometry.cells || this.statsHeight !== statsHeight) {
      this.statsHeight = statsHeight;
      this.renderWidth = geometry.cells;
      this.configuringDraw = true;
      try { super.setOptions({ cellWidth: geometry.cells, showCandle: o.displayMode !== 'bidask' && o.showCandle, statsRowHeight: statsHeight }); }
      finally { this.configuringDraw = false; }
    }
    this.centres = this.bars.flatMap(bar => {
      const i = rc.dataLayer.timeToIndex(bar.time);
      return i === undefined ? [] : [rc.timeScale.indexToX(i)];
    });
    const width = geometry.cells / (o.displayMode === 'bidask' ? 2 : 1);
    const step = o.tickSize ?? this.rowSize, range = rc.priceScale.priceRange();
    const height = Math.abs(rc.priceScale.priceToY(range.min + step) - rc.priceScale.priceToY(range.min));
    this.cellFont = Math.max(9, Math.min(24, height * .75, (width - 6) / (this.longest * .62)));
    let proxy = this.contexts.get(ctx);
    if (!proxy) {
      // In 2.6.0 cell backgrounds use path fill; candle/stats use fillRect.
      // Forward native methods with their real receiver; only cell font and fill opacity change.
      const methods = new Map<PropertyKey, unknown>();
      proxy = new Proxy(ctx, {
        set: (target, key, value) => {
          if (key === 'strokeStyle') this.valueAreaPath = this.style.showValueArea && value === this.style.valueAreaColor;
          this.cellText = key === 'font' ? value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace` : this.cellText;
          if (key === 'font' && value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`) {
            value = `600 ${this.cellFont * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          }
          return Reflect.set(target, key, value, target);
        },
        get: (target, key) => {
          if (key === 'moveTo' || key === 'lineTo' || key === 'stroke') {
            if (!methods.has(key)) methods.set(key, (...args: any[]) => {
              if (this.valueAreaPath) {
                if (key === 'stroke') {
                  target.save(); target.setLineDash([this.dpr, 3 * this.dpr]);
                  try { return (target.stroke as Function).apply(target, args); } finally { target.restore(); }
                }
                if (this.gap) args[0] = this.shiftedX(args[0]);
              }
              return (target[key] as Function).apply(target, args);
            });
            return methods.get(key);
          }
          if (key === 'roundRect' || key === 'fillText' || key === 'fillRect' || key === 'strokeRect') {
            if (!methods.has(key)) methods.set(key, (...args: any[]) => {
              const poc = key === 'strokeRect' && Math.abs(args[2] / this.dpr - this.renderWidth) < .01;
              if (this.gap && (key === 'roundRect' ? args[2] <= this.renderWidth * this.dpr / 2 : poc || this.cellText)) {
                const index = key === 'fillText' ? 1 : 0;
                // Rectangles identify their side by their centre, text by its anchor.
                if (key === 'strokeRect' && Math.abs(args[2] / this.dpr - this.renderWidth) < .01) {
                  args[0] -= this.gap * this.dpr / 2; args[2] += this.gap * this.dpr;
                } else {
                  const anchor = args[index] + (key === 'fillText' ? 0 : args[2] / 2);
                  args[index] += this.shiftedX(anchor) - anchor;
                }
              }
              if (poc) {
                target.save(); target.setLineDash([]);
                target.strokeStyle = '#ffffff';
                target.lineWidth = Math.min(this.dpr, args[3] / 3, args[2] / 3);
                try { return (target[key] as Function).apply(target, args); } finally { target.restore(); }
              }
              return (target[key] as Function).apply(target, args);
            });
            return methods.get(key);
          }
          if (key === 'fill') {
            if (!methods.has(key)) methods.set(key, (...args: Parameters<CanvasRenderingContext2D['fill']>) => {
              const alpha = target.globalAlpha;
              target.globalAlpha = alpha * this.opacity;
              try { target.fill(...args); } finally { target.globalAlpha = alpha; }
            });
            return methods.get(key);
          }
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          if (!methods.has(key)) methods.set(key, value.bind(target));
          return methods.get(key);
        },
      });
      this.contexts.set(ctx, proxy);
    }
    super.draw(proxy, rc);
    if (this.bars.length && o.showCandle && o.displayMode === 'bidask' && this.gap) this.drawCandles(ctx, rc);
  }
  private drawCandles(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const o = this.style, dpr = rc.dpr;
    const rows = o.tableRows.length || (o.statsPosition === 'bottom' ? o.statsRows.length : 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, Math.max(0, rc.plotHeight - rows * this.statsHeight) * dpr); ctx.clip();
    for (const bar of this.bars) {
      const index = rc.dataLayer.timeToIndex(bar.time);
      if (index === undefined || bar.open === undefined || bar.close === undefined || bar.high === undefined || bar.low === undefined) continue;
      const x = rc.timeScale.indexToX(index);
      if (x < 0 || x > rc.plotWidth) continue;
      const centre = this.gap ? x : x - footprintColumn(o, rc.timeScale.barSpacing).column / 2 - 3;
      const bodyWidth = Math.min(8, Math.max(2, (this.gap || 8) * .4));
      const high = rc.priceScale.priceToY(bar.high), low = rc.priceScale.priceToY(bar.low);
      const open = rc.priceScale.priceToY(bar.open), close = rc.priceScale.priceToY(bar.close);
      ctx.fillStyle = bar.close >= bar.open ? o.buyColor ?? rc.theme.upColor : o.sellColor ?? rc.theme.downColor;
      ctx.fillRect((centre - .5) * dpr, Math.min(high, low) * dpr, dpr, Math.max(dpr, Math.abs(low - high) * dpr));
      ctx.fillRect((centre - bodyWidth / 2) * dpr, Math.min(open, close) * dpr, bodyWidth * dpr, Math.max(dpr, Math.abs(close - open) * dpr));
    }
    ctx.restore();
  }
  override hoverAt(x: number, y: number, rc?: PrimitiveRenderContext): FootprintHover | null {
    const context = rc ?? this.rc;
    if (!context || !this.gap) return super.hoverAt(x, y, rc);
    const rows = this.style.tableRows.length || (this.style.statsPosition === 'bottom' ? this.style.statsRows.length : 0);
    if (y >= context.plotHeight - rows * this.statsHeight) return super.hoverAt(x, y, context);
    const centre = this.centres.find(c => Math.abs(x - c) <= (this.renderWidth + this.gap) / 2);
    if (centre === undefined || Math.abs(x - centre) < this.gap / 2) return null;
    return super.hoverAt(x + (x < centre ? this.gap / 2 : -this.gap / 2), y, context);
  }
}

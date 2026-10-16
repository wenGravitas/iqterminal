import type { PrimitiveRenderContext, PrimitiveHost } from 'openalgo-charts';
import { Footprint, compactVol, type FootprintBar, type FootprintOptions, type FootprintHover } from 'openalgo-charts/profile';

/** Presentation wrapper for pinned OpenAlgo 2.6.0, using its public drawing boundary. */
export function footprintColumn(options: Pick<FootprintOptions, 'cellWidth' | 'widthFactor' | 'showCandle'> & Partial<Pick<FootprintOptions, 'displayMode' | 'statsPosition'>>, spacing: number) {
  const annotation = options.statsPosition === 'bar' && spacing >= 140 ? Math.min(84, spacing * .42) : 0;
  const column = Math.max(.1, Math.min(options.cellWidth ?? spacing * options.widthFactor, spacing * .96, annotation ? spacing - annotation - 12 : Infinity));
  const gap = options.showCandle && options.displayMode === 'bidask' && column >= 32
    ? Math.min(24, Math.max(12, column * .12)) : 0;
  return { column, gap, cells: column - gap, annotation };
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
      try { super.setOptions({ cellWidth: geometry.cells, showCandle: false, statsRowHeight: statsHeight, statsRows: o.statsPosition === 'bar' ? [] : o.statsRows }); }
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
                  target.strokeStyle = '#ffffff'; target.globalAlpha = 1; target.lineWidth = this.dpr;
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
              // 2.6.0 erases the profile beneath text that exceeds its proportional
              // bar width. Our enlarged font makes that plate hide smaller bars.
              // Retain the quantity text without masking the measured profile.
              if (key === 'fillRect' && this.cellText && this.style.cellStyle === 'profile'
                && target.fillStyle === this.rc?.theme.background) return;
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
                // Match the quiet one-pixel dotted VAH/VAL reference lines.
                target.save(); target.setLineDash([this.dpr, 3 * this.dpr]);
                target.strokeStyle = '#ffffff'; target.globalAlpha = 1;
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
    if (o.statsPosition === 'bar') this.drawBarTotals(ctx, rc);
    if (this.bars.length && o.showCandle) this.drawCandles(ctx, rc);
  }
  /** Totals use the inter-column gutter, leaving the heatmap beneath each bar unobstructed. */
  private drawBarTotals(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const o = this.style, spacing = rc.timeScale.barSpacing;
    const { column, annotation } = footprintColumn(o, spacing);
    if (!annotation) return;
    const dpr = rc.dpr, font = Math.min(12, Math.max(9, annotation / 7)), lineHeight = font + 2;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth*dpr, rc.plotHeight*dpr); ctx.clip();
    ctx.font = `${font*dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const stats = this.stats();
    for (let n = 0; n < this.bars.length; n++) {
      const bar = this.bars[n], totals = stats[n];
      const index = rc.dataLayer.timeToIndex(bar.time);
      if (index === undefined || !totals || !bar.cells.length) continue;
      const centre = rc.timeScale.indexToX(index), x = centre + column / 2 + 6;
      const right = Math.min(rc.plotWidth, centre + spacing - column / 2 - 6);
      if (x < 0 || x >= right) continue;
      let bottom = -Infinity;
      for (const cell of bar.cells) bottom = Math.max(bottom, rc.priceScale.priceToY(cell.price - (o.tickSize ?? bar.rowSize ?? 0) / 2));
      if (o.showCandle && bar.low !== undefined) bottom = Math.max(bottom, rc.priceScale.priceToY(bar.low));
      if (bottom < 2*lineHeight || bottom > rc.plotHeight) continue;
      const volume = `V: ${compactVol(totals.volume / o.volumeDivisor)}`;
      const delta = `Δ: ${totals.delta >= 0 ? '+' : ''}${compactVol(totals.delta / o.volumeDivisor)}`;
      if (Math.max(ctx.measureText(volume).width, ctx.measureText(delta).width) > (right-x)*dpr) continue;
      ctx.fillStyle = o.textColor ?? rc.theme.axisText;
      ctx.fillText(volume, x*dpr, (bottom - 1.5*lineHeight)*dpr);
      ctx.fillStyle = totals.delta === 0 ? o.textColor ?? rc.theme.axisText : totals.delta > 0 ? o.buyTextColor ?? rc.theme.upColor : o.sellTextColor ?? rc.theme.downColor;
      ctx.fillText(delta, x*dpr, (bottom - .5*lineHeight)*dpr);
    }
    ctx.restore();
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
      const centre = this.gap ? x : x - footprintColumn(o, rc.timeScale.barSpacing).column / 2 - 6;
      const bodyWidth = Math.min(8, Math.max(2, this.gap ? this.gap * .4 : rc.timeScale.barSpacing * .06));
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

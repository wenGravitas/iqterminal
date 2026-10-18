import type { PrimitiveRenderContext, PrimitiveHost } from 'openalgo-charts';
import { Footprint, compactVol, type FootprintBar, type FootprintOptions, type FootprintHover } from 'openalgo-charts/profile';

const PROFILE_LEVEL_EXTENSION = 8;
const FOOTPRINT_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace';

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
  cellFont = 10;
  private cellFontPx = 10;
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
  private pixelStrokeWidth() { return Math.max(1, Math.round(this.dpr)); }
  private alignStroke(value: number) {
    return Math.round(value) + (this.pixelStrokeWidth() % 2 ? .5 : 0);
  }
  private alignCellRect(args: any[]) {
    const top = Math.round(args[1]);
    const bottom = Math.max(top + 1, Math.round(args[1] + args[3]));
    args[1] = top; args[3] = bottom - top;
    // Profile widths encode volume, so only ladder cells can be snapped horizontally.
    if (this.style.cellStyle !== 'profile') {
      const left = Math.round(args[0]), right = Math.max(left + 1, Math.round(args[0] + args[2]));
      args[0] = left; args[2] = right - left;
    }
    if (typeof args[4] === 'number') args[4] = Math.round(args[4]);
  }
  private themeIsLight() {
    const background = this.rc?.theme.background.match(/^#([\da-f]{6})$/i)?.[1];
    if (!background) return false;
    const channel = (offset: number) => parseInt(background.slice(offset, offset + 2), 16) / 255;
    const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    const luminance = .2126 * linear(channel(0)) + .7152 * linear(channel(2)) + .0722 * linear(channel(4));
    return luminance > .5;
  }
  private guideColor() { return this.themeIsLight() ? this.rc?.theme.axisText ?? '#485567' : '#ffffff'; }
  /** Reserve the terminal's pale cyan accent for the single POC reference. */
  private pocAccentColor() { return this.themeIsLight() ? '#006a73' : '#68c6d2'; }
  private shiftedX(x: number) {
    const centre = this.centres.find(c => Math.abs(x / this.dpr - c) <= this.renderWidth / 2 + 1);
    return centre === undefined ? x : x + (x / this.dpr < centre ? -this.gap / 2 : this.gap / 2) * this.dpr;
  }
  private extendProfileLevel(x: number, side: 'left' | 'right') {
    const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
    const endpoint = x + (side === 'left' ? -1 : 1) * PROFILE_LEVEL_EXTENSION * this.dpr;
    return Math.max(0, Math.min(edge, endpoint));
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
    const fittedFont = Math.max(9, Math.min(24, height * .75, (width - 4) / (this.longest * .6)));
    const minDeviceFont = Math.ceil(9 * this.dpr), maxDeviceFont = Math.floor(24 * this.dpr);
    this.cellFontPx = Math.min(maxDeviceFont, Math.max(minDeviceFont, Math.floor(fittedFont * this.dpr)));
    this.cellFont = this.cellFontPx / this.dpr;
    let proxy = this.contexts.get(ctx);
    if (!proxy) {
      // Keep renderer-specific presentation corrections at the footprint boundary.
      // Canvas methods need their real receiver or the native context rejects the call.
      const methods = new Map<PropertyKey, unknown>();
      proxy = new Proxy(ctx, {
        set: (target, key, value) => {
          if (key === 'strokeStyle') this.valueAreaPath = this.style.showValueArea && value === this.style.valueAreaColor;
          this.cellText = key === 'font' ? value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace` : this.cellText;
          if (key === 'font' && value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`) {
            value = `600 ${this.cellFontPx}px ${FOOTPRINT_FONT_FAMILY}`;
          }
          return Reflect.set(target, key, value, target);
        },
        get: (target, key) => {
          if (key === 'moveTo' || key === 'lineTo' || key === 'stroke') {
            if (!methods.has(key)) methods.set(key, (...args: any[]) => {
              if (this.valueAreaPath) {
                if (key === 'stroke') {
                  const dash = this.pixelStrokeWidth();
                  target.save(); target.setLineDash([dash, dash * 3]);
                  target.strokeStyle = this.guideColor(); target.globalAlpha = 1; target.lineWidth = dash;
                  try { return (target.stroke as Function).apply(target, args); } finally { target.restore(); }
                }
                if (this.gap) args[0] = this.shiftedX(args[0]);
                args[0] = this.alignStroke(this.extendProfileLevel(args[0], key === 'moveTo' ? 'left' : 'right'));
                args[1] = this.alignStroke(args[1]);
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
              if (key === 'roundRect') this.alignCellRect(args);
              if (key === 'fillText' && this.cellText) { args[1] = Math.round(args[1]); args[2] = Math.round(args[2]); }
              if (poc) {
                const left = this.extendProfileLevel(args[0], 'left');
                const right = this.extendProfileLevel(args[0] + args[2], 'right');
                args[0] = this.alignStroke(left); args[2] = Math.max(0, this.alignStroke(right) - args[0]);
                const top = this.alignStroke(args[1]), bottom = this.alignStroke(args[1] + args[3]);
                args[1] = top; args[3] = Math.max(1, bottom - top);
                target.save(); target.setLineDash([]);
                target.strokeStyle = this.pocAccentColor(); target.globalAlpha = 1;
                target.lineWidth = Math.max(1, Math.min(this.pixelStrokeWidth(), Math.floor(args[3]), Math.floor(args[2])));
                try { return (target[key] as Function).apply(target, args); } finally { target.restore(); }
              }
              if (key === 'fillText' && this.cellText && !this.style.textColor && typeof target.fillStyle === 'string') {
                // The profile renderer fades low-volume text with the cells.
                // Keep its theme/mode-derived hue, while drawing quantities at
                // full opacity so they remain legible on dark heatmap fills.
                const textColor = target.fillStyle;
                target.fillStyle = opaqueTextColor(textColor);
                try { return (target[key] as Function).apply(target, args); } finally { target.fillStyle = textColor; }
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
    const dpr = rc.dpr, font = Math.min(12, Math.max(9, annotation / 7));
    const physicalFont = Math.max(1, Math.round(font * dpr)), snappedFont = physicalFont / dpr, lineHeight = snappedFont + 2;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth*dpr, rc.plotHeight*dpr); ctx.clip();
    ctx.font = `${physicalFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
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
      ctx.fillText(volume, Math.round(x*dpr), Math.round((bottom - 1.5*lineHeight)*dpr));
      ctx.fillStyle = totals.delta === 0 ? o.textColor ?? rc.theme.axisText : totals.delta > 0 ? o.buyTextColor ?? rc.theme.upColor : o.sellTextColor ?? rc.theme.downColor;
      ctx.fillText(delta, Math.round(x*dpr), Math.round((bottom - .5*lineHeight)*dpr));
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
      const wickWidth = Math.max(1, Math.round(dpr));
      const wickLeft = Math.round((centre - .5) * dpr);
      const wickTop = Math.round(Math.min(high, low) * dpr), wickBottom = Math.round(Math.max(high, low) * dpr);
      const bodyLeft = Math.round((centre - bodyWidth / 2) * dpr), bodyRight = Math.round((centre + bodyWidth / 2) * dpr);
      const bodyTop = Math.round(Math.min(open, close) * dpr), bodyBottom = Math.round(Math.max(open, close) * dpr);
      ctx.fillRect(wickLeft, wickTop, wickWidth, Math.max(wickWidth, wickBottom - wickTop));
      ctx.fillRect(bodyLeft, bodyTop, Math.max(1, bodyRight - bodyLeft), Math.max(wickWidth, bodyBottom - bodyTop));
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

function opaqueTextColor(color: string) {
  const rgba = /^rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*[^)]+\)$/i.exec(color);
  return rgba ? `rgb(${rgba[1]!.trim()}, ${rgba[2]!.trim()}, ${rgba[3]!.trim()})` : color;
}

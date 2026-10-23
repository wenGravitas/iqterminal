import type { PrimitiveRenderContext, PrimitiveHost } from 'openalgo-charts';
import { Footprint, compactVol, type FootprintBar, type FootprintOptions, type FootprintHover } from 'openalgo-charts/profile';

const PROFILE_LEVEL_EXTENSION = 8;
const POC_MARKER_CELL_GAP = 2;
const FOOTPRINT_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace';
const FOOTPRINT_LEVEL_COLOR = '#6d3fa0';
type RgbColor = { r: number; g: number; b: number; a: number };
type PaintedCell = { x: number; y: number; width: number; height: number; background: RgbColor };
type QuantityTextStyle = { color: string; alpha: number; outline?: string };
type BarTotalLabel = {
  side: 'left' | 'right';
  value: string;
  x: number;
  y: number;
  width: number;
  color: string;
  visible: boolean;
};

/** Presentation wrapper for pinned OpenAlgo 2.6.0, using its public drawing boundary. */
export function footprintColumn(options: Pick<FootprintOptions, 'cellWidth' | 'widthFactor' | 'showCandle'> & Partial<Pick<FootprintOptions, 'displayMode' | 'statsPosition'>>, spacing: number) {
  // Per-bar totals sit on both sides of the POC marker, so reserve symmetric slots.
  const annotation = options.statsPosition === 'bar' && spacing >= 140 ? Math.min(42, spacing * .21) : 0;
  const column = Math.max(.1, Math.min(options.cellWidth ?? spacing * options.widthFactor, spacing * .96, annotation ? spacing - annotation * 2 - 12 : Infinity));
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
  private pendingCellRect: [number, number, number, number] | null = null;
  private cellHeightPx = 0;
  private previousCellPaint: PaintedCell | null = null;
  private lastCellPaint: PaintedCell | null = null;
  private pocMarkerBounds = new Map<number, [number, number]>();
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
  private levelGuideColor() { return FOOTPRINT_LEVEL_COLOR; }
  private alignedPocBounds(left: number, right: number): [number, number] {
    const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
    left = Math.max(0, Math.min(edge, left));
    right = Math.max(0, Math.min(edge, right));
    // POC marks use a two-pixel stroke (per DPR); align their centerline for
    // that stroke width so the requested fill-to-ink gap stays even.
    const markerWidth = this.pixelStrokeWidth() * 2;
    const alignMarker = (value: number) => Math.round(value) + (markerWidth % 2 ? .5 : 0);
    return [alignMarker(left), alignMarker(right)];
  }
  private pocHorizontalBounds(left: number, right: number, centreY: number): [number, number] {
    // Share the VAH/VAL endpoint geometry, including gutter, extension,
    // clipping and backing-pixel alignment, rather than the proportional fills.
    if (this.style.showValueArea) return [
      this.alignStroke(this.extendProfileLevel(left, 'left')),
      this.alignStroke(this.extendProfileLevel(right, 'right')),
    ];
    const tolerance = Math.max(1, this.dpr);
    const rowCells = [this.previousCellPaint, this.lastCellPaint].filter((cell): cell is PaintedCell => !!cell
      && Math.abs(cell.y + cell.height / 2 - centreY) <= tolerance
      && cell.x >= left - tolerance && cell.x + cell.width <= right + tolerance);
    const actualLeft = rowCells.length ? Math.min(...rowCells.map(cell => cell.x)) : left;
    const actualRight = rowCells.length ? Math.max(...rowCells.map(cell => cell.x + cell.width)) : right;
    // Keep a two-CSS-pixel clear gap from the painted POC bars. Marker stroke
    // width is twice pixelStrokeWidth(), so include its half-width before alignment.
    const offset = POC_MARKER_CELL_GAP * this.dpr + this.pixelStrokeWidth();
    return this.alignedPocBounds(actualLeft - offset, actualRight + offset);
  }
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
    this.pendingCellRect = null;
    this.previousCellPaint = null;
    this.lastCellPaint = null;
    this.pocMarkerBounds.clear();
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
    this.cellHeightPx = height * this.dpr;
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
                  target.save(); target.setLineDash([dash * 3, dash * 2]);
                  target.strokeStyle = this.levelGuideColor(); target.globalAlpha = 1; target.lineWidth = dash * 2;
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
              if (key === 'roundRect') {
                this.alignCellRect(args);
                this.pendingCellRect = this.isCellBackground([args[0], args[1], args[2], args[3]])
                  ? [args[0], args[1], args[2], args[3]] : null;
              }
              if (key === 'fillRect' && this.cellText) {
                this.rememberCellPaint([args[0], args[1], args[2], args[3]], target.fillStyle, target.globalAlpha);
              }
              if (key === 'fillText' && this.cellText) { args[1] = Math.round(args[1]); args[2] = Math.round(args[2]); }
              if (poc) {
                const rawLeft = args[0], rawRight = args[0] + args[2];
                const centreY = args[1] + args[3] / 2;
                const [left, right] = this.pocHorizontalBounds(rawLeft, rawRight, centreY);
                this.pocMarkerBounds.set(Math.round((rawLeft + rawRight) / 2), [left, right]);
                args[0] = left; args[2] = Math.max(0, right - args[0]);
                const top = this.alignStroke(args[1]), bottom = this.alignStroke(args[1] + args[3]);
                args[1] = top; args[3] = Math.max(1, bottom - top);
                const rightEdge = args[0] + args[2], bottomEdge = args[1] + args[3];
                const dash = this.pixelStrokeWidth();
                target.save(); target.setLineDash([dash * 3, dash * 2]);
                target.strokeStyle = this.levelGuideColor(); target.globalAlpha = 1;
                target.lineWidth = dash * 2;
                try {
                  // Use an isolated path so POC paint cannot replace the native VA path.
                  const marker = new Path2D();
                  marker.moveTo(args[0], top); marker.lineTo(args[0], bottomEdge);
                  marker.moveTo(rightEdge, top); marker.lineTo(rightEdge, bottomEdge);
                  return target.stroke(marker);
                } finally { target.restore(); }
              }
              if (key === 'fillText' && this.cellText && typeof target.fillStyle === 'string') {
                const textColor = target.fillStyle;
                const textAlpha = target.globalAlpha;
                const backgrounds = this.cellTextBackgrounds(args, target);
                const adjusted = readableTextColor(textColor, backgrounds, textAlpha, !this.style.textColor);
                // OpenAlgo uses rgba alpha to fade quantities along with cell
                // intensity. Keep the hue when it has enough contrast, but make
                // default quantities fully opaque; use a neutral only when the
                // resulting foreground would be hard to read on its cell fill.
                target.fillStyle = adjusted?.color ?? opaqueTextColor(textColor);
                if (adjusted) target.globalAlpha = adjusted.alpha;
                try {
                  if (adjusted?.outline) {
                    target.save();
                    try {
                      target.strokeStyle = adjusted.outline;
                      target.lineWidth = this.pixelStrokeWidth();
                      target.lineJoin = 'round';
                      target.setLineDash([]);
                      target.shadowBlur = 0; target.shadowOffsetX = 0; target.shadowOffsetY = 0;
                      target.shadowColor = 'rgba(0,0,0,0)';
                      if (typeof args[3] === 'number') target.strokeText(String(args[0]), args[1], args[2], args[3]);
                      else target.strokeText(String(args[0]), args[1], args[2]);
                    } finally { target.restore(); }
                  }
                  return (target[key] as Function).apply(target, args);
                }
                finally {
                  target.fillStyle = textColor; target.globalAlpha = textAlpha;
                }
              }
              return (target[key] as Function).apply(target, args);
            });
            return methods.get(key);
          }
          if (key === 'fill') {
            if (!methods.has(key)) methods.set(key, (...args: Parameters<CanvasRenderingContext2D['fill']>) => {
              const alpha = target.globalAlpha;
              const cellBackground = this.pendingCellRect !== null;
              if (cellBackground) {
                this.rememberCellPaint(this.pendingCellRect!, target.fillStyle, alpha * this.opacity);
              }
              this.pendingCellRect = null;
              if (cellBackground) target.globalAlpha = alpha * this.opacity;
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
  private rememberCellPaint(rect: [number, number, number, number], fillStyle: unknown, alpha: number) {
    if (typeof fillStyle !== 'string') return;
    const fill = parseRgbColor(fillStyle), base = parseRgbColor(this.rc?.theme.background ?? '');
    if (!fill || !base) return;
    const opacity = Math.max(0, Math.min(1, alpha * fill.a));
    this.previousCellPaint = this.lastCellPaint;
    this.lastCellPaint = {
      x: rect[0], y: rect[1], width: rect[2], height: rect[3],
      background: compositeColor(fill, base, opacity),
    };
  }
  private isCellBackground(rect: [number, number, number, number]) {
    const [x, y, width, height] = rect, rc = this.rc;
    const rows = this.style.tableRows.length || (this.style.statsPosition === 'bottom' ? this.style.statsRows.length : 0);
    const contentHeight = rc ? Math.max(0, rc.plotHeight - rows * this.statsHeight) * this.dpr : 0;
    if (!rc || this.cellHeightPx <= 0
      || Math.abs(height - this.cellHeightPx) > Math.max(2, this.dpr)
      || width <= 0 || width > this.renderWidth * this.dpr + 1
      || y + height <= 0 || y >= contentHeight) return false;
    const halfBar = (this.renderWidth + this.gap) * this.dpr / 2 + 1;
    return this.centres.some(centre => x >= centre * this.dpr - halfBar
      && x + width <= centre * this.dpr + halfBar);
  }
  private cellTextBackgrounds(args: any[], target: CanvasRenderingContext2D) {
    const cell = this.lastCellPaint, themeBackground = parseRgbColor(this.rc?.theme.background ?? '');
    const backgrounds = themeBackground ? [themeBackground] : [];
    if (!cell) return backgrounds;
    const width = target.measureText(String(args[0])).width;
    const anchor = args[1];
    const left = target.textAlign === 'center' ? anchor - width / 2 : target.textAlign === 'right' || target.textAlign === 'end' ? anchor - width : anchor;
    const right = left + width;
    const outlinePad = this.pixelStrokeWidth() / 2;
    const textTop = args[2] - this.cellFontPx / 2 - outlinePad, textBottom = args[2] + this.cellFontPx / 2 + outlinePad;
    const intersects = right > cell.x && left < cell.x + cell.width
      && textBottom > cell.y && textTop < cell.y + cell.height;
    if (!intersects) return backgrounds;
    const entirelyInside = left - outlinePad >= cell.x && right + outlinePad <= cell.x + cell.width
      && textTop >= cell.y && textBottom <= cell.y + cell.height;
    if (entirelyInside) return [cell.background];
    if (!backgrounds.some(background => background.r === cell.background.r && background.g === cell.background.g && background.b === cell.background.b)) {
      backgrounds.push(cell.background);
    }
    return backgrounds;
  }
  /** Native per-bar totals use the complete gap to each neighbouring histogram. */
  private drawBarTotals(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const o = this.style, spacing = rc.timeScale.barSpacing;
    const { column, annotation } = footprintColumn(o, spacing);
    if (!annotation) return;
    const dpr = rc.dpr, physicalFont = Math.max(1, Math.round(9 * dpr));
    const markerOffset = o.showPoc && o.pocStyle === 'outline' ? POC_MARKER_CELL_GAP + this.pixelStrokeWidth() / dpr : 0;
    // Keep the flank text outside the marker ink by at least two CSS pixels.
    const gap = Math.max(3, 4 - markerOffset);
    const footerRows = o.tableRows.length ? o.tableRows.length : 0;
    const contentHeight = Math.max(0, rc.plotHeight - footerRows * this.statsHeight);
    const background = parseRgbColor(rc.theme.background);
    const neutralColor = o.textColor ?? rc.theme.axisText;
    const stats = this.stats();
    const centres = this.bars.map(bar => {
      const index = rc.dataLayer.timeToIndex(bar.time);
      return index === undefined ? undefined : rc.timeScale.indexToX(index);
    });
    const labels: BarTotalLabel[] = [];
    const leftLabels: (BarTotalLabel | undefined)[] = [];
    const rightLabels: (BarTotalLabel | undefined)[] = [];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, contentHeight * dpr); ctx.clip();
    ctx.font = `${physicalFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle'; ctx.globalAlpha = 1;
    for (let n = 0; n < this.bars.length; n++) {
      const bar = this.bars[n], totals = stats[n];
      const index = rc.dataLayer.timeToIndex(bar.time);
      if (index === undefined || !totals || !bar.cells.length) continue;
      const centre = rc.timeScale.indexToX(index), y = Math.round(rc.priceScale.priceToY(totals.poc) * dpr);
      if (!Number.isFinite(y) || y < 0 || y > contentHeight * dpr) continue;
      const marks = this.pocMarkerBounds.get(Math.round(centre * dpr));
      const [leftMark, rightMark] = marks ?? this.alignedPocBounds((centre - column / 2) * dpr, (centre + column / 2) * dpr);
      const previousCentre = centres[n - 1], nextCentre = centres[n + 1];
      const leftSlot = Math.max(0, previousCentre === undefined ? 0 : previousCentre + column / 2);
      const rightSlot = Math.min(rc.plotWidth, nextCentre === undefined ? rc.plotWidth : nextCentre - column / 2);
      const leftX = Math.round((leftMark / dpr - gap) * dpr), rightX = Math.round((rightMark / dpr + gap) * dpr);
      const leftAvailable = Math.max(0, leftMark / dpr - gap - leftSlot) * dpr;
      const rightAvailable = Math.max(0, rightSlot - rightMark / dpr - gap) * dpr;
      const volume = compactVol(totals.volume / o.volumeDivisor);
      const delta = `${totals.delta >= 0 ? '+' : ''}${compactVol(totals.delta / o.volumeDivisor)}`;
      const volumeWidth = ctx.measureText(volume).width, deltaWidth = ctx.measureText(delta).width;
      const deltaColor = totals.delta === 0 ? neutralColor
        : totals.delta > 0 ? o.buyTextColor ?? rc.theme.upColor : o.sellTextColor ?? rc.theme.downColor;
      if (volumeWidth <= leftAvailable) {
        const label = { side: 'left' as const, value: volume, x: leftX, y, width: volumeWidth, color: neutralColor, visible: true };
        labels.push(label); leftLabels[n] = label;
      }
      if (deltaWidth <= rightAvailable) {
        const label = { side: 'right' as const, value: delta, x: rightX, y, width: deltaWidth, color: deltaColor, visible: true };
        labels.push(label); rightLabels[n] = label;
      }
    }
    // Adjacent candles share the space between histograms. If opposite-side
    // labels really overlap in both axes, keep the shorter string and omit the
    // other rather than shifting either away from its native POC row.
    for (let n = 0; n + 1 < this.bars.length; n++) {
      const delta = rightLabels[n], volume = leftLabels[n + 1];
      if (!delta || !volume) continue;
      const horizontal = Math.max(delta.x, volume.x - volume.width) < Math.min(delta.x + delta.width, volume.x) - 1;
      const vertical = Math.abs(delta.y - volume.y) < physicalFont;
      if (!horizontal || !vertical) continue;
      if (delta.width <= volume.width) volume.visible = false;
      else delta.visible = false;
    }
    for (const label of labels) {
      if (!label.visible) continue;
      const readable = readableTextColor(label.color, background ? [background] : [], 1, true)
        ?? { color: opaqueTextColor(label.color), alpha: 1 };
      ctx.textAlign = label.side === 'left' ? 'right' : 'left';
      ctx.fillStyle = readable.color; ctx.globalAlpha = 1;
      if (readable.outline) {
        ctx.save();
        try {
          ctx.strokeStyle = readable.outline; ctx.lineWidth = this.pixelStrokeWidth();
          ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
          ctx.strokeText(label.value, label.x, label.y);
        } finally { ctx.restore(); }
      }
      ctx.fillText(label.value, label.x, label.y);
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

function parseRgbColor(color: string): RgbColor | null {
  const key = color.trim();
  if (RGB_COLOR_CACHE.has(key)) return RGB_COLOR_CACHE.get(key) ?? null;
  const parsed = parseRgbColorUncached(key);
  RGB_COLOR_CACHE.set(key, parsed);
  if (RGB_COLOR_CACHE.size > 64) RGB_COLOR_CACHE.delete(RGB_COLOR_CACHE.keys().next().value!);
  return parsed;
}

const RGB_COLOR_CACHE = new Map<string, RgbColor | null>();

function parseRgbColorUncached(color: string): RgbColor | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (hex) {
    const value = hex[1]!.length === 3 ? [...hex[1]!].map(channel => channel + channel).join('') : hex[1]!;
    return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16), a: 1 };
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (!match) return null;
  const parts = match[1]!.trim().split(/[\s,/]+/);
  if (parts.length < 3) return null;
  const channel = (part: string) => {
    const value = Number.parseFloat(part);
    return Number.isFinite(value) ? Math.max(0, Math.min(255, part.endsWith('%') ? value * 2.55 : value)) : NaN;
  };
  const r = channel(parts[0]!), g = channel(parts[1]!), b = channel(parts[2]!);
  const alphaValue = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, alphaValue].every(Number.isFinite)) return null;
  return { r, g, b, a: Math.max(0, Math.min(1, alphaValue)) };
}

function compositeColor(foreground: RgbColor, background: RgbColor, alpha: number): RgbColor {
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance(color: RgbColor) {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  };
  return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
}

function contrastRatio(first: RgbColor, second: RgbColor) {
  const a = relativeLuminance(first), b = relativeLuminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function readableTextColor(color: string, backgrounds: readonly RgbColor[], globalAlpha: number, forceOpaque: boolean): QuantityTextStyle | null {
  const foreground = parseRgbColor(color);
  if (!foreground) return null;
  const opaque = { ...foreground, a: 1 };
  const effectiveAlpha = Math.max(0, Math.min(1, globalAlpha * (forceOpaque ? 1 : foreground.a)));
  const visible = backgrounds.map(background => compositeColor(foreground, background, effectiveAlpha));
  if (visible.every((colorAtCell, index) => contrastRatio(colorAtCell, backgrounds[index]!) >= 4.5)) {
    return { color: forceOpaque ? `rgb(${Math.round(opaque.r)}, ${Math.round(opaque.g)}, ${Math.round(opaque.b)})` : color, alpha: globalAlpha };
  }
  const black = { r: 0, g: 0, b: 0, a: 1 }, white = { r: 255, g: 255, b: 255, a: 1 };
  const minimumContrast = (foreground: RgbColor) => backgrounds.length
    ? Math.min(...backgrounds.map(background => contrastRatio(foreground, background))) : 0;
  const whiteContrast = minimumContrast(white), blackContrast = minimumContrast(black);
  if (whiteContrast >= 4.5 || blackContrast >= 4.5) {
    return whiteContrast >= blackContrast
      ? { color: 'rgb(255, 255, 255)', alpha: 1 }
      : { color: 'rgb(0, 0, 0)', alpha: 1 };
  }
  // A profile bar can cross the text while the rest of its glyph sits over the
  // chart. When neither neutral reaches 4.5 on both surfaces, a one-pixel
  // opposite-color keyline preserves legibility without covering bar data.
  return whiteContrast >= blackContrast
    ? { color: 'rgb(255, 255, 255)', alpha: 1, outline: 'rgb(0, 0, 0)' }
    : { color: 'rgb(0, 0, 0)', alpha: 1, outline: 'rgb(255, 255, 255)' };
}

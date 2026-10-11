import { formatZonedDate, formatZonedTime, formatZonedTimeSeconds, resolveScaleStyle,
  type IPrimitive, type PrimitiveHost, type PrimitiveRenderContext } from 'openalgo-charts';

export interface GridLine { value: number; coordinate: number }
export interface GridGeometry { time: GridLine[]; price: GridLine[] }

/** OpenAlgo 2.6.0 axis tick selection, adapted to a public background primitive.
 * See /licenses/axis-grid-NOTICE.txt. UTC is the terminal's chart timezone.
 * No synthetic bars, independent scales, viewport writes or autoscale contribution.
 */
export function axisGridGeometry(rc: PrimitiveRenderContext, measure: (text: string) => number): GridGeometry {
  const { timeScale: time, dataLayer: data, plotWidth: width, plotHeight: height, dpr } = rc;
  const scale = rc.readoutPriceScale ?? rc.priceScale;
  const price = scale.scaled ? scale.ticks(Math.max(2, Math.min(30, Math.round(height / 32))))
    .map(value => ({ value, coordinate: Math.round(scale.priceToY(value) * dpr) / dpr }))
    .filter(t => t.coordinate >= 8 && t.coordinate <= height - 8) : [];
  const range = time.visibleRange(), first = Math.max(0, Math.floor(range.from)), last = Math.min(data.baseIndex, Math.ceil(range.to));
  if (last < first) return { time: [], price };
  const step = Math.max(1, Math.round(80 / Math.max(1, time.barSpacing)));
  const boundaries = new Set<number>();
  let previous = data.indexToTime(first), interval = Infinity, subMinute = Infinity;
  for (let i = first + 1; i <= last; i++) {
    const value = data.indexToTime(i);
    if (value !== undefined && previous !== undefined) {
      const difference = value - previous;
      if (difference > 0) {
        if (Math.floor(value / 60) !== Math.floor(previous / 60)) interval = Math.min(interval, difference);
        else subMinute = Math.min(subMinute, difference);
      }
      if (Math.floor(value / 86400) !== Math.floor(previous / 86400)) boundaries.add(i);
    }
    if (value !== undefined) previous = value;
  }
  const seconds = (Number.isFinite(interval) ? interval : subMinute) * step < 60;
  const indexes = new Set(boundaries);
  for (let i = first; i <= last; i += step) indexes.add(i);
  const candidates: (GridLine & { half: number; boundary: boolean })[] = [];
  previous = undefined;
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const value = data.indexToTime(index);
    if (value === undefined) continue;
    const x = Math.round(time.indexToX(index) * dpr) / dpr;
    if (x < 0 || x > width) { previous = value; continue; }
    const newDay = previous === undefined || Math.floor(value / 86400) !== Math.floor(previous / 86400);
    const label = newDay ? formatZonedDate(value, 'UTC') : seconds ? formatZonedTimeSeconds(value, 'UTC') : formatZonedTime(value, 'UTC');
    candidates.push({ value: index, coordinate: x, half: measure(label) / (2 * dpr), boundary: boundaries.has(index) });
    previous = value;
  }
  // Match the time axis' label collision rules: day boundaries take priority.
  const selected: typeof candidates = [];
  for (const boundary of [true, false]) for (const tick of candidates) {
    if (tick.boundary === boundary && selected.every(other => Math.abs(tick.coordinate - other.coordinate) >= tick.half + other.half + 4)) selected.push(tick);
  }
  return { time: selected.sort((a, b) => a.coordinate - b.coordinate).map(({ value, coordinate }) => ({ value, coordinate })), price };
}

export class AxisGrid implements IPrimitive {
  private host?: PrimitiveHost;
  private enabled = true;
  geometry: GridGeometry = { time: [], price: [] };
  zOrder() { return 'bottom' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.geometry = { time: [], price: [] }; }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) this.geometry = { time: [], price: [] }; this.host?.requestUpdate(); }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    if (!this.enabled) return;
    const dpr = rc.dpr;
    ctx.save();
    // Axis labels use the public resolved scale font, in device pixels.
    ctx.font = resolveScaleStyle(rc.theme, undefined).font.replace(/(\d+(?:\.\d+)?)px/, (_, size: string) => `${Number(size) * dpr}px`);
    this.geometry = axisGridGeometry(rc, label => ctx.measureText(label).width);
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    ctx.strokeStyle = rc.theme.grid; ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.setLineDash([]);
    const align = (coordinate: number) => Math.round(coordinate * dpr) + (ctx.lineWidth % 2 ? .5 : 0);
    ctx.beginPath();
    for (const tick of this.geometry.time) { const x = align(tick.coordinate); ctx.moveTo(x, 0); ctx.lineTo(x, rc.plotHeight * dpr); }
    for (const tick of this.geometry.price) { const y = align(tick.coordinate); ctx.moveTo(0, y); ctx.lineTo(rc.plotWidth * dpr, y); }
    ctx.stroke(); ctx.restore();
  }
}

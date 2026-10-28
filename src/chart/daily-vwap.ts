import { PriceLine } from 'openalgo-charts';
import type { Bar, IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { DailyVwapCalculation, dailyVwapSettings, type DailyVwapSettings } from '../indicators/daily-vwap';

export class DailyVwapPrimitive implements IPrimitive {
  private host?: PrimitiveHost;
  private calculation = new DailyVwapCalculation();
  private settings: DailyVwapSettings;
  private segments = 0;
  private gapLines = new Map<number, PriceLine>();
  private gapGeometry: { time: number; value: number; fromX: number; toX: number; y: number }[] = [];
  constructor(settings: DailyVwapSettings, private visibleTimeRange: () => { from: number; to: number }) { this.settings = settings; }
  zOrder() { return 'normal' as const; }
  autoscaleInfo() {
    const range = this.visibleTimeRange(); let min = Infinity, max = -Infinity;
    for (const point of this.calculation.points) {
      if (point.value === null || point.time < range.from || point.time > range.to) continue;
      const band = this.settings.bands ? point.deviation * this.settings.multiplier : 0;
      min = Math.min(min, point.value - band); max = Math.max(max, point.value + band);
    }
    if (this.settings.nakedGaps) for (const gap of this.calculation.nakedGaps) {
      if (gap.availableAt > range.to) continue;
      min = Math.min(min, gap.value); max = Math.max(max, gap.value);
    }
    return Number.isFinite(min + max) ? { min, max } : null;
  }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.gapLines.clear(); this.gapGeometry = []; }
  configure(settings: DailyVwapSettings) { this.settings = dailyVwapSettings(settings); }
  setData(bars: readonly Bar[], intervalSeconds: number) {
    this.calculation.update(bars, this.settings.source, intervalSeconds);
    const times = new Set(this.calculation.nakedGaps.map(gap => gap.time));
    for (const time of this.gapLines.keys()) if (!times.has(time)) this.gapLines.delete(time);
    this.host?.requestUpdate();
  }
  diagnostics() { return { mounted: true, points: this.calculation.points.length, latest: this.calculation.points.at(-1) ?? null, segments: this.segments, nakedGaps: this.calculation.nakedGaps, gapGeometry: this.gapGeometry, settings: this.settings }; }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const points = this.calculation.points, scale = rc.readoutPriceScale ?? rc.priceScale;
    const visible = rc.timeScale.visibleRange();
    const groups: { x: number; mid: number; upper: number; lower: number }[][] = [];
    let group: typeof groups[number] = [];
    const fromTime = rc.dataLayer.indexToTimeFloat(visible.from - 1), toTime = rc.dataLayer.indexToTimeFloat(visible.to + 1);
    for (const point of points) {
      if (point.time < fromTime || point.time > toTime) continue;
      const index = rc.dataLayer.timeToIndex(point.time);
      if (point.breakBefore || point.value === null) { if (group.length) groups.push(group); group = []; }
      if (point.value === null || index === undefined || index < visible.from - 1 || index > visible.to + 1) continue;
      const x = rc.timeScale.indexToX(index), width = point.deviation * this.settings.multiplier;
      const position = { x, mid: scale.priceToY(point.value), upper: scale.priceToY(point.value + width), lower: scale.priceToY(point.value - width) };
      if (Object.values(position).every(Number.isFinite)) group.push(position);
    }
    if (group.length) groups.push(group);
    this.segments = groups.filter(group => group.length > 1).length;
    ctx.save(); ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0); ctx.beginPath(); ctx.rect(0,0,rc.plotWidth,rc.plotHeight); ctx.clip();
    for (const group of groups) {
      if (group.length < 2) continue;
      if (this.settings.bands && this.settings.fillOpacity > 0) {
        ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p.upper) : ctx.moveTo(p.x,p.upper));
        for (const p of [...group].reverse()) ctx.lineTo(p.x,p.lower);
        ctx.closePath(); ctx.fillStyle = this.settings.bandColor; ctx.globalAlpha = this.settings.fillOpacity; ctx.fill();
      }
      for (const field of ['upper','lower','mid'] as const) {
        if (field !== 'mid' && !this.settings.bands) continue;
        ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p[field]) : ctx.moveTo(p.x,p[field]));
        ctx.strokeStyle = field === 'mid' ? this.settings.lineColor : this.settings.bandColor;
        ctx.globalAlpha = field === 'mid' ? 1 : .85; ctx.lineWidth = field === 'mid' ? this.settings.lineWidth : 1; ctx.stroke();
      }
    }
    ctx.restore();
    this.gapGeometry = [];
    if (!this.settings.nakedGaps || rc.plotWidth <= 0) return;
    for (const gap of this.calculation.nakedGaps) {
      if (gap.availableAt > toTime) continue;
      const index = rc.dataLayer.timeToIndex(gap.time);
      if (index === undefined) continue;
      const fromX = Math.max(0, rc.timeScale.indexToX(index)), y = scale.priceToY(gap.value);
      if (!Number.isFinite(fromX + y) || fromX >= rc.plotWidth || y < 0 || y > rc.plotHeight) continue;
      let line = this.gapLines.get(gap.time);
      if (!line) {
        line = new PriceLine({ id: `daily-vwap-gap:${gap.time}`, price: gap.value, color: this.settings.lineColor });
        this.gapLines.set(gap.time, line);
      }
      line.setOptions({ price: gap.value, color: this.settings.lineColor, lineWidth: this.settings.lineWidth,
        lineStyle: 'dashed', extentFromRight: (rc.plotWidth - fromX) / rc.plotWidth });
      line.draw(ctx, { ...rc, priceScale: scale });
      this.gapGeometry.push({ time: gap.time, value: gap.value, fromX, toX: rc.plotWidth, y });
    }
  }
}

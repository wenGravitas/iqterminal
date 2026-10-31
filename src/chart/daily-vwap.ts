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
  private readoutGeometry: { time: number; x: number; y: number; width: number; height: number; plotWidth: number; plotHeight: number; lineX: number; lineY: number; curveMinY: number; curveMaxY: number; abovePercent: number; belowPercent: number; aboveBarWidth: number; belowBarWidth: number } | null = null;
  constructor(settings: DailyVwapSettings, private visibleTimeRange: () => { from: number; to: number }) { this.settings = settings; }
  zOrder() { return 'normal' as const; }
  autoscaleInfo() {
    const range = this.visibleTimeRange(); let min = Infinity, max = -Infinity;
    const deviationZones = this.deviationZones();
    const outerDeviation = deviationZones.at(-1) ?? 0;
    for (const point of this.calculation.points) {
      if (point.value === null || point.time < range.from || point.time > range.to) continue;
      const band = point.deviation * this.settings.multiplier * outerDeviation;
      min = Math.min(min, point.value - band); max = Math.max(max, point.value + band);
    }
    if (this.settings.nakedGaps) for (const gap of this.calculation.nakedGaps) {
      if (gap.availableAt > range.to) continue;
      min = Math.min(min, gap.value); max = Math.max(max, gap.value);
    }
    return Number.isFinite(min + max) ? { min, max } : null;
  }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.gapLines.clear(); this.gapGeometry = []; this.readoutGeometry = null; }
  configure(settings: DailyVwapSettings) { this.settings = dailyVwapSettings(settings); }
  setData(bars: readonly Bar[], intervalSeconds: number) {
    this.calculation.update(bars, this.settings.source, intervalSeconds);
    const times = new Set(this.calculation.nakedGaps.map(gap => gap.time));
    for (const time of this.gapLines.keys()) if (!times.has(time)) this.gapLines.delete(time);
    this.host?.requestUpdate();
  }
  diagnostics() { return { mounted: true, points: this.calculation.points.length, latest: this.calculation.points.at(-1) ?? null,
    segments: this.segments, nakedGaps: this.calculation.nakedGaps, gapGeometry: this.gapGeometry, readout: this.settings.readout ? this.calculation.developingTimeSplit(Date.now() / 1000) : null,
    readoutGeometry: this.readoutGeometry, settings: this.settings }; }
  private deviationZones() {
    return [this.settings.bands ? 1 : 0, this.settings.secondDeviation ? 2 : 0, this.settings.thirdDeviation ? 3 : 0].filter(value => value > 0);
  }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const points = this.calculation.points, scale = rc.readoutPriceScale ?? rc.priceScale;
    const visible = rc.timeScale.visibleRange();
    const zones = this.deviationZones(), outerZone = zones.at(-1) ?? 0;
    const groups: { x: number; mid: number; levels: { upper: number; lower: number }[] }[][] = [];
    let group: typeof groups[number] = [];
    const fromTime = rc.dataLayer.indexToTimeFloat(visible.from - 1), toTime = rc.dataLayer.indexToTimeFloat(visible.to + 1);
    for (const point of points) {
      if (point.time < fromTime || point.time > toTime) continue;
      const index = rc.dataLayer.timeToIndex(point.time);
      if (point.breakBefore || point.value === null) { if (group.length) groups.push(group); group = []; }
      if (point.value === null || index === undefined || index < visible.from - 1 || index > visible.to + 1) continue;
      const value = point.value, x = rc.timeScale.indexToX(index), mid = scale.priceToY(value);
      const levels = Array.from({ length: outerZone }, (_, zone) => {
        const width = point.deviation * this.settings.multiplier * (zone + 1);
        return { upper: scale.priceToY(value + width), lower: scale.priceToY(value - width) };
      });
      if ([x, mid, ...levels.flatMap(level => [level.upper, level.lower])].every(Number.isFinite)) group.push({ x, mid, levels });
    }
    if (group.length) groups.push(group);
    this.segments = groups.filter(group => group.length > 1).length;
    ctx.save(); ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0); ctx.beginPath(); ctx.rect(0,0,rc.plotWidth,rc.plotHeight); ctx.clip();
    for (const group of groups) {
      if (group.length < 2) continue;
      if (this.settings.fillOpacity > 0) for (const zone of zones) {
        const zoneIndex = zone - 1, alpha = this.settings.fillOpacity * (zone === 1 ? 1 : zone === 2 ? .72 : .54);
        ctx.fillStyle = this.settings.bandColor; ctx.globalAlpha = alpha;
        if (zone === 1) {
          ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p.levels[zoneIndex]!.upper) : ctx.moveTo(p.x,p.levels[zoneIndex]!.upper));
          for (const p of [...group].reverse()) ctx.lineTo(p.x,p.levels[zoneIndex]!.lower);
          ctx.closePath(); ctx.fill();
        } else {
          for (const field of ['upper','lower'] as const) {
            ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p.levels[zoneIndex]![field]) : ctx.moveTo(p.x,p.levels[zoneIndex]![field]));
            for (const p of [...group].reverse()) ctx.lineTo(p.x,p.levels[zoneIndex - 1]![field]);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      for (const zone of zones) for (const field of ['upper','lower'] as const) {
        ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p.levels[zone - 1]![field]) : ctx.moveTo(p.x,p.levels[zone - 1]![field]));
        ctx.strokeStyle = this.settings.bandColor; ctx.globalAlpha = .85; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); group.forEach((p,index) => index ? ctx.lineTo(p.x,p.mid) : ctx.moveTo(p.x,p.mid));
      ctx.strokeStyle = this.settings.lineColor; ctx.globalAlpha = 1; ctx.lineWidth = this.settings.lineWidth; ctx.stroke();
    }
    ctx.restore();
    this.gapGeometry = [];
    if (this.settings.nakedGaps && rc.plotWidth > 0) {
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
    this.drawReadout(ctx, rc, scale, groups);
  }
  private drawReadout(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, scale: PrimitiveRenderContext['priceScale'], groups: { x: number; mid: number }[][]) {
    this.readoutGeometry = null;
    if (!this.settings.readout || rc.plotWidth < 88 || rc.plotHeight < 42) return;
    const point = this.calculation.points.at(-1);
    if (!point || point.value === null) return;
    const visible = rc.timeScale.visibleRange(), index = rc.dataLayer.timeToIndex(point.time);
    if (index === undefined || index < visible.from || index > visible.to) return;
    const lineX = rc.timeScale.indexToX(index), lineY = scale.priceToY(point.value);
    const split = this.calculation.developingTimeSplit(Date.now() / 1000);
    if (!split || !Number.isFinite(lineX + lineY) || lineY < 0 || lineY > rc.plotHeight) return;
    const width = 82, height = 36, x = Math.max(2, Math.min(lineX + 8, rc.plotWidth - width - 2));
    let y = Math.max(2, Math.min(lineY - height / 2, rc.plotHeight - height - 2));
    const tailYs = (groups.at(-1) ?? []).filter(point => point.x >= x && point.x <= lineX).map(point => point.mid);
    const curveMinY = Math.min(lineY, ...tailYs), curveMaxY = Math.max(lineY, ...tailYs);
    // The plot's right gutter is usually narrower than this compact panel. When it would cover
    // the final VWAP segment, tuck the panel above or below that short curve tail instead.
    if (x <= lineX + 2) {
      const candidates = [curveMinY - height - 4, curveMaxY + 4].filter(value => value >= 2 && value + height <= rc.plotHeight - 2);
      if (!candidates.length) return;
      y = candidates.reduce((best,value) => Math.abs(value + height / 2 - lineY) < Math.abs(best + height / 2 - lineY) ? value : best);
    }
    const trackX = x + 5, trackWidth = width - 10, aboveBarWidth = trackWidth * split.abovePercent / 100, belowBarWidth = trackWidth * split.belowPercent / 100;
    ctx.save(); ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0); ctx.beginPath(); ctx.rect(0,0,rc.plotWidth,rc.plotHeight); ctx.clip();
    ctx.globalAlpha = .94; ctx.fillStyle = rc.theme.background; ctx.fillRect(x,y,width,height);
    ctx.globalAlpha = .82; ctx.strokeStyle = rc.theme.grid; ctx.lineWidth = 1; ctx.strokeRect(x + .5,y + .5,width - 1,height - 1);
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; ctx.textBaseline = 'middle';
    const rows = [
      { label: 'ABV', color: rc.theme.upColor, text: `${Math.round(split.abovePercent)}%`, barWidth: aboveBarWidth },
      { label: 'BLW', color: rc.theme.downColor, text: `${Math.round(split.belowPercent)}%`, barWidth: belowBarWidth },
    ];
    rows.forEach((row,index) => {
      const top = y + 2 + index * 16, textY = top + 5;
      ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.fillStyle = rc.theme.axisText; ctx.fillText(row.label, x + 5, textY);
      ctx.textAlign = 'right'; ctx.fillStyle = row.color; ctx.fillText(row.text, x + width - 5, textY);
      ctx.globalAlpha = .34; ctx.fillStyle = rc.theme.grid; ctx.fillRect(trackX, top + 10, trackWidth, 3);
      ctx.globalAlpha = .95; ctx.fillStyle = row.color; if (row.barWidth > 0) ctx.fillRect(trackX, top + 10, row.barWidth, 3);
    });
    ctx.restore();
    this.readoutGeometry = { time: point.time, x, y, width, height, plotWidth: rc.plotWidth, plotHeight: rc.plotHeight, lineX, lineY, curveMinY, curveMaxY, abovePercent: split.abovePercent, belowPercent: split.belowPercent, aboveBarWidth, belowBarWidth };
  }
}

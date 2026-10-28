import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { compactSize } from '../ticker/presentation';
import { tradeBubbleSettings, topTradeBubbles, type TradeBubbleRecord, type TradeBubbleSettings } from '../trade-bubbles/model';

export interface TradeBubbleHit {
  record: TradeBubbleRecord;
  x: number;
  y: number;
  radius: number;
  overlapCount: number;
}

interface BubbleGeometry extends TradeBubbleHit { id: string }

/** Native OpenAlgo canvas primitive. Executions remain distinct: dense views cull by significance, never merge. */
export class TradeBubblesPrimitive implements IPrimitive {
  private host?: PrimitiveHost;
  private records: TradeBubbleRecord[] = [];
  private settings: TradeBubbleSettings = tradeBubbleSettings(undefined);
  private enabled = false;
  private geometry: BubbleGeometry[] = [];
  draws = 0;
  painted = 0;
  culled = 0;

  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.geometry = []; this.records = []; }
  setSettings(value: unknown) { this.settings = tradeBubbleSettings(value); this.host?.requestUpdate(); }
  setEnabled(enabled: boolean) { if (this.enabled === enabled) return; this.enabled = enabled; if (!enabled) this.geometry = []; this.host?.requestUpdate(); }
  setRecords(records: readonly TradeBubbleRecord[]) {
    this.records = records.slice(-2048);
    this.host?.requestUpdate();
  }
  retained() { return this.records.length; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.draws++; this.painted = 0; this.culled = 0; this.geometry = [];
    if (!this.enabled || !this.records.length || rc.plotWidth <= 0 || rc.plotHeight <= 0) return;
    const visible = rc.timeScale.visibleRange();
    const fromMs = rc.dataLayer.indexToTimeFloat(visible.from - 1) * 1000;
    const toMs = rc.dataLayer.indexToTimeFloat(visible.to + 1) * 1000;
    const scale = rc.readoutPriceScale ?? rc.priceScale;
    const inRange = this.records.filter(record => record.execution.timeMs >= fromMs && record.execution.timeMs <= toMs);
    const chosen = topTradeBubbles(inRange, this.settings.maximumVisible);
    this.culled = Math.max(0, inRange.length - chosen.length);
    // Draw smaller circles first so the strongest retained event remains legible on top.
    chosen.sort((a, b) => a.notionalUsdt - b.notionalUsdt || b.id.localeCompare(a.id));
    const dpr = rc.dpr;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth, rc.plotHeight); ctx.clip();
    for (const record of chosen) {
      const index = rc.dataLayer.timeToIndexFloat(record.execution.timeMs / 1000);
      const x = rc.timeScale.indexToX(index), y = scale.priceToY(record.execution.price);
      if (!Number.isFinite(x + y) || x < -40 || x > rc.plotWidth + 40 || y < -40 || y > rc.plotHeight + 40) continue;
      const span = Math.max(1, this.settings.radiusCapNotional - this.settings.minimumNotionalUsdt);
      const fraction = Math.max(0, Math.min(1, (record.notionalUsdt - this.settings.minimumNotionalUsdt) / span));
      const radius = Math.sqrt(this.settings.minRadius ** 2 + fraction * (this.settings.maxRadius ** 2 - this.settings.minRadius ** 2));
      const color = this.settings.colorMode === 'tier' && record.tier
        ? record.execution.side === 'buy' ? record.tier.buyColor : record.execution.side === 'sell' ? record.tier.sellColor : '#858585'
        : record.execution.side === 'buy' ? this.settings.buyColor : record.execution.side === 'sell' ? this.settings.sellColor : '#858585';
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = this.settings.opacity; ctx.fill();
      ctx.strokeStyle = rc.theme.background; ctx.globalAlpha = Math.min(.9, this.settings.opacity); ctx.lineWidth = Math.max(.6, .8 / dpr); ctx.stroke();
      this.geometry.push({ id: record.id, record, x, y, radius, overlapCount: 0 }); this.painted++;
      const label = this.label(record);
      if (label && radius >= 7) {
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (ctx.measureText(label).width <= radius * 2 - 6) {
          ctx.lineWidth = 2.5; ctx.strokeStyle = rc.theme.background; ctx.globalAlpha = .95; ctx.strokeText(label, x, y + .25);
          ctx.fillStyle = rc.theme.axisText; ctx.globalAlpha = 1; ctx.fillText(label, x, y + .25);
        }
      }
    }
    ctx.restore();
  }

  private label(record: TradeBubbleRecord) {
    const labels = this.settings.labels;
    if (labels === 'off') return '';
    const tier = record.tier?.name ?? 'Trade';
    const notional = `$${compactSize(record.notionalUsdt)}`;
    if (labels === 'tier') return tier;
    if (labels === 'notional') return notional;
    return `${tier} ${notional}`;
  }

  hit(x: number, y: number): TradeBubbleHit | null {
    const containing = this.geometry.filter(item => Math.hypot(item.x - x, item.y - y) <= item.radius);
    if (!containing.length) {
      const near = this.geometry.filter(item => Math.hypot(item.x - x, item.y - y) <= item.radius + 4)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || b.record.notionalUsdt - a.record.notionalUsdt || a.id.localeCompare(b.id))[0];
      return near ? { ...near, overlapCount: 0 } : null;
    }
    const selected = containing.sort((a, b) => b.record.notionalUsdt - a.record.notionalUsdt || a.id.localeCompare(b.id))[0]!;
    return { ...selected, overlapCount: Math.max(0, containing.length - 1) };
  }

  diagnostics() { return { enabled: this.enabled, retained: this.records.length, draws: this.draws, painted: this.painted, culled: this.culled, hittable: this.geometry.length }; }
}

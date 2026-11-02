import { cvdLabelGutterWidth } from './cvd-end-labels';
import type { IPrimitive, PriceScale, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';

/** A pane's readout scale owns the grid, including when indicators share a pane. */
export class IndicatorValueGrid implements IPrimitive {
  private host?: PrimitiveHost;
  private enabled = true;
  private cvdGutter = false;
  geometry: number[] = [];
  constructor(private readonly valueScale?: () => PriceScale | undefined) {}
  zOrder() { return 'bottom' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.geometry = []; }
  configure(enabled: boolean, cvdGutter: boolean) {
    if (enabled === this.enabled && cvdGutter === this.cvdGutter) return;
    this.enabled = enabled; this.cvdGutter = cvdGutter;
    if (!enabled) this.geometry = [];
    this.host?.requestUpdate();
  }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.geometry = [];
    if (!this.enabled) return;
    const scale = this.valueScale?.() ?? rc.readoutPriceScale ?? rc.priceScale;
    if (!scale.scaled) return;
    const dpr = rc.dpr, width = Math.max(0, rc.plotWidth - (this.cvdGutter ? cvdLabelGutterWidth(rc.plotWidth) : 0));
    this.geometry = scale.ticks(Math.max(2, Math.min(30, Math.round(rc.plotHeight / 32))))
      .map(value => scale.priceToY(value)).filter(y => Number.isFinite(y) && y >= 30 && y <= rc.plotHeight - 8);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 30 * dpr, width * dpr, Math.max(0, rc.plotHeight - 30) * dpr); ctx.clip();
    ctx.strokeStyle = rc.theme.grid; ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.setLineDash([]); ctx.beginPath();
    for (const y of this.geometry) {
      const aligned = Math.round(y * dpr) + (ctx.lineWidth % 2 ? .5 : 0);
      ctx.moveTo(0, aligned); ctx.lineTo(width * dpr, aligned);
    }
    ctx.stroke(); ctx.restore();
  }
}

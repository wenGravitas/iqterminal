import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { Candle } from '../feed/protocol';
import { calculateUtcKeyLevels, keyLevelSettings, type KeyLevelSettings } from '../indicators/key-levels';

export function keyLevelRayX(startTime:number, visibleStart:number, plotWidth:number, interpolatedIndex:number|undefined, indexToX:(index:number)=>number) {
  if (interpolatedIndex !== undefined && Number.isFinite(interpolatedIndex)) return Math.max(0,indexToX(interpolatedIndex));
  return startTime <= visibleStart ? 0 : plotWidth;
}

export class KeyLevelsPrimitive implements IPrimitive {
  private host?: PrimitiveHost;
  private candles: readonly Candle[] = [];
  private settings: KeyLevelSettings;
  private levels = calculateUtcKeyLevels([], Date.now());
  constructor(settings: KeyLevelSettings) { this.settings = keyLevelSettings(settings); }
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  setData(candles: readonly Candle[]) { this.candles = candles; this.recalculate(); }
  configure(settings: KeyLevelSettings) { this.settings = keyLevelSettings(settings); this.recalculate(); }
  private recalculate() { this.levels = calculateUtcKeyLevels(this.candles, Date.now(), this.settings); this.host?.requestUpdate(); }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const scale = rc.readoutPriceScale ?? rc.priceScale;
    ctx.save(); ctx.setTransform(rc.dpr,0,0,rc.dpr,0,0); ctx.beginPath(); ctx.rect(0,0,rc.plotWidth,rc.plotHeight); ctx.clip();
    for (const level of this.levels) {
      const visible = rc.timeScale.visibleRange();
      const visibleStart = rc.dataLayer.indexToTimeFloat(visible.from);
      const index = rc.dataLayer.timeToIndex(level.startTime);
      // Exact timestamp is often outside a coarse chart's retained data. The
      // level remains a valid ray across the visible viewport in that case.
      const interpolated = index === undefined ? rc.dataLayer.timeToIndexFloat(level.startTime) : index;
      const x = keyLevelRayX(level.startTime,visibleStart,rc.plotWidth,interpolated,value=>rc.timeScale.indexToX(value));
      const y = scale.priceToY(level.price);
      if (!Number.isFinite(x+y) || x >= rc.plotWidth || y < 0 || y > rc.plotHeight) continue;
      ctx.strokeStyle = level.id === 'today-open' ? '#c6a4e8' : '#92c5cc'; ctx.lineWidth = 1;
      ctx.setLineDash(level.id === 'today-open' ? [4,3] : []); ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(rc.plotWidth,y); ctx.stroke();
      ctx.setLineDash([]); ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left';
      ctx.fillText(`${level.label} ${level.price}`, Math.min(x+4,Math.max(4,rc.plotWidth-90)), y-3);
    }
    ctx.restore();
  }
  diagnostics() { return { levels: this.levels, candles: this.candles.length }; }
}

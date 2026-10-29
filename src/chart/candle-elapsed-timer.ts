import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';

interface TimerCandle { time: number; high: number; low: number; close: number }

/** Candle times are UTC seconds. Expired candles never masquerade as forming ones. */
export function candleElapsedText(time: number, intervalSeconds: number, nowMs: number): string | null {
  const elapsed = Math.floor(nowMs / 1000 - time);
  if (![time, intervalSeconds, nowMs].every(Number.isFinite) || intervalSeconds <= 0 || elapsed < 0 || elapsed >= intervalSeconds) return null;
  return `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
}

/** Display-only annotation; the panel's existing one-second clock owns updates. */
export class CandleElapsedTimer implements IPrimitive {
  private host?: PrimitiveHost;
  private enabled = true;
  private intervalSeconds = 60;
  private lastTickText: string | null = null;
  private geometry: { text: string; x: number; y: number; width: number; height: number; time: number } | null = null;

  constructor(private readonly candle: () => TimerCandle | null, private readonly halfWidth: (spacing: number) => number, private readonly now = () => Date.now()) {}
  zOrder() { return 'top' as const; }
  autoscaleInfo() { return null; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.geometry = null; }
  configure(enabled: boolean, intervalSeconds: number) {
    if (enabled === this.enabled && intervalSeconds === this.intervalSeconds) return;
    this.enabled = enabled; this.intervalSeconds = intervalSeconds; this.geometry = null;
    this.host?.requestUpdate();
  }
  tick() {
    const bar = this.candle();
    const text = this.enabled && bar ? candleElapsedText(bar.time, this.intervalSeconds, this.now()) : null;
    if (text === this.lastTickText) return;
    this.lastTickText = text;
    this.host?.requestUpdate();
  }
  diagnostics() { return { enabled: this.enabled, geometry: this.geometry }; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.geometry = null;
    const bar = this.candle();
    const text = this.enabled && bar ? candleElapsedText(bar.time, this.intervalSeconds, this.now()) : null;
    if (!bar || !text || !rc.dataLayer.length) return;
    const anchor = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(bar.time));
    const scale = rc.readoutPriceScale ?? rc.priceScale;
    const priceY = scale.priceToY(bar.close), high = scale.priceToY(bar.high), low = scale.priceToY(bar.low);
    if (!Number.isFinite(anchor + priceY + high + low) || anchor < 0 || anchor > rc.plotWidth || low < 0 || high > rc.plotHeight) return;
    const d = rc.dpr, height = 16, inset = 4;
    ctx.save();
    ctx.font = `${10 * d}px ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace`;
    const width = Math.ceil(ctx.measureText(text).width / d) + 8;
    // Prefer the free space beyond the current column. Near the right edge,
    // move below the wick, then above it; never cover the preceding candle.
    let x = anchor + this.halfWidth(rc.timeScale.barSpacing) + 8;
    let y = Math.max(inset, Math.min(rc.plotHeight - height - inset, priceY + 5));
    if (x + width > rc.plotWidth - inset) {
      x = Math.max(inset, Math.min(rc.plotWidth - width - inset, anchor - width / 2));
      y = low + 12;
      if (y + height > rc.plotHeight - inset) y = high - height - 12;
    }
    if (width + 2 * inset > rc.plotWidth || y < inset || y + height > rc.plotHeight - inset) { ctx.restore(); return; }
    this.geometry = { text, x, y, width, height, time: bar.time };
    ctx.fillStyle = rc.theme.background;
    ctx.fillRect(x * d, y * d, width * d, height * d);
    ctx.fillStyle = rc.theme.axisText;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, (x + 4) * d, (y + height / 2) * d);
    ctx.restore();
  }
}

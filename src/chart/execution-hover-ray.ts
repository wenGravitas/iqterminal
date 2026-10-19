import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { NormalizedExecution } from '../feed/footprint';

export interface ExecutionHoverRayGeometry {
  executionId: string;
  timeMs: number;
  price: number;
  logicalIndex: number;
  anchorX: number;
  startX: number;
  endX: number;
  y: number;
}

/** Transient ticker hover projection. It owns no drawing, history, or autoscale state. */
export class ExecutionHoverRay implements IPrimitive {
  private host?: PrimitiveHost;
  private execution: NormalizedExecution | null = null;
  private lastGeometry: ExecutionHoverRayGeometry | null = null;

  zOrder() { return 'top' as const; }
  autoscaleInfo() { return null; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.lastGeometry = null; }

  setExecution(execution: NormalizedExecution | null) {
    if (this.execution?.executionId === execution?.executionId
      && this.execution?.timeMs === execution?.timeMs
      && this.execution?.price === execution?.price
      && this.execution?.side === execution?.side) return;
    this.execution = execution;
    this.lastGeometry = null;
    this.host?.requestUpdate();
  }

  diagnostics() {
    return { active: this.execution !== null, executionId: this.execution?.executionId ?? null, geometry: this.lastGeometry };
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.lastGeometry = null;
    const execution = this.execution;
    if (!execution || rc.dataLayer.length === 0 || !Number.isFinite(execution.timeMs + execution.price) || execution.price <= 0) return;
    const logicalIndex = rc.dataLayer.timeToIndexFloat(execution.timeMs / 1000);
    if (!Number.isFinite(logicalIndex)) return;
    const anchorX = rc.timeScale.indexToX(logicalIndex);
    const priceScale = rc.readoutPriceScale ?? rc.priceScale;
    const y = priceScale.priceToY(execution.price);
    if (!Number.isFinite(anchorX + y) || anchorX > rc.plotWidth || y < 0 || y > rc.plotHeight) return;
    const startX = Math.max(0, anchorX);
    const endX = rc.plotWidth;
    this.lastGeometry = { executionId: execution.executionId, timeMs: execution.timeMs, price: execution.price, logicalIndex, anchorX, startX, endX, y };

    const dpr = rc.dpr;
    const color = execution.side === 'buy' ? rc.theme.buy : execution.side === 'sell' ? rc.theme.sell : rc.theme.axisText;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.globalAlpha = .72;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(startX * dpr, y * dpr);
    ctx.lineTo(endX * dpr, y * dpr);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = .9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.min(endX * dpr, Math.max(2 * dpr, anchorX * dpr)), y * dpr, 2.25 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

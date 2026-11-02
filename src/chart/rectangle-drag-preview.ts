import type { Chart, IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { getDrawingTool, type DrawingController, type DrawingPoint } from 'openalgo-charts/draw';

class RectangleOutline implements IPrimitive {
  private host?: PrimitiveHost;
  end: DrawingPoint;
  constructor(readonly start: DrawingPoint) { this.end = start; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  zOrder() { return 'top' as const; }
  autoscaleInfo() { return null; }
  move(end: DrawingPoint) { this.end = end; this.host?.requestUpdate(); }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const scale = rc.readoutPriceScale ?? rc.priceScale, d = rc.dpr;
    const points = [this.start, this.end].map(point => ({ x: rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(point.time)), y: scale.priceToY(point.price) }));
    if (points.some(point => !Number.isFinite(point.x + point.y))) return;
    const style = getDrawingTool('rectangle').defaultStyle;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * d, rc.plotHeight * d); ctx.clip();
    ctx.strokeStyle = style?.color ?? rc.theme.lineColor; ctx.lineWidth = (style?.lineWidth ?? 1.5) * d;
    ctx.strokeRect(points[0]!.x * d, points[0]!.y * d, (points[1]!.x - points[0]!.x) * d, (points[1]!.y - points[0]!.y) * d); ctx.restore();
  }
}
/** The engine commits drag placements on release. Show only a transient outline while held. */
export class RectangleDragPreview {
  private abort = new AbortController(); private releases: (() => void)[] = [];
  private press?: { id: number; pane: number; x: number; y: number; point: DrawingPoint }; private outline?: RectangleOutline; private anchorPlaced = false;
  get active() { return Boolean(this.outline); }
  constructor(private chart: Chart, private controller: DrawingController, private root: HTMLElement) {
    const options = { capture: true, signal: this.abort.signal };
    root.addEventListener('pointerdown', event => {
      this.clear(); if (event.button !== 0 || controller.activeTool() !== 'rectangle' || this.anchorPlaced || (event.target as Element).closest('button,input,select,textarea,[role=dialog]')) return;
      const box = root.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      const pane = chart.panes().findIndex((_, index) => { const p = chart.plotRect(index); return p && x >= p.left && x <= p.left + p.width && y >= p.top && y <= p.top + p.height; });
      const price = pane >= 0 ? chart.coordinateToPrice(y, pane) : null, time = chart.coordinateToTime(x);
      if (price !== null && Number.isFinite(time + price)) this.press = { id: event.pointerId, pane, x, y, point: { time, price } };
    }, options);
    window.addEventListener('pointermove', event => {
      const press = this.press; if (!press || event.pointerId !== press.id) return;
      if (!(event.buttons & 1) || controller.activeTool() !== 'rectangle') { this.clear(); return; }
      const box = root.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      if (!this.outline && Math.hypot(x - press.x, y - press.y) < 3) return;
      const price = chart.coordinateToPrice(y, press.pane), time = chart.coordinateToTime(x); if (price === null || !Number.isFinite(time + price)) return;
      if (!this.outline) { this.outline = new RectangleOutline(press.point); chart.addPrimitive(this.outline, press.pane); }
      this.outline.move({ time, price });
    }, options);
    for (const event of ['pointerup', 'pointercancel'] as const) window.addEventListener(event, () => this.clear(), options);
    window.addEventListener('blur', () => this.clear(), { signal: this.abort.signal });
    window.addEventListener('keydown', event => { if (event.key === 'Escape') { this.anchorPlaced = false; this.clear(); } }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, options);
    this.releases.push(chart.on('click', event => { this.anchorPlaced = controller.activeTool() === 'rectangle' && event.price !== null && Number.isFinite(event.time + event.price); }));
    for (const event of ['draw:tool', 'data:context', 'paneMoved', 'paneRemoved'] as const) this.releases.push(chart.on(event, () => { this.anchorPlaced = false; this.clear(); }));
  }
  private clear() { this.press = undefined; if (this.outline) { this.chart.removePrimitive(this.outline); this.outline = undefined; } }
  dispose() { this.abort.abort(); this.releases.forEach(release => release()); this.clear(); }
}

import { distToRect, type HitContext } from 'openalgo-charts/draw';

/** Native measures paint a minimum span when their anchors share one axis.
 * HitContext uses CSS pixels, so the renderer's 60/40 px fallback needs no DPR. */
export function measureDrawingDistance(tool: 'price-range' | 'date-range', x: number, y: number, context: HitContext): number | null {
  const [a, b] = context.pts;
  if (!a || !b) return null;
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x) + (tool === 'price-range' && a.x === b.x ? 60 : 0);
  const bottom = Math.max(a.y, b.y) + (tool === 'date-range' && a.y === b.y ? 40 : 0);
  return distToRect(x, y, { x: left, y: top }, { x: right, y: bottom }, true);
}

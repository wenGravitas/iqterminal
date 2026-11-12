import type { Bar, DataLayer } from 'openalgo-charts';
import { getDrawingTool, registerDrawingTool, type DrawContext } from 'openalgo-charts/draw';
import { compactVol } from 'openalgo-charts/profile';

export const FIXED_PROFILE_TOOL = 'fixed-range-volume-profile';
const MAX_ROWS = 100_000;
const steps = new WeakMap<DataLayer, number>();
export function setFixedProfileStep(layer: DataLayer, step: number) { if (Number.isFinite(step) && step > 0) steps.set(layer, step); }

/** Candle-volume estimate on fixed chart-price buckets; never presented as executions. */
export function fixedProfile(bars: readonly Bar[], from: number, to: number, step: number, valueArea = 70) {
  const selected = bars.filter(b => b.time >= Math.min(from, to) && b.time <= Math.max(from, to));
  const usable = selected.filter(b => Number.isFinite(b.low) && Number.isFinite(b.high) && b.high >= b.low && Number.isFinite(b.volume) && b.volume! > 0);
  const partial = !bars.length || Math.min(from, to) < bars[0]!.time || Math.max(from, to) > bars.at(-1)!.time || selected.some(b => !Number.isFinite(b.low) || !Number.isFinite(b.high) || b.high < b.low || !Number.isFinite(b.volume) || b.volume! < 0);
  if (!usable.length || !Number.isFinite(step) || step <= 0) return { status: 'No volume in selected range', rows: [], total: 0, partial, poc: 0, val: 0, vah: 0 };
  const first = Math.floor(Math.min(...usable.map(b => b.low)) / step + 1e-7);
  const last = Math.floor(Math.max(...usable.map(b => b.high)) / step + 1e-7), count = last - first + 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || count > MAX_ROWS) return { status: 'Range exceeds 100,000 price rows — shorten the range', rows: [], total: 0, partial, poc: 0, val: 0, vah: 0 };
  const diff = new Float64Array(count + 1);
  let total = 0;
  for (const b of usable) {
    const low = Math.max(0, Math.floor(b.low / step + 1e-7) - first), high = Math.min(count - 1, Math.floor(b.high / step + 1e-7) - first);
    const volume = b.volume! / (high - low + 1); diff[low]! += volume; diff[high + 1]! -= volume; total += b.volume!;
  }
  let running = 0, poc = 0;
  const rows = Array.from({ length: count }, (_, i) => { running += diff[i]!; return { low: (first + i) * step, high: (first + i + 1) * step, volume: Math.max(0, running) }; });
  for (let i = 1; i < count; i++) if (rows[i]!.volume > rows[poc]!.volume) poc = i;
  let val = poc, vah = poc, included = rows[poc]!.volume;
  const target = total * Math.max(.01, Math.min(1, valueArea / 100));
  while (included < target && (val > 0 || vah < count - 1)) {
    if (val > 0 && (vah === count - 1 || rows[val - 1]!.volume >= rows[vah + 1]!.volume)) included += rows[--val]!.volume;
    else included += rows[++vah]!.volume;
  }
  return { status: '', rows, total, partial, poc, val, vah };
}

type ProfileResult = ReturnType<typeof fixedProfile>;
const caches = new WeakMap<DataLayer, Map<string, { signature: string; result: ProfileResult }>>();
function cachedProfile(layer: DataLayer, id: string, bars: readonly Bar[], from: number, to: number, step: number, area: number) {
  // Compare every source value used by the estimator, including historical repairs.
  // Keep at most four profiles per chart; data-space results survive pan/zoom.
  const signature = JSON.stringify([from, to, step, area, bars[0]?.time, bars.at(-1)?.time,
    bars.filter(b => b.time >= Math.min(from, to) && b.time <= Math.max(from, to)).map(b => [b.time, b.low, b.high, b.volume])]);
  let cache = caches.get(layer);
  if (!cache) { cache = new Map(); caches.set(layer, cache); }
  const previous = cache.get(id);
  if (previous?.signature === signature) return previous.result;
  const result = fixedProfile(bars, from, to, step, area);
  cache.delete(id); cache.set(id, { signature, result });
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return result;
}

function drawProfile({ ctx, rc, pts, drawing, style, formatPrice }: DrawContext) {
  if (pts.length < 2 || drawing.points.length < 2) return;
  const step = steps.get(rc.dataLayer);
  const d = rc.dpr, left = Math.min(pts[0]!.x, pts[1]!.x), right = Math.max(pts[0]!.x, pts[1]!.x);
  if (right < 0 || left > rc.plotWidth * d) return;
  const bars = rc.bars?.() ?? [];
  const result = step ? cachedProfile(rc.dataLayer, drawing.id, bars, drawing.points[0]!.time, drawing.points[1]!.time, step, Number(drawing.props?.valueArea ?? 70)) : null;
  ctx.save();
  try {
    const accent = style.color === '#92b9c0' && rc.theme.background === '#f6f4ee' ? '#386e79' : style.color, muted = rc.theme.axisText;
    const y = (price: number) => Math.round(rc.priceScale.priceToY(price) * d);
    const top = result?.rows.length ? y(result.rows.at(-1)!.high) : Math.min(pts[0]!.y, pts[1]!.y);
    const bottom = result?.rows.length ? y(result.rows[0]!.low) : Math.max(pts[0]!.y, pts[1]!.y);
    ctx.lineWidth = Math.max(1, d); ctx.strokeStyle = accent; ctx.fillStyle = accent;
    // Corner brackets and range rails keep the overlay light over price action.
    ctx.globalAlpha = .35; ctx.setLineDash([2 * d, 4 * d]); ctx.beginPath();
    ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.moveTo(right, top); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = .85;
    const corner = Math.min(10 * d, (right - left) / 3, Math.max(0, (bottom - top) / 3));
    for (const x of [left, right]) for (const yy of [top, bottom]) { ctx.beginPath(); ctx.moveTo(x, yy + (yy === top ? corner : -corner)); ctx.lineTo(x, yy); ctx.lineTo(x + (x === left ? corner : -corner), yy); ctx.stroke(); }
    if (result?.rows.length) {
      const max = result.rows[result.poc]!.volume;
      const width = (right - left) * Math.max(.05, Math.min(1, Number(drawing.props?.width ?? 35) / 100));
      const onRight = drawing.props?.side === 'right';
      // Aggregate subpixel rows for paint only; statistical bins retain the chart step.
      const pixels = new Map<number, { volume: number; area: boolean; height: number }>();
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i]!, yy = y(row.high), height = Math.max(1, y(row.low) - yy);
        if (yy + height < 0 || yy > rc.plotHeight * d) continue;
        const previous = pixels.get(yy);
        if (!previous || row.volume > previous.volume) pixels.set(yy, { volume: row.volume, area: i >= result.val && i <= result.vah, height });
      }
      for (const [yy, row] of pixels) {
        const w = width * row.volume / max;
        ctx.globalAlpha = Math.max(0, Math.min(1, style.fillOpacity ?? .35)) * (row.area ? 1 : .4);
        ctx.fillRect(onRight ? right - w : left, yy, w, Math.max(1, row.height - (row.height > 3 * d ? d : 0)));
      }
      const level = (price: number, label: string, solid: boolean) => {
        const yy = y(price); ctx.globalAlpha = solid ? .95 : .6; ctx.setLineDash(solid ? [] : [3 * d, 3 * d]); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        if (style.showLabels !== false) { ctx.globalAlpha = 1; ctx.fillText(`${label} ${formatPrice(price)}`, Math.max(0, left) + 5 * d, yy - 4 * d, Math.max(1, right - Math.max(0, left) - 10 * d)); }
      };
      ctx.font = `${10 * d}px ui-monospace, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (drawing.props?.showPoc !== false) level(result.rows[result.poc]!.low, 'POC', true);
      if (drawing.props?.showValueArea !== false) { level(result.rows[result.val]!.low, 'VAL', false); level(result.rows[result.vah]!.high, 'VAH', false); }
    }
    if (style.showLabels !== false) {
      ctx.font = `${10 * d}px ui-monospace, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.globalAlpha = 1; ctx.fillStyle = muted;
      const title = result?.status || (result ? `FRVP · EST · ${compactVol(result.total)} · Δ ${step}${result.partial ? ' · PARTIAL' : ''}` : 'FRVP · waiting for chart price step');
      ctx.fillText(title, Math.max(0, left) + 5 * d, Math.max(3 * d, top + 5 * d), Math.max(1, Math.min(right, rc.plotWidth * d) - Math.max(0, left) - 10 * d));
    }
  } finally { ctx.restore(); }
}

export function registerFixedRangeProfile() {
  const native = getDrawingTool(FIXED_PROFILE_TOOL);
  registerDrawingTool({ ...native, defaultStyle: { ...native.defaultStyle, color: '#92b9c0', lineWidth: 1, fillOpacity: .35 },
    settings: { ...native.settings, fields: (native.settings?.fields ?? []).filter(field => !['props.rows', 'style.lineWidth', 'style.lineStyle'].includes(field.path) && !field.path.startsWith('text.')) }, draw: drawProfile });
}

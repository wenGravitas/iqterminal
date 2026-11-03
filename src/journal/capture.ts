import type { Chart } from 'openalgo-charts';
import { immutableCopy, createEntry, type ChartCapture, type ChartSnapshot, type JournalBundle } from './model';
import { imageAsset } from './repository';

interface Box { x: number; y: number; width: number; height: number }
interface DomInk extends Box { fill?: string; border?: string; text?: string; color?: string; font?: string; svg?: string; raster?: string; clip: Box }
export interface FrozenFrame { canvas: HTMLCanvasElement; base: Box; width: number; height: number; dpr: number; ink: DomInk[]; title: string; warnings: string[] }
const ROOTS = '.journal-marker-lane,.pane-indicator-host,.cvd-end-labels,.net-positioning-legend,.open-interest-toolbar,.open-interest-status,.cvd-status,.cvd-control-row,.order-flow-header,.order-flow-status,.pane-layout-controls,.pane-loading';
function intersection(a: Box, b: Box): Box { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y); return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }; }
function isVisible(element: Element) { const style = getComputedStyle(element); return !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && Number(style.opacity) !== 0; }
/** All chart state, vector ink and DOM layout are read synchronously, before encoding yields. */
export function freezeFrame(chart: Chart, root: HTMLElement, title: string, canvas = chart.takeScreenshot()): FrozenFrame {
  if (!root.isConnected || root.clientWidth < 50 || root.clientHeight < 50 || document.hidden) throw Error('Show the chart before capturing it');
  if (!canvas.width || !canvas.height) throw Error('Chart compositor returned an empty frame');
  const box = root.getBoundingClientRect(); if (box.width * (box.height + 24) * Math.min(2, window.devicePixelRatio || 1) ** 2 > 32_000_000 || canvas.width * canvas.height > 32_000_000) { canvas.width = canvas.height = 0; throw Error('Capture exceeds the 32 megapixel limit; reduce chart size'); }
  const bounds: Box = { x: 0, y: 0, width: box.width, height: box.height }, ink: DomInk[] = [], warnings: string[] = [];
  const relative = (rect: DOMRect): Box => ({ x: rect.x - box.x, y: rect.y - box.y, width: rect.width, height: rect.height });
  const roots = [...root.querySelectorAll<HTMLElement>(ROOTS)].filter(element => isVisible(element) && !element.parentElement?.closest(ROOTS));
  const visit = (element: Element, clip: Box) => {
    if (!isVisible(element)) return;
    const rect = relative(element.getBoundingClientRect()), style = getComputedStyle(element);
    const visible = intersection(clip, rect); if (visible.width <= 0 || visible.height <= 0) return;
    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') ink.push({ ...rect, clip, fill: style.backgroundColor });
    if (parseFloat(style.borderTopWidth) && style.borderTopStyle !== 'none') ink.push({ ...rect, clip, border: style.borderTopColor });
    if (element instanceof HTMLImageElement) {
      const copy = document.createElement('canvas');
      try { if (!element.complete || !element.naturalWidth) throw Error('not loaded'); copy.width = element.naturalWidth; copy.height = element.naturalHeight; copy.getContext('2d')!.drawImage(element, 0, 0); ink.push({ ...rect, clip, raster: copy.toDataURL('image/png') }); }
      catch { warnings.push('A chart DOM image/icon was unavailable to the compositor.'); }
      finally { copy.width = copy.height = 0; } return;
    }
    if (element instanceof SVGElement && element.tagName.toLowerCase() === 'svg') {
      const clone = element.cloneNode(true) as SVGElement; clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('color', style.color); clone.style.color = style.color;
      ink.push({ ...rect, clip, svg: new XMLSerializer().serializeToString(clone) }); return;
    }
    for (const child of element.childNodes) {
      if (child instanceof Element) visit(child, style.overflow === 'visible' && style.overflowX === 'visible' ? clip : visible);
      else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(child); const textRect = relative(range.getBoundingClientRect());
        ink.push({ ...textRect, clip: visible, text: child.textContent, color: style.color, font: style.font || `${style.fontSize} ${style.fontFamily}` });
      }
    }
  };
  for (const element of roots) visit(element, bounds);
  const chartRoot = root.querySelector<HTMLElement>('.chart-stage') ?? root;
  return Object.freeze({ canvas, base: relative(chartRoot.getBoundingClientRect()), width: Math.round(box.width), height: Math.round(box.height), dpr: Math.min(2, window.devicePixelRatio || 1), ink: immutableCopy(ink), title, warnings });
}
function blobCanvas(canvas: HTMLCanvasElement): Promise<Blob> { return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG encoding returned no image')), 'image/png'); } catch (error) { reject(error); } }); }
async function image(svg: string): Promise<HTMLImageElement> { const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); try { const element = new Image(); element.src = url; await element.decode(); return element; } finally { URL.revokeObjectURL(url); } }
export async function encodeFrame(frame: FrozenFrame): Promise<{ image: Blob; thumbnail: Blob; warnings: string[] }> {
  const warnings = [...frame.warnings], canvas = document.createElement('canvas'); canvas.width = frame.width * frame.dpr; canvas.height = (frame.height + 24) * frame.dpr;
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Canvas image capture is unavailable');
  try {
    ctx.scale(frame.dpr, frame.dpr);
    ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, frame.width, frame.height + 24); ctx.fillStyle = '#c7c7c7'; ctx.font = '10px ui-monospace, monospace'; ctx.fillText(frame.title, 7, 16);
    ctx.drawImage(frame.canvas, frame.base.x, frame.base.y + 24, frame.base.width, frame.base.height); ctx.translate(0, 24);
    for (const item of frame.ink) {
      ctx.save(); ctx.beginPath(); ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height); ctx.clip();
      if (item.fill) { ctx.fillStyle = item.fill; ctx.fillRect(item.x, item.y, item.width, item.height); }
      if (item.border) { ctx.strokeStyle = item.border; ctx.lineWidth = 1; ctx.strokeRect(item.x + .5, item.y + .5, item.width - 1, item.height - 1); }
      if (item.text) { ctx.font = item.font!; ctx.fillStyle = item.color!; ctx.textBaseline = 'top'; ctx.fillText(item.text, item.x, item.y); }
      if (item.raster) { const raster = new Image(); raster.src = item.raster; try { await raster.decode(); ctx.drawImage(raster, item.x, item.y, item.width, item.height); } catch { warnings.push('A frozen chart icon could not be decoded.'); } }
      if (item.svg) { try { ctx.drawImage(await image(item.svg), item.x, item.y, item.width, item.height); } catch { warnings.push('A DOM control icon could not be captured.'); } }
      ctx.restore();
    }
    const png = await blobCanvas(canvas), thumbnail = document.createElement('canvas'); thumbnail.width = Math.min(360, canvas.width); thumbnail.height = Math.max(1, Math.round(canvas.height * thumbnail.width / canvas.width)); thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    const small = await blobCanvas(thumbnail); thumbnail.width = thumbnail.height = 0; return { image: png, thumbnail: small, warnings: [...new Set(warnings)] };
  } finally { canvas.width = canvas.height = 0; }
}
export async function capturedBundle(snapshot: ChartSnapshot, frame: FrozenFrame, marketTime: number, captureId: string, entryId: string): Promise<JournalBundle> {
  const encoded = await encodeFrame(frame), imageId = `${captureId}:image`, thumbnailId = `${captureId}:thumbnail`;
  const assets = await Promise.all([imageAsset(imageId, encoded.image), imageAsset(thumbnailId, encoded.thumbnail)]);
  const capture = captureRecord(snapshot, captureId, imageId, thumbnailId, encoded.warnings, marketTime);
  return { entry: { ...createEntry(capture, marketTime), id: entryId }, capture, assets };
}
export function captureRecord(snapshot: ChartSnapshot, id: string, image: string | null, thumbnail: string | null, warnings: string[], marketTime = snapshot.capturedAt): ChartCapture {
  return immutableCopy({ version: 1, id, marketTime, capturedAt: snapshot.capturedAt, snapshot, image, thumbnail, imageStatus: image ? warnings.length ? 'partial' : 'complete' : 'note-only', imageWarnings: warnings,
    replay: { version: 1, market: snapshot.market, requestedRange: snapshot.visibleRange, captureCutoff: snapshot.dataAsOf, warmup: 'unknown', warmupRequirements: Array.isArray(snapshot.config.indicators) ? (snapshot.config.indicators as any[]).filter(instance => instance.definitionId === 'native.composition-sma').map(instance => ({ instanceId: instance.instanceId, bars: Number(instance.settings.length) || 20 })) : [], streams: snapshot.layers, retention: 'unpreserved', playback: 'not-implemented', screenshot: Boolean(image), chartState: true } });
}

export function releaseFrame(frame: FrozenFrame) { frame.canvas.width = frame.canvas.height = 0; }

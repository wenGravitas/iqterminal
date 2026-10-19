import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { getDrawingTool, registerDrawingTool, type DrawContext, type Drawing, type DrawingController, type DrawingTool } from 'openalgo-charts/draw';

const wrappedDraw = Symbol.for('iqterminal.drawing-label-renderer.v1');
type WrappedDraw = DrawingTool['draw'] & { [wrappedDraw]?: true };
const labelTools = ['horizontal-line', 'horizontal-ray'] as const;
const fontStack = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
interface AxisPriceLabel { price: number; y: number; color: string; alpha: number }

/** Add IQTerminal object labels through the public native drawing-tool registry. */
export function registerIQDrawingLabelRenderers() {
  for (const id of labelTools) {
    const tool = getDrawingTool(id);
    if ((tool.draw as WrappedDraw)[wrappedDraw]) continue;
    const nativeDraw = tool.draw;
    const settings = id === 'horizontal-ray'
      ? {
          ...tool.settings,
          fields: [
            ...(tool.settings?.fields ?? []).filter(field => field.path !== 'text.value'),
            { path: 'text.value', label: 'Text on ray', kind: 'text' as const, group: 'text' as const },
          ],
        }
      : tool.settings;
    const draw: WrappedDraw = context => {
      const axisAvailable = hasPriceAxis(context.rc);
      // OpenAlgo's DrawingLayer clips tool renderers to the plot. Preserve its
      // setting on the drawing, but move only its numeric label to the scale.
      nativeDraw(axisAvailable
        ? { ...context, style: { ...context.style, showLabels: false } }
        : context);
      drawIQLabel(context, id);
    };
    Object.defineProperty(draw, wrappedDraw, { value: true });
    registerDrawingTool({ ...tool, settings, draw });
  }
}

/** One unclipped native primitive per pane paints native horizontal-drawing
 * labels in the scale column. It reads current controller state every frame so
 * visibility, interval, pane and scale changes cannot leave stale tags behind. */
export class DrawingAxisPriceLabels implements IPrimitive {
  private host?: PrimitiveHost;
  private paneIndex: number;

  constructor(
    private readonly drawings: DrawingController,
    paneIndex: number,
    private readonly previews: ReadonlyMap<string, Drawing>,
  ) { this.paneIndex = paneIndex; }

  setPaneIndex(paneIndex: number) { this.paneIndex = paneIndex; }
  zOrder() { return 'top' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  autoscaleInfo() { return null; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    if (!hasPriceAxis(rc)) return;
    const byId = new Map<string, { drawing: Drawing; preview: boolean }>();
    const currentIds = new Set<string>();
    for (const drawing of this.drawings.drawings()) {
      if (drawing.paneIndex === this.paneIndex && drawing.visible !== false && this.drawings.shownOnInterval(drawing.id)) {
        currentIds.add(drawing.id);
        byId.set(drawing.id, { drawing, preview: false });
      }
    }
    for (const drawing of this.previews.values()) {
      if (drawing.paneIndex === this.paneIndex) byId.set(drawing.id, { drawing, preview: !currentIds.has(drawing.id) });
    }

    const scale = rc.readoutPriceScale ?? rc.priceScale;
    for (const { drawing, preview } of byId.values()) {
      if (!labelTools.includes(drawing.tool as typeof labelTools[number]) || drawing.visible === false || drawing.style.showLabels === false) continue;
      const price = drawing.points[0]?.price;
      if (!Number.isFinite(price)) continue;
      const y = scale.priceToY(price!) * rc.dpr;
      if (!Number.isFinite(y)) continue;
      drawAxisPriceLabel(ctx, rc, { price: price!, y, color: drawing.style.color ?? rc.theme.lineColor, alpha: preview ? 0.7 : 1 });
    }
  }
}

function hasPriceAxis(rc: PrimitiveRenderContext) {
  return rc.priceAxisSide !== 'hidden' && Number.isFinite(rc.priceAxisWidth) && rc.priceAxisWidth > 0;
}

function drawAxisPriceLabel(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, label: AxisPriceLabel) {
  const { dpr, priceAxisSide, priceAxisWidth, priceAxisOffset, plotHeight } = rc;
  if (!(Number.isFinite(dpr) && dpr > 0 && Number.isFinite(priceAxisWidth) && priceAxisWidth > 0 && plotHeight > 0)) return;
  if (priceAxisSide === 'hidden' || label.y < 0 || label.y > plotHeight * dpr) return;

  const left = priceAxisSide === 'left';
  const origin = Math.round((Number.isFinite(priceAxisOffset) ? priceAxisOffset! : left ? 0 : rc.plotWidth) * dpr);
  const axisEnd = Math.round(((Number.isFinite(priceAxisOffset) ? priceAxisOffset! : left ? 0 : rc.plotWidth) + (left ? -priceAxisWidth : priceAxisWidth)) * dpr);
  const axisWidth = Math.min(Math.abs(axisEnd - origin) - 1, Math.round(priceAxisWidth * dpr) - 1);
  if (axisWidth < 1) return;

  const text = (rc.readoutPriceScale ?? rc.priceScale).format(label.price);
  const pad = 4 * dpr;
  const height = 18 * dpr;
  ctx.save();
  ctx.font = `500 ${11 * dpr}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const width = Math.min(axisWidth, textWidth + 2 * pad);
  const x = left ? origin - 1 - width : origin + 1;
  const y = Math.max(height / 2, Math.min(plotHeight * dpr - height / 2, label.y));
  ctx.beginPath();
  ctx.rect(Math.min(origin, axisEnd), 0, axisWidth + 1, plotHeight * dpr);
  ctx.clip();
  ctx.globalAlpha = label.alpha;
  ctx.fillStyle = label.color;
  ctx.fillRect(x, y - height / 2, width, height);
  ctx.fillStyle = contrastingText(label.color);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y, Math.max(0, width - 2 * pad));
  ctx.restore();
}

function contrastingText(color: string) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  let rgb: [number, number, number] | null = null;
  if (hex) {
    const value = hex[1]!.length === 3 ? [...hex[1]!].map(channel => Number.parseInt(channel + channel, 16)) : [0, 2, 4].map(index => Number.parseInt(hex[1]!.slice(index, index + 2), 16));
    rgb = value as [number, number, number];
  } else {
    const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(color.trim());
    if (match) rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (!rgb) return '#ffffff';
  const linear = (value: number) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; };
  const luminance = .2126 * linear(rgb[0]) + .7152 * linear(rgb[1]) + .0722 * linear(rgb[2]);
  return luminance > .42 ? '#10131a' : '#ffffff';
}

function drawIQLabel(context: DrawContext, toolId: typeof labelTools[number]) {
  const { drawing, ctx, rc, pts } = context;
  const props = drawing.props;
  const customLabel = props?.iqterminalLabelState === 'custom';
  const value = customLabel
    ? (typeof props?.iqterminalLabel === 'string' ? props.iqterminalLabel : '')
    : toolId === 'horizontal-ray' && typeof drawing.text?.value === 'string' ? drawing.text.value : '';
  if (!value.trim()) return;
  const anchor = pts[0];
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;

  const dpr = Number.isFinite(rc.dpr) && rc.dpr > 0 ? rc.dpr : 1;
  const fontSize = Number.isFinite(drawing.text?.fontSize) ? Math.max(6, Math.min(96, drawing.text!.fontSize!)) : 11;
  const fontPx = fontSize * dpr;
  const maxWidth = rc.plotWidth * dpr;
  if (!(maxWidth > 8 * dpr)) return;

  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `${drawing.text?.italic ? 'italic ' : ''}${drawing.text?.bold ? '700 ' : ''}${fontPx}px ${drawing.text?.fontFamily || fontStack}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const nativeRayText = toolId === 'horizontal-ray' && !customLabel;
  const lines = value.split(/\r?\n/).slice(0, 3);
  const lineHeight = fontPx * 1.3;
  const measuredWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
  const x = Math.max(4 * dpr, Math.min(
    (toolId === 'horizontal-ray' ? anchor.x + 4 * dpr : 4 * dpr),
    maxWidth - measuredWidth - 4 * dpr,
  ));
  const availableWidth = Math.max(1, maxWidth - x - 4 * dpr);
  const width = Math.min(measuredWidth, availableWidth);
  const height = lines.length * lineHeight;
  const centerY = nativeRayText ? anchor.y : anchor.y - 22 * dpr;
  const top = Math.max(fontPx * .75, Math.min(rc.plotHeight * dpr - height, centerY - height / 2));
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = rc.theme.background;
  ctx.fillRect(x - 3 * dpr, top - 2 * dpr, width + 6 * dpr, height + 4 * dpr);
  ctx.globalAlpha = 1;
  // OpenAlgo initializes some drawing text with the pane background color. It
  // is still visible for the tool's price tag, whose plate is separately
  // contrasted, but invisible on our standalone label. Honor a user-edited
  // text color only when the host recorded that choice; otherwise match the
  // visible drawing stroke.
  const explicitTextColor = props?.iqterminalLabelTextColorExplicit === true;
  ctx.fillStyle = (explicitTextColor ? drawing.text?.color : undefined) ?? drawing.style.color ?? '#e5e7eb';
  for (let index = 0; index < lines.length; index++) ctx.fillText(lines[index]!, x, top + (index + .5) * lineHeight, availableWidth);
  ctx.restore();
}

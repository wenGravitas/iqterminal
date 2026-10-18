import { getDrawingTool, registerDrawingTool, type DrawContext, type DrawingTool } from 'openalgo-charts/draw';

const wrappedDraw = Symbol.for('iqterminal.drawing-label-renderer.v1');
type WrappedDraw = DrawingTool['draw'] & { [wrappedDraw]?: true };
const labelTools = ['horizontal-line', 'horizontal-ray'] as const;
const fontStack = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Add IQTerminal object labels through the public native drawing-tool registry. */
export function registerIQDrawingLabelRenderers() {
  for (const id of labelTools) {
    const tool = getDrawingTool(id);
    if ((tool.draw as WrappedDraw)[wrappedDraw]) continue;
    const nativeDraw = tool.draw;
    const draw: WrappedDraw = context => {
      nativeDraw(context);
      drawIQLabel(context, id);
    };
    Object.defineProperty(draw, wrappedDraw, { value: true });
    registerDrawingTool({ ...tool, draw });
  }
}

function drawIQLabel(context: DrawContext, toolId: typeof labelTools[number]) {
  const { drawing, ctx, rc, pts } = context;
  const props = drawing.props;
  const value = props?.iqterminalLabel;
  if (props?.iqterminalLabelState !== 'custom' || typeof value !== 'string' || !value.trim()) return;
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
  const measuredWidth = ctx.measureText(value).width;
  const x = Math.max(4 * dpr, Math.min(
    (toolId === 'horizontal-ray' ? anchor.x + 4 * dpr : 4 * dpr),
    maxWidth - measuredWidth - 4 * dpr,
  ));
  const availableWidth = Math.max(1, maxWidth - x - 4 * dpr);
  const width = Math.min(measuredWidth, availableWidth);
  const y = Math.max(fontPx, anchor.y - 22 * dpr);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = rc.theme.background;
  ctx.fillRect(x - 2 * dpr, y - 0.75 * fontPx, width + 4 * dpr, 1.5 * fontPx);
  ctx.globalAlpha = 1;
  // OpenAlgo initializes some drawing text with the pane background color. It
  // is still visible for the tool's price tag, whose plate is separately
  // contrasted, but invisible on our standalone label. Honor a user-edited
  // text color only when the host recorded that choice; otherwise match the
  // visible drawing stroke.
  const explicitTextColor = props?.iqterminalLabelTextColorExplicit === true;
  ctx.fillStyle = (explicitTextColor ? drawing.text?.color : undefined) ?? drawing.style.color ?? '#e5e7eb';
  ctx.fillText(value, x, y, availableWidth);
  ctx.restore();
}

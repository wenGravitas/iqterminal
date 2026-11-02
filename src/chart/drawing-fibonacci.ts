import { DEFAULT_FIB, FIB_RETRACEMENT, levelColor, type DrawContext, type DrawingTool } from 'openalgo-charts/draw';

// Desaturated level colours keep the ladder behind price action in both themes.
const mutedColors = ['#787b86', '#ac6267', '#ad8557', '#718d72', '#578b80', '#57939b', '#787b86'];
export const IQ_FIB_DEFAULT_STYLE = {
  ...FIB_RETRACEMENT.defaultStyle,
  lineWidth: 1,
  levels: DEFAULT_FIB.map((level, index) => ({ ...level, color: mutedColors[index]! })),
};

/** Keep native geometry, fills and hit testing; replace only the level captions. */
export function drawFibRetracement(context: DrawContext, nativeDraw: DrawingTool['draw']) {
  const { ctx, rc, pts, drawing, style } = context;
  if (pts.length < 2 || drawing.points.length < 2) return;
  const dpr = rc.dpr;
  const levels = (style.levels ?? IQ_FIB_DEFAULT_STYLE.levels).filter(level => level.enabled !== false && Number.isFinite(level.ratio));
  const labels = levels.map(level => level.label ?? `${(level.ratio * 100).toFixed(2)}%`);
  const showLabels = style.showLabels !== false;
  const gap = 6 * dpr;
  ctx.save();
  ctx.font = `${drawing.text?.italic ? 'italic ' : ''}${drawing.text?.bold ? '700 ' : ''}${(drawing.text?.fontSize ?? 11) * dpr}px ${drawing.text?.fontFamily ?? 'ui-monospace, monospace'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Extended levels leave a caption gutter inside the plot's clipping boundary.
  const labelWidth = showLabels ? Math.max(0, ...labels.map(label => ctx.measureText(label).width)) : 0;
  const right = style.extendRight === true
    ? Math.max(0, rc.plotWidth * dpr - (showLabels ? labelWidth + gap * 2 : 0))
    : Math.max(pts[0]!.x, pts[1]!.x);
  const left = style.extendLeft === true ? 0 : Math.min(pts[0]!.x, pts[1]!.x);
  const base = drawing.points[0]!.price;
  const span = drawing.points[1]!.price - base;
  const levelY = (ratio: number) => Math.round(rc.priceScale.priceToY(base + span * ratio) * dpr) + .5;

  if (drawing.props?.showGoldenZone === true && right > left) {
    const y1 = levelY(.618), y2 = levelY(.65);
    if (Number.isFinite(y1 + y2)) {
      ctx.save();
      ctx.globalAlpha *= .2;
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(left, Math.min(y1, y2), right - left, Math.abs(y2 - y1));
      ctx.restore();
    }
  }
  // Native drawing changes canvas text state, so isolate it from our captions.
  ctx.save();
  nativeDraw({ ...context, rc: style.extendRight === true ? { ...rc, plotWidth: right / dpr } : rc,
    style: { ...style, showLabels: false } });
  ctx.restore();
  if (showLabels) {
    for (let index = 0; index < levels.length; index++) {
      const level = levels[index]!;
      const y = levelY(level.ratio);
      if (!Number.isFinite(y)) continue;
      ctx.fillStyle = (drawing.props?.iqterminalLabelTextColorExplicit === true ? drawing.text?.color : undefined) ?? level.color ?? levelColor(level.ratio);
      ctx.fillText(labels[index]!, right + gap, y);
    }
  }
  ctx.restore();
}

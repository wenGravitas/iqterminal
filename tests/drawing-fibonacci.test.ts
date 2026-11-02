import { describe, expect, it, vi } from 'vitest';
import { FIB_RETRACEMENT, type DrawContext } from 'openalgo-charts/draw';
import { drawFibRetracement } from '../src/chart/drawing-fibonacci';
import { captureDrawingSettings, drawingSettingsPatch } from '../src/chart/drawing-settings';

function setup(dpr = 1, reversed = false) {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 6 * dpr }), globalAlpha: 1 };
  const context = { ctx, rc: { dpr, plotWidth: 600, priceScale: { priceToY: (price: number) => 300 - price } },
    pts: [{ x: 100 * dpr, y: 200 * dpr }, { x: 300 * dpr, y: 100 * dpr }],
    drawing: { id: 'fib', tool: 'fib-retracement', paneIndex: 0, zIndex: 0, style: {},
      points: reversed ? [{ time: 0, price: 200 }, { time: 60, price: 100 }] : [{ time: 0, price: 100 }, { time: 60, price: 200 }] },
    style: { ...FIB_RETRACEMENT.defaultStyle, color: '#aaa', lineWidth: 1 },
  } as unknown as DrawContext;
  return { context, ctx, native: vi.fn() };
}

describe('Fibonacci captions and golden zone', () => {
  it.each([1, 2])('puts percentage-only captions beyond the right endpoint at DPR %s', dpr => {
    const { context, ctx, native } = setup(dpr);
    drawFibRetracement(context, native);
    expect(native.mock.calls[0]![0].style.showLabels).toBe(false);
    expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual(['0.00%', '23.60%', '38.20%', '50.00%', '61.80%', '78.60%', '100.00%']);
    for (const call of ctx.fillText.mock.calls) expect(call[1]).toBe(306 * dpr);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('keeps extended labels inside the plot and beyond the level endpoint', () => {
    const { context, ctx, native } = setup();
    context.style.extendRight = true;
    drawFibRetracement(context, native);
    const end = native.mock.calls[0]![0].rc.plotWidth;
    for (const [text, x] of ctx.fillText.mock.calls as unknown as [string, number][]) {
      expect(x).toBe(end + 6);
      expect(x + ctx.measureText(text).width).toBeLessThanOrEqual(600);
    }
  });

  it.each([false, true])('shades exactly 61.8–65%% for either anchor direction (%s)', reversed => {
    const { context, ctx, native } = setup(1, reversed);
    context.drawing.props = { showGoldenZone: true };
    context.style.showLabels = false;
    drawFibRetracement(context, native);
    const y1 = Math.round(300 - (reversed ? 200 - 61.8 : 100 + 61.8)) + .5;
    const y2 = Math.round(300 - (reversed ? 200 - 65 : 100 + 65)) + .5;
    expect(ctx.fillRect).toHaveBeenCalledWith(100, Math.min(y1, y2), 200, Math.abs(y2 - y1));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('defaults off and persists the option through the shared settings patch', () => {
    const { context } = setup();
    expect(captureDrawingSettings(context.drawing)['props.showGoldenZone']).toBe(false);
    const patch = drawingSettingsPatch(context.drawing, { 'props.showGoldenZone': true });
    expect(patch.props?.showGoldenZone).toBe(true);
    expect(captureDrawingSettings({ ...context.drawing, props: patch.props })['props.showGoldenZone']).toBe(true);
  });
});

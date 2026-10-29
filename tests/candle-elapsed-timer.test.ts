import { describe, expect, it, vi } from 'vitest';
import type { PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { CandleElapsedTimer, candleElapsedText } from '../src/chart/candle-elapsed-timer';

it('counts up from the candle open, supports long intervals, and hides expired/future data', () => {
  expect(candleElapsedText(600, 300, 600000)).toBe('00:00');
  expect(candleElapsedText(600, 300, 679999)).toBe('01:19');
  expect(candleElapsedText(600, 300, 899999)).toBe('04:59');
  expect(candleElapsedText(600, 300, 900000)).toBeNull();
  expect(candleElapsedText(900, 300, 900000)).toBe('00:00');
  expect(candleElapsedText(600, 14400, 600000 + 3661000)).toBe('61:01');
  for (const args of [[600, 300, 599999], [NaN, 300, 600000], [600, 0, 600000], [600, Infinity, 600000]]) {
    expect(candleElapsedText(...args as [number, number, number])).toBeNull();
  }
});

function setup() {
  let now = 615000, x = 200;
  const bar = { time: 600, high: 100, low: 150, close: 125 };
  const timer = new CandleElapsedTimer(() => bar, () => 40, () => now);
  const update = vi.fn(); timer.attached({ requestUpdate: update } as unknown as PrimitiveHost);
  const ctx = { save: vi.fn(), restore: vi.fn(), measureText: () => ({ width: 30 }), fillRect: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D;
  const rc = { dpr: 1, plotWidth: 400, plotHeight: 200, theme: { background: '#090909', axisText: '#858585' },
    dataLayer: { length: 1, timeToIndexFloat: () => 1 }, timeScale: { indexToX: () => x, barSpacing: 100 }, priceScale: { priceToY: (value: number) => value } } as unknown as PrimitiveRenderContext;
  return { timer, update, ctx, rc, bar, clock: (value: number) => { now = value; }, anchor: (value: number) => { x = value; } };
}

describe('candle annotation', () => {
  it('sits beyond the column and moves below or above the wick near the plot edge', () => {
    const { timer, ctx, rc, bar, anchor } = setup();
    timer.draw(ctx, rc);
    expect(timer.diagnostics().geometry).toMatchObject({ text: '00:15', x: 248, y: 130, time: 600 });
    anchor(390); timer.draw(ctx, rc);
    expect(timer.diagnostics().geometry).toMatchObject({ x: 358, y: 162 });
    bar.low = 190; timer.draw(ctx, rc);
    expect(timer.diagnostics().geometry?.y).toBe(72);
    expect(timer.autoscaleInfo()).toBeNull();
  });

  it('hides disabled, expired, offscreen and too-small annotations', () => {
    const { timer, ctx, rc, anchor, clock } = setup();
    for (const x of [-1, 401]) { anchor(x); timer.draw(ctx, rc); expect(timer.diagnostics().geometry).toBeNull(); }
    anchor(200); clock(660000); timer.draw(ctx, rc); expect(timer.diagnostics().geometry).toBeNull();
    clock(615000); timer.configure(false, 60); timer.draw(ctx, rc); expect(timer.diagnostics().geometry).toBeNull();
    timer.configure(true, 60); rc.plotWidth = 30; anchor(15); timer.draw(ctx, rc); expect(timer.diagnostics().geometry).toBeNull();
  });

  it('invalidates at second boundaries and at expiry, with no owned timer or detached updates', () => {
    const { timer, update, clock } = setup();
    timer.tick(); timer.tick(); expect(update).toHaveBeenCalledTimes(1);
    clock(615999); timer.tick(); expect(update).toHaveBeenCalledTimes(1);
    clock(616000); timer.tick(); expect(update).toHaveBeenCalledTimes(2);
    clock(660000); timer.tick(); expect(update).toHaveBeenCalledTimes(3);
    timer.detached(); clock(617000); timer.tick(); expect(update).toHaveBeenCalledTimes(3);
  });
});

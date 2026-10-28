import { describe, expect, it } from 'vitest';
import type { PrimitiveRenderContext } from 'openalgo-charts';
import type { TradeBubbleRecord } from '../src/trade-bubbles/model';
import { TradeBubblesPrimitive } from '../src/chart/trade-bubbles';

const origin = Date.UTC(2026, 9, 26, 12);
function record(id: string, notionalUsdt: number, timeMs = origin + 60_000, price = 100): TradeBubbleRecord {
  return {
    id, notionalUsdt, receivedAt: timeMs,
    tier: null,
    execution: { venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade', executionId: id,
      timeMs, eventTimeMs: timeMs, price, quantity: notionalUsdt / price, quoteNotionalText: String(notionalUsdt), side: 'buy' },
  };
}
function context(scale = 100): PrimitiveRenderContext {
  const originSeconds = origin / 1000;
  const priceScale = { priceToY: (price: number) => 150 - (price - 100), priceRange: () => ({ min: 80, max: 120 }) };
  const timeScale = {
    visibleRange: () => ({ from: 0, to: 2 }),
    indexToX: (index: number) => 50 + index * scale,
    xToIndex: (x: number) => (x - 50) / scale,
  };
  const dataLayer = {
    length: 3, baseIndex: 2,
    indexToTime: (index: number) => originSeconds + index * 60,
    indexToTimeFloat: (index: number) => originSeconds + index * 60,
    timeToIndexFloat: (seconds: number) => (seconds - originSeconds) / 60,
  };
  return { timeScale, priceScale, readoutPriceScale: priceScale, dataLayer, plotWidth: 500, plotHeight: 300, dpr: 2,
    theme: { background: '#090909', axisText: '#eee' } } as unknown as PrimitiveRenderContext;
}
function canvas(arcs: Array<{ x: number; y: number; radius: number }> = []): CanvasRenderingContext2D {
  const ctx: Record<string, any> = {
    save() {}, restore() {}, setTransform() {}, beginPath() {}, rect() {}, clip() {}, fill() {}, stroke() {},
    arc(x: number, y: number, radius: number) { arcs.push({ x, y, radius }); }, measureText: () => ({ width: 0 }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe('Trade Bubbles canvas placement, density and hit testing', () => {
  it('projects the same stable execution ID to updated time coordinates after a zoom change', () => {
    const primitive = new TradeBubblesPrimitive();
    primitive.setSettings({ labels: 'off', maximumVisible: 10 }); primitive.setEnabled(true); primitive.setRecords([record('exec-a', 200_000)]);
    const first: Array<{ x: number; y: number; radius: number }> = [];
    primitive.draw(canvas(first), context(100));
    expect(first[0]).toMatchObject({ x: 150, y: 150 });
    const zoomed: Array<{ x: number; y: number; radius: number }> = [];
    primitive.draw(canvas(zoomed), context(200));
    expect(zoomed[0]).toMatchObject({ x: 250, y: 150 });
    expect(primitive.hit(250, 150)?.record.id).toBe('exec-a');
  });

  it('keeps overlapping executions separate and selects the strongest exact print with overlap provenance', () => {
    const primitive = new TradeBubblesPrimitive();
    primitive.setSettings({ labels: 'off', maximumVisible: 10 }); primitive.setEnabled(true);
    primitive.setRecords([record('exec-small', 120_000), record('exec-large', 700_000)]);
    primitive.draw(canvas(), context());
    expect(primitive.retained()).toBe(2);
    expect(primitive.diagnostics().hittable).toBe(2);
    expect(primitive.hit(150, 150)).toMatchObject({ record: { id: 'exec-large' }, overlapCount: 1 });
    expect(primitive.hit(150, 150)?.record.execution.executionId).toBe('exec-large');
  });

  it('culls dense views by significance with stable tie IDs and retains only visible geometry for hits', () => {
    const primitive = new TradeBubblesPrimitive();
    primitive.setSettings({ labels: 'off', maximumVisible: 2 }); primitive.setEnabled(true);
    primitive.setRecords([record('z-tie', 300_000), record('small', 110_000), record('a-tie', 300_000), record('largest', 500_000)]);
    const arcs: Array<{ x: number; y: number; radius: number }> = [];
    primitive.draw(canvas(arcs), context());
    expect(primitive.diagnostics()).toMatchObject({ retained: 4, painted: 2, culled: 2, hittable: 2 });
    expect(arcs).toHaveLength(2);
    expect(primitive.hit(150, 150)?.record.id).toBe('largest');
    expect(primitive.hit(500, 10)).toBeNull();
  });
});

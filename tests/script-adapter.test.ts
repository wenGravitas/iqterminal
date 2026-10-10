import { describe, expect, it } from 'vitest';
import type { Bar, IndicatorValues } from 'openalgo-charts';
import { OpenScriptSession, type ScriptBar } from '../src/scripts/runtime';
import { createScriptChartBridge, depthBandFor } from '../src/scripts/chart-adapter';

const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
const candles: ScriptBar[] = [100, 101, 102].map((close, i) => ({
  t: 1_800_000_000_000 + i * 60_000, o: close - 1, h: close + 1,
  l: close - 2, c: close, v: 10 + i, revision: i, closed: true,
}));

function run(source: string) {
  const result = new OpenScriptSession().start(1, source, {}, candles, context);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return result;
}

describe('OpenScript to OpenAlgo chart adapter', () => {
  it('aligns EMA output to native bar times on the price pane', () => {
    const result = run('version 1\nstudy("EMA", overlay = true)\nplot(ema(close, 2), "EMA")');
    const bridge = createScriptChartBridge(result, 'test-ema', {});
    expect(bridge.descriptor.placement).toBe('onchart');
    expect(bridge.descriptor.inputs).toEqual([]);
    const values = bridge.descriptor.calc(candles.map(toChartBar), {}, {});
    expect(values.p0).toHaveLength(3);
    expect(values.p0?.at(-1)).not.toBeNull();
  });

  it('keeps supported fills and pane placement in the official descriptor', () => {
    const result = run('version 1\nstudy("Filled averages")\nfast = ema(close, 2)\nslow = sma(close, 2)\na = plot(fast, "Fast", aqua)\nb = plot(slow, "Slow", orange)\nfill(a, b, fade(aqua, 80))');
    const bridge = createScriptChartBridge(result, 'test-filled', {});
    expect(bridge.descriptor.placement).toBe('pane');
    expect(bridge.descriptor.plots).toHaveLength(2);
    expect(bridge.descriptor.plots.map(plot => plot.style?.color)).toEqual(['rgba(0, 255, 255, 1)', 'rgba(255, 165, 0, 1)']);
    expect(bridge.descriptor.fills).toHaveLength(1);
    expect(bridge.descriptor.fills?.[0]).toMatchObject({ between: ['p0', 'p1'], colorUp: 'rgba(0, 255, 255, 0.2)', colorDown: 'rgba(0, 255, 255, 0.2)' });
    const values = bridge.descriptor.calc(candles.map(toChartBar), {}, {});
    expect(values.p0).toHaveLength(candles.length);
    expect(values.p1).toHaveLength(candles.length);
    expect(values.p0?.every(value => value === null || Number.isFinite(value))).toBe(true);
  });

  it('retains the native line or histogram style and width for each plot', () => {
    const result = run('version 1\nstudy("Styled")\nplot(close, "Close", aqua, width = 2, style = "line")');
    const descriptor = createScriptChartBridge(result, 'test-style', {}).descriptor;
    expect(descriptor.plots[0]).toMatchObject({ type: 'line', style: { color: 'rgba(0, 255, 255, 1)', lineWidth: 2 } });
  });

  it('exposes OpenScript inputs through the native settings legend', () => {
    const result = run('version 1\nstudy("EMA")\nlength = input(20, "Length", min = 1, max = 250)\nplot(ema(close, length), "EMA")');
    const descriptor = createScriptChartBridge(result, 'test-inputs', {}).descriptor;
    expect(descriptor.hasSource).toBe(true);
    expect(descriptor.inputs).toMatchObject([{ key: 'length', label: 'Length', type: 'number', default: 20, min: 1, max: 250 }]);
  });

  it('marks isolated line samples after null history, updates forming prices, preserves continuous lines, and caps output', () => {
    const descriptor = createScriptChartBridge(run('version 1\nstudy("Sparse")\nplot(close, "Bid", lime, width = 2)'), 'sparse', {}).descriptor;
    const bars = Array.from({ length: 200 }, (_, index): Bar => ({
      time: 1_800_000_000 + index * 60, open: 1, high: 2, low: 0, close: 1, volume: 1,
    }));
    const valuesFor = (entries: [number, number][]): IndicatorValues => {
      const p0 = Array<number | null>(bars.length).fill(null);
      for (const [index, value] of entries) p0[index] = value;
      return { p0 };
    };
    const marks = (values: IndicatorValues) => descriptor.markers?.({ bars, values, settings: {} }) ?? [];

    const first = marks(valuesFor([[151, 8_800_000]]));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ time: bars[151]!.time, price: 8_800_000, color: 'rgba(0, 255, 0, 1)', plot: 'p0' });

    // A forming-bar revision is a replacement at the same UTC candle time.
    expect(marks(valuesFor([[151, 11_500_000]])).map(mark => ({ time: mark.time, price: mark.price })))
      .toEqual([{ time: bars[151]!.time, price: 11_500_000 }]);

    const sparseAfterLine = marks(valuesFor([[10, 1], [11, 2], [12, 3], [151, 4]]));
    expect(sparseAfterLine.map(mark => mark.time)).toEqual([bars[151]!.time]);
    expect(marks(valuesFor([[10, 1], [11, 2], [12, 3]])).map(mark => mark.time)).toEqual([]);

    const alternating = Array.from({ length: 100 }, (_, index) => [index * 2, index] as [number, number]);
    const bounded = marks(valuesFor(alternating));
    expect(bounded).toHaveLength(64);
    expect(bounded.map(mark => mark.time)).toEqual(bounded.map(mark => mark.time).slice().sort((a, b) => a - b));
    expect(bounded.at(-1)?.time).toBe(bars[198]!.time);
  });

  it('accepts an in-range depth band independently of whether the venue snapshot covers it', () => {
    const depth = run(`version 1\nstudy("Depth")\nband = input(0.05, "Depth band (%)", min = 0.01, max = 0.25, step = 0.01)\nbid = input(iq_depth_bid_quote_v1, "Bid quote", options=["iq_depth_bid_quote_v1"])\nplot(bid, "Bid")`);
    expect(depthBandFor(depth, { iq_depth_band_pct_v1: 0.2 })).toBe(0.2);
    expect(depthBandFor(depth, { iq_depth_band_pct_v1: 0.26 })).toBeNull();
  });
});

function toChartBar(bar: ScriptBar): Bar {
  return { time: bar.t / 1000, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v };
}

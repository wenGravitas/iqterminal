import { describe, expect, it, vi } from 'vitest';
import { compileStudy, MAX_SCRIPT_BARS, OpenScriptSession, SCRIPT_LIMITS, type ScriptBar } from '../src/scripts/runtime';
import { BUILT_IN_STUDIES } from '../src/scripts/examples';
import { SCRIPT_CAPABILITY_VERSION, SCRIPT_RUNTIME_VERSION } from '../src/scripts/compiled-cache';

const bars = (closes: number[]): ScriptBar[] => closes.map((c, i) => ({
  t: 1_800_000_000_000 + i * 60_000,
  o: c - 1,
  h: c + 1,
  l: c - 2,
  c,
  v: (i + 1) * 10,
  revision: i,
  closed: i < closes.length - 1,
}));

describe('OpenScript worker session', () => {
  it('compiles once in a persistent worker session across snapshots and incremental patches', () => {
    const compile = vi.fn(compileStudy);
    const session = new OpenScriptSession(compile);
    const input = bars([100, 101, 102]);
    const source = 'version 1\nstudy("EMA", overlay = true)\nlength = input(2, "Length", min=1, max=10)\nplot(ema(close, length), "EMA")';
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };

    expect(session.start(1, source, {}, input, context).ok).toBe(true);
    expect(session.patch(2, [{ kind: 'update', bar: { ...input[2]!, c: 106, h: 107 } }]).ok).toBe(true);
    expect(session.history(3, input).ok).toBe(true);
    expect(session.start(4, source, { length: 3 }, input, context).ok).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('reuses a trusted same-source artifact across workers with fresh settings and recompiles changed source', () => {
    const input = bars([100, 101, 102, 104]);
    const source = 'version 1\nstudy("EMA", overlay = true)\nlength = input(2, "Length", min=1, max=10)\nplot(ema(close, length), "EMA")';
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const first = new OpenScriptSession();
    const original = first.start(1, source, { length: 2 }, input, context);
    expect(original.ok).toBe(true);
    const compile = vi.fn(compileStudy);
    const second = new OpenScriptSession(compile);
    const cached = second.start(2, source, { length: 3 }, input, context, {
      source, runtimeVersion: SCRIPT_RUNTIME_VERSION, capabilityVersion: SCRIPT_CAPABILITY_VERSION,
      program: original.program!,
    });
    expect(cached.ok).toBe(true);
    expect(compile).not.toHaveBeenCalled();
    expect(Object.values(cached.values ?? {})[0]?.[1]).not.toBe(Object.values(original.values ?? {})[0]?.[1]);

    const changed = source.replace('"EMA"', '"EMA changed"');
    expect(second.start(3, changed, { length: 3 }, input, context, {
      source, runtimeVersion: SCRIPT_RUNTIME_VERSION, capabilityVersion: SCRIPT_CAPABILITY_VERSION,
      program: original.program!,
    }).ok).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('compiles and evaluates OHLCV studies into bounded, aligned numeric columns', () => {
    const session = new OpenScriptSession();
    const input = bars([100, 101, 102]);
    const result = session.start(1, 'version 1\nstudy("Close + Volume")\nclosePlot = plot(close, "Close")\nvolumePlot = plot(volume, "Volume", style = "histogram")', {}, input, {
      symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m',
    });

    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
    expect(result.times).toEqual(input.map(bar => bar.t));
    expect(Object.values(result.values ?? {})).toHaveLength(2);
    expect(Object.values(result.values ?? {})).toEqual([[100, 101, 102], [10, 20, 30]]);
  });

  it('revises a forming candle without appending a duplicate timestamp', () => {
    const session = new OpenScriptSession();
    const input = bars([100, 101, 102]);
    const started = session.start(2, 'version 1\nstudy("EMA", overlay = true)\nlength = input(2, "Length", min=1, max=10)\nplot(ema(close, length), "EMA")', {}, input, {
      symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m',
    });
    expect(started, JSON.stringify(started.diagnostics)).toMatchObject({ ok: true });
    const revised = { ...input[2]!, c: 106, h: 107, revision: 1 };
    const patched = session.patch(3, [{ kind: 'update', bar: revised }]);
    expect(patched.ok).toBe(true);
    expect(patched.times).toEqual(input.map(bar => bar.t));
    expect(patched.changedRange).toEqual({ from: 2, to: 3 });
    expect(Object.values(patched.values ?? {})[0]).toHaveLength(3);
    expect(Object.values(patched.values ?? {})[0]?.[2]).not.toBe(Object.values(started.values ?? {})[0]?.[2]);
  });

  it('reports only the appended tail as changed and widens retention shifts to a full window', () => {
    const source = 'version 1\nstudy("Close")\nplot(close, "Close")';
    const session = new OpenScriptSession();
    const input = bars([100, 101, 102]);
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const started = session.start(7, source, {}, input, context);
    expect(started.changedRange).toEqual({ from: 0, to: 3 });
    const appended = session.patch(8, [{ kind: 'append', bar: { ...input[2]!, t: input[2]!.t + 60_000, revision: 9 } }]);
    expect(appended.changedRange).toEqual({ from: 3, to: 4 });

    const bounded = new OpenScriptSession();
    const max = bars(Array.from({ length: MAX_SCRIPT_BARS }, (_, index) => index + 1));
    expect(bounded.start(9, source, {}, max, context).ok).toBe(true);
    const shifted = bounded.patch(10, [{ kind: 'append', bar: { ...max.at(-1)!, t: max.at(-1)!.t + 60_000, revision: 11 } }]);
    expect(shifted.changedRange).toEqual({ from: 0, to: MAX_SCRIPT_BARS });
  });

  it('uses only finite whitelisted numeric depth fields and leaves unavailable cells absent', () => {
    const session = new OpenScriptSession();
    const input = bars([100, 101, 102]).map((bar, i) => ({
      ...bar,
      numericSeries: {
        iq_depth_bid_quote_v1: i === 2 ? null : 90_000 + i * 1_000,
      },
    }));
    const result = session.start(4,
      'version 1\nstudy("Depth")\nbids = input(iq_depth_bid_quote_v1, "Bid Quote", options=["iq_depth_bid_quote_v1"])\nplot(bids, "Bid Quote")',
      {}, input, { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' });

    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
    expect(Object.values(result.values ?? {})[0]).toEqual([90_000, 91_000, null]);
  });

  it('keeps unavailable depth observations as plot gaps after optional EMA smoothing', () => {
    const input = bars([100, 101, 102, 103, 104]).map((bar, i) => ({
      ...bar,
      numericSeries: {
        iq_depth_bid_quote_v1: i === 2 ? null : 90_000 + i * 1_000,
        iq_depth_ask_quote_v1: i === 2 ? null : 91_000 + i * 1_000,
      },
    }));
    const depth = BUILT_IN_STUDIES.find(study => study.id === 'builtin.binance-depth-band')!;
    const result = new OpenScriptSession().start(9, depth.source, { smooth: 2 }, input, {
      symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m',
    });
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
    const [bid, ask] = Object.values(result.values ?? {});
    expect(bid?.[2]).toBeNull();
    expect(ask?.[2]).toBeNull();
    expect(bid?.[3]).toEqual(expect.any(Number));
    expect(ask?.[3]).toEqual(expect.any(Number));
  });

  it('rejects strategies and oversized source before executing any bars', () => {
    const session = new OpenScriptSession();
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const strategy = session.start(5, 'version 1\nstrategy("Orders")', {}, bars([100]), context);
    expect(strategy.ok).toBe(false);
    expect(strategy.diagnostics[0]?.message).toContain('Strategy programs are disabled');
    const oversized = session.start(6, ' '.repeat(100_001), {}, bars([100]), context);
    expect(oversized.ok).toBe(false);
    expect(oversized.diagnostics[0]?.code).toBe('IQ1001');
  });

  it('clamps declared lookback and loop budgets before execution and returns only the bounded history', () => {
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const session = new OpenScriptSession();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    let overBudget;
    try {
      overBudget = session.start(7,
        'version 1\nstudy("Bounded")\nlimits(loops = 1000000, history = 1000000)\nx = 0\nfor i = 0 to 200\n    x = x + close + i\nplot(x, "Value")',
        {}, bars([100]), context);
    } finally {
      clock.mockRestore();
    }
    expect(overBudget.ok).toBe(false);
    expect(overBudget.diagnostics[0]?.code).toBe('OS5001');
    expect(session.compiledProgram?.limits).toEqual({ loops: SCRIPT_LIMITS.loops, history: MAX_SCRIPT_BARS });
    expect(SCRIPT_LIMITS).toMatchObject({ steps: 40_000, instructions: 40_000, history: MAX_SCRIPT_BARS, requests: 0 });

    const input = Array.from({ length: MAX_SCRIPT_BARS + 2 }, (_, i) => ({ ...bars([100])[0]!, t: 1_800_000_000_000 + i * 60_000, c: 100 + i }));
    const bounded = new OpenScriptSession().start(8, 'version 1\nstudy("Bounded")\nplot(close, "Close")', {}, input, context);
    expect(bounded, JSON.stringify(bounded.diagnostics)).toMatchObject({ ok: true });
    expect(bounded.times).toHaveLength(MAX_SCRIPT_BARS);
    expect(bounded.times?.[0]).toBe(input[2]?.t);
    expect(bounded.program?.limits).toEqual({ loops: SCRIPT_LIMITS.loops, history: MAX_SCRIPT_BARS });
  });

  it.each(['area', 'column', 'step', 'lineWithMarkers'])('rejects the unsupported %s plot style instead of silently drawing it as a line', style => {
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const result = new OpenScriptSession().start(20, `version 1\nstudy("Style")\nplot(close, "Close", style = "${style}")`, {}, bars([100]), context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('Only line and histogram');
  });

  it('rejects cross-market requests before exposing any chart output', () => {
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const result = new OpenScriptSession().start(30,
      'version 1\nstudy("Request")\nother = req.symbol("BTCUSDT", "1h", close)\nplot(other, "Other")',
      {}, bars([100]), context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('does not grant requests');
  });

  it('rejects dynamic plot and fill colours that the chart adapter cannot preserve', () => {
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const perBarPlot = new OpenScriptSession().start(40,
      'version 1\nstudy("Plot colours")\nplot(close, "Close", color = close > open ? lime : red)',
      {}, bars([100, 102]), context);
    expect(perBarPlot.ok).toBe(false);
    expect(perBarPlot.diagnostics[0]?.message).toContain('Per-bar plot colours');
    const perBarFill = new OpenScriptSession().start(41,
      'version 1\nstudy("Fill colours")\na = plot(ema(close, 2), "Fast")\nb = plot(sma(close, 2), "Slow")\nfill(a, b, close > open ? lime : red)',
      {}, bars([100, 102]), context);
    expect(perBarFill.ok).toBe(false);
    expect(perBarFill.diagnostics[0]?.message).toContain('Per-bar fill colours');
  });

  it('ships editable EMA, volume, and live-depth examples through the same compiler', () => {
    const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
    const input = bars([100, 101, 102]).map(bar => ({
      ...bar,
      numericSeries: {
        iq_depth_bid_quote_v1: 90_000,
        iq_depth_ask_quote_v1: 91_000,
      },
    }));
    const results = BUILT_IN_STUDIES.map((study, index) => new OpenScriptSession().start(10 + index, study.source, {}, input, context));
    expect(results.map(result => result.ok)).toEqual([true, true, true]);
    expect(results[0]?.program?.meta.overlay).toBe(true);
    expect(results[1]?.program?.outputs.plots[0]?.type).toBe('histogram');
    expect(results[2]?.program?.outputs.plots.map(plot => plot.type)).toEqual(['line', 'line']);
    expect(results[2]?.program?.outputs.plots).toHaveLength(2);
  });
});

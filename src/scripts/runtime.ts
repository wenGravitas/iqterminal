import {
  DiagnosticBag, check, emit, isError, load, parse, sourceFile,
  type CompiledProgram, type Engine, type HostBar,
} from 'openalgo-script';
import { depthSeriesNames, type Candle } from '../feed/protocol';
import { isCompatibleCompiledProgram, type CompiledProgramArtifact } from './compiled-cache';
export { requiredScriptCapabilities } from './capabilities';

export const MAX_SCRIPT_SOURCE = 100_000;
export const MAX_SCRIPT_BARS = 5_000;
export const MAX_SCRIPT_PLOTS = 8;
export const MAX_SCRIPT_FILLS = 4;
export const SCRIPT_LIMITS = Object.freeze({
  steps: 40_000, ms: 20, arrayElements: 5_000, stringLength: 2_048,
  drawingObjects: 0, frames: 16, loops: 128, history: MAX_SCRIPT_BARS,
  instructions: 40_000, states: 128, requests: 0, clockEvery: 128,
});

export interface ScriptBar extends Candle { numericSeries?: Readonly<Record<string, number | null>> }
export interface ScriptDiagnostic { code: string; title: string; message: string; fix: string; line: number; column: number; from: number; to: number; severity: string }
export interface ScriptResult {
  generation: number;
  ok: boolean;
  diagnostics: ScriptDiagnostic[];
  program?: CompiledProgram;
  times?: number[];
  values?: Record<string, (number | null)[]>;
  /** Authoritative half-open output range changed by this result; absent legacy results mean full history. */
  changedRange?: { from: number; to: number };
}
export interface ScriptContext { symbol: string; exchange: string; interval: string }

export interface ScriptCompilation {
  program?: CompiledProgram;
  source?: ReturnType<typeof sourceFile>;
  diagnostics: ScriptDiagnostic[];
}

/** Compile and validate a source without executing it or exposing host services. */
export function compileStudy(source: string): ScriptCompilation {
  if (new TextEncoder().encode(source).byteLength > MAX_SCRIPT_SOURCE) {
    return { diagnostics: [{ code: 'IQ1001', title: 'Source too large', message: `Source exceeds ${MAX_SCRIPT_SOURCE.toLocaleString()} UTF-8 bytes.`, fix: 'Shorten the script before applying it.', line: 1, column: 1, from: 0, to: 0, severity: 'error' }] };
  }
  const file = sourceFile('study.os', source);
  const bag = new DiagnosticBag();
  const parsed = parse(file, bag);
  const checked = check(file, parsed, bag);
  const emitted = emit(file, checked, bag);
  const diagnostics = bag.ordered().filter(isError).map(diagnostic);
  if (!emitted.program || diagnostics.length) return { diagnostics: diagnostics.length ? diagnostics : [fallbackDiagnostic()] };
  const issue = validateProgram(emitted.program);
  if (issue) return { diagnostics: [issue] };
  return { program: boundProgram(emitted.program), source: file, diagnostics: [] };
}

/** Restricted OpenScript compiler/engine session. It has no host I/O functions. */
export class OpenScriptSession {
  private sourceText = '';
  private program?: CompiledProgram;
  private sourceFile?: ReturnType<typeof sourceFile>;
  private engine?: Engine;
  private bars: ScriptBar[] = [];
  private settings: Record<string, unknown> = {};
  private context: ScriptContext = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
  private lastOutputTimes?: number[];
  private lastOutputValues?: Record<string, (number | null)[]>;

  constructor(private readonly compile: typeof compileStudy = compileStudy) {}

  start(generation: number, source: string, settings: Record<string, unknown>, bars: ScriptBar[], context: ScriptContext, cached?: CompiledProgramArtifact): ScriptResult {
    this.lastOutputTimes = undefined;
    this.lastOutputValues = undefined;
    if (source !== this.sourceText) {
      const cacheCandidate = isCompatibleCompiledProgram(cached, source) ? cached.program : undefined;
      const cachedIssue = cacheCandidate ? safelyValidateProgram(cacheCandidate) : null;
      let program: CompiledProgram;
      let file: ReturnType<typeof sourceFile>;
      if (cacheCandidate && !cachedIssue && hasBoundedProgramLimits(cacheCandidate)) {
        program = cacheCandidate;
        file = sourceFile('study.os', source);
      } else {
        const compiled = this.compile(source);
        if (!compiled.program || !compiled.source) return { generation, ok: false, diagnostics: compiled.diagnostics };
        program = compiled.program;
        file = compiled.source;
      }
      this.sourceText = source;
      this.sourceFile = file;
      this.program = program;
    }
    if (!this.program || !this.sourceFile) return { generation, ok: false, diagnostics: [fallbackDiagnostic()] };
    this.settings = normalizeSettings(this.program, settings);
    this.context = context;
    this.bars = bars.slice(-MAX_SCRIPT_BARS);
    return this.rebuild(generation, true);
  }

  history(generation: number, bars: ScriptBar[]): ScriptResult {
    this.bars = bars.slice(-MAX_SCRIPT_BARS);
    return this.rebuild(generation);
  }

  patch(generation: number, changes: readonly { kind: 'append' | 'update'; bar: ScriptBar }[]): ScriptResult {
    if (!this.program || !this.engine) return { generation, ok: false, diagnostics: [fallbackDiagnostic()] };
    let shifted = false;
    for (const change of changes) {
      const bar = hostBar(change.bar);
      if (change.kind === 'append') {
        this.bars.push(change.bar);
        if (this.bars.length > MAX_SCRIPT_BARS) { this.bars.shift(); shifted = true; }
        const result = this.engine.append(bar, { isConfirmed: change.bar.closed, isRealtime: true });
        if (result.diagnostic) return { generation, ok: false, diagnostics: [diagnostic(result.diagnostic)] };
      } else {
        const index = this.bars.length - 1;
        if (index < 0 || this.bars[index]?.t !== change.bar.t) return { generation, ok: false, diagnostics: [fallbackDiagnostic('Forming-bar update did not match the engine tail. Reload the bounded history.')] };
        this.bars[index] = change.bar;
        const result = this.engine.update(bar, { isConfirmed: change.bar.closed, isRealtime: true });
        if (result.diagnostic) return { generation, ok: false, diagnostics: [diagnostic(result.diagnostic)] };
      }
    }
    // The evaluator retains all appended rows, while this host exposes only a
    // bounded sliding window. Rebuild the evaluator on the retained rows when
    // that window shifts so the next result is aligned with `this.bars`.
    if (shifted) return this.rebuild(generation);
    // The evaluator can revise more than the candle passed to update() (for
    // example, lookback functions can settle earlier plot values). Measure the
    // actual normalized output delta in result()'s existing copy pass.
    return this.result(generation, false, false);
  }

  get compiledProgram() { return this.program; }
  reset() { this.engine = undefined; this.program = undefined; this.sourceFile = undefined; this.sourceText = ''; this.bars = []; }

  private rebuild(generation: number, includeProgram = false): ScriptResult {
    if (!this.program || !this.sourceFile) return { generation, ok: false, diagnostics: [fallbackDiagnostic()] };
    const loaded = load(this.program, {
      source: this.sourceFile,
      settings: this.settings,
      limits: SCRIPT_LIMITS,
      clock: () => performance.now(),
      host: { instrument: { symbol: this.context.symbol, exchange: this.context.exchange, interval: this.context.interval, timezone: 'UTC', hasVolume: true } },
    });
    if (!loaded.ok) return { generation, ok: false, diagnostics: [diagnostic(loaded.diagnostic)] };
    this.engine = loaded.engine;
    const run = this.engine.run(this.bars.map(hostBar), this.bars.map(bar => ({ isConfirmed: bar.closed, isRealtime: false })));
    if (run.diagnostic) return { generation, ok: false, diagnostics: [diagnostic(run.diagnostic)] };
    return this.result(generation, includeProgram);
  }

  private result(generation: number, includeProgram = false, forceFullRange = true): ScriptResult {
    if (!this.program || !this.engine) return { generation, ok: false, diagnostics: [fallbackDiagnostic()] };
    const previousTimes = this.lastOutputTimes;
    const previousValues = this.lastOutputValues;
    const values: Record<string, (number | null)[]> = {};
    let changedFrom = Number.MAX_SAFE_INTEGER, changedTo = 0;
    const times = this.bars.map((bar, index) => {
      if (previousTimes?.[index] !== bar.t) { changedFrom = Math.min(changedFrom, index); changedTo = Math.max(changedTo, index + 1); }
      return bar.t;
    });
    if (previousTimes && previousTimes.length !== times.length) {
      if (times.length < previousTimes.length) { changedFrom = 0; changedTo = times.length; }
      else { changedFrom = Math.min(changedFrom, previousTimes.length); changedTo = Math.max(changedTo, times.length); }
    }
    if (!previousTimes) { changedFrom = 0; changedTo = times.length; }
    if (this.bars.length > MAX_SCRIPT_BARS || this.program.outputs.plots.length > MAX_SCRIPT_PLOTS) {
      return failure(generation, fallbackDiagnostic('The study result exceeded its bounded output size.'));
    }
    for (const plot of this.program.outputs.plots) {
      if (!Number.isSafeInteger(plot.channel) || plot.channel < 0 || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(plot.key)) {
        return failure(generation, fallbackDiagnostic('The study produced an invalid plot channel.'));
      }
      const column = this.engine.column(plot.channel);
      if (column.length !== this.bars.length || column.length > MAX_SCRIPT_BARS) {
        return failure(generation, fallbackDiagnostic('The study returned a misaligned or oversized plot.'));
      }
      const previous = previousValues?.[plot.key];
      const normalized = new Array<(number | null)>(column.length);
      for (let index = 0; index < column.length; index++) {
        const value = column[index];
        const current = typeof value === 'number' && Number.isFinite(value) ? value : null;
        normalized[index] = current;
        if (previous?.[index] !== current) { changedFrom = Math.min(changedFrom, index); changedTo = Math.max(changedTo, index + 1); }
      }
      if (previous && previous.length !== normalized.length) {
        if (normalized.length < previous.length) { changedFrom = 0; changedTo = normalized.length; }
        else { changedFrom = Math.min(changedFrom, previous.length); changedTo = Math.max(changedTo, normalized.length); }
      }
      values[plot.key] = normalized;
    }
    const changedRange = forceFullRange || !previousValues
      ? { from: 0, to: this.bars.length }
      : { from: changedFrom === Number.MAX_SAFE_INTEGER ? this.bars.length : changedFrom, to: changedTo };
    this.lastOutputTimes = times;
    this.lastOutputValues = values;
    return {
      generation, ok: true, diagnostics: [], ...(includeProgram ? { program: this.program } : {}),
      times, values, changedRange,
    };
  }
}

function hostBar(bar: ScriptBar): HostBar {
  const numericSeries: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(bar.numericSeries ?? {})) {
    if (!(depthSeriesNames as readonly string[]).includes(key)) continue;
    numericSeries[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return { time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v, numericSeries };
}

/** The OpenScript compiler's general default is broader than this host's declared budget. */
function boundProgram(program: CompiledProgram): CompiledProgram {
  return {
    ...program,
    limits: {
      ...program.limits,
      loops: Math.min(program.limits.loops, SCRIPT_LIMITS.loops),
      history: program.limits.history === null ? MAX_SCRIPT_BARS : Math.min(program.limits.history, MAX_SCRIPT_BARS),
    },
  };
}

function validateProgram(program: CompiledProgram): ScriptDiagnostic | null {
  const reject = (message: string, fix: string) => ({ code: 'IQ1002', title: 'Unsupported study output', message, fix, line: 1, column: 1, from: 0, to: 0, severity: 'error' });
  if (program.meta.kind !== 'study') return reject('Strategy programs are disabled in IQTerminal.', 'Use a read-only study declaration.');
  if (program.requests.length || program.requires.some(capability => capability === 'orders' || capability.startsWith('req.'))) return reject('This host does not grant requests or order capabilities.', 'Use chart OHLCV or the declared IQTerminal depth series.');
  if (program.outputs.plots.length < 1 || program.outputs.plots.length > MAX_SCRIPT_PLOTS) return reject(`A study must declare 1 to ${MAX_SCRIPT_PLOTS} plots.`, 'Reduce the number of plots.');
  const plotKeys = new Set(program.outputs.plots.map(plot => plot.key));
  if (plotKeys.size !== program.outputs.plots.length) return reject('Plot output names must be unique.', 'Give each plot a distinct name.');
  if (program.outputs.plots.some(plot => plot.type !== 'line' && plot.type !== 'histogram')) return reject('Only line and histogram plots are supported.', 'Change every plot style to line or histogram.');
  if (program.outputs.plots.some(plot => plot.colorChannel !== null || plot.ohlc !== null)) return reject('Per-bar plot colours and candle-shaped study outputs are not enabled.', 'Use a fixed colour and a line or histogram plot.');
  if (program.outputs.plots.some(plot => typeof plot.lineStyle === 'string' && !['solid', 'dashed', 'dotted'].includes(plot.lineStyle))) return reject('Line style must be solid, dashed or dotted.', 'Choose a supported line style.');
  if (program.outputs.fills.length > MAX_SCRIPT_FILLS) return reject(`A study may declare at most ${MAX_SCRIPT_FILLS} fills.`, 'Reduce the number of fills.');
  if (program.outputs.fills.some(fill => fill.between.length !== 2 || !fill.between.every(key => plotKeys.has(key)))) return reject('Every fill must connect two declared plots.', 'Point each fill at two plot names declared by this study.');
  if (program.outputs.fills.some(fill => fill.colorUpChannel !== null || fill.colorDownChannel !== null)) return reject('Per-bar fill colours are not enabled.', 'Use fixed fill colours or plot-colour defaults.');
  if (program.outputs.levels.length || program.outputs.markers.length || program.outputs.tables.length || program.outputs.alerts.length || program.outputs.barColor || program.outputs.background) return reject('Levels, markers, tables, alerts, bar colors and backgrounds are not enabled in this milestone.', 'Remove unsupported output declarations.');
  if (program.inputs.length > 16) return reject('A study may declare at most 16 inputs.', 'Reduce the number of inputs.');
  if (program.inputs.some(input => !['number', 'bool', 'color', 'source', 'select', 'string', 'interval', 'time'].includes(input.kind))) return reject('A declared input uses an unsupported control type.', 'Use number, boolean, colour, source or text inputs.');
  return null;
}

function safelyValidateProgram(program: CompiledProgram) {
  try { return validateProgram(program); } catch { return fallbackDiagnostic('The cached compiled study failed host validation.'); }
}

function hasBoundedProgramLimits(program: CompiledProgram) {
  return !!program.limits && Number.isSafeInteger(program.limits.loops) && program.limits.loops >= 0
    && (program.limits.history === null || Number.isSafeInteger(program.limits.history) && program.limits.history >= 0 && program.limits.history <= MAX_SCRIPT_BARS);
}

function normalizeSettings(program: CompiledProgram, settings: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const input of program.inputs) {
    const value = settings[input.key];
    if (value === undefined) continue;
    if (input.kind === 'color' && typeof value === 'string') out[input.key] = parseColour(value);
    else out[input.key] = value;
  }
  return out;
}

function parseColour(text: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return text;
  const hex = match[1]!;
  return { tag: 'color', r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16), a: 1 };
}
function diagnostic(d: { code: string; title: string; message: string; fix: string; severity: string; span: { line: number; column: number; offset: number; length: number } }): ScriptDiagnostic {
  return { code: d.code, title: d.title, message: d.message, fix: d.fix, severity: d.severity, line: d.span.line, column: d.span.column, from: d.span.offset, to: d.span.offset + d.span.length };
}
function fallbackDiagnostic(message = 'The study could not be applied.') { return { code: 'IQ1000', title: 'Study not applied', message, fix: 'Check the source and inputs, then Apply again.', line: 1, column: 1, from: 0, to: 0, severity: 'error' }; }
function failure(generation: number, item: ScriptDiagnostic): ScriptResult { return { generation, ok: false, diagnostics: [item] }; }

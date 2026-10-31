import type { ScriptWorkerRequest, ScriptWorkerResponse } from './protocol';
import type { ScriptBar, ScriptContext, ScriptDiagnostic, ScriptResult } from './runtime';
import { getCompiledProgram, rememberCompiledProgram } from './compiled-cache';

export const MAX_LIVE_SCRIPT_WORKERS = 8;
export const MAX_TOTAL_SCRIPT_WORKERS = MAX_LIVE_SCRIPT_WORKERS + 1;
export const MAX_CANDIDATE_SCRIPT_WORKERS = 1;
export const SCRIPT_WORKER_START_TIMEOUT_MS = 2_500;
export const SCRIPT_WORKER_PATCH_TIMEOUT_MS = 500;
export const MAX_QUEUED_SCRIPT_PATCHES = 512;

export type ScriptWorkerFactory = () => WorkerLike;
export interface WorkerLike {
  postMessage(message: ScriptWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ScriptWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface ScriptClientHooks {
  onResult(result: ScriptResult): void;
  onFailure(diagnostics: ScriptDiagnostic[]): void;
  currentBars(): ScriptBar[];
}

type WorkerRole = 'candidate' | 'live';
const workerBudget = { candidates: 0, live: 0 };

export function scriptWorkerBudget() { return { ...workerBudget, total: workerBudget.candidates + workerBudget.live }; }

type Work =
  | { type: 'history'; bars: ScriptBar[] }
  | { type: 'patch'; changes: Map<number, { kind: 'append' | 'update'; bar: ScriptBar }> };

/** One restricted runtime worker for one applied study instance. */
export class ScriptWorkerClient {
  private worker: WorkerLike | null;
  private currentGeneration = 0;
  private waiting: { generation: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private queued: Work | null = null;
  private disposed = false;
  private started = false;
  private role: WorkerRole = 'candidate';
  private budgetHeld = true;
  private program?: NonNullable<ScriptResult['program']>;
  private startSource?: string;
  private metrics = { patchCalls: 0, patchRows: 0, historyCalls: 0, historyRows: 0, messagesSent: 0, historyMessagesSent: 0, patchMessagesSent: 0, resultMessages: 0, resultRows: 0 };

  constructor(
    factory: ScriptWorkerFactory,
    private readonly hooks: ScriptClientHooks,
    replacement = false,
  ) {
    if (workerBudget.candidates >= MAX_CANDIDATE_SCRIPT_WORKERS || workerBudget.live + workerBudget.candidates >= MAX_TOTAL_SCRIPT_WORKERS || (!replacement && workerBudget.live + workerBudget.candidates >= MAX_LIVE_SCRIPT_WORKERS)) {
      throw new Error('Script worker capacity is full. Remove a study or wait for the current apply to finish.');
    }
    workerBudget.candidates++;
    this.worker = factory();
    this.worker.onmessage = event => this.receive(event.data);
    this.worker.onerror = () => this.fail('The study worker stopped unexpectedly. Its last applied values remain visible.');
    this.worker.onmessageerror = () => this.fail('The study worker returned an unreadable result. Its last applied values remain visible.');
  }

  start(source: string, settings: Record<string, unknown>, bars: ScriptBar[], context: ScriptContext): Promise<ScriptResult> {
    if (this.disposed || !this.worker) return Promise.reject(new Error('Study worker is no longer available.'));
    const generation = ++this.currentGeneration;
    const compiledProgram = getCompiledProgram(source);
    this.startSource = source;
    const message: ScriptWorkerRequest = {
      type: 'start', generation, source, settings, bars: bars.slice(-5_000), context,
      ...(compiledProgram ? { compiledProgram } : {}),
    };
    return new Promise((resolve, reject) => {
      this.beginWait(generation, SCRIPT_WORKER_START_TIMEOUT_MS, 'Study compilation or initial calculation exceeded 2.5 seconds. Reduce its work or history, then apply again.', reject);
      this.resolveStart = resolve;
      this.rejectStart = reject;
      this.worker!.postMessage(message);
    });
  }

  private resolveStart?: (result: ScriptResult) => void;
  private rejectStart?: (error: Error) => void;

  patch(changes: readonly { kind: 'append' | 'update'; bar: ScriptBar }[]) {
    if (this.disposed || !this.started || !changes.length) return;
    this.metrics.patchCalls++;
    this.metrics.patchRows += changes.length;
    const work = this.queued?.type === 'patch' ? this.queued : { type: 'patch' as const, changes: new Map() };
    for (const change of changes) work.changes.set(change.bar.t, change);
    if (work.changes.size > MAX_QUEUED_SCRIPT_PATCHES) this.queued = { type: 'history', bars: this.hooks.currentBars().slice(-5_000) };
    else this.queued = work;
    this.pump();
  }

  history(bars = this.hooks.currentBars()) {
    if (this.disposed || !this.started) return;
    this.metrics.historyCalls++;
    this.metrics.historyRows += bars.length;
    this.queued = { type: 'history', bars: bars.slice(-5_000) };
    this.pump();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseBudget();
    if (this.waiting) clearTimeout(this.waiting.timer);
    this.waiting = null;
    this.queued = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try { worker.postMessage({ type: 'dispose' }); } catch { /* termination still releases it */ }
      worker.terminate();
    }
    const reject = this.rejectStart;
    this.rejectStart = undefined;
    this.resolveStart = undefined;
    reject?.(new Error('Study was removed before it finished applying.'));
  }

  get alive() { return !this.disposed && this.worker !== null; }
  diagnostics() { return { ...this.metrics, queued: this.queued?.type ?? null, generation: this.currentGeneration, alive: this.alive }; }
  resetDiagnostics() { for (const key of Object.keys(this.metrics) as (keyof typeof this.metrics)[]) this.metrics[key] = 0; }

  promote() {
    if (this.disposed || !this.started || this.role !== 'candidate') throw new Error('Only a successfully started candidate can be promoted.');
    if (workerBudget.live >= MAX_LIVE_SCRIPT_WORKERS) throw new Error('The live study worker limit is eight. Remove a study before applying this one.');
    workerBudget.candidates--;
    workerBudget.live++;
    this.role = 'live';
  }

  private beginWait(generation: number, timeout: number, message: string, reject?: (error: Error) => void) {
    if (this.waiting) clearTimeout(this.waiting.timer);
    const timer = setTimeout(() => {
      if (!this.waiting || this.waiting.generation !== generation) return;
      reject?.(new Error(message));
      this.fail(message);
    }, timeout);
    this.waiting = { generation, timer };
  }

  private receive(raw: ScriptWorkerResponse) {
    if (this.disposed || !this.waiting || isDisposed(raw)) return;
    if (!validResult(raw) || raw.generation !== this.waiting.generation || raw.ok && !raw.program && !this.program) {
      this.fail('The study worker returned an invalid or stale result. The last applied values remain visible.');
      return;
    }
    clearTimeout(this.waiting.timer);
    this.waiting = null;
    if (raw.ok) {
      this.metrics.resultMessages++;
      this.metrics.resultRows += raw.times?.length ?? 0;
      if (raw.program) {
        this.program = raw.program;
        if (this.startSource) rememberCompiledProgram(this.startSource, raw.program);
      }
      this.started = true;
      const result = { ...raw, program: this.program };
      this.hooks.onResult(result);
      this.resolveStart?.(result);
      this.startSource = undefined;
      this.resolveStart = undefined;
      this.rejectStart = undefined;
    } else {
      this.hooks.onFailure(raw.diagnostics);
      this.rejectStart?.(new Error(raw.diagnostics[0]?.message ?? 'Study did not apply.'));
      this.startSource = undefined;
      this.rejectStart = undefined;
      this.resolveStart = undefined;
    }
    this.pump();
  }

  private pump() {
    if (this.disposed || !this.worker || this.waiting || !this.queued) return;
    const work = this.queued;
    this.queued = null;
    const generation = ++this.currentGeneration;
    const message: ScriptWorkerRequest = work.type === 'history'
      ? { type: 'history', generation, bars: work.bars }
      : { type: 'patch', generation, changes: [...work.changes.values()].sort((a, b) => a.bar.t - b.bar.t) };
    this.metrics.messagesSent++;
    if (message.type === 'history') this.metrics.historyMessagesSent++;
    else this.metrics.patchMessagesSent++;
    this.beginWait(generation, SCRIPT_WORKER_PATCH_TIMEOUT_MS, 'Study calculation exceeded 500 milliseconds. Its worker was stopped; reduce the calculation cost before reapplying.');
    try { this.worker.postMessage(message); }
    catch { this.fail('The study worker could not accept an update. Its last applied values remain visible.'); }
  }

  private fail(message: string) {
    if (this.disposed) return;
    const worker = this.worker;
    this.worker = null;
    this.releaseBudget();
    if (this.waiting) clearTimeout(this.waiting.timer);
    this.waiting = null;
    this.queued = null;
    this.startSource = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    const diagnostic: ScriptDiagnostic = {
      code: 'IQ2001', title: 'Study worker stopped', message,
      fix: 'Edit the study to reduce work, then apply again.', severity: 'error',
      line: 1, column: 1, from: 0, to: 0,
    };
    this.hooks.onFailure([diagnostic]);
    this.rejectStart?.(new Error(message));
    this.rejectStart = undefined;
    this.resolveStart = undefined;
  }

  private releaseBudget() {
    if (!this.budgetHeld) return;
    this.budgetHeld = false;
    if (this.role === 'candidate') workerBudget.candidates = Math.max(0, workerBudget.candidates - 1);
    else workerBudget.live = Math.max(0, workerBudget.live - 1);
  }
}

export function browserScriptWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'iqterminal-openscript' });
}

function isDisposed(value: unknown): value is { type: 'disposed' } {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'disposed';
}

export function validResult(value: unknown): value is ScriptResult {
  if (!record(value) || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 || typeof value.ok !== 'boolean' || !Array.isArray(value.diagnostics) || value.diagnostics.length > 64) return false;
  if (!value.diagnostics.every(validDiagnostic)) return false;
  if (!value.ok) return value.program === undefined && value.times === undefined && value.values === undefined;
  let keys: Set<string>;
  if (value.program !== undefined) {
    if (!validProgram(value.program)) return false;
    keys = new Set<string>();
    for (const plot of value.program.outputs.plots as NonNullable<ScriptResult['program']>['outputs']['plots']) {
      if (typeof plot.key !== 'string' || keys.has(plot.key)) return false;
      keys.add(plot.key);
    }
  } else {
    if (!record(value.values)) return false;
    keys = new Set(Object.keys(value.values));
    if (keys.size < 1 || keys.size > 8 || [...keys].some(key => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))) return false;
  }
  if (!Array.isArray(value.times) || value.times.length > 5_000 || !value.times.every((time, i, all) => typeof time === 'number' && Number.isSafeInteger(time) && time >= 0 && (i === 0 || time > all[i - 1]!))) return false;
  if (!record(value.values) || Object.keys(value.values).length !== keys.size || ![...keys].every(key => Array.isArray(value.values![key]) && value.values![key]!.length === value.times!.length && value.values![key]!.every(v => v === null || typeof v === 'number' && Number.isFinite(v)))) return false;
  if (value.changedRange !== undefined && (!record(value.changedRange) || !Number.isInteger(value.changedRange.from)
    || !Number.isInteger(value.changedRange.to) || (value.changedRange.from as number) < 0
    || (value.changedRange.to as number) < (value.changedRange.from as number) || (value.changedRange.to as number) > value.times.length)) return false;
  return value.diagnostics.length === 0;
}

function validProgram(value: unknown): value is NonNullable<ScriptResult['program']> {
  if (!record(value) || !record(value.meta) || value.meta.kind !== 'study'
    || !record(value.outputs) || !Array.isArray(value.outputs.plots) || value.outputs.plots.length < 1 || value.outputs.plots.length > 8
    || !Array.isArray(value.inputs) || value.inputs.length > 16
    || !Array.isArray(value.requests) || value.requests.length !== 0
    || !Array.isArray(value.requires) || value.requires.some((capability: unknown) => typeof capability !== 'string' || capability === 'orders' || capability.startsWith('req.'))) return false;
  const plots = value.outputs.plots as unknown[];
  const keys = new Set<string>();
  for (const entry of plots) {
    if (!record(entry) || typeof entry.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(entry.key) || keys.has(entry.key)
      || !Number.isSafeInteger(entry.channel) || (entry.channel as number) < 0
      || (entry.type !== 'line' && entry.type !== 'histogram')
      || entry.colorChannel !== null || entry.ohlc !== null
      || typeof entry.lineStyle === 'string' && !['solid', 'dashed', 'dotted'].includes(entry.lineStyle)) return false;
    keys.add(entry.key);
  }
  const outputs = value.outputs;
  if (!Array.isArray(outputs.fills) || outputs.fills.length > 4
    || !Array.isArray(outputs.levels) || outputs.levels.length
    || !Array.isArray(outputs.markers) || outputs.markers.length
    || !Array.isArray(outputs.tables) || outputs.tables.length
    || !Array.isArray(outputs.alerts) || outputs.alerts.length
    || outputs.barColor !== null || outputs.background !== null) return false;
  for (const entry of outputs.fills as unknown[]) {
    if (!record(entry) || !Array.isArray(entry.between) || entry.between.length !== 2
      || !entry.between.every(key => typeof key === 'string' && keys.has(key))
      || entry.colorUpChannel !== null || entry.colorDownChannel !== null) return false;
  }
  return true;
}

function validDiagnostic(value: unknown): value is ScriptDiagnostic {
  return record(value)
    && typeof value.code === 'string' && value.code.length <= 32
    && typeof value.title === 'string' && value.title.length <= 256
    && typeof value.message === 'string' && value.message.length <= 2_000
    && typeof value.fix === 'string' && value.fix.length <= 2_000
    && typeof value.severity === 'string' && value.severity.length <= 16
    && Number.isSafeInteger(value.line) && (value.line as number) >= 0
    && Number.isSafeInteger(value.column) && (value.column as number) >= 0
    && Number.isSafeInteger(value.from) && (value.from as number) >= 0
    && Number.isSafeInteger(value.to) && (value.to as number) >= (value.from as number) && (value.to as number) <= 100_000;
}

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptWorkerRequest, ScriptWorkerResponse } from '../src/scripts/protocol';
import {
  MAX_LIVE_SCRIPT_WORKERS, MAX_QUEUED_SCRIPT_PATCHES, ScriptWorkerClient,
  scriptWorkerBudget, validResult, type WorkerLike,
} from '../src/scripts/client';
import type { ScriptBar, ScriptResult } from '../src/scripts/runtime';
import { compileStudy } from '../src/scripts/runtime';
import { clearCompiledProgramCache } from '../src/scripts/compiled-cache';

const context = { symbol: 'BTCUSDT', exchange: 'Binance USD-M', interval: '1m' };
const program = {
  meta: { kind: 'study' },
  outputs: {
    plots: [{ key: 'p0', channel: 0, type: 'line', colorChannel: null, ohlc: null, lineStyle: 'dotted' }],
    fills: [], levels: [], markers: [], tables: [], alerts: [], barColor: null, background: null,
  },
  inputs: [], requests: [], requires: [],
};
const bars = (count: number): ScriptBar[] => Array.from({ length: count }, (_, i) => ({
  t: 1_800_000_000_000 + i * 60_000, o: 100, h: 102, l: 99, c: 101, v: 10,
  revision: i, closed: i < count - 1,
}));

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<ScriptWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  requests: ScriptWorkerRequest[] = [];
  terminated = false;
  postMessage(message: ScriptWorkerRequest) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  reply(result: ScriptWorkerResponse) { this.onmessage?.({ data: result } as MessageEvent<ScriptWorkerResponse>); }
}

const clients: ScriptWorkerClient[] = [];
const workers: FakeWorker[] = [];
function makeClient(replacement = false, currentBars = bars(3)) {
  const worker = new FakeWorker();
  workers.push(worker);
  const events: { results: ScriptResult[]; failures: string[] } = { results: [], failures: [] };
  const client = new ScriptWorkerClient(() => worker, {
    onResult: result => events.results.push(result),
    onFailure: diagnostics => events.failures.push(diagnostics[0]?.message ?? ''),
    currentBars: () => currentBars,
  }, replacement);
  clients.push(client);
  return { client, worker, events };
}

function ok(generation: number, times = [1_800_000_000_000], withProgram = false): ScriptResult {
  return { generation, ok: true, diagnostics: [], ...(withProgram ? { program: program as never } : {}), times, values: { p0: times.map(() => 101) } };
}

afterEach(() => {
  clients.splice(0).forEach(client => client.dispose());
  workers.splice(0);
  clearCompiledProgramCache();
  vi.useRealTimers();
  expect(scriptWorkerBudget()).toMatchObject({ candidates: 0, live: 0, total: 0 });
});

describe('isolated OpenScript worker client', () => {
  it('reuses only a validated same-source worker artifact across study instances', async () => {
    const source = 'version 1\nstudy("EMA", overlay = true)\nlength = input(2, "Length", min=1, max=10)\nplot(ema(close, length), "EMA")';
    const compiled = compileStudy(source);
    expect(compiled.program).toBeTruthy();
    const plotKey = compiled.program!.outputs.plots[0]!.key;
    const times = [bars(3)[0]!.t];
    const values = { [plotKey]: [101] };

    const first = makeClient();
    const firstStarted = first.client.start(source, { length: 2 }, bars(3), context);
    const firstRequest = first.worker.requests[0];
    expect(firstRequest?.type).toBe('start');
    if (firstRequest?.type === 'start') expect(firstRequest.compiledProgram).toBeUndefined();
    first.worker.reply({ generation: 1, ok: true, diagnostics: [], program: compiled.program!, times, values });
    await firstStarted;
    first.client.dispose();

    const second = makeClient();
    const secondStarted = second.client.start(source, { length: 3 }, bars(3), context);
    const secondRequest = second.worker.requests[0];
    expect(secondRequest?.type).toBe('start');
    if (secondRequest?.type === 'start') {
      expect(secondRequest.settings).toEqual({ length: 3 });
      expect(secondRequest.compiledProgram).toMatchObject({ source, runtimeVersion: '0.8.1', capabilityVersion: 'iqcap-v1' });
    }
    second.worker.reply({ generation: 1, ok: true, diagnostics: [], program: compiled.program!, times, values });
    await secondStarted;
    expect(second.events.results[0]?.ok).toBe(true);
  });

  it('promotes a successful candidate and applies coalesced updates through bounded history catch-up', async () => {
    const { client, worker, events } = makeClient(false, bars(20));
    const started = client.start('study', {}, bars(3), context);
    expect(worker.requests[0]?.type).toBe('start');
    worker.reply(ok(1, [1_800_000_000_000], true));
    await started;
    client.promote();
    expect(scriptWorkerBudget()).toMatchObject({ candidates: 0, live: 1, total: 1 });

    const tail = bars(3).at(-1)!;
    client.patch([{ kind: 'update', bar: { ...tail, c: 102, revision: 1 } }]);
    expect(worker.requests.at(-1)?.type).toBe('patch');
    for (let i = 0; i < MAX_QUEUED_SCRIPT_PATCHES + 1; i++) {
      client.patch([{ kind: 'append', bar: { ...tail, t: tail.t + (i + 1) * 60_000 } }]);
    }
    worker.reply(ok(2, [1_800_000_000_000], false));
    const catchup = worker.requests.at(-1);
    expect(catchup?.type).toBe('history');
    if (catchup?.type === 'history') expect(catchup.bars).toHaveLength(20);
    worker.reply(ok(3, Array.from({ length: 20 }, (_, i) => 1_800_000_000_000 + i * 60_000), false));
    expect(events.results).toHaveLength(3);
    expect(client.alive).toBe(true);
  });

  it('terminates and releases capacity when the worker returns a stale or malformed result', async () => {
    const { client, worker, events } = makeClient();
    const started = client.start('study', {}, bars(3), context);
    worker.reply(ok(999, [1_800_000_000_000], true));
    await expect(started).rejects.toThrow('invalid or stale');
    expect(worker.terminated).toBe(true);
    expect(events.failures[0]).toContain('invalid or stale');
    expect(scriptWorkerBudget().total).toBe(0);

    const invalid = ok(1, [1_800_000_000_000], true);
    invalid.program = { ...program, outputs: { ...program.outputs, plots: [{ ...program.outputs.plots[0], type: 'area' }] } } as never;
    expect(validResult(invalid)).toBe(false);
  });

  it('enforces the start watchdog, ignores the late worker and lets a fresh retry succeed', async () => {
    vi.useFakeTimers();
    const { client, worker, events } = makeClient();
    const started = client.start('study', {}, bars(3), context);
    const rejected = expect(started).rejects.toThrow('exceeded 2.5 seconds');
    await vi.advanceTimersByTimeAsync(2_500);
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(scriptWorkerBudget().total).toBe(0);

    worker.reply(ok(1, [1_800_000_000_000], true));
    expect(events.results).toHaveLength(0);
    const retry = makeClient();
    const retryStarted = retry.client.start('study', {}, bars(3), context);
    retry.worker.reply(ok(1, [1_800_000_000_000], true));
    await expect(retryStarted).resolves.toMatchObject({ ok: true });
    retry.client.promote();
    expect(retry.worker.terminated).toBe(false);
    expect(scriptWorkerBudget()).toMatchObject({ candidates: 0, live: 1, total: 1 });
  });

  it('caps live workers at eight while allowing one replacement candidate temporarily', async () => {
    const live = [] as ReturnType<typeof makeClient>[];
    for (let i = 0; i < MAX_LIVE_SCRIPT_WORKERS; i++) {
      const entry = makeClient();
      const started = entry.client.start('study', {}, bars(1), context);
      entry.worker.reply(ok(1, [1_800_000_000_000], true));
      await started;
      entry.client.promote();
      live.push(entry);
    }
    expect(scriptWorkerBudget()).toMatchObject({ live: MAX_LIVE_SCRIPT_WORKERS, total: MAX_LIVE_SCRIPT_WORKERS });
    expect(() => makeClient()).toThrow('capacity is full');

    const replacement = makeClient(true);
    const started = replacement.client.start('replacement', {}, bars(1), context);
    replacement.worker.reply(ok(1, [1_800_000_000_000], true));
    await started;
    expect(scriptWorkerBudget().total).toBe(MAX_LIVE_SCRIPT_WORKERS + 1);
    live[0]!.client.dispose();
    replacement.client.promote();
    expect(scriptWorkerBudget()).toMatchObject({ candidates: 0, live: MAX_LIVE_SCRIPT_WORKERS, total: MAX_LIVE_SCRIPT_WORKERS });
  });
});

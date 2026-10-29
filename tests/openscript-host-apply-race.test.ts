import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workers: [] as any[],
  delayNextStart: false,
  releaseStart: undefined as undefined | (() => void),
  makeResult: undefined as undefined | ((bars: any[], source?: string) => any),
}));

vi.mock('../src/scripts/client', () => ({
  browserScriptWorker: () => ({}),
  ScriptWorkerClient: class {
    constructor(_factory: unknown, hooks: any) { this.hooks = hooks; state.workers.push(this); }
    hooks: any;
    alive = true;
    async start(source: string, _settings: unknown, bars: any[]) {
      const result = state.makeResult!(bars, source);
      if (state.delayNextStart) {
        state.delayNextStart = false;
        await new Promise<void>(resolve => { state.releaseStart = resolve; });
      }
      this.hooks.onResult(result);
      return result;
    }
    history() {}
    patch() {}
    promote() {}
    dispose() { this.alive = false; }
  },
}));

import { numericOutputRef } from '../src/scripts/composition';
import { ScriptStudyHost, type StudyPin } from '../src/scripts/host';
import { compileStudy } from '../src/scripts/runtime';

const revisionId = 'b'.repeat(64);
const source = `version 1\nstudy("Close")\nplot(close, "Close")`;
const compiled = compileStudy(source);
if (!compiled.program) throw new Error('Expected the small host race fixture to compile.');

function chart() {
  const indicators: any[] = [];
  return {
    indicators,
    primaryPaneIndex: () => 0,
    panes: () => [{ element: {}, weight: 1 }, { element: {}, weight: 1 }],
    addIndicator(id: string, _settings: unknown, options: any) {
      let visible = true;
      const api = {
        id: `engine:${id}`, paneIndex: options?.paneIndex ?? 1,
        visible: () => visible, setVisible(value: boolean) { visible = value; },
        setPolicy: vi.fn(), legend: () => ({ setOptions: vi.fn() }), remove: vi.fn(),
      };
      indicators.push(api);
      return api;
    },
  };
}

it('revalidates a source after asynchronous worker startup before committing the consumer', async () => {
  state.workers = [];
  state.makeResult = bars => ({ generation: 1, ok: true, diagnostics: [], program: compiled.program,
    times: bars.map(bar => bar.t), values: { p0: bars.map(bar => bar.c) } });
  const chartApi = chart();
  const saves: any[] = [];
  const library = { pinRevision: async () => ({ id: revisionId }), getRevision: async () => ({ source }) };
  const host = new ScriptStudyHost('panel-race', { chart: chartApi, enqueueVisible: (callback: () => void) => callback() } as any,
    {} as any, library as any, { venue: 'binance', market: 'perpetual', interval: '1m' }, pins => saves.push(pins));
  host.setSnapshot([{ t: 1_800_000_000_000, o: 100, h: 102, l: 99, c: 101, v: 1, revision: 1, closed: false }]);

  await host.apply({ attachmentId: 'source', scriptId: 'local.source', source, title: 'Source', description: '', settings: {}, paneId: 'pane:flow' });
  const ref = numericOutputRef(host.numericOutputs()[0]!);
  state.delayNextStart = true;
  const applying = host.apply({ attachmentId: 'consumer', scriptId: 'local.consumer', source, title: 'Consumer', description: '', settings: {}, paneId: 'pane:flow', numericInputs: { source: ref } });
  await vi.waitFor(() => expect(state.workers).toHaveLength(2));

  expect(host.remove('source')).toBe(true);
  state.releaseStart?.();
  await expect(applying).rejects.toThrow(/source .* is unavailable/);
  expect(chartApi.indicators).toHaveLength(1);
  expect(host.views()).toEqual([]);
  expect(saves.at(-1)).toEqual([]);
  host.dispose();
});

it('preserves numeric input refs when applying a consumer and accepts only compatible provider replacements', async () => {
  state.workers = [];
  state.makeResult = (bars, sourceText = source) => {
    const result = compileStudy(sourceText);
    if (!result.program) throw new Error('Expected the application fixture to compile.');
    return { generation: 1, ok: true, diagnostics: [], program: result.program,
      times: bars.map(bar => bar.t), values: { p0: bars.map(bar => bar.c) } };
  };
  const saves: any[] = [];
  const library = { pinRevision: async () => ({ id: revisionId }), getRevision: async () => ({ source }) };
  const host = new ScriptStudyHost('panel-replace', { chart: chart(), enqueueVisible: (callback: () => void) => callback() } as any,
    {} as any, library as any, { venue: 'binance', market: 'perpetual', interval: '1m' }, pins => saves.push(pins));
  host.setSnapshot([
    { t: 1_800_000_000_000, o: 100, h: 102, l: 99, c: 101, v: 1, revision: 1, closed: false },
    { t: 1_800_000_060_000, o: 101, h: 103, l: 100, c: 102, v: 2, revision: 1, closed: false },
  ]);
  await host.apply({ attachmentId: 'provider', scriptId: 'local.provider', source, title: 'Provider', description: '', settings: {}, paneId: 'pane:flow' });
  const originalOutput = host.numericOutputs().find(output => output.instanceId === 'provider')!;
  const originalRef = numericOutputRef(originalOutput);
  await host.apply({ attachmentId: 'consumer', scriptId: 'local.consumer', source, title: 'Consumer', description: '', settings: { length: 3 },
    paneId: 'pane:flow', numericInputs: { source: originalRef } });

  await host.apply({ attachmentId: 'consumer', scriptId: 'local.consumer', source, title: 'Consumer', description: '', settings: { length: 2 } });
  expect(host.pins().find(pin => pin.attachmentId === 'consumer')?.numericInputs?.source).toEqual(originalRef);

  const compatibleReplacement = 'version 1\nstudy("Close v2")\nplot(close, "Close")';
  await host.apply({ attachmentId: 'provider', scriptId: 'local.provider', source: compatibleReplacement, title: 'Provider v2', description: '', settings: {}, paneId: 'pane:flow' });
  const replacedOutput = host.numericOutputs().find(output => output.instanceId === 'provider')!;
  expect(numericOutputRef(replacedOutput)).toEqual(originalRef);
  expect(host.pins().find(pin => pin.attachmentId === 'consumer')?.numericInputs?.source).toEqual(originalRef);

  const incompatibleReplacement = 'version 1\nstudy("Overlay", overlay = true)\nplot(close, "Close")';
  const providerApiBeforeRejectedReplacement = host.apiForAttachment('provider');
  await expect(host.apply({ attachmentId: 'provider', scriptId: 'local.provider', source: incompatibleReplacement,
    title: 'Overlay', description: '', settings: {}, paneId: 'pane:flow' })).rejects.toThrow(/no longer compatible/);
  expect(host.apiForAttachment('provider')).toBe(providerApiBeforeRejectedReplacement);
  expect(numericOutputRef(host.numericOutputs().find(output => output.instanceId === 'provider')!)).toEqual(originalRef);
  expect(host.pins().find(pin => pin.attachmentId === 'consumer')?.numericInputs?.source).toEqual(originalRef);
  expect(saves.at(-1)?.find((pin: StudyPin) => pin.attachmentId === 'consumer')?.numericInputs?.source).toEqual(originalRef);
  host.dispose();
});

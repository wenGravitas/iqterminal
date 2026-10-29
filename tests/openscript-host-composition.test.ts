import { afterEach, describe, expect, it, vi } from 'vitest';
import { numericOutputContextId, numericOutputRef } from '../src/scripts/composition';
import { orderStudyPinsByDependencies, ScriptStudyHost, type StudyPin } from '../src/scripts/host';
import type { Series } from '../src/feed/protocol';

const series: Series = { venue: 'binance', market: 'perpetual', interval: '1m' };
const revisionId = 'a'.repeat(64);
afterEach(() => vi.unstubAllGlobals());

function result(values: (number | null)[] = [101, 102]) {
  return {
    generation: 1, ok: true, diagnostics: [],
    program: { meta: { kind: 'study', overlay: false, format: 'price' }, inputs: [], outputs: {
      plots: [{ key: 'p0', type: 'line', title: 'Close', priceFormat: 'price', overlay: false, ohlc: null }],
      fills: [], levels: [], markers: [], tables: [], alerts: [], barColor: null, background: null,
    } },
    times: [1_800_000_000_000, 1_800_000_060_000], values: { p0: values },
  } as any;
}

function instance(attachmentId: string, rawResult = result(), numericInputs?: StudyPin['numericInputs']) {
  return {
    attachmentId, scriptId: `local.${attachmentId}`, revisionId, title: attachmentId, description: '', settings: {}, visible: true,
    paneId: 'pane:flow', numericInputs, plotScaleIds: { p0: 'overlay:shared-flow' },
    status: 'Study ready', diagnostics: [], inputs: [], outputs: { p0: rawResult.values.p0.at(-1) },
    result: rawResult, resultRevision: 7, resultContextId: numericOutputContextId(series), resultContextRevision: 0,
    api: { id: `engine-${attachmentId}`, setPolicy: vi.fn(), remove: vi.fn(), visible: () => true, setVisible: vi.fn() },
    bridge: { clear: vi.fn() }, worker: { alive: true, history: vi.fn(), patch: vi.fn(), dispose: vi.fn() }, descriptorId: `iq-script-slot-${attachmentId}`,
    depthBand: null, depthUnavailable: false, needsHistory: false, source: '',
  };
}

function host() {
  return new ScriptStudyHost('panel-1', {} as any, {} as any, {} as any, series, () => {});
}

function pin(attachmentId: string, numericInputs?: StudyPin['numericInputs']): StudyPin {
  return { attachmentId, scriptId: `local.${attachmentId}`, revisionId, title: attachmentId, description: '', settings: {}, visible: true, numericInputs };
}

describe('OpenScript numeric provider metadata', () => {
  it('exposes stable logical IDs, chart context, revisions and complete aligned values', () => {
    const study = host();
    const provider = instance('provider');
    (study as any).studies.set(provider.attachmentId, provider);

    const [output] = study.numericOutputs();
    expect(output).toMatchObject({
      kind: 'indicator-output', version: 1, instanceId: 'provider', outputId: 'output:provider:p0',
      schemaId: 'number:chart-candles-v1:p0:USDT:1', domain: 'chart-candles-v1',
      contextId: numericOutputContextId(series), scaleId: 'overlay:shared-flow',
      engineInstanceId: 'engine-provider', revision: 7, contextRevision: 0, available: true, composable: true,
      times: [1_800_000_000_000, 1_800_000_060_000], values: [101, 102],
    });
    expect(numericOutputRef(output!)).toMatchObject({ instanceId: 'provider', contextId: numericOutputContextId(series), scaleId: 'overlay:shared-flow' });

    provider.resultRevision++;
    provider.result = result([201, null]);
    const updated = study.numericOutputs()[0]!;
    expect(updated.revision).toBe(8);
    expect(updated.values).toEqual([201, null]);

    study.setSeries({ venue: 'hyperliquid', market: 'perpetual', interval: '5m' });
    expect(study.numericOutputs()[0]).toMatchObject({ available: false, contextId: numericOutputContextId(series), contextRevision: 0 });
    study.dispose();
  });

  it('revalidates context, schema and cycles before accepting an input reference', () => {
    const study = host();
    const provider = instance('provider');
    (study as any).studies.set(provider.attachmentId, provider);
    const ref = numericOutputRef(study.numericOutputs()[0]!);
    expect(() => (study as any).assertNumericInputs('consumer', { source: ref }, 0)).not.toThrow();
    expect(() => (study as any).assertNumericInputs('consumer', { source: { ...ref, contextId: 'other-chart:1m' } }, 0)).toThrow(/no longer matches/);

    const consumer = instance('consumer', result(), { source: ref });
    (study as any).studies.set(consumer.attachmentId, consumer);
    expect(() => (study as any).assertNumericInputs('provider', { source: { ...ref, instanceId: 'consumer', outputId: 'output:consumer:p0' } }, 0)).toThrow(/cycle/);

    (study as any).studies.delete('provider');
    expect(() => (study as any).assertNumericInputs('consumer', { source: ref }, 0)).toThrow(/source .* is unavailable/);
    study.dispose();
  });

  it('keeps mixed placement outputs visible but rejects them as composition inputs', () => {
    const study = host();
    const mixed = instance('mixed', {
      ...result(),
      program: { ...result().program!, outputs: { ...result().program!.outputs, plots: [{ ...result().program!.outputs.plots[0]!, overlay: true }] } },
    } as any);
    (study as any).studies.set(mixed.attachmentId, mixed);
    const [output] = study.numericOutputs();
    expect(output?.available).toBe(true);
    expect(output?.composable).toBe(false);
    expect(() => (study as any).assertNumericInputs('consumer', { source: numericOutputRef(output!) }, 0)).toThrow(/no longer matches/);
    study.dispose();
  });

  it('blocks source deletion while a persisted dependent still references it', () => {
    const study = host();
    const provider = instance('provider');
    (study as any).studies.set(provider.attachmentId, provider);
    const ref = numericOutputRef(study.numericOutputs()[0]!);
    const consumer = instance('consumer', result(), { source: ref });
    (study as any).studies.set(consumer.attachmentId, consumer);

    expect(study.removeBlockReason('provider')).toContain('consumer depends on its output');
    expect(study.remove('provider')).toBe(false);
    expect(study.pins().map(item => item.attachmentId)).toEqual(['provider', 'consumer']);
    expect(provider.api.remove).not.toHaveBeenCalled();
    study.dispose();
  });

  it('keeps a hidden provider needed by a visible dependent and catches up upstream first after chart sleep', () => {
    vi.stubGlobal('document', { hidden: false });
    const calls: string[] = [];
    const study = host();
    const provider = instance('provider', result([0.004, 0.006]));
    provider.visible = false;
    (study as any).studies.set(provider.attachmentId, provider);
    const ref = numericOutputRef(study.numericOutputs()[0]!);
    const consumer = instance('consumer', result([0.005, 0.006]), { source: ref });
    consumer.visible = true;
    (study as any).studies.set(consumer.attachmentId, consumer);
    provider.worker.history.mockImplementation(() => calls.push('provider'));
    consumer.worker.history.mockImplementation(() => calls.push('consumer'));

    expect((study as any).isNeeded(provider)).toBe(true);
    study.setVisible(false);
    study.applyPatch([{ t: 1_800_000_000_000, o: 100, h: 102, l: 99, c: 101, v: 1, revision: 1, closed: false }] as any);
    expect(provider.needsHistory).toBe(true);
    expect(consumer.needsHistory).toBe(true);
    expect(calls).toEqual([]);

    study.setVisible(true);
    expect(calls).toEqual(['provider', 'consumer']);
    expect(provider.needsHistory).toBe(false);
    expect(consumer.needsHistory).toBe(false);
    study.dispose();
  });

  it('restores pinned producer-consumer pairs in dependency order regardless of save order', () => {
    const provider = pin('provider');
    const source = numericOutputRef({
      kind: 'indicator-output', version: 1, instanceId: 'provider', outputId: 'output:provider:p0', plotKey: 'p0',
      schemaId: 'number:chart-candles-v1:p0:USDT:1', domain: 'chart-candles-v1', contextId: numericOutputContextId(series),
      unit: 'USDT', scaleId: 'overlay:shared-flow', engineInstanceId: 'engine-provider', title: 'Close', revision: 1,
      contextRevision: 0, available: true, times: [], values: [],
    });
    const consumer = pin('consumer', { source });
    expect(orderStudyPinsByDependencies([consumer, provider]).map(item => item.attachmentId)).toEqual(['provider', 'consumer']);
  });
});

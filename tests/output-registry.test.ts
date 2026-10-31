import { describe, expect, it, vi } from 'vitest';
import { numericOutputId, numericOutputSchemaId, type NumericOutputRef } from '../src/scripts/composition';
import { ChartNumericOutputRegistry, managedNumericOutputBindingForToken, managedNumericOutputToken, outputRegistryForToken,
  registerChartNumericOutputRegistry, registerManagedNumericOutputBinding, type ChartNumericOutput } from '../src/scripts/output-registry';

function output(instanceId: string, values: (number | null)[], patch: Partial<ChartNumericOutput> = {}): ChartNumericOutput {
  const plotKey = 'p0', unit = 'BTC';
  return { kind: 'indicator-output', version: 1, instanceId, outputId: numericOutputId(instanceId, plotKey), plotKey,
    schemaId: numericOutputSchemaId(plotKey, unit), domain: 'chart-candles-v1', contextId: 'binance:perpetual:BTCUSDT:1m', unit,
    title: instanceId, revision: 1, contextRevision: 1, available: true,
    times: values.map((_, index) => (index + 1) * 60_000), values, quantity: 'flow', marketScope: 'binance:perpetual:BTCUSDT:1m',
    sourceScope: `study:${instanceId}`, timestampConvention: 'candle-open', quality: 'complete', resets: [], changedRange: { from: 0, to: values.length },
    ...patch };
}

function ref(value: ChartNumericOutput): NumericOutputRef {
  const { kind, version, instanceId, outputId, plotKey, schemaId, domain, contextId, unit } = value;
  return { kind, version, instanceId, outputId, plotKey, schemaId, domain, contextId, unit };
}

describe('chart-scoped numeric output registry', () => {
  it('notifies publication listeners for outputs from any producer and releases them cleanly', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const listener = vi.fn();
    const release = registry.subscribeOutputs(listener);
    const cvd = output('native-cvd', [1, 2]);
    const script = output('script-study', [3, 4]);

    registry.publish(cvd);
    registry.publish(script);
    expect(listener.mock.calls.map(([value]) => value.instanceId)).toEqual(['native-cvd', 'script-study']);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ outputId: cvd.outputId, available: true }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ outputId: script.outputId, available: true }));

    release();
    registry.publish(output('native-open-interest', [5, 6]));
    expect(listener).toHaveBeenCalledTimes(2);
    registry.dispose();
  });

  it('keeps explicit gaps, carries revisions and only marks a consumer complete for the exact current upstream revision', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const first = output('volume', [2, null, 5]);
    registry.publish(first);
    const notified = vi.fn();
    registry.registerConsumer('sma-volume', ref(first), notified);
    expect(notified).toHaveBeenCalledWith({ output: expect.objectContaining({ values: [2, null, 5] }), available: true });
    expect(registry.markConsumerComplete('sma-volume', 1, 1)).toBe(true);
    expect(registry.consumerIsCurrent('sma-volume')).toBe(true);

    registry.publish(output('volume', [2, null, 8], { revision: 2, changedRange: { from: 2, to: 3 } }));
    expect(notified).toHaveBeenCalledTimes(2);
    expect(registry.consumerIsCurrent('sma-volume')).toBe(false);
    expect(registry.markConsumerComplete('sma-volume', 1, 1)).toBe(false);
    expect(registry.markConsumerComplete('sma-volume', 2, 1)).toBe(true);
    expect(registry.consumerIsCurrent('sma-volume')).toBe(true);
    registry.dispose();
  });

  it('rebuilds missed consumer work from the full output after it sleeps and rejects stale completion', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const first = output('volume', [2, 4, 6]); registry.publish(first);
    const notified = vi.fn();
    registry.registerConsumer('sma-volume', ref(first), notified);
    expect(registry.markConsumerComplete('sma-volume', 1, 1)).toBe(true);
    registry.setConsumerActive('sma-volume', false);
    registry.publish(output('volume', [2, 4, 8], { revision: 2, changedRange: { from: 2, to: 3 } }));
    expect(notified).toHaveBeenCalledTimes(1);
    expect(registry.consumerIsCurrent('sma-volume')).toBe(false);
    registry.setConsumerActive('sma-volume', true);
    expect(notified).toHaveBeenLastCalledWith(expect.objectContaining({ available: true,
      output: expect.objectContaining({ revision: 2, changedRange: { from: 0, to: 3 } }) }));
    expect(registry.markConsumerComplete('sma-volume', 1, 1)).toBe(false);
    expect(registry.markConsumerComplete('sma-volume', 2, 1)).toBe(true);
    registry.dispose();
  });

  it('widens changed ranges on context changes and refuses semantic producer replacement while consumed', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const source = output('source', [1, 2, 3]); registry.publish(source);
    registry.registerConsumer('sma', ref(source), () => undefined);
    const changedScope = output('source', [1, 2, 3], { revision: 2, sourceScope: 'study:replacement' });
    expect(() => registry.publish(changedScope)).toThrow(/cannot change unit, quantity, source scope/);
    const newContext = output('source', [1, 2, 3], { revision: 2, contextRevision: 2, contextId: 'binance:perpetual:BTCUSDT:5m', changedRange: { from: 2, to: 3 } });
    registry.publish(newContext);
    expect(registry.get(source.outputId)?.changedRange).toEqual({ from: 0, to: 3 });
  });

  it('rejects cycles and orders upstream consumers before downstream consumers', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const source = output('source', [1, 2]); const middle = output('middle', [null, null]); const last = output('last', [null, null]);
    registry.publish(source); registry.publish(middle); registry.publish(last);
    registry.registerConsumer('middle', ref(source), () => undefined);
    registry.registerConsumer('last', ref(middle), () => undefined);
    expect(registry.dependencyOrder()).toEqual(['middle', 'last']);
    expect(() => registry.registerConsumer('source', ref(last), () => undefined)).toThrow(/dependency cycle/);
    expect([...registry.demandedProducerIds(['last'])]).toEqual(['source']);
  });

  it('preflights self and hidden saved-reference cycles before registering a candidate', () => {
    const savedConsumers: { instanceId: string; ref: NumericOutputRef }[] = [];
    const registry = new ChartNumericOutputRegistry('chart-a', undefined, () => savedConsumers);
    const first = output('sma-one', [2, 4], { sourceScope: 'native-sma:sma-one' });
    const second = output('sma-two', [null, null], { sourceScope: 'native-sma:sma-two' });
    registry.publish(first); registry.publish(second);
    // The hidden SMA2 consumer is persisted but temporarily has no live engine binding.
    savedConsumers.push({ instanceId: 'sma-two', ref: ref(first) });

    expect(() => registry.preflightConsumer('sma-one', ref(first))).toThrow(/dependency cycle/);
    expect(() => registry.preflightConsumer('sma-one', ref(second))).toThrow(/dependency cycle/);
    expect(() => registry.registerConsumer('sma-one', ref(second), () => undefined)).toThrow(/dependency cycle/);
    expect(registry.hasConsumer('sma-one')).toBe(false);
    expect(registry.get(first.outputId)).toEqual(first);
    registry.dispose();
  });

  it('does not let a disconnected saved cycle block healthy consumers but rejects links into that cycle', () => {
    const savedConsumers: { instanceId: string; ref: NumericOutputRef }[] = [];
    const registry = new ChartNumericOutputRegistry('chart-a', undefined, () => savedConsumers);
    const volume = output('volume', [1, 2]);
    const a = output('saved-a', [null, null]);
    const b = output('saved-b', [null, null]);
    registry.publish(volume); registry.publish(a); registry.publish(b);
    savedConsumers.push({ instanceId: 'saved-a', ref: ref(b) }, { instanceId: 'saved-b', ref: ref(a) });

    expect(registry.preflightConsumer('healthy-sma', ref(volume))).toBe(true);
    expect(() => registry.preflightConsumer('dependent-sma', ref(a))).toThrow(/dependency cycle/);
    registry.registerConsumer('healthy-sma', ref(volume), () => undefined);
    expect(registry.hasConsumer('healthy-sma')).toBe(true);
    expect(registry.hasConsumer('dependent-sma')).toBe(false);
    registry.dispose();
  });

  it('bounds chart value arrays and isolates engine bindings by chart registry token', () => {
    const first = new ChartNumericOutputRegistry('chart-a');
    const second = new ChartNumericOutputRegistry('chart-b');
    const unregisterFirst = registerChartNumericOutputRegistry(first), unregisterSecond = registerChartNumericOutputRegistry(second);
    const provider = output('source', [1, 2]); first.publish(provider); second.publish(output('source', [3, 4]));
    const token = managedNumericOutputToken('chart-a', provider.outputId);
    expect(outputRegistryForToken(token)).toBe(first);
    expect(outputRegistryForToken(managedNumericOutputToken('chart-b', provider.outputId))).toBe(second);
    const firstBinding = registerManagedNumericOutputBinding(first, 'sma', ref(provider));
    const secondBinding = registerManagedNumericOutputBinding(second, 'sma', ref(provider));
    expect(firstBinding.token).not.toBe(secondBinding.token);
    expect(managedNumericOutputBindingForToken(firstBinding.token)?.registry).toBe(first);
    expect(managedNumericOutputBindingForToken(secondBinding.token)?.registry).toBe(second);
    firstBinding.release(); secondBinding.release(); unregisterFirst(); unregisterSecond(); first.dispose(); second.dispose();
  });

  it('releases output arrays only after every consumer has detached', () => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const source = output('source', [1, 2]); registry.publish(source);
    const release = registry.registerConsumer('sma', ref(source), () => undefined, false);
    expect(registry.releaseOwner('source')).toBe(false);
    expect(registry.get(source.outputId)).toMatchObject({ available: false, quality: 'unavailable' });
    release();
    expect(registry.releaseOwner('source')).toBe(true);
    expect(registry.get(source.outputId)).toBeUndefined();
    expect(registry.outputsForOwner('source')).toEqual([]);
    registry.dispose();
  });

  it.each([true, false])('preflights a native SMA producer unit change before replacing it when its dependent is %s', dependentVisible => {
    const registry = new ChartNumericOutputRegistry('chart-a');
    const sma = output('sma-one', [2, 4, 6], { sourceScope: 'native-sma:sma-one' });
    registry.publish(sma);
    const dependent = vi.fn();
    registry.registerConsumer('sma-two', ref(sma), dependent, dependentVisible);

    const replacement = output('sma-one', [1, 2, 3], { sourceScope: 'native-sma:sma-one', revision: 2,
      unit: null, schemaId: numericOutputSchemaId('p0', null), quantity: 'unknown' });
    expect(() => registry.preflightReplacement(replacement)).toThrow(/cannot change unit|cannot change chart context/i);
    expect(registry.get(sma.outputId)).toEqual(sma);
    expect(registry.resolve(ref(sma))).toMatchObject({ available: true, output: { revision: 1, unit: 'BTC' } });
    expect(registry.diagnostics().consumers).toMatchObject([{ instanceId: 'sma-two', active: dependentVisible, outputId: sma.outputId }]);
    expect(dependent).toHaveBeenCalledTimes(dependentVisible ? 1 : 0);
    registry.dispose();
  });
});

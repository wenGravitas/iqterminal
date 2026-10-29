import { describe, expect, it } from 'vitest';
import { COMPOSITION_SMA_ID, nativeInstance, validateInstances } from '../src/indicators/model';
import { applyCompositionPlotPresentation, compositionPlotId, compositionScaleId, compositionSmaSettings, migrateComposition, numericOutputContextId, numericOutputRef, reconcileCompositionPaneMembership, type NumericOutputDescriptor } from '../src/scripts/composition';

const provider = { instanceId: 'volume-study', paneId: 'composition:volume-study', placement: 'pane' as const,
  definitionId: 'script:builtin.volume-histogram', visible: true, plotScaleIds: { p0: 'overlay:btc-volume' as const },
  script: { scriptId: 'builtin.volume-histogram', title: 'Volume' } };

function output(instanceId = provider.instanceId): NumericOutputDescriptor {
  return { kind: 'indicator-output', version: 1, instanceId, outputId: `output:${instanceId}:p0`, plotKey: 'p0',
    schemaId: 'number:chart-candles-v1:p0:BTC:1', domain: 'chart-candles-v1', contextId: numericOutputContextId({ venue: 'binance', market: 'perpetual', interval: '1m' }),
    unit: 'BTC', scaleId: 'overlay:btc-volume', engineInstanceId: 'engine-volume', title: 'Volume', revision: 2, contextRevision: 1,
    available: true, composable: true, times: [1, 2], values: [5, 8] };
}

describe('composition config migration and SMA instances', () => {
  it('migrates legacy script pane IDs and keeps an explicit empty pane list authoritative', () => {
    const migrated = migrateComposition(undefined, [provider]);
    expect(migrated.panes).toMatchObject([
      { id: provider.paneId, title: 'Volume', memberIds: [provider.instanceId], order: 0, weight: 1, collapsed: false },
    ]);
    expect(migrateComposition({ version: 1, panes: [] }, [provider]).panes).toEqual([]);
    expect(migrated.plots).toEqual([{ plotId: compositionPlotId(provider.instanceId, 'p0'), producerInstanceId: provider.instanceId,
      outputKey: 'p0', paneId: provider.paneId, scaleId: compositionScaleId('overlay:btc-volume'), visible: true, order: 0 }]);
    expect(migrated.scales).toEqual([{ scaleId: compositionScaleId('overlay:btc-volume'), engineScaleId: 'overlay:btc-volume',
      unit: 'BTC', policy: 'zero-based', bandMemberships: [] }]);
  });

  it('restores stable plot placement and engine scale mappings before worker restore', () => {
    const nativeScale = 'overlay:restored-volume' as const;
    const scaleId = compositionScaleId(nativeScale);
    const state = migrateComposition({ version: 1, panes: [], embeddedBands: [
      { id: 'band:volume-study', title: 'Volume', memberIds: [provider.instanceId], heightPercent: 20 },
    ], scales: [{ scaleId, engineScaleId: nativeScale, unit: 'BTC', policy: 'zero-based', bandMemberships: [{ paneId: '@price', bandId: 'band:volume-study' }] }],
      plots: [{ plotId: compositionPlotId(provider.instanceId, 'p0'), producerInstanceId: provider.instanceId, outputKey: 'p0',
        paneId: '@price', scaleId, visible: false, order: 11 }],
    }, [provider]);
    const restored = applyCompositionPlotPresentation([provider], state)[0]!;
    expect(restored).toMatchObject({ placement: 'overlay', paneId: '@price', visible: false, plotScaleIds: { p0: nativeScale } });
    expect(state.scales).toMatchObject([{ scaleId, engineScaleId: nativeScale, unit: 'BTC', policy: 'zero-based',
      bandMemberships: [{ paneId: '@price', bandId: 'band:volume-study' }] }]);
    const aligned = reconcileCompositionPaneMembership(state, [restored]);
    expect(aligned.panes).toEqual([]);
    expect(aligned.embeddedBands).toMatchObject([{ memberIds: [provider.instanceId] }]);
  });

  it('keeps one logical scale ID when dependent plots occupy different panes', () => {
    const ref = numericOutputRef(output());
    const sma = nativeInstance(COMPOSITION_SMA_ID, { length: 20, color: '#63c7b2', source: { kind: 'indicator', instanceId: provider.instanceId, plotKey: 'p0' } }, true,
      { instanceId: 'sma-volume', placement: 'overlay', paneId: '@price', numericInputs: { source: ref }, plotScaleIds: { p0: ref.scaleId } });
    const state = migrateComposition({ version: 1, panes: [], embeddedBands: [
      { id: 'band:sma-volume', title: 'Volume', memberIds: [sma.instanceId], heightPercent: 20 },
    ] }, [provider, sma]);
    expect(state.plots.map(plot => plot.scaleId)).toEqual([compositionScaleId(ref.scaleId), compositionScaleId(ref.scaleId)]);
    expect(state.plots.map(plot => plot.paneId)).toEqual([provider.paneId, '@price']);
    expect(state.scales).toMatchObject([{ scaleId: compositionScaleId(ref.scaleId), engineScaleId: ref.scaleId,
      unit: 'BTC', policy: 'zero-based', bandMemberships: [{ paneId: '@price', bandId: 'band:sma-volume' }] }]);
  });

  it('keeps legacy native pane identity, order, settings links and opaque metadata outside managed groups', () => {
    const legacy = { instanceId: 'native.multi-venue-cvd', definitionId: 'native.multi-venue-cvd', placement: 'pane',
      visible: true, settings: { paneWeight: .28, mode: 'venues' } };
    const migrated = migrateComposition(undefined, [provider, legacy], [legacy.instanceId]);
    expect(migrated.panes.map(pane => pane.memberIds)).toEqual([[provider.instanceId]]);
    expect(migrated.opaqueLegacyPanes).toEqual([{ id: 'native:native.multi-venue-cvd', ownerInstanceId: legacy.instanceId,
      order: 0, stateRef: `indicator:${legacy.instanceId}`, metadata: {} }]);
    const opaque = { ...migrated, opaqueLegacyPanes: migrated.opaqueLegacyPanes.map(record => ({ ...record, metadata: { futurePaneFlag: true } })) };
    expect(migrateComposition(JSON.parse(JSON.stringify(opaque)), [provider, legacy], [legacy.instanceId]).opaqueLegacyPanes[0]?.metadata)
      .toEqual({ futurePaneFlag: true });
    expect(migrateComposition(opaque, []).opaqueLegacyPanes).toEqual([]);
  });

  it('retains future composition state without interpreting unknown pane fields', () => {
    const raw = { version: 4, panes: [{ id: 'future', members: [{ instance: provider.instanceId, role: 'provider' }], futureLayout: { row: 3 } }],
      embeddedBands: [{ id: 'future-band', value: { lower: 0, upper: 1 } }], futureKey: { keep: true } };
    const future = migrateComposition(raw, [provider]);
    expect(future).toMatchObject({ version: 4, panes: [], embeddedBands: [], futureKey: { keep: true }, unsupportedVersionRecord: raw });
    expect(migrateComposition(JSON.parse(JSON.stringify(future)), [provider]).unsupportedVersionRecord).toEqual(raw);
  });

  it('persists embedded price-band height across reload and clamps malformed bounds', () => {
    const saved = { version: 1, panes: [], embeddedBands: [
      { id: 'band:volume-study', title: 'Volume', memberIds: [provider.instanceId], heightPercent: 34 },
    ] };
    const restored = migrateComposition(JSON.parse(JSON.stringify(saved)), [provider]);
    expect(restored.embeddedBands).toMatchObject([{ id: 'band:volume-study', memberIds: [provider.instanceId], heightPercent: 34 }]);
    expect(migrateComposition({ version: 1, panes: [], embeddedBands: [
      { id: 'small', memberIds: [provider.instanceId], heightPercent: -12 },
      { id: 'large', memberIds: [provider.instanceId], heightPercent: 99 },
      { id: 'default', memberIds: [provider.instanceId] },
    ] }, [provider]).embeddedBands.map(band => band.heightPercent)).toEqual([10, 40, 20]);
  });

  it('bounds calculation/display settings and permits multiple SMA instances with distinct refs', () => {
    expect(compositionSmaSettings({ length: 5000, color: 'red', source: { kind: 'indicator', instanceId: 'volume-study', plotKey: 'p0' } }))
      .toEqual({ length: 250, color: '#63c7b2', source: { kind: 'indicator', instanceId: 'volume-study', plotKey: 'p0' } });
    const ref = numericOutputRef(output());
    const first = nativeInstance(COMPOSITION_SMA_ID, { length: 20, color: '#63c7b2', source: { kind: 'indicator', instanceId: ref.instanceId, plotKey: ref.plotKey } }, true,
      { instanceId: 'sma-volume-20', placement: 'pane', paneId: provider.paneId, numericInputs: { source: ref }, plotScaleIds: { p0: ref.scaleId } });
    const second = { ...first, instanceId: 'sma-volume-50', settings: { ...first.settings, length: 50 } };
    expect(validateInstances([first, second])).toHaveLength(2);
    expect(validateInstances(JSON.parse(JSON.stringify([first, second])))).toMatchObject([
      { instanceId: first.instanceId, numericInputs: { source: { instanceId: provider.instanceId, scaleId: ref.scaleId } }, placement: 'pane', paneId: provider.paneId },
      { instanceId: second.instanceId, settings: { length: 50 } },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ManagedCompositionPlacementController, type ManagedCompositionPlacementSubject } from '../src/indicators/composition-placement-controller';
import { compositionPlotId, compositionScaleId, migrateComposition, validateComposition, type IndicatorCompositionState } from '../src/scripts/composition';

function fixture() {
  const panes = [{ element: {} }, { element: {} }, { element: {} }];
  const paneOf = new Map([['a', 1], ['b', 1], ['c', 2]]);
  const commits: { state: IndicatorCompositionState; placements: readonly unknown[]; scripts: boolean }[] = [];
  const errors: string[] = [];
  const scaleA = compositionScaleId('overlay:a');
  const scaleB = compositionScaleId('overlay:b');
  let state = validateComposition({ version: 1, panes: [
    { id: 'source', title: 'Source', memberIds: ['a', 'b'], order: 1, weight: 1, collapsed: false },
    { id: 'target', title: 'Target', memberIds: ['c'], order: 2, weight: 1, collapsed: false },
  ], embeddedBands: [], scales: [
    { scaleId: scaleA, engineScaleId: 'overlay:a', unit: 'BTC', policy: 'zero-based', bandMemberships: [] },
    { scaleId: scaleB, engineScaleId: 'overlay:b', unit: 'BTC', policy: 'zero-based', bandMemberships: [] },
  ], plots: ['a', 'b'].map((id, index) => ({ plotId: compositionPlotId(id, 'p0'), producerInstanceId: id, outputKey: 'p0',
    paneId: 'source', scaleId: index ? scaleB : scaleA, visible: true, order: index })), opaqueLegacyPanes: [] }, ['a', 'b', 'c']);
  const subjects: ManagedCompositionPlacementSubject[] = ['a', 'b', 'c'].map((instanceId, index) => ({
    instanceId, title: instanceId.toUpperCase(), kind: index === 1 ? 'native' : 'script',
    placement: 'pane', paneId: index === 2 ? 'target' : 'source',
    paneIndex: () => paneOf.get(instanceId) ?? -1,
    moveTo: vi.fn((_placement, _paneId, paneIndex, _silent) => {
      paneOf.set(instanceId, paneIndex);
      return true;
    }),
  }));
  const chart = {
    panes: () => panes,
    primaryPaneIndex: () => 0,
    indicators: () => [...paneOf.values()].map(paneIndex => ({ paneIndex })),
    removePane: vi.fn(),
  };
  const controller = new ManagedCompositionPlacementController({
    chart, getComposition: () => state, getSubjects: () => subjects,
    setApplying: vi.fn(),
    commit: (next, placements, scripts) => commits.push({ state: next, placements, scripts }),
    hasProtectedPaneContent: () => false,
    makePaneId: seed => `composition:${seed}`,
    reportError: message => errors.push(message), clearError: vi.fn(),
  });
  return { controller, subjects, paneOf, commits, errors, chart, state, scaleA, scaleB, setState: (next: IndicatorCompositionState) => { state = next; } };
}

describe('managed composition placement transactions', () => {
  it('owns new SMA pane membership and inherits the selected source scale explicitly', () => {
    const f = fixture();
    const plan = f.controller.planSma({ instanceId: 'sma-a', source: { instanceId: 'a', scaleId: 'overlay:a' },
      sourcePlacement: 'pane', sourcePaneId: 'source', sourceTitle: 'Source', sourceIsVolume: false }, f.state);
    expect(plan).toMatchObject({ placement: 'pane', paneId: 'source', plotScaleIds: { p0: 'overlay:a' } });
    expect(plan.composition.panes.find(pane => pane.id === 'source')?.memberIds).toEqual(['a', 'b', 'sma-a']);
  });

  it('resolves the live chart pane by logical membership across native and script subjects', () => {
    const f = fixture();
    expect(f.controller.resolveManagedPaneIndex('source')).toBe(1);
    expect(f.controller.resolveManagedPaneIndex('source', 'a')).toBe(1);
    expect(f.controller.resolveManagedPaneIndex('target')).toBe(2);
    expect(f.controller.resolveManagedPaneIndex('missing')).toBe(-1);
  });

  it('does not reuse the excluded member pane when no other logical member is live', () => {
    const f = fixture();
    f.subjects[0]!.paneIndex = () => -1;
    f.subjects[1]!.paneIndex = () => -1;
    expect(f.controller.resolveManagedPaneIndex('source', 'a')).toBe(-1);
  });

  it('uses the latest persisted plot placement while editing and changes scale only on explicit request', () => {
    const f = fixture();
    const latest = { ...f.state, plots: [...f.state.plots.map(plot => plot.producerInstanceId === 'a' ? { ...plot, paneId: 'target' } : plot),
      { plotId: compositionPlotId('sma-existing', 'p0'), producerInstanceId: 'sma-existing', outputKey: 'p0', paneId: 'target',
        scaleId: f.scaleA, visible: true, order: 4 }] };
    const keep = f.controller.planSma({ instanceId: 'sma-existing', source: { instanceId: 'a', scaleId: 'overlay:b' },
      sourcePlacement: 'overlay', sourceTitle: 'Source', sourceIsVolume: false,
      existing: { placement: 'overlay', paneId: 'stale-draft', plotScaleIds: { p0: 'overlay:a' } } }, latest);
    expect(keep).toMatchObject({ placement: 'pane', paneId: 'target', plotScaleIds: { p0: 'overlay:a' } });
    const change = f.controller.planSma({ instanceId: 'sma-existing', source: { instanceId: 'a', scaleId: 'overlay:b' },
      sourcePlacement: 'overlay', sourceTitle: 'Source', sourceIsVolume: false,
      existing: { placement: 'overlay', paneId: 'stale-draft', plotScaleIds: { p0: 'overlay:a' } }, changeScale: true }, latest);
    expect(change.plotScaleIds).toEqual({ p0: 'overlay:b' });
  });

  it('retains R1 SMA placement and scale when saved composition has authoritative empty plot arrays', () => {
    const f = fixture();
    const legacySma = { instanceId: 'sma-legacy', definitionId: 'native.composition-sma', placement: 'pane' as const,
      paneId: 'legacy-pane', visible: false, plotScaleIds: { p0: 'overlay:a' as const } };
    const migrated = migrateComposition({ version: 1, panes: [{ id: 'legacy-pane', title: 'Legacy', memberIds: ['a'], order: 1, weight: 1, collapsed: false }],
      plots: [], scales: [], embeddedBands: [], opaqueLegacyPanes: [] }, [
      { instanceId: 'a', script: { title: 'Source' }, placement: 'pane', paneId: 'legacy-pane', plotScaleIds: { p0: 'overlay:a' } }, legacySma,
    ]);
    expect(migrated.plots).toEqual([]);
    const plan = f.controller.planSma({ instanceId: legacySma.instanceId, source: { instanceId: 'a', scaleId: 'overlay:b' },
      sourcePlacement: 'overlay', sourceTitle: 'Source', sourceIsVolume: false, existing: legacySma }, migrated);
    expect(plan).toMatchObject({ placement: 'pane', paneId: 'legacy-pane', plotScaleIds: { p0: 'overlay:a' } });
  });

  it('merges a newly registered provider into an existing embedded band', () => {
    const f = fixture();
    const withBand = { ...f.state, embeddedBands: [{ id: 'volume-band', title: 'Volume', memberIds: ['a'], heightPercent: 18 }] };
    const registered = f.controller.registerMember(withBand, { instanceId: 'a-copy', title: 'A copy',
      placement: 'overlay', paneId: '@price', bandSourceId: 'a' });
    expect(registered.embeddedBands).toEqual([{ id: 'volume-band', title: 'Volume', memberIds: ['a', 'a-copy'], heightPercent: 18 }]);
  });

  it('preflights the whole group and rolls moved members back on a later failure', () => {
    const f = fixture();
    const second = f.subjects.find(subject => subject.instanceId === 'b')!;
    second.moveTo = vi.fn((placement, paneId, paneIndex, silent) => {
      if (paneId === 'target') return false;
      f.paneOf.set('b', paneIndex); return true;
    });
    expect(f.controller.move('a', 'target', true)).toBe(false);
    expect(f.paneOf.get('a')).toBe(1);
    expect(f.paneOf.get('b')).toBe(1);
    expect(f.subjects[0]!.moveTo).toHaveBeenCalledTimes(2);
    expect(f.commits).toHaveLength(0);
    expect(f.chart.removePane).not.toHaveBeenCalled();
    expect(f.errors[0]).toMatch(/Could not move B/);
  });

  it('moves the complete group into a price band, keeps each output scale separate, and commits once', () => {
    const f = fixture();
    expect(f.controller.move('a', '@price', true, 18)).toBe(true);
    expect(f.paneOf.get('a')).toBe(0);
    expect(f.paneOf.get('b')).toBe(0);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]!.scripts).toBe(true);
    expect(f.commits[0]!.state.panes.map(pane => pane.id)).toEqual(['target']);
    expect(f.commits[0]!.state.embeddedBands).toEqual([{ id: 'band:a', title: 'A', memberIds: ['a', 'b'], heightPercent: 18 }]);
    expect(f.commits[0]!.state.plots.map(plot => plot.paneId)).toEqual(['@price', '@price']);
    expect(f.commits[0]!.state.plots.map(plot => plot.scaleId)).toEqual([f.scaleA, f.scaleB]);
    expect(f.commits[0]!.state.scales.map(scale => scale.bandMemberships)).toEqual([
      [{ paneId: '@price', bandId: 'band:a' }], [{ paneId: '@price', bandId: 'band:a' }],
    ]);
    expect(f.chart.removePane).toHaveBeenCalledWith(1, { force: true });
  });

  it('keeps a zero based Volume band inside the destination managed lower pane', () => {
    const f = fixture();
    expect(f.controller.move('a', 'target', true, 20, true)).toBe(true);
    expect(f.commits[0]!.state.panes.find(pane => pane.id === 'target')?.memberIds).toEqual(['c', 'a', 'b']);
    expect(f.commits[0]!.state.embeddedBands).toEqual([{ id: 'band:a', title: 'Target', memberIds: ['a', 'b'], heightPercent: 20 }]);
    expect(f.commits[0]!.state.plots.map(plot => plot.paneId)).toEqual(['target', 'target']);
    expect(f.commits[0]!.state.scales.map(scale => scale.bandMemberships)).toEqual([
      [{ paneId: 'target', bandId: 'band:a' }], [{ paneId: 'target', bandId: 'band:a' }],
    ]);
  });

  it('retains a managed source pane when only one member moves away', () => {
    const f = fixture();
    // CVD uses a native series/primitive, not a chart indicator entry.
    f.chart.indicators = () => [];
    expect(f.controller.move('a', 'target', false)).toBe(true);
    expect(f.paneOf.get('a')).toBe(2);
    expect(f.paneOf.get('b')).toBe(1);
    expect(f.chart.removePane).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(1);
  });

  it('adopts a legacy native pane for a selected numeric source without changing its order or geometry',()=>{
    const element={};
    const sourceId='cvd-native',legacyPaneId='native:cvd-pane';
    const source:ManagedCompositionPlacementSubject={instanceId:sourceId,title:'Multi-Venue CVD',kind:'native',placement:'pane',paneId:legacyPaneId,
      paneIndex:()=>1,moveTo:vi.fn(()=>true)};
    const state=validateComposition({version:1,panes:[],embeddedBands:[],scales:[],plots:[],opaqueLegacyPanes:[
      {id:legacyPaneId,ownerInstanceId:sourceId,order:4,stateRef:`indicator:${sourceId}`,metadata:{}},
    ]},[sourceId]);
    const controller=new ManagedCompositionPlacementController({
      chart:{panes:()=>[{element:{}},{element}],primaryPaneIndex:()=>0,paneWeight:()=>.28,paneCollapsed:()=>true,indicators:()=>[],removePane:()=>{}},
      getComposition:()=>state,getSubjects:()=>[source],setApplying:()=>{},commit:()=>{},reportError:()=>{},clearError:()=>{},
    });
    const plan=controller.planSma({instanceId:'sma-cvd',source:{instanceId:sourceId,scaleId:'overlay:cvd-btc'},sourcePlacement:'pane',
      sourcePaneId:legacyPaneId,sourceTitle:'Multi-Venue CVD',sourceIsVolume:false},state);
    expect(plan.paneId).toBe(legacyPaneId);
    expect(plan.composition.panes).toEqual([{id:legacyPaneId,title:'Multi-Venue CVD',memberIds:[sourceId,'sma-cvd'],order:4,weight:.28,collapsed:true}]);
    expect(plan.composition.opaqueLegacyPanes).toEqual([]);
  });

  it('does not turn a main-price band into a lower-pane band unless selected explicitly', () => {
    const f = fixture();
    for (const id of ['a', 'b']) { f.paneOf.set(id, 0); f.subjects.find(subject => subject.instanceId === id)!.paneId = '@price'; }
    f.setState({ ...f.state, panes: f.state.panes.filter(pane => !pane.memberIds.includes('a') && !pane.memberIds.includes('b')),
      embeddedBands: [{ id: 'price-band', title: 'Volume', memberIds: ['a', 'b'], heightPercent: 35 }],
      plots: f.state.plots.map(plot => ({ ...plot, paneId: '@price' })) });
    expect(f.controller.move('a', 'target', true, 35, false)).toBe(true);
    expect(f.commits[0]!.state.embeddedBands).toEqual([]);
    expect(f.commits[0]!.state.plots.map(plot => plot.paneId)).toEqual(['target', 'target']);
  });

  it('rejects an unavailable member before moving any part of the group', () => {
    const f = fixture();
    const member = f.subjects.find(subject => subject.instanceId === 'b')!;
    member.paneIndex = () => -1;
    expect(f.controller.move('a', 'target', true)).toBe(false);
    expect(f.paneOf.get('a')).toBe(1);
    expect(f.subjects[0]!.moveTo).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(0);
    expect(f.errors[0]).toMatch(/B.*unavailable/);
  });
});

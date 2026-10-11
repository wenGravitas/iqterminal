import { describe, it, expect, vi } from 'vitest';
import { config } from '../src/panel';
import { FOOTPRINT_ID, HEATMAP_ID, IndicatorLifecycle, nativeInstance, studyPins, withStudyPins, validateInstances } from '../src/indicators/model';
import { ScriptStudyHost, type StudyPin } from '../src/scripts/host';
const pin: StudyPin = { attachmentId: 'ema20', scriptId: 'builtin.ema', revisionId: 'a'.repeat(64), title: 'EMA', description: 'Average', settings: { length: 20 }, visible: true };
const legacy = { venue: 'binance', interval: '1m', type: 'footprint', rowPrice: 25, footprintUnits: 'usdt', footprint: { opacity: .35, displayMode: 'delta' }, heatmap: { enabled: true, opacity: .65, mode: 'peak' }, studies: [pin], unrelated: { preserved: true } };
describe('unified indicator configuration', () => {
  it('migrates native modes and pinned scripts once with stable IDs, settings and unrelated fields', () => {
    const migrated = config(legacy);
    expect(migrated.indicatorVersion).toBe(1); expect(migrated.indicators.map(i => i.definitionId)).toEqual([FOOTPRINT_ID, 'script:builtin.ema', HEATMAP_ID]);
    expect(migrated.footprint.opacity).toBe(.35); expect(migrated.footprintUnits).toBe('usdt'); expect(migrated.heatmap.opacity).toBe(.65);
    expect((migrated as any).unrelated).toEqual({ preserved: true });
    expect(config(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(config(config(config(legacy)))).toEqual(migrated);
  });
  it('hiding/removing footprint restores base presentation without changing its saved preference', () => {
    const visible = config({ ...legacy, basePriceVisible: false });
    const hidden = config({ ...visible, indicators: visible.indicators.map(i => i.definitionId === FOOTPRINT_ID ? { ...i, visible: false } : i) });
    expect(hidden.type).toBe('candle'); expect(hidden.basePriceVisible).toBe(false); expect(hidden.heatmap.enabled).toBe(true); expect(hidden.rowPrice).toBe(25);
    const removed = config({ ...hidden, indicators: hidden.indicators.filter(i => i.definitionId !== FOOTPRINT_ID) });
    expect(removed.type).toBe('candle'); expect(removed.footprint.opacity).toBe(.35); expect(config(removed).indicators.some(i => i.definitionId === FOOTPRINT_ID)).toBe(false);
  });
  it('uses the authoritative empty list and enforces singleton identity but permits isolated scripts', () => {
    expect(config({ ...legacy, indicators: [] }).indicators).toEqual([]);
    const c = config(legacy), duplicate = { ...c.indicators[0]!, instanceId: 'another-footprint' };
    expect(validateInstances([...c.indicators, duplicate])).toHaveLength(3);
    const pins = [pin, { ...pin, attachmentId: 'ema50', settings: { length: 50 } }];
    const result = withStudyPins(c.indicators, pins);
    expect(studyPins(result).map(p => p.settings.length)).toEqual([20,50]);
    expect(config({ ...c, indicators: result }).studies).toEqual(pins);
  });
  it('retains unknown definitions and future settings without activating or duplicating them', () => {
    const unknownScript = nativeInstance('script:future-language', { retained: true });
    expect(withStudyPins([unknownScript], [])).toEqual([unknownScript]);
    const future = nativeInstance('future.tpo', { range: [1,2], anchor: 'session' }); future.settingsVersion = 9;
    const c = config({ ...legacy, indicators: [future, { ...nativeInstance(FOOTPRINT_ID, { rowPrice: 100 }), settingsVersion: 9 }] });
    expect(c.type).toBe('candle'); expect(config(c).indicators).toEqual(c.indicators); expect(c.indicators[0]!.settings.range).toEqual([1,2]);
    expect(config({ ...legacy, venue: 'hyperliquid' }).indicators.some(i => i.definitionId === FOOTPRINT_ID)).toBe(true);
    expect(config({ ...legacy, venue: 'hyperliquid' }).type).toBe('candle');
  });
});
describe('indicator lifecycle', () => {
  it('updates settings and visibility without recreating ownership and disposes exactly once', () => {
    const create = vi.fn(() => ({ updateSettings: vi.fn(), setVisible: vi.fn(), dispose: vi.fn() }));
    const lifecycle = new IndicatorLifecycle(create), a = nativeInstance(FOOTPRINT_ID, { rowPrice: 25 }), b = nativeInstance(HEATMAP_ID, { rowPrice: 25 });
    lifecycle.reconcile([a,b]); lifecycle.reconcile([a,b]);
    expect(create).toHaveBeenCalledTimes(2);
    const first = create.mock.results[0]!.value, second = create.mock.results[1]!.value;
    lifecycle.reconcile([{ ...a, visible: false }, b]); expect(first.setVisible).toHaveBeenCalledWith(false); expect(first.dispose).not.toHaveBeenCalled();
    lifecycle.reconcile([{ ...a, settings: { rowPrice: 50 } },b]); expect(first.updateSettings).toHaveBeenCalledWith({ rowPrice: 50 });
    lifecycle.reconcile([b]); expect(first.dispose).toHaveBeenCalledTimes(1); expect(second.dispose).not.toHaveBeenCalled();
    lifecycle.dispose(); lifecycle.dispose(); expect(second.dispose).toHaveBeenCalledTimes(1);
  });
  it('releases ownership before an instance becomes an unavailable source binding', () => {
    const dispose = vi.fn();
    const create = vi.fn((i: any) => i.source.kind === 'chart' ? { updateSettings() {}, setVisible() {}, dispose } : undefined);
    const lifecycle = new IndicatorLifecycle(create), instance = nativeInstance(FOOTPRINT_ID, { rowPrice: 25 });
    lifecycle.reconcile([instance]);
    lifecycle.reconcile([{ ...instance, source: { kind: 'future-explicit-market' } }]);
    expect(dispose).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(2);
    lifecycle.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('isolates a native creation failure while continuing other indicators', () => {
    const failure = vi.fn(), second = vi.fn();
    const lifecycle = new IndicatorLifecycle(i => { if (i.definitionId === FOOTPRINT_ID) throw new Error('No renderer'); second(); return { updateSettings() {}, setVisible() {}, dispose() {} }; }, failure);
    lifecycle.reconcile([nativeInstance(FOOTPRINT_ID,{}),nativeInstance(HEATMAP_ID,{})]);
    expect(failure).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1); lifecycle.dispose();
  });
  it('rejects queued applies after removal, market changes and panel destruction', async () => {
    const host = new ScriptStudyHost('chart-test', {} as any, {} as any, {} as any, { venue: 'binance', interval: '1m' }, () => {});
    const draft = { attachmentId:'race', scriptId:'local.test', source:'never compiled', title:'Race', description:'', settings:{} };
    const removed = host.apply(draft); host.remove('race'); await expect(removed).rejects.toThrow('Apply cancelled');
    const changed = host.apply(draft); host.setSeries({venue:'hyperliquid',interval:'5m'}); await expect(changed).rejects.toThrow('Apply cancelled');
    const closed = host.apply(draft); host.dispose(); await expect(closed).rejects.toThrow('Apply cancelled');
  });
  it('preserves missing revision pins and supports removal before restoration completes', async () => {
    let resolve!: (value: unknown) => void;
    const library = { getRevision: () => new Promise(r => { resolve = r; }) };
    const saves: StudyPin[][] = [];
    const host = new ScriptStudyHost('chart-test', {} as any, {} as any, library as any, { venue: 'binance', interval: '1m' }, pins => saves.push(pins));
    host.restore([pin]); expect(host.pins()).toEqual([pin]);
    host.setSnapshot([{ t: 0,o: 1,h: 1,l: 1,c: 1,v: 1,closed: false,revision: 1 }]);
    host.remove(pin.attachmentId); resolve(null); await new Promise(r => setTimeout(r, 0));
    expect(host.pins()).toEqual([]); expect(host.views()).toEqual([]); host.dispose();
  });
  it('keeps an unavailable revision pin recoverable after failure and an unrelated save', async () => {
    const host = new ScriptStudyHost('chart-test', {} as any, {} as any, { getRevision: async () => null } as any, { venue: 'binance', interval: '1m' }, () => {});
    host.restore([pin]); host.setSnapshot([{ t: 0,o: 1,h: 1,l: 1,c: 1,v: 1,closed: false,revision: 1 }]);
    await new Promise(r => setTimeout(r, 0)); expect(host.views()[0]!.status).toContain('missing'); expect(host.pins()).toEqual([pin]);
    host.setVisibleStudy(pin.attachmentId, false); expect(host.pins()[0]!.visible).toBe(false); host.dispose();
  });
});

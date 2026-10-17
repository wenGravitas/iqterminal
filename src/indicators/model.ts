import { validStudyPins, type StudyPin, type ScriptInputView } from '../scripts/host';
import type { ScriptRecord } from '../scripts/library';
import { DEFAULT_ORDER_WALLS_SETTINGS, ORDER_WALLS_ID, orderWallsSettings } from '../feed/order-walls';
export { ORDER_WALLS_ID } from '../feed/order-walls';

export const INDICATOR_CONFIG_VERSION = 1;
export const FOOTPRINT_ID = 'native.footprint';
export const HEATMAP_ID = 'native.orderbook-heatmap';
export type Placement = 'price-presentation' | 'overlay' | 'pane' | 'attachment';
export interface SettingField { key: string; label: string; kind: string; defaultValue: unknown }
export interface IndicatorDefinition {
  id: string; name: string; description: string; category: string; implementation: 'builtin' | 'scripted';
  settingsVersion: number; defaults: Record<string, unknown>; settingsSchema: readonly SettingField[];
  placements: readonly Placement[]; dataRequirements: readonly string[]; sourceBinding: 'chart';
  multiplicity: 'single' | 'multiple'; capabilities: { editScript: boolean; duplicate: boolean };
}
export interface IndicatorInstance {
  instanceId: string; definitionId: string; settingsVersion: number; visible: boolean;
  source: { kind: string; [key: string]: unknown }; placement: Placement; settings: Record<string, unknown>;
  /** Immutable script revision pin. Its settings/visibility are held by the instance. */
  script?: Omit<StudyPin, 'attachmentId' | 'settings' | 'visible'>;
}
export const DEFAULT_FOOTPRINT_VIEW = { displayMode: 'bidask' as const, cellStyle: 'ladder' as const, statsPosition: 'bottom' as const, opacity: .85, showCandle: true, showPoc: true, showValueArea: true, showDiagonalImbalances: true, stackedImbalances: false, imbalanceRatio: 3 as const, imbalanceThreshold: .01 };
export const NATIVE_DEFINITIONS: readonly IndicatorDefinition[] = [
  { id: FOOTPRINT_ID, name: 'Footprint', description: 'Observed executed bid/ask volume · Binance BTCUSDT Spot and USD-M Perp', category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { rowPrice: 25, units: 'btc', view: DEFAULT_FOOTPRINT_VIEW }, settingsSchema: [
      { key: 'rowPrice', label: 'Price level (USDT)', kind: 'number', defaultValue: 25 },
      { key: 'units', label: 'Volume units', kind: 'select', defaultValue: 'btc' },
      ...['displayMode','cellStyle','statsPosition','opacity','showCandle','showPoc','showValueArea','showDiagonalImbalances','stackedImbalances','imbalanceRatio','imbalanceThreshold'].map(key => ({ key: `view.${key}`, label: key, kind: 'native', defaultValue: DEFAULT_FOOTPRINT_VIEW[key as keyof typeof DEFAULT_FOOTPRINT_VIEW] }))],
    placements: ['price-presentation'], dataRequirements: ['executions'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: HEATMAP_ID, name: 'Order-book Heatmap', description: 'Observed resting liquidity · Binance BTCUSDT Spot and USD-M Perp', category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { rowPrice: 10, bucketMs: 500, mode: 'average', opacity: .85, intensity: 100, minimum: .01, labels: 'auto', bids: true, asks: true },
    settingsSchema: [
      { key: 'rowPrice', label: 'Price row (USDT)', kind: 'number', defaultValue: 10 },
      { key: 'bucketMs', label: 'Time bucket', kind: 'select', defaultValue: 500 },
      { key: 'mode', label: 'Resting quantity', kind: 'select', defaultValue: 'average' },
      ...['opacity', 'intensity', 'minimum'].map(key => ({ key, label: key, kind: 'number', defaultValue: key === 'opacity' ? .85 : key === 'intensity' ? 100 : .01 })),
      { key: 'labels', label: 'Quantity labels', kind: 'select', defaultValue: 'auto' },
      ...['bids', 'asks'].map(key => ({ key, label: `Show ${key}`, kind: 'boolean', defaultValue: true }))],
    placements: ['overlay'], dataRequirements: ['synchronized-book'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: ORDER_WALLS_ID, name: 'Order Walls', description: 'Observed resting BTC liquidity walls · Binance BTCUSDT Spot and USD-M Perp', category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { ...DEFAULT_ORDER_WALLS_SETTINGS }, settingsSchema: [
      { key: 'method', label: 'Detection', kind: 'select', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.method },
      { key: 'relativePercentile', label: 'Relative percentile', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.relativePercentile },
      { key: 'relativeFloorUsd', label: 'Relative USD floor', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.relativeFloorUsd },
      { key: 'thresholdUsd', label: 'Absolute notional (USD)', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.thresholdUsd },
      { key: 'aggregation', label: 'Price aggregation', kind: 'select', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.aggregation },
      { key: 'colorMode', label: 'Wall colour', kind: 'select', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.colorMode },
      { key: 'thicknessPx', label: 'Line thickness (px)', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.thicknessPx },
      { key: 'opacity', label: 'Opacity', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.opacity },
      { key: 'showHistory', label: 'Show historical walls', kind: 'boolean', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.showHistory },
      { key: 'exitRatio', label: 'Exit threshold ratio', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.exitRatio },
      { key: 'minDurationMs', label: 'Minimum confirmation (ms)', kind: 'number', defaultValue: DEFAULT_ORDER_WALLS_SETTINGS.minDurationMs }],
    placements: ['overlay'], dataRequirements: ['order-book-history'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
];
export function scriptDefinition(record: ScriptRecord, inputs: readonly ScriptInputView[] = []): IndicatorDefinition {
  const revision = record.revisions.find(r => r.id === record.currentRevision);
  const depth = revision?.declaredCapabilities.includes('iqterminal.depth.series.v1');
  return { id: `script:${record.id}`, name: record.title, description: record.description,
    category: !record.builtin ? 'My Scripts' : depth ? 'Order Flow' : record.id === 'builtin.volume-histogram' ? 'Volume' : 'Trend',
    implementation: 'scripted', settingsVersion: 1, defaults: Object.fromEntries(inputs.map(input => [input.key, input.defaultValue])), settingsSchema: inputs,
    placements: ['overlay', 'pane'], dataRequirements: depth ? ['candles', 'depth-series'] : ['candles'], sourceBinding: 'chart',
    multiplicity: 'multiple', capabilities: { editScript: true, duplicate: true } };
}
export function nativeDefinition(id: string) { return NATIVE_DEFINITIONS.find(d => d.id === id); }
export function scriptInstance(pin: StudyPin): IndicatorInstance {
  const { attachmentId, settings, visible, ...script } = pin;
  return { instanceId: attachmentId, definitionId: `script:${pin.scriptId}`, settingsVersion: 1, visible, source: { kind: 'chart' }, placement: pin.placement ?? 'overlay', settings, script };
}
export function studyPins(instances: readonly IndicatorInstance[]): StudyPin[] {
  return validStudyPins(instances.filter(i => i.settingsVersion === 1 && i.source.kind === 'chart' && i.script && i.definitionId === `script:${i.script.scriptId}`).map(i => ({ ...i.script, attachmentId: i.instanceId, settings: i.settings, visible: i.visible })));
}
export function nativeInstance(id: string, settings: Record<string, unknown>, visible = true): IndicatorInstance {
  return { instanceId: id, definitionId: id, settingsVersion: 1, visible, source: { kind: 'chart' }, placement: id === FOOTPRINT_ID ? 'price-presentation' : 'overlay', settings };
}
/** Bounded plain configuration. Unknown definitions and future settings versions remain recoverable. */
export function validateInstances(value: unknown): IndicatorInstance[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>(), singletons = new Set<string>();
  const result: IndicatorInstance[] = [];
  for (const raw of value.slice(0, 24)) {
    if (!raw || typeof raw !== 'object' || typeof raw.instanceId !== 'string' || !raw.instanceId || raw.instanceId.length > 120
      || typeof raw.definitionId !== 'string' || raw.definitionId.length > 160 || !Number.isInteger(raw.settingsVersion) || raw.settingsVersion < 1
      || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings) || ids.has(raw.instanceId)) continue;
    const definition = nativeDefinition(raw.definitionId);
    if (definition && singletons.has(definition.id)) continue;
    let copy: IndicatorInstance;
    try { const json = JSON.stringify(raw); if (json.length > 12000) continue; copy = JSON.parse(json); } catch { continue; }
    copy.visible = raw.visible !== false; copy.source = raw.source && typeof raw.source === 'object' && typeof raw.source.kind === 'string' ? copy.source : { kind: 'chart' };
    copy.placement = definition?.placements[0] ?? (['overlay','pane','attachment','price-presentation'].includes(raw.placement) ? raw.placement : 'overlay');
    if (copy.definitionId === ORDER_WALLS_ID && copy.settingsVersion === 1) copy.settings = { ...orderWallsSettings(copy.settings) };
    if (raw.definitionId.startsWith('script:')) {
      const pin = studyPins([{ ...copy, source: { kind: 'chart' }, settingsVersion: 1 }])[0];
      if (pin) copy = { ...scriptInstance(pin), settingsVersion: raw.settingsVersion, placement: copy.placement, source: copy.source };
    }
    ids.add(copy.instanceId); if (definition) singletons.add(definition.id); result.push(copy);
  }
  return result;
}
export function migrateIndicators(source: Record<string, unknown>, legacy: {
  type: string; rowPrice: number; footprintUnits: string; footprint: unknown; heatmap: { enabled: boolean }; studies: StudyPin[];
}): IndicatorInstance[] {
  // Presence is authoritative even for an empty array: removed natives must never return on reload.
  if (Array.isArray(source.indicators)) return validateInstances(source.indicators);
  const result = legacy.studies.map(scriptInstance);
  if (legacy.type === 'footprint') result.unshift(nativeInstance(FOOTPRINT_ID, { rowPrice: legacy.rowPrice, units: legacy.footprintUnits, view: legacy.footprint }));
  if (legacy.heatmap.enabled) result.push(nativeInstance(HEATMAP_ID, { ...legacy.heatmap }));
  return result;
}
/** Script host stays authoritative for successful applies, including editor operations. */
export function withStudyPins(instances: readonly IndicatorInstance[], pins: StudyPin[]) {
  const native = instances.filter(i => !i.definitionId.startsWith('script:') || i.settingsVersion !== 1 || i.source.kind !== 'chart' || !studyPins([i]).length);
  return validateInstances([...native, ...pins.map(scriptInstance)]);
}

/** Runtime handles never enter saved configuration. Existing hosts own all calculations/resources. */
export interface IndicatorHandle {
  updateSettings(settings: Record<string, unknown>): void | Promise<void>;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export class IndicatorLifecycle {
  private handles = new Map<string, { instance: IndicatorInstance; handle: IndicatorHandle }>();
  constructor(private create: (instance: IndicatorInstance) => IndicatorHandle | undefined, private failed: (instance: IndicatorInstance, error: unknown) => void = () => {}) {}
  reconcile(instances: readonly IndicatorInstance[]) {
    const wanted = new Set(instances.map(i => i.instanceId));
    for (const [id, item] of this.handles) if (!wanted.has(id)) { this.handles.delete(id); try { item.handle.dispose(); } catch (error) { this.failed(item.instance, error); } }
    for (const instance of instances) {
      try {
      let old = this.handles.get(instance.instanceId);
      if (old && (old.instance.definitionId !== instance.definitionId || old.instance.settingsVersion !== instance.settingsVersion || JSON.stringify(old.instance.source) !== JSON.stringify(instance.source))) {
        this.handles.delete(instance.instanceId); old.handle.dispose(); old = undefined;
      }
      if (!old) { const handle = this.create(instance); if (handle) this.handles.set(instance.instanceId, { instance, handle }); }
      else {
        const previous = old.instance; old.instance = instance;
        if (JSON.stringify(previous.settings) !== JSON.stringify(instance.settings)) Promise.resolve(old.handle.updateSettings(instance.settings)).catch(error => this.failed(instance, error));
        if (previous.visible !== instance.visible) old.handle.setVisible(instance.visible);
        old.instance = instance;
      }
      } catch (error) { this.failed(instance, error); }
    }
  }
  dispose() { for (const item of this.handles.values()) { try { item.handle.dispose(); } catch (error) { this.failed(item.instance,error); } } this.handles.clear(); }
}

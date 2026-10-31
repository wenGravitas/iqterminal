import { registerIndicator, type Bar, type IndicatorAttachContext, type IndicatorCalcContext, type IndicatorDescriptor, type IndicatorSettings, type IndicatorStore, type IndicatorStudySource, type PriceScaleId } from 'openalgo-charts';
import { connectionKey, instrumentOf, type Series } from '../feed/protocol';
import { managedNumericOutputBindingForToken, type ChartNumericOutput, type ChartNumericOutputRegistry, type NumericChangedRange, type NumericOutputResolution } from './output-registry';

export const INDICATOR_COMPOSITION_VERSION = 1;
export const INDICATOR_COMPOSITION_SMA_ID = 'native.composition-sma';
export const PRICE_PANE_ID = '@price';
export const MAX_COMPOSITION_PANES = 16;
export const MAX_COMPOSITION_MEMBERS = 24;
export const MAX_COMPOSITION_PLOTS = 8;
export const MAX_COMPOSITION_PLOT_RECORDS = 24 * MAX_COMPOSITION_PLOTS;
export const MIN_EMBEDDED_BAND_HEIGHT_PERCENT = 10;
export const MAX_EMBEDDED_BAND_HEIGHT_PERCENT = 40;
export const DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT = 20;

const compositionSmaMetrics = { fullCalls: 0, fullInputValues: 0, tailCalls: 0, tailInputValues: 0, tailValuesProcessed: 0,
  registryRevisions: 0, registryFullValuesProcessed: 0, registryTailValuesProcessed: 0, derivedPublications: 0 };
export function resetCompositionSmaMetrics() {
  compositionSmaMetrics.fullCalls = 0; compositionSmaMetrics.fullInputValues = 0;
  compositionSmaMetrics.tailCalls = 0; compositionSmaMetrics.tailInputValues = 0; compositionSmaMetrics.tailValuesProcessed = 0;
  compositionSmaMetrics.registryRevisions = 0; compositionSmaMetrics.registryFullValuesProcessed = 0;
  compositionSmaMetrics.registryTailValuesProcessed = 0; compositionSmaMetrics.derivedPublications = 0;
}
export function compositionSmaDiagnostics() { return { ...compositionSmaMetrics }; }

export type NumericUnit = string | null;
export type NumericOutputRef = {
  kind: 'indicator-output';
  version: 1;
  instanceId: string;
  outputId: string;
  plotKey: string;
  schemaId: string;
  domain: 'chart-candles-v1';
  contextId: string;
  unit: NumericUnit;
};

export interface NumericOutputDescriptor extends NumericOutputRef {
  /** Present only for providers backed by a live OpenAlgo study API. */
  engineInstanceId?: string;
  title: string;
  revision: number;
  contextRevision: number;
  contextId: string;
  available: boolean;
  /** Presentation assignment belongs to the output view, never its saved numeric link. */
  scaleId: PriceScaleId;
  times: readonly number[];
  values: readonly (number | null)[];
  /** False when the producer has mixed placement or special layers that cannot join a managed pane. */
  composable?: boolean;
  /** Authoritative half-open range changed by the latest provider revision. */
  changedRange?: NumericChangedRange;
}

export interface CompositionPaneRecord {
  id: string;
  title: string;
  memberIds: string[];
  order: number;
  weight: number;
  collapsed: boolean;
}

export interface EmbeddedBandRecord {
  id: string;
  title: string;
  memberIds: string[];
  heightPercent: number;
}

/** Stable presentation metadata for one declared plot. It never stores engine pane indices or data. */
export interface CompositionPlotRecord {
  plotId: string;
  producerInstanceId: string;
  outputKey: string;
  paneId: string;
  /** Logical composition scale ID; the scale table maps it to the chart adapter. */
  scaleId: string;
  visible: boolean;
  order: number;
}

export interface CompositionScaleRecord {
  scaleId: string;
  engineScaleId: PriceScaleId;
  unit: NumericUnit;
  policy: 'auto' | 'zero-based';
  bandMemberships: { paneId: string; bandId: string }[];
}

/** Opaque links for panes still owned by legacy native indicators. */
export interface OpaqueLegacyPaneRecord {
  id: string;
  ownerInstanceId: string;
  order: number;
  /** Stable pointer to the native indicator settings that remain authoritative for pane size and teardown. */
  stateRef: string;
  metadata: Record<string, unknown>;
}

export interface IndicatorCompositionState {
  version: number;
  panes: CompositionPaneRecord[];
  embeddedBands: EmbeddedBandRecord[];
  scales: CompositionScaleRecord[];
  plots: CompositionPlotRecord[];
  opaqueLegacyPanes: OpaqueLegacyPaneRecord[];
  [key: string]: unknown;
}

export function numericOutputId(instanceId: string, plotKey: string) {
  return `output:${instanceId}:${plotKey}`;
}

export function compositionPlotId(instanceId: string, outputKey: string) {
  return `plot:${numericOutputId(instanceId, outputKey)}`;
}

export function compositionScaleId(engineScaleId: PriceScaleId) {
  return `scale:${stableHash(engineScaleId)}`;
}

/** Stable identity for the exact exchange candle series used by a provider. */
export function numericOutputContextId(series: Series) {
  return `${connectionKey(series)}:${instrumentOf(series).native}`;
}

export function numericOutputSchemaId(plotKey: string, unit: NumericUnit) {
  return `number:chart-candles-v1:${plotKey}:${unit ?? 'unknown'}:1`;
}

/** A short, deterministic scale identity; unknown units intentionally never share. */
export function numericOutputScaleId(paneId: string, outputId: string, unit: NumericUnit): PriceScaleId {
  const source = unit ? `${paneId}:unit:${unit}` : `${paneId}:output:${outputId}`;
  return `overlay:iq-${stableHash(source)}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function isNumericOutputRef(value: unknown): value is NumericOutputRef {
  if (!isRecord(value) || value.kind !== 'indicator-output' || value.version !== 1
    || typeof value.instanceId !== 'string' || !value.instanceId || value.instanceId.length > 120
    || typeof value.outputId !== 'string' || value.outputId.length > 300
    || typeof value.plotKey !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value.plotKey)
    || typeof value.schemaId !== 'string' || value.schemaId.length > 300
    || value.domain !== 'chart-candles-v1'
    || typeof value.contextId !== 'string' || !value.contextId || value.contextId.length > 160
    || !(value.unit === null || typeof value.unit === 'string' && value.unit.length <= 32)) return false;
  return value.outputId === numericOutputId(value.instanceId, value.plotKey)
    && value.schemaId === numericOutputSchemaId(value.plotKey, value.unit);
}

export function validateNumericInputs(value: unknown): Record<string, NumericOutputRef> {
  if (!isRecord(value)) return {};
  const result: Record<string, NumericOutputRef> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_COMPOSITION_PLOTS)) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) && isNumericOutputRef(item)) result[key] = {
      kind: item.kind, version: item.version, instanceId: item.instanceId, outputId: item.outputId, plotKey: item.plotKey,
      schemaId: item.schemaId, domain: item.domain, contextId: migrateNumericOutputContextId(item.contextId), unit: item.unit,
    };
  }
  return result;
}

/** R1 included the candle interval in a saved output context; v2 scopes links to the market. */
export function migrateNumericOutputContextId(contextId: string) {
  const match = /^(binance:(?:spot|perpetual):BTCUSDT|hyperliquid:perpetual:BTC|bybit:perpetual:BTCUSDT):(?:1m|5m|15m|30m|1h|4h|1d)$/.exec(contextId);
  return match?.[1] ?? contextId;
}

export interface CompositionSmaSettings {
  length: number;
  color: string;
}

export function compositionSmaSettings(value: unknown): CompositionSmaSettings {
  const raw = isRecord(value) ? value : {};
  return {
    length: clampPeriod(raw.length),
    color: typeof raw.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw.color) ? raw.color : '#63c7b2',
  };
}

export function compositionPaneId(instanceId: string) {
  return `composition:${instanceId}`.slice(0, 120);
}

/** Rebuild old script-only groups and presentation links without adopting native-owned panes. */
export function migrateComposition(value: unknown, instances: readonly CompositionMigrationInstance[], paneOrder: readonly string[] = []) {
  const instanceIds = instances.map(instance => instance.instanceId);
  if (isRecord(value)) {
    const current = validateComposition(value, instanceIds);
    if (current.version !== INDICATOR_COMPOSITION_VERSION) return current;
    const hasSavedPresentation = Array.isArray(value.plots) && Array.isArray(value.scales);
    const plots = hasSavedPresentation ? current.plots : seedCompositionPlots(instances);
    const scales = hasSavedPresentation ? current.scales : seedCompositionScales(plots, instances, current.embeddedBands);
    const opaqueLegacyPanes = Array.isArray(value.opaqueLegacyPanes)
      ? current.opaqueLegacyPanes : seedOpaqueLegacyPanes(instances, paneOrder);
    return validateComposition({ ...current, plots, scales, opaqueLegacyPanes }, instanceIds);
  }
  const grouped = new Map<string, { title: string; members: string[] }>();
  for (const instance of instances) {
    if (!instance.paneId || instance.paneId === PRICE_PANE_ID || instance.placement !== 'pane') continue;
    if (!instance.script) continue;
    const group = grouped.get(instance.paneId) ?? { title: instance.script?.title ?? 'Indicator pane', members: [] };
    group.members.push(instance.instanceId);
    grouped.set(instance.paneId, group);
  }
  return validateComposition({ version: INDICATOR_COMPOSITION_VERSION,
    panes: [...grouped].map(([id, group], order) => makeCompositionPane(id, group.title, group.members, order)),
    embeddedBands: [],
    plots: seedCompositionPlots(instances),
    scales: seedCompositionScales(seedCompositionPlots(instances), instances),
    opaqueLegacyPanes: seedOpaqueLegacyPanes(instances, paneOrder),
  }, instanceIds);
}

export interface CompositionMigrationInstance {
  instanceId: string;
  definitionId?: string;
  paneId?: string;
  placement?: string;
  visible?: boolean;
  script?: { title?: string; scriptId?: string };
  plotScaleIds?: Record<string, PriceScaleId>;
  numericInputs?: Record<string, NumericOutputRef>;
  settings?: Record<string, unknown>;
}

/** Materialize old pin presentation fields as stable plot records. */
export function seedCompositionPlots(instances: readonly CompositionMigrationInstance[]): CompositionPlotRecord[] {
  const plots: CompositionPlotRecord[] = [];
  instances.slice(0, 24).forEach((instance, instanceIndex) => {
    const scales = instance.plotScaleIds ?? {};
    const keys = Object.keys(scales).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).slice(0, MAX_COMPOSITION_PLOTS);
    if (instance.definitionId === INDICATOR_COMPOSITION_SMA_ID && !keys.includes('p0')) keys.push('p0');
    const paneId = typeof instance.paneId === 'string' && instance.paneId.length <= 120
      ? instance.paneId : instance.placement === 'pane' ? `study:${instance.instanceId}`.slice(0, 120) : PRICE_PANE_ID;
    keys.forEach((outputKey, plotIndex) => {
      const scaleId = scales[outputKey] ?? (outputKey === 'p0' ? instance.plotScaleIds?.p0 : undefined);
      if (!scaleId || !isPriceScaleId(scaleId)) return;
      plots.push({ plotId: compositionPlotId(instance.instanceId, outputKey), producerInstanceId: instance.instanceId,
        outputKey, paneId, scaleId: compositionScaleId(scaleId), visible: instance.visible !== false,
        order: instanceIndex * MAX_COMPOSITION_PLOTS + plotIndex });
    });
  });
  return plots.slice(0, MAX_COMPOSITION_PLOT_RECORDS);
}

export function seedCompositionScales(
  plots: readonly CompositionPlotRecord[],
  instances: readonly CompositionMigrationInstance[],
  bands: readonly EmbeddedBandRecord[] = [],
): CompositionScaleRecord[] {
  const byEngineScale = new Map<string, CompositionScaleRecord>();
  const byId = new Map(instances.map(instance => [instance.instanceId, instance]));
  for (const plot of plots) {
    const instance = byId.get(plot.producerInstanceId);
    const engineScaleId = instance?.plotScaleIds?.[plot.outputKey]
      ?? (plot.outputKey === 'p0' ? instance?.plotScaleIds?.p0 : undefined);
    if (!engineScaleId || !isPriceScaleId(engineScaleId)) continue;
    const scaleId = compositionScaleId(engineScaleId);
    const current = byEngineScale.get(engineScaleId);
    const band = bands.find(item => item.memberIds.includes(plot.producerInstanceId));
    const isVolume = instance?.script?.scriptId === 'builtin.volume-histogram' && plot.outputKey === 'p0';
    const unit = isVolume ? 'BTC' : instance?.definitionId === INDICATOR_COMPOSITION_SMA_ID
      ? instance.numericInputs?.source?.unit ?? null : null;
    if (current) {
      if (current.policy !== 'zero-based' && isVolume) current.policy = 'zero-based';
      if (band && !current.bandMemberships.some(item => item.paneId === plot.paneId && item.bandId === band.id)) {
        current.bandMemberships.push({ paneId: plot.paneId, bandId: band.id });
      }
      if (current.unit === null && unit !== null) current.unit = unit;
      continue;
    }
    byEngineScale.set(engineScaleId, { scaleId, engineScaleId, unit, policy: isVolume ? 'zero-based' : 'auto',
      bandMemberships: band ? [{ paneId: plot.paneId, bandId: band.id }] : [] });
  }
  return [...byEngineScale.values()].slice(0, MAX_COMPOSITION_PLOT_RECORDS);
}

export function applyCompositionPlotPresentation<T extends CompositionMigrationInstance>(
  instances: readonly T[], state: Pick<IndicatorCompositionState, 'plots' | 'scales'>,
): T[] {
  const scales = new Map(state.scales.map(scale => [scale.scaleId, scale.engineScaleId]));
  const groups = new Map<string, CompositionPlotRecord[]>();
  for (const plot of state.plots) {
    const items = groups.get(plot.producerInstanceId) ?? [];
    items.push(plot); groups.set(plot.producerInstanceId, items);
  }
  const result = instances.map(instance => {
    const plots = groups.get(instance.instanceId)?.slice().sort((a, b) => a.order - b.order) ?? [];
    if (!plots.length) return instance;
    const first = plots[0]!;
    const plotScaleIds = { ...(instance.plotScaleIds ?? {}) };
    for (const plot of plots) {
      const engineScaleId = scales.get(plot.scaleId);
      if (engineScaleId) plotScaleIds[plot.outputKey] = engineScaleId;
    }
    return { ...instance, paneId: first.paneId,
      placement: first.paneId === PRICE_PANE_ID ? 'overlay' : 'pane', visible: first.visible, plotScaleIds };
  });

  // Preserve legacy/native array slots. Managed output owners are ordered within
  // their stable logical pane using persisted plot order, before worker restore.
  const ownersByPane = new Map<string, { index: number; order: number }[]>();
  result.forEach((instance, index) => {
    const plots = groups.get(instance.instanceId);
    if (!plots?.length) return;
    const paneId = plots[0]!.paneId;
    const owners = ownersByPane.get(paneId) ?? [];
    owners.push({ index, order: Math.min(...plots.map(plot => plot.order)) }); ownersByPane.set(paneId, owners);
  });
  for (const owners of ownersByPane.values()) {
    if (owners.length < 2) continue;
    const slots = owners.map(item => item.index).sort((a, b) => a - b);
    const ordered = [...owners].sort((a, b) => a.order - b.order).map(item => result[item.index]!);
    slots.forEach((slot, index) => { result[slot] = ordered[index]!; });
  }
  return result;
}

/** Align managed membership to saved plot placements before creating chart workers. */
export function reconcileCompositionPaneMembership(
  state: IndicatorCompositionState,
  instances: readonly CompositionMigrationInstance[],
): IndicatorCompositionState {
  const plotsByOwner = new Map<string, CompositionPlotRecord[]>();
  for (const plot of state.plots) {
    const plots = plotsByOwner.get(plot.producerInstanceId) ?? [];
    plots.push(plot); plotsByOwner.set(plot.producerInstanceId, plots);
  }
  const paneByOwner = new Map([...plotsByOwner].map(([id, plots]) => [id, plots[0]!.paneId]));
  const panes = state.panes.map(pane => ({ ...pane, memberIds: pane.memberIds.filter(id => {
    const target = paneByOwner.get(id);
    return target === undefined || target === pane.id;
  }) })).filter(pane => pane.memberIds.length);
  const bands = state.embeddedBands.map(band => ({ ...band, memberIds: band.memberIds.filter(id => {
    const target = paneByOwner.get(id);
    return target === undefined || target === PRICE_PANE_ID;
  }) })).filter(band => band.memberIds.length);
  const instancesById = new Map(instances.map(instance => [instance.instanceId, instance]));
  const paneRecords = [...panes];
  for (const [ownerId, targetPane] of paneByOwner) {
    if (targetPane === PRICE_PANE_ID) continue;
    const instance = instancesById.get(ownerId);
    let pane = paneRecords.find(item => item.id === targetPane);
    if (!pane) {
      pane = makeCompositionPane(targetPane, instance?.script?.title ?? 'Indicator pane', [], paneRecords.length);
      paneRecords.push(pane);
    }
    if (!pane.memberIds.includes(ownerId) && pane.memberIds.length < MAX_COMPOSITION_MEMBERS) pane.memberIds.push(ownerId);
  }
  return validateComposition({ ...state, panes: paneRecords, embeddedBands: bands }, instances.map(instance => instance.instanceId));
}

function seedOpaqueLegacyPanes(instances: readonly CompositionMigrationInstance[], paneOrder: readonly string[]): OpaqueLegacyPaneRecord[] {
  return instances.slice(0, 24).flatMap((instance, index) => {
    if (instance.script || instance.definitionId === INDICATOR_COMPOSITION_SMA_ID || instance.placement !== 'pane') return [];
    const id = typeof instance.paneId === 'string' && instance.paneId.length <= 120
      ? instance.paneId : `native:${instance.instanceId}`.slice(0, 120);
    const order = paneOrder.indexOf(instance.instanceId);
    return [{ id, ownerInstanceId: instance.instanceId, order: order >= 0 ? order : index,
      stateRef: `indicator:${instance.instanceId}`, metadata: {} }];
  });
}

export function validatePlotScaleIds(value: unknown): Record<string, PriceScaleId> {
  if (!isRecord(value)) return {};
  const result: Record<string, PriceScaleId> = {};
  for (const [key, scaleId] of Object.entries(value).slice(0, MAX_COMPOSITION_PLOTS)) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) && typeof scaleId === 'string' && isPriceScaleId(scaleId)) result[key] = scaleId;
  }
  return result;
}

export function validateComposition(value: unknown, instanceIds?: readonly string[]): IndicatorCompositionState {
  const source = isRecord(value) ? cloneBoundedRecord(value) : null;
  if (!source) return { version: INDICATOR_COMPOSITION_VERSION, panes: [], embeddedBands: [], scales: [], plots: [], opaqueLegacyPanes: [] };
  const version = Number.isInteger(source.version) && Number(source.version) > 0 ? Number(source.version) : INDICATOR_COMPOSITION_VERSION;
  if (version !== INDICATOR_COMPOSITION_VERSION) {
    // Keep unsupported layouts inert for this runtime while preserving the
    // complete bounded record so a later version can recover it after saves.
    const retained = isRecord(source.unsupportedVersionRecord) && source.unsupportedVersionRecord.version === version
      ? source.unsupportedVersionRecord : source;
    return { ...source, version, panes: [], embeddedBands: [], scales: [], plots: [], opaqueLegacyPanes: [], unsupportedVersionRecord: cloneBoundedRecord(retained) ?? retained };
  }
  const allowed = instanceIds === undefined ? null : new Set(instanceIds);
  const panes: CompositionPaneRecord[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(source.panes) ? source.panes.slice(0, MAX_COMPOSITION_PANES) : []) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || raw.id === PRICE_PANE_ID || raw.id.length > 120 || ids.has(raw.id)) continue;
    const memberIds = Array.isArray(raw.memberIds)
      ? [...new Set(raw.memberIds.filter((id): id is string => typeof id === 'string' && id.length <= 120 && (!allowed || allowed.has(id))))].slice(0, MAX_COMPOSITION_MEMBERS)
      : [];
    if (!memberIds.length) continue;
    ids.add(raw.id);
    panes.push({
      ...cloneBoundedRecord(raw) ?? {},
      id: raw.id,
      title: typeof raw.title === 'string' && raw.title.length <= 80 ? raw.title : 'Indicator pane',
      memberIds,
      order: Number.isInteger(raw.order) ? Math.max(0, Math.min(64, Number(raw.order))) : panes.length,
      weight: typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? Math.max(.05, Math.min(20, raw.weight)) : 1,
      collapsed: raw.collapsed === true,
    });
  }
  const embeddedIds = new Set<string>();
  const embeddedBands: EmbeddedBandRecord[] = [];
  for (const raw of Array.isArray(source.embeddedBands) ? source.embeddedBands.slice(0, MAX_COMPOSITION_PANES) : []) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 120 || embeddedIds.has(raw.id)) continue;
    const memberIds = Array.isArray(raw.memberIds)
      ? [...new Set(raw.memberIds.filter((id): id is string => typeof id === 'string' && id.length <= 120 && (!allowed || allowed.has(id))))].slice(0, MAX_COMPOSITION_MEMBERS)
      : [];
    if (!memberIds.length) continue;
    embeddedIds.add(raw.id);
    embeddedBands.push({ ...cloneBoundedRecord(raw) ?? {}, id: raw.id,
      title: typeof raw.title === 'string' && raw.title.length <= 80 ? raw.title : 'Embedded indicator band', memberIds,
      heightPercent: typeof raw.heightPercent === 'number' && Number.isFinite(raw.heightPercent)
        ? Math.max(MIN_EMBEDDED_BAND_HEIGHT_PERCENT, Math.min(MAX_EMBEDDED_BAND_HEIGHT_PERCENT, raw.heightPercent))
        : DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT });
  }
  const scales: CompositionScaleRecord[] = [];
  const scaleIds = new Set<string>();
  const engineScaleIds = new Set<string>();
  const bandIds = new Set(embeddedBands.map(band => band.id));
  for (const raw of Array.isArray(source.scales) ? source.scales.slice(0, MAX_COMPOSITION_PLOT_RECORDS) : []) {
    if (!isRecord(raw) || typeof raw.engineScaleId !== 'string' || !isPriceScaleId(raw.engineScaleId)
      || raw.scaleId !== compositionScaleId(raw.engineScaleId)
      || !(raw.unit === null || typeof raw.unit === 'string' && raw.unit.length <= 32)
      || raw.policy !== 'auto' && raw.policy !== 'zero-based'
      || !Array.isArray(raw.bandMemberships) || scaleIds.has(raw.scaleId) || engineScaleIds.has(raw.engineScaleId)) continue;
    const bandMemberships: CompositionScaleRecord['bandMemberships'] = [];
    for (const membership of raw.bandMemberships.slice(0, MAX_COMPOSITION_PANES)) {
      if (!isRecord(membership) || typeof membership.paneId !== 'string' || !membership.paneId || membership.paneId.length > 120
        || typeof membership.bandId !== 'string' || membership.bandId.length > 120 || !bandIds.has(membership.bandId)
        || bandMemberships.some(item => item.paneId === membership.paneId)) continue;
      bandMemberships.push({ paneId: membership.paneId, bandId: membership.bandId });
    }
    const scale = { scaleId: raw.scaleId, engineScaleId: raw.engineScaleId, unit: raw.unit,
      policy: raw.policy, bandMemberships } as CompositionScaleRecord;
    scaleIds.add(scale.scaleId); engineScaleIds.add(scale.engineScaleId); scales.push(scale);
  }
  const plots: CompositionPlotRecord[] = [];
  const plotIds = new Set<string>();
  const ownerPresentation = new Map<string, { paneId: string; visible: boolean }>();
  for (const raw of Array.isArray(source.plots) ? source.plots.slice(0, MAX_COMPOSITION_PLOT_RECORDS) : []) {
    const scale = isRecord(raw) && typeof raw.scaleId === 'string' ? scales.find(item => item.scaleId === raw.scaleId) : undefined;
    if (!isRecord(raw) || typeof raw.producerInstanceId !== 'string' || !raw.producerInstanceId || raw.producerInstanceId.length > 120
      || allowed && !allowed.has(raw.producerInstanceId)
      || typeof raw.outputKey !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.outputKey)
      || typeof raw.paneId !== 'string' || !raw.paneId || raw.paneId.length > 120
      || typeof raw.scaleId !== 'string' || !scaleIds.has(raw.scaleId)
      || typeof raw.visible !== 'boolean' || !Number.isInteger(raw.order)) continue;
    const plotId = compositionPlotId(raw.producerInstanceId, raw.outputKey);
    if (raw.plotId !== plotId || plotIds.has(plotId)) continue;
    const previous = ownerPresentation.get(raw.producerInstanceId);
    if (previous && (previous.paneId !== raw.paneId || previous.visible !== raw.visible)) continue;
    ownerPresentation.set(raw.producerInstanceId, { paneId: raw.paneId, visible: raw.visible });
    plotIds.add(plotId);
    plots.push({ plotId, producerInstanceId: raw.producerInstanceId, outputKey: raw.outputKey, paneId: raw.paneId,
      scaleId: raw.scaleId, visible: raw.visible, order: Math.max(0, Math.min(MAX_COMPOSITION_PLOT_RECORDS - 1, Number(raw.order))) });
  }
  plots.sort((a, b) => a.order - b.order || a.plotId.localeCompare(b.plotId));
  const opaqueLegacyPanes: OpaqueLegacyPaneRecord[] = [];
  const legacyIds = new Set<string>();
  for (const raw of Array.isArray(source.opaqueLegacyPanes) ? source.opaqueLegacyPanes.slice(0, MAX_COMPOSITION_PANES) : []) {
    const copy = isRecord(raw) ? cloneBoundedRecord(raw) : null;
    if (!copy || typeof copy.id !== 'string' || !copy.id || copy.id.length > 120
      || typeof copy.ownerInstanceId !== 'string' || !copy.ownerInstanceId || copy.ownerInstanceId.length > 120
      || allowed && !allowed.has(copy.ownerInstanceId)
      || !Number.isInteger(copy.order) || typeof copy.stateRef !== 'string' || copy.stateRef.length > 180
      || !isRecord(copy.metadata) || legacyIds.has(copy.id)) continue;
    legacyIds.add(copy.id);
    opaqueLegacyPanes.push({ ...copy, id: copy.id, ownerInstanceId: copy.ownerInstanceId,
      order: Math.max(0, Math.min(64, Number(copy.order))), stateRef: copy.stateRef, metadata: copy.metadata });
  }
  const usedScaleIds = new Set(plots.map(plot => plot.scaleId));
  return { ...source, version, panes, embeddedBands, scales: scales.filter(scale => usedScaleIds.has(scale.scaleId)), plots, opaqueLegacyPanes };
}

export function makeCompositionPane(id: string, title: string, memberIds: readonly string[], order: number, weight = 1): CompositionPaneRecord {
  return { id, title: title.slice(0, 80) || 'Indicator pane', memberIds: [...new Set(memberIds)].slice(0, MAX_COMPOSITION_MEMBERS), order, weight: Math.max(.05, Math.min(20, weight)), collapsed: false };
}

export function addCompositionMember(state: unknown, paneId: string, title: string, memberId: string, instanceIds: readonly string[] = []): IndicatorCompositionState {
  const allowed = [...new Set([...instanceIds, memberId])];
  const current = validateComposition(state, allowed);
  const panes = current.panes.map(pane => ({ ...pane, memberIds: [...pane.memberIds] }));
  let pane = panes.find(item => item.id === paneId);
  if (!pane) {
    if (panes.length >= MAX_COMPOSITION_PANES) return current;
    pane = makeCompositionPane(paneId, title, [], panes.length);
    panes.push(pane);
  }
  if (!pane.memberIds.includes(memberId) && pane.memberIds.length < MAX_COMPOSITION_MEMBERS) pane.memberIds.push(memberId);
  return validateComposition({ ...current, panes }, allowed);
}

export function removeCompositionMember(state: unknown, memberId: string, instanceIds: readonly string[] = []): IndicatorCompositionState {
  const current = validateComposition(state, [...instanceIds, memberId]);
  return validateComposition({ ...current, panes: current.panes
    .map(pane => ({ ...pane, memberIds: pane.memberIds.filter(id => id !== memberId) }))
    .filter(pane => pane.memberIds.length > 0), embeddedBands: current.embeddedBands
      .map(band => ({ ...band, memberIds: band.memberIds.filter(id => id !== memberId) }))
      .filter(band => band.memberIds.length > 0) }, instanceIds);
}

export function outputUnitForScript(scriptId: string, plotKey: string, declaredFormat?: string): NumericUnit {
  if (scriptId === 'builtin.volume-histogram' && plotKey === 'p0') return 'BTC';
  void declaredFormat;
  return null;
}

/** Resolve a plot's declared format into the exchange unit exposed by its numeric provider. */
export function outputUnitForPlot(
  scriptId: string,
  plot: { key: string; priceFormat?: unknown },
  _program: { meta: { format?: unknown }; inputs: readonly { key: string; default: readonly unknown[] }[] },
  _settings: Record<string, unknown>,
  _series: Series,
): NumericUnit {
  return outputUnitForScript(scriptId, plot.key);
}

export function numericOutputRef(output: NumericOutputDescriptor): NumericOutputRef {
  return {
    kind: 'indicator-output', version: 1, instanceId: output.instanceId, outputId: output.outputId,
    plotKey: output.plotKey, schemaId: output.schemaId, domain: output.domain,
    contextId: output.contextId, unit: output.unit,
  };
}

/** Compute a full window only; null or non-finite input breaks the window. */
export function fullWindowSma(values: readonly (number | null)[], length: number): (number | null)[] {
  const period = clampPeriod(length);
  const output: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  let validCount = 0;
  for (let index = 0; index < values.length; index++) {
    const value = finiteOrNull(values[index]);
    if (value === null) {
      sum = 0;
      validCount = 0;
      continue;
    }
    sum += value;
    validCount++;
    if (validCount > period) {
      const removed = finiteOrNull(values[index - period]);
      if (removed !== null) sum -= removed;
      validCount--;
    }
    if (validCount === period) output[index] = sum / period;
  }
  return output;
}

export function fullWindowSmaTail(values: readonly (number | null)[], length: number, fromIndex: number) {
  const period = clampPeriod(length);
  const start = Math.max(0, Math.min(values.length, Math.trunc(fromIndex)));
  if (start === values.length) return [];
  const scanStart = Math.max(0, start - period + 1);
  const output: (number | null)[] = Array(values.length - start).fill(null);
  let sum = 0;
  let validCount = 0;
  for (let index = scanStart; index < values.length; index++) {
    const value = finiteOrNull(values[index]);
    if (value === null) { sum = 0; validCount = 0; }
    else {
      sum += value;
      validCount++;
      if (validCount > period) {
        const removed = finiteOrNull(values[index - period]);
        if (removed !== null) sum -= removed;
        validCount--;
      }
      if (index >= start && validCount === period) output[index - start] = sum / period;
    }
  }
  return output;
}

/** Compute only the affected full-window SMA suffix, with bounded lookback and reset-aware warmup. */
export function fullWindowSmaRange(values: readonly (number | null)[], length: number, fromIndex: number, toIndex: number,
  times: readonly number[] = [], resets: readonly { fromTime: number; reason?: string }[] = []) {
  const period = clampPeriod(length);
  const start = Math.max(0, Math.min(values.length, Math.trunc(fromIndex)));
  const end = Math.max(start, Math.min(values.length, Math.trunc(toIndex)));
  if (start === end) return [] as (number | null)[];
  const scanStart = Math.max(0, start - period + 1);
  const resetIndices = new Set<number>();
  if (times.length === values.length) {
    for (const reset of resets) {
      let low = 0, high = times.length;
      while (low < high) { const middle = (low + high) >>> 1; if (times[middle]! < reset.fromTime) low = middle + 1; else high = middle; }
      if (low < end) resetIndices.add(low);
    }
  }
  const output = Array<(number | null)>(end - start).fill(null);
  let sum = 0, validCount = 0;
  for (let index = scanStart; index < end; index++) {
    if (resetIndices.has(index)) { sum = 0; validCount = 0; }
    const value = finiteOrNull(values[index]);
    if (value === null) { sum = 0; validCount = 0; }
    else {
      sum += value;
      validCount++;
      if (validCount > period) {
        const removed = finiteOrNull(values[index - period]);
        if (removed !== null) sum -= removed;
        validCount--;
      }
      if (index >= start && validCount === period) output[index - start] = sum / period;
    }
  }
  return output;
}

/** Maximum non-negative finite value in a bounded logical visible range. */
export function visibleRangeMaximum(values: readonly (number | null)[], from: number, to: number, contextBars = 1) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !values.length) return null;
  const padding = Math.max(0, Math.min(3, Number.isFinite(contextBars) ? Math.trunc(contextBars) : 1));
  const start = Math.max(0, Math.floor(Math.min(from, to)) - padding);
  const end = Math.min(values.length, Math.ceil(Math.max(from, to)) + padding + 1);
  let maximum = 0;
  for (let index = start; index < end; index++) {
    const value = finiteOrNull(values[index]);
    if (value !== null && value >= maximum) maximum = value;
  }
  return { maximum, scannedValues: Math.max(0, end - start) };
}

interface ManagedCompositionSmaState {
  registry: ChartNumericOutputRegistry;
  consumerId: string;
  ref: NumericOutputRef;
  source?: ChartNumericOutput;
  sourceRevision: number;
  contextId: string;
  contextRevision: number;
  period: number;
  values: (number | null)[];
  available: boolean;
  pendingRecompute: boolean;
  pendingRevision: number;
  dead: boolean;
}

const MANAGED_SMA_STORE_KEY = '__iqterminalManagedCompositionSmaV1';

function managedSmaState(store: IndicatorStore): ManagedCompositionSmaState | undefined {
  const value = store[MANAGED_SMA_STORE_KEY];
  return value && typeof value === 'object' ? value as ManagedCompositionSmaState : undefined;
}

function scheduleManagedSmaRecompute(state: ManagedCompositionSmaState, context: IndicatorAttachContext) {
  state.pendingRevision = state.sourceRevision;
  if (state.pendingRecompute) return;
  state.pendingRecompute = true;
  queueMicrotask(() => {
    state.pendingRecompute = false;
    if (state.dead || context.signal?.aborted || state.pendingRevision !== state.sourceRevision
      || !state.registry.consumerIsCurrent(state.consumerId)) return;
    context.requestRecompute();
  });
}

function managedSmaOutput(state: ManagedCompositionSmaState, source: ChartNumericOutput, period: number,
  values: readonly (number | null)[], full: boolean, changedRange: { from: number; to: number }): ChartNumericOutput {
  const output: ChartNumericOutput = {
    kind: 'indicator-output', version: 1, instanceId: state.consumerId,
    outputId: numericOutputId(state.consumerId, 'p0'), plotKey: 'p0',
    schemaId: numericOutputSchemaId('p0', source.unit), domain: 'chart-candles-v1', contextId: source.contextId, unit: source.unit,
    title: `SMA ${period} · ${source.title}`, revision: source.revision, contextRevision: source.contextRevision,
    available: true, times: source.times, values,
    quantity: source.quantity, marketScope: source.marketScope, sourceScope: `native-sma:${state.consumerId}`,
    timestampConvention: source.timestampConvention, quality: source.quality, resets: source.resets,
    changedRange: full ? { from: 0, to: source.values.length } : changedRange,
  };
  return output;
}

function publishManagedSmaOutput(state: ManagedCompositionSmaState, output: ChartNumericOutput) {
  state.registry.publish(output);
  compositionSmaMetrics.derivedPublications++;
}

function applyManagedSmaInput(state: ManagedCompositionSmaState, resolution: NumericOutputResolution, period: number,
  context: IndicatorAttachContext) {
  compositionSmaMetrics.registryRevisions++;
  const source = resolution.output;
  if (!resolution.available || !source) {
    state.available = false;
    state.source = source;
    state.registry.markUnavailable(state.consumerId, resolution.reason ?? 'The selected numeric output is unavailable.');
    scheduleManagedSmaRecompute(state, context);
    return;
  }
  const previous = state.source;
  const n = source.values.length;
  const resetChanged = previous !== undefined && JSON.stringify(previous.resets) !== JSON.stringify(source.resets);
  const full = !previous || !state.available || state.contextId !== source.contextId
    || state.contextRevision !== source.contextRevision || state.period !== period || state.values.length !== n
    || resetChanged || source.changedRange.from === 0 && source.changedRange.to === n;
  const from = full ? 0 : Math.max(0, Math.min(n, source.changedRange.from));
  const to = full ? n : Math.max(from, Math.min(n, source.changedRange.to + period - 1));
  // Before the first calculation (and after a context reset), the derived
  // cache is empty. Preflight only needs a correctly shaped candidate to
  // validate metadata and replacement compatibility; reuse the source column
  // until the derived values are populated rather than allocating a 5k-value
  // placeholder on every revision.
  const candidateValues = state.values.length === n ? state.values : source.values;
  const candidate = managedSmaOutput(state, source, period, candidateValues, full, { from, to });
  state.registry.preflight(candidate);
  const changed = fullWindowSmaRange(source.values, period, from, to, source.times, source.resets);
  compositionSmaMetrics.registryTailValuesProcessed += from === 0 && to === n ? 0 : Math.max(0, to - Math.max(0, from - period + 1));
  if (full) {
    compositionSmaMetrics.registryFullValuesProcessed += n;
    state.values = changed;
  } else {
    for (let index = from; index < to; index++) state.values[index] = changed[index - from] ?? null;
  }
  state.source = source;
  state.sourceRevision = source.revision;
  state.contextId = source.contextId;
  state.contextRevision = source.contextRevision;
  state.period = period;
  state.available = true;
  if (!state.registry.markConsumerComplete(state.consumerId, source.revision, source.contextRevision)) return;
  publishManagedSmaOutput(state, managedSmaOutput(state, source, period, state.values, full, { from, to }));
  if (to > from) scheduleManagedSmaRecompute(state, context);
}

function attachManagedCompositionSma(context: IndicatorAttachContext) {
  const token = String(context.settings().managedOutputToken ?? '');
  const binding = managedNumericOutputBindingForToken(token);
  if (!binding) return undefined;
  const state: ManagedCompositionSmaState = {
    registry: binding.registry, consumerId: binding.consumerId, ref: binding.ref,
    sourceRevision: 0, contextId: binding.ref.contextId, contextRevision: 0,
    period: clampPeriod(context.settings().length), values: [], available: false,
    pendingRecompute: false, pendingRevision: 0, dead: false,
  };
  context.store[MANAGED_SMA_STORE_KEY] = state;
  managedSmaContexts.set(state, context);
  const release = binding.registry.registerConsumer(binding.consumerId, binding.ref,
    resolution => applyManagedSmaInput(state, resolution, clampPeriod(context.settings().length), context), true);
  return () => {
    state.dead = true;
    release();
    managedSmaContexts.delete(state);
    if (managedSmaState(context.store) === state) delete context.store[MANAGED_SMA_STORE_KEY];
  };
}

function managedSmaValues(bars: readonly Bar[], settings: Readonly<IndicatorSettings>, store: IndicatorStore) {
  const state = managedSmaState(store);
  if (!state) return Array<(number | null)>(bars.length).fill(null);
  const period = clampPeriod(settings.length);
  if (state.available && state.source && period !== state.period) {
    applyManagedSmaInput(state, { output: state.source, available: true }, period,
      // `calc` may follow a settings change outside the registry callback. Keep
      // calculation in the engine call; downstream notifications stay queued.
      managedSmaAttachContextForRecompute(state));
  }
  if (!state.available || state.values.length !== bars.length) return Array<(number | null)>(bars.length).fill(null);
  return state.values;
}

function managedSmaAttachContextForRecompute(state: ManagedCompositionSmaState): IndicatorAttachContext {
  // The attach context is held in a module-private weak map to keep it out of
  // persisted configuration and registry metadata.
  const context = managedSmaContexts.get(state);
  if (!context) throw new Error('Managed SMA attachment is no longer available.');
  return context;
}

const managedSmaContexts = new WeakMap<ManagedCompositionSmaState, IndicatorAttachContext>();

const compositionSma: IndicatorDescriptor = {
  id: INDICATOR_COMPOSITION_SMA_ID,
  name: 'SMA',
  category: 'Volume',
  placement: 'pane',
  inputs: [
    { key: 'managedOutputToken', type: 'text', label: 'Output binding', default: '', visibleWhen: { any: [] } },
    { key: 'length', type: 'number', label: 'Length', default: 20, min: 1, max: 250, step: 1 },
    { key: 'color', type: 'color', label: 'Line colour', default: '#63c7b2' },
  ],
  plots: [{ key: 'p0', type: 'line', title: 'SMA', style: { lineWidth: 1.5 }, colorKey: 'color' }],
  attach: attachManagedCompositionSma,
  calc(bars, settings, store) {
    return { p0: managedSmaValues(bars, settings, store) };
  },
  calcTail(bars, settings, fromIndex, _previous, store) {
    const values = managedSmaValues(bars, settings, store);
    const start = Math.max(0, Math.min(values.length, Math.trunc(fromIndex)));
    compositionSmaMetrics.tailCalls++;
    const tail = values.slice(start);
    compositionSmaMetrics.tailValuesProcessed += tail.length;
    return { p0: tail };
  },
};

registerIndicator(compositionSma);

export function studyOutputSource(instanceId: string, plotKey: string): IndicatorStudySource {
  return { kind: 'indicator', instanceId, plotKey };
}

export function isStudySource(value: unknown): value is IndicatorStudySource {
  return isRecord(value) && value.kind === 'indicator' && typeof value.instanceId === 'string' && !!value.instanceId
    && typeof value.plotKey === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value.plotKey);
}

export function wouldCreateCycle(targetInstanceId: string, sourceInstanceId: string, dependencies: ReadonlyMap<string, readonly string[]>): boolean {
  if (targetInstanceId === sourceInstanceId) return true;
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetInstanceId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (dependencies.get(id) ?? []).some(visit);
  };
  return visit(sourceInstanceId);
}

/** Remap only references that point inside the copied group. */
export function remapNumericOutputReferences<T extends { instanceId: string; numericInputs?: Record<string, NumericOutputRef> }>(
  members: readonly T[],
  newInstanceIds: ReadonlyMap<string, string>,
): T[] {
  return members.map(member => ({
    ...member,
    instanceId: newInstanceIds.get(member.instanceId) ?? member.instanceId,
    ...(member.numericInputs ? { numericInputs: Object.fromEntries(Object.entries(member.numericInputs).map(([key, ref]) => {
      const mapped = newInstanceIds.get(ref.instanceId);
      if (!mapped) return [key, { ...ref }];
      const outputId = numericOutputId(mapped, ref.plotKey);
      return [key, { ...ref, instanceId: mapped, outputId, schemaId: numericOutputSchemaId(ref.plotKey, ref.unit) }];
    })) } : {}),
  }));
}

function clampPeriod(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(250, Math.floor(value))) : 20;
}

function finiteOrNull(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

function isPriceScaleId(value: string): value is PriceScaleId {
  return value === 'right' || value === 'left' || value === '' || value.startsWith('overlay:');
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneBoundedRecord(value: Record<string, any>): Record<string, any> | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 32_000) return null;
    const copy = JSON.parse(serialized);
    return isRecord(copy) ? copy : null;
  } catch { return null; }
}

import { LIQUIDATIONS_ID, liquidationSettings } from '../liquidations/settings';
import { CVD_ID,cvdSettings } from '../feed/cvd';
import { DAILY_VWAP_ID, DEFAULT_DAILY_VWAP, dailyVwapSettings } from './daily-vwap';
import { EFFORT_RESULT_ID, DEFAULT_EFFORT, effortSettings, effortRecord } from '../effort-result/settings';
import { MARKET_CONDITIONS_ID, DEFAULT_CONDITIONS, conditionsSettings } from '../market-conditions/settings';
import { validStudyPins, type StudyPin, type ScriptInputView } from '../scripts/host';
import type { ScriptRecord } from '../scripts/library';
import { DEFAULT_ORDER_WALLS_SETTINGS, ORDER_WALLS_ID, orderWallsSettings } from '../feed/order-walls';
import type { NetPositioningMethod, NetPositioningVenue } from '../feed/net-positioning';
import type { NetPositioningDisplay } from '../chart/net-positioning-layout';
import { DEFAULT_TPO_INDICATOR_SETTINGS, tpoIndicatorSettings } from './tpo-settings';
import { TRADE_BUBBLES_ID, TRADE_BUBBLE_DEFAULT_SETTINGS, tradeBubbleSettings } from '../trade-bubbles/model';
export { ORDER_WALLS_ID } from '../feed/order-walls';

export const INDICATOR_CONFIG_VERSION = 1;
export const FOOTPRINT_ID = 'native.footprint';
export const FOOTPRINT_TOTALS_ID = 'native.footprint-totals';
export const TPO_ID = 'native.tpo';
export const DEFAULT_FOOTPRINT_TOTALS_ROWS = ['volume', 'bidVolume', 'askVolume', 'delta'] as const;
export type FootprintTotalsSettings = { rows: import('openalgo-charts/profile').FootprintStatRow[]; highlightHighest: boolean };
const FOOTPRINT_TOTAL_ROWS: readonly import('openalgo-charts/profile').FootprintStatRow[] = [
  'volume', 'bidVolume', 'askVolume', 'delta', 'minDelta', 'maxDelta', 'deltaPct', 'cvd', 'trades',
];
export function footprintTotalsSettings(value: unknown): FootprintTotalsSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const source = Array.isArray(raw.rows) ? raw.rows : [...DEFAULT_FOOTPRINT_TOTALS_ROWS];
  const rows = FOOTPRINT_TOTAL_ROWS.filter(row => source.includes(row));
  return { rows: rows.length ? rows : [...DEFAULT_FOOTPRINT_TOTALS_ROWS], highlightHighest: raw.highlightHighest === true };
}
export const HEATMAP_ID = 'native.orderbook-heatmap';
export const NET_LONGS_ID = 'native.net-longs-estimated';
export const NET_SHORTS_ID = 'native.net-shorts-estimated';
export const NET_POSITIONING_IDS = [NET_LONGS_ID, NET_SHORTS_ID] as const;
export const NET_POSITIONING_HELP = 'Estimates whether changes in open interest are associated with long-side or short-side activity. Opening and closing intent is not directly observable from these inputs.';
export type NetPositioningLabels = 'auto' | 'hover' | 'off';
export interface NetPositioningSettings { method: NetPositioningMethod; venues: NetPositioningVenue[]; display: NetPositioningDisplay; labels: NetPositioningLabels; colors?: Partial<Record<NetPositioningVenue, string>> }
export function netPositioningSettings(value: unknown): NetPositioningSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const method = raw.method === 'aggressor-flow-oi' ? 'aggressor-flow-oi' : 'price-oi';
  const input = Array.isArray(raw.venues) ? raw.venues : ['binance'];
  const selected = new Set(input.filter((venue): venue is NetPositioningVenue => venue === 'binance' || venue === 'hyperliquid' || venue === 'bybit'));
  const venues = (['binance', 'hyperliquid', 'bybit'] as const).filter(venue => selected.has(venue));
  const rawColors = raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors) ? raw.colors as Record<string, unknown> : {};
  const colors = Object.fromEntries((['binance', 'hyperliquid', 'bybit'] as const).flatMap(venue => {
    const value = rawColors[venue];
    return typeof value === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? [[venue, value]] : [];
  })) as Partial<Record<NetPositioningVenue, string>>;
  return { method, venues: [...venues], display: raw.display === 'grouped' ? 'grouped' : 'stacked', labels: raw.labels === 'hover' || raw.labels === 'off' ? raw.labels : 'auto', ...(Object.keys(colors).length ? { colors } : {}) };
}
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
  {id:LIQUIDATIONS_ID,name:'Liquidations',description:'Actual reported long/short liquidations · Bybit bankruptcy prices / sampled Binance',category:'Order Flow',implementation:'builtin',settingsVersion:1,defaults:{...liquidationSettings(undefined)},settingsSchema:[],placements:['pane'],dataRequirements:['actual-liquidation-reports'],sourceBinding:'chart',multiplicity:'single',capabilities:{editScript:false,duplicate:false}},
  {id:CVD_ID,name:'Multi-Venue CVD',description:'Executed aggressor-side cumulative volume delta · historical/live · Spot and Perpetual',category:'Order Flow',implementation:'builtin',
   settingsVersion:1,defaults:{...cvdSettings(undefined)},settingsSchema:[{key:'anchor',label:'Reset mode',kind:'select',defaultValue:'daily'},{key:'units',label:'Quantity unit',kind:'select',defaultValue:'btc'}],
   placements:['pane'],dataRequirements:['signed-executions'],sourceBinding:'chart',multiplicity:'single',capabilities:{editScript:false,duplicate:false}},
  {id:TRADE_BUBBLES_ID,name:'Trade Bubbles',description:'Size-scaled BTCUSDT executions · independent shared-feed overlay',category:'Order Flow',implementation:'builtin',settingsVersion:1,defaults:{...TRADE_BUBBLE_DEFAULT_SETTINGS,tiers:TRADE_BUBBLE_DEFAULT_SETTINGS.tiers.map(tier=>({...tier}))},settingsSchema:[
    {key:'sourceMode',label:'Execution sources',kind:'select',defaultValue:'follow-chart'},
    {key:'minimumNotionalUsdt',label:'Minimum notional (USDT)',kind:'number',defaultValue:100000},
    {key:'side',label:'Aggressor side',kind:'select',defaultValue:'both'},
    {key:'maximumVisible',label:'Maximum visible bubbles',kind:'number',defaultValue:120}],
   placements:['overlay'],dataRequirements:['normalized-executions'],sourceBinding:'chart',multiplicity:'single',capabilities:{editScript:false,duplicate:false}},
  { id: DAILY_VWAP_ID, name: 'Daily VWAP', description: 'UTC daily candle-volume weighted price with deviation bands', category: 'Volume', implementation: 'builtin',
    settingsVersion: 1, defaults: { ...DEFAULT_DAILY_VWAP }, settingsSchema: Object.entries(DEFAULT_DAILY_VWAP).map(([key,value]) => ({key,label:key,kind:typeof value,defaultValue:value})),
    placements: ['overlay'], dataRequirements: ['candles'], sourceBinding: 'chart', multiplicity: 'single', capabilities: {editScript:false,duplicate:false} },
  {id:EFFORT_RESULT_ID,name:'Effort–Result',description:'Persistent directional flow stalls · Binance BTCUSDT USD-M · trade-price proxy',category:'Order Flow',implementation:'builtin',settingsVersion:1,defaults:effortRecord(DEFAULT_EFFORT),settingsSchema:Object.entries(DEFAULT_EFFORT).map(([key,value])=>({key:key==='retentionDays'?key:`${key==='pane'?'presentation':typeof value==='boolean'?'notifications':'calculation'}.${key}`,label:key,kind:typeof value,defaultValue:value})),placements:['overlay','pane'],dataRequirements:['normalized-executions'],sourceBinding:'chart',multiplicity:'single',capabilities:{editScript:false,duplicate:false}},
  { id: MARKET_CONDITIONS_ID, name: 'Market Conditions', description: 'Completed-candle volatility regimes and heuristic tradeability · OHLC only', category: 'Trend', implementation: 'builtin',
    settingsVersion: 1, defaults: { ...DEFAULT_CONDITIONS }, settingsSchema: Object.entries(DEFAULT_CONDITIONS).map(([key,value]) => ({ key, label: key, kind: Array.isArray(value) ? 'multi' : typeof value, defaultValue: value })), placements: ['pane'], dataRequirements: ['candles'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: FOOTPRINT_ID, name: 'Footprint', description: 'Observed executed bid/ask volume · Binance BTCUSDT Spot and USD-M Perp', category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { rowPrice: 25, units: 'btc', view: DEFAULT_FOOTPRINT_VIEW }, settingsSchema: [
      { key: 'rowPrice', label: 'Price level (USDT)', kind: 'number', defaultValue: 25 },
      { key: 'units', label: 'Volume units', kind: 'select', defaultValue: 'btc' },
      ...['displayMode','cellStyle','opacity','showCandle','showPoc','showValueArea','showDiagonalImbalances','stackedImbalances','imbalanceRatio','imbalanceThreshold'].map(key => ({ key: `view.${key}`, label: key, kind: 'native', defaultValue: DEFAULT_FOOTPRINT_VIEW[key as keyof typeof DEFAULT_FOOTPRINT_VIEW] }))],
    placements: ['price-presentation'], dataRequirements: ['executions'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: FOOTPRINT_TOTALS_ID, name: 'Footprint Totals', description: 'Per-candle footprint statistics on their own time-aligned pane', category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { rows: [...DEFAULT_FOOTPRINT_TOTALS_ROWS], highlightHighest: false }, settingsSchema: [
      { key: 'rows', label: 'Statistics rows', kind: 'multi', defaultValue: [...DEFAULT_FOOTPRINT_TOTALS_ROWS] },
      { key: 'highlightHighest', label: 'Highlight highest value in each row', kind: 'boolean', defaultValue: false }],
    placements: ['pane'], dataRequirements: ['executions'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
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
    settingsVersion: 2, defaults: { ...DEFAULT_ORDER_WALLS_SETTINGS }, settingsSchema: [
      { key: 'mode', label: 'Detection mode', kind: 'select', defaultValue: 'top-levels' },
      { key: 'topLevels', label: 'Top levels per side', kind: 'number', defaultValue: 8 },
      { key: 'searchRangePercent', label: 'Search range per side (%)', kind: 'number', defaultValue: 10 },
      ...['minimumNotionalEnabled','highContrast','visibleRangeOnly','strengthThickness'].map(key=>({ key, label:key, kind:'boolean', defaultValue:DEFAULT_ORDER_WALLS_SETTINGS[key as keyof typeof DEFAULT_ORDER_WALLS_SETTINGS] })),
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
  { id: TPO_ID, name: 'UTC TPO Profile', description: 'Daily UTC time-price opportunities, opening ranges and naked profile levels from 1-minute candles', category: 'Volume', implementation: 'builtin',
    settingsVersion: 1, defaults: { ...DEFAULT_TPO_INDICATOR_SETTINGS }, settingsSchema: [
      { key: 'bracketMinutes', label: 'Bracket duration', kind: 'select', defaultValue: 30 },
      { key: 'rowTicks', label: 'Row size in exchange ticks', kind: 'native', defaultValue: 'auto' },
      { key: 'valueAreaPercent', label: 'Value area (%)', kind: 'number', defaultValue: 70 },
      { key: 'openingRangeMinutes', label: 'Opening range (minutes)', kind: 'number', defaultValue: 30 },
      { key: 'initialBalanceMinutes', label: 'Initial balance (minutes)', kind: 'number', defaultValue: 60 },
      { key: 'nakedDays', label: 'Naked level history (days)', kind: 'number', defaultValue: 90 }],
    placements: ['overlay'], dataRequirements: ['1-minute-candle-history'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: NET_LONGS_ID, name: 'Net Longs — Estimated', description: NET_POSITIONING_HELP, category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { method: 'price-oi', venues: ['binance'], display: 'stacked', labels: 'auto' }, settingsSchema: [
      { key: 'method', label: 'Estimation inputs', kind: 'select', defaultValue: 'price-oi' },
      { key: 'display', label: 'Display', kind: 'select', defaultValue: 'stacked' },
      { key: 'labels', label: 'Value labels', kind: 'select', defaultValue: 'auto' }],
    placements: ['pane'], dataRequirements: ['recorded-open-interest-intervals'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
  { id: NET_SHORTS_ID, name: 'Net Shorts — Estimated', description: NET_POSITIONING_HELP, category: 'Order Flow', implementation: 'builtin',
    settingsVersion: 1, defaults: { method: 'price-oi', venues: ['binance'], display: 'stacked', labels: 'auto' }, settingsSchema: [
      { key: 'method', label: 'Estimation inputs', kind: 'select', defaultValue: 'price-oi' },
      { key: 'display', label: 'Display', kind: 'select', defaultValue: 'stacked' },
      { key: 'labels', label: 'Value labels', kind: 'select', defaultValue: 'auto' }],
    placements: ['pane'], dataRequirements: ['recorded-open-interest-intervals'], sourceBinding: 'chart', multiplicity: 'single', capabilities: { editScript: false, duplicate: false } },
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
  const placement = id === FOOTPRINT_ID ? 'price-presentation' : id === LIQUIDATIONS_ID || id === CVD_ID || id === FOOTPRINT_TOTALS_ID || id === MARKET_CONDITIONS_ID || NET_POSITIONING_IDS.includes(id as typeof NET_POSITIONING_IDS[number]) ? 'pane' : 'overlay';
  return { instanceId: id, definitionId: id, settingsVersion: 1, visible, source: { kind: 'chart' }, placement, settings };
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
    if (copy.definitionId === EFFORT_RESULT_ID && copy.settingsVersion === 1) copy.settings = effortRecord(effortSettings(copy.settings));
    if (copy.definitionId === MARKET_CONDITIONS_ID && copy.settingsVersion === 1) copy.settings = { ...conditionsSettings(copy.settings) };
    if (copy.definitionId === ORDER_WALLS_ID && [1,2].includes(copy.settingsVersion)) { copy.settings = { ...orderWallsSettings(copy.settingsVersion === 1 && !('mode' in copy.settings) ? { ...copy.settings, mode: 'threshold' } : copy.settings) }; copy.settingsVersion = 2; }
    if (copy.definitionId === FOOTPRINT_TOTALS_ID && copy.settingsVersion === 1) copy.settings = { ...footprintTotalsSettings(copy.settings) };
    if (copy.definitionId === LIQUIDATIONS_ID && copy.settingsVersion === 1) copy.settings = {...liquidationSettings(copy.settings)};
    if (copy.definitionId === CVD_ID && copy.settingsVersion === 1) copy.settings = { ...cvdSettings(copy.settings) };
    if (copy.definitionId === TRADE_BUBBLES_ID && copy.settingsVersion === 1) copy.settings = { ...tradeBubbleSettings(copy.settings) };
    if (copy.definitionId === DAILY_VWAP_ID && copy.settingsVersion === 1) copy.settings = { ...dailyVwapSettings(copy.settings) };
    if (copy.definitionId === TPO_ID && copy.settingsVersion === 1) copy.settings = { ...tpoIndicatorSettings(copy.settings) };
    if (NET_POSITIONING_IDS.includes(copy.definitionId as typeof NET_POSITIONING_IDS[number]) && copy.settingsVersion === 1) copy.settings = { ...netPositioningSettings(copy.settings) };
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

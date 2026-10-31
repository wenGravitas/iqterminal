import {venueBadge,venueIconPath} from './chart/venue-label';
import {candleValueArea,positioningRangeLabel,type PositioningRange} from './chart/positioning-range';
import { LiquidationControls } from './liquidations/controls';
import { LIQUIDATIONS_ID, liquidationSettings } from './liquidations/settings';
import { LiquidationsView } from './liquidations/view';
import { CvdControls } from './indicators/cvd-controls';
import { CVD_ID, cvdSettings } from './feed/cvd';
import { CvdView } from './indicators/cvd-view';
import { CvdDataController } from './indicators/cvd-data';
import { cvdNumericPlotKey } from './chart/cvd-model';
import { OpenInterestDataController, OPEN_INTEREST_ID, OPEN_INTEREST_TOTAL_KEY, openInterestSettings } from './indicators/open-interest-data';
import { OpenInterestView } from './indicators/open-interest-view';
import { OpenInterestControls } from './indicators/open-interest-controls';
import { OrderFlowPaneView, type OrderFlowPaneState, type OrderFlowRow } from './indicators/order-flow-pane-view';
import { DAILY_VWAP_ID, DEFAULT_DAILY_VWAP, dailyVwapSettings } from './indicators/daily-vwap';
import { DailyVwapControls } from './indicators/daily-vwap-controls';
import { FloatingDrawingToolbar, floatingDrawingToolbarSettings, type FloatingDrawingToolbarSettings } from './chart/floating-drawing-toolbar';
import { renderFootprintTotalsTooltip } from './footprint-totals-tooltip';
import { footprintCellTooltipData, renderFootprintCellTooltip } from './footprint-cell-tooltip';
import { CURRENCY_EVENT, effectiveCurrency, getCurrencyPreference, syncCurrencyControl } from './currency-display';
import { EffortView } from './effort-result/view';
import { EFFORT_RESULT_ID, DEFAULT_EFFORT, effortRecord } from './effort-result/settings';
import { PaneLoading, type PaneDataState } from './pane-loading';
import { renderPositioningTooltip } from './net-positioning-tooltip';
import { TooltipDwell } from './tooltip-dwell';
import { IndicatorTitleHints } from './indicator-title-hints';
import { ConditionsControls } from './market-conditions/controls';
import { ConditionsView } from './market-conditions/view';
import { MARKET_CONDITIONS_ID, DEFAULT_CONDITIONS, conditionsSettings } from './market-conditions/settings';
import type { Notifications } from './notifications';
import type {LevelWatch} from './level-watch/types';
import { MarketPicker } from './market-picker';
import { indicatorIcon } from './indicators/icons';
import { indicatorInfoText } from './indicators/info';
import { applyCompositionPlotPresentation, compositionPaneId, compositionPlotId, compositionScaleId, compositionSmaDiagnostics, resetCompositionSmaMetrics, visibleRangeMaximum, DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT, MAX_COMPOSITION_PLOTS, migrateComposition, numericOutputContextId, numericOutputId, numericOutputRef, numericOutputScaleId, numericOutputSchemaId, PRICE_PANE_ID, reconcileCompositionPaneMembership, removeCompositionMember, validateComposition, type CompositionPlotRecord, type CompositionScaleRecord, type IndicatorCompositionState, type NumericOutputDescriptor, type NumericOutputRef, type NumericUnit } from './scripts/composition';
import { ChartNumericOutputRegistry, registerChartNumericOutputRegistry, registerManagedNumericOutputBinding, type ChartNumericOutput } from './scripts/output-registry';
import { COMPOSITION_SMA_ID, FOOTPRINT_ID, FOOTPRINT_TOTALS_ID, HEATMAP_ID, ORDER_WALLS_ID, TPO_ID, NET_LONGS_ID, NET_SHORTS_ID, NET_POSITIONING_IDS, INDICATOR_CONFIG_VERSION, DEFAULT_FOOTPRINT_VIEW, DEFAULT_FOOTPRINT_TOTALS_SETTINGS, NATIVE_DEFINITIONS, IndicatorLifecycle, migrateIndicators, nativeInstance, nativeDefinition, scriptDefinition, footprintTotalsSettings, netPositioningSettings, studyPins, withStudyPins, type IndicatorInstance, type NetPositioningSettings, type FootprintTotalsSettings } from './indicators/model';
import { CompositionControls } from './indicators/composition-controls';
import { CompositionPlacementControls } from './indicators/composition-placement-controls';
import { ManagedCompositionPlacementController } from './indicators/composition-placement-controller';
import { FootprintTotalsControls } from './indicators/footprint-totals-controls';
import { HeatmapControls } from './heatmap-controls';
import { NetPositioningControls } from './indicators/net-positioning-controls';
import { TpoControls } from './indicators/tpo-controls';
import { DEFAULT_TPO_INDICATOR_SETTINGS, tpoCalculationKey, tpoIndicatorSettings, type TpoIndicatorSettings } from './indicators/tpo-settings';
import { TRADE_BUBBLES_ID, tradeBubbleSettings } from './trade-bubbles/model';
import { TradeBubblesView } from './trade-bubbles/view';
import type { TradeTickerTierSource } from './trade-bubbles/controls';
import type { TpoNakedLevel, TpoSession } from './indicators/tpo-engine';
import { heatmapSettings, heatmapKey, type HeatmapSettings, type HeatmapStatus } from './feed/heatmap-model';
import { DEFAULT_ORDER_WALLS_SETTINGS, orderWallMarket, orderWallsSettings, resolveAutoOrderWallPriceWidth, type OrderWallHit, type OrderWallStatus, type OrderWallsSettings } from './feed/order-walls';
import { OrderWallsControls } from './order-walls-controls';
import { duration } from './feed/protocol';
import type { Bar, ChartObjectSnapshot, CrosshairMoveEvent, IndicatorApi, PriceScale } from 'openalgo-charts';
import { coerceSettingValue, drawingSettingsSchema, keyToDrawingAction, matchDrawingShortcut, registeredDrawingTools, type Drawing, type DrawingEvent, type DrawingInput, type DrawingPatch, type MagnetMode, type SettingsField, type SettingsSchema } from 'openalgo-charts/draw';
import type { FootprintCellStyle, FootprintDisplayMode, FootprintHover } from 'openalgo-charts/profile';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { NetPositioningHistory, type NetPositioningMethod, type NetPositioningVenue } from './feed/net-positioning';
import type { NormalizedExecution } from './feed/footprint';
import { executionMatchesSeries } from './ticker/hover';
import { executionRayLabel } from './ticker/execution-drawing';
import { canonicalFootprintRowPrice, canonicalSeries, FOOTPRINT_DEFAULT_ROW_PRICE, FOOTPRINT_MAX_ROW_PRICE, footprintTicksForPrice, instrumentKey, instrumentOf, instrumentLabel, instruments, intervals, chartIntervals, legacyFootprintRowTicks, marketOf, seriesForInstrument, supportsDepth, supportsScriptDepth, validFootprintRowPrice, tpoSourceKey, type CanonicalSeries, type FootprintAnalysisSummary, type FootprintBar, type FootprintStatus, type Interval, type Status, type TpoStatus } from './feed/protocol';
import { OpenAlgoCandleChart } from './chart/openalgo';
import type { Scheduler } from './chart/scheduler';
import type { FootprintUnits } from './chart/footprint-units';
import { getDisplayTimezone, TIMEZONE_EVENT } from './timezone';
import { MAX_STUDIES_PER_CHART, ScriptStudyHost, validStudyPins, type ScriptInputView, type StudyPin } from './scripts/host';
import type { ScriptLibrary, ScriptRecord } from './scripts/library';
import { makeInputControl, readInputSettings } from './scripts/input-controls';
import { captureDrawingSettings, drawingDisplayName, drawingSettingsPatch, initialDrawingMetadata, IQ_DRAWING_META_VERSION, iqDrawingSettingsSchema, sameDrawingSetting } from './chart/drawing-settings';
import { captureIQDrawingTemplateSettings, createLocalStorageDrawingTemplateStorage, createMemoryDrawingTemplateStorage, IQDrawingTemplateRepository, type IQDrawingTemplateCatalog, type IQDrawingTemplateRecord } from './chart/drawing-templates';
import {
  applyObjectTreeFolderVisibility, clearObjectTreeDrawingName, createEmptyObjectTree, createLocalStorageObjectTreeStorage, createMemoryObjectTreeStorage, createObjectTreeFolder,
  createObjectTreeSidebarPreferences, deleteObjectTreeFolder, findObjectTreeEntry, IQObjectTreeRepository,
  objectTreeDrawingIds, objectTreeFolderDrawingIds, objectTreeFolderPaths, objectTreeFolderVisibilityState, objectTreeSidebarStorageKey, objectTreeStorageKey,
  parseIQObjectTreeSidebarPreferences, reconcileObjectTree, renameObjectTreeFolder, reorderObjectTreeEntry,
  locateObjectTreeEntry, moveObjectTreeEntry, objectTreeFolderDepth, OBJECT_TREE_DEFAULT_WIDTH, OBJECT_TREE_MAX_WIDTH, OBJECT_TREE_MIN_WIDTH, OBJECT_TREE_MAX_DEPTH, renameObjectTreeDrawing,
  type IQObjectTreeCatalog, type IQObjectTreeSidebarPreferences, type ObjectTreeEntry,
} from './chart/object-tree';

const DRAWING_TOOL_IDS = new Set(['horizontal-line', 'horizontal-ray', 'trend-line', 'rectangle', 'fib-retracement', 'text', 'callout', 'long-position', 'short-position', 'date-range', 'price-range']);
const DRAWING_TOOL_GROUPS = [
  { id: 'lines', label: 'Lines', tools: ['trend-line', 'horizontal-line', 'horizontal-ray'], defaultTool: 'trend-line' },
  { id: 'shapes', label: 'Shapes and Fibonacci', tools: ['rectangle', 'fib-retracement'], defaultTool: 'rectangle' },
  { id: 'positions', label: 'Position tools', tools: ['long-position', 'short-position', 'date-range', 'price-range'], defaultTool: 'long-position' },
  { id: 'text', label: 'Text Tools', tools: ['text', 'callout'], defaultTool: 'text' },
] as const;
const DRAWING_GROUP_BY_TOOL: Map<string, string> = new Map(DRAWING_TOOL_GROUPS.flatMap(group => group.tools.map(tool => [tool, group.id] as const)));
const DRAWING_ICON_MARKUP: Record<string, string> = {
  cursor: '<path d="M4 2.5 15 11l-5 .3-2.2 5.2L4 2.5Z"/>',
  'trend-line': '<path d="M3 15 14 4m-6 0h6v6"/>',
  'horizontal-line': '<path d="M2.5 10h13"/>',
  'horizontal-ray': '<path d="M2.5 10h13m-4-4 4 4-4 4"/>',
  rectangle: '<rect x="3" y="4" width="12" height="10"/>',
  'fib-retracement': '<path d="M4 3v13m0-12h11M4 7h8M4 11h11M4 15h8"/>',
  text: '<path d="M3 4h14M10 4v12m-3 0h6"/>',
  callout: '<path d="M3 4h14v9H9l-4 3v-3H3z"/><path d="M6 7h8M6 10h5"/>',
  'long-position': '<rect x="3" y="4" width="12" height="11"/><path d="M9 12V5m-3 3 3-3 3 3"/>',
  'date-range': '<path d="M3 5v10m14-10v10M3 10h14M7 7l-3 3 3 3m6-6 3 3-3 3"/>',
  'price-range': '<path d="M5 3h10M5 17h10M10 3v14M7 7l3-3 3 3m-6 6 3 3 3-3"/>',
  'short-position': '<rect x="3" y="4" width="12" height="11"/><path d="M9 7v7m-3-3 3 3 3-3"/>',
  floating: '<rect x="2.5" y="6" width="15" height="9"/><path d="M5 9h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2"/>',
  move: '<path d="M7 4h.1M12 4h.1M7 9h.1M12 9h.1M7 14h.1M12 14h.1"/>',
  anchor: '<path d="M10 3a2.5 2.5 0 1 0 0 .1M10 6v10m-6-7h12M4 9c.3 4 2.3 6 6 7 3.7-1 5.7-3 6-7"/>',
  undo: '<path d="M6 6 3 9l3 3M3 9h8a4 4 0 0 1 4 4v1"/>',
  redo: '<path d="m14 6 3 3-3 3m3-3H9a4 4 0 0 0-4 4v1"/>',
  eraser: '<path d="m3 11 7-7 7 7-6 6H6l-3-3 3-3m6 6 5-5"/>',
  settings: '<path d="M8 1.5 9.3 2l.5 1.4 1.3.8 1.5-.2 1 1.8-.9 1.2v1.5l.9 1.2-1 1.8-1.5-.2-1.3.8-.5 1.4-1.3.5-1.3-.5-.5-1.4-1.3-.8-1.5.2-1-1.8L3.3 8V6.5l-.9-1.2 1-1.8 1.5.2 1.3-.8L6.7 2 8 1.5Z M8 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  templates: '<path d="M4 2.5h9l3 3v10H4zM13 2.5v3h3M6.5 9h7M6.5 12h7"/>',
  'objects-open': '<rect x="2.5" y="3" width="15" height="14"/><path d="M12 3v14M5 10h5m-2-3-3 3 3 3"/>',
  'objects-close': '<rect x="2.5" y="3" width="15" height="14"/><path d="M12 3v14M5 10h5M7 7l3 3-3 3"/>',
  objects: '<path d="M4 3h11v4H4zM4 9h11v4H4zM6 5h.1M6 11h.1"/>',
  chevron: '<path d="m5 7 3 3 3-3"/>',
  collapse: '<path d="m6 3 5 7-5 7"/>',
  expand: '<path d="m4 4 6 6-6 6"/>',
  folder: '<path d="M2.5 5h5l1.5 2h8.5v8.5h-15z"/><path d="M2.5 7h15"/>',
  eye: '<path d="M2 10s2.7-4.5 8-4.5 8 4.5 8 4.5-2.7 4.5-8 4.5S2 10 2 10Z"/><circle cx="10" cy="10" r="2"/>',
  hiddenEye: '<path d="M3 3 17 17M7.6 5.8A8.6 8.6 0 0 1 10 5.5c5.3 0 8 4.5 8 4.5a13 13 0 0 1-2.2 2.7M5.6 6.8C3.3 8.1 2 10 2 10s2.7 4.5 8 4.5c.8 0 1.5-.1 2.2-.3"/><path d="M8.6 8.6a2 2 0 0 0 2.8 2.8"/>',
  lock: '<rect x="4" y="8" width="12" height="9"/><path d="M6.5 8V5.5a3.5 3.5 0 0 1 7 0V8"/>',
  unlock: '<rect x="4" y="8" width="12" height="9"/><path d="M6.5 8V5.5a3.5 3.5 0 0 1 6.7-1.4"/>',
  more: '<circle cx="4" cy="10" r=".8"/><circle cx="10" cy="10" r=".8"/><circle cx="16" cy="10" r=".8"/>',
};

function drawingSidebarIcon(name: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('focusable', 'false');
  icon.innerHTML = DRAWING_ICON_MARKUP[name] ?? DRAWING_ICON_MARKUP.cursor!;
  return icon;
}

function drawingToolName(id: string): string {
  if (id === 'date-range') return 'Horizontal Measure';
  if (id === 'price-range') return 'Vertical Measure';
  return registeredDrawingTools().find(tool => tool.id === id)?.name ?? id;
}

function reconcileElementChildren(parent: Element, desired: readonly Element[]) {
  for (let index = 0; index < desired.length; index++) {
    const node = desired[index]!;
    const current = parent.children.item(index);
    if (current !== node) parent.insertBefore(node, current);
  }
  while (parent.children.length > desired.length) parent.lastElementChild?.remove();
}

let nextDrawingSidebarId = 0;

export interface FootprintViewOptions {
  displayMode: FootprintDisplayMode;
  cellStyle: FootprintCellStyle;
  statsPosition: 'bottom' | 'bar';
  opacity: number;
  showCandle: boolean;
  showPoc: boolean;
  showValueArea: boolean;
  showDiagonalImbalances: boolean;
  stackedImbalances: boolean;
  imbalanceRatio: 2 | 3 | 4;
  imbalanceThreshold: number;
}
export interface PanelConfig extends CanonicalSeries { candleElapsedTimer: boolean; floatingDrawingToolbar: FloatingDrawingToolbarSettings; paneOrder?: string[]; composition: IndicatorCompositionState; indicatorVersion: number; indicators: IndicatorInstance[]; basePriceVisible: boolean; type: 'candle' | 'footprint'; grid: boolean; wheelMode: 'tradingview' | 'both-axes'; drawingMagnet: MagnetMode; rowPrice: number; footprintUnits: FootprintUnits; footprint: FootprintViewOptions; heatmap: HeatmapSettings; studies: StudyPin[] }
function legacyConfig(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const series = canonicalSeries(value) ?? { venue: 'binance' as const, market: 'perpetual' as const, interval: '1m' as const };
  const savedFootprint = source.footprint && typeof source.footprint === 'object' ? source.footprint as Record<string, unknown> : {};
  const footprint: FootprintViewOptions = {
    displayMode: savedFootprint.displayMode === 'delta' || savedFootprint.displayMode === 'volume' ? savedFootprint.displayMode : 'bidask',
    cellStyle: savedFootprint.cellStyle === 'profile' ? 'profile' : 'ladder',
    statsPosition: savedFootprint.statsPosition === 'bar' ? 'bar' : 'bottom',
    opacity: typeof savedFootprint.opacity === 'number' && Number.isFinite(savedFootprint.opacity) ? Math.max(0, Math.min(1, savedFootprint.opacity)) : .85,
    showCandle: savedFootprint.showCandle !== false,
    showPoc: typeof savedFootprint.showPoc === 'boolean' ? savedFootprint.showPoc : DEFAULT_FOOTPRINT_VIEW.showPoc,
    showValueArea: savedFootprint.showValueArea !== false,
    showDiagonalImbalances: typeof savedFootprint.showDiagonalImbalances === 'boolean'
      ? savedFootprint.showDiagonalImbalances : DEFAULT_FOOTPRINT_VIEW.showDiagonalImbalances,
    stackedImbalances: savedFootprint.stackedImbalances === true,
    imbalanceRatio: savedFootprint.imbalanceRatio === 2 || savedFootprint.imbalanceRatio === 4 ? savedFootprint.imbalanceRatio : 3,
    imbalanceThreshold: typeof savedFootprint.imbalanceThreshold === 'number' && Number.isFinite(savedFootprint.imbalanceThreshold)
      ? Math.max(0, Math.min(10, savedFootprint.imbalanceThreshold)) : DEFAULT_FOOTPRINT_VIEW.imbalanceThreshold,
  };
  const rowPrice = validFootprintRowPrice(source.rowPrice) ? canonicalFootprintRowPrice(source.rowPrice)
    : Object.hasOwn(source, 'rowPrice') ? FOOTPRINT_DEFAULT_ROW_PRICE
      : legacyRowPrice(source.rowTicks);
  const drawingMagnet: MagnetMode = source.drawingMagnet === 'off' || source.drawingMagnet === 'strong' ? source.drawingMagnet : 'weak';
  const wantsFootprint = source.type === 'footprint' && supportsDepth(series);
  return { ...series, type: wantsFootprint ? 'footprint' as const : 'candle' as const, rowPrice,
    candleElapsedTimer: source.candleElapsedTimer !== false,
    grid: typeof source.grid === 'boolean' ? source.grid : true,
    wheelMode: source.wheelMode === 'both-axes' ? 'both-axes' as const : 'tradingview' as const,
    drawingMagnet, floatingDrawingToolbar: floatingDrawingToolbarSettings(source.floatingDrawingToolbar, DRAWING_TOOL_IDS),
    footprintUnits: source.footprintUnits === 'usdt' ? 'usdt' as const : 'btc' as const, footprint, heatmap: heatmapSettings(source.heatmap), studies: validStudyPins(source.studies) };
}

export function config(value: unknown, restorePlotPresentation = false): PanelConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const legacy = legacyConfig(source);
  const indicators = migrateIndicators(source, { ...legacy, type: source.type === 'footprint' ? 'footprint' : 'candle' });
  const paneOrder = Array.isArray(source.paneOrder) ? [...new Set(source.paneOrder.filter((id): id is string => typeof id === 'string' && id.length <= 160))].slice(0, 64) : [];
  let composition = migrateComposition(source.composition, indicators, paneOrder);
  const presentedIndicators = restorePlotPresentation ? applyCompositionPlotPresentation(indicators, composition) : indicators;
  if (restorePlotPresentation) composition = reconcileCompositionPaneMembership(composition, presentedIndicators);
  const footprint = indicators.find(i => i.definitionId === FOOTPRINT_ID && i.settingsVersion === 1 && i.source.kind === 'chart');
  const heatmap = indicators.find(i => i.definitionId === HEATMAP_ID && i.settingsVersion === 1 && i.source.kind === 'chart');
  const normalized = legacyConfig({ ...source,
    ...(footprint ? { rowPrice: footprint.settings.rowPrice, footprintUnits: footprint.settings.units, footprint: footprint.settings.view } : {}),
    ...(heatmap ? { heatmap: heatmap.settings } : {}) });
  if (footprint) footprint.settings = { rowPrice: normalized.rowPrice, units: normalized.footprintUnits, view: normalized.footprint };
  if (heatmap) heatmap.settings = { ...normalized.heatmap, enabled: true };
  return { ...source, ...normalized, indicatorVersion: INDICATOR_CONFIG_VERSION, indicators: presentedIndicators, composition,
    paneOrder,
    basePriceVisible: source.basePriceVisible !== false,
    type: footprint?.visible && supportsDepth(normalized) ? 'footprint' : 'candle',
    heatmap: { ...normalized.heatmap, enabled: Boolean(heatmap?.visible) }, studies: studyPins(presentedIndicators) };
}

function legacyRowPrice(value: unknown) {
  if (!legacyFootprintRowTicks.includes(value as typeof legacyFootprintRowTicks[number])) return FOOTPRINT_DEFAULT_ROW_PRICE;
  // The former default was ten ticks ($1 on BTCUSDT's verified $0.10 tick).
  // Migrate that old default to the new requested $25 default; other explicit
  // presets retain their previous quote width on the former USD-M grid.
  if (value === 10) return FOOTPRINT_DEFAULT_ROW_PRICE;
  return Number(value) * 0.1;
}

export class CandlePanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private heatmapControls!: HeatmapControls;
  private conditionsView?: ConditionsView;
  private cvdView?: CvdView;
  private cvdData?: CvdDataController;
  private openInterestView?: OpenInterestView;
  private openInterestData?: OpenInterestDataController;
  private orderFlowPaneView?: OrderFlowPaneView;
  private orderFlowPaneId?: string;
  private orderFlowPaneIndex = -1;
  private orderFlowMembersByPane = new Map<number, Set<string>>();
  private orderFlowCvdData?: CvdDataController;
  private orderFlowOpenInterestData?: OpenInterestDataController;
  private releaseOrderFlowCvdData?: () => void;
  private releaseOrderFlowOpenInterestData?: () => void;
  private hiddenOpenInterestControls?: OpenInterestControls;
  private liquidationsView?: LiquidationsView;
  private tradeBubblesView?: TradeBubblesView;
  private hiddenLiquidationControls?: LiquidationControls;
  private hiddenCvdControls?: CvdControls;
  private effortView?: EffortView;
  private hiddenConditionsControls?: ConditionsControls;
  private netPositioningControls!: NetPositioningControls;
  private footprintTotalsControls!: FootprintTotalsControls;
  private tpoControls!: TpoControls;
  private releaseTpo?: () => void;
  private tpoGeneration = 0;
  private tpoSubscriptionKey = '';
  private tpoSettingsKey = '';
  private tpoStatus?: TpoStatus;
  private tpoSessions = new Map<number, TpoSession>();
  private tpoNaked: TpoNakedLevel[] = [];
  private releaseNetPositioning?: () => void;
  private netPositioningRequestKey = '';
  private netPositioningGeneration = 0;
  private netPositioningHistories = new Map<NetPositioningMethod, NetPositioningHistory>();
  private netPositioningErrors = new Map<NetPositioningMethod, string>();
  private orderWallsControls!: OrderWallsControls;
  private releaseHeatmap?: () => void;
  private heatmapSubscriptionKey = '';
  private heatmapGeneration = 0;
  private heatmapStatus?: HeatmapStatus;
  private releaseOrderWalls?: () => void;
  private orderWallsSubscriptionKey = '';
  private orderWallsSettingsKey = '';
  private orderWallsViewportKey = '';
  private orderWallsGeneration = 0;
  private orderWallsAutoPriceWidth = 50;
  private orderWallsStatus?: OrderWallStatus;
  private toolbarWrap = document.createElement('div');
  private chartWorkspace = document.createElement('div');
  private floatingDrawingToolbar?: FloatingDrawingToolbar;
  private floatingDrawingToggle = document.createElement('button');
  private drawingSidebar = document.createElement('aside');
  private drawingSidebarToolbar = document.createElement('div');
  private drawingSidebarMenuLayer = document.createElement('div');
  private objectsPanel = document.createElement('aside');
  private objectsSummary = document.createElement('div');
  private objectsRows = document.createElement('div');
  private objectsTree = document.createElement('div');
  private objectsCollapse = document.createElement('button');
  private objectsNewFolder = document.createElement('button');
  private objectsInventory = document.createElement('section');
  private objectsInventoryRows = document.createElement('div');
  private objectsTreeStatus = document.createElement('div');
  private objectsTreeMenu = document.createElement('div');
  private objectsTreeResize = document.createElement('div');
  private objectRows = new Map<string, HTMLDivElement>();
  private objectPaneSections = new Map<number, { section: HTMLElement; heading: HTMLDivElement; rows: HTMLDivElement }>();
  private treeRows = new Map<string, HTMLDivElement>();
  private treeNodes = new Map<string, HTMLDivElement>();
  private collapsedTreeFolders = new Set<string>();
  private objectTreeCatalog: IQObjectTreeCatalog = createEmptyObjectTree();
  private objectTreeRepository?: IQObjectTreeRepository;
  private objectTreeStorageWarning = '';
  private objectTreeSidebarPreferences: IQObjectTreeSidebarPreferences = createObjectTreeSidebarPreferences();
  private objectTreeSidebarWarning = '';
  private objectTreeScope = '';
  private objectTreeFocusedKey = '';
  private objectTreeMenuTarget?: { kind: 'folder' | 'drawing'; id: string };
  private renamingFolderId?: string;
  private renamingDrawingId?: string;
  private emptyObjectsMessage = document.createElement('p');
  private chart = document.createElement('div');
  private chartFooter = document.createElement('footer');
  private toolbar = document.createElement('div');
  private toolbarCue = document.createElement('button');
  private depthNotice = document.createElement('div');
  private paneLoadingLayer = document.createElement('div');
  private paneLoaders = new Map<string, PaneLoading>();
  private applyingPaneOrder = false;
  private positioningRangeHit:NonNullable<ReturnType<OpenAlgoCandleChart['netPositioningHover']>>|null=null;
  private positioningTooltip = document.createElement('div');
  private footprintCellTooltipIdentity = '';
  private footprintCellTooltipPoint: { x: number; y: number } | null = null;
  private indicatorTooltipDwell = new TooltipDwell();
  private indicatorHoverPointerType?: string;
  private indicatorPointerDown = false;
  private indicatorTooltipBlockedUntilMove = false;
  private indicatorTitleHints!: IndicatorTitleHints;
  private indicatorHintRootReleases = new Map<HTMLElement, () => void>();
  private statusNode = document.createElement('div');
  private statusText = document.createElement('span');
  private marketPicker!: MarketPicker;
  private marketButton = document.createElement('button');
  private instrument = document.createElement('select');
  private rowPrice = document.createElement('input');
  private rowPriceControl = document.createElement('label');
  private chartSettings = document.createElement('button');
  private chartSettingsDialog = document.createElement('dialog');
  private gridCheckbox = document.createElement('input');
  private candleTimerCheckbox = document.createElement('input');
  private wheelMode = document.createElement('select');
  private get displayFootprintUnits() { return effectiveCurrency(this.selection.footprintUnits); }
  private footprintUnits = document.createElement('select');
  private overlays = document.createElement('div');
  private activeIndicators = document.createElement('details');
  private activeSummary = document.createElement('summary');
  private activeRows = document.createElement('div');
  private paneIndicatorLayer = document.createElement('div');
  private primaryPaneCollapsedHeader = document.createElement('div');
  private indicatorRowViews = new Map<string, { element: HTMLDivElement; name: HTMLSpanElement; warning: HTMLElement; controls: HTMLDivElement; buttons: Map<string, HTMLButtonElement>; actionsKey: string }>();
  private paneIndicatorHosts = new Map<number, HTMLDivElement>();
  private paneControlHosts = new Map<number, { element: HTMLDivElement; buttons: Map<string, HTMLButtonElement> }>();
  private primaryPaneCollapsed = false;
  private primaryPaneOriginalWeight?: number;
  private primaryPaneOtherOriginalWeights = new Map<HTMLElement, number>();
  private paneIndicatorLayoutFrame?: number;
  private indicatorErrorRow?: HTMLParagraphElement;
  private drawSelect = document.createElement('button');
  private drawSnap = document.createElement('button');
  private drawPlacementState = document.createElement('span');
  private drawUndo = document.createElement('button');
  private drawRedo = document.createElement('button');
  private drawEraser = document.createElement('button');
  private drawSettings = document.createElement('button');
  private drawTemplates = document.createElement('button');
  private objectsToggle = document.createElement('button');
  private drawingPrimaryButtons = new Map<string, HTMLButtonElement>();
  private drawingToolButtons = new Map<string, HTMLButtonElement[]>();
  private drawingFlyoutButtons = new Map<string, HTMLButtonElement>();
  private drawingFlyouts = new Map<string, HTMLDivElement>();
  private drawingLastToolByGroup = new Map<string, string>();
  private openDrawingFlyoutGroup?: string;
  private readonly drawingSidebarId = ++nextDrawingSidebarId;
  private drawingDialog = document.createElement('dialog');
  private drawingForm = document.createElement('form');
  private drawingFields = document.createElement('div');
  private drawingStatus = document.createElement('div');
  private drawingTarget = '';
  private drawingSchema?: SettingsSchema;
  private drawingSettingsBaseline: Record<string, unknown> = {};
  private templatesDialog = document.createElement('dialog');
  private templatesName = document.createElement('input');
  private templatesIncludeLabel = document.createElement('input');
  private templatesList = document.createElement('div');
  private templatesStatus = document.createElement('div');
  private templateRepository?: IQDrawingTemplateRepository;
  private templateCatalog?: IQDrawingTemplateCatalog;
  private templateUnsubscribe?: () => void;
  private templateStorageWarning = '';
  private coreObjectProviderReleases: (() => void)[] = [];
  private scriptObjectProviderReleases = new Map<string, () => void>();
  private indicatorLifecycle?: IndicatorLifecycle;
  private outputRegistry!: ChartNumericOutputRegistry;
  private releaseOutputRegistry?: () => void;
  private releaseCompositionOutputListener?: () => void;
  private pendingCompositionSmaRepairs = new Set<string>();
  private compositionSmaRepairQueued = false;
  private compositionSmaRepairRunning = false;
  private compositionSmaBindings = new Map<string, { token: string; refKey: string; release: () => void }>();
  private demandedCompositionSmaConsumers = new Set<string>();
  private demandedCvdProviders = new Set<string>();
  private demandedOpenInterestProviders = new Set<string>();
  private compositionApis = new Map<string, IndicatorApi>();
  private compositionPlacement!: ManagedCompositionPlacementController;
  private applyingManagedCompositionMove = false;
  private compositionWork = { indicatorReconciles: 0, activeIndicatorRenders: 0, objectRefreshes: 0, scriptObjectProviderSyncs: 0, dataCallbacks: 0, visibleRangeScaleUpdates: 0, autoscaleValuesScanned: 0 };
  private readonly compositionScaleRangeOwner = {};
  private ownedCompositionScales = new Map<string, { scale: PriceScale; originalMarginTop: number; originalMarginBottom: number; marginTop: number; marginBottom: number }>();
  private readonly syncCompositionScalesOnFrame = () => this.syncVolumeCompositionBands();
  private internalCompositionRemovals = new Set<string>();
  private compositionControls!: CompositionControls;
  private placementControls!: CompositionPlacementControls;
  private indicatorErrors = new Map<string, string>();
  private footprintGeneration = 0;
  private footprintSubscriptionKey = '';
  private baseVisible = document.createElement('input');
  private interval = document.createElement('select');
  private metadata = document.createElement('span');
  private retry = document.createElement('button');
  private latest = document.createElement('button');
  private indicators = document.createElement('button');
  private picker = document.createElement('dialog');
  private pickerSearch = document.createElement('input');
  private pickerList = document.createElement('div');
  private pickerStatus = document.createElement('div');
  private pickerRecords: ScriptRecord[] = [];
  private pickerBusy = false;
  private vwapControls: DailyVwapControls;
  private settingsDialog = document.createElement('dialog');
  private settingsForm = document.createElement('form');
  private settingsFields = document.createElement('div');
  private settingsStatus = document.createElement('div');
  private settingsAttachmentId = '';
  private settingsBusy = false;
  private footprintDialog = document.createElement('dialog');
  private footprintForm = document.createElement('form');
  private footprintFields = document.createElement('div');
  private footprintBusy = false;
  private engine?: OpenAlgoCandleChart;
  private studyHost?: ScriptStudyHost;
  private watchList:LevelWatch[]=[];
  private watchButton?:HTMLButtonElement;
  private watchZonesVisible = true;
  private releaseWatchObjects?: () => void;
  private cancelWatchPick?:()=>void;
  setExecutionHoverRay(execution:NormalizedExecution|null){this.engine?.setExecutionHoverRay(execution&&executionMatchesSeries(execution,this.selection)?execution:null);}
  addExecutionRay(execution: NormalizedExecution) {
    const engine = this.engine;
    if (!engine || this.dead || !executionMatchesSeries(execution, this.selection) ||
      !Number.isFinite(execution.timeMs) || !Number.isFinite(execution.price) || execution.price <= 0) return false;
    const theme = engine.chart.theme();
    const color = execution.side === 'buy' ? theme.buy : execution.side === 'sell' ? theme.sell : theme.lineColor;
    const input: DrawingInput = {
      tool: 'horizontal-ray',
      points: [{ time: execution.timeMs / 1000, price: execution.price }],
      paneIndex: engine.objects.primaryPaneIndex(),
      style: { color, lineWidth: 1.5, lineStyle: 'dashed', showLabels: true },
      text: { value: executionRayLabel(execution), fontSize: 10, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', bold: true },
      props: {
        iqterminal: { version: IQ_DRAWING_META_VERSION },
        iqterminalLabelState: 'unset',
        iqterminalLabel: '',
        iqterminalAnalysisInterval: '',
        executionAmount:{venue:execution.venue,market:execution.market,baseAmount:execution.quantity,quoteAmount:Number(execution.quoteNotionalText??execution.price*execution.quantity)},
      },
    };
    engine.drawings.add(input);
    engine.objects.refresh();
    this.syncDrawingActions();
    return true;
  }
  setWatchZones(watches:LevelWatch[]){this.watchList=watches;const supported=instrumentKey(this.selection)==='binance:perpetual';if(this.watchButton){this.watchButton.disabled=!supported;this.watchButton.title=supported?'Select two zone boundaries':'Level Watch requires Binance BTCUSDT USD-M perpetual';}this.engine?.setWatchZones(supported&&this.watchZonesVisible?watches:[]);this.engine?.objects.refresh();}
  focusLiquidation(event:import('./liquidations/model').LiquidationEvent){if(instrumentOf(this.selection).base!=='BTC')return false;this.params.api.setActive();const chart=this.engine?.chart;if(!chart)return false;const bars=this.engine?.series.getData();if(!bars?.length||event.timeMs<bars[0]!.time*1000||event.timeMs>(bars.at(-1)!.time*1000+duration[this.selection.interval]))return false;const index=chart.dataLayer.timeToIndexFloat(event.timeMs/1000);if(!Number.isFinite(index))return false;chart.setVisibleLogicalRange({from:index-30,to:index+30});return true;}
  focusWatch(w:LevelWatch){if(instrumentKey(this.selection)!=='binance:perpetual')return;this.params.api.setActive();const padding=Math.max(10,(w.definition.upper-w.definition.invalidation)*.5);this.engine?.focusWatch(w.definition.invalidation-padding,w.definition.upper+padding);}
  beginWatchZone(done:(bounds:{lower:number;upper:number})=>void){
    this.cancelWatchPick?.();if(instrumentKey(this.selection)!=='binance:perpetual'||!this.engine)return;
    // Zone clicks own the next chart gesture; disarm drawing placement and erase modes first.
    this.setDrawingTool(null);
    const abort=new AbortController(),hint=document.createElement('div');hint.className='watch-pick-hint';hint.textContent='Watch zone: click first boundary · Escape cancels';this.chart.append(hint);this.chart.classList.add('watch-zone-picking');this.chart.focus();let first:number|undefined,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
    this.cancelWatchPick=()=>{clearTimeout(timer);abort.abort();hint.remove();this.chart.classList.remove('watch-zone-picking');this.cancelWatchPick=undefined;};
    const options={capture:true,signal:abort.signal};for(const name of ['pointerdown','pointerup','mousedown','mouseup','dblclick'] as const)this.chart.addEventListener(name,event=>{event.preventDefault();event.stopImmediatePropagation();},options);
    this.chart.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(finished)return;const rect=this.chart.getBoundingClientRect(),price=this.engine?.watchPriceAt(event.clientX-rect.left,event.clientY-rect.top);if(price==null)return;if(first===undefined){first=price;hint.textContent=`First boundary $${price.toFixed(1)} · click second boundary · Escape cancels`;return;}if(first===price){hint.textContent='Choose a different second boundary';return;}finished=true;done({lower:Math.min(first,price),upper:Math.max(first,price)});timer=setTimeout(()=>this.cancelWatchPick?.(),350);},options);
    this.chart.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.cancelWatchPick?.();}},options);
  }
  private subscriptions: { dispose(): void }[] = [];
  private release?: () => void;
  private releaseFootprint?: () => void;
  private params!: IDockviewPanelProps;
  private selection!: PanelConfig;
  private status: Status = { state: 'loading', message: 'Loading…', lastUpdate: 0 };
  private visible = false;
  private dead = false;
  private selectionEpoch = 0;
  private resetViewOnSnapshot = true;
  private timer?: ReturnType<typeof setInterval>;
  private toolbarResizeObserver?: ResizeObserver;
  private chartFooterObserver?: MutationObserver;
  private abort = new AbortController();
  private hoveredBar: Bar | null = null;
  private hoveredFootprint: FootprintHover | null = null;
  private candles: import('./feed/protocol').Candle[] = [];
  private footprintBars: FootprintBar[] = [];
  private footprintAnalysisSummaries = new Map<number, FootprintAnalysisSummary>();
  private footprintSnapshotSignature?: string[];
  private footprintNeedsSync = false;
  private footprintHasInitialView = false;
  private footprintStatus: FootprintStatus = {
    state: 'loading', message: 'Waiting for Binance USD-M aggTrade observations', lastUpdate: 0,
    tickSize: null, rowSize: null, collectionStartedAt: null, firstTradeAt: null, lastTradeAt: null, eventTime: null,
    outages: 0, lateRecords: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0,
    coverage: 'waiting', retentionStart: null,
  };

  constructor(
    private feed: FeedClient,
    private scheduler: Scheduler,
    private library: ScriptLibrary,
    private save: () => void,
    private register: (id: string, panel: CandlePanel | null) => void,
    private openEditor: (chartId: string, attachmentId?: string) => void,
    private refreshExecutionHover: (chartId: string) => void,
    private notifications: Notifications,
    private tickerTierSources: () => TradeTickerTierSource[] = () => [],
  ) {
    this.element.className = 'candle-panel';
    this.indicatorTitleHints = new IndicatorTitleHints();
    this.bindIndicatorHintRoot(this.element);
    this.toolbarWrap.className = 'chart-toolbar-wrap';
    this.toolbar.className = 'chart-toolbar';
    this.chartWorkspace.className = 'chart-workspace';
    this.drawingSidebar.className = 'drawing-sidebar';
    this.drawingSidebar.setAttribute('aria-label', 'Drawing tools and actions');
    this.drawingSidebarToolbar.className = 'drawing-sidebar-toolbar';
    this.drawingSidebarToolbar.setAttribute('role', 'group');
    this.drawingSidebarToolbar.setAttribute('aria-label', 'Drawings');
    this.drawingSidebarToolbar.setAttribute('aria-orientation', 'vertical');
    this.drawingSidebarMenuLayer.className = 'drawing-sidebar-menu-layer';
    this.drawingSidebarMenuLayer.setAttribute('aria-live', 'off');
    this.toolbarCue.className = 'toolbar-overflow-cue';
    this.toolbarCue.type = 'button';
    this.toolbarCue.textContent = '›';
    this.toolbarCue.hidden = true;
    this.toolbarCue.setAttribute('aria-label', 'Scroll chart controls right');
    this.toolbarCue.title = 'More chart controls';
    this.chart.className = 'chart-stage';
    this.chartFooter.className = 'chart-footer';
    this.depthNotice.className = 'depth-notice';
    this.depthNotice.hidden = true;
    this.depthNotice.setAttribute('role', 'status');
    this.depthNotice.setAttribute('aria-live', 'polite');
    this.chart.tabIndex = 0;
    this.chart.setAttribute('aria-label', 'Bitcoin candlestick chart');
    this.statusNode.className = 'panel-status';
    this.statusNode.setAttribute('role', 'status');
    this.metadata.className = 'instrument-meta';
    this.marketButton.setAttribute('aria-label', 'Chart market'); this.marketButton.className = 'chart-market-button';
    this.marketPicker = new MarketPicker(this.element);
    for (const [value, info] of Object.entries(instruments)) this.instrument.add(new Option(info.label, value));
    this.interval.setAttribute('aria-label', 'Timeframe');
    for (const value of chartIntervals) this.interval.add(new Option(value, value));
    this.rowPrice.type = 'number';
    this.rowPrice.className = 'footprint-row-price';
    this.rowPrice.setAttribute('aria-label', 'Price level (USDT)');
    this.rowPrice.min = '0';
    this.rowPrice.max = String(FOOTPRINT_MAX_ROW_PRICE);
    this.rowPrice.step = 'any';
    this.rowPrice.value = String(FOOTPRINT_DEFAULT_ROW_PRICE);
    this.rowPriceControl.className = 'footprint-row-control';
    const rowPriceLabel = document.createElement('span'); rowPriceLabel.textContent = 'Price level (USDT)';
    const rowPricePrefix = document.createElement('span'); rowPricePrefix.className = 'footprint-row-prefix'; rowPricePrefix.textContent = '$';
    this.rowPriceControl.append(rowPriceLabel, rowPricePrefix, this.rowPrice);
    this.footprintUnits.className = 'footprint-units-button';
    this.footprintUnits.setAttribute('aria-label', 'Footprint volume units');
    this.footprintUnits.add(new Option('BTC base quantity', 'btc')); this.footprintUnits.add(new Option('USDT execution notional', 'usdt'));
    const settingsIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    settingsIcon.setAttribute('aria-hidden', 'true');
    settingsIcon.setAttribute('viewBox', '0 0 16 16');
    settingsIcon.setAttribute('width', '14');
    settingsIcon.setAttribute('height', '14');
    const settingsPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    settingsPath.setAttribute('d', 'M6.2 1.5h3.6l.4 1.6c.4.1.8.3 1.1.6l1.6-.5 1.8 3.1-1.2 1.1v1.3l1.2 1.1-1.8 3.1-1.6-.5c-.4.3-.7.5-1.1.6l-.4 1.6H6.2l-.4-1.6c-.4-.1-.8-.3-1.1-.6l-1.6.5-1.8-3.1 1.2-1.1V7.4L1.3 6.3l1.8-3.1 1.6.5c.4-.3.7-.5 1.1-.6L6.2 1.5Z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z');
    settingsPath.setAttribute('fill', 'none');
    settingsPath.setAttribute('stroke', 'currentColor');
    settingsPath.setAttribute('stroke-width', '1');
    settingsIcon.append(settingsPath);
    this.chartSettings.type = 'button';
    this.chartSettings.append(settingsIcon.cloneNode(true));
    this.chartSettings.className = 'footprint-settings-button';
    this.chartSettings.setAttribute('aria-label', 'Chart settings');
    this.chartSettings.title = 'Chart settings';
    this.latest.className = 'chart-latest-button';
    this.latest.append(indicatorIcon('latest'));
    this.latest.setAttribute('aria-label', 'Latest');
    this.latest.title = 'Return to the latest candle and restore price autoscale (Home or double click)';
    this.indicators.textContent = 'Indicators';
    this.indicators.title = 'Add a study or open the local OpenScript library';
    this.retry.textContent = 'Retry';
    this.retry.setAttribute('aria-label', 'Retry market data');
    this.heatmapControls = new HeatmapControls((settings, units) => this.changeHeatmap(settings, units), () => this.feed.retryDepth(), this.abort.signal);
    this.netPositioningControls = new NetPositioningControls((id, settings) => this.changeNetPositioning(id, settings), this.abort.signal);
    this.vwapControls = new DailyVwapControls((id, settings) => this.changeIndicator(id, { settings: { ...settings } }), this.abort.signal);
    this.footprintTotalsControls = new FootprintTotalsControls((id, settings) => this.changeFootprintTotals(id, settings), this.abort.signal);
    this.tpoControls = new TpoControls((id, settings) => this.changeTpo(id, settings), () => this.feed.retryTpo(this.params.api.id), this.abort.signal);
    this.orderWallsControls = new OrderWallsControls(settings => this.changeOrderWalls(settings), this.abort.signal);
    this.compositionControls = new CompositionControls((output, settings, instanceId, changeScale) => this.addCompositionSma(output, settings, instanceId, changeScale));
    this.placementControls = new CompositionPlacementControls((instanceId, targetId, together, heightPercent, lowerBand) =>
      this.compositionPlacement.move(instanceId, targetId, together, heightPercent, lowerBand));
    this.toolbar.append(this.marketButton, this.interval, this.indicators, this.chartSettings, this.latest, this.metadata);
    this.drawPlacementState.className = 'drawing-placement-state';
    this.drawPlacementState.setAttribute('role', 'status');
    this.drawPlacementState.setAttribute('aria-live', 'polite');
    this.buildDrawingSidebar();
    this.toolbarWrap.append(this.toolbar, this.toolbarCue);
    this.overlays.className = 'chart-top-overlays';
    this.activeIndicators.className = 'active-indicators'; this.activeIndicators.open = true;
    this.activeIndicators.setAttribute('aria-label', 'Active indicators');
    this.activeSummary.textContent = 'Indicators'; this.activeRows.className = 'active-indicator-rows';
    this.activeIndicators.append(this.activeSummary, this.activeRows);
    this.objectsPanel.className = 'chart-objects-panel';
    this.objectsPanel.setAttribute('aria-label', 'Chart object tree');
    this.objectsSummary.className = 'chart-objects-summary';
    this.objectsSummary.textContent = 'Objects';
    const objectTreeHeader = document.createElement('header');
    objectTreeHeader.className = 'chart-object-tree-header';
    const objectTreeTitle = document.createElement('strong'); objectTreeTitle.textContent = 'Object Tree';
    this.objectsCollapse.type = 'button';
    this.objectsCollapse.className = 'chart-object-tree-collapse';
    this.objectsCollapse.setAttribute('aria-label', 'Close Object Tree');
    this.objectsCollapse.title = 'Close Object Tree';
    this.objectsCollapse.append(drawingSidebarIcon('objects-close'));
    objectTreeHeader.append(objectTreeTitle, this.objectsSummary, this.objectsCollapse);
    this.objectsRows.className = 'chart-objects-content';
    const treeToolbar = document.createElement('div'); treeToolbar.className = 'chart-object-tree-toolbar';
    this.objectsNewFolder.type = 'button'; this.objectsNewFolder.className = 'chart-object-tree-new-folder';
    this.objectsNewFolder.dataset.treeAction = 'new-folder'; this.objectsNewFolder.textContent = 'New folder';
    treeToolbar.append(this.objectsNewFolder);
    this.objectsTree.className = 'chart-object-tree'; this.objectsTree.setAttribute('role', 'tree'); this.objectsTree.setAttribute('aria-label', 'Drawings');
    this.objectsTreeStatus.className = 'chart-object-tree-status'; this.objectsTreeStatus.setAttribute('role', 'status'); this.objectsTreeStatus.setAttribute('aria-live', 'polite');
    this.objectsInventory.className = 'chart-object-inventory';
    const inventoryHeading = document.createElement('h3'); inventoryHeading.textContent = 'Other chart objects';
    this.objectsInventoryRows.className = 'chart-object-inventory-rows';
    this.objectsInventory.append(inventoryHeading, this.objectsInventoryRows);
    this.objectsRows.append(treeToolbar, this.objectsTree, this.objectsTreeStatus, this.objectsInventory);
    this.emptyObjectsMessage.className = 'chart-object-empty'; this.emptyObjectsMessage.textContent = 'No drawings';
    this.objectsTree.append(this.emptyObjectsMessage);
    this.objectsTreeResize.className = 'chart-object-tree-resize'; this.objectsTreeResize.setAttribute('role', 'separator');
    this.objectsTreeResize.setAttribute('aria-label', 'Resize object tree sidebar');
    this.objectsTreeResize.setAttribute('aria-orientation', 'vertical'); this.objectsTreeResize.tabIndex = 0;
    this.objectsTreeMenu.className = 'chart-object-tree-menu'; this.objectsTreeMenu.setAttribute('role', 'menu'); this.objectsTreeMenu.hidden = true;
    this.objectsPanel.append(objectTreeHeader, this.objectsRows, this.objectsTreeResize, this.objectsTreeMenu);
    this.buildDialogs();
    this.buildDrawingDialogs();
    this.chartWorkspace.append(this.drawingSidebar, this.chart, this.objectsPanel, this.drawingSidebarMenuLayer);
    this.element.append(this.toolbarWrap, this.depthNotice, this.chartWorkspace, this.chartFooter, this.picker, this.settingsDialog, this.footprintDialog, this.heatmapControls.dialog, this.netPositioningControls.dialog, this.footprintTotalsControls.dialog, this.vwapControls.dialog, this.tpoControls.dialog, this.orderWallsControls.dialog, this.compositionControls.dialog, this.placementControls.dialog, this.chartSettingsDialog, this.drawingDialog, this.templatesDialog);
  }

  private sidebarButton(label: string, title: string, iconName: string, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `drawing-sidebar-button${extraClass ? ` ${extraClass}` : ''}`;
    button.setAttribute('aria-label', label);
    button.title = title;
    button.append(drawingSidebarIcon(iconName));
    return button;
  }

  private rememberDrawingToolButton(tool: string, button: HTMLButtonElement) {
    const buttons = this.drawingToolButtons.get(tool) ?? [];
    buttons.push(button);
    this.drawingToolButtons.set(tool, buttons);
  }

  private buildDrawingSidebar() {
    const divider = () => {
      const line = document.createElement('span');
      line.className = 'drawing-sidebar-divider';
      line.setAttribute('aria-hidden', 'true');
      return line;
    };

    this.drawSelect = this.sidebarButton('Select drawings', 'Select and edit drawings · Esc', 'cursor', 'drawing-sidebar-tool-main drawing-sidebar-select');
    this.drawSelect.dataset.sidebarAction = 'select';
    this.drawSelect.setAttribute('aria-pressed', 'true');
    this.drawingSidebarToolbar.append(this.drawSelect, divider());

    for (const group of DRAWING_TOOL_GROUPS) {
      const defaultTool = group.defaultTool;
      const toolName = drawingToolName(defaultTool);
      this.drawingLastToolByGroup.set(group.id, defaultTool);
      const row = document.createElement('div');
      row.className = 'drawing-sidebar-group';
      row.dataset.drawingGroup = group.id;

      const primary = this.sidebarButton(`Use ${toolName} tool`, `Use ${toolName}`, defaultTool, 'drawing-sidebar-tool-main drawing-sidebar-primary');
      primary.dataset.drawingTool = defaultTool;
      primary.dataset.toolName = toolName;
      primary.dataset.drawingGroup = group.id;
      primary.setAttribute('aria-pressed', 'false');
      this.drawingPrimaryButtons.set(group.id, primary);

      const menuId = `drawing-tools-${this.drawingSidebarId}-${group.id}`;
      const toolsLabel = group.label.replace(/ tools$/i, '');
      const menuToggle = this.sidebarButton(`Open ${toolsLabel} tools`, `Show ${toolsLabel.toLowerCase()} drawings`, 'chevron', 'drawing-sidebar-menu-toggle');
      menuToggle.dataset.drawingGroup = group.id;
      menuToggle.setAttribute('aria-controls', menuId);
      menuToggle.setAttribute('aria-expanded', 'false');
      this.drawingFlyoutButtons.set(group.id, menuToggle);

      const flyout = document.createElement('div');
      flyout.id = menuId;
      flyout.className = 'drawing-sidebar-flyout';
      flyout.dataset.drawingGroup = group.id;
      flyout.setAttribute('role', 'group');
      flyout.setAttribute('aria-label', `${toolsLabel} drawing tools`);
      flyout.hidden = true;
      const heading = document.createElement('strong');
      heading.className = 'drawing-sidebar-flyout-heading';
      heading.textContent = group.label;
      flyout.append(heading);
      for (const id of group.tools) {
        const name = drawingToolName(id);
        const option = this.sidebarButton(`Use ${name} tool`, `Use ${name}`, id, 'drawing-sidebar-flyout-tool');
        option.dataset.drawingTool = id;
        option.dataset.toolName = name;
        option.dataset.drawingGroup = group.id;
        option.setAttribute('aria-pressed', 'false');
        const text = document.createElement('span');
        text.className = 'drawing-sidebar-flyout-label';
        text.textContent = name;
        option.append(text);
        this.rememberDrawingToolButton(id, option);
        flyout.append(option);
      }
      row.append(primary, menuToggle);
      this.drawingSidebarToolbar.append(row);
      this.drawingSidebarMenuLayer.append(flyout);
      this.drawingFlyouts.set(group.id, flyout);
    }

    this.drawingSidebarToolbar.append(divider());
    this.drawSnap = this.sidebarButton('Anchor snapping: Weak', 'Anchor snapping: Weak · click for Strong', 'anchor', 'drawing-sidebar-snap');
    this.drawSnap.dataset.magnet = 'weak';
    this.drawSnap.setAttribute('aria-pressed', 'true');
    this.drawingSidebarToolbar.append(this.drawSnap, divider());

    this.drawUndo = this.sidebarButton('Undo', 'Undo drawing change (Ctrl/⌘+Z)', 'undo', 'drawing-sidebar-action');
    this.drawRedo = this.sidebarButton('Redo', 'Redo drawing change (Ctrl/⌘+Shift+Z)', 'redo', 'drawing-sidebar-action');
    this.drawEraser = this.sidebarButton('Erase', 'Erase drawings', 'eraser', 'drawing-sidebar-action');
    this.floatingDrawingToggle = this.sidebarButton('Toggle floating drawing toolbar', 'Show or hide the floating drawing toolbar', 'floating', 'drawing-sidebar-action');
    this.drawSettings = this.sidebarButton('Style', 'Edit the selected drawing', 'settings', 'drawing-sidebar-action');
    this.drawTemplates = this.sidebarButton('Templates', 'Manage drawing settings templates', 'templates', 'drawing-sidebar-action');
    this.objectsToggle = this.sidebarButton('Open Object Tree', 'Open Object Tree', 'objects-open', 'drawing-sidebar-action chart-objects-toggle');
    this.drawUndo.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    this.drawRedo.setAttribute('aria-keyshortcuts', 'Control+Shift+Z Meta+Shift+Z');
    this.drawEraser.setAttribute('aria-pressed', 'false');
    this.objectsToggle.setAttribute('aria-pressed', 'false');
    this.drawingSidebarToolbar.append(this.drawUndo, this.drawRedo, this.drawEraser, this.floatingDrawingToggle, this.drawSettings, this.drawTemplates, this.objectsToggle, this.drawPlacementState);
    this.drawingSidebar.append(this.drawingSidebarToolbar);
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.element.dataset.panelId = params.api.id;
    this.selection = config(params.params, true);
    this.loadObjectTreeSidebarPreferences();
    this.updateDrawingSnapButton();
    this.wheelMode.value = this.selection.wheelMode;
    this.candleTimerCheckbox.checked = this.selection.candleElapsedTimer;
    this.gridCheckbox.checked = this.selection.grid; this.baseVisible.checked = this.selection.basePriceVisible;
    params.api.updateParameters(this.selection);
    this.instrument.value = instrumentKey(this.selection); this.marketButton.textContent = instrumentLabel(this.selection);
    this.rowPrice.value = String(this.selection.rowPrice);
    this.interval.value = this.selection.interval;
    this.updateFootprintControls();
    const options = { signal: this.abort.signal };
    this.objectsCollapse.addEventListener('click', () => this.setObjectTreeCollapsed(!this.objectTreeSidebarPreferences.collapsed), options);
    this.objectsRows.addEventListener('click', event => this.objectTreeClick(event), options);
    this.objectsRows.addEventListener('dblclick', event => {
      const node = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-kind]');
      if (node?.dataset.treeKind && node.dataset.treeId) this.beginTreeRename(node.dataset.treeKind as 'folder' | 'drawing', node.dataset.treeId);
    }, options);
    this.objectsRows.addEventListener('contextmenu', event => this.objectTreeContextMenu(event), options);
    this.objectsRows.addEventListener('keydown', event => this.objectTreeKeydown(event), options);
    this.objectsRows.addEventListener('dragstart', event => this.objectTreeDragStart(event), options);
    this.objectsRows.addEventListener('dragover', event => this.objectTreeDragOver(event), options);
    this.objectsRows.addEventListener('drop', event => this.objectTreeDrop(event), options);
    this.objectsRows.addEventListener('dragend', () => {
      this.objectsPanel.classList.remove('is-dragging');
      for (const node of this.objectsTree.querySelectorAll<HTMLElement>('[data-drop-position],.is-drag-source')) {
        delete node.dataset.dropPosition;
        node.classList.remove('is-drag-source');
      }
    }, options);
    this.objectsTreeMenu.addEventListener('click', event => this.objectTreeMenuClick(event), options);
    this.objectsTreeMenu.addEventListener('keydown', event => this.objectTreeMenuKeydown(event), options);
    this.objectsTreeResize.addEventListener('pointerdown', event => this.objectTreeResizeStart(event), options);
    this.objectsTreeResize.addEventListener('keydown', event => this.objectTreeResizeKeydown(event), options);
    this.marketButton.addEventListener('click', () => this.marketPicker.open([instrumentKey(this.selection)], { multiple: false, capability: 'candles', apply: ids => { this.instrument.value = ids[0]; this.select(); } }), options);
    this.interval.addEventListener('change', () => this.select(), options);
    this.drawingSidebar.addEventListener('click', event => this.drawingSidebarClick(event), options);
    this.drawingSidebarMenuLayer.addEventListener('click', event => this.drawingFlyoutClick(event), options);
    this.drawingSidebarMenuLayer.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.openDrawingFlyoutGroup) {
        event.preventDefault();
        event.stopPropagation();
        this.closeDrawingFlyout(true);
      }
    }, options);
    document.addEventListener('pointerdown', event => {
      const target = event.target as Node | null;
      if (target && !this.drawingSidebar.contains(target) && !this.drawingSidebarMenuLayer.contains(target)) this.closeDrawingFlyout();
    }, options);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.openDrawingFlyoutGroup) {
        event.preventDefault();
        event.stopPropagation();
        this.closeDrawingFlyout(true);
      }
    }, options);
    this.drawSnap.addEventListener('click', () => {
      const drawingMagnet: MagnetMode = this.selection.drawingMagnet === 'off' ? 'weak' : this.selection.drawingMagnet === 'weak' ? 'strong' : 'off';
      this.selection = config({ ...this.selection, drawingMagnet });
      this.updateDrawingSnapButton();
      this.engine?.drawings.setOptions({ magnet: drawingMagnet });
      params.api.updateParameters(this.selection); this.save();
    }, options);
    this.drawUndo.addEventListener('click', () => { this.engine?.drawings.undo(); this.syncDrawingActions(); }, options);
    this.drawRedo.addEventListener('click', () => { this.engine?.drawings.redo(); this.syncDrawingActions(); }, options);
    this.drawEraser.addEventListener('click', () => { const next = !this.engine?.drawings.erasing(); this.engine?.drawings.setEraser(next); this.drawEraser.setAttribute('aria-pressed', String(next)); this.syncDrawingActions(); }, options);
    this.drawSettings.addEventListener('click', () => this.openDrawingSettings(), options);
    this.drawTemplates.addEventListener('click', () => this.openDrawingTemplates(), options);
    this.objectsToggle.addEventListener('click', () => this.toggleObjectsPanel(), options);
    this.latest.addEventListener('click', () => this.selection.type === 'footprint' ? this.engine?.focusFootprintLatest() : this.engine?.resetView(), options);
    this.indicators.addEventListener('click', () => void this.openPicker(), options);
    this.retry.addEventListener('click', () => this.selection.type === 'footprint' ? this.feed.retryFootprint() : this.feed.retry(params.api.id), options);
    this.pickerSearch.addEventListener('input', () => this.renderPicker(), options);
    this.picker.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action],button[data-add-script],button[data-add-native]');
      if (!button || button.disabled) return;
      if (button.dataset.addNative) { this.addNativeIndicator(button.dataset.addNative); return; }
      if (button.dataset.addScript) { void this.addStudy(button.dataset.addScript); return; }
      const action = button.dataset.dialogAction;
      if (action === 'close-picker') this.picker.close();
      else if (action === 'manage-library') {
        this.picker.close();
        this.openEditor(params.api.id);
      }
    }, options);
    this.picker.addEventListener('click', event => { if (event.target === this.picker) this.picker.close(); }, options);
    this.settingsDialog.addEventListener('click', event => {
      if (event.target === this.settingsDialog) { if (!this.settingsBusy) this.settingsDialog.close(); return; }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action]');
      if (button?.dataset.dialogAction === 'close-settings' && !this.settingsBusy) this.settingsDialog.close();
      else if (button?.dataset.dialogAction === 'apply-settings') void this.applyStudySettings();
    }, options);
    this.settingsDialog.addEventListener('cancel', event => { if (this.settingsBusy) event.preventDefault(); }, options);
    this.settingsForm.addEventListener('submit', event => {
      event.preventDefault();
      void this.applyStudySettings();
    }, options);
    this.footprintDialog.addEventListener('click', event => {
      if (event.target === this.footprintDialog) { if (!this.footprintBusy) this.footprintDialog.close(); return; }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action]');
      if (button?.dataset.dialogAction === 'close-footprint' && !this.footprintBusy) this.footprintDialog.close();
      else if (button?.dataset.dialogAction === 'apply-footprint') this.applyFootprintSettings();
    }, options);
    this.footprintDialog.addEventListener('cancel', event => { if (this.footprintBusy) event.preventDefault(); }, options);
    this.footprintForm.addEventListener('submit', event => { event.preventDefault(); this.applyFootprintSettings(); }, options);
    this.drawingDialog.addEventListener('click', event => {
      if (event.target === this.drawingDialog) { this.drawingDialog.close(); return; }
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action]')?.dataset.dialogAction;
      if (action === 'close-drawing-settings') this.drawingDialog.close();
      else if (action === 'apply-drawing-settings') this.applyDrawingSettingsFromDialog();
    }, options);
    this.drawingForm.addEventListener('submit', event => { event.preventDefault(); this.applyDrawingSettingsFromDialog(); }, options);
    this.templatesDialog.addEventListener('click', event => {
      if (event.target === this.templatesDialog) { this.templatesDialog.close(); return; }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action],button[data-template-action]');
      if (!button) return;
      if (button.dataset.dialogAction === 'close-drawing-templates') this.templatesDialog.close();
      else if (button.dataset.dialogAction === 'save-drawing-template') void this.saveDrawingTemplate();
      else if (button.dataset.templateAction) void this.templateAction(button.dataset.templateAction, button.dataset.templateId ?? '');
    }, options);
    this.drawingDialog.addEventListener('cancel', () => {}, options);
    this.templatesDialog.addEventListener('cancel', () => {}, options);
    this.chart.addEventListener('dblclick', event => { if (!(event.target as HTMLElement).closest('.active-indicators')) this.engine?.resetView(); }, options);
    this.chart.addEventListener('dblclick',event=>{const rect=this.chart.getBoundingClientRect(),hit=this.positioningRangeAt(event.clientX-rect.left,event.clientY-rect.top);if(!hit)return;event.preventDefault();event.stopImmediatePropagation();if(hit.range)this.addPositioningRange(hit.range);},{...options,capture:true});
    this.chart.addEventListener('pointermove',event=>{this.indicatorHoverPointerType=event.pointerType;if(!this.indicatorPointerDown)this.indicatorTooltipBlockedUntilMove=false;},options);
    this.chart.addEventListener('pointerdown',()=>{this.indicatorPointerDown=true;this.indicatorTooltipBlockedUntilMove=true;this.cancelIndicatorTooltip();},options);
    this.chart.addEventListener('pointerup',()=>{this.indicatorPointerDown=false;},options);
    this.chart.addEventListener('wheel',()=>{this.indicatorTooltipBlockedUntilMove=true;this.cancelIndicatorTooltip();},{...options,passive:true});
    this.chart.addEventListener('pointerleave',()=>{this.indicatorHoverPointerType=undefined;this.positioningRangeHit=null;this.engine?.setPositioningRange(null);this.hoveredBar=null;this.hoveredFootprint=null;this.cancelIndicatorTooltip();},options);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.positioningRangeHit=null;this.engine?.setPositioningRange(null);this.cancelIndicatorTooltip();}},{signal:this.abort.signal});
    this.chart.addEventListener('keydown', event => { if (!(event.target as HTMLElement).closest('.active-indicators')) this.keydown(event); }, options);
    for (const name of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'keydown'] as const) this.activeIndicators.addEventListener(name, event => event.stopPropagation(), options);
    this.activeRows.addEventListener('click', event => this.indicatorAction(event), options);
    this.activeRows.addEventListener('contextmenu', event => this.indicatorContextMenu(event), options);
    for (const name of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'keydown'] as const) this.paneIndicatorLayer.addEventListener(name, event => event.stopPropagation(), options);
    this.paneIndicatorLayer.addEventListener('click', event => {
      if (this.paneHeaderAction(event)) return;
      void this.indicatorAction(event);
    }, options);
    this.paneIndicatorLayer.addEventListener('contextmenu', event => this.indicatorContextMenu(event), options);
    this.toolbar.addEventListener('scroll', () => this.updateToolbarOverflowCue(), { ...options, passive: true });
    this.toolbarCue.addEventListener('click', () => this.scrollToolbar(), options);
    window.addEventListener('resize', () => this.updateToolbarOverflowCue(), options);
    this.toolbarResizeObserver = new ResizeObserver(() => this.updateToolbarOverflowCue());
    this.toolbarResizeObserver.observe(this.toolbar);
    for (const child of this.toolbar.children) this.toolbarResizeObserver.observe(child);
    this.chartSettings.addEventListener('click', () => this.chartSettingsDialog.showModal(), options);
    this.chartSettingsDialog.addEventListener('click', event => {
      if (event.target === this.chartSettingsDialog || (event.target as HTMLElement).closest('[data-dialog-action=close-chart-settings]')) this.chartSettingsDialog.close();
    }, options);
    this.candleTimerCheckbox.addEventListener('change', () => {
      this.selection = { ...this.selection, candleElapsedTimer: this.candleTimerCheckbox.checked };
      this.engine?.setCandleTimerEnabled(this.selection.candleElapsedTimer);
      this.params.api.updateParameters(this.selection); this.save();
    }, options);
    this.gridCheckbox.addEventListener('change', () => {
      this.selection = { ...this.selection, grid: this.gridCheckbox.checked };
      this.engine?.setGridVisible(this.selection.grid);
      this.params.api.updateParameters(this.selection); this.save();
    }, options);
    this.wheelMode.addEventListener('change', () => {
      this.selection = { ...this.selection, wheelMode: this.wheelMode.value === 'both-axes' ? 'both-axes' : 'tradingview' };
      this.engine?.setWheelMode(this.selection.wheelMode);
      this.params.api.updateParameters(this.selection); this.save();
    }, options);
    if(import.meta.env.VITE_DATA_MODE==='staging'){const watch=this.watchButton=document.createElement('button');watch.textContent='Watch level';watch.title='Select two zone boundaries for Binance BTCUSDT USD-M perpetual';watch.addEventListener('click',()=>this.beginWatchZone(bounds=>window.dispatchEvent(new CustomEvent('iqterminal-watch-zone',{detail:bounds}))),options);this.toolbar.append(watch);}
    this.engine = new OpenAlgoCandleChart(this.chart, this.scheduler, 'canvas2d', params.api.id, this.selection);
    this.engine.drawings.setOptions({ magnet: this.selection.drawingMagnet });
    this.releaseWatchObjects = this.engine.objects.register({
      id: 'level-watch-zones',
      get: () => instrumentKey(this.selection) === 'binance:perpetual' && this.watchList.some(watch => watch.state === 'armed' || watch.state === 'draft')
        ? { kind: 'profile', name: 'Level Watch zones', paneIndex: this.engine?.objects.primaryPaneIndex() ?? 0, visible: this.watchZonesVisible }
        : null,
      setVisible: visible => { this.watchZonesVisible = visible; this.engine?.setWatchZones(visible ? this.watchList : []); },
      focus: () => { const watch = this.watchList.find(item => item.state === 'armed' || item.state === 'draft'); if (watch) this.focusWatch(watch); },
    });
    this.loadDrawingTemplates();
    this.loadObjectTreeForSelection();
    this.subscriptions.push({ dispose: this.engine.objects.subscribe(() => this.renderDrawingObjects()) });
    this.subscriptions.push(
      { dispose: this.engine.chart.on('draw:tool', () => this.syncDrawingActions()) },
      { dispose: this.engine.chart.on('draw:add', payload => {
        const event = payload as DrawingEvent;
        if (!event.history) this.enrichPlacedDrawing(event.drawing);
      }) },
      { dispose: this.engine.chart.on('drawing:select', () => this.syncDrawingActions()) },
      { dispose: this.engine.chart.on('drawing:change', () => this.syncDrawingActions()) },
    );
    this.engine.onFootprintViewport=(from,to,analysis)=>{if(this.footprintHasInitialView)this.feed.requestFootprintViewport(this.params.api.id,from,to,analysis);};
    this.engine.onHeatmapViewport = viewport => {
      if (this.selection.type === 'footprint' && !this.footprintHasInitialView && this.footprintStatus.state === 'loading') return;
      if (this.nativeIndicator(HEATMAP_ID) && supportsDepth(this.selection)) this.feed.requestHeatmapViewport(this.params.api.id, viewport);
      this.updateOrderWallsViewport(viewport.from, viewport.to, viewport.low, viewport.high, viewport.height);
    };
    this.engine.setWheelMode(this.selection.wheelMode);
    this.engine.setCandleTimerEnabled(this.selection.candleElapsedTimer);
    this.engine.setGridVisible(this.selection.grid); this.engine.setBasePriceVisible(this.selection.basePriceVisible);
    if (this.selection.type === 'footprint') this.engine.setDisplayMode('footprint');
    this.applyFootprintOptions();
    this.outputRegistry = new ChartNumericOutputRegistry(params.api.id, callback => {
      if (this.engine) this.engine.enqueueVisible(callback); else callback();
    }, () => this.savedNumericConsumerReferences());
    this.releaseOutputRegistry = registerChartNumericOutputRegistry(this.outputRegistry);
    this.releaseCompositionOutputListener = this.outputRegistry.subscribeOutputs(output => this.queueCompositionSmaRepair(output));
    this.studyHost = new ScriptStudyHost(params.api.id, this.engine, this.feed, this.library, this.selection, studies => {
      this.selection = config({ ...this.selection, indicators: withStudyPins(this.selection.indicators, studies) });
      this.params.api.updateParameters(this.selection);
      this.save();
    }, this.outputRegistry);
    this.compositionPlacement = new ManagedCompositionPlacementController({
      chart: this.engine.chart,
      getComposition: () => this.selection.composition,
      getSubjects: () => this.selection.indicators.filter(instance => (instance.script || instance.definitionId === COMPOSITION_SMA_ID
        || (instance.definitionId === CVD_ID || instance.definitionId === OPEN_INTEREST_ID) && instance.visible) && instance.placement !== 'attachment').map(instance => ({
        instanceId: instance.instanceId,
        title: instance.script?.title ?? (instance.definitionId === CVD_ID ? nativeDefinition(CVD_ID)?.name ?? 'Multi-Venue CVD'
          : instance.definitionId === OPEN_INTEREST_ID ? nativeDefinition(OPEN_INTEREST_ID)?.name ?? 'Open Interest' : this.compositionSmaTitle(instance)),
        kind: instance.script ? 'script' as const : 'native' as const,
        adoptablePane: instance.definitionId === CVD_ID || instance.definitionId === OPEN_INTEREST_ID,
        placement: instance.placement === 'pane' ? 'pane' as const : 'overlay' as const,
        paneId: instance.paneId ?? ([CVD_ID, OPEN_INTEREST_ID].includes(instance.definitionId) ? compositionPaneId(instance.instanceId) : undefined),
        paneIndex: () => instance.script ? this.studyHost?.paneIndex(instance.instanceId) ?? -1
          : instance.definitionId === CVD_ID ? this.cvdView?.paneIndex() ?? -1 : instance.definitionId === OPEN_INTEREST_ID
            ? this.openInterestView?.paneIndex() ?? -1 : this.compositionApis.get(instance.instanceId)?.paneIndex ?? -1,
        moveTo: (placement: 'overlay' | 'pane', paneId: string, paneIndex: number, silent: boolean) => {
          if (instance.script) return this.studyHost?.moveStudy(instance.instanceId, placement, paneId, paneIndex, { silent }) ?? false;
          if (instance.definitionId === CVD_ID) return this.cvdView?.moveToPaneIndex(paneIndex) ?? false;
          if (instance.definitionId === OPEN_INTEREST_ID) return this.openInterestView?.moveToPaneIndex(paneIndex) ?? false;
          const api = this.compositionApis.get(instance.instanceId);
          return Boolean(api && (api.paneIndex === paneIndex || this.engine?.chart.moveIndicator(api.id, paneIndex, { force: true })));
        },
      })),
      setApplying: value => { this.applyingManagedCompositionMove = value; },
      commit: (composition, placements, scriptMoves) => {
        const byId = new Map(placements.map(item => [item.instanceId, item]));
        this.selection = config({ ...this.selection, composition, indicators: this.selection.indicators.map(instance => {
          const next = byId.get(instance.instanceId);
          return next ? { ...instance, placement: next.placement, paneId: next.paneId } : instance;
        }) });
        this.capturePaneOrder(false, true);
        this.params.api.updateParameters(this.selection);
        this.reconcileIndicators();
        this.params.api.updateParameters(this.selection);
        if (scriptMoves) this.studyHost?.commitPlacementChanges();
        else this.save();
      },
      hasProtectedPaneContent: paneIndex => Boolean(this.engine && (this.engine.objects.list().some(object => object.paneIndex === paneIndex)
        || this.engine.drawings.drawings().some(drawing => drawing.paneIndex === paneIndex))),
      reportError: message => { this.activeIndicators.dataset.error = message; this.renderActiveIndicators(); },
      clearError: () => { delete this.activeIndicators.dataset.error; },
    });
    this.studyHost.setManagedPaneIndexResolver((paneId, exceptAttachmentId) =>
      this.compositionPlacement?.resolveManagedPaneIndex(paneId, exceptAttachmentId) ?? -1);
    this.registerCoreObjectProviders();
    this.indicatorLifecycle = new IndicatorLifecycle(instance => this.createIndicatorHandle(instance), (instance, error) => { if (!this.dead && this.selection.indicators.some(i => i.instanceId === instance.instanceId)) { this.indicatorErrors.set(instance.instanceId,errorText(error)); this.renderActiveIndicators(); } });
    this.subscriptions.push(
      { dispose: this.studyHost.subscribe(() => { this.updateDepthNotice(); this.reconcileIndicators(); this.syncScriptObjectProviders(); }) },
      { dispose: this.studyHost.subscribeData(() => this.handleStudyDataUpdate()) },
    );
    this.studyHost.restore(this.selection.studies);
    const unsubscribeCrosshair = this.engine.chart.subscribeCrosshairMove(event => this.crosshair(event));
    this.subscriptions.push({ dispose: unsubscribeCrosshair });
    this.subscriptions.push(
      { dispose: this.engine.chart.on('indicatorSource', event => this.openStudySource(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorSettings', event => void this.openStudySettings(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorRemoved', event => {
        if (this.internalCompositionRemovals.delete(event.instanceId)) return;
        if (this.studyHost?.removeNativeInstance(event.instanceId)) return;
        if (this.selection.indicators.some(instance => instance.instanceId === event.instanceId && instance.definitionId === COMPOSITION_SMA_ID)) this.removeIndicatorInstance(event.instanceId);
      }) },
      { dispose: this.engine.chart.on('objects:change', () => this.studyHost?.syncNativeVisibility()) },
      { dispose: this.engine.chart.on('paneAdded', () => this.schedulePaneIndicatorLayout()) },
      { dispose: this.engine.chart.on('paneRemoved', () => this.schedulePaneIndicatorLayout()) },
      { dispose: this.engine.chart.on('paneMoved', () => { if (!this.applyingManagedCompositionMove) { this.capturePaneOrder(); this.syncPaneLayoutControls(); this.syncOrderFlowPane(); } this.schedulePaneIndicatorLayout(); }) },
      { dispose: this.engine.chart.on('paneMaximized', () => this.schedulePaneIndicatorLayout()) },
      { dispose: this.engine.chart.on('paneCollapsed', () => { this.captureCompositionLayout(); this.schedulePaneIndicatorLayout(); }) },
      { dispose: this.engine.chart.on('paneResized', () => { if (!this.applyingManagedCompositionMove) this.captureCompositionLayout(); this.schedulePaneIndicatorLayout(); }) },
      { dispose: this.engine.chart.on('pan', () => this.engine?.enqueueVisible(this.syncCompositionScalesOnFrame)) },
      { dispose: this.engine.chart.on('zoom', () => this.engine?.enqueueVisible(this.syncCompositionScalesOnFrame)) },
      { dispose: this.engine.chart.on('data:update', () => this.engine?.enqueueVisible(this.syncCompositionScalesOnFrame)) },
      { dispose: this.engine.chart.on('paneResized', () => this.engine?.enqueueVisible(this.syncCompositionScalesOnFrame)) },
      { dispose: this.engine.chart.on('resize', () => this.schedulePaneIndicatorLayout()) },
      { dispose: this.engine.chart.on('resize', () => this.engine?.enqueueVisible(this.syncCompositionScalesOnFrame)) },
    );
    this.overlays.append(this.activeIndicators);
    this.paneIndicatorLayer.className = 'pane-indicator-layer';
    this.primaryPaneCollapsedHeader.className = 'primary-pane-collapsed-header';
    this.primaryPaneCollapsedHeader.hidden = true;
    this.paneIndicatorLayer.append(this.primaryPaneCollapsedHeader);
    this.positioningTooltip.className = 'net-positioning-tooltip';
    this.positioningTooltip.hidden = true;
    this.positioningTooltip.setAttribute('role', 'tooltip');
    this.paneLoadingLayer.className = 'pane-loading-layer';
    this.chart.append(this.paneLoadingLayer);
    this.chart.append(this.overlays, this.heatmapControls.readout, this.paneIndicatorLayer, this.positioningTooltip);
    this.floatingDrawingToolbar = new FloatingDrawingToolbar(this.chart, this.floatingDrawingToggle, [this.drawingSidebar, this.drawingSidebarMenuLayer], DRAWING_TOOL_IDS, this.selection.floatingDrawingToolbar,
      tool => this.sidebarButton(tool === 'cursor' ? 'Pointer' : tool === 'eraser' ? 'Erase' : tool === 'move' ? 'Move drawing toolbar' : `Use ${drawingToolName(tool)} tool`,
        tool === 'cursor' ? 'Select and edit drawings' : tool === 'eraser' ? 'Erase drawings' : tool === 'move' ? 'Drag to move toolbar' : `Use ${drawingToolName(tool)}`, tool),
      tool => this.setDrawingTool(tool), () => { this.engine?.drawings.setEraser(!this.engine.drawings.erasing()); this.syncDrawingActions(); },
      value => { this.selection = { ...this.selection, floatingDrawingToolbar: value }; this.params.api.updateParameters(this.selection); this.save(); },
      () => this.closeDrawingFlyout(), `floating-drawing-toolbar-${params.api.id}`);
    this.chartFooter.append(this.heatmapControls.notice, this.orderWallsControls.notice, this.statusNode);
    this.chartFooterObserver = new MutationObserver(() => this.syncChartFooterVisibility());
    this.chartFooterObserver.observe(this.chartFooter, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    this.syncChartFooterVisibility();
    this.subscriptions.push(params.api.onDidVisibilityChange(() => this.visibility()));
    document.addEventListener('visibilitychange', () => this.syncNetPositioning(), { signal: this.abort.signal });
    window.addEventListener(CURRENCY_EVENT, () => { this.cancelIndicatorTooltip(); this.applyFootprintOptions(); this.syncFootprintTotals(); this.syncNetPositioning(); syncCurrencyControl(this.footprintUnits, this.selection.footprintUnits); this.renderActiveIndicators(); this.updateStatus(); this.engine?.refreshCaptionCurrency(); }, { signal: this.abort.signal });
    window.addEventListener(TIMEZONE_EVENT, () => this.cancelIndicatorTooltip(), { signal: this.abort.signal });
    this.subscriptions.push(params.api.onDidActiveChange(({ isActive }) => {
      if (!isActive) return;
      this.updateObjectsSummary();
    }));
    this.subscriptions.push(params.api.onDidFocusChange(({ isFocused }) => {
      this.chart.dataset.focused = String(isFocused);
      if (isFocused) this.updateObjectsSummary();
    }));
    this.register(params.api.id, this);
    this.subscribe();
    queueMicrotask(() => {
      if (!this.dead) this.params.api.setTitle(`${instrumentLabel(this.selection)} · ${this.selection.interval}`);
    });
    this.visibility();
    this.timer = setInterval(() => {
      if (this.visible && !document.hidden) {
        this.engine?.tickCandleTimer();
        this.updateStatus();
        this.refreshFootprintCellTooltip();
      }
    }, 1000);
  }

  private buildDialogs() {
    this.chartSettingsDialog.className = 'indicator-settings chart-settings';
    this.chartSettingsDialog.setAttribute('aria-label', 'Chart settings');
    const chartForm = document.createElement('div'); chartForm.className = 'indicator-settings-form';
    const chartHeader = document.createElement('header');
    const chartTitle = document.createElement('h2'); chartTitle.textContent = 'Chart settings';
    chartHeader.append(chartTitle, this.dialogButton('Close', 'close-chart-settings'));
    const chartFields = document.createElement('div'); chartFields.className = 'indicator-settings-fields';
    const gridLabel = document.createElement('label'); gridLabel.className = 'indicator-setting-field';
    const gridText = document.createElement('span'); gridText.textContent = 'Gridlines';
    this.baseVisible.type = 'checkbox'; this.baseVisible.setAttribute('aria-label', 'Show base candles');
    this.baseVisible.addEventListener('change', () => { this.selection = { ...this.selection, basePriceVisible: this.baseVisible.checked }; this.engine?.setBasePriceVisible(this.selection.basePriceVisible); this.params.api.updateParameters(this.selection); this.save(); }, { signal: this.abort.signal });
    this.gridCheckbox.type = 'checkbox'; gridLabel.append(gridText, this.gridCheckbox); chartFields.append(gridLabel);
    const baseLabel = document.createElement('label'); baseLabel.className = 'indicator-setting-field'; const baseText = document.createElement('span'); baseText.textContent = 'Show base candles'; baseLabel.append(baseText, this.baseVisible); chartFields.append(baseLabel);
    const baseHint = document.createElement('p'); baseHint.className = 'dialog-status'; baseHint.textContent = 'Base style: Candles. Footprint presentation temporarily replaces the base; this preference is retained.'; chartFields.append(baseHint);
    const timerLabel = document.createElement('label'); timerLabel.className = 'indicator-setting-field';
    const timerText = document.createElement('span'); timerText.textContent = 'Candle elapsed timer';
    this.candleTimerCheckbox.type = 'checkbox'; this.candleTimerCheckbox.setAttribute('aria-label', 'Candle elapsed timer');
    timerLabel.append(timerText, this.candleTimerCheckbox); chartFields.append(timerLabel);
    const timerHint = document.createElement('p'); timerHint.className = 'dialog-status'; timerHint.textContent = 'Elapsed mm:ss beside the current candle. Resets each candle; hidden for expired candles.'; chartFields.append(timerHint);
    const wheelLabel = document.createElement('label'); wheelLabel.className = 'indicator-setting-field';
    const wheelText = document.createElement('span'); wheelText.textContent = 'Mouse wheel';
    this.wheelMode.setAttribute('aria-label', 'Mouse wheel behavior');
    this.wheelMode.add(new Option('TradingView style', 'tradingview'));
    this.wheelMode.add(new Option('Time + price at cursor (previous)', 'both-axes'));
    wheelLabel.append(wheelText, this.wheelMode); chartFields.append(wheelLabel);
    const wheelHint = document.createElement('p'); wheelHint.className = 'dialog-status';
    wheelHint.textContent = 'TradingView style: wheel zooms time from the right edge; Ctrl/⌘ + wheel zooms time at the cursor; Shift + wheel pans. Wheel on the price scale zooms price.';
    chartFields.append(wheelHint);
    chartForm.append(chartHeader, chartFields); this.chartSettingsDialog.append(chartForm);

    this.picker.className = 'indicator-picker';
    this.picker.setAttribute('aria-label', 'Add an indicator');
    const pickerHeader = document.createElement('header');
    const pickerTitle = document.createElement('h2'); pickerTitle.textContent = 'Indicators';
    const pickerClose = this.dialogButton('Close', 'close-picker');
    pickerHeader.append(pickerTitle, pickerClose);
    const searchLabel = document.createElement('label');
    searchLabel.className = 'indicator-search';
    const searchText = document.createElement('span'); searchText.textContent = 'Search';
    this.pickerSearch.type = 'search';
    this.pickerSearch.placeholder = 'Name or description';
    this.pickerSearch.setAttribute('aria-label', 'Search indicators');
    searchLabel.append(searchText, this.pickerSearch);
    this.pickerList.className = 'indicator-picker-list';
    this.pickerStatus.className = 'dialog-status';
    this.pickerStatus.setAttribute('role', 'status');
    const pickerFooter = document.createElement('footer');
    pickerFooter.append(this.dialogButton('Manage library', 'manage-library'), this.dialogButton('Done', 'close-picker'));
    this.picker.append(pickerHeader, searchLabel, this.pickerList, this.pickerStatus, pickerFooter);

    this.settingsDialog.className = 'indicator-settings';
    this.settingsDialog.setAttribute('aria-label', 'Study settings');
    this.settingsForm.className = 'indicator-settings-form';
    this.settingsForm.noValidate = true;
    const settingsHeader = document.createElement('header');
    const settingsTitle = document.createElement('h2');
    settingsTitle.className = 'settings-title';
    settingsTitle.textContent = 'Study settings';
    settingsHeader.append(settingsTitle, this.dialogButton('Close', 'close-settings'));
    this.settingsFields.className = 'indicator-settings-fields';
    this.settingsStatus.className = 'dialog-status';
    this.settingsStatus.setAttribute('role', 'status');
    const settingsFooter = document.createElement('footer');
    settingsFooter.append(this.dialogButton('Cancel', 'close-settings'), this.dialogButton('Apply', 'apply-settings', true));
    this.settingsForm.append(settingsHeader, this.settingsFields, this.settingsStatus, settingsFooter);
    this.settingsDialog.append(this.settingsForm);

    this.footprintDialog.className = 'indicator-settings footprint-settings-dialog';
    this.footprintDialog.setAttribute('aria-label', 'Footprint display settings');
    this.footprintForm.className = 'indicator-settings-form footprint-settings-form';
    const footprintHeader = document.createElement('header');
    const footprintTitle = document.createElement('h2'); footprintTitle.textContent = 'Footprint settings';
    footprintHeader.append(footprintTitle, this.dialogButton('Close', 'close-footprint'));
    this.footprintFields.className = 'footprint-settings-fields';
    this.footprintFields.append(
      this.rowPriceControl, this.footprintField('Volume units', this.footprintUnits),
      this.footprintField('Cell display', this.selectControl('displayMode', [
        ['bidask', 'Bid / ask'], ['delta', 'Delta'], ['delta-profile', 'Delta profile'], ['volume-delta-candle', 'Volume delta candle'], ['volume', 'Volume'],
      ])),
      this.footprintField('Cells', this.selectControl('cellStyle', [
        ['ladder', 'Bid / ask ladder'], ['profile', 'Volume profile'],
      ])),
      this.footprintField('Histogram background opacity (%)', this.opacityControl()),
      this.footprintField('Show execution candle', this.checkboxControl('showCandle')),
      this.footprintField('Show point of control', this.checkboxControl('showPoc')),
      this.footprintField('Show VAH and VAL', this.checkboxControl('showValueArea')),
      this.footprintField('Diagonal imbalances', this.checkboxControl('showDiagonalImbalances')),
      this.footprintField('Stacked imbalance brackets', this.checkboxControl('stackedImbalances')),
      this.footprintField('Dominant / opposing ratio', this.selectControl('imbalanceRatio', [
        ['2', '2 : 1'], ['3', '3 : 1'], ['4', '4 : 1'],
      ])),
      this.footprintField('Minimum dominant volume (BTC)', this.numberControl('imbalanceThreshold')),
    );
    const display = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="displayMode"]')!;
    const cells = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="cellStyle"]')!;
    display.addEventListener('change', () => {
      if (display.value === 'delta-profile' || display.value === 'volume-delta-candle') cells.value = 'profile';
      if (display.value === 'volume-delta-candle') {
        for (const key of ['showCandle', 'showPoc', 'showValueArea']) this.footprintFields.querySelector<HTMLInputElement>(`[data-footprint-option="${key}"]`)!.checked = true;
      }
    }, { signal: this.abort.signal });
    const reconcilePreset = () => {
      if (display.value === 'delta-profile' && cells.value !== 'profile') display.value = 'delta';
      if (display.value === 'volume-delta-candle' && cells.value !== 'profile') display.value = 'bidask';
    };
    cells.addEventListener('change', reconcilePreset, { signal: this.abort.signal });
    const settingsHint = document.createElement('p');
    settingsHint.className = 'footprint-settings-hint';
    settingsHint.textContent = 'Rows start at fixed price multiples and include their lower bound, excluding their upper bound. Diagonal imbalances color dominant buy or sell rows. Optional brackets mark runs of two adjacent rows. Both use classified aggregate observations only. ' + (import.meta.env.VITE_DATA_MODE === 'staging' ? 'Changing interval or row size reloads the bounded retained staging history; ' : 'Changing interval or row size starts a fresh collection unless another chart retains that exact stream; ') + 'OpenScript studies use native candle OHLCV.';
    const footprintFooter = document.createElement('footer');
    footprintFooter.append(this.dialogButton('Cancel', 'close-footprint'), this.dialogButton('Apply', 'apply-footprint', true));
    this.footprintForm.append(footprintHeader, this.footprintFields, settingsHint, footprintFooter);
    this.footprintDialog.append(this.footprintForm);
  }

  private buildDrawingDialogs() {
    this.drawingDialog.className = 'indicator-settings drawing-settings-dialog';
    this.drawingDialog.setAttribute('aria-label', 'Drawing settings');
    this.drawingForm.className = 'indicator-settings-form'; this.drawingForm.noValidate = true;
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.className = 'drawing-settings-title'; title.textContent = 'Drawing settings';
    header.append(title, this.dialogButton('Close', 'close-drawing-settings'));
    this.drawingFields.className = 'indicator-settings-fields';
    this.drawingStatus.className = 'dialog-status'; this.drawingStatus.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    footer.append(this.dialogButton('Cancel', 'close-drawing-settings'), this.dialogButton('Apply', 'apply-drawing-settings', true));
    this.drawingForm.append(header, this.drawingFields, this.drawingStatus, footer);
    this.drawingDialog.append(this.drawingForm);

    this.templatesDialog.className = 'indicator-picker drawing-templates-dialog';
    this.templatesDialog.setAttribute('aria-label', 'Drawing settings templates');
    const templateHeader = document.createElement('header');
    const templateTitle = document.createElement('h2'); templateTitle.textContent = 'Drawing templates';
    templateHeader.append(templateTitle, this.dialogButton('Close', 'close-drawing-templates'));
    const saveRow = document.createElement('label'); saveRow.className = 'drawing-template-save-row';
    const nameLabel = document.createElement('span'); nameLabel.textContent = 'Save selected look';
    this.templatesName.type = 'text'; this.templatesName.maxLength = 48; this.templatesName.placeholder = 'Template name';
    this.templatesName.setAttribute('aria-label', 'Drawing template name');
    const includeLabel = document.createElement('label'); includeLabel.className = 'drawing-template-include-label';
    this.templatesIncludeLabel.type = 'checkbox'; this.templatesIncludeLabel.setAttribute('aria-label', 'Include label');
    const includeLabelText = document.createElement('span'); includeLabelText.textContent = 'Include label';
    includeLabel.append(this.templatesIncludeLabel, includeLabelText);
    saveRow.append(nameLabel, this.templatesName, includeLabel, this.dialogButton('Save', 'save-drawing-template', true));
    this.templatesList.className = 'drawing-template-list';
    this.templatesStatus.className = 'dialog-status'; this.templatesStatus.setAttribute('role', 'status');
    const templateFooter = document.createElement('footer'); templateFooter.append(this.dialogButton('Done', 'close-drawing-templates'));
    this.templatesDialog.append(templateHeader, saveRow, this.templatesList, this.templatesStatus, templateFooter);
  }

  private loadDrawingTemplates() {
    let repository: IQDrawingTemplateRepository;
    try {
      repository = new IQDrawingTemplateRepository(createLocalStorageDrawingTemplateStorage(window.localStorage));
      this.templateCatalog = repository.load();
    } catch (error) {
      // A malformed or inaccessible persistent record stays untouched. This isolated catalog is session-only.
      this.templateStorageWarning = `Saved template catalog could not be read; using memory for this session (${errorText(error)}).`;
      repository = new IQDrawingTemplateRepository(createMemoryDrawingTemplateStorage());
      this.templateCatalog = repository.load();
    }
    this.templateRepository = repository;
    this.templateUnsubscribe = repository.subscribe(next => { this.templateCatalog = next; this.renderDrawingTemplates(); });
    this.setTemplateStatus(this.templateStorageWarning);
    this.renderDrawingTemplates();
  }

  private registerCoreObjectProviders() {
    if (!this.engine) return;
    const entries = [
      { id: TRADE_BUBBLES_ID, kind: 'indicator' as const, name: 'Trade Bubbles' },
      { id: FOOTPRINT_ID, kind: 'profile' as const, name: 'Footprint' },
      { id: FOOTPRINT_TOTALS_ID, kind: 'indicator' as const, name: 'Footprint Totals' },
      { id: HEATMAP_ID, kind: 'indicator' as const, name: 'Order-book Heatmap' },
      { id: ORDER_WALLS_ID, kind: 'indicator' as const, name: 'Order Walls' },
    ];
    this.coreObjectProviderReleases = entries.map(entry => this.engine!.objects.register({
      id: `iqterminal-${entry.id}`,
      get: () => {
        const instance = this.nativeIndicator(entry.id);
        if (!instance || entry.id === FOOTPRINT_TOTALS_ID && this.selection.type !== 'footprint') return null;
        const settingsEnabled = instance.settings.enabled !== false;
        const paneIndex = entry.id === FOOTPRINT_TOTALS_ID ? this.engine!.footprintTotalsPaneIndex(instance.instanceId) : this.engine!.objects.primaryPaneIndex();
        return { kind: entry.kind, name: entry.name, paneIndex: paneIndex < 0 ? this.engine!.objects.primaryPaneIndex() : paneIndex,
          visible: instance.visible && settingsEnabled && (entry.id !== FOOTPRINT_ID || this.selection.type === 'footprint')
            && (entry.id !== FOOTPRINT_TOTALS_ID || supportsDepth(this.selection) && this.selection.type === 'footprint'),
          selected: false };
      },
      select: () => this.params.api.setActive(),
      setVisible: visible => this.setIndicatorObjectVisible(entry.id, visible),
      remove: () => this.removeIndicatorObject(entry.id),
      openSettings: () => { const instance = this.nativeIndicator(entry.id); if (instance) this.openIndicatorSettings(instance); },
      focus: () => this.params.api.setActive(),
    }));
    this.engine.objects.refresh();
  }

  private syncScriptObjectProviders() {
    this.compositionWork.scriptObjectProviderSyncs++;
    const engine = this.engine; const host = this.studyHost;
    if (!engine || !host || this.dead) return;
    const views = host.views(); const ids = new Set(views.map(view => view.attachmentId));
    for (const view of views) {
      if (this.scriptObjectProviderReleases.has(view.attachmentId)) continue;
      const attachmentId = view.attachmentId;
      const release = engine.objects.register({
        id: `script-study-${attachmentId}`,
        get: () => {
          const current = this.studyHost?.views().find(item => item.attachmentId === attachmentId);
          const api = this.studyHost?.apiForAttachment(attachmentId);
          if (!current || !api) return null;
          // The chart indicator has a generated engine descriptor ID, not the
          // persisted attachment ID. Resolve its live API pane directly so a
          // moved study's object row cannot keep blocking cleanup of its old pane.
          return { kind: 'indicator', name: current.title, paneIndex: api.paneIndex, visible: current.visible,
            dataStatus: current.status === 'Study ready' ? { state: 'ready' as const } : { state: 'loading' as const } };
        },
        subscribe: listener => this.studyHost?.subscribe(listener) ?? (() => {}),
        select: () => this.params.api.setActive(),
        setVisible: visible => { if (this.studyHost?.views().find(item => item.attachmentId === attachmentId)?.visible !== visible) this.studyHost?.setVisibleStudy(attachmentId, visible); },
        remove: () => {
          const reason = this.studyHost?.removeBlockReason(attachmentId);
          if (reason) { this.activeIndicators.dataset.error = reason; this.renderActiveIndicators(); return; }
          this.studyHost?.remove(attachmentId);
        },
        openSettings: () => { void this.openAttachmentSettings(attachmentId); },
        focus: () => this.params.api.setActive(),
      });
      this.scriptObjectProviderReleases.set(attachmentId, release);
    }
    for (const [id, release] of this.scriptObjectProviderReleases) if (!ids.has(id)) { release(); this.scriptObjectProviderReleases.delete(id); }
    engine.objects.refresh();
  }

  private setIndicatorObjectVisible(definitionId: string, visible: boolean) {
    const instance = this.nativeIndicator(definitionId); if (!instance) return;
    this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear();
    if ((definitionId === FOOTPRINT_ID || definitionId === FOOTPRINT_TOTALS_ID) && visible && !supportsDepth(this.selection)) return;
    if (definitionId === FOOTPRINT_TOTALS_ID && visible && this.selection.type !== 'footprint') return;
    const change: Partial<Pick<IndicatorInstance, 'visible' | 'settings'>> = { visible };
    if (definitionId === HEATMAP_ID || definitionId === ORDER_WALLS_ID) change.settings = { ...instance.settings, enabled: visible };
    if (definitionId === FOOTPRINT_ID) this.selection = config({ ...this.selection, type: visible ? 'footprint' : 'candle', indicators: this.selection.indicators.map(item => item.instanceId === instance.instanceId ? { ...item, visible } : item) });
    else this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(item => item.instanceId === instance.instanceId ? { ...item, ...change } : item) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private removeIndicatorObject(definitionId: string) {
    const instance = this.nativeIndicator(definitionId); if (!instance) return;
    this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear();
    this.selection = config({ ...this.selection, ...(definitionId === FOOTPRINT_ID ? { type: 'candle' as const } : {}), indicators: this.selection.indicators.filter(item => item.instanceId !== instance.instanceId) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private removeIndicatorInstance(instanceId: string) {
    const instance = this.selection.indicators.find(item => item.instanceId === instanceId); if (!instance) return;
    this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear();
    if (instance.script) {
      const reason = this.studyHost?.removeBlockReason(instanceId);
      if (reason) { this.activeIndicators.dataset.error = reason; this.renderActiveIndicators(); return; }
    }
    const dependent = this.selection.indicators.find(candidate => Object.values(candidate.numericInputs ?? {}).some(input => input.instanceId === instanceId));
    if (dependent) { this.activeIndicators.dataset.error = `Cannot remove ${instance.script?.title ?? instance.definitionId} while ${this.compositionSmaTitle(dependent)} depends on its output. Remove that study first.`; this.renderActiveIndicators(); return; }
    const cleanupTarget = instance.paneId ? this.compositionPlacement.captureManagedPane(instance.paneId) : null;
    if (new Set<string>([TRADE_BUBBLES_ID, FOOTPRINT_ID, FOOTPRINT_TOTALS_ID, HEATMAP_ID, ORDER_WALLS_ID, TPO_ID]).has(instance.definitionId)) { this.removeIndicatorObject(instance.definitionId); return; }
    const indicators = this.selection.indicators.filter(item => item.instanceId !== instanceId);
    const composition = removeCompositionMember(this.selection.composition, instanceId, indicators.map(item => item.instanceId));
    this.selection = config({ ...this.selection, ...(instance.definitionId === FOOTPRINT_ID ? { type: 'candle' as const } : {}), indicators, composition,
      paneOrder: (this.selection.paneOrder ?? []).filter(id => id !== instanceId) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators();
    this.compositionPlacement.cleanupManagedPane(cleanupTarget);
    this.capturePaneOrder(); this.save();
  }

  private drawingSidebarClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const group = button.dataset.drawingGroup;
    if (button.classList.contains('drawing-sidebar-menu-toggle') && group) {
      this.toggleDrawingFlyout(group);
      return;
    }
    if (button === this.drawSelect) {
      this.closeDrawingFlyout();
      this.setDrawingTool(null);
      return;
    }
    if (button.classList.contains('drawing-sidebar-primary') || button.classList.contains('drawing-sidebar-direct-tool')) {
      const tool = button.dataset.drawingTool;
      if (!tool) return;
      if (group) this.drawingLastToolByGroup.set(group, tool);
      this.closeDrawingFlyout();
      this.setDrawingTool(tool);
    }
  }

  private drawingFlyoutClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.drawing-sidebar-flyout-tool');
    if (!button?.dataset.drawingTool) return;
    const { drawingTool: tool, drawingGroup: group } = button.dataset;
    if (group) this.drawingLastToolByGroup.set(group, tool);
    this.closeDrawingFlyout();
    this.setDrawingTool(tool);
    if (group) this.drawingPrimaryButtons.get(group)?.focus();
  }

  private toggleDrawingFlyout(group: string) {
    if (this.openDrawingFlyoutGroup === group) {
      this.closeDrawingFlyout();
      return;
    }
    this.closeDrawingFlyout();
    const flyout = this.drawingFlyouts.get(group);
    const trigger = this.drawingFlyoutButtons.get(group);
    if (!flyout || !trigger) return;
    flyout.hidden = false;
    this.openDrawingFlyoutGroup = group;
    trigger.setAttribute('aria-expanded', 'true');
    const workspace = this.chartWorkspace.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const menu = flyout.getBoundingClientRect();
    const top = Math.max(4, Math.min(anchor.top - workspace.top - 3, workspace.height - menu.height - 4));
    flyout.style.top = `${top}px`;
    flyout.style.left = `${Math.min(this.drawingSidebar.offsetWidth + 3, Math.max(4, workspace.width - menu.width - 4))}px`;
    requestAnimationFrame(() => flyout.querySelector<HTMLButtonElement>('.drawing-sidebar-flyout-tool')?.focus());
  }

  private closeDrawingFlyout(restoreFocus = false) {
    const group = this.openDrawingFlyoutGroup;
    if (!group) return;
    const flyout = this.drawingFlyouts.get(group);
    const trigger = this.drawingFlyoutButtons.get(group);
    if (flyout) flyout.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    this.openDrawingFlyoutGroup = undefined;
    if (restoreFocus) trigger?.focus();
  }

  private updateDrawingSnapButton() {
    const mode = this.selection?.drawingMagnet ?? 'weak';
    const label = mode === 'strong' ? 'Strong' : mode === 'off' ? 'Off' : 'Weak';
    const next = mode === 'off' ? 'Weak' : mode === 'weak' ? 'Strong' : 'Off';
    this.drawSnap.dataset.magnet = mode;
    this.drawSnap.setAttribute('aria-label', `Anchor snapping: ${label}`);
    this.drawSnap.setAttribute('aria-pressed', String(mode !== 'off'));
    this.drawSnap.title = `Anchor snapping: ${label} · click for ${next}`;
    this.drawSnap.setAttribute('aria-description', `Click to change anchor snapping to ${next}.`);
  }

  private setDrawingTool(tool: string | null) {
    if (!this.engine) return;
    const group = tool ? DRAWING_GROUP_BY_TOOL.get(tool) : undefined;
    if (group && tool) this.drawingLastToolByGroup.set(group, tool);
    this.closeDrawingFlyout();
    this.engine.drawings.setEraser(false);
    this.drawEraser.setAttribute('aria-pressed', 'false');
    this.engine.drawings.setTool(tool);
    this.syncDrawingActions();
  }

  private enrichPlacedDrawing(placed: Drawing) {
    const draw = this.engine?.drawings;
    const live = draw?.get(placed.id);
    if (!draw || !live || this.dead) return;
    const iqMetadata = live.props?.iqterminal;
    if (iqMetadata && typeof iqMetadata === 'object' && (iqMetadata as Record<string, unknown>).version === IQ_DRAWING_META_VERSION) return;
    const defaultId = this.templateCatalog?.defaults.find(item => item.tool === live.tool)?.templateId;
    const defaults = this.templateCatalog?.templates.find(item => item.id === defaultId);
    const initial = initialDrawingMetadata(live, this.selection.interval);
    const initialProps = initial.props ?? {};
    const patch = defaults ? this.drawingTemplatePatch(live, defaults, this.selection.interval) : initial;
    draw.update(live.id, { ...patch, props: { ...initialProps, ...(patch.props ?? {}) } }, { force: true });
    this.engine?.objects.refresh();
    this.syncDrawingActions();
  }

  private syncDrawingActions() {
    const draw = this.engine?.drawings;
    if (!draw) return;
    this.drawUndo.disabled = !draw.canUndo();
    this.drawRedo.disabled = !draw.canRedo();
    this.drawSettings.disabled = draw.selection().length !== 1;
    const activeTool = draw.activeTool();
    const erasing = draw.erasing();
    this.chart.toggleAttribute('data-drawing-placement', Boolean(activeTool) && !erasing);
    if (activeTool || erasing) this.cancelIndicatorTooltip();
    this.floatingDrawingToolbar?.sync(activeTool, erasing);
    const activeGroup = activeTool ? DRAWING_GROUP_BY_TOOL.get(activeTool) : undefined;
    if (activeGroup && activeTool) this.drawingLastToolByGroup.set(activeGroup, activeTool);
    this.drawSelect.setAttribute('aria-pressed', String(!activeTool && !erasing));
    this.drawEraser.setAttribute('aria-pressed', String(erasing));
    this.drawSnap.setAttribute('data-magnet', this.selection.drawingMagnet);
    for (const group of DRAWING_TOOL_GROUPS) {
      const primary = this.drawingPrimaryButtons.get(group.id);
      const tool = this.drawingLastToolByGroup.get(group.id) ?? group.defaultTool;
      if (primary) {
        const name = drawingToolName(tool);
        if (primary.dataset.drawingTool !== tool) {
          primary.dataset.drawingTool = tool;
          primary.dataset.toolName = name;
          primary.replaceChildren(drawingSidebarIcon(tool));
        }
        primary.setAttribute('aria-label', `Use ${name} tool`);
        primary.title = `Use ${name} · Drag to floating toolbar · Shift+Enter to pin`;
        primary.setAttribute('aria-pressed', String(activeTool === tool));
      }
    }
    for (const [tool, buttons] of this.drawingToolButtons) for (const button of buttons) button.setAttribute('aria-pressed', String(activeTool === tool));
    if (activeTool) {
      const name = drawingToolName(activeTool);
      this.drawPlacementState.textContent = `Place: ${name}`;
      this.drawPlacementState.hidden = false;
    } else if (erasing) {
      this.drawPlacementState.textContent = 'Erase drawings';
      this.drawPlacementState.hidden = false;
    } else {
      this.drawPlacementState.textContent = '';
      this.drawPlacementState.hidden = true;
    }
    this.syncObjectTreeToggle();
  }

  private syncObjectTreeToggle() {
    const open = !this.objectTreeSidebarPreferences.collapsed;
    const label = open ? 'Close Object Tree' : 'Open Object Tree';
    const icon = open ? 'objects-close' : 'objects-open';
    for (const button of [this.objectsToggle, this.objectsCollapse]) {
      button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', String(open));
      if (button.dataset.objectTreeIcon !== icon) {
        button.replaceChildren(drawingSidebarIcon(icon)); button.dataset.objectTreeIcon = icon;
      }
    }
    this.objectsToggle.setAttribute('aria-pressed', String(open));
    this.objectsToggle.setAttribute('aria-description', `${this.objectsToggle.dataset.count ?? '0'} chart objects`);
  }

  private toggleObjectsPanel() {
    this.setObjectTreeCollapsed(!this.objectTreeSidebarPreferences.collapsed);
  }

  attachObjectsPanel() {
    this.renderDrawingObjects();
  }

  private loadObjectTreeSidebarPreferences() {
    const key = objectTreeSidebarStorageKey(this.params.api.id);
    this.objectTreeSidebarWarning = '';
    try {
      const raw = window.localStorage.getItem(key);
      this.objectTreeSidebarPreferences = raw === null
        ? createObjectTreeSidebarPreferences()
        : parseIQObjectTreeSidebarPreferences(raw);
    } catch (error) {
      this.objectTreeSidebarPreferences = createObjectTreeSidebarPreferences();
      this.objectTreeSidebarWarning = `Sidebar settings are session-only (${errorText(error)}).`;
    }
    this.applyObjectTreeSidebarPreferences();
  }

  private applyObjectTreeSidebarPreferences() {
    this.objectsPanel.style.setProperty('--object-tree-width', `${this.objectTreeSidebarPreferences.width}px`);
    this.objectsPanel.dataset.collapsed = String(this.objectTreeSidebarPreferences.collapsed);
    this.syncObjectTreeToggle();
    this.objectsTreeResize.setAttribute('aria-valuemin', String(OBJECT_TREE_MIN_WIDTH));
    this.objectsTreeResize.setAttribute('aria-valuemax', String(OBJECT_TREE_MAX_WIDTH));
    this.objectsTreeResize.setAttribute('aria-valuenow', String(this.objectTreeSidebarPreferences.width));
  }

  private saveObjectTreeSidebarPreferences() {
    try {
      window.localStorage.setItem(objectTreeSidebarStorageKey(this.params.api.id), JSON.stringify(this.objectTreeSidebarPreferences));
      this.objectTreeSidebarWarning = '';
    } catch (error) {
      this.objectTreeSidebarWarning = `Sidebar settings are session-only (${errorText(error)}).`;
    }
    this.updateObjectTreeStatus();
  }

  private setObjectTreeCollapsed(collapsed: boolean) {
    if (this.objectTreeSidebarPreferences.collapsed === collapsed) return;
    const restoreFocus = collapsed && this.objectsPanel.contains(document.activeElement);
    this.objectTreeSidebarPreferences = { ...this.objectTreeSidebarPreferences, collapsed };
    this.applyObjectTreeSidebarPreferences();
    this.saveObjectTreeSidebarPreferences();
    this.syncDrawingActions();
    if (restoreFocus) this.objectsToggle.focus();
  }

  private objectTreeResizeStart(event: PointerEvent) {
    if (event.button !== 0 || this.objectTreeSidebarPreferences.collapsed) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this.objectTreeSidebarPreferences.width;
    const maxAvailable = Math.max(OBJECT_TREE_MIN_WIDTH, Math.min(OBJECT_TREE_MAX_WIDTH, Math.floor(this.chartWorkspace.clientWidth * .55)));
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      const width = Math.max(OBJECT_TREE_MIN_WIDTH, Math.min(maxAvailable, Math.round(startWidth + startX - move.clientX)));
      this.objectTreeSidebarPreferences = { ...this.objectTreeSidebarPreferences, width };
      this.applyObjectTreeSidebarPreferences();
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      this.saveObjectTreeSidebarPreferences();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  private objectTreeResizeKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const amount = event.shiftKey ? 30 : 10;
    const width = this.objectTreeSidebarPreferences.width + (event.key === 'ArrowLeft' ? amount : -amount);
    this.objectTreeSidebarPreferences = createObjectTreeSidebarPreferences(width, this.objectTreeSidebarPreferences.collapsed);
    this.applyObjectTreeSidebarPreferences();
    this.saveObjectTreeSidebarPreferences();
  }

  private loadObjectTreeForSelection() {
    const key = objectTreeStorageKey(this.params.api.id, instrumentKey(this.selection), instrumentOf(this.selection).native);
    if (key === this.objectTreeScope && this.objectTreeRepository) return;
    this.objectTreeScope = key;
    this.objectTreeStorageWarning = '';
    this.renamingFolderId = undefined;
    this.renamingDrawingId = undefined;
    this.collapsedTreeFolders.clear();
    try {
      this.objectTreeRepository = new IQObjectTreeRepository(createLocalStorageObjectTreeStorage(window.localStorage), key);
      this.objectTreeCatalog = this.objectTreeRepository.load();
    } catch (error) {
      this.objectTreeStorageWarning = `Saved object tree is preserved; using session memory (${errorText(error)}).`;
      this.objectTreeRepository = new IQObjectTreeRepository(createMemoryObjectTreeStorage(), key);
      this.objectTreeCatalog = this.objectTreeRepository.load();
    }
    this.renderDrawingObjects();
  }

  private persistObjectTree() {
    if (!this.objectTreeRepository) return;
    this.objectTreeCatalog = this.objectTreeRepository.save(this.objectTreeCatalog);
    this.updateObjectTreeStatus();
  }

  private updateObjectTreeStatus() {
    const writeError = this.objectTreeRepository?.error();
    const messages = [this.objectTreeStorageWarning, writeError ? `Object tree changes are session-only (${errorText(writeError)}).` : '', this.objectTreeSidebarWarning].filter(Boolean);
    this.objectsTreeStatus.textContent = messages.join(' ');
    this.objectsTreeStatus.hidden = messages.length === 0;
    this.objectsPanel.dataset.storage = messages.length ? 'degraded' : 'saved';
  }

  private createFolder(parentId: string | null) {
    const id = `folder-${crypto.randomUUID()}`;
    const next = createObjectTreeFolder(this.objectTreeCatalog, parentId, id, 'New folder');
    if (!next) {
      this.objectsTreeStatus.textContent = `Folders can be nested up to ${OBJECT_TREE_MAX_DEPTH} levels.`;
      this.objectsTreeStatus.hidden = false;
      return;
    }
    this.objectTreeCatalog = next;
    this.collapsedTreeFolders.delete(parentId ?? '');
    this.renamingFolderId = id;
    this.persistObjectTree();
    this.renderDrawingObjects();
    const input = [...this.objectsTree.querySelectorAll<HTMLInputElement>('.chart-object-folder-name-input')].find(candidate => candidate.dataset.treeId === id);
    input?.focus(); input?.select();
  }

  private duplicateDrawings(ids: readonly string[]) {
    const draw = this.engine?.drawings;
    if (!draw) return [];
    const copies = draw.duplicate(ids);
    this.engine?.objects.refresh();
    this.syncDrawingActions();
    return copies;
  }

  private objectPaneSection(paneIndex: number, primaryPaneIndex: number) {
    let entry = this.objectPaneSections.get(paneIndex);
    if (!entry) {
      const section = document.createElement('section'); section.className = 'chart-object-pane';
      section.dataset.objectPaneIndex = String(paneIndex);
      const heading = document.createElement('div'); heading.className = 'chart-object-pane-heading';
      const rows = document.createElement('div'); rows.className = 'chart-object-pane-rows';
      section.append(heading, rows);
      entry = { section, heading, rows };
      this.objectPaneSections.set(paneIndex, entry);
    }
    const resolved = entry!;
    const label = paneIndex === primaryPaneIndex ? `Main pane · Pane ${paneIndex + 1}` : `Pane ${paneIndex + 1}`;
    if (resolved.heading.textContent !== label) resolved.heading.textContent = label;
    return resolved;
  }

  private renderDrawingObjects() {
    const listed = this.engine?.objects.list() ?? [];
    const coreIds = new Set([TRADE_BUBBLES_ID, FOOTPRINT_ID, FOOTPRINT_TOTALS_ID, HEATMAP_ID, ORDER_WALLS_ID, TPO_ID]);
    const scriptIds = new Set((this.studyHost?.views() ?? []).map(view => view.attachmentId));
    const objects = listed.filter(object => {
      if (object.kind !== 'indicator') return true;
      const identity = `${object.id} ${object.sourceId}`;
      if (object.id.startsWith('custom:iqterminal-') || object.id.startsWith('custom:script-study-')) return true;
      for (const instance of this.selection.indicators) {
        if (coreIds.has(instance.definitionId) && (identity.includes(instance.instanceId) || identity.includes(instance.definitionId))) return false;
        if (scriptIds.has(instance.instanceId) && identity.includes(instance.instanceId)) return false;
      }
      return true;
    });
    this.objectsToggle.dataset.count = String(objects.length);
    this.syncObjectTreeToggle();
    this.updateObjectsSummary();
    this.objectsPanel.dataset.focused = String(this.params?.api.isFocused ?? false);
    const activeIds = new Set(objects.map(object => object.id));
    for (const [id, row] of this.objectRows) {
      if (activeIds.has(id)) continue;
      row.remove();
      this.objectRows.delete(id);
    }

    const drawings = objects.filter(object => object.kind === 'drawing');
    const inventory = objects.filter(object => object.kind !== 'drawing');
    const reconciled = reconcileObjectTree(this.objectTreeCatalog, drawings.map(object => object.sourceId));
    if (reconciled.changed) {
      this.objectTreeCatalog = reconciled.catalog;
      this.persistObjectTree();
    }
    this.renderObjectTree(drawings);
    this.renderObjectInventory(inventory);
    this.updateObjectTreeStatus();
  }

  private renderObjectInventory(objects: readonly ChartObjectSnapshot[]) {
    this.objectsInventory.hidden = objects.length === 0;
    if (!objects.length) {
      for (const entry of this.objectPaneSections.values()) entry.section.remove();
      this.objectPaneSections.clear();
      return;
    }
    const grouped = new Map<number, ChartObjectSnapshot[]>();
    for (const object of objects) {
      const paneIndex = Number.isInteger(object.paneIndex) && object.paneIndex >= 0 ? object.paneIndex : 0;
      const group = grouped.get(paneIndex) ?? [];
      group.push(object);
      grouped.set(paneIndex, group);
    }
    const paneIndexes = [...grouped.keys()].sort((a, b) => a - b);
    const activePanes = new Set(paneIndexes);
    for (const [paneIndex, entry] of this.objectPaneSections) {
      if (activePanes.has(paneIndex)) continue;
      entry.section.remove();
      this.objectPaneSections.delete(paneIndex);
    }
    const primaryPaneIndex = this.engine?.objects.primaryPaneIndex() ?? 0;
    paneIndexes.forEach((paneIndex, paneOrder) => {
      const section = this.objectPaneSection(paneIndex, primaryPaneIndex);
      const currentSection = this.objectsInventoryRows.children.item(paneOrder);
      if (currentSection !== section.section) this.objectsInventoryRows.insertBefore(section.section, currentSection);
      grouped.get(paneIndex)!.forEach((object, rowOrder) => {
        const row = this.updateObjectRow(object);
        row.dataset.objectPaneIndex = String(paneIndex);
        const currentRow = section.rows.children.item(rowOrder);
        if (currentRow !== row) section.rows.insertBefore(row, currentRow);
      });
    });
  }

  private renderObjectTree(drawings: readonly ChartObjectSnapshot[]) {
    const byDrawingId = new Map(drawings.map(object => [object.sourceId, object]));
    const desired = this.objectTreeCatalog.entries.map(entry => this.renderObjectTreeNode(entry, byDrawingId, 1)).filter((node): node is HTMLDivElement => Boolean(node));
    reconcileElementChildren(this.objectsTree, desired);
    const activeKeys = new Set<string>();
    const collectKeys = (entries: readonly ObjectTreeEntry[]) => entries.forEach(entry => {
      activeKeys.add(entry.type === 'folder' ? `folder:${entry.id}` : `drawing:${entry.drawingId}`);
      if (entry.type === 'folder') collectKeys(entry.children);
    });
    collectKeys(this.objectTreeCatalog.entries);
    for (const key of this.treeNodes.keys()) if (!activeKeys.has(key)) { this.treeNodes.delete(key); this.treeRows.delete(key); }
    const activeFolders = new Set(objectTreeFolderPaths(this.objectTreeCatalog.entries).map(folder => folder.id));
    for (const id of this.collapsedTreeFolders) if (!activeFolders.has(id)) this.collapsedTreeFolders.delete(id);
    this.emptyObjectsMessage.hidden = desired.length > 0;
    if (!this.objectTreeFocusedKey || !this.objectTreeNode(this.objectTreeFocusedKey)) {
      this.objectTreeFocusedKey = this.firstVisibleObjectTreeKey() ?? '';
    }
    for (const node of this.objectsTree.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      node.tabIndex = node.dataset.treeKey === this.objectTreeFocusedKey ? 0 : -1;
    }
  }

  private renderObjectTreeNode(entry: ObjectTreeEntry, drawings: ReadonlyMap<string, ChartObjectSnapshot>, level: number): HTMLDivElement | undefined {
    const key = entry.type === 'folder' ? `folder:${entry.id}` : `drawing:${entry.drawingId}`;
    let node = this.treeNodes.get(key);
    if (!node) {
      node = document.createElement('div');
      node.className = 'chart-object-tree-node';
      node.dataset.treeKey = key;
      node.tabIndex = -1;
      node.setAttribute('role', 'treeitem');
      if (entry.type === 'folder') {
        const row = document.createElement('div'); row.className = 'chart-object-folder-row';
        const expand = this.objectTreeControl('Expand folder', 'expand', 'chart-object-folder-expand');
        expand.dataset.treeAction = 'expand';
        const visible = this.objectTreeControl('Show all drawings in folder', 'eye', 'chart-object-folder-visibility');
        visible.dataset.treeAction = 'folder-visibility';
        const name = document.createElement('button'); name.type = 'button'; name.className = 'chart-object-folder-name';
        name.dataset.treeAction = 'toggle-folder';
        const more = this.objectTreeControl('Folder actions', 'more', 'chart-object-tree-more');
        more.dataset.treeAction = 'menu';
        row.append(expand, visible, name, more);
        const children = document.createElement('div'); children.className = 'chart-object-children'; children.setAttribute('role', 'group');
        node.append(row, children);
        this.treeRows.set(key, row);
      } else {
        const object = drawings.get(entry.drawingId);
        if (!object) return undefined;
        const row = this.updateObjectRow(object);
        row.dataset.treeRow = 'true';
        node.append(row);
        this.treeRows.set(key, row);
      }
      this.treeNodes.set(key, node);
    }
    node.dataset.treeKind = entry.type;
    node.dataset.treeId = entry.type === 'folder' ? entry.id : entry.drawingId;
    node.draggable = true;
    node.setAttribute('aria-level', String(level));
    node.dataset.treeKey = key;
    if (entry.type === 'drawing') {
      const object = drawings.get(entry.drawingId);
      if (!object) return undefined;
      const row = this.updateObjectRow(object);
      if (node.firstElementChild !== row) node.replaceChildren(row);
      row.dataset.treeRow = 'true';
      row.dataset.objectPaneIndex = String(object.paneIndex);
      const name = row.querySelector<HTMLButtonElement>('.chart-object-name');
      let renameInput = row.querySelector<HTMLInputElement>('.chart-object-drawing-name-input');
      if (this.renamingDrawingId === entry.drawingId) {
        if (!renameInput) {
          renameInput = this.makeTreeRenameInput('drawing', entry.drawingId);
          name?.replaceWith(renameInput);
        }
        if (document.activeElement !== renameInput) renameInput.value = entry.name ?? name?.textContent ?? '';
      } else {
        if (renameInput && name) renameInput.replaceWith(name);
        if (name && entry.name !== undefined) name.textContent = entry.name;
        if (name && entry.name === undefined) {
          const drawing = this.engine?.drawings.get(object.sourceId);
          name.textContent = drawing ? drawingDisplayName(drawing, object.name) : object.name;
        }
      }
      node.removeAttribute('aria-expanded');
      return node;
    }

    const row = this.treeRows.get(key)!;
    const expand = row.querySelector<HTMLButtonElement>('[data-tree-action="expand"]')!;
    const visible = row.querySelector<HTMLButtonElement>('[data-tree-action="folder-visibility"]')!;
    let name = row.querySelector<HTMLButtonElement>('.chart-object-folder-name');
    const more = row.querySelector<HTMLButtonElement>('[data-tree-action="menu"]')!;
    const children = node.querySelector<HTMLDivElement>('.chart-object-children')!;
    const collapsed = this.collapsedTreeFolders.has(entry.id);
    const state = this.folderVisibilityState(entry.id);
    expand.replaceChildren(drawingSidebarIcon(collapsed ? 'expand' : 'chevron'));
    expand.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${entry.name}`);
    expand.setAttribute('aria-expanded', String(!collapsed));
    visible.dataset.visibilityState = state;
    visible.setAttribute('aria-pressed', String(state === 'all'));
    visible.replaceChildren(drawingSidebarIcon(state === 'none' ? 'hiddenEye' : 'eye'));
    visible.setAttribute('aria-label', state === 'all' ? `Hide all drawings in ${entry.name}` : `Show all drawings in ${entry.name}`);
    visible.title = state === 'all' ? 'Hide all drawings in folder' : state === 'mixed' ? 'Show all drawings in folder' : 'Show all drawings in folder';
    let renameInput = row.querySelector<HTMLInputElement>('.chart-object-folder-name-input');
    if (this.renamingFolderId === entry.id) {
      if (!renameInput) {
        if (!name) {
          name = document.createElement('button'); name.type = 'button'; name.className = 'chart-object-folder-name'; name.dataset.treeAction = 'toggle-folder';
          more.before(name);
        }
        renameInput = this.makeTreeRenameInput('folder', entry.id);
        name.replaceWith(renameInput);
      }
      if (document.activeElement !== renameInput) renameInput.value = entry.name;
    } else {
      if (renameInput) {
        name = document.createElement('button'); name.type = 'button'; name.className = 'chart-object-folder-name'; name.dataset.treeAction = 'toggle-folder';
        renameInput.replaceWith(name);
      }
      if (!name) {
        name = document.createElement('button'); name.type = 'button'; name.className = 'chart-object-folder-name'; name.dataset.treeAction = 'toggle-folder';
        more.before(name);
      }
      name.title = `${entry.name} · ${objectTreeFolderDrawingIds(this.objectTreeCatalog.entries, entry.id).length} drawings`;
      name.textContent = entry.name;
    }
    more.dataset.treeId = entry.id;
    children.hidden = collapsed;
    node.setAttribute('aria-expanded', String(!collapsed));
    const nested = entry.children.map(child => this.renderObjectTreeNode(child, drawings, level + 1)).filter((child): child is HTMLDivElement => Boolean(child));
    reconcileElementChildren(children, nested);
    return node;
  }

  private objectTreeControl(label: string, icon: string, className: string) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.title = label; button.setAttribute('aria-label', label);
    button.append(drawingSidebarIcon(icon));
    return button;
  }

  private folderVisibilityState(folderId: string): 'all' | 'none' | 'mixed' {
    return objectTreeFolderVisibilityState(this.objectTreeCatalog.entries, folderId, id => {
      const drawing = this.engine?.drawings.get(id);
      return drawing ? drawing.visible !== false : undefined;
    });
  }

  private firstVisibleObjectTreeKey() {
    const visible = [...this.objectsTree.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find(node => !node.closest('[hidden]'));
    return visible?.dataset.treeKey;
  }

  private renderTreeAfterChange() {
    this.renderDrawingObjects();
    const focused = this.objectTreeNode(this.objectTreeFocusedKey);
    if (focused) focused.focus();
  }

  private objectTreeNode(key: string) {
    return this.treeNodes.get(key);
  }

  private makeTreeRenameInput(kind: 'folder' | 'drawing', id: string) {
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 48;
    input.className = kind === 'folder' ? 'chart-object-folder-name-input' : 'chart-object-drawing-name-input';
    input.dataset.treeEdit = kind; input.dataset.treeId = id;
    input.setAttribute('aria-label', kind === 'folder' ? 'Folder name' : 'Drawing name');
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); this.commitTreeRename(kind, id, input.value); }
      else if (event.key === 'Escape') { event.preventDefault(); this.cancelTreeRename(kind, id); }
    });
    input.addEventListener('blur', () => this.commitTreeRename(kind, id, input.value));
    return input;
  }

  private beginTreeRename(kind: 'folder' | 'drawing', id: string) {
    if (kind === 'folder') this.renamingFolderId = id;
    else this.renamingDrawingId = id;
    this.renderDrawingObjects();
    const selector = kind === 'folder' ? '.chart-object-folder-name-input' : '.chart-object-drawing-name-input';
    const input = [...this.objectsTree.querySelectorAll<HTMLInputElement>(selector)].find(candidate => candidate.dataset.treeId === id);
    input?.focus(); input?.select();
  }

  private commitTreeRename(kind: 'folder' | 'drawing', id: string, rawName: string) {
    const editing = kind === 'folder' ? this.renamingFolderId === id : this.renamingDrawingId === id;
    if (!editing) return;
    const name = rawName.trim();
    if (!name || name.length > 48) {
      this.cancelTreeRename(kind, id);
      this.objectsTreeStatus.textContent = 'Names must be 1–48 characters.';
      this.objectsTreeStatus.hidden = false;
      return;
    }
    const next = kind === 'folder'
      ? renameObjectTreeFolder(this.objectTreeCatalog, id, name)
      : renameObjectTreeDrawing(this.objectTreeCatalog, id, name);
    if (kind === 'folder') this.renamingFolderId = undefined;
    else this.renamingDrawingId = undefined;
    if (next) { this.objectTreeCatalog = next; this.persistObjectTree(); }
    this.renderDrawingObjects();
  }

  private cancelTreeRename(kind: 'folder' | 'drawing', id: string) {
    if (kind === 'folder' && this.renamingFolderId === id) this.renamingFolderId = undefined;
    if (kind === 'drawing' && this.renamingDrawingId === id) this.renamingDrawingId = undefined;
    this.renderDrawingObjects();
  }

  private objectTreeClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tree-action]');
    if (!button) return;
    const action = button.dataset.treeAction;
    const id = button.dataset.treeId ?? button.closest<HTMLElement>('[data-tree-kind]')?.dataset.treeId ?? '';
    if (action === 'new-folder') this.createFolder(null);
    else if ((action === 'expand' || action === 'toggle-folder') && id) {
      this.collapsedTreeFolders.has(id) ? this.collapsedTreeFolders.delete(id) : this.collapsedTreeFolders.add(id);
      this.objectTreeFocusedKey = `folder:${id}`;
      this.renderDrawingObjects();
      this.objectTreeNode(this.objectTreeFocusedKey)?.focus();
    } else if (action === 'folder-visibility' && id) {
      this.setFolderVisibility(id, this.folderVisibilityState(id) !== 'all');
    } else if (action === 'menu' && id) {
      this.openObjectTreeMenu('folder', id, (event as MouseEvent).clientX, (event as MouseEvent).clientY);
    }
  }

  private setFolderVisibility(folderId: string, visible: boolean) {
    if (!this.engine) return;
    const changed = applyObjectTreeFolderVisibility(
      this.objectTreeCatalog.entries,
      folderId,
      visible,
      id => this.engine?.drawings.get(id),
      patches => this.engine?.drawings.updateMany(patches),
    );
    if (!changed) return;
    this.engine.objects.refresh();
    this.syncDrawingActions();
  }

  private objectTreeContextMenu(event: MouseEvent) {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-kind]');
    if (!node?.dataset.treeKind || !node.dataset.treeId) return;
    event.preventDefault(); event.stopPropagation();
    this.objectTreeFocusedKey = node.dataset.treeKey ?? '';
    this.openObjectTreeMenu(node.dataset.treeKind as 'folder' | 'drawing', node.dataset.treeId, event.clientX, event.clientY);
  }

  private openObjectTreeMenu(kind: 'folder' | 'drawing', id: string, clientX = 0, clientY = 0) {
    this.objectTreeMenuTarget = { kind, id };
    this.objectsTreeMenu.replaceChildren();
    const add = (label: string, action: string, options: { parentId?: string | null; disabled?: boolean } = {}) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
      button.className = 'chart-object-tree-menu-item'; button.textContent = label; button.dataset.menuAction = action;
      if (options.parentId !== undefined) button.dataset.menuParentId = options.parentId ?? '';
      button.disabled = Boolean(options.disabled);
      this.objectsTreeMenu.append(button);
      return button;
    };
    const targetEntry = findObjectTreeEntry(this.objectTreeCatalog.entries, kind, id);
    if (!targetEntry) return;
    if (kind === 'drawing') {
      const object = this.engine?.objects.list().find(item => item.kind === 'drawing' && item.sourceId === id);
      if (!object) return;
      add('Select', 'select');
      if (object.capabilities.visibility) add(object.visible ? 'Hide' : 'Show', 'visible');
      if (object.capabilities.lock) add(object.locked ? 'Unlock' : 'Lock', 'lock');
      add('Rename', 'rename');
      if ((targetEntry as Extract<ObjectTreeEntry, { type: 'drawing' }>).name !== undefined) add('Use drawing tool name', 'reset-name');
      if (object.kind === 'drawing' || object.capabilities.settings) add('Settings', 'settings');
      add('Duplicate', 'duplicate');
      add('Move up', 'move-up'); add('Move down', 'move-down');
      if (object.capabilities.remove) add('Delete', 'remove');
      this.addMoveToFolderMenuItems(add, kind, id);
    } else {
      const folder = targetEntry as Extract<ObjectTreeEntry, { type: 'folder' }>;
      add('Rename', 'rename');
      add('New subfolder', 'new-subfolder', { disabled: (objectTreeFolderDepth(this.objectTreeCatalog.entries, id) ?? OBJECT_TREE_MAX_DEPTH) >= OBJECT_TREE_MAX_DEPTH });
      add('Show all drawings', 'show-folder'); add('Hide all drawings', 'hide-folder');
      add('Move up', 'move-up'); add('Move down', 'move-down');
      add('Delete folder (keep contents)', 'delete-folder');
      this.addMoveToFolderMenuItems(add, kind, id);
      if (!folder.children.length) add('Folder is empty', 'noop', { disabled: true });
    }
    const rect = this.objectsPanel.getBoundingClientRect();
    const width = 244, height = Math.min(this.objectsTreeMenu.childElementCount * 27 + 8, window.innerHeight - 12);
    const x = clientX || rect.left + 10, y = clientY || rect.top + 34;
    this.objectsTreeMenu.style.left = `${Math.max(4, Math.min(window.innerWidth - width - 4, x))}px`;
    this.objectsTreeMenu.style.top = `${Math.max(4, Math.min(window.innerHeight - height - 4, y))}px`;
    if (this.objectsTreeMenu.parentElement !== document.body) document.body.append(this.objectsTreeMenu);
    this.objectsTreeMenu.hidden = false;
    requestAnimationFrame(() => this.objectsTreeMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }

  private addMoveToFolderMenuItems(
    add: (label: string, action: string, options?: { parentId?: string | null; disabled?: boolean }) => HTMLButtonElement,
    kind: 'folder' | 'drawing', id: string,
  ) {
    add('Move to Folder · Root', 'move', { parentId: null });
    const forbidden = kind === 'folder'
      ? new Set([id, ...objectTreeFolderPaths([findObjectTreeEntry(this.objectTreeCatalog.entries, 'folder', id)!]).map(folder => folder.id)])
      : new Set<string>();
    for (const folder of objectTreeFolderPaths(this.objectTreeCatalog.entries)) {
      if (forbidden.has(folder.id)) continue;
      add(`Move to Folder · ${folder.path}`, 'move', { parentId: folder.id });
    }
  }

  private objectTreeMenuClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu-action]');
    const target = this.objectTreeMenuTarget;
    if (!button || !target || button.disabled) return;
    const action = button.dataset.menuAction;
    const folderTarget = button.dataset.menuParentId || null;
    if (action === 'rename') this.beginTreeRename(target.kind, target.id);
    else if (action === 'new-subfolder') this.createFolder(target.id);
    else if (action === 'show-folder') this.setFolderVisibility(target.id, true);
    else if (action === 'hide-folder') this.setFolderVisibility(target.id, false);
    else if (action === 'delete-folder') {
      const next = deleteObjectTreeFolder(this.objectTreeCatalog, target.id);
      if (next) { this.objectTreeCatalog = next; this.collapsedTreeFolders.delete(target.id); this.persistObjectTree(); this.renderDrawingObjects(); }
    } else if (action === 'move' || action === 'move-up' || action === 'move-down') {
      const next = action === 'move'
        ? moveObjectTreeEntry(this.objectTreeCatalog, target.kind, target.id, folderTarget, folderTarget ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER)
        : reorderObjectTreeEntry(this.objectTreeCatalog, target.kind, target.id, action === 'move-up' ? -1 : 1);
      if (next) { this.objectTreeCatalog = next; this.persistObjectTree(); this.renderDrawingObjects(); }
    } else if (target.kind === 'drawing') {
      const object = this.engine?.objects.list().find(item => item.kind === 'drawing' && item.sourceId === target.id);
      if (action === 'reset-name') {
        const next = clearObjectTreeDrawingName(this.objectTreeCatalog, target.id);
        if (next) { this.objectTreeCatalog = next; this.persistObjectTree(); this.renderDrawingObjects(); }
      } else if (object && action === 'select') {
        this.engine?.objects.select(object.id); this.engine?.objects.focus(object.id); this.params.api.setActive(); this.syncDrawingActions();
      } else if (object && action) this.applyNativeObjectAction(object, action);
      if (action === 'remove') this.objectTreeFocusedKey = '';
    }
    this.objectsTreeMenu.hidden = true;
    if (action !== 'rename' && action !== 'new-subfolder') this.objectTreeNode(this.objectTreeFocusedKey)?.focus();
  }

  private objectTreeMenuKeydown(event: KeyboardEvent) {
    const items = [...this.objectsTreeMenu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault(); this.objectsTreeMenu.hidden = true;
      this.objectTreeNode(this.objectTreeFocusedKey)?.focus(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  }

  private objectTreeKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.matches('input,textarea,select,[contenteditable="true"]')) return;
    const node = target.closest<HTMLElement>('[role="treeitem"]');
    if (!node) return;
    const key = node.dataset.treeKey ?? '';
    const kind = node.dataset.treeKind as 'folder' | 'drawing' | undefined;
    const id = node.dataset.treeId ?? '';
    const visibleNodes = [...this.objectsTree.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(item => !item.closest('[hidden]'));
    const current = visibleNodes.indexOf(node);
    const focus = (candidate: HTMLElement | undefined) => {
      if (!candidate) return;
      this.objectTreeFocusedKey = candidate.dataset.treeKey ?? '';
      visibleNodes.forEach(item => { item.tabIndex = item === candidate ? 0 : -1; });
      candidate.focus();
      event.preventDefault();
    };
    if (event.key === 'ArrowDown') focus(visibleNodes[current + 1]);
    else if (event.key === 'ArrowUp') focus(visibleNodes[current - 1]);
    else if (event.key === 'Home') focus(visibleNodes[0]);
    else if (event.key === 'End') focus(visibleNodes.at(-1));
    else if (event.key === 'ArrowRight' && kind === 'folder') {
      if (this.collapsedTreeFolders.has(id)) {
        this.collapsedTreeFolders.delete(id); this.renderDrawingObjects(); focus(this.objectTreeNode(key));
      } else focus(node.querySelector<HTMLElement>(':scope > .chart-object-children > [role="treeitem"]') ?? undefined);
    } else if (event.key === 'ArrowLeft') {
      if (kind === 'folder' && !this.collapsedTreeFolders.has(id)) {
        this.collapsedTreeFolders.add(id); this.renderDrawingObjects(); focus(this.objectTreeNode(key));
      } else focus(node.parentElement?.closest<HTMLElement>('[data-tree-kind="folder"]') ?? undefined);
    } else if ((event.key === 'Enter' || event.key === ' ') && kind === 'folder') {
      this.collapsedTreeFolders.has(id) ? this.collapsedTreeFolders.delete(id) : this.collapsedTreeFolders.add(id);
      this.renderDrawingObjects(); focus(this.objectTreeNode(key));
    } else if (event.key === 'Enter' && kind === 'drawing') {
      const object = this.engine?.objects.list().find(item => item.kind === 'drawing' && item.sourceId === id);
      if (object) { this.engine?.objects.select(object.id); this.engine?.objects.focus(object.id); this.params.api.setActive(); this.syncDrawingActions(); }
      event.preventDefault();
    } else if (event.key === ' ' && kind === 'drawing') {
      const object = this.engine?.objects.list().find(item => item.kind === 'drawing' && item.sourceId === id);
      if (object) this.applyNativeObjectAction(object, 'visible');
      event.preventDefault();
    } else if (event.key === 'F2' && kind) {
      this.beginTreeRename(kind, id); event.preventDefault();
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && kind) {
      this.objectTreeFocusedKey = key; this.openObjectTreeMenu(kind, id); event.preventDefault();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && kind === 'drawing') {
      const object = this.engine?.objects.list().find(item => item.kind === 'drawing' && item.sourceId === id);
      if (object?.capabilities.remove) this.applyNativeObjectAction(object, 'remove');
      event.preventDefault();
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && kind) {
      const next = reorderObjectTreeEntry(this.objectTreeCatalog, kind, id, event.key === 'ArrowUp' ? -1 : 1);
      if (next) { this.objectTreeCatalog = next; this.persistObjectTree(); this.renderDrawingObjects(); focus(this.objectTreeNode(key)); }
      event.preventDefault();
    } else if (event.altKey && event.key === 'ArrowLeft' && kind === 'drawing') {
      const next = moveObjectTreeEntry(this.objectTreeCatalog, 'drawing', id, null, Number.MAX_SAFE_INTEGER);
      if (next) { this.objectTreeCatalog = next; this.persistObjectTree(); this.renderDrawingObjects(); focus(this.objectTreeNode(key)); }
      event.preventDefault();
    }
  }

  private objectTreeDragStart(event: DragEvent) {
    if ((event.target as HTMLElement).closest('.chart-object-action,.chart-object-folder-expand,.chart-object-folder-visibility,.chart-object-tree-more,input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); return; }
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-kind]');
    if (!node?.dataset.treeKind || !node.dataset.treeId || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: node.dataset.treeKind, id: node.dataset.treeId }));
    this.objectTreeFocusedKey = node.dataset.treeKey ?? '';
    node.classList.add('is-drag-source');
    this.objectsPanel.classList.add('is-dragging');
  }

  private objectTreeDragOver(event: DragEvent) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-kind]');
    if (!target && !(event.target as HTMLElement).closest('.chart-object-tree')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    for (const node of this.objectsTree.querySelectorAll<HTMLElement>('[data-drop-position]')) delete node.dataset.dropPosition;
    if (target) {
      const rect = target.dataset.treeKind === 'folder'
        ? target.querySelector<HTMLElement>(':scope > .chart-object-folder-row')?.getBoundingClientRect() ?? target.getBoundingClientRect()
        : target.getBoundingClientRect();
      target.dataset.dropPosition = target.dataset.treeKind === 'folder' && event.clientY > rect.top + rect.height * .25 && event.clientY < rect.bottom - rect.height * .25
        ? 'inside' : event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
    }
  }

  private objectTreeDrop(event: DragEvent) {
    if (!event.dataTransfer) return;
    let source: { kind: 'folder' | 'drawing'; id: string };
    try { source = JSON.parse(event.dataTransfer.getData('text/plain')) as { kind: 'folder' | 'drawing'; id: string }; }
    catch { return; }
    if ((source.kind !== 'folder' && source.kind !== 'drawing') || typeof source.id !== 'string') return;
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-kind]');
    let parentId: string | null = null, index = Number.MAX_SAFE_INTEGER;
    if (target?.dataset.treeKind && target.dataset.treeId) {
      const targetKind = target.dataset.treeKind as 'folder' | 'drawing';
      const targetLocation = locateObjectTreeEntry(this.objectTreeCatalog.entries, targetKind, target.dataset.treeId);
      const rect = targetKind === 'folder'
        ? target.querySelector<HTMLElement>(':scope > .chart-object-folder-row')?.getBoundingClientRect() ?? target.getBoundingClientRect()
        : target.getBoundingClientRect();
      const intoFolder = targetKind === 'folder' && event.clientY > rect.top + rect.height * .25 && event.clientY < rect.bottom - rect.height * .25;
      if (intoFolder) parentId = target.dataset.treeId;
      else if (targetLocation) {
        parentId = targetLocation.parentId;
        index = targetLocation.index + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0);
      }
    }
    const next = moveObjectTreeEntry(this.objectTreeCatalog, source.kind, source.id, parentId, index);
    if (!next) {
      this.objectsTreeStatus.textContent = `This move would exceed the ${OBJECT_TREE_MAX_DEPTH}-level folder depth or create a cycle.`;
      this.objectsTreeStatus.hidden = false;
      return;
    }
    this.objectTreeCatalog = next;
    this.persistObjectTree();
    this.renderDrawingObjects();
    this.objectsPanel.classList.remove('is-dragging');
    for (const node of this.objectsTree.querySelectorAll<HTMLElement>('[data-drop-position],.is-drag-source')) {
      delete node.dataset.dropPosition;
      node.classList.remove('is-drag-source');
    }
  }

  private updateObjectRow(object: ChartObjectSnapshot) {
    let row = this.objectRows.get(object.id);
    if (!row) {
      row = document.createElement('div');
      this.objectRows.set(object.id, row);
    }
    row.className = `chart-object-row kind-${object.kind}`;
    row.dataset.objectId = object.id;
    let name = row.querySelector<HTMLButtonElement>('.chart-object-name');
    if (!name) {
      name = document.createElement('button');
      name.type = 'button';
      name.className = 'chart-object-name';
      name.addEventListener('click', () => {
        const id = row!.dataset.objectId ?? '';
        this.params.api.setActive();
        this.engine?.objects.select(id);
        this.engine?.objects.focus(id);
        this.syncDrawingActions();
      });
    }
    const drawing = object.kind === 'drawing'
      ? this.engine?.drawings.get(object.sourceId) ?? this.engine?.drawings.get(object.id)
      : undefined;
    const nameText = drawing ? drawingDisplayName(drawing, object.name) : object.name;
    const nameTitle = `${object.kind} · pane ${object.paneIndex + 1}${object.hiddenOnInterval ? ' · hidden on this timeframe' : ''}`;
    if (name.textContent !== nameText) name.textContent = nameText;
    if (name.title !== nameTitle) name.title = nameTitle;
    if (object.hiddenOnInterval) name.dataset.hiddenOnInterval = 'true';
    else delete name.dataset.hiddenOnInterval;

    const actions: Array<{ label: string; action: string; title: string }> = [];
    if (object.capabilities.visibility) actions.push({ label: object.visible ? 'Hide' : 'Show', action: 'visible', title: object.visible ? 'Hide object' : 'Show object' });
    if (object.capabilities.lock) actions.push({ label: object.locked ? 'Unlock' : 'Lock', action: 'lock', title: object.locked ? 'Unlock object' : 'Lock object' });
    if (object.kind === 'drawing') actions.push({ label: 'Duplicate', action: 'duplicate', title: 'Duplicate drawing' });
    if (object.kind === 'drawing' || object.capabilities.settings) actions.push({ label: 'Style', action: 'settings', title: 'Open object settings' });
    if (object.capabilities.remove) actions.push({ label: '×', action: 'remove', title: 'Remove object' });
    if (object.kind === 'drawing') actions.push({ label: '', action: 'more', title: 'More drawing actions' });
    const actionButtons = actions.map(({ label, action, title }) => {
      let button = [...row!.querySelectorAll<HTMLButtonElement>('button[data-object-action]')].find(candidate => candidate.dataset.objectAction === action);
      if (!button) button = this.objectActionButton(label, action, object.id, title);
      if (button.textContent !== label) button.textContent = label;
      if (button.title !== title) button.title = title;
      if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
      button.dataset.objectId = object.id;
      return button;
    });
    const actionSet = new Set(actions.map(action => action.action));
    for (const button of row.querySelectorAll<HTMLButtonElement>('button[data-object-action]')) {
      if (!actionSet.has(button.dataset.objectAction ?? '')) button.remove();
    }
    const children = [name, ...actionButtons];
    if (children.some((child, index) => row!.children.item(index) !== child) || row.childElementCount !== children.length) row.replaceChildren(...children);
    return row;
  }

  private updateObjectsSummary() {
    const instrument = instrumentOf(this.selection).native;
    const focus = this.params?.api.isActive ? ' · active' : '';
    this.objectsSummary.textContent = `Objects · ${instrument} · ${this.selection.interval} · ${this.params?.api.id ?? 'chart'}${focus}`;
    this.objectsPanel.dataset.focused = String(this.params?.api.isFocused ?? false);
  }

  private objectActionButton(label: string, action: string, id: string, title: string) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-object-action';
    if (action === 'more') button.append(drawingSidebarIcon('more'));
    else button.textContent = label;
    button.title = title; button.setAttribute('aria-label', title); button.dataset.objectAction = action; button.dataset.objectId = id;
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (action === 'more') this.openObjectTreeMenu('drawing', this.engine?.objects.get(id)?.sourceId ?? id, (event as MouseEvent).clientX, (event as MouseEvent).clientY);
      else this.drawingObjectAction(event);
    });
    return button;
  }

  private drawingObjectAction(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-object-action]');
    if (!button || !this.engine) return;
    const id = button.dataset.objectId ?? '';
    const object = this.engine.objects.get(id);
    if (!object) return;
    this.applyNativeObjectAction(object, button.dataset.objectAction ?? '');
  }

  private applyNativeObjectAction(object: ChartObjectSnapshot, action: string) {
    if (!this.engine) return;
    const id = object.id;
    switch (action) {
      case 'visible': {
        if (object.kind === 'drawing') {
          const drawing = this.engine.drawings.get(object.sourceId);
          if (drawing) this.engine.drawings.update(drawing.id, { visible: drawing.visible === false });
        } else this.engine.objects.setVisible(id, !object.visible);
        break;
      }
      case 'lock': this.engine.objects.setLocked(id, !object.locked); break;
      case 'duplicate': if (object.kind === 'drawing') this.duplicateDrawings([object.sourceId]); break;
      case 'remove': this.engine.objects.remove(id); break;
      case 'settings':
        if (object.kind === 'drawing') this.openDrawingSettings(this.engine.drawings.get(object.sourceId)?.id ?? object.id);
        else this.engine.objects.openSettings(id);
        break;
    }
    this.engine.objects.refresh(); this.syncDrawingActions();
  }

  private openDrawingSettings(id?: string) {
    const draw = this.engine?.drawings;
    const drawing = id ? draw?.get(id) : draw?.get(draw.selected() ?? '');
    if (!drawing) return;
    this.drawingTarget = drawing.id;
    this.drawingSchema = iqDrawingSettingsSchema(drawing.tool);
    this.drawingFields.replaceChildren();
    const theme = this.engine?.chart.theme();
    const values = captureDrawingSettings(drawing, this.drawingSchema, theme);
    this.drawingSettingsBaseline = { ...values };
    for (const field of this.drawingSchema.fields) {
      const row = document.createElement('label'); row.className = 'indicator-setting-field';
      const label = document.createElement('span'); label.textContent = field.label;
      const control = this.drawingSettingControl(field, values[field.path]);
      control.dataset.settingPath = field.path;
      if (field.path === 'text.color') {
        const markExplicit = () => { control.dataset.userEdited = 'true'; };
        control.addEventListener('input', markExplicit);
        control.addEventListener('change', markExplicit);
      }
      row.append(label, control); this.drawingFields.append(row);
    }
    const title = this.drawingDialog.querySelector('.drawing-settings-title');
    if (title) title.textContent = `${drawing.tool} settings`;
    this.drawingStatus.textContent = 'Settings apply to this drawing and are one undo step.';
    if (!this.drawingDialog.open) this.drawingDialog.showModal();
  }

  private drawingSettingControl(field: SettingsField, value: unknown): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    if (field.kind === 'boolean') { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = value === true; return input; }
    if (field.kind === 'interval' || field.kind === 'select' || field.kind === 'lineStyle') {
      const select = document.createElement('select');
      if (field.kind === 'interval') {
        select.add(new Option('Any interval', ''));
        for (const interval of intervals) select.add(new Option(interval, interval));
      } else {
        for (const option of field.options ?? []) select.add(new Option(option.label, option.value));
        if (!field.options?.length && field.kind === 'lineStyle') for (const [id, label] of [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]) select.add(new Option(label, id));
      }
      select.value = typeof value === 'string' ? value : String(field.defaultValue ?? ''); return select;
    }
    if (field.kind === 'levels') {
      const textarea = document.createElement('textarea'); textarea.rows = 5; textarea.value = JSON.stringify(value ?? [], null, 2); return textarea;
    }
    if (field.kind === 'text' && field.path === 'text.value') {
      const textarea = document.createElement('textarea'); textarea.rows = 3; textarea.value = value === undefined || value === null ? String(field.defaultValue ?? '') : String(value); return textarea;
    }
    const input = document.createElement('input');
    if (field.kind === 'color' && typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) input.type = 'color';
    else if (field.kind === 'number' || field.kind === 'opacity') { input.type = 'number'; input.min = String(field.min ?? (field.kind === 'opacity' ? 0 : -1_000_000)); input.max = String(field.max ?? (field.kind === 'opacity' ? 1 : 1_000_000)); input.step = String(field.step ?? 'any'); }
    else input.type = 'text';
    input.value = value === undefined || value === null ? String(field.defaultValue ?? '') : String(value);
    return input;
  }

  private applyDrawingSettingsFromDialog() {
    const draw = this.engine?.drawings; const drawing = draw?.get(this.drawingTarget); const schema = this.drawingSchema;
    if (!draw || !drawing || !schema) { this.drawingDialog.close(); return; }
    const values: Record<string, unknown> = {};
    for (const control of this.drawingFields.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-setting-path]')) {
      const field = schema.fields.find(item => item.path === control.dataset.settingPath);
      if (!field) continue;
      let value: unknown;
      if (field.kind === 'boolean') value = (control as HTMLInputElement).checked;
      else if (field.kind === 'levels') {
        try { value = JSON.parse(control.value); } catch { this.drawingStatus.textContent = `${field.label} must be valid JSON.`; control.focus(); return; }
      } else value = control.value;
      const comparable = coerceSettingValue(field, value);
      if (!sameDrawingSetting(comparable, this.drawingSettingsBaseline[field.path])) values[field.path] = value;
    }
    // The native interval patch replaces both bounds, so carry the untouched
    // bound through when either endpoint changes.
    if ('intervals.from' in values || 'intervals.to' in values) {
      for (const path of ['intervals.from', 'intervals.to']) {
        const control = this.drawingFields.querySelector<HTMLSelectElement>(`[data-setting-path="${path}"]`);
        if (control) values[path] = control.value;
      }
    }
    const textColorControl = this.drawingFields.querySelector<HTMLElement>('[data-setting-path="text.color"]');
    const textColorEdited = textColorControl?.dataset.userEdited === 'true';
    if (textColorEdited && drawing.props?.iqterminalLabelTextColorExplicit !== true && !('text.color' in values)) {
      const control = textColorControl as HTMLInputElement | null;
      if (control) values['text.color'] = control.value;
    }
    const markTextColorExplicit = textColorEdited && drawing.props?.iqterminalLabelTextColorExplicit !== true;
    if (!Object.keys(values).length && !markTextColorExplicit) {
      this.drawingDialog.close();
      return;
    }
    const patch = drawingSettingsPatch(drawing, values, schema, { textColorExplicit: markTextColorExplicit ? true : undefined });
    if (draw.update(drawing.id, patch)) {
      this.engine?.objects.refresh(); this.drawingDialog.close(); this.syncDrawingActions();
    } else this.drawingStatus.textContent = 'This drawing cannot be edited in its current state.';
  }

  private openDrawingTemplates() {
    const draw = this.engine?.drawings;
    const selected = draw?.get(draw.selected() ?? '');
    this.templatesIncludeLabel.checked = selected?.props?.iqterminalLabelState === 'custom';
    this.renderDrawingTemplates();
    this.setTemplateStatus(this.templateStorageWarning);
    if (!this.templatesDialog.open) this.templatesDialog.showModal();
  }

  private renderDrawingTemplates() {
    const catalog = this.templateCatalog; const draw = this.engine?.drawings;
    const selected = draw?.get(draw.selected() ?? ''); const tool = selected?.tool ?? (draw?.activeTool() ?? '');
    this.templatesList.replaceChildren();
    if (!catalog || !tool) {
      const empty = document.createElement('p'); empty.className = 'dialog-status'; empty.textContent = catalog ? 'Select a drawing tool or drawing to manage its templates.' : 'Loading local template catalog…';
      this.templatesList.append(empty); return;
    }
    const defaultId = catalog.defaults.find(item => item.tool === tool)?.templateId;
    const rows = catalog.templates.filter(item => item.tool === tool).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
    const defaultHint = document.createElement('p'); defaultHint.className = 'dialog-status'; defaultHint.textContent = defaultId ? 'New drawings use the saved default look.' : 'New drawings use the tool’s built-in look.'; this.templatesList.append(defaultHint);
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'dialog-status'; empty.textContent = 'No saved templates for this tool.'; this.templatesList.append(empty); return; }
    for (const template of rows) {
      const row = document.createElement('div'); row.className = 'drawing-template-row';
      const name = document.createElement('strong'); name.textContent = template.name; row.append(name);
      const favorite = this.templateActionButton(template.favorite ? '★' : '☆', 'favorite', template.id, 'Toggle favorite');
      favorite.setAttribute('aria-pressed', String(template.favorite)); row.append(favorite);
      const isDefault = defaultId === template.id;
      row.append(this.templateActionButton(isDefault ? 'Default ✓' : 'Set default', 'default', template.id, 'Use for new drawings'));
      const apply = this.templateActionButton('Apply', 'apply', template.id, 'Apply to selected drawing'); apply.disabled = !selected || selected.tool !== template.tool; row.append(apply);
      row.append(this.templateActionButton('Rename', 'rename', template.id, 'Rename template'));
      row.append(this.templateActionButton('Delete', 'delete', template.id, 'Delete template'));
      this.templatesList.append(row);
    }
  }

  private templateActionButton(label: string, action: string, id: string, title: string) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title;
    button.dataset.templateAction = action; button.dataset.templateId = id; return button;
  }

  private async saveDrawingTemplate() {
    const draw = this.engine?.drawings; const drawing = draw?.get(draw.selected() ?? ''); const repository = this.templateRepository;
    const name = this.templatesName.value.trim();
    if (!repository || !drawing) { this.templatesStatus.textContent = 'Select a drawing before saving its look.'; return; }
    if (!name) { this.templatesStatus.textContent = 'Enter a name for this template.'; this.templatesName.focus(); return; }
    try {
      const updating = this.templateCatalog?.templates.some(template => template.tool === drawing.tool && template.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? false;
      const snapshot = captureIQDrawingTemplateSettings(drawing);
      snapshot.label = this.templatesIncludeLabel.checked
        ? { present: true, value: snapshot.label.value }
        : { present: false, value: '' };
      this.templateCatalog = repository.saveTemplate(name, drawing.tool, snapshot);
      this.templatesName.value = ''; this.setTemplateStatus(`${updating ? 'Template updated' : 'Template saved'}. Applying it later changes settings only; drawings remain independent.`);
      this.renderDrawingTemplates();
    } catch (error) { this.setTemplateStatus(errorText(error)); }
  }

  private templateAction(action: string, id: string) {
    const repository = this.templateRepository; const draw = this.engine?.drawings; const template = this.templateCatalog?.templates.find(item => item.id === id);
    if (!repository || !template) return;
    try {
      let message = '';
      if (action === 'favorite') {
        this.templateCatalog = repository.toggleFavorite(id);
        message = 'Template favorite updated.';
      } else if (action === 'default') {
        const current = this.templateCatalog?.defaults.find(item => item.tool === template.tool)?.templateId;
        this.templateCatalog = repository.setDefault(template.tool, current === template.id ? null : template.id);
        message = current === template.id ? 'Built-in look will be used for new drawings.' : 'Default template updated for new drawings.';
      } else if (action === 'apply') {
        const selected = draw?.get(draw.selected() ?? '');
        if (!selected || selected.tool !== template.tool || !draw) { this.setTemplateStatus('Select a drawing of the same tool to apply this template.'); return; }
        draw.update(selected.id, this.drawingTemplatePatch(selected, template));
        this.engine?.objects.refresh(); message = 'Template applied as one drawing-history step. The drawing’s anchors and identity were kept.';
      } else if (action === 'rename') {
        const next = window.prompt('Rename drawing template', template.name);
        if (next?.trim()) { this.templateCatalog = repository.renameTemplate(id, next.trim()); message = 'Template renamed.'; }
      } else if (action === 'delete') { this.templateCatalog = repository.removeTemplate(id); message = 'Template deleted.'; }
      this.setTemplateStatus(message || this.templatesStatus.textContent || this.templateStorageWarning);
      this.renderDrawingTemplates();
    } catch (error) { this.setTemplateStatus(errorText(error)); }
  }

  private drawingTemplatePatch(drawing: Drawing, template: IQDrawingTemplateRecord, placementInterval?: string): DrawingPatch {
    // Native text content is controlled by the template's Include label bit.
    // Omitted labels leave the target content intact, including older catalogs
    // that may contain text.value in nativeValues.
    const textIsContent = drawingSettingsSchema(drawing.tool).textIsContent === true;
    const nativeValues = textIsContent
      ? Object.fromEntries(Object.entries(template.nativeValues).filter(([path]) => path !== 'text.value'))
      : template.nativeValues;
    const nativePatch = drawingSettingsPatch(drawing, nativeValues, drawingSettingsSchema(drawing.tool));
    const textLabelPatch = textIsContent && template.label.present
      ? { text: { ...drawing.text, ...(nativePatch.text ?? {}), value: template.label.value } }
      : {};
    return {
      ...nativePatch,
      ...textLabelPatch,
      visible: template.visibility.visible,
      intervals: template.visibility.intervals,
      props: {
        ...drawing.props,
        ...(nativePatch.props ?? {}),
        iqterminal: { version: 1 },
        ...(template.label.present ? { iqterminalLabelState: 'custom', iqterminalLabel: template.label.value } : {}),
        iqterminalLabelTextColorExplicit: template.textColorExplicit,
        iqterminalAnalysisInterval: template.analysisInterval ?? placementInterval ?? '',
      },
    };
  }

  private setTemplateStatus(message: string) {
    const persistence = this.templateRepository?.error();
    const warning = persistence ? `Template changes are available for this session only because browser storage failed (${errorText(persistence)}).` : this.templateStorageWarning;
    this.templatesStatus.textContent = [message, warning].filter(Boolean).join(' ');
  }

  private footprintField(labelText: string, control: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label'); label.className = 'indicator-setting-field';
    const text = document.createElement('span'); text.textContent = labelText;
    label.append(text, control);
    return label;
  }

  private selectControl(key: string, options: [string, string][]) {
    const select = document.createElement('select');
    select.dataset.footprintOption = key;
    for (const [value, label] of options) select.add(new Option(label, value));
    return select;
  }

  private checkboxControl(key: string) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.dataset.footprintOption = key;
    return input;
  }

  private numberControl(key: string) {
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '0.001'; input.required = true;
    input.dataset.footprintOption = key;
    return input;
  }

  private opacityControl() {
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1'; input.required = true;
    input.dataset.footprintOption = 'opacity'; return input;
  }

  private openFootprintSettings() {
    if (!this.nativeIndicator(FOOTPRINT_ID)) return;
    const view = this.selection.footprint;
    const mode = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="displayMode"]')!;
    const style = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="cellStyle"]')!;
    const poc = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showPoc"]')!;
    const diagonal = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showDiagonalImbalances"]')!;
    const stacked = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="stackedImbalances"]')!;
    const ratio = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="imbalanceRatio"]')!;
    const threshold = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="imbalanceThreshold"]')!;
    this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="opacity"]')!.value = String(Math.round(view.opacity * 100));
    this.rowPrice.value = String(this.selection.rowPrice); this.rowPrice.setCustomValidity(''); syncCurrencyControl(this.footprintUnits, this.selection.footprintUnits);
    this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showCandle"]')!.checked = view.showCandle;
    this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showValueArea"]')!.checked = view.showValueArea;
    mode.value = view.displayMode === 'delta' && view.cellStyle === 'profile' ? 'delta-profile' : view.displayMode === 'bidask' && view.cellStyle === 'profile' && view.statsPosition === 'bar' ? 'volume-delta-candle' : view.displayMode;
    style.value = view.cellStyle; poc.checked = view.showPoc;
    diagonal.checked = view.showDiagonalImbalances; stacked.checked = view.stackedImbalances;
    ratio.value = String(view.imbalanceRatio); threshold.value = String(view.imbalanceThreshold);
    if (!this.footprintDialog.open) this.footprintDialog.showModal();
  }

  private applyFootprintSettings() {
    if (!this.nativeIndicator(FOOTPRINT_ID)) return;
    const threshold = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="imbalanceThreshold"]')!;
    const opacity = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="opacity"]')!;
    const price = Number(this.rowPrice.value);
    this.rowPrice.setCustomValidity(!validFootprintRowPrice(price) ? 'Enter a positive price level no greater than $10,000.' : this.footprintStatus.tickSize !== null && footprintTicksForPrice(price, this.footprintStatus.tickSize) === null ? `Enter a multiple of the exchange tick size, $${this.footprintStatus.tickSize}.` : '');
    if (!this.rowPrice.reportValidity() || !threshold.reportValidity() || !opacity.reportValidity()) return;
    const display = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="displayMode"]')!.value;
    const view = {
        opacity: Number(opacity.value) / 100,
        displayMode: display === 'delta-profile' ? 'delta' : display === 'volume-delta-candle' ? 'bidask' : display,
        cellStyle: display === 'delta-profile' || display === 'volume-delta-candle' ? 'profile' : this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="cellStyle"]')!.value,
        statsPosition: display === 'volume-delta-candle' ? 'bar' : 'bottom',
        showCandle: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showCandle"]')!.checked,
        showPoc: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showPoc"]')!.checked,
        showValueArea: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showValueArea"]')!.checked,
        showDiagonalImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showDiagonalImbalances"]')!.checked,
        stackedImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="stackedImbalances"]')!.checked,
        imbalanceRatio: Number(this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="imbalanceRatio"]')!.value),
        imbalanceThreshold: Number(threshold.value),
    };
    const instance = this.nativeIndicator(FOOTPRINT_ID)!;
    this.changeIndicator(instance.instanceId, { settings: { rowPrice: price, units: getCurrencyPreference().enabled ? this.selection.footprintUnits : this.footprintUnits.value, view } });
    this.footprintDialog.close();
  }

  private applyFootprintOptions() {
    const view = this.selection.footprint;
    this.engine?.setFootprintUnits(this.displayFootprintUnits);
    this.heatmapControls.setUnits(this.displayFootprintUnits);
    this.engine?.setFootprintOpacity(view.opacity);
    this.engine?.setFootprintOptions({
      displayMode: view.displayMode,
      cellStyle: view.cellStyle,
      showPoc: view.showPoc,
      showValueArea: view.showValueArea,
      pocStyle: 'outline',
      pocColor: '#858585',
      buyColor: '#58a65c',
      buyTextColor: '#58a65c',
      sellColor: '#ad5858',
      sellTextColor: '#ad5858',
      radius: 0,
      imbalanceRatio: view.imbalanceRatio,
      imbalanceThreshold: view.showDiagonalImbalances ? view.imbalanceThreshold : Number.MAX_VALUE,
      textColorMode: view.displayMode === 'bidask' && view.cellStyle === 'profile' ? 'dominant' : view.showDiagonalImbalances ? 'imbalance' : 'contrast',
      stackedImbalances: view.showDiagonalImbalances && view.stackedImbalances ? 2 : 0,
      showCandle: view.showCandle,
      // Statistics belong exclusively to the standalone Footprint Totals pane.
      statsPosition: 'bottom',
      statsRows: [],
      tableRows: [],
    });
  }

  private updateFootprintControls() {
    this.chart.setAttribute('aria-label', `${instrumentLabel(this.selection)} ${this.selection.type === 'footprint' ? 'Footprint' : 'candlestick'} chart`);
    this.metadata.dataset.mode = this.selection.type;
    if (this.selection.type === 'footprint') this.updateFootprintMetadata(); else this.updateInstrumentMetadata();
    this.renderActiveIndicators(); this.updateToolbarOverflowCue();
  }

  private updateToolbarOverflowCue() {
    if (this.dead) return;
    const maxScroll = Math.max(0, this.toolbar.scrollWidth - this.toolbar.clientWidth);
    const hasOverflow = maxScroll > 2;
    const atLeft = this.toolbar.scrollLeft <= 2;
    const atRight = this.toolbar.scrollLeft >= maxScroll - 2;
    this.toolbarCue.hidden = !hasOverflow;
    this.toolbarCue.textContent = atRight && !atLeft ? '‹' : '›';
    const direction = atRight && !atLeft ? 'left' : 'right';
    this.toolbarCue.setAttribute('aria-label', `Scroll chart controls ${direction}`);
    this.toolbarCue.title = direction === 'right' ? 'More chart controls' : 'Scroll back to earlier chart controls';
    this.toolbar.dataset.overflow = hasOverflow ? 'true' : 'false';
    this.toolbar.style.paddingRight = hasOverflow ? '31px' : '';
  }

  private scrollToolbar() {
    const direction = this.toolbarCue.getAttribute('aria-label')?.endsWith('left') ? -1 : 1;
    this.toolbar.scrollBy({ left: direction * Math.max(120, this.toolbar.clientWidth * 0.65), behavior: 'smooth' });
  }

  private dialogButton(label: string, action: string, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.dialogAction = action;
    if (primary) button.className = 'primary';
    return button;
  }

  private nativeIndicator(id: string) { return this.selection?.indicators.find(i => i.definitionId === id && i.settingsVersion === (nativeDefinition(id)?.settingsVersion ?? 1) && i.source.kind === 'chart'); }

  private createIndicatorHandle(instance: IndicatorInstance) {
    if (instance.source.kind !== 'chart' || instance.settingsVersion !== (nativeDefinition(instance.definitionId)?.settingsVersion ?? 1)) return undefined;
    if (instance.definitionId === COMPOSITION_SMA_ID) return this.createCompositionSmaHandle(instance);
    if (nativeDefinition(instance.definitionId) && instance.settingsVersion === nativeDefinition(instance.definitionId)!.settingsVersion) {
      this.syncNativeIndicators();
      return { updateSettings: () => this.syncNativeIndicators(), setVisible: () => this.syncNativeIndicators(), dispose: () => { if (!this.dead) this.syncNativeIndicators(); } };
    }
    if (instance.script && studyPins([instance]).length) return {
      updateSettings: async (settings: Record<string, unknown>) => {
        const current = this.studyHost?.views().find(v => v.attachmentId === instance.instanceId);
        if (current && JSON.stringify(current.settings) !== JSON.stringify(settings)) await this.studyHost?.applySettings(instance.instanceId, settings as StudyPin['settings']);
      },
      setVisible: (visible: boolean) => { if (this.studyHost?.views().find(v => v.attachmentId === instance.instanceId)?.visible !== visible) this.studyHost?.setVisibleStudy(instance.instanceId, visible); },
      dispose: () => { if (!this.dead) this.studyHost?.remove(instance.instanceId); },
    };
    return undefined;
  }

  private reconcileIndicators() {
    if (this.dead) return;
    this.compositionWork.indicatorReconciles++;
    this.syncCompositionDependencies();
    this.indicatorLifecycle?.reconcile(this.selection.indicators);
    this.syncCompositionIndicators();
    this.syncCvd();
    this.syncOpenInterest();
    this.restorePaneOrder();
    this.restoreCompositionLayout();
    this.syncOrderFlowPane();
    this.renderActiveIndicators();
    if (this.engine) { this.compositionWork.objectRefreshes++; this.engine.objects.refresh(); }
    this.syncScriptObjectProviders();
  }

  private savedNumericConsumerReferences(): { instanceId: string; ref: NumericOutputRef }[] {
    const indicators = this.selection.indicators.flatMap(instance => Object.values(instance.numericInputs ?? {})
      .map(ref => ({ instanceId: instance.instanceId, ref })));
    const studies = (this.studyHost?.pins() ?? []).flatMap(pin => Object.values(pin.numericInputs ?? {})
      .map(ref => ({ instanceId: pin.attachmentId, ref })));
    return [...indicators, ...studies];
  }

  private hasSavedNumericConsumers(instanceId: string) {
    return this.savedNumericConsumerReferences().some(({ ref }) => ref.instanceId === instanceId);
  }

  private handleStudyDataUpdate() {
    this.compositionWork.dataCallbacks++;
    this.orderFlowPaneView?.invalidate();
    this.updateDepthNotice();
  }

  private createCompositionSmaHandle(instance: IndicatorInstance) {
    if (!instance.numericInputs?.source) return undefined;
    this.syncCompositionSma(instance);
    return {
      updateSettings: (settings: Record<string, unknown>) => {
        const current = this.selection.indicators.find(item => item.instanceId === instance.instanceId);
        if (current) this.syncCompositionSma({ ...current, settings });
      },
      setVisible: (visible: boolean) => this.compositionApis.get(instance.instanceId)?.setVisible(visible),
      dispose: () => {
        const api = this.compositionApis.get(instance.instanceId);
        if (api) { api.remove({ force: true }); this.compositionApis.delete(instance.instanceId); }
        this.releaseCompositionSmaBinding(instance.instanceId);
        this.outputRegistry?.releaseOwner(instance.instanceId, 'Moving average was removed.');
      },
    };
  }

  private syncCompositionDependencies() {
    const smaStudies = this.selection.indicators.filter(instance => instance.definitionId === COMPOSITION_SMA_ID && instance.settingsVersion === 1);
    const byId = new Map(this.selection.indicators.map(instance => [instance.instanceId, instance]));
    const activeConsumers = new Set<string>();
    const demandedScripts = new Set<string>();
    const demandedCvd = new Set<string>();
    const demandedOpenInterest = new Set<string>();
    const pending = smaStudies.filter(instance => instance.visible).map(instance => instance.instanceId);
    while (pending.length) {
      const consumerId = pending.pop()!;
      if (activeConsumers.has(consumerId)) continue;
      activeConsumers.add(consumerId);
      const instance = byId.get(consumerId);
      const providerId = instance?.numericInputs?.source?.instanceId;
      if (!providerId) continue;
      const provider = byId.get(providerId);
      if (provider?.definitionId === COMPOSITION_SMA_ID) pending.push(providerId);
      else if (provider?.script) demandedScripts.add(providerId);
      if (provider?.definitionId === CVD_ID) demandedCvd.add(providerId);
      if (provider?.definitionId === OPEN_INTEREST_ID) demandedOpenInterest.add(providerId);
    }
    this.demandedCompositionSmaConsumers = activeConsumers;
    this.demandedCvdProviders = demandedCvd;
    this.demandedOpenInterestProviders = demandedOpenInterest;
    const savedConsumers = new Set(this.savedNumericConsumerReferences().map(({ ref }) => ref.instanceId));
    for (const instance of smaStudies) {
      const api = this.compositionApis.get(instance.instanceId);
      if (!api) continue;
      const removable = !savedConsumers.has(instance.instanceId);
      if ((api.policy().removable !== false) !== removable) {
        // Enforce saved native-SMA dependencies at the same engine boundary
        // that protects script producers. Hidden consumers still hold a saved
        // reference; forced owner teardown remains available to this panel.
        api.setPolicy({ removable, configurable: true, movable: true });
      }
    }
    for (const instance of smaStudies) this.outputRegistry?.setConsumerActive(instance.instanceId, activeConsumers.has(instance.instanceId));
    this.studyHost?.setNumericOutputDemand([...demandedScripts]);
    this.studyHost?.setExternalOutputDependents(smaStudies.flatMap(instance => instance.numericInputs?.source
      ? [{ consumerId: instance.instanceId, title: this.compositionSmaTitle(instance), ref: instance.numericInputs.source }]
      : []));
  }

  private syncCompositionIndicators() {
    for (const instance of this.selection.indicators) {
      if (instance.definitionId === COMPOSITION_SMA_ID && instance.settingsVersion === 1 && instance.source.kind === 'chart') this.syncCompositionSma(instance);
    }
    this.syncCompositionPlotRecords();
    this.syncVolumeCompositionBands();
    this.syncCompositionDependencies();
  }

  private syncCompositionPlotRecords() {
    const indicators = this.selection.indicators, host = this.studyHost;
    if (!host) return;
    const views = new Map(host.views().map(view => [view.attachmentId, view]));
    const known: { instanceId: string; outputKey: string; engineScaleId: string; unit: NumericUnit; paneId: string; visible: boolean; order: number; zeroBased: boolean }[] = [];
    indicators.forEach((instance, instanceIndex) => {
      if (instance.script) {
        const view = views.get(instance.instanceId);
        if (!view) return;
        const paneId = view.placement === 'pane' ? view.paneId ?? compositionPaneId(view.attachmentId) : PRICE_PANE_ID;
        view.numericOutputs.forEach((output, outputIndex) => known.push({ instanceId: view.attachmentId, outputKey: output.plotKey,
          engineScaleId: output.scaleId, unit: output.unit, paneId, visible: view.visible,
          order: instanceIndex * MAX_COMPOSITION_PLOTS + outputIndex,
          zeroBased: view.scriptId === 'builtin.volume-histogram' && output.plotKey === 'p0' }));
        return;
      }
      if (instance.definitionId === OPEN_INTEREST_ID) {
        const paneId = instance.placement === 'pane' ? instance.paneId ?? compositionPaneId(instance.instanceId) : PRICE_PANE_ID;
        this.outputRegistry.outputsForOwner(instance.instanceId).forEach((output, outputIndex) => known.push({
          instanceId: instance.instanceId, outputKey: output.plotKey,
          engineScaleId: this.openInterestOutputScaleId(instance, output.plotKey), unit: output.unit,
          paneId, visible: instance.visible, order: instanceIndex * MAX_COMPOSITION_PLOTS + outputIndex, zeroBased: false,
        }));
        return;
      }
      if (instance.definitionId !== COMPOSITION_SMA_ID) return;
      const api = this.compositionApis.get(instance.instanceId);
      const ref = instance.numericInputs?.source;
      const savedPlot = this.selection.composition.plots.find(plot => plot.plotId === compositionPlotId(instance.instanceId, 'p0'));
      const savedScale = savedPlot && this.selection.composition.scales.find(scale => scale.scaleId === savedPlot.scaleId);
      const engineScaleId = api?.plotPriceScaleId('p0') ?? instance.plotScaleIds?.p0 ?? savedScale?.engineScaleId;
      if (!engineScaleId) return;
      const provider = ref && views.get(ref.instanceId);
      const primaryPaneIndex = this.engine?.chart.primaryPaneIndex();
      // A missing API means the producer is unavailable, not that its saved
      // presentation belongs on the price pane. Keep the durable plot/instance
      // placement until an API can report its live pane again.
      const paneId = api
        ? api.paneIndex !== primaryPaneIndex
          ? instance.paneId ?? provider?.paneId ?? savedPlot?.paneId ?? compositionPaneId(instance.instanceId)
          : PRICE_PANE_ID
        : savedPlot?.paneId ?? (instance.placement === 'pane'
          ? instance.paneId ?? compositionPaneId(instance.instanceId)
          : PRICE_PANE_ID);
      known.push({ instanceId: instance.instanceId, outputKey: 'p0', engineScaleId,
        unit: ref?.unit ?? null,
        paneId,
        visible: api?.visible() ?? instance.visible,
        order: savedPlot?.order ?? instanceIndex * MAX_COMPOSITION_PLOTS,
        zeroBased: Boolean(provider?.scriptId === 'builtin.volume-histogram' && ref?.plotKey === 'p0') });
    });

    const instanceIds = new Set(indicators.map(instance => instance.instanceId));
    const knownByOwner = new Map<string, Set<string>>();
    for (const item of known) {
      const keys = knownByOwner.get(item.instanceId) ?? new Set<string>(); keys.add(item.outputKey); knownByOwner.set(item.instanceId, keys);
    }
    const viewsWithKnownSchema = new Set([...views.values()].filter(view => view.numericOutputs.length > 0).map(view => view.attachmentId));
    const existing = this.selection.composition.plots.filter(plot => {
      if (!instanceIds.has(plot.producerInstanceId)) return false;
      const instance = indicators.find(item => item.instanceId === plot.producerInstanceId);
      if (!instance) return false;
      const currentKeys = knownByOwner.get(plot.producerInstanceId);
      if (currentKeys?.has(plot.outputKey)) return false;
      if (instance.definitionId === COMPOSITION_SMA_ID) return true;
      // Keep prior metadata through a worker restore/error; prune a removed key
      // only after a current program exposes its replacement schema.
      return Boolean(instance.script && !viewsWithKnownSchema.has(plot.producerInstanceId));
    });

    const engineScaleByLogical = new Map(this.selection.composition.scales.map(scale => [scale.scaleId, scale.engineScaleId]));
    const plots: CompositionPlotRecord[] = [...existing];
    const scalesByEngine = new Map<string, CompositionScaleRecord>();
    const addScale = (engineScaleId: string, unit: NumericUnit, zeroBased: boolean, paneId: string, instanceId: string) => {
      const scaleId = compositionScaleId(engineScaleId as import('openalgo-charts').PriceScaleId);
      const band = this.selection.composition.embeddedBands.find(item => item.memberIds.includes(instanceId));
      const prior = scalesByEngine.get(engineScaleId);
      if (prior) {
        if (prior.unit === null && unit !== null) prior.unit = unit;
        if (zeroBased) prior.policy = 'zero-based';
        if (band && !prior.bandMemberships.some(item => item.paneId === paneId)) prior.bandMemberships.push({ paneId, bandId: band.id });
      } else scalesByEngine.set(engineScaleId, { scaleId, engineScaleId: engineScaleId as import('openalgo-charts').PriceScaleId,
        unit, policy: zeroBased ? 'zero-based' : 'auto', bandMemberships: band ? [{ paneId, bandId: band.id }] : [] });
      return scaleId;
    };
    // Retain a scale mapping only for a temporarily unavailable producer.
    for (const plot of existing) {
      const engineScaleId = engineScaleByLogical.get(plot.scaleId);
      if (engineScaleId) addScale(engineScaleId, null, false, plot.paneId, plot.producerInstanceId);
    }
    for (const item of known) {
      const scaleId = addScale(item.engineScaleId, item.unit, item.zeroBased, item.paneId, item.instanceId);
      plots.push({ plotId: compositionPlotId(item.instanceId, item.outputKey), producerInstanceId: item.instanceId,
        outputKey: item.outputKey, paneId: item.paneId, scaleId, visible: item.visible, order: item.order });
    }
    const state = validateComposition({ ...this.selection.composition, plots, scales: [...scalesByEngine.values()] }, [...instanceIds]);
    if (JSON.stringify(state.plots) === JSON.stringify(this.selection.composition.plots)
      && JSON.stringify(state.scales) === JSON.stringify(this.selection.composition.scales)) return;
    this.selection = config({ ...this.selection, composition: state });
    this.params.api.updateParameters(this.selection);
    this.save();
  }

  private syncVolumeCompositionBands() {
    const chart = this.engine?.chart, host = this.studyHost;
    if (!chart || !host) return;
    const visible = chart.timeScale.visibleRange();
    if (!visible) return;
    const scales = new Map(this.selection.composition.scales.map(scale => [scale.scaleId, scale]));
    const bands = new Map(this.selection.composition.embeddedBands.map(band => [band.id, band]));
    const candidates = new Map<string, { record: CompositionScaleRecord; paneId: string; scale: PriceScale; maximum: number; scannedValues: number }>();
    const add = (scaleId: string | undefined, paneId: string | undefined, series: { priceScale(): PriceScale } | undefined, values: readonly (number | null)[]) => {
      if (!scaleId || !paneId || !series) return;
      const record = scales.get(scaleId);
      if (!record || record.policy !== 'zero-based') return;
      const range = visibleRangeMaximum(values, visible.from, visible.to, 1);
      if (!range) return;
      const scale = series.priceScale();
      const key = `${scaleId}\u0000${paneId}`;
      const current = candidates.get(key);
      if (current) { current.maximum = Math.max(current.maximum, range.maximum); current.scannedValues += range.scannedValues; }
      else candidates.set(key, { record, paneId, scale, maximum: range.maximum, scannedValues: range.scannedValues });
    };
    for (const study of host.views()) {
      if (study.scriptId !== 'builtin.volume-histogram') continue;
      for (const output of study.numericOutputs) {
        const plot = this.selection.composition.plots.find(item => item.plotId === compositionPlotId(study.attachmentId, output.plotKey));
        const api = host.apiForAttachment(study.attachmentId);
        const series = api?.series(output.plotKey);
        add(plot?.scaleId, plot?.paneId, series, output.values);
      }
    }
    for (const instance of this.selection.indicators.filter(item => item.definitionId === COMPOSITION_SMA_ID)) {
      const plot = this.selection.composition.plots.find(item => item.plotId === compositionPlotId(instance.instanceId, 'p0'));
      const api = this.compositionApis.get(instance.instanceId);
      const values = api?.values().p0 ?? [];
      add(plot?.scaleId, plot?.paneId, api?.series('p0'), values);
    }
    const nextOwned = new Map<string, { scale: PriceScale; originalMarginTop: number; originalMarginBottom: number; marginTop: number; marginBottom: number }>();
    for (const [key, { record, paneId, scale, maximum, scannedValues }] of candidates) {
      const membership = record.bandMemberships.find(item => item.paneId === paneId);
      const band = membership ? bands.get(membership.bandId) : undefined;
      const embedded = Boolean(band) || paneId === PRICE_PANE_ID;
      const marginTop = embedded ? 1 - (band?.heightPercent ?? DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT) / 100 : .08;
      const marginBottom = embedded ? .02 : .08;
      // The chart's owned range tracks only visible bars. PriceScale retains a
      // user drag as a manual override while remembering this range for Fit.
      const upper = maximum > 0 ? maximum * 1.08 : 1e-8;
      const bandFraction = Math.max(.08, 1 - marginTop - marginBottom);
      const fixedMaximum = upper / bandFraction;
      const previous = this.ownedCompositionScales.get(key);
      const owned = previous ?? { scale, originalMarginTop: scale.options.marginTop, originalMarginBottom: scale.options.marginBottom, marginTop, marginBottom };
      if (!scale.setOwnedFixedRange(this.compositionScaleRangeOwner, { min: 0, max: fixedMaximum })) continue;
      if (scale.options.marginTop !== marginTop || scale.options.marginBottom !== marginBottom) scale.setOptions({ marginTop, marginBottom });
      nextOwned.set(key, { ...owned, scale, marginTop, marginBottom });
      this.compositionWork.visibleRangeScaleUpdates++;
      this.compositionWork.autoscaleValuesScanned += scannedValues;
    }
    for (const [key, previous] of this.ownedCompositionScales) {
      if (nextOwned.has(key)) continue;
      previous.scale.clearOwnedFixedRange(this.compositionScaleRangeOwner);
      if (previous.scale.options.marginTop === previous.marginTop && previous.scale.options.marginBottom === previous.marginBottom) {
        previous.scale.setOptions({ marginTop: previous.originalMarginTop, marginBottom: previous.originalMarginBottom });
      }
    }
    this.ownedCompositionScales = nextOwned;
  }

  private syncCompositionSma(instance: IndicatorInstance, options: { recreateDetachedConsumer?: boolean } = {}) {
    const chart = this.engine?.chart, host = this.studyHost, ref = instance.numericInputs?.source;
    if (!chart || !host) return null;
    if (!ref) { this.removeCompositionApi(instance.instanceId); this.releaseCompositionSmaBinding(instance.instanceId); return null; }
    const scriptOutput = host.numericOutputs().find(item => item.outputId === ref.outputId && item.instanceId === ref.instanceId
      && item.plotKey === ref.plotKey && item.schemaId === ref.schemaId && item.domain === ref.domain
      && item.contextId === ref.contextId && item.unit === ref.unit);
    const output = scriptOutput ?? this.outputRegistry.outputsForOwner(ref.instanceId)
      .find(item => item.outputId === ref.outputId && item.plotKey === ref.plotKey && item.schemaId === ref.schemaId
        && item.domain === ref.domain && item.contextId === ref.contextId && item.unit === ref.unit);
    const current = this.compositionApis.get(instance.instanceId);
    if (!output?.available || 'composable' in output && output.composable === false) {
      if (current) this.removeCompositionApi(instance.instanceId);
      return null;
    }
    const refKey = JSON.stringify(ref);
    let binding = this.compositionSmaBindings.get(instance.instanceId);
    const consumerRegistered = this.outputRegistry.hasConsumer(instance.instanceId);
    if (!binding || binding.refKey !== refKey || !consumerRegistered) {
      this.releaseCompositionSmaBinding(instance.instanceId);
      const registered = registerManagedNumericOutputBinding(this.outputRegistry, instance.instanceId, ref);
      binding = { token: registered.token, refKey, release: registered.release };
      this.compositionSmaBindings.set(instance.instanceId, binding);
    }
    let api = current;
    if (api && options.recreateDetachedConsumer && !consumerRegistered) {
      this.removeCompositionApi(instance.instanceId);
      api = undefined;
    }
    if (api && api.settings().managedOutputToken !== binding.token) {
      this.removeCompositionApi(instance.instanceId);
      api = undefined;
    }
    const settings = { ...instance.settings, managedOutputToken: binding.token };
    const provider = host.views().find(view => view.attachmentId === ref.instanceId);
    const nativeProvider = this.selection.indicators.find(item => item.instanceId === ref.instanceId);
    const providerPlacement = provider?.placement ?? nativeProvider?.placement;
    const providerPaneId = provider?.paneId ?? nativeProvider?.paneId
      ?? (nativeProvider && [CVD_ID, OPEN_INTEREST_ID].includes(nativeProvider.definitionId) ? compositionPaneId(nativeProvider.instanceId) : undefined);
    const targetPaneId = instance.paneId ?? (providerPlacement === 'pane' ? providerPaneId : PRICE_PANE_ID);
    const providerPaneIndex = provider?.scriptId ? host.paneIndex(ref.instanceId)
      : nativeProvider?.definitionId === CVD_ID ? this.cvdView?.paneIndex() ?? -1
        : nativeProvider?.definitionId === OPEN_INTEREST_ID ? this.openInterestView?.paneIndex() ?? -1 : this.compositionApis.get(ref.instanceId)?.paneIndex ?? -1;
    const managedPaneIndex = !targetPaneId || targetPaneId === PRICE_PANE_ID ? -1
      : this.compositionPlacement?.resolveManagedPaneIndex(targetPaneId, instance.instanceId) ?? -1;
    const paneIndex = instance.placement === 'overlay' || targetPaneId === PRICE_PANE_ID ? chart.primaryPaneIndex()
      : managedPaneIndex >= 0 ? managedPaneIndex
        : api?.paneIndex ?? (providerPlacement === 'pane' && providerPaneId === targetPaneId && providerPaneIndex >= 0
          ? providerPaneIndex : chart.panes().length);
    const providerScaleId = 'scaleId' in output ? output.scaleId : nativeProvider?.plotScaleIds?.[ref.plotKey]
      ?? this.compositionApis.get(ref.instanceId)?.plotPriceScaleId(ref.plotKey)
      ?? (nativeProvider?.definitionId === OPEN_INTEREST_ID ? this.openInterestOutputScaleId(nativeProvider, ref.plotKey)
        : numericOutputScaleId(providerPaneId ?? PRICE_PANE_ID, output.outputId, null));
    const scaleId = instance.plotScaleIds?.p0 ?? providerScaleId;
    if (!api) {
      api = chart.addIndicator(COMPOSITION_SMA_ID, settings as import('openalgo-charts').IndicatorSettings, {
        paneIndex: paneIndex >= 0 ? paneIndex : chart.panes().length,
        instanceId: instance.instanceId,
        plotPriceScaleIds: { p0: scaleId },
        policy: { removable: !this.hasSavedNumericConsumers(instance.instanceId), configurable: true, movable: true },
      });
      api.legend()?.setOptions({ visible: false });
      api.setVisible(instance.visible);
      this.compositionApis.set(instance.instanceId, api);
    } else {
      if (JSON.stringify(api.settings()) !== JSON.stringify(settings)) api.setSettings(settings as import('openalgo-charts').IndicatorSettings, { force: true });
      if (api.plotPriceScaleId('p0') !== scaleId) api.setPlotPriceScales({ p0: scaleId }, { force: true });
      if (paneIndex >= 0 && api.paneIndex !== paneIndex) chart.moveIndicator(api.id, paneIndex, { force: true });
      if (api.visible() !== instance.visible) api.setVisible(instance.visible);
    }
    return api;
  }

  private removeCompositionApi(instanceId: string) {
    const api = this.compositionApis.get(instanceId);
    if (!api) return;
    this.internalCompositionRemovals.add(api.id);
    api.remove({ force: true });
    this.compositionApis.delete(instanceId);
  }

  private releaseCompositionSmaBinding(instanceId: string) {
    this.compositionSmaBindings.get(instanceId)?.release();
    this.compositionSmaBindings.delete(instanceId);
  }

  private compositionOutputChoices(instanceId?: string) {
    const studies = this.studyHost?.views() ?? [];
    const scriptChoices = studies.filter(study => !instanceId || study.attachmentId === instanceId).flatMap(study => study.numericOutputs
      .map(output => ({ output, label: `${study.title} · ${output.title}${output.unit ? ` (${output.unit})` : ''}` })));
    const nativeChoices = this.selection.indicators.filter(item => (item.definitionId === COMPOSITION_SMA_ID || item.definitionId === CVD_ID || item.definitionId === OPEN_INTEREST_ID)
      && (!instanceId || item.instanceId === instanceId)).flatMap(instance => this.outputRegistry.outputsForOwner(instance.instanceId)
      .map(value => {
        const api = this.compositionApis.get(instance.instanceId);
        const isCvd=instance.definitionId===CVD_ID;
        const isOpenInterest=instance.definitionId===OPEN_INTEREST_ID;
        const cvdUnit=value.unit==='USDT'?'USDT':'BTC';
        const output: NumericOutputDescriptor = {
          kind: value.kind, version: value.version, instanceId: value.instanceId, outputId: value.outputId,
          plotKey: value.plotKey, schemaId: value.schemaId, domain: value.domain, contextId: value.contextId, unit: value.unit,
          ...(api?{engineInstanceId:api.id}:{}), title: value.title, revision: value.revision,
          contextRevision: value.contextRevision, available: value.available,
          scaleId: isCvd ? this.cvdOutputScaleId(instance,cvdUnit)
            : isOpenInterest ? this.openInterestOutputScaleId(instance,value.plotKey)
              : instance.plotScaleIds?.[value.plotKey] ?? api?.plotPriceScaleId(value.plotKey)
              ?? numericOutputScaleId(instance.paneId ?? compositionPaneId(instance.instanceId), value.outputId, null),
          times: value.times, values: value.values, composable: true, changedRange: value.changedRange,
        };
        return { output, label: `${value.title}${value.unit ? ` (${value.unit})` : ''}` };
      }));
    return [...scriptChoices, ...nativeChoices];
  }

  private openCompositionSma(providerId?: string, instance?: IndicatorInstance) {
    const choices = this.compositionOutputChoices(providerId);
    const currentRef = instance?.numericInputs?.source;
    const presentationScaleId = instance && (this.compositionApis.get(instance.instanceId)?.plotPriceScaleId('p0') ?? instance.plotScaleIds?.p0);
    const settings = instance ? { length: Number(instance.settings.length) || 20,
      color: typeof instance.settings.color === 'string' ? instance.settings.color : '#63c7b2',
      unit: currentRef?.unit ?? null, scaleId: presentationScaleId } : undefined;
    this.compositionControls.open(choices, currentRef, settings, instance?.instanceId,
      outputId => this.compositionOutputChoices(providerId).find(choice => choice.output.outputId === outputId));
  }

  private addCompositionSma(output: NumericOutputDescriptor, settings: { length: number; color: string }, instanceId?: string, changeScale = false): boolean | string {
    const source = this.selection.indicators.find(instance => instance.instanceId === output.instanceId);
    const view = this.studyHost?.views().find(study => study.attachmentId === output.instanceId);
    const currentOutput = view?.numericOutputs.find(candidate => candidate.outputId === output.outputId)
      ?? this.compositionOutputChoices(output.instanceId).find(choice => choice.output.outputId === output.outputId)?.output;
    if (!source || !currentOutput?.available || currentOutput.composable === false
      || output.schemaId !== currentOutput.schemaId || output.domain !== currentOutput.domain
      || output.unit !== currentOutput.unit || output.contextId !== currentOutput.contextId) {
      this.activeIndicators.dataset.error = 'The selected output changed or is unavailable. Choose a current output; the existing moving average is unchanged.';
      this.renderActiveIndicators(); return false;
    }
    const old = instanceId ? this.selection.indicators.find(item => item.instanceId === instanceId) : undefined;
    const ref = numericOutputRef(currentOutput);
    const oldRef = old?.numericInputs?.source;
    if (old && oldRef && oldRef.unit !== ref.unit && !changeScale) {
      this.activeIndicators.dataset.error = 'The selected output uses different units. Confirm “Use the selected output scale” before applying; the existing moving average is unchanged.';
      this.renderActiveIndicators(); return false;
    }
    const inputChanged = Boolean(old && (!oldRef || oldRef.instanceId !== ref.instanceId || oldRef.outputId !== ref.outputId
      || oldRef.schemaId !== ref.schemaId || oldRef.domain !== ref.domain || oldRef.contextId !== ref.contextId || oldRef.unit !== ref.unit));
    if (old && inputChanged) {
      const sourceOutput = this.outputRegistry?.get(ref.outputId);
      const previousOutput = this.outputRegistry?.get(numericOutputId(old.instanceId, 'p0'));
      if (!sourceOutput?.available) {
        const message = 'Could not validate the replacement against every saved dependent output. Refresh the source list and try again; the existing moving average is unchanged.';
        this.activeIndicators.dataset.error = message;
        this.renderActiveIndicators();
        return message;
      }
      if (!previousOutput) {
        const missingOutputId = numericOutputId(old.instanceId, 'p0');
        const hasSavedDependents = this.savedNumericConsumerReferences().some(({ ref: consumerRef }) =>
          consumerRef.instanceId === old.instanceId && consumerRef.outputId === missingOutputId);
        if (hasSavedDependents) {
          const message = 'Cannot safely rebind this moving average while saved studies depend on its missing output. Restore its input or remove those studies first.';
          this.activeIndicators.dataset.error = message;
          this.renderActiveIndicators();
          return message;
        }
      } else {
        const replacement: ChartNumericOutput = {
          ...previousOutput,
          schemaId: numericOutputSchemaId('p0', sourceOutput.unit),
          contextId: sourceOutput.contextId,
          unit: sourceOutput.unit,
          revision: previousOutput.revision + 1,
          contextRevision: sourceOutput.contextRevision,
          available: true,
          times: sourceOutput.times,
          values: sourceOutput.values,
          quantity: sourceOutput.quantity,
          marketScope: sourceOutput.marketScope,
          sourceScope: `native-sma:${old.instanceId}`,
          timestampConvention: sourceOutput.timestampConvention,
          quality: sourceOutput.quality,
          resets: sourceOutput.resets,
          changedRange: { from: 0, to: sourceOutput.values.length },
        };
        const savedReferenceConsumers = new Map<string, { title: string; ref: NonNullable<IndicatorInstance['numericInputs']>[string] }>();
        for (const consumer of this.selection.indicators) {
          if (consumer.instanceId === old.instanceId) continue;
          for (const [key, ref] of Object.entries(consumer.numericInputs ?? {})) {
            savedReferenceConsumers.set(`${consumer.instanceId}:${key}`, {
              title: consumer.script?.title ?? (consumer.definitionId === COMPOSITION_SMA_ID ? this.compositionSmaTitle(consumer) : consumer.definitionId), ref,
            });
          }
        }
        for (const pin of this.studyHost?.pins() ?? []) {
          if (pin.attachmentId === old.instanceId) continue;
          for (const [key, ref] of Object.entries(pin.numericInputs ?? {})) {
            savedReferenceConsumers.set(`${pin.attachmentId}:${key}`, { title: pin.title, ref });
          }
        }
        try {
          this.outputRegistry.preflightReplacement(replacement, [...savedReferenceConsumers.values()]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.activeIndicators.dataset.error = message;
          this.renderActiveIndicators();
          return message;
        }
      }
    }
    const id = instanceId ?? `sma-${crypto.randomUUID()}`;
    try {
      this.outputRegistry.preflightConsumer(id, ref);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activeIndicators.dataset.error = message;
      this.renderActiveIndicators();
      return message;
    }
    const placementPlan = this.compositionPlacement.planSma({
      instanceId: id,
      source: { instanceId: ref.instanceId, scaleId: currentOutput.scaleId },
      sourcePlacement: source.placement === 'pane' ? 'pane' : 'overlay',
      sourcePaneId: source.paneId ?? view?.paneId ?? ([CVD_ID, OPEN_INTEREST_ID].includes(source.definitionId) ? compositionPaneId(source.instanceId) : undefined),
      sourceTitle: view?.title ?? (source.definitionId === CVD_ID ? nativeDefinition(CVD_ID)?.name ?? 'Multi-Venue CVD'
        : source.definitionId === OPEN_INTEREST_ID ? nativeDefinition(OPEN_INTEREST_ID)?.name ?? 'Open Interest' : this.compositionSmaTitle(source)),
      sourceIsVolume: source.script?.scriptId === 'builtin.volume-histogram',
      existing: old ? { placement: old.placement === 'pane' ? 'pane' : 'overlay', paneId: old.paneId, plotScaleIds: old.plotScaleIds } : undefined,
      changeScale,
    }, this.selection.composition);
    const sma = nativeInstance(COMPOSITION_SMA_ID, { ...settings }, true, {
      instanceId: id, placement: placementPlan.placement, paneId: placementPlan.paneId,
      numericInputs: { source: ref }, plotScaleIds: placementPlan.plotScaleIds,
    });
    const managedCvdPaneId=source.definitionId===CVD_ID&&source.placement==='pane'
      ? source.paneId??compositionPaneId(source.instanceId):undefined;
    const managedOpenInterestPaneId=source.definitionId===OPEN_INTEREST_ID&&source.placement==='pane'
      ? source.paneId??compositionPaneId(source.instanceId):undefined;
    const managedSourcePaneId=managedCvdPaneId??managedOpenInterestPaneId;
    const indicators = old ? this.selection.indicators.map(item => item.instanceId === id ? { ...sma, visible: old.visible } : item)
      : [...this.selection.indicators.map(item=>item.instanceId===source.instanceId&&managedSourcePaneId?{...item,paneId:managedSourcePaneId}:item),sma];
    this.selection = config({ ...this.selection, indicators, composition: placementPlan.composition });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
    delete this.activeIndicators.dataset.error;
    return true;
  }

  private compositionSmaTitle(instance: IndicatorInstance) {
    const length = typeof instance.settings.length === 'number' ? instance.settings.length : 20;
    const ref = instance.numericInputs?.source;
    const provider = ref && this.studyHost?.views().find(view => view.attachmentId === ref.instanceId);
    const nativeProvider=ref&&this.selection.indicators.find(item=>item.instanceId===ref.instanceId);
    const sourceTitle=provider?.title??(nativeProvider?.definitionId===CVD_ID?nativeDefinition(CVD_ID)?.name:undefined)
      ??(nativeProvider?.definitionId===OPEN_INTEREST_ID?nativeDefinition(OPEN_INTEREST_ID)?.name:undefined)
      ??ref?.instanceId??'Unavailable input';
    return `SMA ${length} · ${sourceTitle}`;
  }

  private openCompositionPlacement(instance: IndicatorInstance) {
    const choices = this.selection.composition.panes.filter(pane => pane.id !== instance.paneId && this.compositionPaneIndexForMove(pane) >= 0)
      .map(pane => ({ id: pane.id, title: pane.title }));
    const known = new Set(choices.map(choice => choice.id));
    // Native CVD/Open Interest panes remain opaque until the user explicitly
    // chooses one as a managed destination. Only a live visible adapter is
    // offered; apply adopts it atomically through ManagedCompositionPlacementController.
    for (const target of this.selection.indicators) {
      if (target.instanceId === instance.instanceId || !target.visible || target.placement !== 'pane'
        || target.definitionId !== CVD_ID && target.definitionId !== OPEN_INTEREST_ID) continue;
      const paneId = target.paneId ?? compositionPaneId(target.instanceId);
      if (known.has(paneId) || this.selection.composition.panes.some(pane => pane.id === paneId)) continue;
      if ((this.cvdView?.paneIndex() ?? -1) < 0 && target.definitionId === CVD_ID) continue;
      if ((this.openInterestView?.paneIndex() ?? -1) < 0 && target.definitionId === OPEN_INTEREST_ID) continue;
      choices.push({ id: paneId, title: nativeDefinition(target.definitionId)?.name ?? target.definitionId }); known.add(paneId);
    }
    const currentBand = this.selection.composition.embeddedBands?.find(band => band.memberIds.includes(instance.instanceId));
    const currentHeight = currentBand?.heightPercent ?? DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT;
    const currentLowerBottomBand = Boolean(currentBand && this.selection.composition.plots.some(plot =>
      plot.producerInstanceId === instance.instanceId && plot.paneId !== PRICE_PANE_ID));
    const currentPaneId = instance.placement === 'overlay' ? PRICE_PANE_ID
      : instance.paneId ?? ([CVD_ID, OPEN_INTEREST_ID].includes(instance.definitionId) ? compositionPaneId(instance.instanceId) : undefined);
    this.placementControls.open(instance.instanceId, choices, currentPaneId, currentHeight, currentLowerBottomBand);
  }

  private compositionPaneIndexForMove(pane: IndicatorCompositionState['panes'][number]) {
    for (const id of pane.memberIds) {
      const instance = this.selection.indicators.find(item => item.instanceId === id);
      if (!instance) continue;
      const index = instance.script ? this.studyHost?.paneIndex(id) ?? -1
        : instance.definitionId===CVD_ID?this.cvdView?.paneIndex()??-1
          : instance.definitionId===OPEN_INTEREST_ID?this.openInterestView?.paneIndex()??-1:this.compositionApis.get(id)?.paneIndex??-1;
      if (index >= 0) return index;
    }
    return -1;
  }

  private syncEffortResult() {
    if (!this.engine || this.dead) return;
    const instance = this.nativeIndicator(EFFORT_RESULT_ID);
    if (!instance) { if (this.effortView) this.unbindIndicatorHintRoot(this.effortView.controls.dialog); this.effortView?.dispose(); this.effortView = undefined; return; }
    if (!this.effortView) {
      this.effortView = new EffortView(this.engine.chart, this.feed, this.scheduler, this.notifications,
        settings => this.changeIndicator(instance.instanceId, { settings: effortRecord(settings) }), this.chartFooter);
      this.bindIndicatorHintRoot(this.effortView.controls.dialog, true);
    }
    this.effortView.configure(instance.settings, this.selection, instance.visible);
    this.effortView.setVisible(this.visible);
  }

  private syncMarketConditions() {
    if (!this.engine || this.dead) return;
    const instance = this.nativeIndicator(MARKET_CONDITIONS_ID);
    if (!instance?.visible) { if (this.conditionsView) this.unbindIndicatorHintRoot(this.conditionsView.controls.dialog); this.conditionsView?.dispose(); this.conditionsView = undefined; return; }
    if (!this.conditionsView) {
      this.conditionsView = new ConditionsView(this.engine.chart, this.feed, this.scheduler, this.notifications, this.selection,
        settings => this.changeIndicator(instance.instanceId, { settings: { ...settings } }));
      this.bindIndicatorHintRoot(this.conditionsView.controls.dialog, true);
    }
    this.conditionsView.setVisible(this.visible);
    this.conditionsView.configure(instance.settings, this.selection);
  }

  private syncLiquidations(){
    if(!this.engine||this.dead)return;const instance=this.nativeIndicator(LIQUIDATIONS_ID);
    if(!instance?.visible){this.liquidationsView?.dispose();this.liquidationsView=undefined;return;}
    if(!this.liquidationsView)this.liquidationsView=new LiquidationsView(this.engine.chart,this.feed,this.scheduler,this.selection,settings=>this.changeIndicator(instance.instanceId,{settings:{...settings}}),this.notifications);
    this.liquidationsView.configure(instance.settings,this.selection);this.liquidationsView.setHostCandles(this.candles);this.liquidationsView.setVisible(this.visible);
  }
  private syncCvd() {
    if (!this.engine || this.dead) return;
    const instance=this.nativeIndicator(CVD_ID);
    if(!instance){const pane=this.cvdView?.paneElement();this.cvdView?.dispose();this.cvdView=undefined;if(pane)this.compositionPlacement?.cleanupPaneIfUnshared(pane);this.cvdData?.dispose();this.cvdData=undefined;return;}
    if(!this.cvdData)this.cvdData=new CvdDataController(this.params.api.id,instance.instanceId,this.feed,this.outputRegistry,instance.settings,this.selection);
    else this.cvdData.configure(instance.settings,this.selection);
    this.cvdData.setHostCandles(this.candles);
    this.cvdData.setDataDemand(instance.visible||this.demandedCvdProviders.has(instance.instanceId));
    this.cvdData.setHostVisible(this.visible);
    if(!instance.visible){const pane=this.cvdView?.paneElement();this.cvdView?.dispose();this.cvdView=undefined;if(pane)this.compositionPlacement?.cleanupPaneIfUnshared(pane);return;}
    if(!this.cvdView){
      const paneId=instance.paneId??compositionPaneId(instance.instanceId),paneIndex=this.compositionPlacement?.resolveManagedPaneIndex(paneId,instance.instanceId)??-1;
      const preservePaneLayout=this.selection.composition.panes.some(pane=>pane.id===paneId);
      this.cvdView=new CvdView(this.engine.chart,this.scheduler,this.selection,
        settings=>this.changeIndicator(instance.instanceId,{settings:{...settings}}),this.cvdData,
        unit=>this.cvdOutputScaleId(instance,unit),paneIndex,preservePaneLayout);
    }
    this.cvdView.configure(instance.settings,this.selection);this.cvdView.setHostCandles(this.candles);this.cvdView.setVisible(this.visible);
  }

  private cvdOutputScaleId(instance:IndicatorInstance,unit:'BTC'|'USDT'){
    // Output scales are semantic per-unit identities; pane moves are presentation only.
    const paneId=compositionPaneId(instance.instanceId);
    return numericOutputScaleId(paneId,numericOutputId(instance.instanceId,cvdNumericPlotKey('total',unit)),unit);
  }

  private syncOpenInterest() {
    if (!this.engine || this.dead) return;
    const instance = this.nativeIndicator(OPEN_INTEREST_ID);
    if (!instance) {
      const pane = this.openInterestView?.paneElement(); if (this.openInterestView) this.unbindIndicatorHintRoot(this.openInterestView.controls.dialog); this.openInterestView?.dispose(); this.openInterestView = undefined;
      if (pane) this.compositionPlacement?.cleanupPaneIfUnshared(pane);
      this.openInterestData?.dispose(); this.openInterestData = undefined; this.hiddenOpenInterestControls?.dispose(); this.hiddenOpenInterestControls = undefined;
      return;
    }
    if (!this.openInterestData) this.openInterestData = new OpenInterestDataController(this.params.api.id, instance.instanceId,
      this.feed, this.outputRegistry, instance.settings, this.selection);
    else this.openInterestData.configure(instance.settings, this.selection);
    this.openInterestData.setHostCandles(this.candles);
    this.openInterestData.setDataDemand(instance.visible || this.demandedOpenInterestProviders.has(instance.instanceId));
    this.openInterestData.setHostVisible(this.visible);
    if (!instance.visible) {
      const pane = this.openInterestView?.paneElement(); if (this.openInterestView) this.unbindIndicatorHintRoot(this.openInterestView.controls.dialog); this.openInterestView?.dispose(); this.openInterestView = undefined;
      if (pane) this.compositionPlacement?.cleanupPaneIfUnshared(pane);
      return;
    }
    this.hiddenOpenInterestControls?.dispose(); this.hiddenOpenInterestControls = undefined;
    if (!this.openInterestView) {
      const paneId=instance.paneId??compositionPaneId(instance.instanceId),paneIndex=this.compositionPlacement?.resolveManagedPaneIndex(paneId,instance.instanceId)??-1;
      const preservePaneLayout=this.selection.composition.panes.some(pane=>pane.id===paneId);
      this.openInterestView = new OpenInterestView(this.engine.chart, this.scheduler, this.selection,
        settings => this.changeIndicator(instance.instanceId, { settings: { ...settings } }), this.openInterestData,
        this.openInterestOutputScaleId(instance, OPEN_INTEREST_TOTAL_KEY),paneIndex,preservePaneLayout);
      this.bindIndicatorHintRoot(this.openInterestView.controls.dialog, true);
    }
    this.openInterestView.configure(instance.settings, this.selection); this.openInterestView.setHostCandles(this.candles); this.openInterestView.setVisible(this.visible);
  }

  private queueCompositionSmaRepair(output: ChartNumericOutput) {
    if (this.dead || !output.available || !this.selection.indicators.some(instance => {
      const ref = instance.definitionId === COMPOSITION_SMA_ID ? instance.numericInputs?.source : undefined;
      return Boolean(ref?.outputId === output.outputId && !this.outputRegistry.hasConsumer(instance.instanceId)
        && this.outputRegistry.resolve(ref).available);
    })) return;
    this.pendingCompositionSmaRepairs.add(output.outputId);
    this.scheduleCompositionSmaRepair();
  }

  private scheduleCompositionSmaRepair() {
    if (this.dead || this.compositionSmaRepairQueued || this.compositionSmaRepairRunning) return;
    this.compositionSmaRepairQueued = true;
    queueMicrotask(() => {
      this.compositionSmaRepairQueued = false;
      if (this.dead) { this.pendingCompositionSmaRepairs.clear(); return; }
      const outputIds = new Set(this.pendingCompositionSmaRepairs); this.pendingCompositionSmaRepairs.clear();
      this.repairMissingCompositionSmaBindings(outputIds);
    });
  }

  /** Recreate only ready SMA consumers detached by an upstream context reset. */
  private repairMissingCompositionSmaBindings(outputIds?: ReadonlySet<string>) {
    if (this.dead || this.compositionSmaRepairRunning) return;
    this.compositionSmaRepairRunning = true;
    try {
    const smas = new Map(this.selection.indicators.filter(instance => instance.definitionId === COMPOSITION_SMA_ID)
      .map(instance => [instance.instanceId, instance]));
    const affected = [...smas.values()].filter(instance => {
      const ref = instance.numericInputs?.source;
      return Boolean(ref && (!outputIds || outputIds.has(ref.outputId)) && !this.outputRegistry.hasConsumer(instance.instanceId)
        && this.outputRegistry.resolve(ref).available);
    });
    if (!affected.length) return;
    const depth = (instance: IndicatorInstance, seen = new Set<string>()): number => {
      if (seen.has(instance.instanceId)) return 0;
      seen.add(instance.instanceId);
      const providerId = instance.numericInputs?.source?.instanceId, provider = providerId ? smas.get(providerId) : undefined;
      return provider ? 1 + depth(provider, seen) : 0;
    };
    affected.sort((a, b) => depth(a) - depth(b));
    for (const instance of affected) {
      if (this.dead || this.outputRegistry.hasConsumer(instance.instanceId)) continue;
      const ref = instance.numericInputs?.source;
      if (!ref || !this.outputRegistry.resolve(ref).available) continue;
      this.syncCompositionSma(instance, { recreateDetachedConsumer: true });
      this.outputRegistry.setConsumerActive(instance.instanceId, this.demandedCompositionSmaConsumers.has(instance.instanceId));
    }
    } finally {
      this.compositionSmaRepairRunning = false;
      if (this.pendingCompositionSmaRepairs.size) this.scheduleCompositionSmaRepair();
    }
  }

  private openInterestOutputScaleId(instance: IndicatorInstance, plotKey: string) {
    return numericOutputScaleId(compositionPaneId(instance.instanceId), numericOutputId(instance.instanceId, plotKey), 'BTC');
  }

  private syncOrderFlowPane() {
    const chart = this.engine?.chart, cvd = this.nativeIndicator(CVD_ID), openInterest = this.nativeIndicator(OPEN_INTEREST_ID);
    const pane = chart && cvd && openInterest && cvd.placement === 'pane' && openInterest.placement === 'pane'
      ? this.selection.composition.panes.find(item => item.memberIds.includes(cvd.instanceId) && item.memberIds.includes(openInterest.instanceId)
        && (cvd.paneId ?? compositionPaneId(cvd.instanceId)) === item.id && (openInterest.paneId ?? compositionPaneId(openInterest.instanceId)) === item.id)
      : undefined;
    if (!chart || !pane) { this.disposeOrderFlowPane(); return; }
    const members = new Set(pane.memberIds.filter(id => {
      const instance = this.selection.indicators.find(item => item.instanceId === id);
      if (!instance || instance.placement !== 'pane' || (instance.paneId ?? compositionPaneId(instance.instanceId)) !== pane.id) return false;
      return true;
    }));
    const studies = this.studyHost?.views() ?? [];
    const anyVisible = [...members].some(id => {
      const instance = this.selection.indicators.find(item => item.instanceId === id);
      if (!instance) return false;
      return instance.script ? studies.find(study => study.attachmentId === id)?.visible ?? instance.visible : instance.visible;
    });
    const paneIndex = this.compositionPlacement?.resolveManagedPaneIndex(pane.id) ?? -1;
    if (!anyVisible || paneIndex < 0 || !chart.panes()[paneIndex]) { this.disposeOrderFlowPane(); return; }
    this.orderFlowPaneId = pane.id; this.orderFlowPaneIndex = paneIndex;
    this.orderFlowMembersByPane = new Map([[paneIndex, members]]);
    this.cvdView?.setCombinedChrome(members.has(cvd?.instanceId ?? '') && this.cvdView.paneIndex() === paneIndex);
    this.openInterestView?.setCombinedChrome(members.has(openInterest?.instanceId ?? '') && this.openInterestView.paneIndex() === paneIndex);
    if (!this.orderFlowPaneView) {
      this.orderFlowPaneView = new OrderFlowPaneView(chart, this.chart, this.scheduler, time => this.orderFlowPaneState(time), {
        setCvdMode: mode => {
          const current = this.nativeIndicator(CVD_ID); if (!current) return;
          this.changeIndicator(current.instanceId, { settings: { ...cvdSettings(current.settings), mode } });
        },
        openCvdSettings: () => { const current = this.nativeIndicator(CVD_ID); if (current) this.openIndicatorSettings(current); },
        openOpenInterestSettings: () => { const current = this.nativeIndicator(OPEN_INTEREST_ID); if (current) this.openIndicatorSettings(current); },
        toggleLine: row => this.toggleOrderFlowLine(row),
        paneAction: (action, index) => this.applyPaneHeaderAction(action, index),
        indicatorAction: event => { void this.indicatorAction(event); },
        indicatorContextMenu: event => this.indicatorContextMenu(event),
      });
    }
    if (this.orderFlowCvdData !== this.cvdData) {
      this.releaseOrderFlowCvdData?.(); this.releaseOrderFlowCvdData = this.cvdData?.subscribe(() => this.orderFlowPaneView?.invalidate());
      this.orderFlowCvdData = this.cvdData;
    }
    if (this.orderFlowOpenInterestData !== this.openInterestData) {
      this.releaseOrderFlowOpenInterestData?.(); this.releaseOrderFlowOpenInterestData = this.openInterestData?.subscribe(() => this.orderFlowPaneView?.invalidate());
      this.orderFlowOpenInterestData = this.openInterestData;
    }
    this.orderFlowPaneView.setPane(paneIndex); this.orderFlowPaneView.setVisible(this.visible); this.orderFlowPaneView.invalidate();
  }

  private disposeOrderFlowPane() {
    this.cvdView?.setCombinedChrome(false); this.openInterestView?.setCombinedChrome(false);
    this.releaseOrderFlowCvdData?.(); this.releaseOrderFlowCvdData = undefined; this.orderFlowCvdData = undefined;
    this.releaseOrderFlowOpenInterestData?.(); this.releaseOrderFlowOpenInterestData = undefined; this.orderFlowOpenInterestData = undefined;
    this.orderFlowPaneView?.dispose(); this.orderFlowPaneView = undefined;
    this.orderFlowPaneId = undefined; this.orderFlowPaneIndex = -1; this.orderFlowMembersByPane.clear();
  }

  private toggleOrderFlowLine(row: OrderFlowRow) {
    if (row.source === 'cvd') {
      const instance = this.nativeIndicator(CVD_ID); if (!instance) return;
      const settings = cvdSettings(instance.settings), hidden = settings.hidden.includes(row.id)
        ? settings.hidden.filter(id => id !== row.id) : [...settings.hidden, row.id];
      this.changeIndicator(instance.instanceId, { settings: { ...settings, hidden } });
    } else if (row.source === 'open-interest') {
      const instance = this.nativeIndicator(OPEN_INTEREST_ID); if (!instance) return;
      const settings = openInterestSettings(instance.settings), hidden = settings.hidden.includes(row.id)
        ? settings.hidden.filter(id => id !== row.id) : [...settings.hidden, row.id];
      this.changeIndicator(instance.instanceId, { settings: { ...settings, hidden } });
    }
  }

  private orderFlowPaneState(time?: number): OrderFlowPaneState {
    const members = this.orderFlowMembersByPane.get(this.orderFlowPaneIndex) ?? new Set<string>();
    const instances = this.selection.indicators, cvd = instances.find(item => item.definitionId === CVD_ID);
    const openInterest = instances.find(item => item.definitionId === OPEN_INTEREST_ID);
    const readTime = time ?? this.candles.at(-1)?.t;
    const rows: OrderFlowRow[] = [], summary: string[] = [];
    const hasCvd = Boolean(cvd && members.has(cvd.instanceId)), hasOpenInterest = Boolean(openInterest && members.has(openInterest.instanceId));
    let hasVolume = false, volumeBandHeightPercent: number | undefined;
    if (hasCvd && cvd?.visible && this.cvdData) {
      const cvdTime = readTime ?? 0;
      for (const line of this.cvdData.readoutAt(cvdTime)) rows.push({ key: `cvd:${line.id}`, source: 'cvd', id: line.id,
        name: line.name, value: line.value, unit: line.unit, color: line.color || 'var(--text)', scale: 'L', hidden: line.hidden,
        canToggle: true, detail: `${line.filtered ? 'Filtered markets · ' : ''}executed signed flow${line.partial ? ' · partial' : ''}`,
        quality: line.partial ? 'partial' : 'complete' });
      summary.push(this.cvdData.coverageSummary());
    }
    if (hasOpenInterest && openInterest?.visible && this.openInterestData) {
      const settings = this.openInterestData.settingsSnapshot(), readout = this.openInterestData.readoutAt(readTime ?? 0);
      const venueColors: Record<string, string> = { total: 'var(--text)', binance: '#d9ae63', hyperliquid: '#82a7d8', bybit: '#86b17b' };
      for (const line of readout.lines) rows.push({ key: `oi:${line.id}`, source: 'open-interest', id: line.id,
        name: line.id === 'total' ? 'Total' : line.name, value: line.value, unit: line.unit ?? 'BTC',
        color: venueColors[line.id] ?? 'var(--text)', scale: 'R', hidden: line.hidden, canToggle: true,
        detail: `${line.ageMs === null ? 'No current observation' : `${formatAge(line.ageMs)} old`} · raw level${line.quality === 'partial' ? ' · partial' : ''}`,
        quality: line.quality });
      const oiStatus = !settings.venues.length ? 'Choose at least one exchange.'
        : readout.frame.quality === 'complete' ? readout.frame.truncated ? 'Some earlier data may be missing.' : ''
          : readout.frame.quality === 'partial' ? `Some exchange data is missing.${readout.frame.truncated ? ' Earlier data may also be missing.' : ''}`
            : readout.frame.quality === 'stale' ? 'Updates paused.' : 'Data unavailable.';
      if (oiStatus) summary.push(oiStatus);
    }
    for (const instance of instances) {
      if (!members.has(instance.instanceId) || !instance.visible || !instance.script) continue;
      const view = this.studyHost?.views().find(item => item.attachmentId === instance.instanceId);
      if (!view?.visible || view.scriptId !== 'builtin.volume-histogram') continue;
      const output = this.outputRegistry.get(numericOutputId(instance.instanceId, 'p0'));
      if (!output) continue;
      hasVolume = true;
      volumeBandHeightPercent = this.selection.composition.embeddedBands.find(band => band.memberIds.includes(instance.instanceId))?.heightPercent;
      rows.push({ key: `volume:${instance.instanceId}:p0`, source: 'volume', id: instance.instanceId, name: 'Volume',
        value: numericOutputValueAt(output.times, output.values, readTime), unit: output.unit ?? 'BTC', color: '#55c8bd', scale: 'V',
        detail: 'Candle traded volume · zero-based lower band', quality: output.quality });
    }
    for (const instance of instances) {
      if (!members.has(instance.instanceId) || !instance.visible || instance.definitionId !== COMPOSITION_SMA_ID) continue;
      const output = this.outputRegistry.outputsForOwner(instance.instanceId).find(item => item.plotKey === 'p0');
      if (!output) continue;
      const scale = this.orderFlowScaleForSma(instance, instances);
      if (!scale) continue;
      rows.push({ key: `sma:${instance.instanceId}`, source: 'sma', id: instance.instanceId,
        name: `SMA ${typeof instance.settings.length === 'number' ? instance.settings.length : 20}`,
        value: numericOutputValueAt(output.times, output.values, readTime), unit: output.unit, color: '#c6a4e8', scale,
        detail: `${output.title} · ${output.quantity} · ${output.quality}${output.available ? '' : ' · unavailable'}`, quality: output.quality });
    }
    return { paneIndex: this.orderFlowPaneIndex, rows, summary: summary.join(' · '),
      cvdMode: hasCvd ? cvdSettings(cvd?.settings).mode : undefined, hasCvd, hasOpenInterest, hasVolume, volumeBandHeightPercent };
  }

  private orderFlowScaleForSma(instance: IndicatorInstance, instances: readonly IndicatorInstance[]): 'L' | 'R' | 'V' | undefined {
    let ref = instance.numericInputs?.source;
    for (let depth = 0; ref && depth < 3; depth++) {
      const provider = instances.find(item => item.instanceId === ref!.instanceId);
      if (provider?.definitionId === CVD_ID) return 'L';
      if (provider?.definitionId === OPEN_INTEREST_ID) return 'R';
      if (provider?.script?.scriptId === 'builtin.volume-histogram') return 'V';
      if (provider?.definitionId !== COMPOSITION_SMA_ID) return undefined;
      ref = provider.numericInputs?.source;
    }
    return undefined;
  }

  private syncTradeBubbles() {
    if (!this.engine || this.dead) return;
    const instance = this.nativeIndicator(TRADE_BUBBLES_ID);
    if (!instance) {
      this.tradeBubblesView?.dispose(); this.tradeBubblesView = undefined;
      return;
    }
    if (!this.tradeBubblesView) this.tradeBubblesView = new TradeBubblesView(
      this.chart, this.engine.chart, this.feed, this.selection,
      settings => this.changeIndicator(instance.instanceId, { settings: { ...settings } }),
      this.tickerTierSources, `${this.params.api.id}:${instance.instanceId}`,
    );
    this.tradeBubblesView.configure(instance.settings, this.selection);
    this.tradeBubblesView.setVisible(instance.visible);
    this.tradeBubblesView.setHostVisible(this.visible);
  }

  private syncDailyVwap() {
    if (!this.engine || this.dead) return;
    const instance = this.nativeIndicator(DAILY_VWAP_ID);
    this.engine.setDailyVwap(instance?.visible ? dailyVwapSettings(instance.settings) : null, duration[this.selection.interval] / 1000);
  }

  private syncNativeIndicators() {
    if (!this.engine || this.dead) return;
    this.syncDailyVwap(); this.syncCvd(); this.syncLiquidations(); this.syncTradeBubbles();
    const oldMode = this.engine.displayMode;
    this.applyFootprintOptions(); this.engine.setBasePriceVisible(this.selection.basePriceVisible);
    this.engine.setDisplayMode(this.selection.type, true);
    this.syncMarketConditions();
    this.syncEffortResult();
    this.syncFootprintTotals();
    this.subscribeFootprint();
    if (oldMode !== this.selection.type && this.selection.type === 'footprint') {
      this.engine.setFootprintBars(this.footprintBars, true); this.footprintNeedsSync = false;
      this.focusFootprintOnce();
    }
    this.syncHeatmap(); this.syncOrderWalls(); this.hoveredBar = null; this.hoveredFootprint = null;
    this.syncNetPositioning();
    this.syncTpo();
    this.updateFootprintControls(); this.refreshFootprintCellTooltip(); this.updateStatus();
  }

  private footprintDataWanted() {
    return supportsDepth(this.selection) && Boolean(
      this.nativeIndicator(FOOTPRINT_ID)?.visible && this.selection.type === 'footprint'
      || this.nativeIndicator(FOOTPRINT_TOTALS_ID)?.visible && this.selection.type === 'footprint'
      || this.visible && !document.hidden && this.selection.indicators.some(i=>i.visible&&i.settingsVersion===1&&i.source.kind==='chart'&&NET_POSITIONING_IDS.includes(i.definitionId as typeof NET_POSITIONING_IDS[number])),
    );
  }

  private syncFootprintTotals() {
    const instance = this.nativeIndicator(FOOTPRINT_TOTALS_ID);
    if (!instance?.visible || !supportsDepth(this.selection) || this.selection.type !== 'footprint' || !this.engine) {
      if (this.positioningTooltip.classList.contains('footprint-totals-tooltip')) this.positioningTooltip.hidden = true;
      this.engine?.removeFootprintTotalsPane(FOOTPRINT_TOTALS_ID);
      return;
    }
    const settings = footprintTotalsSettings(instance.settings);
    this.engine.addFootprintTotalsPane(FOOTPRINT_TOTALS_ID, settings.rows, this.displayFootprintUnits, settings.highlightHighest, {
      enabled: settings.highlightDeltaFlips, target: settings.deltaFlipTarget, lookback: settings.deltaFlipLookback,
      minimumStrength: settings.deltaFlipMinimumStrength, showLivePreview: settings.showDeltaFlipLivePreview,
    });
  }

  private tpoSettings(instance = this.nativeIndicator(TPO_ID)): TpoIndicatorSettings {
    const tickSize = this.selection.venue === 'binance' && marketOf(this.selection) === 'spot' ? .01 : .1;
    return tpoIndicatorSettings(instance?.settings ?? DEFAULT_TPO_INDICATOR_SETTINGS, tickSize);
  }

  private syncTpo() {
    const instance = this.nativeIndicator(TPO_ID), wanted = Boolean(instance?.visible && this.visible && this.engine);
    const settings = this.tpoSettings(instance);
    this.engine?.setTpo(wanted ? settings : null);
    if (!wanted) {
      this.releaseTpo?.(); this.releaseTpo = undefined; this.tpoGeneration++;
      this.tpoSubscriptionKey = ''; this.tpoSettingsKey = '';
      this.tpoControls?.setStatus(this.tpoStatus);
      return;
    }
    const sourceKey = tpoSourceKey(this.selection), settingsKey = tpoCalculationKey(settings);
    const sourceChanged = this.tpoSubscriptionKey !== sourceKey;
    if (sourceChanged) {
      this.tpoSessions.clear(); this.tpoNaked = [];
      this.engine?.setTpoSnapshot([], [], 0);
    } else this.engine?.setTpoSnapshot([...this.tpoSessions.values()], this.tpoNaked, this.tpoStatus?.coverageTo ?? 0);
    if (!sourceChanged && this.releaseTpo) {
      if (this.tpoSettingsKey === settingsKey) return;
      this.tpoSettingsKey = settingsKey;
      this.feed.updateTpo(this.params.api.id, settings);
      return;
    }
    this.releaseTpo?.(); this.releaseTpo = undefined;
    this.tpoSubscriptionKey = sourceKey; this.tpoSettingsKey = settingsKey;
    this.tpoStatus = { state: 'loading', message: 'Loading UTC 1-minute history…', coverageFrom: 0, coverageTo: 0, expectedMinutes: 0, observedMinutes: 0, missingMinutes: 0, cacheHits: 0, pagesFetched: 0, retentionLimited: false };
    this.tpoControls.setStatus(this.tpoStatus);
    this.renderActiveIndicators();
    const generation = ++this.tpoGeneration;
    this.releaseTpo = this.feed.subscribeTpo(this.params.api.id, this.selection, settings, event => {
      if (this.dead || generation !== this.tpoGeneration || !this.nativeIndicator(TPO_ID)?.visible) return;
      this.tpoStatus = event.status; this.tpoControls.setStatus(event.status);
      if (event.type === 'tpo-status') { this.renderActiveIndicators(); return; }
      if (event.type === 'tpo-snapshot') {
        this.tpoSessions = new Map(event.sessions.map(session => [session.day, session]));
        this.tpoNaked = event.nakedLevels;
        this.engine?.setTpoSnapshot(event.sessions, event.nakedLevels, event.status.coverageTo);
      } else {
        for (const session of event.sessions) this.tpoSessions.set(session.day, session);
        this.tpoNaked = event.nakedLevels;
        this.engine?.patchTpo(event.sessions, event.nakedLevels, event.status.coverageTo);
      }
      this.renderActiveIndicators();
    });
  }

  private changeTpo(instanceId: string, settings: TpoIndicatorSettings) {
    if (!this.selection.indicators.some(item => item.instanceId === instanceId && item.definitionId === TPO_ID)) return;
    this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(item => item.instanceId === instanceId ? { ...item, settings: tpoIndicatorSettings(settings) } : item) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private changeFootprintTotals(instanceId: string, settings: FootprintTotalsSettings) {
    this.cancelIndicatorTooltip();
    if (!this.selection.indicators.some(item => item.instanceId === instanceId && item.definitionId === FOOTPRINT_TOTALS_ID)) return;
    this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(item => item.instanceId === instanceId
      ? { ...item, settings: footprintTotalsSettings(settings) } : item) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private changeNetPositioning(instanceId: string, settings: NetPositioningSettings) {
    this.cancelIndicatorTooltip();
    if (!this.selection.indicators.some(item => item.instanceId === instanceId && NET_POSITIONING_IDS.includes(item.definitionId as typeof NET_POSITIONING_IDS[number]))) return;
    this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(item => item.instanceId === instanceId ? { ...item, settings: { ...settings, venues: [...settings.venues] } } : item) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private syncNetPositioning() {
    const engine = this.engine;
    if (!engine || this.dead) return;
    this.positioningRangeHit=null;engine.setPositioningRange(null);
    this.subscribeFootprint();
    engine.onNetPositioningVenueToggle = (id, venue) => {
      const instance = this.selection.indicators.find(item => item.instanceId === id);
      if (!instance) return;
      const settings = netPositioningSettings(instance.settings);
      const venues = settings.venues.includes(venue) ? settings.venues.filter(item => item !== venue) : [...settings.venues, venue];
      this.changeNetPositioning(id, { ...settings, venues });
    };
    const active = this.selection.indicators.filter(instance => instance.visible && instance.settingsVersion === 1
      && instance.source.kind === 'chart' && NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number]));
    const activeIds = new Set(active.map(instance => instance.instanceId));
    for (const id of NET_POSITIONING_IDS) if (!activeIds.has(id)) engine.removeNetPositioningPane(id);

    const intervalMs = duration[this.selection.interval];
    const venues = [...new Set(active.flatMap(instance => netPositioningSettings(instance.settings).venues))] as NetPositioningVenue[];
    const methods = [...new Set(active.map(instance => netPositioningSettings(instance.settings).method))] as NetPositioningMethod[];
    for (const method of methods) {
      let history = this.netPositioningHistories.get(method);
      if (!history) this.netPositioningHistories.set(method, history = new NetPositioningHistory(method, intervalMs));
      history.setCandleInterval(intervalMs, venues);
    }

    for (const instance of active) {
      const settings = netPositioningSettings(instance.settings);
      const side = instance.definitionId === NET_LONGS_ID ? 'longs' : 'shorts';
      engine.addNetPositioningPane(instance.instanceId, side, settings.method, settings.venues, intervalMs, settings.display, settings.labels, settings.colors);
      const history = this.netPositioningHistories.get(settings.method)!;
      const payload = history.metadata();
      engine.setNetPositioningSnapshot(instance.instanceId, history.snapshot(), payload?.feeds ?? {}, payload?.unitVerification ?? {}, payload?.pendingIntervals ?? 0, this.netPositioningErrors.get(settings.method) ?? '');
    }

    const requestKey = methods.length && venues.length ? JSON.stringify({ methods: methods.sort(), venues: venues.sort() }) : '';
    if (!this.visible || document.hidden || !requestKey) {
      if (this.releaseNetPositioning) { this.releaseNetPositioning(); this.releaseNetPositioning = undefined; this.netPositioningGeneration++; }
      this.netPositioningRequestKey = '';
      return;
    }
    if (requestKey === this.netPositioningRequestKey && this.releaseNetPositioning) return;
    this.releaseNetPositioning?.(); this.releaseNetPositioning = undefined;
    const generation = ++this.netPositioningGeneration;
    this.netPositioningRequestKey = requestKey;
    const request = { methods, venues };
    this.releaseNetPositioning = this.feed.subscribeNetPositioning(this.params.api.id, request, event => {
      if (this.dead || generation !== this.netPositioningGeneration) return;
      if (event.type === 'net-positioning-error') {
        const wasLoading = !this.netPositioningHistories.get(event.method)?.metadata() && !this.netPositioningErrors.has(event.method);
        this.netPositioningErrors.set(event.method, event.message);
        this.renderNetPositioningMethod(event.method, [], false);
        if (wasLoading) this.renderActiveIndicators();
        return;
      }
      const history = this.netPositioningHistories.get(event.payload.method);
      if (!history) return;
      const wasLoading = !history.metadata() && !this.netPositioningErrors.has(event.payload.method);
      this.netPositioningErrors.delete(event.payload.method);
      if (event.type === 'net-positioning-snapshot') {
        history.replace(event.payload, venues);
        this.renderNetPositioningMethod(event.payload.method, history.snapshot(), true);
      } else {
        const changed = history.apply(event.payload, event.intervals, venues);
        this.renderNetPositioningMethod(event.payload.method, changed, false);
      }
      if (wasLoading) this.renderActiveIndicators();
    });
  }

  private renderNetPositioningMethod(method: NetPositioningMethod, changed: ReturnType<NetPositioningHistory['snapshot']>, snapshot: boolean) {
    const history = this.netPositioningHistories.get(method); if (!history || !this.engine) return;
    const payload = history.metadata(), feeds = payload?.feeds ?? {}, units = payload?.unitVerification ?? {}, pending = payload?.pendingIntervals ?? 0;
    for (const instance of this.selection.indicators) {
      if (!instance.visible || instance.settingsVersion !== 1 || instance.source.kind !== 'chart' || !NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])) continue;
      if (netPositioningSettings(instance.settings).method !== method) continue;
      const error = this.netPositioningErrors.get(method) ?? '';
      if (snapshot) this.engine.setNetPositioningSnapshot(instance.instanceId, changed, feeds, units, pending, error);
      else this.engine.patchNetPositioning(instance.instanceId, changed, feeds, units, pending, error);
    }
    this.syncPaneLoadingStates();
  }

  private changeIndicator(instanceId: string, change: Partial<Pick<IndicatorInstance, 'visible' | 'settings'>>) {
    this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear();
    delete this.activeIndicators.dataset.error; this.indicatorErrors.delete(instanceId);
    const instance = this.selection.indicators.find(i => i.instanceId === instanceId);
    const footprintMode = instance?.definitionId === FOOTPRINT_ID && typeof change.visible === 'boolean'
      ? { type: change.visible ? 'footprint' as const : 'candle' as const }
      : {};
    this.selection = config({ ...this.selection, ...footprintMode, indicators: this.selection.indicators.map(i => i.instanceId === instanceId ? { ...i, ...change } : i) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private addNativeIndicator(definitionId: string) {
    const definition = nativeDefinition(definitionId); if (!definition) return;
    const existing = this.selection.indicators.find(i => i.definitionId === definitionId);
    if (!existing) {
      const settings = definitionId === OPEN_INTEREST_ID ? { ...openInterestSettings(undefined) }
        : NET_POSITIONING_IDS.includes(definitionId as typeof NET_POSITIONING_IDS[number])
        ? { method: 'price-oi' as const, venues: [this.selection.venue === 'hyperliquid' ? 'hyperliquid' as const : 'binance' as const], display: 'stacked' as const, labels: 'auto' as const }
        : definitionId === EFFORT_RESULT_ID ? effortRecord(DEFAULT_EFFORT)
        : definitionId === LIQUIDATIONS_ID ? {...liquidationSettings(undefined)}
        : definitionId === CVD_ID ? { ...cvdSettings(undefined) }
        : definitionId === TRADE_BUBBLES_ID ? { ...tradeBubbleSettings(undefined) }
        : definitionId === DAILY_VWAP_ID ? { ...DEFAULT_DAILY_VWAP }
        : definitionId === MARKET_CONDITIONS_ID ? { ...DEFAULT_CONDITIONS }
        : definitionId === FOOTPRINT_TOTALS_ID ? { ...DEFAULT_FOOTPRINT_TOTALS_SETTINGS }
        : definitionId === FOOTPRINT_ID ? { rowPrice: this.selection.rowPrice, units: this.selection.footprintUnits, view: this.selection.footprint }
        : definitionId === TPO_ID ? { ...DEFAULT_TPO_INDICATOR_SETTINGS, tickSize: this.selection.venue === 'binance' && marketOf(this.selection) === 'spot' ? .01 : .1 }
        : definitionId === HEATMAP_ID ? { ...this.selection.heatmap, enabled: true }
          : { ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true };
      const paneId = definitionId === CVD_ID || definitionId === OPEN_INTEREST_ID ? compositionPaneId(definitionId) : undefined;
      const added = nativeInstance(definitionId, settings, true, paneId ? { paneId } : {});
      const composition = definitionId === OPEN_INTEREST_ID && paneId
        ? this.compositionPlacement.registerMember(this.selection.composition, { instanceId: added.instanceId,
          title: nativeDefinition(definitionId)?.name ?? 'Open Interest', placement: 'pane', paneId })
        : this.selection.composition;
      this.selection = config({ ...this.selection, indicators: [...this.selection.indicators, added], composition });
      this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
      this.renderPicker(`${definition.name} added with its default settings.`);
    } else {
      this.picker.close(); this.openIndicatorSettings(existing);
    }
  }

  private openIndicatorSettings(instance: IndicatorInstance) {
    if (instance.settingsVersion !== (nativeDefinition(instance.definitionId)?.settingsVersion ?? 1)) return;
    if (instance.definitionId === COMPOSITION_SMA_ID) { this.openCompositionSma(undefined, instance); return; }
    if (instance.definitionId === TRADE_BUBBLES_ID) { this.tradeBubblesView?.openSettings(); return; }
    if (instance.definitionId === LIQUIDATIONS_ID) {if(this.liquidationsView)this.liquidationsView.openSettings();else{this.hiddenLiquidationControls?.dispose();const controls=new LiquidationControls(this.element,settings=>this.changeIndicator(instance.instanceId,{settings:{...settings}}),'chart');this.hiddenLiquidationControls=controls;controls.dialog.addEventListener('close',()=>{controls.dispose();if(this.hiddenLiquidationControls===controls)this.hiddenLiquidationControls=undefined;},{once:true});controls.open(liquidationSettings(instance.settings));}return;}
    if (instance.definitionId === CVD_ID) {
      if(this.cvdView)this.cvdView.openSettings();
      else {
        if(this.hiddenCvdControls)this.unbindIndicatorHintRoot(this.hiddenCvdControls.dialog);
        this.hiddenCvdControls?.dispose();
        const controls=new CvdControls(settings=>this.changeIndicator(instance.instanceId,{settings:{...settings}}),this.abort.signal);
        this.hiddenCvdControls=controls;document.body.append(controls.dialog);
        this.bindIndicatorHintRoot(controls.dialog,true);
        controls.dialog.addEventListener('close',()=>{this.unbindIndicatorHintRoot(controls.dialog);controls.dispose();if(this.hiddenCvdControls===controls)this.hiddenCvdControls=undefined;},{once:true});
        controls.open(cvdSettings(instance.settings),[]);
      }
      return;
    }
    if (instance.definitionId === OPEN_INTEREST_ID) {
      if (this.openInterestView) this.openInterestView.openSettings();
      else {
        this.hiddenOpenInterestControls?.dispose();
        const controls = new OpenInterestControls(settings => this.changeIndicator(instance.instanceId, { settings: { ...settings } }), this.abort.signal);
        this.hiddenOpenInterestControls = controls; this.element.append(controls.dialog);
        controls.dialog.addEventListener('close', () => { controls.dispose(); if (this.hiddenOpenInterestControls === controls) this.hiddenOpenInterestControls = undefined; }, { once: true });
        controls.open(openInterestSettings(instance.settings));
      }
      return;
    }
    if (instance.definitionId === DAILY_VWAP_ID) { this.vwapControls.open(instance.instanceId, dailyVwapSettings(instance.settings)); return; }
    if (instance.definitionId === EFFORT_RESULT_ID) { this.effortView?.openSettings(); return; }
    if (instance.definitionId === MARKET_CONDITIONS_ID) {
      if (this.conditionsView) this.conditionsView.openSettings();
      else {
        if(this.hiddenConditionsControls)this.unbindIndicatorHintRoot(this.hiddenConditionsControls.dialog);
        this.hiddenConditionsControls?.dispose();
        const controls = new ConditionsControls(settings => this.changeIndicator(instance.instanceId, { settings: { ...settings } }));
        this.hiddenConditionsControls = controls; document.body.append(controls.dialog);
        this.bindIndicatorHintRoot(controls.dialog,true);
        controls.dialog.addEventListener('close', () => { this.unbindIndicatorHintRoot(controls.dialog); controls.dispose(); if (this.hiddenConditionsControls === controls) this.hiddenConditionsControls = undefined; }, { once: true });
        controls.open(conditionsSettings(instance.settings));
      }
    }
    else if (instance.definitionId === FOOTPRINT_ID) this.openFootprintSettings();
    else if (instance.definitionId === FOOTPRINT_TOTALS_ID) this.footprintTotalsControls.open(instance.instanceId, footprintTotalsSettings(instance.settings));
    else if (instance.definitionId === TPO_ID) this.tpoControls.open(instance.instanceId, this.tpoSettings(instance), this.tpoSettings(instance).tickSize);
    else if (instance.definitionId === HEATMAP_ID) this.heatmapControls.open();
    else if (instance.definitionId === ORDER_WALLS_ID) this.orderWallsControls.open(orderWallsSettings(instance.settings));
    else if (NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])) this.netPositioningControls.open(instance.instanceId, netPositioningSettings(instance.settings));
    else if (instance.script) void this.openAttachmentSettings(instance.instanceId);
  }

  private async indicatorAction(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-indicator-action]');
    if (!button || button.disabled || this.dead) return;
    const instance = this.selection.indicators.find(i => i.instanceId === button.dataset.instanceId); if (!instance) return;
    const action = button.dataset.indicatorAction;
    if (action === 'history' && instance.definitionId === EFFORT_RESULT_ID) this.effortView?.openHistory();
    else if (action === 'settings') this.openIndicatorSettings(instance);
    else if (action === 'add-sma') this.openCompositionSma(instance.instanceId);
    else if (action === 'move') this.openCompositionPlacement(instance);
    else if (action === 'visibility') {
      this.changeIndicator(instance.instanceId, { visible: !instance.visible });
    } else if (action === 'remove') {
      this.removeIndicatorInstance(instance.instanceId);
    } else if (action === 'source' && instance.script) this.openEditor(this.params.api.id, instance.instanceId);
    else if (action === 'duplicate' && instance.script && this.studyHost) {
      button.disabled = true;
      try {
        const pin = instance.script, revision = await this.library.getRevision(pin.scriptId, pin.revisionId);
        if (!revision || this.dead) throw new Error('The pinned source is unavailable. Reimport it before duplicating.');
        const duplicateId = await this.studyHost.apply({ ...pin, attachmentId: undefined, source: revision.source,
          settings: { ...instance.settings } as StudyPin['settings'], visible: instance.visible });
        const liveSource = this.selection.indicators.find(item => item.instanceId === instance.instanceId) ?? instance;
        const targetPaneId = liveSource.paneId ?? PRICE_PANE_ID;
        const targetPlacement = liveSource.placement === 'pane' ? 'pane' as const : 'overlay' as const;
        const targetIndex = targetPlacement === 'overlay' ? this.engine?.chart.primaryPaneIndex() ?? -1
          : this.studyHost.paneIndex(liveSource.instanceId);
        const duplicateView = this.studyHost.views().find(view => view.attachmentId === duplicateId);
        const duplicateIndex = this.studyHost.paneIndex(duplicateId);
        const aligned = Boolean(duplicateView && targetIndex >= 0 && (duplicateIndex !== targetIndex
          || duplicateView.placement !== targetPlacement || duplicateView.paneId !== targetPaneId)
          && this.studyHost.moveStudy(duplicateId, targetPlacement, targetPaneId, targetIndex, { silent: true }));
        const composition = this.compositionPlacement.registerMember(this.selection.composition, {
          instanceId: duplicateId, title: liveSource.script?.title ?? pin.title,
          placement: targetPlacement, paneId: targetPaneId, bandSourceId: liveSource.instanceId,
        });
        if (composition !== this.selection.composition || aligned) {
          this.selection = config({ ...this.selection, composition });
          this.params.api.updateParameters(this.selection);
          if (aligned) this.studyHost.commitPlacementChanges(); else this.save();
        }
      } catch (error) { this.activeIndicators.dataset.error = errorText(error); this.renderActiveIndicators(); }
      finally { button.disabled = false; }
    }
  }

  private indicatorContextMenu(event: MouseEvent) {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.active-indicator');
    const instance = row?.dataset.instanceId ? this.selection.indicators.find(item => item.instanceId === row.dataset.instanceId) : undefined;
    if (!instance) return;
    if (instance.definitionId === COMPOSITION_SMA_ID) {
      event.preventDefault(); event.stopPropagation(); this.openCompositionSma(undefined, instance); return;
    }
    if (instance.script && this.compositionOutputChoices(instance.instanceId).some(choice => choice.output.available)) {
      event.preventDefault(); event.stopPropagation(); this.openCompositionSma(instance.instanceId);
    }
  }

  private paneHeaderAction(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-pane-action]');
    if (!button) return false;
    event.stopPropagation();
    if (button.disabled || this.dead) return true;
    this.applyPaneHeaderAction(button.dataset.paneAction ?? '', Number(button.dataset.paneIndex));
    return true;
  }

  private applyPaneHeaderAction(action: string, paneIndex: number) {
    if (this.dead) return false;
    const chart = this.engine?.chart;
    if (!chart || !Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex >= chart.panes().length) return false;
    const isPrimary = paneIndex === chart.primaryPaneIndex();
    const changed = action === 'move-up' ? chart.movePane(paneIndex, -1)
      : action === 'move-down' ? chart.movePane(paneIndex, 1)
        : action === 'collapse' ? isPrimary ? this.setPrimaryPaneCollapsed(true) : chart.setPaneCollapsed(paneIndex, true)
          : action === 'expand' ? isPrimary ? this.setPrimaryPaneCollapsed(false) : chart.setPaneCollapsed(paneIndex, false)
            : action === 'maximize' || action === 'restore' ? chart.maximizePane(paneIndex) : false;
    if (changed) this.schedulePaneIndicatorLayout();
    return changed;
  }

  private schedulePaneIndicatorLayout() {
    if (this.dead || this.paneIndicatorLayoutFrame !== undefined) return;
    this.paneIndicatorLayoutFrame = requestAnimationFrame(() => {
      this.paneIndicatorLayoutFrame = undefined;
      if (!this.dead) this.renderActiveIndicators();
    });
  }

  private indicatorPaneIndex(instance: IndicatorInstance) {
    if (!this.engine || !instance.visible || instance.placement !== 'pane') return -1;
    if (instance.definitionId === EFFORT_RESULT_ID) return this.effortView?.paneIndex() ?? -1;
    if (instance.definitionId === LIQUIDATIONS_ID) return this.liquidationsView?.paneIndex() ?? -1;
    if (instance.definitionId === CVD_ID) return this.cvdView?.paneIndex() ?? -1;
    if (instance.definitionId === OPEN_INTEREST_ID) return this.openInterestView?.paneIndex() ?? -1;
    if (instance.definitionId === MARKET_CONDITIONS_ID) return this.conditionsView?.paneIndex() ?? -1;
    if (instance.definitionId === FOOTPRINT_TOTALS_ID) return this.engine.footprintTotalsPaneIndex(instance.instanceId);
    if (NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])) return this.engine.netPositioningPaneIndex(instance.instanceId);
    if (instance.definitionId === COMPOSITION_SMA_ID) return this.compositionApis.get(instance.instanceId)?.paneIndex ?? -1;
    return instance.script ? this.studyHost?.paneIndex(instance.instanceId) ?? -1 : -1;
  }

  private paneOrderEntries() {
    if (!this.engine) return [];
    return [{ id: '@price', index: this.engine.chart.primaryPaneIndex() },
      ...this.selection.indicators.map(instance => ({ id: instance.instanceId, index: this.indicatorPaneIndex(instance) }))]
      .filter(entry => entry.index >= 0).sort((a, b) => a.index - b.index);
  }

  private capturePaneOrder(commit = true, allowDuringManagedMove = false) {
    if (this.applyingPaneOrder || this.dead || (this.applyingManagedCompositionMove && !allowDuringManagedMove)) return;
    const mounted = this.paneOrderEntries().map(entry => entry.id);
    const paneOrder = [...mounted, ...(this.selection.paneOrder ?? []).filter(id => !mounted.includes(id))];
    const orderByOwner = new Map(paneOrder.map((id, index) => [id, index]));
    const opaqueLegacyPanes = this.selection.composition.opaqueLegacyPanes.map(record => ({ ...record,
      order: orderByOwner.get(record.ownerInstanceId) ?? record.order }));
    const composition = validateComposition({ ...this.selection.composition, opaqueLegacyPanes }, this.selection.indicators.map(item => item.instanceId));
    this.selection = { ...this.selection, paneOrder, composition };
    this.captureCompositionLayout(false);
    if (commit) { this.params.api.updateParameters(this.selection); this.save(); }
  }

  private compositionPaneIndex(pane: IndicatorCompositionState['panes'][number]) {
    for (const id of pane.memberIds) {
      const member = this.selection.indicators.find(instance => instance.instanceId === id);
      if (!member) continue;
      const index = this.indicatorPaneIndex(member);
      if (index >= 0) return index;
    }
    return -1;
  }

  private captureCompositionLayout(commit = true) {
    const chart = this.engine?.chart;
    if (!chart || this.applyingPaneOrder || !this.selection.composition.panes.length) return;
    let changed = false;
    const panes = this.selection.composition.panes.map(pane => {
      const index = this.compositionPaneIndex(pane);
      if (index < 0) return pane;
      const next = { ...pane, order: index, weight: chart.paneWeight(index), collapsed: chart.paneCollapsed(index) };
      if (next.order !== pane.order || next.weight !== pane.weight || next.collapsed !== pane.collapsed) changed = true;
      return next;
    });
    if (!changed) return;
    this.selection = { ...this.selection, composition: { ...this.selection.composition, panes } };
    if (commit) { this.params.api.updateParameters(this.selection); this.save(); }
  }

  private restoreCompositionLayout() {
    const chart = this.engine?.chart;
    if (!chart || !this.selection.composition.panes.length || this.applyingPaneOrder) return;
    this.applyingPaneOrder = true;
    try {
      for (const pane of [...this.selection.composition.panes].sort((a, b) => a.order - b.order)) {
        const index = this.compositionPaneIndex(pane);
        if (index < 0) continue;
        if (Math.abs(chart.paneWeight(index) - pane.weight) > .001) chart.setPaneWeight(index, pane.weight);
        if (chart.paneCollapsed(index) !== pane.collapsed) chart.setPaneCollapsed(index, pane.collapsed);
      }
    } finally { this.applyingPaneOrder = false; }
  }

  private restorePaneOrder() {
    const chart = this.engine?.chart, saved = this.selection.paneOrder;
    if (!chart || !saved?.length || this.applyingPaneOrder) return;
    this.applyingPaneOrder = true;
    try {
      const mounted = this.paneOrderEntries();
      const order = [...saved.filter(id => mounted.some(entry => entry.id === id)),
        ...mounted.filter(entry => !saved.includes(entry.id)).map(entry => entry.id)];
      order.forEach((id, target) => {
        for (let step = 0; step < 64; step++) {
          const current = this.paneOrderEntries().find(entry => entry.id === id)?.index;
          if (current === undefined || current === target || !chart.movePane(current, current > target ? -1 : 1)) break;
        }
      });
    } finally { this.applyingPaneOrder = false; }
  }

  private setPrimaryPaneCollapsed(collapsed: boolean) {
    const chart = this.engine?.chart;
    if (!chart || this.primaryPaneCollapsed === collapsed) return false;
    const panes = chart.panes();
    const primaryIndex = chart.primaryPaneIndex();
    if (collapsed && !panes.some((_, index) => index !== primaryIndex && !chart.paneCollapsed(index))) return false;
    if (collapsed) {
      this.primaryPaneOriginalWeight = chart.paneWeight(primaryIndex);
      this.primaryPaneOtherOriginalWeights = new Map(panes
        .filter((_, index) => index !== primaryIndex)
        .map(pane => [pane.element, pane.weight]));
      if (chart.maximizedPane() === primaryIndex) chart.maximizePane(primaryIndex);
      this.primaryPaneCollapsed = true;
      this.fitPrimaryPaneCollapseWeight();
    } else {
      this.primaryPaneCollapsed = false;
      const originalWeight = this.primaryPaneOriginalWeight;
      this.primaryPaneOriginalWeight = undefined;
      if (originalWeight !== undefined && Number.isFinite(originalWeight)) chart.setPaneWeight(chart.primaryPaneIndex(), originalWeight);
      for (const [element, weight] of this.primaryPaneOtherOriginalWeights) {
        const index = chart.panes().findIndex(pane => pane.element === element);
        if (index >= 0) chart.setPaneWeight(index, weight);
      }
      this.primaryPaneOtherOriginalWeights.clear();
    }
    this.schedulePaneIndicatorLayout();
    return true;
  }

  private fitPrimaryPaneCollapseWeight() {
    const chart = this.engine?.chart;
    if (!chart || !this.primaryPaneCollapsed) return;
    const panes = chart.panes();
    const primaryIndex = chart.primaryPaneIndex();
    const openOtherPanes = panes.reduce((count, _, index) => count + (index !== primaryIndex && !chart.paneCollapsed(index) ? 1 : 0), 0);
    if (panes.length < 2 || openOtherPanes === 0) {
      this.setPrimaryPaneCollapsed(false);
      return;
    }
    if (chart.maximizedPane() !== null) return;

    const chartHeight = this.chart.clientHeight;
    if (chartHeight <= 0) return;
    const collapsedOtherHeight = panes.reduce((height, pane, index) => index !== primaryIndex && chart.paneCollapsed(index)
      ? height + pane.element.getBoundingClientRect().height : height, 0);
    const availableHeight = Math.max(0, chartHeight - collapsedOtherHeight);
    const headerHeight = Math.min(28, Math.max(18, availableHeight * 0.2));
    if (availableHeight <= headerHeight + 28) return;
    const otherWeight = panes.reduce((weight, _, index) => index !== primaryIndex && !chart.paneCollapsed(index)
      ? weight + chart.paneWeight(index) : weight, 0);
    if (otherWeight <= 0) return;
    const weightBeforeMinimum = otherWeight * headerHeight / (availableHeight - headerHeight);
    const weight = Math.max(0.05, weightBeforeMinimum);
    if (weightBeforeMinimum < 0.05) {
      const desiredOtherWeight = weight * (availableHeight - headerHeight) / headerHeight;
      const scale = desiredOtherWeight / otherWeight;
      for (let index = 0; index < panes.length; index++) {
        if (index === primaryIndex || chart.paneCollapsed(index)) continue;
        const pane = panes[index]!;
        if (!this.primaryPaneOtherOriginalWeights.has(pane.element)) this.primaryPaneOtherOriginalWeights.set(pane.element, pane.weight);
        chart.setPaneWeight(index, chart.paneWeight(index) * scale);
      }
    }
    if (Math.abs(chart.paneWeight(primaryIndex) - weight) > 0.001) chart.setPaneWeight(primaryIndex, weight);
  }

  private paneIndicatorGeometry(paneIndex: number, rows: readonly HTMLDivElement[]) {
    const chart = this.engine?.chart;
    if (!chart || rows.length === 0) return null;
    const plot = chart.plotRect(paneIndex), pane = chart.panes()[paneIndex]?.element;
    if (!pane) return null;
    const chartRect = this.chart.getBoundingClientRect(), paneRect = pane.getBoundingClientRect();
    const paneLeft = paneRect.left - chartRect.left, paneRight = paneRect.right - chartRect.left;
    const collapsed = chart.paneCollapsed(paneIndex);
    const nativeChrome = rows.some(row => {
      const definition = row.dataset.definitionId;
      return definition === CVD_ID || definition === OPEN_INTEREST_ID || definition === LIQUIDATIONS_ID
        || NET_POSITIONING_IDS.includes(definition as typeof NET_POSITIONING_IDS[number]);
    });
    // Keep every native option group in the same header strip as its indicator
    // title, regardless of pane width or collapse state.
    const inlineNativeControls = nativeChrome;
    if (collapsed) {
      // Folded panes have no useful plot height, but their strip is still a
      // real header. Cover the chart's own first-study legend row with this
      // single native DOM header so its name and actions remain usable there.
      const contentLeft = plot ? plot.left : paneLeft + 4;
      const contentRight = plot ? plot.left + plot.width : paneRight - 80;
      const contentWidth = Math.max(0, contentRight - contentLeft);
      if (contentWidth < 120) return null;
      const rowWidth = Math.max(0, contentWidth - 84);
      return { left: paneLeft, top: paneRect.top - chartRect.top, width: paneRect.width, paddingLeft: contentLeft - paneLeft,
        paddingRight: paneRight - contentRight, rowWidth, height: Math.min(30, Math.max(22, paneRect.height)), nativeChrome, inlineNativeControls, reservedControls: false };
    }
    if (!plot || plot.width < 120 || plot.height < 36) return null;
    const rowWidth = Math.max(0, plot.width - 84);
    return { left: paneLeft, top: plot.top, width: paneRect.width, paddingLeft: plot.left - paneLeft,
      paddingRight: paneRight - (plot.left + plot.width), rowWidth, height: 30, nativeChrome, inlineNativeControls, reservedControls: false };
  }

  private setNativePaneControlsHost(paneIndex: number, home: HTMLElement | null) {
    const elements: HTMLElement[] = [];
    if (this.cvdView?.paneIndex() === paneIndex) {
      const element = this.cvdView.paneControlElement(); this.cvdView.setPaneControlHost(home); if (home) elements.push(element);
    }
    if (this.openInterestView?.paneIndex() === paneIndex) {
      const element = this.openInterestView.paneControlElement(); this.openInterestView.setPaneControlHost(home); if (home) elements.push(element);
    }
    if (this.liquidationsView?.paneIndex() === paneIndex) {
      const element = this.liquidationsView.paneControlElement(); this.liquidationsView.setPaneControlHost(home); if (home) elements.push(element);
    }
    return elements;
  }

  private indicatorRowView(row: { instance: IndicatorInstance; name: string; info: string; warning: string; unavailable: boolean }) {
    const providerView = row.instance.script && this.studyHost?.views().find(view => view.attachmentId === row.instance.instanceId);
    const canAddSma = row.instance.script && Boolean(providerView?.numericOutputs.length)
      || row.instance.definitionId === COMPOSITION_SMA_ID || row.instance.definitionId === CVD_ID || row.instance.definitionId === OPEN_INTEREST_ID;
    const canMove = row.instance.script ? Boolean(providerView?.movable)
      : row.instance.definitionId === COMPOSITION_SMA_ID || (row.instance.definitionId === CVD_ID || row.instance.definitionId === OPEN_INTEREST_ID) && row.instance.visible;
    const actions = ['visibility', 'settings', ...(canAddSma ? ['add-sma'] : []), ...(canMove ? ['move'] : []), ...(row.instance.script ? ['source', 'duplicate'] : []), ...(row.instance.definitionId === EFFORT_RESULT_ID ? ['history'] : []), 'info', 'remove'];
    const actionsKey = actions.join('|');
    let view = this.indicatorRowViews.get(row.instance.instanceId);
    if (view?.actionsKey !== actionsKey) {
      view?.element.remove();
      const element = document.createElement('div'); element.className = 'active-indicator';
      const copy = document.createElement('div'); copy.className = 'active-indicator-copy';
      const name = document.createElement('span');
      const warning = document.createElement('small'); warning.className = 'active-indicator-warning'; warning.hidden = true; copy.append(name, warning);
      const controls = document.createElement('div'); controls.className = 'active-indicator-actions';
      const buttons = new Map<string, HTMLButtonElement>();
      for (const action of actions) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.indicatorAction = action;
        if (action === 'info') { button.dataset.indicatorInfo = 'true'; button.setAttribute('aria-expanded', 'false'); }
        buttons.set(action, button); button.dataset.icon = action; button.append(indicatorIcon(action)); controls.append(button);
      }
      element.append(copy, controls);
      view = { element, name, warning, controls, buttons, actionsKey };
      this.indicatorRowViews.set(row.instance.instanceId, view);
    }
    const { instance } = row;
    view.element.dataset.instanceId = instance.instanceId;
    view.element.dataset.definitionId = instance.definitionId;
    view.element.dataset.visible = String(instance.visible);
    view.name.textContent = row.name;
    view.name.title = row.name;
    view.warning.textContent = row.warning;
    view.warning.hidden = !row.warning;
    for (const [action, button] of view.buttons) {
      const label = action === 'visibility' ? `${instance.visible ? 'Hide' : 'Show'} ${row.name}` : action === 'settings' ? `${row.name} settings`
        : action === 'add-sma' ? `Add moving average to ${row.name}` : action === 'move' ? `Move ${row.name}` : action === 'source' ? `Edit Script for ${row.name}`
          : action === 'history' ? `${row.name} history` : `${action === 'remove' ? 'Remove' : 'Duplicate'} ${row.name}`;
      button.dataset.instanceId = instance.instanceId;
      button.setAttribute('aria-label', action === 'info' ? `About ${row.name}` : label);
      button.title = action === 'info' ? row.info : label;
      if (action === 'info') button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') ?? 'false');
      if (action === 'visibility') {
        const loading = this.indicatorIsLoading(row.instance, row.unavailable);
        const icon = loading ? 'loading' : 'visibility';
        if (button.dataset.icon !== icon) {
          button.replaceChildren(indicatorIcon(icon));
          button.dataset.icon = icon;
        }
        button.toggleAttribute('data-loading', loading);
        if (loading) button.setAttribute('aria-busy', 'true');
        else button.removeAttribute('aria-busy');
        button.title = loading ? `${label} · Loading` : label;
        button.setAttribute('aria-pressed', String(instance.visible));
      }
      else button.removeAttribute('aria-pressed');
      const wallMarketUnsupported = instance.definitionId === ORDER_WALLS_ID && this.selection.venue === 'hyperliquid';
      const dependent = this.selection.indicators.find(candidate => Object.values(candidate.numericInputs ?? {}).some(input => input.instanceId === instance.instanceId));
      const removeBlock = action === 'remove' ? (instance.script ? this.studyHost?.removeBlockReason(instance.instanceId) : null)
        ?? (dependent ? `Cannot remove ${row.name} while ${this.compositionSmaTitle(dependent)} depends on its output. Remove that study first.` : null) : null;
      button.disabled = row.unavailable && action !== 'remove' && action !== 'info' || wallMarketUnsupported && action === 'visibility' || Boolean(removeBlock);
      if (removeBlock) button.title = removeBlock;
    }
    return view.element;
  }

  private indicatorIsLoading(instance: IndicatorInstance, unavailable: boolean) {
    if (!instance.visible || unavailable) return false;
    if (instance.definitionId === TPO_ID) return this.tpoStatus?.state === 'loading';
    if (instance.definitionId === ORDER_WALLS_ID) return this.orderWallsStatus?.state === 'loading';
    if (instance.definitionId === HEATMAP_ID) return this.heatmapStatus?.state === 'syncing';
    if (instance.definitionId === FOOTPRINT_ID || instance.definitionId === FOOTPRINT_TOTALS_ID) {
      return this.footprintDataWanted() && this.footprintStatus.state === 'loading';
    }
    if (instance.definitionId === COMPOSITION_SMA_ID) return !this.compositionApis.has(instance.instanceId);
    if (NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])) {
      const method = netPositioningSettings(instance.settings).method;
      return Boolean(this.releaseNetPositioning && !document.hidden && !this.netPositioningHistories.get(method)?.metadata() && !this.netPositioningErrors.has(method));
    }
    if (!instance.script) return false;
    const study = this.studyHost?.views().find(view => view.attachmentId === instance.instanceId);
    if (!study) return !unavailable;
    if (study.diagnostics.length) return false;
    const status = study.status.toLowerCase();
    return status.includes('reloading') || status.includes('syncing') || status.includes('loading');
  }

  private syncPaneLoadingStates() {
    if (!this.engine || this.dead) return;
    const wanted = new Set<string>();
    const place = (id: string, paneIndex: number, state: PaneDataState | null) => {
      const plot = this.engine?.chart.plotRect(paneIndex);
      const maximized = this.engine?.chart.maximizedPane();
      if (maximized !== null && maximized !== undefined && maximized !== paneIndex) return;
      if (!plot || this.engine?.chart.paneCollapsed(paneIndex) || paneIndex === this.engine?.chart.primaryPaneIndex() && this.primaryPaneCollapsed) return;
      wanted.add(id);
      let loader = this.paneLoaders.get(id);
      if (!loader && state) { loader = new PaneLoading(); loader.element.dataset.instanceId = id; this.paneLoaders.set(id, loader); this.paneLoadingLayer.append(loader.element); }
      if (!loader) return;
      loader.update(state);
      Object.assign(loader.element.style, { left: `${plot.left}px`, top: `${plot.top + 32}px`, width: `${plot.width}px`, height: `${Math.max(0, plot.height - 36)}px` });
    };
    const footprint = this.selection.type === 'footprint';
    const mainHasData = footprint ? this.footprintBars.length > 0 : this.candles.length > 0;
    const mainStatus = footprint ? this.footprintStatus : this.status;
    const mainUnavailable = mainStatus.state === 'failed' || mainStatus.state === 'stale';
    place('@price', this.engine.chart.primaryPaneIndex(), mainHasData || mainUnavailable ? null : {
      kind: mainStatus.state === 'loading' ? 'loading' : 'empty',
      title: 'Waiting for data…',
    });
    for (const instance of this.selection.indicators) {
      const paneIndex = this.indicatorPaneIndex(instance);
      if (paneIndex < 0 || !instance.visible || (instance.definitionId === MARKET_CONDITIONS_ID || instance.definitionId === EFFORT_RESULT_ID)) continue;
      const name = nativeDefinition(instance.definitionId)?.name.replace(' — Estimated', '') ?? instance.script?.title ?? 'indicator';
      let state: PaneDataState | null = null;
      if (NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])) {
        const settings = netPositioningSettings(instance.settings), history = this.netPositioningHistories.get(settings.method), error = this.netPositioningErrors.get(settings.method);
        const hasData = history?.snapshot().some(candle => settings.venues.some(venue => (candle.venues[venue]?.availableIntervals ?? 0) > 0));
        if (!settings.venues.length) state = { kind: 'empty', title: 'Choose an exchange' };
        else if (!hasData || !this.candles.length) state = error ? { kind: 'error', title: `${name} unavailable` }
          : !history?.metadata() || !this.candles.length ? { kind: 'loading', title: `Waiting for ${name} data…` }
            : { kind: 'empty', title: 'Waiting for estimates…' };
      } else if (instance.definitionId === FOOTPRINT_TOTALS_ID && !this.footprintBars.length) {
        state = this.footprintStatus.state === 'failed' || this.footprintStatus.state === 'stale'
          ? { kind: 'error', title: 'Footprint data unavailable' }
          : { kind: this.footprintStatus.state === 'loading' ? 'loading' : 'empty', title: 'Waiting for footprint data…' };
      } else if (instance.script) {
        const study = this.studyHost?.views().find(view => view.attachmentId === instance.instanceId);
        const hasData = study && Object.values(study.outputs).some(value => typeof value === 'number' && Number.isFinite(value));
        if (!hasData && this.indicatorIsLoading(instance, false)) state = { kind: 'loading', title: `Waiting for ${name}…` };
        else if (!hasData && study?.diagnostics.length) state = { kind: 'error', title: 'Indicator unavailable' };
        else if (!hasData && study) state = { kind: 'empty', title: 'Waiting for indicator values…' };
      }
      place(instance.instanceId, paneIndex, state);
    }
    for (const [id, loader] of this.paneLoaders) if (!wanted.has(id)) { loader.element.remove(); this.paneLoaders.delete(id); }
  }

  private reconcileIndicatorChildren(parent: HTMLElement, desired: readonly HTMLElement[]) {
    let cursor = parent.firstElementChild as HTMLElement | null;
    for (const child of desired) {
      if (child === cursor) cursor = cursor.nextElementSibling as HTMLElement | null;
      else parent.insertBefore(child, cursor);
    }
    while (cursor) { const next = cursor.nextElementSibling as HTMLElement | null; cursor.remove(); cursor = next; }
  }

  private syncPaneIndicatorRows(rowsByPane: Map<number, HTMLDivElement[]>) {
    for (const [paneIndex, host] of this.paneIndicatorHosts) {
      if (rowsByPane.has(paneIndex)) continue;
      this.setNativePaneControlsHost(paneIndex, null);
      for (const legend of host.querySelectorAll<HTMLElement>('.net-positioning-legend[data-instance-id]')) {
        this.engine?.setNetPositioningLegendHost(legend.dataset.instanceId!, null);
      }
      host.remove(); this.paneIndicatorHosts.delete(paneIndex);
    }
    for (const [paneIndex, rows] of rowsByPane) {
      let host = this.paneIndicatorHosts.get(paneIndex);
      if (!host) {
        host = document.createElement('div'); host.className = 'pane-indicator-host'; host.dataset.paneIndex = String(paneIndex);
        const rowList = document.createElement('div'); rowList.className = 'pane-indicator-rows';
        host.append(rowList);
        this.paneIndicatorHosts.set(paneIndex, host); this.paneIndicatorLayer.append(host);
      }
      const rowList = host.querySelector<HTMLElement>('.pane-indicator-rows');
      if (!rowList) continue;
      const instanceIds = new Set(rows.map(row => row.dataset.instanceId));
      for (const legend of rowList.querySelectorAll<HTMLElement>('.net-positioning-legend[data-instance-id]')) {
        if (!instanceIds.has(legend.dataset.instanceId)) this.engine?.setNetPositioningLegendHost(legend.dataset.instanceId!, null);
      }
      const legends = rows.map(row => this.engine?.setNetPositioningLegendHost(row.dataset.instanceId!, rowList))
        .filter((legend): legend is HTMLElement => Boolean(legend));
      const geometry = this.paneIndicatorGeometry(paneIndex, rows);
      host.hidden = !geometry;
      if (!geometry) { this.setNativePaneControlsHost(paneIndex, null); continue; }
      const nativeControls = this.setNativePaneControlsHost(paneIndex, geometry.inlineNativeControls ? rowList : null);
      this.reconcileIndicatorChildren(rowList, [...rows, ...nativeControls, ...legends]);
      host.style.left = `${geometry.left}px`; host.style.top = `${geometry.top}px`; host.style.width = `${geometry.width}px`; host.style.height = `${geometry.height}px`;
      host.style.paddingLeft = `${geometry.paddingLeft}px`; host.style.paddingRight = `${geometry.paddingRight}px`;
      host.dataset.collapsed = String(this.engine?.chart.paneCollapsed(paneIndex) ?? false);
      host.dataset.nativeChrome = String(geometry.nativeChrome);
      host.dataset.inlineControls = String(geometry.inlineNativeControls);
      host.dataset.reservedControls = String(geometry.reservedControls);
      rowList.style.flex = geometry.nativeChrome ? `0 1 ${geometry.rowWidth}px` : '1 1 auto';
      rowList.style.width = geometry.nativeChrome ? `${geometry.rowWidth}px` : '';
      rowList.style.maxWidth = geometry.nativeChrome ? `${geometry.rowWidth}px` : '';
      rowList.style.marginRight = geometry.reservedControls ? 'auto' : '';
    }
  }

  private syncPaneLayoutControls() {
    const chart = this.engine?.chart;
    const panes = chart?.panes() ?? [];
    if (!chart || panes.length < 2) {
      if (chart && this.primaryPaneCollapsed) this.setPrimaryPaneCollapsed(false);
      this.primaryPaneCollapsedHeader.hidden = true;
      this.chart.classList.remove('primary-pane-collapsed');
      if (chart) {
        const primaryPane = chart.panes()[chart.primaryPaneIndex()];
        if (primaryPane) primaryPane.element.style.visibility = '';
      }
      for (const host of this.paneControlHosts.values()) host.element.remove();
      this.paneControlHosts.clear();
      return;
    }
    const primaryPaneIndex = chart.primaryPaneIndex();
    const maximizedPane = chart.maximizedPane();
    const primaryPane = panes[primaryPaneIndex];
    const showPrimaryHeader = this.primaryPaneCollapsed && maximizedPane === null;
    if (primaryPane) primaryPane.element.style.visibility = this.primaryPaneCollapsed && maximizedPane !== primaryPaneIndex ? 'hidden' : '';
    this.chart.classList.toggle('primary-pane-collapsed', showPrimaryHeader);
    this.primaryPaneCollapsedHeader.hidden = !showPrimaryHeader;
    if (showPrimaryHeader && primaryPane) {
      const chartRect = this.chart.getBoundingClientRect();
      const paneRect = primaryPane.element.getBoundingClientRect();
      const plot = chart.plotRect(primaryPaneIndex);
      const left = plot ? plot.left + 4 : paneRect.left - chartRect.left + 4;
      const top = plot ? plot.top : paneRect.top - chartRect.top;
      const right = plot ? plot.left + plot.width : paneRect.right - chartRect.left - 80;
      const width = Math.max(0, right - left - 82 - 12);
      const title = `Main chart · ${instrumentLabel(this.selection)} · ${this.selection.interval}`;
      this.primaryPaneCollapsedHeader.textContent = title;
      this.primaryPaneCollapsedHeader.title = title;
      this.primaryPaneCollapsedHeader.style.left = `${left}px`;
      this.primaryPaneCollapsedHeader.style.top = `${top + 2}px`;
      this.primaryPaneCollapsedHeader.style.width = `${width}px`;
    }
    const chartRect = this.chart.getBoundingClientRect();
    const controlWidth = 82;
    const rightAxisWidth = 80;
    for (const [paneIndex, view] of this.paneControlHosts) {
      if (paneIndex < panes.length) continue;
      view.element.remove(); this.paneControlHosts.delete(paneIndex);
    }
    panes.forEach((pane, paneIndex) => {
      let view = this.paneControlHosts.get(paneIndex);
      if (!view) {
        const element = document.createElement('div'); element.className = 'pane-layout-controls';
        element.dataset.paneIndex = String(paneIndex);
        const buttons = new Map<string, HTMLButtonElement>();
        for (const action of ['move-up', 'move-down', 'collapse', 'maximize']) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.paneAction = action;
          buttons.set(action, button); element.append(button);
        }
        view = { element, buttons }; this.paneControlHosts.set(paneIndex, view); this.paneIndicatorLayer.append(element);
      }
      view.element.dataset.paneIndex = String(paneIndex);
      const isPrimary = paneIndex === primaryPaneIndex;
      const prefix = isPrimary ? 'main pane' : `pane ${paneIndex + 1}`;
      const collapsed = chart.paneCollapsed(paneIndex) || isPrimary && this.primaryPaneCollapsed;
      const maximized = maximizedPane === paneIndex;
      const otherOpenPanes = panes.reduce((count, _, index) => count + (index !== primaryPaneIndex && !chart.paneCollapsed(index) ? 1 : 0), 0);
      const labels: Record<string, { label: string; icon: string; disabled: boolean; title?: string }> = {
        'move-up': { label: `Move ${prefix} up`, icon: 'pane-up', disabled: paneIndex === 0, title: 'Move pane up' },
        'move-down': { label: `Move ${prefix} down`, icon: 'pane-down', disabled: paneIndex === panes.length - 1, title: 'Move pane down' },
        collapse: { label: collapsed ? `Expand ${prefix}` : `Collapse ${prefix} to header only`, icon: collapsed ? 'pane-expand' : 'pane-collapse',
          disabled: !collapsed && (isPrimary ? otherOpenPanes === 0 : this.primaryPaneCollapsed && otherOpenPanes <= 1) },
        maximize: { label: maximized ? 'Restore all panes' : `Maximize ${prefix}`, icon: maximized ? 'pane-restore' : 'pane-maximize', disabled: false },
      };
      for (const [action, button] of view.buttons) {
        const state = labels[action]!;
        button.dataset.paneIndex = String(paneIndex);
        button.setAttribute('aria-label', state.label); button.title = state.title ?? state.label;
        button.disabled = state.disabled;
        if (button.dataset.icon !== state.icon) { button.replaceChildren(indicatorIcon(state.icon)); button.dataset.icon = state.icon; }
        if (action === 'collapse') {
          if (collapsed) button.dataset.paneAction = 'expand'; else button.dataset.paneAction = 'collapse';
        } else if (action === 'maximize') {
          button.dataset.paneAction = maximized ? 'restore' : 'maximize';
        }
      }
      const plot = chart.plotRect(paneIndex);
      const paneRect = pane.element.getBoundingClientRect();
      const paneVisible = maximizedPane === null || maximizedPane === paneIndex;
      const paneCollapsed = chart.paneCollapsed(paneIndex) || isPrimary && this.primaryPaneCollapsed;
      const hasPlotBounds = Boolean(plot && plot.width >= controlWidth + 4);
      const hasPaneBounds = paneRect.width >= controlWidth + rightAxisWidth + 8;
      const shouldHideControls = !paneVisible || !(hasPlotBounds || paneCollapsed && hasPaneBounds);
      const sharedOrderFlowHeader = paneIndex === this.orderFlowPaneIndex && Boolean(this.orderFlowPaneView) && paneVisible;
      const indicatorHeader = this.paneIndicatorHosts.get(paneIndex);
      if (sharedOrderFlowHeader) {
        this.orderFlowPaneView!.setPaneControlHost(view.element, view.buttons.values());
        view.element.hidden = true;
        return;
      }
      this.orderFlowPaneView?.restorePaneControls(view.element);
      if (indicatorHeader && !indicatorHeader.hidden) {
        // Reuse the indicator row and pane-action buttons in one strip. The
        // indicator buttons stay in their stable instance rows; only their
        // DOM parent changes between the active list and this pane header.
        indicatorHeader.append(view.element);
        view.element.classList.add('pane-layout-controls-inline');
        view.element.style.removeProperty('left'); view.element.style.removeProperty('top'); view.element.style.removeProperty('width');
        view.element.hidden = shouldHideControls;
        return;
      }
      view.element.classList.remove('pane-layout-controls-inline');
      if (view.element.parentElement !== this.paneIndicatorLayer) this.paneIndicatorLayer.append(view.element);
      view.element.hidden = shouldHideControls;
      if (view.element.hidden) return;
      const right = plot ? plot.left + plot.width : paneRect.right - chartRect.left - rightAxisWidth;
      const top = plot ? plot.top : paneRect.top - chartRect.top;
      view.element.style.left = `${Math.max(plot?.left ?? 0, right - controlWidth - 4)}px`;
      view.element.style.top = `${top + 2}px`;
    });
  }

  private dailyVwapCoverage() {
    const state = this.engine?.dailyVwapDiagnostics();
    return state && 'latest' in state ? state.latest?.partial ? 'Partial UTC day' : state.latest?.value != null ? 'From UTC open' : 'Waiting for volume' : 'Loaded history';
  }

  private indicatorInfo(instance: IndicatorInstance, unavailable: boolean) {
    const ref = instance.definitionId === COMPOSITION_SMA_ID ? instance.numericInputs?.source : undefined;
    const provider = ref && this.selection.indicators.find(item => item.instanceId === ref.instanceId);
    const knownScript = provider?.script && ['builtin.ema-overlay', 'builtin.volume-histogram', 'builtin.binance-depth-band'].includes(provider.script.scriptId);
    const inputOutput = ref && provider && (!provider.script || knownScript) ? this.outputRegistry.resolve(ref).output : undefined;
    const needsDepth = [FOOTPRINT_ID, FOOTPRINT_TOTALS_ID, HEATMAP_ID, ORDER_WALLS_ID].includes(instance.definitionId as typeof FOOTPRINT_ID);
    const availabilityNote = needsDepth && !supportsDepth(this.selection)
      ? 'Use Binance BTCUSDT spot or futures charts to use it.'
      : instance.definitionId === ORDER_WALLS_ID && this.selection.venue === 'hyperliquid'
        ? 'Available on Binance BTCUSDT charts.' : undefined;
    return indicatorInfoText(instance, { inputName: inputOutput?.title, unavailable, availabilityNote });
  }

  private indicatorWarning(instance: IndicatorInstance, unavailable: boolean, study?: import('./scripts/host').StudyView) {
    if (unavailable) return 'Unavailable in this chart.';
    if (instance.definitionId === COMPOSITION_SMA_ID) {
      const ref = instance.numericInputs?.source;
      if (!ref || !this.outputRegistry.resolve(ref).available) return 'Input unavailable. Choose another input in Settings.';
    }
    if (study?.diagnostics.length) return 'Could not load this indicator. Check its settings.';
    if (this.indicatorErrors.has(instance.instanceId)) return 'Could not update this indicator. Check its settings.';
    return '';
  }

  private renderActiveIndicators() {
    if (!this.selection || this.dead) return;
    this.compositionWork.activeIndicatorRenders++;
    this.fitPrimaryPaneCollapseWeight();
    const studies = this.studyHost?.views() ?? [];
    const mainRows: HTMLDivElement[] = [];
    const candidatePaneRows = new Map<number, HTMLDivElement[]>();
    const orderFlowRows: HTMLDivElement[] = [];
    const activeIds = new Set<string>();
    this.selection.indicators.forEach(instance => {
      if (instance.definitionId === FOOTPRINT_TOTALS_ID && this.selection.type !== 'footprint') return;
      const definition = nativeDefinition(instance.definitionId), study = studies.find(v => v.attachmentId === instance.instanceId);
      const unavailable = !definition && !studyPins([instance]).length || instance.settingsVersion !== (definition?.settingsVersion ?? 1) || instance.source.kind !== 'chart';
      const name = instance.definitionId === COMPOSITION_SMA_ID ? this.compositionSmaTitle(instance) : definition?.name ?? instance.script?.title ?? (unavailable ? 'Unavailable indicator' : 'Indicator');
      const view = { instance, name, info: this.indicatorInfo(instance, unavailable), warning: this.indicatorWarning(instance, unavailable, study), unavailable };
      activeIds.add(instance.instanceId);
      const element = this.indicatorRowView(view);
      const paneIndex = this.indicatorPaneIndex(instance);
      if (paneIndex >= 0 && paneIndex === this.orderFlowPaneIndex && this.orderFlowPaneView
        && this.orderFlowMembersByPane.get(paneIndex)?.has(instance.instanceId)) {
        orderFlowRows.push(element);
      } else if (paneIndex >= 0 && paneIndex !== this.engine?.chart.primaryPaneIndex()
        && paneIndex !== this.orderFlowPaneIndex) {
        const group = candidatePaneRows.get(paneIndex) ?? [];
        group.push(element); candidatePaneRows.set(paneIndex, group);
      } else mainRows.push(element);
    });
    this.orderFlowPaneView?.setIndicatorActionRows(orderFlowRows);
    const paneRows = new Map<number, HTMLDivElement[]>();
    for (const [paneIndex, paneRowsForIndex] of candidatePaneRows) {
      if (this.paneIndicatorGeometry(paneIndex, paneRowsForIndex)) paneRows.set(paneIndex, paneRowsForIndex);
      else { this.setNativePaneControlsHost(paneIndex, null); mainRows.push(...paneRowsForIndex); }
    }
    this.syncPaneIndicatorRows(paneRows);
    this.syncPaneLayoutControls();
    this.syncPaneLoadingStates();
    this.paneIndicatorLayer.hidden = ![...this.paneIndicatorHosts.values()].some(host => !host.hidden)
      && ![...this.paneControlHosts.values()].some(view => !view.element.hidden)
      && this.primaryPaneCollapsedHeader.hidden;
    this.activeSummary.textContent = `Indicators (${mainRows.length})`;
    const errorText = this.activeIndicators.dataset.error;
    this.activeIndicators.hidden = mainRows.length === 0 && !errorText;
    if (errorText) {
      this.indicatorErrorRow ??= document.createElement('p');
      this.indicatorErrorRow.className = 'dialog-status'; this.indicatorErrorRow.setAttribute('role', 'status'); this.indicatorErrorRow.textContent = errorText;
    } else { this.indicatorErrorRow?.remove(); }
    this.reconcileIndicatorChildren(this.activeRows, this.indicatorErrorRow ? [...mainRows, this.indicatorErrorRow] : mainRows);
    for (const [id, view] of this.indicatorRowViews) if (!activeIds.has(id)) { view.element.remove(); this.indicatorRowViews.delete(id); }
  }

  private async openPicker() {
    this.renderPicker('Loading local scripts…');
    this.pickerSearch.value = '';
    if (!this.picker.open) this.picker.showModal();
    try {
      await this.library.ensureBuiltIns();
      this.pickerRecords = await this.library.list();
      if (this.dead || !this.picker.open) return;
      this.renderPicker();
      this.pickerSearch.focus();
    } catch (error) {
      this.pickerStatus.textContent = errorText(error);
    }
  }

  private renderPicker(statusMessage?: string) {
    const query = this.pickerSearch.value.trim().toLocaleLowerCase();
    const entries = [...NATIVE_DEFINITIONS, ...this.pickerRecords.map(record => scriptDefinition(record))];
    this.pickerList.replaceChildren();
    const activeCount = this.selection.studies.length;
    let shown = 0;
    for (const category of ['Order Flow','Trend','Volume','My Scripts']) {
      const matches = entries.filter(d => d.category === category
        && (d.id !== FOOTPRINT_TOTALS_ID || this.selection.type === 'footprint')
        && (!query || `${d.name} ${d.description}`.toLocaleLowerCase().includes(query)));
      if (!matches.length) continue;
      const section = document.createElement('section'); section.className = 'indicator-category';
      const heading = document.createElement('h3'); heading.textContent = category; section.append(heading);
      for (const definition of matches) {
        const native = definition.implementation === 'builtin';
        const existing = native && this.selection.indicators.some(i => i.definitionId === definition.id);
        const unsupported = definition.implementation === 'scripted' && definition.dataRequirements.includes('depth-series') && !supportsScriptDepth(this.selection);
        const row = document.createElement('button'); row.type = 'button'; row.className = 'indicator-option';
        if (native) row.dataset.addNative = definition.id; else row.dataset.addScript = definition.id.slice(7);
        row.setAttribute('aria-label', `${existing ? 'Configure' : 'Add'} ${definition.name}`);
        row.disabled = this.pickerBusy || (!native && (activeCount >= MAX_STUDIES_PER_CHART || unsupported));
        row.title = existing ? 'Configure the existing singleton' : unsupported ? 'Available on Binance BTCUSDT Spot or USD-M Perp only; chart market will stay selected' : `Add ${definition.name} with its default settings`;
        const copy = document.createElement('div'); copy.className = 'indicator-option-copy';
        const title = document.createElement('strong'); title.textContent = definition.name;
        const description = document.createElement('span'); description.textContent = definition.description;
        const kind = document.createElement('small'); kind.textContent = native ? 'Built-in · one per chart' : 'Scripted · editable source'; if (unsupported) kind.textContent += ' · Binance BTCUSDT Spot or USD-M Perp only'; copy.append(title, description, kind);
        const action = document.createElement('span'); action.className = 'indicator-option-action'; action.textContent = existing ? 'Settings' : 'Add'; action.setAttribute('aria-hidden','true');
        row.append(copy, action); section.append(row); shown++;
      }
      this.pickerList.append(section);
    }
    this.pickerStatus.textContent = statusMessage ?? (shown ? `${activeCount}/${MAX_STUDIES_PER_CHART} scripted studies attached · native layers use shared feeds` : 'No indicators match this search.');
  }

  private async addStudy(scriptId: string) {
    if (this.pickerBusy) return;
    const record = this.pickerRecords.find(item => item.id === scriptId);
    if (!record || !this.studyHost) return;
    const revision = record.revisions.find(item => item.id === record.currentRevision);
    if (!revision) { this.pickerStatus.textContent = 'The selected source revision is missing.'; return; }
    this.pickerBusy = true;
    this.renderPicker(`${record.title} is being added…`);
    let message = '';
    try {
      const attachmentId = `study-${crypto.randomUUID()}`;
      const managedPaneId = scriptId === 'builtin.volume-histogram' ? compositionPaneId(attachmentId) : undefined;
      const appliedId = await this.studyHost.apply({ attachmentId, scriptId: record.id, source: revision.source, title: record.title, description: record.description, settings: {},
        ...(managedPaneId ? { paneId: managedPaneId, placement: 'pane' as const } : {}) });
      if (managedPaneId) {
        const composition = this.compositionPlacement.registerMember(this.selection.composition, {
          instanceId: appliedId, title: record.title, placement: 'pane', paneId: managedPaneId,
        });
        this.selection = config({ ...this.selection, composition });
        this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
      }
      message = `${record.title} added with its default settings.`;
    } catch (error) {
      message = errorText(error);
    } finally {
      this.pickerBusy = false;
      this.renderPicker(message!);
    }
  }

  private openStudySource(instanceId: string) {
    const attachmentId = this.studyHost?.attachmentForInstance(instanceId);
    if (!attachmentId) return;
    if (this.picker.open) this.picker.close();
    this.openEditor(this.params.api.id, attachmentId);
  }

  private async openStudySettings(instanceId: string) {
    const attachmentId = this.studyHost?.attachmentForInstance(instanceId);
    if (attachmentId) await this.openAttachmentSettings(attachmentId);
  }

  private async openAttachmentSettings(attachmentId: string) {
    const study = attachmentId && this.studyHost?.views().find(view => view.attachmentId === attachmentId);
    if (!attachmentId || !study) return;
    this.settingsAttachmentId = attachmentId; delete this.activeIndicators.dataset.error;
    this.settingsDialog.querySelector<HTMLElement>('.settings-title')!.textContent = `${study.title} settings`;
    this.settingsFields.replaceChildren();
    for (const input of study.inputs) {
      const control = makeInputControl(input, study.settings[input.key]);
      control.dataset.inputKey = input.key;
      control.title = input.tooltip;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        if (control instanceof HTMLInputElement && control.type === 'number') {
          control.required = true;
          control.min = input.min === null ? '' : String(input.min);
          control.max = input.max === null ? '' : String(input.max);
          control.step = input.step === null ? 'any' : String(input.step);
        }
      }
      const label = document.createElement('label'); label.className = 'indicator-setting-field';
      const name = document.createElement('span'); name.textContent = input.label;
      label.append(name, control);
      this.settingsFields.append(label);
    }
    this.settingsStatus.textContent = study.inputs.length ? 'Settings apply to this chart attachment only.' : 'This study has no editable inputs.';
    if (!this.settingsDialog.open) this.settingsDialog.showModal();
  }

  private async applyStudySettings() {
    if (this.settingsBusy || !this.settingsAttachmentId || !this.studyHost) return;
    const invalid = this.settingsForm.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      this.settingsStatus.textContent = 'Check the highlighted setting values before applying.';
      invalid.reportValidity();
      return;
    }
    this.settingsBusy = true;
    this.settingsForm.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    this.settingsFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(control => { control.disabled = true; });
    this.settingsStatus.textContent = 'Applying settings…';
    try {
      await this.studyHost.applySettings(this.settingsAttachmentId, readInputSettings(this.settingsFields));
      this.settingsStatus.textContent = 'Settings applied.';
      this.settingsDialog.close();
    } catch (error) {
      this.settingsStatus.textContent = errorText(error);
    } finally {
      this.settingsBusy = false;
      this.settingsForm.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
      this.settingsFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(control => { control.disabled = false; });
    }
  }

  private keydown(event: KeyboardEvent) {
    if (!this.engine) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input,textarea,select,[contenteditable="true"]') || target.closest('dialog'))) return;
    const draw = this.engine.drawings;
    const toolShortcut = matchDrawingShortcut(event);
    if (toolShortcut && DRAWING_TOOL_IDS.has(toolShortcut)) {
      draw.setTool(toolShortcut);
      event.preventDefault();
      return;
    }
    const action = keyToDrawingAction(event, {
      hasSelection: draw.selection().length > 0,
      hasTarget: draw.hovered() !== null,
      editingText: false,
      placing: Boolean(draw.activeTool()) || draw.erasing(),
    });
    if (action) {
      switch (action.type) {
        case 'undo': draw.undo(); break;
        case 'redo': draw.redo(); break;
        case 'copy': void draw.copy(); break;
        case 'cut': void draw.cut(); break;
        case 'paste': void draw.paste(); break;
        case 'duplicate': this.duplicateDrawings(draw.selection().length ? draw.selection() : draw.hovered() ? [draw.hovered()!] : []); break;
        case 'delete': draw.removeMany(draw.selection().length ? draw.selection() : draw.hovered() ? [draw.hovered()!] : []); break;
        case 'nudge': draw.nudge(draw.selection(), action.dx, action.dy); break;
        case 'cancel': draw.cancel(); break;
        case 'finish': draw.finish(); break;
        case 'popAnchor': draw.popAnchor(); break;
      }
      event.preventDefault();
      event.stopPropagation();
      this.syncDrawingActions();
      return;
    }
    const range = this.engine.visibleRange();
    if (event.key === 'Home') this.engine.resetView();
    else if (range && event.key === 'ArrowLeft') this.engine.setRange({ from: range.from - 4, to: range.to - 4 });
    else if (range && event.key === 'ArrowRight') this.engine.setRange({ from: range.from + 4, to: range.to + 4 });
    else if (event.key === '+' || event.key === '=') this.engine.zoom(1.2);
    else if (event.key === '-' || event.key === '_') this.engine.zoom(1 / 1.2);
    else return;
    event.preventDefault();
  }

  private select() {
    this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear();
    this.engine?.setExecutionHoverRay(null);
    const series = seriesForInstrument(this.instrument.value, this.interval.value as Interval);
    const wasFootprint = this.selection.type === 'footprint';
    if (series) this.marketButton.textContent = instrumentLabel(series);
    const previousContextId = numericOutputContextId(this.selection);
    let nextSelection = config({ ...this.selection, ...(series ?? {}), studies: this.selection.studies });
    const nextContextId = numericOutputContextId(nextSelection);
    if (nextContextId !== previousContextId) {
      const indicators = nextSelection.indicators.map(instance => {
        if (!instance.numericInputs) return instance;
        let changed = false;
        const numericInputs = Object.fromEntries(Object.entries(instance.numericInputs).map(([key, ref]) => {
          if (ref.contextId !== previousContextId) return [key, ref];
          changed = true;
          return [key, { ...ref, contextId: nextContextId }];
        }));
        return changed ? { ...instance, numericInputs } : instance;
      });
      nextSelection = config({ ...nextSelection, indicators });
    }
    this.selection = nextSelection;
    this.cancelWatchPick?.();this.setWatchZones(this.watchList);
    this.params.api.updateParameters(this.selection);
    this.updateFootprintControls();
    this.resetViewOnSnapshot = true;
    this.footprintHasInitialView = false;
    this.footprintNeedsSync = true;
    this.engine?.setSnapshot([], false);
    if (wasFootprint && this.selection.type === 'candle') this.engine?.setDisplayMode('candle');
    this.engine?.setFootprintBars([], false);
    this.footprintBars = [];
    this.footprintSnapshotSignature = undefined;
    this.candles = [];
    this.studyHost?.setSeries(this.selection);
    this.updateDepthNotice();
    this.hoveredBar = null;
    this.hoveredFootprint = null;
    this.subscribe();
    this.syncTpo();
    this.refreshExecutionHover(this.params.api.id);
    this.save();
  }

  private subscribe() {
    this.release?.();
    const epoch = ++this.selectionEpoch;
    const selection = this.selection;
    this.engine?.setDrawingContext(selection);
    this.loadObjectTreeForSelection();
    this.syncDailyVwap();
    this.params.api.setTitle(`${instrumentLabel(selection)} · ${selection.interval}`);
    this.chart.setAttribute('aria-label', `${instrumentLabel(selection)} candlestick chart`);
    this.updateInstrumentMetadata();
    this.status = { state: 'loading', message: 'Loading native candles…', lastUpdate: 0 };
    this.schedulePaneIndicatorLayout();
    this.updateFootprintControls();
    this.updateStatus();
    this.release = this.feed.subscribe(this.params.api.id, selection, event => {
      if (this.dead || epoch !== this.selectionEpoch) return;
      const vwapCoverage = this.dailyVwapCoverage();
      if (event.type === 'status') {
        this.status = event.status;
        this.updateStatus();
      } else if (event.type === 'snapshot') {
        this.candles = event.candles.length > 5_000 ? event.candles.slice(-5_000) : [...event.candles];
        this.engine?.setSnapshot(event.candles, !this.resetViewOnSnapshot);
        this.studyHost?.setSnapshot(this.candles); this.cvdData?.setHostCandles(this.candles); this.cvdView?.setHostCandles(this.candles); this.openInterestData?.setHostCandles(this.candles); this.openInterestView?.setHostCandles(this.candles); this.liquidationsView?.setHostCandles(this.candles); this.orderFlowPaneView?.invalidate();
        this.schedulePaneIndicatorLayout();
        if (this.resetViewOnSnapshot && this.selection.type === 'candle') this.engine?.resetView();
        this.resetViewOnSnapshot = false;
        this.hoveredBar = null;
        this.syncOrderWalls();
        this.refreshFootprintCellTooltip();
      } else if (event.type === 'patch') {
        this.mergeCandles(event.candles);
        this.engine?.applyPatch(event.candles);
        this.studyHost?.applyPatch(event.candles); this.cvdData?.setHostCandles(this.candles); this.cvdView?.setHostCandles(this.candles); this.openInterestData?.setHostCandles(this.candles); this.openInterestView?.setHostCandles(this.candles); this.liquidationsView?.setHostCandles(this.candles); this.orderFlowPaneView?.invalidate();
        this.refreshFootprintCellTooltip();
        this.status = { ...this.status, lastUpdate: Date.now() };
      }
      if (this.nativeIndicator(DAILY_VWAP_ID) && vwapCoverage !== this.dailyVwapCoverage()) this.renderActiveIndicators();
    });
    this.syncHeatmap();
    this.subscribeFootprint();
    this.reconcileIndicators();
    this.syncOrderWalls();
    this.syncNetPositioning();
    this.syncMarketConditions();
    this.syncEffortResult(); this.syncCvd(); this.syncLiquidations();
  }

  private changeHeatmap(settings: HeatmapSettings, units: FootprintUnits) {
    if (getCurrencyPreference().enabled) units = this.selection.footprintUnits;
    const previousUnits = this.selection.footprintUnits;
    const instance = this.nativeIndicator(HEATMAP_ID); if (!instance) return;
    this.selection = config({ ...this.selection, footprintUnits: units, indicators: this.selection.indicators.map(i =>
      i.instanceId === instance.instanceId ? { ...i, settings: { ...settings, rowPrice: this.nativeIndicator(FOOTPRINT_ID) ? this.selection.heatmap.rowPrice : settings.rowPrice } }
        : i.definitionId === FOOTPRINT_ID && i.settingsVersion === 1 && i.source.kind === 'chart' ? { ...i, settings: { ...i.settings, units } } : i) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); if (previousUnits !== this.selection.footprintUnits) this.syncNativeIndicators(); this.save();
  }
  private changeOrderWalls(settings: OrderWallsSettings) {
    const instance = this.nativeIndicator(ORDER_WALLS_ID); if (!instance) return;
    const normalized = orderWallsSettings({ ...settings, enabled: true });
    this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(i =>
      i.instanceId === instance.instanceId ? { ...i, settings: normalized } : i) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }
  private syncHeatmap() {
    const supported = supportsDepth(this.selection), footprint = Boolean(this.nativeIndicator(FOOTPRINT_ID));
    const settings: HeatmapSettings = { ...(footprint ? { ...this.selection.heatmap, rowPrice: this.selection.rowPrice, rowAlignment: 'footprint' as const } : this.selection.heatmap), candleMs: duration[this.selection.interval] };
    this.heatmapControls.sync(settings, supported, footprint); this.heatmapControls.setUnits(this.displayFootprintUnits);
    const instance = this.nativeIndicator(HEATMAP_ID);
    this.engine?.setHeatmap({ ...settings, enabled: settings.enabled && supported && (instance?.visible ?? true) }, duration[this.selection.interval]);
    const key = this.nativeIndicator(HEATMAP_ID) && supported ? `${instrumentKey(this.selection)}:${heatmapKey(settings)}` : '';
    if (key === this.heatmapSubscriptionKey) return;
    this.releaseHeatmap?.(); this.releaseHeatmap = undefined; this.heatmapSubscriptionKey = key;
    const generation = ++this.heatmapGeneration; this.heatmapStatus = undefined; this.heatmapControls.setStatus(undefined); this.heatmapControls.hover(null);
    this.engine?.updateHeatmap([], true, null);
    if (!key) return;
    this.heatmapStatus = { state: 'syncing', message: 'Connecting to the selected Binance book source.', tickSize: null, collectionStart: null, retentionStart: null, capacityLimited: false };
    this.heatmapControls.setStatus(this.heatmapStatus);
    this.renderActiveIndicators();
    this.releaseHeatmap = this.feed.subscribeHeatmap(this.params.api.id, settings, event => {
      if (this.dead || generation !== this.heatmapGeneration || event.type !== 'heatmap-batch') return;
      const previousState = this.heatmapStatus?.state;
      this.heatmapStatus = event.status;
      this.engine?.updateHeatmap(event.buckets, event.snapshot, event.status.retentionStart);
      if (this.visible && !document.hidden) this.heatmapControls.setStatus(event.status);
      if (previousState !== event.status.state) this.renderActiveIndicators();
    }, marketOf(this.selection));
  }

  private syncOrderWalls() {
    const instance = this.nativeIndicator(ORDER_WALLS_ID);
    const supported = this.selection.venue === 'binance';
    const settings = orderWallsSettings(instance?.settings ?? DEFAULT_ORDER_WALLS_SETTINGS);
    this.orderWallsControls.sync(settings, supported, Boolean(instance), Boolean(instance?.visible), this.selection);
    this.engine?.setOrderWalls({ ...settings, enabled: Boolean(instance?.visible && settings.enabled) }, duration[this.selection.interval]);
    if (!instance?.visible) this.heatmapControls.showSharedTooltip(null);

    const sourceKey = orderWallMarket(this.selection);
    if (this.orderWallsSubscriptionKey && this.orderWallsSubscriptionKey !== sourceKey) {
      this.releaseOrderWalls?.(); this.releaseOrderWalls = undefined;
      this.orderWallsGeneration++; this.orderWallsSubscriptionKey = ''; this.orderWallsSettingsKey = ''; this.orderWallsViewportKey = '';
      this.orderWallsStatus = undefined; this.engine?.setOrderWallSnapshot([], { state: 'loading', message: 'Waiting for the selected Binance book source.' });
    }

    if (!instance || !supported) {
      const status: OrderWallStatus | undefined = instance && !supported
        ? { state: 'unavailable', message: 'Hyperliquid order-book history is not supported by an available source.' }
        : undefined;
      const hadSource = Boolean(this.orderWallsSubscriptionKey || this.releaseOrderWalls);
      this.releaseOrderWalls?.(); this.releaseOrderWalls = undefined;
      if (hadSource) this.orderWallsGeneration++;
      this.orderWallsSubscriptionKey = ''; this.orderWallsSettingsKey = ''; this.orderWallsViewportKey = '';
      this.orderWallsStatus = status;
      this.engine?.setOrderWallSnapshot([], status ?? { state: 'loading', message: 'Order Walls is detached.' });
      this.orderWallsControls.setStatus(status);
      this.heatmapControls.showSharedTooltip(null);
      return;
    }

    this.orderWallsControls.setStatus(this.orderWallsStatus);
    this.updateOrderWallsViewport();
  }

  private updateOrderWallsViewport(from?: number, to?: number, low?: number, high?: number, height?: number) {
    const instance = this.nativeIndicator(ORDER_WALLS_ID);
    if (!instance || this.selection.venue !== 'binance') return;
    const visible = from === undefined || to === undefined ? this.engine?.visibleTimeRange() : null;
    const requestedFrom = from ?? (visible ? visible.from * 1000 : NaN);
    const requestedTo = to ?? (visible ? visible.to * 1000 : NaN);
    if (![requestedFrom, requestedTo].every(Number.isFinite) || requestedFrom >= requestedTo) return;
    const intervalMs = duration[this.selection.interval];
    const requestKey = `${Math.floor(requestedFrom / intervalMs) * intervalMs}:${Math.ceil(requestedTo / intervalMs) * intervalMs}`;
    const range = this.orderWallsRange(from, to);
    if (range) {
      const settings = orderWallsSettings(instance.settings), tickSize = this.selection.market === 'spot' ? 0.01 : 0.1;
      if (settings.aggregation === 'auto' && [low, high, height].every(Number.isFinite)) {
        this.orderWallsAutoPriceWidth = resolveAutoOrderWallPriceWidth(low!, high!, height!, tickSize);
      }
      const followLive = requestedTo >= Date.now() - intervalMs;
      this.ensureOrderWallsSubscription(range.from, range.to, settings,
        settings.aggregation === 'auto' ? this.orderWallsAutoPriceWidth : undefined, followLive, requestKey);
    }
  }

  private orderWallsRange(from?: number, to?: number) {
    const visible = from === undefined || to === undefined ? this.engine?.visibleTimeRange() : null;
    const visibleFrom = from ?? (visible ? visible.from * 1000 : NaN);
    const visibleTo = to ?? (visible ? visible.to * 1000 : NaN);
    if (!Number.isFinite(visibleFrom) || !Number.isFinite(visibleTo) || visibleFrom >= visibleTo) return null;
    const intervalMs = duration[this.selection.interval];
    const paddedFrom = Math.floor(visibleFrom / intervalMs) * intervalMs - intervalMs;
    const paddedTo = Math.ceil(visibleTo / intervalMs) * intervalMs + intervalMs;
    const retainedFrom = this.orderWallsStatus?.retentionStart;
    const range = { from: Math.max(0, retainedFrom ?? 0, paddedFrom), to: Math.min(Date.now(), paddedTo) };
    return range.from < range.to ? range : null;
  }

  private ensureOrderWallsSubscription(from: number, to: number, settings: OrderWallsSettings, autoPriceWidth?: number, followLive = false, requestKey = `${from}:${to}`) {
    const market = orderWallMarket(this.selection);
    const sourceKey = market;
    const settingsKey = JSON.stringify(settings);
    if (this.orderWallsSubscriptionKey && this.orderWallsSubscriptionKey !== sourceKey) {
      this.releaseOrderWalls?.(); this.releaseOrderWalls = undefined;
      this.orderWallsGeneration++; this.orderWallsSubscriptionKey = ''; this.orderWallsSettingsKey = ''; this.orderWallsViewportKey = '';
      this.orderWallsStatus = undefined; this.engine?.setOrderWallSnapshot([], { state: 'loading', message: 'Waiting for the selected Binance book source.' });
    }
    if (this.orderWallsSubscriptionKey === sourceKey) {
      if (settingsKey !== this.orderWallsSettingsKey) {
        this.feed.updateOrderWalls(this.params.api.id, settings); this.orderWallsSettingsKey = settingsKey;
      }
      const rangeKey = `${requestKey}:${settings.aggregation === 'auto' ? autoPriceWidth : ''}:${followLive ? 1 : 0}`;
      if (rangeKey !== this.orderWallsViewportKey) {
        this.feed.updateOrderWallsViewport(this.params.api.id, from, to, autoPriceWidth); this.orderWallsViewportKey = rangeKey;
      }
      return;
    }

    this.releaseOrderWalls?.(); this.releaseOrderWalls = undefined;
    this.orderWallsSubscriptionKey = sourceKey; this.orderWallsSettingsKey = settingsKey;
    this.orderWallsViewportKey = `${requestKey}:${settings.aggregation === 'auto' ? autoPriceWidth : ''}:${followLive ? 1 : 0}`;
    const generation = ++this.orderWallsGeneration;
    this.orderWallsStatus = { state: 'loading', message: 'Loading walls for the visible chart range…' };
    this.engine?.setOrderWallSnapshot([], this.orderWallsStatus);
    this.orderWallsControls.setStatus(this.orderWallsStatus);
    this.releaseOrderWalls = this.feed.subscribeOrderWalls(this.params.api.id, { market, from, to, settings,
      ...(autoPriceWidth !== undefined ? { autoPriceWidth } : {}), followLive }, event => {
      if (this.dead || generation !== this.orderWallsGeneration || !this.nativeIndicator(ORDER_WALLS_ID)) return;
      this.orderWallsStatus = (event.kind === 'snapshot'
        ? this.engine?.setOrderWallSnapshot(event.segments ?? [], event.status)
        : this.engine?.patchOrderWalls(event.patches ?? [], event.status)) ?? event.status;
      this.orderWallsControls.setStatus(this.orderWallsStatus);
      this.renderActiveIndicators();
      if (event.status.retentionStart !== undefined) this.updateOrderWallsViewport();
    });
  }

  private subscribeFootprint() {
    const wanted = this.footprintDataWanted();
    const key = wanted ? `${this.selectionEpoch}:${instrumentKey(this.selection)}:${this.selection.interval}:${this.selection.rowPrice}` : '';
    if (key === this.footprintSubscriptionKey) return;
    this.releaseFootprint?.(); this.releaseFootprint = undefined; this.footprintSubscriptionKey = key;
    const generation = ++this.footprintGeneration; this.footprintBars = []; this.footprintAnalysisSummaries.clear(); this.engine?.setFootprintAnalysisSummaries([]); this.footprintSnapshotSignature = undefined; this.footprintNeedsSync = true; this.footprintHasInitialView = false;
    if (wanted) this.engine?.setFootprintBars([], false);
    if (!key) return;
    const epoch = this.selectionEpoch;
    const selection = this.selection;
    this.footprintStatus = {
      state: 'loading', message: `Connecting to ${instrumentLabel(selection)} aggregate trades…`, lastUpdate: 0,
      tickSize: null, rowSize: null, collectionStartedAt: null, firstTradeAt: null, lastTradeAt: null, eventTime: null,
      outages: 0, lateRecords: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0,
      coverage: 'waiting', retentionStart: null,
    };
    this.updateFootprintMetadata();
    this.renderActiveIndicators();
    this.releaseFootprint = this.feed.subscribeFootprint(this.params.api.id, selection, selection.rowPrice, event => {
      if (this.dead || epoch !== this.selectionEpoch || generation !== this.footprintGeneration || !this.footprintDataWanted()) return;
      const previousState = this.footprintStatus.state;
      if ((event.type === 'footprint-snapshot' || event.type === 'footprint-patch') && event.status) {
        this.footprintStatus = event.status;
        this.updateFootprintMetadata();
        this.updateStatus();
        this.persistValidatedFootprintPrice(event.status);
      }
      if (event.type === 'footprint-status') {
        this.footprintStatus = event.status;
        this.updateFootprintMetadata();
        this.updateStatus();
        this.persistValidatedFootprintPrice(event.status);
      } else if (event.type === 'footprint-snapshot') {
        const nextBars = event.bars.slice().sort((a, b) => a.time - b.time);
        const nextSignature = footprintSnapshotSignature(nextBars);
        const unchanged = sameFootprintSnapshot(this.footprintSnapshotSignature, nextSignature);
        this.footprintBars = nextBars;
        this.footprintSnapshotSignature = nextSignature;
        this.footprintStatus = { ...this.footprintStatus, retentionStart: event.retentionStart };
        if (this.visible && this.footprintDataWanted()) {
          if (!unchanged || this.footprintNeedsSync) this.engine?.setFootprintBars(this.footprintBars, true);
          this.footprintNeedsSync = false;
          this.focusFootprintOnce();
          this.refreshFootprintCellTooltip();
        } else this.footprintNeedsSync = true;
      } else if (event.type === 'footprint-patch') {
        this.footprintSnapshotSignature = undefined;
        this.mergeFootprints(event.bars, event.retentionStart);
        this.footprintStatus = { ...this.footprintStatus, retentionStart: event.retentionStart };
        if (this.visible && this.footprintDataWanted()) {
          this.engine?.applyFootprintPatch(event.bars, event.retentionStart);
          this.footprintNeedsSync = false;
          this.focusFootprintOnce();
          const hoveredTime = this.hoveredFootprint?.time;
          const hoveredBarRetained = hoveredTime === undefined || this.barAt(hoveredTime) !== undefined;
          const hoveredBarUpdated = hoveredTime !== undefined && event.bars.some(bar => bar.time === hoveredTime);
          if (!hoveredBarRetained) { this.hoveredFootprint = null; this.footprintCellTooltipIdentity = ''; }
          if (!hoveredBarRetained || !this.hoveredFootprint || hoveredBarUpdated) this.refreshFootprintCellTooltip();
        } else this.footprintNeedsSync = true;
      }
      if ('analysisSummaries' in event && event.analysisSummaries) this.replaceFootprintAnalysisSummaries(event.analysisSummaries);
      if (event.type === 'footprint-snapshot' || event.type === 'footprint-patch') { this.updateStatus(); this.syncPaneLoadingStates(); this.refreshPositioningRange(); }
      if (previousState !== this.footprintStatus.state) this.renderActiveIndicators();
    });
    this.updateStatus();
  }

  private replaceFootprintAnalysisSummaries(summaries: readonly FootprintAnalysisSummary[]) {
    this.footprintAnalysisSummaries.clear();
    for (const summary of summaries.slice(-512)) this.footprintAnalysisSummaries.set(summary.time, summary);
    this.engine?.setFootprintAnalysisSummaries([...this.footprintAnalysisSummaries.values()].sort((a, b) => a.time - b.time));
  }

  private mergeFootprints(patches: FootprintBar[], retentionStart: number | null) {
    if (retentionStart === null) this.footprintBars = [];
    else if (retentionStart !== undefined) this.footprintBars = this.footprintBars.filter(bar => bar.time >= retentionStart);
    for (const bar of patches) {
      const index = lowerBoundFootprintBar(this.footprintBars, bar.time);
      if (this.footprintBars[index]?.time === bar.time) this.footprintBars[index] = bar;
      else this.footprintBars.splice(index, 0, bar);
    }
    this.footprintBars = this.footprintBars.slice(-300);
  }

  private crosshair(event: CrosshairMoveEvent) {
    const positioning = event.paneIndex == null ? undefined : this.selection.indicators.find(instance => instance.visible
      && instance.settingsVersion === 1 && instance.source.kind === 'chart'
      && NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number])
      && this.engine?.netPositioningPaneIndex(instance.instanceId) === event.paneIndex);
    if (positioning && event.time !== null) {
      this.hoveredBar = null; this.hoveredFootprint = null; this.footprintCellTooltipIdentity = ''; this.footprintCellTooltipPoint = null;
      const plot = this.engine?.chart.plotRect(event.paneIndex!);
      const hit = event.point && plot ? this.engine?.netPositioningHover(positioning.instanceId, event.point.x - plot.left, event.point.y - plot.top) : null;
      if (hit && plot) {
        const show = () => {
          if (this.dead || !this.visible || !this.nativeIndicator(positioning.definitionId)?.visible) return;
          this.setPositioningTooltipKind('net-positioning');
          renderPositioningTooltip(this.positioningTooltip, hit);
          this.positioningTooltip.hidden = false; this.positioningRangeHit = hit; this.refreshPositioningRange();
          this.placeIndicatorTooltip(plot, hit);
        };
        this.setPositioningTooltipKind('net-positioning');
        this.positioningTooltip.hidden = true;
        this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
        if (this.indicatorTooltipReady(`positioning:${positioning.instanceId}`, show)) show();
        else this.positioningTooltip.hidden = true;
      } else {
        this.cancelIndicatorTooltip();
      }
      return;
    }
    const footprintTotals = event.paneIndex == null ? undefined : this.selection.indicators.find(instance => instance.visible
      && instance.settingsVersion === 1 && instance.source.kind === 'chart' && instance.definitionId === FOOTPRINT_TOTALS_ID
      && this.engine?.footprintTotalsPaneIndex(instance.instanceId) === event.paneIndex);
    if (footprintTotals && event.time !== null) {
      this.hoveredBar = null; this.hoveredFootprint = null; this.footprintCellTooltipIdentity = ''; this.footprintCellTooltipPoint = null;
      const plot = this.engine?.chart.plotRect(event.paneIndex!);
      const hit = event.point && plot ? this.engine?.footprintTotalsHover(footprintTotals.instanceId, event.time, event.point.x - plot.left, event.point.y - plot.top) : null;
      if (hit && plot) {
        const show = () => {
          if (this.dead || !this.visible || !this.nativeIndicator(FOOTPRINT_TOTALS_ID)?.visible) return;
          this.setPositioningTooltipKind('footprint-totals');
          renderFootprintTotalsTooltip(this.positioningTooltip, hit, hit.other, { interval: this.selection.interval, source: instrumentLabel(this.selection), coverage: hit.coverage, gapBefore: hit.gapBefore });
          this.positioningTooltip.hidden = false; this.placeIndicatorTooltip(plot, hit);
        };
        this.setPositioningTooltipKind('footprint-totals');
        this.positioningTooltip.hidden = true;
        this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
        if (this.indicatorTooltipReady(`footprint-totals:${footprintTotals.instanceId}`, show)) show();
        else this.positioningTooltip.hidden = true;
      } else this.cancelIndicatorTooltip();
      return;
    }
    this.positioningTooltip.hidden = true;
    this.setPositioningTooltipKind('');
    this.positioningRangeHit = null;
    this.engine?.setPositioningRange(null);
    this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
    const engine = this.engine;
    const plot = engine?.chart.plotRect(engine.chart.primaryPaneIndex());
    const point = event.point;
    let footprintHover: FootprintHover | null = null;
    if (engine && point && event.time !== null && event.source !== 'linked' && !event.pressed && event.pointerType !== 'touch'
      && !this.chart.hasAttribute('data-drawing-placement') && !engine.drawings.erasing()
      && this.selection.type === 'footprint'
      && event.paneIndex === engine.chart.primaryPaneIndex()) {
      footprintHover = engine.footprintAt(point.x, point.y);
    }
    const rawBar = footprintHover && footprintHover.cell !== null && footprintHover.price !== null && footprintHover.time === event.time
      ? this.barAt(footprintHover.time) : undefined;
    const hasRawCell = Boolean(rawBar && footprintHover?.price !== null && rawBar.cells.some(cell => cell.price === footprintHover?.price));
    if (footprintHover && hasRawCell && point) {
      this.hoveredBar = null;
      this.hoveredFootprint = footprintHover;
      const identity = this.footprintCellIdentity(footprintHover);
      this.footprintCellTooltipIdentity = identity;
      this.footprintCellTooltipPoint = { ...point };
      this.setPositioningTooltipKind('footprint-cell');
      this.positioningTooltip.hidden = true;
      this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
      const show = () => this.showFootprintCellTooltip(identity);
      if (this.indicatorTooltipReady(`footprint-cell:${identity}`, show)) show();
      return;
    }
    this.footprintCellTooltipIdentity = '';
    this.footprintCellTooltipPoint = null;
    const wallHit: OrderWallHit | null = point && plot ? this.engine?.orderWallAt(point.x - plot.left, point.y - plot.top) ?? null : null;
    const heatHit = point && plot ? this.engine?.heatmapAt(point.x - plot.left, point.y - plot.top) ?? null : null;
    if (wallHit && this.nativeIndicator(ORDER_WALLS_ID)?.visible) {
      const text = this.orderWallsControls.tooltip(wallHit, this.selection, this.orderWallsStatus);
      const show = () => { if (!this.dead && this.visible && this.nativeIndicator(ORDER_WALLS_ID)?.visible) this.heatmapControls.showSharedTooltip(text); };
      if (this.indicatorTooltipReady('order-walls', show)) show();
      else this.heatmapControls.showSharedTooltip(null);
    } else if (heatHit) {
      const show = () => { if (!this.dead && this.visible && this.nativeIndicator(HEATMAP_ID)?.visible) this.heatmapControls.hover(heatHit); };
      if (this.indicatorTooltipReady('heatmap', show)) show();
      else this.heatmapControls.hover(null);
    } else this.cancelIndicatorTooltip();
    if (event.point === null || event.time === null) {
      this.hoveredBar = null;
      this.hoveredFootprint = null;
    } else if (this.selection.type === 'footprint') {
      this.hoveredBar = null;
      this.hoveredFootprint = footprintHover;
    } else {
      this.hoveredFootprint = null;
      this.hoveredBar = event.bar;
    }
  }

  private indicatorTooltipReady(key: string, activate: () => void) {
    if (this.indicatorHoverPointerType === 'touch' || this.indicatorPointerDown || this.indicatorTooltipBlockedUntilMove || document.hidden) {
      this.cancelIndicatorTooltip(); return false;
    }
    const ready = this.indicatorTooltipDwell.request(key, () => {
      if (!this.dead && this.visible && !document.hidden && !this.indicatorPointerDown && !this.indicatorTooltipBlockedUntilMove) activate();
    });
    if (!ready) {
      this.positioningTooltip.hidden = true;
      this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
    }
    return ready;
  }

  private bindIndicatorHintRoot(root: HTMLElement, includeAllTitles = false) {
    if (!this.indicatorHintRootReleases.has(root)) {
      this.indicatorHintRootReleases.set(root, this.indicatorTitleHints.addRoot(root, { includeAllTitles }));
    }
  }

  private unbindIndicatorHintRoot(root: HTMLElement) {
    this.indicatorHintRootReleases.get(root)?.();
    this.indicatorHintRootReleases.delete(root);
  }

  private cancelIndicatorTooltip() {
    this.indicatorTooltipDwell.clear();
    this.positioningTooltip.hidden = true;
    this.setPositioningTooltipKind('');
    this.footprintCellTooltipIdentity = '';
    this.footprintCellTooltipPoint = null;
    this.positioningRangeHit = null;
    this.engine?.setPositioningRange(null);
    this.heatmapControls?.showSharedTooltip(null);
    this.heatmapControls?.hover(null);
  }

  private refreshPositioningRange(){
    const hit=this.positioningRangeHit;if(!hit||this.positioningTooltip.hidden)return;
    const range=this.rangeForPositioningHit(hit);this.engine?.setPositioningRange(range);
    let hint=this.positioningTooltip.querySelector<HTMLElement>('[data-positioning-range-hint]');
    if(!hint){hint=document.createElement('div');hint.dataset.positioningRangeHint='true';hint.className='positioning-tooltip-muted positioning-tooltip-status';this.positioningTooltip.append(hint);}
    hint.textContent=range?`${positioningRangeLabel(range)} · VAL ${range.low.toLocaleString('en-US')} / VAH ${range.high.toLocaleString('en-US')} · Double-click bar to save zone`
      :this.footprintStatus.state==='loading'&&supportsDepth(this.selection)?'Loading candle VAH/VAL…':'Candle VAH/VAL unavailable · no entry-price range inferred';
    if(range){const icon=document.createElement('img');icon.src=venueIconPath(range.venue);icon.alt='';icon.width=12;icon.height=12;icon.style.verticalAlign='middle';hint.prepend(icon,document.createTextNode(' '));const ref=document.createElement('img');ref.src=venueIconPath(this.selection.venue);ref.alt='';ref.width=12;ref.height=12;ref.style.verticalAlign='middle';hint.append(document.createTextNode(' · Chart candle '),ref,document.createTextNode(` ${venueBadge(this.selection.venue,marketOf(this.selection))}`));}
  }
  private rangeForPositioningHit(hit:{timeMs:number;intervalMs:number;side:'longs'|'shorts';method:import('./feed/net-positioning').NetPositioningMethod;hoveredVenue:import('./feed/net-positioning').NetPositioningVenue;sources:{sourceId:string;baseValue:number|null;quoteValue:number|null}[]}):PositioningRange|null {
    const area=candleValueArea(this.barAt(hit.timeMs/1000)),source=hit.sources.find(s=>s.sourceId===hit.hoveredVenue);
    return area?{...area,baseAmount:source?.baseValue??null,quoteAmount:source?.quoteValue??null,timeMs:hit.timeMs,endMs:hit.timeMs+hit.intervalMs,side:hit.side,method:hit.method,venue:hit.hoveredVenue,reference:instrumentLabel(this.selection)}:null;
  }
  private positioningRangeAt(x:number,y:number){
    for(const instance of this.selection.indicators){
      if(!instance.visible||instance.source.kind!=='chart'||!NET_POSITIONING_IDS.includes(instance.definitionId as typeof NET_POSITIONING_IDS[number]))continue;
      const index=this.engine?.netPositioningPaneIndex(instance.instanceId),plot=index==null?null:this.engine?.chart.plotRect(index);
      if(!plot||x<plot.left||x>plot.left+plot.width||y<plot.top||y>plot.top+plot.height)continue;
      const hit=this.engine?.netPositioningHover(instance.instanceId,x-plot.left,y-plot.top);
      if(hit)return {hit,range:this.rangeForPositioningHit(hit)};
    }
    return null;
  }
  private addPositioningRange(range:PositioningRange){
    const engine=this.engine;if(!engine||this.dead)return;
    const color=range.side==='longs'?engine.chart.theme().buy:engine.chart.theme().sell;
    const visible=engine.chart.timeScale.visibleRange(),edge=engine.chart.dataLayer.indexToTimeFloat(visible.to);
    const rightTime=Number.isFinite(edge)?Math.max(range.endMs/1000,edge):range.endMs/1000;
    engine.drawings.add({tool:'rectangle',paneIndex:engine.objects.primaryPaneIndex(),
      points:[{time:range.timeMs/1000,price:range.high},{time:rightTime,price:range.low}],
      style:{color,lineWidth:1,lineStyle:'dashed',fill:true,fillColor:color,fillOpacity:.12,showLabels:true},
      text:{value:positioningRangeLabel(range),fontSize:10},
      props:{iqterminal:{version:IQ_DRAWING_META_VERSION},iqterminalLabelState:'custom',iqterminalLabel:positioningRangeLabel(range),iqterminalAnalysisInterval:'',positioningRange:{...range}}});
    engine.objects.refresh();this.syncDrawingActions();
  }

  private placeIndicatorTooltip(plot: { left: number; top: number }, hit: { left: number; top: number; bottom: number }) {
    const width = this.positioningTooltip.offsetWidth, height = this.positioningTooltip.offsetHeight;
    const x = plot.left + hit.left, top = plot.top + hit.top - height - 8;
    this.positioningTooltip.style.left = `${Math.max(4, Math.min(this.chart.clientWidth - width - 4, x - width / 2))}px`;
    this.positioningTooltip.style.top = `${Math.max(4, Math.min(this.chart.clientHeight - height - 4, top >= 4 ? top : plot.top + hit.bottom + 8))}px`;
  }

  private visibility() {
    const nextVisible = this.params.api.isVisible;
    if (this.visible && !nextVisible) this.engine?.capturePendingView();
    this.visible = nextVisible;
    if (!this.visible) { this.cancelIndicatorTooltip(); this.indicatorTitleHints.clear(); }
    this.studyHost?.setVisible(this.visible);
    this.orderFlowPaneView?.setVisible(this.visible);
    this.cvdData?.setHostVisible(this.visible);
    this.conditionsView?.setVisible(this.visible); this.cvdView?.setVisible(this.visible); this.openInterestView?.setVisible(this.visible); this.openInterestData?.setHostVisible(this.visible); this.liquidationsView?.setVisible(this.visible);
    this.tradeBubblesView?.setHostVisible(this.visible);
    this.effortView?.setVisible(this.visible);
    if (this.engine) {
      this.engine.visible = this.visible;
      if (this.visible) this.scheduler.invalidate(this.engine);
    }
    this.syncNetPositioning();
    this.syncTpo();
    if (this.visible) {
      this.heatmapControls.setStatus(this.heatmapStatus);
      if (this.footprintDataWanted() && this.footprintNeedsSync) {
        this.engine?.setFootprintBars(this.footprintBars, true);
        this.footprintNeedsSync = false;
      }
      if (this.selection.type === 'footprint') {
        this.focusFootprintOnce();
      }
      this.refreshFootprintCellTooltip();
      this.updateStatus();
    }
  }

  private footprintCellIdentity(hover: FootprintHover) {
    return `${this.selectionEpoch}:${instrumentKey(this.selection)}:${this.selection.interval}:${this.selection.rowPrice}:${this.displayFootprintUnits}:${hover.time}:${hover.price}`;
  }

  private showFootprintCellTooltip(identity: string) {
    if (identity !== this.footprintCellTooltipIdentity) return;
    if (this.dead || !this.visible || document.hidden || this.indicatorHoverPointerType === 'touch'
      || this.indicatorPointerDown || this.indicatorTooltipBlockedUntilMove || this.chart.hasAttribute('data-drawing-placement')
      || this.engine?.drawings.erasing() || this.selection.type !== 'footprint') return;
    const hover = this.hoveredFootprint;
    if (!hover || hover.cell === null || hover.price === null) {
      this.positioningTooltip.hidden = true;
      this.setPositioningTooltipKind('');
      this.footprintCellTooltipIdentity = '';
      this.footprintCellTooltipPoint = null;
      this.indicatorTooltipDwell.clear();
      return;
    }
    if (this.footprintCellIdentity(hover) !== identity) return;
    const bar = this.barAt(hover.time);
    const data = bar ? footprintCellTooltipData(bar, hover, this.displayFootprintUnits, {
      interval: this.selection.interval, timezone: getDisplayTimezone(),
      quoteUnavailableHint: getCurrencyPreference().enabled
        ? 'USDT unavailable · switch Global settings to Base (BTC)' : 'USDT unavailable · select BTC',
    }) : null;
    if (!data) {
      this.positioningTooltip.hidden = true;
      this.setPositioningTooltipKind('');
      this.footprintCellTooltipIdentity = '';
      this.footprintCellTooltipPoint = null;
      this.indicatorTooltipDwell.clear();
      return;
    }
    this.setPositioningTooltipKind('footprint-cell');
    renderFootprintCellTooltip(this.positioningTooltip, data);
    this.positioningTooltip.hidden = false;
    this.heatmapControls.showSharedTooltip(null); this.heatmapControls.hover(null);
    this.placeFootprintCellTooltip(this.footprintCellTooltipPoint);
  }

  private refreshFootprintCellTooltip() {
    if (this.positioningTooltip.dataset.tooltipKind !== 'footprint-cell' || this.positioningTooltip.hidden) return;
    this.showFootprintCellTooltip(this.footprintCellTooltipIdentity);
  }

  private setPositioningTooltipKind(kind: '' | 'net-positioning' | 'footprint-totals' | 'footprint-cell') {
    this.positioningTooltip.classList.remove('footprint-totals-tooltip', 'footprint-cell-tooltip');
    this.positioningTooltip.dataset.tooltipKind = kind;
    if (kind === 'footprint-totals') this.positioningTooltip.classList.add('footprint-totals-tooltip');
    else if (kind === 'footprint-cell') this.positioningTooltip.classList.add('footprint-cell-tooltip');
  }

  private placeFootprintCellTooltip(point: { x: number; y: number } | null) {
    if (!point) return;
    const width = this.positioningTooltip.offsetWidth, height = this.positioningTooltip.offsetHeight;
    const left = Math.max(4, Math.min(this.chart.clientWidth - width - 4, point.x - width / 2));
    const above = point.y - height - 8 >= 4;
    const top = above ? point.y - height - 8 : point.y + 8;
    this.positioningTooltip.style.left = `${left}px`;
    this.positioningTooltip.style.top = `${Math.max(4, Math.min(this.chart.clientHeight - height - 4, top))}px`;
  }

  private barAt(time: number) {
    const index = lowerBoundFootprintBar(this.footprintBars, time);
    return this.footprintBars[index]?.time === time ? this.footprintBars[index] : undefined;
  }

  private focusFootprintOnce() {
    if (this.selection.type !== 'footprint' || this.footprintHasInitialView || !this.footprintBars.length) return;
    this.engine?.focusFootprintLatest();
    this.footprintHasInitialView = true;
  }

  private updateFootprintMetadata() {
    if(this.selection.type!=='footprint'){this.updateInstrumentMetadata();return;}
    const info = instrumentOf(this.selection);
    const row = this.footprintStatus.rowSize;
    const text = `Price level (USDT) · $${formatFootprintPrice(this.selection.rowPrice)}${row === null || Math.abs(row - this.selection.rowPrice) < 1e-8 ? '' : ` · aligned to $${formatFootprintPrice(row)}`}`;
    const title = `${this.footprintStatus.message}; ${this.footprintStatus.coverage} coverage; `
      + `${this.footprintStatus.collectionStartedAt ? `collection began ${new Date(this.footprintStatus.collectionStartedAt).toISOString()}` : 'waiting for the collection subscription to start'}`;
    if (this.metadata.textContent !== text) this.metadata.textContent = text;
    if (this.metadata.title !== title) this.metadata.title = title;
    if (this.metadata.dataset.mode !== 'footprint') this.metadata.dataset.mode = 'footprint';
    if (this.footprintStatus.tickSize !== null && Number.isFinite(this.footprintStatus.tickSize)) {
      this.rowPrice.step = String(this.footprintStatus.tickSize);
      this.rowPrice.min = String(this.footprintStatus.tickSize);
    }
  }

  private persistValidatedFootprintPrice(status: FootprintStatus) {
    if (status.tickSize === null || status.rowSize === null || this.selection.type !== 'footprint') return;
    if (this.params.api.getParameters<PanelConfig>().rowPrice === this.selection.rowPrice) return;
    this.params.api.updateParameters(this.selection);
    this.save();
  }

  private updateInstrumentMetadata() {
    const info = instrumentOf(this.selection);
    this.metadata.textContent = marketOf(this.selection) === 'spot'
      ? `${info.quote} quote · ${info.base} volume · UTC`
      : `${info.quote} quote · ${info.base} volume · ${info.settlement} settlement · UTC`;
    this.instrument.title = info.settlement
      ? `${info.kind}; quote ${info.quote}; base volume ${info.base}; settlement/collateral ${info.settlement}`
      : `${info.kind}; quote ${info.quote}; base volume ${info.base}; no derivative collateral metadata`;
    this.metadata.dataset.mode = 'candle';
  }

  private updateDepthNotice() {
    const notices = this.studyHost?.depthNotices() ?? [];
    this.depthNotice.hidden = notices.length === 0;
    this.depthNotice.textContent = notices.map(notice => notice.text).join('   ·   ');
    this.depthNotice.title = notices.map(notice => notice.details).join('\n');
    this.depthNotice.dataset.state = notices.some(notice => /^(Depth unavailable|Unavailable:)/.test(notice.text)) ? 'unavailable' : 'available';
  }

  private updateStatus() {
    if (!this.visible || document.hidden) return;
    const isFootprint = this.selection.type === 'footprint';
    const status = isFootprint ? this.footprintStatus : this.status;
    const latestFootprint = isFootprint ? this.footprintBars.at(-1) : undefined;
    const quoteUnavailable = this.displayFootprintUnits === 'usdt' && latestFootprint !== undefined
      && !hasCompleteFootprintQuote(latestFootprint);
    const quoteHint = getCurrencyPreference().enabled
      ? 'USDT notional unavailable · switch Global settings to Base (BTC)'
      : 'USDT notional unavailable · select BTC';
    const text = status.state === 'failed' ? 'Data unavailable' : status.state === 'stale' ? 'Updates paused'
      : quoteUnavailable ? quoteHint : '';
    if (this.statusText.textContent !== text) { this.statusText.textContent = text; this.statusText.title = text; }
    if (this.statusNode.dataset.state !== status.state) this.statusNode.dataset.state = status.state;
    this.statusNode.dataset.quoteAvailability = quoteUnavailable ? 'unavailable' : 'available';
    const showRetry = status.state === 'failed' || status.state === 'stale';
    if (this.statusText.parentElement !== this.statusNode || (this.retry.parentElement === this.statusNode) !== showRetry) {
      this.statusNode.replaceChildren(this.statusText, ...(showRetry ? [this.retry] : []));
    }
    this.syncPaneLoadingStates();
    const noData = !this.engine?.barCount;
    const statusParent = noData ? this.chart : this.chartFooter;
    if (this.statusNode.parentElement !== statusParent) statusParent.append(this.statusNode);
    if (this.statusNode.classList.contains('no-data') !== noData) this.statusNode.classList.toggle('no-data', noData);
    this.statusNode.hidden = !text;
    this.syncChartFooterVisibility();
  }

  private syncChartFooterVisibility() {
    const hasVisibleRow = [...this.chartFooter.children].some(child => !(child as HTMLElement).hidden);
    if (this.chartFooter.hidden === hasVisibleRow) this.chartFooter.hidden = !hasVisibleRow;
  }

  draw() { this.engine?.draw(); }

  get studies() { return this.studyHost; }
  get series() { return this.selection; }

  private mergeCandles(patch: import('./feed/protocol').Candle[]) {
    for (const candle of patch) {
      const index = lowerBoundCandle(this.candles, candle.t);
      if (this.candles[index]?.t === candle.t) this.candles[index] = candle;
      else this.candles.splice(index, 0, candle);
    }
    if (this.candles.length > 5_000) this.candles.splice(0, this.candles.length - 5_000);
  }

  diagnostics() {
    const range = this.engine?.visibleRange();
    const bar = this.engine?.latestCandle();
    const latestFootprint = this.footprintBars.at(-1);
    const priceScale = this.engine?.chart.panes()[this.engine?.chart.primaryPaneIndex() ?? -1]?.priceScale;
    const priceRange = priceScale?.priceRange();
    return {
      id: this.params.api.id,
      visible: this.visible,
      bars: this.engine?.barCount ?? 0,
      right: range?.to ?? 0,
      range,
      spacing: this.engine?.chart.timeScale.barSpacing ?? 0,
      rightOffset: this.engine?.chart.timeScale.rightOffset ?? 0,
      autoPrice: priceScale?.autoScale ?? true,
      min: priceRange?.min ?? 0,
      max: priceRange?.max ?? 0,
      renderer: this.engine ? {
        draws: this.engine.stats.draws,
        backend: this.engine.backend,
      } : null,
      status: this.status,
      series: this.selection,
      last: bar ? { t: bar.time * 1000, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume ?? 0 } : null,
      footprint: {
        bars: this.footprintBars.length,
        latest: latestFootprint ? {
          time: latestFootprint.time, revision: latestFootprint.revision, cellCount: latestFootprint.cells.length,
          coverage: latestFootprint.coverage, gapBefore: latestFootprint.gapBefore,
          open: latestFootprint.open, high: latestFootprint.high, low: latestFootprint.low,
          close: latestFootprint.close, delta: latestFootprint.delta,
        } : null,
        status: this.footprintStatus,
        needsSync: this.footprintNeedsSync,
        initialViewSet: this.footprintHasInitialView,
        primitiveSets: this.engine?.stats.footprintSets ?? 0,
        surfaceMounted: this.engine?.footprintSurfaceMounted ?? false,
        hover: this.hoveredFootprint,
      },
      footprintTotals: this.engine?.footprintTotalsDiagnostics() ?? [],
      cvd: this.cvdView?.diagnostics(),
      openInterest: this.openInterestView?.diagnostics(),
      tradeBubbles: this.tradeBubblesView?.diagnostics(),
      liquidations: this.liquidationsView?.diagnostics(),
      tpo: { ...this.engine?.tpoDiagnostics(), status: this.tpoStatus, settings: this.tpoSettings() },
      heatmap: { ...this.engine?.heatmapDiagnostics(), status: this.heatmapStatus, settings: this.selection.heatmap },
      effortResult: this.effortView?.diagnostics(),
      marketConditions: this.conditionsView?.diagnostics(),
      netPositioning: { panes: this.engine?.netPositioningDiagnostics() ?? [], request: this.netPositioningRequestKey,
        histories: [...this.netPositioningHistories.values()].map(history => history.diagnostics()), errors: Object.fromEntries(this.netPositioningErrors) },
      positioningRange: this.engine?.positioningRangeDiagnostics(),
      executionHoverRay: this.engine?.executionHoverDiagnostics() ?? { active: false, executionId: null, geometry: null },
      orderWalls: { ...this.engine?.orderWallsDiagnostics(), status: this.orderWallsStatus,
        settings: orderWallsSettings(this.nativeIndicator(ORDER_WALLS_ID)?.settings ?? DEFAULT_ORDER_WALLS_SETTINGS) },
      studies: this.studyHost?.diagnostics(),
      compositionWork: { ...this.compositionWork, sma: compositionSmaDiagnostics() },
      managedPaneResolutions: this.compositionPlacement?.paneResolutionDiagnostics() ?? [],
    };
  }

  resetCompositionDiagnostics() {
    this.compositionWork = { indicatorReconciles: 0, activeIndicatorRenders: 0, objectRefreshes: 0, scriptObjectProviderSyncs: 0, dataCallbacks: 0, visibleRangeScaleUpdates: 0, autoscaleValuesScanned: 0 };
    this.studyHost?.resetDiagnostics();
    resetCompositionSmaMetrics();
  }

  dispose() {
    this.cancelIndicatorTooltip();
    this.cancelWatchPick?.();
    for (const release of this.indicatorHintRootReleases.values()) release(); this.indicatorHintRootReleases.clear();
    this.indicatorTitleHints.dispose(); this.indicatorTooltipDwell.dispose();
    this.dead = true;
    this.objectsTreeMenu.hidden = true;
    this.floatingDrawingToolbar?.dispose();
    this.objectsTreeMenu.remove();
    this.objectsPanel.remove();
    for (const host of this.paneIndicatorHosts.values()) host.remove(); this.paneIndicatorHosts.clear();
    for (const host of this.paneControlHosts.values()) host.element.remove(); this.paneControlHosts.clear();
    this.paneIndicatorLayer.remove(); this.indicatorRowViews.clear();
    this.paneLoadingLayer.remove(); this.paneLoaders.clear();
    this.objectsRows.replaceChildren();
    this.objectRows.clear();
    this.objectPaneSections.clear();
    this.treeRows.clear();
    this.treeNodes.clear();
    this.selectionEpoch++;
    clearInterval(this.timer);
    this.toolbarResizeObserver?.disconnect();
    this.chartFooterObserver?.disconnect();
    this.abort.abort(); this.marketPicker.dispose();
    if (this.paneIndicatorLayoutFrame !== undefined) cancelAnimationFrame(this.paneIndicatorLayoutFrame);
    if (this.picker.open) this.picker.close();
    if (this.vwapControls.dialog.open) this.vwapControls.dialog.close();
    if (this.settingsDialog.open) this.settingsDialog.close();
    if (this.footprintDialog.open) this.footprintDialog.close();
    if (this.chartSettingsDialog.open) this.chartSettingsDialog.close();
    if (this.drawingDialog.open) this.drawingDialog.close();
    if (this.templatesDialog.open) this.templatesDialog.close();
    this.templateUnsubscribe?.(); this.templateUnsubscribe = undefined;
    this.releaseWatchObjects?.(); this.releaseWatchObjects = undefined;
    this.coreObjectProviderReleases.forEach(release => release()); this.coreObjectProviderReleases = [];
    for (const release of this.scriptObjectProviderReleases.values()) release(); this.scriptObjectProviderReleases.clear();
    this.release?.();
    this.releaseHeatmap?.(); this.heatmapGeneration++; this.heatmapControls.dispose();
    this.effortView?.dispose(); this.effortView = undefined;
    this.liquidationsView?.dispose(); this.liquidationsView=undefined;this.hiddenLiquidationControls?.dispose();this.hiddenLiquidationControls=undefined;
    this.tradeBubblesView?.dispose(); this.tradeBubblesView = undefined;
    this.disposeOrderFlowPane();
    this.cvdView?.dispose(); this.cvdView=undefined; this.cvdData?.dispose();this.cvdData=undefined;this.hiddenCvdControls?.dispose();this.hiddenCvdControls=undefined;
    this.openInterestView?.dispose(); this.openInterestView = undefined; this.openInterestData?.dispose(); this.openInterestData = undefined;
    this.hiddenOpenInterestControls?.dispose(); this.hiddenOpenInterestControls = undefined;
    this.conditionsView?.dispose(); this.conditionsView = undefined; this.hiddenConditionsControls?.dispose(); this.hiddenConditionsControls = undefined;
    this.releaseNetPositioning?.(); this.releaseNetPositioning = undefined; this.netPositioningGeneration++; this.netPositioningControls.dispose();
    this.footprintTotalsControls.dispose();
    this.releaseOrderWalls?.(); this.orderWallsGeneration++; this.orderWallsControls.dispose();
    this.releaseTpo?.(); this.tpoGeneration++; this.tpoControls.dispose();
    this.releaseFootprint?.(); this.footprintGeneration++;
    this.indicatorLifecycle?.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.releaseCompositionOutputListener?.(); this.releaseCompositionOutputListener = undefined;
    this.studyHost?.dispose();
    for (const binding of this.compositionSmaBindings.values()) binding.release(); this.compositionSmaBindings.clear();
    this.releaseOutputRegistry?.(); this.releaseOutputRegistry = undefined;
    this.outputRegistry?.dispose();
    this.engine?.dispose();
    this.register(this.params.api.id, null);
  }
}

export const panelRegistry = { candle: CandlePanel } as const;

function lowerBoundCandle(candles: readonly import('./feed/protocol').Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid]!.t < time) lo = mid + 1; else hi = mid; }
  return lo;
}

function lowerBoundFootprintBar(bars: readonly FootprintBar[], time: number) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid]!.time < time) lo = mid + 1; else hi = mid; }
  return lo;
}

const footprintSnapshotFields: readonly (keyof FootprintBar)[] = [
  'time', 'revision', 'delta', 'minDelta', 'maxDelta', 'quoteDelta', 'minQuoteDelta', 'maxQuoteDelta', 'rowSize',
  'source', 'granularity', 'coverage', 'gapBefore', 'open', 'high', 'low', 'close', 'aggregateRecordCount',
];
const footprintCellFields: readonly (keyof FootprintBar['cells'][number])[] = ['price', 'bidVol', 'askVol', 'bidNotional', 'askNotional'];

/** Immutable, bounded data signature for skipping duplicate worker snapshots. */
function footprintSnapshotSignature(bars: readonly FootprintBar[]) {
  return bars.map(bar => JSON.stringify([
    footprintSnapshotFields.map(field => bar[field]),
    bar.cells.map(cell => footprintCellFields.map(field => cell[field])),
  ]));
}

function sameFootprintSnapshot(previous: readonly string[] | undefined, next: readonly string[]) {
  return previous !== undefined && previous.length === next.length && previous.every((bar, index) => bar === next[index]);
}

const footprintPriceFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatFootprintPrice(value: number) {
  return Number.isFinite(value) ? footprintPriceFormatter.format(value) : '—';
}

function hasCompleteFootprintQuote(bar: FootprintBar) {
  return [bar.quoteDelta, bar.minQuoteDelta, bar.maxQuoteDelta].every(value => typeof value === 'number' && Number.isFinite(value))
    && bar.cells.every(cell => typeof cell.bidNotional === 'number' && Number.isFinite(cell.bidNotional) && cell.bidNotional >= 0
      && typeof cell.askNotional === 'number' && Number.isFinite(cell.askNotional) && cell.askNotional >= 0);
}

function numericOutputValueAt(times: readonly number[], values: readonly (number | null)[], time?: number) {
  if (!times.length || times.length !== values.length) return null;
  if (time === undefined) return values.at(-1) ?? null;
  let low = 0, high = times.length;
  while (low < high) { const middle = (low + high) >>> 1; if (times[middle]! < time) low = middle + 1; else high = middle; }
  return times[low] === time ? values[low] ?? null : null;
}

function formatAge(value: number) { return value < 1_000 ? '<1s' : `${Math.floor(value / 1_000)}s`; }

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not complete the chart action.';
}

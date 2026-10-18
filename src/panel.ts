import type {LevelWatch} from './level-watch/types';
import { MarketPicker } from './market-picker';
import { indicatorIcon } from './indicators/icons';
import { FOOTPRINT_ID, HEATMAP_ID, ORDER_WALLS_ID, INDICATOR_CONFIG_VERSION, DEFAULT_FOOTPRINT_VIEW, NATIVE_DEFINITIONS, IndicatorLifecycle, migrateIndicators, nativeInstance, nativeDefinition, scriptDefinition, studyPins, withStudyPins, type IndicatorInstance } from './indicators/model';
import { HeatmapControls } from './heatmap-controls';
import { heatmapSettings, heatmapKey, type HeatmapSettings, type HeatmapStatus } from './feed/heatmap-model';
import { DEFAULT_ORDER_WALLS_SETTINGS, orderWallMarket, orderWallsSettings, resolveAutoOrderWallPriceWidth, type OrderWallHit, type OrderWallStatus, type OrderWallsSettings } from './feed/order-walls';
import { OrderWallsControls } from './order-walls-controls';
import { duration } from './feed/protocol';
import type { Bar, ChartObjectSnapshot, CrosshairMoveEvent } from 'openalgo-charts';
import { drawingSettingsSchema, keyToDrawingAction, matchDrawingShortcut, registeredDrawingTools, type Drawing, type DrawingEvent, type DrawingPatch, type MagnetMode, type SettingsField, type SettingsSchema } from 'openalgo-charts/draw';
import type { FootprintCellStyle, FootprintDisplayMode, FootprintHover } from 'openalgo-charts/profile';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { canonicalFootprintRowPrice, canonicalSeries, FOOTPRINT_DEFAULT_ROW_PRICE, FOOTPRINT_MAX_ROW_PRICE, footprintTicksForPrice, instrumentKey, instrumentOf, instrumentLabel, instruments, intervals, legacyFootprintRowTicks, marketOf, seriesForInstrument, supportsDepth, supportsScriptDepth, validFootprintRowPrice, type CanonicalSeries, type FootprintBar, type FootprintStatus, type Interval, type Status } from './feed/protocol';
import { OpenAlgoCandleChart } from './chart/openalgo';
import type { Scheduler } from './chart/scheduler';
import { footprintForUnits, type FootprintUnits } from './chart/footprint-units';
import { MAX_STUDIES_PER_CHART, ScriptStudyHost, validStudyPins, type ScriptInputView, type StudyPin } from './scripts/host';
import type { ScriptLibrary, ScriptRecord } from './scripts/library';
import { makeInputControl, readInputSettings } from './scripts/input-controls';
import { captureDrawingSettings, drawingDisplayName, drawingSettingsPatch, initialDrawingMetadata, IQ_DRAWING_META_VERSION, iqDrawingSettingsSchema } from './chart/drawing-settings';
import { captureIQDrawingTemplateSettings, createLocalStorageDrawingTemplateStorage, createMemoryDrawingTemplateStorage, IQDrawingTemplateRepository, type IQDrawingTemplateCatalog, type IQDrawingTemplateRecord } from './chart/drawing-templates';

const DRAWING_TOOL_IDS = new Set(['horizontal-line', 'horizontal-ray', 'trend-line', 'rectangle', 'fib-retracement', 'text', 'long-position', 'short-position']);

interface SharedObjectsView {
  panel: HTMLDetailsElement;
  summary: HTMLElement;
  rows: HTMLDivElement;
  rowCache: Map<string, HTMLDivElement>;
  paneSections: Map<number, { section: HTMLElement; heading: HTMLDivElement; rows: HTMLDivElement }>;
  ownerId?: string;
  emptyMessage: HTMLParagraphElement;
}
let sharedObjectsView: SharedObjectsView | undefined;
let sharedObjectsOwner: CandlePanel | undefined;

function getSharedObjectsView(): SharedObjectsView {
  if (sharedObjectsView) return sharedObjectsView;
  const panel = document.createElement('details'); panel.className = 'chart-objects-panel'; panel.setAttribute('aria-label', 'Chart objects');
  const summary = document.createElement('summary'); summary.textContent = 'Objects';
  const rows = document.createElement('div'); rows.className = 'chart-objects-rows';
  const emptyMessage = document.createElement('p'); emptyMessage.className = 'dialog-status'; emptyMessage.textContent = 'No chart objects';
  panel.append(summary, rows);
  for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel', 'dblclick', 'keydown'] as const) panel.addEventListener(name, event => event.stopPropagation());
  panel.addEventListener('toggle', () => {
    const owner = sharedObjectsOwner;
    if (panel.open && owner) owner.attachObjectsPanel();
  });
  return sharedObjectsView = { panel, summary, rows, rowCache: new Map(), paneSections: new Map(), emptyMessage };
}

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
export interface PanelConfig extends CanonicalSeries { indicatorVersion: number; indicators: IndicatorInstance[]; basePriceVisible: boolean; type: 'candle' | 'footprint'; grid: boolean; wheelMode: 'tradingview' | 'both-axes'; drawingMagnet: MagnetMode; rowPrice: number; footprintUnits: FootprintUnits; footprint: FootprintViewOptions; heatmap: HeatmapSettings; studies: StudyPin[] }
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
    grid: typeof source.grid === 'boolean' ? source.grid : true,
    wheelMode: source.wheelMode === 'both-axes' ? 'both-axes' as const : 'tradingview' as const,
    drawingMagnet,
    footprintUnits: source.footprintUnits === 'usdt' ? 'usdt' as const : 'btc' as const, footprint, heatmap: heatmapSettings(source.heatmap), studies: validStudyPins(source.studies) };
}

export function config(value: unknown): PanelConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const legacy = legacyConfig(source);
  const indicators = migrateIndicators(source, { ...legacy, type: source.type === 'footprint' ? 'footprint' : 'candle' });
  const footprint = indicators.find(i => i.definitionId === FOOTPRINT_ID && i.settingsVersion === 1 && i.source.kind === 'chart');
  const heatmap = indicators.find(i => i.definitionId === HEATMAP_ID && i.settingsVersion === 1 && i.source.kind === 'chart');
  const normalized = legacyConfig({ ...source,
    ...(footprint ? { rowPrice: footprint.settings.rowPrice, footprintUnits: footprint.settings.units, footprint: footprint.settings.view } : {}),
    ...(heatmap ? { heatmap: heatmap.settings } : {}) });
  if (footprint) footprint.settings = { rowPrice: normalized.rowPrice, units: normalized.footprintUnits, view: normalized.footprint };
  if (heatmap) heatmap.settings = { ...normalized.heatmap, enabled: true };
  return { ...source, ...normalized, indicatorVersion: INDICATOR_CONFIG_VERSION, indicators,
    basePriceVisible: source.basePriceVisible !== false,
    type: footprint?.visible && supportsDepth(normalized) ? 'footprint' : 'candle',
    heatmap: { ...normalized.heatmap, enabled: Boolean(heatmap?.visible) }, studies: studyPins(indicators) };
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
  private chart = document.createElement('div');
  private chartFooter = document.createElement('footer');
  private toolbar = document.createElement('div');
  private toolbarCue = document.createElement('button');
  private depthNotice = document.createElement('div');
  private readout = document.createElement('div');
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
  private wheelMode = document.createElement('select');
  private footprintUnits = document.createElement('select');
  private overlays = document.createElement('div');
  private activeIndicators = document.createElement('details');
  private activeSummary = document.createElement('summary');
  private activeRows = document.createElement('div');
  private drawTool = document.createElement('select');
  private drawMagnet = document.createElement('select');
  private drawPlacementState = document.createElement('span');
  private drawUndo = document.createElement('button');
  private drawRedo = document.createElement('button');
  private drawEraser = document.createElement('button');
  private drawSettings = document.createElement('button');
  private drawTemplates = document.createElement('button');
  private objectsToggle = document.createElement('button');
  private objectsPanel!: HTMLDetailsElement;
  private objectsSummary!: HTMLElement;
  private objectsRows!: HTMLDivElement;
  private objectRows!: Map<string, HTMLDivElement>;
  private objectPaneSections!: Map<number, { section: HTMLElement; heading: HTMLDivElement; rows: HTMLDivElement }>;
  private emptyObjectsMessage?: HTMLParagraphElement;
  private drawingDialog = document.createElement('dialog');
  private drawingForm = document.createElement('form');
  private drawingFields = document.createElement('div');
  private drawingStatus = document.createElement('div');
  private drawingTarget = '';
  private drawingSchema?: SettingsSchema;
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
  setWatchZones(watches:LevelWatch[]){this.watchList=watches;const supported=instrumentKey(this.selection)==='binance:perpetual';if(this.watchButton){this.watchButton.disabled=!supported;this.watchButton.title=supported?'Select two zone boundaries':'Level Watch requires Binance BTCUSDT USD-M perpetual';}this.engine?.setWatchZones(supported&&this.watchZonesVisible?watches:[]);this.engine?.objects.refresh();}
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
  private abort = new AbortController();
  private hoveredBar: Bar | null = null;
  private hoveredFootprint: FootprintHover | null = null;
  private candles: import('./feed/protocol').Candle[] = [];
  private footprintBars: FootprintBar[] = [];
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
  ) {
    const objectsView = getSharedObjectsView();
    this.objectsPanel = objectsView.panel; this.objectsSummary = objectsView.summary; this.objectsRows = objectsView.rows;
    this.objectRows = objectsView.rowCache; this.objectPaneSections = objectsView.paneSections; this.emptyObjectsMessage = objectsView.emptyMessage;
    this.element.className = 'candle-panel';
    this.toolbarWrap.className = 'chart-toolbar-wrap';
    this.toolbar.className = 'chart-toolbar';
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
    this.readout.className = 'ohlc';
    this.statusNode.className = 'panel-status';
    this.statusNode.setAttribute('role', 'status');
    this.metadata.className = 'instrument-meta';
    this.marketButton.setAttribute('aria-label', 'Chart market'); this.marketButton.className = 'chart-market-button';
    this.marketPicker = new MarketPicker(this.element);
    for (const [value, info] of Object.entries(instruments)) this.instrument.add(new Option(info.label, value));
    this.interval.setAttribute('aria-label', 'Timeframe');
    for (const value of intervals) this.interval.add(new Option(value, value));
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
    this.orderWallsControls = new OrderWallsControls(settings => this.changeOrderWalls(settings), this.abort.signal);
    this.toolbar.append(this.marketButton, this.interval, this.indicators, this.chartSettings, this.latest, this.metadata);
    this.drawTool.setAttribute('aria-label', 'Drawing tool');
    this.drawTool.title = 'Select a drawing tool';
    this.drawTool.className = 'drawing-tool-select';
    this.drawMagnet.setAttribute('aria-label', 'Drawing magnet');
    this.drawMagnet.title = 'Snap drawing anchors to candle values';
    this.drawMagnet.className = 'drawing-magnet-select';
    this.drawMagnet.add(new Option('Snap weak', 'weak'));
    this.drawMagnet.add(new Option('Snap strong', 'strong'));
    this.drawMagnet.add(new Option('Snap off', 'off'));
    this.drawPlacementState.className = 'drawing-placement-state';
    this.drawPlacementState.setAttribute('role', 'status');
    this.drawPlacementState.setAttribute('aria-live', 'polite');
    this.drawPlacementState.hidden = true;
    this.drawUndo.type = 'button'; this.drawUndo.className = 'drawing-toolbar-action'; this.drawUndo.textContent = 'Undo'; this.drawUndo.title = 'Undo drawing change (Ctrl/⌘+Z)';
    this.drawRedo.type = 'button'; this.drawRedo.className = 'drawing-toolbar-action'; this.drawRedo.textContent = 'Redo'; this.drawRedo.title = 'Redo drawing change (Ctrl/⌘+Shift+Z)';
    this.drawEraser.type = 'button'; this.drawEraser.className = 'drawing-toolbar-action'; this.drawEraser.textContent = 'Erase'; this.drawEraser.title = 'Erase drawings';
    this.drawSettings.type = 'button'; this.drawSettings.className = 'drawing-toolbar-action'; this.drawSettings.textContent = 'Style'; this.drawSettings.title = 'Edit the selected drawing';
    this.drawTemplates.type = 'button'; this.drawTemplates.className = 'drawing-toolbar-action'; this.drawTemplates.textContent = 'Templates'; this.drawTemplates.title = 'Manage drawing settings templates';
    this.objectsToggle.type = 'button'; this.objectsToggle.className = 'drawing-toolbar-action chart-objects-toggle'; this.objectsToggle.textContent = 'Objects'; this.objectsToggle.title = 'Show chart objects';
    this.drawTool.add(new Option('Cursor', ''));
    this.toolbar.append(this.drawTool, this.drawMagnet, this.drawPlacementState, this.drawUndo, this.drawRedo, this.drawEraser, this.drawSettings, this.drawTemplates, this.objectsToggle);
    this.toolbarWrap.append(this.toolbar, this.toolbarCue);
    this.overlays.className = 'chart-top-overlays';
    this.activeIndicators.className = 'active-indicators'; this.activeIndicators.open = true;
    this.activeIndicators.setAttribute('aria-label', 'Active indicators');
    this.activeSummary.textContent = 'Indicators'; this.activeRows.className = 'active-indicator-rows';
    this.activeIndicators.append(this.activeSummary, this.activeRows);
    this.objectsPanel.className = 'chart-objects-panel';
    this.objectsPanel.append(this.objectsSummary, this.objectsRows);
    this.buildDialogs();
    this.buildDrawingDialogs();
    this.element.append(this.toolbarWrap, this.depthNotice, this.chart, this.chartFooter, this.picker, this.settingsDialog, this.footprintDialog, this.heatmapControls.dialog, this.orderWallsControls.dialog, this.chartSettingsDialog, this.drawingDialog, this.templatesDialog);
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.element.dataset.panelId = params.api.id;
    this.selection = config(params.params);
    this.drawMagnet.value = this.selection.drawingMagnet;
    this.wheelMode.value = this.selection.wheelMode;
    this.gridCheckbox.checked = this.selection.grid; this.baseVisible.checked = this.selection.basePriceVisible;
    params.api.updateParameters(this.selection);
    this.instrument.value = instrumentKey(this.selection); this.marketButton.textContent = instrumentLabel(this.selection);
    this.rowPrice.value = String(this.selection.rowPrice);
    this.interval.value = this.selection.interval;
    this.updateFootprintControls();
    const options = { signal: this.abort.signal };
    this.marketButton.addEventListener('click', () => this.marketPicker.open([instrumentKey(this.selection)], { multiple: false, capability: 'candles', apply: ids => { this.instrument.value = ids[0]; this.select(); } }), options);
    this.interval.addEventListener('change', () => this.select(), options);
    this.drawTool.addEventListener('change', () => this.setDrawingTool(this.drawTool.value || null), options);
    this.drawMagnet.addEventListener('change', () => {
      const drawingMagnet = this.drawMagnet.value as MagnetMode;
      this.selection = config({ ...this.selection, drawingMagnet });
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
    this.chart.addEventListener('keydown', event => { if (!(event.target as HTMLElement).closest('.active-indicators')) this.keydown(event); }, options);
    for (const name of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'keydown'] as const) this.activeIndicators.addEventListener(name, event => event.stopPropagation(), options);
    this.activeRows.addEventListener('click', event => this.indicatorAction(event), options);
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
    for (const tool of registeredDrawingTools()) if (DRAWING_TOOL_IDS.has(tool.id)) this.drawTool.add(new Option(tool.name, tool.id));
    this.loadDrawingTemplates();
    this.subscriptions.push({ dispose: this.engine.objects.subscribe(() => this.renderDrawingObjects()) });
    this.subscriptions.push(
      { dispose: this.engine.chart.on('draw:tool', payload => { const event = payload as { tool: string | null }; this.drawTool.value = event.tool ?? ''; this.syncDrawingActions(); }) },
      { dispose: this.engine.chart.on('draw:add', payload => {
        const event = payload as DrawingEvent;
        if (!event.history) this.enrichPlacedDrawing(event.drawing);
      }) },
      { dispose: this.engine.chart.on('drawing:select', () => this.syncDrawingActions()) },
      { dispose: this.engine.chart.on('drawing:change', () => this.syncDrawingActions()) },
    );
    this.engine.onFootprintViewport=(from,to)=>{if(this.footprintHasInitialView)this.feed.requestFootprintViewport(this.params.api.id,from,to);};
    this.engine.onHeatmapViewport = viewport => {
      if (this.selection.type === 'footprint' && !this.footprintHasInitialView && this.footprintStatus.state === 'loading') return;
      if (this.nativeIndicator(HEATMAP_ID) && supportsDepth(this.selection)) this.feed.requestHeatmapViewport(this.params.api.id, viewport);
      this.updateOrderWallsViewport(viewport.from, viewport.to, viewport.low, viewport.high, viewport.height);
    };
    this.engine.setWheelMode(this.selection.wheelMode);
    this.engine.setGridVisible(this.selection.grid); this.engine.setBasePriceVisible(this.selection.basePriceVisible);
    if (this.selection.type === 'footprint') this.engine.setDisplayMode('footprint');
    this.applyFootprintOptions();
    this.studyHost = new ScriptStudyHost(params.api.id, this.engine, this.feed, this.library, this.selection, studies => {
      this.selection = config({ ...this.selection, indicators: withStudyPins(this.selection.indicators, studies) });
      this.params.api.updateParameters(this.selection);
      this.save();
    });
    this.registerCoreObjectProviders();
    this.indicatorLifecycle = new IndicatorLifecycle(instance => this.createIndicatorHandle(instance), (instance, error) => { if (!this.dead && this.selection.indicators.some(i => i.instanceId === instance.instanceId)) { this.indicatorErrors.set(instance.instanceId,errorText(error)); this.renderActiveIndicators(); } });
    this.subscriptions.push({ dispose: this.studyHost.subscribe(() => { this.updateDepthNotice(); this.reconcileIndicators(); this.syncScriptObjectProviders(); }) });
    this.studyHost.restore(this.selection.studies);
    const unsubscribeCrosshair = this.engine.chart.subscribeCrosshairMove(event => this.crosshair(event));
    this.subscriptions.push({ dispose: unsubscribeCrosshair });
    this.subscriptions.push(
      { dispose: this.engine.chart.on('indicatorSource', event => this.openStudySource(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorSettings', event => void this.openStudySettings(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorRemoved', event => this.studyHost?.removeNativeInstance(event.instanceId)) },
      { dispose: this.engine.chart.on('objects:change', () => this.studyHost?.syncNativeVisibility()) },
    );
    this.overlays.append(this.readout, this.activeIndicators);
    this.chart.append(this.overlays, this.heatmapControls.readout);
    if (!sharedObjectsOwner) sharedObjectsOwner = this;
    if (sharedObjectsOwner === this) {
      this.chart.append(this.objectsPanel);
      getSharedObjectsView().ownerId = params.api.id;
    }
    this.chartFooter.append(this.heatmapControls.notice, this.orderWallsControls.notice, this.statusNode);
    this.subscriptions.push(params.api.onDidVisibilityChange(() => this.visibility()));
    this.subscriptions.push(params.api.onDidActiveChange(({ isActive }) => {
      if (!isActive) return;
      sharedObjectsOwner = this;
      if (this.objectsPanel.open) this.attachObjectsPanel();
      else this.updateObjectsSummary();
    }));
    this.subscriptions.push(params.api.onDidFocusChange(({ isFocused }) => {
      this.chart.dataset.focused = String(isFocused);
      if (isFocused && this.objectsPanel.open) {
        sharedObjectsOwner = this;
        this.attachObjectsPanel();
      } else if (sharedObjectsOwner === this) this.updateObjectsSummary();
    }));
    this.register(params.api.id, this);
    this.subscribe();
    queueMicrotask(() => {
      if (!this.dead) this.params.api.setTitle(`${instrumentLabel(this.selection)} · ${this.selection.interval}`);
    });
    this.visibility();
    this.timer = setInterval(() => {
      if (this.visible && !document.hidden) {
        this.updateStatus();
        if (!this.hoveredBar && !this.hoveredFootprint) this.refreshReadout();
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
      this.footprintField('Statistics', this.selectControl('statsPosition', [
        ['bottom', 'Bottom table'], ['bar', 'Volume / delta beside candle'],
      ])),
      this.footprintField('Cell opacity (%)', this.opacityControl()),
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
    const statistics = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="statsPosition"]')!;
    display.addEventListener('change', () => {
      if (display.value === 'delta-profile' || display.value === 'volume-delta-candle') cells.value = 'profile';
      if (display.value === 'volume-delta-candle') {
        statistics.value = 'bar';
        for (const key of ['showCandle', 'showPoc', 'showValueArea']) this.footprintFields.querySelector<HTMLInputElement>(`[data-footprint-option="${key}"]`)!.checked = true;
      }
    }, { signal: this.abort.signal });
    const reconcilePreset = () => {
      if (display.value === 'delta-profile' && cells.value !== 'profile') display.value = 'delta';
      if (display.value === 'volume-delta-candle' && (cells.value !== 'profile' || statistics.value !== 'bar')) display.value = 'bidask';
    };
    cells.addEventListener('change', reconcilePreset, { signal: this.abort.signal });
    statistics.addEventListener('change', reconcilePreset, { signal: this.abort.signal });
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
      { id: FOOTPRINT_ID, kind: 'profile' as const, name: 'Footprint' },
      { id: HEATMAP_ID, kind: 'indicator' as const, name: 'Order-book Heatmap' },
      { id: ORDER_WALLS_ID, kind: 'indicator' as const, name: 'Order Walls' },
    ];
    this.coreObjectProviderReleases = entries.map(entry => this.engine!.objects.register({
      id: `iqterminal-${entry.id}`,
      get: () => {
        const instance = this.nativeIndicator(entry.id);
        if (!instance) return null;
        const settingsEnabled = instance.settings.enabled !== false;
        return { kind: entry.kind, name: entry.name, paneIndex: this.engine!.objects.primaryPaneIndex(),
          visible: instance.visible && settingsEnabled && (entry.id !== FOOTPRINT_ID || this.selection.type === 'footprint'),
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
          if (!current) return null;
          const paneIndex = this.engine?.chart.indicators().find(item => item.id === attachmentId)?.paneIndex ?? (current.placement === 'pane' ? 1 : 0);
          return { kind: 'indicator', name: current.title, paneIndex, visible: current.visible,
            dataStatus: current.status === 'Study ready' ? { state: 'ready' as const } : { state: 'loading' as const } };
        },
        subscribe: listener => this.studyHost?.subscribe(listener) ?? (() => {}),
        select: () => this.params.api.setActive(),
        setVisible: visible => { if (this.studyHost?.views().find(item => item.attachmentId === attachmentId)?.visible !== visible) this.studyHost?.setVisibleStudy(attachmentId, visible); },
        remove: () => { this.studyHost?.remove(attachmentId); },
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
    if (definitionId === FOOTPRINT_ID && visible && !supportsDepth(this.selection)) return;
    const change: Partial<Pick<IndicatorInstance, 'visible' | 'settings'>> = { visible };
    if (definitionId === HEATMAP_ID || definitionId === ORDER_WALLS_ID) change.settings = { ...instance.settings, enabled: visible };
    if (definitionId === FOOTPRINT_ID) this.selection = config({ ...this.selection, type: visible ? 'footprint' : 'candle', indicators: this.selection.indicators.map(item => item.instanceId === instance.instanceId ? { ...item, visible } : item) });
    else this.selection = config({ ...this.selection, indicators: this.selection.indicators.map(item => item.instanceId === instance.instanceId ? { ...item, ...change } : item) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private removeIndicatorObject(definitionId: string) {
    const instance = this.nativeIndicator(definitionId); if (!instance) return;
    this.selection = config({ ...this.selection, ...(definitionId === FOOTPRINT_ID ? { type: 'candle' as const } : {}), indicators: this.selection.indicators.filter(item => item.instanceId !== instance.instanceId) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private removeIndicatorInstance(instanceId: string) {
    const instance = this.selection.indicators.find(item => item.instanceId === instanceId); if (!instance) return;
    if (new Set<string>([FOOTPRINT_ID, HEATMAP_ID, ORDER_WALLS_ID]).has(instance.definitionId)) { this.removeIndicatorObject(instance.definitionId); return; }
    this.selection = config({ ...this.selection, ...(instance.definitionId === FOOTPRINT_ID ? { type: 'candle' as const } : {}), indicators: this.selection.indicators.filter(item => item.instanceId !== instanceId) });
    this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
  }

  private setDrawingTool(tool: string | null) {
    if (!this.engine) return;
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
    this.drawEraser.setAttribute('aria-pressed', String(draw.erasing()));
    const activeTool = draw.activeTool();
    if (activeTool) {
      const name = registeredDrawingTools().find(tool => tool.id === activeTool)?.name ?? activeTool;
      this.drawPlacementState.textContent = `Place: ${name}`;
      this.drawPlacementState.hidden = false;
    } else if (draw.erasing()) {
      this.drawPlacementState.textContent = 'Erase drawings';
      this.drawPlacementState.hidden = false;
    } else {
      this.drawPlacementState.textContent = '';
      this.drawPlacementState.hidden = true;
    }
  }

  private toggleObjectsPanel() {
    if (sharedObjectsOwner === this && this.objectsPanel.open) {
      this.objectsPanel.open = false;
      sharedObjectsOwner = undefined;
      return;
    }
    sharedObjectsOwner = this;
    this.objectsPanel.open = true;
    this.attachObjectsPanel();
    this.objectsPanel.scrollIntoView({ block: 'nearest' });
  }

  attachObjectsPanel() {
    const view = getSharedObjectsView();
    if (view.ownerId !== this.params.api.id) {
      view.rowCache.clear();
      view.paneSections.clear();
      view.rows.replaceChildren();
      view.ownerId = this.params.api.id;
    }
    sharedObjectsOwner = this;
    this.chart.append(this.objectsPanel);
    this.renderDrawingObjects();
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
    const coreIds = new Set([FOOTPRINT_ID, HEATMAP_ID, ORDER_WALLS_ID]);
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
    const toggleLabel = `Objects (${objects.length})`;
    if (this.objectsToggle.textContent !== toggleLabel) this.objectsToggle.textContent = toggleLabel;
    if (sharedObjectsOwner !== this || !this.objectsPanel.open) return;
    this.updateObjectsSummary();
    this.objectsPanel.dataset.focused = String(this.params?.api.isFocused ?? false);
    const activeIds = new Set(objects.map(object => object.id));
    for (const [id, row] of this.objectRows) {
      if (activeIds.has(id)) continue;
      row.remove();
      this.objectRows.delete(id);
    }
    if (!objects.length) {
      for (const entry of this.objectPaneSections.values()) entry.section.remove();
      this.objectPaneSections.clear();
      if (this.objectsRows.childElementCount !== 1 || this.objectsRows.firstElementChild !== this.emptyObjectsMessage) this.objectsRows.replaceChildren(this.emptyObjectsMessage!);
      return;
    }
    this.emptyObjectsMessage?.remove();
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
      const currentSection = this.objectsRows.children.item(paneOrder);
      if (currentSection !== section.section) this.objectsRows.insertBefore(section.section, currentSection);
      grouped.get(paneIndex)!.forEach((object, rowOrder) => {
        const row = this.updateObjectRow(object);
        row.dataset.objectPaneIndex = String(paneIndex);
        const currentRow = section.rows.children.item(rowOrder);
        if (currentRow !== row) section.rows.insertBefore(row, currentRow);
      });
    });
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
        const owner = sharedObjectsOwner;
        if (!owner) return;
        owner.params.api.setActive();
        owner.engine?.objects.select(id);
        owner.engine?.objects.focus(id);
        owner.syncDrawingActions();
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
    const actionButtons = actions.map(({ label, action, title }) => {
      let button = [...row!.querySelectorAll<HTMLButtonElement>('button[data-object-action]')].find(candidate => candidate.dataset.objectAction === action);
      if (!button) button = this.objectActionButton(label, action, object.id, title);
      if (button.textContent !== label) button.textContent = label;
      if (button.title !== title) button.title = title;
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
    button.textContent = label; button.title = title; button.dataset.objectAction = action; button.dataset.objectId = id;
    button.addEventListener('click', event => { event.stopPropagation(); sharedObjectsOwner?.drawingObjectAction(event); });
    return button;
  }

  private drawingObjectAction(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-object-action]');
    if (!button || !this.engine) return;
    const id = button.dataset.objectId ?? '';
    const object = this.engine.objects.get(id);
    if (!object) return;
    switch (button.dataset.objectAction) {
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
    const values = captureDrawingSettings(drawing, this.drawingSchema);
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
      if (field.kind === 'boolean') values[field.path] = (control as HTMLInputElement).checked;
      else if (field.kind === 'levels') {
        try { values[field.path] = JSON.parse(control.value); } catch { this.drawingStatus.textContent = `${field.label} must be valid JSON.`; control.focus(); return; }
      } else values[field.path] = control.value;
    }
    const textColorExplicit = this.drawingFields.querySelector<HTMLElement>('[data-setting-path="text.color"]')?.dataset.userEdited === 'true'
      ? true : undefined;
    const patch = drawingSettingsPatch(drawing, values, schema, { textColorExplicit });
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
    const selected = draw?.get(draw.selected() ?? ''); const tool = selected?.tool ?? (this.drawTool.value || '');
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
    // Text content is the text tool's visible label. It follows the template's
    // explicit Include label bit rather than being copied as an ordinary style
    // field; omitted labels leave the target content intact, including older
    // catalogs that may contain text.value in nativeValues.
    const nativeValues = drawing.tool === 'text'
      ? Object.fromEntries(Object.entries(template.nativeValues).filter(([path]) => path !== 'text.value'))
      : template.nativeValues;
    const nativePatch = drawingSettingsPatch(drawing, nativeValues, drawingSettingsSchema(drawing.tool));
    const textLabelPatch = drawing.tool === 'text' && template.label.present
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
    this.rowPrice.value = String(this.selection.rowPrice); this.rowPrice.setCustomValidity(''); this.footprintUnits.value = this.selection.footprintUnits;
    this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showCandle"]')!.checked = view.showCandle;
    this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showValueArea"]')!.checked = view.showValueArea;
    mode.value = view.displayMode === 'delta' && view.cellStyle === 'profile' ? 'delta-profile' : view.displayMode === 'bidask' && view.cellStyle === 'profile' && view.statsPosition === 'bar' ? 'volume-delta-candle' : view.displayMode;
    this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="statsPosition"]')!.value = view.statsPosition; style.value = view.cellStyle; poc.checked = view.showPoc;
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
        statsPosition: this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="statsPosition"]')!.value,
        showCandle: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showCandle"]')!.checked,
        showPoc: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showPoc"]')!.checked,
        showValueArea: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showValueArea"]')!.checked,
        showDiagonalImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showDiagonalImbalances"]')!.checked,
        stackedImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="stackedImbalances"]')!.checked,
        imbalanceRatio: Number(this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="imbalanceRatio"]')!.value),
        imbalanceThreshold: Number(threshold.value),
    };
    const instance = this.nativeIndicator(FOOTPRINT_ID)!;
    this.changeIndicator(instance.instanceId, { settings: { rowPrice: price, units: this.footprintUnits.value, view } });
    this.footprintDialog.close();
  }

  private applyFootprintOptions() {
    const view = this.selection.footprint;
    this.engine?.setFootprintUnits(this.selection.footprintUnits);
    this.heatmapControls.setUnits(this.selection.footprintUnits);
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
      statsPosition: view.statsPosition,
      statsRows: view.statsPosition === 'bar' ? ['volume', 'delta'] : ['volume', 'bidVolume', 'askVolume', 'delta'],
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

  private nativeIndicator(id: string) { return this.selection?.indicators.find(i => i.definitionId === id && i.settingsVersion === 1 && i.source.kind === 'chart'); }

  private createIndicatorHandle(instance: IndicatorInstance) {
    if (instance.source.kind !== 'chart' || instance.settingsVersion !== 1) return undefined;
    if (nativeDefinition(instance.definitionId) && instance.settingsVersion === 1) {
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
    this.indicatorLifecycle?.reconcile(this.selection.indicators);
    this.renderActiveIndicators();
    this.engine?.objects.refresh();
    this.syncScriptObjectProviders();
  }

  private syncNativeIndicators() {
    if (!this.engine || this.dead) return;
    const oldMode = this.engine.displayMode;
    this.applyFootprintOptions(); this.engine.setBasePriceVisible(this.selection.basePriceVisible);
    this.engine.setDisplayMode(this.selection.type, true);
    this.subscribeFootprint();
    if (oldMode !== this.selection.type && this.selection.type === 'footprint') {
      this.engine.setFootprintBars(this.footprintBars, true); this.footprintNeedsSync = false;
      this.focusFootprintOnce();
    }
    this.syncHeatmap(); this.syncOrderWalls(); this.hoveredBar = null; this.hoveredFootprint = null;
    this.updateFootprintControls(); this.refreshReadout(); this.updateStatus();
  }

  private changeIndicator(instanceId: string, change: Partial<Pick<IndicatorInstance, 'visible' | 'settings'>>) {
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
      const settings = definitionId === FOOTPRINT_ID ? { rowPrice: this.selection.rowPrice, units: this.selection.footprintUnits, view: this.selection.footprint }
        : definitionId === HEATMAP_ID ? { ...this.selection.heatmap, enabled: true }
          : { ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true };
      this.selection = config({ ...this.selection, indicators: [...this.selection.indicators, nativeInstance(definitionId, settings)] });
      this.params.api.updateParameters(this.selection); this.reconcileIndicators(); this.save();
      this.renderPicker(`${definition.name} added with its default settings.`);
    } else {
      this.picker.close(); this.openIndicatorSettings(existing);
    }
  }

  private openIndicatorSettings(instance: IndicatorInstance) {
    if (instance.settingsVersion !== 1) return;
    if (instance.definitionId === FOOTPRINT_ID) this.openFootprintSettings();
    else if (instance.definitionId === HEATMAP_ID) this.heatmapControls.open();
    else if (instance.definitionId === ORDER_WALLS_ID) this.orderWallsControls.open(orderWallsSettings(instance.settings));
    else if (instance.script) void this.openAttachmentSettings(instance.instanceId);
  }

  private async indicatorAction(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-indicator-action]');
    if (!button || button.disabled || this.dead) return;
    const instance = this.selection.indicators.find(i => i.instanceId === button.dataset.instanceId); if (!instance) return;
    const action = button.dataset.indicatorAction;
    if (action === 'settings') this.openIndicatorSettings(instance);
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
        await this.studyHost.apply({ ...pin, source: revision.source, settings: { ...instance.settings } as StudyPin['settings'], visible: instance.visible });
      } catch (error) { this.activeIndicators.dataset.error = errorText(error); this.renderActiveIndicators(); }
      finally { button.disabled = false; }
    }
  }

  private activeListKey = '';
  private renderActiveIndicators() {
    if (!this.selection || this.dead) return;
    const views = this.studyHost?.views() ?? [];
    const rows = this.selection.indicators.map(instance => {
      const definition = nativeDefinition(instance.definitionId), study = views.find(v => v.attachmentId === instance.instanceId);
      const name = definition?.name ?? instance.script?.title ?? instance.definitionId;
      const unavailable = !definition && !studyPins([instance]).length || instance.settingsVersion !== 1 || instance.source.kind !== 'chart';
      let summary = unavailable ? 'Unavailable definition · settings retained' : definition && instance.definitionId !== ORDER_WALLS_ID && !supportsDepth(this.selection) ? 'Unavailable · Binance BTCUSDT Spot or USD-M Perp only'
        : instance.definitionId === FOOTPRINT_ID ? `$${this.selection.rowPrice} · ${this.selection.footprintUnits.toUpperCase()} · ${this.selection.footprint.displayMode}`
          : instance.definitionId === HEATMAP_ID ? `${this.selection.heatmap.mode} · $${this.nativeIndicator(FOOTPRINT_ID) ? this.selection.rowPrice : this.selection.heatmap.rowPrice} · ${this.selection.footprintUnits.toUpperCase()}`
            : instance.definitionId === ORDER_WALLS_ID ? this.selection.venue === 'hyperliquid' ? 'Unavailable · Hyperliquid order-book history is not supported'
              : `${orderWallsSettings(instance.settings).method === 'relative' ? `Relative p${orderWallsSettings(instance.settings).relativePercentile}` : `Absolute $${orderWallsSettings(instance.settings).thresholdUsd.toLocaleString('en-US')}`} · ${orderWallsSettings(instance.settings).aggregation === 'auto' ? 'Auto' : `$${orderWallsSettings(instance.settings).aggregation}`} · ${this.orderWallsStatus?.state ?? 'loading'}`
            : study ? study.inputs.filter(i => i.kind !== 'color').map(i => `${i.label} ${study.settings[i.key] ?? i.defaultValue}`).join(' · ') : 'Restoring pinned revision…';
      const error = study && study.diagnostics.length ? study.status : study && !study.inputs.length && study.status !== 'Study ready' ? study.status : '';
      if (error) summary = error;
      if (this.indicatorErrors.has(instance.instanceId)) summary = this.indicatorErrors.get(instance.instanceId)!;
      return { instance, name, summary: `${summary || 'Default inputs'} · ${instrumentLabel(this.selection)} · ${this.selection.interval}`, unavailable };
    });
    const key = JSON.stringify([rows, this.activeIndicators.dataset.error]); if (key === this.activeListKey) return;
    this.activeListKey = key; this.activeIndicators.hidden = rows.length === 0;
    this.activeSummary.textContent = `Indicators (${rows.length})`;
    const focused = this.activeRows.contains(document.activeElement) ? (document.activeElement as HTMLButtonElement) : null;
    const focusId = focused?.dataset.instanceId, focusAction = focused?.dataset.indicatorAction;
    this.activeRows.replaceChildren();
    for (const row of rows) {
      const element = document.createElement('div'); element.className = 'active-indicator'; element.dataset.instanceId = row.instance.instanceId; element.dataset.definitionId = row.instance.definitionId; element.dataset.visible = String(row.instance.visible);
      const copy = document.createElement('div'); copy.className = 'active-indicator-copy';
      const name = document.createElement('span'); name.textContent = row.name;
      const description = document.createElement('small'); description.textContent = row.summary; description.title = row.summary; copy.append(name, description);
      const controls = document.createElement('div'); controls.className = 'active-indicator-actions';
      const actions = ['visibility', 'settings', ...(row.instance.script ? ['source','duplicate'] : []), 'remove'];
      for (const action of actions) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.indicatorAction = action; button.dataset.instanceId = row.instance.instanceId;
        const label = action === 'visibility' ? `${row.instance.visible ? 'Hide' : 'Show'} ${row.name}` : action === 'settings' ? `${row.name} settings` : action === 'source' ? `Edit Script for ${row.name}` : `${action === 'remove' ? 'Remove' : 'Duplicate'} ${row.name}`;
        button.setAttribute('aria-label', label); button.title = label;
        if (action === 'visibility') button.setAttribute('aria-pressed', String(row.instance.visible));
        const wallMarketUnsupported = row.instance.definitionId === ORDER_WALLS_ID && this.selection.venue === 'hyperliquid';
        button.disabled = row.unavailable && action !== 'remove' || wallMarketUnsupported && action === 'visibility'; button.append(indicatorIcon(action)); controls.append(button);
      }
      element.append(copy, controls); this.activeRows.append(element);
    }
    if (this.activeIndicators.dataset.error) { const error = document.createElement('p'); error.className = 'dialog-status'; error.setAttribute('role','status'); error.textContent = this.activeIndicators.dataset.error; this.activeRows.append(error); }
    if (focusId && focusAction) [...this.activeRows.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.instanceId === focusId && b.dataset.indicatorAction === focusAction)?.focus();
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
      const matches = entries.filter(d => d.category === category && (!query || `${d.name} ${d.description}`.toLocaleLowerCase().includes(query)));
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
      await this.studyHost.apply({ scriptId: record.id, source: revision.source, title: record.title, description: record.description, settings: {} });
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
    const series = seriesForInstrument(this.instrument.value, this.interval.value as Interval);
    const wasFootprint = this.selection.type === 'footprint';
    if (series) this.marketButton.textContent = instrumentLabel(series);
    this.selection = config({ ...this.selection, ...(series ?? {}), studies: this.selection.studies });
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
    this.candles = [];
    this.studyHost?.setSeries(this.selection);
    this.updateDepthNotice();
    this.hoveredBar = null;
    this.hoveredFootprint = null;
    this.updateReadout(null);
    this.subscribe();
    this.save();
  }

  private subscribe() {
    this.release?.();
    const epoch = ++this.selectionEpoch;
    const selection = this.selection;
    this.engine?.setDrawingContext(selection);
    this.params.api.setTitle(`${instrumentLabel(selection)} · ${selection.interval}`);
    this.chart.setAttribute('aria-label', `${instrumentLabel(selection)} candlestick chart`);
    this.updateInstrumentMetadata();
    this.status = { state: 'loading', message: 'Loading native candles…', lastUpdate: 0 };
    this.updateFootprintControls();
    this.updateStatus();
    this.release = this.feed.subscribe(this.params.api.id, selection, event => {
      if (this.dead || epoch !== this.selectionEpoch) return;
      if (event.type === 'status') {
        this.status = event.status;
        this.updateStatus();
      } else if (event.type === 'snapshot') {
        this.candles = event.candles.length > 5_000 ? event.candles.slice(-5_000) : [...event.candles];
        this.engine?.setSnapshot(event.candles, !this.resetViewOnSnapshot);
        this.studyHost?.setSnapshot(this.candles);
        if (this.resetViewOnSnapshot && this.selection.type === 'candle') this.engine?.resetView();
        this.resetViewOnSnapshot = false;
        this.hoveredBar = null;
        this.syncOrderWalls();
        if (this.visible) this.refreshReadout();
      } else if (event.type === 'patch') {
        this.mergeCandles(event.candles);
        this.engine?.applyPatch(event.candles);
        this.studyHost?.applyPatch(event.candles);
        if (this.visible && !this.hoveredBar && !this.hoveredFootprint) this.refreshReadout();
        this.status = { ...this.status, lastUpdate: Date.now() };
      }
    });
    this.syncHeatmap();
    this.subscribeFootprint();
    this.reconcileIndicators();
    this.syncOrderWalls();
  }

  private changeHeatmap(settings: HeatmapSettings, units: FootprintUnits) {
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
    this.heatmapControls.sync(settings, supported, footprint); this.heatmapControls.setUnits(this.selection.footprintUnits);
    const instance = this.nativeIndicator(HEATMAP_ID);
    this.engine?.setHeatmap({ ...settings, enabled: settings.enabled && supported && (instance?.visible ?? true) }, duration[this.selection.interval]);
    const key = this.nativeIndicator(HEATMAP_ID) && supported ? `${instrumentKey(this.selection)}:${heatmapKey(settings)}` : '';
    if (key === this.heatmapSubscriptionKey) return;
    this.releaseHeatmap?.(); this.releaseHeatmap = undefined; this.heatmapSubscriptionKey = key;
    const generation = ++this.heatmapGeneration; this.heatmapStatus = undefined; this.heatmapControls.setStatus(undefined); this.heatmapControls.hover(null);
    this.engine?.updateHeatmap([], true, null);
    if (!key) return;
    this.releaseHeatmap = this.feed.subscribeHeatmap(this.params.api.id, settings, event => {
      if (this.dead || generation !== this.heatmapGeneration || event.type !== 'heatmap-batch') return;
      this.heatmapStatus = event.status;
      this.engine?.updateHeatmap(event.buckets, event.snapshot, event.status.retentionStart);
      if (this.visible && !document.hidden) this.heatmapControls.setStatus(event.status);
    }, marketOf(this.selection));
  }

  private syncOrderWalls() {
    const instance = this.nativeIndicator(ORDER_WALLS_ID);
    const supported = this.selection.venue === 'binance';
    const settings = orderWallsSettings(instance?.settings ?? DEFAULT_ORDER_WALLS_SETTINGS);
    this.orderWallsControls.sync(settings, supported, Boolean(instance), Boolean(instance?.visible));
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
      this.orderWallsStatus = event.status;
      if (event.kind === 'snapshot') this.engine?.setOrderWallSnapshot(event.segments ?? [], event.status);
      else this.engine?.patchOrderWalls(event.patches ?? [], event.status);
      this.orderWallsControls.setStatus(event.status);
      this.renderActiveIndicators();
      if (event.status.retentionStart !== undefined) this.updateOrderWallsViewport();
    });
  }

  private subscribeFootprint() {
    const attached = Boolean(this.nativeIndicator(FOOTPRINT_ID));
    const key = attached && supportsDepth(this.selection) ? `${this.selectionEpoch}:${instrumentKey(this.selection)}:${this.selection.interval}:${this.selection.rowPrice}` : '';
    if (key === this.footprintSubscriptionKey) return;
    this.releaseFootprint?.(); this.releaseFootprint = undefined; this.footprintSubscriptionKey = key;
    const generation = ++this.footprintGeneration; this.footprintBars = []; this.footprintNeedsSync = true; this.footprintHasInitialView = false;
    if (this.selection.type === 'footprint') this.engine?.setFootprintBars([], false);
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
    this.releaseFootprint = this.feed.subscribeFootprint(this.params.api.id, selection, selection.rowPrice, event => {
      if (this.dead || epoch !== this.selectionEpoch || generation !== this.footprintGeneration || !this.nativeIndicator(FOOTPRINT_ID)) return;
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
        this.footprintBars = event.bars.slice().sort((a, b) => a.time - b.time);
        this.footprintStatus = { ...this.footprintStatus, retentionStart: event.retentionStart };
        if (this.visible && this.selection.type === 'footprint') {
          this.engine?.setFootprintBars(this.footprintBars, true);
          this.footprintNeedsSync = false;
          this.focusFootprintOnce();
          if (this.visible && !this.hoveredFootprint) this.refreshReadout();
        } else this.footprintNeedsSync = true;
      } else if (event.type === 'footprint-patch') {
        this.mergeFootprints(event.bars, event.retentionStart);
        this.footprintStatus = { ...this.footprintStatus, retentionStart: event.retentionStart };
        if (this.visible && this.selection.type === 'footprint') {
          this.engine?.applyFootprintPatch(event.bars, event.retentionStart);
          this.footprintNeedsSync = false;
          this.focusFootprintOnce();
          const hoveredTime = this.hoveredFootprint?.time;
          const hoveredBarRetained = hoveredTime === undefined || this.barAt(hoveredTime) !== undefined;
          const hoveredBarUpdated = hoveredTime !== undefined && event.bars.some(bar => bar.time === hoveredTime);
          if (!hoveredBarRetained) this.hoveredFootprint = null;
          if (!hoveredBarRetained || !this.hoveredFootprint || hoveredBarUpdated) this.refreshReadout();
        } else this.footprintNeedsSync = true;
      }
      if (event.type === 'footprint-snapshot' || event.type === 'footprint-patch') this.updateStatus();
    });
    this.updateStatus();
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
    const plot = this.engine?.chart.plotRect(0);
    const point = event.point;
    const wallHit: OrderWallHit | null = point && plot ? this.engine?.orderWallAt(point.x - plot.left, point.y - plot.top) ?? null : null;
    if (wallHit && this.nativeIndicator(ORDER_WALLS_ID)?.visible) this.heatmapControls.showSharedTooltip(this.orderWallsControls.tooltip(wallHit, this.selection, this.orderWallsStatus));
    else this.heatmapControls.hover(point && plot ? this.engine?.heatmapAt(point.x - plot.left, point.y - plot.top) ?? null : null);
    if (event.point === null || event.time === null) {
      this.hoveredBar = null;
      this.hoveredFootprint = null;
    } else if (this.selection.type === 'footprint') {
      this.hoveredBar = null;
      this.hoveredFootprint = this.engine?.footprintAt(event.point.x, event.point.y) ?? null;
    } else {
      this.hoveredFootprint = null;
      this.hoveredBar = event.bar;
    }
    this.refreshReadout();
  }

  private visibility() {
    const nextVisible = this.params.api.isVisible;
    if (this.visible && !nextVisible) this.engine?.capturePendingView();
    this.visible = nextVisible;
    this.studyHost?.setVisible(this.visible);
    if (this.engine) {
      this.engine.visible = this.visible;
      if (this.visible) this.scheduler.invalidate(this.engine);
    }
    if (this.visible) {
      this.heatmapControls.setStatus(this.heatmapStatus);
      if (this.selection.type === 'footprint') {
        if (this.footprintNeedsSync) {
          this.engine?.setFootprintBars(this.footprintBars, true);
          this.footprintNeedsSync = false;
        }
        this.focusFootprintOnce();
      }
      this.refreshReadout();
      this.updateStatus();
    }
  }

  private updateReadout(bar: Bar | null) {
    delete this.readout.dataset.coverage;
    this.readout.dataset.mode = 'candle';
    this.readout.title = '';
    if (!bar) {
      if (this.readout.textContent) this.readout.textContent = '';
      return;
    }
    const text = `O ${bar.open.toFixed(1)}  H ${bar.high.toFixed(1)}  L ${bar.low.toFixed(1)}  C ${bar.close.toFixed(1)}  V ${(bar.volume ?? 0).toFixed(3)} BTC`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }

  private refreshReadout() {
    if (this.selection.type !== 'footprint') {
      this.updateReadout(this.hoveredBar ?? this.engine?.latestCandle() ?? null);
      return;
    }
    this.readout.dataset.mode = 'footprint';
    const hover = this.hoveredFootprint;
    const time = hover?.time ?? this.footprintBars.at(-1)?.time;
    const rawBar = time === undefined ? undefined : this.barAt(time);
    const bar = rawBar ? footprintForUnits(rawBar, this.selection.footprintUnits) : null;
    if (!rawBar) {
      this.readout.textContent = 'Waiting for retained aggregate observations';
      this.readout.dataset.coverage = 'waiting';
      this.readout.title = 'Waiting for a retained Binance USD-M aggregate-observation bar';
      return;
    }
    if (!bar) {
      this.readout.textContent = 'USDT notional unavailable for these observations · select BTC';
      this.readout.title = this.readout.textContent;
      return;
    }
    const units = this.selection.footprintUnits === 'btc' ? 'BTC' : 'USDT';
    const volumeText = (value: number) => units === 'BTC' ? value.toFixed(3) : footprintPriceFormatter.format(value);
    let bidVolume = 0, askVolume = 0;
    for (const footprintCell of bar.cells) {
      bidVolume += footprintCell.bidVol;
      askVolume += footprintCell.askVol;
    }
    const coverage = bar.coverage;
    const gap = bar.gapBefore ? ' · gap before' : '';
    const quote = instrumentOf(this.selection).quote;
    const total = bidVolume + askVolume;
    const cell = hover?.price == null ? undefined : bar.cells.find(item => item.price === hover.price);
    const timestamp = new Date(bar.time * 1000).toISOString().slice(11, 19);
    const hasCell = cell !== undefined;
    const cellText = cell && hover?.price !== null && hover?.price !== undefined
      ? `${formatFootprintPrice(cell.price)}–${formatFootprintPrice(cell.price + bar.rowSize)} ${quote} (upper exclusive) · bid ${volumeText(cell.bidVol)} / ask ${volumeText(cell.askVol)} ${units}`
      : 'Hover a cell for price and bid / ask volume';
    const coverageText = `[${coverage}${gap}] ${timestamp} UTC`;
    const barText = `O ${formatFootprintPrice(bar.open)} · H ${formatFootprintPrice(bar.high)} · L ${formatFootprintPrice(bar.low)} · C ${formatFootprintPrice(bar.close)}`;
    const totalText = `V ${volumeText(total)} · Bid ${volumeText(bidVolume)} · Ask ${volumeText(askVolume)} · Δ ${volumeText(bar.delta)} ${units}`;
    const text = hasCell
      ? `${cellText}\n${coverageText}\n${barText}\n${totalText}`
      : `${coverageText}\n${barText}\n${totalText}\n${cellText}`;
    this.readout.dataset.coverage = coverage;
    this.readout.title = text;
    if (this.readout.textContent !== text) this.readout.textContent = text;
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
    const age = status.lastUpdate
      ? `${Math.max(0, Math.floor((Date.now() - status.lastUpdate) / 1000))}s ago`
      : 'no live update';
    const coverage = isFootprint ? ` · ${this.footprintStatus.coverage} coverage` : '';
    const collectingSince = isFootprint && this.footprintStatus.collectionStartedAt
      ? ` · collecting since ${new Date(this.footprintStatus.collectionStartedAt).toISOString().slice(11, 19)} UTC`
      : '';
    const text = `${status.state} · ${status.message}${coverage}${collectingSince} · ${age}`;
    if (this.statusText.textContent !== text) { this.statusText.textContent = text; this.statusText.title = text; }
    if (this.statusNode.dataset.state !== status.state) this.statusNode.dataset.state = status.state;
    const showRetry = status.state === 'failed' || status.state === 'stale';
    if (this.statusText.parentElement !== this.statusNode || (this.retry.parentElement === this.statusNode) !== showRetry) {
      this.statusNode.replaceChildren(this.statusText, ...(showRetry ? [this.retry] : []));
    }
    const noData = !this.engine?.barCount;
    const statusParent = noData ? this.chart : this.chartFooter;
    if (this.statusNode.parentElement !== statusParent) statusParent.append(this.statusNode);
    if (this.statusNode.classList.contains('no-data') !== noData) this.statusNode.classList.toggle('no-data', noData);
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
    const priceScale = this.engine?.chart.panes()[0]?.priceScale;
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
      heatmap: { ...this.engine?.heatmapDiagnostics(), status: this.heatmapStatus, settings: this.selection.heatmap },
      orderWalls: { ...this.engine?.orderWallsDiagnostics(), status: this.orderWallsStatus,
        settings: orderWallsSettings(this.nativeIndicator(ORDER_WALLS_ID)?.settings ?? DEFAULT_ORDER_WALLS_SETTINGS) },
      studies: this.studyHost?.diagnostics(),
    };
  }

  dispose() {
    this.cancelWatchPick?.();
    this.dead = true;
    if (sharedObjectsOwner === this) {
      sharedObjectsOwner = undefined;
      this.objectsPanel.open = false;
      this.objectsPanel.remove();
      this.objectRows.clear();
      this.objectPaneSections.clear();
      getSharedObjectsView().ownerId = undefined;
      this.objectsRows.replaceChildren();
    }
    this.selectionEpoch++;
    clearInterval(this.timer);
    this.toolbarResizeObserver?.disconnect();
    this.abort.abort(); this.marketPicker.dispose();
    if (this.picker.open) this.picker.close();
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
    this.releaseOrderWalls?.(); this.orderWallsGeneration++; this.orderWallsControls.dispose();
    this.releaseFootprint?.(); this.footprintGeneration++;
    this.indicatorLifecycle?.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.studyHost?.dispose();
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

const footprintPriceFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatFootprintPrice(value: number) {
  return Number.isFinite(value) ? footprintPriceFormatter.format(value) : '—';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not complete the chart action.';
}

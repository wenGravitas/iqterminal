import { HeatmapControls } from './heatmap-controls';
import { heatmapSettings, heatmapKey, type HeatmapSettings, type HeatmapStatus } from './feed/heatmap-model';
import { duration } from './feed/protocol';
import type { Bar, CrosshairMoveEvent } from 'openalgo-charts';
import type { FootprintCellStyle, FootprintDisplayMode, FootprintHover } from 'openalgo-charts/profile';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { canonicalFootprintRowPrice, canonicalSeries, FOOTPRINT_DEFAULT_ROW_PRICE, FOOTPRINT_MAX_ROW_PRICE, footprintTicksForPrice, instrumentKey, instrumentOf, instrumentLabel, instruments, intervals, legacyFootprintRowTicks, marketOf, seriesForInstrument, supportsDepth, validFootprintRowPrice, type CanonicalSeries, type FootprintBar, type FootprintStatus, type Interval, type Status } from './feed/protocol';
import { OpenAlgoCandleChart } from './chart/openalgo';
import type { Scheduler } from './chart/scheduler';
import { footprintForUnits, type FootprintUnits } from './chart/footprint-units';
import { MAX_STUDIES_PER_CHART, ScriptStudyHost, validStudyPins, type ScriptInputView, type StudyPin } from './scripts/host';
import type { ScriptLibrary, ScriptRecord } from './scripts/library';
import { makeInputControl, readInputSettings } from './scripts/input-controls';

export interface FootprintViewOptions {
  displayMode: FootprintDisplayMode;
  cellStyle: FootprintCellStyle;
  showPoc: boolean;
  showDiagonalImbalances: boolean;
  stackedImbalances: boolean;
  imbalanceRatio: 2 | 3 | 4;
  imbalanceThreshold: number;
}
export interface PanelConfig extends CanonicalSeries { type: 'candle' | 'footprint'; grid: boolean; rowPrice: number; footprintUnits: FootprintUnits; footprint: FootprintViewOptions; heatmap: HeatmapSettings; studies: StudyPin[] }
const DEFAULT_FOOTPRINT_VIEW: FootprintViewOptions = {
  displayMode: 'bidask', cellStyle: 'ladder', showPoc: true,
  showDiagonalImbalances: true, stackedImbalances: false,
  imbalanceRatio: 3, imbalanceThreshold: 0.01,
};
export function config(value: unknown): PanelConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const series = canonicalSeries(value) ?? { venue: 'binance' as const, market: 'perpetual' as const, interval: '1m' as const };
  const savedFootprint = source.footprint && typeof source.footprint === 'object' ? source.footprint as Record<string, unknown> : {};
  const footprint: FootprintViewOptions = {
    displayMode: savedFootprint.displayMode === 'delta' || savedFootprint.displayMode === 'volume' ? savedFootprint.displayMode : 'bidask',
    cellStyle: savedFootprint.cellStyle === 'profile' ? 'profile' : 'ladder',
    showPoc: typeof savedFootprint.showPoc === 'boolean' ? savedFootprint.showPoc : DEFAULT_FOOTPRINT_VIEW.showPoc,
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
  const wantsFootprint = source.type === 'footprint' && supportsDepth(series);
  return { ...series, type: wantsFootprint ? 'footprint' : 'candle', rowPrice,
    grid: typeof source.grid === 'boolean' ? source.grid : true,
    footprintUnits: source.footprintUnits === 'usdt' ? 'usdt' : 'btc', footprint, heatmap: heatmapSettings(source.heatmap), studies: validStudyPins(source.studies) };
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
  private releaseHeatmap?: () => void;
  private heatmapSubscriptionKey = '';
  private heatmapGeneration = 0;
  private heatmapStatus?: HeatmapStatus;
  private toolbarWrap = document.createElement('div');
  private chart = document.createElement('div');
  private chartFooter = document.createElement('footer');
  private toolbar = document.createElement('div');
  private toolbarCue = document.createElement('button');
  private depthNotice = document.createElement('div');
  private readout = document.createElement('div');
  private statusNode = document.createElement('div');
  private statusText = document.createElement('span');
  private instrument = document.createElement('select');
  private chartType = document.createElement('select');
  private rowPrice = document.createElement('input');
  private rowPriceControl = document.createElement('label');
  private chartSettings = document.createElement('button');
  private chartSettingsDialog = document.createElement('dialog');
  private gridCheckbox = document.createElement('input');
  private footprintSettings = document.createElement('button');
  private footprintUnits = document.createElement('button');
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
    this.instrument.setAttribute('aria-label', 'Instrument');
    for (const [value, info] of Object.entries(instruments)) this.instrument.add(new Option(info.label, value));
    this.chartType.className = 'chart-type-select';
    this.chartType.setAttribute('aria-label', 'Chart type');
    this.chartType.add(new Option('Candle', 'candle'));
    const footprint = new Option('Footprint', 'footprint');
    this.chartType.add(footprint);
    this.chartType.value = 'candle';
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
    this.footprintSettings.replaceChildren();
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
    this.footprintSettings.append(settingsIcon);
    this.footprintSettings.className = 'footprint-settings-button';
    this.footprintSettings.setAttribute('aria-label', 'Footprint display settings');
    this.footprintSettings.title = 'Footprint display settings';
    this.latest.className = 'chart-latest-button';
    this.latest.textContent = 'Latest';
    this.latest.title = 'Return to the latest candle and restore price autoscale (Home or double click)';
    this.indicators.textContent = 'Indicators';
    this.indicators.title = 'Add a study or open the local OpenScript library';
    this.retry.textContent = 'Retry';
    this.retry.setAttribute('aria-label', 'Retry market data');
    this.heatmapControls = new HeatmapControls(settings => this.changeHeatmap(settings), () => this.feed.retryDepth(), this.abort.signal, settingsIcon.cloneNode(true));
    this.toolbar.append(this.instrument, this.chartType, this.interval, this.rowPriceControl, this.footprintUnits, this.footprintSettings, this.latest, this.indicators, this.chartSettings, this.heatmapControls.toggle, this.heatmapControls.settings, this.metadata);
    this.toolbarWrap.append(this.toolbar, this.toolbarCue);
    this.buildDialogs();
    this.element.append(this.toolbarWrap, this.depthNotice, this.chart, this.chartFooter, this.picker, this.settingsDialog, this.footprintDialog, this.heatmapControls.dialog, this.chartSettingsDialog);
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.element.dataset.panelId = params.api.id;
    this.selection = config(params.params);
    this.gridCheckbox.checked = this.selection.grid;
    params.api.updateParameters(this.selection);
    this.instrument.value = instrumentKey(this.selection);
    this.chartType.value = this.selection.type;
    this.rowPrice.value = String(this.selection.rowPrice);
    this.interval.value = this.selection.interval;
    this.updateFootprintControls();
    const options = { signal: this.abort.signal };
    this.instrument.addEventListener('change', () => this.select(), options);
    this.chartType.addEventListener('change', () => this.selectMode(), options);
    this.rowPrice.addEventListener('change', () => this.selectRowPrice(), options);
    this.footprintUnits.addEventListener('click', () => {
      this.selection = config({ ...this.selection, footprintUnits: this.selection.footprintUnits === 'btc' ? 'usdt' : 'btc' });
      this.params.api.updateParameters(this.selection);
      this.engine?.setFootprintUnits(this.selection.footprintUnits);
      this.updateFootprintControls();
      this.refreshReadout();
      this.save();
    }, options);
    this.interval.addEventListener('change', () => this.select(), options);
    this.latest.addEventListener('click', () => this.selection.type === 'footprint' ? this.engine?.focusFootprintLatest() : this.engine?.resetView(), options);
    this.indicators.addEventListener('click', () => void this.openPicker(), options);
    this.retry.addEventListener('click', () => this.selection.type === 'footprint' ? this.feed.retryFootprint() : this.feed.retry(params.api.id), options);
    this.footprintSettings.addEventListener('click', () => this.openFootprintSettings(), options);
    this.pickerSearch.addEventListener('input', () => this.renderPicker(), options);
    this.picker.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dialog-action],button[data-add-script]');
      if (!button || button.disabled) return;
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
    this.chart.addEventListener('dblclick', () => this.engine?.resetView(), options);
    this.chart.addEventListener('keydown', event => this.keydown(event), options);
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
    this.engine = new OpenAlgoCandleChart(this.chart, this.scheduler, 'canvas2d');
    this.engine.setGridVisible(this.selection.grid);
    if (this.selection.type === 'footprint') this.engine.setDisplayMode('footprint');
    this.applyFootprintOptions();
    this.studyHost = new ScriptStudyHost(params.api.id, this.engine, this.feed, this.library, this.selection, studies => {
      this.selection = { ...this.selection, studies };
      this.params.api.updateParameters(this.selection);
      this.save();
    });
    this.subscriptions.push({ dispose: this.studyHost.subscribe(() => this.updateDepthNotice()) });
    this.studyHost.restore(this.selection.studies);
    const unsubscribeCrosshair = this.engine.chart.subscribeCrosshairMove(event => this.crosshair(event));
    this.subscriptions.push({ dispose: unsubscribeCrosshair });
    this.subscriptions.push(
      { dispose: this.engine.chart.on('indicatorSource', event => this.openStudySource(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorSettings', event => void this.openStudySettings(event.instanceId)) },
      { dispose: this.engine.chart.on('indicatorRemoved', event => this.studyHost?.removeNativeInstance(event.instanceId)) },
      { dispose: this.engine.chart.on('objects:change', () => this.studyHost?.syncNativeVisibility()) },
    );
    this.chart.append(this.readout, this.heatmapControls.readout);
    this.chartFooter.append(this.heatmapControls.notice, this.statusNode);
    this.subscriptions.push(params.api.onDidVisibilityChange(() => this.visibility()));
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
    this.gridCheckbox.type = 'checkbox'; gridLabel.append(gridText, this.gridCheckbox); chartFields.append(gridLabel);
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
    const footprintTitle = document.createElement('h2'); footprintTitle.textContent = 'Footprint display';
    footprintHeader.append(footprintTitle, this.dialogButton('Close', 'close-footprint'));
    this.footprintFields.className = 'footprint-settings-fields';
    this.footprintFields.append(
      this.footprintField('Cell display', this.selectControl('displayMode', [
        ['bidask', 'Bid / ask'], ['delta', 'Delta'], ['volume', 'Volume'],
      ])),
      this.footprintField('Cells', this.selectControl('cellStyle', [
        ['ladder', 'Bid / ask ladder'], ['profile', 'Volume profile'],
      ])),
      this.footprintField('Show point of control', this.checkboxControl('showPoc')),
      this.footprintField('Diagonal imbalances', this.checkboxControl('showDiagonalImbalances')),
      this.footprintField('Stacked imbalance brackets', this.checkboxControl('stackedImbalances')),
      this.footprintField('Dominant / opposing ratio', this.selectControl('imbalanceRatio', [
        ['2', '2 : 1'], ['3', '3 : 1'], ['4', '4 : 1'],
      ])),
      this.footprintField('Minimum dominant volume (BTC)', this.numberControl('imbalanceThreshold')),
    );
    const settingsHint = document.createElement('p');
    settingsHint.className = 'footprint-settings-hint';
    settingsHint.textContent = 'Rows start at fixed price multiples and include their lower bound, excluding their upper bound. Diagonal imbalances color dominant buy or sell rows. Optional brackets mark runs of two adjacent rows. Both use classified aggregate observations only. Changing interval or row size starts a fresh collection unless another chart retains that exact stream; OpenScript studies use native candle OHLCV.';
    const footprintFooter = document.createElement('footer');
    footprintFooter.append(this.dialogButton('Cancel', 'close-footprint'), this.dialogButton('Apply', 'apply-footprint', true));
    this.footprintForm.append(footprintHeader, this.footprintFields, settingsHint, footprintFooter);
    this.footprintDialog.append(this.footprintForm);
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

  private openFootprintSettings() {
    if (this.selection.type !== 'footprint') return;
    const view = this.selection.footprint;
    const mode = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="displayMode"]')!;
    const style = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="cellStyle"]')!;
    const poc = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showPoc"]')!;
    const diagonal = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showDiagonalImbalances"]')!;
    const stacked = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="stackedImbalances"]')!;
    const ratio = this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="imbalanceRatio"]')!;
    const threshold = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="imbalanceThreshold"]')!;
    mode.value = view.displayMode; style.value = view.cellStyle; poc.checked = view.showPoc;
    diagonal.checked = view.showDiagonalImbalances; stacked.checked = view.stackedImbalances;
    ratio.value = String(view.imbalanceRatio); threshold.value = String(view.imbalanceThreshold);
    if (!this.footprintDialog.open) this.footprintDialog.showModal();
  }

  private applyFootprintSettings() {
    if (this.selection.type !== 'footprint') return;
    const threshold = this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="imbalanceThreshold"]')!;
    if (!threshold.reportValidity()) return;
    const updated = config({
      ...this.selection,
      footprint: {
        displayMode: this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="displayMode"]')!.value,
        cellStyle: this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="cellStyle"]')!.value,
        showPoc: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showPoc"]')!.checked,
        showDiagonalImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="showDiagonalImbalances"]')!.checked,
        stackedImbalances: this.footprintFields.querySelector<HTMLInputElement>('[data-footprint-option="stackedImbalances"]')!.checked,
        imbalanceRatio: Number(this.footprintFields.querySelector<HTMLSelectElement>('[data-footprint-option="imbalanceRatio"]')!.value),
        imbalanceThreshold: Number(threshold.value),
      },
    });
    this.selection = updated;
    this.params.api.updateParameters(this.selection);
    this.applyFootprintOptions();
    this.save();
    this.footprintDialog.close();
  }

  private applyFootprintOptions() {
    const view = this.selection.footprint;
    this.engine?.setFootprintUnits(this.selection.footprintUnits);
    this.engine?.setFootprintOptions({
      displayMode: view.displayMode,
      cellStyle: view.cellStyle,
      showPoc: view.showPoc,
      pocStyle: 'outline',
      pocColor: '#858585',
      buyColor: '#58a65c',
      buyTextColor: '#58a65c',
      sellColor: '#ad5858',
      sellTextColor: '#ad5858',
      radius: 0,
      imbalanceRatio: view.imbalanceRatio,
      imbalanceThreshold: view.showDiagonalImbalances ? view.imbalanceThreshold : Number.MAX_VALUE,
      textColorMode: view.showDiagonalImbalances ? 'imbalance' : 'contrast',
      stackedImbalances: view.showDiagonalImbalances && view.stackedImbalances ? 2 : 0,
      showCandle: true,
      statsRows: ['volume', 'bidVolume', 'askVolume', 'delta'],
      tableRows: [],
      showValueArea: false,
    });
  }

  private updateFootprintControls() {
    const option = [...this.chartType.options].find(item => item.value === 'footprint');
    if (option) {
      option.disabled = !supportsDepth(this.selection);
      option.textContent = option.disabled ? 'Footprint · USD-M only' : 'Footprint';
      option.title = option.disabled ? 'Footprint is supported only for Binance BTCUSDT USD-M perpetual' : 'Live Binance USD-M aggregate observations';
    }
    this.chartType.value = this.selection.type;
    this.footprintUnits.hidden = this.selection.type !== 'footprint';
    this.footprintUnits.textContent = this.selection.footprintUnits === 'btc' ? 'BTC' : 'USDT';
    this.footprintUnits.setAttribute('aria-pressed', String(this.selection.footprintUnits === 'usdt'));
    this.footprintUnits.title = this.selection.footprintUnits === 'btc'
      ? 'Volume in BTC · click for USDT notional' : 'Execution notional in USDT · click for BTC volume';
    if (document.activeElement !== this.rowPrice) this.rowPrice.value = String(this.selection.rowPrice);
    this.rowPriceControl.hidden = this.selection.type !== 'footprint';
    this.footprintSettings.hidden = this.selection.type !== 'footprint';
    this.chart.setAttribute('aria-label', `${instrumentLabel(this.selection)} ${this.selection.type === 'footprint' ? 'Footprint' : 'candlestick'} chart`);
    this.metadata.dataset.mode = this.selection.type;
    if (this.selection.type === 'footprint') this.updateFootprintMetadata();
    else this.updateInstrumentMetadata();
    this.updateToolbarOverflowCue();
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

  private async openPicker() {
    this.pickerStatus.textContent = 'Loading local studies…';
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
    const groups: { name: string; records: ScriptRecord[] }[] = [
      { name: 'Trend', records: [] },
      { name: 'Volume', records: [] },
      { name: 'Order book', records: [] },
      { name: 'My scripts', records: [] },
    ];
    for (const record of this.pickerRecords) {
      const searchable = `${record.title} ${record.description}`.toLocaleLowerCase();
      if (query && !searchable.includes(query)) continue;
      const revision = record.revisions.find(item => item.id === record.currentRevision);
      const requiresDepth = revision?.declaredCapabilities.includes('iqterminal.depth.series.v1') === true;
      const category = !record.builtin ? 'My scripts'
        : record.id === 'builtin.volume-histogram' ? 'Volume'
          : requiresDepth ? 'Order book' : 'Trend';
      groups.find(group => group.name === category)?.records.push(record);
    }
    this.pickerList.replaceChildren();
    const activeCount = this.studyHost?.diagnostics().attached ?? 0;
    let shown = 0;
    let enabled = 0;
    for (const group of groups) {
      if (!group.records.length) continue;
      const section = document.createElement('section');
      section.className = 'indicator-category';
      const heading = document.createElement('h3'); heading.textContent = group.name;
      section.append(heading);
      for (const record of group.records) {
        const revision = record.revisions.find(item => item.id === record.currentRevision);
        const requiresDepth = revision?.declaredCapabilities.includes('iqterminal.depth.series.v1') === true;
        const unsupported = requiresDepth && !supportsDepth(this.selection);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'indicator-option';
        row.dataset.addScript = record.id;
        row.setAttribute('aria-label', `Add ${record.title}`);
        row.disabled = this.pickerBusy || activeCount >= MAX_STUDIES_PER_CHART || unsupported;
        row.title = unsupported ? 'Depth studies require Binance BTCUSDT USD-M Perp' : activeCount >= MAX_STUDIES_PER_CHART ? `This chart already has ${MAX_STUDIES_PER_CHART} studies` : `Add ${record.title} with its default settings`;
        const copy = document.createElement('div'); copy.className = 'indicator-option-copy';
        const title = document.createElement('strong'); title.textContent = record.title;
        const description = document.createElement('span'); description.textContent = record.description;
        copy.append(title, description);
        const action = document.createElement('span'); action.className = 'indicator-option-action'; action.textContent = '＋ Add'; action.setAttribute('aria-hidden', 'true');
        row.append(copy, action);
        if (unsupported) {
          const note = document.createElement('small'); note.textContent = 'Binance BTCUSDT USD-M Perp only';
          row.append(note);
        }
        section.append(row);
        shown++;
        if (!unsupported && activeCount < MAX_STUDIES_PER_CHART) enabled++;
      }
      this.pickerList.append(section);
    }
    this.pickerStatus.textContent = statusMessage ?? (shown
      ? `${enabled} addable · ${activeCount}/${MAX_STUDIES_PER_CHART} studies attached`
      : 'No indicators match this search.');
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
    const study = attachmentId && this.studyHost?.views().find(view => view.attachmentId === attachmentId);
    if (!attachmentId || !study) return;
    this.settingsAttachmentId = attachmentId;
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
    const type = this.selection.type === 'footprint' && supportsDepth(series ?? this.selection) ? 'footprint' : 'candle';
    const wasFootprint = this.selection.type === 'footprint';
    this.selection = config({ ...this.selection, ...(series ?? {}), type, studies: this.selection.studies });
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

  private selectMode() {
    const requested = this.chartType.value === 'footprint' ? 'footprint' : 'candle';
    const type = requested === 'footprint' && supportsDepth(this.selection) ? 'footprint' : 'candle';
    if (type === this.selection.type) { this.updateFootprintControls(); return; }
    this.selection = config({ ...this.selection, type });
    this.params.api.updateParameters(this.selection);
    this.updateFootprintControls();
    this.hoveredBar = null;
    this.hoveredFootprint = null;
    if (type === 'footprint') {
      this.footprintHasInitialView = false;
      this.footprintNeedsSync = true;
      this.engine?.setDisplayMode('footprint', true);
      this.footprintBars = [];
      this.footprintStatus = { ...this.footprintStatus, state: 'loading', message: 'Waiting for Binance USD-M aggTrade observations', coverage: 'waiting', lastUpdate: 0 };
      this.subscribeFootprint();
    } else {
      this.releaseFootprint?.(); this.releaseFootprint = undefined;
      this.footprintBars = [];
      this.engine?.setDisplayMode('candle', true);
      this.engine?.setSnapshot(this.candles, false);
      this.engine?.resetView();
    }
    this.syncHeatmap();
    this.refreshReadout();
    this.updateStatus();
    this.save();
  }

  private selectRowPrice() {
    const parsed = Number(this.rowPrice.value);
    if (!validFootprintRowPrice(parsed)) {
      this.rowPrice.setCustomValidity(`Enter a price level greater than $0 and no more than $${FOOTPRINT_MAX_ROW_PRICE.toLocaleString('en-US')}.`);
      this.rowPrice.reportValidity();
      return;
    }
    this.rowPrice.setCustomValidity('');
    if (parsed === this.selection.rowPrice) { this.rowPrice.value = String(this.selection.rowPrice); return; }
    if (this.footprintStatus.tickSize !== null && footprintTicksForPrice(parsed, this.footprintStatus.tickSize) === null) {
      const tick = formatFootprintPrice(this.footprintStatus.tickSize);
      this.rowPrice.setCustomValidity(`Enter a multiple of the current BTCUSDT tick size, $${tick} USDT.`);
      this.rowPrice.reportValidity();
      return;
    }
    this.selection = config({ ...this.selection, rowPrice: parsed });
    this.footprintNeedsSync = true;
    this.hoveredFootprint = null;
    this.footprintBars = [];
    this.footprintStatus = { ...this.footprintStatus, state: 'loading', message: 'Validating the selected price level against Binance tick metadata…', coverage: 'waiting', lastUpdate: 0 };
    this.engine?.setFootprintBars([], false);
    this.subscribeFootprint();
    this.syncHeatmap();
    this.refreshReadout();
    this.updateStatus();
  }

  private subscribe() {
    this.release?.();
    const epoch = ++this.selectionEpoch;
    const selection = this.selection;
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
    if (selection.type === 'footprint') this.subscribeFootprint();
    else { this.releaseFootprint?.(); this.releaseFootprint = undefined; }
  }

  private changeHeatmap(settings: HeatmapSettings) {
    this.selection = config({ ...this.selection, heatmap: { ...settings, rowPrice: this.selection.type === 'footprint' ? this.selection.heatmap.rowPrice : settings.rowPrice } });
    this.params.api.updateParameters(this.selection); this.syncHeatmap(); this.save();
  }
  private syncHeatmap() {
    const supported = supportsDepth(this.selection), footprint = this.selection.type === 'footprint';
    const settings: HeatmapSettings = footprint ? { ...this.selection.heatmap, rowPrice: this.selection.rowPrice, rowAlignment: 'footprint' } : this.selection.heatmap;
    this.heatmapControls.sync(settings, supported, footprint);
    this.engine?.setHeatmap({ ...settings, enabled: settings.enabled && supported }, duration[this.selection.interval]);
    const key = settings.enabled && supported ? heatmapKey(settings) : '';
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
    });
  }

  private subscribeFootprint() {
    this.releaseFootprint?.();
    this.releaseFootprint = undefined;
    if (this.selection.type !== 'footprint' || !supportsDepth(this.selection)) return;
    const epoch = this.selectionEpoch;
    const selection = this.selection;
    this.footprintStatus = {
      state: 'loading', message: 'Connecting to Binance BTCUSDT USD-M aggTrade…', lastUpdate: 0,
      tickSize: null, rowSize: null, collectionStartedAt: null, firstTradeAt: null, lastTradeAt: null, eventTime: null,
      outages: 0, lateRecords: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0,
      coverage: 'waiting', retentionStart: null,
    };
    this.updateFootprintMetadata();
    this.releaseFootprint = this.feed.subscribeFootprint(this.params.api.id, selection, selection.rowPrice, event => {
      if (this.dead || epoch !== this.selectionEpoch || this.selection.type !== 'footprint') return;
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
        if (this.visible) {
          this.engine?.setFootprintBars(this.footprintBars, true);
          this.footprintNeedsSync = false;
          this.focusFootprintOnce();
          if (this.visible && !this.hoveredFootprint) this.refreshReadout();
        } else this.footprintNeedsSync = true;
      } else if (event.type === 'footprint-patch') {
        this.mergeFootprints(event.bars, event.retentionStart);
        this.footprintStatus = { ...this.footprintStatus, retentionStart: event.retentionStart };
        if (this.visible) {
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
    this.heatmapControls.hover(point && plot ? this.engine?.heatmapAt(point.x - plot.left, point.y - plot.top) ?? null : null);
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
      studies: this.studyHost?.diagnostics(),
    };
  }

  dispose() {
    this.dead = true;
    this.selectionEpoch++;
    clearInterval(this.timer);
    this.toolbarResizeObserver?.disconnect();
    this.abort.abort();
    if (this.picker.open) this.picker.close();
    if (this.settingsDialog.open) this.settingsDialog.close();
    if (this.footprintDialog.open) this.footprintDialog.close();
    if (this.chartSettingsDialog.open) this.chartSettingsDialog.close();
    this.release?.();
    this.releaseHeatmap?.(); this.heatmapGeneration++; this.heatmapControls.dispose();
    this.releaseFootprint?.();
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

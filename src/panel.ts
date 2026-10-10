import type { Bar, CrosshairMoveEvent } from 'openalgo-charts';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { canonicalSeries, instrumentKey, instrumentOf, instrumentLabel, instruments, intervals, marketOf, seriesForInstrument, supportsDepth, type CanonicalSeries, type Interval, type Status } from './feed/protocol';
import { OpenAlgoCandleChart } from './chart/openalgo';
import type { Scheduler } from './chart/scheduler';
import { MAX_STUDIES_PER_CHART, ScriptStudyHost, validStudyPins, type ScriptInputView, type StudyPin } from './scripts/host';
import type { ScriptLibrary, ScriptRecord } from './scripts/library';
import { makeInputControl, readInputSettings } from './scripts/input-controls';

export interface PanelConfig extends CanonicalSeries { type: 'candle'; studies: StudyPin[] }
export function config(value: unknown): PanelConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const series = canonicalSeries(value) ?? { venue: 'binance' as const, market: 'perpetual' as const, interval: '1m' as const };
  return { ...series, type: 'candle', studies: validStudyPins(source.studies) };
}

export class CandlePanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private chart = document.createElement('div');
  private toolbar = document.createElement('div');
  private depthNotice = document.createElement('div');
  private readout = document.createElement('div');
  private statusNode = document.createElement('div');
  private instrument = document.createElement('select');
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
  private engine?: OpenAlgoCandleChart;
  private studyHost?: ScriptStudyHost;
  private subscriptions: { dispose(): void }[] = [];
  private release?: () => void;
  private params!: IDockviewPanelProps;
  private selection!: PanelConfig;
  private status: Status = { state: 'loading', message: 'Loading…', lastUpdate: 0 };
  private visible = false;
  private dead = false;
  private selectionEpoch = 0;
  private resetViewOnSnapshot = true;
  private timer?: ReturnType<typeof setInterval>;
  private abort = new AbortController();
  private hoveredBar: Bar | null = null;
  private candles: import('./feed/protocol').Candle[] = [];

  constructor(
    private feed: FeedClient,
    private scheduler: Scheduler,
    private library: ScriptLibrary,
    private save: () => void,
    private register: (id: string, panel: CandlePanel | null) => void,
    private openEditor: (chartId: string, attachmentId?: string) => void,
  ) {
    this.element.className = 'candle-panel';
    this.toolbar.className = 'chart-toolbar';
    this.chart.className = 'chart-stage';
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
    this.interval.setAttribute('aria-label', 'Timeframe');
    for (const value of intervals) this.interval.add(new Option(value, value));
    this.latest.textContent = 'Latest';
    this.latest.title = 'Return to the latest candle and restore price autoscale (Home or double click)';
    this.indicators.textContent = 'Indicators';
    this.indicators.title = 'Add a study or open the local OpenScript library';
    this.retry.textContent = 'Retry';
    this.retry.setAttribute('aria-label', 'Retry market data');
    this.toolbar.append(this.instrument, this.interval, this.latest, this.indicators, this.metadata);
    this.buildDialogs();
    this.element.append(this.toolbar, this.depthNotice, this.chart, this.picker, this.settingsDialog);
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.element.dataset.panelId = params.api.id;
    this.selection = config(params.params);
    params.api.updateParameters(this.selection);
    this.instrument.value = instrumentKey(this.selection);
    this.interval.value = this.selection.interval;
    const options = { signal: this.abort.signal };
    this.instrument.addEventListener('change', () => this.select(), options);
    this.interval.addEventListener('change', () => this.select(), options);
    this.latest.addEventListener('click', () => this.engine?.resetView(), options);
    this.indicators.addEventListener('click', () => void this.openPicker(), options);
    this.retry.addEventListener('click', () => this.feed.retry(params.api.id), options);
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
    this.chart.addEventListener('dblclick', () => this.engine?.resetView(), options);
    this.chart.addEventListener('keydown', event => this.keydown(event), options);
    this.engine = new OpenAlgoCandleChart(this.chart, this.scheduler, 'canvas2d');
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
    this.chart.append(this.readout, this.statusNode);
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
        if (!this.hoveredBar) this.updateReadout(this.engine?.latestCandle() ?? null);
      }
    }, 1000);
  }

  private buildDialogs() {
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
    this.selection = config({ ...(series ?? {}), studies: this.selection.studies });
    this.params.api.updateParameters(this.selection);
    this.resetViewOnSnapshot = true;
    this.engine?.setSnapshot([], false);
    this.candles = [];
    this.studyHost?.setSeries(this.selection);
    this.updateDepthNotice();
    this.hoveredBar = null;
    this.updateReadout(null);
    this.subscribe();
    this.save();
  }

  private subscribe() {
    this.release?.();
    const epoch = ++this.selectionEpoch;
    const selection = this.selection;
    const info = instrumentOf(selection);
    this.params.api.setTitle(`${instrumentLabel(selection)} · ${selection.interval}`);
    this.chart.setAttribute('aria-label', `${instrumentLabel(selection)} candlestick chart`);
    this.metadata.textContent = marketOf(selection) === 'spot'
      ? `${info.quote} quote · ${info.base} volume · UTC`
      : `${info.quote} quote · ${info.base} volume · ${info.settlement} settlement · UTC`;
    this.instrument.title = info.settlement
      ? `${info.kind}; quote ${info.quote}; base volume ${info.base}; settlement/collateral ${info.settlement}`
      : `${info.kind}; quote ${info.quote}; base volume ${info.base}; no derivative collateral metadata`;
    this.status = { state: 'loading', message: 'Loading native candles…', lastUpdate: 0 };
    this.updateStatus();
    this.release = this.feed.subscribe(this.params.api.id, selection, event => {
      if (this.dead || epoch !== this.selectionEpoch) return;
      if (event.type === 'status') {
        this.status = event.status;
        this.updateStatus();
      } else if (event.type === 'snapshot') {
        this.candles = event.candles.slice(-5_000);
        this.engine?.setSnapshot(event.candles, !this.resetViewOnSnapshot);
        this.studyHost?.setSnapshot(this.candles);
        if (this.resetViewOnSnapshot) this.engine?.resetView();
        this.resetViewOnSnapshot = false;
        this.hoveredBar = null;
        if (this.visible) this.updateReadout(this.engine?.latestCandle() ?? null);
      } else if (event.type === 'patch') {
        this.mergeCandles(event.candles);
        this.engine?.applyPatch(event.candles);
        this.studyHost?.applyPatch(event.candles);
        if (this.visible && !this.hoveredBar) this.updateReadout(this.engine?.latestCandle() ?? null);
        this.status = { ...this.status, lastUpdate: Date.now() };
      }
    });
  }

  private crosshair(event: CrosshairMoveEvent) {
    if (event.point === null || event.time === null) this.hoveredBar = null;
    else this.hoveredBar = event.bar;
    this.updateReadout(this.hoveredBar ?? this.engine?.latestCandle() ?? null);
  }

  private visibility() {
    this.visible = this.params.api.isVisible;
    this.studyHost?.setVisible(this.visible);
    if (this.engine) {
      this.engine.visible = this.visible;
      if (this.visible) this.scheduler.invalidate(this.engine);
    }
    if (this.visible) {
      this.updateReadout(this.hoveredBar ?? this.engine?.latestCandle() ?? null);
      this.updateStatus();
    }
  }

  private updateReadout(bar: Bar | null) {
    if (!bar) {
      if (this.readout.textContent) this.readout.textContent = '';
      return;
    }
    const text = `O ${bar.open.toFixed(1)}  H ${bar.high.toFixed(1)}  L ${bar.low.toFixed(1)}  C ${bar.close.toFixed(1)}  V ${(bar.volume ?? 0).toFixed(3)} BTC`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
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
    const age = this.status.lastUpdate
      ? `${Math.max(0, Math.floor((Date.now() - this.status.lastUpdate) / 1000))}s ago`
      : 'no live update';
    this.statusNode.replaceChildren();
    this.statusNode.dataset.state = this.status.state;
    const text = document.createElement('span');
    text.textContent = `${this.status.state} · ${this.status.message} · ${age}`;
    this.statusNode.append(text);
    if (this.status.state === 'failed' || this.status.state === 'stale') this.statusNode.append(this.retry);
    this.statusNode.classList.toggle('no-data', !this.engine?.barCount);
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
    this.candles = this.candles.slice(-5_000);
  }

  diagnostics() {
    const range = this.engine?.visibleRange();
    const bar = this.engine?.latestCandle();
    const priceScale = this.engine?.chart.panes()[0]?.priceScale;
    const priceRange = priceScale?.priceRange();
    return {
      id: this.params.api.id,
      visible: this.visible,
      bars: this.engine?.barCount ?? 0,
      right: range?.to ?? 0,
      range,
      spacing: this.engine?.chart.timeScale.barSpacing ?? 0,
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
      studies: this.studyHost?.diagnostics(),
    };
  }

  dispose() {
    this.dead = true;
    this.selectionEpoch++;
    clearInterval(this.timer);
    this.abort.abort();
    if (this.picker.open) this.picker.close();
    if (this.settingsDialog.open) this.settingsDialog.close();
    this.release?.();
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not complete the chart action.';
}

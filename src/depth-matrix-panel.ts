import { MatrixRowLayout, MatrixRowExpansion, MATRIX_ROW_HEIGHT, matrixExactPrice, matrixCurrentBucket, matrixSideWall, usableMatrixMid, type MatrixAnchor } from './depth-matrix-presentation';
import { positionMarketCard, renderDepthMatrixCard } from './market-hover-card';
import { CURRENCY_EVENT, effectiveCurrency, syncCurrencyControl } from './currency-display';
import { PaneLoading } from './pane-loading';
import type { IContentRenderer, IDockviewPanelProps } from 'dockview-core';
import type { FeedClient } from './feed/client';
import { DEPTH_MATRIX_SOURCE_REGISTRY, depthMatrixBarWidth, depthMatrixScaleTarget, depthMatrixSettings, depthMatrixSourceLabel,
  formatDepthMatrixCellValue,
  matrixBucketBounds, matrixBucketIndex, smoothDepthMatrixScale,
  type DepthMatrixColumn, type DepthMatrixSettings, type MatrixCoverage, type MatrixRow } from './feed/depth-matrix';

const ROW_HEIGHT = MATRIX_ROW_HEIGHT;
const HEADER_HEIGHT = 24;
const AXIS_WIDTH = 60;
const RANGE_ROWS = 160;
const RANGE_SHIFT = RANGE_ROWS / 2;
const BUCKET_PRESETS = ['10', '25', '50', '100', '250', '500', '1000'];
const shortName: Record<string, string> = {
  'binance-spot': 'BN SPOT', 'binance-perpetual': 'BN USD-M', 'bybit-spot': 'BYBIT SPOT',
  'bybit-perpetual': 'BYBIT PERP', 'hyperliquid-perpetual': 'HYPERLIQUID',
};

/** One native Dockview panel; aggregation stays in the worker and only bucket rows cross IPC. */
export class DepthMatrixPanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private params!: IDockviewPanelProps;
  private settings: DepthMatrixSettings = depthMatrixSettings(undefined);
  private columns: DepthMatrixColumn[] = [];
  private release?: () => void;
  private visible = false;
  private dockVisible = false;
  private pageVisible = !document.hidden;
  private dead = false;
  private settingsOpen = false;
  private viewport?: { low: string; high: string };
  private gridSignature = '';
  private grid = document.createElement('div');
  private scroll = document.createElement('div');
  private axis: HTMLElement | null = null;
  private axisHead: HTMLElement | null = null;
  private canvases = new Map<string, HTMLCanvasElement>();
  private headers = new Map<string, HTMLElement>();
  private hoverLine = document.createElement('div');
  private rows: MatrixRow[] = [];
  private hoveredIndex = -1;
  private hoverColumn = '';
  private rowLayout = new MatrixRowLayout([]);
  private expansion = new MatrixRowExpansion();
  private collapseTimer?: ReturnType<typeof setTimeout>;
  private restoreAnchor?: MatrixAnchor;
  private pendingPageAccepted = false;
  private referencePrices = new Map<string, string>();
  private referenceSelect = document.createElement('select');
  private hoverAnchor?: { left: number; top: number; right: number; bottom: number };
  private hoverTip = document.createElement('div');
  private settingsPane = document.createElement('div');
  private sourceList = document.createElement('div');
  private sourceSelect = document.createElement('select');
  private bucketInput = document.createElement('input');
  private columnSlider = document.createElement('input');
  private unitSelect = document.createElement('select');
  private scaleSelect = document.createElement('select');
  private wallSelect = document.createElement('select');
  private wallThreshold = document.createElement('input');
  private status = document.createElement('footer');
  private emptyState = document.createElement('div');
  private loading = new PaneLoading();
  private recenterButton = document.createElement('button');
  private setSettingsButton = document.createElement('button');
  private pendingViewport?: { low: string; high: string; anchor?: MatrixAnchor };
  private lastScrollTop = 0;
  private lastScrollLeft = 0;
  private centerPending = true;
  private centeringViewport?: { low: string; high: string };
  private renderFrame = 0;
  private lastScaleUpdate = 0;
  private scales = new Map<string, number>();
  private dirtyRows = new Map<string, Set<string> | null>();
  private listeners: { dispose(): void }[] = [];
  private abort = new AbortController();

  constructor(private feed: FeedClient, private save: () => void) {
    this.element.className = 'depth-matrix-panel';
    this.element.style.setProperty('--depth-matrix-row-height', `${ROW_HEIGHT}px`);
    this.build();
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.settings = depthMatrixSettings(params.params);
    params.api.updateParameters(this.settings);
    params.api.setTitle('Depth Matrix');
    this.syncSettingsControls();
    this.renderSources();
    this.dockVisible = params.api.isVisible;
    this.listeners.push(params.api.onDidVisibilityChange(() => {
      this.dockVisible = params.api.isVisible; this.updateVisibility();
    }), params.api.onDidDimensionsChange(() => { this.markVisibleRows(); this.draw(); }));
    window.addEventListener(CURRENCY_EVENT, () => { this.syncSettingsControls(); this.markVisibleRows(); this.draw(); }, { signal: this.abort.signal });
    window.addEventListener('basis-theme-change', () => { this.markVisibleRows(); this.draw(); }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { this.pageVisible = !document.hidden; this.updateVisibility(); }, { signal: this.abort.signal });
    this.updateVisibility();
    this.draw();
  }

  private build() {
    const toolbar = document.createElement('header'); toolbar.className = 'depth-matrix-toolbar';
    this.setSettingsButton.type = 'button'; this.setSettingsButton.textContent = 'SET'; this.setSettingsButton.title = 'Matrix settings';
    this.setSettingsButton.setAttribute('aria-label', 'Depth Matrix settings'); this.setSettingsButton.setAttribute('aria-expanded', 'false');
    this.recenterButton.type = 'button'; this.recenterButton.textContent = 'CENTER'; this.recenterButton.title = 'Center on the selected reference midpoint'; this.recenterButton.setAttribute('aria-label', 'CENTER');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'RETRY'; retry.title = 'Reconnect and rebuild the synchronized book';
    this.status.className = 'depth-matrix-status'; this.status.setAttribute('role', 'status');
    toolbar.append(this.setSettingsButton, this.recenterButton, retry, this.status);

    this.settingsPane.className = 'depth-matrix-settings'; this.settingsPane.hidden = true;
    this.sourceList.className = 'depth-matrix-sources';
    const sourceField = document.createElement('label'); sourceField.className = 'matrix-setting';
    const sourceLabel = document.createElement('span'); sourceLabel.textContent = 'Add source';
    for (const [id, item] of Object.entries(DEPTH_MATRIX_SOURCE_REGISTRY)) {
      const option = new Option(item.label + (item.supported ? '' : ' · unavailable'), id);
      if (!item.supported) option.disabled = true;
      this.sourceSelect.add(option);
    }
    this.sourceSelect.setAttribute('aria-label', 'Depth source');
    const addSource = document.createElement('button'); addSource.type = 'button'; addSource.textContent = 'ADD';
    addSource.addEventListener('click', () => {
      const source = this.sourceSelect.value;
      if (!source || this.settings.sources.includes(source) || this.settings.sources.length >= 8) return;
      this.applySettings({ ...this.settings, sources: [...this.settings.sources, source] });
    }, { signal: this.abort.signal });
    sourceField.append(sourceLabel, this.sourceSelect, addSource);
    this.settingsPane.append(sourceField, this.sourceList);
    this.referenceSelect.setAttribute('aria-label', 'Reference midpoint source');
    this.referenceSelect.addEventListener('change', () => this.applySettings({ ...this.settings, referenceSourceId: this.referenceSelect.value || null }), { signal: this.abort.signal });
    const referenceField = this.settingField('Reference mid'); referenceField.append(this.referenceSelect); this.settingsPane.append(referenceField);

    this.bucketInput.type = 'text'; this.bucketInput.inputMode = 'decimal'; this.bucketInput.maxLength = 24;
    this.bucketInput.setAttribute('aria-label', 'Bucket width in USDT'); this.bucketInput.title = 'Exact decimal bucket width in USDT';
    this.bucketInput.addEventListener('change', () => {
      const next = depthMatrixSettings({ ...this.settings, bucketWidth: this.bucketInput.value });
      if (next.bucketWidth !== this.bucketInput.value.trim() || Number(next.bucketWidth) <= 0) {
        this.bucketInput.setCustomValidity('Enter a positive decimal bucket width.'); this.bucketInput.reportValidity(); this.syncSettingsControls(); return;
      }
      this.bucketInput.setCustomValidity(''); this.applySettings(next);
    }, { signal: this.abort.signal });
    const presetSelect = document.createElement('select'); presetSelect.setAttribute('aria-label', 'Bucket width preset');
    presetSelect.add(new Option('CUSTOM', 'custom'));
    for (const value of BUCKET_PRESETS) presetSelect.add(new Option(value, value));
    presetSelect.addEventListener('change', () => { if (presetSelect.value !== 'custom') { this.bucketInput.value = presetSelect.value; this.bucketInput.dispatchEvent(new Event('change')); } }, { signal: this.abort.signal });
    const bucketField = this.settingField('Bucket · USDT'); bucketField.append(presetSelect, this.bucketInput); this.settingsPane.append(bucketField);

    this.columnSlider.type = 'range'; this.columnSlider.min = '65'; this.columnSlider.max = '150'; this.columnSlider.step = '1';
    this.columnSlider.setAttribute('aria-label', 'Venue column width');
    this.columnSlider.addEventListener('input', () => this.applySettings({ ...this.settings, columnWidth: Number(this.columnSlider.value) }), { signal: this.abort.signal });
    const widthField = this.settingField('Venue width');
    for (const value of [65, 95, 130]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = String(value); button.title = `${value}px per venue`;
      button.addEventListener('click', () => this.applySettings({ ...this.settings, columnWidth: value }), { signal: this.abort.signal }); widthField.append(button);
    }
    widthField.append(this.columnSlider); this.settingsPane.append(widthField);

    this.unitSelect.add(new Option('BTC', 'btc')); this.unitSelect.add(new Option('USDT', 'usdt'));
    this.unitSelect.setAttribute('aria-label', 'Liquidity display unit'); this.unitSelect.addEventListener('change', () => this.applySettings({ ...this.settings, unit: this.unitSelect.value === 'usdt' ? 'usdt' : 'btc' }), { signal: this.abort.signal });
    this.scaleSelect.add(new Option('Per venue', 'per-source')); this.scaleSelect.add(new Option('Shared', 'shared'));
    this.scaleSelect.setAttribute('aria-label', 'Histogram scale'); this.scaleSelect.addEventListener('change', () => this.applySettings({ ...this.settings, scale: this.scaleSelect.value === 'shared' ? 'shared' : 'per-source' }), { signal: this.abort.signal });
    const unitField = this.settingField('Display / scale'); unitField.append(this.unitSelect, this.scaleSelect); this.settingsPane.append(unitField);

    this.wallSelect.add(new Option('Off', 'off')); this.wallSelect.add(new Option('Relative · visible typical', 'relative')); this.wallSelect.add(new Option('Absolute BTC', 'absolute'));
    this.wallSelect.setAttribute('aria-label', 'Wall threshold mode'); this.wallSelect.addEventListener('change', () => this.applySettings({ ...this.settings, wallMode: this.wallSelect.value === 'off' ? 'off' : this.wallSelect.value === 'absolute' ? 'absolute' : 'relative' }), { signal: this.abort.signal });
    this.wallThreshold.type = 'number'; this.wallThreshold.min = '.1'; this.wallThreshold.max = '1000'; this.wallThreshold.step = '.1';
    this.wallThreshold.setAttribute('aria-label', 'Wall threshold'); this.wallThreshold.addEventListener('change', () => this.applySettings({ ...this.settings, wallThreshold: Number(this.wallThreshold.value) }), { signal: this.abort.signal });
    const wallField = this.settingField('Highlight walls'); wallField.append(this.wallSelect, this.wallThreshold); this.settingsPane.append(wallField);

    this.scroll.className = 'depth-matrix-scroll'; this.scroll.setAttribute('aria-label', 'Depth matrix price levels');
    this.emptyState.className = 'depth-matrix-empty-state';
    this.emptyState.append(this.loading.element);
    this.loading.update({ kind: 'loading', title: 'Loading Depth Matrix…', detail: 'Waiting for synchronized depth data' });
    this.scroll.append(this.emptyState);
    this.grid.className = 'depth-matrix-grid'; this.scroll.append(this.grid);
    this.hoverLine.className = 'depth-matrix-hover-line'; this.hoverLine.hidden = true;
    this.grid.append(this.hoverLine);
    this.hoverTip.className = 'depth-matrix-tooltip market-hover-card'; this.hoverTip.hidden = true; this.hoverTip.setAttribute('role', 'tooltip');
    const legend = document.createElement('div'); legend.className = 'depth-matrix-legend';
    legend.innerHTML = '<span><i class="matrix-bid-key"></i>BID</span><span><i class="matrix-ask-key"></i>ASK</span><span>— UNKNOWN DEPTH · UNOBSERVED</span>';
    this.element.append(toolbar, this.settingsPane, this.scroll, this.hoverTip, legend);

    this.setSettingsButton.addEventListener('click', () => {
      this.settingsOpen = !this.settingsOpen; this.settingsPane.hidden = !this.settingsOpen;
      this.setSettingsButton.setAttribute('aria-expanded', String(this.settingsOpen));
    }, { signal: this.abort.signal });
    this.recenterButton.addEventListener('click', () => this.recenter(), { signal: this.abort.signal });
    retry.addEventListener('click', () => this.feed.retryDepthMatrix(), { signal: this.abort.signal });
    this.scroll.addEventListener('scroll', () => this.onScroll(), { signal: this.abort.signal, passive: true });
    window.addEventListener('resize', () => { this.markVisibleRows(); this.draw(); }, { signal: this.abort.signal });
  }

  private settingField(label: string) {
    const field = document.createElement('label'); field.className = 'matrix-setting';
    const span = document.createElement('span'); span.textContent = label; field.append(span); return field;
  }

  private syncSettingsControls() {
    this.referenceSelect.replaceChildren(new Option('Choose reference', ''));
    for (const source of this.settings.sources) if (DEPTH_MATRIX_SOURCE_REGISTRY[source]?.supported)
      this.referenceSelect.add(new Option(depthMatrixSourceLabel(source), source));
    this.referenceSelect.value = this.settings.referenceSourceId ?? '';
    this.bucketInput.value = this.settings.bucketWidth; this.columnSlider.value = String(this.settings.columnWidth);
    syncCurrencyControl(this.unitSelect, this.settings.unit); this.scaleSelect.value = this.settings.scale;
    this.wallSelect.value = this.settings.wallMode; this.wallThreshold.value = String(this.settings.wallThreshold);
    this.sourceSelect.disabled = this.settings.sources.length >= 8;
    const preset = this.settingsPane.querySelector<HTMLSelectElement>('[aria-label="Bucket width preset"]');
    if (preset) preset.value = BUCKET_PRESETS.includes(this.settings.bucketWidth) ? this.settings.bucketWidth : 'custom';
  }

  private renderSources() {
    this.sourceList.replaceChildren();
    for (const [index, source] of this.settings.sources.entries()) {
      const item = document.createElement('div'); item.className = 'depth-matrix-source-setting';
      const label = document.createElement('span'); label.textContent = depthMatrixSourceLabel(source);
      const definition = DEPTH_MATRIX_SOURCE_REGISTRY[source];
      if (!definition?.supported) { item.dataset.state = 'unavailable'; label.title = 'No synchronized live BTC source is configured'; }
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.title = 'Move column left'; up.disabled = index === 0;
      up.addEventListener('click', () => this.moveSource(index, -1), { signal: this.abort.signal });
      const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.title = 'Move column right'; down.disabled = index === this.settings.sources.length - 1;
      down.addEventListener('click', () => this.moveSource(index, 1), { signal: this.abort.signal });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove source'; remove.setAttribute('aria-label', `Remove ${label.textContent}`);
      remove.addEventListener('click', () => this.applySettings({ ...this.settings, sources: this.settings.sources.filter((_, at) => at !== index) }), { signal: this.abort.signal });
      item.append(label, up, down, remove); this.sourceList.append(item);
    }
    this.syncSettingsControls();
  }

  private moveSource(index: number, delta: number) {
    const sources = [...this.settings.sources], next = index + delta;
    if (next < 0 || next >= sources.length) return;
    [sources[index], sources[next]] = [sources[next]!, sources[index]!]; this.applySettings({ ...this.settings, sources });
  }

  private applySettings(value: DepthMatrixSettings) {
    const previous = this.settings, previousWidth = previous.bucketWidth;
    this.settings = depthMatrixSettings(value);
    for (const source of this.referencePrices.keys()) if (!this.settings.sources.includes(source)) this.referencePrices.delete(source);
    if (this.settings.bucketWidth !== previousWidth) { this.viewport = undefined; this.pendingViewport = undefined; this.pendingPageAccepted = false; this.centeringViewport = undefined; this.centerPending = true; }
    this.markAllRows();
    this.params.api.updateParameters(this.settings); this.save(); this.renderSources();
    // Local presentation controls must not restart connections or invalidate worker grids.
    if (previousWidth !== this.settings.bucketWidth || previous.sources.join(',') !== this.settings.sources.join(','))
      this.feed.updateDepthMatrixSettings(this.params.api.id, this.settings);
    this.draw();
  }

  private subscribe() {
    if (this.dead || !this.visible || this.release) return;
    this.release = this.feed.subscribeDepthMatrix(this.params.api.id, this.settings, event => {
      if (this.dead) return;
      // Old active-page batches may arrive while a replacement is loading. A
      // Center request supersedes them; a restored subscription must not reset
      // the grid to its default page.
      const requested = this.centeringViewport ?? this.pendingViewport ?? this.viewport;
      if (event.viewport && requested && !sameViewport(event.viewport, requested)
        && (this.centeringViewport || !this.viewport || !sameViewport(event.viewport, this.viewport))) return;
      if (!event.viewport && this.rows.length) {
        this.columns = this.columns.map(previous => {
          const current = event.columns.find(column => column.source === previous.source);
          if (current && current.state !== previous.state) this.markAllRows(previous.source);
          return current ? { ...previous, state: current.state, message: current.message,
            rows: current.state === 'live' ? previous.rows : previous.rows.map(row => ({ ...row,
              bidCoverage: current.state === 'stale' || current.state === 'disconnected' ? current.state : 'syncing',
              askCoverage: current.state === 'stale' || current.state === 'disconnected' ? current.state : 'syncing' })) } : previous;
        });
        this.draw(); return;
      }
      this.trackRowChanges(this.columns, event.columns);
      this.columns = event.columns;
      for (const column of this.columns) if (column.mid !== null && Number.isFinite(Number(column.mid)) && Number(column.mid) > 0)
        this.referencePrices.set(column.source, column.mid);
      this.updateScales(event.columns, event.emittedAt);
      if (event.viewport) {
        this.viewport = { low: event.viewport.low, high: event.viewport.high };
        if (this.centeringViewport && sameViewport(event.viewport, this.centeringViewport)) {
          this.centeringViewport = undefined;
          this.centerPending = true;
        }
        if (this.pendingViewport && sameViewport(event.viewport, this.pendingViewport)) {
          this.restoreAnchor = this.pendingViewport.anchor; this.pendingPageAccepted = true;
        }
      }
      this.draw();
    });
    const requested = this.centeringViewport ?? this.pendingViewport ?? this.viewport;
    if (requested) this.feed.updateDepthMatrixViewport(this.params.api.id, { low: requested.low, high: requested.high });
  }

  private unsubscribe() { this.release?.(); this.release = undefined; }

  private updateVisibility() {
    if (this.dead) return;
    const nextVisible = this.dockVisible && this.pageVisible;
    if (nextVisible === this.visible) return;
    this.visible = nextVisible;
    if (this.visible) { this.subscribe(); this.markVisibleRows(); this.draw(); }
    else {
      if (this.viewport && !this.pendingViewport && !this.centeringViewport)
        this.pendingViewport = { ...this.viewport, anchor: this.rowLayout.anchor(this.lastScrollTop) };
      this.unsubscribe(); clearTimeout(this.collapseTimer);
      if (this.renderFrame) { cancelAnimationFrame(this.renderFrame); this.renderFrame = 0; }
    }
  }

  private recenter() {
    const column = this.referenceColumn();
    if (!usableMatrixMid(column)) return;
    const reference = column!.mid!;
    const center = BigInt(matrixBucketIndex(reference, this.settings.bucketWidth) ?? '0');
    const first = center > BigInt(RANGE_ROWS / 2) ? center - BigInt(RANGE_ROWS / 2) : 0n;
    const last = first + BigInt(RANGE_ROWS);
    this.centeringViewport = { low: matrixBucketBounds(first, this.settings.bucketWidth)!.low, high: matrixBucketBounds(last, this.settings.bucketWidth)!.low };
    this.pendingViewport = undefined; this.pendingPageAccepted = false; this.restoreAnchor = undefined;
    this.centerPending = true;
    this.feed.updateDepthMatrixViewport(this.params.api.id, this.centeringViewport);
    this.draw();
  }

  private onScroll() {
    const current = this.scroll.scrollTop;
    if (current !== this.lastScrollTop || this.scroll.scrollLeft !== this.lastScrollLeft) {
      this.hoveredIndex = -1; this.hoverColumn = ''; this.hoverAnchor = undefined; this.hoverTip.hidden = true;
    }
    this.lastScrollLeft = this.scroll.scrollLeft;
    // Programmatic moves record their actual position immediately. Scroll events
    // can be coalesced with a later user move, so never discard the next event:
    // compare its position with that baseline instead.
    const direction = current < this.lastScrollTop ? 'up' : current > this.lastScrollTop ? 'down' : null;
    this.lastScrollTop = current;
    if (direction && !this.centeringViewport) this.centerPending = false;
    if (!this.visible) return;
    this.markVisibleRows();
    if (this.centeringViewport) { this.draw(); return; }
    const maxScroll = Math.max(0, this.scroll.scrollHeight - this.scroll.clientHeight);
    if (this.pendingViewport) {
      this.pendingViewport = { ...this.pendingViewport, anchor: this.rowLayout.anchor(current) };
      this.draw(); return;
    }
    if (!direction || !this.viewport) { this.draw(); return; }
    const guard = Math.min(this.rowLayout.height / 4, this.scroll.clientHeight);
    if (direction === 'up' && current <= guard) this.shiftViewport(1);
    else if (direction === 'down' && current >= maxScroll - guard) this.shiftViewport(-1);
    this.draw();
  }

  private shiftViewport(direction: 1 | -1) {
    if (!this.viewport) return;
    const first = BigInt(matrixBucketIndex(this.viewport.low, this.settings.bucketWidth) ?? '0');
    const last = BigInt(matrixBucketIndex(this.viewport.high, this.settings.bucketWidth) ?? '0');
    const shift = BigInt(RANGE_SHIFT * direction), low = first + shift < 0n ? 0n : first + shift;
    const high = low + (last - first);
    const viewport = { low: matrixBucketBounds(low, this.settings.bucketWidth)!.low, high: matrixBucketBounds(high, this.settings.bucketWidth)!.low };
    this.pendingViewport = { ...viewport, anchor: this.rowLayout.anchor(this.scroll.scrollTop) };
    this.feed.updateDepthMatrixViewport(this.params.api.id, viewport);
  }

  private markAllRows(source?: string) {
    for (const id of source ? [source] : this.settings.sources) this.dirtyRows.set(id, null);
  }

  private markVisibleRows() {
    if (!this.rows.length) { this.markAllRows(); return; }
    const [first, last] = this.rowLayout.visible(this.scroll.scrollTop - HEADER_HEIGHT, this.scroll.scrollTop + this.scroll.clientHeight - HEADER_HEIGHT);
    for (const source of this.settings.sources) {
      let dirty = this.dirtyRows.get(source);
      if (dirty === null) continue;
      if (!dirty) { dirty = new Set<string>(); this.dirtyRows.set(source, dirty); }
      for (let index = first; index < last; index++) {
        const row = this.rows[index]; if (row) dirty.add(row.index);
      }
    }
  }

  private trackRowChanges(previous: DepthMatrixColumn[], next: DepthMatrixColumn[]) {
    for (const column of next) {
      const old = previous.find(value => value.source === column.source);
      if (!old || old.state !== column.state || old.rows.length !== column.rows.length) {
        this.markAllRows(column.source); continue;
      }
      const oldRows = new Map(old.rows.map(row => [row.index, row]));
      let dirty = this.dirtyRows.get(column.source);
      if (old.mid !== column.mid && dirty !== null) {
        dirty ??= new Set<string>();
        for (const changed of [old, column]) {
          const bucket = matrixCurrentBucket(changed, this.settings.bucketWidth);
          if (bucket !== null) dirty.add(bucket);
        }
        this.dirtyRows.set(column.source, dirty);
      }
      for (const row of column.rows) {
        const before = oldRows.get(row.index);
        if (!before || !sameMatrixRow(before, row)) {
          if (this.settings.wallMode === 'relative') { this.markAllRows(column.source); break; }
          if (dirty !== null) { dirty ??= new Set<string>(); dirty.add(row.index); this.dirtyRows.set(column.source, dirty); }
        }
      }
    }
  }

  private updateScales(columns: DepthMatrixColumn[], emittedAt: number) {
    const at = Number.isFinite(emittedAt) && emittedAt > 0 ? emittedAt : Date.now();
    const elapsed = this.lastScaleUpdate ? Math.max(0, at - this.lastScaleUpdate) : 1000;
    let sharedTarget = 0, sharedChanged = false;
    const perSourceChanged = new Set<string>();
    for (const source of this.settings.sources) {
      const column = columns.find(value => value.source === source);
      const target = depthMatrixScaleTarget((column?.rows ?? []).flatMap(row => [row.bidQuantity, row.askQuantity]));
      sharedTarget = Math.max(sharedTarget, target);
      const previous = this.scales.get(source), next = smoothDepthMatrixScale(target, previous, elapsed);
      if (previous === undefined || Math.abs(next - previous) > Math.max(1e-9, Math.abs(previous) * 1e-6)) {
        this.scales.set(source, next); perSourceChanged.add(source);
      }
    }
    const priorShared = this.scales.get('__shared__'), nextShared = smoothDepthMatrixScale(sharedTarget, priorShared, elapsed);
    if (priorShared === undefined || Math.abs(nextShared - priorShared) > Math.max(1e-9, Math.abs(priorShared) * 1e-6)) {
      this.scales.set('__shared__', nextShared); sharedChanged = true;
    }
    if (this.settings.scale === 'shared' && sharedChanged) this.markAllRows();
    else if (this.settings.scale === 'per-source') for (const source of perSourceChanged) this.markAllRows(source);
    this.lastScaleUpdate = at;
  }

  private draw() {
    if (this.dead || !this.visible) return;
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      this.render();
    });
  }

  private render() {
    if (this.dead || !this.visible) return;
    const first = this.columns.find(column => column.rows.length > 0)?.rows ?? [];
    const displayRows = [...first].reverse();
    const nextLayout = this.expansion.layout(displayRows, this.columns.filter(column => this.settings.sources.includes(column.source)), Date.now());
    const geometryChanged = nextLayout.signature !== this.rowLayout.signature;
    const anchor = (this.pendingPageAccepted ? this.pendingViewport?.anchor : undefined) ?? this.restoreAnchor ?? this.rowLayout.anchor(this.scroll.scrollTop);
    this.restoreAnchor = undefined;
    this.rowLayout = nextLayout;
    clearTimeout(this.collapseTimer);
    if (this.expansion.nextExpiry !== undefined) this.collapseTimer = setTimeout(() => this.draw(), Math.max(1, this.expansion.nextExpiry - Date.now()));
    const signature = `${this.settings.columnWidth}|${this.settings.bucketWidth}|${this.settings.sources.join(',')}|${displayRows.map(row => row.index).join(',')}`;
    if (signature !== this.gridSignature) { this.buildGrid(displayRows, signature); this.markAllRows(); }
    this.rows = displayRows;
    if (geometryChanged) {
      this.axis?.querySelectorAll<HTMLElement>('.depth-matrix-price-row').forEach((element, index) => {
        element.style.setProperty('--depth-matrix-row-height', `${this.rowLayout.positions[index]!.height}px`);
      });
      for (const canvas of this.canvases.values()) canvas.style.height = `${Math.max(1, this.rowLayout.height)}px`;
      this.markAllRows();
    }
    if (anchor && !this.centerPending) {
      const top = this.rowLayout.offset(anchor);
      if (top !== undefined) { this.scroll.scrollTop = top; this.lastScrollTop = this.scroll.scrollTop; }
    }
    // Publish page completion only after DOM geometry and the bucket anchor agree.
    if (this.pendingPageAccepted) { this.pendingViewport = undefined; this.pendingPageAccepted = false; }
    if (geometryChanged && this.hoverAnchor && this.hoveredIndex >= 0) {
      const canvas = this.canvases.get(this.hoverColumn);
      if (canvas) {
        this.hoveredIndex = this.rowLayout.at((this.hoverAnchor.top + this.hoverAnchor.bottom) / 2 - canvas.getBoundingClientRect().top);
        if (this.hoveredIndex < 0) this.hoverTip.hidden = true;
      }
    }
    this.emptyState.hidden = this.rows.length > 0;
    const failed = this.columns.some(column => column.state === 'stale' || column.state === 'disconnected');
    this.loading.update(this.rows.length ? null : { kind: failed ? 'error' : 'loading', title: failed ? 'Depth data unavailable' : 'Loading Depth Matrix…',
      detail: this.columns.length ? this.columns.map(column => `${shortName[column.source] ?? column.source}: ${column.message}`).join(' · ') + ' · Use RETRY to reconnect.' : 'Waiting for synchronized depth data' });
    this.updateReference();
    this.updateHeaders();
    this.updatePriceAxis();
    this.refreshHoverTooltip();
    this.updateHoverLine();
    if (this.centerPending && !this.centeringViewport && this.rows.length) this.centerOnMid();
    this.drawCanvases();
  }

  private buildGrid(rows: MatrixRow[], signature: string) {
    const oldTop = this.scroll.scrollTop, oldLeft = this.scroll.scrollLeft;
    this.gridSignature = signature; this.canvases.clear();
    this.grid.dataset.compact = String(this.settings.columnWidth < 85);
    this.grid.style.gridTemplateColumns = `${AXIS_WIDTH}px repeat(${this.settings.sources.length}, ${this.settings.columnWidth}px)`;
    this.grid.replaceChildren();
    this.headers.clear(); this.canvases.clear(); this.hoveredIndex = -1; this.hoverTip.hidden = true;
    this.axisHead = document.createElement('div'); this.axisHead.className = 'depth-matrix-price-head'; this.axisHead.textContent = 'PRICE'; this.axisHead.title = 'Each row is labeled by its low edge; bucket range is [low, high) USDT';
    this.grid.append(this.axisHead);
    const columnsBySource = new Map(this.columns.map(column => [column.source, column]));
    for (const source of this.settings.sources) {
      const column = columnsBySource.get(source);
      const header = document.createElement('div'); header.className = 'depth-matrix-column-head'; header.title = column ? `${column.label}\n${column.message}` : depthMatrixSourceLabel(source);
      header.dataset.state = column?.state ?? 'syncing';
      const name = document.createElement('span'); name.textContent = shortName[source] ?? source;
      const state = document.createElement('small'); state.textContent = column ? columnStateLabel(column) : 'SYNCING';
      header.append(name, state); this.grid.append(header); this.headers.set(source, header);
    }
    this.axis = document.createElement('div'); this.axis.className = 'depth-matrix-price-axis'; this.axis.style.gridRow = '2';
    for (const [index, row] of rows.entries()) {
      const label = document.createElement('div'); label.className = 'depth-matrix-price-row'; label.dataset.rowIndex = String(index);
      label.style.setProperty('--depth-matrix-row-height', `${this.rowLayout.positions[index]!.height}px`);
      label.textContent = priceLabel(row.low); label.dataset.priceRange = `$${row.low} ≤ price < $${row.high}`; label.setAttribute('aria-label', label.dataset.priceRange);
      label.addEventListener('pointerenter', () => this.setHover(index, this.settings.referenceSourceId ?? this.settings.sources[0] ?? '', label.getBoundingClientRect()));
      label.addEventListener('pointerleave', () => this.clearHover());
      this.axis.append(label);
    }
    this.grid.append(this.axis);
    for (const source of this.settings.sources) {
      const canvas = document.createElement('canvas'); canvas.className = 'depth-matrix-book'; canvas.dataset.source = source;
      canvas.style.gridRow = '2'; canvas.style.width = `${this.settings.columnWidth}px`; canvas.style.height = `${Math.max(1, this.rowLayout.height)}px`;
      canvas.setAttribute('aria-label', `${depthMatrixSourceLabel(source)} depth histogram`);
      canvas.addEventListener('pointermove', event => {
        const rect = canvas.getBoundingClientRect(), index = this.rowLayout.at(event.clientY - rect.top);
        this.setHover(index, source, { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY });
      });
      canvas.addEventListener('pointerleave', () => this.clearHover());
      this.grid.append(canvas); this.canvases.set(source, canvas);
    }
    this.grid.append(this.hoverLine);
    this.scroll.scrollTop = oldTop; this.scroll.scrollLeft = oldLeft;
    this.lastScrollTop = this.scroll.scrollTop; this.lastScrollLeft = this.scroll.scrollLeft;
    this.updateHoverLine();
  }

  private updateHeaders() {
    for (const [source, header] of this.headers) {
      const column = this.columns.find(value => value.source === source);
      header.dataset.state = column?.state ?? 'syncing';
      header.title = column ? `${column.label}\n${column.message}${column.ageMs === null ? '' : `\nBook age ${ageLabel(column.ageMs)}`}` : depthMatrixSourceLabel(source);
      const state = header.querySelector('small');
      if (state) state.textContent = column ? columnStateLabel(column) : 'SYNCING';
    }
  }

  private referenceColumn() { return this.columns.find(column => column.source === this.settings.referenceSourceId); }

  private updateReference() {
    const source = this.settings.referenceSourceId, reference = this.referenceColumn();
    const currentMid = reference?.mid;
    const mid = currentMid != null && Number.isFinite(Number(currentMid)) && Number(currentMid) > 0 ? currentMid : source ? this.referencePrices.get(source) : undefined;
    const usable = usableMatrixMid(reference);
    this.recenterButton.disabled = !usable;
    const state = reference ? reference.state === 'live' ? usable ? columnStateLabel(reference) : 'UNAVAILABLE' : reference.state.toUpperCase() : 'UNAVAILABLE';
    const short = source === 'binance-spot' ? 'SPOT' : source === 'binance-perpetual' ? 'PERP' : source;
    const degraded = this.columns.filter(column => column.state !== 'live' && column.source !== source).map(column => `${shortName[column.source] ?? column.source} ${column.state.toUpperCase()}`).join(' · ');
    this.status.textContent = !source ? 'Choose reference'
      : `${short} MID ${mid === null || mid === undefined ? '—' : referencePriceLabel(mid)}${usable ? reference?.message.startsWith('Fixture:') ? ' · FIXTURE' : '' : ` · ${state}`}`;
    if (degraded) this.status.textContent += ` · ${degraded}`;
    this.status.dataset.state = usable ? 'live' : reference?.state === 'live' ? 'unavailable' : reference?.state ?? 'unavailable';
    const detail = !source ? 'Choose a reference midpoint source in SET.'
      : `${depthMatrixSourceLabel(source)} reference midpoint${mid == null ? ': unavailable' : ` $${exactReferencePriceLabel(mid)}; compact display rounded to $${referencePriceLabel(mid)}`}. ${state}. ${reference?.message ?? 'Source unavailable'}`;
    this.status.setAttribute('aria-label', detail);
    this.status.title = detail + '\n' + this.columns.map(column => `${column.label}: ${column.state}; ${column.message}; ${column.ageMs === null ? 'no book timestamp' : `book age ${ageLabel(column.ageMs)}`}; cursor ${column.cursor}`).join('\n');
    this.recenterButton.title = usable ? `Center on ${depthMatrixSourceLabel(source!)} midpoint $${exactReferencePriceLabel(mid!)}` : 'Reference midpoint requires usable live data';
  }

  private updatePriceAxis() {
    const reference = this.referenceColumn(), bucket = matrixCurrentBucket(reference, this.settings.bucketWidth);
    this.axis?.querySelectorAll<HTMLElement>('.depth-matrix-price-row').forEach((element, index) => {
      const row = this.rows[index]; if (!row) return;
      element.textContent = priceLabel(row.low);
      element.dataset.current = String(row.index === bucket);
      element.setAttribute('aria-label', `$${row.low} ≤ price < $${row.high}${row.index === bucket ? `; selected reference ${reference!.label} midpoint $${exactReferencePriceLabel(reference!.mid!)}` : ''}`);
    });
  }

  private centerOnMid() {
    const column = this.referenceColumn(), mid = column?.mid;
    if (!usableMatrixMid(column) || mid == null) return;
    const index = matrixBucketIndex(mid, this.settings.bucketWidth);
    const row = index === null ? -1 : this.rows.findIndex(value => value.index === index);
    if (row < 0) return;
    this.scroll.scrollTop = Math.max(0, Math.min(this.scroll.scrollHeight - this.scroll.clientHeight,
      HEADER_HEIGHT + this.rowLayout.positions[row]!.top + this.rowLayout.positions[row]!.height / 2 - this.scroll.clientHeight / 2));
    this.lastScrollTop = this.scroll.scrollTop; this.centerPending = false;
  }

  private updateHoverLine() {
    this.updateHoverAxis();
    if (this.hoveredIndex < 0 || this.hoveredIndex >= this.rows.length) { this.hoverLine.hidden = true; return; }
    this.hoverLine.hidden = false;
    this.hoverLine.style.top = `${HEADER_HEIGHT + this.rowLayout.positions[this.hoveredIndex]!.top}px`;
    this.hoverLine.style.height = `${this.rowLayout.positions[this.hoveredIndex]!.height}px`;
    this.hoverLine.dataset.source = this.hoverColumn;
  }

  private updateHoverAxis() {
    this.axis?.querySelectorAll<HTMLElement>('.depth-matrix-price-row').forEach((row, index) => row.dataset.hovered = String(index === this.hoveredIndex));
  }

  private drawCanvases() {
    if (!this.visible || !this.rows.length) return;
    const rootStyle = getComputedStyle(this.element), bidColor = rootStyle.getPropertyValue('--up').trim() || '#58a65c', askColor = rootStyle.getPropertyValue('--down').trim() || '#ad5858';
    const textColor = rootStyle.getPropertyValue('--text').trim() || '#c7c7c7', muted = rootStyle.getPropertyValue('--muted').trim() || '#858585', divider = rootStyle.getPropertyValue('--border-soft').trim() || '#1b1b1b';
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const displayValues = (row: MatrixRow) => effectiveCurrency(this.settings.unit) === 'btc' ? [row.bidQuantity, row.askQuantity] : [row.bidNotional, row.askNotional];
    const btcValues = (row: MatrixRow) => [row.bidQuantity, row.askQuantity];
    const [firstVisible, lastVisible] = this.rowLayout.visible(this.scroll.scrollTop - HEADER_HEIGHT, this.scroll.scrollTop + this.scroll.clientHeight - HEADER_HEIGHT);

    for (const source of this.settings.sources) {
      const canvas = this.canvases.get(source), column = this.columns.find(value => value.source === source);
      const pending = this.dirtyRows.get(source);
      if (!canvas || pending === undefined) continue;
      canvas.setAttribute('aria-label', `${column?.label ?? depthMatrixSourceLabel(source)} depth histogram; bar widths use BTC; cell labels use ${effectiveCurrency(this.settings.unit).toUpperCase()}`);
      const width = this.settings.columnWidth, height = Math.max(1, this.rowLayout.height);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
      const context = canvas.getContext('2d'); if (!context) continue;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace'; context.textBaseline = 'middle';
      if (!column || column.state === 'unavailable') {
        context.clearRect(0, 0, width, height);
        context.fillStyle = getComputedStyle(this.element).getPropertyValue('--muted').trim() || '#858585';
        context.save(); context.translate(width / 2, Math.min(height - 8, this.scroll.clientHeight / 2)); context.rotate(-Math.PI / 2);
        context.textAlign = 'center'; context.fillText('NO LIVE SOURCE CONFIGURED', 0, 0, Math.max(80, height - 12)); context.restore();
        this.dirtyRows.delete(source);
        continue;
      }
      const displayRows = [...column.rows].reverse(), scale = Math.max(1e-12, this.scales.get(this.settings.scale === 'shared' ? '__shared__' : source) ?? 0);
      const typical = median(displayRows.slice(firstVisible, lastVisible).flatMap(row => btcValues(row)).filter(value => value > 0));
      const inset = 4, availableWidth = Math.max(1, width - inset * 2);
      const drawLabel = (label: string, x: number, y: number, maxWidth: number, color: string) => {
        context.save();

        context.fillStyle = color; context.fillText(label, x, y, maxWidth);
        context.restore();
      };
      for (let index = firstVisible; index < Math.min(lastVisible, displayRows.length); index++) {
        const row = displayRows[index]!;
        if (pending !== null && !pending.has(row.index)) continue;
        const { top: y, height: rowHeight } = this.rowLayout.positions[index]!, [bidValue, askValue] = displayValues(row), [bidBtc, askBtc] = btcValues(row);
        const bidWidth = depthMatrixBarWidth(bidBtc, scale, availableWidth);
        const askWidth = depthMatrixBarWidth(askBtc, scale, availableWidth);
        context.clearRect(0, y, width, rowHeight);
        context.strokeStyle = divider; context.lineWidth = 1; context.beginPath(); context.moveTo(0, y + rowHeight - .5); context.lineTo(width, y + rowHeight - .5); context.stroke();
        const bidCoverage = row.bidCoverage, askCoverage = row.askCoverage;
        const hasBid = bidValue > 0, hasAsk = askValue > 0, mixed = hasBid && hasAsk;
        const paintSide = (side: 'bid' | 'ask', value: number, coverage: MatrixCoverage, bar: number, y0: number, bandHeight: number, showLabel = true, maxLabelWidth = availableWidth - 5) => {
          const color = side === 'bid' ? bidColor : askColor;
          const wall = matrixSideWall(side === 'bid' ? bidBtc : askBtc, typical, this.settings);
          if (bar > 0) {
            context.fillStyle = color; context.globalAlpha = wall ? .5 : .36;
            context.fillRect(side === 'bid' ? width - inset - bar : inset, y0 + 1, bar, Math.max(1, bandHeight - 2));
            context.globalAlpha = 1;
            if (wall) context.fillRect(side === 'bid' ? width - 2 : 0, y0 + 3, 1, Math.max(1, bandHeight - 6));
          }
          if (!showLabel) return;
          const label = value > 0 ? formatDepthMatrixCellValue(value, effectiveCurrency(this.settings.unit)) : coverage === 'known-empty' ? '0' : '?';
          context.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace';
          context.textAlign = side === 'bid' ? 'right' : 'left';
          drawLabel(label, side === 'bid' ? width - inset - 2 : inset + 2, y0 + bandHeight / 2, maxLabelWidth,
            value > 0 || coverageKnown(coverage) ? textColor : muted);
        };
        if (mixed) {
          const bandHeight = rowHeight / 2 - 1;
          paintSide('ask', askValue, askCoverage, askWidth, y + 1, bandHeight);
          paintSide('bid', bidValue, bidCoverage, bidWidth, y + rowHeight / 2, bandHeight);
        } else if (hasBid || hasAsk) {
          const side = hasBid ? 'bid' : 'ask', value = hasBid ? bidValue : askValue;
          paintSide(side, value, hasBid ? bidCoverage : askCoverage, hasBid ? bidWidth : askWidth, y + 1, rowHeight - 2);
        } else {
          const fullyKnownEmpty = coverageKnown(bidCoverage) && coverageKnown(askCoverage);
          const bandHeight = rowHeight / 2 - 1;
          paintSide('bid', 0, bidCoverage, 0, y + 1, bandHeight, false);
          paintSide('ask', 0, askCoverage, 0, y + rowHeight / 2, bandHeight, false);
          context.fillStyle = muted; context.textAlign = 'center';
          context.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace';
          context.fillText(fullyKnownEmpty ? '0' : '—', width / 2, y + rowHeight / 2, availableWidth - 5);
        }
        if (row.index === matrixCurrentBucket(column, this.settings.bucketWidth)) {
          context.fillStyle = rootStyle.getPropertyValue('--accent').trim();
          context.fillRect(width - 3, y + rowHeight / 2 - 3, 3, 6);
        }
        if (pending !== null) pending.delete(row.index);
      }
      if (pending === null || pending.size === 0) this.dirtyRows.delete(source);
    }
  }

  private setHover(index: number, source: string, point: { left: number; top: number; right: number; bottom: number }) {
    if (index < 0 || index >= this.rows.length) { this.clearHover(); return; }
    this.hoveredIndex = index; this.hoverColumn = source;
    this.updateHoverTooltip();
    this.hoverAnchor = point; positionMarketCard(this.hoverTip, this.element, point); this.draw();
  }

  private refreshHoverTooltip() { if (this.hoveredIndex >= 0) { this.updateHoverTooltip(); if (this.hoverAnchor) positionMarketCard(this.hoverTip, this.element, this.hoverAnchor); } }

  private updateHoverTooltip() {
    const axisRow = this.rows[this.hoveredIndex];
    if (!axisRow) return;
    const column = this.columns.find(value => value.source === this.hoverColumn);
    const row = column?.rows.find(value => value.index === axisRow.index);
    renderDepthMatrixCard(this.hoverTip, { low: axisRow.low, high: axisRow.high, units: effectiveCurrency(this.settings.unit), column, row,
      age: column?.ageMs == null ? 'no current book' : `age ${ageLabel(column.ageMs)}`,
      midpoint: column?.mid ?? (column ? this.referencePrices.get(column.source) : undefined),
      reference: column?.source === this.settings.referenceSourceId });
  }

  private clearHover() { this.hoveredIndex = -1; this.hoverColumn = ''; this.hoverAnchor = undefined; this.hoverTip.hidden = true; this.draw(); }

  diagnostics() { return { visible: this.visible, settings: this.settings, rows: this.rows.length, columns: this.columns.map(column => ({ source: column.source, state: column.state, ageMs: column.ageMs, cursor: column.cursor })), rowLayout: this.rowLayout.positions, referenceSourceId: this.settings.referenceSourceId, viewport: this.viewport, pendingViewport: this.pendingViewport, centeringViewport: this.centeringViewport, scrollTop: this.scroll.scrollTop }; }

  dispose() {
    clearTimeout(this.collapseTimer); if (this.dead) return; this.dead = true; if (this.renderFrame) cancelAnimationFrame(this.renderFrame); this.unsubscribe(); this.abort.abort(); this.listeners.forEach(listener => listener.dispose()); this.canvases.clear(); this.columns = []; }
}

function sameViewport(a: { low: string; high: string }, b: { low: string; high: string }) { return a.low === b.low && a.high === b.high; }
function columnStateLabel(column: DepthMatrixColumn) { return column.state === 'live' && column.message.startsWith('Fixture:') ? 'FIXTURE' : column.state === 'unavailable' ? 'UNAVAILABLE' : column.state.toUpperCase(); }
function coverageKnown(value: MatrixCoverage) { return value === 'observed' || value === 'known-empty'; }
function ageLabel(value: number) { return `${(Math.max(0, value) / 1000).toFixed(1)}s`; }
function priceLabel(low: string) { return matrixExactPrice(low); }
function referencePriceLabel(value: string) { const price = Number(value); return Number.isFinite(price) ? price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : value; }
function exactReferencePriceLabel(value: string) { return priceLabel(value); }
function median(values: number[]) { if (!values.length) return 0; values.sort((a, b) => a - b); const mid = Math.floor(values.length / 2); return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2; }
function sameMatrixRow(a: MatrixRow, b: MatrixRow) {
  return a.index === b.index && a.low === b.low && a.high === b.high
    && a.bidQuantity === b.bidQuantity && a.askQuantity === b.askQuantity
    && a.bidNotional === b.bidNotional && a.askNotional === b.askNotional
    && a.bidCoverage === b.bidCoverage && a.askCoverage === b.askCoverage;
}

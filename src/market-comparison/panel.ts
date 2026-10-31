import type { ComparisonHandle, CrosshairMoveEvent, SeriesApi, Chart as OpenAlgoChart, SeriesDataItem } from 'openalgo-charts';
import { comparisonController, createChart, epochMsToUtcSeconds } from 'openalgo-charts';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import type { Scheduler, Drawable } from '../chart/scheduler';
import type { FeedClient } from '../feed/client';
import type { Candle } from '../feed/protocol';
import {
  comparisonMarket, comparisonMarkets, comparisonStepMs, comparisonWindowMs,
  type ComparisonEvent, type ComparisonMarketId, type ComparisonStatus,
} from '../feed/comparison';
import { CHART_THEMES, currentTheme, THEME_EVENT } from '../theme';
import { getDisplayTimezone, TIMEZONE_EVENT } from '../timezone';
import {
  comparisonRequest, defaultMarketComparisonConfig, marketComparisonConfig,
  MARKET_COMPARISON_COLORS, setMarketComparisonColor, setMarketComparisonInterval,
  setMarketComparisonSymbols, setMarketComparisonVisibility,
  type MarketComparisonConfig,
} from './model';

const MIN_LABEL_GAP = 13;
const dataItems = (candles: readonly Candle[]): SeriesDataItem[] => candles.map(candle => ({
  time: epochMsToUtcSeconds(candle.t), open: candle.o, high: candle.h, low: candle.l, close: candle.c, volume: candle.v,
}));

interface SourceState {
  candles: Candle[];
  status: ComparisonStatus;
  lastEventAt: number;
}

/** Routes OpenAlgo's own canvas frames through the terminal's single visible-chart scheduler. */
class ScheduledComparisonChart implements Drawable {
  visible = false;
  readonly chart: OpenAlgoChart;
  readonly stats = { draws: 0, frameIntervalsMs: [] as number[], lastDrawAt: 0 };
  private callbacks = new Map<number, () => void>();
  private nextHandle = 0;
  private dead = false;
  get pendingFrames() { return this.callbacks.size; }

  constructor(container: HTMLElement, private scheduler: Scheduler, private afterDraw: () => void) {
    this.chart = createChart(container, {
      raf: {
        schedule: callback => { const handle = ++this.nextHandle; this.callbacks.set(handle, callback); this.scheduler.invalidate(this); return handle; },
        cancel: handle => { this.callbacks.delete(handle); if (!this.callbacks.size) this.scheduler.remove(this); },
      },
      renderer: 'canvas2d', theme: CHART_THEMES[currentTheme()], timezone: getDisplayTimezone(),
      branding: false, watermark: false, timeNavigator: false, shortcuts: false, doubleClick: 'none',
      priceAxisWidth: 82, timeAxisHeight: 20,
      grid: { vertLines: false, horzLines: false, spacing: 90, vertColor: CHART_THEMES[currentTheme()].grid, horzColor: CHART_THEMES[currentTheme()].grid, lineWidth: 1 },
      timeScale: { barSpacing: 7, minBarSpacing: 0.1, maxBarSpacing: 320, rightOffset: 4 },
      navigation: { panEnabled: true, zoomEnabled: true, mousePan: 'both', defaultVisibleBars: 120, defaultBarSpacing: 7 },
      zoomAnchor: 'cursor', animZoom: false, animAutoscale: false,
      priceFormatter: value => Number(value).toFixed(2),
      ariaLabel: 'Market Comparison. Lines show percent change from their common visible starting candle. Drag to pan; wheel to zoom.',
    });
  }

  draw() {
    if (this.dead || !this.visible || document.hidden) return;
    const now = performance.now();
    if (this.stats.lastDrawAt) {
      this.stats.frameIntervalsMs.push(now - this.stats.lastDrawAt);
      if (this.stats.frameIntervalsMs.length > 1000) this.stats.frameIntervalsMs.shift();
    }
    this.stats.lastDrawAt = now;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) { callback(); this.stats.draws++; }
    this.afterDraw();
  }

  invalidate() { if (!this.dead) this.scheduler.invalidate(this); }

  dispose() {
    if (this.dead) return;
    this.dead = true; this.callbacks.clear(); this.scheduler.remove(this); this.chart.destroy();
  }
}

/** Dockable native DOM workspace with one primary BTC line and managed comparison handles. */
export class MarketComparisonPanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private params!: IDockviewPanelProps;
  private config: MarketComparisonConfig = defaultMarketComparisonConfig();
  private sources = new Map<ComparisonMarketId, SourceState>();
  private handles = new Map<ComparisonMarketId, ComparisonHandle>();
  private currentPrimary: ComparisonMarketId | null = null;
  private chartHost?: ScheduledComparisonChart;
  private controller?: ReturnType<typeof comparisonController>;
  private primarySeries?: SeriesApi;
  private release?: () => void;
  private feedGeneration = 0;
  private disposed = false;
  private applyingViewport = false;
  private lastFollowTime = -Infinity;
  private initialViewSet = false;
  private pendingWindowHistory = false;
  private currentBaseline: number | null = null;
  private displayZone = getDisplayTimezone();
  private pageVisible = !document.hidden;
  private dockVisible = false;
  private listeners: { dispose(): void }[] = [];
  private abort = new AbortController();

  private toolbar = document.createElement('header');
  private marketsButton = document.createElement('button');
  private windowSelect = document.createElement('select');
  private intervalSelect = document.createElement('select');
  private followButton = document.createElement('button');
  private retryButton = document.createElement('button');
  private baselineLabel = document.createElement('span');
  private stage = document.createElement('div');
  private chartSurface = document.createElement('div');
  private labelLayer = document.createElement('div');
  private message = document.createElement('div');
  private readout = document.createElement('div');
  private legend = document.createElement('div');
  private status = document.createElement('footer');
  private marketDialog = document.createElement('dialog');
  private dialogList = document.createElement('div');
  private dialogStatus = document.createElement('p');
  private dialogApply = document.createElement('button');
  private draft = new Map<ComparisonMarketId, { selected: boolean; visible: boolean; color: string }>();

  constructor(private feed: FeedClient, private scheduler: Scheduler, private save: () => void,
    private onInstance: (id: string, panel: MarketComparisonPanel | null) => void = () => {}) {
    this.element.className = 'market-comparison-panel';
    this.toolbar.className = 'market-comparison-toolbar';
    this.marketsButton.type = 'button'; this.marketsButton.setAttribute('aria-label', 'Choose comparison markets');
    this.windowSelect.setAttribute('aria-label', 'Comparison window');
    for (const [value, label] of [['1h', '1H'], ['4h', '4H'], ['24h', '24H']]) this.windowSelect.add(new Option(label, value));
    this.intervalSelect.setAttribute('aria-label', 'Candle interval');
    for (const [value, label] of [['1m', '1M'], ['5m', '5M'], ['15m', '15M']]) this.intervalSelect.add(new Option(label, value));
    this.followButton.type = 'button'; this.followButton.className = 'market-comparison-follow';
    this.retryButton.type = 'button'; this.retryButton.textContent = 'RETRY'; this.retryButton.title = 'Retry direct Hyperliquid history and stream'; this.retryButton.hidden = true;
    this.baselineLabel.className = 'market-comparison-baseline'; this.baselineLabel.setAttribute('aria-live', 'polite');
    this.toolbar.append(this.marketsButton, this.windowSelect, this.intervalSelect, this.followButton, this.retryButton, this.baselineLabel);
    this.stage.className = 'market-comparison-stage';
    this.chartSurface.className = 'market-comparison-canvas-host';
    this.labelLayer.className = 'market-comparison-labels'; this.labelLayer.setAttribute('aria-hidden', 'true');
    this.message.className = 'market-comparison-message'; this.message.hidden = true; this.message.setAttribute('role', 'status');
    this.readout.className = 'market-comparison-readout'; this.readout.setAttribute('aria-live', 'polite');
    this.stage.append(this.chartSurface, this.labelLayer, this.message, this.readout);
    this.legend.className = 'market-comparison-legend'; this.legend.setAttribute('aria-label', 'Comparison line values');
    this.status.className = 'market-comparison-status'; this.status.setAttribute('role', 'status');
    this.element.append(this.toolbar, this.stage, this.legend, this.status);
    this.buildDialog();
    this.element.append(this.marketDialog);
    this.bindEvents();
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.onInstance(params.api.id, this);
    this.config = marketComparisonConfig(params.params);
    params.api.updateParameters(this.config);
    params.api.setTitle('Market Comparison');
    this.chartHost = new ScheduledComparisonChart(this.chartSurface, this.scheduler, () => this.renderRightLabels());
    this.primarySeries = this.chartHost.chart.addSeries('line', { style: { color: MARKET_COMPARISON_COLORS.BTC, precision: 2, priceLineVisible: false, lastValueVisible: false, title: 'BTC' } });
    this.controller = comparisonController(this.chartHost.chart, { mode: 'percentage', baseline: 'common' });
    this.controller.setBaseline('common');
    this.listeners.push(...[
      this.chartHost.chart.subscribeCrosshairMove(event => this.updateReadout(event)),
      this.chartHost.chart.on('pan', () => this.onViewportChange()),
      this.chartHost.chart.on('zoom', () => this.onViewportChange()),
      this.chartHost.chart.on('resize', () => {
        const source = this.currentPrimary ? this.sources.get(this.currentPrimary) : undefined;
        if (this.config.follow === 'live' && this.initialViewSet && !this.pendingWindowHistory && source?.status.historyPending !== true) this.followWindow(true);
        this.chartHost?.invalidate();
      }),
    ].map(dispose => ({ dispose })));
    this.listeners.push(params.api.onDidVisibilityChange(() => this.setDockVisible(params.api.isVisible)),
      params.api.onDidDimensionsChange(() => { this.chartHost?.invalidate(); }));
    this.setDockVisible(params.api.isVisible);
    this.syncControls();
    this.syncSubscription();
    this.refresh();
  }

  private bindEvents() {
    const options = { signal: this.abort.signal };
    this.marketsButton.addEventListener('click', () => this.openMarketDialog(), options);
    this.windowSelect.addEventListener('change', () => this.applyConfig({ ...this.config, window: this.windowSelect.value as MarketComparisonConfig['window'] }), options);
    this.intervalSelect.addEventListener('change', () => this.changeInterval(this.intervalSelect.value as MarketComparisonConfig['interval']), options);
    this.followButton.addEventListener('click', () => this.setFollow(this.config.follow !== 'live'), options);
    this.retryButton.addEventListener('click', () => this.feed.retryComparison(this.params.api.id), options);
    this.marketDialog.addEventListener('click', event => {
      if (event.target === this.marketDialog) this.marketDialog.close();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-comparison-action]');
      if (!button) return;
      if (button.dataset.comparisonAction === 'cancel') this.marketDialog.close();
      if (button.dataset.comparisonAction === 'apply') this.applyMarketDraft();
    }, options);
    this.marketDialog.addEventListener('change', event => this.onDialogChange(event), options);
    window.addEventListener(THEME_EVENT, () => {
      this.chartHost?.chart.applyOptions({ theme: CHART_THEMES[currentTheme()] });
      this.chartHost?.invalidate();
    }, options);
    window.addEventListener(TIMEZONE_EVENT, event => {
      const detail = (event as CustomEvent<{ zone?: string }>).detail;
      this.displayZone = detail?.zone ?? getDisplayTimezone();
      this.syncBaselineLabel(); this.updateReadout(); this.chartHost?.chart.setTimezone(this.displayZone); this.chartHost?.invalidate();
    }, options);
    document.addEventListener('visibilitychange', () => { this.pageVisible = !document.hidden; this.syncVisibleState(); }, options);
  }

  private buildDialog() {
    this.marketDialog.className = 'market-comparison-dialog'; this.marketDialog.setAttribute('aria-label', 'Select comparison markets');
    const header = document.createElement('header'), heading = document.createElement('h2'); heading.textContent = 'Markets'; header.append(heading);
    const help = document.createElement('p'); help.className = 'market-comparison-dialog-help';
    help.textContent = 'Hyperliquid perpetuals · xyz markets are HIP-3 macro proxies.';
    this.dialogList.className = 'market-comparison-dialog-list';
    this.dialogStatus.className = 'market-comparison-dialog-status'; this.dialogStatus.setAttribute('role', 'status');
    const footer = document.createElement('footer'), cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.dataset.comparisonAction = 'cancel';
    this.dialogApply.type = 'button'; this.dialogApply.textContent = 'Apply'; this.dialogApply.dataset.comparisonAction = 'apply'; this.dialogApply.className = 'primary';
    footer.append(cancel, this.dialogApply);
    this.marketDialog.append(header, help, this.dialogList, this.dialogStatus, footer);
  }

  private openMarketDialog() {
    this.draft.clear();
    for (const market of comparisonMarkets) {
      const saved = this.config.instruments.find(item => item.identity.symbol === market.id);
      this.draft.set(market.id, { selected: Boolean(saved), visible: saved?.visible ?? true, color: saved?.color ?? MARKET_COMPARISON_COLORS[market.id] });
    }
    this.dialogStatus.textContent = '';
    this.renderDialog(); this.marketDialog.showModal();
  }

  private renderDialog() {
    const fragment = document.createDocumentFragment();
    const visibleCount = [...this.draft.values()].filter(value => value.selected && value.visible).length;
    for (const market of comparisonMarkets) {
      const value = this.draft.get(market.id)!;
      const row = document.createElement('div'); row.className = 'market-comparison-choice';
      const selected = document.createElement('input'); selected.type = 'checkbox'; selected.dataset.marketSelected = market.id; selected.checked = value.selected;
      selected.setAttribute('aria-label', `Include ${market.label}`);
      const copy = document.createElement('span'); copy.className = 'market-comparison-choice-copy';
      const title = document.createElement('strong'); title.textContent = market.label; title.title = market.description;
      const detail = document.createElement('small'); detail.textContent = `${market.symbol} · Hyperliquid ${market.dex || 'perpetuals'}`;
      const current = this.sources.get(market.id)?.status;
      const state = document.createElement('small'); state.className = 'market-comparison-choice-state'; state.textContent = current?.state === 'unavailable' ? 'Unavailable' : current?.state === 'failed' ? 'History failed' : '';
      copy.append(title, detail); if (state.textContent) copy.append(state);
      const visible = document.createElement('input'); visible.type = 'checkbox'; visible.dataset.marketVisible = market.id;
      visible.checked = value.selected && value.visible;
      visible.disabled = !value.selected || (value.visible && visibleCount === 1);
      visible.setAttribute('aria-label', `Show ${market.label}`); visible.title = 'Show or hide this line';
      const color = document.createElement('input'); color.type = 'color'; color.value = value.color; color.dataset.marketColor = market.id; color.disabled = !value.selected;
      color.setAttribute('aria-label', `${market.label} line color`);
      row.append(selected, copy, visible, color); fragment.append(row);
    }
    this.dialogList.replaceChildren(fragment);
    const anyVisible = [...this.draft.values()].some(value => value.selected && value.visible);
    this.dialogApply.disabled = !anyVisible;
    if (!anyVisible && this.dialogStatus.textContent !== 'Keep at least one selected line visible.') this.dialogStatus.textContent = 'Keep at least one selected line visible.';
  }

  private onDialogChange(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const symbol = (input.dataset.marketSelected ?? input.dataset.marketVisible ?? input.dataset.marketColor) as ComparisonMarketId | undefined;
    if (!symbol) return;
    const draft = this.draft.get(symbol); if (!draft) return;
    if (input.dataset.marketSelected) draft.selected = input.checked;
    else if (input.dataset.marketVisible) draft.visible = input.checked;
    else draft.color = input.value;
    if (input.dataset.marketSelected) this.dialogStatus.textContent = '';
    this.renderDialog();
  }

  private applyMarketDraft() {
    const symbols = comparisonMarkets.filter(market => this.draft.get(market.id)?.selected).map(market => market.id);
    if (!symbols.length || !symbols.some(symbol => this.draft.get(symbol)?.visible)) {
      this.dialogStatus.textContent = 'Keep at least one selected line visible.'; return;
    }
    let next = setMarketComparisonSymbols(this.config, symbols);
    for (const symbol of symbols) {
      next = setMarketComparisonVisibility(next, symbol, this.draft.get(symbol)!.visible);
      next = setMarketComparisonColor(next, symbol, this.draft.get(symbol)!.color);
    }
    this.marketDialog.close();
    this.applyConfig(next);
  }

  private changeInterval(interval: MarketComparisonConfig['interval']) {
    if (interval === this.config.interval) return;
    this.sources.clear(); this.initialViewSet = false; this.lastFollowTime = -Infinity; this.currentBaseline = null;
    this.applyConfig(setMarketComparisonInterval(this.config, interval), true);
  }

  private applyConfig(value: MarketComparisonConfig, forceFeed = false) {
    const previousWindow = this.config.window;
    const previousRequest = JSON.stringify(comparisonRequest(this.config));
    const next = marketComparisonConfig(value);
    this.config = next;
    const resetLiveWindow = next.follow === 'live' && (forceFeed || next.window !== previousWindow);
    if (resetLiveWindow) {
      this.initialViewSet = false; this.lastFollowTime = -Infinity;
      this.pendingWindowHistory = next.window !== previousWindow;
    }
    this.params.api.updateParameters(next); this.save(); this.syncControls();
    if (forceFeed || previousRequest !== JSON.stringify(comparisonRequest(next))) this.syncSubscription();
    this.syncChartData(); this.refresh();
  }

  private syncControls() {
    this.windowSelect.value = this.config.window; this.intervalSelect.value = this.config.interval;
    const selected = this.config.instruments.length;
    this.marketsButton.textContent = `Markets · ${selected}`;
    this.marketsButton.title = this.config.instruments.map(item => comparisonMarket(item.identity.symbol)?.symbol).join(' · ');
    const live = this.config.follow === 'live';
    this.followButton.textContent = live ? 'LIVE' : 'PAUSED';
    this.followButton.setAttribute('aria-pressed', String(live));
    this.followButton.title = live ? 'Following the newest shared candle · click to pause' : 'Viewport is paused · click to return to the live window';
    this.followButton.dataset.state = live ? 'live' : 'paused';
  }

  private syncSubscription() {
    this.release?.(); this.release = undefined;
    const generation = ++this.feedGeneration;
    const request = comparisonRequest(this.config);
    this.release = this.feed.subscribeComparison(this.params.api.id, request, event => {
      if (this.disposed || generation !== this.feedGeneration) return;
      this.onFeedEvent(event);
    });
  }

  private onFeedEvent(event: ComparisonEvent) {
    const symbol = event.identity.symbol;
    const instrument = this.config.instruments.find(item => item.identity.symbol === symbol);
    if (!instrument || event.identity.interval !== this.config.interval) return;
    if (this.pendingWindowHistory && event.type === 'comparison-snapshot' && event.status.historyPending !== true) this.pendingWindowHistory = false;
    let source = this.sources.get(symbol);
    if (!source) {
      source = { candles: [], status: event.status, lastEventAt: Date.now() };
      this.sources.set(symbol, source);
    }
    source.status = event.status; source.lastEventAt = Date.now();
    if (event.type === 'comparison-snapshot') source.candles = event.candles.slice(-5000);
    else if (event.type === 'comparison-patch') {
      const byTime = new Map(source.candles.map(candle => [candle.t, candle]));
      for (const candle of event.candles) byTime.set(candle.t, candle);
      source.candles = [...byTime.values()].sort((a, b) => a.t - b.t).slice(-5000);
    }
    this.syncChartData(); this.refresh(); this.chartHost?.invalidate();
  }

  private usableVisible() {
    return comparisonMarkets.map(market => {
      const configured = this.config.instruments.find(item => item.identity.symbol === market.id);
      const source = this.sources.get(market.id);
      if (!configured?.visible || !source?.candles.length || source.status.state === 'unavailable' || source.status.state === 'failed') return null;
      return { market, configured, source };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }

  private syncChartData() {
    if (!this.chartHost || !this.controller || !this.primarySeries) return;
    const usable = this.usableVisible();
    const nextPrimary = usable[0]?.market.id ?? null;
    const viewport = this.captureViewport();
    if (nextPrimary !== this.currentPrimary) {
      this.controller.clear(); this.handles.clear();
      this.currentPrimary = nextPrimary;
      if (nextPrimary) {
        const first = usable[0]!;
        this.primarySeries.applyOptions({ color: first.configured.color, title: first.market.shortLabel, visible: true });
        this.primarySeries.setData(dataItems(first.source.candles));
      } else this.primarySeries.setData([]);
    } else if (nextPrimary) {
      const primary = usable[0]!;
      this.primarySeries.applyOptions({ color: primary.configured.color, title: primary.market.shortLabel, visible: true });
      this.primarySeries.setData(dataItems(primary.source.candles));
    }
    const targetSymbols = new Set(usable.slice(1).map(item => item.market.id));
    for (const [symbol, handle] of [...this.handles]) if (!targetSymbols.has(symbol)) {
      this.controller.remove(handle); this.handles.delete(symbol);
    }
    for (const item of usable.slice(1)) {
      const bars = dataItems(item.source.candles);
      const handle = this.handles.get(item.market.id);
      if (handle) handle.setBars(bars);
      else this.handles.set(item.market.id, this.controller.add({ symbol: item.market.shortLabel, bars, color: item.configured.color,
        style: { color: item.configured.color, precision: 2, priceLineVisible: false, lastValueVisible: false, title: item.market.shortLabel } }));
    }
    this.controller.setBaseline('common');
    if (this.config.follow === 'live' && nextPrimary) {
      const latest = usable[0]!.source.candles.at(-1)?.t ?? -Infinity;
      if (!this.pendingWindowHistory && usable[0]!.source.status.historyPending !== true
        && (!this.initialViewSet || latest > this.lastFollowTime)) this.followWindow(!this.initialViewSet);
      this.lastFollowTime = latest;
    } else if (viewport) this.restoreViewport(viewport);
    if (this.handles.size === 0 && nextPrimary) this.applySingleSeriesPercentScale(usable[0]!.source.candles);
    this.refreshBaseline();
    this.refreshLineReadout();
  }

  private applySingleSeriesPercentScale(candles: readonly Candle[]) {
    const chart = this.chartHost?.chart;
    const pane = chart?.panes()[chart.primaryPaneIndex()];
    if (!chart || !pane) return;
    pane.priceScale.setOptions({ mode: 'percentage' });
    const baseline = this.singleBaselineCandle(candles);
    pane.priceScale.setBaseline(baseline?.c ?? null);
  }

  private singleBaselineCandle(candles: readonly Candle[] = this.currentPrimary ? this.sources.get(this.currentPrimary)?.candles ?? [] : []) {
    const chart = this.chartHost?.chart;
    const range = chart?.getVisibleLogicalRange();
    if (!chart || !candles.length) return undefined;
    const time = range ? chart.dataLayer.indexToTimeFloat(range.from) : epochMsToUtcSeconds(candles[0]!.t);
    return candles.find(candle => epochMsToUtcSeconds(candle.t) >= time) ?? candles[0];
  }

  private captureViewport() {
    const chart = this.chartHost?.chart;
    const range = chart?.getVisibleLogicalRange();
    if (!chart || !range || !chart.dataLayer.length) return null;
    const from = chart.dataLayer.indexToTimeFloat(range.from), to = chart.dataLayer.indexToTimeFloat(range.to);
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
  }

  private restoreViewport(viewport: { from: number; to: number }) {
    const chart = this.chartHost?.chart;
    if (!chart || !chart.dataLayer.length) return;
    const from = chart.dataLayer.timeToIndexFloat(viewport.from), to = chart.dataLayer.timeToIndexFloat(viewport.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    this.applyingViewport = true; chart.setVisibleLogicalRange({ from, to }); this.applyingViewport = false;
  }

  private followWindow(reset = false) {
    const chart = this.chartHost?.chart;
    if (!chart || !this.primarySeries) return;
    const bars = this.primarySeries.getData();
    if (!bars.length) return;
    const intervalMs = comparisonStepMs[this.config.interval];
    const count = Math.max(1, Math.ceil(comparisonWindowMs[this.config.window] / intervalMs));
    const last = bars.length - 1;
    const current = chart.getVisibleLogicalRange();
    if (!reset && current && current.to >= last && current.to - current.from >= count * .75) return;
    this.applyingViewport = true;
    chart.setVisibleLogicalRange({ from: Math.max(0, last - count + 1), to: last + 3 });
    this.applyingViewport = false;
    this.initialViewSet = true;
    this.refreshBaseline();
  }

  private setFollow(live: boolean) {
    if (this.config.follow === (live ? 'live' : 'paused')) return;
    this.config = { ...this.config, follow: live ? 'live' : 'paused' };
    this.params.api.updateParameters(this.config); this.save(); this.syncControls();
    if (live) this.followWindow(true);
  }

  private setDockVisible(visible: boolean) {
    this.dockVisible = visible;
    this.syncVisibleState();
  }

  private syncVisibleState() {
    const visible = this.dockVisible && this.pageVisible && !this.disposed;
    if (this.chartHost) this.chartHost.visible = visible;
    if (visible) { this.chartHost?.invalidate(); this.refresh(); }
    else this.readout.textContent = '';
  }

  private refresh() {
    this.renderLegend(); this.renderStatus(); this.syncBaselineLabel(); this.updateMessage();
    this.chartHost?.invalidate();
  }

  private renderLegend() {
    const fragment = document.createDocumentFragment();
    for (const item of this.config.instruments) {
      const market = comparisonMarket(item.identity.symbol)!;
      const source = this.sources.get(market.id);
      const row = document.createElement('span'); row.className = 'market-comparison-legend-item';
      row.dataset.visible = String(item.visible); row.dataset.state = source?.status.state ?? 'loading';
      const swatch = document.createElement('i'); swatch.style.backgroundColor = item.color; swatch.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong'); name.textContent = market.shortLabel;
      const value = document.createElement('span'); value.textContent = this.latestPercent(item.identity.symbol);
      row.title = `${market.symbol} · Hyperliquid perpetual · native candle close`;
      row.append(swatch, name, value); fragment.append(row);
    }
    this.legend.replaceChildren(fragment);
  }

  private renderStatus() {
    const active = this.config.instruments.filter(item => item.visible);
    const issues = active.map(item => {
      const state = this.sources.get(item.identity.symbol)?.status;
      if (!state || state.state === 'live') return null;
      const market = comparisonMarket(item.identity.symbol)!;
      return `${market.shortLabel}: ${state.message}`;
    }).filter((value): value is string => value !== null);
    const activeStatus = active.map(item => this.sources.get(item.identity.symbol)?.status).filter((value): value is ComparisonStatus => Boolean(value));
    const connected = activeStatus.filter(item => item.connection === 'connected').length;
    const bars = activeStatus.reduce((sum, item) => sum + item.retainedBars, 0);
    const quiet = activeStatus.map(item => item.quietMs).filter((value): value is number => value !== null).sort((a, b) => b - a)[0];
    const quietText = quiet === undefined ? 'waiting for first candle update' : `quiet ${Math.floor(quiet / 1000)}s`;
    this.status.textContent = `${connected}/${active.length} connected · ${bars.toLocaleString()} candles retained · ${quietText}${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
    this.status.title = this.status.textContent;
    const failed = activeStatus.some(item => item.state === 'failed' || item.state === 'unavailable');
    this.retryButton.hidden = !failed;
  }

  private updateMessage() {
    const visible = this.config.instruments.filter(item => item.visible);
    const requested = visible.map(item => this.sources.get(item.identity.symbol));
    const allSettled = requested.length > 0 && requested.every(source => source && source.status.state !== 'loading');
    const hasBars = requested.some(source => Boolean(source?.candles.length));
    const common = this.currentBaselineTime();
    if (this.handles.size > 0 && common === null && allSettled && hasBars) {
      const unavailable = requested.some(source => source?.status.state === 'unavailable');
      const failed = requested.some(source => source?.status.state === 'failed');
      this.message.textContent = unavailable ? 'No common history · a market is unavailable' : failed ? 'No common history · retry failed markets' : 'No overlapping history';
      this.message.hidden = false; this.stage.dataset.state = 'no-overlap'; return;
    }
    if (!hasBars) {
      const unavailable = requested.some(source => source?.status.state === 'unavailable');
      const failed = requested.some(source => source?.status.state === 'failed');
      this.message.textContent = unavailable ? 'A selected market is unavailable on Hyperliquid' : failed ? 'History unavailable · use Retry' : 'Loading Hyperliquid candles…';
      this.message.hidden = false; this.stage.dataset.state = failed || unavailable ? 'failed' : 'loading'; return;
    }
    this.message.hidden = true; this.stage.dataset.state = 'ready';
  }

  private syncBaselineLabel() {
    const time = this.currentBaselineTime();
    this.currentBaseline = time;
    if (time === null) { this.baselineLabel.textContent = 'Baseline · —'; this.baselineLabel.title = 'Waiting for one UTC candle timestamp shared by every visible line'; return; }
    const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: this.displayZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time * 1000);
    const zone = this.displayZone === 'UTC' ? 'UTC' : new Intl.DateTimeFormat('en-GB', { timeZone: this.displayZone, timeZoneName: 'short' })
      .formatToParts(time * 1000).find(part => part.type === 'timeZoneName')?.value ?? this.displayZone;
    this.baselineLabel.textContent = `T0 ${formatted} · ${zone}`;
    this.baselineLabel.title = `Common candle-open baseline · ${new Date(time * 1000).toISOString()} · display ${this.displayZone}`;
  }

  private latestPercent(symbol: ComparisonMarketId) {
    const percent = this.percentAtLatest(symbol);
    if (percent === null) return '—';
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  }

  private percentAtLatest(symbol: ComparisonMarketId) {
    const source = this.sources.get(symbol), baseline = this.baselineClose(symbol);
    const latest = source?.candles.at(-1)?.c;
    return latest !== undefined && baseline && baseline > 0 ? (latest / baseline - 1) * 100 : null;
  }

  private baselineClose(symbol: ComparisonMarketId) {
    if (this.currentBaseline === null) return null;
    const handle = this.handles.get(symbol);
    if (handle) return handle.barAt(this.currentBaseline)?.close ?? null;
    const time = this.currentBaseline * 1000;
    return this.sources.get(symbol)?.candles.find(candle => candle.t === time)?.c ?? null;
  }

  private renderRightLabels() {
    const chart = this.chartHost?.chart;
    if (!chart || !this.chartHost?.visible) return;
    const primary = this.currentPrimary;
    if (!primary) { this.labelLayer.replaceChildren(); return; }
    const baselineTime = this.currentBaselineTime();
    if (baselineTime === null) { this.labelLayer.replaceChildren(); return; }
    this.currentBaseline = baselineTime;
    const paneIndex = chart.primaryPaneIndex();
    const plot = chart.plotRect(paneIndex);
    if (!plot) { this.labelLayer.replaceChildren(); return; }
    const primaryBase = this.baselineClose(primary);
    if (!primaryBase || primaryBase <= 0) { this.labelLayer.replaceChildren(); return; }
    const candidates = this.config.instruments.filter(item => item.visible).map(item => {
      const source = this.sources.get(item.identity.symbol);
      const baseline = this.baselineClose(item.identity.symbol);
      const latest = source?.candles.at(-1)?.c;
      if (!source?.candles.length || source.status.state === 'failed' || source.status.state === 'unavailable'
        || !baseline || baseline <= 0 || latest === undefined) return null;
      const percent = (latest / baseline - 1) * 100;
      const syntheticPrimaryPrice = primaryBase * (1 + percent / 100);
      const y = chart.priceToCoordinate(syntheticPrimaryPrice, paneIndex);
      return y === null || !Number.isFinite(y) ? null : { symbol: item.identity.symbol, color: item.color, label: comparisonMarket(item.identity.symbol)!.shortLabel, percent, y };
    }).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => a.y - b.y);
    if (!candidates.length) { this.labelLayer.replaceChildren(); return; }
    const height = Math.max(1, plot.height), labelHeight = 13;
    const gap = Math.min(MIN_LABEL_GAP, Math.max(labelHeight, (height - labelHeight) / Math.max(1, candidates.length - 1)));
    let previous = plot.top - gap;
    for (const candidate of candidates) {
      candidate.y = Math.max(plot.top + labelHeight / 2, Math.min(plot.top + height - labelHeight / 2, candidate.y));
      candidate.y = Math.max(candidate.y, previous + gap);
      previous = candidate.y;
    }
    if (candidates.at(-1)!.y > plot.top + height - labelHeight / 2) {
      const shift = candidates.at(-1)!.y - (plot.top + height - labelHeight / 2);
      for (const candidate of candidates) candidate.y -= shift;
    }
    const fragment = document.createDocumentFragment();
    for (const candidate of candidates) {
      const label = document.createElement('span'); label.className = 'market-comparison-right-label';
      label.style.color = candidate.color; label.style.top = `${candidate.y - labelHeight / 2}px`;
      label.style.left = `${Math.max(plot.left, plot.left + plot.width - 99)}px`;
      label.style.width = '98px'; label.title = `${candidate.label} · ${candidate.percent >= 0 ? '+' : ''}${candidate.percent.toFixed(2)}% from ${new Date(baselineTime * 1000).toISOString()}`;
      label.textContent = `${candidate.label} ${candidate.percent >= 0 ? '+' : ''}${candidate.percent.toFixed(2)}%`;
      fragment.append(label);
    }
    this.labelLayer.replaceChildren(fragment);
  }

  private singleBaselineTime() {
    const baseline = this.singleBaselineCandle();
    return baseline ? epochMsToUtcSeconds(baseline.t) : null;
  }

  private currentBaselineTime() {
    if (!this.currentPrimary) return null;
    return this.handles.size > 0 ? this.controller?.baselineTime() ?? null : this.singleBaselineTime();
  }

  private refreshBaseline() {
    this.currentBaseline = this.currentBaselineTime();
    this.syncBaselineLabel();
    this.renderLegend();
    this.updateMessage();
    this.chartHost?.invalidate();
  }

  private refreshLineReadout() {
    this.renderLegend(); this.syncBaselineLabel(); this.updateMessage();
  }

  private updateReadout(event?: CrosshairMoveEvent) {
    if (!event?.time || !this.chartHost?.visible) { this.readout.textContent = ''; return; }
    const time = event.time;
    const values = this.config.instruments.filter(item => item.visible).map(item => {
      const handle = this.handles.get(item.identity.symbol);
      const bar = item.identity.symbol === this.currentPrimary ? (event.bar?.time === time ? event.bar : null) : handle?.barAt(time);
      const close = bar?.close ?? null;
      const baseline = this.baselineClose(item.identity.symbol);
      const pct = close !== null && baseline ? (close / baseline - 1) * 100 : null;
      return `${comparisonMarket(item.identity.symbol)!.shortLabel} ${close === null ? '—' : close.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}`;
    });
    const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: this.displayZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(time * 1000);
    this.readout.textContent = `${stamp} · ${values.join(' · ')}`;
    this.readout.title = `${new Date(time * 1000).toISOString()} · native candle close and change from common baseline`;
  }

  private onViewportGesture() {
    if (this.applyingViewport || this.config.follow !== 'live') return;
    this.config = { ...this.config, follow: 'paused' };
    this.params.api.updateParameters(this.config); this.save(); this.syncControls();
  }

  private onViewportChange() {
    if (this.applyingViewport) return;
    if (this.handles.size === 0 && this.currentPrimary) this.applySingleSeriesPercentScale(this.sources.get(this.currentPrimary)?.candles ?? []);
    this.onViewportGesture();
    this.refreshBaseline();
  }

  diagnostics() {
    const chart = this.chartHost?.chart;
    const plot = chart ? chart.plotRect(chart.primaryPaneIndex()) : null;
    return { settings: this.config, visible: Boolean(this.chartHost?.visible), primary: this.currentPrimary,
      sources: [...this.sources].map(([symbol, source]) => ({ symbol, bars: source.candles.length, state: source.status.state, connection: source.status.connection })),
      handles: this.handles.size, baselineTime: this.currentBaselineTime(),
      drawStats: this.chartHost?.stats.draws ?? 0, pendingChartFrames: this.chartHost?.pendingFrames ?? 0,
      drawIntervalsMs: this.chartHost?.stats.frameIntervalsMs.slice() ?? [],
      labels: this.labelLayer.childElementCount, viewport: chart?.getVisibleLogicalRange() ?? null,
      plot, baselinePrice: this.currentPrimary ? this.baselineClose(this.currentPrimary) : null };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.feedGeneration++; this.release?.(); this.release = undefined;
    if (this.marketDialog.open) this.marketDialog.close();
    this.abort.abort(); this.listeners.forEach(listener => listener.dispose());
    this.controller?.destroy(); this.handles.clear(); this.chartHost?.dispose(); this.chartHost = undefined;
    this.sources.clear(); this.labelLayer.replaceChildren(); this.readout.textContent = '';
    this.onInstance(this.params?.api.id ?? '', null);
  }
}

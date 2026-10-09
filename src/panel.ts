import type { Bar, CrosshairMoveEvent } from 'openalgo-charts';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { FeedClient } from './feed/client';
import { instruments, intervals, type Series, type Status, validSeries } from './feed/protocol';
import { OpenAlgoCandleChart } from './chart/openalgo';
import type { Scheduler } from './chart/scheduler';

export interface PanelConfig extends Series { type: 'candle' }
export function config(value: unknown): PanelConfig {
  return validSeries(value) ? { ...value, type: 'candle' } : { type: 'candle', venue: 'binance', interval: '1m' };
}

export class CandlePanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private chart = document.createElement('div');
  private toolbar = document.createElement('div');
  private readout = document.createElement('div');
  private statusNode = document.createElement('div');
  private instrument = document.createElement('select');
  private interval = document.createElement('select');
  private metadata = document.createElement('span');
  private retry = document.createElement('button');
  private latest = document.createElement('button');
  private engine?: OpenAlgoCandleChart;
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

  constructor(
    private feed: FeedClient,
    private scheduler: Scheduler,
    private save: () => void,
    private register: (id: string, panel: CandlePanel | null) => void,
  ) {
    this.element.className = 'candle-panel';
    this.toolbar.className = 'chart-toolbar';
    this.chart.className = 'chart-stage';
    this.chart.tabIndex = 0;
    this.chart.setAttribute('aria-label', 'BTC perpetual candlestick chart');
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
    this.retry.textContent = 'Retry';
    this.retry.setAttribute('aria-label', 'Retry market data');
    this.toolbar.append(this.instrument, this.interval, this.latest, this.metadata);
    this.element.append(this.toolbar, this.chart);
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    this.element.dataset.panelId = params.api.id;
    this.selection = config(params.params);
    this.instrument.value = this.selection.venue;
    this.interval.value = this.selection.interval;
    const options = { signal: this.abort.signal };
    this.instrument.addEventListener('change', () => this.select(), options);
    this.interval.addEventListener('change', () => this.select(), options);
    this.latest.addEventListener('click', () => this.engine?.resetView(), options);
    this.retry.addEventListener('click', () => this.feed.retry(params.api.id), options);
    this.chart.addEventListener('dblclick', () => this.engine?.resetView(), options);
    this.chart.addEventListener('keydown', event => this.keydown(event), options);
    this.engine = new OpenAlgoCandleChart(this.chart, this.scheduler, 'canvas2d');
    const unsubscribeCrosshair = this.engine.chart.subscribeCrosshairMove(event => this.crosshair(event));
    this.subscriptions.push({ dispose: unsubscribeCrosshair });
    this.chart.append(this.readout, this.statusNode);
    this.subscriptions.push(params.api.onDidVisibilityChange(() => this.visibility()));
    this.register(params.api.id, this);
    this.subscribe();
    queueMicrotask(() => {
      if (!this.dead) this.params.api.setTitle(`${this.selection.venue === 'binance' ? 'Binance · BTCUSDT' : 'Hyperliquid · BTC'} · ${this.selection.interval}`);
    });
    this.visibility();
    this.timer = setInterval(() => {
      if (this.visible && !document.hidden) {
        this.updateStatus();
        if (!this.hoveredBar) this.updateReadout(this.engine?.latestCandle() ?? null);
      }
    }, 1000);
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
    this.selection = config({ venue: this.instrument.value, interval: this.interval.value });
    this.params.api.updateParameters(this.selection);
    this.resetViewOnSnapshot = true;
    this.engine?.setSnapshot([], false);
    this.hoveredBar = null;
    this.updateReadout(null);
    this.subscribe();
    this.save();
  }

  private subscribe() {
    this.release?.();
    const epoch = ++this.selectionEpoch;
    const selection = this.selection;
    this.params.api.setTitle(`${selection.venue === 'binance' ? 'Binance · BTCUSDT' : 'Hyperliquid · BTC'} · ${selection.interval}`);
    const info = instruments[selection.venue];
    this.metadata.textContent = `${info.quote} · UTC`;
    this.instrument.title = `${info.kind}; price ${info.quote}; settlement/collateral ${info.collateral}`;
    this.status = { state: 'loading', message: 'Loading native candles…', lastUpdate: 0 };
    this.updateStatus();
    this.release = this.feed.subscribe(this.params.api.id, selection, event => {
      if (this.dead || epoch !== this.selectionEpoch) return;
      if (event.type === 'status') {
        this.status = event.status;
        this.updateStatus();
      } else if (event.type === 'snapshot') {
        this.engine?.setSnapshot(event.candles, !this.resetViewOnSnapshot);
        if (this.resetViewOnSnapshot) this.engine?.resetView();
        this.resetViewOnSnapshot = false;
        this.hoveredBar = null;
        if (this.visible) this.updateReadout(this.engine?.latestCandle() ?? null);
      } else if (event.type === 'patch') {
        this.engine?.applyPatch(event.candles);
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
    };
  }

  dispose() {
    this.dead = true;
    this.selectionEpoch++;
    clearInterval(this.timer);
    this.abort.abort();
    this.release?.();
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.engine?.dispose();
    this.register(this.params.api.id, null);
  }
}

export const panelRegistry = { candle: CandlePanel } as const;

import { AxisGrid } from './axis-grid';
import { OrderBookHeatmap } from './orderbook-heatmap';
import type { HeatmapSettings, LiquidityBucket } from '../feed/heatmap-model';
import {
  createChart,
  epochMsToUtcSeconds,
  InvalidationLevel,
  type Bar,
  type Chart as OpenAlgoChart,
  type RendererChoice,
  type SeriesApi,
  type IPrimitive,
} from 'openalgo-charts';
import { DEFAULT_FOOTPRINT_OPTIONS, type FootprintBar as OpenAlgoFootprintBar, type FootprintHover, type FootprintOptions } from 'openalgo-charts/profile';
import type { Candle, FootprintBar } from '../feed/protocol';
import { MAX_BARS } from '../feed/reconcile';
import { formatPrice } from './format';
import { TerminalFootprint } from './terminal-footprint';
import { FootprintActivity } from './footprint-activity';
import { footprintForUnits, type FootprintUnits } from './footprint-units';
import type { Scheduler } from './scheduler';

import { CHART_THEMES, THEME_EVENT, currentTheme, type ThemeName } from '../theme';

function toBar(candle: Candle): Bar {
  return {
    time: epochMsToUtcSeconds(candle.t),
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
  };
}

function toExecutionBar(footprint: FootprintBar): Bar {
  const volume = footprint.cells.reduce((sum, cell) => sum + cell.bidVol + cell.askVol, 0);
  return { time: footprint.time, open: footprint.open, high: footprint.high, low: footprint.low, close: footprint.close, volume };
}

function toFootprintBar(bar: FootprintBar): OpenAlgoFootprintBar {
  return {
    time: bar.time,
    // OpenAlgo draws cells around their centre; canonical cells carry lower bounds.
    cells: bar.cells.map(cell => ({ ...cell, price: cell.price + bar.rowSize / 2 })),
    delta: bar.delta,
    minDelta: bar.minDelta,
    maxDelta: bar.maxDelta,
    rowSize: bar.rowSize,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    // The OpenAlgo `trades` statistic means individual classified records. These
    // rows are exchange aggregate observations and deliberately omit tradeCount.
  };
}

interface ViewAnchor { fromTime: number; toTime: number; fromOffset: number; toOffset: number }

/** Owns the chart engine while routing its frames through the shared visible-panel scheduler. */
export class OpenAlgoCandleChart {
  visible = false;
  private heatmap: OrderBookHeatmap | null = null;
  readonly chart: OpenAlgoChart;
  private readonly axisGrid = new AxisGrid();
  readonly series: SeriesApi;
  private footprintIndexSeries: SeriesApi | null = null;
  readonly stats = { draws: 0, footprintSets: 0 };
  private readonly callbacks = new Map<number, () => void>();
  private times: number[] = [];
  private nextFrame = 0;
  private disposed = false;
  private readonly inputAbort = new AbortController();
  private visibleCallbacks = new Map<() => void, () => void>();
  private latestTime = -Infinity;
  private latestBar: Bar | null = null;
  private candleTimes: number[] = [];
  private footprintTimes: number[] = [];
  private footprintBars: FootprintBar[] = [];
  private footprintSliceKey = '';
  private footprintOpacity = .85;
  private footprintUnits: FootprintUnits = 'btc';
  private pendingView: ViewAnchor | null = null;
  private mode: 'candle' | 'footprint' = 'candle';
  private footprint: TerminalFootprint | null = null;
  private footprintOptions: FootprintOptions = {
    ...DEFAULT_FOOTPRINT_OPTIONS,
    // Reserve enough of each bar slot for the 5-digit buy/sell quantities at 80px spacing.
    font: 9, widthFactor: 0.84,
    displayMode: 'bidask', cellStyle: 'ladder',
    statsRows: ['volume', 'bidVolume', 'askVolume', 'delta'], tableRows: [],
    showCandle: true, showPoc: true, showValueArea: true, valueAreaColor: 'rgba(133, 133, 133, 0.8)',
    pocStyle: 'outline', radius: 0,
    stackedImbalances: 0, cvdOffset: 0,
  };
  private readonly footprintRefresh = () => this.refreshVisibleFootprint();
  private readonly reducedMotion = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return { matches: false }; } })();
  private readonly footprintActivity = new FootprintActivity(() => this.footprint?.options() ?? this.footprintOptions, () => this.reducedMotion.matches);
  // A sparse session must not stretch one price row to the entire pane.
  // This contributes only an autoscale extent; manual scaling remains owned by OpenAlgo.
  private readonly footprintScaleFloor: IPrimitive = {
    zOrder: () => 'bottom',
    draw: () => {},
    autoscaleInfo: () => {
      const extent = this.footprint?.autoscaleInfo();
      const scale = this.chart.panes()[0]?.priceScale;
      const rowSize = this.footprintBars.at(-1)?.rowSize;
      if (!extent || !scale || !rowSize || scale.height <= 0) return null;
      const usableHeight = scale.height * Math.max(0, 1 - scale.options.marginTop - scale.options.marginBottom);
      const span = Math.max(extent.max - extent.min, rowSize * usableHeight / 16);
      const centre = (extent.min + extent.max) / 2;
      return { min: centre - span / 2, max: centre + span / 2 };
    },
  };
  private readonly viewSubscriptions: (() => void)[] = [];

  constructor(container: HTMLElement, private readonly scheduler: Scheduler, renderer: RendererChoice = 'canvas2d') {
    this.chart = createChart(container, {
      raf: {
        schedule: callback => {
          const handle = ++this.nextFrame;
          this.callbacks.set(handle, callback);
          this.scheduler.invalidate(this);
          return handle;
        },
        cancel: handle => {
          this.callbacks.delete(handle);
          if (!this.callbacks.size) this.scheduler.remove(this);
        },
      },
      theme: CHART_THEMES[currentTheme()],
      renderer,
      timezone: 'UTC',
      branding: false,
      watermark: false,
      timeNavigator: false,
      shortcuts: false,
      doubleClick: 'none',
      priceAxisWidth: 80,
      timeAxisHeight: 20,
      priceFormatter: formatPrice,
      grid: { vertLines: false, horzLines: false, spacing: 90, vertColor: CHART_THEMES[currentTheme()].grid, horzColor: CHART_THEMES[currentTheme()].grid, lineWidth: 1 },
      timeScale: { barSpacing: 7, minBarSpacing: 3, maxBarSpacing: 320, rightOffset: 5 },
      navigation: {
        panEnabled: true,
        zoomEnabled: true,
        mousePan: 'both',
        defaultVisibleBars: 120,
        defaultBarSpacing: 7,
      },
      zoomAnchor: 'cursor',
      animZoom: false,
      animAutoscale: false,
      ariaLabel: 'BTC perpetual candlestick chart. Drag to pan time and price, wheel to zoom.',
    });
    this.series = this.chart.addSeries('candlestick', {
      style: {
        priceLineVisible: true,
        lastValueVisible: true,
        colorByPreviousClose: false,
      },
    });
    this.chart.addPrimitive(this.axisGrid, { anchor: 'primary-pane' });
    this.setTheme(currentTheme());
    window.addEventListener(THEME_EVENT, () => this.setTheme(currentTheme()), { signal: this.inputAbort.signal });
    // OpenAlgo 2.6.0 zooms only time on a plot wheel. Apply its matching
    // price-scale gesture first so the time zoom cannot autoscale it away.
    container.addEventListener('wheel', event => this.zoomPriceWithWheel(event, container), {
      capture: true, passive: false, signal: this.inputAbort.signal,
    });
  }

  setGridVisible(visible: boolean) { this.axisGrid.setEnabled(visible); }

  private setTheme(name: ThemeName) {
    const palette = CHART_THEMES[name];
    this.chart.setTheme(palette);
    // Explicit series/grid overrides need the same palette; preserve all data and view state.
    this.chart.setGridOptions({ vertColor: palette.grid, horzColor: palette.grid });
    this.series.applyOptions({ upColor: palette.upColor, downColor: palette.downColor,
      borderUpColor: palette.upColor, borderDownColor: palette.downColor,
      wickUpColor: palette.wickUpColor, wickDownColor: palette.wickDownColor });
    this.footprintOptions = { ...this.footprintOptions, buyColor: palette.upColor, buyTextColor: palette.upColor,
      sellColor: palette.downColor, sellTextColor: palette.downColor, pocColor: palette.axisText };
    this.footprint?.setOptions(this.footprintOptions);
  }

  setHeatmap(options: HeatmapSettings, intervalMs: number) {
    if (!options.enabled) { if (this.heatmap) this.chart.removePrimitive(this.heatmap); this.heatmap = null; return; }
    if (!this.heatmap) { this.heatmap = new OrderBookHeatmap(intervalMs); this.heatmap.setUnits(this.footprintUnits); this.chart.addPrimitive(this.heatmap, 0); }
    this.heatmap.setFootprintOcclusion((timeMs, low, high) => {
      if (this.mode !== 'footprint') return false;
      const bar = this.footprintBars[lowerBoundFootprint(this.footprintBars, timeMs / 1000)];
      return bar?.time === timeMs / 1000 && bar.cells.some(cell => cell.price < high && cell.price + bar.rowSize > low);
    });
    this.heatmap.setInterval(intervalMs); this.heatmap.setOptions(options);
    this.heatmap.setFootprintLayout(this.mode === 'footprint' ? this.footprintOptions : undefined);
  }
  updateHeatmap(buckets: LiquidityBucket[], snapshot: boolean, retentionStart: number | null) { this.heatmap?.update(buckets, snapshot, retentionStart); }
  heatmapAt(x: number, y: number) { return this.heatmap?.hoverAt(x, y) ?? null; }
  heatmapDiagnostics() { return this.heatmap ? { ...this.heatmap.diagnostics(), mounted: true } : { mounted: false }; }

  private zoomPriceWithWheel(event: WheelEvent, container: HTMLElement) {
    if (this.disposed || !this.visible || !Number.isFinite(event.deltaY)) return;
    const bounds = container.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
    const dy = event.deltaY * unit;
    const dx = event.deltaX * (event.deltaMode === 2 ? bounds.width : event.deltaMode === 1 ? 16 : 1);
    if (!dy || (!event.ctrlKey && !event.metaKey && (event.shiftKey || Math.abs(dx) > Math.abs(dy)))) return;
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    for (let index = 0; index < this.chart.panes().length; index++) {
      const plot = this.chart.plotRect(index);
      if (!plot || x < plot.left || x >= plot.left + plot.width || y < plot.top || y >= plot.top + plot.height) continue;
      // Same normalized, bounded wheel sensitivity as the installed library.
      const factor = Math.exp(Math.max(-2, Math.min(2, dy * Math.log(1.1) / 100)));
      this.chart.panes()[index]!.priceScale.scaleAtY(y - plot.top, factor);
      event.preventDefault();
      this.chart.invalidate(mask => mask.invalidateGlobal(InvalidationLevel.Full));
      break;
    }
  }

  setSnapshot(candles: Candle[], preserveView = true) {
    if (this.disposed) return;
    const view = this.pendingView ?? (preserveView ? this.captureView() : null);
    this.pendingView = null;
    const bars = candles.slice(-MAX_BARS).map(toBar);
    if (bars.length) {
      this.series.setData(bars, {
        confirmation: candles.at(-1)?.closed ? 'confirmed' : 'forming',
      });
    } else this.series.setData([]);
    this.candleTimes = bars.map(bar => bar.time);
    if (this.mode === 'candle') {
      this.times = this.candleTimes;
      this.latestBar = bars.at(-1) ?? null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    }
    this.restoreView(view);
  }

  private basePriceVisible = true;
  setBasePriceVisible(visible: boolean) { this.basePriceVisible = visible; if (this.mode === 'candle') this.series.applyOptions({ visible, priceLineVisible: visible, lastValueVisible: visible }); }

  setDisplayMode(mode: 'candle' | 'footprint', preserveView = false) {
    if (this.disposed || this.mode === mode) return;
    this.pendingView = preserveView ? this.captureView() : null;
    this.mode = mode;
    this.heatmap?.setFootprintLayout(mode === 'footprint' ? this.footprintOptions : undefined);
    this.series.applyOptions({
      visible: mode === 'candle' && this.basePriceVisible,
      priceLineVisible: mode === 'candle' && this.basePriceVisible,
      lastValueVisible: mode === 'candle' && this.basePriceVisible,
    });
    if (mode === 'footprint') {
      this.ensureFootprintSurface();
      this.times = this.footprintTimes;
      const latest = this.footprintBars.at(-1);
      this.latestBar = latest ? toExecutionBar(latest) : null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    } else {
      this.removeFootprintSurface();
      this.footprintBars = [];
      this.footprintSliceKey = '';
      this.footprintTimes = [];
      this.times = this.candleTimes;
      this.latestBar = this.series.getData().at(-1) ?? null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    }
    this.restoreView(this.pendingView);
    this.pendingView = null;
  }

  setFootprintBars(bars: FootprintBar[], preserveView = true) {
    const indexSeries = this.footprintIndexSeries;
    if (this.disposed || this.mode !== 'footprint' || !indexSeries || !this.footprint) return;
    if (!bars.length && this.pendingView) return;
    const view = this.pendingView ?? (preserveView ? this.captureView() : null);
    this.pendingView = null;
    this.footprintActivity.clear();
    this.footprintBars = bars.slice(-MAX_BARS).sort((a, b) => a.time - b.time);
    const data = this.footprintBars.map(toExecutionBar);
    indexSeries.setData(data, { confirmation: 'forming' });
    this.footprintTimes = data.map(bar => bar.time);
    this.times = this.footprintTimes;
    this.latestBar = data.at(-1) ?? null;
    this.latestTime = this.latestBar?.time ?? -Infinity;
    this.footprintSliceKey = '';
    this.restoreView(view);
    this.enqueueFootprintRefresh();
  }

  applyFootprintPatch(patches: FootprintBar[], retentionStart?: number | null) {
    const indexSeries = this.footprintIndexSeries;
    if (this.disposed || this.mode !== 'footprint' || !indexSeries || !patches.length) return;
    let trimmed = false;
    if (retentionStart !== undefined) {
      const cutoff = retentionStart ?? Infinity;
      while (this.footprintBars.length && this.footprintBars[0]!.time < cutoff) {
        this.footprintBars.shift();
        this.footprintTimes.shift();
        trimmed = true;
      }
      if (trimmed) {
        this.times = this.footprintTimes;
        indexSeries.setData(this.footprintBars.map(toExecutionBar), { confirmation: 'forming' });
      }
    }
    for (const footprint of patches) {
      const index = lowerBound(this.footprintTimes, footprint.time);
      const known = this.footprintTimes[index] === footprint.time;
      const bar = toExecutionBar(footprint);
      const source = footprint.time < this.latestTime ? 'history' : 'live';
      indexSeries.update(bar, { source, confirmation: footprint.time < this.latestTime ? 'confirmed' : 'forming' });
      if (!known) this.footprintTimes.splice(index, 0, footprint.time);
      const barIndex = lowerBoundFootprint(this.footprintBars, footprint.time);
      if (this.visible && !document.hidden) this.footprintActivity.observe(this.footprintBars[barIndex]?.time === footprint.time ? this.footprintBars[barIndex] : undefined, footprint);
      if (this.footprintBars[barIndex]?.time === footprint.time) this.footprintBars[barIndex] = footprint;
      else this.footprintBars.splice(barIndex, 0, footprint);
      if (footprint.time >= this.latestTime) { this.latestTime = footprint.time; this.latestBar = bar; }
    }
    if (this.times.length > MAX_BARS) {
      this.footprintTimes = this.footprintTimes.slice(-MAX_BARS);
      this.times = this.footprintTimes;
      this.footprintBars = this.footprintBars.slice(-MAX_BARS);
      indexSeries.setData(this.footprintBars.map(toExecutionBar), { confirmation: 'forming' });
      this.latestBar = this.footprintBars.length ? toExecutionBar(this.footprintBars.at(-1)!) : null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    }
    this.enqueueFootprintRefresh();
  }

  applyPatch(candles: Candle[]) {
    if (this.disposed || !candles.length) return;
    let trim = false;
    for (const candle of candles) {
      const bar = toBar(candle);
      const at = lowerBound(this.candleTimes, bar.time);
      const isKnown = this.candleTimes[at] === bar.time;
      const source = bar.time < (this.candleTimes.at(-1) ?? -Infinity) ? 'history' : 'live';
      this.series.update(bar, {
        source,
        confirmation: candle.closed ? 'confirmed' : 'forming',
      });
      if (!isKnown) {
        this.candleTimes.splice(at, 0, bar.time);
        trim ||= this.candleTimes.length > MAX_BARS;
      }
      if (this.mode === 'candle' && bar.time >= this.latestTime) { this.latestTime = bar.time; this.latestBar = bar; }
    }
    if (trim) {
      const bounded = this.series.getData().slice(-MAX_BARS);
      this.series.setData(bounded);
      this.candleTimes = bounded.map(bar => bar.time);
      if (this.mode === 'candle') {
        this.times = this.candleTimes;
        this.latestBar = bounded.at(-1) ?? null;
        this.latestTime = this.latestBar?.time ?? -Infinity;
      }
    }
  }

  resetView() {
    if (this.mode === 'footprint') this.focusFootprintLatest();
    else this.chart.resetScale();
  }

  /** Start a newly opened Footprint view at the live edge with readable columns. */
  focusFootprintLatest() {
    if (this.mode !== 'footprint' || !this.footprintIndexSeries || !this.footprintTimes.length) return;
    this.chart.resetScale();
    this.chart.timeScale.setBarSpacing(80);
    this.chart.timeScale.setRightOffset(1);
  }

  setRange(range: { from: number; to: number }) { this.chart.setVisibleLogicalRange(range); }
  visibleRange() { return this.chart.getVisibleLogicalRange(); }
  visibleTimeRange() {
    const range = this.chart.getVisibleLogicalRange();
    if (!range || !this.chart.dataLayer.length) return null;
    const from = this.chart.dataLayer.indexToTimeFloat(range.from);
    const to = this.chart.dataLayer.indexToTimeFloat(range.to);
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
  }
  capturePendingView() { if (!this.disposed) this.pendingView = this.captureView(); }
  zoom(factor: number) { this.chart.timeScale.setBarSpacing(this.chart.timeScale.barSpacing * factor); }

  latestCandle() { return this.latestBar; }
  footprintAt(x: number, y: number): FootprintHover | null {
    const hit = this.mode === 'footprint' ? this.footprint?.hoverAt(x, y) ?? null : null;
    if (!hit || hit.price === null) return hit;
    const bar = this.footprintBars.find(bar => bar.time === hit.time);
    const cell = bar?.cells.find(cell => cell.price + bar.rowSize / 2 === hit.price);
    return cell ? { ...hit, price: cell.price, cell: hit.cell ? { ...hit.cell, price: cell.price } : null } : null;
  }
  latestFootprintStats() { return this.footprint?.stats().at(-1) ?? null; }
  get footprintSurfaceMounted() { return this.footprint !== null && this.footprintIndexSeries !== null; }
  get displayMode() { return this.mode; }
  get barCount() { return this.times.length; }
  get backend() { return this.chart.rendererKind; }

  enqueueVisible(callback: () => void) {
    if (this.disposed) return;
    this.visibleCallbacks.set(callback, callback);
    this.scheduler.invalidate(this);
  }

  private enqueueFootprintRefresh() { this.enqueueVisible(this.footprintRefresh); }

  private refreshVisibleFootprint() {
    if (this.mode !== 'footprint' || this.disposed || !this.footprint) return;
    const range = this.chart.getVisibleLogicalRange();
    if (!range || !this.footprintBars.length) { this.clearFootprintSlice(); return; }
    const fromTime = this.chart.dataLayer.indexToTimeFloat(Math.floor(range.from) - 1);
    const toTime = this.chart.dataLayer.indexToTimeFloat(Math.ceil(range.to) + 2);
    if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) { this.clearFootprintSlice(); return; }
    const start = lowerBoundFootprint(this.footprintBars, fromTime);
    const end = upperBoundFootprint(this.footprintBars, toTime);
    if (end <= start) { this.clearFootprintSlice(); return; }
    const selected = this.footprintBars.slice(start, end);
    const key = selected.map(bar => `${bar.time}.${bar.revision}`).join(',') || 'empty';
    if (key === this.footprintSliceKey) return;
    this.footprintSliceKey = key;
    // The control's minimum imbalance size remains BTC. OpenAlgo takes one
    // display-unit threshold, so in notional view use its latest-price equivalent.
    const threshold = this.footprintOptions.imbalanceThreshold;
    this.footprint.setOptions({ imbalanceThreshold: this.footprintUnits === 'usdt' && threshold < Number.MAX_VALUE
      ? Math.min(Number.MAX_VALUE, threshold * (this.latestBar?.close ?? 1)) : threshold });
    this.footprint.setBars(selected.map(bar => footprintForUnits(bar, this.footprintUnits)).filter(bar => bar !== null).map(toFootprintBar));
    this.stats.footprintSets++;
  }

  private captureView(): ViewAnchor | null {
    const range = this.chart.getVisibleLogicalRange();
    if (!range || !this.chart.dataLayer.length) return null;
    const fromIndex = Math.max(0, Math.min(this.chart.dataLayer.length - 1, Math.floor(range.from)));
    const toIndex = Math.max(0, Math.min(this.chart.dataLayer.length - 1, Math.floor(range.to)));
    const fromTime = this.chart.dataLayer.indexToTime(fromIndex);
    const toTime = this.chart.dataLayer.indexToTime(toIndex);
    if (fromTime === undefined || toTime === undefined) return null;
    return {
      fromTime, toTime,
      fromOffset: range.from - fromIndex, toOffset: range.to - toIndex,
    };
  }

  private restoreView(view: ViewAnchor | null) {
    if (!view || !this.chart.dataLayer.length) return;
    const fromIndex = this.chart.dataLayer.timeToIndexFloat(view.fromTime);
    const toIndex = this.chart.dataLayer.timeToIndexFloat(view.toTime);
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;
    this.chart.setVisibleLogicalRange({ from: fromIndex + view.fromOffset, to: toIndex + view.toOffset });
  }

  setFootprintOpacity(opacity: number) { this.footprintOpacity = opacity; this.footprint?.setCellOpacity(opacity); }

  setFootprintOptions(options: Partial<FootprintOptions>) {
    this.footprintOptions = { ...this.footprintOptions, ...options };
    if (this.mode === 'footprint') this.heatmap?.setFootprintLayout(this.footprintOptions);
    const threshold = this.footprintOptions.imbalanceThreshold;
    this.footprint?.setOptions({ ...options, imbalanceThreshold: this.footprintUnits === 'usdt' && threshold < Number.MAX_VALUE
      ? Math.min(Number.MAX_VALUE, threshold * (this.latestBar?.close ?? 1)) : threshold });
  }

  setFootprintUnits(units: FootprintUnits) {
    if (units === this.footprintUnits) return;
    this.footprintUnits = units; this.heatmap?.setUnits(units);
    this.footprintActivity.clear();
    this.footprintSliceKey = '';
    this.enqueueFootprintRefresh();
  }

  private clearFootprintSlice() {
    const footprint = this.footprint;
    if (!footprint) return;
    if (this.footprintSliceKey === 'empty') return;
    this.footprintSliceKey = 'empty';
    footprint.setBars([]);
    this.stats.footprintSets++;
  }

  private ensureFootprintSurface() {
    if (this.footprint && this.footprintIndexSeries) return;
    // Keep a candle chart on its original single-series path. The execution
    // index and profile primitive only exist while Footprint is selected.
    this.footprintIndexSeries = this.chart.addSeries('candlestick', {
      style: {
        // Footprint primitives have no price autoscale of their own. Keep this
        // OHLC index visible to price scaling while drawing no candle pixels.
        visible: true,
        color: CHART_THEMES[currentTheme()].axisText,
        upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)',
        borderUpColor: 'rgba(0,0,0,0)', borderDownColor: 'rgba(0,0,0,0)',
        wickUpColor: 'rgba(0,0,0,0)', wickDownColor: 'rgba(0,0,0,0)',
        // The last-price line/tag follows the same executions as the footprint,
        // including moves inside one aggregated row. Candle pixels stay transparent.
        priceLineVisible: true, lastValueVisible: true,
      },
    });
    this.footprint = new TerminalFootprint(this.footprintOptions);
    this.footprint.setCellOpacity(this.footprintOpacity);
    this.chart.addPrimitive(this.footprint);
    this.chart.addPrimitive(this.footprintScaleFloor);
    this.chart.addPrimitive(this.footprintActivity);
    this.viewSubscriptions.push(
      this.chart.on('pan', () => this.enqueueFootprintRefresh()),
      this.chart.on('zoom', () => this.enqueueFootprintRefresh()),
      this.chart.on('resize', () => this.enqueueFootprintRefresh()),
      this.chart.on('paneResized', () => this.enqueueFootprintRefresh()),
    );
  }

  private removeFootprintSurface() {
    this.visibleCallbacks.delete(this.footprintRefresh);
    for (const unsubscribe of this.viewSubscriptions) unsubscribe();
    this.viewSubscriptions.length = 0;
    if (this.footprint) this.chart.removePrimitive(this.footprint);
    this.chart.removePrimitive(this.footprintScaleFloor);
    this.chart.removePrimitive(this.footprintActivity);
    this.footprintActivity.clear();
    this.footprint = null;
    this.footprintIndexSeries?.remove();
    this.footprintIndexSeries = null;
  }

  draw() {
    if (!this.visible || document.hidden || this.disposed) return;
    const visibleCallbacks = [...this.visibleCallbacks.values()];
    this.visibleCallbacks.clear();
    for (const callback of visibleCallbacks) callback();
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
      this.stats.draws++;
    }
    // Cursor invalidation repaints only OpenAlgo's overlay, through our existing RAF scheduler.
    if (this.footprintActivity.needsFrame) this.chart.invalidate(mask => mask.invalidateGlobal(InvalidationLevel.Cursor));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.inputAbort.abort();
    this.removeFootprintSurface();
    if (this.heatmap) this.chart.removePrimitive(this.heatmap);
    this.heatmap = null;
    this.chart.removePrimitive(this.axisGrid);
    this.chart.destroy();
    this.callbacks.clear();
    this.visibleCallbacks.clear();
    this.times = [];
    this.scheduler.remove(this);
  }
}

export type { Bar };

function lowerBoundFootprint(values: readonly FootprintBar[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]!.time < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundFootprint(values: readonly FootprintBar[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]!.time <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBound(values: readonly number[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

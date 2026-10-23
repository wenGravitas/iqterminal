import { otherFootprintTotals } from '../footprint-totals-tooltip';
import { anchorTimeAxisToPrimary } from './primary-time-axis';
import { effectiveCurrency } from '../currency-display';
import { WatchZones } from './watch-zones';
import type {LevelWatch} from '../level-watch/types';
import { AxisGrid } from './axis-grid';
import { OrderBookHeatmap } from './orderbook-heatmap';
import type { HeatmapSettings, LiquidityBucket } from '../feed/heatmap-model';
import { OrderWallsPrimitive } from './order-walls';
import { NetPositioningPane, netPositioningSourceColors } from './net-positioning';
import type { NetPositioningLabels } from './net-positioning';
import type { NetPositioningCandle, NetPositioningFeedStatus, NetPositioningMethod, NetPositioningSide, NetPositioningUnitVerification, NetPositioningVenue } from '../feed/net-positioning';
import { ExecutionHoverRay } from './execution-hover-ray';
import { ORDER_WALL_MAX_SEGMENTS, ORDER_WALL_MAX_VALUE_RUNS, ORDER_WALL_MAX_VALUE_RUNS_PER_SEGMENT } from '../feed/order-walls';
import type { OrderWallHit, OrderWallPatch, OrderWallSegment, OrderWallsSettings, OrderWallStatus } from '../feed/order-walls';
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
import { ChartObjects } from 'openalgo-charts';
import { DrawingController, InstrumentDrawings, memoryDrawingStore, registerBuiltinDrawingTools, registeredDrawingTools, type Drawing, type DrawingDocumentStore } from 'openalgo-charts/draw';
import type { CanonicalSeries } from '../feed/protocol';
import { DEFAULT_FOOTPRINT_OPTIONS, type FootprintBar as OpenAlgoFootprintBar, type FootprintHover, type FootprintOptions } from 'openalgo-charts/profile';
import type { Candle, FootprintBar } from '../feed/protocol';
import { MAX_BARS } from '../feed/reconcile';
import { formatPrice } from './format';
import { DrawingAxisPriceLabels, registerIQDrawingLabelRenderers } from './drawing-labels';
import { TerminalFootprint } from './terminal-footprint';
import { FootprintTotalsPane } from './footprint-totals';
import type { FootprintBarStats, FootprintStatRow } from 'openalgo-charts/profile';
import { FootprintActivity } from './footprint-activity';
import { TpoProfilePrimitive } from './tpo-profile';
import type { TpoNakedLevel, TpoSession } from '../indicators/tpo-engine';
import type { TpoIndicatorSettings } from '../indicators/tpo-settings';
import { footprintForUnits, type FootprintUnits } from './footprint-units';
import type { Scheduler } from './scheduler';

import { CHART_THEMES, THEME_EVENT, currentTheme, type ThemeName } from '../theme';
import { getDisplayTimezone, TIMEZONE_EVENT } from '../timezone';

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
let drawingToolsRegistered = false;

/** Owns the chart engine while routing its frames through the shared visible-panel scheduler. */
export class OpenAlgoCandleChart {
  visible = false;
  private heatmap: OrderBookHeatmap | null = null;
  private orderWalls: OrderWallsPrimitive | null = null;
  private tpoProfile: TpoProfilePrimitive | null = null;
  private netPositioningPanes = new Map<string, { series: SeriesApi; primitive: NetPositioningPane; paneIndex: number }>();
  onNetPositioningVenueToggle?: (id: string, venue: NetPositioningVenue) => void;
  private netPositioningLegends = new Map<string, { element: HTMLElement; abort: AbortController; venuesKey: string }>();
  private footprintTotalsPanes = new Map<string, { series: SeriesApi; primitive: FootprintTotalsPane; paneIndex: number; autoHeight: number; autoWeight: number | null; manuallyResized: boolean }>();
  private readonly netPositioningViewportSubscriptions: (() => void)[] = [];
  private orderWallSegments = new Map<string, OrderWallSegment>();
  private orderWallValueQueue: Array<{ id: string; point: OrderWallSegment['valueRuns'][number] }> = [];
  private orderWallValueQueueStart = 0;
  private orderWallValueCount = 0;
  private orderWallStatus: OrderWallStatus = { state: 'loading' };
  readonly chart: OpenAlgoChart;
  readonly drawings: DrawingController;
  readonly objects: ChartObjects;
  readonly scopedDrawings: InstrumentDrawings;
  private readonly axisGrid = new AxisGrid(getDisplayTimezone());
  private readonly executionHoverRay = new ExecutionHoverRay();
  readonly series: SeriesApi;
  private footprintIndexSeries: SeriesApi | null = null;
  readonly stats = { draws: 0, footprintSets: 0 };
  private readonly callbacks = new Map<number, () => void>();
  private times: number[] = [];
  private nextFrame = 0;
  private disposed = false;
  private readonly inputAbort = new AbortController();
  private readonly drawingAxisLabels: DrawingAxisPriceLabels[] = [];
  private readonly drawingPreviews = new Map<string, Drawing>();
  private readonly drawingSubscriptions: (() => void)[] = [];
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
    // Keep readable quantities with a wider gutter between footprint columns.
    font: 9, widthFactor: 0.76,
    displayMode: 'bidask', cellStyle: 'ladder',
    statsRows: [], tableRows: [],
    showCandle: true, showPoc: true, showValueArea: true, valueAreaColor: '#ffffff',
    pocStyle: 'outline', radius: 0,
    stackedImbalances: 0, cvdOffset: 0,
  };
  private readonly watchZones = new WatchZones();
  setWatchZones(watches:LevelWatch[]){this.watchZones.set(watches);}
  setExecutionHoverRay(execution:import('../feed/footprint').NormalizedExecution|null){this.executionHoverRay.setExecution(execution);}
  executionHoverDiagnostics(){return this.executionHoverRay.diagnostics();}
  watchPriceAt(x:number,y:number){const paneIndex=this.chart.primaryPaneIndex(),plot=this.chart.plotRect(paneIndex);if(!plot||x<plot.left||x>plot.left+plot.width||y<plot.top||y>plot.top+plot.height)return null;return Math.round(this.chart.panes()[paneIndex]!.yToPrice(y-plot.top)*10)/10;}
  focusWatch(lower:number,upper:number){const scale=this.chart.panes()[this.chart.primaryPaneIndex()]!.readoutScale();this.chart.setAutoScale(false);scale.setPriceRange({min:lower,max:upper});this.chart.invalidate(mask=>mask.invalidateGlobal(InvalidationLevel.Full));}
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
      const scale = this.chart.panes()[this.chart.primaryPaneIndex()]?.priceScale;
      const rowSize = this.footprintBars.at(-1)?.rowSize;
      if (!extent || !scale || !rowSize || scale.height <= 0) return null;
      const usableHeight = scale.height * Math.max(0, 1 - scale.options.marginTop - scale.options.marginBottom);
      const span = Math.max(extent.max - extent.min, rowSize * usableHeight / 16);
      const centre = (extent.min + extent.max) / 2;
      return { min: centre - span / 2, max: centre + span / 2 };
    },
  };
  private readonly viewSubscriptions: (() => void)[] = [];
  private resizeSubscription?: () => void;
  private readonly footprintTotalsSizeSubscriptions: (() => void)[] = [];
  private footprintTotalsFitQueued = false;

  constructor(private readonly container: HTMLElement, private readonly scheduler: Scheduler, renderer: RendererChoice = 'canvas2d', panelId = 'chart', initialSeries?: CanonicalSeries) {
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
      movablePrimaryPane: true,
      timezone: getDisplayTimezone(),
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
    anchorTimeAxisToPrimary(this.chart);
    // The chart library clears its CanvasLayers while processing a container
    // resize, then defers repaint through the injected RAF. The host scheduler
    // may not run until the next frame, so consume this chart's queued resize
    // work after refreshing the viewport-dependent footprint slice.
    this.resizeSubscription = this.chart.on('resize', () => {
      if (this.mode === 'footprint' || this.footprintTotalsPanes.size) this.enqueueFootprintRefresh();
      this.queueFootprintTotalsFit(true);
      this.syncNetPositioningViewport();
      this.scheduler.flush(this);
    });
    this.footprintTotalsSizeSubscriptions.push(this.chart.on('paneResized', payload => this.recordFootprintTotalsManualResize(payload.paneIndex)));
    // The drawing tier is deliberately attached only to native candle charts.
    // It shares this chart's existing renderer and RAF scheduler.
    if (!drawingToolsRegistered) { registerBuiltinDrawingTools(); drawingToolsRegistered = true; }
    registerIQDrawingLabelRenderers();
    this.drawings = new DrawingController(this.chart, { magnet: 'weak' });
    this.syncDrawingAxisLabels();
    this.drawingSubscriptions.push(
      this.chart.on('draw:preview', payload => {
        const previews = (payload as { drawings?: Drawing[] } | null)?.drawings;
        if (!previews) return;
        this.drawingPreviews.clear();
        for (const drawing of previews) this.drawingPreviews.set(drawing.id, drawing);
      }),
      this.chart.on('draw:preview-clear', payload => {
        const ids = (payload as { ids?: string[] } | null)?.ids;
        if (!ids) { this.drawingPreviews.clear(); return; }
        for (const id of ids) this.drawingPreviews.delete(id);
      }),
      this.chart.on('paneAdded', payload => { this.shiftNetPositioningPanes('add', payload.paneIndex); this.syncNetPositioningViewport(); this.drawingPreviews.clear(); this.syncDrawingAxisLabels(); this.queueFootprintTotalsFit(true); }),
      this.chart.on('paneRemoved', payload => { this.shiftNetPositioningPanes('remove', payload.paneIndex); this.syncNetPositioningViewport(); this.drawingPreviews.clear(); this.syncDrawingAxisLabels(); this.queueFootprintTotalsFit(true); }),
      this.chart.on('paneMoved', payload => { this.shiftNetPositioningPanes('move', payload.from, payload.to); this.syncNetPositioningViewport(); this.drawingPreviews.clear(); this.syncDrawingAxisLabels(); this.queueFootprintTotalsFit(true); }),
    );
    this.scopedDrawings = new InstrumentDrawings(this.chart, this.drawings, {
      store: safeDrawingStore(),
      key: instrument => {
        if (!instrument.symbol || !instrument.exchange) return null;
        return `iqterminal:drawings:${encodeURIComponent(panelId)}:${encodeURIComponent(instrument.exchange)}:${encodeURIComponent(instrument.symbol)}`;
      },
      onError: error => console.warn(`[drawings] ${error.operation} failed for ${error.key}; keeping this session's drawings in memory`, error.error),
    });
    this.objects = new ChartObjects(this.chart, {
      drawings: this.drawings,
      drawingName: tool => registeredDrawingTools().find(item => item.id === tool)?.name ?? tool,
    });
    if (initialSeries) this.setDrawingContext(initialSeries);
    this.series = this.chart.addSeries('candlestick', {
      style: {
        priceLineVisible: true,
        lastValueVisible: true,
        colorByPreviousClose: false,
      },
    });
    this.chart.addPrimitive(this.watchZones, { anchor: 'primary-pane' });
    this.chart.addPrimitive(this.axisGrid, { anchor: 'primary-pane' });
    this.chart.addPrimitive(this.executionHoverRay, { anchor: 'primary-pane' });
    this.setTheme(currentTheme());
    window.addEventListener(THEME_EVENT, () => this.setTheme(currentTheme()), { signal: this.inputAbort.signal });
    window.addEventListener(TIMEZONE_EVENT, event => {
      const detail = (event as CustomEvent<{ zone?: string }>).detail;
      const zone = detail?.zone ?? getDisplayTimezone();
      this.chart.setTimezone(zone);
      this.axisGrid.setTimezone(zone);
    }, { signal: this.inputAbort.signal });
    // Keep native axis zoom, Ctrl/Meta cursor zoom and Shift/trackpad pan.
    // The plot gesture selects right-anchored time zoom or legacy two-axis zoom.
    container.addEventListener('wheel', event => this.handleWheel(event, container), {
      capture: true, passive: false, signal: this.inputAbort.signal,
    });
  }

  setDrawingContext(series: CanonicalSeries) {
    this.chart.setDataContext({
      exchange: `${series.venue}:${series.market}`,
      symbol: series.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT',
      interval: series.interval,
    });
  }

  private wheelMode: 'tradingview' | 'both-axes' = 'tradingview';
  setWheelMode(mode: 'tradingview' | 'both-axes') { this.wheelMode = mode; }

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
    this.syncFootprintTotalsPresentation();
    for (const [id, view] of this.netPositioningPanes) {
      view.primitive.setThemeColors(netPositioningSourceColors(name, view.primitive.diagnostics().side));
      this.syncNetPositioningLegend(id, view.primitive.diagnostics().venues);
    }
  }

  setHeatmap(options: HeatmapSettings, intervalMs: number) {
    if (!options.enabled) { if (this.heatmap) this.chart.removePrimitive(this.heatmap); this.heatmap = null; return; }
    if (!this.heatmap) { this.heatmap = new OrderBookHeatmap(intervalMs); this.heatmap.setUnits(this.footprintUnits); this.chart.addPrimitive(this.heatmap, { anchor: 'primary-pane' }); }
    this.heatmap.setFootprintOcclusion((timeMs, low, high) => {
      if (this.mode !== 'footprint') return false;
      const bar = this.footprintBars[lowerBoundFootprint(this.footprintBars, timeMs / 1000)];
      return bar?.time === timeMs / 1000 && bar.cells.some(cell => cell.price < high && cell.price + bar.rowSize > low);
    });
    this.heatmap.setInterval(intervalMs); this.heatmap.setOptions(options);
  }
  updateHeatmap(buckets: LiquidityBucket[], snapshot: boolean, retentionStart: number | null) { this.heatmap?.update(buckets, snapshot, retentionStart); }
  heatmapAt(x: number, y: number) { return this.heatmap?.hoverAt(x, y) ?? null; }
  heatmapDiagnostics() { return this.heatmap ? { ...this.heatmap.diagnostics(), mounted: true } : { mounted: false }; }

  addNetPositioningPane(id: string, side: NetPositioningSide, method: NetPositioningMethod, venues: readonly NetPositioningVenue[], intervalMs: number, display: import('./net-positioning-layout').NetPositioningDisplay = 'stacked', labels: NetPositioningLabels = 'auto', colors?: Partial<Record<NetPositioningVenue, string>>) {
    let view = this.netPositioningPanes.get(id);
    if (!view) {
      if (!this.netPositioningViewportSubscriptions.length) {
        const sync = () => this.syncNetPositioningViewport();
        this.netPositioningViewportSubscriptions.push(this.chart.on('pan', sync), this.chart.on('zoom', sync), this.chart.on('resize', sync), this.chart.on('paneResized', sync), this.chart.on('data:update', sync));
      }
      const paneIndex = this.chart.panes().length;
      const primitive = new NetPositioningPane(id, side);
      const series = this.chart.addSeries('histogram', { paneIndex, priceScaleId: 'right', style: { visible: false } });
      series.priceScale().setOptions({ minMove: 0, minPrecision: 6 });
      series.priceScale().setPriceFormatter(value => {
        const amount = primitive.displayCurrency === 'usdt'
          ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
          : value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) >= 1 ? 4 : 8 });
        return `${amount} ${primitive.displayCurrencyLabel}`;
      });
      series.setData([]);
      this.chart.addPrimitive(primitive, paneIndex);
      view = { series, primitive, paneIndex };
      this.netPositioningPanes.set(id, view);
      primitive.setHostSnapshot(this.candlesFromSeries());
    }
    const currency = effectiveCurrency('btc'), currencyChanged = view.primitive.displayCurrency !== currency;
    view.primitive.setCurrency(currency);
    view.primitive.setThemeColors(netPositioningSourceColors(currentTheme(), side));
    view.primitive.setSettings(side, method, venues, intervalMs, display, labels);
    view.primitive.setColorOverrides(colors);
    if (currencyChanged) {
      view.series.priceScale().setAutoScale(true);
      this.chart.invalidate(mask => mask.invalidatePane(view!.paneIndex, { level: InvalidationLevel.Full, autoScale: true }));
    }
    this.syncNetPositioningLegend(id, venues);
    this.syncNetPositioningViewport();
    return view.paneIndex;
  }

  private syncNetPositioningViewport() {
    if (!this.netPositioningPanes.size) return;
    const range = this.chart.getVisibleLogicalRange();
    if (range) for (const view of this.netPositioningPanes.values()) view.primitive.setVisibleRange(range.from, range.to);
    this.positionNetPositioningLegends();
  }

  private syncNetPositioningLegend(id: string, venues: readonly NetPositioningVenue[]) {
    const view = this.netPositioningPanes.get(id); if (!view) return;
    let legend = this.netPositioningLegends.get(id);
    const venuesKey = 'binance,hyperliquid';
    if (!legend || legend.venuesKey !== venuesKey) {
      legend?.abort.abort(); legend?.element.remove();
      const abort = new AbortController(), element = document.createElement('div');
      element.className = 'net-positioning-legend'; element.setAttribute('role', 'group');
      // Venue controls must not start the chart's pointer-captured pan gesture.
      for (const type of ['pointerdown', 'mousedown'] as const) element.addEventListener(type, event => event.stopPropagation(), { signal: abort.signal });
      element.setAttribute('aria-label', `${view.primitive.diagnostics().side === 'longs' ? 'Net Longs' : 'Net Shorts'} sources`);
      for (const venue of ['binance', 'hyperliquid'] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'net-positioning-source';
        button.dataset.source = venue;
        const icon = document.createElement('img'); icon.src = venue === 'binance' ? '/venues/binance.ico' : '/venues/hyperliquid.png'; icon.alt = ''; icon.width = 12; icon.height = 12;
        const label = document.createElement('span'); label.textContent = venue === 'binance' ? 'BN[P]' : 'HL[P]';
        button.append(icon, label);
        button.title = venue === 'binance' ? 'Binance BTCUSDT USD-M Perpetual' : 'Hyperliquid BTC Perpetual';
        button.setAttribute('aria-label', `Show ${button.title}`);
        const set = () => view.primitive.highlightSource(button.getAttribute('aria-pressed') === 'true' ? venue : null);
        const clear = () => { if (document.activeElement !== button) view.primitive.highlightSource(null); };
        button.addEventListener('pointerenter', set, { signal: abort.signal }); button.addEventListener('pointerleave', clear, { signal: abort.signal });
        button.addEventListener('focus', set, { signal: abort.signal }); button.addEventListener('blur', () => view.primitive.highlightSource(null), { signal: abort.signal });
        button.addEventListener('click', () => { view.primitive.highlightSource(null); this.onNetPositioningVenueToggle?.(id, venue); }, { signal: abort.signal });
        element.append(button);
      }
      this.container.append(element);
      legend = { element, abort, venuesKey }; this.netPositioningLegends.set(id, legend);
    }
    legend.element.setAttribute('aria-label', `${view.primitive.diagnostics().side === 'longs' ? 'Net Longs' : 'Net Shorts'} sources`);
    for (const button of legend.element.querySelectorAll<HTMLButtonElement>('.net-positioning-source')) {
      const venue = button.dataset.source as NetPositioningVenue;
      button.setAttribute('aria-pressed', String(venues.includes(venue)));
      button.style.setProperty('--source-color', view.primitive.sourceColor(venue));
    }
    this.positionNetPositioningLegends();
  }

  private positionNetPositioningLegends() {
    for (const [id, legend] of this.netPositioningLegends) {
      const view = this.netPositioningPanes.get(id); if (!view) continue;
      const plot = this.chart.plotRect(view.paneIndex); if (!plot) { legend.element.hidden = true; continue; }
      legend.element.hidden = false;
      const compact = plot.width < 320;
      for (const button of legend.element.querySelectorAll<HTMLButtonElement>('.net-positioning-source')) {
        button.dataset.compact = String(compact);
      }
      const width = legend.element.getBoundingClientRect().width;
      legend.element.style.left = `${Math.max(plot.left + 4, plot.left + plot.width - width - 6)}px`;
      legend.element.style.top = `${plot.top + 26}px`;
    }
  }

  private candlesFromSeries() {
    return this.series.getData().map(bar => ({ t: bar.time * 1000, closed: bar.time !== (this.latestBar?.time ?? -Infinity) }));
  }

  private shiftNetPositioningPanes(kind: 'add' | 'remove' | 'move', from: number, to?: number) {
    for (const view of [...this.netPositioningPanes.values(), ...this.footprintTotalsPanes.values()]) {
      if (kind === 'add' && from <= view.paneIndex) view.paneIndex++;
      else if (kind === 'remove' && from < view.paneIndex) view.paneIndex--;
      else if (kind === 'move' && to !== undefined) {
        if (view.paneIndex === from) view.paneIndex = to;
        else if (from < to && view.paneIndex > from && view.paneIndex <= to) view.paneIndex--;
        else if (to < from && view.paneIndex >= to && view.paneIndex < from) view.paneIndex++;
      }
    }
  }

  removeNetPositioningPane(id: string) {
    const view = this.netPositioningPanes.get(id); if (!view) return;
    this.netPositioningPanes.delete(id);
    // Removing the series and primitive leaves their explicitly created pane
    // behind. A later show then allocates a new pane at panes().length. Remove
    // the owner pane itself; paneRemoved synchronously shifts the remaining
    // native pane indices, so the removed owner must already be out of the map.
    if (!this.chart.removePane(view.paneIndex)) {
      this.netPositioningPanes.set(id, view);
      console.error(`[chart] Could not remove Net Positioning pane ${id} at index ${view.paneIndex}`);
      return;
    }
    const legend = this.netPositioningLegends.get(id); legend?.abort.abort(); legend?.element.remove(); this.netPositioningLegends.delete(id);
    if (!this.netPositioningPanes.size) { for (const unsubscribe of this.netPositioningViewportSubscriptions) unsubscribe(); this.netPositioningViewportSubscriptions.length = 0; }
    else this.syncNetPositioningViewport();
  }

  addFootprintTotalsPane(id: string, rows: readonly FootprintStatRow[], units: FootprintUnits, highlightHighest = false) {
    let view = this.footprintTotalsPanes.get(id);
    if (!view) {
      this.ensureFootprintStatsModel();
      this.ensureFootprintRefreshSubscriptions();
      const paneIndex = this.chart.panes().length;
      const primitive = new FootprintTotalsPane(id);
      const series = this.chart.addSeries('histogram', { paneIndex, priceScaleId: 'right', style: { visible: false } });
      series.priceScale().setPriceFormatter(() => '');
      series.setData([]);
      this.chart.addPrimitive(primitive, paneIndex);
      view = { series, primitive, paneIndex, autoHeight: 0, autoWeight: null, manuallyResized: false };
      this.footprintTotalsPanes.set(id, view);
      // A new pane still needs the current shared stats when the visible
      // footprint slice is unchanged and the refresh can skip recalculation.
      primitive.setStats(this.footprint?.stats() ?? []);
    }
    view.primitive.setSettings(rows, units, highlightHighest);
    this.syncFootprintTotalsPresentation();
    this.enqueueFootprintRefresh();
    return view.paneIndex;
  }

  private syncFootprintTotalsPresentation() {
    const options = this.footprint?.options() ?? this.footprintOptions;
    for (const view of this.footprintTotalsPanes.values()) {
      view.primitive.setPresentation({
        font: Math.max(11, options.font),
        rowHeight: Math.max(18, options.statsRowHeight),
        labelWidth: options.tableLabelWidth,
        buyTextColor: options.buyTextColor ?? options.buyColor,
        sellTextColor: options.sellTextColor ?? options.sellColor,
      });
      this.fitFootprintTotalsPane(view);
    }
  }

  private queueFootprintTotalsFit(force: boolean) {
    if (this.footprintTotalsFitQueued || this.disposed) return;
    this.footprintTotalsFitQueued = true;
    queueMicrotask(() => {
      this.footprintTotalsFitQueued = false;
      if (this.disposed) return;
      for (const view of this.footprintTotalsPanes.values()) this.fitFootprintTotalsPane(view, force);
    });
  }

  private fitFootprintTotalsPane(view: NonNullable<ReturnType<typeof this.footprintTotalsPanes.get>>, force = false) {
    const targetHeight = view.primitive.preferredHeight();
    const targetChanged = targetHeight !== view.autoHeight;
    view.autoHeight = targetHeight;
    if (view.manuallyResized || (!force && !targetChanged)) return;

    const panes = this.chart.panes();
    if (view.paneIndex < 0 || view.paneIndex >= panes.length || !panes[view.paneIndex]) return;
    const totalHeight = panes.reduce((sum, pane) => sum + pane.base.mediaHeight, 0);
    // There must be room for both Totals and the rest of the native chart.
    if (!Number.isFinite(totalHeight) || totalHeight <= targetHeight + 1) return;
    const otherWeight = panes.reduce((sum, _pane, index) => index === view.paneIndex ? sum : sum + this.chart.paneWeight(index), 0);
    if (!(otherWeight > 0)) return;
    const weight = targetHeight * otherWeight / (totalHeight - targetHeight);
    if (!Number.isFinite(weight) || weight <= 0) return;
    const currentWeight = this.chart.paneWeight(view.paneIndex);
    view.autoWeight = currentWeight;
    if (Math.abs(currentWeight - weight) > Math.max(.001, weight * .002)) {
      // setPaneWeight does not emit paneResized. The expected actual value is
      // stored below so only a subsequent divider drag can mark manual sizing.
      this.chart.setPaneWeight(view.paneIndex, weight);
    }
    view.autoWeight = this.chart.paneWeight(view.paneIndex);
  }

  private recordFootprintTotalsManualResize(eventPaneIndex: number) {
    for (const view of this.footprintTotalsPanes.values()) {
      // A divider event reports either adjacent pane, depending on which side
      // received the pointer. Weight changes are the stable signal.
      if (view.manuallyResized || view.autoWeight === null || Math.abs(view.paneIndex - eventPaneIndex) > 1) continue;
      const weight = this.chart.paneWeight(view.paneIndex);
      if (Math.abs(weight - view.autoWeight) <= Math.max(.001, Math.abs(view.autoWeight) * .005)) continue;
      view.manuallyResized = true;
      view.autoWeight = weight;
    }
  }

  removeFootprintTotalsPane(id: string) {
    const view = this.footprintTotalsPanes.get(id); if (!view) return;
    this.footprintTotalsPanes.delete(id);
    // removePane disposes the anchor series and custom primitive together and
    // emits the index shift used by both native pane registries.
    if (!this.chart.removePane(view.paneIndex)) {
      this.footprintTotalsPanes.set(id, view);
      console.error(`[chart] Could not remove Footprint Totals pane ${id} at index ${view.paneIndex}`);
      return;
    }
    if (this.mode !== 'footprint' && !this.footprintTotalsPanes.size) {
      this.visibleCallbacks.delete(this.footprintRefresh);
      for (const unsubscribe of this.viewSubscriptions) unsubscribe();
      this.viewSubscriptions.length = 0;
      this.footprint = null;
      this.footprintBars = [];
      this.footprintSliceKey = '';
    }
  }

  footprintTotalsPaneIndex(id: string) { return this.footprintTotalsPanes.get(id)?.paneIndex ?? -1; }
  footprintTotalsTooltip(id: string, time: number) { return this.footprintTotalsPanes.get(id)?.primitive.tooltip(time) ?? null; }
  footprintTotalsHover(id: string, time: number, x: number, y: number) {
    const hit = this.footprintTotalsPanes.get(id)?.primitive.hoverSummary(time, x, y);
    const bar = this.footprintBars.find(bar => bar.time === time);
    if (!hit || !bar) return null;
    const other = otherFootprintTotals(this.footprintBars, this.footprint?.stats().map(row => row.time) ?? [], time, hit.units === 'btc' ? 'usdt' : 'btc');
    return { ...hit, other, coverage: bar.coverage, gapBefore: bar.gapBefore };
  }
  footprintTotalsDiagnostics() { return [...this.footprintTotalsPanes.entries()].map(([id, view]) => ({ id, paneIndex: view.paneIndex, autoHeight: view.autoHeight, autoWeight: view.autoWeight, manuallyResized: view.manuallyResized, paneHeight: this.chart.panes()[view.paneIndex]?.base.mediaHeight ?? 0, ...view.primitive.diagnostics() })); }

  setNetPositioningSnapshot(id: string, candles: readonly NetPositioningCandle[], feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>>, units: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>>, pending: number, error = '') {
    const view = this.netPositioningPanes.get(id); if (!view) return;
    view.primitive.setSnapshot(candles); view.primitive.setMetadata(feeds, units, pending, error);
  }
  patchNetPositioning(id: string, candles: readonly NetPositioningCandle[], feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>>, units: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>>, pending: number, error = '') {
    const view = this.netPositioningPanes.get(id); if (!view) return;
    view.primitive.patch(candles); view.primitive.setMetadata(feeds, units, pending, error);
  }
  netPositioningPaneIndex(id: string) { return this.netPositioningPanes.get(id)?.paneIndex ?? -1; }
  netPositioningTooltip(id: string, timeMs: number) { return this.netPositioningPanes.get(id)?.primitive.tooltip(timeMs) ?? null; }
  netPositioningHover(id: string, x: number, y: number) { return this.netPositioningPanes.get(id)?.primitive.hoverSummary(x, y) ?? null; }
  netPositioningDiagnostics() { return [...this.netPositioningPanes.entries()].map(([id, view]) => ({ id, paneIndex: view.paneIndex, ...view.primitive.diagnostics() })); }

  setOrderWalls(settings: OrderWallsSettings, intervalMs: number) {
    if (!settings.enabled) {
      if (this.orderWalls) this.chart.removePrimitive(this.orderWalls);
      this.orderWalls = null;
      return;
    }
    if (!this.orderWalls) {
      this.orderWalls = new OrderWallsPrimitive(settings, intervalMs);
      this.chart.addPrimitive(this.orderWalls, { anchor: 'primary-pane' });
      this.orderWalls.setSnapshot([...this.orderWallSegments.values()], this.orderWallStatus);
    } else {
      this.orderWalls.setSettings(settings);
      this.orderWalls.setInterval(intervalMs);
    }
  }
  setTpo(settings: TpoIndicatorSettings | null) {
    if (!settings) { if (this.tpoProfile) this.chart.removePrimitive(this.tpoProfile); this.tpoProfile = null; return; }
    if (!this.tpoProfile) { this.tpoProfile = new TpoProfilePrimitive(settings); this.chart.addPrimitive(this.tpoProfile, { anchor: 'primary-pane' }); }
    else this.tpoProfile.setSettings(settings);
  }
  setTpoSnapshot(sessions: TpoSession[], naked: TpoNakedLevel[], asOf = 0) { this.tpoProfile?.setSnapshot(sessions, naked, asOf); }
  patchTpo(sessions: TpoSession[], naked: TpoNakedLevel[], asOf = 0) { this.tpoProfile?.patch(sessions, naked, asOf); }
  tpoDiagnostics() { return this.tpoProfile?.diagnostics() ?? { mounted: false }; }
  setOrderWallSnapshot(segments: OrderWallSegment[], status?: OrderWallStatus) {
    this.orderWallSegments.clear();
    for (const segment of segments.slice(-ORDER_WALL_MAX_SEGMENTS)) this.orderWallSegments.set(segment.id, segment);
    this.rebuildOrderWallValueQueue();
    this.orderWallStatus = status ?? { state: 'loading' };
    this.orderWalls?.setSnapshot([...this.orderWallSegments.values()], this.orderWallStatus);
  }
  patchOrderWalls(patches: OrderWallPatch[], status: OrderWallStatus) {
    this.orderWallStatus = status;
    const applied: OrderWallPatch[] = [];
    for (const patch of patches) {
      if (!patch.segment) { this.dropOrderWallSegment(patch.id); applied.push(patch); }
      else {
        const previous = this.orderWallSegments.get(patch.id);
        const incoming = patch.segment.valueRuns ?? [];
        const fullRuns = patch.replaceValueRuns === true || incoming.length > 0 && (!previous || incoming.length > previous.valueRuns.length);
        const segment = { ...patch.segment, valueRuns: fullRuns ? incoming.slice(-ORDER_WALL_MAX_VALUE_RUNS_PER_SEGMENT) : [...(previous?.valueRuns ?? [])] };
        if (previous && fullRuns) this.orderWallValueCount = Math.max(0, this.orderWallValueCount - previous.valueRuns.length);
        if (fullRuns) {
          if (segment.valueRuns.length < incoming.length) segment.valueRunsTruncated = true;
          for (const point of segment.valueRuns) { this.orderWallValueQueue.push({ id: segment.id, point }); this.orderWallValueCount++; }
        } else for (const point of patch.valuePoints ?? []) this.appendOrderWallValue(segment, point);
        this.orderWallSegments.delete(patch.id);
        this.orderWallSegments.set(patch.id, segment);
        applied.push({ ...patch, segment });
      }
    }
    while (this.orderWallSegments.size > ORDER_WALL_MAX_SEGMENTS) this.dropOrderWallSegment(this.orderWallSegments.keys().next().value!);
    this.trimOrderWallValues();
    this.orderWalls?.patch(applied, status);
  }
  setOrderWallStatus(status?: OrderWallStatus) { this.orderWallStatus = status ?? { state: 'loading' }; this.orderWalls?.setStatus(this.orderWallStatus); }
  orderWallAt(x: number, y: number): OrderWallHit | null { return this.orderWalls?.orderWallAt(x, y) ?? null; }
  orderWallsDiagnostics() { return { ...(this.orderWalls?.diagnostics() ?? {}), mounted: Boolean(this.orderWalls),
    retainedSegments: this.orderWallSegments.size, valueRuns: this.orderWallValueCount }; }

  private dropOrderWallSegment(id: string) {
    const segment=this.orderWallSegments.get(id);
    if(segment)this.orderWallValueCount=Math.max(0,this.orderWallValueCount-segment.valueRuns.length);
    this.orderWallSegments.delete(id);
  }

  private rebuildOrderWallValueQueue() {
    const entries = [...this.orderWallSegments.values()].flatMap(segment => segment.valueRuns.map(point => ({ id: segment.id, point })));
    entries.sort((a,b)=>a.point.at-b.point.at);
    this.orderWallValueQueue = entries; this.orderWallValueQueueStart = 0; this.orderWallValueCount = entries.length;
    this.trimOrderWallValues();
  }
  private appendOrderWallValue(segment: OrderWallSegment, point: OrderWallSegment['valueRuns'][number]) {
    const runs = segment.valueRuns, last = runs.at(-1);
    if (last?.at === point.at) {
      if (last.usd === point.usd && last.percentile === point.percentile) return;
      runs[runs.length - 1] = point;
      this.orderWallValueQueue.push({ id: segment.id, point });
    } else if (!last || last.at < point.at) {
      runs.push(point); this.orderWallValueQueue.push({ id: segment.id, point }); this.orderWallValueCount++;
    }
    while (runs.length > ORDER_WALL_MAX_VALUE_RUNS_PER_SEGMENT) { runs.shift(); segment.valueRunsTruncated = true; this.orderWallValueCount--; }
  }
  private trimOrderWallValues() {
    while (this.orderWallValueCount > ORDER_WALL_MAX_VALUE_RUNS) {
      const oldest = this.orderWallValueQueue[this.orderWallValueQueueStart++];
      if (!oldest) break;
      const segment = this.orderWallSegments.get(oldest.id);
      if (segment?.valueRuns[0] === oldest.point) { segment.valueRuns.shift(); segment.valueRunsTruncated = true; this.orderWallValueCount--; }
    }
    if (this.orderWallValueQueueStart > 4_096 && this.orderWallValueQueueStart * 2 > this.orderWallValueQueue.length) {
      this.orderWallValueQueue = this.orderWallValueQueue.slice(this.orderWallValueQueueStart); this.orderWallValueQueueStart = 0;
    }
    if(this.orderWallValueQueue.length>ORDER_WALL_MAX_VALUE_RUNS*2){
      const entries=[...this.orderWallSegments.values()].flatMap(segment=>segment.valueRuns.map(point=>({id:segment.id,point}))).sort((a,b)=>a.point.at-b.point.at);
      this.orderWallValueQueue=entries;this.orderWallValueQueueStart=0;this.orderWallValueCount=entries.length;
      while(this.orderWallValueCount>ORDER_WALL_MAX_VALUE_RUNS){const oldest=this.orderWallValueQueue[this.orderWallValueQueueStart++]!;const segment=this.orderWallSegments.get(oldest.id);if(segment?.valueRuns[0]===oldest.point){segment.valueRuns.shift();segment.valueRunsTruncated=true;this.orderWallValueCount--;}}
    }
  }

  private handleWheel(event: WheelEvent, container: HTMLElement) {
    if (this.disposed || !this.visible || !Number.isFinite(event.deltaY) || (event.target instanceof Element && event.target.closest('.active-indicators'))) return;
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
      if (this.wheelMode === 'tradingview') {
        if (event.ctrlKey || event.metaKey) return; // Native cursor-focused time zoom.
        this.chart.timeScale.zoomAtX(this.chart.timeScale.width, Math.exp(Math.max(-2, Math.min(2, -dy * Math.log(1.1) / 100))));
        event.preventDefault();
        event.stopImmediatePropagation(); // Prevent the native cursor zoom running a second time.
        this.chart.invalidate(mask => mask.invalidateGlobal(InvalidationLevel.Full));
        return;
      }
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
    for (const view of this.netPositioningPanes.values()) view.primitive.setHostSnapshot(candles.slice(-MAX_BARS));
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
    this.series.applyOptions({
      visible: mode === 'candle' && this.basePriceVisible,
      priceLineVisible: mode === 'candle' && this.basePriceVisible,
      lastValueVisible: mode === 'candle' && this.basePriceVisible,
    });
    if (mode === 'footprint') {
      this.ensureFootprintSurface();
      this.footprintTimes = this.footprintBars.map(bar => bar.time);
      this.footprintIndexSeries?.setData(this.footprintBars.map(toExecutionBar), { confirmation: 'forming' });
      this.times = this.footprintTimes;
      const latest = this.footprintBars.at(-1);
      this.latestBar = latest ? toExecutionBar(latest) : null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    } else {
      this.removeFootprintSurface();
      if (!this.footprintTotalsPanes.size) this.footprintBars = [];
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
    if (this.disposed || !this.footprint || (this.mode !== 'footprint' && !this.footprintTotalsPanes.size)) return;
    if (!bars.length && this.pendingView && this.mode === 'footprint' && !this.footprintTotalsPanes.size) return;
    if (this.mode !== 'footprint' || !indexSeries) {
      this.footprintBars = bars.slice(-MAX_BARS).sort((a, b) => a.time - b.time);
      this.footprintSliceKey = '';
      this.enqueueFootprintRefresh();
      return;
    }
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
    if (this.disposed || !patches.length || (this.mode !== 'footprint' && !this.footprintTotalsPanes.size)) return;
    const useSeries = this.mode === 'footprint' && indexSeries !== null;
    let trimmed = false;
    if (retentionStart !== undefined) {
      const cutoff = retentionStart ?? Infinity;
      while (this.footprintBars.length && this.footprintBars[0]!.time < cutoff) {
        this.footprintBars.shift();
        if (useSeries) this.footprintTimes.shift();
        trimmed = true;
      }
      if (trimmed) {
        if (useSeries) {
          this.times = this.footprintTimes;
          indexSeries!.setData(this.footprintBars.map(toExecutionBar), { confirmation: 'forming' });
        }
      }
    }
    for (const footprint of patches) {
      if (useSeries && indexSeries) {
        const index = lowerBound(this.footprintTimes, footprint.time);
        const known = this.footprintTimes[index] === footprint.time;
        const bar = toExecutionBar(footprint);
        const source = footprint.time < this.latestTime ? 'history' : 'live';
        indexSeries.update(bar, { source, confirmation: footprint.time < this.latestTime ? 'confirmed' : 'forming' });
        if (!known) this.footprintTimes.splice(index, 0, footprint.time);
        if (footprint.time >= this.latestTime) { this.latestTime = footprint.time; this.latestBar = bar; }
      }
      const barIndex = lowerBoundFootprint(this.footprintBars, footprint.time);
      if (this.visible && !document.hidden) this.footprintActivity.observe(this.footprintBars[barIndex]?.time === footprint.time ? this.footprintBars[barIndex] : undefined, footprint);
      if (this.footprintBars[barIndex]?.time === footprint.time) this.footprintBars[barIndex] = footprint;
      else this.footprintBars.splice(barIndex, 0, footprint);
    }
    if (this.footprintBars.length > MAX_BARS) {
      this.footprintBars = this.footprintBars.slice(-MAX_BARS);
      if (useSeries && indexSeries) {
        this.footprintTimes = this.footprintBars.map(bar => bar.time);
        this.times = this.footprintTimes;
        indexSeries.setData(this.footprintBars.map(toExecutionBar), { confirmation: 'forming' });
        this.latestBar = this.footprintBars.length ? toExecutionBar(this.footprintBars.at(-1)!) : null;
        this.latestTime = this.latestBar?.time ?? -Infinity;
      }
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
    for (const view of this.netPositioningPanes.values()) view.primitive.patchHostCandles(candles);
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
    this.chart.timeScale.setBarSpacing(112);
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
    if (this.disposed || !this.footprint || (this.mode !== 'footprint' && !this.footprintTotalsPanes.size)) return;
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
    const stats = this.footprint.stats();
    for (const view of this.footprintTotalsPanes.values()) view.primitive.setStats(stats);
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
    for (const view of this.footprintTotalsPanes.values()) view.primitive.setStats([]);
    this.stats.footprintSets++;
  }

  private syncDrawingAxisLabels() {
    for (const primitive of this.drawingAxisLabels) this.chart.removePrimitive(primitive);
    this.drawingAxisLabels.length = 0;
    this.chart.panes().forEach((_, paneIndex) => {
      const primitive = new DrawingAxisPriceLabels(this.drawings, paneIndex, this.drawingPreviews);
      this.drawingAxisLabels.push(primitive);
      this.chart.addPrimitive(primitive, paneIndex);
    });
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
    this.ensureFootprintStatsModel();
    this.chart.addPrimitive(this.footprint!);
    this.chart.addPrimitive(this.footprintScaleFloor);
    this.chart.addPrimitive(this.footprintActivity);
    this.ensureFootprintRefreshSubscriptions();
  }

  private ensureFootprintStatsModel() {
    if (this.footprint) return;
    this.footprint = new TerminalFootprint(this.footprintOptions);
    this.footprint.setCellOpacity(this.footprintOpacity);
  }

  private ensureFootprintRefreshSubscriptions() {
    if (this.viewSubscriptions.length) return;
    this.viewSubscriptions.push(
      this.chart.on('pan', () => this.enqueueFootprintRefresh()),
      this.chart.on('zoom', () => this.enqueueFootprintRefresh()),
      this.chart.on('paneResized', () => this.enqueueFootprintRefresh()),
      this.chart.on('data:update', () => this.enqueueFootprintRefresh()),
    );
  }

  private removeFootprintSurface() {
    this.visibleCallbacks.delete(this.footprintRefresh);
    if (!this.footprintTotalsPanes.size) { for (const unsubscribe of this.viewSubscriptions) unsubscribe(); this.viewSubscriptions.length = 0; }
    if (this.footprint) this.chart.removePrimitive(this.footprint);
    this.chart.removePrimitive(this.footprintScaleFloor);
    this.chart.removePrimitive(this.footprintActivity);
    this.footprintActivity.clear();
    if (!this.footprintTotalsPanes.size) this.footprint = null;
    this.footprintIndexSeries?.remove();
    this.footprintIndexSeries = null;
  }

  onFootprintViewport?: (from:number,to:number)=>void;
  onHeatmapViewport?: (viewport:import('../feed/staging-heatmap').HeatmapViewport)=>void;
  draw() {
    if (!this.visible || document.hidden || this.disposed) return;
    const visibleCallbacks = [...this.visibleCallbacks.values()];
    this.visibleCallbacks.clear();
    for (const callback of visibleCallbacks) callback();
    if((this.mode==='footprint'||this.footprintTotalsPanes.size)&&this.onFootprintViewport){const times=this.visibleTimeRange();if(times)this.onFootprintViewport(Math.floor(times.from*1000),Math.ceil(times.to*1000));}
    if((this.heatmap||this.orderWalls)&&this.onHeatmapViewport){const times=this.visibleTimeRange(),prices=this.chart.panes()[this.chart.primaryPaneIndex()]?.priceScale.priceRange();if(times&&prices)this.onHeatmapViewport({from:Math.floor(times.from*1000),to:Math.ceil(times.to*1000),low:prices.min,high:prices.max,width:this.container.clientWidth,height:this.container.clientHeight});}
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
    this.resizeSubscription?.();
    this.resizeSubscription = undefined;
    for (const unsubscribe of this.footprintTotalsSizeSubscriptions) unsubscribe();
    this.footprintTotalsSizeSubscriptions.length = 0;
    for (const unsubscribe of this.drawingSubscriptions) unsubscribe();
    this.drawingSubscriptions.length = 0;
    for (const primitive of this.drawingAxisLabels) this.chart.removePrimitive(primitive);
    this.drawingAxisLabels.length = 0;
    this.drawingPreviews.clear();
    this.objects.destroy();
    this.scopedDrawings.destroy();
    this.drawings.destroy();
    for (const id of [...this.netPositioningPanes.keys()]) this.removeNetPositioningPane(id);
    this.removeFootprintSurface();
    if (this.heatmap) this.chart.removePrimitive(this.heatmap);
    this.heatmap = null;
    if (this.orderWalls) this.chart.removePrimitive(this.orderWalls);
    this.orderWalls = null;
    this.chart.removePrimitive(this.watchZones);
    this.chart.removePrimitive(this.axisGrid);
    this.chart.removePrimitive(this.executionHoverRay);
    this.chart.destroy();
    this.callbacks.clear();
    this.visibleCallbacks.clear();
    this.times = [];
    this.scheduler.remove(this);
  }
}

/** A corrupt drawing record must never be silently replaced by an empty save. */
function safeDrawingStore(): DrawingDocumentStore {
  let storage: Storage;
  try { storage = window.localStorage; } catch { return memoryDrawingStore(); }
  const read = (key: string): unknown => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new Error('Stored drawings are not valid JSON; preserving the original record.'); }
    const legacy = Array.isArray(value);
    const document = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (!legacy && (!document || !Array.isArray(document.drawings) || ![1, 2, 3].includes(Number(document.version)))) {
      throw new Error('Stored drawings do not match a supported document; preserving the original record.');
    }
    return value;
  };
  return {
    get: read,
    set(key: string, document: Parameters<DrawingDocumentStore['set']>[1]) {
      read(key);
      storage.setItem(key, JSON.stringify(document));
      return true;
    },
    remove(key: string) { read(key); storage.removeItem(key); },
  };
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

import {
  createChart,
  darkTheme,
  epochMsToUtcSeconds,
  type Bar,
  type Chart as OpenAlgoChart,
  type RendererChoice,
  type SeriesApi,
} from 'openalgo-charts';
import type { Candle } from '../feed/protocol';
import { MAX_BARS } from '../feed/reconcile';
import { formatPrice } from './format';
import type { Scheduler } from './scheduler';

const theme = {
  ...darkTheme,
  background: '#090909',
  grid: '#1d1d1d',
  axisText: '#858585',
  axisLine: '#292929',
  paneSeparator: '#292929',
  crosshair: '#777777',
  crosshairLabelBackground: '#202020',
  upColor: '#58a65c',
  downColor: '#ad5858',
  wickUpColor: '#58a65c',
  wickDownColor: '#ad5858',
  lastPriceUp: '#58a65c',
  lastPriceDown: '#ad5858',
  lastPriceText: '#c7c7c7',
};

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

/** Owns the chart engine while routing its frames through the shared visible-panel scheduler. */
export class OpenAlgoCandleChart {
  visible = false;
  readonly chart: OpenAlgoChart;
  readonly series: SeriesApi;
  readonly stats = { draws: 0 };
  private readonly callbacks = new Map<number, () => void>();
  private times: number[] = [];
  private nextFrame = 0;
  private disposed = false;
  private latestTime = -Infinity;
  private latestBar: Bar | null = null;

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
      theme,
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
      grid: { spacing: 90, vertColor: '#1d1d1d', horzColor: '#1d1d1d', lineWidth: 1 },
      timeScale: { barSpacing: 7, minBarSpacing: 3, maxBarSpacing: 40, rightOffset: 5 },
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
        upColor: '#58a65c',
        downColor: '#ad5858',
        borderUpColor: '#58a65c',
        borderDownColor: '#ad5858',
        wickUpColor: '#58a65c',
        wickDownColor: '#ad5858',
        priceLineVisible: true,
        lastValueVisible: true,
        colorByPreviousClose: false,
      },
    });
  }

  setSnapshot(candles: Candle[], preserveView = true) {
    if (this.disposed) return;
    const oldRange = preserveView ? this.chart.getVisibleLogicalRange() : null;
    const anchorIndex = oldRange && this.times.length
      ? Math.max(0, Math.min(this.times.length - 1, Math.round(oldRange.to)))
      : -1;
    const anchorTime = anchorIndex >= 0 ? this.times[anchorIndex] : null;
    const fromOffset = oldRange && anchorIndex >= 0 ? oldRange.from - anchorIndex : 0;
    const toOffset = oldRange && anchorIndex >= 0 ? oldRange.to - anchorIndex : 0;
    const bars = candles.slice(-MAX_BARS).map(toBar);
    if (bars.length) {
      this.series.setData(bars, {
        confirmation: candles.at(-1)?.closed ? 'confirmed' : 'forming',
      });
    } else this.series.setData([]);
    this.times = bars.map(bar => bar.time);
    this.latestBar = bars.at(-1) ?? null;
    this.latestTime = this.latestBar?.time ?? -Infinity;
    if (oldRange && anchorTime !== null && bars.length) {
      const anchorPosition = lowerBound(this.times, anchorTime);
      const nearest = Math.max(0, Math.min(this.times.length - 1, anchorPosition));
      this.chart.setVisibleLogicalRange({
        from: nearest + fromOffset,
        to: nearest + toOffset,
      });
    }
  }

  applyPatch(candles: Candle[]) {
    if (this.disposed || !candles.length) return;
    let trim = false;
    for (const candle of candles) {
      const bar = toBar(candle);
      const at = lowerBound(this.times, bar.time);
      const isKnown = this.times[at] === bar.time;
      const source = bar.time < this.latestTime ? 'history' : 'live';
      this.series.update(bar, {
        source,
        confirmation: candle.closed ? 'confirmed' : 'forming',
      });
      if (!isKnown) {
        this.times.splice(at, 0, bar.time);
        trim ||= this.times.length > MAX_BARS;
      }
      if (bar.time >= this.latestTime) {
        this.latestTime = bar.time;
        this.latestBar = bar;
      }
    }
    if (trim) {
      const bounded = this.series.getData().slice(-MAX_BARS);
      this.series.setData(bounded);
      this.times = bounded.map(bar => bar.time);
      this.latestBar = bounded.at(-1) ?? null;
      this.latestTime = this.latestBar?.time ?? -Infinity;
    }
  }

  resetView() { this.chart.resetScale(); }

  setRange(range: { from: number; to: number }) { this.chart.setVisibleLogicalRange(range); }
  visibleRange() { return this.chart.getVisibleLogicalRange(); }
  zoom(factor: number) { this.chart.timeScale.setBarSpacing(this.chart.timeScale.barSpacing * factor); }

  latestCandle() { return this.latestBar; }
  get barCount() { return this.times.length; }
  get backend() { return this.chart.rendererKind; }

  draw() {
    if (!this.visible || document.hidden || this.disposed) return;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
      this.stats.draws++;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.chart.destroy();
    this.callbacks.clear();
    this.times = [];
    this.scheduler.remove(this);
  }
}

export type { Bar };

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

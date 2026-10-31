import type { Chart, IPrimitive, PriceScaleId, PrimitiveHost, PrimitiveRenderContext, SeriesApi } from 'openalgo-charts';
import { InvalidationLevel } from 'openalgo-charts';
import { anchorTimeAxisToPrimary } from '../chart/primary-time-axis';
import { PANE_HEADER_ACTION_SPACE, paneHeaderSlots } from '../chart/pane-header';
import { duration, type Candle, type Series } from '../feed/protocol';
import type { Scheduler, Drawable } from '../chart/scheduler';
import { RAW_OPEN_INTEREST_VENUES, type RawOpenInterestVenue } from '../feed/raw-open-interest';
import { openInterestSettings, openInterestVenueLabel, type OpenInterestDataController, type OpenInterestFrame, type OpenInterestPoint, type OpenInterestSettings } from './open-interest-data';
import { OpenInterestControls } from './open-interest-controls';
import { getDisplayTimezone } from '../timezone';
import { TooltipDwell } from '../tooltip-dwell';

const colors: Record<string, string> = { total: '#d6d6d6', binance: '#d9ae63', hyperliquid: '#82a7d8', bybit: '#86b17b' };

class OpenInterestLines implements IPrimitive {
  private host?: PrimitiveHost;
  draws = 0;
  segments = 0;
  constructor(private readonly frame: () => OpenInterestFrame, private readonly settings: () => OpenInterestSettings,
    private readonly range: () => { from: number; to: number }, private readonly intervalMs: () => number, private readonly foreground: () => string) {}
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  update() { this.host?.requestUpdate(); }
  autoscaleInfo() {
    let min = Infinity, max = -Infinity; const range = this.range(), settings = this.settings();
    for (const [id, line] of this.frame().lines) {
      if (settings.hidden.includes(id)) continue;
      const start = lowerBound(line.points, range.from, point => point.time);
      for (let index = Math.max(0, start - 1); index < line.points.length; index++) {
        const point = line.points[index]!; if (point.time > range.to) break;
        if (point.value !== null && Number.isFinite(point.value)) { min = Math.min(min, point.value); max = Math.max(max, point.value); }
      }
    }
    return min === Infinity ? { min: 0, max: 1 } : min === max ? { min: min * .99, max: max * 1.01 } : { min, max };
  }
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.draws++; this.segments = 0;
    const frame = this.frame(), settings = this.settings(), range = this.range();
    ctx.save(); ctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth, rc.plotHeight); ctx.clip();
    const lines = [...frame.lines.values()].sort((a, b) => Number(a.id === 'total') - Number(b.id === 'total'));
    for (const line of lines) {
      if (settings.hidden.includes(line.id)) continue;
      ctx.strokeStyle = line.id === 'total' ? this.foreground() : colors[line.id] ?? '#9da4ad';
      ctx.lineWidth = line.id === 'total' ? 1.8 : 1.1; ctx.globalAlpha = line.id === 'total' ? 1 : .78;
      const start = lowerBound(line.points, range.from, point => point.time); let previous: OpenInterestPoint | undefined;
      for (let index = Math.max(0, start - 1); index < line.points.length; index++) {
        const point = line.points[index]!; if (point.time > range.to) break;
        if (point.value === null) { previous = undefined; continue; }
        if (previous && previous.value !== null && point.time - previous.time <= this.intervalMs()) {
          const x1 = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(previous.time / 1000));
          const x2 = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(point.time / 1000));
          const y1 = rc.priceScale.priceToY(previous.value!), y2 = rc.priceScale.priceToY(point.value);
          if ([x1, x2, y1, y2].every(Number.isFinite)) {
            ctx.setLineDash(point.quality === 'partial' || previous.quality === 'partial' ? [3, 3] : []);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); this.segments++;
          }
        }
        previous = point;
      }
    }
    ctx.restore();
  }
}

export class OpenInterestView implements Drawable {
  visible = true;
  private dead = false;
  private combinedChrome = false;
  private settings = openInterestSettings(undefined);
  private series: Series;
  private anchor: SeriesApi;
  private pane: HTMLElement;
  private primitive: OpenInterestLines;
  private toolbar = document.createElement('div');
  private legend = document.createElement('div');
  private status = document.createElement('div');
  private provenance = document.createElement('details');
  private tooltip = document.createElement('div');
  readonly controls: OpenInterestControls;
  private abort = new AbortController();
  private listeners: (() => void)[] = [];
  private releaseDataListener?: () => void;
  private hostCandles: readonly Candle[] = [];
  private assignedScaleId: PriceScaleId;
  private ownsPaneWeight: boolean;
  private hoverTime?: number;
  private hoverPaneIndex?: number;
  private hoverPointerType?: string;
  private hoverPointerDown = false;
  private tooltipBlockedUntilMove = false;
  private paneHoverAbort?: AbortController;
  private tooltipDwell = new TooltipDwell();
  private lastLegendKey = '';
  private paneControlHome?: HTMLElement;

  constructor(private readonly chart: Chart, private readonly scheduler: Scheduler, series: Series,
    private readonly change: (settings: OpenInterestSettings) => void, private readonly data: OpenInterestDataController,
    private readonly scaleId: PriceScaleId, initialPaneIndex = -1, preservePaneLayout = false) {
    this.series = series; this.assignedScaleId = scaleId; this.ownsPaneWeight = (initialPaneIndex < 0 || initialPaneIndex >= chart.panes().length) && !preservePaneLayout;
    const index = initialPaneIndex >= 0 && initialPaneIndex <= chart.panes().length ? initialPaneIndex : chart.panes().length; this.anchor = this.createAnchor(index, []);
    this.pane = chart.panes()[index]!.element; this.pane.dataset.openInterest = 'true'; if (this.ownsPaneWeight) chart.setPaneWeight(index, this.settings.paneWeight);
    this.anchor.priceScale().setOptions({ marginTop: .16, marginBottom: .12, minMove: 0, minPrecision: 2 });
    this.primitive = new OpenInterestLines(() => this.data.viewFrame(), () => this.settings, () => this.visibleRange(), () => duration[this.series.interval], () => getComputedStyle(this.pane).getPropertyValue('--text').trim() || '#c7c7c7');
    chart.addPrimitive(this.primitive, index); chart.panes()[index]?.bindPrimitiveScale(this.primitive, scaleId);
    this.toolbar.className = 'open-interest-toolbar'; this.toolbar.setAttribute('role', 'group'); this.toolbar.setAttribute('aria-label', 'Open Interest controls');
    const title = document.createElement('span'); title.className = 'open-interest-title'; title.textContent = 'Open Interest';
    const unit = document.createElement('span'); unit.className = 'open-interest-unit'; unit.textContent = 'BTC';
    const settingsButton = document.createElement('button'); settingsButton.type = 'button'; settingsButton.textContent = 'Sources'; settingsButton.className = 'open-interest-action';
    settingsButton.setAttribute('aria-label', 'Select Open Interest venues'); settingsButton.addEventListener('click', event => { event.stopPropagation(); this.openSettings(); }, { signal: this.abort.signal });
    this.legend.className = 'open-interest-legend'; this.legend.setAttribute('role', 'group'); this.legend.setAttribute('aria-label', 'Open Interest line visibility');
    this.status.className = 'open-interest-status'; this.status.setAttribute('role', 'status');
    this.provenance.className = 'open-interest-provenance'; const summary = document.createElement('summary'); summary.textContent = 'Source and coverage'; this.provenance.append(summary);
    this.tooltip.className = 'open-interest-tooltip'; this.tooltip.hidden = true; this.tooltip.setAttribute('role', 'tooltip');
    this.toolbar.append(title, unit, settingsButton, this.legend, this.provenance);
    this.pane.append(this.toolbar, this.status, this.tooltip);
    this.bindPaneHoverEvents(this.pane);
    this.controls = new OpenInterestControls(settings => this.change(settings), this.abort.signal); document.body.append(this.controls.dialog);
    for (const element of [this.toolbar, this.controls.dialog]) for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'keydown'])
      element.addEventListener(type, event => event.stopPropagation(), { signal: this.abort.signal });
    this.legend.addEventListener('click', event => {
      event.stopPropagation(); const id = (event.target as Element).closest<HTMLElement>('[data-line]')?.dataset.line; if (!id) return;
      this.change({ ...this.settings, hidden: this.settings.hidden.includes(id) ? this.settings.hidden.filter(key => key !== id) : [...this.settings.hidden, id] });
    }, { signal: this.abort.signal });
    this.releaseDataListener = data.subscribe(() => this.invalidate());
    this.listeners.push(chart.subscribeCrosshairMove(event => {
      this.hoverTime = event.time == null ? undefined : event.time * 1000;
      this.hoverPaneIndex = event.paneIndex ?? undefined;
      if (!this.visible || this.combinedChrome || this.hoverPaneIndex !== this.paneIndex() || this.hoverTime === undefined || this.hoverPointerType === 'touch' || this.hoverPointerDown || this.tooltipBlockedUntilMove) this.cancelTooltip();
      else {
        const ready = this.tooltipDwell.request('open-interest', () => {
          if (this.dead || !this.visible || this.combinedChrome || this.hoverPaneIndex !== this.paneIndex() || this.hoverTime === undefined || this.hoverPointerType === 'touch' || this.hoverPointerDown || this.tooltipBlockedUntilMove) return;
          this.tooltip.hidden = false; this.scheduler.invalidate(this);
        });
        this.tooltip.hidden = !ready;
      }
      this.scheduler.invalidate(this);
    }), chart.on('pan', () => this.invalidate()), chart.on('zoom', () => this.invalidate()), chart.on('resize', () => this.invalidate()), chart.on('paneResized', event => {
      if (!this.ownsPaneWeight || event.paneIndex !== this.paneIndex()) return;
      const paneWeight = this.chart.paneWeight(this.paneIndex()); if (Math.abs(paneWeight - this.settings.paneWeight) > .001) this.change({ ...this.settings, paneWeight });
    }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelTooltip(); }, { signal: this.abort.signal });
    anchorTimeAxisToPrimary(chart);
  }

  paneIndex() { return this.chart.panes().findIndex(pane => pane.element === this.pane); }
  paneElement() { return this.pane; }
  paneControlElement() { return this.toolbar; }
  /** Reuse the native toolbar inside the indicator header at every pane width. */
  setPaneControlHost(home: HTMLElement | null) {
    if (home === this.paneControlHome && this.toolbar.parentElement === home) return;
    if (home) {
      this.paneControlHome = home; this.toolbar.dataset.paneHeader = 'true'; home.append(this.toolbar);
      for (const property of ['left', 'top', 'right', 'max-width']) this.toolbar.style.removeProperty(property);
    } else if (this.paneControlHome) {
      delete this.toolbar.dataset.paneHeader; this.pane.append(this.toolbar); this.paneControlHome = undefined; this.invalidate();
    }
  }
  moveToPaneIndex(paneIndex: number) {
    if (this.dead) return false;
    const oldIndex = this.paneIndex(), panes = this.chart.panes(); if (oldIndex < 0 || paneIndex < 0 || paneIndex > panes.length) return false;
    if (oldIndex === paneIndex) return true;
    this.cancelTooltip();
    const targetElement = panes[paneIndex]?.element, previousPane = this.pane;
    this.chart.removePrimitive(this.primitive); this.anchor.remove(); previousPane.removeAttribute('data-open-interest');
    const existingTargetIndex = targetElement ? this.chart.panes().findIndex(pane => pane.element === targetElement) : -1;
    const targetIndex = existingTargetIndex >= 0 ? existingTargetIndex : this.chart.panes().length;
    this.anchor = this.createAnchor(targetIndex, this.hostCandles);
    const actualIndex = existingTargetIndex >= 0 ? this.chart.panes().findIndex(pane => pane.element === targetElement) : this.chart.panes().length - 1;
    this.pane = this.chart.panes()[actualIndex]!.element; this.ownsPaneWeight = !targetElement;
    this.bindPaneHoverEvents(this.pane);
    if (this.ownsPaneWeight) this.chart.setPaneWeight(actualIndex, this.settings.paneWeight);
    this.pane.dataset.openInterest = 'true';
    this.chart.addPrimitive(this.primitive, actualIndex); this.chart.panes()[actualIndex]?.bindPrimitiveScale(this.primitive, this.assignedScaleId);
    this.pane.append(this.toolbar, this.status, this.tooltip); anchorTimeAxisToPrimary(this.chart); this.invalidate(); return true;
  }
  configure(value: unknown, series: Series) {
    const previous = this.settings, previousSeries = this.series; this.settings = openInterestSettings(value); this.series = series;
    const settingsChanged = JSON.stringify(previous) !== JSON.stringify(this.settings);
    if (settingsChanged || previousSeries.venue !== series.venue || previousSeries.market !== series.market || previousSeries.interval !== series.interval) this.cancelTooltip();
    const index = this.paneIndex(); this.anchor.priceScale().setPriceFormatter(formatOpenInterest);
    this.anchor.priceScale().setAutoScale(true);
    if (index >= 0) { this.chart.setPriceAxisPlacement(index, this.assignedScaleId, 'right'); if (this.ownsPaneWeight && Math.abs(this.chart.paneWeight(index) - this.settings.paneWeight) > .001) this.chart.setPaneWeight(index, this.settings.paneWeight); }
    if (settingsChanged) this.lastLegendKey = '';
    this.invalidate();
  }
  setHostCandles(candles: readonly Candle[]) {
    const key = `${candles.length}:${candles[0]?.t}:${candles.at(-1)?.t}`;
    if ((this.hostCandles.length ? `${this.hostCandles.length}:${this.hostCandles[0]?.t}:${this.hostCandles.at(-1)?.t}` : '') === key) return;
    this.hostCandles = candles; this.anchor.setData(candles.map(candle => ({ time: candle.t / 1000, open: 0, high: 0, low: 0, close: 0, volume: 0 })));
    this.invalidate();
  }
  setVisible(value: boolean) { this.visible = value; if (!value) this.cancelTooltip(); if (value) this.invalidate(); }
  /** Let the managed Order Flow pane own shared chrome while leaving this view's settings available. */
  setCombinedChrome(value: boolean) {
    this.combinedChrome = value; this.toolbar.hidden = value; this.status.hidden = value; this.cancelTooltip(); this.provenance.hidden = value;
    if (!value) this.invalidate();
  }
  openSettings() { this.cancelTooltip(); this.controls.open(this.settings); }
  private createAnchor(paneIndex: number, candles: readonly Candle[]) {
    const anchor = this.chart.addSeries('line', { paneIndex, priceScaleId: this.assignedScaleId, style: { visible: false } });
    anchor.setData(candles.map(candle => ({ time: candle.t / 1000, open: 0, high: 0, low: 0, close: 0, volume: 0 })));
    anchor.priceScale().setOptions({ marginTop: .16, marginBottom: .12, minMove: 0, minPrecision: 2 });
    anchor.priceScale().setPriceFormatter(formatOpenInterest); return anchor;
  }
  private visibleRange() { const range = this.chart.timeScale.visibleRange(); return { from: this.chart.dataLayer.indexToTimeFloat(range.from - 1) * 1000, to: this.chart.dataLayer.indexToTimeFloat(range.to + 1) * 1000 }; }
  private invalidate() { if (!this.dead) { this.primitive.update(); this.scheduler.invalidate(this); } }
  private cancelTooltip() { this.tooltipDwell.clear(); this.tooltip.hidden = true; }
  private bindPaneHoverEvents(pane: HTMLElement) {
    this.paneHoverAbort?.abort(); const hoverAbort = this.paneHoverAbort = new AbortController(), signal = hoverAbort.signal;
    pane.addEventListener('pointermove', event => { this.hoverPointerType = event.pointerType; if (!this.hoverPointerDown) this.tooltipBlockedUntilMove = false; }, { signal });
    pane.addEventListener('pointerleave', () => { this.hoverPointerType = undefined; this.cancelTooltip(); }, { signal });
    pane.addEventListener('pointerdown', () => { this.hoverPointerDown = true; this.tooltipBlockedUntilMove = true; this.cancelTooltip(); }, { capture: true, signal });
    pane.addEventListener('pointerup', () => { this.hoverPointerDown = false; }, { capture: true, signal });
    pane.addEventListener('wheel', () => { this.tooltipBlockedUntilMove = true; this.cancelTooltip(); }, { capture: true, passive: true, signal });
    pane.addEventListener('click', () => this.cancelTooltip(), { capture: true, signal });
  }
  draw() {
    if (this.dead || !this.visible) return;
    const frame = this.data.viewFrame(), lines = [...frame.lines.values()];
    const key = JSON.stringify([lines.map(line => line.id), this.settings.venues, this.settings.hidden]);
    if (key !== this.lastLegendKey) {
      this.legend.replaceChildren();
      for (const line of lines) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'open-interest-line'; button.dataset.line = line.id;
        button.style.setProperty('--source-color', line.id === 'total' ? 'var(--text)' : colors[line.id] ?? '#9da4ad');
        this.legend.append(button);
      }
      this.lastLegendKey = key;
    }
    const range = this.chart.plotRect(this.paneIndex());
    if (range && this.toolbar.dataset.paneHeader !== 'true') this.toolbar.style.right = `${Math.max(6, this.pane.clientWidth - range.left - range.width + PANE_HEADER_ACTION_SPACE)}px`;
    if (range && this.toolbar.dataset.paneHeader !== 'true') this.toolbar.style.maxWidth = `${paneHeaderSlots(range.width, 520).optionsWidth}px`;
    for (const line of lines) {
      const button = this.legend.querySelector<HTMLButtonElement>(`[data-line="${line.id}"]`); if (!button) continue;
      const point = line.points.at(-1), hidden = this.settings.hidden.includes(line.id);
      const age = point?.ageMs === null || point?.ageMs === undefined ? '' : ` · ${formatAge(point.ageMs)}`;
      const text = `${line.id === 'total' ? 'Total' : venueLabel(line.id as RawOpenInterestVenue)} ${formatOpenInterest(point?.value ?? null)}${line.id === 'total' ? ' BTC' : ''}${age}`;
      button.textContent = text; button.setAttribute('aria-pressed', String(!hidden)); button.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} line: ${line.name}`);
      button.style.setProperty('--source-color', line.id === 'total' ? 'var(--text)' : colors[line.id] ?? '#9da4ad');
      button.title = `${line.name} · ${formatOpenInterest(point?.value ?? null)} BTC${age} · line visibility does not change venue inclusion`;
    }
    const statusText = !this.settings.venues.length ? 'Choose at least one exchange.'
      : frame.quality === 'complete' ? frame.truncated ? 'Some earlier data may be missing.' : ''
        : frame.quality === 'partial' ? `Some exchange data is missing.${frame.truncated ? ' Earlier data may also be missing.' : ''}`
          : frame.quality === 'stale' ? 'Updates paused.' : 'Data unavailable.';
    this.status.textContent = statusText; this.status.hidden = !statusText;
    this.status.dataset.quality = frame.quality; this.status.title = statusText;
    this.provenance.querySelectorAll(':scope > div').forEach(node => node.remove());
    for (const venue of this.settings.venues) {
      const feed = frame.feeds[venue], item = document.createElement('div');
      item.textContent = `${venueLabel(venue)} · ${feed?.source ?? 'source pending'} · ${feed?.unitVerification?.status ?? 'unit unknown'} ${feed?.unitVerification?.units ?? ''} · ${feed?.lastError ?? frame.history}`;
      this.provenance.append(item);
    }
    const latestTime = Math.max(0, ...lines.map(line => line.points.at(-1)?.time ?? 0)), time = this.hoverTime ?? latestTime;
    if (!this.tooltip.hidden) {
      this.tooltip.replaceChildren(); const stamp = document.createElement('div'); stamp.className = 'open-interest-tooltip-header';
      stamp.textContent = time ? new Date(time).toLocaleString('en-GB', { timeZone: getDisplayTimezone() }) : 'Waiting for host candles'; this.tooltip.append(stamp);
      for (const line of lines.filter(item => !this.settings.hidden.includes(item.id))) {
        const point = pointAt(line.points, time), row = document.createElement('div'), label = document.createElement('span'), value = document.createElement('span');
        label.textContent = line.name; value.textContent = `${formatOpenInterest(point?.value ?? null)} BTC${point?.ageMs === null || point?.ageMs === undefined ? '' : ` · ${formatAge(point.ageMs)} old`}`;
        row.className = 'open-interest-tooltip-row'; row.append(label, value); this.tooltip.append(row);
      }
      const note = document.createElement('small'); note.textContent = `${frame.quality} · raw source time retained; no interpolation`; this.tooltip.append(note);
    }
    this.chart.invalidate(mask => mask.invalidatePane(this.paneIndex(), { level: InvalidationLevel.Full, autoScale: true }));
  }
  diagnostics() { return { paneIndex: this.paneIndex(), quality: this.data.viewFrame().quality, lines: [...this.data.viewFrame().lines].map(([id, line]) => ({ id, latest: line.points.at(-1) })), draws: this.primitive.draws, segments: this.primitive.segments }; }
  dispose() {
    if (this.dead) return; this.tooltipDwell.dispose(); this.paneHoverAbort?.abort(); this.dead = true; this.releaseDataListener?.(); this.abort.abort(); this.listeners.forEach(release => release()); this.scheduler.remove(this);
    this.chart.removePrimitive(this.primitive); this.toolbar.remove(); this.status.remove(); this.tooltip.remove(); this.provenance.remove(); this.anchor.remove();
    this.controls.dispose(); this.pane.removeAttribute('data-open-interest'); anchorTimeAxisToPrimary(this.chart);
  }
}

function venueLabel(venue: RawOpenInterestVenue) { return openInterestVenueLabel(venue); }
function formatOpenInterest(value: number | null) { return value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value); }
function formatAge(value: number) { return value < 1_000 ? '<1s' : `${Math.floor(value / 1_000)}s`; }
function lowerBound<T>(values: readonly T[], time: number, get: (item: T) => number) { let low = 0, high = values.length; while (low < high) { const middle = (low + high) >>> 1; if (get(values[middle]!) < time) low = middle + 1; else high = middle; } return low; }
function pointAt(points: readonly OpenInterestPoint[], time: number) { let index = lowerBound(points, time, point => point.time); if (points[index]?.time !== time) index--; return points[index]; }

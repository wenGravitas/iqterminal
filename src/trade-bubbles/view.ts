import type { Chart, CrosshairMoveEvent } from 'openalgo-charts';
import type { FeedClient } from '../feed/client';
import type { Series } from '../feed/protocol';
import type { NormalizedExecution } from '../feed/footprint';
import { compactSize } from '../ticker/presentation';
import { TradeBubblesPrimitive, type TradeBubbleHit } from '../chart/trade-bubbles';
import type { TradeBubbleBatch, TradeBubbleRecord, TradeBubbleSettings } from './model';
import { resolveTradeBubbleSources, tradeBubbleSettings } from './model';
import { TradeBubbleControls, type TradeTickerTierSource } from './controls';

const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export class TradeBubblesView {
  private dead = false;
  private visible = true;
  private hostVisible = true;
  private settings = tradeBubbleSettings(undefined);
  private series: Series;
  private resolution = resolveTradeBubbleSources(this.settings, { venue: 'binance', market: 'perpetual', interval: '1m' });
  private records = new Map<string, TradeBubbleRecord>();
  private status?: TradeBubbleBatch['status'];
  private subscriptionKey = '';
  private release?: () => void;
  private primitive = new TradeBubblesPrimitive();
  private tooltip = document.createElement('div');
  private statusNode = document.createElement('div');
  private controls: TradeBubbleControls;
  private listeners: Array<() => void> = [];
  private controlsAbort = new AbortController();
  private lastStatusText = '';

  constructor(
    private host: HTMLElement,
    private chart: Chart,
    private feed: FeedClient,
    series: Series,
    private change: (settings: TradeBubbleSettings) => void,
    private tickerTierSources: () => TradeTickerTierSource[],
    private feedSubscriptionId: string,
  ) {
    this.series = series;
    this.primitive.setSettings(this.settings);
    this.chart.addPrimitive(this.primitive, { anchor: 'primary-pane' });
    this.tooltip.className = 'trade-bubbles-tooltip net-positioning-tooltip'; this.tooltip.hidden = true; this.tooltip.setAttribute('role', 'tooltip');
    this.statusNode.className = 'trade-bubbles-status'; this.statusNode.setAttribute('role', 'status'); this.statusNode.setAttribute('aria-live', 'polite');
    host.append(this.tooltip); const footer = host.closest<HTMLElement>('.candle-panel')?.querySelector<HTMLElement>('.chart-footer'); footer?.append(this.statusNode);
    this.controls = new TradeBubbleControls(host.closest<HTMLElement>('.candle-panel') ?? host, this.controlsAbort.signal, tickerTierSources, change);
    this.listeners.push(chart.subscribeCrosshairMove(event => this.crosshair(event)));
    this.configure(this.settings, series);
  }

  configure(value: unknown, series: Series) {
    const previousKey = this.subscriptionKey;
    this.settings = tradeBubbleSettings(value); this.series = series;
    this.resolution = resolveTradeBubbleSources(this.settings, series);
    this.primitive.setSettings(this.settings);
    this.primitive.setEnabled(this.visible && this.hostVisible && this.resolution.state === 'compatible');
    const nextKey = JSON.stringify([this.resolution.compatible, this.resolution.state, this.settings]);
    if (nextKey !== previousKey) {
      this.records.clear(); this.status = undefined;
      this.subscriptionKey = nextKey;
      const request = { series: { ...series }, settings: this.settings };
      if (this.release) this.feed.updateTradeBubbles(this.feedSubscriptionId, request);
      else this.release = this.feed.subscribeTradeBubbles(this.feedSubscriptionId, request, event => this.receive(event));
      this.renderRecords();
    }
    this.renderStatus();
  }

  private recordsSources() {
    return [...new Set([...this.records.values()].map(record => `${record.execution.venue}:${record.execution.market}`))];
  }

  private receive(event: TradeBubbleBatch) {
    if (this.dead) return;
    if (event.snapshot) this.records = new Map(event.records.map(record => [record.id, record]));
    else for (const record of event.records) {
      this.records.delete(record.id); this.records.set(record.id, record);
    }
    while (this.records.size > 2048) this.records.delete(this.records.keys().next().value!);
    this.status = event.status;
    this.renderRecords(); this.renderStatus();
  }

  private renderRecords() { this.primitive.setRecords([...this.records.values()]); }

  private renderStatus() {
    if (this.dead) return;
    const status = this.status;
    const state = this.resolution.state === 'compatible' ? status?.state ?? 'loading' : this.resolution.state;
    const sourceText = this.resolution.state === 'compatible'
      ? this.resolution.compatible.map(source => source === 'binance:spot' ? 'Binance Spot' : 'Binance USD-M').join(' + ')
      : this.resolution.message;
    const hidden = !this.visible || !this.hostVisible;
    const message = `${hidden ? 'Hidden · still collecting · ' : ''}${sourceText} · ${state}${status?.message ? ` · ${status.message}` : ''} · ${this.records.size}/${2048} retained · ${this.primitive.diagnostics().culled} culled`;
    if (message === this.lastStatusText) return;
    this.lastStatusText = message; this.statusNode.textContent = message; this.statusNode.dataset.state = state;
    this.statusNode.hidden = false;
  }

  private crosshair(event: CrosshairMoveEvent) {
    if (this.dead || !this.visible || !event.point || event.paneIndex !== this.chart.primaryPaneIndex()) { this.tooltip.hidden = true; return; }
    const plot = this.chart.plotRect(this.chart.primaryPaneIndex());
    if (!plot) { this.tooltip.hidden = true; return; }
    const hit = this.primitive.hit(event.point.x - plot.left, event.point.y - plot.top);
    if (!hit) { this.tooltip.hidden = true; return; }
    this.renderTooltip(hit);
    const width = this.tooltip.offsetWidth, height = this.tooltip.offsetHeight;
    const left = Math.max(4, Math.min(this.host.clientWidth - width - 4, plot.left + hit.x + 10));
    const top = Math.max(4, Math.min(this.host.clientHeight - height - 4, plot.top + hit.y + 10));
    this.tooltip.style.left = `${left}px`; this.tooltip.style.top = `${top}px`; this.tooltip.hidden = false;
  }

  private renderTooltip(hit: TradeBubbleHit) {
    const execution = hit.record.execution;
    const timestamp = document.createElement('div'); timestamp.className = 'positioning-tooltip-header'; timestamp.textContent = `${new Date(execution.timeMs).toISOString().replace('T', ' ').replace('Z', '')} UTC`;
    const source = document.createElement('div'); source.textContent = execution.market === 'spot' ? 'Binance BTCUSDT Spot' : 'Binance BTCUSDT USD-M Perp';
    const side = document.createElement('div'); side.textContent = `Aggressor ${execution.side.toUpperCase()} · ${quantityFormat.format(execution.quantity)} BTC`;
    const price = document.createElement('div'); price.textContent = `Price ${priceFormat.format(execution.price)} USDT`;
    const notional = document.createElement('div'); notional.textContent = `Notional $${compactSize(hit.record.notionalUsdt)} USDT`;
    const tier = document.createElement('div'); tier.textContent = `Tier ${hit.record.tier?.name ?? 'Unclassified'}`;
    const provenance = document.createElement('div'); provenance.textContent = this.provenance(execution);
    const overlap = document.createElement('small'); overlap.className = 'trade-bubble-overlap';
    overlap.textContent = hit.overlapCount ? `${hit.overlapCount} other execution bubble${hit.overlapCount === 1 ? '' : 's'} overlap here · trades are kept separate` : 'One execution bubble · trades are kept separate';
    this.tooltip.replaceChildren(timestamp, source, side, price, notional, tier, provenance, overlap);
  }

  private provenance(execution: NormalizedExecution) {
    const value = execution as NormalizedExecution & { id?: number; firstTradeId?: number; lastTradeId?: number };
    if (execution.granularity !== 'aggregate-trade') return `Execution ${execution.executionId}`;
    if (Number.isSafeInteger(value.id) && Number.isSafeInteger(value.firstTradeId) && Number.isSafeInteger(value.lastTradeId)) {
      return `Aggregate trade #${value.id} · underlying trade IDs ${value.firstTradeId}–${value.lastTradeId}`;
    }
    return `Aggregate execution ${execution.executionId}`;
  }

  openSettings() { this.controls.open(this.settings); }
  setVisible(visible: boolean) {
    this.visible = visible; this.primitive.setEnabled(visible && this.hostVisible && this.resolution.state === 'compatible');
    if (!visible) this.tooltip.hidden = true;
    this.renderStatus();
  }
  setHostVisible(visible: boolean) {
    this.hostVisible = visible; this.primitive.setEnabled(this.visible && visible && this.resolution.state === 'compatible');
    if (!visible) this.tooltip.hidden = true;
    this.renderStatus();
  }
  diagnostics() { return { settings: this.settings, resolution: this.resolution, status: this.status, records: this.records.size, layer: this.primitive.diagnostics() }; }
  dispose() {
    if (this.dead) return; this.dead = true; this.release?.(); this.release = undefined;
    this.listeners.forEach(release => release()); this.listeners = []; this.controlsAbort.abort(); this.controls.dispose(); this.chart.removePrimitive(this.primitive);
    this.tooltip.remove(); this.statusNode.remove(); this.records.clear();
  }
}

import { heatmapSettings, type HeatmapSettings, type HeatmapStatus } from './feed/heatmap-model';
import { footprintTicksForPrice } from './feed/protocol';
import type { OrderBookHeatmap } from './chart/orderbook-heatmap';

/** Compact native controls; collection ownership remains in panel/feed. */
export class HeatmapControls {
  readonly dialog = document.createElement('dialog'); readonly notice = document.createElement('div'); readonly readout = document.createElement('div');
  private form = document.createElement('form'); private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private rowHint = document.createElement('p');
  private units: 'btc' | 'usdt' = 'btc';
  setUnits(units: 'btc' | 'usdt') { this.units = units; this.readout.textContent = ''; this.renderStatus(); }
  private current = heatmapSettings(null); private supported = true; private status?: HeatmapStatus;
  constructor(private changed: (settings: HeatmapSettings, units: 'btc' | 'usdt') => void, private retry: () => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings heatmap-settings'; this.dialog.setAttribute('aria-label', 'Order-book heatmap settings');
    this.notice.className = 'heatmap-notice'; this.notice.setAttribute('role', 'status'); this.readout.className = 'heatmap-readout';
    const header = document.createElement('header'), title = document.createElement('h2'); title.textContent = 'Order-book heatmap';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; header.append(title, close);
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    const number = (name: string, label: string, min: number, max: number, step: string) => {
      const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = step; input.required = true; this.field(fields, name, label, input);
    };
    const select = (name: string, label: string, values: [string, string][]) => {
      const input = document.createElement('select'); for (const [value, text] of values) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); } this.field(fields, name, label, input);
    };
    number('rowPrice', 'Price row (USDT)', .000001, 10000, 'any');
    select('units', 'Quantity units', [['btc', 'BTC'], ['usdt', 'USDT notional']]);
    select('mode', 'Resting quantity', [['average', 'Time-weighted average'], ['peak', 'Observed peak']]);
    select('contrast', 'Liquidity contrast', [['enhanced', 'Enhanced (faint walls visible)'], ['muted', 'Muted (previous)']]);
    number('opacity', 'Opacity', 0, 1, '.05'); number('intensity', 'Full intensity (BTC / $10)', .01, 10000, 'any');
    number('minimum', 'Minimum quantity (BTC)', 0, 10000, 'any');
    select('labels', 'Quantity labels', [['auto', 'Auto'], ['off', 'Off']]);
    for (const name of ['bids', 'asks']) { const input = document.createElement('input'); input.type = 'checkbox'; this.field(fields, name, `Show ${name}`, input); }
    const hint = document.createElement('p'); hint.className = 'dialog-status'; hint.textContent = 'Quantity units are shared with Footprint; USDT is actual resting price × quantity. Session only. Columns follow the chart timeframe; closed candle quantities freeze. Changing price/time resolution starts fresh collection unless that resolution is still used by another chart. Visual settings preserve data. Colours use fixed BTC density per $10; wider bins do not brighten simply because they contain more levels. Enhanced contrast lifts faint recorded quantities with a fixed colour curve; it does not add liquidity. Stripes and hover identify incomplete outer-book subtotals.';
    this.rowHint.className = 'dialog-status';
    const footer = document.createElement('footer'), apply = document.createElement('button'), retryButton = document.createElement('button');
    apply.type = 'submit'; apply.textContent = 'Apply'; retryButton.type = 'button'; retryButton.textContent = 'Retry depth'; footer.append(retryButton, apply);
    this.form.className = 'indicator-settings-form';
    this.form.append(header, fields, this.rowHint, hint, footer); this.dialog.append(this.form);
    const options = { signal };
    close.addEventListener('click', () => this.dialog.close(), options);
    retryButton.addEventListener('click', () => this.retry(), options);
    this.dialog.addEventListener('click', e => { if (e.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', e => {
      e.preventDefault(); const raw: Record<string, unknown> = { enabled: this.current.enabled, bucketMs: this.current.bucketMs };
      for (const [name, input] of this.inputs) raw[name] = input instanceof HTMLInputElement ? input.type === 'checkbox' ? input.checked : Number(input.value) : name === 'bucketMs' ? Number(input.value) : input.value;
      const price = this.inputs.get('rowPrice') as HTMLInputElement; price.setCustomValidity('');
      if (this.status?.tickSize && footprintTicksForPrice(Number(raw.rowPrice), this.status.tickSize) === null) price.setCustomValidity(`Enter a multiple of the exchange tick size, $${this.status.tickSize}.`);
      if (!this.form.reportValidity()) return;
      this.changed(heatmapSettings(raw), raw.units === 'usdt' ? 'usdt' : 'btc'); this.dialog.close();
    }, options);
    this.inputs.get('rowPrice')!.addEventListener('input', () => (this.inputs.get('rowPrice') as HTMLInputElement).setCustomValidity(''), options);
  }
  private field(parent: HTMLElement, name: string, text: string, input: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label'); label.className = 'indicator-setting-field'; const span = document.createElement('span'); span.textContent = text;
    input.setAttribute('aria-label', text); label.append(span, input); parent.append(label); this.inputs.set(name, input);
  }
  sync(settings: HeatmapSettings, supported: boolean, footprint = false) {
    const row = this.inputs.get('rowPrice') as HTMLInputElement; row.disabled = footprint; row.value = String(settings.rowPrice); row.setCustomValidity('');
    this.rowHint.hidden = !footprint; this.rowHint.textContent = 'Price rows match the footprint. Change Price level in Footprint settings to update both layers. Changing resolution starts fresh collection unless that configuration is already shared.';
    this.current = settings; this.supported = supported;
    this.notice.hidden = !settings.enabled; this.readout.hidden = !settings.enabled; this.renderStatus();
  }
  setStatus(status?: HeatmapStatus) { this.status = status; this.renderStatus(); }
  private renderStatus() {
    if (!this.current.enabled) return;
    const s = this.status;
    this.notice.textContent = !this.supported ? 'Heatmap unavailable · Binance BTCUSDT USD-M only' : !s ? 'Heatmap · syncing…' : `Heatmap · ${s.state} · ${this.units.toUpperCase()} · ${this.current.mode === 'peak' ? 'observed peak' : 'time-weighted average'}${s.message.startsWith('Staging') ? ' · '+s.message : ''}${s.capacityLimited ? ' · row limit' : ''} · ${s.collectionStart ? `since ${utc(s.collectionStart)}` : 'collecting…'}${s.retentionStart ? ` · retained ${utc(s.retentionStart)}` : ''}`;
    this.notice.title = !this.supported ? this.notice.textContent : `${this.notice.textContent}\n${s?.message ?? 'Waiting for synchronized depth'}`;
  }
  hover(hit: ReturnType<OrderBookHeatmap['hoverAt']>) {
    if (!hit || !this.current.enabled) { this.readout.textContent = ''; return; }
    const b = hit.bin;
    this.readout.textContent = `Resting ${hit.side} · ${hit.quantity.toLocaleString('en-US', { maximumFractionDigits: hit.units === 'btc' ? 4 : 2 })} ${hit.units.toUpperCase()} · ${hit.mode === 'peak' ? 'observed peak' : 'time-weighted average'}\n${utc(b.start)}–${utc(b.end)} UTC · $${b.low.toFixed(2)}–$${b.high.toFixed(2)} · ${b.incomplete ? 'incomplete / unknown subtotal' : 'covered observations'}${b.partial ? ' · partial interval' : ''}`;
  }
  open() {
    for (const [name, input] of this.inputs) {
      const value = name === 'units' ? this.units : this.current[name as keyof HeatmapSettings];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
    }
    if (!this.dialog.open) this.dialog.showModal();
  }
  dispose() { if (this.dialog.open) this.dialog.close(); }
}
function utc(ms: number) { return new Date(ms).toISOString().slice(11, 23); }

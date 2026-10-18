import {
  DEFAULT_ORDER_WALLS_SETTINGS,
  orderWallValueAt,
  orderWallsSettings,
  type OrderWallHit,
  type OrderWallStatus,
  type OrderWallsSettings,
} from './feed/order-walls';
import type { Series } from './feed/protocol';
import { instrumentLabel } from './feed/protocol';

/** Native settings and status for the chart's one Order Walls instance. */
export class OrderWallsControls {
  readonly dialog = document.createElement('dialog');
  readonly notice = document.createElement('div');
  private form = document.createElement('form');
  private fields = document.createElement('div');
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private current: OrderWallsSettings = { ...DEFAULT_ORDER_WALLS_SETTINGS };
  private status?: OrderWallStatus;
  private supported = false;
  private relativeFields: HTMLElement[] = [];
  private absoluteFields: HTMLElement[] = [];

  constructor(private changed: (settings: OrderWallsSettings) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings order-walls-settings';
    this.dialog.setAttribute('aria-label', 'Order Walls settings');
    this.notice.className = 'order-walls-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.setAttribute('aria-live', 'polite');

    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Order Walls';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    header.append(title, close);
    this.fields.className = 'indicator-settings-fields';

    const method = this.select('method', 'Detection', [
      ['relative', 'Relative percentile'], ['absolute', 'Absolute notional'],
    ]);
    const relativePercentile = this.number('relativePercentile', 'Relative percentile', 50, 99.9, '.1');
    const relativeFloor = this.number('relativeFloorUsd', 'Relative USD floor', 1, 1_000_000_000_000, '1');
    const absolute = this.number('thresholdUsd', 'Absolute notional (USD)', 1, 1_000_000_000_000, '1');
    this.relativeFields = [relativePercentile.parentElement!, relativeFloor.parentElement!];
    this.absoluteFields = [absolute.parentElement!];

    this.select('aggregation', 'Price aggregation', [
      ['auto', 'Auto'], ['10', '$10'], ['50', '$50'], ['100', '$100'], ['250', '$250'],
    ]);
    this.select('colorMode', 'Wall colour', [
      ['heat', 'Heat intensity'], ['bid-ask', 'Bid / ask'],
    ]);
    this.number('thicknessPx', 'Line thickness (px)', 1, 4, '.5');
    this.number('opacity', 'Opacity', 0, 1, '.05');
    this.checkbox('showHistory', 'Show historical walls');
    this.checkbox('showPriceLines', 'Price lines and size tags (active walls)');

    const advanced = document.createElement('details'); advanced.className = 'order-walls-advanced';
    const summary = document.createElement('summary'); summary.textContent = 'Advanced'; advanced.append(summary);
    const exitRatio = this.number('exitRatio', 'Exit threshold ratio', .1, 1, '.05');
    const duration = this.number('minDurationMs', 'Minimum confirmation (ms)', 0, 60_000, '100');
    advanced.append(exitRatio.parentElement!, duration.parentElement!); this.fields.append(advanced);

    const hint = document.createElement('p'); hint.className = 'dialog-status';
    hint.textContent = 'Walls use observed resting quote notional at each aggregated price. Partial book coverage stays marked as partial; gaps do not imply a removal.';
    const footer = document.createElement('footer');
    const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'primary'; apply.textContent = 'Apply';
    footer.append(apply);
    this.form.className = 'indicator-settings-form';
    this.form.append(header, this.fields, hint, footer); this.dialog.append(this.form);

    const options = { signal };
    close.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    method.addEventListener('change', () => this.updateMethodFields(), options);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const raw: Record<string, unknown> = {};
      for (const [name, input] of this.inputs) raw[name] = input instanceof HTMLInputElement
        ? input.type === 'checkbox' ? input.checked : Number(input.value)
        : name === 'aggregation' ? input.value === 'auto' ? 'auto' : Number(input.value) : input.value;
      if (!this.form.reportValidity()) return;
      this.current = orderWallsSettings({ ...this.current, ...raw, enabled: true });
      this.changed(this.current);
      this.dialog.close();
    }, options);
  }

  private number(name: string, label: string, min: number, max: number, step: string) {
    const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = step; input.required = true;
    return this.field(name, label, input);
  }

  private select(name: string, label: string, values: [string, string][]) {
    const input = document.createElement('select');
    for (const [value, text] of values) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    return this.field(name, label, input);
  }

  private checkbox(name: string, label: string) {
    const input = document.createElement('input'); input.type = 'checkbox';
    return this.field(name, label, input);
  }

  private field(name: string, text: string, input: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label'); label.className = 'indicator-setting-field';
    const span = document.createElement('span'); span.textContent = text; input.setAttribute('aria-label', text);
    label.append(span, input); this.fields.append(label); this.inputs.set(name, input);
    return input;
  }

  sync(settings: OrderWallsSettings, supported: boolean, attached = true, visible = true) {
    this.current = orderWallsSettings(settings); this.supported = supported;
    this.notice.hidden = !attached || !visible;
    this.renderStatus();
  }

  setStatus(status?: OrderWallStatus) { this.status = status; this.renderStatus(); }

  private renderStatus() {
    if (!this.supported) {
      this.notice.dataset.state = 'unavailable';
      this.notice.textContent = 'Order Walls unavailable · Binance BTCUSDT Spot or USD-M Perp only';
      this.notice.title = 'Hyperliquid has no supported order-book history source in this terminal.';
      return;
    }
    if (!this.status) { this.notice.dataset.state = 'loading'; this.notice.textContent = 'Order Walls · waiting for observed book history'; return; }
    const state = this.status.state === 'live' ? 'live' : this.status.state;
    this.notice.dataset.state = state;
    const coverage = this.status.coverage?.complete ? 'complete history' : this.status.coverage?.partial ? 'partial history' : '';
    const scope = this.status.bookScope && (!this.status.bookScope.bidComplete || !this.status.bookScope.askComplete) ? ' · partial book scope' : '';
    const detail = this.status.message ? ` · ${this.status.message}` : '';
    const resolution = this.current.aggregation === 'auto' && Number.isFinite(this.status.resolvedPriceWidth)
      ? ` · Auto $${this.status.resolvedPriceWidth!.toLocaleString('en-US')} rows` : '';
    const provisional = this.status.provisional ? ' · current wall provisional while history catches up' : '';
    this.notice.textContent = `Order Walls · ${state}${resolution}${provisional}${coverage ? ` · ${coverage}` : ''}${scope}${detail}`;
    this.notice.title = this.notice.textContent;
  }

  open(settings: OrderWallsSettings) {
    this.current = orderWallsSettings(settings);
    for (const [name, input] of this.inputs) {
      const value = this.current[name as keyof OrderWallsSettings];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    this.updateMethodFields();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private updateMethodFields() {
    const method = (this.inputs.get('method') as HTMLSelectElement).value;
    for (const field of this.relativeFields) field.hidden = method !== 'relative';
    for (const field of this.absoluteFields) field.hidden = method !== 'absolute';
  }

  tooltip(hit: OrderWallHit, series: Series, sourceStatus?: OrderWallStatus, now = Date.now()) {
    const segment = hit.segment;
    const lastConfirmed = segment.start + segment.durationMs;
    const age = Math.max(0, now - lastConfirmed);
    const coverage = segment.scopePartial ? 'partial book scope' : sourceStatus?.coverage?.complete ? 'complete history window' : sourceStatus?.coverage?.partial ? 'partial history window' : 'observed book';
    const currentState = sourceStatus?.state && sourceStatus.state !== 'live' ? ` · feed ${sourceStatus.state}` : '';
    const observedValue = orderWallValueAt(segment, hit.at);
    const valueText = observedValue === null
      ? `Historical notional unavailable${segment.valueRunsTruncated ? ' · earlier value history was evicted' : ' · no observation at this time'}`
      : `Resting notional $${money(observedValue)} at ${utc(hit.at)} UTC`;
    const strengthText = typeof hit.percentile !== 'number' ? ' · historical rank unavailable' : ` · p${hit.percentile.toFixed(1)} at that time`;
    const startText = segment.startKnown ? `Observed from ${utc(segment.start)} UTC` : `Observed since ${utc(segment.start)} UTC · start unknown`;
    const spanText = `${segment.startKnown ? 'Duration' : 'Observed span'} ${durationText(segment.durationMs)}`;
    const endText = segment.end === null
      ? `Active through last confirmation ${utc(lastConfirmed)} UTC`
      : segment.endKnown
        ? `Observed exit ${utc(segment.end)} UTC${segment.endReason === 'removed' ? ' · level removed' : segment.endReason === 'below-threshold' ? ' · below threshold' : ''}`
        : `Censored at last confirmed ${utc(segment.end)} UTC${segment.censoredReason ? ` · ${segment.censoredReason}` : ''}`;
    return `${segment.side.toUpperCase()} wall · ${instrumentLabel(series)}\n$${price(hit.priceLow)}–$${price(hit.priceHigh)} · ${coverage}${currentState}\n${valueText}${strengthText}\n${startText} · ${spanText}\n${endText}\nLast confirmed ${utc(lastConfirmed)} UTC · ${ageText(age)} ago`;
  }

  dispose() { if (this.dialog.open) this.dialog.close(); }
}

function price(value: number) { return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function money(value: number) { return value.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function utc(ms: number) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 23); }
function durationText(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown duration';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
function ageText(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  return `${Math.floor(ms / 3_600_000)} h`;
}

import { CURRENCY_EVENT, effectiveCurrency, getCurrencyPreference } from '../currency-display';
import type { FootprintStatRow } from 'openalgo-charts/profile';
import type { FootprintTotalsSettings } from './model';

const ROWS: readonly { id: FootprintStatRow; label: string }[] = [
  { id: 'volume', label: 'Volume' }, { id: 'bidVolume', label: 'Bid volume' },
  { id: 'askVolume', label: 'Ask volume' }, { id: 'delta', label: 'Delta' },
  { id: 'minDelta', label: 'Minimum running delta' }, { id: 'maxDelta', label: 'Maximum running delta' },
  { id: 'deltaPct', label: 'Delta percentage' }, { id: 'cvd', label: 'Cumulative delta' }, { id: 'trades', label: 'Trades' },
];

export class FootprintTotalsControls {
  readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly inputs = new Map<FootprintStatRow, HTMLInputElement>();
  private target = '';
  private readonly highlight = document.createElement('input');
  private readonly highlightDeltaFlips = document.createElement('input');
  private readonly deltaFlipTarget = document.createElement('select');
  private readonly deltaFlipLookback = document.createElement('input');
  private readonly deltaFlipMinimumStrength = document.createElement('input');
  private readonly showDeltaFlipLivePreview = document.createElement('input');
  private readonly deltaTargetHint = document.createElement('p');

  constructor(private readonly apply: (instanceId: string, settings: FootprintTotalsSettings) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings footprint-totals-settings';
    this.dialog.setAttribute('aria-label', 'Footprint Totals settings');
    this.form.className = 'indicator-settings-form';
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Footprint Totals';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; header.append(title, close);
    const rows = document.createElement('fieldset'); rows.className = 'net-positioning-venues';
    const legend = document.createElement('legend'); legend.textContent = 'Statistics rows'; rows.append(legend);
    for (const row of ROWS) {
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id; input.setAttribute('aria-label', row.label);
      const label = document.createElement('label'); label.className = 'indicator-setting-field';
      const text = document.createElement('span'); text.textContent = row.label; label.append(text, input); rows.append(label);
      this.inputs.set(row.id, input);
    }
    this.highlight.type = 'checkbox'; this.highlight.setAttribute('aria-label', 'Highlight highest value in each row');
    const highlightField = document.createElement('label'); highlightField.className = 'indicator-setting-field'; highlightField.append('Highlight highest value in each row', this.highlight);
    const help = document.createElement('p'); help.className = 'dialog-status';
    help.textContent = 'Strength is the smaller absolute delta in the flip pair divided by the median absolute delta of the preceding completed reference window. The pair is excluded from that median. It describes relative size, not confidence. Every required bar must have usable coverage; BTC or USDT follows the effective Footprint units.';
    const flipOptions = document.createElement('fieldset'); flipOptions.className = 'net-positioning-venues';
    const flipLegend = document.createElement('legend'); flipLegend.textContent = 'Delta flip highlight'; flipOptions.append(flipLegend);
    this.highlightDeltaFlips.type = 'checkbox'; this.highlightDeltaFlips.setAttribute('aria-label', 'Highlight delta flips');
    const flipEnabled = document.createElement('label'); flipEnabled.className = 'indicator-setting-field'; flipEnabled.append('Highlight delta flips', this.highlightDeltaFlips); flipOptions.append(flipEnabled);
    this.deltaFlipTarget.setAttribute('aria-label', 'Delta flip target');
    for (const [value, label] of [['delta-cell', 'Delta cell'], ['whole-column', 'Whole column']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; this.deltaFlipTarget.append(option);
    }
    const targetLabel = document.createElement('label'); targetLabel.className = 'indicator-setting-field'; targetLabel.append('Highlight target', this.deltaFlipTarget); flipOptions.append(targetLabel);
    this.deltaTargetHint.className = 'dialog-status'; this.deltaTargetHint.hidden = true; flipOptions.append(this.deltaTargetHint);
    this.deltaFlipLookback.type = 'number'; this.deltaFlipLookback.min = '20'; this.deltaFlipLookback.max = '200'; this.deltaFlipLookback.step = '1'; this.deltaFlipLookback.setAttribute('aria-label', 'Reference lookback');
    const lookbackLabel = document.createElement('label'); lookbackLabel.className = 'indicator-setting-field'; lookbackLabel.append('Reference lookback (20–200 bars)', this.deltaFlipLookback); flipOptions.append(lookbackLabel);
    this.deltaFlipMinimumStrength.type = 'number'; this.deltaFlipMinimumStrength.min = '0'; this.deltaFlipMinimumStrength.step = 'any'; this.deltaFlipMinimumStrength.setAttribute('aria-label', 'Minimum relative strength');
    const minimumLabel = document.createElement('label'); minimumLabel.className = 'indicator-setting-field'; minimumLabel.append('Minimum strength (× median; 0 = All flips with valid history)', this.deltaFlipMinimumStrength); flipOptions.append(minimumLabel);
    this.showDeltaFlipLivePreview.type = 'checkbox'; this.showDeltaFlipLivePreview.setAttribute('aria-label', 'Show live preview');
    const previewLabel = document.createElement('label'); previewLabel.className = 'indicator-setting-field'; previewLabel.append('Show live preview', this.showDeltaFlipLivePreview); flipOptions.append(previewLabel);
    const currencyHint = document.createElement('p'); currencyHint.className = 'global-currency-notice';
    const syncCurrency = () => { currencyHint.hidden = !getCurrencyPreference().enabled; currencyHint.textContent = `Global currency setting is set to ${effectiveCurrency('btc').toUpperCase()}. Totals follow the global display currency.`; };
    syncCurrency(); window.addEventListener(CURRENCY_EVENT, syncCurrency, { signal });
    const status = document.createElement('p'); status.className = 'dialog-status'; status.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Apply'; save.className = 'primary';
    footer.append(cancel, save); this.form.append(header, rows, highlightField, flipOptions, help, currencyHint, status, footer); this.dialog.append(this.form);
    const options = { signal };
    const updateTargetHint = () => {
      const deltaHidden = this.deltaFlipTarget.value === 'delta-cell' && !this.inputs.get('delta')?.checked;
      this.deltaTargetHint.hidden = !deltaHidden;
      this.deltaTargetHint.textContent = deltaHidden ? 'Delta is hidden. Enable the Delta row to see this highlight, or choose Whole column.' : '';
    };
    this.deltaFlipTarget.addEventListener('change', updateTargetHint, options);
    for (const input of this.inputs.values()) input.addEventListener('change', updateTargetHint, options);
    close.addEventListener('click', () => this.dialog.close(), options);
    cancel.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const selected = ROWS.filter(row => this.inputs.get(row.id)?.checked).map(row => row.id);
      if (!selected.length) { status.textContent = 'Select at least one statistics row.'; return; }
      const lookback = this.deltaFlipLookback.valueAsNumber, minimumStrength = this.deltaFlipMinimumStrength.valueAsNumber;
      if (!Number.isInteger(lookback) || lookback < 20 || lookback > 200 || !Number.isFinite(minimumStrength) || minimumStrength < 0) {
        status.textContent = 'Use a lookback from 20 to 200 and a non-negative minimum strength.'; return;
      }
      this.apply(this.target, { rows: selected, highlightHighest: this.highlight.checked,
        highlightDeltaFlips: this.highlightDeltaFlips.checked, deltaFlipTarget: this.deltaFlipTarget.value === 'whole-column' ? 'whole-column' : 'delta-cell',
        deltaFlipLookback: lookback, deltaFlipMinimumStrength: minimumStrength, showDeltaFlipLivePreview: this.showDeltaFlipLivePreview.checked }); this.dialog.close();
    }, options);
  }

  open(instanceId: string, settings: FootprintTotalsSettings) {
    this.target = instanceId; this.highlight.checked = settings.highlightHighest;
    this.highlightDeltaFlips.checked = settings.highlightDeltaFlips; this.deltaFlipTarget.value = settings.deltaFlipTarget;
    this.deltaFlipLookback.value = String(settings.deltaFlipLookback); this.deltaFlipMinimumStrength.value = String(settings.deltaFlipMinimumStrength);
    this.showDeltaFlipLivePreview.checked = settings.showDeltaFlipLivePreview;
    for (const [row, input] of this.inputs) input.checked = settings.rows.includes(row);
    this.deltaTargetHint.hidden = this.deltaFlipTarget.value !== 'delta-cell' || settings.rows.includes('delta');
    this.deltaTargetHint.textContent = this.deltaTargetHint.hidden ? '' : 'Delta is hidden. Enable the Delta row to see this highlight, or choose Whole column.';
    const status = this.dialog.querySelector<HTMLElement>('[role=status]'); if (status) status.textContent = '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose() { if (this.dialog.open) this.dialog.close(); }
}

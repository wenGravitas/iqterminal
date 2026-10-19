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
    const help = document.createElement('p'); help.className = 'dialog-status';
    help.textContent = 'Values use the chart’s Footprint units and the same recorded aggregate-trade bars as the Footprint display.';
    const status = document.createElement('p'); status.className = 'dialog-status'; status.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Apply'; save.className = 'primary';
    footer.append(cancel, save); this.form.append(header, rows, help, status, footer); this.dialog.append(this.form);
    const options = { signal };
    close.addEventListener('click', () => this.dialog.close(), options);
    cancel.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const selected = ROWS.filter(row => this.inputs.get(row.id)?.checked).map(row => row.id);
      if (!selected.length) { status.textContent = 'Select at least one statistics row.'; return; }
      this.apply(this.target, { rows: selected }); this.dialog.close();
    }, options);
  }

  open(instanceId: string, settings: FootprintTotalsSettings) {
    this.target = instanceId;
    for (const [row, input] of this.inputs) input.checked = settings.rows.includes(row);
    const status = this.dialog.querySelector<HTMLElement>('[role=status]'); if (status) status.textContent = '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose() { if (this.dialog.open) this.dialog.close(); }
}

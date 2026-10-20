import type { TpoStatus } from '../feed/protocol';
import { tpoIndicatorSettings, type TpoIndicatorSettings } from './tpo-settings';

type Input = HTMLInputElement | HTMLSelectElement;
type Field = { key: keyof TpoIndicatorSettings; label: string; kind: 'number' | 'checkbox' | 'color' | 'select' | 'text'; min?: number; max?: number; step?: string; options?: [string, string][] };
const groups: Array<{ title: string; fields: Field[] }> = [
  { title: 'Profile', fields: [
    { key: 'bracketMinutes', label: 'Bracket duration (minutes)', kind: 'select', options: [['15','15'],['30','30'],['60','60']] },
    { key: 'rowTicks', label: 'Row ticks (auto or integer)', kind: 'text' },
    { key: 'tickSize', label: 'Price tick size', kind: 'number', min: .00000001, max: 1000000, step: 'any' },
    { key: 'valueAreaPercent', label: 'Value area (%)', kind: 'number', min: 1, max: 100, step: '1' },
    { key: 'showProfile', label: 'Show daily profile', kind: 'checkbox' },
  ] },
  { title: 'Appearance', fields: [
    { key: 'profileMode', label: 'Profile labels', kind: 'select', options: [['adaptive','Adaptive'],['letters','Letters'],['blocks','Blocks']] },
    { key: 'profileWidthPercent', label: 'Profile width (%)', kind: 'number', min: 5, max: 100, step: '1' },
    { key: 'profileOpacity', label: 'Profile opacity (%)', kind: 'number', min: 0, max: 100, step: '1' },
    { key: 'profileColor', label: 'Profile color', kind: 'color' },
    { key: 'profileLevelsExtend', label: 'Extend POC / VAH / VAL across the day', kind: 'checkbox' },
    { key: 'levelLineThickness', label: 'Profile level thickness', kind: 'number', min: 1, max: 4, step: '1' },
    { key: 'theme', label: 'Color theme', kind: 'select', options: [['chart','Chart'],['dark','Dark'],['light','Light']] },
  ] },
  { title: 'POC and value area', fields: [
    { key: 'highlightPoc', label: 'Highlight POC', kind: 'checkbox' }, { key: 'pocColor', label: 'POC color', kind: 'color' },
    { key: 'pocLineVisible', label: 'POC line', kind: 'checkbox' }, { key: 'pocLineStyle', label: 'POC line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'vahLineVisible', label: 'VAH line', kind: 'checkbox' }, { key: 'vahLineStyle', label: 'VAH line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'valLineVisible', label: 'VAL line', kind: 'checkbox' }, { key: 'valLineStyle', label: 'VAL line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'shadeValueArea', label: 'Shade value area', kind: 'checkbox' }, { key: 'valueAreaColor', label: 'Value area color', kind: 'color' },
  ] },
  { title: 'Opening range', fields: [
    { key: 'openingRangeEnabled', label: 'Show opening range', kind: 'checkbox' }, { key: 'openingRangeMinutes', label: 'Opening range minutes', kind: 'number', min: 1, max: 1440, step: '1' },
    { key: 'openingRangeMidpoint', label: 'Opening range midpoint', kind: 'checkbox' }, { key: 'openingRangeShade', label: 'Shade opening range', kind: 'checkbox' },
    { key: 'openingRangeHighVisible', label: 'Opening range high', kind: 'checkbox' }, { key: 'openingRangeLowVisible', label: 'Opening range low', kind: 'checkbox' },
    { key: 'openingRangeExtend', label: 'Extend opening range to day end', kind: 'checkbox' }, { key: 'openingRangeColor', label: 'Opening range color', kind: 'color' },
    { key: 'openingRangeLineStyle', label: 'Opening range line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'openingRangeThickness', label: 'Opening range thickness', kind: 'number', min: 1, max: 4, step: '1' }, { key: 'openingRangeOpacity', label: 'Opening range opacity (%)', kind: 'number', min: 0, max: 100, step: '1' },
  ] },
  { title: 'Initial balance', fields: [
    { key: 'initialBalanceEnabled', label: 'Show initial balance', kind: 'checkbox' }, { key: 'initialBalanceMinutes', label: 'Initial balance minutes', kind: 'number', min: 1, max: 1440, step: '1' },
    { key: 'initialBalanceHighVisible', label: 'Initial balance high', kind: 'checkbox' }, { key: 'initialBalanceLowVisible', label: 'Initial balance low', kind: 'checkbox' },
    { key: 'initialBalanceMidpoint', label: 'Initial balance midpoint', kind: 'checkbox' }, { key: 'initialBalanceShade', label: 'Shade initial balance', kind: 'checkbox' },
    { key: 'initialBalanceCompletedOnly', label: 'Only show completed initial balance', kind: 'checkbox' }, { key: 'initialBalanceExtend', label: 'Extend initial balance to day end', kind: 'checkbox' },
    { key: 'initialBalanceColor', label: 'Initial balance color', kind: 'color' }, { key: 'initialBalanceLineStyle', label: 'Initial balance line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'initialBalanceThickness', label: 'Initial balance thickness', kind: 'number', min: 1, max: 4, step: '1' },
    { key: 'initialBalanceOpacity', label: 'Initial balance opacity (%)', kind: 'number', min: 0, max: 100, step: '1' },
    { key: 'projectionHalf', label: 'Project +50% initial balance', kind: 'checkbox' }, { key: 'projectionFull', label: 'Project +100% initial balance', kind: 'checkbox' },
  ] },
  { title: 'Naked levels', fields: [
    { key: 'nakedEnabled', label: 'Show naked levels', kind: 'checkbox' }, { key: 'nakedDays', label: 'Lookback days', kind: 'number', min: 1, max: 90, step: '1' },
    { key: 'nakedPoc', label: 'Naked POC', kind: 'checkbox' }, { key: 'nakedPocColor', label: 'POC line color', kind: 'color' },
    { key: 'nakedPocLineStyle', label: 'POC line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'nakedVah', label: 'Naked VAH', kind: 'checkbox' }, { key: 'nakedVahColor', label: 'VAH line color', kind: 'color' },
    { key: 'nakedVahLineStyle', label: 'VAH line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'nakedVal', label: 'Naked VAL', kind: 'checkbox' }, { key: 'nakedValColor', label: 'VAL line color', kind: 'color' },
    { key: 'nakedValLineStyle', label: 'VAL line style', kind: 'select', options: [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']] },
    { key: 'nakedLineThickness', label: 'Naked line thickness', kind: 'number', min: 1, max: 4, step: '1' },
    { key: 'nakedActiveOnly', label: 'Active levels only', kind: 'checkbox' }, { key: 'testedLevels', label: 'Tested levels', kind: 'select', options: [['show','Stop at first touch'],['fade','Continue faded'],['hide','Hide']] },
    { key: 'nakedLabels', label: 'Level labels', kind: 'select', options: [['off','Off'],['age','Age'],['price','Price'],['age-price','Age and price']] },
  ] },
];

/** Native dialog for persisted TPO settings and explicit history retry. */
export class TpoControls {
  readonly dialog = document.createElement('dialog');
  private form = document.createElement('form');
  private inputs = new Map<keyof TpoIndicatorSettings, Input>();
  private target = '';
  private tickSize = .1;
  private statusLine = document.createElement('p');

  constructor(private readonly apply: (id: string, settings: TpoIndicatorSettings) => void, private readonly retry: (id: string) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings tpo-settings'; this.dialog.setAttribute('aria-label', 'UTC TPO Profile settings');
    this.form.className = 'indicator-settings-form';
    const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button');
    title.textContent = 'UTC TPO Profile'; close.type = 'button'; close.textContent = 'Close'; header.append(title, close);
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    for (const group of groups) {
      const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = group.title; fieldset.append(legend);
      for (const field of group.fields) {
        const input: Input = field.kind === 'select' ? document.createElement('select') : document.createElement('input');
        input.setAttribute('aria-label', field.label);
        if (input instanceof HTMLSelectElement) for (const [value, label] of field.options ?? []) { const option = document.createElement('option'); option.value = value; option.textContent = label; input.append(option); }
        else { input.type = field.kind === 'checkbox' ? 'checkbox' : field.kind === 'color' ? 'color' : field.kind === 'text' ? 'text' : 'number'; if (field.min !== undefined) input.min = String(field.min); if (field.max !== undefined) input.max = String(field.max); if (field.step) input.step = field.step; input.required = field.kind === 'number'; }
        const label = document.createElement('label'); label.className = 'indicator-setting-field'; const caption = document.createElement('span'); caption.textContent = field.label; label.append(caption, input); fieldset.append(label); this.inputs.set(field.key, input);
      }
      fields.append(fieldset);
    }
    this.statusLine.className = 'dialog-status'; this.statusLine.setAttribute('role', 'status');
    const footer = document.createElement('footer'), retryButton = document.createElement('button'), cancel = document.createElement('button'), save = document.createElement('button');
    retryButton.type = 'button'; retryButton.textContent = 'Retry history'; cancel.type = 'button'; cancel.textContent = 'Cancel'; save.type = 'submit'; save.className = 'primary'; save.textContent = 'Apply'; footer.append(retryButton, cancel, save);
    const note = document.createElement('p'); note.className = 'dialog-status'; note.textContent = 'Profiles use UTC 1-minute OHLC ranges. Missing minute coverage remains visible in the status and keeps affected naked levels unknown.';
    this.form.append(header, fields, this.statusLine, note, footer); this.dialog.append(this.form);
    const options = { signal };
    const rowTicks = this.inputs.get('rowTicks')!;
    rowTicks.addEventListener('input', () => rowTicks.setCustomValidity(''), options);
    close.addEventListener('click', () => this.dialog.close(), options); cancel.addEventListener('click', () => this.dialog.close(), options);
    retryButton.addEventListener('click', () => { this.retry(this.target); this.statusLine.textContent = 'Refreshing cached 1-minute history…'; }, options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', event => {
      event.preventDefault(); if (!this.form.reportValidity()) return;
      const raw: Record<string, unknown> = {};
      for (const [key, input] of this.inputs) {
        if (input instanceof HTMLInputElement) raw[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.type === 'color' ? input.value : input.type === 'text' ? input.value.trim() === 'auto' ? 'auto' : Number(input.value) : Number(input.value);
        else raw[key] = ['bracketMinutes','rowTicks'].includes(key) ? input.value === 'auto' ? 'auto' : Number(input.value) : input.value;
      }
      if (typeof raw.rowTicks === 'number' && (!Number.isSafeInteger(raw.rowTicks) || raw.rowTicks < 1)) { this.inputs.get('rowTicks')!.setCustomValidity('Enter auto or a positive whole number of ticks.'); this.inputs.get('rowTicks')!.reportValidity(); return; }
      this.apply(this.target, tpoIndicatorSettings(raw, this.tickSize)); this.dialog.close();
    }, options);
  }

  open(id: string, settings: TpoIndicatorSettings, tickSize = .1) {
    this.target = id; this.tickSize = tickSize;
    this.inputs.get('rowTicks')!.setCustomValidity('');
    for (const [key, input] of this.inputs) {
      const value = settings[key];
      if (input instanceof HTMLInputElement) input.type === 'checkbox' ? input.checked = Boolean(value) : input.value = String(value);
      else input.value = String(value);
    }
    this.statusLine.textContent = '';
    if (!this.dialog.open) this.dialog.showModal();
  }
  setStatus(status?: TpoStatus) { this.statusLine.textContent = status ? `${status.state.toUpperCase()} · ${status.message}` : ''; }
  dispose() { if (this.dialog.open) this.dialog.close(); }
}

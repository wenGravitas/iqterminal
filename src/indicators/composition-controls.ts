import type { NumericOutputDescriptor } from '../scripts/composition';

export interface CompositionOutputChoice {
  output: NumericOutputDescriptor;
  label: string;
}

/** Native DOM settings for a moving average over one declared numeric output. */
export class CompositionControls {
  readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly source = document.createElement('select');
  private readonly length = document.createElement('input');
  private readonly color = document.createElement('input');
  private readonly status = document.createElement('div');
  private readonly abort = new AbortController();
  private choices: CompositionOutputChoice[] = [];
  private editingInstanceId?: string;

  constructor(private readonly apply: (output: NumericOutputDescriptor, settings: { length: number; color: string }, instanceId?: string) => void) {
    this.dialog.className = 'indicator-settings composition-settings';
    this.dialog.setAttribute('aria-label', 'Add moving average');
    this.form.className = 'indicator-settings-form';
    this.form.noValidate = true;

    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Add moving average';
    const close = button('Close', 'close-composition'); header.append(title, close);

    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    const input = fieldset('Input');
    this.source.setAttribute('aria-label', 'Indicator output');
    input.append(labelControl('Output', this.source));
    const calculation = fieldset('Calculation');
    this.length.type = 'number'; this.length.min = '1'; this.length.max = '250'; this.length.step = '1'; this.length.value = '20';
    this.length.setAttribute('aria-label', 'Length');
    calculation.append(labelControl('Length', this.length));
    const display = fieldset('Display');
    this.color.type = 'color'; this.color.value = '#63c7b2'; this.color.setAttribute('aria-label', 'Line colour');
    display.append(labelControl('Line colour', this.color));
    fields.append(input, calculation, display);

    this.status.className = 'dialog-status'; this.status.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    const cancel = button('Cancel', 'close-composition');
    const submit = button('Add SMA', 'apply-composition'); submit.classList.add('primary'); submit.type = 'submit';
    footer.append(cancel, submit);
    this.form.append(header, fields, this.status, footer);
    this.dialog.append(this.form);
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-composition-action]')?.dataset.compositionAction;
      if (action === 'close-composition') this.dialog.close();
    }, { signal: this.abort.signal });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const choice = this.choices.find(item => item.output.outputId === this.source.value);
      const length = Number(this.length.value);
      if (!choice || !Number.isFinite(length) || length < 1 || length > 250 || !Number.isInteger(length)) {
        this.status.textContent = 'Choose an available output and a length from 1 to 250.';
        return;
      }
      this.apply(choice.output, { length, color: this.color.value }, this.editingInstanceId);
      this.dialog.close();
    }, { signal: this.abort.signal });
  }

  open(choices: readonly CompositionOutputChoice[], selectedOutputId?: string, current?: { length: number; color: string }, instanceId?: string) {
    this.editingInstanceId = instanceId;
    this.choices = [...choices].filter(choice => choice.output.available && choice.output.composable !== false);
    this.source.replaceChildren(...this.choices.map(choice => {
      const option = new Option(choice.label, choice.output.outputId);
      return option;
    }));
    const selected = this.choices.find(choice => choice.output.outputId === selectedOutputId) ?? this.choices[0];
    if (selected) this.source.value = selected.output.outputId;
    this.length.value = String(current?.length ?? 20);
    this.color.value = current?.color ?? '#63c7b2';
    const title = this.form.querySelector('header h2'); if (title) title.textContent = instanceId ? 'Moving average settings' : 'Add moving average';
    const submitLabel = this.form.querySelector<HTMLButtonElement>('button[data-composition-action="apply-composition"]');
    if (submitLabel) submitLabel.textContent = instanceId ? 'Apply' : 'Add SMA';
    this.status.textContent = this.choices.length ? 'The line uses the output values and gaps from the selected study.'
      : choices.some(choice => choice.output.available) ? 'This study has mixed placement or special layers that cannot be grouped in a managed pane.'
        : 'No current numeric outputs are available.';
    const submit = this.form.querySelector<HTMLButtonElement>('button[data-composition-action="apply-composition"]');
    if (submit) submit.disabled = this.choices.length === 0;
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose() {
    this.abort.abort();
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }
}

function fieldset(title: string) {
  const section = document.createElement('fieldset'); section.className = 'composition-settings-group';
  const legend = document.createElement('legend'); legend.textContent = title; section.append(legend); return section;
}

function labelControl(title: string, control: HTMLElement) {
  const label = document.createElement('label'); label.className = 'indicator-setting-field';
  const text = document.createElement('span'); text.textContent = title; label.append(text, control); return label;
}

function button(title: string, action: string) {
  const result = document.createElement('button'); result.type = 'button'; result.textContent = title;
  result.dataset.compositionAction = action; return result;
}

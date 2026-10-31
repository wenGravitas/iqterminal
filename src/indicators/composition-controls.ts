import type { NumericOutputDescriptor, NumericOutputRef } from '../scripts/composition';

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
  private readonly scaleChange = document.createElement('input');
  private readonly scaleGroup = fieldset('Scale');
  private readonly status = document.createElement('div');
  private readonly abort = new AbortController();
  private choices: CompositionOutputChoice[] = [];
  private editingInstanceId?: string;
  private currentUnit: string | null = null;
  private currentScaleId?: string;
  private resolveLatest?: (outputId: string) => CompositionOutputChoice | undefined;

  constructor(private readonly apply: (output: NumericOutputDescriptor, settings: { length: number; color: string }, instanceId?: string, changeScale?: boolean) => boolean | string | void) {
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
    this.scaleChange.type = 'checkbox'; this.scaleChange.setAttribute('aria-label', 'Use the selected output scale');
    this.scaleGroup.append(labelControl('Use the selected output scale', this.scaleChange)); this.scaleGroup.hidden = true;
    fields.append(input, calculation, display, this.scaleGroup);

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
    this.source.addEventListener('change', () => this.updateScaleChoice(), { signal: this.abort.signal });
    this.scaleChange.addEventListener('change', () => this.updateScaleChoice(), { signal: this.abort.signal });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const outputId = this.source.value;
      const selectedChoice = this.choices.find(item => item.output.outputId === outputId);
      const choice = this.resolveLatest ? this.resolveLatest(outputId) : selectedChoice;
      const length = Number(this.length.value);
      if (!choice || !choice.output.available || choice.output.composable === false) {
        this.status.textContent = 'The saved output is unavailable. Choose a current output; the existing moving average is unchanged.';
        return;
      }
      if (this.resolveLatest && selectedChoice && !sameOutputReference(selectedChoice.output, choice.output)) {
        this.status.textContent = 'The selected output changed while these settings were open. Close and reopen to confirm the current output; the existing moving average is unchanged.';
        return;
      }
      if (!Number.isFinite(length) || length < 1 || length > 250 || !Number.isInteger(length)) {
        this.status.textContent = 'Enter a moving average length from 1 to 250.';
        return;
      }
      if (this.editingInstanceId && this.currentUnit !== choice.output.unit && !this.scaleChange.checked) {
        this.status.textContent = 'The selected output has different units. Check “Use the selected output scale” to change scale while keeping the moving average in its current pane.';
        return;
      }
      const result = this.apply(choice.output, { length, color: this.color.value }, this.editingInstanceId, this.scaleChange.checked);
      if (typeof result === 'string') {
        this.status.textContent = result;
        return;
      }
      if (result === false) {
        this.status.textContent = 'The source changed before Apply. Choose a current output and try again; the existing moving average is unchanged.';
        return;
      }
      this.dialog.close();
    }, { signal: this.abort.signal });
  }

  open(choices: readonly CompositionOutputChoice[], savedRef?: NumericOutputRef, current?: { length: number; color: string; unit?: string | null; scaleId?: string }, instanceId?: string,
    resolveLatest?: (outputId: string) => CompositionOutputChoice | undefined) {
    this.editingInstanceId = instanceId;
    this.currentUnit = current?.unit ?? null;
    this.currentScaleId = current?.scaleId;
    this.resolveLatest = resolveLatest;
    this.choices = [...choices].filter(choice => choice.output.available && choice.output.composable !== false);
    const options = this.choices.map(choice => {
      const option = new Option(choice.label, choice.output.outputId);
      return option;
    });
    const selectedOutputId = savedRef?.outputId;
    const savedChoice = choices.find(choice => savedRef && sameOutputReference(choice.output, savedRef));
    const currentSavedChoice = this.choices.find(choice => savedRef && sameOutputReference(choice.output, savedRef));
    let unavailableValue: string | undefined;
    if (instanceId && !currentSavedChoice) {
      const collidesWithCurrentChoice = Boolean(selectedOutputId && this.choices.some(choice => choice.output.outputId === selectedOutputId));
      unavailableValue = !savedRef ? '__missing_saved_numeric_input__'
        : collidesWithCurrentChoice ? `__saved_output_unavailable__:${selectedOutputId}` : selectedOutputId;
      const label = savedRef ? `${savedChoice?.label ?? 'Saved output'} · unavailable; choose a replacement`
        : 'Missing saved input · choose a replacement';
      const unavailable = new Option(label, unavailableValue);
      unavailable.disabled = true; options.unshift(unavailable);
    }
    this.source.replaceChildren(...options);
    if (unavailableValue) this.source.value = unavailableValue;
    else if (selectedOutputId) this.source.value = selectedOutputId;
    else if (this.choices[0]) this.source.value = this.choices[0].output.outputId;
    this.length.value = String(current?.length ?? 20);
    this.color.value = current?.color ?? '#63c7b2';
    this.scaleChange.checked = false;
    this.scaleGroup.hidden = true;
    this.source.disabled = this.choices.length === 0;
    const title = this.form.querySelector('header h2'); if (title) title.textContent = instanceId ? 'Moving average settings' : 'Add moving average';
    const submitLabel = this.form.querySelector<HTMLButtonElement>('button[data-composition-action="apply-composition"]');
    if (submitLabel) submitLabel.textContent = instanceId ? 'Apply' : 'Add SMA';
    this.status.textContent = unavailableValue ? 'The saved output is unavailable. Choose a current output; its reference stays unchanged until you apply a replacement.'
      : this.choices.length ? 'The line uses the output values and gaps from the selected study.'
      : choices.some(choice => choice.output.available) ? 'This study has mixed placement or special layers that cannot be grouped in a managed pane.'
        : instanceId && selectedOutputId ? 'The saved input is unavailable. Its reference stays intact until you choose a current output.'
          : 'No current numeric outputs are available.';
    const submit = this.form.querySelector<HTMLButtonElement>('button[data-composition-action="apply-composition"]');
    if (submit) submit.disabled = this.choices.length === 0;
    this.updateScaleChoice();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private updateScaleChoice() {
    const choice = this.choices.find(item => item.output.outputId === this.source.value);
    if (!this.editingInstanceId || !choice) { this.scaleGroup.hidden = true; return; }
    const unitsDiffer = this.currentUnit !== choice.output.unit;
    const scaleDiffers = Boolean(this.currentScaleId && this.currentScaleId !== choice.output.scaleId);
    this.scaleGroup.hidden = !unitsDiffer && !scaleDiffers;
    if (unitsDiffer && !this.scaleChange.checked) {
      this.status.textContent = `This output is ${choice.output.unit ?? 'unknown-unit'}. Confirm a scale change to keep the line meaningful; its current pane stays fixed.`;
    } else if (scaleDiffers && !this.scaleChange.checked) {
      this.status.textContent = 'This output uses a different price scale. Check “Use the selected output scale” to change it, or leave unchecked to keep the current scale and pane.';
    } else if (this.scaleChange.checked && (unitsDiffer || scaleDiffers)) {
      this.status.textContent = 'The selected output scale will be used. The moving average stays in its current pane.';
    } else {
      this.status.textContent = 'The line uses the output values and gaps from the selected study.';
    }
  }

  dispose() {
    this.abort.abort();
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }
}

function sameOutputReference(a: NumericOutputRef, b: NumericOutputRef) {
  return a.kind === b.kind && a.version === b.version && a.instanceId === b.instanceId && a.outputId === b.outputId
    && a.plotKey === b.plotKey && a.schemaId === b.schemaId && a.domain === b.domain && a.contextId === b.contextId && a.unit === b.unit;
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

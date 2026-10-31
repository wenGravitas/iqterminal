import { DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT, MAX_EMBEDDED_BAND_HEIGHT_PERCENT, MIN_EMBEDDED_BAND_HEIGHT_PERCENT, PRICE_PANE_ID } from '../scripts/composition';

export interface CompositionPaneChoice { id: string; title: string }

/** Explicit pane/price placement controls for managed studies. */
export class CompositionPlacementControls {
  readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly target = document.createElement('select');
  private readonly moveTogether = document.createElement('input');
  private readonly height = document.createElement('input');
  private readonly heightGroup = fieldset('Embedded bottom band');
  private readonly heightValue = document.createElement('output');
  private readonly lowerBandEnabled = document.createElement('input');
  private readonly lowerBandGroup = fieldset('Lower pane presentation');
  private readonly status = document.createElement('div');
  private readonly abort = new AbortController();
  private memberId = '';

  constructor(private readonly onApply: (memberId: string, targetId: string, moveTogether: boolean, heightPercent: number, keepLowerBottomBand: boolean) => void) {
    this.dialog.className = 'indicator-settings composition-settings';
    this.dialog.setAttribute('aria-label', 'Move indicator');
    this.form.className = 'indicator-settings-form'; this.form.noValidate = true;
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Move indicator';
    header.append(title, button('Close', 'close'));
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    const destination = fieldset('Destination');
    this.target.setAttribute('aria-label', 'Move to pane');
    destination.append(labelControl('Place in', this.target));
    const group = fieldset('Group');
    this.moveTogether.type = 'checkbox'; this.moveTogether.setAttribute('aria-label', 'Move all studies in this pane together');
    group.append(labelControl('Move all studies in this pane together', this.moveTogether));
    const note = document.createElement('p'); note.className = 'dialog-status';
    note.textContent = 'When unchecked, only this study moves and its numeric input stays connected.';
    group.append(note); fields.append(destination, group);
    this.height.type = 'range'; this.height.min = String(MIN_EMBEDDED_BAND_HEIGHT_PERCENT); this.height.max = String(MAX_EMBEDDED_BAND_HEIGHT_PERCENT); this.height.step = '1'; this.height.value = String(DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT);
    this.height.setAttribute('aria-label', 'Embedded band height');
    const heightLabel = labelControl('Height', this.height); this.heightValue.textContent = `${DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT}%`; heightLabel.append(this.heightValue);
    this.heightGroup.append(heightLabel); this.heightGroup.hidden = true; fields.append(this.heightGroup);
    this.lowerBandEnabled.type = 'checkbox'; this.lowerBandEnabled.setAttribute('aria-label', 'Use a bottom band for zero-based outputs');
    const lowerBandLabel = labelControl('Reserve a bottom band for zero-based outputs', this.lowerBandEnabled);
    const lowerBandNote = document.createElement('p'); lowerBandNote.className = 'dialog-status';
    lowerBandNote.textContent = 'Use this for Volume-like outputs in a shared lower pane. Leave it off to use the full pane.';
    this.lowerBandGroup.append(lowerBandLabel, lowerBandNote); this.lowerBandGroup.hidden = true; fields.append(this.lowerBandGroup);
    this.status.className = 'dialog-status'; this.status.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    const applyButton = button('Move', 'apply'); applyButton.classList.add('primary'); applyButton.type = 'submit';
    footer.append(button('Cancel', 'close'), applyButton);
    this.form.append(header, fields, this.status, footer); this.dialog.append(this.form);
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
      if ((event.target as HTMLElement).closest<HTMLButtonElement>('button[data-composition-placement="close"]')) this.dialog.close();
    }, { signal: this.abort.signal });
    this.target.addEventListener('change', () => {
      this.heightGroup.hidden = this.target.value !== '@price' && !this.lowerBandEnabled.checked;
      this.lowerBandGroup.hidden = this.target.value === '@price';
    }, { signal: this.abort.signal });
    this.lowerBandEnabled.addEventListener('change', () => {
      if (this.target.value !== '@price') this.heightGroup.hidden = !this.lowerBandEnabled.checked;
    }, { signal: this.abort.signal });
    this.height.addEventListener('input', () => { this.heightValue.textContent = `${this.height.value}%`; }, { signal: this.abort.signal });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      if (!this.target.value) { this.status.textContent = 'Choose a destination pane.'; return; }
      this.onApply(this.memberId, this.target.value, this.moveTogether.checked, Number(this.height.value), this.lowerBandEnabled.checked);
      this.dialog.close();
    }, { signal: this.abort.signal });
  }

  open(memberId: string, panes: readonly CompositionPaneChoice[], currentPaneId?: string, currentHeight = DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT,
    currentLowerBottomBand = false) {
    this.memberId = memberId;
    const options = [new Option('New lower pane', '@new'), new Option('Main price pane · bottom band', '@price'),
      ...panes.filter(pane => pane.id !== currentPaneId).map(pane => new Option(pane.title, pane.id))];
    this.target.replaceChildren(...options);
    this.target.value = currentPaneId === PRICE_PANE_ID ? PRICE_PANE_ID : '@new';
    this.moveTogether.checked = false;
    this.lowerBandEnabled.checked = currentLowerBottomBand;
    this.height.value = String(Math.max(MIN_EMBEDDED_BAND_HEIGHT_PERCENT, Math.min(MAX_EMBEDDED_BAND_HEIGHT_PERCENT, Math.round(currentHeight))));
    this.heightValue.textContent = `${this.height.value}%`;
    this.heightGroup.hidden = this.target.value !== '@price' && !currentLowerBottomBand;
    this.lowerBandGroup.hidden = this.target.value === '@price';
    this.status.textContent = 'Choose a destination; movement keeps the indicator worker and input reference.';
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose() { this.abort.abort(); if (this.dialog.open) this.dialog.close(); this.dialog.remove(); }
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
  result.dataset.compositionPlacement = action; return result;
}

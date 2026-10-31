import { RAW_OPEN_INTEREST_VENUES, type RawOpenInterestVenue } from '../feed/raw-open-interest';
import { openInterestSettings, openInterestVenueLabel, type OpenInterestSettings } from './open-interest-data';

export class OpenInterestControls {
  readonly dialog = document.createElement('dialog');
  private form = document.createElement('form');
  private disposed = false;
  constructor(private readonly apply: (settings: OpenInterestSettings) => void, private readonly signal?: AbortSignal) {
    this.dialog.className = 'open-interest-settings'; this.dialog.append(this.form);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'keydown'])
      this.dialog.addEventListener(type, event => event.stopPropagation(), { signal });
  }
  open(raw: unknown) {
    const settings = openInterestSettings(raw); this.form.replaceChildren();
    const header = document.createElement('header'), title = document.createElement('h2'), status = document.createElement('div');
    title.textContent = 'Open Interest sources'; const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close Open Interest settings'); close.addEventListener('click', () => this.dialog.close(), { signal: this.signal }); header.append(title, close);
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Verified BTC perpetual venues'; fieldset.append(legend);
    for (const venue of RAW_OPEN_INTEREST_VENUES) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      input.type = 'checkbox'; input.name = 'venue'; input.value = venue; input.checked = settings.venues.includes(venue); text.textContent = openInterestVenueLabel(venue);
      label.append(input, text); fieldset.append(label);
    }
    const help = document.createElement('p'); help.textContent = 'Total adds selected venues with verified BTC units. Missing or stale samples remain partial; the raw level is not estimated.';
    fields.append(fieldset, help); status.className = 'dialog-status'; status.setAttribute('role', 'status');
    const footer = document.createElement('footer'), cancel = document.createElement('button'), save = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => this.dialog.close(), { signal: this.signal });
    save.type = 'submit'; save.textContent = 'Apply'; save.className = 'primary'; footer.append(cancel, save);
    this.form.append(header, fields, status, footer);
    this.form.onsubmit = event => {
      event.preventDefault();
      const venues = [...fieldset.querySelectorAll<HTMLInputElement>('input[name="venue"]:checked')].map(input => input.value as RawOpenInterestVenue);
      if (!venues.length) { status.textContent = 'Select at least one verified venue.'; return; }
      this.apply(openInterestSettings({ ...settings, venues })); this.dialog.close();
    };
    this.dialog.showModal();
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.dialog.close(); this.dialog.remove(); }
}

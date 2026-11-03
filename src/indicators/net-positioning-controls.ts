import type { NetPositioningSettings } from './model';
import type { NetPositioningVenue } from '../feed/net-positioning';

export class NetPositioningControls {
  readonly dialog = document.createElement('dialog');
  private readonly form = document.createElement('form');
  private readonly method = document.createElement('select');
  private readonly display = document.createElement('select');
  private readonly labels = document.createElement('select');
  private readonly showLongs = document.createElement('input');
  private readonly showShorts = document.createElement('input');
  private readonly reverseOrder = document.createElement('input');
  private venues: NetPositioningVenue[] = ['binance'];
  private readonly status = document.createElement('p');
  private target = '';
  private colors: NetPositioningSettings['colors'];
  private legacyPreserved: NetPositioningSettings['legacyPreserved'];

  constructor(private readonly apply: (instanceId: string, settings: NetPositioningSettings) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings net-positioning-settings';
    this.dialog.setAttribute('aria-label', 'Net Longs & Shorts settings');
    this.form.className = 'indicator-settings-form';
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = 'Net Longs & Shorts';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    header.append(title, close);
    this.method.setAttribute('aria-label', 'Estimation inputs');
    this.method.add(new Option('Price + OI', 'price-oi'));
    this.method.add(new Option('Aggressor Flow + OI', 'aggressor-flow-oi'));
    this.display.setAttribute('aria-label', 'Display mode');
    this.display.add(new Option('Stacked', 'stacked'));
    this.display.add(new Option('Grouped', 'grouped'));
    this.labels.setAttribute('aria-label', 'Value labels');
    this.labels.add(new Option('Auto', 'auto'));
    this.labels.add(new Option('Hover only', 'hover'));
    this.labels.add(new Option('Off', 'off'));
    const methodLabel = document.createElement('label'); methodLabel.className = 'indicator-setting-field';
    const methodName = document.createElement('span'); methodName.textContent = 'Estimation inputs';
    methodLabel.append(methodName, this.method);
    const displayLabel = document.createElement('label'); displayLabel.className = 'indicator-setting-field';
    const displayName = document.createElement('span'); displayName.textContent = 'Display';
    displayLabel.append(displayName, this.display);
    const labelMode = document.createElement('label'); labelMode.className = 'indicator-setting-field';
    const labelName = document.createElement('span'); labelName.textContent = 'Value labels';
    labelMode.append(labelName, this.labels);
    const showLongsLabel = document.createElement('label'); showLongsLabel.className = 'indicator-setting-field';
    const showLongsName = document.createElement('span'); showLongsName.textContent = 'Show Longs';
    this.showLongs.type = 'checkbox'; this.showLongs.setAttribute('aria-label', 'Show Longs');
    showLongsLabel.append(showLongsName, this.showLongs);
    const showShortsLabel = document.createElement('label'); showShortsLabel.className = 'indicator-setting-field';
    const showShortsName = document.createElement('span'); showShortsName.textContent = 'Show Shorts';
    this.showShorts.type = 'checkbox'; this.showShorts.setAttribute('aria-label', 'Show Shorts');
    showShortsLabel.append(showShortsName, this.showShorts);
    const reverseOrderLabel = document.createElement('label'); reverseOrderLabel.className = 'indicator-setting-field';
    const reverseOrderName = document.createElement('span'); reverseOrderName.textContent = 'Reverse order';
    this.reverseOrder.type = 'checkbox'; this.reverseOrder.setAttribute('aria-label', 'Reverse order');
    reverseOrderLabel.append(reverseOrderName, this.reverseOrder);
    const hint = document.createElement('p'); hint.className = 'dialog-status';
    hint.textContent = 'The venue buttons control both sides. Longs and Shorts use separate signed scales in one pane; by default Longs are above Shorts. BTC quantities use recorded 30-second source intervals and belong to the candle containing each interval end. Missing, incomplete, and pre-collection intervals remain unknown. This estimate cannot distinguish opened from closed positions.';
    this.status.className = 'dialog-status'; this.status.setAttribute('role', 'status');
    const footer = document.createElement('footer');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Apply'; save.className = 'primary';
    footer.append(cancel, save);
    this.form.append(header, methodLabel, displayLabel, labelMode, showLongsLabel, showShortsLabel, reverseOrderLabel, hint, this.status, footer);
    this.dialog.append(this.form);
    const options = { signal };
    close.addEventListener('click', () => this.dialog.close(), options);
    cancel.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.apply(this.target, {
        method: this.method.value === 'aggressor-flow-oi' ? 'aggressor-flow-oi' : 'price-oi', venues: [...this.venues],
        display: this.display.value === 'grouped' ? 'grouped' : 'stacked',
        labels: this.labels.value === 'hover' || this.labels.value === 'off' ? this.labels.value : 'auto',
        showLongs: this.showLongs.checked,
        showShorts: this.showShorts.checked,
        reverseOrder: this.reverseOrder.checked,
        ...(this.colors ? { colors: { ...this.colors } } : {}),
        ...(this.legacyPreserved ? { legacyPreserved: structuredClone(this.legacyPreserved) } : {}),
      });
      this.dialog.close();
    }, options);
  }

  open(instanceId: string, settings: NetPositioningSettings) {
    this.target = instanceId;
    this.method.value = settings.method;
    this.display.value = settings.display;
    this.labels.value = settings.labels;
    this.showLongs.checked = settings.showLongs;
    this.showShorts.checked = settings.showShorts;
    this.reverseOrder.checked = settings.reverseOrder;
    this.colors = settings.colors ? { ...settings.colors } : undefined;
    this.legacyPreserved = settings.legacyPreserved ? structuredClone(settings.legacyPreserved) : undefined;
    this.venues = [...settings.venues];
    this.status.textContent = '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose() { if (this.dialog.open) this.dialog.close(); }
}

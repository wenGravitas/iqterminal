import { MarketPicker } from '../market-picker';
import { button, field } from '../ticker/ui';
import { defaultTiers, validateTiers, type Tier } from '../ticker/model';
import { TRADE_BUBBLE_SOURCES, tradeBubbleSettings, type TradeBubbleSettings } from './model';

export interface TradeTickerTierSource { id: string; label: string; tiers: Tier[] }

export class TradeBubbleControls {
  readonly dialog = document.createElement('dialog');
  private form = document.createElement('form');
  private fields = document.createElement('div');
  private error = document.createElement('p');
  private sourceStatus: HTMLElement = document.createElement('p');
  private tierRows = document.createElement('div');
  private draft = tradeBubbleSettings(undefined);
  private sourceButton = document.createElement('button');
  private profileSelect = document.createElement('select');
  private copyButton = document.createElement('button');
  private picker: MarketPicker;

  constructor(parent: HTMLElement, private signal: AbortSignal, private sources: () => TradeTickerTierSource[], private apply: (settings: TradeBubbleSettings) => void) {
    this.picker = new MarketPicker(parent);
    this.dialog.className = 'indicator-settings trade-bubble-settings';
    this.dialog.setAttribute('aria-label', 'Trade Bubbles settings');
    this.form.className = 'indicator-settings-form'; this.fields.className = 'indicator-settings-fields';
    this.error.className = 'dialog-status'; this.error.setAttribute('role', 'status');
    const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button');
    title.textContent = 'Trade Bubbles'; close.type = 'button'; close.textContent = 'Close'; header.append(title, close);
    const footer = document.createElement('footer'), cancel = document.createElement('button'), save = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel'; save.type = 'submit'; save.textContent = 'Apply'; footer.append(cancel, save);
    this.form.append(header, this.fields, this.error, footer); this.dialog.append(this.form); parent.append(this.dialog);
    const options = { signal };
    close.addEventListener('click', () => this.dialog.close(), options); cancel.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const tiers = validateTiers(this.draft.tiers);
        this.apply(tradeBubbleSettings({ ...this.draft, tiers }));
        this.dialog.close();
      } catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); }
    }, options);
  }

  open(value: unknown) {
    this.draft = structuredClone(tradeBubbleSettings(value)); this.error.textContent = ''; this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private number(parent: HTMLElement, label: string, value: number, min: number, max: number, step: string, change: (value: number) => void) {
    const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = step; input.value = String(value);
    input.setAttribute('aria-label', label); input.onchange = () => { if (Number.isFinite(input.valueAsNumber)) change(input.valueAsNumber); };
    field(parent, label, input); return input;
  }

  private select(parent: HTMLElement, label: string, values: Array<[string, string]>, current: string, change: (value: string) => void) {
    const input = document.createElement('select');
    for (const [text, value] of values) input.add(new Option(text, value));
    input.value = current; input.setAttribute('aria-label', label); input.onchange = () => change(input.value); field(parent, label, input); return input;
  }

  private toggle(parent: HTMLElement, label: string, checked: boolean, change: (checked: boolean) => void) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', label); input.onchange = () => change(input.checked); field(parent, label, input);
  }

  private color(parent: HTMLElement, label: string, value: string, change: (value: string) => void) {
    const input = document.createElement('input'); input.type = 'color'; input.value = value; input.setAttribute('aria-label', label); input.oninput = () => change(input.value); field(parent, label, input);
  }

  private render() {
    this.fields.replaceChildren(); const value = this.draft;
    this.select(this.fields, 'Source mode', [
      ['Follow chart market', 'follow-chart'], ['Choose explicit sources', 'explicit'], ['Both Binance sources', 'both'],
    ], value.sourceMode, mode => { value.sourceMode = mode as TradeBubbleSettings['sourceMode']; this.render(); });
    const supportedIds = value.sources;
    this.sourceButton = button(`Explicit sources: ${supportedIds.map(id => id === 'binance:spot' ? 'Spot' : 'USD-M Perp').join(' + ') || 'none'}`, () => this.picker.open(supportedIds, {
      multiple: true, capability: 'executions', allowed: [...TRADE_BUBBLE_SOURCES],
      apply: ids => { value.sources = TRADE_BUBBLE_SOURCES.filter(id => ids.includes(id)); this.sourceButton.textContent = `Explicit sources: ${value.sources.map(id => id === 'binance:spot' ? 'Spot' : 'USD-M Perp').join(' + ') || 'none'}`; },
    }));
    this.sourceButton.disabled = value.sourceMode !== 'explicit';
    this.sourceButton.setAttribute('aria-label', 'Choose explicit Trade Bubbles sources'); this.fields.append(this.sourceButton);
    const note = document.createElement('small'); note.className = 'trade-bubble-note';
    note.textContent = 'Release 1 reads Binance BTCUSDT Spot and USD-M aggregate trades. Hyperliquid USD charts are not silently price-converted.'; this.fields.append(note);

    this.number(this.fields, 'Minimum notional (USDT)', value.minimumNotionalUsdt, 100_000, 1e12, '1000', next => value.minimumNotionalUsdt = next);
    this.select(this.fields, 'Aggressor side', [['Both sides', 'both'], ['Buy', 'buy'], ['Sell', 'sell']], value.side, side => value.side = side as TradeBubbleSettings['side']);
    const tiers = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Tier and colour snapshot'; tiers.append(legend);
    const sources = this.sources();
    this.profileSelect = document.createElement('select'); this.profileSelect.setAttribute('aria-label', 'Trade Ticker profile to copy');
    this.profileSelect.add(new Option(sources.length ? 'Choose a Trade Ticker snapshot' : 'No Trade Ticker panels', ''));
    for (const source of sources) this.profileSelect.add(new Option(source.label, source.id));
    this.copyButton = button('Copy tier snapshot', () => this.copyTickerSnapshot()); this.copyButton.disabled = !sources.length;
    const sourceRow = document.createElement('div'); sourceRow.className = 'trade-bubble-profile-source'; sourceRow.append(this.profileSelect, this.copyButton); tiers.append(sourceRow);
    this.sourceStatus = document.createElement('small'); this.sourceStatus.className = 'trade-bubble-note';
    this.sourceStatus.textContent = sources.length ? 'Copied tiers are local snapshots. Later Trade Ticker edits do not change this overlay.' : 'No Trade Ticker panel exists; the independent default tier snapshot remains available.';
    tiers.append(this.sourceStatus);
    const tierIdValues: Array<[string, string]> = [['Any classified tier', 'all'], ...value.tiers.map(tier => [tier.name, tier.id] as [string, string])];
    this.select(tiers, 'Show tier', tierIdValues, value.tierChoice, choice => value.tierChoice = choice);
    this.select(tiers, 'Bubble colour source', [['Copied tier colours', 'tier'], ['Side colours', 'side']], value.colorMode, mode => { value.colorMode = mode as TradeBubbleSettings['colorMode']; this.render(); });
    if (value.colorMode === 'side') {
      this.color(tiers, 'Buy bubble colour', value.buyColor, color => value.buyColor = color);
      this.color(tiers, 'Sell bubble colour', value.sellColor, color => value.sellColor = color);
    }
    this.tierRows.className = 'trade-bubble-tier-rows'; this.tierRows.replaceChildren();
    const unit = value.tiers[0]?.unit ?? 'USDT';
    this.select(tiers, 'Tier threshold unit', [['USDT', 'USDT'], ['BTC', 'BTC']], unit, choice => {
      for (const tier of value.tiers) tier.unit = choice as Tier['unit']; this.render();
    });
    for (const tier of value.tiers) {
      const row = document.createElement('fieldset'); row.className = 'trade-bubble-tier-row'; const rowLegend = document.createElement('legend'); rowLegend.textContent = tier.name; row.append(rowLegend);
      const name = document.createElement('input'); name.type = 'text'; name.maxLength = 60; name.required = true; name.value = tier.name; name.setAttribute('aria-label', `${tier.name} tier name`); name.onchange = () => { tier.name = name.value; rowLegend.textContent = name.value; };
      field(row, 'Tier name', name);
      this.number(row, 'Tier minimum', tier.minimum, 0, 1e12, 'any', minimum => tier.minimum = minimum);
      this.color(row, `${tier.name} buy colour`, tier.buyColor, color => tier.buyColor = color);
      this.color(row, `${tier.name} sell colour`, tier.sellColor, color => tier.sellColor = color);
      row.append(button('Remove tier', () => { value.tiers = value.tiers.filter(item => item.id !== tier.id); if (value.tierChoice === tier.id) value.tierChoice = 'all'; this.render(); }));
      this.tierRows.append(row);
    }
    const add = button('Add tier', () => {
      if (value.tiers.length >= 12) return;
      value.tiers.push({ ...defaultTiers()[0]!, id: `bubble-tier-${crypto.randomUUID()}`, name: 'New tier', minimum: Math.max(0, ...value.tiers.map(tier => tier.minimum)) + 1, unit }); this.render();
    }); add.disabled = value.tiers.length >= 12; this.tierRows.append(add); tiers.append(this.tierRows); this.fields.append(tiers);

    const display = document.createElement('fieldset'), displayLegend = document.createElement('legend'); displayLegend.textContent = 'Marker display'; display.append(displayLegend);
    this.number(display, 'Minimum radius (px)', value.minRadius, 1, 24, '1', radius => value.minRadius = radius);
    this.number(display, 'Maximum radius (px)', value.maxRadius, 2, 32, '1', radius => value.maxRadius = radius);
    this.number(display, 'Notional at maximum radius (USDT)', value.radiusCapNotional, 100_000, 1e12, '10000', cap => value.radiusCapNotional = cap);
    this.number(display, 'Bubble opacity (%)', value.opacity * 100, 10, 100, '1', opacity => value.opacity = opacity / 100);
    this.number(display, 'Maximum visible bubbles', value.maximumVisible, 1, 500, '1', maximum => value.maximumVisible = maximum);
    this.select(display, 'Bubble labels', [['Tier', 'tier'], ['Notional', 'notional'], ['Tier and notional', 'both'], ['Off', 'off']], value.labels, labels => value.labels = labels as TradeBubbleSettings['labels']);
    const densityNote = document.createElement('small'); densityNote.className = 'trade-bubble-note'; densityNote.textContent = 'Bubble disk area scales with execution notional through the configured cap. Dense views retain the largest exact executions; separate executions are never merged.'; display.append(densityNote);
    this.fields.append(display);
  }

  private copyTickerSnapshot() {
    const source = this.sources().find(item => item.id === this.profileSelect.value);
    if (!source) { this.sourceStatus.textContent = 'Choose an available Trade Ticker panel first.'; return; }
    try {
      this.draft.tiers = validateTiers(structuredClone(source.tiers));
      if (this.draft.tierChoice !== 'all' && !this.draft.tiers.some(tier => tier.id === this.draft.tierChoice)) this.draft.tierChoice = 'all';
      this.sourceStatus.textContent = `${source.label} tiers copied. This overlay keeps its own snapshot.`;
      this.render();
    } catch (error) { this.sourceStatus.textContent = error instanceof Error ? error.message : String(error); }
  }

  dispose() { this.picker.dispose(); if (this.dialog.open) this.dialog.close(); this.dialog.remove(); }
}

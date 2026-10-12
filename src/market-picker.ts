import { markets, marketName } from './markets';
import type { ConnectionKey } from './feed/protocol';
/** Apply/Cancel drafts never mutate the host selection before Apply. */
export class MarketPicker {
  readonly element = document.createElement('dialog');
  private search = document.createElement('input');
  private list = document.createElement('div');
  private selected = document.createElement('p');
  private apply = document.createElement('button');
  private radioName = `market-${crypto.randomUUID()}`;
  private draft = new Set<ConnectionKey>();
  private options?: { multiple: boolean; capability: 'candles' | 'executions'; allowed?: ConnectionKey[]; apply(ids: ConnectionKey[]): void };
  private abort = new AbortController();
  constructor(parent: HTMLElement) {
    this.element.className = 'market-picker indicator-picker'; this.element.setAttribute('aria-label', 'Select markets');
    const header = document.createElement('header'), title = document.createElement('h2'); title.textContent = 'Markets'; header.append(title);
    this.search.type = 'search'; this.search.placeholder = 'Search symbol or venue'; this.search.setAttribute('aria-label', 'Search markets');
    const searchLabel = document.createElement('label'); searchLabel.className = 'indicator-search'; searchLabel.append(this.search);
    this.list.className = 'market-picker-list'; this.selected.className = 'market-selection'; this.selected.setAttribute('aria-live', 'polite');
    const footer = document.createElement('footer'), cancel = document.createElement('button'); cancel.textContent = 'Cancel'; this.apply.textContent = 'Apply'; this.apply.className = 'primary'; footer.append(cancel, this.apply);
    this.element.append(header, searchLabel, this.list, this.selected, footer); parent.append(this.element);
    const opt = { signal: this.abort.signal };
    this.search.addEventListener('input', () => this.render(), opt); cancel.addEventListener('click', () => this.element.close(), opt);
    this.apply.addEventListener('click', () => { this.options?.apply([...this.draft]); this.element.close(); }, opt);
  }
  open(ids: ConnectionKey[], options: NonNullable<MarketPicker['options']>) {
    this.options = options; this.draft = new Set(ids); this.search.value = ''; this.render(); this.element.showModal(); this.search.focus();
  }
  private render() {
    const o = this.options; if (!o) return;
    const query = this.search.value.toLowerCase().trim(), fragment = document.createDocumentFragment();
    for (const m of markets) {
      if (!`${m.native} ${m.venue} ${m.marketType} ${m.base}`.toLowerCase().includes(query)) continue;
      const row = document.createElement('label'); row.className = 'market-choice';
      const input = document.createElement('input'); input.type = o.multiple ? 'checkbox' : 'radio'; input.name = this.radioName; input.checked = this.draft.has(m.id);
      input.disabled = !m[o.capability] || Boolean(o.allowed && !o.allowed.includes(m.id)); input.setAttribute('aria-label', m.label);
      const copy = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = `${m.venue} · ${m.native} · ${m.marketType}`;
      detail.textContent = input.disabled ? 'Live executions not available for this selection' : `${m.quote} price · ${m.base} quantity${m.settlement ? ` · ${m.settlement} settlement` : ''}`;
      copy.append(title, detail); row.append(input, copy); fragment.append(row);
      input.onchange = () => { if (!o.multiple) this.draft.clear(); if (input.checked) this.draft.add(m.id); else this.draft.delete(m.id); this.render(); this.list.querySelector<HTMLInputElement>(`input[aria-label="${m.label}"]`)?.focus(); };
    }
    this.list.replaceChildren(fragment);
    this.selected.textContent = this.draft.size ? `Selected: ${[...this.draft].map(marketName).join(' · ')}` : 'No markets selected';
    this.apply.disabled = !o.multiple && this.draft.size !== 1;
  }
  dispose() { this.abort.abort(); if (this.element.open) this.element.close(); this.element.remove(); }
}

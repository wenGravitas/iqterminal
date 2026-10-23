export type QuantityCurrency = 'btc' | 'usdt';
export interface CurrencyPreference { enabled: boolean; currency: 'base' | 'quote' }
export const CURRENCY_STORAGE_KEY = 'basis.currency-display.v1';
export const CURRENCY_EVENT = 'basis-currency-display-change';
let sessionPreference: CurrencyPreference | undefined;
export function currencyPreference(value: unknown): CurrencyPreference {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { enabled: raw.enabled === true, currency: raw.currency === 'base' ? 'base' : 'quote' };
}
export function getCurrencyPreference(): CurrencyPreference {
  if (sessionPreference) return sessionPreference;
  try { sessionPreference = currencyPreference(JSON.parse(localStorage.getItem(CURRENCY_STORAGE_KEY) ?? 'null')); } catch { sessionPreference = currencyPreference(null); }
  return sessionPreference;
}
export function effectiveCurrency(local: QuantityCurrency): QuantityCurrency {
  const preference = getCurrencyPreference();
  return preference.enabled ? preference.currency === 'base' ? 'btc' : 'usdt' : local;
}
export function setCurrencyPreference(value: CurrencyPreference): boolean {
  sessionPreference = currencyPreference(value);
  let saved = true;
  try { localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify(sessionPreference)); } catch { saved = false; }
  window.dispatchEvent(new Event(CURRENCY_EVENT));
  return saved;
}
/** Keep the local value separate: disabling the override restores it without a layout write. */
export function syncCurrencyControl(select: HTMLSelectElement, local: QuantityCurrency) {
  const preference = getCurrencyPreference();
  select.value = effectiveCurrency(local); select.disabled = preference.enabled;
  let notice = select.parentElement?.querySelector<HTMLElement>('.global-currency-notice');
  if (!notice) {
    notice = document.createElement('small'); notice.className = 'global-currency-notice';
    notice.id = `currency-notice-${++noticeId}`;
    select.parentElement?.append(notice); select.setAttribute('aria-describedby', notice.id);
  }
  notice.hidden = !preference.enabled;
  notice.textContent = `Global currency setting is set to ${effectiveCurrency(local).toUpperCase()}. Disable the override in Global settings to change this indicator.`;
}
let noticeId = 0;

export class CurrencyDisplaySettings {
  private abort = new AbortController();
  private dialog = document.createElement('dialog');
  private enabled = document.createElement('input');
  private currency = document.createElement('select');
  private status = document.createElement('p');
  constructor(button: HTMLButtonElement) {
    this.dialog.className = 'indicator-settings global-settings'; this.dialog.setAttribute('aria-label', 'Global settings');
    const form = document.createElement('form'); form.className = 'indicator-settings-form';
    const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button');
    title.textContent = 'Global settings'; close.type = 'button'; close.textContent = 'Close'; header.append(title, close);
    this.enabled.type = 'checkbox'; this.enabled.setAttribute('aria-label', 'Override indicator currencies');
    const enabledLabel = document.createElement('label'); enabledLabel.className = 'indicator-setting-field'; enabledLabel.append('Override indicator currencies', this.enabled);
    this.currency.setAttribute('aria-label', 'Default display currency'); this.currency.add(new Option('Quote · USDT / USD', 'quote')); this.currency.add(new Option('Base · BTC', 'base'));
    const currencyLabel = document.createElement('label'); currencyLabel.className = 'indicator-setting-field'; currencyLabel.append('Default display currency', this.currency);
    const hint = document.createElement('p'); hint.className = 'dialog-status'; hint.textContent = 'Overrides quantity displays across charts, Depth Matrix and ticker volume bars. Positioning bar hovers show both currencies. Prices, calculation thresholds and trade filters keep their own units. Turn off the override to restore saved indicator choices.';
    this.status.className = 'dialog-status'; this.status.setAttribute('role', 'status');
    const footer = document.createElement('footer'), apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply'; footer.append(apply);
    form.append(header, enabledLabel, currencyLabel, hint, this.status, footer); this.dialog.append(form); document.body.append(this.dialog);
    const options = { signal: this.abort.signal };
    button.addEventListener('click', () => { const value = getCurrencyPreference(); this.enabled.checked = value.enabled; this.currency.value = value.currency; this.status.textContent = ''; this.dialog.showModal(); }, options);
    close.addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); }, options);
    form.addEventListener('submit', event => { event.preventDefault(); const saved = setCurrencyPreference({ enabled: this.enabled.checked, currency: this.currency.value === 'base' ? 'base' : 'quote' }); if (saved) this.dialog.close(); else this.status.textContent = 'Applied for this session. Browser storage is unavailable.'; }, options);
    window.addEventListener('storage', event => { if (event.key !== CURRENCY_STORAGE_KEY && event.key !== null) return; sessionPreference = undefined; window.dispatchEvent(new Event(CURRENCY_EVENT)); }, options);
  }
  dispose() { this.abort.abort(); this.dialog.close(); this.dialog.remove(); }
}

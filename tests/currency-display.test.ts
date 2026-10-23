import { afterEach, describe, expect, it, vi } from 'vitest';
import { currencyPreference } from '../src/currency-display';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('global display currency', () => {
  it('defaults the opt-in override to quote and validates saved choices', () => {
    expect(currencyPreference(null)).toEqual({ enabled: false, currency: 'quote' });
    expect(currencyPreference({ enabled: 'true', currency: 'EUR' })).toEqual({ enabled: false, currency: 'quote' });
    expect(currencyPreference({ enabled: true, currency: 'base' })).toEqual({ enabled: true, currency: 'base' });
  });
  it('projects currency without changing local choices, persists, and works without storage', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('window', new EventTarget());
    const currency = await import('../src/currency-display');
    const changed = vi.fn(); window.addEventListener(currency.CURRENCY_EVENT, changed);
    expect(currency.effectiveCurrency('btc')).toBe('btc');
    expect(currency.setCurrencyPreference({ enabled: true, currency: 'quote' })).toBe(true);
    expect(currency.effectiveCurrency('btc')).toBe('usdt');
    expect(JSON.parse(storage.get(currency.CURRENCY_STORAGE_KEY)!)).toEqual({ enabled: true, currency: 'quote' });
    currency.setCurrencyPreference({ enabled: false, currency: 'quote' });
    expect(currency.effectiveCurrency('btc')).toBe('btc');
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('denied'); } });
    expect(currency.setCurrencyPreference({ enabled: true, currency: 'base' })).toBe(false);
    expect(currency.effectiveCurrency('usdt')).toBe('btc');
    expect(changed).toHaveBeenCalledTimes(3);
  });
});

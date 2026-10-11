import { darkTheme, lightTheme, type ChartTheme } from 'openalgo-charts';

export type ThemeName = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'basis.theme.v1';
export const THEME_EVENT = 'basis-theme-change';
export function savedTheme(value: unknown): ThemeName | null { return value === 'light' || value === 'dark' ? value : null; }
export function resolveTheme(saved: unknown, prefersLight = false): ThemeName { return savedTheme(saved) ?? (prefersLight ? 'light' : 'dark'); }
export function currentTheme(): ThemeName { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }

// Ivory palette values adapted from OpenAlgo's Apache-2.0 market-profile demo themes.js.
// https://marketcalls.github.io/openalgo-charts/demos/market-profile/themes.js
// Modified: mapped chrome roles to the terminal and retained compact typography.
export const CHART_THEMES: Record<ThemeName, ChartTheme> = {
  dark: { ...darkTheme, background: '#090909', grid: '#1d1d1d', axisText: '#858585',
    axisLine: '#292929', paneSeparator: '#292929', crosshair: '#777777',
    crosshairLabelBackground: '#202020', upColor: '#58a65c', downColor: '#ad5858',
    wickUpColor: '#58a65c', wickDownColor: '#ad5858', lastPriceUp: '#58a65c',
    lastPriceDown: '#ad5858', lastPriceText: '#c7c7c7' },
  light: { ...lightTheme, background: '#f6f4ee', grid: '#e9e5dc', axisText: '#485567',
    axisLine: '#c8c7bf', paneSeparator: '#c8c7bf', crosshair: '#87929b',
    crosshairLabelBackground: '#47596b', upColor: '#167260', wickUpColor: '#167260',
    downColor: '#b54436', wickDownColor: '#b54436', lastPriceUp: '#167260',
    lastPriceDown: '#b54436', lastPriceText: '#ffffff', axisFontSize: 10 },
};

/** Global appearance only: never rebuild panels, feeds, studies or chart data. */
export class ThemeController {
  private media: MediaQueryList | undefined;
  private saved: ThemeName | null = null;
  private abort = new AbortController();
  private storageAvailable = true;
  constructor(private select: HTMLSelectElement) {
    try { this.saved = savedTheme(localStorage.getItem(THEME_STORAGE_KEY)); } catch { this.storageAvailable = false; }
    try { this.media = window.matchMedia('(prefers-color-scheme: light)'); } catch { /* No device preference: Dark. */ }
    select.value = this.saved ?? 'system';
    const options = { signal: this.abort.signal };
    select.addEventListener('change', () => {
      this.saved = savedTheme(select.value);
      try {
        if (this.saved) localStorage.setItem(THEME_STORAGE_KEY, this.saved);
        else localStorage.removeItem(THEME_STORAGE_KEY);
        this.storageAvailable = true;
      } catch { this.storageAvailable = false; }
      this.apply();
    }, options);
    this.media?.addEventListener('change', () => { if (!this.saved) this.apply(); }, options);
    window.addEventListener('storage', event => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      this.saved = savedTheme(event.newValue); select.value = this.saved ?? 'system'; this.apply();
    }, options);
    this.apply();
  }
  private apply() {
    const name = resolveTheme(this.saved, this.media?.matches);
    document.documentElement.dataset.theme = name;
    document.documentElement.style.colorScheme = name;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', name === 'light' ? '#f6f4ee' : '#080808');
    this.select.title = this.storageAvailable ? 'Theme: saved choice, otherwise device preference; Dark fallback' : 'Theme storage unavailable; this choice applies for this session';
    window.dispatchEvent(new CustomEvent<ThemeName>(THEME_EVENT, { detail: name }));
  }
  dispose() { this.abort.abort(); }
}

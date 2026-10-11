import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CHART_THEMES, resolveTheme, savedTheme } from '../src/theme';
import { liquidityTextColor } from '../src/chart/orderbook-heatmap';

describe('appearance preference', () => {
  it('prioritizes saved choices, otherwise device light, otherwise Dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme(null, true)).toBe('light');
    expect(resolveTheme(null, false)).toBe('dark'); expect(resolveTheme(undefined)).toBe('dark');
    expect(resolveTheme('corrupt', true)).toBe('light'); expect(savedTheme('{}')).toBeNull();
  });
  it('applies the same priority before app startup and tolerates inaccessible APIs', () => {
    const source = readFileSync('public/theme-init.js', 'utf8');
    for (const [saved, light, expected] of [['dark', true, 'dark'], ['light', false, 'light'], ['corrupt', true, 'light'], [null, false, 'dark']] as const) {
      const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
      runInNewContext(source, { localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: light }), document: { documentElement: root, querySelector: () => null } });
      expect(root.dataset.theme).toBe(expected); expect(root.style.colorScheme).toBe(expected);
    }
    const root = { dataset: {} as Record<string, string>, style: {} };
    runInNewContext(source, { localStorage: { getItem: () => { throw new Error('blocked'); } }, matchMedia: () => { throw new Error('missing'); }, document: { documentElement: root, querySelector: () => null } });
    expect(root.dataset.theme).toBe('dark');
  });
  it('uses the verified Ivory and original terminal Dark palettes and readable liquidity labels', () => {
    expect(CHART_THEMES.light).toMatchObject({ background: '#f6f4ee', grid: '#e9e5dc', upColor: '#167260', downColor: '#b54436' });
    expect(CHART_THEMES.dark).toMatchObject({ background: '#090909', upColor: '#58a65c', downColor: '#ad5858' });
    expect(liquidityTextColor(0, .05, CHART_THEMES.light.background)).toBe('#000000');
    expect(liquidityTextColor(255, .05, CHART_THEMES.dark.background)).toBe('#ffffff');
    expect(liquidityTextColor(255, .8, CHART_THEMES.dark.background)).toBe('#000000');
  });
});

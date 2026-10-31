import { addIndicator, expectHeatmapLiveQuiet, setFootprint, setPriceLevel, setUnits, footprintSettings } from './indicator-actions';
import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';

const preference = 'basis.theme.v1';
async function ready(page: import('@playwright/test').Page) {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((p: any) => p.bars === 5000 && p.renderer.draws > 0));
}

test('saved preference, live device preference, corrupt preference and Dark fallback', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(key => { if (!localStorage.getItem(key)) localStorage.setItem(key, 'dark'); }, preference);
  await ready(page);
  const root = page.locator('html'), picker = page.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await picker.selectOption('system'); await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(key => localStorage.getItem(key), preference)).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await expect(root).toHaveAttribute('data-theme', 'light');
  await picker.selectOption('dark'); await page.reload(); await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(key => localStorage.setItem(key, 'corrupt'), preference); await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light'); await expect(picker).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'no-preference' }); await expect(root).toHaveAttribute('data-theme', 'dark');
  await picker.selectOption('light'); await page.goto('/licenses/');
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await root.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(246, 244, 238)');
});

test('storage and media API failures do not prevent chart startup or session theme changes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Blocked storage'); };
    Storage.prototype.setItem = () => { throw new Error('Blocked storage'); };
    Storage.prototype.removeItem = () => { throw new Error('Blocked storage'); };
    (window as any).matchMedia = undefined;
  });
  await ready(page); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveAttribute('title', /session/);
  expect(errors).toEqual([]);
});

test('saved theme changes synchronize between browser tabs', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await ready(page);
  const other = await context.newPage(); await other.emulateMedia({ colorScheme: 'dark' }); await ready(other);
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(other.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('light');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('system');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark'); await other.close();
});

test('themes restyle candles, footprint, liquidity, editor and hidden charts without resetting data or viewport', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const worker = await installDepthFixture(page), panel = page.locator('.candle-panel').first();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await addIndicator(panel, 'Order-book Heatmap');
  await expectHeatmapLiveQuiet(panel);
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, row: number, callback: any) => {
      const time = Math.floor(Date.now()/60000)*60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, revision: 1, rowSize: row, open: 82990, high: 83010, low: 82980, close: 83000,
        delta: 1, minDelta: 0, maxDelta: 1, cells: [{ price: 83000, bidVol: 1, askVol: 2 }], coverage: 'partial', gapBefore: false }], retentionStart: time,
        status: { state: 'live', message: 'Explicit test executions', lastUpdate: Date.now(), tickSize: .1, rowSize: row, collectionStartedAt: Date.now(), coverage: 'partial' } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.bins)).toBeGreaterThan(0);
  const baseline = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, e = p.engine;
    t.themeEngine = e; t.themeHeatmap = e.heatmap; t.themeFootprint = e.footprint;
    e.chart.panes()[0].priceScale.setFixedRange({ min: 82900, max: 83100 }); e.chart.setAutoScale(false);
    return { start: p.diagnostics().heatmap.status.collectionStart, bars: e.footprintBars.length, range: e.visibleRange() };
  });
  const picker = page.getByRole('combobox', { name: 'Theme', exact: true });
  const socketsBeforeTheme = await worker.evaluate(() => (self as any).__heatmapFixture.sockets);
  for (const name of ['light', 'dark'] as const) {
    await picker.selectOption(name);
    await expect(page.locator('html')).toHaveAttribute('data-theme', name);
    const state = await page.evaluate(() => {
      const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, e = p.engine;
      return { sameEngine: e === t.themeEngine, sameHeatmap: e.heatmap === t.themeHeatmap, sameFootprint: e.footprint === t.themeFootprint,
        theme: e.chart.theme(), colors: e.footprint.options(), range: e.visibleRange(), prices: e.chart.panes()[0].priceScale.priceRange(),
        bars: e.footprintBars.length, start: p.diagnostics().heatmap.status.collectionStart,
        allThemes: [...t.panels.values()].map((p: any) => p.engine.chart.theme().background) };
    });
    expect(state.sameEngine && state.sameHeatmap && state.sameFootprint).toBe(true);
    expect(state.start).toBe(baseline.start); expect(state.bars).toBe(baseline.bars); expect(state.range).toEqual(baseline.range);
    expect(state.prices).toEqual({ min: 82900, max: 83100 }); expect(state.colors.buyColor).toBe(state.theme.upColor);
    expect(state.allThemes.every((b: string) => b === (name === 'light' ? '#f6f4ee' : '#090909'))).toBe(true);
    await page.screenshot({ path: `artifacts/theme-${name}-1366x768.png` });
  }
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await panel.getByRole('button', { name: 'Add EMA overlay', exact: true }).click();
  const indicatorDialog = panel.getByRole('dialog', { name: 'Add an indicator', exact: true });
  await expect(indicatorDialog.locator('.dialog-status')).toContainText('added');
  await indicatorDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { const t = (window as any).__terminal; t.openEditor([...t.panels.keys()][0]); });
  await expect(page.locator('.script-editor-panel')).toBeVisible();
  await picker.selectOption('light');
  expect(await page.locator('.script-source').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 254, 250)');
  await page.setViewportSize({ width: 720, height: 860 });
  for (const name of ['light', 'dark'] as const) { await picker.selectOption(name); await page.screenshot({ path: `artifacts/theme-${name}-editor-720x860.png` }); }
  await page.evaluate(() => { const t = (window as any).__terminal; t.dock.getPanel([...t.panels.keys()][0]).api.setActive(); });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].renderer.draws)).toBeGreaterThan(0);
  const depth = await worker.evaluate(() => (self as any).__heatmapFixture);
  expect(depth.sockets).toBe(socketsBeforeTheme); expect(depth.active).toBe(1); expect(errors).toEqual([]);
});

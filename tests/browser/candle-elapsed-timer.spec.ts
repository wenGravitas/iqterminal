import { test, expect } from '@playwright/test';
import { setFootprint } from './indicator-actions';

test('elapsed timer increments, resets, hides expired candles, and persists its chart setting', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => [...(window as any).__terminal.panels.values()].every((p: any) => p.engine?.latestCandle()));
  for (const chart of await page.locator('.candle-panel').all()) await chart.locator('.chart-object-tree-collapse').click();
  const panel = page.locator('.candle-panel').first();
  const readTimer = () => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.candleTimerDiagnostics());
  const start = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.latestCandle().time * 1000);
  const clock = async (now: number) => page.evaluate(value => {
    (window as any).__timerNow = value; Date.now = () => (window as any).__timerNow;
    for (const p of (window as any).__terminal.panels.values()) p.engine.tickCandleTimer();
  }, now);
  await clock(start + 16000);
  await expect.poll(async () => (await readTimer()).geometry?.text).toBe('00:16');
  await clock(start + 18000);
  await expect.poll(async () => (await readTimer()).geometry?.text).toBe('00:18');
  await page.screenshot({ path: 'artifacts/candle-elapsed-timer-dark.png' });

  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click();
  const option = panel.getByRole('checkbox', { name: 'Candle elapsed timer', exact: true });
  await expect(option).toBeChecked(); await option.uncheck();
  await expect.poll(async () => (await readTimer()).geometry).toBeNull();
  await panel.locator('.chart-settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => [...(window as any).__terminal.panels.values()].every((p: any) => p.engine?.latestCandle()));
  await clock(start + 18000);
  await panel.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await expect(option).not.toBeChecked(); await option.check();
  await panel.locator('.chart-settings').getByRole('button', { name: 'Close', exact: true }).click();

  // Explicit synthetic source for the same chart's Footprint presentation.
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _series: any, rowSize: number, callback: any) => {
      const time = Math.floor(Date.now() / 60000) * 60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells: [{ price: 83000, bidVol: 1, askVol: 2, bidNotional: 83000, askNotional: 166000 }], open: 83000, high: 83010, low: 83000, close: 83010, delta: 1, minDelta: 0, maxDelta: 1, quoteDelta: 83000, minQuoteDelta: 0, maxQuoteDelta: 83000, coverage: 'partial', gapBefore: false }], retentionStart: time, status: { state: 'live', message: 'Explicit timer test fixture', lastUpdate: Date.now(), collectionStartedAt: Date.now(), coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await clock(start + 19000);
  await expect.poll(async () => (await readTimer()).geometry?.text).toMatch(/^00:\d{2}$/);
  await page.screenshot({ path: 'artifacts/candle-elapsed-timer-footprint.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(async () => (await readTimer()).geometry?.text).toBe('00:19');
  await page.screenshot({ path: 'artifacts/candle-elapsed-timer-light-narrow.png' });

  await clock(start + 79000);
  await expect.poll(async () => (await readTimer()).geometry).toBeNull();
  await page.evaluate(() => {
    const engine = [...(window as any).__terminal.panels.values()][0].engine;
    const bar = engine.latestCandle();
    engine.setDisplayMode('candle');
    engine.setSnapshot([{ t: Math.floor(Date.now() / 60000) * 60000, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: 1, revision: 1, closed: false }]);
    engine.resetView();
  });
  await clock(start + 80000);
  await expect.poll(async () => (await readTimer()).geometry?.text).toMatch(/^00:\d{2}$/);
  expect(errors).toEqual([]);
});

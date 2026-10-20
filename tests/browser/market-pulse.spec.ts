import { test, expect } from '@playwright/test';
import { installTradeFixture } from './trade-fixture';

test.use({ timezoneId: 'America/New_York' });

const waitForFixture = async (page: import('@playwright/test').Page) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000));
};

test('Market Pulse opens accessibly, changes zones in place, persists separately, and formats existing ticker rows', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const worker = await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker').first();
  await page.evaluate(() => {
    const panels = (window as any).__terminal.dock.panels.filter((panel: any) => panel.view.contentComponent === 'candle');
    panels[1].api.moveTo({ group: panels[0].api.group }); panels[0].api.setActive();
  });
  await worker.evaluate(() => (self as any).__tradeFixture.emit(2, 'buy', undefined, 0));
  const row = ticker.locator('.ticker-table .ticker-row').first();
  await expect(row).toHaveCount(1);
  await expect(row.locator('td').first()).toContainText(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  await expect(ticker.locator('.ticker-table th[data-column="time"]')).toHaveText('Time · Local');
  const localCell = await row.locator('td').first().textContent();
  const existingRow = await row.elementHandle();

  const trigger = page.locator('#market-pulse-trigger');
  await expect(trigger).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(trigger.locator('[data-clock-icon]')).toHaveCount(1);
  await expect(trigger.locator('[data-zone-short]')).toHaveText(/^(EDT|EST|UTC[+−]\d{2}(?::\d{2})?)$/);
  await expect(trigger.locator('.market-pulse-chevron')).toHaveCount(1);
  await expect(trigger.locator('[data-session-indicator]')).toHaveAttribute('data-state', /active|closed|unknown/);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Market Pulse' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-clock-large]')).toHaveText(/\d{2}:\d{2}:\d{2}/);
  await expect(dialog.locator('[data-clock-date]')).toContainText(/202\d/);
  await expect(dialog.locator('[data-clock-offset]')).toHaveText(/^UTC[+−]\d{2}:\d{2}$/);
  await expect(dialog.locator('[data-clock-zone]')).toHaveText('America/New_York');
  await expect(dialog.getByRole('button', { name: 'Local', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('[data-market-statuses] .market-pulse-status-row')).toHaveCount(6);
  await expect(dialog.locator('[data-market-statuses] .market-pulse-state-dot[data-state]')).toHaveCount(6);
  await expect(dialog.locator('[data-next-event-label]')).toHaveText(/opens|closes|resumes|maintenance|unverified/i);
  await expect(dialog.locator('[data-next-event-time]')).toHaveAttribute('datetime', /^202\d-/);
  await expect(dialog.locator('[data-next-event-time]')).toContainText(/UTC[+−]\d{2}:\d{2}/);
  await expect(dialog.locator('[data-next-event-time]')).toContainText(/America\/|Europe\/|Asia\/|Australia\/|Chicago/);
  await expect(dialog.locator('[data-next-event-countdown]')).toContainText(/in|unverified/i);
  const activeBeforeShortcut = await page.evaluate(() => (window as any).__terminal.dock.activePanel.id);
  await page.keyboard.press('Alt+2');
  expect(await page.evaluate(() => (window as any).__terminal.dock.activePanel.id)).toBe(activeBeforeShortcut);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Alt+2');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.dock.activePanel.id)).not.toBe(activeBeforeShortcut);

  await trigger.click();
  const utc = dialog.getByRole('button', { name: 'UTC', exact: true });
  const beforeSwitch = await page.evaluate(() => {
    const t = (window as any).__terminal, panel = [...t.panels.values()][0], chart = panel.engine.chart;
    chart.timeScale.setVisibleLogicalRange({ from: 1000, to: 1100 });
    const time = chart.dataLayer.indexToTime(chart.dataLayer.length - 1);
    panel.engine.drawings.add({ tool: 'horizontal-line', paneIndex: 0, points: [{ time, price: 83000 }], style: { color: '#58a65c', lineWidth: 1 }, visible: true });
    return {
      panels: [...t.panels.values()].map((view: any) => ({
        bars: view.engine.chart.primaryBars().length,
        range: view.engine.chart.timeScale.visibleRange(),
        drawings: view.engine.drawings.drawings().map((drawing: any) => drawing.id),
      })),
      candleSubscriptions: [...t.feed.current.entries()], tickerSubscriptions: [...t.feed.currentTicker.entries()],
      layout: localStorage.getItem('basis.layout.v1'),
    };
  });
  await page.waitForTimeout(350);
  beforeSwitch.layout = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await utc.click();
  await expect(utc).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#market-pulse-trigger [data-zone-short]')).toHaveText('UTC');
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()].map((panel: any) => panel.engine.chart.timezone()))).toEqual(['UTC', 'UTC']);
  await expect(ticker.locator('.ticker-table th[data-column="time"]')).toHaveText('Time · UTC');
  const utcCell = await row.locator('td').first().textContent();
  expect(utcCell).not.toBeNull(); expect(utcCell).not.toBe(localCell);
  expect(await existingRow!.evaluate(node => node.isConnected)).toBe(true);
  await expect.poll(() => row.getAttribute('aria-label')).toContain('UTC');
  expect(await row.getAttribute('data-execution-id')).toContain('agg:1');

  const afterSwitch = await page.evaluate(() => {
    const t = (window as any).__terminal;
    const panels = [...t.panels.values()].map((panel: any) => ({
      bars: panel.engine.chart.primaryBars().length,
      range: panel.engine.chart.timeScale.visibleRange(),
      drawings: panel.engine.drawings.drawings().map((drawing: any) => drawing.id),
    }));
    const candleSubscriptions = [...t.feed.current.entries()];
    const tickerSubscriptions = [...t.feed.currentTicker.entries()];
    return { panels, candleSubscriptions, tickerSubscriptions, layout: localStorage.getItem('basis.layout.v1'), timezone: localStorage.getItem('basis.market-pulse.timezone.v1') };
  });
  expect(afterSwitch.timezone).toBe('UTC');
  expect(afterSwitch.panels.map(panel => panel.bars)).toEqual(beforeSwitch.panels.map(panel => panel.bars));
  expect(afterSwitch.panels.map(panel => panel.range)).toEqual(beforeSwitch.panels.map(panel => panel.range));
  expect(afterSwitch.panels.map(panel => panel.drawings)).toEqual(beforeSwitch.panels.map(panel => panel.drawings));
  expect(afterSwitch.candleSubscriptions).toEqual(beforeSwitch.candleSubscriptions);
  expect(afterSwitch.tickerSubscriptions).toEqual(beforeSwitch.tickerSubscriptions);
  expect(afterSwitch.layout).toBe(beforeSwitch.layout);
  expect(afterSwitch.tickerSubscriptions).toHaveLength(1);

  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '5m' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.panels.size)).toBe(3);
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()].map((panel: any) => panel.engine.chart.timezone()))).toEqual(['UTC', 'UTC', 'UTC']);
  await page.evaluate(() => { const t = (window as any).__terminal; for (const panel of [...t.dock.panels]) if (panel.view.contentComponent === 'trade-ticker') t.dock.removePanel(panel); });
  const layoutBeforeReload = await page.evaluate(() => localStorage.getItem('basis.layout.v1'));
  await page.waitForTimeout(350); await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 3);
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()].map((panel: any) => panel.engine.chart.timezone()))).toEqual(['UTC', 'UTC', 'UTC']);
  expect(await page.evaluate(() => localStorage.getItem('basis.market-pulse.timezone.v1'))).toBe('UTC');
  expect(layoutBeforeReload).not.toBeNull();
  expect(errors).toEqual([]);
});

test('Market Pulse timeline remains in the viewport in Dark, Ivory, and narrow layouts', async ({ page }) => {
  await waitForFixture(page);
  const trigger = page.locator('#market-pulse-trigger');
  await trigger.click();
  const popover = page.getByRole('dialog', { name: 'Market Pulse' });
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-market-timeline]')).toHaveAttribute('aria-label', /twenty-four elapsed-hour market session timeline/i);
  await expect(popover.locator('[data-timeline-labels] .market-pulse-timeline-label')).toHaveCount(6);
  await expect(popover.locator('[data-timeline-ticks] .market-pulse-tick')).toHaveCount(5);
  const labelSize = await popover.locator('[data-timeline-ticks] .market-pulse-tick').first().evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(labelSize).toBeGreaterThanOrEqual(9);
  await expect(popover.locator('[data-now-label]')).toBeVisible();
  await expect(popover.locator('[data-now-label]')).toHaveText('NOW');
  const timelineBeforeRoll = await page.evaluate(() => (window as any).__terminal.marketPulse.diagnostics());
  await page.evaluate(roll => (window as any).__terminal.marketPulse.updateClock(roll + 1000), timelineBeforeRoll.timelineRefreshAt);
  expect(await page.evaluate(() => (window as any).__terminal.marketPulse.diagnostics().timelineStart)).toBeGreaterThan(timelineBeforeRoll.timelineStart);
  const beforeMaintenance = await page.evaluate(() => Date.now());
  const maintenanceTarget = await page.evaluate(() => {
    const now = new Date();
    for (let addDays = 0; addDays < 8; addDays++) {
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays, 16, 59, 30, 0);
      const weekday = target.getDay();
      if (target.getTime() > Date.now() && weekday >= 1 && weekday <= 5) return target.getTime();
    }
    throw new Error('Could not find the next weekday CME maintenance edge');
  });
  expect(maintenanceTarget).toBeGreaterThan(beforeMaintenance);
  await page.evaluate(target => {
    const pulse = (window as any).__terminal.marketPulse;
    clearInterval(pulse.timer);
    pulse.timer = undefined;
    pulse.refreshSchedule(target, true);
    pulse.updateClock(target);
  }, maintenanceTarget);
  await expect(popover.locator('[data-next-event-label]')).toContainText('CME BTC maintenance starts');
  await expect(popover.locator('[data-next-event-countdown]')).toHaveText('in 30s');
  await expect(popover.locator('.market-pulse-interval[data-phase="active"]')).not.toHaveCount(0);
  await expect(popover.locator('.market-pulse-interval[data-phase="future"]')).not.toHaveCount(0);
  await expect(popover.locator('.market-pulse-interval[data-phase="past"]')).not.toHaveCount(0);
  await page.locator('#theme').selectOption('dark');
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'artifacts/market-pulse-dark-1366x768.png' });
  await page.locator('#theme').selectOption('light');
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'artifacts/market-pulse-ivory-1366x768.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const triggerBox = await trigger.boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(triggerBox).not.toBeNull(); expect(popoverBox).not.toBeNull();
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0); expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(390);
  await expect(popover.locator('.market-pulse-status-row')).toHaveCount(6);
  await page.screenshot({ path: 'artifacts/market-pulse-ivory-390x844.png' });
  await page.evaluate(() => (window as any).__terminal.marketPulse.startTimer());
  const clock = page.locator('#market-pulse-trigger [data-clock]');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketPulse.timerRunning)).toBe(false);
  const frozenClock = await clock.textContent();
  await page.waitForTimeout(1100);
  expect(await clock.textContent()).toBe(frozenClock);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().marketPulse.timerRunning)).toBe(true);
  await expect.poll(() => clock.textContent()).not.toBe(frozenClock);
  await page.locator('#theme').selectOption('dark');
  await page.locator('#theme').click(); // An outside interaction closes the panel without losing its focus owner.
  await expect(popover).toBeHidden();
});

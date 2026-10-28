import { addIndicator, chooseChartMarket } from './indicator-actions';
import { expect, test, type Browser, type Page } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });

async function workerTpoDiagnostics(page: Page) {
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics.tpo)).toBeTruthy();
  return page.evaluate(() => (window as any).__terminal.feed.diagnostics.tpo);
}

async function waitForTpoGeometry(page: Page, minimumSessions: number) {
  await expect.poll(() => page.evaluate((minimum: number) => {
    const panel = (window as any).__terminal.stats().panels[0], geometry = panel.tpo.geometry;
    const frame = [geometry.dpr, geometry.plotWidth, geometry.plotHeight, geometry.visibleFrom, geometry.visibleTo];
    const sessions = geometry.sessions.every((session: any) => {
      const coordinates = [session.dayStart, session.dayEnd, session.left, session.right, session.clippedLeft, session.clippedRight];
      return coordinates.every(Number.isFinite) && session.dayStart % 86_400_000 === 0
        && session.dayEnd - session.dayStart === 86_400_000 && session.right > session.left
        && session.clippedLeft >= 0 && session.clippedRight <= geometry.plotWidth && session.clippedRight > session.clippedLeft;
    });
    return panel.tpo.profiles > 0 && frame.every(Number.isFinite) && geometry.plotWidth > 0
      && geometry.sessions.length >= minimum && sessions;
  }, minimumSessions)).toBe(true);
}

test('UTC TPO settings preserve its worker group, apply colors and retry the chart client', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000 && panel.renderer?.draws > 0));
  const closeButtons = page.getByRole('button', { name: /^Close / });
  if (await closeButtons.count() > 1) await closeButtons.nth(1).click();
  const panel = page.locator('.candle-panel').first();
  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.venue)).toBe('hyperliquid');
  await addIndicator(panel, 'EMA overlay');
  await addIndicator(panel, 'UTC TPO Profile');
  const tpo = panel.locator('.active-indicator[data-definition-id="native.tpo"]');
  const ema = panel.locator('.active-indicator:has-text("EMA overlay")');
  await expect(tpo).toBeVisible(); await expect(ema).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.sessions)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.profiles)).toBeGreaterThan(0);
  const collapse = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await collapse.count()) await collapse.click();

  const beforeSettings = await workerTpoDiagnostics(page);
  await tpo.getByRole('button', { name: 'UTC TPO Profile settings', exact: true }).click();
  const dialog = panel.locator('dialog.tpo-settings');
  await expect(dialog.locator('fieldset')).toHaveCount(6);
  for (const [index, group] of ['Profile', 'Appearance', 'POC and value area', 'Opening range', 'Initial balance', 'Naked levels'].entries()) await expect(dialog.locator('legend').nth(index)).toHaveText(group);
  const rowTicks = dialog.getByLabel('Row ticks (auto or integer)', { exact: true });
  await rowTicks.fill('0'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await rowTicks.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await rowTicks.fill('auto'); expect(await rowTicks.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await dialog.getByLabel('Profile color', { exact: true }).fill('#33aa77');
  await dialog.getByLabel('Profile labels', { exact: true }).selectOption('letters');
  await dialog.getByLabel('Color theme', { exact: true }).selectOption('chart');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.settings.profileColor)).toBe('#33aa77');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.settings.theme)).toBe('chart');
  const afterAppearance = await workerTpoDiagnostics(page);
  expect(afterAppearance.groups).toHaveLength(beforeSettings.groups.length);
  expect(afterAppearance.groups[0].clients).toBe(beforeSettings.groups[0].clients);
  expect(afterAppearance.pagesFetched).toBe(beforeSettings.pagesFetched);
  expect(afterAppearance.profileRecomputes).toBe(beforeSettings.profileRecomputes);
  await expect(ema).toBeVisible();

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.interval)).toBe('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].bars)).toBeGreaterThan(100);
  await page.evaluate(() => {
    const owner = [...(window as any).__terminal.panels.values()][0];
    owner.engine.setRange({ from: owner.engine.barCount - 385, to: owner.engine.barCount - 1 });
  });
  await waitForTpoGeometry(page, 3);

  const profileState = await page.evaluate(() => {
    const panel = (window as any).__terminal.stats().panels[0];
    return { draws: panel.tpo.draws, rows: panel.tpo.rows, profiles: panel.tpo.profiles, geometry: panel.tpo.geometry };
  });
  expect(profileState.geometry.dpr).toBe(1);
  expect(profileState.geometry.sessions.length).toBeGreaterThanOrEqual(3);
  for (const session of profileState.geometry.sessions) {
    expect(session.dayStart % 86_400_000).toBe(0); expect(session.dayEnd - session.dayStart).toBe(86_400_000);
    expect(session.right).toBeGreaterThan(session.left);
    expect(session.clippedLeft).toBeGreaterThanOrEqual(0); expect(session.clippedRight).toBeLessThanOrEqual(profileState.geometry.plotWidth);
    expect(session.clippedRight).toBeGreaterThan(session.clippedLeft);
  }
  const appTheme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const beforeTheme = await workerTpoDiagnostics(page);
  let previousDraws = profileState.draws;
  for (const theme of ['light', 'dark'] as const) {
    await appTheme.selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.draws)).toBeGreaterThan(previousDraws);
    const state = await page.evaluate(() => {
      const panel = (window as any).__terminal.stats().panels[0];
      return { draws: panel.tpo.draws, profiles: panel.tpo.profiles, geometry: panel.tpo.geometry };
    });
    expect(state.profiles).toBeGreaterThan(0);
    expect(state.geometry.dpr).toBe(1);
    expect(state.geometry.sessions.length).toBeGreaterThanOrEqual(3);
    previousDraws = state.draws;
    await page.screenshot({ path: `artifacts/tpo-${theme}-1366x768.png` });
  }
  const afterTheme = await workerTpoDiagnostics(page);
  expect(afterTheme.profileRecomputes).toBe(beforeTheme.profileRecomputes);
  expect(afterTheme.pagesFetched).toBe(beforeTheme.pagesFetched);

  await tpo.getByRole('button', { name: 'UTC TPO Profile settings', exact: true }).click();
  await dialog.getByLabel('Row ticks (auto or integer)', { exact: true }).fill('800');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.settings.rowTicks)).toBe(800);
  await page.evaluate(() => {
    const owner = [...(window as any).__terminal.panels.values()][0];
    owner.engine.setRange({ from: owner.engine.barCount - 160, to: owner.engine.barCount - 1 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.lettersDrawn)).toBeGreaterThan(0);
  await waitForTpoGeometry(page, 2);
  await page.screenshot({ path: 'artifacts/tpo-letters-1366x768.png' });
  await tpo.getByRole('button', { name: 'UTC TPO Profile settings', exact: true }).click();
  await dialog.getByLabel('Profile labels', { exact: true }).selectOption('blocks');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.settings.profileMode)).toBe('blocks');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.blockCells)).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/tpo-blocks-1366x768.png' });
  await page.evaluate(() => {
    const owner = [...(window as any).__terminal.panels.values()][0];
    owner.engine.setRange({ from: owner.engine.barCount - 385, to: owner.engine.barCount - 1 });
  });
  await waitForTpoGeometry(page, 3);

  await dialog.evaluate((element: HTMLDialogElement) => element.showModal());
  await dialog.getByLabel('Bracket duration (minutes)', { exact: true }).selectOption('15');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.settings.bracketMinutes)).toBe(15);
  const afterCalculation = await workerTpoDiagnostics(page);
  expect(afterCalculation.pagesFetched).toBe(afterAppearance.pagesFetched);
  expect(afterCalculation.groups).toHaveLength(1);
  expect(afterCalculation.profileRecomputes).toBeGreaterThan(afterAppearance.profileRecomputes);

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.interval)).toBe('5m');
  await expect(ema).toBeVisible(); await expect(tpo).toBeVisible();
  await page.evaluate(() => {
    const feed = (window as any).__terminal.feed, send = feed.send.bind(feed);
    feed.__tpoRetries = [];
    feed.send = (command: any) => { if (command.type === 'tpo-retry') feed.__tpoRetries.push(command.id); send(command); };
  });
  await tpo.getByRole('button', { name: 'UTC TPO Profile settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Retry history', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.__tpoRetries.length)).toBe(1);
  const retry = await page.evaluate(() => {
    const feed = (window as any).__terminal.feed;
    return { sent: feed.__tpoRetries[0], current: [...feed.currentTpo.values()][0] };
  });
  expect(retry.sent).toBe(retry.current);
  await expect(ema).toBeVisible();

  await page.waitForTimeout(350); // let the layout's debounced local persistence settle
  await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.profiles)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const settings = (window as any).__terminal.stats().panels[0].tpo.settings;
    return [settings.profileMode, settings.bracketMinutes, settings.profileColor];
  })).toEqual(['blocks', 15, '#33aa77']);
  await workerTpoDiagnostics(page);
  const reloadedPanel = page.locator('.candle-panel').first();
  const beforeTimezone = await page.evaluate(() => ({
    days: (window as any).__terminal.stats().panels[0].tpo.geometry.sessions.map((session: any) => session.dayStart),
    calculations: (window as any).__terminal.feed.diagnostics.tpo.profileRecomputes,
    pages: (window as any).__terminal.feed.diagnostics.tpo.pagesFetched,
  }));
  await page.locator('#market-pulse-trigger').click();
  const pulse = page.getByRole('dialog', { name: 'Market Pulse' });
  await pulse.getByRole('button', { name: 'UTC', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.timezone())).toBe('UTC');
  await pulse.getByRole('button', { name: 'Local', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.timezone())).toBe('America/New_York');
  const afterTimezone = await page.evaluate(() => ({
    days: (window as any).__terminal.stats().panels[0].tpo.geometry.sessions.map((session: any) => session.dayStart),
    calculations: (window as any).__terminal.feed.diagnostics.tpo.profileRecomputes,
    pages: (window as any).__terminal.feed.diagnostics.tpo.pagesFetched,
  }));
  expect(afterTimezone).toEqual(beforeTimezone);
  await page.keyboard.press('Escape');

  await chooseChartMarket(reloadedPanel, 'Binance · BTCUSDT Spot');
  await expect.poll(() => page.evaluate(() => {
    const series = (window as any).__terminal.stats().panels[0].series;
    return [series.venue, series.market];
  })).toEqual(['binance', 'spot']);
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.geometry.sessions.length)).toBe(0);
  await expect.poll(async () => (await workerTpoDiagnostics(page)).groups.map((group: any) => group.key)).toEqual([expect.stringContaining('binance:spot:BTCUSDT:tpo:1m')]);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.profiles)).toBeGreaterThan(0);
});

test('UTC TPO uses plot CSS coordinates on a DPR 2 canvas across UTC day boundaries', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000 && panel.renderer?.draws > 0));
  const closeButtons = page.getByRole('button', { name: /^Close / });
  if (await closeButtons.count() > 1) await closeButtons.nth(1).click();
  const panel = page.locator('.candle-panel').first();
  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.venue)).toBe('hyperliquid');
  await addIndicator(panel, 'UTC TPO Profile');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.profiles)).toBeGreaterThan(0);
  const collapse = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await collapse.count()) await collapse.click();
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.interval)).toBe('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].bars)).toBeGreaterThan(100);
  await page.evaluate(() => {
    const owner = [...(window as any).__terminal.panels.values()][0];
    owner.engine.setRange({ from: owner.engine.barCount - 385, to: owner.engine.barCount - 1 });
  });
  await waitForTpoGeometry(page, 3);
  const state = await page.evaluate(() => {
    const panel = (window as any).__terminal.stats().panels[0], canvases = [...document.querySelectorAll('canvas')].map((canvas: any) => {
      const rect = canvas.getBoundingClientRect(); return rect.width ? canvas.width / rect.width : 0;
    });
    return { tpo: panel.tpo, canvases, viewport: innerWidth };
  });
  expect(state.tpo.geometry.dpr).toBe(2);
  expect(state.tpo.geometry.plotWidth).toBeLessThan(state.viewport);
  expect(state.canvases.some((ratio: number) => Math.abs(ratio - 2) < .12)).toBe(true);
  for (const session of state.tpo.geometry.sessions) {
    expect(session.dayStart % 86_400_000).toBe(0); expect(session.dayEnd - session.dayStart).toBe(86_400_000);
    expect(session.clippedLeft).toBeGreaterThanOrEqual(0); expect(session.clippedRight).toBeLessThanOrEqual(state.tpo.geometry.plotWidth);
    expect(session.clippedRight).toBeGreaterThan(session.clippedLeft);
  }
  await page.screenshot({ path: 'artifacts/tpo-dpr2-three-utc-days.png' });
  await context.close();
});

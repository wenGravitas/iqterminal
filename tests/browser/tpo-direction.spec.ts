import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ timezoneId: 'America/New_York' });

test('UTC TPO letters start at the day boundary and advance left to right', async ({ page }) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.fillText;
    (window as any).__tpoBracketDraws = [];
    (window as any).__captureTpoBrackets = false;
    prototype.fillText = function (text: string, x: number, y: number, ...rest: number[]) {
      if ((window as any).__captureTpoBrackets && /^[A-Xa-x]$/.test(text) && this.font.includes('ui-monospace')) {
        (window as any).__tpoBracketDraws.push({ text, x, y });
      }
      return original.call(this, text, x, y, ...rest);
    };
  });
  await page.goto('/?fixture=1&fixtureTime=now');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.every((panel: any) => panel.bars === 5000 && panel.renderer?.draws > 0));
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'UTC TPO Profile');
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.interval)).toBe('15m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].bars)).toBeGreaterThan(100);
  await panel.getByRole('button', { name: 'UTC TPO Profile settings', exact: true }).click();
  const dialog = panel.locator('dialog.tpo-settings');
  await dialog.getByLabel('Row ticks (auto or integer)', { exact: true }).fill('800');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.evaluate(() => {
    const owner = [...(window as any).__terminal.panels.values()][0];
    owner.engine.setRange({ from: owner.engine.barCount - 160, to: owner.engine.barCount - 1 });
    (window as any).__tpoBracketDraws = [];
    (window as any).__captureTpoBrackets = true;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.geometry.sessions.length)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].tpo.lettersDrawn)).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/tpo-left-to-right-fixture.png' });

  const result = await page.evaluate(() => {
    const panel = (window as any).__terminal.stats().panels[0];
    const sessions = panel.tpo.geometry.sessions as Array<{ dayStart: number; left: number; right: number }>;
    const labels = (window as any).__tpoBracketDraws as Array<{ text: string; x: number; y: number }>;
    const order = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx';
    const rows = new Map<string, Array<{ text: string; x: number }>>();
    for (const session of sessions) for (const label of labels) {
      if (label.x < session.left || label.x > session.right) continue;
      const key = `${session.dayStart}:${Math.round(label.y * 10)}`;
      const row = rows.get(key) ?? [];
      row.push(label); rows.set(key, row);
    }
    const uniqueRows = [...rows.values()].map(row => [...new Map(row.map(label => [`${label.text}:${label.x.toFixed(2)}`, label])).values()]);
    const leftToRight = uniqueRows.some(row => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const ordinals = sorted.map(label => order.indexOf(label.text));
      return ordinals.length >= 2 && ordinals.every((ordinal, index) => index === 0 || ordinal > ordinals[index - 1]!);
    });
    const startsNearDayLeft = sessions.some(session => labels.some(label => label.text === 'A'
      && label.x >= session.left && label.x < session.left + (session.right - session.left) * .3));
    return { sessions: sessions.length, labels: labels.length, leftToRight, startsNearDayLeft };
  });
  expect(result.sessions).toBeGreaterThanOrEqual(2);
  expect(result.labels).toBeGreaterThan(0);
  expect(result.leftToRight).toBe(true);
  expect(result.startsNearDayLeft).toBe(true);
});

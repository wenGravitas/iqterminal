import { expect, test } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test.use({ storageState: { cookies: [], origins: [] } });

test('R2 chart attachment restores the saved Volume/SMA composition with fresh linked IDs and axis state', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const chart = page.locator('.candle-panel').first();
  await addIndicator(chart, 'Volume');
  await chart.locator('.active-indicator[data-definition-id="script:builtin.volume-histogram"]')
    .getByRole('button', { name: 'Add moving average to Volume', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add moving average', exact: true }).getByRole('button', { name: 'Add SMA', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].compositionApis.size)).toBe(1);
  await page.evaluate(() => {
    const panel = [...(window as any).__terminal.panels.values()][0];
    panel.engine.chart.setSeriesPriceScale(panel.engine.series, 'left');
    panel.engine.chart.setPriceAxisPlacement(panel.engine.chart.primaryPaneIndex(), 'left', 'left');
  });
  const original = await page.evaluate(() => {
    const panel = [...(window as any).__terminal.panels.values()][0];
    return { config: structuredClone(panel.selection), state: panel.engine.chart.getState() };
  });

  const camera = chart.getByRole('button', { name: 'Camera actions', exact: true });
  await camera.click();
  await page.getByRole('menuitem', { name: 'Add to journal…', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Chart image capture status', exact: true });
  await warning.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await warning.isVisible()) await warning.getByRole('button', { name: 'Continue with warnings', exact: true }).click();

  const journal = page.locator('.global-journal-panel');
  await expect(journal).toBeVisible();
  const composer = journal.locator('.journal-v2-dialog');
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Entry body in Markdown')).toHaveValue(/attachment:/);
  await expect.poll(async () => page.evaluate(async () => (window as any).__terminal.journal.repository.drafts().then((rows: any[]) => rows.length))).toBe(1);
  await expect.poll(async () => page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }).then((rows: any[]) => rows.length))).toBe(0);
  await expect(chart.locator('.journal-marker')).toHaveCount(0);
  await composer.getByLabel('Title (optional)').fill('Saved composition');
  await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect(composer).toBeHidden();
  await expect.poll(async () => page.evaluate(async () => {
    const repository = (window as any).__terminal.journal.repository;
    return { entries: (await repository.entries({ limit: 10 })).length, drafts: (await repository.drafts()).length };
  })).toEqual({ entries: 1, drafts: 0 });
  await expect(chart.locator('.journal-marker')).toHaveCount(1);

  const entry = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }).then((rows: any[]) => rows[0]));
  expect(entry.attachments).toHaveLength(1);
  expect(entry.attachments[0].kind).toBe('chart-capture');
  const chip = journal.locator('.journal-v2-context-chip').filter({ hasText: 'BTCUSDT' }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect(page.locator('.journal-restored-notice')).toContainText('current history, not replay');
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][1].compositionApis.size)).toBe(1);

  const restored = await page.evaluate(async () => {
    const terminal = (window as any).__terminal;
    const panels = [...terminal.panels.values()];
    const entry = (await terminal.journal.repository.entries({ limit: 10 }))[0];
    return {
      config: panels[1].selection,
      state: panels[1].engine.chart.getState(),
      outputs: panels[1].studies.views().flatMap((view: any) => view.numericOutputs),
      capture: entry.attachments[0].chartCapture,
    };
  });
  const provider = restored.config.indicators.find((item: any) => item.script?.scriptId === 'builtin.volume-histogram');
  const consumer = restored.config.indicators.find((item: any) => item.definitionId === 'native.composition-sma');
  expect(provider.instanceId).not.toBe(original.config.indicators.find((item: any) => item.script)?.instanceId);
  expect(consumer.numericInputs.source.instanceId).toBe(provider.instanceId);
  expect(restored.outputs.some((output: any) => output.available)).toBe(true);
  expect(restored.capture.snapshot.scripts[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(restored.capture.snapshot.engine).toBe('2.6.0');
  expect(restored.state.series.find((series: any) => series.type === 'candlestick').priceScaleId).toBe('left');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/journal-restored-linked-r2.png' });
});

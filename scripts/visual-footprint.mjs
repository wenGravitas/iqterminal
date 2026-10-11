import { addIndicator, footprintSettings } from './indicator-actions.mjs';
// Ordinary-build visual evidence; uses the real execution stream without fixtures.
import assert from 'node:assert/strict';
import { launch, url } from './browser.mjs';

const browser = await launch(false);
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(url);
  const panel = page.locator('.candle-panel').first();
  await panel.waitFor();
  assert.equal(await page.evaluate(() => !!window.__terminal), false);
  await addIndicator(panel, 'Footprint');
  const priceLevel = panel.locator('input.footprint-row-price');
  assert.equal(await priceLevel.inputValue(), '25', 'Fresh charts use the 25 USDT default');

  await page.waitForTimeout(8000);
  assert.ok((await panel.locator('.ohlc').textContent())?.includes('BTC'), 'Real footprint observations arrived');
  await page.screenshot({ path: 'artifacts/footprint-price-level-1366x768.png' });
  await footprintSettings(panel);
  await page.getByRole('dialog', { name: 'Footprint display settings', exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/footprint-settings-1366x768.png' });
  await page.getByRole('dialog', { name: 'Footprint display settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 720, height: 860 });
  // ResizeObserver + the chart scheduler need their own frames before capture.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(150);

  await page.screenshot({ path: 'artifacts/footprint-price-level-720x860.png' });
  await footprintSettings(panel);
  await page.screenshot({ path: 'artifacts/footprint-settings-720x860.png' });
  await page.getByRole('dialog', { name: 'Footprint display settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const stage = await panel.locator('.chart-stage').boundingBox();
  assert.ok(stage);
  let hovered = false;
  for (let x = stage.width - 100; x >= Math.max(0, stage.width - 240) && !hovered; x -= 20) {
    for (let y = 100; y < stage.height - 100; y += 45) {
      await page.mouse.move(stage.x + x, stage.y + y);
      await page.waitForTimeout(35);
      if (/^[\d,.]+ USDT · bid .* \/ ask .* BTC\n/.test(await panel.locator('.ohlc').textContent() ?? '')) {
        hovered = true;
        break;
      }
    }
  }
  assert.ok(hovered, 'Actual primitive pointer hover produces a row-first readout');
  await page.screenshot({ path: 'artifacts/footprint-hover-720x860.png' });
} finally { await browser.close(); }

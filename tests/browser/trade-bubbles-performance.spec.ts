import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, type } from 'node:os';
import { addIndicator } from './indicator-actions';
import { installDepthFixture } from './depth-fixture';

test('local RAF observation: baseline chart and 2,048 retained Trade Bubbles', async ({ page }) => {
  test.skip(process.env.IQ_TRADE_BUBBLES_PERF !== '1', 'Explicit local browser performance observation only');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDepthFixture(page);

  const charts = page.locator('.candle-panel');
  const panel = charts.first();
  const panelId = await panel.getAttribute('data-panel-id');
  const otherId = await charts.nth(1).getAttribute('data-panel-id');
  if (!panelId || !otherId) throw new Error('Expected the two initial fixture charts');
  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.close(), otherId);
  await expect(charts).toHaveCount(1);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().bars, panelId)).toBe(5000);
  const tree = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await tree.isVisible()) await tree.click();

  async function observe(label: string) {
    const box = await panel.locator('.chart-stage').boundingBox();
    if (!box || box.width < 200 || box.height < 160) throw new Error('Chart stage is too small for the input probe');
    await page.evaluate(() => {
      const state = (window as any).__tradeBubbleRaf = { running: true, intervals: [] as number[], previous: 0 };
      const sample = (now: number) => {
        if (!state.running) return;
        if (state.previous) state.intervals.push(now - state.previous);
        state.previous = now; requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.move(box.x + box.width * .72, box.y + box.height * .52);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .44, box.y + box.height * .52, { steps: 28 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).__tradeBubbleRaf.intervals.length)).toBeGreaterThan(120);
    return page.evaluate(({ label, panelId }) => {
      const state = (window as any).__tradeBubbleRaf;
      state.running = false;
      const values = [...state.intervals].sort((a: number, b: number) => a - b);
      const percentile = (fraction: number) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
      const panel = (window as any).__terminal.panels.get(panelId);
      const diag = panel.diagnostics();
      return { label, rafIntervalsMs: { samples: values.length, p50: percentile(.5), p95: percentile(.95), max: values.at(-1) ?? null },
        bars: diag.bars, longTasks: (window as any).__terminal.stats().longTasks,
        tradeBubbles: diag.tradeBubbles ? { retained: diag.tradeBubbles.layer.retained, painted: diag.tradeBubbles.layer.painted,
          culled: diag.tradeBubbles.layer.culled, hittable: diag.tradeBubbles.layer.hittable, draws: diag.tradeBubbles.layer.draws } : null };
    }, { label, panelId });
  }

  const baseline = await observe('5000-bar fixture chart without Trade Bubbles');
  await addIndicator(panel, 'Trade Bubbles');
  const basis = await page.evaluate(id => {
    const last = (window as any).__terminal.panels.get(id).diagnostics().last;
    return { timeMs: last.t, price: last.c };
  }, panelId);
  const now = Date.now();
  const records = Array.from({ length: 2048 }, (_, index) => {
    const price = basis.price + ((index % 17) - 8) * 0.25;
    const notional = 100_000 + index * 1_000;
    const tradeId = index * 3;
    return { venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade',
      executionId: `trade-bubbles-performance:${index}`, id: index + 1, firstTradeId: tradeId, lastTradeId: tradeId + 2,
      timeMs: basis.timeMs - (index % 32) * 60_000, receivedAtMs: now, eventTimeMs: basis.timeMs,
      price, quantity: notional / price, quoteNotionalText: String(notional), side: index % 2 ? 'buy' : 'sell' };
  });
  for (let offset = 0; offset < records.length; offset += 256) {
    const batch = records.slice(offset, offset + 256);
    await page.evaluate(({ id, records }) => (window as any).__terminal.feed.send({ type: 'trade-bubbles-fixture', source: 'binance:perpetual', records }), { id: panelId, records: batch });
    const expected = offset + batch.length;
    await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(expected);
  }
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.records, panelId)).toBe(2048);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).diagnostics().tradeBubbles?.layer.painted, panelId)).toBe(120);
  const enabled = await observe('Same chart with 2,048 retained executions and 120 visible bubbles');
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.feed.diagnostics?.tradeBubbles?.fixture)).toBe(true);
  const metadata = await page.evaluate(() => ({ userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight }, fixture: (window as any).__terminal.feed.diagnostics.fixture,
    worker: (window as any).__terminal.feed.diagnostics.tradeBubbles }));
  const deviceModel = await readFile('/proc/device-tree/model', 'utf8').then(value => value.replaceAll('\0', '').trim()).catch(() => null);
  const result = { kind: 'local browser observation; fixture only; not frame-rate acceptance', host: { platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown', deviceModel, osType: type(), osRelease: release() },
    metadata, fixture: { bars: 5000, records: records.length, visibleMaximum: 120, delivery: '8 acknowledged batches of 256' }, baseline, enabled, errors };
  const output = process.env.TRADE_BUBBLES_PERF_OUTPUT ?? 'artifacts/trade-bubbles-performance.json';
  const image = process.env.TRADE_BUBBLES_PERF_IMAGE ?? 'artifacts/trade-bubbles-performance.png';
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  expect(metadata.fixture).toBe(true);
  expect(enabled.tradeBubbles).toMatchObject({ retained: 2048, painted: 120 });
  expect(enabled.tradeBubbles?.culled).toBeGreaterThanOrEqual(1928);
  expect(errors).toEqual([]);
  await page.screenshot({ path: image });
});

import { addIndicator, expectHeatmapLiveQuiet, setFootprint, setPriceLevel, setUnits, footprintSettings } from './indicator-actions';
import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';

test('chart footers keep liquidity, connection, time axis and footprint stats separate after resize', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await installDepthFixture(page);
  const panels = page.locator('.candle-panel'), first = panels.first();
  const closeObjects = first.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await closeObjects.isVisible()) await closeObjects.click();
  await addIndicator(first, 'Order-book Heatmap');
  await expectHeatmapLiveQuiet(first);
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    t.feed.subscribeFootprint = (_id: string, _s: any, rowSize: number, callback: any) => {
      const time = Math.floor(Date.now()/60000)*60;
      queueMicrotask(() => callback({ type: 'footprint-snapshot', bars: [{ time, rowSize, revision: 1, cells: [{ price: 83000, bidVol: 1, askVol: 2 }],
        open: 83000, high: 83010, low: 83000, close: 83010, delta: 1, minDelta: 0, maxDelta: 1, coverage: 'partial', gapBefore: false }],
        retentionStart: time, status: { state: 'live', message: 'Live · partial first interval; Binance aggregate observations only', lastUpdate: Date.now(),
          collectionStartedAt: Date.now(), coverage: 'partial', tickSize: .1, rowSize } }));
      return () => {};
    };
  });
  await setFootprint(first, true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.latest)).not.toBeNull();
  const verify = async () => {
    const rows = await panels.evaluateAll(elements => elements.map(panel => {
      const stage = panel.querySelector('.chart-stage')!.getBoundingClientRect(), footerElement = panel.querySelector<HTMLElement>('.chart-footer')!, footer = footerElement.getBoundingClientRect();
      const status = panel.querySelector<HTMLElement>('.panel-status')!, box = status.getBoundingClientRect();
      const notice = panel.querySelector<HTMLElement>('.heatmap-notice')!, n = notice.getBoundingClientRect();
      const retry = !status.hidden ? status.querySelector('button')?.getBoundingClientRect() : undefined;
      const panelBottom = panel.getBoundingClientRect().bottom, footerHidden = footerElement.hidden;
      return { stageBottom: stage.bottom, footerTop: footer.top, footerBottom: footer.bottom, footerHeight: footer.height, footerHidden, panelBottom,
        statusTop: box.top, statusBottom: box.bottom, statusRight: box.right, footerRight: footer.right,
        statusVisible: !status.hidden, noticeTop: n.top, noticeBottom: n.bottom, noticeVisible: !notice.hidden, retryBottom: retry?.bottom,
        canvasesInside: [...panel.querySelectorAll('canvas')].every(c => c.getBoundingClientRect().bottom <= (footerHidden ? panelBottom : footer.top) + 1) };
    }));
    for (const r of rows) {
      expect(r.canvasesInside).toBe(true);
      if (r.footerHidden) {
        expect(r.footerHeight).toBe(0);
        expect(r.stageBottom).toBeLessThanOrEqual(r.panelBottom);
        expect(r.statusVisible).toBe(false);
        expect(r.noticeVisible).toBe(false);
      } else {
        expect(r.stageBottom).toBeLessThanOrEqual(r.footerTop);
        expect(r.footerBottom).toBeLessThanOrEqual(r.panelBottom);
        if (r.statusVisible) {
          expect(r.statusTop).toBeGreaterThanOrEqual(r.footerTop); expect(r.statusBottom).toBeLessThanOrEqual(r.footerBottom);
          expect(r.statusRight).toBeLessThanOrEqual(r.footerRight);
        }
        if (r.noticeVisible) { expect(r.noticeTop).toBeGreaterThanOrEqual(r.footerTop); if (r.statusVisible) expect(r.statusTop).toBeGreaterThanOrEqual(r.noticeBottom); }
        if (r.retryBottom !== undefined) expect(r.retryBottom).toBeLessThanOrEqual(r.footerBottom);
      }
    }
  };
  await verify(); await page.screenshot({ path: 'artifacts/chart-footer-dark-1366x768.png' });
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.setViewportSize({ width: 720, height: 860 }); await verify(); await page.screenshot({ path: 'artifacts/chart-footer-light-720x860.png' });
  await setFootprint(first, false); await verify();
  // Empty/error status remains centred with an accessible Retry control.
  await page.evaluate(() => { const p = [...(window as any).__terminal.panels.values()][0] as any; p.engine.setSnapshot([]); p.status = { state: 'failed', message: 'Explicit test failure', lastUpdate: 0 }; p.updateStatus(); });
  await expect(first.locator('.chart-stage .panel-status.no-data')).toContainText('Data unavailable');
  await expect(first.locator('.chart-stage .panel-status.no-data')).not.toContainText('Explicit test failure');
  await expect(first.getByRole('button', { name: 'Retry market data' })).toBeVisible();
  expect(errors).toEqual([]);
});

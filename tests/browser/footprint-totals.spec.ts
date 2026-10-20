import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, setFootprint } from './indicator-actions';

test('Footprint Totals owns a lower pane while sharing one footprint collection', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installDepthFixture(page);
  // The Totals pane reserves a 150px label column. Three 100px candles need
  // more plot width than the default three-panel 1366px workspace provides.
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.fillText;
    (window as any).__footprintTableTexts = [];
    prototype.fillText = function (text: string, x: number, y: number, ...rest: number[]) {
      if (/^[+-]?[\d.]+$/.test(text)) (window as any).__footprintTableTexts.push({ text, x, y, font: this.font, fill: this.fillStyle, align: this.textAlign, width: this.measureText(text).width });
      return original.call(this, text, x, y, ...rest);
    };
  });
  const panel = page.locator('.candle-panel').first();

  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.profileSubscriptions = 0;
    terminal.profileUnsubscriptions = 0;
    terminal.feed.subscribeFootprint = (_id: string, series: any, rowSize: number, callback: any) => {
      terminal.profileSubscriptions++;
      setTimeout(() => {
        const candlePanel = [...terminal.panels.values()][0] as any;
        const time = candlePanel.engine.latestBar.time;
        const times = candlePanel.engine.candleTimes.slice(-3);
        const samples = [{ bidVol: 9, askVol: 3 }, { bidVol: 3, askVol: 7 }, { bidVol: 5, askVol: 6 }];
        const bars = (times.length ? times : [time]).map((barTime: number, index: number) => {
          const sample = samples[index % samples.length];
          const { bidVol, askVol } = sample;
          return {
            time: barTime, rowSize, revision: 1,
            cells: [{ price: 83000, bidVol, askVol, bidNotional: bidVol * 83000, askNotional: askVol * 83000 }],
            open: 83000, high: 83025, low: 82975, close: 83010,
            delta: askVol - bidVol, minDelta: Math.min(0, askVol - bidVol), maxDelta: Math.max(0, askVol - bidVol), quoteDelta: (askVol - bidVol) * 83000,
            minQuoteDelta: Math.min(0, askVol - bidVol) * 83000, maxQuoteDelta: Math.max(0, askVol - bidVol) * 83000,
            source: series.market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade', granularity: 'aggregate-trade',
            coverage: 'partial', gapBefore: false, aggregateRecordCount: 1,
          };
        });
        const now = Date.now();
        callback({
          type: 'footprint-snapshot', key: 'fixture', ids: [_id], bars,
          retentionStart: time, generation: terminal.profileSubscriptions, batchId: terminal.profileSubscriptions,
          status: { state: 'live', message: 'Explicit browser fixture', lastUpdate: now,
            tickSize: .1, rowSize, collectionStartedAt: now, firstTradeAt: now,
            lastTradeAt: now, eventTime: now, outages: 0, capacityDrops: 0,
            unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0,
            retentionStart: time, coverage: 'partial' },
        });
      }, 250);
      return () => { terminal.profileUnsubscriptions++; };
    };
  });

  await setFootprint(panel, true);
  await addIndicator(panel, 'Footprint Totals');
  const totals = panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]');
  await expect(totals).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const id = candlePanel.selection.indicators.find((item: any) => item.definitionId === 'native.footprint-totals').instanceId;
    return { view: candlePanel.engine.footprintTotalsDiagnostics().find((item: any) => item.id === id),
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(id), paneCount: candlePanel.engine.chart.panes().length,
      time: candlePanel.engine.latestBar.time, tooltip: candlePanel.engine.footprintTotalsTooltip(id, candlePanel.engine.latestBar.time),
      subscriptions: terminal.profileSubscriptions };
  })).toMatchObject({ paneIndex: 1, paneCount: 2, subscriptions: 1 });
  const paneHeadersAligned = () => page.evaluate(() => {
    const t = (window as any).__terminal;
    const p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const chartRect = p.element.querySelector('.chart-stage').getBoundingClientRect();
    const hosts = Array.from(p.element.querySelectorAll('.pane-indicator-host')) as HTMLElement[];
    return hosts.length === 1 && hosts.every(host => {
      const index = Number(host.dataset.paneIndex), plot = p.engine.chart.plotRect(index), rect = host.getBoundingClientRect();
      return plot && Math.abs(rect.left - (chartRect.left + plot.left + 4)) < 2 && Math.abs(rect.top - (chartRect.top + plot.top)) < 2;
    });
  });
  await expect.poll(paneHeadersAligned).toBe(true);
  const observed = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const view = candlePanel.engine.footprintTotalsDiagnostics()[0];
    return { view, time: candlePanel.engine.latestBar.time,
      tooltip: candlePanel.engine.footprintTotalsTooltip(view.id, candlePanel.engine.latestBar.time),
      subscriptions: terminal.profileSubscriptions };
  });
  expect(observed.view).toMatchObject({ paneIndex: 1, statsBars: 3 });
  expect(observed.view.autoHeight).toBe(92);
  expect(observed.view.manuallyResized).toBe(false);
  expect(Math.abs(observed.view.paneHeight - observed.view.autoHeight)).toBeLessThanOrEqual(4);
  expect(observed.view.lastTime).toBe(observed.time);
  expect(observed.tooltip).toContain('Total Volume  11');
  expect(observed.tooltip).toContain('Delta  +1');
  expect(observed.subscriptions).toBe(1);
  await page.evaluate(() => {
    (window as any).__footprintTableTexts = [];
    const candlePanel = [...(window as any).__terminal.panels.values()][0] as any;
    candlePanel.engine.chart.timeScale.setBarSpacing(100);
    // Keep the latest whole cell between the fixed labels and the right edge.
    candlePanel.engine.chart.timeScale.setRightOffset(.5);
  });
  await expect.poll(() => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const chart = candlePanel.engine.chart;
    const view = candlePanel.engine.footprintTotalsDiagnostics()[0];
    const dpr = window.devicePixelRatio;
    const plotWidth = chart.timeScale.width * dpr;
    const labelWidth = Math.min(view.presentation.labelWidth, chart.timeScale.width) * dpr;
    const slot = chart.timeScale.barSpacing * dpr;
    const visible = (window as any).__footprintTableTexts.filter((item: any) => item.font.startsWith('8.5px') && item.y < 100);
    return ['-6', '+4', '+1'].every(text => visible.some((item: any) => item.text === text
      && item.x - slot / 2 >= labelWidth && item.x + slot / 2 <= plotWidth
      && item.y > 15 * dpr && item.y < candlePanel.engine.chart.panes()[1].base.mediaHeight));
  })).toBe(true);
  const totalsTextDraws = await page.evaluate(() => (window as any).__footprintTableTexts.filter((item: any) => item.font.startsWith('8.5px') && item.y < 100));
  expect(totalsTextDraws.map((item: any) => item.text)).toEqual(expect.arrayContaining(['11', '5', '6', '-6', '+4', '+1']));
  expect(totalsTextDraws.every((item: any) => item.align === 'center')).toBe(true);
  await page.screenshot({ path: 'artifacts/footprint-totals/comparison-fixture-2560x1080.png' });

  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileSubscriptions)).toBe(1);
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].footprintTotals[0].statsBars)).toBe(3);

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, view = p.engine.footprintTotalsDiagnostics()[0];
    return view?.statsBars === 3 && view.lastTime === p.engine.latestBar.time;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileSubscriptions)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(1);
  await panel.getByRole('button', { name: 'Chart market', exact: true }).click();
  const marketPicker = panel.locator('.market-picker');
  await marketPicker.getByRole('radio', { name: 'Binance · BTCUSDT Spot', exact: true }).check();
  await marketPicker.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()][0] as any, view = p.engine.footprintTotalsDiagnostics()[0];
    return p.selection.market === 'spot' && p.selection.interval === '5m' && view?.statsBars === 3 && view.lastTime === p.engine.latestBar.time;
  })).toBe(true);

  await panel.getByRole('button', { name: 'Remove Footprint Totals', exact: true }).click();
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(2);
  await panel.getByRole('button', { name: 'Remove Footprint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.profileUnsubscriptions)).toBe(3);

  await addIndicator(panel, 'Footprint');
  await addIndicator(panel, 'Footprint Totals');
  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const totalsSettings = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await page.evaluate(() => {
    const t = (window as any).__terminal;
    const p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    (window as any).__totalsResizeBaseline = { engine: p.engine, chart: p.engine.chart, profileSubscriptions: t.profileSubscriptions };
  });
  await totalsSettings.getByLabel('Bid volume', { exact: true }).uncheck();
  await totalsSettings.getByLabel('Ask volume', { exact: true }).uncheck();
  await totalsSettings.getByLabel('Trades', { exact: true }).check();
  await totalsSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const view = p.engine.footprintTotalsDiagnostics()[0];
    return { rows: view.rows.length, autoHeight: view.autoHeight, paneHeight: view.paneHeight, manuallyResized: view.manuallyResized };
  })).toMatchObject({ rows: 3, autoHeight: 77, manuallyResized: false });
  const compactPaneHeight = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    return p.engine.footprintTotalsDiagnostics()[0].paneHeight;
  });
  expect(Math.abs(compactPaneHeight - 77)).toBeLessThanOrEqual(4);
  await expect.poll(paneHeadersAligned).toBe(true);

  const divider = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const r = p.engine.chart.panes()[0].element.getBoundingClientRect();
    return { x: r.left + Math.min(220, r.width / 2), y: r.bottom };
  });
  await page.mouse.move(divider.x, divider.y);
  await page.mouse.down();
  await page.mouse.move(divider.x, divider.y - 55, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const view = p.engine.footprintTotalsDiagnostics()[0];
    return { manuallyResized: view.manuallyResized, paneHeight: view.paneHeight };
  })).toMatchObject({ manuallyResized: true });
  const manuallySizedPaneHeight = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    return p.engine.footprintTotalsDiagnostics()[0].paneHeight;
  });
  expect(manuallySizedPaneHeight).toBeGreaterThan(compactPaneHeight + 25);

  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const expandedRows = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await expandedRows.getByLabel('Bid volume', { exact: true }).check();
  await expandedRows.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const view = p.engine.footprintTotalsDiagnostics()[0];
    return { rows: view.rows.length, autoHeight: view.autoHeight, manuallyResized: view.manuallyResized, paneHeight: view.paneHeight };
  })).toMatchObject({ rows: 4, autoHeight: 92, manuallyResized: true });
  const preservedPaneHeight = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    return p.engine.footprintTotalsDiagnostics()[0].paneHeight;
  });
  expect(Math.abs(preservedPaneHeight - manuallySizedPaneHeight)).toBeLessThan(4);

  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const compactAgain = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await compactAgain.getByLabel('Bid volume', { exact: true }).uncheck();
  await compactAgain.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => {
    const t = (window as any).__terminal, baseline = (window as any).__totalsResizeBaseline;
    const p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    return p.engine === baseline.engine && p.engine.chart === baseline.chart && t.profileSubscriptions === baseline.profileSubscriptions;
  })).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const persisted = await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()].find((item: any) => item.selection.indicators.some((indicator: any) => indicator.definitionId === 'native.footprint-totals')) as any;
    const indicator = candlePanel.selection.indicators.find((item: any) => item.definitionId === 'native.footprint-totals');
    return { rows: indicator.settings.rows, interval: candlePanel.selection.interval, market: candlePanel.selection.market,
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(indicator.instanceId) };
  });
  expect(persisted).toEqual({ rows: ['volume', 'delta', 'trades'], interval: '5m', market: 'spot', paneIndex: 1 });
  expect(errors).toEqual([]);
});

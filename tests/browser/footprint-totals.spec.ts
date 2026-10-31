import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, setFootprint } from './indicator-actions';

test('Footprint Totals owns a lower pane while sharing one footprint collection', async ({ page }) => {
  test.setTimeout(90_000);
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
        const time = candlePanel.candles.at(-1).t / 1000;
        const times = candlePanel.candles.slice(-3).map((candle: any) => candle.t / 1000);
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
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.latestFootprintStats() !== null)).toBe(true);
  await addIndicator(panel, 'Footprint Totals');
  const totals = panel.locator('.active-indicator[data-definition-id="native.footprint-totals"]');
  await expect(totals).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const candlePanel = [...terminal.panels.values()][0] as any;
    const id = candlePanel.selection.indicators.find((item: any) => item.definitionId === 'native.footprint-totals').instanceId;
    return { view: candlePanel.engine.footprintTotalsDiagnostics().find((item: any) => item.id === id),
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(id), paneCount: candlePanel.engine.chart.panes().length,
      time: candlePanel.engine.latestBar?.time, tooltip: candlePanel.engine.footprintTotalsTooltip(id, candlePanel.engine.latestBar?.time ?? 0),
      subscriptions: terminal.profileSubscriptions };
  })).toMatchObject({ paneIndex: 1, paneCount: 2, subscriptions: 1, time: expect.any(Number), view: { statsBars: 3 } });
  const paneHeadersAligned = () => page.evaluate(() => {
    const t = (window as any).__terminal;
    const p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const chartRect = p.element.querySelector('.chart-stage').getBoundingClientRect();
    const hosts = Array.from(p.element.querySelectorAll('.pane-indicator-host')) as HTMLElement[];
    return hosts.length === 1 && hosts.every(host => {
      const index = Number(host.dataset.paneIndex), plot = p.engine.chart.plotRect(index), rect = host.getBoundingClientRect();
      return plot && Math.abs(rect.left - (chartRect.left + plot.left)) < 2 && Math.abs(rect.top - (chartRect.top + plot.top)) < 2;
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
  expect(observed.view.autoHeight).toBe(104);
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
    const visible = (window as any).__footprintTableTexts.filter((item: any) => item.font.startsWith('11px') && item.y < 100);
    return ['-6', '+4', '+1'].every(text => visible.some((item: any) => item.text === text
      && item.x - slot / 2 >= labelWidth && item.x + slot / 2 <= plotWidth
      && item.y > 15 * dpr && item.y < candlePanel.engine.chart.panes()[1].base.mediaHeight));
  })).toBe(true);
  const totalsTextDraws = await page.evaluate(() => (window as any).__footprintTableTexts.filter((item: any) => item.font.startsWith('11px') && item.y < 100));
  expect(totalsTextDraws.map((item: any) => item.text)).toEqual(expect.arrayContaining(['11', '5', '6', '-6', '+4', '+1']));
  expect(totalsTextDraws.every((item: any) => item.align === 'center')).toBe(true);
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Totals position', exact: true })).toHaveCount(0);
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.footprint.options().statsRows)).toEqual([]);
  const axisGeometry = () => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart;
    const primary = chart.primaryPaneIndex(), totals = p.engine.footprintTotalsPaneIndex('native.footprint-totals');
    const gap = (i: number) => chart.panes()[i].base.mediaHeight - chart.plotRect(i).height;
    return { primary: gap(primary), totals: gap(totals) };
  });
  await expect.poll(axisGeometry).toEqual({ primary: 20, totals: 0 });
  const axis = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0], chart = p.engine.chart, plot = chart.plotRect(chart.primaryPaneIndex());
    return { x: plot.left + plot.width / 2, y: plot.top + plot.height + 10, spacing: chart.timeScale.barSpacing };
  });
  const stage = await panel.locator('.chart-stage').boundingBox();
  await page.mouse.move(stage!.x + axis.x, stage!.y + axis.y); await page.mouse.down();
  await page.mouse.move(stage!.x + axis.x + 60, stage!.y + axis.y, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.timeScale.barSpacing)).not.toBe(axis.spacing);
  await page.evaluate(() => { const p = [...(window as any).__terminal.panels.values()][0]; p.engine.chart.movePane(p.engine.footprintTotalsPaneIndex('native.footprint-totals'), -1); });
  await expect.poll(axisGeometry).toEqual({ primary: 20, totals: 0 });
  await page.evaluate(() => { const p = [...(window as any).__terminal.panels.values()][0]; p.engine.chart.movePane(p.engine.chart.primaryPaneIndex(), -1); });
  await expect.poll(axisGeometry).toEqual({ primary: 20, totals: 0 });
  await page.evaluate(() => {
    (window as any).__totalsHighlights = [];
    const original = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function(...args) {
      if (this.strokeStyle === '#dedede' || this.strokeStyle === '#202934') (window as any).__totalsHighlights.push(args);
      return original.apply(this, args);
    };
  });
  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  await panel.locator('.footprint-totals-settings').getByLabel('Highlight highest value in each row', { exact: true }).check();
  await panel.locator('.footprint-totals-settings').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__totalsHighlights.length)).toBeGreaterThan(0);
  const card = panel.locator('.footprint-totals-tooltip');
  const hoverTotals = async () => {
    const point = await page.evaluate(() => {
      const p = [...(window as any).__terminal.panels.values()][0], engine = p.engine, time = engine.latestBar.time;
      const pane = engine.footprintTotalsPaneIndex('native.footprint-totals'), plot = engine.chart.plotRect(pane);
      const x = engine.chart.timeScale.indexToX(engine.chart.dataLayer.timeToIndex(time)), y = 39;
      return { x: plot.left + x, y: plot.top + y, gutterX: plot.left + 5, time, pane, localX: x, localY: y };
    });
    await expect.poll(() => page.evaluate(p => {
      const engine = [...(window as any).__terminal.panels.values()][0].engine;
      return !!engine.footprintTotalsHover('native.footprint-totals', p.time, p.localX, p.localY);
    }, point)).toBe(true);
    const box = await panel.locator('.chart-stage').boundingBox();
    await page.mouse.move(box!.x + point.x, box!.y + point.y);
    await expect(card).toBeVisible();
    await expect(panel.locator('.heatmap-readout')).toHaveText('');
    const bounds = await card.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(box!.x);
    expect(bounds!.y).toBeGreaterThanOrEqual(box!.y);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(box!.x + box!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(box!.y + box!.height);
    return { point, box: box! };
  };
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  const hovered = await hoverTotals();
  await expect(card).toContainText('Footprint Totals'); await expect(card).toContainText('UTC');
  await expect(card.locator('.footprint-totals-tooltip-row')).toHaveCount(4);
  await expect(card).toContainText('913,000 USDT');
  await expect(card.locator('[data-hovered=true]')).toContainText('Total Volume');
  await page.screenshot({ path: '/tmp/footprint-totals-tooltip-dark.png' });
  await page.mouse.move(hovered.box.x + hovered.point.gutterX, hovered.box.y + hovered.point.y);
  await expect(card).toBeHidden();

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await hoverTotals(); await page.screenshot({ path: '/tmp/footprint-totals-tooltip-light.png' });
  await page.getByRole('button', { name: 'Global settings', exact: true }).click();
  const global = page.getByRole('dialog', { name: 'Global settings', exact: true });
  await global.getByLabel('Override indicator currencies').check();
  await global.getByLabel('Default display currency').selectOption('quote');
  await global.getByRole('button', { name: 'Apply', exact: true }).click();
  await hoverTotals();
  await expect(card.locator('.positioning-tooltip-amount').first()).toContainText('913,000 USDT');
  await expect(card.locator('.positioning-tooltip-secondary').first()).toContainText('11 BTC');
  await page.getByRole('button', { name: 'Global settings', exact: true }).click();
  await global.getByLabel('Override indicator currencies').uncheck();
  await global.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.mouse.move(0, 0); await expect(card).toBeHidden();



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
  await totalsSettings.getByLabel('Highlight highest value in each row', { exact: true }).check();
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
  })).toMatchObject({ rows: 3, autoHeight: 86, manuallyResized: false });
  const compactPaneHeight = await page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    return p.engine.footprintTotalsDiagnostics()[0].paneHeight;
  });
  expect(Math.abs(compactPaneHeight - 86)).toBeLessThanOrEqual(4);
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
  await expandedRows.getByLabel('Minimum relative strength', { exact: true }).fill('0');
  await expandedRows.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as any).__terminal, p = [...t.panels.values()].find((item: any) => item.engine?.footprintTotalsDiagnostics().length) as any;
    const view = p.engine.footprintTotalsDiagnostics()[0];
    return { rows: view.rows.length, autoHeight: view.autoHeight, manuallyResized: view.manuallyResized, paneHeight: view.paneHeight };
  })).toMatchObject({ rows: 4, autoHeight: 104, manuallyResized: true });
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
    return { rows: indicator.settings.rows, highlightHighest: indicator.settings.highlightHighest,
      highlightDeltaFlips: indicator.settings.highlightDeltaFlips, deltaFlipMinimumStrength: indicator.settings.deltaFlipMinimumStrength,
      interval: candlePanel.selection.interval, market: candlePanel.selection.market,
      paneIndex: candlePanel.engine.footprintTotalsPaneIndex(indicator.instanceId) };
  });
  expect(persisted).toEqual({ rows: ['volume', 'delta', 'trades'], highlightHighest: true, highlightDeltaFlips: true,
    deltaFlipMinimumStrength: 0, interval: '5m', market: 'spot', paneIndex: 1 });
  expect(errors).toEqual([]);
});

test('delta flip settings request the exact reference demand and the tooltip reports unavailable strength', async ({ page }) => {
  test.setTimeout(90_000);
  await installDepthFixture(page);
  await page.setViewportSize({ width: 2560, height: 1080 });
  const panel = page.locator('.candle-panel').first();
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    terminal.feed.subscribeFootprint = (id: string, series: any, rowPrice: number, callback: any) => {
      setTimeout(() => {
        const p = [...terminal.panels.values()][0] as any;
        const times = p.candles.slice(-3).map((candle: any) => candle.t / 1000);
        const visibleDeltas = [-40, 60, -80];
        const bars = times.map((time: number, index: number) => {
          const delta = visibleDeltas[index]!, bidVol = Math.max(0, -delta), askVol = Math.max(0, delta);
          return { time, revision: 1, rowSize: rowPrice,
          cells: [{ price: 83_000, bidVol, askVol, bidNotional: bidVol * 83_000, askNotional: askVol * 83_000 }],
          open: 83_000, high: 83_025, low: 82_975, close: 83_010, delta,
          minDelta: Math.min(0, delta), maxDelta: Math.max(0, delta), quoteDelta: delta * 83_000,
          source: series.market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade', granularity: 'aggregate-trade',
          coverage: 'partial', gapBefore: false, aggregateRecordCount: 1 };
        });
        const now = Date.now();
        callback({ type: 'footprint-snapshot', key: 'delta-fixture', ids: [id], bars, retentionStart: times[0], generation: 1, batchId: 1,
          status: { state: 'live', message: 'Explicit browser fixture', lastUpdate: now, tickSize: .1, rowSize: rowPrice,
            collectionStartedAt: now, firstTradeAt: now, lastTradeAt: now, eventTime: now,
            outages: 0, capacityDrops: 0, unknownSideRecords: 0, unknownSideVolume: 0, lateRecords: 0,
            retentionStart: times[0], coverage: 'partial' } });
      }, 100);
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await addIndicator(panel, 'Footprint Totals');
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip;
  })).toMatchObject({ enabled: true, lookback: 50 });

  await panel.getByRole('button', { name: 'Footprint Totals settings', exact: true }).click();
  const dialog = panel.getByRole('dialog', { name: 'Footprint Totals settings', exact: true });
  await expect(dialog.getByLabel('Highlight delta flips', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Reference lookback', { exact: true })).toHaveValue('50');
  await expect(dialog.getByText('Minimum strength (× median; 0 = All flips with valid history)', { exact: true })).toBeVisible();
  await dialog.getByLabel('Delta', { exact: true }).uncheck();
  await expect(dialog.getByText('Delta is hidden. Enable the Delta row to see this highlight, or choose Whole column.', { exact: true })).toBeVisible();
  await dialog.getByLabel('Delta', { exact: true }).check();
  await dialog.getByLabel('Reference lookback', { exact: true }).fill('20');
  await dialog.getByLabel('Delta flip target', { exact: true }).selectOption('whole-column');
  await dialog.getByLabel('Highlight highest value in each row', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip;
  })).toMatchObject({ enabled: true, target: 'whole-column', lookback: 20 });

  const time = await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const step = ({ '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 } as any)[p.selection.interval];
    const current = p.engine.latestBar.time, sourceKey = `binance:${p.selection.market ?? 'perpetual'}:BTCUSDT:aggregate-trade:${p.selection.interval}`;
    const summaries = Array.from({ length: 24 }, (_, index) => {
      const time = current - (23 - index) * step;
      const delta = index < 20 ? 10 : index === 20 ? 60 : index === 21 ? -40 : index === 22 ? 60 : -80;
      const fromMs = time * 1000, toMs = fromMs + step * 1000;
      return { time, revision: 1, revisionSource: 'direct-accumulator', sourceKey, delta, quoteDelta: delta * 83_000,
        coverage: 'observed', gapBefore: false, ended: true, completionSource: 'accepted-execution-time', previewEligible: false,
        coverageEvidence: { provenance: 'direct-feed', fromMs, toMs, validated: true, complete: true,
          confirmedFromMs: fromMs - 1, confirmedToMs: toMs, gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } };
    });
    p.engine.setFootprintAnalysisSummaries(summaries);
    return current;
  });
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip;
  })).toMatchObject({ candidates: 3, highlighted: 3 });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-positive-negative-dark.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-positive-negative-light.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const step = ({ '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 } as any)[p.selection.interval];
    const current = p.engine.latestBar.time, sourceKey = `binance:${p.selection.market ?? 'perpetual'}:BTCUSDT:aggregate-trade:${p.selection.interval}`;
    const summaries = Array.from({ length: 24 }, (_, index) => {
      const time = current - (23 - index) * step;
      const delta = index < 20 ? 10 : index === 20 ? 60 : index === 21 ? -40 : index === 22 ? 60 : -80;
      const fromMs = time * 1000, toMs = fromMs + step * 1000;
      const base = { time, revision: 1, revisionSource: 'direct-accumulator', sourceKey, delta, quoteDelta: delta * 83_000,
        coverage: 'observed', gapBefore: false, ended: true, completionSource: 'accepted-execution-time', previewEligible: false,
        coverageEvidence: { provenance: 'direct-feed', fromMs, toMs, validated: true, complete: true,
          confirmedFromMs: fromMs, confirmedToMs: toMs, gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } };
      return index === 23 ? { ...base, revision: 2, coverage: 'partial', ended: false, completionSource: 'unknown', previewEligible: true,
        coverageEvidence: { ...base.coverageEvidence, complete: false, confirmedToMs: fromMs + step * 500 } } : base;
    });
    p.engine.setFootprintAnalysisSummaries(summaries);
  });
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip;
  })).toMatchObject({ highlighted: 3 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-live-dark.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'artifacts/footprint-totals/delta-flips-live-light.png' });
  await page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    const summaries = p.engine.footprintAnalysisSummaries.map((summary: any) => ({ ...summary,
      coverageEvidence: { ...summary.coverageEvidence } }));
    summaries[19].coverage = 'gapped'; summaries[19].coverageEvidence.complete = false; summaries[19].coverageEvidence.gapCount = 1;
    summaries[19].coverageEvidence.nonTailGapCount = 1;
    p.engine.setFootprintAnalysisSummaries(summaries);
  });
  await expect.poll(() => page.evaluate(() => {
    const p = [...(window as any).__terminal.panels.values()][0] as any;
    return p.engine.footprintTotalsDiagnostics()[0]?.deltaFlip;
  })).toMatchObject({ candidates: 3, highlighted: 0 });
  const hover = await page.evaluate(time => {
    const p = [...(window as any).__terminal.panels.values()][0] as any, pane = p.engine.footprintTotalsPaneIndex('native.footprint-totals');
    const plot = p.engine.chart.plotRect(pane), x = p.engine.chart.timeScale.indexToX(p.engine.chart.dataLayer.timeToIndex(time));
    return { x: plot.left + x, y: plot.top + 39 };
  }, time);
  const stage = await panel.locator('.chart-stage').boundingBox();
  await page.mouse.move(stage!.x + hover.x, stage!.y + hover.y);
  const tooltip = panel.locator('.footprint-totals-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('.footprint-totals-tooltip-flip')).toContainText('Strength unavailable — insufficient history');
});

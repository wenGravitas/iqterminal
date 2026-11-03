import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { addIndicator, chooseChartMarket } from '../../tests/browser/indicator-actions';
import { selectTheme } from '../../tests/browser/footer-actions';

// Live public venue profiling is opt-in even if this file is selected directly.
test.skip(process.env.IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE !== '1',
  'Set IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 to run live Order Walls profiling.');

const cases = [
  { market: 'spot' as const, interval: '5m' as const, intervalSeconds: 300, label: 'Binance · BTCUSDT Spot', profile: 'binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1' },
  { market: 'perpetual' as const, interval: '15m' as const, intervalSeconds: 900, label: 'Binance · BTCUSDT USD-M Perp', profile: 'binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1' },
];

for (const item of cases) test(`live ${item.market} ${item.interval} 30h pinned chart archive probe`, async ({ page }) => {
  test.setTimeout(5_100_000);
  mkdirSync('artifacts/order-walls', { recursive: true });
  const pageMetricsPath = `artifacts/order-walls/${item.market}-30h-live-page-metrics-pinned.jsonl`;
  writeFileSync(pageMetricsPath, '');
  const errors: string[] = [];
  const archiveResponses: Array<Record<string, unknown>> = [];
  const archiveResponseTasks: Promise<void>[] = [];
  const archiveRequests: Array<Record<string, unknown>> = [];
  const currentResponses: Array<Record<string, unknown>> = [];
  const currentResponseTasks: Promise<void>[] = [];
  const currentRequests: Array<Record<string, unknown>> = [];
  const currentRequestFailures: Array<Record<string, unknown>> = [];
  const manualResumeEvidence: Array<Record<string, unknown>> = [];
  const workerErrors: Array<Record<string, unknown>> = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location();
    if (/worker/i.test(location.url ?? '') || /worker/i.test(message.text())) {
      workerErrors.push({ at: Date.now(), source: location.url ?? null, text: message.text() });
    }
  });
  page.on('request', request => {
    if (request.url().includes('/market-data/v1/order-walls/archive/current?')) {
      const url = new URL(request.url());
      const checkpoint = { kind: 'current-request', at: Date.now(), after: Number(url.searchParams.get('after')),
        watermark: Number(url.searchParams.get('watermark')), market: url.searchParams.get('market'),
        profile: url.searchParams.get('profile'), url: request.url() };
      currentRequests.push(checkpoint);
      appendFileSync(pageMetricsPath, `${JSON.stringify(checkpoint)}\n`);
      return;
    }
    if (!request.url().includes('/market-data/v1/order-walls/archive?')) return;
    const url = new URL(request.url());
    const checkpoint = { kind: 'request', at: Date.now(), after: Number(url.searchParams.get('after')),
      market: url.searchParams.get('market'), profile: url.searchParams.get('profile'),
      from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')),
      watermark: Number(url.searchParams.get('watermark')), url: request.url() };
    archiveRequests.push(checkpoint);
    appendFileSync(pageMetricsPath, `${JSON.stringify(checkpoint)}\n`);
  });
  page.on('requestfailed', request => {
    if (!request.url().includes('/market-data/v1/order-walls/archive/current?')) return;
    const entry = { kind: 'current-request-failed', at: Date.now(), url: request.url(),
      errorText: request.failure()?.errorText ?? null };
    currentRequestFailures.push(entry);
    appendFileSync(pageMetricsPath, `${JSON.stringify(entry)}\n`);
  });
  page.context().on('response', response => {
    if (response.url().includes('/market-data/v1/order-walls/archive/current?')) {
      currentResponseTasks.push((async () => {
        const headers = await response.allHeaders(), url = new URL(response.url());
        const entry: Record<string, unknown> = { kind: 'current-response', at: Date.now(), status: response.status(), url: response.url(),
          after: Number(url.searchParams.get('after')), watermark: Number(url.searchParams.get('watermark')),
          encoding: headers['content-encoding'] ?? null, contentLength: headers['content-length'] ?? null };
        try {
          const body = await response.json() as any;
          Object.assign(entry, { headValid: body.head?.valid ?? null, headCursor: body.head?.cursor ?? null, headAt: body.head?.at ?? null,
            pageAfter: body.page?.after ?? null, nextAfter: body.page?.nextAfter ?? null, hasMore: body.page?.hasMore ?? null,
            patchCount: Array.isArray(body.patches) ? body.patches.length : null, coverageStatus: body.coverage?.status ?? null,
            confirmedTo: body.coverage?.confirmedTo ?? null, gapCount: Array.isArray(body.coverage?.gaps) ? body.coverage.gaps.length : null,
            profileStatus: body.profileStatus ?? null });
        } catch (error) { entry.bodyError = String(error); }
        currentResponses.push(entry);
        appendFileSync(pageMetricsPath, `${JSON.stringify(entry)}\n`);
      })());
      return;
    }
    if (!response.url().includes('/market-data/v1/order-walls/archive?')) return;
    archiveResponseTasks.push((async () => {
      const headers = await response.allHeaders(), url = new URL(response.url());
      const entry: Record<string, unknown> = { kind: 'response', at: Date.now(), status: response.status(), url: response.url(),
        after: Number(url.searchParams.get('after')), watermark: Number(url.searchParams.get('watermark')),
        encoding: headers['content-encoding'] ?? null, contentLength: headers['content-length'] ?? null,
        transferEncoding: headers['transfer-encoding'] ?? null };
      try {
        const body = await response.json() as any;
        Object.assign(entry, { pageAfter: body.page?.after ?? null, nextAfter: body.page?.nextAfter ?? null,
          hasMore: body.page?.hasMore ?? null, patchCount: Array.isArray(body.patches) ? body.patches.length : null,
          coverageStatus: body.coverage?.status ?? null, confirmedTo: body.coverage?.confirmedTo ?? null,
          profileStatus: body.profileStatus ?? null });
      } catch (error) { entry.bodyError = String(error); }
      archiveResponses.push(entry);
      appendFileSync(pageMetricsPath, `${JSON.stringify(entry)}\n`);
    })());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2, null, { timeout: 120_000 });
  await page.evaluate(() => {
    const worker = (window as any).__terminal?.feed?.worker;
    const errors: string[] = [];
    (window as any).__orderWallsWorkerErrors = errors;
    worker?.addEventListener?.('error', (event: ErrorEvent) => errors.push(event.message || 'Worker error'));
    worker?.addEventListener?.('messageerror', () => errors.push('Worker message error'));
  });
  // The 5m chart needs the full workspace width to display 30h at the chart's
  // minimum bar spacing. Close only the neighboring chart in this isolated
  // test workspace, then hide the Object Tree through its user control.
  const neighboringChartClose = page.getByRole('button', { name: /^Close Hyperliquid/ });
  await expect(neighboringChartClose).toHaveCount(1);
  await neighboringChartClose.click();
  await page.waitForFunction(() => (window as any).__terminal?.panels.size === 1, null, { timeout: 30_000 });
  await selectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const panel = page.locator('.candle-panel').first();
  const closeObjectTree = panel.locator('.chart-objects-panel').getByRole('button', { name: 'Close Object Tree', exact: true });
  if (await closeObjectTree.isVisible()) await closeObjectTree.click();
  await expect(panel.locator('.chart-objects-panel')).toHaveAttribute('data-collapsed', 'true');
  const chartWidth = await panel.evaluate(element => element.getBoundingClientRect().width);
  expect(chartWidth).toBeGreaterThan(1_500);
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Live Order Walls probe could not locate a chart panel');
  await page.waitForFunction(id => (window as any).__terminal.panels.get(id)?.candles.length > 100, panelId, { timeout: 120_000 });
  await chooseChartMarket(panel, item.label);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption(item.interval);
  await page.waitForFunction<boolean, { panelId: string; interval: string }>(({ panelId, interval }) => {
    const p = (window as any).__terminal.panels.get(panelId);
    return p?.selection.interval === interval && p.candles.length > 400 && p.status?.state === 'live';
  }, { panelId, interval: item.interval }, { timeout: 180_000 });

  const viewport = await page.evaluate(id => {
    const p = (window as any).__terminal.panels.get(id), count = p.candles.length;
    const last = p.candles.at(-1), visibleBars = Math.ceil(30.5 * 60 * 60 / (p.selection.interval === '5m' ? 300 : 900));
    const from = Math.max(0, count - visibleBars - 2), to = count;
    const times = p.candles.map((c: any) => c.t).filter((time: number) => Number.isFinite(time));
    const strideCountsMs = times.slice(1).reduce((counts: Record<string, number>, time: number, index: number) => {
      const stride = String(time - times[index]!); counts[stride] = (counts[stride] ?? 0) + 1; return counts;
    }, {});
    p.engine.setRange({ from, to });
    const range = p.engine.visibleTimeRange();
    return { venue: p.selection.venue, market: p.selection.market, interval: p.selection.interval, intervalSeconds: p.selection.interval === '5m' ? 300 : 900, bars: count,
      panelWidth: p.element.getBoundingClientRect().width, objectTreeCollapsed: p.element.querySelector('.chart-objects-panel')?.getAttribute('data-collapsed'),
      theme: document.documentElement.dataset.theme,
      firstCandleMs: p.candles[0]?.t, lastCandleMs: last?.t, lastSixCandleOpensMs: times.slice(-6), candleStrideCountsMs: strideCountsMs,
      logical: p.engine.visibleRange(), visibleTimeSeconds: range, spanHours: range ? (range.to - range.from) / 3600 : null };
  }, panelId);
  console.log('LIVE_30H_VIEWPORT', JSON.stringify(viewport));
  expect(viewport.venue).toBe('binance');
  expect(viewport.market).toBe(item.market);
  expect(viewport.panelWidth).toBeGreaterThan(1_500);
  expect(viewport.objectTreeCollapsed).toBe('true');
  expect(viewport.theme).toBe('dark');
  expect(viewport.spanHours).toBeGreaterThanOrEqual(29.5);
  expect(Object.keys(viewport.candleStrideCountsMs)).toEqual([String(item.intervalSeconds * 1_000)]);
  expect(viewport.candleStrideCountsMs[String(item.intervalSeconds * 1_000)]).toBe(viewport.bars - 1);

  const heapBefore = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? null);
  await addIndicator(panel, 'Order Walls');
  await expect(panel.locator('.active-indicator[data-definition-id="native.order-walls"]')).toHaveCount(1);
  const heartbeatSamples: Array<Record<string, unknown>> = [];
  let heartbeatPending = Promise.resolve();
  await page.waitForFunction(id => {
    const status = (window as any).__terminal.panels.get(id)?.orderWallsStatus;
    return status?.lastConfirmedAt !== undefined && status?.archive?.requestComplete === false;
  }, panelId, { timeout: 120_000, polling: 500 });
  const pinnedViewport = await page.evaluate(id => {
    const p = (window as any).__terminal.panels.get(id), before = p.engine.visibleRange();
    if (!before) throw new Error('Order Walls probe has no visible time range to pin');
    p.engine.setRange({ from: before.from, to: before.to - 2 });
    const time = p.engine.visibleTimeRange(), after = p.engine.visibleRange();
    return { before, after, visibleTimeSeconds: time, latestCandleMs: p.candles.at(-1)?.t,
      statusAtPin: { state: p.orderWallsStatus?.state, lastConfirmedAt: p.orderWallsStatus?.lastConfirmedAt,
        archive: { from: p.orderWallsStatus?.archive?.from, to: p.orderWallsStatus?.archive?.to,
          watermark: p.orderWallsStatus?.archive?.watermark, requestComplete: p.orderWallsStatus?.archive?.requestComplete } },
      viewportKey: p.orderWallsViewportKey };
  }, panelId);
  expect(pinnedViewport.visibleTimeSeconds).toBeTruthy();
  expect(pinnedViewport.visibleTimeSeconds!.to).toBeGreaterThan(0);
  expect((pinnedViewport.visibleTimeSeconds!.to - pinnedViewport.visibleTimeSeconds!.from) / 3600).toBeGreaterThanOrEqual(29.5);
  expect(pinnedViewport.visibleTimeSeconds!.to).toBeLessThan(Date.now() / 1000 - item.intervalSeconds);
  await page.waitForFunction(id => (window as any).__terminal.panels.get(id)?.orderWallsViewportKey?.endsWith(':0'), panelId,
    { timeout: 10_000, polling: 100 });
  await page.evaluate<boolean, string>((id: string) => {
    const p = (window as any).__terminal.panels.get(id), monitor: any = {
      startedAt: Date.now(), initialCandleMs: p.candles.at(-1)?.t, initialVisibleTimeSeconds: p.engine.visibleTimeRange(),
      pinnedAt: Date.now(), pinnedVisibleTimeSeconds: p.engine.visibleTimeRange(), pinnedCandleMs: p.candles.at(-1)?.t, changes: [], timer: 0,
    };
    let previous = monitor.initialCandleMs;
    monitor.timer = window.setInterval(() => {
      const current = (window as any).__terminal.panels.get(id), candle = current?.candles.at(-1)?.t;
      if (candle === undefined || candle === previous) return;
      const strideMs = candle - previous;
      monitor.changes.push({ at: Date.now(), previousCandleMs: previous, nextCandleMs: candle, strideMs, strideSeconds: strideMs / 1_000,
        visibleTimeSeconds: current.engine.visibleTimeRange(), currentState: current.orderWallsStatus?.state,
        currentAt: current.orderWallsStatus?.lastConfirmedAt,
        archive: { state: current.orderWallsStatus?.archive?.state, requestComplete: current.orderWallsStatus?.archive?.requestComplete,
          loadedThrough: current.orderWallsStatus?.archive?.loadedThrough, watermark: current.orderWallsStatus?.archive?.watermark } });
      previous = candle;
    }, 1_000);
    (window as any).__orderWallsRolloverMonitor = monitor;
    return true;
  }, panelId);
  const workerArchiveBefore = await page.evaluate(async () => {
    const worker = (window as any).__terminal.feed.worker;
    return new Promise<any>(resolve => {
      const listener = (event: MessageEvent) => {
        if (event.data?.type !== 'diagnostics') return;
        worker.removeEventListener('message', listener); resolve(event.data.data?.orderWallsArchive ?? null);
      };
      worker.addEventListener('message', listener); worker.postMessage({ type: 'diagnostics' });
      setTimeout(() => { worker.removeEventListener('message', listener); resolve(null); }, 10_000);
    });
  });
  await page.evaluate(value => { (window as any).__orderWallsArchiveBefore = value; }, workerArchiveBefore);
  const viewportBeforeSeconds = pinnedViewport.visibleTimeSeconds;
  const heartbeat = setInterval(() => {
    heartbeatPending = heartbeatPending.then(async () => {
      const sample = await page.evaluate(id => {
        const p = (window as any).__terminal.panels.get(id);
        const archive = p?.orderWallsStatus?.archive;
        return { at: Date.now(), currentState: p?.orderWallsStatus?.state, lastConfirmedAt: p?.orderWallsStatus?.lastConfirmedAt,
          state: archive?.state, requestComplete: archive?.requestComplete,
          resumeAfter: archive?.resumeAfter, reason: archive?.reason, exact: archive?.exact,
          profileId: archive?.profileId, sourceGaps: archive?.gaps?.length,
          loadedThrough: p?.orderWallsStatus?.archive?.loadedThrough,
          confirmedTo: archive?.confirmedTo,
          segments: p?.engine.orderWallSegments.size, runs: p?.engine.orderWallsDiagnostics().archiveValueRuns,
          visibleTimeSeconds: p?.engine.visibleTimeRange() };
      }, panelId);
      heartbeatSamples.push(sample); appendFileSync(pageMetricsPath, `${JSON.stringify({ kind: 'heartbeat', market: item.market, ...sample })}\n`);
      console.log('LIVE_30H_HEARTBEAT', JSON.stringify({ market: item.market, ...sample }));
    }).catch(error => console.log('LIVE_30H_HEARTBEAT_ERROR', String(error)));
  }, 10_000);
  const waitForCompleteRequest = (timeout: number) => page.waitForFunction(id => {
    return (window as any).__terminal.panels.get(id)?.orderWallsStatus?.archive?.requestComplete === true;
  }, panelId, { timeout, polling: 1_000 });
  let historyWaitErrors: string[] = [];
  try {
    try { await waitForCompleteRequest(1_800_000); }
    catch (error) { historyWaitErrors.push(`Initial archive wait: ${String(error)}`); }
    const interrupted = await page.evaluate(id => {
      const archive = (window as any).__terminal.panels.get(id)?.orderWallsStatus?.archive;
      return archive?.requestComplete === false && archive.state === 'partial' && archive.resumeAfter !== undefined
        ? { resumeAfter: archive.resumeAfter, watermark: archive.watermark, reason: archive.reason } : null;
    }, panelId);
    if (interrupted) {
      const firstWatermark = archiveRequests.find(request => Number(request.after) === 0)?.watermark;
      const expectedWatermark = Number(interrupted.watermark ?? firstWatermark);
      const expectedAfter = Number(interrupted.resumeAfter);
      try {
        const resumedRequest = page.waitForRequest(request => {
          const url = new URL(request.url());
          return url.pathname.endsWith('/market-data/v1/order-walls/archive')
            && Number(url.searchParams.get('after')) === expectedAfter
            && Number(url.searchParams.get('watermark')) === expectedWatermark;
        }, { timeout: 120_000 });
        await panel.getByRole('button', { name: 'Resume Order Walls history', exact: true }).click();
        const request = await resumedRequest, url = new URL(request.url());
        const proof = { action: 'Resume history button', count: manualResumeEvidence.length + 1,
          after: Number(url.searchParams.get('after')), watermark: Number(url.searchParams.get('watermark')),
          expectedAfter, expectedWatermark, url: request.url() };
        manualResumeEvidence.push(proof);
        appendFileSync(pageMetricsPath, `${JSON.stringify({ kind: 'manual-resume', ...proof })}\n`);
        try { await waitForCompleteRequest(1_800_000); }
        catch (error) { historyWaitErrors.push(`Manual resume wait: ${String(error)}`); }
      } catch (error) { historyWaitErrors.push(`Manual resume action: ${String(error)}`); }
    }
    const rolloverTimeoutMs = item.intervalSeconds * 1_000 + 60_000;
    try {
      await page.waitForFunction(() => (window as any).__orderWallsRolloverMonitor?.changes?.length > 0,
        null, { timeout: rolloverTimeoutMs, polling: 1_000 });
    } catch (error) { historyWaitErrors.push(`Candle rollover wait: ${String(error)}`); }
    await page.waitForTimeout(1_000);
  } finally {
    clearInterval(heartbeat);
    await heartbeatPending;
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `artifacts/order-walls/${item.market}-30h-live-chart-archive-terminal.png`, fullPage: true });

  const loadedReport = await page.evaluate(async id => {
    const terminal = (window as any).__terminal, p = terminal.panels.get(id), engine = p.engine;
    const segments = [...engine.orderWallSegments.values()];
    const primitiveSegments = [...((engine.orderWalls as any)?.segments?.values?.() ?? [])];
    const archived = primitiveSegments.filter((s: any) => typeof s.archiveEntryId === 'string');
    const allRuns = archived.flatMap((s: any) => s.valueRuns.map((run: any) => ({ segmentId: s.id, price: s.priceExact ?? String(s.price), ...run })));
    allRuns.sort((a: any, b: any) => a.at - b.at);
    const sample = (index: number) => allRuns.length ? allRuns[Math.max(0, Math.min(allRuns.length - 1, index))] : null;
    const worker = terminal.feed.worker;
    const diagnostics = await new Promise<any>(resolve => {
      const listener = (event: MessageEvent) => {
        if (event.data?.type !== 'diagnostics') return;
        worker.removeEventListener('message', listener);
        resolve(event.data.data);
      };
      worker.addEventListener('message', listener);
      worker.postMessage({ type: 'diagnostics' });
      setTimeout(() => { worker.removeEventListener('message', listener); resolve(null); }, 10_000);
    });
    const rolloverMonitor = (window as any).__orderWallsRolloverMonitor;
    if (rolloverMonitor?.timer) clearInterval(rolloverMonitor.timer);
    return {
      fixture: terminal.fixture,
      selection: { venue: p.selection.venue, market: p.selection.market, interval: p.selection.interval },
      visibleTimeSeconds: engine.visibleTimeRange(),
      visibleSpanHours: (() => { const range = engine.visibleTimeRange(); return range ? (range.to - range.from) / 3600 : null; })(),
      settings: p.diagnostics().series.indicators.find((i: any) => i.definitionId === 'native.order-walls')?.settings,
      status: p.orderWallsStatus,
      engine: engine.orderWallsDiagnostics(),
      primitive: { ...(engine.orderWalls?.diagnostics?.() ?? {}), retainedSegmentCount: primitiveSegments.length,
        archiveEntryCount: archived.length, directEntryCount: primitiveSegments.length - archived.length },
      modelSegments: { retained: segments.length, archiveEntryCount: segments.filter((s: any) => typeof s.archiveEntryId === 'string').length,
        directEntryCount: segments.filter((s: any) => typeof s.archiveEntryId !== 'string').length,
        samples: segments.slice(0, 3).map((s: any) => ({ id: s.id, archiveEntryId: s.archiveEntryId, currentSelection: s.currentSelection,
          start: s.start, end: s.end, valueRuns: s.valueRuns?.length })) },
      archiveSegments: archived.length,
      archiveOpenSegments: archived.filter((s: any) => s.end === null).length,
      archiveClosedSegments: archived.filter((s: any) => s.end !== null).length,
      archiveRuns: allRuns.length,
      sampleRuns: { earliest: sample(0), midpoint: sample(Math.floor(allRuns.length / 2)), latest: sample(allRuns.length - 1) },
      sampleSegments: archived.slice(0, 3).map((s: any) => ({ id: s.id, archiveEntryId: s.archiveEntryId,
        side: s.side, price: s.priceExact ?? String(s.price), start: s.start, end: s.end,
        valueRuns: s.valueRuns.length, truncated: s.valueRunsTruncated,
        first: s.valueRuns[0] ?? null, middle: s.valueRuns[Math.floor(s.valueRuns.length / 2)] ?? null, last: s.valueRuns.at(-1) ?? null })),
      workerArchive: diagnostics?.orderWallsArchive ?? null,
      workerArchiveBefore: (window as any).__orderWallsArchiveBefore ?? null,
      rollover: rolloverMonitor ? { startedAt: rolloverMonitor.startedAt, initialCandleMs: rolloverMonitor.initialCandleMs,
        initialVisibleTimeSeconds: rolloverMonitor.initialVisibleTimeSeconds, changes: rolloverMonitor.changes,
        finalVisibleTimeSeconds: engine.visibleTimeRange() } : null,
      heapUsed: (performance as any).memory?.usedJSHeapSize ?? null,
    };
  }, panelId);
  await Promise.all(archiveResponseTasks);
  await Promise.all(currentResponseTasks);
  const capturedWorkerErrors = await page.evaluate(() => (window as any).__orderWallsWorkerErrors ?? []);
  const heapAfter = loadedReport.heapUsed as number | null;
  const responseSummary = { count: archiveResponses.length,
    statuses: Object.fromEntries([...new Set(archiveResponses.map(response => response.status))]
      .map(status => [String(status), archiveResponses.filter(response => response.status === status).length])),
    gzipResponses: archiveResponses.filter(response => response.encoding === 'gzip').length,
    compressedBytes: archiveResponses.reduce((sum, response) => sum + Number(response.contentLength ?? 0), 0),
    first: archiveResponses[0] ?? null, last: archiveResponses.at(-1) ?? null };
  await page.screenshot({ path: `artifacts/order-walls/${item.market}-30h-live-chart-before-fit.png`, fullPage: true });
  await panel.getByRole('button', { name: 'Order Walls settings', exact: true }).click();
  const settings = panel.locator('dialog.order-walls-settings');
  const fitEnabled = await settings.getByRole('button', { name: 'Fit Walls', exact: true }).isEnabled();
  if (fitEnabled) await settings.getByRole('button', { name: 'Fit Walls', exact: true }).click();
  const afterFit = await page.evaluate(id => {
    const p = (window as any).__terminal.panels.get(id), chart = p.engine.chart;
    return { visibleTimeSeconds: p.engine.visibleTimeRange(), price: chart.panes()[chart.primaryPaneIndex()].readoutScale().priceRange() };
  }, panelId);
  await settings.getByRole('button', { name: 'Close', exact: true }).click().catch(async () => settings.press('Escape'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/order-walls/${item.market}-30h-live-chart.png`, fullPage: true });
  const postFit = await page.evaluate(id => {
    const p = (window as any).__terminal.panels.get(id), chart = p.engine.chart;
    return { visibleTimeSeconds: p.engine.visibleTimeRange(), price: chart.panes()[chart.primaryPaneIndex()].readoutScale().priceRange(), status: p.orderWallsStatus };
  }, panelId);
  const report = { ...loadedReport, heartbeatSamples, historyWaitErrors, manualResumeEvidence,
    archiveRequests, archiveResponses, pageMetricsPath, initialViewport: viewport, pinnedViewport,
    workerArchiveBefore, currentRequests, currentResponses, currentRequestFailures,
    workerErrors: [...capturedWorkerErrors, ...workerErrors],
    fit: { enabled: fitEnabled, beforeVisibleTimeSeconds: viewportBeforeSeconds, after: afterFit, post: postFit } };
  const fullReport = { market: item.market, profileExpected: item.profile, theme: viewport.theme, panelWidth: viewport.panelWidth,
    objectTreeCollapsed: viewport.objectTreeCollapsed, heapBefore, heapAfter,
    heapDelta: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    archiveResponseSummary: responseSummary, ...report, pageErrors: errors,
    terminalScreenshot: `artifacts/order-walls/${item.market}-30h-live-chart-archive-terminal.png` };
  mkdirSync('artifacts/order-walls', { recursive: true });
  writeFileSync(`artifacts/order-walls/${item.market}-30h-live-chart-report.json`, `${JSON.stringify(fullReport, null, 2)}\n`);
  console.log('LIVE_30H_CHART', JSON.stringify(fullReport));
  console.log('LIVE_30H_FIT', JSON.stringify({ market: item.market, beforeVisibleTimeSeconds: viewportBeforeSeconds, afterFit, postFit }));

  expect(report.fixture).toBe(false);
  expect(report.selection.market).toBe(item.market);
  expect(report.status.archive.profileId).toBe(item.profile);
  expect(report.status.archive.exact).toBe(true);
  expect(report.status.archive.requestComplete).toBe(true);
  expect(['complete', 'partial']).toContain(report.status.archive.state);
  expect(report.status.archive.to - report.status.archive.from).toBeGreaterThanOrEqual(29.5 * 60 * 60 * 1000);
  expect(report.visibleSpanHours).toBeGreaterThanOrEqual(29.5);
  expect(report.selection.interval).toBe(item.interval);
  const rollover = report.rollover;
  expect(rollover).not.toBeNull();
  if (!rollover) throw new Error('Candle rollover telemetry was not captured');
  expect(rollover.changes.length).toBeGreaterThan(0);
  expect(rollover.changes.some((change: any) => change.strideSeconds === item.intervalSeconds)).toBe(true);
  expect(rollover.changes.some((change: any) => change.nextCandleMs === rollover.initialCandleMs + item.intervalSeconds * 1_000)).toBe(true);
  expect(rollover.changes.some((change: any) => change.archive.requestComplete === false
    && change.currentState === 'live')).toBe(true);
  expect(Math.abs(rollover.finalVisibleTimeSeconds.from - pinnedViewport.visibleTimeSeconds!.from)).toBeLessThan(1);
  expect(Math.abs(rollover.finalVisibleTimeSeconds.to - pinnedViewport.visibleTimeSeconds!.to)).toBeLessThan(1);
  expect(new Set(archiveRequests.map(request => `${request.market}:${request.profile}:${request.from}:${request.to}:${request.watermark}`)).size).toBe(1);
  expect(report.workerArchive.currentPages).toBeGreaterThan(workerArchiveBefore.currentPages);
  expect(report.workerArchive.failures).toBe(0);
  expect(report.workerArchive.ringDrops).toBe(0);
  expect(report.engine.archiveSegments).toBeGreaterThan(0);
  expect(report.primitive.archiveEntryCount).toBeGreaterThan(0);
  expect(report.engine.valueHistoryLimited).toBe(false);
  expect(report.engine.episodeHistoryLimited).toBe(false);
  expect(report.status.archive.gapsTruncated ?? false).toBe(false);
  expect(report.archiveRuns).toBeGreaterThan(0);
  expect(report.fit.enabled).toBe(true);
  expect(report.fit.after.visibleTimeSeconds).toEqual(viewportBeforeSeconds);
  expect(report.fit.post.status.lastConfirmedAt).toBeGreaterThan(report.status.lastConfirmedAt);
  for (const resume of manualResumeEvidence) {
    expect(resume.after).toBe(resume.expectedAfter);
    expect(resume.watermark).toBe(resume.expectedWatermark);
  }
  expect(errors).toEqual([]);
});

import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addIndicator, chooseChartMarket, expectHeatmapLiveQuiet, setFootprint, setPriceLevel } from './indicator-actions';
import { selectTheme } from './footer-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function setup(page: Page) {
  page.on('pageerror', error => console.log('Journal browser error:', error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  return page.locator('.candle-panel').first();
}

async function entries(page: Page) {
  return page.evaluate(() => (window as any).__terminal.journal.repository.entries({ limit: 500 }));
}

async function drafts(page: Page) {
  return page.evaluate(() => (window as any).__terminal.journal.repository.drafts());
}

async function counts(page: Page) {
  return page.evaluate(async () => {
    const usage = await (window as any).__terminal.journal.repository.usage();
    return { entries: usage.entries, drafts: usage.drafts, assets: usage.assets };
  });
}

async function openJournal(page: Page) {
  const journal = page.locator('.global-journal-panel');
  if (!(await journal.count())) {
    await page.getByRole('button', { name: 'Application menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
  }
  await expect(journal).toBeVisible();
  return journal;
}

async function cameraAction(page: Page, panel: Locator, name = 'Add to journal…') {
  await panel.getByRole('button', { name: 'Camera actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function continueCaptureWarning(page: Page) {
  const warning = page.getByRole('dialog', { name: 'Chart image capture status', exact: true });
  await expect.poll(async () => (await drafts(page)).length === 1 || await warning.isVisible()).toBe(true);
  if (await warning.isVisible()) await warning.getByRole('button', { name: 'Continue with warnings', exact: true }).click();
}

async function waitForChartDraft(page: Page) {
  await continueCaptureWarning(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(1);
  const journal = await openJournal(page);
  const composer = journal.locator('.journal-v2-dialog');
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Entry body in Markdown')).toHaveValue(/attachment:/);
  return { journal, composer, draft: (await drafts(page))[0] };
}

async function addChartDraft(page: Page, panel: Locator) {
  await cameraAction(page, panel);
  return waitForChartDraft(page);
}

async function publish(composer: Locator, page: Page, title: string) {
  await composer.getByLabel('Title (optional)', { exact: true }).fill(title);
  await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect(composer).toBeHidden();
  await expect.poll(async () => (await counts(page)).entries).toBe(1);
  await expect.poll(async () => (await counts(page)).drafts).toBe(0);
  return (await entries(page))[0];
}

async function drawingTool(panel: Locator, id: string) {
  const primary = panel.locator(`.drawing-sidebar-primary[data-drawing-tool="${id}"]`);
  if (await primary.isVisible()) { await primary.click(); return; }
  const option = panel.locator(`.drawing-sidebar-flyout-tool[data-drawing-tool="${id}"]`);
  const group = await option.getAttribute('data-drawing-group');
  await panel.locator(`.drawing-sidebar-menu-toggle[data-drawing-group="${group}"]`).click();
  await option.click();
}

async function drawZone(page: Page, panel: Locator) {
  const before = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.drawings.drawings().length);
  await drawingTool(panel, 'rectangle');
  const plot = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.plotRect(0));
  await panel.locator('.chart-stage').click({ position: { x: plot.left + plot.width * .35, y: plot.top + plot.height * .35 } });
  await panel.locator('.chart-stage').click({ position: { x: plot.left + plot.width * .55, y: plot.top + plot.height * .55 } });
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.drawings.drawings().length)).toBe(before + 1);
}

async function attachmentPng(page: Page, record: any, path: string) {
  const bytes = await page.evaluate(async (input: any) => {
    const repository = (window as any).__terminal.journal.repository;
    const attachment = input.attachments.find((item: any) => item.kind === 'chart-capture');
    const asset = await repository.asset(attachment.assetId);
    return [...new Uint8Array(await asset.blob.arrayBuffer())];
  }, record);
  await writeFile(path, new Uint8Array(bytes));
}

test('Add to Journal preserves the frozen snapshot, publishes markers, restores context, and round-trips backups', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const panel = await setup(page);
  await selectTheme(page, 'dark');
  await drawZone(page, panel);
  await addIndicator(panel, 'Multi-Venue CVD');
  const before = await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0];
    return { id: chart.params.api.id, drawings: chart.engine.drawings.toJSON(), config: structuredClone(chart.selection) };
  });

  const { journal, composer, draft } = await addChartDraft(page, panel);
  const draftAttachment = draft.attachments.find((item: any) => item.kind === 'chart-capture');
  expect(draftAttachment).toBeTruthy();
  const capture = draftAttachment.chartCapture;
  expect(capture.imageStatus).toMatch(/^(complete|partial)$/);
  expect(capture.replay).toMatchObject({ playback: 'not-implemented', retention: 'unpreserved', screenshot: true });
  expect(capture.snapshot.drawings).toEqual(before.drawings);
  expect(capture.snapshot.config).toEqual(Object.fromEntries(Object.entries(before.config).filter(([key]) => key !== 'tradingOverlay')));
  expect(capture.snapshot.candleState.last.closed).toBe(false);
  expect(await entries(page)).toHaveLength(0);
  expect(await counts(page)).toMatchObject({ entries: 0, drafts: 1, assets: 2 });
  await expect(panel.locator('.journal-marker')).toHaveCount(0);

  await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0];
    const drawing = chart.engine.drawings.drawings()[0];
    chart.engine.drawings.update(drawing.id, { style: { ...drawing.style, color: '#ad5858' } });
  });
  expect((await drafts(page))[0].attachments[0].chartCapture.snapshot.drawings).toEqual(before.drawings);
  const entry = await publish(composer, page, 'Frozen chart snapshot');
  expect(entry.attachments[0].kind).toBe('chart-capture');
  expect(entry.attachments[0].chartCapture.snapshot.drawings).toEqual(before.drawings);
  await expect(panel.locator('.journal-marker')).toHaveCount(1);

  await page.screenshot({ path: 'artifacts/journal-editor.png' });
  await attachmentPng(page, entry, 'artifacts/journal-candle-cvd.png');
  await page.reload();
  await expect.poll(async () => (await counts(page)).entries).toBe(1);
  const reloadedJournal = page.locator('.global-journal-panel');
  await expect(reloadedJournal).toBeVisible();
  await expect(panel.locator('.journal-marker')).toHaveCount(1);
  await reloadedJournal.locator('.journal-v2-context-chip').click();
  await expect(page.locator('.candle-panel')).toHaveCount(2);
  await expect(page.locator('.journal-restored-notice')).toContainText('not replay');
  const restored = await page.evaluate(() => [...(window as any).__terminal.panels.values()].map((chart: any) => ({
    id: chart.params.api.id,
    drawings: chart.engine.drawings.toJSON(),
  })));
  expect(restored[0].id).toBe(before.id);
  expect(restored[1].id).not.toBe(restored[0].id);
  expect(restored[1].drawings.drawings[0].id).not.toBe(restored[0].drawings.drawings[0].id);
  expect(restored[1].drawings.drawings[0].points).toEqual(capture.snapshot.drawings.drawings[0].points);

  await reloadedJournal.locator('.journal-v2-tools summary').click();
  const downloadPromise = page.waitForEvent('download');
  await reloadedJournal.getByRole('button', { name: 'Export matches and drafts', exact: true }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  page.once('dialog', dialog => { void dialog.accept(); });
  await reloadedJournal.locator(`.journal-v2-post[data-entry-id="${entry.id}"]`).getByRole('button', { name: 'Delete Frozen chart snapshot', exact: true }).click();
  await expect.poll(async () => (await counts(page)).entries).toBe(0);
  await expect.poll(async () => (await counts(page)).assets).toBe(0);
  await reloadedJournal.getByLabel('Import journal backup', { exact: true }).setInputFiles(backupPath!);
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 1, drafts: 0, assets: 2 });
  expect((await entries(page))[0]).toEqual(entry);
  expect(errors).toEqual([]);
});

test('camera Add can be discarded after encoding failure without creating a draft, entry, or marker', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) { setTimeout(() => callback(null), 10); };
  });
  const panel = await setup(page);
  await drawZone(page, panel);
  await cameraAction(page, panel);
  const warning = page.getByRole('dialog', { name: 'Chart image capture status', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 0, drafts: 0, assets: 0 });
  await expect(panel.locator('.journal-marker')).toHaveCount(0);
  const instrument = await page.evaluate(() => JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]));
  const links = await page.evaluate(async (key: string) => (window as any).__terminal.journal.repository.queryChartLinks({ instrument: key, from: Date.now() - 3_600_000, to: Date.now() + 60_000 }), instrument);
  expect(links).toEqual([]);
});

test('chart and drawings stay frozen when the source market changes and closes during encoding', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, blob => setTimeout(() => callback(blob), 1200), type, quality);
    };
  });
  const panel = await setup(page);
  await drawZone(page, panel);
  const frozenDrawings = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.drawings.toJSON());
  await cameraAction(page, panel);
  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].params.api.close());
  await expect(page.locator('.candle-panel')).toHaveCount(0);
  await continueCaptureWarning(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(1);
  const journal = await openJournal(page);
  const draft = (await drafts(page))[0];
  const capture = draft.attachments.find((item: any) => item.kind === 'chart-capture').chartCapture;
  expect(capture.snapshot.market).toEqual({ venue: 'binance', market: 'perpetual', symbol: 'BTCUSDT' });
  expect(capture.snapshot.drawings).toEqual(frozenDrawings);
  expect(await counts(page)).toMatchObject({ entries: 0, drafts: 1, assets: 2 });
  await journal.locator('.journal-v2-dialog').getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
  await expect(journal.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');
});

for (const dpr of [1, 2]) test(`R2 chart attachment composites footprint, depth, axes, drawings and CVD at DPR ${dpr}`, async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 }, deviceScaleFactor: dpr,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const { installDepthFixture } = await import('./depth-fixture');
  await installDepthFixture(page, 0, true);
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Order-book Heatmap');
  await expectHeatmapLiveQuiet(panel);
  await page.evaluate(() => {
    const terminal = (window as any).__terminal;
    const chart = [...terminal.panels.values()][0];
    const last = chart.engine.chart.dataLayer.indexToTime(chart.engine.chart.dataLayer.length - 1);
    terminal.feed.subscribeFootprint = (_id: string, _series: any, rowSize: number, callback: any) => {
      const status = { state: 'live', message: 'Explicit R2 composite fixture', lastUpdate: Date.now(), tickSize: .1, rowSize, collectionStartedAt: Date.now(), coverage: 'partial' };
      queueMicrotask(() => callback({
        type: 'footprint-snapshot',
        bars: Array.from({ length: 10 }, (_, i) => ({
          time: last - (9 - i) * 60, revision: 1, rowSize, open: 83500, high: 83540, low: 83480, close: 83520,
          delta: 8, minDelta: -2, maxDelta: 12,
          cells: Array.from({ length: 12 }, (_, j) => ({ price: 83480 + j * 5, bidVol: 1 + j, askVol: 2 + j * 1.3 })),
          coverage: 'partial', gapBefore: false,
        })), retentionStart: last - 9 * 60, status,
      }));
      return () => {};
    };
  });
  await setFootprint(panel, true);
  await setPriceLevel(panel, '5');
  await addIndicator(panel, 'Multi-Venue CVD');
  await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0].engine.chart;
    chart.setAutoScale(false);
    chart.panes()[chart.primaryPaneIndex()].readoutScale().setPriceRange({ min: 83400, max: 83620 });
    const count = chart.dataLayer.length;
    chart.setVisibleLogicalRange({ from: count - 12, to: count + 2 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].heatmap.bins)).toBeGreaterThan(0);
  await drawZone(page, panel);
  const { draft } = await addChartDraft(page, panel);
  const attachment = draft.attachments.find((item: any) => item.kind === 'chart-capture');
  const capture = attachment.chartCapture;
  expect(capture.imageStatus).toBe('complete');
  expect(capture.snapshot.layers.some((layer: any) => /resting order book/i.test(layer.layer))).toBe(true);
  await attachmentPng(page, draft, `artifacts/journal-footprint-heatmap-dpr${dpr}.png`);
  const image = await page.evaluate(async (input: any) => {
    const repository = (window as any).__terminal.journal.repository;
    const attachment = input.attachments.find((item: any) => item.kind === 'chart-capture');
    const asset = await repository.asset(attachment.assetId);
    const bitmap = await createImageBitmap(asset.blob), canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 25) colored++;
    bitmap.close();
    return { width: canvas.width, height: canvas.height, colored };
  }, draft);
  expect(image.width).toBeGreaterThan(900 * dpr);
  expect(image.height).toBeGreaterThan(500 * dpr);
  expect(image.colored).toBeGreaterThan(3000 * dpr);
  await context.close();
});

test('historical chart Add uses its market-time anchor and backup import restores the immutable entry after a failed draft write', async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await setup(page);
  await drawZone(page, panel);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__failJournalDraft = true;
    (IDBObjectStore.prototype as any).put = function (this: IDBObjectStore, ...args: any[]) {
      if (this.name === 'drafts' && (window as any).__failJournalDraft) throw new DOMException('Explicit quota fixture', 'QuotaExceededError');
      return (original as any).apply(this, args);
    };
  });
  await cameraAction(page, panel);
  await expect(page.locator('.journal-toast')).toContainText('Chart draft was not saved');
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 0, drafts: 0, assets: 0 });

  await page.evaluate(() => { (window as any).__failJournalDraft = false; });
  const plot = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.plotRect(0));
  await panel.locator('.chart-stage').click({ button: 'right', position: { x: plot.left + plot.width * .2, y: plot.top + plot.height * .2 } });
  await page.getByRole('menuitem', { name: 'Add to journal…', exact: true }).click();
  await continueCaptureWarning(page);
  const journal = await openJournal(page);
  const composer = journal.locator('.journal-v2-dialog');
  const draft = (await drafts(page))[0];
  const attachment = draft.attachments.find((item: any) => item.kind === 'chart-capture');
  expect(draft.entryAt).toBe(attachment.chartCapture.marketTime);
  expect(attachment.chartCapture.marketTime).toBeLessThan(attachment.chartCapture.capturedAt);
  await composer.getByLabel('Entry body in Markdown').fill('Historical chart context');
  const entry = await publish(composer, page, 'Historical chart note');
  expect(entry.entryAt).toBe(attachment.chartCapture.marketTime);
  const historicalIndex = await page.evaluate(time => {
    const chart = [...(window as any).__terminal.panels.values()][0];
    return chart.engine.chart.dataLayer.timeToIndexFloat(time / 1000);
  }, attachment.chartCapture.marketTime);
  expect(Number.isFinite(historicalIndex)).toBe(true);
  await page.evaluate(index => {
    const chart = [...(window as any).__terminal.panels.values()][0], data = chart.engine.chart.dataLayer;
    chart.engine.chart.setVisibleLogicalRange({ from: Math.max(0, index - 40), to: Math.min(data.length - 1, index + 40) });
  }, historicalIndex);
  await expect(page.locator('.journal-marker')).toHaveCount(1);

  await journal.locator('.journal-v2-tools summary').click();
  const downloadPromise = page.waitForEvent('download');
  await journal.getByRole('button', { name: 'Export matches and drafts', exact: true }).click();
  const backupPath = await (await downloadPromise).path();
  expect(backupPath).toBeTruthy();
  page.once('dialog', dialog => { void dialog.accept(); });
  await journal.locator(`.journal-v2-post[data-entry-id="${entry.id}"]`).getByRole('button', { name: 'Delete Historical chart note', exact: true }).click();
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 0, drafts: 0, assets: 0 });
  await journal.getByLabel('Import journal backup', { exact: true }).setInputFiles(backupPath!);
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 1, drafts: 0, assets: 2 });
  expect((await entries(page))[0]).toEqual(entry);
});

test('paste inserts multiple inline images at the caret, preview renders them, and discard removes the draft assets', async ({ page }) => {
  const panel = await setup(page);
  const journal = await openJournal(page);
  await journal.locator('.journal-v2-add').click();
  const composer = journal.locator('.journal-v2-dialog');
  const body = composer.getByLabel('Entry body in Markdown');
  await body.fill('before\nsuffix');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI+kAAAAASUVORK5CYII=';
  await body.evaluate((element, data: string) => {
    const textarea = element as HTMLTextAreaElement;
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
    transfer.items.add(new File([blob], 'first.png', { type: 'image/png' }));
    transfer.items.add(new File([blob], 'second.png', { type: 'image/png' }));
    textarea.focus(); textarea.setSelectionRange('before\n'.length, 'before\n'.length);
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  const attachments = composer.locator('.journal-v2-attachment');
  await expect(attachments).toHaveCount(2);
  await expect.poll(async () => (await drafts(page))[0]?.attachments.length).toBe(2);
  const cards = [attachments.nth(0), attachments.nth(1)];
  await cards[0].getByLabel('Alt text', { exact: true }).fill('First inline image');
  await cards[0].getByLabel('Caption', { exact: true }).fill('First caption');
  await cards[1].getByLabel('Alt text', { exact: true }).fill('Second inline image');
  await cards[1].getByLabel('Caption', { exact: true }).fill('Second caption');
  await expect(body).toHaveValue(/^before\n!\[First inline image\]\(attachment:[^)]+\)\n!\[Second inline image\]\(attachment:[^)]+\)\nsuffix$/);
  await composer.getByLabel('Add images: choose files, drop images, or paste an image into the editor').evaluate((element, data: string) => {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes.buffer as ArrayBuffer], 'dropped.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(attachments).toHaveCount(3);
  await expect.poll(async () => (await drafts(page))[0]?.attachments.length).toBe(3);
  await composer.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  const preview = composer.locator('.journal-v2-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(3);
  await expect(preview.locator('img').nth(0)).toHaveAttribute('alt', 'First inline image');
  await expect(preview.locator('img').nth(1)).toHaveAttribute('alt', 'Second inline image');
  await expect(preview).toContainText('First caption');
  await expect(preview).toContainText('Second caption');
  await composer.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  page.once('dialog', dialog => { void dialog.accept(); });
  await composer.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(composer).toBeHidden();
  await expect.poll(async () => counts(page)).toMatchObject({ entries: 0, drafts: 0, assets: 0 });
  await expect(panel.locator('.journal-marker')).toHaveCount(0);
});

test('10,000 indexed chart links stay bounded, retain marker focus, and isolate markets', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const panel = await setup(page);
  const { composer } = await addChartDraft(page, panel);
  await publish(composer, page, 'Marker benchmark seed');
  await expect.poll(() => panel.locator('.journal-marker').count()).toBeGreaterThan(0);
  const measurement = await page.evaluate(async (count: number) => {
    const terminal = (window as any).__terminal, chart = [...terminal.panels.values()][0];
    const repository = terminal.journal.repository, last = chart.engine.chart.dataLayer.indexToTime(chart.engine.chart.dataLayer.length - 1) * 1000;
    const market = { venue: 'binance', market: 'perpetual', symbol: 'BTCUSDT' };
    const instrument = JSON.stringify(['binance', 'perpetual', 'BTCUSDT', null]);
    const capturedAt = Date.now();
    const snapshot = {
      version: 1, app: 'journal marker fixture', engine: '2.6.0', capturedAt, market,
      config: { type: 'candle', indicators: [] }, nativeState: {},
      panes: [{ id: 'price', capturedIndex: 0, members: [], primary: true }],
      drawings: {}, objectTree: {}, visibleRange: null, dataAsOf: null, layers: [], scripts: [], warnings: [],
    };
    const replay = {
      version: 1, market, requestedRange: null, captureCutoff: null, warmup: 'unknown', streams: [],
      retention: 'unpreserved', playback: 'not-implemented', screenshot: true, chartState: true,
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('iqterminal-journal-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['entries', 'chartLinks'], 'readwrite');
      const entryStore = transaction.objectStore('entries'), linkStore = transaction.objectStore('chartLinks');
      for (let index = 0; index < count; index++) {
        const entryId = `marker-benchmark-${String(index).padStart(5, '0')}`;
        const marketTime = last - index * 30_000, attachmentId = `marker-attachment-${index}`;
        const captureId = `marker-capture-${index}`, imageId = `marker-image-${index}`, thumbnailId = `marker-thumbnail-${index}`;
        const capture = { version: 1, id: captureId, capturedAt, marketTime, snapshot, replay, image: imageId, thumbnail: thumbnailId, imageStatus: 'complete', imageWarnings: [] };
        const attachment = { id: attachmentId, kind: 'chart-capture', assetId: imageId, thumbnailAssetId: thumbnailId, chartCapture: capture };
        const title = `Benchmark ${index}`;
        const revision = { at: capturedAt, kind: 'original', entryAt: marketTime, title, bodyMarkdown: '', tags: [], entryKind: 'note', attachments: [attachment], relatedEntryIds: [] };
        entryStore.add({ version: 2, id: entryId, entryAt: marketTime, createdAt: capturedAt, updatedAt: capturedAt, title, bodyMarkdown: '', tags: [], kind: 'note', attachments: [attachment], relatedEntryIds: [], revisions: [revision] });
        linkStore.put({ instrument, marketTime, entryId, attachmentId });
      }
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    const writeMs = performance.now() - start, queryAt = performance.now();
    const range = await repository.queryChartLinks({ instrument, from: last - 3_600_000, to: last + 60_000, limit: 500 });
    const queryMs = performance.now() - queryAt;
    (repository as any).changed({ kind: 'entry', instrument });
    database.close();
    return { count: count + 1, writeMs, queryMs, rangeRows: range.length, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, userAgent: navigator.userAgent };
  }, 10_000);

  await expect.poll(() => panel.locator('.journal-marker').count()).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const first = panel.locator('.journal-marker').first();
  await first.focus();
  const focusedLinksBefore = await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0], marker = document.activeElement as HTMLElement;
    const cluster = chart.journalBridge.markers.clusters[Number(marker.dataset.cluster)];
    return cluster?.links.map((link: any) => `${link.entry.id}:${link.attachment.id}`) ?? [];
  });
  const before = await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0];
    return { diagnostics: { ...chart.journalBridge.markers.diagnostics }, range: chart.engine.chart.panes()[0].priceScale.priceRange(), feeds: (window as any).__terminal.stats().feed };
  });
  await page.waitForTimeout(1000);
  await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains('journal-marker'))).toBe(true);
  const focusedLinksAfter = await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0], marker = document.activeElement as HTMLElement;
    const cluster = chart.journalBridge.markers.clusters[Number(marker.dataset.cluster)];
    return cluster?.links.map((link: any) => `${link.entry.id}:${link.attachment.id}`) ?? [];
  });
  expect(focusedLinksAfter.some((id: string) => focusedLinksBefore.includes(id))).toBe(true);
  const after = await page.evaluate(() => ({ ...[...(window as any).__terminal.panels.values()][0].journalBridge.markers.diagnostics }));
  expect(after.links).toBeLessThanOrEqual(500);
  expect(after.clusters).toBeLessThanOrEqual(100);
  expect(after.queries).toBe(before.diagnostics.queries);
  await page.keyboard.press('Enter');
  await expect(page.locator('.journal-marker-preview[data-interactive="true"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0];
    chart.engine.chart.setVisibleLogicalRange({ from: 0, to: chart.engine.chart.dataLayer.length - 1 });
  });
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].journalBridge.markers.diagnostics.capped)).toBe(true);
  const zoomedOut = await page.evaluate(() => ({ ...[...(window as any).__terminal.panels.values()][0].journalBridge.markers.diagnostics }));
  expect(zoomedOut.links).toBe(500);
  expect(zoomedOut.clusters).toBeLessThanOrEqual(100);
  await writeFile('artifacts/journal-marker-benchmark.json', JSON.stringify({ environment: 'local Chromium SwiftShader; explicit synthetic IndexedDB fixture; no live connectivity or frame-rate claim', browserName, ...measurement, before: before.diagnostics, after, zoomedOut }, null, 2));
  await page.screenshot({ path: 'artifacts/journal-marker-benchmark.png' });
  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect(panel.locator('.journal-marker')).toHaveCount(0);
});

test('native arrow, projected path and bounded brush share drawing history, persistence and extended-zone selection', async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await setup(page), stage = panel.locator('.chart-stage');
  const plot = await page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.plotRect(0));
  const at = (x: number, y: number) => ({ x: plot.left + plot.width * x, y: plot.top + plot.height * y });
  const state = () => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.drawings.toJSON());
  await drawingTool(panel, 'arrow');
  await stage.click({ position: at(.2, .3) }); await stage.click({ position: at(.4, .4) });
  await expect.poll(async () => (await state()).drawings.length).toBe(1);
  await drawingTool(panel, 'path');
  await stage.click({ position: at(.3, .6) }); await stage.click({ position: at(.45, .5) }); await stage.click({ position: at(.6, .7) });
  await stage.dblclick({ position: at(.7, .4) });
  await expect.poll(async () => (await state()).drawings.length).toBe(2);
  expect((await state()).drawings[1].points.length).toBeGreaterThanOrEqual(3);
  await drawingTool(panel, 'brush');
  const box = (await stage.boundingBox())!, start = at(.25, .8);
  await page.mouse.move(box.x + start.x, box.y + start.y); await page.mouse.down();
  for (let i = 0; i < 25; i++) { const point = at(.25 + i * .015, .8 + Math.sin(i * .6) * .05); await page.mouse.move(box.x + point.x, box.y + point.y); }
  await page.mouse.up();
  await expect.poll(async () => (await state()).drawings.length).toBe(3);
  expect((await state()).drawings[2].points.length).toBeLessThanOrEqual(512);
  await panel.getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(async () => (await state()).drawings.length).toBe(2);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click(); await expect.poll(async () => (await state()).drawings.length).toBe(3);
  await drawingTool(panel, 'path'); await stage.click({ position: at(.1, .1) }); await page.keyboard.press('Escape');
  expect((await state()).drawings).toHaveLength(3);
  await drawZone(page, panel);
  const extended = await page.evaluate(() => {
    const chart = [...(window as any).__terminal.panels.values()][0], drawing = chart.engine.drawings.drawings().at(-1);
    chart.engine.drawings.update(drawing.id, { style: { ...drawing.style, extendRight: true } }); chart.engine.drawings.select(null); return drawing.id;
  });
  await stage.click({ position: at(.85, .35), button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.screenshot({ path: 'artifacts/journal-everyday-drawings.png' });
  const saved = await state(); await page.reload();
  await expect.poll(async () => (await state()).drawings.length).toBe(4);
  expect((await state()).drawings.map((drawing: any) => drawing.points)).toEqual(saved.drawings.map((drawing: any) => drawing.points));
  expect((await state()).drawings.at(-1).id).toBe(extended);
});

test('marker timeframes and touch access preserve autoscale; saved-chart restore enforces the eight-chart budget', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', hasTouch: true, viewport: { width: 1366, height: 900 }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage(), panel = await setup(page);
  const range = () => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].engine.chart.panes()[0].priceScale.priceRange());
  const widthBeforeAdd = await panel.locator('.chart-stage').evaluate(element => element.clientWidth);
  await panel.getByRole('button', { name: 'Camera actions', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Add to journal…', exact: true }).tap();
  const { journal, composer } = await waitForChartDraft(page);
  await expect.poll(() => panel.locator('.chart-stage').evaluate(element => element.clientWidth)).toBeLessThan(widthBeforeAdd);
  const before = await range();
  await publish(composer, page, 'Touch marker');
  await expect(panel.locator('.journal-marker')).toHaveCount(1);
  expect(await range()).toEqual(before);
  await panel.getByLabel('Timeframe', { exact: true }).selectOption('5m');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.interval)).toBe('5m');
  await expect(panel.locator('.journal-marker')).toHaveCount(1);
  await panel.locator('.journal-marker').tap();
  await expect(journal.locator('.journal-v2-post')).toHaveCount(1);
  await page.evaluate(() => { const terminal = (window as any).__terminal; for (let index = 0; index < 7; index++) terminal.addChart(); });
  await expect(page.locator('.candle-panel')).toHaveCount(8);
  await journal.locator('.journal-v2-context-chip').tap();
  await expect(journal.locator('.journal-v2-status')).toContainText('All 8 chart slots');
  await expect(page.locator('.candle-panel')).toHaveCount(8);
  expect(await entries(page)).toHaveLength(1);
  await context.close();
});

import { expect, test } from '@playwright/test';

test('Depth Matrix keeps its current rows while a replacement viewport batch is delayed', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class DelayedMatrixWorker extends NativeWorker {
      set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        const worker = this, state = window as any;
        super.onmessage = handler && function(event) {
          const data = event.data as any;
          if (data?.type === 'depth-matrix-batch') {
            if (!state.__initialDepthMatrixViewport) state.__initialDepthMatrixViewport = data.viewport;
            if (state.__holdDepthMatrixPage && data.viewport?.low !== state.__initialDepthMatrixViewport?.low) {
              state.__heldDepthMatrixBatch = data;
              state.__releaseDepthMatrixPage = () => {
                const held = state.__heldDepthMatrixBatch;
                state.__heldDepthMatrixBatch = undefined;
                state.__holdDepthMatrixPage = false;
                if (held) handler.call(worker, new MessageEvent('message', { data: held }));
              };
              return;
            }
          }
          handler.call(worker, event);
        };
      }
      get onmessage() { return super.onmessage; }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: DelayedMatrixWorker });
  });

  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel'), scroll = matrix.locator('.depth-matrix-scroll');
  await expect(matrix.locator('.depth-matrix-column-head small')).toHaveText(['FIXTURE', 'FIXTURE']);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__initialDepthMatrixViewport))).toBe(true);
  await expect(matrix.locator('.depth-matrix-price-row')).toHaveCount(160);
  const initialFirstRow = await matrix.locator('.depth-matrix-price-row').first().getAttribute('data-price-range');
  const initialViewport = await page.evaluate(() => (window as any).__initialDepthMatrixViewport);
  // Page immediately after centering: its queued scroll event may coalesce with this move.
  await page.evaluate(() => { (window as any).__holdDepthMatrixPage = true; });
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__heldDepthMatrixBatch))).toBe(true);
  const held = await page.evaluate(() => (window as any).__heldDepthMatrixBatch);
  expect(held.viewport.low).not.toBe(initialViewport.low);
  await expect(matrix.locator('.depth-matrix-price-row')).toHaveCount(160);
  await expect(matrix.locator('.depth-matrix-price-row').first()).toHaveAttribute('data-price-range', initialFirstRow!);
  await expect(matrix.locator('.depth-matrix-column-head[data-state="live"]')).toHaveCount(2);

  const pageAnchor = await page.evaluate(() => {
    const p=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='depth-matrix').view.content;
    return p.rowLayout.anchor(p.scroll.scrollTop);
  });
  await page.evaluate(() => (window as any).__releaseDepthMatrixPage());
  await expect.poll(() => matrix.locator('.depth-matrix-price-row').first().getAttribute('data-price-range')).not.toBe(initialFirstRow);
  await expect(matrix.locator('.depth-matrix-price-row')).toHaveCount(160);
  await expect.poll(() => page.evaluate(() => {
    const p=(window as any).__terminal.dock.panels.find((p:any)=>p.view.contentComponent==='depth-matrix').view.content;
    return p.rowLayout.anchor(p.scroll.scrollTop);
  })).toEqual(pageAnchor);
  await expect(matrix.locator('.depth-matrix-column-head[data-state="live"]')).toHaveCount(2);
  await page.evaluate(() => { (window as any).__holdDepthMatrixPage = true; });
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__heldDepthMatrixBatch))).toBe(true);
  await matrix.getByRole('button', { name: 'CENTER', exact: true }).click();
  await expect.poll(() => matrix.locator('.depth-matrix-price-row').first().getAttribute('data-price-range')).toBe(initialFirstRow);
  await page.evaluate(() => (window as any).__releaseDepthMatrixPage());
  await expect(matrix.locator('.depth-matrix-price-row').first()).toHaveAttribute('data-price-range', initialFirstRow!);
});

test('Depth Matrix Center and manual ranges survive tab resubscription without paging away', async ({ page }) => {
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel'), scroll = matrix.locator('.depth-matrix-scroll');
  await expect(matrix.locator('.depth-matrix-price-row')).toHaveCount(160);
  const state = () => page.evaluate(() => {
    const panel = (window as any).__terminal.dock.panels.find((p: any) => p.view.contentComponent === 'depth-matrix');
    return panel.view.content.diagnostics();
  });
  const initial = (await state()).viewport;
  // The first user move must survive a still-queued programmatic centering event.
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect.poll(async () => Number((await state()).viewport.low)).toBeGreaterThan(Number(initial.low));
  await expect.poll(async () => (await state()).pendingViewport ?? null).toBeNull();
  const high = await state();
  const switchTab = async () => {
    await page.evaluate(() => {
      const dock = (window as any).__terminal.dock;
      const matrix = dock.panels.find((p: any) => p.view.contentComponent === 'depth-matrix');
      const other = dock.panels.find((p: any) => p.view.contentComponent !== 'depth-matrix');
      matrix.api.moveTo({ group: other.api.group }); other.api.setActive();
    });
    await expect(matrix).toBeHidden();
    await page.evaluate(() => (window as any).__terminal.dock.panels.find((p: any) => p.view.contentComponent === 'depth-matrix').api.setActive());
    await expect(matrix).toBeVisible();
    await expect.poll(async () => (await state()).pendingViewport ?? null).toBeNull();
  };
  await switchTab();
  expect((await state()).viewport).toEqual(high.viewport);
  expect(Math.abs((await state()).scrollTop - high.scrollTop)).toBeLessThan(2);
  for (let attempt = 0; attempt < 3; attempt++) {
    await matrix.getByRole('button', { name: 'CENTER', exact: true }).click();
    await expect.poll(async () => (await state()).viewport).toEqual(initial);
    await expect.poll(async () => (await state()).centeringViewport ?? null).toBeNull();
    await switchTab();
    expect((await state()).viewport).toEqual(initial);
    const centeredPrice = await page.evaluate(() => {
      const panel = (window as any).__terminal.dock.panels.find((p: any) => p.view.contentComponent === 'depth-matrix').view.content;
      const scroll = panel.scroll;
      const row = panel.rows[panel.rowLayout.at(scroll.scrollTop + scroll.clientHeight / 2 - 24)];
      return { low: Number(row.low), high: Number(row.high), mid: Number(panel.columns.find((c: any) => c.source === panel.settings.referenceSourceId).mid) };
    });
    expect(centeredPrice.mid).toBeGreaterThanOrEqual(centeredPrice.low);
    expect(centeredPrice.mid).toBeLessThan(centeredPrice.high);
  }
});

test('Depth Matrix restores ordered sources and settings and scrolls a narrow full-width grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel');
  await expect(matrix).toBeVisible();
  await expect(matrix.locator('.depth-matrix-column-head')).toHaveCount(2);
  await expect(matrix.locator('.depth-matrix-column-head small')).toHaveText(['FIXTURE', 'FIXTURE']);
  await expect(matrix.locator('.depth-matrix-price-head')).toHaveText('PRICE');
  await expect(matrix.locator('.depth-matrix-column-head').first()).toHaveAttribute('title', /Book age/);
  const scroll = matrix.locator('.depth-matrix-scroll');
  const firstCanvas = matrix.locator('.depth-matrix-book').first();
  await expect(firstCanvas).toBeVisible();
  const inspectPaint = () => firstCanvas.evaluate(canvas => {
    const bitmap = canvas as HTMLCanvasElement;
    if (!bitmap.width || !bitmap.height) return { bid: 0, ask: 0 };
    const context = bitmap.getContext('2d')!;
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let bid = 0, ask = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 1]! > pixels[index]! * 1.15 && pixels[index + 1]! > pixels[index + 2]! * 1.1 && pixels[index + 3]! > 80) bid++;
      if (pixels[index]! > pixels[index + 1]! * 1.15 && pixels[index]! > pixels[index + 2]! * 1.15 && pixels[index + 3]! > 80) ask++;
    }
    return { bid, ask };
  });
  await expect.poll(async () => { const color = await inspectPaint(); return color.bid > 10 && color.ask > 10; }, { timeout: 5_000 }).toBe(true);
  const paintedSides = await inspectPaint();
  expect(paintedSides.bid).toBeGreaterThan(10);
  expect(paintedSides.ask).toBeGreaterThan(10);
  const scrollBounds = await scroll.boundingBox();
  const firstCanvasBounds = await firstCanvas.boundingBox();
  const mixedPriceRow = matrix.locator('.depth-matrix-price-row[data-price-range^="$83500"]');
  const mixedRowBounds = await mixedPriceRow.boundingBox();
  expect(scrollBounds && firstCanvasBounds && mixedRowBounds).toBeTruthy();
  await page.mouse.move(firstCanvasBounds!.x + 40, mixedRowBounds!.y + mixedRowBounds!.height / 2);
  const tooltip = matrix.locator('.depth-matrix-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('1.25000000 BTC');
  await expect(tooltip).toContainText('2.50000000 BTC');
  await expect(tooltip).toContainText('observed');
  await expect(tooltip).toContainText('USDT');
  const secondCanvas = matrix.locator('.depth-matrix-book').nth(1);
  const secondCanvasBounds = await secondCanvas.boundingBox();
  expect(secondCanvasBounds).toBeTruthy();
  await page.mouse.move(secondCanvasBounds!.x + 40, mixedRowBounds!.y + mixedRowBounds!.height / 2);
  await expect(tooltip).toContainText('2.50000000 BTC');
  await expect(tooltip).toContainText('1.75000000 BTC');
  await matrix.getByRole('button', { name: 'Depth Matrix settings' }).click();
  const settings = matrix.locator('.depth-matrix-settings');
  await expect(settings.locator('[aria-label="Bucket width preset"]')).toBeVisible();
  await expect(settings.locator('[aria-label="Venue column width"]')).toHaveValue('95');
  await expect(settings.locator('[aria-label="Depth source"] option:disabled')).toHaveCount(3);
  await settings.getByLabel('Liquidity display unit').selectOption('usdt');
  await expect(firstCanvas).toHaveAttribute('aria-label', /bar widths use BTC; cell labels use USDT/);
  await settings.getByLabel('Liquidity display unit').selectOption('btc');

  await settings.getByLabel('Bucket width in USDT').fill('5000');
  await settings.getByLabel('Bucket width in USDT').press('Tab');
  await settings.getByLabel('Histogram scale').selectOption('shared');
  await settings.getByLabel('Wall threshold mode').selectOption('off');
  await settings.getByLabel('Venue column width').evaluate(element => {
    const input = element as HTMLInputElement; input.value = '150'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settings.locator('.depth-matrix-source-setting').nth(1).locator('button[title="Move column left"]').click();
  await expect.poll(() => settings.locator('.depth-matrix-source-setting').first().innerText()).toContain('USD-M');

  await page.setViewportSize({ width: 720, height: 860 });
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = 0; });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.waitForTimeout(350);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('basis.layout.v1') ?? 'null'));
  expect(saved.version).toBe(6);
  const params = Object.values(saved.layout.panels).find((panel: any) => panel.contentComponent === 'depth-matrix') as any;
  expect(params.params).toMatchObject({ sources: ['binance-perpetual', 'binance-spot'], bucketWidth: '5000', columnWidth: 150, scale: 'shared', wallMode: 'off' });
  params.params.sources = ['binance-perpetual', 'binance-spot', 'bybit-spot', 'bybit-perpetual', 'hyperliquid-perpetual'];
  await page.evaluate(value => localStorage.setItem('basis.layout.v1', JSON.stringify(value)), saved);

  await page.reload();
  const restored = page.locator('.depth-matrix-panel');
  await expect(restored).toBeVisible();
  await expect(restored.locator('.depth-matrix-column-head')).toHaveCount(5);
  await expect(restored.locator('.depth-matrix-column-head[data-state="unavailable"]')).toHaveCount(3);
  await expect(restored.locator('.depth-matrix-price-axis')).toHaveCount(1);
  const restoredScroll = restored.locator('.depth-matrix-scroll');
  await restoredScroll.evaluate(element => { element.scrollLeft = Math.min(300, element.scrollWidth - element.clientWidth); });
  const rowHeight = await restored.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--depth-matrix-row-height')));
  const hoveredAxisIndex = await page.evaluate(() => { const p = (window as any).__terminal.dock.panels.find((p: any) => p.view.contentComponent === 'depth-matrix').view.content; return p.rowLayout.at(p.scroll.scrollTop + p.scroll.clientHeight / 2 - 24); });
  const unavailableCanvas = restored.locator('.depth-matrix-book').nth(2);
  const unavailableBounds = await unavailableCanvas.boundingBox();
  const unavailableRow = restored.locator('.depth-matrix-price-row').nth(hoveredAxisIndex);
  const unavailableRowBounds = await unavailableRow.boundingBox();
  expect(unavailableBounds && unavailableRowBounds).toBeTruthy();
  await expect.poll(() => restoredScroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await unavailableCanvas.dispatchEvent('pointermove', {
    clientX: unavailableBounds!.x + unavailableBounds!.width / 2,
    clientY: unavailableRowBounds!.y + unavailableRowBounds!.height / 2,
  });
  await expect(restored.locator('.depth-matrix-tooltip')).toContainText('No synchronized row data');
  await expect(restored.locator('.depth-matrix-tooltip')).not.toContainText('1.25000000 BTC');
  await expect.poll(() => restoredScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await restoredScroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => restoredScroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await restored.getByRole('button', { name: 'Depth Matrix settings' }).click();
  await expect(restored.getByLabel('Bucket width in USDT')).toHaveValue('5000');
  await expect(restored.getByLabel('Venue column width')).toHaveValue('150');
  await expect(restored.getByLabel('Histogram scale')).toHaveValue('shared');
  await expect(restored.getByLabel('Wall threshold mode')).toHaveValue('off');
  await expect(restored.locator('.depth-matrix-source-setting').first()).toContainText('USD-M');
  for (let remaining = 5; remaining > 0; remaining--) {
    await restored.locator('.depth-matrix-source-setting').first().locator('button[title="Remove source"]').click();
  }
  await expect(restored.locator('.depth-matrix-column-head')).toHaveCount(0);
  await expect(restored.locator('.depth-matrix-status')).toContainText('Choose reference');
  await restored.getByLabel('Depth source').selectOption('binance-spot');
  await restored.getByRole('button', { name: 'ADD', exact: true }).click();
  await expect(restored.locator('.depth-matrix-column-head')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Depth Matrix marks unobserved far-side rows as unknown while keeping known empty and observed depth distinct', async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__depthMatrixLabels = [];
    (window as any).__captureDepthMatrixLabels = false;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if ((window as any).__captureDepthMatrixLabels && this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains('depth-matrix-book')) {
        (window as any).__depthMatrixLabels.push({ source: this.canvas.dataset.source, text: String(text), y });
      }
      return maxWidth === undefined ? original.call(this, text, x, y) : original.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel');
  await expect(matrix.locator('.depth-matrix-column-head small')).toHaveText(['FIXTURE', 'FIXTURE']);
  const scroll = matrix.locator('.depth-matrix-scroll');
  const rowHeight = await matrix.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--depth-matrix-row-height')));
  const spotCanvas = matrix.locator('.depth-matrix-book').first();
  const perpCanvas = matrix.locator('.depth-matrix-book').nth(1);
  const nearRow = matrix.locator('.depth-matrix-price-row[data-price-range^="$83500"]');
  const nearCanvasBounds = await spotCanvas.boundingBox(), nearRowBounds = await nearRow.boundingBox();
  expect(nearCanvasBounds && nearRowBounds).toBeTruthy();
  await page.mouse.move(nearCanvasBounds!.x + nearCanvasBounds!.width / 2, nearRowBounds!.y + nearRowBounds!.height / 2);
  const tooltip = matrix.locator('.depth-matrix-tooltip');
  await expect(tooltip).toContainText('1.25000000 BTC');
  await expect(tooltip).toContainText('2.50000000 BTC');
  await expect(tooltip).toContainText('observed');
  await scroll.evaluate((element, height) => { element.scrollTop = 24 + 8 * height; }, rowHeight);
  await page.evaluate(() => {
    (window as any).__depthMatrixLabels.length = 0;
    (window as any).__captureDepthMatrixLabels = true;
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__depthMatrixLabels.some((item: any) => item.source === 'binance-perpetual' && item.text === '—'))).toBe(true);
  const farLabels = await page.evaluate(() => (window as any).__depthMatrixLabels.filter((item: any) => item.source === 'binance-perpetual').map((item: any) => item.text));
  expect(farLabels).toContain('—');
  expect(farLabels).not.toContain('0');
  expect(farLabels).not.toContain('?');
  const row = matrix.locator('.depth-matrix-price-row[data-price-range^="$90600"]');
  const rowIndex = Number(await row.getAttribute('data-row-index'));
  expect(Number.isInteger(rowIndex)).toBe(true);
  await perpCanvas.evaluate((canvas, { rowIndex: index, rowHeight: height }) => {
    const bounds = canvas.getBoundingClientRect();
    const row = document.querySelectorAll('.depth-matrix-price-row')[index]!.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: row.top + row.height / 2 }));
  }, { rowIndex, rowHeight });
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('known empty');
  await expect(tooltip).toContainText('Not observed');
  await page.screenshot({ path: '/tmp/iqterminal-depth-matrix-unknown-far.png' });
});

test('Depth Matrix keeps partial measured labels legible without coverage markers in both themes', async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const originalFill = prototype.fillText, originalStroke = prototype.strokeText;
    (window as any).__depthMatrixText = [];
    (window as any).__captureDepthMatrixText = false;
    const record = function(this: CanvasRenderingContext2D, kind: string, text: string, x: number, y: number, maxWidth?: number) {
      if (!(window as any).__captureDepthMatrixText || !(this.canvas instanceof HTMLCanvasElement) || !this.canvas.classList.contains('depth-matrix-book')) return;
      const measuredWidth = this.measureText(String(text)).width;
      (window as any).__depthMatrixText.push({ kind, source: this.canvas.dataset.source, text: String(text), x, y,
        width: typeof maxWidth === 'number' ? Math.min(measuredWidth, maxWidth) : measuredWidth, font: this.font,
        fillStyle: String(this.fillStyle), strokeStyle: String(this.strokeStyle), lineWidth: this.lineWidth, textAlign: this.textAlign });
    };
    prototype.fillText = function(text, x, y, maxWidth) {
      record.call(this, 'fill', String(text), x, y, maxWidth);
      return maxWidth === undefined ? originalFill.call(this, text, x, y) : originalFill.call(this, text, x, y, maxWidth);
    };
    prototype.strokeText = function(text, x, y, maxWidth) {
      record.call(this, 'stroke', String(text), x, y, maxWidth);
      return maxWidth === undefined ? originalStroke.call(this, text, x, y) : originalStroke.call(this, text, x, y, maxWidth);
    };
  });
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel');
  await expect(matrix.locator('.depth-matrix-column-head small')).toHaveText(['FIXTURE', 'FIXTURE']);
  const rowHeight = await matrix.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--depth-matrix-row-height')));
  const canvas = matrix.locator('.depth-matrix-book').nth(1);
  const readPartialLabel = async (low: '83300' | '83700') => {
    const expectedLabel = low === '83300' ? '3.75' : '<0.001';
    const row = matrix.locator(`.depth-matrix-price-row[data-price-range^="$${low}"]`);
    await row.scrollIntoViewIfNeeded();
    const rowIndex = Number(await row.getAttribute('data-row-index'));
    expect(Number.isInteger(rowIndex)).toBe(true);
    await canvas.evaluate((element, { rowIndex: index, rowHeight: height }) => {
      const bounds = element.getBoundingClientRect();
      const row = document.querySelectorAll('.depth-matrix-price-row')[index]!.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: row.top + row.height / 2 }));
    }, { rowIndex, rowHeight });
    await expect(matrix.locator('.depth-matrix-tooltip')).toContainText('partial');
    await page.evaluate(() => {
      (window as any).__depthMatrixText.length = 0;
      (window as any).__captureDepthMatrixText = true;
      window.dispatchEvent(new Event('resize'));
    });
    const targetY = await row.evaluate(element => { const r=element.getBoundingClientRect(), c=document.querySelector('.depth-matrix-book')!.getBoundingClientRect(); return r.top-c.top+r.height/2; });
    await expect.poll(() => page.evaluate(({ y, label }) => (window as any).__depthMatrixText.some((item: any) => item.kind === 'fill'
      && item.source === 'binance-perpetual' && item.text === label && item.y === y), { y: targetY, label: expectedLabel })).toBe(true);
    const result = await page.evaluate(({ y, label }) => {
      const values = (window as any).__depthMatrixText.filter((item: any) => item.source === 'binance-perpetual' && item.y === y);
      const amount = values.find((item: any) => item.kind === 'fill' && item.text === label);
      const outline = values.find((item: any) => item.kind === 'stroke' && item.text === label);
      const marker = values.find((item: any) => item.kind === 'fill' && /^(A|B)[0?]$/.test(item.text));
      return { amount, outline, marker, expectedText: getComputedStyle(document.querySelector('.depth-matrix-panel')!).getPropertyValue('--text').trim(),
        expectedHalo: getComputedStyle(document.querySelector('.depth-matrix-panel')!).getPropertyValue('--chart').trim() };
    }, { y: targetY, label: expectedLabel });
    expect(result.amount).toBeTruthy();
    expect(result.amount.fillStyle).toBe(result.expectedText);
    expect(result.amount.font).toContain('11px');
    expect(result.outline).toBeUndefined();
    expect(result.marker).toBeFalsy();
    return result;
  };

  for (const theme of ['dark', 'light'] as const) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await expect.poll(() => matrix.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim()))
      .toBe(theme === 'light' ? '#f6f4ee' : '#090909');
    const bid = await readPartialLabel('83300');
    expect(bid.amount.fillStyle).toBe(theme === 'light' ? '#202934' : '#c7c7c7');
    const ask = await readPartialLabel('83700');
    expect(ask.amount.fillStyle).toBe(theme === 'light' ? '#202934' : '#c7c7c7');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `/tmp/depth-matrix-label-${theme}-dpr1.png` });
  }

  await matrix.getByRole('button', { name: 'Depth Matrix settings' }).click();
  await matrix.getByLabel('Venue column width').evaluate(element => {
    const input = element as HTMLInputElement; input.value = '65'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await matrix.getByRole('button', { name: 'Depth Matrix settings' }).click();
  await readPartialLabel('83300');
  await readPartialLabel('83700');
});

test('Depth Matrix tracks the rounded reference mid beside readable mixed venue rows', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__depthMatrixCellLabels = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains('depth-matrix-book')) {
        (window as any).__depthMatrixCellLabels.push({ source: this.canvas.dataset.source, text: String(text), y });
      }
      return maxWidth === undefined ? originalFillText.call(this, text, x, y) : originalFillText.call(this, text, x, y, maxWidth);
    };
    class PriceOverrideWorker extends NativeWorker {
      set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = handler && (event => {
          if ((event.data as any)?.type === 'depth-matrix-batch') {
            const data = event.data as any, override = (window as any).__depthMatrixMidOverride;
            const changed = { ...data, columns: data.columns.map((column: any) => {
              const isPerpetual = column.source === 'binance-perpetual';
              const bidQuantity = isPerpetual ? 33.913 : 32.803453, askQuantity = isPerpetual ? 380.45 : 65.83664;
              return { ...column, mid: override && column.mid !== null ? override : column.mid,
                rows: column.rows.map((row: any) => row.low === '83500' ? { ...row, bidQuantity, askQuantity,
                  bidNotional: bidQuantity * Number(row.low), askNotional: askQuantity * Number(row.low) } : row) };
            }) };
            handler.call(this, new MessageEvent('message', { data: changed }));
          } else handler.call(this, event);
        });
      }
      get onmessage() { return super.onmessage; }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: PriceOverrideWorker });
  });
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel'), axis = matrix.locator('.depth-matrix-price-axis');
  const current = axis.locator('.depth-matrix-price-row[data-current="true"]');
  await expect(current).toHaveText('83,500');
  await expect(matrix.locator('.depth-matrix-status')).toContainText('SPOT MID 83,550');
  await expect.poll(() => page.evaluate(() => ['32.8', '65.8', '33.9', '380'].every(text =>
    (window as any).__depthMatrixCellLabels.some((cell: any) => cell.text === text)))).toBe(true);
  const mixedBandCenters = await page.evaluate(() => {
    const labels = (window as any).__depthMatrixCellLabels as Array<{source:string;text:string;y:number}>;
    const last = (source:string,text:string) => [...labels].reverse().find(cell => cell.source === source && cell.text === text)!.y;
    return [['binance-spot','32.8','65.8'],['binance-perpetual','33.9','380']].map(([source,bid,ask]) => last(source!,bid!) - last(source!,ask!));
  });
  expect(mixedBandCenters).toEqual([17,17]);
  for (const theme of ['dark','light'] as const) {
    await page.getByLabel('Theme', {exact:true}).selectOption(theme);
    await expect.poll(() => matrix.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim())).toBe(theme === 'dark' ? '#090909' : '#f6f4ee');
    await matrix.screenshot({path: `/tmp/depth-matrix-mixed-labels-${theme}-dpr1.png`});
  }
  await matrix.getByRole('button', {name:'Depth Matrix settings'}).click();
  await matrix.getByLabel('Venue column width').evaluate(element => { const input=element as HTMLInputElement; input.value='65'; input.dispatchEvent(new Event('input',{bubbles:true})); });
  await matrix.getByRole('button', {name:'Depth Matrix settings'}).click();
  for (const theme of ['dark','light'] as const) {
    await page.getByLabel('Theme', {exact:true}).selectOption(theme);
    await expect.poll(() => matrix.evaluate(element => getComputedStyle(element).getPropertyValue('--chart').trim())).toBe(theme === 'dark' ? '#090909' : '#f6f4ee');
    await matrix.screenshot({path: `/tmp/depth-matrix-mixed-labels-${theme}-65.png`});
  }
  await expect(current).toHaveText('83,500');
  const toolbar = await matrix.locator('.depth-matrix-toolbar').evaluate(element => ({width:element.clientWidth,scroll:element.scrollWidth}));
  expect(toolbar.scroll).toBeLessThanOrEqual(toolbar.width);

});

test('Depth Matrix keeps visible rows painted through themes, DPR 2, resizing, scrolling, and recentering', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const matrix = page.locator('.depth-matrix-panel');
  const scroll = matrix.locator('.depth-matrix-scroll');
  const canvas = matrix.locator('.depth-matrix-book').first();
  await expect(matrix.locator('.depth-matrix-column-head small')).toHaveText(['FIXTURE', 'FIXTURE']);
  await expect(canvas).toBeVisible();
  const visibleColors = () => canvas.evaluate(element => {
    const bitmap = element as HTMLCanvasElement;
    const scroller = bitmap.closest('.depth-matrix-scroll')!;
    const rect = bitmap.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const top = Math.max(0, Math.floor((viewport.top - rect.top) * dpr));
    const bottom = Math.min(bitmap.height, Math.ceil((viewport.bottom - rect.top) * dpr));
    if (bottom <= top) return { bid: 0, ask: 0 };
    const pixels = bitmap.getContext('2d')!.getImageData(0, top, bitmap.width, bottom - top).data;
    let bid = 0, ask = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!, a = pixels[index + 3]!;
      if (g > r * 1.15 && g > b * 1.08 && a > 80) bid++;
      if (r > g * 1.05 && r > b * 1.15 && a > 80) ask++;
    }
    return { bid, ask };
  });
  await expect.poll(async () => { const colors = await visibleColors(); return colors.bid > 10 && colors.ask > 10; }).toBe(true);
  const dimensions = await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, cssWidth: element.clientWidth, dpr: window.devicePixelRatio }));
  expect(dimensions.dpr).toBe(2);
  expect(dimensions.width).toBeGreaterThanOrEqual(dimensions.cssWidth * 2);

  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect.poll(async () => { const colors = await visibleColors(); return colors.bid > 10 && colors.ask > 10; }).toBe(true);
  await page.screenshot({ path: '/tmp/depth-matrix-fixture-light-dpr2.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect.poll(async () => { const colors = await visibleColors(); return colors.bid > 10 && colors.ask > 10; }).toBe(true);

  const rowHeight = await matrix.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--depth-matrix-row-height')));
  const scrollTopBefore = await scroll.evaluate(element => element.scrollTop);
  await scroll.evaluate((element, height) => { element.scrollTop += 2 * height; }, rowHeight);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollTopBefore);
  await expect.poll(async () => { const colors = await visibleColors(); return colors.bid > 10 && colors.ask > 10; }).toBe(true);
  const populatedRow = matrix.locator('.depth-matrix-price-row[data-price-range^="$83500"]');
  const rowIndex = Number(await populatedRow.getAttribute('data-row-index'));
  const alignment = await page.evaluate(({ index, height }) => {
    const row = document.querySelector('.depth-matrix-price-row[data-price-range^="$83500"]')!;
    const canvas = document.querySelector('.depth-matrix-book')!;
    const scroll = document.querySelector('.depth-matrix-scroll')!;
    const rowRect = row.getBoundingClientRect(), canvasRect = canvas.getBoundingClientRect(), scrollRect = scroll.getBoundingClientRect();
    return { delta: rowRect.top - (canvasRect.top + (window as any).__terminal.dock.panels.find((p:any) => p.view.contentComponent === 'depth-matrix').view.content.rowLayout.positions[index].top), centerY: rowRect.top + rowRect.height / 2,
      viewportTop: scrollRect.top, viewportBottom: scrollRect.bottom, canvasLeft: canvasRect.left, canvasWidth: canvasRect.width };
  }, { index: rowIndex, height: rowHeight });
  expect(Number.isInteger(rowIndex)).toBe(true);
  expect(Math.abs(alignment.delta)).toBeLessThanOrEqual(1);
  expect(alignment.centerY).toBeGreaterThan(alignment.viewportTop);
  expect(alignment.centerY).toBeLessThan(alignment.viewportBottom);
  await matrix.locator('.depth-matrix-book').first().dispatchEvent('pointermove', {
    clientX: alignment.canvasLeft + alignment.canvasWidth / 2, clientY: alignment.centerY,
  });
  await expect(matrix.locator('.depth-matrix-tooltip')).toContainText('1.25000000 BTC');
  await expect(matrix.locator('.depth-matrix-tooltip')).toContainText('2.50000000 BTC');
  await page.setViewportSize({ width: 760, height: 860 });
  await matrix.getByRole('button', { name: 'CENTER' }).click();
  await expect.poll(async () => { const colors = await visibleColors(); return colors.bid > 10 && colors.ask > 10; }).toBe(true);
  await page.screenshot({ path: '/tmp/depth-matrix-fixture-dark-dpr2.png' });
  expect(errors).toEqual([]);
  await context.close();
});

test('Depth Matrix shows an explanation when no synchronized rows are available', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class EmptyMatrixWorker extends NativeWorker {
      set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        const worker = this;
        super.onmessage = handler && function(event) {
          if (event.data?.type === 'depth-matrix-batch') {
            const data = { ...event.data, columns: event.data.columns.map((column: any) => ({ ...column, rows: [], state: 'stale', message: 'Depth stream disconnected' })) };
            handler.call(worker, new MessageEvent('message', { data })); return;
          }
          handler.call(worker, event);
        };
      }
      get onmessage() { return super.onmessage; }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: EmptyMatrixWorker });
  });
  await page.goto('/?fixture=1');
  await page.getByRole('button', { name: 'Depth Matrix', exact: true }).click();
  const message = page.locator('.depth-matrix-empty-state');
  await expect(message).toBeVisible();
  await expect(message).toContainText('Depth stream disconnected');
  await expect(message).toContainText('RETRY');
  await page.screenshot({ path: '/tmp/depth-matrix-empty-state.png' });
});

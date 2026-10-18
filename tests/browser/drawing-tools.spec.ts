import { test, expect, type Page, type Locator } from '@playwright/test';
import { addIndicator, chooseChartMarket } from './indicator-actions';
import { installDepthFixture } from './depth-fixture';

type TestDrawing = { id: string; tool: string; paneIndex: number; points?: unknown[]; style?: Record<string, any>; text?: { value: string; [key: string]: unknown }; props?: Record<string, any>; intervals?: { from?: string; to?: string }; visible?: boolean; locked?: boolean };
type DrawingState = { drawings: TestDrawing[]; selected: string | null; canUndo: boolean; canRedo: boolean; interval: string | null; hidden: string[]; objects: Array<{ id: string; sourceId: string; kind: string; name: string; paneIndex: number; capabilities: { remove: boolean; visibility: boolean; lock: boolean; settings: boolean } }> };

async function drawingState(page: Page, panel: Locator): Promise<DrawingState> {
  const id = await panel.getAttribute('data-panel-id');
  if (!id) throw new Error('Candle panel id is missing');
  return page.evaluate((panelId): DrawingState => {
    const view = (window as any).__terminal.panels.get(panelId);
    const draw = view.engine.drawings;
    return {
      drawings: draw.drawings().map((item: TestDrawing) => structuredClone(item)),
      selected: draw.selected(), canUndo: draw.canUndo(), canRedo: draw.canRedo(),
      interval: draw.interval(), hidden: [...draw.hiddenOnInterval()],
      objects: view.engine.objects.list().map((item: any) => ({ id: item.id, sourceId: item.sourceId, kind: item.kind, name: item.name, paneIndex: item.paneIndex, capabilities: item.capabilities })),
    };
  }, id);
}

async function useDarkTheme(page: Page) {
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

async function watchCanvasText(page: Page) {
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const nativeFillText = prototype.fillText;
    Object.defineProperty(prototype, 'fillText', {
      configurable: true,
      value: function (text: string, ...args: unknown[]) {
        const value = String(text);
        const watched = (window as any).__watchCanvasTextValues as string[] | undefined;
        const result = Reflect.apply(nativeFillText, this, [text, ...args]);
        if (watched?.includes(value)) {
          const seen = ((window as any).__seenCanvasTextValues ??= []) as string[];
          seen.push(value);
          if (seen.length > 100) seen.shift();
          const x = Number(args[0]);
          const y = Number(args[1]);
          const metrics = this.measureText(value);
          const transform = this.getTransform();
          const pixelX = Math.floor(x * transform.a + transform.e - 2);
          const pixelY = Math.floor(y * transform.d + transform.f - 12);
          const scanWidth = Math.max(1, Math.min(this.canvas.width - pixelX, Math.ceil(metrics.width + 8)));
          const scanHeight = Math.max(1, Math.min(this.canvas.height - pixelY, 24));
          let colorPixels = 0;
          let foregroundPixels = 0;
          let nonBackgroundPixels = 0;
          const colorMatch = /^#([\da-f]{6})$/i.exec(String(this.fillStyle));
          const foreground = colorMatch ? [0, 2, 4].map(index => Number.parseInt(colorMatch[1]!.slice(index, index + 2), 16)) : null;
          try {
            const pixels = this.getImageData(pixelX, pixelY, scanWidth, scanHeight).data;
            for (let i = 0; i < pixels.length; i += 4) {
              const [r, g, b, a] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
              if (a > 0 && g > r * 1.15 && g > b * 0.8 && g > 20) colorPixels++;
              if (foreground && a > 0 && Math.abs(r - foreground[0]!) < 45 && Math.abs(g - foreground[1]!) < 45 && Math.abs(b - foreground[2]!) < 45) foregroundPixels++;
              if (a > 0 && (r > 30 || g > 30 || b > 30)) nonBackgroundPixels++;
            }
          } catch { /* Keep the canvas instrumentation diagnostic-only if the browser rejects readback. */ }
          const records = ((window as any).__canvasTextPixels ??= []) as Array<Record<string, unknown>>;
          records.push({ value, x, y, width: metrics.width, font: this.font, color: this.fillStyle,
            canvas: [this.canvas.width, this.canvas.height], transform: [transform.a, transform.d, transform.e, transform.f],
            scan: [pixelX, pixelY, scanWidth, scanHeight], colorPixels, foregroundPixels, nonBackgroundPixels });
          if (records.length > 100) records.shift();
        }
        return result;
      },
    });
  });
}

async function drawingStorageKey(page: Page, panel: Locator) {
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  return page.evaluate(id => {
    const series = (window as any).__terminal.panels.get(id).diagnostics().series;
    const symbol = series.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT';
    return `iqterminal:drawings:${encodeURIComponent(id)}:${encodeURIComponent(`${series.venue}:${series.market}`)}:${encodeURIComponent(symbol)}`;
  }, panelId);
}

async function placeHorizontalLine(page: Page, panel: Locator, offset = 0) {
  await panel.getByLabel('Drawing tool', { exact: true }).selectOption('horizontal-line');
  const id = await panel.getAttribute('data-panel-id');
  if (!id) throw new Error('Candle panel id is missing');
  const point = await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    const plot = view.engine.chart.plotRect(0);
    return { x: Math.round(plot.left + plot.width * .45), y: Math.round(plot.top + plot.height * .48) };
  }, id);
  const stage = panel.locator('.chart-stage');
  const storageKey = await drawingStorageKey(page, panel);
  const beforePreview = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await stage.hover({ position: { x: point.x + offset, y: point.y + offset } });
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(beforePreview);
  await stage.click({ position: { x: point.x + offset, y: point.y + offset } });
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBeGreaterThan(0);
}

test('native drawing placement, IQ settings, templates and instrument scope use one-step history', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  let mainNavigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) mainNavigations++; });
  page.on('pageerror', error => errors.push(error.message));
  await watchCanvasText(page);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await useDarkTheme(page);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const tool = panel.getByLabel('Drawing tool', { exact: true });
  await expect.poll(() => tool.locator('option').count()).toBe(9);
  expect(await tool.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([
    '', 'trend-line', 'horizontal-line', 'horizontal-ray', 'rectangle', 'fib-retracement', 'long-position', 'short-position', 'text',
  ]);

  await placeHorizontalLine(page, panel);
  let state = await drawingState(page, panel);
  expect(state.drawings).toHaveLength(1);
  const originalId = state.drawings[0]!.id;
  expect(state.drawings[0]!.props).toMatchObject({ iqterminal: { version: 1 }, iqterminalLabelState: 'unset', iqterminalLabel: '', iqterminalAnalysisInterval: '1m' });
  expect(state.canUndo).toBe(true);

  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(0);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(1);
  state = await drawingState(page, panel);
  expect(state.drawings[0]).toMatchObject({ id: originalId, props: { iqterminal: { version: 1 }, iqterminalLabelState: 'unset', iqterminalAnalysisInterval: '1m' } });
  expect(state.canUndo).toBe(true);

  // The Objects tree names the instrument, interval and focused Dockview panel.
  const objectsPanel = panel.locator('.chart-objects-panel');
  await panel.locator('.chart-objects-panel>summary').click();
  await expect(objectsPanel.locator('summary')).toContainText('BTCUSDT');
  await expect(objectsPanel.locator('summary')).toContainText('1m');
  await expect(objectsPanel.locator('summary')).toContainText(panelId);
  const paneSnapshot = await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    const objects = view.engine.objects.list();
    const indexes = Array.from(new Set<number>(objects.map((item: any) => Number(item.paneIndex)))).sort((a, b) => a - b);
    return { primary: view.engine.objects.primaryPaneIndex() as number, indexes, objects: objects.map((item: any) => ({ id: item.id as string, paneIndex: item.paneIndex as number })) };
  }, panelId);
  await expect(objectsPanel.locator('.chart-object-pane')).toHaveCount(paneSnapshot.indexes.length);
  for (const paneIndex of paneSnapshot.indexes) {
    const section = objectsPanel.locator(`.chart-object-pane[data-object-pane-index="${paneIndex}"]`);
    await expect(section.locator('.chart-object-pane-heading')).toHaveText(paneIndex === paneSnapshot.primary ? `Main pane · Pane ${paneIndex + 1}` : `Pane ${paneIndex + 1}`);
    expect(await section.locator('.chart-object-row').evaluateAll((rows, index) => rows.every(row => row.getAttribute('data-object-pane-index') === String(index)), paneIndex)).toBe(true);
    expect(await section.locator('.chart-object-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-object-id')))).toEqual(paneSnapshot.objects.filter((item: { paneIndex: number; id: string }) => item.paneIndex === paneIndex).map((item: { paneIndex: number; id: string }) => item.id));
  }
  const sourceObject = (await drawingState(page, panel)).objects.find(object => object.kind === 'source');
  expect(sourceObject).toBeDefined();
  if (!sourceObject) throw new Error('The primary price source is missing from Objects');
  expect(sourceObject.paneIndex).toBe(paneSnapshot.primary);
  const sourceRow = objectsPanel.locator(`.chart-object-row[data-object-id="${sourceObject.id}"]`);
  await expect(sourceRow.locator('[data-object-action="remove"]')).toHaveCount(0);
  const drawingRow = panel.locator('.chart-object-row.kind-drawing').last();
  await expect(drawingRow).toBeVisible();
  await drawingRow.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(drawingRow.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
  const showButton = drawingRow.getByRole('button', { name: 'Show', exact: true });
  const showBox = await showButton.boundingBox();
  if (!showBox) throw new Error('Show drawing button is not laid out');
  await page.mouse.move(showBox.x + showBox.width / 2, showBox.y + showBox.height / 2);
  await page.mouse.down();
  const stableTarget = await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    const row = view.element.querySelector(`.chart-object-row[data-object-id="drawing:${drawingId}"]`)!;
    const button = row.querySelector('button[data-object-action="visible"]') as HTMLButtonElement;
    (window as any).__showActionCount = 0;
    const action = view.drawingObjectAction.bind(view);
    view.drawingObjectAction = (event: Event) => {
      const clicked = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-object-action]');
      if (clicked?.dataset.objectAction === 'visible' && clicked.textContent === 'Show') (window as any).__showActionCount++;
      return action(event);
    };
    (window as any).__showButton = button;
    view.engine.objects.select(`drawing:${drawingId}`);
    return { connected: button.isConnected, selected: view.engine.objects.get(`drawing:${drawingId}`)?.selected };
  }, { panelId, drawingId: originalId });
  expect(stableTarget).toEqual({ connected: true, selected: true });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__showActionCount)).toBe(1);
  await expect.poll(async () => (await drawingState(page, panel)).drawings[0]?.visible).not.toBe(false);
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(1);
  await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).engine.objects.select(null), panelId);
  await drawingRow.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(drawingRow.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  expect((await drawingState(page, panel)).drawings[0]?.locked).toBe(true);
  await drawingRow.getByRole('button', { name: 'Unlock', exact: true }).click();
  await drawingRow.getByRole('button', { name: 'Style', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await expect(settings.locator('[data-setting-path="props.iqterminalLabelState"]')).toBeVisible();
  await settings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('custom');
  await settings.locator('[data-setting-path="props.iqterminalLabel"]').fill('4H Support');
  await settings.locator('[data-setting-path="props.iqterminalAnalysisInterval"]').selectOption('4h');
  await settings.locator('[data-setting-path="intervals.from"]').selectOption('1m');
  await settings.locator('[data-setting-path="intervals.to"]').selectOption('15m');
  const lineColor = settings.locator('[data-setting-path="style.color"]');
  await lineColor.evaluate((element: HTMLInputElement) => { element.value = '#26a69a'; });
  await settings.locator('[data-setting-path="style.lineStyle"]').selectOption('dashed');
  await page.evaluate(() => { (window as any).__watchCanvasTextValues = ['4H Support']; });
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings[0]?.props?.iqterminalLabel).toBe('4H Support');
  await expect.poll(() => page.evaluate(() => (window as any).__seenCanvasTextValues?.includes('4H Support') ?? false)).toBe(true);
  await expect.poll(async () => (await drawingState(page, panel)).drawings[0]?.visible).toBe(true);
  await drawingRow.getByRole('button', { name: 'Style', exact: true }).click();
  const supportSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await expect(supportSettings.locator('[data-setting-path="props.iqterminalAnalysisInterval"]')).toHaveValue('4h');
  await expect(supportSettings.locator('[data-setting-path="style.lineStyle"]')).toHaveValue('dashed');
  await expect(supportSettings.locator('[data-setting-path="style.color"]')).toHaveValue('#26a69a');
  await expect(drawingRow.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/drawing-4h-support-properties-1366x768.png' });
  await supportSettings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: 'artifacts/drawing-label-visible-1366x768.png' });
  const labelPixels = await page.evaluate(() => (window as any).__canvasTextPixels?.filter((entry: any) => entry.value === '4H Support') ?? []);
  console.log('Canvas label pixel records:', JSON.stringify(labelPixels.slice(-3)));
  expect(labelPixels.some((entry: any) => entry.color === '#26a69a' && entry.foregroundPixels >= 4)).toBe(true);
  await drawingRow.getByRole('button', { name: 'Style', exact: true }).click();
  const labelColorSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await labelColorSettings.locator('[data-setting-path="text.color"]').evaluate((element: HTMLInputElement) => {
    element.value = '#f5f5f5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await labelColorSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings[0]?.props?.iqterminalLabelTextColorExplicit).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__canvasTextPixels?.some((entry: any) => entry.value === '4H Support' && entry.color === '#f5f5f5' && entry.foregroundPixels >= 4) ?? false)).toBe(true);
  await page.screenshot({ path: 'artifacts/drawing-label-explicit-color-1366x768.png' });

  await tool.selectOption('');
  const drag = await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    const chart = view.engine.chart;
    const drawing = view.engine.drawings.get(drawingId);
    const paneIndex = drawing.paneIndex;
    const point = drawing.points[0];
    const plot = chart.plotRect(paneIndex);
    const stage = view.element.querySelector('.chart-stage').getBoundingClientRect();
    const y = chart.priceToCoordinate(point.price, paneIndex);
    if (!plot || y === null) throw new Error('Could not locate the drawing inside its pane');
    const targetY = Math.max(plot.top + 12, Math.min(plot.top + plot.height - 12, y - 36));
    return {
      startX: stage.left + plot.left + plot.width * .55,
      startY: stage.top + y,
      targetX: stage.left + plot.left + plot.width * .55,
      targetY: stage.top + targetY,
      price: point.price,
      visibleRange: view.engine.visibleRange(),
      priceRange: chart.panes()[paneIndex].priceScale.priceRange(),
    };
  }, { panelId, drawingId: originalId });
  await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.drawings.select(drawingId), { panelId, drawingId: originalId });
  await page.mouse.move(drag.startX, drag.startY);
  await page.mouse.down();
  await page.mouse.move(drag.targetX, drag.targetY, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => ((await drawingState(page, panel)).drawings.find(item => item.id === originalId)?.points?.[0] as any)?.price).not.toBe(drag.price);
  const afterDrag = await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    return { visibleRange: view.engine.visibleRange(), priceRange: view.engine.chart.panes()[0].priceScale.priceRange() };
  }, panelId);
  expect(afterDrag.visibleRange).toEqual(drag.visibleRange);
  expect(afterDrag.priceRange).toEqual(drag.priceRange);

  const beforeNudge = await page.evaluate(({ panelId, drawingId }) => {
    const drawing = (window as any).__terminal.panels.get(panelId).engine.drawings.get(drawingId);
    return structuredClone(drawing.points);
  }, { panelId, drawingId: originalId });
  await page.evaluate(({ panelId, drawingId }) => {
    (window as any).__terminal.panels.get(panelId).engine.drawings.nudge([drawingId], 12, -8);
  }, { panelId, drawingId: originalId });
  const moved = (await drawingState(page, panel)).drawings.find(item => item.id === originalId)?.points;
  expect(moved).not.toEqual(beforeNudge);
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === originalId)?.points).toEqual(beforeNudge);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === originalId)?.points).toEqual(moved);

  expect((await drawingState(page, panel)).drawings.find(item => item.id === originalId)).toMatchObject({
    props: { iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h' },
    intervals: { from: '1m', to: '15m' }, style: { color: '#26a69a', lineStyle: 'dashed' },
  });
  const originalObjectId = await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.objects.list().find((item: any) => item.sourceId === drawingId)?.id, { panelId, drawingId: originalId });
  await panel.locator(`[data-object-id="${originalObjectId}"] [data-object-action="duplicate"]`).click();
  const duplicateId = await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).engine.drawings.selection()[0] as string | undefined, panelId);
  expect(duplicateId).toBeTruthy();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(2);
  expect((await drawingState(page, panel)).drawings.find(item => item.id === duplicateId)).toMatchObject({
    tool: 'horizontal-line', style: { color: '#26a69a', lineStyle: 'dashed' }, intervals: { from: '1m', to: '15m' }, props: {
      iqterminal: { version: 1 }, iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h',
    },
  });
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(1);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(2);
  expect((await drawingState(page, panel)).drawings.find(item => item.id === duplicateId)).toMatchObject({
    style: { color: '#26a69a', lineStyle: 'dashed' }, intervals: { from: '1m', to: '15m' }, props: {
      iqterminal: { version: 1 }, iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h',
    },
  });

  await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.drawings.select(drawingId), { panelId, drawingId: duplicateId });
  await panel.locator('.chart-stage').focus();
  await page.keyboard.press('Control+d');
  const keyboardDuplicateId = await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).engine.drawings.selection()[0] as string | undefined, panelId);
  expect(keyboardDuplicateId).toBeTruthy();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(3);
  expect((await drawingState(page, panel)).drawings.find(item => item.id === keyboardDuplicateId)).toMatchObject({
    style: { color: '#26a69a', lineStyle: 'dashed' }, intervals: { from: '1m', to: '15m' }, props: {
      iqterminal: { version: 1 }, iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h',
    },
  });
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(2);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(3);
  for (const [drawingId, remaining] of [[keyboardDuplicateId, 2], [duplicateId, 1]] as const) {
    const objectId = await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.objects.list().find((item: any) => item.sourceId === drawingId)?.id, { panelId, drawingId });
    await panel.locator(`[data-object-id="${objectId}"] [data-object-action="remove"]`).click();
    await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(remaining);
  }
  state = await drawingState(page, panel);
  expect(state.canUndo).toBe(true);
  expect(state.canRedo).toBe(false);
  // The next drawing placement resets this delete branch and proves one undo removes the placement, not metadata.
  await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.drawings.select(drawingId), { panelId, drawingId: originalId });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = panel.getByRole('dialog', { name: 'Drawing settings templates' });
  await expect(templates.getByText('Loading local template catalog…')).toHaveCount(0);
  await templates.getByLabel('Drawing template name').fill('4H Support');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  const templateRow = templates.locator('.drawing-template-row').filter({ hasText: '4H Support' });
  await expect(templateRow).toBeVisible();
  await templateRow.locator('[data-template-action="favorite"]').click();
  await expect.poll(() => page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('iqterminal:drawing-templates:v1') ?? 'null');
    return record?.templates?.[0]?.favorite;
  })).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('iqterminal:drawing-templates:v1') ?? 'null')?.templates?.[0])).toMatchObject({
    version: 1, tool: 'horizontal-line', label: { present: true, value: '4H Support' }, analysisInterval: '4h',
    textColorExplicit: true,
    visibility: { visible: true, intervals: { from: '1m', to: '15m' } }, favorite: true,
    nativeValues: { 'style.color': '#26a69a', 'style.lineStyle': 'dashed', 'text.color': '#f5f5f5' },
  });
  await page.screenshot({ path: 'artifacts/drawing-templates-1366x768.png' });

  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await placeHorizontalLine(page, panel, 7);
  state = await drawingState(page, panel);
  expect(state.drawings).toHaveLength(2);
  const targetId = state.drawings.at(-1)!.id;
  await page.evaluate(({ id, target }) => {
    const view = (window as any).__terminal.panels.get(id);
    view.engine.drawings.select(target);
    view.syncDrawingActions();
  }, { id: panelId, target: targetId });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const apply = templates.locator('.drawing-template-row').filter({ hasText: '4H Support' }).getByRole('button', { name: 'Apply', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === targetId)?.props?.iqterminalLabel).toBe('4H Support');
  state = await drawingState(page, panel);
  const applied = state.drawings.find(item => item.id === targetId)!;
  expect(applied).toMatchObject({ id: targetId, paneIndex: 0, style: { color: '#26a69a', lineStyle: 'dashed' }, intervals: { from: '1m', to: '15m' }, props: {
    iqterminal: { version: 1 }, iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h',
  } });
  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  state = await drawingState(page, panel);
  expect(state.drawings).toHaveLength(2);
  expect(state.drawings.find(item => item.id === targetId)?.props).toMatchObject({ iqterminalLabelState: 'unset', iqterminalAnalysisInterval: '1m' });
  expect(state.drawings.find(item => item.id === targetId)?.intervals).toBeUndefined();
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === targetId)?.props?.iqterminalAnalysisInterval).toBe('4h');

  const targetObjectId = await page.evaluate(({ panelId, drawingId }) => (window as any).__terminal.panels.get(panelId).engine.objects.list().find((item: any) => item.sourceId === drawingId)?.id, { panelId, drawingId: targetId });
  const targetRow = panel.locator(`[data-object-id="${targetObjectId}"]`);
  await targetRow.getByRole('button', { name: 'Style', exact: true }).click();
  const targetSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await targetSettings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('unset');
  await targetSettings.locator('[data-setting-path="props.iqterminalLabel"]').fill('');
  await targetSettings.locator('[data-setting-path="style.color"]').evaluate((element: HTMLInputElement) => { element.value = '#4b5563'; });
  await targetSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === targetId)).toMatchObject({ props: { iqterminalLabelState: 'unset', iqterminalLabel: '' }, style: { color: '#4b5563' } });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(templates.getByLabel('Include label')).not.toBeChecked();
  await templates.getByLabel('Drawing template name').fill('No label');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  const blankTemplate = templates.locator('.drawing-template-row').filter({ hasText: 'No label' });
  await expect(blankTemplate).toBeVisible();
  const firstBlankRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('iqterminal:drawing-templates:v1') ?? 'null')?.templates?.find((item: any) => item.name === 'No label'));
  expect(firstBlankRecord).toMatchObject({ revision: 1, label: { present: false, value: '' }, nativeValues: { 'style.color': '#4b5563' } });
  const originalRow = panel.locator(`[data-object-id="${originalObjectId}"]`);
  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await originalRow.getByRole('button', { name: 'Style', exact: true }).click();
  const originalSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await originalSettings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('custom');
  await originalSettings.locator('[data-setting-path="props.iqterminalLabel"]').fill('Keep this annotation');
  await originalSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: originalId });
  const applyOmittedLabel = templates.locator('.drawing-template-row').filter({ hasText: 'No label' }).getByRole('button', { name: 'Apply', exact: true });
  await applyOmittedLabel.click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === originalId)?.props).toMatchObject({ iqterminalLabelState: 'custom', iqterminalLabel: 'Keep this annotation' });

  // Saving the same tool/name updates this catalog record; included empty is an explicit clear.
  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: targetId });
  await targetRow.getByRole('button', { name: 'Style', exact: true }).click();
  const updateSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await updateSettings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('custom');
  await updateSettings.locator('[data-setting-path="props.iqterminalLabel"]').fill('');
  await updateSettings.locator('[data-setting-path="style.color"]').evaluate((element: HTMLInputElement) => { element.value = '#9aa4af'; });
  await updateSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: targetId });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(templates.getByLabel('Include label')).toBeChecked();
  await templates.getByLabel('Drawing template name').fill('No label');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  const updatedBlankRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('iqterminal:drawing-templates:v1') ?? 'null')?.templates?.find((item: any) => item.name === 'No label'));
  expect(updatedBlankRecord).toMatchObject({ id: firstBlankRecord.id, revision: 2, label: { present: true, value: '' }, nativeValues: { 'style.color': '#9aa4af' } });
  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: originalId });
  const applyEmptyLabel = templates.locator('.drawing-template-row').filter({ hasText: 'No label' }).getByRole('button', { name: 'Apply', exact: true });
  await expect(applyEmptyLabel).toBeEnabled();
  await applyEmptyLabel.click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === originalId)).toMatchObject({ style: { color: '#9aa4af' }, intervals: { from: '1m', to: '15m' }, props: { iqterminalLabelState: 'custom', iqterminalLabel: '', iqterminalAnalysisInterval: '4h' } });
  const retainedDrawings = (await drawingState(page, panel)).drawings;
  expect(retainedDrawings).toHaveLength(2);
  await templates.locator('.drawing-template-row').filter({ hasText: 'No label' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'No label' })).toHaveCount(0);
  expect((await drawingState(page, panel)).drawings).toEqual(retainedDrawings);

  await templates.locator('.drawing-template-row').filter({ hasText: '4H Support' }).getByRole('button', { name: 'Set default', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: '4H Support' }).getByRole('button', { name: 'Default ✓', exact: true })).toBeVisible();
  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await placeHorizontalLine(page, panel, 13);
  state = await drawingState(page, panel);
  expect(state.drawings).toHaveLength(3);
  const defaultId = state.drawings.at(-1)!.id;
  expect(state.drawings.at(-1)).toMatchObject({
    id: defaultId, style: { color: '#26a69a', lineStyle: 'dashed' }, intervals: { from: '1m', to: '15m' },
    props: { iqterminalLabelState: 'custom', iqterminalLabel: '4H Support', iqterminalAnalysisInterval: '4h' },
  });
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(2);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === defaultId)?.props?.iqterminalLabel).toBe('4H Support');
  await page.screenshot({ path: 'artifacts/drawing-objects-1366x768.png' });

  // The one Objects panel follows chart focus and routes its controls to the focused chart.
  await page.evaluate(() => { (window as any).__sharedObjectsPanel = document.querySelector('.chart-objects-panel'); });
  // A second chart for the same perp retains its own instrument drawings document.
  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'binance', market: 'perpetual', interval: '1m' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.panels.size)).toBe(3);
  const secondPerpId = await page.evaluate(() => (window as any).__terminal.stats().panels
    .filter((item: any) => item.series.venue === 'binance' && item.series.market === 'perpetual')[1].id as string);
  const secondPerp = page.locator(`[data-panel-id="${secondPerpId}"]`);
  await page.evaluate(id => (window as any).__terminal.panels.get(id).params.api.setActive(), secondPerpId);
  const sharedObjectsPanel = page.locator('.chart-objects-panel');
  await expect(sharedObjectsPanel).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__sharedObjectsPanel === document.querySelector('.chart-objects-panel'))).toBe(true);
  await expect(sharedObjectsPanel.locator('summary')).toContainText(secondPerpId);
  expect(await sharedObjectsPanel.evaluate(panel => panel.closest('.candle-panel')?.getAttribute('data-panel-id'))).toBe(secondPerpId);
  await page.evaluate(() => {
    (window as any).__drawingObjectActionOwners = [];
    for (const [panelId, view] of (window as any).__terminal.panels) {
      const action = view.drawingObjectAction.bind(view);
      view.drawingObjectAction = (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-object-action]');
        (window as any).__drawingObjectActionOwners.push({ panelId, action: button?.dataset.objectAction, objectId: button?.dataset.objectId });
        return action(event);
      };
    }
  });
  await expect.poll(async () => (await drawingState(page, secondPerp)).drawings.length).toBe(0);
  await placeHorizontalLine(page, secondPerp, 21);
  await expect.poll(async () => (await drawingState(page, secondPerp)).drawings.length).toBe(1);
  expect((await drawingState(page, panel)).drawings).toHaveLength(3);
  const secondDrawingRow = sharedObjectsPanel.locator('.chart-object-row.kind-drawing').last();
  const secondDrawingObjectId = await secondDrawingRow.getAttribute('data-object-id');
  expect(secondDrawingObjectId).toBeTruthy();
  await secondDrawingRow.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, secondPerp)).drawings[0]?.visible).toBe(false);
  expect(await sharedObjectsPanel.evaluate(panel => panel.closest('.candle-panel')?.getAttribute('data-panel-id'))).toBe(secondPerpId);
  expect((await drawingState(page, panel)).drawings.every(drawing => drawing.visible !== false)).toBe(true);
  await secondDrawingRow.getByRole('button', { name: 'Show', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__drawingObjectActionOwners.slice(-2))).toEqual([
    { panelId: secondPerpId, action: 'visible', objectId: secondDrawingObjectId },
    { panelId: secondPerpId, action: 'visible', objectId: secondDrawingObjectId },
  ]);
  await expect.poll(async () => (await drawingState(page, secondPerp)).drawings[0]?.visible).not.toBe(false);

  // Spot and USD-M perpetual keep different drawing documents on the same panel.
  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(0);
  await placeHorizontalLine(page, panel, 27);
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(1);
  const scopeKeys = await page.evaluate(panelId => {
    const spot = `iqterminal:drawings:${encodeURIComponent(panelId)}:binance%3Aspot:BTCUSDT`;
    const perpetual = `iqterminal:drawings:${encodeURIComponent(panelId)}:binance%3Aperpetual:BTCUSDT`;
    return { spot: JSON.parse(localStorage.getItem(spot) ?? 'null')?.drawings?.length, perpetual: JSON.parse(localStorage.getItem(perpetual) ?? 'null')?.drawings?.length };
  }, panelId);
  expect(scopeKeys).toEqual({ spot: 1, perpetual: 3 });
  await chooseChartMarket(panel, 'Binance · BTCUSDT USD-M Perp');
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(3);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().feed.subscriptions)).toBe(3);
  const feedSubscriptions = await page.evaluate(() => (window as any).__terminal.stats().feed.subscriptions);

  await panel.getByLabel('Timeframe', { exact: true }).selectOption('1h');
  await expect.poll(async () => (await drawingState(page, panel)).hidden.length).toBeGreaterThanOrEqual(2);
  expect((await drawingState(page, panel)).drawings).toHaveLength(3);
  const binanceKey = `iqterminal:drawings:${encodeURIComponent(panelId!)}:binance%3Aperpetual:BTCUSDT`;
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.drawings?.length, binanceKey)).toBe(3);

  await chooseChartMarket(panel, 'Hyperliquid · BTC Perp');
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(0);
  await chooseChartMarket(panel, 'Binance · BTCUSDT USD-M Perp');
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(3);
  await page.evaluate(() => (window as any).__terminal.feed.send({ type: 'diagnostics' }));
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().feed.subscriptions)).toBe(feedSubscriptions);
  expect(mainNavigations).toBe(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const reloadedPanel = page.locator('.candle-panel').first();
  await expect.poll(async () => (await drawingState(page, reloadedPanel)).drawings.length).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.panels.size)).toBe(3);
  await reloadedPanel.getByLabel('Drawing tool', { exact: true }).selectOption('horizontal-line');
  await reloadedPanel.getByRole('button', { name: 'Templates', exact: true }).click();
  const reloadedTemplates = reloadedPanel.getByRole('dialog', { name: 'Drawing settings templates' });
  await expect(reloadedTemplates.locator('.drawing-template-row').filter({ hasText: '4H Support' }).getByRole('button', { name: 'Default ✓', exact: true })).toBeVisible();
  await expect(reloadedTemplates.locator('.drawing-template-row').filter({ hasText: '4H Support' }).locator('[data-template-action="favorite"]')).toHaveAttribute('aria-pressed', 'true');
  const reloadedSecondPerp = page.locator(`[data-panel-id="${secondPerpId}"]`);
  await expect.poll(async () => (await drawingState(page, reloadedSecondPerp)).drawings.length).toBe(1);
  await reloadedTemplates.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseChartMarket(reloadedPanel, 'Binance · BTCUSDT Spot');
  await expect.poll(async () => (await drawingState(page, reloadedPanel)).drawings.length).toBe(1);
  await chooseChartMarket(reloadedPanel, 'Binance · BTCUSDT USD-M Perp');
  await expect.poll(async () => (await drawingState(page, reloadedPanel)).drawings.length).toBe(3);
  expect(errors).toEqual([]);
});

test('every exposed native drawing tool completes its required anchors', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const tool = panel.getByLabel('Drawing tool', { exact: true });
  const magnet = panel.getByLabel('Drawing magnet', { exact: true });
  const stage = panel.locator('.chart-stage');
  await expect(magnet).toHaveValue('weak');
  await magnet.selectOption('strong');
  expect(await page.evaluate(id => {
    const view = (window as any).__terminal.panels.get(id);
    return { configured: view.selection.drawingMagnet, active: view.engine.drawings.magnetMode() };
  }, panelId)).toEqual({ configured: 'strong', active: 'strong' });
  const placements = [
    { id: 'horizontal-line', anchors: 1 },
    { id: 'horizontal-ray', anchors: 1 },
    { id: 'trend-line', anchors: 2 },
    { id: 'rectangle', anchors: 2 },
    { id: 'fib-retracement', anchors: 2 },
    { id: 'long-position', anchors: 2 },
    { id: 'short-position', anchors: 2 },
    { id: 'text', anchors: 1 },
  ] as const;
  for (const [index, placement] of placements.entries()) {
    await tool.selectOption(placement.id);
    await expect(panel.locator('.drawing-placement-state')).toHaveText(`Place: ${await tool.locator(`option[value="${placement.id}"]`).textContent()}`);
    const anchors = await page.evaluate(({ panelId, index }) => {
      const view = (window as any).__terminal.panels.get(panelId);
      const plot = view.engine.chart.plotRect(0);
      const x = plot.left + plot.width * (.2 + index % 4 * .14);
      const y = plot.top + plot.height * (.22 + Math.floor(index / 4) * .22);
      return [{ x, y }, { x: x + plot.width * .08, y: y + plot.height * .14 }];
    }, { panelId, index });
    const before = (await drawingState(page, panel)).drawings.length;
    for (let anchor = 0; anchor < placement.anchors; anchor++) {
      const point = anchors[anchor]!;
      await stage.click({ position: { x: Math.round(point.x), y: Math.round(point.y) } });
    }
    await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(before + 1);
    expect((await drawingState(page, panel)).drawings.some(drawing => drawing.tool === placement.id)).toBe(true);
    await tool.selectOption('');
    await expect(panel.locator('.drawing-placement-state')).toBeHidden();
  }

  await panel.locator('.chart-objects-panel>summary').click();
  const nativeIds = await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    const drawings = view.engine.drawings.drawings();
    const objects = view.engine.objects.list();
    return Object.fromEntries(['rectangle', 'fib-retracement'].map(toolId => {
      const drawing = drawings.find((item: any) => item.tool === toolId);
      return [toolId, objects.find((item: any) => item.sourceId === drawing?.id)?.id];
    }));
  }, panelId);
  await panel.locator(`[data-object-id="${nativeIds.rectangle}"]`).getByRole('button', { name: 'Style', exact: true }).click();
  const rectangleSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await expect(rectangleSettings.locator('[data-setting-path="style.fill"]')).toBeVisible();
  await expect(rectangleSettings.locator('[data-setting-path="style.fillOpacity"]')).toBeVisible();
  await rectangleSettings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.locator(`[data-object-id="${nativeIds['fib-retracement']}"]`).getByRole('button', { name: 'Style', exact: true }).click();
  const fibSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await expect(fibSettings.locator('[data-setting-path="style.levels"]')).toBeVisible();
  await expect(fibSettings.locator('[data-setting-path="style.fillOpacity"]')).toBeVisible();
  await fibSettings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.locator('.chart-objects-panel>summary').click();

  const futureAnchor = await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    const plot = view.engine.chart.plotRect(0);
    const x = Math.round(plot.left + plot.width * .98);
    const y = Math.round(plot.top + plot.height * .45);
    return { x, y, time: view.engine.chart.coordinateToTime(x), latest: view.engine.latestCandle().time };
  }, panelId);
  expect(futureAnchor.time).toBeGreaterThan(futureAnchor.latest);
  await tool.selectOption('horizontal-line');
  await stage.click({ position: { x: futureAnchor.x, y: futureAnchor.y } });
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(9);
  const futureDrawing = (await drawingState(page, panel)).drawings.find(drawing => drawing.tool === 'horizontal-line' && drawing.points?.some(point => (point as any).time === futureAnchor.time));
  expect(futureDrawing?.points?.[0]).toMatchObject({ time: futureAnchor.time });
  expect((futureDrawing?.points?.[0] as any).time).toBeGreaterThan(futureAnchor.latest);

  const beforePrepend = await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    const point = view.engine.drawings.get(drawingId).points[0];
    return { time: point.time, x: view.engine.chart.timeToCoordinate(point.time), earliest: view.engine.series.getData()[0].time };
  }, { panelId, drawingId: futureDrawing!.id });
  await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    const earliest = view.engine.series.getData()[0].time;
    const source = view.engine.series.getData()[0];
    const older = [3, 2, 1].map(offset => ({
      time: earliest - offset * 60,
      open: source.open, high: source.high, low: source.low, close: source.close, volume: 0,
    }));
    view.engine.series.prependData(older);
  }, panelId);
  const afterPrepend = await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    const point = view.engine.drawings.get(drawingId).points[0];
    return { time: point.time, x: view.engine.chart.timeToCoordinate(point.time), earliest: view.engine.series.getData()[0].time };
  }, { panelId, drawingId: futureDrawing!.id });
  expect(afterPrepend.earliest).toBeLessThan(beforePrepend.earliest);
  expect(afterPrepend.time).toBe(beforePrepend.time);
  expect(Math.abs(afterPrepend.x - beforePrepend.x)).toBeLessThan(2);
});

test('text templates use an included label as native text content and preserve omitted content', async ({ page }) => {
  test.setTimeout(45_000);
  await watchCanvasText(page);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const tool = panel.getByLabel('Drawing tool', { exact: true });
  const stage = panel.locator('.chart-stage');
  const plot = await page.evaluate(id => {
    const chart = (window as any).__terminal.panels.get(id).engine.chart;
    const rect = chart.plotRect(0);
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, panelId);
  const anchors = [
    { x: Math.round(plot.left + plot.width * .28), y: Math.round(plot.top + plot.height * .35) },
    { x: Math.round(plot.left + plot.width * .63), y: Math.round(plot.top + plot.height * .62) },
  ];
  await tool.selectOption('text');
  const sourceCount = (await drawingState(page, panel)).drawings.length;
  await stage.click({ position: anchors[0]! });
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(sourceCount + 1);
  await tool.selectOption('');
  await tool.selectOption('text');
  await stage.click({ position: anchors[1]! });
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(sourceCount + 2);
  await tool.selectOption('');
  let drawings = (await drawingState(page, panel)).drawings.filter(item => item.tool === 'text');
  expect(drawings).toHaveLength(2);
  const sourceId = drawings[0]!.id;
  const targetId = drawings[1]!.id;
  await panel.locator('.chart-objects-panel>summary').click();
  const objectIdFor = async (drawingId: string) => page.evaluate(({ panelId, drawingId }) =>
    (window as any).__terminal.panels.get(panelId).engine.objects.list().find((item: any) => item.sourceId === drawingId)?.id as string,
  { panelId, drawingId });

  const sourceObjectId = await objectIdFor(sourceId);
  await panel.locator(`[data-object-id="${sourceObjectId}"]`).getByRole('button', { name: 'Style', exact: true }).click();
  const sourceSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await sourceSettings.locator('[data-setting-path="text.value"]').fill('Native source text');
  await sourceSettings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('custom');
  await sourceSettings.locator('[data-setting-path="props.iqterminalLabel"]').fill('Template note');
  await page.evaluate(() => { (window as any).__watchCanvasTextValues = ['Template note']; });
  await sourceSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === sourceId)?.text?.value).toBe('Native source text');

  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: sourceId });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = panel.getByRole('dialog', { name: 'Drawing settings templates' });
  await expect(templates.getByLabel('Include label')).toBeChecked();
  await templates.getByLabel('Drawing template name').fill('Text with label');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'Text with label' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iqterminal:drawing-templates:v1') ?? 'null')?.templates?.find((item: any) => item.name === 'Text with label'))).toMatchObject({
    tool: 'text', label: { present: true, value: 'Template note' }, nativeValues: {},
  });
  await templates.getByLabel('Include label').uncheck();
  await templates.getByLabel('Drawing template name').fill('Text style only');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'Text style only' })).toBeVisible();
  await templates.getByRole('button', { name: 'Done', exact: true }).click();

  const targetObjectId = await objectIdFor(targetId);
  expect(targetObjectId).toBeTruthy();
  await panel.locator(`[data-object-id="${targetObjectId}"]`).getByRole('button', { name: 'Style', exact: true }).click();
  const targetSettings = panel.getByRole('dialog', { name: 'Drawing settings' });
  await targetSettings.locator('[data-setting-path="text.value"]').fill('Keep target text');
  await targetSettings.locator('[data-setting-path="props.iqterminalLabelState"]').selectOption('custom');
  await targetSettings.locator('[data-setting-path="props.iqterminalLabel"]').fill('Existing label');
  await targetSettings.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.evaluate(({ panelId, drawingId }) => {
    const view = (window as any).__terminal.panels.get(panelId);
    view.engine.drawings.select(drawingId); view.syncDrawingActions();
  }, { panelId, drawingId: targetId });
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const apply = (name: string) => templates.locator('.drawing-template-row').filter({ hasText: name }).getByRole('button', { name: 'Apply', exact: true });
  await apply('Text style only').click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === targetId)).toMatchObject({ text: { value: 'Keep target text' }, props: { iqterminalLabelState: 'custom', iqterminalLabel: 'Existing label' } });
  await apply('Text with label').click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === targetId)?.text?.value).toBe('Template note');
  expect((await drawingState(page, panel)).drawings.find(item => item.id === targetId)).toMatchObject({ text: { value: 'Template note' }, props: { iqterminalLabelState: 'custom', iqterminalLabel: 'Template note' } });
  await expect.poll(() => page.evaluate(() => (window as any).__seenCanvasTextValues?.includes('Template note') ?? false)).toBe(true);
  await templates.getByRole('button', { name: 'Done', exact: true }).click();
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await drawingState(page, panel)).drawings.find(item => item.id === targetId)?.text?.value).toBe('Keep target text');
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await drawingState(page, panel)).drawings.find(item => item.id === targetId)?.text?.value).toBe('Template note');
  drawings = (await drawingState(page, panel)).drawings.filter(item => item.tool === 'text');
  expect(drawings).toHaveLength(2);
});

test('template storage corruption stays intact while the session catalog remains usable', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const corrupt = '{not valid json';
  await page.evaluate(value => localStorage.setItem('iqterminal:drawing-templates:v1', value), corrupt);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  await placeHorizontalLine(page, panel, 5);
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = panel.getByRole('dialog', { name: 'Drawing settings templates' });
  const status = templates.getByRole('status');
  await expect(status).toContainText('using memory for this session');
  await expect(status).toContainText('stored record was left untouched');
  await templates.getByLabel('Drawing template name').fill('Session only');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'Session only' })).toBeVisible();
  await expect(status).toContainText('Template saved');
  expect(await page.evaluate(() => localStorage.getItem('iqterminal:drawing-templates:v1'))).toBe(corrupt);
});

test('drawing document write failure keeps session drawings and leaves the separate template catalog writable', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('iqterminal:drawings:')) throw new DOMException('drawing quota denied', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    };
  });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  await placeHorizontalLine(page, panel, 6);
  await expect.poll(async () => (await drawingState(page, panel)).drawings.length).toBe(1);
  await expect.poll(() => warnings.some(message => message.includes('[drawings] write failed') && message.includes('drawing quota denied'))).toBe(true);

  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = panel.getByRole('dialog', { name: 'Drawing settings templates' });
  await templates.getByLabel('Drawing template name').fill('Catalog still writable');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'Catalog still writable' })).toBeVisible();
  const persisted = await page.evaluate(() => localStorage.getItem('iqterminal:drawing-templates:v1'));
  expect(JSON.parse(persisted ?? 'null').templates[0].name).toBe('Catalog still writable');
  expect(await page.evaluate(async key => localStorage.getItem(key), await drawingStorageKey(page, panel))).toBeNull();
  expect((await drawingState(page, panel)).drawings).toHaveLength(1);
});

test('corrupt drawing document stays untouched while another valid local catalog remains readable', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  await placeHorizontalLine(page, panel, 4);
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = panel.getByRole('dialog', { name: 'Drawing settings templates' });
  await templates.getByLabel('Drawing template name').fill('Surviving template');
  await templates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(templates.locator('.drawing-template-row').filter({ hasText: 'Surviving template' })).toBeVisible();
  await templates.getByRole('button', { name: 'Done', exact: true }).click();

  const drawingKey = await drawingStorageKey(page, panel);
  const validOtherInstrumentKey = drawingKey.replace('BTCUSDT', 'ETHUSDT');
  const validDrawingDocument = await page.evaluate(key => localStorage.getItem(key), drawingKey);
  expect(validDrawingDocument).toBeTruthy();
  const corrupt = '{not valid drawing JSON';
  const validCatalog = await page.evaluate(() => localStorage.getItem('iqterminal:drawing-templates:v1'));
  expect(validCatalog).toBeTruthy();
  await page.evaluate(({ drawingKey, corrupt }) => {
    localStorage.setItem(drawingKey, corrupt);
  }, { drawingKey, corrupt });
  await page.evaluate(({ validOtherInstrumentKey, validDrawingDocument }) => localStorage.setItem(validOtherInstrumentKey, validDrawingDocument), { validOtherInstrumentKey, validDrawingDocument: validDrawingDocument! });

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await placeHorizontalLine(page, panel, 7);
  expect((await drawingState(page, panel)).drawings).toHaveLength(1);
  expect(await page.evaluate(key => localStorage.getItem(key), drawingKey)).toBe(corrupt);
  expect(await page.evaluate(key => localStorage.getItem(key), validOtherInstrumentKey)).toBe(validDrawingDocument);
  expect(await page.evaluate(() => localStorage.getItem('iqterminal:drawing-templates:v1'))).toBe(validCatalog);
  await panel.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(panel.getByRole('dialog', { name: 'Drawing settings templates' }).locator('.drawing-template-row').filter({ hasText: 'Surviving template' })).toBeVisible();
});

test('Footprint and Heatmap appear once in IQ Objects and accept a drawing overlay', async ({ page }) => {
  const worker = await installDepthFixture(page);
  await useDarkTheme(page);
  await worker.evaluate(() => {
    const Base = self.WebSocket;
    const probe = (self as any).__executionFixture = { active: 0, accepted: 0 };
    let sequence = 1;
    class Socket {
      readyState = 0; onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror = null; onmessage: ((event: any) => void) | null = null;
      timer?: ReturnType<typeof setInterval>;
      constructor() {
        probe.active++;
        setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); this.timer = setInterval(() => {
          const id = sequence++, now = Date.now(); probe.accepted++;
          this.onmessage?.({ data: JSON.stringify({ e: 'aggTrade', s: 'BTCUSDT', E: now, T: now, a: id, f: id * 2, l: id * 2 + 1, p: String(82990 + id % 4 * 10), q: '.01', m: id % 2 === 0 }) });
        }, 100); }, 10);
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.timer); probe.active--; this.onclose?.(); }
      send() {}
    }
    self.WebSocket = new Proxy(Base, { construct(target, args) { return String(args[0]).includes('@aggTrade') ? new Socket() : Reflect.construct(target, args); } }) as any;
  });
  const panel = page.locator('.candle-panel').first();
  await addIndicator(panel, 'Footprint');
  await addIndicator(panel, 'Order-book Heatmap');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.bars)).toBeGreaterThan(0);
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  await placeHorizontalLine(page, panel, 9);
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');

  const objectsPanel = panel.locator('.chart-objects-panel');
  await objectsPanel.locator('summary').click();
  const footprintRow = objectsPanel.locator('.chart-object-row.kind-profile').filter({ hasText: 'Footprint' });
  const heatmapRow = objectsPanel.locator('.chart-object-row.kind-indicator').filter({ hasText: 'Order-book Heatmap' });
  await expect(footprintRow).toHaveCount(1);
  await expect(heatmapRow).toHaveCount(1);
  expect(await page.evaluate(panelId => {
    const view = (window as any).__terminal.panels.get(panelId);
    return view.engine.objects.list().filter((item: any) => item.id.startsWith('custom:iqterminal-native.')).map((item: any) => item.name).sort();
  }, panelId)).toEqual(['Footprint', 'Order-book Heatmap']);
  await expect(objectsPanel.locator('.chart-object-row.kind-drawing')).toHaveCount(1);
  await footprintRow.getByRole('button', { name: 'Style', exact: true }).click();
  const footprintSettings = panel.getByRole('dialog', { name: 'Footprint display settings' });
  await expect(footprintSettings).toBeVisible();
  await footprintSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'artifacts/drawing-footprint-heatmap-1366x768.png' });

  await footprintRow.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.type)).toBe('candle');
  await expect(footprintRow.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
  await footprintRow.getByRole('button', { name: 'Show', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.type)).toBe('footprint');
  await heatmapRow.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(panel.locator('.heatmap-settings')).toBeVisible();
  await panel.locator('.heatmap-settings').getByRole('button', { name: 'Close', exact: true }).click();
  expect(await worker.evaluate(() => (self as any).__executionFixture.accepted)).toBeGreaterThan(0);
});

test('Level Watch Objects visibility, instrument guard and picking disarm drawings', async ({ page }) => {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first();
  const panelId = await panel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Candle panel id is missing');
  const watchButton = panel.getByRole('button', { name: 'Watch level', exact: true });
  await expect(watchButton).toBeEnabled();
  const watch = { id: 'fixture-watch', revision: 1, definition: { name: 'Fixture watch', lower: 82900, upper: 83100, invalidation: 82800, thesis: 'fixture', expiresAt: Date.now() + 60_000 }, state: 'draft', quality: 'fixture', reason: 'browser fixture', armedAt: Date.now() };
  await page.evaluate(({ panelId, watch }) => (window as any).__terminal.panels.get(panelId).setWatchZones([watch]), { panelId, watch });
  const objectsPanel = panel.locator('.chart-objects-panel');
  await objectsPanel.locator('summary').click();
  const watchRow = objectsPanel.locator('.chart-object-row.kind-profile').filter({ hasText: 'Level Watch zones' });
  await expect(watchRow).toHaveCount(1);
  await watchRow.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(watchRow.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
  await watchRow.getByRole('button', { name: 'Show', exact: true }).click();

  await chooseChartMarket(panel, 'Binance · BTCUSDT Spot');
  await expect(watchButton).toBeDisabled();
  await expect(objectsPanel.locator('.chart-object-row').filter({ hasText: 'Level Watch zones' })).toHaveCount(0);
  await chooseChartMarket(panel, 'Binance · BTCUSDT USD-M Perp');
  await expect(watchButton).toBeEnabled();

  await panel.getByLabel('Drawing tool', { exact: true }).selectOption('horizontal-line');
  await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).beginWatchZone(() => {}), panelId);
  await expect(panel.locator('.chart-stage')).toHaveClass(/watch-zone-picking/);
  await expect(panel.getByLabel('Drawing tool', { exact: true })).toHaveValue('');
  expect(await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).engine.drawings.drawings().length, panelId)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(panel.locator('.chart-stage')).not.toHaveClass(/watch-zone-picking/);
  expect(await page.evaluate(panelId => (window as any).__terminal.panels.get(panelId).engine.drawings.drawings().length, panelId)).toBe(0);
});

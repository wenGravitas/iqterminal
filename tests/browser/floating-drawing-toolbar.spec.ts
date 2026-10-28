import { test, expect } from '@playwright/test';

test('floating drawing toolbar pins by drag, preserves styles, moves, reorders and restores per chart', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = DataTransfer.prototype.setDragImage;
    (window as any).__drawingDragImages = [];
    DataTransfer.prototype.setDragImage = function(element, x, y) {
      (window as any).__drawingDragImages.push({ text: element.textContent, icons: element.querySelectorAll('svg').length,
        stroke: element.querySelector('svg') ? getComputedStyle(element.querySelector('svg')!).stroke : '',
        background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color,
        connected: element.isConnected, width: element.getBoundingClientRect().width });
      return original.call(this,element,x,y);
    };
    if (localStorage.getItem('test-floating-template')) return;
    localStorage.setItem('test-floating-template', '1');
    localStorage.setItem('iqterminal:drawing-templates:v1', JSON.stringify({ version: 1, revision: 1,
      templates: [{ version: 1, id: 'saved-line', name: 'Saved line style', tool: 'horizontal-line', favorite: false, revision: 1, createdAt: 1, updatedAt: 1,
        nativeValues: { 'style.color': '#f0b56e', 'style.lineWidth': 3, 'style.lineStyle': 'dashed' }, label: { present: true, value: 'Saved style' }, textColorExplicit: false, analysisInterval: null, visibility: { visible: true, intervals: null } }],
      defaults: [{ tool: 'horizontal-line', templateId: 'saved-line', updatedAt: 1 }] }));
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  const panel = page.locator('.candle-panel').first(), second = page.locator('.candle-panel').nth(1);
  const bar = panel.getByRole('toolbar', { name: 'Floating drawing toolbar' });
  const toggle = panel.getByRole('button', { name: 'Toggle floating drawing toolbar', exact: true });
  const state = () => panel.evaluate(element => { const p = [...(window as any).__terminal.panels.values()].find((p:any) => p.element === element); return { config: p.selection.floatingDrawingToolbar, active: p.engine.drawings.activeTool(), erasing: p.engine.drawings.erasing(), drawings: p.engine.drawings.drawings() }; });
  await expect(bar).toBeHidden(); await toggle.click(); await expect(bar).toBeVisible();
  await expect(bar.locator('[data-floating-tool]')).toHaveCount(2);
  await expect(bar.getByText('Drag drawing tools here',{exact:true})).toBeVisible();
  await page.getByLabel('Theme',{exact:true}).selectOption('dark');
  await bar.screenshot({path:'/tmp/floating-toolbar-empty-dark.png'});
  await expect(bar.getByRole('button', { name: 'Pointer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByRole('toolbar', { name: 'Floating drawing toolbar' })).toBeHidden();
  const engine = await panel.getAttribute('data-panel-id');
  await page.evaluate(id => { const p = (window as any).__terminal.panels.get(id); (window as any).__floatingIdentity = { engine: p.engine, chart: p.engine.chart, range: p.engine.visibleRange() }; }, engine!);
  await panel.getByRole('button', { name: 'Open Lines tools', exact: true }).click();
  const line = panel.locator('.drawing-sidebar-flyout[data-drawing-group=lines] [data-drawing-tool=horizontal-line]');
  await line.dragTo(bar);
  await expect(bar.locator('[data-floating-tool=horizontal-line]')).toBeVisible();
  await expect(bar.getByText('Drag drawing tools here',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__drawingDragImages.at(-1))).toMatchObject({text:'Horizontal Line',icons:1,connected:true,background:'rgb(17, 17, 17)',stroke:'rgb(199, 199, 199)'});
  await expect(page.locator('.drawing-tool-drag-preview')).toHaveCount(0);
  expect((await state()).active).toBeNull(); expect((await state()).drawings).toHaveLength(0);
  await panel.getByRole('button', { name: 'Open Position tools', exact: true }).click();
  await panel.locator('.drawing-sidebar-flyout[data-drawing-group=positions] [data-drawing-tool=price-range]').dragTo(bar);
  expect((await state()).config.tools).toEqual(['horizontal-line', 'price-range']);
  await bar.locator('[data-floating-tool=price-range]').dragTo(bar.locator('[data-floating-tool=horizontal-line]'), { targetPosition: { x: 2, y: 12 } });
  await expect.poll(async () => (await state()).config.tools).toEqual(['price-range', 'horizontal-line']);
  expect(await page.evaluate(()=>(window as any).__drawingDragImages.at(-1))).toMatchObject({text:'Vertical Measure',icons:1,connected:true});
  const before = (await bar.boundingBox())!;
  const handle = bar.getByRole('button', { name: 'Move drawing toolbar', exact: true });
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 10); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 100, grip.y + 90, { steps: 6 }); await page.mouse.up();
  const after = (await bar.boundingBox())!; expect(after.x - before.x).toBeGreaterThan(80); expect(after.y - before.y).toBeGreaterThan(60);
  expect(await page.evaluate(id => { const p = (window as any).__terminal.panels.get(id), old = (window as any).__floatingIdentity; return p.engine === old.engine && p.engine.chart === old.chart && JSON.stringify(p.engine.visibleRange()) === JSON.stringify(old.range); }, engine!)).toBe(true);
  await bar.getByRole('button', { name: 'Use Horizontal Line tool', exact: true }).click();
  expect((await state()).active).toBe('horizontal-line');
  const point = await panel.evaluate(element => { const p = [...(window as any).__terminal.panels.values()].find((p:any) => p.element === element), plot = p.engine.chart.plotRect(p.engine.chart.primaryPaneIndex()); return { x: plot.left + plot.width * .3, y: plot.top + plot.height * .65 }; });
  await panel.locator('.chart-stage').click({ position: point });
  await expect.poll(async () => (await state()).drawings.length).toBe(1);
  expect((await state()).drawings[0]).toMatchObject({ tool: 'horizontal-line', style: { color: '#f0b56e', lineWidth: 3, lineStyle: 'dashed' } });
  await bar.getByRole('button', { name: 'Erase', exact: true }).click(); expect((await state()).erasing).toBe(true);
  await bar.getByRole('button', { name: 'Pointer', exact: true }).click(); expect((await state()).erasing).toBe(false); expect((await state()).drawings).toHaveLength(1);
  await page.getByLabel('Theme', { exact: true }).selectOption('dark'); await page.screenshot({ path: '/tmp/floating-toolbar-dark.png' });
  const saved = (await state()).config;
  await toggle.click(); await expect(bar).toBeHidden(); await toggle.click(); expect((await state()).config.tools).toEqual(saved.tools);
  await page.reload(); await expect(bar).toBeVisible(); expect((await state()).config).toEqual(saved);
  await expect.poll(async () => (await state()).drawings.length).toBe(1);
  await expect(second.getByRole('toolbar', { name: 'Floating drawing toolbar' })).toBeHidden();
  await bar.locator('[data-floating-tool=price-range]').focus(); await page.keyboard.press('Delete');
  expect((await state()).config.tools).toEqual(['horizontal-line']); expect((await state()).drawings).toHaveLength(1);
  await panel.getByRole('button', { name: 'Open Shapes and Fibonacci tools', exact: true }).click();
  await panel.locator('.drawing-sidebar-flyout[data-drawing-group=shapes] [data-drawing-tool=rectangle]').focus();
  await page.keyboard.press('Shift+Enter');
  await expect(bar.locator('[data-floating-tool=rectangle]')).toBeVisible();
  expect((await state()).active).toBeNull(); expect((await state()).drawings).toHaveLength(1);
  await bar.locator('[data-floating-tool=rectangle]').focus(); await page.keyboard.press('Alt+ArrowLeft');
  expect((await state()).config.tools).toEqual(['rectangle', 'horizontal-line']);
  await bar.locator('[data-floating-tool=rectangle]').click({ modifiers: ['Alt'] });
  expect((await state()).config.tools).toEqual(['horizontal-line']);
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => { const box = (await bar.boundingBox())!, host = (await panel.locator('.chart-stage').boundingBox())!; return box.x >= host.x && box.y >= host.y && box.x + box.width <= host.x + host.width && box.y + box.height <= host.y + host.height; }).toBe(true);
  const bounds = (await bar.boundingBox())!, chart = (await panel.locator('.chart-stage').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(chart.x); expect(bounds.y).toBeGreaterThanOrEqual(chart.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(chart.x + chart.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(chart.y + chart.height);
  await page.screenshot({ path: '/tmp/floating-toolbar-light-narrow.png' });
  await bar.locator('[data-floating-tool=horizontal-line]').focus(); await page.keyboard.press('Delete');
  await expect(bar.getByText('Drag drawing tools here',{exact:true})).toBeVisible();
  await expect(bar.locator('[data-floating-tool]')).toHaveCount(2);
  await bar.screenshot({path:'/tmp/floating-toolbar-empty-light.png'});
  // The empty hint is also a valid drop target, and Ivory has its own drag surface.
  await panel.getByRole('button',{name:'Open Lines tools',exact:true}).click();
  await panel.locator('.drawing-sidebar-flyout[data-drawing-group=lines] [data-drawing-tool=horizontal-line]').dragTo(bar.getByText('Drag drawing tools here',{exact:true}));
  expect(await page.evaluate(()=>(window as any).__drawingDragImages.at(-1))).toMatchObject({text:'Horizontal Line',icons:1,background:'rgb(237, 234, 226)'});
  await expect(bar.getByText('Drag drawing tools here',{exact:true})).toHaveCount(0);
  await expect(page.locator('.drawing-tool-drag-preview')).toHaveCount(0);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('horizontal drawing price labels render as colored tags in the price axis', async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const nativeFillText = prototype.fillText;
    Object.defineProperty(prototype, 'fillText', {
      configurable: true,
      value: function (text: string, ...args: unknown[]) {
        const value = String(text);
        const watched = (window as any).__axisPriceWatch as string[] | undefined;
        const result = Reflect.apply(nativeFillText, this, [text, ...args]);
        if (!watched?.includes(value)) return result;
        const x = Number(args[0]);
        const y = Number(args[1]);
        const transform = this.getTransform();
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / Math.max(1, rect.width);
        const scaleY = this.canvas.height / Math.max(1, rect.height);
        const pixelX = Math.max(0, Math.floor(x * transform.a + transform.e - 8 * scaleX));
        const pixelY = Math.max(0, Math.floor(y * transform.d + transform.f - 12 * scaleY));
        const scanWidth = Math.max(1, Math.min(this.canvas.width - pixelX, Math.ceil(this.measureText(value).width + 20 * scaleX)));
        const scanHeight = Math.max(1, Math.min(this.canvas.height - pixelY, Math.ceil(24 * scaleY)));
        let strokeColorPixels = 0;
        try {
          const pixels = this.getImageData(pixelX, pixelY, scanWidth, scanHeight).data;
          for (let i = 0; i < pixels.length; i += 4) {
            const [r, g, b, a] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
            if (a > 0 && Math.abs(r - 38) < 30 && Math.abs(g - 166) < 30 && Math.abs(b - 154) < 30) strokeColorPixels++;
          }
        } catch { /* Pixel readback is only a browser-test diagnostic. */ }
        const records = ((window as any).__axisPricePixels ??= []) as Array<Record<string, unknown>>;
        records.push({ value, x, y, transform: [transform.a, transform.d, transform.e, transform.f],
          canvas: [this.canvas.width, this.canvas.height], canvasRect: [rect.left, rect.top, rect.width, rect.height],
          strokeColorPixels, fillStyle: this.fillStyle });
        return result;
      },
    });
  });

  await page.goto('/?fixture=1&fixtureTime=now');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars ?? 0)).toBeGreaterThan(0);
  const tags = await page.evaluate(() => {
    const view = (window as any).__terminal.panels.values().next().value;
    const chart = view.engine.chart;
    const pane = chart.panes()[0];
    const plot = chart.plotRect(0);
    const scale = pane.readoutScale();
    const items = [
      { tool: 'horizontal-line', fraction: 0.46 },
      { tool: 'horizontal-ray', fraction: 0.62 },
    ].map(item => {
      const price = scale.yToPrice(plot.height * item.fraction);
      const priceText = scale.format(price);
      const drawing = view.engine.drawings.add({
        tool: item.tool, paneIndex: 0, points: [{ time: chart.dataLayer.indexToTime(chart.dataLayer.length - 1), price }],
        style: { color: '#26a69a', lineWidth: 2, showLabels: true }, visible: true,
      });
      return { id: drawing.id, priceText, plotRight: plot.left + plot.width, expectedY: chart.priceToCoordinate(price, 0) };
    });
    (window as any).__axisPriceWatch = items.map(item => item.priceText);
    const stage = view.element.querySelector('.chart-stage').getBoundingClientRect();
    return { items, plotLeft: plot.left, plotRight: plot.left + plot.width, stage: [stage.left, stage.top] };
  });

  const coordinates = (record: any) => {
    const [left, top, width, height] = record.canvasRect;
    const [a, d, e, f] = record.transform;
    const [canvasWidth, canvasHeight] = record.canvas;
    return {
      ...record,
      screenXInChart: left + (record.x * a + e) / (canvasWidth / width) - tags.stage[0],
      screenYInChart: top + (record.y * d + f) / (canvasHeight / height) - tags.stage[1],
    };
  };
  for (const expected of tags.items) {
    await expect.poll(() => page.evaluate(text => (window as any).__axisPricePixels?.some((record: any) => record.value === text && record.strokeColorPixels >= 40) ?? false, expected.priceText)).toBe(true);
    const records = await page.evaluate(text => (window as any).__axisPricePixels?.filter((record: any) => record.value === text) ?? [], expected.priceText);
    const axisTag = records.map(coordinates).find((record: any) => record.screenXInChart > tags.plotRight && record.screenXInChart < tags.plotRight + 80 && record.strokeColorPixels >= 40);
    expect(axisTag, JSON.stringify(records.slice(-5))).toBeDefined();
    expect(Math.abs(axisTag.screenYInChart - expected.expectedY)).toBeLessThan(14);
  }
  // Capture the reference state with both colored prices visible, before the
  // suppression assertion below intentionally hides one drawing's native label.
  await page.screenshot({ path: 'artifacts/drawing-axis-price-tags-1366x768.png' });
  await page.evaluate(({ id, text }) => {
    (window as any).__axisPricePixels = [];
    const view = (window as any).__terminal.panels.values().next().value;
    view.engine.drawings.update(id, { style: { showLabels: false } });
  }, { id: tags.items[0].id, text: tags.items[0].priceText });
  await page.waitForTimeout(300);
  expect(await page.evaluate(text => (window as any).__axisPricePixels?.some((record: any) => record.value === text) ?? false, tags.items[0].priceText)).toBe(false);
});

import { launch, url } from './browser.mjs';

const browser = await launch(false);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(`${url}/?fixture=1&fixtureTime=now`);
  await page.waitForFunction(() => window.__terminal?.stats().panels.length === 2
    && window.__terminal.stats().panels.every(panel => panel.bars === 5000));
  await page.evaluate(() => window.__terminal.feed.send({ type: 'fixture', rate: 20 }));
  await page.waitForFunction(() => window.__terminal.stats().panels.every(panel => panel.status.state === 'live'));

  const chartId = await page.evaluate(() => [...window.__terminal.panels]
    .find(([, panel]) => panel.series.venue === 'binance')?.[0]);
  if (!chartId) throw new Error('The Binance fixture chart was not created.');
  await page.evaluate(id => window.__terminal.openEditor(id), chartId);
  await page.waitForSelector('.script-editor-panel');

  const library = page.getByRole('combobox', { name: 'Library' });
  const attachment = page.getByRole('combobox', { name: 'Attached study' });
  async function applyExample(id, title) {
    await library.selectOption(id);
    await attachment.selectOption('');
    await page.getByRole('button', { name: 'Preview inputs' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForFunction(({ id, title }) => {
      const chart = window.__terminal.panels.get(id);
      return chart?.studies?.views().some(view => view.title === title);
    }, { id: chartId, title });
  }

  await applyExample('builtin.ema-overlay', 'EMA overlay');
  await applyExample('builtin.volume-histogram', 'Volume');
  await applyExample('builtin.binance-depth-band', 'Binance depth band');
  await page.waitForFunction(id => {
    const view = window.__terminal.panels.get(id)?.studies?.views().find(study => study.title === 'Binance depth band');
    return view?.status.includes('Depth live') && Object.values(view.outputs).some(value => typeof value === 'number');
  }, chartId, { timeout: 30_000 });

  const editorScreenshots = [];
  const chartScreenshots = [];
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const editorPath = `artifacts/openscript-editor-${width}x${height}.png`;
    await page.screenshot({ path: editorPath });
    editorScreenshots.push(editorPath);

    await page.evaluate(id => window.__terminal.dock.getPanel(id)?.api.setActive(), chartId);
    await page.waitForTimeout(350);
    const chartPath = `artifacts/openscript-studies-${width}x${height}.png`;
    await page.screenshot({ path: chartPath });
    chartScreenshots.push(chartPath);

    await page.evaluate(id => window.__terminal.openEditor(id), chartId);
    await page.waitForTimeout(200);
  }

  const result = await page.evaluate(id => {
    const panel = window.__terminal.panels.get(id);
    return {
      fixture: window.__terminal.fixture,
      panel: id,
      studies: panel.studies.views().map(view => ({ title: view.title, status: view.status, outputs: view.outputs })),
      feedDepth: window.__terminal.feed.diagnostics.depth,
    };
  }, chartId);
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ editorScreenshots, chartScreenshots, errors, ...result }, null, 2));
} finally {
  await browser.close();
}

import { launch, url } from './browser.mjs';
import { writeFile } from 'node:fs/promises';

const browser = await launch(false);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__terminal?.stats().panels.some(panel => panel.series.venue === 'binance' && panel.bars > 0 && panel.status.state === 'live'), null, { timeout: 45_000 });
  const chart = page.locator('.candle-panel').filter({ has: page.getByRole('button', { name: 'Indicators' }) }).first();
  await chart.getByRole('button', { name: 'Indicators' }).click();
  await page.waitForSelector('.script-editor-panel');
  const editorGeometry = await page.evaluate(() => {
    const editor = document.querySelector('.script-editor-panel');
    const button = editor?.querySelector('[data-action="preview"]');
    const panel = editor?.closest('.dv-view') ?? editor?.parentElement;
    return { viewport: [innerWidth, innerHeight], editor: editor?.getBoundingClientRect().toJSON(), button: button?.getBoundingClientRect().toJSON(), panel: panel?.getBoundingClientRect().toJSON() };
  });
  console.log('editor geometry', JSON.stringify(editorGeometry));
  await page.screenshot({ path: 'artifacts/live-depth-editor-open.png' });
  await page.getByRole('combobox', { name: 'Library' }).selectOption('builtin.binance-depth-band');
  await page.getByRole('button', { name: 'Preview inputs' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(() => {
    const panel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
    return panel?.studies?.views().some(study => study.title === 'Binance depth band');
  }, null, { timeout: 15_000 });
  await page.screenshot({ path: 'artifacts/live-depth-editor.png' });
  await page.evaluate(() => {
    const id = [...window.__terminal.panels.entries()].find(([, panel]) => panel.series.venue === 'binance')?.[0];
    if (id) window.__terminal.dock.getPanel(id)?.api.setActive();
  });
  await page.waitForFunction(() => {
    const panel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
    const study = panel?.studies?.views().find(item => item.title === 'Binance depth band');
    return study?.status.includes('Depth live') && Object.values(study.outputs).some(value => typeof value === 'number');
  }, null, { timeout: 12_000 }).catch(() => undefined);
  const observationState = () => page.evaluate(() => {
    const livePanel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
    const diagnostics = livePanel.diagnostics();
    const study = livePanel.studies.views().find(item => item.title === 'Binance depth band');
    const band = [...livePanel.studies.bands.values()][0];
    const observations = band ? [...band.samples.values()].sort((a, b) => a.sampledAt - b.sampledAt) : [];
    const latest = observations.at(-1);
    return {
      sampleCount: observations.length,
      latestObservation: latest ? {
        sampledAt: latest.sampledAt, bandPercent: latest.bandPercent, mid: latest.mid,
        bidQuote: latest.bidQuote, askQuote: latest.askQuote,
        bidCovered: latest.bidCovered, askCovered: latest.askCovered,
      } : null,
      candle: {
        ...diagnostics.last,
        revision: livePanel.studies.candles.at(-1)?.revision ?? null,
        closed: livePanel.studies.candles.at(-1)?.closed ?? null,
      },
      outputs: study?.outputs ?? null,
      studyStatus: study?.status ?? null,
      depthTransport: window.__terminal.feed.diagnostics.depth,
    };
  });
  const beforeSamples = await observationState();
  await page.waitForTimeout(3_200);
  const afterSamples = await observationState();
  if (!beforeSamples.latestObservation || !afterSamples.latestObservation
    || afterSamples.sampleCount < beforeSamples.sampleCount + 2
    || afterSamples.latestObservation.sampledAt <= beforeSamples.latestObservation.sampledAt) {
    throw new Error(`Expected at least two newly sampled live depth observations; before=${JSON.stringify(beforeSamples)} after=${JSON.stringify(afterSamples)}`);
  }
  const normalBandProof = {
    bandPercent: 0.05,
    before: beforeSamples,
    after: afterSamples,
    newSamples: afterSamples.sampleCount - beforeSamples.sampleCount,
    outputChanged: JSON.stringify(beforeSamples.outputs) !== JSON.stringify(afterSamples.outputs),
  };
  if (!normalBandProof.outputChanged) throw new Error(`Expected worker study outputs to change with live depth samples; ${JSON.stringify(normalBandProof)}`);

  const binancePanelId = await page.evaluate(() => [...window.__terminal.panels.entries()].find(([, panel]) => panel.series.venue === 'binance')?.[0]);
  await page.evaluate(id => window.__terminal.openEditor(id), binancePanelId);
  await page.waitForSelector('.script-editor-panel');
  const attachment = page.getByRole('combobox', { name: 'Attached study' });
  const attachmentId = await attachment.locator('option').filter({ hasText: 'Binance depth band' }).getAttribute('value');
  if (!attachmentId) throw new Error('The live depth attachment is not available for a coverage probe.');
  await attachment.selectOption(attachmentId);
  const bandInput = page.locator('.script-inputs [data-input-key="iq_depth_band_pct_v1"]');
  await bandInput.fill('0.2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(() => {
    const panel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
    const view = panel?.studies?.views().find(item => item.title === 'Binance depth band');
    return view?.status.includes('0.20% band exceeds synchronized snapshot coverage');
  }, null, { timeout: 25_000 }).catch(() => undefined);
  const coverageProbe = await page.evaluate(() => {
    const panel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
    const study = panel.studies.views().find(item => item.title === 'Binance depth band');
    const band = [...panel.studies.bands.values()][0];
    const observation = band ? [...band.samples.values()].sort((a, b) => a.sampledAt - b.sampledAt).at(-1) : null;
    return { status: study?.status ?? null, outputs: study?.outputs ?? null, observation, depthTransport: window.__terminal.feed.diagnostics.depth };
  });
  if (!coverageProbe.status?.includes('0.20% band exceeds synchronized snapshot coverage')
    || !coverageProbe.observation || coverageProbe.observation.bandPercent !== 0.2
    || coverageProbe.observation.bidCovered || coverageProbe.observation.askCovered
    || Object.values(coverageProbe.outputs ?? {}).some(value => value !== null)) {
    throw new Error(`Expected the supported 0.20% band to report its actual incomplete snapshot coverage and null outputs: ${JSON.stringify(coverageProbe)}`);
  }
  await page.evaluate(id => window.__terminal.dock.getPanel(id)?.api.setActive(), binancePanelId);
  await page.screenshot({ path: 'artifacts/live-depth-coverage.png' });
  await page.evaluate(() => window.__terminal.feed.send({ type: 'diagnostics' }));
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => {
    const panels = window.__terminal.stats().panels;
    const panel = panels.find(item => item.series.venue === 'binance');
    const study = panel.studies.statuses[0];
      const livePanel = [...window.__terminal.panels.values()].find(item => item.series.venue === 'binance');
      const view = panel.studies.attached ? livePanel.studies.views()[0] : null;
      const band = [...livePanel.studies.bands.values()][0];
    return {
      mode: 'real public Binance USD-M depth; fixture disabled',
      fixture: window.__terminal.fixture,
      interval: panel.series.interval,
      candleStatus: panel.status,
      study: view,
      latestCandle: livePanel.studies.candles.at(-1),
      latestDepthBucket: band ? [...band.bucketed.entries()].at(-1) : null,
      latestDepthObservation: band ? [...band.samples.values()].at(-1) : null,
      depthTransport: window.__terminal.feed.diagnostics.depth,
      studyWorkerCount: panel.studies.workers,
      errors: [],
      workerCount: panel.studies.workers,
    };
  });
  result.sampleAdvancement = normalBandProof;
  result.coverageProbe = coverageProbe;
  result.browser = browser.version();
  result.errors = errors;
  result.capturedAt = new Date().toISOString();
  await page.screenshot({ path: 'artifacts/live-depth-study.png' });
  await writeFile('artifacts/live-depth-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

import { expect, test } from '@playwright/test';

/**
 * Locks the chart-engine contract before the terminal composes its own panes.
 * This imports the installed OpenAlgo 2.6 build in the browser and uses a real
 * Chart, rather than a mock IndicatorApi.
 */
test('OpenAlgo 2.6 keeps declared study-output dependencies live in a shared pane', async ({ page }) => {
  await page.goto('/?fixture=1');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite's optimized browser entry is available only in the browser dev server.
    const charts = await import(/* @vite-ignore */ '/node_modules/.vite/deps/openalgo-charts.js') as typeof import('openalgo-charts');
    const { createChart, registerIndicator, sourceValues } = charts;
    const host = document.createElement('div');
    Object.assign(host.style, { width: '900px', height: '560px', position: 'fixed', left: '-1200px', top: '0' });
    document.body.append(host);
    const chart = createChart(host, { renderer: 'canvas2d' });
    chart.addSeries('candlestick').setData(Array.from({ length: 8 }, (_, index) => ({
      time: 1_800_000_000 + index * 60, open: 100 + index, high: 102 + index,
      low: 99 + index, close: 101 + index, volume: 100 + index,
    })));

    // BTC volume is orders of magnitude below the fixture candle close. This
    // makes a mistaken fallback to OHLC visibly fail the dependency checks.
    let resultValues: (number | null)[] = Array.from({ length: 8 }, (_, index) => 0.004 + index * 0.002);
    let recomputeProducer: (() => void) | undefined;
    registerIndicator({
      id: 'test.worker-volume', name: 'Worker Volume', placement: 'pane', inputs: [],
      plots: [{ key: 'p0', type: 'histogram', title: 'Volume', priceScaleId: 'overlay:composition-volume' }],
      attach: context => { recomputeProducer = context.requestRecompute; },
      calc: bars => ({ p0: bars.map((_, index) => resultValues[index] ?? null) }),
    });
    registerIndicator({
      id: 'test.output-sma', name: 'Output SMA', placement: 'pane',
      inputs: [
        { key: 'source', type: 'source', label: 'Input', default: 'close', allowStudyOutputs: true },
        { key: 'length', type: 'number', label: 'Length', default: 3, min: 1, max: 250 },
      ],
      plots: [{ key: 'p0', type: 'line', title: 'SMA', priceScaleId: 'overlay:composition-volume' }],
      calc: (bars, settings, _store, context) => {
        const values = sourceValues(bars, settings.source as import('openalgo-charts').IndicatorSource | import('openalgo-charts').IndicatorStudySource, context);
        const period = Number(settings.length ?? 3);
        const output: (number | null)[] = [];
        for (let end = 0; end < values.length; end++) {
          const start = end - period + 1;
          const window = values.slice(Math.max(0, start), end + 1);
          output.push(start >= 0 && window.length === period && window.every(value => typeof value === 'number' && Number.isFinite(value))
          ? window.reduce<number>((sum, value) => sum + Number(value), 0) / period : null);
        }
        return { p0: output };
      },
    });
    registerIndicator({
      id: 'test.independent-units', name: 'Independent Units', placement: 'pane', inputs: [],
      plots: [
        { key: 'p0', type: 'line', title: 'Unspecified unit' },
        { key: 'p1', type: 'line', title: 'Second output' },
      ],
      fills: [{ between: ['p0', 'p1'], colorUp: '#00ff00', colorDown: '#ff0000', opacity: .15 }],
      calc: bars => ({ p0: bars.map((_, index) => index * 1000), p1: bars.map((_, index) => index * 900) }),
    });

    const volume = chart.addIndicator('test.worker-volume', {}, { paneIndex: chart.panes().length, instanceId: 'worker-volume-1' });
    const paneIndex = volume.paneIndex;
    const sma = chart.addIndicator('test.output-sma', {
      source: { kind: 'indicator', instanceId: volume.id, plotKey: 'p0' }, length: 3,
    }, {
      paneIndex,
      instanceId: 'output-sma-1',
      plotPriceScaleIds: { p0: 'overlay:composition-volume' },
    });
    const independent = chart.addIndicator('test.independent-units', {}, {
      paneIndex,
      instanceId: 'independent-units-1',
      plotPriceScaleIds: { p0: 'overlay:composition-independent', p1: 'overlay:composition-independent' },
    });
    const first = sma.values().p0?.slice() ?? [];
    const samePane = volume.paneIndex === sma.paneIndex;
    const scales = [volume.plotPriceScaleId('p0'), sma.plotPriceScaleId('p0'), independent.plotPriceScaleId('p0')];
    const smaSeries = sma.series('p0');
    const sharedPane = chart.panes()[paneIndex]!.element;

    // Change the output provider while preserving its plot identity, as the
    // OpenScript bridge does after a worker patch/correction.
    resultValues = resultValues.map((value, index) => typeof value === 'number' ? value * 2 : null);
    resultValues[4] = null;
    recomputeProducer?.();
    const replaced = sma.values().p0?.slice() ?? [];

    resultValues[7] = 0.4;
    recomputeProducer?.();
    const formingReplacement = sma.values().p0?.slice() ?? [];
    const smaValuesBeforeMove = sma.values().p0?.slice() ?? [];

    chart.moveIndicator(sma.id, chart.primaryPaneIndex());
    const movedToPrimary = sma.paneIndex === chart.primaryPaneIndex();
    const sameApiAfterMove = chart.indicators().find(item => item.id === sma.id) === sma;
    const sameSeriesAfterMove = sma.series('p0') === smaSeries;
    const sameValuesAfterMove = JSON.stringify(sma.values().p0) === JSON.stringify(smaValuesBeforeMove);
    const smaScaleAfterMove = sma.plotPriceScaleId('p0');
    chart.moveIndicator(sma.id, volume.paneIndex);
    const movedBackToCompositionPane = chart.panes()[sma.paneIndex]!.element === sharedPane;

    const secondPane = chart.addIndicator('test.worker-volume', {}, { paneIndex: chart.panes().length, instanceId: 'worker-volume-2' });
    chart.movePane(paneIndex, 1);
    const movedSmaPane = sma.paneIndex;
    const movedVolumePane = volume.paneIndex;
    const movedPaneIsShared = chart.panes()[movedSmaPane]!.element === sharedPane;
    volume.remove({ force: true });
    const panesAfterProducerRemoval = chart.panes().length;
    const consumerStillAttached = chart.indicators().some(item => item.id === sma.id);
    const consumerPaneAfterProducerRemoval = sma.paneIndex;
    const consumerRemainsOnSharedPane = chart.panes()[consumerPaneAfterProducerRemoval]!.element === sharedPane;
    independent.remove({ force: true });
    sma.remove({ force: true });
    const panesAfterConsumerRemoval = chart.panes().length;
    chart.destroy();
    host.remove();
    return {
      first, replaced, formingReplacement, samePane, scales,
      movedToPrimary, sameApiAfterMove, sameSeriesAfterMove, sameValuesAfterMove, smaScaleAfterMove, movedBackToCompositionPane,
      movedSmaPane, movedVolumePane, movedPaneIsShared,
      panesAfterProducerRemoval, consumerStillAttached, consumerPaneAfterProducerRemoval, consumerRemainsOnSharedPane,
      panesAfterConsumerRemoval,
    };
  });

  expect(result.samePane).toBe(true);
  expect(result.scales).toEqual(['overlay:composition-volume', 'overlay:composition-volume', 'overlay:composition-independent']);
  expect(result.first.slice(0, 2)).toEqual([null, null]);
  for (const [index, value] of [[2, 0.006], [3, 0.008], [4, 0.01], [5, 0.012], [6, 0.014], [7, 0.016]] as const) {
    expect(result.first[index]).toBeCloseTo(value, 8);
  }
  expect(result.replaced.slice(0, 2)).toEqual([null, null]);
  expect(result.replaced[2]).toBeCloseTo(0.012, 8);
  expect(result.replaced[3]).toBeCloseTo(0.016, 8);
  expect(result.replaced.slice(4, 7)).toEqual([null, null, null]);
  expect(result.replaced[7]).toBeCloseTo(0.032, 8);
  expect(result.formingReplacement.at(-1)).toBeCloseTo((0.028 + 0.032 + 0.4) / 3, 8);
  expect(result.movedToPrimary).toBe(true);
  expect(result.sameApiAfterMove).toBe(true);
  expect(result.sameSeriesAfterMove).toBe(true);
  expect(result.sameValuesAfterMove).toBe(true);
  expect(result.smaScaleAfterMove).toBe('overlay:composition-volume');
  expect(result.movedBackToCompositionPane).toBe(true);
  expect(result.movedSmaPane).toBe(result.movedVolumePane);
  expect(result.movedPaneIsShared).toBe(true);
  expect(result.panesAfterProducerRemoval).toBe(3);
  expect(result.consumerStillAttached).toBe(true);
  expect(result.consumerRemainsOnSharedPane).toBe(true);
  expect(result.panesAfterConsumerRemoval).toBe(2);
});

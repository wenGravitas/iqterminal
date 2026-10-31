import { expect, it } from 'vitest';
import { config } from '../src/panel';
import { DEFAULT_FOOTPRINT_TOTALS_SETTINGS, FOOTPRINT_TOTALS_ID, footprintTotalsSettings, NATIVE_DEFINITIONS } from '../src/indicators/model';

it('migrates existing candle panels and enables native Footprint only on supported Binance markets', () => {
  const legacy = config({ venue: 'binance', interval: '1m', type: 'candle' });
  expect(legacy).toMatchObject({ venue: 'binance', market: 'perpetual', type: 'candle', rowPrice: 25 });
  expect(config({ venue: 'binance', market: 'spot', interval: '1m', type: 'footprint' })).toMatchObject({ market: 'spot', type: 'footprint' });
  expect(config({ venue: 'hyperliquid', interval: '1m', type: 'footprint' })).toMatchObject({ venue: 'hyperliquid', type: 'candle' });
  expect(config({ venue: 'binance', market: 'perpetual', interval: '1m', type: 'footprint', rowTicks: 10 }).rowPrice).toBe(25);
  expect(config({ venue: 'binance', market: 'perpetual', interval: '1m', type: 'footprint', rowTicks: 20 }).rowPrice).toBe(2);
});

it('sanitizes corrupt settings and retains valid Footprint choices without mutating saved input', () => {
  const input = { venue: 'binance', market: 'perpetual', interval: '5m', type: 'footprint', rowPrice: 0.2,
    footprint: { displayMode: 'delta', cellStyle: 'profile', showPoc: false,
      showDiagonalImbalances: false, showValueArea: false, stackedImbalances: true, imbalanceRatio: 4, imbalanceThreshold: 0.02 } };
  const saved = structuredClone(input);
  expect(config(input)).toMatchObject(saved);
  expect(input).toEqual(saved);
  for (const rowPrice of [0, -1, 10_001, '10', NaN, Infinity]) {
    expect(config({ ...input, rowPrice }).rowPrice).toBe(25);
  }
  expect(config({ ...input, rowPrice: 1.5 }).rowPrice).toBe(1.5);
  expect(config({ ...input, rowPrice: 50 }).rowPrice).toBe(50);
  const invalid = config({ ...input, footprint: { displayMode: 'invented', cellStyle: 'heatmap', showPoc: 'false',
    showDiagonalImbalances: 1, stackedImbalances: 'yes', imbalanceRatio: Infinity, imbalanceThreshold: NaN } });
  expect(invalid.footprint).toEqual({ displayMode: 'bidask', cellStyle: 'ladder', statsPosition: 'bottom', opacity: .85, showCandle: true, showPoc: true, showValueArea: true,
    showDiagonalImbalances: true, stackedImbalances: false, imbalanceRatio: 3, imbalanceThreshold: 0.01 });
  expect(config({ ...input, footprint: { imbalanceThreshold: -1 } }).footprint.imbalanceThreshold).toBe(0);
  expect(config({ ...input, footprint: { imbalanceThreshold: 500 } }).footprint.imbalanceThreshold).toBe(10);
  expect(config({ ...input, type: 'other' }).type).toBe('candle');
});

it('canonicalizes equivalent floating point widths and aligns only against supplied exchange metadata', async () => {
  const { canonicalFootprintRowPrice, footprintTicksForPrice } = await import('../src/feed/protocol');
  expect(canonicalFootprintRowPrice(25.000000000000004)).toBe(25);
  expect(footprintTicksForPrice(25, 0.5)).toBe(50);
  expect(footprintTicksForPrice(0.3, 0.1)).toBe(3);
  expect(footprintTicksForPrice(25.05, 0.1)).toBeNull();
  expect(footprintTicksForPrice(25, 0)).toBeNull();
});

it('retains immutable study revision pins and independent input settings across chart modes', () => {
  const pin = { attachmentId: 'ema-a', scriptId: 'builtin:ema', revisionId: 'a'.repeat(64),
    title: 'EMA', description: 'Native candle EMA', settings: { length: 20 }, visible: true };
  const footprint = config({ venue: 'binance', market: 'perpetual', interval: '1m', type: 'footprint', studies: [pin] });
  const candle = config({ ...footprint, type: 'candle' });
  expect(candle.studies).toEqual([pin]);
  footprint.studies[0]!.settings.length = 40;
  expect(pin.settings.length).toBe(20);
  expect(candle.studies[0]!.settings.length).toBe(20);
});

it('preserves per-candle volume/delta statistics and defaults legacy or invalid choices to the table', () => {
  const c = config({ venue: 'binance', interval: '1m', type: 'footprint', footprint: { displayMode: 'bidask', cellStyle: 'profile', statsPosition: 'bar' } });
  expect(config(JSON.parse(JSON.stringify(c)))).toEqual(c);
  expect(c.footprint.statsPosition).toBe('bar');
  expect(config({ footprint: { statsPosition: 'invented' } }).footprint.statsPosition).toBe('bottom');
  expect(config({ type: 'footprint' }).footprint.statsPosition).toBe('bottom');
});

it('defaults the candle elapsed timer on for existing layouts and persists an explicit opt-out', () => {
  expect(config({}).candleElapsedTimer).toBe(true);
  expect(config({ candleElapsedTimer: 'false' }).candleElapsedTimer).toBe(true);
  const saved = config({ candleElapsedTimer: false, type: 'footprint' });
  expect(config(JSON.parse(JSON.stringify(saved))).candleElapsedTimer).toBe(false);
});

it('enables flips for new Footprint Totals instances while preserving the legacy saved appearance', () => {
  const definition = NATIVE_DEFINITIONS.find(item => item.id === FOOTPRINT_TOTALS_ID)!;
  expect(definition.defaults).toMatchObject(DEFAULT_FOOTPRINT_TOTALS_SETTINGS);
  expect(footprintTotalsSettings({ rows: ['delta'], highlightHighest: true })).toMatchObject({
    rows: ['delta'], highlightHighest: true, highlightDeltaFlips: false, deltaFlipLookback: 50,
    deltaFlipMinimumStrength: .25, showDeltaFlipLivePreview: true,
  });
  expect(footprintTotalsSettings({ highlightDeltaFlips: true, deltaFlipTarget: 'whole-column', deltaFlipLookback: 300,
    deltaFlipMinimumStrength: 1e8, showDeltaFlipLivePreview: false })).toMatchObject({
    highlightDeltaFlips: true, deltaFlipTarget: 'whole-column', deltaFlipLookback: 200,
    deltaFlipMinimumStrength: 1e8, showDeltaFlipLivePreview: false,
  });
});

it('bounds malformed Footprint Totals flip settings', () => {
  expect(footprintTotalsSettings({ deltaFlipTarget: 'invalid', deltaFlipLookback: Infinity,
    deltaFlipMinimumStrength: Infinity, showDeltaFlipLivePreview: 'false' })).toMatchObject({
    deltaFlipTarget: 'delta-cell', deltaFlipLookback: 50, deltaFlipMinimumStrength: .25, showDeltaFlipLivePreview: true,
  });
  expect(footprintTotalsSettings({ deltaFlipLookback: 19.9, deltaFlipMinimumStrength: -3 })).toMatchObject({
    deltaFlipLookback: 20, deltaFlipMinimumStrength: .25,
  });
});

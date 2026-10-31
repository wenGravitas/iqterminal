import { describe, expect, it } from 'vitest';
import {
  assessFootprintDeltaFlip,
  directFootprintAnalysisSummary,
  durableFootprintAnalysisSummary,
  MAX_FOOTPRINT_ANALYSIS_SUMMARIES,
  withoutLiveFootprintPreview,
  type FootprintAnalysisSummary,
} from '../src/chart/footprint-delta-flips';
import { footprintAnalysisSourceKey, type FootprintBar } from '../src/feed/protocol';

const options = { intervalMs: 60_000, units: 'btc' as const, lookback: 20, minimumStrength: .25, showLivePreview: true };
const timeAt = (index: number) => index * 60;

function summary(index: number, delta: number, overrides: Partial<FootprintAnalysisSummary> = {}): FootprintAnalysisSummary {
  return {
    time: timeAt(index), revision: 1, revisionSource: 'direct-accumulator', sourceKey: 'binance:perpetual:BTCUSDT:1m', delta,
    quoteDelta: delta * 100, coverage: 'observed', gapBefore: false, ended: true,
    completionSource: 'accepted-execution-time', previewEligible: false,
    coverageEvidence: { provenance: 'direct-feed', fromMs: timeAt(index) * 1000, toMs: (timeAt(index) + 60) * 1000,
      validated: true, complete: true, confirmedFromMs: 0, confirmedToMs: (timeAt(index) + 60) * 1000,
      gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null },
    ...overrides,
  };
}

function history(previousDelta = -5, currentDelta = 6, reference: (index: number) => number = () => 20) {
  const summaries = Array.from({ length: 22 }, (_, index) => summary(index, index < 20 ? reference(index) : index === 20 ? previousDelta : currentDelta));
  return summaries;
}

describe('Footprint Totals relative-strength delta flips', () => {
  it('keeps raw swing and median-relative strength separate for both directions', () => {
    const positive = assessFootprintDeltaFlip(history(), timeAt(21), options);
    expect(positive).toMatchObject({ kind: 'flip', direction: 'positive', previousDelta: -5, currentDelta: 6, rawSwing: 11, strength: .25, strengthBand: 'small', lifecycle: 'closed' });
    const strongPositive = assessFootprintDeltaFlip(history(-40, 60), timeAt(21), options);
    expect(strongPositive).toMatchObject({ rawSwing: 100, strength: 2, strengthBand: 'strong' });
    const strongNegative = assessFootprintDeltaFlip(history(60, -80), timeAt(21), options);
    expect(strongNegative).toMatchObject({ direction: 'negative', rawSwing: 140, strength: 3, strengthBand: 'strong' });
  });

  it('suppresses weak flips and does not grade a large-old, tiny-new flip as strong', () => {
    expect(assessFootprintDeltaFlip(history(-200, 2), timeAt(21), options)).toMatchObject({
      kind: 'flip', rawSwing: 202, strength: .1, strengthBand: 'below-minimum',
    });
    expect(assessFootprintDeltaFlip(history(-200, 2), timeAt(21), { ...options, minimumStrength: 0 }))
      .toMatchObject({ strength: .1, strengthBand: 'small' });
  });

  it('requires strict opposite nonzero signs and an exact adjacent predecessor', () => {
    expect(assessFootprintDeltaFlip(history(3, 4), timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'zero-or-same-sign' });
    expect(assessFootprintDeltaFlip(history(-3, 0), timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'zero-or-same-sign' });
    const missingPredecessor = history();
    missingPredecessor.splice(20, 1);
    expect(assessFootprintDeltaFlip(missingPredecessor, timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'ineligible-previous' });
    const wrongSource = history();
    wrongSource[20] = summary(20, -5, { sourceKey: 'binance:spot:BTCUSDT:1m' });
    expect(assessFootprintDeltaFlip(wrongSource, timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'source-changed' });
  });

  it('requires all exact reference slots, includes genuine zeroes and reports a zero median', () => {
    const missing = history(); missing.splice(7, 1);
    expect(assessFootprintDeltaFlip(missing, timeAt(21), options)).toMatchObject({
      kind: 'flip', strength: null, strengthBand: 'unavailable', unavailableReason: 'insufficient-history',
    });
    const zeroMedian = history(-5, 6, index => index < 19 ? 0 : 20);
    expect(assessFootprintDeltaFlip(zeroMedian, timeAt(21), options)).toMatchObject({
      kind: 'flip', strength: null, strengthBand: 'unavailable', unavailableReason: 'zero-baseline',
    });
    const unusableReference = history();
    unusableReference[8] = summary(8, 20, { coverage: 'gapped' });
    expect(assessFootprintDeltaFlip(unusableReference, timeAt(21), options)).toMatchObject({
      unavailableReason: 'insufficient-history',
    });
  });

  it('uses the full even-window median and ignores input ordering', () => {
    const ascending = history(-5, 6, index => index + 1).reverse();
    expect(assessFootprintDeltaFlip(ascending, timeAt(21), options)).toMatchObject({
      kind: 'flip', strength: 5 / 10.5, strengthBand: 'small',
    });
    const largeFinite = history(-2e307, 3e307, index => index % 2 ? 1.6e308 : 1.2e308);
    const largeScore = assessFootprintDeltaFlip(largeFinite, timeAt(21), { ...options, minimumStrength: 0 });
    expect(largeScore).toMatchObject({ kind: 'flip', strengthBand: 'small' });
    if (largeScore.kind === 'flip') expect(largeScore.strength).toBeCloseTo(1 / 7, 15);
  });

  it('uses actual quote deltas in USDT and rejects a missing quote projection', () => {
    const bars = history(-10, 10, () => 2);
    bars[0] = summary(0, 2, { quoteDelta: 100 });
    for (let index = 1; index < 20; index++) bars[index] = summary(index, 2, { quoteDelta: index * 10 });
    bars[20] = summary(20, -10, { quoteDelta: 100 });
    bars[21] = summary(21, 10, { quoteDelta: -50 });
    expect(assessFootprintDeltaFlip(bars, timeAt(21), options)).toMatchObject({ direction: 'positive', previousDelta: -10, currentDelta: 10 });
    expect(assessFootprintDeltaFlip(bars, timeAt(21), { ...options, units: 'usdt' })).toMatchObject({
      direction: 'negative', previousDelta: 100, currentDelta: -50, rawSwing: 150, strength: .5,
    });
    bars[21] = summary(21, 10, { quoteDelta: undefined });
    expect(assessFootprintDeltaFlip(bars, timeAt(21), { ...options, units: 'usdt' })).toMatchObject({ kind: 'none', reason: 'ineligible-current' });
  });

  it('allows preview only with explicit safe provenance and keeps completion separate', () => {
    const live = history();
    live[21] = summary(21, 6, { coverage: 'partial', ended: false, completionSource: 'unknown', previewEligible: true,
      coverageEvidence: { provenance: 'direct-feed', fromMs: timeAt(21) * 1000, toMs: (timeAt(21) + 60) * 1000,
        validated: true, complete: false, confirmedFromMs: 0, confirmedToMs: timeAt(21) * 1000 + 30_000,
        gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } });
    expect(assessFootprintDeltaFlip(live, timeAt(21), options)).toMatchObject({ kind: 'flip', lifecycle: 'live', strengthBand: 'small' });
    live[21] = summary(21, 6, { coverage: 'partial', ended: false, previewEligible: false,
      coverageEvidence: { provenance: 'direct-feed', fromMs: timeAt(21) * 1000, toMs: (timeAt(21) + 60) * 1000,
        validated: true, complete: false, confirmedFromMs: 0, confirmedToMs: timeAt(21) * 1000 + 30_000,
        gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } });
    expect(assessFootprintDeltaFlip(live, timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'ineligible-current' });
    live[21] = summary(21, 6, { coverage: 'partial', ended: false, previewEligible: false,
      coverageEvidence: { provenance: 'unknown', fromMs: timeAt(21) * 1000, toMs: (timeAt(21) + 60) * 1000,
        validated: false, complete: false, confirmedFromMs: null, confirmedToMs: null,
        gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } });
    expect(assessFootprintDeltaFlip(live, timeAt(21), options)).toMatchObject({ kind: 'none', reason: 'preview-provenance-unknown' });
    live[21] = summary(21, 6, { coverage: 'partial', ended: false, previewEligible: true,
      coverageEvidence: { provenance: 'direct-feed', fromMs: timeAt(21) * 1000, toMs: (timeAt(21) + 60) * 1000,
        validated: true, complete: false, confirmedFromMs: 0, confirmedToMs: timeAt(21) * 1000 + 30_000,
        gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } });
    expect(assessFootprintDeltaFlip(live, timeAt(21), { ...options, showLivePreview: false }))
      .toMatchObject({ kind: 'none', reason: 'preview-disabled' });
  });

  it('revises a live preview as delta weakens, disappears, returns, then becomes a closed flip', () => {
    const sourceKey = 'binance:perpetual:BTCUSDT:aggregate-trade:5m';
    const currentTime = 21 * 300;
    const live = (delta: number) => summary(21, delta, { time: currentTime, revisionSource: 'durable-accumulator', sourceKey,
      coverage: 'partial', ended: false, completionSource: 'unknown', previewEligible: true,
      coverageEvidence: { provenance: 'durable-stream', fromMs: currentTime * 1000, toMs: currentTime * 1000 + 300_000,
        validated: true, complete: false, confirmedFromMs: 0, confirmedToMs: currentTime * 1000 + 150_000,
        gapCount: 1, nonTailGapCount: 0, unconfirmedTailFromMs: currentTime * 1000 + 150_000 } });
    const history = Array.from({ length: 22 }, (_, index) => summary(index, index < 20 ? 20 : index === 20 ? -40 : 60,
      { time: index * 300, sourceKey }));
    const candidate = (current: FootprintAnalysisSummary) => assessFootprintDeltaFlip([...history.slice(0, 21), current], currentTime, { ...options, intervalMs: 300_000 });
    expect(candidate(live(60))).toMatchObject({ kind: 'flip', lifecycle: 'live', strength: 2, strengthBand: 'strong' });
    expect(candidate(live(4))).toMatchObject({ kind: 'flip', lifecycle: 'live', strength: .2, strengthBand: 'below-minimum' });
    expect(candidate(live(-5))).toMatchObject({ kind: 'none', reason: 'zero-or-same-sign' });
    expect(candidate(live(60))).toMatchObject({ kind: 'flip', lifecycle: 'live', strengthBand: 'strong' });
    const closed = { ...history[21]!, time: currentTime, revisionSource: 'durable-accumulator' as const, sourceKey,
      coverage: 'observed' as const, ended: true, completionSource: 'durable-watermark' as const, previewEligible: false,
      coverageEvidence: { provenance: 'durable-stream' as const, fromMs: currentTime * 1000, toMs: currentTime * 1000 + 300_000,
        validated: true, complete: true, confirmedFromMs: 0, confirmedToMs: currentTime * 1000 + 300_000,
        gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } };
    expect(candidate(closed)).toMatchObject({ kind: 'flip', lifecycle: 'closed', strength: 2, strengthBand: 'strong' });
  });

  it('keeps the documented summary-retention contract bounded', () => {
    expect(MAX_FOOTPRINT_ANALYSIS_SUMMARIES).toBe(512);
  });

  it('uses one semantic source key for durable, prepared and direct aggTrade data', () => {
    expect(footprintAnalysisSourceKey('perpetual', '1m')).toBe('binance:perpetual:BTCUSDT:aggregate-trade:1m');
    expect(footprintAnalysisSourceKey('spot', '5m')).toBe('binance:spot:BTCUSDT:aggregate-trade:5m');
  });

  it('allows durable preview only for the fresh tail of the current forming candle', () => {
    const fromMs = 60_000, toMs = fromMs + 60_000, now = fromMs + 42_000;
    const current = { ...summary(1, 4), coverage: 'partial' as const, ended: false,
      completionSource: 'unknown' as const, previewEligible: false } as unknown as FootprintBar;
    const coverage = { confirmedFrom: 0, confirmedTo: fromMs + 30_000,
      gaps: [{ from: fromMs + 30_000, to: now, reason: 'not yet confirmed by durable execution watermark' }] };
    const preview = durableFootprintAnalysisSummary(current, 'binance:perpetual:BTCUSDT:aggregate-trade:1m', '1m', coverage, now - 1000, true, now);
    expect(preview.previewEligible).toBe(true);
    expect(durableFootprintAnalysisSummary(current, preview.sourceKey, '1m', coverage, now - 1000, true, now, false).previewEligible).toBe(false);
    const expired = durableFootprintAnalysisSummary(current, preview.sourceKey, '1m', coverage, now - 1000, true, toMs + 1);
    expect(expired).toMatchObject({ ended: false, previewEligible: false });
  });

  it('keeps closed durable summary versions stable as the global watermark advances', () => {
    const closed = { ...summary(1, 7), coverage: 'observed' as const } as unknown as FootprintBar;
    const source = footprintAnalysisSourceKey('perpetual', '1m');
    const first = durableFootprintAnalysisSummary(closed, source, '1m', { confirmedFrom: 0, confirmedTo: 300_000, gaps: [] }, 300_000, true, 300_000);
    const later = durableFootprintAnalysisSummary(closed, source, '1m', { confirmedFrom: 0, confirmedTo: 600_000, gaps: [] }, 600_000, true, 600_000);
    expect(later).toEqual(first);
  });

  it('does not let exchange event time falsely close a direct bar and revokes previews on status loss', () => {
    const fromMs = 60_000, toMs = fromMs + 60_000;
    const bar = { ...summary(1, 5), time: 60, coverage: 'observed' as const } as unknown as FootprintBar;
    const status = { state: 'live' as const, message: 'live', lastUpdate: fromMs + 40_000,
      collectionStartedAt: 0, firstTradeAt: fromMs, lastTradeAt: fromMs + 35_000,
      eventTime: toMs + 10_000, coverage: 'partial' as const } as any;
    const live = directFootprintAnalysisSummary(bar, footprintAnalysisSourceKey('perpetual', '1m'), '1m', status, fromMs + 40_000);
    expect(live).toMatchObject({ ended: false, previewEligible: true });
    const stale = withoutLiveFootprintPreview(live);
    expect(stale).toMatchObject({ ended: false, previewEligible: false });
    expect(directFootprintAnalysisSummary(bar, live.sourceKey, '1m', status, toMs).previewEligible).toBe(false);
  });

  it('only direct accepted trade time proves a completed interval', () => {
    const fromMs = 60_000, toMs = fromMs + 60_000;
    const bar = { ...summary(1, 5), time: 60, coverage: 'observed' as const } as unknown as FootprintBar;
    const status = { state: 'live' as const, message: 'live', lastUpdate: toMs + 5_000,
      collectionStartedAt: 0, firstTradeAt: fromMs, lastTradeAt: toMs + 1,
      eventTime: toMs + 50_000, coverage: 'partial' as const } as any;
    const closed = directFootprintAnalysisSummary(bar, footprintAnalysisSourceKey('perpetual', '1m'), '1m', status, toMs + 5_000);
    expect(closed).toMatchObject({ ended: true, completionSource: 'accepted-execution-time', coverageEvidence: { complete: true, confirmedToMs: toMs } });
  });
});

import type { FootprintUnits } from './footprint-units';
import type { FootprintAnalysisSummary, FootprintBar, FootprintCoverageEvidence, FootprintStatus, Interval } from '../feed/protocol';
export type { FootprintAnalysisSummary } from '../feed/protocol';

export const MAX_FOOTPRINT_ANALYSIS_SUMMARIES = 512;
export const MIN_DELTA_FLIP_LOOKBACK = 20;
export const MAX_DELTA_FLIP_LOOKBACK = 200;
export const DEFAULT_DELTA_FLIP_LOOKBACK = 50;
export const DEFAULT_DELTA_FLIP_MINIMUM_STRENGTH = 0.25;
const UNCONFIRMED_TAIL_REASON = 'not yet confirmed by durable execution watermark';

export type DeltaFlipStrengthBand = 'unavailable' | 'below-minimum' | 'small' | 'medium' | 'strong';
export type DeltaFlipStrengthUnavailableReason = 'insufficient-history' | 'zero-baseline' | 'unit-unavailable';

export type DeltaFlipAssessment =
  | { kind: 'none'; reason: 'missing-candidate' | 'ineligible-current' | 'ineligible-previous' | 'not-adjacent' | 'source-changed' | 'zero-or-same-sign' | 'preview-disabled' | 'preview-provenance-unknown' }
  | {
    kind: 'flip'; time: number; previousTime: number; direction: 'positive' | 'negative';
    previousDelta: number; currentDelta: number; rawSwing: number;
    strength: number | null; strengthBand: DeltaFlipStrengthBand;
    unavailableReason?: DeltaFlipStrengthUnavailableReason;
    lifecycle: 'closed' | 'live';
  };

export interface DeltaFlipAnalysisOptions {
  intervalMs: number;
  units: FootprintUnits;
  lookback: number;
  minimumStrength: number;
  showLivePreview: boolean;
}

interface CachedReferenceBaseline {
  lookback: number;
  units: FootprintUnits;
  value: { baseline: number | null; unavailableReason?: DeltaFlipStrengthUnavailableReason };
}
/** Caller invalidates candidates whose fixed reference window contains a changed summary. */
export interface DeltaFlipBaselineCache { entries: Map<number, CachedReferenceBaseline>; evaluations: number }

/** Convert direct live bars using accepted execution time as completion evidence. */
export function directFootprintAnalysisSummary(
  bar: FootprintBar,
  sourceKey: string,
  interval: Interval,
  status: FootprintStatus,
  now = Date.now(),
): FootprintAnalysisSummary {
  const fromMs = bar.time * 1000, toMs = fromMs + intervalMs(interval);
  const acceptedTradeTime = Number.isFinite(status.lastTradeAt) ? status.lastTradeAt! : null;
  const startedAt = Number.isFinite(status.collectionStartedAt) ? status.collectionStartedAt! : null;
  // Exchange event time (E) can cross a candle boundary before the accepted
  // trade time (T). Only T proves that this accumulator has seen the next bar.
  const observedThrough = acceptedTradeTime;
  const ended = observedThrough !== null && observedThrough >= toMs;
  const rawCoverage = status.coverage === 'unclassified' ? 'unknown' : bar.coverage;
  const gapCount = bar.gapBefore || bar.coverage === 'gapped' ? 1 : 0;
  const complete = ended && startedAt !== null && startedAt <= fromMs && bar.coverage === 'observed' && !bar.gapBefore;
  const previewEligible = !ended && now >= fromMs && now < toMs && status.state === 'live' && now - status.lastUpdate <= 15_000
    && startedAt !== null && startedAt <= fromMs && observedThrough !== null && observedThrough >= fromMs && observedThrough < toMs
    && bar.coverage === 'observed' && !bar.gapBefore;
  const coverageEvidence: FootprintCoverageEvidence = {
    provenance: 'direct-feed', fromMs, toMs, complete,
    validated: true,
    confirmedFromMs: startedAt, confirmedToMs: observedThrough === null ? null : Math.min(toMs, observedThrough),
    gapCount, nonTailGapCount: gapCount, unconfirmedTailFromMs: null,
  };
  return { time: bar.time, revision: bar.revision, sourceKey, delta: bar.delta,
    revisionSource: 'direct-accumulator',
    ...(Number.isFinite(bar.quoteDelta) ? { quoteDelta: bar.quoteDelta } : {}), coverage: rawCoverage,
    gapBefore: bar.gapBefore, ended, completionSource: ended ? 'accepted-execution-time' : 'unknown',
    previewEligible, coverageEvidence };
}

/** Project one prepared tile immediately; no price-level cells are retained in the result. */
export function preparedFootprintAnalysisSummary(
  bar: FootprintBar,
  rawCoverage: unknown,
  sourceKey: string,
  interval: Interval,
  validated = true,
  now = Date.now(),
): FootprintAnalysisSummary {
  const fromMs = bar.time * 1000, toMs = fromMs + intervalMs(interval);
  const evidence = readPreparedCoverage(rawCoverage, fromMs, toMs);
  if (!evidence) return unknownSummary(bar, sourceKey, fromMs, toMs, 'prepared-tile');
  const tailGaps = evidence.gaps.filter(gap => gap.reason === UNCONFIRMED_TAIL_REASON);
  const otherGaps = evidence.gaps.filter(gap => gap.reason !== UNCONFIRMED_TAIL_REASON);
  const tail = tailGaps.length === 1 ? tailGaps[0] : null;
  const ended = tailGaps.length === 0;
  const complete = evidence.complete && evidence.gaps.length === 0 && bar.coverage === 'observed' && !bar.gapBefore;
  const previewEligible = !complete && now >= fromMs && now < toMs && bar.coverage === 'partial' && !bar.gapBefore
    && otherGaps.length === 0 && tailGaps.length === 1 && tail!.from > fromMs && tail!.to >= toMs;
  const coverage: FootprintAnalysisSummary['coverage'] = bar.coverage === 'capacity-limited' ? 'capacity-limited'
    : bar.coverage === 'gapped' || otherGaps.length > 0 || bar.gapBefore ? 'gapped'
    : complete ? 'observed' : previewEligible || evidence.gaps.length > 0 ? 'partial' : 'unknown';
  const coverageEvidence: FootprintCoverageEvidence = {
    provenance: 'prepared-tile', fromMs, toMs, validated, complete,
    confirmedFromMs: earliestObservedFrom(fromMs, evidence.gaps), confirmedToMs: tail ? tail.from : ended ? toMs : null,
    gapCount: evidence.gaps.length, nonTailGapCount: otherGaps.length,
    unconfirmedTailFromMs: tail?.from ?? null,
  };
  return { time: bar.time, revision: bar.revision, revisionSource: 'prepared-content-hash', sourceKey, delta: bar.delta,
    ...(Number.isFinite(bar.quoteDelta) ? { quoteDelta: bar.quoteDelta } : {}), coverage,
    gapBefore: bar.gapBefore, ended, completionSource: ended ? 'durable-watermark' : 'unknown',
    previewEligible, coverageEvidence };
}

function intervalMs(interval: Interval) {
  return ({ '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 } as const)[interval];
}

function readPreparedCoverage(value: unknown, fromMs: number, toMs: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.from !== fromMs || raw.to !== toMs || typeof raw.complete !== 'boolean' || !Array.isArray(raw.gaps) || raw.gaps.length > 512) return null;
  const gaps: Array<{ from: number; to: number; reason: string }> = [];
  for (const item of raw.gaps) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const gap = item as Record<string, unknown>;
    if (!Number.isSafeInteger(gap.from) || !Number.isSafeInteger(gap.to) || (gap.from as number) >= (gap.to as number)
      || typeof gap.reason !== 'string' || gap.reason.length > 1000) return null;
    // Prepared tile gaps are clipped to that candle's time bounds.
    if ((gap.from as number) < fromMs || (gap.to as number) > toMs) return null;
    gaps.push({ from: gap.from as number, to: gap.to as number, reason: gap.reason });
  }
  return { complete: raw.complete, gaps };
}

function earliestObservedFrom(fromMs: number, gaps: readonly { from: number; to: number; reason: string }[]) {
  const unavailable = gaps.filter(gap => gap.reason === 'not retained/recorded');
  return unavailable.length ? Math.max(fromMs, ...unavailable.map(gap => gap.to)) : fromMs;
}

function unknownSummary(bar: FootprintBar, sourceKey: string, fromMs: number, toMs: number, provenance: FootprintCoverageEvidence['provenance']): FootprintAnalysisSummary {
  return { time: bar.time, revision: bar.revision, revisionSource: 'unknown', sourceKey, delta: bar.delta,
    ...(Number.isFinite(bar.quoteDelta) ? { quoteDelta: bar.quoteDelta } : {}), coverage: 'unknown',
    gapBefore: bar.gapBefore, ended: false, completionSource: 'unknown', previewEligible: false,
    coverageEvidence: { provenance, fromMs, toMs, validated: false, complete: false, confirmedFromMs: null, confirmedToMs: null,
      gapCount: 0, nonTailGapCount: 0, unconfirmedTailFromMs: null } };
}

/** Durable stream provenance is capped at the locally applied cursor while catch-up is in progress. */
export function durableFootprintAnalysisSummary(
  bar: FootprintBar,
  sourceKey: string,
  interval: Interval,
  rawCoverage: unknown,
  appliedThroughMs: number,
  caughtUp: boolean,
  now = Date.now(),
  allowPreview = true,
): FootprintAnalysisSummary {
  const fromMs = bar.time * 1000, toMs = fromMs + intervalMs(interval);
  if (!rawCoverage || typeof rawCoverage !== 'object' || Array.isArray(rawCoverage)) return unknownSummary(bar, sourceKey, fromMs, toMs, 'durable-stream');
  const coverage = rawCoverage as Record<string, unknown>;
  const confirmedFrom = Number.isSafeInteger(coverage.confirmedFrom) ? coverage.confirmedFrom as number : null;
  const globalTo = Number.isSafeInteger(coverage.confirmedTo) ? coverage.confirmedTo as number : null;
  const confirmedTo = caughtUp ? globalTo : Math.min(globalTo ?? appliedThroughMs, appliedThroughMs);
  if (confirmedFrom === null || confirmedTo === null || !Array.isArray(coverage.gaps) || coverage.gaps.length > 512) {
    return unknownSummary(bar, sourceKey, fromMs, toMs, 'durable-stream');
  }
  const gaps: Array<{ from: number; to: number; reason: string }> = [];
  for (const item of coverage.gaps) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return unknownSummary(bar, sourceKey, fromMs, toMs, 'durable-stream');
    const gap = item as Record<string, unknown>;
    if (!Number.isSafeInteger(gap.from) || !Number.isSafeInteger(gap.to) || (gap.from as number) >= (gap.to as number)
      || typeof gap.reason !== 'string' || gap.reason.length > 1000) return unknownSummary(bar, sourceKey, fromMs, toMs, 'durable-stream');
    gaps.push({ from: gap.from as number, to: gap.to as number, reason: gap.reason });
  }
  const overlaps = gaps.filter(gap => gap.to > fromMs && gap.from < toMs);
  const tailGaps = overlaps.filter(gap => gap.reason === UNCONFIRMED_TAIL_REASON);
  const otherGaps = overlaps.filter(gap => gap.reason !== UNCONFIRMED_TAIL_REASON);
  const tail = tailGaps.length === 1 ? tailGaps[0] : null;
  const ended = toMs <= confirmedTo;
  // Once a candle's end is confirmed, later global watermark advances carry
  // no new evidence for that candle and should not change its summary version.
  const summaryConfirmedTo = Number.isFinite(confirmedTo) ? Math.min(confirmedTo, toMs) : confirmedTo;
  const complete = ended && fromMs >= confirmedFrom && !overlaps.length
    && bar.coverage === 'observed' && !bar.gapBefore;
  // Durable coverage reports the unconfirmed tail only through its observation
  // horizon (usually server Date.now()), not through the candle's future end.
  // Permit a fresh horizon for the currently forming interval only.
  const freshTailHorizon = tail !== null && tail.to >= now - 15_000 && tail.to <= now + 1_000;
  const previewEligible = allowPreview && caughtUp && !ended && now >= fromMs && now < toMs && fromMs >= confirmedFrom
    && bar.coverage === 'partial' && !bar.gapBefore && otherGaps.length === 0
    && tailGaps.length === 1 && tail!.from > fromMs && tail!.from <= tail!.to && freshTailHorizon;
  const normalizedCoverage: FootprintAnalysisSummary['coverage'] = bar.coverage === 'capacity-limited' ? 'capacity-limited'
    : bar.coverage === 'gapped' || otherGaps.length > 0 || bar.gapBefore ? 'gapped'
    : complete ? 'observed' : bar.coverage === 'partial' || tailGaps.length > 0 ? 'partial' : 'unknown';
  const coverageEvidence: FootprintCoverageEvidence = {
    provenance: 'durable-stream', fromMs, toMs, validated: true, complete,
    confirmedFromMs: confirmedFrom, confirmedToMs: summaryConfirmedTo,
    gapCount: overlaps.length, nonTailGapCount: otherGaps.length,
    unconfirmedTailFromMs: caughtUp ? tail?.from ?? null : null,
  };
  return { time: bar.time, revision: bar.revision, revisionSource: 'durable-accumulator', sourceKey, delta: bar.delta,
    ...(Number.isFinite(bar.quoteDelta) ? { quoteDelta: bar.quoteDelta } : {}), coverage: normalizedCoverage,
    gapBefore: bar.gapBefore, ended, completionSource: ended ? caughtUp ? 'durable-watermark' : 'applied-cursor' : 'unknown',
    previewEligible, coverageEvidence };
}

/** Status-only loss or an interval boundary may revoke a preview, never close a bar. */
export function withoutLiveFootprintPreview(summary: FootprintAnalysisSummary): FootprintAnalysisSummary {
  return !summary.ended && summary.previewEligible ? { ...summary, previewEligible: false } : summary;
}

/**
 * Assess one candle against its exact predecessor and the full pre-pair window.
 * Caller owns invalidation and caching; this function has no DOM or feed state.
 */
export function assessFootprintDeltaFlip(
  summaries: readonly FootprintAnalysisSummary[],
  time: number,
  options: DeltaFlipAnalysisOptions,
): DeltaFlipAssessment {
  return createFootprintDeltaFlipAnalyzer(summaries)(time, options);
}

/** Reuse the bounded timestamp index when assessing several visible candles. */
export function createFootprintDeltaFlipAnalyzer(summaries: readonly FootprintAnalysisSummary[]) {
  const byTime = new Map<number, FootprintAnalysisSummary>();
  for (const summary of summaries) {
    if (!Number.isSafeInteger(summary.time)) continue;
    const existing = byTime.get(summary.time);
    if (!existing || summary.revision >= existing.revision) byTime.set(summary.time, summary);
  }
  return (time: number, options: DeltaFlipAnalysisOptions, cache?: DeltaFlipBaselineCache): DeltaFlipAssessment => assessIndexed(byTime, time, options, cache);
}

function assessIndexed(
  byTime: ReadonlyMap<number, FootprintAnalysisSummary>,
  time: number,
  options: DeltaFlipAnalysisOptions,
  cache?: DeltaFlipBaselineCache,
): DeltaFlipAssessment {
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
    return { kind: 'none', reason: 'missing-candidate' };
  }
  const lookback = boundedLookback(options.lookback);
  const minimum = Number.isFinite(options.minimumStrength) && options.minimumStrength >= 0
    ? options.minimumStrength : DEFAULT_DELTA_FLIP_MINIMUM_STRENGTH;
  const step = options.intervalMs / 1000;
  const current = byTime.get(time);
  if (!current) return { kind: 'none', reason: 'missing-candidate' };
  const currentDelta = deltaFor(current, options.units);
  const currentLifecycle: 'closed' | 'live' = current.ended ? 'closed' : 'live';
  if (current.ended) {
    if (!isCompletedUsable(current) || currentDelta === null) return { kind: 'none', reason: 'ineligible-current' };
  } else {
    if (!options.showLivePreview) return { kind: 'none', reason: 'preview-disabled' };
    if (!isPreviewUsable(current) || currentDelta === null) {
      if (current.coverageEvidence.provenance === 'unknown' || !current.coverageEvidence.validated) return { kind: 'none', reason: 'preview-provenance-unknown' };
      return { kind: 'none', reason: 'ineligible-current' };
    }
  }

  const previousTime = time - step;
  const previous = byTime.get(previousTime);
  if (!previous) return { kind: 'none', reason: 'ineligible-previous' };
  if (previous.sourceKey !== current.sourceKey) return { kind: 'none', reason: 'source-changed' };
  if (!isCompletedUsable(previous)) return { kind: 'none', reason: 'ineligible-previous' };
  const previousDelta = deltaFor(previous, options.units);
  if (previousDelta === null) return { kind: 'none', reason: 'ineligible-previous' };
  if (current.time - previous.time !== step) return { kind: 'none', reason: 'not-adjacent' };
  if (previousDelta === 0 || currentDelta === null || currentDelta === 0 || Math.sign(previousDelta) === Math.sign(currentDelta)) {
    return { kind: 'none', reason: 'zero-or-same-sign' };
  }

  const rawSwing = Math.abs(currentDelta - previousDelta);
  const base = {
    kind: 'flip' as const, time, previousTime, direction: currentDelta > 0 ? 'positive' as const : 'negative' as const,
    previousDelta, currentDelta, rawSwing, lifecycle: currentLifecycle,
  };
  if (!Number.isFinite(rawSwing)) return { ...base, strength: null, strengthBand: 'unavailable', unavailableReason: 'unit-unavailable' };

  let cached = cache?.entries.get(time);
  if (cached && (cached.lookback !== lookback || cached.units !== options.units)) { cache!.entries.delete(time); cached = undefined; }
  if (!cached) {
    const result = referenceBaseline(byTime, current, time, lookback, step, options.units);
    cached = { lookback, units: options.units, value: result };
    if (cache) {
      cache.evaluations++;
      cache.entries.delete(time); cache.entries.set(time, cached);
      while (cache.entries.size > MAX_FOOTPRINT_ANALYSIS_SUMMARIES) cache.entries.delete(cache.entries.keys().next().value!);
    }
  } else if (cache) {
    cache.entries.delete(time); cache.entries.set(time, cached);
  }
  const { baseline } = cached.value;
  if (cached.value.unavailableReason) return { ...base, strength: null, strengthBand: 'unavailable', unavailableReason: cached.value.unavailableReason };
  if (baseline === null) return { ...base, strength: null, strengthBand: 'unavailable', unavailableReason: 'insufficient-history' };
  const strength = Math.min(Math.abs(previousDelta), Math.abs(currentDelta)) / baseline;
  if (!Number.isFinite(strength)) {
    return { ...base, strength: null, strengthBand: 'unavailable', unavailableReason: 'unit-unavailable' };
  }
  const strengthBand: DeltaFlipStrengthBand = strength < minimum ? 'below-minimum'
    : strength < 1 ? 'small' : strength < 2 ? 'medium' : 'strong';
  return { ...base, strength, strengthBand };
}

function referenceBaseline(
  byTime: ReadonlyMap<number, FootprintAnalysisSummary>, current: FootprintAnalysisSummary,
  time: number, lookback: number, step: number, units: FootprintUnits,
): CachedReferenceBaseline['value'] {
  const reference: number[] = [];
  for (let offset = lookback + 1; offset >= 2; offset--) {
    const slot = byTime.get(time - offset * step);
    if (!slot || slot.sourceKey !== current.sourceKey || !isCompletedUsable(slot)) return { baseline: null, unavailableReason: 'insufficient-history' };
    const value = deltaFor(slot, units);
    if (value === null) return { baseline: null, unavailableReason: 'unit-unavailable' };
    reference.push(Math.abs(value));
  }
  if (reference.length !== lookback) return { baseline: null, unavailableReason: 'insufficient-history' };
  reference.sort((a, b) => a - b);
  const middle = Math.floor(reference.length / 2);
  const baseline = reference.length % 2 ? reference[middle]! : reference[middle - 1]! / 2 + reference[middle]! / 2;
  if (!Number.isFinite(baseline) || baseline <= 0) return { baseline: null, unavailableReason: 'zero-baseline' };
  return { baseline };
}

function isCompletedUsable(bar: FootprintAnalysisSummary) {
  const evidence = bar.coverageEvidence;
  return bar.ended && bar.completionSource !== 'unknown' && bar.coverage === 'observed' && !bar.gapBefore
    && evidence.provenance !== 'unknown' && evidence.validated && evidence.complete && evidence.gapCount === 0;
}

function isPreviewUsable(bar: FootprintAnalysisSummary) {
  const evidence = bar.coverageEvidence;
  if (bar.ended || !bar.previewEligible || !['observed', 'partial'].includes(bar.coverage) || bar.gapBefore || evidence.provenance === 'unknown' || !evidence.validated) return false;
  if (evidence.provenance === 'direct-feed') {
    return evidence.gapCount === 0 && evidence.confirmedFromMs !== null && evidence.confirmedFromMs <= evidence.fromMs
      && evidence.confirmedToMs !== null && evidence.confirmedToMs >= evidence.fromMs && evidence.confirmedToMs < evidence.toMs;
  }
  return evidence.gapCount === 1 && evidence.nonTailGapCount === 0 && evidence.unconfirmedTailFromMs !== null
    && evidence.unconfirmedTailFromMs > evidence.fromMs && evidence.unconfirmedTailFromMs < evidence.toMs;
}

function deltaFor(bar: FootprintAnalysisSummary, units: FootprintUnits): number | null {
  const value = units === 'btc' ? bar.delta : bar.quoteDelta;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boundedLookback(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DELTA_FLIP_LOOKBACK;
  return Math.max(MIN_DELTA_FLIP_LOOKBACK, Math.min(MAX_DELTA_FLIP_LOOKBACK, Math.trunc(value)));
}

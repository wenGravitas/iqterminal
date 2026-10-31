export const RAW_OPEN_INTEREST_VENUES = ['binance', 'hyperliquid', 'bybit'] as const;
export type RawOpenInterestVenue = typeof RAW_OPEN_INTEREST_VENUES[number];

export interface RawOpenInterestObservation {
  venue: RawOpenInterestVenue;
  market: 'perpetual';
  nativeSymbol: 'BTCUSDT' | 'BTC';
  sourceTimeMs: number;
  observedAtMs: number;
  epoch: number;
  value: number;
  valueDecimal: string;
  units: string;
  source: string;
  sourceTimeQuality: string;
  quality: string;
  gapBefore: boolean;
}

export interface RawOpenInterestUnitVerification {
  status: 'verified' | 'inferred' | 'unverified';
  units?: string;
  evidence?: string;
  sources?: string[];
}

export interface RawOpenInterestFeedStatus {
  state: string;
  source?: string | null;
  lastError?: string | null;
  lastObservedAt?: number | null;
  expectedIntervalMs: number;
  stale: boolean;
  unitVerification?: RawOpenInterestUnitVerification;
}

export interface RawOpenInterestPayload {
  version: 1;
  market: 'perpetual';
  nativeSymbol: 'BTC';
  semantics: 'observed-open-interest-level';
  units: 'BTC';
  from: number;
  to: number;
  asOfMs: number;
  venues: RawOpenInterestVenue[];
  unitVerification: Partial<Record<RawOpenInterestVenue, RawOpenInterestUnitVerification>>;
  observations: RawOpenInterestObservation[];
  truncated: boolean;
  invalidRows: number;
  expectedIntervalMs: number;
  retentionDays: number;
  feeds: Partial<Record<RawOpenInterestVenue, RawOpenInterestFeedStatus>>;
  history: string;
}

export type RawOpenInterestRequest = { venues: RawOpenInterestVenue[] };
export type RawOpenInterestEvent =
  | { type: 'raw-open-interest-snapshot'; ids: string[]; payload: RawOpenInterestPayload }
  | { type: 'raw-open-interest-patch'; ids: string[]; payload: Omit<RawOpenInterestPayload, 'observations'> & { observations: RawOpenInterestObservation[]; removeBefore: number } }
  | { type: 'raw-open-interest-error'; ids: string[]; message: string; at: number };

export const RAW_OPEN_INTEREST_MAX_AGE_MS = 75_000;
export const RAW_OPEN_INTEREST_MAX_RANGE_MS = 4 * 60 * 60_000;
export const RAW_OPEN_INTEREST_MAX_OBSERVATIONS = 2_000;

export function compatibleRawOpenInterestVenues(value: unknown): RawOpenInterestVenue[] {
  const selected = new Set(Array.isArray(value) ? value : RAW_OPEN_INTEREST_VENUES);
  return RAW_OPEN_INTEREST_VENUES.filter(venue => selected.has(venue));
}

export function validateRawOpenInterestPayload(value: unknown, requested: readonly RawOpenInterestVenue[], from: number, to: number): RawOpenInterestPayload {
  if (!isRecord(value) || value.version !== 1 || value.market !== 'perpetual' || value.nativeSymbol !== 'BTC'
    || value.semantics !== 'observed-open-interest-level' || value.units !== 'BTC'
    || !Number.isSafeInteger(value.from) || value.from !== from || !Number.isSafeInteger(value.to) || value.to !== to
    || !Number.isSafeInteger(value.asOfMs) || !Array.isArray(value.observations) || value.observations.length > RAW_OPEN_INTEREST_MAX_OBSERVATIONS + 1
    || !isRecord(value.unitVerification) || !isRecord(value.feeds) || !Number.isSafeInteger(value.invalidRows) || (value.invalidRows as number) < 0
    || !Number.isSafeInteger(value.expectedIntervalMs) || (value.expectedIntervalMs as number) <= 0
    || !Number.isSafeInteger(value.retentionDays) || (value.retentionDays as number) < 1 || typeof value.history !== 'string') {
    throw new Error('Raw open-interest response did not match version 1.');
  }
  const venues = compatibleRawOpenInterestVenues(value.venues);
  if (venues.length !== requested.length || venues.some(venue => !requested.includes(venue))) throw new Error('Raw open-interest response changed the requested venue set.');
  const seen = new Set<string>();
  const observations: RawOpenInterestObservation[] = [];
  for (const raw of value.observations) {
    if (!isRecord(raw) || !isVenue(raw.venue) || !requested.includes(raw.venue) || raw.market !== 'perpetual'
      || raw.nativeSymbol !== (raw.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT')
      || !integer(raw.sourceTimeMs) || raw.sourceTimeMs < from || raw.sourceTimeMs >= to
      || !integer(raw.observedAtMs) || !integer(raw.epoch) || (raw.epoch as number) < 0
      || typeof raw.valueDecimal !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw.valueDecimal)
      || !Number.isFinite(raw.value) || (raw.value as number) <= 0 || Math.abs((raw.value as number) - Number(raw.valueDecimal)) > Math.max(1e-12, Number.EPSILON * Number(raw.valueDecimal) * 8)
      || typeof raw.units !== 'string' || !raw.units || raw.units.length > 24 || typeof raw.source !== 'string' || !raw.source || raw.source.length > 160
      || typeof raw.sourceTimeQuality !== 'string' || !raw.sourceTimeQuality || raw.sourceTimeQuality.length > 40
      || typeof raw.quality !== 'string' || !raw.quality || raw.quality.length > 40 || typeof raw.gapBefore !== 'boolean') {
      throw new Error('Raw open-interest observation is invalid.');
    }
    const observation = raw as unknown as RawOpenInterestObservation;
    const key = observationKey(observation);
    if (seen.has(key)) throw new Error('Raw open-interest response contains a duplicate observation.');
    seen.add(key); observations.push(observation);
  }
  return {
    version: 1, market: 'perpetual', nativeSymbol: 'BTC', semantics: 'observed-open-interest-level', units: 'BTC', from, to,
    asOfMs: value.asOfMs as number, venues, unitVerification: sanitizeVerification(value.unitVerification), observations,
    truncated: value.truncated === true, invalidRows: value.invalidRows as number, expectedIntervalMs: value.expectedIntervalMs as number,
    retentionDays: value.retentionDays as number, feeds: sanitizeFeeds(value.feeds), history: value.history,
  };
}

/** Bounded deduplicated raw history. It stores observations, never interpolated values. */
export class RawOpenInterestHistory {
  private rows = new Map<string, RawOpenInterestObservation>();
  private signatures = new Map<string, string>();
  readonly stats = { received: 0, changed: 0, snapshots: 0, patches: 0, duplicateRows: 0, retained: 0 };
  merge(payload: RawOpenInterestPayload) {
    this.stats.received += payload.observations.length;
    const changed: RawOpenInterestObservation[] = [];
    for (const row of payload.observations) {
      const key = observationKey(row), previous = this.rows.get(key), signature = rowSignature(row);
      if (previous && row.observedAtMs < previous.observedAtMs) { this.stats.duplicateRows++; continue; }
      if (this.signatures.get(key) === signature) { this.stats.duplicateRows++; continue; }
      this.rows.set(key, row); this.signatures.set(key, signature); changed.push(row);
    }
    const cutoff = payload.to - RAW_OPEN_INTEREST_MAX_RANGE_MS;
    for (const [key, row] of this.rows) if (row.sourceTimeMs < cutoff) { this.rows.delete(key); this.signatures.delete(key); }
    while (this.rows.size > RAW_OPEN_INTEREST_MAX_OBSERVATIONS) {
      const first = this.rows.keys().next().value as string | undefined;
      if (!first) break;
      this.rows.delete(first); this.signatures.delete(first);
    }
    this.stats.changed += changed.length; this.stats.retained = this.rows.size;
    return changed;
  }
  observations(venues: readonly RawOpenInterestVenue[], from: number, to: number) {
    const selected = new Set(venues);
    return [...this.rows.values()].filter(row => selected.has(row.venue) && row.sourceTimeMs >= from && row.sourceTimeMs < to)
      .sort((a, b) => a.sourceTimeMs - b.sourceTimeMs || venueOrder(a.venue) - venueOrder(b.venue));
  }
  snapshot(venues: readonly RawOpenInterestVenue[], from: number, to: number) { this.stats.snapshots++; return this.observations(venues, from, to); }
  diagnostics() { return { ...this.stats }; }
  clear() { this.rows.clear(); this.signatures.clear(); this.stats.retained = 0; }
}

export function observationKey(row: Pick<RawOpenInterestObservation, 'venue' | 'market' | 'nativeSymbol' | 'epoch' | 'sourceTimeMs'>) {
  return `${row.venue}:${row.market}:${row.nativeSymbol}:${row.epoch}:${row.sourceTimeMs}`;
}

function rowSignature(row: RawOpenInterestObservation) {
  return [row.observedAtMs, row.valueDecimal, row.units, row.source, row.sourceTimeQuality, row.quality, Number(row.gapBefore)].join('|');
}
function venueOrder(venue: RawOpenInterestVenue) { return venue === 'binance' ? 0 : venue === 'hyperliquid' ? 1 : 2; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function isVenue(value: unknown): value is RawOpenInterestVenue { return RAW_OPEN_INTEREST_VENUES.includes(value as RawOpenInterestVenue); }
function sanitizeVerification(value: Record<string, unknown>) {
  const result: Partial<Record<RawOpenInterestVenue, RawOpenInterestUnitVerification>> = {};
  for (const venue of RAW_OPEN_INTEREST_VENUES) {
    const item = value[venue];
    if (!isRecord(item) || !['verified', 'inferred', 'unverified'].includes(String(item.status))) continue;
    result[venue] = { status: item.status as RawOpenInterestUnitVerification['status'],
      ...(typeof item.units === 'string' ? { units: item.units } : {}),
      ...(typeof item.evidence === 'string' ? { evidence: item.evidence } : {}),
      ...(Array.isArray(item.sources) ? { sources: item.sources.filter((source): source is string => typeof source === 'string').slice(0, 8) } : {}) };
  }
  return result;
}
function sanitizeFeeds(value: Record<string, unknown>) {
  const result: Partial<Record<RawOpenInterestVenue, RawOpenInterestFeedStatus>> = {};
  for (const venue of RAW_OPEN_INTEREST_VENUES) {
    const item = value[venue];
    if (!isRecord(item) || typeof item.state !== 'string' || typeof item.stale !== 'boolean'
      || !Number.isSafeInteger(item.expectedIntervalMs) || (item.expectedIntervalMs as number) <= 0) continue;
    result[venue] = { state: item.state.slice(0, 40), stale: item.stale, expectedIntervalMs: item.expectedIntervalMs as number,
      ...(typeof item.source === 'string' || item.source === null ? { source: item.source as string | null } : {}),
      ...(typeof item.lastError === 'string' || item.lastError === null ? { lastError: item.lastError as string | null } : {}),
      ...(item.lastObservedAt === null || integer(item.lastObservedAt) ? { lastObservedAt: item.lastObservedAt as number | null } : {}),
      ...(isRecord(item.unitVerification) ? { unitVerification: sanitizeVerification({ [venue]: item.unitVerification })[venue] } : {}) };
  }
  return result;
}

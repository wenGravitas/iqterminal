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
  /** Visible conflicting native versions; absence is not deletion. */
  conflicts?: RawOpenInterestConflict[];
}

export type RawOpenInterestConflict = Pick<RawOpenInterestObservation, 'venue' | 'market' | 'nativeSymbol' | 'epoch' | 'sourceTimeMs' | 'observedAtMs'>;
export const RAW_OPEN_INTEREST_RESIDENT_LIMITS = Object.freeze({ observations: 32_000, windows: 16 });

export type RawOpenInterestRequest = { venues: RawOpenInterestVenue[] };
export type RawOpenInterestEvent = import('./staging-open-interest-history').OiHistoryEvent
  | { type: 'raw-open-interest-snapshot'; ids: string[]; payload: RawOpenInterestPayload; reset?: true; context?: 'fixture' | 'recorder' }
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
  const observations = validateRawOpenInterestObservations(value.observations, requested, from, to);
  return {
    version: 1, market: 'perpetual', nativeSymbol: 'BTC', semantics: 'observed-open-interest-level', units: 'BTC', from, to,
    asOfMs: value.asOfMs as number, venues, unitVerification: sanitizeVerification(value.unitVerification), observations,
    truncated: value.truncated === true, invalidRows: value.invalidRows as number, expectedIntervalMs: value.expectedIntervalMs as number,
    retentionDays: value.retentionDays as number, feeds: sanitizeFeeds(value.feeds), history: value.history,
    ...(value.conflicts === undefined ? {} : { conflicts: validateRawOpenInterestConflicts(value.conflicts, requested, from, to) }),
  };
}

export function validateRawOpenInterestObservations(value: unknown, requested: readonly RawOpenInterestVenue[], from: number, to: number): RawOpenInterestObservation[] {
  if (!Array.isArray(value) || value.length > RAW_OPEN_INTEREST_MAX_OBSERVATIONS + 1) throw new Error('Raw open-interest observation capacity.');
  const seen = new Set<string>();
  const observations: RawOpenInterestObservation[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !isVenue(raw.venue) || !requested.includes(raw.venue) || raw.market !== 'perpetual'
      || raw.nativeSymbol !== (raw.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT')
      || !integer(raw.sourceTimeMs) || raw.sourceTimeMs < from || raw.sourceTimeMs >= to
      || !integer(raw.observedAtMs) || !Number.isSafeInteger(raw.epoch) || (raw.epoch as number) < 0
      || typeof raw.valueDecimal !== 'string' || raw.valueDecimal.length > 160 || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw.valueDecimal) || !Number.isFinite(Number(raw.valueDecimal)) || Number(raw.valueDecimal) <= 0
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
  return observations;
}

export function validateRawOpenInterestConflicts(value: unknown, requested: readonly RawOpenInterestVenue[], from: number, to: number): RawOpenInterestConflict[] {
  if (!Array.isArray(value) || value.length > RAW_OPEN_INTEREST_MAX_OBSERVATIONS) throw new Error('Raw open-interest conflict capacity.');
  const seen = new Set<string>();
  return value.map(raw => {
    if (!isRecord(raw) || !isVenue(raw.venue) || !requested.includes(raw.venue) || raw.market !== 'perpetual'
      || raw.nativeSymbol !== (raw.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT') || !integer(raw.sourceTimeMs)
      || raw.sourceTimeMs < from || raw.sourceTimeMs >= to || !integer(raw.observedAtMs)
      || !Number.isSafeInteger(raw.epoch) || (raw.epoch as number) < 0) throw new Error('Raw open-interest conflict identity.');
    const notice: RawOpenInterestConflict = { venue: raw.venue, market: 'perpetual', nativeSymbol: raw.nativeSymbol as 'BTC' | 'BTCUSDT',
      sourceTimeMs: raw.sourceTimeMs, observedAtMs: raw.observedAtMs, epoch: raw.epoch as number };
    const key = observationKey(notice); if (seen.has(key)) throw new Error('Duplicate raw open-interest conflict.');
    seen.add(key); return notice;
  });
}

interface RetainedWindow { key: string; from: number; to: number; resident: boolean }
interface RetainedObservation { identity: RawOpenInterestConflict; row?: RawOpenInterestObservation; signature?: string; conflict: boolean }
export interface RawOpenInterestHistoryOptions { maxObservations?: number; maxWindows?: number }
/** Loaded windows belong to the cache, independently of request/subscription life.
 * Historical admission is explicit; the ordinary live cache keeps its 4h/2k bound. */
export class RawOpenInterestHistory {
  private rows = new Map<string, RetainedObservation>();
  private windows = new Map<string, RetainedWindow>();
  private liveTo = 0;
  private readonly maxObservations: number;
  private readonly maxWindows: number;
  readonly stats = { received: 0, changed: 0, snapshots: 0, patches: 0, duplicateRows: 0, retained: 0, conflictEvents: 0, evictions: 0 };
  constructor(options: RawOpenInterestHistoryOptions = {}) {
    this.maxObservations = options.maxObservations ?? RAW_OPEN_INTEREST_MAX_OBSERVATIONS;
    this.maxWindows = options.maxWindows ?? 0;
    if (!Number.isSafeInteger(this.maxObservations) || this.maxObservations < 1 || this.maxObservations > RAW_OPEN_INTEREST_RESIDENT_LIMITS.observations
      || !Number.isSafeInteger(this.maxWindows) || this.maxWindows < 0 || this.maxWindows > RAW_OPEN_INTEREST_RESIDENT_LIMITS.windows) throw new Error('Invalid raw open-interest resident bounds.');
  }
  merge(payload: Pick<RawOpenInterestPayload, 'to' | 'observations' | 'conflicts'>, options: { window?: { key: string; from: number; to: number } } = {}) {
    if (!Number.isSafeInteger(payload.to) || payload.to < 1 || payload.observations.length > RAW_OPEN_INTEREST_MAX_OBSERVATIONS + 1
      || (payload.conflicts?.length ?? 0) > RAW_OPEN_INTEREST_MAX_OBSERVATIONS) throw new Error('Invalid raw open-interest cache input.');
    if (options.window) {
      const { key, from, to } = options.window;
      if (!this.maxWindows || typeof key !== 'string' || !key || key.length > 160 || !Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(to)
        || from >= to || to - from > RAW_OPEN_INTEREST_MAX_RANGE_MS || payload.to !== to
        || [...payload.observations, ...(payload.conflicts ?? [])].some(row => row.sourceTimeMs < from || row.sourceTimeMs >= to)) throw new Error('Invalid raw open-interest retained window.');
      const previous = this.windows.get(key);
      if (previous && (previous.from !== from || previous.to !== to)) throw new Error('Raw open-interest window identity changed.');
      this.windows.delete(key); this.windows.set(key, { key, from, to, resident: previous?.resident ?? true });
      while (this.windows.size > this.maxWindows) this.windows.delete(this.windows.keys().next().value!);
    } else this.liveTo = Math.max(this.liveTo, payload.to);
    this.stats.received += payload.observations.length;
    const changed: RawOpenInterestObservation[] = [];
    for (const row of payload.observations) {
      const key = observationKey(row), previous = this.rows.get(key), signature = rowSignature(row);
      if (previous && row.observedAtMs < previous.identity.observedAtMs) { this.stats.duplicateRows++; continue; }
      if (previous && row.observedAtMs === previous.identity.observedAtMs) {
        if (previous.signature === signature) this.stats.duplicateRows++;
        else if (!previous.conflict) { previous.conflict = true; this.stats.conflictEvents++; }
        continue;
      }
      const stored = Object.freeze({ ...row });
      this.rows.set(key, { identity: conflictIdentity(row), row: stored, signature, conflict: false }); changed.push(stored);
    }
    for (const notice of payload.conflicts ?? []) {
      const key = observationKey(notice), previous = this.rows.get(key);
      if (previous && previous.identity.observedAtMs > notice.observedAtMs) continue;
      if (!previous?.conflict || previous.identity.observedAtMs !== notice.observedAtMs) this.stats.conflictEvents++;
      this.rows.set(key, { identity: { ...notice }, conflict: true });
    }
    this.prune();
    const retained = changed.filter(row => { const entry = this.rows.get(observationKey(row)); return entry?.row === row && !entry.conflict; });
    this.stats.changed += retained.length;
    return retained;
  }
  private isLive(time: number) { return this.liveTo > 0 && time >= this.liveTo - RAW_OPEN_INTEREST_MAX_RANGE_MS && time < this.liveTo; }
  private prune() {
    const windows = [...this.windows.values()];
    for (const [key, entry] of this.rows) if (!this.isLive(entry.identity.sourceTimeMs)
      && !windows.some(w => entry.identity.sourceTimeMs >= w.from && entry.identity.sourceTimeMs < w.to)) this.rows.delete(key);
    for (const allowLive of [false, true]) {
      for (const [key, entry] of this.rows) {
        if (this.rows.size <= this.maxObservations) break;
        if (!allowLive && this.isLive(entry.identity.sourceTimeMs)) continue;
        for (const window of windows) if (entry.identity.sourceTimeMs >= window.from && entry.identity.sourceTimeMs < window.to) window.resident = false;
        this.rows.delete(key); this.stats.evictions++;
      }
    }
    this.stats.retained = [...this.rows.values()].filter(entry => entry.row && !entry.conflict).length;
  }
  observations(venues: readonly RawOpenInterestVenue[], from: number, to: number) {
    const selected = new Set(venues);
    return [...this.rows.values()].filter(entry => entry.row && !entry.conflict).map(entry => entry.row!)
      .filter(row => selected.has(row.venue) && row.sourceTimeMs >= from && row.sourceTimeMs < to)
      .sort((a, b) => a.sourceTimeMs - b.sourceTimeMs || venueOrder(a.venue) - venueOrder(b.venue) || a.epoch - b.epoch);
  }
  conflicts(venues: readonly RawOpenInterestVenue[], from: number, to: number) { return [...this.rows.values()].filter(entry => entry.conflict && venues.includes(entry.identity.venue) && entry.identity.sourceTimeMs >= from && entry.identity.sourceTimeMs < to).map(entry => ({ ...entry.identity })); }
  retainedWindows() { return [...this.windows.values()].map(window => ({ ...window })); }
  snapshot(venues: readonly RawOpenInterestVenue[], from: number, to: number) { this.stats.snapshots++; return this.observations(venues, from, to); }
  diagnostics() { return { ...this.stats, tracked: this.rows.size, conflicts: [...this.rows.values()].filter(entry => entry.conflict).length, windows: this.windows.size, maxObservations: this.maxObservations, maxWindows: this.maxWindows }; }
  clear() { this.rows.clear(); this.windows.clear(); this.liveTo = 0; this.stats.retained = 0; }
}

export function observationKey(row: Pick<RawOpenInterestObservation, 'venue' | 'market' | 'nativeSymbol' | 'epoch' | 'sourceTimeMs'>) {
  return `${row.venue}:${row.market}:${row.nativeSymbol}:${row.epoch}:${row.sourceTimeMs}`;
}

function rowSignature(row: RawOpenInterestObservation) {
  return JSON.stringify([row.observedAtMs, row.valueDecimal, row.units, row.source, row.sourceTimeQuality, row.quality, row.gapBefore]);
}
function conflictIdentity(row: RawOpenInterestConflict): RawOpenInterestConflict { return { venue: row.venue, market: row.market, nativeSymbol: row.nativeSymbol, epoch: row.epoch, sourceTimeMs: row.sourceTimeMs, observedAtMs: row.observedAtMs }; }
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

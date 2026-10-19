import type { NetPositioningEvent, NetPositioningFeedStatus, NetPositioningMethod, NetPositioningObservation, NetPositioningPayload, NetPositioningRequest, NetPositioningVenue } from './net-positioning';

const MAX_RANGE_MS = 4 * 60 * 60_000;
const REFRESH_MS = 5_000;
const OVERLAP_MS = 90_000;
const MAX_INTERVALS = 2_000;
type PositioningMethod = NetPositioningMethod;
type Venue = NetPositioningVenue;

interface Subscription { id: string; request: NetPositioningRequest }
interface CachedMethod {
  rows: Map<string, NetPositioningObservation>;
  feeds: Partial<Record<Venue, NetPositioningFeedStatus>>;
  unitVerification: NetPositioningPayload['unitVerification'];
  history: string;
  semantics: string;
  pendingIntervals: number;
  truncated: boolean;
  loaded: Set<Venue>;
  cursor: Partial<Record<Venue, number>>;
  lastFrom: number;
  lastTo: number;
}

/** One staging poller in the shared data worker. Identical chart requirements join one API read. */
export class StagingNetPositioningService {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly cache = new Map<PositioningMethod, CachedMethod>();
  private readonly signatures = new Map<PositioningMethod, Map<string, string>>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private pollQueued = false;
  private dead = false;
  private enabled: boolean;
  readonly stats = { requests: 0, rowsReceived: 0, rowsChanged: 0, snapshots: 0, patches: 0, errors: 0, subscribers: 0, cachedIntervals: 0, lastPollMs: 0 };

  constructor(
    private readonly emit: (event: NetPositioningEvent) => void,
    enabled: boolean,
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {
    this.enabled = enabled;
  }

  subscribe(id: string, request: NetPositioningRequest) {
    this.subscriptions.set(id, { id, request: normalizeRequest(request) });
    this.stats.subscribers = this.subscriptions.size;
    if (!this.enabled) {
      this.errorFor(id, request.methods, 'Net positioning is available from the staging recorder; no fixture or exchange-data fallback is used.');
      return;
    }
    this.sendSnapshots(id);
    this.ensurePolling();
    this.queuePoll();
  }

  unsubscribe(id: string) {
    this.subscriptions.delete(id);
    this.stats.subscribers = this.subscriptions.size;
    if (!this.subscriptions.size) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      for (const sub of this.subscriptions.values()) this.errorFor(sub.id, sub.request.methods, 'Development fixtures are selected; net-positioning history remains disabled.');
    } else if (this.subscriptions.size) {
      this.ensurePolling(); this.queuePoll();
    }
  }

  private ensurePolling() {
    if (!this.enabled || this.dead || !this.subscriptions.size || this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, REFRESH_MS);
  }

  private queuePoll() {
    if (!this.enabled || this.dead || this.pollQueued || !this.subscriptions.size) return;
    this.pollQueued = true;
    queueMicrotask(() => { this.pollQueued = false; void this.poll(); });
  }

  private async poll() {
    if (!this.enabled || this.dead || this.polling || !this.subscriptions.size) return;
    this.polling = true;
    const started = this.now();
    const pollTo = this.now();
    try {
      const wanted = new Map<PositioningMethod, Set<Venue>>();
      for (const sub of this.subscriptions.values()) for (const method of sub.request.methods) {
        let venues = wanted.get(method); if (!venues) wanted.set(method, venues = new Set());
        for (const venue of sub.request.venues) venues.add(venue);
      }
      for (const [method, requestedVenues] of wanted) {
        if (!requestedVenues.size) continue;
        const cache = this.methodCache(method), groups = new Map<number, Venue[]>();
        for (const venue of requestedVenues) {
          const from = cache.loaded.has(venue)
            ? Math.max(pollTo - MAX_RANGE_MS, (cache.cursor[venue] ?? pollTo) - OVERLAP_MS)
            : pollTo - MAX_RANGE_MS;
          const group = groups.get(from) ?? []; group.push(venue); groups.set(from, group);
        }
        for (const [from, venues] of groups) {
          try { await this.read(method, venues, from, pollTo); }
          catch (error) { this.stats.errors++; this.errorForMethod(method, errorText(error)); }
        }
      }
    } finally {
      this.stats.lastPollMs = Math.max(0, this.now() - started);
      this.stats.cachedIntervals = [...this.cache.values()].reduce((total, item) => total + item.rows.size, 0);
      this.polling = false;
    }
  }

  private async read(method: PositioningMethod, venues: Venue[], from: number, to: number) {
    const params = new URLSearchParams({ from: String(from), to: String(to), method, venues: venues.join(',') });
    this.stats.requests++;
    const response = await this.request(`/market-data/v1/net-positioning?${params}`, { signal: AbortSignal.timeout(12_000) });
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error(`Net-positioning HTTP ${response.status} returned invalid JSON`); }
    if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Net-positioning HTTP ${response.status}`);
    const payload = parsePayload(body, method, venues, from, to);
    const changed = this.merge(method, payload, from, to);
    this.stats.rowsReceived += payload.intervals.length;
    this.stats.rowsChanged += changed.length;
    const listeners = [...this.subscriptions.values()].filter(sub => sub.request.methods.includes(method) && sub.request.venues.some(venue => venues.includes(venue)));
    const groups = new Map<string, Subscription[]>();
    for (const sub of listeners) {
      // Every client callback sees the full method/venue union it requested,
      // even when a first load or cursor groups those venues into separate HTTP ranges.
      const key = sub.request.venues.join(','); const group = groups.get(key) ?? [];
      group.push(sub); groups.set(key, group);
    }
    for (const [venueKey, group] of groups) {
      const selectedVenues = venueKey.split(',') as Venue[];
      const unionPayload = this.snapshotPayload(method, selectedVenues, from, to);
      const filteredPayload = filterPayload(unionPayload, selectedVenues);
      const selectedChanged = changed.filter(row => selectedVenues.includes(row.venue));
      this.emit({ type: 'net-positioning-patch', ids: group.map(sub => sub.id), payload: filteredPayload, intervals: selectedChanged });
      this.stats.patches++;
    }
  }

  private merge(method: PositioningMethod, payload: NetPositioningPayload, from: number, to: number) {
    const cache = this.methodCache(method), signatures = this.signatures.get(method)!;
    const changed: NetPositioningObservation[] = [];
    for (const row of payload.intervals) {
      if (!payload.venues.includes(row.venue) || row.method !== method || !Number.isSafeInteger(row.endTimeMs)) continue;
      const key = `${row.venue}:${row.endTimeMs}`, signature = rowSignature(row);
      const previous = cache.rows.get(key);
      if (previous && row.version < previous.version) continue;
      if (signatures.get(key) === signature) continue;
      signatures.set(key, signature); cache.rows.set(key, row); changed.push(row);
    }
    const cutoff = to - MAX_RANGE_MS;
    for (const [key, row] of cache.rows) if (row.endTimeMs < cutoff) { cache.rows.delete(key); signatures.delete(key); }
    while (cache.rows.size > MAX_INTERVALS) {
      const first = cache.rows.keys().next().value as string | undefined;
      if (!first) break;
      cache.rows.delete(first); signatures.delete(first);
    }
    cache.feeds = { ...cache.feeds, ...payload.feeds };
    cache.unitVerification = { ...cache.unitVerification, ...payload.unitVerification };
    cache.history = payload.history; cache.semantics = payload.semantics; cache.pendingIntervals = payload.pendingIntervals;
    cache.truncated = payload.truncated; cache.lastFrom = Math.min(cache.lastFrom || from, from); cache.lastTo = to;
    for (const venue of payload.venues) { cache.loaded.add(venue); cache.cursor[venue] = to; }
    return changed;
  }

  private methodCache(method: PositioningMethod): CachedMethod {
    let value = this.cache.get(method);
    if (!value) {
      value = { rows: new Map(), feeds: {}, unitVerification: {}, history: 'Observed intervals only; no pre-collection interpolation.', semantics: 'estimated-side-activity-from-observed-open-interest', pendingIntervals: 0, truncated: false, loaded: new Set(), cursor: {}, lastFrom: 0, lastTo: 0 };
      this.cache.set(method, value); this.signatures.set(method, new Map());
    }
    return value;
  }

  private snapshotPayload(method: PositioningMethod, venues: Venue[], from: number, to: number): NetPositioningPayload {
    const cache = this.methodCache(method);
    return { version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', unitVerification: cache.unitVerification,
      from: Math.max(from, to - MAX_RANGE_MS), to, venues, intervals: [...cache.rows.values()].sort((a, b) => a.endTimeMs - b.endTimeMs || venueOrder(a.venue) - venueOrder(b.venue)),
      truncated: cache.truncated, feeds: cache.feeds, pendingIntervals: cache.pendingIntervals, history: cache.history, semantics: cache.semantics };
  }

  private sendSnapshots(id: string) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    const now = this.now();
    for (const method of sub.request.methods) {
      const cache = this.cache.get(method); if (!cache) continue;
      const payload = filterPayload(this.snapshotPayload(method, sub.request.venues, now - MAX_RANGE_MS, now), sub.request.venues);
      this.emit({ type: 'net-positioning-snapshot', ids: [id], payload }); this.stats.snapshots++;
    }
  }

  private errorFor(id: string, methods: readonly PositioningMethod[], message: string) {
    for (const method of methods) this.emit({ type: 'net-positioning-error', ids: [id], method, message, at: this.now() });
  }

  private errorForMethod(method: PositioningMethod, message: string) {
    for (const sub of this.subscriptions.values()) if (sub.request.methods.includes(method)) {
      this.emit({ type: 'net-positioning-error', ids: [sub.id], method, message, at: this.now() });
    }
  }

  diagnostics() { return { ...this.stats, cache: [...this.cache].map(([method, item]) => ({ method, intervals: item.rows.size, venues: [...item.loaded] })) }; }
  dispose() { this.dead = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.subscriptions.clear(); this.cache.clear(); this.signatures.clear(); }
}

function normalizeRequest(request: NetPositioningRequest): NetPositioningRequest {
  const methods = [...new Set((Array.isArray(request.methods) ? request.methods : []).filter(isMethod))].slice(0, 2);
  const venues = [...new Set((Array.isArray(request.venues) ? request.venues : []).filter(isVenue))].slice(0, 2);
  return { methods, venues };
}

function isMethod(value: unknown): value is PositioningMethod { return value === 'price-oi' || value === 'aggressor-flow-oi'; }
function isVenue(value: unknown): value is Venue { return value === 'binance' || value === 'hyperliquid'; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function venueOrder(venue: Venue) { return venue === 'binance' ? 0 : 1; }
function rowSignature(row: NetPositioningObservation) {
  return [row.version, row.status, row.reason ?? '', row.oiDeltaBtcDecimal ?? '', row.netLongsBtcDecimal ?? '', row.netShortsBtcDecimal ?? '', row.unclassifiedBtcDecimal ?? '', row.direction ?? '', row.resolutionMs ?? '', row.qualityFlags.join(','), JSON.stringify(row.provenance)].join('|');
}

function parsePayload(value: unknown, method: PositioningMethod, venues: Venue[], from: number, to: number): NetPositioningPayload {
  if (!isRecord(value) || value.version !== 1 || value.method !== method || !Array.isArray(value.intervals) || !isRecord(value.feeds)) throw new Error('Net-positioning response did not match version 1');
  const validRows = value.intervals.filter((row): row is NetPositioningObservation => isRecord(row) && row.method === method && isVenue(row.venue)
    && (row.status === 'available' || row.status === 'unavailable') && Number.isSafeInteger(row.startTimeMs) && Number.isSafeInteger(row.endTimeMs)
    && Number.isSafeInteger(row.attributionTimeMs) && isRecord(row.provenance) && row.units === 'BTC');
  const unitVerification = isRecord(value.unitVerification) ? value.unitVerification as NetPositioningPayload['unitVerification'] : {};
  const feeds: NetPositioningPayload['feeds'] = {};
  for (const venue of venues) if (isRecord(value.feeds[venue])) feeds[venue] = value.feeds[venue] as NetPositioningFeedStatus;
  return { version: 1, method, market: 'perpetual', nativeSymbol: 'BTC', units: 'BTC', unitVerification,
    from: Number.isSafeInteger(value.from) ? value.from as number : from, to: Number.isSafeInteger(value.to) ? value.to as number : to,
    venues, intervals: validRows, truncated: value.truncated === true, feeds,
    pendingIntervals: Number.isSafeInteger(value.pendingIntervals) ? value.pendingIntervals as number : 0,
    history: typeof value.history === 'string' ? value.history : 'Observed intervals only; no pre-collection interpolation.',
    semantics: typeof value.semantics === 'string' ? value.semantics : 'estimated-side-activity-from-observed-open-interest' };
}

function filterPayload(payload: NetPositioningPayload, venues: readonly Venue[]): NetPositioningPayload {
  const allowed = new Set(venues);
  return { ...payload, venues: payload.venues.filter(venue => allowed.has(venue)), intervals: payload.intervals.filter(row => allowed.has(row.venue)),
    feeds: Object.fromEntries(Object.entries(payload.feeds).filter(([venue]) => allowed.has(venue as Venue))),
    unitVerification: Object.fromEntries(Object.entries(payload.unitVerification).filter(([venue]) => allowed.has(venue as Venue))) };
}

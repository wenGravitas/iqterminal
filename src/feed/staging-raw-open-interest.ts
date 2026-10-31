import {
  RAW_OPEN_INTEREST_MAX_RANGE_MS,
  RawOpenInterestHistory,
  compatibleRawOpenInterestVenues,
  validateRawOpenInterestPayload,
  type RawOpenInterestEvent,
  type RawOpenInterestPayload,
  type RawOpenInterestRequest,
  type RawOpenInterestVenue,
} from './raw-open-interest';

const REFRESH_MS = 10_000;
interface Subscription { id: string; request: RawOpenInterestRequest }

/** One shared worker poller and bounded raw history for all chart-level Open Interest consumers. */
export class StagingRawOpenInterestService {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly history = new RawOpenInterestHistory();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private pollQueued = false;
  private pollAgain = false;
  private inFlight?: AbortController;
  private dead = false;
  private enabled: boolean;
  private fixtureSelected = false;
  private metadata?: RawOpenInterestPayload;
  private readonly sentSnapshots = new Set<string>();
  readonly stats = { requests: 0, rowsReceived: 0, rowsChanged: 0, snapshots: 0, patches: 0, errors: 0, subscribers: 0, lastPollMs: 0 };

  constructor(private readonly emit: (event: RawOpenInterestEvent) => void, enabled: boolean,
    private readonly request: typeof fetch = (...args) => fetch(...args), private readonly now: () => number = Date.now) {
    this.enabled = enabled;
  }

  subscribe(id: string, request: RawOpenInterestRequest) {
    const venues = compatibleRawOpenInterestVenues(request.venues);
    this.subscriptions.set(id, { id, request: { venues } });
    this.stats.subscribers = this.subscriptions.size;
    if (this.fixtureSelected) {
      if (this.metadata) this.sendSnapshot(id);
      else this.errorFor(id, 'An explicit development Open Interest payload has not been supplied.');
      return;
    }
    if (!this.enabled) {
      this.errorFor(id, 'Raw open interest is available from the verified perpetual recorder; no fixture or exchange-data fallback is used.');
      return;
    }
    this.sendSnapshot(id);
    this.ensurePolling();
    this.queuePoll();
  }

  unsubscribe(id: string) {
    this.subscriptions.delete(id); this.sentSnapshots.delete(id);
    this.stats.subscribers = this.subscriptions.size;
    if (!this.subscriptions.size) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.inFlight?.abort();
      this.pollAgain = false;
    } else this.pollAgain = true;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined; this.sentSnapshots.clear(); this.history.clear(); this.metadata = undefined;
      this.pollAgain = false; this.inFlight?.abort();
      for (const sub of this.subscriptions.values()) this.errorFor(sub.id, 'Development fixtures are selected; raw open-interest history remains disabled.');
    } else if (this.subscriptions.size) { this.ensurePolling(); this.queuePoll(); }
  }

  setFixtureSelected(selected: boolean) {
    this.fixtureSelected = selected;
    if (selected) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined; this.inFlight?.abort(); this.pollAgain = false;
      this.history.clear(); this.metadata = undefined; this.sentSnapshots.clear();
      for (const sub of this.subscriptions.values()) this.errorFor(sub.id, 'An explicit development Open Interest payload has not been supplied.');
    } else {
      this.history.clear(); this.metadata = undefined; this.sentSnapshots.clear();
      if (this.subscriptions.size) { this.ensurePolling(); this.queuePoll(); }
    }
  }

  setFixture(payload: RawOpenInterestPayload) {
    if (!this.fixtureSelected || this.dead) return false;
    const venues = compatibleRawOpenInterestVenues(payload.venues);
    const validated = validateRawOpenInterestPayload(payload, venues, payload.from, payload.to);
    this.history.clear(); this.history.merge(validated); this.metadata = validated; this.sentSnapshots.clear();
    for (const sub of this.subscriptions.values()) this.sendSnapshot(sub.id);
    return true;
  }

  private ensurePolling() {
    if (!this.enabled || this.fixtureSelected || this.dead || !this.subscriptions.size || this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, REFRESH_MS);
  }

  private queuePoll() {
    if (!this.enabled || this.fixtureSelected || this.dead || this.pollQueued || !this.subscriptions.size) return;
    if (this.polling) { this.pollAgain = true; return; }
    this.pollQueued = true;
    queueMicrotask(() => { this.pollQueued = false; void this.poll(); });
  }

  private async poll() {
    if (!this.enabled || this.fixtureSelected || this.dead || this.polling || !this.subscriptions.size) return;
    this.polling = true; this.pollAgain = false;
    const started = this.now(), to = this.now(), from = Math.max(1, to - RAW_OPEN_INTEREST_MAX_RANGE_MS);
    const controller = new AbortController(); this.inFlight = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
    try {
      const venues = compatibleRawOpenInterestVenues([...new Set([...this.subscriptions.values()].flatMap(sub => sub.request.venues))]);
      if (!venues.length) return;
      const params = new URLSearchParams({ from: String(from), to: String(to), venues: venues.join(','), market: 'perpetual' });
      this.stats.requests++;
      const response = await this.request(`/market-data/v1/raw-open-interest?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || this.dead || !this.enabled || this.fixtureSelected || !this.subscriptions.size) return;
      let body: unknown;
      try { body = await response.json(); } catch { throw new Error(`Raw open-interest HTTP ${response.status} returned invalid JSON`); }
      if (controller.signal.aborted || this.dead || !this.enabled || this.fixtureSelected || !this.subscriptions.size) return;
      if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Raw open-interest HTTP ${response.status}`);
      const payload = validateRawOpenInterestPayload(body, venues, from, to);
      const changed = this.history.merge(payload);
      this.metadata = payload;
      this.stats.rowsReceived += payload.observations.length; this.stats.rowsChanged += changed.length;
      for (const sub of this.subscriptions.values()) {
        if (!this.sentSnapshots.has(sub.id)) { this.sendSnapshot(sub.id); continue; }
        const selected = changed.filter(row => sub.request.venues.includes(row.venue));
        const next = this.payloadFor(sub.request.venues, from, to, []);
        const event: Extract<RawOpenInterestEvent, { type: 'raw-open-interest-patch' }> = {
          type: 'raw-open-interest-patch', ids: [sub.id], payload: { ...next, observations: selected, removeBefore: from },
        };
        this.emit(event); this.stats.patches++;
      }
    } catch (error) {
      if (controller.signal.aborted && !timedOut || this.dead || !this.enabled || this.fixtureSelected || !this.subscriptions.size) return;
      this.stats.errors++;
      const message = timedOut ? 'Raw open-interest request timed out.' : errorText(error);
      for (const sub of this.subscriptions.values()) this.errorFor(sub.id, message);
    } finally {
      clearTimeout(timeout);
      if (this.inFlight === controller) this.inFlight = undefined;
      this.stats.lastPollMs = Math.max(0, this.now() - started); this.polling = false;
      if (this.pollAgain && this.subscriptions.size && this.enabled && !this.fixtureSelected && !this.dead) this.queuePoll();
    }
  }

  private payloadFor(venues: readonly RawOpenInterestVenue[], from: number, to: number, observations: RawOpenInterestPayload['observations']): RawOpenInterestPayload {
    const metadata = this.metadata;
    if (!metadata) throw new Error('Raw open-interest metadata is unavailable.');
    const selected = new Set(venues);
    return { ...metadata, from, to, venues: [...venues], observations,
      unitVerification: Object.fromEntries(Object.entries(metadata.unitVerification).filter(([venue]) => selected.has(venue as RawOpenInterestVenue))),
      feeds: Object.fromEntries(Object.entries(metadata.feeds).filter(([venue]) => selected.has(venue as RawOpenInterestVenue))) };
  }

  private sendSnapshot(id: string) {
    const sub = this.subscriptions.get(id), metadata = this.metadata;
    if (!sub || !metadata || this.sentSnapshots.has(id)) return;
    const from = Math.max(1, metadata.to - RAW_OPEN_INTEREST_MAX_RANGE_MS);
    const observations = this.history.snapshot(sub.request.venues, from, metadata.to);
    this.emit({ type: 'raw-open-interest-snapshot', ids: [id], payload: this.payloadFor(sub.request.venues, from, metadata.to, observations) });
    this.sentSnapshots.add(id); this.stats.snapshots++;
  }

  private errorFor(id: string, message: string) {
    this.emit({ type: 'raw-open-interest-error', ids: [id], message, at: this.now() });
  }

  diagnostics() { return { ...this.stats, fixtureSelected: this.fixtureSelected, history: this.history.diagnostics(), cacheVenues: this.metadata?.venues ?? [] }; }
  dispose() { this.dead = true; this.inFlight?.abort(); if (this.timer) clearInterval(this.timer); this.timer = undefined; this.subscriptions.clear(); this.sentSnapshots.clear(); this.history.clear(); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

import { calculateNakedLevels, calculateTpoSession, DAY_MS, MINUTE_MS, type TpoMinute, type TpoNakedLevel, type TpoSession, type TpoSettings } from '../indicators/tpo-engine';
import { tpoSourceKey, type Candle, type Command, type Event, type Series, type TpoEvent, type TpoStatus, canonicalSeries, instrumentOf, keyOf, marketOf, validCandle } from './protocol';
import { HistoryTileCache, type TileCache } from './history-tile-cache';
import { tpoCalculationKey } from '../indicators/tpo-settings';

const HISTORY_DAYS = 90;
const MAX_RETAINED_MINUTES = (HISTORY_DAYS + 1) * 24 * 60;
const HYPERLIQUID_RETAINED_MINUTES = 5_000;
const MAX_PARALLEL_PAGES = 3;
const MAX_RECONNECT_BACKFILL_MINUTES = 7 * 24 * 60;
const RECENT_VALIDATION_MS = 3 * DAY_MS;
const CACHE_BYTES = 48 * 1024 * 1024;
const quiet = (_event: TpoEvent) => {};

export interface TpoTransport {
  now(): number;
  fetch(url: string, init: RequestInit): Promise<Response>;
  page(series: Series, from: number, to: number, signal: AbortSignal): Promise<TpoMinute[]>;
}

export const defaultTpoTransport: TpoTransport = {
  now: Date.now,
  fetch: (...args) => fetch(...args),
  async page(series, from, to, signal) {
    const source = { ...series, interval: '1m' as const };
    if (source.venue === 'hyperliquid') {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candleSnapshot', req: { coin: instrumentOf(source).native, interval: '1m', startTime: from, endTime: to } }), signal,
      });
      if (!response.ok) throw new Error(`Hyperliquid 1m history HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Hyperliquid returned an invalid 1m history response');
      return data.map(raw => {
        const d = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        if (d.s !== instrumentOf(source).native || d.i !== '1m') return null;
        const candle: Candle = { t: Number(d.t), o: Number(d.o), h: Number(d.h), l: Number(d.l), c: Number(d.c), v: Number(d.v), revision: 0, closed: Number(d.T) < Date.now() };
        return validCandle(candle) ? { time: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c, revision: 0, closed: candle.closed } : null;
      }).filter((bar): bar is NonNullable<typeof bar> => !!bar).sort((a, b) => a.time - b.time);
    }
    const spot = marketOf(source) === 'spot';
    const endpoint = spot ? 'https://data-api.binance.vision/api/v3/klines' : 'https://fapi.binance.com/fapi/v1/klines';
    const params = new URLSearchParams({ symbol: instrumentOf(source).native, interval: '1m', limit: '1000', startTime: String(from), endTime: String(Math.max(from, to - 1)) });
    const response = await fetch(`${endpoint}?${params}`, { signal });
    if (!response.ok) throw new Error(`Binance USD-M 1m history HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Binance USD-M returned an invalid 1m history response');
    return data.map(raw => {
      if (!Array.isArray(raw)) return null;
      const candle: Candle = { t: Number(raw[0]), o: Number(raw[1]), h: Number(raw[2]), l: Number(raw[3]), c: Number(raw[4]), v: Number(raw[5]), revision: 0, closed: Number(raw[6]) < Date.now() };
      return validCandle(candle) ? { time: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c, revision: 0, closed: candle.closed } : null;
    }).filter((bar): bar is NonNullable<typeof bar> => !!bar).sort((a, b) => a.time - b.time);
  },
};

interface PageCache { from: number; to: number; bars: TpoMinute[] }
interface GapRepair { bars: TpoMinute[]; complete: boolean }
interface ModelState { settings: TpoSettings; sessions: Map<number, TpoSession>; naked: TpoNakedLevel[]; lastScanned: number; rawSignature: string }
interface Group {
  key: string; series: Series; feedId: string; ids: Set<string>; raw: Map<number, TpoMinute>; ordered: TpoMinute[];
  dayBars: Map<number, TpoMinute[]>; daySignatures: Map<number, string>;
  models: Map<string, ModelState>; abort?: AbortController; loading?: Promise<void>; loaded: boolean; disposed: boolean;
  coverageFrom: number; coverageTo: number; pagesFetched: number; cacheHits: number; failures: number; retentionLimited: boolean; forceRefresh: boolean; liveQueue: Promise<void>;
  recoveryGapFrom?: number; gapRepair?: Promise<GapRepair>; gapRetryAfter: number; gapBackoffMs: number;
}

export interface TpoServiceOptions {
  transport?: Partial<TpoTransport>;
  cache?: TileCache;
  marketCommand?: (command: Extract<Command, { type: 'subscribe' | 'unsubscribe' }>) => void;
  emit?: (event: TpoEvent) => void;
}

/** Owns the 1-minute source stream, bounded history pager, revision cache and UTC profile models inside the worker. */
export class TpoService {
  private readonly clients = new Map<string, { group: Group; settings: TpoSettings; settingsKey: string }>();
  private readonly groups = new Map<string, Group>();
  private readonly transport: TpoTransport;
  private readonly cache: TileCache;
  private readonly marketCommand: TpoServiceOptions['marketCommand'];
  private readonly emit: (event: TpoEvent) => void;
  private disposed = false;
  readonly stats = { subscriptions: 0, cacheHits: 0, pagesFetched: 0, profileRecomputes: 0, nakedRecomputes: 0, livePatches: 0 };

  constructor(options: TpoServiceOptions = {}) {
    this.transport = { ...defaultTpoTransport, ...options.transport };
    this.cache = options.cache ?? new HistoryTileCache(CACHE_BYTES, 'iqterminal-tpo-history-v1');
    this.marketCommand = options.marketCommand;
    this.emit = options.emit ?? quiet;
  }

  subscribe(id: string, series: Series, settings: TpoSettings) {
    if (this.disposed || !id) return;
    this.unsubscribe(id);
    const canonical = canonicalSeries(series);
    if (!canonical) {
      this.emit({ type: 'tpo-status', ids: [id], key: '', status: emptyStatus('failed', 'UTC TPO supports Binance BTCUSDT spot or USD-M perpetual and Hyperliquid BTC perpetual.', 0, 0) });
      return;
    }
    const sourceSeries: Series = { ...canonical, interval: '1m' };
    const key = tpoSourceKey(sourceSeries);
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key, series: sourceSeries, feedId: `tpo-feed:${key}`, ids: new Set(), raw: new Map(), ordered: [], dayBars: new Map(), daySignatures: new Map(), models: new Map(),
        loaded: false, disposed: false, coverageFrom: 0, coverageTo: 0, pagesFetched: 0, cacheHits: 0, failures: 0, retentionLimited: sourceSeries.venue === 'hyperliquid', forceRefresh: false, liveQueue: Promise.resolve(), gapRetryAfter: 0, gapBackoffMs: 60_000,
      };
      this.groups.set(key, group);
    }
    const configKey = settingsKey(settings);
    group.ids.add(id);
    this.clients.set(id, { group, settings: { ...settings }, settingsKey: configKey });
    this.stats.subscriptions = this.clients.size;
    this.emitStatus(group, 'loading', 'Loading UTC 1-minute profile history…');
    if (group.loaded) void this.ensureModel(group, configKey, settings).then(model => this.emitSnapshot(group!, [id], model));
    if (!group.loading) {
      this.marketCommand?.({ type: 'subscribe', id: group.feedId, series: sourceSeries });
      group.loading = this.loadGroup(group).catch(error => {
        if (!group!.disposed) this.emitStatus(group!, 'failed', error instanceof Error ? error.message : 'TPO history unavailable.');
      }).finally(() => { group!.loading = undefined; });
    }
  }

  unsubscribe(id: string) {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    const { group } = client;
    group.ids.delete(id);
    this.stats.subscriptions = this.clients.size;
    if (group.ids.size) return;
    group.disposed = true;
    group.abort?.abort();
    this.marketCommand?.({ type: 'unsubscribe', id: group.feedId });
    this.groups.delete(group.key);
  }

  updateSettings(id: string, settings: TpoSettings) {
    const client = this.clients.get(id);
    if (!client) return;
    const nextKey = settingsKey(settings);
    client.settings = { ...settings };
    if (client.settingsKey === nextKey) return;
    client.settingsKey = nextKey;
    if (client.group.loaded) void this.ensureModel(client.group, nextKey, client.settings).then(model => this.emitSnapshot(client.group, [id], model));
  }

  retry(id: string) {
    const client = this.clients.get(id);
    if (!client || client.group.loading) return;
    client.group.failures = 0;
    client.group.loaded = false;
    client.group.forceRefresh = true;
    client.group.recoveryGapFrom = undefined;
    client.group.gapRetryAfter = 0;
    client.group.gapBackoffMs = 60_000;
    client.group.loading = this.loadGroup(client.group).catch(error => {
      if (!client.group.disposed) this.emitStatus(client.group, 'failed', error instanceof Error ? error.message : 'TPO history unavailable.');
    }).finally(() => { client.group.loading = undefined; });
  }

  /** Called only for the hidden 1m MarketService subscription; displayed chart timeframe is irrelevant. */
  marketEvent(event: Extract<Event, { type: 'snapshot' | 'patch' }>) {
    for (const group of this.groups.values()) {
      if (!event.ids.includes(group.feedId) || group.disposed) continue;
      const changed: TpoMinute[] = [];
      let historicalRevision = false;
      const latestBefore = group.ordered.at(-1)?.time ?? -Infinity;
      const latestAllowed = Math.floor(this.transport.now() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
      for (const candle of event.candles) {
        if (!validCandle(candle) || candle.t < group.coverageFrom || candle.t > latestAllowed) continue;
        const minute: TpoMinute = { time: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c, revision: candle.revision, closed: candle.closed };
        const old = group.raw.get(minute.time);
        if (old && old.revision !== undefined && minute.revision !== undefined && minute.revision < old.revision) continue;
        if (old && old.open === minute.open && old.high === minute.high && old.low === minute.low && old.close === minute.close && old.closed === minute.closed) continue;
        // A newly received candle can repair a gap just as easily as revise an
        // existing bar; either case changes completed profiles and naked tests.
        if (minute.time < latestBefore - MINUTE_MS) historicalRevision = true;
        group.raw.set(minute.time, minute); changed.push(minute);
      }
      if (!changed.length) continue;
      if (changed.some(bar => bar.time < latestBefore && group.ordered.length)) group.ordered = [...group.raw.values()].sort((a, b) => a.time - b.time);
      else for (const bar of changed.sort((a, b) => a.time - b.time)) {
        if (!group.ordered.length || bar.time > group.ordered.at(-1)!.time) group.ordered.push(bar);
        else if (bar.time === group.ordered.at(-1)!.time) group.ordered[group.ordered.length - 1] = bar;
      }
      if (group.loaded) {
        group.liveQueue = group.liveQueue.then(async () => {
          if (!group.disposed) await this.updateLive(group, changed, historicalRevision, latestBefore);
        }).catch(() => { /* one failed model update must not stop subsequent live minutes */ });
      }
    }
  }

  private async loadGroup(group: Group) {
    if (this.disposed || group.disposed) return;
    group.abort?.abort();
    const abort = group.abort = new AbortController();
    group.loaded = false;
    const now = this.transport.now();
    const minuteEnd = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    const requestedFrom = Math.floor(now / DAY_MS) * DAY_MS - HISTORY_DAYS * DAY_MS;
    const coverageFrom = group.series.venue === 'hyperliquid'
      ? Math.max(requestedFrom, minuteEnd - HYPERLIQUID_RETAINED_MINUTES * MINUTE_MS)
      : requestedFrom;
    group.coverageFrom = coverageFrom;
    group.coverageTo = minuteEnd;
    const pageMinutes = group.series.venue === 'hyperliquid' ? 1_440 : 1_000;
    const pageMs = pageMinutes * MINUTE_MS;
    const firstPage = group.series.venue === 'hyperliquid' ? Math.floor(coverageFrom / DAY_MS) * DAY_MS : Math.floor(coverageFrom / pageMs) * pageMs;
    const lastPage = Math.floor((minuteEnd - 1) / pageMs) * pageMs;
    const pages: Array<{ from: number; to: number; cacheKey: string }> = [];
    for (let from = firstPage; from <= lastPage; from += pageMs) pages.push({ from, to: Math.min(minuteEnd, from + pageMs), cacheKey: `minutes:${group.key}:${from}` });
    const cached = await this.cache.getMany(pages.map(page => page.cacheKey));
    if (group.disposed || abort.signal.aborted) return;
    group.raw.clear(); group.ordered = [];
    const missing: typeof pages = [];
    const cacheWrite: Array<{ key: string; value: PageCache }> = [];
    for (const page of pages) {
      const value = cached.get(page.cacheKey) as PageCache | undefined;
      const historical = page.to <= Math.floor(now / pageMs) * pageMs;
      const validatedRecently = page.to <= now - RECENT_VALIDATION_MS;
      const validCache = value && value.from === page.from && value.to >= page.to && historical && Array.isArray(value.bars);
      if (validCache && validatedRecently && !group.forceRefresh) {
        group.cacheHits++;
        this.stats.cacheHits++;
        this.mergeRaw(group, value.bars);
      } else {
        if (validCache) (page as typeof page & { fallback?: PageCache }).fallback = value;
        missing.push(page);
      }
    }
    let nextPage = 0;
    const workers = Array.from({ length: Math.min(MAX_PARALLEL_PAGES, missing.length) }, async () => {
      for (;;) {
        const page = missing[nextPage++];
        if (!page || abort.signal.aborted || group.disposed) return;
        try {
          let filtered: TpoMinute[];
          try {
            const bars = await this.transport.page(group.series, page.from, page.to, abort.signal);
            group.pagesFetched++; this.stats.pagesFetched++;
            filtered = bars.filter(bar => bar.time >= Math.max(coverageFrom, page.from) && bar.time < page.to);
          } catch (error) {
            if (abort.signal.aborted) return;
            group.failures++;
            const fallback = (page as typeof page & { fallback?: PageCache }).fallback;
            if (!fallback) return;
            filtered = fallback.bars.filter(bar => bar.time >= Math.max(coverageFrom, page.from) && bar.time < page.to);
          }
          this.mergeRaw(group, filtered);
          if (page.to <= Math.floor(now / pageMs) * pageMs) cacheWrite.push({ key: page.cacheKey, value: { from: page.from, to: page.to, bars: filtered } });
        } catch { /* one malformed page cannot abort other bounded page workers */ }
      }
    });
    await Promise.all(workers);
    if (cacheWrite.length && !abort.signal.aborted) await this.cache.putMany(cacheWrite);
    if (group.disposed || abort.signal.aborted) return;
    group.forceRefresh = false;
    group.ordered = [...group.raw.values()].filter(bar => bar.time >= coverageFrom && bar.time < minuteEnd).sort((a, b) => a.time - b.time);
    this.trimRaw(group, coverageFrom);
    if (!group.ordered.length) {
      this.emitStatus(group, 'failed', group.failures ? 'No usable 1-minute history; the venue request failed.' : 'No 1-minute candles were returned for the retained coverage window.');
      return;
    }
    group.dayBars.clear(); group.daySignatures.clear();
    for (const bar of group.ordered) {
      const day = Math.floor(bar.time / DAY_MS) * DAY_MS;
      const bars = group.dayBars.get(day) ?? [];
      bars.push(bar); group.dayBars.set(day, bars);
    }
    for (const [day, bars] of group.dayBars) group.daySignatures.set(day, minuteSignature(bars));
    group.loaded = true;
    for (const id of group.ids) {
      const client = this.clients.get(id);
      if (!client) continue;
      const model = await this.ensureModel(group, client.settingsKey, client.settings);
      this.emitSnapshot(group, [id], model);
    }
  }

  private mergeRaw(group: Group, bars: readonly TpoMinute[]) {
    for (const bar of bars) {
      const old = group.raw.get(bar.time);
      if (!old || (bar.revision ?? 0) >= (old.revision ?? 0)) group.raw.set(bar.time, bar);
    }
  }

  private trimRaw(group: Group, from: number) {
    for (const time of group.raw.keys()) if (time < from) group.raw.delete(time);
    if (group.raw.size > MAX_RETAINED_MINUTES) {
      const oldest = [...group.raw.keys()].sort((a, b) => a - b).slice(0, group.raw.size - MAX_RETAINED_MINUTES);
      for (const time of oldest) group.raw.delete(time);
    }
  }

  private async ensureModel(group: Group, key: string, settings: TpoSettings): Promise<ModelState> {
    const existing = group.models.get(key);
    if (existing) return existing;
    const byDay = group.dayBars;
    const days = [...byDay.keys()].sort((a, b) => a - b);
    const cached = await this.cache.getMany(days.map(day => profileCacheKey(group.key, key, day)));
    const sessions = new Map<number, TpoSession>();
    const writes: Array<{ key: string; value: unknown }> = [];
    const asOf = group.coverageTo;
    for (const day of days) {
      const minutes = byDay.get(day)!;
      const signature = group.daySignatures.get(day) ?? minuteSignature(minutes);
      const cacheKey = profileCacheKey(group.key, key, day);
      const record = cached.get(cacheKey) as { signature?: string; session?: TpoSession } | undefined;
      let session: TpoSession | null = null;
      if (day + DAY_MS <= asOf && record?.signature === signature && record.session) session = record.session;
      else {
        session = calculateTpoSession(day, minutes, settings, Math.min(asOf, day + DAY_MS));
        this.stats.profileRecomputes++;
      }
      if (!session) continue;
      sessions.set(day, session);
      if (session.complete && record?.signature !== signature) writes.push({ key: cacheKey, value: { signature, session } });
    }
    const rawSignature = groupSignature(group);
    const nakedKey = nakedCacheKey(group.key, key);
    const nakedCached = (await this.cache.getMany([nakedKey])).get(nakedKey) as { signature?: string; levels?: TpoNakedLevel[] } | undefined;
    let naked = nakedCached?.signature === rawSignature && nakedCached.levels
      ? nakedCached.levels.map(level => ({ ...level, to: asOf }))
      : calculateNakedLevels([...sessions.values()], group.ordered, asOf, HISTORY_DAYS);
    if (nakedCached?.signature !== rawSignature) this.stats.nakedRecomputes++;
    const model: ModelState = { settings, sessions, naked, lastScanned: group.ordered.at(-1)?.time ?? group.coverageFrom, rawSignature };
    group.models.set(key, model);
    if (writes.length) await this.cache.putMany(writes);
    if (nakedCached?.signature !== rawSignature) await this.cache.putMany([{ key: nakedKey, value: { signature: rawSignature, levels: naked } }]);
    return model;
  }

  private backfillGap(group: Group, from: number, to: number): Promise<GapRepair> {
    if (group.gapRepair) return group.gapRepair;
    if (this.transport.now() < group.gapRetryAfter) return Promise.resolve({ bars: [], complete: false });
    const repair = (async (): Promise<GapRepair> => {
      const budget = group.series.venue === 'hyperliquid' ? HYPERLIQUID_RETAINED_MINUTES : MAX_RECONNECT_BACKFILL_MINUTES;
      const repairFrom = Math.max(from, to - budget * MINUTE_MS);
      const pageMinutes = group.series.venue === 'hyperliquid' ? 1_440 : 1_000;
      const pageMs = pageMinutes * MINUTE_MS;
      const signal = group.abort?.signal ?? new AbortController().signal;
      const recovered: TpoMinute[] = [];
      let failed = false;
      for (let pageFrom = Math.floor(repairFrom / pageMs) * pageMs; pageFrom < to; pageFrom += pageMs) {
        if (signal.aborted || group.disposed) break;
        try {
          const pageTo = pageFrom + pageMs;
          const page = await this.transport.page(group.series, pageFrom, pageTo, signal);
          for (const bar of page) {
            if (bar.time < repairFrom || bar.time >= to || bar.time < group.coverageFrom) continue;
            const old = group.raw.get(bar.time);
            if (old && (old.revision ?? 0) >= (bar.revision ?? 0) && old.open === bar.open && old.high === bar.high && old.low === bar.low && old.close === bar.close) continue;
            group.raw.set(bar.time, bar);
            recovered.push(bar);
          }
        } catch {
          if (signal.aborted) break;
          failed = true;
          group.failures++;
        }
      }
      let complete = repairFrom === from && !failed;
      if (complete) for (let time = repairFrom; time < to; time += MINUTE_MS) if (!group.raw.has(time)) { complete = false; break; }
      if (!complete) {
        group.gapRetryAfter = this.transport.now() + group.gapBackoffMs;
        group.gapBackoffMs = Math.min(group.gapBackoffMs * 2, 15 * 60_000);
      }
      return { bars: recovered, complete };
    })();
    group.gapRepair = repair;
    return repair.finally(() => { if (group.gapRepair === repair) group.gapRepair = undefined; });
  }

  private async updateLive(group: Group, changed: TpoMinute[], historicalRevision: boolean, latestBefore: number) {
    let requiresFullRescan = historicalRevision;
    const newestReceived = Math.max(...changed.map(bar => bar.time));
    if (Number.isFinite(latestBefore) && newestReceived > latestBefore + MINUTE_MS) {
      group.recoveryGapFrom = Math.min(group.recoveryGapFrom ?? Infinity, latestBefore + MINUTE_MS);
    }
    if (group.recoveryGapFrom !== undefined && newestReceived > group.recoveryGapFrom) {
      const repair = await this.backfillGap(group, group.recoveryGapFrom, newestReceived);
      if (group.disposed) return;
      if (repair.bars.length) {
        changed.push(...repair.bars);
        group.ordered = [...group.raw.values()].sort((a, b) => a.time - b.time);
        requiresFullRescan = true;
      }
      if (repair.complete) {
        group.recoveryGapFrom = undefined;
        group.gapRetryAfter = 0;
        group.gapBackoffMs = 60_000;
      }
    }
    const asOf = Math.floor(this.transport.now() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    const utcToday = Math.floor((asOf - MINUTE_MS) / DAY_MS) * DAY_MS;
    const rollingFrom = group.series.venue === 'hyperliquid'
      ? Math.max(utcToday - HISTORY_DAYS * DAY_MS, asOf - HYPERLIQUID_RETAINED_MINUTES * MINUTE_MS)
      : utcToday - HISTORY_DAYS * DAY_MS;
    const retentionAdvanced = rollingFrom > group.coverageFrom;
    let retainedSessionExpired = false;
    if (retentionAdvanced) {
      group.coverageFrom = rollingFrom;
      this.trimRaw(group, rollingFrom);
      group.ordered = [...group.raw.values()].filter(bar => bar.time >= rollingFrom && bar.time < asOf).sort((a, b) => a.time - b.time);
      for (const day of group.dayBars.keys()) if (day + DAY_MS <= rollingFrom) {
        group.dayBars.delete(day);
        group.daySignatures.delete(day);
        retainedSessionExpired = true;
      }
      for (const model of group.models.values()) for (const day of model.sessions.keys()) if (day + DAY_MS <= rollingFrom) {
        model.sessions.delete(day);
        retainedSessionExpired = true;
      }
    }
    group.coverageTo = asOf;
    const days = new Set(changed.map(bar => Math.floor(bar.time / DAY_MS) * DAY_MS));
    for (const day of days) {
      const bars = group.dayBars.get(day) ?? [];
      const byTime = new Map(bars.map(bar => [bar.time, bar]));
      for (const bar of changed) if (Math.floor(bar.time / DAY_MS) * DAY_MS === day) byTime.set(bar.time, bar);
      const nextBars = [...byTime.values()].sort((a, b) => a.time - b.time);
      group.dayBars.set(day, nextBars);
      group.daySignatures.set(day, minuteSignature(nextBars));
    }
    if (requiresFullRescan) {
      group.dayBars.clear(); group.daySignatures.clear();
      for (const bar of group.ordered) {
        const day = Math.floor(bar.time / DAY_MS) * DAY_MS;
        const bars = group.dayBars.get(day) ?? [];
        bars.push(bar); group.dayBars.set(day, bars);
      }
      for (const [day, bars] of group.dayBars) group.daySignatures.set(day, minuteSignature(bars));
    }
    // Rebuilding deletes and reinserts models under the same keys. Iterate a
    // snapshot so Map iteration cannot revisit each replacement indefinitely.
    for (const [key, model] of [...group.models.entries()]) {
      if (group.disposed) return;
      if (requiresFullRescan) {
        group.models.delete(key);
        const replacement = await this.ensureModel(group, key, model.settings);
        if (group.disposed) return;
        this.emitPatch(group, key, [...replacement.sessions.values()], replacement.naked);
        continue;
      }
      const updated: TpoSession[] = [];
      let addedCompletedProfile = false;
      if (retainedSessionExpired) {
        const sessions = [...model.sessions.values()].filter(session => session.complete).sort((a, b) => b.day - a.day).slice(0, model.settings.nakedDays);
        model.naked = calculateNakedLevels(sessions, group.ordered, asOf, model.settings.nakedDays);
        this.stats.nakedRecomputes++;
      }
      for (const day of days) {
        const minutes = group.dayBars.get(day) ?? [];
        if (!minutes.length) continue;
        const previous = model.sessions.get(day);
        const session = calculateTpoSession(day, minutes, model.settings, Math.min(asOf, day + DAY_MS));
        if (!session) continue;
        model.sessions.set(day, session); updated.push(session); this.stats.profileRecomputes++;
        if (session.complete && !previous?.complete) addedCompletedProfile = true;
      }
      const orderedChanges = changed.slice().sort((a, b) => a.time - b.time);
      if (addedCompletedProfile) {
        const recentSessions = [...model.sessions.values()].filter(session => session.complete).sort((a, b) => b.day - a.day).slice(0, model.settings.nakedDays);
        const added = calculateNakedLevels(recentSessions.filter(session => !model.naked.some(level => level.originDay === session.day)), group.ordered, asOf, model.settings.nakedDays);
        const addedIds = new Set(added.map(level => level.id));
        model.naked = [...model.naked.filter(level => !addedIds.has(level.id)), ...added].sort((a, b) => a.originDay - b.originDay || a.kind.localeCompare(b.kind));
        this.stats.nakedRecomputes++;
      }
      for (const minute of orderedChanges) {
        if (minute.time >= model.lastScanned) this.applyNakedMinute(model, minute, asOf);
        model.lastScanned = Math.max(model.lastScanned, minute.time);
      }
      model.rawSignature = groupSignature(group);
      if (group.disposed) return;
      for (const session of updated) if (session.complete) {
        await this.cache.putMany([{ key: profileCacheKey(group.key, key, session.day), value: { signature: group.daySignatures.get(session.day), session } }]);
        if (group.disposed) return;
      }
      await this.cache.putMany([{ key: nakedCacheKey(group.key, key), value: { signature: model.rawSignature, levels: model.naked } }]);
      if (group.disposed) return;
      this.emitPatch(group, key, updated, model.naked);
    }
    this.stats.livePatches++;
  }

  private applyNakedMinute(model: ModelState, bar: TpoMinute, asOf: number) {
    for (let index = 0; index < model.naked.length; index++) {
      const level = model.naked[index]!;
      if (bar.time < level.from) continue;
      if (level.firstTouch !== null) {
        model.naked[index] = { ...level, to: asOf };
        continue;
      }
      const previousBoundary = Math.max(level.from, model.lastScanned + MINUTE_MS);
      const missing = Math.max(0, Math.floor((bar.time - previousBoundary) / MINUTE_MS));
      const missingMinutes = level.missingMinutes + missing;
      const touch = bar.low <= level.price && bar.high >= level.price;
      const state = touch ? missingMinutes ? 'unknown' : 'tested' : missingMinutes ? 'unknown' : level.state;
      model.naked[index] = { ...level, state, missingMinutes, to: asOf, firstTouch: touch ? bar.time : null };
    }
  }

  private status(group: Group, state: TpoStatus['state'], message: string): TpoStatus {
    const expectedMinutes = Math.max(0, Math.floor((group.coverageTo - group.coverageFrom) / MINUTE_MS));
    const observedMinutes = group.ordered.length;
    const missingMinutes = Math.max(0, expectedMinutes - observedMinutes);
    const retentionMessage = group.retentionLimited ? 'Hyperliquid source retention limits 1-minute history to its recent candle window; older UTC days are unavailable.' : '';
    const coverageText = `${observedMinutes.toLocaleString()} / ${expectedMinutes.toLocaleString()} elapsed 1-minute candles observed`;
    const gapText = missingMinutes ? `${missingMinutes.toLocaleString()} minute(s) missing; naked levels across those gaps remain unknown` : 'continuous observed minute coverage';
    const finalMessage = state === 'ready' || state === 'partial' ? `${coverageText} · ${gapText}${retentionMessage ? ` · ${retentionMessage}` : ''}${group.failures ? ` · ${group.failures} history page(s) failed` : ''}` : message;
    return { state, message: finalMessage, coverageFrom: group.coverageFrom, coverageTo: group.coverageTo, expectedMinutes, observedMinutes, missingMinutes, cacheHits: group.cacheHits, pagesFetched: group.pagesFetched, retentionLimited: group.retentionLimited };
  }

  private emitStatus(group: Group, state: TpoStatus['state'], message: string) {
    if (!group.ids.size) return;
    this.emit({ type: 'tpo-status', ids: [...group.ids], key: group.key, status: this.status(group, state, message) });
  }

  private emitSnapshot(group: Group, ids: string[], model: ModelState) {
    const status = this.status(group, group.failures || this.status(group, 'ready', '').missingMinutes ? 'partial' : 'ready', '');
    const event: TpoEvent = { type: 'tpo-snapshot', ids, key: group.key, sessions: [...model.sessions.values()], nakedLevels: model.naked, status };
    this.emit(event);
  }

  private emitPatch(group: Group, settingsKey: string, sessions: TpoSession[], nakedLevels: TpoNakedLevel[]) {
    const status = this.status(group, group.failures || this.status(group, 'ready', '').missingMinutes ? 'partial' : 'ready', '');
    const ids = [...this.clients.entries()].filter(([, client]) => client.group === group && client.settingsKey === settingsKey).map(([id]) => id);
    if (ids.length) this.emit({ type: 'tpo-patch', ids, key: group.key, sessions, nakedLevels, status });
  }

  diagnostics() {
    return { ...this.stats, groups: [...this.groups.values()].map(group => ({ key: group.key, clients: group.ids.size, minutes: group.raw.size, sessions: [...group.models.values()].reduce((max, model) => Math.max(max, model.sessions.size), 0), loading: Boolean(group.loading), pagesFetched: group.pagesFetched, cacheHits: group.cacheHits, failures: group.failures })) };
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.clients.keys()]) this.unsubscribe(id);
    this.groups.clear(); this.cache.dispose?.();
  }
}

function emptyStatus(state: TpoStatus['state'], message: string, from: number, to: number): TpoStatus {
  return { state, message, coverageFrom: from, coverageTo: to, expectedMinutes: 0, observedMinutes: 0, missingMinutes: 0, cacheHits: 0, pagesFetched: 0, retentionLimited: false };
}
function settingsKey(settings: TpoSettings) {
  return tpoCalculationKey({ ...settings, nakedDays: settings.nakedDays ?? HISTORY_DAYS });
}
function profileCacheKey(source: string, settings: string, day: number) { return `profile:${source}:${settings}:${day}`; }
function nakedCacheKey(source: string, settings: string) { return `naked:${source}:${settings}`; }
function minuteSignature(minutes: readonly TpoMinute[]) {
  let hash = 2166136261;
  for (const bar of minutes) {
    const text = `${bar.time},${bar.open},${bar.high},${bar.low},${bar.close},${bar.revision ?? 0},${bar.closed ? 1 : 0};`;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return `${minutes.length}:${minutes[0]?.time ?? 0}:${minutes.at(-1)?.time ?? 0}:${hash >>> 0}`;
}
function groupSignature(group: Group) {
  return [...group.daySignatures.entries()].sort((a, b) => a[0] - b[0]).map(([day, signature]) => `${day}:${signature}`).join('|');
}

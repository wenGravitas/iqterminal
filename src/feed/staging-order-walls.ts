import type { Command, Event, Market } from './protocol';
import { OrderWallDetector, orderWallsSettings,
  type OrderWallBookScope, type OrderWallDepthRecord, type OrderWallMarket,
  type OrderWallRequest, type OrderWallSegment, type OrderWallPatch, type OrderWallStatus, type OrderWallsSettings } from './order-walls';
import { depthSource } from './prepared-history';
import type { DepthHeadNotice, StagingHeatmapService } from './staging-heatmap';

type WallCommand = Extract<Command, { type: 'order-wall-subscribe' | 'order-wall-unsubscribe' | 'order-wall-settings' | 'order-wall-viewport' }>;
interface Page {
  version: number; market: Market; instrument: string; feed: string; from: number; to: number; watermark: number;
  head: { cursor: number; at: number; epoch: number };
  page: { after: number; nextAfter: number; hasMore: boolean; limit: number; observations: number; sameMillisecondClosed: boolean };
  seed?: { at: number; cursor: number; epoch: number; bids: [string, string][]; asks: [string, string][]; bookScope?: unknown };
  observations: Array<{ kind: OrderWallDepthRecord['kind']; at: number; cursor: number; epoch: number;
    bids?: [string, string][]; asks?: [string, string][]; bookScope?: unknown; reason?: string }>;
  coverage: { confirmedTo: number; partial: boolean; reason?: string; seedAt: number | null; earliestRetainedAt?: number | null; gaps: Array<{ at: number; cursor: number; epoch: number; reason: string }> };
}
interface NormalizedPage {
  watermark: number;
  head: Page['head'];
  page: Page['page'];
  records: OrderWallDepthRecord[];
  coverage: Page['coverage'];
}
interface ReplayCacheEntry {
  key: string; market: OrderWallMarket; instrument: string; feed: string; version: number;
  from: number; to: number; watermark: number; head: Page['head']; pages: NormalizedPage[]; bytes: number; coverage: Page['coverage'];
}
interface BufferedLivePage { after: number; nextAfter: number; records: OrderWallDepthRecord[]; bytes: number }
interface LiveReplayBuffer { after: number; through: number; pages: BufferedLivePage[]; records: number; bytes: number }
interface Subscription {
  id: string; key: string; market: OrderWallMarket; request: OrderWallRequest; settings: OrderWallsSettings;
  generation: number; range: { from: number; to: number }; viewportRange: { from: number; to: number }; clipped: boolean; viewportClipped: boolean; detector: OrderWallDetector;
  autoPriceWidth: number; followLive: boolean; liveTo: number;
  liveDetector?: OrderWallDetector; liveRange?: { from: number; to: number }; liveCursor: number; liveWatermark?: number;
  liveDetectionKey?: string; liveRequestedKey?: string; liveAutoPriceWidth?: number; liveReady: boolean; liveRetryCount: number; liveRetryAt: number; liveRetryTimer?: ReturnType<typeof setTimeout>;
  replaySerial: number; liveSerial: number; promoting: boolean; replayCatchupAbort?: AbortController; releaseHead?: () => void; abort?: AbortController; liveAbort?: AbortController; busy: boolean; liveBusy: boolean; initialized: boolean; serial: number;
  watermark?: number; replayWatermarkHead?: Page['head']; cursor: number; pendingCursor: number; pendingAt: number; pendingEpoch: number; latestCoverage?: Page['coverage'];
  initialPublished: boolean; replayPromoted: boolean; awaitingFreshHead: boolean; rendered: Map<string, OrderWallSegment>; livePublished: Map<string, OrderWallSegment>; liveAliases: Map<string, string>; liveReplayBuffer?: LiveReplayBuffer; batch: number; staleMessage?: string; retryCount: number; retryTimer?: ReturnType<typeof setTimeout>;
  latestStatus?: OrderWallStatus;
}

const MAX_RANGE_MS = 4 * 60 * 60 * 1000;
const PAGE_LIMIT = 256;
const UNCONFIRMED_DURABLE_TAIL = 'Durable depth watermark has not confirmed the requested tail';

/** Replays bounded, fixed-watermark raw depth observations and follows the existing durable head stream. */
export class StagingOrderWallsService {
  private subscriptions = new Map<string, Subscription>();
  private replayCache = new Map<string, ReplayCacheEntry>();
  private replayCacheBytes = 0;
  private generation = 0;
  private disposed = false;
  readonly stats = { pages: 0, records: 0, bytes: 0, replayMs: 0, failures: 0, active: 0, cacheHits: 0,
    cachePrefixHits: 0, cacheEpochRejects: 0, liveTailEvictions: 0, replayBridgePages: 0, replayBridgeRecords: 0 };

  constructor(private heads: StagingHeatmapService, private emit: (event: Event) => void,
    private request: typeof fetch = (...args) => fetch(...args), private now = Date.now) {}

  command(command: WallCommand) {
    if (command.type === 'order-wall-subscribe') this.subscribe(command.id, command.request);
    else if (command.type === 'order-wall-unsubscribe') this.unsubscribe(command.id);
    else if (command.type === 'order-wall-settings') this.updateSettings(command.id, command.settings);
    else this.updateViewport(command.id, command.from, command.to, command.autoPriceWidth);
  }

  private subscribe(id: string, request: OrderWallRequest) {
    this.unsubscribe(id);
    const settings = orderWallsSettings(request.settings), market = request.market;
    const range = this.boundedRange(request.from, request.to);
    const autoPriceWidth = validAutoPriceWidth(request.autoPriceWidth, tickSize(market));
    const sub: Subscription = { id, key: keyFor(market, settings), market, request: { ...request }, settings,
      generation: ++this.generation, range: range.range, viewportRange: range.range, clipped: range.clipped, viewportClipped: range.clipped,
      autoPriceWidth, followLive: request.followLive ?? request.to >= this.now() - 60_000, liveTo: range.range.to,
      detector: new OrderWallDetector(settings, tickSize(market), autoPriceWidth), busy: false, liveBusy: false, initialized: false, serial: 0,
      liveCursor: 0, liveReady: false, liveRetryCount: 0, liveRetryAt: 0, replaySerial: 0, liveSerial: 0, promoting: false,
      cursor: 0, pendingCursor: 0, pendingAt: 0, pendingEpoch: 0, initialPublished: false, replayPromoted: false, awaitingFreshHead: false, rendered: new Map(), livePublished: new Map(), liveAliases: new Map(), batch: 0, retryCount: 0 };
    this.subscriptions.set(id, sub); this.stats.active = this.subscriptions.size;
    if (market === 'hyperliquid') { this.publishUnavailable(sub, 'Hyperliquid depth history is unavailable from the retained BTC book source.'); return; }
    if (range.range.from >= range.range.to) { this.publishUnavailable(sub, 'No retained depth is available for this viewport.'); return; }
    const feedMarket = market === 'binance-spot' ? 'spot' : 'perpetual';
    sub.releaseHead = this.heads.observeDepthHeads(id, feedMarket, 0, notice => this.onHead(sub, notice));
    void this.load(sub, undefined, 0, true);
  }

  private unsubscribe(id: string) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    this.subscriptions.delete(id); sub.serial++; sub.abort?.abort(); sub.liveAbort?.abort(); sub.replayCatchupAbort?.abort();
    clearTimeout(sub.retryTimer); clearTimeout(sub.liveRetryTimer); sub.releaseHead?.();
    this.stats.active = this.subscriptions.size;
  }

  private updateSettings(id: string, raw: OrderWallsSettings) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    const settings = orderWallsSettings(raw), oldDetection = detectionKey(sub.settings), nextDetection = detectionKey(settings);
    sub.settings = settings; sub.key = keyFor(sub.market, settings);
    if (oldDetection !== nextDetection) this.restart(sub, 'Rechecking historical walls with the new detection settings.', true);
    else this.publish(sub, 'patch', [], this.status(sub));
  }

  private updateViewport(id: string, from: number, to: number, autoPriceWidth?: number) {
    const sub = this.subscriptions.get(id); if (!sub || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
    const bounded = this.boundedRange(from, to);
    const previousViewport = sub.viewportRange, previousViewportClipped = sub.viewportClipped;
    const nextAutoPriceWidth = validAutoPriceWidth(autoPriceWidth ?? sub.autoPriceWidth, tickSize(sub.market));
    const autoWidthChanged = sub.settings.aggregation === 'auto' && nextAutoPriceWidth !== sub.autoPriceWidth;
    const nextFollowLive = to >= this.now() - 60_000;
    // Keep the fixed-watermark replay query intact while the live chart slides
    // forward by one or two candle intervals. Comparing against the latest
    // viewport (rather than the immutable replay range) lets repeated small
    // advances remain a single replay generation.
    const movingLiveWindow = followsLiveViewportSlide(sub.viewportRange, bounded.range, sub.followLive, nextFollowLive);
    sub.viewportClipped = bounded.clipped;
    const rangeChanged = !movingLiveWindow && (sub.range.from !== bounded.range.from || sub.range.to !== bounded.range.to
      || sub.clipped !== bounded.clipped);
    if (!rangeChanged && !autoWidthChanged && sub.followLive === nextFollowLive) {
      sub.request.from = from; sub.request.to = to; sub.viewportRange = bounded.range; sub.liveTo = Math.max(sub.liveTo, to);
      if (previousViewport.from !== bounded.range.from || previousViewport.to !== bounded.range.to
        || previousViewportClipped !== bounded.clipped) this.publish(sub, 'patch', [], this.status(sub));
      return;
    }
    sub.request.from = from; sub.request.to = to;
    sub.viewportRange = bounded.range;
    if (!movingLiveWindow) { sub.range = bounded.range; sub.clipped = bounded.clipped; }
    sub.autoPriceWidth = nextAutoPriceWidth; sub.followLive = nextFollowLive;
    sub.liveTo = Math.max(sub.range.to, to);
    if (bounded.range.from >= bounded.range.to) { this.restart(sub, 'No retained depth is available for this viewport.'); return; }
    if (sub.followLive) void this.ensureLiveBootstrap(sub);
    this.restart(sub, autoWidthChanged ? 'Rechecking walls at the current automatic price resolution.' : 'Loading depth observations for the visible range.', autoWidthChanged);
  }

  private restart(sub: Subscription, message: string, refreshLive = false, initialState: OrderWallStatus['state'] = 'loading') {
    const previous = sub.latestStatus;
    sub.replaySerial++; sub.abort?.abort(); sub.replayCatchupAbort?.abort(); sub.replayCatchupAbort = undefined; sub.promoting = false;
    clearTimeout(sub.retryTimer); sub.retryTimer = undefined; sub.retryCount = 0; sub.busy = false; sub.initialized = false; sub.watermark = undefined;
    sub.cursor = 0; sub.replayWatermarkHead = undefined; sub.latestCoverage = undefined; sub.replayPromoted = false;
    sub.detector = new OrderWallDetector(sub.settings, tickSize(sub.market), sub.autoPriceWidth); sub.generation = ++this.generation;
    if (refreshLive) {
      sub.liveDetectionKey = undefined;
      sub.liveReady = false; sub.liveReplayBuffer = undefined;
      if (sub.pendingAt > 0) void this.ensureLiveBootstrap(sub);
    }
    const restartState = sub.awaitingFreshHead ? 'gap' : sub.staleMessage ? 'stale' : initialState;
    this.publish(sub, 'patch', [], { ...(previous ?? {}), state: restartState,
      message: sub.staleMessage ?? message,
      ...(previous?.coverage ? { coverage: { ...previous.coverage, complete: false, partial: true, reason: message } } : {}),
      resolvedPriceWidth: sub.settings.aggregation === 'auto' ? sub.autoPriceWidth : sub.settings.aggregation });
    void this.load(sub, undefined, 0, true);
  }

  private boundedRange(from: number, to: number) {
    if (![from, to].every(Number.isSafeInteger) || from <= 0 || from >= to) {
      const now = this.now();
      return { range: { from: now, to: now }, clipped: true };
    }
    const end = Math.min(to, this.now());
    const start = Math.max(from, end - MAX_RANGE_MS);
    return { range: { from: start, to: end }, clipped: start > from || end < to };
  }

  private onHead(sub: Subscription, notice: DepthHeadNotice) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub) return;
    if (notice.type === 'stale') {
      sub.staleMessage = notice.message;
      this.publish(sub, 'patch', [], this.status(sub, sub.awaitingFreshHead ? 'gap' : 'stale', notice.message));
    } else if (notice.type === 'reset') {
      sub.awaitingFreshHead = true; sub.staleMessage = notice.message;
      sub.pendingCursor = 0; sub.pendingAt = 0; sub.pendingEpoch = 0;
      sub.liveReplayBuffer = undefined;
      const censored = sub.liveDetector?.censor(`Depth stream reset · ${notice.message}`) ?? [];
      if (censored.length) this.publishLivePatches(sub, censored, this.status(sub, 'gap', notice.message));
      sub.livePublished.clear(); sub.liveAliases.clear();
      sub.liveSerial++; sub.liveAbort?.abort(); sub.liveBusy = false; sub.liveReady = false; sub.liveDetector = undefined;
      sub.liveCursor = 0; sub.liveWatermark = undefined; sub.liveRange = undefined; sub.liveDetectionKey = undefined;
      this.restart(sub, `Depth stream reset · ${notice.message}`, false, 'gap');
    } else {
      if (!validDepthHead(notice)) return;
      const epochChanged = sub.pendingAt > 0 && notice.epoch !== sub.pendingEpoch;
      if (!sub.awaitingFreshHead && !epochChanged && (notice.cursor < sub.pendingCursor
        || (notice.cursor === sub.pendingCursor && notice.at < sub.pendingAt))) return;
      const recoveringStale = Boolean(sub.staleMessage || sub.latestStatus?.state === 'stale');
      sub.awaitingFreshHead = false;
      sub.staleMessage = undefined;
      if (epochChanged) {
        const censored = sub.liveDetector?.censor('Depth epoch changed; prior wall end is unknown.') ?? [];
        if (censored.length) this.publishLivePatches(sub, censored, this.status(sub, 'gap', 'Depth epoch changed; prior wall end is unknown.'));
        sub.livePublished.clear(); sub.liveAliases.clear();
        sub.liveSerial++; sub.liveAbort?.abort(); sub.liveBusy = false; sub.liveReady = false;
        sub.liveDetector = undefined; sub.liveCursor = 0; sub.liveWatermark = undefined; sub.liveRange = undefined; sub.liveDetectionKey = undefined;
        sub.liveReplayBuffer = undefined;
        // A new epoch may restart its cursor or source clock. Its head replaces
        // the prior target rather than inheriting it through Math.max below.
        sub.pendingCursor = notice.cursor;
        sub.pendingAt = notice.at;
      } else {
        sub.pendingCursor = Math.max(sub.pendingCursor, notice.cursor);
        sub.pendingAt = Math.max(sub.pendingAt, notice.at);
      }
      sub.pendingEpoch = notice.epoch;
      if (!sub.liveReady) sub.replayPromoted = false;
      if (sub.followLive) sub.liveTo = Math.max(sub.liveTo, notice.at + 1);
      const requestedKey = `${detectionKey(sub.settings)}:${sub.autoPriceWidth}`;
      if (recoveringStale && sub.liveReady && sub.liveDetector && sub.liveDetectionKey === requestedKey
        && sub.pendingCursor <= sub.liveCursor) {
        const confirmations = sub.liveDetector.confirmHead(notice.at, notice.cursor);
        this.publishLivePatches(sub, confirmations, this.status(sub));
      }
      if (sub.followLive && sub.replayWatermarkHead && sub.replayWatermarkHead.epoch !== notice.epoch) {
        this.invalidateMarketReplayCache(sub.market);
        this.stats.cacheEpochRejects++;
        this.restart(sub, 'Depth source epoch changed; refreshing canonical history before promotion.');
      }
      if (sub.followLive) void this.ensureLiveBootstrap(sub);
    }
  }

  private async load(sub: Subscription, watermark: number | undefined, after: number, initial: boolean) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.busy) {
      if (sub.busy && watermark !== undefined) sub.pendingCursor = Math.max(sub.pendingCursor, watermark);
      return;
    }
    sub.busy = true; const serial = sub.replaySerial, lifecycle = sub.serial, abort = new AbortController(); sub.abort = abort;
    const started = performance.now(); let succeeded = false;
    const cacheKey = rangeKey(sub);
    const cached = initial && watermark === undefined ? this.readCache(sub) : undefined;
    if (cached) sub.replayWatermarkHead = cached.head;
    const cachedPrefix = Boolean(cached && cached.to < sub.range.to);
    if (cachedPrefix) this.stats.cachePrefixHits++;
    let cacheCandidate: NormalizedPage[] | undefined = initial && watermark === undefined
      ? cachedPrefix ? cached!.pages.slice() : !cached ? [] : undefined : undefined;
    let cacheCandidateBytes = cachedPrefix ? cached!.bytes : 0;
    try {
      let pageAfter = after, fixedWatermark = cached?.watermark ?? watermark, firstPage = initial, pageIndex = 0, usingCached = Boolean(cached);
      for (;;) {
        let normalized: NormalizedPage | undefined;
        if (usingCached) {
          // A warm replay can contain thousands of cached pages. Yield between
          // pages so worker messages (heads, settings, unsubscribe) can cancel it.
          await macrotaskYield();
          if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.serial !== lifecycle
            || sub.replaySerial !== serial || abort.signal.aborted) return;
          normalized = cached!.pages[pageIndex++];
          if (!normalized && cachedPrefix) { usingCached = false; fixedWatermark = undefined; firstPage = false; }
          else if (!normalized) throw new Error('Cached depth replay ended before its final page');
          else fixedWatermark = normalized.watermark;
        }
        if (!normalized) {
          const page = await this.readPage(sub, pageAfter, fixedWatermark, abort.signal);
          if (this.subscriptions.get(sub.id) !== sub || sub.serial !== lifecycle || sub.replaySerial !== serial || abort.signal.aborted) return;
          if (fixedWatermark === undefined) fixedWatermark = page.watermark;
          if (page.watermark !== fixedWatermark) throw new Error('Depth replay watermark changed during pagination');
          this.validatePage(page, sub, sub.range, pageAfter, fixedWatermark);
          if (sub.followLive && sub.replayWatermarkHead && page.head.epoch !== sub.replayWatermarkHead.epoch) {
            this.invalidateMarketReplayCache(sub.market);
            this.stats.cacheEpochRejects++;
            this.restart(sub, 'Depth source epoch changed during replay; refreshing canonical history before promotion.');
            return;
          }
          normalized = normalizePage(page, firstPage);
          if (cacheCandidate) {
            cacheCandidateBytes += JSON.stringify(normalized).length;
            if (cacheCandidateBytes <= MAX_REPLAY_CACHE_ENTRY_BYTES) cacheCandidate.push(normalized);
            else cacheCandidate = undefined;
          }
        }
        if (firstPage) pageAfter = normalized.page.after;
        const patches = sub.detector.processBatch(normalized.records);
        sub.replayWatermarkHead = normalized.head;
        sub.watermark = Math.max(sub.watermark ?? 0, fixedWatermark ?? normalized.watermark);
        sub.cursor = Math.max(sub.cursor, normalized.page.nextAfter, ...normalized.records.map(record => record.cursor));
        sub.latestCoverage = mergeCoverage(sub.latestCoverage, normalized.coverage); sub.initialized = !normalized.page.hasMore;
        this.stats.pages++; this.stats.records += normalized.page.observations;
        const status = this.status(sub, normalized.page.hasMore ? 'loading' : undefined, normalized.page.hasMore ? 'Loading recorded depth history.' : undefined);
        this.publishHistorical(sub, patches, status);
        if (!normalized.page.hasMore) {
          if (usingCached && cachedPrefix && pageIndex === cached!.pages.length) {
            pageAfter = normalized.page.nextAfter; usingCached = false; fixedWatermark = undefined; firstPage = false;
            continue;
          }
          break;
        }
        if (normalized.page.nextAfter <= pageAfter) throw new Error('Depth replay cursor did not advance');
        pageAfter = normalized.page.nextAfter; firstPage = false;
      }
      if (cached && !cachedPrefix && pageIndex !== cached.pages.length) throw new Error('Cached depth replay has unused pages');
      this.stats.replayMs += performance.now() - started;
      sub.retryCount = 0; clearTimeout(sub.retryTimer); sub.retryTimer = undefined;
      succeeded = true;
      if (cacheCandidate?.length && fixedWatermark !== undefined) this.rememberCache(cacheKey, sub, fixedWatermark, cacheCandidate, cacheCandidateBytes);
      if (fixedWatermark !== undefined) await this.finishReplay(sub, serial, lifecycle);
    } catch (error) {
      if (!abort.signal.aborted && this.subscriptions.get(sub.id) === sub && sub.serial === lifecycle && sub.replaySerial === serial) {
        this.stats.failures++;
        const message = error instanceof Error ? error.message : String(error);
        const state = /gap|continuity|checkpoint|retained/i.test(message) ? 'gap' : 'stale';
        this.publish(sub, 'patch', [], this.status(sub, state, `Depth history · ${message}`));
        clearTimeout(sub.retryTimer);
        const wait = Math.min(15_000, 500 * 2 ** Math.min(sub.retryCount++, 5));
        sub.retryTimer = setTimeout(() => {
          sub.retryTimer = undefined;
          if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.serial !== lifecycle || sub.replaySerial !== serial) return;
          const firstAttempt = sub.watermark === undefined && sub.cursor === 0;
          void this.load(sub, sub.watermark, sub.cursor, firstAttempt);
        }, wait);
      }
    } finally {
      if (sub.serial === lifecycle && sub.replaySerial === serial) {
        sub.busy = false; sub.abort = undefined;
        if (succeeded && !abort.signal.aborted && this.subscriptions.get(sub.id) === sub && sub.initialized && !sub.replayPromoted)
          queueMicrotask(() => void this.finishReplay(sub, serial, lifecycle));
      }
    }
  }

  private async ensureLiveBootstrap(sub: Subscription) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || !sub.followLive || sub.pendingAt <= 0) return;
    const requestedKey = `${detectionKey(sub.settings)}:${sub.autoPriceWidth}`;
    if (sub.liveBusy) {
      if (sub.liveRequestedKey === requestedKey) return;
      sub.liveSerial++; sub.liveAbort?.abort(); sub.liveBusy = false;
    }
    if (sub.liveReady && sub.liveDetector && sub.liveDetectionKey === requestedKey) {
      if (sub.pendingCursor > sub.liveCursor) void this.catchUpLive(sub);
      return;
    }
    const serial = ++sub.liveSerial, lifecycle = sub.serial;
    const head = { cursor: sub.pendingCursor, at: sub.pendingAt, epoch: sub.pendingEpoch };
    // The v1 API seeds from the nearest checkpoint and includes the deltas
    // needed to reconstruct the requested point, even when those deltas predate
    // `from`. Request only the current head millisecond for bootstrap; a minute
    // of redundant warmup makes the initial response much larger on slow links.
    const range = { from: Math.max(1, head.at), to: head.at + 1 };
    const detector = new OrderWallDetector(sub.settings, tickSize(sub.market), sub.autoPriceWidth);
    sub.liveReady = false; sub.liveReplayBuffer = undefined;
    const abort = new AbortController(); sub.liveAbort = abort; sub.liveBusy = true; sub.liveRequestedKey = requestedKey;
    try {
      let after = 0, firstPage = true, cursor = 0, coverage: Page['coverage'] | undefined;
      for (;;) {
        const page = await this.readPage(sub, after, head.cursor, abort.signal, range);
        if (!this.liveRequestCurrent(sub, serial, lifecycle, abort)) return;
        this.validatePage(page, sub, range, after, head.cursor);
        const normalized = normalizePage(page, firstPage), patches = detector.processBatch(normalized.records);
        cursor = Math.max(cursor, normalized.page.nextAfter, ...normalized.records.map(record => record.cursor));
        coverage = mergeCoverage(coverage, normalized.coverage);
        this.stats.pages++; this.stats.records += normalized.page.observations;
        sub.latestCoverage = mergeCoverage(sub.latestCoverage, normalized.coverage);
        sub.liveDetector = detector; sub.liveRange = range; sub.liveWatermark = cursor; sub.liveCursor = cursor;
        this.appendLiveReplayPage(sub, normalized);
        sub.liveDetectionKey = requestedKey; sub.liveAutoPriceWidth = sub.autoPriceWidth; sub.liveReady = true;
        const confirmed = Math.min(head.at, range.to - 1), confirmations = detector.confirmHead(confirmed, cursor);
        const status = this.status(sub, 'live', sub.initialized ? undefined : 'Current wall bootstrap; ordered history is still reconciling.');
        if (!sub.initialPublished) {
          sub.initialPublished = true;
          this.publish(sub, 'snapshot', detector.snapshot().filter(segment => segment.end === null), { ...status, provisional: !sub.replayPromoted });
          sub.livePublished.clear(); for (const segment of detector.snapshot().filter(segment => segment.end === null)) sub.livePublished.set(segment.id, segment);
          this.publishHistoricalSnapshot(sub, status);
        } else {
          this.publishLiveSnapshot(sub, detector.snapshot().filter(segment => segment.end === null), status);
          if (patches.length || confirmations.length) this.publishLivePatches(sub, [...patches, ...confirmations], status);
        }
        if (!normalized.page.hasMore) break;
        if (normalized.page.nextAfter <= after) throw new Error('Live bootstrap cursor did not advance');
        after = normalized.page.nextAfter; firstPage = false;
      }
      const finalCursor = Math.max(cursor, head.cursor);
      if (finalCursor > cursor) throw new Error('Live bootstrap did not confirm the durable head cursor');
      sub.liveCursor = finalCursor; sub.liveWatermark = head.cursor; sub.liveReady = true;
      sub.liveRetryCount = 0; sub.liveRetryAt = 0; clearTimeout(sub.liveRetryTimer); sub.liveRetryTimer = undefined;
      if (sub.followLive && sub.pendingCursor > sub.liveCursor) queueMicrotask(() => void this.catchUpLive(sub));
      if (!sub.busy && sub.initialized && !sub.replayPromoted) void this.finishReplay(sub, sub.replaySerial, lifecycle);
    } catch (error) {
      if (!abort.signal.aborted && this.liveRequestCurrent(sub, serial, lifecycle, abort)) this.liveFailure(sub, error);
    } finally {
      if (sub.serial === lifecycle && sub.liveSerial === serial) {
        sub.liveBusy = false; sub.liveAbort = undefined;
      }
    }
  }

  private async catchUpLive(sub: Subscription) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || !sub.followLive || !sub.liveReady || !sub.liveDetector || sub.liveBusy) return;
    if (this.now() < sub.liveRetryAt) return;
    const target = sub.pendingCursor, targetAt = sub.pendingAt;
    if (target <= sub.liveCursor) return;
    const serial = ++sub.liveSerial, lifecycle = sub.serial, afterStart = sub.liveCursor, to = targetAt + 1;
    const range = { from: sub.liveRange?.from ?? Math.max(1, targetAt - 60_000), to };
    const abort = new AbortController(); sub.liveAbort = abort; sub.liveBusy = true;
    try {
      let after = afterStart;
      for (;;) {
        const page = await this.readPage(sub, after, target, abort.signal, range);
        if (!this.liveRequestCurrent(sub, serial, lifecycle, abort)) return;
        this.validatePage(page, sub, range, after, target);
        const normalized = normalizePage(page, false), patches = sub.liveDetector.processBatch(normalized.records);
        sub.liveCursor = Math.max(sub.liveCursor, normalized.page.nextAfter, ...normalized.records.map(record => record.cursor));
        sub.liveWatermark = sub.liveCursor;
        sub.liveRange = range; sub.latestCoverage = mergeCoverage(sub.latestCoverage, normalized.coverage);
        this.appendLiveReplayPage(sub, normalized);
        this.stats.pages++; this.stats.records += normalized.page.observations;
        const confirmations = !normalized.page.hasMore ? sub.liveDetector.confirmHead(Math.min(targetAt, range.to - 1), target) : [];
        this.publishLivePatches(sub, [...patches, ...confirmations], this.status(sub));
        if (!normalized.page.hasMore) break;
        if (normalized.page.nextAfter <= after) throw new Error('Live depth cursor did not advance');
        after = normalized.page.nextAfter;
      }
      if (sub.liveCursor < target) throw new Error('Live depth pages stopped before their fixed durable watermark');
      sub.liveCursor = target; sub.liveWatermark = target; sub.liveRetryCount = 0; sub.liveRetryAt = 0; clearTimeout(sub.liveRetryTimer); sub.liveRetryTimer = undefined;
      if (sub.pendingCursor > sub.liveCursor) queueMicrotask(() => void this.catchUpLive(sub));
      if (!sub.busy && sub.initialized && !sub.replayPromoted) void this.finishReplay(sub, sub.replaySerial, lifecycle);
    } catch (error) {
      if (!abort.signal.aborted && this.liveRequestCurrent(sub, serial, lifecycle, abort)) this.liveFailure(sub, error);
    } finally {
      if (sub.serial === lifecycle && sub.liveSerial === serial) { sub.liveBusy = false; sub.liveAbort = undefined; }
    }
  }

  private appendLiveReplayPage(sub: Subscription, page: NormalizedPage) {
    const pageAfter = page.page.after, nextAfter = page.page.nextAfter;
    if (!Number.isSafeInteger(pageAfter) || !Number.isSafeInteger(nextAfter) || nextAfter < pageAfter) return;
    let buffer = sub.liveReplayBuffer;
    if (!buffer) buffer = sub.liveReplayBuffer = { after: pageAfter, through: pageAfter, pages: [], records: 0, bytes: 0 };
    if (pageAfter > buffer.through) {
      // A hole in accepted live pages is refilled from durable history at promotion.
      buffer.pages = []; buffer.records = 0; buffer.bytes = 0;
      buffer.after = pageAfter; buffer.through = pageAfter;
    }
    if (nextAfter <= buffer.through) return;
    const after = Math.max(pageAfter, buffer.through);
    const records = page.records.filter(record => record.cursor > after);
    const bytes = JSON.stringify(records).length;
    const batch: BufferedLivePage = { after, nextAfter, records, bytes };
    buffer.pages.push(batch); buffer.records += records.length; buffer.bytes += bytes; buffer.through = nextAfter;
    while (buffer.pages.length && (buffer.records > MAX_LIVE_REPLAY_BUFFER_RECORDS || buffer.bytes > MAX_LIVE_REPLAY_BUFFER_BYTES)) {
      const dropped = buffer.pages.shift()!;
      buffer.records -= dropped.records.length; buffer.bytes -= dropped.bytes;
      buffer.after = dropped.nextAfter;
      this.stats.liveTailEvictions++;
    }
    if (!buffer.pages.length) buffer.after = buffer.through;
  }

  private liveRequestCurrent(sub: Subscription, serial: number, lifecycle: number, abort: AbortController) {
    return !this.disposed && this.subscriptions.get(sub.id) === sub && sub.serial === lifecycle && sub.liveSerial === serial && !abort.signal.aborted;
  }
  private liveFailure(sub: Subscription, error: unknown) {
    this.stats.failures++;
    const message = error instanceof Error ? error.message : String(error);
    const wait = Math.min(15_000, 500 * 2 ** Math.min(sub.liveRetryCount++, 5));
    sub.liveRetryAt = this.now() + wait;
    this.publish(sub, 'patch', [], this.status(sub, 'stale', `Live depth catch-up · ${message}`));
    clearTimeout(sub.liveRetryTimer);
    sub.liveRetryTimer = setTimeout(() => {
      sub.liveRetryTimer = undefined;
      if (this.disposed || this.subscriptions.get(sub.id) !== sub || !sub.followLive) return;
      if (sub.liveReady) void this.catchUpLive(sub); else void this.ensureLiveBootstrap(sub);
    }, wait);
  }

  private publishHistoricalSnapshot(sub: Subscription, status: OrderWallStatus) {
    const patches = sub.detector.snapshot().filter(segment => segment.end !== null)
      .map(segment => ({ id: segment.id, segment, replaceValueRuns: true }));
    if (patches.length) this.publish(sub, 'patch', patches, status);
  }

  private publishHistorical(sub: Subscription, patches: OrderWallPatch[], status: OrderWallStatus) {
    if (!sub.initialPublished) return;
    const finalized = patches.filter((patch): patch is OrderWallPatch & { segment: OrderWallSegment } => Boolean(patch.segment && patch.segment.end !== null))
      .map(patch => ({ ...patch, replaceValueRuns: true }));
    if (finalized.length) this.publish(sub, 'patch', finalized, status);
  }

  private publishLiveSnapshot(sub: Subscription, segments: OrderWallSegment[], status: OrderWallStatus) {
    const next = new Map<string, OrderWallSegment>();
    const anchors = [...sub.livePublished.values()];
    for (const segment of segments) {
      const overlapsAtConfirmedTime = (value: OrderWallSegment) => value.epoch === segment.epoch
        && value.side === segment.side && value.price === segment.price && value.end === null
        && Math.min(value.start + value.durationMs, segment.start + segment.durationMs) >= Math.max(value.start, segment.start);
      const prior = anchors.find(overlapsAtConfirmedTime);
      const oldAlias = sub.liveAliases.get(segment.id);
      const aliasAnchor = oldAlias ? anchors.find(value => value.id === oldAlias && overlapsAtConfirmedTime(value)) : undefined;
      const id = prior?.id ?? aliasAnchor?.id ?? segment.id;
      const mapped = id === segment.id ? segment : { ...segment, id };
      sub.liveAliases.set(segment.id, id); next.set(id, mapped);
    }
    const patches: OrderWallPatch[] = [];
    for (const id of sub.livePublished.keys()) if (!next.has(id)) patches.push({ id, segment: null });
    for (const [id, segment] of next) patches.push({ id, segment, replaceValueRuns: true });
    sub.livePublished.clear(); for (const [id, segment] of next) sub.livePublished.set(id, segment);
    if (sub.initialPublished) this.publish(sub, 'patch', patches, { ...status, provisional: !sub.replayPromoted });
  }

  private publishLivePatches(sub: Subscription, patches: OrderWallPatch[], status: OrderWallStatus) {
    const mapped = patches.map(patch => {
      const id = sub.liveAliases.get(patch.id) ?? patch.id;
      const segment = patch.segment ? (patch.segment.id === id ? patch.segment : { ...patch.segment, id }) : null;
      if (segment?.end === null) sub.livePublished.set(id, segment); else sub.livePublished.delete(id);
      return { ...patch, id, segment };
    });
    if (!sub.initialPublished) return;
    this.publish(sub, 'patch', mapped, { ...status, provisional: !sub.replayPromoted });
  }

  private async finishReplay(sub: Subscription, serial: number, lifecycle: number) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.serial !== lifecycle || sub.replaySerial !== serial || !sub.initialized || sub.replayPromoted || sub.busy || sub.promoting) return;
    sub.promoting = true;
    const abort = sub.abort ?? new AbortController(); if (!sub.abort) sub.replayCatchupAbort = abort;
    try {
    if (sub.awaitingFreshHead) {
      const censored = sub.detector.censor(sub.staleMessage ?? 'Depth stream reset; prior wall end is unknown.');
      if (censored.length && sub.initialPublished) this.publishHistorical(sub, censored, this.status(sub, 'gap'));
    }
    if (!sub.initialPublished) {
      sub.initialPublished = true;
      this.publish(sub, 'snapshot', sub.detector.snapshot(), this.status(sub, 'stale', 'Showing recorded history while waiting for the live depth head.'));
    }
    if (sub.followLive && !sub.liveReady && sub.pendingAt > 0) return;
    if (sub.followLive && sub.liveReady) {
      for (;;) {
        const buffer = sub.liveReplayBuffer;
        if (!buffer) break;
        if (sub.cursor < buffer.after) {
          await this.bridgeReplayTo(sub, buffer.after, sub.pendingAt, abort, serial, lifecycle);
          continue;
        }
        let refillAt: number | undefined;
        for (const page of buffer.pages) {
          if (page.nextAfter <= sub.cursor) continue;
          if (page.after > sub.cursor) { refillAt = page.after; break; }
          const patches = sub.detector.processBatch(page.records.filter(record => record.cursor > sub.cursor));
          sub.cursor = Math.max(sub.cursor, page.nextAfter, ...page.records.map(record => record.cursor));
          this.publishHistorical(sub, patches, this.status(sub));
        }
        const currentBuffer = sub.liveReplayBuffer;
        if (!currentBuffer) break;
        if (refillAt !== undefined || sub.cursor < currentBuffer.after) {
          await this.bridgeReplayTo(sub, refillAt ?? currentBuffer.after, sub.pendingAt, abort, serial, lifecycle);
          continue;
        }
        if (sub.cursor < currentBuffer.through) {
          // The bounded tail has evicted the missing prefix. Refill it from the
          // durable source rather than joining across an unobserved interval.
          await this.bridgeReplayTo(sub, currentBuffer.through, sub.pendingAt, abort, serial, lifecycle);
          continue;
        }
        if (sub.cursor < sub.liveCursor) {
          await this.bridgeReplayTo(sub, sub.liveCursor, sub.pendingAt, abort, serial, lifecycle);
          continue;
        }
        sub.watermark = Math.max(sub.watermark ?? 0, sub.liveCursor);
        break;
      }
    }
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.serial !== lifecycle || sub.replaySerial !== serial) return;
    if (sub.followLive && sub.liveReady && sub.replayWatermarkHead
      && sub.replayWatermarkHead.epoch !== sub.pendingEpoch) {
      this.invalidateMarketReplayCache(sub.market);
      this.stats.cacheEpochRejects++;
      this.restart(sub, 'Depth source epoch changed; refreshing canonical history before promotion.');
      return;
    }
    if (sub.followLive && sub.liveReady && sub.liveBusy) {
      // A live request may have been in flight while history caught up. It has
      // not been applied to the live detector yet; let canonical catch-up fetch
      // it after the ownership switch.
      sub.liveSerial++; sub.liveAbort?.abort(); sub.liveAbort = undefined; sub.liveBusy = false;
    }
    this.promoteReplay(sub, sub.followLive && sub.liveReady);
    sub.retryCount = 0; clearTimeout(sub.retryTimer); sub.retryTimer = undefined;
    sub.liveReplayBuffer = undefined;
    if (sub.followLive && sub.pendingCursor > sub.liveCursor) queueMicrotask(() => void this.catchUpLive(sub));
    } catch (error) {
      if (!abort.signal.aborted && this.subscriptions.get(sub.id) === sub && sub.serial === lifecycle && sub.replaySerial === serial) {
        this.stats.failures++;
        const message = error instanceof Error ? error.message : String(error);
        this.publish(sub, 'patch', [], this.status(sub, 'stale', `Ordered replay catch-up · ${message}`));
        const wait = Math.min(15_000, 500 * 2 ** Math.min(sub.retryCount++, 5));
        clearTimeout(sub.retryTimer);
        sub.retryTimer = setTimeout(() => {
          sub.retryTimer = undefined;
          if (this.subscriptions.get(sub.id) === sub && sub.serial === lifecycle && sub.replaySerial === serial)
            void this.finishReplay(sub, serial, lifecycle);
        }, wait);
      }
    } finally {
      if (sub.serial === lifecycle && sub.replaySerial === serial) {
        sub.promoting = false;
        if (sub.replayCatchupAbort === abort) sub.replayCatchupAbort = undefined;
      }
    }
  }

  private async bridgeReplayTo(sub: Subscription, target: number, targetAt: number, abort: AbortController,
    serial: number, lifecycle: number) {
    if (target <= sub.cursor) return;
    const range = { from: sub.range.from, to: Math.max(sub.range.to, targetAt + 1) };
    let after = sub.cursor;
    for (;;) {
      const page = await this.readPage(sub, after, target, abort.signal, range);
      if (abort.signal.aborted || this.disposed || this.subscriptions.get(sub.id) !== sub
        || sub.serial !== lifecycle || sub.replaySerial !== serial) throw new DOMException('Replay invalidated', 'AbortError');
      this.validatePage(page, sub, range, after, target);
      if (sub.followLive && sub.replayWatermarkHead && page.head.epoch !== sub.replayWatermarkHead.epoch) {
        this.invalidateMarketReplayCache(sub.market);
        this.stats.cacheEpochRejects++;
        this.restart(sub, 'Depth source epoch changed during replay; refreshing canonical history before promotion.');
        throw new DOMException('Replay invalidated by source epoch change', 'AbortError');
      }
      const normalized = normalizePage(page, after === 0), patches = sub.detector.processBatch(normalized.records);
      sub.replayWatermarkHead = normalized.head;
      sub.watermark = Math.max(sub.watermark ?? 0, target);
      sub.cursor = Math.max(sub.cursor, normalized.page.nextAfter, ...normalized.records.map(record => record.cursor));
      sub.latestCoverage = mergeCoverage(sub.latestCoverage, normalized.coverage);
      this.stats.pages++; this.stats.records += normalized.page.observations;
      this.stats.replayBridgePages++; this.stats.replayBridgeRecords += normalized.page.observations;
      this.publishHistorical(sub, patches, this.status(sub));
      if (!normalized.page.hasMore) break;
      if (normalized.page.nextAfter <= after) throw new Error('Replay catch-up cursor did not advance');
      after = normalized.page.nextAfter;
    }
    if (sub.cursor < target) throw new Error('Replay catch-up stopped before the buffered live cursor');
  }

  private promoteReplay(sub: Subscription, takeLiveOwnership = sub.followLive && sub.liveReady) {
    const canonical = sub.detector.snapshot(), current = takeLiveOwnership ? sub.liveDetector?.snapshot().filter(segment => segment.end === null) ?? [] : [];
    const liveStatus = takeLiveOwnership && sub.liveDetector
      ? sub.liveDetector.status(sub.liveRange?.from ?? sub.range.from, sub.liveRange?.to ?? sub.range.to) : undefined;
    const historyStatus = sub.detector.status(sub.range.from, sub.range.to);
    // Only alias provisional IDs after the canonical lane has caught up through the
    // same durable cursor and both active segments overlap at a confirmed event time.
    // Same price alone is insufficient: gaps and epoch replacements create new IDs.
    const commonCursorConfirmed = Boolean(takeLiveOwnership && sub.liveDetector && liveStatus
      && sub.cursor >= sub.liveCursor && (sub.watermark ?? -1) >= (sub.liveWatermark ?? Infinity));
    const commonConfirmedAt = Math.min(liveStatus?.lastConfirmedAt ?? -Infinity, historyStatus.lastConfirmedAt ?? -Infinity);
    const aliases = new Map<string, string>(), desired = new Map<string, OrderWallSegment>();
    for (const segment of canonical) {
      let id = segment.id;
      if (segment.end === null) {
        const anchor = commonCursorConfirmed && commonConfirmedAt >= Math.max(0, segment.start)
          ? current.find(value => value.end === null && value.epoch === segment.epoch
            && value.side === segment.side && value.price === segment.price
            && commonConfirmedAt >= Math.max(value.start, segment.start))
          : undefined;
        if (anchor) id = sub.liveAliases.get(anchor.id) ?? anchor.id;
      }
      aliases.set(segment.id, id);
      desired.set(id, id === segment.id ? segment : { ...segment, id });
    }
    const patches: OrderWallPatch[] = [];
    for (const id of sub.rendered.keys()) if (!desired.has(id)) patches.push({ id, segment: null });
    for (const [id, segment] of desired) patches.push({ id, segment, replaceValueRuns: true });
    if (takeLiveOwnership) {
      sub.liveAliases = aliases; sub.liveDetector = sub.detector; sub.liveCursor = sub.cursor; sub.liveWatermark = sub.watermark;
      sub.liveRange = { from: sub.range.from, to: sub.range.to };
      sub.liveDetectionKey = `${detectionKey(sub.settings)}:${sub.autoPriceWidth}`; sub.liveAutoPriceWidth = sub.autoPriceWidth; sub.liveReady = true;
      sub.livePublished.clear(); for (const [id, segment] of desired) if (segment.end === null) sub.livePublished.set(id, segment);
    }
    // Switch status ownership with geometry so the promotion batch cannot report the
    // stale/empty bootstrap lane after canonical history has caught up.
    const status = takeLiveOwnership ? { ...this.status(sub), provisional: false }
      : this.status(sub, 'stale', 'Recorded viewport is visible; live depth head is not following this view.');
    this.publish(sub, 'patch', patches, status);
    sub.replayPromoted = true;
  }

  private async readPage(sub: Subscription, after: number, watermark: number | undefined, signal: AbortSignal,
    range: { from: number; to: number } = sub.range): Promise<Page> {
    const params = new URLSearchParams({ from: String(range.from), to: String(range.to), after: String(after), limit: String(PAGE_LIMIT) });
    if (watermark !== undefined) params.set('watermark', String(watermark));
    if (sub.market === 'binance-spot') params.set('market', 'spot');
    for (let attempt = 0; ; attempt++) {
      const response = await this.request(`/market-data/v1/depth-observations?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      const data = await response.json() as Page & { error?: string };
      this.stats.bytes += Number(response.headers.get('content-length') ?? JSON.stringify(data).length);
      if (response.ok) return data;
      const message = data.error ?? `Order Wall history HTTP ${response.status}`;
      if (response.status === 503 && attempt < 4) { await retryDelay(signal, Math.min(4_000, 500 * 2 ** attempt)); continue; }
      throw new Error(message);
    }
  }

  private validatePage(page: Page, sub: Subscription, range: { from: number; to: number }, after: number, watermark: number) {
    const market = sub.market === 'binance-spot' ? 'spot' : 'perpetual';
    const instrument = sub.market === 'binance-spot' ? 'binance:spot:BTCUSDT' : 'binance:perpetual:BTCUSDT';
    if (page.version !== 1 || page.market !== market || page.instrument !== instrument || page.feed !== depthSource(market)
      || page.from !== range.from || page.to !== range.to || page.watermark !== watermark
      || !page.head || page.head.cursor !== watermark || !Number.isSafeInteger(page.head.cursor)
      || !Number.isSafeInteger(page.head.epoch) || !Number.isFinite(page.head.at) || page.head.at < 0
      || (after !== 0 && page.page?.after !== after) || !Number.isSafeInteger(page.page?.after) || !Number.isSafeInteger(page.page?.nextAfter) || !Array.isArray(page.observations)
      || page.observations.length > PAGE_LIMIT + 10_000 || page.page.sameMillisecondClosed !== true) throw new Error('Invalid raw depth observation page contract');
  }

  private status(sub: Subscription, forced?: OrderWallStatus['state'], message?: string): OrderWallStatus {
    // `range` is the immutable canonical replay query. Public coverage must
    // describe the current chart window, which may have slid while replay runs.
    const { from, to } = sub.viewportRange;
    const detector = (sub.liveDetector ?? sub.detector).status(from, to), coverage = sub.latestCoverage;
    const gap = Boolean(coverage?.gaps.length);
    const retentionStart = Number.isFinite(coverage?.earliestRetainedAt) ? coverage!.earliestRetainedAt! : undefined;
    const retentionGap = retentionStart !== undefined && from < retentionStart;
    const clockRegressed = Boolean(detector.clockRegressed);
    // `to` is exclusive, while the API's `confirmedTo` is the inclusive
    // timestamp of the latest confirmed observation. A head at H therefore
    // confirms a viewport ending at H + 1 ms.
    const tailPending = Boolean(coverage && to > coverage.confirmedTo + 1);
    const incomplete = sub.viewportClipped || retentionGap || Boolean(coverage?.partial) || !coverage || tailPending || clockRegressed;
    const state = sub.awaitingFreshHead ? 'gap' : forced === 'gap' ? 'gap' : sub.staleMessage ? 'stale'
      : forced ?? (gap ? 'gap' : incomplete ? 'stale' : detector.state);
    const statusMessage = sub.awaitingFreshHead || (state === 'stale' && sub.staleMessage) ? sub.staleMessage : message ?? sub.staleMessage;
    return { ...detector, state, ...(!sub.replayPromoted && sub.liveReady ? { provisional: true } : {}), ...(statusMessage ? { message: statusMessage } : {}),
      ...(retentionStart !== undefined ? { retentionStart } : {}),
      coverage: { from, to, complete: !incomplete && !gap, partial: incomplete || gap,
        ...(clockRegressed ? { reason: detector.coverage?.reason } : retentionGap ? { reason: 'Requested range begins before retained depth history.' }
          : coverage?.reason || sub.viewportClipped || tailPending ? { reason: sub.viewportClipped ? 'Requested viewport exceeds retained replay bounds.'
            : tailPending ? UNCONFIRMED_DURABLE_TAIL : coverage?.reason } : {}) } };
  }

  private publish(sub: Subscription, kind: 'snapshot' | 'patch', data: OrderWallSegment[] | OrderWallPatch[], status: OrderWallStatus) {
    sub.latestStatus = status;
    let segments: OrderWallSegment[] | undefined, patches: OrderWallPatch[] | undefined;
    if (kind === 'snapshot') {
      segments = data as OrderWallSegment[];
      sub.rendered.clear(); for (const segment of segments) sub.rendered.set(segment.id, segment);
    } else {
      const source = data as OrderWallPatch[];
      for (const patch of source) {
        if (patch.segment) sub.rendered.set(patch.id, patch.segment); else sub.rendered.delete(patch.id);
      }
      patches = source.map(patch => patch.segment
        ? { ...patch, segment: { ...patch.segment, valueRuns: patch.replaceValueRuns ? patch.segment.valueRuns : [] } } : patch);
    }
    this.emit({ type: 'order-wall-batch', ids: [sub.id], key: sub.key, generation: sub.generation,
      batchId: ++sub.batch, kind, ...(segments ? { segments } : {}), ...(patches ? { patches } : {}), status });
  }

  private publishUnavailable(sub: Subscription, message: string) {
    this.publish(sub, 'snapshot', [], { state: 'unavailable', message, coverage: { from: sub.request.from, to: sub.request.to, complete: false, partial: true, reason: message } });
  }

  private readCache(sub: Subscription) {
    if (sub.followLive && sub.pendingAt > 0) {
      const marketEntries = [...this.replayCache.values()].filter(candidate => candidate.market === sub.market);
      if (marketEntries.some(candidate => candidate.head.epoch !== sub.pendingEpoch)) {
        this.invalidateMarketReplayCache(sub.market);
        this.stats.cacheEpochRejects++;
        return undefined;
      }
    }
    const key = rangeKey(sub), exact = this.replayCache.get(key);
    const entry = exact && cacheIdentityMatches(exact, sub) ? exact : [...this.replayCache.values()]
      .filter(candidate => cacheIdentityMatches(candidate, sub) && cacheIsClean(candidate)
        && candidate.from <= sub.range.from && candidate.to > sub.range.from)
      .sort((a, b) => Math.abs(sub.range.to - a.to) - Math.abs(sub.range.to - b.to)
        || (a.to - a.from) - (b.to - b.from))[0];
    if (!entry) return undefined;
    this.replayCache.delete(entry.key); this.replayCache.set(entry.key, entry); this.stats.cacheHits++;
    return entry;
  }
  private rememberCache(key: string, sub: Subscription, watermark: number, pages: NormalizedPage[], bytes: number) {
    if (bytes > MAX_REPLAY_CACHE_ENTRY_BYTES || !pages.at(-1) || pages.at(-1)!.page.hasMore) return;
    const prior = this.replayCache.get(key);
    if (prior) { this.replayCacheBytes -= prior.bytes; this.replayCache.delete(key); }
    while (this.replayCache.size >= MAX_REPLAY_CACHE_ENTRIES || this.replayCacheBytes + bytes > MAX_REPLAY_CACHE_BYTES) {
      const oldestKey = this.replayCache.keys().next().value as string | undefined; if (!oldestKey) break;
      const oldest = this.replayCache.get(oldestKey)!; this.replayCacheBytes -= oldest.bytes; this.replayCache.delete(oldestKey);
    }
    if (!sub.latestCoverage) return;
    const entry: ReplayCacheEntry = { key, ...cacheIdentity(sub.market), from: sub.range.from, to: sub.range.to,
      watermark, head: pages.at(-1)!.head, pages, bytes, coverage: { ...sub.latestCoverage, gaps: [...sub.latestCoverage.gaps] } };
    this.replayCache.set(key, entry); this.replayCacheBytes += bytes;
  }
  private invalidateMarketReplayCache(market: OrderWallMarket) {
    for (const [key, entry] of this.replayCache) {
      if (entry.market !== market) continue;
      this.replayCache.delete(key); this.replayCacheBytes -= entry.bytes;
    }
  }
  diagnostics() { return { ...this.stats, cacheEntries: this.replayCache.size, cacheBytes: this.replayCacheBytes, subscriptions: [...this.subscriptions.values()].map(sub => {
    const buffer = sub.liveReplayBuffer, firstPage = buffer?.pages[0], lastPage = buffer?.pages.at(-1);
    return { id: sub.id, market: sub.market, range: sub.range, generation: sub.generation, watermark: sub.watermark,
      cursor: sub.cursor, liveCursor: sub.liveCursor, pendingCursor: sub.pendingCursor, replayPromoted: sub.replayPromoted,
      liveTailBuffer: buffer ? { after: buffer.after, through: buffer.through,
        firstCursor: firstPage?.records[0]?.cursor ?? buffer.after,
        lastCursor: lastPage?.records.at(-1)?.cursor ?? lastPage?.nextAfter ?? buffer.through,
        pages: buffer.pages.length, records: buffer.records, bytes: buffer.bytes } : undefined,
      busy: sub.busy, initialized: sub.initialized };
  }) }; }
  dispose() { this.disposed = true; for (const id of [...this.subscriptions.keys()]) this.unsubscribe(id); this.replayCache.clear(); this.replayCacheBytes = 0; }
}

const MAX_REPLAY_CACHE_ENTRIES = 4;
const MAX_REPLAY_CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_LIVE_REPLAY_BUFFER_RECORDS = 4_000;
const MAX_LIVE_REPLAY_BUFFER_BYTES = 8 * 1024 * 1024;

function tickSize(market: OrderWallMarket) { return market === 'binance-spot' ? 0.01 : 0.1; }
function followsLiveViewportSlide(previous: { from: number; to: number }, next: { from: number; to: number }, wasLive: boolean, isLive: boolean) {
  if (!wasLive || !isLive) return false;
  const previousWidth = previous.to - previous.from, nextWidth = next.to - next.from;
  const minimumWidth = Math.min(previousWidth, nextWidth);
  if (!(minimumWidth > 0)) return false;
  const fromAdvance = next.from - previous.from, toAdvance = next.to - previous.to;
  const movementLimit = Math.max(60_000, Math.min(300_000, minimumWidth * 0.2));
  const overlap = Math.max(0, Math.min(previous.to, next.to) - Math.max(previous.from, next.from));
  return fromAdvance >= 0 && toAdvance > 0
    && fromAdvance <= movementLimit && toAdvance <= movementLimit
    && Math.abs(previousWidth - nextWidth) <= movementLimit
    && overlap / minimumWidth >= 0.8;
}
function validAutoPriceWidth(value: number | undefined, tick: number) {
  return Number.isFinite(value) && value! >= tick && value! <= 1_000_000
    ? Number(value!.toPrecision(12)) : Math.max(50, tick);
}
function keyFor(market: OrderWallMarket, settings: OrderWallsSettings) { return `${market}:${detectionKey(settings)}`; }
function detectionKey(settings: OrderWallsSettings) { return JSON.stringify([settings.method, settings.thresholdUsd, settings.relativeFloorUsd, settings.relativePercentile, settings.exitRatio, settings.minDurationMs, settings.aggregation]); }
function numericLevels(levels?: ReadonlyArray<readonly [string, string]>) {
  return (levels ?? []).map(([price, quantity]) => [Number(price), Number(quantity)] as const).filter(([price, quantity]) => Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity >= 0);
}
function normalizeScope(value: unknown): Partial<OrderWallBookScope> {
  const scope = value && typeof value === 'object' ? value as Record<string, any> : {};
  return { maxLevelsPerSide: 5_000, bidComplete: scope.bids?.complete === true, askComplete: scope.asks?.complete === true,
    ...(Number.isFinite(scope.bids?.lowerBound) ? { bidFloor: Number(scope.bids.lowerBound) } : {}),
    ...(Number.isFinite(scope.asks?.upperBound) ? { askCeiling: Number(scope.asks.upperBound) } : {}) };
}
function normalizePage(page: Page, includeSeed: boolean): NormalizedPage {
  const records: OrderWallDepthRecord[] = [];
  if (includeSeed && page.seed) records.push({ kind: 'snapshot', at: page.seed.at, cursor: page.seed.cursor, epoch: page.seed.epoch,
    bids: numericLevels(page.seed.bids), asks: numericLevels(page.seed.asks), bookScope: normalizeScope(page.seed.bookScope) });
  for (const item of page.observations) records.push({ ...item, bids: numericLevels(item.bids), asks: numericLevels(item.asks), bookScope: normalizeScope(item.bookScope) });
  return { watermark: page.watermark, head: { ...page.head }, page: { ...page.page }, records, coverage: { ...page.coverage, gaps: [...page.coverage.gaps] } };
}
function validDepthHead(notice: Extract<DepthHeadNotice, { type: 'head' }>): boolean {
  return Number.isSafeInteger(notice.cursor) && notice.cursor >= 0
    && Number.isFinite(notice.at) && notice.at > 0 && Number.isSafeInteger(notice.epoch);
}
function rangeKey(sub: Pick<Subscription, 'market'|'range'>) { return `${sub.market}:BTCUSDT:${sub.range.from}:${sub.range.to}`; }
function cacheIdentity(market: OrderWallMarket) {
  const sourceMarket = market === 'binance-spot' ? 'spot' : 'perpetual';
  return { market, instrument: market === 'binance-spot' ? 'binance:spot:BTCUSDT' : 'binance:perpetual:BTCUSDT', feed: depthSource(sourceMarket), version: 1 };
}
function cacheIdentityMatches(entry: ReplayCacheEntry, sub: Subscription) {
  const expected = cacheIdentity(sub.market);
  return entry.version === expected.version && entry.market === expected.market
    && entry.instrument === expected.instrument && entry.feed === expected.feed;
}
function cacheIsClean(entry: ReplayCacheEntry) {
  const coverage = entry.coverage;
  return entry.pages.length > 0 && !coverage.partial && coverage.gaps.length === 0
    && coverage.confirmedTo >= entry.to
    && (!Number.isFinite(coverage.earliestRetainedAt) || coverage.earliestRetainedAt! <= entry.from);
}
function mergeCoverage(previous: Page['coverage'] | undefined, next: Page['coverage']): Page['coverage'] {
  const normalizedNext = normalizeCoverage(next);
  if (!previous) return { ...normalizedNext, gaps: dedupeGaps(next.gaps) };
  const normalizedPrevious = normalizeCoverage(previous);
  const earliest = [previous.earliestRetainedAt, next.earliestRetainedAt]
    .filter((value): value is number => Number.isFinite(value)).sort((a, b) => a - b)[0];
  const reason = normalizedNext.reason ?? normalizedPrevious.reason;
  return {
    ...normalizedNext,
    confirmedTo: Math.max(previous.confirmedTo, next.confirmedTo),
    partial: normalizedPrevious.partial || normalizedNext.partial,
    ...(earliest !== undefined ? { earliestRetainedAt: earliest } : {}),
    ...(reason ? { reason } : {}),
    gaps: dedupeGaps([...previous.gaps, ...next.gaps]),
  };
}
function normalizeCoverage(coverage: Page['coverage']): Page['coverage'] {
  // API v1 marks an exclusive `head.at + 1` page tail partial even though the
  // head itself confirms the final millisecond. Evaluate that condition against
  // the current viewport's `to` in status(); keep all other partial reasons.
  if (!coverage.partial || coverage.reason !== UNCONFIRMED_DURABLE_TAIL) return coverage;
  const { reason: _reason, ...tail } = coverage;
  return { ...tail, partial: false };
}
function dedupeGaps(gaps: Page['coverage']['gaps']) {
  const unique = new Map<string, Page['coverage']['gaps'][number]>();
  for (const gap of gaps) unique.set(`${gap.epoch}:${gap.cursor}:${gap.at}:${gap.reason}`, gap);
  return [...unique.values()].sort((a, b) => a.cursor - b.cursor || a.at - b.at);
}
function macrotaskYield() { return new Promise<void>(resolve => setTimeout(resolve, 0)); }
function retryDelay(signal: AbortSignal, ms: number) { return new Promise<void>((resolve, reject) => {
  const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(); }
  function cancel() { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new DOMException('Aborted', 'AbortError')); }
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
}); }

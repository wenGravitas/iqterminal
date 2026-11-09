import {compactWallPresentation,replayCompactWallPresentation,type CompactWallPresentation} from './compact-wall-presentation';
import {wallHistoryPresentation,wallCompactPresentation} from './wall-history-presentation-cache';
import {wallReadControlScheduler} from './prepared-wall-read-lease';
import {PreparedWallSourceChangedError} from './prepared-wall-history';
import {PreparedWallPreparationError} from './prepared-wall-admission';
import {
  DEFAULT_ORDER_WALLS_SETTINGS,
  orderWallsSettings,
  ORDER_WALL_MAX_SEGMENTS,
  type OrderWallMarket,
  type OrderWallPatch,
  type OrderWallSegment,
  type OrderWallStatus,
  type OrderWallsSettings,
} from './order-walls';
import type { Command, Event } from './protocol';
import {
  OrderWallsArchiveCurrentPoller,
  loadOrderWallsArchive,
  orderWallsArchiveAvailability,
  orderWallsArchiveCurrentRequest,
  orderWallsArchiveDerivationsExact,
  orderWallsArchiveIdentity,
  orderWallsArchiveProfileId,
  OrderWallsArchiveProjector,
  type OrderWallsArchiveCandidate,
  type OrderWallsArchiveCurrentPage,
  type OrderWallsArchivePageMetrics,
  type OrderWallsArchiveRequest,
  type OrderWallsArchiveResult,
  type OrderWallsArchiveResumeState,
  type OrderWallsArchiveUpdate,
} from './order-walls-archive';

export interface OrderWallsArchiveSubscriptionRequest extends OrderWallsArchiveRequest {
  currentOnly?:boolean;
  followLive?: boolean;
}

type WallCommand = Extract<Command, { type: 'order-wall-subscribe' | 'order-wall-unsubscribe' | 'order-wall-settings' | 'order-wall-viewport' | 'order-wall-retry' }>;

const MAX_CURRENT_RING_PAGES = 4_096;
const MAX_CURRENT_RING_PATCHES = 100_000;
const MAX_CURRENT_RING_BYTES = 16 * 1024 * 1024;
const MAX_SUBSCRIPTION_ARCHIVE_GAPS = 256;

interface Subscription {
  id: string;
  key: string;
  generation: number;
  batch: number;
  request: OrderWallsArchiveSubscriptionRequest;
  /** Latest chart range, separate from the immutable range of an active fixed-H job. */
  viewport: { from: number; to: number; followLive?: boolean };
  pendingViewport?: { from: number; to: number; followLive?: boolean };
  historyCoverageCarry?: OrderWallStatus['coverage'];
  historyArchiveCarry?: OrderWallStatus['archive'];
  settings: OrderWallsSettings;
  group?: CurrentGroup;
  historyJob?: SharedHistoryJob;
  historyProjector?: OrderWallsArchiveProjector;
  historyPresentation?:ReadonlyMap<string,OrderWallSegment>;
  cachedHistory?: boolean;
  warmReplay?:WarmReplay;
  bridgeProjector?: OrderWallsArchiveProjector;
  /** Current checkpoint ID -> canonical archive entry ID, proved at historyFence. */
  bridgeEntryIds?: Map<string, string>;
  tailProjector?: OrderWallsArchiveProjector;
  historyFence?: { cursor: number; at: number; epoch: number };
  historyFenceState?: ReturnType<OrderWallsArchiveProjector['selectedState']>;
  historyStatus?: OrderWallStatus;
  currentState: 'loading' | 'live' | 'stale' | 'unavailable';
  currentMessage?: string;
  currentAt?: number;
  currentScope?: OrderWallStatus['bookScope'];
  currentMidpoint?: string | null;
  currentGaps: NonNullable<OrderWallStatus['archive']>['gaps'];
  currentGapsTruncated: boolean;
  archiveStarted: boolean;
  initialPublished: boolean;
  continuityLost: boolean;
  lastPublished: Map<string, OrderWallSegment>;
}

interface SharedHistoryJob {
  preparationRetryToken?:string;
  preparationNeedsRevision?:boolean;
  key: string;
  request: OrderWallsArchiveRequest;
  fence?: { cursor: number; at: number; epoch: number };
  fenceState?: ReturnType<OrderWallsArchiveProjector['selectedState']>;
  abort: AbortController;
  subscribers: Set<Subscription>;
  latest?: OrderWallsArchiveUpdate;
  resume?: OrderWallsArchiveResumeState;
  settled: boolean;
  initialProjector?: OrderWallsArchiveProjector;
}

interface CurrentGroup {
  key: string;
  request: NonNullable<ReturnType<typeof orderWallsArchiveCurrentRequest>>;
  settings: OrderWallsSettings;
  poller: OrderWallsArchiveCurrentPoller;
  subscribers: Set<Subscription>;
  projector?: OrderWallsArchiveProjector;
  bootstrap?: OrderWallsArchiveCurrentPage;
  head?: NonNullable<OrderWallsArchiveCurrentPage['head']>;
  cursor: number;
  pages: OrderWallsArchiveCurrentPage[];
  ringBytes: number;
  ringPatches: number;
  ringFloorCursor: number;
  ringOverflow: boolean;
  profileExact: boolean;
  currentValid: boolean;
  currentCatchingUp: boolean;
  currentMessage?: string;
  profileStatus?: OrderWallsArchiveCurrentPage['profileStatus'];
}

interface WarmTiming {kind:'encode'|'replay';identity:string;queueMs:number;elapsedMs:number;firstContentMs?:number;segments:number;runs:number;state:'ready'|'cancelled'|'failed'}
interface WarmEntry {presentation?:ReadonlyMap<string,OrderWallSegment>;compact?:CompactWallPresentation;status:OrderWallStatus;bytes:number;runs:number;segments:number;signature?:string;expired?:boolean;replay?:WarmReplay;timer:ReturnType<typeof setTimeout>}
interface WarmReplay {key:string;entry:WarmEntry;abort:AbortController;presentation:Map<string,OrderWallSegment>;subscribers:Set<Subscription>;settled:boolean;runs:number}
/** Worker-owned adapter for fixed-profile history and the current selected-profile tail. */
export class OrderWallsArchiveService {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly groups = new Map<string, CurrentGroup>();
  /** Same fixed profile/range/fence shares one bounded loader and projector. */
  private readonly historyJobs = new Map<string, SharedHistoryJob>();
  private readonly warmHistory=new Map<string,WarmEntry>();
  private readonly warmReplays=new Set<WarmReplay>();
  private readonly warmBuilds=new Set<{key:string;abort:AbortController}>();
  private warmBuildTail:Promise<void>=Promise.resolve();
  private readonly warmTimings:WarmTiming[]=[];
  private recordWarmTiming(timing:WarmTiming){this.warmTimings.push(timing);if(this.warmTimings.length>16)this.warmTimings.shift();}
  private sequence = 0;
  private disposed = false;
  readonly stats = { warmAdmissions:0,warmCapacityMisses:0,warmInvalidMisses:0,warmCompactBuilds:0,warmRevisionReuses:0,warmValidatedReuses:0,warmBuildFailures:0,warmDecodeFailures:0,incrementalSegments:0,fullReconciliations:0,comparisonVisits:0,subscriptions: 0, groups: 0, historyRequests: 0, currentPages: 0, historyPages: 0, bytes: 0,
    historyBytes: 0, historyResponseHeadersMs: 0, historyBodyReadMs: 0, historyJsonParseMs: 0, historyValidationMs: 0,
    historyProjectorApplyMs: 0, historyUpdateCallbackMs: 0, historyEventLoopYieldDelayMs: 0,
    currentPatches: 0, ringDrops: 0, failures: 0 };
  private readonly historyPageMetrics: OrderWallsArchivePageMetrics[] = [];
  private historyPageMetricCount = 0;

  constructor(private readonly emit: (event: Event) => void, private readonly request: typeof fetch = (...args) => fetch(...args), private readonly now = Date.now,private readonly compactPreparedAboveBytes=16*1024*1024) {if(!Number.isSafeInteger(compactPreparedAboveBytes)||compactPreparedAboveBytes<0||compactPreparedAboveBytes>16*1024*1024)throw Error('Invalid compact wall threshold');}

  command(command: WallCommand) {
    if (command.type === 'order-wall-subscribe') this.subscribe(command.id, command.request);
    else if (command.type === 'order-wall-unsubscribe') this.unsubscribe(command.id);
    else if (command.type === 'order-wall-retry') this.retry(command.id);
    else if (command.type === 'order-wall-settings') this.updateSettings(command.id, command.settings);
    else this.updateViewport(command.id, command.from, command.to, command.to >= this.now() - 60_000);
  }

  subscribe(id: string, rawRequest: OrderWallsArchiveSubscriptionRequest) {
    this.unsubscribe(id);
    const settings = orderWallsSettings(rawRequest.settings);
    const request = { ...rawRequest, settings };
    const identity = orderWallsArchiveIdentity(request) ?? `${request.market}:${JSON.stringify(settings)}`;
    const sub: Subscription = { id, key: identity, generation: ++this.sequence, batch: 0, request, settings,
      viewport: { from: request.from, to: request.to, followLive: request.followLive },
      currentState: 'loading', currentGaps: [], currentGapsTruncated: false,
      archiveStarted: false, initialPublished: false, continuityLost: false, lastPublished: new Map() };
    this.subscriptions.set(id, sub); this.stats.subscriptions = this.subscriptions.size;
    this.publish(sub, 'snapshot', [], this.status(sub));
    if (settings.mode !== 'top-levels') {
      sub.currentState = 'unavailable'; sub.currentMessage = 'Threshold Walls use the existing raw depth service.';
      this.publish(sub, 'snapshot', [], this.status(sub)); return;
    }
    if(!request.currentOnly)this.showWarmHistory(sub);
    if (request.followLive) this.attachCurrentGroup(sub);
    else void this.loadHistory(sub);
  }

  updateSettings(id: string, settings: OrderWallsSettings) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    this.subscribe(id, { ...sub.request, settings: orderWallsSettings(settings) });
  }

  updateViewport(id: string, from: number, to: number, followLive?: boolean) {
    const sub = this.subscriptions.get(id); if (!sub || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
    // A viewport is a presentation window into the retained projection. Keep its
    // wider archive request and fixed watermark while pan/zoom stays covered.
    // The current lane continues independently even when the chart pans away.
    const nextViewport = { from, to, followLive: followLive ?? to >= this.now() - 60_000 };
    const previousViewport = sub.viewport;
    sub.viewport = nextViewport;
    if (from >= sub.request.from && to <= sub.request.to) {
      // The initial native-candle range can be much wider than a restored/panned
      // view. Do not replay hours of offscreen prefixes before useful content.
      const loading=!sub.archiveStarted||sub.historyJob&&!sub.historyJob.settled;
      const beforeVisible=(sub.historyStatus?.archive?.loadedThrough??sub.request.from)<from;
      if(loading&&beforeVisible&&to-from<(sub.request.to-sub.request.from)*.75){
        // The current bootstrap can still be in flight. Keep its shared socket
        // and apply the visible bounds before it admits the historical job.
        if(!sub.archiveStarted){const previous=sub.request;sub.request={...sub.request,...nextViewport};this.releaseWarmInterests(previous);sub.pendingViewport=undefined;return;}
        this.subscribe(id,{...sub.request,...nextViewport});return;
      }
      sub.pendingViewport = undefined; return;
    }
    if (canCoalesceLiveViewport(previousViewport, nextViewport)) {
      sub.pendingViewport = nextViewport;
      if (sub.historyJob?.settled) this.tryStartPendingViewportHistory(sub);
      return;
    }
    this.subscribe(id, { ...sub.request, ...nextViewport });
  }

  retry(id: string) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    const job = sub.historyJob;
    if (job) {
      if (!job.settled) return;
      {
        job.preparationRetryToken=crypto.randomUUID();
        job.abort = new AbortController();
        job.settled = false;
        for (const subscriber of job.subscribers) {
          const previous = subscriber.historyStatus ?? job.latest?.status;
          const previousArchive = previous?.archive ?? emptyArchiveStatus(job.request, 'partial');
          subscriber.historyStatus = { ...(previous ?? { state: 'loading' as const }), state: 'loading',
            message: job.resume ? 'Resuming the validated Order Walls history prefix.' : 'Retrying Order Walls history with displayed data retained.',
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true },
            archive: { ...previousArchive, state: 'loading', requestComplete: false, rangeComplete: false,
              resumeAfter: undefined, retryable: undefined, reason: undefined } };
          this.publish(subscriber, 'patch', [], this.status(subscriber));
        }
        if(!job.resume)for(const subscriber of job.subscribers)if(subscriber.historyProjector||subscriber.historyPresentation?.size)subscriber.cachedHistory=true;
        this.runHistoryJob(job, job.resume);
        return;
      }
    }
    this.subscribe(id, sub.request);
  }

  unsubscribe(id: string) {
    const sub = this.subscriptions.get(id); if (!sub) return;
    this.subscriptions.delete(id);this.releaseWarmInterests(sub.request.currentOnly?undefined:sub.request,sub.historyJob?.request);this.releaseWarmReplay(sub);
    const historyJob = sub.historyJob; sub.historyJob = undefined;
    if (historyJob) {
      historyJob.subscribers.delete(sub);
      if (!historyJob.subscribers.size) {
        this.historyJobs.delete(historyJob.key);
        if (!historyJob.settled) historyJob.abort.abort();
      }
    }
    if (sub.group) {
      const group = sub.group; group.subscribers.delete(sub); sub.group = undefined;
      if (!group.subscribers.size) { group.poller.stop(); this.groups.delete(group.key); }
    }
    this.stats.subscriptions = this.subscriptions.size; this.stats.groups = this.groups.size;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const sub of [...this.subscriptions.values()]) this.unsubscribe(sub.id);
    for (const group of this.groups.values()) group.poller.stop();
    this.groups.clear(); this.stats.groups = 0;
    for(const build of this.warmBuilds)build.abort.abort();
    for(const entry of this.warmHistory.values())clearTimeout(entry.timer);this.warmHistory.clear();
  }

  diagnostics() {
    const projectors=new Set<OrderWallsArchiveProjector>();
    for(const sub of this.subscriptions.values())for(const p of [sub.historyProjector,sub.tailProjector,sub.bridgeProjector])if(p)projectors.add(p);
    for(const group of this.groups.values())if(group.projector)projectors.add(group.projector);
    for(const job of this.historyJobs.values())for(const p of [job.initialProjector,job.latest?.projector,job.resume?.projector])if(p)projectors.add(p);
    return { ...this.stats, projections:[...projectors].map(projector=>projector.diagnostics()), subscriptions: this.subscriptions.size, groups: this.groups.size,
      historyJobs: this.historyJobs.size,readerControl:wallReadControlScheduler.diagnostics(),
      warmTimings:this.warmTimings.map(timing=>({...timing})),warmEntries:this.warmHistory.size,warmBuilds:this.warmBuilds.size,warmReplayJobs:this.warmReplays.size,warmReplaySegments:[...this.warmHistory.values()].reduce((n,entry)=>n+(entry.replay?.presentation.size??0),0),warmReplayRuns:[...this.warmHistory.values()].reduce((n,entry)=>n+(entry.replay?.runs??0),0),warmCompactEntries:[...this.warmHistory.values()].filter(entry=>entry.compact).length,warmReplayConsumers:[...this.warmHistory.values()].reduce((n,entry)=>n+(entry.replay?.subscribers.size??0),0),warmSegments:[...this.warmHistory.values()].reduce((n,entry)=>n+entry.segments,0),warmRuns:[...this.warmHistory.values()].reduce((n,entry)=>n+entry.runs,0),warmBytes:[...this.warmHistory.values()].reduce((n,entry)=>n+entry.bytes,0),
      historyConsumers: [...this.historyJobs.values()].reduce((sum, job) => sum + job.subscribers.size, 0),
      ringPages: [...this.groups.values()].reduce((sum, group) => sum + group.pages.length, 0),
      ringBytes: [...this.groups.values()].reduce((sum, group) => sum + group.ringBytes, 0),
      recentHistoryRequests:this.historyPageMetrics.slice(-16),
      historyPageTiming: summarizeArchivePageTimings(this.historyPageMetrics, this.historyPageMetricCount) };
  }

  private attachCurrentGroup(sub: Subscription) {
    const request = orderWallsArchiveCurrentRequest(sub.request, 0);
    if (!request) { sub.currentState = 'unavailable'; sub.currentMessage = 'No exact current Top Levels archive profile exists for these settings.'; this.publish(sub, 'snapshot', [], this.status(sub)); return; }
    const key = JSON.stringify([request.profile, request.market, request.instrument, request.aggregation, request.bandPercent,
      request.confirmationMs, request.selectionTopN, request.minimumNotionalUsd]);
    let group = this.groups.get(key);
    if (!group) {
      const groupSettings = profileSettings(request);
      let created!: CurrentGroup;
      const poller = new OrderWallsArchiveCurrentPoller({ request, fetcher: this.request,
        onPage: page => this.onCurrentPage(created, page), onReset: reason => this.onCurrentReset(created, reason),
        onStatus: status => this.onCurrentStatus(created, status) });
      created = { key, request, settings: groupSettings, poller, subscribers: new Set<Subscription>(), cursor: 0,
        pages: [], ringBytes: 0, ringPatches: 0, ringFloorCursor: 0, ringOverflow: false,
        profileExact: false, currentValid: false, currentCatchingUp: true };
      group = created; this.groups.set(key, group); group.poller.start();
    }
    sub.group = group; group.subscribers.add(sub); this.stats.groups = this.groups.size;
    if (group.projector) this.seedTail(sub, group.projector.selectedState(), group.head);
    if (group.head) this.startHistory(sub, group.bootstrap?.head ?? group.head);
  }

  private onCurrentPage(group: CurrentGroup, page: OrderWallsArchiveCurrentPage) {
    if (this.disposed || this.groups.get(group.key) !== group) return;
    this.stats.currentPages++; this.stats.currentPatches += page.patches.length;
    const exact = orderWallsArchiveDerivationsExact(page.profile, group.settings);
    group.profileExact = exact;
    group.profileStatus = page.profileStatus;
    group.currentValid = page.head.valid;
    group.currentCatchingUp = page.page.hasMore || page.page.nextAfter < page.watermark;
    group.currentMessage = !exact ? 'The server current profile cannot exactly derive these Top Levels settings.'
      : !group.currentValid ? page.coverage?.reason ?? 'Current source continuity is not confirmed.'
        : group.currentCatchingUp ? 'Current selected-profile tail is catching up through bounded cursor batches.' : undefined;
    if (page.page.after === 0 && page.state) {
      group.bootstrap = page; group.head = page.head; group.cursor = page.page.nextAfter;
      group.projector = new OrderWallsArchiveProjector(group.settings, page.head?.at ?? 0, Number.MAX_SAFE_INTEGER);
      group.projector.applyCurrentPage(page, page.head?.at ?? 0);
      group.pages = []; group.ringBytes = 0; group.ringPatches = 0; group.ringFloorCursor = page.watermark; group.ringOverflow = false;
      for (const sub of group.subscribers) {
        this.recordCurrentGaps(sub, page);
        if (exact) this.seedTail(sub, group.projector.selectedState(), group.head);
        else { sub.currentState = 'unavailable'; sub.currentMessage = 'The current profile cannot exactly derive these Top Levels settings.'; }
        this.startHistory(sub, group.head);
        this.publish(sub, 'snapshot', this.visibleSegments(sub), this.status(sub));
      }
      return;
    }
    if (page.head && (!group.head || page.watermark > group.head.cursor
      || page.watermark === group.head.cursor && page.head.at > group.head.at)) group.head = page.head;
    group.cursor = Math.max(group.cursor, page.page.nextAfter);
    this.addCurrentPage(group, page);
    if (group.projector && exact) group.projector.applyCurrentPage(page, group.bootstrap?.head?.at ?? page.head?.at);
    const state = group.projector?.selectedState();
    for (const sub of group.subscribers) {
      this.recordCurrentGaps(sub, page);
      const previousBridge=sub.bridgeProjector;
      let changed:OrderWallPatch[]=[];
      if (sub.bridgeProjector && exact) {
        changed=sub.bridgeProjector.applyCurrentPage(remapCurrentPage(page, sub.bridgeEntryIds), group.bootstrap?.head?.at ?? page.head?.at);
      }
      else if (state && exact && sub.tailProjector) changed=sub.tailProjector.applyCurrentPage(page, group.bootstrap?.head?.at ?? page.head?.at);
      this.updateCurrentMetadata(sub, page, group);
      this.tryBridge(sub);
      if(sub.bridgeProjector!==previousBridge&&sub.bridgeProjector){
        this.publish(sub,'patch',this.diff(sub,this.visibleSegments(sub)),this.status(sub));
      }else{
        const patches=this.markPatches(sub,changed,true);this.stats.incrementalSegments+=patches.length;
        this.publish(sub,'patch',patches,this.status(sub));
      }
      this.tryStartPendingViewportHistory(sub);
    }
  }

  private onCurrentReset(group: CurrentGroup, reason: string) {
    if (this.disposed || this.groups.get(group.key) !== group) return;
    const resetAt = group.head?.at;
    group.projector = undefined; group.bootstrap = undefined; group.head = undefined; group.cursor = 0;
    group.currentValid = false; group.currentCatchingUp = true; group.currentMessage = reason;
    group.pages = []; group.ringBytes = 0; group.ringPatches = 0; group.ringFloorCursor = 0; group.ringOverflow = true;
    for (const sub of group.subscribers) {
      const boundary = resetAt ?? sub.currentAt;
      if (boundary !== undefined) this.recordCurrentGap(sub, { from: boundary, to: boundary, reason });
      sub.continuityLost = true; sub.bridgeProjector?.censorOpen(sub.currentAt ?? 0, reason); sub.bridgeProjector = undefined;
      sub.bridgeEntryIds = undefined; sub.historyFenceState = undefined;
      sub.tailProjector?.censorOpen(sub.currentAt ?? 0, reason); sub.tailProjector = undefined;
      sub.historyStatus = sub.historyStatus ? { ...sub.historyStatus, state: 'gap', message: reason,
        coverage: { from: sub.request.from, to: sub.request.to, complete: false, partial: true, reason },
        archive: sub.historyStatus.archive ? { ...sub.historyStatus.archive, state: 'partial', reason } : undefined } : undefined;
      sub.currentState = 'stale'; sub.currentMessage = reason;
      this.publish(sub, 'patch', [], this.status(sub));
    }
  }

  private onCurrentStatus(group: CurrentGroup, status: { state: 'loading' | 'catching-up' | 'ready' | 'stale' | 'unavailable'; message?: string; sourceValid?: boolean }) {
    group.currentCatchingUp = status.state === 'loading' || status.state === 'catching-up';
    group.currentMessage = status.message;
    if (status.sourceValid !== undefined) group.currentValid = status.sourceValid;
    for (const sub of group.subscribers) {
      if (status.state === 'unavailable') { sub.currentState = 'unavailable'; sub.currentMessage = status.message; }
      else if (status.state === 'stale') { sub.currentState = 'stale'; sub.currentMessage = status.message; }
      else if (status.state === 'ready') {
        if (!group.profileExact) { sub.currentState = 'unavailable'; sub.currentMessage = 'The current profile cannot exactly derive these Top Levels settings.'; }
        else {
          sub.currentState = group.currentValid ? 'live' : 'stale';
          sub.currentMessage = group.currentValid ? undefined : status.message ?? 'Current source continuity is not confirmed.';
        }
      } else {
        sub.currentState = 'loading'; sub.currentMessage = status.message ?? 'Checking the exact current Top Levels profile.';
      }
      this.publish(sub, 'patch', [], this.status(sub));
    }
  }

  private loadHistory(sub: Subscription) { this.startHistory(sub); }

  private recordHistoryPageMetrics(metrics: OrderWallsArchivePageMetrics) {
    this.historyPageMetricCount++;
    this.stats.historyPages++;
    this.stats.bytes += metrics.responseBytes;
    this.stats.historyBytes += metrics.responseBytes;
    this.stats.historyResponseHeadersMs += metrics.responseHeadersMs;
    this.stats.historyBodyReadMs += metrics.responseBodyReadMs;
    this.stats.historyJsonParseMs += metrics.jsonParseMs;
    this.stats.historyValidationMs += metrics.validationMs;
    this.stats.historyProjectorApplyMs += metrics.projectorApplyMs;
    this.stats.historyUpdateCallbackMs += metrics.updateCallbackMs;
    this.stats.historyEventLoopYieldDelayMs += metrics.eventLoopYieldDelayMs;
    this.historyPageMetrics.push(metrics);
    if (this.historyPageMetrics.length > HISTORY_PAGE_TIMING_SAMPLE_LIMIT) this.historyPageMetrics.shift();
  }

  private seedTail(sub: Subscription, state: ReturnType<OrderWallsArchiveProjector['selectedState']>, head?: CurrentGroup['head']) {
    const profileId = orderWallsArchiveProfileId(sub.request.market, sub.settings) ?? 'unknown';
    const projector = new OrderWallsArchiveProjector(sub.settings, sub.request.from, Number.MAX_SAFE_INTEGER, `tail-${profileId}`);
    projector.seedSelectedState(state);
    sub.tailProjector = projector; sub.bridgeProjector = undefined; sub.currentAt = head?.at ?? state.at;
    sub.currentScope = toOrderWallScope(head?.bookScope ?? state.bookScope); sub.currentMidpoint = head?.midpoint ?? state.midpoint;
    sub.currentState = head?.valid === false ? 'stale' : 'live';
    sub.currentMessage = head?.valid === false ? 'Current source continuity is not confirmed.' : undefined;
  }

  private updateCurrentMetadata(sub: Subscription, page: OrderWallsArchiveCurrentPage, group: CurrentGroup) {
    const head = page.head ?? group.head;
    sub.currentAt = page.coverage?.confirmedTo ?? head?.at ?? page.page.lastAt;
    sub.currentScope = toOrderWallScope(head?.bookScope ?? page.coverage?.bookScope);
    sub.currentMidpoint = head?.midpoint ?? sub.currentMidpoint;
    if (!group.profileExact) { sub.currentState = 'unavailable'; sub.currentMessage = 'The current profile cannot exactly derive these Top Levels settings.'; }
    else if (!group.currentValid) { sub.currentState = 'stale'; sub.currentMessage = group.currentMessage ?? 'Current source continuity is not confirmed.'; }
    else if (group.currentCatchingUp) { sub.currentState = 'loading'; sub.currentMessage = group.currentMessage ?? 'Current selected-profile archive is catching up.'; }
    else { sub.currentState = 'live'; sub.currentMessage = undefined; }
  }

  private recordCurrentGaps(sub: Subscription, page: OrderWallsArchiveCurrentPage) {
    if (page.coverage?.gapsTruncated) sub.currentGapsTruncated = true;
    for (const gap of page.coverage?.gaps ?? []) {
      const from = gap.from ?? gap.at;
      const to = gap.to ?? gap.at ?? from;
      if (from === undefined || to === undefined || !Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
      this.recordCurrentGap(sub, { from, to, reason: gap.reason });
    }
    for (const patch of page.patches) {
      if (patch.kind === 'gap') this.recordCurrentGap(sub, { from: patch.at, to: patch.at, reason: patch.reason ?? 'Depth continuity unavailable' });
      for (const removal of [...patch.bids.removals, ...patch.asks.removals]) {
        if (removal.reason === 'gap' || removal.reason === 'replacement-epoch' || removal.reason === 'capacity-unknown') {
          this.recordCurrentGap(sub, { from: removal.at, to: removal.at, reason: patch.reason ?? removal.reason });
        }
      }
    }
  }

  private recordCurrentGap(sub: Subscription, gap: { from: number; to: number; reason: string }) {
    if (gap.to < sub.request.from) return;
    const duplicate = sub.currentGaps.some(existing => existing.from === gap.from && existing.to === gap.to && existing.reason === gap.reason);
    if (duplicate) return;
    sub.currentGaps.push(gap);
    sub.currentGaps.sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason));
    if (sub.currentGaps.length > MAX_SUBSCRIPTION_ARCHIVE_GAPS) {
      sub.currentGaps.splice(0, sub.currentGaps.length - MAX_SUBSCRIPTION_ARCHIVE_GAPS);
      sub.currentGapsTruncated = true;
    }
  }

  private startHistory(sub: Subscription, fence?: NonNullable<CurrentGroup['head']>,
    requestOverride?: OrderWallsArchiveRequest, initialProjector?: OrderWallsArchiveProjector, carryHistory = false) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.archiveStarted) return;
    sub.archiveStarted = true;
    if(sub.request.currentOnly)return;
    sub.historyFence = fence ? { cursor: fence.cursor, at: fence.at, epoch: fence.epoch } : undefined;
    const fenceState = fence ? sub.group?.projector?.selectedState() : undefined;
    sub.historyFenceState = fence && fenceState && sameProjectorHead(fenceState, fence) ? copySelectedState(fenceState) : undefined;
    const request: OrderWallsArchiveRequest = requestOverride ?? { market: sub.request.market, from: sub.request.from, to: sub.request.to,
      settings: sub.settings, ...(sub.request.profileId ? { profileId: sub.request.profileId } : {}),
      ...(fence ? { watermark: fence.cursor, head: { cursor: fence.cursor, at: fence.at, epoch: fence.epoch } } : {}) };
    if (carryHistory) {
      sub.historyArchiveCarry = mergeHistoryArchive(sub.historyArchiveCarry,
        sub.historyStatus?.archive ?? emptyArchiveStatus(request, 'partial'));
      sub.historyCoverageCarry = mergeHistoryCoverage(sub.historyCoverageCarry, sub.historyStatus?.coverage);
    } else {
      sub.historyArchiveCarry = undefined; sub.historyCoverageCarry = undefined;
    }
    const cachedStatus=sub.cachedHistory?sub.historyStatus:undefined;
    const archive = emptyArchiveStatus(request, 'loading');
    sub.historyStatus = { state: 'loading', message: carryHistory
      ? 'Extending archived Top Levels history for the advancing chart range.' : 'Loading archived Top Levels history.',
      coverage: carryHistory ? { from: sub.request.from, to: sub.request.to, complete: false, partial: true }
        : { from: request.from, to: request.to, complete: false, partial: true }, archive };
    if(cachedStatus?.archive)sub.historyStatus={...cachedStatus,state:'loading',message:'Cached history visible; validating the current revision.',archive:{...cachedStatus.archive,state:'loading',requestComplete:false,rangeComplete:false,reason:'Cached history visible; validating the current revision.'}};
    const key = historyJobKey(request);
    let job = this.historyJobs.get(key);
    if (job) {
      sub.historyFence = job.fence;
      sub.historyFenceState = job.fenceState ? copySelectedState(job.fenceState) : undefined;
      sub.historyJob = job; job.subscribers.add(sub);
      if (job.latest) this.publishSharedHistorySnapshot(sub, job.latest);
      return;
    }
    job = { key, request, fence: sub.historyFence,
      fenceState: sub.historyFenceState ? copySelectedState(sub.historyFenceState) : undefined,
      abort: new AbortController(), subscribers: new Set([sub]), settled: false, initialProjector };
    sub.historyJob = job; this.historyJobs.set(key, job); this.stats.historyRequests++;
    this.runHistoryJob(job);
  }

  private pendingViewportNeedsExtension(sub: Subscription, job = sub.historyJob) {
    const pending = sub.pendingViewport, archive = job?.latest?.status.archive;
    const fixed = job?.fence ?? job?.request.head, current = sub.group?.head;
    if (!pending || !job || !archive || archive.requestComplete !== true || archive.state === 'unavailable'
      || pending.to <= job.request.to || !fixed || !current || current.cursor < fixed.cursor) return false;
    return current.cursor > fixed.cursor || current.at > fixed.at;
  }

  private tryStartPendingViewportHistory(sub: Subscription) {
    const job = sub.historyJob, target = sub.pendingViewport;
    if (!job?.settled || !target) return false;
    const archive = job.latest?.status.archive;
    if (archive?.state === 'unavailable' && archive.requestComplete === true) {
      sub.pendingViewport = undefined;
      return false;
    }
    if (!this.pendingViewportNeedsExtension(sub, job)) return false;
    const fixed = job.fence ?? job.request.head, current = sub.group?.head;
    const priorProjector = job.latest?.projector ?? sub.historyProjector;
    if (!fixed || !current || !priorProjector || target.to <= fixed.at) return false;
    const request: OrderWallsArchiveRequest = { market: sub.request.market, from: fixed.at, to: target.to,
      after: fixed.cursor, settings: sub.settings, ...(sub.request.profileId ? { profileId: sub.request.profileId } : {}),
      watermark: current.cursor, head: { cursor: current.cursor, at: current.at, epoch: current.epoch } };
    const initialProjector = priorProjector.cloneForLiveTail(target.to);
    this.detachHistoryJob(sub);
    const previousRequest=sub.request;
    sub.request = { ...sub.request, from: Math.min(sub.request.from, target.from), to: target.to, followLive: target.followLive };
    this.releaseWarmInterests(previousRequest);
    sub.pendingViewport = undefined;
    sub.archiveStarted = false;
    this.startHistory(sub, current, request, initialProjector, true);
    this.publish(sub, 'patch', [], this.status(sub));
    return true;
  }

  private detachHistoryJob(sub: Subscription) {
    const job = sub.historyJob; if (!job) return;
    sub.historyJob = undefined;this.releaseWarmInterests(job.request);job.subscribers.delete(sub);
    if (!job.subscribers.size) {
      if (this.historyJobs.get(job.key) === job) this.historyJobs.delete(job.key);
      if (!job.settled) job.abort.abort();
    }
  }

  private runHistoryJob(job: SharedHistoryJob, resume?: OrderWallsArchiveResumeState) {
    job.settled = false;
    void loadOrderWallsArchive({ request: job.request, signal: job.abort.signal, fetcher: this.request, resume,
      ...(job.preparationRetryToken?{preparationRetry:{token:job.preparationRetryToken,newRevision:job.preparationNeedsRevision===true}}:{}),
      ...(job.initialProjector ? { initialProjector: job.initialProjector.cloneForLiveTail(job.request.to) } : {}), onUpdate: update => {
      job.latest = update; job.resume = update.resume;
      for (const subscriber of [...job.subscribers]) this.publishSharedHistoryUpdate(subscriber, job, update);
    }, onPageMetrics: metrics => this.recordHistoryPageMetrics(metrics) }).then(result => {
      job.latest = result; job.resume = result.resume; job.settled = true;
      job.preparationNeedsRevision=false;job.preparationRetryToken=undefined;
      this.rememberHistory(job.request,result);
      for (const subscriber of [...job.subscribers]) {
        if (!this.tryStartPendingViewportHistory(subscriber)) this.publishSharedHistoryUpdate(subscriber, job, result);
      }
    }).catch(error => {
      job.settled = true;
      if (job.abort.signal.aborted || this.disposed) return;
      this.stats.failures++;
      const sourceChanged=error instanceof PreparedWallSourceChangedError||error instanceof PreparedWallPreparationError&&error.category==='source-changed';
      const requestedRevision=job.preparationNeedsRevision===true;
      job.preparationNeedsRevision=sourceChanged;
      const retryable=error instanceof PreparedWallPreparationError?error.retryable:true;
      if(sourceChanged){
        job.resume=undefined;
        for(const subscriber of job.subscribers)if(subscriber.historyProjector||subscriber.historyPresentation?.size)subscriber.cachedHistory=true;
        // A user Retry may discover that its retained prepared prefix has been
        // superseded. Restart once in that same Retry, staging replacements
        // behind the displayed prefix. No socket/cursor or healthy job resets.
        if(resume){
          // Escalating a previously acknowledged resume command to a revision
          // is a distinct intent. Reusing its token would correctly be ignored
          // by the worker and leave the failed old-source job unchanged.
          if(job.preparationRetryToken&&!requestedRevision)job.preparationRetryToken=crypto.randomUUID();
          this.runHistoryJob(job);return;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      for (const subscriber of job.subscribers) {
        const previous = subscriber.historyStatus ?? job.latest?.status;
        if (job.resume && previous) {
          const archive = { ...(previous.archive ?? emptyArchiveStatus(subscriber.request, 'partial')),
            state: 'partial' as const, requestComplete: false, retryable, resumeAfter: job.resume.after, reason: message };
          subscriber.historyStatus = { ...previous, state: 'loading', message: `Order Walls history incomplete; validated prefix retained and can be resumed. ${message}`,
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true, reason: message }, archive };
        } else {
          subscriber.historyStatus = { state: 'gap', message: `Order Walls history request failed: ${message}`,
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true, reason: message },
            archive: { ...emptyArchiveStatus(subscriber.request, 'partial', message), ...(subscriber.cachedHistory?subscriber.historyStatus?.archive:{}), state:'partial',reason:message,requestComplete: false,rangeComplete:false,resumeAfter:undefined,retryable } };
        }
        this.publish(subscriber, 'patch', [], this.status(subscriber));
      }
    });
  }

  private showWarmHistory(sub:Subscription){
    const key=warmHistoryKey(sub.request),entry=this.warmHistory.get(key);if(!entry||entry.expired)return;
    let replay=entry.replay,started=false;
    if(!replay&&entry.compact&&this.warmReplays.size>=2){this.stats.warmCapacityMisses++;return;}
    if(!replay){replay={key,entry,abort:new AbortController(),presentation:new Map(entry.presentation),subscribers:new Set(),settled:!entry.compact,runs:entry.compact?0:entry.runs};entry.replay=replay;started=true;}
    const active=replay;active.subscribers.add(sub);sub.warmReplay=active;sub.cachedHistory=true;sub.historyProjector=undefined;sub.historyPresentation=active.presentation;
    sub.historyStatus={...entry.status,archive:{...entry.status.archive!,state:'loading',requestComplete:false,rangeComplete:false,loadedThrough:active.settled?entry.status.archive!.loadedThrough:sub.request.from,presentationThrough:entry.status.archive!.presentationThrough??entry.status.archive!.loadedThrough,reason:'Cached history visible; validating the current revision.'}};
    if(started&&entry.compact)this.warmReplays.add(active);
    this.publish(sub,'snapshot',this.visibleSegments(sub),this.status(sub));
    if(started&&entry.compact){if(active.abort.signal.aborted){this.warmReplays.delete(active);return;}const replayAt=performance.now();let firstContentMs:number|undefined,decodedSegments=0;void replayCompactWallPresentation(entry.compact,key,active.abort.signal,segments=>{
      if(firstContentMs===undefined&&segments.length)firstContentMs=performance.now()-replayAt;decodedSegments+=segments.length;
      for(const segment of segments){active.presentation.set(segment.id,segment);active.runs+=segment.valueRuns.length;}
      for(const viewer of active.subscribers)if(viewer.warmReplay===active&&viewer.cachedHistory&&this.subscriptions.get(viewer.id)===viewer){
        if(viewer.historyStatus?.archive?.state==='loading'||viewer.historyStatus?.archive?.state==='building'){const reason=`Cached history ${active.presentation.size}/${entry.segments} walls; validating the current revision.`;viewer.historyStatus={...viewer.historyStatus,message:reason,archive:{...viewer.historyStatus.archive,reason}};}
        this.publish(viewer,'patch',this.markPatches(viewer,segments.map(segment=>({id:segment.id,segment,replaceValueRuns:true})),false),this.status(viewer));}
    }).then(()=>{active.settled=true;for(const viewer of active.subscribers)if(viewer.warmReplay===active&&viewer.cachedHistory&&viewer.historyStatus?.archive){viewer.historyStatus={...viewer.historyStatus,archive:{...viewer.historyStatus.archive,loadedThrough:entry.status.archive!.loadedThrough}};this.publish(viewer,'patch',[],this.status(viewer));}}).catch(error=>{
      if(active.abort.signal.aborted||this.disposed)return;this.stats.warmDecodeFailures++;entry.expired=true;
      // Validated cached prefixes stay visible until the independent fresh job
      // validates. If no cached content arrived, allow its useful fresh prefix.
      for(const viewer of active.subscribers){
        if(!active.presentation.size){viewer.cachedHistory=false;const job=viewer.historyJob;if(job?.latest)this.publishSharedHistorySnapshot(viewer,job.latest);}
        if(viewer.historyStatus?.archive?.state==='loading')viewer.historyStatus={...viewer.historyStatus,message:'Cached history incomplete; loading a fresh revision.',archive:{...viewer.historyStatus.archive,reason:'Cached history incomplete; loading a fresh revision.'}};
        this.publish(viewer,'patch',[],this.status(viewer));
      }
    }).finally(()=>{this.warmReplays.delete(active);this.recordWarmTiming({kind:'replay',identity:key,queueMs:0,elapsedMs:performance.now()-replayAt,firstContentMs,segments:decodedSegments,runs:active.runs,state:active.settled?'ready':active.abort.signal.aborted?'cancelled':'failed'});});}
  }

  private releaseWarmReplay(sub:Subscription){
    const replay=sub.warmReplay;if(!replay)return;sub.warmReplay=undefined;replay.subscribers.delete(sub);
    if(!replay.subscribers.size){replay.abort.abort();replay.presentation.clear();if(replay.entry.replay===replay)replay.entry.replay=undefined;
      if(replay.entry.expired&&this.warmHistory.get(replay.key)===replay.entry){clearTimeout(replay.entry.timer);this.warmHistory.delete(replay.key);}}
  }

  /** Only bounded subscription metadata is inspected; no closed segments,
   * value runs or mutable accumulators participate in cache interest. */
  private hasWarmConsumers(key:string){
    for(const sub of this.subscriptions.values())if(!sub.request.currentOnly&&(warmHistoryKey(sub.request)===key||sub.historyJob&&warmHistoryKey(sub.historyJob.request)===key))return true;
    return false;
  }

  private releaseWarmInterests(...requests:Array<OrderWallsArchiveRequest|undefined>){
    const keys=new Set(requests.filter((request):request is OrderWallsArchiveRequest=>Boolean(request)).map(warmHistoryKey));
    for(const key of keys){const entry=this.warmHistory.get(key);if(!entry||entry.expired||this.hasWarmConsumers(key))continue;
      clearTimeout(entry.timer);entry.timer=setTimeout(()=>this.expireWarm(key,entry),60000);
    }
  }

  private expireWarm(key:string,entry:WarmEntry){
    if(this.warmHistory.get(key)!==entry)return;
    if(!entry.expired&&this.hasWarmConsumers(key)){entry.timer=setTimeout(()=>this.expireWarm(key,entry),60000);return;}
    entry.expired=true;if(!entry.replay?.subscribers.size&&this.warmHistory.get(key)===entry)this.warmHistory.delete(key);
  }

  private admitWarm(key:string,status:OrderWallStatus,runs:number,segments:number,bytes:number,presentation?:ReadonlyMap<string,OrderWallSegment>,compact?:CompactWallPresentation,signature?:string){
    if(this.disposed)return;if(bytes>16*1024*1024){this.stats.warmCapacityMisses++;return;}const old=this.warmHistory.get(key);
    if(old?.replay?.subscribers.size){this.stats.warmCapacityMisses++;return;}
    if(old){clearTimeout(old.timer);this.warmHistory.delete(key);}
    while(this.warmHistory.size>=2||[...this.warmHistory.values()].reduce((n,entry)=>n+entry.bytes,0)+bytes>32*1024*1024){
      const unused=[...this.warmHistory].find(([,entry])=>!entry.replay?.subscribers.size);
      if(!unused){this.stats.warmCapacityMisses++;return;}clearTimeout(unused[1].timer);this.warmHistory.delete(unused[0]);
    }
    const entry:WarmEntry={presentation,compact,status,runs,segments,bytes,signature,timer:setTimeout(()=>this.expireWarm(key,entry),60000)};
    this.warmHistory.set(key,entry);this.stats.warmAdmissions++;
  }

  private rememberHistory(request:OrderWallsArchiveRequest,result:OrderWallsArchiveResult){
    const archive=result.status.archive,projector=result.projector;
    if(this.disposed||!projector||!archive?.requestComplete||!archive.exact||archive.state==='unavailable'||result.resume)return;
    const key=warmHistoryKey(request);
    const signature=result.preparedPresentationRevision?'manifest:'+result.preparedPresentationRevision:result.preparedSourceToken&&result.presentation?JSON.stringify([result.preparedSourceToken,result.segments.filter(segment=>result.presentation!.get(segment.id)?.end===null).map(({valueRuns:_runs,...header})=>header)]):undefined;
    const prior=this.warmHistory.get(key);
    if(signature&&prior?.signature===signature&&!prior.expired){prior.status=result.status;clearTimeout(prior.timer);prior.timer=setTimeout(()=>this.expireWarm(key,prior),60000);this.stats.warmRevisionReuses++;return;}
    for(const build of this.warmBuilds)if(build.key===key)build.abort.abort();
    const count=projector.diagnostics(),bytes=count.valueRuns*256+count.retainedSegments*512;
    if(bytes>this.compactPreparedAboveBytes&&(!result.preparedPresentationComplete||!result.presentation)){this.stats.warmCapacityMisses++;return;}
    const presentation=bytes>this.compactPreparedAboveBytes?wallCompactPresentation(result.segments,result.presentation!):wallHistoryPresentation(result.segments,result.preparedPresentationComplete?result.presentation:undefined);
    if(!presentation||presentation.size!==count.retainedSegments){this.stats.warmInvalidMisses++;return;}
    if(bytes<=this.compactPreparedAboveBytes){this.admitWarm(key,result.status,count.valueRuns,count.retainedSegments,bytes,presentation,undefined,signature);return;}
    this.enqueueWarmBuild(key,result.status,signature,presentation,count);
  }

  /** Separate scope prevents the asynchronous encoder from retaining the
   * completed loader result/projector through a shared closure environment. */
  private enqueueWarmBuild(key:string,status:OrderWallStatus,signature:string|undefined,presentation:ReadonlyMap<string,OrderWallSegment>,count:{valueRuns:number;retainedSegments:number}){
    // Two retained inputs at most, one encoder at a time. Neither visible
    // network scheduling nor fresh history publication waits for this work.
    if(this.warmBuilds.size>=2){this.stats.warmCapacityMisses++;return;}
    const build={key,abort:new AbortController()};this.warmBuilds.add(build);const queuedAt=performance.now();let buildAt:number|undefined,built=false;
    const work=this.warmBuildTail.then(async()=>{
      build.abort.signal.throwIfAborted();buildAt=performance.now();const compact=await compactWallPresentation(key,[...presentation.values()],build.abort.signal);
      build.abort.signal.throwIfAborted();if(this.disposed)return;
      if(new TextEncoder().encode(JSON.stringify([status,signature])).byteLength*2+4096>256*1024)throw Error('Compact wall status capacity');
      this.admitWarm(key,status,count.valueRuns,count.retainedSegments,compact.retainedBytes+256*1024,undefined,compact,signature);this.stats.warmCompactBuilds++;built=true;
    }).catch(()=>{if(!build.abort.signal.aborted){this.stats.warmBuildFailures++;this.stats.warmCapacityMisses++;}}).finally(()=>{this.warmBuilds.delete(build);const end=performance.now();this.recordWarmTiming({kind:'encode',identity:key,queueMs:(buildAt??end)-queuedAt,elapsedMs:buildAt===undefined?0:end-buildAt,segments:count.retainedSegments,runs:count.valueRuns,state:built?'ready':build.abort.signal.aborted?'cancelled':'failed'});});
    this.warmBuildTail=work;
  }

  private publishSharedHistorySnapshot(sub: Subscription, update: OrderWallsArchiveUpdate) {
    const replay: OrderWallsArchiveUpdate = { ...update, kind: 'snapshot', segments: update.projector?.snapshot() ?? (update.presentation?[...update.presentation.values()]:update.segments) ?? [], patches: undefined };
    this.publishSharedHistoryUpdate(sub, sub.historyJob!, replay, true);
  }

  private publishSharedHistoryUpdate(sub: Subscription, job: SharedHistoryJob, update: OrderWallsArchiveUpdate, forceSnapshot=false) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.historyJob !== job) return;
    const forceValidatedSnapshot=forceSnapshot&&update.preparedPresentationComplete&&update.status.archive?.requestComplete&&update.status.archive.exact&&update.status.archive.state!=='unavailable';
    if(forceValidatedSnapshot){sub.cachedHistory=false;this.releaseWarmReplay(sub);}
    const priorStatus=sub.historyStatus;sub.historyStatus = update.status;
    if(!sub.cachedHistory&&update.status.archive?.requestComplete&&update.status.archive.exact&&update.status.archive.state!=='unavailable')this.releaseWarmReplay(sub);
    let alreadyPresented=!forceValidatedSnapshot&&update.preparedPresentationComplete&&!sub.cachedHistory&&Boolean(update.projector&&(sub.historyPresentation||sub.historyProjector===update.projector));
    if(sub.cachedHistory){
      const archive=update.status.archive;
      if(!archive?.requestComplete||!archive.exact||archive.state==='unavailable'){
        if(priorStatus?.archive&&archive){const gaps=new Map([...priorStatus.archive.gaps,...archive.gaps].map(gap=>[`${gap.from}:${gap.to}:${gap.reason}`,gap]));
          sub.historyStatus={...update.status,archive:{...priorStatus.archive,...archive,gaps:[...gaps.values()].slice(-MAX_SUBSCRIPTION_ARCHIVE_GAPS),gapsTruncated:priorStatus.archive.gapsTruncated||archive.gapsTruncated||gaps.size>MAX_SUBSCRIPTION_ARCHIVE_GAPS,loadedThrough:Math.max(priorStatus.archive.loadedThrough??sub.request.from,archive.loadedThrough??sub.request.from),requestComplete:false,rangeComplete:false}};}
        this.publish(sub,'patch',[],this.status(sub));return;
      }
      const replay=sub.warmReplay;
      const unchanged=update.preparedPresentationComplete&&replay?.settled&&update.preparedPresentationRevision
        &&replay.entry.signature==='manifest:'+update.preparedPresentationRevision
        &&update.segments?.length===replay.entry.segments;
      if(unchanged){
        // The fresh projector/cursor still becomes authoritative below. Rebind
        // comparison references to it so the released replay's arrays can die;
        // the already displayed immutable rows need no new main-thread snapshot.
        for(const segment of update.segments!){const previous=sub.lastPublished.get(segment.id);
          if(previous&&!previous.currentSelection)sub.lastPublished.set(segment.id,{...segment,currentSelection:false});}
        alreadyPresented=true;this.stats.warmValidatedReuses++;
      }
      sub.cachedHistory=false;this.releaseWarmReplay(sub);
      // Only a complete identical manifest may keep the cached presentation.
      // Changed or unproved revisions retain the existing replacement path.
      update=unchanged?{...update,kind:'patch',patches:[],segments:undefined}:
        {...update,kind:'snapshot',segments:update.projector?.snapshot()??update.segments,patches:undefined};
    }
    if(alreadyPresented)update={...update,kind:'patch',patches:[],segments:undefined};
    if (update.projector) {sub.historyProjector = update.projector;sub.historyPresentation=undefined;}
    else if(update.presentation)sub.historyPresentation=update.presentation;
    if (!sub.group) { this.publishArchiveUpdate(sub, update); return; }
    const previousBridge=sub.bridgeProjector;this.tryBridge(sub);
    const status=this.status(sub);
    if(update.kind==='snapshot')this.publish(sub,'snapshot',this.visibleSegments(sub),status);
    else if(!sub.bridgeProjector){
      const patches=this.markPatches(sub,update.patches??[],false);this.stats.incrementalSegments+=patches.length;
      this.publish(sub,'patch',patches,status);
    }else if(alreadyPresented&&previousBridge===sub.bridgeProjector)this.publish(sub,'patch',[],status);
    else this.publish(sub,'patch',this.diff(sub,this.visibleSegments(sub)),status);
  }

  private addCurrentPage(group: CurrentGroup, page: OrderWallsArchiveCurrentPage) {
    if (page.page.after === 0) return;
    if (page.page.nextAfter <= group.ringFloorCursor && !page.patches.length) return;
    const bytes = (page as OrderWallsArchiveCurrentPage & { __bytes?: number }).__bytes ?? JSON.stringify(page).length;
    group.pages.push(page); group.ringBytes += bytes; group.ringPatches += page.patches.length;
    while (group.pages.length > MAX_CURRENT_RING_PAGES || group.ringBytes > MAX_CURRENT_RING_BYTES || group.ringPatches > MAX_CURRENT_RING_PATCHES) {
      const removed = group.pages.shift(); if (!removed) break;
      group.ringBytes = Math.max(0, group.ringBytes - ((removed as OrderWallsArchiveCurrentPage & { __bytes?: number }).__bytes ?? JSON.stringify(removed).length));
      group.ringPatches = Math.max(0, group.ringPatches - removed.patches.length); group.ringFloorCursor = Math.max(group.ringFloorCursor, removed.page.nextAfter);
      group.ringOverflow = true; this.stats.ringDrops++;
    }
  }

  private tryBridge(sub: Subscription) {
    const group = sub.group, history = sub.historyProjector, archive = sub.historyStatus?.archive;
    if (!group || !history || !archive || archive.state === 'loading' || archive.state === 'building' || archive.state === 'backfilling') return;
    if (archive.requestComplete === false) return;
    if (sub.bridgeProjector) return;
    const fence = sub.historyFence;
    const cursor = fence?.cursor;
    const joinAt = fence?.at;
    const gaps = archive.gaps.filter(gap => gap.to >= sub.request.from && gap.from <= (joinAt ?? sub.request.to));
    // A current-state snapshot is not proof for the interval between a shorter
    // historical request end and the captured current watermark. Bridge only
    // when history itself covers the exact fixed watermark H.
    const coversFence = joinAt !== undefined && sub.request.to >= joinAt
      && archive.confirmedTo !== undefined && archive.confirmedTo >= joinAt;
    const historyThroughFence = Boolean(archive.state === 'complete' || archive.state === 'partial'
      && archive.requestComplete === true && archive.confirmedTo !== undefined && archive.confirmedTo >= (joinAt ?? Infinity)
      && gaps.length === 0 && !sub.historyProjector?.historyLimited);
    const safe = Boolean(!sub.continuityLost && archive.exact && historyThroughFence && fence && cursor !== undefined
      && coversFence
      && archive.availableFrom !== undefined && archive.availableFrom <= sub.request.from
      && gaps.length === 0 && group.ringFloorCursor <= cursor);
    if (!safe || !fence || cursor === undefined) {
      if (sub.historyProjector) sub.historyProjector.censorOpen(archive.confirmedTo ?? joinAt ?? sub.request.to,
        'Current selected-profile tail could not be joined through a verified archive watermark.');
      sub.continuityLost = true;
      return;
    }
    const pages = group.pages.filter(page => page.page.nextAfter > cursor).sort((a, b) => a.page.after - b.page.after);
    const targetCursor = group.head?.cursor ?? group.cursor;
    // Do not publish a bridge partway through a fixed-watermark catch-up batch.
    if (group.cursor < targetCursor || pages.at(-1)?.page.hasMore) return;
    const currentState = sub.historyFenceState;
    const entryIds = currentState ? proveEntryIdMapping(history.selectedState(), currentState) : undefined;
    if (!currentState || !entryIds || !pagesContinueFrom(pages, cursor, targetCursor, fence.at, fence.epoch)) {
      history.censorOpen(archive.confirmedTo ?? joinAt ?? sub.request.to,
        'Archive and current selected-profile entries could not be matched at the fixed watermark.');
      sub.continuityLost = true;
      return;
    }
    const merged = history.cloneForLiveTail(Number.MAX_SAFE_INTEGER);
    merged.confirmWatermark(fence.cursor, fence.at, fence.epoch, currentState.midpoint);
    sub.bridgeEntryIds = entryIds;
    for (const page of pages) {
      const clipped = page.page.after < cursor ? { ...page, page: { ...page.page, after: cursor }, patches: page.patches.filter(patch => patch.cursor > cursor) } : page;
      merged.applyCurrentPage(remapCurrentPage(clipped, sub.bridgeEntryIds), fence.at);
    }
    sub.bridgeProjector = merged; sub.tailProjector = undefined; sub.continuityLost = false;
  }

  private visibleSegments(sub: Subscription): OrderWallSegment[] {
    const currentSelection = sub.group?.profileExact === true && sub.group.currentValid;
    const markCurrent = (segments: OrderWallSegment[]) => segments.map(segment => ({ ...segment,
      currentSelection: currentSelection && segment.end === null }));
    if (sub.bridgeProjector) return markCurrent(sub.bridgeProjector.snapshot());
    const tail = markCurrent(sub.tailProjector?.snapshot() ?? []);
    const history = sub.historyProjector?.snapshot() ?? (sub.historyPresentation?[...sub.historyPresentation.values()]:[]);
    if (!sub.group) return history.map(segment => ({ ...segment, currentSelection: false }));
    if ((!sub.historyProjector&&!sub.historyPresentation) || !sub.historyStatus?.archive) return tail;
    const combined = new Map<string, OrderWallSegment>();
    for (const segment of history) combined.set(segment.id, { ...segment, currentSelection: false });
    for (const segment of tail) combined.set(segment.id, segment);
    return [...combined.values()].sort((a, b) => a.start - b.start || a.side.localeCompare(b.side) || a.price - b.price);
  }

  private publishArchiveUpdate(sub: Subscription, update: OrderWallsArchiveUpdate) {
    if (update.kind === 'snapshot') this.publish(sub, 'snapshot', update.segments ?? [], update.status);
    else this.publish(sub, 'patch', update.patches ?? [], update.status);
  }

  private markPatches(sub:Subscription,patches:OrderWallPatch[],current:boolean):OrderWallPatch[]{
    const selected=current&&sub.group?.profileExact===true&&sub.group.currentValid;
    return patches.map(patch=>patch.segment?{...patch,segment:{...patch.segment,currentSelection:selected&&patch.segment.end===null}}:patch);
  }

  private diff(sub: Subscription, segments: OrderWallSegment[]) {
    this.stats.fullReconciliations++;this.stats.comparisonVisits+=segments.length;
    const next = new Map(segments.map(segment => [segment.id, segment])), patches: OrderWallPatch[] = [];
    for (const [id, previous] of sub.lastPublished) if (!next.has(id)) patches.push({ id, segment: null });
    for (const [id, segment] of next) {
      const previous = sub.lastPublished.get(id);
      if (!previous || !sameWallSegment(previous,segment)) patches.push({ id, segment, replaceValueRuns: true });
    }
    sub.lastPublished = next; return patches;
  }

  private status(sub: Subscription): OrderWallStatus {
    const settings = sub.settings, availability = orderWallsArchiveProfileId(sub.request.market, settings);
    const status = sub.historyStatus ?? { state: 'loading' as const, message: 'Waiting for the current selected-profile archive.',
      archive: emptyArchiveStatus(sub.request, 'loading') };
    const baseArchive = status.archive ?? emptyArchiveStatus(sub.request, 'loading');
    const priorArchive = mergeHistoryArchive(sub.historyArchiveCarry, baseArchive);
    const gaps = new Map<string, NonNullable<OrderWallStatus['archive']>['gaps'][number]>();
    for (const gap of [...priorArchive.gaps, ...sub.currentGaps]) {
      if (gap.to < sub.request.from) continue;
      gaps.set(`${gap.from}:${gap.to}:${gap.reason}`, gap);
    }
    const orderedGaps = [...gaps.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason));
    const gapsTruncated = Boolean(priorArchive.gapsTruncated || sub.currentGapsTruncated || orderedGaps.length > MAX_SUBSCRIPTION_ARCHIVE_GAPS);
    let archive: NonNullable<OrderWallStatus['archive']> = { ...priorArchive, profileId: availability ?? priorArchive.profileId,
      from: sub.request.from, to: sub.request.to,
      gaps: orderedGaps.slice(-MAX_SUBSCRIPTION_ARCHIVE_GAPS), ...(gapsTruncated ? { gapsTruncated: true } : {}),
      ...(!priorArchive.profileStatus && sub.group?.profileStatus ? { profileStatus: sub.group.profileStatus } : {}),
      ...(sub.currentMidpoint !== undefined ? { midpoint: sub.currentMidpoint } : {}) };
    if (this.pendingViewportNeedsExtension(sub)) {
      archive = { ...archive, state: 'loading', requestComplete: false, from: Math.min(sub.request.from, sub.pendingViewport!.from),
        to: sub.pendingViewport!.to, reason: 'Continuing fixed-watermark history through the advancing chart range.' };
      delete archive.resumeAfter;
    }
    const state = sub.currentState === 'live' ? 'live' : sub.currentState === 'unavailable' ? 'unavailable'
      : sub.currentState === 'stale' ? 'gap' : 'loading';
    const message = sub.currentMessage ?? (priorArchive.requestComplete === false ? status.message : sub.group && priorArchive.state !== 'complete'
      ? 'Current selected-profile walls are updating while archive history loads.' : status.message);
    return { ...status, ...(mergeHistoryCoverage(sub.historyCoverageCarry, status.coverage)
      ? { coverage: mergeHistoryCoverage(sub.historyCoverageCarry, status.coverage) } : {}),
      state, ...(message ? { message } : {}), ...(sub.currentAt !== undefined ? { lastConfirmedAt: sub.currentAt } : {}),
      ...(sub.currentScope ? { bookScope: sub.currentScope } : {}), archive };
  }

  private publish(sub: Subscription, kind: 'snapshot' | 'patch', value: OrderWallSegment[] | OrderWallPatch[], status: OrderWallStatus) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub) return;
    status={...status,currentSubscribed:sub.request.followLive===true};
    const event: Event = { type: 'order-wall-batch', ids: [sub.id], key: sub.key, generation: sub.generation,
      batchId: ++sub.batch, kind, ...(kind === 'snapshot' ? { segments: value as OrderWallSegment[] } : { patches: value as OrderWallPatch[] }), status };
    this.emit(event); sub.initialPublished = true;
    if (kind === 'snapshot') sub.lastPublished = new Map((value as OrderWallSegment[]).map(segment => [segment.id, segment]));
    else for (const patch of value as OrderWallPatch[]) {
      if (patch.segment) sub.lastPublished.set(patch.id, patch.segment);
      else sub.lastPublished.delete(patch.id);
    }
  }
}

function canCoalesceLiveViewport(previous: { from: number; to: number; followLive?: boolean },
  next: { from: number; to: number; followLive?: boolean }) {
  if (!previous.followLive || !next.followLive || next.to <= previous.to || next.from < previous.from) return false;
  const previousSpan = previous.to - previous.from, nextSpan = next.to - next.from;
  if (previousSpan <= 0 || nextSpan <= 0 || next.to - previous.to > Math.max(60_000, previousSpan * 0.1)) return false;
  const overlap = Math.max(0, Math.min(previous.to, next.to) - Math.max(previous.from, next.from));
  return overlap >= Math.min(previousSpan, nextSpan) * 0.9 && nextSpan >= previousSpan * 0.8 && nextSpan <= previousSpan * 1.2;
}

function mergeHistoryArchive(previous: OrderWallStatus['archive'], next: NonNullable<OrderWallStatus['archive']>)
  : NonNullable<OrderWallStatus['archive']> {
  if (!previous) return next;
  const gapMap = new Map<string, NonNullable<OrderWallStatus['archive']>['gaps'][number]>();
  for (const gap of [...previous.gaps, ...next.gaps]) gapMap.set(`${gap.from}:${gap.to}:${gap.reason}`, gap);
  const incomplete = next.requestComplete === false;
  const state: NonNullable<OrderWallStatus['archive']>['state'] = next.state === 'unavailable' ? 'unavailable'
    : incomplete ? next.state : previous.state === 'partial' || next.state === 'partial' ? 'partial' : next.state;
  const availableFrom = [previous.availableFrom, next.availableFrom].filter((value): value is number => value !== undefined);
  const confirmedTo = [previous.confirmedTo, next.confirmedTo].filter((value): value is number => value !== undefined);
  return { ...previous, ...next, state, requestComplete: next.requestComplete ?? previous.requestComplete,
    rangeComplete: previous.rangeComplete === true && next.rangeComplete === true,
    from: Math.min(previous.from, next.from), to: Math.max(previous.to, next.to),
    ...(availableFrom.length ? { availableFrom: Math.min(...availableFrom) } : {}),
    ...(confirmedTo.length ? { confirmedTo: Math.max(...confirmedTo) } : {}),
    loadedThrough: next.loadedThrough ?? previous.loadedThrough,
    gaps: [...gapMap.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason)),
    ...(previous.gapsTruncated || next.gapsTruncated ? { gapsTruncated: true } : {}),
    ...(!next.reason && previous.reason ? { reason: previous.reason } : {}) };
}

function mergeHistoryCoverage(previous: OrderWallStatus['coverage'], next: OrderWallStatus['coverage']) {
  if (!previous) return next;
  if (!next) return previous;
  const complete = previous.complete && next.complete;
  return { from: Math.min(previous.from, next.from), to: Math.max(previous.to, next.to), complete,
    partial: previous.partial || next.partial || !complete, ...(next.reason ?? previous.reason ? { reason: next.reason ?? previous.reason } : {}) };
}

type SelectedArchiveState = ReturnType<OrderWallsArchiveProjector['selectedState']>;

function warmHistoryKey(request:OrderWallsArchiveRequest){return historyJobKey({...request,after:0,watermark:undefined,head:undefined});}
function historyJobKey(request: OrderWallsArchiveRequest) {
  const settings = orderWallsSettings(request.settings);
  return JSON.stringify([request.market, orderWallsArchiveIdentity(request) ?? settings,
    request.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? null,
    request.from, request.to, request.after ?? 0, request.watermark ?? null,
    request.head ? [request.head.cursor, request.head.at, request.head.epoch] : null]);
}

const HISTORY_PAGE_TIMING_SAMPLE_LIMIT = 512;
function summarizeArchivePageTimings(metrics: OrderWallsArchivePageMetrics[], total: number) {
  const percentile = (key: keyof Pick<OrderWallsArchivePageMetrics, 'responseHeadersMs' | 'responseBodyReadMs' | 'jsonParseMs'
    | 'validationMs' | 'projectorApplyMs' | 'updateCallbackMs' | 'eventLoopYieldDelayMs' | 'responseBytes'>, quantile: number) => {
    const values = metrics.map(metric => metric[key] as number).sort((a, b) => a - b);
    return values.length ? values[Math.min(values.length - 1, Math.ceil(quantile * values.length) - 1)]! : null;
  };
  const fields = ['responseHeadersMs', 'responseBodyReadMs', 'jsonParseMs', 'validationMs', 'projectorApplyMs',
    'updateCallbackMs', 'eventLoopYieldDelayMs', 'responseBytes'] as const;
  return { totalPages: total, retainedSamples: metrics.length, completeSample: total <= metrics.length,
    p50: Object.fromEntries(fields.map(field => [field, percentile(field, .5)])),
    p95: Object.fromEntries(fields.map(field => [field, percentile(field, .95)])),
    max: Object.fromEntries(fields.map(field => [field, percentile(field, 1)])) };
}

function sameProjectorHead(state: SelectedArchiveState, head: NonNullable<CurrentGroup['head']>) {
  return state.cursor === head.cursor && state.at === head.at && state.epoch === head.epoch;
}

function copySelectedState(state: SelectedArchiveState): SelectedArchiveState {
  return { ...state, bookScope: state.bookScope ? { ...state.bookScope } : undefined,
    bids: state.bids.map(candidate => ({ ...candidate })), asks: state.asks.map(candidate => ({ ...candidate })) };
}

/**
 * Maps a current checkpoint's unknown-start IDs onto the archive's canonical
 * active IDs only when both projections prove the same complete state at H.
 * Start cursor/time/knownness may intentionally differ for the checkpoint;
 * the history projection remains authoritative for those fields.
 */
function proveEntryIdMapping(history: SelectedArchiveState, current: SelectedArchiveState) {
  if (history.cursor !== current.cursor || history.at !== current.at || history.epoch !== current.epoch
    || history.bids.length !== current.bids.length || history.asks.length !== current.asks.length) return undefined;
  const mapping = new Map<string, string>(), usedCurrent = new Set<string>(), usedHistory = new Set<string>();
  for (const side of ['bid', 'ask'] as const) {
    const historySide = side === 'bid' ? history.bids : history.asks;
    const currentSide = side === 'bid' ? current.bids : current.asks;
    const byPrice = new Map<string, OrderWallsArchiveCandidate>();
    for (const candidate of currentSide) {
      if (candidate.side !== side || byPrice.has(candidate.price) || usedCurrent.has(candidate.entryId)) return undefined;
      byPrice.set(candidate.price, candidate); usedCurrent.add(candidate.entryId);
    }
    for (const archived of historySide) {
      const live = byPrice.get(archived.price);
      if (!live || live.side !== archived.side || live.rank !== archived.rank
        || live.quantity !== archived.quantity || live.notional !== archived.notional
        || live.startEpoch !== archived.startEpoch
        || (live.confirmationAt ?? null) !== (archived.confirmationAt ?? null)
        || usedHistory.has(archived.entryId)) return undefined;
      if (mapping.has(live.entryId) && mapping.get(live.entryId) !== archived.entryId) return undefined;
      mapping.set(live.entryId, archived.entryId); usedHistory.add(archived.entryId);
    }
  }
  return mapping;
}

function pagesContinueFrom(pages: OrderWallsArchiveCurrentPage[], cursor: number, finalCursor: number, joinAt: number, epoch: number) {
  let covered = cursor;
  for (const page of pages) {
    if (page.page.nextAfter <= covered) continue;
    if (page.page.after > covered || page.head?.epoch !== epoch
      || page.patches.some(patch => patch.kind === 'gap' || patch.epoch !== epoch)) return false;
    const headAt = page.head?.at;
    if (headAt === undefined) return false;
    if ((page.coverage?.gaps ?? []).some(gap => {
      const from = gap.from ?? gap.at ?? 0, to = gap.to ?? gap.at ?? from;
      return from <= headAt && to > joinAt;
    })) return false;
    covered = Math.max(covered, page.page.nextAfter);
  }
  return covered >= finalCursor;
}

function remapCurrentPage(page: OrderWallsArchiveCurrentPage, entryIds?: Map<string, string>): OrderWallsArchiveCurrentPage {
  if (!entryIds?.size || !page.patches.length) return page;
  const patches = page.patches.map(patch => {
    const removed: string[] = [];
    const remapCandidate = (candidate: OrderWallsArchiveCandidate) => {
      const id = entryIds.get(candidate.entryId);
      return id ? { ...candidate, entryId: id } : candidate;
    };
    const remapRemoval = <T extends { entryId: string }>(removal: T) => {
      const id = entryIds.get(removal.entryId);
      if (!id) return removal;
      removed.push(removal.entryId);
      return { ...removal, entryId: id };
    };
    const result = { ...patch, bids: { upserts: patch.bids.upserts.map(remapCandidate), removals: patch.bids.removals.map(remapRemoval) },
      asks: { upserts: patch.asks.upserts.map(remapCandidate), removals: patch.asks.removals.map(remapRemoval) } };
    for (const id of removed) entryIds.delete(id);
    return result;
  });
  return { ...page, patches };
}

function profileSettings(request: NonNullable<ReturnType<typeof orderWallsArchiveCurrentRequest>>) {
  const aggregation = request.aggregation === 'native' ? 'native' : Number(String(request.aggregation).replace(/usdt$/, '')) as OrderWallsSettings['aggregation'];
  return orderWallsSettings({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, mode: 'top-levels', aggregation,
    searchRangePercent: request.bandPercent, topLevels: request.selectionTopN ?? 10,
    minimumNotionalEnabled: request.minimumNotionalUsd !== null,
    ...(request.minimumNotionalUsd !== null ? { minimumNotionalUsd: Number(request.minimumNotionalUsd) } : {}),
    minDurationMs: request.confirmationMs ?? 0 });
}

function toOrderWallScope(scope: OrderWallsArchiveCurrentPage['head'] extends infer _ ? import('./order-walls-archive').OrderWallsArchiveBookScope | undefined : never): OrderWallStatus['bookScope'] {
  if (!scope) return undefined;
  const bidFloor = Number(scope.snapshotBidFloor ?? scope.bidFloor ?? scope.observedBidLow);
  const askCeiling = Number(scope.snapshotAskCeiling ?? scope.askCeiling ?? scope.observedAskHigh);
  const maxLevelsPerSide = scope.maxLevelsPerSide ?? Math.max(scope.snapshotLevels?.bids ?? 0, scope.snapshotLevels?.asks ?? 0, 1);
  return { maxLevelsPerSide, bidComplete: scope.bidComplete ?? scope.bandCoverage?.bids === 'observed',
    askComplete: scope.askComplete ?? scope.bandCoverage?.asks === 'observed',
    ...(Number.isFinite(bidFloor) && bidFloor > 0 ? { bidFloor } : {}), ...(Number.isFinite(askCeiling) && askCeiling > 0 ? { askCeiling } : {}) };
}

function emptyArchiveStatus(request: OrderWallsArchiveRequest, state: NonNullable<OrderWallStatus['archive']>['state'], reason?: string): NonNullable<OrderWallStatus['archive']> {
  const settings = orderWallsSettings(request.settings);
  const availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  return { profileId: request.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? '', state,
    requestComplete: state !== 'loading',
    rangeComplete: false,
    from: request.from, to: request.to, market: request.market === 'binance-spot' ? 'spot' as const : 'perpetual' as const,
    aggregation: settings.aggregation === 'native' ? 'native' : `${settings.aggregation}usdt`,
    gaps: [], requestedBandPercent: settings.searchRangePercent, profileBandPercent: settings.searchRangePercent,
    requestedTopN: settings.topLevels, exact: availability.exact, ...(reason ? { reason } : {}) };
}

/** Exact rare rebase comparison; normal current updates use projector change sets. */
function sameWallSegment(a:OrderWallSegment,b:OrderWallSegment){
 const ak=Object.keys(a) as Array<keyof OrderWallSegment>,bk=Object.keys(b);
 if(ak.length!==bk.length)return false;
 for(const key of ak){if(key==='valueRuns')continue;if(a[key]!==b[key])return false;}
 if(a.valueRuns.length!==b.valueRuns.length)return false;
 return a.valueRuns.every((point,index)=>{const other=b.valueRuns[index]!;return point.at===other.at&&point.usd===other.usd&&point.percentile===other.percentile&&point.rank===other.rank&&point.quantity===other.quantity&&point.quantityExact===other.quantityExact&&point.notionalExact===other.notionalExact;});
}

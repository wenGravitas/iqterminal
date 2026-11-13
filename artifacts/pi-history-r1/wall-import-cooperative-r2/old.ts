/** Portable exact archive projection. This file is shared byte-for-byte with
 * iqterminal-server; it has no DOM, transport or serving dependencies. */
export const ORDER_WALL_ARCHIVE_MAX_SEGMENTS = 100_000;
export const ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS = 1_000_000;
export const ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT = 100_000;
export interface OrderWallsProjectionSettings {topLevels:number;minimumNotionalEnabled:boolean;minimumNotionalUsd:number;minDurationMs:number}
type OrderWallsSettings = OrderWallsProjectionSettings;

export interface WallProjectionCheckpoint {
  version: 1; settings: OrderWallsProjectionSettings; from: number; to: number; namespace: string;
  confirmedTo: number; cursor: number; epoch: number; midpoint: string | null; bookScope?: OrderWallsArchiveBookScope;
  seenGaps: string[]; segments: OrderWallSegment[]; valueRunOrder: number[][];
  candidates: Array<Omit<CandidateState, 'segment'> & {segmentId?: string}>;
  nextValueRunSequence: number; emittedRevision: number; valueHistoryLimited: boolean; episodeHistoryLimited: boolean;
}


export interface OrderWallsArchiveCandidate {
  entryId: string;
  side: 'bid' | 'ask';
  price: string;
  quantity: string;
  notional: string;
  rank: number;
  startedAt: number;
  startCursor: number;
  startEpoch: number;
  startKnown: boolean;
  /** First raw observation at or after the profile's confirmation boundary. */
  confirmationAt?: number | null;
}

export type OrderWallsArchiveRemovalReason =
  | 'band-exit' | 'rank-exit' | 'below-minimum' | 'observed-zero' | 'gap' | 'replacement-epoch' | 'capacity-unknown';

export interface OrderWallsArchiveRemoval {
  entryId: string;
  side: 'bid' | 'ask';
  price: string;
  at: number;
  cursor: number;
  epoch: number;
  reason: OrderWallsArchiveRemovalReason;
  lastConfirmedAt: number;
  lastConfirmedCursor: number;
}

export interface OrderWallsArchiveBookScope {
  maxLevelsPerSide?: number;
  bidComplete?: boolean;
  askComplete?: boolean;
  bidFloor?: string | number;
  askCeiling?: string | number;
  outerCoverage?: 'snapshot-bounded' | 'complete' | 'unknown' | string;
  snapshotLevels?: { bids: number; asks: number };
  snapshotBidFloor?: string | null;
  snapshotAskCeiling?: string | null;
  observedBidLow?: string | null;
  observedAskHigh?: string | null;
  observedLevels?: { bids: number; asks: number };
  requestedBand?: { bidLow: string; bidHigh: string; askLow: string; askHigh: string } | null;
  bandCoverage?: { bids: 'observed' | 'partial' | 'unknown'; asks: 'observed' | 'partial' | 'unknown' };
}

export interface OrderWallsArchiveSidePatch {
  upserts: OrderWallsArchiveCandidate[];
  removals: OrderWallsArchiveRemoval[];
}

export interface OrderWallsArchivePatch {
  kind: 'patch' | 'gap';
  cursor: number;
  epoch: number;
  at: number;
  midpoint: string | null;
  bids: OrderWallsArchiveSidePatch;
  asks: OrderWallsArchiveSidePatch;
  reason?: string;
  bookScope?: OrderWallsArchiveBookScope;
}

export interface OrderWallsArchiveProfile {
  id: string;
  version: number;
  market: 'spot' | 'perpetual';
  venue: 'binance';
  instrument: string;
  feed: string;
  aggregation: string;
  bandPercent: number;
  midpointBasis: string;
  topN: number;
  algorithmVersion: number;
  schemaVersion: number;
  /** Confirmation settings used by profiles that materialize nonzero delay crossings. */
  confirmationMs: number;
  selectionTopN: number;
  minimumNotionalUsd: string | null;
  exactDerivations: {
    bandPercent: number[];
    topNMax: number;
    minimumNotional: boolean;
    confirmation: boolean;
    confirmationCrossings?: boolean;
    [key: string]: unknown;
  };
}

export interface OrderWallsArchiveCoverage {
  availableFrom: number | null;
  requestedFrom: number;
  requestedTo: number;
  confirmedTo: number | null;
  gaps: Array<{ from?: number; to?: number; at?: number; reason: string }>;
  partial: boolean;
  gapsTruncated?: boolean;
  status: 'building' | 'backfilling' | 'complete' | 'partial' | 'unavailable';
  reason?: string;
  bookScope?: OrderWallsArchiveBookScope;
}

export interface OrderWallsArchivePage {
  version: number;
  profile: OrderWallsArchiveProfile;
  market: 'spot' | 'perpetual';
  instrument: string;
  feed: string;
  from: number;
  to: number;
  watermark: number;
  head?: { cursor: number; at: number; epoch: number };
  /** Backend profile catch-up state; independent of coverage for this fixed request range. */
  profileStatus?: 'building' | 'backfilling' | 'ready' | 'unavailable';
  page: { after: number; nextAfter: number; hasMore: boolean; lastAt: number; limit: number; sameMillisecondClosed: boolean };
  seed?: {
    at: number;
    cursor: number;
    epoch: number;
    midpoint: string | null;
    bookScope?: OrderWallsArchiveBookScope;
    bids: OrderWallsArchiveCandidate[];
    asks: OrderWallsArchiveCandidate[];
  };
  patches: OrderWallsArchivePatch[];
  coverage: OrderWallsArchiveCoverage;
}

export interface OrderWallsArchiveCurrentPage {
  version: number;
  profile: OrderWallsArchiveProfile;
  market: 'spot' | 'perpetual';
  instrument: string;
  feed: string;
  watermark: number;
  head: { cursor: number; at: number; epoch: number; midpoint: string | null; bookScope?: OrderWallsArchiveBookScope; valid: boolean };
  state?: { bids: OrderWallsArchiveCandidate[]; asks: OrderWallsArchiveCandidate[] };
  page: { after: number; nextAfter: number; hasMore: boolean; lastAt: number | null; limit: number; sameMillisecondClosed: boolean };
  patches: OrderWallsArchivePatch[];
  profileStatus?: 'building' | 'backfilling' | 'ready' | 'unavailable';
  coverage?: Partial<OrderWallsArchiveCoverage> & { status?: string; reason?: string };
}

export interface OrderWallSegment {
  id: string;
  /** Stable selected-candidate identity from the versioned server profile. */
  archiveEntryId?: string;
  /** True only while this candidate is in the current live selected set; never inferred from end:null. */
  currentSelection?: boolean;
  /** Depth-book generation that bounds continuity for this segment. */
  epoch: string | number;
  side: 'bid' | 'ask';
  price: number;
  /** Original exchange decimal string when supplied by the durable archive. */
  priceExact?: string;
  start: number;
  end: number | null;
  peakUsd: number;
  meanUsd: number;
  durationMs: number;
  percentile: number | null;
  scopePartial: boolean;
  /** False when a seed already contains the qualifying level at the timeline's left edge. */
  startKnown: boolean;
  detectionMode?: 'top-levels' | 'threshold';
  rank?: number;
  valueRuns: OrderWallValuePoint[];
  valueRunsTruncated: boolean;
  /** Closed by a confirmed below-threshold observation, an explicit removal, or a gap/epoch censor. */
  endReason: 'below-threshold' | 'removed' | 'censored' | 'rank-exit' | 'out-of-range' | 'below-minimum' | null;
  endKnown: boolean;
  censoredReason?: string;
}
export interface OrderWallValuePoint {
  at: number; usd: number; percentile: number | null; rank?: number | null; quantity?: number;
  /** Exact source decimals survive adapter/render-number conversion. */
  quantityExact?: string; notionalExact?: string;
}
export interface OrderWallHit {
  segment: OrderWallSegment;
  at: number;
  x: number;
  y: number;
  priceLow: number;
  priceHigh: number;
  percentile: number | null;
}
/** Patch id is the segment id, including for a null removal. */
export interface OrderWallPatch { revision?:number; id: string; segment: OrderWallSegment | null; valuePoints?: OrderWallValuePoint[]; replaceValueRuns?: boolean }
export class OrderWallsArchiveProjector {
  private readonly candidates = new Map<string, CandidateState>();
  private readonly segments = new Map<string, OrderWallSegment>();
  private readonly seenGaps = new Set<string>();
  private valueRunQueue: Array<{ id: string; sequence: number }> = [];
  private valueRunQueueStart = 0;
  private nextValueRunSequence = 0;
  private readonly valueRunSequences = new WeakMap<OrderWallValuePoint, number>();
  private totalValueRuns = 0;
  private valueHistoryLimited = false;
  private episodeHistoryLimited = false;
  private currentScope?: OrderWallsArchiveBookScope;
  private confirmedTo: number;
  private to: number;
  private cursor = 0;
  private epoch = 0;
  private midpoint: string | null = null;
  private patchBuffer = new Map<string, OrderWallPatch>();
  private emittedValues = new Map<string,{first?:OrderWallValuePoint;last?:OrderWallValuePoint;length:number}>();
  private emittedRevision = 0;

  constructor(private readonly settings: OrderWallsSettings, private readonly from: number, to: number, private readonly segmentNamespace = '') {
    this.to = to;
    this.confirmedTo = from;
  }


  /** Preparation-only ownership transfer. A producer persists closed data and keeps
   * only active state in its resumable checkpoint. It retains a revision and
   * creation-order index from the emitted patches, so later replacements keep
   * the incumbent identity/order. Aggregate capacity still covers disk + active. */
  takeClosedSegments() {
    if(this.patchBuffer.size)throw Error('Closed wall transfer requires a completed page fold');
    const closed:Array<{segment:OrderWallSegment;valueRunOrder:number[]}>=[];
    for(const [id,segment] of this.segments){
      if(segment.end===null)continue;
      const valueRunOrder=segment.valueRuns.map(point=>{const sequence=this.valueRunSequences.get(point);if(sequence===undefined)throw Error('Closed wall value has no sequence');return sequence;});
      closed.push({segment,valueRunOrder});this.segments.delete(id);this.emittedValues.delete(id);
      this.totalValueRuns=Math.max(0,this.totalValueRuns-segment.valueRuns.length);
      for(const point of segment.valueRuns)this.valueRunSequences.delete(point);
    }
    this.trim();return closed;
  }

  /** Quiescent page-fold state. Segment insertion and retained-value order are
   * preserved so resume keeps the incumbent eviction and correction semantics. */
  checkpoint(): WallProjectionCheckpoint {
    if(this.patchBuffer.size)throw Error('Wall projection checkpoint requires a completed page fold');
    const segments=[...this.segments.values()];
    return {version:1,settings:{topLevels:this.settings.topLevels,minimumNotionalEnabled:this.settings.minimumNotionalEnabled,
      minimumNotionalUsd:this.settings.minimumNotionalUsd,minDurationMs:this.settings.minDurationMs},
      from:this.from,to:this.to,namespace:this.segmentNamespace,confirmedTo:this.confirmedTo,cursor:this.cursor,epoch:this.epoch,midpoint:this.midpoint,
      bookScope:this.currentScope?structuredClone(this.currentScope):undefined,seenGaps:[...this.seenGaps],
      segments:segments.map(cloneSegment),valueRunOrder:segments.map(segment=>segment.valueRuns.map(point=>{
        const sequence=this.valueRunSequences.get(point);if(sequence===undefined)throw Error('Wall projection retained value has no sequence');return sequence;
      })),candidates:[...this.candidates.values()].map(({segment,...state})=>({...state,candidate:{...state.candidate},
        ...(state.qualifyingCandidate?{qualifyingCandidate:{...state.qualifyingCandidate}}:{}),...(segment?{segmentId:segment.id}:{})})),
      nextValueRunSequence:this.nextValueRunSequence,emittedRevision:this.emittedRevision,
      valueHistoryLimited:this.valueHistoryLimited,episodeHistoryLimited:this.episodeHistoryLimited};
  }

  static restoreCheckpoint(value:unknown,settings:OrderWallsProjectionSettings,from:number,to:number,namespace='') {
    validateCheckpoint(value,settings,from,to,namespace);
    const state=value as WallProjectionCheckpoint,projector=new OrderWallsArchiveProjector(settings,from,to,namespace);
    projector.currentScope=state.bookScope?structuredClone(state.bookScope):undefined;projector.confirmedTo=state.confirmedTo;
    projector.cursor=state.cursor;projector.epoch=state.epoch;projector.midpoint=state.midpoint;
    projector.valueHistoryLimited=state.valueHistoryLimited;projector.episodeHistoryLimited=state.episodeHistoryLimited;
    projector.nextValueRunSequence=state.nextValueRunSequence;projector.emittedRevision=state.emittedRevision;
    for(const [i,source] of state.segments.entries()){
      const segment=cloneSegment(source);projector.segments.set(segment.id,segment);
      for(const [j,point] of segment.valueRuns.entries()){
        const sequence=state.valueRunOrder[i]![j]!;projector.valueRunSequences.set(point,sequence);
        projector.valueRunQueue.push({id:segment.id,sequence});projector.totalValueRuns++;
      }
      projector.emittedValues.set(segment.id,{first:segment.valueRuns[0],last:segment.valueRuns.at(-1),length:segment.valueRuns.length});
    }
    projector.valueRunQueue.sort((a,b)=>a.sequence-b.sequence);
    for(const source of state.candidates){
      const {segmentId,...candidate}=source;
      projector.candidates.set(candidate.candidate.entryId,{...candidate,candidate:{...candidate.candidate},
        ...(candidate.qualifyingCandidate?{qualifyingCandidate:{...candidate.qualifyingCandidate}}:{}),
        ...(segmentId?{segment:projector.segments.get(segmentId)!}:{})});
    }
    for(const gap of state.seenGaps)projector.seenGaps.add(gap);
    return projector;
  }

  get historyLimited() { return this.valueHistoryLimited || this.episodeHistoryLimited; }
  get valueRunsLimited() { return this.valueHistoryLimited; }
  get episodesLimited() { return this.episodeHistoryLimited; }
  get confirmedAt() { return this.confirmedTo; }

  diagnostics() {
    let largestSegmentRuns = 0;
    for (const segment of this.segments.values()) largestSegmentRuns = Math.max(largestSegmentRuns, segment.valueRuns.length);
    return { retainedSegments: this.segments.size, activeCandidates: this.candidates.size, valueRuns: this.totalValueRuns,
      largestSegmentRuns, queuedValueRuns: this.valueRunQueue.length - this.valueRunQueueStart,
      episodeHistoryLimited: this.episodeHistoryLimited, valueHistoryLimited: this.valueHistoryLimited };
  }

  extendTo(to: number) { if (Number.isFinite(to)) this.to = Math.max(this.to, to); }

  confirmWatermark(cursor: number, at: number, epoch: number, midpoint?: string | null) {
    if (!validInt(cursor) || !finiteNonNegative(at) || !validInt(epoch) || cursor < this.cursor || epoch !== this.epoch) return false;
    this.advanceAll(at); this.confirmedTo = Math.max(this.confirmedTo, at);
    this.cursor = cursor; if (midpoint !== undefined) this.midpoint = midpoint;
    return true;
  }

  selectedState() {
    const candidates = [...this.candidates.values()].map(state => state.candidate);
    return { at: this.confirmedTo, cursor: this.cursor, epoch: this.epoch, midpoint: this.midpoint,
      bookScope: this.currentScope, bids: candidates.filter(candidate => candidate.side === 'bid').sort((a, b) => a.rank - b.rank),
      asks: candidates.filter(candidate => candidate.side === 'ask').sort((a, b) => a.rank - b.rank) };
  }

  seedSelectedState(state: ReturnType<OrderWallsArchiveProjector['selectedState']>) {
    this.patchBuffer.clear(); this.currentScope = state.bookScope; this.cursor = state.cursor; this.epoch = state.epoch; this.midpoint = state.midpoint;
    this.advanceAll(state.at);
    for (const candidate of [...state.bids, ...state.asks]) this.upsert(candidate, state.at, true);
    this.confirmedTo = state.at;
    return this.flushPatchBuffer();
  }

  cloneForLiveTail(to = Number.MAX_SAFE_INTEGER) {
    const clone = new OrderWallsArchiveProjector(this.settings, this.from, Math.max(this.to, to), this.segmentNamespace);
    clone.currentScope = this.currentScope;
    clone.confirmedTo = this.confirmedTo; clone.cursor = this.cursor; clone.epoch = this.epoch; clone.midpoint = this.midpoint;
    clone.valueHistoryLimited = this.valueHistoryLimited; clone.episodeHistoryLimited = this.episodeHistoryLimited;
    for (const [id, segment] of this.segments) {
      const copied = cloneSegment(segment);
      clone.segments.set(id, copied);
      for (const point of copied.valueRuns) clone.enqueueValueRun(id, point);
    }
    clone.totalValueRuns = [...clone.segments.values()].reduce((sum, segment) => sum + segment.valueRuns.length, 0);
    for (const [id, state] of this.candidates) clone.candidates.set(id, { ...state,
      segment: state.segment ? clone.segments.get(state.segment.id) : undefined, candidate: { ...state.candidate },
      qualifyingCandidate: state.qualifyingCandidate ? { ...state.qualifyingCandidate } : undefined });
    for (const gap of this.seenGaps) clone.seenGaps.add(gap);
    return clone;
  }

  applyPage(page: OrderWallsArchivePage): OrderWallPatch[] {
    this.patchBuffer.clear();
    const head = page.head;
    if (!head) throw new Error('Order Walls archive page is missing its fixed-watermark head');
    if (page.seed && !this.candidates.size && !this.segments.size) {
      this.currentScope = page.seed.bookScope;
      const seedAt = Math.max(this.from, page.seed.at, page.coverage.availableFrom ?? this.from);
      this.cursor = page.seed.cursor; this.epoch = page.seed.epoch; this.midpoint = page.seed.midpoint;
      this.advanceAll(seedAt);
      for (const candidate of [...page.seed.bids, ...page.seed.asks]) this.upsert(candidate, seedAt, true);
      this.confirmedTo = seedAt;
    }
    for (const patch of page.patches) {
      this.cursor = patch.cursor; this.epoch = patch.epoch; this.midpoint = patch.midpoint;
      this.currentScope = patch.bookScope ?? this.currentScope;
      if (patch.kind === 'gap') this.applyGap(patch);
      else {
        this.advanceAll(patch.at);
        for (const candidate of [...patch.bids.upserts, ...patch.asks.upserts]) this.upsert(candidate, patch.at, false);
        for (const removal of [...patch.bids.removals, ...patch.asks.removals]) this.remove(removal);
      }
    }
    // Coverage.confirmedTo describes the whole fixed request range. While the
    // cursor is still paging, only this page's last applied timestamp is safe
    // to advance geometry through. The terminal page proves the quiet tail to
    // the request's confirmed watermark and may then close that interval.
    const pageConfirmedTo = page.page.hasMore ? page.page.lastAt : page.coverage.confirmedTo ?? page.page.lastAt;
    const confirmed = Math.min(this.to, Math.max(this.from, pageConfirmedTo));
    this.applyCoverageGaps(page.coverage.gaps, confirmed);
    if (confirmed >= this.confirmedTo) {
      this.advanceAll(confirmed);
      this.confirmedTo = confirmed;
    }
    this.cursor = Math.max(this.cursor, page.page.nextAfter);
    this.epoch = head.epoch;
    this.trim();
    return this.flushPatchBuffer();
  }

  snapshot() { return [...this.segments.values()].sort((a, b) => a.start - b.start || a.side.localeCompare(b.side) || a.price - b.price); }

  /** Censors active replay state at a known fence when a verified current tail cannot join it. */
  censorOpen(at: number, reason: string) {
    this.patchBuffer.clear();
    for (const [id, state] of this.candidates) {
      const end = Math.min(at, state.lastAt);
      this.advance(state, end);
      if (state.segment) this.close(state, end, false, 'censored', reason);
      this.candidates.delete(id);
    }
    return this.flushPatchBuffer();
  }

  applyCurrentPage(page: OrderWallsArchiveCurrentPage, from?: number) {
    const head = page.head;
    if (!head) throw new Error('Order Walls current page is missing its fixed-watermark head');
    const seedFrom = from ?? head.at;
    const confirmedTo = Math.min(page.coverage?.confirmedTo ?? head.at, head.at);
    const gaps = (page.coverage?.gaps ?? []).filter(gap => (gap.from ?? gap.at ?? 0) <= head.at);
    const converted: OrderWallsArchivePage = {
      version: 1, profile: page.profile, market: page.market, instrument: page.instrument, feed: page.feed,
      from: seedFrom, to: Number.MAX_SAFE_INTEGER, watermark: page.watermark,
      head: { cursor: head.cursor, at: head.at, epoch: head.epoch },
      page: { ...page.page, lastAt: page.page.lastAt ?? head.at },
      ...(page.state ? { seed: { at: head.at, cursor: head.cursor, epoch: head.epoch,
        midpoint: head.midpoint, bookScope: head.bookScope, bids: page.state.bids, asks: page.state.asks } } : {}),
      patches: page.patches,
      coverage: { availableFrom: page.coverage?.availableFrom ?? seedFrom, requestedFrom: seedFrom,
        requestedTo: Number.MAX_SAFE_INTEGER, confirmedTo,
        gaps, partial: page.coverage?.partial ?? false,
        status: coverageState(page.coverage?.status ?? 'complete') as OrderWallsArchiveCoverage['status'],
        ...(page.coverage?.reason ? { reason: page.coverage.reason } : {}), bookScope: head.bookScope },
    };
    return this.applyPage(converted);
  }

  private upsert(candidate: OrderWallsArchiveCandidate, at: number, carryIn: boolean) {
    if (!validCandidate(candidate)) return;
    const previous = this.candidates.get(candidate.entryId);
    if (previous) this.advance(previous, at);
    const eligible = this.eligible(candidate);
    const state = previous ?? this.newCandidateState(candidate, at, carryIn, eligible);
    if (previous) {
      const wasEligible = previous.eligible;
      previous.candidate = candidate;
      previous.eligible = eligible;
      if (wasEligible && !eligible) {
        this.close(previous, at, true, !this.settings.minimumNotionalEnabled || compareDecimalToNumber(candidate.notional, this.settings.minimumNotionalUsd) >= 0 ? 'rank-exit' : 'below-minimum');
        previous.qualifyingAt = undefined;
        previous.qualifyingCursor = undefined;
      } else if (!wasEligible && eligible) {
        previous.qualifyingAt = at;
        previous.qualifyingCursor = this.cursor;
        previous.qualifyingStartKnown = true;
        previous.qualifyingCandidate = candidate;
      }
      previous.candidate = candidate;
      if (eligible && previous.segment) this.appendValue(previous.segment, candidate, at);
      if (eligible && !previous.segment) {
        if (previous.qualifyingAt === undefined) {
          previous.qualifyingAt = at;
          previous.qualifyingCursor = this.cursor;
          previous.qualifyingStartKnown = !carryIn;
          previous.qualifyingCandidate = candidate;
        }
        previous.qualifyingCandidate = candidate;
        this.maybeOpen(previous, at);
      }
      return;
    }
    this.candidates.set(candidate.entryId, state);
    if (eligible) {
      if (carryIn) {
        state.qualifyingAt = candidate.startKnown ? Math.max(0, candidate.startedAt) : at;
        state.qualifyingCursor = candidate.startCursor;
        state.qualifyingStartKnown = candidate.startKnown;
        state.qualifyingCandidate = candidate;
      }
      this.maybeOpen(state, at);
    }
  }

  private newCandidateState(candidate: OrderWallsArchiveCandidate, at: number, carryIn: boolean, eligible: boolean): CandidateState {
    const start = carryIn ? candidate.startKnown ? Math.max(0, candidate.startedAt) : at : Math.max(this.from, candidate.startedAt);
    const state: CandidateState = {
      candidate, eligible, lastAt: start, usdMs: 0, peakUsd: decimalNumber(candidate.notional),
      qualifyingAt: eligible ? start : undefined,
      qualifyingCursor: eligible ? carryIn ? candidate.startCursor : this.cursor : undefined,
      qualifyingStartKnown: eligible ? carryIn ? candidate.startKnown : candidate.startKnown && candidate.startedAt >= this.from : false,
      qualifyingCandidate: eligible ? candidate : undefined,
    };
    if (eligible && !carryIn && candidate.startedAt < this.from) state.qualifyingStartKnown = false;
    if (!eligible) state.lastAt = at;
    return state;
  }

  private maybeOpen(state: CandidateState, confirmedTo: number) {
    if (state.segment || !state.eligible || state.qualifyingAt === undefined || !state.qualifyingCandidate) return;
    const start = state.qualifyingAt;
    if (confirmedTo < start) return;
    const candidate = state.qualifyingCandidate;
    if (this.settings.minDurationMs > 0 && (candidate.confirmationAt === undefined || candidate.confirmationAt === null
      || candidate.confirmationAt < start + this.settings.minDurationMs || confirmedTo < candidate.confirmationAt)) return;
    const id = segmentId(candidate.entryId, this.settings, state.qualifyingCursor, state.qualifyingStartKnown, this.segmentNamespace);
    const point = valuePoint(candidate, start);
    const segment: OrderWallSegment = {
      id, archiveEntryId: candidate.entryId, epoch: candidate.startEpoch, side: candidate.side, price: decimalNumber(candidate.price), priceExact: candidate.price,
      start, end: null, peakUsd: decimalNumber(candidate.notional), meanUsd: decimalNumber(candidate.notional),
      durationMs: Math.max(0, confirmedTo - start), percentile: null, scopePartial: this.scopePartial(candidate.side),
      startKnown: state.qualifyingStartKnown, detectionMode: 'top-levels', rank: candidate.rank, valueRuns: [point],
      valueRunsTruncated: false, endReason: null, endKnown: false,
    };
    state.segment = segment;
    state.usdMs = decimalNumber(candidate.notional) * Math.max(0, confirmedTo - start);
    this.totalValueRuns++;
    this.enqueueValueRun(segment.id, point);
    state.lastAt = confirmedTo;
    state.peakUsd = segment.peakUsd;
    state.valueSignature = candidateSignature(candidate);
    this.store(segment);
  }

  private appendValue(segment: OrderWallSegment, candidate: OrderWallsArchiveCandidate, at: number) {
    const state = this.candidates.get(candidate.entryId);
    if (!state || state.valueSignature === candidateSignature(candidate)) return;
    const point = valuePoint(candidate, at), last = segment.valueRuns.at(-1);
    if (last?.at === at) {
      // Replacing a point preserves the retained count. Decrementing here
      // under-reported capacity and made counts change after clone/restore.
      segment.valueRuns[segment.valueRuns.length - 1] = point;
    } else {
      segment.valueRuns.push(point); this.totalValueRuns++;
    }
    this.enqueueValueRun(segment.id, point);
    state.valueSignature = candidateSignature(candidate);
    state.peakUsd = Math.max(state.peakUsd, point.usd);
    segment.peakUsd = state.peakUsd;
    segment.rank = candidate.rank;
    segment.priceExact = candidate.price;
    segment.price = decimalNumber(candidate.price);
    this.trimValues(segment);
    this.store(segment);
  }

  private advanceAll(at: number) {
    for (const state of this.candidates.values()) this.advance(state, at);
  }

  private advance(state: CandidateState, at: number) {
    if (!Number.isFinite(at)) return;
    if (state.eligible && !state.segment) this.maybeOpen(state, at);
    const segment = state.segment;
    if (!segment) { state.lastAt = Math.max(state.lastAt, at); return; }
    const end = Math.min(this.to, Math.max(state.lastAt, at));
    const elapsed = Math.max(0, end - state.lastAt);
    state.usdMs += decimalNumber(state.candidate.notional) * elapsed;
    state.lastAt = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.meanUsd = segment.durationMs > 0 ? state.usdMs / segment.durationMs : decimalNumber(state.candidate.notional);
    this.store(segment);
  }

  private remove(removal: OrderWallsArchiveRemoval) {
    const state = this.candidates.get(removal.entryId);
    if (!state) return;
    const censored = isCensoredRemoval(removal.reason);
    const end = censored ? Math.min(removal.at, removal.lastConfirmedAt) : removal.at;
    this.advance(state, end);
    const reason = removalReason(removal.reason);
    this.close(state, end, !censored, reason, censored ? removal.reason : undefined);
    this.candidates.delete(removal.entryId);
  }

  private applyGap(patch: OrderWallsArchivePatch) {
    const removals = [...patch.bids.removals, ...patch.asks.removals];
    const removalById = new Map(removals.map(item => [item.entryId, item]));
    for (const [id, state] of this.candidates) {
      const removal = removalById.get(id);
      const end = removal?.lastConfirmedAt ?? state.lastAt;
      this.advance(state, end);
      this.close(state, end, false, 'censored', patch.reason ?? removal?.reason ?? 'Depth history gap.');
      this.candidates.delete(id);
    }
  }

  private applyCoverageGaps(gaps: OrderWallsArchiveCoverage['gaps'], confirmedTo: number) {
    for (const gap of gaps) {
      const from = gap.from ?? gap.at ?? this.from, to = gap.to ?? gap.at ?? from;
      const key = `${from}:${to}:${gap.reason}`;
      if (this.seenGaps.has(key)) continue;
      this.seenGaps.add(key);
      for (const [id, state] of this.candidates) {
      if (to < state.lastAt || from > confirmedTo) continue;
      const end = Math.min(state.lastAt, from);
        this.advance(state, end);
        this.close(state, end, false, 'censored', gap.reason);
        this.candidates.delete(id);
      }
    }
  }

  private close(state: CandidateState, at: number, endKnown: boolean, reason: OrderWallSegment['endReason'], censoredReason?: string) {
    const segment = state.segment;
    if (!segment) return;
    const end = Math.max(segment.start, Math.min(this.to, at));
    segment.end = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.endReason = reason;
    segment.endKnown = endKnown;
    if (!endKnown && censoredReason) segment.censoredReason = censoredReason;
    this.store(segment);
    state.segment = undefined;
  }

  private eligible(candidate: OrderWallsArchiveCandidate) {
    return candidate.rank <= this.settings.topLevels
      && (!this.settings.minimumNotionalEnabled || compareDecimalToNumber(candidate.notional, this.settings.minimumNotionalUsd) >= 0);
  }

  private scopePartial(side: 'bid' | 'ask') {
    return side === 'bid' ? this.currentScope?.bidComplete !== true : this.currentScope?.askComplete !== true;
  }

  private store(segment: OrderWallSegment) {
    this.segments.set(segment.id, segment);
    // Keep a reference while the page fold is in progress. flushPatchBuffer()
    // copies the final state once per changed segment instead of once per event.
    this.patchBuffer.set(segment.id, { id: segment.id, segment, replaceValueRuns: true });
  }

  private trimValues(segment: OrderWallSegment) {
    if (segment.valueRuns.length > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT) {
      const remove = segment.valueRuns.length - ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT;
      segment.valueRuns.splice(0, remove);
      this.totalValueRuns = Math.max(0, this.totalValueRuns - remove);
      segment.valueRunsTruncated = true;
      this.valueHistoryLimited = true;
    }
    while (this.totalValueRuns > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS && this.valueRunQueueStart < this.valueRunQueue.length) {
      const oldest = this.valueRunQueue[this.valueRunQueueStart++]!;
      const candidate = this.segments.get(oldest.id), first = candidate?.valueRuns[0];
      if (!candidate || !first || this.valueRunSequences.get(first) !== oldest.sequence) continue;
      candidate.valueRuns.shift(); candidate.valueRunsTruncated = true;
      this.totalValueRuns--; this.valueHistoryLimited = true;
      this.store(candidate);
    }
    if (this.valueRunQueueStart > 4_096 && this.valueRunQueueStart * 2 > this.valueRunQueue.length) {
      this.valueRunQueue = this.valueRunQueue.slice(this.valueRunQueueStart); this.valueRunQueueStart = 0;
    }
  }

  private trim() {
    if(this.valueRunQueue.length-this.valueRunQueueStart>Math.max(4096,this.totalValueRuns*2+512)){
      const retained:Array<{id:string;sequence:number}>=[];
      for(const segment of this.segments.values())for(const point of segment.valueRuns){const sequence=this.valueRunSequences.get(point);if(sequence!==undefined)retained.push({id:segment.id,sequence});}
      retained.sort((a,b)=>a.sequence-b.sequence);this.valueRunQueue=retained;this.valueRunQueueStart=0;
    }
    while (this.segments.size > ORDER_WALL_ARCHIVE_MAX_SEGMENTS) {
      let oldest: OrderWallSegment | undefined;
      for (const segment of this.segments.values()) if (segment.end !== null) { oldest = segment; break; }
      if (!oldest) break;
      this.segments.delete(oldest.id); this.emittedValues.delete(oldest.id);
      this.totalValueRuns = Math.max(0, this.totalValueRuns - oldest.valueRuns.length);
      this.patchBuffer.set(oldest.id, { id: oldest.id, segment: null }); this.episodeHistoryLimited = true;
    }
  }

  private enqueueValueRun(id: string, point: OrderWallValuePoint) {
    const sequence = ++this.nextValueRunSequence;
    this.valueRunSequences.set(point, sequence);
    this.valueRunQueue.push({ id, sequence });
  }

  private flushPatchBuffer() {
    const patches:OrderWallPatch[]=[];
    for(const patch of this.patchBuffer.values()){
      const segment=patch.segment;
      if(!segment){this.emittedValues.delete(patch.id);patches.push({...patch,revision:++this.emittedRevision});continue;}
      const runs=segment.valueRuns,previous=this.emittedValues.get(patch.id);
      const append=previous&&previous.first===runs[0]&&runs.length>=previous.length;
      if(append){
        const offset=previous.length>0&&runs[previous.length-1]!==previous.last?previous.length-1:previous.length;
        patches.push({...patch,revision:++this.emittedRevision,segment:{...segment,valueRuns:[]},
          replaceValueRuns:false,valuePoints:runs.slice(offset).map(point=>({...point}))});
      }else patches.push({...patch,revision:++this.emittedRevision,segment:cloneSegment(segment),replaceValueRuns:true});
      this.emittedValues.set(patch.id,{first:runs[0],last:runs.at(-1),length:runs.length});
    }
    this.patchBuffer.clear();return patches;
  }
}

interface CandidateState {
  candidate: OrderWallsArchiveCandidate;
  eligible: boolean;
  segment?: OrderWallSegment;
  qualifyingAt?: number;
  qualifyingCursor?: number;
  qualifyingStartKnown: boolean;
  qualifyingCandidate?: OrderWallsArchiveCandidate;
  lastAt: number;
  usdMs: number;
  peakUsd: number;
  valueSignature?: string;
}

function coverageState(value: string): OrderWallsArchiveCoverage['status'] {
  if (value === 'building' || value === 'backfilling' || value === 'unavailable') return value;
  return value === 'complete' ? 'complete' : 'partial';
}

function compareDecimalToNumber(decimal: string, value: number) {
  const threshold = expandExponent(value.toString());
  const [leftWhole, leftFraction = ''] = decimal.split('.');
  const [rightWhole, rightFraction = ''] = threshold.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const left = BigInt(`${leftWhole}${leftFraction.padEnd(scale, '0')}` || '0');
  const right = BigInt(`${rightWhole}${rightFraction.padEnd(scale, '0')}` || '0');
  return left < right ? -1 : left > right ? 1 : 0;
}

function expandExponent(value: string) {
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponentText] = value.toLowerCase().split('e');
  const exponent = Number(exponentText), negative = mantissa!.startsWith('-');
  const unsigned = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, fraction = ''] = unsigned.split('.'), digits = whole + fraction, decimalAt = whole.length + exponent;
  const expanded = decimalAt <= 0 ? `0.${'0'.repeat(-decimalAt)}${digits}`
    : decimalAt >= digits.length ? `${digits}${'0'.repeat(decimalAt - digits.length)}`
      : `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  return `${negative ? '-' : ''}${expanded}`;
}
function validCandidate(value: unknown): value is OrderWallsArchiveCandidate {
  if (!isRecord(value)) return false;
  return typeof value.entryId === 'string' && value.entryId.length > 0 && (value.side === 'bid' || value.side === 'ask')
    && validDecimal(value.price) && decimalNumber(value.price) > 0 && validDecimal(value.quantity) && validDecimal(value.notional)
    && validInt(value.rank) && value.rank >= 1 && value.rank <= 10 && finiteNonNegative(value.startedAt)
    && validInt(value.startCursor) && validInt(value.startEpoch) && typeof value.startKnown === 'boolean'
    && (value.confirmationAt === undefined || value.confirmationAt === null || finiteNonNegative(value.confirmationAt));
}
function segmentId(entryId: string, settings: OrderWallsSettings, cursor: number | undefined, startKnown: boolean, namespace = '') {
  const filter = `${settings.topLevels}:${settings.minimumNotionalEnabled ? settings.minimumNotionalUsd : 'off'}:${settings.minDurationMs}`;
  return `${entryId}:view-${filter}:${startKnown ? `q${cursor ?? 0}` : 'carry'}${namespace ? `:${namespace}` : ''}`;
}
function valuePoint(candidate: OrderWallsArchiveCandidate, at: number): OrderWallValuePoint {
  return { at, usd: decimalNumber(candidate.notional), percentile: null, rank: candidate.rank,
    quantity: decimalNumber(candidate.quantity), quantityExact: candidate.quantity, notionalExact: candidate.notional };
}
function candidateSignature(candidate: OrderWallsArchiveCandidate) {
  return `${candidate.price}|${candidate.quantity}|${candidate.notional}|${candidate.rank}`;
}
function removalReason(reason: OrderWallsArchiveRemovalReason): OrderWallSegment['endReason'] {
  if (reason === 'rank-exit') return 'rank-exit';
  if (reason === 'below-minimum') return 'below-minimum';
  if (reason === 'band-exit') return 'out-of-range';
  if (reason === 'observed-zero') return 'removed';
  if (reason === 'replacement-epoch' || reason === 'gap' || reason === 'capacity-unknown') return 'censored';
  return 'removed';
}
function isCensoredRemoval(reason: OrderWallsArchiveRemovalReason) {
  return reason === 'gap' || reason === 'replacement-epoch' || reason === 'capacity-unknown';
}
function validDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
function decimalNumber(value: string) { return Number(value); }
function cloneSegment(segment: OrderWallSegment): OrderWallSegment { return { ...segment, valueRuns: segment.valueRuns.map(point => ({ ...point })) }; }
function validInt(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function finiteNonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function validateCheckpoint(value:unknown,settings:OrderWallsProjectionSettings,from:number,to:number,namespace:string):asserts value is WallProjectionCheckpoint {
  const fail=()=>{throw Error('Invalid wall projection checkpoint');};
  if(!isRecord(value)||value.version!==1||value.from!==from||value.to!==to||value.namespace!==namespace||!finiteNonNegative(from)||!finiteNonNegative(to)||from>=to)fail();
  const v=value as Record<string,any>,filter=v.settings;
  if(!isRecord(filter)||filter.topLevels!==settings.topLevels||filter.minimumNotionalEnabled!==settings.minimumNotionalEnabled||filter.minDurationMs!==settings.minDurationMs
    ||settings.minimumNotionalEnabled&&filter.minimumNotionalUsd!==settings.minimumNotionalUsd||!validInt(filter.topLevels)||filter.topLevels<1||filter.topLevels>10
    ||!finiteNonNegative(filter.minimumNotionalUsd)||!finiteNonNegative(filter.minDurationMs)||filter.minDurationMs>60000||typeof filter.minimumNotionalEnabled!=='boolean')fail();
  if(!finiteNonNegative(v.confirmedTo)||v.confirmedTo<from||!validInt(v.cursor)||!validInt(v.epoch)||v.midpoint!==null&&!validDecimal(v.midpoint)
    ||v.bookScope!==undefined&&!isRecord(v.bookScope)||typeof v.valueHistoryLimited!=='boolean'||typeof v.episodeHistoryLimited!=='boolean'
    ||!validInt(v.nextValueRunSequence)||!validInt(v.emittedRevision)||!Array.isArray(v.seenGaps)||!v.seenGaps.every((gap:unknown)=>typeof gap==='string')
    ||!Array.isArray(v.segments)||v.segments.length>ORDER_WALL_ARCHIVE_MAX_SEGMENTS||!Array.isArray(v.valueRunOrder)||v.valueRunOrder.length!==v.segments.length
    ||!Array.isArray(v.candidates)||v.candidates.length>20)fail();
  const ids=new Map<string,OrderWallSegment>(),sequences=new Set<number>();let runs=0;
  for(const [i,segment] of v.segments.entries()){
    if(!isRecord(segment)||typeof segment.id!=='string'||!segment.id||ids.has(segment.id)||typeof segment.archiveEntryId!=='string'||!segment.archiveEntryId
      ||!validInt(segment.epoch)||!['bid','ask'].includes(segment.side)||!validDecimal(segment.priceExact)||segment.price!==Number(segment.priceExact)||!finiteNonNegative(segment.price)||segment.price<=0
      ||!finiteNonNegative(segment.start)||segment.end!==null&&(!finiteNonNegative(segment.end)||segment.end<segment.start)
      ||!finiteNonNegative(segment.peakUsd)||!finiteNonNegative(segment.meanUsd)||!finiteNonNegative(segment.durationMs)||segment.percentile!==null
      ||typeof segment.scopePartial!=='boolean'||typeof segment.startKnown!=='boolean'||typeof segment.endKnown!=='boolean'||segment.detectionMode!=='top-levels'
      ||!validInt(segment.rank)||segment.rank<1||segment.rank>10||typeof segment.valueRunsTruncated!=='boolean'
      ||segment.valueRunsTruncated&&!v.valueHistoryLimited||!['below-threshold','removed','censored','rank-exit','out-of-range','below-minimum',null].includes(segment.endReason)
      ||segment.censoredReason!==undefined&&typeof segment.censoredReason!=='string'||!Array.isArray(segment.valueRuns)||segment.valueRuns.length>ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT
      ||!Array.isArray(v.valueRunOrder[i])||v.valueRunOrder[i].length!==segment.valueRuns.length)fail();
    for(const [j,point] of segment.valueRuns.entries()){
      const sequence=v.valueRunOrder[i][j];
      if(!isRecord(point)||!finiteNonNegative(point.at)||point.percentile!==null||!validInt(point.rank)||point.rank<1||point.rank>10
        ||!validDecimal(point.quantityExact)||!validDecimal(point.notionalExact)||point.quantity!==Number(point.quantityExact)||point.usd!==Number(point.notionalExact)
        ||!finiteNonNegative(point.quantity)||!finiteNonNegative(point.usd)||!validInt(sequence)||sequence<1||sequence>v.nextValueRunSequence||sequences.has(sequence))fail();
      sequences.add(sequence);runs++;
    }
    ids.set(segment.id,segment as unknown as OrderWallSegment);
  }
  if(runs>ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS)fail();
  const candidateIds=new Set<string>(),activeIds=new Set<string>();
  for(const state of v.candidates){
    if(!isRecord(state)||!validCandidate(state.candidate)||candidateIds.has(state.candidate.entryId)||typeof state.eligible!=='boolean'
      ||state.eligible!==(state.candidate.rank<=settings.topLevels&&(!settings.minimumNotionalEnabled||compareDecimalToNumber(state.candidate.notional,settings.minimumNotionalUsd)>=0))
      ||!finiteNonNegative(state.lastAt)||!finiteNonNegative(state.usdMs)||!finiteNonNegative(state.peakUsd)||typeof state.qualifyingStartKnown!=='boolean'
      ||state.qualifyingAt!==undefined&&!finiteNonNegative(state.qualifyingAt)||state.qualifyingCursor!==undefined&&!validInt(state.qualifyingCursor)
      ||state.qualifyingCandidate!==undefined&&(!validCandidate(state.qualifyingCandidate)||state.qualifyingCandidate.entryId!==state.candidate.entryId)
      ||state.valueSignature!==undefined&&typeof state.valueSignature!=='string')fail();
    if(state.segmentId!==undefined){const segment=ids.get(state.segmentId);if(typeof state.segmentId!=='string'||activeIds.has(state.segmentId)||!segment||segment.end!==null||!state.eligible||segment.archiveEntryId!==state.candidate.entryId)fail();activeIds.add(state.segmentId);}
    candidateIds.add(state.candidate.entryId);
  }
  for(const segment of ids.values())if(segment.end===null&&!activeIds.has(segment.id))fail();
}

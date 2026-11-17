// src/shared/order-walls-projection.ts
var ORDER_WALL_ARCHIVE_MAX_SEGMENTS = 1e5;
var ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS = 1e6;
var ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT = 1e5;
var OrderWallsArchiveProjector = class _OrderWallsArchiveProjector {
  constructor(settings, from, to, segmentNamespace = "") {
    this.settings = settings;
    this.from = from;
    this.segmentNamespace = segmentNamespace;
    this.to = to;
    this.confirmedTo = from;
  }
  candidates = /* @__PURE__ */ new Map();
  segments = /* @__PURE__ */ new Map();
  seenGaps = /* @__PURE__ */ new Set();
  valueRunQueue = [];
  valueRunQueueStart = 0;
  nextValueRunSequence = 0;
  valueRunSequences = /* @__PURE__ */ new WeakMap();
  totalValueRuns = 0;
  valueHistoryLimited = false;
  episodeHistoryLimited = false;
  currentScope;
  confirmedTo;
  to;
  cursor = 0;
  epoch = 0;
  midpoint = null;
  patchBuffer = /* @__PURE__ */ new Map();
  emittedValues = /* @__PURE__ */ new Map();
  emittedRevision = 0;
  /** Preparation-only ownership transfer. A producer persists closed data and keeps
   * only active state in its resumable checkpoint. It retains a revision and
   * creation-order index from the emitted patches, so later replacements keep
   * the incumbent identity/order. Aggregate capacity still covers disk + active. */
  takeClosedSegments() {
    if (this.patchBuffer.size) throw Error("Closed wall transfer requires a completed page fold");
    const closed = [];
    for (const [id, segment] of this.segments) {
      if (segment.end === null) continue;
      const valueRunOrder = segment.valueRuns.map((point) => {
        const sequence = this.valueRunSequences.get(point);
        if (sequence === void 0) throw Error("Closed wall value has no sequence");
        return sequence;
      });
      closed.push({ segment, valueRunOrder });
      this.segments.delete(id);
      this.emittedValues.delete(id);
      this.totalValueRuns = Math.max(0, this.totalValueRuns - segment.valueRuns.length);
      for (const point of segment.valueRuns) this.valueRunSequences.delete(point);
    }
    this.trim();
    return closed;
  }
  /** Quiescent page-fold state. Segment insertion and retained-value order are
   * preserved so resume keeps the incumbent eviction and correction semantics. */
  checkpoint() {
    if (this.patchBuffer.size) throw Error("Wall projection checkpoint requires a completed page fold");
    const segments = [...this.segments.values()];
    return {
      version: 1,
      settings: {
        topLevels: this.settings.topLevels,
        minimumNotionalEnabled: this.settings.minimumNotionalEnabled,
        minimumNotionalUsd: this.settings.minimumNotionalUsd,
        minDurationMs: this.settings.minDurationMs
      },
      from: this.from,
      to: this.to,
      namespace: this.segmentNamespace,
      confirmedTo: this.confirmedTo,
      cursor: this.cursor,
      epoch: this.epoch,
      midpoint: this.midpoint,
      bookScope: this.currentScope ? structuredClone(this.currentScope) : void 0,
      seenGaps: [...this.seenGaps],
      segments: segments.map(cloneSegment),
      valueRunOrder: segments.map((segment) => segment.valueRuns.map((point) => {
        const sequence = this.valueRunSequences.get(point);
        if (sequence === void 0) throw Error("Wall projection retained value has no sequence");
        return sequence;
      })),
      candidates: [...this.candidates.values()].map(({ segment, ...state }) => ({
        ...state,
        candidate: { ...state.candidate },
        ...state.qualifyingCandidate ? { qualifyingCandidate: { ...state.qualifyingCandidate } } : {},
        ...segment ? { segmentId: segment.id } : {}
      })),
      nextValueRunSequence: this.nextValueRunSequence,
      emittedRevision: this.emittedRevision,
      valueHistoryLimited: this.valueHistoryLimited,
      episodeHistoryLimited: this.episodeHistoryLimited
    };
  }
  static restoreCheckpoint(value, settings, from, to, namespace = "") {
    validateCheckpoint(value, settings, from, to, namespace);
    const state = value, projector = new _OrderWallsArchiveProjector(settings, from, to, namespace);
    projector.currentScope = state.bookScope ? structuredClone(state.bookScope) : void 0;
    projector.confirmedTo = state.confirmedTo;
    projector.cursor = state.cursor;
    projector.epoch = state.epoch;
    projector.midpoint = state.midpoint;
    projector.valueHistoryLimited = state.valueHistoryLimited;
    projector.episodeHistoryLimited = state.episodeHistoryLimited;
    projector.nextValueRunSequence = state.nextValueRunSequence;
    projector.emittedRevision = state.emittedRevision;
    for (const [i, source] of state.segments.entries()) {
      const segment = cloneSegment(source);
      projector.segments.set(segment.id, segment);
      for (const [j, point] of segment.valueRuns.entries()) {
        const sequence = state.valueRunOrder[i][j];
        projector.valueRunSequences.set(point, sequence);
        projector.valueRunQueue.push({ id: segment.id, sequence });
        projector.totalValueRuns++;
      }
      projector.emittedValues.set(segment.id, { first: segment.valueRuns[0], last: segment.valueRuns.at(-1), length: segment.valueRuns.length });
    }
    projector.valueRunQueue.sort((a, b) => a.sequence - b.sequence);
    for (const source of state.candidates) {
      const { segmentId: segmentId2, ...candidate } = source;
      projector.candidates.set(candidate.candidate.entryId, {
        ...candidate,
        candidate: { ...candidate.candidate },
        ...candidate.qualifyingCandidate ? { qualifyingCandidate: { ...candidate.qualifyingCandidate } } : {},
        ...segmentId2 ? { segment: projector.segments.get(segmentId2) } : {}
      });
    }
    for (const gap of state.seenGaps) projector.seenGaps.add(gap);
    return projector;
  }
  get historyLimited() {
    return this.valueHistoryLimited || this.episodeHistoryLimited;
  }
  get valueRunsLimited() {
    return this.valueHistoryLimited;
  }
  get episodesLimited() {
    return this.episodeHistoryLimited;
  }
  get confirmedAt() {
    return this.confirmedTo;
  }
  diagnostics() {
    let largestSegmentRuns = 0;
    for (const segment of this.segments.values()) largestSegmentRuns = Math.max(largestSegmentRuns, segment.valueRuns.length);
    return {
      retainedSegments: this.segments.size,
      activeCandidates: this.candidates.size,
      valueRuns: this.totalValueRuns,
      largestSegmentRuns,
      queuedValueRuns: this.valueRunQueue.length - this.valueRunQueueStart,
      episodeHistoryLimited: this.episodeHistoryLimited,
      valueHistoryLimited: this.valueHistoryLimited
    };
  }
  extendTo(to) {
    if (Number.isFinite(to)) this.to = Math.max(this.to, to);
  }
  confirmWatermark(cursor, at, epoch, midpoint) {
    if (!validInt(cursor) || !finiteNonNegative(at) || !validInt(epoch) || cursor < this.cursor || epoch !== this.epoch) return false;
    this.advanceAll(at);
    this.confirmedTo = Math.max(this.confirmedTo, at);
    this.cursor = cursor;
    if (midpoint !== void 0) this.midpoint = midpoint;
    return true;
  }
  selectedState() {
    const candidates = [...this.candidates.values()].map((state) => state.candidate);
    return {
      at: this.confirmedTo,
      cursor: this.cursor,
      epoch: this.epoch,
      midpoint: this.midpoint,
      bookScope: this.currentScope,
      bids: candidates.filter((candidate) => candidate.side === "bid").sort((a, b) => a.rank - b.rank),
      asks: candidates.filter((candidate) => candidate.side === "ask").sort((a, b) => a.rank - b.rank)
    };
  }
  seedSelectedState(state) {
    this.patchBuffer.clear();
    this.currentScope = state.bookScope;
    this.cursor = state.cursor;
    this.epoch = state.epoch;
    this.midpoint = state.midpoint;
    this.advanceAll(state.at);
    for (const candidate of [...state.bids, ...state.asks]) this.upsert(candidate, state.at, true);
    this.confirmedTo = state.at;
    return this.flushPatchBuffer();
  }
  cloneForLiveTail(to = Number.MAX_SAFE_INTEGER) {
    const clone = new _OrderWallsArchiveProjector(this.settings, this.from, Math.max(this.to, to), this.segmentNamespace);
    clone.currentScope = this.currentScope;
    clone.confirmedTo = this.confirmedTo;
    clone.cursor = this.cursor;
    clone.epoch = this.epoch;
    clone.midpoint = this.midpoint;
    clone.valueHistoryLimited = this.valueHistoryLimited;
    clone.episodeHistoryLimited = this.episodeHistoryLimited;
    for (const [id, segment] of this.segments) {
      const copied = cloneSegment(segment);
      clone.segments.set(id, copied);
      for (const point of copied.valueRuns) clone.enqueueValueRun(id, point);
    }
    clone.totalValueRuns = [...clone.segments.values()].reduce((sum, segment) => sum + segment.valueRuns.length, 0);
    for (const [id, state] of this.candidates) clone.candidates.set(id, {
      ...state,
      segment: state.segment ? clone.segments.get(state.segment.id) : void 0,
      candidate: { ...state.candidate },
      qualifyingCandidate: state.qualifyingCandidate ? { ...state.qualifyingCandidate } : void 0
    });
    for (const gap of this.seenGaps) clone.seenGaps.add(gap);
    return clone;
  }
  applyPage(page) {
    this.patchBuffer.clear();
    const head = page.head;
    if (!head) throw new Error("Order Walls archive page is missing its fixed-watermark head");
    if (page.seed && !this.candidates.size && !this.segments.size) {
      this.currentScope = page.seed.bookScope;
      const seedAt = Math.max(this.from, page.seed.at, page.coverage.availableFrom ?? this.from);
      this.cursor = page.seed.cursor;
      this.epoch = page.seed.epoch;
      this.midpoint = page.seed.midpoint;
      this.advanceAll(seedAt);
      for (const candidate of [...page.seed.bids, ...page.seed.asks]) this.upsert(candidate, seedAt, true);
      this.confirmedTo = seedAt;
    }
    for (const patch of page.patches) {
      this.cursor = patch.cursor;
      this.epoch = patch.epoch;
      this.midpoint = patch.midpoint;
      this.currentScope = patch.bookScope ?? this.currentScope;
      if (patch.kind === "gap") this.applyGap(patch);
      else {
        this.advanceAll(patch.at);
        for (const candidate of [...patch.bids.upserts, ...patch.asks.upserts]) this.upsert(candidate, patch.at, false);
        for (const removal of [...patch.bids.removals, ...patch.asks.removals]) this.remove(removal);
      }
    }
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
  snapshot() {
    return [...this.segments.values()].sort((a, b) => a.start - b.start || a.side.localeCompare(b.side) || a.price - b.price);
  }
  /** Censors active replay state at a known fence when a verified current tail cannot join it. */
  censorOpen(at, reason) {
    this.patchBuffer.clear();
    for (const [id, state] of this.candidates) {
      const end = Math.min(at, state.lastAt);
      this.advance(state, end);
      if (state.segment) this.close(state, end, false, "censored", reason);
      this.candidates.delete(id);
    }
    return this.flushPatchBuffer();
  }
  applyCurrentPage(page, from) {
    const head = page.head;
    if (!head) throw new Error("Order Walls current page is missing its fixed-watermark head");
    const seedFrom = from ?? head.at;
    const confirmedTo = Math.min(page.coverage?.confirmedTo ?? head.at, head.at);
    const gaps = (page.coverage?.gaps ?? []).filter((gap) => (gap.from ?? gap.at ?? 0) <= head.at);
    const converted = {
      version: 1,
      profile: page.profile,
      market: page.market,
      instrument: page.instrument,
      feed: page.feed,
      from: seedFrom,
      to: Number.MAX_SAFE_INTEGER,
      watermark: page.watermark,
      head: { cursor: head.cursor, at: head.at, epoch: head.epoch },
      page: { ...page.page, lastAt: page.page.lastAt ?? head.at },
      ...page.state ? { seed: {
        at: head.at,
        cursor: head.cursor,
        epoch: head.epoch,
        midpoint: head.midpoint,
        bookScope: head.bookScope,
        bids: page.state.bids,
        asks: page.state.asks
      } } : {},
      patches: page.patches,
      coverage: {
        availableFrom: page.coverage?.availableFrom ?? seedFrom,
        requestedFrom: seedFrom,
        requestedTo: Number.MAX_SAFE_INTEGER,
        confirmedTo,
        gaps,
        partial: page.coverage?.partial ?? false,
        status: coverageState(page.coverage?.status ?? "complete"),
        ...page.coverage?.reason ? { reason: page.coverage.reason } : {},
        bookScope: head.bookScope
      }
    };
    return this.applyPage(converted);
  }
  upsert(candidate, at, carryIn) {
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
        this.close(previous, at, true, !this.settings.minimumNotionalEnabled || compareDecimalToNumber(candidate.notional, this.settings.minimumNotionalUsd) >= 0 ? "rank-exit" : "below-minimum");
        previous.qualifyingAt = void 0;
        previous.qualifyingCursor = void 0;
      } else if (!wasEligible && eligible) {
        previous.qualifyingAt = at;
        previous.qualifyingCursor = this.cursor;
        previous.qualifyingStartKnown = true;
        previous.qualifyingCandidate = candidate;
      }
      previous.candidate = candidate;
      if (eligible && previous.segment) this.appendValue(previous.segment, candidate, at);
      if (eligible && !previous.segment) {
        if (previous.qualifyingAt === void 0) {
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
  newCandidateState(candidate, at, carryIn, eligible) {
    const start = carryIn ? candidate.startKnown ? Math.max(0, candidate.startedAt) : at : Math.max(this.from, candidate.startedAt);
    const state = {
      candidate,
      eligible,
      lastAt: start,
      usdMs: 0,
      peakUsd: decimalNumber(candidate.notional),
      qualifyingAt: eligible ? start : void 0,
      qualifyingCursor: eligible ? carryIn ? candidate.startCursor : this.cursor : void 0,
      qualifyingStartKnown: eligible ? carryIn ? candidate.startKnown : candidate.startKnown && candidate.startedAt >= this.from : false,
      qualifyingCandidate: eligible ? candidate : void 0
    };
    if (eligible && !carryIn && candidate.startedAt < this.from) state.qualifyingStartKnown = false;
    if (!eligible) state.lastAt = at;
    return state;
  }
  maybeOpen(state, confirmedTo) {
    if (state.segment || !state.eligible || state.qualifyingAt === void 0 || !state.qualifyingCandidate) return;
    const start = state.qualifyingAt;
    if (confirmedTo < start) return;
    const candidate = state.qualifyingCandidate;
    if (this.settings.minDurationMs > 0 && (candidate.confirmationAt === void 0 || candidate.confirmationAt === null || candidate.confirmationAt < start + this.settings.minDurationMs || confirmedTo < candidate.confirmationAt)) return;
    const id = segmentId(candidate.entryId, this.settings, state.qualifyingCursor, state.qualifyingStartKnown, this.segmentNamespace);
    const point = valuePoint(candidate, start);
    const segment = {
      id,
      archiveEntryId: candidate.entryId,
      epoch: candidate.startEpoch,
      side: candidate.side,
      price: decimalNumber(candidate.price),
      priceExact: candidate.price,
      start,
      end: null,
      peakUsd: decimalNumber(candidate.notional),
      meanUsd: decimalNumber(candidate.notional),
      durationMs: Math.max(0, confirmedTo - start),
      percentile: null,
      scopePartial: this.scopePartial(candidate.side),
      startKnown: state.qualifyingStartKnown,
      detectionMode: "top-levels",
      rank: candidate.rank,
      valueRuns: [point],
      valueRunsTruncated: false,
      endReason: null,
      endKnown: false
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
  appendValue(segment, candidate, at) {
    const state = this.candidates.get(candidate.entryId);
    if (!state || state.valueSignature === candidateSignature(candidate)) return;
    const point = valuePoint(candidate, at), last = segment.valueRuns.at(-1);
    if (last?.at === at) {
      segment.valueRuns[segment.valueRuns.length - 1] = point;
    } else {
      segment.valueRuns.push(point);
      this.totalValueRuns++;
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
  advanceAll(at) {
    for (const state of this.candidates.values()) this.advance(state, at);
  }
  advance(state, at) {
    if (!Number.isFinite(at)) return;
    if (state.eligible && !state.segment) this.maybeOpen(state, at);
    const segment = state.segment;
    if (!segment) {
      state.lastAt = Math.max(state.lastAt, at);
      return;
    }
    const end = Math.min(this.to, Math.max(state.lastAt, at));
    const elapsed = Math.max(0, end - state.lastAt);
    state.usdMs += decimalNumber(state.candidate.notional) * elapsed;
    state.lastAt = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.meanUsd = segment.durationMs > 0 ? state.usdMs / segment.durationMs : decimalNumber(state.candidate.notional);
    this.store(segment);
  }
  remove(removal) {
    const state = this.candidates.get(removal.entryId);
    if (!state) return;
    const censored = isCensoredRemoval(removal.reason);
    const end = censored ? Math.min(removal.at, removal.lastConfirmedAt) : removal.at;
    this.advance(state, end);
    const reason = removalReason(removal.reason);
    this.close(state, end, !censored, reason, censored ? removal.reason : void 0);
    this.candidates.delete(removal.entryId);
  }
  applyGap(patch) {
    const removals = [...patch.bids.removals, ...patch.asks.removals];
    const removalById = new Map(removals.map((item) => [item.entryId, item]));
    for (const [id, state] of this.candidates) {
      const removal = removalById.get(id);
      const end = removal?.lastConfirmedAt ?? state.lastAt;
      this.advance(state, end);
      this.close(state, end, false, "censored", patch.reason ?? removal?.reason ?? "Depth history gap.");
      this.candidates.delete(id);
    }
  }
  applyCoverageGaps(gaps, confirmedTo) {
    for (const gap of gaps) {
      const from = gap.from ?? gap.at ?? this.from, to = gap.to ?? gap.at ?? from;
      const key = `${from}:${to}:${gap.reason}`;
      if (this.seenGaps.has(key)) continue;
      this.seenGaps.add(key);
      for (const [id, state] of this.candidates) {
        if (to < state.lastAt || from > confirmedTo) continue;
        const end = Math.min(state.lastAt, from);
        this.advance(state, end);
        this.close(state, end, false, "censored", gap.reason);
        this.candidates.delete(id);
      }
    }
  }
  close(state, at, endKnown, reason, censoredReason) {
    const segment = state.segment;
    if (!segment) return;
    const end = Math.max(segment.start, Math.min(this.to, at));
    segment.end = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.endReason = reason;
    segment.endKnown = endKnown;
    if (!endKnown && censoredReason) segment.censoredReason = censoredReason;
    this.store(segment);
    state.segment = void 0;
  }
  eligible(candidate) {
    return candidate.rank <= this.settings.topLevels && (!this.settings.minimumNotionalEnabled || compareDecimalToNumber(candidate.notional, this.settings.minimumNotionalUsd) >= 0);
  }
  scopePartial(side) {
    return side === "bid" ? this.currentScope?.bidComplete !== true : this.currentScope?.askComplete !== true;
  }
  store(segment) {
    this.segments.set(segment.id, segment);
    this.patchBuffer.set(segment.id, { id: segment.id, segment, replaceValueRuns: true });
  }
  trimValues(segment) {
    if (segment.valueRuns.length > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT) {
      const remove = segment.valueRuns.length - ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT;
      segment.valueRuns.splice(0, remove);
      this.totalValueRuns = Math.max(0, this.totalValueRuns - remove);
      segment.valueRunsTruncated = true;
      this.valueHistoryLimited = true;
    }
    while (this.totalValueRuns > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS && this.valueRunQueueStart < this.valueRunQueue.length) {
      const oldest = this.valueRunQueue[this.valueRunQueueStart++];
      const candidate = this.segments.get(oldest.id), first = candidate?.valueRuns[0];
      if (!candidate || !first || this.valueRunSequences.get(first) !== oldest.sequence) continue;
      candidate.valueRuns.shift();
      candidate.valueRunsTruncated = true;
      this.totalValueRuns--;
      this.valueHistoryLimited = true;
      this.store(candidate);
    }
    if (this.valueRunQueueStart > 4096 && this.valueRunQueueStart * 2 > this.valueRunQueue.length) {
      this.valueRunQueue = this.valueRunQueue.slice(this.valueRunQueueStart);
      this.valueRunQueueStart = 0;
    }
  }
  trim() {
    if (this.valueRunQueue.length - this.valueRunQueueStart > Math.max(4096, this.totalValueRuns * 2 + 512)) {
      const retained = [];
      for (const segment of this.segments.values()) for (const point of segment.valueRuns) {
        const sequence = this.valueRunSequences.get(point);
        if (sequence !== void 0) retained.push({ id: segment.id, sequence });
      }
      retained.sort((a, b) => a.sequence - b.sequence);
      this.valueRunQueue = retained;
      this.valueRunQueueStart = 0;
    }
    while (this.segments.size > ORDER_WALL_ARCHIVE_MAX_SEGMENTS) {
      let oldest;
      for (const segment of this.segments.values()) if (segment.end !== null) {
        oldest = segment;
        break;
      }
      if (!oldest) break;
      this.segments.delete(oldest.id);
      this.emittedValues.delete(oldest.id);
      this.totalValueRuns = Math.max(0, this.totalValueRuns - oldest.valueRuns.length);
      this.patchBuffer.set(oldest.id, { id: oldest.id, segment: null });
      this.episodeHistoryLimited = true;
    }
  }
  enqueueValueRun(id, point) {
    const sequence = ++this.nextValueRunSequence;
    this.valueRunSequences.set(point, sequence);
    this.valueRunQueue.push({ id, sequence });
  }
  flushPatchBuffer() {
    const patches = [];
    for (const patch of this.patchBuffer.values()) {
      const segment = patch.segment;
      if (!segment) {
        this.emittedValues.delete(patch.id);
        patches.push({ ...patch, revision: ++this.emittedRevision });
        continue;
      }
      const runs = segment.valueRuns, previous = this.emittedValues.get(patch.id);
      const append = previous && previous.first === runs[0] && runs.length >= previous.length;
      if (append) {
        const offset = previous.length > 0 && runs[previous.length - 1] !== previous.last ? previous.length - 1 : previous.length;
        patches.push({
          ...patch,
          revision: ++this.emittedRevision,
          segment: { ...segment, valueRuns: [] },
          replaceValueRuns: false,
          valuePoints: runs.slice(offset).map((point) => ({ ...point }))
        });
      } else patches.push({ ...patch, revision: ++this.emittedRevision, segment: cloneSegment(segment), replaceValueRuns: true });
      this.emittedValues.set(patch.id, { first: runs[0], last: runs.at(-1), length: runs.length });
    }
    this.patchBuffer.clear();
    return patches;
  }
};
function coverageState(value) {
  if (value === "building" || value === "backfilling" || value === "unavailable") return value;
  return value === "complete" ? "complete" : "partial";
}
function compareDecimalToNumber(decimal, value) {
  const threshold = expandExponent(value.toString());
  const [leftWhole, leftFraction = ""] = decimal.split(".");
  const [rightWhole, rightFraction = ""] = threshold.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const left = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}` || "0");
  const right = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}` || "0");
  return left < right ? -1 : left > right ? 1 : 0;
}
function expandExponent(value) {
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponentText] = value.toLowerCase().split("e");
  const exponent = Number(exponentText), negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split("."), digits = whole + fraction, decimalAt = whole.length + exponent;
  const expanded = decimalAt <= 0 ? `0.${"0".repeat(-decimalAt)}${digits}` : decimalAt >= digits.length ? `${digits}${"0".repeat(decimalAt - digits.length)}` : `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  return `${negative ? "-" : ""}${expanded}`;
}
function validCandidate(value) {
  if (!isRecord(value)) return false;
  return typeof value.entryId === "string" && value.entryId.length > 0 && (value.side === "bid" || value.side === "ask") && validDecimal(value.price) && decimalNumber(value.price) > 0 && validDecimal(value.quantity) && validDecimal(value.notional) && validInt(value.rank) && value.rank >= 1 && value.rank <= 10 && finiteNonNegative(value.startedAt) && validInt(value.startCursor) && validInt(value.startEpoch) && typeof value.startKnown === "boolean" && (value.confirmationAt === void 0 || value.confirmationAt === null || finiteNonNegative(value.confirmationAt));
}
function segmentId(entryId, settings, cursor, startKnown, namespace = "") {
  const filter = `${settings.topLevels}:${settings.minimumNotionalEnabled ? settings.minimumNotionalUsd : "off"}:${settings.minDurationMs}`;
  return `${entryId}:view-${filter}:${startKnown ? `q${cursor ?? 0}` : "carry"}${namespace ? `:${namespace}` : ""}`;
}
function valuePoint(candidate, at) {
  return {
    at,
    usd: decimalNumber(candidate.notional),
    percentile: null,
    rank: candidate.rank,
    quantity: decimalNumber(candidate.quantity),
    quantityExact: candidate.quantity,
    notionalExact: candidate.notional
  };
}
function candidateSignature(candidate) {
  return `${candidate.price}|${candidate.quantity}|${candidate.notional}|${candidate.rank}`;
}
function removalReason(reason) {
  if (reason === "rank-exit") return "rank-exit";
  if (reason === "below-minimum") return "below-minimum";
  if (reason === "band-exit") return "out-of-range";
  if (reason === "observed-zero") return "removed";
  if (reason === "replacement-epoch" || reason === "gap" || reason === "capacity-unknown") return "censored";
  return "removed";
}
function isCensoredRemoval(reason) {
  return reason === "gap" || reason === "replacement-epoch" || reason === "capacity-unknown";
}
function validDecimal(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
function decimalNumber(value) {
  return Number(value);
}
function cloneSegment(segment) {
  return { ...segment, valueRuns: segment.valueRuns.map((point) => ({ ...point })) };
}
function validInt(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateCheckpoint(value, settings, from, to, namespace) {
  const fail = () => {
    throw Error("Invalid wall projection checkpoint");
  };
  if (!isRecord(value) || value.version !== 1 || value.from !== from || value.to !== to || value.namespace !== namespace || !finiteNonNegative(from) || !finiteNonNegative(to) || from >= to) fail();
  const v = value, filter = v.settings;
  if (!isRecord(filter) || filter.topLevels !== settings.topLevels || filter.minimumNotionalEnabled !== settings.minimumNotionalEnabled || filter.minDurationMs !== settings.minDurationMs || settings.minimumNotionalEnabled && filter.minimumNotionalUsd !== settings.minimumNotionalUsd || !validInt(filter.topLevels) || filter.topLevels < 1 || filter.topLevels > 10 || !finiteNonNegative(filter.minimumNotionalUsd) || !finiteNonNegative(filter.minDurationMs) || filter.minDurationMs > 6e4 || typeof filter.minimumNotionalEnabled !== "boolean") fail();
  if (!finiteNonNegative(v.confirmedTo) || v.confirmedTo < from || !validInt(v.cursor) || !validInt(v.epoch) || v.midpoint !== null && !validDecimal(v.midpoint) || v.bookScope !== void 0 && !isRecord(v.bookScope) || typeof v.valueHistoryLimited !== "boolean" || typeof v.episodeHistoryLimited !== "boolean" || !validInt(v.nextValueRunSequence) || !validInt(v.emittedRevision) || !Array.isArray(v.seenGaps) || !v.seenGaps.every((gap) => typeof gap === "string") || !Array.isArray(v.segments) || v.segments.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || !Array.isArray(v.valueRunOrder) || v.valueRunOrder.length !== v.segments.length || !Array.isArray(v.candidates) || v.candidates.length > 20) fail();
  const ids = /* @__PURE__ */ new Map(), sequences = /* @__PURE__ */ new Set();
  let runs = 0;
  for (const [i, segment] of v.segments.entries()) {
    if (!isRecord(segment) || typeof segment.id !== "string" || !segment.id || ids.has(segment.id) || typeof segment.archiveEntryId !== "string" || !segment.archiveEntryId || !validInt(segment.epoch) || !["bid", "ask"].includes(segment.side) || !validDecimal(segment.priceExact) || segment.price !== Number(segment.priceExact) || !finiteNonNegative(segment.price) || segment.price <= 0 || !finiteNonNegative(segment.start) || segment.end !== null && (!finiteNonNegative(segment.end) || segment.end < segment.start) || !finiteNonNegative(segment.peakUsd) || !finiteNonNegative(segment.meanUsd) || !finiteNonNegative(segment.durationMs) || segment.percentile !== null || typeof segment.scopePartial !== "boolean" || typeof segment.startKnown !== "boolean" || typeof segment.endKnown !== "boolean" || segment.detectionMode !== "top-levels" || !validInt(segment.rank) || segment.rank < 1 || segment.rank > 10 || typeof segment.valueRunsTruncated !== "boolean" || segment.valueRunsTruncated && !v.valueHistoryLimited || !["below-threshold", "removed", "censored", "rank-exit", "out-of-range", "below-minimum", null].includes(segment.endReason) || segment.censoredReason !== void 0 && typeof segment.censoredReason !== "string" || !Array.isArray(segment.valueRuns) || segment.valueRuns.length > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT || !Array.isArray(v.valueRunOrder[i]) || v.valueRunOrder[i].length !== segment.valueRuns.length) fail();
    for (const [j, point] of segment.valueRuns.entries()) {
      const sequence = v.valueRunOrder[i][j];
      if (!isRecord(point) || !finiteNonNegative(point.at) || point.percentile !== null || !validInt(point.rank) || point.rank < 1 || point.rank > 10 || !validDecimal(point.quantityExact) || !validDecimal(point.notionalExact) || point.quantity !== Number(point.quantityExact) || point.usd !== Number(point.notionalExact) || !finiteNonNegative(point.quantity) || !finiteNonNegative(point.usd) || !validInt(sequence) || sequence < 1 || sequence > v.nextValueRunSequence || sequences.has(sequence)) fail();
      sequences.add(sequence);
      runs++;
    }
    ids.set(segment.id, segment);
  }
  if (runs > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS) fail();
  const candidateIds = /* @__PURE__ */ new Set(), activeIds = /* @__PURE__ */ new Set();
  for (const state of v.candidates) {
    if (!isRecord(state) || !validCandidate(state.candidate) || candidateIds.has(state.candidate.entryId) || typeof state.eligible !== "boolean" || state.eligible !== (state.candidate.rank <= settings.topLevels && (!settings.minimumNotionalEnabled || compareDecimalToNumber(state.candidate.notional, settings.minimumNotionalUsd) >= 0)) || !finiteNonNegative(state.lastAt) || !finiteNonNegative(state.usdMs) || !finiteNonNegative(state.peakUsd) || typeof state.qualifyingStartKnown !== "boolean" || state.qualifyingAt !== void 0 && !finiteNonNegative(state.qualifyingAt) || state.qualifyingCursor !== void 0 && !validInt(state.qualifyingCursor) || state.qualifyingCandidate !== void 0 && (!validCandidate(state.qualifyingCandidate) || state.qualifyingCandidate.entryId !== state.candidate.entryId) || state.valueSignature !== void 0 && typeof state.valueSignature !== "string") fail();
    if (state.segmentId !== void 0) {
      const segment = ids.get(state.segmentId);
      if (typeof state.segmentId !== "string" || activeIds.has(state.segmentId) || !segment || segment.end !== null || !state.eligible || segment.archiveEntryId !== state.candidate.entryId) fail();
      activeIds.add(state.segmentId);
    }
    candidateIds.add(state.candidate.entryId);
  }
  for (const segment of ids.values()) if (segment.end === null && !activeIds.has(segment.id)) fail();
}

// src/shared/order-walls-projection-version.ts
var WALL_PROJECTION_CORE_SHA256 = "c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c";

// src/feed/history-scheduler.ts
var HistoryScheduler = class {
  constructor(concurrency = 2, clock = () => performance.now()) {
    this.concurrency = concurrency;
    this.clock = clock;
    if (concurrency < 1 || concurrency > 4) throw Error("History concurrency must be bounded");
  }
  work = /* @__PURE__ */ new Map();
  active = 0;
  last;
  metrics = { submitted: 0, coalesced: 0, cancelled: 0, completed: 0, failed: 0, peakActive: 0, queueMs: 0, runMs: 0 };
  read(key, layer, signal, run, priority = 0) {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    let w = this.work.get(key);
    if (!w) {
      w = { key, layer, priority, queued: this.clock(), abort: new AbortController(), run, consumers: /* @__PURE__ */ new Set() };
      this.work.set(key, w);
      this.metrics.submitted++;
    } else {
      w.priority = Math.min(w.priority, priority);
      this.metrics.coalesced++;
    }
    const work = w;
    const promise = new Promise((resolve, reject) => {
      const consumer = { resolve, reject, signal, cancel: () => {
        work.consumers.delete(consumer);
        signal.removeEventListener("abort", consumer.cancel);
        this.metrics.cancelled++;
        reject(new DOMException("Aborted", "AbortError"));
        if (!work.consumers.size) {
          work.abort.abort();
          if (this.work.get(key) === work) this.work.delete(key);
        }
        this.pump();
      } };
      work.consumers.add(consumer);
      signal.addEventListener("abort", consumer.cancel, { once: true });
    });
    this.pump();
    return promise;
  }
  pump() {
    while (this.active < this.concurrency) {
      const candidates = [...this.work.values()].filter((w2) => w2.started === void 0 && w2.consumers.size).sort((a, b) => a.priority - b.priority || Number(a.layer === this.last) - Number(b.layer === this.last) || a.queued - b.queued);
      const w = candidates[0];
      if (!w) return;
      w.started = this.clock();
      this.last = w.layer;
      this.active++;
      this.metrics.peakActive = Math.max(this.metrics.peakActive, this.active);
      this.metrics.queueMs += w.started - w.queued;
      void Promise.resolve().then(() => w.run(w.abort.signal)).then((value) => {
        this.metrics.completed++;
        if (this.work.get(w.key) === w) this.work.delete(w.key);
        for (const c of w.consumers) c.resolve(value);
      }, (error) => {
        this.metrics.failed++;
        if (this.work.get(w.key) === w) this.work.delete(w.key);
        for (const c of w.consumers) c.reject(error);
      }).finally(() => {
        for (const c of w.consumers) c.signal.removeEventListener("abort", c.cancel);
        this.metrics.runMs += this.clock() - w.started;
        if (this.work.get(w.key) === w) this.work.delete(w.key);
        this.active--;
        this.pump();
      });
    }
  }
  diagnostics() {
    return { ...this.metrics, active: this.active, queued: [...this.work.values()].filter((w) => w.started === void 0).length };
  }
};
var historyScheduler = new HistoryScheduler();

// src/feed/prepared-wall-batch.ts
var groups = /* @__PURE__ */ new Map();
var aborted = () => new DOMException("Aborted", "AbortError");
var digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  void promise.catch(() => {
  });
  return { promise, resolve, reject };
}
function acquireWallBatch(options) {
  const { url, parts, signal } = options;
  if (signal.aborted) throw aborted();
  const identity = JSON.stringify([options.key, options.revision, parts]);
  let group = groups.get(url);
  if (group && group.identity !== identity) throw Error("Prepared wall shared batch identity mismatch");
  if (!group) {
    group = { identity, abort: new AbortController(), slots: new Map(parts.map((p) => [p.index, deferred()])), refs: 0 };
    groups.set(url, group);
    const work = group;
    void historyScheduler.read(url, "order-walls", work.abort.signal, async (upstream) => {
      const started = performance.now(), response = await options.fetcher(url, { signal: upstream }), responseHeadersMs = performance.now() - started;
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("Prepared wall batch HTTP " + response.status);
      }
      const first = parts[0].index, next = parts.at(-1).index + 1, expectedBytes = parts.reduce((n, p) => n + p.bytes + 1, 0);
      if (response.headers.get("x-iq-wall-start") !== String(first) || response.headers.get("x-iq-wall-next") !== String(next) || response.headers.get("x-iq-wall-parts") !== String(parts.length) || response.headers.get("x-iq-chunk-key") !== options.key || response.headers.get("x-iq-source-revision") !== options.revision) {
        await response.body?.cancel();
        throw Error("Prepared wall batch identity mismatch");
      }
      if (expectedBytes > 8 * 1024 * 1024 || parts.length > (options.maxParts ?? 8) || !response.body) {
        await response.body?.cancel();
        throw Error("Prepared wall batch byte capacity");
      }
      const reader = response.body.getReader();
      let chunk = new Uint8Array(0), offset = 0, received = 0, complete = false;
      const cancelReader = () => {
        void reader.cancel(aborted()).catch(() => {
        });
      };
      upstream.addEventListener("abort", cancelReader, { once: true });
      if (upstream.aborted) cancelReader();
      async function pull() {
        upstream.throwIfAborted();
        const item = await reader.read();
        if (item.done) return false;
        received += item.value.byteLength;
        if (received > expectedBytes) throw Error("Prepared wall batch byte identity mismatch");
        chunk = item.value;
        offset = 0;
        return true;
      }
      async function exact(length) {
        const result = new Uint8Array(length);
        let written = 0;
        while (written < length) {
          if (offset === chunk.byteLength && !await pull()) throw Error("Prepared wall batch byte identity mismatch");
          const n = Math.min(length - written, chunk.byteLength - offset);
          result.set(chunk.subarray(offset, offset + n), written);
          written += n;
          offset += n;
        }
        return result;
      }
      try {
        for (const [i, part] of parts.entries()) {
          const bodyStarted = performance.now(), framed = await exact(part.bytes + 1), raw = framed.subarray(0, part.bytes);
          if (framed[part.bytes] !== 10 || await digest(raw) !== part.hash) throw Error("Prepared wall batch part content hash mismatch");
          upstream.throwIfAborted();
          const bodyReadMs = performance.now() - bodyStarted, parse = performance.now(), body = JSON.parse(new TextDecoder().decode(raw)), jsonParseMs = performance.now() - parse;
          if (i === parts.length - 1) {
            if (offset !== chunk.byteLength || await pull() || received !== expectedBytes) throw Error("Prepared wall batch byte identity mismatch");
            complete = true;
          }
          const headers = new Headers(response.headers);
          if (i > 0) headers.set("content-length", "0");
          if (i === parts.length - 1) work.finished = true;
          work.slots.get(part.index).resolve({ response: i === 0 ? response : new Response(null, { headers }), body, bytes: part.bytes, responseHeadersMs: i === 0 ? responseHeadersMs : 0, bodyReadMs, jsonParseMs, attempts: 1 });
        }
      } finally {
        upstream.removeEventListener("abort", cancelReader);
        if (!complete) await reader.cancel().catch(() => {
        });
        reader.releaseLock();
      }
    }).catch((error) => {
      for (const slot of work.slots.values()) slot.reject(error);
    });
  }
  const selected = group;
  selected.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", release);
    if (--selected.refs === 0) {
      if (!selected.finished) selected.abort.abort();
      if (groups.get(url) === selected) groups.delete(url);
    }
  };
  signal.addEventListener("abort", release, { once: true });
  return { release, read: async (index) => {
    if (released || signal.aborted) throw aborted();
    const slot = selected.slots.get(index);
    if (!slot) throw Error("Prepared wall batch index mismatch");
    return new Promise((resolve, reject) => {
      const cancel = () => {
        signal.removeEventListener("abort", cancel);
        reject(aborted());
      };
      signal.addEventListener("abort", cancel, { once: true });
      void slot.promise.then((value) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      }, (error) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      });
    });
  } };
}

// src/feed/prepared-wall-projection.ts
var integer = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var digest2 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
var normalized = (s) => ({ topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs });
var yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
async function readPreparedWallProjection(advertised, context, onProgress) {
  if (!advertised) return null;
  const { manifest: m, delivery } = advertised;
  if (m?.core !== WALL_PROJECTION_CORE_SHA256 || JSON.stringify(m.settings) !== JSON.stringify(normalized(context.settings))) return null;
  if (delivery?.version !== 1 || delivery.maxParts !== 32 || delivery.maxDecodedBytes !== 8 * 1024 * 1024) return null;
  if (m.version !== 2 || !hex(m.key) || !m.complete || m.sourceKey !== context.sourceKey || m.sourceToken !== context.sourceToken || m.profile?.id !== context.profile || m.profile.market !== context.market || m.active?.from !== context.from || m.active.to !== context.to || m.active.cursor !== context.watermark || m.active.epoch !== context.epoch || !Array.isArray(m.parts) || m.parts.length > 512 || !Array.isArray(m.closed) || m.closed.length > 1e5 || !Array.isArray(m.activeOrder) || m.activeOrder.length !== m.active.segments?.length || m.closed.length + m.activeOrder.length > 1e5 || await digest2(new TextEncoder().encode(JSON.stringify({ version: 2, sourceKey: context.sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalized(context.settings) }))) !== m.key) throw Error("Invalid prepared wall projection identity");
  const manifest = m, hashes = /* @__PURE__ */ new Set();
  let decodedBytes = 0;
  context.validateProfile?.(manifest.profile);
  for (const p of manifest.parts) {
    if (!hex(p.hash) || hashes.has(p.hash) || !integer(p.bytes) || p.bytes < 1 || p.bytes > 4 * 1024 * 1024 || !integer(p.records) || p.records < 1) throw Error("Invalid prepared wall projection part");
    hashes.add(p.hash);
    decodedBytes += p.bytes;
  }
  if (decodedBytes > 64 * 1024 * 1024) throw Error("Prepared wall projection byte capacity");
  const coordinates = /* @__PURE__ */ new Map(), fragments = [];
  for (const [group, pairs] of manifest.closed.entries()) {
    if (!Array.isArray(pairs) || !pairs.length) throw Error("Invalid prepared wall projection coordinates");
    fragments.push(new Array(pairs.length).fill(void 0));
    for (const [fragment, pair] of pairs.entries()) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(integer) || pair[0] >= manifest.parts.length || pair[1] >= manifest.parts[pair[0]].records || coordinates.has(pair.join(":"))) throw Error("Invalid prepared wall projection coordinates");
      coordinates.set(pair.join(":"), { group, fragment });
    }
  }
  OrderWallsArchiveProjector.restoreCheckpoint(manifest.active, context.settings, context.from, context.to);
  const presentation = /* @__PURE__ */ new Map(), retained = [];
  for (const [i, segment] of manifest.active.segments.entries()) {
    if (segment.end !== null || !integer(manifest.activeOrder[i])) throw Error("Invalid prepared wall projection active order");
    presentation.set(segment.id, segment);
    retained.push({ order: manifest.activeOrder[i], segment, valueRunOrder: manifest.active.valueRunOrder[i] });
  }
  let bytes = 0, parts = 0, decodeMs = 0, mergeMs = 0, runs = manifest.active.segments.reduce((n, segment) => n + segment.valueRuns.length, 0);
  context.signal.throwIfAborted();
  onProgress({ segments: manifest.active.segments, presentation, parts, bytes, decodeMs, mergeMs });
  for (let start = 0; start < manifest.parts.length; ) {
    context.signal.throwIfAborted();
    const selected = [];
    let size = 0;
    for (let i = start; i < Math.min(start + 32, manifest.parts.length); i++) {
      const part = manifest.parts[i];
      if (size + part.bytes + 1 > 8 * 1024 * 1024) break;
      selected.push({ ...part, index: i });
      size += part.bytes + 1;
    }
    if (!selected.length) throw Error("Prepared wall projection batch capacity");
    const url = "/market-data/v2/history/walls/projection-batch?" + new URLSearchParams({ market: context.market, key: manifest.key, start: String(start), version: "1" });
    const batch = acquireWallBatch({ url, key: manifest.key, revision: manifest.sourceToken, parts: selected, fetcher: context.fetcher, signal: context.signal, maxParts: 32 });
    try {
      for (const part of selected) {
        const fetched = await batch.read(part.index), rows = fetched.body;
        decodeMs += fetched.jsonParseMs;
        bytes += fetched.bytes;
        parts++;
        if (!Array.isArray(rows) || rows.length !== part.records) throw Error("Prepared wall projection record count mismatch");
        const began = performance.now(), ready = [];
        let yielded = performance.now(), yieldMs = 0;
        for (const [row, value] of rows.entries()) {
          const coordinate = coordinates.get(part.index + ":" + row);
          if (!coordinate) continue;
          const group = fragments[coordinate.group];
          group[coordinate.fragment] = value;
          if (group.some((fragment) => fragment === void 0)) continue;
          const first = group[0], { valueRuns: _values, ...header } = first.segment;
          let count = 0;
          for (const record of group) {
            const { valueRuns, ...nextHeader } = record.segment;
            if (record.offset !== count || record.totalRuns !== first.totalRuns || record.order !== first.order || !integer(record.order) || record.segment.end === null || JSON.stringify(header) !== JSON.stringify(nextHeader) || !Array.isArray(valueRuns) || record.valueRunOrder?.length !== valueRuns.length) throw Error("Prepared wall projection fragment identity mismatch");
            count += valueRuns.length;
          }
          if (count !== first.totalRuns) throw Error("Prepared wall projection fragment coverage mismatch");
          const completed = { order: first.order, segment: { ...first.segment, valueRuns: group.flatMap((record) => record.segment.valueRuns) }, valueRunOrder: group.flatMap((record) => record.valueRunOrder) };
          ready.push(completed);
          retained.push(completed);
          fragments[coordinate.group] = [];
          if (performance.now() - yielded >= 8) {
            const before = performance.now();
            await yieldTask();
            yieldMs += performance.now() - before;
            context.signal.throwIfAborted();
            yielded = performance.now();
          }
        }
        if (ready.length) {
          runs += ready.reduce((n, record) => n + record.segment.valueRuns.length, 0);
          if (runs > 1e6) throw Error("Prepared wall projection retained capacity");
          OrderWallsArchiveProjector.restoreCheckpoint({ ...manifest.active, candidates: [], seenGaps: [], segments: ready.map((row) => row.segment), valueRunOrder: ready.map((row) => row.valueRunOrder) }, context.settings, context.from, context.to);
          for (const record of ready) {
            if (presentation.has(record.segment.id)) throw Error("Prepared wall projection duplicate identity");
            presentation.set(record.segment.id, record.segment);
          }
        }
        const partMergeMs = performance.now() - began - yieldMs;
        mergeMs += partMergeMs;
        context.signal.throwIfAborted();
        onProgress({ segments: ready.map((row) => row.segment), presentation, parts, bytes, decodeMs, mergeMs, metrics: { responseHeadersMs: fetched.responseHeadersMs, bodyReadMs: fetched.bodyReadMs, jsonParseMs: fetched.jsonParseMs, mergeMs: partMergeMs, yieldMs, encodedBytes: Number(fetched.response.headers.get("content-length") ?? 0), requestId: fetched.response.headers.get("x-iq-request-id") ?? void 0 } });
        await yieldTask();
      }
    } finally {
      batch.release();
    }
    start += selected.length;
  }
  if (retained.length !== manifest.closed.length + manifest.active.segments.length || new Set(retained.map((record) => record.order)).size !== retained.length) throw Error("Prepared wall projection incomplete identities");
  retained.sort((a, b) => a.order - b.order);
  context.signal.throwIfAborted();
  const projector = OrderWallsArchiveProjector.restoreCheckpoint({ ...manifest.active, segments: retained.map((row) => row.segment), valueRunOrder: retained.map((row) => row.valueRunOrder) }, context.settings, context.from, context.to);
  return { projector, coverage: manifest.coverage, profile: manifest.profile, presentation, parts, bytes, decodeMs, mergeMs };
}
export {
  readPreparedWallProjection
};

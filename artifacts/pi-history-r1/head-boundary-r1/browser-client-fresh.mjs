// <define:import.meta.env>
var define_import_meta_env_default = { VITE_HISTORY_TILES: "1", VITE_DATA_MODE: "staging", DEV: false, PROD: true };

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
  read(key, layer, signal, run2, priority = 0) {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    let w = this.work.get(key);
    if (!w) {
      w = { key, layer, priority, queued: this.clock(), abort: new AbortController(), run: run2, consumers: /* @__PURE__ */ new Set() };
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

// src/feed/prepared-wall-read-lease.ts
var wallReadControlScheduler = new HistoryScheduler(1);
var endpoint = "/market-data/v2/history/walls/reader";
async function acquirePreparedWallReadLease(identity, fetcher, signal) {
  if (!/^[a-f0-9]{64}$/.test(identity.canonicalKey) || identity.projectionKey !== void 0 && !/^[a-f0-9]{64}$/.test(identity.projectionKey)) throw Error("Invalid wall reader lease identity");
  const consumer = crypto.randomUUID(), abort = new AbortController();
  let timer, expires = 0, closed = false, failure;
  const combined = AbortSignal.any([signal, abort.signal]);
  const release = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", release);
    abort.abort();
    const url = "/market-data/v2/history/walls/preparation?" + new URLSearchParams({ consumer });
    void wallReadControlScheduler.read(url, "order-walls", AbortSignal.timeout(2e3), async (upstream) => {
      const response = await fetcher(url, { method: "DELETE", signal: upstream });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw Error("Wall reader release HTTP " + response.status);
    }).catch(() => {
    });
  };
  const assertActive = () => {
    if (failure) throw failure;
    combined.throwIfAborted();
    if (closed || performance.now() >= expires) {
      failure = Error("Wall history reader lease expired; Retry available with good bars retained");
      release();
      throw failure;
    }
  };
  async function renew() {
    const sent = performance.now();
    const response = await wallReadControlScheduler.read(endpoint + "#" + consumer, "order-walls", AbortSignal.any([combined, AbortSignal.timeout(3e3)]), async (upstream) => {
      const r = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consumer, ...identity }), signal: upstream });
      if (!r.ok) {
        await r.body?.cancel();
        throw Error("Wall reader lease HTTP " + r.status);
      }
      const reader = r.body?.getReader();
      let text = "", bytes = 0;
      const decoder = new TextDecoder();
      if (!reader) throw Error("Invalid wall reader lease response body");
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4096) {
            await reader.cancel();
            throw Error("Invalid wall reader lease response size");
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(text);
    });
    if (response.version !== 1 || response.leaseMs !== 15e3 || response.canonicalKey !== identity.canonicalKey || response.projectionKey !== identity.projectionKey) throw Error("Invalid wall reader lease identity");
    expires = sent + response.leaseMs;
    assertActive();
    timer = setTimeout(() => {
      void renew().catch((error) => {
        failure = Error("Wall history reader lease lost; Retry available: " + String(error?.message ?? error).slice(0, 200));
        release();
      });
    }, 5e3);
  }
  signal.throwIfAborted();
  signal.addEventListener("abort", release, { once: true });
  try {
    await renew();
    return { consumer, signal: combined, assertActive, release };
  } catch (error) {
    release();
    throw error;
  }
}

// src/feed/history-http-error.ts
async function historyHttpError(response, signal, label) {
  signal.throwIfAborted();
  const fallback = label + " HTTP " + response.status, reader = response.body?.getReader();
  if (!reader) return Error(fallback);
  let timer, stop = () => {
  };
  const interrupted = new Promise((resolve) => {
    stop = () => resolve(void 0);
    signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, 1e3);
  });
  const detail = (async () => {
    try {
      const chunks = [];
      let bytes = 0;
      for (; ; ) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 4096) return;
        chunks.push(item.value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value = JSON.parse(new TextDecoder().decode(body));
      if (!value || typeof value !== "object" || !("error" in value) || typeof value.error !== "string") return;
      return value.error.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || void 0;
    } catch {
      return;
    }
  })();
  let reason;
  try {
    reason = await Promise.race([detail, interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  signal.throwIfAborted();
  return Error(reason ? fallback + ": " + reason : fallback);
}

// src/shared/order-walls-projection-version.ts
var WALL_PROJECTION_CORE_SHA256 = "c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c";

// src/feed/prepared-wall-admission.ts
function wallPreparationReason(value) {
  const parts = `${value.phase}; ${value.pages} canonical / ${value.projectionPages} selected parts.`;
  return value.state === "paused" ? `Wall history preparation paused: ${value.error ?? "waiting for processing capacity; resumes automatically."} (${parts})` : `Preparing wall history: ${parts}`;
}
var PreparedWallPreparationError = class extends Error {
  constructor(message, category, retryable) {
    super(message);
    this.category = category;
    this.retryable = retryable;
    this.name = "PreparedWallPreparationError";
  }
};
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function progress(raw, request) {
  const r = raw?.request;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw.id ?? "") || !r || r.market !== request.market || r.profile !== request.profile || r.from !== request.from || r.to !== request.to || !["source", "canonical", "projection", "ready"].includes(raw.phase) || !["building", "paused", "failed", "ready"].includes(raw.state) || !integer(raw.pages) || raw.pages > 128 || !integer(raw.projectionPages) || raw.projectionPages > 128 || raw.state === "ready" && raw.phase !== "ready" || raw.retryable !== void 0 && typeof raw.retryable !== "boolean" || raw.category !== void 0 && !["source-changed", "source-unavailable", "capacity", "invalid-content", "query"].includes(raw.category)) throw Error("Invalid wall preparation progress identity");
  let sourceCoverage;
  if (raw.coverage) {
    const c = raw.coverage;
    if (![c.availableFrom, c.confirmedTo].every((v) => v === null || integer(v)) || !integer(c.gapCount) || typeof c.gapsTruncated !== "boolean") throw Error("Invalid wall preparation source coverage");
    sourceCoverage = { availableFrom: c.availableFrom, confirmedTo: c.confirmedTo, gapCount: c.gapCount, gapsTruncated: c.gapsTruncated };
  }
  return {
    id: raw.id,
    phase: raw.phase,
    state: raw.state,
    pages: raw.pages,
    projectionPages: raw.projectionPages,
    ...raw.category ? { category: raw.category } : {},
    ...raw.error ? { error: String(raw.error).slice(0, 500) } : {},
    ...raw.retryable !== void 0 ? { retryable: raw.retryable } : {},
    ...sourceCoverage ? { sourceCoverage } : {}
  };
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const done = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
async function discoverPreparedWallAdmission(options) {
  const { request, url, projection, fetcher, signal } = options, consumer = crypto.randomUUID();
  let job, leased = false;
  const release = () => {
    const cancel = "/market-data/v2/history/walls/preparation?" + new URLSearchParams({ consumer });
    void wallReadControlScheduler.read(cancel, "order-walls", AbortSignal.timeout(2e3), async (upstream) => {
      const response = await fetcher(cancel, { method: "DELETE", signal: upstream });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw Error("Wall preparation release HTTP " + response.status);
    }, -1).catch(() => {
    });
  };
  try {
    for (; ; ) {
      const found = await historyScheduler.read(url + "#consumer=" + consumer + (projection ? "&projection=" + WALL_PROJECTION_CORE_SHA256 : ""), "order-walls", signal, async (upstream) => {
        const headers = {
          "X-IQ-Wall-Consumer": consumer,
          ...projection ? { "X-IQ-Wall-Projection": WALL_PROJECTION_CORE_SHA256 } : {},
          ...job ? { "X-IQ-Wall-Job": job } : {},
          ...options.retry ? { "X-IQ-Wall-Retry": options.retry.token, ...options.retry.newRevision ? { "X-IQ-Wall-New-Revision": "1" } : {} } : {}
        };
        const response = await fetcher(url, { signal: upstream, headers });
        if (!response.ok) {
          if (response.status === 404) {
            await response.body?.cancel();
            return null;
          }
          throw await historyHttpError(response, upstream, "Prepared wall discovery");
        }
        return options.decode(response, projection ? 8 * 1024 * 1024 : 128 * 1024);
      });
      signal.throwIfAborted();
      if (!found?.preparation) return found;
      leased = true;
      const p = found.preparation;
      if (p.version !== 1 || !integer(p.leaseMs) || p.leaseMs < 1e3 || p.leaseMs > 6e4 || !integer(p.pollMs) || p.pollMs < 250 || p.pollMs > 2e3 || p.pollMs * 2 > p.leaseMs) throw Error("Invalid wall preparation polling bounds");
      const value = progress(p.job, request);
      job = value.id;
      if (value.state === "failed") throw new PreparedWallPreparationError(value.error ?? "Wall history preparation failed", value.category ?? "query", value.retryable !== false);
      if (value.state === "ready") {
        if (found.state !== "ready") throw new PreparedWallPreparationError("Prepared wall source changed; retry the view as a new revision", "source-changed", true);
        return found;
      }
      options.onPreparation?.(value);
      await delay(p.pollMs, signal);
    }
  } finally {
    if (leased) release();
  }
}

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
        const sequence2 = this.valueRunSequences.get(point);
        if (sequence2 === void 0) throw Error("Closed wall value has no sequence");
        return sequence2;
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
        const sequence2 = this.valueRunSequences.get(point);
        if (sequence2 === void 0) throw Error("Wall projection retained value has no sequence");
        return sequence2;
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
        const sequence2 = state.valueRunOrder[i][j];
        projector.valueRunSequences.set(point, sequence2);
        projector.valueRunQueue.push({ id: segment.id, sequence: sequence2 });
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
  /** The same financial validation, with bounded checkpoints during import.
   * The caller supplies its worker task scheduler; no DOM/timer is owned here.
   * Nothing is returned until validation, cloning and queue ordering finish. */
  static async restoreCheckpointCooperatively(value, settings, from, to, work, namespace = "") {
    if (!Number.isFinite(work.budgetMs) || work.budgetMs <= 0 || work.budgetMs > 16) throw Error("Invalid wall import work budget");
    const steps = this.restoreCheckpointSteps(value, settings, from, to, namespace);
    let since = work.now();
    work.check();
    for (; ; ) {
      const next = steps.next();
      work.check();
      if (next.done) return next.value;
      if (work.now() - since >= work.budgetMs) {
        await work.yield();
        work.check();
        since = work.now();
      }
    }
  }
  static *restoreCheckpointSteps(value, settings, from, to, namespace) {
    yield* validateCheckpointSteps(value, settings, from, to, namespace);
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
    let work = 0;
    for (const [i, source] of state.segments.entries()) {
      const segment = { ...source, valueRuns: [] };
      projector.segments.set(segment.id, segment);
      for (const [j, point] of source.valueRuns.entries()) {
        const copied = { ...point }, sequence2 = state.valueRunOrder[i][j];
        segment.valueRuns.push(copied);
        projector.valueRunSequences.set(copied, sequence2);
        projector.valueRunQueue.push({ id: segment.id, sequence: sequence2 });
        projector.totalValueRuns++;
        if (++work % 256 === 0) yield;
      }
      projector.emittedValues.set(segment.id, { first: segment.valueRuns[0], last: segment.valueRuns.at(-1), length: segment.valueRuns.length });
      if (++work % 256 === 0) yield;
    }
    yield* sortValueQueueSteps(projector.valueRunQueue);
    for (const source of state.candidates) {
      const { segmentId: segmentId2, ...candidate } = source;
      projector.candidates.set(candidate.candidate.entryId, {
        ...candidate,
        candidate: { ...candidate.candidate },
        ...candidate.qualifyingCandidate ? { qualifyingCandidate: { ...candidate.qualifyingCandidate } } : {},
        ...segmentId2 ? { segment: projector.segments.get(segmentId2) } : {}
      });
    }
    for (const gap of state.seenGaps) {
      projector.seenGaps.add(gap);
      if (++work % 256 === 0) yield;
    }
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
    const head2 = page.head;
    if (!head2) throw new Error("Order Walls archive page is missing its fixed-watermark head");
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
    this.epoch = head2.epoch;
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
    const head2 = page.head;
    if (!head2) throw new Error("Order Walls current page is missing its fixed-watermark head");
    const seedFrom = from ?? head2.at;
    const confirmedTo = Math.min(page.coverage?.confirmedTo ?? head2.at, head2.at);
    const gaps = (page.coverage?.gaps ?? []).filter((gap) => (gap.from ?? gap.at ?? 0) <= head2.at);
    const converted = {
      version: 1,
      profile: page.profile,
      market: page.market,
      instrument: page.instrument,
      feed: page.feed,
      from: seedFrom,
      to: Number.MAX_SAFE_INTEGER,
      watermark: page.watermark,
      head: { cursor: head2.cursor, at: head2.at, epoch: head2.epoch },
      page: { ...page.page, lastAt: page.page.lastAt ?? head2.at },
      ...page.state ? { seed: {
        at: head2.at,
        cursor: head2.cursor,
        epoch: head2.epoch,
        midpoint: head2.midpoint,
        bookScope: head2.bookScope,
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
        bookScope: head2.bookScope
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
        const sequence2 = this.valueRunSequences.get(point);
        if (sequence2 !== void 0) retained.push({ id: segment.id, sequence: sequence2 });
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
    const sequence2 = ++this.nextValueRunSequence;
    this.valueRunSequences.set(point, sequence2);
    this.valueRunQueue.push({ id, sequence: sequence2 });
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
function compareDecimalToNumber(decimal2, value) {
  const threshold = expandExponent(value.toString());
  const [leftWhole, leftFraction = ""] = decimal2.split(".");
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
  for (const _ of validateCheckpointSteps(value, settings, from, to, namespace)) {
  }
}
function* validateCheckpointSteps(value, settings, from, to, namespace) {
  const fail = () => {
    throw Error("Invalid wall projection checkpoint");
  };
  if (!isRecord(value) || value.version !== 1 || value.from !== from || value.to !== to || value.namespace !== namespace || !finiteNonNegative(from) || !finiteNonNegative(to) || from >= to) fail();
  const v = value, filter = v.settings;
  if (!isRecord(filter) || filter.topLevels !== settings.topLevels || filter.minimumNotionalEnabled !== settings.minimumNotionalEnabled || filter.minDurationMs !== settings.minDurationMs || settings.minimumNotionalEnabled && filter.minimumNotionalUsd !== settings.minimumNotionalUsd || !validInt(filter.topLevels) || filter.topLevels < 1 || filter.topLevels > 10 || !finiteNonNegative(filter.minimumNotionalUsd) || !finiteNonNegative(filter.minDurationMs) || filter.minDurationMs > 6e4 || typeof filter.minimumNotionalEnabled !== "boolean") fail();
  if (!finiteNonNegative(v.confirmedTo) || v.confirmedTo < from || !validInt(v.cursor) || !validInt(v.epoch) || v.midpoint !== null && !validDecimal(v.midpoint) || v.bookScope !== void 0 && !isRecord(v.bookScope) || typeof v.valueHistoryLimited !== "boolean" || typeof v.episodeHistoryLimited !== "boolean" || !validInt(v.nextValueRunSequence) || !validInt(v.emittedRevision) || !Array.isArray(v.seenGaps) || !Array.isArray(v.segments) || v.segments.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || !Array.isArray(v.valueRunOrder) || v.valueRunOrder.length !== v.segments.length || !Array.isArray(v.candidates) || v.candidates.length > 20) fail();
  const ids = /* @__PURE__ */ new Map(), sequences = /* @__PURE__ */ new Set();
  let runs = 0, work = 0;
  for (const gap of v.seenGaps) {
    if (typeof gap !== "string") fail();
    if (++work % 256 === 0) yield;
  }
  for (const [i, segment] of v.segments.entries()) {
    if (!isRecord(segment) || typeof segment.id !== "string" || !segment.id || ids.has(segment.id) || typeof segment.archiveEntryId !== "string" || !segment.archiveEntryId || !validInt(segment.epoch) || !["bid", "ask"].includes(segment.side) || !validDecimal(segment.priceExact) || segment.price !== Number(segment.priceExact) || !finiteNonNegative(segment.price) || segment.price <= 0 || !finiteNonNegative(segment.start) || segment.end !== null && (!finiteNonNegative(segment.end) || segment.end < segment.start) || !finiteNonNegative(segment.peakUsd) || !finiteNonNegative(segment.meanUsd) || !finiteNonNegative(segment.durationMs) || segment.percentile !== null || typeof segment.scopePartial !== "boolean" || typeof segment.startKnown !== "boolean" || typeof segment.endKnown !== "boolean" || segment.detectionMode !== "top-levels" || !validInt(segment.rank) || segment.rank < 1 || segment.rank > 10 || typeof segment.valueRunsTruncated !== "boolean" || segment.valueRunsTruncated && !v.valueHistoryLimited || !["below-threshold", "removed", "censored", "rank-exit", "out-of-range", "below-minimum", null].includes(segment.endReason) || segment.censoredReason !== void 0 && typeof segment.censoredReason !== "string" || !Array.isArray(segment.valueRuns) || segment.valueRuns.length > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT || !Array.isArray(v.valueRunOrder[i]) || v.valueRunOrder[i].length !== segment.valueRuns.length) fail();
    for (const [j, point] of segment.valueRuns.entries()) {
      const sequence2 = v.valueRunOrder[i][j];
      if (!isRecord(point) || !finiteNonNegative(point.at) || point.percentile !== null || !validInt(point.rank) || point.rank < 1 || point.rank > 10 || !validDecimal(point.quantityExact) || !validDecimal(point.notionalExact) || point.quantity !== Number(point.quantityExact) || point.usd !== Number(point.notionalExact) || !finiteNonNegative(point.quantity) || !finiteNonNegative(point.usd) || !validInt(sequence2) || sequence2 < 1 || sequence2 > v.nextValueRunSequence || sequences.has(sequence2)) fail();
      sequences.add(sequence2);
      runs++;
      if (++work % 256 === 0) yield;
    }
    ids.set(segment.id, segment);
    if (++work % 256 === 0) yield;
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
  for (const segment of ids.values()) {
    if (segment.end === null && !activeIds.has(segment.id)) fail();
    if (++work % 256 === 0) yield;
  }
}
function* sortValueQueueSteps(values) {
  const length = values.length;
  if (length < 2) return;
  let source = values, target = new Array(length), work = 0;
  const run2 = 1024;
  for (let start = 0; start < length; start += run2) {
    const chunk = values.slice(start, Math.min(start + run2, length)).sort((a, b) => a.sequence - b.sequence);
    for (let i = 0; i < chunk.length; i++) values[start + i] = chunk[i];
    yield;
  }
  for (let width = run2; width < length; width *= 2) {
    for (let start = 0; start < length; start += width * 2) {
      const mid = Math.min(start + width, length), end = Math.min(start + width * 2, length);
      let left = start, right = mid;
      for (let at = start; at < end; at++) {
        target[at] = right >= end || left < mid && source[left].sequence <= source[right].sequence ? source[left++] : source[right++];
        if (++work % 1024 === 0) yield;
      }
    }
    [source, target] = [target, source];
  }
  if (source !== values) for (let i = 0; i < length; i++) {
    values[i] = source[i];
    if (++work % 1024 === 0) yield;
  }
}

// src/feed/prepared-wall-batch-reader.ts
function receiveWallBatch(body, bytes, signal) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 8 * 1024 * 1024) throw Error("Prepared wall batch byte capacity");
  const buffer = new Uint8Array(bytes), reader = body.getReader();
  let received = 0, offset = 0, ended = false, failure, wake;
  const notify = () => {
    wake?.();
    wake = void 0;
  };
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const pump = (async () => {
    try {
      while (true) {
        signal.throwIfAborted();
        const item = await reader.read();
        if (item.done) break;
        if (received + item.value.byteLength > bytes) throw Error("Prepared wall batch byte identity mismatch");
        buffer.set(item.value, received);
        received += item.value.byteLength;
        notify();
      }
      if (received !== bytes) throw Error("Prepared wall batch byte identity mismatch");
    } catch (error) {
      failure = error;
      await reader.cancel(error).catch(() => {
      });
    } finally {
      ended = true;
      reader.releaseLock();
      notify();
    }
  })();
  return {
    async exact(length) {
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes) throw Error("Prepared wall batch byte identity mismatch");
      const end = offset + length;
      while (received < end && !ended) {
        signal.throwIfAborted();
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
      signal.throwIfAborted();
      if (received < end) throw failure ?? Error("Prepared wall batch byte identity mismatch");
      const result = buffer.subarray(offset, end);
      offset = end;
      return result;
    },
    async finish() {
      await pump;
      signal.throwIfAborted();
      if (failure) throw failure;
      if (offset !== bytes) throw Error("Prepared wall batch byte identity mismatch");
    },
    async close() {
      signal.removeEventListener("abort", cancel);
      if (!ended) await reader.cancel().catch(() => {
      });
      await pump;
    }
  };
}

// src/feed/history-task-yield.ts
function yieldHistoryTask(signal, priority = "background", callback = () => {
}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const scheduler = globalThis.scheduler;
  if (typeof scheduler?.postTask === "function") return scheduler.postTask(callback, { priority, ...signal ? { signal } : {} });
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      try {
        resolve(callback());
      } catch (error) {
        reject(error);
      }
    }, 0);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

// src/shared/order-wall-point-transport.ts
var WALL_POINT_TRANSPORT = "exact-points-v1";
var WALL_PRODUCT_POINT_TRANSPORT = "exact-points-v2";
function exactProductFor(price) {
  if (!decimal(price) || price.length > 128) return;
  const priceScale = price.split(".")[1]?.length ?? 0, priceInteger = BigInt(price.replace(".", ""));
  let previousQuantity, previousProduct;
  return (quantity) => {
    if (quantity === previousQuantity) return previousProduct;
    if (!decimal(quantity) || quantity.length > 128) return;
    const scale = priceScale + (quantity.split(".")[1]?.length ?? 0);
    let value = String(priceInteger * BigInt(quantity.replace(".", ""))).padStart(scale + 1, "0");
    if (scale) value = (value.slice(0, -scale) + "." + value.slice(-scale)).replace(/0+$/, "").replace(/\.$/, "");
    previousQuantity = quantity;
    previousProduct = decimal(value) ? value : void 0;
    return previousProduct;
  };
}
var record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var decimal = (v) => typeof v === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
var validRank = (v) => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 10;
var pointOverhead = JSON.stringify({ at: 0, usd: 0, percentile: null, rank: 1, quantity: 0, quantityExact: "0", notionalExact: "0" }).length - JSON.stringify([0, "0", "0", 1]).length - 2;
async function decodeWallPointTransport(value, checkpoint, budget, version = 1) {
  if (!Array.isArray(value) || value.length > 1e5) throw Error("Invalid wall point transport records");
  let changed = false, work = 0;
  for (const row of value) {
    if (!record(row) || !record(row.segment) || !Array.isArray(row.segment.valueRuns)) throw Error("Invalid wall point transport segment");
    const base = row.segment.start, points = [], multiply = version === 2 ? exactProductFor(row.segment.priceExact) : void 0;
    if (row.segment.valueRuns.length > 1e5) throw Error("Wall point transport value capacity");
    for (const p of row.segment.valueRuns) {
      if (Array.isArray(p)) {
        const product = version === 2 && p.length === 3, notionalExact = product ? multiply?.(p[1]) : p[2], rank = product ? p[2] : p[3];
        if (p.length !== 4 && !product || !Number.isSafeInteger(base) || !Number.isSafeInteger(p[0]) || !Number.isSafeInteger(base + p[0]) || base + p[0] < 0 || !decimal(p[1]) || !decimal(notionalExact) || !validRank(rank)) throw Error("Invalid wall point transport tuple");
        const [delta, quantityExact] = p;
        const at = base + delta, usd = Number(notionalExact), quantity = Number(quantityExact);
        if (budget) {
          budget.bytes += pointOverhead + String(at).length + String(usd).length + String(quantity).length - String(delta).length + (product ? notionalExact.length + 3 : 0);
          if (budget.bytes > budget.max) throw Error("Wall point transport canonical byte capacity");
        }
        points.push({ at, usd, percentile: null, rank, quantity, quantityExact, notionalExact });
        changed = true;
      } else points.push(p);
      if (++work > 1e6) throw Error("Wall point transport value capacity");
      if (work % 256 === 0) await checkpoint?.();
    }
    row.segment.valueRuns = points;
  }
  return { value, changed };
}

// src/feed/prepared-wall-batch.ts
var groups = /* @__PURE__ */ new Map();
var aborted = () => new DOMException("Aborted", "AbortError");
var TemporaryBatchResponse = class extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
};
function retryDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
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
  const { url, parts, signal, fetcher } = options;
  if (signal.aborted) throw aborted();
  const identity = JSON.stringify([options.key, options.revision, parts, options.pointTransport ?? false]);
  let group = groups.get(url);
  if (group && group.identity !== identity) throw Error("Prepared wall shared batch identity mismatch");
  if (!group) {
    group = { identity, abort: new AbortController(), slots: new Map(parts.map((p) => [p.index, deferred()])), refs: 0 };
    groups.set(url, group);
    const work = group;
    const attemptRead = (attempt) => historyScheduler.read(url, "order-walls", work.abort.signal, async (upstream) => {
      const started = performance.now(), response = await fetcher(url, { signal: upstream }), responseHeadersMs = performance.now() - started;
      if (!response.ok) {
        await response.body?.cancel();
        const message = "Prepared wall batch HTTP " + response.status;
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) : Infinity;
        if ([408, 502, 503, 504].includes(response.status) && seconds <= 2) throw new TemporaryBatchResponse(message, seconds * 1e3);
        throw Error(message);
      }
      const first = parts[0].index, next = parts.at(-1).index + 1, expectedBytes = parts.reduce((n, p) => n + p.bytes + 1, 0);
      if (response.headers.get("x-iq-wall-start") !== String(first) || response.headers.get("x-iq-wall-next") !== String(next) || response.headers.get("x-iq-wall-parts") !== String(parts.length) || response.headers.get("x-iq-chunk-key") !== options.key || response.headers.get("x-iq-source-revision") !== options.revision) {
        await response.body?.cancel();
        throw Error("Prepared wall batch identity mismatch");
      }
      let wireParts = parts.map((p) => p.bytes), wireBytes = expectedBytes;
      if (options.pointTransport) {
        const sizes = response.headers.get("x-iq-wall-part-bytes");
        try {
          wireParts = sizes && sizes.length <= 512 ? JSON.parse(sizes) : [];
        } catch {
          wireParts = [];
        }
        if (response.headers.get("x-iq-wall-transport") !== (options.pointTransport === 2 ? WALL_PRODUCT_POINT_TRANSPORT : WALL_POINT_TRANSPORT) || response.headers.get("x-iq-canonical-bytes") !== String(expectedBytes) || !Array.isArray(wireParts) || wireParts.length !== parts.length || wireParts.some((size, i) => !Number.isSafeInteger(size) || size < 2 || size > parts[i].bytes)) {
          await response.body?.cancel();
          throw Error("Prepared wall point transport identity mismatch");
        }
        wireBytes = wireParts.reduce((n, size) => n + size + 1, 0);
        if (response.headers.get("x-iq-decoded-bytes") !== String(wireBytes)) {
          await response.body?.cancel();
          throw Error("Prepared wall point transport byte identity mismatch");
        }
      } else if (response.headers.has("x-iq-wall-transport")) {
        await response.body?.cancel();
        throw Error("Unexpected prepared wall point transport");
      }
      if (expectedBytes > 8 * 1024 * 1024 || parts.length > (options.maxParts ?? 8) || !response.body) {
        await response.body?.cancel();
        throw Error("Prepared wall batch byte capacity");
      }
      const receiver = receiveWallBatch(response.body, wireBytes, upstream);
      try {
        for (const [i, part] of parts.entries()) {
          const bodyStarted = performance.now(), wireSize = wireParts[i], framed = await receiver.exact(wireSize + 1), raw = framed.subarray(0, wireSize);
          if (framed[wireSize] !== 10) throw Error("Prepared wall batch part content hash mismatch");
          upstream.throwIfAborted();
          const bodyReadMs = performance.now() - bodyStarted, parse = performance.now();
          let body, canonical = raw, jsonParseMs = 0, validationMs = 0, validationYieldMs = 0;
          if (options.pointTransport) {
            body = JSON.parse(new TextDecoder().decode(raw));
            jsonParseMs = performance.now() - parse;
            const validationAt = performance.now();
            let yielded = performance.now();
            const decoded = await decodeWallPointTransport(body, async () => {
              upstream.throwIfAborted();
              if (performance.now() - yielded >= 8) {
                const at = performance.now();
                await yieldHistoryTask(upstream, "user-visible");
                validationYieldMs += performance.now() - at;
                yielded = performance.now();
              }
            }, { bytes: raw.byteLength, max: part.bytes }, options.pointTransport === 2 ? 2 : 1);
            body = decoded.value;
            if (decoded.changed) canonical = new TextEncoder().encode(JSON.stringify(body));
            if (canonical.byteLength !== part.bytes || await digest(canonical) !== part.hash) throw Error("Prepared wall batch part content hash mismatch");
            validationMs = performance.now() - validationAt;
          } else {
            const validationAt = performance.now();
            if (await digest(raw) !== part.hash) throw Error("Prepared wall batch part content hash mismatch");
            validationMs = performance.now() - validationAt;
            const at = performance.now();
            body = JSON.parse(new TextDecoder().decode(raw));
            jsonParseMs = performance.now() - at;
          }
          upstream.throwIfAborted();
          if (i === parts.length - 1) await receiver.finish();
          const headers = new Headers(response.headers);
          if (i > 0) headers.set("content-length", "0");
          if (i === parts.length - 1) work.finished = true;
          work.slots.get(part.index).resolve({ response: i === 0 ? response : new Response(null, { headers }), body, bytes: part.bytes, responseHeadersMs: i === 0 ? responseHeadersMs : 0, bodyReadMs, jsonParseMs, validationMs, validationYieldMs, attempts: attempt });
        }
      } finally {
        await receiver.close();
      }
    });
    void (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await attemptRead(attempt);
          return;
        } catch (error) {
          if (!(error instanceof TemporaryBatchResponse) || attempt === 3 || work.abort.signal.aborted) throw error;
          await retryDelay(Math.max(250 * attempt, error.retryAfterMs), work.abort.signal);
        }
      }
    })().catch((error) => {
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
var integer2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var digest2 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
var normalized = (s) => ({ topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs });
var yieldTask = (signal) => yieldHistoryTask(signal, "user-visible");
async function readPreparedWallProjection(advertised, context, onProgress) {
  if (!advertised) return null;
  const { manifest: m, delivery } = advertised;
  const pointTransport = delivery?.productTransport === 1 ? 2 : delivery?.pointTransport === 1 ? 1 : 0;
  if (m?.core !== WALL_PROJECTION_CORE_SHA256 || JSON.stringify(m.settings) !== JSON.stringify(normalized(context.settings))) return null;
  if (delivery?.version !== 1 || delivery.maxParts !== 32 || delivery.maxDecodedBytes !== 8 * 1024 * 1024) return null;
  if (m.version !== 2 || !hex(m.key) || !m.complete || m.sourceKey !== context.sourceKey || m.sourceToken !== context.sourceToken || m.profile?.id !== context.profile || m.profile.market !== context.market || m.active?.from !== context.from || m.active.to !== context.to || m.active.cursor !== context.watermark || m.active.epoch !== context.epoch || !Array.isArray(m.parts) || m.parts.length > 512 || !Array.isArray(m.closed) || m.closed.length > 1e5 || !Array.isArray(m.activeOrder) || m.activeOrder.length !== m.active.segments?.length || m.closed.length + m.activeOrder.length > 1e5 || await digest2(new TextEncoder().encode(JSON.stringify({ version: 2, sourceKey: context.sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalized(context.settings) }))) !== m.key) throw Error("Invalid prepared wall projection identity");
  if (context.outputHead && ![context.outputHead.cursor, context.outputHead.epoch].every(integer2)) throw Error("Invalid prepared wall output fence");
  const manifest = m, hashes = /* @__PURE__ */ new Set();
  let decodedBytes = 0;
  let restoreYieldMs = 0;
  const restore = async (value) => OrderWallsArchiveProjector.restoreCheckpointCooperatively(value, context.settings, context.from, context.to, {
    now: () => performance.now(),
    budgetMs: 8,
    check: () => context.signal.throwIfAborted(),
    yield: async () => {
      const began = performance.now();
      await yieldTask(context.signal);
      restoreYieldMs += performance.now() - began;
    }
  });
  context.validateProfile?.(manifest.profile);
  for (const p of manifest.parts) {
    if (!hex(p.hash) || hashes.has(p.hash) || !integer2(p.bytes) || p.bytes < 1 || p.bytes > 4 * 1024 * 1024 || !integer2(p.records) || p.records < 1) throw Error("Invalid prepared wall projection part");
    hashes.add(p.hash);
    decodedBytes += p.bytes;
  }
  if (decodedBytes > 64 * 1024 * 1024) throw Error("Prepared wall projection byte capacity");
  const coordinates = /* @__PURE__ */ new Map(), fragments = [];
  for (const [group, pairs] of manifest.closed.entries()) {
    if (!Array.isArray(pairs) || !pairs.length) throw Error("Invalid prepared wall projection coordinates");
    fragments.push(new Array(pairs.length).fill(void 0));
    for (const [fragment, pair] of pairs.entries()) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(integer2) || pair[0] >= manifest.parts.length || pair[1] >= manifest.parts[pair[0]].records || coordinates.has(pair.join(":"))) throw Error("Invalid prepared wall projection coordinates");
      coordinates.set(pair.join(":"), { group, fragment });
    }
  }
  await restore(manifest.active);
  const presentation = /* @__PURE__ */ new Map(), retained = [];
  for (const [i, segment] of manifest.active.segments.entries()) {
    if (segment.end !== null || !integer2(manifest.activeOrder[i])) throw Error("Invalid prepared wall projection active order");
    presentation.set(segment.id, segment);
    retained.push({ order: manifest.activeOrder[i], segment, valueRunOrder: manifest.active.valueRunOrder[i] });
  }
  let bytes = 0, parts = 0, decodeMs = 0, mergeMs = 0, runs = manifest.active.segments.reduce((n, segment) => n + segment.valueRuns.length, 0);
  context.signal.throwIfAborted();
  onProgress({ segments: manifest.active.segments, presentation, presentationThrough: manifest.active.confirmedTo, parts, bytes, decodeMs, mergeMs });
  function acquire(start) {
    if (start >= manifest.parts.length) return void 0;
    const selected = [];
    let size = 0;
    for (let i = start; i < Math.min(start + 32, manifest.parts.length); i++) {
      const part = manifest.parts[i];
      if (size + part.bytes + 1 > 8 * 1024 * 1024) break;
      selected.push({ ...part, index: i });
      size += part.bytes + 1;
    }
    if (!selected.length) throw Error("Prepared wall projection batch capacity");
    const url = "/market-data/v2/history/walls/projection-batch?" + new URLSearchParams({ market: context.market, key: manifest.key, start: String(start), version: pointTransport === 2 ? "3" : pointTransport === 1 ? "2" : "1" });
    return { selected, next: start + selected.length, handle: acquireWallBatch({ url, key: manifest.key, revision: manifest.sourceToken, parts: selected, fetcher: context.fetcher, signal: context.signal, maxParts: 32, pointTransport: pointTransport === 2 ? 2 : pointTransport === 1 }) };
  }
  let current = acquire(0), next;
  try {
    while (current) {
      context.signal.throwIfAborted();
      for (const part of current.selected) {
        const fetched = await current.handle.read(part.index), rows = fetched.body;
        decodeMs += fetched.jsonParseMs + (fetched.validationMs ?? 0);
        bytes += fetched.bytes;
        parts++;
        if (!Array.isArray(rows) || rows.length !== part.records) throw Error("Prepared wall projection record count mismatch");
        if (part.index === current.selected[0].index) next = acquire(current.next);
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
          for (const record2 of group) {
            const { valueRuns, ...nextHeader } = record2.segment;
            if (record2.offset !== count || record2.totalRuns !== first.totalRuns || record2.order !== first.order || !integer2(record2.order) || record2.segment.end === null || JSON.stringify(header) !== JSON.stringify(nextHeader) || !Array.isArray(valueRuns) || record2.valueRunOrder?.length !== valueRuns.length) throw Error("Prepared wall projection fragment identity mismatch");
            count += valueRuns.length;
          }
          if (count !== first.totalRuns) throw Error("Prepared wall projection fragment coverage mismatch");
          const completed = { order: first.order, segment: { ...first.segment, valueRuns: group.flatMap((record2) => record2.segment.valueRuns) }, valueRunOrder: group.flatMap((record2) => record2.valueRunOrder) };
          ready.push(completed);
          retained.push(completed);
          fragments[coordinate.group] = [];
          if (performance.now() - yielded >= 8) {
            const before = performance.now();
            await yieldTask(context.signal);
            yieldMs += performance.now() - before;
            context.signal.throwIfAborted();
            yielded = performance.now();
          }
        }
        if (ready.length) {
          runs += ready.reduce((n, record2) => n + record2.segment.valueRuns.length, 0);
          if (runs > 1e6) throw Error("Prepared wall projection retained capacity");
          const priorYield = restoreYieldMs;
          await restore({ ...manifest.active, candidates: [], seenGaps: [], segments: ready.map((row) => row.segment), valueRunOrder: ready.map((row) => row.valueRunOrder) });
          yieldMs += restoreYieldMs - priorYield;
          for (const record2 of ready) {
            if (presentation.has(record2.segment.id)) throw Error("Prepared wall projection duplicate identity");
            presentation.set(record2.segment.id, record2.segment);
          }
        }
        const partMergeMs = performance.now() - began - yieldMs;
        mergeMs += partMergeMs;
        context.signal.throwIfAborted();
        onProgress({ segments: ready.map((row) => row.segment), presentation, presentationThrough: manifest.active.confirmedTo, parts, bytes, decodeMs, mergeMs, metrics: { attempts: fetched.attempts, responseHeadersMs: fetched.responseHeadersMs, bodyReadMs: fetched.bodyReadMs, jsonParseMs: fetched.jsonParseMs, validationMs: fetched.validationMs ?? 0, mergeMs: partMergeMs, yieldMs: yieldMs + (fetched.validationYieldMs ?? 0), encodedBytes: Number(fetched.response.headers.get("content-length") ?? 0), requestId: fetched.response.headers.get("x-iq-request-id") ?? void 0 } });
        await yieldTask(context.signal);
      }
      current.handle.release();
      current = next;
      next = void 0;
    }
  } finally {
    current?.handle.release();
    next?.handle.release();
  }
  if (retained.length !== manifest.closed.length + manifest.active.segments.length || new Set(retained.map((record2) => record2.order)).size !== retained.length) throw Error("Prepared wall projection incomplete identities");
  const validation = context.validateCompletion?.();
  void validation?.catch(() => {
  });
  if (validation) {
    await yieldTask(context.signal);
    context.signal.throwIfAborted();
  }
  retained.sort((a, b) => a.order - b.order);
  context.signal.throwIfAborted();
  const projector = await restore({ ...manifest.active, ...context.outputHead ?? {}, segments: retained.map((row) => row.segment), valueRunOrder: retained.map((row) => row.valueRunOrder) });
  const presentationRevision = await digest2(new TextEncoder().encode(JSON.stringify(manifest)));
  await validation;
  context.signal.throwIfAborted();
  return { projector, coverage: manifest.coverage, profile: manifest.profile, presentation, presentationRevision, parts, bytes, decodeMs, mergeMs };
}

// src/feed/prepared-wall-history.ts
var integer3 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var hex2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var head = (value) => value && [value.cursor, value.epoch, value.at].every(integer3);
var sameRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function sourceFitsFence(manifest, source, target) {
  if (target.cursor >= manifest.watermark) return true;
  const anchor = source.anchor, stored = manifest.sourceProof.anchor, max = source.maxCursor;
  return typeof max === "number" && integer3(max) && max <= target.cursor && manifest.sourceProof.maxCursor === max && anchor && stored && integer3(anchor.cursor) && anchor.cursor <= target.cursor && integer3(anchor.epoch) && integer3(anchor.at) && anchor.at < manifest.request.from && hex2(anchor.hash) && anchor.cursor === stored.cursor && anchor.epoch === stored.epoch && anchor.at === stored.at && anchor.hash === stored.hash && manifest.parts.every((part, index) => part.after <= target.cursor && (index === manifest.parts.length - 1 || part.nextAfter <= target.cursor));
}
var hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
var sourceUrl = (path, r) => "/market-data/v2/history/walls/" + path + "?" + new URLSearchParams({ market: r.market, profile: r.profile, from: String(r.from), to: String(r.to) });
function validSource(value, r) {
  return value?.version === 1 && value.kind === "wall-source-sha256-xor-v1" && value.eligible === true && hex2(value.token) && sameRequest(value, r) && integer3(value.watermark) && head(value.head) && value.head.cursor === value.watermark && value.head.at >= r.to - 1;
}
async function readBytes(response, max) {
  const reader = response.body?.getReader(), chunks = [];
  let size = 0;
  if (reader) try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw Error("Prepared wall response byte capacity");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  else {
    const bytes2 = new Uint8Array(await response.arrayBuffer());
    size = bytes2.byteLength;
    if (size > max) throw Error("Prepared wall response byte capacity");
    chunks.push(bytes2);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
async function readBody(response, max, expectedHash) {
  const start = performance.now(), bytes = await readBytes(response, max);
  if (expectedHash && await hash(bytes) !== expectedHash) throw Error("Prepared wall part content hash mismatch");
  const bodyReadMs = performance.now() - start, parse = performance.now();
  const body = JSON.parse(new TextDecoder().decode(bytes));
  return { body, bytes: bytes.byteLength, bodyReadMs, jsonParseMs: performance.now() - parse };
}
async function validateManifest(value, source, r) {
  if (value?.version !== 5 || !hex2(value.key) || value.complete !== true || !sameRequest(value.request ?? {}, r) || !validSource(value.sourceProof, r) || value.sourceProof.token !== source.token || !integer3(value.watermark) || value.watermark > source.watermark || value.request.watermark !== value.watermark || value.sourceProof.watermark !== value.watermark || !head(value.head) || value.head.cursor !== value.watermark || value.head.at < r.to - 1 || JSON.stringify(value.head) !== JSON.stringify(value.sourceProof.head) || value.after !== value.watermark || !hex2(value.request.sourceRevision) || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 128) throw Error("Invalid prepared wall manifest identity");
  for (let i = 0; i < value.parts.length; i++) {
    const part = value.parts[i];
    if (part.index !== i || !hex2(part.hash) || !hex2(part.canonicalHash) || !integer3(part.bytes) || part.bytes < 1 || part.bytes > 4 * 1024 * 1024 || !integer3(part.after) || !integer3(part.nextAfter) || part.nextAfter < part.after || part.nextAfter > value.watermark || i && part.after !== value.parts[i - 1].nextAfter || i < value.parts.length - 1 && part.nextAfter <= part.after) throw Error("Invalid prepared wall part chain");
  }
  if (value.parts.at(-1).nextAfter !== value.watermark || await hash(new TextEncoder().encode(JSON.stringify(value.parts.map((p) => p.canonicalHash)))) !== value.request.sourceRevision) throw Error("Invalid prepared wall manifest revision");
  return value;
}
function rebasePreparedWallPage(raw, manifest, part, target) {
  if (!sameRequest({ ...raw, profile: raw?.profile?.id }, manifest.request) || raw.profile?.id !== manifest.request.profile || raw.watermark !== manifest.watermark || JSON.stringify(raw.head) !== JSON.stringify(manifest.head) || raw.page?.after !== part.after || raw.page.nextAfter !== part.nextAfter || raw.page.hasMore !== part.index < manifest.parts.length - 1) throw Error("Prepared wall page identity mismatch");
  if (!sourceFitsFence(manifest, manifest.sourceProof, target) || target.at < manifest.request.to - 1) throw Error("Prepared wall source fence cannot cover request");
  if (target.cursor < manifest.watermark && (raw.patches?.some((patch) => !integer3(patch.cursor) || patch.cursor > target.cursor) || raw.seed && (!integer3(raw.seed.cursor) || raw.seed.cursor > target.cursor))) throw Error("Prepared wall financial input exceeds bootstrap fence");
  const { profileStatus: _mutableProfileStatus, ...canonical } = raw;
  return {
    ...canonical,
    watermark: target.cursor,
    head: { ...target },
    snapshot: `${manifest.request.profile}:${target.cursor}:${raw.from}:${raw.to}`,
    page: { ...raw.page, nextAfter: raw.page.hasMore ? raw.page.nextAfter : target.cursor }
  };
}
var PreparedWallSourceChangedError = class extends Error {
  constructor() {
    super("Prepared wall source changed or cannot be revalidated; restart revision with displayed history retained");
    this.name = "PreparedWallSourceChangedError";
  }
};
async function preparedWallReader(request, fetcher, signal, resumeSourceToken, settings, options = {}) {
  const discovery = sourceUrl("discover", request);
  const projection = Boolean(settings && settings.topLevels === 8 && !settings.minimumNotionalEnabled && settings.minDurationMs === 0);
  const found = await discoverPreparedWallAdmission({ request, url: discovery, projection, fetcher, signal, ...options, decode: async (response, max) => (await readBody(response, max)).body });
  if (!found || found.state !== "ready") {
    if (resumeSourceToken) throw new PreparedWallSourceChangedError();
    return null;
  }
  if (!validSource(found.source, request)) throw Error("Invalid prepared wall source validation");
  const source = found.source;
  if (resumeSourceToken && source.token !== resumeSourceToken) throw new PreparedWallSourceChangedError();
  const manifest = await validateManifest(found.manifest, source, request);
  const target = request.watermark === void 0 ? source.head : request.head;
  if (!head(target) || target.cursor !== (request.watermark ?? source.watermark) || !sourceFitsFence(manifest, source, target) || target.cursor > source.watermark || target.at < request.to - 1) {
    if (resumeSourceToken) throw new PreparedWallSourceChangedError();
    return null;
  }
  if (found.readerLease && (found.readerLease.version !== 1 || found.readerLease.leaseMs !== 15e3)) throw Error("Invalid wall reader lease capability");
  const lease = found.readerLease ? await acquirePreparedWallReadLease({ canonicalKey: manifest.key, ...projection && found.projection?.manifest?.key ? { projectionKey: found.projection.manifest.key } : {} }, fetcher, signal) : void 0;
  if (lease) {
    const original = fetcher;
    fetcher = (input, init) => {
      const headers = {};
      new Headers(init?.headers).forEach((value, key) => headers[key] = value);
      headers["X-IQ-Wall-Reader"] = lease.consumer;
      return original(input, { ...init, headers });
    };
  }
  const abort = new AbortController(), consumer = AbortSignal.any([signal, abort.signal, ...lease ? [lease.signal] : []]);
  const assertActive = () => {
    lease?.assertActive();
    consumer.throwIfAborted();
  };
  const leaseFailure = (error) => {
    lease?.assertActive();
    throw error;
  };
  consumer.addEventListener("abort", () => lease?.release(), { once: true });
  async function validateRevision() {
    assertActive();
    const latest = await historyScheduler.read(sourceUrl("source", request), "order-walls", consumer, async (upstream) => {
      const response = await fetcher(sourceUrl("source", request), { signal: upstream });
      if (!response.ok) throw await historyHttpError(response, upstream, "Prepared wall source validation");
      return (await readBody(response, 128 * 1024)).body;
    }).catch(leaseFailure);
    assertActive();
    if (!validSource(latest, request) || latest.token !== source.token || latest.watermark < target.cursor) throw new PreparedWallSourceChangedError();
  }
  const pending = /* @__PURE__ */ new Map();
  let expectedAfter;
  const batchEnabled = found.delivery?.version === 2 && found.delivery.maxDecodedBytes === 8 * 1024 * 1024 && found.delivery.maxParts === 8;
  let currentBatch;
  function batchAt(startIndex) {
    const parts = [];
    let bytes = 0;
    for (const part of manifest.parts.slice(startIndex, startIndex + 8)) {
      if (bytes + part.bytes + 1 > 8 * 1024 * 1024) break;
      parts.push(part);
      bytes += part.bytes + 1;
    }
    const url = "/market-data/v2/history/walls/batch?" + new URLSearchParams({ market: request.market, key: manifest.key, start: String(startIndex), version: "2" });
    return { start: startIndex, next: startIndex + parts.length, handle: acquireWallBatch({ url, key: manifest.key, revision: manifest.request.sourceRevision, parts, fetcher, signal: consumer }) };
  }
  function prefetch(index, priority) {
    if (index >= manifest.parts.length || pending.has(index)) return;
    const part = manifest.parts[index], url = "/market-data/v2/history/walls/part?" + new URLSearchParams({ market: request.market, key: manifest.key, hash: part.hash });
    const promise = historyScheduler.read(url, "order-walls", consumer, async (upstream) => {
      const start = performance.now(), response = await fetcher(url, { signal: upstream }), responseHeadersMs = performance.now() - start;
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("Prepared wall part HTTP " + response.status);
      }
      const decoded = await readBody(response, 4 * 1024 * 1024, part.hash);
      if (decoded.bytes !== part.bytes) throw Error("Prepared wall part byte identity mismatch");
      return { response, ...decoded, responseHeadersMs, attempts: 1 };
    }, priority);
    pending.set(index, promise);
    void promise.catch(() => {
    });
  }
  return { sourceToken: source.token, dispose: () => {
    abort.abort();
    lease?.release();
    pending.clear();
    currentBatch?.handle.release();
    currentBatch = void 0;
  }, readProjection: async (settings2, onProgress, validateProfile) => {
    const result = await readPreparedWallProjection(found.projection, {
      sourceKey: manifest.key,
      sourceToken: source.token,
      watermark: manifest.watermark,
      epoch: manifest.head.epoch,
      from: request.from,
      to: request.to,
      profile: request.profile,
      market: request.market,
      settings: settings2,
      fetcher,
      signal: consumer,
      outputHead: { cursor: target.cursor, epoch: target.epoch },
      validateProfile,
      validateCompletion: validateRevision
    }, (value) => {
      assertActive();
      onProgress(value);
    }).catch(leaseFailure);
    assertActive();
    return result ? { ...result, head: target } : null;
  }, read: async (after) => {
    assertActive();
    if (expectedAfter !== void 0 && after !== expectedAfter) throw Error("Prepared wall continuation cursor mismatch");
    const index = after === 0 ? 0 : manifest.parts.findIndex((part) => part.after === after);
    if (index < 0) throw Error("Prepared wall resume cursor is not a part boundary");
    let result;
    if (batchEnabled && index > 0) {
      if (!currentBatch || index < currentBatch.start || index >= currentBatch.next) {
        currentBatch?.handle.release();
        currentBatch = batchAt(index);
      }
      result = await currentBatch.handle.read(index).catch(leaseFailure);
      if (index + 1 === currentBatch.next) {
        currentBatch.handle.release();
        currentBatch = void 0;
      }
    } else {
      prefetch(index, 0);
      if (!batchEnabled) prefetch(index + 1, 1);
      result = await pending.get(index).catch(leaseFailure);
      pending.delete(index);
    }
    const body = rebasePreparedWallPage(result.body, manifest, manifest.parts[index], target);
    expectedAfter = body.page.nextAfter;
    if (!body.page.hasMore) {
      await validateRevision();
    }
    assertActive();
    return { ...result, body };
  } };
}

// src/feed/history-trace.ts
var sessionId = crypto.randomUUID();
var sequence = 0;
var historyViewId = () => `view-${sessionId}-${++sequence}`;

// src/feed/order-walls.ts
var ORDER_WALL_MAX_SEGMENTS = 2e4;
var DEFAULT_ORDER_WALLS_SETTINGS = Object.freeze({
  enabled: false,
  mode: "top-levels",
  topLevels: 8,
  searchRangePercent: 10,
  minimumNotionalEnabled: false,
  minimumNotionalUsd: 1e5,
  highContrast: true,
  visibleRangeOnly: true,
  strengthThickness: true,
  historyEpisodes: 2e3,
  showHistory: true,
  showPriceLines: false,
  method: "relative",
  thresholdUsd: 5e5,
  relativeFloorUsd: 25e4,
  relativePercentile: 95,
  exitRatio: 0.85,
  minDurationMs: 0,
  aggregation: "native",
  colorMode: "heat",
  opacity: 0.85,
  thicknessPx: 3
});
var aggregations = ["auto", "native", 10, 25, 50, 100, 250];
var bounded = (v, min, max, fallback) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
function orderWallsSettings(value) {
  const v = value && typeof value === "object" ? value : {};
  const mode = v.mode === "threshold" || v.mode !== "top-levels" && ("method" in v || "relativePercentile" in v) ? "threshold" : "top-levels";
  let aggregation = aggregations.find((item) => item === v.aggregation) ?? (mode === "threshold" ? "auto" : DEFAULT_ORDER_WALLS_SETTINGS.aggregation);
  if (mode === "threshold" && v.aggregation === void 0) aggregation = "auto";
  if (mode === "top-levels" && aggregation === "auto") aggregation = "native";
  return {
    enabled: v.enabled === true,
    mode,
    topLevels: Math.floor(bounded(v.topLevels, 1, 10, 8)),
    searchRangePercent: bounded(v.searchRangePercent, 0.01, 10, 10),
    minimumNotionalEnabled: v.minimumNotionalEnabled === true,
    minimumNotionalUsd: bounded(v.minimumNotionalUsd, 0, 1e12, 1e5),
    highContrast: v.highContrast !== false,
    visibleRangeOnly: v.visibleRangeOnly !== false,
    strengthThickness: v.strengthThickness !== false,
    historyEpisodes: Math.floor(bounded(v.historyEpisodes, 16, ORDER_WALL_MAX_SEGMENTS, mode === "threshold" ? ORDER_WALL_MAX_SEGMENTS : 2e3)),
    showHistory: v.showHistory !== false,
    showPriceLines: v.showPriceLines === true,
    method: v.method === "absolute" ? "absolute" : "relative",
    thresholdUsd: bounded(v.thresholdUsd, 1, 1e12, DEFAULT_ORDER_WALLS_SETTINGS.thresholdUsd),
    relativeFloorUsd: bounded(v.relativeFloorUsd, 1, 1e12, DEFAULT_ORDER_WALLS_SETTINGS.relativeFloorUsd),
    relativePercentile: bounded(v.relativePercentile, 50, 99.9, DEFAULT_ORDER_WALLS_SETTINGS.relativePercentile),
    exitRatio: bounded(v.exitRatio, 0.1, 1, DEFAULT_ORDER_WALLS_SETTINGS.exitRatio),
    minDurationMs: bounded(v.minDurationMs, 0, 6e4, DEFAULT_ORDER_WALLS_SETTINGS.minDurationMs),
    aggregation,
    colorMode: v.colorMode === "bid-ask" ? "bid-ask" : "heat",
    opacity: bounded(v.opacity, 0, 1, DEFAULT_ORDER_WALLS_SETTINGS.opacity),
    thicknessPx: bounded(v.thicknessPx, 1, 4, mode === "threshold" ? 2 : DEFAULT_ORDER_WALLS_SETTINGS.thicknessPx)
  };
}

// src/feed/prepared-history.ts
var preparedDepthFeed = (market = "perpetual") => market === "spot" ? "binance:spot:BTCUSDT:spot-diff-depth" : "binance:perpetual:BTCUSDT:usd-m-standard-diff-depth-rpi-excluded";
var depthSource = (market = "perpetual") => market === "spot" ? "binance:spot:BTCUSDT:spot-diff-depth" : "usd-m-standard-diff-depth-rpi-excluded";

// src/feed/order-walls-archive.ts
var ORDER_WALL_ARCHIVE_PAGE_LIMIT = 256;
var ORDER_WALL_ARCHIVE_MAX_PAGES = 16384;
var ORDER_WALL_ARCHIVE_MAX_PATCHES = 5e5;
var ORDER_WALL_ARCHIVE_MAX_BYTES_PER_PAGE = 4 * 1024 * 1024;
var ORDER_WALL_ARCHIVE_PAGE_TIMEOUT_MS = 6e4;
var ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS = 3;
var ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS = [500, 1500];
var ORDER_WALL_ARCHIVE_YIELD_MAX_PAGES = 16;
var ORDER_WALL_ARCHIVE_YIELD_MAX_BYTES = 8 * 1024 * 1024;
var ORDER_WALL_ARCHIVE_YIELD_MAX_MS = 50;
var ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE = 4 * 1024 * 1024;
var ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_POLL = 16 * 1024 * 1024;
var ARCHIVE_MARKETS = {
  "binance-spot": {
    venueSlug: "spot",
    market: "spot",
    instrument: "binance:spot:BTCUSDT"
  },
  "binance-perp": {
    venueSlug: "usdm",
    market: "perpetual",
    instrument: "binance:perpetual:BTCUSDT"
  }
};
function orderWallsArchiveProfileId(market, rawSettings) {
  const settings = orderWallsSettings(rawSettings), basis = market === "binance-spot" || market === "binance-perp" ? ARCHIVE_MARKETS[market] : void 0;
  if (!basis || settings.mode !== "top-levels") return void 0;
  const feedSlug = depthSource(basis.market).split(":").at(-1).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const band = canonicalPercent(settings.searchRangePercent).replace(".", "_");
  const aggregation = settings.aggregation === "native" ? "native" : `${settings.aggregation}usdt`;
  const base = `binance-${basis.venueSlug}-btcusdt-feed-${feedSlug}-band-${band}pct-agg-${aggregation}-top10-a1-s1`;
  if (settings.minDurationMs === 0) return base;
  const minimum = settings.minimumNotionalEnabled ? `minusd-${archiveUsdSlug(settings.minimumNotionalUsd)}` : "minoff";
  return `${base}-confirm-${archiveDecimal(settings.minDurationMs).replace(".", "_")}ms-n${settings.topLevels}-${minimum}`;
}
function orderWallsArchiveAvailability(market, rawSettings, profileId) {
  const settings = orderWallsSettings(rawSettings), profile = market === "binance-spot" || market === "binance-perp" ? ARCHIVE_MARKETS[market] : void 0;
  if (!profile) return { exact: false, requestedBandPercent: settings.searchRangePercent, reason: "No durable Order Walls archive profile exists for this market." };
  if (settings.mode !== "top-levels") return { exact: false, market: profile.market, requestedBandPercent: settings.searchRangePercent, reason: "Threshold Walls do not have an exact Top Levels archive profile." };
  const id = profileId ?? orderWallsArchiveProfileId(market, settings);
  if (settings.aggregation === "native" && settings.searchRangePercent === 10 && settings.minDurationMs === 0 && !profileId) return { exact: true, profileId: id, market: profile.market, requestedBandPercent: settings.searchRangePercent };
  return {
    exact: false,
    profileId: id,
    market: profile.market,
    requestedBandPercent: settings.searchRangePercent,
    admissionRequired: true,
    reason: "Checking the exact archive profile for these Top Levels settings."
  };
}
async function loadOrderWallsArchive(options) {
  const { request } = options, settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  const baseStatus = archiveStatus(request, availability, "loading");
  if (!availability.exact && !availability.admissionRequired) {
    const status = statusForArchive(baseStatus, "unavailable", availability.reason);
    const result = { kind: "snapshot", segments: [], status, pages: 0, bytes: 0 };
    options.onUpdate?.(result);
    return result;
  }
  if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from >= request.to) {
    const status = statusForArchive(baseStatus, "unavailable", "Requested archive interval is invalid.");
    const result = { kind: "snapshot", segments: [], status, pages: 0, bytes: 0 };
    options.onUpdate?.(result);
    return result;
  }
  const profile = expectedProfile(request, settings, availability);
  const queryFrom = Math.max(0, request.from - settings.minDurationMs);
  const queryRequest = queryFrom === request.from ? request : { ...request, from: queryFrom };
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const pageLimit = Math.max(1, Math.min(ORDER_WALL_ARCHIVE_PAGE_LIMIT, Math.floor(options.pageLimit ?? ORDER_WALL_ARCHIVE_PAGE_LIMIT)));
  const signal = options.signal;
  const viewId = historyViewId();
  const correlatedFetcher = (input, init) => fetcher(input, { ...init, headers: { ...init?.headers, "X-IQ-View-Id": viewId } });
  const consumerSignal = signal ?? new AbortController().signal;
  const prior = options.resume;
  const projector = prior?.projector ?? options.initialProjector ?? new OrderWallsArchiveProjector(settings, queryFrom, request.to);
  let after = prior?.after ?? request.after ?? 0, watermark = prior?.watermark ?? request.watermark, watermarkHead = prior?.head ?? request.head, pages = prior?.pages ?? 0, bytes = prior?.bytes ?? 0, patchCount = prior?.patchCount ?? 0;
  let batchPages = 0, batchBytes = 0, batchStartedAt = performance.now();
  let pageCoverage = prior?.coverage;
  let lastMidpoint = prior?.lastMidpoint ?? null;
  let profileStatus = prior?.profileStatus;
  let sentInitial = pages > 0;
  let lastStatus;
  const prepared = define_import_meta_env_default.VITE_HISTORY_TILES === "1" && (!after || prior?.preparedSourceToken) ? await preparedWallReader({
    market: profile.market,
    profile: profile.id,
    from: queryFrom,
    to: request.to,
    watermark,
    head: watermarkHead
  }, correlatedFetcher, consumerSignal, prior?.preparedSourceToken, settings, { retry: options.preparationRetry, onPreparation: (preparation) => {
    const reason = wallPreparationReason(preparation);
    const archive = {
      ...archiveStatus(request, availability, "building"),
      requestComplete: false,
      rangeComplete: false,
      loadedThrough: Math.min(request.to, Math.max(request.from, prior?.projector.confirmedAt ?? request.from)),
      preparation,
      reason
    };
    options.onUpdate?.({ kind: "patch", patches: [], status: statusForArchive(archive, "building", reason), pages, bytes, ...prior ? { resume: prior } : {} });
  } }) : null;
  const captureResume = (resumeAfter = after) => ({
    after: resumeAfter,
    watermark,
    head: watermarkHead,
    pages,
    bytes,
    patchCount,
    coverage: pageCoverage,
    lastMidpoint,
    profileStatus,
    projector,
    ...prepared ? { preparedSourceToken: prepared.sourceToken } : {}
  });
  try {
    if (prepared && !after && !prior && !options.initialProjector) {
      let painted = false;
      const projected = await prepared.readProjection(settings, (progress2) => {
        const archive = { ...archiveStatus(request, availability, "loading"), exact: true, requestComplete: false, rangeComplete: false, loadedThrough: request.from, presentationThrough: progress2.presentationThrough };
        const status = statusForArchive(archive, "loading", "Loading validated prepared wall records; full range validation pending.");
        const update = {
          kind: painted ? "patch" : "snapshot",
          ...painted ? { patches: progress2.segments.map((segment) => ({ id: segment.id, segment, replaceValueRuns: true })) } : { segments: progress2.segments },
          presentation: progress2.presentation,
          status,
          pages: progress2.parts,
          bytes: progress2.bytes
        };
        const at = performance.now();
        options.onUpdate?.(update);
        painted = true;
        if (progress2.metrics) options.onPageMetrics?.({
          viewId,
          delivery: "projection",
          receivedSegments: progress2.segments.length,
          requestId: progress2.metrics.requestId,
          encodedBytes: progress2.metrics.encodedBytes,
          requestedAfter: progress2.parts - 1,
          pageAfter: progress2.parts - 1,
          nextAfter: progress2.parts,
          patchCount: 0,
          responseBytes: progress2.bytes - bytes,
          responseHeadersMs: progress2.metrics.responseHeadersMs,
          responseBodyReadMs: progress2.metrics.bodyReadMs,
          jsonParseMs: progress2.metrics.jsonParseMs,
          validationMs: progress2.metrics.validationMs,
          projectorApplyMs: progress2.metrics.mergeMs,
          updateCallbackMs: performance.now() - at,
          eventLoopYieldDelayMs: progress2.metrics.yieldMs,
          attempts: progress2.metrics.attempts
        });
        bytes = progress2.bytes;
      }, (candidate) => {
        if (!profileBasisMatches(candidate, profile) || !orderWallsArchiveDerivationsExact(candidate, settings)) throw Error("Prepared wall projection profile is not exactly derivable");
      });
      if (projected) {
        const head2 = projected.head, coverage = projected.coverage;
        validatePage({
          version: 1,
          profile: projected.profile,
          market: projected.profile.market,
          instrument: projected.profile.instrument,
          feed: projected.profile.feed,
          from: queryFrom,
          to: request.to,
          watermark: head2.cursor,
          head: head2,
          page: { after: 0, nextAfter: head2.cursor, hasMore: false, lastAt: coverage.confirmedTo ?? queryFrom, limit: pageLimit, sameMillisecondClosed: true },
          patches: [],
          coverage
        }, profile, queryRequest, 0, watermark, watermarkHead);
        const extent = coverage.availableFrom !== null && coverage.availableFrom <= request.from && coverage.confirmedTo !== null && coverage.confirmedTo >= request.to - 1;
        const state = coverage.status === "complete" && (!extent || coverage.partial || coverage.gaps.length || coverage.gapsTruncated) ? "partial" : coverageState2(coverage.status);
        const archive = {
          ...archiveStatus(request, availability, state, coverage),
          exact: true,
          requestComplete: true,
          loadedThrough: projected.projector.confirmedAt,
          profileVersion: projected.profile.version,
          algorithmVersion: projected.profile.algorithmVersion,
          schemaVersion: projected.profile.schemaVersion,
          midpoint: projected.projector.selectedState().midpoint
        };
        const result = { kind: "snapshot", segments: projected.projector.snapshot(), projector: projected.projector, presentation: projected.presentation, preparedPresentationComplete: true, preparedSourceToken: prepared.sourceToken, preparedPresentationRevision: projected.presentationRevision, status: statusForArchive(archive, state, coverage.reason), watermark: head2.cursor, head: head2, cursor: head2.cursor, pages: projected.parts, bytes: projected.bytes };
        options.onUpdate?.(result);
        return result;
      }
    }
    for (; ; ) {
      if (signal?.aborted) throw abortError();
      if (pages >= ORDER_WALL_ARCHIVE_MAX_PAGES || patchCount > ORDER_WALL_ARCHIVE_MAX_PATCHES) {
        const archive2 = { ...archiveStatus(request, availability, "partial", pageCoverage), ...profileStatus ? { profileStatus } : {} };
        archive2.requestComplete = false;
        const status2 = statusForArchive(archive2, "partial", "Archive page or patch safety limit reached before the requested interval completed.");
        const segments = projector.snapshot();
        const update2 = { kind: sentInitial ? "patch" : "snapshot", ...sentInitial ? { patches: [] } : { segments }, status: status2, watermark, head: watermarkHead, cursor: after, pages, bytes, projector };
        options.onUpdate?.(update2);
        return { kind: "snapshot", segments, status: status2, watermark, head: watermarkHead, cursor: after, pages, bytes, projector };
      }
      const params = new URLSearchParams({
        profile: profile.id,
        market: profile.market,
        from: String(queryFrom),
        to: String(request.to),
        after: String(after),
        limit: String(pageLimit)
      });
      if (watermark !== void 0) params.set("watermark", String(watermark));
      if (define_import_meta_env_default.VITE_HISTORY_TILES === "1") params.set("display", "1");
      const url = `/market-data/v1/order-walls/archive?${params}`;
      let fetched;
      try {
        fetched = prepared ? await prepared.read(after) : await historyScheduler.read(url, "order-walls", consumerSignal, (upstream) => fetchArchivePageWithRetry(correlatedFetcher, url, after, upstream));
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (!(error instanceof OrderWallsArchivePageRequestError)) throw error;
        const message = `Archive request incomplete after ${error.attempts} attempts: ${error.message}. Validated history is retained and can be resumed.`;
        const priorArchive = lastStatus?.archive ?? archiveStatus(request, availability, "partial", pageCoverage);
        const archive2 = {
          ...priorArchive,
          state: "partial",
          requestComplete: false,
          resumeAfter: after,
          reason: message,
          ...profileStatus ? { profileStatus } : {}
        };
        const status2 = {
          ...lastStatus ?? statusForArchive(archive2, "loading"),
          state: "loading",
          message,
          coverage: { from: request.from, to: request.to, complete: false, partial: true, reason: message },
          archive: archive2
        };
        const segments = projector.snapshot(), resume = captureResume();
        const result = {
          kind: "snapshot",
          segments,
          status: status2,
          watermark,
          head: watermarkHead,
          cursor: after,
          pages,
          bytes,
          projector,
          resume
        };
        options.onUpdate?.(sentInitial ? { ...result, kind: "patch", patches: [] } : result);
        return result;
      }
      const { response, body, bytes: pageBytes, responseHeadersMs, bodyReadMs: responseBodyReadMs, jsonParseMs, attempts } = fetched;
      bytes += pageBytes;
      batchBytes += pageBytes;
      if (isRecord2(body) && isRecord2(body.coverage) && body.coverage.status === "unavailable") {
        const page2 = body;
        if (isArchiveProfileStatus(page2.profileStatus)) profileStatus = page2.profileStatus;
        validateUnavailableIdentity(page2, profile, queryRequest);
        const preserved = projector.snapshot(), partialAfterProgress = pages > 0;
        const unavailable = archiveStatus(request, availability, partialAfterProgress ? "partial" : "unavailable", page2.coverage);
        unavailable.exact = false;
        unavailable.requestComplete = true;
        if (profileStatus) unavailable.profileStatus = profileStatus;
        const message = page2.coverage.reason ?? "The requested archive interval is unavailable.";
        const status2 = statusForArchive(unavailable, partialAfterProgress ? "partial" : "unavailable", message);
        const result = { kind: "snapshot", segments: preserved, status: status2, watermark: validInt2(page2.watermark) ? page2.watermark : void 0, head: watermarkHead, pages: pages + 1, bytes, projector };
        options.onUpdate?.(pages ? { ...result, kind: "patch", patches: [] } : result);
        return result;
      }
      const validationStartedAt = performance.now();
      const page = validatePage(body, profile, queryRequest, after, watermark, watermarkHead);
      const validationMs = performance.now() - validationStartedAt + ("validationMs" in fetched ? Number(fetched.validationMs ?? 0) : 0);
      if (page.profileStatus) profileStatus = page.profileStatus;
      if (watermark === void 0) {
        watermark = page.watermark;
        watermarkHead = page.head;
      }
      const fixedAt = watermarkHead?.at;
      const fixedCoverage = fixedAt === void 0 ? page.coverage : {
        ...page.coverage,
        confirmedTo: page.coverage.confirmedTo === null ? null : Math.min(page.coverage.confirmedTo ?? fixedAt, fixedAt),
        gaps: page.coverage.gaps.filter((gap) => (gap.from ?? gap.at ?? 0) <= fixedAt)
      };
      const replayPage = { ...page, coverage: fixedCoverage, head: page.head ?? watermarkHead };
      if (!orderWallsArchiveDerivationsExact(page.profile, settings)) {
        const archive2 = {
          ...archiveStatus(request, availability, "unavailable", page.coverage),
          exact: false,
          requestComplete: true,
          ...profileStatus ? { profileStatus } : {}
        };
        const status2 = statusForArchive(archive2, "unavailable", "The server profile cannot exactly derive the requested Top Levels settings.");
        const segments = projector.snapshot();
        const result = { kind: "snapshot", segments, status: status2, watermark, pages: pages + 1, bytes, projector };
        options.onUpdate?.(pages ? { ...result, kind: "patch", patches: [] } : result);
        return result;
      }
      pages++;
      batchPages++;
      patchCount += page.patches.length;
      pageCoverage = mergeCoverage(pageCoverage, fixedCoverage);
      if (page.patches.length) lastMidpoint = page.patches.at(-1).midpoint;
      else if (page.seed) lastMidpoint = page.seed.midpoint;
      const projectionStartedAt = performance.now();
      const changed = projector.applyPage(replayPage);
      const projectorApplyMs = performance.now() - projectionStartedAt;
      const serverState = coverageState2(pageCoverage.status);
      const locallyLimited = projector.historyLimited && !page.page.hasMore;
      const extentCovered = pageCoverage.availableFrom !== null && pageCoverage.availableFrom <= request.from && pageCoverage.confirmedTo !== null && pageCoverage.confirmedTo >= request.to - 1;
      const sourceCoveragePartial = pageCoverage.status !== "complete" || pageCoverage.partial || pageCoverage.gaps.length > 0 || pageCoverage.gapsTruncated === true;
      const rangeComplete = extentCovered && !sourceCoveragePartial;
      const summaryState = page.page.hasMore ? "loading" : serverState === "complete" && (locallyLimited || sourceCoveragePartial || !extentCovered) ? "partial" : serverState;
      const archive = {
        ...archiveStatus(request, availability, summaryState, pageCoverage),
        exact: true,
        ...profileStatus ? { profileStatus } : {},
        market: page.profile.market,
        feed: page.profile.feed,
        aggregation: page.profile.aggregation,
        profileVersion: page.profile.version,
        algorithmVersion: page.profile.algorithmVersion,
        schemaVersion: page.profile.schemaVersion,
        midpoint: lastMidpoint,
        requestComplete: !page.page.hasMore,
        rangeComplete,
        ...page.page.hasMore ? { resumeAfter: page.page.nextAfter } : {}
      };
      archive.loadedThrough = projector.confirmedAt;
      if (locallyLimited) archive.reason = "Local archive projection reached its bounded history capacity.";
      else if (!page.page.hasMore && !extentCovered && serverState === "complete") archive.reason = "The archive source did not confirm the full requested time extent.";
      const status = statusForArchive(archive, summaryState, pageCoverage.reason ?? archive.reason);
      lastStatus = status;
      if (projector.valueRunsLimited) status.valueHistoryLimited = true;
      if (projector.episodesLimited) status.episodeHistoryLimited = true;
      const update = sentInitial ? {
        kind: "patch",
        patches: changed,
        status,
        watermark,
        head: watermarkHead,
        cursor: page.page.nextAfter,
        pages,
        bytes,
        projector,
        ...page.page.hasMore ? { resume: captureResume(page.page.nextAfter) } : {}
      } : {
        kind: "snapshot",
        segments: projector.snapshot(),
        status,
        watermark,
        head: watermarkHead,
        cursor: page.page.nextAfter,
        pages,
        bytes,
        projector,
        ...page.page.hasMore ? { resume: captureResume(page.page.nextAfter) } : {}
      };
      sentInitial = true;
      const updateStartedAt = performance.now();
      options.onUpdate?.(update);
      const updateCallbackMs = performance.now() - updateStartedAt;
      const requestedAfter = after;
      if (page.page.hasMore && page.page.nextAfter <= after) throw new Error("Order Walls archive cursor did not advance");
      if (page.page.hasMore) after = page.page.nextAfter;
      let eventLoopYieldDelayMs = 0;
      if (page.page.hasMore && (batchPages >= ORDER_WALL_ARCHIVE_YIELD_MAX_PAGES || batchBytes >= ORDER_WALL_ARCHIVE_YIELD_MAX_BYTES || performance.now() - batchStartedAt >= ORDER_WALL_ARCHIVE_YIELD_MAX_MS)) {
        const yieldStartedAt = performance.now();
        await yieldArchiveBatch(signal);
        eventLoopYieldDelayMs = performance.now() - yieldStartedAt;
        batchPages = 0;
        batchBytes = 0;
        batchStartedAt = performance.now();
      }
      options.onPageMetrics?.({
        viewId,
        requestId: response.headers.get("x-iq-request-id") ?? void 0,
        dbQueries: Number(response.headers.get("x-iq-db-queries") ?? 0),
        dbReadRows: Number(response.headers.get("x-iq-db-read-rows") ?? 0),
        dbReadBytes: Number(response.headers.get("x-iq-db-read-bytes") ?? 0),
        encodedBytes: Number(response.headers.get("content-length") ?? 0),
        requestedAfter,
        pageAfter: page.page.after,
        nextAfter: page.page.nextAfter,
        patchCount: page.patches.length,
        responseBytes: pageBytes,
        responseHeadersMs,
        responseBodyReadMs,
        jsonParseMs,
        validationMs,
        projectorApplyMs,
        updateCallbackMs,
        eventLoopYieldDelayMs,
        attempts
      });
      if (!page.page.hasMore) return { kind: "snapshot", segments: projector.snapshot(), status, watermark, head: watermarkHead, cursor: page.page.nextAfter, pages, bytes, projector };
    }
  } finally {
    prepared?.dispose();
  }
}
function isArchiveProfileStatus(value) {
  return value === "building" || value === "backfilling" || value === "ready" || value === "unavailable";
}
var OrderWallsArchivePageRequestError = class extends Error {
  constructor(message, attempts) {
    super(message);
    this.attempts = attempts;
    this.name = "OrderWallsArchivePageRequestError";
  }
};
async function fetchArchivePageWithRetry(fetcher, url, after, signal) {
  let lastError;
  for (let attempt = 1; attempt <= ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError();
    const fetchStartedAt = performance.now();
    try {
      const timeout = AbortSignal.timeout(ORDER_WALL_ARCHIVE_PAGE_TIMEOUT_MS);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetcher(url, { signal: requestSignal });
      const responseHeadersMs = performance.now() - fetchStartedAt;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => void 0);
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt === ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS) {
          throw new OrderWallsArchivePageRequestError(errorText(lastError), attempt);
        }
        await waitArchiveRetry(ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS[attempt - 1], signal);
        continue;
      }
      const { body, bytes, bodyReadMs, jsonParseMs } = await readBoundedJson(
        response,
        ORDER_WALL_ARCHIVE_MAX_BYTES_PER_PAGE,
        `Order Walls archive HTTP ${response.status}`
      );
      if (!response.ok) throw new Error(isRecord2(body) && typeof body.error === "string" ? body.error : `Order Walls archive HTTP ${response.status}`);
      return { response, body, bytes, responseHeadersMs, bodyReadMs, jsonParseMs, attempts: attempt };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error instanceof OrderWallsArchivePageRequestError) throw error;
      if (!isRetryableArchivePageError(error)) throw error;
      lastError = error;
      if (attempt === ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS) {
        throw new OrderWallsArchivePageRequestError(errorText(error), attempt);
      }
      await waitArchiveRetry(ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS[attempt - 1], signal);
    }
  }
  throw new OrderWallsArchivePageRequestError(errorText(lastError ?? "request failed"), ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS);
}
function isRetryableArchivePageError(error) {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return true;
  return error instanceof Error && /timeout|timed out|network|fetch failed/i.test(error.message);
}
function waitArchiveRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function readBoundedJson(response, maxBytes, label) {
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > maxBytes) throw new Error(`${label} exceeded its response-size limit`);
  if (!response.body) {
    const bodyReadStartedAt2 = performance.now();
    const text = await response.text();
    const bodyReadMs2 = performance.now() - bodyReadStartedAt2;
    const bytes2 = new TextEncoder().encode(text).byteLength;
    if (bytes2 > maxBytes) throw new Error(`${label} exceeded its response-size limit`);
    const jsonParseStartedAt2 = performance.now();
    try {
      const body = JSON.parse(text);
      return { body, bytes: bytes2, bodyReadMs: bodyReadMs2, jsonParseMs: performance.now() - jsonParseStartedAt2 };
    } catch {
      throw new Error(`${label} returned invalid JSON`);
    }
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0, bodyReadStartedAt = performance.now();
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeded its response-size limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const bodyReadMs = performance.now() - bodyReadStartedAt;
  const jsonParseStartedAt = performance.now();
  try {
    const body = JSON.parse(new TextDecoder().decode(merged));
    return { body, bytes, bodyReadMs, jsonParseMs: performance.now() - jsonParseStartedAt };
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
function yieldArchiveBatch(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 0);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function validatePage(body, expected, request, after, watermark, expectedHead) {
  if (!isRecord2(body)) throw new Error("Invalid Order Walls archive page contract");
  const page = body;
  const head2 = page.head;
  const establishesWatermark = watermark === void 0;
  const effectiveAfter = after === 0 ? page.page?.after : after;
  if (page.version !== 1 || !profileBasisMatches(page.profile, expected) || page.market !== expected.market || page.instrument !== expected.instrument || page.feed !== expected.feed || page.profile.feed !== expected.feed || page.from !== request.from || page.to !== request.to || !validInt2(page.watermark) || watermark !== void 0 && page.watermark !== watermark || establishesWatermark && (!head2 || head2.cursor !== page.watermark || !validInt2(head2.cursor) || !validInt2(head2.epoch) || !finiteNonNegative2(head2.at)) || !establishesWatermark && (head2 !== void 0 && (!expectedHead || head2.cursor !== expectedHead.cursor || head2.at !== expectedHead.at || head2.epoch !== expectedHead.epoch)) || !establishesWatermark && !head2 && !expectedHead || !page.page || after !== 0 && page.page.after !== after || !validInt2(page.page.after) || !validInt2(page.page.nextAfter) || page.page.after > page.watermark || !validInt2(page.page.nextAfter) || !finiteNonNegative2(page.page.lastAt) || !validInt2(page.page.limit) || page.page.sameMillisecondClosed !== true || !Array.isArray(page.patches) || !page.coverage || !Array.isArray(page.coverage.gaps) || page.profileStatus !== void 0 && !isArchiveProfileStatus(page.profileStatus) || page.coverage.requestedFrom !== request.from || page.coverage.requestedTo !== request.to || !["building", "backfilling", "complete", "partial", "unavailable"].includes(page.coverage.status)) throw new Error("Invalid Order Walls archive page contract");
  if (after === 0 && page.seed && page.page.after < page.seed.cursor) throw new Error("Order Walls archive page cursor precedes its carry-in seed");
  if (!validInt2(effectiveAfter)) throw new Error("Invalid Order Walls archive start cursor");
  let previousCursor = effectiveAfter;
  for (const patch of page.patches) {
    if (!isRecord2(patch) || !["patch", "gap"].includes(patch.kind) || !validInt2(patch.cursor) || patch.cursor <= effectiveAfter || patch.cursor <= previousCursor || patch.cursor > page.watermark || !validInt2(patch.epoch) || !finiteNonNegative2(patch.at) || !(patch.midpoint === null || validDecimal2(patch.midpoint)) || !validSidePatch(patch.bids) || !validSidePatch(patch.asks)) {
      throw new Error("Invalid Order Walls archive patch ordering or candidate data");
    }
    if (patch.kind === "gap" && typeof patch.reason !== "string") throw new Error("Order Walls archive gap has no reason");
    previousCursor = patch.cursor;
  }
  const expectedNextAfter = page.page.hasMore ? page.patches.at(-1)?.cursor : page.watermark;
  if (expectedNextAfter === void 0 || page.page.nextAfter !== expectedNextAfter || page.page.hasMore && page.page.nextAfter <= effectiveAfter) throw new Error("Invalid Order Walls archive continuation cursor");
  if (page.seed !== void 0 && (!validInt2(page.seed.cursor) || !validInt2(page.seed.epoch) || !finiteNonNegative2(page.seed.at) || !(page.seed.midpoint === null || validDecimal2(page.seed.midpoint)) || !Array.isArray(page.seed.bids) || !Array.isArray(page.seed.asks) || !page.seed.bids.every((candidate) => validCandidate2(candidate) && candidate.side === "bid") || !page.seed.asks.every((candidate) => validCandidate2(candidate) && candidate.side === "ask"))) throw new Error("Invalid Order Walls archive carry-in seed");
  if (after === 0 && page.seed && page.seed.at > request.from) throw new Error("Order Walls archive carry-in seed is after the requested start");
  for (const patch of page.patches) for (const candidate of [...patch.bids.upserts, ...patch.asks.upserts]) {
    if (candidate.confirmationAt !== void 0 && candidate.confirmationAt !== null && candidate.confirmationAt > patch.at) {
      throw new Error("Order Walls archive candidate confirmation exceeds its observation time");
    }
  }
  return page;
}
function validateUnavailableIdentity(page, expected, request) {
  if (!page.profile || !profileBasisMatches(page.profile, expected) || page.market !== expected.market || page.instrument !== expected.instrument || page.feed !== expected.feed || page.profile.feed !== expected.feed || page.from !== request.from || page.to !== request.to || !page.coverage || page.coverage.requestedFrom !== request.from || page.coverage.requestedTo !== request.to) throw new Error("Invalid unavailable Order Walls archive response identity");
}
function profileBasisMatches(profile, expected) {
  return Boolean(profile && profile.id === expected.id && profile.version === 1 && profile.venue === "binance" && profile.market === expected.market && profile.instrument === expected.instrument && profile.feed === expected.feed && profile.aggregation === expected.aggregation && profile.bandPercent === expected.bandPercent && profile.midpointBasis === "best-observed-bid-ask" && profile.topN === 10 && profile.algorithmVersion === 1 && profile.schemaVersion === 1 && profile.confirmationMs === expected.confirmationMs && profile.selectionTopN === expected.selectionTopN && profile.minimumNotionalUsd === expected.minimumNotionalUsd);
}
function orderWallsArchiveDerivationsExact(profile, settings) {
  const common = Array.isArray(profile.exactDerivations?.bandPercent) && profile.exactDerivations.bandPercent.includes(settings.searchRangePercent) && profile.exactDerivations.minimumNotional === true && profile.exactDerivations.confirmation === true;
  if (!common) return false;
  if (settings.minDurationMs === 0) return profile.confirmationMs === 0 && profile.selectionTopN === 10 && profile.minimumNotionalUsd === null && profile.exactDerivations.topNMax >= settings.topLevels;
  const requestedMinimum = settings.minimumNotionalEnabled ? archiveDecimal(settings.minimumNotionalUsd) : null;
  return profile.confirmationMs === settings.minDurationMs && profile.selectionTopN === settings.topLevels && profile.minimumNotionalUsd === requestedMinimum && profile.exactDerivations.confirmationCrossings === true;
}
function validSidePatch(value) {
  return isRecord2(value) && Array.isArray(value.upserts) && value.upserts.every(validCandidate2) && Array.isArray(value.removals) && value.removals.every(validRemoval);
}
function validCandidate2(value) {
  if (!isRecord2(value)) return false;
  return typeof value.entryId === "string" && value.entryId.length > 0 && (value.side === "bid" || value.side === "ask") && validDecimal2(value.price) && decimalNumber2(value.price) > 0 && validDecimal2(value.quantity) && validDecimal2(value.notional) && validInt2(value.rank) && value.rank >= 1 && value.rank <= 10 && finiteNonNegative2(value.startedAt) && validInt2(value.startCursor) && validInt2(value.startEpoch) && typeof value.startKnown === "boolean" && (value.confirmationAt === void 0 || value.confirmationAt === null || finiteNonNegative2(value.confirmationAt));
}
function validRemoval(value) {
  if (!isRecord2(value)) return false;
  return typeof value.entryId === "string" && value.entryId.length > 0 && (value.side === "bid" || value.side === "ask") && validDecimal2(value.price) && finiteNonNegative2(value.at) && validInt2(value.cursor) && validInt2(value.epoch) && ["band-exit", "rank-exit", "below-minimum", "observed-zero", "gap", "replacement-epoch", "capacity-unknown"].includes(String(value.reason)) && finiteNonNegative2(value.lastConfirmedAt) && validInt2(value.lastConfirmedCursor);
}
function archiveStatus(request, availability, state, coverage) {
  const gaps = (coverage?.gaps ?? []).map((gap) => ({
    from: gap.from ?? gap.at ?? request.from,
    to: gap.to ?? gap.at ?? gap.from ?? request.to,
    reason: gap.reason
  }));
  return {
    profileId: availability.profileId ?? request.profileId ?? "",
    state,
    from: request.from,
    to: request.to,
    rangeComplete: Boolean(coverage && coverage.status === "complete" && !coverage.partial && !coverage.gaps.length && !coverage.gapsTruncated && coverage.availableFrom !== null && coverage.availableFrom <= request.from && coverage.confirmedTo !== null && coverage.confirmedTo >= request.to - 1),
    market: availability.market,
    feed: availability.market ? preparedDepthFeed(availability.market) : void 0,
    aggregation: orderWallsSettings(request.settings).aggregation === "native" ? "native" : `${orderWallsSettings(request.settings).aggregation}usdt`,
    ...coverage?.availableFrom !== void 0 && coverage.availableFrom !== null ? { availableFrom: coverage.availableFrom } : {},
    ...coverage?.confirmedTo !== void 0 && coverage.confirmedTo !== null ? { confirmedTo: coverage.confirmedTo } : {},
    gaps,
    ...coverage?.gapsTruncated ? { gapsTruncated: true } : {},
    requestedBandPercent: availability.requestedBandPercent,
    profileBandPercent: orderWallsSettings(request.settings).searchRangePercent,
    requestedTopN: orderWallsSettings(request.settings).topLevels,
    exact: availability.exact,
    ...coverage?.reason || availability.reason ? { reason: coverage?.reason ?? availability.reason } : {}
  };
}
function statusForArchive(archive, state, message) {
  const complete = state === "complete";
  const unavailable = state === "unavailable";
  const coverage = {
    from: archive.from,
    to: archive.to,
    complete,
    partial: !complete,
    ...archive.reason || message ? { reason: archive.reason ?? message } : {}
  };
  const statusState = unavailable ? "unavailable" : state === "loading" || state === "building" || state === "backfilling" ? "loading" : state === "partial" ? "gap" : "stale";
  return { state: statusState, ...message || archive.reason ? { message: message ?? archive.reason } : {}, coverage, archive: { ...archive, state } };
}
function mergeCoverage(previous, next) {
  if (!previous) return next;
  const gaps = /* @__PURE__ */ new Map();
  for (const gap of [...previous.gaps, ...next.gaps]) gaps.set(`${gap.from ?? gap.at}:${gap.to ?? gap.at}:${gap.reason}`, gap);
  return { ...previous, ...next, bookScope: next.bookScope ?? previous.bookScope, gaps: [...gaps.values()] };
}
function expectedProfile(request, settings, availability) {
  const market = request.market === "binance-spot" ? "spot" : "perpetual";
  return {
    id: request.profileId ?? availability.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? "",
    market,
    instrument: market === "spot" ? "binance:spot:BTCUSDT" : "binance:perpetual:BTCUSDT",
    feed: preparedDepthFeed(market),
    aggregation: settings.aggregation === "native" ? "native" : `${settings.aggregation}usdt`,
    bandPercent: settings.searchRangePercent,
    confirmationMs: settings.minDurationMs,
    selectionTopN: settings.minDurationMs === 0 ? 10 : settings.topLevels,
    minimumNotionalUsd: settings.minDurationMs > 0 && settings.minimumNotionalEnabled ? archiveDecimal(settings.minimumNotionalUsd) : null
  };
}
function coverageState2(value) {
  if (value === "building" || value === "backfilling" || value === "unavailable") return value;
  return value === "complete" ? "complete" : "partial";
}
function canonicalPercent(value) {
  return Number(value.toPrecision(12)).toString().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
function archiveDecimal(value) {
  return expandExponent2(value.toString()).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
function archiveUsdSlug(value) {
  return archiveDecimal(value).replace(".", "_");
}
function expandExponent2(value) {
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponentText] = value.toLowerCase().split("e");
  const exponent = Number(exponentText), negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split("."), digits = whole + fraction, decimalAt = whole.length + exponent;
  const expanded = decimalAt <= 0 ? `0.${"0".repeat(-decimalAt)}${digits}` : decimalAt >= digits.length ? `${digits}${"0".repeat(decimalAt - digits.length)}` : `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  return `${negative ? "-" : ""}${expanded}`;
}
function validDecimal2(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
function decimalNumber2(value) {
  return Number(value);
}
function validInt2(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function finiteNonNegative2(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function abortError() {
  return new DOMException("Order Walls archive request aborted", "AbortError");
}

// artifacts/pi-history-r1/head-boundary-r1/browser-entry.ts
async function run() {
  const h = 180000006e4, from = h - 6e4, to = h + 1, head2 = { cursor: 3, epoch: 1, at: h };
  const profile = { id: "binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1", version: 1, market: "spot", venue: "binance", instrument: "binance:spot:BTCUSDT", feed: "binance:spot:BTCUSDT:spot-diff-depth", aggregation: "native", bandPercent: 10, midpointBasis: "best-observed-bid-ask", topN: 10, algorithmVersion: 1, schemaVersion: 1, confirmationMs: 0, selectionTopN: 10, minimumNotionalUsd: null, exactDerivations: { bandPercent: [10], topNMax: 10, minimumNotional: true, confirmation: true, confirmationCrossings: false } };
  const request = { market: "spot", profile: profile.id, from, to }, settings = orderWallsSettings({ enabled: true, mode: "top-levels", topLevels: 8, searchRangePercent: 10 });
  const candidate = { entryId: "exact-head-wall", side: "bid", price: "100", quantity: "1", notional: "100", rank: 1, startedAt: h - 5e3, startCursor: 1, startEpoch: 1, startKnown: true };
  const page = {
    version: 1,
    profile,
    market: "spot",
    instrument: profile.instrument,
    feed: profile.feed,
    from,
    to,
    watermark: 3,
    head: head2,
    page: { after: 0, nextAfter: 3, hasMore: false, lastAt: h, limit: 4096, sameMillisecondClosed: true, observations: 3 },
    seed: { at: from - 1, cursor: 0, epoch: 1, midpoint: "100", bids: [], asks: [] },
    patches: [1, 2, 3].map((cursor) => ({ cursor, epoch: 1, at: cursor === 1 ? h - 5e3 : h, kind: "patch", midpoint: "100", bids: { upserts: [{ ...candidate, quantity: String(cursor), notional: String(cursor * 100) }], removals: [] }, asks: { upserts: [], removals: [] } })),
    coverage: { availableFrom: from - 1e3, requestedFrom: from, requestedTo: to, confirmedTo: h, status: "partial", partial: true, gaps: [{ at: from + 1e3, reason: "Explicit fixture gap" }] }
  };
  const hash2 = async (text2) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text2)))].map((n) => n.toString(16).padStart(2, "0")).join("");
  const text = JSON.stringify(page), digest3 = await hash2(text), source = { ...request, version: 1, kind: "wall-source-sha256-xor-v1", token: "a".repeat(64), eligible: true, watermark: 3, head: head2 };
  const manifest = { version: 5, key: "b".repeat(64), complete: true, request: { ...request, watermark: 3, sourceRevision: await hash2(JSON.stringify([digest3])) }, watermark: 3, head: head2, after: 3, sourceProof: source, parts: [{ index: 0, hash: digest3, canonicalHash: digest3, bytes: new TextEncoder().encode(text).length, after: 0, nextAfter: 3, encoding: "json-gzip-v1" }] };
  const calls = [], updates = [];
  const fetcher = async (input) => {
    const path = new URL(String(input), location.href).pathname;
    calls.push(path);
    if (path.endsWith("/discover")) return new Response(JSON.stringify({ state: "ready", source, manifest }));
    if (path.endsWith("/source")) return new Response(JSON.stringify(source));
    if (path.endsWith("/part")) return new Response(text);
    throw Error("Unexpected protocol route " + path);
  };
  const result = await loadOrderWallsArchive({ request: { market: "binance-spot", from, to, settings, watermark: 3, head: head2 }, fetcher, onUpdate: (update) => updates.push({ kind: update.kind, complete: update.status.archive?.requestComplete }) });
  const reference = new OrderWallsArchiveProjector(settings, from, to);
  reference.applyPage(page);
  if (JSON.stringify(result.segments) !== JSON.stringify(reference.snapshot())) throw Error("Financial reference mismatch");
  const last = result.segments.find((s) => s.archiveEntryId === candidate.entryId)?.valueRuns.at(-1);
  if (last?.at !== h || last.quantityExact !== "3" || result.status.archive?.confirmedTo !== h || result.status.archive?.requestComplete !== true || result.status.archive?.rangeComplete !== false || !result.status.archive.gaps.length) throw Error("Head, same-time quantity or explicit gap mismatch");
  const rejected = await preparedWallReader({ ...request, watermark: 3, head: { ...head2, at: h - 1 } }, fetcher, new AbortController().signal);
  if (rejected !== null) throw Error("Accepted a head one millisecond behind");
  return { scope: "Explicit deterministic headless Chromium/WebCrypto prepared-history protocol and shared-kernel reference check; not live venue, chart painting or latency acceptance", head: head2, requested: { from, to }, lastValue: last, coverage: result.status.archive, updates, calls, result: "pass" };
}
export {
  run
};

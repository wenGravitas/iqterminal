// src/feed/compact-wall-presentation.ts
var MAX_DECODED = 64 * 1024 * 1024;
var MAX_ENCODED = 16 * 1024 * 1024;
var MAX_PART = 1024 * 1024;
var TARGET = 128 * 1024;
var yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
var hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
var integer = (n) => Number.isSafeInteger(n) && Number(n) >= 0;
async function transform(bytes, compress, max, signal) {
  signal.throwIfAborted();
  const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  const reader = stream.getReader(), parts = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (; ; ) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Error("Compact wall cache byte capacity");
      parts.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
function metadataBound(value, omitRuns = false) {
  let bytes = 2048;
  for (const [key, item] of Object.entries(value)) {
    if (omitRuns && key === "valueRuns") continue;
    bytes += key.length * 6;
    if (typeof item === "string") bytes += item.length * 6;
    else if (item !== null && typeof item === "object") throw Error("Compact wall cache metadata capacity");
    if (bytes > MAX_PART) throw Error("Compact wall cache fragment capacity");
  }
  return bytes;
}
async function compactWallPresentation(identity, segments, signal) {
  if (typeof CompressionStream !== "function" || !identity || identity.length > 8192 || segments.length > 1e5) throw Error("Compact wall cache unavailable or capacity");
  const result = { version: 1, identity, segments: segments.length, runs: 0, bytes: 0, retainedBytes: 0, decodedBytes: 0, chunks: [] };
  let rows = [], size = 2, yielded = performance.now();
  const flush = async () => {
    if (!rows.length) return;
    signal.throwIfAborted();
    const raw = new TextEncoder().encode("[" + rows.join(",") + "]");
    if (raw.length > MAX_PART || result.decodedBytes + raw.length > MAX_DECODED || result.chunks.length >= 1024) throw Error("Compact wall cache decoded capacity");
    const body = await transform(raw, true, MAX_ENCODED - result.bytes, signal);
    if (result.bytes + body.length > MAX_ENCODED) throw Error("Compact wall cache encoded capacity");
    result.chunks.push({ body, hash: await hash(raw), decodedBytes: raw.length, rows: rows.length });
    result.bytes += body.length;
    result.decodedBytes += raw.length;
    rows = [];
    size = 2;
    await yieldTask();
    signal.throwIfAborted();
    yielded = performance.now();
  };
  for (const [index, segment] of segments.entries()) {
    const total = segment.valueRuns.length, headerBytes = metadataBound(segment, true) + 128;
    result.runs += total;
    if (result.runs > 1e6) throw Error("Compact wall cache value capacity");
    let offset = 0;
    do {
      signal.throwIfAborted();
      let count = 0, bound = headerBytes;
      while (offset + count < total && count < 256) {
        const pointBytes = metadataBound(segment.valueRuns[offset + count]);
        if (headerBytes + pointBytes > MAX_PART) throw Error("Compact wall cache fragment capacity");
        if (count && bound + pointBytes > TARGET) break;
        bound += pointBytes;
        count++;
      }
      const row = { index, offset, total, segment: { ...segment, valueRuns: segment.valueRuns.slice(offset, offset + count) } }, text = JSON.stringify(row), bytes = new TextEncoder().encode(text).length;
      if (bytes + 2 > MAX_PART) throw Error("Compact wall cache fragment capacity");
      if (size + bytes + 1 > TARGET) await flush();
      rows.push(text);
      size += bytes + 1;
      offset += count;
      if (performance.now() - yielded >= 8) {
        await yieldTask();
        signal.throwIfAborted();
        yielded = performance.now();
      }
    } while (offset < total);
  }
  await flush();
  result.retainedBytes = result.bytes + result.chunks.length * 256 + identity.length * 2 + 256;
  if (result.retainedBytes > MAX_ENCODED) throw Error("Compact wall cache metadata capacity");
  return result;
}
async function replayCompactWallPresentation(value, identity, signal, publish) {
  if (value.version !== 1 || value.identity !== identity || !integer(value.segments) || value.segments > 1e5 || !integer(value.runs) || value.runs > 1e6 || !integer(value.bytes) || value.bytes > MAX_ENCODED || !integer(value.retainedBytes) || value.retainedBytes > MAX_ENCODED || !integer(value.decodedBytes) || value.decodedBytes > MAX_DECODED || !Array.isArray(value.chunks) || value.chunks.length > 1024) throw Error("Invalid compact wall cache identity");
  if (value.retainedBytes !== value.bytes + value.chunks.length * 256 + identity.length * 2 + 256) throw Error("Invalid compact wall cache retained total");
  let index = 0, runs = 0, decoded = 0, encoded = 0, pending, header;
  const ids = /* @__PURE__ */ new Set();
  for (const chunk of value.chunks) {
    signal.throwIfAborted();
    if (!(chunk.body instanceof Uint8Array) || !integer(chunk.decodedBytes) || chunk.decodedBytes < 2 || chunk.decodedBytes > MAX_PART || !integer(chunk.rows) || chunk.rows < 1) throw Error("Invalid compact wall cache chunk");
    encoded += chunk.body.length;
    decoded += chunk.decodedBytes;
    if (encoded > value.bytes || decoded > value.decodedBytes) throw Error("Invalid compact wall cache byte total");
    const raw = await transform(chunk.body, false, chunk.decodedBytes, signal);
    if (raw.length !== chunk.decodedBytes || await hash(raw) !== chunk.hash) throw Error("Compact wall cache content hash mismatch");
    const rows = JSON.parse(new TextDecoder().decode(raw)), ready = [];
    if (!Array.isArray(rows) || rows.length !== chunk.rows) throw Error("Invalid compact wall cache rows");
    for (const row of rows) {
      if (!row || row.index !== index || !integer(row.offset) || !integer(row.total) || row.total > 1e5 || !row.segment || typeof row.segment.id !== "string" || !Array.isArray(row.segment.valueRuns) || row.segment.valueRuns.length > 256) throw Error("Invalid compact wall cache fragment");
      const { valueRuns, ...meta } = row.segment, nextHeader = JSON.stringify(meta);
      if (!pending) {
        if (row.offset !== 0 || ids.has(row.segment.id)) throw Error("Invalid compact wall cache segment order");
        pending = { ...row, segment: { ...row.segment, valueRuns: [] } };
        header = nextHeader;
      }
      if (row.total !== pending.total || row.offset !== pending.segment.valueRuns.length || nextHeader !== header || row.offset + valueRuns.length > row.total || row.total > row.offset && !valueRuns.length) throw Error("Invalid compact wall cache fragment coverage");
      pending.segment.valueRuns.push(...valueRuns);
      if (pending.segment.valueRuns.length === pending.total) {
        ready.push(pending.segment);
        ids.add(pending.segment.id);
        runs += pending.total;
        if (runs > value.runs) throw Error("Invalid compact wall cache value total");
        pending = void 0;
        header = void 0;
        index++;
      }
    }
    signal.throwIfAborted();
    if (ready.length) publish(ready);
    await yieldTask();
  }
  signal.throwIfAborted();
  if (pending || index !== value.segments || runs !== value.runs || decoded !== value.decodedBytes || encoded !== value.bytes) throw Error("Incomplete compact wall cache coverage");
}

// src/feed/wall-history-presentation-cache.ts
var detached = (segment) => ({ ...segment, valueRuns: segment.valueRuns.map((point) => ({ ...point })) });
function wallHistoryPresentation(segments, prepared) {
  if (prepared && (prepared.size !== segments.length || segments.some((segment) => !prepared.has(segment.id)))) return;
  return new Map(segments.map((segment) => {
    const raw = prepared?.get(segment.id);
    return [segment.id, raw && raw.end !== null ? raw : detached(segment)];
  }));
}
function wallCompactPresentation(segments, prepared) {
  if (prepared.size !== segments.length || segments.some((segment) => !prepared.has(segment.id))) return;
  return new Map(segments.map((segment) => {
    const raw = prepared.get(segment.id);
    return [segment.id, raw.end !== null ? raw : { ...segment, valueRuns: raw.valueRuns }];
  }));
}

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
  const identity = JSON.stringify([options.key, options.revision, parts]);
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
          work.slots.get(part.index).resolve({ response: i === 0 ? response : new Response(null, { headers }), body, bytes: part.bytes, responseHeadersMs: i === 0 ? responseHeadersMs : 0, bodyReadMs, jsonParseMs, attempts: attempt });
        }
      } finally {
        upstream.removeEventListener("abort", cancelReader);
        if (!complete) await reader.cancel().catch(() => {
        });
        reader.releaseLock();
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
      const sequence2 = v.valueRunOrder[i][j];
      if (!isRecord(point) || !finiteNonNegative(point.at) || point.percentile !== null || !validInt(point.rank) || point.rank < 1 || point.rank > 10 || !validDecimal(point.quantityExact) || !validDecimal(point.notionalExact) || point.quantity !== Number(point.quantityExact) || point.usd !== Number(point.notionalExact) || !finiteNonNegative(point.quantity) || !finiteNonNegative(point.usd) || !validInt(sequence2) || sequence2 < 1 || sequence2 > v.nextValueRunSequence || sequences.has(sequence2)) fail();
      sequences.add(sequence2);
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

// src/feed/prepared-wall-projection.ts
var integer2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var digest2 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
var normalized = (s) => ({ topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs });
var yieldTask2 = () => new Promise((resolve) => setTimeout(resolve, 0));
async function readPreparedWallProjection(advertised, context, onProgress) {
  if (!advertised) return null;
  const { manifest: m, delivery } = advertised;
  if (m?.core !== WALL_PROJECTION_CORE_SHA256 || JSON.stringify(m.settings) !== JSON.stringify(normalized(context.settings))) return null;
  if (delivery?.version !== 1 || delivery.maxParts !== 32 || delivery.maxDecodedBytes !== 8 * 1024 * 1024) return null;
  if (m.version !== 2 || !hex(m.key) || !m.complete || m.sourceKey !== context.sourceKey || m.sourceToken !== context.sourceToken || m.profile?.id !== context.profile || m.profile.market !== context.market || m.active?.from !== context.from || m.active.to !== context.to || m.active.cursor !== context.watermark || m.active.epoch !== context.epoch || !Array.isArray(m.parts) || m.parts.length > 512 || !Array.isArray(m.closed) || m.closed.length > 1e5 || !Array.isArray(m.activeOrder) || m.activeOrder.length !== m.active.segments?.length || m.closed.length + m.activeOrder.length > 1e5 || await digest2(new TextEncoder().encode(JSON.stringify({ version: 2, sourceKey: context.sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalized(context.settings) }))) !== m.key) throw Error("Invalid prepared wall projection identity");
  if (context.outputHead && ![context.outputHead.cursor, context.outputHead.epoch].every(integer2)) throw Error("Invalid prepared wall output fence");
  const manifest = m, hashes = /* @__PURE__ */ new Set();
  let decodedBytes = 0;
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
  OrderWallsArchiveProjector.restoreCheckpoint(manifest.active, context.settings, context.from, context.to);
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
    const url = "/market-data/v2/history/walls/projection-batch?" + new URLSearchParams({ market: context.market, key: manifest.key, start: String(start), version: "1" });
    return { selected, next: start + selected.length, handle: acquireWallBatch({ url, key: manifest.key, revision: manifest.sourceToken, parts: selected, fetcher: context.fetcher, signal: context.signal, maxParts: 32 }) };
  }
  let current = acquire(0), next;
  try {
    while (current) {
      context.signal.throwIfAborted();
      next = acquire(current.next);
      for (const part of current.selected) {
        const fetched = await current.handle.read(part.index), rows = fetched.body;
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
            if (record.offset !== count || record.totalRuns !== first.totalRuns || record.order !== first.order || !integer2(record.order) || record.segment.end === null || JSON.stringify(header) !== JSON.stringify(nextHeader) || !Array.isArray(valueRuns) || record.valueRunOrder?.length !== valueRuns.length) throw Error("Prepared wall projection fragment identity mismatch");
            count += valueRuns.length;
          }
          if (count !== first.totalRuns) throw Error("Prepared wall projection fragment coverage mismatch");
          const completed = { order: first.order, segment: { ...first.segment, valueRuns: group.flatMap((record) => record.segment.valueRuns) }, valueRunOrder: group.flatMap((record) => record.valueRunOrder) };
          ready.push(completed);
          retained.push(completed);
          fragments[coordinate.group] = [];
          if (performance.now() - yielded >= 8) {
            const before = performance.now();
            await yieldTask2();
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
        onProgress({ segments: ready.map((row) => row.segment), presentation, presentationThrough: manifest.active.confirmedTo, parts, bytes, decodeMs, mergeMs, metrics: { attempts: fetched.attempts, responseHeadersMs: fetched.responseHeadersMs, bodyReadMs: fetched.bodyReadMs, jsonParseMs: fetched.jsonParseMs, mergeMs: partMergeMs, yieldMs, encodedBytes: Number(fetched.response.headers.get("content-length") ?? 0), requestId: fetched.response.headers.get("x-iq-request-id") ?? void 0 } });
        await yieldTask2();
      }
      current.handle.release();
      current = next;
      next = void 0;
    }
  } finally {
    current?.handle.release();
    next?.handle.release();
  }
  if (retained.length !== manifest.closed.length + manifest.active.segments.length || new Set(retained.map((record) => record.order)).size !== retained.length) throw Error("Prepared wall projection incomplete identities");
  retained.sort((a, b) => a.order - b.order);
  context.signal.throwIfAborted();
  const projector = OrderWallsArchiveProjector.restoreCheckpoint({ ...manifest.active, ...context.outputHead ?? {}, segments: retained.map((row) => row.segment), valueRunOrder: retained.map((row) => row.valueRunOrder) }, context.settings, context.from, context.to);
  return { projector, coverage: manifest.coverage, profile: manifest.profile, presentation, parts, bytes, decodeMs, mergeMs };
}

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
var integer3 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function progress(raw, request) {
  const r = raw?.request;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw.id ?? "") || !r || r.market !== request.market || r.profile !== request.profile || r.from !== request.from || r.to !== request.to || !["source", "canonical", "projection", "ready"].includes(raw.phase) || !["building", "paused", "failed", "ready"].includes(raw.state) || !integer3(raw.pages) || raw.pages > 128 || !integer3(raw.projectionPages) || raw.projectionPages > 128 || raw.state === "ready" && raw.phase !== "ready" || raw.retryable !== void 0 && typeof raw.retryable !== "boolean" || raw.category !== void 0 && !["source-changed", "source-unavailable", "capacity", "invalid-content", "query"].includes(raw.category)) throw Error("Invalid wall preparation progress identity");
  let sourceCoverage;
  if (raw.coverage) {
    const c = raw.coverage;
    if (![c.availableFrom, c.confirmedTo].every((v) => v === null || integer3(v)) || !integer3(c.gapCount) || typeof c.gapsTruncated !== "boolean") throw Error("Invalid wall preparation source coverage");
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
          await response.body?.cancel();
          if (response.status === 404) return null;
          throw Error("Prepared wall discovery HTTP " + response.status);
        }
        return options.decode(response, projection ? 8 * 1024 * 1024 : 128 * 1024);
      });
      signal.throwIfAborted();
      if (!found?.preparation) return found;
      leased = true;
      const p = found.preparation;
      if (p.version !== 1 || !integer3(p.leaseMs) || p.leaseMs < 1e3 || p.leaseMs > 6e4 || !integer3(p.pollMs) || p.pollMs < 250 || p.pollMs > 2e3 || p.pollMs * 2 > p.leaseMs) throw Error("Invalid wall preparation polling bounds");
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

// src/feed/prepared-wall-history.ts
var integer4 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var hex2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var head = (value) => value && [value.cursor, value.epoch, value.at].every(integer4);
var sameRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function sourceFitsFence(manifest, source, target) {
  if (target.cursor >= manifest.watermark) return true;
  const anchor = source.anchor, stored = manifest.sourceProof.anchor, max = source.maxCursor;
  return typeof max === "number" && integer4(max) && max <= target.cursor && manifest.sourceProof.maxCursor === max && anchor && stored && integer4(anchor.cursor) && anchor.cursor <= target.cursor && integer4(anchor.epoch) && integer4(anchor.at) && anchor.at < manifest.request.from && hex2(anchor.hash) && anchor.cursor === stored.cursor && anchor.epoch === stored.epoch && anchor.at === stored.at && anchor.hash === stored.hash && manifest.parts.every((part, index) => part.after <= target.cursor && (index === manifest.parts.length - 1 || part.nextAfter <= target.cursor));
}
var hash2 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
var sourceUrl = (path, r) => "/market-data/v2/history/walls/" + path + "?" + new URLSearchParams({ market: r.market, profile: r.profile, from: String(r.from), to: String(r.to) });
function validSource(value, r) {
  return value?.version === 1 && value.kind === "wall-source-sha256-xor-v1" && value.eligible === true && hex2(value.token) && sameRequest(value, r) && integer4(value.watermark) && head(value.head) && value.head.cursor === value.watermark && value.head.at >= r.to;
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
  if (expectedHash && await hash2(bytes) !== expectedHash) throw Error("Prepared wall part content hash mismatch");
  const bodyReadMs = performance.now() - start, parse = performance.now();
  const body = JSON.parse(new TextDecoder().decode(bytes));
  return { body, bytes: bytes.byteLength, bodyReadMs, jsonParseMs: performance.now() - parse };
}
async function validateManifest(value, source, r) {
  if (value?.version !== 5 || !hex2(value.key) || value.complete !== true || !sameRequest(value.request ?? {}, r) || !validSource(value.sourceProof, r) || value.sourceProof.token !== source.token || !integer4(value.watermark) || value.watermark > source.watermark || value.request.watermark !== value.watermark || value.sourceProof.watermark !== value.watermark || !head(value.head) || value.head.cursor !== value.watermark || value.head.at < r.to || JSON.stringify(value.head) !== JSON.stringify(value.sourceProof.head) || value.after !== value.watermark || !hex2(value.request.sourceRevision) || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 128) throw Error("Invalid prepared wall manifest identity");
  for (let i = 0; i < value.parts.length; i++) {
    const part = value.parts[i];
    if (part.index !== i || !hex2(part.hash) || !hex2(part.canonicalHash) || !integer4(part.bytes) || part.bytes < 1 || part.bytes > 4 * 1024 * 1024 || !integer4(part.after) || !integer4(part.nextAfter) || part.nextAfter < part.after || part.nextAfter > value.watermark || i && part.after !== value.parts[i - 1].nextAfter || i < value.parts.length - 1 && part.nextAfter <= part.after) throw Error("Invalid prepared wall part chain");
  }
  if (value.parts.at(-1).nextAfter !== value.watermark || await hash2(new TextEncoder().encode(JSON.stringify(value.parts.map((p) => p.canonicalHash)))) !== value.request.sourceRevision) throw Error("Invalid prepared wall manifest revision");
  return value;
}
function rebasePreparedWallPage(raw, manifest, part, target) {
  if (!sameRequest({ ...raw, profile: raw?.profile?.id }, manifest.request) || raw.profile?.id !== manifest.request.profile || raw.watermark !== manifest.watermark || JSON.stringify(raw.head) !== JSON.stringify(manifest.head) || raw.page?.after !== part.after || raw.page.nextAfter !== part.nextAfter || raw.page.hasMore !== part.index < manifest.parts.length - 1) throw Error("Prepared wall page identity mismatch");
  if (!sourceFitsFence(manifest, manifest.sourceProof, target) || target.at < manifest.request.to) throw Error("Prepared wall source fence cannot cover request");
  if (target.cursor < manifest.watermark && (raw.patches?.some((patch) => !integer4(patch.cursor) || patch.cursor > target.cursor) || raw.seed && (!integer4(raw.seed.cursor) || raw.seed.cursor > target.cursor))) throw Error("Prepared wall financial input exceeds bootstrap fence");
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
  if (!head(target) || target.cursor !== (request.watermark ?? source.watermark) || !sourceFitsFence(manifest, source, target) || target.cursor > source.watermark || target.at < request.to) {
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
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("Prepared wall source validation HTTP " + response.status);
      }
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
      validateProfile
    }, (value) => {
      assertActive();
      onProgress(value);
    }).catch(leaseFailure);
    if (result) {
      await validateRevision();
    }
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

// src/feed/history-trace.ts
var sessionId = crypto.randomUUID();
var sequence = 0;
var historyViewId = () => `view-${sessionId}-${++sequence}`;

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
var ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL = 64;
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
function orderWallsArchiveIdentity(request) {
  const settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  if (!availability.profileId || !availability.market) return void 0;
  const identity = expectedProfile(request, settings, availability);
  return JSON.stringify([
    identity.id,
    identity.market,
    identity.instrument,
    identity.feed,
    identity.aggregation,
    identity.bandPercent,
    10,
    1,
    1,
    settings.topLevels,
    settings.minimumNotionalEnabled ? settings.minimumNotionalUsd : null,
    settings.minDurationMs
  ]);
}
function orderWallsArchiveCurrentRequest(request, after = 0) {
  const settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  if (settings.mode !== "top-levels" || !availability.profileId || !availability.market) return void 0;
  const expected = expectedProfile(request, settings, availability);
  return {
    profile: expected.id,
    market: expected.market,
    instrument: expected.instrument,
    aggregation: expected.aggregation,
    bandPercent: expected.bandPercent,
    confirmationMs: expected.confirmationMs,
    selectionTopN: expected.selectionTopN,
    minimumNotionalUsd: expected.minimumNotionalUsd,
    after,
    limit: ORDER_WALL_ARCHIVE_PAGE_LIMIT
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
  const prepared = !after || prior?.preparedSourceToken ? await preparedWallReader({
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
          validationMs: 0,
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
        const result = { kind: "snapshot", segments: projected.projector.snapshot(), projector: projected.projector, presentation: projected.presentation, preparedPresentationComplete: true, preparedSourceToken: prepared.sourceToken, status: statusForArchive(archive, state, coverage.reason), watermark: head2.cursor, head: head2, cursor: head2.cursor, pages: projected.parts, bytes: projected.bytes };
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
      if (true) params.set("display", "1");
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
      const validationMs = performance.now() - validationStartedAt;
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
var OrderWallsArchiveCurrentPoller = class {
  constructor(options) {
    this.options = options;
    this.after = options.request.after;
  }
  after;
  timer;
  abort;
  stopped = true;
  busy = false;
  failures = 0;
  watermark;
  synced = false;
  stats = { polls: 0, pages: 0, patches: 0, bytes: 0, failures: 0, yieldedPolls: 0, lastPollMs: 0, cursor: 0 };
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.abort = new AbortController();
    void this.poll();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = void 0;
    this.abort?.abort();
    this.abort = void 0;
  }
  async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    this.stats.polls++;
    const started = (this.options.now ?? Date.now)();
    const abort = this.abort ?? new AbortController();
    this.abort = abort;
    let watermark, yielded = false;
    let pagesThisPoll = 0;
    const bytesAtStart = this.stats.bytes;
    const maxPages = Math.max(1, Math.min(
      ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL,
      Math.floor(this.options.maxPagesPerPoll ?? ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL)
    ));
    try {
      const expected = expectedProfileFromCurrent(this.options.request);
      let page = await readCurrentPage(this.options.request, this.after, void 0, abort.signal, this.options.fetcher);
      if (this.after > 0 && page.watermark < this.after) {
        const reason = "Order Walls profile cursor reset; a new current state is required.";
        this.options.onReset?.(reason);
        this.after = 0;
        this.watermark = void 0;
        page = await readCurrentPage(this.options.request, 0, void 0, abort.signal, this.options.fetcher);
      }
      watermark = page.watermark;
      let watermarkHead;
      for (; ; ) {
        validateCurrentPage(page, expected, this.after, watermark, watermarkHead);
        if (!watermarkHead) watermarkHead = page.head;
        if (!watermarkHead) throw new Error("Order Walls current page omitted its fixed-watermark head");
        const normalizedPage = page.head === watermarkHead ? page : { ...page, head: watermarkHead };
        if (normalizedPage.coverage) {
          normalizedPage.coverage = {
            ...normalizedPage.coverage,
            // The head is fixed for this whole response batch, but a partial
            // page has only consumed patches through its own last event.
            confirmedTo: Math.min(
              normalizedPage.coverage.confirmedTo ?? watermarkHead.at,
              normalizedPage.page.hasMore ? normalizedPage.page.lastAt ?? watermarkHead.at : watermarkHead.at,
              watermarkHead.at
            ),
            gaps: (normalizedPage.coverage.gaps ?? []).filter((gap) => (gap.from ?? gap.at ?? 0) <= watermarkHead.at)
          };
        }
        this.stats.pages++;
        pagesThisPoll++;
        this.stats.patches += normalizedPage.patches.length;
        this.stats.bytes += normalizedPage.__bytes ?? 0;
        this.options.onPage(normalizedPage);
        if (!page.page.hasMore) {
          this.after = page.page.nextAfter;
          this.watermark = watermark;
          this.stats.cursor = this.after;
          break;
        }
        this.after = page.page.nextAfter;
        this.stats.cursor = this.after;
        if (pagesThisPoll >= maxPages || this.stats.bytes - bytesAtStart >= ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_POLL) {
          this.watermark = watermark;
          yielded = true;
          this.stats.yieldedPolls++;
          break;
        }
        page = await readCurrentPage(this.options.request, this.after, watermark, abort.signal, this.options.fetcher);
      }
      if (yielded) this.options.onStatus?.({
        state: watermarkHead?.valid ? "catching-up" : "stale",
        sourceValid: watermarkHead?.valid,
        message: watermarkHead?.valid ? "Current selected-profile tail is catching up through bounded cursor batches." : "Current source continuity is not confirmed."
      });
      else if (!this.synced) {
        this.synced = true;
        const head2 = watermarkHead;
        this.options.onSynced?.({ cursor: watermark, at: head2.at, epoch: head2.epoch });
      }
      this.failures = 0;
      if (!yielded) {
        const sourceValid = watermarkHead?.valid === true;
        if (sourceValid) this.options.onStatus?.({ state: "ready", sourceValid: true });
        else {
          const unavailable = page.coverage?.status === "unavailable";
          this.options.onStatus?.({
            state: unavailable ? "unavailable" : "stale",
            sourceValid: false,
            message: page.coverage?.reason ?? "Current source continuity is not confirmed."
          });
        }
      }
    } catch (error) {
      if (!abort.signal.aborted && !this.stopped) {
        this.failures++;
        this.stats.failures++;
        const message = errorText(error);
        this.options.onStatus?.({ state: this.failures >= 5 ? "unavailable" : "stale", message });
        const wait = Math.min(15e3, 500 * 2 ** Math.min(this.failures - 1, 5));
        this.busy = false;
        this.timer = setTimeout(() => void this.poll(), wait);
        return;
      }
    } finally {
      this.stats.lastPollMs = Math.max(0, (this.options.now ?? Date.now)() - started);
      this.busy = false;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), yielded ? 0 : this.options.intervalMs ?? 1e3);
  }
};
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
async function readCurrentPage(request, after, watermark, signal, fetcher = (...args) => fetch(...args)) {
  const params = new URLSearchParams({
    profile: request.profile,
    market: request.market,
    after: String(after),
    limit: String(Math.max(1, Math.min(ORDER_WALL_ARCHIVE_PAGE_LIMIT, Math.floor(request.limit ?? ORDER_WALL_ARCHIVE_PAGE_LIMIT))))
  });
  if (watermark !== void 0) params.set("watermark", String(watermark));
  const response = await fetcher(`/market-data/v1/order-walls/archive/current?${params}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e3)]) : AbortSignal.timeout(12e3)
  });
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE) throw new Error("Order Walls current page exceeded its response-size limit");
  let body, bytes;
  try {
    const text = await response.text();
    bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE) throw new Error("Order Walls current page exceeded its response-size limit");
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.message.includes("response-size limit")) throw error;
    throw new Error(`Order Walls current HTTP ${response.status} returned invalid JSON`);
  }
  if (!response.ok) throw new Error(isRecord2(body) && typeof body.error === "string" ? body.error : `Order Walls current HTTP ${response.status}`);
  if (isRecord2(body)) body.__bytes = declaredBytes || bytes;
  return body;
}
function expectedProfileFromCurrent(request) {
  return {
    id: request.profile,
    market: request.market,
    instrument: request.instrument,
    feed: preparedDepthFeed(request.market),
    aggregation: request.aggregation,
    bandPercent: request.bandPercent,
    confirmationMs: request.confirmationMs ?? 0,
    selectionTopN: request.selectionTopN ?? 10,
    minimumNotionalUsd: request.minimumNotionalUsd ?? null
  };
}
function validateCurrentPage(page, expected, after, watermark, expectedHead) {
  const head2 = page.head;
  if (!page || page.version !== 1 || !profileBasisMatches(page.profile, expected) || page.market !== expected.market || page.instrument !== expected.instrument || page.feed !== expected.feed || !validInt2(page.watermark) || page.watermark !== watermark || !head2 || typeof head2.valid !== "boolean" || !expectedHead && (!validInt2(head2.cursor) || head2.cursor !== page.watermark || !validInt2(head2.epoch) || !finiteNonNegative2(head2.at) || !(head2.midpoint === null || validDecimal2(head2.midpoint))) || expectedHead && !sameCurrentHead(head2, expectedHead) || !page.page || page.page.after !== after || !validInt2(page.page.after) || !validInt2(page.page.nextAfter) || !(page.page.lastAt === null || finiteNonNegative2(page.page.lastAt)) || !validInt2(page.page.limit) || typeof page.page.hasMore !== "boolean" || page.page.hasMore && page.page.lastAt === null || page.page.sameMillisecondClosed !== true || !Array.isArray(page.patches) || page.profileStatus !== void 0 && !isArchiveProfileStatus(page.profileStatus)) throw new Error("Invalid Order Walls current page contract");
  if (after === 0) {
    if (!page.state || !Array.isArray(page.state.bids) || !Array.isArray(page.state.asks) || page.patches.length || page.page.hasMore || page.page.nextAfter !== watermark || !page.state.bids.every((candidate) => validCandidate2(candidate) && candidate.side === "bid") || !page.state.asks.every((candidate) => validCandidate2(candidate) && candidate.side === "ask")) throw new Error("Invalid Order Walls current bootstrap state");
    return;
  }
  if (page.state !== void 0) throw new Error("Order Walls current delta page must not replace its bootstrap state");
  let previousCursor = after;
  for (const patch of page.patches) {
    if (!validArchivePatch(patch) || patch.cursor <= after || patch.cursor <= previousCursor || patch.cursor > watermark) throw new Error("Invalid Order Walls current patch ordering");
    if ([...patch.bids.upserts, ...patch.asks.upserts].some((candidate) => candidate.confirmationAt !== void 0 && candidate.confirmationAt !== null && candidate.confirmationAt > patch.at)) throw new Error("Order Walls current candidate confirmation exceeds its observation time");
    previousCursor = patch.cursor;
  }
  if (page.page.hasMore) {
    if (!page.patches.length || page.page.nextAfter !== page.patches.at(-1).cursor || page.page.nextAfter <= after) throw new Error("Invalid Order Walls current continuation cursor");
  } else if (page.page.nextAfter !== watermark) throw new Error("Invalid Order Walls current final cursor");
}
function sameCurrentHead(a, b) {
  return a.cursor === b.cursor && a.at === b.at && a.epoch === b.epoch && a.midpoint === b.midpoint && a.valid === b.valid && canonicalJson(a.bookScope ?? null) === canonicalJson(b.bookScope ?? null);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord2(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? String(value);
}
function validArchivePatch(value) {
  return isRecord2(value) && ["patch", "gap"].includes(String(value.kind)) && validInt2(value.cursor) && validInt2(value.epoch) && finiteNonNegative2(value.at) && (value.midpoint === null || validDecimal2(value.midpoint)) && validSidePatch(value.bids) && validSidePatch(value.asks) && (value.kind !== "gap" || typeof value.reason === "string");
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

// src/feed/order-walls-archive-service.ts
var MAX_CURRENT_RING_PAGES = 4096;
var MAX_CURRENT_RING_PATCHES = 1e5;
var MAX_CURRENT_RING_BYTES = 16 * 1024 * 1024;
var MAX_SUBSCRIPTION_ARCHIVE_GAPS = 256;
var OrderWallsArchiveService = class {
  constructor(emit, request = (...args) => fetch(...args), now = Date.now, compactPreparedAboveBytes = 16 * 1024 * 1024) {
    this.emit = emit;
    this.request = request;
    this.now = now;
    this.compactPreparedAboveBytes = compactPreparedAboveBytes;
    if (!Number.isSafeInteger(compactPreparedAboveBytes) || compactPreparedAboveBytes < 0 || compactPreparedAboveBytes > 16 * 1024 * 1024) throw Error("Invalid compact wall threshold");
  }
  subscriptions = /* @__PURE__ */ new Map();
  groups = /* @__PURE__ */ new Map();
  /** Same fixed profile/range/fence shares one bounded loader and projector. */
  historyJobs = /* @__PURE__ */ new Map();
  warmHistory = /* @__PURE__ */ new Map();
  warmReplays = /* @__PURE__ */ new Set();
  warmBuilds = /* @__PURE__ */ new Set();
  warmBuildTail = Promise.resolve();
  warmTimings = [];
  recordWarmTiming(timing) {
    this.warmTimings.push(timing);
    if (this.warmTimings.length > 16) this.warmTimings.shift();
  }
  sequence = 0;
  disposed = false;
  stats = {
    warmAdmissions: 0,
    warmCapacityMisses: 0,
    warmInvalidMisses: 0,
    warmCompactBuilds: 0,
    warmRevisionReuses: 0,
    warmBuildFailures: 0,
    warmDecodeFailures: 0,
    incrementalSegments: 0,
    fullReconciliations: 0,
    comparisonVisits: 0,
    subscriptions: 0,
    groups: 0,
    historyRequests: 0,
    currentPages: 0,
    historyPages: 0,
    bytes: 0,
    historyBytes: 0,
    historyResponseHeadersMs: 0,
    historyBodyReadMs: 0,
    historyJsonParseMs: 0,
    historyValidationMs: 0,
    historyProjectorApplyMs: 0,
    historyUpdateCallbackMs: 0,
    historyEventLoopYieldDelayMs: 0,
    currentPatches: 0,
    ringDrops: 0,
    failures: 0
  };
  historyPageMetrics = [];
  historyPageMetricCount = 0;
  command(command) {
    if (command.type === "order-wall-subscribe") this.subscribe(command.id, command.request);
    else if (command.type === "order-wall-unsubscribe") this.unsubscribe(command.id);
    else if (command.type === "order-wall-retry") this.retry(command.id);
    else if (command.type === "order-wall-settings") this.updateSettings(command.id, command.settings);
    else this.updateViewport(command.id, command.from, command.to, command.to >= this.now() - 6e4);
  }
  subscribe(id, rawRequest) {
    this.unsubscribe(id);
    const settings = orderWallsSettings(rawRequest.settings);
    const request = { ...rawRequest, settings };
    const identity = orderWallsArchiveIdentity(request) ?? `${request.market}:${JSON.stringify(settings)}`;
    const sub = {
      id,
      key: identity,
      generation: ++this.sequence,
      batch: 0,
      request,
      settings,
      viewport: { from: request.from, to: request.to, followLive: request.followLive },
      currentState: "loading",
      currentGaps: [],
      currentGapsTruncated: false,
      archiveStarted: false,
      initialPublished: false,
      continuityLost: false,
      lastPublished: /* @__PURE__ */ new Map()
    };
    this.subscriptions.set(id, sub);
    this.stats.subscriptions = this.subscriptions.size;
    this.publish(sub, "snapshot", [], this.status(sub));
    if (settings.mode !== "top-levels") {
      sub.currentState = "unavailable";
      sub.currentMessage = "Threshold Walls use the existing raw depth service.";
      this.publish(sub, "snapshot", [], this.status(sub));
      return;
    }
    if (!request.currentOnly) this.showWarmHistory(sub);
    if (request.followLive) this.attachCurrentGroup(sub);
    else void this.loadHistory(sub);
  }
  updateSettings(id, settings) {
    const sub = this.subscriptions.get(id);
    if (!sub) return;
    this.subscribe(id, { ...sub.request, settings: orderWallsSettings(settings) });
  }
  updateViewport(id, from, to, followLive) {
    const sub = this.subscriptions.get(id);
    if (!sub || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
    const nextViewport = { from, to, followLive: followLive ?? to >= this.now() - 6e4 };
    const previousViewport = sub.viewport;
    sub.viewport = nextViewport;
    if (from >= sub.request.from && to <= sub.request.to) {
      const loading = !sub.archiveStarted || sub.historyJob && !sub.historyJob.settled;
      const beforeVisible = (sub.historyStatus?.archive?.loadedThrough ?? sub.request.from) < from;
      if (loading && beforeVisible && to - from < (sub.request.to - sub.request.from) * 0.75) {
        if (!sub.archiveStarted) {
          sub.request = { ...sub.request, ...nextViewport };
          sub.pendingViewport = void 0;
          return;
        }
        this.subscribe(id, { ...sub.request, ...nextViewport });
        return;
      }
      sub.pendingViewport = void 0;
      return;
    }
    if (canCoalesceLiveViewport(previousViewport, nextViewport)) {
      sub.pendingViewport = nextViewport;
      if (sub.historyJob?.settled) this.tryStartPendingViewportHistory(sub);
      return;
    }
    this.subscribe(id, { ...sub.request, ...nextViewport });
  }
  retry(id) {
    const sub = this.subscriptions.get(id);
    if (!sub) return;
    const job = sub.historyJob;
    if (job) {
      if (!job.settled) return;
      {
        job.preparationRetryToken = crypto.randomUUID();
        job.abort = new AbortController();
        job.settled = false;
        for (const subscriber of job.subscribers) {
          const previous = subscriber.historyStatus ?? job.latest?.status;
          const previousArchive = previous?.archive ?? emptyArchiveStatus(job.request, "partial");
          subscriber.historyStatus = {
            ...previous ?? { state: "loading" },
            state: "loading",
            message: job.resume ? "Resuming the validated Order Walls history prefix." : "Retrying Order Walls history with displayed data retained.",
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true },
            archive: {
              ...previousArchive,
              state: "loading",
              requestComplete: false,
              rangeComplete: false,
              resumeAfter: void 0,
              retryable: void 0,
              reason: void 0
            }
          };
          this.publish(subscriber, "patch", [], this.status(subscriber));
        }
        if (!job.resume) {
          for (const subscriber of job.subscribers) if (subscriber.historyProjector || subscriber.historyPresentation?.size) subscriber.cachedHistory = true;
        }
        this.runHistoryJob(job, job.resume);
        return;
      }
    }
    this.subscribe(id, sub.request);
  }
  unsubscribe(id) {
    const sub = this.subscriptions.get(id);
    if (!sub) return;
    this.subscriptions.delete(id);
    this.releaseWarmReplay(sub);
    const historyJob = sub.historyJob;
    sub.historyJob = void 0;
    if (historyJob) {
      historyJob.subscribers.delete(sub);
      if (!historyJob.subscribers.size) {
        this.historyJobs.delete(historyJob.key);
        if (!historyJob.settled) historyJob.abort.abort();
      }
    }
    if (sub.group) {
      const group = sub.group;
      group.subscribers.delete(sub);
      sub.group = void 0;
      if (!group.subscribers.size) {
        group.poller.stop();
        this.groups.delete(group.key);
      }
    }
    this.stats.subscriptions = this.subscriptions.size;
    this.stats.groups = this.groups.size;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const sub of [...this.subscriptions.values()]) this.unsubscribe(sub.id);
    for (const group of this.groups.values()) group.poller.stop();
    this.groups.clear();
    this.stats.groups = 0;
    for (const build of this.warmBuilds) build.abort.abort();
    for (const entry of this.warmHistory.values()) clearTimeout(entry.timer);
    this.warmHistory.clear();
  }
  diagnostics() {
    const projectors = /* @__PURE__ */ new Set();
    for (const sub of this.subscriptions.values()) for (const p of [sub.historyProjector, sub.tailProjector, sub.bridgeProjector]) if (p) projectors.add(p);
    for (const group of this.groups.values()) if (group.projector) projectors.add(group.projector);
    for (const job of this.historyJobs.values()) for (const p of [job.initialProjector, job.latest?.projector, job.resume?.projector]) if (p) projectors.add(p);
    return {
      ...this.stats,
      projections: [...projectors].map((projector) => projector.diagnostics()),
      subscriptions: this.subscriptions.size,
      groups: this.groups.size,
      historyJobs: this.historyJobs.size,
      readerControl: wallReadControlScheduler.diagnostics(),
      warmTimings: this.warmTimings.map((timing) => ({ ...timing })),
      warmEntries: this.warmHistory.size,
      warmBuilds: this.warmBuilds.size,
      warmReplayJobs: this.warmReplays.size,
      warmReplaySegments: [...this.warmHistory.values()].reduce((n, entry) => n + (entry.replay?.presentation.size ?? 0), 0),
      warmReplayRuns: [...this.warmHistory.values()].reduce((n, entry) => n + (entry.replay?.runs ?? 0), 0),
      warmCompactEntries: [...this.warmHistory.values()].filter((entry) => entry.compact).length,
      warmReplayConsumers: [...this.warmHistory.values()].reduce((n, entry) => n + (entry.replay?.subscribers.size ?? 0), 0),
      warmSegments: [...this.warmHistory.values()].reduce((n, entry) => n + entry.segments, 0),
      warmRuns: [...this.warmHistory.values()].reduce((n, entry) => n + entry.runs, 0),
      warmBytes: [...this.warmHistory.values()].reduce((n, entry) => n + entry.bytes, 0),
      historyConsumers: [...this.historyJobs.values()].reduce((sum, job) => sum + job.subscribers.size, 0),
      ringPages: [...this.groups.values()].reduce((sum, group) => sum + group.pages.length, 0),
      ringBytes: [...this.groups.values()].reduce((sum, group) => sum + group.ringBytes, 0),
      recentHistoryRequests: this.historyPageMetrics.slice(-16),
      historyPageTiming: summarizeArchivePageTimings(this.historyPageMetrics, this.historyPageMetricCount)
    };
  }
  attachCurrentGroup(sub) {
    const request = orderWallsArchiveCurrentRequest(sub.request, 0);
    if (!request) {
      sub.currentState = "unavailable";
      sub.currentMessage = "No exact current Top Levels archive profile exists for these settings.";
      this.publish(sub, "snapshot", [], this.status(sub));
      return;
    }
    const key = JSON.stringify([
      request.profile,
      request.market,
      request.instrument,
      request.aggregation,
      request.bandPercent,
      request.confirmationMs,
      request.selectionTopN,
      request.minimumNotionalUsd
    ]);
    let group = this.groups.get(key);
    if (!group) {
      const groupSettings = profileSettings(request);
      let created;
      const poller = new OrderWallsArchiveCurrentPoller({
        request,
        fetcher: this.request,
        onPage: (page) => this.onCurrentPage(created, page),
        onReset: (reason) => this.onCurrentReset(created, reason),
        onStatus: (status) => this.onCurrentStatus(created, status)
      });
      created = {
        key,
        request,
        settings: groupSettings,
        poller,
        subscribers: /* @__PURE__ */ new Set(),
        cursor: 0,
        pages: [],
        ringBytes: 0,
        ringPatches: 0,
        ringFloorCursor: 0,
        ringOverflow: false,
        profileExact: false,
        currentValid: false,
        currentCatchingUp: true
      };
      group = created;
      this.groups.set(key, group);
      group.poller.start();
    }
    sub.group = group;
    group.subscribers.add(sub);
    this.stats.groups = this.groups.size;
    if (group.projector) this.seedTail(sub, group.projector.selectedState(), group.head);
    if (group.head) this.startHistory(sub, group.bootstrap?.head ?? group.head);
  }
  onCurrentPage(group, page) {
    if (this.disposed || this.groups.get(group.key) !== group) return;
    this.stats.currentPages++;
    this.stats.currentPatches += page.patches.length;
    const exact = orderWallsArchiveDerivationsExact(page.profile, group.settings);
    group.profileExact = exact;
    group.profileStatus = page.profileStatus;
    group.currentValid = page.head.valid;
    group.currentCatchingUp = page.page.hasMore || page.page.nextAfter < page.watermark;
    group.currentMessage = !exact ? "The server current profile cannot exactly derive these Top Levels settings." : !group.currentValid ? page.coverage?.reason ?? "Current source continuity is not confirmed." : group.currentCatchingUp ? "Current selected-profile tail is catching up through bounded cursor batches." : void 0;
    if (page.page.after === 0 && page.state) {
      group.bootstrap = page;
      group.head = page.head;
      group.cursor = page.page.nextAfter;
      group.projector = new OrderWallsArchiveProjector(group.settings, page.head?.at ?? 0, Number.MAX_SAFE_INTEGER);
      group.projector.applyCurrentPage(page, page.head?.at ?? 0);
      group.pages = [];
      group.ringBytes = 0;
      group.ringPatches = 0;
      group.ringFloorCursor = page.watermark;
      group.ringOverflow = false;
      for (const sub of group.subscribers) {
        this.recordCurrentGaps(sub, page);
        if (exact) this.seedTail(sub, group.projector.selectedState(), group.head);
        else {
          sub.currentState = "unavailable";
          sub.currentMessage = "The current profile cannot exactly derive these Top Levels settings.";
        }
        this.startHistory(sub, group.head);
        this.publish(sub, "snapshot", this.visibleSegments(sub), this.status(sub));
      }
      return;
    }
    if (page.head && (!group.head || page.watermark > group.head.cursor || page.watermark === group.head.cursor && page.head.at > group.head.at)) group.head = page.head;
    group.cursor = Math.max(group.cursor, page.page.nextAfter);
    this.addCurrentPage(group, page);
    if (group.projector && exact) group.projector.applyCurrentPage(page, group.bootstrap?.head?.at ?? page.head?.at);
    const state = group.projector?.selectedState();
    for (const sub of group.subscribers) {
      this.recordCurrentGaps(sub, page);
      const previousBridge = sub.bridgeProjector;
      let changed = [];
      if (sub.bridgeProjector && exact) {
        changed = sub.bridgeProjector.applyCurrentPage(remapCurrentPage(page, sub.bridgeEntryIds), group.bootstrap?.head?.at ?? page.head?.at);
      } else if (state && exact && sub.tailProjector) changed = sub.tailProjector.applyCurrentPage(page, group.bootstrap?.head?.at ?? page.head?.at);
      this.updateCurrentMetadata(sub, page, group);
      this.tryBridge(sub);
      if (sub.bridgeProjector !== previousBridge && sub.bridgeProjector) {
        this.publish(sub, "patch", this.diff(sub, this.visibleSegments(sub)), this.status(sub));
      } else {
        const patches = this.markPatches(sub, changed, true);
        this.stats.incrementalSegments += patches.length;
        this.publish(sub, "patch", patches, this.status(sub));
      }
      this.tryStartPendingViewportHistory(sub);
    }
  }
  onCurrentReset(group, reason) {
    if (this.disposed || this.groups.get(group.key) !== group) return;
    const resetAt = group.head?.at;
    group.projector = void 0;
    group.bootstrap = void 0;
    group.head = void 0;
    group.cursor = 0;
    group.currentValid = false;
    group.currentCatchingUp = true;
    group.currentMessage = reason;
    group.pages = [];
    group.ringBytes = 0;
    group.ringPatches = 0;
    group.ringFloorCursor = 0;
    group.ringOverflow = true;
    for (const sub of group.subscribers) {
      const boundary = resetAt ?? sub.currentAt;
      if (boundary !== void 0) this.recordCurrentGap(sub, { from: boundary, to: boundary, reason });
      sub.continuityLost = true;
      sub.bridgeProjector?.censorOpen(sub.currentAt ?? 0, reason);
      sub.bridgeProjector = void 0;
      sub.bridgeEntryIds = void 0;
      sub.historyFenceState = void 0;
      sub.tailProjector?.censorOpen(sub.currentAt ?? 0, reason);
      sub.tailProjector = void 0;
      sub.historyStatus = sub.historyStatus ? {
        ...sub.historyStatus,
        state: "gap",
        message: reason,
        coverage: { from: sub.request.from, to: sub.request.to, complete: false, partial: true, reason },
        archive: sub.historyStatus.archive ? { ...sub.historyStatus.archive, state: "partial", reason } : void 0
      } : void 0;
      sub.currentState = "stale";
      sub.currentMessage = reason;
      this.publish(sub, "patch", [], this.status(sub));
    }
  }
  onCurrentStatus(group, status) {
    group.currentCatchingUp = status.state === "loading" || status.state === "catching-up";
    group.currentMessage = status.message;
    if (status.sourceValid !== void 0) group.currentValid = status.sourceValid;
    for (const sub of group.subscribers) {
      if (status.state === "unavailable") {
        sub.currentState = "unavailable";
        sub.currentMessage = status.message;
      } else if (status.state === "stale") {
        sub.currentState = "stale";
        sub.currentMessage = status.message;
      } else if (status.state === "ready") {
        if (!group.profileExact) {
          sub.currentState = "unavailable";
          sub.currentMessage = "The current profile cannot exactly derive these Top Levels settings.";
        } else {
          sub.currentState = group.currentValid ? "live" : "stale";
          sub.currentMessage = group.currentValid ? void 0 : status.message ?? "Current source continuity is not confirmed.";
        }
      } else {
        sub.currentState = "loading";
        sub.currentMessage = status.message ?? "Checking the exact current Top Levels profile.";
      }
      this.publish(sub, "patch", [], this.status(sub));
    }
  }
  loadHistory(sub) {
    this.startHistory(sub);
  }
  recordHistoryPageMetrics(metrics) {
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
  seedTail(sub, state, head2) {
    const profileId = orderWallsArchiveProfileId(sub.request.market, sub.settings) ?? "unknown";
    const projector = new OrderWallsArchiveProjector(sub.settings, sub.request.from, Number.MAX_SAFE_INTEGER, `tail-${profileId}`);
    projector.seedSelectedState(state);
    sub.tailProjector = projector;
    sub.bridgeProjector = void 0;
    sub.currentAt = head2?.at ?? state.at;
    sub.currentScope = toOrderWallScope(head2?.bookScope ?? state.bookScope);
    sub.currentMidpoint = head2?.midpoint ?? state.midpoint;
    sub.currentState = head2?.valid === false ? "stale" : "live";
    sub.currentMessage = head2?.valid === false ? "Current source continuity is not confirmed." : void 0;
  }
  updateCurrentMetadata(sub, page, group) {
    const head2 = page.head ?? group.head;
    sub.currentAt = page.coverage?.confirmedTo ?? head2?.at ?? page.page.lastAt;
    sub.currentScope = toOrderWallScope(head2?.bookScope ?? page.coverage?.bookScope);
    sub.currentMidpoint = head2?.midpoint ?? sub.currentMidpoint;
    if (!group.profileExact) {
      sub.currentState = "unavailable";
      sub.currentMessage = "The current profile cannot exactly derive these Top Levels settings.";
    } else if (!group.currentValid) {
      sub.currentState = "stale";
      sub.currentMessage = group.currentMessage ?? "Current source continuity is not confirmed.";
    } else if (group.currentCatchingUp) {
      sub.currentState = "loading";
      sub.currentMessage = group.currentMessage ?? "Current selected-profile archive is catching up.";
    } else {
      sub.currentState = "live";
      sub.currentMessage = void 0;
    }
  }
  recordCurrentGaps(sub, page) {
    if (page.coverage?.gapsTruncated) sub.currentGapsTruncated = true;
    for (const gap of page.coverage?.gaps ?? []) {
      const from = gap.from ?? gap.at;
      const to = gap.to ?? gap.at ?? from;
      if (from === void 0 || to === void 0 || !Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
      this.recordCurrentGap(sub, { from, to, reason: gap.reason });
    }
    for (const patch of page.patches) {
      if (patch.kind === "gap") this.recordCurrentGap(sub, { from: patch.at, to: patch.at, reason: patch.reason ?? "Depth continuity unavailable" });
      for (const removal of [...patch.bids.removals, ...patch.asks.removals]) {
        if (removal.reason === "gap" || removal.reason === "replacement-epoch" || removal.reason === "capacity-unknown") {
          this.recordCurrentGap(sub, { from: removal.at, to: removal.at, reason: patch.reason ?? removal.reason });
        }
      }
    }
  }
  recordCurrentGap(sub, gap) {
    if (gap.to < sub.request.from) return;
    const duplicate = sub.currentGaps.some((existing) => existing.from === gap.from && existing.to === gap.to && existing.reason === gap.reason);
    if (duplicate) return;
    sub.currentGaps.push(gap);
    sub.currentGaps.sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason));
    if (sub.currentGaps.length > MAX_SUBSCRIPTION_ARCHIVE_GAPS) {
      sub.currentGaps.splice(0, sub.currentGaps.length - MAX_SUBSCRIPTION_ARCHIVE_GAPS);
      sub.currentGapsTruncated = true;
    }
  }
  startHistory(sub, fence, requestOverride, initialProjector, carryHistory = false) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.archiveStarted) return;
    sub.archiveStarted = true;
    if (sub.request.currentOnly) return;
    sub.historyFence = fence ? { cursor: fence.cursor, at: fence.at, epoch: fence.epoch } : void 0;
    const fenceState = fence ? sub.group?.projector?.selectedState() : void 0;
    sub.historyFenceState = fence && fenceState && sameProjectorHead(fenceState, fence) ? copySelectedState(fenceState) : void 0;
    const request = requestOverride ?? {
      market: sub.request.market,
      from: sub.request.from,
      to: sub.request.to,
      settings: sub.settings,
      ...sub.request.profileId ? { profileId: sub.request.profileId } : {},
      ...fence ? { watermark: fence.cursor, head: { cursor: fence.cursor, at: fence.at, epoch: fence.epoch } } : {}
    };
    if (carryHistory) {
      sub.historyArchiveCarry = mergeHistoryArchive(
        sub.historyArchiveCarry,
        sub.historyStatus?.archive ?? emptyArchiveStatus(request, "partial")
      );
      sub.historyCoverageCarry = mergeHistoryCoverage(sub.historyCoverageCarry, sub.historyStatus?.coverage);
    } else {
      sub.historyArchiveCarry = void 0;
      sub.historyCoverageCarry = void 0;
    }
    const cachedStatus = sub.cachedHistory ? sub.historyStatus : void 0;
    const archive = emptyArchiveStatus(request, "loading");
    sub.historyStatus = {
      state: "loading",
      message: carryHistory ? "Extending archived Top Levels history for the advancing chart range." : "Loading archived Top Levels history.",
      coverage: carryHistory ? { from: sub.request.from, to: sub.request.to, complete: false, partial: true } : { from: request.from, to: request.to, complete: false, partial: true },
      archive
    };
    if (cachedStatus?.archive) sub.historyStatus = { ...cachedStatus, state: "loading", message: "Cached history visible; validating the current revision.", archive: { ...cachedStatus.archive, state: "loading", requestComplete: false, rangeComplete: false, reason: "Cached history visible; validating the current revision." } };
    const key = historyJobKey(request);
    let job = this.historyJobs.get(key);
    if (job) {
      sub.historyFence = job.fence;
      sub.historyFenceState = job.fenceState ? copySelectedState(job.fenceState) : void 0;
      sub.historyJob = job;
      job.subscribers.add(sub);
      if (job.latest) this.publishSharedHistorySnapshot(sub, job.latest);
      return;
    }
    job = {
      key,
      request,
      fence: sub.historyFence,
      fenceState: sub.historyFenceState ? copySelectedState(sub.historyFenceState) : void 0,
      abort: new AbortController(),
      subscribers: /* @__PURE__ */ new Set([sub]),
      settled: false,
      initialProjector
    };
    sub.historyJob = job;
    this.historyJobs.set(key, job);
    this.stats.historyRequests++;
    this.runHistoryJob(job);
  }
  pendingViewportNeedsExtension(sub, job = sub.historyJob) {
    const pending = sub.pendingViewport, archive = job?.latest?.status.archive;
    const fixed = job?.fence ?? job?.request.head, current = sub.group?.head;
    if (!pending || !job || !archive || archive.requestComplete !== true || archive.state === "unavailable" || pending.to <= job.request.to || !fixed || !current || current.cursor < fixed.cursor) return false;
    return current.cursor > fixed.cursor || current.at > fixed.at;
  }
  tryStartPendingViewportHistory(sub) {
    const job = sub.historyJob, target = sub.pendingViewport;
    if (!job?.settled || !target) return false;
    const archive = job.latest?.status.archive;
    if (archive?.state === "unavailable" && archive.requestComplete === true) {
      sub.pendingViewport = void 0;
      return false;
    }
    if (!this.pendingViewportNeedsExtension(sub, job)) return false;
    const fixed = job.fence ?? job.request.head, current = sub.group?.head;
    const priorProjector = job.latest?.projector ?? sub.historyProjector;
    if (!fixed || !current || !priorProjector || target.to <= fixed.at) return false;
    const request = {
      market: sub.request.market,
      from: fixed.at,
      to: target.to,
      after: fixed.cursor,
      settings: sub.settings,
      ...sub.request.profileId ? { profileId: sub.request.profileId } : {},
      watermark: current.cursor,
      head: { cursor: current.cursor, at: current.at, epoch: current.epoch }
    };
    const initialProjector = priorProjector.cloneForLiveTail(target.to);
    this.detachHistoryJob(sub);
    sub.request = { ...sub.request, from: Math.min(sub.request.from, target.from), to: target.to, followLive: target.followLive };
    sub.pendingViewport = void 0;
    sub.archiveStarted = false;
    this.startHistory(sub, current, request, initialProjector, true);
    this.publish(sub, "patch", [], this.status(sub));
    return true;
  }
  detachHistoryJob(sub) {
    const job = sub.historyJob;
    if (!job) return;
    sub.historyJob = void 0;
    job.subscribers.delete(sub);
    if (!job.subscribers.size) {
      if (this.historyJobs.get(job.key) === job) this.historyJobs.delete(job.key);
      if (!job.settled) job.abort.abort();
    }
  }
  runHistoryJob(job, resume) {
    job.settled = false;
    void loadOrderWallsArchive({
      request: job.request,
      signal: job.abort.signal,
      fetcher: this.request,
      resume,
      ...job.preparationRetryToken ? { preparationRetry: { token: job.preparationRetryToken, newRevision: job.preparationNeedsRevision === true } } : {},
      ...job.initialProjector ? { initialProjector: job.initialProjector.cloneForLiveTail(job.request.to) } : {},
      onUpdate: (update) => {
        job.latest = update;
        job.resume = update.resume;
        for (const subscriber of [...job.subscribers]) this.publishSharedHistoryUpdate(subscriber, job, update);
      },
      onPageMetrics: (metrics) => this.recordHistoryPageMetrics(metrics)
    }).then((result) => {
      job.latest = result;
      job.resume = result.resume;
      job.settled = true;
      job.preparationNeedsRevision = false;
      job.preparationRetryToken = void 0;
      this.rememberHistory(job.request, result);
      for (const subscriber of [...job.subscribers]) {
        if (!this.tryStartPendingViewportHistory(subscriber)) this.publishSharedHistoryUpdate(subscriber, job, result);
      }
    }).catch((error) => {
      job.settled = true;
      if (job.abort.signal.aborted || this.disposed) return;
      this.stats.failures++;
      const sourceChanged = error instanceof PreparedWallSourceChangedError || error instanceof PreparedWallPreparationError && error.category === "source-changed";
      const requestedRevision = job.preparationNeedsRevision === true;
      job.preparationNeedsRevision = sourceChanged;
      const retryable = error instanceof PreparedWallPreparationError ? error.retryable : true;
      if (sourceChanged) {
        job.resume = void 0;
        for (const subscriber of job.subscribers) if (subscriber.historyProjector || subscriber.historyPresentation?.size) subscriber.cachedHistory = true;
        if (resume) {
          if (job.preparationRetryToken && !requestedRevision) job.preparationRetryToken = crypto.randomUUID();
          this.runHistoryJob(job);
          return;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      for (const subscriber of job.subscribers) {
        const previous = subscriber.historyStatus ?? job.latest?.status;
        if (job.resume && previous) {
          const archive = {
            ...previous.archive ?? emptyArchiveStatus(subscriber.request, "partial"),
            state: "partial",
            requestComplete: false,
            retryable,
            resumeAfter: job.resume.after,
            reason: message
          };
          subscriber.historyStatus = {
            ...previous,
            state: "loading",
            message: `Order Walls history incomplete; validated prefix retained and can be resumed. ${message}`,
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true, reason: message },
            archive
          };
        } else {
          subscriber.historyStatus = {
            state: "gap",
            message: `Order Walls history request failed: ${message}`,
            coverage: { from: subscriber.request.from, to: subscriber.request.to, complete: false, partial: true, reason: message },
            archive: { ...emptyArchiveStatus(subscriber.request, "partial", message), ...subscriber.cachedHistory ? subscriber.historyStatus?.archive : {}, state: "partial", reason: message, requestComplete: false, rangeComplete: false, resumeAfter: void 0, retryable }
          };
        }
        this.publish(subscriber, "patch", [], this.status(subscriber));
      }
    });
  }
  showWarmHistory(sub) {
    const key = warmHistoryKey(sub.request), entry = this.warmHistory.get(key);
    if (!entry || entry.expired) return;
    let replay = entry.replay, started = false;
    if (!replay && entry.compact && this.warmReplays.size >= 2) {
      this.stats.warmCapacityMisses++;
      return;
    }
    if (!replay) {
      replay = { key, entry, abort: new AbortController(), presentation: new Map(entry.presentation), subscribers: /* @__PURE__ */ new Set(), settled: !entry.compact, runs: entry.compact ? 0 : entry.runs };
      entry.replay = replay;
      started = true;
    }
    const active = replay;
    active.subscribers.add(sub);
    sub.warmReplay = active;
    sub.cachedHistory = true;
    sub.historyProjector = void 0;
    sub.historyPresentation = active.presentation;
    sub.historyStatus = { ...entry.status, archive: { ...entry.status.archive, state: "loading", requestComplete: false, rangeComplete: false, loadedThrough: active.settled ? entry.status.archive.loadedThrough : sub.request.from, presentationThrough: entry.status.archive.presentationThrough ?? entry.status.archive.loadedThrough, reason: "Cached history visible; validating the current revision." } };
    if (started && entry.compact) this.warmReplays.add(active);
    this.publish(sub, "snapshot", this.visibleSegments(sub), this.status(sub));
    if (started && entry.compact) {
      if (active.abort.signal.aborted) {
        this.warmReplays.delete(active);
        return;
      }
      const replayAt = performance.now();
      let firstContentMs, decodedSegments = 0;
      void replayCompactWallPresentation(entry.compact, key, active.abort.signal, (segments) => {
        if (firstContentMs === void 0 && segments.length) firstContentMs = performance.now() - replayAt;
        decodedSegments += segments.length;
        for (const segment of segments) {
          active.presentation.set(segment.id, segment);
          active.runs += segment.valueRuns.length;
        }
        for (const viewer of active.subscribers) if (viewer.warmReplay === active && viewer.cachedHistory && this.subscriptions.get(viewer.id) === viewer) {
          if (viewer.historyStatus?.archive?.state === "loading" || viewer.historyStatus?.archive?.state === "building") {
            const reason = `Cached history ${active.presentation.size}/${entry.segments} walls; validating the current revision.`;
            viewer.historyStatus = { ...viewer.historyStatus, message: reason, archive: { ...viewer.historyStatus.archive, reason } };
          }
          this.publish(viewer, "patch", this.markPatches(viewer, segments.map((segment) => ({ id: segment.id, segment, replaceValueRuns: true })), false), this.status(viewer));
        }
      }).then(() => {
        active.settled = true;
        for (const viewer of active.subscribers) if (viewer.warmReplay === active && viewer.cachedHistory && viewer.historyStatus?.archive) {
          viewer.historyStatus = { ...viewer.historyStatus, archive: { ...viewer.historyStatus.archive, loadedThrough: entry.status.archive.loadedThrough } };
          this.publish(viewer, "patch", [], this.status(viewer));
        }
      }).catch((error) => {
        if (active.abort.signal.aborted || this.disposed) return;
        this.stats.warmDecodeFailures++;
        entry.expired = true;
        for (const viewer of active.subscribers) {
          if (!active.presentation.size) {
            viewer.cachedHistory = false;
            const job = viewer.historyJob;
            if (job?.latest) this.publishSharedHistorySnapshot(viewer, job.latest);
          }
          if (viewer.historyStatus?.archive?.state === "loading") viewer.historyStatus = { ...viewer.historyStatus, message: "Cached history incomplete; loading a fresh revision.", archive: { ...viewer.historyStatus.archive, reason: "Cached history incomplete; loading a fresh revision." } };
          this.publish(viewer, "patch", [], this.status(viewer));
        }
      }).finally(() => {
        this.warmReplays.delete(active);
        this.recordWarmTiming({ kind: "replay", identity: key, queueMs: 0, elapsedMs: performance.now() - replayAt, firstContentMs, segments: decodedSegments, runs: active.runs, state: active.settled ? "ready" : active.abort.signal.aborted ? "cancelled" : "failed" });
      });
    }
  }
  releaseWarmReplay(sub) {
    const replay = sub.warmReplay;
    if (!replay) return;
    sub.warmReplay = void 0;
    replay.subscribers.delete(sub);
    if (!replay.subscribers.size) {
      replay.abort.abort();
      replay.presentation.clear();
      if (replay.entry.replay === replay) replay.entry.replay = void 0;
      if (replay.entry.expired && this.warmHistory.get(replay.key) === replay.entry) {
        clearTimeout(replay.entry.timer);
        this.warmHistory.delete(replay.key);
      }
    }
  }
  expireWarm(key, entry) {
    entry.expired = true;
    if (!entry.replay?.subscribers.size && this.warmHistory.get(key) === entry) this.warmHistory.delete(key);
  }
  admitWarm(key, status, runs, segments, bytes, presentation, compact, signature) {
    if (this.disposed) return;
    if (bytes > 16 * 1024 * 1024) {
      this.stats.warmCapacityMisses++;
      return;
    }
    const old = this.warmHistory.get(key);
    if (old?.replay?.subscribers.size) {
      this.stats.warmCapacityMisses++;
      return;
    }
    if (old) {
      clearTimeout(old.timer);
      this.warmHistory.delete(key);
    }
    while (this.warmHistory.size >= 2 || [...this.warmHistory.values()].reduce((n, entry2) => n + entry2.bytes, 0) + bytes > 32 * 1024 * 1024) {
      const unused = [...this.warmHistory].find(([, entry2]) => !entry2.replay?.subscribers.size);
      if (!unused) {
        this.stats.warmCapacityMisses++;
        return;
      }
      clearTimeout(unused[1].timer);
      this.warmHistory.delete(unused[0]);
    }
    const entry = { presentation, compact, status, runs, segments, bytes, signature, timer: setTimeout(() => this.expireWarm(key, entry), 6e4) };
    this.warmHistory.set(key, entry);
    this.stats.warmAdmissions++;
  }
  rememberHistory(request, result) {
    const archive = result.status.archive, projector = result.projector;
    if (this.disposed || !projector || !archive?.requestComplete || !archive.exact || archive.state === "unavailable" || result.resume) return;
    const key = warmHistoryKey(request);
    const signature = result.preparedSourceToken && result.presentation ? JSON.stringify([result.preparedSourceToken, result.segments.filter((segment) => result.presentation.get(segment.id)?.end === null).map(({ valueRuns: _runs, ...header }) => header)]) : void 0;
    const prior = this.warmHistory.get(key);
    if (signature && prior?.signature === signature && !prior.expired) {
      prior.status = result.status;
      clearTimeout(prior.timer);
      prior.timer = setTimeout(() => this.expireWarm(key, prior), 6e4);
      this.stats.warmRevisionReuses++;
      return;
    }
    for (const build2 of this.warmBuilds) if (build2.key === key) build2.abort.abort();
    const count = projector.diagnostics(), bytes = count.valueRuns * 256 + count.retainedSegments * 512;
    if (bytes > this.compactPreparedAboveBytes && (!result.preparedPresentationComplete || !result.presentation)) {
      this.stats.warmCapacityMisses++;
      return;
    }
    const presentation = bytes > this.compactPreparedAboveBytes ? wallCompactPresentation(result.segments, result.presentation) : wallHistoryPresentation(result.segments, result.preparedPresentationComplete ? result.presentation : void 0);
    if (!presentation || presentation.size !== count.retainedSegments) {
      this.stats.warmInvalidMisses++;
      return;
    }
    if (bytes <= this.compactPreparedAboveBytes) {
      this.admitWarm(key, result.status, count.valueRuns, count.retainedSegments, bytes, presentation, void 0, signature);
      return;
    }
    if (this.warmBuilds.size >= 2) {
      this.stats.warmCapacityMisses++;
      return;
    }
    const build = { key, abort: new AbortController() };
    this.warmBuilds.add(build);
    const queuedAt = performance.now();
    let buildAt, built = false;
    const work = this.warmBuildTail.then(async () => {
      build.abort.signal.throwIfAborted();
      buildAt = performance.now();
      const compact = await compactWallPresentation(key, [...presentation.values()], build.abort.signal);
      build.abort.signal.throwIfAborted();
      if (this.disposed) return;
      if (new TextEncoder().encode(JSON.stringify([result.status, signature])).byteLength * 2 + 4096 > 256 * 1024) throw Error("Compact wall status capacity");
      this.admitWarm(key, result.status, count.valueRuns, count.retainedSegments, compact.retainedBytes + 256 * 1024, void 0, compact, signature);
      this.stats.warmCompactBuilds++;
      built = true;
    }).catch(() => {
      if (!build.abort.signal.aborted) {
        this.stats.warmBuildFailures++;
        this.stats.warmCapacityMisses++;
      }
    }).finally(() => {
      this.warmBuilds.delete(build);
      const end = performance.now();
      this.recordWarmTiming({ kind: "encode", identity: key, queueMs: (buildAt ?? end) - queuedAt, elapsedMs: buildAt === void 0 ? 0 : end - buildAt, segments: count.retainedSegments, runs: count.valueRuns, state: built ? "ready" : build.abort.signal.aborted ? "cancelled" : "failed" });
    });
    this.warmBuildTail = work;
  }
  publishSharedHistorySnapshot(sub, update) {
    const replay = { ...update, kind: "snapshot", segments: update.projector?.snapshot() ?? (update.presentation ? [...update.presentation.values()] : update.segments) ?? [], patches: void 0 };
    this.publishSharedHistoryUpdate(sub, sub.historyJob, replay);
  }
  publishSharedHistoryUpdate(sub, job, update) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub || sub.historyJob !== job) return;
    const priorStatus = sub.historyStatus;
    sub.historyStatus = update.status;
    if (!sub.cachedHistory && update.status.archive?.requestComplete && update.status.archive.exact && update.status.archive.state !== "unavailable") this.releaseWarmReplay(sub);
    const alreadyPresented = update.preparedPresentationComplete && !sub.cachedHistory && Boolean(update.projector && (sub.historyPresentation || sub.historyProjector === update.projector));
    if (sub.cachedHistory) {
      const archive = update.status.archive;
      if (!archive?.requestComplete || !archive.exact || archive.state === "unavailable") {
        if (priorStatus?.archive && archive) {
          const gaps = new Map([...priorStatus.archive.gaps, ...archive.gaps].map((gap) => [`${gap.from}:${gap.to}:${gap.reason}`, gap]));
          sub.historyStatus = { ...update.status, archive: { ...priorStatus.archive, ...archive, gaps: [...gaps.values()].slice(-MAX_SUBSCRIPTION_ARCHIVE_GAPS), gapsTruncated: priorStatus.archive.gapsTruncated || archive.gapsTruncated || gaps.size > MAX_SUBSCRIPTION_ARCHIVE_GAPS, loadedThrough: Math.max(priorStatus.archive.loadedThrough ?? sub.request.from, archive.loadedThrough ?? sub.request.from), requestComplete: false, rangeComplete: false } };
        }
        this.publish(sub, "patch", [], this.status(sub));
        return;
      }
      sub.cachedHistory = false;
      this.releaseWarmReplay(sub);
      update = { ...update, kind: "snapshot", segments: update.projector?.snapshot() ?? update.segments, patches: void 0 };
    }
    if (alreadyPresented) update = { ...update, kind: "patch", patches: [], segments: void 0 };
    if (update.projector) {
      sub.historyProjector = update.projector;
      sub.historyPresentation = void 0;
    } else if (update.presentation) sub.historyPresentation = update.presentation;
    if (!sub.group) {
      this.publishArchiveUpdate(sub, update);
      return;
    }
    const previousBridge = sub.bridgeProjector;
    this.tryBridge(sub);
    const status = this.status(sub);
    if (update.kind === "snapshot") this.publish(sub, "snapshot", this.visibleSegments(sub), status);
    else if (!sub.bridgeProjector) {
      const patches = this.markPatches(sub, update.patches ?? [], false);
      this.stats.incrementalSegments += patches.length;
      this.publish(sub, "patch", patches, status);
    } else if (alreadyPresented && previousBridge === sub.bridgeProjector) this.publish(sub, "patch", [], status);
    else this.publish(sub, "patch", this.diff(sub, this.visibleSegments(sub)), status);
  }
  addCurrentPage(group, page) {
    if (page.page.after === 0) return;
    if (page.page.nextAfter <= group.ringFloorCursor && !page.patches.length) return;
    const bytes = page.__bytes ?? JSON.stringify(page).length;
    group.pages.push(page);
    group.ringBytes += bytes;
    group.ringPatches += page.patches.length;
    while (group.pages.length > MAX_CURRENT_RING_PAGES || group.ringBytes > MAX_CURRENT_RING_BYTES || group.ringPatches > MAX_CURRENT_RING_PATCHES) {
      const removed = group.pages.shift();
      if (!removed) break;
      group.ringBytes = Math.max(0, group.ringBytes - (removed.__bytes ?? JSON.stringify(removed).length));
      group.ringPatches = Math.max(0, group.ringPatches - removed.patches.length);
      group.ringFloorCursor = Math.max(group.ringFloorCursor, removed.page.nextAfter);
      group.ringOverflow = true;
      this.stats.ringDrops++;
    }
  }
  tryBridge(sub) {
    const group = sub.group, history = sub.historyProjector, archive = sub.historyStatus?.archive;
    if (!group || !history || !archive || archive.state === "loading" || archive.state === "building" || archive.state === "backfilling") return;
    if (archive.requestComplete === false) return;
    if (sub.bridgeProjector) return;
    const fence = sub.historyFence;
    const cursor = fence?.cursor;
    const joinAt = fence?.at;
    const gaps = archive.gaps.filter((gap) => gap.to >= sub.request.from && gap.from <= (joinAt ?? sub.request.to));
    const coversFence = joinAt !== void 0 && sub.request.to >= joinAt && archive.confirmedTo !== void 0 && archive.confirmedTo >= joinAt;
    const historyThroughFence = Boolean(archive.state === "complete" || archive.state === "partial" && archive.requestComplete === true && archive.confirmedTo !== void 0 && archive.confirmedTo >= (joinAt ?? Infinity) && gaps.length === 0 && !sub.historyProjector?.historyLimited);
    const safe = Boolean(!sub.continuityLost && archive.exact && historyThroughFence && fence && cursor !== void 0 && coversFence && archive.availableFrom !== void 0 && archive.availableFrom <= sub.request.from && gaps.length === 0 && group.ringFloorCursor <= cursor);
    if (!safe || !fence || cursor === void 0) {
      if (sub.historyProjector) sub.historyProjector.censorOpen(
        archive.confirmedTo ?? joinAt ?? sub.request.to,
        "Current selected-profile tail could not be joined through a verified archive watermark."
      );
      sub.continuityLost = true;
      return;
    }
    const pages = group.pages.filter((page) => page.page.nextAfter > cursor).sort((a, b) => a.page.after - b.page.after);
    const targetCursor = group.head?.cursor ?? group.cursor;
    if (group.cursor < targetCursor || pages.at(-1)?.page.hasMore) return;
    const currentState = sub.historyFenceState;
    const entryIds = currentState ? proveEntryIdMapping(history.selectedState(), currentState) : void 0;
    if (!currentState || !entryIds || !pagesContinueFrom(pages, cursor, targetCursor, fence.at, fence.epoch)) {
      history.censorOpen(
        archive.confirmedTo ?? joinAt ?? sub.request.to,
        "Archive and current selected-profile entries could not be matched at the fixed watermark."
      );
      sub.continuityLost = true;
      return;
    }
    const merged = history.cloneForLiveTail(Number.MAX_SAFE_INTEGER);
    merged.confirmWatermark(fence.cursor, fence.at, fence.epoch, currentState.midpoint);
    sub.bridgeEntryIds = entryIds;
    for (const page of pages) {
      const clipped = page.page.after < cursor ? { ...page, page: { ...page.page, after: cursor }, patches: page.patches.filter((patch) => patch.cursor > cursor) } : page;
      merged.applyCurrentPage(remapCurrentPage(clipped, sub.bridgeEntryIds), fence.at);
    }
    sub.bridgeProjector = merged;
    sub.tailProjector = void 0;
    sub.continuityLost = false;
  }
  visibleSegments(sub) {
    const currentSelection = sub.group?.profileExact === true && sub.group.currentValid;
    const markCurrent = (segments) => segments.map((segment) => ({
      ...segment,
      currentSelection: currentSelection && segment.end === null
    }));
    if (sub.bridgeProjector) return markCurrent(sub.bridgeProjector.snapshot());
    const tail = markCurrent(sub.tailProjector?.snapshot() ?? []);
    const history = sub.historyProjector?.snapshot() ?? (sub.historyPresentation ? [...sub.historyPresentation.values()] : []);
    if (!sub.group) return history.map((segment) => ({ ...segment, currentSelection: false }));
    if (!sub.historyProjector && !sub.historyPresentation || !sub.historyStatus?.archive) return tail;
    const combined = /* @__PURE__ */ new Map();
    for (const segment of history) combined.set(segment.id, { ...segment, currentSelection: false });
    for (const segment of tail) combined.set(segment.id, segment);
    return [...combined.values()].sort((a, b) => a.start - b.start || a.side.localeCompare(b.side) || a.price - b.price);
  }
  publishArchiveUpdate(sub, update) {
    if (update.kind === "snapshot") this.publish(sub, "snapshot", update.segments ?? [], update.status);
    else this.publish(sub, "patch", update.patches ?? [], update.status);
  }
  markPatches(sub, patches, current) {
    const selected = current && sub.group?.profileExact === true && sub.group.currentValid;
    return patches.map((patch) => patch.segment ? { ...patch, segment: { ...patch.segment, currentSelection: selected && patch.segment.end === null } } : patch);
  }
  diff(sub, segments) {
    this.stats.fullReconciliations++;
    this.stats.comparisonVisits += segments.length;
    const next = new Map(segments.map((segment) => [segment.id, segment])), patches = [];
    for (const [id, previous] of sub.lastPublished) if (!next.has(id)) patches.push({ id, segment: null });
    for (const [id, segment] of next) {
      const previous = sub.lastPublished.get(id);
      if (!previous || !sameWallSegment(previous, segment)) patches.push({ id, segment, replaceValueRuns: true });
    }
    sub.lastPublished = next;
    return patches;
  }
  status(sub) {
    const settings = sub.settings, availability = orderWallsArchiveProfileId(sub.request.market, settings);
    const status = sub.historyStatus ?? {
      state: "loading",
      message: "Waiting for the current selected-profile archive.",
      archive: emptyArchiveStatus(sub.request, "loading")
    };
    const baseArchive = status.archive ?? emptyArchiveStatus(sub.request, "loading");
    const priorArchive = mergeHistoryArchive(sub.historyArchiveCarry, baseArchive);
    const gaps = /* @__PURE__ */ new Map();
    for (const gap of [...priorArchive.gaps, ...sub.currentGaps]) {
      if (gap.to < sub.request.from) continue;
      gaps.set(`${gap.from}:${gap.to}:${gap.reason}`, gap);
    }
    const orderedGaps = [...gaps.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason));
    const gapsTruncated = Boolean(priorArchive.gapsTruncated || sub.currentGapsTruncated || orderedGaps.length > MAX_SUBSCRIPTION_ARCHIVE_GAPS);
    let archive = {
      ...priorArchive,
      profileId: availability ?? priorArchive.profileId,
      from: sub.request.from,
      to: sub.request.to,
      gaps: orderedGaps.slice(-MAX_SUBSCRIPTION_ARCHIVE_GAPS),
      ...gapsTruncated ? { gapsTruncated: true } : {},
      ...!priorArchive.profileStatus && sub.group?.profileStatus ? { profileStatus: sub.group.profileStatus } : {},
      ...sub.currentMidpoint !== void 0 ? { midpoint: sub.currentMidpoint } : {}
    };
    if (this.pendingViewportNeedsExtension(sub)) {
      archive = {
        ...archive,
        state: "loading",
        requestComplete: false,
        from: Math.min(sub.request.from, sub.pendingViewport.from),
        to: sub.pendingViewport.to,
        reason: "Continuing fixed-watermark history through the advancing chart range."
      };
      delete archive.resumeAfter;
    }
    const state = sub.currentState === "live" ? "live" : sub.currentState === "unavailable" ? "unavailable" : sub.currentState === "stale" ? "gap" : "loading";
    const message = sub.currentMessage ?? (priorArchive.requestComplete === false ? status.message : sub.group && priorArchive.state !== "complete" ? "Current selected-profile walls are updating while archive history loads." : status.message);
    return {
      ...status,
      ...mergeHistoryCoverage(sub.historyCoverageCarry, status.coverage) ? { coverage: mergeHistoryCoverage(sub.historyCoverageCarry, status.coverage) } : {},
      state,
      ...message ? { message } : {},
      ...sub.currentAt !== void 0 ? { lastConfirmedAt: sub.currentAt } : {},
      ...sub.currentScope ? { bookScope: sub.currentScope } : {},
      archive
    };
  }
  publish(sub, kind, value, status) {
    if (this.disposed || this.subscriptions.get(sub.id) !== sub) return;
    const event = {
      type: "order-wall-batch",
      ids: [sub.id],
      key: sub.key,
      generation: sub.generation,
      batchId: ++sub.batch,
      kind,
      ...kind === "snapshot" ? { segments: value } : { patches: value },
      status
    };
    this.emit(event);
    sub.initialPublished = true;
    if (kind === "snapshot") sub.lastPublished = new Map(value.map((segment) => [segment.id, segment]));
    else for (const patch of value) {
      if (patch.segment) sub.lastPublished.set(patch.id, patch.segment);
      else sub.lastPublished.delete(patch.id);
    }
  }
};
function canCoalesceLiveViewport(previous, next) {
  if (!previous.followLive || !next.followLive || next.to <= previous.to || next.from < previous.from) return false;
  const previousSpan = previous.to - previous.from, nextSpan = next.to - next.from;
  if (previousSpan <= 0 || nextSpan <= 0 || next.to - previous.to > Math.max(6e4, previousSpan * 0.1)) return false;
  const overlap = Math.max(0, Math.min(previous.to, next.to) - Math.max(previous.from, next.from));
  return overlap >= Math.min(previousSpan, nextSpan) * 0.9 && nextSpan >= previousSpan * 0.8 && nextSpan <= previousSpan * 1.2;
}
function mergeHistoryArchive(previous, next) {
  if (!previous) return next;
  const gapMap = /* @__PURE__ */ new Map();
  for (const gap of [...previous.gaps, ...next.gaps]) gapMap.set(`${gap.from}:${gap.to}:${gap.reason}`, gap);
  const incomplete = next.requestComplete === false;
  const state = next.state === "unavailable" ? "unavailable" : incomplete ? next.state : previous.state === "partial" || next.state === "partial" ? "partial" : next.state;
  const availableFrom = [previous.availableFrom, next.availableFrom].filter((value) => value !== void 0);
  const confirmedTo = [previous.confirmedTo, next.confirmedTo].filter((value) => value !== void 0);
  return {
    ...previous,
    ...next,
    state,
    requestComplete: next.requestComplete ?? previous.requestComplete,
    rangeComplete: previous.rangeComplete === true && next.rangeComplete === true,
    from: Math.min(previous.from, next.from),
    to: Math.max(previous.to, next.to),
    ...availableFrom.length ? { availableFrom: Math.min(...availableFrom) } : {},
    ...confirmedTo.length ? { confirmedTo: Math.max(...confirmedTo) } : {},
    loadedThrough: next.loadedThrough ?? previous.loadedThrough,
    gaps: [...gapMap.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.reason.localeCompare(b.reason)),
    ...previous.gapsTruncated || next.gapsTruncated ? { gapsTruncated: true } : {},
    ...!next.reason && previous.reason ? { reason: previous.reason } : {}
  };
}
function mergeHistoryCoverage(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  const complete = previous.complete && next.complete;
  return {
    from: Math.min(previous.from, next.from),
    to: Math.max(previous.to, next.to),
    complete,
    partial: previous.partial || next.partial || !complete,
    ...next.reason ?? previous.reason ? { reason: next.reason ?? previous.reason } : {}
  };
}
function warmHistoryKey(request) {
  return historyJobKey({ ...request, after: 0, watermark: void 0, head: void 0 });
}
function historyJobKey(request) {
  const settings = orderWallsSettings(request.settings);
  return JSON.stringify([
    request.market,
    orderWallsArchiveIdentity(request) ?? settings,
    request.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? null,
    request.from,
    request.to,
    request.after ?? 0,
    request.watermark ?? null,
    request.head ? [request.head.cursor, request.head.at, request.head.epoch] : null
  ]);
}
var HISTORY_PAGE_TIMING_SAMPLE_LIMIT = 512;
function summarizeArchivePageTimings(metrics, total) {
  const percentile = (key, quantile) => {
    const values = metrics.map((metric) => metric[key]).sort((a, b) => a - b);
    return values.length ? values[Math.min(values.length - 1, Math.ceil(quantile * values.length) - 1)] : null;
  };
  const fields = [
    "responseHeadersMs",
    "responseBodyReadMs",
    "jsonParseMs",
    "validationMs",
    "projectorApplyMs",
    "updateCallbackMs",
    "eventLoopYieldDelayMs",
    "responseBytes"
  ];
  return {
    totalPages: total,
    retainedSamples: metrics.length,
    completeSample: total <= metrics.length,
    p50: Object.fromEntries(fields.map((field) => [field, percentile(field, 0.5)])),
    p95: Object.fromEntries(fields.map((field) => [field, percentile(field, 0.95)])),
    max: Object.fromEntries(fields.map((field) => [field, percentile(field, 1)]))
  };
}
function sameProjectorHead(state, head2) {
  return state.cursor === head2.cursor && state.at === head2.at && state.epoch === head2.epoch;
}
function copySelectedState(state) {
  return {
    ...state,
    bookScope: state.bookScope ? { ...state.bookScope } : void 0,
    bids: state.bids.map((candidate) => ({ ...candidate })),
    asks: state.asks.map((candidate) => ({ ...candidate }))
  };
}
function proveEntryIdMapping(history, current) {
  if (history.cursor !== current.cursor || history.at !== current.at || history.epoch !== current.epoch || history.bids.length !== current.bids.length || history.asks.length !== current.asks.length) return void 0;
  const mapping = /* @__PURE__ */ new Map(), usedCurrent = /* @__PURE__ */ new Set(), usedHistory = /* @__PURE__ */ new Set();
  for (const side of ["bid", "ask"]) {
    const historySide = side === "bid" ? history.bids : history.asks;
    const currentSide = side === "bid" ? current.bids : current.asks;
    const byPrice = /* @__PURE__ */ new Map();
    for (const candidate of currentSide) {
      if (candidate.side !== side || byPrice.has(candidate.price) || usedCurrent.has(candidate.entryId)) return void 0;
      byPrice.set(candidate.price, candidate);
      usedCurrent.add(candidate.entryId);
    }
    for (const archived of historySide) {
      const live = byPrice.get(archived.price);
      if (!live || live.side !== archived.side || live.rank !== archived.rank || live.quantity !== archived.quantity || live.notional !== archived.notional || live.startEpoch !== archived.startEpoch || (live.confirmationAt ?? null) !== (archived.confirmationAt ?? null) || usedHistory.has(archived.entryId)) return void 0;
      if (mapping.has(live.entryId) && mapping.get(live.entryId) !== archived.entryId) return void 0;
      mapping.set(live.entryId, archived.entryId);
      usedHistory.add(archived.entryId);
    }
  }
  return mapping;
}
function pagesContinueFrom(pages, cursor, finalCursor, joinAt, epoch) {
  let covered = cursor;
  for (const page of pages) {
    if (page.page.nextAfter <= covered) continue;
    if (page.page.after > covered || page.head?.epoch !== epoch || page.patches.some((patch) => patch.kind === "gap" || patch.epoch !== epoch)) return false;
    const headAt = page.head?.at;
    if (headAt === void 0) return false;
    if ((page.coverage?.gaps ?? []).some((gap) => {
      const from = gap.from ?? gap.at ?? 0, to = gap.to ?? gap.at ?? from;
      return from <= headAt && to > joinAt;
    })) return false;
    covered = Math.max(covered, page.page.nextAfter);
  }
  return covered >= finalCursor;
}
function remapCurrentPage(page, entryIds) {
  if (!entryIds?.size || !page.patches.length) return page;
  const patches = page.patches.map((patch) => {
    const removed = [];
    const remapCandidate = (candidate) => {
      const id = entryIds.get(candidate.entryId);
      return id ? { ...candidate, entryId: id } : candidate;
    };
    const remapRemoval = (removal) => {
      const id = entryIds.get(removal.entryId);
      if (!id) return removal;
      removed.push(removal.entryId);
      return { ...removal, entryId: id };
    };
    const result = {
      ...patch,
      bids: { upserts: patch.bids.upserts.map(remapCandidate), removals: patch.bids.removals.map(remapRemoval) },
      asks: { upserts: patch.asks.upserts.map(remapCandidate), removals: patch.asks.removals.map(remapRemoval) }
    };
    for (const id of removed) entryIds.delete(id);
    return result;
  });
  return { ...page, patches };
}
function profileSettings(request) {
  const aggregation = request.aggregation === "native" ? "native" : Number(String(request.aggregation).replace(/usdt$/, ""));
  return orderWallsSettings({
    ...DEFAULT_ORDER_WALLS_SETTINGS,
    enabled: true,
    mode: "top-levels",
    aggregation,
    searchRangePercent: request.bandPercent,
    topLevels: request.selectionTopN ?? 10,
    minimumNotionalEnabled: request.minimumNotionalUsd !== null,
    ...request.minimumNotionalUsd !== null ? { minimumNotionalUsd: Number(request.minimumNotionalUsd) } : {},
    minDurationMs: request.confirmationMs ?? 0
  });
}
function toOrderWallScope(scope) {
  if (!scope) return void 0;
  const bidFloor = Number(scope.snapshotBidFloor ?? scope.bidFloor ?? scope.observedBidLow);
  const askCeiling = Number(scope.snapshotAskCeiling ?? scope.askCeiling ?? scope.observedAskHigh);
  const maxLevelsPerSide = scope.maxLevelsPerSide ?? Math.max(scope.snapshotLevels?.bids ?? 0, scope.snapshotLevels?.asks ?? 0, 1);
  return {
    maxLevelsPerSide,
    bidComplete: scope.bidComplete ?? scope.bandCoverage?.bids === "observed",
    askComplete: scope.askComplete ?? scope.bandCoverage?.asks === "observed",
    ...Number.isFinite(bidFloor) && bidFloor > 0 ? { bidFloor } : {},
    ...Number.isFinite(askCeiling) && askCeiling > 0 ? { askCeiling } : {}
  };
}
function emptyArchiveStatus(request, state, reason) {
  const settings = orderWallsSettings(request.settings);
  const availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  return {
    profileId: request.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? "",
    state,
    requestComplete: state !== "loading",
    rangeComplete: false,
    from: request.from,
    to: request.to,
    market: request.market === "binance-spot" ? "spot" : "perpetual",
    aggregation: settings.aggregation === "native" ? "native" : `${settings.aggregation}usdt`,
    gaps: [],
    requestedBandPercent: settings.searchRangePercent,
    profileBandPercent: settings.searchRangePercent,
    requestedTopN: settings.topLevels,
    exact: availability.exact,
    ...reason ? { reason } : {}
  };
}
function sameWallSegment(a, b) {
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (key === "valueRuns") continue;
    if (a[key] !== b[key]) return false;
  }
  if (a.valueRuns.length !== b.valueRuns.length) return false;
  return a.valueRuns.every((point, index) => {
    const other = b.valueRuns[index];
    return point.at === other.at && point.usd === other.usd && point.percentile === other.percentile && point.rank === other.rank && point.quantity === other.quantity && point.quantityExact === other.quantityExact && point.notionalExact === other.notionalExact;
  });
}
export {
  OrderWallsArchiveProjector,
  OrderWallsArchiveService,
  wallHistoryPresentation
};

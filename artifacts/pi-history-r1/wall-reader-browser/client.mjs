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
    return { signal: combined, assertActive, release };
  } catch (error) {
    release();
    throw error;
  }
}
export {
  acquirePreparedWallReadLease,
  historyScheduler,
  wallReadControlScheduler
};

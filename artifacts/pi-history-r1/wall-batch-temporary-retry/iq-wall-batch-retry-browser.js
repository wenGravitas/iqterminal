"use strict";
var WallBatchRetry = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/feed/prepared-wall-batch.ts
  var prepared_wall_batch_exports = {};
  __export(prepared_wall_batch_exports, {
    acquireWallBatch: () => acquireWallBatch
  });

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
  return __toCommonJS(prepared_wall_batch_exports);
})();

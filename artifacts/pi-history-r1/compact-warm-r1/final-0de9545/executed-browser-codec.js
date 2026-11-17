"use strict";
var CompactWallCodec = (() => {
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

  // scripts/compact-wall-browser-entry.ts
  var compact_wall_browser_entry_exports = {};
  __export(compact_wall_browser_entry_exports, {
    compactWallPresentation: () => compactWallPresentation,
    replayCompactWallPresentation: () => replayCompactWallPresentation
  });

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
  return __toCommonJS(compact_wall_browser_entry_exports);
})();

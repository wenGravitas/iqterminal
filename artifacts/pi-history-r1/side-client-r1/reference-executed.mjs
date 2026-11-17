// ops/pi-wall-default-resume-reference.mjs
import assert from "node:assert/strict";
import { readFile as readFile2 } from "node:fs/promises";
import { join as join3, resolve } from "node:path";
import { createHash as createHash3 } from "node:crypto";
import { promisify as promisify4 } from "node:util";
import { gunzip as unzip2 } from "node:zlib";

// src/wall-canonical-overlap.ts
import { gunzip as unzip } from "node:zlib";
import { promisify } from "node:util";

// src/query-timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
var queryTiming = new AsyncLocalStorage();

// src/db.ts
var url = process.env.CH_URL ?? "http://127.0.0.1:18123";

// src/wall-canonical-overlap.ts
var gunzip = promisify(unzip);
var SCAN_BYTES = 8 * 1024 * 1024;
var ROW_BYTES = 16 * 1024 * 1024;

// src/market.ts
function backendMarket(value) {
  if (value === void 0 || value === null || value === "" || value === "perpetual") return "perpetual";
  if (value === "spot") return "spot";
  throw new Error("Unsupported market; expected spot or perpetual");
}
function marketConfig(value) {
  const market = backendMarket(value);
  if (market === "spot") return {
    market,
    instrument: "binance:spot:BTCUSDT",
    executionFeed: "binance:spot:BTCUSDT:aggregate-trade",
    depthFeed: "binance:spot:BTCUSDT:spot-diff-depth",
    executionTable: "spot_executions",
    depthTable: "spot_depth_records",
    restBase: process.env.BINANCE_SPOT_REST_URL ?? "https://api.binance.com",
    websocketBase: process.env.BINANCE_SPOT_WS_URL ?? "wss://stream.binance.com:9443",
    depthStream: "wss://stream.binance.com:9443/ws/btcusdt@depth@100ms",
    depthSnapshotPath: "/api/v3/depth?symbol=BTCUSDT&limit=5000",
    candlePath: (interval, from) => `/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=1000${from ? `&startTime=${from}` : ""}`
  };
  return {
    market,
    instrument: "binance:perpetual:BTCUSDT",
    executionFeed: "binance:perpetual:BTCUSDT:aggregate-trade",
    depthFeed: "usd-m-standard-diff-depth-rpi-excluded",
    executionTable: "executions",
    depthTable: "depth_records",
    restBase: "https://fapi.binance.com",
    websocketBase: "wss://fstream.binance.com",
    depthStream: "wss://fstream.binance.com/public/ws/btcusdt@depth@100ms",
    depthSnapshotPath: "/fapi/v1/depth?symbol=BTCUSDT&limit=1000",
    candlePath: (interval, from) => `/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=1000${from ? `&startTime=${from}` : ""}`
  };
}
function historyFeed(value) {
  return marketConfig(value).depthFeed.startsWith("usd-m-") ? "binance:perpetual:BTCUSDT:usd-m-standard-diff-depth-rpi-excluded" : marketConfig(value).depthFeed;
}

// src/history-reader.ts
var config = marketConfig(process.env.HISTORY_MARKET ?? process.env.MARKET);
var table = config.depthTable;
var source = `venue='binance' AND market='${config.market}' AND nativeSymbol='BTCUSDT' AND feed='${config.depthFeed}'`;

// src/order-walls-archive.ts
var ARCHIVE_EVENT_RETENTION_DEFAULT_DAYS = 7;
var ARCHIVE_EVENT_RETENTION_MAX_DAYS = 30;
function archiveRetentionDays(value) {
  if (value === void 0) return ARCHIVE_EVENT_RETENTION_DEFAULT_DAYS;
  if (!/^\d+$/.test(value)) throw new Error("ORDER_WALL_ARCHIVE_RETENTION_DAYS must be an integer from 1 to 30");
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > ARCHIVE_EVENT_RETENTION_MAX_DAYS) {
    throw new Error("ORDER_WALL_ARCHIVE_RETENTION_DAYS must be an integer from 1 to 30");
  }
  return days;
}
var ARCHIVE_EVENT_RETENTION_DAYS = archiveRetentionDays(process.env.ORDER_WALL_ARCHIVE_RETENTION_DAYS);
var ARCHIVE_ANCHOR_INTERVAL_MS = 15 * 6e4;
var ARCHIVE_CARRY_IN_TTL_CUSHION_MINUTES = Math.ceil(ARCHIVE_ANCHOR_INTERVAL_MS / 6e4) + 1;
var ARCHIVE_CUSTOM_IDLE_TTL_MS = 24 * 60 * 6e4;
var ARCHIVE_PROFILE_IDS = Object.freeze({
  spot: "binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1",
  perpetual: "binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1"
});
var MAX_REPLAY_BYTES = 16 * 1024 * 1024;
function canonicalProfileConfig(value) {
  const bandPercent = Number(value.bandPercent.toFixed(4));
  if (!Number.isFinite(bandPercent) || bandPercent < 0.01 || bandPercent > 10 || Math.abs(value.bandPercent - bandPercent) > 1e-8) throw new Error("Invalid Order Walls range profile");
  if (!["native", 10, 25, 50, 100, 250].includes(value.aggregation)) throw new Error("Invalid Order Walls aggregation profile");
  const confirmationMs = value.confirmationMs ?? 0;
  if (!Number.isFinite(confirmationMs) || confirmationMs < 0 || confirmationMs > 6e4) throw new Error("Invalid Order Walls confirmation profile");
  if (confirmationMs === 0) return { bandPercent, aggregation: value.aggregation, confirmationMs: 0, selectionTopN: 10, minimumNotionalUsd: null };
  if (!Number.isSafeInteger(value.selectionTopN) || value.selectionTopN < 1 || value.selectionTopN > 10) throw new Error("Delayed confirmation profiles require an exact Top N selection");
  return {
    bandPercent,
    aggregation: value.aggregation,
    confirmationMs,
    selectionTopN: value.selectionTopN,
    minimumNotionalUsd: canonicalUsd(value.minimumNotionalUsd)
  };
}
function percentSlug(value) {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", "_");
}
function decimalSlug(value) {
  return value.replace(".", "_");
}
function feedSlug(market) {
  const feed = marketConfig(market).depthFeed;
  return feed.startsWith("binance:spot:BTCUSDT:") ? feed.slice("binance:spot:BTCUSDT:".length) : feed;
}
function archiveProfile(market, rawConfig = { bandPercent: 10, aggregation: "native" }) {
  const config2 = marketConfig(market), profileConfig = canonicalProfileConfig(rawConfig);
  const marketSlug = market === "spot" ? "spot" : "usdm";
  const aggregation = profileConfig.aggregation === "native" ? "native" : `${profileConfig.aggregation}usdt`;
  const baseId = `binance-${marketSlug}-btcusdt-feed-${feedSlug(market)}-band-${percentSlug(profileConfig.bandPercent)}pct-agg-${aggregation}-top10-a1-s1`;
  const confirmationSlug = decimalSlug(canonicalUsd(profileConfig.confirmationMs));
  const id = profileConfig.confirmationMs === 0 ? baseId : `${baseId}-confirm-${confirmationSlug}ms-n${profileConfig.selectionTopN}-${profileConfig.minimumNotionalUsd === null ? "minoff" : `minusd-${decimalSlug(profileConfig.minimumNotionalUsd)}`}`;
  return {
    id,
    version: 1,
    market,
    venue: "binance",
    instrument: config2.instrument,
    feed: historyFeed(market),
    aggregation: profileConfig.aggregation,
    bandPercent: profileConfig.bandPercent,
    selectionTopN: profileConfig.selectionTopN,
    minimumNotionalUsd: profileConfig.minimumNotionalUsd,
    confirmationMs: profileConfig.confirmationMs,
    midpointBasis: "best-observed-bid-ask",
    topN: 10,
    algorithmVersion: 1,
    schemaVersion: 1,
    exactDerivations: {
      bandPercent: [profileConfig.bandPercent],
      topNMax: profileConfig.confirmationMs === 0 ? 10 : profileConfig.selectionTopN,
      minimumNotional: true,
      confirmation: true,
      confirmationCrossings: true
    }
  };
}
function parseArchiveProfileId(market, id) {
  const prefix = `binance-${market === "spot" ? "spot" : "usdm"}-btcusdt-feed-${feedSlug(market)}-`;
  if (!id.startsWith(prefix)) return null;
  const suffix = /^band-(\d+(?:_\d+)?)pct-agg-(native|\d+usdt)-top10-a1-s1(?:-confirm-(\d+(?:_\d+)?)ms-n(\d+)-(minoff|minusd-(\d+(?:_\d+)?)))?$/.exec(id.slice(prefix.length));
  if (!suffix) return null;
  const bandPercent = Number(suffix[1].replace("_", "."));
  const aggregation = suffix[2] === "native" ? "native" : Number(suffix[2].slice(0, -4));
  try {
    const config2 = canonicalProfileConfig({
      bandPercent,
      aggregation,
      ...suffix[3] ? {
        confirmationMs: Number(suffix[3].replace("_", ".")),
        selectionTopN: Number(suffix[4]),
        minimumNotionalUsd: suffix[5] === "minoff" ? null : suffix[6].replace("_", ".")
      } : {}
    });
    const profile = archiveProfile(market, config2);
    return profile.id === id ? { profile, config: config2 } : null;
  } catch {
    return null;
  }
}
function canonicalUsd(value) {
  if (value === null || value === void 0) return null;
  const raw = typeof value === "number" ? value.toString() : value;
  if (typeof raw !== "string" || raw.length > 350) throw new Error("Invalid Order Walls minimum notional profile");
  const expanded = expandDecimalExponent(raw);
  if (!/^\d+(?:\.\d+)?$/.test(expanded)) throw new Error("Invalid Order Walls minimum notional profile");
  let [whole, fraction = ""] = expanded.split(".");
  whole = BigInt(whole).toString();
  fraction = fraction.replace(/0+$/, "");
  const normalized = `${whole}${fraction ? `.${fraction}` : ""}`;
  if (Number(normalized) > 1e12) throw new Error("Invalid Order Walls minimum notional profile");
  return normalized;
}
function expandDecimalExponent(value) {
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponentText] = value.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return value;
  const [whole, fraction = ""] = mantissa.split("."), digits = whole + fraction, decimalAt = whole.length + exponent;
  return decimalAt <= 0 ? `0.${"0".repeat(-decimalAt)}${digits}` : decimalAt >= digits.length ? `${digits}${"0".repeat(decimalAt - digits.length)}` : `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
}

// src/wall-source-version.ts
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validateWallSourceRequest(request) {
  if (!["spot", "perpetual"].includes(request.market) || !parseArchiveProfileId(request.market, request.profile) || !integer(request.from) || !integer(request.to) || request.from <= 0 || request.to <= request.from || request.to - request.from > 48 * 36e5) throw Error("Invalid bounded wall source version request");
}

// src/wall-history-chunks.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { gzip as gzipCallback } from "node:zlib";
import { promisify as promisify2 } from "node:util";
var gzip = promisify2(gzipCallback);
var WALL_CHUNK_MS = 60 * 60 * 1e3;
var MAX_PART_BYTES = 4 * 1024 * 1024;
var MAX_PARTS = 128;
var digest = (text) => createHash("sha256").update(text).digest("hex");
async function boundedFile(file, maxBytes, signal) {
  signal?.throwIfAborted();
  const handle = await open(file, "r");
  try {
    if ((await handle.stat()).size > maxBytes) throw Error("Prepared wall file byte budget");
    return await handle.readFile({ signal });
  } finally {
    await handle.close();
  }
}
async function readWallChunkManifest(root2, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid wall chunk key");
  const state = JSON.parse((await boundedFile(join(root2, key, "manifest.json"), 128 * 1024, signal)).toString());
  if (![4, 5].includes(state.version) || state.key !== key || state.complete !== true || state.after !== state.watermark || !Array.isArray(state.parts) || !state.parts.length || state.parts.length > MAX_PARTS) throw Error("Invalid prepared wall manifest");
  if (state.version === 5) {
    const proof = state.sourceProof;
    if (!proof || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token ?? "") || verifiedWallViewKey(proof) !== key || proof.watermark !== state.watermark || !sameWallRequest(state.request, proof) || JSON.stringify(state.head) !== JSON.stringify(proof.head)) throw Error("Invalid prepared wall source proof");
  }
  for (let i = 0; i < state.parts.length; i++) {
    const p = state.parts[i];
    if (p.projectionReplay && (!/^[a-f0-9]{64}$/.test(p.projectionReplay.hash) || !Number.isSafeInteger(p.projectionReplay.maxAt) || p.projectionReplay.maxAt < 0)) throw Error("Invalid canonical wall replay identity");
    if (p.index !== i || !/^([a-f0-9]{64})$/.test(p.canonicalHash) || !/^([a-f0-9]{64})$/.test(p.hash) || !/^([a-f0-9]{64})$/.test(p.compressedHash) || p.encoding !== "json-gzip-v1" || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > MAX_PART_BYTES || !Number.isSafeInteger(p.compressedBytes) || p.compressedBytes < 1 || p.compressedBytes > MAX_PART_BYTES + 1024) throw Error("Invalid prepared wall part metadata");
    if (state.version === 5 && (!Number.isSafeInteger(p.after) || p.after < 0 || !Number.isSafeInteger(p.nextAfter) || p.nextAfter < p.after || p.nextAfter > state.watermark || i > 0 && p.after !== state.parts[i - 1].nextAfter || i < state.parts.length - 1 && p.nextAfter <= p.after || i === state.parts.length - 1 && p.nextAfter !== state.watermark)) throw Error("Invalid prepared wall part cursor chain");
  }
  if (digest(JSON.stringify(state.parts.map((p) => p.canonicalHash))) !== state.request.sourceRevision) throw Error("Prepared wall manifest source revision mismatch");
  return state;
}
async function readWallChunkPart(root2, key, hash2, signal) {
  if (!/^[a-f0-9]{64}$/.test(hash2)) throw Error("Invalid wall part hash");
  const manifest = await readWallChunkManifest(root2, key, signal), part = manifest.parts.find((p) => p.hash === hash2);
  if (!part) throw Error("Wall part is not in the completed manifest");
  const body = await boundedFile(join(root2, key, hash2 + ".json.gz"), MAX_PART_BYTES + 1024, signal);
  if (body.byteLength !== part.compressedBytes || digest(body) !== part.compressedHash) throw Error("Prepared wall part content hash mismatch");
  return { body, part, manifest };
}
var sameWallRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function verifiedWallViewKey(proof) {
  validateWallSourceRequest(proof);
  if (proof.version !== 1 || ![proof.head?.cursor, proof.head?.epoch, proof.head?.at].every((value) => Number.isSafeInteger(value) && value >= 0) || proof.head.at < proof.to || proof.kind !== "wall-source-sha256-xor-v1" || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token) || !Number.isSafeInteger(proof.watermark) || proof.watermark < 0 || proof.head.cursor !== proof.watermark) throw Error("Invalid prepared wall view source");
  return digest(JSON.stringify({ version: 5, market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, sourceToken: proof.token }));
}

// src/wall-history-projection.ts
import { createHash as createHash2 } from "node:crypto";
import { open as open2, mkdir as mkdir2 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { promisify as promisify3 } from "node:util";
import { gzip as gzipCallback2, gunzip as gunzipCallback } from "node:zlib";

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
    for (const [i, source2] of state.segments.entries()) {
      const segment = cloneSegment(source2);
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
    for (const source2 of state.candidates) {
      const { segmentId: segmentId2, ...candidate } = source2;
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
    for (const [i, source2] of state.segments.entries()) {
      const segment = { ...source2, valueRuns: [] };
      projector.segments.set(segment.id, segment);
      for (const [j, point] of source2.valueRuns.entries()) {
        const copied = { ...point }, sequence = state.valueRunOrder[i][j];
        segment.valueRuns.push(copied);
        projector.valueRunSequences.set(copied, sequence);
        projector.valueRunQueue.push({ id: segment.id, sequence });
        projector.totalValueRuns++;
        if (++work % 256 === 0) yield;
      }
      projector.emittedValues.set(segment.id, { first: segment.valueRuns[0], last: segment.valueRuns.at(-1), length: segment.valueRuns.length });
      if (++work % 256 === 0) yield;
    }
    yield* sortValueQueueSteps(projector.valueRunQueue);
    for (const source2 of state.candidates) {
      const { segmentId: segmentId2, ...candidate } = source2;
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
  const ids2 = /* @__PURE__ */ new Map(), sequences = /* @__PURE__ */ new Set();
  let runs = 0, work = 0;
  for (const gap of v.seenGaps) {
    if (typeof gap !== "string") fail();
    if (++work % 256 === 0) yield;
  }
  for (const [i, segment] of v.segments.entries()) {
    if (!isRecord(segment) || typeof segment.id !== "string" || !segment.id || ids2.has(segment.id) || typeof segment.archiveEntryId !== "string" || !segment.archiveEntryId || !validInt(segment.epoch) || !["bid", "ask"].includes(segment.side) || !validDecimal(segment.priceExact) || segment.price !== Number(segment.priceExact) || !finiteNonNegative(segment.price) || segment.price <= 0 || !finiteNonNegative(segment.start) || segment.end !== null && (!finiteNonNegative(segment.end) || segment.end < segment.start) || !finiteNonNegative(segment.peakUsd) || !finiteNonNegative(segment.meanUsd) || !finiteNonNegative(segment.durationMs) || segment.percentile !== null || typeof segment.scopePartial !== "boolean" || typeof segment.startKnown !== "boolean" || typeof segment.endKnown !== "boolean" || segment.detectionMode !== "top-levels" || !validInt(segment.rank) || segment.rank < 1 || segment.rank > 10 || typeof segment.valueRunsTruncated !== "boolean" || segment.valueRunsTruncated && !v.valueHistoryLimited || !["below-threshold", "removed", "censored", "rank-exit", "out-of-range", "below-minimum", null].includes(segment.endReason) || segment.censoredReason !== void 0 && typeof segment.censoredReason !== "string" || !Array.isArray(segment.valueRuns) || segment.valueRuns.length > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT || !Array.isArray(v.valueRunOrder[i]) || v.valueRunOrder[i].length !== segment.valueRuns.length) fail();
    for (const [j, point] of segment.valueRuns.entries()) {
      const sequence = v.valueRunOrder[i][j];
      if (!isRecord(point) || !finiteNonNegative(point.at) || point.percentile !== null || !validInt(point.rank) || point.rank < 1 || point.rank > 10 || !validDecimal(point.quantityExact) || !validDecimal(point.notionalExact) || point.quantity !== Number(point.quantityExact) || point.usd !== Number(point.notionalExact) || !finiteNonNegative(point.quantity) || !finiteNonNegative(point.usd) || !validInt(sequence) || sequence < 1 || sequence > v.nextValueRunSequence || sequences.has(sequence)) fail();
      sequences.add(sequence);
      runs++;
      if (++work % 256 === 0) yield;
    }
    ids2.set(segment.id, segment);
    if (++work % 256 === 0) yield;
  }
  if (runs > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS) fail();
  const candidateIds = /* @__PURE__ */ new Set(), activeIds = /* @__PURE__ */ new Set();
  for (const state of v.candidates) {
    if (!isRecord(state) || !validCandidate(state.candidate) || candidateIds.has(state.candidate.entryId) || typeof state.eligible !== "boolean" || state.eligible !== (state.candidate.rank <= settings.topLevels && (!settings.minimumNotionalEnabled || compareDecimalToNumber(state.candidate.notional, settings.minimumNotionalUsd) >= 0)) || !finiteNonNegative(state.lastAt) || !finiteNonNegative(state.usdMs) || !finiteNonNegative(state.peakUsd) || typeof state.qualifyingStartKnown !== "boolean" || state.qualifyingAt !== void 0 && !finiteNonNegative(state.qualifyingAt) || state.qualifyingCursor !== void 0 && !validInt(state.qualifyingCursor) || state.qualifyingCandidate !== void 0 && (!validCandidate(state.qualifyingCandidate) || state.qualifyingCandidate.entryId !== state.candidate.entryId) || state.valueSignature !== void 0 && typeof state.valueSignature !== "string") fail();
    if (state.segmentId !== void 0) {
      const segment = ids2.get(state.segmentId);
      if (typeof state.segmentId !== "string" || activeIds.has(state.segmentId) || !segment || segment.end !== null || !state.eligible || segment.archiveEntryId !== state.candidate.entryId) fail();
      activeIds.add(state.segmentId);
    }
    candidateIds.add(state.candidate.entryId);
  }
  for (const segment of ids2.values()) {
    if (segment.end === null && !activeIds.has(segment.id)) fail();
    if (++work % 256 === 0) yield;
  }
}
function* sortValueQueueSteps(values) {
  const length = values.length;
  if (length < 2) return;
  let source2 = values, target = new Array(length), work = 0;
  const run = 1024;
  for (let start = 0; start < length; start += run) {
    const chunk = values.slice(start, Math.min(start + run, length)).sort((a, b) => a.sequence - b.sequence);
    for (let i = 0; i < chunk.length; i++) values[start + i] = chunk[i];
    yield;
  }
  for (let width = run; width < length; width *= 2) {
    for (let start = 0; start < length; start += width * 2) {
      const mid = Math.min(start + width, length), end = Math.min(start + width * 2, length);
      let left = start, right = mid;
      for (let at = start; at < end; at++) {
        target[at] = right >= end || left < mid && source2[left].sequence <= source2[right].sequence ? source2[left++] : source2[right++];
        if (++work % 1024 === 0) yield;
      }
    }
    [source2, target] = [target, source2];
  }
  if (source2 !== values) for (let i = 0; i < length; i++) {
    values[i] = source2[i];
    if (++work % 1024 === 0) yield;
  }
}

// src/shared/order-walls-projection-version.ts
var WALL_PROJECTION_CORE_SHA256 = "c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c";

// src/wall-history-projection.ts
var gzip2 = promisify3(gzipCallback2);
var gunzip2 = promisify3(gunzipCallback);
var hash = (value) => createHash2("sha256").update(value).digest("hex");
var WALL_PROJECTION_PART_BYTES = 4 * 1024 * 1024;
var MAX_STATE_BYTES = 32 * 1024 * 1024;
var MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
var MAX_PARTS2 = 512;
async function boundedRead(path, max) {
  const file = await open2(path, "r");
  try {
    if ((await file.stat()).size > max) throw Error("Prepared wall projection file capacity");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function readPreparedWallProjectionManifest(root2, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid prepared wall projection key");
  signal?.throwIfAborted();
  const state = JSON.parse((await boundedRead(join2(root2, key, "manifest.json"), 8 * 1024 * 1024)).toString());
  if (state.version !== 2 || state.key !== key || state.core !== WALL_PROJECTION_CORE_SHA256 || !state.complete || preparedWallProjectionKey(state.sourceKey, state.settings) !== key || !Array.isArray(state.parts) || state.parts.length > MAX_PARTS2 || !Array.isArray(state.closed) || state.closed.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || !state.active || state.activeOrder?.length !== state.active.segments?.length) throw Error("Invalid prepared wall projection manifest");
  let bytes = 0;
  const hashes = /* @__PURE__ */ new Set();
  for (const part of state.parts) {
    if (!/^[a-f0-9]{64}$/.test(part.hash) || !/^[a-f0-9]{64}$/.test(part.compressedHash) || hashes.has(part.hash) || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > WALL_PROJECTION_PART_BYTES || !Number.isSafeInteger(part.compressedBytes) || part.compressedBytes < 1 || part.compressedBytes > WALL_PROJECTION_PART_BYTES + 1024 || !Number.isSafeInteger(part.records) || part.records < 1) throw Error("Invalid prepared wall projection part");
    hashes.add(part.hash);
    bytes += part.bytes;
  }
  if (bytes > MAX_OUTPUT_BYTES) throw Error("Prepared wall projection output capacity");
  signal?.throwIfAborted();
  return state;
}
function normalizedSettings(s) {
  if (!Number.isSafeInteger(s.topLevels) || s.topLevels < 1 || s.topLevels > 100 || typeof s.minimumNotionalEnabled !== "boolean" || !Number.isFinite(s.minimumNotionalUsd) || s.minimumNotionalUsd < 0 || !Number.isSafeInteger(s.minDurationMs) || s.minDurationMs < 0) throw Error("Invalid prepared wall projection settings");
  return { topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs };
}
function preparedWallProjectionKey(sourceKey, settings) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw Error("Invalid prepared wall projection source key");
  return hash(JSON.stringify({ version: 2, sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalizedSettings(settings) }));
}
async function restorePreparedWallProjectionManifest(root2, state) {
  if (state.core !== WALL_PROJECTION_CORE_SHA256 || state.key !== preparedWallProjectionKey(state.sourceKey, state.settings) || !state.complete || state.parts.length > MAX_PARTS2 || state.parts.reduce((sum, p) => sum + p.bytes, 0) > MAX_OUTPUT_BYTES || !Array.isArray(state.closed) || state.closed.length + state.active.segments.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || state.activeOrder.length !== state.active.segments.length) throw Error("Invalid prepared wall projection manifest");
  const retained = /* @__PURE__ */ new Map(), coordinates = /* @__PURE__ */ new Set();
  for (const group of state.closed) {
    if (!Array.isArray(group) || !group.length) throw Error("Invalid prepared wall projection coordinates");
    for (const pair of group) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger) || pair[0] < 0 || pair[0] >= state.parts.length || pair[1] < 0 || pair[1] >= state.parts[pair[0]].records || coordinates.has(pair.join(":"))) throw Error("Invalid prepared wall projection coordinates");
      coordinates.add(pair.join(":"));
      const rows = retained.get(pair[0]) ?? [];
      rows.push(pair[1]);
      retained.set(pair[0], rows);
    }
  }
  const rowsByCoordinate = /* @__PURE__ */ new Map(), records = [];
  for (const [index, part] of state.parts.entries()) {
    const selected = retained.get(index);
    if (!selected) continue;
    if (!/^[a-f0-9]{64}$/.test(part.hash) || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > WALL_PROJECTION_PART_BYTES) throw Error("Invalid prepared wall projection part");
    const body = await boundedRead(join2(root2, state.key, part.hash + ".json.gz"), WALL_PROJECTION_PART_BYTES + 1024);
    if (body.byteLength !== part.compressedBytes || hash(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
    const text = await gunzip2(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    if (text.byteLength !== part.bytes || hash(text) !== part.hash) throw Error("Prepared wall projection decoded hash mismatch");
    const rows = JSON.parse(text.toString());
    if (!Array.isArray(rows) || rows.length !== part.records) throw Error("Prepared wall projection record count mismatch");
    for (const row of selected) {
      const record = rows[row];
      if (record.segment.end === null) throw Error("Prepared wall projection record index mismatch");
      rowsByCoordinate.set(index + ":" + row, record);
    }
  }
  for (const group of state.closed) {
    const fragments = group.map((pair) => rowsByCoordinate.get(pair.join(":"))), first = fragments[0];
    if (!first) throw Error("Prepared wall projection missing fragment");
    const { valueRuns: _values, ...header } = first.segment;
    let count = 0;
    for (const record of fragments) {
      const { valueRuns, ...nextHeader } = record.segment;
      if (record.offset !== count || record.totalRuns !== first.totalRuns || record.order !== first.order || JSON.stringify(nextHeader) !== JSON.stringify(header) || record.valueRunOrder.length !== valueRuns.length) throw Error("Prepared wall projection fragment identity mismatch");
      count += valueRuns.length;
    }
    if (count !== first.totalRuns) throw Error("Prepared wall projection fragment coverage mismatch");
    records.push({ order: first.order, segment: { ...first.segment, valueRuns: fragments.flatMap((record) => record.segment.valueRuns) }, valueRunOrder: fragments.flatMap((record) => record.valueRunOrder) });
  }
  for (const [i, segment] of state.active.segments.entries()) {
    if (segment.end !== null) throw Error("Prepared wall projection active index mismatch");
    records.push({ order: state.activeOrder[i], segment, valueRunOrder: state.active.valueRunOrder[i] });
  }
  if (records.some((record) => !Number.isSafeInteger(record.order) || record.order < 0) || new Set(records.map((record) => record.order)).size !== records.length) throw Error("Prepared wall projection incomplete identities");
  records.sort((a, b) => a.order - b.order);
  return OrderWallsArchiveProjector.restoreCheckpoint({ ...state.active, segments: records.map((r) => r.segment), valueRunOrder: records.map((r) => r.valueRunOrder) }, state.settings, state.active.from, state.active.to, state.active.namespace);
}

// ops/pi-wall-default-resume-reference.mjs
if (process.env.IQ_WALL_DEFAULT_RESUME_REFERENCE !== "1") throw Error("Explicit resume-reference opt-in required");
var [rootText, idsText] = process.argv.slice(2);
var root = resolve(rootText ?? "");
var ids = (idsText ?? "").split(",");
var gunzip3 = promisify4(unzip2);
assert.ok(root.startsWith("/home/daz/") && ids.length >= 1 && ids.length <= 2 && ids.every((id) => /^[a-f0-9]{64}$/.test(id)), "Bounded isolated root and1..2job IDs required");
var queue = JSON.parse(await readFile2(join3(root, "queue/queue.json"), "utf8"));
var stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
var digest2 = (value) => createHash3("sha256").update(JSON.stringify(stable(value))).digest("hex");
for (const id of ids) {
  const began = performance.now(), job = queue.jobs.find((j) => j.id === id);
  assert.ok(job?.phase === "ready" && !job.failed, "Requested ready derived job missing");
  const source2 = await readWallChunkManifest(join3(root, "canonical"), job.sourceKey), manifest = await readPreparedWallProjectionManifest(join3(root, "projections"), job.projectionKey);
  assert.equal(manifest.sourceKey, source2.key);
  assert.equal(manifest.sourceToken, source2.sourceProof.token);
  assert.equal(digest2(manifest.coverage), digest2(source2.coverage));
  let reference = new OrderWallsArchiveProjector(manifest.settings, source2.request.from, source2.request.to);
  for (const part of source2.parts) {
    const { body } = await readWallChunkPart(join3(root, "canonical"), source2.key, part.hash), text = await gunzip3(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    assert.equal(text.length, part.bytes);
    assert.equal(createHash3("sha256").update(text).digest("hex"), part.hash);
    reference.applyPage(JSON.parse(text.toString()));
    await new Promise((resolve2) => setImmediate(resolve2));
  }
  assert.equal(reference.historyLimited, false, "Fresh reference reached retained capacity");
  const expected = /* @__PURE__ */ new Map(), order = [];
  let expectedRuns = 0;
  for (const segment of reference.snapshot()) {
    assert.ok(!expected.has(segment.id));
    expected.set(segment.id, digest2(segment));
    order.push(segment.id);
    expectedRuns += segment.valueRuns.length;
  }
  const selectedState = digest2(reference.selectedState());
  reference = void 0;
  const prepared = await restorePreparedWallProjectionManifest(join3(root, "projections"), manifest), actualOrder = [];
  let actualRuns = 0;
  assert.equal(prepared.historyLimited, false, "Restored projection reached retained capacity");
  for (const segment of prepared.snapshot()) {
    assert.equal(digest2(segment), expected.get(segment.id), "Exact segment/header/value-run mismatch: " + segment.id);
    actualOrder.push(segment.id);
    actualRuns += segment.valueRuns.length;
  }
  assert.deepEqual(actualOrder, order, "Stable episode ordering");
  assert.equal(actualRuns, expectedRuns);
  assert.equal(digest2(prepared.selectedState()), selectedState, "Exact selected boundary state");
  console.log(JSON.stringify({ kind: "real-wall-default-resume-equivalence", market: job.request.market, request: job.request, sourceKey: job.sourceKey, projectionKey: job.projectionKey, sourceToken: source2.sourceProof.token, canonicalParts: source2.parts.length, projectionParts: manifest.parts.length, segments: expected.size, valueRuns: expectedRuns, coverage: source2.coverage, financialHash: digest2([...expected]), selectedStateHash: selectedState, elapsedMs: performance.now() - began, memory: process.memoryUsage(), result: "exact-match", scope: "Fresh shared-projector fold versus resumed immutable projection; all financial segment/value fields, episode ordering, coverage and boundary selection; not raw-depth independence, chart latency or memory plateau" }));
}

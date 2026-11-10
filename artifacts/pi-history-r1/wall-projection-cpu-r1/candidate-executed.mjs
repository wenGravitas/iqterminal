// ops/profile-wall-projection.mjs
import assert from "node:assert/strict";
import { mkdir as mkdir4, readFile as readFile3, stat, statfs, readdir } from "node:fs/promises";
import { join as join3 } from "node:path";
import { createHash as createHash5 } from "node:crypto";
import { performance as performance2 } from "node:perf_hooks";

// src/wall-projection-replay.ts
import { createHash } from "node:crypto";
function wallProjectionReplay(page) {
  const { requestedTo: _to, confirmedTo: _confirmed, ...coverage } = page.coverage;
  let maxAt = 0;
  const at = (v) => {
    if (v !== void 0 && v !== null) {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw Error("Invalid wall projection replay time");
      maxAt = Math.max(maxAt, v);
    }
  };
  const candidate = (v) => {
    at(v.startedAt);
    at(v.confirmationAt);
  };
  at(page.page.lastAt);
  if (page.seed) {
    at(page.seed.at);
    for (const v of [...page.seed.bids, ...page.seed.asks]) candidate(v);
  }
  for (const patch of page.patches) {
    at(patch.at);
    for (const side of [patch.bids, patch.asks]) {
      for (const v of side.upserts) candidate(v);
      for (const v of side.removals) {
        at(v.at);
        at(v.lastConfirmedAt);
      }
    }
  }
  for (const gap of page.coverage.gaps) {
    at(gap.at);
    at(gap.from);
    at(gap.to);
  }
  const basis = {
    version: 1,
    profile: page.profile,
    market: page.market,
    instrument: page.instrument,
    feed: page.feed,
    from: page.from,
    epoch: page.head?.epoch,
    page: page.page,
    seed: page.seed,
    patches: page.patches,
    coverage
  };
  return { hash: createHash("sha256").update(JSON.stringify(basis)).digest("hex"), maxAt };
}

// src/wall-canonical-overlap.ts
import { gunzip as unzip } from "node:zlib";
import { promisify } from "node:util";

// src/db.ts
import { performance } from "node:perf_hooks";

// src/query-timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
var queryTiming = new AsyncLocalStorage();

// src/db.ts
var url = process.env.CH_URL ?? "http://127.0.0.1:18123";
async function sql(query2, data) {
  const started2 = performance.now(), m = queryTiming.getStore(), target = new URL(url);
  if (/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(query2)) target.searchParams.set("cancel_http_readonly_queries_on_client_close", "1");
  if (m) {
    m.queries++;
    if (m.requestId) target.searchParams.set("query_id", `${m.requestId}-${m.sequence = (m.sequence ?? 0) + 1}`);
  }
  try {
    const response = await fetch(target, { method: "POST", headers: { "X-ClickHouse-User": process.env.CH_USER ?? "iqterminal", "X-ClickHouse-Key": process.env.CH_PASSWORD ?? "", "X-IQ-SQL-Priority": m?.priority ?? "background" }, body: query2 + (data ? "\n" + data.map((x) => JSON.stringify(x)).join("\n") : ""), signal: m?.signal ? AbortSignal.any([AbortSignal.timeout(15e3), m.signal]) : AbortSignal.timeout(15e3) });
    const text = await response.text();
    if (m) {
      m.sqlQueueMs = (m.sqlQueueMs ?? 0) + Number(response.headers.get("x-iq-sql-wait-ms") ?? 0);
      m.bytes += Buffer.byteLength(text);
      try {
        const summary = JSON.parse(response.headers.get("x-clickhouse-summary") ?? "{}");
        m.readRows = (m.readRows ?? 0) + Number(summary.read_rows ?? 0);
        m.readBytes = (m.readBytes ?? 0) + Number(summary.read_bytes ?? 0);
      } catch {
      }
    }
    if (!response.ok || Number(response.headers.get("x-clickhouse-exception-code") ?? 0)) throw new Error(`ClickHouse ${response.status}: ${text.slice(0, 200)}`);
    return text;
  } finally {
    if (m) m.dbMs += performance.now() - started2;
  }
}
async function query(q) {
  const text = await sql(q + " FORMAT JSONEachRow");
  const start = performance.now();
  const rows = text.trim() ? text.trim().split("\n").map((x) => JSON.parse(x)) : [];
  const m = queryTiming.getStore();
  if (m) m.decodeMs += performance.now() - start;
  for (const row of rows) if (row.exception) throw Error(`ClickHouse streamed exception: ${String(row.exception).slice(0, 200)}`);
  return rows;
}

// src/history-state.ts
import { open, rename, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
async function atomicWrite(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path + ".tmp", "w", 384);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(path + ".tmp", path);
  const dir = await open(dirname(path), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

// src/wall-canonical-overlap.ts
var gunzip = promisify(unzip);
var SCAN_BYTES = 8 * 1024 * 1024;
var ROW_BYTES = 16 * 1024 * 1024;

// src/wall-source-version.ts
import { createHash as createHash2 } from "node:crypto";

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
var digest = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var settings = "enable_shared_storage_snapshot_in_query=1,max_threads=1,max_block_size=256,max_result_bytes=1048576,max_memory_usage=268435456,max_rows_to_read=4000000,max_bytes_to_read=536870912,max_execution_time=5";
var wallSourceRowHashSql = "reinterpretAsUInt256(SHA256(concat('wall1|',toString(epoch),'|',toString(cursor),'|',toString(at),'|',toString(length(kind)),':',kind,'|',toString(length(payload)),':',payload)))";
function validateWallSourceRequest(request) {
  if (!["spot", "perpetual"].includes(request.market) || !parseArchiveProfileId(request.market, request.profile) || !integer(request.from) || !integer(request.to) || request.from <= 0 || request.to <= request.from || request.to - request.from > 48 * 36e5) throw Error("Invalid bounded wall source version request");
}
function wallSourceVersionSql(request, anchorCursor, watermark) {
  validateWallSourceRequest(request);
  if (!integer(anchorCursor) || !integer(watermark) || watermark < anchorCursor) throw Error("Invalid wall source version cursor");
  const where = `(cursor>${anchorCursor} OR at>=${request.from}) AND cursor<=${watermark} AND at<${request.to}`;
  return `SELECT count() AS records,max(cursor) AS maxCursor,toString(groupBitXor(${wallSourceRowHashSql})) AS hash FROM iqterminal.order_wall_archive_events FINAL PREWHERE profile='${request.profile}' AND (epoch,cursor,kind) IN (SELECT epoch,cursor,kind FROM iqterminal.order_wall_archive_events FINAL WHERE profile='${request.profile}' AND ${where}) WHERE ${where} SETTINGS ${settings}`;
}
async function wallSourceVersion(request, read = query) {
  validateWallSourceRequest(request);
  request = { market: request.market, profile: request.profile, from: request.from, to: request.to };
  const progressRows = await read(`SELECT cursor,epoch,at,availableFrom FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${request.profile}' LIMIT 1 SETTINGS ${settings}`);
  if (progressRows.length !== 1) throw Error("Wall source progress unavailable");
  const progress = progressRows[0], head = { cursor: Number(progress.cursor), epoch: Number(progress.epoch), at: Number(progress.at) }, availableFrom = progress.availableFrom == null ? null : Number(progress.availableFrom);
  if (!Object.values(head).every(integer) || availableFrom !== null && !integer(availableFrom)) throw Error("Invalid wall source progress");
  const anchors = await read(`SELECT cursor,epoch,at,midpoint,bookScope,payload FROM iqterminal.order_wall_archive_anchors FINAL WHERE profile='${request.profile}' AND cursor<=${head.cursor} AND at<${request.from} ORDER BY at DESC,cursor DESC LIMIT 1 SETTINGS ${settings}`);
  if (anchors.length > 1) throw Error("Invalid wall source anchor count");
  const row = anchors[0];
  let anchor = null;
  if (row) {
    const cursor = Number(row.cursor), epoch = Number(row.epoch), at = Number(row.at);
    if (![cursor, epoch, at].every(integer) || cursor > head.cursor || at >= request.from || typeof row.payload !== "string" || typeof row.bookScope !== "string" || row.midpoint !== null && typeof row.midpoint !== "string") throw Error("Invalid wall source anchor");
    anchor = { cursor, epoch, at, hash: digest([cursor, epoch, at, row.midpoint, row.bookScope, row.payload]) };
  }
  let records = 0, maxCursor = 0, hash3 = "0";
  if (anchor) {
    const versions = await read(wallSourceVersionSql(request, anchor.cursor, head.cursor));
    if (versions.length !== 1) throw Error("Invalid wall source version result");
    records = Number(versions[0].records);
    maxCursor = Number(versions[0].maxCursor);
    hash3 = versions[0].hash;
    if (!integer(records) || !integer(maxCursor) || maxCursor > head.cursor || typeof hash3 !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(hash3) || BigInt(hash3) >= 1n << 256n || records === 0 && (maxCursor !== 0 || hash3 !== "0")) throw Error("Invalid canonical wall source version");
  }
  const reason = !anchor ? "No retained wall carry-in anchor" : availableFrom === null || request.from < availableFrom ? "Requested wall source predates retained coverage" : request.to > head.at ? "Wall source has not confirmed the requested tail" : void 0;
  const basis = { version: 1, kind: "wall-source-sha256-xor-v1", ...request, availableFrom, anchor, confirmedTo: Math.min(request.to, head.at), records, maxCursor, hash: hash3 };
  return { ...request, version: 1, kind: "wall-source-sha256-xor-v1", watermark: head.cursor, head, availableFrom, anchor, records, maxCursor, hash: hash3, token: digest(basis), eligible: reason === void 0, ...reason ? { reason } : {} };
}

// src/wall-history-chunks.ts
import { createHash as createHash3 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile2, open as open2 } from "node:fs/promises";
import { join } from "node:path";
import { gzip as gzipCallback } from "node:zlib";
import { promisify as promisify2 } from "node:util";
var gzip = promisify2(gzipCallback);
var WALL_CHUNK_MS = 60 * 60 * 1e3;
var MAX_PART_BYTES = 4 * 1024 * 1024;
var MAX_PARTS = 128;
var digest2 = (text) => createHash3("sha256").update(text).digest("hex");
async function boundedFile(file, maxBytes, signal) {
  signal?.throwIfAborted();
  const handle = await open2(file, "r");
  try {
    if ((await handle.stat()).size > maxBytes) throw Error("Prepared wall file byte budget");
    return await handle.readFile({ signal });
  } finally {
    await handle.close();
  }
}
async function readWallChunkManifest(root2, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid wall chunk key");
  const state2 = JSON.parse((await boundedFile(join(root2, key, "manifest.json"), 128 * 1024, signal)).toString());
  if (![4, 5].includes(state2.version) || state2.key !== key || state2.complete !== true || state2.after !== state2.watermark || !Array.isArray(state2.parts) || !state2.parts.length || state2.parts.length > MAX_PARTS) throw Error("Invalid prepared wall manifest");
  if (state2.version === 5) {
    const proof = state2.sourceProof;
    if (!proof || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token ?? "") || verifiedWallViewKey(proof) !== key || proof.watermark !== state2.watermark || !sameWallRequest(state2.request, proof) || JSON.stringify(state2.head) !== JSON.stringify(proof.head)) throw Error("Invalid prepared wall source proof");
  }
  for (let i = 0; i < state2.parts.length; i++) {
    const p = state2.parts[i];
    if (p.projectionReplay && (!/^[a-f0-9]{64}$/.test(p.projectionReplay.hash) || !Number.isSafeInteger(p.projectionReplay.maxAt) || p.projectionReplay.maxAt < 0)) throw Error("Invalid canonical wall replay identity");
    if (p.index !== i || !/^([a-f0-9]{64})$/.test(p.canonicalHash) || !/^([a-f0-9]{64})$/.test(p.hash) || !/^([a-f0-9]{64})$/.test(p.compressedHash) || p.encoding !== "json-gzip-v1" || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > MAX_PART_BYTES || !Number.isSafeInteger(p.compressedBytes) || p.compressedBytes < 1 || p.compressedBytes > MAX_PART_BYTES + 1024) throw Error("Invalid prepared wall part metadata");
    if (state2.version === 5 && (!Number.isSafeInteger(p.after) || p.after < 0 || !Number.isSafeInteger(p.nextAfter) || p.nextAfter < p.after || p.nextAfter > state2.watermark || i > 0 && p.after !== state2.parts[i - 1].nextAfter || i < state2.parts.length - 1 && p.nextAfter <= p.after || i === state2.parts.length - 1 && p.nextAfter !== state2.watermark)) throw Error("Invalid prepared wall part cursor chain");
  }
  if (digest2(JSON.stringify(state2.parts.map((p) => p.canonicalHash))) !== state2.request.sourceRevision) throw Error("Prepared wall manifest source revision mismatch");
  return state2;
}
async function readWallChunkPart(root2, key, hash3, signal) {
  if (!/^[a-f0-9]{64}$/.test(hash3)) throw Error("Invalid wall part hash");
  const manifest = await readWallChunkManifest(root2, key, signal), part = manifest.parts.find((p) => p.hash === hash3);
  if (!part) throw Error("Wall part is not in the completed manifest");
  const body = await boundedFile(join(root2, key, hash3 + ".json.gz"), MAX_PART_BYTES + 1024, signal);
  if (body.byteLength !== part.compressedBytes || digest2(body) !== part.compressedHash) throw Error("Prepared wall part content hash mismatch");
  return { body, part, manifest };
}
var sameWallRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function verifiedWallViewKey(proof) {
  validateWallSourceRequest(proof);
  if (proof.version !== 1 || ![proof.head?.cursor, proof.head?.epoch, proof.head?.at].every((value) => Number.isSafeInteger(value) && value >= 0) || proof.head.at < proof.to || proof.kind !== "wall-source-sha256-xor-v1" || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token) || !Number.isSafeInteger(proof.watermark) || proof.watermark < 0 || proof.head.cursor !== proof.watermark) throw Error("Invalid prepared wall view source");
  return digest2(JSON.stringify({ version: 5, market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, sourceToken: proof.token }));
}

// src/wall-history-projection.ts
import { createHash as createHash4 } from "node:crypto";
import { open as open3, mkdir as mkdir3 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { promisify as promisify3 } from "node:util";
import { gzip as gzipCallback2, gunzip as gunzipCallback } from "node:zlib";

// src/shared/order-walls-projection.ts
var ORDER_WALL_ARCHIVE_MAX_SEGMENTS = 1e5;
var ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS = 1e6;
var ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS_PER_SEGMENT = 1e5;
var OrderWallsArchiveProjector = class _OrderWallsArchiveProjector {
  constructor(settings2, from, to, segmentNamespace = "") {
    this.settings = settings2;
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
      candidates: [...this.candidates.values()].map(({ segment, ...state2 }) => ({
        ...state2,
        candidate: { ...state2.candidate },
        ...state2.qualifyingCandidate ? { qualifyingCandidate: { ...state2.qualifyingCandidate } } : {},
        ...segment ? { segmentId: segment.id } : {}
      })),
      nextValueRunSequence: this.nextValueRunSequence,
      emittedRevision: this.emittedRevision,
      valueHistoryLimited: this.valueHistoryLimited,
      episodeHistoryLimited: this.episodeHistoryLimited
    };
  }
  static restoreCheckpoint(value, settings2, from, to, namespace = "") {
    validateCheckpoint(value, settings2, from, to, namespace);
    const state2 = value, projector = new _OrderWallsArchiveProjector(settings2, from, to, namespace);
    projector.currentScope = state2.bookScope ? structuredClone(state2.bookScope) : void 0;
    projector.confirmedTo = state2.confirmedTo;
    projector.cursor = state2.cursor;
    projector.epoch = state2.epoch;
    projector.midpoint = state2.midpoint;
    projector.valueHistoryLimited = state2.valueHistoryLimited;
    projector.episodeHistoryLimited = state2.episodeHistoryLimited;
    projector.nextValueRunSequence = state2.nextValueRunSequence;
    projector.emittedRevision = state2.emittedRevision;
    for (const [i, source3] of state2.segments.entries()) {
      const segment = cloneSegment(source3);
      projector.segments.set(segment.id, segment);
      for (const [j, point] of segment.valueRuns.entries()) {
        const sequence = state2.valueRunOrder[i][j];
        projector.valueRunSequences.set(point, sequence);
        projector.valueRunQueue.push({ id: segment.id, sequence });
        projector.totalValueRuns++;
      }
      projector.emittedValues.set(segment.id, { first: segment.valueRuns[0], last: segment.valueRuns.at(-1), length: segment.valueRuns.length });
    }
    projector.valueRunQueue.sort((a, b) => a.sequence - b.sequence);
    for (const source3 of state2.candidates) {
      const { segmentId: segmentId2, ...candidate } = source3;
      projector.candidates.set(candidate.candidate.entryId, {
        ...candidate,
        candidate: { ...candidate.candidate },
        ...candidate.qualifyingCandidate ? { qualifyingCandidate: { ...candidate.qualifyingCandidate } } : {},
        ...segmentId2 ? { segment: projector.segments.get(segmentId2) } : {}
      });
    }
    for (const gap of state2.seenGaps) projector.seenGaps.add(gap);
    return projector;
  }
  /** The same financial validation, with bounded checkpoints during import.
   * The caller supplies its worker task scheduler; no DOM/timer is owned here.
   * Nothing is returned until validation, cloning and queue ordering finish. */
  static async restoreCheckpointCooperatively(value, settings2, from, to, work, namespace = "") {
    if (!Number.isFinite(work.budgetMs) || work.budgetMs <= 0 || work.budgetMs > 16) throw Error("Invalid wall import work budget");
    const steps = this.restoreCheckpointSteps(value, settings2, from, to, namespace);
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
  static *restoreCheckpointSteps(value, settings2, from, to, namespace) {
    yield* validateCheckpointSteps(value, settings2, from, to, namespace);
    const state2 = value, projector = new _OrderWallsArchiveProjector(settings2, from, to, namespace);
    projector.currentScope = state2.bookScope ? structuredClone(state2.bookScope) : void 0;
    projector.confirmedTo = state2.confirmedTo;
    projector.cursor = state2.cursor;
    projector.epoch = state2.epoch;
    projector.midpoint = state2.midpoint;
    projector.valueHistoryLimited = state2.valueHistoryLimited;
    projector.episodeHistoryLimited = state2.episodeHistoryLimited;
    projector.nextValueRunSequence = state2.nextValueRunSequence;
    projector.emittedRevision = state2.emittedRevision;
    let work = 0;
    for (const [i, source3] of state2.segments.entries()) {
      const segment = { ...source3, valueRuns: [] };
      projector.segments.set(segment.id, segment);
      for (const [j, point] of source3.valueRuns.entries()) {
        const copied = { ...point }, sequence = state2.valueRunOrder[i][j];
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
    for (const source3 of state2.candidates) {
      const { segmentId: segmentId2, ...candidate } = source3;
      projector.candidates.set(candidate.candidate.entryId, {
        ...candidate,
        candidate: { ...candidate.candidate },
        ...candidate.qualifyingCandidate ? { qualifyingCandidate: { ...candidate.qualifyingCandidate } } : {},
        ...segmentId2 ? { segment: projector.segments.get(segmentId2) } : {}
      });
    }
    for (const gap of state2.seenGaps) {
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
    const candidates = [...this.candidates.values()].map((state2) => state2.candidate);
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
  seedSelectedState(state2) {
    this.patchBuffer.clear();
    this.currentScope = state2.bookScope;
    this.cursor = state2.cursor;
    this.epoch = state2.epoch;
    this.midpoint = state2.midpoint;
    this.advanceAll(state2.at);
    for (const candidate of [...state2.bids, ...state2.asks]) this.upsert(candidate, state2.at, true);
    this.confirmedTo = state2.at;
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
    for (const [id, state2] of this.candidates) clone.candidates.set(id, {
      ...state2,
      segment: state2.segment ? clone.segments.get(state2.segment.id) : void 0,
      candidate: { ...state2.candidate },
      qualifyingCandidate: state2.qualifyingCandidate ? { ...state2.qualifyingCandidate } : void 0
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
    for (const [id, state2] of this.candidates) {
      const end = Math.min(at, state2.lastAt);
      this.advance(state2, end);
      if (state2.segment) this.close(state2, end, false, "censored", reason);
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
    const state2 = previous ?? this.newCandidateState(candidate, at, carryIn, eligible);
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
    this.candidates.set(candidate.entryId, state2);
    if (eligible) {
      if (carryIn) {
        state2.qualifyingAt = candidate.startKnown ? Math.max(0, candidate.startedAt) : at;
        state2.qualifyingCursor = candidate.startCursor;
        state2.qualifyingStartKnown = candidate.startKnown;
        state2.qualifyingCandidate = candidate;
      }
      this.maybeOpen(state2, at);
    }
  }
  newCandidateState(candidate, at, carryIn, eligible) {
    const start = carryIn ? candidate.startKnown ? Math.max(0, candidate.startedAt) : at : Math.max(this.from, candidate.startedAt);
    const state2 = {
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
    if (eligible && !carryIn && candidate.startedAt < this.from) state2.qualifyingStartKnown = false;
    if (!eligible) state2.lastAt = at;
    return state2;
  }
  maybeOpen(state2, confirmedTo) {
    if (state2.segment || !state2.eligible || state2.qualifyingAt === void 0 || !state2.qualifyingCandidate) return;
    const start = state2.qualifyingAt;
    if (confirmedTo < start) return;
    const candidate = state2.qualifyingCandidate;
    if (this.settings.minDurationMs > 0 && (candidate.confirmationAt === void 0 || candidate.confirmationAt === null || candidate.confirmationAt < start + this.settings.minDurationMs || confirmedTo < candidate.confirmationAt)) return;
    const id = segmentId(candidate.entryId, this.settings, state2.qualifyingCursor, state2.qualifyingStartKnown, this.segmentNamespace);
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
      startKnown: state2.qualifyingStartKnown,
      detectionMode: "top-levels",
      rank: candidate.rank,
      valueRuns: [point],
      valueRunsTruncated: false,
      endReason: null,
      endKnown: false
    };
    state2.segment = segment;
    state2.usdMs = decimalNumber(candidate.notional) * Math.max(0, confirmedTo - start);
    this.totalValueRuns++;
    this.enqueueValueRun(segment.id, point);
    state2.lastAt = confirmedTo;
    state2.peakUsd = segment.peakUsd;
    state2.valueSignature = candidateSignature(candidate);
    this.store(segment);
  }
  appendValue(segment, candidate, at) {
    const state2 = this.candidates.get(candidate.entryId);
    if (!state2 || state2.valueSignature === candidateSignature(candidate)) return;
    const point = valuePoint(candidate, at), last = segment.valueRuns.at(-1);
    if (last?.at === at) {
      segment.valueRuns[segment.valueRuns.length - 1] = point;
    } else {
      segment.valueRuns.push(point);
      this.totalValueRuns++;
    }
    this.enqueueValueRun(segment.id, point);
    state2.valueSignature = candidateSignature(candidate);
    state2.peakUsd = Math.max(state2.peakUsd, point.usd);
    segment.peakUsd = state2.peakUsd;
    segment.rank = candidate.rank;
    segment.priceExact = candidate.price;
    segment.price = decimalNumber(candidate.price);
    this.trimValues(segment);
    this.store(segment);
  }
  advanceAll(at) {
    for (const state2 of this.candidates.values()) this.advance(state2, at);
  }
  advance(state2, at) {
    if (!Number.isFinite(at)) return;
    if (state2.eligible && !state2.segment) this.maybeOpen(state2, at);
    const segment = state2.segment;
    if (!segment) {
      state2.lastAt = Math.max(state2.lastAt, at);
      return;
    }
    const end = Math.min(this.to, Math.max(state2.lastAt, at));
    const elapsed = Math.max(0, end - state2.lastAt);
    state2.usdMs += decimalNumber(state2.candidate.notional) * elapsed;
    state2.lastAt = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.meanUsd = segment.durationMs > 0 ? state2.usdMs / segment.durationMs : decimalNumber(state2.candidate.notional);
    this.store(segment);
  }
  remove(removal) {
    const state2 = this.candidates.get(removal.entryId);
    if (!state2) return;
    const censored = isCensoredRemoval(removal.reason);
    const end = censored ? Math.min(removal.at, removal.lastConfirmedAt) : removal.at;
    this.advance(state2, end);
    const reason = removalReason(removal.reason);
    this.close(state2, end, !censored, reason, censored ? removal.reason : void 0);
    this.candidates.delete(removal.entryId);
  }
  applyGap(patch) {
    const removals = [...patch.bids.removals, ...patch.asks.removals];
    const removalById = new Map(removals.map((item) => [item.entryId, item]));
    for (const [id, state2] of this.candidates) {
      const removal = removalById.get(id);
      const end = removal?.lastConfirmedAt ?? state2.lastAt;
      this.advance(state2, end);
      this.close(state2, end, false, "censored", patch.reason ?? removal?.reason ?? "Depth history gap.");
      this.candidates.delete(id);
    }
  }
  applyCoverageGaps(gaps, confirmedTo) {
    for (const gap of gaps) {
      const from = gap.from ?? gap.at ?? this.from, to = gap.to ?? gap.at ?? from;
      const key = `${from}:${to}:${gap.reason}`;
      if (this.seenGaps.has(key)) continue;
      this.seenGaps.add(key);
      for (const [id, state2] of this.candidates) {
        if (to < state2.lastAt || from > confirmedTo) continue;
        const end = Math.min(state2.lastAt, from);
        this.advance(state2, end);
        this.close(state2, end, false, "censored", gap.reason);
        this.candidates.delete(id);
      }
    }
  }
  close(state2, at, endKnown, reason, censoredReason) {
    const segment = state2.segment;
    if (!segment) return;
    const end = Math.max(segment.start, Math.min(this.to, at));
    segment.end = end;
    segment.durationMs = Math.max(0, end - segment.start);
    segment.endReason = reason;
    segment.endKnown = endKnown;
    if (!endKnown && censoredReason) segment.censoredReason = censoredReason;
    this.store(segment);
    state2.segment = void 0;
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
function segmentId(entryId, settings2, cursor, startKnown, namespace = "") {
  const filter = `${settings2.topLevels}:${settings2.minimumNotionalEnabled ? settings2.minimumNotionalUsd : "off"}:${settings2.minDurationMs}`;
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
function validateCheckpoint(value, settings2, from, to, namespace) {
  for (const _ of validateCheckpointSteps(value, settings2, from, to, namespace)) {
  }
}
function* validateCheckpointSteps(value, settings2, from, to, namespace) {
  const fail = () => {
    throw Error("Invalid wall projection checkpoint");
  };
  if (!isRecord(value) || value.version !== 1 || value.from !== from || value.to !== to || value.namespace !== namespace || !finiteNonNegative(from) || !finiteNonNegative(to) || from >= to) fail();
  const v = value, filter = v.settings;
  if (!isRecord(filter) || filter.topLevels !== settings2.topLevels || filter.minimumNotionalEnabled !== settings2.minimumNotionalEnabled || filter.minDurationMs !== settings2.minDurationMs || settings2.minimumNotionalEnabled && filter.minimumNotionalUsd !== settings2.minimumNotionalUsd || !validInt(filter.topLevels) || filter.topLevels < 1 || filter.topLevels > 10 || !finiteNonNegative(filter.minimumNotionalUsd) || !finiteNonNegative(filter.minDurationMs) || filter.minDurationMs > 6e4 || typeof filter.minimumNotionalEnabled !== "boolean") fail();
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
      const sequence = v.valueRunOrder[i][j];
      if (!isRecord(point) || !finiteNonNegative(point.at) || point.percentile !== null || !validInt(point.rank) || point.rank < 1 || point.rank > 10 || !validDecimal(point.quantityExact) || !validDecimal(point.notionalExact) || point.quantity !== Number(point.quantityExact) || point.usd !== Number(point.notionalExact) || !finiteNonNegative(point.quantity) || !finiteNonNegative(point.usd) || !validInt(sequence) || sequence < 1 || sequence > v.nextValueRunSequence || sequences.has(sequence)) fail();
      sequences.add(sequence);
      runs++;
      if (++work % 256 === 0) yield;
    }
    ids.set(segment.id, segment);
    if (++work % 256 === 0) yield;
  }
  if (runs > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS) fail();
  const candidateIds = /* @__PURE__ */ new Set(), activeIds = /* @__PURE__ */ new Set();
  for (const state2 of v.candidates) {
    if (!isRecord(state2) || !validCandidate(state2.candidate) || candidateIds.has(state2.candidate.entryId) || typeof state2.eligible !== "boolean" || state2.eligible !== (state2.candidate.rank <= settings2.topLevels && (!settings2.minimumNotionalEnabled || compareDecimalToNumber(state2.candidate.notional, settings2.minimumNotionalUsd) >= 0)) || !finiteNonNegative(state2.lastAt) || !finiteNonNegative(state2.usdMs) || !finiteNonNegative(state2.peakUsd) || typeof state2.qualifyingStartKnown !== "boolean" || state2.qualifyingAt !== void 0 && !finiteNonNegative(state2.qualifyingAt) || state2.qualifyingCursor !== void 0 && !validInt(state2.qualifyingCursor) || state2.qualifyingCandidate !== void 0 && (!validCandidate(state2.qualifyingCandidate) || state2.qualifyingCandidate.entryId !== state2.candidate.entryId) || state2.valueSignature !== void 0 && typeof state2.valueSignature !== "string") fail();
    if (state2.segmentId !== void 0) {
      const segment = ids.get(state2.segmentId);
      if (typeof state2.segmentId !== "string" || activeIds.has(state2.segmentId) || !segment || segment.end !== null || !state2.eligible || segment.archiveEntryId !== state2.candidate.entryId) fail();
      activeIds.add(state2.segmentId);
    }
    candidateIds.add(state2.candidate.entryId);
  }
  for (const segment of ids.values()) {
    if (segment.end === null && !activeIds.has(segment.id)) fail();
    if (++work % 256 === 0) yield;
  }
}
function* sortValueQueueSteps(values) {
  const length = values.length;
  if (length < 2) return;
  let source3 = values, target = new Array(length), work = 0;
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
        target[at] = right >= end || left < mid && source3[left].sequence <= source3[right].sequence ? source3[left++] : source3[right++];
        if (++work % 1024 === 0) yield;
      }
    }
    [source3, target] = [target, source3];
  }
  if (source3 !== values) for (let i = 0; i < length; i++) {
    values[i] = source3[i];
    if (++work % 1024 === 0) yield;
  }
}

// src/shared/order-walls-projection-version.ts
var WALL_PROJECTION_CORE_SHA256 = "c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c";

// src/wall-history-projection.ts
var gzip2 = promisify3(gzipCallback2);
var gunzip2 = promisify3(gunzipCallback);
var hash = (value) => createHash4("sha256").update(value).digest("hex");
var WALL_PROJECTION_PART_BYTES = 4 * 1024 * 1024;
var MAX_STATE_BYTES = 32 * 1024 * 1024;
var MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
var MAX_PARTS2 = 512;
function preparedWallProjectionManifest(state2) {
  const { entries, nextOrder: _order, nextPage: _page, replayKeys: _replay, prefixInstall: _install, ...manifest } = state2;
  const parts = new Map(state2.parts.map((part, index) => [part.hash, index]));
  const closed = Object.values(entries).filter((entry) => entry.rows).sort((a, b) => a.order - b.order).map((entry) => entry.rows.map(([digest3, row]) => {
    const part = parts.get(digest3);
    if (part === void 0 || !Number.isSafeInteger(row) || row < 0 || row >= state2.parts[part].records) throw Error("Prepared wall projection closed index mismatch");
    return [part, row];
  }));
  return { ...manifest, closed, activeOrder: state2.active.segments.map((segment) => {
    const entry = entries[segment.id];
    if (!entry || entry.rows) throw Error("Prepared wall projection active index mismatch");
    return entry.order;
  }) };
}
async function boundedRead(path, max) {
  const file = await open3(path, "r");
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
  const state2 = JSON.parse((await boundedRead(join2(root2, key, "manifest.json"), 8 * 1024 * 1024)).toString());
  if (state2.version !== 2 || state2.key !== key || state2.core !== WALL_PROJECTION_CORE_SHA256 || !state2.complete || preparedWallProjectionKey(state2.sourceKey, state2.settings) !== key || !Array.isArray(state2.parts) || state2.parts.length > MAX_PARTS2 || !Array.isArray(state2.closed) || state2.closed.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || !state2.active || state2.activeOrder?.length !== state2.active.segments?.length) throw Error("Invalid prepared wall projection manifest");
  let bytes = 0;
  const hashes = /* @__PURE__ */ new Set();
  for (const part of state2.parts) {
    if (!/^[a-f0-9]{64}$/.test(part.hash) || !/^[a-f0-9]{64}$/.test(part.compressedHash) || hashes.has(part.hash) || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > WALL_PROJECTION_PART_BYTES || !Number.isSafeInteger(part.compressedBytes) || part.compressedBytes < 1 || part.compressedBytes > WALL_PROJECTION_PART_BYTES + 1024 || !Number.isSafeInteger(part.records) || part.records < 1) throw Error("Invalid prepared wall projection part");
    hashes.add(part.hash);
    bytes += part.bytes;
  }
  if (bytes > MAX_OUTPUT_BYTES) throw Error("Prepared wall projection output capacity");
  signal?.throwIfAborted();
  return state2;
}
async function readPreparedWallProjectionPart(root2, manifest, index, signal) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.parts.length) throw Error("Invalid prepared wall projection part index");
  signal?.throwIfAborted();
  const part = manifest.parts[index], body = await boundedRead(join2(root2, manifest.key, part.hash + ".json.gz"), WALL_PROJECTION_PART_BYTES + 1024);
  if (body.byteLength !== part.compressedBytes || hash(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
  signal?.throwIfAborted();
  return body;
}
function normalizedSettings(s) {
  if (!Number.isSafeInteger(s.topLevels) || s.topLevels < 1 || s.topLevels > 100 || typeof s.minimumNotionalEnabled !== "boolean" || !Number.isFinite(s.minimumNotionalUsd) || s.minimumNotionalUsd < 0 || !Number.isSafeInteger(s.minDurationMs) || s.minDurationMs < 0) throw Error("Invalid prepared wall projection settings");
  return { topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs };
}
function preparedWallProjectionKey(sourceKey2, settings2) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey2)) throw Error("Invalid prepared wall projection source key");
  return hash(JSON.stringify({ version: 2, sourceKey: sourceKey2, core: WALL_PROJECTION_CORE_SHA256, settings: normalizedSettings(settings2) }));
}
async function advancePreparedWallProjection(root2, sourceRoot, sourceKey2, settings2, deps = {}) {
  const source3 = await readWallChunkManifest(sourceRoot, sourceKey2);
  if (source3.version !== 5 || !source3.sourceProof) throw Error("Prepared wall projection requires verified canonical history");
  settings2 = normalizedSettings(settings2);
  const profile = source3.profile, desired = canonicalProfileConfig({ bandPercent: profile.bandPercent, aggregation: profile.aggregation, confirmationMs: settings2.minDurationMs, selectionTopN: settings2.topLevels, minimumNotionalUsd: settings2.minimumNotionalEnabled ? settings2.minimumNotionalUsd : null });
  if (profile.confirmationMs !== desired.confirmationMs || profile.selectionTopN !== desired.selectionTopN || profile.minimumNotionalUsd !== desired.minimumNotionalUsd || !Number.isSafeInteger(profile.exactDerivations?.topNMax) || profile.exactDerivations.topNMax < settings2.topLevels || profile.exactDerivations?.minimumNotional !== true || profile.exactDerivations?.confirmation !== true || settings2.minDurationMs > 0 && profile.exactDerivations?.confirmationCrossings !== true) throw Error("Prepared wall projection configuration is not exactly derivable from source profile");
  const key = preparedWallProjectionKey(sourceKey2, settings2), dir = join2(root2, key);
  await mkdir3(dir, { recursive: true });
  let state2;
  try {
    state2 = JSON.parse((await boundedRead(join2(dir, "progress.json"), MAX_STATE_BYTES)).toString());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state2 && (state2.version !== 2 || state2.key !== key || state2.core !== WALL_PROJECTION_CORE_SHA256 || state2.sourceKey !== sourceKey2 || state2.sourceToken !== source3.sourceProof.token || !Number.isSafeInteger(state2.nextPage) || state2.nextPage < 0 || state2.nextPage > source3.parts.length || state2.complete !== (state2.nextPage === source3.parts.length))) throw Error("Prepared wall projection checkpoint identity mismatch");
  const validateSource = async () => {
    const current = await (deps.source ?? wallSourceVersion)(source3.sourceProof);
    if (!current.eligible || current.watermark < source3.watermark) throw Error("Prepared wall projection source unavailable or behind pinned horizon; retry without resetting");
    if (current.token !== source3.sourceProof.token) throw Error("Prepared wall projection source changed; request a new revision");
  };
  if (!state2 && deps.reuseProjectionKey) state2 = await beginProjectionPrefix(root2, sourceRoot, source3, key, settings2, deps.reuseProjectionKey);
  if (state2?.prefixInstall) {
    const install = state2.prefixInstall;
    if (!/^[a-f0-9]{64}$/.test(install.projectionKey) || !/^[a-f0-9]{64}$/.test(install.sourceKey) || !Number.isSafeInteger(install.nextPart) || install.nextPart < 0 || install.nextPart > state2.parts.length || state2.reusedPrefixPages !== state2.nextPage || state2.nextPage < 1) throw Error("Invalid projection prefix installation");
    const old = await readPreparedWallProjectionManifest(root2, install.projectionKey), part2 = state2.parts[install.nextPart];
    if (old.sourceKey !== install.sourceKey) throw Error("Projection prefix source membership mismatch");
    if (part2) {
      const index2 = old.parts.findIndex((p) => p.hash === part2.hash);
      if (index2 < 0 || JSON.stringify(old.parts[index2]) !== JSON.stringify(part2)) throw Error("Projection prefix part membership mismatch");
      const body = await readPreparedWallProjectionPart(root2, old, index2);
      await atomicWrite(join2(dir, part2.hash + ".json.gz"), body);
      install.nextPart++;
    }
    if (install.nextPart >= state2.parts.length) delete state2.prefixInstall;
    const text2 = JSON.stringify(state2);
    if (Buffer.byteLength(text2) > MAX_STATE_BYTES) throw Error("Prepared wall projection checkpoint capacity");
    await atomicWrite(join2(dir, "progress.json"), text2);
    return state2;
  }
  if (state2?.complete) {
    await validateSource();
    await atomicWrite(join2(dir, "manifest.json"), JSON.stringify(preparedWallProjectionManifest(state2)));
    return state2;
  }
  const projector = state2 ? OrderWallsArchiveProjector.restoreCheckpoint(state2.active, settings2, source3.request.from, source3.request.to) : new OrderWallsArchiveProjector(settings2, source3.request.from, source3.request.to);
  const index = state2?.nextPage ?? 0, part = source3.parts[index];
  let page;
  if (deps.load) page = await deps.load(index, source3);
  else {
    const { body } = await readWallChunkPart(sourceRoot, sourceKey2, part.hash);
    const text2 = await gunzip2(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    if (text2.byteLength !== part.bytes || hash(text2) !== part.hash) throw Error("Prepared wall projection canonical part hash mismatch");
    page = JSON.parse(text2.toString());
  }
  if (deps.load && hash(JSON.stringify(page)) !== part.hash || JSON.stringify(page.profile) !== JSON.stringify(profile) || page.from !== source3.request.from || page.to !== source3.request.to || page.watermark !== source3.watermark || JSON.stringify(page.head) !== JSON.stringify(source3.head) || page.page.after !== part.after || page.page.nextAfter !== part.nextAfter || page.page.hasMore !== index < source3.parts.length - 1) throw Error("Prepared wall projection canonical identity mismatch");
  const replay = wallProjectionReplay(page);
  if (part.projectionReplay && JSON.stringify(replay) !== JSON.stringify(part.projectionReplay)) throw Error("Canonical projection replay hash mismatch");
  const entries = { ...state2?.entries ?? {} };
  let nextOrder = state2?.nextOrder ?? 0;
  for (const patch of projector.applyPage(page)) {
    if (!patch.segment) {
      delete entries[patch.id];
      continue;
    }
    const previous = entries[patch.id];
    entries[patch.id] = { order: previous?.order ?? nextOrder++, runs: patch.segment.valueRuns.length };
  }
  const records = projector.takeClosedSegments().map((item) => ({ order: entries[item.segment.id].order, ...item }));
  for (const record of records) entries[record.segment.id].runs = record.segment.valueRuns.length;
  const active = projector.checkpoint();
  for (const segment of active.segments) {
    const entry = entries[segment.id];
    if (!entry) throw Error("Prepared wall projection active identity missing");
    entry.runs = segment.valueRuns.length;
  }
  const counts = Object.values(entries);
  if (projector.historyLimited || counts.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || counts.reduce((sum, e) => sum + e.runs, 0) > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS) throw Error("Prepared wall projection retained capacity; validated prefix retained");
  const parts = [...state2?.parts ?? []];
  let batch = [], batchBytes = 2;
  const flush = async () => {
    if (!batch.length) return;
    const text2 = JSON.stringify(batch), bytes = Buffer.byteLength(text2), digest3 = hash(text2), existing = parts.find((part2) => part2.hash === digest3);
    if (!existing && (parts.length >= MAX_PARTS2 || parts.reduce((sum, p) => sum + p.bytes, 0) + bytes > MAX_OUTPUT_BYTES)) throw Error("Prepared wall projection output capacity; validated prefix retained");
    for (const [row, record] of batch.entries()) {
      const entry = entries[record.segment.id];
      (entry.rows ??= []).push([digest3, row]);
    }
    if (!existing) {
      const body = await gzip2(text2, { level: 6 });
      await atomicWrite(join2(dir, digest3 + ".json.gz"), body);
      parts.push({ hash: digest3, compressedHash: hash(body), bytes, compressedBytes: body.byteLength, records: batch.length });
    }
    batch = [];
    batchBytes = 2;
  };
  for (const record of records) {
    const totalRuns = record.segment.valueRuns.length;
    let offset = 0;
    do {
      const fragment = (count) => ({ ...record, offset, totalRuns, segment: { ...record.segment, valueRuns: record.segment.valueRuns.slice(offset, offset + count) }, valueRunOrder: record.valueRunOrder.slice(offset, offset + count) });
      let low = 0, high = totalRuns - offset, row, bytes;
      let upperBytes = Buffer.byteLength(JSON.stringify(fragment(0)));
      for (let i = offset; i < totalRuns && upperBytes <= WALL_PROJECTION_PART_BYTES; i++) {
        const point = record.segment.valueRuns[i];
        upperBytes += 512 + 6 * ((point.quantityExact?.length ?? 0) + (point.notionalExact?.length ?? 0));
      }
      if (upperBytes + 2 <= WALL_PROJECTION_PART_BYTES) {
        low = high;
        row = fragment(low);
        bytes = Buffer.byteLength(JSON.stringify(row));
      } else {
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (Buffer.byteLength(JSON.stringify(fragment(middle))) + 2 <= WALL_PROJECTION_PART_BYTES) low = middle;
          else high = middle - 1;
        }
        row = fragment(low);
        bytes = Buffer.byteLength(JSON.stringify(row));
      }
      if (totalRuns > offset && !low) throw Error("Prepared wall projection point capacity; validated prefix retained");
      if (bytes + 2 > WALL_PROJECTION_PART_BYTES) throw Error("Prepared wall projection header capacity; validated prefix retained");
      if (batchBytes + bytes + 1 > WALL_PROJECTION_PART_BYTES) await flush();
      batch.push(row);
      batchBytes += bytes + 1;
      offset += low;
    } while (offset < totalRuns);
  }
  await flush();
  const complete = index + 1 === source3.parts.length;
  const next = {
    version: 2,
    key,
    sourceKey: sourceKey2,
    sourceToken: source3.sourceProof.token,
    core: WALL_PROJECTION_CORE_SHA256,
    settings: settings2,
    nextPage: index + 1,
    complete,
    parts,
    entries,
    nextOrder,
    active,
    ...state2?.reusedPrefixPages ? { reusedPrefixPages: state2.reusedPrefixPages } : {},
    replayKeys: [...state2?.replayKeys ?? [], replay],
    coverage: page.coverage,
    profile: source3.profile
  };
  if (complete && state2 && state2.nextPage > 0 && state2.replayKeys?.length === state2.nextPage && !state2.complete) {
    const prefix = JSON.stringify(state2), bytes = Buffer.byteLength(prefix);
    if (bytes <= MAX_STATE_BYTES) {
      const digest3 = hash(prefix);
      await atomicWrite(join2(dir, digest3 + ".prefix.json"), prefix);
      next.extensionPrefix = { hash: digest3, bytes };
    }
  }
  const text = JSON.stringify(next);
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw Error("Prepared wall projection checkpoint capacity; validated prefix retained");
  if (complete) await validateSource();
  await atomicWrite(join2(dir, "progress.json"), text);
  if (complete) await atomicWrite(join2(dir, "manifest.json"), JSON.stringify(preparedWallProjectionManifest(next)));
  return next;
}
async function beginProjectionPrefix(root2, sourceRoot, source3, key, settings2, oldKey) {
  const old = await readPreparedWallProjectionManifest(root2, oldKey), reference = old.extensionPrefix;
  if (!reference) return;
  if (!/^[a-f0-9]{64}$/.test(reference.hash) || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > MAX_STATE_BYTES) throw Error("Invalid projection extension prefix metadata");
  const bytes = await boundedRead(join2(root2, oldKey, reference.hash + ".prefix.json"), MAX_STATE_BYTES);
  if (bytes.length !== reference.bytes || hash(bytes) !== reference.hash) throw Error("Projection extension prefix hash mismatch");
  const prefix = JSON.parse(bytes.toString()), prior2 = await readWallChunkManifest(sourceRoot, old.sourceKey);
  if (old.sourceToken !== prior2.sourceProof?.token || old.active.from !== prior2.request.from || old.active.to !== prior2.request.to) throw Error("Projection extension canonical identity mismatch");
  if (prefix.version !== 2 || prefix.complete || prefix.prefixInstall || prefix.key !== old.key || preparedWallProjectionKey(prefix.sourceKey, prefix.settings) !== prefix.key || JSON.stringify(prefix.settings) !== JSON.stringify(old.settings) || prefix.core !== WALL_PROJECTION_CORE_SHA256 || prefix.sourceKey !== old.sourceKey || prefix.sourceToken !== old.sourceToken || prefix.nextPage < 1 || prefix.nextPage >= source3.parts.length || prefix.replayKeys?.length !== prefix.nextPage) throw Error("Invalid projection extension prefix identity");
  if (JSON.stringify(settings2) !== JSON.stringify(prefix.settings) || source3.request.market !== prior2.request.market || source3.request.profile !== prior2.request.profile || source3.request.from !== prior2.request.from || source3.request.to <= prior2.request.to || source3.watermark < prior2.watermark) return;
  if (prefix.active.from !== source3.request.from || prefix.active.to !== prior2.request.to || prefix.active.confirmedTo >= prior2.request.to) return;
  for (let i = 0; i < prefix.nextPage; i++) {
    const a = prefix.replayKeys[i], b = source3.parts[i]?.projectionReplay;
    if (!b || a.hash !== b.hash || a.maxAt !== b.maxAt || a.maxAt >= prior2.request.to) return;
  }
  const active = { ...prefix.active, to: source3.request.to };
  OrderWallsArchiveProjector.restoreCheckpoint(active, settings2, source3.request.from, source3.request.to);
  const pub = new Map(old.parts.map((p) => [p.hash, JSON.stringify(p)]));
  if (prefix.parts.some((p) => pub.get(p.hash) !== JSON.stringify(p))) throw Error("Projection extension prefix output mismatch");
  return {
    ...prefix,
    key,
    sourceKey: source3.key,
    sourceToken: source3.sourceProof.token,
    active,
    complete: false,
    profile: source3.profile,
    coverage: source3.coverage,
    reusedPrefixPages: prefix.nextPage,
    prefixInstall: { sourceKey: old.sourceKey, projectionKey: oldKey, nextPart: 0 }
  };
}

// ops/profile-wall-projection.mjs
assert.equal(process.env.IQ_WALL_PROJECTION_PROFILE, "1", "Explicit offline projection profiling required");
var [sourceKey, projectionKey] = process.argv.slice(2);
assert.match(sourceKey ?? "", /^[a-f0-9]{64}$/);
assert.match(projectionKey ?? "", /^[a-f0-9]{64}$/);
var root = "/bench/projection";
assert.deepEqual(await readdir("/bench"), [], "Use a fresh, empty benchmark output volume");
var disk = await statfs("/bench");
assert.ok(Number(disk.bavail) * Number(disk.bsize) >= 20 * 1024 ** 3 + 256 * 1024 ** 2, "Preserve the filesystem headroom floor");
var source2 = await readWallChunkManifest("/source", sourceKey);
var prior = await readPreparedWallProjectionManifest("/prepared", projectionKey);
assert.equal(prior.sourceKey, sourceKey);
assert.equal(prior.sourceToken, source2.sourceProof.token);
assert.equal(source2.complete, true);
await mkdir4(root);
var hash2 = (b) => createHash5("sha256").update(b).digest("hex");
var expected = hash2(await readFile3(join3("/prepared", projectionKey, "progress.json")));
var cpu = process.cpuUsage();
var started = performance2.now();
var state;
for (let step = 0; step < source2.parts.length; step++) {
  const at = performance2.now(), before = process.cpuUsage();
  state = await advancePreparedWallProjection(root, "/source", sourceKey, prior.settings, { source: async () => source2.sourceProof });
  console.log(JSON.stringify({ kind: "projection-profile-step", step: step + 1, nextPage: state.nextPage, complete: state.complete, elapsedMs: performance2.now() - at, cpu: process.cpuUsage(before), activeSegments: state.active.segments.length, activeValues: state.active.segments.reduce((n, s) => n + s.valueRuns.length, 0), indexedSegments: Object.keys(state.entries).length, memory: process.memoryUsage() }));
  if (state.complete) break;
}
assert.ok(state?.complete);
assert.equal(state.nextPage, source2.parts.length);
var elapsedMs = performance2.now() - started;
var usedCpu = process.cpuUsage(cpu);
var actual = hash2(await readFile3(join3(root, state.key, "progress.json")));
assert.equal(actual, expected, "Offline build must preserve the complete private checkpoint exactly");
assert.deepEqual(JSON.parse(JSON.stringify(preparedWallProjectionManifest(state))), prior, "Offline build must preserve the serialized public manifest and financial ordering");
for (const part of state.parts) {
  const body = await readFile3(join3(root, state.key, part.hash + ".json.gz"));
  assert.equal(body.byteLength, part.compressedBytes);
  assert.equal(hash2(body), part.compressedHash);
}
console.log(JSON.stringify({ kind: "projection-profile-complete", sourceKey, projectionKey, sourceToken: source2.sourceProof.token, parts: source2.parts.length, elapsedMs, cpu: usedCpu, checkpointSha256: actual, checkpointBytes: (await stat(join3(root, state.key, "progress.json"))).size, result: "exact-match", memory: process.memoryUsage(), scope: "Profiled offline projection-only build over already prepared canonical input and frozen source proof; not raw cold build, chart loading, current continuity or a latency acceptance sample. The outer caller must revalidate canonical source and own reader leases." }));

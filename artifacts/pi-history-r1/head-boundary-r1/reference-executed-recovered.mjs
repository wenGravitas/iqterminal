// ops/verify-wall-head-boundary.mjs
import assert from "node:assert/strict";
import { mkdir as mkdir4, readFile as readFile3, readdir, statfs } from "node:fs/promises";
import { join as join4 } from "node:path";
import { gunzipSync } from "node:zlib";
import { getHeapStatistics } from "node:v8";

// src/db.ts
import { performance } from "node:perf_hooks";

// src/query-timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
var queryTiming = new AsyncLocalStorage();

// src/db.ts
var url = process.env.CH_URL ?? "http://127.0.0.1:18123";
async function sql(query2, data) {
  const started = performance.now(), m = queryTiming.getStore(), target = new URL(url);
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
    if (m) m.dbMs += performance.now() - started;
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

// src/archive-event-query.ts
function archiveEventReadSql(profile2, where, order, limit, table2 = "order_wall_archive_events") {
  if (!["order_wall_archive_events", "order_wall_current_events"].includes(table2)) throw Error("Invalid Order Walls event table");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50001) throw Error("Invalid bounded Order Walls event read");
  return `SELECT cursor,epoch,at,kind,payload FROM iqterminal.${table2} FINAL PREWHERE profile='${profile2}' AND (epoch,cursor,kind) IN (SELECT epoch,cursor,kind FROM iqterminal.${table2} FINAL WHERE profile='${profile2}' AND ${where} ORDER BY ${order} LIMIT ${limit}) WHERE ${where} ORDER BY ${order} LIMIT ${limit} SETTINGS enable_shared_storage_snapshot_in_query=1,max_threads=2,max_block_size=256,max_result_bytes=16777216,result_overflow_mode='throw'`;
}

// src/market.ts
function backendMarket(value) {
  if (value === void 0 || value === null || value === "" || value === "perpetual") return "perpetual";
  if (value === "spot") return "spot";
  throw new Error("Unsupported market; expected spot or perpetual");
}
function marketConfig(value) {
  const market2 = backendMarket(value);
  if (market2 === "spot") return {
    market: market2,
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
    market: market2,
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
function depthSourceFor(marketValue = config.market) {
  const market2 = marketConfig(marketValue);
  return { table: market2.depthTable, source: `venue='binance' AND market='${market2.market}' AND nativeSymbol='BTCUSDT' AND feed='${market2.depthFeed}'` };
}

// src/order-walls-archive.ts
var ARCHIVE_PAGE_DEFAULT = 256;
var ARCHIVE_PAGE_MAX = 1e3;
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
var MAX_RANGE_GROUP = 5e3;
var MAX_PREWINDOW_EVENTS = 5e4;
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
function feedSlug(market2) {
  const feed = marketConfig(market2).depthFeed;
  return feed.startsWith("binance:spot:BTCUSDT:") ? feed.slice("binance:spot:BTCUSDT:".length) : feed;
}
function archiveProfile(market2, rawConfig = { bandPercent: 10, aggregation: "native" }) {
  const config2 = marketConfig(market2), profileConfig = canonicalProfileConfig(rawConfig);
  const marketSlug = market2 === "spot" ? "spot" : "usdm";
  const aggregation = profileConfig.aggregation === "native" ? "native" : `${profileConfig.aggregation}usdt`;
  const baseId = `binance-${marketSlug}-btcusdt-feed-${feedSlug(market2)}-band-${percentSlug(profileConfig.bandPercent)}pct-agg-${aggregation}-top10-a1-s1`;
  const confirmationSlug = decimalSlug(canonicalUsd(profileConfig.confirmationMs));
  const id = profileConfig.confirmationMs === 0 ? baseId : `${baseId}-confirm-${confirmationSlug}ms-n${profileConfig.selectionTopN}-${profileConfig.minimumNotionalUsd === null ? "minoff" : `minusd-${decimalSlug(profileConfig.minimumNotionalUsd)}`}`;
  return {
    id,
    version: 1,
    market: market2,
    venue: "binance",
    instrument: config2.instrument,
    feed: historyFeed(market2),
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
function parseArchiveProfileId(market2, id) {
  const prefix = `binance-${market2 === "spot" ? "spot" : "usdm"}-btcusdt-feed-${feedSlug(market2)}-`;
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
    const profile2 = archiveProfile(market2, config2);
    return profile2.id === id ? { profile: profile2, config: config2 } : null;
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
var unavailableDerivations = { bandPercent: [], topNMax: 0, minimumNotional: false, confirmation: false };
var archiveHistoryMetadata = /* @__PURE__ */ new Map();
var archiveHistoryMetadataBytes = 0;
function immutableHistoryReader(reader, refresh = false) {
  if (reader !== query) return reader;
  return (async (sql2) => {
    const hit = archiveHistoryMetadata.get(sql2);
    if (hit && hit.expires > Date.now() && !refresh) return hit.rows;
    if (hit) {
      archiveHistoryMetadataBytes -= hit.bytes;
      archiveHistoryMetadata.delete(sql2);
    }
    const rows = await reader(sql2), bytes = Buffer.byteLength(JSON.stringify(rows));
    if (bytes < 2 * 1024 * 1024) {
      while (archiveHistoryMetadata.size >= 128 || archiveHistoryMetadataBytes + bytes > 8 * 1024 * 1024) {
        const key = archiveHistoryMetadata.keys().next().value;
        if (key === void 0) break;
        archiveHistoryMetadataBytes -= archiveHistoryMetadata.get(key).bytes;
        archiveHistoryMetadata.delete(key);
      }
      archiveHistoryMetadata.set(sql2, { expires: Date.now() + 6e4, bytes, rows });
      archiveHistoryMetadataBytes += bytes;
    }
    return rows;
  });
}
var archiveDisplayProgress = /* @__PURE__ */ new WeakMap();
function displayProgressCache(reader) {
  let cache = archiveDisplayProgress.get(reader);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    archiveDisplayProgress.set(reader, cache);
  }
  return cache;
}
function displaySnapshotKey(profile2, from, to, watermark) {
  return `${profile2}:${from}:${to}:${watermark}`;
}
async function orderWallsArchiveHistory(request, queryRows = query, reuse) {
  const requested = request.profile, parsed = parseArchiveProfileId(request.market, requested);
  const profile2 = parsed?.profile ?? archiveProfile(request.market);
  validateArchiveRange(request.from, request.to);
  const limit = request.display ? request.after ? 4096 : 512 : validateArchivePage(request.after, request.limit);
  const after = request.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid archive source cursor");
  if (!parsed) return unavailableHistory(profile2, requested, request, after, limit, "Requested profile identity is invalid or unsupported");
  const progressCache = request.display ? displayProgressCache(queryRows) : void 0;
  const cachedProgress = after > 0 && request.watermark !== void 0 ? progressCache?.get(displaySnapshotKey(profile2.id, request.from, request.to, request.watermark)) : void 0;
  const progress = cachedProgress && cachedProgress.expires > Date.now() ? cachedProgress.progress : await getProgress(profile2.id, queryRows);
  if (!progress) return unavailableHistory(profile2, requested, request, after, limit, "Archive profile has not observed source data");
  const retentionBoundary = Number(progress.at) - ARCHIVE_EVENT_RETENTION_DAYS * 864e5 - 1e3;
  if (request.from < retentionBoundary) return unavailableHistory(
    profile2,
    requested,
    request,
    after,
    limit,
    `Requested history predates the configured ${ARCHIVE_EVENT_RETENTION_DAYS}-day archive retention window`
  );
  const currentCursor = Number(progress.cursor);
  const watermark = request.watermark === void 0 ? currentCursor : request.watermark;
  if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > currentCursor) throw new Error("Archive watermark beyond durable profile head");
  if (after > watermark) throw new Error("Archive cursor beyond watermark");
  if (progressCache && !(cachedProgress && cachedProgress.expires > Date.now())) {
    const key = displaySnapshotKey(profile2.id, request.from, request.to, watermark);
    if (Buffer.byteLength(JSON.stringify(progress)) <= 16 * 1024) {
      for (const [oldKey, value] of progressCache) if (value.expires <= Date.now()) progressCache.delete(oldKey);
      if (progressCache.size >= 64) progressCache.delete(progressCache.keys().next().value);
      progressCache.set(key, { expires: Date.now() + 6e4, progress });
    }
  }
  const metadataReader = immutableHistoryReader(queryRows, after === 0);
  const pinned = request.pinnedHead;
  if (pinned && (![pinned.cursor, pinned.epoch, pinned.at].every((value) => Number.isSafeInteger(value) && value >= 0) || pinned.cursor !== watermark)) throw Error("Invalid prepared wall source head");
  const head = pinned ? { ...pinned } : await archiveSourceHeadAt(profile2, watermark, progress, metadataReader);
  const seedState = after === 0 ? await archiveStateBefore(profile2.id, request.from, watermark, metadataReader) : { state: void 0, gaps: [], overflow: false };
  const pageAfter = after === 0 ? Math.max(after, Number(seedState.state?.cursor ?? 0)) : after;
  const candidates = reuse ? await reuse.events(pageAfter, watermark, limit + 1) : await archiveEvents(
    profile2.id,
    `cursor>${pageAfter} AND cursor<=${watermark} AND at>=${request.from} AND at<${request.to}`,
    "cursor ASC,kind ASC",
    limit + 1,
    queryRows
  );
  let displayLimit = limit;
  if (request.display) {
    let bytes = 0;
    displayLimit = 0;
    for (const row of candidates.slice(0, limit)) {
      const size = Buffer.byteLength(typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload)) + 96;
      if (displayLimit && bytes + size > 2 * 1024 * 1024) break;
      bytes += size;
      displayLimit++;
    }
  }
  const prefix = archivePagePrefix(candidates, displayLimit);
  const closed = await closeArchiveTimestampGroups(
    profile2.id,
    prefix.page,
    prefix.hasMore,
    pageAfter,
    watermark,
    ` AND at>=${request.from} AND at<${request.to}`,
    queryRows,
    "order_wall_archive_events",
    reuse
  );
  const { events, hasMore } = closed;
  const nextAfter = hasMore ? Number(events.at(-1)?.cursor ?? pageAfter) : watermark;
  const start = seedState.state;
  const gaps = await archiveEvents(profile2.id, `cursor<=${watermark} AND at>=${request.from} AND at<${request.to} AND kind='gap'`, "cursor ASC,kind ASC", 257, metadataReader);
  const earliest = progress.availableFrom == null ? null : Number(progress.availableFrom);
  const carryInUnavailable = after === 0 && (!start || seedState.overflow);
  const expired = earliest === null || request.from < earliest || carryInUnavailable;
  const patchGaps = [...seedState.gaps, ...gaps.map(decodeArchiveEvent)];
  const gapsForCoverage = patchGaps.slice(0, 256).map((event) => ({ cursor: Number(event.cursor), epoch: Number(event.epoch), at: Number(event.at), reason: event.reason ?? "Depth continuity unavailable" }));
  const beforeWindowGap = seedState.gaps.length > 0;
  const tailUnconfirmed = request.to > head.at;
  const gapsTruncated = gaps.length > 256 || seedState.gaps.length > 256;
  const partial = expired || beforeWindowGap || gaps.length > 0 || tailUnconfirmed || gapsTruncated;
  const status = expired && !start ? "unavailable" : partial ? "partial" : "complete";
  const reason = after === 0 && seedState.overflow ? "Carry-in reconstruction exceeds its bounded event budget" : after === 0 && !start ? "No retained carry-in anchor is available for the requested start" : expired ? "Requested history predates the first archived, reconstructible source state" : beforeWindowGap ? "A continuity gap precedes the requested start" : gaps.length ? "Depth continuity gaps are present in the requested range" : tailUnconfirmed ? "Durable profile watermark has not confirmed the requested tail" : void 0;
  return {
    version: 1,
    ...request.display ? { displayVersion: 1, snapshot: `${profile2.id}:${watermark}:${request.from}:${request.to}` } : {},
    profile: profile2,
    market: profile2.market,
    instrument: profile2.instrument,
    feed: profile2.feed,
    from: request.from,
    to: request.to,
    watermark,
    head,
    page: { after: pageAfter, nextAfter, hasMore, lastAt: Number(events.at(-1)?.at ?? start?.at ?? 0) || null, limit, observations: events.length, sameMillisecondClosed: true },
    ...start ? { seed: { ...start, bids: start.bids.map(wireArchiveCandidate), asks: start.asks.map(wireArchiveCandidate) } } : {},
    patches: events.map((row) => wireArchivePatch(decodeArchiveEvent(row))),
    coverage: {
      availableFrom: earliest,
      requestedFrom: request.from,
      requestedTo: request.to,
      confirmedTo: Math.min(request.to, head.at),
      gaps: gapsForCoverage,
      gapsTruncated,
      partial,
      status,
      ...reason ? { reason } : {},
      // Only the historical carry-in describes this view. Current progress may
      // be hours/days later, even when its cursor equals the pinned watermark.
      // Continuations omit carry-in context; they must not invent a current one.
      bookScope: start?.bookScope ?? null,
      midpoint: start?.midpoint ?? null
    }
  };
}
async function archiveSourceHeadAt(profile2, cursor, progress, queryRows) {
  if (cursor === Number(progress.cursor)) return { cursor, at: Number(progress.at), epoch: Number(progress.epoch) };
  if (cursor === 0) return { cursor: 0, at: 0, epoch: 0 };
  const { table: table2, source: source2 } = depthSourceFor(profile2.market);
  const rows = await queryRows(`SELECT cursor,epoch,at FROM iqterminal.${table2} FINAL WHERE ${source2} AND cursor=${cursor} ORDER BY epoch DESC,cursor DESC LIMIT 1 SETTINGS max_threads=2,max_block_size=256,max_memory_usage=134217728,max_execution_time=15`);
  if (!rows.length) throw new Error("Pinned Order Walls watermark source cursor is no longer retained");
  return { cursor: Number(rows[0].cursor), at: Number(rows[0].at), epoch: Number(rows[0].epoch) };
}
async function archiveStateBefore(profile2, from, watermark, queryRows) {
  const anchors = await queryRows(`SELECT cursor,epoch,at,midpoint,bookScope,payload FROM iqterminal.order_wall_archive_anchors FINAL WHERE profile='${profile2}' AND cursor<=${watermark} AND at<${from} ORDER BY at DESC,cursor DESC LIMIT 1 SETTINGS max_threads=2,max_block_size=256`);
  if (!anchors.length) return { state: void 0, gaps: [], overflow: false };
  const anchor = anchors[0], snapshot = typeof anchor.payload === "string" ? JSON.parse(anchor.payload) : anchor.payload;
  const active = { bids: /* @__PURE__ */ new Map(), asks: /* @__PURE__ */ new Map() };
  for (const side of ["bids", "asks"]) for (const item of snapshot[side] ?? []) active[side].set(item.candidate.entryId, item.candidate);
  const keys = await archiveEvents(
    profile2,
    `cursor>${Number(anchor.cursor)} AND cursor<=${watermark} AND at<${from}`,
    "cursor ASC,kind ASC",
    MAX_PREWINDOW_EVENTS + 1,
    queryRows
  );
  if (keys.length > MAX_PREWINDOW_EVENTS) return { state: void 0, gaps: [], overflow: true };
  const gaps = [];
  let last = {
    cursor: Number(anchor.cursor),
    epoch: Number(anchor.epoch),
    at: Number(anchor.at),
    midpoint: anchor.midpoint ?? null,
    bookScope: typeof anchor.bookScope === "string" ? JSON.parse(anchor.bookScope) : anchor.bookScope
  };
  for (const row of keys) {
    const patch = decodeArchiveEvent(row);
    if (patch.kind === "gap") {
      active.bids.clear();
      active.asks.clear();
      gaps.push(patch);
    }
    for (const side of ["bids", "asks"]) {
      for (const removal of patch[side]?.removals ?? []) active[side].delete(removal.entryId);
      for (const candidate of patch[side]?.upserts ?? []) active[side].set(candidate.entryId, candidate);
    }
    last = { cursor: Number(patch.cursor), epoch: Number(patch.epoch), at: Number(patch.at), midpoint: patch.midpoint ?? null, bookScope: patch.bookScope ?? null };
  }
  const candidates = { bids: [...active.bids.values()].sort((a, b) => a.rank - b.rank), asks: [...active.asks.values()].sort((a, b) => a.rank - b.rank) };
  return { state: { ...last, bids: candidates.bids, asks: candidates.asks, bookScope: last.bookScope }, gaps, overflow: false };
}
function wireSide(side) {
  return side === "bids" ? "bid" : "ask";
}
function wireArchiveCandidate(candidate) {
  return { ...candidate, side: wireSide(candidate.side) };
}
function wireArchivePatch(patch) {
  return {
    ...patch,
    bids: { ...patch.bids, upserts: patch.bids.upserts.map(wireArchiveCandidate), removals: patch.bids.removals.map((removal) => ({ ...removal, side: wireSide(removal.side) })) },
    asks: { ...patch.asks, upserts: patch.asks.upserts.map(wireArchiveCandidate), removals: patch.asks.removals.map((removal) => ({ ...removal, side: wireSide(removal.side) })) }
  };
}
async function getProgress(profile2, queryRows) {
  const rows = await queryRows(`SELECT profile,cursor,epoch,at,availableFrom,midpoint,bookScope FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${profile2}' LIMIT 1`);
  return rows[0];
}
async function archiveEvents(profile2, where, order, limit, queryRows, table2 = "order_wall_archive_events") {
  if (table2 !== "order_wall_archive_events" && table2 !== "order_wall_current_events") throw new Error("Invalid Order Walls event table");
  const rows = await queryRows(archiveEventReadSql(profile2, where, order, limit, table2));
  const bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(row.payload), 0);
  if (bytes > MAX_REPLAY_BYTES) throw new Error("Order Walls archive page byte budget exceeded");
  return rows.map((row) => ({ cursor: Number(row.cursor), epoch: Number(row.epoch), at: Number(row.at), kind: row.kind, payload: row.payload }));
}
function decodeArchiveEvent(row) {
  return typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
}
function archivePagePrefix(rows, limit) {
  const page = rows.slice(0, limit), hasMore = rows.length > limit;
  return { page, hasMore };
}
async function closeArchiveTimestampGroups(profile2, initialPage, hasMore, after, watermark, range, queryRows, table2 = "order_wall_archive_events", reuse) {
  const events = initialPage.slice();
  if (!events.length) {
    if (hasMore) throw new Error("Archive page reported more events without a page prefix");
    return { events, hasMore: false };
  }
  const timestamps = /* @__PURE__ */ new Set();
  let previous = after;
  for (const event of events) {
    const eventCursor = Number(event.cursor), at = Number(event.at);
    if (!Number.isSafeInteger(eventCursor) || eventCursor <= previous || eventCursor > watermark || !Number.isSafeInteger(at) || at < 0) throw new Error("Invalid archive page event order");
    previous = eventCursor;
    timestamps.add(at);
  }
  let cursor = previous;
  if (!hasMore) return { events, hasMore: false };
  for (; ; ) {
    const furthest = reuse ? await reuse.furthest(cursor, watermark, timestamps) : await furthestArchiveCursorAtTimes(profile2, cursor, watermark, timestamps, range, queryRows, table2);
    if (furthest === cursor) break;
    const extra = reuse ? await reuse.events(cursor, furthest, MAX_RANGE_GROUP + 1) : await archiveEvents(
      profile2,
      `cursor>${cursor} AND cursor<=${furthest}${range}`,
      "cursor ASC,kind ASC",
      MAX_RANGE_GROUP + 1,
      queryRows,
      table2
    );
    if (events.length + extra.length > MAX_RANGE_GROUP) throw new Error("Same-time archive closure exceeds page budget");
    if (!extra.length || Number(extra.at(-1).cursor) !== furthest) throw new Error("Same-time archive closure could not be completed");
    previous = cursor;
    for (const event of extra) {
      const eventCursor = Number(event.cursor), at = Number(event.at);
      if (!Number.isSafeInteger(eventCursor) || eventCursor <= previous || eventCursor > furthest || !Number.isSafeInteger(at) || at < 0) throw new Error("Invalid archive timestamp closure order");
      previous = eventCursor;
      timestamps.add(at);
    }
    if (previous !== furthest) throw new Error("Same-time archive closure did not include its final cursor");
    events.push(...extra);
    cursor = furthest;
  }
  const remaining = reuse ? await reuse.events(cursor, watermark, 1) : await archiveEvents(
    profile2,
    `cursor>${cursor} AND cursor<=${watermark}${range}`,
    "cursor ASC,kind ASC",
    1,
    queryRows,
    table2
  );
  return { events, hasMore: remaining.length > 0 };
}
async function furthestArchiveCursorAtTimes(profile2, after, watermark, timestamps, range, queryRows, table2) {
  if (!timestamps.size) return after;
  if (timestamps.size > MAX_RANGE_GROUP) throw new Error("Same-time archive closure exceeds timestamp budget");
  const times = [...timestamps].sort((a, b) => a - b);
  const rows = await queryRows(`SELECT at,max(cursor) AS maxCursor FROM iqterminal.${table2} FINAL WHERE profile='${profile2}' AND cursor>${after} AND cursor<=${watermark}${range} AND at IN (${times.join(",")}) GROUP BY at LIMIT ${times.length} SETTINGS max_threads=2,max_block_size=256,max_memory_usage=67108864,max_execution_time=15,max_rows_to_read=1000000,max_bytes_to_read=134217728,max_result_bytes=1048576,result_overflow_mode='throw'`);
  let furthest = after;
  for (const row of rows) {
    const cursor = Number(row.maxCursor ?? row.max_cursor);
    if (!Number.isSafeInteger(cursor) || cursor <= after || cursor > watermark || !timestamps.has(Number(row.at))) {
      throw new Error("Invalid archive timestamp closure cursor");
    }
    furthest = Math.max(furthest, cursor);
  }
  return furthest;
}
function validateArchiveRange(from, to) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to - from > ARCHIVE_EVENT_RETENTION_DAYS * 864e5) throw new Error(`Invalid bounded archive [from,to) range (maximum ${ARCHIVE_EVENT_RETENTION_DAYS} days)`);
}
function validateArchivePage(afterValue, limitValue) {
  const after = afterValue ?? 0, limit = limitValue ?? ARCHIVE_PAGE_DEFAULT;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid archive cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ARCHIVE_PAGE_MAX) throw new Error("Invalid archive page limit");
  return limit;
}
function unavailableHistory(profile2, requested, request, after, limit, reason) {
  return {
    version: 1,
    profile: requested === profile2.id ? profile2 : { ...profile2, id: requested, exactDerivations: unavailableDerivations },
    market: profile2.market,
    instrument: profile2.instrument,
    feed: profile2.feed,
    from: request.from,
    to: request.to,
    watermark: request.watermark ?? 0,
    page: { after, nextAfter: after, hasMore: false, lastAt: null, limit, observations: 0, sameMillisecondClosed: true },
    patches: [],
    coverage: {
      availableFrom: null,
      requestedFrom: request.from,
      requestedTo: request.to,
      confirmedTo: null,
      gaps: [],
      gapsTruncated: false,
      partial: true,
      status: "unavailable",
      reason,
      bookScope: null,
      midpoint: null
    }
  };
}

// src/wall-source-version.ts
import { createHash } from "node:crypto";
var digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
  const reason = !anchor ? "No retained wall carry-in anchor" : availableFrom === null || request.from < availableFrom ? "Requested wall source predates retained coverage" : request.to - 1 > head.at ? "Wall source has not confirmed the requested tail" : void 0;
  const basis = { version: 1, kind: "wall-source-sha256-xor-v1", ...request, availableFrom, anchor, confirmedTo: Math.min(request.to, head.at), records, maxCursor, hash: hash3 };
  return { ...request, version: 1, kind: "wall-source-sha256-xor-v1", watermark: head.cursor, head, availableFrom, anchor, records, maxCursor, hash: hash3, token: digest(basis), eligible: reason === void 0, ...reason ? { reason } : {} };
}

// src/wall-projection-replay.ts
import { createHash as createHash2 } from "node:crypto";
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
  return { hash: createHash2("sha256").update(JSON.stringify(basis)).digest("hex"), maxAt };
}

// src/wall-canonical-overlap.ts
import { createHash as createHash3 } from "node:crypto";
import { gunzip as unzip } from "node:zlib";
import { promisify } from "node:util";
import { open as open2 } from "node:fs/promises";
import { join } from "node:path";

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
var hash = (b) => createHash3("sha256").update(b).digest("hex");
var SCAN_BYTES = 8 * 1024 * 1024;
var ROW_BYTES = 16 * 1024 * 1024;
var ScanCapacity = class extends Error {
};
function canonicalWallOverlap(root, old, target, read = query) {
  const source2 = old.sourceProof;
  if (old.version !== 5 || !old.complete || !source2 || !source2.eligible || source2.market !== target.market || source2.profile !== target.profile || target.from < source2.from || target.to < source2.to || target.from >= source2.to || target.watermark < old.watermark) throw Error("Invalid canonical wall overlap");
  const cache = /* @__PURE__ */ new Map();
  const range = ` AND at>=${target.from} AND at<${target.to}`;
  const tail = ` AND (cursor>${old.watermark} OR at>=${source2.to})`;
  const first = old.parts[0].after;
  let tailPromise;
  async function tailSnapshot() {
    if (tailPromise) return tailPromise;
    tailPromise = (async () => {
      const file = join(root, verifiedWallViewKey(target), "overlap-tail.json");
      let saved;
      try {
        const handle = await open2(file, "r");
        try {
          if ((await handle.stat()).size > 4 * 1024 * 1024 + 4096) throw Error("Overlap tail byte capacity");
          saved = JSON.parse(await handle.readFile("utf8"));
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const digest3 = (rows2) => createHash3("sha256").update(JSON.stringify(rows2)).digest("hex");
      if (saved) {
        if (saved.version !== 1 || saved.sourceKey !== old.key || saved.targetToken !== target.token || !["ready", "fallback"].includes(saved.state)) throw Error("Invalid overlap tail identity");
        if (saved.state === "fallback") return;
        if (!Array.isArray(saved.rows) || saved.rows.length > 5e3 || digest3(saved.rows) !== saved.hash) throw Error("Invalid overlap tail content hash");
        return validate(saved.rows, 0, target.watermark);
      }
      const rows = validate(await database(0, target.watermark, 5001, tail), 0, target.watermark);
      const data = { version: 1, sourceKey: old.key, targetToken: target.token, state: "ready", hash: digest3(rows), rows };
      const text = JSON.stringify(data);
      if (rows.length > 5e3 || Buffer.byteLength(text) > 4 * 1024 * 1024) {
        await atomicWrite(file, JSON.stringify({ version: 1, sourceKey: old.key, targetToken: target.token, state: "fallback" }));
        return;
      }
      await atomicWrite(file, text);
      return rows;
    })();
    return tailPromise;
  }
  async function partRows(index) {
    let rows = cache.get(index);
    if (rows) return rows;
    const part = old.parts[index], { body } = await readWallChunkPart(root, old.key, part.hash);
    const bytes = await gunzip(body, { maxOutputLength: part.bytes });
    if (bytes.length !== part.bytes || hash(bytes) !== part.hash) throw Error("Canonical overlap part hash mismatch");
    const page = JSON.parse(bytes.toString());
    if (page.from !== source2.from || page.to !== source2.to || page.watermark !== old.watermark || page.profile?.id !== source2.profile || page.page?.after !== part.after || page.page?.nextAfter !== part.nextAfter || !Array.isArray(page.patches)) throw Error("Canonical overlap page identity mismatch");
    let prior = part.after;
    rows = page.patches.map((patch) => {
      if (!Number.isSafeInteger(patch.cursor) || patch.cursor <= prior || patch.cursor > part.nextAfter || !Number.isSafeInteger(patch.at) || patch.at < source2.from || patch.at >= source2.to) throw Error("Canonical overlap event order mismatch");
      prior = patch.cursor;
      const side = (name) => {
        const values = patch[name];
        if (!Array.isArray(values?.upserts) || !Array.isArray(values?.removals)) throw Error("Invalid canonical overlap side");
        const convert = (value) => {
          if (value.side !== (name === "bids" ? "bid" : "ask")) throw Error("Invalid canonical overlap wire side");
          return { ...value, side: name };
        };
        return { ...values, upserts: values.upserts.map(convert), removals: values.removals.map(convert) };
      };
      return { cursor: patch.cursor, epoch: patch.epoch, at: patch.at, kind: patch.kind, payload: JSON.stringify({ ...patch, bids: side("bids"), asks: side("asks") }) };
    });
    if (cache.size === 2) cache.delete(cache.keys().next().value);
    cache.set(index, rows);
    return rows;
  }
  async function cached(after, through, limit, timestamps) {
    let bytes = 0;
    const rows = [];
    for (const part of old.parts) {
      if (part.nextAfter <= after || part.after >= through) continue;
      bytes += part.bytes;
      if (bytes > SCAN_BYTES) throw new ScanCapacity();
      for (const row of await partRows(part.index)) if (row.cursor > after && row.cursor <= through && row.at >= target.from && row.at < target.to && (!timestamps || timestamps.has(row.at))) {
        rows.push(row);
        if (!timestamps && rows.length === limit) return rows;
        if (timestamps && rows.length > 5e3) throw new ScanCapacity();
      }
    }
    return rows;
  }
  const where = (after, through, extra = "") => `cursor>${after} AND cursor<=${through}${range}${extra}`;
  async function database(after, through, limit, extra = "") {
    return read(archiveEventReadSql(target.profile, where(after, through, extra), "cursor ASC,kind ASC", limit));
  }
  function validate(rows, after, through) {
    let prior = after, bytes = 0;
    for (const row of rows) {
      if (!Number.isSafeInteger(Number(row.cursor)) || Number(row.cursor) <= prior || Number(row.cursor) > through || !Number.isSafeInteger(Number(row.at)) || Number(row.at) < target.from || Number(row.at) >= target.to || typeof row.payload !== "string") throw Error("Invalid overlap database event");
      prior = Number(row.cursor);
      bytes += Buffer.byteLength(row.payload);
    }
    if (bytes > ROW_BYTES) throw Error("Order Walls archive page byte budget exceeded");
    return rows.map((row) => ({ ...row, cursor: Number(row.cursor), epoch: Number(row.epoch), at: Number(row.at) }));
  }
  async function furthestRead(after, through, timestamps, extra = "") {
    const times = [...timestamps].sort((a, b) => a - b);
    const rows = await read(`SELECT at,max(cursor) AS maxCursor FROM iqterminal.order_wall_archive_events FINAL WHERE profile='${target.profile}' AND ${where(after, through, extra)} AND at IN (${times.join(",")}) GROUP BY at LIMIT ${times.length} SETTINGS max_threads=2,max_block_size=256,max_memory_usage=67108864,max_execution_time=15,max_rows_to_read=1000000,max_bytes_to_read=134217728,max_result_bytes=1048576,result_overflow_mode='throw'`);
    let max = after;
    for (const row of rows) {
      const cursor = Number(row.maxCursor ?? row.max_cursor);
      if (!Number.isSafeInteger(cursor) || cursor <= after || cursor > through || !timestamps.has(Number(row.at))) throw Error("Invalid overlap timestamp closure cursor");
      max = Math.max(max, cursor);
    }
    return max;
  }
  return {
    async events(after, through, limit) {
      if (![after, through, limit].every(Number.isSafeInteger) || after < 0 || through < after || through > target.watermark || limit < 1 || limit > 5001) throw Error("Invalid bounded overlap event read");
      if (after < first) return validate(await database(after, through, limit), after, through);
      let overlap;
      try {
        overlap = await cached(after, Math.min(through, old.watermark), limit);
      } catch (error) {
        if (!(error instanceof ScanCapacity)) throw error;
        return validate(await database(after, through, limit), after, through);
      }
      const snapshot = await tailSnapshot();
      const fresh = snapshot ? snapshot.filter((row) => row.cursor > after && row.cursor <= through).slice(0, limit) : await database(after, through, limit, tail);
      return validate([...overlap, ...fresh].sort((a, b) => Number(a.cursor) - Number(b.cursor) || String(a.kind).localeCompare(String(b.kind))).slice(0, limit), after, through);
    },
    async furthest(after, through, timestamps) {
      if (![after, through].every(Number.isSafeInteger) || after < 0 || through < after || through > target.watermark || timestamps.size > 5e3 || [...timestamps].some((t) => !Number.isSafeInteger(t) || t < target.from || t >= target.to)) throw Error("Invalid bounded overlap timestamp read");
      if (!timestamps.size) return after;
      if (after < first) return furthestRead(after, through, timestamps);
      let overlap;
      try {
        overlap = await cached(after, Math.min(through, old.watermark), 5001, timestamps);
      } catch (error) {
        if (!(error instanceof ScanCapacity)) throw error;
        return furthestRead(after, through, timestamps);
      }
      const snapshot = await tailSnapshot();
      let max = after;
      if (snapshot) {
        for (const row of snapshot) if (row.cursor > after && row.cursor <= through && timestamps.has(row.at)) max = Math.max(max, row.cursor);
      } else max = await furthestRead(after, through, timestamps, tail);
      for (const row of overlap) max = Math.max(max, row.cursor);
      return max;
    }
  };
}

// src/wall-history-chunks.ts
import { createHash as createHash4 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile2, open as open3 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { gzip as gzipCallback } from "node:zlib";
import { promisify as promisify2 } from "node:util";
var gzip = promisify2(gzipCallback);
var WALL_CHUNK_MS = 60 * 60 * 1e3;
var MAX_PART_BYTES = 4 * 1024 * 1024;
var MAX_PARTS = 128;
var digest2 = (text) => createHash4("sha256").update(text).digest("hex");
function canonicalPageHash(page) {
  const { profileStatus, ...canonical } = page;
  return digest2(JSON.stringify(canonical));
}
var atomic = atomicWrite;
async function boundedFile(file, maxBytes, signal) {
  signal?.throwIfAborted();
  const handle = await open3(file, "r");
  try {
    if ((await handle.stat()).size > maxBytes) throw Error("Prepared wall file byte budget");
    return await handle.readFile({ signal });
  } finally {
    await handle.close();
  }
}
async function readWallChunkManifest(root, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid wall chunk key");
  const state = JSON.parse((await boundedFile(join2(root, key, "manifest.json"), 128 * 1024, signal)).toString());
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
  if (digest2(JSON.stringify(state.parts.map((p) => p.canonicalHash))) !== state.request.sourceRevision) throw Error("Prepared wall manifest source revision mismatch");
  return state;
}
async function readWallChunkPart(root, key, hash3, signal) {
  if (!/^[a-f0-9]{64}$/.test(hash3)) throw Error("Invalid wall part hash");
  const manifest = await readWallChunkManifest(root, key, signal), part = manifest.parts.find((p) => p.hash === hash3);
  if (!part) throw Error("Wall part is not in the completed manifest");
  const body = await boundedFile(join2(root, key, hash3 + ".json.gz"), MAX_PART_BYTES + 1024, signal);
  if (body.byteLength !== part.compressedBytes || digest2(body) !== part.compressedHash) throw Error("Prepared wall part content hash mismatch");
  return { body, part, manifest };
}
var sameWallRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function verifiedWallViewKey(proof) {
  validateWallSourceRequest(proof);
  if (proof.version !== 1 || ![proof.head?.cursor, proof.head?.epoch, proof.head?.at].every((value) => Number.isSafeInteger(value) && value >= 0) || proof.head.at < proof.to - 1 || proof.kind !== "wall-source-sha256-xor-v1" || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token) || !Number.isSafeInteger(proof.watermark) || proof.watermark < 0 || proof.head.cursor !== proof.watermark) throw Error("Invalid prepared wall view source");
  return digest2(JSON.stringify({ version: 5, market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, sourceToken: proof.token }));
}
var preparedWallLookupKey = (request) => digest2(JSON.stringify({ version: 1, market: request.market, profile: request.profile, from: request.from, to: request.to }));
async function publishWallViewLookup(root, state) {
  const proof = state.sourceProof;
  await mkdir2(join2(root, "lookup"), { recursive: true });
  await atomic(join2(root, "lookup", preparedWallLookupKey(proof) + ".json"), JSON.stringify({ version: 1, key: state.key, sourceToken: proof.token }));
}
async function advancePreparedWallView(root, proof, deps = {}) {
  const key = verifiedWallViewKey(proof), dir = join2(root, key);
  await mkdir2(dir, { recursive: true });
  let overlap;
  if (deps.reuse) {
    if (deps.reuse.validatedForToken !== proof.token) throw Error("Invalid prepared overlap validation identity");
    const old = await readWallChunkManifest(root, deps.reuse.sourceKey);
    overlap = canonicalWallOverlap(root, old, proof, deps.read ?? query);
  }
  const load = deps.load ?? ((request2) => orderWallsArchiveHistory(request2, deps.read ?? query, overlap)), source2 = deps.source ?? wallSourceVersion;
  let state;
  try {
    state = JSON.parse((await boundedFile(join2(dir, "progress.json"), 128 * 1024)).toString());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state && (state.version !== 5 || state.key !== key || state.sourceProof?.token !== proof.token || state.watermark !== proof.watermark)) throw Error("Prepared wall view checkpoint identity mismatch");
  if (state?.complete) {
    const current = await source2(proof);
    if (!current.eligible || current.watermark < proof.watermark) throw Error("Prepared wall source unavailable or behind pinned horizon; retry without resetting");
    if (current.token !== proof.token) throw Error("Prepared wall source changed; request a new revision");
    const valid = await readWallChunkManifest(root, key).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await atomic(join2(dir, "manifest.json"), JSON.stringify(state));
      return readWallChunkManifest(root, key);
    });
    await publishWallViewLookup(root, valid);
    return valid;
  }
  if ((state?.parts.length ?? 0) >= MAX_PARTS) throw Error("Prepared wall view part capacity; validated prefix retained");
  const after = state?.after ?? 0;
  const page = await load({ market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, after, display: true, pinnedHead: proof.head });
  if (page.coverage.status === "unavailable") throw Error("Prepared wall source unavailable: " + page.coverage.reason);
  if (!("head" in page) || !page.head || JSON.stringify(page.head) !== JSON.stringify(proof.head) || page.watermark !== proof.watermark || page.from !== proof.from || page.to !== proof.to || page.profile?.id !== proof.profile || !Number.isSafeInteger(page.page?.after) || !Number.isSafeInteger(page.page?.nextAfter) || page.page.after < after || page.page.nextAfter < page.page.after || page.page.nextAfter > proof.watermark || state && page.page.after !== after || page.page.hasMore && page.page.nextAfter <= after || !page.page.hasMore && page.page.nextAfter !== proof.watermark) throw Error("Invalid canonical prepared wall page");
  const text = JSON.stringify(page), bytes = Buffer.byteLength(text);
  if (bytes > MAX_PART_BYTES) throw Error("Prepared wall page byte capacity; prefix retained");
  const compressed = await gzip(text, { level: 6 }), hash3 = digest2(text);
  const part = { index: state?.parts.length ?? 0, hash: hash3, canonicalHash: canonicalPageHash(page), bytes, compressedBytes: compressed.byteLength, compressedHash: digest2(compressed), encoding: "json-gzip-v1", after: page.page.after, nextAfter: page.page.nextAfter, lastAt: page.page.lastAt, observations: page.page.observations ?? page.patches.length };
  part.projectionReplay = wallProjectionReplay(page);
  const parts = [...state?.parts ?? [], part], complete = !page.page.hasMore;
  if (complete) {
    const current = await source2(proof);
    if (!current.eligible || current.watermark < proof.watermark) throw Error("Prepared wall source unavailable or behind pinned horizon; retry without resetting");
    if (current.token !== proof.token) throw Error("Prepared wall source changed; request a new revision");
  }
  const request = { market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, display: true, sourceRevision: digest2(JSON.stringify(parts.map((part2) => part2.canonicalHash))) };
  const next = { version: 5, key, sourceProof: proof, request, watermark: proof.watermark, head: page.head, after: page.page.nextAfter, parts, complete, coverage: page.coverage, seed: state?.seed ?? ("seed" in page ? page.seed : null) ?? null, profile: page.profile };
  await atomic(join2(dir, hash3 + ".json.gz"), compressed);
  await atomic(join2(dir, "progress.json"), JSON.stringify(next));
  if (complete) {
    await atomic(join2(dir, "manifest.json"), JSON.stringify(next));
    await publishWallViewLookup(root, next);
  }
  return next;
}

// src/wall-history-projection.ts
import { createHash as createHash5 } from "node:crypto";
import { open as open4, mkdir as mkdir3 } from "node:fs/promises";
import { join as join3 } from "node:path";
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
  static restoreCheckpoint(value, settings2, from, to, namespace = "") {
    validateCheckpoint(value, settings2, from, to, namespace);
    const state = value, projector = new _OrderWallsArchiveProjector(settings2, from, to, namespace);
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
    const state = value, projector = new _OrderWallsArchiveProjector(settings2, from, to, namespace);
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
  for (const state of v.candidates) {
    if (!isRecord(state) || !validCandidate(state.candidate) || candidateIds.has(state.candidate.entryId) || typeof state.eligible !== "boolean" || state.eligible !== (state.candidate.rank <= settings2.topLevels && (!settings2.minimumNotionalEnabled || compareDecimalToNumber(state.candidate.notional, settings2.minimumNotionalUsd) >= 0)) || !finiteNonNegative(state.lastAt) || !finiteNonNegative(state.usdMs) || !finiteNonNegative(state.peakUsd) || typeof state.qualifyingStartKnown !== "boolean" || state.qualifyingAt !== void 0 && !finiteNonNegative(state.qualifyingAt) || state.qualifyingCursor !== void 0 && !validInt(state.qualifyingCursor) || state.qualifyingCandidate !== void 0 && (!validCandidate(state.qualifyingCandidate) || state.qualifyingCandidate.entryId !== state.candidate.entryId) || state.valueSignature !== void 0 && typeof state.valueSignature !== "string") fail();
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
var hash2 = (value) => createHash5("sha256").update(value).digest("hex");
var WALL_PROJECTION_PART_BYTES = 4 * 1024 * 1024;
var MAX_STATE_BYTES = 32 * 1024 * 1024;
var MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
var MAX_PARTS2 = 512;
function preparedWallProjectionManifest(state) {
  const { entries, nextOrder: _order, nextPage: _page, replayKeys: _replay, prefixInstall: _install, ...manifest } = state;
  const parts = new Map(state.parts.map((part, index) => [part.hash, index]));
  const closed = Object.values(entries).filter((entry) => entry.rows).sort((a, b) => a.order - b.order).map((entry) => entry.rows.map(([digest3, row]) => {
    const part = parts.get(digest3);
    if (part === void 0 || !Number.isSafeInteger(row) || row < 0 || row >= state.parts[part].records) throw Error("Prepared wall projection closed index mismatch");
    return [part, row];
  }));
  return { ...manifest, closed, activeOrder: state.active.segments.map((segment) => {
    const entry = entries[segment.id];
    if (!entry || entry.rows) throw Error("Prepared wall projection active index mismatch");
    return entry.order;
  }) };
}
async function boundedRead(path, max) {
  const file = await open4(path, "r");
  try {
    if ((await file.stat()).size > max) throw Error("Prepared wall projection file capacity");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function readPreparedWallProjectionManifest(root, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid prepared wall projection key");
  signal?.throwIfAborted();
  const state = JSON.parse((await boundedRead(join3(root, key, "manifest.json"), 8 * 1024 * 1024)).toString());
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
async function readPreparedWallProjectionPart(root, manifest, index, signal) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.parts.length) throw Error("Invalid prepared wall projection part index");
  signal?.throwIfAborted();
  const part = manifest.parts[index], body = await boundedRead(join3(root, manifest.key, part.hash + ".json.gz"), WALL_PROJECTION_PART_BYTES + 1024);
  if (body.byteLength !== part.compressedBytes || hash2(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
  signal?.throwIfAborted();
  return body;
}
function normalizedSettings(s) {
  if (!Number.isSafeInteger(s.topLevels) || s.topLevels < 1 || s.topLevels > 100 || typeof s.minimumNotionalEnabled !== "boolean" || !Number.isFinite(s.minimumNotionalUsd) || s.minimumNotionalUsd < 0 || !Number.isSafeInteger(s.minDurationMs) || s.minDurationMs < 0) throw Error("Invalid prepared wall projection settings");
  return { topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs };
}
function preparedWallProjectionKey(sourceKey, settings2) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw Error("Invalid prepared wall projection source key");
  return hash2(JSON.stringify({ version: 2, sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalizedSettings(settings2) }));
}
async function advancePreparedWallProjection(root, sourceRoot, sourceKey, settings2, deps = {}) {
  const source2 = await readWallChunkManifest(sourceRoot, sourceKey);
  if (source2.version !== 5 || !source2.sourceProof) throw Error("Prepared wall projection requires verified canonical history");
  settings2 = normalizedSettings(settings2);
  const profile2 = source2.profile, desired = canonicalProfileConfig({ bandPercent: profile2.bandPercent, aggregation: profile2.aggregation, confirmationMs: settings2.minDurationMs, selectionTopN: settings2.topLevels, minimumNotionalUsd: settings2.minimumNotionalEnabled ? settings2.minimumNotionalUsd : null });
  if (profile2.confirmationMs !== desired.confirmationMs || profile2.selectionTopN !== desired.selectionTopN || profile2.minimumNotionalUsd !== desired.minimumNotionalUsd || !Number.isSafeInteger(profile2.exactDerivations?.topNMax) || profile2.exactDerivations.topNMax < settings2.topLevels || profile2.exactDerivations?.minimumNotional !== true || profile2.exactDerivations?.confirmation !== true || settings2.minDurationMs > 0 && profile2.exactDerivations?.confirmationCrossings !== true) throw Error("Prepared wall projection configuration is not exactly derivable from source profile");
  const key = preparedWallProjectionKey(sourceKey, settings2), dir = join3(root, key);
  await mkdir3(dir, { recursive: true });
  let state;
  try {
    state = JSON.parse((await boundedRead(join3(dir, "progress.json"), MAX_STATE_BYTES)).toString());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state && (state.version !== 2 || state.key !== key || state.core !== WALL_PROJECTION_CORE_SHA256 || state.sourceKey !== sourceKey || state.sourceToken !== source2.sourceProof.token || !Number.isSafeInteger(state.nextPage) || state.nextPage < 0 || state.nextPage > source2.parts.length || state.complete !== (state.nextPage === source2.parts.length))) throw Error("Prepared wall projection checkpoint identity mismatch");
  const validateSource = async () => {
    const current = await (deps.source ?? wallSourceVersion)(source2.sourceProof);
    if (!current.eligible || current.watermark < source2.watermark) throw Error("Prepared wall projection source unavailable or behind pinned horizon; retry without resetting");
    if (current.token !== source2.sourceProof.token) throw Error("Prepared wall projection source changed; request a new revision");
  };
  if (!state && deps.reuseProjectionKey) state = await beginProjectionPrefix(root, sourceRoot, source2, key, settings2, deps.reuseProjectionKey);
  if (state?.prefixInstall) {
    const install = state.prefixInstall;
    if (!/^[a-f0-9]{64}$/.test(install.projectionKey) || !/^[a-f0-9]{64}$/.test(install.sourceKey) || !Number.isSafeInteger(install.nextPart) || install.nextPart < 0 || install.nextPart > state.parts.length || state.reusedPrefixPages !== state.nextPage || state.nextPage < 1) throw Error("Invalid projection prefix installation");
    const old = await readPreparedWallProjectionManifest(root, install.projectionKey), part2 = state.parts[install.nextPart];
    if (old.sourceKey !== install.sourceKey) throw Error("Projection prefix source membership mismatch");
    if (part2) {
      const index2 = old.parts.findIndex((p) => p.hash === part2.hash);
      if (index2 < 0 || JSON.stringify(old.parts[index2]) !== JSON.stringify(part2)) throw Error("Projection prefix part membership mismatch");
      const body = await readPreparedWallProjectionPart(root, old, index2);
      await atomicWrite(join3(dir, part2.hash + ".json.gz"), body);
      install.nextPart++;
    }
    if (install.nextPart >= state.parts.length) delete state.prefixInstall;
    const text2 = JSON.stringify(state);
    if (Buffer.byteLength(text2) > MAX_STATE_BYTES) throw Error("Prepared wall projection checkpoint capacity");
    await atomicWrite(join3(dir, "progress.json"), text2);
    return state;
  }
  if (state?.complete) {
    await validateSource();
    await atomicWrite(join3(dir, "manifest.json"), JSON.stringify(preparedWallProjectionManifest(state)));
    return state;
  }
  const projector = state ? OrderWallsArchiveProjector.restoreCheckpoint(state.active, settings2, source2.request.from, source2.request.to) : new OrderWallsArchiveProjector(settings2, source2.request.from, source2.request.to);
  const index = state?.nextPage ?? 0, part = source2.parts[index];
  let page;
  if (deps.load) page = await deps.load(index, source2);
  else {
    const { body } = await readWallChunkPart(sourceRoot, sourceKey, part.hash);
    const text2 = await gunzip2(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    if (text2.byteLength !== part.bytes || hash2(text2) !== part.hash) throw Error("Prepared wall projection canonical part hash mismatch");
    page = JSON.parse(text2.toString());
  }
  if (deps.load && hash2(JSON.stringify(page)) !== part.hash || JSON.stringify(page.profile) !== JSON.stringify(profile2) || page.from !== source2.request.from || page.to !== source2.request.to || page.watermark !== source2.watermark || JSON.stringify(page.head) !== JSON.stringify(source2.head) || page.page.after !== part.after || page.page.nextAfter !== part.nextAfter || page.page.hasMore !== index < source2.parts.length - 1) throw Error("Prepared wall projection canonical identity mismatch");
  const replay = wallProjectionReplay(page);
  if (part.projectionReplay && JSON.stringify(replay) !== JSON.stringify(part.projectionReplay)) throw Error("Canonical projection replay hash mismatch");
  const entries = { ...state?.entries ?? {} };
  let nextOrder = state?.nextOrder ?? 0;
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
  const parts = [...state?.parts ?? []];
  let batch = [], batchBytes = 2;
  const flush = async () => {
    if (!batch.length) return;
    const text2 = JSON.stringify(batch), bytes = Buffer.byteLength(text2), digest3 = hash2(text2), existing = parts.find((part2) => part2.hash === digest3);
    if (!existing && (parts.length >= MAX_PARTS2 || parts.reduce((sum, p) => sum + p.bytes, 0) + bytes > MAX_OUTPUT_BYTES)) throw Error("Prepared wall projection output capacity; validated prefix retained");
    for (const [row, record] of batch.entries()) {
      const entry = entries[record.segment.id];
      (entry.rows ??= []).push([digest3, row]);
    }
    if (!existing) {
      const body = await gzip2(text2, { level: 6 });
      await atomicWrite(join3(dir, digest3 + ".json.gz"), body);
      parts.push({ hash: digest3, compressedHash: hash2(body), bytes, compressedBytes: body.byteLength, records: batch.length });
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
  const complete = index + 1 === source2.parts.length;
  const next = {
    version: 2,
    key,
    sourceKey,
    sourceToken: source2.sourceProof.token,
    core: WALL_PROJECTION_CORE_SHA256,
    settings: settings2,
    nextPage: index + 1,
    complete,
    parts,
    entries,
    nextOrder,
    active,
    ...state?.reusedPrefixPages ? { reusedPrefixPages: state.reusedPrefixPages } : {},
    replayKeys: [...state?.replayKeys ?? [], replay],
    coverage: page.coverage,
    profile: source2.profile
  };
  if (complete && state && state.nextPage > 0 && state.replayKeys?.length === state.nextPage && !state.complete) {
    const prefix = JSON.stringify(state), bytes = Buffer.byteLength(prefix);
    if (bytes <= MAX_STATE_BYTES) {
      const digest3 = hash2(prefix);
      await atomicWrite(join3(dir, digest3 + ".prefix.json"), prefix);
      next.extensionPrefix = { hash: digest3, bytes };
    }
  }
  const text = JSON.stringify(next);
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw Error("Prepared wall projection checkpoint capacity; validated prefix retained");
  if (complete) await validateSource();
  await atomicWrite(join3(dir, "progress.json"), text);
  if (complete) await atomicWrite(join3(dir, "manifest.json"), JSON.stringify(preparedWallProjectionManifest(next)));
  return next;
}
async function beginProjectionPrefix(root, sourceRoot, source2, key, settings2, oldKey) {
  const old = await readPreparedWallProjectionManifest(root, oldKey), reference = old.extensionPrefix;
  if (!reference) return;
  if (!/^[a-f0-9]{64}$/.test(reference.hash) || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > MAX_STATE_BYTES) throw Error("Invalid projection extension prefix metadata");
  const bytes = await boundedRead(join3(root, oldKey, reference.hash + ".prefix.json"), MAX_STATE_BYTES);
  if (bytes.length !== reference.bytes || hash2(bytes) !== reference.hash) throw Error("Projection extension prefix hash mismatch");
  const prefix = JSON.parse(bytes.toString()), prior = await readWallChunkManifest(sourceRoot, old.sourceKey);
  if (old.sourceToken !== prior.sourceProof?.token || old.active.from !== prior.request.from || old.active.to !== prior.request.to) throw Error("Projection extension canonical identity mismatch");
  if (prefix.version !== 2 || prefix.complete || prefix.prefixInstall || prefix.key !== old.key || preparedWallProjectionKey(prefix.sourceKey, prefix.settings) !== prefix.key || JSON.stringify(prefix.settings) !== JSON.stringify(old.settings) || prefix.core !== WALL_PROJECTION_CORE_SHA256 || prefix.sourceKey !== old.sourceKey || prefix.sourceToken !== old.sourceToken || prefix.nextPage < 1 || prefix.nextPage >= source2.parts.length || prefix.replayKeys?.length !== prefix.nextPage) throw Error("Invalid projection extension prefix identity");
  if (JSON.stringify(settings2) !== JSON.stringify(prefix.settings) || source2.request.market !== prior.request.market || source2.request.profile !== prior.request.profile || source2.request.from !== prior.request.from || source2.request.to <= prior.request.to || source2.watermark < prior.watermark) return;
  if (prefix.active.from !== source2.request.from || prefix.active.to !== prior.request.to || prefix.active.confirmedTo >= prior.request.to) return;
  for (let i = 0; i < prefix.nextPage; i++) {
    const a = prefix.replayKeys[i], b = source2.parts[i]?.projectionReplay;
    if (!b || a.hash !== b.hash || a.maxAt !== b.maxAt || a.maxAt >= prior.request.to) return;
  }
  const active = { ...prefix.active, to: source2.request.to };
  OrderWallsArchiveProjector.restoreCheckpoint(active, settings2, source2.request.from, source2.request.to);
  const pub = new Map(old.parts.map((p) => [p.hash, JSON.stringify(p)]));
  if (prefix.parts.some((p) => pub.get(p.hash) !== JSON.stringify(p))) throw Error("Projection extension prefix output mismatch");
  return {
    ...prefix,
    key,
    sourceKey: source2.key,
    sourceToken: source2.sourceProof.token,
    active,
    complete: false,
    profile: source2.profile,
    coverage: source2.coverage,
    reusedPrefixPages: prefix.nextPage,
    prefixInstall: { sourceKey: old.sourceKey, projectionKey: oldKey, nextPart: 0 }
  };
}
async function restorePreparedWallProjection(root, state) {
  return restorePreparedWallProjectionManifest(root, preparedWallProjectionManifest(state));
}
async function restorePreparedWallProjectionManifest(root, state) {
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
    const body = await boundedRead(join3(root, state.key, part.hash + ".json.gz"), WALL_PROJECTION_PART_BYTES + 1024);
    if (body.byteLength !== part.compressedBytes || hash2(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
    const text = await gunzip2(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    if (text.byteLength !== part.bytes || hash2(text) !== part.hash) throw Error("Prepared wall projection decoded hash mismatch");
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

// ops/verify-wall-head-boundary.mjs
assert.equal(process.env.IQ_WALL_HEAD_BOUNDARY_REFERENCE, "1");
var url2 = new URL(process.env.CH_URL ?? "http://invalid");
assert.equal(url2.hostname, "127.0.0.1");
assert.equal(url2.port, "18790");
assert.equal(url2.protocol, "http:");
assert.ok(getHeapStatistics().heap_size_limit <= 320 * 1024 ** 2, "Use the established 256MiB V8 budget");
var [market] = process.argv.slice(2);
assert.ok(["spot", "perpetual"].includes(market));
assert.deepEqual(await readdir("/proof"), [], "Use an empty, isolated output mount");
var disk = await statfs("/proof");
assert.ok(Number(disk.bavail) * Number(disk.bsize) >= 20 * 1024 ** 3 + 256 * 1024 ** 2);
var profile = archiveProfile(market);
var timing = { priority: "background", dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId: "head-boundary-" + market };
await queryTiming.run(timing, async () => {
  const rows = await query(`SELECT profile,cursor,epoch,at,availableFrom,midpoint,bookScope FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${profile.id}' LIMIT 1 SETTINGS max_threads=1,max_execution_time=5`);
  assert.equal(rows.length, 1);
  const pinned = rows[0], h = Number(pinned.at), cursor = Number(pinned.cursor);
  assert.ok(Number.isSafeInteger(h) && h > 6e4 && Number.isSafeInteger(cursor) && cursor > 0);
  const request = { market, profile: profile.id, from: Math.max(Number(pinned.availableFrom) + 1, h - 6e4), to: h + 1 };
  assert.ok(request.from < h, "Retained past source required");
  const read = async (sql2) => sql2.includes("FROM iqterminal.order_wall_archive_progress FINAL") ? [pinned] : query(sql2);
  const source2 = (request2) => wallSourceVersion(request2, read), before = await source2(request);
  assert.equal(before.eligible, true);
  assert.equal(before.head.at, request.to - 1);
  assert.equal(before.watermark, cursor);
  let canonical, projection;
  const canonicalRoot = "/proof/canonical", projectionRoot = "/proof/projections";
  await mkdir4(canonicalRoot);
  await mkdir4(projectionRoot);
  for (let i = 0; i < 16; i++) {
    canonical = await advancePreparedWallView(canonicalRoot, before, { read, source: source2 });
    if (canonical.complete) break;
  }
  assert.ok(canonical?.complete, "Bounded one-minute canonical build must finish within16pages");
  const settings2 = { topLevels: 8, minimumNotionalEnabled: false, minimumNotionalUsd: 0, minDurationMs: 0 };
  for (let i = 0; i < 16; i++) {
    projection = await advancePreparedWallProjection(projectionRoot, canonicalRoot, canonical.key, settings2, { source: source2 });
    if (projection.complete) break;
  }
  assert.ok(projection?.complete);
  const reference = new OrderWallsArchiveProjector(settings2, request.from, request.to);
  for (const part of canonical.parts) {
    const body = await readFile3(join4(canonicalRoot, canonical.key, part.hash + ".json.gz"));
    reference.applyPage(JSON.parse(gunzipSync(body, { maxOutputLength: 4 * 1024 ** 2 }).toString()));
  }
  const restored = await restorePreparedWallProjection(projectionRoot, projection), json = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(json(restored.snapshot()), json(reference.snapshot()));
  assert.deepEqual(json(restored.selectedState()), json(reference.selectedState()));
  const after = await source2(request);
  assert.equal(after.token, before.token);
  assert.equal(after.eligible, true);
  assert.equal(canonical.coverage.confirmedTo, h);
  assert.equal(canonical.coverage.requestedTo, h + 1);
  console.log(JSON.stringify({ kind: "fixed-head-canonical-reference", market, request, head: before.head, sourceToken: before.token, canonicalKey: canonical.key, projectionKey: projection.key, records: before.records, pages: canonical.parts.length, segments: reference.snapshot().length, points: reference.snapshot().reduce((n, s) => n + s.valueRuns.length, 0), coverage: canonical.coverage, timing, memory: process.memoryUsage(), result: "exact-match", scope: "Bounded real canonical one-minute data; this read adapter pins only the captured progress row while original canonical SQL and before/after hashes read the live DB. Shared-kernel reference, not independent raw-book reconstruction, normal HTTP serving, live continuation or latency acceptance." }));
});

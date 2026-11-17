// ops/run-wall-preparations.mjs
import assert from "node:assert/strict";
import { getHeapStatistics } from "node:v8";
import { createHash as createHash6 } from "node:crypto";
import { mkdir as mkdir6, open as open7, readFile as readFile4, readdir, stat, statfs, unlink as unlink3, rmdir as rmdir3, appendFile as appendFile2, realpath as realpath2, lstat as lstat3 } from "node:fs/promises";
import { resolve as resolve2, join as join6 } from "node:path";
import { promisify as promisify6 } from "node:util";
import { execFile } from "node:child_process";
import { performance as performance3 } from "node:perf_hooks";

// src/wall-cache-retention.ts
import { mkdir as mkdir4, lstat, open as open5, rename as rename2, unlink, rmdir, opendir, realpath } from "node:fs/promises";
import { join as join4, resolve } from "node:path";

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
import { createHash as createHash2 } from "node:crypto";
import { gunzip as unzip } from "node:zlib";
import { promisify } from "node:util";

// src/db.ts
import { performance as performance2 } from "node:perf_hooks";

// src/query-timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
var queryTiming = new AsyncLocalStorage();

// src/db.ts
var url = process.env.CH_URL ?? "http://127.0.0.1:18123";
async function sql(query2, data) {
  const started2 = performance2.now(), m = queryTiming.getStore(), target = new URL(url);
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
    if (m) m.dbMs += performance2.now() - started2;
  }
}
async function query(q) {
  const text = await sql(q + " FORMAT JSONEachRow");
  const start = performance2.now();
  const rows = text.trim() ? text.trim().split("\n").map((x) => JSON.parse(x)) : [];
  const m = queryTiming.getStore();
  if (m) m.decodeMs += performance2.now() - start;
  for (const row of rows) if (row.exception) throw Error(`ClickHouse streamed exception: ${String(row.exception).slice(0, 200)}`);
  return rows;
}

// src/wall-canonical-overlap.ts
import { open as open2 } from "node:fs/promises";
import { join } from "node:path";

// src/archive-event-query.ts
function archiveEventReadSql(profile, where, order, limit, table2 = "order_wall_archive_events") {
  if (!["order_wall_archive_events", "order_wall_current_events"].includes(table2)) throw Error("Invalid Order Walls event table");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50001) throw Error("Invalid bounded Order Walls event read");
  return `SELECT cursor,epoch,at,kind,payload FROM iqterminal.${table2} FINAL PREWHERE profile='${profile}' AND (epoch,cursor,kind) IN (SELECT epoch,cursor,kind FROM iqterminal.${table2} FINAL WHERE profile='${profile}' AND ${where} ORDER BY ${order} LIMIT ${limit}) WHERE ${where} ORDER BY ${order} LIMIT ${limit} SETTINGS enable_shared_storage_snapshot_in_query=1,max_threads=2,max_block_size=256,max_result_bytes=16777216,result_overflow_mode='throw'`;
}

// src/wall-canonical-overlap.ts
var gunzip = promisify(unzip);
var hash = (b) => createHash2("sha256").update(b).digest("hex");
var SCAN_BYTES = 8 * 1024 * 1024;
var ROW_BYTES = 16 * 1024 * 1024;
var ScanCapacity = class extends Error {
};
function canonicalWallOverlap(root2, old, target, read = query) {
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
      const file = join(root2, verifiedWallViewKey(target), "overlap-tail.json");
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
      const digest3 = (rows2) => createHash2("sha256").update(JSON.stringify(rows2)).digest("hex");
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
    const part = old.parts[index], { body } = await readWallChunkPart(root2, old.key, part.hash);
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

// src/wall-source-version.ts
import { createHash as createHash3 } from "node:crypto";

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
function depthSourceFor(marketValue = config.market) {
  const market = marketConfig(marketValue);
  return { table: market.depthTable, source: `venue='binance' AND market='${market.market}' AND nativeSymbol='BTCUSDT' AND feed='${market.depthFeed}'` };
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
var unavailableDerivations = { bandPercent: [], topNMax: 0, minimumNotional: false, confirmation: false };
var archiveHistoryMetadata = /* @__PURE__ */ new Map();
var archiveHistoryMetadataBytes = 0;
function immutableHistoryReader(reader, refresh = false) {
  if (reader !== query) return reader;
  return (async (sql3) => {
    const hit = archiveHistoryMetadata.get(sql3);
    if (hit && hit.expires > Date.now() && !refresh) return hit.rows;
    if (hit) {
      archiveHistoryMetadataBytes -= hit.bytes;
      archiveHistoryMetadata.delete(sql3);
    }
    const rows = await reader(sql3), bytes = Buffer.byteLength(JSON.stringify(rows));
    if (bytes < 2 * 1024 * 1024) {
      while (archiveHistoryMetadata.size >= 128 || archiveHistoryMetadataBytes + bytes > 8 * 1024 * 1024) {
        const key = archiveHistoryMetadata.keys().next().value;
        if (key === void 0) break;
        archiveHistoryMetadataBytes -= archiveHistoryMetadata.get(key).bytes;
        archiveHistoryMetadata.delete(key);
      }
      archiveHistoryMetadata.set(sql3, { expires: Date.now() + 6e4, bytes, rows });
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
function displaySnapshotKey(profile, from, to, watermark) {
  return `${profile}:${from}:${to}:${watermark}`;
}
async function orderWallsArchiveHistory(request, queryRows = query, reuse) {
  const requested = request.profile, parsed = parseArchiveProfileId(request.market, requested);
  const profile = parsed?.profile ?? archiveProfile(request.market);
  validateArchiveRange(request.from, request.to);
  const limit = request.display ? request.after ? 4096 : 512 : validateArchivePage(request.after, request.limit);
  const after = request.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid archive source cursor");
  if (!parsed) return unavailableHistory(profile, requested, request, after, limit, "Requested profile identity is invalid or unsupported");
  const progressCache = request.display ? displayProgressCache(queryRows) : void 0;
  const cachedProgress = after > 0 && request.watermark !== void 0 ? progressCache?.get(displaySnapshotKey(profile.id, request.from, request.to, request.watermark)) : void 0;
  const progress = cachedProgress && cachedProgress.expires > Date.now() ? cachedProgress.progress : await getProgress(profile.id, queryRows);
  if (!progress) return unavailableHistory(profile, requested, request, after, limit, "Archive profile has not observed source data");
  const retentionBoundary = Number(progress.at) - ARCHIVE_EVENT_RETENTION_DAYS * 864e5 - 1e3;
  if (request.from < retentionBoundary) return unavailableHistory(
    profile,
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
    const key = displaySnapshotKey(profile.id, request.from, request.to, watermark);
    if (Buffer.byteLength(JSON.stringify(progress)) <= 16 * 1024) {
      for (const [oldKey, value] of progressCache) if (value.expires <= Date.now()) progressCache.delete(oldKey);
      if (progressCache.size >= 64) progressCache.delete(progressCache.keys().next().value);
      progressCache.set(key, { expires: Date.now() + 6e4, progress });
    }
  }
  const metadataReader = immutableHistoryReader(queryRows, after === 0);
  const pinned = request.pinnedHead;
  if (pinned && (![pinned.cursor, pinned.epoch, pinned.at].every((value) => Number.isSafeInteger(value) && value >= 0) || pinned.cursor !== watermark)) throw Error("Invalid prepared wall source head");
  const head = pinned ? { ...pinned } : await archiveSourceHeadAt(profile, watermark, progress, metadataReader);
  const seedState = after === 0 ? await archiveStateBefore(profile.id, request.from, watermark, metadataReader) : { state: void 0, gaps: [], overflow: false };
  const pageAfter = after === 0 ? Math.max(after, Number(seedState.state?.cursor ?? 0)) : after;
  const candidates = reuse ? await reuse.events(pageAfter, watermark, limit + 1) : await archiveEvents(
    profile.id,
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
    profile.id,
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
  const gaps = await archiveEvents(profile.id, `cursor<=${watermark} AND at>=${request.from} AND at<${request.to} AND kind='gap'`, "cursor ASC,kind ASC", 257, metadataReader);
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
    ...request.display ? { displayVersion: 1, snapshot: `${profile.id}:${watermark}:${request.from}:${request.to}` } : {},
    profile,
    market: profile.market,
    instrument: profile.instrument,
    feed: profile.feed,
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
async function archiveSourceHeadAt(profile, cursor, progress, queryRows) {
  if (cursor === Number(progress.cursor)) return { cursor, at: Number(progress.at), epoch: Number(progress.epoch) };
  if (cursor === 0) return { cursor: 0, at: 0, epoch: 0 };
  const { table: table2, source: source2 } = depthSourceFor(profile.market);
  const rows = await queryRows(`SELECT cursor,epoch,at FROM iqterminal.${table2} FINAL WHERE ${source2} AND cursor=${cursor} ORDER BY epoch DESC,cursor DESC LIMIT 1 SETTINGS max_threads=2,max_block_size=256,max_memory_usage=134217728,max_execution_time=15`);
  if (!rows.length) throw new Error("Pinned Order Walls watermark source cursor is no longer retained");
  return { cursor: Number(rows[0].cursor), at: Number(rows[0].at), epoch: Number(rows[0].epoch) };
}
async function archiveStateBefore(profile, from, watermark, queryRows) {
  const anchors = await queryRows(`SELECT cursor,epoch,at,midpoint,bookScope,payload FROM iqterminal.order_wall_archive_anchors FINAL WHERE profile='${profile}' AND cursor<=${watermark} AND at<${from} ORDER BY at DESC,cursor DESC LIMIT 1 SETTINGS max_threads=2,max_block_size=256`);
  if (!anchors.length) return { state: void 0, gaps: [], overflow: false };
  const anchor = anchors[0], snapshot = typeof anchor.payload === "string" ? JSON.parse(anchor.payload) : anchor.payload;
  const active = { bids: /* @__PURE__ */ new Map(), asks: /* @__PURE__ */ new Map() };
  for (const side of ["bids", "asks"]) for (const item of snapshot[side] ?? []) active[side].set(item.candidate.entryId, item.candidate);
  const keys = await archiveEvents(
    profile,
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
async function getProgress(profile, queryRows) {
  const rows = await queryRows(`SELECT profile,cursor,epoch,at,availableFrom,midpoint,bookScope FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${profile}' LIMIT 1`);
  return rows[0];
}
async function archiveEvents(profile, where, order, limit, queryRows, table2 = "order_wall_archive_events") {
  if (table2 !== "order_wall_archive_events" && table2 !== "order_wall_current_events") throw new Error("Invalid Order Walls event table");
  const rows = await queryRows(archiveEventReadSql(profile, where, order, limit, table2));
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
async function closeArchiveTimestampGroups(profile, initialPage, hasMore, after, watermark, range, queryRows, table2 = "order_wall_archive_events", reuse) {
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
    const furthest = reuse ? await reuse.furthest(cursor, watermark, timestamps) : await furthestArchiveCursorAtTimes(profile, cursor, watermark, timestamps, range, queryRows, table2);
    if (furthest === cursor) break;
    const extra = reuse ? await reuse.events(cursor, furthest, MAX_RANGE_GROUP + 1) : await archiveEvents(
      profile,
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
    profile,
    `cursor>${cursor} AND cursor<=${watermark}${range}`,
    "cursor ASC,kind ASC",
    1,
    queryRows,
    table2
  );
  return { events, hasMore: remaining.length > 0 };
}
async function furthestArchiveCursorAtTimes(profile, after, watermark, timestamps, range, queryRows, table2) {
  if (!timestamps.size) return after;
  if (timestamps.size > MAX_RANGE_GROUP) throw new Error("Same-time archive closure exceeds timestamp budget");
  const times = [...timestamps].sort((a, b) => a - b);
  const rows = await queryRows(`SELECT at,max(cursor) AS maxCursor FROM iqterminal.${table2} FINAL WHERE profile='${profile}' AND cursor>${after} AND cursor<=${watermark}${range} AND at IN (${times.join(",")}) GROUP BY at LIMIT ${times.length} SETTINGS max_threads=2,max_block_size=256,max_memory_usage=67108864,max_execution_time=15,max_rows_to_read=1000000,max_bytes_to_read=134217728,max_result_bytes=1048576,result_overflow_mode='throw'`);
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
function unavailableHistory(profile, requested, request, after, limit, reason) {
  return {
    version: 1,
    profile: requested === profile.id ? profile : { ...profile, id: requested, exactDerivations: unavailableDerivations },
    market: profile.market,
    instrument: profile.instrument,
    feed: profile.feed,
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
var digest = (value) => createHash3("sha256").update(JSON.stringify(value)).digest("hex");
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
async function readWallChunkManifest(root2, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid wall chunk key");
  const state = JSON.parse((await boundedFile(join2(root2, key, "manifest.json"), 128 * 1024, signal)).toString());
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
async function readWallChunkPart(root2, key, hash3, signal) {
  if (!/^[a-f0-9]{64}$/.test(hash3)) throw Error("Invalid wall part hash");
  const manifest = await readWallChunkManifest(root2, key, signal), part = manifest.parts.find((p) => p.hash === hash3);
  if (!part) throw Error("Wall part is not in the completed manifest");
  const body = await boundedFile(join2(root2, key, hash3 + ".json.gz"), MAX_PART_BYTES + 1024, signal);
  if (body.byteLength !== part.compressedBytes || digest2(body) !== part.compressedHash) throw Error("Prepared wall part content hash mismatch");
  return { body, part, manifest };
}
var sameWallRequest = (a, b) => a.market === b.market && a.profile === b.profile && a.from === b.from && a.to === b.to;
function verifiedWallViewKey(proof) {
  validateWallSourceRequest(proof);
  if (proof.version !== 1 || ![proof.head?.cursor, proof.head?.epoch, proof.head?.at].every((value) => Number.isSafeInteger(value) && value >= 0) || proof.head.at < proof.to || proof.kind !== "wall-source-sha256-xor-v1" || !proof.eligible || !/^[a-f0-9]{64}$/.test(proof.token) || !Number.isSafeInteger(proof.watermark) || proof.watermark < 0 || proof.head.cursor !== proof.watermark) throw Error("Invalid prepared wall view source");
  return digest2(JSON.stringify({ version: 5, market: proof.market, profile: proof.profile, from: proof.from, to: proof.to, watermark: proof.watermark, sourceToken: proof.token }));
}
var preparedWallLookupKey = (request) => digest2(JSON.stringify({ version: 1, market: request.market, profile: request.profile, from: request.from, to: request.to }));
async function publishWallViewLookup(root2, state) {
  const proof = state.sourceProof;
  await mkdir2(join2(root2, "lookup"), { recursive: true });
  await atomic(join2(root2, "lookup", preparedWallLookupKey(proof) + ".json"), JSON.stringify({ version: 1, key: state.key, sourceToken: proof.token }));
}
async function advancePreparedWallView(root2, proof, deps = {}) {
  const key = verifiedWallViewKey(proof), dir = join2(root2, key);
  await mkdir2(dir, { recursive: true });
  let overlap;
  if (deps.reuse) {
    if (deps.reuse.validatedForToken !== proof.token) throw Error("Invalid prepared overlap validation identity");
    const old = await readWallChunkManifest(root2, deps.reuse.sourceKey);
    overlap = canonicalWallOverlap(root2, old, proof, deps.read ?? query);
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
    const valid = await readWallChunkManifest(root2, key).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await atomic(join2(dir, "manifest.json"), JSON.stringify(state));
      return readWallChunkManifest(root2, key);
    });
    await publishWallViewLookup(root2, valid);
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
    await publishWallViewLookup(root2, next);
  }
  return next;
}
async function discoverPreparedWallView(root2, request, source2 = wallSourceVersion) {
  validateWallSourceRequest(request);
  let lookup;
  try {
    lookup = JSON.parse((await boundedFile(join2(root2, "lookup", preparedWallLookupKey(request) + ".json"), 8192)).toString());
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing" };
    throw error;
  }
  if (lookup.version !== 1 || !/^[a-f0-9]{64}$/.test(lookup.sourceToken ?? "") || !/^[a-f0-9]{64}$/.test(lookup.key ?? "")) throw Error("Invalid prepared wall lookup");
  const proof = await source2(request);
  if (!proof.eligible) return { state: "ineligible", source: proof };
  if (lookup.sourceToken !== proof.token) return { state: "missing", source: proof };
  const manifest = await readWallChunkManifest(root2, lookup.key);
  if (manifest.version !== 5 || manifest.sourceProof?.token !== proof.token || !sameWallRequest(manifest.request, request) || manifest.watermark > proof.watermark) throw Error("Prepared wall lookup source identity mismatch");
  return { state: "ready", source: proof, manifest };
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
  constructor(settings4, from, to, segmentNamespace = "") {
    this.settings = settings4;
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
  static restoreCheckpoint(value, settings4, from, to, namespace = "") {
    validateCheckpoint(value, settings4, from, to, namespace);
    const state = value, projector = new _OrderWallsArchiveProjector(settings4, from, to, namespace);
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
  static async restoreCheckpointCooperatively(value, settings4, from, to, work, namespace = "") {
    if (!Number.isFinite(work.budgetMs) || work.budgetMs <= 0 || work.budgetMs > 16) throw Error("Invalid wall import work budget");
    const steps2 = this.restoreCheckpointSteps(value, settings4, from, to, namespace);
    let since = work.now();
    work.check();
    for (; ; ) {
      const next = steps2.next();
      work.check();
      if (next.done) return next.value;
      if (work.now() - since >= work.budgetMs) {
        await work.yield();
        work.check();
        since = work.now();
      }
    }
  }
  static *restoreCheckpointSteps(value, settings4, from, to, namespace) {
    yield* validateCheckpointSteps(value, settings4, from, to, namespace);
    const state = value, projector = new _OrderWallsArchiveProjector(settings4, from, to, namespace);
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
      const runs2 = segment.valueRuns, previous = this.emittedValues.get(patch.id);
      const append = previous && previous.first === runs2[0] && runs2.length >= previous.length;
      if (append) {
        const offset = previous.length > 0 && runs2[previous.length - 1] !== previous.last ? previous.length - 1 : previous.length;
        patches.push({
          ...patch,
          revision: ++this.emittedRevision,
          segment: { ...segment, valueRuns: [] },
          replaceValueRuns: false,
          valuePoints: runs2.slice(offset).map((point) => ({ ...point }))
        });
      } else patches.push({ ...patch, revision: ++this.emittedRevision, segment: cloneSegment(segment), replaceValueRuns: true });
      this.emittedValues.set(patch.id, { first: runs2[0], last: runs2.at(-1), length: runs2.length });
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
function segmentId(entryId, settings4, cursor, startKnown, namespace = "") {
  const filter = `${settings4.topLevels}:${settings4.minimumNotionalEnabled ? settings4.minimumNotionalUsd : "off"}:${settings4.minDurationMs}`;
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
function validateCheckpoint(value, settings4, from, to, namespace) {
  for (const _ of validateCheckpointSteps(value, settings4, from, to, namespace)) {
  }
}
function* validateCheckpointSteps(value, settings4, from, to, namespace) {
  const fail = () => {
    throw Error("Invalid wall projection checkpoint");
  };
  if (!isRecord(value) || value.version !== 1 || value.from !== from || value.to !== to || value.namespace !== namespace || !finiteNonNegative(from) || !finiteNonNegative(to) || from >= to) fail();
  const v = value, filter = v.settings;
  if (!isRecord(filter) || filter.topLevels !== settings4.topLevels || filter.minimumNotionalEnabled !== settings4.minimumNotionalEnabled || filter.minDurationMs !== settings4.minDurationMs || settings4.minimumNotionalEnabled && filter.minimumNotionalUsd !== settings4.minimumNotionalUsd || !validInt(filter.topLevels) || filter.topLevels < 1 || filter.topLevels > 10 || !finiteNonNegative(filter.minimumNotionalUsd) || !finiteNonNegative(filter.minDurationMs) || filter.minDurationMs > 6e4 || typeof filter.minimumNotionalEnabled !== "boolean") fail();
  if (!finiteNonNegative(v.confirmedTo) || v.confirmedTo < from || !validInt(v.cursor) || !validInt(v.epoch) || v.midpoint !== null && !validDecimal(v.midpoint) || v.bookScope !== void 0 && !isRecord(v.bookScope) || typeof v.valueHistoryLimited !== "boolean" || typeof v.episodeHistoryLimited !== "boolean" || !validInt(v.nextValueRunSequence) || !validInt(v.emittedRevision) || !Array.isArray(v.seenGaps) || !Array.isArray(v.segments) || v.segments.length > ORDER_WALL_ARCHIVE_MAX_SEGMENTS || !Array.isArray(v.valueRunOrder) || v.valueRunOrder.length !== v.segments.length || !Array.isArray(v.candidates) || v.candidates.length > 20) fail();
  const ids = /* @__PURE__ */ new Map(), sequences = /* @__PURE__ */ new Set();
  let runs2 = 0, work = 0;
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
      runs2++;
      if (++work % 256 === 0) yield;
    }
    ids.set(segment.id, segment);
    if (++work % 256 === 0) yield;
  }
  if (runs2 > ORDER_WALL_ARCHIVE_MAX_VALUE_RUNS) fail();
  const candidateIds = /* @__PURE__ */ new Set(), activeIds = /* @__PURE__ */ new Set();
  for (const state of v.candidates) {
    if (!isRecord(state) || !validCandidate(state.candidate) || candidateIds.has(state.candidate.entryId) || typeof state.eligible !== "boolean" || state.eligible !== (state.candidate.rank <= settings4.topLevels && (!settings4.minimumNotionalEnabled || compareDecimalToNumber(state.candidate.notional, settings4.minimumNotionalUsd) >= 0)) || !finiteNonNegative(state.lastAt) || !finiteNonNegative(state.usdMs) || !finiteNonNegative(state.peakUsd) || typeof state.qualifyingStartKnown !== "boolean" || state.qualifyingAt !== void 0 && !finiteNonNegative(state.qualifyingAt) || state.qualifyingCursor !== void 0 && !validInt(state.qualifyingCursor) || state.qualifyingCandidate !== void 0 && (!validCandidate(state.qualifyingCandidate) || state.qualifyingCandidate.entryId !== state.candidate.entryId) || state.valueSignature !== void 0 && typeof state.valueSignature !== "string") fail();
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
async function readPreparedWallProjectionManifest(root2, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid prepared wall projection key");
  signal?.throwIfAborted();
  const state = JSON.parse((await boundedRead(join3(root2, key, "manifest.json"), 8 * 1024 * 1024)).toString());
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
async function readPreparedWallProjectionPart(root2, manifest, index, signal) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.parts.length) throw Error("Invalid prepared wall projection part index");
  signal?.throwIfAborted();
  const part = manifest.parts[index], body = await boundedRead(join3(root2, manifest.key, part.hash + ".json.gz"), WALL_PROJECTION_PART_BYTES + 1024);
  if (body.byteLength !== part.compressedBytes || hash2(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
  signal?.throwIfAborted();
  return body;
}
function normalizedSettings(s) {
  if (!Number.isSafeInteger(s.topLevels) || s.topLevels < 1 || s.topLevels > 100 || typeof s.minimumNotionalEnabled !== "boolean" || !Number.isFinite(s.minimumNotionalUsd) || s.minimumNotionalUsd < 0 || !Number.isSafeInteger(s.minDurationMs) || s.minDurationMs < 0) throw Error("Invalid prepared wall projection settings");
  return { topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs };
}
function preparedWallProjectionKey(sourceKey, settings4) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw Error("Invalid prepared wall projection source key");
  return hash2(JSON.stringify({ version: 2, sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalizedSettings(settings4) }));
}
async function advancePreparedWallProjection(root2, sourceRoot, sourceKey, settings4, deps = {}) {
  const source2 = await readWallChunkManifest(sourceRoot, sourceKey);
  if (source2.version !== 5 || !source2.sourceProof) throw Error("Prepared wall projection requires verified canonical history");
  settings4 = normalizedSettings(settings4);
  const profile = source2.profile, desired = canonicalProfileConfig({ bandPercent: profile.bandPercent, aggregation: profile.aggregation, confirmationMs: settings4.minDurationMs, selectionTopN: settings4.topLevels, minimumNotionalUsd: settings4.minimumNotionalEnabled ? settings4.minimumNotionalUsd : null });
  if (profile.confirmationMs !== desired.confirmationMs || profile.selectionTopN !== desired.selectionTopN || profile.minimumNotionalUsd !== desired.minimumNotionalUsd || !Number.isSafeInteger(profile.exactDerivations?.topNMax) || profile.exactDerivations.topNMax < settings4.topLevels || profile.exactDerivations?.minimumNotional !== true || profile.exactDerivations?.confirmation !== true || settings4.minDurationMs > 0 && profile.exactDerivations?.confirmationCrossings !== true) throw Error("Prepared wall projection configuration is not exactly derivable from source profile");
  const key = preparedWallProjectionKey(sourceKey, settings4), dir = join3(root2, key);
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
  if (!state && deps.reuseProjectionKey) state = await beginProjectionPrefix(root2, sourceRoot, source2, key, settings4, deps.reuseProjectionKey);
  if (state?.prefixInstall) {
    const install = state.prefixInstall;
    if (!/^[a-f0-9]{64}$/.test(install.projectionKey) || !/^[a-f0-9]{64}$/.test(install.sourceKey) || !Number.isSafeInteger(install.nextPart) || install.nextPart < 0 || install.nextPart > state.parts.length || state.reusedPrefixPages !== state.nextPage || state.nextPage < 1) throw Error("Invalid projection prefix installation");
    const old = await readPreparedWallProjectionManifest(root2, install.projectionKey), part2 = state.parts[install.nextPart];
    if (old.sourceKey !== install.sourceKey) throw Error("Projection prefix source membership mismatch");
    if (part2) {
      const index2 = old.parts.findIndex((p) => p.hash === part2.hash);
      if (index2 < 0 || JSON.stringify(old.parts[index2]) !== JSON.stringify(part2)) throw Error("Projection prefix part membership mismatch");
      const body = await readPreparedWallProjectionPart(root2, old, index2);
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
  const projector = state ? OrderWallsArchiveProjector.restoreCheckpoint(state.active, settings4, source2.request.from, source2.request.to) : new OrderWallsArchiveProjector(settings4, source2.request.from, source2.request.to);
  const index = state?.nextPage ?? 0, part = source2.parts[index];
  let page;
  if (deps.load) page = await deps.load(index, source2);
  else {
    const { body } = await readWallChunkPart(sourceRoot, sourceKey, part.hash);
    const text2 = await gunzip2(body, { maxOutputLength: WALL_PROJECTION_PART_BYTES });
    if (text2.byteLength !== part.bytes || hash2(text2) !== part.hash) throw Error("Prepared wall projection canonical part hash mismatch");
    page = JSON.parse(text2.toString());
  }
  if (hash2(JSON.stringify(page)) !== part.hash || JSON.stringify(page.profile) !== JSON.stringify(profile) || page.from !== source2.request.from || page.to !== source2.request.to || page.watermark !== source2.watermark || JSON.stringify(page.head) !== JSON.stringify(source2.head) || page.page.after !== part.after || page.page.nextAfter !== part.nextAfter || page.page.hasMore !== index < source2.parts.length - 1) throw Error("Prepared wall projection canonical identity mismatch");
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
      let low = 0, high = totalRuns - offset;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify(fragment(middle))) + 2 <= WALL_PROJECTION_PART_BYTES) low = middle;
        else high = middle - 1;
      }
      if (totalRuns > offset && !low) throw Error("Prepared wall projection point capacity; validated prefix retained");
      const row = fragment(low), bytes = Buffer.byteLength(JSON.stringify(row));
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
    settings: settings4,
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
async function beginProjectionPrefix(root2, sourceRoot, source2, key, settings4, oldKey) {
  const old = await readPreparedWallProjectionManifest(root2, oldKey), reference = old.extensionPrefix;
  if (!reference) return;
  if (!/^[a-f0-9]{64}$/.test(reference.hash) || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > MAX_STATE_BYTES) throw Error("Invalid projection extension prefix metadata");
  const bytes = await boundedRead(join3(root2, oldKey, reference.hash + ".prefix.json"), MAX_STATE_BYTES);
  if (bytes.length !== reference.bytes || hash2(bytes) !== reference.hash) throw Error("Projection extension prefix hash mismatch");
  const prefix = JSON.parse(bytes.toString()), prior = await readWallChunkManifest(sourceRoot, old.sourceKey);
  if (old.sourceToken !== prior.sourceProof?.token || old.active.from !== prior.request.from || old.active.to !== prior.request.to) throw Error("Projection extension canonical identity mismatch");
  if (prefix.version !== 2 || prefix.complete || prefix.prefixInstall || prefix.key !== old.key || preparedWallProjectionKey(prefix.sourceKey, prefix.settings) !== prefix.key || JSON.stringify(prefix.settings) !== JSON.stringify(old.settings) || prefix.core !== WALL_PROJECTION_CORE_SHA256 || prefix.sourceKey !== old.sourceKey || prefix.sourceToken !== old.sourceToken || prefix.nextPage < 1 || prefix.nextPage >= source2.parts.length || prefix.replayKeys?.length !== prefix.nextPage) throw Error("Invalid projection extension prefix identity");
  if (JSON.stringify(settings4) !== JSON.stringify(prefix.settings) || source2.request.market !== prior.request.market || source2.request.profile !== prior.request.profile || source2.request.from !== prior.request.from || source2.request.to <= prior.request.to || source2.watermark < prior.watermark) return;
  if (prefix.active.from !== source2.request.from || prefix.active.to !== prior.request.to || prefix.active.confirmedTo >= prior.request.to) return;
  for (let i = 0; i < prefix.nextPage; i++) {
    const a = prefix.replayKeys[i], b = source2.parts[i]?.projectionReplay;
    if (!b || a.hash !== b.hash || a.maxAt !== b.maxAt || a.maxAt >= prior.request.to) return;
  }
  const active = { ...prefix.active, to: source2.request.to };
  OrderWallsArchiveProjector.restoreCheckpoint(active, settings4, source2.request.from, source2.request.to);
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

// src/wall-cache-retention.ts
var HOUR = 36e5;
var settings2 = { topLevels: 8, minimumNotionalEnabled: false, minimumNotionalUsd: 0, minDurationMs: 0 };
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
async function info(path) {
  try {
    return await lstat(path);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
}
async function directory(path, create = false) {
  if (create) await mkdir4(path, { recursive: true });
  const s = await info(path);
  if (s && (!s.isDirectory() || s.isSymbolicLink())) throw Error("Invalid managed wall directory");
  return Boolean(s);
}
async function json(path, max) {
  const shape = await lstat(path);
  if (!shape.isFile() || shape.isSymbolicLink()) throw Error("Invalid managed wall metadata file");
  const f = await open5(path, "r");
  try {
    if ((await f.stat()).size > max) throw Error("Wall retention metadata capacity");
    return JSON.parse(await f.readFile("utf8"));
  } finally {
    await f.close();
  }
}
async function sync(path) {
  const f = await open5(path, "r");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
var WallCacheRetention = class {
  constructor(root2, jobs, control2, clock = () => performance.now(), wallClock = Date.now) {
    this.root = root2;
    this.jobs = jobs;
    this.control = control2;
    this.clock = clock;
    this.wallClock = wallClock;
    this.started = clock();
  }
  pending = /* @__PURE__ */ new Map();
  scans = /* @__PURE__ */ new Map();
  deferred = /* @__PURE__ */ new Map();
  started;
  nextScan = 0;
  busy = false;
  metrics = { retired: 0, blocked: 0, scanned: 0, lastError: "", lastRetired: "" };
  async open() {
    if (resolve(this.root) !== this.root || this.root === "/" || this.root.startsWith("/state") || this.root.startsWith("/opt/iqterminal") || await realpath(this.root) !== this.root) throw Error("Invalid isolated wall retention root");
    if (this.control.diagnostics().consumers || this.control.diagnostics().pins) throw Error("Wall retention startup requires a fresh control owner");
    if ((await json(join4(this.root, ".wall-preparation-root.json"), 1024)).version !== 1) throw Error("Invalid managed wall root marker");
    if (this.jobs.root !== join4(this.root, "queue") || this.jobs.canonicalRoot !== join4(this.root, "canonical") || this.jobs.projectionRoot !== join4(this.root, "projections")) throw Error("Invalid wall retention namespace");
    for (const name of ["queue", "canonical", "projections", "retiring", "trash"]) await directory(join4(this.root, name), true);
    const d = await opendir(join4(this.root, "retiring"), { bufferSize: 8 });
    try {
      let count = 0;
      for await (const entry of d) {
        if (++count > 128) throw Error("Wall retirement journal capacity");
        if (/^[a-f0-9]{64}\.json\.tmp$/.test(entry.name)) {
          const path = join4(this.root, "retiring", entry.name), s = await lstat(path);
          if (!s.isFile() || s.isSymbolicLink() || s.size > 4096) throw Error("Invalid wall retirement temporary metadata");
          await unlink(path);
          await sync(join4(this.root, "retiring"));
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".json") || !hex(entry.name.slice(0, -5))) throw Error("Invalid wall retirement journal");
        const record = await json(join4(this.root, "retiring", entry.name), 4096);
        this.validate(record);
        if (record.id !== entry.name.slice(0, -5)) throw Error("Invalid wall retirement identity");
        const release = this.control.beginRetirement(record.id, record.sourceKey, record.projectionKey, true);
        if (!release) throw Error("Wall retirement already owned in this process");
        this.pending.set(record.id, { record, release });
      }
    } finally {
      await d.close().catch(() => {
      });
    }
  }
  validate(r) {
    validateWallSourceRequest(r.request);
    if (r.version !== 1 || r.id !== preparedWallLookupKey(r.request) || !hex(r.id) || r.sourceKey !== void 0 && !hex(r.sourceKey) || r.projectionKey !== void 0 && !hex(r.projectionKey) || typeof r.removeJob !== "boolean" || !Number.isSafeInteger(r.at) || r.at < 0) throw Error("Invalid wall retirement record");
  }
  targets(r) {
    return [
      ...r.sourceKey ? [{ path: join4(this.root, "canonical", r.sourceKey), trash: join4(this.root, "trash", r.id + "-canonical") }] : [],
      ...r.projectionKey ? [{ path: join4(this.root, "projections", r.projectionKey), trash: join4(this.root, "trash", r.id + "-projection") }] : [],
      ...r.removeJob ? [{ path: join4(this.root, "canonical", "jobs", r.id), trash: join4(this.root, "trash", r.id + "-job") }] : []
    ];
  }
  /** Never recursively follow arbitrary trees or links. Producer file and part
   * counts are bounded independently; deletion yields at every filesystem call. */
  async files(path, remove = false) {
    if (!await directory(path)) return;
    const d = await opendir(path, { bufferSize: 8 });
    try {
      let count = 0;
      for await (const entry of d) {
        if (++count > 520) throw Error("Wall retirement file count capacity");
        const p = join4(path, entry.name), s = await lstat(p);
        if (entry.name === "running.lock") {
          if (!s.isDirectory() || s.isSymbolicLink()) throw Error("Invalid wall lock directory");
          const owner = await json(join4(p, "owner.json"), 4096);
          if (owner.pid !== process.pid) throw Error("Another owner holds wall retirement files");
          continue;
        }
        if (!s.isFile() || s.isSymbolicLink() || !(/^[a-f0-9]{64}\.json\.gz(?:\.tmp)?$/.test(entry.name) || /^(manifest|progress|job)\.json(?:\.tmp)?$/.test(entry.name) || /^(pages|runs)\.jsonl$/.test(entry.name)) || s.size > 64 * 1024 ** 2) throw Error("Invalid managed wall cache file");
        if (remove) await unlink(p);
      }
    } finally {
      await d.close().catch(() => {
      });
    }
  }
  async remove(path) {
    if (!await directory(path)) return;
    await this.files(path, true);
    const lock2 = join4(path, "running.lock");
    if (await info(lock2)) {
      await unlink(join4(lock2, "owner.json"));
      await rmdir(lock2);
    }
    await rmdir(path);
    await sync(join4(this.root, "trash"));
  }
  async execute(r) {
    const jobDir = join4(this.root, "canonical", "jobs", r.id), trashJob = join4(this.root, "trash", r.id + "-job"), locks = [];
    await directory(join4(this.root, "canonical", "jobs"), true);
    const parkedJob = r.removeJob && await directory(trashJob);
    if (parkedJob && await directory(jobDir)) throw Error("Wall retirement job namespace collision");
    const jobLockParent = parkedJob ? trashJob : jobDir;
    await directory(jobLockParent, true);
    try {
      for (const parent of [jobLockParent, ...r.projectionKey && await directory(join4(this.root, "projections", r.projectionKey)) ? [join4(this.root, "projections", r.projectionKey)] : []]) {
        const lock2 = join4(parent, "running.lock");
        try {
          await mkdir4(lock2);
        } catch (e) {
          if (e.code === "EEXIST") throw Error("Another preparation owner holds retirement candidate");
          throw e;
        }
        locks.push(lock2);
        await atomicWrite(join4(lock2, "owner.json"), JSON.stringify({ pid: process.pid, retirement: r.id }));
      }
      for (const t of this.targets(r)) {
        if (await directory(t.trash) && await directory(t.path)) throw Error("Wall retirement public/trash collision; explicit recovery required");
        if (await directory(t.path)) await this.files(t.path);
      }
      const journal = join4(this.root, "retiring", r.id + ".json");
      if (!await info(journal)) await atomicWrite(journal, JSON.stringify(r));
      const lookup = join4(this.root, "canonical", "lookup", r.id + ".json");
      if (await info(lookup)) {
        const entry = await json(lookup, 8192);
        if (entry.key === r.sourceKey) {
          await unlink(lookup);
          await sync(join4(this.root, "canonical", "lookup"));
        }
      }
      for (const t of this.targets(r)) if (await directory(t.path)) {
        await rename2(t.path, t.trash);
        for (let i = 0; i < locks.length; i++) if (locks[i].startsWith(t.path + "/")) locks[i] = t.trash + locks[i].slice(t.path.length);
        await sync(join4(t.path, ".."));
        await sync(join4(this.root, "trash"));
      }
      await this.jobs.forgetRetired(r.id, r.sourceKey);
    } finally {
      for (const lock2 of locks.reverse()) {
        await unlink(join4(lock2, "owner.json")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        await rmdir(lock2).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
    }
    for (const t of this.targets(r)) await this.remove(t.trash);
    await unlink(join4(this.root, "retiring", r.id + ".json"));
    await sync(join4(this.root, "retiring"));
  }
  candidates(pressure) {
    const jobs = this.jobs.retentionJobs(), keep = /* @__PURE__ */ new Set();
    for (const market of ["spot", "perpetual"]) for (const j of jobs.filter((j2) => j2.defaultOwned && j2.request.market === market && j2.phase === "ready").sort((a, b) => b.request.to - a.request.to || b.at - a.at).slice(0, 2)) keep.add(j.id);
    return jobs.filter((j) => !keep.has(j.id) && (j.phase === "ready" || j.paused || j.failed) && this.wallClock() - j.at >= (pressure && (j.phase === "ready" || j.rollingDefault && !j.defaultOwned) ? 6e4 : HOUR)).sort((a, b) => a.at - b.at).map((j) => ({ version: 1, id: j.id, request: j.request, sourceKey: j.sourceKey, projectionKey: j.projectionKey ?? (j.sourceKey ? preparedWallProjectionKey(j.sourceKey, settings2) : void 0), removeJob: true, at: this.wallClock() }));
  }
  async orphan(pressure) {
    const jobs = this.jobs.retentionJobs(), sourceKeys = /* @__PURE__ */ new Set([...jobs.map((j) => j.sourceKey), ...jobs.map((j) => j.reuseSourceKey), ...jobs.map((j) => j.reuseProjectionSourceKey)]), projectionKeys = /* @__PURE__ */ new Set([...jobs.map((j) => j.projectionKey ?? (j.sourceKey ? preparedWallProjectionKey(j.sourceKey, settings2) : void 0)), ...jobs.map((j) => j.reuseProjectionKey)]);
    for (const kind of ["canonical", "projections"]) {
      const parent = join4(this.root, kind);
      let d = this.scans.get(kind);
      if (!d) {
        d = await opendir(parent, { bufferSize: 8 });
        this.scans.set(kind, d);
      }
      for (let i = 0; i < 8; i++) {
        const entry = await d.read();
        if (!entry) {
          await d.close();
          this.scans.delete(kind);
          break;
        }
        this.metrics.scanned++;
        if (!hex(entry.name) || !entry.isDirectory() || (kind === "canonical" ? sourceKeys : projectionKeys).has(entry.name)) continue;
        const path = join4(parent, entry.name), metadata = await info(join4(path, "manifest.json")) ?? await info(join4(path, "progress.json"));
        if (!metadata || !metadata.isFile() || metadata.isSymbolicLink() || this.wallClock() - metadata.mtimeMs < (pressure ? 6e4 : HOUR)) continue;
        let request, sourceKey, projectionKey;
        if (kind === "canonical") {
          const m = await json(join4(path, await info(join4(path, "manifest.json")) ? "manifest.json" : "progress.json"), 128 * 1024);
          if (m.version !== 5 || !m.sourceProof || verifiedWallViewKey(m.sourceProof) !== entry.name) throw Error("Invalid orphan canonical identity");
          request = m.sourceProof;
          sourceKey = entry.name;
          projectionKey = preparedWallProjectionKey(sourceKey, settings2);
        } else {
          const m = await readPreparedWallProjectionManifest(parent, entry.name);
          sourceKey = m.sourceKey;
          projectionKey = entry.name;
          request = { market: m.profile.market, profile: m.profile.id, from: m.active.from, to: m.active.to };
          if (sourceKeys.has(sourceKey)) continue;
        }
        const id = preparedWallLookupKey(request);
        if ((this.deferred.get(id) ?? 0) > this.clock()) continue;
        const job = jobs.find((j) => j.id === id);
        if (job && job.phase !== "ready" && !job.failed && !job.paused) continue;
        return { version: 1, id, request: { market: request.market, profile: request.profile, from: request.from, to: request.to }, sourceKey, projectionKey, removeJob: !job || job.sourceKey === sourceKey, at: this.wallClock() };
      }
    }
  }
  async tick(pressure = false) {
    if (this.busy) return { state: "busy" };
    if (this.clock() - this.started < 6e4) return { state: "quarantine" };
    this.busy = true;
    try {
      let pending = this.pending.values().next().value;
      if (!pending) {
        if (!pressure && this.clock() < this.nextScan) return { state: "idle" };
        this.nextScan = this.clock() + 3e4;
        let r;
        for (const candidate of this.candidates(pressure)) {
          if ((this.deferred.get(candidate.id) ?? 0) > this.clock()) continue;
          const release = this.control.beginRetirement(candidate.id, candidate.sourceKey, candidate.projectionKey);
          if (release) {
            r = candidate;
            pending = { record: r, release };
            break;
          }
          this.metrics.blocked++;
        }
        if (!pending) {
          r = await this.orphan(pressure);
          if (r) {
            const release = this.control.beginRetirement(r.id, r.sourceKey, r.projectionKey);
            if (release) pending = { record: r, release };
            else this.metrics.blocked++;
          }
        }
        if (!pending) return { state: "idle" };
        this.pending.set(pending.record.id, pending);
      }
      this.validate(pending.record);
      await this.execute(pending.record);
      pending.release();
      this.pending.delete(pending.record.id);
      this.metrics.retired++;
      this.metrics.lastRetired = pending.record.id;
      this.metrics.lastError = "";
      return { state: "retired", id: pending.record.id };
    } catch (e) {
      for (const [id, p] of this.pending) if (!await info(join4(this.root, "retiring", id + ".json"))) {
        p.release();
        this.pending.delete(id);
        if (this.deferred.size >= 128) this.deferred.delete(this.deferred.keys().next().value);
        this.deferred.set(id, this.clock() + 3e4);
      }
      this.metrics.lastError = String(e.message).slice(0, 500);
      return { state: "blocked", reason: this.metrics.lastError };
    } finally {
      this.busy = false;
    }
  }
  diagnostics() {
    return { ...this.metrics, pending: this.pending.size, quarantine: this.clock() - this.started < 6e4 };
  }
  async close() {
    for (const d of this.scans.values()) await d.close().catch(() => {
    });
    this.scans.clear();
  }
};

// src/wall-preparation-log.ts
import { lstat as lstat2, rename as rename3, appendFile } from "node:fs/promises";
async function appendWallPreparationLog(path, record) {
  const text = JSON.stringify(record) + "\n";
  if (Buffer.byteLength(text) > 16384) throw Error("Wall worker log record capacity");
  try {
    const s = await lstat2(path);
    if (!s.isFile() || s.isSymbolicLink()) throw Error("Invalid wall worker log");
    if (s.size + Buffer.byteLength(text) > 8 * 1024 ** 2) {
      try {
        const old = await lstat2(path + ".1");
        if (!old.isFile() || old.isSymbolicLink()) throw Error("Invalid previous wall worker log");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await rename3(path, path + ".1");
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await appendFile(path, text, { mode: 384 });
}

// src/wall-preparation-jobs.ts
import { mkdir as mkdir5, unlink as unlink2, rmdir as rmdir2, open as open6 } from "node:fs/promises";
import { join as join5 } from "node:path";

// src/wall-preparation-source.ts
async function wallPreparationSource(request, saved, source2 = wallSourceVersion, newRevision = false) {
  validateWallSourceRequest(request);
  if (saved) {
    verifiedWallViewKey(saved);
    if (saved.market !== request.market || saved.profile !== request.profile || saved.from !== request.from || saved.to !== request.to) throw Error("Wall preparation checkpoint request identity mismatch");
    if (!newRevision) return saved;
  }
  const fresh = await source2(request);
  if (!fresh.eligible) throw Error("Wall preparation source unavailable: " + (fresh.reason ?? "unconfirmed source"));
  verifiedWallViewKey(fresh);
  if (fresh.market !== request.market || fresh.profile !== request.profile || fresh.from !== request.from || fresh.to !== request.to) throw Error("Wall preparation fresh source request identity mismatch");
  if (saved && saved.token === fresh.token) {
    if (fresh.watermark < saved.watermark) throw Error("Wall source horizon temporarily behind pinned job; retry without resetting");
    return saved;
  }
  return fresh;
}

// src/shared/order-wall-point-transport.ts
var pointOverhead = JSON.stringify({ at: 0, usd: 0, percentile: null, rank: 1, quantity: 0, quantityExact: "0", notionalExact: "0" }).length - JSON.stringify([0, "0", "0", 1]).length - 2;

// src/wall-projection-delivery.ts
import { promisify as promisify5 } from "node:util";
import { gzip as gzipCallback3, gunzip as gunzipCallback3, brotliCompress as brotliCallback, constants } from "node:zlib";

// src/wall-chunk-delivery.ts
import { gunzip as gunzipCallback2 } from "node:zlib";
import { promisify as promisify4 } from "node:util";
var gunzip3 = promisify4(gunzipCallback2);

// src/wall-projection-delivery.ts
var gzip3 = promisify5(gzipCallback3);
var gunzip4 = promisify5(gunzipCallback3);
var brotli = promisify5(brotliCallback);
var WALL_PROJECTION_DELIVERY = { version: 1, maxParts: 32, maxDecodedBytes: 8 * 1024 * 1024, pointTransport: 1, productTransport: 1 };
var defaults = { topLevels: 8, minimumNotionalEnabled: false, minimumNotionalUsd: 0, minDurationMs: 0 };
async function discoverWallProjection(root2, source2, signal, capability) {
  if (capability !== WALL_PROJECTION_CORE_SHA256) return void 0;
  const key = preparedWallProjectionKey(source2.key, defaults);
  let manifest;
  try {
    manifest = await readPreparedWallProjectionManifest(root2, key, signal);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  if (manifest.sourceKey !== source2.key || manifest.sourceToken !== source2.sourceProof?.token || manifest.profile?.id !== source2.request.profile || manifest.profile.market !== source2.request.market || manifest.active.from !== source2.request.from || manifest.active.to !== source2.request.to || manifest.active.cursor !== source2.watermark || manifest.active.epoch !== source2.head.epoch) throw Error("Invalid prepared wall projection source identity");
  return { manifest, delivery: WALL_PROJECTION_DELIVERY };
}

// src/wall-preparation-jobs.ts
var lanes = ["visible", "visible", "visible", "visible", "visible", "visible", "default", "custom"];
var settings3 = { topLevels: 8, minimumNotionalEnabled: false, minimumNotionalUsd: 0, minDurationMs: 0 };
async function readyProjection(root2, canonicalRoot, key) {
  try {
    return (await discoverWallProjection(root2, await readWallChunkManifest(canonicalRoot, key), void 0, WALL_PROJECTION_CORE_SHA256))?.manifest;
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
var rank = (lane) => lane === "visible" ? 0 : lane === "default" ? 1 : 2;
var WallPreparationJobs = class {
  constructor(root2, canonicalRoot, projectionRoot, deps = {}) {
    this.root = root2;
    this.canonicalRoot = canonicalRoot;
    this.projectionRoot = projectionRoot;
    this.deps = { now: Date.now, discover: discoverPreparedWallView, source: wallPreparationSource, canonical: advancePreparedWallView, projection: advancePreparedWallProjection, readyProjection, ...deps };
  }
  jobs = [];
  format = 1;
  turn = 0;
  busy = false;
  retiring = /* @__PURE__ */ new Set();
  saveTail = Promise.resolve();
  deps;
  async open() {
    await mkdir5(this.root, { recursive: true });
    let saved;
    try {
      const file = await open6(join5(this.root, "queue.json"), "r");
      try {
        if ((await file.stat()).size > 1024 * 1024) throw Error("Wall preparation queue metadata capacity");
        saved = await file.readFile("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const state = JSON.parse(saved);
    if (state.core !== WALL_PROJECTION_CORE_SHA256) throw Error("Wall preparation algorithm changed; explicit queue migration required; artifacts retained");
    if (![1, 2].includes(state.version) || !Number.isSafeInteger(state.turn) || state.turn < 0 || !Array.isArray(state.jobs) || state.jobs.length > 128) throw Error("Invalid wall preparation queue");
    const seen = /* @__PURE__ */ new Set();
    for (const job of state.jobs) {
      validateWallSourceRequest(job.request);
      if (job.id !== preparedWallLookupKey(job.request) || seen.has(job.id) || !lanes.includes(job.lane) || !["source", "canonical", "projection", "ready"].includes(job.phase) || ![job.requestedAt, job.lastTurn, job.pages, job.projectionPages, job.parts, job.projectionDecodedBytes, job.projectionCompressedBytes, job.after, job.decodedBytes, job.compressedBytes].every((v) => Number.isSafeInteger(v) && v >= 0) || job.lastTurn > state.turn) throw Error("Invalid wall preparation job");
      if ([job.canonicalManifestReused, job.projectionManifestReused].some((value) => value !== void 0 && typeof value !== "boolean")) throw Error("Invalid wall cache reuse state");
      if ([job.leased, job.paused].some((value) => value !== void 0 && typeof value !== "boolean") || job.paused && !job.leased) throw Error("Invalid wall consumer lease state");
      if (job.updatedAt !== void 0 && (!Number.isSafeInteger(job.updatedAt) || job.updatedAt < 0) || [job.defaultOwned, job.rollingDefault].some((value) => value !== void 0 && typeof value !== "boolean") || job.rollingDefault && !job.leased) throw Error("Invalid wall retention metadata");
      if (job.lastRetryToken !== void 0 && (typeof job.lastRetryToken !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(job.lastRetryToken))) throw Error("Invalid wall retry command token");
      if (job.reuseProjectionKey !== void 0 && (!/^[a-f0-9]{64}$/.test(job.reuseProjectionKey) || !/^[a-f0-9]{64}$/.test(job.reuseProjectionSourceKey ?? "") || !["canonical", "projection"].includes(job.phase))) throw Error("Invalid projection prefix dependency");
      if (job.reuseSourceKey !== void 0 && (!/^[a-f0-9]{64}$/.test(job.reuseSourceKey) || job.phase !== "canonical")) throw Error("Invalid canonical overlap dependency");
      if (job.proof && (verifiedWallViewKey(job.proof) !== job.sourceKey || preparedWallLookupKey(job.proof) !== job.id)) throw Error("Wall preparation job proof identity mismatch");
      if (job.projectionKey && job.projectionKey !== preparedWallProjectionKey(job.sourceKey, settings3)) throw Error("Wall preparation projection identity mismatch");
      if (job.phase === "ready" && (!job.projectionKey || !Number.isSafeInteger(job.doneAt) || job.doneAt < 0)) throw Error("Invalid completed wall preparation");
      if (job.phase !== "source" && !job.proof) throw Error("Missing wall preparation source proof");
      seen.add(job.id);
    }
    for (const job of state.jobs) if (job.leased && job.phase !== "ready") job.paused = true;
    if (state.jobs.filter((job) => job.phase !== "ready" && !job.paused).length > 32) throw Error("Wall preparation pending capacity");
    this.format = state.version;
    this.turn = state.turn;
    this.jobs = state.jobs;
    if (state.version === 1 && this.jobs.some((job) => job.reuseProjectionKey)) await this.save();
  }
  save() {
    if (this.jobs.some((job) => job.reuseProjectionKey)) this.format = 2;
    const snapshot = JSON.stringify({ version: this.format, core: WALL_PROJECTION_CORE_SHA256, turn: this.turn, jobs: this.jobs });
    if (Buffer.byteLength(snapshot) > 1024 * 1024) throw Error("Wall preparation queue metadata capacity");
    const next = this.saveTail.then(() => atomicWrite(join5(this.root, "queue.json"), snapshot));
    this.saveTail = next.catch(() => {
    });
    return next;
  }
  async enqueue(request, lane = "visible", retry = false, newRevision = false, retryToken, leased = false, rollingDefault = false) {
    validateWallSourceRequest(request);
    if (retryToken !== void 0 && (!retry || typeof retryToken !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(retryToken))) throw Error("Invalid wall retry command token");
    if (!lanes.includes(lane) || newRevision && !retry || rollingDefault && (!leased || lane !== "default")) throw Error("Invalid wall preparation admission");
    const id = preparedWallLookupKey(request);
    if (this.retiring.has(id)) throw Error("Wall cache retirement in progress; retry");
    const old = this.jobs.find((job2) => job2.id === id);
    if (old) {
      if (retryToken !== void 0 && retryToken === old.lastRetryToken) {
        retry = false;
        newRevision = false;
      }
      if ((retry && old.phase === "ready" || old.paused && old.phase !== "ready") && this.jobs.filter((job2) => job2.phase !== "ready" && !job2.paused).length >= 32) throw Error("Wall preparation queue capacity; ready cache and pending work retained");
      if (newRevision && !old.failed && old.phase !== "ready") throw Error("Healthy wall preparation is not reset by revision admission");
      let changed = false;
      if (lane === "default" && !old.defaultOwned) {
        old.defaultOwned = true;
        changed = true;
      }
      if (rank(lane) < rank(old.lane)) {
        old.lane = lane;
        changed = true;
      }
      if (rollingDefault && old.leased && !old.rollingDefault) {
        old.rollingDefault = true;
        changed = true;
      }
      if (retry && retryToken !== void 0) {
        old.lastRetryToken = retryToken;
        changed = true;
      }
      if (retry && (old.failed || old.phase === "ready")) {
        changed = true;
        if (old.phase === "ready") {
          old.phase = "canonical";
          old.projectionPages = 0;
          delete old.canonicalManifestReused;
          delete old.projectionManifestReused;
          delete old.doneAt;
        }
        if (newRevision) {
          delete old.reuseSourceKey;
          delete old.reuseProjectionKey;
          delete old.reuseProjectionSourceKey;
          delete old.projectionPrefixCopied;
          delete old.projectionPrefixParts;
          old.phase = "source";
          delete old.proof;
          delete old.sourceKey;
          delete old.projectionKey;
          old.pages = 0;
          old.projectionPages = 0;
          old.parts = 0;
          old.projectionDecodedBytes = 0;
          old.projectionCompressedBytes = 0;
          old.after = 0;
          old.decodedBytes = 0;
          old.compressedBytes = 0;
          delete old.coverage;
          delete old.canonicalManifestReused;
          delete old.projectionManifestReused;
        }
        old.failed = false;
        delete old.error;
        delete old.category;
        delete old.retryable;
      }
      if (old.paused) {
        old.paused = false;
        changed = true;
      }
      if (!leased && old.leased) {
        delete old.leased;
        delete old.paused;
        delete old.rollingDefault;
        changed = true;
      }
      if (changed) {
        old.updatedAt = this.deps.now();
        await this.save();
      }
      return this.status(old);
    }
    if (this.jobs.length >= 128 || this.jobs.filter((job2) => job2.phase !== "ready" && !job2.paused).length >= 32) throw Error("Wall preparation queue capacity; completed artifacts and pending work retained");
    const job = {
      id,
      request: { market: request.market, profile: request.profile, from: request.from, to: request.to },
      lane,
      requestedAt: this.deps.now(),
      updatedAt: this.deps.now(),
      ...lane === "default" ? { defaultOwned: true } : {},
      ...rollingDefault ? { rollingDefault: true } : {},
      lastTurn: 0,
      phase: "source",
      pages: 0,
      projectionPages: 0,
      parts: 0,
      projectionDecodedBytes: 0,
      projectionCompressedBytes: 0,
      after: 0,
      decodedBytes: 0,
      compressedBytes: 0,
      ...retryToken ? { lastRetryToken: retryToken } : {},
      ...leased ? { leased: true, paused: false } : {}
    };
    this.jobs.push(job);
    await this.save();
    return this.status(job);
  }
  async pauseUnusedVisible(active) {
    let changed = false;
    for (const job of this.jobs) if (job.leased && job.phase !== "ready") {
      if (!active.has(job.id) && !(job.rollingDefault && job.defaultOwned) && !job.paused) {
        job.paused = true;
        job.updatedAt = this.deps.now();
        changed = true;
      }
    }
    if (changed) await this.save();
  }
  /** Release only automatic owners. Keep a ready fallback and one oldest cold
   * build per profile so a build slower than bar cadence can still finish. */
  async retainRollingDefaults(requests) {
    if (requests.length > 2) throw Error("Rolling wall default configuration capacity");
    for (const request of requests) validateWallSourceRequest(request);
    const keep = new Set(requests.map(preparedWallLookupKey));
    for (const request of requests) {
      const ready = this.jobs.filter((job) => job.rollingDefault && job.phase === "ready" && !job.failed && job.request.market === request.market && job.request.profile === request.profile && job.request.to <= request.to).sort((a, b) => b.request.to - a.request.to || b.doneAt - a.doneAt)[0];
      if (ready) keep.add(ready.id);
      const building = this.jobs.filter((job) => job.rollingDefault && job.defaultOwned && job.phase !== "ready" && !job.failed && job.request.market === request.market && job.request.profile === request.profile).sort((a, b) => a.requestedAt - b.requestedAt || a.request.to - b.request.to)[0];
      if (building) keep.add(building.id);
    }
    let changed = false;
    for (const job of this.jobs) if (job.rollingDefault && job.defaultOwned !== keep.has(job.id)) {
      job.defaultOwned = keep.has(job.id);
      changed = true;
    }
    if (changed) await this.save();
  }
  async tick() {
    if (this.busy) return null;
    const pending = this.jobs.filter((job2) => !job2.failed && !job2.paused && job2.phase !== "ready" && !this.retiring.has(job2.id));
    if (!pending.length) return null;
    const wanted = lanes[this.turn % lanes.length], preferred = pending.filter((job2) => job2.lane === wanted);
    const job = (preferred.length ? preferred : pending).sort((a, b) => a.lastTurn - b.lastTurn || a.requestedAt - b.requestedAt || a.id.localeCompare(b.id))[0];
    this.busy = true;
    job.lastTurn = ++this.turn;
    job.updatedAt = this.deps.now();
    let lock2, ownedLock = false;
    try {
      lock2 = job.phase === "projection" ? join5(this.projectionRoot, job.projectionKey ?? preparedWallProjectionKey(job.sourceKey, settings3), "running.lock") : join5(this.canonicalRoot, "jobs", job.id, "running.lock");
      await mkdir5(join5(lock2, ".."), { recursive: true });
      try {
        await mkdir5(lock2);
        ownedLock = true;
      } catch (error) {
        if (error.code === "EEXIST") {
          lock2 = void 0;
          job.waitReason = "Another preparation owner holds this request; progress retained";
          return this.status(job);
        }
        throw error;
      }
      await atomicWrite(join5(lock2, "owner.json"), JSON.stringify({ pid: process.pid, job: job.id, startedAt: this.deps.now() }));
      delete job.waitReason;
      if (job.phase === "source") {
        const found = await this.deps.discover(this.canonicalRoot, job.request);
        if (found.state === "ineligible") throw Error("Wall preparation source unavailable: " + (found.source.reason ?? "unconfirmed source"));
        if (found.state === "ready") {
          job.proof = found.manifest.sourceProof;
          job.sourceKey = verifiedWallViewKey(job.proof);
          if (job.sourceKey !== found.manifest.key || preparedWallLookupKey(job.proof) !== job.id) throw Error("Invalid prepared source reuse identity");
          this.canonicalProgress(job, found.manifest);
          job.canonicalManifestReused = true;
          job.phase = "projection";
          await this.selectOverlap(job, true);
        } else {
          job.canonicalManifestReused = false;
          job.proof = await this.deps.source(job.request, found.source);
          job.sourceKey = verifiedWallViewKey(job.proof);
          job.phase = "canonical";
          await this.selectOverlap(job);
        }
      } else if (job.phase === "canonical") {
        let complete;
        if (job.pages > 0 && job.after === job.proof.watermark) {
          try {
            complete = await readWallChunkManifest(this.canonicalRoot, job.sourceKey);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (complete) {
          const fresh = await this.deps.source(job.request, job.proof, void 0, true);
          if (fresh.token !== job.proof.token) throw Error("Prepared wall source changed; request a new revision");
          if (complete.version !== 5 || complete.sourceProof?.token !== job.proof.token) throw Error("Invalid prepared canonical reuse identity");
          job.canonicalManifestReused = true;
        } else job.canonicalManifestReused = false;
        const state = complete ?? await this.deps.canonical(this.canonicalRoot, job.proof, job.reuseSourceKey ? { reuse: { sourceKey: job.reuseSourceKey, validatedForToken: job.proof.token } } : void 0);
        this.canonicalProgress(job, state);
        if (state.complete) {
          job.phase = "projection";
          delete job.reuseSourceKey;
        }
      } else {
        const cached = job.projectionPages === 0 ? await this.deps.readyProjection(this.projectionRoot, this.canonicalRoot, job.sourceKey) : void 0;
        if (cached) {
          const fresh = await this.deps.source(job.request, job.proof, void 0, true);
          if (fresh.token !== job.proof.token) throw Error("Prepared wall source changed; request a new revision");
          if (cached.sourceKey !== job.sourceKey || cached.sourceToken !== job.proof.token) throw Error("Invalid prepared projection reuse identity");
          delete job.reuseProjectionKey;
          delete job.reuseProjectionSourceKey;
          job.projectionManifestReused = true;
          job.projectionKey = cached.key;
          job.projectionPages = job.pages;
          job.parts = cached.parts.length;
          job.projectionDecodedBytes = cached.parts.reduce((n, p) => n + p.bytes, 0);
          job.projectionCompressedBytes = cached.parts.reduce((n, p) => n + p.compressedBytes, 0);
          job.phase = "ready";
          job.doneAt = this.deps.now();
        } else {
          job.projectionManifestReused = false;
          const state = await this.deps.projection(this.projectionRoot, this.canonicalRoot, job.sourceKey, settings3, job.reuseProjectionKey ? { reuseProjectionKey: job.reuseProjectionKey } : void 0);
          if (state.prefixInstall) {
            job.projectionPrefixCopied = state.prefixInstall.nextPart;
            job.projectionPrefixParts = state.parts.length;
          } else {
            delete job.reuseProjectionKey;
            delete job.reuseProjectionSourceKey;
            delete job.projectionPrefixCopied;
            delete job.projectionPrefixParts;
          }
          job.projectionKey = state.key;
          job.projectionPages = state.nextPage;
          job.parts = state.parts.length;
          job.projectionDecodedBytes = state.parts.reduce((n, p) => n + p.bytes, 0);
          job.projectionCompressedBytes = state.parts.reduce((n, p) => n + p.compressedBytes, 0);
          if (state.complete) {
            job.phase = "ready";
            job.doneAt = this.deps.now();
          }
        }
      }
      if (job.phase === "ready" && job.leased) job.paused = false;
      delete job.error;
      delete job.category;
      delete job.retryable;
    } catch (error) {
      const message = String(error?.message ?? error);
      job.failed = true;
      job.error = message.slice(0, 500);
      job.category = /source changed|new revision/i.test(message) ? "source-changed" : /source unavailable|behind pinned|no retained|predates/i.test(message) ? "source-unavailable" : /capacity|budget|ENOSPC|MEMORY_LIMIT|TOO_MANY_ROWS|Limit for.*read|Memory limit/i.test(message) ? "capacity" : /Invalid|identity|hash mismatch|configuration/i.test(message) ? "invalid-content" : "query";
      job.retryable = job.category === "query" || job.category === "source-unavailable";
    } finally {
      try {
        if (ownedLock && lock2) {
          await unlink2(join5(lock2, "owner.json")).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          await rmdir2(lock2);
        }
        await this.save();
      } finally {
        this.busy = false;
      }
    }
    return this.status(job);
  }
  /** Fresh canonical validation is mandatory before old event pages can supply
   * overlap. Pin its dependency before awaiting, so retention cannot race it. */
  async selectOverlap(job, projectionOnly = false) {
    const proof = job.proof, candidate = this.jobs.filter((old) => old !== job && old.phase === "ready" && !old.failed && !this.retiring.has(old.id) && old.sourceKey && old.proof && old.request.market === job.request.market && old.request.profile === job.request.profile && old.request.from <= job.request.from && old.request.to <= job.request.to && old.request.to > job.request.from && old.proof.watermark <= proof.watermark && (!projectionOnly || old.request.from === job.request.from && !!old.projectionKey)).sort((a, b) => b.request.to - a.request.to || b.doneAt - a.doneAt)[0];
    if (!candidate) return;
    if (!projectionOnly) job.reuseSourceKey = candidate.sourceKey;
    if (candidate.request.from === job.request.from && candidate.projectionKey) {
      job.reuseProjectionKey = candidate.projectionKey;
      job.reuseProjectionSourceKey = candidate.sourceKey;
    }
    try {
      const fresh = await this.deps.source(candidate.request, candidate.proof, void 0, true);
      if (fresh.token !== candidate.proof.token) {
        delete job.reuseSourceKey;
        delete job.reuseProjectionKey;
        delete job.reuseProjectionSourceKey;
      }
    } catch (error) {
      delete job.reuseSourceKey;
      delete job.reuseProjectionKey;
      delete job.reuseProjectionSourceKey;
      job.waitReason = "Overlap validation unavailable; using canonical source pages";
    }
  }
  reuseDependencies() {
    return new Set(this.jobs.flatMap((job) => [...job.phase === "canonical" && job.reuseSourceKey ? [job.reuseSourceKey] : [], ...job.reuseProjectionSourceKey ? [job.reuseProjectionSourceKey] : []]));
  }
  reuseProjectionDependencies() {
    return new Set(this.jobs.filter((job) => job.reuseProjectionKey).map((job) => job.reuseProjectionKey));
  }
  canonicalProgress(job, state) {
    job.pages = state.parts.length;
    job.after = state.after;
    job.decodedBytes = state.parts.reduce((n, p) => n + p.bytes, 0);
    job.compressedBytes = state.parts.reduce((n, p) => n + p.compressedBytes, 0);
    if (state.coverage) job.coverage = {
      status: state.coverage.status,
      partial: Boolean(state.coverage.partial),
      availableFrom: state.coverage.availableFrom ?? null,
      confirmedTo: state.coverage.confirmedTo ?? null,
      gapCount: state.coverage.gaps?.length ?? 0,
      gapsTruncated: Boolean(state.coverage.gapsTruncated),
      ...state.coverage.reason ? { reason: String(state.coverage.reason).slice(0, 500) } : {}
    };
  }
  status(job) {
    const { proof, ...data } = job;
    return { ...data, request: { ...data.request }, ...proof ? { watermark: proof.watermark, sourceToken: proof.token } : {}, state: job.failed ? "failed" : job.phase === "ready" ? "ready" : job.paused ? "paused" : "building" };
  }
  blockRetirement(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid retirement job");
    this.retiring.add(id);
  }
  unblockRetirement(id) {
    this.retiring.delete(id);
  }
  async forgetRetired(id, sourceKey) {
    if (this.busy || !this.retiring.has(id)) throw Error("Wall retirement must own an idle coordinator job");
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.sourceKey !== sourceKey) return;
    if (job.phase !== "ready" && !job.failed && !job.paused) throw Error("Active wall preparation cannot be retired");
    this.jobs = this.jobs.filter((j) => j !== job);
    await this.save();
  }
  retentionJobs() {
    return this.jobs.map((j) => ({ id: j.id, sourceKey: j.sourceKey, projectionKey: j.projectionKey, request: { ...j.request }, phase: j.phase, failed: j.failed, paused: j.paused, reuseSourceKey: j.reuseSourceKey, reuseProjectionSourceKey: j.reuseProjectionSourceKey, reuseProjectionKey: j.reuseProjectionKey, rollingDefault: j.rollingDefault, defaultOwned: j.defaultOwned ?? j.lane === "default", at: j.phase === "ready" ? j.doneAt ?? j.updatedAt ?? j.requestedAt : j.updatedAt ?? j.requestedAt }));
  }
  healthSummary() {
    const counts = { building: 0, ready: 0, failed: 0, paused: 0 };
    for (const job of this.jobs) counts[job.failed ? "failed" : job.phase === "ready" ? "ready" : job.paused ? "paused" : "building"]++;
    return { version: 1, turn: this.turn, busy: this.busy, counts, limits: { pending: 32, tracked: 128, metadataBytes: 1024 * 1024 } };
  }
  health() {
    return { version: 1, turn: this.turn, busy: this.busy, limits: { pending: 32, tracked: 128, metadataBytes: 1024 * 1024 }, jobs: this.jobs.map((job) => this.status(job)) };
  }
};

// src/wall-rolling-defaults.ts
var WALL_ROLLING_DEFAULTS = [{ market: "spot", interval: "5m", step: 3e5 }, { market: "perpetual", interval: "15m", step: 9e5 }];
var readHead = async (profile) => {
  const rows = await query(`SELECT cursor,at,availableFrom FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${profile}' LIMIT 1 SETTINGS max_threads=1,max_result_bytes=4096,max_memory_usage=33554432,max_execution_time=2`);
  if (!rows.length) return;
  const row = rows[0];
  return { cursor: Number(row.cursor), at: Number(row.at), availableFrom: row.availableFrom == null ? null : Number(row.availableFrom) };
};
var WallRollingDefaults = class {
  constructor(queue2, deps = {}) {
    this.queue = queue2;
    this.deps = { head: readHead, now: Date.now, clock: () => performance.now(), expire: async () => {
    }, ...deps };
  }
  nextPoll = 0;
  busy = false;
  status = [];
  error;
  deps;
  async tick() {
    if (this.busy || this.deps.clock() < this.nextPoll) return;
    this.busy = true;
    this.nextPoll = this.deps.clock() + 15e3;
    try {
      const now = this.deps.now(), plans = [], status = [];
      for (const config2 of WALL_ROLLING_DEFAULTS) {
        const profile = archiveProfile(config2.market).id, entry = { ...config2, profile, requestedClosedTo: Math.floor(now / config2.step) * config2.step, topLevels: 8, bandPercent: 10, aggregation: "native" };
        status.push(entry);
        try {
          const head = await this.deps.head(profile);
          if (!head || ![head.cursor, head.at].every((v) => Number.isSafeInteger(v) && v > 0) || head.availableFrom !== null && (!Number.isSafeInteger(head.availableFrom) || head.availableFrom < 0)) throw Error("Canonical wall source progress unavailable");
          const to = Math.floor(Math.min(now, head.at) / config2.step) * config2.step, from = to - 30 * 36e5 - 2 * config2.step;
          entry.sourceHead = head;
          entry.eligibleClosedTo = to;
          entry.behindSlots = (entry.requestedClosedTo - to) / config2.step;
          entry.request = { market: config2.market, profile, from, to };
          if (from <= 0 || head.availableFrom === null || from < head.availableFrom) throw Error("Full default wall source window is not retained; range was not shortened");
          entry.state = "pending";
          plans.push({ request: entry.request, status: entry });
        } catch (error) {
          entry.state = "unavailable";
          entry.reason = String(error.message).slice(0, 500);
          entry.category = "source-unavailable";
          entry.retryable = !/not retained/.test(entry.reason);
        }
      }
      await this.queue.retainRollingDefaults(plans.map((plan) => plan.request));
      await this.deps.expire();
      for (const job of this.queue.health().jobs) if (job.rollingDefault && job.defaultOwned && job.paused && !job.failed && job.phase !== "ready") await this.queue.enqueue(job.request, "default", false, false, void 0, true, true);
      for (const plan of plans) {
        try {
          const old = this.queue.health().jobs.find((job2) => job2.id === preparedWallLookupKey(plan.request));
          const retry = Boolean(old?.rollingDefault && old.failed && (old.retryable || old.category === "source-changed") && now - (old.updatedAt ?? old.requestedAt) >= 6e4);
          const job = await this.queue.enqueue(plan.request, "default", retry, retry && old?.category === "source-changed", retry ? "rolling-default:" + Math.floor(now / 6e4) : void 0, true, true);
          plan.status.state = job.state;
          plan.status.job = job.id;
          plan.status.phase = job.phase;
          plan.status.category = job.category;
          plan.status.reason = job.error;
          plan.status.coverage = job.coverage;
          plan.status.pages = job.pages;
          plan.status.projectionPages = job.projectionPages;
        } catch (error) {
          plan.status.state = "unavailable";
          plan.status.reason = String(error.message).slice(0, 500);
          plan.status.category = /capacity|budget/.test(plan.status.reason) ? "capacity" : "query";
          plan.status.retryable = true;
        }
      }
      this.status = status;
      this.error = void 0;
    } catch (error) {
      this.error = String(error.message ?? error).slice(0, 500);
    } finally {
      this.busy = false;
    }
  }
  diagnostics() {
    return { enabled: true, pollMs: 15e3, retryMs: 6e4, error: this.error, configurations: this.status.map((value) => ({ ...value })), scope: "Closed default source-window preparation; overlapping-window composition and live-tail bridging remain independent requirements" };
  }
};

// src/wall-preparation-control.ts
import http from "node:http";
var WALL_PREPARATION_PORT = 18791;
var keyValid = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var consumerId = (value) => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(value);
var WallPreparationControl = class {
  constructor(jobs, now = () => performance.now(), verifyReader = async (input2) => {
    await readWallChunkManifest(jobs.canonicalRoot, input2.canonicalKey);
    if (input2.projectionKey) {
      const selected = await readPreparedWallProjectionManifest(jobs.projectionRoot, input2.projectionKey);
      if (selected.sourceKey !== input2.canonicalKey) throw Error("Invalid wall reader source identity");
    }
  }) {
    this.jobs = jobs;
    this.now = now;
    this.verifyReader = verifyReader;
  }
  capacityPause;
  /** Transient worker admission pressure is not a failed financial-data job. */
  setCapacityPause(reason) {
    this.capacityPause = reason?.slice(0, 300) || void 0;
  }
  leases = /* @__PURE__ */ new Map();
  retiringIds = /* @__PURE__ */ new Set();
  retiringCanonical = /* @__PURE__ */ new Set();
  retiringProjections = /* @__PURE__ */ new Set();
  cancelledPins = /* @__PURE__ */ new Map();
  pinBlockUntil = 0;
  pins = /* @__PURE__ */ new Map();
  readers = /* @__PURE__ */ new Map();
  consumerCount() {
    return (/* @__PURE__ */ new Set([...this.leases.keys(), ...this.readers.keys()])).size;
  }
  async expire() {
    for (const [id, pin] of this.pins) if (pin.until <= this.now()) this.pins.delete(id);
    for (const [id, until] of this.cancelledPins) if (until <= this.now()) this.cancelledPins.delete(id);
    for (const [consumer, lease] of this.readers) if (lease.until <= this.now()) this.readers.delete(consumer);
    for (const [consumer, lease] of this.leases) if (lease.until <= this.now()) this.leases.delete(consumer);
    await this.jobs.pauseUnusedVisible(new Set([...this.leases.values()].map((lease) => lease.id)));
  }
  async admit(input2) {
    if (!input2 || Object.keys(input2).some((key) => !["request", "consumer", "retry", "newRevision", "retryToken"].includes(key)) || !consumerId(input2.consumer)) throw Error("Invalid wall preparation admission");
    if (!input2.request || typeof input2.request !== "object" || Array.isArray(input2.request) || Object.keys(input2.request).some((key) => !["market", "profile", "from", "to"].includes(key))) throw Error("Invalid wall preparation source request");
    validateWallSourceRequest(input2.request);
    if (input2.retry !== void 0 && typeof input2.retry !== "boolean" || input2.newRevision !== void 0 && typeof input2.newRevision !== "boolean") throw Error("Invalid wall Retry command");
    await this.expire();
    const previous = this.leases.get(input2.consumer);
    if (!previous && !this.readers.has(input2.consumer) && this.consumerCount() >= 128) throw Error("Wall preparation consumer capacity");
    const lease = { id: preparedWallLookupKey(input2.request), until: this.now() + 15e3 };
    this.leases.set(input2.consumer, lease);
    try {
      const job = await this.jobs.enqueue(input2.request, "visible", input2.retry === true, input2.newRevision === true, input2.retryToken, true);
      await this.expire();
      return { version: 1, leaseMs: 15e3, pollMs: 1e3, job: this.capacityPause && job.state !== "ready" && job.state !== "failed" ? { ...job, state: "paused", category: "capacity", error: this.capacityPause, retryable: true } : job };
    } catch (error) {
      if (this.leases.get(input2.consumer) === lease) {
        if (previous) this.leases.set(input2.consumer, previous);
        else this.leases.delete(input2.consumer);
      }
      throw error;
    }
  }
  /** Reserve before awaiting manifest reads so future eviction also protects
   * metadata validation in flight. Renewals never query or rebuild source. */
  async retain(input2) {
    if (!input2 || Object.keys(input2).some((k) => !["consumer", "canonicalKey", "projectionKey"].includes(k)) || !consumerId(input2.consumer) || !keyValid(input2.canonicalKey) || input2.projectionKey !== void 0 && !keyValid(input2.projectionKey)) throw Error("Invalid wall reader lease");
    await this.expire();
    const previous = this.readers.get(input2.consumer);
    if (previous && (previous.canonicalKey !== input2.canonicalKey || previous.projectionKey !== input2.projectionKey)) throw Error("Invalid wall reader lease identity change");
    if (!previous && !this.leases.has(input2.consumer) && this.consumerCount() >= 128) throw Error("Wall preparation consumer capacity");
    if (this.retiringCanonical.has(input2.canonicalKey) || input2.projectionKey && this.retiringProjections.has(input2.projectionKey)) throw Error("Wall cache retirement in progress; retry");
    const lease = { canonicalKey: input2.canonicalKey, ...input2.projectionKey ? { projectionKey: input2.projectionKey } : {}, until: this.now() + 15e3, validated: previous?.validated === true };
    this.readers.set(input2.consumer, lease);
    try {
      if (!lease.validated) await this.verifyReader(input2);
      if (this.readers.get(input2.consumer) !== lease || lease.until <= this.now()) throw Error("Wall reader lease expired or released during validation");
      lease.validated = true;
      return { version: 1, leaseMs: 15e3, canonicalKey: lease.canonicalKey, ...lease.projectionKey ? { projectionKey: lease.projectionKey } : {} };
    } catch (error) {
      if (this.readers.get(input2.consumer) === lease) this.readers.delete(input2.consumer);
      throw error;
    }
  }
  protectedArtifacts() {
    const canonical = this.jobs.reuseDependencies(), projections = this.jobs.reuseProjectionDependencies();
    for (const lease of this.readers.values()) if (lease.until > this.now()) {
      canonical.add(lease.canonicalKey);
      if (lease.projectionKey) projections.add(lease.projectionKey);
    }
    for (const pin of this.pins.values()) if (pin.until > this.now()) (pin.kind === "canonical" ? canonical : projections).add(pin.key);
    return { canonical, projections };
  }
  pin(input2) {
    for (const [id, pin] of this.pins) if (pin.until <= this.now()) this.pins.delete(id);
    for (const [id, until] of this.cancelledPins) if (until <= this.now()) this.cancelledPins.delete(id);
    if (!input2 || Object.keys(input2).some((k) => !["id", "consumer", "key", "kind"].includes(k)) || !consumerId(input2.id) || !consumerId(input2.consumer) || !keyValid(input2.key) || !["canonical", "projection"].includes(input2.kind)) throw Error("Invalid wall read pin");
    if ((input2.kind === "canonical" ? this.retiringCanonical : this.retiringProjections).has(input2.key)) throw Error("Wall cache retirement in progress; retry");
    if (![...this.readers.values()].some((r) => r.validated && r.until > this.now() && (input2.kind === "canonical" ? r.canonicalKey : r.projectionKey) === input2.key)) throw Error("Wall reader lease missing or expired; retry");
    if (this.pinBlockUntil > this.now() || this.cancelledPins.has(input2.id)) throw Error("Wall read cancelled before pin acknowledgement");
    const old = this.pins.get(input2.id);
    if (old && (old.key !== input2.key || old.kind !== input2.kind)) throw Error("Invalid wall read pin identity");
    if (!old && this.pins.size >= 4) throw Error("Wall read pin capacity");
    this.pins.set(input2.id, { key: input2.key, kind: input2.kind, until: this.now() + 6e4 });
    return { version: 1, pinned: true };
  }
  unpin(id, cancelled = false) {
    if (!consumerId(id) || typeof cancelled !== "boolean") throw Error("Invalid wall read pin");
    this.pins.delete(id);
    if (cancelled) {
      if (this.cancelledPins.size < 128) this.cancelledPins.set(id, this.now() + 5e3);
      else this.pinBlockUntil = this.now() + 5e3;
    }
    return { version: 1, released: true };
  }
  beginRetirement(id, canonicalKey, projectionKey, restore = false) {
    if (!keyValid(id) || canonicalKey !== void 0 && !keyValid(canonicalKey) || projectionKey !== void 0 && !keyValid(projectionKey)) throw Error("Invalid wall retirement identity");
    if (this.retiringIds.has(id)) return;
    const protectedKeys = this.protectedArtifacts();
    if (!restore && (canonicalKey && protectedKeys.canonical.has(canonicalKey) || projectionKey && protectedKeys.projections.has(projectionKey) || [...this.leases.values()].some((l) => l.id === id && l.until > this.now()))) return;
    this.retiringIds.add(id);
    this.jobs.blockRetirement(id);
    if (canonicalKey) this.retiringCanonical.add(canonicalKey);
    if (projectionKey) this.retiringProjections.add(projectionKey);
    return () => {
      this.retiringIds.delete(id);
      this.jobs.unblockRetirement(id);
      if (canonicalKey) this.retiringCanonical.delete(canonicalKey);
      if (projectionKey) this.retiringProjections.delete(projectionKey);
    };
  }
  async release(consumer) {
    if (!consumerId(consumer)) throw Error("Invalid wall preparation consumer");
    this.leases.delete(consumer);
    this.readers.delete(consumer);
    await this.expire();
    return { version: 1, released: true };
  }
  health() {
    return { ...this.jobs.healthSummary(), capacityPaused: !!this.capacityPause, ...this.capacityPause ? { reason: this.capacityPause } : {}, ...this.diagnostics(), build: process.env.IQ_BUILD_COMMIT ?? "unknown" };
  }
  diagnostics() {
    return { consumers: this.consumerCount(), readers: this.readers.size, pins: this.pins.size, cancelledPins: this.cancelledPins.size, consumerLimit: 128, leaseMs: 15e3 };
  }
};
async function serveWallPreparationControl(control2, port = WALL_PREPARATION_PORT) {
  let active = 0, ordinary = 0;
  const server = http.createServer(async (req, res) => {
    const reserved = req.url === "/unpin" || req.url === "/release" || req.url === "/health" || req.url === "/retain";
    if (active >= 4 || !reserved && ordinary >= 3) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end('{"error":"Wall preparation control capacity"}');
      return;
    }
    active++;
    if (!reserved) ordinary++;
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(control2.health()));
        return;
      }
      if (req.method !== "POST" || !["/admit", "/release", "/retain", "/pin", "/unpin"].includes(req.url ?? "")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) throw Error("Invalid wall preparation command size");
        chunks.push(chunk);
      }
      const input2 = JSON.parse(Buffer.concat(chunks).toString());
      const body = req.url === "/admit" ? await control2.admit(input2) : req.url === "/retain" ? await control2.retain(input2) : req.url === "/pin" ? control2.pin(input2) : req.url === "/unpin" ? control2.unpin(input2.id, input2.cancelled) : await control2.release(input2.consumer);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(/Invalid|JSON/i.test(error.message) ? 400 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: String(error.message).slice(0, 500) }));
    } finally {
      active--;
      if (!reserved) ordinary--;
    }
  });
  server.requestTimeout = 2e3;
  server.headersTimeout = 2e3;
  server.maxConnections = 8;
  server.keepAliveTimeout = 1e3;
  server.setTimeout(2e3, (socket) => socket.destroy());
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve3);
  });
  return server;
}

// ops/run-wall-preparations.mjs
if (process.env.IQ_WALL_PREPARATION_COORDINATOR !== "1") throw Error("Explicit isolated wall coordinator opt-in required");
var sql2 = new URL(process.env.CH_URL ?? "http://invalid");
assert.ok(sql2.protocol === "http:" && ["127.0.0.1", "localhost"].includes(sql2.hostname) && sql2.port === "18790", "Use the existing private SQL admission proxy");
assert.ok(getHeapStatistics().heap_size_limit <= 320 * 1024 ** 2, "Run the isolated coordinator with --max-old-space-size=256");
process.env.CH_PASSWORD ??= process.env.CH_APP_PASSWORD;
var [rootText, inputText] = process.argv.slice(2);
assert.ok(rootText && inputText, "isolated-root requests-json required");
var root = resolve2(rootText);
var input = resolve2(inputText);
var follow = process.env.IQ_WALL_QUEUE_FOLLOW === "1";
var steps = Number(process.env.IQ_WALL_QUEUE_STEPS ?? 8);
assert.ok(!root.startsWith("/opt/iqterminal") && !root.startsWith("/state") && Number.isSafeInteger(steps) && steps >= 1 && steps <= 8, "Isolated root and 1..8 step budget required");
await mkdir6(root, { recursive: true });
root = await realpath2(root);
assert.ok(!root.startsWith("/opt/iqterminal") && !root.startsWith("/state"), "Derived work must stay in the isolated root");
for (const child of ["queue", "canonical", "projections"]) {
  try {
    const info2 = await lstat3(join6(root, child));
    assert.ok(info2.isDirectory() && !info2.isSymbolicLink(), "Managed derived directories cannot be symlinks");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
var marker = join6(root, ".wall-preparation-root.json");
try {
  const value = JSON.parse(await readFile4(marker, "utf8"));
  assert.equal(value.version, 1);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  assert.equal((await readdir(root)).length, 0, "Existing non-coordinator roots cannot be adopted");
  const file = await open7(marker, "wx", 384);
  try {
    await file.writeFile(JSON.stringify({ version: 1 }));
    await file.sync();
  } finally {
    await file.close();
  }
}
var lock = join6(root, "running.lock");
try {
  await mkdir6(lock);
} catch (error) {
  if (error.code === "EEXIST") throw Error("Coordinator owner exists; inspect its live PID before explicit stale-lock removal");
  throw error;
}
var started = performance3.now();
var run = promisify6(execFile);
var stopping = false;
var inputMtime = -1;
var lastPause = "";
var runs = 0;
var defaultPoll = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
var queue = new WallPreparationJobs(join6(root, "queue"), join6(root, "canonical"), join6(root, "projections"));
var control;
var controlServer;
var retention;
var defaults2;
var lastHealth = "";
async function publishHealth(extra = {}) {
  const value = JSON.stringify({ ...queue.health(), ...retention ? { retention: retention.diagnostics() } : {}, ...defaults2 ? { defaults: defaults2.diagnostics() } : {}, ...extra, build: process.env.IQ_BUILD_COMMIT ?? "unknown" });
  if (value !== lastHealth) {
    await atomicWrite(join6(root, "health.json"), value);
    lastHealth = value;
  }
}
try {
  await atomicWrite(join6(lock, "owner.json"), JSON.stringify({ pid: process.pid, build: process.env.IQ_BUILD_COMMIT ?? "unknown", startedAt: (/* @__PURE__ */ new Date()).toISOString() }));
  await queue.open();
  if (process.env.IQ_WALL_PREPARATION_CONTROL === "1") {
    assert.ok(follow && process.env.IQ_WALL_QUEUE_EXIT_WHEN_SETTLED !== "1", "Serving admission requires a persistent coordinator");
    control = new WallPreparationControl(queue);
    if (process.env.WALL_DERIVED_GC === "1") {
      retention = new WallCacheRetention(root, queue, control);
      await retention.open();
    }
    controlServer = await serveWallPreparationControl(control);
  }
  if (process.env.WALL_DERIVED_GC === "1") assert.ok(retention, "Wall retention requires the persistent private control owner");
  if (process.env.IQ_WALL_ROLLING_DEFAULTS === "1") {
    assert.ok(control && retention && follow, "Rolling defaults require persistent consumer control and bounded derived retention");
    defaults2 = new WallRollingDefaults(queue, { expire: () => control.expire() });
  }
  while (!stopping && (follow || runs < steps)) {
    if (defaults2) {
      const timing = { priority: "background", dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId: "wall-defaults-" + process.pid + "-" + ++defaultPoll }, at = performance3.now(), cpu = process.cpuUsage();
      await queryTiming.run(timing, () => defaults2.tick());
      if (timing.queries) await appendWallPreparationLog(join6(root, "defaults.jsonl"), { kind: "default-admission", at: (/* @__PURE__ */ new Date()).toISOString(), elapsedMs: performance3.now() - at, cpu: process.cpuUsage(cpu), memory: process.memoryUsage(), timing, defaults: defaults2.diagnostics() });
    }
    await control?.expire();
    await retention?.tick();
    const metadata = await stat(input);
    assert.ok(metadata.size <= 65536, "Request admission file byte budget");
    if (metadata.mtimeMs !== inputMtime) {
      const requests = JSON.parse(await readFile4(input, "utf8"));
      assert.ok(Array.isArray(requests) && requests.length <= 32, "Request admission count budget");
      for (const item of requests) {
        const token = item.retry === true ? item.retryToken ?? createHash6("sha256").update(JSON.stringify([item.request?.market, item.request?.profile, item.request?.from, item.request?.to, item.lane ?? "visible", item.newRevision === true])).digest("hex") : void 0;
        await queue.enqueue(item.request, item.lane ?? "visible", item.retry === true, item.newRevision === true, token);
      }
      inputMtime = metadata.mtimeMs;
    }
    if (!queue.health().jobs.some((job) => job.state === "building")) {
      control?.setCapacityPause();
      await publishHealth({ paused: false });
      if (!follow || process.env.IQ_WALL_QUEUE_EXIT_WHEN_SETTLED === "1") break;
      await new Promise((resolve3) => setTimeout(resolve3, 1e3));
      continue;
    }
    const disk = await statfs(root), freeBytes = Number(disk.bavail) * Number(disk.bsize), usage = await run("du", ["-sb", "--", root], { maxBuffer: 1024, timeout: 1e4 }), measuredBytes = Number(usage.stdout.split(/\s+/)[0]);
    let derivedBytes = measuredBytes;
    if (stopping) break;
    assert.ok(Number.isSafeInteger(derivedBytes) && derivedBytes >= 0, "Invalid derived usage");
    let paused = freeBytes < 20 * 1024 ** 3 || derivedBytes + 128 * 1024 ** 2 > 2 * 1024 ** 3;
    if (paused && retention) {
      await retention.tick(true);
      const refreshed = await run("du", ["-sb", "--", root], { maxBuffer: 1024, timeout: 1e4 });
      derivedBytes = Number(refreshed.stdout.split(/\s+/)[0]);
      assert.ok(Number.isSafeInteger(derivedBytes) && derivedBytes >= 0, "Invalid derived usage");
      paused = freeBytes < 20 * 1024 ** 3 || derivedBytes + 128 * 1024 ** 2 > 2 * 1024 ** 3;
    }
    if (paused) {
      control?.setCapacityPause("Derived cache budget or filesystem headroom. Resumes automatically when capacity recovers.");
      await publishHealth({ paused: true, reason: "Isolated derived budget or filesystem headroom", freeBytes, derivedBytes });
      if (!lastPause) {
        console.log(JSON.stringify({ paused: true, freeBytes, derivedBytes }));
        lastPause = "capacity";
      }
      if (!follow) {
        process.exitCode = 2;
        break;
      }
      await new Promise((resolve3) => setTimeout(resolve3, 1e3));
    } else {
      control?.setCapacityPause();
      lastPause = "";
      const timing = { priority: "background", dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId: "wall-queue-" + queue.health().turn }, cpu = process.cpuUsage(), at = performance3.now();
      const job = await queryTiming.run(timing, () => queue.tick());
      runs++;
      const record = { job, elapsedMs: performance3.now() - at, cpu: process.cpuUsage(cpu), memory: process.memoryUsage(), timing, at: (/* @__PURE__ */ new Date()).toISOString() };
      if (job) {
        await appendWallPreparationLog(join6(root, "steps.jsonl"), record);
        console.log(JSON.stringify(record));
      }
      await publishHealth({ paused: false, freeBytes, derivedBytes });
      if (!follow && !job) break;
    }
    await new Promise((resolve3) => setTimeout(resolve3, 100));
  }
  if (queue.health().jobs.some((job) => job.state === "failed")) process.exitCode = 1;
  console.log(JSON.stringify({ kind: "bounded-wall-preparation-coordinator", runs, elapsedMs: performance3.now() - started, ...queue.health() }));
} finally {
  await retention?.close();
  if (controlServer) await new Promise((resolve3, reject) => controlServer.close((error) => error ? reject(error) : resolve3()));
  await unlink3(join6(lock, "owner.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rmdir3(lock);
}

// src/footprint-batch.ts
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createGzip, constants } from "node:zlib";
import { performance as performance3 } from "node:perf_hooks";

// src/db.ts
import { performance as performance2 } from "node:perf_hooks";

// src/query-timing.ts
import { AsyncLocalStorage } from "node:async_hooks";
var queryTiming = new AsyncLocalStorage();

// src/db.ts
var url = process.env.CH_URL ?? "http://127.0.0.1:18123";
async function sql(query2, data) {
  const started = performance2.now(), m = queryTiming.getStore(), target = new URL(url);
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
    if (m) m.dbMs += performance2.now() - started;
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

// src/footprint-source-version.ts
var emptyFootprintSourceVersion = () => ({ kind: "sha256-xor-v1", records: 0, maxId: 0, hash: "0" });
var footprintSourceRowHashSql = "reinterpretAsUInt256(SHA256(concat('fp1|',toString(id),'|',toString(timeMs),'|',toString(price),'|',toString(quantity),'|',toString(quoteNotional),'|',toString(side))))";
function validFootprintSourceVersion(value) {
  return value?.kind === "sha256-xor-v1" && Number.isSafeInteger(value.records) && value.records >= 0 && Number.isSafeInteger(value.maxId) && value.maxId >= 0 && typeof value.hash === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value.hash) && BigInt(value.hash) < 1n << 256n;
}
function sameFootprintSourceVersion(a, b) {
  return validFootprintSourceVersion(a) && validFootprintSourceVersion(b) && a.records === b.records && a.maxId === b.maxId && a.hash === b.hash;
}
function footprintSourceVersionsSql(from, to, step, market, watermark) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to - from > 144e5) throw Error("Invalid bounded footprint source version range");
  if (!Number.isSafeInteger(step) || step <= 0 || from % step || to % step || !Number.isSafeInteger(watermark) || watermark <= 0 || (to - from) / step > 300) throw Error("Invalid footprint source version geometry");
  return `SELECT intDiv(timeMs,${step})*${step} AS start,count() AS records,max(id) AS maxId,toString(groupBitXor(${footprintSourceRowHashSql})) AS hash FROM iqterminal.${marketConfig(market).executionTable} FINAL WHERE venue='binance' AND market='${market}' AND nativeSymbol='BTCUSDT' AND timeMs>=${from} AND timeMs<${to} AND id<=${watermark} GROUP BY start ORDER BY start LIMIT 301 SETTINGS max_threads=1,max_block_size=256,max_result_bytes=1048576,max_memory_usage=134217728,max_rows_to_read=4000000,max_bytes_to_read=134217728,max_execution_time=5`;
}
async function footprintSourceVersions(from, to, step, market, watermark, read = query) {
  const rows = await read(footprintSourceVersionsSql(from, to, step, market, watermark));
  if (rows.length > 300) throw Error("Footprint source version capacity");
  const versions = /* @__PURE__ */ new Map();
  for (let at = from; at < to; at += step) versions.set(at, emptyFootprintSourceVersion());
  for (const row of rows) {
    const start = Number(row.start), value = { kind: "sha256-xor-v1", records: Number(row.records), maxId: Number(row.maxId), hash: row.hash };
    if (!versions.has(start) || !validFootprintSourceVersion(value) || value.maxId > watermark) throw Error("Invalid canonical footprint source version");
    versions.set(start, value);
  }
  return versions;
}

// src/footprint-revisions.ts
import { readFile, stat } from "node:fs/promises";
var snapshots = /* @__PURE__ */ new Map();
function footprintRevisionRecords(records) {
  return records.flatMap((job) => {
    if (job.kind === "history" && job.requiredWatermark) {
      const { state, ...meta2 } = job;
      return [{ ...meta2, cursor: state?.cursor ?? job.cursor, watermark: state?.watermark ?? job.watermark }];
    }
    if (job.kind === "current") return (job.pendingRepairs ?? []).map((repair) => ({
      id: `revision-pending:${job.id}:${repair.from}`,
      kind: "history",
      interval: job.interval,
      rowPrice: job.rowPrice,
      ...repair,
      requiredWatermark: repair.watermark,
      pendingAdmission: true,
      retryable: true
    }));
    return [];
  });
}
async function footprintRevisionSnapshot(market, from, to, interval, rowPrice) {
  const file = market === "spot" ? process.env.FOOTPRINT_REVISION_STATE_SPOT ?? "/state/footprint-history-spot/jobs.json" : process.env.FOOTPRINT_REVISION_STATE_PERPETUAL ?? "/state/footprint-history-perpetual/jobs.json";
  let records;
  try {
    const info = await stat(file, { bigint: true }), stamp = `${info.ino}:${info.mtimeNs}:${info.size}`;
    if (info.size > 16n * 1024n * 1024n) throw Error("Prepared footprint revision journal capacity");
    const cached = snapshots.get(file);
    if (cached?.stamp === stamp) records = cached.records;
    else {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (!Array.isArray(parsed) || parsed.length > 128) throw Error("Invalid prepared footprint revision journal");
      records = footprintRevisionRecords(parsed);
      if (snapshots.size >= 2 && !snapshots.has(file)) snapshots.delete(snapshots.keys().next().value);
      snapshots.set(file, { stamp, records });
    }
  } catch (error) {
    if (error.code === "ENOENT") records = [];
    else throw Error("Prepared footprint revision journal unavailable");
  }
  const relevant = records.filter((job) => job.interval === interval && job.rowPrice === rowPrice && job.from < to && job.to > from);
  return { active: relevant.filter((job) => !job.done), signature: JSON.stringify(relevant.map((job) => [job.id, job.requiredWatermark, job.requiredSourceToken ?? "", job.done ?? 0, Boolean(job.failed)])) };
}

// src/history-footprints.ts
import { createHash } from "node:crypto";
import { readFile as readFile2 } from "node:fs/promises";

// src/shared/protocol.ts
var duration = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5 };
var depthBandsPercent = Object.freeze(Array.from({ length: 25 }, (_, i) => (i + 1) / 100));
var depthSeriesNames = Object.freeze([
  "iq_depth_bid_base_v1",
  "iq_depth_ask_base_v1",
  "iq_depth_bid_quote_v1",
  "iq_depth_ask_quote_v1"
]);
var legacyFootprintRowTicks = Object.freeze([1, 2, 5, 10, 20, 50]);

// src/shared/footprint.ts
var FOOTPRINT_MAX_BARS = 300;
var FOOTPRINT_MAX_CELLS = 18e3;
var FOOTPRINT_MAX_CELLS_PER_BAR = 512;
var DEFAULT_FOOTPRINT_LIMITS = Object.freeze({
  maxBars: FOOTPRINT_MAX_BARS,
  maxCells: FOOTPRINT_MAX_CELLS,
  maxCellsPerBar: FOOTPRINT_MAX_CELLS_PER_BAR
});

// src/core.ts
function validateRange(from, to, max = 144e5) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to - from > max) throw new Error("Invalid bounded [from,to) millisecond range");
}
function validateCheckpoint(state) {
  const integer3 = (n) => Number.isSafeInteger(n) && n > 0;
  if (!state || state.version !== 1 || !(state.coverageStart === null || integer3(state.coverageStart)) || !(state.last === null || integer3(state.last.id) && integer3(state.last.timeMs)) || !(state.oiLast === null || integer3(state.oiLast))) throw new Error("Invalid durable checkpoint; preserve file and investigate");
  for (const gaps of [state.gaps, state.oiGaps]) if (!Array.isArray(gaps) || gaps.length > 1024 || !gaps.every((g) => integer3(g.from) && integer3(g.to) && g.to > g.from && typeof g.reason === "string" && g.reason.length < 1e3)) throw new Error("Invalid checkpoint coverage; preserve file and investigate");
  return state;
}

// src/history-footprints.ts
var version = 1;
var geometry = (rowPrice, marketValue) => {
  const market = backendMarket(marketValue);
  const tickSize = market === "spot" ? 0.01 : 0.1;
  const rowTicks = Math.round(rowPrice / tickSize);
  if (!Number.isFinite(rowPrice) || rowPrice < tickSize || rowPrice > 1e4 || Math.abs(rowTicks * tickSize - rowPrice) > 1e-7) return null;
  return { market, tickSize, rowTicks, feed: marketConfig(market).executionFeed };
};
var identity = (timeMs, rowPrice, marketValue) => {
  const g = geometry(rowPrice, marketValue);
  if (!g) throw Error("Invalid footprint row width");
  return `feed='${g.feed}' AND version=${version} AND timeMs=${timeMs} AND rowTicks=${g.rowTicks}`;
};
async function footprintRows(from, to, timeMs, rowPrice, marketValue = process.env.MARKET) {
  return query(`SELECT start,revision,contentHash,payload FROM iqterminal.history_footprints FINAL PREWHERE ${identity(timeMs, rowPrice, marketValue)} AND start>=${from} AND start<${to} ORDER BY start LIMIT 301 SETTINGS max_threads=2,max_block_size=256,max_result_bytes=8388608`);
}
async function footprintSourceState(marketValue = process.env.MARKET) {
  const market = backendMarket(marketValue);
  return validateCheckpoint(JSON.parse(await readFile2(process.env.SOURCE_CHECKPOINT ?? (market === "spot" ? "/state/spot-checkpoint.json" : "/state/checkpoint.json"), "utf8")));
}
async function footprintSourceValidation(from, to, step, market) {
  const source2 = await footprintSourceState(market);
  if (!source2.last) throw Error("Footprint canonical source horizon unavailable");
  const eligibleFrom = Math.max(from, Math.ceil(Math.max(source2.coverageStart ?? to, source2.retentionStart ?? 0) / step) * step);
  const eligibleTo = Math.min(to, Math.floor(source2.last.timeMs / step) * step);
  const versions = eligibleFrom < eligibleTo ? await footprintSourceVersions(eligibleFrom, eligibleTo, step, market, source2.last.id) : /* @__PURE__ */ new Map();
  return { from: eligibleFrom, to: eligibleTo, watermark: source2.last.id, versions };
}
async function preparedFootprints(u, dependencies = {}) {
  const readRows = dependencies.rows ?? footprintRows, request = dependencies.request ?? fetch;
  const from = Number(u.searchParams.get("from")), to = Number(u.searchParams.get("to")), interval = u.searchParams.get("interval"), rowPrice = Number(u.searchParams.get("rowPrice")), market = backendMarket(u.searchParams.get("market"));
  validateRange(from, to);
  const timeMs = duration[interval];
  if (!timeMs || from % timeMs || to % timeMs || !geometry(rowPrice, market)) throw Error("Invalid footprint tile geometry");
  const revisions = dependencies.revisions ?? footprintRevisionSnapshot;
  let revisionError;
  const snapshot = async () => {
    try {
      return await revisions(market, from, to, interval, rowPrice);
    } catch (error2) {
      revisionError = error2.message;
      return { active: [], signature: "unavailable" };
    }
  };
  const before = await snapshot();
  const g = geometry(rowPrice, market);
  let rows = await readRows(from, to, timeMs, rowPrice, market);
  const revision = await snapshot();
  if (before.signature !== revision.signature) rows = await readRows(from, to, timeMs, rowPrice, market);
  let known = new Map((u.searchParams.get("known") ?? "").split(",").map((k) => k.split(":").map(Number))), missing = [];
  const present = new Set(rows.map((row) => Number(row.start)));
  for (let at = from; at < to; at += timeMs) if (!present.has(at)) missing.push(at);
  let validation, validationError;
  try {
    validation = await (dependencies.validation ?? footprintSourceValidation)(from, to, timeMs, market);
  } catch (cause) {
    validationError = String(cause.message ?? cause);
  }
  let stale = [], sourceUnavailable = [];
  const assess = () => {
    const present2 = new Set(rows.map((row) => Number(row.start)));
    missing = [];
    stale = [];
    sourceUnavailable = [];
    for (let at = from; at < to; at += timeMs) {
      if (validation && (at < validation.from || at + timeMs > validation.to)) {
        sourceUnavailable.push(at);
        continue;
      }
      if (!present2.has(at)) {
        missing.push(at);
        continue;
      }
      const expected = validation?.versions.get(at);
      if (!expected) continue;
      let payload;
      try {
        payload = JSON.parse(rows.find((row) => Number(row.start) === at).payload);
      } catch {
        stale.push(at);
        continue;
      }
      if (!sameFootprintSourceVersion(payload.sourceVersion, expected) || (payload.bar === null ? 0 : payload.bar?.aggregateRecordCount) !== expected.records) stale.push(at);
    }
  };
  assess();
  const internal2 = market === "spot" ? process.env.FOOTPRINT_INTERNAL_SPOT ?? "http://127.0.0.1:18789" : process.env.FOOTPRINT_INTERNAL ?? "http://127.0.0.1:18788";
  let jobs = [...revision.active], unavailable = false, error, retryable = true;
  const retry = u.searchParams.get("retry") === "1", waitJob = u.searchParams.get("job");
  let rebuilding = revision.active.length > 0;
  if (!validationError && (missing.length || stale.length || waitJob || rebuilding)) {
    try {
      const healthResponse = await request(internal2 + "/health", { signal: AbortSignal.timeout(5e3) }), health = await healthResponse.json();
      if (!healthResponse.ok || !Array.isArray(health.backlog) || !health.metrics) throw Error(health.error ?? "Footprint revision worker unavailable");
      jobs = health.backlog.filter((job) => job.kind !== "current" && (job.interval === interval || job.timeMs === timeMs) && job.rowPrice === rowPrice && job.from < to && job.to > from);
      const repairs = footprintRevisionRecords(health.backlog).filter((job) => !job.done && job.interval === interval && job.rowPrice === rowPrice && job.from < to && job.to > from);
      jobs = [...new Map([...jobs, ...repairs].map((job) => [job.id, job])).values()];
      rebuilding = repairs.some((job) => !job.failed);
      if (revision.active.length && !repairs.length) {
        rows = await readRows(from, to, timeMs, rowPrice, market);
        assess();
      }
      if (waitJob) {
        jobs = jobs.filter((job) => job.id === waitJob || job.requiredWatermark);
        rebuilding = rebuilding || jobs.some((job) => !job.failed);
        if (!jobs.length) {
          rows = await readRows(from, to, timeMs, rowPrice, market);
          assess();
        }
      }
      const failed = jobs.find((job) => job.failed);
      unavailable = Boolean((missing.length || jobs.length) && health.metrics.paused) || Boolean(failed && (!retry || failed.retryable === false));
      error = failed?.error;
      retryable = failed?.retryable !== false;
      const uncovered = missing.filter((at) => !jobs.some((job) => !job.failed && job.from <= at && job.to >= at + timeMs));
      const resumeFailed = Boolean(retry && failed && failed.retryable !== false);
      const staleUncovered = stale.filter((at) => !jobs.some((job) => !job.failed && job.from <= at && job.to >= at + timeMs));
      const sourceToken = validation ? createHash("sha256").update(JSON.stringify([...validation.versions])).digest("hex") : void 0;
      const changedActive = stale.length > 0 && jobs.some((job) => !job.failed && !job.done && job.from === from && job.to === to && job.requiredSourceToken && job.requiredSourceToken !== sourceToken);
      const refresh = staleUncovered.length > 0 || changedActive;
      if ((uncovered.length || refresh || resumeFailed) && !unavailable) {
        const start = resumeFailed ? failed.from : refresh ? from : uncovered[0], end = resumeFailed ? failed.to : refresh ? to : uncovered.at(-1) + timeMs;
        const params = new URLSearchParams({ from: String(start), to: String(end), rowPrice: String(rowPrice), timeMs: String(timeMs), ...resumeFailed ? { retry: "1" } : {} });
        if (refresh && validation) {
          params.set("sourceToken", sourceToken);
          params.set("sourceWatermark", String(validation.watermark));
        }
        const response = await request(internal2 + "/enqueue?" + params, { signal: AbortSignal.timeout(5e3) }), job = await response.json();
        if (!response.ok) throw Error(job.error ?? "Footprint build queue capacity; retry");
        jobs = [job];
        unavailable = job.failed === true;
        error = job.error;
        if (job.done) {
          rows = await readRows(from, to, timeMs, rowPrice, market);
          assess();
        }
      }
    } catch (cause) {
      unavailable = true;
      error = cause.message;
      retryable = true;
    }
  }
  rebuilding ||= jobs.some((job) => job.requiredWatermark && !job.done && !job.failed);
  const expiredSource = sourceUnavailable.some((at) => at < (validation?.from ?? from));
  if (expiredSource) retryable = false;
  if (revisionError || validationError || expiredSource) {
    unavailable = true;
    error = revisionError ?? validationError ?? "Canonical source not retained/recorded for requested footprint slots";
  }
  const revisionRanges = [...stale.map((at) => ({ from: at, to: at + timeMs, state: unavailable ? "unavailable" : "building" })), ...sourceUnavailable.map((at) => ({ from: at, to: at + timeMs, state: at < (validation?.from ?? from) ? "unavailable" : "building" })), ...jobs.filter((job) => job.requiredWatermark && !job.done).map((job) => ({ from: job.from, to: job.to, state: unavailable || job.failed ? "unavailable" : "building" }))];
  return {
    version,
    feed: g.feed,
    timeMs,
    rowPrice,
    state: unavailable ? "unavailable" : missing.length || stale.length || sourceUnavailable.length || rebuilding ? "building" : "ready",
    missing,
    jobs,
    sourceValidation: validation ? { from: validation.from, to: validation.to, watermark: validation.watermark } : void 0,
    revisionState: revisionError || validationError ? "unavailable" : revisionRanges.length ? unavailable ? "unavailable" : "pending" : "ready",
    revisionRanges,
    ...error ? { error, retryable } : {},
    tiles: rows.map((row) => ({ from: Number(row.start), revision: Number(row.revision), ...known.get(Number(row.start)) === Number(row.revision) ? {} : JSON.parse(row.payload) })),
    rawReplay: false
  };
}

// src/footprint-batch.ts
var FOOTPRINT_BATCH_PATH = "/v2/history/footprints-batch";
var FOOTPRINT_BATCH_LIMITS = { version: 1, maxChunks: 6, maxChunkMs: 144e5, maxRequestBytes: 65536, maxDataBytes: 8 * 1024 * 1024, maxFrameBytes: 8 * 1024 * 1024 + 4096 };
var integer = (value) => Number.isSafeInteger(value) && Number(value) > 0;
function footprintBatchRequests(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["version", "requests"].includes(k)) || body.version !== 1 || !Array.isArray(body.requests) || !body.requests.length || body.requests.length > 6) throw Error("Invalid footprint batch envelope");
  const identities = /* @__PURE__ */ new Set(), requests = [];
  for (const item of body.requests) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((k) => !["from", "to", "interval", "rowPrice", "market", "known", "job", "retry"].includes(k))) throw Error("Invalid footprint batch member");
    const step = duration[item.interval], tick = item.market === "spot" ? 0.01 : 0.1;
    if (!integer(item.from) || !integer(item.to) || item.to <= item.from || item.to - item.from > 144e5 || !step || item.from % step || item.to % step || (item.to - item.from) / step > 300 || !["spot", "perpetual"].includes(item.market) || typeof item.rowPrice !== "number" || !Number.isFinite(item.rowPrice) || item.rowPrice < tick || item.rowPrice > 1e4 || Math.abs(Math.round(item.rowPrice / tick) * tick - item.rowPrice) > 1e-7 || item.known !== void 0 && (typeof item.known !== "string" || item.known.length > 16384 || item.known !== "" && !/^\d+:\d+(?:,\d+:\d+)*$/.test(item.known)) || item.job !== void 0 && (typeof item.job !== "string" || !/^[a-zA-Z0-9:._-]{1,256}$/.test(item.job)) || item.retry !== void 0 && typeof item.retry !== "boolean") throw Error("Invalid bounded footprint batch geometry/command");
    const identity4 = JSON.stringify([item.market, item.interval, item.rowPrice, item.from, item.to]);
    if (identities.has(identity4)) throw Error("Invalid duplicate footprint batch member");
    identities.add(identity4);
    if (requests.some((old) => old.market !== item.market || old.interval !== item.interval || old.rowPrice !== item.rowPrice || old.from < item.to && old.to > item.from)) throw Error("Invalid overlapping or mixed footprint batch");
    requests.push({ ...item });
  }
  return requests;
}
var identity2 = (item) => ({ from: item.from, to: item.to, interval: item.interval, rowPrice: item.rowPrice, market: item.market });
function memberUrl(item) {
  const url2 = new URL("/v2/history/footprints", "http://127.0.0.1");
  for (const [key, value] of Object.entries(item)) if (value !== void 0) url2.searchParams.set(key, key === "retry" ? value ? "1" : "0" : String(value));
  return url2;
}
var readTiming = () => {
  const t = queryTiming.getStore();
  return { queries: t?.queries ?? 0, dbMs: t?.dbMs ?? 0, decodeMs: t?.decodeMs ?? 0, readRows: t?.readRows ?? 0, readBytes: t?.readBytes ?? 0, sqlQueueMs: t?.sqlQueueMs ?? 0 };
};
async function* footprintBatchFrames(requests, signal, prepare = async (url2, signal2) => preparedFootprints(url2, { request: ((input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal2, init.signal]) : signal2 })) })) {
  let failed = 0;
  for (const [index, item] of requests.entries()) {
    signal.throwIfAborted();
    const began = performance3.now(), before = readTiming();
    try {
      const data = await prepare(memberUrl(item), signal);
      signal.throwIfAborted();
      const after = readTiming(), metrics2 = Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key]]));
      yield { version: 1, kind: "chunk", index, request: identity2(item), metrics: { ...metrics2, elapsedMs: performance3.now() - began }, data };
    } catch (error) {
      signal.throwIfAborted();
      failed++;
      const message = String(error?.message ?? error).slice(0, 500), category = /capacity|budget/i.test(message) ? "capacity" : /Invalid|JSON|Unexpected token/i.test(message) ? "invalid-content" : "query";
      yield { version: 1, kind: "error", index, request: identity2(item), error: { message, category, retryable: category === "query" } };
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  signal.throwIfAborted();
  yield { version: 1, kind: "end", members: requests.length, failed };
}
function gzipAccepted(header) {
  return (header ?? "").toLowerCase().split(",").some((token) => {
    const [name, ...params] = token.trim().split(";"), q = params.find((p) => p.trim().startsWith("q=")), weight = q ? Number(q.trim().slice(2)) : 1;
    return name === "gzip" && Number.isFinite(weight) && weight > 0 && weight <= 1;
  });
}
async function serveFootprintBatch(req, res, options) {
  const began = performance3.now();
  let encodedBytes = 0, serializeMs = 0, compression;
  try {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return;
    }
    const url2 = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url2.pathname !== FOOTPRINT_BATCH_PATH || url2.search) throw Error("Invalid footprint batch route/query");
    if ((req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") throw Error("Invalid footprint batch content type");
    if (Number(req.headers["content-length"] ?? 0) > 65536) throw Error("Invalid footprint batch request byte budget");
    const chunks = [];
    let bytes = 0;
    req.setTimeout(5e3, () => req.destroy());
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) throw Error("Invalid footprint batch request byte budget");
        chunks.push(chunk);
      }
    } finally {
      req.setTimeout(0);
    }
    const requests = footprintBatchRequests(JSON.parse(Buffer.concat(chunks).toString()));
    options.signal.throwIfAborted();
    const compressed = gzipAccepted(req.headers["accept-encoding"]);
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-IQ-Footprint-Batch": "1", "X-IQ-Batch-Chunks": String(requests.length), Vary: "Accept-Encoding", ...compressed ? { "Content-Encoding": "gzip" } : {} });
    if (compressed) {
      compression = createGzip({ level: 1 });
      compression.on("data", (chunk) => {
        encodedBytes += chunk.length;
      });
      compression.on("error", () => res.destroy());
      compression.pipe(res);
    }
    const cancel = () => {
      compression?.destroy();
      res.destroy();
    };
    options.signal.addEventListener("abort", cancel, { once: true });
    try {
      let failed = 0;
      for await (const original of footprintBatchFrames(requests, options.signal, options.prepare)) {
        let frame = original;
        if (frame.kind === "end") frame = { ...frame, failed };
        const at = performance3.now();
        let line;
        if ("data" in frame) {
          const { data, ...meta2 } = frame, text = JSON.stringify(data);
          if (Buffer.byteLength(text) > FOOTPRINT_BATCH_LIMITS.maxDataBytes) {
            frame = { ...meta2, kind: "error", error: { message: "Footprint member response byte budget", category: "capacity", retryable: false } };
            line = JSON.stringify(frame) + "\n";
          } else line = JSON.stringify(meta2).slice(0, -1) + ',"data":' + text + "}\n";
        } else line = JSON.stringify(frame) + "\n";
        if (frame.kind === "error") failed++;
        if (Buffer.byteLength(line) > FOOTPRINT_BATCH_LIMITS.maxFrameBytes) throw Error("Footprint batch frame byte budget");
        serializeMs += performance3.now() - at;
        const out = compression ?? res;
        if (!compression) encodedBytes += Buffer.byteLength(line);
        if (!out.write(line)) await once(out, "drain", { signal: options.signal });
        if (compression) await new Promise((resolve, reject) => {
          const cancel2 = () => reject(options.signal.reason ?? Error("Footprint batch cancelled"));
          options.signal.addEventListener("abort", cancel2, { once: true });
          if (options.signal.aborted) {
            cancel2();
            return;
          }
          compression.flush(constants.Z_SYNC_FLUSH, () => {
            options.signal.removeEventListener("abort", cancel2);
            resolve();
          });
        });
      }
      const done = finished(res);
      if (compression) compression.end();
      else res.end();
      await done;
    } finally {
      options.signal.removeEventListener("abort", cancel);
    }
  } catch (error) {
    compression?.destroy();
    if (!res.destroyed) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error?.message ?? error).slice(0, 500) }));
      } else res.destroy();
    }
  } finally {
    options.onMetrics?.({ encodedBytes, serializeMs, elapsedMs: performance3.now() - began });
  }
}

// src/wall-batch-delivery.ts
import { createHash as createHash5 } from "node:crypto";
import { gzipSync, gzip as gzipCallback2, gunzip as gunzipCallback2 } from "node:zlib";
import { promisify as promisify4 } from "node:util";

// src/wall-canonical-overlap.ts
import { gunzip as unzip } from "node:zlib";
import { promisify } from "node:util";
var gunzip = promisify(unzip);
var SCAN_BYTES = 8 * 1024 * 1024;
var ROW_BYTES = 16 * 1024 * 1024;

// src/wall-source-version.ts
import { createHash as createHash2 } from "node:crypto";

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
var integer2 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var settings = "enable_shared_storage_snapshot_in_query=1,max_threads=1,max_block_size=256,max_result_bytes=1048576,max_memory_usage=268435456,max_rows_to_read=4000000,max_bytes_to_read=536870912,max_execution_time=5";
var wallSourceRowHashSql = "reinterpretAsUInt256(SHA256(concat('wall1|',toString(epoch),'|',toString(cursor),'|',toString(at),'|',toString(length(kind)),':',kind,'|',toString(length(payload)),':',payload)))";
function validateWallSourceRequest(request) {
  if (!["spot", "perpetual"].includes(request.market) || !parseArchiveProfileId(request.market, request.profile) || !integer2(request.from) || !integer2(request.to) || request.from <= 0 || request.to <= request.from || request.to - request.from > 48 * 36e5) throw Error("Invalid bounded wall source version request");
}
function wallSourceVersionSql(request, anchorCursor, watermark) {
  validateWallSourceRequest(request);
  if (!integer2(anchorCursor) || !integer2(watermark) || watermark < anchorCursor) throw Error("Invalid wall source version cursor");
  const where = `(cursor>${anchorCursor} OR at>=${request.from}) AND cursor<=${watermark} AND at<${request.to}`;
  return `SELECT count() AS records,max(cursor) AS maxCursor,toString(groupBitXor(${wallSourceRowHashSql})) AS hash FROM iqterminal.order_wall_archive_events FINAL PREWHERE profile='${request.profile}' AND (epoch,cursor,kind) IN (SELECT epoch,cursor,kind FROM iqterminal.order_wall_archive_events FINAL WHERE profile='${request.profile}' AND ${where}) WHERE ${where} SETTINGS ${settings}`;
}
async function wallSourceVersion(request, read = query) {
  validateWallSourceRequest(request);
  request = { market: request.market, profile: request.profile, from: request.from, to: request.to };
  const progressRows = await read(`SELECT cursor,epoch,at,availableFrom FROM iqterminal.order_wall_archive_progress FINAL WHERE profile='${request.profile}' LIMIT 1 SETTINGS ${settings}`);
  if (progressRows.length !== 1) throw Error("Wall source progress unavailable");
  const progress = progressRows[0], head = { cursor: Number(progress.cursor), epoch: Number(progress.epoch), at: Number(progress.at) }, availableFrom = progress.availableFrom == null ? null : Number(progress.availableFrom);
  if (!Object.values(head).every(integer2) || availableFrom !== null && !integer2(availableFrom)) throw Error("Invalid wall source progress");
  const anchors = await read(`SELECT cursor,epoch,at,midpoint,bookScope,payload FROM iqterminal.order_wall_archive_anchors FINAL WHERE profile='${request.profile}' AND cursor<=${head.cursor} AND at<${request.from} ORDER BY at DESC,cursor DESC LIMIT 1 SETTINGS ${settings}`);
  if (anchors.length > 1) throw Error("Invalid wall source anchor count");
  const row = anchors[0];
  let anchor = null;
  if (row) {
    const cursor = Number(row.cursor), epoch = Number(row.epoch), at = Number(row.at);
    if (![cursor, epoch, at].every(integer2) || cursor > head.cursor || at >= request.from || typeof row.payload !== "string" || typeof row.bookScope !== "string" || row.midpoint !== null && typeof row.midpoint !== "string") throw Error("Invalid wall source anchor");
    anchor = { cursor, epoch, at, hash: digest([cursor, epoch, at, row.midpoint, row.bookScope, row.payload]) };
  }
  let records = 0, maxCursor2 = 0, hash2 = "0";
  if (anchor) {
    const versions = await read(wallSourceVersionSql(request, anchor.cursor, head.cursor));
    if (versions.length !== 1) throw Error("Invalid wall source version result");
    records = Number(versions[0].records);
    maxCursor2 = Number(versions[0].maxCursor);
    hash2 = versions[0].hash;
    if (!integer2(records) || !integer2(maxCursor2) || maxCursor2 > head.cursor || typeof hash2 !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(hash2) || BigInt(hash2) >= 1n << 256n || records === 0 && (maxCursor2 !== 0 || hash2 !== "0")) throw Error("Invalid canonical wall source version");
  }
  const reason = !anchor ? "No retained wall carry-in anchor" : availableFrom === null || request.from < availableFrom ? "Requested wall source predates retained coverage" : request.to > head.at ? "Wall source has not confirmed the requested tail" : void 0;
  const basis = { version: 1, kind: "wall-source-sha256-xor-v1", ...request, availableFrom, anchor, confirmedTo: Math.min(request.to, head.at), records, maxCursor: maxCursor2, hash: hash2 };
  return { ...request, version: 1, kind: "wall-source-sha256-xor-v1", watermark: head.cursor, head, availableFrom, anchor, records, maxCursor: maxCursor2, hash: hash2, token: digest(basis), eligible: reason === void 0, ...reason ? { reason } : {} };
}
var WALL_SOURCE_PATH = "/v2/history/walls/source";
var WALL_DISCOVERY_PATH = "/v2/history/walls/discover";
function wallSourceRequest(url2) {
  const params = url2.searchParams;
  if (![WALL_SOURCE_PATH, WALL_DISCOVERY_PATH].includes(url2.pathname)) throw Error("Invalid wall source route");
  for (const key of params.keys()) if (!["market", "profile", "from", "to"].includes(key) || params.getAll(key).length !== 1) throw Error("Invalid or duplicate wall source parameter");
  for (const key of ["from", "to"]) if (!/^[1-9][0-9]*$/.test(params.get(key) ?? "")) throw Error("Invalid wall source range");
  const request = { market: backendMarket(params.get("market")), profile: params.get("profile") ?? "", from: Number(params.get("from")), to: Number(params.get("to")) };
  validateWallSourceRequest(request);
  return request;
}

// src/wall-history-chunks.ts
import { createHash as createHash3 } from "node:crypto";
import { mkdir, readFile as readFile3, open } from "node:fs/promises";
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
  const handle = await open(file, "r");
  try {
    if ((await handle.stat()).size > maxBytes) throw Error("Prepared wall file byte budget");
    return await handle.readFile({ signal });
  } finally {
    await handle.close();
  }
}
async function readWallChunkManifest(root, key, signal) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid wall chunk key");
  const state = JSON.parse((await boundedFile(join(root, key, "manifest.json"), 128 * 1024, signal)).toString());
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
async function readWallChunkPart(root, key, hash2, signal) {
  if (!/^[a-f0-9]{64}$/.test(hash2)) throw Error("Invalid wall part hash");
  const manifest = await readWallChunkManifest(root, key, signal), part = manifest.parts.find((p) => p.hash === hash2);
  if (!part) throw Error("Wall part is not in the completed manifest");
  const body = await boundedFile(join(root, key, hash2 + ".json.gz"), MAX_PART_BYTES + 1024, signal);
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
async function discoverPreparedWallView(root, request, source2 = wallSourceVersion) {
  validateWallSourceRequest(request);
  let lookup;
  try {
    lookup = JSON.parse((await boundedFile(join(root, "lookup", preparedWallLookupKey(request) + ".json"), 8192)).toString());
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing" };
    throw error;
  }
  if (lookup.version !== 1 || !/^[a-f0-9]{64}$/.test(lookup.sourceToken ?? "") || !/^[a-f0-9]{64}$/.test(lookup.key ?? "")) throw Error("Invalid prepared wall lookup");
  const proof = await source2(request);
  if (!proof.eligible) return { state: "ineligible", source: proof };
  if (lookup.sourceToken !== proof.token) return { state: "missing", source: proof };
  const manifest = await readWallChunkManifest(root, lookup.key);
  if (manifest.version !== 5 || manifest.sourceProof?.token !== proof.token || !sameWallRequest(manifest.request, request) || manifest.watermark > proof.watermark) throw Error("Prepared wall lookup source identity mismatch");
  return { state: "ready", source: proof, manifest };
}

// src/wall-chunk-delivery.ts
import { createHash as createHash4 } from "node:crypto";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify as promisify3 } from "node:util";

// src/wall-preparation-paths.ts
function preparedWallStateRoot() {
  if (process.env.WALL_PREPARATION_ENABLED !== "1") return void 0;
  const root = process.env.WALL_PREPARATION_STATE;
  if (!root || !root.startsWith("/") || root === "/" || root.includes("/../")) throw Error("Invalid explicit wall preparation state root");
  return root;
}

// src/wall-chunk-delivery.ts
import { join as join2 } from "node:path";
var gunzip2 = promisify3(gunzipCallback);
var WALL_MANIFEST_PATH = "/v2/history/walls/manifest";
var WALL_PART_PATH = "/v2/history/walls/part";
function gzipAccepted2(header) {
  const values = new Map(header.toLowerCase().split(",").map((token) => {
    const [name, ...options] = token.trim().split(";");
    const q2 = options.find((x) => x.trim().startsWith("q="));
    return [name, q2 ? Number(q2.trim().slice(2)) : 1];
  }));
  const q = values.get("gzip") ?? values.get("*") ?? 0;
  return q > 0 && q <= 1;
}
var wallChunkRoot = (market) => preparedWallStateRoot() ? join2(preparedWallStateRoot(), "canonical") : market === "spot" ? process.env.WALL_CHUNKS_STATE_SPOT ?? "/state/history-spot/wall-chunks" : process.env.WALL_CHUNKS_STATE_PERPETUAL ?? "/state/history/wall-chunks";
async function wallChunkResponse(url2, options = {}) {
  const partRequest = url2.pathname === WALL_PART_PATH;
  if (!partRequest && url2.pathname !== WALL_MANIFEST_PATH) throw Error("Invalid prepared wall route");
  const allowed = partRequest ? ["market", "key", "hash"] : ["market", "key"];
  for (const key2 of url2.searchParams.keys()) if (!allowed.includes(key2) || url2.searchParams.getAll(key2).length !== 1) throw Error("Invalid or duplicate prepared wall parameter");
  const market = backendMarket(url2.searchParams.get("market")), key = url2.searchParams.get("key") ?? "";
  const root = options.root?.(market) ?? wallChunkRoot(market);
  let body, etag, decodedBytes, encoding, sourceRevision;
  if (partRequest) {
    const data = await readWallChunkPart(root, key, url2.searchParams.get("hash") ?? "", options.signal);
    if (data.manifest.request.market !== market) throw Error("Invalid prepared wall market identity");
    sourceRevision = data.manifest.request.sourceRevision;
    decodedBytes = data.part.bytes;
    if (gzipAccepted2(options.acceptEncoding ?? "")) {
      body = data.body;
      encoding = "gzip";
      etag = data.part.compressedHash;
    } else {
      body = await gunzip2(data.body);
      if (body.byteLength !== data.part.bytes || createHash4("sha256").update(body).digest("hex") !== data.part.hash) throw Error("Prepared wall decoded content hash mismatch");
      etag = data.part.hash;
    }
  } else {
    const manifest = await readWallChunkManifest(root, key, options.signal);
    if (manifest.request.market !== market) throw Error("Invalid prepared wall market identity");
    sourceRevision = manifest.request.sourceRevision;
    body = Buffer.from(JSON.stringify(manifest));
    decodedBytes = body.byteLength;
    etag = createHash4("sha256").update(body).digest("hex");
  }
  options.signal?.throwIfAborted();
  const headers = { "Content-Type": "application/json", "Cache-Control": partRequest ? "private, max-age=31536000, immutable" : "private, max-age=0, must-revalidate", ETag: `"${etag}"`, Vary: "Accept-Encoding", "X-IQ-Decoded-Bytes": String(decodedBytes), "X-IQ-Source-Revision": sourceRevision, "X-IQ-Chunk-Key": key, "X-IQ-DB-Queries": "0", "X-IQ-DB-Read-Rows": "0", "X-IQ-DB-Read-Bytes": "0" };
  if (encoding) headers["Content-Encoding"] = encoding;
  if (options.ifNoneMatch?.split(",").some((value) => value.trim() === headers.ETag)) return { status: 304, headers, body: Buffer.alloc(0) };
  headers["Content-Length"] = String(body.byteLength);
  return { status: 200, headers, body };
}

// src/wall-batch-delivery.ts
var gunzip3 = promisify4(gunzipCallback2);
var gzip2 = promisify4(gzipCallback2);
var newline = gzipSync("\n");
var cache = /* @__PURE__ */ new Map();
var building = /* @__PURE__ */ new Map();
var cacheBytes = 0;
function remember(key, body) {
  if (body.byteLength > 8 * 1024 * 1024) return;
  while (cache.size >= 32 || cacheBytes + body.byteLength > 8 * 1024 * 1024) {
    const first = cache.keys().next().value;
    if (first === void 0) break;
    cacheBytes -= cache.get(first).byteLength;
    cache.delete(first);
  }
  cache.set(key, body);
  cacheBytes += body.byteLength;
}
var WALL_BATCH_PATH = "/v2/history/walls/batch";
var WALL_BATCH_DELIVERY = { version: 2, maxDecodedBytes: 8 * 1024 * 1024, maxParts: 8 };
async function wallBatchResponse(url2, options = {}) {
  if (url2.pathname !== WALL_BATCH_PATH) throw Error("Invalid prepared wall batch route");
  for (const key2 of url2.searchParams.keys()) if (!["market", "key", "start", "version"].includes(key2) || url2.searchParams.getAll(key2).length !== 1) throw Error("Invalid or duplicate wall batch parameter");
  if (url2.searchParams.get("version") !== "2") throw Error("Invalid wall batch version");
  const market = backendMarket(url2.searchParams.get("market")), key = url2.searchParams.get("key") ?? "", startText = url2.searchParams.get("start") ?? "";
  if (!/^(0|[1-9][0-9]*)$/.test(startText)) throw Error("Invalid wall batch start");
  const start = Number(startText), root = options.root?.(market) ?? wallChunkRoot(market), manifest = await readWallChunkManifest(root, key, options.signal);
  if (manifest.request.market !== market || !Number.isSafeInteger(start) || start >= manifest.parts.length) throw Error("Invalid wall batch identity");
  const selected = [];
  let decodedBytes = 0;
  for (const part of manifest.parts.slice(start, start + WALL_BATCH_DELIVERY.maxParts)) {
    if (decodedBytes + part.bytes + 1 > WALL_BATCH_DELIVERY.maxDecodedBytes) break;
    selected.push(part);
    decodedBytes += part.bytes + 1;
  }
  if (!selected.length) throw Error("Prepared wall batch byte budget");
  const members = [];
  for (const part of selected) {
    options.signal?.throwIfAborted();
    const data = await readWallChunkPart(root, key, part.hash, options.signal);
    members.push(data.body, newline);
  }
  const cacheKey = JSON.stringify([root, key, start, selected.map((p) => [p.hash, p.bytes, p.compressedHash])]);
  let compressed = cache.get(cacheKey), cacheState = compressed ? "hit" : "miss";
  if (compressed) {
    cache.delete(cacheKey);
    cache.set(cacheKey, compressed);
  } else {
    let work = building.get(cacheKey);
    if (!work) {
      work = (async () => {
        const decoded = await gunzip3(Buffer.concat(members), { maxOutputLength: WALL_BATCH_DELIVERY.maxDecodedBytes });
        if (decoded.byteLength !== decodedBytes) throw Error("Invalid wall batch decoded bytes");
        let offset = 0;
        for (const part of selected) {
          if (decoded[offset + part.bytes] !== 10 || createHash5("sha256").update(decoded.subarray(offset, offset + part.bytes)).digest("hex") !== part.hash) throw Error("Prepared wall decoded part hash mismatch");
          offset += part.bytes + 1;
        }
        const result = await gzip2(decoded, { level: 6 });
        remember(cacheKey, result);
        return result;
      })();
      building.set(cacheKey, work);
      void work.finally(() => building.delete(cacheKey)).catch(() => {
      });
    } else cacheState = "coalesced";
    compressed = await work;
  }
  let body = compressed, encoding;
  const accepts = (options.acceptEncoding ?? "").toLowerCase().split(",").some((token) => {
    const [name, ...params] = token.trim().split(";");
    const q = params.find((p) => p.trim().startsWith("q="));
    return name === "gzip" && (!q || Number(q.trim().slice(2)) > 0 && Number(q.trim().slice(2)) <= 1);
  });
  if (accepts) encoding = "gzip";
  else {
    body = await gunzip3(body, { maxOutputLength: WALL_BATCH_DELIVERY.maxDecodedBytes });
    if (body.byteLength !== decodedBytes) throw Error("Invalid wall batch decoded bytes");
  }
  options.signal?.throwIfAborted();
  const etag = '"' + createHash5("sha256").update(body).digest("hex") + '"';
  const headers = {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "private, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
    ETag: etag,
    "X-IQ-Batch-Cache": cacheState,
    "X-IQ-Decoded-Bytes": String(decodedBytes),
    "X-IQ-Wall-Start": String(start),
    "X-IQ-Wall-Next": String(start + selected.length),
    "X-IQ-Wall-Parts": String(selected.length),
    "X-IQ-Source-Revision": manifest.request.sourceRevision,
    "X-IQ-Chunk-Key": key,
    "X-IQ-DB-Queries": "0",
    "X-IQ-DB-Read-Rows": "0",
    "X-IQ-DB-Read-Bytes": "0"
  };
  if (encoding) headers["Content-Encoding"] = encoding;
  if (options.ifNoneMatch?.split(",").some((v) => v.trim() === etag)) return { status: 304, headers, body: Buffer.alloc(0) };
  headers["Content-Length"] = String(body.byteLength);
  return { status: 200, headers, body };
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
var pointKeys = "at,usd,percentile,rank,quantity,quantityExact,notionalExact";
var record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var decimal = (v) => typeof v === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
var validRank = (v) => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 10;
var pointOverhead = JSON.stringify({ at: 0, usd: 0, percentile: null, rank: 1, quantity: 0, quantityExact: "0", notionalExact: "0" }).length - JSON.stringify([0, "0", "0", 1]).length - 2;
async function encodeWallPointTransport(value, checkpoint, version2 = 1) {
  if (!Array.isArray(value) || value.length > 1e5) throw Error("Invalid wall point transport records");
  let changed = false, work = 0;
  const rows = [];
  for (const row of value) {
    if (!record(row) || !record(row.segment) || !Array.isArray(row.segment.valueRuns)) throw Error("Invalid wall point transport segment");
    const base = row.segment.start, points = [], multiply = version2 === 2 ? exactProductFor(row.segment.priceExact) : void 0;
    if (row.segment.valueRuns.length > 1e5) throw Error("Wall point transport value capacity");
    for (const p of row.segment.valueRuns) {
      if (record(p) && Object.keys(p).join(",") === pointKeys && p.percentile === null && validRank(p.rank) && decimal(p.quantityExact) && decimal(p.notionalExact) && p.quantity === Number(p.quantityExact) && p.usd === Number(p.notionalExact) && Number.isSafeInteger(base) && Number.isSafeInteger(p.at) && Number.isSafeInteger(p.at - base) && base + (p.at - base) === p.at) {
        points.push(version2 === 2 && multiply?.(p.quantityExact) === p.notionalExact ? [p.at - base, p.quantityExact, p.rank] : [p.at - base, p.quantityExact, p.notionalExact, p.rank]);
        changed = true;
      } else points.push(p);
      if (++work > 1e6) throw Error("Wall point transport value capacity");
      if (work % 256 === 0) await checkpoint?.();
    }
    rows.push({ ...row, segment: { ...row.segment, valueRuns: points } });
  }
  return { value: rows, changed };
}

// src/wall-projection-delivery.ts
import { createHash as createHash7 } from "node:crypto";
import { join as join4 } from "node:path";
import { promisify as promisify6 } from "node:util";
import { gzip as gzipCallback4, gunzip as gunzipCallback4, brotliCompress as brotliCallback, constants as constants2 } from "node:zlib";

// src/wall-history-projection.ts
import { createHash as createHash6 } from "node:crypto";
import { open as open2, mkdir as mkdir2 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { promisify as promisify5 } from "node:util";
import { gzip as gzipCallback3, gunzip as gunzipCallback3 } from "node:zlib";

// src/shared/order-walls-projection.ts
var ORDER_WALL_ARCHIVE_MAX_SEGMENTS = 1e5;

// src/shared/order-walls-projection-version.ts
var WALL_PROJECTION_CORE_SHA256 = "c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c";

// src/wall-history-projection.ts
var gzip3 = promisify5(gzipCallback3);
var gunzip4 = promisify5(gunzipCallback3);
var hash = (value) => createHash6("sha256").update(value).digest("hex");
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
  if (body.byteLength !== part.compressedBytes || hash(body) !== part.compressedHash) throw Error("Prepared wall projection compressed hash mismatch");
  signal?.throwIfAborted();
  return body;
}
function normalizedSettings(s) {
  if (!Number.isSafeInteger(s.topLevels) || s.topLevels < 1 || s.topLevels > 100 || typeof s.minimumNotionalEnabled !== "boolean" || !Number.isFinite(s.minimumNotionalUsd) || s.minimumNotionalUsd < 0 || !Number.isSafeInteger(s.minDurationMs) || s.minDurationMs < 0) throw Error("Invalid prepared wall projection settings");
  return { topLevels: s.topLevels, minimumNotionalEnabled: s.minimumNotionalEnabled, minimumNotionalUsd: s.minimumNotionalEnabled ? s.minimumNotionalUsd : 0, minDurationMs: s.minDurationMs };
}
function preparedWallProjectionKey(sourceKey, settings2) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw Error("Invalid prepared wall projection source key");
  return hash(JSON.stringify({ version: 2, sourceKey, core: WALL_PROJECTION_CORE_SHA256, settings: normalizedSettings(settings2) }));
}

// src/wall-projection-delivery.ts
var gzip4 = promisify6(gzipCallback4);
var gunzip5 = promisify6(gunzipCallback4);
var brotli = promisify6(brotliCallback);
var digest3 = (body) => createHash7("sha256").update(body).digest("hex");
var WALL_PROJECTION_BATCH_PATH = "/v2/history/walls/projection-batch";
var WALL_PROJECTION_DELIVERY = { version: 1, maxParts: 32, maxDecodedBytes: 8 * 1024 * 1024, pointTransport: 1, productTransport: 1 };
var wallProjectionRoot = (market) => preparedWallStateRoot() ? join4(preparedWallStateRoot(), "projections") : join4(wallChunkRoot(market), "projections");
var defaults = { topLevels: 8, minimumNotionalEnabled: false, minimumNotionalUsd: 0, minDurationMs: 0 };
async function discoverWallProjection(root, source2, signal, capability) {
  if (capability !== WALL_PROJECTION_CORE_SHA256) return void 0;
  const key = preparedWallProjectionKey(source2.key, defaults);
  let manifest;
  try {
    manifest = await readPreparedWallProjectionManifest(root, key, signal);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  if (manifest.sourceKey !== source2.key || manifest.sourceToken !== source2.sourceProof?.token || manifest.profile?.id !== source2.request.profile || manifest.profile.market !== source2.request.market || manifest.active.from !== source2.request.from || manifest.active.to !== source2.request.to || manifest.active.cursor !== source2.watermark || manifest.active.epoch !== source2.head.epoch) throw Error("Invalid prepared wall projection source identity");
  return { manifest, delivery: WALL_PROJECTION_DELIVERY };
}
var cache2 = /* @__PURE__ */ new Map();
var building2 = /* @__PURE__ */ new Map();
var cacheBytes2 = 0;
var wallProjectionEncodingHealth = () => ({ active: building2.size, limit: 3, cacheEntries: cache2.size, cacheBytes: cacheBytes2 });
function remember2(key, value) {
  if (value.retainedBytes > 8 * 1024 * 1024) return;
  while (cache2.size >= 32 || cacheBytes2 + value.retainedBytes > 8 * 1024 * 1024) {
    const first = cache2.keys().next().value;
    if (first === void 0) break;
    cacheBytes2 -= cache2.get(first).retainedBytes;
    cache2.delete(first);
  }
  cache2.set(key, value);
  cacheBytes2 += value.retainedBytes;
}
function acceptedEncoding(header) {
  const weights = /* @__PURE__ */ new Map();
  for (const token of (header ?? "").toLowerCase().split(",")) {
    const [name, ...params] = token.trim().split(";"), q = params.find((p) => p.trim().startsWith("q=")), weight = q ? Number(q.trim().slice(2)) : 1;
    if (name === "br" || name === "gzip") weights.set(name, Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }
  const br = weights.get("br") ?? 0, gzip6 = weights.get("gzip") ?? 0;
  return br > 0 && br >= gzip6 ? "br" : gzip6 > 0 ? "gzip" : void 0;
}
async function wallProjectionBatchResponse(url2, options = {}) {
  if (url2.pathname !== WALL_PROJECTION_BATCH_PATH) throw Error("Invalid wall projection batch route");
  for (const key2 of url2.searchParams.keys()) if (!["market", "key", "start", "version"].includes(key2) || url2.searchParams.getAll(key2).length !== 1) throw Error("Invalid or duplicate wall projection batch parameter");
  if (!["1", "2", "3"].includes(url2.searchParams.get("version") ?? "") || !/^(0|[1-9][0-9]*)$/.test(url2.searchParams.get("start") ?? "")) throw Error("Invalid wall projection batch start/version");
  const market = backendMarket(url2.searchParams.get("market")), root = options.root?.(market) ?? wallProjectionRoot(market), key = url2.searchParams.get("key") ?? "", start = Number(url2.searchParams.get("start"));
  const manifest = await readPreparedWallProjectionManifest(root, key, options.signal);
  if (manifest.profile?.market !== market || !Number.isSafeInteger(start) || start >= manifest.parts.length) throw Error("Invalid wall projection batch identity");
  const selected = [];
  let decodedBytes = 0;
  for (const part of manifest.parts.slice(start, start + WALL_PROJECTION_DELIVERY.maxParts)) {
    if (decodedBytes + part.bytes + 1 > WALL_PROJECTION_DELIVERY.maxDecodedBytes) break;
    selected.push(part);
    decodedBytes += part.bytes + 1;
  }
  if (!selected.length) throw Error("Wall projection batch byte capacity");
  const pointTransport = url2.searchParams.get("version") === "3" ? 2 : url2.searchParams.get("version") === "2" ? 1 : 0, encoding = acceptedEncoding(options.acceptEncoding), codec = encoding ?? "gzip";
  const identity4 = JSON.stringify([root, key, start, selected.map((part) => part.hash), codec, pointTransport]);
  let encoded = cache2.get(identity4), cacheState = encoded ? "hit" : "miss";
  if (encoded) {
    cache2.delete(identity4);
    cache2.set(identity4, encoded);
  } else {
    let work = building2.get(identity4);
    if (work) cacheState = "coalesced";
    else {
      if (building2.size >= 3) throw Error("Prepared wall encoding capacity; retry");
      work = (async () => {
        const decoded = [], partBytes = [];
        let wireDecodedBytes = 0, yieldAt = performance.now();
        const checkpoint = async () => {
          if (performance.now() - yieldAt >= 8) {
            await new Promise((resolve) => setImmediate(resolve));
            yieldAt = performance.now();
          }
        };
        for (const [i, part] of selected.entries()) {
          let raw2 = await gunzip5(await readPreparedWallProjectionPart(root, manifest, start + i), { maxOutputLength: 4 * 1024 * 1024 });
          if (raw2.byteLength !== part.bytes || digest3(raw2) !== part.hash) throw Error("Wall projection decoded hash mismatch");
          if (pointTransport) {
            const rows = JSON.parse(raw2.toString());
            if (Buffer.from(JSON.stringify(rows)).equals(raw2)) {
              const compact = await encodeWallPointTransport(rows, checkpoint, pointTransport === 2 ? 2 : 1);
              if (compact.changed) {
                const packed = Buffer.from(JSON.stringify(compact.value));
                if (packed.byteLength > part.bytes) throw Error("Wall point transport byte capacity");
                raw2 = packed;
              }
            }
          }
          partBytes.push(raw2.byteLength);
          wireDecodedBytes += raw2.byteLength + 1;
          decoded.push(raw2, Buffer.from("\n"));
          await checkpoint();
        }
        const raw = Buffer.concat(decoded, wireDecodedBytes);
        const compressed = codec === "br" ? await brotli(raw, { params: { [constants2.BROTLI_PARAM_QUALITY]: 5, [constants2.BROTLI_PARAM_MODE]: constants2.BROTLI_MODE_TEXT } }) : await gzip4(raw, { level: 6 });
        const value = { body: compressed, partBytes, decodedBytes: wireDecodedBytes, retainedBytes: compressed.byteLength + partBytes.length * 8 + identity4.length * 2 + 128 };
        remember2(identity4, value);
        return value;
      })();
      building2.set(identity4, work);
      void work.finally(() => building2.delete(identity4)).catch(() => {
      });
    }
    encoded = await work;
  }
  let body = encoded.body;
  if (!encoding) body = await gunzip5(body, { maxOutputLength: WALL_PROJECTION_DELIVERY.maxDecodedBytes });
  options.signal?.throwIfAborted();
  const etag = '"' + digest3(body) + '"', headers = {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "private, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
    ETag: etag,
    "X-IQ-Batch-Cache": cacheState,
    "X-IQ-Decoded-Bytes": String(encoded.decodedBytes),
    "X-IQ-Wall-Start": String(start),
    "X-IQ-Wall-Next": String(start + selected.length),
    "X-IQ-Wall-Parts": String(selected.length),
    "X-IQ-Source-Revision": manifest.sourceToken,
    "X-IQ-Chunk-Key": key,
    "X-IQ-DB-Queries": "0",
    "X-IQ-DB-Read-Rows": "0",
    "X-IQ-DB-Read-Bytes": "0"
  };
  if (pointTransport) {
    headers["X-IQ-Wall-Transport"] = pointTransport === 2 ? WALL_PRODUCT_POINT_TRANSPORT : WALL_POINT_TRANSPORT;
    headers["X-IQ-Wall-Part-Bytes"] = JSON.stringify(encoded.partBytes);
    headers["X-IQ-Canonical-Bytes"] = String(decodedBytes);
  }
  if (encoding) headers["Content-Encoding"] = encoding;
  if (options.ifNoneMatch?.split(",").some((value) => value.trim() === etag)) return { status: 304, headers, body: Buffer.alloc(0) };
  headers["Content-Length"] = String(body.byteLength);
  return { status: 200, headers, body };
}

// src/wall-preparation-control.ts
import http from "node:http";
var WALL_PREPARATION_PORT = 18791;
var WALL_READ_LEASE_PATH = "/v2/history/walls/reader";
function wallPreparationCommand(path, input, signal, port2 = WALL_PREPARATION_PORT) {
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 4096) return Promise.reject(Error("Invalid wall preparation command size"));
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: port2, path, method: "POST", signal, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 8192) {
          response.destroy(Error("Wall preparation reply size"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString());
          if (response.statusCode !== 200) throw Error(value.error ?? "Wall preparation unavailable");
          resolve(value);
        } catch (error) {
          reject(error);
        }
      });
    });
    const timer = setTimeout(() => request.destroy(Error("Wall preparation control timeout")), 2e3);
    timer.unref();
    request.once("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end(body);
  });
}

// src/wall-preparation-gateway.ts
var WALL_PREPARATION_CANCEL_PATH = "/v2/history/walls/preparation";
var consumerValid = (value) => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(value);
async function discoverAndPrepareWallView(root, projectionRoot, request, options, deps = { discover: discoverPreparedWallView, projection: discoverWallProjection, command: wallPreparationCommand }) {
  if (options.enabled && options.consumer !== void 0 && !consumerValid(options.consumer)) throw Error("Invalid wall preparation consumer");
  const consumer = options.consumer;
  let preparation;
  const admit = () => deps.command("/admit", { request, consumer, ...options.retryToken ? { retry: true, retryToken: options.retryToken, newRevision: options.newRevision === true } : {} }, options.signal);
  try {
    if (options.enabled && consumer && options.job) {
      if (options.job !== preparedWallLookupKey(request)) throw Error("Invalid wall preparation job identity");
      preparation = await admit();
      if (preparation.job.state !== "ready") {
        options.signal?.throwIfAborted();
        return { state: "building", preparation };
      }
    }
    const data = await deps.discover(root, request);
    if (data.state === "ready") data.projection = await deps.projection(projectionRoot, data.manifest, options.signal, options.capability);
    if (!options.enabled || !consumer || data.state === "ineligible" || data.state === "ready" && (data.projection || options.capability !== WALL_PROJECTION_CORE_SHA256)) return data;
    data.preparation = preparation ?? await admit();
    options.signal?.throwIfAborted();
    return data;
  } catch (error) {
    if (options.enabled && consumer && options.signal?.aborted) void deps.command("/release", { consumer }).catch(() => {
    });
    throw error;
  }
}

// src/sql-admission-health.ts
async function sqlAdmissionHealth() {
  const endpoint = process.env.SQL_ADMISSION_HEALTH_URL;
  if (!endpoint) return { enabled: false };
  try {
    const url2 = new URL(endpoint);
    if (url2.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url2.hostname)) throw Error();
    const response = await fetch(url2, { signal: AbortSignal.timeout(1e3) });
    if (!response.ok) throw Error();
    return { enabled: true, ...await response.json() };
  } catch {
    return { enabled: true, error: "SQL admission unavailable" };
  }
}

// src/gateway-admission.ts
var GatewayAdmission = class {
  constructor(total = 4, reserveCurrent = 1) {
    this.total = total;
    this.reserveCurrent = reserveCurrent;
  }
  active = 0;
  history = 0;
  acquire(current) {
    if (this.active >= this.total || !current && this.history >= this.total - this.reserveCurrent) return;
    this.active++;
    if (!current) this.history++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (!current) this.history--;
    };
  }
  diagnostics() {
    return { active: this.active, history: this.history, reservedCurrent: this.reserveCurrent, limit: this.total };
  }
};
function isCurrentHistoryPath(path) {
  return ["/v2/history/walls/reader", "/v2/history/walls/preparation", "/v2/history/current", "/v2/history/health", "/v2/history/footprint-current", "/v1/order-walls/archive/current"].includes(path);
}
function isManagedHistoryPath(path) {
  return path.startsWith("/v2/history/") || path.startsWith("/v1/order-walls/archive") || path === "/v1/depth-observations" || path === "/v1/native-candles";
}

// src/history-gateway.ts
import { randomUUID } from "node:crypto";

// src/shared/history-wire.ts
var fields = ["low", "bid", "ask", "bidQuote", "askQuote", "bidPeak", "askPeak", "bidQuotePeak", "askQuotePeak", "bidDuration", "askDuration"];
var STRIDE = 13;
var MAX_CELLS = 16384;
var MAX_HEADER = 262144;
function encodeHistory(data) {
  const epochs = [], epochIds = /* @__PURE__ */ new Map();
  let count = 0;
  const tiles = data.tiles.map((tile) => {
    const { cells, ...meta2 } = tile;
    const offset = count;
    count += cells.length;
    return { ...meta2, offset, count: cells.length };
  });
  if (count > MAX_CELLS) throw Error("History wire cell budget");
  const values = new Float64Array(count * STRIDE);
  let index = 0;
  for (const tile of data.tiles) for (const cell of tile.cells) {
    for (let field = 0; field < fields.length; field++) values[field * count + index] = cell[fields[field]] ?? NaN;
    values[11 * count + index] = Number(cell.bidComplete) + 2 * Number(cell.askComplete);
    const key = cell.epochs.join(",");
    let epoch = epochIds.get(key);
    if (epoch === void 0) {
      epoch = epochs.length;
      epochIds.set(key, epoch);
      epochs.push(cell.epochs);
    }
    values[12 * count + index] = epoch;
    index++;
  }
  const header = new TextEncoder().encode(JSON.stringify({ ...data, tiles, wire: 1, stride: STRIDE, totalCells: count, epochs }));
  if (header.length > MAX_HEADER) throw Error("History wire header budget");
  const bytes = new Uint8Array(4 + header.length + values.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, header.length, true);
  bytes.set(header, 4);
  for (let i = 0; i < values.length; i++) view.setFloat64(4 + header.length + i * 8, values[i], true);
  return bytes;
}

// src/history-gateway.ts
import http2 from "node:http";
import net from "node:net";
import { performance as performance5 } from "node:perf_hooks";

// src/history-api.ts
import { performance as performance4 } from "node:perf_hooks";

// src/depth-book.ts
function validateHeatmap(p) {
  if (![p.from, p.to, p.timeMs].every(Number.isSafeInteger) || p.from <= 0 || p.to <= p.from || p.to - p.from > 144e5 || ![p.low, p.high, p.rowPrice].every(Number.isFinite) || p.low < 0 || p.high <= p.low || p.rowPrice < 0.1 || Math.abs(p.rowPrice * 10 - Math.round(p.rowPrice * 10)) > 1e-6 || p.timeMs < 1e3 || p.timeMs > 144e5 || 6e4 % p.timeMs !== 0 && p.timeMs % 6e4 !== 0 || !["average", "peak", "last"].includes(p.mode)) throw new Error("Invalid bounded heatmap request");
  if (Math.ceil((p.high - p.low) / p.rowPrice) > 512 || Math.ceil((p.to - p.from) / p.timeMs) * Math.ceil((p.high - p.low) / p.rowPrice) > 16384) throw new Error("Heatmap rendering budget; choose coarser resolution");
}

// src/history-core.ts
var HISTORY_VERSION = 1;
var PREPARED_ROWS = [10, 25, 50, 100, 250, 1e3];
var TILE_MS = 3e5;
var PRICE_BLOCK_ROWS = 64;
var FEED = historyFeed(process.env.HISTORY_MARKET ?? process.env.MARKET);
var sides = ["bid", "ask"];
var blank = (row) => ({ row, bid: 0n, ask: 0n, bidQuote: 0n, askQuote: 0n, bidPeak: 0n, askPeak: 0n, bidQuotePeak: 0n, askQuotePeak: 0n, bidLast: 0n, askLast: 0n, bidQuoteLast: 0n, askQuoteLast: 0n, bidAt: -1, askAt: -1, bidPartial: 0, askPartial: 0, epochs: /* @__PURE__ */ new Set() });
var complete = (row, width, book, side) => side === "bid" ? row * width >= book.bidFloor : (row + 1) * width <= book.askCeiling + 1e-7;
function decode(text) {
  return JSON.parse(text, (_, v) => v && typeof v === "object" && Object.hasOwn(v, "$integer") ? BigInt(v.$integer) : v && typeof v === "object" && Object.hasOwn(v, "$epochs") ? new Set(v.$epochs) : v);
}
function projectBucket(b, low, high, mode = "average") {
  const map = new Map(b.cells.map((c) => [c.row, c])), cells = [];
  if (Math.ceil((high - low) / b.rowPrice) > 512) throw Error("Prepared row budget");
  for (let row = Math.floor(low / b.rowPrice); row < Math.ceil(high / b.rowPrice); row++) {
    const c = map.get(row) ?? blank(row), epochs = new Set(c.epochs), durations = { bid: 0, ask: 0 };
    const lastCovered = { bid: -1, ask: -1 };
    for (const span of b.spans) {
      const dt = Math.max(0, Math.min(span.to, b.to) - Math.max(span.from, b.from));
      const observed = dt > 0 || span.observedAt >= b.from && span.observedAt < b.to;
      if (!observed) continue;
      let any = false;
      for (const s of sides) if (complete(row, b.rowPrice, span, s)) {
        durations[s] += dt;
        lastCovered[s] = Math.max(lastCovered[s], Math.min(span.to, b.to));
        any = true;
      }
      if (any) epochs.add(span.epoch);
    }
    for (const s of sides) durations[s] += c[s + "Partial"];
    if (!epochs.size) continue;
    const cell = { time: b.from, low: row * b.rowPrice, high: row * b.rowPrice + b.rowPrice, epochs: [...epochs] };
    for (const s of sides) {
      for (const q of ["", "Quote"]) {
        const name = s + q, scale = q ? 1e16 : 1e8;
        cell[name] = !durations[s] ? null : mode === "average" ? Number(c[name]) / (scale * durations[s]) : mode === "peak" ? Number(c[name + "Peak"]) / scale : lastCovered[s] > c[s + "At"] ? 0 : Number(c[name + "Last"]) / scale;
        cell[name + "Peak"] = Number(c[name + "Peak"]) / scale;
      }
      cell[s + "Duration"] = durations[s];
      cell[s + "Complete"] = durations[s] - c[s + "Partial"] === b.to - b.from && epochs.size === 1;
    }
    cells.push(cell);
  }
  return cells;
}

// src/history-store.ts
var identity3 = (timeMs, rowPrice, feed = FEED) => `feed='${feed}' AND version=${HISTORY_VERSION} AND timeMs=${timeMs} AND rowTicks=${Math.round(rowPrice * 10)}`;
async function manifestsFor(from, to, timeMs, rowPrice, execute = query, feed = FEED) {
  const rows = await execute(`SELECT start,end,revision,cursor,contentHash,spans,blocks,state FROM iqterminal.history_manifest FINAL PREWHERE ${identity3(timeMs, rowPrice, feed)} AND start>=${from} AND start<${to} ORDER BY start LIMIT 4097 SETTINGS max_threads=2,max_block_size=256,max_result_bytes=8388608`);
  if (rows.length > 4096) throw Error("Manifest budget");
  return rows.map((r) => ({ version: HISTORY_VERSION, feed, timeMs, rowPrice, from: Number(r.start), to: Number(r.end), revision: Number(r.revision), cursor: Number(r.cursor), contentHash: r.contentHash, spans: decode(r.spans), blocks: r.blocks.map(Number), state: r.state }));
}
async function readTiles(manifests, low, high) {
  if (!manifests.length) return [];
  const first = manifests[0], minBlock = Math.floor(Math.floor(low / first.rowPrice) / PRICE_BLOCK_ROWS), maxBlock = Math.floor((Math.ceil(high / first.rowPrice) - 1) / PRICE_BLOCK_ROWS);
  const keys = manifests.map((m) => `(${m.from},${m.revision})`).join(",");
  const rows = await query(`SELECT start,revision,block,payload FROM iqterminal.history_tiles FINAL PREWHERE ${identity3(first.timeMs, first.rowPrice, first.feed)} AND (start,revision) IN (${keys}) AND block>=${minBlock} AND block<=${maxBlock} ORDER BY start,block LIMIT 2049 SETTINGS max_threads=2,max_block_size=256,max_result_bytes=16777216`);
  if (rows.length > 2048) throw Error("Tile read budget");
  return rows.map((r) => ({ from: Number(r.start), revision: Number(r.revision), block: Number(r.block), cells: decode(r.payload) }));
}
async function readBuckets(manifests, low, high) {
  const tiles = await readTiles(manifests, low, high);
  for (const m of manifests) {
    const first = Math.floor(low / m.rowPrice / PRICE_BLOCK_ROWS), last = Math.floor((Math.ceil(high / m.rowPrice) - 1) / PRICE_BLOCK_ROWS);
    for (const block of m.blocks) if (block >= first && block <= last && !tiles.some((t) => t.from === m.from && t.revision === m.revision && t.block === block)) throw Error("Prepared payload unavailable; rebuild this range before serving");
  }
  return manifests.map((m) => ({ version: m.version, feed: m.feed, from: m.from, to: m.to, rowPrice: m.rowPrice, cursor: m.cursor, spans: m.spans, cells: tiles.filter((t) => t.from === m.from && t.revision === m.revision).flatMap((t) => t.cells) }));
}

// src/history-api.ts
var materializer = (marketValue) => backendMarket(marketValue) === "spot" ? process.env.HISTORY_INTERNAL_SPOT ?? "http://127.0.0.1:18783" : process.env.HISTORY_INTERNAL ?? "http://127.0.0.1:18782";
async function internal(path, marketValue = "perpetual") {
  const r = await fetch(materializer(marketValue) + path, { signal: AbortSignal.timeout(5e3) });
  const data = decode(await r.text());
  if (!r.ok) throw Error(data.error ?? "Materializer unavailable");
  return data;
}
var historyHealth = (marketValue = "perpetual") => internal("/health", marketValue);
function parseHistory(u) {
  const p = { from: Number(u.searchParams.get("from")), to: Number(u.searchParams.get("to")), low: Number(u.searchParams.get("low")), high: Number(u.searchParams.get("high")), timeMs: Number(u.searchParams.get("timeMs")), rowPrice: Number(u.searchParams.get("rowPrice")), mode: u.searchParams.get("mode") ?? "average" };
  validateHeatmap(p);
  if (p.mode !== "average") throw Error("Prepared transport supplies average and peak columns; use legacy for last");
  if (p.from % p.timeMs) throw Error("History start must be aligned");
  return p;
}
var baseTime = (timeMs) => timeMs;
async function historyManifest(p, includeTiles = false, marketValue = "perpetual") {
  const market = backendMarket(marketValue), feed = historyFeed(market), t = performance4.now(), timeMs = baseTime(p.timeMs), from = Math.floor(p.from / timeMs) * timeMs, to = Math.ceil(p.to / timeMs) * timeMs;
  const [ready, health] = await Promise.all([manifestsFor(from, to, timeMs, p.rowPrice, void 0, feed), historyHealth(market)]);
  const dbMs = performance4.now() - t;
  const map = new Map(ready.map((m) => [m.from, m]));
  const buckets = [];
  let missingFrom = Infinity, missingTo = 0;
  for (let at = from; at < to; at += timeMs) {
    const m = map.get(at);
    const correction = health.backlog.some((j) => !j.layer && j.correction && j.timeMs === timeMs && (j.rowPrice === p.rowPrice || timeMs === TILE_MS && j.rowPrice === 10 && PREPARED_ROWS.includes(p.rowPrice)) && j.from <= at && j.to > at);
    if (m && !correction) {
      buckets.push(m);
      continue;
    }
    const pending = health.backlog.find((j) => !j.layer && j.timeMs === timeMs && (j.rowPrice === p.rowPrice || timeMs === TILE_MS && j.rowPrice === 10 && PREPARED_ROWS.includes(p.rowPrice)) && j.from <= at && j.to >= at + timeMs);
    if (pending) {
      buckets.push({ from: at, to: at + timeMs, state: pending.failed || health.metrics.paused ? "unavailable" : "building", reason: health.metrics.paused ? health.metrics.error : pending.error });
      continue;
    }
    const forming2 = at === Math.floor(health.head.at / timeMs) * timeMs;
    if (forming2) {
      buckets.push({ from: at, to: Math.min(at + timeMs, health.head.at), state: "forming", cursor: health.head.cursor, revision: health.head.cursor });
      continue;
    }
    if (health.metrics.paused) {
      buckets.push({ from: at, to: at + timeMs, state: "unavailable", reason: health.metrics.error });
      continue;
    }
    if (at + timeMs <= health.head.at) {
      missingFrom = Math.min(missingFrom, at);
      missingTo = at + timeMs;
      buckets.push({ from: at, to: at + timeMs, state: "building" });
    } else buckets.push({ from: at, to: at + timeMs, state: "unavailable", reason: "Beyond durable depth horizon" });
  }
  let job;
  if (missingTo) job = await internal(`/enqueue?from=${missingFrom}&to=${missingTo}&timeMs=${timeMs}&rowPrice=${p.rowPrice}`, market);
  let projectMs = 0;
  const tiles = [];
  if (includeTiles) {
    const selected = ready.filter((m) => buckets.some((b) => b.from === m.from && (b.state === "ready" || b.state === "gap"))), first = Math.floor(p.low / p.rowPrice / PRICE_BLOCK_ROWS), last = Math.floor((Math.ceil(p.high / p.rowPrice) - 1) / PRICE_BLOCK_ROWS);
    if (selected.length * (last - first + 1) > 256) selected.splice(Math.floor(256 / (last - first + 1)));
    const stored = await readBuckets(selected, first * PRICE_BLOCK_ROWS * p.rowPrice, (last + 1) * PRICE_BLOCK_ROWS * p.rowPrice);
    const projectStart = performance4.now();
    for (const m of selected) {
      const b = stored.find((b2) => b2.from === m.from);
      for (let block = first; block <= last; block++) tiles.push({ version: HISTORY_VERSION, feed, timeMs, rowPrice: p.rowPrice, from: m.from, to: m.to, revision: m.revision, block, cursor: b.cursor, firstRow: Math.max(Math.floor(p.low / p.rowPrice), block * PRICE_BLOCK_ROWS), rowCount: Math.min(Math.ceil(p.high / p.rowPrice), (block + 1) * PRICE_BLOCK_ROWS) - Math.max(Math.floor(p.low / p.rowPrice), block * PRICE_BLOCK_ROWS), cells: projectBucket(b, Math.max(p.low, block * PRICE_BLOCK_ROWS * p.rowPrice), Math.min(p.high, (block + 1) * PRICE_BLOCK_ROWS * p.rowPrice)) });
    }
    projectMs += performance4.now() - projectStart;
  }
  const forming = buckets.find((b) => b.state === "forming");
  const current = forming ? await currentHistory({ ...p, from: forming.from, to: Math.min(p.to, forming.from + timeMs) }, market) : void 0;
  return { current, tiles, version: HISTORY_VERSION, market, feed, resolution: { timeMs: p.timeMs, baseTimeMs: timeMs, rowPrice: p.rowPrice }, from: p.from, to: p.to, head: health.head, buckets, job, lagMs: health.metrics.liveLagMs, timings: { manifestMs: dbMs, projectMs, totalMs: performance4.now() - t } };
}
async function historyTiles(u) {
  const begin = performance4.now(), timeMs = Number(u.searchParams.get("timeMs")), rowPrice = Number(u.searchParams.get("rowPrice")), market = backendMarket(u.searchParams.get("market")), feed = historyFeed(market);
  const keys = (u.searchParams.get("keys") ?? "").split(",").map((k) => k.split(":").map(Number));
  if (!keys.length || keys.length > 256 || keys.some((k) => k.length !== 3 || k.some((v) => !Number.isSafeInteger(v) || v < 0))) throw Error("Invalid tile key budget");
  const starts = keys.map((k) => k[0]), min = Math.min(...starts), max = Math.max(...starts);
  validateHeatmap({ from: min, to: max + timeMs, low: 0, high: rowPrice, rowPrice, timeMs, mode: "average" });
  if (keys.some((k) => k[0] % timeMs)) throw Error("Unaligned tile key");
  const minBlock = Math.min(...keys.map((k) => k[2])), maxBlock = Math.max(...keys.map((k) => k[2]));
  if (maxBlock - minBlock > 8) throw Error("Price tile span budget");
  const manifests = await manifestsFor(min, max + timeMs, timeMs, rowPrice, void 0, feed);
  const chosen = [];
  for (const [from, revision] of keys) {
    const m = manifests.find((m2) => m2.from === from);
    if (!m || m.revision !== revision) return { status: 409, error: "Historical revision changed; refresh manifest" };
    if (!chosen.includes(m)) chosen.push(m);
  }
  const buckets = await readBuckets(chosen, minBlock * PRICE_BLOCK_ROWS * rowPrice, (maxBlock + 1) * PRICE_BLOCK_ROWS * rowPrice), dbMs = performance4.now() - begin;
  const tiles = keys.map(([from, revision, block]) => {
    const b = buckets.find((b2) => b2.from === from);
    return { version: HISTORY_VERSION, feed, timeMs, rowPrice, from, to: from + timeMs, revision, block, cursor: b.cursor, cells: projectBucket(b, block * PRICE_BLOCK_ROWS * rowPrice, (block + 1) * PRICE_BLOCK_ROWS * rowPrice) };
  });
  return { version: HISTORY_VERSION, market, feed, tiles, timings: { dbMs, projectMs: performance4.now() - begin - dbMs, totalMs: performance4.now() - begin }, rawReplay: false };
}
async function currentHistory(p, marketValue = "perpetual") {
  const market = backendMarket(marketValue), feed = historyFeed(market), begin = performance4.now(), data = await internal(`/current?rowPrice=${p.rowPrice}&timeMs=${p.timeMs}&low=${p.low}&high=${p.high}`, marketValue);
  if (!data.bucket) return { ...data, market, feed, rawReplay: false };
  const b = data.bucket;
  return { version: HISTORY_VERSION, market, feed, state: data.state, bucket: { from: b.from, to: b.to, rowPrice: b.rowPrice, timeMs: p.timeMs, revision: b.cursor, cells: projectBucket(b, p.low, p.high) }, head: data.head, lagMs: data.lagMs, rawReplay: false, timings: { totalMs: performance4.now() - begin } };
}

// src/order-walls-api.ts
var ORDER_WALL_MAX_LEVELS_PER_SIDE = 5e3;
var ORDER_WALL_DEFAULT_PAGE_SIZE = 256;
var ORDER_WALL_MAX_PAGE_SIZE = 1e3;
var MAX_PAGE_GROUP = 5e3;
var MAX_REPLAY_RECORDS = 5e4;
var MAX_REPLAY_BYTES2 = 64 * 1024 * 1024;
var MAX_PREWINDOW_RECORDS = 5e3;
var metadataSettings = " SETTINGS max_threads=2,max_block_size=256,max_result_bytes=16777216,result_overflow_mode='throw'";
function sourceContext(marketValue) {
  const config2 = marketConfig(marketValue);
  return {
    config: config2,
    table: config2.depthTable,
    source: `venue='binance' AND market='${config2.market}' AND nativeSymbol='BTCUSDT' AND feed='${config2.depthFeed}'`,
    snapshotLimit: config2.market === "spot" ? 5e3 : 1e3
  };
}
function numericPrice(price) {
  return Number(price);
}
function positive(value) {
  return value !== void 0 && Number(value) > 0;
}
function validPair(pair) {
  return Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && /^\d+(\.\d{1,8})?$/.test(pair[0]) && Number(pair[0]) > 0 && typeof pair[1] === "string" && /^\d+(\.\d{1,8})?$/.test(pair[1]) && Number(pair[1]) >= 0;
}
function validPairs(value, label) {
  if (!Array.isArray(value) || value.length > 2e5 || !value.every(validPair)) throw new Error(`Invalid retained ${label} levels`);
  return value;
}
var PriceHeap = class {
  constructor(higher, values = []) {
    this.higher = higher;
    this.values = values.slice();
    for (let i = (this.values.length >> 1) - 1; i >= 0; i--) this.down(i);
  }
  values;
  get size() {
    return this.values.length;
  }
  peek() {
    return this.values[0];
  }
  push(value) {
    let i = this.values.length;
    this.values.push(value);
    while (i > 0) {
      const parent = i - 1 >> 1;
      if (this.higher(this.values[parent], value)) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = value;
  }
  pop() {
    if (!this.values.length) return void 0;
    const root = this.values[0], last = this.values.pop();
    if (this.values.length) {
      this.values[0] = last;
      this.down(0);
    }
    return root;
  }
  down(start) {
    let i = start;
    const value = this.values[i], n = this.values.length;
    while (true) {
      let child = i * 2 + 1;
      if (child >= n) break;
      if (child + 1 < n && this.higher(this.values[child + 1], this.values[child])) child++;
      if (this.higher(value, this.values[child])) break;
      this.values[i] = this.values[child];
      i = child;
    }
    this.values[i] = value;
  }
};
var OrderWallBookProjection = class {
  constructor(maxLevels = ORDER_WALL_MAX_LEVELS_PER_SIDE, sourceSnapshotLimit = 1e3) {
    this.maxLevels = maxLevels;
    this.sourceSnapshotLimit = sourceSnapshotLimit;
  }
  bids = /* @__PURE__ */ new Map();
  asks = /* @__PURE__ */ new Map();
  bidTop = /* @__PURE__ */ new Set();
  askTop = /* @__PURE__ */ new Set();
  bidOutside = new PriceHeap((a, b) => numericPrice(a) > numericPrice(b));
  askOutside = new PriceHeap((a, b) => numericPrice(a) < numericPrice(b));
  bidBoundary = new PriceHeap((a, b) => numericPrice(a) < numericPrice(b));
  askBoundary = new PriceHeap((a, b) => numericPrice(a) > numericPrice(b));
  positiveBids = 0;
  positiveAsks = 0;
  epoch = 0;
  at = 0;
  sequence = 0;
  bidFloor = 0;
  askCeiling = 0;
  bridged = false;
  snapshotLevels = { bids: 1e3, asks: 1e3 };
  restore(payload, epoch, at, kind) {
    if (!payload || payload.version !== 1 || !Number.isSafeInteger(payload.sequence) || !Number.isSafeInteger(payload.at) || !Number.isFinite(payload.bidFloor) || payload.bidFloor <= 0 || !Number.isFinite(payload.askCeiling) || payload.askCeiling <= 0) {
      throw new Error("Invalid retained depth seed");
    }
    const bids = validPairs(payload.bids, "bid"), asks = validPairs(payload.asks, "ask");
    if (bids.length + asks.length > 2e5) throw new Error("Retained depth seed exceeds observed-book budget");
    this.bids.clear();
    this.asks.clear();
    this.bidTop.clear();
    this.askTop.clear();
    for (const [price, quantity] of bids) this.bids.set(price, quantity);
    for (const [price, quantity] of asks) this.asks.set(price, quantity);
    Object.assign(this, {
      epoch,
      at,
      sequence: payload.sequence,
      bidFloor: payload.bidFloor,
      askCeiling: payload.askCeiling,
      bridged: kind !== "snapshot",
      snapshotLevels: payload.snapshotLevels && Number.isSafeInteger(payload.snapshotLevels.bids) && payload.snapshotLevels.bids >= 0 && Number.isSafeInteger(payload.snapshotLevels.asks) && payload.snapshotLevels.asks >= 0 ? { bids: payload.snapshotLevels.bids, asks: payload.snapshotLevels.asks } : { bids: this.sourceSnapshotLimit, asks: this.sourceSnapshotLimit }
    });
    this.positiveBids = [...this.bids.values()].filter(positive).length;
    this.positiveAsks = [...this.asks.values()].filter(positive).length;
    this.rebuildSide("bids");
    this.rebuildSide("asks");
  }
  apply(payload, epoch, at) {
    if (epoch !== this.epoch) throw new Error("Depth epoch changed without a seed");
    if (!payload || ![payload.U, payload.u, payload.pu].every(Number.isSafeInteger) || payload.U > payload.u || payload.u < 0) throw new Error("Invalid retained depth delta");
    if (payload.u < this.sequence || this.bridged && payload.u === this.sequence) return { bids: [], asks: [] };
    if (!this.bridged) {
      if (!(payload.U <= this.sequence && payload.u >= this.sequence)) throw new Error("Snapshot bridge unavailable");
    } else if (payload.pu !== this.sequence) throw new Error("Diff-depth continuity gap");
    const bidUpdates = new Map(validPairs(payload.b, "delta bid").map((pair) => pair));
    const askUpdates = new Map(validPairs(payload.a, "delta ask").map((pair) => pair));
    const beforeBidTop = new Set(this.bidTop), beforeAskTop = new Set(this.askTop);
    const previousBids = new Map([...bidUpdates.keys()].map((price) => [price, this.bids.get(price)]));
    const previousAsks = new Map([...askUpdates.keys()].map((price) => [price, this.asks.get(price)]));
    for (const [price, quantity] of bidUpdates) this.setLevel("bids", price, quantity);
    for (const [price, quantity] of askUpdates) this.setLevel("asks", price, quantity);
    if (this.bids.size + this.asks.size > 2e5) throw new Error("Observed book capacity exceeded");
    this.sequence = payload.u;
    this.at = Math.max(this.at, at);
    this.bridged = true;
    return {
      bids: projectedDiff(beforeBidTop, this.bidTop, this.bids, previousBids),
      asks: projectedDiff(beforeAskTop, this.askTop, this.asks, previousAsks)
    };
  }
  topPairs(side) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    return [...top].sort((a, b) => side === "bids" ? numericPrice(b) - numericPrice(a) : numericPrice(a) - numericPrice(b)).map((price) => [price, levels.get(price)]);
  }
  scope() {
    const bids = this.bids.size, asks = this.asks.size;
    const bidCount = this.positiveBids, askCount = this.positiveAsks;
    return {
      maxLevelsPerSide: this.maxLevels,
      membership: "exact-observed",
      snapshotLevels: { ...this.snapshotLevels },
      bids: {
        observedLevels: bidCount,
        returnedLevels: this.bidTop.size,
        complete: bidCount <= this.maxLevels,
        truncated: bidCount > this.maxLevels,
        lowerBound: this.bidFloor,
        storedLevels: bids
      },
      asks: {
        observedLevels: askCount,
        returnedLevels: this.askTop.size,
        complete: askCount <= this.maxLevels,
        truncated: askCount > this.maxLevels,
        upperBound: this.askCeiling,
        storedLevels: asks
      },
      outerCoverage: "snapshot-bounded"
    };
  }
  setLevel(side, price, quantity) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    const previous = levels.get(price);
    if (positive(previous) && !positive(quantity)) side === "bids" ? this.positiveBids-- : this.positiveAsks--;
    else if (!positive(previous) && positive(quantity)) side === "bids" ? this.positiveBids++ : this.positiveAsks++;
    levels.set(price, quantity);
    const outside = side === "bids" ? this.bidOutside : this.askOutside;
    const boundary = side === "bids" ? this.bidBoundary : this.askBoundary;
    if (top.has(price)) {
      if (!positive(quantity)) {
        top.delete(price);
        this.promote(side);
      }
    } else if (positive(quantity)) {
      if (top.size < this.maxLevels) this.addTop(side, price);
      else {
        const worst = this.peekBoundary(side);
        const better = worst !== void 0 && (side === "bids" ? numericPrice(price) > numericPrice(worst) : numericPrice(price) < numericPrice(worst));
        if (better) {
          top.delete(worst);
          outside.push(worst);
          this.addTop(side, price);
        } else outside.push(price);
      }
    }
    this.compactIfNeeded(side, outside, boundary);
  }
  addTop(side, price) {
    const top = side === "bids" ? this.bidTop : this.askTop;
    const boundary = side === "bids" ? this.bidBoundary : this.askBoundary;
    top.add(price);
    boundary.push(price);
  }
  promote(side) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    const outside = side === "bids" ? this.bidOutside : this.askOutside;
    while (top.size < this.maxLevels && outside.size) {
      const price = outside.pop();
      if (!top.has(price) && positive(levels.get(price))) this.addTop(side, price);
    }
  }
  peekBoundary(side) {
    const top = side === "bids" ? this.bidTop : this.askTop;
    const heap = side === "bids" ? this.bidBoundary : this.askBoundary;
    while (heap.size && !top.has(heap.peek())) heap.pop();
    return heap.peek();
  }
  peekOutside(side) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    const heap = side === "bids" ? this.bidOutside : this.askOutside;
    while (heap.size && (top.has(heap.peek()) || !positive(levels.get(heap.peek())))) heap.pop();
    return heap.peek();
  }
  rebuildSide(side) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    const better = side === "bids" ? (a, b) => numericPrice(b) - numericPrice(a) : (a, b) => numericPrice(a) - numericPrice(b);
    const worse = side === "bids" ? (a, b) => numericPrice(a) < numericPrice(b) : (a, b) => numericPrice(a) > numericPrice(b);
    const isBetter = side === "bids" ? (a, b) => numericPrice(a) > numericPrice(b) : (a, b) => numericPrice(a) < numericPrice(b);
    const sorted = [...levels].filter(([, quantity]) => positive(quantity)).map(([price]) => price).sort(better);
    const selected = sorted.slice(0, this.maxLevels);
    top.clear();
    for (const price of selected) top.add(price);
    const outside = sorted.slice(this.maxLevels);
    const boundary = side === "bids" ? new PriceHeap(worse, selected) : new PriceHeap(worse, selected);
    const candidate = side === "bids" ? new PriceHeap(isBetter, outside) : new PriceHeap(isBetter, outside);
    if (side === "bids") {
      this.bidBoundary = boundary;
      this.bidOutside = candidate;
    } else {
      this.askBoundary = boundary;
      this.askOutside = candidate;
    }
  }
  compactIfNeeded(side, outside, boundary) {
    const levels = side === "bids" ? this.bids : this.asks;
    const top = side === "bids" ? this.bidTop : this.askTop;
    if (outside.size > levels.size * 2 + this.maxLevels || boundary.size > top.size * 2 + 1024) this.rebuildSide(side);
  }
};
function projectedDiff(previous, next, levels, previousQuantities) {
  const out = [];
  for (const price of previous) if (!next.has(price)) out.push([price, "0"]);
  for (const price of next) {
    if (!previous.has(price)) out.push([price, levels.get(price)]);
    else if (previousQuantities.has(price) && previousQuantities.get(price) !== levels.get(price)) out.push([price, levels.get(price)]);
  }
  return out.sort((a, b) => numericPrice(a[0]) - numericPrice(b[0]));
}
function meta(row) {
  return { cursor: Number(row.cursor), epoch: Number(row.epoch), at: Number(row.at), kind: row.kind };
}
async function metadata(context, sqlWhere, order = "cursor DESC", limit = 1, queryRows = query) {
  const rows = await queryRows(`SELECT cursor,epoch,at,kind FROM iqterminal.${context.table} FINAL WHERE ${context.source} AND ${sqlWhere} ORDER BY ${order} LIMIT ${limit}${metadataSettings}`);
  return rows.map(meta);
}
async function maxCursor(context, queryRows) {
  const rows = await queryRows(`SELECT max(cursor) AS cursor FROM iqterminal.${context.table} WHERE ${context.source} SETTINGS max_threads=2,max_block_size=256,max_result_bytes=1048576,result_overflow_mode='throw'`);
  return rows[0]?.cursor == null ? 0 : Number(rows[0].cursor);
}
async function exactCursor(context, cursor, queryRows) {
  const rows = await metadata(context, `cursor=${cursor}`, "cursor ASC", 2, queryRows);
  if (rows.length > 1) throw new Error("Depth cursor maps to multiple retained records");
  return rows[0];
}
async function payloads(context, keys, queryRows = query) {
  if (!keys.length) return [];
  if (keys.length > MAX_REPLAY_RECORDS) throw new Error("Order Wall replay page budget");
  const tuples = keys.map((row) => `(${row.epoch},${row.cursor})`).join(",");
  const earliestAt = keys.reduce((earliest, row) => Math.min(earliest, row.at), Number.POSITIVE_INFINITY);
  const latestAt = keys.reduce((latest, row) => Math.max(latest, row.at), 0);
  const partitions = dateRange(earliestAt, latestAt + 1);
  const rows = await queryRows(`SELECT cursor,epoch,at,kind,payload FROM iqterminal.${context.table} FINAL PREWHERE (epoch,cursor) IN (${tuples}) AND ${partitions} WHERE ${context.source} ORDER BY cursor SETTINGS max_threads=2,max_block_size=256,max_result_bytes=${MAX_REPLAY_BYTES2},result_overflow_mode='throw'`);
  const records = rows.map((row) => ({ ...meta(row), payload: JSON.parse(row.payload) }));
  const bytes = rows.reduce((n, row) => n + Buffer.byteLength(row.payload), 0);
  if (bytes > MAX_REPLAY_BYTES2) throw new Error("Order Wall replay byte budget exceeded");
  return records;
}
function dateRange(from, to) {
  return `date>=toDate(toDateTime(intDiv(${from},1000))) AND date<=toDate(toDateTime(intDiv(${to - 1},1000)))`;
}
function restoreRecord(context, row) {
  if (row.kind !== "snapshot" && row.kind !== "checkpoint") throw new Error("Depth seed is unavailable");
  const book = new OrderWallBookProjection(ORDER_WALL_MAX_LEVELS_PER_SIDE, context.snapshotLimit);
  book.restore(row.payload, row.epoch, row.at, row.kind);
  return book;
}
function observationFromSeed(row, book) {
  return { at: row.at, cursor: row.cursor, epoch: row.epoch, bids: book.topPairs("bids"), asks: book.topPairs("asks"), bookScope: book.scope() };
}
function applyRow(context, book, row) {
  if (row.kind === "gap") return { book: void 0, observation: { ...meta(row), kind: "gap", reason: String(row.payload?.reason ?? "Depth continuity unavailable") } };
  if (row.kind === "snapshot" || row.kind === "checkpoint") {
    const next = restoreRecord(context, row);
    return { book: next, observation: { ...meta(row), ...observationFromSeed(row, next) } };
  }
  if (!book) return { observation: { ...meta(row), kind: "delta", reason: "No retained checkpoint after the last continuity gap" } };
  try {
    const levels = book.apply(row.payload, row.epoch, row.at);
    return { book, observation: { ...meta(row), ...levels, bookScope: book.scope() } };
  } catch (error) {
    return { book: void 0, observation: { ...meta(row), kind: "gap", reason: `Stored depth continuity unavailable: ${error.message}` } };
  }
}
function recordCountWithin(rowCount) {
  if (rowCount > MAX_REPLAY_RECORDS) throw new Error("Order Wall replay requires a smaller range");
}
function pagePrefix(rows, limit) {
  const page = rows.slice(0, limit), hasMore = rows.length > limit;
  const boundaryAt = hasMore && page.length && rows[limit].at === page.at(-1).at ? page.at(-1).at : void 0;
  return { page, hasMore, boundaryAt };
}
var pageCache = /* @__PURE__ */ new Map();
var pagePending = /* @__PURE__ */ new Map();
async function depthObservations(request, queryRows = query) {
  const context = sourceContext(request.market ?? "perpetual");
  const limit = request.limit ?? ORDER_WALL_DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(request.from) || !Number.isSafeInteger(request.to) || request.from <= 0 || request.to <= request.from || request.to - request.from > 144e5) throw new Error("Invalid bounded [from,to) millisecond range");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ORDER_WALL_MAX_PAGE_SIZE) throw new Error("Invalid Order Wall page limit");
  const after = request.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid depth cursor");
  const maxDurableCursor = await maxCursor(context, queryRows);
  const watermark = request.watermark === void 0 ? maxDurableCursor : request.watermark;
  if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error("Invalid depth watermark");
  if (watermark > maxDurableCursor) throw new Error("Depth watermark beyond durable head");
  const durableHead = watermark === maxDurableCursor && watermark > 0 ? await exactCursor(context, maxDurableCursor, queryRows) : void 0;
  const key = [context.config.market, request.from, request.to, watermark, after, limit].join(":");
  const cacheable = queryRows === query;
  const cached = cacheable ? pageCache.get(key) : void 0;
  if (cached && Date.now() - cached.at < 2e3) return cached.value;
  const pending = cacheable ? pagePending.get(key) : void 0;
  if (pending) return pending;
  const load = loadPage(context, { ...request, watermark, after, limit }, queryRows, durableHead).then((value) => {
    if (cacheable) {
      if (pageCache.size >= 16) pageCache.delete(pageCache.keys().next().value);
      pageCache.set(key, { at: Date.now(), value });
    }
    return value;
  }).finally(() => {
    if (cacheable) pagePending.delete(key);
  });
  if (cacheable) pagePending.set(key, load);
  return load;
}
async function loadPage(context, request, queryRows, durableHead) {
  const emptyHead = { cursor: 0, at: 0, epoch: 0 };
  const head = request.watermark === 0 ? emptyHead : durableHead?.cursor === request.watermark ? durableHead : await exactCursor(context, request.watermark, queryRows);
  if (request.watermark && (!head || head.cursor !== request.watermark)) throw new Error("Depth watermark not retained");
  const confirmedHead = head ?? emptyHead;
  if (request.after > request.watermark) throw new Error("Depth cursor beyond watermark");
  const initial = request.after === 0;
  let effectiveAfter = request.after;
  let selectedSeed;
  let book;
  let pageSeed;
  let warmupRows = [];
  const warmupObservations = [];
  const syntheticGaps = [];
  let coverageGap;
  let continuationCursor;
  if (initial) {
    const seedMeta = (await metadata(context, `cursor<=${request.watermark} AND at<=${request.from} AND date<=toDate(toDateTime(intDiv(${request.from},1000))) AND kind IN ('snapshot','checkpoint')`, "cursor DESC", 1, queryRows))[0];
    if (seedMeta) {
      [selectedSeed] = await payloads(context, [seedMeta], queryRows);
      effectiveAfter = selectedSeed.cursor;
      book = restoreRecord(context, selectedSeed);
      pageSeed = { ...observationFromSeed(selectedSeed, book) };
      const replayKeys = await metadata(context, `epoch=${seedMeta.epoch} AND cursor>${seedMeta.cursor} AND cursor<=${request.watermark} AND at<${request.from}`, "cursor ASC", MAX_PREWINDOW_RECORDS + 1, queryRows);
      if (replayKeys.length > MAX_PREWINDOW_RECORDS) throw new Error("Order Wall pre-window history exceeds its record budget");
      warmupRows = await payloads(context, replayKeys, queryRows);
      for (const row of warmupRows) {
        const result = applyRow(context, book, row);
        book = result.book;
        warmupObservations.push(result.observation);
        if (row.kind !== "gap" && result.observation.kind === "gap") {
          const gap = { cursor: row.cursor, at: row.at, epoch: row.epoch, reason: result.observation.reason ?? "Depth continuity unavailable" };
          syntheticGaps.push(gap);
          coverageGap ??= { ...gap, reason: "Depth continuity gap before requested start" };
        } else if (row.kind === "gap") {
          coverageGap ??= { cursor: row.cursor, at: row.at, epoch: row.epoch, reason: "Depth continuity gap before requested start" };
        }
      }
    } else {
      effectiveAfter = 0;
      const lastGap = (await metadata(context, `cursor<=${request.watermark} AND at<${request.from} AND date<=toDate(toDateTime(intDiv(${request.from},1000))) AND kind='gap'`, "cursor DESC", 1, queryRows))[0];
      if (lastGap) coverageGap = { ...lastGap, reason: "No retained checkpoint after the last continuity gap" };
    }
  } else {
    if (request.after) {
      continuationCursor = await exactCursor(context, request.after, queryRows);
      if (!continuationCursor) throw new Error("Depth continuation cursor not retained");
      const cursorRow = continuationCursor;
      const seedMeta = (await metadata(context, `epoch=${cursorRow.epoch} AND cursor<=${request.after} AND kind IN ('snapshot','checkpoint')`, "cursor DESC", 1, queryRows))[0];
      if (seedMeta) {
        const lastGap = (await metadata(context, `cursor>${seedMeta.cursor} AND cursor<=${request.after} AND kind='gap'`, "cursor DESC", 1, queryRows))[0];
        if (lastGap) coverageGap = { ...lastGap, reason: "Depth continuity gap before page cursor" };
        else {
          const [seedRow] = await payloads(context, [seedMeta], queryRows);
          book = restoreRecord(context, seedRow);
          const replayKeys = await metadata(context, `epoch=${seedMeta.epoch} AND cursor>${seedMeta.cursor} AND cursor<=${request.after} AND kind='delta'`, "cursor ASC", MAX_REPLAY_RECORDS + 1, queryRows);
          recordCountWithin(replayKeys.length);
          const replayRows = await payloads(context, replayKeys, queryRows);
          for (const row of replayRows) {
            const result = applyRow(context, book, row);
            book = result.book;
            if (row.kind !== "gap" && result.observation.kind === "gap") {
              const gap = { cursor: row.cursor, at: row.at, epoch: row.epoch, reason: result.observation.reason ?? "Depth continuity unavailable" };
              syntheticGaps.push(gap);
              coverageGap ??= { ...gap, reason: "Depth continuity gap before page cursor" };
            }
          }
        }
      } else coverageGap = { ...cursorRow, reason: "No retained checkpoint in the continuation epoch" };
    }
  }
  const startValid = !!book;
  let pageAfter = effectiveAfter;
  const pageWhere = `cursor>${pageAfter} AND cursor<=${request.watermark} AND at>=${request.from} AND at<${request.to} AND ${dateRange(request.from, request.to)}`;
  const candidates = await metadata(context, pageWhere, "cursor ASC", request.limit + 1, queryRows);
  const prefix = pagePrefix(candidates, request.limit);
  let pageMetas = prefix.page;
  let hasMore = prefix.hasMore;
  if (prefix.boundaryAt !== void 0) {
    const sameAt = prefix.boundaryAt;
    const extra = await metadata(context, `cursor>${pageMetas.at(-1).cursor} AND cursor<=${request.watermark} AND at=${sameAt} AND ${dateRange(sameAt, sameAt + 1)}`, "cursor ASC", MAX_PAGE_GROUP + 1, queryRows);
    if (pageMetas.length + extra.length > MAX_PAGE_GROUP) throw new Error("Same-millisecond observation group exceeds the page budget; request a narrower range");
    pageMetas = [...pageMetas, ...extra];
    const afterGroup = pageMetas.at(-1).cursor;
    hasMore = (await metadata(context, `cursor>${afterGroup} AND cursor<=${request.watermark} AND at>=${request.from} AND at<${request.to} AND ${dateRange(request.from, request.to)}`, "cursor ASC", 1, queryRows)).length > 0;
  }
  recordCountWithin(pageMetas.length);
  const rows = await payloads(context, pageMetas, queryRows);
  const observations = [...warmupObservations];
  for (const row of rows) {
    const result = applyRow(context, book, row);
    book = result.book;
    observations.push(result.observation);
    if (row.kind !== "gap" && result.observation.kind === "gap") syntheticGaps.push({ cursor: row.cursor, at: row.at, epoch: row.epoch, reason: result.observation.reason ?? "Depth continuity unavailable" });
  }
  const nextAfter = rows.at(-1)?.cursor ?? warmupRows.at(-1)?.cursor ?? pageAfter;
  const earliestRows = request.watermark === 0 ? [] : await queryRows(`SELECT min(at) AS at FROM iqterminal.${context.table}`);
  const earliestRetainedAt = earliestRows[0]?.at == null ? null : Number(earliestRows[0].at);
  const rangeGaps = await metadata(context, `cursor<=${request.watermark} AND at>=${request.from} AND at<${request.to} AND ${dateRange(request.from, request.to)} AND kind='gap'`, "cursor ASC", 257, queryRows);
  const gapByCursor = /* @__PURE__ */ new Map();
  for (const gap of rangeGaps) gapByCursor.set(`${gap.epoch}:${gap.cursor}`, { ...gap, reason: "Depth continuity unavailable" });
  for (const gap of syntheticGaps) gapByCursor.set(`${gap.epoch}:${gap.cursor}`, gap);
  if (coverageGap) gapByCursor.set(`${coverageGap.epoch}:${coverageGap.cursor}`, coverageGap);
  const allGaps = [...gapByCursor.values()].sort((a, b) => a.cursor - b.cursor);
  const gaps = allGaps.slice(0, 256);
  const expired = earliestRetainedAt !== null && request.from < earliestRetainedAt;
  const reason = expired ? "Requested history predates the retained depth source" : !startValid ? coverageGap?.reason ?? "No retained checkpoint at requested start" : gaps.length ? "Depth continuity gaps are present in the requested range" : request.to > confirmedHead.at ? "Durable depth watermark has not confirmed the requested tail" : void 0;
  return {
    version: 1,
    market: context.config.market,
    instrument: context.config.instrument,
    feed: context.config.depthFeed,
    from: request.from,
    to: request.to,
    watermark: request.watermark,
    head: confirmedHead,
    page: {
      after: pageAfter,
      nextAfter,
      hasMore,
      lastAt: rows.at(-1)?.at ?? warmupRows.at(-1)?.at ?? null,
      limit: request.limit,
      observations: observations.length,
      sameMillisecondClosed: true
    },
    ...pageSeed ? { seed: pageSeed } : {},
    observations,
    coverage: {
      requestedFrom: request.from,
      requestedTo: request.to,
      seedAt: initial ? pageSeed?.at ?? null : null,
      seedEpoch: initial ? pageSeed?.epoch ?? null : null,
      confirmedTo: Math.min(request.to, confirmedHead.at),
      earliestRetainedAt,
      gaps,
      gapsTruncated: rangeGaps.length > 256 || allGaps.length > 256,
      partial: expired || !startValid || request.to > confirmedHead.at || gaps.length > 0 || rangeGaps.length > 256 || allGaps.length > 256,
      ...reason ? { reason } : {}
    }
  };
}

// src/http-compression.ts
import { gzip as gzip5 } from "node:zlib";
import { promisify as promisify7 } from "node:util";
var gzipAsync = promisify7(gzip5);
async function encodeHttpBody(input, acceptEncoding, minimumGzipBytes = 0, level = 1) {
  const raw = Buffer.from(input);
  if (!Number.isSafeInteger(minimumGzipBytes) || minimumGzipBytes < 0) throw new Error("Invalid gzip threshold");
  if (raw.length <= minimumGzipBytes || !/\bgzip\b/.test(acceptEncoding ?? "")) {
    return { body: raw, headers: { "Content-Length": String(raw.length) } };
  }
  const body = await gzipAsync(raw, { level });
  return { body, headers: { "Content-Length": String(body.length), "Content-Encoding": "gzip", Vary: "Accept-Encoding" } };
}

// src/history-gateway.ts
var port = Number(process.env.API_PORT ?? 18780);
var collectorPort = Number(process.env.COLLECTOR_PORT ?? 18784);
var spotCollectorPort = Number(process.env.SPOT_COLLECTOR_PORT ?? 18785);
var historyPort = Number(process.env.HISTORY_PORT ?? 18782);
var enabled = process.env.HISTORY_TILES_ENABLED !== "0";
var admission = new GatewayAdmission();
var metrics = { requests: 0, rejected: 0, bytes: 0, serializeMs: 0, legacyHeatmap: 0, legacyFootprint: 0, closedTileReads: 0, manifests: 0, orderWallPages: 0, peakRss: 0 };
function proxy(req, res, targetOverride, onDone, pathOverride) {
  const start = performance5.now();
  if (req.url?.startsWith("/v1/heatmap?")) metrics.legacyHeatmap++;
  if (req.url?.startsWith("/v1/footprints?")) metrics.legacyFootprint++;
  let targetPort = targetOverride ?? (req.url?.startsWith("/v1/liquidations") ? Number(process.env.LIQUIDATION_PORT ?? 18787) : req.url?.startsWith("/v1/effort-result") ? Number(process.env.EFFORT_PORT ?? 18786) : collectorPort);
  try {
    if (targetOverride === void 0 && new URL(req.url ?? "/", `http://127.0.0.1:${port}`).searchParams.get("market") === "spot") targetPort = spotCollectorPort;
  } catch {
  }
  let completed = false;
  const done = () => {
    if (completed) return;
    completed = true;
    onDone?.();
  };
  res.once("finish", done);
  res.once("close", done);
  const upstream = http2.request({ hostname: "127.0.0.1", port: targetPort, path: pathOverride ?? req.url, method: req.method, headers: req.headers, timeout: 3e4 }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, "server-timing": `${r.headers["server-timing"] ?? ""}${r.headers["server-timing"] ? ", " : ""}legacy;dur=${(performance5.now() - start).toFixed(2)}` });
    r.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"error":"Collection API unavailable"}');
  });
  upstream.on("timeout", () => upstream.destroy());
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}
var server = http2.createServer(async (req, res) => {
  let url2;
  try {
    url2 = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  } catch {
    res.writeHead(400);
    res.end('{"error":"Invalid request URL"}');
    return;
  }
  const viewId = typeof req.headers["x-iq-view-id"] === "string" && /^[a-zA-Z0-9_:.-]{1,120}$/.test(req.headers["x-iq-view-id"]) ? req.headers["x-iq-view-id"] : void 0;
  const requestId = randomUUID();
  req.headers["x-iq-request-id"] = requestId;
  res.setHeader("X-IQ-Request-Id", requestId);
  if (viewId) res.setHeader("X-IQ-View-Id", viewId);
  const managed = isManagedHistoryPath(url2.pathname);
  if (managed) {
    const release = admission.acquire(isCurrentHistoryPath(url2.pathname));
    if (!release) {
      metrics.rejected++;
      res.writeHead(503, { "Retry-After": "1", "Content-Type": "application/json" });
      res.end('{"error":"Historical read capacity reserved for current data; retry"}');
      return;
    }
    res.once("finish", release);
    res.once("close", release);
    metrics.requests++;
  }
  if (url2.pathname === "/v2/history/footprint-current") {
    try {
      const market = backendMarket(url2.searchParams.get("market"));
      url2.pathname = "/current";
      proxy(req, res, market === "spot" ? 18789 : 18788, void 0, url2.pathname + url2.search);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (url2.pathname === "/v1/depth-observations") {
    const started2 = performance5.now();
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("{}");
      return;
    }
    metrics.orderWallPages++;
    const abort2 = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) abort2.abort();
    });
    const timing2 = { priority: isCurrentHistoryPath(url2.pathname) ? "current" : "visible", signal: abort2.signal, dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId };
    await queryTiming.run(timing2, async () => {
      try {
        const p = url2.searchParams, allowed = ["from", "to", "watermark", "after", "limit", "market"];
        for (const key of p.keys()) if (!allowed.includes(key) || p.getAll(key).length !== 1) throw Error("Unknown/duplicate depth parameter");
        if (!p.has("from") || !p.has("to")) throw Error("Invalid bounded [from,to) millisecond range");
        const market = backendMarket(p.get("market") ?? "perpetual");
        const data = await depthObservations({
          from: Number(p.get("from")),
          to: Number(p.get("to")),
          watermark: p.has("watermark") ? Number(p.get("watermark")) : void 0,
          after: p.has("after") ? Number(p.get("after")) : void 0,
          limit: p.has("limit") ? Number(p.get("limit")) : ORDER_WALL_DEFAULT_PAGE_SIZE,
          market
        });
        const text = JSON.stringify(data);
        if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error("Order Wall response byte budget");
        const encoded = await encodeHttpBody(text, req.headers["accept-encoding"], 4096), body = encoded.body;
        const serializeMs = performance5.now() - started2;
        metrics.serializeMs += serializeMs;
        metrics.bytes += body.length;
        metrics.peakRss = Math.max(metrics.peakRss, process.memoryUsage().rss);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...encoded.headers,
          "Content-Length": body.length,
          "X-IQ-Decoded-Bytes": Buffer.byteLength(text),
          "X-IQ-Db-Queries": timing2.queries,
          "X-IQ-Db-Read-Rows": timing2.readRows,
          "X-IQ-Db-Read-Bytes": timing2.readBytes,
          "Server-Timing": `admission;dur=0, db;dur=${timing2.dbMs.toFixed(2)}, sqlqueue;dur=${(timing2.sqlQueueMs ?? 0).toFixed(2)}, dbdecode;dur=${timing2.decodeMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}, total;dur=${(performance5.now() - started2).toFixed(2)}`
        });
        res.end(body);
      } catch (e) {
        const invalid = /Invalid|budget|aligned|Unsupported|Unknown|duplicate|retained|cursor|watermark|range|millisecond/i.test(e.message);
        if (!res.headersSent) res.writeHead(invalid ? 400 : 503, { "Content-Type": "application/json", "Retry-After": "1" });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
      }
    });
    return;
  }
  if (url2.pathname === "/v1/order-walls/archive" || url2.pathname === "/v1/order-walls/archive/current") {
    const market = url2.searchParams.get("market");
    if (market !== null && market !== "spot" && market !== "perpetual") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end('{"error":"Unsupported market; expected spot or perpetual"}');
      return;
    }
    metrics.orderWallPages++;
    proxy(req, res, historyPort);
    return;
  }
  if (!url2.pathname.startsWith("/v2/history/")) {
    proxy(req, res);
    return;
  }
  const started = performance5.now();
  if (!enabled) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (url2.pathname === WALL_PREPARATION_CANCEL_PATH) {
    if (process.env.WALL_PREPARATION_ENABLED !== "1") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method !== "DELETE") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      for (const key of url2.searchParams.keys()) if (key !== "consumer" || url2.searchParams.getAll(key).length !== 1) throw Error("Invalid wall preparation cancellation");
      const data = await wallPreparationCommand("/release", { consumer: url2.searchParams.get("consumer") ?? "" });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(/Invalid/.test(error.message) ? 400 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (url2.pathname === WALL_READ_LEASE_PATH) {
    if (process.env.WALL_PREPARATION_ENABLED !== "1") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      if (url2.search) throw Error("Invalid wall reader parameters");
      req.setTimeout(2e3, () => req.destroy());
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) throw Error("Invalid wall reader command size");
        chunks.push(chunk);
      }
      const result = await wallPreparationCommand("/retain", JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-IQ-Db-Queries": "0", "X-IQ-Db-Read-Rows": "0", "X-IQ-Db-Read-Bytes": "0", "Server-Timing": `readercontrol;dur=${(performance5.now() - started).toFixed(2)}` });
      res.end(JSON.stringify(result));
    } catch (error) {
      if (!res.headersSent) res.writeHead(/Invalid|JSON/.test(error.message) ? 400 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error.message).slice(0, 500) }));
    }
    return;
  }
  if (url2.pathname === FOOTPRINT_BATCH_PATH) {
    const abort2 = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) abort2.abort();
    });
    const timing2 = { priority: "visible", signal: abort2.signal, dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId };
    await queryTiming.run(timing2, () => serveFootprintBatch(req, res, { signal: abort2.signal, onMetrics: (value) => {
      metrics.bytes += value.encodedBytes;
      metrics.serializeMs += value.serializeMs;
      metrics.peakRss = Math.max(metrics.peakRss, process.memoryUsage().rss);
    } }));
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  const abort = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const timing = { priority: isCurrentHistoryPath(url2.pathname) ? "current" : "visible", signal: abort.signal, dbMs: 0, decodeMs: 0, queries: 0, bytes: 0, readRows: 0, readBytes: 0, sqlQueueMs: 0, requestId };
  await queryTiming.run(timing, async () => {
    try {
      const u = url2;
      let data;
      if (u.pathname === WALL_MANIFEST_PATH || u.pathname === WALL_PART_PATH || u.pathname === WALL_BATCH_PATH || u.pathname === WALL_PROJECTION_BATCH_PATH) {
        const reader = typeof req.headers["x-iq-wall-reader"] === "string" ? req.headers["x-iq-wall-reader"] : void 0;
        const gc = process.env.WALL_DERIVED_GC === "1";
        let pinned = false, unpin;
        if (gc) {
          if (process.env.WALL_PREPARATION_ENABLED !== "1") throw Error("Wall retention requires enabled preparation");
          if (!reader) {
            res.writeHead(428, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end('{"error":"Updated history reader required for managed cache; retry after client update"}');
            return;
          }
          let released = false, acknowledged = false;
          unpin = () => {
            if (released) return;
            released = true;
            pinned = false;
            void (async () => {
              for (let attempt = 0; attempt < 3; attempt++) try {
                await wallPreparationCommand("/unpin", { id: requestId, ...!acknowledged ? { cancelled: true } : {} });
                return;
              } catch {
                if (attempt < 2) await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
              }
            })();
          };
          res.once("finish", unpin);
          res.once("close", unpin);
          try {
            await wallPreparationCommand("/pin", { id: requestId, consumer: reader, key: u.searchParams.get("key") ?? "", kind: u.pathname === WALL_PROJECTION_BATCH_PATH ? "projection" : "canonical" }, abort.signal);
            acknowledged = true;
            if (res.destroyed || abort.signal.aborted) {
              unpin();
              throw Error("Prepared wall read cancelled");
            }
            pinned = true;
          } catch (error) {
            unpin();
            throw error;
          }
        }
        let delivered;
        try {
          delivered = await (u.pathname === WALL_PROJECTION_BATCH_PATH ? wallProjectionBatchResponse : u.pathname === WALL_BATCH_PATH ? wallBatchResponse : wallChunkResponse)(u, { acceptEncoding: req.headers["accept-encoding"], ifNoneMatch: req.headers["if-none-match"], signal: abort.signal });
        } catch (error) {
          unpin?.();
          throw error;
        }
        metrics.bytes += delivered.body.byteLength;
        metrics.peakRss = Math.max(metrics.peakRss, process.memoryUsage().rss);
        res.writeHead(delivered.status, { ...delivered.headers, "Server-Timing": `preparedread;dur=${(performance5.now() - started).toFixed(2)}, db;dur=0` });
        res.end(delivered.body);
        return;
      } else if (u.pathname === WALL_DISCOVERY_PATH) {
        const request = wallSourceRequest(u), header = (name) => typeof req.headers[name] === "string" ? req.headers[name] : void 0;
        data = await discoverAndPrepareWallView(wallChunkRoot(request.market), wallProjectionRoot(request.market), request, { enabled: process.env.WALL_PREPARATION_ENABLED === "1", consumer: header("x-iq-wall-consumer"), capability: header("x-iq-wall-projection"), retryToken: header("x-iq-wall-retry"), newRevision: header("x-iq-wall-new-revision") === "1", job: header("x-iq-wall-job"), signal: abort.signal });
        if (data.state === "ready") {
          data.delivery = WALL_BATCH_DELIVERY;
          if (process.env.WALL_PREPARATION_ENABLED === "1") data.readerLease = { version: 1, leaseMs: 15e3 };
        }
      } else if (u.pathname === WALL_SOURCE_PATH) data = await wallSourceVersion(wallSourceRequest(u));
      else if (u.pathname === "/v2/history/manifest") {
        metrics.manifests++;
        data = await historyManifest(parseHistory(u), u.searchParams.get("include") === "tiles", u.searchParams.get("market"));
      } else if (u.pathname === "/v2/history/tiles") {
        metrics.closedTileReads++;
        data = await historyTiles(u);
      } else if (u.pathname === "/v2/history/footprints") data = await preparedFootprints(u);
      else if (u.pathname === "/v2/history/current") data = await currentHistory(parseHistory(u), u.searchParams.get("market"));
      else if (u.pathname === "/v2/history/health") data = { enabled, build: process.env.IQ_BUILD_COMMIT ?? "unknown", metrics: { ...metrics, ...admission.diagnostics(), rss: process.memoryUsage().rss }, wallProjectionEncoding: wallProjectionEncodingHealth(), materializer: await historyHealth(u.searchParams.get("market")), sqlAdmission: await sqlAdmissionHealth() };
      else {
        res.writeHead(404);
        res.end();
        return;
      }
      const binary = Boolean(data.tiles && req.headers.accept?.includes("application/vnd.iqterminal.history")), serialize = performance5.now(), text = binary ? Buffer.from(encodeHistory(data)) : JSON.stringify(data);
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error("Tile response byte budget");
      const encoded = await encodeHttpBody(text, req.headers["accept-encoding"]), body = encoded.body;
      const serializeMs = performance5.now() - serialize;
      metrics.serializeMs += serializeMs;
      metrics.bytes += body.length;
      metrics.peakRss = Math.max(metrics.peakRss, process.memoryUsage().rss);
      res.writeHead(data.status ?? 200, { "Content-Type": binary ? "application/vnd.iqterminal.history" : "application/json", "Cache-Control": "no-store", ...encoded.headers, "Content-Length": body.length, "X-IQ-Decoded-Bytes": Buffer.byteLength(text), "X-IQ-Db-Queries": timing.queries, "X-IQ-Db-Read-Rows": timing.readRows, "X-IQ-Db-Read-Bytes": timing.readBytes, "Server-Timing": `admission;dur=0, db;dur=${timing.dbMs.toFixed(2)}, sqlqueue;dur=${(timing.sqlQueueMs ?? 0).toFixed(2)}, dbdecode;dur=${timing.decodeMs.toFixed(2)}, project;dur=${(data.timings?.projectMs ?? 0).toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}, total;dur=${(performance5.now() - started).toFixed(2)}` });
      res.end(body);
    } catch (e) {
      const invalid = /Invalid|budget|aligned|Unsupported/.test(e.message);
      if (!res.headersSent) res.writeHead(invalid ? 400 : 503, { "Content-Type": "application/json", "Retry-After": "1" });
      res.end(JSON.stringify({ error: e.message }));
    } finally {
    }
  });
});
server.on("upgrade", (req, socket, head) => {
  let targetPort = req.url?.startsWith("/v1/liquidations/stream") ? Number(process.env.LIQUIDATION_PORT ?? 18787) : collectorPort;
  try {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (u.pathname === "/v1/stream" && u.searchParams.get("market") === "spot") targetPort = spotCollectorPort;
  } catch {
  }
  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r
${req.rawHeaders.reduce((s, h, i) => s + (i % 2 ? ": " + h + "\r\n" : h), "")}\r
`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});
server.keepAliveTimeout = 6e4;
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));

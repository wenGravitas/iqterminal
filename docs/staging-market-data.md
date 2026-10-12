# Staging market data development

The explicit `dev:staging` mode sends Binance BTCUSDT USD-M perpetual native candles and Footprints through the feed worker to the independent backend in `/opt/iqterminal` on SSH host `staging`. The normal `pnpm dev` mode still uses direct venue integrations. No API credentials enter the browser.

From this Pi, in two terminals:

```sh
cd /home/daz/workarea/iqterminal
source /home/daz/.nvm/nvm.sh
pnpm tunnel:staging
```

```sh
cd /home/daz/workarea/iqterminal
source /home/daz/.nvm/nvm.sh
pnpm dev:staging
```

Open **http://127.0.0.1:5173/**. On the Binance USD-M chart, Indicators → Footprint loads the latest approximately 15 minutes of retained executions, then receives acknowledged durable execution batches over WebSocket. Settings and chart selections still persist through the existing layout storage; collected data is fetched again on reload. Native candles remain Binance native OHLCV for OpenScript. Execution-derived OHLC and actual price × quantity notionals belong to Footprints and the separate backend execution-candle endpoint.

The footer distinguishes staging, loading, stale/recovery and coverage gaps. Complete retained closed bars reproduce across reloads. The forming bar, truncated request boundaries, unrecorded history, recovery gaps and capacity limits remain incomplete. No synthetic empty bars or automatic direct-feed fallback. Retry is available; backoff is capped at 30 seconds and prior data stays visible on failure.

Hyperliquid and Binance Spot candle feeds remain direct; the staging backend supports neither. Trade Ticker remains the existing direct Binance session feed and labels that source. Depth studies retain their existing direct integration. In staging mode, Binance USD-M Order-book Heatmap now uses durable server depth history and live durable-head reconciliation; other markets and ordinary direct mode retain their integrations. Scripts are unchanged. Fixtures require explicit development selection and remain separate from staging evidence.

## Private connection

`scripts/staging-tunnel.sh` runs:

```sh
ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18780:127.0.0.1:18780 staging
```

The Pi tunnel and Vite bind only loopback. Staging Vite mode rejects `--host 0.0.0.0` and other non-loopback overrides. `/market-data/*` is a same-origin HTTP/WebSocket proxy to that tunnel. The staging API listens at `127.0.0.1:18780`; ClickHouse host ports are `127.0.0.1:18123` and `127.0.0.1:19000` on an isolated Docker project. No firewall, shared SSH policy, CORS or public ports were widened. This arrangement prevents public/LAN API exposure; other accounts already authorized to SSH to staging may also forward its loopback ports. It does not enforce device-exclusive access.

Tunnel establishment failures exit nonzero; keepalives detect a lost SSH connection. `ExitOnForwardFailure` confirms the local forward, not remote API health. Check the actual path with:

```sh
curl -fsS http://127.0.0.1:5173/market-data/v1/health
```

Tunnel and UI may stop independently of staging collection. Start them again with the same commands. For the ordinary direct mode, `pnpm dev` remains unchanged.

## Backend operations and contract

```sh
ssh staging 'cd /opt/iqterminal && docker compose ps'
ssh staging 'cd /opt/iqterminal && docker compose logs --tail 100 app'
ssh staging 'cd /opt/iqterminal && docker compose logs --tail 100 clickhouse'
ssh -t staging 'tmux attach -t iqterminal-server-dev'
```

Containers `iqterminal-server` and `iqterminal-clickhouse` are supervised by Docker Compose with `restart: unless-stopped`; Docker is enabled at boot. tmux only runs recoverable development/build/test commands. On staging, `CHECKPOINT.md` records progress, `docs/CONTRACT.md` specifies API v1, and `logs/dev-{validate,integration,lifecycle}.*` contain logs and exit status. Secrets, storage and builds are ignored by the independent backend Git repository. Backend commits stay there; no hosted repository was created.

Versioned endpoints under `/market-data/v1/`:

| Endpoint | Meaning |
| --- | --- |
| `health`, `capabilities` | DB/collector/OI freshness, disk pause, source and limits |
| `coverage?from=&to=` | Confirmed retained bounds, explicit missing intervals, aggregate ID watermark |
| `executions?from=&to=&after=&watermark=&limit=` | Deduplicated bounded executions; `[from,to)` milliseconds, IDs strictly after cursor |
| `live` | Same cursor rules for the committed tail |
| `footprints?from=&to=&interval=&rowPrice=` | Shared pure accumulator; bounded replacements with coverage per bar |
| `execution-candles` | Explicit execution-derived OHLC/base/actual quote volume |
| `native-candles?interval=&from=` | Separate native Binance klines, used by scripts |
| `oi?from=&to=` | Observed BTC OI samples, venue/observation times, gaps, truncation |
| WebSocket `stream` | Bounded acknowledged execution cursor replay, native kline updates and ingestion health |

Raw/aggregate history requests are at most four hours; raw pages are at most 1,000 records, aggregation at most 250,000 input records, 300 bars/18,000 cells/512 cells per bar. Query-limit errors require a smaller range. Initial browser history covers approximately 15 minutes. The worker restores the shared accumulator from that snapshot, then processes at most 1,000 executions per acknowledged stream batch without retaining a raw execution dataset. The accumulator remains bounded to 300 bars/18,000 cells. Subscriptions share a stream per configuration; reconnects resume the last applied execution cursor. Native candles refresh native REST history on reconnect before resuming their stream. Shared configurations reuse worker subscriptions; IPC allows one unacknowledged footprint message and one coalesced latest snapshot. Native changes and footprint revisions use incremental patches after initial load.

## Coverage, storage and limitations

The backend bootstraps 15 minutes before its first start and records native Binance **aggregate market executions**, not individual orders or trader positions. It connects to the official routed `/market/stream` endpoint before REST catch-up, buffers at most 10,000 aggregate executions, then writes contiguous batches of at most 1,000 records with a 250ms batch cadence plus persistence time. A missing ID triggers REST repair; repeated unrecoverable discontinuities remain explicit gaps. Buffer overflow discards volatile records, reconnects, and repairs from the durable checkpoint. Publication occurs after acknowledged inserts and an fsynced atomic checkpoint; failures do not advance the published cursor. Original decimal price/base quantity and exact decimal product notional are stored. WebSocket events retain publication `E`; REST recovery explicitly sets it null. Both preserve execution `T` and receive time. API/renderer numeric prices use the existing Float64 contract.

Current official Binance documentation limits REST aggregate recovery to the past 48 hours. The collector conservatively restarts bootstrap after a 47-hour stale checkpoint and records the missing interval. A covered empty interval differs from unavailable coverage. Confirmed coverage ends conservatively at the latest durable execution timestamp, not wall-clock now. Query-time ClickHouse `FINAL` prevents replay duplicates before merges.

OI is observed every 30 seconds with source time, observation time, BTC units and instrument identity. Sampling gaps over 75 seconds are reported, including across restarts; unobserved history and pending/stale collection remain distinct. No OI historical backfill, interpolation, tick-level OI or net-long/net-short estimates.

Executions and OI have seven-day TTL. Target total development storage is approximately 50 GB including overhead. Collection pauses at 32 GiB of ClickHouse parts (including inactive parts), or host free disk below 20 GiB, leaving merge/temp/image/log headroom. TTL cleanup is asynchronous and is **not a hard disk cap**. Logs, queries, caches, batches and retries are bounded. Long-term TTL expiry, disk watermark behavior under a full disk, a multi-day outage and reboot have not been exercised as acceptance tests.

## Verification

Real Pi browser harness:

```sh
node scripts/verify-staging.mjs
```

It uses the actual staging API without response fixtures: history/reload equality, live advancement, offline/reconnect, timeframe switching, and visible actual unrecorded coverage. Its gap check changes only request bounds to straddle the real recording start. Evidence is in `artifacts/staging-browser-results.json`, `staging-footprint-pi.png` and `staging-coverage-gap-pi.png`.

The client typecheck, ordinary build and all 182 unit tests passed. The staging browser harness verifies a fixed complete five-minute block inside the rolling retained window, without page errors; the latest machine-readable artifact records the exact interval and bar count. Earlier runs reproduced all 15 retained closed bars, but the fixed block avoids treating expected oldest-bar eviction at a minute boundary as a recovery failure. Broader fixture browser checks passed 24 scenarios in the initial run; an OpenScript timeout passed when rerun alone, and legacy indicator migration passed on a fixed diagnostic bundle. Three remaining failures also reproduced against untouched client commit `b4ca4f2`: synthetic sparse marker pixels, two-trade cell label detection, and the 30-second combined indicator lifecycle timeout. The full browser suite is therefore not an acceptance pass. No unrelated rendering/script behavior was changed to mask those failures.

On staging, `tests/integration.mjs` verifies complete-boundary 1m/5m base and actual quote conservation, deterministic pagination and OI persistence. `tests/lifecycle.mjs` pauses this new table's merges, inserts an identical duplicate, proves API/FINAL dedup before merges, resumes merges, restarts only the new app container and verifies history and resumed collection. These are integration tests against this development database; do not run the lifecycle test on an unrelated database. No platform frame-rate/performance acceptance is claimed.

## Streaming protocol and latency

The worker loads a bounded footprint snapshot and its `cursor`, then sends `{type:"subscribe", version:1, after:cursor, from:historyStart}` to `/market-data/v1/stream`. The server replays database rows strictly after that cursor through its captured durable head; live notifications trigger the same bounded database replay path. Each `executions` packet contains `after`, `cursor`, `watermark`, at most1,000 normalized executions, coverage, collector state, tickSize and sentAt. The worker applies each batch once, coalesces bounded UI patches and sends `{type:"ack",cursor}`. One batch may await ACK per socket; after15s the server disconnects it. One IPC envelope plus one complete coalesced snapshot may await the UI. An invalid or expired resume requests a visible reset, followed by new bounded history. No REST footprint polling remains.

Native subscriptions send `interval`; their events identify `binance-native-kline`. History and live native klines preserve script inputs. OI remains observed REST every30s. Health messages arrive every5s; absent heartbeat15s makes the worker stale. Exchange heartbeats use the existing ws automatic pong support, plus a5s watchdog; planned23h connection rotation uses the normal recovery path. Retry backoff caps30s. A maximum16 sockets,1MiB outbound buffer and shared4-query capacity limit bound slow consumers.

The existing `ws` dependency was retained after inspecting Binance's official connector. Its generated wrapper delegates transport and automatic reconnect to `@binance/common`; direct ws gives this collector explicit payload limits, termination, bounded queue ownership and receipt timestamps with one recovery owner. No exchange credentials or new package are required.

`/v1/health.metrics` exposes the latest exchange-publication-to-receive and receive-to-durable samples, queue depth, reconnects and overflows. Worker diagnostics expose applied cursors and delivery lag. Footprint status carries optional timing diagnostics used by the Pi verifier. Cross-host timestamps depend on clock synchronization. The verifier records a subsequent chart draw after worker application; this is an observed draw timing on headless Pi Chromium, not a pixel-photon latency or desktop FPS guarantee.

Controlled exchange reconnect: `ssh staging 'docker kill --signal=USR1 iqterminal-server'`. This uses the normal collector recovery path and leaves the API process running. The browser verifier also performs one controlled app restart; run it only when that interruption is acceptable. Backend tests and detailed evidence are documented in `/opt/iqterminal/docs/STREAMING.md` and `docs/VERIFICATION.md` on staging.

Native stream/reconnect verifier: `node scripts/verify-staging-native.mjs`; it checks real streamed candle-volume advancement and a new native REST history request after offline reconnect. Final streaming evidence: exact Pi/database parity at applied cursor3481993301 over16 bars; UI1m/5m complete-boundary totals362.735BTC and30336541.0212USDT agree. Final20 draw samples showed send-to-worker p50=56ms/p95=106ms (max506ms), then worker-to-subsequent-draw p50=27ms/p95=34ms. An earlier loaded run reached1844ms delivery and401ms draw observation, so these are short observations without a latency/FPS guarantee. Backend samples separately reported publication-to-receive p95=141ms and receipt-to-durable p95=490ms. Raw artifacts remain authoritative.

## Durable order-book heatmap

Add **Order-book Heatmap** through Indicators on Binance USD-M candles or Footprint. Opening/reloading queries recorded liquidity through the feed worker; changing row size/timeframe reuses server recording. Pan/zoom requests a bounded viewport with a small margin and adjusts display resolution, so distant recorded levels are not restricted by the direct session collector's128-row capture cap. Rendering stays bounded to240 time columns/512 price rows/16384 cells and2MiB typed cache. Broad time views explicitly report their4h query window limit; older retained windows can be selected by panning.

The standard public diff-depth feed excludes RPI orders. A1000-level exchange snapshot starts each continuity epoch. The server then retains all individually observed outer levels, including quiet levels and known-zero removals, subject to an explicit200000-entry epoch cap. Snapshot-covered side intervals are complete; observed outer levels are partial subtotals with unknown holes. Sequence gaps, reconnects and backend restarts end continuity and obtain fresh snapshots. Old outer state is preserved historically and never reused as proof of the new live book. Missing history/coverage differs from observed zero. Footer and hover expose staging source, partial coverage, gaps, loading and stale state.

New endpoints: `/v1/depth-coverage?from=&to=` and `/v1/heatmap?from=&to=&low=&high=&rowPrice=&timeMs=&mode=average&watermark=`. WS `/v1/stream` channel `depth` publishes acknowledged durable heads after insert; the worker reconciles replacement buckets, never adds repeated snapshots. Quantities are time-weighted means or maximum simultaneous price-bucket sums; quote is actual level price×quantity. The backend contract is `/opt/iqterminal/docs/DEPTH.md`. Server projection uses integer base/quote accumulators before Float64 display conversion. It runs in a bounded worker thread with12s deadline; replay budgets are50000 records/64MiB,512 price rows/16384 cells/four-hour range. Over-budget requests are explicit recoverable errors requiring smaller time ranges.

Depth uses the **same** approximately50GB development budget and32GiB/free20GiB disk guards. Whole ended epochs older than24h are pruned asynchronously every30min;23h rotation can keep oldest data up to47h. Entire checkpoint dependencies stay together. Raw data/checkpoints share retention; there is no separate longer-lived aggregate archive yet. Execution/OI7d retention remains. Cleanup is not a hard quota. All database/source/build/test work stays on staging; no ClickHouse datasets are copied to Pi.

Real Pi verifier (intentionally performs one supervised app restart):

```sh
node scripts/verify-staging-heatmap.mjs
```

Evidence: [staging-heatmap-verification.json](../artifacts/staging-heatmap-verification.json), [wide viewport](../artifacts/staging-durable-heatmap-wide-pi.png). Reload matched43 historical rows, reconnect and row-size reuse passed, and actual positive distant partial rows around$64k/$69k were visible. Controlled restart preserved historical rows and started a fresh epoch. These are observed standard-feed subtotals, not complete distant-book coverage. Deterministic fixtures cover quiet outer levels, removals, unknown regions, gap invalidation and reconstruction/retention. No reboot, full-day retention expiry, disk-full, sustained worst-case load or desktop-FPS claim.

Final depth client validation:192 unit tests pass, with typecheck/build. A final ordinary candle chart (without Footprint) also loaded1540 real historical/live heatmap bins with zero page errors; see `artifacts/staging-candle-heatmap-final.json`. The original full fixture browser-suite limitations above remain distinct from these successful focused actual-service checks.

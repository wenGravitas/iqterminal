# Level Watch — experimental first implementation

Level Watch runs on staging and watches manually defined **Binance BTCUSDT USD-M perpetual** zones. It records native aggregate-execution tests and evaluates an explicit failed-breakdown/reclaim rule. Confirmation means the rule fired; it is not a probability, an entry instruction, or a validated trading edge.

## Use locally

Keep the existing tunnel and staging development server running in separate terminals:

```sh
cd /home/daz/workarea/iqterminal
pnpm tunnel:staging
```

```sh
cd /home/daz/workarea/iqterminal
pnpm dev:staging
```

Open `http://127.0.0.1:5173/`. Choose **Level Watch → New zone**, or **Watch level** on a Binance perpetual chart and click two boundaries. Escape cancels selection. Enter an invalidation below the zone and an explicit UTC expiry ending in `Z`. Save a draft, then **Arm**. Clicking the watch name focuses its price zone. The zone overlay works on candle and footprint views.

A watch needs 65 seconds of continuous observations after arming. It can wait for coverage without producing a signal. Pausing, editing, expiry, source gaps and service restarts interrupt an unfinished encounter. There is one encounter per arming; **Re-arm** starts a new baseline. Closing a chart, the panel, the browser or the Pi connection does not disarm the server watch.

**Encounters** opens the durable inbox. Evidence includes the original definition/revision, rule measurements, reason and quality. **Replay evidence** scrubs bounded admitted samples with a price preview. It starts near contact, stops before displaying post-confirmation observations until **Reveal post-confirmation**, and keeps at most 500 samples. It is an evidence replay and sampled price preview; a synchronized full footprint/heatmap replay workspace remains a later UI addition. Full source inputs and reconstruction seeds are retained on staging for the clip.

**Took / Passed / Missed** and notes are manual annotations, not imported fills. Confirmation notifications use the existing Notifications settings, including explicit audio enable and master mute. The inbox is durable; sounds/toasts are best effort, foreground only, and expire after three seconds. An atomic server claim prevents duplicate delivery across tabs; a tab dying after claiming can lose the toast. It does not erase the encounter. No messages are sent outside the terminal.

## Frozen initial rule

`failed-breakdown-v1-experimental`, native tick `$0.10`, fixed zone `[L,U]`, invalidation `I<L`:

- Touch requires an actual native aggregate execution inside the zone after warm-up.
- Breakdown requires executions below `L` for at least 1s and at least 1 BTC. Returning above `L` before qualification or a >3s silence resets qualification.
- Pressure uses five one-second buckets including the currently forming second. The baseline is the preceding sixty complete one-second buckets, normalized to five seconds, with at least 20 band prints. The band is `[I,U]`.
- Aggressor selling must reach 5 BTC and 2× the baseline, with no more than 50 ticks ($5) downward progress from the first pressure-bucket print to its low. This is a transparent heuristic, not a statistical confidence score.
- Reclaim requires actual executions at/above `U+$0.20`, at least 3s and 1 BTC, no >3s silence, and qualified pressure within the preceding 15s. An empty interval cannot satisfy it.
- Invalidation requires at least 1s and 1 BTC of executions below `I`, with no >3s silence. Invalidation is checked before confirmation.
- Ten-minute encounter timeout; one encounter per arming. Expiry is at most seven days ahead. Threshold editing and additional playbooks are deliberately unavailable in this first preset.

Bid-band quantity and positive net changes are supplementary evidence. They do not identify an iceberg, individual orders, cancellation causes or a trader's position. Float64 analytic totals can show normal rounding error; the retained source journal preserves exact decimal price, base quantity and actual quote notional. Binance aggTrades remain aggregate executions.

## Coverage and causality

The observer reads only durable ClickHouse executions and standard diff-depth through the existing normalized contracts. It does not consume chart pixels, rendered heatmap cells, OI interpolations, direct ticker prints, or native candle OHLCV. Existing integrations remain separate.

The entire `[I,U]` band must fit inside the current snapshot-complete bid/ask interval, the depth epoch must be continuous, and sources/admitted depth must be fresh within 3s. Individually observed outer levels remain partial and cannot satisfy this gate. Snapshot bounds can prevent a distant watch from becoming ready even if some outer liquidity is known. Quiet levels are not expired. Execution ID gaps, timestamp regression, REST recovery inputs, depth gaps, a new epoch, queue overload and source outages interrupt continuity and reset the baseline.

There is no shared venue sequence between executions and depth. Each poll admits two independently ordered source lists, interleaved by receive time while preserving each source's own order. The journal persists that exact batch and array order: `(journal id, input index)` is the local admission ordinal. This is as-observed evaluation, not an asserted exchange-wide ordering or exact trade-to-book attribution. Typical polling delay is 500ms plus durable-source/query time, with bounded failure backoff; the browser receives acknowledged WebSocket updates approximately once per second. This is not a subsecond execution trigger.

An SQLite `BEGIN IMMEDIATE` transaction commits input journal, evaluator state, source progress, encounter transitions and notification outbox together. Immutable event IDs survive retries. State is not resumed as current truth after downtime: an active encounter is interrupted and a new seed/baseline is required. A confirmed event remains confirmed; later invalidation is a separate event. Neutral 1/5/15-minute favourable/adverse price excursions use the confirmation reference price and are censored when observations are unavailable; these are not executable P&L.

## Storage and limits

The isolated `iqterminal-level-watch` container uses built-in Node 22 SQLite (WAL, FULL synchronous) in `/opt/iqterminal/state/level-watch`. This Node SQLite API is experimental and the runtime is pinned. ClickHouse remains the market-data authority. The observer has a dedicated SELECT-only database account; credentials stay in staging's ignored `.env`.

A short live sample measured approximately 9.5 KB/s of compressed journal input, with about 12.3 MiB allocated to SQLite/WAL and 5.5 MiB of retained compressed payload (one retained verification encounter). These are short-session measurements, not a long-term sizing guarantee.

The feature reserves **5 GiB within the existing approximately 50 GB budget**. Monitoring pauses at 4 GiB of database plus WAL, or below 20 GiB host free space, or when the existing collector disk guard pauses. SQLite's main-file maximum is 4.75 GiB, leaving room for WAL/control records within the reservation. The existing ClickHouse 32 GiB data watermark remains unchanged; the watch allocation consumes part of the original overhead allowance, not a second storage budget. Pruning and incremental vacuum are asynchronous; neither promises a hard total-host disk cap.

- Raw admitted batches are gzip-compressed; reconstruction seeds include the full observed book and evaluator state every 30s.
- Keep a rolling 120s pre-contact window and seed dependency. Encounter clips pin shared journal ranges, not copies per watch. Initial startup may have less prehistory.
- A clip ends shortly after an unconfirmed terminal event, or 15m after confirmation, and never intentionally extends beyond 30m from contact. Missing periods retain explicit quality/gap records.
- Clips retain for 14 days; summaries/events for 90 days; idempotency keys for 24h. Clip retention is reported separately from complete market coverage. A checksum accompanies each raw journal record.
- Ten armed watches, 100 visible definitions, 1,000 retained definitions, 200 open clip reservations; one instrument.
- Polls: at most 500 depth records, 5,000 executions and 16 MiB admitted JSON. Capacity failures interrupt monitoring; they never silently skip inputs and preserve readiness.
- Requests: 8 KiB mutation body, 120 mutations/minute, 24 connections, 16 streaming clients. Stream ACK deadline 10s; browser watchdog 5s; pending worker requests ≤8.
- Inbox page ≤100, browser inbox ≤200; replay page ≤50 projected batches / 4 MiB compressed input; browser replay ≤500 samples. Raw clip page ≤8 batches / 16 MiB decoded data; each decoded batch ≤16 MiB. Two concurrent clip/replay responses; every HTTP response ≤32 MiB. These bounds are independent of chart zoom/timeframe.

## Private API contract

All paths below are under `/v1/level-watches` through staging `127.0.0.1:18780`; the private observer itself binds `127.0.0.1:18781`. The existing Pi SSH tunnel and Vite same-origin proxy also carry the watch WebSocket. No new public/LAN listener, CORS policy or shared SSH/firewall change is needed. Other already-authorized SSH users can also forward staging loopback ports; this is not device-exclusive access.

| Method/path | Contract |
| --- | --- |
| GET `/` or `/health` | version 1, market identity, preset, durable event cursor, observer health/retention, ≤100 nonarchived watches |
| GET `/session` | same-origin mutation token; not an exchange credential |
| POST `/` | create draft from `{name, lower, upper, invalidation, thesis, expiresAt}` |
| POST `/:id/edit` | `{revision, definition}`; optimistic revision check, interrupt active encounter, save next revision as draft |
| POST `/:id/arm`, `/pause`, `/archive` | `{revision}`; arming resets baseline and requires explicit action |
| GET `/encounters?before=…` | ≤100 summaries and `nextBefore` opaque `(contact time, encounter ID)` cursor; newest first, including timestamp ties |
| GET `/encounters/:id` | frozen definition/preset, evidence, state, annotation, clip cursors and any outcomes |
| GET `/encounters/:id/clip?after=…` | ordered compressed-journal projections with raw seed/inputs, checksums, `nextAfter`; `retentionComplete` does not claim market completeness |
| GET `/encounters/:id/replay?after=…` | small evidence/price projection, near-contact start, quality and next cursor |
| POST `/encounters/:id/annotation` | `{annotation, note}`; annotation is Took, Passed, Missed or empty |
| POST `/claim` | `{eventId}`; returns `{claimed}` once, only for a fresh confirmation |
| WS `/stream` | send `{type:"subscribe", after}`; receive snapshot plus ≤100 immutable events and cursor; ACK `{type:"ack", cursor}` before next batch |

POST requires `Content-Type: application/json`, `X-IQ-CSRF` and a 16–80 character `Idempotency-Key`. Reusing a key with a different operation/body is rejected. Host and browser Origin must be loopback. Errors return JSON with an explicit message. A timed-out mutation has uncertain delivery: refresh state before retrying, and reuse its idempotency key when retrying programmatically.

## Operations

From the Pi:

```sh
ssh staging 'cd /opt/iqterminal && docker compose ps'
ssh staging 'docker logs --tail 100 -f iqterminal-level-watch'
ssh staging 'docker logs --tail 100 -f iqterminal-server'
ssh staging 'docker logs --tail 100 -f iqterminal-clickhouse'
ssh -t staging 'tmux attach -t iqterminal-server-dev'
```

All three containers use `restart: unless-stopped`; Docker is enabled at boot. tmux only hosts recoverable development commands. Bounded build/test logs and exit status are in `/opt/iqterminal/logs/dev-*.log` and `.exit`. Backend checkpoint and API documentation are in `CHECKPOINT-LEVEL-WATCH.md` and `docs/level-watch.md` in that repository. Source, dependencies, builds, database and backend tests remain on staging.

## Verification record

Validation: 206 client tests, 34 backend tests, and four focused browser checks passed; client typecheck/staging build passed. A controlled market-service restart reproduced a retained closed footprint bar exactly and restored execution/OI ingestion with an explicit depth epoch boundary. A controlled observer restart preserved and interrupted a real testing encounter, then recovered. Pi browser checks covered reload, zone picking, closed-panel monitoring, evidence replay, annotations, offline/stale/reconnect, dark/light themes and 720px width.

See `artifacts/level-watch-live.json` and `artifacts/level-watch-review.json` for Pi-browser observations, and the backend checkpoint for service/restart and storage measurements. Deterministic confirmation fixtures do not prove that a profitable or representative live setup has occurred. No real live confirmation, sound delivery for such a confirmation, 14/90-day endurance, power-loss durability, ten-watch peak-load acceptance or profitable trading edge is claimed.

The remaining product work is a full synchronized footprint/heatmap replay workspace, richer zone editing, configurable validated presets, and forward research on the rule. The first implementation provides server monitoring, honest quality gates, recorded evidence, a durable inbox and manual review.

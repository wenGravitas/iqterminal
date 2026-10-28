# Actual Liquidations — Release 1 implementation

Release 1 adds actual reported BTCUSDT perpetual liquidations from Bybit and Binance. It does not estimate liquidation pools, infer liquidations from trades, or claim complete exchange liquidation volume. [Adapter semantics](liquidations.md) describe the authoritative source fields and identity limitations.

## Architecture

The companion `iqterminal-server` runs `liquidation-server.mjs` independently of browser sessions. One collector socket per venue parses every Bybit array member and Binance's latest-per-symbol forced-order snapshots. Exact decimal strings, exchange and receipt timestamps, native quantities, position side, forced direction, price type, source coverage and bounded provenance survive normalization. Unsupported contracts and malformed records are rejected; valid siblings survive.

The collector serializes bounded, deduplicated ClickHouse commits before publishing its durable cursor. Queue overflow, disconnects, restarts, stale streams and storage failures produce coverage gaps. Coverage checkpoints are atomically persisted separately from event storage. Deduplication uses deterministic source-field IDs, a bounded recent set and durable `FINAL` checks. Neither exchange supplies a native event/order ID in these messages; indistinguishable reports cannot be assigned invented identities.

The history gateway exposes HTTP history and an ACKed WebSocket stream. A single reference-counted service in the existing dedicated feed worker reconciles history and live cursors, cancels obsolete generations, classifies bursts and builds candle-aligned bars. Multiple tickers and indicators share it. The existing scheduler renders native DOM tape rows and OpenAlgo Canvas primitives. Removing or hiding one consumer preserves others.

The worker retains at most 20,000 events, 16 consumers and one backend socket. History pages are 1,000 records; stream batches are 256 with one unacknowledged batch per connection. UI batches are ACKed/coalesced; ticker payloads are capped at 500 and rendered rows at 100. Marker candidates are capped at 500, with a configurable visible maximum of 200. Burst membership is capped at 500 stored events and 50 transmitted members, with truncation disclosed. Diagnostics expose rejected/dropped records, bounds and freshness.

## Storage and deployment requirements

Server migration `ops/migrations/007-liquidations.sql` creates `iqterminal.liquidation_events`: date-partitioned `ReplacingMergeTree`, ordered by exchange timestamp and event ID, with durable insertion cursor and per-record expiry. Reads use `FINAL`; ambiguous insertion failures reconcile the durable head before retry. Default retention is seven days; `LIQUIDATION_RETENTION_DAYS` accepts 1–90 days and affects newly inserted records. TTL cleanup is asynchronous. History requests remain bounded to seven days each.

The prepared Compose `liquidations` service uses the existing image/build, app database credentials, persistent state and resource limits. Its API binds loopback port 18787. The gateway forwards liquidation routes to it. Deployment requires reviewing/applying migration 007 using the existing schema convention, rebuilding the server image, starting the independent service, updating the gateway and checking both venue coverage and cursor advancement. No production migration or deployment was performed for this implementation. `/health` being HTTP 200 establishes process availability; inspect source freshness and gaps separately.

Client backend mode uses the existing private staging path: `pnpm tunnel:staging`, then `pnpm dev:staging`. HTTP history uses tunnel 18780; the live stream uses 18781. Ordinary direct-exchange development mode shows liquidation backend unsupported rather than manufacturing data. `VITE_LIQUIDATION_API_URL` is an optional loopback-only test proxy override. Fixtures require explicit development selection and never act as connectivity fallback.

## API contract

Public client prefix is `/market-data/v1/`; the gateway strips `/market-data` before forwarding.

- `GET /market-data/v1/liquidations?from=<ms>&to=<ms>&venues=bybit,binance&side=BOTH&limit=1000`: half-open exchange-time range, optional `LONG`/`SHORT`, maximum seven days and 1–1,000 rows. Response contains `version`, `{cursor,event}` records, pinned `head`, opaque `next`, coverage and requested range. Continue using the same filters/range, `head` and `after=<next>`; cursors cannot be reused with different filters.
- `GET /market-data/v1/liquidations/health`: coverage, durable head, retention and collector diagnostics.
- `WS /market-data/v1/liquidations/stream`: send `{type:"subscribe",version:1,after:<cursor>}`. `ready` pins `initialHead`; `liquidations` packets contain records, cursor, coverage and send time. Reply `{type:"ack",version:1,cursor:<packet cursor>}`. Catch-up up to `initialHead` is historical. Health packets arrive every five seconds. Missing ACK closes after 15 seconds; expired or ahead-of-store cursors receive `reset` and require retained-history reconciliation. Sockets, payloads and database query admission are bounded.

No endpoint synthesizes earlier events. A quiet source, missing range, retention expiry or sampled source is never proof of zero liquidation activity.

## Ticker and indicator

The dockable **Liquidation Ticker** persists independent venue/side/minimum/column/tier settings. It supports UTC times, quantities, USDT or BTC units, shared audio/toast settings, per-tier emphasis, pause/resume, bounded automatic scrolling and UTC historical loading. Replay advances event time by ten seconds per second, is pauseable, and is silent. Summary windows show long/short valuations for 1/5/15 minutes and a reported 15-minute total; caveats remain beside totals.

`native.liquidations` is a native **Order Flow** pane indicator with registry, Object Tree, hide/remove and workspace persistence. Shorts stack above zero in cyan, longs below in red, with separate venue contributions and a shared magnitude scale. Host candle boundaries use authoritative exchange timestamps. Subpixel bars combine while retaining large-event peaks. Unknown historical intervals are shaded and described instead of presented as measured zeros. BTC perpetual charts from a compatible price source can consume either venue's events.

Optional price markers use bounded logarithmic size and a notional/density threshold. They are only mapped onto explicitly compatible BTC/USDT prices: USD/USDC sources retain the pane but do not invent FX mapping for price markers. Hover exposes venue, side, forced direction, full UTC time, price basis and coverage. Bybit markers explicitly say bankruptcy price. Click tape events or burst titles to focus an already loaded compatible chart; unavailable ranges show a message. Inspecting a burst expands its recorded members without changing the chart.

Colors adapt to the existing dark and ivory themes. Controls use native DOM and shared market picker, ticker tiers/audio/notification service; chart drawing remains DOM-free.

## Burst and notification semantics

Defaults: rolling 12-second window, at least three reports and 1 million USDT, both sides and venues, 60-second cooldown; sound/toast alerts default off. Rules are editable. Grouping is by compatible underlying and liquidated position side, with per-venue contributions. A cluster remains one continuing burst until a gap exceeds the rolling window, preventing overlapping-window repeats. Cooldown applies independently by side. “Burst” describes concentration of reports, not proven causality.

Only fresh live records beyond the stream's initial replay head are alert-eligible. Bootstrap uses its own pinned history watermark, allows one second of future source time, and realigns the recent history query to the collector clock when browser UTC differs. Fresh alerts still require reasonably synchronized browser and recorder clocks; arbitrary clock skew is not treated as fresh activity. Silent tiers without toast do not consume shared notification capacity. History, replay, settings changes and reconnect catch-up warm detectors silently. Shared notification deduplication prevents the same rule/event alert across consumers. Unknown notional is retained in the tape but excluded from valuation thresholds and aggregate notional.

Bybit totals are bankruptcy-price valuations. Binance is sampled latest-event-per-second reporting, and cumulative snapshots may overlap; sums are reported snapshot valuations, not unique executed volume or complete exchange-wide liquidation volume. Source limitations travel with events, aggregate readouts, bursts and tooltips.

## Verification and limits

Deterministic client tests cover adapters/semantics, exact notional, duplicates, invalid data, cache bounds, ordering, aggregation/stacking, bursts/cooldown, replay suppression, shared subscriptions and adaptive contrast. Server tests cover mirrored adapters, durable store queries/deduplication, filters/cursors, API origins/ACK/reset and existing server regressions. Browser checks exercise ticker, pane/markers, persistence, hide/show, multiple consumers, replay silence and source compatibility.

Final local checks: client **579 passed, one skipped**; server **108 passed**. Both typechecks and production builds passed, as did mirrored-adapter synchronization and whitespace checks. All 34 selected browser cases passed across the broad run and focused retries: the initial run had 31 passes and three existing test selector/viewport failures; scoped test repairs produced passing heatmap and audio retries. The three liquidation browser cases also passed again after the notification fixes. The final bootstrap clock changes have dedicated deterministic worker regressions. The design detector reported no findings on the new liquidation UI/shared DOM helper. The existing large client bundle warning remains.

An isolated ClickHouse container with fixture venue WebSockets passed collection → durable insert → HTTP history → ACKed stream → collector restart → ClickHouse restart. A second isolated run fed the real browser backend path and rendered persisted fixtures (22 events, durable head 22, one shared socket). These are explicitly synthetic records, not live liquidation observations. Test containers were removed; production storage was untouched.

Official Bybit and Binance connections were observed for 180 seconds, including Bybit subscription acknowledgement and heartbeat responses. Neither sent a BTCUSDT liquidation event during that window. Connectivity was verified; live event normalization against a contemporaneous exchange record remains unverified.

On the actual Raspberry Pi 5, headless Chromium/SwiftShader at 1366×900 measured 90 RAF intervals per phase with fixture footprint and 25 heatmap bins, and Order Walls enabled (zero qualifying wall segments). Baseline median/p95 RAF interval: 33.4/149.9 ms; with the liquidation pane: 50.0/133.3 ms. Pointer-to-next-RAF median/p95: 58.8/109.2 ms baseline and 53.3/97.5 ms with the pane. The last liquidation histogram draw was 0.30 ms for nine bars/32 painted contributions. No page errors occurred. This small, loaded, software-rendered observation does not establish desktop GPU frame rate, 60fps, populated-wall performance or production performance acceptance.

The companion service and migration were subsequently deployed to staging on 2026-10-27 (see staging verification below); history starts only when collection begins. Native identity ambiguity, Binance sampling/cumulative overlap, bankruptcy-price valuation, finite retention/client buffers and no USD/USDC marker mapping remain explicit limitations. No production rollout or complete historical backfill is claimed.

## Extension boundaries

New actual venues can implement the same pure adapter contract and declare contract units, price basis and reporting coverage. Estimated liquidation pools must use a separate event/model kind, never enter the actual-event store or masquerade as observed records. Future OI/wall/absorption analysis can join by canonical instrument and authoritative time without changing actual event provenance. No pool estimation or cross-signal inference is implemented in Release 1.

## Local implementation review

**PASS for the local implementation review.** No open material findings remain.

| Finding | Final score |
|---|---|
| Recent-history watermark race and collector clock alignment | Resolved |
| No-effect tier and burst alerts consuming notification capacity | Resolved |
| Valuation/source caveats, forced direction, and theme contrast | Resolved |
| Documentation and feature discoverability | Resolved |
| Final unit, build, and selected browser verification | Resolved |


## Staging verification, 2026-10-27

Approved migration 007, the independent liquidation collector and the two gateway routes were deployed as `iqterminal-liquidations:20261027-r1`. Existing Binance candle collectors and both history materializers retained their original container IDs and start times. The pending Bybit trade recorder was not deployed.

Both exchange sources report live with advancing traffic timestamps, zero rejected/dropped records and no pending writes. HTTP history and WebSocket subscription/health messages passed through the staging gateway and local Vite proxy. A real staging browser rendered the ticker and indicator in the live state with two consumers sharing one socket and no page errors. The local tunnels were restarted without SSH compression after repeated compressed-forwarding handshake stalls; the startup script now uses the verified uncompressed configuration.

No BTCUSDT liquidation event arrived during the initial seven-minute observation; durable head and table count remained zero. This verifies live connections and empty-history handling, not a real event insert or nonempty live rendering. Collection starts at deployment, retains seven days and does not backfill earlier liquidations. Synthetic tests remain distinct from this evidence.

The staging release directory `/opt/iqterminal/releases/liquidations-20261027-r1` contains backups, artifacts, verification notes and an executable rollback script. The rollback image was captured from the original running gateway without runtime credentials, with runtime/code hashes verified. Rollback restores only the gateway and stops the new collector, retaining the additive table and captured data. No production rollout is claimed.

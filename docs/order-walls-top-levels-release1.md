# Order Walls — Top Levels, Release 1

Order Walls now offers two separate detectors. **Top Levels** is the default for new instances: Top 8 bids and Top 8 asks, exchange-native price resolution, 10% search on each side of the contemporaneous mid, no minimum-notional filter, High Contrast and Visible Range Only on. Existing version-1 instances migrate to version 2 **Threshold Walls** with their percentile/absolute, Auto/fixed aggregation and appearance settings retained. A rank selection is not a percentile threshold.

## Calculation and lifecycle

The existing shared depth worker and recorded observation API supply absolute price/quantity replacements. At each confirmed receive-time observation, bids and asks aggregate separately. Quote notional is the sum of each actual price times its BTC quantity; a bucket is not valued as bucket-centre times quantity. “USD” controls use BTCUSDT's USDT quote-notional convention, with no added FX conversion feed.

A deterministic augmented price treap maintains bucket values incrementally. Fixed-bucket quote and base-quantity totals use reproducible subtree sums, so reordered but identical checkpoints do not alter ranks or create value runs. Each subtree stores its price bounds and strongest notional candidate. Range Top-N queries prune subtrees; they do not sort every book level per event. Bids and asks rank independently, strongest first; equal notional uses ascending price as the deterministic tie break. Top 1–10 is supported. The optional minimum is applied before selection and can result in fewer than N levels.

The mid is `(best observed bid + best observed ask) / 2` at that observation. Search is symmetric, configurable from 0.01% to 10% per side. Explicitly observed outer price levels can participate, even beyond the fully covered snapshot interior, but this always remains observed Top N under partial scope. A missing or crossed two-sided book makes ranking unknown and censors earlier active episodes; it does not establish zero liquidity.

Each selected side/price has one selection episode. Quantity and rank changes add exact timestamped value points inside it, without changing identity or splitting the line. Rank promotion/demotion alone does not create episodes. Overlapping completed episodes retain their IDs when an earlier pan supplies more history, matching source epoch, side, price, confirmed end and a positive overlapping span; separate re-entries are never joined merely by price. A rank eviction ends the episode at the observed timestamp and a later re-entry starts another ID. The end reason is explicit:

- **Rank exit:** another observed level overtook it; resting liquidity can still be present.
- **Below minimum / outside search range:** selection ceased, with no removal claim.
- **Removed:** a confirmed zero quantity within known returned-book membership; the cause (execution, cancellation or other reduction) is unknown.
- **Censored:** continuity, epoch, replacement snapshot, truncated membership or price coverage no longer confirms the level. The line stops at its last confirmed observation, not an invented removal time.

Snapshots are left-censored starts. Same-epoch checkpoints preserve ongoing episodes; a gap or replacement epoch censors them. Receive-time regressions retain cursor order, clamp timestamps and remain flagged. Native prices are kept exactly as supplied; dividing/flooring BTC prices by a cent tick can otherwise merge adjacent native levels through floating-point error.

Optional confirmation requires continuous selection for the configured milliseconds (0–60,000 ms in Release 1). This is not TRDR’s timeframe-count continuation control. The displayed span starts no earlier than `episode start + confirmation`, so later persistence does not paint qualification into an earlier time. A seeded start remains explicitly unknown before the observed timeline.

## Stable aggregation and source scope

Native resolution uses the existing BTCUSDT source ticks (Spot $0.01, USD-M $0.10) without bucketing adjacent exchange prices together. Fixed $10, $25, $50, $100 and $250 widths aggregate by price bucket, independently per side. Full fixed buckets inside the requested outer search boundary are considered; the boundary bucket can be omitted conservatively. Native is the initial default because it does not manufacture combined liquidity across distinct price levels. This is an implementation choice available for calibration, not a claim about TRDR's proprietary resolution.

Top Levels never uses chart-derived Auto. Pan, zoom, window resizing and Visible Range Only do not affect ranking resolution or classification. A changed resolution/detection setting requires replay; appearance changes reuse the calculated episodes. Threshold Walls retains its old percentile/absolute thresholds, exit ratio, historical semantics and optional zoom-derived Auto resolution.

Binance Spot and USD-M use distinct existing source IDs, streams and market-qualified history queries. Direct mode shares one nearest-price projection keyed by source book, epoch and sequence across consumers. Full visits remain linear because that is the incumbent source API; only changed prices update the projection index, and bounded ordered walks replace full-book sorts. The source book itself retains its existing capacity/reset rules. Direct mode still supports the existing live USD-M synchronizer only; it does not silently substitute USD-M for Spot history. Spot requires the existing staging recorded-depth pipeline. Hyperliquid/Bybit are not added to Order Walls by this release.

The source returns a bounded nearest observed book, up to 5,000 levels per side. Snapshot interior boundaries, returned membership truncation and sparse observed outer updates are different from complete global depth. Even an API page whose returned side is marked `complete` can have only snapshot-bounded global coverage. Ranking scope therefore compares the requested range to actual known boundaries and explicitly reports **partial ranking scope · observed Top N only**. A projected membership eviction outside the retained boundary is not an order removal.

## Rendering and controls

Native OpenAlgo primitives draw horizontal spans across actual qualifying time, using fractional logical indices for sub-candle timestamps. The detector and chart retain value/rank changes; adjacent runs with the same rendered tier coalesce into strokes, not separate selection episodes. Hover looks up the historical value at the pointer time and uses current episode end metadata.

Top Levels has four shared strength tiers with independent bid/ask hues. In heat mode these progress from muted blue/teal through brighter colour, yellow and orange. Bid/ask mode uses increasing green/red strength. High Contrast scales relative notional between the reference minimum and maximum; disabling it compares to the reference maximum. The configurable maximum thickness defaults to 3 px, with strength selecting one of four widths from 1 px to that maximum. Constant thickness is also available.

Visible Range Only builds the styling reference from runs overlapping the visible time and price range. Turning it off uses retained eligible history. This is presentation scaling only: it does not rewrite the historical Top N or episode IDs. Completed episodes stop at their actual end, and optional active price/notional tags do not extend Top Levels across the chart. Stronger labels win when prices overlap. The primitive does not change autoscale or candle/footprint/drawing price behaviour.

Settings use the existing native dialog, grouped into Detection, Appearance and History. Advanced confirmation/threshold exit controls are collapsed initially. History visibility and retained historical selection-episode count are configurable. New instances render up to 2,000 completed episodes plus active levels; legacy instances keep the former 20,000 default unless changed.

## Bounded history and incomplete data

The four-hour viewport replay guard is retained. A requested view wider than that explicitly says older history is not loaded. Live-first provisional levels remain separate until canonical cursor-ordered replay catches up. Replay percentage and loaded-through UTC time describe actual processed history, including pages without qualifying walls; pending history is not “no walls.” This release adds no collector or database schema.

Existing worker/chart value buffers remain bounded: 20,000 completed detector episodes (plus active levels), 20,000 total client-map segments, 50,000 retained value-change points overall and 2,048 per episode. Equal values/ranks are stored as runs, not sampled or averaged. Retained changes are exact; older values can be evicted under high activity. Such history is flagged as truncated and hover reports unavailable quantity/rank rather than inventing a value. Known episode membership can still be drawn continuously through an evicted-value prefix, with neutral styling for unknown strength. Both value-detail and selection-episode eviction are explicitly reported as incomplete history. Narrowing and replaying a window can recover detail from retained raw observations. These client limits do not erase recorded source depth.

The worker published replay mirror is also capped at 20,020 segments (20,000 completed plus up to 20 Top Levels); cache evictions send null patches without rewriting order-removal reasons. Historical identity anchors remain bounded. Raw replay caches remain four entries / 32 MiB total (16 MiB per entry), and live replay buffering remains 4,000 records / 8 MiB. Raw history loading is viewport-first and fixed-watermark; neither the guard nor raw page admission was removed.

## TRDR comparison and assumptions

Reference: [TRDR Order Book Top Levels documentation](https://docs.trdr.io/key-features-and-indicators/order-book-indicators/order-book-top-levels), including its published Top Levels image. Its described separate bid/ask Top N, Visible Range Only styling, High Contrast and persistence controls informed this release. The supplied in-conversation image was IQTerminal; a separate user TRDR screenshot was not available in this task context.

Our fixture captures use **Binance BTCUSDT Spot, 5m, Top 8, High Contrast and Visible Range Only**, with dense synthetic depth and persistent round-price levels. They demonstrate continuity, hierarchy, tags and rank exits; they are not live-market comparisons. Live evidence is identified separately. TRDR's exact native aggregation, tie rules, colour cutoffs, treatment of incomplete depth and retention are not public enough to claim numerical equivalence. Our documented aggregation and four-tier linear scaling can be calibrated against a matched venue, market, timeframe and UTC window. Do not compare USD-M data against Spot as though the wall selections should agree.

## Implementation files

| Area | Files |
|---|---|
| Detection and incremental index | `src/feed/order-walls.ts`, `src/feed/order-wall-rank.ts`, `src/feed/order-wall-book-projection.ts` |
| Existing source and replay adapters | `src/feed/direct-order-walls.ts`, `src/feed/staging-order-walls.ts` |
| Native chart geometry, value retention and settings | `src/chart/order-walls.ts`, `src/chart/openalgo.ts`, `src/order-walls-controls.ts` |
| Indicator migration, panel lifecycle and styling | `src/indicators/model.ts`, `src/panel.ts`, `src/style.css` |
| Deterministic and browser evidence | `tests/order-wall-top-levels.test.ts`, existing `tests/order-walls*` / `tests/staging-order-walls.test.ts`, `tests/fixtures/top-levels-depth.ts`, `tests/browser/order-wall-top-levels*.spec.ts`, `tests/browser/order-walls-ui.spec.ts` |
| Reproducible profiling | `scripts/order-wall-top-levels-bench.mjs`, `scripts/order-wall-top-levels-bench.ts`, `scripts/order-wall-top-levels-render-bench.ts`, `package.json` benchmark command |

## Reproduce validation and profiling

```sh
pnpm test
pnpm typecheck
VITE_DIAGNOSTICS=1 pnpm build
pnpm exec playwright test tests/browser/order-wall-top-levels.spec.ts tests/browser/order-walls-ui.spec.ts
pnpm bench:order-wall-top-levels
# Explicit diagnostic/staging Vite client must be running on loopback:
pnpm bench:order-wall-top-levels -- --render
IQ_TOP_LEVELS_LIVE_TEST=1 pnpm exec playwright test tests/browser/order-wall-top-levels-live.spec.ts
```

The harness bundles with the already installed Vite, then measures in a fresh Node process. No new runtime dependency is needed. Detector results use 5,000 prices per side, 20 replacements per observation and a deterministic five-minute / 3,001-observation tape. The separate matched rank-index versus full-sort workload uses identical updates, search range, N and tie-breaking and checks exact equality. A separate direct-adapter case measures 300 full-book observations with eight consumers, verifying shared projection reuse. Threshold and Top Levels scenario timings use different aggregation/workload sizes and must not be presented as a matched speedup.

The render harness runs the real chart with an explicitly synthetic 4-hour timeline, 90 incremental updates paced at 100 ms, a continuous RAF monitor and pointer-to-next-RAF observations. Its matched baseline schedules the same 90 empty-primitive redraws and pointer events at the same cadence. Idle baseline numbers are reported separately. Set `TOP_BENCH_TAGS=1` to profile optional tags independently. Chrome CPU profiles are saved beside the JSON artifacts. Software-rendered headless Chromium on a loaded Pi does not establish hardware-GPU FPS or 60 fps. See the artifacts and measured results below.

## Release 2 backend work deferred

A longer indexed historical selection/value event stream, persisted episode/rank events and efficient window/zoom queries are deferred. That work would avoid replaying hundreds of raw-depth pages and make longer cold history and detailed old values efficient. Source coverage expansion, wider snapshots, cross-venue Top Levels, server-side shared Top-N projections and durable rank-event retention require separate source/capacity decisions. No new collector, database table or silent global-depth certainty is introduced here.

## Validation and measured results

Final local checks: **636 unit tests passed, 1 skipped (82 files)**; typechecking passed; the diagnostics build and ordinary production build passed. The six selected Playwright checks passed, covering dark/light candles, footprint coexistence, settings/persistence, historical hover, replay progress and chart tabs. The builds retain the existing large-chunk warning. Source hashes are recorded in [the evidence manifest](../artifacts/order-walls/top-levels-source.sha256).

A genuine Binance Spot 5m capture succeeded with eight live bids and eight asks, advancing confirmed observations, and no browser errors. It explicitly reports partial ranking scope, a recorded continuity gap and provisional canonical replay. The final repeat attempts were **not passes**: one timed out after a local SSH tunnel failure; after reconnecting, another reached Order Walls but the stream reported reconnecting/stale and did not meet the fresh-live predicate. The earlier successful capture is retained, not represented as uninterrupted live acceptance. No staging or production server changes were made.

| Pi 5 measurement | Result |
|---|---:|
| Native detector, 3,001 observations / 10,000 levels | 4.54 s replay; 2.70 ms P95/event |
| Detector CPU, replay | 4.33 CPU seconds |
| Detector heap delta / whole harness RSS | 10.3 MiB / 149.8 MiB |
| Matched 1,000 rank queries | 0.36 ms indexed vs 5.37 ms sort P95; zero mismatches |
| Direct full-book projection, 300 events / 8 consumers | 20.89 ms P95 combined; 300 builds / 2,100 cache hits |
| Browser cold fixture generation / attach | 657.6 ms / 95.4 ms |
| Default primitive draw / patch / pointer-to-RAF P95 | 14.6 / 1.8 / 33.6 ms |
| Default matched redraw baseline / overlay RAF P95 | 116.6 / 99.9 ms |
| Optional tags draw / pointer-to-RAF P95 | 20.5 / 25.6 ms |
| Tags matched redraw baseline / overlay RAF P95 | 83.3 / 100.0 ms |

The detector event maximum was 245.3 ms, so P95 is not a worst-case guarantee. Browser results include 5,000 candles, 20 selection episodes and 1,920 initial value spans, reaching 3,360 spans after 90 updates; seven batched strokes and one full projection rebuild. Memory is a fresh-process heap delta plus whole-harness RSS, not isolated browser/GPU memory. The cold fixture attach measures local generation and geometry, **not remote historical replay latency**. Actual raw-depth history remained partially pending in the genuine capture; four-hour remote cold-load completion is not established. Raspberry Pi software-rendered responsiveness is measured, but hardware-GPU sustained FPS and long-duration live soak acceptance remain unverified.

Evidence: [dark candles](../artifacts/order-walls/top-levels-spot-5m-dark.png), [light candles](../artifacts/order-walls/top-levels-spot-5m-light.png), [footprint](../artifacts/order-walls/top-levels-spot-5m-footprint.png), [genuine live capture](../artifacts/order-walls/top-levels-live-spot-5m.png), [live metadata](../artifacts/order-walls/top-levels-live-spot-5m.json), [detector/projection results](../artifacts/order-walls/top-levels-detector-bench.json), [default browser profile](../artifacts/order-walls/top-levels-render-bench.json), [tags profile](../artifacts/order-walls/top-levels-render-tags-bench.json), and Chrome CPU profiles beside those results. The [latest live attempt log](../artifacts/order-walls/top-levels-live-latest-attempt.log) preserves the failed freshness check.

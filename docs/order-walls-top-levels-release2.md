# Order Walls Top Levels R2

Status: backend candidate `491e7f24025ef56e4f909b593d3e9ec06321a7be` is
deployed to staging. Both genuine native chart legs passed: Spot BTCUSDT 5m
with a 30.5-hour view, and USD-M BTCUSDT perpetual 15m with a 30.5-hour view.
Each fixed-watermark history request finished paging, but coverage remains
partial because the source reported ten Spot gaps and four USD-M gaps. The
Spot archive cursor was confirmed to 1.242 seconds before its requested end;
the USD-M cursor was confirmed to 3.494 seconds before its requested end. The
custom Spot profile gate confirmed exact metadata and current availability,
while its requested 24-hour history remained backfilling with a 3.308-hour
confirmed prefix at the gate cap. The USD-M browser run had one recovered
78.8-second interval without a fresh current confirmation; a later 73-second
current-only check returned seven valid HTTP 200 pages but does not explain
that interruption. Deterministic tests, genuine venue data, staging behavior,
and measured platform performance remain separate evidence classes.

## Goal and source boundary

R2 extends native Order Walls Top Levels for Binance Spot BTCUSDT and the
existing Binance USD-M BTCUSDT perpetual. It keeps the legacy Threshold Walls
mode and saved settings intact. The default Top Levels view remains Top 8 on
each side, native price aggregation, a symmetric 10% search band, minimum
notional filter off, and zero confirmation delay.

Selection is computed over the complete **locally observed** book before any
transport projection. It does not mean the exchange's complete book: Binance
Spot REST snapshots are capped at 5,000 levels per side. USD-M BTCUSDT depth
snapshots are capped at 1,000 levels per side and its standard feed excludes
RPI. Binance says outer Spot levels absent from the initial snapshot are
unknown until they change. An unknown price or interval is never represented as
zero liquidity. See the [Spot REST depth limit](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#order-book),
[Spot local book guidance](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#how-to-manage-a-local-order-book-correctly),
[USD-M REST depth](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#order-book),
and [USD-M local book guidance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly).

The public TRDR description says Top Levels can display up to ten buy/sell
orders and that Visible Range Only affects relative sizing and styling. It does
not disclose a reproducible ranking algorithm; R2 does not claim algorithmic
equivalence. See the [TRDR Top Levels guide](https://docs.trdr.io/key-features-and-indicators/order-book-indicators/order-book-top-levels).

## Exact archive profiles

The collector/materializer retains a compact, versioned Top 10 profile for
each supported market. Profile identity includes venue, market, native
instrument, depth feed, native price granularity, 10% midpoint band, Top 10
selection rule, and algorithm/schema version. Color, line width, chart range,
and other presentation choices are not part of identity.

The archive stores source cursor, epoch, receive time, exact price and quantity
strings, exact price-times-quantity notional, rank, entry identity, selection
changes, continuity and observed-scope metadata. It coalesces unchanged state;
it does not store duplicate full-book rows for every websocket observation.
Rank exit, band exit, observed zero, continuity gap, replacement epoch, and
capacity/coverage limits remain distinguishable. A zero quantity is an observed
book update and does not assert that an order was traded or canceled.

The always-on profile exactly derives Top N from 1 through 10 only for the same
10% band, native aggregation, zero confirmation delay, and no minimum-notional
filter. A nonzero minimum-notional filter can be derived only when the retained
ordered candidates prove the requested Top N result; filtering the stored Top
10 cannot invent a lower-ranked replacement. Nonzero confirmation delay has
its own canonical profile because entry depends on raw observation timing, not
only the sparse selected-level timeline. A narrower band requires its own
candidate search: ten larger levels 8–10% away can otherwise hide smaller
levels inside a 2% band. Each changed band, aggregation, confirmation delay,
Top N, or minimum-notional setting that cannot be proven from the pinned
profile uses its exact canonical identity and bounded server-side profile
admission/reconstruction. Raw source availability does not guarantee immediate
admission: custom slots and history work are bounded, and a request may remain
building/backfilling or unavailable when capacity, retained coverage, or
reconstruction prevents it. Threshold mode remains a separate algorithm. The
UI never substitutes the default profile or silently resets the saved control.

An active candidate present in a page's carry-in seed is labeled as observed at
the beginning of that loaded window when its original entry predates the
available archive or cannot be proven. It is not assigned a fabricated start
time. Stable entry IDs survive overlap, paging, and reload. Gaps and replacement
epochs censor active spans at the last confirmed observation; they do not create
synthetic exits or continuous segments.

## Retention and backfill

Compact archive retention defaults to seven days for the always-on Spot and
USD-M profiles. Custom profiles use a bounded profile/cache admission policy
with explicit concurrency, byte and expiry limits; they are not materialized
permanently for every setting. The existing raw-depth retention policy is
unchanged. Existing retained raw records are backfilled in bounded, resumable
chunks for the always-on profiles and for admitted custom profiles; the API
reports the actual available start and whether each interval is complete,
partial, building, or unavailable. A new collector start does not imply
recovery of older history.

Archive writes are idempotent across replay and retry. A published archive
watermark advances only after the corresponding raw and archive writes commit.
Source history remains bounded by the existing collector capacity, retention,
and epoch continuity; browser history requests are bounded separately from raw
replay. The current Top Levels tail uses the same server-selected,
full-observed profile as its archive; it never ranks the raw nearest-5,000
response. Historical pages and current-tail polling use independent cursors, so
live updates continue while backfill proceeds. Unsupported sources or an
unavailable profile are shown explicitly rather than falling back to a
truncated raw projection. The legacy Threshold and other raw-depth consumers
keep their existing source path.

### Custom-profile staging gate

The exact Spot profile
`binance-spot-btcusdt-feed-spot-diff-depth-band-2_5pct-agg-25usdt-top10-a1-s1-confirm-3000ms-n4-minusd-250000`
means 2.5% band, 25 USDT aggregation, 3-second confirmation, Top 4, and a
minimum $250,000 notional. This profile was already active from the earlier
gate when the `491e7f2` serving-only repair was deployed; the measured call was
a re-admission/current check, not a fresh first admission. A ClickHouse `FINAL`
read after repeated coordinator ticks showed the canonical metadata still in
slot 1, with the original start cursor and replay progress preserved. The
legacy `admittedAt=0` remains unknown rather than being fabricated.

At `2026-11-03T09:33:59.726Z`, the current endpoint returned HTTP 200 in 1.070 s
with a valid current head at cursor 14,616,314. Its profile status was still
`backfilling`; the request confirms current availability, not first-ever
admission latency. The fixed 24-hour history window
`[2026-11-02T09:34:00.796Z, 2026-11-03T09:34:00.796Z)` returned its first
seeded page in 270 ms with 256 patches. It was partial because the durable
profile watermark had confirmed only through `2026-11-02T11:09:53.350Z`; the
returned prefix had no source gaps. After the 15-minute gate, the first page at
watermark 13,870,130 took 528 ms and confirmed through
`2026-11-02T12:52:29.447Z`, about 3.308 hours into the 24-hour request. The
profile was still backfilling and 20.692 hours of the requested tail had not
been confirmed. The archive reported an available start at
`2026-11-02T07:42:22.994Z`, earlier than the requested start, so the seeded
prefix is reconstructible; history beyond the confirmed watermark remains
unavailable rather than being filled from the pinned profile.

Across 15 minutes 21 seconds of health samples, the custom cursor advanced
61,696 records (about 67 cursors/s) while its source head advanced 9,235; net
lag fell 52,461 to 755,381 cursors (about 57 cursors/s net). A linear estimate
would take roughly 3.7 hours to drain that remaining cursor lag at the sampled
net rate. This is a bounded in-progress backfill observation, not a cold
first-admission or full 24-hour completion time. Both pinned current lanes and
the custom current lane remained valid and caught up; pinned Spot and USD-M
current watermarks advanced by 11,449 and 11,311 cursors from the preflight
sample. See `artifacts/order-walls-r2-staging-491e7f2/custom-profile-gate.json`
and the adjacent page/row captures.

## UI and coverage semantics

The active display clearly identifies Top Levels versus legacy Threshold
Walls. Existing saved Threshold settings remain unchanged. Visible Range Only
changes presentation scaling only; it does not recalculate historical ranking.
“Fit Walls” adjusts the vertical price scale once, on request, without changing
time range or continuously overriding the user viewport.

Status separates live freshness from historical loading and source coverage. It
shows the loaded/available history interval and gaps, whether the current
profile is exact or unavailable for the selected settings, the latest confirmed
source time, and how much of the requested percentage band is covered by
observed levels. Partial Spot outer depth remains partial even when history is
fully loaded. Missing depth is never presented as incomplete history loading,
and incomplete history is never presented as zero liquidity.

## Validation matrix

| Area | Required evidence | Result |
|---|---|---|
| A · Full observed source | Independent raw-book test with more than 5,000 nearer levels and qualifying distant walls on both sides; live display must still identify venue depth limits | Backend regression passes. Spot native 5m chart displays the completed 30.5-hour archive view and its observed-band coverage at capture (bid 15%, ask 9% of the requested ±10% band), plus ten gaps. USD-M archive view passed with four gaps. Spot REST snapshot and USD-M depth limits remain explicit; missing outer depth is not inferred. |
| B · Eligibility | Candidate enters/leaves the band only because midpoint moves | Deterministic midpoint-only movement and re-entry identity tests pass. |
| C · Exactness | Independent rank oracle, deterministic ties, native precision, notional, minimum filter, confirmation | Independent raw-selection oracle, deterministic tie/native-precision checks, and exact custom-profile configuration tests pass in the backend suite. |
| D · Episodes | Quantity/rank patch, rank exit/reentry, observed zero, gap and replacement epoch reasons | Deterministic tests keep rank exit, observed zero, explicit gap, and replacement epoch distinct. |
| E · Archive equality | Archive query matches independent raw replay for the same profile and interval | Independent raw replay and paged archive reconstruction tests pass. Genuine 30-hour Spot and USD-M browser projections both reached the fixed watermark with page-complete requests; each chart retained the explicit gaps and partial source coverage returned by staging. |
| F · Time range | 30-hour and seven-day replay, carry-in, pages, adjacent chunks, explicit unavailable range | Both native chart views span 30.5 hours and complete their fixed-watermark paging. The Spot view uses 5m candles with 999 exact 300,000ms strides and 1,000 bars; USD-M uses 15m candles. The custom 24-hour profile remains seeded and partial while backfill advances. Seven-day mechanics are synthetic-tested; staging has only about 46 hours of retained archive, so a genuine seven-day read is unavailable. |
| G · Durability | Reload, overlap, page retry, materializer restart and retention preserve IDs with no duplicate application | Backend replay/retry/recovery tests pass in the candidate suite; post-rollout health and pinned watermarks are valid. Seven-day retention has not yet matured. |
| H · Profile isolation | Profile/settings changes cannot reuse stale pages or claim unsupported exactness | Canonical profile parsing and exact custom-setting persistence pass deterministic tests. Staging re-admission of the existing 2.5% / 25 USDT / 3s / Top 4 / $250k profile returned a valid current head; ClickHouse `FINAL` confirmed canonical metadata remained in slot 1 after repeated ticks. Its 24-hour history prefix is seeded and explicit but still backfilling; see the gate section above. |
| I · Live and viewport | Current updates continue during backfill and across pan/zoom/candle rollover | Spot chart completed 115 archive pages while the separate current lane served 85 pages / 16 patches, with zero worker failures or ring drops; captured current responses were HTTP 200 with valid heads. Spot browser JS heap rose 35.5 MB. USD-M completed 348 archive pages with 344 current pages / 505 patches, zero worker failures or ring drops, and a 265.3 MB heap increase. The USD-M capture had a 78.8-second current-confirmation gap that recovered. Both 15m Perp and 5m Spot held a manually selected ~30.5-hour time range through candle rollover; Fit Walls changed price bounds while preserving time. |
| J · Compatibility/lifecycle | Spot, USD-M, Threshold mode, hide/destroy/unsubscribe cleanup | Deterministic Threshold compatibility tests pass. The fixture-only Dockview hide/destroy browser test passes 1/1; rollover/sharing/consumer-cancel/resume subset passes 6/6; full archive suite passes 39/39. Spot and USD-M live browser legs each used one archive consumer and one history job; separate native current polling continued. |
| Performance | Cold archive read, bounded backfill work, response/pages/browser memory and seven-day archive growth | Both browser archive runs completed in about 3.6 minutes (Spot) and 18.8 minutes (USD-M). Wire/decoded bytes were 2.354/36.887 MB and 9.136/134.619 MB, with measured JS heap deltas of +35.5/+265.3 MB. Cold raw-backfill time is unmeasured; seven-day storage remains a planning estimate only. Render submission timings are not frame-rate measurements. |
| Venue checks | Genuine Spot and USD-M source checks, distinct from fixture/replay results | Post-rollout staging current profiles were valid and caught up at lag zero, and both collectors had zero depth overflows in the health capture. The browser reads include the explicit source gaps listed below. |

Backend candidate `491e7f24025ef56e4f909b593d3e9ec06321a7be` passed 154/154
tests, typecheck, build, and diff checks; the serving-only rollout reran
typecheck, 154/154 tests, build, and Compose validation. Frontend candidate
`3e735a519766809c2e88ee040c347f35c1a9dff9` passed 976 tests with one skip,
typecheck, build, and the focused fixture browser check 1/1. Separately, the
final original mixed-worktree gates after removing three temporary
network-dependent tests passed: frontend 996 passed / 1 skipped across 120
files, typecheck and build passed (with an existing 2.37 MB chunk-size
warning); backend 170/170 passed with typecheck and build. The candidate and
original mixed-tree gate results are separate evidence sets. These are
deterministic or fixture checks, not live-market proof.

## Profiling and evidence

Record machine/runtime/source identifiers and exact commands with each result.
Synthetic deterministic tests, recorded-source replay, genuine exchange
connectivity checks, staging browser behavior, and measured platform
performance are separate evidence classes. Report latency, page/response bytes,
server work, browser memory, and archive growth. Do not infer frame rate from
render submission time or transfer another host's measurement to the Pi.

The live chart capture uses `playwright.order-walls-live.config.ts` and
`tools/profile/order-walls-live-probe.playwright.ts`. Those probes are outside
the default test discovery and require the explicit
`IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1` opt-in. The dedicated config has
no `webServer` hook; start and verify staging separately before choosing one
market:

```sh
IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 pnpm exec playwright test --config=playwright.order-walls-live.config.ts --grep "live spot"
IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 pnpm exec playwright test --config=playwright.order-walls-live.config.ts --grep "live perpetual"
```

These multi-minute live probes are not part of routine test/build gates.

| Measurement | Source and bounded procedure | Result |
|---|---|---|
| Current first update | Genuine staging API, pinned Spot profile | 1.13 s to first update; 8.95 KB response; three-way fanout 11.8 ms. This predates the gzip rollout. |
| Current first update | Genuine staging API, pinned USD-M profile | 60.6 ms to first update; 9.46 KB response; three-way fanout 10.3 ms. This predates the gzip rollout. |
| First historical page | Genuine staging API, pinned Spot profile | 470 ms; 307 KB uncompressed. |
| First historical page | Genuine staging API, pinned USD-M profile | 445 ms; 435 KB uncompressed. |
| Warm 30-hour archive read | Genuine staging API, Spot profile | 105 pages, 26,832 patches, 33.93 MB uncompressed, 12.77 s; p95 page latency 303.6 ms. Not a cold raw-backfill measurement. |
| Warm 30-hour archive read | Genuine staging API, USD-M profile | 312 pages, 79,639 patches, 116.816 MB uncompressed, 70.46 s; p95 page latency 400 ms. Not a cold raw-backfill measurement. |
| Current during history | Genuine staging API, Spot profile | Tail advanced 138 cursors in 20.7 ms while historical pages were loading. |
| Current during history | Genuine staging API, USD-M profile | Tail advanced 702 cursors in 38 ms while historical pages were loading. |
| Custom current re-admission | Genuine staging API, existing Spot custom profile | HTTP 200 in 1.070 s; valid current head at cursor 14,616,314. This was a re-admission check of an already-active profile, not first-admission latency. |
| First custom history page | Genuine staging API, exact Spot 24-hour custom profile | 270 ms, seeded page with 256 patches; `availableFrom` 2026-11-02 07:42:22.994 UTC and `confirmedTo` 11:09:53.350 UTC. No source gaps in the returned prefix; requested tail was unconfirmed. |
| Custom history backfill progress | Genuine staging materializer, 15m21s bounded observation | 61,696 profile cursors advanced; source head +9,235; net lag fell 52,461 to 755,381 (about 57 cursors/s net). Linear drain estimate ~3.7h only; the 24-hour profile remained backfilling, with a 3.308-hour confirmed prefix at `2026-11-03T09:49:22Z`. Not a cold first-admission time. |
| Pinned current during custom backfill | Genuine staging API, Spot and USD-M defaults | Both pinned lanes stayed valid/caught up; their final watermarks advanced by 11,449 and 11,311 cursors from the preflight sample. |
| Full browser window | Genuine staging API and native Spot chart, fixed-watermark request | Passed in about 3.6 minutes with a 30.5-hour visible range on 5m candles (1,000 bars, 999 exact 300,000ms strides). Fixed-head paging completed at the captured watermark; 3,642 archive segments and 29,411 value runs projected with no client history limits. Report and final chart: `artifacts/order-walls/spot-30h-live-chart-report.json`, `artifacts/order-walls/spot-30h-live-chart.png`. |
| Current during browser history | Native Spot chart | 85 current pages / 16 patches; zero worker failures and ring drops. The current endpoint trace recorded 86 HTTP 200 responses, each with a valid head; maximum response interval was 5.807 seconds. JS heap increased 35.5 MB. Fit Walls preserved the visible time range. |
| Browser response volume | Native Spot chart, full 30-hour leg | 115 pages, all HTTP 200 and gzip: 2,353,768 bytes on the wire and 36,886,942 decoded JSON bytes. These browser bytes are distinct from the earlier warm API-only sample and are not a cold backfill timing. |
| Strict gzip parser | Local captured Spot current gzip response passed through `OrderWallsArchiveCurrentPoller` | One page passed the strict profile/current-page contract. The decoded 8,943-byte body deep-equaled the identity JSON; the 1,905-byte compressed `Content-Length` was preserved in browser-style accounting (0.213 wire/identity ratio). No network request was made. Summary: `artifacts/order-walls/frontend-current-gzip-parser.json`. |
| Full browser window | Genuine staging API and native USD-M chart, fixed-watermark request | Passed in 18.8 minutes with a 30.5-hour visible range on 15m candles. Fixed-watermark request completed; 32,677 archive segments and 98,541 value runs were retained with no history caps. The archive remains partial: four explicit source gaps and `confirmedTo` 3,494ms before the requested end. Report and final chart: `artifacts/order-walls/perpetual-30h-live-chart-report.json`, `artifacts/order-walls/perpetual-30h-live-chart.png`. |
| Current during browser history | Native USD-M chart | 344 current pages / 505 patches; zero worker failures and ring drops. One 78.8-second interval had no fresh confirmed-current timestamp and status moved through gap/unavailable before recovering. No per-current response trace was captured during that interval, so the cause is unconfirmed. JS heap increased 265.3 MB. |
| Browser response volume | Native USD-M chart, full 30-hour leg | 348 pages, all HTTP 200 and gzip: 9,135,891 bytes on the wire and 134,618,591 decoded JSON bytes. The Playwright response-body inspector lost access to some bodies after later navigation, but the worker parsed the pages; `historyWaitErrors` and `pageErrors` were empty and archive worker failures/ring drops were zero. |
| Perp current-only follow-up | Genuine USD-M current endpoint via Vite proxy, one page per request for 72.953s | Seven HTTP 200 responses; every head valid. Cursor advanced 18,706,240 to 18,706,939. Request latency 1.114–3.159s; source-head age 1.728–5.200s. This short later sample does not explain the earlier 78.8-second interval. No archive-history request was made. See `artifacts/order-walls/perpetual-current-only-smoke-report.json`. |
| Perp history response latency | Native USD-M chart, 348 fixed-window pages | Response-header p50 2.347s, p95 5.395s, max 22.182s. At p95: body read 55.1ms, JSON parse 9.7ms, validation 1.6ms, projector apply 17.7ms, update callback 408.8ms, and event-loop yield delay 55ms (maximum 823.6ms). These measurements do not show a 79-second main-thread stall; current-endpoint response timings at the gap were not recorded. |
| Cold 30-hour archive read | Staging archive after API rollout | Not measured; do not substitute the warm read above. |
| 30-hour raw-to-archive backfill | Existing retained raw source | Not measured separately from prior materializer operation. |
| Response bytes and page count | Warm 30-hour API and post-gzip browser reads | Warm API: Spot 105 pages / 33.93 MB uncompressed; USD-M 312 pages / 116.816 MB uncompressed. Browser: Spot 115 pages / 2.354 MB gzip / 36.887 MB decoded; USD-M 348 pages / 9.136 MB gzip / 134.619 MB decoded. API and browser measurements are separate runs. |
| Browser retained memory | Completed native full-window Spot and USD-M chart legs | On the attested Raspberry Pi 5 host, JavaScript heap delta was Spot +35.5 MB at 3,642 archive segments / 29,411 value runs and USD-M +265.3 MB at 32,677 segments / 98,541 runs. See `artifacts/order-walls/pi-browser-host-attestation.json`. |
| Pi render submission | Native full-window browser capture, same attested host | Instrumented render-submission p95/max was Spot 17.2/69.8ms and USD-M 65.8/294.9ms under headless Chromium 155 with SwiftShader software WebGL. This is not measured FPS or interactive hardware-GPU performance; see `artifacts/order-walls/pi-browser-host-attestation.json`. |
| Seven-day compact archive size/growth basis | Early `system.parts` sample and explicit scenario | 29,380,548 B on disk across six populated R2 tables at 2026-11-03 07:23:51Z. The separate seven-day planning scenario is 109.2 MB for two pinned profiles and 546.1 MB if all eight custom slots scale linearly; neither is an observed seven-day run nor a hard bound. See backend operations doc. |

The Spot 30-hour interval contained ten persisted source gaps: seven collector
capacity invalidations, two invalid Spot diff updates, and one raw ClickHouse
query-contention gap. The USD-M browser interval contained four: two depth
disconnects and two shared-disk-watermark gaps. These gaps are explicit and
are not presented as empty books or complete source coverage. At the Spot
browser capture, the status line reported 15% bid and 9% ask observed coverage
of the requested ±10% band. The source collector capacity is bounded; Spot
outer depth beyond the initial snapshot remains unknown until updates are
observed.

## Staging rollout and rollback

Before a staging rollout, record the checked-out source version, the staging
source version, application/materializer image IDs, container IDs and start
times, health, collector heads, disk state, and failed units. Read the deployed
`CHECKPOINT.md`, `CHECKPOINT-HISTORY-TILES.md`, `docs/CONTRACT.md`, and current
rollout script before changing a service. Apply only the additive R2 migration,
build and replace only the authorized history API/materializer services, wait
for readiness, and assert the Spot and USD-M collector container IDs/start
times and durable heads are unchanged. Do not restart the collectors to refresh
history or repair API/materializer state. No production deployment is implied
by staging validation.

Keep a recoverable copy of the R2 source/migration and the prior app/materializer
images, health/identity snapshot, rollout output, and source hashes. Roll back
by restoring only the prior app/materializer images and keeping the additive
archive table/data; do not delete raw source history or run a destructive
retention operation. Verify health, backlog, collector identities, and both
market heads after either direction.

### Source and deployed identifiers

| Component | Candidate/source version | Deployed version | Validation |
|---|---|---|---|
| Frontend candidate | `3e735a519766809c2e88ee040c347f35c1a9dff9`, based on `688e071` | Local Vite staging client only; no frontend bundle deployment | 976 tests passed, one skipped; typecheck/build and focused fixture browser test 1/1 passed |
| Live profiling harness | Separate commit `21323b838feca265b672d4680c0c2dff31566ea1` | Local-only `tools/profile/`; explicit environment opt-in and no service startup | Default Playwright discovery selects no live probe; dedicated config lists Spot and USD-M probes. This tooling commit is separate from the product source commit. |
| USD-M backend | `491e7f24025ef56e4f909b593d3e9ec06321a7be` | Staging `/opt/iqterminal`, same source commit, deployed `2026-11-03T09:28:59Z` | Materializer healthy/unpaused; pinned current valid and caught up during custom backfill |
| Spot backend | `491e7f24025ef56e4f909b593d3e9ec06321a7be` | Staging `/opt/iqterminal`, same source commit, deployed `2026-11-03T09:28:59Z` | Materializer healthy/unpaused; pinned and custom current lanes valid/caught up |
| Archive profile/schema | Schema 1, algorithm 1; Spot `binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1`; USD-M `binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1`; custom `binance-spot-btcusdt-feed-spot-diff-depth-band-2_5pct-agg-25usdt-top10-a1-s1-confirm-3000ms-n4-minusd-250000` | Defaults served by `491e7f24025ef56e4f909b593d3e9ec06321a7be`; existing custom profile remains bounded in slot 1 | Exact custom metadata persisted after repeated coordinator ticks; 24-hour history still backfilling |

### Rollout result

The initial R2 rollout used `8ef1793e6d5d6a1d1fbe35c36e593c1a312319e5` at
`2026-11-03T07:18:58Z`. The latest serving-only rollout deployed
`491e7f24025ef56e4f909b593d3e9ec06321a7be` at `2026-11-03T09:28:59Z` with
`ops/order-walls-r2-rollout.sh --skip-migration`; all seven tables were already
present. It rebuilt/replaced only the history API and Spot/perpetual
materializers. The original pre-R2 rollback baseline remains
`15e9175bf6d397ddb0ca29f055b7b37386f35b71`. Spot and USD-M collector IDs and
start times were unchanged. Production was not deployed.

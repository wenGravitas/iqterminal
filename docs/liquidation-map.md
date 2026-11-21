# Native Liquidation Map

On a BTC perpetual chart choose **Indicators → Liquidation Map**. Settings, visibility
and removal use the native Object Tree/header controls and survive workspace saves.
Select venues independently; leverage buttons filter model scenarios, not observed
account leverage. Unclassified observed positions have a separate toggle. Swing and
Scalping presets change filters/lookback without restarting server collection.

The cells show outstanding conditional exposure at native venue price thresholds.
They are not orders or confirmed liquidation reports. The cyan/green/yellow/red
scale represents filtered amount; fixed maximum 0 selects automatic scaling. BTC
is the common quantity. Native quote mode includes only a verified matching chart
quote; USD, USDT and USDC are not silently converted. Lighter quote denomination is
still unverified and excluded from that valuation. Source availability, sample age,
accounts, fresh/stale/located/unknown quantity and coverage appear in settings.

The right profile defaults to the latest snapshot, including when viewing older
history. Enable crosshair following for an as-of profile. Its filters and screen
price grouping match the map. It never sums positions over time. Hover reports
source/side/scenario contributions, native threshold, risk identity and historical
source coverage. Scenario ranges are uncalibrated model ranges.

Hyperliquid/Lighter are real bounded observed subsets, with inactive undiscovered
accounts missing. Binance inventory estimation runs but bands require a verified
current risk document. Bybit isolated scenarios use current public tiers and
explicit fee/funding assumptions. Coinbase derivatives are unavailable pending
verified gateway inputs. No source substitutes fixture data when unavailable.

The dedicated feed worker acquires bounded history, deduplicates requests, caches
up to 32 MiB and sends coalesced Float64 transferable buffers. Resident columns and
native canvas geometry survive normal horizontal navigation; detail changes retain
old coverage until replacement arrives. No exchange sockets, model estimation,
per-cell DOM or extra graphics contexts are added per chart. Hide retains warm data;
remove/dispose releases subscriptions and primitive resources.

## Validation and benchmarking

- `pnpm exec vitest run tests/liquidation-map.test.ts tests/indicators.test.ts`
- `pnpm exec playwright test tests/browser/liquidation-map.spec.ts` (explicit fixture UI lifecycle only)
- `node scripts/liquidation-map-live-smoke.mjs` (real staging data)
- `IQ_MAP_BENCH_URL=http://127.0.0.1:4183/ node scripts/liquidation-map-navigation.mjs`

The benchmark uses the same pan/zoom operations with the map hidden and shown and
records elapsed navigation, network calls, frame intervals, primitive CPU time,
resident counts, heap and errors as JSON. Headless Pi measurements are not foreground
acceptance. The current approximately 67 ms p95 result misses the 33 ms target in
both phases. Nonempty resident arrays are not proof of zero visual blank frames.
Keep quiet-Pi, foreground, cold/warm reopen and broader chart-switch acceptance
separate. Diagnostic globals exist only in explicitly enabled diagnostic builds.

Compiled staging releases use the incumbent versioned static-server deployment and
same-origin route manifest, including the separate Liquidation Map port 18894. The
Vite development server is not needed for deployed static assets. Do not promote a
candidate over the known-good staging release if its release gates fail.

Backend methodology, official capability references, retention/quotas and rollback
are documented in `iqterminal-server/docs/liquidation-map.md`. Real-data screenshots
and benchmark JSON are under `artifacts/liquidation-map/`; fixture UI tests are not
real-feed acceptance or evidence of predictive accuracy.

Worker diagnostics separate response-header latency, body transfer, JSON decode,
worker elapsed time, payload bytes and backend `Server-Timing`. Run
`scripts/liquidation-map-lifecycle.mjs` against a diagnostic compiled build to measure
cold acquisition, warm remove/reopen, timeframe changes, reload persistence and a
new live collection sample. Its cache test is distinct from an HTTP reload: a new
page creates a new worker, while server history remains durable. Overlapping pans
reuse cached coverage and request missing edges; server cursor resets explicitly
clear obsolete worker history before reacquisition.

Private candidate deployments may use a separate Serve HTTPS port and deployment
root. The deployment guard rejects existing ownership on the requested port while
preserving unrelated Serve ports. This permits candidate verification without
replacing the known-good staging release.

Validation at integration: 24 focused frontend/model/worker tests and the native
browser lifecycle/profile inspection tests passed (2/2). Static proxy/port-ownership tests passed
9/9. Full frontend runs had resource-sensitive 5-second timeouts in unchanged
trading-vault/order-wall checkpoint tests; both files passed separately (8/8 and
10/10). No test was disabled or its timeout increased. The full backend suite
passed 488 tests before the final storage/API additions; the final feature suite
passed 28 focused tests including restart/replay, compression/memory eviction,
idempotence, as-of pagination and quote valuation. Typechecks/builds passed.

The Lighter account response has no verified position event timestamp: its recorded
source time is explicitly a receipt-time proxy from the venue indexer, not settled
chain time. Hyperliquid supplies a source-reported clearinghouse time. Neither
observed subset is a verified exhaustive venue inventory.

The API uses gzip for JSON delivery when accepted, while existing binary wall
routes remain unchanged. Retained coverage entirely resident in memory is served
without rereading journal files even when the viewport begins before collection.
The isolated release slot pool includes 4184/4185 so candidate upgrades can retain
both the incumbent staging release and previous candidate without stopping them.

The final backend stores a compact byte-offset index for retained stock snapshots,
selecting time-bucket revisions before reading/decompressing cells. This avoids
rescanning all normalized account/trade inputs when navigating older history.
The index is rebuilt from the checksummed journal on restart; full-retention startup
latency has not yet been verified. A recent aligned sample was approximately
228 MB/day (1.60 GB/week); the feature quota is 2 GiB, resident payload cache 32 MiB,
and free-disk floor 40 GiB. These are bounds, not a retention guarantee.

In loaded-Pi compiled-client samples, the corrected resident-history/gzip path
reduced worker acquisition on reload from 20.1 s to 1.3 s; body time fell from
10.4 s to 27 ms. Warm remove/reopen issued zero network requests. Workload and
collection state evolved between runs; this is not a controlled accuracy or
quiet-machine claim. The 33 ms foreground frame target remains unverified.

The v3 model separately reports bootstrap, unresolved-input, conditional-crossing,
bounded-retention and legacy unlocated mass. Actual CEX collateral remains unobserved
for the entire estimated stock; this uncertainty overlaps scenario quantities and
is not added to them. Snapshot source statistics cover all scenarios, independently
of the currently filtered profile. Paid funding and indicated funding rates are
recorded separately; own-mark crossings use sampled venue marks.

Worker viewport updates retain one pending request per subscriber, freeze the
request grid metadata and cap shared flights at eight. A confirmed server cursor
reset advances a cache generation so obsolete worker and resident view data cannot
be reused after recovery. Late completion cannot repopulate a disposed service.

Fine time requests carry the preceding stock snapshot into a viewport boundary.
Time-resolution changes retain previously loaded coarse columns until finer
snapshots replace them; known empty/closed snapshots terminate older bands.
Changing price grouping requests a new display grid while server model history
continues unchanged. Benchmark screenshots can be redirected with
`IQ_MAP_BENCH_SCREENSHOT` to keep a clean release checkout.

Forming footprint totals use the current live execution bar, including executions
whose native price is finer than the order-entry tick. These prices are preserved
in OHLC and grouped into the selected price row without rounding onto another
row. This was verified against Binance aggregate execution 3537588311 at
57086.83; rejecting that execution had stalled the 5-minute current materializer.

Dense history uses adaptive time LOD. The worker initially targets roughly 64
as-of columns and retries at a coarser time interval if the retained payload or
transfer-cell budget would be exceeded. Learned resolution is reused on warm
reads. This preserves the requested time coverage, price grid, source/scenario
identities and stock-snapshot semantics; it never sums stock across time or
raises the 8 MiB per-payload, 32 MiB cache or 100,000-cell IPC limits. Loaded
coverage remains visible while replacement detail is acquired. The chart shows
an explicit loading message before the first response and distinguishes failures
with no loaded data from failures that retain an existing map.

Cell/profile hover uses the same native popup card styles as Net Longs/Shorts.
It groups source contributions using the map's scenario means (never the sum of
alternative scenarios), distinguishes observed subsets from model estimates, and
shows the snapshot, price interval, age, coverage and model/risk provenance. The
card stays inside the primary price plot, even when lower indicator panes are
present or reordered, and dismisses when the pointer leaves that plot. Repeated
pointer moves within one cell reuse its card content until data or age changes.

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

Validation at integration: 21 focused frontend/model/worker tests and the native
browser settings/hide/remove test passed. Static proxy/port-ownership tests passed
9/9. Full frontend runs had resource-sensitive 5-second timeouts in unchanged
trading-vault/order-wall checkpoint tests; both files passed separately (8/8 and
10/10). No test was disabled or its timeout increased. The full backend suite
passed 488 tests before the final storage/API additions; the final feature suite
passed 19 focused tests including restart/replay, compression/memory eviction,
idempotence, as-of pagination and quote valuation. Typechecks/builds passed.

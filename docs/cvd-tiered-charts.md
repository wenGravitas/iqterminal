# Optional tiered CVD chart subscriptions

The real chart subscription path now connects the exact contribution owner,
resident projection cache and finite acquisition planner. It is selected only
when `VITE_DATA_MODE=staging` and `VITE_CVD_TIERED_HISTORY=1` are both set.
The default remains the incumbent CVD service. Explicit development fixtures
continue to select the incumbent fixture service and dispose real transports;
there is no fixture or numeric-legacy fallback for failed tiered reads.

## Periods, quantities and rendering

`CvdDataController` supplies its bounded host candle grid to the worker. Forming
OHLC-only changes, cosmetics and hidden-tab painting do not replace a history
subscription. Timeframe changes retain the controller/model while requesting a
new projection. Accepted inputs remain in the shared owner after a panel leaves.

The projection cache now supports daily and Monday-weekly UTC resets. Each new
period resets both the cumulative amount and accumulated coverage quality, so
an earlier period's gap does not contaminate a later complete one. A custom or
continuous anchor inside the first display bucket clips that interval to the
anchor; pre-anchor flow is excluded. Cached interval summaries remain exact and
can be reused across compatible grids without inferring finer detail.

Tiered chart points carry paired `baseText`/`quoteText` as well as final Float64
render values. The model adds source/group totals using decimal text before
final numeric conversion; cancellation of large opposing values does not erase
small residual totals. Known empty intervals remain distinct from missing data.
Native numeric outputs retain their existing schema IDs and timestamp domain.
Rendering and hover connectivity use the declared time grid, preserving gaps
and reset boundaries for 5m/hourly/daily points. The native DOM controls, theme,
chart scheduler and GPU context budget are unchanged.

## Scheduling and lifecycle

The adapter admits at most eight chart subscribers, 5,000 display points per
source/view and 32 MiB of encoded retained chart frames. The owner/cache/stage
bounds remain independently enforced; encoded budgets are not RSS claims.
Each client has one in-flight acknowledged batch. Coalescing behind ACK retains
a complete bounded state; ordinary same-grid updates emit changed points.
Old generation acknowledgements cannot release a new client's frame.

There is at most one current poll and one background viewport turn. Both use
the shared owner's bounded transfer admission. A current poll can queue behind
an admitted historical page ahead of the next page; it waits for cancelled
transport bodies to actually drain. Readiness/byte/version checks use lightweight
metadata rather than scanning retained day catalogues on every timer tick.

Current native polls request the previous closed minute plus the forming
minute, nominally once per second. Background acquisition excludes the forming
minute already owned by that poll. Current response clocks remain scoped to
their returned range; an unrelated historical reply cannot refresh a failed
current poll. Empty/awaiting native sources retry without pinning an empty basis.
Disabled/inconsistent sources or changed native incarnations stop automatic
polling while retaining prior observations; retry never resets their basis.

Background turns rotate across consumers/sources. An active sealed-day
reconstruction is finished before opening another cold reconstruction, avoiding
repeated partial replay under interleaving. Successful restore progress renews
a **60-second idle expiry**, bounded by a **ten-minute absolute lifetime**.
Duplicates or pages with no missing accepted record do not renew it. Existing
four-stage, 32-page, 32 MiB and checksum limits remain. Final restore changes
residency only, not accepted totals, masks, provenance or data version.

Each source/viewport has a finite 4,096-turn, 512 MiB response and 30-minute
monotonic loading budget. Transient unavailable/capacity results have at most
three backoff retries (5/30/120 seconds), reusing accepted coverage and bounded
continuation. Invalid/conflicting/expired-native/lineage failures are not retried
as transient archive reads. Internal turn deadline yields may resume within the
overall budget. Disposal aborts demand, clears timers and leaves shared accepted
inputs independent of panel/network lifetimes. `FeedClient.retryCvd(panelId)` is
an explicit bounded retry; it never authorizes native rejoin or financial serving.

## Configuration and rollback

After approved backend configuration/qualification, the selected backend needs
the independently disabled exact-native and leased-minute interfaces:

```text
IQ_CVD_EXACT_V2=1
IQ_STORAGE_RECORDED_MINUTE_HISTORY=1
IQ_STORAGE_RECORDED_MINUTE_LEASES=1
IQ_STORAGE_HISTORY_CONFIG=/private/path/to/reviewed-history-config.json
```

These names do not provision a provider, create source continuity evidence or
enable safe history deletion. Use the backend storage migration/restore guide
and private least-privilege configuration. OI's client flag remains independent.
The client remains on the shared `dev` checkout. Remove the opt-in flag and
reload/rebuild the client to return to the incumbent service. No backend schema,
live TTL, production deployment or source history changes occur in this increment.

## Evidence and remaining gates

139 focused source tests passed. Typecheck and both disabled/selected builds
passed. Three selected headless Pi browser checks passed: production-worker
admission, the exact-cache component fixture and a full app/chart fixture.
The latter renders two days of sparse controlled warm data, verifies nonzero
segments on 5m and 1h grids, reuses all history through an origin outage and
timeframe change with no new archive GETs, and retains one chart subscription.
Three loopback proxy checks passed for Vite, preview and static serving, preserving
CVD queries, lease methods/token headers and retry metadata. Six backend
admission/gateway cases passed; exact CVD pages now share the historical limit
and preserve the health reserve. Gateway fixtures verify spot/perpetual collector
selection and disabled lease endpoints stay local. These are protocol fixtures,
not real SQL/provider throughput checks.

A separate incumbent fixture check passed hidden-tab data/painting retention.
Both paths use the actual chart/controller/worker, with explicit test transports.

```sh
IQ_TEST_CVD_HISTORY_OWNER=1 IQ_TEST_CVD_PROJECTION_BENCH=1 IQ_TEST_CVD_TIERED_CHART=1 pnpm exec playwright test --config tests/browser/cvd-history.playwright.config.ts
```

This is controlled functional evidence, not provider, foreground Pi or live
ingestion acceptance. It does not establish current/24h/7d/30d real-history load
percentiles or an improvement over the incumbent chart. Forming buckets retain
strict partial coverage until confirmed; provisional display/quality policy
still needs acceptance. Older hot windows are not continuously reconciled by
the two-minute current poll. Bounded older-native correction discovery/repair,
native lineage/rejoin and historical correction authority remain open. Large
fragmented catalogues, concurrent restores, maximum group/chart loads and
real-provider failure/throughput require qualification before enabling this path.

The implementation is disabled and undeployed. It supports the existing three
CVD BTCUSDT sources (Binance spot/perpetual and Bybit perpetual), not new venue
collection. The whole storage objective remains incomplete.

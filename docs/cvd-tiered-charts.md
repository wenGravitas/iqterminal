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

143 focused source tests passed after the older-native correction increment. Typecheck and both disabled/selected builds
passed. The preceding chart increment passed three selected headless Pi checks:
production-worker admission, the exact-cache component and a full app/chart fixture.
The correction increment additionally passed both warm and native-correction
variants of the full app/chart fixture.
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
still needs acceptance. Older hot windows now have a bounded background observation sweep described
below. Native lineage/rejoin and archive correction authority remain open. Large
fragmented catalogues, concurrent restores, maximum group/chart loads and
real-provider failure/throughput require qualification before enabling this path.

The implementation is disabled and undeployed. It supports the existing three
CVD BTCUSDT sources (Binance spot/perpetual and Bybit perpetual), not new venue
collection. The whole storage objective remains incomplete.

## Older native observations

Completed viewport tasks contribute their required native-owned anchor prefixes
to a shared newest-first sweep. Reads are at most one UTC-aligned hour, with one
repair active and at least five seconds between starts across all sources. A
finished source sweep pauses sixty seconds before restarting. It never reads
below the greater of the fixed native cutover, latest server retained horizon
and local seven-day bound, nor overlaps the latest two-minute poll. A source
cursor survives viewport changes so rolling live windows do not continually
restart the newest hour. Duplicated chart demand shares the source cursor.
No archive reads are introduced for cached warm windows.

Current polling remains ahead of background admission. Older checks are marked
`X-IQ-History-Priority: background`; worker scheduling, native HTTP timing and
guarded SQL transport preserve that demotion. SQL admission lets queued visible
work proceed first and keeps the current reserve. The header cannot promote
history to current priority. A background check requires the SQL proxy health
contract to advertise `historicalReadGuard.backgroundPriority: true`; older
proxies refuse the check before SQL rather than silently upgrading its priority. SQL row/byte/time guards are unchanged. Five-second
spacing is an operational bound, not evidence that this cadence is acceptable
under representative live load; qualification is still required.

Three consecutive failed attempts stop the source sweep until explicit retry.
A failure keeps loaded frames stale through successful current polls; only a
successful repair of that cursor clears its repair fault. Conflicts, malformed
responses, restore requirements or foreign incarnations stop immediately.
Diagnostics expose source cursor, retry/blocked state and the last successful
page observation time; none grants current/financial authority.

Automatic acquisition keeps retained native days resident for hourly correction
replacement. As the observed server horizon crosses UTC days, expired native
days compact to their original exact totals, presence/coverage masks and hashes,
including incomplete days. This changes residency only. An expired native basis
still cannot be silently filled from an archive. A single source's seven-day
native horizon is about 10,080 minute cells under the existing 32,768 resident
cell cap; bounded archive restoration shares the same cap. No server data,
retention or archive ownership changes.

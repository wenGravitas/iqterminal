# Worker-owned CVD observation admission

`CvdHistoryOwner` is the worker-lifetime owner of up to three exact contribution
ledgers: Binance spot/perpetual and Bybit perpetual BTCUSDT. The production feed
worker instantiates it only as an enabled transport when **both** staging data
mode and `VITE_CVD_TIERED_HISTORY=1` are selected. The flag defaults off. It does
not replace `CvdService`, subscribe charts, poll, backfill, change retention or
activate a backend route. No fixture fallback is provided. Explicit fixture
selection disposes its real transport and releases known leases.

## Admission and ownership

`FeedClient.readCvdHistory(request, signal)` sends a typed, individually identified
worker request. A request selects a supported source, native/archive/restore
operation and aligned window of at most 24 hours. Native requests use `/v2/cvd`
full projections; the returned range must match exactly. A first successful
native observation pins the retained horizon and incarnation through the
[contribution ledger](cvd-contribution-ledger.md). Archive admission requires
that basis and a window entirely before its fixed cutover. Restore operations
can rehydrate already accepted native or archive cells under the existing hash
and coverage checks; they grant no correction authority.

One owner admits one transport operation, four queued distinct windows and at
most 24 consumers. Equal operations coalesce. Cancelling one caller removes its
demand only; the remaining consumers continue. Cancelling the last consumer
aborts the read, but the owner keeps its admission until the actual transport
and body cancellation settle. This is separate from the shared history
scheduler's early consumer rejection. No retry or alternate-publication fallback
occurs on failure. The 12-second owner deadline and 20-second main-thread caller
deadline bound admission/demand; a transport that ignores cancellation can keep
the slot occupied until it actually drains. Disposal waits for that drain.

Native work has priority 0 and archive work priority 2 in the existing shared
history scheduler. The owner's finite queue is FIFO; admitted archive reads
cannot be preempted into an extra transfer. This path does not own live ingestion
or the incumbent CVD poller.

The one shared minute session pins a source and a bounded 31-day scope. Sequential
reads reuse it while valid. A caller requesting another scope, an expired or
quarantined session, or an exhausted page/byte budget explicitly causes release
and acquisition of a new bounded observation lease. There is no background lease
renewal. Tokens remain in headers, never events, URLs or diagnostics.

Accepted observations survive request completion, cancellation, client release,
archive outage and failed admission. Complete accepted archive windows return
their exact retained totals without another HTTP request or lease acquisition.
Cache-only `sum`/`series`, [resident exact projections](cvd-projection-cache.md)
and explicit `evict` are available to worker consumers.
Eviction preserves exact block totals; a missing partial-block projection reports
the ledger's restore requirement rather than inventing detail. The contribution
ledger's finite day/cell/provenance limits remain enforced. The optional
[viewport planner](cvd-history-window.md) now compacts completed immutable days
and stages fragmented restoration. There is no general background compactor or
durable browser restart recovery; reaching a limit keeps earlier data and
refuses new work.

## Restart safety

A changed native process incarnation returns `rejoin-unavailable` and preserves
the existing basis. A matching recent aggregate window and a larger watermark
cannot prove continuity of expired inputs. Neither an upload clock nor an
incarnation UUID is durable source lineage. There is no automatic ledger reset,
cross-incarnation revision comparison or rebase. Qualified durable source
identity, accepted-input preservation and a staged atomic rejoin protocol remain
backend/client work. Current legacy Binance and Bybit data cannot be silently
enrolled in the optional Binance empty-genesis execution journal.

`ready` diagnostics means the observation was admitted, not that a venue feed is
live or reconciled. Receipts retain exact decimal strings, coverage counts,
version and false financial/current-reconciliation authority. Source failures
are sanitized. There are at most 24 outstanding main-thread requests; cancellation,
timeout and disposal remove timers/listeners and ignore late replies.

## Validation and remaining work

79 focused source tests passed across the owner, client, ledger, session, exact
archive decoder and incumbent CVD/client tests. Typecheck and a build with both
optional history flags disabled passed. A real production feed worker passed a
headless Chromium fixture on Raspberry Pi 5: native plus leased archive admission,
exact values beyond Number precision, cached duplicate with no request, uncached
503 preserving accepted state, and fixture selection releasing the lease.

The fixture is explicitly selected with `IQ_TEST_CVD_HISTORY_OWNER=1` against an
isolated Vite staging server with `VITE_CVD_TIERED_HISTORY=1`. It uses controlled
HTTP data and no real exchange/provider. It does not establish live latency,
foreground rendering performance, 24-hour/seven-day/30-day loading, sustained
growth or provider recovery. No p50/p95 improvement is claimed.

[Finite viewport acquisition and staged restoration](cvd-history-window.md) are
now implemented, together with the [opt-in chart adapter](cvd-tiered-charts.md).
Next gates are current/provisional quality, older correction/continuity and live
performance qualification. Existing production charts continue to use
their incumbent CVD service. Rollback is removal of the opt-in client flag and a
client reload; there are no server migrations, source deletions or live policy
changes in this increment.

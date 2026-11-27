# Exact CVD projection residency

The optional worker history owner now retains display inputs separately from
its minute cells and transport sessions. `FeedClient.projectCvdHistory(request,
signal)` sends a cache-only worker query. It never opens a lease or starts HTTP.
It remains behind the existing default-off staging `VITE_CVD_TIERED_HISTORY` flag.
The incumbent chart service is unchanged; this is not yet its chart adapter.

## Contract and correction handling

Version 1 `exact-observed-cvd-projection` returns exact decimal strings, a pinned
worker basis, explicit anchor/range/resolution, ledger version, per-point
availability/observation/partial flags and false financial/current-reconciliation
authority. One query uses one explicit anchor. Daily/weekly resets and plot
aggregation still need chart adaptation; a caller must not treat this as an
already period-adapted `CvdSeries` or convert individual input deltas to Number.

Before a successful contribution transaction, the owner captures exact sums for
the affected portion of each cached interval or prefix. After admission it
replaces only those portions, then recomputes the affected cumulative suffix.
Unchanged earlier points are reused. Complete cached intervals can provide old
values even after their minute cells have been evicted. A foreign incarnation
still refuses before admission; projection caching grants no lineage or
correction authority. Failed contribution transactions leave projections intact.

The prefix and interval summaries retain separate known, covered and observed
counts. A known empty interval differs from unknown history. Filling missing
history can clear partial flags without adding the same contribution twice.
Exact large signed values survive prefix and suffix adjustments.

An identical query reopens its cached points without reading minute cells.
Panning within cached coverage reuses its exact interval sums and accumulated
prefix. Zooming out may combine finer cached intervals. Finer detail is never
inferred from coarse totals. An extension can combine accepted cached intervals
with resident detail where available. Unavailable boundary detail reports a
restore requirement instead of clearing prior projections or inventing data.

An update that cannot be represented within capture/cache bounds preserves the
old point array and its old ledger version with `stale: true` and an explicit
`restore` or `capacity` failure. A known missing day is returned as
`requiresRestore`. A subsequent cache query may rebuild from available detail;
failure retains the old result. Stale here describes the projection's relation
to admitted contributions, not network freshness. Consumers must separately
overlay the owner's transport/source state. An unaffected cached projection can
retain an older global ledger version because unrelated ranges changed.

## Bounds

- At most 24 cached queries, 65,536 total points and 16 MiB of encoded cache data.
- At most 10,082 points and 4 MiB encoded output per query.
- At most 4 MiB of encoded before-admission captures per transaction.
- Least-recently-used entries are discarded under cache pressure; delivered
  renderer inputs remain owned by their consumers.
- Main-thread read and projection requests share the existing 24-request limit,
  cancellation cleanup and timeout. No network or request lifetime owns these
  cached points.

Encoded byte budgets include summaries and conservative per-entry metadata
reserve; they are not a claim about total JavaScript heap/RSS. Point/entry/capture
bounds separately constrain object counts. Diagnostics expose entries, points,
encoded bytes, hits, builds, updates, recomputed points, evictions and stale
updates. The cache does not automatically compact the contribution ledger,
schedule restores, persist a browser restart or select history to acquire.

## Verification

95 focused source tests passed, including cache navigation after eviction,
coarser/finer resolution behavior, coverage repairs, exact suffix corrections,
failed transactions, capacity refusal, source isolation and a synthetic full
year of daily projections. That yearly shape test is not a measured ingestion
rate or a retained real-market dataset.

Typecheck and a history-disabled build passed. Two headless Pi Chromium tests
passed: the actual production worker command/transport fixture and a dedicated
worker component benchmark. Reproduce both with:

```sh
IQ_TEST_CVD_HISTORY_OWNER=1 IQ_TEST_CVD_PROJECTION_BENCH=1 pnpm exec playwright test --config tests/browser/cvd-history.playwright.config.ts
```

The isolated server binds localhost port 5185, refuses port reuse and never maps
a headed window. The benchmark attachment records its full configuration and
results. Its controlled in-memory transport supplies 20 complete-coverage daily
archive pages with 40 sparse execution rows. It builds 5,760 five-minute points,
evicts all 20 historical minute-cell days, pans to 2,880 points, zooms out to 480
hourly points and times 25 cached reopens.

On Raspberry Pi 5 Model B Rev 1.0, Chromium 156.0.8078.79 / Debian 12, the initial
run measured a single first-build sample of 98.1 ms; cached worker query p50/p95
was 9.2/11.7 ms and main-thread worker roundtrip p50/p95 was 21.3/25.8 ms. This is
controlled component evidence, not historical API or foreground chart latency.
There is no matching pre-change percentile baseline, so no performance
improvement or live-ingestion acceptance is claimed. Real provider, multi-chart,
current/24-hour/seven-day/30-day interaction and concurrent ingestion tests
remain required.

## Remaining integration and rollback

Viewport acquisition, archive fragmentation handling, multi-page restoration,
period-aware chart output and foreground performance remain open. New queries
do not silently fill those gaps with fixtures or legacy numeric data. Remove
the client opt-in flag and reload to disable the feature. No backend runtime,
source retention, server deployment or history deletion changes are required.

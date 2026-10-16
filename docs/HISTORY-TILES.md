# Prepared staging history

The Pi client loads visible history through a shared two-request scheduler. The
300-bar footprint limit is a retention ceiling; opening a chart no longer fetches
300 bars. A small live footprint bootstrap establishes the acknowledged execution
cursor, then only visible closed bars are requested. Heatmap requests align to
closed time buckets and 64-row price blocks. Identical reads across panels share
one request; aborting a panel removes only its reference. Subscription and viewport
generations guard application of late results.

The worker uses `/v2/history/manifest`, `/tiles`, `/current` and `/footprints`
through the existing private `/market-data` route. The server incrementally
accumulates validated depth once and stores sparse closed sufficient statistics.
Opening prepared history does not reconstruct raw depth. A missing configuration
queues bounded reusable materialization, with explicit building/unavailable/gap
states. Five-minute rows at $10/$25/$50/$100/$250/$1,000 are prepared directly;
other supported time/price widths are built directly on demand. Coarse-price peaks
are simultaneous states, never sums of independent fine-row maxima.

Each identity includes venue, market, instrument, standard diff-depth/RPI exclusion,
calculation version, aligned time, time width, integer price ticks, price block and
revision. The server publishes payloads before manifests. Content hashes retain
revisions on idempotent retries; canonical corrections publish new revisions.
Cached history validates against metadata rather than raw replay. Corrections to
source data must explicitly enqueue affected ranges; out-of-band database edits
are not automatically detected.

IndexedDB stores individual revisioned tiles asynchronously with a 24 MiB serialized
payload budget, 4,096-record ceiling and 512 KiB per-record ceiling. It is disposable:
a cache failure falls back to authoritative server reads. Partial edge blocks carry
row masks so vertical panning fetches missing rows without claiming that an entire
block was cached. Overlapping time ranges reuse retained tiles. Forming state is
never restored as durable closed history. The compressed column-major Float64 wire
format preserves the same display numbers as JSON, including null versus zero.
Authoritative integrals remain exact integer statistics on staging.

The chart retains its existing renderer and settings. A wide viewport selects an
explicit suitable row width under the 512-row/16,384-cell request bounds. It exposes
recorded distant levels rather than claiming a deeper complete exchange snapshot.
Per-side coverage, partial outer subtotals, known covered zero, unknown cells, gaps,
and reconnect epochs remain distinct. The footer reports effective row width and
partial/unavailable coverage. Hover retains the existing coverage semantics.

## Local operation and rollback

```
pnpm tunnel:staging
pnpm dev:staging
pnpm test
pnpm run build
node scripts/check-history-cache.mjs
node scripts/benchmark-history-tiles.mjs --phase=prepared --scenario=fixed --samples=5
node scripts/benchmark-history-tiles.mjs --phase=prepared --scenario=warm --samples=5
node scripts/benchmark-history-tiles.mjs --phase=prepared --scenario=wide --panels=2 --samples=5
node scripts/benchmark-history-tiles.mjs --phase=prepared --scenario=current --samples=5
```

The benchmark uses actual local Chromium and the SSH/Vite route. No fixtures are
substituted for connectivity. Completion requires all available visible footprint
and heatmap history and authoritative validation; cached first display is separate.
It records request bytes, server-local stage durations, client decode/merge/apply
metrics, cancellations, heap and long tasks. Fixed benchmark bounds are
2026-10-13 07:40–11:40 UTC, five-minute buckets, $10 rows, $82,910–$84,330.
The wide case requests $50,000–$150,000 and two overlapping panels.

`--scenario=first-use --samples=5 --timeout=600000` explicitly invokes the staging
`ops/history-evict-benchmark.sh` job in named tmux before each sample. This backs up
and evicts only this fixed window's new regenerable manifests/footprint cache,
leaving raw observations, executions and payload tiles intact. Do not use this
scenario against another deployment without reviewing those exact predicates.
`ops/history-restore-benchmark.sh` restores the backup if the test is interrupted.

To roll back client serving, restart Vite with `VITE_HISTORY_TILES=0` alongside the
existing staging environment. This selects the retained legacy bounded replay path.
Do not disable the backend v2 flag while a prepared-only client is still running.
No source data or IndexedDB deletion is required to roll back. Staging operations,
retention, migration, correction and supervisor details live in the backend's
`docs/HISTORY-TILES.md` and `CHECKPOINT-HISTORY-TILES.md`.

Measurements and remaining limits are recorded in `history-performance.md`.

## Live boundaries and resource ceilings

Prepared closed footprints are presentation replacements. They do not seed the
live accumulator or advance its acknowledged cursor. This separation prevents a
late history response from adding already-aggregated quantities to a subsequent
execution replay, including the bucket rollover race. Stored tile revisions become
closed-bar render revisions, so a correction with an unchanged execution count
still invalidates the affected bar. Visible history and the latest live bar take
priority over offscreen bars at the existing display cache ceiling. The live
accumulator remains independently bounded by its existing bar/cell limits.

Live heatmap updates replace only the forming bucket. Closed manifests validate
at most every 30 seconds during an unchanged view, and at bucket rollover or a
connection/continuity change. Price/time viewport changes immediately request the
new visible geometry. Closed history is retained while reconnecting, with stale or
catch-up status; unvalidated book state is never carried across source gaps.

The historical request ceiling remains four hours. Longer visible ranges are
explicitly capacity-limited. At most 300 displayed footprint bars and 20,000 cells
are retained per shared configuration; multiple widely separated panels can reach
that existing ceiling. Heatmaps expose effective time/price resolution rather than
claiming that a coarser grid is the original requested detail. Cache LRU touches
are coalesced to one per minute to avoid rewriting warm payloads on every read.

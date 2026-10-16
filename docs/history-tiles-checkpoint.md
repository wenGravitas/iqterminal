# Prepared history goal checkpoint

Active goal: durable prepared heatmap tiles, viewport-first shared history loading,
exact coverage/aggregation, broad recorded liquidity, five-sample Pi-to-staging
measurements, supervised services and reversible rollout. No push authorized.

Initial local HEAD: 5fcc000. Preserve the unrelated uncommitted dotted POC change
in src/chart/terminal-footprint.ts; exclude it from this goal's commits.
Backend root verified /opt/iqterminal on staging. Existing uncommitted replay and
admission changes predate this goal; preserve separately. No backend AGENTS.md
found at / or /opt or repository root. Source data stays on staging.

Baseline fixed visible window: 2026-10-13 07:40:00 through 11:40:00 UTC
(1791877200000..1791891600000), 5m / $10, Binance USD-M BTCUSDT standard
diff-depth, RPI excluded. Record actual normalized query bounds and visible edge
coverage; the legacy four-hour query clamp can consume margin at the left edge.
Use current four-hour view separately. Backend collection currently healthy,
~2.37 GB total ClickHouse parts, ~227 GB filesystem free, no disk pause/overflows.

Plan and order:
1. Instrument and measure unchanged history paths, footprint/heatmap competition,
   server stage timings and resources. Restore the absent Pi tunnel (done).
2. Durable sparse sufficient-statistic tiles; exact directly accumulated price
   resolutions, aligned 5m time and bounded price blocks, versioned manifests.
3. Supervised materializer with bounded resumable backfill/live checkpoints;
   separate serving lifecycle from the sole collector with a private gateway.
4. Shared client scheduler, viewport-first footprint history, individual tile
   cache/revision validation, bounded merging and broad-price resolution choice.
5. Differential/restart/correction/load tests, additive migration and deployment,
   five comparable end-to-end samples per scenario, bottleneck iteration.
6. Documentation, rollback evidence and focused local commits, no push.

Provisional conservative geometry: 5m buckets, 64-row price blocks, prepared
$10/$25/$50/$100/$250/$1000 rows; choose only after checking existing UI and
measuring sparse footprint/storage costs. Other resolutions remain explicit exact
on-demand reusable materializations. Do not derive coarse-price peaks by summing
finer peaks. BigInt integrals, known-zero coverage intervals and sparse observed
outer rows must be preserved. These are design choices under validation, not
implemented or accepted results.

Implementation checkpoint: client code commit cca0927; backend instrumentation
9fe396b and materialization/lifecycle b366aac. No push. Preexisting POC styling and
backend replay/admission edits remain outside these commits. The final measured
series is `release-*`, with five A/B/D/E samples complete and five C trials running.
A: 5.935s median/7.247s worst. B cached heatmap: .532s/.641s; validated2.182s/3.978s.
D wide two-panel:3.324s/6.446s. E current:5.007s/21.372s; worst had16-17s response-header
wait despite28ms footprint/302ms heatmap server work. That wait includes the
private transport/local proxy path, which is not isolated by server timings.

Post-measurement correctness checks remain before final acceptance: apply
/tmp/iqterminal-post-benchmark.py and append /tmp/iqterminal-footprint-merge-tests.txt.
This isolates closed footprints from replay, carries tile revisions into bar
render revisions, pins visible history over offscreen cache, and tests reconnect
handling in the incremental current path. Backend source has checkpoint identity
guards and unavailable-tile filtering pending final tests/deployment. Do not call
the goal complete until these are applied, verified, measured as relevant, and
committed with final docs. Collector remains independent/live throughout.

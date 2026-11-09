# Progressive prepared footprints

Visible history with multiple four-hour chunks now uses a bounded progressive
POST batch, up to six members per wave. The shared scheduler admits one batch
until EOF; no nested scheduler reads are held inside that admission. Additional
waves support larger views without changing time coverage, row geometry or
existing bar/cell budgets. Single pending chunks and optional older analysis
remain independent scheduled GETs, so polling reuses completed visible chunks.

Equal waves coalesce only when every member, configuration, revision hint and
explicit retry command matches. Consumers share progressive results and release
their own interests independently. The final cancellation propagates upstream.
Overlapping but unequal waves do not coalesce; this is not a claim of arbitrary
range deduplication. Pending and replayed data is released at completion/error or
final cancellation, and retained presentation tiles use the existing cache caps.

Each frame validates its index, exact geometry, framing version and byte bounds.
Every chunk then passes the existing tile/revision/coverage validation. Useful
earlier chunks publish progressively. The final member is withheld until both
the terminal frame and EOF validate. A transport end does not certify coverage;
building, failed, gapped, known-empty and absent source states remain independent.
Earlier good bars survive a failed sibling or truncated stream.

An old API may return404/405/501; only these explicit statuses allow legacy GET
fallback before any batch data is accepted. Unsupported capability is cached per
fetch implementation for60s, allowing API upgrades without a permanent fallback.
Malformed advertised streams and operational failures remain visible errors.
Fallback preserves exact revision hints/job IDs and explicit one-shot Retry
commands. Live sockets, cursor acknowledgements and accumulators are untouched.

Request traces include correlated view/request IDs, requested time bounds/member
count, scheduler/header latency, decoded bytes, available compressed body bytes,
SQL counts/rows/bytes and local decode/application durations. `streamMs` includes
overlapping processing/yields; do not add it to decode/apply as exclusive phases.
Resource Timing may omit encoded bytes; absent measurements stay unspecified.

Local validation:1,221 unit tests pass/two skipped and typecheck passes, including
seven focused batch tests and the exact Spot cache-geometry regression. Fixtures
cover24h progressive completion, missing/invalid/trailing framing, fragmented
input, shared cancellation, strict fallback, retained good bars after truncation,
and independent polling of a building sibling. This does not establish network
or Pi loading acceptance. Backend protocol/rollback is documented separately in
`iqterminal-server/docs/FOOTPRINT-BATCH-DELIVERY.md`; staging still serves e122f9d8
until an exact API-only guarded rollout is recorded.

Rolling back this client restores legacy GET delivery. Cache namespace2 uses
exact row widths and should be retained if reverting transport alone. No source
retention, collector, financial aggregation or persistent server migration is
part of this transport change.

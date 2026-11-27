# Bounded CVD viewport acquisition and restoration

`FeedClient.acquireCvdHistoryWindow(request, signal)` now admits finite worker
acquisition turns through the existing optional CVD owner. The same default-off
staging `VITE_CVD_TIERED_HISTORY` flag applies. This is a typed worker API; the
incumbent chart subscription and live poller still use their existing service.

## Request and progress

A request contains an exact projection (`source`, explicit `anchor`, `from`,
`to`, `stepMs`), an optional native seed range and optional `before` cursor.
When the owner has no basis, a successful native seed is required before warm
admission. Only the seed's explicit range fields are used; it cannot override
the selected source. A seed is not an implicit polling or restart-rejoin policy.

Each turn admits at most four operations (including a seed or restore page),
scans at most 512 hour windows and has a 15-second deadline. At most four turns
can run concurrently. Every transfer still uses the owner's single active
operation, four queued-window limit, shared history scheduler, bounded lease and
actual body-drain ownership. Turns are not placed inside that same single-slot
queue, which would deadlock their child reads. Cancellation removes demand and
stops future work; previously admitted observations/projections remain owned by
the worker. Disposal aborts the owner's turn lifetime.

The planner checks the cached projection first, then scans from newest to
oldest across the requested anchor-to-end coverage. It skips known complete
windows using retained coverage masks; inspecting coverage does not require
reconstructing quantities. Native/archive requests split at the fixed ownership
cutover. Archive pages are at most one hour, fitting the common fragmented
minute-publication shape; existing backend object/partition caps remain enforced.
Corrections or unusually fragmented publications may still refuse at those caps.
There is no blind capacity-based splitting of generic server errors.

Results contain `available`, `loading`, `partial` or `unavailable` state, an
accepted exact projection when available, operation/scan counts, bounded failure
ranges and a `nextBefore` continuation. The cursor only selects where scanning
continues; it proves no coverage and carries no archive capability or token.
Missing/skipped ranges remain partial. There are no automatic unbounded turns,
backfills or retries. The caller may request the next bounded turn. A transport
failure stops that turn; incomplete returned coverage remains explicit.

Successful reads update resident projections before completed immutable days
are evicted from minute residency. The ledger keeps exact day totals, masks,
hashes and provenance, while projected inputs remain independently cached.
Incomplete days are not automatically compacted. This is reversible client
memory management, not deletion of native/server history or a live TTL change.

## Fragmented day restoration

A finer projection can require detail from a sealed day. The ledger now exposes
a disposable staged reconstruction for that existing day. Each independently
validated page contributes candidate exact cells; it cannot add observations,
change quantities, upgrade coverage, change provenance or establish authority.
The original presence/coverage masks remain authoritative. Only hours containing
missing accepted executions need fetching; old known zero cells come from the
retained masks. Extra rows in a later publication do not become new accepted
observations through this reconstruction path.

At finish, the complete reconstructed accepted day must match its original
canonical SHA-256 hash. Rehydration is committed atomically with unchanged data
version and exact totals. An intervening block replacement, even with the same
content hash but changed metadata, refuses a stale stage. Conflicting pages,
wrong quantities or incomplete candidates cannot replace accepted history.
Equivalent independently validated publication copies can supply original
bytes; this is not cross-publication correction or financial reconciliation.

The owner allows at most four disposable day stages. Progress now renews a
60-second monotonic idle expiry within a ten-minute absolute lifetime; duplicate
or non-progressing pages cannot renew it. Each stage has automatic timer expiry, at most 32 accepted pages and
32 MiB cumulative normalized response bytes (4 MiB/page). It retains at most
1,440 candidate cells for its day, rather than whole response bodies. A late
page is refused even if its new transport lease is still valid. Stages survive
transient archive failure within their lifetime and are cleared on disposal.
The planner refuses to fetch the same unsuccessful restore hour twice in one
turn. It reports incomplete reconstruction instead of repeated replay.

`restoreCvdHistoryPage()` separately exposes the bounded page operation through
the typed client/worker lifecycle. All restored data retains false financial and
current-source-reconciliation authority.

## Native horizon and current-data limits

The first native response pins ownership, while subsequent successful responses
track the most conservative observed native retention floor. A missing
native-owned interval below that floor returns `expired-native-basis`; it is
not silently filled from an unqualified archive. A changed process incarnation
still returns `rejoin-unavailable`. These gaps need a qualified source continuity
contract, not an upload-clock comparison or ledger reset.

This planner does not automatically refresh already accepted current/native
windows. The [optional chart adapter](cvd-tiered-charts.md) now adds current
polling, daily/weekly resets and numeric chart adaptation. Older native correction
repair and forming-minute acceptance remain open. Callers must overlay source
transport freshness and retain current geometry while acquisition is pending.

## Verification and rollback

118 focused source tests passed, including 30-day newest-first acquisition with
bounded minute residency, exact daily totals, cached reopening/panning/coarser
zoom with no reads, finer sealed-day restoration over six four-page turns,
expiry/late-page refusal, conflicts, failures, cancellation, scan limits and
expired native ownership. The 30-day/year shapes use controlled sparse inputs;
they are not retained real market coverage or measured ingestion rates.

Typecheck/history-disabled build and both explicit headless Pi browser tests
passed. The actual production worker fixture now acquires missing warm data via
the window command. The dedicated component fixture also retrieves finer detail
through two archive pages after its cached benchmark, preserving data version.
Reproduce with the checked-in [headless test command](cvd-projection-cache.md#verification).
These checks establish no provider/live ingestion, foreground chart, full-history
loading latency or multi-venue production acceptance.

The default feature remains disabled and undeployed. Remove the opt-in flag and
reload the client to roll back. No backend runtime, credentials, server retention,
paid infrastructure or history deletion is changed. Remaining work includes
native lineage/rejoin, older correction repair, sustained multi-market
operation, configured-provider recovery and live/foreground performance gates.

Retained native days now stay resident during automatic acquisition so hour-sized
correction reads can replace their cells without requiring full-day source
reconstruction. Warm completed days still compact after projection publication.
The owner separately compacts expired native days when the server's observed
retained horizon advances across a UTC day. Exact totals, incomplete coverage
masks and source ownership remain unchanged. See [older native observation
sweeps](cvd-tiered-charts.md#older-native-observations) for admission and failure
semantics; no automatic incarnation rejoin or archive correction authority.

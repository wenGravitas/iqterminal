# Exact-reuse cache retirement recovery

Backend `13730f76752ec9db7f2253aa541fd4131e578141` repairs retirement of the
isolated wall cache and retention of the two latest completed automatic windows.
Component recovery is verified on staging. The overall release and previously
failed Pi loading gates remain **INCOMPLETE**.

## Root cause and change

After several hours of automatic preparation, the worker reported 114 ready jobs,
zero retirements and `Invalid managed wall cache file`, approaching the unchanged
128-job limit. Actual files show the rejected `<sha256>.prefix.json` checkpoints.
The scanner also omitted the canonical overlap producer's `overlap-tail.json`.
Rejecting these files deferred every attempted retirement, including removal of
old queue entries; new prepared defaults kept consuming slots.

The scanner now recognizes those files and their atomic-write temporaries only
in their respective derived namespaces. Projection prefixes retain the existing
32 MiB bound; overlap tails retain the existing 4 MiB plus 4096-byte read bound.
The 520-file bound, ordinary file bounds, 2 GiB derived quota, 20 GiB free-space
floor, 160 MiB transient reserve, scheduling and CPU/memory limits are unchanged.
Unknown names, wrong namespaces, symlinks and oversized files still fail before
any good file is removed. Existing reader, pin and reuse-dependency protection,
retirement journaling, namespace parking and filesystem yields remain intact.
The latest two ready rolling windows now remain protected after scheduler
ownership advances, matching the existing two-window default retention policy.

[Observed rejection/files](../artifacts/pi-history-r1/wall-retention-r2/invalid-files.json),
[before health](../artifacts/pi-history-r1/wall-retention-r2/before-health.json),
and [old-code failures](../artifacts/pi-history-r1/wall-retention-r2/old-scanner-tests.log)
link the fix to the reproduced failure. Both new positive regressions fail on the
old scanner/policy. All 346 backend tests, 67 focused tests, typecheck and runtime
bundle builds pass. Negative tests retain foreign source files and reject unsafe
file names/types/sizes; no source schema, collector or financial fold changes.

## Exact staging replacement

Only the owned isolated worker was gracefully replaced. Its old container
`26bf7a8d9d8a281c74ae8544d18c220edb61a85dec3a6bd20dd305a303307510`
exited 0 and released its owner lock. The same root reopened with all 118 queued
job identities, pinned proofs and nonregressing page progress preserved. Eight
latest-ready manifest/checkpoint/prefix hashes matched byte-for-byte.

The active worker is `iqterminal-wall-serving-13730f7-r1`, container
`dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c`, started
2026-11-10T12:34:42.265153690Z. Its mounted bundle SHA256 is
`625c7a7480c5810e68e66d5c5b822fa0d20ce6a3eb14b145c5b78b6e0ccf939d`.
It retains CPU 0.5, memory 384 MiB, V8 old-space 256 MiB, read-only root filesystem,
capability restrictions, 45-second stop timeout and 10 MiB/three-file log rotation.
The immutable runtime image is unchanged; actual Node is v22.22.0. The mounted
bundle, not the old image's source identity, supplies the new build.

The side API stays on 71f62d2, container
`569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae`.
Original API plus seven protected collector/materializer/admission service IDs
and start times are unchanged. The queue format stayed **1** in this root; no
protocol migration occurred. The separate protocol-2 barrier still applies when
nonterminal prefix installation is selected. All receipts stay outside the
derived root. No production deployment or main merge occurred.

[Full guarded replacement](../artifacts/pi-history-r1/wall-retention-r2/upgrade.jsonl),
[bundle identity](../artifacts/pi-history-r1/wall-retention-r2/build.json), and
[protected services/runtime](../artifacts/pi-history-r1/wall-retention-r2/protected-check.json)
record exact commands, identities, ownership and budgets without credentials.

## Actual retirement and default rollover

Recovery is based on real completed retirements, not a reset error counter.
Two bounded, same-server observers record:

| Observation | Elapsed | Tracked jobs, first to last | Cumulative retirements, first to last | Checked removed namespaces |
|---|---:|---:|---:|---:|
| Spot rollover | 222.670 s | 116 to 110 | 3 to 10 | 8 |
| Spot and USD-M rollovers | 205.511 s | 102 to 96 | 19 to 26 | 8 |

All 16 individually checked retired canonical-wire/projection/job namespaces and
journals were absent afterwards. Every sample retained both latest ready default
manifests per market; there were no observer errors or recurring retirement
errors. The first observer records Spot advancing from 12:35 to 12:40 UTC.
The second records Spot 12:40 to 12:45 and USD-M 12:30 to 12:45. Source gaps remain
explicit; derived cache deletion does not remove canonical database source.
Server current-health samples stay live, but this is **not** a client execution-
ACK continuity, concurrent-history, normal-browser or heap-plateau acceptance.

Raw [first observation](../artifacts/pi-history-r1/wall-retention-r2/observation.jsonl),
[both-market observation](../artifacts/pi-history-r1/wall-retention-r2/both-rollovers.jsonl)
and [verified summary](../artifacts/pi-history-r1/wall-retention-r2/summary.json)
include resource snapshots and exact source windows/keys. Durations use each
observer's own monotonic clock; no unsynchronized host timestamps are subtracted.

## Financial equivalence and source revisions

Two read-only reference cohorts, before and after the later rollovers, compare
fresh shared-projector canonical folds with prepared output. Before and after
**each** fold, the side API revalidates the source token against canonical FINAL
queries. All four comparisons match every financial segment/value field,
episode ordering, selected state and coverage, with no lease failures. These use
the incumbent projector, not a separate raw-book implementation.

| Cohort / market | Source end UTC | Segments | Value points | Explicit gaps |
|---|---|---:|---:|---:|
| First / Spot | 12:40 | 4257 | 32396 | 13 |
| First / USD-M | 12:30 | 39627 | 118191 | 4 |
| Later / Spot | 12:50 | 4258 | 32350 | 13 |
| Later / USD-M | 12:45 | 39625 | 118173 | 4 |

Each source window retains the full 30h view plus existing native-bar padding.
Window changes explain differing counts; they are not old/new timing pairs.
[First reference](../artifacts/pi-history-r1/wall-retention-r2/reference.jsonl) and
[later reference](../artifacts/pi-history-r1/wall-retention-r2/rollover-reference.jsonl)
retain full ranges, financial/state hashes, source proofs, DB query/read metrics,
leases and executed helper checksums.

## Performance limits and next work

Rollover materialization remains slow. Three sampled USD-M jobs, with differing
source windows, take 206963, 205911 and 188112 ms from same-server admission to
ready; the last uses the new worker. These inclusive wall-clock durations include
queue/build/checkpoint work. They are not exclusive CPU phases, comparable loading
cohorts, a median/p95, or evidence of a causal speedup. Source/OS caches and exact
overlap reuse are present, so these are not first-time raw cold-build results.
[Progress and per-step costs](../artifacts/pi-history-r1/wall-retention-r2/progress-cost.jsonl)
retain the measurements. A bounded post-recovery profile of the exact production disk scan inside the
unchanged worker cgroup records all five samples: 9.77/7.72/24.14/10.97/8.76 ms
(median 9.77, maximum 24.14), each measuring 1076196170 derived bytes. Those samples
do not explain the full rollover duration; active-build scan overhead and
per-page decode/checkpoint processing remain unseparated. No storage accounting
shortcut or limit increase was introduced. [Raw postflight/profile](../artifacts/pi-history-r1/wall-retention-r2/postflight.jsonl)
confirms zero remaining reader/pin/consumer interests, 83 ready jobs, no failed or
paused jobs and 41 completed retirements at that later snapshot. This is declining
cache occupancy, not proof of a server/client heap plateau.

No browser was launched for this backend-only repair. Earlier Pi loading failures
remain failed, and normal live viewport selection of prepared prefixes/current
tails remains unfinished. The private Pi route also showed retransmission/RTT
stalls during transfer; no network setting was changed or gate widened. Current
footprint revalidation, live/concurrent/warm-wall gates and retained-client-heap
plateau still require completion.

## Retry, ownership and rollback

Current active-service ownership is updated in
[isolated serving operations](wall-isolated-serving-results.md). Keep the original
API/client routes intact. On explicit pause/cleanup, verify exact IDs, stop the
owned side gateway before this worker and allow the 45-second graceful stop.
Preserve the root and locks until their owner is proven stopped; never delete
reuse files manually to appease an older scanner.

This change does not alter queue/data protocols. Reverting to 0811e74 reintroduces
blocked retirement for these producer files. If rollback is necessary, stop only
the owned isolated worker gracefully, preserve all checkpoints and use a tested
compatible bundle. A historical Retry must retain good bars and healthy unrelated
feed sockets/cursors. No collector restart, raw retention change or main merge
is needed to recover this derived-cache failure.

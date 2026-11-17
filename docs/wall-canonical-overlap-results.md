# Canonical default overlap: implementation and isolated evidence

The release remains incomplete. Backend472f8ac83ff2b024583c54024e023a9135970e7c
reuses exact canonical overlap and a bounded pinned tail across default advances.
This is isolated materialization evidence on stagingx64/Nodev22.23.4, not a Pi
browser latency pass. Serving remainsdca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51;
none of these backend changes is deployed. Both collectors and all five protected
background services retain their exact identities/start times. No production
change, source retention/schema/index change, main merge or browser launch.

The old path rereads most30hcanonical payloads on each5mSpot/15mUSD-M advance.
The first reuse implementation (d818317/fd3b2d6) proves exactness but repeats a
small tail query per page. The472f8acfollow-up persists that target-pinned tail
once with identity/content validation,5000row/4MiBbounds and canonical fallback
when larger. It retains fresh old-source validation, fresh new carry-in/coverage,
canonical cursor order, timestamp-group closure and final new-source validation.

New time rows below the old global watermark and late cursors above it both
remain eligible. The predicate is `cursor>oldWatermark OR at>=oldEnd`, within the
new requested range/horizon. It does not append a live tail from an old closed
terminal cursor. No financial strings, identities, ranks, qualification transitions,
gaps or profile configuration are reduced. Projection still folds the exact new
view. Persisted overlap dependencies are protected through pause/restart and
released after canonical completion. Failed/changed old proof uses canonical
source reads; corrupt content or changed target source cannot publish completion.

## Real source and exactness

One source advance per market was compared with a fresh canonical database build
in each of two isolated cohorts. Old prepared inputs are copied from the stopped
isolated default coordinator, never the serving cache. New files stay under
`/home/daz/iqterminal-wall-overlap-{tail-}verify-r1`. Jobs use the existing private
SQL admission proxy at background priority, nice10 and256MiBV8old-space bound.
Raw/SQL/OS caches may already be warm. This is missing new derived history with
prepared overlap, not a wholly cold raw rebuild or empty-browser-cache timing.

|Configuration|Exact requested source range, epoch ms|Canonical pages|Walls|Value points|Explicit gaps|
|---|---|---|---|---|---|
|Spot5m Top8/10%/native|1794097500000..1794206100000|17|3202|24533|9|
|USD-M15m Top8/10%/native|1794096900000..1794206700000|39|8317|65425|2|

These source ranges cover30hplus one native bar of padding per edge. Each cohort
pins its own full source proof/watermark. Reference and reuse match every canonical
part byte/hash/metadata, seed and coverage, then every projected financial field,
episode order and selected boundary state. The source tokens and financial hashes
also agree across the two cohorts; global head advancement is separately recorded.
Selected-state equality is asserted within each cohort; no equality is claimed
across their different pinned global horizons. Historical gaps remain partial
coverage, never continuous inferred walls.
The projector comparison uses the shared incumbent kernel, not an independent
raw-depth algorithm. Independent canonical reads provide its reference input.

## Every materialization observation

These are single observations per mode/market, not five-sample acceptance. No
median, maximum distribution or p95is reported. Canonical elapsed includes the
fixed25msinter-page yield and final source check; it excludes projector folding,
cache copying and the separately measured initial proofs. Do not add overlapping
step/database/CPU durations as exclusive phases.

|Initial fd3b2d6 cohort|Reference canonical elapsed, ms|Reuse elapsed, ms|Reference/reuse queries|Reference/reuse DB read rows|
|---|---|---|---|---|
|Spot|11945.2|13767.3|56/56|17432717/17560546|
|USD-M|25202.9|29442.3|122/122|53351904/53422562|

That slower initial result is retained. It identifies repeated tail queries and
motivates the persisted-tail implementation, rather than being relabelled a pass.

|472f8ac cohort|Reference canonical elapsed, ms|Reuse elapsed, ms|Reference/reuse queries|Reference/reuse DB read rows|
|---|---|---|---|---|
|Spot|13360.9|7226.6|56/19|17433684/4506245|
|USD-M|26226.7|16829.1|122/42|53358685/16311949|

|472f8ac cohort|Reference DB read bytes|Reuse DB read bytes|Reference returned JSON bytes|Reuse returned JSON bytes|
|---|---|---|---|---|
|Spot|1180970460|594789385|91648612|689228|
|USD-M|3004205649|1213185814|250489043|2064374|

The persisted real tail has44rows/57198JSONbytesSpot and970rows/1523037bytesUSD-M.
Private tail content is hash-validated on resume. Cache scans over8MiBof decoded
canonical content use the exact database fallback, so remaining group/proof reads
and their costs are not eliminated.

Initial source proofs are additional work, recorded separately in the472cohort:

|Proof phase|Elapsed, ms|Queries|DB read rows|DB read bytes|
|---|---|---|---|---|
|Spot old overlap validation|485.2|3|356069|241135600|
|Spot new target pin|837.4|3|356069|241183928|
|USD-M old overlap validation|503.6|3|614323|343085290|
|USD-M new target pin|356.2|3|619935|336420805|

Reference needs its target pin; reuse needs both target pin and overlap validation.
The table does not hide these costs inside a claimed end-to-end speedup. Sampled
step RSS stays below198MBin the472cohort, but this is neither a process peak proof
nor a repeated-use heap plateau. Resource observers record35initial/29follow-up
samples without errors; they measure serving health/resources, not current execution
ACK continuity. Both bounded proof children and their observers are terminal.
Derived evidence files remain; no serving process was replaced.

## Validation, retry and remaining work

Initial implementation:327backend tests pass; follow-up:330pass,85focused tests,
typecheck and build pass. Regressions cover source change, decimals/sides, regressing
timestamps, future rows below the old horizon, late cursors, byte/row fallback,
private-tail reuse/corruption, restart and retention protection. An initial test
annotation type error and an invocation substitution syntax error are preserved;
both were corrected before the successful proof. The first invocation did not
start a worker or create its derived output root.

Retry/rollback is documented with the implementation in backend
`docs/wall-canonical-overlap.md`. Cache/core formats remain compatible; older code
can resume using database pages and ignore the additive dependency field. Keep
collectors/source state untouched. Ordinary polling never resets a healthy job.

Automatic coordinator selection/ownership is covered by focused tests. The real
proof exercises the same canonical builder with explicit verified inputs; it does
not certify a newly deployed automatic rollover worker. Default closed projection
reuse, serving bridge and verified live-tail handoff remain unfinished/disabled.
Prepared wall loading, current concurrency, warm revisit, repeated-use plateau,
foreground Pi UX and current-candidate footprint revalidation remain open. All
previously failed browser latency gates remain failed.

Raw per-page query/CPU/memory records, source proofs/tokens, exact manifests,
private-tail content, financial/state hashes, executed bundles, build identities,
resource/protected-service receipts and full validation logs are in
`artifacts/pi-history-r1/wall-overlap-staging-r1/` and
`artifacts/pi-history-r1/wall-overlap-tail-staging-r1/`.

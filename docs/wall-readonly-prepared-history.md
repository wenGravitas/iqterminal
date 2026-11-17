# Prepared wall completion without a mutable replay

Frontend474f0660953b5fe6c7e48955eab264691adcff4c removes the full mutable
checkpoint restore from ordinary prepared-history completion. It keeps the exact
incumbent full-union financial validator, content hashes, source proof and limits.
No shared kernel, backend, collector or source-retention change is required.

## Correctness and lifecycle

The progressive active/closed validation is unchanged. After all fragments arrive,
the reader still validates the entire checkpoint, including cross-part retention
sequence uniqueness and active-candidate associations. It no longer clones every
historical point or builds/sorts a mutable retention queue that the service then
immediately releases. Checkpoint order and canonical snapshot order are assembled
cooperatively with the existing8ms budget and consumer cancellation signal.
Mutable restoration remains available to bounded reference tools; canonical raw
fallback/resume and the independent current selected-profile projector retain
their existing behavior.

Completed rows preserve the original start/side/price ordering and exact fields.
The same presentation map identifies already published data, so completion does
not replace the whole chart. Late subscribers receive the complete ordered
snapshot. Failed source validation retains good rows and never publishes complete.
Capacity flags remain explicit, force partial range coverage and prevent warm
admission that would appear unlimited.

The focused138tests and full1339tests (two skipped) pass, as do typecheck and the
production staging build. Tests exercise the actual full canonical validator,
malformed cross-part sequence collisions, quiet-head rebinding, delayed/failed
source validation, Retry, late consumers, cache replay and capacity flags.
The shared financial kernel source remains unchanged.

## Measurement method

The exact candidate runs on production preview4199. Baselinee25cd43 runs on4198.
The preview refuses to start unless its proxy targets match the established
comparison route: history/native18880 and current18881, separate existing SSH
sessions to the isolated staging gateway112bf11. Worker33c7e3a and protected
collectors are unchanged. All browsers are headless on the actual Pi; no normal
foreground UX acceptance is inferred.

A read-only canonical fold and independent before/after source proof establish
one fixed full30h view with18780segments/82355value runs and two explicit depth
gaps. Exact intervals, source/projection keys and sourceToken are retained in
artifacts/pi-history-r1/readonly-r1/reference.jsonl and references.json.
The five old/new pairs alternate order. Every context has an empty browser cache;
the server history is already prepared. Warm-up/diagnostic samples are separate,
and the loading deadline and5s median/10s maximum targets are unchanged.

The benchmark now hashes every displayed canonical segment field and value after
observation, using the independent reference's stable per-segment and ordered-union
SHA256 method. Only application presentation tags are excluded. Decimal spellings
are preserved, and a revision change during capture fails the proof. This work
cannot certify an earlier paint or a retained-heap plateau. A warm-up exposed and
retained an initial capture-order error (the context was closed before hashing);
the helper now runs before close. The subsequent diagnostic candidate completed
in7561.2ms and exactly matched the complete real financial reference. Its20s
observation allowance makes it supplemental, not a release gate sample.

Worker finalization metadata records elapsed ordering/validation stages and
validation yields, plus whether mutable restoration occurred. These include
cooperative waits; final source I/O overlaps them. They are not exclusive CPU
phases and must not be added to request timings.

## Operations

This frontend change can be rolled back by serving the previous frontend build
and reloading the client. It requires no backend rollback or source rebuild.
The existing history Retry, current socket/cursor separation and retained good
bars remain in force. No production deployment or main merge is authorized here.

## Five comparable pairs: release gates still fail

All ten samples use the exact same source window and token, unchanged original
observation bound, production asset builds and proxy/tunnel route. Pair order is
old/new, new/old, old/new, new/old, old/new. Old app=e25cd43; new app=474f066.

|Pair|Old first history / complete (ms)|New first history / complete (ms)|
|---|---|---|
|1|3238.9 / 7785.0|3140.3 / 8019.3|
|2|3227.6 / 8591.2|2963.4 / 7751.8|
|3|3106.2 / 9915.1|4569.2 / 8570.0|
|4|2853.7 / 7564.7|2876.4 / 8618.7|
|5|5006.2 / unobserved|3539.6 / 7760.6|

New completion median8019.3ms, maximum8618.7ms: **FAIL median≤5s**.
New first-history median3140.3ms, maximum4569.2ms: **FAIL≤3s**. The old
completion cohort contains one unobserved sample, so no five-run completion
median/maximum or speedup percentage is reported. Both gate assertions exit2.
No p95 is inferred from five loading samples.

Every new sample paints all18780segments/82355value runs and all120closed
native slots, retains the two explicit gaps and independently matches every
canonical financial field and episode order. The four completed old samples
also match that full financial hash. Old sample5 remains incomplete at5750
segments/10904runs, with its historical job still loading; it is unverified,
not a financial mismatch or unavailable source. Its stall occurs before final
union restoration, so it cannot establish that the removed restore caused it.

The optimization demonstrably avoids the full mutable restore and retention
queue allocation, but these measurements do not establish an end-to-end loading
speedup. Header/transfer waits and existing per-part decoding/validation remain
significant. No exclusive CPU percentage or retained-heap improvement is claimed.
Cold latency acceptance remains incomplete, along with current startup, ordinary
current-ending default reuse, concurrency, pan/switch retention and foreground UX.

Raw per-run files use readonly-old-1..5 and readonly-new-1..5 prefixes under
artifacts/pi-history-r1. readonly-r1 retains the aggregate reports, comparison
order/process timings, source proofs, leases and operational postflight. The
source pin and bounded extension were released; postflight independently checks
zero readers/pins/consumers, protected identities/start times, live collectors,
unchanged rollback files and the existing disk budget.

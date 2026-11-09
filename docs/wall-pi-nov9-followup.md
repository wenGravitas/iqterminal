# Wall completion scheduling: Nov9 follow-up

Release acceptance remains incomplete. No production deployment, main merge,
collector restart, exchange connection or source-retention change occurred.

## Retained change

Client13d30ecb5d510111695d07e24a72f7afa65cbd9c starts independent source validation
after every immutable part has passed content/per-part financial validation and
before final global checkpoint reconstruction. Completion waits for both. Global
identity/sequence validation, source mismatch, cancellation and retained partial
presentation remain enforced.25projection regressions pass, including final
checkpoint failure concurrent with source rejection. The scheduling opportunity
is implemented; an isolated end-to-end latency benefit is not established.

The ordinary default configurations, exact strings, wire format, shared financial
algorithm, budgets and historical/current separation are unchanged. Revert13d30ec
to restore serial completion without invalidating prepared files or live cursors.

## Rejected grouping experiment

0ee81eb grouped at most eight subsequent parts into each chart publication,
retaining immediate initial/first closed content, every record and every per-part
diagnostic.75archive/projection and13lifecycle tests passed; typecheck/build passed.
The35-part test proved exact publication boundaries1/9/17/25/33/35. Real Pi evidence
then rejected the experiment: maximum chart draws increased in every matched pair.
fa9d40ec28af7a1293c85d48a1851c6347c78d0f reverts it. Final application/test source
matches13d30ec exactly; the rejected builds/results remain retained.

## Unprofiled grouped-build loading cohort

Actual Raspberry Pi5, production staging/history/diagnostics builds, headless
system Chromium, Canvas2D, preview4187, history SSH18780 and current SSH18781.
API f82abdfae06c61f8bccff9fea0778bbaac491b5e; collectors and five protected workers
keep their previously recorded IDs/start times. Each browser context is empty;
server history is already prepared. Other user applications remain running, and
raw Pi load/swap/process samples are retained. These runs are not a causal
comparison with the earlier6fc cohort under different desktop load.

Times below are milliseconds. The45s observation is failure evidence only; the
completion target remains median<=5000/max<=10000, first history<=3000 every run.

| Case | First useful history, all five | Complete paint, all five | Complete median / max | Gates |
| --- | --- | --- | --- | --- |
|30h spot|3768.3, 5345.5, 5290.7, 5298.7, 5108.4|6409.1, 6039.5, 5835.5, 5930.8, 6396.6|6039.5 / 6409.1|FAIL first and complete|
|30h perp|4837.6, 5520.3, 4578.8, 4460.5, 4119.3|13447.3, 13399.2, 13712.5, 10355.2, 12880.5|13399.2 / 13712.5|FAIL first and complete|

All ten samples have the independently pinned exact walls, value points, source
revision, native slots and latest completed painted viewport. Spot8293segments/
49154points/360slots/35explicit gaps; USD-M23850/104112/120/47. No eligible interval
was shortened or called unavailable to satisfy a target.

## Alternating five-pair USD-M comparison

An isolated archive of13d30ec source/public/scripts/config was built at4188 using
the same dependencies. Actual compiled build identities are verified by the
browser harness. Order alternates control/grouped then grouped/control. Every
child process has one independent sample with raw run=1; numbered aggregates
preserve individualRun and use independently recorded paired round1..5. Raw child
files and their SHA256 values are retained. Both sets pass all exact coverage
checks and fail both latency gates. No p95 is reported from five loading samples.

| Round | Control complete | Grouped complete | Control max chart draw | Grouped max chart draw |
| --- | --- | --- | --- | --- |
|1|11872.7|10094.6|352.6|644.4|
|2|12698.1|12474.0|474.5|984.2|
|3|10442.4|11396.7|385.5|639.0|
|4|9853.8|9789.3|407.0|534.2|
|5|12307.8|10685.3|377.7|531.2|

Median completion11872.7→10685.3ms; median of each run's maximum chart draw
385.5→639.0ms. The latter is a median of five maxima, not p95 or whole-frame time.
Fewer publications do not establish responsiveness. This experiment was reverted.

The single13d CPU-profiled diagnostic is separate:15189.5ms completion,24draws,
5082.8ms cumulative chart-reported render work,953.8ms sampled GC self time. Profiling
and OS scheduling affect attributed times; they are not exclusive path phases or
an acceptance cohort. The chart work, transfer and independent validation overlap;
no unsynchronized host timestamps were subtracted or overlapping phases added.

## Validation and limitations

The earlier full suite with the first two overlap regressions ended1225passed,
1failed,2skipped: an unmodified trading-vault test exceeded5000ms. A focused rerun
had32passed/1vault timeout; all25projection tests (including the subsequently added
global-checkpoint failure case) passed. This is not a green full-suite claim.
The grouping experiment separately passed75archive/projection plus13lifecycle
checks and its production typecheck/build before real performance rejected it.

Read-only server observers ended cleanly after each encompassing measurement
window; raw host CPU/memory/swap/pressure, eight-container resources and API health
remain separate from browser confirmation/freshness evidence. The owned4188
control preview was stopped; it logged proxy EPIPE on test-context socket closure.
No current-only versus concurrent-history acceptance is inferred from health reads.
All browser runs were explicitly headless; normal foreground Pi UX remains unproven.

Next implementation needs to bound chart geometry/reference/path work itself and
reduce prepared discovery/transfer/final-validation latency without weakening source
proofs. Default overlapping-window reuse/current-tail composition, serving bridge
integration, initial-current footprint timing, live concurrency and whole-app memory
plateau remain unfinished. All earlier cold-build and unavailable-source limitations
remain; these prepared-cache tests do not measure cold materialization.

Raw evidence: `artifacts/pi-history-r1/wall-overlap-13d30ec`,
`wall-coalesce-0ee81eb`, `wall-pair-13d-0ee-r1`, and corresponding
`wall13d-f82-perp-profile-r1-*`, `wall0ee-f82-*-r1-*`,
`wall-pair-13d-0ee-r1-*-*` files. Executed benchmark/helper sources, browser configs,
requests, exact counts, all screenshots, CPU profile and checksum manifests are
retained. Earlier footprint gates remain attributed to6fc990f, not these builds.

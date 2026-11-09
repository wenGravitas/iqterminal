# Visible wall preparation tasks

Wall geometry/reference/native-path preparation already had a6mssoft work
budget, cancellation and a final actual-paint fence. Its continuation still
used nested `setTimeout(0)` calls. Browser minimum timer delays accumulate
between hundreds of mandatory visible-work slices even when CPU is available.

The renderer now uses the existing history task helper at user-visible priority,
with one independently abortable pending task per chart. Supported browsers use
`scheduler.postTask`; other platforms retain the timer fallback. The helper can
run a supplied callback in that task, preserving error/completion behavior on
both paths. Existing yield-only callers keep their behavior and priorities.
The6mswork budget, geometry, style, point retention and publication rules stay
unchanged. This is neither a larger CPU slice nor user-blocking priority.

The queued owner is checked before every callback. Transform/settings changes
and detach abort obsolete work, including callbacks that arrive after disposal.
Hidden charts pause without a task loop and resume through their next draw.
Preparation requests a frame when the prepared cache is ready; it never marks
the latest revision painted until the chart actually draws it. The previous
completed cache remains available while a new pass is pending.

Diagnostics expose `preparation.yieldMode` and the actual pending-task flag.
The legacy `backgroundMs` fields describe elapsed scheduled work outside RAF,
not background task priority. They overlap `activeMs`; do not sum them as
exclusive phases or interpret either as pure CPU time. The soft budget cannot
interrupt native path operations, GC or OS scheduling.

Focused regressions prove native visible-task admission, timer fallback,
in-task callback execution, callback failure/completion behavior, canceled task
ownership, exact finished geometry/styles and waiting for an actual paint.
The initial native-task fixture accidentally faked the work clock; its failed
attempt is retained. Corrected fixtures preserve the deterministic clock and
reject the predecessor's scheduling/callback behavior before passing the fix.
Production browser measurements must establish actual mode and loading/current
effects; passing these fixtures does not certify a latency or foreground gate.

Rollback is this scheduling/helper change. It does not affect the independent
per-segment projection optimization, prepared wire/core identity, source data,
collector processes, live sockets or cursors. No cache rebuild is needed.

## Production route observations

Production staging/prepared/diagnostics client5039ea853ee5253131145accf7969d4334361d8a
ran on isolated preview4189 through the existing Pi history18780/current18781SSH
forwards. API serving remainsdca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51. All
seven protected collector/worker identities and start times match before/after.
The4187control preview remains unchanged. No server rollout, retention change,
production deployment or main merge occurred. Browsers are explicitly headless;
normal foreground Pi UX remains unverified.

Five fresh-cache loads per market retain the exact frozen30h window
1793696400000–1793804400000, Top8/10%/native profiles and original source tokens.
All10observations verify staging mode, history enabled, fixture false, exact
client build and actual main-thread user-visible-post-task preparation. Server
history is already prepared. The normal12sobservation boundary and original
3sfirst-history/5smedian/10smaximum completion targets are unchanged.

|Scenario|First actual historical paint, ms, samples1–5|Median|Maximum|Gate|
|---|---|---|---|---|
|walls-30h-spot-5m|3504.0,3274.3,7277.8,7852.1,4626.1|4626.1|7852.1|FAIL|
|walls-30h-perp-15m|4363.0,3883.2,4432.8,3347.2,5290.0|4363.0|5290.0|FAIL|

|Scenario|Complete validated painted coverage, ms, samples1–5|Median|Maximum|Gate|
|---|---|---|---|---|
|walls-30h-spot-5m|8474.7,7776.3,9556.0,8812.7,10217.5|8812.7|10217.5|FAIL|
|walls-30h-perp-15m|11751.3,missing at12s,11149.8,10879.1,11515.2|not reported|not reported|FAIL|

All10samples receive and validate the complete financial source:8,293Spot
walls/49,154points/35known gaps and23,850USD-M walls/104,112points/47gaps.
Every sample has360/120native closed slots. Nine certify completed painted
coverage. USD-M run2still has5,248pending projection segments and4,156pending
closed paint segments at12s, despite source/data readiness. Its completion stays
null; no five-run completion median/max is reported from four finite values.
No source gap or artificial unavailability is substituted for pending render work.

Native candle/data readiness also remains relevant. In Spot run3the viewport
REST request begins at3352.1ms on the client observation clock, its headers are
observed at5643.2ms and full native slots at6421.0ms; first wall history paints
at7277.8ms. USD-M run2observes all native slots at2679.3ms, starts its five
projection batches between3075.6and7290.4ms, and starts final source validation
at9243.6ms. Its headers arrive at10482.3ms and geometry remains pending at12s.
These are overlapping observations, not additive exclusive phases. Browser
network durations and server headers stay on their own timing bases; no host
clock subtraction is used.

Code inspection confirms the early restore holder starts native subscriptions
but does not request their saved candle viewport. That request currently waits
for panel construction. Early native viewport demand and its validation-safe
consumer handoff are the next concrete lifecycle investigation. Source proof
latency, decode/import and final geometry also remain costs. Default rolling
composition/live-tail handoff, current confirmation under two wall loads, warm
revisit, heap plateau and foreground Pi acceptance remain incomplete.

The source-identical datasets permit comparison with earlier cohorts, but the
c60observations used a20scoverage window and were sequential under different
host load. Do not claim a controlled end-to-end speedup or compare completion
rates without accounting for that different observation boundary. Source detail,
requested ranges, row budgets and acceptance thresholds were not reduced.

A read-only serving observer starts before the client cohort and is gracefully
stopped after it, with exact process identity checked. Its52samples have no
observation errors. This is server health/resource evidence, not a current-client
execution/ACK confirmation test. Per-run Pi load/swap/frame data, requests,
executed code, real screenshots, original failed test fixtures and corrected
counterfactuals remain under `wall-native-5039-r1-*` and
`wall-native-tasks-route-r1`; scoped manifests authenticate their bytes.

Validation:237focused frontend tests pass, one skipped; typecheck and production
staging build pass. Kernel/backend source is unchanged fromcabe775, whose322
backend tests and build/typecheck remain separately scoped. Both wall loading
gates remain failed. No release acceptance is claimed from the scheduler mode
or requestComplete flag.

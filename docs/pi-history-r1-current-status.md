# Pi history R1: current evidence

**Release acceptance is incomplete.** No production deployment or main merge has occurred.
The active goal remains implementation and validation of the full release.

## Exact versions and scope

- Earlier five-run loading frontend: `1ef788c439499b815fa2328e88b7712f9da9335d`, production staging/history/diagnostics build against API18579d9.
- Current application build: `970541b79b1a9470f79a3644f5e8cdb8444420a9` (saved-view footprint job sharing, retaining the wall-cache idle fix); proxy implementation: `638caabff4d4a441c3706898dc8602274a4d41d6`; cache-disabled control `bf1d8425525306848cd9bc741c647fc3f1ba5054`. Both previews now load the final shared proxy policy. The control predates the wall-cache idle and footprint-sharing fixes; it must be aligned before another matched comparison.
- Frontend branch: `perf/pi-history-r1`; test-launch commit `86abe0e` blocks all headed test launches, including the old workspace override. It changes no application source.
- Staging API now serves `95114d0cb236e9de54fb535d58b901d5ac4a2d79` through the guarded API-only rollout. Both collectors and all five background workers keep their prior IDs/start times; workers and SQL admission remain on18579d9.
- The loading cohort below used API18579d9, not95114d0. The stopped isolated253ed22 gateway is historical evidence; its native-admission fix is now included in serving95114d0.
- Normal two-SSH route: current18781, historical18780; Vite preview4185. The follow-up proxy allows2native and2bulk lanes under a shared3active-request cap, with a separate current reserve. The earlier loading/health cohort used the old4aggregate proxy; it is not relabelled as a measurement of the new cap.
- Tests are headless system Chromium on the actual Pi. Per-run SystemInfo records effective hardware ANGLE/Broadcom GLES. This is not normal foreground-browser acceptance. Headed launches remain paused.
- Collector/API identities and start times match before/after; see the raw staging receipts. No collector, exchange connection, retention or production setting was changed.

## Implemented in this continuation

Native closed prices have bounded reusable presentation storage:2exact window entries,
1,000rows aggregate,1MiB accounting,128key/token leases maximum,60s idle TTL.
Active views retain only lease metadata; entries remain evictable under the same caps.
Cached slots are explicitly unvalidated until authoritative input arrives. They never
enter the execution accumulator or freshen live connection status.

Bootstrap-winning requests now seed the cache and acknowledge only accepted source
slots. Empty/mismatched responses cannot acknowledge retained old data. Explicit saved
views load before bootstrap even inside its normal1,000bar window. Saved restoration
retries after initial resize and preserves the historical range across first current
input. Only viewport boundary noise within1ms is snapped; source time is never rounded
forward. Failure/Retry keeps good displayed prices and healthy sockets.

First useful wall paint is now measured against the last completed draw's actual
viewport, independently of later pending input revisions. Complete paint still requires
latest input, exact wall counts/runs/gaps and every independently validated native slot.
The projection memoization experiments did not consistently improve Pi elapsed draw
calls and were reverted; their exact geometry/pixel comparisons and failures remain.

See [native price contracts, retry and rollback](native-candle-visible-history.md).
The earlier footprint coverage, independent materialization, incremental walls and
bounded batched-delivery work remain documented in the [detailed report](pi-history-performance-r1.md).
Their earlier checks are not substituted for the current release gates below.

## Earlier loading cohort (API18579d9)

Five empty-browser-cache samples per case used fixed, already-prepared server windows.
Every failed sample is retained. Targets were not raised; requested ranges were not
shortened. Missing completion is not source unavailability. Times below are milliseconds.

| Case | Complete available view: all five samples | Gate |
| --- | --- | --- |
|4h footprints,5m/$25|unobserved,5780.3,3015.0,4789.8,3053.4|FAIL|
|24h footprints,1h/$25|unobserved,8549.8,5283.9,7958.8,unobserved|FAIL|
|30h Spot walls,5m|all five unobserved within45s|FAIL|
|30h USD-M walls,15m|all five unobserved within45s|FAIL|

Completion targets remain median<=5s and maximum<=10s. A five-sample completion
median/maximum is uncomputable where samples are unobserved; no finite subset is
reported as the full cohort. Footprint observations are bounded at12s. The longer
wall observation is supplemental failure evidence, not a widened acceptance target.

Spot wall first-history samples:9186.2,unobserved,11765.3,12018.2,10946.3.
USD-M wall first-history samples:13885.8,unobserved,40059.2,unobserved,unobserved.
Both first-history<=3s gates FAIL. No complete wall seed was available for warm reopen,
so warm<=1s remains UNPROVEN. Normal foreground UX is also UNPROVEN.

Received footprint slots were0/48,48/48,48/48,48/48,48/48 and
20/24,24/24,24/24,24/24,12/24 respectively. Partial chunks did not claim completion.
Exact per-run wall/native counts, requested/loaded ranges, request IDs, raw timings,
hardware samples and real-chart screenshots are in:

- [wall cohort and per-gate summary](../artifacts/pi-history-r1/native-cache-r3-cohort/summary.json)
- [footprint cohort and coverage](../artifacts/pi-history-r1/native-cache-r3-cohort/footprint-summary.json)
- [exact versions and executed probe hash](../artifacts/pi-history-r1/native-cache-r3-cohort/manifest.json)
- [evidence checksums](../artifacts/pi-history-r1/native-cache-r3-cohort/evidence-sha256.json)

## What the route diagnostic proves

One identical immutable batch, with the same decoded SHA256, took25.58ms on server
loopback,13,085.98ms through existing SSH and34,564.07ms through Vite. The batch had
zero DB reads and a prepared-cache hit. TCP snapshots show retransmissions and about
523ms RTT. This locates substantial cost outside SQL; changing link conditions mean
these sequential observations cannot isolate Vite overhead or establish network cause.
No unsynchronized host timestamps were subtracted, and overlapping phases were not
added. This is one diagnostic per route, not five-run acceptance or chart paint.

## Validation and remaining work

- Full frontend unit suite on821092d:1,189passed,2skipped. Wall archive focused suite48/48. Typecheck and identified staging build pass.
- Four focused native-history browser regressions pass.
- Broader UI run:26passed,1fixture-count failure at a minute rollover. Both fixture clocks were then pinned; the unchanged3bar/1,000bar Retry cases pass2/2. Original failure and rerun are retained. No single27/27rerun is claimed.
- Normal current-only versus concurrent history/custom-profile comparison, repeated-use retained heap/frame plateau, automatic default-wall rollover/reuse and foreground Pi checks remain incomplete.
- The cold-materialization evidence and limits in the detailed report remain separate from these prepared-history timings; no new cold-build speedup is claimed.
- Native gateway reservation is now deployed and passes bounded real serving capacity/cancellation checks; full live/chart concurrency acceptance still remains incomplete.

Rollback/retry instructions remain in the native-price contract and detailed report.
These frontend cache changes add no persistent state or collector migration. Rollback
must retain the established private access and separate current/history transport.


## Serving and proxy-capacity follow-up

API-only serving rollout95114d0passed296backend tests, typecheck/build, exact
serving identity and read-only state checks. Both collectors, both depth/wall
workers, both footprint workers and SQL admission have identical before/after
IDs and start times. The wall-preparation/GC bridge remains disabled.

Five loopback rounds held3real prepared historical responses with explicit
backpressure. Every round retained health200, rejected a fourth native-history
request with503/Retry-After1, released admissions on cancellation, and recovered
native reads to200. Five paired Pi/current-SSH/Vite health reads also returned
200at the expected admission state and serving build. Baseline ms:
[1585.345,478.397,516.882,800.895,495.997], median516.882/max1585.345.
Saturated ms:[382.488,580.229,598.378,464.083,3896.835],
median580.229/max3896.835. The3.90soutlier remains a concern, not an unchanged-
responsiveness claim: proxy queue0.50ms, proxy header3852.73ms, gateway total6.83ms.
Handler timing excludes pre-callback delay; these numbers do not isolate network
from event-loop delay and are not additive exclusive phases. This is health
capacity evidence, not live confirmations, chart first paint, two historical
charts/custom-backfill or foreground UX acceptance.

The proxy originally admitted4historical requests while the newly serving
gateway permits3. A fixed1native/2bulk prototype (e69dd13) avoided the fourth
request but could serialize independent native history behind bootstrap. It is
superseded by the shared3request admission in3ee4531: either historical lane may
use2slots, bulk may not consume the native reserve, current and streaming routes
bypass the history queue. Pending interests are capped at128, canceled interests
never reach upstream, and server shutdown releases queued response references.
Proxy queue timing includes this admission wait. No financial rows are reduced.

A retained e69dd13/95114d0Spot pilot painted first history at5234.6ms but did not
complete within45s; no warm sample was run. This remains a failed pilot and does
not replace the five-run loading cohort. Full new-stack loading acceptance still
needs validation. The proxy fixture checks include5rounds per dev/preview mode
plus two-native/one-bulk borrowing and consumer cancellation; they are not Pi
chart-latency samples. Source and raw serving receipts are in the backend
artifacts/pi-history-r1/api-only-serving-r1 directory.


Final proxy638caabalso caps the whole managed HTTP path at4active requests,
with at most3historical. Current reads have priority and16reserved waiting
interests; historical waiting is bounded at128. This prevents current bursts
from overcommitting the gateway alongside3histories. Streaming routes remain
unchanged. Count-only diagnostics are available to local Vite tooling, not as
a new HTTP endpoint.

The strict wire fixture models the gateway's actual4total/3history limits. All
5rounds per dev/preview mode complete with0upstream admission rejections, both
native lanes usable, queued current reads resuming, consumer cancellation and
all active/waiting counts returning to0. An initial test raced two client
connection closures; it now waits for the proxy to observe queued cancellation
before releasing the held request. The failed log remains, and request/latency
allowances were not increased.

Validation on638caab:1,185unit tests passed/2skipped, typecheck/build pass,
4headless native-history browser regressions pass. Raw receipts, failed
prototypes, identified fixture screenshots and the exact cache-disabled source
diff are in serving-proxy-budget-r1. This is a bounded-capacity implementation
and validation result; no loading or full live-concurrency gate is relabelled.


A genuine-source headless native-candle smoke on638caab/95114d0observed a
rendered current chart and a subsequent live update with no page errors. Worker
diagnostics verify staging/history enabled, fixture false and the full client
commit; Vite health verifies the exact API commit. The first observation was
2895.826msin this one smoke. It is native-candle compatibility evidence, not
a footprint/wall first-useful, five-sample, historical coverage, confirmation-gap
or foreground acceptance result. Its real-chart screenshot and effective GPU
metadata are retained with the source script.

## Active wall cache and repeated-use follow-up

Build821092d fixes a60s cache timer that previously expired even while its original
view remained open. Cache lifetime now measures idle time after the final active
interest leaves. Two entries/32MiB total and16MiB per entry remain the same; active
interests cannot prevent capacity eviction. Focused regressions cover long-open
peers, viewport release, current-only subscriptions and eviction. This is a cache
lifecycle fix, not proof of warm-paint latency or a memory plateau.

The full-source repeated-use probe initially failed in setup: r1 navigated during
a build-directory replacement; r2 supplied a chart ID rejected by layout validation;
r3 incorrectly counted the application's independent Level Watches request as a
chart request. These attempts are retained under use-821092d-full-history-r1/r2/r3.
They provide no completed seed, loading pass or plateau. The corrected probe requires
the entire30h reference wall projection, every native-price slot, actual painted
viewport/revision and canonical financial hash before cycles start. The unchanged
loading gates above remain failed; its90s seed observation is supplemental setup,
not a widened performance target.

The corrected simultaneous r4 attempt reached full Spot coverage (8,293walls,
49,154value runs,360/360native slots) but only10,305/23,850USD-M walls at the
90s setup deadline. The separately labelled sequential-memory r5 attempt
completed Spot in37,223.8ms, with the exact canonical SHA256
cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e.
USD-M still had22,544/23,850walls and95,820/104,112value runs at its own90s
setup deadline, while120/120native slots were validated. Two immutable USD-M
batches remained in flight in each attempt. Both attempts failed before cycles,
so repeated-use plateau and warm reopen remain UNPROVEN. No further timeout
extension or identical retry is used to certify them.

In r5 Spot's compact cache encoded in3,167.9ms and retained1,671,666accounted
bytes with no encoder/decoder failure; the entry remained present while the
original chart stayed open during USD-M loading. This is a single actual-source
active-cache observation, not an idle-release/plateau or warm-paint gate. Across
95progressive part observations, the largest header wait was37,114.2ms, largest
part body wait10,954.4ms, JSON parse21.4ms, projector apply138.6ms and callback
120.5ms. These phases are per-observation and can overlap; they are not added.
The long merge/callback samples remain concerns alongside route delivery.

Raw executed probes, environment/GPU identity, stopped worker diagnostics, exact
painted ranges, hashes, request IDs/timings, resource/socket samples and failure
screenshots are retained in `use-821092d-full-history-r4` and
`use-821092d-sequential-retention-r5`. The latter was a memory setup protocol
change, not a new latency cohort. Local821092d validation logs and the pre-fix
red regression are in `wall-idle-821092d`.

## Previous footprint loading cohort:821092d/95114d0

Five fresh empty-browser-cache samples per pinned scenario used the current shared
proxy and serving stack. All requested closed slots were independently validated
and present in the actual painted viewport, with rowPrice25 unchanged. Every chart
reports canvas2d; tests were headless on the Pi. Normal foreground UX remains
unproven. This comparison does not isolate a code change from route variability.

|Case|All five completion times (ms)|Median/max (ms)|Closed-view loading gate|
|---|---|---|---|
|24h,1h/$25|8141.6,5742.1,9876.0,6429.1,5592.8|6429.1/9876.0|FAIL:median>5000|
|4h,5m/$25|4211.0,3190.8,3509.1,3772.1,2822.1|3509.1/4211.0|PASS|

Coverage is24/24bars and530cells in every24h sample;48/48bars and354cells in
every4h sample. The gate evaluator rejects missing or unpainted slots, changed
row size, shortened ranges, mismatched versions/viewports, unobserved completion,
and long supplemental observation windows. It exits1for a failed gate and never
reports a finite-subset median or p95. Eleven focused evaluator tests pass.

The4h history-only pass does not certify current health: one sample completed
history while current bootstrap still reported loading; two retained an explicit
current coverage-gap message. This is useful bootstrap-independence evidence,
not a healthy-current baseline. The separate current freshness/concurrency gates
remain incomplete. Wall loading, warm revisit and heap plateau remain incomplete
as recorded above. Thresholds and requested windows were unchanged.

The24h traces show6,8,7,7,8history HTTP reads and1,2,2,2,2view IDs, despite
the same final requested bounds. Repeated reads raised canonical database rows
from1,673,129to as many as2,252,918; individual proxy header waits reached5367ms.
This identifies redundant view work and route/header wait as follow-up targets;
the cause of the second view lifecycle is not yet isolated. No change is attributed
to an unverified cause, and canonical validation was not skipped.

See [final-stack manifest](../artifacts/pi-history-r1/final-stack-821-951-footprint-cohort/manifest.json),
[request work and current state](../artifacts/pi-history-r1/final-stack-821-951-footprint-cohort/request-work.json),
and the linked raw samples/screenshots for every run. Post-cohort health identifies
serving95114d0; the API-only deployment receipt retains protected container IDs.

## Footprint preload handoff fix and latest evidence

The82f43e8diagnostic pilot isolated the extra reads: the early restore consumer
and real visible chart had the same exact view key and worker generation, but
separate IDs started separate PreparedFootprints loads. Shared HTTP scheduling
could not reuse already completed chunks whose known-revision lists had changed.
Fix bf94b8d gives matching consumers one logical history job, progress ledger and
validation state. A departing consumer removes only its own interest; the final
consumer cancels. A later reopen creates fresh validation. Retry submits once per
failed shared job and preserves unrelated sockets. Each asynchronous attempt
checks its captured abort signal, preventing a late canceled attempt from using
a replacement controller. Shared status ranges count the logical demand once.

All1192unit tests pass (2skipped), including41focused staging-service cases.
Production build and typecheck pass. Four deterministic browser checks pass:
restored24h range survives late native input; ordinary candle Totals use the
visible range; scoped Retry preserves healthy native sockets; delayed UI handoff
has one worker, one history load and six bounded chunks. These fixture checks
are distinct from real-source timing and financial comparisons.

Five fresh actual Pi-route samples per case used production build970541b,
proxy638caab and serving95114d0. Every24h sample used six HTTP chunks, one logical
load and1,673,129DB read rows. The preceding five-run cohort used6,8,7,7,8chunks
and up to2,252,918DB rows. No schema, index, raw-source or capacity change was made.
Timing variability prevents attributing elapsed-time differences solely to this fix.

|Case|All five completion times (ms)|Median/max (ms)|Closed-view loading gate|
|---|---|---|---|
|24h,1h/$25|6040.2,8888.2,9111.9,5083.9,5283.7|6040.2/9111.9|FAIL:median>5000|
|4h,5m/$25|3179.2,3433.0,3370.2,3030.8,3877.3|3370.2/3877.3|PASS|

All samples validate and paint24/24bars/530cells or48/48bars/354cells at the
requested absolute range and$25row size. The five1h captures have identical
financial hashes over their recorded fields, including base/quote cells and base
cumulative extrema. Their initial capture schema omitted bar-level quote delta
and its extrema; an explicitly separate full-field1h capture adds them. That
additional sample completed in11,402.9ms, exceeding the10smaximum target. It is
retained and prevents a broader claim that current24h maximum latency is accepted.
All five5m captures include the quote-level totals/extrema fields.

Independent bounded FINAL execution replay matches both full-field chart and
prepared output exactly:14626executions/8cells across eight2000-row pages for1h,
and1397executions/4cells in one page for5m. Checks cover OHLC, counts, every
bid/ask base/quote cell, delta and cumulative delta/quote extrema across page
boundaries. Seven protected collector/materializer/SQL IDs/start times are
unchanged; serving remains95114d0. This does not substitute for the separate
busy-hour>250000reference or certify every bar through independent raw replay.

The first independent reference used stored Decimal quoteNotional converted to
Float64 and found a7.45e-9USD difference. Investigation confirmed the incumbent
accumulator uses ordered Float64 price*quantity; the corrected reference uses
that documented contract with strict equality, no tolerance. Both source versions
and the failed attempt remain in the backend receipt. No aggregation or source
data was changed to make this pass.

See the [handoff evidence manifest](../artifacts/pi-history-r1/footprint-handoff-bf94b8d/manifest.json),
[per-run request work](../artifacts/pi-history-r1/footprint-handoff-bf94b8d/request-work.json),
and [copied canonical reference receipt](../artifacts/pi-history-r1/footprint-handoff-bf94b8d/canonical-reference-manifest.json).
The backend76db3efcommit contains the complete read-only reference logs and
protected container identities. Current/warm/wall/plateau/foreground acceptance
remains incomplete. All browser work stayed headless.

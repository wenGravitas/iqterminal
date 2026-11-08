# Pi history R1: current evidence

**Release acceptance is incomplete.** No production deployment or main merge has occurred.
The active goal remains implementation and validation of the full release.

## Exact versions and scope

- Earlier five-run loading frontend: `1ef788c439499b815fa2328e88b7712f9da9335d`, production staging/history/diagnostics build against API18579d9.
- Current review frontend: `638caabff4d4a441c3706898dc8602274a4d41d6`; cache-disabled control `bf1d8425525306848cd9bc741c647fc3f1ba5054`. Both previews now load the final shared proxy policy. Their app src trees differ only by cache injection.
- Frontend branch: `perf/pi-history-r1`; later fixture/docs/evidence commits do not change that measured application source.
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

## Current loading gates

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

- Full frontend unit suite:1,182passed,2skipped. Typecheck and identified staging build pass.
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

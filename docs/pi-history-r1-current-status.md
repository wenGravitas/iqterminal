# Pi history R1: current evidence

**Release acceptance is incomplete.** No production deployment or main merge has occurred.
The active goal remains implementation and validation of the full release.

## Exact versions and scope

- Measured frontend: `1ef788c439499b815fa2328e88b7712f9da9335d`, production staging/history/diagnostics build.
- Frontend branch: `perf/pi-history-r1`; later fixture/docs/evidence commits do not change that measured application source.
- R2-descendant backend source: `2a0c61e`; staging serving remains `18579d938364e5fd5a9c7631bb19681a043f1b66`.
- The isolated native-admission gateway `253ed22` is stopped. Its source changes are not represented as deployed in this cohort.
- Normal two-SSH route: current18781, historical18780; Vite preview4185. Historical proxy capacity remains2native +2bulk,4aggregate, with a separate current reserve.
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
- Native gateway reservation still requires established staging rollout/validation before its source implementation can count as serving-path acceptance.

Rollback/retry instructions remain in the native-price contract and detailed report.
These frontend cache changes add no persistent state or collector migration. Rollback
must retain the established private access and separate current/history transport.

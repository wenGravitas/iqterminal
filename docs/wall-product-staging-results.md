# Staged exact product transport: Pi chart results

Serving API `dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`, client
`c68989c5ed1ca6b8f6ebe1e873df7cc1f64b225b`. API-only guarded staging rollout
passes tests/typecheck/build, read-only incumbent state bind and seven protected
container ID/start-time checks. No production deployment, collector restart,
retention change or preparation/GC activation. The initial non-login PATH setup
attempt ended before rollout; its error is retained separately. Existing failed
AIDE/restore maintenance units remain untouched.

Read-only server loopback: version1/2/3 warmups restore identical canonical parts;
five alternating version2/version3 pairs per market (20 measured full-view reads)
match every original per-part SHA256/byte count. All accompanying health reads
return200. This is not current-feed confirmation or cold materialization evidence.

## Actual Pi route, already prepared server / empty browser cache

Five samples per market, same pinned30h window1793696400000..1793804400000ms,
Top8 per side/10%/native; Spot5m,USD-M15m. All use HTTP version3, Brotli cache hits,
actual staging/history/build diagnostics and explicit headless Chromium. Normal
foreground Pi UX remains unverified. The45s observation limit does not widen
the3s first-useful,5s median-complete or10s maximum-complete targets.

|Scenario|First useful samples ms|First median/max ms|Complete samples ms|Complete median/max ms|Gate|
|---|---|---|---|---|---|
|spot|11709.5,9849.6,4450.7,7107.6,11352.2|9849.6/11709.5|12427.6,12888.2,10203.9,8557.7,11550.7|11550.7/12888.2|FAIL|
|perp|5092.9,6208.4,6409.9,5866.0,8203.2|6208.4/8203.2|15512.2,18250.6,18888.6,16418.5,26571.3|18250.6/26571.3|FAIL|

All5 Spot paints retain8293 segments/49154 exact values and360 native candle
slots; all5 USD-M retain23850/104112 and120 slots. Known35/47 gaps remain
explicit. Latest revisions are painted with no pending preparation at completion.
Raw samples, observations, requests, screenshots, environment and strict gate
summaries are under product-c689-dca-{spot,perp}-r1-*; no finite subset median
or loading p95 is reported.

Actual compressed complete-view wall bytes are779454 Spot and1811013 USD-M.
The earlier offline first-batch savings do not imply these loading gates pass.
This cohort is not an alternating app-level comparison against the earlier
client/API; route and desktop conditions vary. No causal speedup is claimed.

## Remaining measured delay

Per-request worker trace Spot run1: visible native history eligible before its
2787.9ms scheduler wait, then1523.5ms header wait and35.4ms transfer. Native
context appears at7856.4ms navigation-relative; first wall history at11709.5ms.
Worker/native-context clocks are separate: do not subtract their timestamps.
Spot runs2/5 also queue native history about1979/3040ms. Both wall batches are
eagerly acquired before any first member validates, occupying the shared two
history slots. This is a demonstrated admission issue for past/saved views
outside the latest1000 native-bar bootstrap, not every default-current view.

Worker validation and projection, renderer preparation and transfer also remain
material. The phase-evidence.json retains each run, including overlapping body/
header waits and nonexclusive CPU metrics. They must not be summed as exclusive
phases. USD-M bootstrap already spans the requested range and often needs no
additional native viewport request; native admission alone cannot fix its gate.

The next client candidate delays batch prefetch until the first authenticated
member arrives, preserving later pipelining and all data. It needs its own
committed build, focused regressions and fresh real-chart measurements; no
result in this report certifies that candidate.

Current latency/concurrency, warm-wall completion, repeated-use heap/interaction,
default rolling-window composition/tail handoff and foreground UX remain
unfinished or failed. Existing footprint passes stay tied to their recorded
builds. Cold rebuild limits remain separate from these prepared-cache reads.

Rollback: use the rollout receipt rollback-images.yaml/rollback.sh and
existing API-only rollback flow, preserving the seven protected services. New
clients rediscover the older capability on rollback; an in-flight version3 read
may fail and needs the existing scoped history Retry. Do not reset live cursors
or source files. Reverting the client restores version2 selection without a
canonical cache migration.

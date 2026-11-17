# Pi wall priority follow-up

The release remains incomplete. Client `de67453580c7c7cf1ecfa29405e288454fc55503`
separates ordinary visible imports/replay from optional background cache encoding.
API stays `dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`. No server rollout, collector
restart, retention/source change or production change occurred. Both SSH forwards,
the proxy configuration and the owned4187 preview process remain unchanged.
Final process audit verifies history SSH188916/current SSH265761/preview263125.
The current forward's supervisor replaced the formerly recorded188974 before
these cohorts. That old PID is obsolete; this audit did not restart the tunnel.
`local-process-check.json` records actual process start times and route arguments.
This correction does not establish current-feed continuity for older cohorts.

## Diagnostic and implementation

A separately labeled one-run main/feed-worker profile on87e identified decode,
checkpoint, projection and optional cache preparation work. Exact sampled source,
profiles and self-sample aggregation are retained. Sampling changes execution
costs and does not establish loading performance. Idle samples are not proof
that task priority caused a delay.

Source review found visible import using background tasks while optional compact
encoding used ordinary timers. The candidate assigns ordinary user-visible
priority to visible imports and cached replay, and background priority to optional
encoding, including its initial start. It does not request user-blocking history
priority or increase CPU slices, admission, bytes or retention. Canonical data,
hashes, revisions, source fences, numerical representation and shared financial
core remain unchanged. [Contracts and rollback](wall-task-priorities.md).

101 focused history/codec/cancellation/priority tests pass. Another46 staging and
warm-cache regressions pass, as do typecheck and production build (existing
bundle-size warning). Sixteen gate/trace tests pass. The loading gate now rejects
main or worker CPU-profiled observations, and the runner records both flags.
The current-concurrency runner checks required environment fields individually
so additional diagnostics do not falsely fail its build verification; that
harness fix does not recertify concurrency acceptance.

## Five unprofiled real-chart samples per scenario

Actual Pi, production staging/prepared/diagnostics build, same pinned30h source,
empty browser contexts, Top8 per side/10%/native. Browser diagnostics confirm
user-visible import and background preparation in every sample. Both profiler
flags are false. Every run has complete exact wall/value/native coverage,
validated source revision and actual latest painted viewport. Known gaps remain
explicit. Headless Chromium evidence is separate from normal foreground UX.

|Case|First useful history ms, runs1–5|Median / maximum ms|Complete ms, runs1–5|Median / maximum ms|Gate|
|---|---|---|---|---|---|
|Spot5m|4786.4,5730.3,4733.7,5360.4,6073.0|5360.4 /6073.0|7745.7,7580.9,7797.5,7677.4,8652.3|7745.7 /8652.3|FAIL|
|USD-M15m|4193.6,3987.1,3126.1,3746.8,3465.6|3746.8 /4193.6|10462.6,12823.2,13292.8,12468.4,11392.5|12468.4 /13292.8|FAIL|

Unchanged targets: first useful history maximum<=3s; complete median<=5s and
maximum<=10s. Spot meets only the completion maximum. USD-M fails all three.
No thresholds or ranges were narrowed. No p95 is inferred from five loads.

Previous87e completion medians were6.98sSpot/11.43sUSD-M; these new medians are
higher. This is **not an established loading speedup**. Sequential cohorts can
have different client/network conditions and do not isolate causality. The
change corrects the priority relationship; actual concurrent current behavior
still requires its own acceptance evidence. No latency or current-continuity
pass follows from the profile or priority tests.

## Coverage and operational evidence

Every Spot run retains8293segments/49154values/360native slots/35explicit gaps;
USD-M23850/104112/120/47. Requested1793696400000..1793804400000 and padded source
ranges/revision tokens match the prior independent references unchanged. The
strict gate checks every native slot, source token, wall/value count and painted
revision. The source gaps are not hidden or converted to continuous walls.

The production bundle is verified byte-for-byte through4187. All seven protected
service IDs/start times match before/after, with healthy caught-up API state.
Bounded resource observers have terminal records:18Spot/26USD-M samples, no
observer errors. Both chart cohorts completed; final i3 inventory has no visible
test windows. User browser processes were untouched.

Raw evidence roots: `wall-worker-profile-r1/`, `wall-task-priority-r1/`,
`profile87e-dca-perp-r1-*`, `priority-de674-dca-{spot,perp}-r1-*`, all below
`artifacts/pi-history-r1/`. Every request/byte timing, screenshot, environment,
resource sample and executed harness is preserved with checksums. Phase totals
overlap; worker validation includes waits and is not pure CPU time. No
unsynchronized cross-host timestamps are subtracted.

Remaining gates include wall/current loading latency, current confirmation during
concurrent history and custom work, warm-wall completion, interaction/heap
plateaus, default rolling-window composition and live-tail handoff, foreground
Pi UX, and latest-build footprint revalidation. Earlier footprint passes remain
attributed to their tested builds. These prepared-server measurements do not
measure a cold materialization build or repair absent raw source.

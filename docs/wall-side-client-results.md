# Isolated serving to Pi client: Nov10

Release acceptance remains **INCOMPLETE**. Both 30h loading gates fail on this
candidate. Prepared-source equivalence and HTTP transport integrity are separate
from complete chart paint.

## Implementation and identities

Frontend production build `7e9303823c46bc36587d49946c79427c3de07a3a` adds an
optional `VITE_CURRENT_API_URL` loopback origin. Previously an isolated history
API override still sent reader leases/control/current traffic to the original
API. The new override keeps those routes coherent, preserves their separate
admission agent and streaming routes, rejects remote/authenticated/path-bearing
origins, and preserves the default18781 target. Eleven focused proxy tests pass;
typecheck and production build passed before this cohort. No chart financial
algorithm changed in this serving-route fix.

Production preview4189 uses history18880 and current18881, separate SSH sessions
to staging18880. `VITE_DATA_MODE=staging`, history tiles enabled, fixtures false,
exact build and user-visible continuation mode are verified in every browser
sample. The benchmark now accepts explicit pinned-window files without rewriting
the original frozen windows. Later instrumentation captures bounded HTTP error
bodies; it did not run in these original ten observations.

The isolated gateway is71f62d2, container
`569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae`;
worker0811e742b74c1898f6c885bdd75fa50cdbba22c5 is
`26bf7a8d9d8a281c74ae8544d18c220edb61a85dec3a6bd20dd305a303307510`.
They reuse the old immutable runtime image with mounted new bundles; this is not
a claim that the image contains either new commit. Original API and seven
protected collector/materializer/admission service IDs and start times are
unchanged: [exact verification](../artifacts/pi-history-r1/side-client-r1/protected-check.json).
No production deployment or merge occurred.

## Canonical reference and requested coverage

[Reference output](../artifacts/pi-history-r1/side-client-r1/reference.jsonl) compares
a fresh canonical shared-projector fold with each prepared immutable projection.
Both match every financial segment/value field, episode ordering, boundary
selection and coverage. This uses the incumbent shared projector; it is not an
independent raw-depth implementation. Source gaps remain explicit.

|Market|Requested visible range UTC|Padded source range UTC|Reference segments / value runs / gaps|
|---|---|---|---|
|Spot5m|2026-11-08 23:30 to2026-11-10 05:30|2026-11-08 23:25 to2026-11-10 05:35|4500 /34534 /15|
|USD-M15m|2026-11-08 23:15 to2026-11-10 05:15|2026-11-08 23:00 to2026-11-10 05:30|36013 /117182 /4|

The machine-readable [references](../artifacts/pi-history-r1/side-client-r1/references.json)
and explicit window files are authoritative for timestamps. The full30h ranges,
Top8 per side/10%/native settings and requested native360/120slots are preserved.
A ready server does not make an incomplete received/rendered view pass.

## Empty browser cache over already prepared server history

Actual Pi (`aarch64`, hostname `pi`), production build, headless Chromium with
GLES requested. This does not certify normal foreground rendering or GPU
acceleration. All browser launches force headless plus headless Ozone, preventing
i3 window mapping. Each sample has a fresh browser context. The original12s
observation boundary and latency thresholds are unchanged.

|Market / run|First useful actual history ms|Complete validated painted history ms|
|---|---:|---:|
|Spot1|4392.8|missing|
|Spot2|missing|missing|
|Spot3|4145.3|missing|
|Spot4|4492.1|missing|
|Spot5|missing|missing|
|USD-M1|3833.6|missing|
|USD-M2|missing|missing|
|USD-M3|missing|missing|
|USD-M4|7290.7|missing|
|USD-M5|missing|missing|

Both first-useful<=3s and complete median<=5s/max<=10s **FAIL**. There is no
median/maximum from a finite subset and no p95. Some samples also lack complete
native candle coverage. USD-M3and5 receive discovery503; USD-M2 is unresolved
when canceled. These failures remain in the gate reports, not excluded as
outliers or recategorized as successful prepared loads.

Raw [Spot samples](../artifacts/pi-history-r1/side-r1-spot-samples.jsonl),
[USD-M samples](../artifacts/pi-history-r1/side-r1-perp-samples.jsonl),
[Spot gate](../artifacts/pi-history-r1/side-client-r1/spot-gate.json), and
[USD-M gate](../artifacts/pi-history-r1/side-client-r1/perp-gate.json) retain
requested, received, native and painted counts/ranges, routes, revisions,
monotonic timings, tasks, frames and Pi resource snapshots. Executed harness and
trace-helper copies plus browser environment/observations accompany each cohort.
[Spot1 screenshot](../artifacts/pi-history-r1/side-r1-spot-walls-30h-spot-5m-1.png)
and [USD-M4 screenshot](../artifacts/pi-history-r1/side-r1-perp-walls-30h-perp-15m-4.png)
show progressive partial history, not completed30h views.

## Route diagnosis and remaining work

The bounded route probe reads the exact first immutable batch with an acknowledged
renewable reader lease, then releases its own consumer. Each successful sample
checks full wire length, SHA256/ETag and pinned source revision; all financial
canonical bytes remain unchanged. It records each host's own monotonic duration.
Header wait includes server/transport phases, and no unsynchronized host timestamps
are subtracted. These first-batch samples are not full-history paint measurements.
The initial unleased probe correctly returned428 and is retained separately;
those responses are not payload timing evidence.

The loopback probe ran after the browser cohort. SSH and preview probes ran
sequentially afterwards, so their difference is not a controlled estimate of
proxy overhead. Existing user activity and source workloads were not stopped.
Resource observation begins after the first Spot samples and spans the remaining
cohorts; its actual start/end delimit coverage. Browser samples include their own
before/after Pi CPU/swap/process snapshots. No current ACK continuity, warm wall
reuse, heap plateau or foreground UX gate is inferred from these resources.

All30 leased first-batch route samples validate identical source revisions and
wire hashes (Spot496022bytes, USD-M481973bytes). Cache states and DB counters are
retained per sample. Exact results are in [route summary](../artifacts/pi-history-r1/side-client-r1/route-summary.json).

|Route / market|Every total ms sample|Median ms|Maximum ms|
|---|---|---:|---:|
|loopback / spot|5.6/3.6/3.5/3.1/3.9|3.6|5.6|
|loopback / perpetual|27.6/80.4/21.0/17.5/97.8|27.6|97.8|
|ssh / spot|1100.1/1922.7/1562.1/1033.8/2068.5|1562.1|2068.5|
|ssh / perpetual|2649.4/2636.0/3119.1/12678.3/8886.0|3119.1|12678.3|
|preview / spot|1837.6/8393.0/13310.1/6767.1/13525.6|8393.0|13525.6|
|preview / perpetual|9930.8/23880.5/18391.3/19201.6/12527.5|18391.3|23880.5|

The same already-prepared first batch alone exceeds10s on the Pi route in some
samples, while loopback remains below100ms. This establishes a route contribution,
not a controlled estimate of network versus proxy overhead or an explanation for
all chart costs. The later single Spot discovery diagnostic returns ready with
the same source token, three DB queries,370847rows/282547527bytes read and341.5ms
DB duration. The USD-M diagnostic hits its fixed512KiB metadata observation cap;
its empty AssertionError message is retained as a diagnostic failure. Neither
single diagnostic resolves the earlier503 error category.

Discovery source validation, intermittent503 and route variability need further
investigation. Current/default tail handoff, default serving rollover under live
use, responsiveness during two historical charts plus custom backfill, memory
plateau, and current-build footprint revalidation remain incomplete. Earlier
footprint passes remain attributed to their original builds.

## Operation and rollback

Leave the original18780/18781 route and protected services intact. The optional
current target defaults to18781; removing the override restores established
routing. Isolated gateway/worker have bounded logs/resources and separate derived
state. Their exact start/stop/rollback ownership is in
[isolated serving operations](wall-isolated-serving-results.md). The queue's
protocol2 barrier still applies: older worker binaries require a fresh derived
root; never edit the queue version or copy partial progress backwards.
History Retry must retain good data and healthy unrelated feeds. Do not restart
collectors, remove source gaps, shorten ranges, widen thresholds or label a
prepared-cache response as cold materialization to turn these failures green.

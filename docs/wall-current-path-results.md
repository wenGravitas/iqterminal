# Client continuation and current-route results

Serving API stays `dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`. Client `4efc5d0`
adds cancellable background-task continuation; `2bcf73d` additionally moves
watch control/stream onto the existing current route. Only the owned4187 preview
was restarted for the proxy change; SSH PIDs188916/188974 and all seven protected
server service IDs/start times stay unchanged. API health is200, backlog/error
absent. No production, exchange collector, raw retention, source schema or limit
change. Normal foreground Pi UX remains unverified.

## Worker comparison and focused correctness

The actual Pi Chromium worker supports background postTask. On the same captured
canonical bounded frames,5 alternating samples per variant/market preserve every
canonical JSON byte and expansion budget. Spot median elapsed511→377ms; USD-M
450→330ms. Raw samples, maxima and separate warmups are in wall-worker-yield-r2/.
USD-M candidate run5is830ms with a130.7ms maximum synthetic message gap; it is
slower than its timer pair. This is not real current-feed confirmation or a
chart-loading pass. Cancellation is observed on the native worker path.

45 focused helper/import/cancellation/admission tests and typecheck/build pass.
The helper uses explicit background priority with a cancellable timer fallback.
Reported validation totals include asynchronous waits and other work; they are
not pure CPU time. No strict8ms bound is claimed for native JSON/GC operations.

## Real Pi route: every loading sample

All four cohorts use empty browser contexts over already prepared history,
identical pinned30h data, Top8/10%/native (Spot5m,USD-M15m). Each sample verifies
staging/history/build, fixture=false and actual background-post-task mode. All20
complete paints have exact counts, slots, revisions and no pending paint work.
No range, row width, data detail or latency target is changed.45s observations
do not widen first-useful3s, complete median5s/maximum10s acceptance.

|Build/case|First useful history samples ms|Median/max ms|Complete samples ms|Median/max ms|Gate|
|---|---|---|---|---|---|
|yield4efc-dca/spot|9836.6,8012.0,4248.1,7094.3,13804.9|8012.0/13804.9|16739.2,10335.6,9404.7,8913.8,27203.5|10335.6/27203.5|FAIL|
|yield4efc-dca/perp|8573.7,4320.3,7329.8,4623.6,4973.1|4973.1/8573.7|20554.4,35270.9,17601.9,18283.4,18365.6|18365.6/35270.9|FAIL|
|watch2bc-dca/spot|6447.2,3957.4,6059.0,3631.4,6398.9|6059.0/6447.2|22357.7,10617.8,10282.3,11526.4,9415.3|10617.8/22357.7|FAIL|
|watch2bc-dca/perp|5044.9,4091.8,4466.0,4816.7,4746.6|4746.6/5044.9|17085.9,16986.3,15050.9,15114.6,16167.1|16167.1/17085.9|FAIL|

Each Spot paint retains8293 segments/49154 values/360 native slots; USD-M
23850/104112/120. Known35/47 gaps remain explicit. Exact source tokens and
financial part hashes match the existing independent references. These sequential
cohorts are not controlled alternating application-level pairs. No causal total
loading speedup, loading p95 or current/heap/default-rollover pass is claimed.

## Current metadata routing repair

The prior watch response is2859 bytes and3.73ms server work, but2508ms local
queue/socket allocation plus5443ms header wait. The first wall batch also waits
3994ms locally. The current route uses the same bounded currentBookAgent and
18781 forward; the stream uses its existing streaming-style bypass. Capacities
stay four total/three historical, with the same agent maxima. Private gateway
and path rewrite are unchanged; backend authentication logic is untouched.

The real Vite loopback fixture holds three historical responses open. Old routing
times out on the watch GET; current routing serves watch GET, health and the
WebSocket upgrade. Downstream cancellation closes its upstream request while
the two healthy peers stay open, including three replacement/cancel cycles.
These are explicit local fixtures, not live-source acceptance. Initial fixture
typing and counterfactual failures are retained separately.

All first watch GETs in the new Spot cohort wait approximately1–4ms locally.
The latency gate still fails. In new Spot run1, second wall-body EOF is observed
at20947ms navigation-relative, source validation ends22057ms and complete paint
22358ms; that response takes only6.43ms measured prepared-server read work.
The evidence shows a large transfer/consumption interval, but does not isolate
physical bandwidth from browser stream backpressure or SSH/proxy effects.
A later bounded receive/decode experiment must preserve progressive validated
members, terminal EOF checks, cancellation and existing byte budgets.

Resource observers finish with explicit end records; source errors are retained
if present. Test browsers close normally and final i3 inventory finds zero test
windows. Watch definitions/session bodies are not stored. See phase-evidence.json
for request IDs, nested phase timings, worker/main work and render metrics.

Remaining release gates include current confirmation under concurrent history,
current latency, warm wall completion, repeated-use heap/interaction plateau,
default rolling source-window composition and verified live-tail handoff, and
foreground Pi UX. Previous footprint passes remain scoped to their builds.
Cold materialization timing is separate from these prepared-history transfers.

Rollback: revert the client helper or proxy routes and rebuild/restart only the
owned preview. This operator config restart is separate from History Retry; do
not reset healthy feed cursors, source files or collectors. The staging API image
rollback receipt remains unchanged.

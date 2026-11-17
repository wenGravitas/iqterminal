# Bounded wall preparation: implementation and Pi results

Application build: frontend `1fcacc9e00ade0c3ff9d33e06c75fe0762a1f97a`;
serving API `f82abdfae06c61f8bccff9fea0778bbaac491b5e`. Frontend changes are
`f1a9c21`, `188cee9`, `1fcacc9`; backend branch remains `756167a` with no new deployment.
Production preview uses staging data, prepared history and diagnostics on private
loopback port 4187. All browsers were explicitly headless; foreground Pi UX is unverified.

The renderer now bounds projection, reference, ordering and native-path preparation
in cancellable macrotasks, retaining completed paths until replacement is ready.
Visibility, transform/revision changes, removal and detach cancel obsolete work.
Completion requires actual latest-revision paint. The 6ms slice is a soft CPU
budget: native operations and GC can exceed it. See [implementation](wall-render-work-budget.md).
No canonical financial algorithms, tick size, source coverage or collectors changed.

## Exact renderer comparison

`budget-paint-tasks-r3/summary.json` records every sample, median and maximum:
5 alternating paired runs × 17 stages × 2 markets = 170 completed comparisons.
All financial geometry fields and completed pixels match the incumbent; original
captured source hashes remain unchanged. Tail/correction exercises and the OHLC1
axis fixture are synthetic and labelled separately from venue observations.

Initial preparation median elapsed time increases from 302ms to 1053ms Spot,
and 728ms to 2076ms USD-M. Largest initial component call decreases from 632ms
to 22.7ms Spot and 764.1ms to 25.4ms USD-M. This trades throughput for shorter
stalls; it does not certify loading targets. DPR/style/pan cases still include
calls above 50ms. Native/GC costs and actual interaction remain unfinished.
The obsolete RAF-only trial and optional-telemetry setup failure remain retained
with their partial scope; neither is counted as a complete comparison.

## Actual Pi route: empty browser cache, already-prepared server

Pinned 30h requested range: 1793696400000..1793804400000ms.
Top8 per side, 10%, native; Spot 5m and USD-M 15m. Timing is navigation-relative
paint observation. Supplemental 45s observation never widens the 3s first useful,
5s median complete or 10s maximum complete targets.

|Scenario|First useful history samples, ms|Complete samples, ms|Result|
|---|---|---|---|
|Spot|3960.6,2727.5,4221.7,5378.5,5615|8455.4,6559.2,25457.2,22278.8,21710.4|FAIL: first useful median4221.7/max5615; complete median21710.4/max25457.2|
|USD-M|7665.7,7147.5,6634.2,unobserved,4673.5|21039,18053.3,18500,unobserved,14243.7|FAIL: full-cohort median/max unavailable|

All five Spot runs paint exactly8293 segments/49154 values and360 native slots.
Four USD-M runs paint exactly23850/104112 and120 native slots. Known gaps remain
explicit (35 Spot,47 USD-M). USD-M run4 has only16 segments at45s, with missing
post-observation worker diagnostics; it remains incomplete and unverified.
The harness now awaits an actual diagnostics response after observation, without
recapturing paint marks/coverage or changing deadlines. The failed sample is
retained and is not relabelled by that logging repair.

Raw requests, observations, diagnostics, environment and screenshots are under
`wall1fc-f82-{spot,perp}-r1-*`; strict gate summaries list every failure.
`wall-budget-route-r3/` holds runtime receipts, host resource samples and health.

## Transfer evidence and next investigation

USD-M run4 native bootstrap took about38.47s until body completion, while measured
server work was about274ms. Discovery proxy header wait was38.96s versus1.095s
server total (SQL queue is nested within DB timing). This contradicts treating
that delay as a 40-second database query.

One identical pinned version2 Brotli batch, verified source/key/encoding and
SHA256 d18105b191ff2ebf8e14088e15f0a2b16a3440b00ebdb238ab4c1988645d8923:
4,745,124 decoded bytes, about640872 encoded bytes; server loopback16.98ms,
existing Pi SSH7706.20ms, Vite2887.43ms. These are sequential host-local
curl/transfer/file-write timings, not loading samples or additive exclusive
phases. Vite being faster in this one sequence does not establish proxy benefit.
The evidence identifies substantial cost outside measured DB/serialization;
network, SSH multiplexing/backpressure and proxy admission are not fully isolated.
TCP retransmission and RTT counters are retained. Tailscale reports a direct peer
address; the Relay metadata alone does not prove DERP transport.

## Validation, operation and remaining acceptance

Full suite:1238 passed/2 skipped,142 files passed/2 skipped,101.97s, single worker
and serial files with existing timeouts. Typecheck, production build and11 focused
budget/lifecycle tests pass. Logs are retained alongside route evidence. Production
build still reports its existing large-bundle warning.

Postcheck confirms all seven protected collector/materializer/admission IDs and
start times unchanged and running; API health200/build f82. Serving bridge and GC
for rolling wall defaults remain disabled. No source retention, production or
collector lifecycle changes were made. Failed host maintenance units in preflight
are separate findings and were not repaired.

Rollback: revert these client renderer commits and rebuild the prior staging
client. No prepared files/cursors or backend processes need resetting. History
Retry retains healthy live sockets and good bars under the existing recovery path.
No retry or polling reset was introduced here.

Footprint prepared24h/4h and warm-view gates previously passed on their recorded
builds; they are not rerun or recertified by these wall tests. Initial current
latency, full current/history concurrency, warm wall completion, interaction/heap
plateau, foreground Pi UX and default wall serving/rollover remain incomplete or
failed. Cold materialization must be measured separately from prepared transfer.
The overall performance release remains active and unaccepted.

## Exact notional omission hypothesis

The opt-in offline `scripts/wall-notional-transport-probe.mjs` ran five alternating
samples per market on the same captured source. A point's notional is omitted
only if exact decimal price×quantity reproduces its original decimal spelling;
the prototype restores every canonical JSON byte before accepting a sample.
All49154 Spot and104112 USD-M points qualify in these samples.

Whole-market Brotli quality5 bytes: Spot841992→615910 (26.9% smaller),
USD-M1735491→1450255 (16.4% smaller). Median encode CPU rises175→706ms Spot
and555→1019ms USD-M; decode including JSON equality rises498→569ms and914→1080ms.
These are whole-market offline objects, not actual bounded delivery frames,
browser measurements or latency gates. No new protocol has been enabled.
A production implementation must negotiate a new version, retain older clients,
fall back on non-equivalent/unknown shapes, retain decoded canonical byte caps,
yield bounded work, and verify canonical part hashes. The transfer savings merit
bounded-frame evaluation; CPU cost prevents assuming an end-to-end win.
Raw samples and executed prototype are under `notional-wire-probe-r1/`.

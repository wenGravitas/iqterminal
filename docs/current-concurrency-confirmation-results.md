# Pi current execution confirmation and shared-view lifecycle

Client `b219fb215941347e7304db8ae90fff04a2e59057` adds bounded execution/ACK
proof. The real cohort exposed a status bug, repaired in
`8aaab36a2e4c305633877de7438f6b0883f5b4c1`: adding a historical viewer to a
healthy shared footprint group unconditionally set that whole group to loading,
also revoking live analysis previews. The viewer now inherits the independently
confirmed execution state while its separate history status loads. The old-code
regression fails and the repaired regression passes without a new HTTP replay,
socket, cursor reset or financial-data change.

API remains `dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`. The production bundle
is byte-verified through4187. All seven protected collector/materializer/admission
IDs and start times match before/after. Both resource observers and browser
cohorts are terminal. No production deployment, main merge, collector restart,
source-retention change or new exchange connection occurred.

## Source and measurement

Actual Pi headless Chromium, fresh browser contexts and production
staging/prepared/diagnostics builds. Each cohort alternates five current-only
and five two-history observations,20seconds each, after an independently confirmed
current execution chain. Historical panels load full4h5m/$25 and24h1h/$25 views,
pan the hourly view left after3s, then restore it after3.5s. This exercises
cancellation while the shared5m live source continues.

Pinned end1794225600000 comes from the closed hour of the verified server head;
the frozen wall benchmark window is untouched. Seven bounded source preflights
prove all72requested closed slots ready with no missing tiles. Every loaded
history observation in both cohorts paints and validates48/48 and24/24. The
hourly forming candle at the right boundary is retained and reported separately;
it neither counts as closed history nor invalidates those24closed slots.

## Every callback-gap sample

These are maxima of client callback receipt gaps in each observation, including
its boundaries, not exchange gaps or current chart paint latency. Median/maximum
summarize all five run maxima. No loading p95 or finite-subset median is used.

|Build/scenario|Runs1–5 maximum receive gap ms|Median / maximum ms|
|---|---|---|
|b219 current-only|820.8,1267.8,882.0,1009.2,1123.6|1009.2 /1267.8|
|b219 concurrent history|1574.9,1539.1,975.2,793.7,874.4|975.2 /1574.9|
|8aa current-only|870.3,719.6,789.1,880.9,901.8|870.3 /901.8|
|8aa concurrent history|1900.6,995.9,2394.9,1601.6,1608.7|1608.7 /2394.9|

The shared-status fix is not an established delivery speedup. The builds were
measured sequentially under potentially different source/client conditions.
Within the repaired alternating cohort, each loaded case has a larger maximum
gap than its current-only counterpart. Source ingestion lag reported on the
server's own clock is544–1429ms at after-observation health probes; it is not
subtracted from client gaps or used to assign a cause. Worker, route, SQL and
client CPU attribution remains unfinished.

## Confirmation, status and recovery results

On8aa all ten observations pass the generation-bound proof: advancing canonical
execution cursors and confirmed prior ACKs on the same socket, no counter
regression, reset, disconnect, validation failure or source cursor jump. Confirmed
ACK increments in runs1–5 are35,36,36,36,37current-only and35,37,35,34,38concurrent.
The last sent ACK remains unconfirmed until another packet follows. A live badge
alone cannot pass. [Proof semantics and rollback](current-execution-confirmation.md).

The initial b219 cohort records one false loading observation while the ACK chain
continues, and the focused counterfactual isolates its subscription trigger.
The first reporting predicate also confused the incumbent `reconnecting` enum's
ordinary durable catch-up with a physical reconnect. That initial summary is
retained as diagnostic error evidence. The repaired gate counts catch-up statuses
separately, requires generation/socket/cursor/ACK proof independently, and still
rejects loading/stale/failed statuses. Three repaired concurrent cases report
ordinary catch-up; none reports false loading. Initial records lack the later
generation field and cannot be recertified by the final proof contract.

No current/health HTTP timeout occurs in either cohort. Historical footprint
requests report expected aborts during the explicit pan/restore. Two additional
native-history requests abort across the initial/fixed cohorts; their individual
superseding triggers were not instrumented. They are retained, not mislabeled
current timeouts or silently omitted. Every released snapshot has zero execution
groups and zero active/queued history scheduler work before browser-context close.
This supports request/subscription cleanup, not a whole-app heap plateau.

The existing3%custom wall profile advances in every observation: repaired
current-only cursor increments273,278,272,223,252 and concurrent227,295,224,237,272.
It is already ready and processing live changes; this is not evidence of a
genuinely cold custom backfill competing with the views.

## Explicit acceptance boundaries

|Check|Result|
|---|---|
|Same-generation current execution/ACK continuity in the repaired footprint cohort|PASS10/10|
|No current/health timeout in these observations|PASS20/20 across both builds|
|Every requested closed footprint slot painted and validated under concurrent loading/cancellation|PASS5/5 per build,48+24slots|
|No false loading when a historical viewer joins the shared live group|Focused counterfactual repaired; no occurrence in fixed cohort|
|Released execution subscriptions and active/queued history work|PASS20/20 isolated contexts|
|Responsive delivery and rendering under concurrent history|INCOMPLETE; larger loaded receive gaps and long tasks remain|
|Two wall charts loading/current updates/cold custom backfill|Not established by this footprint cohort|
|Initial current paint latency, wall loading/warm latency, heap plateau and foreground UX|Not recertified|

Main-thread long-task maxima during the repaired observation windows are
206,0,0,54,66mscurrent-only and775,349,536,534,627mswith history. These are
substantial and require investigation; no60fps or smooth-interaction claim follows.
Raw frame records also include startup and must not be relabeled interaction-only.
All tests were headless; final i3 inventory has no visible test windows.

58focused staging/analysis regressions,23proof/gate/trace tests, typecheck and
production build pass (existing bundle-size warning). Raw source preflights,
every sample/request, screenshots, CPU/swap/heap/frame data, exact executed
harnesses, counterfactual, initial reporting error and final audit are retained in
`artifacts/pi-history-r1/current-continuity-r1/` and `current-confirm-{b219,8aa}-r1/`.
Two bounded300sserver observers each have60samples, no observer errors and a
terminal end record. They are observation windows, not synchronized per-request
phases. Protected service identities and healthy caught-up state are separately
verified after both cohorts.

The overall release remains incomplete. Existing wall latency failures, default
rolling-window composition/live-tail handoff, current delivery/rendering costs,
cold-build limitations and the remaining validation gates are unchanged.

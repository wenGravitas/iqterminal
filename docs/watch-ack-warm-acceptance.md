# Watch ACK ownership, compact warm codec and foreground acceptance

**Launcher tooling follow-up:** use the [hardened cleanup/manual instructions](foreground-launcher-cleanup.md). They supersede unconditional cleanup wording below; application results and their build/window scope are unchanged.

**Watch races are fixed and verified in isolation. Compact warm encoding/replay has a measured component improvement. The real current-ending workflow passes; foreground acceptance is ready to run, not yet observed.** Recommend review and merge after that foreground check, with the latency/admission limitations explicitly accepted. Production release additionally needs controlled protected-watch rollout and representative serving-route acceptance. An explanation of every historical SSH delay is not a new merge gate.

## Identity and scope

Task start **17 November 2026 04:33:38 UTC**, new-live cutoff **07:03:38**, final deadline **07:33:38**. This is a new fixed budget, not a renewal of a previous phase. Actual refs after the single fetch matched frontend `e9ccf7a1194a0de9ffba03f20fc17e134f32c766` / backend `6823a8df518625962c10fbd40f46bacf8297c2e3`. The inherited tunnel-log edit and unrelated work are preserved.

Tested applications:

- Frontend watch fix `d4bd841`; final compiled application **`58b3ae3eb17f93c8480a4cd9598052c1bc5d684e`**, including the codec change.
- Backend **`300fa5d00f607d7e3a990b128523ea265af363f5`**. The wall gateway/worker bundles are byte-identical to the previous `480d6dc` applications. Only their truthful build label changes. The protected watch service does **not** receive this deployment.
- The isolated watch harness bundles the actual new `attachWatchStream` module (source SHA256 `0ee9808b311b34db52762b0f5bf24e009b883ab0d27099c00d4150626904bdd8`). It opens no SQLite database and has no market polling or watch mutation routes.

[Manifest](../artifacts/watch-ack-warm-acceptance/manifest.json), [client build/assets](../artifacts/watch-ack-warm-acceptance/client-build.json), [backend bundles and operations](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/docs/WATCH-ACK-WARM-ACCEPTANCE.md). Later documentation/tooling/test-only tips are not new application builds.

## Watch correctness

The server used to enter the broadcast map before subscription. An early timer sent a frame; subscribe then erased its pending cursor, causing its legitimate ACK to fail. The extracted original code reproduces state4973 → subscribe4973 → ACK4973 →1008 deterministically. New code sends no state before a valid subscribe. A connection subscribes once; a repeated subscribe closes explicitly without resetting an outstanding frame. Idle subscription/ACK expiry is10s, pending delivery remains one frame, and the1MiB buffered-output/16socket/1KiB input bounds remain.

HTTP bootstrap is silent presentation, with no ACK metadata. Socket frames carry local generation/frame/cursor ownership through the worker/main-thread handoff. Main listeners finish before the ACK callback; exceptions are isolated. The worker sends only the exact current pending delivery, ignores superseded/duplicate local callbacks, and never regresses the applied resume cursor. Cursor0 is an initialized cursor, not a reason to adopt a later reconnect bootstrap head.

Tests cover timer-before-subscribe, normal delivery/events/ACK, delayed bootstrap after OPEN, old-generation and same-cursor-heartbeat callbacks, duplicate/unsolicited/stale/future/malformed ACKs, repeated subscribe, subscriber exceptions, watchdog/reconnect/disposal and delayed bootstrap disposal. A separate real loopback WebSocket integration test uses the same server module, with no protected process or database. Original assertions:3server failures and5client failures; corrected regressions pass. [Exact old/new ordering](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/artifacts/watch-ack-warm-acceptance/timer-race-reproduction.json).

The cursor-only wire format cannot distinguish a delayed duplicate from a new heartbeat with the same cursor; the paired client prevents that ambiguity with local frame ownership. ACKs without any pending frame are rejected. No arbitrary ACK is accepted and no protocol error is hidden.

The historical4973 capture is consistent with these defects; it does not prove its exact server ordering.

### Route actually exercised

Compiled client → `127.0.0.1:4204` Vite watch-only proxy → `127.0.0.1:4205` read-only protocol harness. Financial/current traffic independently uses4204 → split18990/18991 SSH → isolated18890 gateway/18792 worker. `VITE_WATCH_API_URL` is an explicit loopback-only development override; default routing is unchanged. This is an explicit protocol fixture, never a financial connectivity fallback.

During the timed final cohort the watch socket remains OPEN and applies/ACKs through275, without1008. The server log records96exact ACKs in that connection,95accepted through next-state evidence. After the final sample, the separate financial dump coincides with frame276 ACK arriving5.577s after send, then1005 close/reconnect. The next subscribe correctly resumes after276. This is consistent with the unchanged5s watchdog, but the exact close initiator was not captured; it is not a proven transport diagnosis. Cleanup closes one final298frame before application. [All sessions and scope](../artifacts/watch-ack-warm-acceptance/watch-route-proof.json).

No protected-watch deployment, real watch creation/arming/pause/edit, notification or financial watch-monitoring acceptance is claimed.

## Codec comparison on identical real input

10,383rows/70,858runs come from the prior real chart capture.19,197rows/83,467runs are read-only authenticated fragments from a retained immutable prepared rollback snapshot. Each part's compressed/content hashes and fragment coverage were checked. These are fixed component inputs, not fresh-source claims. Both compressed inputs and SHA receipts are included for reproduction.

One Pi/aarch64 headless Chromium session; sequential worker trials,128/256/512KiB targets in rotating order,3samples each/input. No live cohort/build/reference job competes. Existing user applications remain untouched, so scheduling noise is visible. All18round trips reconstruct exactly. Every sample is in [raw results](../artifacts/watch-ack-warm-acceptance/codec-samples.jsonl);3sample medians are descriptive, not five-run certification/p95.

| Input | Target128→256KiB chunks | Encode median | Replay median | First-content median |
|---|---:|---:|---:|---:|
|10,383rows|141→69|7.727→3.061s|3.371→1.540s|20.9→14.7ms|
|19,197rows|201→99|9.605→4.802s|5.225→2.537s|21.6→37.3ms|

For10k, median compression setup falls1.654→0.486s, decompression setup1.083→0.352s. For19k,2.317→0.536s and1.968→0.564s. Setup is nested in transformation time: **do not add them as exclusive phases**. JSON stringify/parse, transformations, hashing, publication and scheduling/yield counters are [separated here](../artifacts/watch-ack-warm-acceptance/codec-stage-summary.json). The synchronous collector callback is not chart preparation/rendering. Longest instrumented encode/replay slice intervals at256KiB are115.9/36.7ms(10k),59.5/67.1ms(19k); they include host descheduling and exclude awaited native transformation work, not a full browser long-task/FPS certificate. Native stream setup is measured separately.

512KiB sometimes gives faster total replay, but longer instrumented slices (up to112.3ms replay) and less attractive10kfirst content.256KiB is the smaller demonstrated setup reduction. It keeps the1MiB hard chunk ceiling,256point fragment bound,64MiB decoded/16MiB encoded totals,1024chunks, cancellation and per-chunk yields. Largest selected decoded chunks are262,142/262,134bytes. Retained codec charges fall1,606,514→1,536,847B and2,265,688→2,174,128B. No cache allocation increases or new architecture.

One uninstrumented confirmation per input:10k encode8.237→3.481s/replay6.384→2.383s;19k encode9.869→5.289s/**replay4.149→4.266s**. Preserve that slower replay sample; the result is not a universal latency claim. [Raw confirmation](../artifacts/watch-ack-warm-acceptance/codec-raw-samples.jsonl).

Version1small chunks remain readable; exact metadata/values/order and long-fragment coverage, corruption/identity rejection, byte limits, cancellation and restart-after-cancel are tested. Fresh publication still never waits for unfinished optional replay and retains the full replacement fallback/exact delta guards. No obsolete-encode coalescing was added without live evidence.

## Final ordinary workflow

Exact compiled pair above, real current-ending USD-M BTCUSDT15m, Top8/side,10%,native, normal panel padding/controls. VITE_DATA_MODE=staging, HISTORY_TILES=1, DIAGNOSTICS=1, selected ceiling128MiB. Headless/GLES requested; actual GPU acceleration/foreground FPS is not certified.

| Stage | Full fresh available-history paint |
|---|---:|
|Navigation→initial|**42.073s**|
|First nonempty native advance|**11.816s**|
|Second nonempty native advance|**19.168s**|
|Save Workspace→switch away→reopen|**15.556s**|

Completion uses the actual renderer transition: available content, required fresh validation, no pending projection/preparation/paint, painted=input revision. Health runs in a separate process. Screenshots and financial dumps are later. Parent activation-to-paint41.878s excludes194ms page startup; the table correctly uses navigation42.073s.

The early raw useful-content witnesses can precede a completed draw (reopen recorded paintedRevision=-1). They are **not accepted as paint evidence**. Matching painted-revision samples verify current content by6.470s, history by38.176s from navigation, and cached reopen content by3.217s from activation; these are sampled upper bounds, not exact first paint. The future harness guard is corrected. Full completion timestamps are unaffected. [Verified bounds](../artifacts/watch-ack-warm-acceptance/verified-useful-paint-bounds.json).

This window fits the **uncompressed** warm presentation path:3,810rows/~38k runs,0compact entries. Therefore the live table does **not** measure the codec optimization end to end. The larger fixed-input codec benefit is separate. Reopen still incurs whole-presentation paint/preparation; sampled maximum main-thread apply577ms remains a limitation.

Source records36,597→36,600(+3)→36,602(+2)→36,608(reopen). Same padded start1794781800000, eligible ends1794891119664→1794891160232→1794891174105→1794891195221. One genuine source gap stays explicit; unconfirmed tails about0/1.29/1.53/4.19s. Request completion means all available history, not continuous observed depth. Source inclusive horizon is exclusive eligibleEnd−1; projector terminal-duration boundaries can equalE without inventing a source record.

Initial preparation builds25canonical/25selected parts,51turns,21.944s step work/~29.309s admission→ready. Both advances and reopen rebuild0canonical prefix pages, reuse24input-prefix pages and process1tail.5turns each; step4.096/3.293/4.250s, admission→ready estimates4.874/3.919/5.403s. Seven nested source proofs cost2.59/1.69/2.31s,24queries/~625–632MB each. Same-host persisted elapsed estimates include coordinator wait; no host-clock subtraction. [Receipts](../artifacts/watch-ack-warm-acceptance/preparation-summary.json).

Immutable payload hits25/25/24parts on advances/reopen; reopen fetches1new part. Exact deltas publish16/16/18patches. Worker validation/whole-union work remains. Existing archive data stays retained during pending validation; every sampled completed pending paint shows historical walls and the old horizon. In-progress redraw counters temporarily read0, which is not proof of an empty canvas or flicker-free interaction. Saved bounds restore within0.42ms. [Retention/save proof](../artifacts/watch-ack-warm-acceptance/saved-and-pending-proof.json).

All four final prepared outputs exactly equal the unchanged financial importer:3,810/3,810/3,810/3,812rows and38,405/38,408/38,410/38,420runs, including profile/coverage/horizon. Final reopen checks3,796closed rows in the real chart exactly. Producer/full-reference results from earlier capacity/continuation phases retain their original scope and are reused, not rebuilt. [Equality](../artifacts/watch-ack-warm-acceptance/final-real-equality.jsonl).

77focused frontend cases +36related warm/delta/cache/lifecycle cases,35backend cases, typechecks and production builds pass. App source was unchanged after the tested builds; later commits add tests/tools/docs/evidence.

### Failures and current observations

The first attempt stops on explicit history admission503:4active slots,3historical, with concurrent startup discovery/native requests. Gateway rejects in0.19ms. This is not the historical SSH timeout. Its independent health observer also fails to start because a copied evidence-path guard still named the old task; the exact error is preserved. The guard is corrected once, and the one targeted rerun passes without Retry. A normal scoped Resume action is supported, but this run did not exercise it. No gateway capacity/deadline change or repeated lucky-run cohort.

Final independent health24/24HTTP200 within12s, maximum6.554s.99advancing exact confirmed execution ACKs, longest gap7.427s, no execution reset/error; current walls/footprint progress independently. The last sample shows watch OPEN. Later dump-time watch reconnect is separately scoped above. These are finite Pi-route observations, not proof of the old forwarding cause. [Workflow/trace summary](../artifacts/watch-ack-warm-acceptance/validation-summary.json).

Successful slow requests are also attributable at the bounded route boundary: extension2discovery `e8e92cde-d584-40fd-a5e7-1c6e47afa547` completes in6.395s at the client while its matching gateway handler finishes in9.60ms; reopen ready discovery takes3.316s versus200.54ms. These are successful requests, not new deadline failures. Their outside-handler wait is not called rendering, and no exact transport/process cause is claimed. [Existing correlated stages](../artifacts/watch-ack-warm-acceptance/successful-stage-attribution.json) use per-process/request durations, not host-clock subtraction.

## Foreground handoff: ready, still manual

The **pre-hardening launcher startup/shutdown path was exercised without a browser in this phase**. The later session-owned cleanup changes have focused offline validation, as described in the linked follow-up; they are not a new live smoke or foreground result. In this preserved workspace:

```sh
cd /home/daz/workarea/iqterminal-integration-startup-r1
python3 scripts/watch-warm-foreground.py
```

It verifies exact retained build hashes, free ports/current allocation/reserves and compatible root; starts only the isolated pair, split tunnels, read-only watch harness and preview. It creates a separate user-invoked20min manual receipt, never edits this task's budget. It launches **no browser, build, headless cohort or reference job**. Its20min local active window is followed by bounded cleanup attempts; it is not an unconditional remote lifetime guarantee.

Manually select **i3workspace9**, open `http://127.0.0.1:4204` in normal Chromium, and:

1. Open ordinary USD-M BTCUSDT15m, Top8/10%/native, show approximately30h historical walls. Record useful current/history and complete status. A shifted left boundary can require new preparation; do not label it a warm continuation.
2. Pan/zoom and interact while validation is pending; check retained walls, readable explicit gap/tail/preparing status and stalls/flicker. Make two small genuine same-start end advances without waiting for a candle boundary.
3. Explicit Save Workspace, switch away, reopen latest saved view. Separate cached paint from fresh validated completion. Check restored bounds. Add a separate current5mUSD-M footprint panel (or Footprint Totals on a candle chart) with $25rows, and verify forming-bar/totals and current walls keep advancing.
4. Watch traffic on this preview is an explicitly labelled **empty-watch protocol harness**, not the user's real monitor. Real watches remain on the incumbent. Do not create/arm/change any real watch.

Close the candidate tab, then **Ctrl-C in the launcher terminal** to request cleanup. Read the new session-scoped cleanup report: capture is best-effort and remote shutdown can remain unconfirmed if access fails. Use only the printed recovery command for that session; prepared state is preserved. Existing ordinary client/production/collectors remain untouched. Do not claim acceptance until these observations are made.

## Separate decisions

| Area | Decision |
|---|---|
|Watch protocol|PASS deterministic + isolated real WS + compiled-client route; protected watch deployment unverified/unchanged|
|Financial/workflow/capacity|PASS at documented scope and existing configurable allocation|
|Cached codec|MEASURED component reduction; mixed raw replay confirmation; live smaller map bypassed codec|
|Fresh completion performance|Functional PASS; still slow. No causal full-workflow improvement or five-run target certification|
|Foreground|READY TO RUN, PENDING user observation|
|Pi/SSH development route|24health pass within12s, execution gap7.43s; variable historical risk remains, not a new backend timeout claim|
|Representative serving route|NOT ESTABLISHED: repository/owned services provide loopback APIs and Pi SSH preview, no already-authorized frontend serving route outside that chain. No new public listener/infrastructure deployed|
|Merge|Recommend review, then merge after foreground usability/status acceptance and explicit acceptance of documented latency/manual Resume behavior; no requirement to solve every old transport incident first|
|Production release|HOLD for controlled paired-client/protected-watch rollout, foreground outcome and representative serving-route acceptance; this goal grants no production deployment|

Original3sfirst-history/5smedian/10smaximum prepared-view and1swarm targets remain unchanged. This new initial view includes real canonical preparation; it is not a ready-server certification. Observed fresh completion remains above the intended experience, prior failed ready-server results remain failed, and five-run median/max certification is NOT RUN. Sampled cache bounds are not proof of sub-one-second paint.

Small next actions: perform the manual check; address bounded startup discovery Retry-After/coalescing if the503manual-recovery UX is unacceptable; investigate the remaining full warm-map presentation/main-thread apply work on matching ready inputs. Do not increase caches or reopen general transport tracing by default.

## Cleanup and rollback

All measurement browsers/observers, preview4204, harness4205, tunnels18990/18991 and isolated roles are stopped, including the launcher contract smoke. Consumers/readers/pins0, no root lock; useful compatible prepared state remains. All35protected identities/start times and recorded limits match. Incumbentf1/protocol4/flag0, main, production, raw collectors/history, frozen refs and comparison control remain unchanged.

Existing protocol6isolated root and sources1only on its candidate pair are preserved; no promotion. Recovered ClickHouse6GiBRAM/8GiBRAM+swap/global4.5GiB settings remain. Final Spot/USD-M10%lag1.19/2.65s; stale3%profile is not substituted. Source overflows stay USD-M2/Spot0/depth0 and unrelated Hyperliquid52. Candidate~34.6MB/all retained wall roots~1.73GB; free~171.7GiB. Supported normal unleased retirement occurred; no manual deletion/reset.

Rollback uses the untouched incumbent route. For root6, the previous6823/480code is compatible at the same allocation; never open it with f1/root4or relabel markers. Frontend e9ccf7a is the compatible previous client; codecversion1remains readable either way. Watch schema is unchanged, but **this task does not restart the protected watch service**. A future rollout must reload paired clients and plan the existing restart/interruption semantics/rollback explicitly.

Live/operational experiments ended early **05:11:13UTC17November2026**. Remaining work is evidence publication and handoff; no budget renewal.

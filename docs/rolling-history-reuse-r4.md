# rolling-history-reuse-r4

**Implementation outcome: MEASURED IMPROVEMENT. Release recommendation: BLOCKED.** Two small backend changes remove demonstrably wasted overlap decoding and repair false source-revision failures at the eligible rolling tail. The historical transport/replay incident remains unresolved; this task does not claim a reliability fix.

This independent task started **13 November 2026 08:02:52 UTC**, with implementation cutoff **09:42:52** and final deadline **10:02:52**. The [new manifest](../artifacts/rolling-history-reuse-r4/manifest.json) is runtime-derived. Previous reports, deadlines and failed observations retain their original scope. This is one matched preparation pair and representative chart smoke, not latency certification.

## Changes and matched evidence

Backend performance commit **03497963c7514e6c1155443f508c3eeced29946a** checks the validated overlap manifest before a timestamp-closure scan. When the same bounded part set necessarily exceeds the incumbent 8MiB scan limit, it selects the same authoritative FINAL SQL immediately. Previously it decoded cached parts, exhausted the limit and discarded the work before issuing that SQL. It does not assume timestamps increase: replacement epochs, repeated timestamps and late rows still require exact closure.

Backend correctness commit **f1fb0d696312a6019f9194edba61a2dc225bc6c3** fixes the private source fingerprint's exclusive confirmed end. An eligible half-open request ending at `head.at+1` previously changed token as the unrelated head advanced by one millisecond. Two normal rolling builds failed final validation despite identical source records, anchor, hash and zero later-cursor rows inside the requested time. The corrected initial token equals the existing fully-closed token. Genuine corrections and late rows still invalidate it; no requested millisecond or source validation is removed. [Diagnosis](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/artifacts/rolling-history-reuse-r4/token-boundary-diagnosis.json).

The success measure selected before editing was less discarded overlap work and lower canonical preparation time, preserving exact output. Both benchmark variants start from byte-identical copies of the same prepared canonical dependency and selected prefix, with no target progress. Target **1794447000000..1794555803582** extends the same-start ready default by **803,582ms**. Source proof, inventory and settings are pinned: USD-M BTCUSDT, Top8/side,10%,native,15m chart context. One bounded0.5CPU/384MiB helper runs at a time through the existing SQL proxy. No source jobs are deleted or limits increased.

| Matched preparation metric | Baseline5358c1c | Candidate0349796 |
|---|---:|---:|
| Canonical preparation |120.58s|100.38s|
| Projection including prefix installation |52.83s|51.39s|
| Ready work, canonical + projection |173.41s|151.77s|
| Process CPU |77.58s|61.12s|
| Decoded overlap parts / bytes |822 /1,625,436,627|457 /900,930,542|
| Manifest reads |1,036|671|
| Discarded closure decoded bytes |669,666,511|0|
| Exact closure SQL fallbacks |98|98|
| Build SQL queries / response bytes |250 /386,815,514|250 /386,815,514|
| SQL queue time, overlapping stage |29.10s|38.91s|
| Projection prefix pages reused / remainder |102 /2|102 /2|

Ready work fell **21.63s (12.5%)**, despite9.81s greater SQL queue wait. This is a small sample, not a statistical claim. Database durations overlap preparation/queue timings and must not be added as exclusive phases. Counter detail, query rows/bytes, compression/writes and exact identities are in the [backend comparison summary](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/artifacts/rolling-history-reuse-r4/comparison-summary.json). Initial proof/setup query categories sit outside the matched timer. Final file-digest auditing adds approximately8–9s to the helper's total elapsed time and is excluded from ready work. Canonical serialization was not captured inside these paired counters; any separate encoding pass is labelled separately.

Every parsed canonical page and selected part was compared with the unchanged implementation: **104 canonical pages,105 selected parts,38,528 closed records and16 active segments**. Exact selected values, runs, ranks, identities, decimals, seed, source boundaries, gaps, coverage and active state match. This is stronger than matching compressed hashes. Closed-cache revalidation on the final deployed token fix retains the old selected key/token and the benchmark's exact source token.

## Ordinary chart observation

The final application pair was client457ac9a / gateway+workerf1fb0d6. A fresh empty browser context used the native wheel to establish **30h of past viewport plus ordinary future whitespace**, then the real Indicators/settings controls selected USD-M15m, Top8/side,10%,native. No wall request override, fixed-range rewrite or fixture was used. The initial target had overlapping prepared canonical data but no exact same-start selected prefix. Reopen used a real workspace switch to destroy/restore the chart and selected its completed client cache plus the newly ready server projection.

| Final ordinary-chart smoke | First current walls | First historical walls | Complete available history / pending state |
|---|---:|---:|---|
| Initial navigation |7.637s|251.919s|By272.366s, previous sample270.082s;40,025 archive segments/187,427 runs;three explicit gaps;6,979ms unconfirmed tail |
| Dependent workspace reopen |5.526s from return|0.990s cached prefix|Whole advanced view still pending at301s;new7,429ms tail preparation started after eligible projection delivery |
| Server initial target |—|—|Ready241.789s from same-server admission;104 canonical/105 selected parts |
| Server reopened eligible target |—|—|Ready233.524s;103 canonical projection-prefix pages reused;105 selected parts delivered |

Initial current paint was1.922s after the Add Order Walls action; navigation timing includes UI setup. Reopen is not a fresh browser sample or server-only cache result. Initial available-history completion retains `rangeComplete=false`: requested **1794451500000..1794560465222**, eligible end **1794560458243**, inclusive loaded horizon **1794560458242**. Gaps are `Depth disconnected` and two `Observed book capacity: epoch invalidated` events. The short unconfirmed tail is not silently certified.

The executed harness incorrectly required inclusive `loadedThrough >= exclusive eligibleTo`, leaving its raw completion field null by one millisecond. [Offline correction](../artifacts/rolling-history-reuse-r4/coverage-predicate-correction.json) uses the exact documented head-boundary contract and saved status/render samples, retaining range, source, painted-revision and budget checks. No application threshold or requested range changed; raw flags and executed source remain preserved. The published harness is corrected. This explains why the initial observation continued to its finite cap despite available completion.

On reopen, ready eligible end1794560762372 was followed by target1794560769801: **7,429ms more history**, with the normal requested end also advancing1,090ms. All105 eligible projection parts arrived and good history remained visible, but whole-view validation moved into another canonical build before a complete snapshot. At release that tail job **e7534e17…** was paused at20 canonical/0 selected pages, not failed or unavailable. The exact UI trigger for the millisecond request-end advance was not separately instrumented. [Ordinary summary](../artifacts/rolling-history-reuse-r4/ordinary-summary.json), [all samples](../artifacts/rolling-history-reuse-r4/browser-samples.jsonl.gz), [initial screenshot](../artifacts/rolling-history-reuse-r4/ordinary-initial.png), [reopen](../artifacts/rolling-history-reuse-r4/ordinary-reopen.png).

Server per-step sums were admission1.98s/canonical102.87s/projection51.37s initially and1.43s/90.53s/57.28s on reopen. Approximately85s of each request-to-ready elapsed lies outside measured job steps, including coordinator pacing/accounting and fair peer turns; this is not all SQL or pure admission wait. Initial selection wait was761ms/25ms. These are same-server observations, not cross-host timestamp subtraction. Absolute browser duration is still poor. Different ordinary windows and preceding failures are not a matched browser before/after comparison; only the pinned backend pair supports the12.5% latency claim.

Both pre-token ordinary builds failed source validation and painted no history; their evidence is preserved in `pre-token-browser`. Two earlier harness preconditions are also preserved: plain candles ignored the footprint-only saved range and accidentally requested63h (400 before job admission), then a total-width check incorrectly counted future whitespace against30h past. They are excluded from the valid ordinary comparison. The operator-stopped pre-token reopen generated a harness page-closed cleanup error; it is not called a spontaneous browser failure. The final run has128 discovery `ERR_ABORTED` request events and no page errors; individual cancellation attribution was not established. The saved proxy trace has no timeout/error terminal events. These events remain available for review.

During the final cohort, **1,017 complete execution messages /1,016 confirmed ACKs** advanced3519758827→3519768344; maximum complete-message gap4.172s, no stream errors, resets or closes. No natural replay stall occurred, and no extra healthy replay cohort was run. This observation does not resolve the historical incident.

After close: zero wall subscriptions/groups/jobs/consumers, zero reader-control active/queued work, zero server consumers/readers/pins/cancelled pins and no comparison locks. Two bounded client warm entries retained9,110,845bytes; sampled heap peaked274,764,724bytes. This single reopen is not a heap-plateau certification. Postflight worker204.1MiB/384MiB, gateway115.3MiB/512MiB; root655,258,609bytes including124,843,330bytes comparison data, capacity pause false. Protected8 identities/start times remain unchanged. A Pi1s sample showed22,564KiB/s swap-in and7,736KiB/s swap-out; PSI files are absent. Headless timing under that load is not foreground rendering certification.

## Build, deployment and operations

Initial branch heads were frontend **577de5f71008d97d60d286c777ee96c686532a07**, backend **5358c1c35aab936156a5ff961db8ab8032553772**; GitHub draft PR heads matched. Inherited dirty/untracked work was preserved. Main, production, collectors, raw retention, frozen references and comparison-control remain unchanged.

Observed client remains **457ac9a19d9f1d4642c1230988f4d97d0ae3dbbb**, using its truthful frozen application artifact. No frontend application code changed. A separate truthful577de5f validation build passed and was not served. Final gateway and worker application build is **f1fb0d696312a6019f9194edba61a2dc225bc6c3**. Documentation/tooling PR tips are not application deployment identities. Preview flags remain staging/history tiles1/diagnostics1; **IQ_WALL_PROJECTION_SOURCES=0 in both server roles**. No new format, cache protocol or independent-publication path was enabled.

The owned route is loopback4202 → split SSH history18880/current18881 → server gateway18880 → existing protected sources. Separate transports, ControlMaster off, compression off and IPQoS none were existing settings, not a new remedy. The protocol4 root remains `/home/daz/iqterminal-wall-serving-v4-35d7947-r1`. Exact containers, bundle hashes and compatible rollback are in the [backend companion](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/docs/ROLLING-HISTORY-REUSE-R4.md).

Backend79 focused financial/overlap/source/recovery/lease/default-rollover tests, typecheck and build pass. The new boundary regression fails on old code and passes on the fix. Oversized closure, cancellation, corrupted consumed parts, late/regressing timestamps, prefix rejection, restart/resume and dependency lifetime remain covered. Existing integration/footprint financial evidence is reused with its original build scope; unrelated suites and protected-service restart tests were not run.

## Remaining work and release decision

The enabled path still completes the whole canonical target before installing its projection prefix, and a7.429s tail advance started that work again after ready eligible delivery. The matched build still spends100s canonical and51s projection, even with102 prefix pages reused. This task retains the useful reduction; independent publication remains a separate architectural decision. Original Pi latency misses are not relabelled as passes.

Priorities: (1) capture an eligible genuinely failing current-stream cursor/from pair and compare the same replay across the first failing boundary; (2) trace the normal millisecond request-end advance and evaluate exact bounded continuation for the7.429s tail, including coordinator turn overhead, before choosing a larger publication change; (3) complete the manual foreground/interaction check. Do not repeat healthy replay cohorts as proof of resolution.

Manual check: select **i3workspace9**, open normal Chromium at `http://127.0.0.1:4202`, set USD-M BTCUSDT15m and approximately30h past through normal controls, enable Top8/10%/native Order Walls, then pan/reopen and check current freshness, gaps, profile/delta-flip overlays and responsiveness. Automated evidence uses Pi headless Chromium/canvas2d; no unattended foreground browser was launched. The unresolved historical reliability incident keeps the release **BLOCKED**, separately from this measured performance improvement.

The measurement browser and helpers are stopped. Idle owned preview118684 and split SSH118681/118682 remain for the manual check; verify argv/cwd/start ticks against [ownership](../artifacts/rolling-history-reuse-r4/local-serving-ownership.json) before stopping only those PIDs. Ordinary5173 and user processes remain untouched. The two preserved pre-fix failures were marked nonretryable in their archived UI status. Repair requires the existing explicit new-revision control path; UI Retry recovery of those entries was not verified here. Ordinary polling must not reset them. Final cleanup/assertions and exact server phase data are in the backend postflight/ordinary summary.

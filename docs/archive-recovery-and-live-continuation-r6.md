# archive-recovery-and-live-continuation-r6

**Archive querying: BLOCKED. Horizon: recovering, not fresh. R5 real continuation: IMPLEMENTED, VALIDATION INCOMPLETE. Release: BLOCKED.**

Two authorized recovery interventions reduced one demonstrated cache cost and restarted intermittent archive progress, but the required real-source proof still fails at ClickHouse's global-memory boundary. No real parent/two-extension/browser cohort was started on that failing dependency. R5 implementation and its fixture results are preserved without being relabelled as live acceptance.

## Scope and identities

R6 start2026-11-15 **09:15UTC**, recovery checkpoint due10:15, experiment cutoff11:45, deadline12:15. The task concludes early after the two permitted interventions and a finite recovery observation; previous deadlines remain closed. [Manifest](../artifacts/archive-recovery-and-live-continuation-r6/manifest.json).

Fetched frontend/PR1 `f32aa408e1a2519fbb052c9d0d14c902c93c89f4`, backend/PR2 `66ce17eb67bf2dffbbfe2e1aa1b63511336d5e4e`. Client application remains981d206; R5 candidate application771265c remains stopped. Actual incumbent gateway/worker remain **f1fb0d696312a6019f9194edba61a2dc225bc6c3**, flag0, private protocol4 root `/home/daz/iqterminal-wall-serving-v4-35d7947-r1`, gateway18880/control18791. No candidate route, preview, tunnel or browser was launched in R6. Protocol5 state was preserved and never opened with an old binary. Documentation tips are not running builds.

## Archive diagnosis and correction

ClickHouse25.8.16.34 is IQTerminal's `/opt/iqterminal` staging dependency:4GiB container/2CPUs,3,000,000,000B global tracked-memory cap,8-query limit. It is shared by IQTerminal collectors/materializers/APIs. Running-client inventory found no Squawkdeck production/staging client using it. Container and host memory limits are distinct; host available memory was~50GB, while ClickHouse was at its own global cap. No candidate OOM caused this failure.

Baseline tracked memory was~2.9–3.0GB despite small sampled foreground queries. Index-mark cache held915.4MB with a configured5GiB allowance. Existing query/thread/part logs were disabled/absent; current system tables, request/query IDs and summary headers supplied bounded attribution. The source-proof helper used the actual application function and SQL proxy18790→ClickHouse18123, with no payload/environment/credential capture.

Intervention1: hot-reload **index_mark_cache_size=134217728** in the mounted staging config, preserving all other effective settings. Actual cache use fell to134.2MB. The first reload exceeded its observer deadline during eviction; its initial exception path restored the file. Effective state was inspected and the same intended cap reapplied successfully, with corrected unknown-outcome handling. No service restarted. The retained configuration is a verified cache bound, **not an availability cure**.

Intervention2: one `SYSTEM JEMALLOC PURGE` to return unused allocator pages,500.64ms. No history/source/prepared state was deleted, and no limit or persistent data changed. Background merges then occupied~0.8–0.9GB across8–12tasks, consuming much of the recovered headroom. Merge/allocator pressure remains a supported hypothesis; not every resident byte is attributed.

| Evidence | Result |
|---|---|
| Baseline required proof |Progress45.79ms; anchor failed61.43ms after70.61MB read|
| During reload/rollback transition |Anchor failed9.29ms; explicitly transitional evidence|
| Stable retained cache cap |Progress1122.78ms; anchor2253.46ms/233.27MB; content failed834.28ms/61.03MB|
| After allocator purge |Progress502.79ms; anchor failed200.71ms/10.04MB|
| Final tracked/merge/index-mark memory |2,980,786,071 /881,916,587 /134,217,696B|

All four required-proof observations failed with global-memory Code241. These are defined diagnostic stages, not a passing latency sample set. Durations are monotonic within the helper and include SQL wait; failed summaries do not certify complete scan bytes. R5's seven proof callbacks per continuation cannot be assigned successful live costs here. All query/read/wait metrics and failures are retained in the backend evidence.

## Horizon and recovery decision

Across11.69minutes baseline-to-postflight, USD-M archive advanced10,874cursors/18.50minutes of event time; Spot31,903cursors/53.43minutes. Final lag: **22.20h USD-M**, **22.72h Spot**. In the defined5min metadata window,7/11USD-M and6/11Spot archive-health samples reported unavailable. Both raw source heads remained current while the archive was stale.

At unchanged observed rates, illustrative catch-up arithmetic is~38h USD-M/~6.4h Spot; this is not a forecast and neither fits the remaining R6 budget. **Early recovery checkpoint: availability blocked, horizon recovering but not fresh.** Two interventions are exhausted, so no additional recovery change is silently attempted.

## Continuation, client and release

The pinned real request remained USD-M BTCUSDT15m Top8/10%native, approximately30h, from1794543300000 to1794653080000, archive epoch1794650187134. It was not shortened. Required proof never completed: no parent, extension watermark/token, ready publication, exact real reference equality, canonical-rebuild counter or live client-delivery timing is claimed.

The first and second real extensions, sequential references and ordinary compiled parent/extension/reopen cohort are **not established**. Candidate current footprint ACK progress/longest gap is **not measured**; R5's incumbent ACK smoke is not substituted. No intercepted responses, empty-tail shortcut or forced ready state was used. R5's fixture equivalence, lifecycle/shifted-start regression checks, historical transport uncertainty and watch1008 observation retain their original scope. No new browser/replay cohort was run merely to accumulate passes.

Release remains **BLOCKED** by the failing required dependency and absent real two-generation proof. This does not invent an indefinite new investigation requirement for every historical incident.

## Validation and operations

Backend typecheck/build, diagnostic build/Python syntax and XML-invariant checks pass. Financial/client/continuation application source is unchanged; R5 focused correctness evidence is reused with its original scope. Main, production applications, raw collectors, frozen references, inherited dirty work and comparison control were untouched.

Only active correction: `/opt/iqterminal/ops/clickhouse.xml`, SHA256`fefdfeeaea5da98df1efbcd36cc3ddaaa077705a6848d43c7867a594a9b52e06`; backup`/opt/iqterminal/ops/clickhouse.xml.r6-before`, old SHA256`d732f8bcf5d1aa053e42dabc9b37ed4d1d478630f12c728ebff5d8e9285ce744`. Rollback is guarded **in-place** restoration plus `SYSTEM RELOAD CONFIG`; do not assume a timed-out reload failed. Restoring the previous large allowance may reintroduce pressure. No restart is needed; allocator purge has no persistent rollback.

Cleanup confirms unchanged incumbent/ClickHouse/protected service start identities, zero consumers/readers/pins, stopped candidate, preserved root4/root5 protocols and useful prepared data. Finite sampler/helpers ended and the task diagnostic upload was removed. All derived roots1,659,152,213B; free184,487,059,456B. USD-M collector queue53→7 and overflow counter unchanged at2 between the first post-intervention sample and final capture; the entry overflow counter was not captured, so no earlier transient-overflow claim is made. A Spot health probe lacking its required request context returned400; it is not classified as a new collector outage.

## Smallest concrete next action

The backend **R6-ARCHIVE-RECOVERY-PROPOSAL.md** contains exact commands, preconditions, affected workloads, expected benefit, risks and rollback for one guarded **maximum120s** pause of background merges on only `depth_records` and `spot_depth_records`, independent restore watchdog first, one identical source proof, then unconditional START/verification. It tests the remaining merge-pressure hypothesis; passing only during a pause would not establish ordinary-load reliability.

That third intervention was **not authorized or executed**, because the user's R6 limit is two. No vague healthy-window request, shared-limit increase, raw-capture stop or speculative restart is substituted. After a durable verified dependency correction, run the isolated protocol5 real parent/two-extension/reopen cohort. Foreground checking remains manual on **i3workspace9** after live validation.

Detailed diagnosis, raw receipts, resource identities, proposed diagnostic and rollback: backend `docs/ARCHIVE-RECOVERY-AND-LIVE-CONTINUATION-R6.md` and `artifacts/archive-recovery-and-live-continuation-r6/`. [R5 handoff](rolling-tail-continuation-r5.md) remains valid under its original scope.


## Subsequent separately authorized recovery

[archive-capacity-recovery-and-live-validation](archive-capacity-recovery-and-live-validation.md) records the new archive allocation, source proofs and candidate checks. R6 above retains its original deadline, failed results and scope.

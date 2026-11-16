# Fresh current walls and incremental client delivery

Task budget: 15 November 2026, **11:56:06 UTC** start, **13:36:06** experiment cutoff, **13:56:06** final deadline. This is a separate task; prior evidence and deadlines remain unchanged. [Manifest](../artifacts/fresh-current-walls-and-incremental-client-delivery/manifest.json).

## Implementation and scope

Client `241406ed1367fb0fb973200e8edc2f24252fc471` retains authenticated immutable prepared parts across projection identities in a worker-owned **128 MiB / 256-entry** LRU. The existing warm-presentation budget remains **32 MiB**, separately accounted. Accounted charges include parsed records/runs and key metadata; pinned/staged entries count toward the same ceiling. Immutable membership must be authenticated by the newly validated manifest, core, full profile/settings/schema identity and left boundary. Source validation, full-union financial validation and publication barriers still run. Hash mismatch, eviction, identity mismatch, cancellation and failed validation fall back correctly; failed imports cannot seed reusable entries.

A completion-only cooperative exact delta compares the validated presentations. Unchanged history stays visible while pending. The old revision/count/horizon must match before publishing changed terminal/active segments and removals; collisions or more than4096 changed patches fall back to the complete snapshot. The result holds no chain of old presentations. This removes whole-history worker→main replacement for suitable extensions; it does **not** remove whole-presentation assembly or financial validation.

Native **Save Workspace** now captures the latest ordinary candle/walls viewport. Saving does not validate data or mark cached paint fresh. Footprint/current-only/unsupported capture paths retain their previous behavior.

Backend `2841b50ae024ca684fca9803ed998dc06a70bbc4` fixes a newly reproduced per-query anchor failure before delivery. A single consistent storage snapshot selects the FINAL replacement anchor key in exact time/cursor order, then reads its payload. Existing epoch, pinned cursor, carry-in and source-token semantics remain. This is separate from the previous global-memory recovery; no query/resource/deadline limit was raised. [Backend report](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/docs/FRESH-CURRENT-WALLS-AND-INCREMENTAL-CLIENT-DELIVERY.md).

## Matched prepared-delivery comparison

Same real parent/two-child manifests, same Pi/browser/private route/backend2841 build, fresh browser contexts and reset process-local gateway encoding cache before each run. Parent loaded normally before extending. Both children were already server-ready. One comparable observation per build, **not statistical certification**. Auxiliary current-only walls and a real current footprint subscription remain active. No builds/tests/reference work overlap these final browser observations.

| Fully painted available history | Unchanged client5a09b8 | Candidate241406e |
|---|---:|---:|
| Cold-client ready parent, navigation |29.441s|19.092s|
| First native extension |24.028s|7.215s|
| Second native extension |30.136s|5.939s|
| Extension1 fetched/reused parts |86 /0|1 /85|
| Extension2 fetched/reused parts |86 /0|1 /85|
| Extension1 encoded/decoded transport |3,020,791 /39,367,286B|19,282 /213,536B|
| Extension2 encoded/decoded transport |3,024,394 /39,405,782B|22,727 /252,032B|
| Extension1 whole snapshots / exact history patches |1 /full prefix|0 /100|
| Extension2 whole snapshots / exact history patches |1 /full prefix|0 /61|

First useful parent history is sampled by14.447s baseline and8.640s candidate; these are sampled upper bounds, not exact frame timestamps. The cold-parent difference is a single noisy observation, **not attributed to warm reuse**. The supported extension improvement removes85 unchanged-part transfers/decodes and full-history main-thread replacement. Main-thread handler work during the two extension phases falls from~2.58/4.36s to~0.11/0.10s (includes independent current patches). Maximum individual handler calls in the old extension phases reach2.47/4.25s; candidate cumulative maximum remains~123ms. Whole-union assembly still visits46,309/46,354 records; exact delta compares177,875/178,188 value runs in~486/421ms including~76/30ms cooperative yield. These costs overlap other stages and are not added as exclusive time.

Saved latest retained viewport reopen paints useful cached content in**2.849s**, then completes independent validation and paint in**15.371s**. All86 parts are reused (zero batch fetches); this is not a subsecond result. The identical latest viewport and full completion predicate are verified.

[Stage summary](../artifacts/fresh-current-walls-and-incremental-client-delivery/delivery-summary.json), [network bytes/request IDs](../artifacts/fresh-current-walls-and-incremental-client-delivery/network-summary.json), [exact real importer equality](../artifacts/fresh-current-walls-and-incremental-client-delivery/client-real-equality.jsonl).

## Validation

143 focused client tests, typecheck and production build pass. Cases include both successive terminal replacements, cold/partial eviction, changed identities/content, failed final proof, cancellation, immutable alias prevention, bounded disposal, delta correction/removal and snapshot fallback. The final client importer exactly matches unchanged5a09 code for all three real prepared revisions: full segment identities/values/ranks/runs/order, profile, coverage and horizon. Prior successful backend full-reference financial comparisons retain their original scope; no repeated producer rebuild is substituted for this client equality.

Final matched cache occupancy is~122.4MB accounted,88 entries, zero staged/pinned after import. Chromium descendant RSS sums (shared pages counted more than once) range~1.71–2.18GiB across candidate completion samples, versus~1.74–2.08GiB baseline. Candidate main-page reported heap spans~9.6–328.7MB; these are sampled observations, not a retained-heap plateau certificate. Temporary presentation overlap and the separate32MiB warm budget remain visible.

Retained candidate route:61 advancing exact ACK acceptances over~52s, longest confirmed gap3.479s, no execution reset/stall captured. The separate historical transport cause remains unresolved; nonrecurrence is not a fix. A baseline level-watch1008Invalidcommand close is retained separately. Native-candle closure on workspace switch is expected.

## Fresh-current cohort and release decision

**Freshness PASS; fresh-current history BLOCKED.** At12:47 the Spot/USD-M10% horizons lag1.640/3.643s; at12:55 they lag1.347/2.844s. Both advance with ingestion/merging enabled and no resource change. Old3% source remains old and explicit. The previously observed12.185-hour USD-M lag is no longer current.

The ordinary compiled30-hour current-ending request is**1794637800000..1794747030218**, with valid archive eligibility through**1794747027725** (2.493s unconfirmed current tail). It is not moved back to an old archive horizon. Actual current walls paint by the first positive sample at**4.478s**. Initial historical preparation fails at~128–130s with**Prepared wall view part capacity**. No history paints; no completion is claimed. The genuine advance and latest fresh-current saved/reopen are therefore **not reached**. The successful saved/reopen above applies only to the retained validated viewport.

The fixed eligible source proof contains**149,263records**. The durable checkpoint has**128canonical parts**,143,663observations,258,045,694decoded bytes /12,389,818compressed bytes, after28858413 versus pinned28960225. Approximately5,600source records remain. There is no selected publication. This is the existing128-part canonical limit, **not** archive unavailability, the2.5GiB disk allowance, or a client-cache miss. The incomplete checkpoint remains preserved. Limits, range, financial detail and coverage were not changed to obtain a pass.

During this130.2s fresh-current workload,**166advancing exact ACK acceptances** progress3525866077→3525867104; longest internal confirmed gap**6.051s**. Execution socket remainsOPEN and no execution reset is captured. Current-wall confirmations advance1794747027724→1794747151042. All**23candidate-route health observations pass** the existing12s deadline (maximum6.304s). One level-watch1008Invalidcommand and a subsequent level-watch1005/reconnect are separate and preserved; they do not interrupt execution or explain the canonical capacity failure. No historical transport fix is claimed. [Current-route metadata](../artifacts/fresh-current-walls-and-incremental-client-delivery/current-summary.json).

## Capacity, deployment and cleanup

Recovered ClickHouse remains6GiB container RAM/8GiB combined RAM+swap,4.5GiB global protection, bounded caches, same October12service identity. No restart, merge control, allocator purge, admission/deadline/resource increase or collector change occurs in this task. The narrow anchor query fix is deployed only to the isolated pair.

At the failure snapshot all retained wall roots total**2,077,637,695B**, of which candidate**109,314,361B**, incumbent roughly590.6MB, and the balance coexisting old experiment/rollback roots. Both160MiBwriter headrooms, incumbent future permitted growth and20GiBfree-space floor remain reserved; server free space is~187GB. The user-approved isolated**2.5GiB** allowance is unchanged. Older unleased comparison parent generations retire through supported retention after equality/delivery checks; latest validated child and failed fresh progress remain. No raw/source data or required rollback root is deleted.

**Ordinary2GiB aggregate serving readiness is not certified.** Many coexisting experiment/rollback roots contribute to aggregate pressure; this does not prove the feature itself needs2.5GiB. The eventual policy remains2GiB, accounting active serving/default state, required compatible rollback, both writer reservations and all other retained derived roots. Obsolete-root ownership/retirement must be resolved before claiming that policy passes; silently excluding old roots is not evidence.

Tested pair: compiled client**241406ed1367fb0fb973200e8edc2f24252fc471**; gateway/worker**2841b50ae024ca684fca9803ed998dc06a70bbc4**. Parent/two extensions are the exact prior real prepared projections364cfa71…/4c1f3235…/ed997b67… (full identities in manifests/equality). Staging/history/diagnostics flags1; backend independent publication1 only on isolated protocol5root`/home/daz/iqterminal-wall-tail-r5-candidate-proof`,18890gateway/18792worker. Loopback4204preview uses separate18990history/18991current SSH forwards. These existing transport settings are not a new remedy. Headless Chromium on the actual Pi is used; foreground acceptance remains manual.

Measurements ended early after the demonstrated capacity blocker, within the fixed budget. Owned preview/tunnels/browser/pins and both candidate roles are stopped; no candidate lock, readers, consumers or pins remain. Gateway exits0/OOMfalse; worker exits1/OOMfalse because its documented coordinator exit contract reports retained failed jobs, not an OOM. All35protected entry service identities/start times and original unrelated limits remain unchanged. Incumbent staysf1fb0d6/protocol4/flag0,18880/18791. Main, production, collectors, raw retention, frozen refs and comparison branch are untouched. Useful protocol5state is retained; never open it with a protocol4binary.

Rollback: keep isolated route stopped and use the untouched incumbent; restore the frozen5a09compiled preview if a client comparison is needed. Retain the recovered ClickHouse allocation. Reacquire supported leases before resuming useful old prepared candidate views. No normal-route promotion took place.

## Decision and smallest next action

**MEASURED DELIVERY IMPROVEMENT; release BLOCKED.** Retained prepared extensions and latest saved-viewport reopen pass exact output and full-painted completion checks. Fresh-current availability/freshness and bounded live progress pass these observations, but initial history hits the existing canonical-part ceiling, preventing the required fresh advance/reopen.

Next: implement/test bounded canonical-page packing within the existing4MiB/128-part and aggregate limits, preserving source fencing, timestamp closure, resume and exact financial output, then rerun the same single fresh-current open→advance→explicit Save Workspace/reopen cohort. Do not merely raise the part limit or shorten the range. Separately resolve obsolete derived-root ownership to demonstrate normal2GiBcapacity. Remaining measured costs include cold initial preparation, whole-union validation/assembly and15.4sretained fresh reopen completion.

After automated blockers pass, the manual foreground check is on**i3workspace9**: manually switch there, open the isolated compiled preview, select USD-M BTCUSDT15m/Top8/10%/native with30h ending now, watch history stay visible during one advance, Save Workspace, reopen it, and verify fresh completion plus independent current/footprint updates. No unattended foreground browser was launched. Historical route failures retain their original scope; this bounded healthy workload does not establish their cause or repair.


Follow-up: [Configurable history capacity and complete fresh-current validation](configurable-history-capacity.md) supersedes the fixed128part/2GiBpolicy while preserving this phase’s build-scoped evidence and failures.

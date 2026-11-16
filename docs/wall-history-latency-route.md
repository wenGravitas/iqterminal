# Wall-history update/reopen latency and route attribution

**Measured wire/work reduction; the final fresh-current workflow passes. A broad causal end-to-end latency improvement is NOT established. Release recommendation: BLOCKED; keep both PRs in draft pending the concrete reliability/foreground decisions below.**

Task16November2026: start13:39:14UTC; new-live cutoff16:09:14; deadline16:39:14. Live experiments ended early14:47:50. Previous deadlines, failures and reports remain unchanged. [Manifest](../artifacts/wall-history-latency-route/manifest.json).

## Exact candidate and changes

Observed/fetched heads matched frontend0ff6b61439a12fdc572aeae1996f66bac1516fa8/backende2618286f4e5a0bc553338e06eefac9a5a7ecaa3. Work stays on integration/pi-history-startup-r1, PR1/2. The inherited tunnel-log edit and unrelated work are preserved.

Final tested application pair: **frontend9ee61b3644836b2d9e159f9fe90b4174c8ab5d3d / gateway+worker480d6dc8c181c5ff948f4af97854d2a670ba733f**. Documentation/tooling tips are later commits, not new app deployments. [Build/asset receipt](../artifacts/wall-history-latency-route/build-receipt.json).

- Ready discovery now uses existing browser-native Brotli quality5 or gzip6, with identity/full-JSON fallback. No new wire/storage protocol, cache, source shortcut or financial omission. Source validation still precedes encoding;8MiBdecoded response and existing admission bounds remain.
- A **completed** authenticated warm replay can be compared exactly against the freshly validated presentation and published as a delta. It never substitutes for source/whole-union validation. Changed identities, incomplete/failed replay, current-selection collisions or excessive changes retain the full replacement fallback.
- Fresh publication never waits for unfinished optional replay. An early variant did wait; measured replay9.77s exposed that regression and9ee removes it, with an exact-output regression. The ordinary final reopen uses17changed patches against10,427cached rows, replacing a10,428-row full snapshot.
- Renderer completion now has its own monotonic timestamp. Frame witnesses check available content, fresh archive validation, zero pending projection/preparation/paint and painted=input revision. First useful paint is separately frame-witnessed; screenshots and later inspection are excluded from completion.

A preparation→reader handoff experiment passed ownership/cancellation tests but was deferred from final code: observed queue waits were hundreds of milliseconds, while metadata/cache work was materially larger. Its commits/evidence remain. Existing leases, expiry/retry and reader ownership semantics are preserved.

## Comparable timings: same corrected completion harness

One fixed-input pair, not five-run certification. Frontend601ebad362cd478e617dc54e53fcc3480c4ecf72 (baseline+timing) versus final9ee; **both use backend480** and identical ready manifests, route, settings/resource allocation, empty browser contexts, then ordinary parent/two advances/save/reopen. Independent health processes are used in both. All three immutable manifest hashes match. Initial-open selected encoding-cache warmth is not certified; the reopen has zero selected-part transfer in both, so that cache cannot explain reopen timing. [Pinned baseline](../artifacts/wall-history-latency-route/comparison-base-pinned.json), [pinned final](../artifacts/wall-history-latency-route/comparison-final-pinned.json).

| Fixed prepared phase | Baseline full paint | Final full paint |
|---|---:|---:|
| parent | 18.741s | 18.180s |
| extension-1 | 8.940s | 6.565s |
| extension-2 | 6.861s | 5.506s |
| reopen | 12.984s | 12.069s |

Parent is navigation→renderer completion; other rows start at native control/workspace activation. These are **observations, not a causal frontend speedup claim**: this larger fixed reopen used safe full replacement in both because optional replay was unfinished. Transport/scheduling varied. Earlier exploratory runs overlapped local checks or used the rejected waiting variant; all remain scoped and are not pooled. [Local request stages](../artifacts/wall-history-latency-route/stage-comparison-final.json), [all validation summaries](../artifacts/wall-history-latency-route/validation-summary.json).

The codec comparison is separately matched: one identical1,362,407-byte ready response produces gzip1 **248,495B/7.03ms**, gzip6 **215,531B/15.97ms**, Brotli5 **156,604B/62.86ms**, with exact decompressed equality: **37.0% fewer bytes** versus gzip1. This is one same-buffer server-process sample, not statistical certification. Actual browser ready responses use Brotli; the pinned parent changes about345KB→230KB (same immutable manifest; dynamic source envelope can differ). Decoding/financial work is not eliminated. [Backend codec evidence](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/artifacts/wall-history-latency-route/codec-comparison.json).

## Final ordinary current-ending cohort

Actual compiled Pi/aarch64 headless Chromium, --use-angle=gles, fresh-context default light theme; hardware/software renderer and foreground FPS are not certified. VITE_DATA_MODE=staging, VITE_HISTORY_TILES=1, VITE_DIAGNOSTICS=1, VITE_WALL_SELECTED_MAX_BYTES=134217728. Route4204→separate18990history/18991current SSH→isolated18890gateway/18792worker. Existing SSH settings are retained, not presented as a remedy.

USD-MBTCUSDT15m, Top8/side,10%,native; normal controls/padding. It starts with a prepared same-start prefix plus genuine new tail. **It is not a cold-server rebuild** and is not compared as such against the earlier cold parent.

| Final ordinary phase | Fresh full available-history paint |
|---|---:|
| parent | 23.252s |
| extension-1 | 15.635s |
| extension-2 | 12.293s |
| reopen | 14.490s |

First useful current≤6.129s and history≤13.833s from navigation; reopen partial cached paint≤2.308s, then independent full validation14.490s. Useful values are frame witnesses/upper bounds; full values use the actual renderer timestamp, not observer polling, health, screenshots or evidence writes.

Same padded start1794729600000; eligible exclusive ends1794839130332→1794839151158→1794839168909, reopen1794839186155. Source records63,260→63,267→63,273→63,282: both advances are nonempty(+7,+6). Requested past ends are actual now; unconfirmed tails remain about1.17/4.01/2.92/3.35s. Source inclusive horizon is eligibleEnd−1; projector loadedThrough may denote the terminal duration boundary, which is not a new source observation. **22genuine gaps** and observed bid9%/ask8%scope remain explicit;10%is requested, not a claim of unobserved exchange depth.

Each final preparation reuses42input-prefix pages, processes1boundary/tail page, rebuilds0canonical prefix pages and publishes43selected parts. Input and selected counts are distinct. Client advances/reopen reuse42parts and fetch1; final reopen publishes17exact patches after completed cache replay. Save Workspace explicitly precedes reopening the latest visible viewport; saved bounds restore within millisecond/rounding tolerance. [Saved-view proof](../artifacts/wall-history-latency-route/saved-view-proof.json), [real chart](../artifacts/wall-history-latency-route/fresh-current-isolated-health/reopen.png).

## Critical path and correctness

Server continuation uses5coordinator turns,4.68–6.15s summed step elapsed; same-host persisted admission→ready estimates5.65–7.50s include fairness/waiting and are labelled wall-clock estimates. Seven proof callbacks cost2.88–4.44s nested,24queries/~978MBread per request. DBtime includes SQLqueue; these durations are not added as exclusive phases. [Preparation receipts](../artifacts/wall-history-latency-route/preparation-summary.json).

Ready discovery still carries1.36–1.95MBdecoded metadata, mostly authenticated active state. Immutable-part reuse avoids repeated payload delivery but still visits/assembles/validates the complete financial union. Final reopen validates10,428records and71,224runs. Compact warm encoding/replay is another material wait: a19,907-row encode took21.4s and a19,868-row replay9.77s in the measured earlier variant. Final code refuses to wait for unfinished optional replay; fallback still incurs a full presentation replacement and large main-thread task. No larger browser cache was added.

Exact real checks: all four final-cohort prepared outputs equal unchanged task-baseline0ff6b61 importer, including every financial row/rank/run/order, profile, coverage and horizon. Separately, all closed prepared rows in the earlier2cb/480live chart match exactly (10,351/10,374/10,380/10,390closed rows); source/value algorithms are unchanged in9ee, whose publication guard has exact-output regressions. Active current overlays are assessed independently. The financial producer is unchanged; earlier full canonical reference evidence retains its original window/build scope, with no repeated expensive rebuilds. [Final equality](../artifacts/wall-history-latency-route/final-real-equality.jsonl), [real-chart equality](../artifacts/wall-history-latency-route/real-equality.jsonl).

Final175focused frontend cases across8files, typecheck/production build pass; backend9new/existing compression cases, typecheck/full build pass. Existing financial/recovery/capacity evidence is reused where unchanged. Failed prototype assertions, an initial test-fixture brace error and readiness-helper programming/startup errors are preserved in the evidence index; none is relabelled as a live application pass.

## Route attribution and every observed failure

IQ_STARTUP_TRACE=1 is explicitly enabled on owned preview/gateway. Known IDs appear in both with arrival/terminal events before observations. Logs are persisted before replacement/stop; all relevant process generations remain below4096records with dropped=0. Gateway was restarted once to reset the bounded trace counter after its logs were saved; this is **not** a transport remedy. HTTPdurations use actual request responseStart/responseEnd, including labelled aborted terminals; delayed async log emission is not network completion. No unsynchronized host timestamp subtraction.

- The fixed180s route window has36requests per preview/direct-current-forward/server-local lane, one outstanding per lane, with one persistent SSHsampler: **108/108complete within12s**. Preview/direct requests latency-route-preview-5/forward-5 take5.530/5.526s, but matching gateway handlers take11.04/1.89ms. Four seconds is lateness, not failure. This supports a delay in the forwarding/host scheduling segment, not gateway handler work; direction and underlying cause remain unresolved.
- History diagnostic95054cc4-2b30-424d-8ece-2bb7ff261f14hits its own12scutoff. Gateway finishes200in405ms; preview headers arrive10.779s, body is canceled. **The application history deadline is30s, unchanged; whether that abandoned request would meet30s is unknown.** The helper was corrected to use the existing history deadline, not deployed as a timeout remedy. [Correlated failure](../artifacts/wall-history-latency-route/pinned-timeout-proxy.json) and backend pinned-timeout trace.
- The first full fresh cohort uses a health sampler coupled to large financial-evidence writes and records**four** TypeErrorfetchfailures (10.19/16.16/13.43/11.12s). All four IDs are absent from intact proxy/gateway traces: a client/observer→preview boundary, not demonstrated backend failure. Causes were not captured then; evidence-write coupling is a supported measurement concern, not proof of every failure's cause. The targeted rerun moves health into a separate bounded process and removes financial dumps from the timed workflow. The first cohort and all failures remain.
- Final independent cohort: **16/16health**, max1.020s, observer-loop max267ms; **120advancing exact confirmed execution ACKs**, longest observed gap1.518s, no execution reset/error. Current walls advance. This is finite non-recurrence, not proof that the historical transport incident is fixed.
- A separate level-watch1008Invalidcommand recurs early: OPEN→subscribe(after4973)→level-watch state→ACK4973→1008. Current walls subsequently recover; execution stream remains healthy. Socket generation/command sequence is retained. Native-candle1005during workspace switch is expected. [Watch sequence](../artifacts/wall-history-latency-route/level-watch-1008.json).

After the diagnostic failure PiMemAvailable is~716MiB, swap allocated~2.34GiB; both SSHprocesses have swapped pages, cumulative major faults/scheduling wait, RTT~520/638ms and cumulative retransmissions18/8. These are **post-failure snapshots, not causal deltas**. Proxy/gateway measured loop maxima are83/44ms on the captured history failure. Tailscale reports a current direct peer address and preferred relayhel; that does not prove the path at the earlier stall. No user browser/process, swap or network setting is changed.

## Separate decisions and next action

- **Capacity: PASS**, existing1024parts/2MiBmetadata/128MiBselected/8GiBderived/40GiBfloor and RAMreserves unchanged. Final candidate~61.6MB/all retained wall roots~1.79GB; required rollback and reservations remain accounted.
- **Correctness/workflow: PASS at the stated scope**, exact comparisons, truthful gaps/tail, two nonempty continuations, saved bounds and independent current progression.
- **Performance: measured byte/work reduction; broad latency improvement NOT established.** The3sfirst-history/5smedian/10smaximum prepared-view targets and1swarm target are not certified or relaxed; observed values remain above the intended experience. No five-run median/max or p95claim is made.
- **Release: BLOCKED; reviewable commits, keep draft.** The intermittent private-route delay has no demonstrated remedy; separate watch1008and foreground acceptance remain. This goal is complete as a bounded implementation/evidence handoff, not a claim that old performance/reliability goals are fully satisfied.

Small prioritized follow-up: (1) inspect initial-state ACKhandling in src/feed/level-watch.ts and backend watch-server using the captured4973sequence; isolate/test before any protected-service rollout; (2) investigate the already isolated forwarding/client-host boundary with failure-time per-tunnel counters, not another gateway rewrite/deadline increase; (3) measure existing compact warm-codec stream/setup/publish overhead within its1MiBdecoded limit and current memory/CPU bounds. Do not start these in this goal.

Manual foreground check remains on **i3workspace9**, in a new bounded session using the same compatible build/allocation: open normal current-ending30hsettings, make two genuine native advances, Save Workspace→blank workspace→reopen latest saved view; check retained pending walls, fresh complete status, explicit gaps/tail, current/footprint progression and interaction stalls. No unattended foreground browser is launched.

## Cleanup/rollback

All owned browsers, health/sampler processes, preview4204, tunnel18990/18991 and candidate roles are stopped. Consumers/readers/pins0, no root lock; useful completed protocol6state remains. All35protected entry identities/start times and recorded RAM/CPU limits match. Incumbentf1fb0d6/root4/flag0, main, production, raw collectors/history, frozen refs/control branch remain unchanged. Recovered CHsettings remain; final Spot/USD-M10%horizon lag1.20/5.09s, old3%profile remains stale. USD-M/Spot execution overflow counters remain2/0 and depth0/0; unrelated Hyperliquidnet-positioning counter51→52is recorded without attribution or intervention.

Use untouched incumbent18880/18791for rollback. Candidate18890/18792remains isolated/stopped. e261is a compatible protocol6code rollback at the same capacity settings; never open this root with f1/protocol4or rewrite its marker. No candidate promotion/merge/production deployment occurred. [Backend operations and receipts](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/docs/WALL-HISTORY-LATENCY-ROUTE.md).

Target disposition: the ready fixed-view sample exceeds the10smaximum bound, and observed useful paint exceeds the3sfirst-history/1swarm targets: **observed misses remain FAIL**. A five-run median/max certification is **NOT RUN**; rolling-tail timing is not substituted for ready-server timing. The new goal does not relax those thresholds.

The former2/2.5GiBallowances are not release gates; capacity passes at the already justified8GiBconfiguration. Browser cache policy remains separate.

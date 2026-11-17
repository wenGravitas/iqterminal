# Resident history implementation checkpoint

This continues the active persistent-wall navigation goal. It is not a completion or foreground-performance claim.

## Application changes

-231d67b adds `wall-resident-history.ts`, integrates it into the worker-owned archive service, and adds display ownership bounds to frontend wall records.
-5cf5392 clips initial carry-in rendering to the requested interval and avoids resource updates when only status metadata changes without changing a wall's horizon.
-9d83348 distinguishes a positively changed source proof from an unavailable recheck. Only confirmed changes invalidate the affected resident owner; ordinary errors retain good display.

Backend main remains07318748bd2a17fe1f3a6ac917009fd9122f4865 as inspected at task entry. No backend change or remote deployment was needed for this checkpoint. Ordinary main/client, tunnels, collectors, protected watch and prepared state were not changed by this work.

## Ownership and financial semantics

General navigation activates resident ownership from a fully completed, exact historical result. Each subsequent missing interval retains its independently validated request, source revision/token, exact records and source gaps. It is not a concatenated financial projector. Request-relative episode IDs are not assumed globally interchangeable. The first owner's IDs stay stable; later owners receive a presentation namespace and retain the original source ID.

`residentRange` is frontend display metadata. The original prices, exact decimal strings, rank/value runs, start/end knowledge, duration, mean and peak remain unchanged. Renderer and hover clip to the owner's interval. Tooltips explicitly scope the episode statistics to that source interval. In particular, the implementation does NOT claim a new global episode mean/duration assembled from independent requests. Same-start continuation retains the established exact producer/delta path before resident navigation is activated; its existing quiet-tail and shared-ready regressions continue to pass.

This is a compatibility choice, not a claim that every forward extension now uses only a missing-tail request. Once resident navigation is active, missing intervals are admitted separately. Source corrections positively identified by the source validator remove the affected entire owner before replacement; inability to revalidate alone does not certify a correction or erase good data. Old frozen proofs do not become newly validated merely because the camera revisits them.

## Scheduling, coverage and bounds

The viewport, immutable request and resident intervals are separate. Covered camera moves do not request history or replay the resident presentation. A120ms trailing gesture timer coalesces boundary movements. One history job remains in flight; useful work is not cancelled at every frame. Missing ranges are selected nearest the useful viewport first, with10% time padding capped at one hour per side. Padding shares the same admission allowance; it is not a larger memory reservation.

Admission evicts complete offscreen owners in least-recent-use order, never an owner intersecting the current viewport. Failure is atomic: a capacity failure does not evict visible data or claim missing coverage complete. Eight owners share the existing one-projection limits of100000segments and1000000value runs. Conservative representation accounting is512bytes/header plus256bytes/run, capped by those same existing limits; this is not measured JS heap. GPU and warm-cache allowances remain separate and unchanged. A single large owner can prevent further admission while visible; that limitation is reported rather than silently trimming its financial detail.

Status reports resident and unloaded intervals separately, with exact interval bounds in the status tooltip. Known source gaps remain on their owners. Loading a missing interval keeps prior walls and the current poller/generation. Errors and Retry keep unrelated owners. Initial progressive loading retains its existing path; retargeting no longer explicitly clears a good partial presentation. Further testing of gestures during an unfinished initial load remains required.

## Verification and failures

-108 focused service/store/chart checks passed after initial integration, including missing left/right requests, revisit without requests, gesture coalescing, disposal, capacity/eviction, clipping and existing same-start continuation behavior.
-Additional full-range reference comparison checks exact selected price/quantity/notional/rank at442 sampled integer timestamps across carry-in, quantity and rank changes. Every fragment's unmodified financial fields also equal its independent interval reference. This is deterministic evidence, not a retained real-source comparison or exhaustive gap/epoch seam proof.
-71 service/store checks passed after confirmed-source-change recovery was added.
-99 prepared-history/projection checks and typecheck passed after that validator change.

The first compiled adapter test at231d67b failed because adopting a carry-in owner rebuilt its geometry. Investigation showed that the initial renderer had allowed the carry-in point before the requested left edge. The correction at5cf5392 applies that left boundary at initial render and avoids status-only horizon rebuilds. The failing capture is preserved as `compiled-resident-231d67b-failed-boundary.json`.

The targeted compiled5cf5392 adapter/chart check then passed. It uses a real `OrderWallsArchiveService` and ordinary compiled panel with controlled canonical source responses, not a substitute service implementation. The first request covered30.5hours including normal panel padding. It loaded16 exact carry-in walls. Panning left requested only the missing4hour interval including overscan. While that response was deliberately held:

-16 loaded historical spans remained visible.
-Geometry remained at one build/two uploads/704GPU bytes.
-No empty reset snapshot or current-request abort occurred.

After release, the new owner was added. Revisit issued no further request: two total source requests, two owners,32records/runs,24576accounted representation bytes. The affected small renderer batch was replaced once (two total builds); this is bounded data-arrival work, not a camera rebuild. Raw evidence: `compiled-resident-5cf5392.json`.

The current request in that fixture was deliberately left pending. It proves subscription preservation, NOT live current/ACK progress. The fixture uses the canonical fallback transport; prepared projection delivery and actual worker-message transfer still require integration coverage. The earlier30h944-segment Spot/USD-M renderer interaction tests retain their original independent scope.

## Next required evidence and work

-Exercise prepared projection delivery through resident ownership, actual worker lifecycle, and independent advancing current data.
-Extend exact reference cases to source gaps, epoch changes, timestamp regressions/late corrections, stale asynchronous results and cancellation.
-Verify repeated extensions/eviction, mixed/Threshold fallback, restoration/show-hide, candles/footprints, and measured heap plateau.
-Complete source-safe coverage handling for all forward/initial-loading navigation paths; the preserved same-start path is not advertised as missing-only.
-Run matched final navigation evidence and the manual foreground Pi acceptance procedure, keeping software/headless and hardware results separate.

No merge or production rollout is part of this goal. The dedicated compiled preview uses4189 and is stopped after checks. Ordinary5173 and18780/18781 remain outside task ownership. Rollback remains using unchanged main/ordinary services; no durable data migration was made.

## Live-layer and invalidation follow-up

Application commits `c3de66a` and `51d65ba` separate current/history GPU allocation and remove positively disproved history without resetting current delivery. Current chunks receive preparation priority within the existing four-chunk/time budget. Historical chunks no longer share an allocation with current tails, so ordinary current changes cannot force an unchanged historical upload. A source moving between layers replaces its old affected chunk and creates the new current chunk; subsequent current updates touch only current resources.

The first targeted headless capture (`compiled-live-layer-fa7ff61-working-tree.json`) used the working tree that became `c3de66a`, with build metadata still identifying parent `fa7ff61`. It predates the source-invalidation change and is not evidence for that change. Both checks passed:

- Four eight-chart open/dispose cycles: one shared context, 211200 buffer bytes with eight owners, 184800 after removing one, and zero owners/contexts/buffers after disposal.
- Initial history queued behind a current point: first prepared chunk was current; 20 historical chunks remained pending. This proves priority, not a hard frame-time guarantee. The software-rendered first allocation took 35.9 ms and its draw took 46.4 ms.
- Compiled ordinary panel plus real archive service with controlled source: current cursor advanced 100 → 101 → 102 while the missing interval was held. Historical build count stayed at one; one initial current bootstrap; 16 visible historical spans; no empty snapshot. Only the missing interval was acquired. Revisit made no additional history request.

A separate prepared-projection service regression now exercises authenticated discovery, part import, delayed final source validation, exact financial rows, explicit gaps, independent current cursor progression and scheduler cleanup. This is controlled-source service evidence, not actual worker-message transfer or live execution ACK proof.

Confirmed source changes now discard affected history in both resident and nonresident paths, invalidate the matching warm entry/build, and prevent late subscribers from receiving the disproved job result. A different independently fenced prefix is not discarded merely because an extended target's proof changes. An HTTP 503 during proof revalidation retains the prior valid rows. Tests compare all restored financial fields after Retry; presentation-only `currentSelection` defaults and Map insertion order are not financial differences.

The older tests required retaining even positively disproved data. Those assertions failed after this correctness fix and were replaced with removal/Retry assertions; missing-proof availability failures have a separate retention regression. Final focused service/prepared/store run: 172 passed across four files. Renderer checks: 76 passed plus the explicit expected-failing legacy blanking reproduction. Typecheck passed. Full compiled browser results for `51d65ba` are recorded separately.

Remaining scope is unchanged: actual worker/route integration and execution ACK evidence, additional seam/epoch/cancellation cases, initial-loading and same-start navigation lifecycle, measured total heap, compatible fallback coverage, and final matched/foreground acceptance. These checks do not certify the Pi frame-interval target.

Full compiled run at `51d65ba`: four passed, one failed. Both Spot and USD-M 30h navigation tests, the eight-owner lifecycle test, and the advancing-current adapter test passed. The component adoption assertion failed because its initial status had no archive left fence, despite claiming it was already fenced. Commit `ecf7a8e` gives that controlled initial presentation the same validated left boundary as the later resident owner. The production path already carries this boundary. The original failure is retained in `compiled-51d65ba-failed-unfenced-fixture.json`; the targeted corrected result is recorded separately. No timing target was changed.

The corrected component check at `ecf7a8e` passed: `compiled-component-ecf7a8e.json`. This is a targeted fixture correction rerun; the other four checks retain their `51d65ba` scope. Builds and typecheck passed; the existing Vite extension/chunk-size warnings remain.

## Historical forward navigation and worker routing

Application `5465edb` closes the historical same-start forward-navigation bypass. Once a non-live-follow view is validated, small forward advances now enter resident ownership rather than issuing the original start again. A regression failed on the old implementation because the second request started at the original start, then passed with two successive missing-only acquisitions. Overscan revisit makes no request and the second acquisition sends no patch for the original owner. Initial adoption detaches the mutable canonical projector; equality, not JavaScript array identity across that adoption, is the guarantee. Live-follow rolling revisions retain the independently validated full-revision/delta path for now; this remaining distinction is explicit, not a claim of complete rolling-navigation reuse.

120 archive/prepared-projection tests passed, including the existing live-follow exact-delta regression. Typecheck and compiled build passed. The ordinary compiled-panel controlled-source check passed at `5465edb` (`compiled-forward-5465edb.json`): after backward acquisition/revisit, forward acquisition started exactly at the old resident end, and the next advance stayed in overscan without a fourth request. Current wall cursors continued independently.

The added explicit `wall-protocol-worker.js` diagnostic entry installs controlled HTTP responses, then imports the real compiled `src/feed/worker.ts`. It neither changes production routing nor supplies a fallback to application network failures. `compiled-worker-5465edb-working-fixture.json` records a passing check with application `5465edb` and the then-uncommitted diagnostic entry. This build explicitly uses `VITE_DATA_MODE=staging`, `VITE_HISTORY_TILES=0`, and `VITE_DIAGNOSTICS=1`. The test sends production subscribe, viewport, unsubscribe and diagnostics messages across the actual browser worker boundary. One initial history request and one missing interval; current requests after 0 and 100; stable generation; no empty reset snapshot; no revisit request. Unsubscribe leaves zero subscriptions/current groups/history jobs/consumers/resident owners. Two bounded warm entries (1536 accounted bytes) remain by existing cache policy until expiry or worker termination; the test terminates its worker. No live exchange execution ACK or prepared-projection worker claim is made.

To reproduce the worker check on the dedicated preview:

```sh
VITE_DATA_MODE=staging VITE_HISTORY_TILES=0 VITE_DIAGNOSTICS=1 VITE_BUILD_COMMIT=$(git rev-parse HEAD) pnpm exec vite build --config vite.wall-navigation.config.ts
VITE_DATA_MODE=staging pnpm exec playwright test --config playwright.wall-navigation.config.ts --grep 'production worker'
```

Archive the JSON reporter output before another run. The fixture test is explicitly skipped without the staging test environment; skipped is not passed. The preview is owned by Playwright on4189 and stopped afterward. This is headless controlled-source evidence, not foreground performance certification.

## Capacity recovery and repeated worker navigation

Application `76cabe8` fixes local admission recovery: a completed, validated ninth owner can be held outside the eight-owner resident store when all old owners are visible. Previously narrowing the viewport caused another source read. Navigation now retries admission of that completed result first, allowing only complete offscreen owners to be evicted. Explicit Retry while still capacity-blocked likewise retries admission without resending the source request. Once admitted, ordinary explicit Retry still performs fresh validation. No resource limit was raised and no visible owner is discarded on failed admission.

The regression reproduced the extra read before the change and passed afterward. 128 archive/store/prepared tests, typecheck and build passed. It retains eight visible owners on failure, narrows to the already fetched ninth interval, admits it without another read, and checks normal fresh Retry separately.

At compiled application `57cbde9` (same application behavior, nonempty fixture improvement), the real worker test traversed sixteen disjoint nonempty controlled ranges. Owner/record/accounted-byte counts reached 8/8/6144 then remained exactly constant; one history job and consumer, and1536 warm-cache bytes throughout. Unsubscribe released all resident owners, jobs and current groups. Eight controlled current pages and seven current patches were processed. This proves bounded accounting and worker cleanup on a small controlled source, not a measured total-heap plateau or live execution ACK acceptance.

Two failed fixture runs are retained. The first timed out during cycle zero; the bounded capture then showed an empty observation array. The test had replaced the array while its message callback still appended to the original array. Clearing the array in place corrected the observer. No production code or deadline was changed for that failure. `compiled-worker-cycles-57cbde9.json` is the passing result with that test-only correction; the timeout and capture JSON files preserve the failures.

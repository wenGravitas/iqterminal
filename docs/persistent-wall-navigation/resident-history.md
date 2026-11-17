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

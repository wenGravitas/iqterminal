# Persistent Order Walls navigation candidate

Implemented on `feat/persistent-wall-navigation`, based on frontend main `bcd7619fb9260b50c6134d7d21306d5c90fcd860`. Backend main inspected at `07318748bd2a17fe1f3a6ac917009fd9122f4865`; no backend source change was needed. Tested frontend application: `b76828cc5f7624a22906ac50cae4c3f8ed7432a4`. Real-route backend application: `300fa5d00f607d7e3a990b128523ea265af363f5`, isolated protocol6 gateway/worker. Documentation/tooling tips are separate from application identities.

**Implementation and automated interaction verification are ready for review. Foreground Pi acceptance remains pending.** No claim is made that p95≤33ms was achieved, that initial history loading is fast, or that the historical forwarding incident was fixed. Nothing was merged or deployed to production.

## Architecture

- `wall-retained-renderer.ts`, `wall-gpu-resources.ts`, `wall-logical-mapping.ts`: immutable512-slot logical/time-price batches in one shared WebGL2 context, composited at the existing Canvas layer position. Camera changes update uniforms; they do not discard historical buffers. Actual candle-slot knots, irregular time gaps, relative high/low coordinates, nonlinear price transforms, DPR, clipping and screen-pixel thickness are preserved. Hover uses exact source records and the painted camera. No display LOD or financial aggregation was introduced.
- Historical/current resources are separate; current changes touch current chunks. Corrections/removals invalidate affected instances, and replacements publish at chunk scope. Actual mapping revisions rebuild affected resources; ordinary camera movement does not. Style/reference-scale changes reuse geometry. Visible contrast scanning still costs O(retained spans) CPU per draw; this is a remaining performance cost, not hidden reprojection.
- `wall-resident-history.ts` and `order-walls-archive-service.ts`: independently fenced, disjoint interval owners retain exact source rows. A missing interval gets its own validated boundary state; existing cache keys/proofs are not weakened. Loaded overlap/current subscriptions remain in place.120ms gesture coalescing, up to1h overscan per edge, one active missing job and complete offscreen LRU eviction bound acquisition. Confirmed-empty intervals count as covered; explicit source gaps remain gaps; unknown/unloaded intervals remain pending.
- Same-start live revisions retain the existing source/terminal validation and exact-delta path. Completed forward pans with a moving left edge now use missing-only acquisition. Initial partial-history retargets preserve good content and coalesce gestures. Failed capacity admission can be retried locally after narrowing without refetching the validated owner. Positive source invalidation removes the affected owner; an unavailable proof does not falsely invalidate good data.
- Mixed/Threshold mode uses the compatible Canvas fallback. A reproduced Canvas→GPU→correction→mixed transition bug was fixed so fallback cannot reuse stale positions. If GPU allocation/mapping is unsupported, synchronous Canvas retains truthful visible content, but its reprojection/performance is not claimed equivalent to the GPU path.

## Bounds and precision

Eight owners share one subscription's existing100000segment/1000000run allowance, not a fresh allowance per interval. Representation accounting is512bytes/header plus256bytes/run; it is an estimate, not process RSS. Complete visible owners are never evicted on a failed admission. GPU buffers share a64MiB global cap and16M-pixel surface ceiling, with44bytes/instance. Mapping tables cap at8192knots and fall back explicitly. Existing warm/immutable caches and their caps remain unchanged. No history cap was raised.

Range-relative episode statistics remain attached to their original independently validated source interval. Render IDs are namespaced for ownership; original source IDs/entry identity and exact decimal fields remain available for inspection. Intervals are half-open; rendering honors inclusive loaded horizons without connecting across an unloaded interval. Source corrections cannot be kept merely to avoid a blank. All GPU owners, timers, current/history consumers and observers have disposal paths.

## Requirement/evidence audit

| Requirement | Evidence and scope |
| --- | --- |
| Resident pan/zoom without blanking/reprojection/reload | Real Spot/USD-M30h route captures plus compiled camera/drag/resize/revisit tests. History requests blocked after validation; no attempted read, sampled blank or historical rebuild; exact data hashes unchanged. Final three matched pairs: legacy89/90 blank draws each, candidate0/90 each. |
| Correct anchors/hover/precision/styles |32compiled camera cases,640sampled line cores, DPR1/2, nonlinear scales, irregular knots, native.01prices, correction/removal/hover. Mapping tests cover prepend, insertion/revision and bounded fallback. Canvas/GPU AA differences are documented, not claimed pixel-identical. |
| Missing coverage, overlap, errors, retry and cancellation | Archive service tests and actual compiled worker with controlled canonical responses: delayed missing interval retains walls, generation/current chain stays alive; initial gestures coalesce; two forward extensions/revisit reuse; positive revision invalidation versus503; capacity narrowing; stale async/disposal. Authenticated prepared-projection integration retains final source-validation barriers. |
| Financial values and coverage | Existing full-reference producer tests remain unchanged; new resident test compares442timestamps including both seams, exact decimal quantities/notionals/ranks and each original fragment record. Prepared tests cover late-input/anchor, epoch fence and timestamp-ahead revisions. Real navigation hashes prove immutability, not a replacement independent financial reference. |
| Live updates during history/navigation | Real b76828c footprint stream:69additional batches/2966executions/69confirmed ACKs over38.36s, OPEN, no resets/disconnects/errors/source jumps. Real current-wall pages advance; first-current marker paint was not observed and is not claimed. |
| Bounded resources and multiple charts |16controlled disjoint worker intervals plateau at8owners; unsubscribe leaves zero jobs/groups/owners. Four eight-chart renderer cycles use one context, dispose to zero and stabilize forced-GC main heap within62KiB after warmup. Single real worker heap samples are recorded. Representative large multi-chart foreground RSS remains a manual observation. |
| Candles/footprints, restoration, show/hide, mixed fallback | Existing native control lifecycle check, final dark/light compiled Top Levels tests, footprint overlay switch and saved controls; dedicated reproduced/fixed mixed transition test. Their synthetic scope is explicit. |
| Initial history/progress | Real available-history paint41.86s USD-M on b76828c; earlier50.24s USD-M/60.21s Spot on fdf0654. Different windows, not a speedup comparison. Genuine gaps/tail remain explicit. Current preparation is prioritized; initial partial data is retained. |
| Actual foreground Pi performance | **Pending**, user-operated workspace9 only. Final component draw p9538.9/34.1/57.7ms is not frame-interval certification. Exact procedure and launcher below. |

Focused checks:131archive/prepared/store tests after the final navigation change; renderer/mapping/resource tests and32-case compiled correctness checks; typecheck and dedicated build; two final candle/footprint theme checks;11launcher lifecycle tests and8execution-proof tests. Earlier failures, rejected Canvas experiments and their scopes remain in the evidence history. See `rendering-experiments.md`, `resident-history.md` and `artifacts/persistent-wall-navigation/` rather than pooling different builds/windows.

## Measurements and remaining limits

The final matched component cohort uses2500segments/20000runs and90camera changes. Candidate draw p95/worst:38.9/85.2ms,34.1/78.0ms,57.7/129.6ms. All44historical builds and88uploads remain unchanged while moving the camera. The legacy route mostly paints nothing; lower baseline draw time is not useful rendering performance. Initial preparation varies substantially. All raw samples are retained.

The live captures report headless ANGLE/Broadcom V3D despite requested SwiftShader flags. Earlier software-rendering labels were incorrect; the erratum in `resident-history.md` takes precedence. The matched component runs did not capture their actual renderer and remain unverified on that dimension. None are foreground FPS evidence.

Initial loading and O(spans) visible-contrast scans remain measurable costs. Large foreground multi-chart memory, frame intervals, input response and subjective usability require the manual check. This work does not certify Threshold fallback performance, improve every initial cold load or resolve the old transport incident.

## Review, manual acceptance and rollback

Follow [foreground-acceptance.md](foreground-acceptance.md). The alternate receipt selects an immutable copy of b76828c, verifies assets/bundles and reuses the session-owned launcher. It does not overwrite the old58b3ae3 receipt or launch an unattended browser. Foreground/manual acceptance has not been performed by the agent.

All measurement browsers, previews, forwards and isolated gateway/workers were stopped. Session cleanup confirmed role removal and no root lock; useful prepared state remains. Ordinary5173/18780/18781, the incumbent protocol4 services, protected watch, collectors, main and production were preserved. Rollback is stopping the owned launcher and returning to the ordinary unchanged application; no durable migration is required.

The next action is one foreground acceptance session of this explicit build, not another open-ended history optimization or transport cohort. If frame response is poor, retain its trace and first attribute contrast scanning, compositing, GPU/driver or main-thread work before choosing another change.

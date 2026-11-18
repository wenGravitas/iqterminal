# Persistent wall navigation baseline

Goal remains implementation-in-progress. Frontend main bcd7619fb9260b50c6134d7d21306d5c90fcd860 and backend main 07318748bd2a17fe1f3a6ac917009fd9122f4865 verified by fetch. Dedicated frontend branch feat/persistent-wall-navigation; original main/client/tunnel sessions unchanged.

Reproduction: order-walls-work-budget.test.ts now records an expected-failure intermediate-frame contract. After a completely prepared resident presentation, small successive pans must draw at least one stroke on every frame. The existing code clears paintPaths and drawables on a camera key change and defers rebuilding; this is a source-level deterministic failure, not a Pi performance measurement. Remove test.fails when the contract passes.

Source review confirms general out-of-request navigation calls subscribe in the archive service, resetting its presentation and current subscription lifecycle. Covered navigation normally retains the request. Oversized failed-view narrowing already has a scoped recovery fix and must remain intact.

Implementation order: resident renderer/camera separation with exact candle-slot mapping; independently owned history intervals and staged overlap-preserving replacement; bounded overscan/hysteresis and settings separation; compiled-browser during-gesture tests and matched fixed-data navigation evidence. Immutable episode boundary/source proofs must govern interval reuse. No naive removal of from/to from cache identity.

Evaluate retained logical-coordinate Canvas geometry first: the existing chart already provides Canvas layering and exact price/time conversion, so another WebGL context is not justified without measurements. Camera movement must not clear retained resources; newly exposed resident runs must appear without source reload. Mapping revisions and nonlinear price modes need explicit invalidation/fallback. The choice remains provisional until measured in the actual chart.

Acceptance still outstanding: full implementation, ordinary browser continuity/boundary/live tests, exact mapping/hover/style checks, bounded multi-chart resource observations and foreground Pi timings. Existing foreground policy requires user-operated i3 workspace 9; headless results cannot certify foreground p95. No completion/performance claim is made by this baseline.

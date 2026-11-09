# Order Walls rendering work budget

The Pi profile and alternating publication experiment showed that fewer updates
can make individual chart stalls worse. This candidate yields the renderer's
projection, reference traversal, ordering and native path preparation through the
existing dirty-chart RAF scheduler. Validation is ongoing; release acceptance is
incomplete.

Attached Top Levels primitives with a proven visible time mapping and native
Path2D support use a 6ms preparation budget, checking every 32 bounded units.
A single 100,000-value segment yields per value rather than per segment. Native
canvas operations, allocation and GC can exceed this soft budget; real draw/frame
measurements remain required. The incumbent Threshold/mixed-path and unproven
mapping fallbacks retain their existing exact rendering behavior.

The last completed native paths remain paintable while preparation is pending.
A transform change cancels the captured render context and clears obsolete pixel
paths; financial source rows remain retained. New inputs stay queued, and a pass
cannot acknowledge a revision newer than the one it started with. Completion
requires no pending projection/reference/paint work and an actual draw of the
latest revision. Half-prepared geometry does not supply inspection hits.

Removal, full replacement, append, retention, pan, DPR/style changes and detach
must not revive stale rows or retain obsolete work. One iterator owns the current
pass; its queues and scratch arrays are bounded by retained input. No timer,
worker, GL context, source connection or raised financial-data cap is added.
Tail key lookup uses run-index order to avoid scanning/copying an unchanged
100,000-value prefix just to replace its last projected point.

Diagnostics expose pending paint work, phase, slices, units, cancellation and
active preparation-call time. Phase elapsed times include RAF waits; active time
is already inside cumulative draw time. Do not add overlapping measurements.
This change does not by itself prove fast current-wall confirmation during a
continuous stream, whole-app memory plateau or foreground Pi responsiveness.

`IQ_WALL_BUDGET_PAINT=1 IQ_PAINT_LABEL=<new-label> node --expose-gc
scripts/wall-budget-paint-bench.mjs` runs an explicitly selected headless offline
comparison with the incumbent renderer. Captured source walls are exact;
synthetic tail/correction exercises and the UTC OHLC axis fixture are labelled.
It checks completed geometry and every readback pixel over five alternating runs
per market/stage. Compiler activity ends before measurement. It is separate from
real-chart loading and current/concurrent acceptance.

Rollback is a client-only revert of this candidate. Prepared files, source
revisions, acknowledged cursors, subscriptions and backend processes are unchanged.

# Order Walls rendering work budget

The Pi profile and alternating publication experiment showed that fewer updates
can make individual chart stalls worse. This candidate yields the renderer's
projection, reference traversal, ordering and native path preparation through bounded preparation tasks; drawing still uses the existing dirty-chart
RAF scheduler. Validation is ongoing; release acceptance is
incomplete.

Attached Top Levels primitives with a proven visible time mapping and native
Path2D support use a 6ms preparation budget, checking between blocks of at most 32 retained values/ordering entries.
A single 100,000-value segment yields inside its value sequence rather than
waiting for the whole segment. Native
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
pass; its queues and scratch arrays are bounded by retained input. Each primitive owns at most one cancellable preparation timer, paused while its
chart/document is hidden and cancelled on detach or obsolete transforms. No
worker, GL context, source connection or raised financial-data cap is added.
Tail key lookup uses run-index order to avoid scanning/copying an unchanged
100,000-value prefix just to replace its last projected point.

Diagnostics expose pending paint work, phase, slices, units, cancellation and
active preparation-call time. Phase elapsed times include task/RAF waits. Active
preparation includes work both inside draw calls and in separate background
tasks. Background elapsed time includes its transform check; do not add active
preparation to draw time. Draw plus background component-call durations are
nonoverlapping, but neither may be added to whole-path latency.
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

The first RAF-only candidate f1a9c21 passed all 85 Spot financial/pixel cases,
but its initial preparation median was 3215ms versus 271.1ms for the incumbent
in that offline comparison. Individual calls were shorter, but RAF waits and
repeated canvas work made completion too slow. Its obsolete USD-M remainder was
intentionally stopped; it has no full comparison or USD-M pass. That raw trial,
resource/stop receipt and partial scope remain retained.

The task scheduler revision instead performs preparation in short cancellable
macrotasks, checks the captured transform before every background slice, and
requests the existing drawing scheduler when prepared content is ready. It
pauses when the chart/document is hidden. Background completion remains pending
until an actual draw; it cannot acknowledge the newest revision early.49 focused
chart/incremental/lifecycle checks and typecheck pass before real-data validation.

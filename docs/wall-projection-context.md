# Shared wall projection context

The old projection loop recomputed the same price Y coordinate, price width,
visible time bounds and bound time-conversion function for every value point.
It also performed timestamp conversion before rejecting price-offscreen walls.
The focused counterfactual records160price transforms for20eight-point walls.

Projection now captures those shared values once per segment. The same existing
pixel-Y cull runs before traversing an offscreen segment's values; the source
segment and all its points remain retained. Each visible point still uses the
incumbent exact timestamp-to-logical mapping and clipping. No linear time-axis
approximation, row reduction, price/time coverage change or data budget change
is introduced. Tail replacements still remove old geometry before culling.

The context belongs only to the current segment generator. Transform, DPR and
settings changes retain the existing cancellation/rebuild checks; replacement
generations and live-tail updates keep their existing invalidation rules. No
cross-view cache, worker, timer or permanent data reference is added. Price is
transformed20times in the repaired regression, and only the ten visible walls
perform timestamp conversion. The retained20walls remain unchanged.

Validation:232focused wall/history tests pass, one is skipped; typecheck passes.
The old-source call-count counterfactual fails. Existing geometry, styles,
same-time updates, gaps, native axis mapping, removals, pan/DPR cancellation,
reference extrema, tail append and disposal regressions are retained. Actual
captured-source pixel/geometry comparison and production-route performance
must be recorded separately before claiming an end-to-end loading improvement.

`wall-projection-math-benchmark.mjs` accepts an explicit hexadecimal
`IQ_PROJECTION_BASELINE` commit so this change can be compared with its immediate
predecessor. Its original default remains available for older reproductions.
The harness is an opt-in offline captured-data Canvas check, not source/current
connectivity, chart loading, foreground Pi UX or FPS acceptance.

Rollback is this chart projection change alone. The backend, prepared wire/core
identity, financial sources, historical revisions and live cursors are unchanged.

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

## Captured-source comparison

Candidate0dedd5d and predecessore91f1fc were compared in five alternating
pairs per market across initial draw, pan and restore. All30stage pairs match
exact geometry and RGBA pixels over8,293Spot/49,154points and23,850USD-M/
104,112points. The raw source fingerprints match the frozen canonical inputs.
This is an unattached synchronous primitive over a controlled1000-slot time
grid, not the product preparation scheduler or native candle OHLC. Its raster
context uses tick0.1for both markets and willReadFrequently readback hints; it
does not by itself certify Spot native0.01row bounds. The unit regression
separately covers0.01and0.1native widths; the route verifies profile identity.
Times below are draw-call elapsed observations, not exclusive CPU, GPU completion
or FPS. Readback/hashing is outside the timed draw.

|Market/stage/variant|All five draw-call samples, ms|Median|Maximum|
|---|---|---|---|
|spot/initial/Baseline|778.0,952.1,584.6,829.9,841.1|829.9|952.1|
|spot/initial/Candidate|581.1,508.4,435.1,704.5,793.8|581.1|793.8|
|spot/pan/Baseline|826.1,808.5,720.2,1040.0,601.0|808.5|1040.0|
|spot/pan/Candidate|721.5,925.5,540.1,868.5,568.3|721.5|925.5|
|spot/restore/Baseline|516.9,1043.7,554.0,907.6,408.6|554.0|1043.7|
|spot/restore/Candidate|579.6,942.9,691.9,658.2,843.9|691.9|942.9|
|perpetual/initial/Baseline|2799.1,1581.5,1873.5,1511.5,943.6|1581.5|2799.1|
|perpetual/initial/Candidate|1720.9,1184.9,1457.8,1373.0,1004.3|1373.0|1720.9|
|perpetual/pan/Baseline|2146.5,2095.9,2128.2,1464.9,1021.5|2095.9|2146.5|
|perpetual/pan/Candidate|1975.6,3372.5,1100.4,2074.4,766.4|1975.6|3372.5|
|perpetual/restore/Baseline|1698.3,1607.7,1144.6,1054.6,1067.4|1144.6|1698.3|
|perpetual/restore/Candidate|1346.0,2423.5,1649.6,1829.9,1326.7|1649.6|2423.5|

Initial-draw medians improve in this controlled comparison, but restore medians
worsen in both markets and pan samples are mixed. It does not establish an
overall loading speedup. All original timings and hashes remain in
`artifacts/pi-history-r1/projection-math-segment-context-r1`. No finite sample
subset or p95 is used.

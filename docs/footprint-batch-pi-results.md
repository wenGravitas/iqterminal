# Footprint delivery on the Pi, November9

Loading correctness and the two prepared-history completion targets pass in the
new headless cohort. Release acceptance remains incomplete: initial current
paint still misses its median target, and Order Walls, concurrent live updates,
whole-app retained memory and normal foreground-browser gates remain open.

Client production build:6fc990f28fe9736d8b6270fd786996006da24702,
`VITE_DATA_MODE=staging`, history tiles/diagnostics enabled, fixture false.
Serving API:f82abdfae06c61f8bccff9fea0778bbaac491b5e. Both collectors and five
protected workers retained their exact IDs/start times; workers remain18579d9.
Route:Pi Chromium→loopback Vite preview4187→independent history SSH18780 and
current SSH18781→private staging18780. History IPQoS=none; current uses the
inherited default. Effective headless ANGLE renderer is Broadcom V3D7.1.7.0,
Mesa24.2.8. Charts use Canvas2D; this does not prove GPU acceleration for every
draw. Fixture browser checks separately use software SwiftShader.

Each loading scenario has five empty-browser-cache runs over already prepared,
fully covered retained source. The fixed historical window ends at
1793804400000 (2026-11-04 15:00UTC). No requested hours, cell geometry or budgets
were reduced. Completion requires every requested slot independently validated
and actually painted. All samples are milliseconds; no p95 is reported.

|Scenario|All five samples|Median|Maximum|Result|
|---|---|---|---|---|
|24h/1h/$25, complete24/24|3654.2,5515.7,3417.5,3734.9,2721.8|3654.2|5515.7|PASS <=5000/10000|
|4h/5m/$25, complete48/48|2911.6,2586.3,2258.5,2601.9,2710.3|2601.9|2911.6|PASS <=5000/10000|
|24h warm reopen, all24cached bars painted|403.6,463.6,454.1,421.8,390.6|421.8|463.6|PASS <=1000 each|
|Warm independent revision validation|1609.3,1652.5,1302.1,1392.5,1496.9|1496.9|1652.5|Observed after cached paint|
|Initial current footprint paint, default5m view|2520.7,2579.4,2590.9,2532.0,2808.5|2579.4|2808.5|FAIL median<=2000; max<=3000 passes|

Every warm first paint was explicitly unvalidated, followed by independent
validation. This is five reopen observations, not a retained-heap plateau.
The current scenario includes ordinary history loading; it is not a current-only
baseline or a two-history-chart/custom-profile concurrency check. Its third run
stopped at current paint before historical completion was observed; no whole-view
completion is inferred from its48 received bars.

The earlier API18579d9 cohort on client1ef788c had24h observations
unobserved,8549.8,5283.9,7958.8,unobserved within12s; its complete five-sample
median is uncomputable. The earlier4h cohort was unobserved,5780.3,3015.0,
4789.8,3053.4. Both failed. These are different identified builds/transport
sessions. The new results show an accepted loading observation, not an isolated
causal estimate of batching alone. Earlier failures remain in the raw evidence;
no finite subset replaces them.

Root causes addressed: future whitespace no longer consumes past coverage;
completion tracks every requested chunk; prepared history is independent of live
bootstrap; and six bounded4h reads now share one progressive compressed transport.
The final chunk waits for footer and EOF. Failed reads expose unavailable slots;
specific revision failures preserve more precise sibling coverage. Duplicate tile
identities/bar-time mismatches are rejected before financial replacement. Exact
Spot row-width cache identity prevents `.01`/`.02` aliasing.

An incumbent-API capture and the new serving batch match every prepared tile,
revision, financial field and coverage value for24hourly USD-M bars,48five-minute
USD-M bars and48five-minute Spot bars. Server loopback comparison took1207.9,
102.4 and67.1ms respectively; these single diagnostic observations are not chart
or cold-materialization timings. The separately observed default1h rollover
published both markets by the first poll at+2116/+2206ms. Independent canonical
FINAL cursor references match all OHLC, base/quote cells, delta/extrema and counts:
64,756executions/33pages USD-M;42,269/22pages Spot,21cells each, zero duplicates.
No source/math/retention or collector changes were made.

The first current sample's response finished about1210ms after navigation while
current paint was observed at2521ms. Both timestamps are client-side; no server
clock is subtracted. This suggests a remaining client startup/paint delay;
profiling is still required before attributing it to a particular component.

Evidence prefixes in `artifacts/pi-history-r1`:

- `batch6fc-f82-24h-r1`: all samples/observations, strict gate output, executed
  source, browser metadata, financial captures, resources and real screenshots.
- `batch6fc-f82-4h-r1`: the equivalent48-slot loading cohort.
- `warm6fc-f82-24h-r1`: reopen/validation observations and screenshots.
- `current6fc-f82-5m-r1`: every failed-current-gate sample and request timing.
- `footprint-failed-slots-r1`:1,223unit tests/two skipped, typecheck/build and
  five focused headless browser regressions on6fc990f. Earlier12-browser results
  belong to a8eadbc and remain in `footprint-batch-client-r1`.

Per-run Pi CPU/swap/heap/frame/long-task data and correlated requests are retained.
Continuous staging CPU sampling was not captured during these cohorts; SQL
metrics and serving/source health are available. That instrumentation and normal
foreground UX remain limitations for full release acceptance. These observations
do not certify cold builds, absent source, wall loading or concurrent live safety.

The API-only rollout initially failed its post-check: the new isolated worktree
lacked the incumbent state symlink, causing an empty read-only mount. Only the API
was replaced again after restoring the correct link; required source/job files,
exact serving build, canonical tile equality and all seven protected identities
were verified. Both the failed workflow and correction are retained. A new tested
rollout preflight now requires the worktree's resolved state root to equal the
incumbent root before any service replacement. See backend batch documentation
for the precise receipt and rollback. No production deployment/main merge occurred.

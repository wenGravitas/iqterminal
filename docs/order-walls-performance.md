# Order Walls performance

## Controlled Raspberry Pi renderer matrix

The accepted fixture run completed 12 of 12 cases on 2026-10-17 UTC with three samples per scenario. It used the actual `/usr/bin/chromium` 154.0.8037.92 on the arm64 Raspberry Pi host (`6.12.109+rpt-rpi-v8`). Chrome's CDP reported Broadcom V3D 7.1.7.0 / Mesa 24.2.8, with GPU compositing enabled. The chart itself reported its `canvas2d` backend. Chromium ran headless without the forced SwiftShader argument.

This is a deterministic renderer comparison, not an exchange or gateway measurement. The fixture chart held 5,000 one-minute candles at logical range 4987–5000, UTC range 2026-10-09 14:48–15:01 (`1791557280000..1791558060000`), and price range $82,960–$84,070. Every case used the same dark theme, 1366×860 viewport, and those time and price bounds. The harness reapplied and checked the bounds after feature setup, pan/zoom restoration, and the steady hold. All 12 cases passed the source, navigation, worker, Vite-update, and viewport guards.

Each sample sent 40 in-page updates 100 ms apart, performed a horizontal pan and 1.12× zoom followed by restoration, and then observed a 10-second hold. Wall cases retained and drew 20 synthetic segments at $50 aggregation. Heatmap cases retained and drew 416 bins (13 columns × 32 rows). The “both” workload exercised both layers in the same chart. These fixture updates do not represent live venue data or network traffic.

| Scenario | Renderer p95 draw time, median (range) | Worst single draw | Renderer-retained estimate | Sampled JS heap peak, median | Chromium process-tree RSS, median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Candles only | — | — | 0 B | 21.2 MiB | 635 MiB |
| Candles + Order Walls | 0.3 ms (0.3–0.4) | 10.0 ms | 3,840 B | 22.0 MiB | 760 MiB |
| Candles + Heatmap | 8.7 ms (8.2–10.6) | 35.7 ms | 46,592 B | 27.0 MiB | 758 MiB |
| Candles + both | Walls: 0.3 ms (0.3–0.4); Heatmap: 11.5 ms (8.3–12.8) | Walls: 7.7 ms; Heatmap: 132.5 ms | 50,432 B | 27.3 MiB | 737 MiB |

Draw-time p95 values are the median and range of three sample-level p95s. The worst single draw is the maximum recorded over each scenario's three samples, including update and pan/zoom work. Renderer-retained bytes are implementation estimates for retained wall/heatmap data, not total chart, canvas, or GPU memory. The JS heap peak is sampled through Chromium's `performance.memory` API during each run. RSS is the sum of the benchmark Chromium process tree; shared pages may be counted more than once, and some canvas/GPU allocation is outside this figure.

The in-page synchronous update-dispatch p95 was 0.1 ms for candles only, 0.5 ms for walls, 0.4 ms for heatmap, and 0.8 ms for both at the median of three samples. This boundary covers the synchronous patch/update call and scheduling request, not the subsequent draw or an exchange round trip.

### Frame-interval observations

Cells show `median sample p95 / worst sample p95 / largest single interval` in milliseconds for each phase. They are observed `requestAnimationFrame` gaps, not an inferred frame rate.

| Scenario | 40 incremental updates | Pan/zoom and restore | 10-second hold |
| --- | ---: | ---: | ---: |
| Candles only | 16.8 / 16.8 / 266.7 | 33.2 / 33.3 / 116.6 | 16.8 / 16.8 / 33.4 |
| Candles + Order Walls | 16.8 / 49.9 / 116.6 | 16.7 / 16.8 / 33.3 | 16.8 / 16.8 / 16.8 |
| Candles + Heatmap | 49.9 / 150.1 / 216.6 | 49.9 / 250.1 / 250.1 | 16.8 / 16.8 / 166.6 |
| Candles + both | 16.8 / 50.1 / 200.0 | 16.8 / 16.8 / 66.6 | 16.8 / 16.8 / 49.9 |

Rare long gaps remain visible despite the roughly 16.8 ms overall p95 interval: the overall scenario maximum ranged from 66.7 to 266.7 ms, with 0–17 intervals over 100 ms and 3–9 observed long-task entries per sample. These are host- and run-specific observations. They do not establish a 60 fps guarantee.

At the starts of the 12 cases, host `MemAvailable` ranged from about 810 to 1,339 MiB and one-minute load average from 1.96 to 5.44. The separate pre-run shell sample showed 2.8 GiB of swap in use. No build or test process overlapped the fixture cases. These conditions limit repeatability and should accompany any comparison with another device or run.

The dark screenshots show the actual 20-line fixture. The [walls-only sample](../artifacts/order-walls/fixture-candles-order-walls-sample-2.png) and [combined sample](../artifacts/order-walls/fixture-candles-both-sample-1.png) were visually checked; the complete set of 12 screenshots is listed in the [fixture artifact](../artifacts/order-walls/fixture-pi-final.json). The matrix JSON records per-sample timings, memory, bounds, source hashes, browser/GPU details, network counters, and stability checks. An earlier complete run with inconsistent visible ranges is retained as [provisional evidence](../artifacts/order-walls/fixture-pi-viewport-mismatch-provisional.json) and is excluded from the measurements above.

## Live staging measurements

The full four-case staging matrix is still incomplete, so there is no overall staging performance acceptance. The selected one-sample runs below used the actual staging app and Binance USD-M perpetual data on the Pi. Source hashes and browser/runtime guards stayed stable for the completed final-source runs. Results are real end-to-end load observations, not renderer-only fixture measurements.

| Final-source case | Cold first visible / canonical completion | Same-page warm first visible / canonical completion | Recorded scope |
| --- | ---: | ---: | --- |
| Order Walls only, targeted | Cold exact completion timer was not retained. | 5.340 s / 39.929 s | Canonical warm history reached promoted, initialized, idle state at cursor = watermark; 131 pages, 21,118 records, 5.59 MB, and two cache-prefix hits. The artifact is marked provisional because a harness error occurred after warm completion and before pan/hold. |
| Heatmap only | 5.152 s / 41.177 s | 2.395 s / 29.622 s | Both cold and warm history reached terminal state; the case also completed its live/pan phase. |
| Order Walls + Heatmap | Walls: 11.665 s / 163.737 s; Heatmap: 3.202 s / 9.110 s | Walls: 5.872 s / 50.485 s; Heatmap: 0.982 s / 19.925 s | Cold Walls replay used 79 successful pages, 10,131 records, and 4.48 MB. Warm bounds were restored to the same visible time range. This case completed the live hold and candle rollover observation. |

The combined case used $50 wall aggregation. The target wall-only warm value is a measurement of that phase, not a completed scenario acceptance; its 300-second measurement bound was permitted to establish canonical promotion, and the following harness exception stopped the case before continuity checks. The combined case provides the exact cold completion timer that the targeted wall-only artifact did not retain. Warm values are not a controlled same-query cache benchmark: ranges advance with live candles and requests include shared-prefix and fresh-tail work.

### Pan, live updates, and rollover continuity

The combined run captured 14 wall snapshots over a 10.366-second live hold. Retained segment count stayed at 134 in every snapshot; visible drawables ranged from 2,821 to 2,822 while draw count rose from 210 to 251. Heatmap bins stayed at 1,332. The wall status was initially `loading`; coverage first reported complete at 3.809 seconds, state became `live` by 5.265 seconds, briefly returned to `loading` at 8.150 seconds as the range advanced, and returned to `live` at 8.906 seconds. No sampled snapshot showed zero retained segments or zero visible drawables, which argues against a wholesale clear in the observed intervals. The harness did not record segment-ID sets or a pixel capture at each sample, so exact identity retention and the absence of sub-sample flashing remain unverified.

After pan/zoom, the worker advanced to generation 8 while still catching up: cursor stayed at 4,514,698 as watermark moved from 4,516,803 to 4,516,898; `busy=true`, `initialized=false`, and `replayPromoted=false`. This was not a clean completion at the end of the 10-second hold. In the later rollover snapshot, after a 41.791-second rollover wait following the live hold, the candle advanced from `1792257720000` to `1792257780000`. Generation 8 had then reached cursor = watermark = 4,517,171, was promoted, initialized, and idle. Wall geometry remained mounted with 136 retained segments, 2,409 visible drawables, and 6,747 value runs. At that capture, wall render p95/max were 8.8/48.9 ms; Heatmap render p95/max were 33.4/247.3 ms. The visible time range had shifted forward; these counts are not a same-viewport comparison.

The wall panel itself still reported `stale`/partial at that final capture because the durable watermark had not confirmed the requested tail: coverage ended at `1792257780636`, while `lastConfirmedAt` was `1792257779977`, a 659 ms gap. The chart's padded right edge was `1792257840000`, 60.023 seconds beyond `lastConfirmedAt`; that is separate from the 659 ms requested-tail gap. Heatmap still reported `syncing` while loading visible history, with 1,332 bins. Thus the snapshot demonstrates retained geometry and eventual replay catch-up through rollover, while durable wall-tail freshness and Heatmap completion were not clean at capture. It does not establish full lifecycle acceptance.

The combined screenshot is [available here](../artifacts/order-walls/staging-candles-both-sample-1.png). The raw run record includes viewport, per-sample segment/visible counts, worker generations and cursors, status transitions, API requests, and renderer diagnostics: [combined staging artifact](../artifacts/order-walls/staging-both-final-source.json). The targeted [wall cold/warm measurement](../artifacts/order-walls/staging-wall-cold-warm-300s-measurement.json), [Heatmap case](../artifacts/order-walls/staging-heatmap-final-source.json), and earlier [incomplete wall-only attempts](../artifacts/order-walls/staging-wall-cold-warm-targeted.json) and [interrupted attempt](../artifacts/order-walls/staging-wall-cold-warm-180s-interrupted-provisional.json) are retained separately. Prior diagnostic and warm-replay attempts remain provisional and are not used as final-source pass results: [diagnostic attempt](../artifacts/order-walls/staging-pi-source-frozen-diagnostic-provisional.json), [warm-replay attempt](../artifacts/order-walls/staging-pi-warm-replay-provisional.json).

### Focused Order Walls continuity probe

A separate one-chart staging probe then instrumented exact retained/visible segment IDs, every RAF sample, each scheduled Order Walls draw, source snapshot/patch membership changes, and candle rollover in Chromium. It reached live candles and visible Order Walls geometry in 37.549 seconds, then monitored 70.155 seconds after the scripted pan/zoom-and-restore. The source hashes, main-page URL, worker count, and Vite update guard stayed stable; there were no page errors. This is a bounded continuity observation, not a performance matrix.

At the baseline the live wall map held two exact IDs: `1792225022082:bid:80550:1792259644557:4535689` and `1792225022082:bid:81050:1792259627625:4535523`; one segment projected to 93 visible drawables. Across 25 source patch batches, 19 IDs were added and no IDs were removed. The map grew to 21 retained IDs and 19 visible IDs / 426 drawables by the final capture. The rebuild counter rose from 1 to 4 while existing IDs remained in the source map. The artifact records full baseline/final ID sets and sampled changes.

The deliberate two-candle pan temporarily moved both retained segments outside the visible time range. During that scripted 800 ms pan/restore phase, four scheduled draws and 19 RAF samples had zero visible drawables; the same two IDs remained retained, and geometry returned after the viewport was restored. No source patch removed an ID, and there were no zero-geometry samples after that pan window. The brief empty view therefore reflects the test's viewport movement, not a wholesale data clear. This capture does not test for unsampled pixel flicker outside the recorded RAF/draw callbacks.

The candle rolled once 35.150 seconds into the observation, from `1792259640000` to `1792259700000`. Final wall status was `live`, coverage `complete=true` and `partial=false`, with 21 retained segments and 426 drawables; the status still carried `provisional=true`, so this does not establish terminal lifecycle acceptance. The probe recorded 3,889 RAF samples and 103 draws, with a largest RAF gap of 204 ms and draw gap of 12.517 seconds. These instrumented gaps are observations only, not an FPS claim. Initial host `MemAvailable` was 1.29 GiB and load average 4.62; at the end they were 496 MiB and 9.35, respectively. The post-run health read timed out, so there is no after-health snapshot.

The [before-pan screenshot](../artifacts/order-walls/staging-continuity-before.png) and [after-rollover screenshot](../artifacts/order-walls/staging-continuity-after.png) show the actual staging chart. The [continuity probe artifact](../artifacts/order-walls/staging-continuity-probe.json) contains exact per-sample ID sets, patches, draw and RAF counts, network requests, host snapshots, and source/runtime guards. The one-candle rollover and retained geometry provide continuity evidence for this page and interval; they do not turn the incomplete four-case matrix into staging performance acceptance.

### Timing and acceptance limits

The combined run began with host load averages of 8.93/5.98/5.10 and 758 MiB `MemAvailable`; it ended at 6.21/7.35/6.02 and 680 MiB. The benchmark Chromium process-tree RSS was about 728–731 MiB, with shared-page double counting possible. Six Vite processes were present; no build or test process overlapped. The combined artifact contains long tasks up to 918 ms and draw outliers, so these live timings and frame intervals are host-contended observations, not a platform-performance guarantee. No FPS or 60 fps claim is made.

The lead reported the final source checks green: 298 tests across 42 files and a production build. The focused probe now records per-segment identity through one pan/restore and candle rollover, with no membership removals or post-pan zero geometry. The four-case matrix, a nonprovisional final wall status, durable tail freshness after rollover, and a fully settled combined-overlay state remain unestablished, so staging performance acceptance is still pending. No broad matrix rerun followed the combined case; the focused artifact documents the bounded continuity check and its limits.

Earlier attempts include a 90-second replay bound, an interrupted 180-second measurement, and instrumentation failures before current panel state was captured. They remain preserved in the artifacts above and are not treated as feature failures or accepted measurements where the harness did not capture a valid terminal state.

## Footprint + Order Walls + Heatmap fixture coexistence

A separate visual smoke passed on the explicit development fixture page in the same Pi Chromium build. The Binance panel had all three native indicators attached at once. After attachment, the browser injected 13 deterministic Footprint bars, 20 wall segments (19 projected in the visible range), and 12 Heatmap buckets (156 rendered bins) directly into the chart primitives. There were no page errors, and the canvas showed the three layers together. This verifies native overlay coexistence and the settings path; it does not measure live study collection, depth history, exchange connectivity, or performance acceptance.

The [coexistence screenshot](../artifacts/order-walls/fixture-coexistence.png) shows the combined layers. The [Order Walls settings screenshot](../artifacts/order-walls/fixture-order-walls-settings.png) shows the native dialog with `$50` price aggregation selected. The [smoke record](../artifacts/order-walls/fixture-coexistence.json) records the injected counts and rendered diagnostics.

## Verification

`node --check scripts/order-walls-bench.mjs` and `node --check scripts/order-walls-continuity-probe.mjs` passed. The accepted fixture matrix passed its source/runtime/viewport guards. Final-source staging Heatmap and combined artifacts passed source/runtime guards; the focused continuity artifact also passed source/runtime guards and contains one live rollover. The targeted wall-only warm phase reached canonical promoted/idle state, but its overall artifact remains provisional because of a post-warm harness error. The lead reported 298 tests across 42 files and a production build passing on the frozen source. No core source changes were made for this benchmark. The staging matrix and lifecycle/performance acceptance remain incomplete as described above.

# Retained-wall rendering evaluation (ongoing)

Source baseline: frontend bcd7619fb9260b50c6134d7d21306d5c90fcd860; isolated branch `feat/persistent-wall-navigation`. Existing main, services and prepared data are untouched. These are **headless software-rendered component experiments**, not ordinary-chart, financial-reference or foreground Pi acceptance. Host architecture aarch64, Chromium identity is in each raw result. Canvas 1200×600, DPR1; headless Chromium with forced SwiftShader. No network/history requests were involved.

## Canvas experiment

The experiment retained exact fractional logical time paths per source segment and value, using the chart's actual priceToY on every frame. Camera movement did not replace paths. It retained offscreen data and used current coordinates for inspection. Exact value buckets kept normalization separate from geometry. Tiny spans retained a one-device-pixel minimum. It ran behind a constructor flag, never enabled by the ordinary application.

The repeatable synthetic input contains 2,500 segments /20,000 value runs. There are intentional repeated source positions in this stress input: it is a drawing workload, **not a canonical financial fixture**. Initial preparation is excluded from navigation draw timings. Each run performs90 continuous time/price camera changes and inspects actual canvas alpha pixels after each draw. Readback and RAF waits are outside draw-call timings; these are not frame-interval or input-to-display numbers.

| Experiment | Initial preparation | Navigation draw p95 / maximum | Blank frames |
| --- | ---: | ---: | ---: |
| Original renderer |366.2ms|15.0 /58.4ms|89/90|
| Retained exact-value Canvas paths |676.4ms|93.6 /199.5ms|0/90|

The lower original-renderer time is **not useful performance**: it mostly drew no walls. Retention solved this component's blanking but the stroke count made dense drawing too costly. Source output, gaps and live data were not validated by this workload.

A second experiment added a notional-sorted path union tree to select contrast tiers without regenerating geometry. It preserved0blank frames but increased estimated resource bytes from7,400,000 to14,600,000 and did not justify adoption. Raw second-pair numbers are retained, **not accepted as a clean matched performance comparison**: a focused test process overlapped part of that capture. Its retained draw p95 was223.9ms and initial preparation7,981.5ms; do not attribute that difference solely to the tree.

**Decision:** neither Canvas experiment is enabled or retained in application source. The exact final experiment is preserved as `artifacts/persistent-wall-navigation/canvas-experiment.patch`, applicable to00c2223. It includes its source, deterministic tests, explicit fixture and finite headless measurement command. Applying it in a separate worktree restores the experiment; run Vite on an unused owned port4189, then `node scripts/measure-wall-retained.mjs <new-evidence-label>`. The command refuses to overwrite evidence. The first pre-tree source variant is represented by the experiment description and raw results, not an immutable application build.

The next implementation target is retained batched resources with camera uniforms, avoiding one Canvas stroke per value and preserving exact minimum-pixel spans. Context ownership and relative-coordinate precision must be resolved before chart integration. This is a rendering decision, not evidence that a GPU implementation already passes.

## Completed lifecycle changes

-9b7988d: presentation-only settings retain history/current requests and subscription generation. Selection changes still resubscribe.59archive tests passed.
-00c2223: general boundary navigation retargets history without a global empty snapshot or current-lane reset. Existing validated overlap remains during acquisition, failure and scoped retry. `loadedFrom` distinguishes the retained start from newly requested history.60archive tests passed, including injected failure/retry.

The boundary change still acquires a complete independently fenced replacement range. It does **not** yet meet missing-interval-only acquisition, bounded resident interval reuse or gesture hysteresis. Those remain implementation work. At that checkpoint the ordinary renderer still had the reproduced camera blanking defect. No goal-completion or foreground-performance claim is made.

## Verification and cleanup at this checkpoint

Application source00c2223204743bc08a926a83c127b39296df374e: typecheck and production build passed (existing large-bundle advisory).60archive tests passed. The experimental retained renderer additionally passed73focused checks with the original camera regression still recorded as an expected failure; those experimental tests are in the preserved patch, not enabled product code.

Two existing UI scenarios passed against this worktree's isolated Vite development preview on127.0.0.1:4189: historical-gap/live-status separation and Order Walls settings/show-hide/Heatmap lifecycle. Explicit deterministic fixture input, headless Chromium/SwiftShader, not production-build or live-route acceptance. Raw Playwright result and status screenshot are in the task artifact folder. An initial temporary config outside the ESM package failed to import the helper and ran no tests; putting that config inside the worktree corrected the harness. No application change was needed.

The isolated preview was stopped after the checks. The ordinary5173client and18780/18781tunnels remain untouched; no backend/collector/watch process was replaced. No main merge or remote deployment occurred.

For the next retained-resource implementation, actual product candle and comparison charts explicitly use Canvas2D (`panel.ts` and `market-comparison/panel.ts`). A shared offscreen WebGL2 layer can therefore supply batched geometry without one extra context per chart, then composite at the existing primitive layer. It must have explicit ownership/disposal and a safe fallback, bounded instance buffers, exact candle-knot mapping and relative-coordinate precision. This is the selected next implementation direction, **not implemented or accepted by this checkpoint**.


## Retained GPU implementation and compiled-chart evidence

The next-direction paragraphs above describe the earlier checkpoint. Application commit703a34d implements that direction;7b7bc2d adds hover camera guards, failed-allocation cleanup and lifecycle checks. ec52029 changes only the lifecycle fixture to represent a current snapshot at its source timestamp. The dedicated compiled build embeds its actual commit through VITE_BUILD_COMMIT. No backend application change or deployment was needed for this rendering work.

`src/chart/wall-gpu-resources.ts` owns one shared detached WebGL2 context. `wall-retained-renderer.ts` owns bounded512-slot chunks and exact source references. `openalgo.ts` enables it for the actual Canvas2D chart integration. The layer composites at the existing primitive's position in the chart, using the existing visible-chart scheduler. Source corrections mask only affected instances and prepare replacements by chunk; camera movement changes uniforms. `wall-logical-mapping.ts` records exact candle knots, including gaps and fractional times. Actual knot revisions invalidate affected resources; pure logical-index translation does not. Native prices and time coordinates use relative high/low float pairs. Exact CPU-double notional comparisons determine contrast tiers, not rounded GPU notionals. Hover resolves exact original segment/value data against the painted camera and declines stale-camera hits.

Styles use uniforms. A camera or contrast-reference change does not reconstruct source runs or upload unchanged geometry. Contrast reference and visible-count scans still inspect retained spans; these are measured CPU work, not claimed O(1) camera handling. Threshold/mixed mode keeps the existing Canvas implementation. If WebGL2 or the bounded renderer capacity is unavailable, a synchronous Canvas fallback keeps content visible; that fallback does not meet the no-reprojection/performance claim.

The shared GPU buffer ceiling is64MiB, with a16M-pixel surface ceiling. Each instance uses44bytes of GPU buffers; exact source rows and mapping metadata remain CPU-owned. These are renderer limits, not increased financial/history caps. Accounted renderer bytes are not total JS heap. Resource pressure/failure falls back explicitly rather than silently omitting walls. Eight chart owners share one context; disposing the last owner releases it. Shader/program allocation failure also releases the failed context.

### Matched component comparison

Same2500-segment/20000-run input and90 camera changes as the Canvas experiment, headless software rendering on this aarch64 host. This was the first GPU implementation before later clipping/hover hardening; it is not a final-build foreground measurement.

| Route | Initial preparation | Navigation draw p95 / maximum | Blank frames |
| --- | ---: | ---: | ---: |
| Original budgeted Canvas |449.7ms|10.5 /33.2ms|89/90|
| Retained GPU |171.6ms|25.6 /180.2ms|0/90|

The baseline is faster because it mostly paints nothing. Candidate geometry stayed at44batches,880000GPU bytes and88initial buffer uploads, with no camera rebuild/upload. Readback and RAF waits remain outside draw timings. This does not establish the foreground33ms frame-interval target. Raw samples: `gpu-retained-first-{baseline,retained}.json`.

### Correctness and failures retained

The component comparison uses32 camera cases across DPR1/2 and linear/log scales, irregular candle spacing, .01 price precision,640 sampled line cores, exact unchanged source JSON, hover, equivalent snapshots, removal and correction. Separate unit checks exercise actual installed chart PriceScale linear/log/percentage/indexed and inverted modes, and split-coordinate error below.001devicepx at the tested deep zoom.

Two initial overly strict raster comparisons failed: RGBA tolerance3 found alpha difference18; centroid tolerance.05px found.1076px. A Canvas-only control established Skia's fractional-stroke quantization: nominal1.666666px at an integer y produces alpha162/163 at opacity.85, like a1.5px stroke, while analytic GPU coverage gives181. This is a rasterization difference, not permission to shift prices. The retained checks require RGB error<=5, integrated width difference<=.27devicepx and centroid difference<=.25devicepx, independently of the tighter coordinate check. Observed maxima were RGB4, width.1754px and centroid.1076px. Raw `gpu-correctness-first.json` preserves all cases; pixel-exact Canvas antialiasing is not claimed.

Compiled703a34d passed three browser tests: component correctness and ordinary Spot5m/USD-M15m chart controls with a fixed30h prepared presentation. Each market uses944segments/7552runs and an explicit source gap. Actual composed-layer pixels were sampled DURING36 camera steps, mouse drag, resize and revisit. Every sampled frame had wall content; initial17chunk builds/34uploads remained unchanged. The feed callback was deliberately replaced by a controlled fixed presentation: this proves chart/render continuity, not service interval reuse, network cancellation, live ACKs or financial-source equivalence. `compiled-browser-703a34d.json` contains all results.

Compiled7b7bc2d passed those same three checks but its new fourth lifecycle check failed because its simulated current snapshot incorrectly retained the old episode start. That failed result is retained in `compiled-browser-7b7bc2d-failed-fixture.json`. Fixture-only ec52029 corrected the timestamp; the targeted lifecycle rerun passed. Across four cycles, eight charts shared one context with211200buffer bytes; removing one left184800bytes/seven owners; final disposal returned all counts to zero. One current update rebuilt exactly one chunk, while opacity/color changes rebuilt none. See `compiled-resource-ec52029.json`. These counters demonstrate GPU ownership plateau, not a complete retained-heap proof.

Focused unit gates:78passed, plus one explicitly expected failure reproducing the legacy budgetedCanvas camera defect. Typecheck passed; compiled build passed with the existing bundle-size advisory and a future Vite config-import warning. No broad financial cohort was rerun for this renderer-only work.

### Reproduce safely

In the dedicated worktree, with an unused127.0.0.1:4189:

```sh
VITE_BUILD_COMMIT=$(git rev-parse HEAD) VITE_DIAGNOSTICS=1 pnpm exec vite build --config vite.wall-navigation.config.ts
pnpm exec playwright test --config playwright.wall-navigation.config.ts
```

The build goes to ignored `dist-wall-navigation`, leaving ordinary `dist` and the user's5173client untouched. Playwright starts/stops its own4189preview. Tests are headless under the existing desktop guard. Archive the JSON reporter output under a new build-scoped name before repeating. No foreground acceptance has been performed. Foreground testing remains manual on i3workspace9 once the resident-history lifecycle is ready.

Rollback is to use unchanged main/the ordinary application; no service or prepared state migration was made. Keep this branch and its evidence. The isolated test preview is stopped after each run. Main, production, collectors and protected watch service were not changed.

### Still required for the goal

The renderer improvement is implemented, but the goal is NOT complete. Missing-coverage-only acquisition, bounded resident interval ownership/eviction, gesture hysteresis and cross-range financial boundary proofs remain. General boundary navigation currently retains old display while loading a full replacement. The archive's range-relative episode IDs, terminal statistics and source tokens cannot safely be combined by merely deleting from/to from a cache key. Further integration must preserve separately validated interval ownership and original financial records, with explicit seam/gap tests. Actual foreground Pi timings, total heap plateau and live current-route acceptance also remain pending.

## Subsequent resident-history checkpoint

The missing-interval work described as pending above is now partially implemented and tested in231d67b/5cf5392/9d83348. See [resident-history.md](resident-history.md) for exact scope, the preserved same-start path, the first failed boundary capture, corrected compiled adapter result and remaining requirements. The overall goal remains active.


## Controlled main-heap lifecycle observation

The eight-chart fixture was instrumented with opt-in CDP collection/sampling outside paint timing, using application `fdf0654` and the working observer subsequently committed with this evidence. Four open/dispose cycles used600 exact source rows shared by eight renderer owners. Open JavaScript used-heap samples were4,242,788 /4,291,372 /4,349,732 /4,353,096bytes; disposed samples2,326,740 /2,372,604 /2,423,260 /2,431,096bytes. The final increment was3,364bytes open and7,836bytes disposed. After warmup, each phase varied by less than62KiB. This supports a bounded renderer lifecycle on this small fixture; it does not prove a representative multi-chart worker/RSS plateau.

GPU allocation stayed211,200buffer bytes across eight owners,184,800after one removal, and zero contexts/owners/buffers/surface after all disposals. Current updates and styles retained their existing no-history-rebuild checks. One targeted browser check passed, as did typecheck and the dedicated compiled build. Raw observer output: `compiled-resource-heap-fdf0654-working-observer.json`. No application source changed for this observation.


## Mixed fallback correction

A new compiled regression on `9f57def` reproduced a transition defect: Canvas mixed rows → remove Threshold row → retained GPU → correct Top Level price95 to97 → add Threshold row without a camera change. The final Canvas draw/hit still used95, although its source row already said97. The failure capture is `compiled-mixed-9f57def-failed-stale-canvas.json`.

Application `82714c01aa60a278372ccf6930bede2e4552a088` invalidates the old Canvas transform key after retained rendering. GPU updates intentionally do not maintain old Canvas geometry; switching back must rebuild from current exact rows. This does not invalidate GPU resources or alter ordinary camera behavior. The regression checks the corrected97hit, absence of the old95hit, the Threshold105hit, and completed fallback paint. This is a concrete correctness correction, not a performance claim for mixed mode.

At the exact `82714c0` build, both targeted browser checks passed: the mixed transition and the existing32-case GPU mapping/color/hover/disposal comparison. Typecheck and dedicated build passed. Raw result: `compiled-mixed-82714c0.json`. The owned preview stopped after the tests. Real-route observations above retain their earlier `fdf0654` scope; no new real-source timing claim is inferred from this targeted fallback fix.

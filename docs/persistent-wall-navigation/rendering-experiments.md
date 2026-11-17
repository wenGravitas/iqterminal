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

The boundary change still acquires a complete independently fenced replacement range. It does **not** yet meet missing-interval-only acquisition, bounded resident interval reuse or gesture hysteresis. Those remain implementation work. The ordinary renderer still has the reproduced camera blanking defect. No goal-completion or foreground-performance claim is made.

## Verification and cleanup at this checkpoint

Application source00c2223204743bc08a926a83c127b39296df374e: typecheck and production build passed (existing large-bundle advisory).60archive tests passed. The experimental retained renderer additionally passed73focused checks with the original camera regression still recorded as an expected failure; those experimental tests are in the preserved patch, not enabled product code.

Two existing UI scenarios passed against this worktree's isolated Vite development preview on127.0.0.1:4189: historical-gap/live-status separation and Order Walls settings/show-hide/Heatmap lifecycle. Explicit deterministic fixture input, headless Chromium/SwiftShader, not production-build or live-route acceptance. Raw Playwright result and status screenshot are in the task artifact folder. An initial temporary config outside the ESM package failed to import the helper and ran no tests; putting that config inside the worktree corrected the harness. No application change was needed.

The isolated preview was stopped after the checks. The ordinary5173client and18780/18781tunnels remain untouched; no backend/collector/watch process was replaced. No main merge or remote deployment occurred.

For the next retained-resource implementation, actual product candle and comparison charts explicitly use Canvas2D (`panel.ts` and `market-comparison/panel.ts`). A shared offscreen WebGL2 layer can therefore supply batched geometry without one extra context per chart, then composite at the existing primitive layer. It must have explicit ownership/disposal and a safe fallback, bounded instance buffers, exact candle-knot mapping and relative-coordinate precision. This is the selected next implementation direction, **not implemented or accepted by this checkpoint**.

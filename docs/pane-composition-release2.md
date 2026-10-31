# Pane composition Release 2

Release 2 extends Release 1's bounded chart composition to selected native Order Flow outputs. It combines Multi-Venue CVD, raw Open Interest, the existing Volume study, and native moving averages in a shared chart pane while each producer keeps ownership of its own data and renderer.

This is a local client implementation. The raw Open Interest read endpoint exists in the companion server worktree but has not been released or verified against live recorded data. Browser and Pi artifacts below use explicit fixtures; they do not establish venue connectivity or production acceptance.

## Scope

Supported composition sources are:

| Producer | Numeric outputs | Quantity and unit | Time basis |
| --- | --- | --- | --- |
| Multi-Venue CVD | Total, selected venues, and saved named groups; BTC and executed USDT notional | Cumulative BTC or USDT | Host candle opens; minute execution data is projected onto existing candles |
| Open Interest | Total selected verified venues and each selected venue | Observed level in BTC | Host candle opens; latest observation as of candle close, clamped to now for a forming candle |
| Built-in Volume | Its declared Volume plot | Existing declared unit and quantity | Existing chart candle timeline |
| Native SMA | One derived plot for a selected output | Inherits the source unit and quantity | Source candle timestamps |

The CVD sources follow the existing CVD contract: Binance Spot, Binance USD-M perpetual, and Bybit linear perpetual are supported; Hyperliquid executions are not available to CVD. Open Interest supports the Binance, Hyperliquid, and Bybit BTC perpetual records defined by its raw-data contract. This composition scope centers on Binance USD-M and Hyperliquid BTC perpetual charts; the client also retains existing Binance Spot charting and Bybit execution and recorded-data support. Unsupported or unverified units are not converted or substituted.

R2 adds the declared CVD and Open Interest outputs to the compatible script outputs, native SMA and explicit placement already supported by Release 1. Built-in Volume is the current example of a script output, not the only script output that can be consumed or moved. R2 does not add arbitrary native-indicator composition, calculations beyond SMA, overlays on unrelated panes, trade execution, or a new rendering engine.

## Ownership and data flow

- [`src/scripts/output-registry.ts`](../src/scripts/output-registry.ts) owns one chart-scoped, bounded numeric-output graph. It validates output identity, units, quantity, source and market scope, timestamp convention, quality, reset metadata, chart context and revisions. Limits are 128 outputs, 32 consumers, 5,000 values per output and 128 reset segments.
- [`src/scripts/composition.ts`](../src/scripts/composition.ts) defines stable logical references and the native SMA calculation. The SMA uses a complete contiguous window; warm-up, explicit gaps and reset boundaries yield nulls. It never fills a missing observation or falls back to candle close.
- [`src/indicators/cvd-data.ts`](../src/indicators/cvd-data.ts) owns the chart's CVD demand, output projection and context revisions. [`src/chart/cvd-model.ts`](../src/chart/cvd-model.ts) projects the existing signed execution samples onto the host candle timeline; it does not add minute candles to the chart.
- [`src/indicators/open-interest-data.ts`](../src/indicators/open-interest-data.ts) owns raw observation projection, per-venue provenance and BTC-valued outputs. [`src/feed/staging-raw-open-interest.ts`](../src/feed/staging-raw-open-interest.ts) is the worker's shared poller and bounded cache for all Open Interest consumers in that worker.
- [`src/indicators/composition-placement-controller.ts`](../src/indicators/composition-placement-controller.ts) coordinates explicit placement transactions, managed pane membership, native-pane adoption, rollback and safe pane cleanup. [`src/panel.ts`](../src/panel.ts) connects existing producer views to the placement and output contracts.
- [`src/indicators/order-flow-pane-view.ts`](../src/indicators/order-flow-pane-view.ts) supplies one compact DOM header, legend, status and tooltip for a compatible shared pane. It reuses the chart's pane action buttons. Native CVD and Open Interest views remain the owners of their canvas primitives and data controls.

The numerical graph is chart-local. Moving a compatible study changes placement metadata and the live pane assignment; its saved numeric input continues to reference the same producer output. Separate charts can reference outputs with the same logical IDs without sharing their per-chart consumers or display state.

## Pane presentation

When CVD and Open Interest are explicitly placed in the same compatible managed pane, the shared header replaces their private pane chrome and retains the native controls. The pane has independent scale roles: CVD uses its left scale, Open Interest uses its right scale, and Volume occupies a zero-based lower band. A dependent SMA keeps its current presentation scale and pane when its source changes. If the selected output uses a different scale, **Use the selected output scale** is optional for equal-unit outputs and required when units differ; checking it changes the SMA scale while preserving its pane and saved source reference. CVD and Open Interest values, Volume, and SMA output are aligned to the existing chart time axis and crosshair.

The Volume and SMA pair can remain in a managed lower pane or use the bounded price-pane band supported by Release 1. The R2 Order Flow screenshots show CVD, Open Interest and Volume in one chart pane at both 1366×768 and 720×860:

- [1366×768 fixture capture](../artifacts/order-flow-r2-1366x768.png)
- [720×860 fixture capture](../artifacts/order-flow-r2-720x860.png)

The geometry assertions check that the header begins after the left axis, all ten legend entries fit without horizontal overflow, and the status line ends at the Volume band boundary. These are local Chromium fixture captures, not exchange screenshots.

To build this layout, open **Indicators** and add Multi-Venue CVD, Open Interest and Volume. Use each active indicator's **Move** action to place compatible sources in the same pane; when moving Volume, enable **Use a bottom band for zero-based outputs**. From a source row, choose **Add moving average**, select its declared output and add the SMA. The SMA keeps the selected source's unit and scale role.

## CVD output contract

CVD publishes stable numeric outputs for Total, the supported source lines, and saved aggregation groups in BTC and executed USDT units. Visibility and Venues/Aggregations presentation do not redefine source membership. A group output follows that group's selected market set; cosmetic renaming preserves its values and numeric reference, while a real membership change increments the output context revision even when a particular set of inputs happens to produce equal numbers.

The output retains candle timestamps, cumulative quantity, source scope, completeness, and reset segments. Gaps, stale execution sources, and incomplete warm-up remain explicit. The existing CVD documentation covers signed aggressor-side semantics, anchors, recorder coverage and the separate live/recorded-mode limitations: [Multi-Venue CVD](cvd.md).

## Raw Open Interest contract and server prerequisite

The client requests a bounded raw history through `/market-data/v1/raw-open-interest`; the companion server route is `/v1/raw-open-interest`. The route reads persisted `positioning_oi` rows using `FINAL`; it does not estimate OI from net positioning or subscribe to new exchange feeds. Raw rows retain venue, market, native symbol, source time, receipt time, epoch, exact decimal value, units, source, timestamp quality, observation quality and gap-before provenance.

The current contract is:

- BTC perpetual only; Binance and Bybit records identify `BTCUSDT`, Hyperliquid records identify `BTC`.
- Only observations with both verified BTC units and valid BTC-denominated source rows enter the numeric projection. Other rows remain unavailable/partial; they are not converted.
- The endpoint accepts at most a four-hour range and returns at most 2,000 observations. The client retains at most 2,000 rows across that range and polls the shared endpoint every 10 seconds while at least one chart consumer is active.
- Source observations are expected about every 30 seconds and become stale after 75 seconds. Each candle reads only the latest observation at or before its as-of time. No interpolation, look-ahead, or synthetic zero is used.
- Epoch changes, explicit gap markers, stale samples, omitted invalid rows and truncated history remain visible in per-point quality and output reset metadata. A total sums only usable verified BTC levels and is marked partial when any selected venue is missing or qualified.

The companion endpoint and response contract are implemented and covered by companion-server tests, but they are not deployed or live-verified as part of this client milestone. Production recorded Open Interest requires the normal companion-server release and a separate verification of the deployed route, stored rows, verified unit metadata, and freshness. The local client code must not be described as a live Open Interest feed until that verification is complete.

## SMA dependency and reset behavior

The native SMA can consume a ready compatible CVD, Open Interest, Volume or managed SMA output. Saved references include producer and output IDs, schema, domain, chart context and unit. Before an SMA input is committed, the chart registry checks the candidate against live bindings and all saved consumer refs, including hidden studies. It rejects self-links and links that create or reach a dependency cycle without changing the prior input, settings, output or placement. A disconnected malformed saved cycle does not block a healthy independent link. The native chart API also blocks direct removal while any saved consumer depends on the SMA; that protection clears after the final dependent is removed. A context change widens the output's changed range so the SMA recomputes against the new bounded timeline.

An explicit chart-market selection rebases native SMA input references that matched the chart's prior active context while keeping producer and output identity stable. A stale reference that did not match that prior context remains unavailable until the user selects and applies a current output. CVD keeps its bounded source model across supported BTC chart-context changes when its feed request is unchanged. Open Interest keeps its bounded BTC observations when switching between supported BTC perpetual chart contexts; leaving perpetual marks its output unavailable and releases the chart subscription, and returning to perpetual gets the worker's cached snapshot. This keeps the native outputs aligned to the newly loaded candle timeline without repeating fixture injection or starting a new collector.

The installed chart lifecycle can detach the SMA's numeric consumer during a context reset. The registry publishes each output update to a generic listener, regardless of whether the producer is native, script-backed or another SMA. The panel coalesces ready output IDs, restores only selected SMA APIs whose registry consumer is missing, orders chains from upstream to downstream, reapplies saved visibility and dependency demand, and avoids a full indicator/UI reconciliation. A removed or unavailable source is not recreated from a stale reference.

Hiding a source does not stop it when a visible dependent still requires the value. A hidden intermediate SMA remains demanded by a visible downstream SMA, while its own plotted line stays hidden. Sleeping a chart pauses its per-chart feed subscription; waking replays the worker's shared snapshot. Removing the final consumer releases that chart's source demand and managed pane membership.

## Persistence and migration

R2 retains the existing `composition.version: 1` schema and the existing workspace storage key. Stable logical pane, plot and scale IDs remain persisted; runtime pane indices, OpenAlgo API instances, feed subscriptions and data arrays do not. CVD group settings, Open Interest venue selection and visibility, SMA inputs, and pane placement persist in their existing indicator/composition records.

Legacy CVD and other native-owned panes keep their native adapters and saved sizing. CVD and Open Interest may join a compatible managed pane through explicit placement. Only the supported adapters can be adopted from an opaque legacy pane; this does not turn arbitrary legacy panes or native indicators into generic managed subjects. An explicitly empty indicator/member list stays authoritative and does not resurrect removed indicators.

R1's composition, migration, placement and data limits remain documented in [Pane composition Release 1](pane-composition-release1.md). That page's verification totals describe the original R1 run; R2 evidence is listed below.

## Verification evidence

All checks in this section use deterministic local tests or explicit browser fixtures. They are not live venue or deployed-server acceptance.

### Focused correctness and browser coverage

- `pnpm exec vitest run tests/output-registry.test.ts tests/composition-sma.test.ts` — 16 tests passed after adding live/saved cycle preflight coverage.
- `pnpm typecheck` — passed after the registry cycle preflight and native SMA removal-policy changes.
- `VITE_DIAGNOSTICS=1 pnpm exec vite build --outDir /tmp/iqterminal-pane-r2-dist` — passed. Vite reported the existing large-chunk warning.
- The targeted forming-bar counter in [`tests/browser/order-flow-pane.spec.ts`](../tests/browser/order-flow-pane.spec.ts) directly mutates the chart's forming candle and calls the native CVD/Open Interest adapters at 20 × 50 ms. It instruments their projection methods, output registry notifications, Volume/SMA revisions and pane invalidations. This is a deterministic adapter-boundary regression check, not an end-to-end feed-rate benchmark; the separate Volume/SMA worker telemetry and two-chart lifecycle checks remain distinct.
- `R2_BROWSER_RESULTS=artifacts/browser-results-r2-repair.json pnpm exec playwright test --config playwright.r2.config.ts tests/browser/open-interest-sma.spec.ts tests/browser/composition-cvd.spec.ts tests/browser/composition-sma-registry.spec.ts tests/browser/order-flow-pane.spec.ts` — Open Interest, SMA chain, both Order Flow cases passed; the first CVD run exposed an invalid assertion that switching group membership between venues must preserve equal values. The CVD check was corrected to compare the group output to its selected venue output while checking context revision and derived SMA correctness.
- `R2_BROWSER_RESULTS=artifacts/browser-results-r2-cvd-repair.json pnpm exec playwright test --config playwright.r2.config.ts tests/browser/composition-cvd.spec.ts` — passed 1/1 after that test correction.
- The combined fixture case in [`tests/browser/order-flow-pane.spec.ts`](../tests/browser/order-flow-pane.spec.ts) covers CVD, Open Interest, Volume, SMA, two charts, shared raw-OI subscribers, hidden-source demand, sleep/wake snapshot replay and cleanup. Its explicit fixture artifact is [`composition-r2-combined-multichart.json`](../artifacts/composition-r2-combined-multichart.json).
- [`composition-r2-telemetry.json`](../artifacts/composition-r2-telemetry.json) and [`composition-r2-multichart-telemetry.json`](../artifacts/composition-r2-multichart-telemetry.json) record single-chart and two-chart Volume/SMA worker fixture telemetry. They are platform observations, not live data or a 60 fps benchmark.
- `R2_BROWSER_RESULTS=artifacts/browser-results-r2-cycle-and-removal.json pnpm exec playwright test --config playwright.r2.config.ts tests/browser/composition-sma-removal-policy.spec.ts tests/browser/composition-cycle-preflight.spec.ts` — passed 2/2. The tests use real native chart APIs for visible/hidden dependency removal protection, provider API recreation, and atomic rejection of self-links and an SMA1-to-hidden-SMA2 cycle.
- `R2_DEV_RESULTS=artifacts/browser-results-r2-engine-dev.json pnpm exec playwright test --config playwright.r2.dev.config.ts tests/browser/composition-engine.spec.ts tests/browser/market-comparison-engine.spec.ts` — passed 3/3 against the Vite dev server. These tests import the installed OpenAlgo browser module directly; the preview server does not serve Vite's optimized `/node_modules/.vite/deps` module path.
- `R2_BROWSER_RESULTS=artifacts/browser-results-r2-composition-vertical-final.json pnpm exec playwright test --config playwright.r2.config.ts tests/browser/composition-hardening.spec.ts tests/browser/composition-input-recovery.spec.ts tests/browser/composition-market-switch.spec.ts` — passed 4/4. It checks same-unit Volume-to-CVD scale retention and explicit scale change, two saved-input recovery cases, Binance USD-M perpetual to Hyperliquid perpetual with a single CVD/OI fixture injection and current SMA consumer recovery, unsupported Binance Spot OI, and cached-snapshot recovery on return to Hyperliquid perpetual.

### Matched Pi 5 update-count comparison

The before/after browser wrapper ran on the same Raspberry Pi 5 Model B Rev 1.0, aarch64, Debian 12 and Chromium SwiftShader at 1366×768 with 5,000 candles. It offered fixture updates at 20 Hz for 2.5 seconds, followed by a 300 ms drain. Both runs used the Binance USD-M BTCUSDT 1m fixture and one Volume study. Exact artifacts are [`composition-r2-r1-baseline.json`](../artifacts/composition-r2-r1-baseline.json) and [`composition-r2-current-comparable.json`](../artifacts/composition-r2-current-comparable.json).

| Observed count | R1 baseline | R2 current |
| --- | ---: | ---: |
| Host notifications | 15 | 41 data notifications |
| Indicator reconciliations | 15 | 0 |
| Active-indicator renders | 16 | 1 initial render |
| Script object-provider syncs | 30 | 0 |
| Engine object-refresh calls | 90 | 0 |
| Worker result rows | Not measured in baseline artifact | 205,000 across 41 results |
| Full SMA values processed | Not measured in baseline artifact | 0 |
| Registry SMA tail values processed | Not measured in baseline artifact | 820 |

The runs completed different numbers of fixture updates, so these counts show that the R2 path avoids repeated UI reconciliation and provider syncs under this fixture; they do not measure comparative frame rate or rendering latency. The 90 baseline count is chart-engine object-refresh calls, not the panel-level telemetry counter. No 60 fps claim is made.

### Broader gates and acceptance matrix

| Gate | Result | Evidence and limits |
| --- | --- | --- |
| Full client suite | **Passed: 718 tests, 1 opt-in live test skipped; 91 files passed, 1 skipped** | Quiet final run, 36.09 s |
| Client typecheck | **Passed** | `pnpm typecheck` after source freeze |
| Normal client build | **Passed** | `pnpm build` after typecheck; existing large-chunk warning, main bundle 1,930.17 kB minified / 521.09 kB gzip |
| R2 recovery, scale and native market-switch browser cases | **Passed: 4/4** | [`browser-results-r2-composition-vertical-final.json`](../artifacts/browser-results-r2-composition-vertical-final.json); explicit fixtures supplied once for the Binance USD-M perpetual → Hyperliquid perpetual recovery, then Spot availability and cached-snapshot return |
| OpenAlgo direct-import engine checks | **Passed: 3/3** | [`browser-results-r2-engine-dev.json`](../artifacts/browser-results-r2-engine-dev.json), using the Vite development server |
| Staging-mode Level Watch check | **Passed: 1/1** | [`browser-results-r2-staging-watch.json`](../artifacts/browser-results-r2-staging-watch.json), using the local staging-mode build |
| Broad preview browser batch | **45 passed, 4 failed across 49 tests** | [`browser-results-r2-valid-harness.json`](../artifacts/browser-results-r2-valid-harness.json); its two direct-import cases and staging-only control passed in the correct environments above. One drawing Object Tree visibility case remains a known R1 baseline failure. |
| Client and companion-server whitespace checks | **Passed** | `git diff --check` in both worktrees |
| Live raw Open Interest and production release | **Not run** | The route still requires the normal companion-server release and a separate deployed-route, stored-row, verified-unit and freshness check. No deployment or live-data claim is made. |

The drawing Object Tree visibility case still times out after its stale nine-versus-eleven tool expectation was corrected. The isolated R1 baseline at `efa68eaa` reproduces the same failure in [`browser-results-r1-baseline-drawings.json`](../artifacts/browser-results-r1-baseline-drawings.json), and the R2 retest is recorded in [`browser-results-r2-drawing-retest.json`](../artifacts/browser-results-r2-drawing-retest.json). Treat it as a known pre-existing browser failure; it was not changed as part of pane composition. The first invalid-storage-state report is retained only as a harness diagnostic, not an acceptance result. Keep full local tests, deterministic fixture checks, live venue probes, production release checks and platform measurements distinct in any release report.

## Release boundary and known gaps

- No raw Open Interest live acceptance or companion-server deployment has been completed.
- CVD source support and coverage remain as described in [`cvd.md`](cvd.md); no source is inferred from candles or another venue.
- No additional legacy native-pane migration beyond the explicit CVD and Open Interest placement adapters described here, new script-language engine, production chart-engine replacement, React client, new feed collector, trade execution, footprint composition, script-runtime extension, AI, backend schema migration or speculative WASM abstraction is included in this milestone. CVD and raw Open Interest are the native sources added by R2; native SMA is the only native derived indicator added to composition.
- On candle timeline, close-state, context or source-data changes, native CVD and Open Interest still rebuild bounded outputs over up to 5,000 host candles. The forming-bar fast path skips that work for OHLC-only revisions with an unchanged candle grid and close state; it does not make native projection incremental.
- Browser fixtures and performance wrappers must keep explicit fixture selection. A fixture is never a connectivity fallback.
- The Pi counts report bounded work and cleanup only. They do not establish 60 fps or general hardware performance.

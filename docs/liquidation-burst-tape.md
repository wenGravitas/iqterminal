# Liquidation Burst Tape

This document records the Release 1 burst lifecycle and the dockable Liquidation Ticker presentation. It supplements the [liquidation source and adapter contract](liquidations.md) and [Release 1 implementation notes](liquidations-release1.md).

## Lifecycle and bounds

The worker keeps a stable burst ID while same-side reports continue inside the configured rolling window. One shared service cadence advances quiet checks; a burst becomes completed only when selected-source coverage verifies the full quiet interval. A gap or disconnected/stale source leaves the interval uncertain. Historical replay evaluates only through its `asOf` time and never sends live alerts.

Each burst accumulates full-lifetime priced count, reported notional, venue totals and time-bucketed activity independently of the retained constituent list. Activity starts with 1-second UTC buckets and doubles the bucket width when needed to stay within 128 buckets. The detector retains up to 500 most recently accepted constituent reports per burst; a batch carries the 50 most recently accepted. Accepted late reports append in arrival order, so this bounded subset is not guaranteed to be the latest by exchange timestamp. The service's 500 ordinary-report payload budget is independent of its 32 completed-summary slots. The tape renders a 100-row window across reports and completed summaries, with one focused offscreen row retained when necessary.

The pinned section shows at most one active LONG and one active SHORT burst. Completed bursts appear once in the same scrolling tape as individual reports, ordered by final report time and burst ID for ties. Summary rows do not add notional or generate alerts. The burst background uses a fixed $10 million USDT reference; each row does not rescale when another burst changes. Individual-report bars keep their own report scale.

Duration is the interval from the first to the last report, without the quiet wait. Average rate uses the full millisecond duration; a span shorter than one second has no average. Activity-bar heights are normalized to the burst's own peak and are not comparable as absolute volume between bursts. Missing histogram fields remain unavailable. Unknown report values are excluded from priced totals rather than counted as zero.

`Show bursts in tape` defaults on and persists with ticker settings. Hiding the summaries is a presentation choice: the worker detector and alert rules continue. Pausing freezes the displayed tape, summaries, activity and clock while ingestion continues; resume does not replay notifications. Chart focus anchors one report time, not the full burst range.

## Source limits

Bybit totals use bankruptcy price multiplied by reported size; they are not execution proceeds. Binance publishes sampled cumulative snapshots that may overlap. Aggregates are reported activity, not verified unique liquidation volume. Coverage evidence lists source verification and gaps, but a quiet source does not prove that no liquidations occurred.

## Browser evidence

The browser acceptance includes two distinct explicit development fixtures. The worker-flow scenario sends synthetic reports through the dedicated feed worker and checks a fresh alert, same-ID continuation, paused snapshot, and consumer teardown. The presentation scenario injects a deterministic UI-only snapshot for both sides, a completed summary, multi-bucket shapes and representative multi-million totals. Neither fixture is a live venue check.

The focused engine/service command `pnpm exec vitest run tests/liquidations-engine.test.ts tests/liquidations-service.test.ts` passed **25/25 tests**. Final scoped local gates passed **76 tests across 10 Vitest files**, typecheck, and production build (the existing large-chunk warning remains). Seven unique Playwright scenarios passed: four existing liquidation regressions plus the final worker-flow, deterministic presentation, and coverage-now workflows. The focused browser checks cover scale independence, legacy histogram fallback, persisted show/hide behavior, the colored four-bucket hover histogram, and narrow-card bounds.

An earlier regression run used two stale pane-status strings after the user-facing coverage copy had changed; the assertions now check the current readable delay and missing-report messages, and the final coverage scenario passed. Vite printed ResizeObserver loop notices during browser runs; the final browser checks had no failed assertions. This acceptance did not perform a live production observation or run the full unfiltered terminal browser suite; all presented burst totals and captures remain explicit fixtures.

Measured Dockview panel widths were **316 px** for the 320 px target and **496 px** for the 500 px target. Fixture captures cover 1366×768 at the 316 px and 496 px dock widths, plus 720×860 at 316 px. Dark and Ivory captures and the explicit hover-card capture are linked below:

- [1366×768, 316 px dock, Dark](../artifacts/liquidations/burst-tape-presentation-fixture-1366x768-320px-dock-dark.png)
- [1366×768, 316 px dock, Ivory](../artifacts/liquidations/burst-tape-presentation-fixture-1366x768-320px-dock-light.png)
- [1366×768, 496 px dock, Dark](../artifacts/liquidations/burst-tape-presentation-fixture-1366x768-500px-dock-dark.png)
- [720×860, 316 px dock, Dark](../artifacts/liquidations/burst-tape-presentation-fixture-720x860-320px-dock-dark.png)
- [720×860, 316 px dock, Ivory](../artifacts/liquidations/burst-tape-presentation-fixture-720x860-320px-dock-light.png)
- [320 px dock hover card, Dark](../artifacts/liquidations/burst-tape-presentation-fixture-1366x768-320px-dock-hover-dark.png)

The screenshots show explicit deterministic browser fixtures, not exchange activity, production acceptance or platform-performance measurements.

The focused browser run used a Raspberry Pi 5 Model B Rev 1.0 (`aarch64`) with Chromium 155 and SwiftShader, under Node 22.19 and pnpm 10.18.1. These captures record layout only; they are not frame-rate or rendering-performance measurements.

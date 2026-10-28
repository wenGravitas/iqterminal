# Trade Bubbles Release 1

Add **Trade Bubbles** from a candle chart's **Indicators → Order Flow** catalogue. It is a chart overlay with settings, visibility and removal in the existing indicator list and Object Tree. It does not require a Trade Ticker panel.

## Sources and price alignment

Release 1 consumes Binance BTCUSDT Spot and Binance BTCUSDT USD-M perpetual aggregate trades. **Follow chart market** selects the matching Binance market. **Choose explicit sources** lets the user select Spot, USD-M Perp, or both; **Both Binance sources** subscribes to Spot and USD-M Perp together.

Trade prices are aligned only on Binance BTC/USDT charts. Hyperliquid's BTC/USD price is not converted to USDT. Follow-chart mode reports unavailable on Hyperliquid, and explicit Binance sources report incompatibility there. No FX rate or estimated conversion is used.

The worker's `TradeBubbleService` subscribes to the existing Spot and USD-M `BinanceFootprintService` execution consumers. It does not open a second exchange connection per chart, derive trades from ticker rows, or query `iqterminal-server`; companion-server endpoints are outside this release. The shared execution feed retains Binance's aggregate-print grouping and exchange trade-ID range. An aggregate print is not represented as an individual order.

Collection starts when an indicator is added or a compatible source is selected. The feature does not request history or backfill. Connection gaps and dropped transport records remain visible in status/diagnostics; a retained chart overlay is a bounded live session, not a complete tape.

## Filters, tiers, and appearance

Settings include an independent minimum of **100,000 USDT** (or higher), aggressor side, tier, colour source, radius range, notional cap, opacity, label mode, and maximum visible bubbles. Exact exchange quote-notional text is used where present; price × quantity is the fallback. Buy and sell filters use the normalized aggressor side. Unknown side remains included only with **Both sides** and is drawn in neutral grey.

The tier ladder is an independent copy. Choose a Trade Ticker panel and **Copy tier snapshot** to copy its ladder and colours; later ticker edits do not change this chart's settings. Tiers can also be edited directly. The minimum display notional is separate from the tier thresholds.

Bubble disk area scales linearly with notional between the display minimum and configured cap. Dense views keep the largest exact executions by notional up to the visible limit; they do not merge trades or alter the retained tape. Overlapping bubbles remain separate, and hit testing selects one exact execution while showing the overlap count.

Hovering a visible bubble shows UTC execution time, Binance market, aggressor side, BTC quantity, USDT price/notional, tier, aggregate execution/trade IDs, and overlap count. Labels can show tier, notional, both, or be off.

## Bounds and lifecycle

| Resource | Limit / policy |
|---|---|
| Binance source subscriptions | At most one bubble-service consumer per Spot or USD-M feed, shared across charts |
| Shared execution cache and dedup IDs | 8,192 per source |
| Retained executions | 2,048 per chart subscriber |
| Pending transport records | 256 per subscriber; one acknowledged batch in flight |
| Visible bubbles | 120 by default; configurable up to 500 |
| Publication cadence | Worker batches at a nominal 100 ms; batches are bounded and acknowledged |

Hiding the indicator or chart suppresses painting while collection continues. A chart interval change does not restart an unchanged source subscription. Changing source configuration updates the chart's subscription and clears its old rendered records. Removing the indicator or closing its chart releases its subscription and renderer. The feed subscription ID includes the chart panel ID so equal native indicator IDs in different charts cannot replace one another.

Saved workspace state contains validated versioned settings only, not execution history. A copied Trade Ticker tier ladder is a local snapshot. Explicit fixtures are accepted only when diagnostics/fixture mode is selected in a development or diagnostic build; fixture mode is not used as a live-connectivity fallback.

## Verification

Deterministic model, service, and renderer coverage lives in `tests/trade-bubbles.test.ts`, `tests/trade-bubbles-service.test.ts`, and `tests/trade-bubbles-chart.test.ts`. `tests/browser/trade-bubbles.spec.ts` covers two independent Binance charts with different thresholds, the combined heatmap/walls/footprint view, tooltip provenance, hide/remove, paused/closed ticker independence, timeframe changes, source changes, and explicit Hyperliquid incompatibility. Fixture browser coverage does not certify live venue availability.

The gated `tests/browser/trade-bubbles-performance.spec.ts` records requestAnimationFrame intervals and primitive retained/painted/culled counts with a deterministic 5,000-bar chart and 2,048 injected records. Its measurements describe the local browser and renderer only; they are not a 60 fps guarantee or a result for another host. Run it with:

```sh
VITE_DIAGNOSTICS=1 pnpm build
IQ_TRADE_BUBBLES_PERF=1 pnpm exec playwright test tests/browser/trade-bubbles-performance.spec.ts --reporter=list
```

The output artifact is `artifacts/trade-bubbles-performance.json` and records the browser/runtime metadata with baseline and enabled measurements. `pnpm build` also performs the production TypeScript check. No live venue or companion-server acceptance is implied by fixture verification.

One local run on a Raspberry Pi 5 Model B Rev 1.0, headless Chromium 155, and a 1600 × 1000 viewport recorded 161 baseline RAF intervals (p50 16.7 ms, p95 133.2 ms, maximum 233.3 ms) and 148 intervals with bubbles enabled (p50 16.7 ms, p95 199.9 ms, maximum 316.7 ms). The enabled primitive retained 2,048 records, painted 120, culled 1,928, and had 39 draws during the input probe. This is a Pi 5 headless-browser fixture observation, not live-feed or desktop V3D acceptance. The long RAF tails do not establish a frame-rate target; see the JSON artifact for the full run record.

# Order-book heatmap

In explicit staging data mode, Binance USD-M uses durable backend historical/liquidity data. See [staging market data](staging-market-data.md#durable-order-book-heatmap). The session-only implementation below remains the ordinary direct-mode contract.

Add **Order-book Heatmap** through **Indicators** on either ordinary candles or Footprint; its active-list settings action opens the controls. Initially only **Binance BTCUSDT USD-M Perp** is supported. Spot and Hyperliquid remain usable ordinary charts and explicitly report the unavailable layer. This is resting BTC liquidity, not executed footprint volume. Depth changes alone cannot distinguish cancellation from execution.

Collection starts on enable, uses browser-session memory, and clears on reload or removal of the last consumer of that resolution. Interval switches select a separate candle-aligned collection; settings and enabled state persist with the layout. In Footprint mode, Footprint settings’ Price level controls both layers. The heatmap uses the same fixed lower-bound price grid and row height as executed footprint cells; its separate row control is read-only. Candle mode retains its independent heatmap row setting. Switching modes can change the effective collection resolution and therefore start fresh collection unless another consumer already retains that grid. Changes to row width or chart timeframe start a new configuration unless another consumer already retains that exact configuration. Visual changes preserve collection and viewport. Earlier candles have no implied book history.

## Data and coverage

The feed worker shares the existing synchronized Binance diff-depth book with OpenScript depth studies. There is one `/public/ws/btcusdt@depth@100ms` socket and one 1,000-level snapshot per synchronization attempt, independent of the number of studies or heatmaps. Consumers are reference counted independently. Tick size is obtained from validated Binance exchange metadata; no guessed tick fallback is used. Absolute quantities replace levels and zero deletes them. Snapshot bridging uses `U <= lastUpdateId <= u`; subsequent diffs require `pu` equal to the preceding `u`. Sequence gaps, reconnects and more than five seconds of silence invalidate collection until synchronization succeeds. See [Binance's official synchronization rules](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly).

Rows use integer tick-grid grouping, with bounds `[low, high)`. Both chart types use fixed lower-bound grids. A $25 bucket starting at $82,800 covers [$82,800.00, $82,825.00); a level exactly at $82,825 enters the next bucket. Footprint executions use the same integer-tick grouping. The chart adapter converts lower bounds to OpenAlgo cell centres only for rendering. Boundary trades and book levels enter the same row; the two quantities remain distinct resting versus executed measures. Simultaneous price levels are summed in BTC, separately for bids and asks. Piecewise-constant book state is integrated over **host-observed UTC receipt milliseconds**, including irregular update spacing. A repeatedly observed 20 BTC wall remains 20 BTC. Average quantity is integrated BTC-milliseconds divided by observed duration; peak is the maximum simultaneous quantity observed through this supplied stream, not a guaranteed intraupdate maximum. Same-millisecond observations still contribute peaks. Buffered snapshot states are not projected backward before collection starts.

The original outer snapshot prices remain conservative coverage boundaries for each synchronization epoch. Interior empty rows are known zero; outside prices are unknown. Edge rows, clipped coarse rows and capacity-limited data are incomplete subtotals and are marked as such. Outages create separate raw epochs with no observations during the gap. Entire unobserved candle intervals have no column; interrupted intervals have incomplete columns. Missing durations never contribute zero quantity or stale walls to an average. A delayed worker timer extrapolates at most five seconds, then leaves a gap.

## Rendering and interpretation

The repo-owned Canvas2D `OrderBookHeatmap` uses OpenAlgo Charts 2.6.0's public primitive interface: bottom z-order, null autoscale contribution, host update requests, rendering context and non-draggable hit testing. It stays behind candles and footprint cells. The library and dependency licence set are unchanged; no upstream files are patched.

Each actual host candle has exactly one heatmap column, anchored to its logical slot (`index - 0.5` through `index + 0.5`); in both chart modes it fills the entire time slot, independent of the narrower footprint ladder and candle spacing. The first observation paints the full forming-candle column; subsequent observations update its quantity without moving its edges. This is a display slot, not a projection of the book into the future: hover retains the actual observed time span and labels partial intervals. A missing host interval has no slot and is not painted into an unrelated bar. No synthetic time-axis bars are inserted. Changing timeframe starts a new collection unless another consumer already retains that price/timeframe configuration; unavailable earlier observations remain unknown. Time-scale spacing, manual price scaling and the existing visible-panel scheduler are retained.

LOD uses screen-space geometry: readable cells show quantity-only labels fitted to their height and width (9–12px, with padding); smaller cells omit text; distant Candle views omit labels and combine power-of-two price rows into horizontal bands while retaining candle-aligned column boundaries. Footprint views keep the exact footprint price rows at every zoom level, omitting labels when space is insufficient. Adjacent heatmap time slots meet without horizontal padding, so uninterrupted walls remain continuous while footprint candles retain their separate spacing. The worker integrates each depth observation directly into its UTC candle aggregate, splitting at candle boundaries. Only the forming candle changes; completed candles retain their quantities and peaks. Quantities are aggregated before colour lookup. Time averages divide by retained observed duration, excluding gaps; price quantities sum simultaneous rows. Multiple synchronization epochs within one candle share its column but mark it incomplete. Retention evicts whole candle columns, including all reconnect epochs, so expiry cannot recalculate a closed candle from a shrinking subset. Collection starting mid-candle still labels that interval partial. Worker-maintained coarse peaks preserve simultaneous sums rather than adding unrelated per-row maxima. A visible one-sided row fills its entire height. When both bid and ask quantities pass the minimum filter in one row, they occupy separate upper/lower halves; hover uses the same visible-side rule. Hover gives actual time and price bounds, side, BTC quantity, average/peak mode and incomplete coverage.

A fixed ordered purple/blue/teal/green/yellow palette uses logarithmic **BTC per $10 price width**, so a wider price bin does not automatically look like a stronger wall. Hover reports the actual aggregated BTC quantity, not this normalized density. Defaults are $10 rows, chart-aligned time columns, average mode, 85% opacity (15% transparency), fixed intensity 100 BTC/$10, minimum 0.01 BTC and Auto labels. Scaling never adapts merely because the viewport changes. A bounded price-projection cache reuses unchanged tile revisions during pan/time zoom (one factor per retained tile, at most 240 entries and 16,384 projected rows); cached geometry rebuilds when data or viewport changes; hidden panels retain data without painting. Captured depth does not expand price autoscale.

## Limits and transport

Each of at most four active resolutions retains at most 240 buckets, 128 captured rows per bucket, 16,384 cells and 2 MiB of accounted typed payload plus bucket metadata. Each retained bucket covers one chart candle and synchronization epoch. The maximum is 240 candles without reconnects; dense configurations and multiple epochs evict sooner under the cell/byte bounds. Closed candles expire as whole columns. Row capture is centered within the snapshot boundaries; clipping is explicitly capacity-limited. These are cache bounds, not hard total browser-process heap bounds. Shared pending snapshots and each chart's bounded index/cache also consume memory; geometry and canvas allocations remain browser owned.

The source book is additionally limited to 10,000 levels per side, with at most 512 buffered diff events and 20,000 buffered level updates; exceeding limits forces resynchronization. Publication is 2 Hz, independent of rendering FPS. Each resolution allows one unacknowledged envelope, coalescing replacement revisions into a bounded pending map. A joining consumer receives current retained state; stale generations and acknowledgements are rejected. Removing the final resolution stops the timer and book observer; an independent depth study can keep the source alive. Diagnostic counters expose configurations, consumers, publications, CPU time, retained cells/bytes, evictions, pending batches, geometry rebuilds and render p95.

The canonical v2 session tile is independent of OpenAlgo: UTC start/end, epoch, row width, lower-bound grid offset (zero for current fixed buckets), revision, incomplete flag, packed Float64 rows (price low; bid/ask BTC-ms; bid/ask observed peaks; bid/ask observed and complete durations; bid/ask USDT-ms and USDT peaks), plus bounded power-of-two simultaneous peaks. Future durable storage needs explicit instrument/session identities, versioned serialization and a recording service; this milestone creates none.

## Reproduction

```sh
pnpm typecheck
pnpm test
VITE_DIAGNOSTICS=1 pnpm build
pnpm preview --port 4173
pnpm test:browser
node scripts/bench-heatmap-collector.mjs
TERMINAL_URL=http://127.0.0.1:4173 node scripts/bench-heatmap-browser.mjs
```

Browser depth fixtures are confined to explicit test transport and diagnostic checks. Normal builds never substitute synthetic liquidity. For the genuine public-feed check, build without `VITE_DIAGNOSTICS`, serve it separately and run `TERMINAL_URL=<ordinary-preview> node scripts/live-heatmap.mjs`. See [verification results](verification.md#order-book-heatmap) for measured Pi performance, browser limitations and live evidence.

Opacity accepts 0–1 in Heatmap settings (0.85 means 85%). Existing explicit saved values remain unchanged. Footprint cell opacity is independently configured as a percentage in its display settings; changing either visual setting preserves collection, subscription identity and viewport.

Heatmap labels and hover follow the chart BTC/USDT unit toggle. USDT values are
sums of actual level price × resting base quantity, duration-weighted for Average
and independently observed for Peak, including simultaneous coarse-row peaks.
Cell labels use OpenAlgo's compact K/M formatter, matching footprint values.
Switching units preserves collection, coverage and viewport. Colour scaling and
minimum filters remain in BTC so changing display units does not recolour history.
Tiles use 13 Float64 fields per cell and 6 per coarse peak entry; the existing
2 MiB byte ceiling remains enforced, so larger tiles can evict history sooner.

Presentation uses a muted purple-to-teal-to-olive background palette in Dark and pale corresponding tints in Ivory. Fixed quantity-density scaling still determines wall strength; palette refinement does not alter measurements or saved opacity. Heatmap labels stay at most 12px while footprint figures can grow to 24px. Occupied footprint price rows suppress the entire heatmap cell, including its background, coverage hatch, label and hover target across the central candle gutter. Collected liquidity is retained and appears again when Footprint is hidden or removed. The diagonal hatch continues to mark incomplete coverage; hover explains the subtotal.

Quantity labels use soft cool-grey text in Dark and slate text in Ivory, maintaining separation from the brighter footprint figures. Font size and exact hover values remain unchanged.

### Outer liquidity visibility

Liquidity contrast defaults to **Enhanced**, including layouts saved before this
setting existed. Its fixed square-root transfer curve lifts weak BTC-per-$10
signals using a clearer purple/teal/olive palette. Partial outer-book cells retain
80% of the selected opacity and their coverage hatch instead of the previous 55%
dimming. Unknown cells and known zero quantities remain unpainted; hover still
identifies incomplete/unknown subtotals. This changes colour only: recorded
quantities, quote notionals, aggregation, minimum filter and coverage remain intact.
The previous palette, transfer curve and partial dimming remain available under
**Order-book Heatmap settings → Liquidity contrast → Muted (previous)**.
Neither mode normalizes against the visible viewport. Changing contrast preserves
collection and recorded history. Full intensity remains a fixed BTC-per-$10 scale.

`node scripts/verify-outer-visibility.mjs` compares both modes on the same actual
staging observations through the Pi's private dev proxy and verifies unchanged
quantities/coverage. It temporarily holds the test page's displayed tiles for two
screenshots; production collection continues normally.

Verified on the actual staging path: 275 positive outer cells across
$71,800–$94,200, all explicitly partial. Enhanced/Muted comparisons retained
identical quantities, notionals and coverage; dark desktop and compact screenshots
are in `artifacts/outer-liquidity-*-live*.png`, with measurements in
`artifacts/outer-liquidity-live.json`. Automated validation: 202 client unit tests,
two heatmap browser cases, and staging typecheck/build passed. These are visibility
checks, not proof of complete whole-book coverage or frame-rate acceptance.

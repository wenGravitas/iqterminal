# Session footprints

Footprints use executed trades collected in this browser session. Native exchange candles remain the input to OpenScript studies, including when the chart displays a footprint. Consequently, a study can include earlier candle history while the footprint’s first candle contains only the executions observed since collection began. Footprints do not reconstruct or split historical OHLCV.

## Using the chart

Select **Binance · BTCUSDT USD-M Perp**, then add **Footprint** through **Indicators**. Before the first accepted execution the panel says “Collecting live trades…”. The **Price level (USDT)** control in Footprint settings sets quote-price width directly, defaults to **$25**, and displays a `$` prefix. The worker aligns the value to the tick size fetched from Binance `PRICE_FILTER`; an off-grid width is rejected with the current tick size shown. Changing interval or price level starts fresh collection unless another panel already retains that exact configuration; it does not recover earlier trades.

The **Footprint volume units** setting switches cell quantities, volume totals, delta and hover readouts between base BTC and quote USDT notional. USDT is the sum of each accepted execution’s actual price × quantity, not row-centre price × aggregated quantity. Prices remain in USDT in either mode. This display-only choice is saved per panel and preserves collection, subscriptions and viewport; legacy layouts default to BTC. Older development fixtures without notional fields report unavailable instead of approximating them.

The Footprint row’s settings action opens display settings: bid × ask, delta or total-volume cells; ladder or profile presentation; point-of-control outline; diagonal imbalance highlighting; optional stacked brackets; dominance ratio and minimum dominant BTC volume. Display changes keep collected data and the viewport. The imbalance minimum remains configured in BTC. OpenAlgo accepts a single threshold in display units, so USDT mode converts that threshold using the latest execution close; this threshold conversion is approximate, while displayed notionals are actual execution sums. Default presentation includes a slim execution-price candle, bid/ask cells, POC outline, volume and delta. Latest, Home and double-click return to a readable live-edge view. Hover a cell for its exact row price and bid/ask quantities. OpenAlgo suppresses cell labels when zoom or row height leaves insufficient space; the exact hover readout remains available.

Narrow panels expose a directional scroll button when toolbar controls overflow. The Footprint readout places hovered row quantities before bar totals and separates them onto compact lines. Latest restores 80-pixel columns with one column of future margin; manually panned views remain stable during live collection.

The readout derives quantities and delta from the current retained worker bar, rather than the primitive's asynchronously rendered statistics. A forming-bar revision updates a stationary hover for that same bar; a hovered historical bar stays selected while other bars update. Eviction or an instrument/interval change releases obsolete hover data.

Candles remain selectable on every supported market. Binance Spot and Hyperliquid show that Footprint is currently USD-M-only. Existing saved layouts default to Candles; a new layout saves chart type, interval, USDT price level, display settings and study attachments, never collected execution history. Older saved tick presets are migrated using the former BTCUSDT $0.10 tick grid; the old default of 10 ticks becomes the new $25 default.

## Source and classification

The initial execution adapter supports Binance BTCUSDT USD-M linear perpetual: base BTC, quote/collateral USDT. Binance Spot and Hyperliquid remain available for ordinary candles. Their execution adapters are not implemented in this milestone.

The official [aggregate-trade stream documentation](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market#aggregate-trade-streams) describes the raw endpoint `wss://fstream.binance.com/market/ws/btcusdt@aggTrade`. Binance combines fills with the same price and taker side into aggregate messages delivered at 100 ms cadence. The adapter uses execution time `T`, price `p`, quantity `q`, and aggregate ID `a`. It does not replace quantity with `nq`, which excludes RPI volume. `m=true` means the buyer is maker, so the aggressor is a seller and quantity contributes to bid volume; `m=false` contributes to ask volume. Aggregate IDs and first/last constituent execution IDs are independent sequences. Insurance-fund and ADL trades are excluded by this upstream stream.

The actual tick size comes from `PRICE_FILTER.tickSize` in [exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), not `pricePrecision`. BTCUSDT reported `0.10` during verification. Collection waits for validated instrument metadata; there is no guessed tick-size fallback.

The normalized execution contract is independent of OpenAlgo:

| Field | Meaning |
|---|---|
| venue, market, nativeSymbol | Canonical instrument identity |
| executionId | Venue-scoped unique observation identity |
| timeMs | Exchange execution time, UTC milliseconds |
| eventTimeMs | Exchange event time, UTC milliseconds |
| price, quantity | Actual execution price and base quantity |
| side | Aggressive buy, aggressive sell, or unknown |
| granularity | Individual execution or aggregate trade |

Unknown-side observations must not contribute to bid or ask totals. Binance messages with malformed maker flags are rejected. Retained counters describe aggregate observations, never individual trade count. Minimum and maximum running delta describe the received aggregate-message path; they are not exact constituent-fill extrema.

## Aggregation and bounded ownership

The feed worker owns one reference-counted Binance execution connection. Consumers with the same instrument, interval and normalized USDT price level share an accumulator. After exchange metadata validation, the worker derives the exact integer tick count for the requested width; it never rounds an off-grid width. UTC interval boundaries use execution timestamps; renderer bar timestamps are explicitly converted to seconds. Price rows floor integer tick indices to fixed width multiples, avoiding fragmented floating-point keys. Canonical cell prices are inclusive lower bounds; the upper bound is lower + rowSize, exclusive. For $25, $82,800.00 through prices below $82,825.00 share one row, and $82,825.00 starts the next. The chart adapter adds half the row width to position OpenAlgo 2.6.0 cells at their centres, translates hover back to lower bounds, and draws execution pulses over the same bounds. Execution OHLC uses actual execution prices, not row centres.

Bid volume sums aggressive sell base quantity. Ask volume sums aggressive buy base quantity. Volume is their sum and delta is ask minus bid. Cells also retain `bidNotional` and `askNotional`; bars retain `quoteDelta`, `minQuoteDelta` and `maxQuoteDelta`. These fields are optional only for compatibility with older explicit development fixtures; production accumulation emits them. Quote delta extrema describe the same aggregate-message path as base delta extrema. The adapter projects these canonical fields into selected display units without changing supporting OHLC or native candle inputs. Each update is a replacement bar snapshot with a monotonically increasing revision, not an additive patch. Dirty snapshots are batched at approximately 100 ms cadence.

The transport permits one unacknowledged envelope per configuration. It coalesces later updates into one latest replacement per retained bar and one latest status; a requested snapshot replaces that pending map. The client acknowledges after data callbacks, including obsolete subscriptions and removed consumers, independently of painting. Configuration-generation and batch IDs reject stale acknowledgements. Hidden charts therefore continue collection without growing a browser message queue. Closing a configuration releases its pending and in-flight state. These bounds cover Footprint messages; they are not a claim that the browser process has a hard memory quota.

The default per-configuration bounds are 300 bars, 18,000 cells in total, and 512 cells in one bar. Smaller accumulator limits can be supplied by the service; these defaults are hard upper limits. Whole oldest bars are evicted when retained-history limits are reached. If the current bar alone exhausts its cell budget, rejected observations are counted and the bar is marked capacity-limited. Eight configurations bound the default retained worker cells to at most 144,000. Pending ordering state is capped at 2,048 observations and recent duplicate IDs at 8,192. The application does not retain an unlimited raw execution tape.

A bounded timestamp-ordering window handles reordered observations within each publish batch. Duplicates are ignored. Observations older than the committed timestamp watermark, or behind the expired-ID floor, are discarded and diagnosed; retained affected bars receive uncertain-coverage metadata. This is not historical backfill or an unlimited reorder queue.

The maximum accepted width is $10,000 USDT. The default $25 width is 250 ticks at the BTCUSDT tick size of $0.10; the worker derives this count from live metadata rather than assuming that tick size. Both the width and internal tick count are retained in diagnostics.

Automatic price scaling caps footprint rows at roughly 16 CSS pixels high, so a newly collected single row fits its quantities instead of stretching across the pane. A small adapter primitive contributes a minimum price span through OpenAlgo's supported autoscale API; execution OHLC and quantities remain unchanged. Manual price scaling can enlarge rows, and Latest restores automatic scaling.

Rows contain executed volume at the same aggregated price: bid means aggressive selling and ask means aggressive buying. They are not current resting bid/ask quotes. Both sides can share one row even at a $1 width; for example, executions at $83,000.1 and $83,000.2 belong to the $83,000 row on this lower-bound grid. Only observed executions in another bucket create another row. The dashed last-price line and axis tag follow the exact latest execution close, independently of the bucket centre, so within-row auction moves remain visible.

Live bid-volume increases briefly outline and tint the bid half-cell red; ask-volume increases highlight the ask half-cell green. The 360 ms fade follows published execution batches, not individual fills. It does not animate historical snapshots, hidden charts or reduced-motion sessions. Delta/total-volume modes highlight the whole row because they have no bid/ask half-columns. Feedback is bounded to 64 active side/row highlights and repaints only the overlay through the shared scheduler.

Matching configurations share collection. A new interval or row size starts a new collection unless another consumer already retains that exact configuration. Visual settings do not change aggregation. Hidden panels continue bounded collection while their chart rendering is suspended. Closing the last consumer releases that configuration; closing all footprint consumers releases the execution connection. Reloading clears collected execution history and retains only saved settings.

## Coverage

The first collected bar is partial. Connection interruptions mark affected coverage and the first later observed bar carries gap metadata where needed. No synthetic zero-volume bars are inserted. A healthy interval with no observed executions differs from an unobserved interval during an outage, even though neither supplies a fabricated footprint bar. Session collection start and connection state remain visible in the panel. The crosshair/readout identifies the matching bar’s partial, observed, gapped or capacity-limited coverage and any gap before it; it is not just a global connection label.

Observed means accepted stream observations under the connection’s coverage rules. It does not promise every exchange fill, fills excluded by Binance, execution history before subscription, or exact intrafill delta extrema. Reconnects preserve retained bars, deduplicate overlaps within bounded state, and resume live collection without a REST trade-history backfill.

Fifteen seconds without a valid observation also marks the stream stale and coverage uncertain, even if the browser still reports an open socket. Silence cannot prove whether trades were missed or the market was quiet; this conservative marker is not a claim of a confirmed exchange outage. Neither case inserts zero-volume candles.

## Installed rendering API and measurements

The application retains `openalgo-charts@2.6.0`. Its installed `openalgo-charts/profile` exports `Footprint` and `FootprintAggregator`. The primitive provides `setBars`, `setOptions` and `hoverAt`, with bid/ask, delta, volume, ladder and profile options. The canonical worker model does not import these types. The chart adapter converts replacement snapshots at the rendering boundary and uses supporting execution-derived OHLC for time-axis alignment and price scaling.

The installed aggregator snapshots and sorts all current cells on each tick; `Footprint.setBars()` also clones and sorts supplied bars and cells. A small worker accumulator therefore maintains mutable integer-grid state and creates immutable renderer snapshots only at batch boundaries. The adapter limits primitive data to the visible slice plus neighbouring bars while retaining the bounded supporting OHLC timeline. No upstream source patch or additional chart dependency is required.

On the Raspberry Pi 5 verification host, an isolated `setBars()` test with 300 bars and 36,000 cells took 12.08 ms median and 17.26 ms p95 across 100 calls ([API measurement](../artifacts/footprint-upstream-api-cost.json)). This deliberately oversized input exceeds the application's 18,000-cell configuration cap and excludes drawing. It demonstrates why sending the entire history every execution would be costly; it is not the measured cost of the adapter's bounded visible slice. The separate realistic-row accumulator comparison processed 20,000 observations in 744.68 ms through upstream per-tick snapshots versus 8.03 ms through one custom batch snapshot. Those snapshot cadences differ intentionally; neither timing measures browser frame rate.

Run the explicit synthetic CPU benchmark with:

```sh
node --expose-gc scripts/bench-footprint-accumulator.mjs
```

It verifies equivalent ordered input against the installed upstream aggregator (OHLC, delta extrema and every bid/ask row within `1e-8`), then exercises 1, 2 and 8 configurations with pre-populated retained history at 1,000 and 10,000 synthetic observations/second. Results are in [performance-footprint-accumulator.json](../artifacts/performance-footprint-accumulator.json). These CPU batch timings exclude worker messaging, browser painting and display-compositor cost. Post-GC heap changes can be negative because retention evicts old cells; they are not a total-process memory bound. Browser and live integration results belong in [verification.md](verification.md).

For the full browser path, build with `VITE_DIAGNOSTICS=1 pnpm build`, serve that build, then run `TERMINAL_URL=http://127.0.0.1:4173 node scripts/bench-footprint-browser.mjs`. The harness explicitly selects fixture mode and installs its synthetic aggregate-trade transport only inside its own browser worker. It exercises parsing, aggregation, acknowledged IPC, client delivery, adapter updates and visible Canvas2D rendering; it does not verify exchange connectivity. The published browser/performance artifacts predate the direct USDT price-level control; the runnable harness now maps its legacy price widths to USDT so future runs preserve that workload, and these older figures do not measure the new $25 default. An ordinary build must instead be used for `TERMINAL_URL=http://127.0.0.1:4173 node scripts/live-footprint.mjs`, which observes real Binance messages and reconciles execution OHLC, bid/ask volume and delta.

The profile module is part of the already-shipped Apache-2.0 chart package; existing licence and NOTICE attribution remains applicable. No upstream files are modified. Footprint-specific OpenScript access, other venue adapters and durable/shared history are later milestones.

### Cell presentation

Footprint display settings includes Cell opacity (%) with an 85% default (15% transparency). It affects executed cell backgrounds, while quantity text, candle marks and statistics remain opaque. Bid/ask text automatically fits row height and available width between 9px and 24px, with semibold text in readable cells; compact statistics keep their original typography. These are visual settings and preserve execution data and viewport. The heatmap has its own independent opacity control.

The slim execution candle sits in a central 12–24px gutter between Bid and Ask at readable zoom levels. It uses actual execution OHLC, not row bounds. Its body grows up to 8px, with a 1px wick; Show slim candle hides it without changing observed volume.

Footprint and heatmap columns occupy 84% of each bar slot, leaving a consistent horizontal gap between candles. **Show VAH and VAL** in Footprint settings defaults on (including older saved layouts). Dotted lines span each candle’s column at the outer boundaries of OpenAlgo’s contiguous 70% executed-volume value area around its POC. They use only observed session executions; partial or gapped bars remain incomplete. This visual setting preserves collection and viewport.

POC uses a thin white outline, up to 1px. Bid/ask execution flashes use brighter side colours and a 2px border with a slower fade inside the same bounded 360ms animation. Narrow rows reduce border thickness to preserve their figures; reduced-motion handling and the pulse cap remain unchanged.

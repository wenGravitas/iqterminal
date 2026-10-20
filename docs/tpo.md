# UTC TPO Profile

The native UTC TPO indicator builds a separate profile for each UTC calendar day from one-minute OHLC candles. Its worker-side model is keyed by venue, market, symbol, one-minute aggregation, and the calculation settings that affect rows and levels. Changing the chart timeframe or the display timezone does not change a profile's UTC boundaries. Display-only controls update the renderer without reloading history; calculation controls rebuild profiles from the already loaded one-minute set.

## Profile calculation

The model uses one-minute OHLC candles, not trade prints. Within each bracket it aggregates the minimum low and maximum high, then treats every tick between those bounds as touched for that bracket. This is an OHLC range-derived approximation: it does not reveal the path between prices, represent volume, or guarantee tick-exact trade activity. Brackets are 15, 30, or 60 minutes long, giving 96, 48, or 24 brackets per UTC day. Candle lows are rounded down and highs up to the configured exchange tick size. A row contains the distinct brackets whose aggregated range overlaps that row; `TPO count` is the number of those brackets, not the number of candles or trades.

Automatic row size is `ceil(tick span / 96)` exchange ticks, with a minimum of one tick. Row bins are anchored at zero using `floor(tick / rowTicks) * rowTicks`. A positive manual row size is the requested ticks per row. To bound memory, the engine caps a profile at 2,048 rows; if needed it raises the effective row size to at least `ceil(tick span / 2,048)`. Each session reports requested and effective row sizes and whether this capacity limit changed the effective size.

The POC is the row with the most TPOs. Ties prefer the row nearest the session's price midpoint, then the lower row. Value area starts at the POC and expands one adjacent row at a time, preferring the larger neighboring count and the lower row on an equal count, until it reaches the configured percentage. The current session remains developing until all 1,440 one-minute intervals are covered. Missing intervals are counted explicitly and prevent a day from being marked complete. The opening range and initial balance are computed from the first configured minutes of the UTC day; the developing initial balance is shown by default, while its half and full range projections are drawn only after the range completes.

Naked POC, VAH, and VAL candidates begin at the origin profile's UTC close. The engine scans later one-minute candles for the first candle whose high-low range spans a candidate. A gap before a touch makes the level unknown because an earlier touch could have occurred in the gap. Tested candidates retain both their first-touch time and the current coverage end: “Stop at first touch” ends the ray there, while “Continue faded” keeps its original full-opacity segment and draws a faded segment through the latest covered minute. Same-price intervals are batched for drawing, while the worker retains each origin level and status.

Letters and blocks both use the actual bracket memberships in each row. When the bracket column is wide enough, letters show the bracket label in its own column; block mode draws a separate compact cell for each bracket. At tighter zoom, the renderer falls back to a row silhouette so cells remain legible. Profiles, ranges, and levels are clipped to the plot rectangle and use CSS-pixel coordinates with the current device-pixel ratio.

## History sources and limits

The worker requests one-minute history from the venue's public candle API. Binance retains a rolling 90 UTC days of history plus the current partial UTC day (at most 91 × 1,440 minute slots). Hyperliquid is capped at its latest 5,000 one-minute candles, and its in-memory coverage rolls forward with that source window. This matches the recent-candle window available to this client; older days are reported as unavailable instead of being filled with fixtures.

After a live-data reconnect, the worker attempts bounded gap repair: up to the most recent seven days for Binance or 5,000 minutes for Hyperliquid. A failed or incomplete repair remains a coverage gap and marks affected naked levels unknown; automatic retries use exponential backoff from one minute up to 15 minutes. Manual Retry forces history requests and resets that backoff.

The worker requests one-minute history from these venue endpoints:

- Binance USD-M perpetual: `https://fapi.binance.com/fapi/v1/klines` (`BTCUSDT`, `1m`, bounded pages of 1,000 candles).
- Binance Spot: `https://data-api.binance.vision/api/v3/klines` (`BTCUSDT`, `1m`, bounded pages of 1,000 candles).
- Hyperliquid perpetual: `https://api.hyperliquid.xyz/info` with `candleSnapshot` (`BTC`, `1m`, day-sized pages).

The request shapes and candle limits follow the [Binance Spot Kline API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data), [Binance USD-M Kline API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data), and [Hyperliquid candle snapshot API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

Each response is shape-checked before use. Binance rows must have candle-array fields that pass the shared OHLC/time validation; Hyperliquid rows must report the requested native coin and `1m` interval and pass the same validation. Pages are filtered to the requested coverage window, sorted by UTC open time, and deduplicated by timestamp. A newer source revision replaces an older candle. Historical corrections and inserted backfill minutes rescan naked levels over retained minute coverage and rebuild affected daily profiles; signature-matching unchanged profiles can be reused from cache.

Minute pages and complete daily profiles are cached separately from depth and footprint data. The dedicated TPO history cache is bounded to 48 MiB. Pages from the most recent three days are requested again on reload; older pages can be reused. Corrections to older history are not discovered automatically unless the live source reports them or the user selects Manual Retry, which forces history requests. A failed refresh may use a valid cached page while the status reports partial coverage. Worker live updates are serialized per source so a delayed cache write cannot emit an older model after a newer candle revision; disposal suppresses pending emissions.

## Local verification

The deterministic engine and service tests cover bracket membership, tie-breaking, row caps, opening range and initial balance coverage, gaps, first-touch naked state, cached-page reuse, live patches, historical revisions, repaired gaps, update ordering, and disposal during a delayed write. The native primitive tests assert actual letter and block canvas operations plus the zoomed-out silhouette fallback. Playwright checks use the explicit diagnostics fixture and cover chart settings, timeframe changes, timezone display preference, venue isolation, multi-day UTC geometry, and DPR 2 plot clipping. These fixture checks do not establish live venue availability or platform performance on other machines.

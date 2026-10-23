# IQ Terminal: Effort–Result / Flow Resistance

## Status and purpose

Implementation proposal, not a validated trading strategy. No repository changes have been made. The thresholds below are engineering starting points, not parameters established by the cited papers. This specification intentionally separates: (a) observed directional effort with little progress; (b) supporting liquidity evidence; and (c) a subsequently observed rejection or breakthrough. None identifies a participant, intent, position opening/closing, or a guaranteed reversal.

Recommended first release: a deterministic, streaming, trade-and-price detector, optional depth evidence, compact chart events, optional signed pane, persisted event history and replay. Keep the expected-impact model as an explicitly experimental diagnostic until its incremental value is demonstrated. Do not make the useful core depend on a regression model being reliable.

## 1. Research basis

- Cont, Kukanov & Stoikov, *The Price Impact of Order Book Events*, Journal of Financial Econometrics 12(1), 2014. Best-quote order-flow imbalance includes order-book changes, not just signed executions. Its explanatory relationship is contemporaneous, not evidence for this detector's future profitability. https://arxiv.org/abs/1011.6402 ; https://academic.oup.com/jfec/article-abstract/12/1/47/816163
- Bouchaud, Kockelkoren & Potters, *Random walks, liquidity molasses and critical response in financial markets*, 2004 preprint / Quantitative Finance 2006. Opposing liquidity response can damp persistent directional trading. https://arxiv.org/abs/cond-mat/0406224
- Xu, Gould & Howison, *Multi-Level Order-Flow Imbalance in a Limit Order Book*, 2019 arXiv version. Deeper book-flow information improved contemporaneous mid-price fit in their equity sample. https://arxiv.org/abs/1907.06230
- Albers, Cucuringu, Howison & Shestopaloff, *Fragmentation, Price Formation, and Cross-Impact in Bitcoin Markets*, 2021 preprint. Cross-venue information and execution costs matter; its subsecond results are not evidence for a 30-second reversal strategy. https://arxiv.org/abs/2108.09750
- Takahashi, *Interaction between Returns and Order Flow Imbalances: Endogeneity, Intraday Variations, and Macroeconomic News Announcements*, 2025 preprint. Feedback and intraday variation caution against treating an impact coefficient as an immutable causal law. https://arxiv.org/html/2508.06788v1
- Dean Markwick, *Order Flow Imbalance — A High Frequency Trading Signal*, 2022. Original worked Bitcoin example, useful especially for the contemporaneous-versus-predictive distinction and cost warning. Treat as an educational implementation, not a verified strategy or source of performance promises. https://dm13450.github.io/2022/02/02/Order-Flow-Imbalance.html
- Bookmap, official *Absorption Indicator* documentation. Existing implementation precedent for separately measuring buy/sell volume at price over time and adaptive thresholds; not independent evidence of profitability. https://bookmap.com/knowledgebase/docs/KB-Indicators-Absorption

## 2. Repository integration points inspected

Read-only inspection of `wenGravitas/iqterminal`, tree SHA `8d82c1b3819aeddc4adbff995e1f72521999d97f`:

- `src/feed/footprint.ts`: `NormalizedExecution`, explicit venue/market/symbol/identity, aggressor side including unknown, individual-versus-aggregate granularity, quantity/notional information; Binance spot and perpetual parsers.
- `src/feed/depth-service.ts`: shared `BinanceDepthService.observeBook(...)`, connection epochs and availability states.
- `src/feed/heatmap-model.ts`: time-integrated liquidity buckets, peaks, observed/complete durations and coverage semantics. These summaries cannot reconstruct all intervening book events.

This was a targeted interface review, not a complete repository audit. Before implementation, inspect current subscription routing, workers, history storage and indicator registration. Reuse those services; do not create a second trade feed or per-chart websocket. The specific depth service inspected is Binance USD-M; do not assume it supplies every venue or spot market.

## 3. Data and clock contract

Key every calculation and calibration by `(venue, marketType, nativeSymbol, quantityUnit, priceSource, W, detectorVersion)`. Start with one market at a time. Preserve this provenance in aggregated displays.

Input trades: exchange execution identity, exchange timestamp, receipt timestamp, native price, normalized base quantity, aggressor side, source granularity and coverage. Deduplicate before aggregation. Unknown-side volume is recorded, not silently reassigned. Do not interpret an aggregate record as a single trader or parent order.

Preferred price input: synchronized best bid and ask from the same market. Mid-price is `(bid + ask)/2`. Keep both exchange and receive times where available. The inspected book observer supplies host-observation time; adding exchange-time metadata may be necessary before claiming exchange-time alignment. Never join a host-timed quote stream to exchange-timed trades as if clocks were equivalent.

Fallback: trade-price-only mode, using the latest eligible trade at boundaries and all observed trade-price extrema. Give this mode its own baselines, explicit `trade-price proxy` label and no book-evidence badges. Do not mix its values with midpoint-mode calibration or synthesize historical quotes from candles.

Aggregate into one-second summaries, retaining intra-second price extrema and small price-by-side volume maps. Evaluate a rolling 30-second window once per finalized second. Optional horizons: 10 and 60 seconds, independently calibrated. Detection does not depend on the chart candle timeframe.

Use event-time watermarks where the feed supports them. Start with a configurable 500 ms lateness allowance, then adjust from measured feed lateness; it is not a universal guarantee. A delayed packet outside the finalization policy must flag a correction/gap, not silently rewrite an alert. Retain `windowStart`, `windowEnd`, `availableAt` and `alertedAt`. Backtests may act only at or after `availableAt`.

Default quality gates: no known trade-sequence gap in the analysis window; no book-epoch boundary in midpoint mode; unknown-side quantity <=1% of total; valid positive prices; not crossed quotes; no known retention truncation. Reject or separately label stale-quote windows using measured transport health, not absence of quote changes alone. A quiet book is not automatically stale. Missing history is unavailable, never zero.

## 4. Historical reference

Store non-overlapping, UTC-aligned W-second summaries for calibration. Rolling overlapping evaluation windows are not independent calibration observations. A reference observation is eligible only when its end is <= the current analysis-window start. Refit/query from a snapshot satisfying this cutoff, not merely from records older than the current end.

V1 effort reference: trailing 24 hours of eligible side-specific volume summaries; require at least 500 valid windows. At W=30 seconds, 500 windows represent approximately 4 hours 10 minutes of observed data, which can be restored from persisted summaries. Show warm-up rather than manufacturing a score. Do not restart calibration when changing the visible chart timeframe.

Price scale: median high-low mid-price range of eligible W-second windows from the prior two hours, requiring at least 100 observations. Define all ranges in basis points. At current window start, let `spreadBps = 10000*(ask-bid)/mid`, `tickBps = 10000*tickSize/mid`. Freeze:

`S = max(medianHistoricalRangeBps, 4*spreadBps, 4*tickBps)`.

In trade-price mode, omit the unavailable spread term and flag that limitation.

Optional mature-history mode: build side-specific volume references from prior days in the same UTC time-of-day neighbourhood, separating weekday/weekend. For example use the prior 14 days and +/-1 hour around time of day; require 500 eligible observations before enabling. Do not switch reference schemes without versioning events and evaluating them separately. This is preferable to assuming equal volume in every minute of the day, but not a reason to block a rolling-reference V1.

For percentile rank use `(count(x < current) + 0.5*count(x == current))/N`. This prevents all-zero reference series from treating zero as exceptional. Reject zero-volume windows regardless.

## 5. Core detector

### 5.1 Effort

For current window:

`B = sum(aggressive-buy base quantity)`

`A = sum(aggressive-sell base quantity)`

`U = sum(unknown-side base quantity)`

`V = B + A + U`

`D = B - A`

`s = sign(D)`; no directional signal when `D == 0`.

`dominance = abs(D)/V`

`Q = B if s=+1 else A`

`E = percentileRank(Q, historical volume for that same aggressor side)`

Cheap effort gates: `E >= 0.95`, `dominance >= 0.30`, `Q > 0`, plus quality and warm-up. With no unknown trades, dominance 0.30 means 65/35 directional volume, not 30% buy share. Both sides' volume remains available for diagnostics.

These gates deliberately target directional stalling. Balanced high-volume trading is labelled two-sided activity, not directional absorption. A later local-zone detector could find a directional event masked by opposite flow elsewhere; that is outside V1 scope.

### 5.2 Result: track the path, not only the candle body

Let `m0` be the valid price at window start, and `mu` every eligible midpoint observation inside the window, including one-second extrema. Compute:

`r = 10000*ln(mEnd/m0)`

`M = max(0, max_u(s * 10000*ln(mu/m0)))`

`R = 10000*ln(max_u(mu)/min_u(mu))`

`M` is maximum progress in the aggressive side's direction, not the absolute endpoint return.

Stall gates: `M <= 0.25*S`, `abs(r) <= 0.25*S`, and `R <= S`.

The endpoint gate targets an ongoing stall rather than a reversal that has already run away. The path gate rejects a large directional move that subsequently returned to its opening price. Such a round trip may be a separate sweep/rejection event, but must not be called continuous absorption by this detector.

### 5.3 Find and freeze the contested zone

At window start, set a price half-width:

`h = ceilToTick(max(2*tickSize, startSpreadPrice, 0.10*m0*S/10000))`.

Omit the spread term only in explicitly labelled trade-price mode. Width must not depend on chart zoom, visible footprint row size, or future volatility.

Find the contiguous price interval of width `2*h` containing the greatest dominant-side executed quantity. Use a native-tick-price histogram and a sliding sum across sorted occupied prices. Deterministic ties: centre nearest current valid mid, then lowest lower bound. Let its fixed bounds be `[L,H]` and its dominant-side quantity be `Qz`.

Require:

- `Qz/Q >= 0.50`.
- Split the W-second window into six equal subintervals. At least three contain >=10% of Qz in the selected zone.
- Actual timestamps of zone executions span >=W/3; for W=30 this is at least 10 seconds.
- The current price lies inside `[L-buffer,H+buffer]`, where `buffer=max(startSpreadPrice,2*tickSize,0.10*m0*S/10000)` rounded up to the tick.

Run this price-local work only after cheap effort gates. This prevents turning every high-volume candle into a supposed defended level and rejects a single isolated burst as persistent stalling.

Create an event only if all gates pass. Label it `BUY FLOW STALLED / potential passive selling` for s=+1 or `SELL FLOW STALLED / potential passive buying` for s=-1. Neither wording claims trader identity or position intent.

### 5.4 Optional pane value

When gates pass, a simple visualization is:

`intensity = -s * 100 * E * (1 - min(1,M/S))`.

Otherwise emit zero for a valid non-signal window, and null for unavailable/warm-up data. Positive means sell aggression stalled (potential buying support); negative means buy aggression stalled (potential selling resistance). Intensity is a descriptive scaling, not a win probability, a p-value, or an academic statistic. Tooltips must expose E, dominance, M/S, Qz/Q, duration and coverage rather than hide them behind a composite number.

## 6. Event lifecycle and deduplication

At detection freeze zone, side, S, buffer, model/version parameters and source identifiers. Keep the immutable detection record even when subsequent outcome is unfavourable.

After `availableAt`, evaluate one-second closes against the frozen boundaries. Require three consecutive finalized closes beyond the relevant boundary:

- Buy-flow stall: rejection below `L-buffer`; breakthrough above `H+buffer`.
- Sell-flow stall: rejection above `H+buffer`; breakthrough below `L-buffer`.

A rejection means a specified move away from the contested zone has occurred. It does not confirm a market maker's identity or guarantee a continuing reversal. A breakthrough means the former resistance condition did not hold; do not delete the original observation.

Default observation horizon: 120 seconds from detection. No boundary outcome => `expired/unresolved`. A data gap before outcome => `interrupted/unknown`, not a winning or losing outcome. No backdating a confirmation to the beginning of the evidence window. Additional opposite-delta evidence can be attached as a tag, not silently made a retrospective requirement.

Maintain one active event per market/side/overlapping zone. Subsequent overlapping rolling-window detections update its evidence, not create new alerts. Use execution identities or disjoint future increments so repeated windows do not recount the same volume. After outcome, require a genuinely new visit/episode or a configurable 60-second cooldown before creating a same-zone event. Separate candidate and outcome alert settings.

Completed zone segments end at their completion time and leave a small event marker. No permanent forward rays by default. Optional extensions may fade with elapsed time. Preserve setup time, outcome time and exact parameters for replay and journal snapshots.

## 7. Optional liquidity evidence

Book evidence enriches the core event; unavailable depth does not become a failed test or zero depth.

Keep trade delta and book OFI separate. A stream of aggressive buying can be offset by replenished offers: demanding extreme positive full OFI as a prerequisite could reject precisely this behaviour. Compute OFI from successive synchronized book states before heatmap averaging, and describe conflated-feed OFI as an observed proxy, not a complete exchange order audit.

Optional supporting tags: opposing displayed quantity persisted; opposing quantity recovered after observed depletion; several distinct executions occurred near the same prices. For any persistence statistic, fix price band and side, retain observed duration and coverage, and do not confuse new best-price levels with a refill of the original level.

Exact iceberg identification, passive trader identities, gross additions and cancellations are not established by aggregated L2 snapshots. Do not label a changing L2 amount as a specific cancel/replace order without appropriate evidence.

### Binance RPI mismatch

Official USD-M documentation says aggregate-trade `q` includes all market trades, including RPI-related executions; `nq` excludes RPI-related trades. Ordinary diff-depth excludes RPI orders. Therefore all-trade volume cannot be directly reconciled against ordinary displayed-depth depletion to infer hidden iceberg size. Preserve `q` for the core effort calculation. A separate visible-book reconciliation experiment may preserve `nq` with explicit semantics, but must not silently substitute it in footprint/ticker/core volume. Different stream timing and aggregation remain additional limitations.

Sources:
https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public

## 8. Expected-impact diagnostic: experiment, not mandatory gate

Once suitable history exists, estimate typical same-window response from prior completed windows. For historical j, use pre-window scales `Vbar_j` and `S_j`:

`x_j = D_j / Vbar_j`, `y_j = r_j / S_j`.

Start with robust regression `y_j = a + b*x_j + e_j`, fitted separately by venue/market/horizon/price mode. A Huber loss and ridge regularization can limit outlier sensitivity; tune only in chronological training folds. Require at least 500 eligible samples. Do not force a positive slope when the data do not support it: mark the diagnostic unreliable instead. Add only pre-window spread, depth and lagged-return controls in a separately versioned extension.

For current window, coefficients and all normalizers must be available before its start. Then:

`predictedReturnBps = S_t*(a + b*D_t/Vbar_t)`

`shortfallZ = s*(predictedReturnBps - observedReturnBps)/residualScaleBps`.

Residual scale is a robust scale of prior walk-forward, one-step scored errors; floor it using tick/spread noise. Do not estimate uncertainty from the current residual, overlapping copies of the same event, or in-sample fit alone. Suggested scale floor: max(2*tickBps,spreadBps,0.1*S_t). Calculate the historical error scale from errors normalized by their own pre-window S, then rescale to current S.

Only display a directional shortfall when `s*predictedReturnBps > 0`, the implied response exceeds the noise floor, input features are within a supported training range, and recent chronological out-of-sample error beats the same historical intercept-only baseline. Else show `model unreliable/out of range` and preserve the core rule-based event.

Interpretation: atypically small contemporaneous response relative to a fitted association, not a causal amount of price movement that was owed and not a future price target. A reversal following an extreme shortfall remains a separate hypothesis. Test whether this metric adds value over the simple detector before giving it control of alerts. Full OFI can be used as an explanatory diagnostic, but should not replace the trade-pressure lens automatically.

## 9. Context and presentation

Default detector: all qualified events, with optional alert filter `near a known level`. Attach prior-day highs/lows/VAH/VAL/POC, confirmed pivots, VWAP or selected drawing levels that already existed when the event was detected. Compute proximity against frozen tick/spread/volatility tolerance. Newly confirmed pivots may not be backfilled as if known earlier. Overlapping levels are correlated context, not independent probabilities to multiply.

Display compact zone and event marker; optional pane. Tooltip includes market, window, buy/sell quantities, effort percentile, dominance, maximum directional progress versus S, concentration, duration, price mode, depth coverage, detection and outcome times. On higher-timeframe charts show the actual event marker, not a retrospectively recoloured whole candle implying earlier availability.

Multi-venue: calculate locally first. Show independent source summaries or agreement/disagreement tags. Do not divide combined Binance/Hyperliquid volume by one venue's midpoint change. Spot/perpetual basis, quote currency, clock alignment and source dropouts must remain explicit. A custom aggregation changes the calibration identity; it cannot reuse one component venue's baseline.

## 10. Performance architecture

One shared computation per market/horizon/config; indicator, alert service and journal consume its event outputs. Worker-side or existing feed-worker aggregation. Constant-time rolling totals and monotonic queues for price extrema; bounded one-second rings; capped sparse price histograms; bounded event retention. If a cap is exceeded, flag degraded coverage rather than claiming complete observation.

Calculate cheap volume/quality gates first. Scan price-level histograms only when those gates pass. Keep live book diagnostics on the existing subscription. Do not require the heatmap to be visible and do not load full-depth history just to render the basic detector. Refit optional regressions at bounded cadence, not per trade. Cache reference summaries independently from visible viewport and deduplicate across widgets. Prefer batched UI updates and dirty-region rendering.

Illustrative service split: accumulator -> baseline/calibration -> detector -> event reducer -> chart primitive/pane + persisted alert consumer. Exact filenames and bridge APIs should follow the current repository rather than introducing a parallel architecture. If OpenScript cannot access the required microdata, implement a native host study and expose only bounded numeric series/events.

## 11. Validation and acceptance

Test deterministic fixtures before replay:

1. Large aggressive buys, limited upward excursion, repeated zone executions => buy-flow-stalled candidate.
2. Mirrored sells => sign-symmetric sell-flow-stalled candidate.
3. Very high two-sided volume, balanced delta => no directional candidate.
4. High buy volume with efficient upward progress => no stall.
5. Large directional round trip with small endpoint return => no continuous-stall candidate.
6. One isolated aggregate burst => no persistence event.
7. Empty/all-zero history => unavailable/no signal, never exceptional percentile.
8. Duplicate execution IDs => unchanged totals/event counts.
9. Gap, stale transport, epoch reset, unknown side or capacity truncation => explicit quality handling.
10. Overlapping windows => one episode and no repeated-volume inflation.
11. Changing chart timeframe/zoom => unchanged detection timestamps and zones.
12. Three future closes trigger rejection/breakthrough at the actual third-close availability time, never at candidate start.
13. Gap before outcome => unknown; failed candidates retained.
14. Quantity rescaling by a constant leaves percentile and dominance decisions invariant; price/tick rescaling preserves price-normalized decisions.
15. RPI-enabled volume is not transformed into a falsely precise iceberg estimate.

Walk-forward evaluation: use sequential train/calibration/test periods, no random split. Purge intersecting analysis/outcome windows around boundaries and cluster errors/confidence intervals by episode/day. Preserve immutable parameter versions. A practical initial campaign can collect 30–60 days, but stopping adequacy depends on independent event counts and regime diversity, not the calendar alone.

Compare matched level visits/SFPs with and without the detector, matched high-effort episodes without the stall test, and the simple core versus depth/model additions. Report signal count, unresolved fraction, time-to-event, forward directional returns and maximum favourable/adverse excursions at 30 s, 1 m, 5 m and 15 m. Treat prospective outcome barriers as measurement labels, not tradable fills. A trading simulation must start at the next executable quote after signal availability and charge spread, fees, latency, slippage and funding where applicable; do not assume passive fills because price touched a limit.

Do not use a price-rejection confirmation and then claim the already-completed rejection as forecast profit. Evaluate candidate-time forecasts and confirmation-time forecasts separately. Report false positives during trends, news, weekends and deep-liquidity periods, as well as successful reversals. Test timeframe boundary shifts and a small predeclared threshold grid; never select the best-looking held-out result and call it an independent test.

Release acceptance is correctness, bounded resource use, replay consistency and honest evidence labels. A profitable edge is a separate empirical acceptance criterion, not something delivered by this specification.

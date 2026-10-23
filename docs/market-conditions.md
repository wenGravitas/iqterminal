# Market Conditions

Add **Market Conditions** from a BTC chart's **Indicators** picker. This native,
OHLC-only indicator combines independently calculated volatility and tradeability.
It supports Binance Spot, Binance USD-M perpetual and Hyperliquid BTC perpetual.
It does not use executions, footprints, depth, heatmap history or ClickHouse.

The score is an initial heuristic, **not an empirically validated BTC trading rule**.
It measures movement conditions, not direction, entry quality or expected profit.
A STRONG score is not a reason to chase price. Fees, spread, liquidity, funding,
execution quality and strategy-specific risk are not inputs.

## Displays and configuration

The existing indicator picker, active-indicator header, visibility/removal controls,
native pane management and layout persistence own the instance. Its pane's selector
switches Compact, Detailed and Multi-Timeframe Dashboard without recreating the
pane. The component selector independently exposes Volatility Regime or Market
Tradeability. **SET** and the native indicator settings button open the same dialog.

Compact shows confirmed regime, score, band and the change from the previous
completed score (↑ / ↓ / →). Detailed uses native line series on a fixed 0–100
scale: score by default, optionally ATR percentile, BBW percentile, ER × 100 and
100 − CHOP. With HV enabled, its optional plots use a separate auto-scaled left
axis labelled % HV; the score axis remains fixed at 0–100. Configurable dotted reference lines default to 25/45/65/85. Subtle
regime shading is optional. Raw ATR quote values, ATR% and BBW% remain tooltip/readout-only; annualized
HV is available in tooltips and optionally on its separate axis. Individual
plot, regime and band colours are configurable. The incumbent dark/Ivory theme,
square native controls and shared chart scheduler remain in use.

Dashboard defaults to 5m, 15m, 30m, 1h, 4h, 1d. In settings, edit the comma-separated
**Timeframes** list to add/remove/reorder rows; only supported unique intervals are
retained. Select a row's timeframe button to inspect full precision values, HV,
book-independent metric semantics and the canonical UTC candle timestamp below
it. Each row also has a tooltip. Density can be compact or detailed. The pane
scrolls when the available space cannot fit every row. Changing display mode
adjusts its initial height; manual native divider resizing remains available.

Source defaults to the chart's BTC instrument and follows venue/market changes.
An explicit source override pins Binance Spot, Binance perpetual or Hyperliquid
perpetual. The timeframe in compact/detailed always follows the host chart. There
is no alternate price-field calculation source: the engine uses canonical OHLC
and Close, including on a transformed/Footprint chart. Settings stay attached to
the indicator through chart timeframe/venue changes and are saved in the existing
versioned chart layout. Other indicators and old layouts are unchanged.

## Formulas

All calculations below consume completed canonical candles. `n` denotes a period;
`C`, `H`, `L` denote Close, High and Low.

* True range: `TR[t] = max(H-L, abs(H-C[t-1]), abs(L-C[t-1]))`. The first bar uses
  `H-L`. Wilder ATR seeds with the arithmetic mean of the first `n` TR values,
  then `ATR[t] = ((n-1)*ATR[t-1]+TR[t])/n`. Default `n=14`.
* `ATR_percent = 100 * ATR / Close`. Nonpositive/invalid canonical prices are
  rejected; undefined or nonfinite derived results remain null.
* Percentile: **strict rank against the previous N completed valid observations**,
  excluding the current value: `100 * count(previous values < current) / N`.
  Both lookbacks default to 500 and are independently configurable (20–750).
  Ties count as zero, so a completely flat ATR/BBW history has rank zero.
  A full prior window is required. This differs from inclusive/tie-midrank
  conventions in some chart packages. Rolling windows maintain a sorted index
  using binary search plus insert/evict; they do not sort history on each tick.
* BBW: middle is SMA(Close, 20), population standard deviation over those 20
  closes; upper/lower are middle ± 2 standard deviations. `BBW_percent =
  100 * (Upper-Lower) / abs(Middle)`. Period and multiplier are configurable.
  A zero middle produces null, never Infinity. Its percentile uses the same
  strict-rank convention and its own previous-500-value window.
* Optional historical volatility: population standard deviation of the last `n`
  log returns `ln(C[t]/C[t-1])`, multiplied by `100 * sqrt(365*86400000/candleMs)`.
  Defaults: 20, 50, 100 returns (n+1 closes); 365-day, 24/7 convention. This uses
  actual timeframe duration, including intraday candles. HV is disabled by default
  and uses readouts/tooltips or optional plots on its own left axis.
* Kaufman ER(20): `abs(C[t]-C[t-n]) / sum(abs(C[i]-C[i-1]), n)`. Zero denominator
  gives ER=0. Score contribution uses ER × 100.
* CHOP(14): `100 * log10(sum(TR,n)/(highest(H,n)-lowest(L,n))) / log10(n)`.
  Clamp valid outputs to [0,100]. A flat zero-range market gives 100. Inverse
  choppiness contributes `100-CHOP`.

Reference conventions: [TradingView True Range documentation](https://www.tradingview.com/pine-script-docs/language/built-ins/)
and [TradingView Choppiness Index](https://www.tradingview.com/support/solutions/43000501980-choppiness-index-chop/).

## Regime and tradeability rules

Regime precedence, before confirmation:

1. EXTREME when ATR percentile ≥90. Once confirmed EXTREME, retain it while ATR
   percentile ≥87 (default three-point hysteresis).
2. COMPRESSION when both percentiles ≤20. Once confirmed COMPRESSION, retain it
   while both stay ≤23.
3. EXPANDING when both current percentiles strictly exceed their values three
   completed candles earlier, AND at least one percentile is now above its
   compression threshold but was at/below it within the last five completed
   candles. This is an individual component threshold exit; both components need
   not have been in compression simultaneously.
4. NORMAL otherwise.

Two consecutive completed candidates confirm regime transitions by default.
Comparison window, exit lookback, thresholds, hysteresis and confirmation are
configurable. All history reads are backward-looking. Initial regime is WARMING
until the percentile comparison/exit window and confirmation exist.

Volatility suitability is piecewise linear with default knots `(0,0)`, `(15,0)`,
`(35,100)`, `(90,100)`, `(100,25)`. Thus 35–90 is favourable but values beyond 90
lose suitability. The low/good/high percentile knots and final suitability at
100 are configurable; normalisation enforces ordered knots.

`score = (40*(ER*100) + 35*VolatilitySuitability + 25*(100-CHOP)) / 100`.
Nonnegative user weights normalise by their sum; all-zero weights restore defaults.
Apply caps after weighting: ATR percentile <15 caps at 35; ER <0.15 caps at 45.
ATR percentile >95 adds an excessive-volatility warning, independently of the
score/band. Caps, thresholds and warning boundary are configurable.

Score bands are lower-inclusive, upper-exclusive:

| Range | Band |
|---|---|
| [0,25) | DEAD |
| [25,45) | CHOPPY |
| [45,65) | DEVELOPING |
| [65,85) | TRADEABLE |
| [85,100] | STRONG |

Band boundaries are configurable as four increasing numbers. Once a band is
confirmed, retain it inside its bounds expanded by two score points (default
hysteresis); a candidate outside that corridor follows the ordinary band mapping.
The default confirmation is one completed candle and can be increased. Hysteresis
changes the retained label, not the displayed numeric score. Volatility regime
and tradeability band have independent warmup/confirmation state.

## Data, warmup and cost

The calculation service shares an engine per canonical source/timeframe and
calculation settings. Presentation/alert settings do not duplicate engines. It
subscribes through FeedClient into the existing worker-managed candle cache;
multiple consumers of the same timeframe share venue connections/history.
Changing modes retains the chart-timeframe engine while adjusting dashboard refs.
Every row loads the existing native candle history batch (up to 1000, or reuses
an already populated shared cache); no deep-history paging is introduced.

Warmup needs `atrPeriod + atrLookback` candles for the first ATR percentile,
`bbwPeriod + bbwLookback` for the first BBW percentile, `erPeriod+1`, `chopPeriod`,
and, if enabled, `max(HV periods)+1`. Regime additionally needs
`max(expansionWindow,exitLookback)` completed rank comparisons and the configured
confirmation. The UI displays a conservative combined warming counter. Components
become available independently; no incomplete value is replaced by zero. With
defaults both classifications are available after approximately 526 completed
contiguous candles. Maximum settings remain within the existing 1000-bar initial
history budget. Insufficient retained/venue history remains visibly WARMING.

Calculations advance only on newly completed candles. Intrabar changes do not
update classifications or plots. Candle keys are canonical UTC epoch milliseconds.
Out-of-order inserts and explicit closed-bar corrections replay bounded retained
history; ordinary appends do not recalculate old values. A missing interval resets
rolling warmup at the next observed candle; no synthetic candles bridge gaps. Native whitespace points break detailed lines
while metrics warm again, rather than drawing across unobserved intervals.
Reconnection/history snapshots pass through the same reconciled candle service.
A fresh engine and an incremental engine give identical results on the same input.

The UI retains at most 5000 computed points, trimming in batches; rare historical
corrections replay that retained input. Because Wilder ATR is recursive, a
correction after older input has been evicted reseeds from retained history and
can differ slightly from a calculation with the entire original history.
Native series update incrementally and the existing dirty-visible scheduler
coalesces pane updates. No separate animation timer or indicator worker is added.
There is no measured frame-rate guarantee.

30m and 1d dashboard rows are supported by the existing native venue adapters.
The host chart timeframe menu keeps its original five choices. In staging
mode, those two intervals explicitly use direct native exchange candle sources
(the private backend supports only the original five intervals); their feed
status is labelled Direct venue. This is a fixed source selection, not fallback
on backend failure. Original staging intervals keep their existing data route.
This client change does not extend the staging server's Footprint/heatmap history
interval contract. No server deployment or collection restart is needed.

## Alerts

All alerts default off. The Alerts settings group has independent checkboxes for
exiting compression, entering expansion/extreme, crossing above/below score
thresholds, classification changes, and expansion with sufficient tradeability.

Regime/band events use the confirmed classifications above. Combined fires when
the regime enters EXPANDING and the score at that candle is at least 65 (default).
Threshold crossings default to above ≥65 / below <45 and use their own two-point
hysteresis and one-completed-candle confirmation (both configurable). Above
rearms below `threshold-hysteresis`; below rearms at/above
`threshold+hysteresis`. Alert confirmation controls these numeric threshold rules;
regime and band confirmation use their calculation settings.

Initial history, historical replay/corrections, settings changes and reconnect
replays do not produce retroactive alerts. Detectors process a completed timestamp
once; identical panels use the existing notification gate's event/rule identity
to suppress duplicate delivery. Alert payloads include the BTC instrument, venue,
timeframe, event, score, regime and UTC candle-close timestamp.

Delivery uses the existing Notifications toast/audio service, including its
master mute, enabled audio requirement, visible-document policy, three-second
freshness gate, two-per-second rate limit and one-per-rule-per-second cooldown.
Delayed/recovered candles and hidden-page alerts may therefore be suppressed.
Audio is optional and off for this indicator by default. Configurations persist
with the layout. The existing service has no durable alert-history store, so this
feature adds no parallel history system or closed-browser/background delivery.

## Calibration export

Export canonical BTC candles (`Candle[]`, fields `t,o,h,l,c,v,revision,closed`, t in
UTC milliseconds) from a trusted historical source, then run:

```sh
node scripts/market-conditions-export.mjs btc-5m.json 5m > conditions.csv
# Optional third argument: JSON calculation settings overrides
node scripts/market-conditions-export.mjs btc-5m.json 5m settings.json > conditions.csv
```

The utility uses the identical engine and installed Vite TS loader, performs no
network calls, excludes forming candles, and emits timestamp, timeframe, ATR/BBW
percentiles, ER, CHOP, regime, score and band. Warmup fields are blank. Sorted
append processing preserves a continuous Wilder seed for long exported histories.

For later empirical calibration, compare distributions across venues/timeframes
and several BTC volatility cycles. Measure dwell times, transition frequency,
subsequent realized range and directional efficiency, and spread/fee-adjusted
outcomes for specific trading approaches. Use separate calibration and held-out
periods; compare alternative percentile tie conventions, suitability knots and
weights. Do not tune against subsequent returns and present the score as a
profitability prediction.

## Implementation verification

* New calculation/edge-case tests cover ATR, ATR%, both percentile windows, BBW,
  24/7 HV annualisation, ER, CHOP, weighting/caps, bands, regime precedence,
  confirmations/hysteresis, independent warmup and alerts, deduplication,
  intrabar/closure behavior, missing candles, corrections/backfill, bounded history,
  render-safe numbers/dates and shared multi-timeframe subscriptions.
* `pnpm vitest run --maxWorkers=1`: 466 passed, one opt-in live test skipped at the
  broad regression checkpoint. The final focused engine/registration run passes 49 tests, including 36 new
  calculation/edge-case tests covering the final changes.
* `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 pnpm exec playwright test
  tests/browser/market-conditions.spec.ts --reporter=list`: three cases cover the
  display modes, HV axis separation, persistence, chart venue/timeframe rebinding,
  independent component display, shared calculations, cleanup, and coexistence
  with Footprint, Totals and Heatmap.
* A real staging `/v1/native-candles?interval=1m` request supplied 1000 canonical
  candles; the export utility emitted the 999 completed observations. The live
  non-fixture browser reached a ready classification on the same native source
  with no page errors. Direct native 30m/1d REST probes returned HTTP 200.
* Separate explicit fixtures exercised all six dashboard rows and visual layouts
  at 1920×1080 Dark and 1280×900 Ivory. These checks are not platform frame-rate
  measurements or empirical validation of the scoring heuristics.
* Broader pre-existing browser tests have four independent failures: a Footprint
  Totals fixture reads a null latest bar, two old selectors match multiple dialogs
  or opacity inputs, and the narrow Heatmap settings button is obstructed. All
  four reproduced in an isolated copy retaining earlier worktree changes with
  Market Conditions integration removed; the same legacy-layout migration test
  passed in both copies. Those unrelated tests were not rewritten for this feature.
* Typecheck/production build and the UI mechanical scan pass. Vite retains its
  existing large-chunk advisory. No server restart/deployment, dependency change,
  cleanup of existing work, or Git publication was performed.

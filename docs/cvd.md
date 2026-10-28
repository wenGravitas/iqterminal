# Multi-Venue CVD — Stage 1

Add **Indicators → Order flow → Multi-Venue CVD**. It uses a native lower pane, the host chart's time axis and crosshair, and the Net Longs/Shorts button treatment. Defaults are Venues, both supported markets included, total and component lines visible, and daily reset at 00:00 UTC. Component lines are thin; the combined total is brighter and thicker. Zero is dashed. There are no signals, divergence, absorption, alerts or OI estimates.

## Sources, groups and visibility

**Sources** opens the shared market picker. Binance BTCUSDT Spot (`BN[S]`) and USD-M perpetual (`BN[P]`) are separate instrument identities. Both supply normalized executed BTC quantities and USDT notionals. Hyperliquid is unavailable here because this application does not yet provide its classified execution/history pipeline; candles are not substituted for trades. Other assets and inverse-contract conversions are unsupported.

Market checkboxes control inclusion in the calculation. Legend buttons control line visibility only: hiding Spot still leaves its contribution in Total. All sources may be disabled; controls remain available and the pane says **No sources selected**.

**Venues | Aggregations** changes presentation without changing population, anchor, pane or subscriptions. Named aggregations use saved selections in the common market picker. Select markets, enter an aggregation name and save, then Apply. Selecting a saved group explicitly adds its supported constituents; unselecting a group keeps market membership unchanged. Apply stores an independent definition copy in the indicator, so another chart's selection or saved group cannot silently alter it. Groups with excluded members say **[filtered]** and sum only included members. No predefined baskets are installed. Empty Aggregations mode explains how to select a group and leaves Venues available.

Total always sums the deduplicated union of included underlying markets, never the displayed group lines. For groups A+B and B+C, Total is A+B+C. Line colours, visibility, selected group copies, population, reset configuration and pane weight persist with the layout. Saved group definitions use `basis.market-groups.v1`; layout settings never contain execution history or connections.

## Formula and units

For each authoritative minute bucket:

```
base delta  = sum(buy base quantity) - sum(sell base quantity)
quote delta = sum(buy executed notional) - sum(sell executed notional)
source CVD  = cumulative signed deltas since the effective anchor
Total CVD   = sum(included source CVD values)
```

Buy/sell means **aggressor side**. Binance's buyer-is-maker field `m=true` means aggressive selling; `false` means aggressive buying. The existing adapters validate this boolean and normalize it at their boundary. See Binance's [Spot aggregate trade contract](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#aggregate-trade-streams) and [USD-M aggregate trade contract](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Aggregate-Trade-Streams). Unknown sides are excluded and qualified as missing coverage; candle direction, tick rules and OI are never used.

BTC mode accumulates base quantity. USDT mode independently accumulates each execution's price × normalized base quantity, using the recorder's exact stored `quoteNotional` before converting projected buckets to finite JavaScript numbers. It does **not** multiply cumulative BTC or a bucket's net BTC by its close/latest price. These two supported linear BTCUSDT markets need no additional contract multiplier or FX conversion. USD/USDC baskets are not enabled or represented as exact USDT conversion. Future source additions must preserve this restriction or label any approximate quote equivalence explicitly.

The existing global currency override controls BTC/USDT display and disables the local selector with its existing explanation. Local preferences return when the override is removed. Calculation retains unrounded numbers; axes, legend and hover use compact three-significant-figure K/M/B values with an explicit unit. Exact source values and coverage are available in development diagnostics (`panel.diagnostics().cvd` / terminal diagnostics).

## Anchors and sampling

- **Daily:** 00:00 UTC; default.
- **Weekly:** Monday 00:00 UTC.
- **Continuous:** since the saved explicit retained origin, initially the first full minute within the preceding seven days. This is not all-time history.
- **Custom UTC:** saved timestamp. The supported effective boundary is the next minute boundary (or the same boundary for an exact minute). Settings disclose both requested and effective times; pre-anchor executions are excluded rather than guessed.

Every source and group uses the same convention. Reset boundaries break the line; reset-to-zero is not depicted as executed selling. The exact previous-period endpoint belongs to the period that ended there. Pan, zoom, chart timeframe and presentation changes do not redefine the origin. Calculations use fixed one-minute executed-flow buckets independently of candle timeframe. The native host timeline is retained; CVD does not inject minute bars into a five-minute candle chart.

Retained cumulative checkpoints preserve the baseline when old buckets are pruned during an active session. On reload, only the server's retained execution history is recoverable. If an old continuous/custom origin has expired, the chart reports partial history from the available start, rather than inventing its lost offset or silently changing the saved origin.

## Authority and coverage

In staging/recorded mode, `/market-data/v1/cvd` is a compact seven-day projection of the existing durable Spot/perpetual execution tables, not a new exchange collector. The collector serves `/v1/cvd?market=spot|perpetual&since=<revision>` through the existing history gateway. Queries use `FINAL`, a captured durable execution-ID watermark and independent signed base/notional sums. Requests, SQL time/memory, bucket count, shared worker sources and consumers are bounded. Initial history is at most 10,082 minute buckets per source; there is no raw-trade download into the pane.

One shared worker cache polls approximately once per second per included source, regardless of how many panes display it. Incremental revisions replace buckets and update the cumulative suffix; history/live overlap, replay and duplicate snapshots are not additive. Late durable executions trigger a requery from their affected minute. A periodic full bounded projection (at most once per minute), or an explicit coverage-state change, catches historical corrections. Successful projection must precede publishing repaired coverage. Superseded requests cannot update a replacement subscription. ACK-coalesced UI updates retain the complete latest calculation; hiding component lines or switching presentation does not reload history.

Direct development mode reuses the existing shared execution subscriptions and is **observed live only**, with no recorder backfill. It explicitly reports partial history; a reconnect does not repair its missing flow. Fixtures require explicit development selection and are never a connectivity fallback.

**Complete through observed watermark** means full anchor-to-observation coverage, not a guarantee beyond the recorder watermark. Confirmed zero flow is zero; unavailable execution history is not zero. Component lines break over unknown intervals; known cumulative contributions remain retained in qualified, dashed partial totals instead of disappearing and causing artificial jumps. A stale source marks the total incomplete. A connection recovery alone does not remove gaps: successful history repair or a new fully covered reset period is required. Partial/stale readouts show the available history start in UTC. Concise quality stays in the pane/hover; detailed source messages, watermarks and coverage remain in diagnostics.

## Verification boundary

Deterministic calculation, service, recorder-projection and Chromium fixture checks cover signed flow, units, corrections/replay, resets, pruning, group deduplication, inclusion/visibility, persistence and native pane interactions. Fixture checks are synthetic, not proof of exchange connectivity or durable production coverage. The new collector projection must be deployed through the normal server release process before recorded-mode use; adding this code does not deploy it. No Stage 1 live/staging acceptance or performance claim is implied by these tests.

Bybit BTCUSDT linear perpetual can also be explicitly included in Sources and named aggregations. Existing defaults remain Binance Spot/perpetual. Recorded Bybit history requires the additive companion-server recorder/migration; direct mode uses observed Bybit session trades. See [Bybit support](bybit.md) for coverage and verification boundaries.

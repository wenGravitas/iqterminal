# Unified indicators

The chart toolbar is Market, Timeframe, Indicators, Chart settings and Latest.
Indicators opens a searchable catalogue of Order Flow, Trend, Volume and My
Scripts entries. Footprint and Order-book Heatmap are native singleton entries;
scripts support independent instances and inputs. No catalogue entry changes the
chart’s market. Unsupported markets show availability rather than substituting a
feed.

The collapsible Indicators list inside each plot owns visibility, settings and
removal. Script rows also offer Edit Script and Duplicate. Controls remain
available on keyboard focus and touch. Native singleton selection opens the
existing settings. Chart settings owns gridlines and the saved base-candle
visibility preference. Footprint settings owns price-row size, BTC/USDT units,
slim execution candles, cell colouring, opacity and imbalance options. Statistics belong exclusively to the standalone Footprint Totals indicator. The shared time axis stays on the main price pane.
Heatmap settings owns resting-liquidity resolution and presentation.

## Contract and ownership

`src/indicators/model.ts` defines stable definition and instance IDs, settings
version/schema/defaults, category, implementation, placement, requirements,
source binding, multiplicity and capabilities. Placement is rendering metadata,
not a separate menu. Serializable instances contain settings and chart binding;
script instances retain an immutable source revision pin. Runtime handles stay
in `IndicatorLifecycle`, never in Dockview persistence. Reconciliation creates
once, applies changed settings/visibility and disposes removed handles. Errors
are isolated per instance. Unknown definitions, future settings versions and
unsupported source bindings remain recoverable inactive rows.

Panel handles adapt the existing chart adapter, feed client and script host.
Worker ingestion, aggregation, shared subscriptions and bounds remain unchanged.
List updates are keyed to configuration/status, not execution or depth ticks.
There is no DOM element per rendered cell. Asynchronous script applies carry
attachment intent and chart-context generations: removal, a newer apply, market
changes or disposal reject obsolete results. A failed apply retains the last
successful study.

## Visibility policy

Hiding native layers suppresses painting but retains their bounded session
collection and settings. Showing Footprint reuses retained bars, with original
coverage warnings. Hiding Footprint restores base candles according to the
independent saved base preference. Removing Footprint releases its consumer and
restores base presentation; removing Heatmap releases only its consumer. Other
panels/studies retain their shared subscriptions. Hidden scripts retain workers
and calculation state but hide their outputs. Closing a panel disposes all
handles and its existing owned listeners, observers and subscriptions.

An attached Footprint determines heatmap price resolution even while hidden, so
hide/show does not reset collection. Removing it restores the heatmap’s saved
independent resolution; this may start a new session unless that resolution is
still retained by another consumer. Changing row size follows the same existing
bounded lifecycle. Ordinary native exchange candles remain OpenScript input even
when the footprint presentation uses session execution OHLC.

## Layout migration

Workspace envelope version 3 accepts previous versions 1 and 2. The storage key
is unchanged. Panel indicator schema version 1 converts legacy footprint chart
mode into `native.footprint`, enabled heatmap into
`native.orderbook-heatmap`, and legacy study pins into scripted instances.
Stable migrated native IDs and singleton validation prevent duplicates. An
existing `indicators` array, including an empty one, is authoritative; repeated
normalisation never recreates a removed legacy layer. Legacy aliases remain at
the existing adapter boundary, preserving inactive native settings and unrelated
layout fields. Saved state contains settings only, never execution/book history.
Unknown records are bounded and retained rather than erased. Only supported
version-1 chart bindings execute.

## Adding another built-in

Add a definition with a stable ID, settings version/defaults/schema, placement,
data requirements and multiplicity to the registry. Add bounded settings
validation and a panel runtime handle that adapts an existing data service and
renderer. Implement update, hide and dispose without serialising live objects;
add migration and lifecycle tests. Add the focused settings form and settings
summary; catalogue and active-list plumbing is shared.

Future Volume Profile or TPO should enter this registry as native definitions.
Their versioned settings can declare candle/session/range anchoring and left or
right attachment placement; the renderer handle should own anchoring and
subscriptions without changing the chart instrument. These capabilities are
extension points, not currently executable features. No profile/TPO entries are
shown until implementations exist.

Heatmap Quantity units remains available without Footprint; it changes the shared
saved BTC/USDT display preference, including attached Footprint. It changes
presentation only, preserving exact notionals, BTC density normalisation and
collection identity.

## Effort–Result

`native.effort-result` is an Order Flow singleton with compact causal zones and an
optional signed pane. It reads shared server-owned calculations through the feed worker and
persists versioned calibration/events on the server outside workspace JSON.
Collection continues without client consumers; client removal releases polling only. Release 1 enables
Binance BTCUSDT USD-M in labelled trade-price-proxy mode, with a 30-second
analysis horizon and honest warm-up/coverage states. See
[Effort–Result usage and implementation decisions](effort-result.md) for the
mathematics, outcome rules, retention, replay route and measured limitations.

## Multi-Venue CVD

`native.multi-venue-cvd` is an Order Flow singleton in a native lower pane. The worker's shared signed-execution service owns source history and calculation; its minute samples do not expand the host candle timeline. Venue/aggregation presentation and legend visibility are independent of source membership and never reconnect or remount the pane. Layouts retain settings and independent named group copies, not execution arrays. The BTC/USDT selector follows the existing global currency override. See [CVD controls, formulas, anchors and coverage](cvd.md).

## Trade Bubbles

`native.trade-bubbles` is an Order Flow chart overlay. Its worker service fans out existing Binance Spot and USD-M aggregate-trade consumers to chart-local filters and bounded snapshots. A chart ID scopes each consumer independently even when native indicator IDs match. Only Binance BTC/USDT price alignment is supported; unsupported quotes are reported and never converted implicitly. Hiding continues bounded collection, while removal releases that chart's consumer. See [Trade Bubbles source, lifecycle and performance limits](trade-bubbles.md).


## Actual Liquidations

`native.liquidations` is an Order Flow singleton in a native lower pane. It stacks short liquidations above zero and long liquidations below, separating Bybit and Binance contributions. Optional primary-chart markers preserve reported price basis; Bybit prices are bankruptcy prices. The shared worker reconciles bounded viewport history and live records, and preserves other ticker/indicator consumers when one is hidden or removed. Settings and workspace layouts persist. Binance totals are sampled cumulative snapshot valuations and may overlap. The separate Liquidation Ticker supports tiers, replay and burst inspection through the same service. See [Release 1 settings, data flow and operational limits](liquidations-release1.md).

## Order Walls: Top Levels and Threshold Walls

New Order Walls instances default to observed Top 8 bids and asks, native price resolution, High Contrast and Visible Range Only. Selection uses the contemporaneous depth book, independently per side; pan/zoom only changes presentation. Rank exits end selection episodes without claiming an order removal. Saved legacy instances remain Threshold Walls until their Detection mode is changed. Spot and USD-M remain distinct sources, and incomplete depth, pending replay and the four-hour history boundary stay explicit.

See [Release 1 calculation, settings, limits, performance and evidence](order-walls-top-levels-release1.md).

# Actual Liquidations — Release 1

Release 1 implements independent collection, durable history, shared worker delivery,
a dockable ticker, native pane/price markers and burst alerts. See
[implementation and verification](liquidations-release1.md) for operation, API contracts,
limits and measured evidence. Deployment remains a separate approved operation.

## Verified source semantics

- [Bybit V5 allLiquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)
  reports arrays of liquidation records. `S=Buy` describes a liquidated LONG
  position, with forced SELL direction inferred as its opposite. `S=Sell`
  describes a liquidated SHORT. The reported `p` is the bankruptcy price,
  not the trigger price or an observed fill price. `v` is the reported executed
  size. Price × size is explicitly a bankruptcy-price valuation in USDT.
- [Binance USD-M liquidation streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)
  report forced ORDER side: SELL closes a long, BUY closes a short. The adapter
  uses average fill price `ap` × cumulative filled quantity `z`; original order
  quantity `q` and limit price `p` remain provenance and are never substituted
  as executed notional. When average fill is unavailable, the order price remains
  labelled as such and execution notional is unknown. After the combined
  COIN-M migration, `st=2` is rejected. The routed URL uses `/market/ws/`.
- Binance publishes only the latest liquidation order per symbol per 1,000 ms.
  Its reported values are not complete exchange-wide liquidation volume.
  Cumulative fill snapshots are not individual execution deltas.

Neither source publishes a native liquidation order/event ID in these payloads.
IDs are deterministic reported-field keys with an occurrence suffix, and are
labelled accordingly. Identical Bybit occurrences within one message remain
separate. Packet replay and decimal-format differences do not change their IDs.
Independent events with exactly identical reported fields across different
messages cannot be reliably distinguished; no stronger identity is invented.

The event contract preserves exchange record time, publication time and host
receipt time separately. Exact decimal strings are authoritative; numeric values
serve chart geometry and readouts. Venue identity and contract units remain
separate from the existing ordinary execution model. Unknown notional stays
`null`. Malformed records are individually rejected, message size is bounded,
and valid out-of-order timestamps are retained for downstream ordering.

## Shared contract and checks

`src/liquidations/model.ts` and `adapters.ts` are DOM-free and open no sockets.
The companion server mirrors them using its existing shared-engine convention:

```sh
# In iqterminal-server
node ops/sync-liquidations.mjs --check
pnpm exec tsx --test tests/liquidations-adapters.test.ts
```

Client adapter/regression tests:

```sh
pnpm exec vitest run tests/liquidations-adapters.test.ts tests/footprint.test.ts
```

These checks use deterministic supplied payloads. They do not establish live
stream connectivity, durable storage or historical completeness. Future estimated
liquidation pools must use a distinct data model; the current event kind accepts
only actual venue reports.

## Bar tooltip

Hover a liquidation bar to inspect the long or short side in the same compact
card style as Net Longs/Shorts: UTC timestamp and timeframe, venue badges,
proportional venue bars, amounts in the selected BTC/USDT unit, and a reported
total. The card stays within the chart. Bankruptcy-price valuation, Binance
sampling and coverage limitations remain labelled; totals describe reported
activity, not complete exchange-wide liquidations.

## Venue controls

The indicator header has Bybit and Binance buttons using the same selected state
and compact icon layout as Net Longs/Shorts. Toggle either venue to include or
exclude its reported liquidations from this indicator's bars, markers and
hover totals. The selection is saved per indicator and also appears in its
settings. Both venues can be disabled; the buttons stay available to re-enable
a source. Other liquidation widgets keep their own selections.

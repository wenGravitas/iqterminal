# Bybit BTCUSDT perpetual

Bybit's **linear USDT-settled BTCUSDT perpetual** is selectable in Trade Ticker, Multi-Venue CVD, and the independent Net Longs / Net Shorts source controls. Existing saved selections and defaults stay intact. Bybit spot, inverse contracts, candle charts, footprints, order-book panels, and Trade Bubbles are outside this addition. The shared market picker keeps unsupported capabilities disabled.

## Client

The data worker owns one demand-driven `publicTrade.BTCUSDT` connection shared by Bybit tickers and direct-mode CVD consumers. The adapter uses `S` as the taker side, `v` as BTC size, exact exchange price/size strings for notional, and the venue-scoped string trade ID for deduplication. Rows identify Bybit and individual trades. Ticker thresholds, notification scope, filtering, persisted market selections, and hover details use that identity; Bybit prints cannot attach rays to Binance or Hyperliquid charts.

The service bounds recent IDs, detects conflicting duplicate IDs, pings the public socket, reconnects stale/closed connections, and closes after its last consumer leaves. Session interruptions remain gaps. Direct CVD has observed session flow only. It does not substitute Binance data or claim historical repair.

Recorded-mode CVD requests `/market-data/v1/cvd?venue=bybit&market=perpetual&since=…`. The positioning recorder request accepts `bybit` alongside Binance and Hyperliquid. Both positioning panes retain their own selected venues, rendering, colors, and method.

## Recorder

The companion `iqterminal-server` adds an independent bounded Bybit recorder to the perpetual collector process. It does not alter Binance collection/recovery. Additive migration `ops/migrations/008-bybit.sql` creates seven-day trade and session tables. Bybit string trade IDs and numeric ingestion cursors are separate: `FINAL` deduplicates source identities, while a captured committed cursor bounds CVD projection. Exact signed BTC and independently summed USDT notional use the existing CVD projection/calculation contracts. Durable session boundaries publish after trade inserts; disconnects, restarts, malformed data, queue overflow, and storage failure cannot silently bridge execution coverage.

Every 30 seconds, the recorder samples the public V5 ticker's **`singleOpenInterest`**. It never substitutes the two-sided `openInterest` value. For linear BTCUSDT, one-sided OI is in BTC. The API response snapshot time is retained with collector-sampled timing quality. After the execution watermark passes the interval boundary, the existing positioning estimator classifies the OI change from same-venue boundary prices or taker flow. Incomplete coverage stays unavailable. Estimated side activity does not identify opening versus closing intent.

Official contracts: [public trades](https://bybit-exchange.github.io/docs/v5/websocket/public/trade), [ticker fields](https://bybit-exchange.github.io/docs/v5/market/tickers), [OI units and one-sided OI](https://bybit-exchange.github.io/docs/v5/market/open-interest).

## Release and verification

The server migration must run before the updated perpetual collector is started. Deploying this source requires the normal authorized server release; editing the local checkout does not deploy the recorder. Collection begins at deployment, with no invented pre-collection history or reconnect backfill. The server's `/v1/health` exposes Bybit collection, OI quality, and durable watermark. A missing migration leaves the Bybit recorder failed explicitly.

Deterministic tests cover parsers, single-sided OI, exact quantities, deduplication, source routing, durable publication ordering, failed storage, restart gaps, positioning estimation, CVD projection, and bounded lifecycle behavior. Browser fixtures exercise selection, persistence, Bybit execution labels, CVD membership, and both positioning panes. A disposable local ClickHouse instance also passed migration/idempotency and deterministic recorder-to-database checks for exact OI deltas, signed CVD, duplicate replay and restart gaps; the temporary container was removed afterward. These are synthetic data checks. The read-only staging-host probe independently confirmed Bybit REST and public WebSocket access; it did not deploy or exercise durable Bybit history. A local Chromium public WebSocket probe also received BTCUSDT trades. The separate local Node probe timed out; it did not establish Node connectivity from this host. No platform performance claim is made.

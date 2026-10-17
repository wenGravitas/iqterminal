# Binance BTCUSDT Spot staging acceptance checkpoint

**Status:** Spot implementation is deployed to the private staging host and has passed backend, client, live-feed, prepared-history, WebSocket, and Pi-browser checks listed below. This is staging evidence, not a production release. No commit or push was made. The client’s Spot heatmap tick-size correction below is source-tested but was not part of the backend rollout.

## Scope and compatibility

Add first-class Binance BTCUSDT Spot aggregate-trade footprints and order-book heatmaps alongside native Spot candles, while preserving the existing Binance USD-M Perpetual paths and Hyperliquid candles. Spot OI and liquidation polling are unsupported and remain disabled. Requests without a market selector retain the legacy Perpetual default; Spot is always selected explicitly.

The shared HTTP contract uses `market=spot` on `/v1/*` and `/v2/history/*`. The shared WebSocket path uses `?market=spot` for gateway selection and a `market: "spot"` subscription field. The Perpetual route and subscription omit the selector as before. Spot identity is `binance:spot:BTCUSDT`; execution feed is `binance:spot:BTCUSDT:aggregate-trade`; depth feed is `binance:spot:BTCUSDT:spot-diff-depth`. Spot footprint bars use source `binance-spot-aggtrade`.

Raw Spot executions and depth use additive, isolated `spot_executions` and `spot_depth_records` tables. This avoids collisions where Spot and Perpetual exchange IDs and timestamps match. Prepared history reuses the existing feed-keyed history tables with the Spot feed identity. Existing Perpetual table ordering, collector, materializer, retained data, and omitted-selector behavior are unchanged.

The Spot depth path uses Binance Spot REST/WebSocket endpoints and the Spot snapshot bridge (`lastUpdateId + 1`), buffers deltas while a snapshot is fetched, discards `u <= lastUpdateId`, and resnapshots after a sequence gap or reconnect. A Spot snapshot covers at most 5,000 levels per side; unobserved outer levels remain unknown. Spot aggTrade quote notional is calculated from decimal price × quantity because the venue record has no quote-quantity field. BTCUSDT Spot tick size is `0.01`; USD-M Perpetual remains `0.1`.

Spot candles, footprints, and Trade Ticker use their existing direct Binance Spot adapters. Spot heatmaps require the staged durable depth/history service; in direct mode the worker reports that requirement and does not substitute USD-M depth. Prepared Spot responses are checked for matching market/feed identity before caching or display.

## Source changes

The client changes in `/home/daz/workarea/iqterminal` cover market selection and identity, Spot execution parsing and footprint aggregation, Ticker routing, staging heatmap/history requests and cache namespaces, prepared Spot identity validation, and UI status/settings. Main files include `src/markets.ts`, `src/feed/{client,protocol,worker,footprint,footprint-service,prepared-footprints,prepared-history,heatmap-cache,staging-service,staging-heatmap,ticker-service}.ts`, `src/heatmap-controls.ts`, `src/indicators/{model,icons}.ts`, `src/panel.ts`, and `src/ticker/{model,panel}.ts`. The narrow post-rollout correction in `src/feed/staging-heatmap.ts` now reports Spot tick size `0.01` on syncing, live, stale, and prepared-history statuses; the Perpetual status stays `0.1`.

Backend implementation was authored in `/tmp/iqterminal-server-spot` and copied to staging at `/opt/iqterminal`. It adds shared market/feed/table selection in `src/market.ts`; Spot aggTrade normalization and tick selection in `src/shared/footprint.ts`; Spot book synchronization in `src/spot-depth.ts`; isolated persistence in `src/execution-store.ts` and `src/depth-collector.ts`; market-aware prepared history in `src/history-core.ts`, `src/history-store.ts`, `src/history-reader.ts`, `src/history-footprints.ts`, and `src/history-api.ts`; and Spot REST/WebSocket gateway routing in `src/server.ts` and `src/history-gateway.ts`. Compose adds independently tagged `spot-collector` and `spot-materializer` services. `ops/migrations/005-spot-market.sql` adds the Spot-only raw tables and grants; `ops/schema.sh` applies it. The original Perpetual collector and materializer use their prior image and process identity.

## Automated verification

Before deployment, the isolated backend copy passed `npm run typecheck`, `npm test` (57/57), `npm run build`, and `docker compose config --quiet`. These tests cover Spot parsing, Spot/Perpetual same-ID/time isolation, snapshot bridging and resync, recovery, market selectors, and prepared history.

After the client Spot tick-size correction, `pnpm exec vitest run tests/staging-heatmap.test.ts` passed 24/24, the full client suite passed 253/253 across 36 files, and `pnpm build` passed (`tsc --noEmit` plus Vite production build). `git diff --check` passed. The build reports the existing large-chunk advisory; it does not fail. The client agent’s focused fixture-browser checks passed 11 ticker tests and 2 heatmap tests. Those browser fixtures are deterministic tests, not live-market evidence.

## Staging rollout and service health

Staging is `sd-fn-01`, project directory `/opt/iqterminal`. The additive migration `005-spot-market.sql` was applied after the backend checks passed. The gateway and Spot images were built; Spot uses the separate `iqterminal-spot-history:local` tag. Only `spot-collector`, `spot-materializer`, and then the `app` gateway were started/replaced. ClickHouse, Perpetual `collector`, Perpetual `materializer`, and `level-watch` were not restarted.

At the latest read-only health check on **2026-10-17 11:11 UTC**, all seven Compose services reported healthy. The documented endpoints returned HTTP 200: ClickHouse `/ping`; Perpetual collector `127.0.0.1:18784/v1/health`; gateway `127.0.0.1:18780/v1/health`; Perpetual history `127.0.0.1:18782/health`; Level Watch `127.0.0.1:18781/v1/level-watches/health`; Spot collector `127.0.0.1:18785/v1/health?market=spot`; and Spot history `127.0.0.1:18783/health`. Both materializers reported `liveLagMs: 0`, `paused: false`, and an empty backlog. Both collectors reported live executions and depth; Level Watch reported ready.

The Perpetual collector remained container `iqterminal-server`, full ID `3df0acd82749bc112019313fcdccb7fff537cb12371fc0ef5bbf635f84091aae`, started `2026-10-13T15:54:46.038970032Z`, identical to its pre-rollout ID/start time. The Perpetual history materializer remained `iqterminal-history-materializer`, full ID `d0afc0aa2dc33a5b852f759b4b63c65324fcbdd67cf5e229f563759c95898a5b`, started `2026-10-13T18:20:12.585491303Z`. The new Spot collector and materializer were `64633566f740847f2b847a2e113ea505b564435d16dbfbd26cfc145da20608d3` and `f13465264d416adcd2fa9f5cbd61472db590daaab80745c2cdc45c6e6108ae27`, respectively.

Staging persisted Spot aggregates and depth records. A Spot `/v1/footprints?market=spot` request returned 15 one-minute bars, 3,289 aggregate records, and source `binance-spot-aggtrade`. The Spot materializer advanced its live cursor and reported zero lag/no backlog. A closed Spot one-minute heatmap bucket reached `ready`; the JSON history tile response contained two Spot-feed tiles and 128 cells. The binary tile response was independently decoded and its root market/feed and nested tile feed all identified Spot. This verifies post-rollout coverage only; it does not imply Spot depth history predates the collector rollout.

## Live delivery and Pi-browser evidence

The simultaneous read-only WebSocket probe through the gateway verified separate Spot and legacy Perpetual streams. Spot advanced from cursor `4091838806` to `4091838814`, was acknowledged, and then advanced to `4091838824`; its instrument and every row were Spot. Perpetual advanced from `3488432907` to `3488432915`, was acknowledged, and then advanced to `3488432917`; the legacy stream omitted market/instrument labels, and no Spot rows appeared in it. See [the persisted ACK evidence](../artifacts/spot-perp-staging-ws-ack.json).

The Pi browser evidence used `/usr/bin/chromium` 154 on the Raspberry Pi host, pointed at Vite staging mode and the live staging API. It exercised concurrent 1-minute Spot and USD-M Perpetual charts, both with live candles, footprints, and heatmaps; panned both charts; and switched the same chart Spot → Perpetual → Spot. At the end both charts were live with 240 projected heatmap bins, 17 footprint bars, and advancing transport cursors. There were no page errors or non-abort failed requests. Eight aborted viewport requests came from superseded pan requests. The full trace is [the Pi run JSON](../artifacts/spot-perp-staging-pi-pan-idle.json), and the end-of-run view is [the Pi screenshot](../artifacts/spot-perp-staging-pi-pan-idle-rollover.png).

The 69.679-second, 29-sample run crossed the 11:05 UTC candle rollover. At 11:05:02.097, the Spot candle had advanced to 11:05 while the newest heatmap tile still began at 11:04; the heatmap status was `syncing`, the projection had 200 bins, and it had no bins for the new candle. At 11:05:04.131, the 11:05 tile appeared, status returned to `live`, and projection returned to 240 bins including 40 current-column bins. The older 11:04 tile remained the newest tile reported during the delay. This is evidence of a brief wait for the new forming tile to become available, not evidence that the prior tile was deleted. The roughly two-second interval without a current Spot column is real; gap-free rollover is not claimed.

Both chart renderers reported Canvas 2D under headless Chromium SwiftShader. The Pi browser’s Performance API sampled about 60.21 seconds: process time 15.74 seconds, script duration 5.80 seconds, task duration 11.04 seconds, 16 long tasks, and maximum sampled frame interval 183.4 ms. These measurements describe this software-rendered run only. They are not hardware-GPU or 60-fps acceptance evidence.

The client fix that reports the Spot heatmap tick size passed unit tests and the production build after the Pi run; the captured browser trace predates that small status-metadata correction. The backend deployment does not need a restart for that client source change. No Spot OI/liquidation data is exposed. No commit or push was performed.

## Rollback

The gateway’s pre-rollout image is preserved as `iqterminal-history:pre-spot-41ce9b4` and the source backup is under `/home/daz/iqterminal-rollback/spot-predeploy-41ce9b4`. If Spot service or API checks fail, stop only the Spot services, retag the saved gateway image, and update only the app. Keep the additive Spot tables and state for diagnosis; do not drop them or clear Perpetual state:

```sh
cd /opt/iqterminal
docker compose stop spot-collector spot-materializer
docker image tag iqterminal-history:pre-spot-41ce9b4 iqterminal-history:local
docker compose up -d --no-deps app
docker compose ps
```

## Current boundary

Spot candle/footprint/heatmap behavior is accepted on private staging for the checks above. Spot heatmaps remain staging-service-only; direct mode reports the limitation without falling back to Perpetual depth. Spot history is bounded by locally retained records and the venue’s undocumented aggTrade retention. Snapshot-bounded outer depth remains explicitly partial. The Pi browser evidence is functional and software-rendered, with the observed two-second current-tile rollover delay; it is not a hardware-GPU performance guarantee.

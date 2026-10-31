# Market Comparison

Market Comparison overlays native Hyperliquid perpetual candle closes on a shared percent-change axis. It is a dockable chart panel, implemented with the existing OpenAlgo chart engine and dedicated feed worker.

## Markets

The default comparison contains five markets. SILVER is available from the market selector.

| Label | Native Hyperliquid coin | Product |
| --- | --- | --- |
| BTC | `BTC` | Hyperliquid validator-operated BTC perpetual |
| XYZ100 | `xyz:XYZ100` | HIP-3 perpetual proxy for Nasdaq 100 exposure |
| SP500 | `xyz:SP500` | HIP-3 perpetual proxy for S&P 500 exposure |
| GOLD | `xyz:GOLD` | HIP-3 perpetual proxy for gold exposure |
| CL | `xyz:CL` | HIP-3 perpetual proxy for crude oil exposure |
| SILVER | `xyz:SILVER` | HIP-3 perpetual proxy for silver exposure |

The `xyz:` markets are builder-deployed perpetuals. Their labels describe market exposure; they are not CME/COMEX/NYMEX futures, cash indices, ETFs, or spot instruments. Hyperliquid documents HIP-3 as builder-deployed perpetuals with independent DEX settings and market operation handled by the deployer ([HIP-3 overview](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)).

The panel validates each exact native symbol against the matching Hyperliquid `meta` response before requesting history or subscribing. A missing or unavailable symbol is shown as unavailable; the panel does not substitute another venue or instrument.

## Open and configure

Click **Market Comparison** in the terminal footer to add a dockable panel. Use **Markets** to choose instruments, show or hide lines, and set colors. Choose a window and candle interval from the panel controls. Drag or zoom to compare another visible range; select **LIVE** to return to the newest window.

## Percent axis and timestamp gaps

Each line keeps its native prices. The displayed value is calculated as:

```text
percent change = (native close at time t / native close at T0 - 1) × 100
```

`T0` is a UTC candle-open timestamp present in every visible line. It follows the first shared timestamp in the visible range. A candle without an exact matching timestamp remains a gap; values are never forward-filled. When visible series have no common timestamp, the panel displays a no-overlap message and suppresses the comparison labels.

The crosshair readout shows each matching candle's native close and percent change from `T0`. A missing candle at the crosshair is rendered as an em dash. Right-edge labels show the latest available candle close for each visible line, expressed as percent change from that line's exact `T0` close.

The baseline is anchored to the visible start candle while the viewport is paused. Panning or zooming pauses live following and updates the baseline to the new visible range. Selecting **LIVE** returns to the newest requested window. A live window advances as new candles arrive; an explicit viewport gesture pauses it until LIVE is selected again.

The live viewport refits the selected candle count after a Dockview resize. The fixture browser check selects 24h/1m at the panel's 240px minimum width and verifies all 1,440 requested data bars remain visible, even when another selected line has only three observations.

The requested windows are 1h, 4h, and 24h. Intervals are 1m, 5m, and 15m. The default is 4h at 1m. The resulting target candle counts are:

| Window | 1m | 5m | 15m |
| --- | ---: | ---: | ---: |
| 1h | 60 | 12 | 4 |
| 4h | 240 | 48 | 16 |
| 24h | 1,440 | 288 | 96 |

Hyperliquid's candle snapshot API accepts the coin, interval, and millisecond start/end times and provides up to 5,000 recent candles. Candle streaming uses the same native coin and interval through the WebSocket candle subscription ([candle snapshot](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot), [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)).

## Data path and limits

The existing dedicated worker sends history requests directly to `https://api.hyperliquid.xyz/info` and subscribes to `wss://api.hyperliquid.xyz/ws`. This remains the comparison data path in normal and staging builds. No application backend, database, or additional worker is involved. Hyperliquid's `meta` request accepts an optional perp DEX name; the empty value selects the first perp DEX, while `xyz` selects the builder-deployed DEX metadata ([perpetual metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-perpetuals-metadata-universe-and-margin-tables)).

Panels with the same provider, venue, market type, native symbol, interval, and candle-close basis share one worker entry and upstream subscription. Each panel retains its own viewport, line visibility, color, and live-follow setting. Replacing a panel request cancels its previous subscription. History reads are coalesced by identity and time range through the shared history scheduler.

Resource bounds are explicit:

- 5,000 retained candles per identity, matching the public history ceiling.
- 512 pending candle patches before the worker coalesces to a snapshot.
- 18 cached identities, with inactive cache entries expiring after five minutes.
- At most two active history reads in the shared history scheduler.
- Metadata cache expires after five minutes.
- Eight combined candle-chart and Market Comparison engine contexts per layout.

On disconnect, cached history remains available while the worker reconnects and repairs the recent range. History and socket failures remain visible in the panel; they do not activate fixture data.

## Settings and persistence

The market selector controls selected instruments, line visibility, and colors. At least one selected line must remain visible. Hidden lines are excluded from comparison subscription and baseline selection. The display timezone affects the baseline label and readout formatting; candle timestamps and identity keys stay UTC.

Comparison configuration is schema version 1, stored in layout version 6. Layout versions 1 through 5 continue to restore their existing supported panels. The 8-context limit counts candle and Market Comparison panels together on add and restore.

## Explicit fixtures and diagnostics

Use `?fixture=1` only in a development or diagnostics-enabled build to select deterministic fixtures. The shell identifies the mode as `BASIS · FIXTURE`. The existing worker then uses a bounded in-memory comparison source with synthetic metadata, history, and candle updates. The normal and staging builds use direct Hyperliquid data. There is no connectivity-failure fallback to fixtures.

The development diagnostics expose the selected transport, socket creations, history requests, active comparison identities, retained candles, pending history, chart draw counts, and current viewport. These counters support deterministic browser checks; they are not venue or hardware performance measurements.

## Validation

Focused coverage lives in `tests/market-comparison.test.ts`, `tests/browser/market-comparison-engine.spec.ts`, `tests/browser/market-comparison-fixture.spec.ts`, `tests/browser/market-comparison-performance.spec.ts`, and `tests/browser/market-comparison.spec.ts`. The deterministic fixture browser test blocks the public endpoint and checks that no public comparison requests occur. The direct browser smoke verifies the public history and stream path separately. Fixture results are not live venue evidence.

Performance measurements must name the machine, browser, panel count, selected markets, window, interval, renderer, and measurement interval. Report observed frame intervals and long tasks for the tested setup. Do not infer 60 fps from frame submission, transfer the result to another host, or claim Raspberry Pi performance from a desktop run.

### Local fixture measurement — 2026-10-29

The bounded run used the locally identified Raspberry Pi 5 Model B Rev 1.0 (Cortex-A76, four visible cores, approximately 8 GiB RAM), Debian 12, and Headless Chromium 155.0.8059.79 at 1366×768. It rendered one visible Market Comparison chart with the five default lines, 24h/1m history (1,443 retained candles per line, including the service's history pre-roll), and the Canvas 2D renderer. The default candle panel was removed before timing; the measured plot width was 1,274px and all 1,440 target data bars were visible.

For eight seconds, the test injected one synthetic candle patch per browser animation-frame callback, rotating across the five lines. It measured actual chart draws and draw-to-draw intervals, plus browser long tasks. The final browser-batch run recorded 146 submitted update frames, 146 chart draws, and 145 intervals: p50 50.7 ms, p95 103.5 ms, maximum 144.4 ms. The browser recorded 13 long tasks: p95 and maximum 141 ms. The test passed its data, full-window visibility, draw-count, and no-public-request assertions.

A standalone repeat on the same host and plot width recorded 221 submitted frames, 221 draws, and 220 intervals: p50 32.5 ms, p95 58.6 ms, maximum 225.9 ms. It recorded 12 long tasks with p95 and maximum 226 ms. These samples show run-to-run timing variation and are reported separately.

This is a local synthetic-input stress run on the named Pi 5. It does not measure live venue timing or a normal market update cadence, and it does not support a 60 fps claim. Reproduce it with a diagnostics-enabled staging build, `?fixture=1`, and `tests/browser/market-comparison-performance.spec.ts`; the test blocks the public comparison history endpoint and uses only the selected in-worker fixture transport.

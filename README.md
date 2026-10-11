# Basis — terminal T0

A saved, dockable BTC candlestick workspace with Binance BTCUSDT Spot, Binance USD-M perpetual, and Hyperliquid BTC perpetual instruments. The initial pair remains Binance USD-M and Hyperliquid perpetual. Vanilla strict TypeScript, Dockview Core, and official OpenAlgo Charts 2.6.0 using its Canvas2D renderer. Optional OpenScript studies run locally in bounded dedicated workers. No account, keys, backend or React.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm preview --port 4173
```

Node 22.19+ and pnpm 10.18+ (Node 22.19 used here). On this machine: `source /home/daz/.nvm/nvm.sh` first if needed. Open the URL printed by Vite. Direct public exchange access requires reachable REST and WebSocket endpoints; failures remain visible and Retry is explicit.

Drag tabs onto another group's tab bar to combine/reorder them; drag onto its content edges to dock above/below/beside. Drag the narrow splitters to resize. Close with each tab's close button. Add chart places another chart beside the active group. Reset layout restores the initial pair. Eight charts maximum.

The footer **Theme** selector offers **System**, **Ivory (light)** and **Dark**, using the original terminal Dark palette and OpenAlgo Ivory. A saved light/dark choice takes precedence; without one, the app follows the device preference and defaults to Dark when no preference is available. System clears the saved override and follows device changes. Theme switches preserve chart data, studies and manual viewports. Blocked storage still permits session-only switching.

Each chart’s **Chart settings** gear includes **Gridlines**. The grid follows labelled time-axis candle positions and price-axis ticks during pan, wheel zoom and manual price scaling. Visibility is saved per panel and retained across Candles/Footprint switching; older layouts default to grid on.

Groups with multiple tabs show a cycle control before the tab strip. Choose the seconds per tab (10 by default) and Start; while running, reopen the control to Stop or change the interval and Restart. Each group runs independently in its current left-to-right tab order. Cycling waits a full interval before the first switch, pauses while the document is hidden, and starts a fresh interval after a manual tab change. Running timers are session-only and stop when a group closes or has one tab.

Hold the left mouse button and drag a plot to pan horizontally and vertically; wheel to zoom time and price together around the cursor, move the pointer for OHLC/crosshair. Vertical dragging holds the price range in place across updates and horizontal movement. Latest, Home or double click returns to the newest candle and restores price autoscaling; arrow keys pan horizontally, +/− zoom a focused plot. Labels use UTC. Missing intervals occupy adjacent bar-index positions without invented candles.

The instrument selector distinguishes **Binance BTCUSDT Spot** (USDT quote, BTC base-asset volume; metadata omits derivative collateral) from **Binance BTCUSDT USD-M Perp** (USDT quote/collateral) and **Hyperliquid BTC Perp** (USD price, USDC settlement/collateral); hover the selector for metadata. Persisted layouts without a market field continue to open Binance as USD-M Perp. Spot candles use Binance's public Spot klines and market-data-only candle stream; Spot and USD-M keep separate worker connections and cache identities. EMA and volume studies use the selected instrument's native OHLCV. Binance depth remains USD-M Perp only.

## Session Footprints

Footprint is available on Binance BTCUSDT USD-M Perp. It groups classified public `aggTrade` observations into execution-based bid/ask, delta and volume rows. Collection starts when a chart selects Footprint; it has no trade-history backfill, so the first interval is partial and saved layouts retain settings rather than collected executions. Candles and OpenScript studies continue to use native exchange candle history. Price buckets start at fixed width multiples: $25 covers [$82,800, $82,825), with the upper edge belonging to the next row. Footprint and heatmap share these bounds, and hover shows the range. The USDT price-level width, BTC/USDT volume-unit toggle and display options are saved per chart; hidden charts keep bounded collection while their renderer sleeps. See [Footprint behavior, coverage and limits](docs/footprints.md).

## Order-book heatmap

Enable **Heatmap** on Candles or Footprint to collect resting Binance BTCUSDT USD-M liquidity. The adjacent gear controls tick-aligned price rows, average/observed peak, opacity, intensity and labels. In Footprint mode, the chart toolbar's Price level sets the size and fixed lower-bound grid for both footprint and heatmap cells. Candle heatmaps retain an independent row setting. Changing the effective resolution starts fresh collection unless another chart retains it; reload retains settings only. It shares the synchronized depth connection with OpenScript depth studies. Spot and Hyperliquid explicitly report unavailable heatmap data. See [quantity, coverage and resource limits](docs/orderbook-heatmap.md).

## Local OpenScript studies

Open **Indicators** on any chart to search categories and add a built-in EMA, candle-volume histogram, Binance depth study, or local script with its default inputs; Binance depth is available only on USD-M Perp. Open **Manage library** to edit or preview source, save a built-in copy, or import/export a plain `.oscript` source file or IQTerminal `.json` package. Each study's native chart-legend source control opens its exact pinned revision, and its settings control changes only that chart attachment. Scripts and immutable source revisions stay in this browser's IndexedDB; chart layouts pin the exact revision and its inputs, so attached studies can be restored on the same device.

Sparse line plots preserve every `null` gap. When a plot has an isolated finite sample with no finite neighbour, the chart adapter adds a small native dot at that exact plot/time/price; it keeps only the latest 64 isolated samples per study. This makes one live depth observation visible without carrying values across missing candles or joining unrelated points.

The editor accepts the OpenScript study language, not JavaScript. Study compilation and calculations run in separate workers from the market-data worker. Scripts receive selected chart OHLCV and the explicitly named Binance depth series; they get no file, network, account, order, or trading access. Host limits cap source size, history, plots, runtime work, per-study update time, and live worker count. See [the host contract and data limits](docs/architecture.md#openscript-studies) and [local verification results](docs/verification.md#openscript-and-live-depth).

For deterministic browser checks and benchmarks, build a **diagnostic production bundle**:

```sh
VITE_DIAGNOSTICS=1 pnpm build
pnpm preview --port 4173
pnpm test:browser
pnpm bench
pnpm smoke:live
pnpm smoke:live-spot
node scripts/visual.mjs
node scripts/visual-openscript.mjs
```

`?fixture=1` explicitly selects deterministic 5,000-bar fixtures in development/diagnostic builds and displays FIXTURE. Ordinary builds ignore that query, expose no diagnostic global, and always connect to exchanges. Synthetic burst generation is test-only. Browser scripts use `/usr/bin/chromium`; override with `CHROMIUM_PATH`. Set `TERMINAL_URL` for another preview address.

See [architecture](docs/architecture.md), [OpenScript evidence map](docs/openscript-milestone.md) and [verification/performance](docs/verification.md), plus screenshots and machine-readable results in `artifacts/`. Reference retained in `docs/reference/terminal.png`.

OpenAlgo Charts is pinned to 2.6.0 and OpenScript to 0.8.1 (both Apache-2.0). The app footer's Licences link opens the bundled runtime notices and full license texts.

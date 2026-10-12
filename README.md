# Basis — terminal T0

A saved, dockable BTC candlestick workspace with Binance BTCUSDT Spot, Binance USD-M perpetual, and Hyperliquid BTC perpetual instruments. The initial pair remains Binance USD-M and Hyperliquid perpetual. Vanilla strict TypeScript, Dockview Core, and official OpenAlgo Charts 2.6.0 using its Canvas2D renderer. Optional OpenScript studies run locally in bounded dedicated workers. No account, keys or React. An optional staging market-data backend supports local development.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm preview --port 4173
```

Node 22.19+ and pnpm 10.18+ (Node 22.19 used here). On this machine: `source /home/daz/.nvm/nvm.sh` first if needed. Open the URL printed by Vite. Direct public exchange access requires reachable REST and WebSocket endpoints; failures remain visible and Retry is explicit.

For durable staging Binance USD-M Footprints, historical/live heatmaps and proxied native candles, run `pnpm tunnel:staging` and `pnpm dev:staging` in separate terminals, then open `http://127.0.0.1:5173/`. See [staging setup, coverage and verification](docs/staging-market-data.md). Ordinary development remains direct to venues.

Drag tabs onto another group's tab bar to combine/reorder them; drag onto its content edges to dock above/below/beside. Drag the narrow splitters to resize. Close with each tab's close button. Add chart places another chart beside the active group. Reset layout restores the initial pair. Eight charts maximum.

The footer **Theme** selector offers **System**, **Ivory (light)** and **Dark**, using the original terminal Dark palette and OpenAlgo Ivory. A saved light/dark choice takes precedence; without one, the app follows the device preference and defaults to Dark when no preference is available. System clears the saved override and follows device changes. Theme switches preserve chart data, studies and manual viewports. Blocked storage still permits session-only switching.

Each chart’s **Chart settings** gear includes **Gridlines**. The grid follows labelled time-axis candle positions and price-axis ticks during pan, wheel zoom and manual price scaling. Visibility is saved per panel and retained across Candles/Footprint switching; older layouts default to grid on.

Groups with multiple tabs show a cycle control before the tab strip. Open its compact local menu, choose the seconds per tab (10 by default), and press Play. While running the tab-strip icon shows Pause; reopen the menu and press Pause to stop, then choose an interval and Play to resume. Changing the interval while running applies when you leave the field. Escape or a click outside dismisses the menu. Each group runs independently in its current left-to-right tab order. Cycling waits a full interval before the first switch, pauses while the document is hidden, and starts a fresh interval after a manual tab change. Running timers are session-only and stop when a group closes or has one tab.

Hold the left mouse button and drag a plot to pan horizontally and vertically; wheel to zoom time and price together around the cursor, move the pointer for OHLC/crosshair. Vertical dragging holds the price range in place across updates and horizontal movement. Latest, Home or double click returns to the newest candle and restores price autoscaling; arrow keys pan horizontally, +/− zoom a focused plot. Labels use UTC. Missing intervals occupy adjacent bar-index positions without invented candles.

The instrument selector distinguishes **Binance BTCUSDT Spot** (USDT quote, BTC base-asset volume; metadata omits derivative collateral) from **Binance BTCUSDT USD-M Perp** (USDT quote/collateral) and **Hyperliquid BTC Perp** (USD price, USDC settlement/collateral); hover the selector for metadata. Persisted layouts without a market field continue to open Binance as USD-M Perp. Spot candles use Binance's public Spot klines and market-data-only candle stream; Spot and USD-M keep separate worker connections and cache identities. EMA and volume studies use the selected instrument's native OHLCV. Binance depth remains USD-M Perp only.

## Unified indicators

Use **Indicators** to search and add scripts, Footprint or Order-book Heatmap. Each chart’s collapsible active list provides visibility, settings and removal; scripted entries also provide Edit Script and Duplicate. Hiding native layers retains bounded collection; removing them releases their consumer. Chart settings owns the saved base-candle preference. See [the indicator contract and migration](docs/indicators.md).

## Session Footprints

Footprint is available on Binance BTCUSDT USD-M Perp. It groups classified public `aggTrade` observations into execution-based bid/ask, delta and volume rows. Collection starts when Footprint is added through Indicators; it has no trade-history backfill, so the first interval is partial and saved layouts retain settings rather than collected executions. Candles and OpenScript studies continue to use native exchange candle history. Price buckets start at fixed width multiples: $25 covers [$82,800, $82,825), with the upper edge belonging to the next row. Footprint and heatmap share these bounds, and hover shows the range. The USDT price-level width, BTC/USDT volume-unit toggle and display options are saved per chart; hidden charts keep bounded collection while their renderer sleeps. See [Footprint behavior, coverage and limits](docs/footprints.md).

## Order-book heatmap

Add **Order-book Heatmap** through **Indicators** on ordinary candles or a Footprint presentation to collect resting Binance BTCUSDT USD-M liquidity. Its active-indicator row settings controls tick-aligned price rows, average/observed peak, opacity, intensity and labels. In Footprint mode, Footprint settings’ Price level sets the size and fixed lower-bound grid for both footprint and heatmap cells. Candle heatmaps retain an independent row setting. In ordinary direct mode, changing the effective resolution starts fresh collection unless another chart retains it; reload retains settings only, and it shares the synchronized depth connection with OpenScript depth studies. In staging mode, the server records independently and the worker reloads historical liquidity at the selected resolution; partial outer regions and gaps stay visible. Spot and Hyperliquid explicitly report unavailable heatmap data. See [quantity, coverage and resource limits](docs/orderbook-heatmap.md).

## Trade Ticker

Add **Trade Ticker** from the bottom toolbar for live Binance BTCUSDT USD-M reported prints. **Settings** edits the display filter, aggressor filter, market scope and size tiers; **Pause** freezes the visible tape while collection continues. Enable browser audio explicitly, and use the application **Notifications** button for master mute/volume and sound previews. Settings persist with the dock layout; trade history is session-only. Spot/Hyperliquid execution feeds are not available yet. See [Trade Ticker usage and limits](docs/trade-ticker.md).

## Local OpenScript studies

Open **Indicators** on any chart to search categories and add a built-in EMA, candle-volume histogram, Binance depth study, or local script with its default inputs; Binance depth is available only on USD-M Perp. Open **Manage library** to edit or preview source, save a built-in copy, or import/export a plain `.oscript` source file or IQTerminal `.json` package. Each study’s active-list Edit Script control opens its exact pinned revision, and its active-list settings control changes only that chart attachment. Scripts and immutable source revisions stay in this browser's IndexedDB; chart layouts pin the exact revision and its inputs, so attached studies can be restored on the same device.

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

Chart tabs show the venue icon, native ticker and a small S (spot) / P (perpetual) marker. Hover for the full market and interval. **Alt+1…9** activates that numbered tab in the active tabset; numbers track left-to-right reordering. Shortcuts are disabled in editable controls and open dialogs.

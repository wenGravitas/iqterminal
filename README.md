# Basis — terminal T0

Two native BTC perpetual candlestick panels in a saved, dockable desktop workspace. Vanilla strict TypeScript, free Dockview Core, owned WebGL2 candles and Canvas axes/crosshair. No account, keys, backend, React or packaged chart engine.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm preview --port 4173
```

Node 22.19+ and pnpm 10.18+ (Node 22.19 used here). On this machine: `source /home/daz/.nvm/nvm.sh` first if needed. Open the URL printed by Vite. Direct public exchange access requires reachable REST and WebSocket endpoints; failures remain visible and Retry is explicit.

Drag tabs onto another group's tab bar to combine/reorder them; drag onto its content edges to dock above/below/beside. Drag the narrow splitters to resize. Close with each tab's close button. Add chart places another chart beside the active group. Reset layout restores the initial pair. Eight charts/contexts maximum.

Drag a plot to pan, wheel to zoom around the cursor, move the pointer for OHLC/crosshair. Latest, Home or double click returns to the newest candle; arrow keys pan, +/− zoom a focused plot. Price autoscales over visible bars. Labels use UTC. Missing intervals occupy adjacent bar-index positions without invented candles.

Binance is **BTCUSDT linear perpetual**, USDT quote/collateral. Hyperliquid is **BTC perpetual**, USD price and USDC settlement/collateral; hover the instrument control for metadata. Native OHLCV, never spot or mark-price substitutes.

For deterministic browser checks and benchmarks, build a **diagnostic production bundle**:

```sh
VITE_DIAGNOSTICS=1 pnpm build
pnpm preview --port 4173
pnpm test:browser
pnpm bench
pnpm smoke:live
node scripts/visual.mjs
```

`?fixture=1` explicitly selects deterministic 5,000-bar fixtures in development/diagnostic builds and displays FIXTURE. Ordinary builds ignore that query, expose no diagnostic global, and always connect to exchanges. Synthetic burst generation is test-only. Browser scripts use `/usr/bin/chromium`; override with `CHROMIUM_PATH`. Set `TERMINAL_URL` for another preview address.

See [architecture](docs/architecture.md) and [verification/performance](docs/verification.md), plus screenshots and machine-readable results in `artifacts/`. Reference retained in `docs/reference/terminal.png`. Only T0 is implemented.

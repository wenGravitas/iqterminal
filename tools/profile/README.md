# Live Order Walls profile

The 30-hour Spot and USD-M Perp probes use the real Binance feeds and archive. They are outside the default Vitest and Playwright test directories. The dedicated Playwright config has no `webServer` hook and never starts, stops, or restarts the app or staging services.

Start and verify the private staging services separately before an intentional run. Then opt in to one market at a time:

```sh
IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 pnpm exec playwright test --config=playwright.order-walls-live.config.ts --grep "live spot"
IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 pnpm exec playwright test --config=playwright.order-walls-live.config.ts --grep "live perpetual"
```

The default base URL is `http://127.0.0.1:5173`; set `IQTERMINAL_ORDER_WALLS_BASE_URL` to override it. Each market run writes its report, page metrics, and screenshots under `artifacts/order-walls/`. A run waits for archive history across the pinned 30-hour viewport and for a candle rollover, so it can take several minutes; the perpetual case waits for its 15-minute candle rollover.

The report distinguishes archive completeness from current-head liveness. Partial depth coverage and retained gaps remain explicit in the output; a valid current head does not imply complete history.

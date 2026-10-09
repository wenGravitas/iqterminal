# Verification record

The migration was verified on this workspace's Raspberry Pi ARM64 host with Chromium 154.0.8037.92. These results describe that machine and browser, not an ordinary integrated-graphics laptop. Live exchange checks and synthetic chart benchmarks are recorded separately.

## Package and build

`openalgo-charts` is pinned to 2.6.0. Its npm tarball SHA-512 was checked against published package metadata before installation; the manifest and lockfile use the exact semver version and published integrity. `pnpm install --lockfile-only --offline --frozen-lockfile` passes. A complete offline frozen install cannot run because pnpm has no registry tarball in its store (`ERR_PNPM_NO_OFFLINE_TARBALL`); online package-manager metadata/tarball requests timed out in this environment. Do not treat lock-only verification as clean-install proof. The current build and tests used the verified package installed from the local tarball.

`pnpm typecheck`, `pnpm test` (16 tests), and `VITE_DIAGNOSTICS=1 pnpm build` pass. The diagnostic production build emits a 748.82 kB minified JavaScript bundle (191.92 kB gzip) and reports Vite's 500 kB chunk warning. The dependency tree is captured in `artifacts/dependency-tree.txt`; the runtime dependencies are Dockview Core and OpenAlgo Charts, with no React or OpenScript runtime. Runtime license texts and notices are served from `/licenses/` and linked in the app footer.

The ordinary `pnpm build` also passes (748.21 kB minified, 191.62 kB gzip). In an ordinary production browser check, opening `/?fixture=1` showed the normal BASIS brand, two charts, no `window.__terminal` diagnostics global, and direct requests to Binance and Hyperliquid; both venues reached live state with no page errors.

## Browser and live behavior

`pnpm test:browser` passes seven Chromium checks covering two-panel rendering, time/price drag and latest/autoscale reset, pan preservation across live patches, fixture state, control/layout persistence and corrupt-layout recovery, add/group/reorder/split/resize/close/empty states, hidden-tab frame and readout suspension with reactivation, historical correction, exact UTC-second timestamp mapping and 5,000-bar retention, panel disposal, the recoverable HTTP error state, Dockview tab/splitter drag, and the in-app third-party license links.

`pnpm smoke:live` used direct, non-fixture public connections. At 1m, 5m, 15m, 1h and 4h, both Binance BTCUSDT USD-M and Hyperliquid BTC perpetual loaded history and reached live state. In every interval the current candle changed and its freshness timestamp advanced during the sample. There were no page or request errors. Raw results and the live screenshot are in `artifacts/live-results.json` and `artifacts/live-terminal.png`.

`node scripts/visual.mjs` captured the diagnostic fixture at 1366×768 and 1920×1080. The current screenshots are `artifacts/terminal-1366x768.png` and `artifacts/terminal-1920x1080.png`; the before-migration images are retained as `artifacts/custom-renderer-before-openalgo-1366x768.png` and `artifacts/custom-renderer-before-openalgo-1920x1080.png`. The in-app license link is compact in the footer. Firefox remains unverified on this host: the system compositor previously logged `RenderCompositorSWGL failed mapping default framebuffer` and did not produce a screenshot.

## Performance comparison

The baseline and final runs use the same host/browser, 1366×768 viewport, DPR 1, 5,000-bar fixtures, a response-paced pan/zoom/resize loop, and a synthetic 1,000 worker-message/second candle path. The baseline completed 6/6/5 interactions at 1/2/8 panels; the final run completed 5/5/6. The number of interactions therefore differs, so this is a same-procedure comparison, not an exactly matched action-count comparison. The final run uses the shipping Canvas2D renderer. This is a synthetic stress measurement, not a live exchange-load test. It records browser RAF intervals and long tasks, not GPU execution time.

| Visible charts | Baseline p50 / p95 / p99 RAF (ms) | OpenAlgo Canvas2D p50 / p95 / p99 RAF (ms) | Baseline / final max long task (ms) | Baseline / final approximate JS heap (MiB) |
|---:|---:|---:|---:|---:|
| 1 | 16.7 / 33.4 / 100 | 83.3 / 166.7 / 283.3 | 621 / 113 | 7.6 / 11.1 |
| 2 | 16.7 / 66.7 / 150 | 50.1 / 166.7 / 649.9 | 131 / 262 | 8.9 / 14.6 |
| 8 | 50 / 116.7 / 166.5 | 100 / 250 / 450 | 139 / 279 | 14.6 / 18.6 |

Final p95 RAF time is about 5.0×, 2.5× and 2.14× the baseline at 1, 2 and 8 charts, respectively. The 8-chart maximum long task is also higher (279 ms versus 139 ms). Performance acceptance remains open; do not claim a 60fps target or performance pass. The auto/WebGL comparisons and their separate CPU profile are in `artifacts/performance-openalgo-auto.json`, `artifacts/performance-openalgo-auto-no-motion.json` and `artifacts/performance-profile-openalgo-auto.json`; the measured Canvas2D run is in `artifacts/performance-openalgo-canvas2d-final.json`, with the baseline in `artifacts/performance-before-openalgo.json`.

The final benchmark had no page errors. Its hidden-tab probe observed `visible=false` before and after, 850 synthetic worker messages, a changed candle, and zero chart draw delta. Ten add/close cycles returned to two chart instances; no shared GPU-context count applies to the Canvas2D renderer. Approximate JavaScript heap is subject to garbage collection and excludes worker, native, and canvas allocations. Earlier CPU sampling of the auto/WebGL path attributed more time to chart drawing/compositing, axis text, geometry reads, and accessibility summaries than to the adapter's patch bookkeeping; this profile is diagnostic and is not the selected renderer's performance result.

## Scope limits

The chart migration does not add trade-by-price data, footprints, indicators, script execution, AI, or trading. OHLCV cannot reconstruct footprint data; that later work needs a separate trade stream and bounded per-price aggregation. User scripts need a separately designed restricted runtime and must not share the feed worker. The performance regression remains the next measured engineering task.

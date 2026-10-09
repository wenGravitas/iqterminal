# Handoff

Terminal T0 now uses the official, exact-pinned OpenAlgo Charts 2.6.0 Canvas2D renderer behind a small adapter. The worker and native Binance/Hyperliquid data paths remain in place. The app includes a footer Licences link to the shipped OpenAlgo and Dockview license texts/notices.

Typecheck, 16 unit tests, seven Chromium browser checks, diagnostic production build, visual screenshots, and live 1m/5m/15m/1h/4h history-plus-update checks for both venues passed. See [verification](verification.md) for evidence and limitations.

Performance acceptance remains open: the selected renderer's same-host p95 RAF measurements are 166.7/166.7/250ms against baseline 33.4/66.7/116.7ms at 1/2/8 charts. The final 8-chart maximum long task is 279ms against baseline 139ms. Both runs use the same response-paced procedure, but the completed interaction counts differ (baseline 6/6/5, final 5/5/6), so this is not an exact action-count match. The exact registry tarball is checksum-verified, and lock-only frozen resolution passes; a complete frozen install remains unverified because the registry tarball is not available in pnpm's offline store and online package-manager requests timed out.

The optional `openalgo-charts/profile` subpath already exports `FootprintAggregator` and the `Footprint` primitive; future footprint work still needs a live classified-trades feed and bounded historical retention, as OHLCV candles do not contain enough information. Script execution needs a separately designed restricted runtime. Neither extension is implemented here.

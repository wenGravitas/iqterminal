# Terminal T0

Follow /home/daz/.codex/AGENTS.md for Luna Max routing and bounded Sol adviser escalation. Do not alter model configuration or substitute a different model silently.

Keep this milestone narrow: dockable candle charts for native Binance BTCUSDT USD-M perpetual and Hyperliquid BTC perpetual only. No React, third-party chart engine, trade execution, indicators, footprints, script runtime, AI, backend, or speculative WASM abstraction.

Use docs/reference/terminal.png as visual authority: almost black, neutral charcoal, small system monospace, square compact controls, thin dock borders, restrained red/green. Preserve the custom Dockview theme.

Controls/configuration stay in native DOM; the dedicated worker owns public exchange connections, normalization, reconciliation and bounded shared caches. Chart kernels stay DOM-free with Float64 CPU time/prices and pixel-relative GPU geometry. Use incremental patches and the single dirty-visible-chart RAF scheduler. Dispose subscriptions, inputs, observers, GPU resources and workers. Respect the eight-context budget.

Fixtures and diagnostics require explicit development selection. Never use fixture data as a connectivity fallback. Distinguish deterministic tests, real venue checks and measured platform performance. Do not claim 60fps based on submission time or on another host. Keep dependency notices and lockfile. Run focused tests, typecheck/build and relevant browser checks after material changes.

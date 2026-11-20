# IQ Terminal

Follow /home/daz/.codex/AGENTS.md for Sol routing (Low reasoning for workers/subagents) and bounded Astra adviser escalation. Do not alter model configuration or substitute a different model silently.

Work within the current requested scope and preserve the existing native-DOM terminal architecture. Trading Foundation signing remains testnet-only; real venue acceptance and production trading require their separately documented authorization and validation.

Use docs/reference/terminal.png as visual authority: almost black, neutral charcoal, small system monospace, square compact controls, thin dock borders, restrained red/green. Preserve the custom Dockview theme.

Controls/configuration stay in native DOM; the dedicated worker owns public exchange connections, normalization, reconciliation and bounded shared caches. Chart kernels stay DOM-free with Float64 CPU time/prices and pixel-relative GPU geometry. Use incremental patches and the single dirty-visible-chart RAF scheduler. Dispose subscriptions, inputs, observers, GPU resources and workers. Respect the eight-context budget.

Fixtures and diagnostics require explicit development selection. Never use fixture data as a connectivity fallback. Distinguish deterministic tests, real venue checks and measured platform performance. Do not claim 60fps based on submission time or on another host. Keep dependency notices and lockfile. Run focused tests, typecheck/build and relevant browser checks after material changes.

## Branch workflow

Carry out all development in `/home/daz/workarea/iqterminal` on the shared `dev` branch. Do not create separate feature branches or development worktrees. Preserve unrelated work already on `dev`. Commit and push development changes to `dev`; merge into and push `main` only when explicitly requested by the user. Before starting the local client, verify it serves this checkout on `dev` so recent fixes are not omitted.

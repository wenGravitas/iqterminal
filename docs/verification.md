# Verification record

Machine: this workspace's Raspberry Pi / ARM64 host, Chromium primary. This is not an ordinary integrated-graphics laptop certification. Exact browser/GPU/frame/cache/context/memory metrics are in artifacts/performance.json and artifacts/platform.json. Real network results are separate in artifacts/live-results.json.

## Commands run

- `pnpm add dockview-core@8.4.1`; `pnpm add -D typescript@7.0.2 vite@8.3.4 vitest@5.0.3 @playwright/test@1.64.0 @types/node@latest` — installed and locked. Registry initially timed out; explicit pinned versions and IPv4-first retry completed. No alternate dependencies substituted.
- `pnpm install --frozen-lockfile --offline` — pass from populated pnpm cache; lockfile install verified. A clean directory at `/tmp/basis-clean-kJgf61` also passed frozen-lockfile offline install, default production build and all tests (the pnpm package cache was prepopulated; no existing node_modules were reused).
- `pnpm typecheck`, `pnpm test`, `VITE_DIAGNOSTICS=1 pnpm build` — pass; 19 focused tests across reconciliation, geometry/coordinates, adapters, history races, reconnect/ref-count cleanup, hard rejection and client switch-away/back token guards.
- `pnpm preview --port 4173`; `pnpm test:browser` — five Chromium checks passed: persistence/corruption; add/group/reorder/directional docking/resize/empty/reload; hidden buffers and context loss/restoration; unavailable REST endpoint; actual native tab drag and pointer splitter resize. Programmatic Dockview APIs cover directional docking; physical drag covers tab merging and splitter movement.
- `pnpm smoke:live` — both real venues load native history, update their current candle, and pass 1m, 5m, 15m, 1h and 4h switches. Every interval's before/after candles and freshness recorded; the final four-second Hyperliquid 1h sample had no additional value/freshness change after reaching live, while its history/live handshake succeeded; zero page/request errors in the final run. Earlier seven-second per-interval waits were insufficient for some history responses; final smoke waits up to 35 seconds for history plus a valid live update.
- `node scripts/visual.mjs` — 1920×1080 and 1366×768 captures. Compared against accessible retained reference; neutral black/charcoal chrome, 26px tabs, 31px outer toolbar with 23px controls, small monospace labels, narrow edges/splitters, right/bottom scales. Panel status moved below time scales after the first comparison. Fixture screenshots explicitly show FIXTURE; live capture separate.
- `node /home/daz/.codex/skills/impeccable/scripts/detect.mjs --json src/style.css src/panel.ts src/main.ts` — no mechanical findings.
- `pnpm list --depth Infinity` — recorded tree: Core has zero dependencies; no React/enterprise/third-party chart engine.
- `node scripts/platform.mjs`; `node scripts/profile.mjs`; `pnpm bench` — platform baseline, bounded trace and production-bundle interaction stress. See measured results below.
- Native `/usr/bin/firefox --headless ... --screenshot` via `node scripts/firefox.mjs` — attempted; system Firefox logged `RenderCompositorSWGL failed mapping default framebuffer` and failed to produce a screenshot within 30s. Firefox rendering remains unverified, not a claimed pass.

## Failures corrected

The initial geometry expectation assumed width 7 at spacing 10, but the documented floor(0.68×spacing) yields 6; corrected fixture expectation. Initial browser failures exposed pagehide persistence overwriting deliberately corrupt storage, and context-restoration extension lookup while lost; both fixed and passing. The actual splitter test initially selected a nonexistent orientation class in current Dockview; selecting the enabled sash resolved it. Feed updates now refresh panel age; client tokens reject queued responses after switching away and back. Resize GPU allocation is deferred to the shared RAF and duplicate Dockview-dimension/ResizeObserver allocation paths removed after the trace identified a >50ms ResizeObserver callback.

## Performance scope

Repeatable benchmark: diagnostic **production** bundle, explicit deterministic 5,000-bar fixtures; six-second two-chart interaction and ten-second four-visible-chart stress, three unique series, two Binance panels sharing a feed, 1,000 synthetic native candle wire messages/second total generated within the worker and passed through JSON parsing, adapter validation and the normal reconciliation/coalescing/patch path. This tests candles, not trades or footprints. Pan, wheel zoom, resize, tab hide/show, and ten add/close cycles included. Exact durations/counts and frame percentiles are measured rather than assumed.

The first overlapping-browser run was slow; it is not used as final platform acceptance. A separate platform probe showed idle and blank-page RAF medians around 16.7ms. Hardware WebGL is Broadcom V3D through ANGLE/OpenGL ES; Chromium reports enabled GPU compositing, WebGL, Canvas and rasterization. These are hardware-Pi observations, not software-renderer benchmark claims and not laptop results.

Final numbers are recorded in the measurement table below. No GPU elapsed-time/readback measurement is taken: RAF intervals, long tasks and JavaScript/GPU submission counts do not measure GPU execution time. Startup/compilation and context creation may stall; benchmark metrics reset after warmup. Memory is Chromium's available approximate JS heap and can fluctuate with GC; it does not include all GPU/worker/native allocations.

Correctness/resource checks: shared-series last candles agree; hidden panel draws/uploads have zero delta; caches bounded, inactive cache zero; lifecycle returns to four panels/four owned contexts after each cycle. Synthetic transports stand in for two shared venue socket lifecycles; actual network socket count is zero in fixture mode. Live sockets were checked separately. Shell/panel node identity remains stable while data patches arrive. Ordinary builds omit the diagnostic entrypoint and ignore fixture selection. The final ordinary production build passed and a browser check confirmed two shell charts, no diagnostic global and no fixture activation even with `?fixture=1`. WebGL-disabled Chromium still displayed both usable shell panels and capability messages; DPR 2 produced 1342×1304 backing pixels for a 671×652 CSS plot.


| Run (1366×768, DPR 1) | RAF median / p95 / p99 | Recorded long tasks |
|---|---|---|
| Two visible charts | 16.7 / 83.3 / 216.7 ms | 222ms, 225ms |
| Four visible charts + synthetic 1,000/s | 50.1 / 166.7 / 233.3 ms | 80ms, 65ms, 174ms, 95ms, 50ms, 63ms, 72ms, 80ms, 84ms, 88ms, 61ms, 60ms, 82ms, 56ms, 55ms, 51ms, 109ms, 54ms, 151ms, 51ms, 64ms, 51ms, 59ms |

Final run with no concurrent task-owned builds/browser checks: Chromium 154.0.8037.92; Broadcom V3D hardware WebGL through ANGLE. Both runs preserved shell panel identity; shared Binance candles agreed. Hidden draws/uploads delta 0/0. Final resources: 3 active series, 4 panel subscriptions, 4 owned contexts, zero inactive caches and zero real fixture network sockets. Each cache stayed at or below 5,000 bars. Approximate final JS heap 9.5 MiB. Full sample counts, maxima, draw/upload deltas and heap samples are in performance.json. Lifecycle resource counts did not accumulate; JS heap fluctuates with GC and alone cannot certify absence of every native/GPU leak.

An earlier busy-host repeat is retained as performance-busy-host.json: two-chart median/p95 16.7/83.3ms and four-chart median/p95 33.3/100ms. A read-only host check after the final run showed load averages 12.45/10.48/6.43 on the four-core Pi, other Node/Turbo build processes consuming CPU, and temperature 82.05 C. This shared host was not an isolated performance machine; external contention is a confounder, not proof that every delay is external. This variability is a practical limit of the Pi measurement environment; do not treat a favorable median as a hardware-independent guarantee.

## Visual review

Fresh Luna Max finish review found close fidelity and no major usability/visual defect; its one minor finding (2px control/tab rounding) was changed to square corners. Controls/focus were reviewed in source; runtime browser tests are recorded separately.

## Remaining limits

The approximately 60fps/no-recurring->50ms target is not met in the recorded Pi stress runs and requires measurement on an ordinary laptop under controlled load. Do not call this a performance acceptance pass. Firefox rendering is blocked by this host's compositor. No mobile redesign or future order-flow capacity claims. Public exchange reachability can change by geography/network; direct failure stays visible. The unsupported upstream designation of Core is documented; exact current Core and matching CSS are pinned.

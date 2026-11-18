# Persistent walls: foreground acceptance

The tested application is `b76828cc5f7624a22906ac50cae4c3f8ed7432a4`; later tooling/evidence commits do not change that application. Backend is `300fa5d00f607d7e3a990b128523ea265af363f5`. This is a candidate, not main or a production deployment. Hardware-rendered foreground acceptance is **pending**. Headless results cannot certify the33ms frame-interval target.

## Start the verified candidate

On the Pi, with no automated tests/builds running:

```sh
cd /home/daz/workarea/iqterminal-persistent-walls
IQ_FOREGROUND_CLIENT_SOURCE="$PWD/artifacts/persistent-wall-navigation/foreground-client" \
  python3 scripts/watch-warm-foreground.py
```

The alternate receipt selects `dist-wall-foreground`, whose assets were copied from the tested build and SHA256-recorded. The launcher verifies every asset and backend bundle before starting. It does not overwrite the older frozen client receipt, build an application, or open a browser. Without this environment variable, the legacy launcher still selects its older frozen58b3ae3 client, which does not validate this work.

Wait for `READY: http://127.0.0.1:4204`. Manually select i3 workspace9 and open that URL in the normal Chromium browser, preferably a separate/private window. Keep the terminal running. The launcher owns isolated protocol6 gateway/worker, separate current/history SSH forwards, the preview, and a local read-only watch protocol harness. It never opens the incumbent watch SQLite database. Ports4204/4205/18990/18991 must be unused; ownership/resource preflight may refuse startup rather than displace another session.

The active window is20minutes locally, followed by bounded cleanup. This is not an unconditional remote lifetime guarantee if SSH becomes unavailable. Close the candidate tab, then Ctrl-C in the launcher terminal. Require the printed cleanup confirmation; if remote state is unconfirmed, run the exact session-scoped recovery command printed in its report. Do not stop containers by name, delete prepared roots, or remove locks manually.

## What to check

1. Use Binance BTCUSDT USD-M Perp,15m, Order Walls Top Levels,8per side,10%,native. Set approximately30h ending now. Also check Spot5m. Record initial loading separately; this change does not promise an instant initial history load. Genuine gaps and the unconfirmed tail must remain visible in status.
2. Once available history has completed, keep a region containing visible walls in view. Pan horizontally and vertically, zoom both axes, alternate directions, resize, and return to earlier regions for30seconds. Walls should move with the candles/price scale continuously, including newly exposed loaded walls. There must be no blank layer or left-to-right rebuilding sweep.
3. Pan beyond the loaded boundary. The overlap should remain visible while only missing history is acquired. Return before it completes: resident walls should still be usable. A failed read must not erase good walls. Price/style changes must not restart history.
4. Hover several walls at deep and wide zoom. Price/time/rank/value must agree with the anchored line. Check candles plus a footprint chart, current updates, hide/show, then Save Workspace, switch away and reopen. Distinguish cached paint from independently validated history.
5. Repeat with two charts open. Note sustained stalls, memory growth, or current updates stopping. A source gap is different from a rendering blank; capture status and time if either occurs.

Record browser/version, `chrome://gpu` renderer and hardware acceleration, screen/plot dimensions, DPR, market/settings, build, and route. Use Chromium Performance to record the interaction and obtain frame intervals, input-to-paint response and worst stalls. Target: p95 frame intervals≤33ms and zero blank frames over covered regions containing walls. Do not use the source-level `lastPaintMs` as the browser frame interval or claim an event-to-RAF timestamp is physical display latency. Record every run, including failures. Avoid screenshot/heap capture during the timed interval.

## Existing evidence and limits

- Real source on the compiled candidate: USD-M available-history paint41.86s;36camera changes with blocked history reads produced no attempted history requests, no sampled blank wall draws, no historical resource rebuild and unchanged exact presentation hash. Current footprint execution proof advanced69batches/2966executions/69confirmed ACKs over38.36s with socket OPEN and no reset/disconnect/source-cursor jump. Longest worker-lifetime receipt gap752ms. This is one bounded observation, not general route certification.
- Earlier real-source Spot run atfdf0654:60.21s available-history paint and the same loaded-navigation invariants. Its scope predates the later mixed-fallback and live-pan fixes; their targeted checks are separate.
- Three final-build controlled pairs each rendered2500segments/20000runs during90camera changes. Legacy Canvas blanked89/90; retained GPU blanked0/90. Candidate draw p95 values38.9/34.1/57.7ms with requested SwiftShader flags but unrecorded actual renderer are **not** passing foreground performance evidence. All44historical resources/88uploads remained unchanged during camera movement.
- Eight controlled renderer owners share one GPU context and dispose to zero. Main-heap samples stabilized within62KiB after warmup on a600-row shared fixture. This does not certify large multi-chart process RSS on the foreground workload.

## Reproduce automated evidence

Use the dedicated worktree and unused port4189; preserve prior reporter output before rerunning:

```sh
export PATH=/home/daz/.nvm/versions/node/v22.23.4/bin:$PATH
pnpm typecheck
VITE_DATA_MODE=staging VITE_HISTORY_TILES=0 VITE_DIAGNOSTICS=1 \
  VITE_BUILD_COMMIT=$(git rev-parse HEAD) \
  pnpm exec vite build --config vite.wall-navigation.config.ts
VITE_DATA_MODE=staging pnpm exec playwright test --config playwright.wall-navigation.config.ts
```

This explicit controlled-worker build is for automated fixtures, not the real-source manual receipt. Do not replace `dist-wall-foreground` or its receipt with it. The test guard rejects unattended foreground browsers. Raw results and original failures are under `artifacts/persistent-wall-navigation`; architecture, precision and coverage behavior are in [rendering-experiments.md](rendering-experiments.md) and [resident-history.md](resident-history.md).

Rollback: stop only the owned launcher session and return to the unchanged ordinary main client/server. No durable migration or incumbent resource change was made. Preserve candidate prepared state, branches, frozen receipts and rollback references. No merge or production rollout is authorized by this check.

# Offline pinned-real-data paint comparison

This is a primitive benchmark with real canonical USD-M Top 8 walls, not a
staging load, live venue check, whole-chart frame gate or FPS claim. Input is the
original projector's exact 30h JSON/gzip export. The runner asserts all 23,850
segments and segment SHA de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6
before opening a browser. It retains all 104,112 exact financial value points.

Run from the frontend checkout, separately from tests/builds/loading benchmarks:

```sh
IQ_WALL_PAINT_BENCH=1 node scripts/pi-wall-paint-cache.mjs \
  artifacts/pi-history-r1/wall-paint-cache-final/input-projection.json.gz \
  artifacts/pi-history-r1/wall-paint-cache-final/paint-module.js \
  artifacts/pi-history-r1/wall-paint-cache-reproduction
```

The committed module is the exact executed bundle; result.json pins bundle,
script and input hashes. To rebuild it from the adjacent backend's existing
esbuild installation, use its esbuild binary on src/chart/order-walls.ts with
--bundle --platform=browser --format=iife --global-name=WallPaint.

The system Chromium is headed and routed to i3 workspace 9 without focusing it.
The context is native 2d with willReadFrequently and forced pixel readback. Five
alternating method-order runs each contain eight measured repaints, with raw
synchronous draw/readback times and observed RAF intervals. No FPS is inferred.
Pixel comparisons cover initial build, cache hits, pan, DPR 2, style and removal.
Resource snapshots and cache release counters are included. All six comparisons
have zero differing channels; both detached primitives retain zero paint paths.

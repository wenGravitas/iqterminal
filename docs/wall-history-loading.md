# Saved Order Walls loading

The warm path uses persisted selected wall records, not a replay of raw depth events. Profiling confirmed no mutable projector reconstruction (`mutableProjectorRestored: false`), one discovery, one projection batch, and a final independent source check. Four subscription commands during workspace restore share the same worker history job; they did not cause duplicate HTTP history reads.

Ready discovery can now acquire the ordinary validated reader lease for an opt-in client. The client adopts its exact source/projection keys and consumer identity, removing the separate acquisition POST from the critical path. Renewal, expiry, request pins, cancellation and final source revalidation remain required. Older gateways and clients retain the separate POST path. The client uses the original local discovery send clock for conservative expiry and renews earlier when discovery consumed lease time.

## Evidence

`artifacts/wall-history-loading/` contains an isolated real-staging browser probe, alternating baseline/optimized results, and the backend source patch. No fixtures were used. The baseline removes only the new discovery opt-in header; both modes run the same client, gateway, viewport and software WebGL configuration. Routing is enabled in both modes, so browser cache behavior is equal. Other Chromium processes were busy on the Pi, and network/server latency varied. These are load observations, not foreground frame-rate acceptance.

The first three alternating pairs reached final full wall paint at:

| Pair | Separate lease POST | Discovery lease |
| --- | ---: | ---: |
| 1 | 20.58 s | 15.22 s |
| 2 | 15.50 s | 10.43 s |
| 3 | 19.19 s | 12.42 s |

The omitted acquisition POST itself took 0.80–1.04 s in those baseline runs. The entire observed difference cannot be attributed to that request: discovery, import and GPU scheduling also varied. The fourth pair records first visible historical paint separately: baseline 17.82 s first / 20.72 s final, optimized 11.03 s first / 12.97 s final (browser navigation clock). The raw report also contains host elapsed completion after the diagnostics request; these clocks and endpoints should not be mixed. In the reverse-order check, optimized run 4 was followed by baseline 5: baseline first paint was faster at 8.85 s but final paint was slower at 18.11 s. Thus these samples do not establish an improvement in first paint. Full-paint medians across all bounded runs were 19.19 s baseline (five runs) and 12.69 s optimized (four runs), with substantial contention and latency variation. See `comparison.json`.

Every run retained 3,627 episodes, 23,239 value runs, 8,629 visible historical spans and six actual continuity gaps. The reference total analysis remained validated with strength 3.4415334950018903. Final source validation still preceded request completion, and the painter drained all pending work.

Startup remains material: the first warmup subscription was sent around one second, while the dedicated development worker's request began several seconds later. Vite module requests took roughly two seconds each under contention in one capture. The full main-thread wall apply was about 170 ms and geometry/render CPU about 314 ms in a representative earlier profile; 53 bounded GPU chunks drained over multiple scheduled frames. Those are distinct from network and startup delay. No speculative restore or painter scheduling change was made.

## Validation and deployment

Client: all 143 focused preparation/history/projection/transport tests passed after the reader-handoff integration test; client typecheck/build also passed. A final cleanup regression verifies immediate release when a bootstrap fence cannot be covered. Backend: 21 gateway tests, typecheck and build passed.

The deployed gateway was an independent bind-mounted bundle built from backend `07318748bd2a17fe1f3a6ac917009fd9122f4865`. An untouched release-source rebuild matched the live bundle byte-for-byte before changes. Only the two changed gateway source files were overlaid on that exact release source and rebuilt. The resulting bundle SHA-256 is `ab3c8698c4869203e1b339ecd3a230763ed71825a4dc41015c3e40cc2d1275ae`.

The existing bind file `/home/daz/iq-serving-gateway-0731874.mjs` was backed up to `/home/daz/iq-serving-gateway-0731874.before-reader-discovery.mjs` and updated in place, preserving its bind inode. Only `iqterminal-wall-prepared-main-gateway` was restarted; the worker/collectors were preserved. The old build label remains an environment value, so the exact bundle hash identifies this targeted deployment. Health and continuing materialization were verified afterward.

Backend edits remain uncommitted in `/home/daz/workarea/iqterminal-server` because its incumbent branch is `main` and no backend `dev` exists. Nothing was pushed to backend main. The patch artifact reproduces the scoped changes without including unrelated order-book work. Frontend changes are committed/pushed on shared `dev`.

To repeat a bounded probe from the frontend checkout:

```sh
WALL_PROBE_MODE=baseline WALL_PROBE_DIR=/tmp/wall-baseline node artifacts/wall-history-loading/probe.mjs
WALL_PROBE_MODE=optimized WALL_PROBE_DIR=/tmp/wall-optimized node artifacts/wall-history-loading/probe.mjs
```

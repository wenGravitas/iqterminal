# Pi history stabilization candidate R1

**Decision: BLOCKED by an unresolved intermittent current-startup/health timeout on the Pi route.** The candidate is frozen and reviewable. The bounded stabilization handoff replaces the open-ended optimization objective; it does not certify the original performance release. No main merge or production deployment occurred.

The phase started at2026-11-11 14:57:12UTC with a two-hour ceiling (16:57:12UTC). One bounded loading pass, focused recovery tests, a reopen smoke and one isolated diagnostic recheck were performed. Further optimization and repeated matrix certification stopped. The user paused before publication; the12November resume finalized metadata and documents without a new validation cohort. The metadata-only refresh confirms the same candidate/flags and protected identities; ordinary rolling-default preparation continues.

The frozen client is **7eb4a00b60daf344188eebc0659a8a82862113e8**, tag `pi-history-stabilization-r1-client`. The frozen backend is **477b2f9960d4001c61a0d1ae4b47630b48cd4afb**, tag `pi-history-stabilization-r1-server`. Metadata commits on `rc/pi-history-stabilization-r1` record the handoff without changing those application tags.

Validation used a production staging preview at `http://127.0.0.1:4201`, with `VITE_DATA_MODE=staging`, `VITE_HISTORY_TILES=1` and diagnostics enabled. Separate owned SSH forwards18880/18881 led to staging gateway18880. The preview and local forwards are stopped after the user pause; the backend remains deployed. The preview PID in the saved receipt is historical, not a running-process claim. The user's5173 checkout/client was preserved. All automated browser checks were headless; they do not establish normal foreground rendering performance.

Both backend processes have **IQ_WALL_PROJECTION_SOURCES=0**. The stabilization change closes independent-source discovery and reader-verification paths as well as admission. Ordinary canonical-backed prepared history remains enabled. Existing protocol4 files from the prior experiment are retained for compatibility; no format, service architecture or cache protocol was introduced during stabilization. The experimental path remains available as separate follow-up work.

Exact container IDs, start times, images, bundles, flags, routes and source ancestry are in [candidate-inventory.json](../artifacts/pi-history-stabilization-r1/candidate-inventory.json). The staging worker is `4fae18b4a7cd30a0984cb8d2c56f8953f13478fbeefe0c1d74397bcb34b5625b`; the gateway is `f8a49cef3a2289b08d5bdc9e08d03e34a8251b5026794650a394a3f25090fbcf`. Eight protected collector/API/materializer identities and start times remain unchanged.

The useful changes retained in this candidate are:

- Visible past footprint coverage is computed before alignment. Future whitespace cannot consume historical hours; bounded four-hour requests compose the full view and completion tracks every chunk.
- Closed history and Footprint Totals start independently of current bootstrap and footprint-only autofocus. Prepared closed bars replace presentation data without entering the live accumulator again.
- History loading/failure/coverage is separate from live freshness. Scoped retry retains good bars, healthy unrelated sockets and acknowledged cursors; recovered errors clear.
- Execution-based preparation has its own bounded cursor-processing budget, durable resume and exact ordering/deduplication. Existing evidence for the333,999-execution hour remains with its original build scope.
- Current/health admission and proxy capacity remain reserved; obsolete historical consumers cancel through the shared scheduler.
- Wall changes use stable incremental identities and bounded batched prepared delivery. Closed data avoids whole-history comparison/sorting/cloning on a current update. Saved native/footprint views remain fixed when later data arrives.

The existing financial kernel remains SHA256 `1a86cb47e20943c9c71f4614e267abe22ae507c84834cd184559ff97df041c73`. Fresh canonical folds matched every financial field, ordering and boundary selection for both wall windows. The browser hashes match those folds: Spot3,912 segments/31,127 value runs; USD-M19,213/88,220. Separate FINAL execution references exactly matched real chart/prepared hourly and five-minute bars (26,837 executions/16 cells and1,734/4), including OHLC, base/quote cells and cumulative delta extrema. No tolerance, row-size change, shortened range or artificial unavailability was used.

The following are **single representative smoke observations**, except the explicitly historical five-run row. Times are seconds from navigation to actual painted content. Source gaps remain gaps; complete available display does not mean uninterrupted exchange coverage.

| Build scope | Scenario | Useful history/current | Complete available history | Coverage/result |
| --- | --- | --- | --- | --- |
|7eb4a00 /477b2f9, n=1|24h footprints,1h/$25|3.050 history|3.308|24/24 closed slots; PASS smoke|
|7eb4a00 /477b2f9, n=1|4h footprints,5m/$25|2.143 history|2.143|48/48 closed slots; PASS smoke|
|7eb4a00 /477b2f9, n=1|Prepared30h Spot walls,5m|2.928 history|5.850|360/360 native slots;3,912 walls;12 explicit gaps; exact financial PASS|
|7eb4a00 /477b2f9, n=1|Prepared30h USD-M walls,15m|3.402 history|8.542|120/120 native slots;19,213 walls;3 explicit gaps; exact financial PASS|
|7eb4a00 /477b2f9, n=1|Footprint view ending now|2.678 history /5.373 current|2.678 eligible closed history|47 eligible closed slots plus independent forming bar; startup delay remains|
|7eb4a00 /477b2f9, n=1|Wall view ending now|1.671 current|Not complete when stopped|Current painted; historical loading remained explicit|
|7eb4a00 /477b2f9, dependent reopen smoke|Five subsequent reopens|0.226–0.271 cached history|2.980–9.080 fresh validation|All five validated; initial open missed its12s validation deadline|
|474f066 /112bf11, historical n=5|Prepared30h USD-M walls|median3.140 /max4.569|median8.019 /max8.619|Original3s first-history and5s median targets FAILED; unchanged classification|

Raw timings, request IDs, headers, bytes, viewport/source ranges, screenshots, resources and financial captures are in [the bounded evidence directory](../artifacts/pi-history-stabilization-r1/evidence-index.json). The historical five-run samples and different pinned window remain in [the original report](wall-readonly-prepared-history.md); the new samples are not pooled with them or presented as a before/after speedup. No p95 is reported.

Six deterministic compiled-client browser regressions pass: delayed bootstrap with footprint and ordinary-candle Totals history, five closed bars plus future whitespace, scoped Totals retry, native history retry retaining live state, and viewport pan within the configured budget. These are fixtures, separate from the real-source checks above. Backend validation reused the prior403-test suite with its original source scope, then ran29 focused flag/publication checks,58 recovery/resource checks, typecheck and both serving bundles for the frozen change. The unchanged client retains its prior1,354-pass/two-skip and seven-browser-check evidence; the full matrix was not rerun after documentation.

The initial current-only observation received28 updates with an advancing confirmed execution chain. The next attempted startup, after a custom3% wall profile was requested, never reached live within12s; current bootstrap and both health requests timed out. Historical chart creation had not yet begun because startup failed first. This is an unresolved startup/route reliability issue; the available trace cannot attribute it to proxy, SSH transport or backend work.

One isolated monitored recheck passed: current-only/current-with-two-histories started in2.030/1.498s, confirmed28/30 ACK batches, and had no resets, disconnects, cursor jumps or health timeouts during the20s observations. Both historical views painted and validated48/48 and24/24 slots while the custom profile's backfill cursor advanced. Receive gaps were1.854/2.103s. Later loopback probes were about1–3ms while forwarded probes were slower. These later observations do not establish the cause of the original failure and do not clear it. [Initial failure](../artifacts/pi-history-r1/rc-stabilization-current-concurrency-smoke/samples.jsonl), [focused recheck](../artifacts/pi-history-stabilization-r1/current-diagnostic-summary.json).

No financial mismatch, invented continuity or silently missing eligible slot was found. The release-blocking issue is the unattributed current-startup/health timeout. The initial reopen validation timeout and wall/current-display latency misses remain recorded performance limitations. A normal foreground-browser check is intentionally manual, not a reason to keep this goal running.

After each reopen/close, historical jobs, warm builds and chart projection owners returned to zero. Natural worker heaps varied rather than growing monotonically; this short smoke does not prove a sustained retained-heap plateau. Postflight has zero test consumers/readers/pins, no pending experimental job and no OOM. Worker/gateway observations were93.12/87.68MiB within384/512MiB caps; CPU limits remain0.5/1. All retained serving roots total1.21GiB; active+reservation+step headroom is1.43GiB within the unchanged2GiB cap. Free space is175.8GiB. Source overflows are zero. The canceled ordinary now-view job remains paused for resume. The normal bounded custom-profile registration retains its existing24h idle TTL; no source or profile history was deleted.

`perf/native-price-cache-control` remains the comparison control at **bf1d8425525306848cd9bc741c647fc3f1ba5054**. It was not merged, reset or discarded. All experiments and raw evidence are retained. The eleven preexisting dirty screenshots match their saved hashes; new fixture captures were saved separately.

The prioritized follow-up is small:

1. Reproduce and attribute the current-startup/health timeout with correlated proxy/gateway ingress and transport evidence; then recheck only that reliability gate.
2. Reduce current-footprint startup delay and wall first-paint/validation costs toward the original targets. Keep the failed five-run results and frozen source windows.
3. Review the independent wall-tail/source-publication experiment separately. Its real staging extension reused62 prefix pages/one tail page and was financially exact, but took46.15s; repeated checkpoint/copy work and composable/default reuse remain follow-up work.

To start the retained client artifact for the manual check, run these in separate terminals from `/home/daz/workarea/iqterminal-perf-history`. This uses the existing private tunnel and frozen production build; it does not rebuild or deploy anything:

```bash
IQ_STAGING_HISTORY_PORT=18880 IQ_STAGING_CURRENT_PORT=18881 IQ_STAGING_UPSTREAM_PORT=18880 pnpm tunnel:staging
```

```bash
VITE_HISTORY_API_URL=http://127.0.0.1:18880 VITE_CURRENT_API_URL=http://127.0.0.1:18881 VITE_NATIVE_HISTORY_API_URL=http://127.0.0.1:18880 node artifacts/pi-history-r1/projection-source-r1/preview.mjs
```

Verify proxied `/market-data/v2/history/health` reports backend477b2f9 before opening a browser. The retained `projection-source-r1/dist` artifact is the tested7eb4a00 client; generated bundles stay local and are not added to the repository.

For a manual foreground check, switch to i3 workspace9 yourself, open `http://127.0.0.1:4201`, and watch current prices/footprint totals for30s. Pan a historical chart left and back, close/reopen it, and check that loaded/requested coverage and gaps stay explicit. If Retry is shown, confirm it repairs history while healthy current updates continue. Check the30h Spot/USD-M walls with Top8/10%/native settings; use Fit Walls if the selected prices are outside the candle scale. Record the status and a screenshot if startup stalls beyond12s. This is a short manual smoke, not a five-run certification requirement.

[Exact staging retry, rollback and reservation instructions](https://github.com/wenGravitas/iqterminal-server/blob/rc/pi-history-stabilization-r1/docs/PI-HISTORY-STABILIZATION-R1.md) accompany the frozen backend. The handoff stops here; the original full performance goal is not claimed satisfied.

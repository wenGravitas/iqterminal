# Historical storage candidate

The storage audit, sizing model, architecture decision, backend candidate and migration guide live in the companion repository on `feature/tiered-history-storage`:

- [Audit](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/audit.md)
- [Capacity and current Hetzner costs](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/capacity.md)
- [Architecture](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/adr.md)
- [Benchmarks](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/benchmarks.md)
- [Migration/recovery](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/migration.md)
- [Explicit implementation status and remaining engineering](https://github.com/wenGravitas/iqterminal-server/blob/feature/tiered-history-storage/docs/storage/status.md)

No archive feature is enabled on staging. No frontend rendering/cache architecture was replaced. The backend candidate reuses the existing native wall importer and source-fence contract for matching sealed historical views. A separately gated browser consumer now loads independently authenticated shards across requested ranges through existing resident presentations. It remains undeployed and does not establish production-scale arbitrary navigation, financial correction authority or complete dataset adapters. See [archived wall navigation and validation](archived-wall-ranges.md).

## Pi evidence

`artifacts/storage-baseline/warm-route-storage-isolated-baseline/run-1.json` is an **unaccepted** actual-route headless diagnostic using the old two-hour reference. It recorded a different active history range and did not establish first useful wall paint or complete loading. Do not treat its healthy HTTP requests as chart acceptance. The source/build marker came from the isolated loopback Vite on 5183, not a restart of the user's client on 5173.

The companion `ops/storage-pi-reader.ts` uses the frontend's guarded system Chromium launcher and explicit deterministic native projection data. It verified 152 financially identical segments across one archive import and five presentation-cache reopens. Five cached reopens measured p50 112.4 ms / p95 249.4 ms on this Pi. That is importer/cache behavior, not foreground rendering or real S3 transfer latency. See the backend raw evidence and full limitations.

The existing foreground-browser guard remains in force: `scripts/test-browser-i3-setup.mjs` refuses headed tests until desktop isolation is independently verified. This candidate does not disable that protection, change user workspaces, or infer 60fps from headless tests.

# IQTerminal production-built staging release

This runbook deploys a production Vite bundle as an immutable static release. A small Node server serves files and proxies the existing staging market-data services. It does not replace the Vite workflow used for development.

## Current staging topology

The staging host is `sd-fn-01`; the Raspberry Pi is the build, browser, and performance-measurement host. Verify these facts before a deployment because hostnames, ports, and images can change.

- Caddy already owns public ports 80 and 443 for other applications. This release does not modify its configuration.
- The IQTerminal frontend is private to the existing Tailscale network. Tailscale Serve maps HTTPS port 8443 to a loopback-only static-server container. Tailnet ACL policy controls which peers can reach it. Funnel and public DNS are not used.
- The frontend container uses host networking but binds `127.0.0.1` only; it has no published Docker port. Tailscale Serve is the HTTPS entry point.
- The runtime base is selected from the current staging API image after confirming that the current and historical API containers use the same image. Current and historical REST traffic, prepared wall delivery, and WebSocket lanes remain distinct.
- ClickHouse and internal service ports remain private. The staging API and ClickHouse containers are not restarted by a frontend deployment.
- The Pi's existing development setup remains available: Vite on `127.0.0.1:5173`, with the existing SSH tunnels on 18780/18781/18882/18883. Production-on-Pi tests can use this path without stopping the current Vite client.

## Route contract

`scripts/staging-proxy-routes.json` is the shared route manifest for Vite and the production server. Vite retains its configured API target overrides. The production server uses separate keep-alive pools for current, history, and native-history requests, and does not place long history responses in the live WebSocket lane.

| Route | Production staging target | Transport behavior |
|---|---|---|
| `/market-data/v1/stream`, level-watch stream, liquidation stream | Current gateway, watch service, or liquidation stream target | WebSocket upgrade; separate connection, no HTTP request pool |
| `/market-data/v1/health`, depth matrix, effort/result, current order-wall archive, `/v2/history/current`, footprint-current, level watches | Current gateway or watch service | Short current-data pool |
| `/market-data/v2/history/walls/reader` and `/preparation` | Prepared wall gateway | Discovery/control lane |
| `/market-data/v2/history/walls` | Prepared wall gateway | 60-second history lane; response body is streamed through |
| `/market-data/v1/footprints`, liquidations, and generic `/market-data/*` | History gateway | 60-second history pool; `/market-data` prefix is stripped as in the Vite proxy |
| `/market-data/v1/native-candles` | Native-history target | Separate native-history pool |

WebSocket routes preserve the upgrade handshake and stream frames in both directions. REST responses retain upstream status and retry headers. Proxy failures use retryable 502 responses or 504 on inactivity timeout. Requests have an 8 KiB URI limit and 16 MiB body limit. The static server logs route, elapsed time, status, byte count, and completion without logging queries or bodies.

The manifest intentionally keeps current-book requests and historical walls on different gateways. Do not route wall history through the live pool. Raw open interest is not an accepted route: the endpoint remains in draft backend PR #1 and was not deployed as part of this release.

## Build

Run on the Pi from `/home/daz/workarea/iqterminal`, on the clean shared `dev` checkout after `dev` and `main` point at the same pushed commit:

```sh
pnpm build:staging:production -- --backend-sha <40-hex-backend-main-sha> --diagnostics
pnpm build:staging:production -- --backend-sha <40-hex-backend-main-sha>
```

The first build is for benchmarking. The second is the normal diagnostics-off staging build. Both use Vite production mode and the staging configuration (`VITE_DATA_MODE=staging`, history tiles enabled, newest-first wall history); `VITE_DIAGNOSTICS` is opt-in. `VITE_BUILD_COMMIT` is the frontend commit SHA. The build checks frontend `dev`, frontend `main`, backend local `main`, and backend GitHub `main`, typechecks, minifies/tree-shakes Vite output, precompresses text assets, and records source SHAs, route-manifest hash, asset hashes, flags, toolchain, and build time in `release.json`.

The immutable release directory name is `<frontend-sha>-<backend-sha>` with `-diag` for the benchmark build. It contains the actual production `dist/`, runtime server, route manifest, container recipe, `release.json`, and `bundle.sha256`. Build output defaults to `~/.local/share/iqterminal-staging/releases`; `IQ_RELEASE_OUTPUT` can select another directory. The client bundle contains no service credentials or signing material.

## Deploy and verify

The deployment script uses the staging account's existing non-interactive sudo access for the root-owned `/opt/iqterminal-frontend` release directory and service switch. It stages each upload in that same filesystem, validates checksums, makes the release read-only, and renames it into place atomically. It refuses to overwrite an existing release with different contents, validates Compose configuration, builds the small static-server image from the already-installed Node runtime, starts a spare loopback port, checks the container and proxied market-data health, then switches Tailscale Serve. The previous known-good release and its image remain available for rollback. Deployment records and logs are stored under `/opt/iqterminal-frontend`.

```sh
pnpm deploy:staging:release -- <absolute-release-directory>
```

Environment overrides are `IQ_STAGING_SSH_HOST`, `IQ_STAGING_DEPLOY_ROOT`, and `IQ_STAGING_HTTPS_PORT`; defaults are `staging`, `/opt/iqterminal-frontend`, and `8443`. Do not change the HTTPS port during an upgrade. The deploy script verifies that the existing Serve target matches the recorded active release before switching it.

After deployment, confirm the printed Tailscale HTTPS URL from the Pi and from an allowed tailnet peer:

```sh
curl -fsS https://<tailnet-host>:8443/__staging/health
curl -fsS https://<tailnet-host>:8443/__staging/release.json
curl -fsS https://<tailnet-host>:8443/market-data/v1/health
curl -fsS https://<tailnet-host>:8443/market-data/v2/history/health
```

The release manifest must identify the expected frontend and backend SHAs, the intended `diagnostics` flag, Vite production mode, and history tiles. Open the same HTTPS URL in Chromium. Confirm the startup screen clears, the worker connects, current prices update, and representative Spot and USD-M perpetual Order Walls load and remain visible during viewport operations. A health response alone is not proof that walls were rendered.

## Services, health, and logs

- Frontend container: `iqterminal-web-<release-prefix>-<port>`; one active and one previous release are recorded in `/opt/iqterminal-frontend/active` and `/opt/iqterminal-frontend/previous`.
- Deployment records: `/opt/iqterminal-frontend/deployments/<release-id>.json`.
- Deployment and proxy logs: `/opt/iqterminal-frontend/logs/` and `docker logs <container>`.
- Local container health: `http://127.0.0.1:<active-port>/__staging/health`.
- Tailnet HTTPS health: `https://<tailnet-host>:8443/__staging/health`.
- Backend health and collector freshness: inspect the current gateway `/v1/health` and prepared wall gateway `/v2/history/health`; verify collector watermarks advance, history materializers are caught up, and ClickHouse remains healthy. Compare `docker stats` before and after a measurement.

The frontend deploy must not restart collectors, materializers, ClickHouse, or API services. A backend rollout is out of scope unless the release requires backend code not already active. Preserve ClickHouse volumes, recorder checkpoints, wall archives, and materialization state.

## Rollback

Rollback switches Tailscale Serve to the retained previous container without rebuilding:

```sh
pnpm rollback:staging:release
```

The previous container is health-checked before the route changes. The script verifies the release manifest over HTTPS and swaps active/previous records only after the check succeeds. A rollback does not revert backend state or database schema. This release does not apply a database migration.

## Repeatable Order Walls benchmark

Use the same Pi, Chromium version, release build, BTCUSDT instrument, timeframes, viewport, representative 30-hour ranges, browser cache policy, and sample count for each route. Record Pi load, memory, CPU frequency, temperature, throttling flags, container CPU/memory, ClickHouse load, API health counters, and the exact release manifest. Keep Vite development and production artifacts separate.

Run the three paths independently:

1. **A — development on Pi:** existing Vite client at `http://127.0.0.1:5173` over the existing SSH tunnel setup. `pnpm dev:staging` enables history tiles, diagnostics, wall ordering, and stamps the current source SHA so the comparison exercises the same staging data path.
2. **B — production build on Pi:** run the production static server locally with `IQ_TARGET_PRESET=pi`, using the existing SSH tunnels. Use a free loopback port and do not stop Vite. For example, with `release_dir` set to the diagnostics release:

   ```sh
   IQ_STATIC_ROOT="$release_dir/dist" \
   IQ_RELEASE_FILE="$release_dir/release.json" \
   IQ_TARGET_PRESET=pi IQ_BIND_HOST=127.0.0.1 IQ_PORT=4181 \
     node scripts/staging-static-server.mjs
   ```

3. **C — production build from staging:** use the private Tailscale HTTPS URL. This adds the Pi-to-staging path while keeping the production bundle fixed.

For route-level cold and worker-cache reuse, run `scripts/pi-warm-wall-route.mjs` with `IQ_WARM_WALL_ROUTE=1`, `IQ_WARM_LABEL`, the release commit as `IQ_WARM_BUILD`, `IQ_WARM_MARKET=spot` or `perpetual`, and `IQ_WARM_OUTPUT_DIR` outside the checkout. For example:

```sh
IQ_WARM_WALL_ROUTE=1 IQ_WARM_URL=http://127.0.0.1:4181 \
IQ_WARM_LABEL=b-spot IQ_WARM_BUILD=<frontend-sha> IQ_WARM_MARKET=spot \
IQ_WARM_SAMPLES=1 IQ_WARM_OUTPUT_DIR=/tmp/iqterminal-benchmark/b-spot \
  node scripts/pi-warm-wall-route.mjs
```

Repeat with distinct labels for A/B/C and both markets; change `IQ_WARM_URL` to `http://127.0.0.1:5173` for A or the private HTTPS URL for C, and use `IQ_WARM_MARKET=perpetual` for USD-M. Use one observation per fresh label. The script records cold useful wall paint, exact completion, complete counts and source coverage, cache admission, reopen timing, network response traces, long tasks, frame intervals, Chromium identity, Pi resources, screenshots, and errors. It checks representative dataset fingerprints, so an incomplete or changed dataset cannot be presented as a cache hit.

Run `scripts/order-walls-bench.mjs` with `--mode=staging --case=candles-order-walls --samples=1 --url=<URL> --artifact-dir=/tmp/iqterminal-benchmark/<route> --output=/tmp/iqterminal-benchmark/<route>/order-walls.json` for the broader pan/zoom/revisit/live-update flow. It also opens a second chart with the same instrument, timeframe, and history selection, measures the complete wall load and cache hits, switches back and forth between tabs, then closes it while checking that the original chart retains its history. The harness keeps its screenshots beside the JSON. Record cold and warm navigations separately. For direct measurement, capture navigation/content, worker start, history discovery and preparation, API headers/body transfer, decode/import, cache lookup, first useful paint, fully validated paint, viewport revisit, chart switching/reopening, and live-update delay. Preserve provisional versus complete-render states.

Compare network transfer timings, server-reported `Server-Timing`, browser request traces, worker/render diagnostics, and total elapsed time separately. Run under comparable Pi/server load and repeat after a quiet-Pi interval when practical. Headless results are useful for repeatable route diagnostics but are not foreground interaction acceptance and do not establish 60 fps. Do not call a release faster unless matched measurements support it. Report missing coverage, request failures, WebSocket drops, changed fingerprints, or uncompleted paint as failures rather than omitting them.

The benchmark build has diagnostics enabled and may add measurement overhead. Deploy the diagnostics-off build for the normal staging session after performance capture, while retaining the diagnostics build as the previous release for rollback.

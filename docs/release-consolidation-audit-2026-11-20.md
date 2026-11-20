# IQTerminal release consolidation audit — 2026-11-20

This audit records the state inspected before the staging release. SHAs are full where the source commit is the release baseline; abbreviated SHAs identify branch tips in the local inventory. No branch, worktree, or remote staging checkout was deleted or force-pushed.

## Repository tips and worktree preservation

| Repository | `main` before release | GitHub `main` before release | Active shared checkout | Outcome |
|---|---|---|---|---|
| `wenGravitas/iqterminal` | `1c20ee2a17f8e88a165ef9c4bd1e37cb2996bee8` | same | `/home/daz/workarea/iqterminal`, clean base on `dev` | Release code and documentation are committed to `dev`, then pushed to `main` by fast-forward. |
| `wenGravitas/iqterminal-server` | `c4431cb92d3e7bc1324869335f688c09e5283766` | same via remote `github` | `/home/daz/workarea/iqterminal-server`, clean `main` | Already integrated and validated; no no-op commit or backend push was needed. |

The frontend GH PR list was empty. The backend has one open draft PR, #1 `Add recorder-backed raw open interest endpoint`, head `6bb5dc20074c62622edd5499fb57f3cdeb8c4202`. It conflicts on the route and test files, has no completed CI evidence, and its description still calls for a live ClickHouse query, gateway, and browser check. It is preserved as **requires reconciliation / not ready** and is not part of this release.

The frontend has a second clean worktree, `/home/daz/workarea/iqterminal-trading-r1`, at `67e52c1cbf78e1431addc5cfd29c9441cd22ab5a`. That commit is already reachable from `main`; its local feature ref is one commit ahead of its remote tracking ref, but the worktree is clean and was not altered. The frontend `origin/luna-dev` tip `50de1bc22a0ee328cbf4c7acb4801b491b92ac50` has two commits not reachable from `main`: `50de1bc Prepare isolated overnight Luna runner` and `eb1c2aa Add UTC Key Levels indicator`. It is unrelated experiment work and remains preserved outside this release.

The staging server's live backend checkout at `/opt/iqterminal` is a separate active deployment checkout on `codex/order-walls-r2-release` at `491e7f24025ef56e4f909b593d3e9ec06321a7be`. Its `origin/main`/staging reference is stale at `26337e4`; local `compose.yaml`, `ops/clickhouse.xml`, and `compose.staging-order-book.yaml` are changed, with backups and release artifacts untracked. Seventeen backend proof worktrees also contain validation outputs; `wall-source-probe` has three tracked edits and untracked artifacts. These deployment/proof states were left in place, were not switched, cleaned, or committed, and remain available for a later dedicated reconciliation.

Reachability checks also found one detached backend artifact commit in each repository clone. The local backend commit `673bd32b92918bcab2d6298dcebb65a03e6f14f7` is an R5 repeated-continuation proof handoff with a live-validation blocker; it is now protected by local ref `archive/audit-unreachable-r5-proof-2026-11-20`. The staging checkout's detached `5640d42ba1781dc8a54881e2b516d623f271cd0c` is an October net-positioning implementation. Its later hardening and decimal-preservation commits (`9de9f52`, `9b4ef32`, `e6d6f86`) are ancestors of backend `main`, and current source differs from the old implementation; it is classified as superseded and is now protected in the staging clone by `archive/audit-detached-net-positioning-5640d42-2026-11-20`. Neither artifact commit was merged. Frontend `git fsck --unreachable` found no detached commits.

## Frontend branch classification

Branch tips listed below were checked against the pre-release GitHub `main` at `1c20ee2a`. Order Walls performance, history, cache, and source-validation lines are already ancestors of `main`; they were preserved rather than replayed.

| Branch/ref | Tip | Classification |
|---|---:|---|
| `feat/order-book-r1` | `68e9d89` | Superseded/already integrated; route and review-book work is in `main`. |
| `feat/persistent-wall-navigation` | `5aecf4e` | Ready work already integrated; resident history, pan/zoom, and persistent rendering remain in `main`. |
| `codex/order-walls-r2`, `archive/.../iqterminal-r2-release` | `3852bb4` | Superseded/already integrated; R2 acceptance and wall rendering implementation are in `main`. |
| `perf/native-price-cache-control` | `bf1d842` | Ready work already integrated; bounded current admission and native price cache control are in `main`. |
| `perf/pi-history-r1` | `96aee6e` | Ready work already integrated; history batching and tile/cache paths are in `main`. |
| `rc/pi-history-stabilization-r1` | `72f74ca` | Superseded/already integrated; stabilization documentation is in `main`. |
| `integration/consolidate-order-book-walls` | `d92c297` | Superseded integration record; its implementation commits are in `main`. |
| `feature/trading-foundation-r1` worktree | `67e52c1` | Already integrated; clean preserved worktree. |
| `origin/luna-dev` | `50de1bc` | Unrelated/incomplete experiment; two unique commits preserved outside release. |

Complete frontend branch-ref inventory (aliases are refs that point to the same tip; stale snapshots are identified explicitly):

| Tip | Local and remote refs | Classification against pre-release frontend `main` |
|---|---|---|
| `1c20ee2` | `dev`, `main`, `origin/dev`, `origin/main` | Shared base; release commit added from here. |
| `3852bb4` | `codex/order-walls-r2`, `archive/.../iqterminal-r2-release` | Ancestor; already integrated. |
| `50de1bc` | `origin/luna-dev` | Two commits ahead/diverged; preserve as unrelated experiment. |
| `521018c` | `origin/feature/trading-foundation-r1` | Ancestor; its newer local worktree tip is also already integrated. |
| `5aecf4e` | `feat/persistent-wall-navigation`, `origin/feat/persistent-wall-navigation`, `archive/.../iqterminal-persistent-walls` | Ancestor; already integrated. |
| `614c994` | `integration/pi-history-startup-r1`, `origin/integration/pi-history-startup-r1`, `archive/.../iqterminal-integration-startup-r1` | Ancestor; integration record already included. |
| `67e52c1` | `feature/trading-foundation-r1` | Ancestor; clean separate worktree retained. |
| `68e9d89` | `feat/order-book-r1`, `archive/.../iqterminal-order-book-r1` | Ancestor; already integrated. |
| `72f74ca` | `rc/pi-history-stabilization-r1`, `origin/rc/pi-history-stabilization-r1`, `github/rc/pi-history-stabilization-r1`, `startup-r1/rc`, `archive/.../iqterminal-perf-history` | Ancestor; already integrated. |
| `7aedc18` | `archive/.../iqterminal-perf-baseline` | Ancestor; unrelated theme work already in current `main`. |
| `8aaab36` | `archive/.../iqterminal-font-control` | Ancestor; already integrated. |
| `96aee6e` | `perf/pi-history-r1`, `origin/perf/pi-history-r1`, `github/perf/pi-history-r1` | Ancestor; already integrated. |
| `b2b8be6` | `github/integration/pi-history-startup-r1` | Ancestor; older remote evidence branch. |
| `bf1d842` | `perf/native-price-cache-control`, `origin/perf/native-price-cache-control`, `github/perf/native-price-cache-control`, `archive/.../iqterminal-perf-native-price-control` | Ancestor; already integrated. |
| `d2b519e` | `github/main`, `startup-r1/main` | Stale cached main snapshot, behind authoritative `origin/main`; not merged over the newer main. |
| `d92c297` | `integration/consolidate-order-book-walls` | Ancestor; integration/evidence branch already included. |

Other archive and startup integration refs point to commits already reachable from frontend `main`. `git fsck --unreachable` found no detached frontend commits at audit time. `github/main` and `startup-r1/main` were stale cached references, not the GitHub authority; `origin/main` was verified at the release baseline.

## Backend branch classification

The local `main` and GitHub remote `github/main` were equal at `c4431cb9`. That commit already includes the current Order Walls release candidate and bounded wall reader lease behavior.

| Branch/ref | Tip | Classification |
|---|---:|---|
| `codex/order-walls-r2-release` / `github/codex/order-walls-r2-release` | `491e7f2` | Superseded/already integrated; release candidate is in backend `main`. |
| `origin/codex/order-walls-r2-release-final-candidate` | `4e9746e` | Terminal cursor watermark fix is already integrated into backend `main`. |
| `perf/pi-history-r1` / `github/perf/pi-history-r1` | `35d7947` | Already integrated; history batching, tile delivery, and source coverage remain in `main`. |
| `codex/depth-matrix-stage` | `7cabd43` | Already integrated into backend `main`. |
| `codex/iq001-raw-oi-6bb5dc20` | `6bb5dc2` | Draft PR #1; conflicts and live acceptance gaps; preserve outside release. |
| local `codex/order-walls-r2-release` extra artifact commit | `8597653` | Historical evidence/artifact snapshot only; retain, do not merge. |
| `archive/audit-unreachable-r5-proof-2026-11-20` | `673bd32b92918bcab2d6298dcebb65a03e6f14f7` | Detached R5 proof/evidence commit with a live-validation blocker; preserved by a local ref, not merged. |
| `wall-source-probe` staging proof worktree | `95017a0` base plus three dirty tracked source files | Requires reconciliation and tests; adds a manifest-v5/source-proof storage contract. Preserve outside this release. |

Complete local backend branch-ref inventory (the staging clone also has the separate active and detached worktree inventory below):

| Tip | Local and remote refs | Classification against backend `github/main` `c4431cb` |
|---|---|---|
| `0731874` | `archive/.../iqterminal-server-main` | Ancestor; archived promotion snapshot. |
| `0ce70b9` | `snapshot/backend-local-followups`, `github/snapshot/backend-local-followups` | Ancestor; follow-up snapshot already included. |
| `18579d9` | `origin/perf/pi-history-r1` | Ancestor; active history/materializer image line, already integrated. |
| `26337e4` | `origin/main`, `origin/HEAD`, `startup-r1/main` | Stale staging remote pointer; behind GitHub main. |
| `35d7947` | `perf/pi-history-r1`, `github/perf/pi-history-r1` | Ancestor; source-only history restoration follow-up integrated. |
| `3da2514` | `integration/pi-history-startup-r1`, `github/integration/pi-history-startup-r1`, `archive/.../iqterminal-server-integration-startup-r1` | Ancestor; integration record already included. |
| `491e7f2` | `github/codex/order-walls-r2-release`, `origin/codex/order-walls-r2-release` | Ancestor; wall release candidate already integrated. |
| `4e9746e` | `origin/codex/order-walls-r2-release-final-candidate` | Ancestor; terminal cursor watermark fix already integrated. |
| `6bb5dc2` | `github/codex/iq001-raw-oi-6bb5dc20` | Diverged draft PR #1; preserve outside release. |
| `7cabd43` | `codex/depth-matrix-stage`, `origin/codex/depth-matrix-stage` | Ancestor; already integrated. |
| `8597653` | `codex/order-walls-r2-release`, `archive/.../iqterminal-server-r2-candidate` | Local historical evidence commit; retain, do not merge. |
| `9b8cc2c` | `integration/consolidate-order-book-walls` | Ancestor; integration record already included. |
| `bda333d` | `rc/pi-history-stabilization-r1`, `github/rc/pi-history-stabilization-r1`, `startup-r1/rc`, `archive/.../iqterminal-server-perf-history` | Ancestor; stabilization already integrated. |
| `c4431cb` | `main`, `github/main` | Shared backend main. |
| `d86907f` | `integration/backend-local-followups`, `github/integration/backend-local-followups`, `archive/.../iqterminal-server-local-followups` | Ancestor; bounded integration follow-ups already included. |
| `e4fa9b6` | `archive/.../iqterminal-server-index-baseline-e4fa9b6` | Ancestor; already included. |
| `fea88fd` | `feat/order-book-r1`, `archive/.../iqterminal-server-order-book-r1` | Ancestor; already integrated. |

The staging checkout's 17 proof worktrees were all preserved. `detached` means the worktree `HEAD` itself is the preservation point; there was no branch switch or cleanup. Counts below are `tracked edits / untracked files` at audit time.

| Staging worktree | HEAD | Dirty state and classification |
|---|---|---|
| `/opt/iqterminal` | `491e7f24025ef56e4f909b593d3e9ec06321a7be` | `2 / 1026`; active deployment checkout; preserve in place. |
| `/home/daz/iqterminal-api-perf-proof` | `95114d0cb236e9de54fb535d58b901d5ac4a2d79` | `0 / 28`; detached evidence; preserve. |
| `/home/daz/iqterminal-chart-perf-proof` | `a33b01ca3f50023e9b67c6ed56919b161471bc28` | `0 / 14`; detached evidence; preserve. |
| `/home/daz/iqterminal-footprint-batch-proof` | `f82abdfae06c61f8bccff9fea0778bbaac491b5e` | `0 / 20`; detached evidence; preserve. |
| `/home/daz/iqterminal-native-price-proof` | `253ed22d6ce5873da6be0b4024cd64cab99aa18c` | `0 / 1`; detached evidence; preserve. |
| `/home/daz/iqterminal-perf-history` | `18579d938364e5fd5a9c7631bb19681a043f1b66` | `0 / 547`; performance proof artifacts; preserve. |
| `/home/daz/iqterminal-wall-admission-proof` | `0ccfa7a871a9d635b87a18bdeffd864c23d1e29c` | `0 / 160`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-capacity-proof` | `5ebe55cc480f6925e15d5b2e20de9efaf93b595b` | `0 / 89`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-encoding-proof` | `fae5c0d0870ef1ffddeb4a1d9f71ee1f559c70d2` | `0 / 6`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-gc-proof` | `9b525ba8c1d3efc69fa37b2c0b027c1415fb431a` | `0 / 109`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-point-proof` | `e122f9d8d3995d5b6b907a1519cd6b2f639fa751` | `0 / 24`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-product-proof` | `dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51` | `0 / 23`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-queue-proof` | `a6c57870d6dbdc84bf505a058f79b6caa30b1beb` | `0 / 237`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-reader-proof` | `890ca89b423589fd9acf3b868745aa342d4b054a` | `0 / 20`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-resume-proof` | `74837d7c1595c4a94111ecc694b531945da5cb1f` | `0 / 3`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-retry-proof` | `bba1e6746cf8d861b6683355dc295cc88f0c22e4` | `0 / 13`; detached evidence; preserve. |
| `/home/daz/iqterminal-wall-source-probe` | `95017a09f5838a18b1196901aa3b8f249545a6e8` | `3 / 473`; unfinished source-proof edits; requires reconciliation, preserve. |
| `/home/daz/iqterminal-wall-supervised-proof` | `67194b4476c83b3fd57e6f296352539fdcba7296` | `0 / 40`; detached evidence; preserve. |

Other local integration, archive, and proof refs were reviewed. The proof worktrees are mostly untracked test outputs, not release code. No cleanup was performed. The source-probe changes could not be typechecked on the remote checkout because `pnpm` is absent there; they have no matching test update and are not safe to fold into this release without a local backend checkout validation.

## Runtime and compatibility findings

The active topology was checked on `sd-fn-01`, not inferred from old deployment notes:

- Current and historical API containers use `iqterminal-staging:9b8cc2c...`; live `/v1/health` reports the Binance USD-M collector live, no current depth overflow, and an advancing watermark.
- The prepared wall gateway is a distinct container on the `3a67ff...` image. Its active bind-mounted gateway bundle is `/home/daz/iq-serving-gateway-0731874.mjs` (SHA-256 `ab3c8698c4869203e1b339ecd3a230763ed71825a4dc41015c3e40cc2d1275ae`) and includes the `retainDiscoveredWallReader` code required by backend `main`. `/v2/history/health` reports enabled, zero rejected requests, caught-up pinned wall materialization, and active serving capacity.
- The prepared history/materialization workers, wall gateway/serving workers, ClickHouse, and related collectors were healthy. ClickHouse and collector containers are separate from the frontend deployment.
- Caddy already serves unrelated applications on 80/443. Tailscale Serve had no existing configuration and 8443 was free, so the isolated frontend can use private HTTPS on 8443 without changing Caddy or exposing market-data/ClickHouse ports.
- The backend main runtime change is already present in the active prepared gateway bundle. No backend image rebuild or restart is required for this frontend release.
- Raw open interest remains absent from the supported route contract until its draft PR is resolved and live-validated.

## Integration order and release additions

Integration order: (1) confirm backend `main` and its running prepared-wall gateway are compatible; (2) centralize frontend route parity in `scripts/staging-proxy-routes.json`, shared by Vite and the production static server; (3) run frontend validation and commit the production release tooling on shared `dev`; (4) push `dev` and fast-forward/push frontend `main`; (5) build diagnostics-on and diagnostics-off immutable releases against both main SHAs; (6) deploy the benchmark release, measure A/B/C paths, then deploy the diagnostics-off release. The frontend release adds production builds, static serving, route-aware REST/WebSocket proxying, diagnostics-on/off configuration, container deployment, private HTTPS routing, health checks, and rollback. It does not change the order-wall engine or backend schema.

The first post-deploy Chromium smoke exposed an API contract mismatch that health checks did not catch: the backend emits numeric aggregation values (such as `50`) while the frontend compared only the canonical `50usdt` string. Current and history pages were consequently rejected before wall segments could be retained. The frontend now accepts and canonicalizes both wire forms; the frontend/backend shared type copies and generated source checksum are synchronized, while the prepared-projection compatibility hash remains unchanged because its runtime algorithm is unchanged. The regression test covers current and historical pages. No backend runtime rebuild or restart is required for this type-only alignment.

Validation records are captured in the task handoff; the committed runbook is [production-staging-release.md](production-staging-release.md). Release tests and measurements must name both commit SHAs and distinguish route health, complete wall rendering, headless measurement, and normal foreground use.

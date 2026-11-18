# Order Book and Order Walls consolidation

This consolidation brings the unified Order Book, persistent wall navigation,
newest-first prepared projections, and staging proxy fixes together on main.
It also preserves the previously uncommitted recovery/frame diagnostic scripts.
The companion backend includes committed-head cumulative depth, review-adapter
idle recovery, and the persistent prepared-wall serving lifecycle.

## Scope and source revisions

- Frontend implementation and integration tests: `d368169` (including merges
  `15b75f5` for Order Book and `6829818` for persistent wall navigation).
- Backend implementation and integration tests: `e3b280d` (including merge
  `8c1189f` and saved serving lifecycle `0d15d2e`).
- Historical performance-control and superseded release branches remain in Git
  under their existing names and recovery refs. Counterfactual cache-disabling
  experiments are not enabled in the released application.
- The GitHub main branches are the publication targets. The backend's `origin`
  is the staging host, so publication uses its `github` remote. This is a source
  promotion, not a deployment or a production/database mutation.

## Validation

- Frontend full suite: **1,464 passed**, one expected failure, three skipped
  (`pnpm test --maxWorkers=1 --testTimeout=15000`). The final run uses one
  worker and a 15-second ceiling for CPU-heavy cryptography on the Pi; this is
  a test timeout allowance, not a performance claim.
- Backend full suite: **472 passed**, no failures or skips; an additional
  **19 cleanup + 3 CLI** lifecycle tests passed.
- Frontend and backend typechecks and builds passed. Frontend builds retain
  the existing large-chunk warning.
- Order Book/Single browser scenarios: **12 passed across runs**. The first
  combined run passed 11/12; the startup-readiness correction then passed its
  focused recheck. No failed scenario is counted as passed without a recheck.
- Retained-wall browser scenarios: **8 passed** in the renderer build, plus
  **3 passed** in the explicitly selected staging-protocol fixture build.
  The latter requires history tiles disabled; an earlier build with the wrong
  flags was rejected by the fixture guard before exercising the worker.
- Newest-first prepared projection browser scenarios: **2 passed**.
- Browser launch guard: **4 passed**.

Logs and a machine-readable summary are in `artifacts/integration-promotion/`.
The initial parallel full runs exposed timing-sensitive test assertions and
CPU-bound test timeouts. The final full frontend and backend runs above passed.

The integration corrected three test assumptions: historical navigation now
requests only missing resident intervals; retained warm history replay is
asynchronous; and a restored browser workspace must reach its ready state
before visibility is asserted. The backend selected-capacity test now sets its
own configuration and verifies the compatibility marker stays latched after
lowering the limit. No production logic was changed to satisfy these tests.

Browser checks use explicit fixtures and headless Chromium on the Pi. They do
not establish foreground interaction latency, 60fps, full venue coverage, or
reference screenshot parity. The open acceptance gates in
[the original Order Book handoff](order-book-handoff.md) and
[persistent-wall foreground acceptance](persistent-wall-navigation/foreground-acceptance.md)
remain applicable. Backend deployment is required before enabling the cumulative
API on the shared staging route; the review client uses its isolated adapter.

## Worktree consolidation and recovery

Canonical repositories are `/home/daz/workarea/iqterminal` and
`/home/daz/workarea/iqterminal-server`. The review client now runs from the former.
Sixteen old worktree/control folders are cleanup targets. Their original heads
are preserved under `archive/consolidation-2026-11-18/*` recovery branches.

Verified filesystem archives, the original inventory, Git bundles, and checksums
are retained locally under
`/home/daz/workarea/iqterminal/.local-worktree-archive/consolidation-2026-11-18/`.
The archives preserve old source trees, raw measurements, modified screenshots,
and other untracked files; dependency trees, ordinary build directories and
Python bytecode are regenerable and excluded. The local archive is not published
to GitHub. Raw captures and historical experiment output are not new acceptance
results and are not substituted for the checks above.

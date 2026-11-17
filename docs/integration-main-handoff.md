# Integration main merge and remaining follow-ups

On 17 November 2026 the user explicitly authorized merging frontend PR #1 and backend PR #2, including all completed integration work. Earlier task-local foreground, performance and historical-route conditions are follow-up work, not merge gates. Production deployment, protected-watch rollout, collector changes and service restarts remain separate work. Preserve previous reports, failure records, frozen tags, control branches and build receipts.

## Verified scope and checks

Published source baselines inspected: frontend `b2b8be6a5c8d30db7368a2df108f334d89019b60` and backend `fa58e64c6339141206876bcb5e910773d53f3f8f`. Latest included application fixes are frontend range recovery `78abbdc44acff7a5d119b9d36ea27684a88fb91f` and backend watch protocol `300fa5d00f607d7e3a990b128523ea265af363f5`; launcher cleanup commits `7f91b4c26a041688a95c29067efa2b9015b41f74` / `fa58e64c6339141206876bcb5e910773d53f3f8f` are included. The full integration ancestry retains footprint/history coverage, independent startup, continuation, incremental delivery, configurable capacity, warm codec and exact delta work, together with the newer chart features. No completed local follow-up fix was identified outside these PR heads; uncommitted ordinary-backend work, frozen controls and prior R2 release evidence are preserved separately.

Current checks on these exact source baselines pass:

- Frontend: 172 tests across archive service, prepared admission/history/projection, repeated continuation and level-watch; 10 offline foreground-launcher lifecycle tests; typecheck and staging production build.
- Backend: 35 watch/stream/discovery compression tests; 17 remote lifecycle and 3 CLI offline tests; typecheck and all ten package build entrypoints. An initial custom build invocation lacked `esbuild` on PATH; rerunning with the installed repository binary path passes, without source changes.
- Build outputs are separate `/tmp/iqterminal-main-merge-check-frontend-b2b8be6` and `/tmp/iqterminal-main-merge-check-backend-fa58e64`, not replacements for any serving artifact. Frontend metadata truthfully identifies `b2b8be6a5c8d30db7368a2df108f334d89019b60`, staging mode, history tiles and diagnostics enabled. Existing large-chunk advisory remains.

Existing real financial, source/coverage, continuation and performance evidence is reused only within its documented application/window scope. See [frontend watch/warm handoff](https://github.com/wenGravitas/iqterminal/blob/b2b8be6a5c8d30db7368a2df108f334d89019b60/docs/watch-ack-warm-acceptance.md), [range recovery](https://github.com/wenGravitas/iqterminal/blob/b2b8be6a5c8d30db7368a2df108f334d89019b60/docs/wall-history-oversized-view-recovery.md), and [backend watch/cleanup handoff](https://github.com/wenGravitas/iqterminal-server/blob/fa58e64c6339141206876bcb5e910773d53f3f8f/docs/FOREGROUND-LAUNCHER-CLEANUP.md). No new browser, financial reference cohort, codec benchmark, Pi campaign or transport investigation is required or claimed.

## Source control versus runtime

GitHub permits ordinary merge commits; both PR heads include their current GitHub main. No Actions workflows, configured executable local Git hooks, reviews, review threads or required status checks were present at inspection. Deployment scripts are explicitly invoked operational commands, not merge hooks; none is invoked here. Backend rulesets listing returns a plan/feature HTTP 403, while branch metadata reports protection disabled; GitHub's ordinary merge API remains authoritative and no administrative bypass is used.

Frontend main is synchronized in `/home/daz/workarea/iqterminal`. The dirty ordinary backend checkout `/home/daz/workarea/iqterminal-server` remains on `codex/depth-matrix-stage`; a clean backend main worktree is provided at `/home/daz/workarea/iqterminal-server-main`. Its existing `origin` URL points to `staging:/opt/iqterminal` and is preserved; canonical GitHub main is fetched explicitly and tracked through a separate `github` remote for safe future pulls. Final merge/main SHAs are recorded in the task completion report and GitHub PR merge receipts, rather than circularly embedding their own commit hashes here.

The manual launcher intentionally still selects the frozen frontend `58b3ae3eb17f93c8480a4cd9598052c1bc5d684e` / backend `300fa5d00f607d7e3a990b128523ea265af363f5` receipts. Running it does not validate new main or the frontend range fix. No receipt, prepared root, running application, resource setting or service is replaced during this source-control task. Integration branches and rollback references remain.

## Remaining work, separately authorized from merge

1. Foreground usability acceptance on i3 workspace 9 using an explicitly selected current build and truthful new receipt; preserve the old frozen evidence.
2. Reduce slow fresh-history completion and warm-view fresh validation; original latency misses remain failures with their original scope.
3. Bounded automatic recovery from transient historical admission failures, preserving good history and independent current feeds.
4. Controlled rollout of the actual protected watch-server fix with compatible clients, ownership/SQLite safeguards and rollback. Merging or rebuilding the wall pair does not deploy that service.
5. Acceptance on a representative serving route. Finite passing route observations do not explain or fix the historical transport incident.

A successful merge establishes source integration only, not latency-target acceptance or production-release approval.

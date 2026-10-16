# Prepared history checkpoint

Implementation is deployed. No push was performed by this goal. Local source
commits include cca0927 (viewport/tile integration), the subsequently supplied
fb9fc77 (history implementation and evidence), and 0580948 (restored regression
tests and benchmark safety). Backend source commits are 9fe396b, b366aac, a66b781;
operations are 8ee4a3f. The existing backend replay/admission edits remain untouched
and uncommitted. The supplied local commit already includes the prior POC styling.

The API, collector and materializer are independent Compose services under the
existing `/opt/iqterminal` Git root. All listeners stay private. Collector ID
3df0acd82749bc112019313fcdccb7fff537cb12371fc0ef5bbf635f84091aae has not changed
since the one intentional lifecycle split at 2026-10-13T15:54:46Z. Later depth epochs
come from normal retained-epoch/reconnect handling, not serving deployments.

Final local validation: 236 tests, typecheck/build and real Chromium cache check.
Final backend validation: 48 tests/typecheck, migration reapplication, exact real
replay comparisons, durable restart/correction proof and admission limits.
`closure-rollout` deployed successfully but its immediate coverage probe ran before
readiness; `final-validation` passed against the ready services on October 16.
Routine rollout now waits for health and asserts unchanged collector identity.

Five complete October 13 A/B/C/D/E trials are retained in `release-*`. The later
`verified-*` A/B/D/E trials use final guards and the resumed Pi environment. Do not
pool the series: the later Pi is under other workloads and route transfer delay
is greater. See `history-performance.md`, `history-completion-audit.md` and artifact
README for accepted evidence, actual target misses and excluded experiments.
The current scenario centers its fixed-width price range on the latest price;
`offprice-current` preserves the earlier verification that used stale price bounds.

The old fixed raw-depth window has expired under unchanged retention. Its prepared
tiles remain available. The eviction helper now refuses to discard those tiles;
use the retained five first-use trials, or review a new fixed window and exact
backup/eviction predicates before a later first-use benchmark.

Local development uses `pnpm tunnel:staging` and `pnpm dev:staging` on loopback 5173.
Staging long jobs/logs use named tmux `iqterminal-history`, bounded log files and
`.exit` records under `logs/history-tiles`. Docker, not tmux, supervises services.
No duplicate collectors, new exchange connections or public data ports were added.
Rollback and operational commands are in both repositories' `docs/HISTORY-TILES.md`.

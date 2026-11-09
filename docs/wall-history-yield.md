# Cooperative history continuation

This page records the4efc-era background-continuation implementation and its
measurements. The later [visible/cache priority separation](wall-task-priorities.md)
supersedes the call-site priorities; the old cohorts retain their original scope.

Prepared wall decode and progressive import keep their existing8ms/256-point
checkpoints. On supported browsers the continuation now uses
`scheduler.postTask` at explicit `background` priority. Current/input tasks can
run ahead of it, without repeatedly scheduling chained zero-delay timers.
Unsupported platforms retain the timer fallback. The consumer AbortSignal reaches
the native task; fallback cancellation clears its timer and listener. The helper
owns no channel, worker, persistent queue or chart context.

The API/priority behavior is described in [Chrome's scheduler documentation](https://developer.chrome.com/blog/use-scheduler-yield).
The actual Pi Chromium worker reports native support. Financial code, canonical
hashes/byte budgets, source revisions, coverage, price rows, admission and all
retention limits remain unchanged. Normal native JSON work, GC and OS scheduling
can still exceed the soft budget. This is not a strict task-duration guarantee.

Four helper lifecycle tests and the prepared-history correctness/cancellation
suite pass, as does typecheck. The captured-batch worker comparison records5
alternating samples per variant/market after separate warmups, with byte-identical
reconstruction and native cancellation. Median elapsed falls511→377ms Spot and
450→330ms USD-M. USD-M candidate run5is slower (830ms); every sample/max and
synthetic message-delivery gap is retained in wall-worker-yield-r2/summary.md.
No actual chart/loading/current-continuity gate follows from this offline result.

Rollback: revert the helper call sites to timer continuations. No server/source
migration, prepared-cache rewrite, live-socket reset or acknowledged-cursor change
is required. The API remains dca1bb8; a new client build and real-chart cohorts
must establish whether this improves end-to-end performance.

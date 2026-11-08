# Visible native price history

Staging mode with `VITE_HISTORY_TILES=1` can fill an ordinary Binance candle
chart's visible past beyond the current native bootstrap. This restores price
context behind prepared Order Walls; it does not manufacture exchange OHLC from
aggregate executions. Direct/live-only mode and the existing30m/1d direct bypass
retain their incumbent behavior.

Requests use the existing `/market-data/v1/native-candles` API and shared history
scheduler. Each request is at most1,000candle slots and2MiB decoded JSON, with at
most five pages per consumer view, nearest useful history first. The existing
backend gateway admits these HTTP reads through its historical lane, preserving
the current/health reserve; native live streams retain their existing routes.
The local history and current proxy agents remain separate. No collector, source
retention, collector connection or raw schema is changed.

Closed bars are merged into the requesting chart only. The shared current
bootstrap/replay cache remains at1,000bars; the chart remains at5,000. Visible
history receives priority within that chart budget, reserving two latest bars.
Requests beyond4,998eligible closed bars explicitly report capacity-limited
coverage. Missing returned slots remain partial, never known-empty coverage.
Native history does not enter a footprint's mutable execution accumulator.

REST request order and local stream sequence are tracked separately. A delayed
REST read cannot overwrite a subsequently observed stream update, and a closed
bar cannot be reopened. Base and quote volume remain source values, not added
increments. Chart retention also bounds the version ledger.

The footer shows native prices loaded/requested, requested time range, partial
or failed status and a scoped Retry action. Retry keeps valid bars and healthy
live sockets. Actual footprint/Totals failures take priority over a partial native
view; a remaining native partial keeps its own Retry action. Simultaneous actual
failures receive their scoped retries without reconnecting healthy streams. A subsequent bootstrap can satisfy an outstanding history view
and clear its recovered error. Pan, unsubscribe, offline and disposal release
obsolete consumer interests; coalesced peers retain their own requests.

A saved wall-history range starts loading before current bootstrap succeeds.
If the saved range exceeds minimum chart zoom spacing, it stays an explicit
historical demand until it restores or the user takes control by clicking or
wheeling in the chart. Such a gesture supersedes pending restoration so it
cannot pin subsequent pans to an old saved range.

Functional fixture and unit results do not certify Pi route latency. Real
source, complete coverage, rendered content and five-run acceptance remain
separate requirements in `docs/pi-history-performance-r1.md`.

Rollback uses the previously reviewed client build and gateway image through
the established isolated staging workflow. This feature has no new persistent
state or collector migration to undo. Keep the history/current proxy split;
rolling back gateway admission alone removes protection for native HTTP reads.
No production rollout is part of this work.

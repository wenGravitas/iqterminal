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

The R2 API identifies instruments canonically as `binance:spot:BTCUSDT` or
`binance:perpetual:BTCUSDT`; the public symbol alone is not that API identity.
Market/instrument metadata, when supplied, must match the requested series.
Closed bars are merged into the requesting chart only. The shared current
bootstrap/replay cache remains at1,000bars; the chart remains at5,000. Visible
history receives priority within that chart budget, reserving two latest bars.
Requests beyond4,998eligible closed bars explicitly report capacity-limited
coverage. Missing returned slots remain partial, never known-empty coverage.
Native history does not enter a footprint's mutable execution accumulator.

Warm reopen can restore closed prices from a separate service-owned presentation
cache: at most two exact series/window entries,1,000bars total,1MiB conservative
accounting and60s idle TTL. This is additional bounded presentation storage; it does
not raise the1,000current replay or5,000chart budgets. It stores detached flat
source fields, including quote volume, and never forming bars or live cursors.
Cache hits do not extend idle TTL. Active views hold bounded key/token leases
(maximum128), so a long-open chart does not lose reusable prices before it is
closed. Final release starts the60s idle TTL; active entries remain evictable
under the same entry/row/byte caps. Leases retain no bar arrays or feed groups,
and pan/unsubscribe/dispose releases them. An entry that cannot fit is simply not cached;
the normal exact loader still serves the view. Actual retained heap is measured
separately from this accounting limit.

A cached bar is presentation, not validated coverage. The footer exposes cached
slots separately; loaded/requested still counts validated slots. Cached-only slots independently request their native revision. Native bars
already owned by the current group remain authoritative inputs, as described
below. Echoing displayed timestamps back
from the viewport cannot cancel this validation or certify cached slots. A fresh
authoritative bootstrap or closed stream bar can validate its own slots and
correct cached values without extending other slots' original TTL. Failure
retains good displayed bars with failed/partial coverage and scoped Retry; a
fresh empty response never certifies the cached view and evicts its reusable
entry. Historical imports, including cache delivery, cannot freshen a live
connection indicator. Worker disposal clears the cache and the existing refresh
timer expires idle entries; release does not retain the old group or socket.

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

A saved wall-history range starts loading before current bootstrap succeeds,
including ranges inside the usual1,000bar bootstrap window. If bootstrap wins
the history-page race, its accepted closed bars seed the presentation cache and
acknowledge only their own slots. Already-owned native bars can satisfy a new
consumer without a redundant HTTP read. An empty or mismatched response cannot
acknowledge old retained values.

Viewport boundaries within1ms of an interval boundary are snapped before slot
alignment; genuine partial slots remain included. The current source clock is
never snapped forward. Saved restoration retries after the initial chart resize,
and the first independent current update preserves an explicitly historical
time range. This prevents early cached prices from restoring into a narrow
initial container and then being shifted back to the current tail.

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

## Wall presentation cache lifetime

The separate Order Walls presentation cache is limited to two entries,16MiB per
entry and32MiB aggregate accounting, with at most two decoders and one encoder.
Its60s timer now measures idle time after the last historical subscriber/job
releases that exact request. Long-open views preserve cache interest; current-only
subscriptions do not. Interest is metadata only and does not prevent capacity
eviction. Retry retains displayed walls and validates independently. Cache reuse
never claims requestComplete before fresh source validation; new revisions replace
the presentation only after full validation. Disposal clears entries and timers.

This cache adds no durable storage or migration. Client rollback restores the prior
reviewed build without changing the backend, collectors or raw retention. Any
headed browser command currently fails before launch, including the former
IQ_TEST_HEADED=workspace9 override; use headless mode for diagnostics.

## Shared footprint demand during saved-view handoff

The early restore consumer and visible chart now share a matching historical
footprint demand within their exact series/row-price group. The job key includes
aligned visible bounds and analysis context. They reuse one progress/validation
ledger; shared ranges are reported once. No cell/bar/request budget changes.

Pan and unsubscribe release only that consumer. Final release cancels the job;
reopen after final release starts independent revision validation, using retained
presentation only as unvalidated content. Retry resumes one failed shared job
without restarting healthy unrelated feeds. Every attempt captures its own abort
signal so a canceled late response cannot apply through a newer controller.
Historical replacements remain separate from the mutable live accumulator.

Rollback uses the reviewed821092dclient build in an isolated checkout/static
release, retaining the current staging gateway, current/history tunnels and raw
source. The sharing map is ephemeral and adds no persistent state or migration.
A client reload disposes it. Do not roll the backend back to pre-R2main or restart
collectors for this frontend rollback.

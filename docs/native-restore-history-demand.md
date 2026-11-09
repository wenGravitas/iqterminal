# Early native history demand for restored wall charts

The early restore holder subscribed to native candles and historical walls before
synchronous panel construction, but did not request the saved native viewport.
In the5039 Pi cohort a Spot viewport request started3352msafter navigation,
headers arrived5643msand all native slots were observed6421msafter navigation.
These overlapping observations identify late admission; they do not isolate its
whole contribution to wall paint latency.

During the initial history preload phase a candle chart with a visible, enabled
Top Levels history now requests its owned saved native range immediately after
its native subscription, before derived subscriptions. Footprint charts continue
to use their footprint path. Plain candle/Totals charts do not acquire a leftover
footprint-only range. Subsequent synchronous restore holds do not submit another
history demand. Existing native range alignment, chunk/bar budgets, fair scheduler,
source identity, read/stream ordering, cache limits and current routes apply.

Temporary and real chart consumers retain independent cancellation. If the page
is pending, both join the same request and releasing the holder leaves the panel's
request alive. If the holder already finished, the panel receives cached OHLC
immediately but independently validates it. Echoing those displayed times cannot
mark the source ready or cancel validation. Historical pages are consumer-only
presentation: they do not enter the shared live candle store. No new exchange
connection, backend request option, source narrowing or cache freshness assertion
is introduced. The API currently rejects a native `limit` parameter; no unsupported
parameter is sent.

The old implementation fails the focused early-demand regression.99focused tests
pass after the change, including pending/completed handoff, corrected authoritative
rows, cache revalidation, healthy current socket retention and unsubscribe cleanup.
Typecheck passes. Production Pi route timings must be recorded separately before
claiming any loading improvement. Prior failing gates remain failed until rerun.

Rollback: revert the early request and its optional FeedClient type declaration.
This changes no persisted data, prepared cache format, backend deployment, live
cursor or collector. No cache purge or collector restart is needed.

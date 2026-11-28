# Separate real-history test client

## OI correction after operator testing

The original total summed whichever selected venues were fresh. Hyperliquid
expiry therefore changed a three-venue total into a two-venue subtotal and drew
the transition as a market move. Total now requires fresh verified BTC values
from **every selected venue**, leaving a gap when any one is absent. Individual
venue series retain their actual observations. The sources dialog explains this
rule; hiding a line still does not change inclusion in Total.

A fresh actual-service 15m check loaded nine historical windows and retained
13,211 observations without evictions or pending history requests. All 134
visible Binance and Bybit points are present; Hyperliquid has 21 unavailable
points and Total has exactly the same 21 gaps, with zero partial-venue subtotals.
This check did not reproduce the operator's large all-venue blank spans after
a fresh load; their original cause is unconfirmed. It does not prove every
earlier tab recovered without reload.

Separate 36h retained-data reads contain 130 Hyperliquid observation intervals
longer than the 75s freshness limit, with a maximum 330s interval. Binance and
Bybit have no such gaps in these reads. Missing historical Hyperliquid values
remain unavailable; no interpolation or stale substitution was introduced.
The upstream cause of those source gaps is not established here.

44 focused tests, the typechecked build and both compiled browser regressions
(historical navigation/cache reuse and an OI-sourced SMA) pass. An initial
browser-test invocation against the Vite development server failed because its
fixture targets the compiled worker; the same test passed on the explicit
compiled staging build. A diagnostic interrupted by source hot reload is saved
separately in `/tmp/iq-oi-interrupted-diagnostic.*`, not used as a before/after
comparison. [Measured browser/source summary](../artifacts/history-candidate-live/oi-total-fix-summary.json),
[real browser capture](../artifacts/history-candidate-live/oi-wide-after.json),
[screenshot](../artifacts/history-candidate-live/oi-wide-after.png).

The isolated client is available at <http://127.0.0.1:5174/>. It serves the
shared `dev` checkout, including the OI correction above. Initial pilot startup
used application source `1cd2cc6`; the candidate backend is `87260c5`.
The existing port 5173 client and incumbent collector services
continue to run. No main merge, retention change or source deletion occurred.

## Test scope

Select Binance BTCUSDT USD-M perpetual, add Multi-Venue CVD and Open Interest,
then pan into **27 November 2026 UTC**. The published immutable snapshot covers
that one closed day: 00:00 UTC inclusive through 28 November 00:00 exclusive.
Native candles are captured at 1m, 5m, 15m, 1h and 4h. Current data still comes
from the live collectors. Startup intentionally opens at the live edge; a saved
past viewport is not a shortcut to the archived day on initial application load.

The browser check navigated explicitly to 12:00–14:00 UTC on 27 November.
It rendered all 120 requested native minute slots with archive state `observed`,
preserved the exact requested range, and received successful archived native
candle and OI requests. Live candles, CVD and OI also rendered. No JavaScript
page errors were observed. Screenshots and complete response/status diagnostics
are under [artifacts/history-candidate-live](../artifacts/history-candidate-live/).
These checks use the real services and a headless software renderer, not fixtures
or foreground frame-rate/performance acceptance.

## Storage and recovery evidence

The backend report and raw receipts are in
`iqterminal-server/docs/storage/history-candidate-live.md` and its adjacent
`evidence/history-candidate-live/` directory. They establish:

- Actual retained-data capture, private object publication, witness publication
  and independently reconstructed snapshot inspection.
- Full-day HTTP reads: 1,440 recorded CVD bars, 1,440 recorded candle bars,
  all five native intervals and 2,879 OI observations. Three sampled raw-execution
  minutes match recorded bars; every archived OI observation matches retained SQL.
- Cached real-byte reads during explicit object-read failures, a fresh reader
  reopen, refusal of uncached failed reads, witness-failure refusal and recovery.
- Candidate API restart with unchanged snapshot/results, zero object downloads
  for the checked cached windows, and an advancing live execution watermark.
- The dedicated serving S3 key can GET existing objects and cannot PUT, DELETE
  or alter the policies. Anonymous GET is denied.

The candidate's focused 85 backend tests, typecheck and build passed. The earlier
full repository regression remains separately recorded in
[history-candidate-regression.md](history-candidate-regression.md).

## Limits to retain during testing

This is a bounded pilot, not continuous archival ingestion or a complete
historical catalogue. Other markets, symbols, days, unsupported intervals and
datasets retain their explicit availability limits. Order Walls continue using
their incumbent prepared service. No automatic cleanup or retirement is enabled.

CVD and OI still display partial-data notices. The browser receipt includes two
HTTP 503 responses during background exact-CVD history reads, alongside successful
reads and live updates; it is not an all-requests-pass result. The observed CVD
chart used the exact retained/checkpoint endpoint, so this browser run does not
establish the recorded-minute archive branch of the CVD UI. Its archive API was
verified separately. `financialAccepted`, current reconciliation, comprehensive
recovery qualification and performance acceptance are not asserted by this pilot.

## Runtime ownership

Local transient user services are `iqterminal-history-candidate-client.service`
and `iqterminal-history-candidate-tunnel.service`. The candidate-only tunnel uses
local port 18980; the client uses existing current and wall transports, with
archive/native-history routed to the candidate. Staging user services
`iqterminal-history-candidate-api.service` and
`iqterminal-history-candidate-sql.service` own the isolated API/read-only SQL lane.
These are session services, not a claimed boot-persistent deployment. Private
credentials/configuration remain outside the repository.

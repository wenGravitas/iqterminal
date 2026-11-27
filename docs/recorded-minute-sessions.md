# Recorded-minute historical sessions

`RecordedMinuteSessionClient` implements the optional backend protocol added in
`iqterminal-server` `498095d`. It defaults to disabled and is not yet constructed
by the production feed worker or connected to CVD/candle chart calculations.
No Vite flag, native feed, chart anchor or renderer lifecycle changes here.

An explicitly selected worker owner can construct one client, call `open(scope)`,
then `read(page)` and `close()`; `dispose()` permanently stops that client.
There is one session and one admitted request per client. Consumers should share
the owner rather than create one client per viewport. No automatic retry,
publication replacement, zero filling or resident-data eviction is performed.

Acquisition accepts a single supported BTCUSDT source and at most 31 days. Pages
remain at most one minute-aligned day and 1,440 sparse records. The client
requires the exact versioned acquisition certificate and checks the original
lease ID, source, full selected scope, expiry, checkpoint, generation, witness
and catalogue head on every page. It separately verifies the page publication
metadata against that certificate. Flags promoting financial, recovery or
retirement authority are refused. Decimal amounts and UInt64 identifiers remain
strings.

Transport is bounded to 32 page attempts, 4 MiB per page, 32 MiB of successfully
decoded page bodies, 32 KiB control bodies and eight-second request deadlines.
The local lease deadline uses monotonic elapsed time from before acquisition,
conservatively including the acquisition round trip. It does not compare the
browser wall clock with the server's clock. Existing server object/transfer,
expiry and retained-view limits still apply independently.

Tokens remain private to transport and are sent only in the designated header.
They do not enter returned chart data, diagnostics, URLs or persistence. Requests
use same-origin credentials, `no-store` and redirect refusal. Source/range errors,
expiry, competing requests and exhausted attempts are rejected before a fetch.
Invalid pages quarantine the session until explicit close. Network failure
preserves its original identity for a bounded manual retry.

Close aborts the active request and waits for its real cancellation/body drain
before attempting DELETE. Known tokens from malformed acquisition responses are
also cleaned up. A false release result is unconfirmed/absent, not proof of a
remote deletion; server expiry bounds uncertain response delivery. No source
history is ever deleted by this protocol. Accepted pages belong to the future
worker contribution store, outside this transport, and must survive cancellation,
release, navigation and network failure.

## Verification

- Four focused Vitest files: **61 passed**, including the existing minute wire,
  OI history reader and CVD regressions.
- Typecheck and `VITE_OI_HISTORY=0 VITE_DIAGNOSTICS=1 pnpm build`: passed.
- Raspberry Pi 5 Model B, system Chromium, headless dedicated-worker fixture:
  **one passed**. The worker acquired and read exact values, retained its accepted
  page through a controlled 503 outage and explicitly released the session.
  Tokens stayed in headers. The initial blob-worker fixture could not resolve
  relative fetch URLs; the accepted test uses an HTTP-served worker entry.
- An explicitly bundled copy of the actual frontend client passed the backend
  reconstructed-snapshot HTTP test against the real compiled runtime/cohort.
  It acquired a real certificate, decoded the original exact quantity, matched
  publication identity and released the retained view. This is an isolated
  directory object store/index qualification, not a Hetzner S3 result.

The browser test requires `IQ_TEST_MINUTE_SESSION=1` and an isolated Vite server
on loopback (the test imports the source module). It is not a foreground chart,
deployed worker bundle or performance benchmark. No external service, existing
history or production configuration changed.

## Remaining integration

Before using these pages in CVD, implement the exact native decimal/incarnation
contract and a worker-owned contribution ledger with stable anchor and source
cutover. Native snapshot pruning and request cancellation cannot remove accepted
historical contributions. Publication IDs cannot select financial correction
winners. Preserve explicit partial coverage and refuse unsupported anchor or
correction reconstruction. Chart wiring and production performance validation
remain pending.

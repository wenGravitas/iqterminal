# Native visible-price backfill and recovery

This is functional fixture evidence on the Pi, not real-source/client-route
loading acceptance. The application uses staging/history/diagnostics production
dist; source flags are explicit. The build used for the browser runs embeds
b88b5ce (initial) or1b30ed1 (Retry change) plus the accompanying uncommitted native
implementation at that time. The final accompanying source commit and rebuilt
build must be used for subsequent real staging gates. No timing in these fixture
logs supersedes the five-run real-source gates.

- `frontend-tests.log`:1,143tests pass /two skip;133files pass /two skip.
- `frontend-types.log`:typecheck passes.
- `browser-native-user-control-pass.log`:two native-price cases pass.30h5m
  loads all360closed bars before bootstrap; later bootstrap preserves newer
  native OHLC/quote volume and current live volume. The1mcase loads4,998closed
  slots within the existing seven-day saved range, retains5,000bars and a bounded
  version ledger, then follows a user pan and loads all360new slots.
- `browser-regressions-initial.log`:20pass /fivefail. All wall/pane/new native
  cases pass. The initial failures and full error contexts are retained under
  `initial-failures/`.
- `browser-diagnostic-rerun.log`:threepass /twofail after correcting an old
  seconds-versus-milliseconds restore call and distinguishing native bootstrap
  requests from the new visible requests. The original fixture's3/1000bar source
  has explicit absent native rows outside that advertised scope; it is not a
  real-source acceptance scenario.
- `browser-retry-render-repeat-initial.log`:fourpass /sixfail. Five failures
  came from counting unrelated fixture sockets rather than the healthy native
  stream; one five-candle case had loaded/validated history and valid indices,
  but its primitive was still empty at the paint assertion. Visibility was
  visible, so this was not mislabeled as source unavailability.
- `browser-scoped-retry-repeat-pass.log`:tenpass (five of each case). Actual
  Totals failure is retried before a partial native range; the latter retains
  an honest action, and its later retry preserves the healthy native socket.
  Five successful paint repetitions do not explain the earlier intermittent
  zero-paint result. Keep that first-paint limitation open for diagnosis and
  the real gate recheck.

The two initial native fixture failures were not capacity fixes: plain candle
views intentionally ignore footprint-only saved ranges, and4,998five-minute
bars exceed the incumbent seven-day saved-range bound. The corrected fixture
uses visible wall history and4,998one-minute bars, preserving the requested bar
count and5,000cache limit. Its later pan failure was a real pending-restoration
bug: a range wider than minimum zoom spacing continued overriding user pans.
An explicit chart gesture now supersedes that pending native restore.

The accompanying implementation keeps exact native OHLC separate from prepared
footprint presentation and the mutable execution accumulator. It pages at most
1,000slots /2MiB per HTTP request, five pages per view, through the shared history
scheduler. Empty results remain partial, capacity limits are explicit, stale
consumer responses are ignored, peer cancellation stays independent, and Retry
preserves good bars and healthy sockets. The shared current cache remains1,000;
the chart remains5,000. No collector/source-retention change is involved.

Backend admission is independently committed as253ed22 with295tests /type/build
passing. It is pushed but not deployed to staging serving or production. The
incumbent staging build remains18579d9. Native coverage, source identity, real
screenshots, prepared-wall latency and first-paint gates still need the exact
new committed build through the isolated staging gateway.

## Committed builds

Frontend implementation `b89f3ad22a4d8c2f1d7537e1b9753a4982ed1a0b` was rebuilt
with its exact embedded SHA. Its focused browser run (`browser-b89-committed.log`)
has six passes and the same five-candle first-paint failure. The captured state
has all five exact source bars/indices, visible chart/document, queued refresh,
dirty scheduler and pending RAF; the primitive is still empty at the assertion.
This remains an open first-paint issue, not absent source or completed paint.

`614c4c2` corrects the displayed-bar count while current bootstrap is pending:
the old counter used the shared current cache and claimed0displayed bars even
when360historical bodies were visible. It now counts the chart's current data
epoch. The rebuilt exact614c4c2source passes both native browser cases, including
the360bar footer assertion and screenshot. `native30h-before-bootstrap.png` is
explicit fixture content, visually inspected: full30h candle bodies are present
while bootstrap remains pending. It is not a live-source screenshot or latency
gate. Full unit/type evidence precedes this two-line status-only change; its own
typecheck/build and two relevant headed browser checks pass.

The staging preflight still identifies incumbent18579d9and the same collector /
API IDs and start times. No serving deployment has occurred in this evidence.


The real route subsequently exposed a canonical namespace validation defect:
API instruments are `binance:spot:BTCUSDT`, not bareBTCUSDT.46ea11d fixes it and
adds the captured canonical response regression. Its full suite1146passed /
2skipped, typecheck/build and both relevant fixture browser cases pass. The real
46ea/253default Spot cohort still fails the loading gates; raw requests and
screenshots are retained in adjacent `chart-46ea-253-spot-default*` files.
Background workspace9RAF controls now settle near1Hz in this session; foreground
primary UX is unproven. Browser placement guards do not turn that into a pass.

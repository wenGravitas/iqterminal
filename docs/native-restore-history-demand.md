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

## Initial production cohort, candidate e2fa254

The production staging/history/diagnostics build is
`e2fa254b818f7129b9b63ade93325d1ad0ea1cdd`, isolated preview4189. API remains
`dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`; all seven protected service identities
and start times match before/after. The same independent history18780/current18781
SSH route, explicit headless Chromium, pinned30hsource and native Top8/10% profiles
are retained. Foreground Pi UX remains unverified. No production/server rollout.

Five empty-browser-cache loads per market over already prepared server history
retain the normal12sobservation window and original acceptance targets.

|Scenario|First historical paint samples, ms|Median|Maximum|Gate|
|---|---|---|---|---|
|Spot5m|4660.7,4107.2,4359.7,3231.4,3932.5|4107.2|4660.7|FAIL3s|
|USD-M15m|4239.2,6598.0,4197.1,5549.3,5360.7|5360.7|6598.0|FAIL3s|

|Scenario|Complete validated painted coverage samples, ms|Median|Maximum|Gate|
|---|---|---|---|---|
|Spot5m|9438.5,10737.4,8518.4,8248.6,7627.9|8518.4|10737.4|FAIL5s/10s|
|USD-M15m|missing,missing,missing,missing,missing at12s|not reported|not reported|FAIL|

All10views have every requested native closed slot (360Spot/120USD-M), verified
build/mode and exact source tokens on received projection batches. Spot receives
all8,293walls/49,154points/35gaps and paints complete coverage in every run.
USD-M runs1and3receive all23,850walls/104,112points, but never certify the latest
paint by12s. Runs2,4and5still lack some financial records/final coverage proof.
They remain incomplete; missing delivery is not relabelled as unavailable source.
In USD-M run1the input revision is73and painted revision71with no pending geometry,
so idle preparation alone is also insufficient proof of completed latest paint.

Native viewport request admission now follows bootstrap admission by28.1,20.4,
26.9,31.9,65.9msfor Spot and44.6,14.8,2.8,40.9,21.7msfor USD-M. These differences
are between request events on the same Node monotonic clock, not navigation paint
times or cross-host clocks. Native-slot observation medians are4056.2msSpot and
3427.3msUSD-M. Earlier admission is verified; an overall loading improvement is
not. Sequential cohorts have different host load and cannot establish causality.
The worsened USD-M completion motivates an alternating before/after comparison.

The serving observer covers the cohort by causal process start/stop and records
36samples/no sample errors. It measures resources and health, not current execution
confirmation continuity or heap plateau. The initial runtime inventory assertion
matched both pnpm wrapper and Vite child; the actual Vite child and served bundle
were subsequently verified while the original cohort continued without restart.
The first gate CLI invocation incorrectly supplied both markets to a single-case
API; the saved report calls the existing gate separately for each five-run group.
No sample or threshold was changed.

Raw timings/screenshots are `artifacts/pi-history-r1/native-restore-e2fa-r1-*`;
request phases, exact gate failures, protected-service receipts, resource samples,
executed helpers and test/build logs are in `native-restore-route-r1/`.

## Alternating USD-M comparison

Five additional alternating pairs compare the production5039control on4188with
e2fa254on4189, using the same saved30hview, source reference, route and12sdeadline.
Odd pairs run control then early; even pairs reverse the order. Each subprocess
retains its original rawrun=1; `sequence.json` maps it to the pair. No raw records
were edited to manufacture five distinct run numbers.

|Pair|Control first history, ms|Early first history, ms|Control complete|Early complete|
|---|---|---|---|---|
|1|4148.8|missing at12s|missing at12s|missing at12s|
|2|7126.4|6925.1|missing at12s|missing at12s|
|3|6148.5|5589.1|missing at12s|missing at12s|
|4|6459.9|5229.2|missing at12s|missing at12s|
|5|10469.8|4364.9|missing at12s|missing at12s|

Control first-history median6459.9ms/max10469.8msfails; early first-history has one
missing sample, so no five-sample median/max is reported. Neither variant completes
any validated paint by12s, so neither has a finite completion median/max. Every
sample has verified environment/source token identity and all120native slots.
This comparison neither proves an overall improvement nor isolates a causal
regression. Earlier native admission remains verified: early follows bootstrap
by20.8,54.9,9.1,38.9,40.9ms. Control's four extra viewport requests start900–1781ms
later; one control needs no extra request because its authoritative bootstrap wins.
Native-slot observation medians are4135.3mscontrol and4113.8msearly; these are not
first useful wall paint or separate native-body paint timings.

The Pi is substantially contended: a mid-cohort sample records about13load average,
72.7C and multiple existing busy Chromium processes. Per-load CPU/swap/load,
temperature, frame/long-task and process samples remain in the raw benchmark data.
Existing user processes were left untouched. These are contention observations,
not healthy-source acceptance. All test browsers remain forced headless; no
foreground desktop/browser isolation claim is made.

The serving resource observer records51samples and0sample errors. All protected
service identities remain unchanged. Both owned comparison previews and observers
were stopped after their cohort; the existing4187control and SSH forwards remain.

Raw before/after samples, screenshots, executed runner and browser environment
receipts use `native-pair-{1..5}-{control,early}-r1-*`. Pair mappings, all timings,
served bundle checksums, resource/stop receipts and scoped evidence manifests
are in `native-restore-pairs-r1/`.

The lifecycle fix remains scoped to admitting the saved context early; release
performance remains unaccepted. Next work must address remaining delivery/import/
paint costs and ordinary rolling default reuse rather than treating the earlier
native request or ready data flags as completion.

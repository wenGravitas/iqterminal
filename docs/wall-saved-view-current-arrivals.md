# Saved wall views and current candle arrivals

Frontend e25cd431feb18286da74e6a15c61088329e3e367 fixes a chart lifecycle error
that moved saved historical wall views toward current time during reopen.
The release performance gates remain incomplete.

## Evidence and cause

The bounded main-thread trace records a saved full30h USD-M15m range
1794285900000..1794393900000. Reopen cycle1 first displays120 historical native
candles at the exact saved range. When the native count becomes122, the visible
range advances one interval to1794286800000..1794394800000. At1177.5ms the panel
then requests padded walls through1794395240755, the current clock rather than
the saved end. Its authenticated prepared cache no longer matches that range,
so repeated discovery/current reads replace the bounded saved-view validation.
The eight reopens all retain incomplete-view failures. Raw observations are in
`artifacts/pi-history-r1/transport-r2/range-trace-natural.jsonl`.

The old guard preserved only the first recent native arrival and only when the
native demand ended at least two intervals behind the current candle. A recent
closed candle also consumed that one-time flag before a separate forming candle
could arrive. A saved view one interval back therefore moved as missing native
axis timestamps were inserted, even though both arrivals were outside it.

The panel now checks the actual visible time range. While its right edge is
strictly before the current candle boundary, current native patches preserve
absolute historical time bounds whenever axis timestamps change. The current
candles still enter the native collection and chart series. Returning to a live
view retains the chart's normal following behavior. There is no new accumulator,
financial aggregation, socket, retry, source query or cache capacity.

## Regression and validation scope

The deterministic browser cases separately inject the latest closed and forming
native candles after a full30h saved view is restored. Both5m and15m fail against
the old build, advancing the requested time range, and pass with the fix. They
also return the chart to the live edge and verify that a simulated next-interval
arrival advances that live view normally. These are explicit transport fixtures,
not exchange or latency acceptance.

The surrounding native browser tests cover delayed bootstrap, retained quote
volume/revisions,4998-slot pan retention, and warm presentation with independent
revision validation. Their fixture gates now distinguish in-flight sharing from
fresh validation after an already completed preload. The sharing test still
requires exactly one history HTTP request; the warm test blocks only the actual
warm cycle and verifies the corrected quote volume and revision.

The exploratory real-source trace is diagnostic, not an accepted latency cohort:
part of its later observation overlaps deterministic browser investigations. No
finite subset, first-content flag or favorable median certifies its eight failed
completions. The source has two explicit retained depth gaps and its canonical
reference proves19209 segments/83173 value runs. No gap is filled to pass a gate.

## Serving, retry and rollback

This is a frontend change. Keep the existing isolated staging gateway112bf11 and
materializer33c7e3a, protected collectors, source retention and rollback root.
Reload the isolated frontend build to apply or roll back the change. Rolling back
to d039b6a restores the old saved-view drift; it requires no backend downgrade or
source rebuild. History Retry continues to operate on its existing view/job and
does not reconnect healthy feeds. No production deployment or main merge is part
of this change.

## Exact build results

App commit e25cd431feb18286da74e6a15c61088329e3e367 passes1336 frontend tests
(two skipped), typecheck and the production staging build. All six native-history
browser tests pass against that exact build. The controlled baseline cases still
fail against d039b6a at the newly added latest-closed arrival assertion.
The exact production preview is loopback4198; its route targets now assert equality
with the established4197 comparison preview before listening.

An initial real-source attempt used unconfigured default ports18780/18781 and
failed before native candles arrived. Its empty JSONL, environment, executed
script and refused-connection log remain under fixed-range-natural and
preview-range-exact.log. It is a route-setup failure, not a latency sample or
source absence. The corrected route was verified through proxied gateway health
and uses independent existing SSH lanes18880/18881 to the same isolated gateway.
The fixture browser suites do not establish this real-source precondition.

The corrected real-source cohort uses full30h visible range
1794286800000..1794394800000, source context1794285900000..1794395700000,
sourceToken901ad4a047449f1035e8fa7defe9433531a78fcd8f69d1cce93e3546c33bbf21.
The bounded read-only reference fold and before/after DB source checks prove
18924 segments/82601 value runs and two explicit depth gaps. This is a newer
source window than the exploratory failure trace; no latency improvement ratio
is inferred between different windows.

| Warm reopen | Useful history (ms) | Fully painted and independently validated (ms) |
| --- | --- | --- |
|1|455.5|3556.0|
|2|793.0|5395.0|
|3|700.7|3708.3|
|4|321.3|5117.2|
|5|547.5|3427.4|

**Scoped warm useful≤1s PASS:** median547.5ms, maximum793.0ms. All five
settled jobs retain the exact saved range, reuse the authenticated manifest with
zero projection-batch requests, and receive one fresh source validation each.
All120 closed native slots are retained as raw timestamps; all18924 segments
and82601 runs are painted with matching revisions and no pending geometry or
reference work. No current-ending retarget command occurs. Raw requests, heaps,
Pi resource samples, long tasks and the real-chart screenshot are retained in
transport-r2/fixed-routed-natural*. No p95 is inferred from five loading samples.

The initial empty-browser-cache view is separately retained: first historical
paint5373.3ms and complete13998.4ms. This single sample misses the cold-browser
targets and does not establish a five-sample cold cohort. Prepared-server cold
loading, Spot warm behavior, initial current footprint startup, concurrent
history/custom-profile behavior, pan/switch retention plateau and foreground
Chromium UX remain outside this scoped pass. Natural used-heap observations are
not retained-heap proof. No forced GC is used.

All browsers remain headless. The final postflight checks protected service
identities/start times, live collectors, unchanged rollback checksums and zero
readers/pins/consumers after the owned lease was released. The gateway and worker
remain112bf11/33c7e3a; no serving or materializer deployment was required.

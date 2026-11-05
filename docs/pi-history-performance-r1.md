# Pi history performance release R1

Implementation and performance acceptance are separate. No production deployment or merge is authorized by this release.

## Baselines and isolation

Frontend base: `7aedc1896805be507382b8f5feb0e00775a4aa00` (refreshed main).
Backend base: `491e7f24025ef56e4f909b593d3e9ec06321a7be` (refreshed R2 branch).
The raw-OI branch is not a dependency. New work uses `perf/pi-history-r1` in separate client/server worktrees. The main checkout's newer uncommitted UI work remains untouched.

Local host is Raspberry Pi 5 Model B Rev 1.0, arm64. See `artifacts/pi-history-r1/baseline-environment.json` and `staging-before.txt` for the initial flags, resource snapshot and collector identities. These are environment evidence, not latency acceptance.

## Root causes and first repair

- `StagingFeedService` clamped the end to the current closed-candle boundary but used the future viewport end to enforce a four-hour *total* range. The eligible past interval now precedes alignment; the four-hour bound belongs to individual HTTP requests.
- `PreparedFootprints` reported `!visiblePending` after the first ready chunk. Completion now requires every requested visible slot and chunk to validate. Explicit null tiles distinguish covered empty slots; per-slot progress carries gaps and pending/unavailable work. Chunks use the shared scheduler, newest useful visible history first; optional analysis follows visible reads.
- Prepared reads waited for a live accumulator, and the panel suppressed viewport requests until footprint autofocus. The independent initial past request and normal chart/Totals viewport requests now run without those prerequisites.
- A late live bootstrap replaced the displayed history and could relabel historical summaries with bootstrap coverage. Only bootstrap bars restore mutable execution state; closed prepared bars and their original provenance survive.
- A historical failure set live state stale, and Retry closed healthy sockets. View-specific historical errors/retries now preserve good bars, live state, sockets and acknowledged cursors. The chart footer reports history progress/range separately.

Focused coverage/lifecycle verification: 28 tests across `prepared-footprints.test.ts` and `staging-service.test.ts` pass. Typecheck/build pass. Browser and actual-route latency acceptance remain pending; these unit tests do not establish them.

## Acceptance ledger

The first complete five-sample production-build series is `artifacts/pi-history-r1/nov5-final-samples.jsonl`: frontend `cd56ddc`, backend `35da8733602556cca0e0da4746db89e705856016`, normal Chromium/GLES on the actual Raspberry Pi through split SSH tunnels and Vite preview. Actual worker diagnostics record full frontend SHA, data mode and enabled tiles. Empty incognito contexts isolate browser caches; server footprint history was verified ready in `nov5-ready-preflight.json`. All timings below are navigation-relative main-thread paints, in milliseconds; these are not worker receive times.

| Scenario | Every sample | Median | Maximum | Result |
|---|---|---:|---:|---|
| 4h / 5m / $25 complete | 4235.4, 4877.4, 3508.6, 3599.6, 3539.7 | 3599.6 | 4877.4 | PASS for this build; all 48 bars painted |
| 24h / 1h / $25 complete | 3996.5, 3995.0, 4182.4, 7050.1, 6798.1 | 4182.4 | 7050.1 | PASS for this build; all 24 bars painted |
| Current 5m footprint | 2249.6, 2010.9, 2227.5, 1827.8, 2369.2 | 2227.5 | 2369.2 | FAIL median <=2s |
| Current 15m walls | 10728.5, 5855.9, incomplete, 5488.6, 5831.9 | not established | >12s | FAIL |
| 30h default Spot / 5m walls | five incomplete | not established | >12s | FAIL |
| 30h default USD-M / 15m walls | five incomplete | not established | >12s | FAIL |

`nov5-cd56ddc-gates.json` retains every scenario's first historical paint, requested/actual viewport, painted counts and completion metadata. No p95 is calculated from five loading runs. These results do not certify subsequent builds; the later restored-wall-viewport repair is being measured in a separate frozen-build series. Thresholds and 30h ranges remain unchanged. The Pi rebooted between the prior-day baseline and these samples, so resource/cache conditions differ; per-run resource snapshots are retained and improvements are not attributed solely to code.

Concurrency, warm revisit, repeated-use memory and default rollover acceptance remain pending. Headless SwiftShader browser regressions are separate correctness evidence, not Pi UX acceptance.

## Further implementation and validation

The current footprint bootstrap uses an independently maintained canonical
execution snapshot/cursor; it never restores prepared closed cells into mutable
live execution state. Saved absolute ranges survive sparse-to-dense inserts.
A one-point data layer cannot claim successful saved-view restoration. Main
thread paint diagnostics record visible footprint times/cell counts after draw;
loaded worker data alone cannot satisfy the display gate.

Normal wall changes carry stable segment identities, increasing revisions and
only appended/replaced tail value points. Full comparison is restricted to
initial history or a bridge rebase. Retention queues compact against actual
retained data. Narrowing a loading viewport cancels an offscreen initial prefix.
Wall requests share the existing bounded history scheduler and cancellation.

A warm wall presentation cache retains at most two completed exact projections,
16 MiB estimated per entry / 32 MiB total, for 60 seconds. Cache copies are
independent of live mutable projections. A revisit displays the cached content
with validation pending while issuing a fresh fixed-watermark load. Intermediate
prefixes and failed validation retain good cached walls; only a completely
validated replacement replaces them. Disposal releases cache entries/timers.
The byte estimate deliberately includes object overhead; oversized views remain
uncached and must report their warm-revisit gate as failed if they cannot meet it.


## Further observed races and cold recovery

A 90-second extended wall coverage observation (separate from the unchanged 10-second acceptance gate) found a deferred-bootstrap race: a 30h restored USD-M viewport could remain attached to the initial roughly 62h archive job. The narrower viewport arrived before `archiveStarted`, so there was no running job for the cancellation condition to recognize. The service now updates the pending request before current bootstrap admits history, while retaining its shared current connection. A regression fails on the former wide start and passes on the requested bounds; existing in-flight cancellation tests remain.

On backend `d0fec8370114a42d0c4702380edb54e1a1e92903`, a genuinely unprepared retained 1h/$37.5 job processed 333,999 executions in 167 pages and completed in 26.767s including a worker restart. The pinned source horizon survived restart, the cursor advanced, and collector IDs/start times were unchanged. The independent bounded streaming reference exactly matched all cells, OHLC, record count, base/quote totals and cumulative delta extrema. This is one cold recovery sample, separate from ready-server timings. See `cold-footprint-recovery.jsonl`, `cold-busy-independent-reference.json`, and the backend operational probes. The first attempted whole-hour reference hit the existing 250,000-result cap; the reference now streams bounded queries and no production cap was raised.

Test browsers use `--class=IQTerminalPerf`. The Pi i3 configuration assigns that class to workspace 9 and prevents focus on mapping, before any post-launch helper runs. Normal Chromium windows are unaffected. Three independent test contexts verified direct placement with no focus changes.

## Recovery and lifecycle follow-up

Further browser regressions exposed two independent ways the requested viewport
could move after correct historical loading. A distant forming candle appended
across a sparse time gap expanded a 24h view; the chart now preserves absolute
bounds across that append while retaining normal contiguous rollover following.
The first authoritative current bootstrap could also shift a contiguous
11:00..19:00 view to 12:00..20:00. It now publishes a presentation snapshot
containing the prepared closed bars and authoritative current state, with the
existing view anchor preserved. Closed presentation bars remain separate from
the mutable live execution accumulator.

Ordinary candle charts with Footprint Totals now follow their actual candle
viewport instead of a stale saved footprint-only viewport. Scoped History Retry
resumes the failed consumer without reconnecting healthy native/other footprint
groups. An explicitly retried failed current-state job resumes its persisted
cursor; normal polling and healthy builds do not reset it. Backend retention
keeps active jobs before filling its bounded completed-job cache, preventing
current/default jobs from being evicted by later completed configurations.

The latest seven headless SwiftShader lifecycle checks pass, including delayed
current bootstrap, late native candle snapshots, contiguous/distant forming-bar
arrival, ordinary-candle Totals and pane disposal. These are correctness checks,
not latency acceptance. The full frontend suite passed 1,018 tests with two
skipped before the final focused retry addition; focused retry checks passed
subsequently. Backend `e13ae47` passed all 184 tests, typecheck and build in the guarded
staging rollout before serving. Exact terminal logs and deployed commit records are retained.

## Query cost, recovery and measurement limits

The backend's bounded key-first FINAL wall query is independently compared with
the former payload query on five fixed-snapshot samples per market. All 4,097
rows, payload strings and ordering match. Final SQL statistics show Spot read
bytes 263,267,121 -> 22,617,571 and USD-M about 552,830,144 -> 22,765,350.
Per-query shared storage snapshots preserve consistent key/payload reads across
part revisions. These read-cost improvements do not establish full-chart speed.

The shared two-slot SQL admission proxy reserves current capacity and admits at
most one non-current request. It does not alter global ClickHouse limits or
collector routes. A controlled interruptible read disappeared 53.3ms after
client cancellation; a blocking sleep operator did not stop within 500ms.
Cancellation is cooperative, so a closed HTTP request is not proof that every
SQL operator stopped instantly. Current/source continuity still requires real
concurrent-load evidence; admission bounds alone cannot certify it.

The four default preparation configurations (Spot/USD-M, 5m/$25 and 1h/$25)
were observed ready on both sides of the 11:00 UTC rollover, including the new
forming jobs. `default-rollover-nov5-11utc.json` records the exact build and
canonical record counts. This is a real rollover observation, separate from
cold preparation and ready-server timing.

The old `route-comparison.jsonl` requests did **not** pin a watermark. They are
exploratory same-window measurements, not identical-snapshot route comparisons.
The replacement `scripts/pi-route-probe.py` captures a manifest, pins its
watermark and continuation cursor, retains compressed bodies/headers, and checks
the financial response hash across five samples per route. Mutable profile job
status is excluded from that hash; its full raw response remains available.
Curl durations and SSH process overhead are separate; no clocks from different
hosts are subtracted and overlapping phases are not added together.


## Latest frozen-build loading samples (5 November)

`nov5-e13-7aa-samples.jsonl` and `nov5-e13-7aa-gates.json` record all 30
normal Chromium runs: frontend `7aa7c9aa3da210610e291dcba2262b937e744c5e`,
backend `e13ae472d105fa65b5e7919139a1cead685634fa`, actual Pi / split SSH /
Vite production preview. All seven prepared closed-history requests were ready
before loading (`nov5-e13-ready-preflight.json`). Each footprint view painted
all requested closed bars and retained its requested viewport.

| Scenario | Every navigation-relative sample, ms | Median | Maximum | Result |
|---|---|---:|---:|---|
| 4h / 5m / $25 complete | 3923.6, 5031.8, 5914.7, 5142.5, 4496.7 | 5031.8 | 5914.7 | FAIL median <=5s |
| 24h / 1h / $25 complete | 7501.7, 5764.9, 5332.3, 5831.7, 6849.7 | 5831.7 | 7501.7 | FAIL median <=5s |
| 30h Spot / 5m walls complete | incomplete, incomplete, incomplete, incomplete, incomplete | not established | >12s observation | FAIL |
| 30h USD-M / 15m walls complete | incomplete, incomplete, incomplete, incomplete, incomplete | not established | >12s observation | FAIL |
| Current 5m footprint | unavailable, unavailable, unavailable, unavailable, unavailable | not established | unavailable | FAIL availability; derived current job already failed |
| Current 15m walls | incomplete, incomplete, 10188.6, 7817.5, incomplete | not established | >12s observation | FAIL |

Current-footprint runs exposed a retained failed current job (`fetch failed`,
three attempts, last run 11:07:42 UTC). This is explicit recovery/availability
failure, not five valid already-ready current latency samples. The execution
collector was live. `nov5-e13-current-job-diagnosis.json` preserves the failed
cursor/category/progress. A subsequent recovered-current series must be reported
separately, rather than overwriting these samples or treating a history-only
paint as current success.

The Pi was in active desktop use. Per-run load/memory/swap/process snapshots
are in the raw samples; a separate observation reported 81.8 C and firmware
throttle flags `0x80000`. These environmental differences prevent attributing
all timing changes to code. User applications, cooling and network were not
changed. Gates retain their original thresholds and full requested ranges.

Build test clients with `pnpm build:staging:diagnostics`. Vite `--mode staging`
alone selects proxy configuration but does not set the worker data mode. Before
measuring, inspect actual worker `dataMode`, history tiles and build diagnostics.

The failed-current investigation also reproduced a missing recovery control:
ordinary candle charts with Footprint Totals displayed a live-Totals failure but
had no Retry button while native candles were healthy. `52bdb96` exposes a
scoped Retry for that state. Its browser regression fails before the fix and
passes afterward, checks exactly one explicit current-job retry, retains good
closed bars, clears the recovered failure, and verifies native candles are not
reloaded. This is separate from the preceding frozen-build loading samples.

## Recovery validation on backend 34d7939

The client now preserves a Retry queued behind an in-flight ordinary bootstrap
request; only a request that actually carried `retry=1` can acknowledge that
intent. The focused regression fails before `6f6b931` and passes afterward.
Twenty-nine focused client tests and typecheck pass. The full client suite
subsequently passed **1,020 tests**, with two skipped. The eight headless browser
lifecycle checks passed before the final in-flight race repair; its separate
unit and actual-source checks cover that subsequent change.

Backend `34d7939b75e3505726b2f5279c8db27335567a33` passed all **186 tests**,
typecheck and build in its guarded staging rollout. Collector identities/start
times were unchanged. Current preparation now uses the reserved current SQL
lane. Bootstrap readiness requires the requested forming candle and a tail no
larger than 10,000 execution IDs / 5 seconds of durable source time. An older
ready snapshot remains internal while the resumable worker catches up; the API
reports building rather than sending the client through whole-hour raw replay.
A failed job remains explicitly unavailable until Retry.

The bounded default-readiness probe resumed each failed Spot default once;
all four configurations were ready after 5.140s. This is a recovery observation,
not a <=2s prepared-current latency result. On frontend
`def42d89b009bbfe8747bfb9011879f2ca866635`, the actual-source hourly screenshot
and `ready-34d7939-footprint-coverage.json` show **five closed bars plus the
forming bar**, with three future hours preserved. Earlier failures and the
successful 5m/Spot observations remain in separate raw recovery artifacts.

## Identical pinned route comparison

`pinned-routes-34d7939.jsonl` contains five samples per route for the same
manifest watermark, continuation cursor, profile and 30h source window. All 15
financial response hashes match. Raw compressed bodies and headers are retained
under `pinned-routes-34d7939/`; only mutable `profileStatus` is excluded from the
financial hash. The batch is about 81,146 compressed / 1,974,445 decoded bytes.

| Route | Every curl total, ms | Median | Maximum |
|---|---|---:|---:|
| Staging loopback | 646.004, 878.529, 769.215, 1038.539, 775.785 | 775.785 | 1038.539 |
| Existing Pi SSH tunnel | 1702.243, 2055.587, 4168.614, 2499.848, 16770.283 | 2499.848 | 16770.283 |
| Vite production preview proxy | 6858.008, 2947.124, 2186.724, 2065.344, 3574.077 | 2947.124 | 6858.008 |

SSH process overhead and server timing headers are separate fields, not added
exclusive phases. The requests are sequential route groups rather than a
randomized causal experiment; changing admission/background conditions remain
visible in the raw headers. A separate read-only Tailscale path probe measured
RTTs of 524, 578, 510, 440 and 324ms, with SSH compression disabled. No network
settings were changed. These results prove a substantial and variable route
cost; they do not attribute every delay to a specific network component.

## Current continuity under historical load

`concurrency-34d7939.jsonl` retains all five current-only client runs and five
runs with two historical footprint charts, canceled/panned viewports and a
newly admitted 3% custom wall profile. Actual worker flags/builds are recorded.
The pre-existing 2% custom profile was also backfilling during the baseline, so
this is not a server-idle comparison. The added 3% profile is explicitly
backfilling and advances in materializer health, rather than being a cache hit.

| Client scenario | Every maximum receive gap over its 10s observation, ms | Median | Maximum |
|---|---|---:|---:|
| Current-only | 3174.4, 3616.3, 2549.6, 2125.9, 1418.3 | 2549.6 | 3616.3 |
| Two history charts + added custom profile | 2905.2, 3826.7, 4622.6, 6364.9, 3013.1 | 3826.7 | 6364.9 |

No current request timeout was recorded. All ten disposals returned historical
scheduler activity to zero while retaining the intended native current chart.
Collector execution recoveries stayed at 243, depth reconnects at 155; there
were zero collector error log entries during the measured interval. One
baseline health response could not be parsed as JSON; its HTTP status was not
captured by that probe version, so the cause remains unproven. The probe now
retains status, headers, bytes and elapsed time for health-read failures.

The continuity gate remains **FAIL / not certified**: confirmation gaps worsened
under the combined workload, and this evidence does not isolate the cause.
The after-run server sample shows the perpetual materializer at 44.5% CPU
against its 0.5-CPU limit, versus ClickHouse at 55.33% CPU in that snapshot.
This is one resource sample, not a complete per-run CPU profile. Materializer
health reports several seconds of current-source age while default/custom
lanes share its process. A controlled comparison with identical background
profiles and further serving/materializer profiling remain required.

Five warm-footprint attempts are preserved in `warm-34d7939.jsonl`. Three
completed their cold setup and painted all 24 cached bars after 469.1, 861.2 and
594.4ms; independent revision validation followed after 1873.5, 3119.8 and
4517.7ms. Two cold setups exceeded their 12s observation and never established
a warm precondition. No five-sample warm gate is claimed from those three
successes. Wall warm-revisit acceptance remains unmeasured.

## Repeated-use evidence and open correctness gate

`retention-native-axis-34d7939.jsonl` contains twelve correctly ranged cycles;
`retention-36-34d7939.jsonl` extends the same method to 36 cycles in one normal
headed Chromium context. Every cycle loads actual footprint content and a
wall prefix with >=200 value runs / >1 minute confirmed, pans, switches market
and interval, and closes both charts. Every final viewport matches the requested
30h window. All cycles release panels, worker groups, projectors and active
historical requests to zero. Page and worker heap samples include natural use
and a separate diagnostic GC after disposal; no application GC was introduced.
The last twelve of the 36 cycles span 8,907,392–9,028,788 retained page bytes and
2,068,700–2,089,524 worker bytes. Raw frame/long-task and retention queue counts
remain available. This is scoped prefix/disposal evidence, not full 30h retained
history acceptance. The earlier `retention-34d7939` and interrupted
`retention-exact-34d7939` probes checked a nonexistent snapshot API and did not
restore the requested wall range; retain them as exploratory observations only.
The corrected probe uses the native time axis and asserts the resulting range.

A new financial-correctness audit regression fails on the deployed backend's
current logic: a higher-ID execution timestamped in the preceding closed candle
is omitted by the current page time predicate after rollover, and the existing
prepared candle is not revised. The new test expects two closed executions and
observes one. This must be repaired before release correctness can be certified.
See backend `docs/PI-HISTORY-OPEN-CORRECTNESS.md` and the preserved
`late-closed-revision-before.log`. The earlier 186-test deployment pass remains
valid for that tested suite, but did not cover this newly identified case.

# Pi history performance release R1

Implementation and performance acceptance are separate. No production deployment or merge is authorized by this release.

Current staging serving build is `072cc1d55e931ea82ee8edd623ef22543f454fa7`.
Backend tests/typecheck/build pass (219 tests). The footprint viewport repair
has real complete-coverage evidence; prepared 4h/5m latency passes, while 24h/1h,
current display and 30h wall acceptance remain incomplete/failed. Verified wall
parts now have read-only cached HTTP delivery, but chart discovery/consumption
and automatic preparation/retention are still open. Later sections retain older
measurements with their own exact builds; they are not superseding gate passes.

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

### Pending canonical revisions and index prerequisite — 6 November

The client now retains previously painted tiles during a canonical correction,
marks only the affected slots building/unavailable, and removes their validated
analysis evidence until a ready revision replaces them. Failed revision reads
keep good bars. Focused tests cover pending → ready replacement and failed
revision retention. The full frontend suite passed 1,022 tests with two skipped
across 124 files; typecheck passed. This is deterministic correctness evidence,
not a Pi loading or live-connectivity gate.

The staging additive execution-ID index prerequisite completed using backend
`f519c44`, without replacing the still-running `34d7939` serving build. The raw
installation transcript is `execution-id-index-f519c44-install.log`; indexed
1,000-ID tail SQL read 9,339 rows/681,747 bytes for USD-M and 13,124 rows/958,052
bytes for Spot. Collector IDs, starts, recovery/reconnect counters and zero
overflow counters were unchanged across that operation. SQL time is distinct
from client latency. The backend rollout now checks this prerequisite before
starting ID-tail workers. The revision repair still needs inactive-configuration
and legacy-payload freshness validation before deployment and real-chart checks.
All previously failed acceptance gates remain failed/incomplete.

The browser lifecycle run passed seven checks but exposed an invalid assumption
in the scoped-Retry fixture: the dedicated worker's native socket was not kept
healthy by a page-level socket mock. The fixture now installs an explicit worker
transport, requires native live status before Retry, and passes without a staging
tunnel. That deterministic result does not certify real live continuity.

A further regression found same-revision analysis merge protection rejected a
server-declared canonical invalidation. Prepared batches now carry explicit
invalidated times; only these may revoke the old validated evidence while good
bars remain visible. A service-level test verifies invalidation/recovery without
changing the live cursor, accumulator or socket. The old guard fails the test;
the repair passes all 35 focused prepared/service tests and typecheck. The
preceding full 1,022-test result predates this small follow-up; final release
validation must include it.

The corrected browser fixture and analysis follow-up were then rebuilt as client
`845e4ed`. All eight lifecycle browser checks passed in one run (57.4 seconds),
using headless software rendering and mocked data. Both projects' builds and
typechecks passed. The staging read-only index check passed again at 06:52:51 UTC;
collectors remained live with the same IDs/starts/counters as installation.
This does not supersede live/Pi performance failures or authorize production.
The raw logs, source-version probe and exact SQL-only coverage summary are
committed alongside this report. The source-version summary verifies 48/48 raw
candle groups for each 4h/5m source window and 24/24 for each 24h/1h source
window; it explicitly makes no rendered-coverage claim.


## Canonical source-version release, 6 November

Staging serves backend `7256fd44af9728619a93d6191639d5e39e8d74ee`.
Client `8a28a6081fdf13d297ca50e0e9680dd6802627d1` was built with staging data,
history tiles and diagnostics enabled. These are normal headed Pi Chromium
runs, empty browser cache over prepared server history, with the fixed source
window ending at `1793804400000`. Actual chart rendering is Canvas2D. Raw
`source-version-7256-*` samples retain every failure and request timing.

| Scenario | Every complete/paint sample, ms | Median / maximum, ms | Gate |
|---|---|---|---|
| Complete 4h, 5m/$25 | 4698.2, 4048.9, 4139.6, 4490, 6287 | 4490 / 6287 | PASS |
| Complete 24h, 1h/$25 | 5052.2, 6809.4, 6947.6, 9146.8, 5951.5 | 6809.4 / 9146.8 | FAIL median |
| First current footprint | 3163.9, 2865.3, 3341.2, 3575.4, 3322.2 | 3322.2 / 3575.4 | FAIL |
| Complete 30h Spot walls | incomplete in all five | unavailable | FAIL |
| Complete 30h USD-M walls | incomplete in all five | unavailable | FAIL |
| First current walls | no painted selection in all five | unavailable | FAIL |

All footprint historical runs account for all 48 or 24 requested closed slots.
The screenshot reproduction separately paints five closed hourly bars and one
forming bar, preserving three hours of future whitespace. Its 30-second coverage
observation is not a latency-gate sample. During part of the footprint series an
unusual $37.5 cold repair was active; this is recorded workload, not an isolated
causal before/after experiment. Server input-digest validation includes FINAL
canonical Decimal fields, with independent per-row SHA256/XOR reference checks.

The fixed fourteen-request legacy preparation completed in 192.206 seconds.
The busy 333,999-execution hour repaired in 41.766 seconds with unchanged exact
52-cell financial content and an independent reference match. Its 167 additional
pages read 32,802,302 DB rows / 2,493,895,852 bytes: bounded returned rows still
have substantial physical read amplification. These are cold derived rebuild
results, separate from the prepared-server table. All four defaults subsequently
had versioned closed bars and exactly one forming bar after rollover; boundary
publication delay remains unmeasured. See the backend report and raw
`source-version-*` evidence for scope and counters.

### Current wall geometry and remaining delivery failure

Client `302029935e0b1f1c0d0add783d8e6f61f85125e9` repairs two deterministic
visibility defects: an instantaneous current seed was discarded as zero width,
and confirmation-only patches did not advance open tails. A seed now paints a
minimum physical pixel with its exact source timestamp; hover does not invent
extra time coverage. Only open IDs advance on confirmation changes. Archived
open ends advance only to delivered history, independently of current freshness.
Full frontend verification passed 1,027 tests with two skips; eight lifecycle
browser checks passed with explicit worker transport fixtures (headless software
rendering, not live performance).

The standard current-wall rerun retains a mistakenly abbreviated declared build
label and is not gate evidence. Its diagnostics have the full correct build;
selected prices were outside the native viewport. A separate Fit Walls series
painted all sixteen selected markers, taking 8695, 7013.1, 4544.3, 6614.8 and
4504.5 ms. That is supplemental behavior evidence and exceeds the current target;
it cannot certify native-view latency. A partial local unit run overlapped its
first sample and was stopped; no causal performance claim is made from it.

Extended 90-second runs with client 3020299 remained incomplete: visible Spot
coverage reached 26.47054 / 30 hours; USD-M 8.00920 / 30 hours. These numbers are
clipped to the actual requested viewport, excluding archive padding. Normal wall
pages still perform 7–9 SQL queries with substantial reads and serial delivery.
Prepared exact time chunks/segment compaction remain implementation work. The
query-log diagnostic failed because query_log is disabled; no global logging,
collector configuration or exchange connections were changed.

### Reproduction and operations

Build with `pnpm build:staging:diagnostics`, then serve with
`pnpm preview:staging:diagnostics`. The preview must use `--mode staging`; an
initial preview without it returned app HTML on the health route and was rejected
before live testing. `source-version-proxy-verified.json` records the corrected
JSON health routes. Benchmarks now reject abbreviated declared client hashes,
and reports label Fit Walls / extended observations supplemental. Test browsers
use their own class and i3 workspace 9; a narrow temporary-profile fallback also
catches default-class Playwright windows without moving ordinary Chromium.

The backend rollback repair preserves six prior serving images and starts SQL
admission before dependent services. The deployed 7256fd4 rollback entrypoint
was repaired without executing a rollback. Collector IDs/start times remain the
original October 25 identities. Actual rollback behavior is not yet exercised.
Warm five-run acceptance, matched concurrent-history validation, complete 30h
retention/frame measurements, final route comparisons and remaining latency
failures stay open. No production deployment or main merge has occurred.


## Prepared wall chunk implementation, continued

Backend `b4f0e20` repairs a real pinned-history metadata error: continuation
coverage could import today's midpoint/book scope if the global cursor had not
advanced, and then change to null under the same pinned watermark. Only actual
historical carry-in context is now exposed. The full failed USD-M comparison is
retained; the comparator continues to check coverage fields rather than dropping
them to obtain a pass.

Backend `536f25d` adds a resumable one-hour prepared chunk store using the
canonical display API and the existing durable publication helper. Each step
processes one bounded page, with 4 MiB decoded parts and a 128-part explicit
capacity bound. Data is content addressed and gzipped before checkpointing.
Publication verifies the complete ordered canonical-page revision, including
financial/coverage metadata; only the mutable profile catch-up label is excluded.
Reads verify manifest membership and compressed hashes. Failed loads, changed
heads/revisions and capacity errors retain good checkpointed parts. A final
checkpoint interrupted before manifest publication resumes without replay.
This is a storage foundation: chart delivery, manifest discovery, scheduler and
global retention integration remain open; the serving chart route is unchanged.

The same real Spot hour contains 5,316 exact patches and four explicit source
gaps. Its native-JSON prototype used five prepared parts (8,556,464 decoded bytes,
389,975 gzip bytes). The bounded two-pass source comparison matched all pages.
Those prototype records predate the final publication-revision guard; final
real-source validation must use the committed implementation and deployed
metadata fix. Source preparation timing is separate from ready-server latency.

The rejected shape/dictionary decoder experiment is in
`artifacts/pi-history-r1/wall-codec-experiment`. On the arm64 Pi, all five
native JSON decode samples were 65.663, 71.519, 65.657, 62.310, 64.436 ms
(median 65.657, maximum 71.519). Compact decoding took 608.258, 682.123,
860.382, 600.698, 548.988 ms (median 608.258, maximum 860.382). Gzip bytes
fell only from 389,975 to 322,507. The runtime therefore uses cached JSON/gzip
with native parsing; experimental codec code is retained only as evidence.
These CPU samples do not certify browser paint or any 30h release gate.


### Deployed chunk storage and metadata verification

Staging serving build `536f25d9e63c4ce622b8140c3c5223a72ce927f2` passed the
guarded 218-test/typecheck/build rollout, index and read-only state checks. All
six serving/helper containers were healthy afterward. Collector IDs/start times
remain exactly the October 25 identities recorded with the rollout; USD-M
execution/depth overflows remain zero. Backend branch `27b5d4c` additionally
contains the resumable proof command and documentation, without another serving
rollout. The original dirty project checkouts remain preserved.

The committed final publication guard passed both real HTTP comparisons through
this deployed API. For the fixed November 4 14:00–15:00 UTC hour:

| Market | Exact canonical patches | Parts | Decoded / gzip bytes | Explicit historical gaps |
|---|---:|---:|---:|---:|
| Spot | 5,316 | 5 | 8,556,464 / 389,983 | 4 |
| USD-M | 6,051 | 6 | 8,879,480 / 429,712 | 4 |

Every prepared page, including financial values and coverage metadata, matches
the independent pinned reference. `complete` here certifies delivery of the
canonical pages; both sources remain honestly partial because their historical
gaps are preserved. These are x64 staging server checks over existing canonical
wall archives. The reported preparation/readback passes (4.620 and 6.574 s)
exclude the initial reference capture and include readback/decode; they are not
whole cold-build, Pi/client-route or chart measurements.

A separate real Spot resume check deliberately stopped after one part at cursor
15652311. The next invocation reused its saved watermark/revision, continued
from that cursor, and completed the same five parts with an exact reference
match. The first invocation took 5.195 s including reference capture; the resumed
invocation took 5.651 s, including a 5.581 s preparation/readback interval and a
35.905 ms decode subset. Its saved 3.846 s reference phase belongs to the first
invocation and must not be added to the resumed total. The new proof tool labels
these phase scopes explicitly. Raw requests, results, immutable parts, manifests,
rollback records and the failed predecessor comparison are retained together.

No chunk-serving endpoint or chart consumer is enabled yet. The 30h delivery,
first paint, warm browser, concurrent history, retained memory/frame and remaining
footprint latency gates remain unchanged and incomplete.


Read-only HTTP delivery is now implemented after the deployed build. Its local
HTTP integration tests verify native gzip/identity decoding, exact decimal data,
private immutable part caching, independent ETags/304, market/input validation
and cancellation. The full backend suite now passes 219 tests, plus typecheck and
build. This endpoint change still needs staging rollout and real route checks;
source discovery, fair preparation/retention and chart consumption remain open.


### Prepared read-route results and independent tunnel recovery

The read-only endpoints are deployed on `072cc1d55e931ea82ee8edd623ef22543f454fa7`.
A verified installer added only two immutable derived samples (819,695 compressed
bytes total), preserving all raw source/checkpoints and collector identities.
For the same fixed Spot hour, each received part matched its SHA256 and source
revision; all successful responses reported zero database reads/queries.

| Route | Every complete received-hour sample, ms | Median / max of the complete five-sample series | Received parts of five |
|---|---|---|---|
| Staging loopback, x64 | 59.189, 49.540, 48.403, 36.823, 38.168 | 48.403 / 59.189 | 5,5,5,5,5 |
| Pi SSH history transport | 21070.760, incomplete, incomplete, incomplete, incomplete | unavailable | 5,0,2,4,0 |
| Pi Vite preview | 7436.763, 9319.397, 5482.075, 7121.338, incomplete | unavailable | 5,5,5,5,4 |

These are bounded one-hour transport/decode diagnostics, using a new two-socket
agent per run and no HTTP cache. They do not measure paint, certify 30h coverage
or replace any browser gate. Request timeout is 15 seconds and run observation
45 seconds; failures remain incomplete rather than becoming unavailable source.
Network conditions varied between these sequential route series, so the Vite
numbers do not establish a causal proxy speedup. The actual history SSH TCP
sample during Vite reported about 842 ms RTT with retransmission/reordering
counters. Complete request phases, compressed/decoded bytes and failures are
preserved in the raw JSONL. Five current-health observations around the end were
live, recovery count 245, no execution overflows, 1.40–1.73 s. The original raw
label says `during`; its scope audit explicitly excludes a concurrency claim.

Both local tunnel listeners were absent during preflight and were restored only
after healthy staging verification. The launcher also had a reproducible defect:
`wait -n` followed by shared cleanup killed the live sibling on a historical SSH
exit. Independent per-lane supervision now retries in 1–30 seconds without
replacing the healthy sibling, resetting backoff after 60 stable seconds. The
focused fake-SSH regression fails on the predecessor and passes after the fix,
including child cleanup; frontend typecheck passes. The active healthy pair was
left intact and keeps its original supervisor until its next launch.

Chart consumption/discovery, source-revision validation across reused closed
chunks, fair automatic preparation/retention and full 30h visible coverage are
still open. Source cursor order, carry-in and timestamp regressions must survive
chunk composition; a terminal cursor advance across a quiet tail is not its last
actual event. Normal current value changes also still need the remaining
closed-history reference-work audit. No production deployment or main merge has
occurred.

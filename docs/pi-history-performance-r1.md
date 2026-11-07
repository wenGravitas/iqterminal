# Pi history performance release R1

Implementation and performance acceptance are separate. No production deployment or merge is authorized by this release.

Current staging serving build is `18579d938364e5fd5a9c7631bb19681a043f1b66`.
Current measured production client is `7a1f6b129c78cf3e86178759bd98617213bcd701`.
Backend coordinator Retry repair `bba1e6746cf8d861b6683355dc295cc88f0c22e4` has
isolated staging validation; it has not replaced the serving build. Its 260 tests,
typecheck/build pass. Latest frontend full suite: 1,093 pass / two skip,
typecheck/build pass; nine prior functional UI checks and the explicit headed
retry protocol check have their own scopes/builds below. Collectors are unchanged.

New backend source `00f11e0` has 273 passing tests/type/build for the opt-in
consumer admission bridge; it is disabled and has not been staged or wired into
the client. Its component proof is distinct from bba1e67's real cache Retry proof.

Footprint coverage repairs have complete real-chart evidence, but their latest
latency gates remain failed. Prepared USD-M walls have an older full-coverage
observation (23,850 walls / 104,112 points / 47 gaps at 143.524s), not a current
client latency pass. Spot 30h is now prepared and published, with all 8,293 walls /
49,154 points / 35 gaps checked against canonical and original-projector references.
Its five Pi loading samples FAIL: first-history [null,9591.6,null,null,null]ms,
complete all null. A separate 180s attempt also has no historical paint and fails
with discovery HTTP 502; the native chart bootstrap took 4.870s in that attempt.
Thus full Spot browser coverage is still unproven, despite complete server files.

Durable exact-view wall supervision now has server-only validation; serving
admission, rolling-window reuse, derived disk retention, warm/current-concurrent and full-view repeated-use resource gates remain open.
Earlier failed cohorts and timed-out tests remain below with their exact builds;
eventual completion and independent reference checks do not supersede loading gates.

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

## Current candle startup and retained wall references

Frontend `fee695f1089537f62b5175140425e6de1c9f2aca` removes the wall-strength
reference scan of every retained closed segment on an isolated current change.
An ordered, reference-counted index maintains per-segment USD extrema. Snapshot,
settings and visible-scope transforms rebuild the reference; ordinary updates
replace only affected extents. The global retained-scope reference survives pan
and price transforms. Removed data eagerly releases geometry, dirty/tail and
reference entries, including while hidden. Full run replacement now reprojects
the affected segment: a regression reproduced an earlier corrected USD value
remaining 100 instead of 900. Independent min/max oracles cover duplicates,
removal, retention, settings, viewport changes and empty/reopen/detach; getter
instrumentation verifies zero closed-reference reads during a current-only
change. The 1,000-update hidden test bounds pending work to retained data.

The focused renderer/lifecycle tests passed (38). Full default and two-worker
runs encountered the existing vault KDF timeout; the isolated vault passed all
eight tests, and the unchanged full serial suite passed 1,033 with two skips.
All failed and passing logs are preserved in `artifacts/pi-history-r1/renderer-reference/`.
These are correctness/retention tests, not a measured Pi rendering gate.

Frontend `a1dc934f23a82987c2912de0a4578af8488ca3f9` also fixes a source-confirmed
current-data prerequisite: native candle WebSocket creation formerly followed
the entire `/v1/native-candles` HTTP/body load. The existing 45-second transfer
regression therefore implied a 45-second current startup delay. Native streaming
and native history now start independently, and the first stream candle emits a
snapshot. Reconnect does not refetch successful history. HTTP failure/retry has
its own state and backoff, preserving current bars and a healthy socket.

REST revisions are server receipt times, while streamed native revisions are
exchange event times (`server.ts` native REST/kline contracts). A bounded map of
native receive sequences protects forming bars and all concurrent native
updates from a late REST response. Closed historical repairs remain possible;
older cached closed events cannot undo them, and finalized candles cannot
reopen. History merges retain current bars rather than replacing the whole
cache. Native receipt freshness is tracked separately from collector heartbeats:
heartbeats alone cannot certify missing or expired native updates. The chart
shows a separate candle-history loading/error message and Retry while live
updates remain healthy. No collector or exchange connection was added.

Three new startup regressions fail against the old prerequisite; six new
lifecycle tests cover delayed history, independent retry/reconnect, REST/native revision order,
stale heartbeats, closed repair/replay and bounded 1,000-bar bookkeeping. The
full serial suite passed **1,039 tests, two skips**, and the staging diagnostics
build passed. This build's real-browser and timing evidence must be assessed
separately below; no existing failed performance gate is promoted by these unit
results.

All nine deterministic browser lifecycle checks passed on the `a1dc934` staging
build (headless Chromium / software rendering). The dedicated native test
paints a real chart candle before releasing HTTP, exposes a history-only 502,
clicks the visible Retry, and verifies three retained candles, the unchanged
forming close and one native subscription. Its socket counter excludes unrelated
depth subscriptions; the first test run counted both and is retained with that
instrumentation failure. The shared fixture now emits actual native candles;
collector heartbeats alone no longer establish a healthy native-feed precondition.
Screenshots and raw logs are in `artifacts/pi-history-r1/native-independent/`
and the two `native-current-before-history.png` /
`native-history-recovered-live-retained.png` screenshots beside it.

A **single supplemental**, normal headed Pi Chromium GLES / Canvas2D observation
used `IQ_BENCH_FIT_WALLS=1`, `IQ_BENCH_KEEP_CURRENT=1`, 30 seconds, fresh browser
cache and the actual preview/SSH route. i3 reported workspace 9, unfocused.
`native-independent-reference-samples.jsonl` retains the full request/resource,
coverage, current and frame evidence. Actual navigation-relative paint marks were
6,763.7 ms current and 19,531.1 ms historical; complete visible coverage was not
certified. The older `firstHistoryMs` counter observation of 1,789.1 ms is **not**
the actual historical paint mark. No causal before/after speedup is claimed.
The report correctly labels this fitted/extended single sample SUPPLEMENTAL.

At the end, 669 segments / 2,711 archive runs were retained, 1,467 historical
and 25 current drawables visible, no page errors and no value/episode cap flag.
After 23 seconds, sampled changed draws maintained the same 669 retained
segments; nonzero reference work touched 16 segments / at most 25 values, with
no additional reference rebuild beyond the four initial/reconfiguration builds.
This supplements the exact closed-getter unit regressions; it is not a heap
plateau or 30h test. There were 22 long tasks (maximum 1,160 ms) and a 1,433.4 ms
maximum frame interval, including startup and history work. The current target
remains unaccepted, and the remaining long tasks need CPU attribution.

Remote preflight and post-observation health confirm backend
`072cc1d55e931ea82ee8edd623ef22543f454fa7`, healthy default/pinned materializers,
no default backlog, and an independently progressing existing 3% custom profile
backfill. The two source collector IDs and October 25 start times match the
previous proof. Perpetual execution recoveries are now 246 (previous proof 245),
Spot 77; execution/depth overflow counters remain zero. This is source continuity
and bounded functional evidence, not a matched concurrent-history gate.
The pre-existing failed `aide-check.service` and `staging-restore-test.service`
were recorded without remediation.

Operationally, a native candle-history error now uses chart **Retry** to resume
HTTP without resetting healthy native streaming or unrelated footprint feeds.
A successful response clears the error. Automatic bounded backoff remains
available; a disconnected native socket reconnects independently of history.
Roll back the frontend build to its previous pinned commit if needed; this
change needs no server/collector restart, source migration or retention change.
All existing performance gate failures and remaining prepared-wall
consumption/discovery/retention work in the completion audit remain open.

The benchmark harness now reports `firstCurrentMs`, `firstHistoryMs` and
`completeMs` directly from navigation-relative main-thread paint marks, with an
explicit `timingBasis`. Historical wall paint must also match the requested
viewport. Earlier raw records are retained unchanged; the acceptance report was
already based on `paintMarks`, so this corrects ambiguous console/result counter
fields without promoting earlier failures.

## November 6: native bulk import and failed-default recovery

Client runtime `42db2e8845c71bc0d3bb32fb8ccdf32189c230bc` imports large native
history through one merging snapshot. The earlier independent-current change
could deliver a live candle before HTTP, after which importing 999 older candles
called the chart engine's individual update API 999 times. A normal headed Pi
CPU diagnostic reproduces repeated data/index/accessibility rebuilds. The new
worker message marks large imports for merge; the panel retains older displayed
bars and rebuilds its series once. Current ticks and small corrections remain
incremental. A 1,000-bar worker cache therefore does not truncate an existing
5,000-bar displayed chart on history Retry, and its saved absolute viewport and
independent forming candle survive. Financial aggregation and source revisions
are unchanged.

The explicit deterministic chart-kernel diagnostic alternates both methods on
the same 1,000 canonical input candles, with CPU profiling enabled. Every row
below is a separate normal headed Pi series; it is **not** an end-to-end loading
gate or a causal whole-application speedup:

| Series / method | Every apply sample, ms | Median | Maximum |
|---|---|---:|---:|
| Initial, individual updates | 356.3, 449.4, 251.1, 190.5, 191.1 | 251.1 | 449.4 |
| Initial, bulk snapshot | 1.5, 1.8, 1.0, 1.2, 1.3 | 1.3 | 1.8 |
| Verified-build repeat, individual updates | 317.6, 249.9, 244.9, 237.5, 202.4 | 244.9 | 317.6 |
| Verified-build repeat, bulk snapshot | 1.4, 7.6, 5.6, 4.1, 1.2 | 4.1 | 7.6 |

Both methods produce exactly identical chart bars. The repeat verifies compiled
build/mode, explicit fixture selection, zero network sockets and arm64 Pi model;
it saves the executed diagnostic source/hash and raw CPU profile. Fixture
selection is explicit and does not replace a failed live feed. The first profile
attributes work to `addBars`, `_rebuild` and `_updateAccessibleSummary`.
`native-history-apply*.json`, `.cpuprofile` and screenshots preserve the runs.
The full frontend serial suite passed 1,040 tests/two skips; all ten browser
lifecycle checks pass, including one bulk snapshot/no multi-bar patch, 5,000-bar
retention, earlier closed history, current revisions and saved-view restoration.
An initial timing-array TypeScript error and its corrected build are retained.

Live preflight then found a different real failure: a default current footprint
job remained failed at a saved cursor after three `fetch failed` attempts,
despite healthy gateway/depth health. The failed job's original transport error
origin is not isolated. Explicit Retry resumed its cursor; processed records and
cursor advanced by the same 119,400 IDs before a fresh forming bar returned.
The captured forming snapshot's 149 records and OHLC match a pinned canonical
FINAL query (18,657 rows / 802,393 read bytes). This proves that bounded reference
scope, not all recovered closed cells/extrema or a cold-build timing.

Backend `95017a09f5838a18b1196901aa3b8f249545a6e8` adds durable bounded supervision
of **needed defaults only**. Recognized transient query/transport failures may
resume at least 30 seconds after their ordinary retry deadline, at least 60
seconds apart and at most three times per five-minute window. Cursor, accumulator
and published work remain intact. Ordinary polling and healthy jobs are not
reset; capacity/storage/source failures and optional jobs retain explicit Retry.
Needed default closed jobs receive the same bounded supervision. Full backend
validation passed 222 tests, typecheck and build, locally and in the guarded
staging rollout. No source schema, raw retention or collector configuration
changed.

The six-service staging rollout passed on `95017a0`; collector IDs/start times
match before/after and the gateway state mount remains read-only. Two known
untracked probes were hash-checked and archived before the remote fast-forward;
other untracked work was preserved. All four Spot/USD-M, 5m/$25 and 1h/$25 current
configurations then returned ready, each recording one automatic recovery and
**no explicit Retry in the validation probe**. All four latest-closed input-version
and independent-forming publication checks also passed. These observations do
not measure the exact publication delay at a clock boundary. Post-series
collectors are live, execution recoveries 246/78 and execution/depth overflows
zero. Spot recoveries increased from 77 to 78 during the observation; its origin
is not attributed, and no gap-free concurrent-source claim is made. The existing custom 3% wall profile backfill continued.

Five comparable fresh-browser current-footprint samples on this client/backend,
normal headed Pi Chromium GLES / Canvas2D, actual split-SSH/Vite route, and the
same 11:55 UTC forming slot are:

| Actual current paint, every sample (ms) | Median | Maximum | Gate |
|---|---:|---:|---|
| 4413.5, 4609.3, 5779.5, 6388.9, 4853.3 | 4853.3 | 6388.9 | **FAIL** (limits 2000/3000 ms) |

`nov6-bulk-current-stable-slot-samples.jsonl` contains every request, actual flags,
requested/rendered bounds, paint marks, frame/long-task and resource sample.
This is the current-display gate; it does not certify complete 4h closed-history
coverage. The preceding exploratory series crossed a forming-slot rollover:
6513.8, 5533.8, 4860.6, 5596.4, 4271.9 ms. Its raw records/screenshots remain in
`nov6-bulk-current-samples.jsonl`; it is not used as a fixed-slot five-sample gate.
No p95 is reported and no threshold is widened. There is no matched causal
before/after whole-application comparison.

A separate opt-in CPU-profiled startup sample is SUPPLEMENTAL, never a gate.
It painted current at 5009.3 ms. Navigation/resource records and CPU samples are
in `nov6-startup-profile*`; startup still has large native/DOM/indicator work.
The main 2.38 MB JS resource took 619.5 ms in that sample and DOMContentLoaded
was 1833 ms. A worker ResourceTiming entry has a negative duration; it is retained
as anomalous raw evidence and is not used for phase attribution. Main-thread
samples include floating-overlay synchronization, indicator initialization,
DOM append and footprint cells, as well as unattributed native/program work.
Parent/child samples are not added as exclusive phases. Early worker/feed
startup and eager chart initialization need further investigation.

Raw successful/failed test logs, the failed/default recovery inputs, canonical
reference, source health and reports are under
`artifacts/pi-history-r1/native-bulk-default-recovery/`. The full deployment,
rollback and readiness records are under `default-recovery-staging/`.
Prepared wall source discovery, fair preparation/retention and actual chart
consumption remain open; directly concatenating hourly files would violate the
current fence/cursor ordering contract when source timestamps regress. All
previous unresolved gates remain incomplete. No production deployment or merge
has occurred.


### Early feed startup: complete coverage, latency still failing

Client `2c7c396e27d2ac041a99e16fda30dcdcf187580a` starts the saved source
selection before the large UI module loads and hands one worker to the UI.
A deterministic browser check blocked that UI module: six bounded historical
requests and current/native reads began independently, then all 24 historical
bars appeared after UI release, without another worker or duplicate bootstrap.
The startup selection is read-only and reconciled with the full UI config before
handoff. Focused legacy/source/restore tests and the full suite passed: 1048 tests,
two skipped; typecheck/build and eleven browser lifecycle tests passed. These
are correctness checks, not real latency acceptance.

Normal headed Pi Chromium through port 4181, backend `95017a09f5838a18b1196901aa3b8f249545a6e8`,
empty browser contexts, actual Canvas2D renderer, produced these five samples:

| Scenario | Every sample (ms) | Median | Maximum | Gate |
|---|---|---:|---:|---|
| First current footprint | 6694.8, 3957.2, 3616.4, 3316.5, 3396.7 | 3616.4 | 6694.8 | FAIL |
| Complete prepared 4h/5m | 6976.6, 9113.4, 6207.7, 7378.3, 5866.2 | 6976.6 | 9113.4 | FAIL median |

All five historical samples loaded and painted all 48 requested closed slots.
The same pinned server window was checked before measurement: 48 ready 5m bars
and all six chunks containing 24 ready hourly bars, with no build jobs.
These readiness checks do not measure cold materialization. The latest 24h
latency series is outstanding. The 4h result regressed relative to an earlier
build; early startup is not an accepted overall performance improvement.
Raw samples, screenshots and executed scripts are `nov6-early-current*` and
`nov6-early-4h*`; startup logs/readiness are in `early-startup-validation/`.
No heavy verification ran concurrently with these latency series.

These samples add a splash-hidden/app-ready guard, but still used the RAF frame
start as the mark. That timestamp can precede a costly draw in the same frame.
They remain unchanged as raw evidence and are not precise end-of-draw latency.
Subsequent samples use `navigation-relative-painted-content-observation-v2`:
`performance.now()` after observing painted content, rather than the RAF argument.
The primitive now stamps its diagnostic at the end, including totals/candles.
This is a conservative main-thread observation of painted content, not compositor
presentation telemetry. Timing methods are recorded and must not be pooled as a
causal A/B comparison. Earlier failing samples are not converted to passes.


### Completed-draw observation and deferred optional settings

The supplemental `nov6-observed-profile*` run uses client
`7fcbde4ae0204e12d2f0060540498a84c51c0c96` and the stricter observation clock.
It observes all 48 historical bars at 5382.1 ms, with CPU profiling enabled;
this is not a gate sample. The CPU profile identifies eager TPO settings DOM
construction (the compiled `ND` constructor) and other DOM/control work during
startup. The final observed primitive draw takes 118 ms; repeated drawing also
remains a responsiveness concern. Self/parent/native samples are not summed
as exclusive phases or attributed entirely to JavaScript.

`3f51f58` defers TPO and Footprint Totals settings DOM until first open;
`fa17643` applies the latest TPO status after `open()`, which clears the line.
Subscriptions, profiles, closed cells and live accumulation retain their existing
paths. The browser regression verifies data arrives before settings exist,
latest status, dialog reuse, a persisted Totals option and disposal on charts
that did and did not open dialogs. All twelve browser lifecycle checks pass.
The full unit suite passes 1048 tests, with two skipped; typecheck/build pass.
Raw passing and initial failing logs are in `early-startup-validation/` with
SHA-256 records. No heavy tests/builds ran during the latency series below.

The exact served build is `fa1764330c30b440bb78a5d603f381f94c6529e7`;
`nov6-lazy-build-assets.json` identifies its asset bytes/hashes. Backend remains
`95017a09f5838a18b1196901aa3b8f249545a6e8`. Each actual worker diagnostic was
checked: staging mode, history tiles enabled, matching full build, fixture false.
Future benchmark runs reject a mismatch explicitly in the sample record.
Normal headed Pi Chromium/GLES uses the actual Canvas2D chart backend; all
windows remain on workspace 9 without focus changes. Browser cache is empty for
each sample. Server readiness was rechecked for the same pinned windows:
48 five-minute bars and 24 hourly bars, no build jobs.

| Scenario | Every sample (ms) | Median | Maximum | Gate |
|---|---|---:|---:|---|
| First current footprint | 4199.8, 5164, 4081.7, 3622.3, 4591.4 | 4199.8 | 5164 | FAIL median and maximum |
| Complete prepared 4h/5m | 4352.4, 5156.2, 4537.6, 6191, 5289.5 | 5156.2 | 6191 | FAIL median |
| Complete prepared 24h/1h | 11709.5, 5720.1, 5613.6, 4748.2, 5667.4 | 5667.4 | 11709.5 | FAIL median and maximum |

All ten historical samples validate and paint every requested closed candle:
48/48 or 24/24. First useful historical content in the 24h series occurs at
7836.2, 4085.4, 4741.8, 4568.1, 4979 ms, before full completion. Per-sample
requested/retained/painted time arrays, environment checks and gates are in
`nov6-lazy-coverage-and-gates.json`. Raw requests, header/body sizes, host resource
samples, frames/long tasks, screenshots and executed scripts are `nov6-lazy-*`.
No p95 is inferred. No ranges or latency thresholds changed. These records use
the stricter observation clock and must not be pooled with older RAF-clock
series to claim a causal speedup. Both current-display cohorts remain within
their respective forming slots; current-only paint is not historical content.

The post-series runtime/source/resource check is `nov6-lazy-server-after.json`.
Both collectors remain live with their original container IDs and October 25
start times; execution and depth overflow counters are zero. Execution recovery
counters are 246 perpetual and 78 Spot, unchanged from this turn's health sample.
This does not certify the still-outstanding matched concurrent-history gate.
No backend service, collector or source retention was changed this turn.

Operationally, these UI changes require no data migration or historical retry.
For rollback, build the previous reviewed client in a separate clean worktree
and serve its dist with the diagnostic preview; preserve the supervised tunnel,
healthy sockets and server cursors. Do not reset a dirty checkout or restart
collectors. History Retry remains scoped to the failing history operation.
Full release acceptance remains incomplete: startup/render cost, prepared wall
source discovery and exact compact chart delivery, warm revisits, concurrency,
full 30h repeated-use measurements and remaining audit entries are still open.

## Prepared wall views: implementation and isolated source evidence

The v5 path now connects exact-view prepared manifests/parts to the actual archive
loader. It uses shared scheduling, two-part bounded prefetch, decoded content
hashes, cursor-chain validation and independent terminal source validation. The
same canonical projector receives the same financial pages. Quiet-head progress
rebases transport metadata only. A retained prefix can resume only its original
source token; a superseded revision rebuilds behind retained display. Failed
views without a resume cursor now expose Retry without reconnecting current
subscriptions. Extended live-tail projections keep an untouched retry baseline.

Backend commits `fd4e09b` and `fa7807a` are pushed. At this checkpoint they are
**not deployed**; staging serving remains `95017a09f5838a18b1196901aa3b8f249545a6e8`.
Only the isolated `/home/daz/iqterminal-wall-source-probe` checkout was used for
real preparation. Collector lifecycle and raw retention were not changed.

`nov6-prepared-wall-v5/` retains raw timings and the completed manifest for USD-M
`1793797200000..1793800800000`. Preparation persisted five exact canonical pages,
512/1113/935/1121/830 patches, 8,161,242 decoded bytes. Separate invocations prove
persisted resume. One attempted final publication failed because proof fields
were accidentally rehashed; the helper now normalizes request identity and its
regression test reproduces the bug. The failed run remains in the evidence.
Fresh independent bounded canonical reads matched every complete prepared page,
including seed, patches, ordering, gaps and metadata (mutable profile telemetry
excluded). Reference validation took 3256.2ms, 23 queries, 6,627,334 read rows and
796,909,361 read bytes. These are nested aggregate measurements, not exclusive
phase durations or browser load timings.

The source proof's independent SHA256/XOR reference covered 5442 FINAL canonical
rows and matched exactly. It verifies source identity, separately from the page
projection comparison. Anchor-query amplification remains material (~141MB per
measured anchor read); no schema/index change was made. Prepared transport still
carries exact page detail. No 30h latency, compaction, automatic fair default
preparation or disk-retention gate is claimed by this one-hour experiment.

Staging subsequently deployed `fa7807a2f68df9affe4bde00be9c592b15b221db` through the
existing guarded workflow: **235 backend tests pass**, typecheck/build pass, both
collector IDs/start times unchanged. Rollback image/commands and health checks are
in `nov6-prepared-wall-v5/deploy-fa7807a2f68df9affe4bde00be9c592b15b221db/`.
The client is `4cbc82788333cf168d28e60468e51ec0bdab7af9` with staging/history tiles
and diagnostics enabled. Targeted tests: **55 pass**; typecheck/staging build pass.
Headed actual-browser UI: **2 pass**, including Retry without a resume cursor.
Workspace 9 routing was verified while workspace 1 remained focused. The full
client run is **not green**: 1057 pass, 2 skip, 2 vault five-second timeouts. The
same vault file passed all 8 tests in isolation; no timeout was widened.

The padded 30h USD-M request `1793695500000..1793805300000` completed through 66
parts in separately bounded persisted invocations. It contains 128,019,127 decoded
bytes  / 5,870,380 gzip bytes. All66 pages matched independent canonical re-reads
exactly; verification took 29,187.7ms, 76,332,706 read rows / 4,551,404,862 read bytes.
The immutable lookup was published only after source revalidation, every part's
hash/bytes and collector identities checked. The actual Pi SSH discovery route
returned ready 66. Historical source gaps remain explicit, including original
persistence/disk-watermark gaps; prepared completion does not erase them.

Five empty-browser-cache normal headed Chromium/GLES runs of this already-ready
30h view are `nov6-wall-v5-samples.jsonl`, with every screenshot/request retained.
Actual environment matched the expected build/staging/history=true/fixture=false
in all five. First historypaint (ms): **10319.6,8158.1,null,9528.7,7024.4**.
Complete visible coverage: **null in all five** within the 12s observation. Both
first-history and complete-display gates **FAIL**. A null is incomplete, not a
latency sample; no median/max completion or p95 is invented. Screenshots show
only loaded prefixes while the full requested view/status remains incomplete.

This establishes real client use of the new immutable routes, not acceptable
performance. In run1 two part responses took only 4.08/8.05ms server read time,
while browser header waits were ~3.09s. The canonical projector applied its first
two pages in 190.9ms aggregate. These overlapping/browser/server durations are
separate observations, not quantities to subtract across hosts or add as exclusive
phases. Transport/admission/host overhead and the 128MB exact display payload
remain investigation targets. Prepared Spot 30h and all other outstanding release
gates remain unaccepted. Production was not deployed or merged.

The same immutable first part (36,820 gzip /954,631 decoded bytes) was read five
times per route with identical decoded SHA256 in all 15. Curl total times (ms):

| Route | Every sample | Median | Maximum |
| --- | --- | --- | --- |
| Staging loopback | 1.636,1.508,1.233,1.307,2.024 | 1.508 | 2.024 |
| Pi SSH | 3358.020,3056.427,2124.366,2222.264,2721.056 | 2721.056 | 3358.020 |
| Vite via SSH | 3740.835,831.771,1805.144,1035.374,1644.579 | 1644.579 | 3740.835 |

These are separate monotonic curl durations on each host, not timestamp
subtractions. The remote SSH process overhead is recorded separately and is not
part of loopback curl time. The route cohort is diagnostic, not a chart gate.
`nov6-prepared-part-routes*` preserves headers and wire bodies; the script supports
explicit immutable manifests and otherwise retains its old pinned batch probe.
An initial script-edit error failed before recording a sample; its code/log and
raw first response remain under the failed evidence paths. Local source-proof
typecheck finished before the Pi SSH/Vite curl samples; remote loopback curl
excludes its SSH process overhead.

The follow-up timestamp-regressing gap proof fix deployed as backend
`3e23410d83ea352e63a3935150d32815bec059ab`; its guarded rollout passed **236 tests**,
typecheck/build and identical collector/start checks. The benchmark above remains
pinned to `fa7807a`, not relabeled as a new-build result. The post-rollout resource
and source samples record the actual new build. The first Spot health probe
omitted the required `market=spot` and returned 400; the corrected explicit-market
probe is retained separately. This is a probe error, not evidence of source loss.

Five direct Tailscale pings were 992, 781, 730, 838, 881ms. They used the direct peer
endpoint, not a relay. Existing SSH sockets reported ~851–913ms RTT with recorded
retransmission counters. `tailscale-route-ping.txt` and `ssh-tcp-state.txt` preserve
the snapshot. No network configuration or collector was changed. These measured
route constraints keep performance acceptance incomplete; they do not permit
shortened ranges or raised gate thresholds.


Cold **prepared-display-cache** build scope: the canonical wall archive already
existed. Nine separate bounded invocations persisted 8/16/24/32/40/48/56/64/66
parts, with 47,549.9ms summed active invocation time, 249 queries, 86,321,231 read
rows and 8,374,980,013 read bytes. Manual delays between commands are excluded;
this is neither scheduler queue-to-completion time nor raw-depth-to-wall archive
materialization. RSS at invocation end ranged 137.6–197.0MB across fresh processes;
that does not prove a long-running chart/worker memory plateau. The actual job
run/page logs and raw one-hour independent canonical rows are retained alongside
the summary and SHA256 manifest.

## Bounded wall batches and progressive members (November 6 follow-up)

Backend serving is `18a68da4d87b059bfeb57529e4b7bdb2573d2983`; the guarded rollout
passed **237 tests**, typecheck/build and unchanged collector-ID/start checks.
Frontend served code is `c467e57b09fcb2d91bcf99ba3042fa60a737e92a`. Source commits
`ef083f5`, `6957834`, `8dcf039`, `dc9633e` and `c467e57` introduce bounded batches,
version compatibility, settled-task retirement, progressive application and
last-consumer stream cancellation. No production merge or rollout occurred.

The exact 66-part USD-M snapshot now uses one initial part and 17 bounded batches
instead of 66 individual part requests. Each response is limited to 8MiB decoded /
8 parts; each original part retains its 4MiB limit. The first content can paint
independently. Later verified members publish while the batch tail is still
arriving. EOF validation precedes the terminal member, and source validation
still precedes view completion. Failed tails retain the validated prefix and its
exact part/cursor boundary. Shared consumers cancel independently; the final
unsubscribe cancels the held stream and releases scheduler admission.

A real Chromium test rejected the initial concatenated-gzip design: it returned
exactly 954,631 bytes, matching part 0's SHA256, then stopped before the LF separator.
No invalid financial page was applied. Version 2 uses a single gzip stream, with
bounded asynchronous recompression and an 8MiB/32-entry LRU. Financial JSON bytes
are never parsed/reserialized by that encoder. The new immutable URL includes
`version=2`; both old and new clients can fall back to individual parts when the
advertised encoding is unsupported. The failed version 1 browser logs remain in
`nov6-wall-batch-v1/`; the corrected transport proof is `nov6-wall-batch-v2/`.

Real normal headed Chromium on the Pi verified all 66 original part hashes through
version 2. Seventeen sequential batch fetch/hash/parse durations totaled 203,751ms,
excluding initial-part and Node-between-call time. All 17 encoding-cache states
were cold misses over already-prepared canonical parts. This is a transport and
encoding check on an explicit empty page, not chart paint, raw-depth-to-wall
materialization, or an interactive gate. It verifies exact 128,019,127 canonical
JSON bytes plus framing. The source snapshot and original source gaps are unchanged.

Validation of the progressive reader: **68 focused tests pass**, typecheck and
staging build pass. The final full frontend suite passed **1069 tests / 2 skips**.
Earlier vault-timeout failures remain preserved; the same 8 vault tests passed in
isolation before the final clean full run. Browser lifecycle checks initially
passed 11 of 12; the native-history Retry test raced its own automatic successful
recovery. Existing production DOM reuse was already correct. The test now holds
its simulated source unavailable until explicit Retry; both 3-bar and 1000-bar
cases pass, retaining healthy sockets, live prices and the wider saved view.
Other 11 checks already passed on the same served product build. These explicit
fixtures are distinct from the actual-source loading cohorts.

The scheduler repeat-request defect has a direct before/after proof: a second
immediate request remained unsettled after 100ms with only 1 run on the old code;
the fix returns 2 with 2 runs. Completed or failed work leaves the deduplication map
before resolving its consumers. `iq-history-scheduler-repeat-proof.jsonl` retains
the evidence; the interval is a lifecycle probe, not a loading-gate threshold.

Five buffered-batch runs (`nov6-wall-batch-v2-samples.jsonl`, client 6957834) failed
complete 30h coverage within 12s. First-history paint was 8685.7,null,null,null,9309.9ms.
The first progressive cohort recorded only 4 terminal rows despite 5 screenshots;
its fifth timing is unknown and is not invented or pooled with a replacement.
The exact unresolved Playwright call was not journaled. Its response trace waits
were unbounded. The harness now records requests at start, saves observations
before context close and bounds trace finalization to 1s without changing the 12s
loading observation. Two focused helper tests cover an unresolved canceled trace.

The complete replacement cohort is `nov6-wall-progressive-final-samples.jsonl`:
client c467e57 / backend 18a68da, actual Pi normal headed Chromium/GLES and the same
pinned 30h request. All 5 staging/history/build/fixture checks passed, all 5 context
closures were journaled, and all 5 trace finalizations completed without timeout.

| Run | First useful history (ms) | Complete validated visible coverage by 12s |
| --- | --- | --- |
| 1 | 8955.4 | No |
| 2 | Not observed | No |
| 3 | Not observed | No |
| 4 | 7225.3 | No |
| 5 | Not observed | No |

Both wall loading gates **FAIL**. No completion median/maximum or p95 is fabricated
from missing completions. These cohorts have different code/route observations;
no causal latency win is claimed from them. Progressive delivery's earlier-member
behavior is proven by the delayed-tail regression and real partial paint, while
the route still prevents interactive full-view loading. Raw requests, journal,
resource samples, every screenshot, exact script/helper hashes and gate output
are retained. The latest source health remains live for both collectors with
recovery counts 246/78 and unchanged collector identities.

Automatic fair prepared-wall scheduling, bounded disk retention, reuse across
ordinary sliding/panned windows, exact display compaction, the new Spot 30h path,
warm/current-concurrency gates and full-view heap/frame plateau remain open.
The earlier current-footprint and 4h/24h footprint latency failures remain failures.
This is an implementation increment with measured failed acceptance, not a release
claim. Operational batch/retry/rollback details are in the backend's
`docs/PREPARED-WALL-VIEWS.md`.

All five final chart diagnostics report `backend: canvas2d`. GLES describes the
normal browser/compositor launch; no GPU chart-rendering or 60fps result is claimed.
`release-identifiers.json` and `served-asset-sha256.json` pin the actual served
builds, route, snapshot and asset bytes independently of later documentation commits.

### Exact portable wall projection and checkpoint evidence

The frontend archive projector now lives in `src/shared/order-walls-projection.ts`,
with a byte-identical backend copy. `scripts/sync-wall-projection-core.mjs`
checks both copies and generated SHA compatibility identifiers; use an explicit
backend checkout and `--write` only when intentionally updating the algorithm.
The current source SHA is
`c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c`.
No serving deployment or collector changes accompany this extraction.

The fixed 30h USD-M snapshot (key `0c59755f82338c16d9b012e1fd0e6214c521e39be58f809bc48def30b9112cbc`)
passed all 66 page patch/revision comparisons against the bundled original
projector (SHA `d5dec6192f00f2582f79afe93f5fe011ccb757130e71ccb8c8ac96001bbc5c3d`).
Closed records were transferred after each page and active state was serialized
and restored halfway through. The midpoint checkpoint was 178,601 bytes.
All 23,850 final segments and 104,112 actual value points matched exactly;
both segment hashes were
`de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6`.
The isolated staging-host verification took 1,974.070 ms, final RSS 273,838,080
bytes. This is a reference/resume check over existing prepared files, not Pi
paint timing or raw-source cold materialization.

The comparison exposed an incumbent counter defect: replacing a value at the
same timestamp decremented the retained count despite retaining the same number
of points. The original reported 104,086 for 104,112 actual points. The corrected
counter is asserted against actual retained points after every real page and in
a focused 40-correction regression. Financial segment/value contents are unchanged.

Evidence: `artifacts/pi-history-r1/wall-projection-checkpoint/`. Backend full suite
239/239, typecheck/build passed. Frontend full suite: 1,074 passed, two skipped,
two unrelated vault tests timed out at the existing five-second limit. Separate
vault rerun: 8/8 passed; frontend typecheck/build passed. Preserve both outcomes;
this is not a claim of a single all-green full run. Six checkpoint tests plus the
source-version test and existing archive/prepared suites passed in focused checks.

Checkpoint and closed-transfer helpers prepare the next delivery implementation;
they do not yet reduce actual chart payloads. Existing failed performance gates
remain failed and performance acceptance is incomplete. Rollback is a frontend
revert/rebuild; backend helpers are not on a serving route. Cached future
projections must match exact source, settings, range and algorithm SHA before use.

### Bounded selected-wall preparation and final reference

Frontend core commit `47bd469ca56bafc9cc9ca0df4c57862639880861` and backend
core `103da19b870b86eb50ee8dee06054a9f0f14f6dd` share the exact projector. Backend
producer commit `ce0a20819ebaf061e6f20a4b2e813bdc48921889` adds one-canonical-part
steps, immutable closed records, active resume state and an explicit bounded
preparation CLI. The version 2 key is
`a6d39a0a5e53f05455032059e17d7586fb17e6b332d648fea25701ded1c9831d`.
Its source SHA is `b8b86133394b33173a9abf6784cb9d108e5fc222d3f3a249cb4a741b3bcaea06`.

The initial public-index prototype was 6.6 MB; the final public manifest is
383,167 bytes. The private identity index remains in the resume checkpoint
(6,582,801 bytes); active projector state is 108,225 bytes. Closed records total
32,805,404 decoded / 3,004,574 gzip bytes, compared with canonical pages at
128,019,127 decoded / 5,870,380 gzip bytes. Long-lived walls exceeding one part
are split by exact value offsets, with header/order/sequence validation when
reassembled. Four focused tests cover final proof failure/retry, interruption,
wrong profile/filter, aggregate disk+active capacity, corruption and a wall over
4 MiB with 3,000 long exact-decimal value points. No financial resolution is lost.

Final isolated x64 staging transform: 9,649.009 ms preparation, 473.489 ms import,
317,575,168-byte final RSS / 128,808,944-byte used heap, unchanged 256 MiB V8 heap
cap. All 23,850 segments, 104,112 actual points and selected state match the pinned
original projector. The original/prepared segment hash remains
`de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6`.
This single sample uses already prepared canonical files and their stored proof;
it is not raw-source materialization, fresh DB proof, Pi paint or a latency gate.
Production preparation validates a fresh source proof before publication.

Backend final suite: 243/243, typecheck/build passed. Frontend diagnostics build
at `47bd469` and its ten footprint/bootstrap/Retry functional browser checks passed.
Those browser checks use explicit intercepted sources and headless system
Chromium/SwiftShader, so they are correctness evidence, not real-venue or headed
Pi performance evidence. Raw results are in
`artifacts/pi-history-r1/wall-projection-preparation/`; the missing-Node remote
launch and earlier format prototypes remain preserved. Collector Docker IDs and
October 25 start times were rechecked and still match the baseline. The staging
serving build remains `18a68da4d87b059bfeb57529e4b7bdb2573d2983`.

This producer is not yet connected to gateway discovery, batched HTTP delivery or
the chart importer. Automatic scheduling/retention, sliding reuse and remaining
five-run loading/concurrency/heap/frame gates stay open. Existing latency gates
remain failed. Retry and rollback are documented in backend PREPARED-WALL-VIEWS.md;
stop only the explicit derived job and leave collectors/canonical inputs untouched.

### Selected-wall client and HTTP implementation

Backend `94c73805c848ac260c3a5279ce8fc7098386785c` adds optional selected-projection
discovery and `/v2/history/walls/projection-batch`, bounded to 32 members / 8 MiB
decoded with exact content hashes and one gzip stream. Its explicit publisher
checks fresh canonical proofs before/after, compares all walls with canonical
prepared-page replay, checks serving build/collector identities, and installs
the completed manifest last. Discovery does not start jobs. The gateway keeps
its read-only state mount, historical admission bounds and current reserve.

The frontend consumes exact native JSON records with at most two byte-bounded
batches on the existing shared scheduler. Partial segments live in an incremental
presentation map; old closed history is not replayed, cloned or sorted for each
new batch. All records and the final independent source proof must pass before
request completion or live-tail handoff. A single full checkpoint restore then
preserves candidate/cell identity, original creation/value sequence order and
future update semantics. Quiet-head rebase changes only transport cursor/epoch.
Saved/good presentation remains during source failure and Retry; obsolete views
release their consumer references. Unsupported core/settings use canonical
prepared delivery. Current sockets and acknowledged cursors remain independent.

The actual frontend importer and batch delivery passed all 66 real pinned parts,
matching the original 23,850 segments / 104,112 points and segment SHA
`de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6`.
Five bounded batches replace the previous 18 requests. With read-ahead, the x64
in-process reference took 863.472 ms; client bundle SHA
`efab47a3bcd06e6e70cb284be761cb0a0234489bef1c07c15e53c66f011988a0`.
This is not network, Pi, chart paint, a fresh SQL proof, or a performance gate.
The earlier serial reference and missing-export prototype launch are retained.

Validation: 99 focused frontend checks pass, including fragmented records,
35-part/two-batch delivery, partial/final source failure, shared service joins,
Retry preservation, settings fallback and abort cleanup. Full frontend run:
1,078 pass, two skip, four failures (one 15-second detector-oracle timeout, two
five-second vault timeouts and a vault transaction failure). Separate rerun of
all nine detector/vault checks passes at unchanged limits. Typecheck/build pass.
Backend 243/243, typecheck/build pass. Raw evidence is under
`artifacts/pi-history-r1/wall-projection-delivery/`.

The staging rollout, publication and actual Pi five-run acceptance follow this
implementation; until recorded, existing latency gates remain failed. Automatic
fair selected-history preparation, sliding reuse, disk retention and remaining
coverage/concurrency/heap/frame gates are still open. No production deployment
or merge is included. Backend PREPARED-WALL-VIEWS.md records publication/retry and
rollback; the established staging rollback images apply to serving changes.

### Discovery capacity regression found on the Pi

All five `nov6-wall-selected-route-v2` samples failed first history and complete
coverage. The environment was staging/history-enabled at frontend 02e96dd and
backend 94c7380; the prepared source remained ready. The actual browser exposed
`Prepared wall response byte capacity`: the legacy 128 KiB discovery reader was
rejecting the larger selected-projection manifest. This is an implementation
failure, not absent source, and is retained as failed acceptance. An earlier
`nov6-wall-selected-v2` cohort used the wrong default port 4180, never loaded the
app and is retained as invalid setup evidence; it is not pooled with loading runs.

The repair explicitly requests projection metadata with the exact algorithm SHA
in `X-IQ-Wall-Projection`. Backend clients without that capability keep their
small legacy response. Opted-in discovery stays within the existing 8 MiB gateway
response budget, while source-proof responses keep their original bound. Shared
scheduler identities distinguish capabilities. A >128 KiB regression passes;
27 frontend prepared-history checks pass, typecheck/build pass. The backend also
bounds immutable encoding to three jobs, including canceled HTTP consumers.
The corrected five-run Pi cohort must still be measured; no gate is yet repaired
by assertion. The diagnostic production build at 02e96dd passed all ten browser
bootstrap/history/Retry checks before these actual loading runs.

### Deployed capability repair and actual Pi results

Staging `18579d938364e5fd5a9c7631bb19681a043f1b66` passed the guarded rollout's
243 tests/typecheck/build, index/read-only-mount checks and collector continuity
checks. Client `fb11b9c7bd0cba9864d2ac12d75023ca921687a1` is the diagnostic production
build at preview 4181. Actual proxied legacy discovery is 44,969 bytes without
projection metadata; opt-in discovery is 428,228 bytes and advertises the correct
selected key. The installed projection survives the serving rollout unchanged.

Five comparable normal headed Pi / empty-browser-cache runs are
`nov6-wall-selected-cap-v2`. Every environment is staging/history-enabled and
fixture=false. Requested viewport is 1793696400000..1793804400000 (30h), with the
canonical padded range 1793695500000..1793805300000. First actual history paint:
[10594.3, null, null, null, null] ms. Complete validated visible coverage:
[null, null, null, null, null] at the unchanged 12-second observation. Both wall
loading gates FAIL. No complete median/maximum or p95 is invented. Earlier
wrong-port and pre-capability failures stay separate. All traces finalize.

Separate observations never count as latency passes. At 60 seconds, 15,106 walls /
72,209 points are retained (49 parts); the 180-second pre-recovery observation
retains 12,472 / 60,106 (41 parts), still incomplete. A one-time raw immutable
768,116-byte gzip diagnostic has identical SHA
`61f3355e782c4daaf13575b83442529912dc0186cfa2fc1b284566167aa243b4`:
staging loopback 7.406 ms, stalled history SSH timeout 30,012.206 ms with no headers.
The small history-lane health read also times out at 15s; the separate current
lane responds in 3,910.309 ms. TCP observations show a roughly 1.1-second RTT,
congestion window three and cumulative retransmission/reordering counters; these
are not per-run loss percentages.

Only the verified task-owned history SSH child was terminated. Its supervisor
restored history PID 568801; current PID 424434 remained untouched. The initial
readiness observation ended before the replacement listener appeared; the same
replacement was then re-probed rather than restarted again. Recovered history
health completes in 2,735.057 ms. The identical batch then transfers through SSH
in 10,731.126 ms and through Vite in 13,821.082 ms with matching hashes. These are
single diagnostics, not five-sample route gates; differing runs do not establish
exclusive proxy overhead or permit subtracting unsynchronized host timestamps.

The recovered-lane supplemental browser observation has first history at
20,301.4 ms and completes validated available coverage at 143,524 ms. Actual chart
retention is all 23,850 archived walls / 104,112 value points; its viewport exactly
matches the requested 30h. `requestComplete=true`, loadedThrough=1793805300000;
`rangeComplete=false` correctly preserves all 47 canonical source gaps. No missing
book intervals become continuous walls. The full real-chart screenshot is
`nov6-wall-selected-recovered-coverage-walls-30h-perp-15m-1.png`.

Rendering remains a separate bottleneck: maximum draw is 417 ms in the 60-second
observation and 1,391.7 ms at full coverage. Existing incremental geometry and
reference counters show no repeated full reference scan during partial updates,
but repeated path painting/final snapshots need further work and measured browser
verification. Historical-only observations disable the current wall group and do
not certify current/concurrent gates. Source proof/financial equivalence and full
supplemental coverage pass; every original loading/interaction/repeated-use gate
still requires its own evidence. Performance acceptance remains incomplete.

### Reuse received presentation and unchanged native paths

The next frontend increment removes repeated final history replacement. Once all
prepared records and the final source proof validate, the service installs the
live-capable projector without resending already published segments. Failed
revision Retry still replaces only after full validation; late subscribers still
receive a complete snapshot. No presentation map remains attached to the final
result. An independent renderer boundary lets received historical spans paint to
their own confirmed extent while whole-view loadedThrough/requestComplete stay
honestly incomplete. Per-segment confirmed duration remains the upper bound.

Unchanged native Canvas paths are now reused instead of rebuilding styles,
coordinate arrays and commands for every price-tick repaint. Actual visible
geometry mutations, transform/DPR, settings and reference-extrema changes
invalidate the cache; offscreen updates without style changes retain it. Paths
are bounded by actual retained drawing geometry and dropped on detach. Immediate
rendering remains available for the explicit benchmark/reference and environments
without Path2D. No financial points, gaps, identities or configured budgets change.

In the final offline Pi benchmark, five alternating-order runs have per-run
median draw plus forced readback times (ms):

| Run | Immediate reference | Cached native path |
| --- | ---: | ---: |
| 1 | 103.85 | 27.00 |
| 2 | 220.75 | 41.90 |
| 3 | 129.15 | 46.05 |
| 4 | 94.00 | 68.70 |
| 5 | 111.35 | 34.10 |

Every raw eight-repaint sample, observed RAF interval, resource snapshot and
executed bundle is in `artifacts/pi-history-r1/wall-paint-cache-final/`. This is
headed system Chromium with native 2d/willReadFrequently and forced readback,
using the entire original real 23,850-wall / 104,112-point set. It is not a chart
loading gate, ordinary GPU paint timing or a claim of 60fps. All six full pixel
comparisons have zero differing channels (initial, cache hit, pan, DPR 2, style,
removal). Detach retains zero cached paths for both renderers.

Validation retains both full runs: the earlier 1,086 pass / two skip run, and the
latest 1,085 pass / two skip / one unchanged five-second vault timeout. All eight
vault checks pass separately at the original limit. Focused renderer/prepared
history/lifecycle checks, typecheck and build pass. The new production client
still requires its own real-chart loading measurements; existing failed loading,
concurrent/warm and repeated-use gates remain failed or open.

### Native-path client: measured route results remain failed

Client `acdf09c4d02e961f44c0203877c7f8ed212b3b27`, backend staging
`18579d938364e5fd5a9c7631bb19681a043f1b66`, actual Pi headed Chromium,
Vite production preview `http://127.0.0.1:4181`, staging/history enabled,
fixtures disabled: the five empty-client-cache, already-prepared 30h USD-M runs
in `nov6-wall-paint-cache-samples.jsonl` have first useful history
`[8389.2, null, null, 9240.6, null]` ms and all five completion times null at the
unchanged 12s observation. First useful history and complete coverage gates
**FAIL**. An incomplete cohort has no claimed numeric median/maximum.

The separate 180s `nov6-wall-paint-cache-coverage` observation paints first
history at 24,820ms, then stops with `Prepared wall batch HTTP 408`, partial,
retryable, requestComplete=false. Full path coverage for this client is unproven.
The older fb11b9c successful 143.524s coverage observation remains evidence for
that older build only. No completed-source absence is inferred from the timeout.
Real-chart cache hit counters confirm the new path is used, but partial-chart
render timings cannot establish full-chart latency or frame acceptance. All raw
samples, requests, executed scripts, gates and screenshots remain under these
label prefixes. Live is disabled in this pinned history scenario; it does not
prove current/concurrent acceptance.

Functional browser validation passes all nine settings/Top Levels/Threshold/
Fit Walls/Retry/consumer-disposal checks against the new diagnostics build.
These use headless SwiftShader and explicit fixture selection, separate from
actual Pi loading evidence. The settings test now counts cumulative subscriptions
correctly after its intentional hide/show cycle and checks exactly one active
consumer. Earlier stale-assertion failures and final logs/screenshots are kept in
`wall-paint-cache-route-validation/`. No product subscription logic changed.

### Bounded recovery of an empty temporary batch response

Prepared batch reads now allow three attempts total for HTTP 408/502/503/504
responses that have not published any member. Retry re-enters the shared history
scheduler after a 250ms/500ms backoff, honoring numeric Retry-After up to two
seconds. Longer/unrecognized Retry-After is an explicit failure for user Retry.
There is no automatic retry of content hashes, identities, missing files, source
changes or interrupted successful bodies. Already validated member promises and
financial records cannot be replayed by this path. Per-page diagnostics report
actual attempt count. Another consumer can cancel without disconnecting its peer;
the last consumer cancels backoff/upstream. No healthy live socket or cursor resets.
After the attempt budget, retain the good display and use History Retry as before.
Rollback is the preceding frontend commit, `72afc02`, with backend runtime and
prepared artifacts unchanged. This recovery fix does not certify latency.

The retained acdf09c coverage trace narrows the request bottleneck. Its first
projection batch has 653,301 compressed / 7,879,182 decoded bytes, response body
completion at 84,624.557ms from its browser request start. Backend Server-Timing
reports preparedread=20.18ms, zero SQL queries/rows/bytes. The concurrent next batch
gets HTTP 408 at about 84.7s, without the gateway request identity headers. Discovery
already uses gzip (100,060 compressed / 428,228 decoded bytes); it reports three
queries, 575,264 rows / 323,242,283 bytes and 407.08ms total gateway time.
These browser durations include overlapping requests and are not exclusive phase
sums. No cross-host clock subtraction is used. A separate current route diagnostic
has direct Tailscale pings of 1.450s/1.306s/0.843s; it is not the earlier cohort's
per-request network timing or a five-run release gate.

Recovery validation: full suite 1,093 pass / two skipped; typecheck/build pass.
All 96 focused scheduler/archive/lifecycle/prepared checks pass, with 15 final
scoped checks including explicit nonempty attempt metrics. Headed Chromium
155.0.8059.79 on workspace 9 passes an explicit offline injected-408 framing/hash/
exact-decimal protocol check in two attempts. The check also found and repaired
native fetch's accidental options-object method binding; its initial failure and
final executed bundle/results are retained in `wall-batch-temporary-retry/`.
This fixture result does not prove new-client full real-source coverage or any
Pi latency gate. No backend code, serving runtime or collector changed.


### November 7: pinned Spot preparation, exact reference and failed Pi gates

Serving remains 18579d9; preparation uses isolated backend 74837d7; measured
production frontend is 7a1f6b1. Visible request is
1793696400000..1793804400000; incumbent 5m padding makes the on-wire request
1793696100000..1793804700000. Profile is the canonical Spot BTCUSDT native 10%
Top-10 source, exactly deriving displayed Top 8/side. Source token is
`d211a7666f7c1231a2deaaea305e82b27f69536628244a72fb4e516bd621e394`, pinned
watermark 18047515. Canonical key is
`445660f531976fa8d83359067ca5aa40886d11f39c97388423654e3c71a727f2`;
selected key is
`efa5629adec8fcb0e7ffc93297bd273d178fae996fad4bae79b30862872863b0`.

All 34 canonical pages match independent FINAL re-reads. The actual frontend
importer/batch protocol matches the original projector from frontend
5358b9d162d8303fada24f2bb5679c4a2df306e6 for every final segment and selected
state: 8,293 walls / 49,154 exact value points. Both segment hashes are
`cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e`.
There are 35 explicit source gaps; they remain gaps rather than continuous walls.
The original/reference and current importer bundles, hashes, source proof,
canonical/projection manifests, progress, SQL/resource logs and guarded publication
records are in the backend repository's `artifacts/pi-history-r1/spot-30h-nov7/`.
Canonical data is 64,395,366 decoded / 2,794,422 gzip bytes; selected records are
13,330,354 decoded / 1,454,262 gzip bytes, delivered in two bounded batches.
The x64 in-process client reference took 378.346ms; it is not network/Pi/paint data.

Unpublished resume now reuses its durable horizon and validates fresh source at
publication. The same real next page produces byte-identical progress, before
versus after: 8 vs 5 queries, 335,499,035 vs 98,562,397 SQL read bytes. Single-run
elapsed values are 1,344.752 vs 665.076ms, but SQL queue wait is also different
(721.648 vs 158.786ms); do not attribute their entire elapsed difference to code.
No schema/index/limit change is involved. Matched prefix proof and raw samples
are retained. Final publication/recovery rejects regressed horizons and corrections.

Actual missing-derived preparation is separate from prepared delivery. The
canonical chain's nonoverlapping bounded invocations total 20,997.507ms processing,
132 queries, 34,751,439 read rows / 3,432,340,046 read bytes; first persisted page is
at 1,332.105ms in the first invocation. Sampled endpoint RSS maximum is 216,907,776
bytes, not a continuous RSS peak. This sum excludes manual gaps between invocations,
comparison/reference runs and publication. Selected preparation totals 5,059.233ms
across five serial invocations, with final source validation. Raw per-invocation
wall times/CPU/RSS/cursors remain authoritative; this is not one unattended build
latency or a cold-client cache timing. Automatic default scheduling remains open.

On the actual Pi/client SSH/Vite route, `nov7-spot-prepared` preserves all five
empty-browser-cache samples: first historical paint
[null,9591.6,null,null,null]ms, completion all null. Environments all verify staging,
history enabled, build 7a1f6b1, fixtures disabled. Both loading gates FAIL; no complete
cohort median/maximum/p95 is reported. Runs 1 and 5 have the unchanged 12s native
chart-bootstrap observation timeout. Run 2 paints only 16 active historical
segments / 183 points, rather than the full prepared set. Its screenshot and
actual plot-culling diagnostics verify a tiny historical prefix, not full coverage.

The distinct `nov7-spot-coverage` 180s observation reaches the exact requested
viewport after native bootstrap at 4,870.198ms, then fails discovery with HTTP 502:
zero archive walls painted, requestComplete=false, retryable partial history.
It is SUPPLEMENTAL, not a loading gate. Local tunnel startup first timed out;
supervision recovered and both direct lanes plus proxied build/health verified
before browser launch. Those startup errors and all later request failures are
retained. Historical source gaps and the unrelated Hyperliquid OI stale status are
not repaired or treated as source absence for this known-ready Spot view.

Normal observations keep the 12s boundary and original latency thresholds.
Supplemental observations now permit a delayed bootstrap within their explicitly
longer coverage budget; this cannot count as latency acceptance. The report's
first-history gate now also requires verified environment metadata. Three synthetic
reporting regressions pass; these are report tests, not financial/loading fixtures.
No heavyweight tests, builds or remote preparation ran during either Pi cohort.
Server health/RSS snapshots are retained, but per-frame server CPU sampling is
not available for this cohort. Warm, current/concurrent and full memory/frame
acceptance remain incomplete; history-only measurements cannot certify them.


### Durable wall supervision and server-only capacity evidence

Backend a6c5787 adds a separate bounded preparation coordinator around the existing
canonical and exact selected producers. It persists source/cursor/phase, processing
fairness and idempotent Retry tokens; existing CLI owners defer work rather than
having their locks removed. Its 11 regressions pass, and the full backend suite is
258 pass with typecheck/build. This is isolated operator tooling, not a deployed
serving API or an ordinary live-window integration. Serving remains 18579d9;
measured browser/client remains 7a1f6b1.

On real staged source, Spot stopped after six canonical pages, then a fresh process
resumed the same horizon. It completes 34 canonical plus 34 selected parts in 69
turns; summed nonoverlapping queue-step processing is 28,411.827ms. The already
prepared USD-M default reuses both stages in two turns / 1,390.576ms, ready at turn
15 while the cold Spot job continues until turn 71. The resumed process reports
33,768.309ms including scheduler spacing and metadata work. Manual restart gaps
are excluded; these are not one unattended build time or Pi cached-load samples.
Maximum sampled worker RSS is 199,544,832 bytes, not a continuous peak. Final
managed apparent bytes are 16,076,517, with the global owner released.

Both actual frontend importer/original-projector comparisons preserve every
financial segment and selected state: Spot 8,293 walls / 49,154 points / 35 gaps,
USD-M 23,850 / 104,112 / 47 gaps. Segment hashes remain the previously recorded
cf9d17a2...afd944e and de4d77b3...899c6, including the new Spot source horizon.
A completed-queue reopen makes zero build steps and leaves queue/step-log hashes
unchanged. It is operational idempotence, not the one-second browser warm gate.

Supplemental staging x64 loopback authoritative 1h/$25 current reads: five baseline
samples median 4.988ms / maximum 10.789ms; 34 during resumed preparation median
4.078ms / maximum 18.446ms, no errors and endpoint states ready/live throughout,
30 distinct monotonic cursors. Those durations use a single probe clock. The
initial helper's unverified cross-clock age field and post-check-inclusive child
field are explicitly ignored; raw executed source and corrected helper remain
available. Worker duration comes from its own monotonic interval. This is not
Pi SSH/Vite/UI first paint, continuous confirmation-gap proof, two chart loads
with custom backfill, or repeated interactive heap/frame acceptance.

Backend `artifacts/pi-history-r1/wall-preparation-coordinator/` contains all source
proofs/manifests, step CPU/SQL/RSS samples, current-read samples, identities, source
hashes and independent reference results. Serving build and collectors did not
change. No production deploy or merge occurred. Source-window generation, serving
admission, consumer cancellation/leases, global derived accounting/eviction and
standalone-CLI pin migration remain open. Every earlier Pi
loading failure and unverified acceptance gate is retained; server results cannot
substitute for chart acceptance.

### Public-only prepared-cache Retry recovery

Backend bba1e67 repairs explicit Retry of a completed public-only canonical cache:
fresh validation reuses its canonical and selected manifests without replaying raw
history or repinning its source horizon. A changed source still requires explicit
new revision admission. Retry rejects a full 32-pending queue while preserving the
ready cache receipt and command token. Both regressions fail on 5dd8b93 and pass
after repair; full backend 260 tests, typecheck/build pass.

On isolated real staging, two bounded steps retain all 66 canonical and 66 selected
parts, the exact horizon, coverage and 47 explicit gaps. All 134 immutable files
remain byte-identical; no private canonical progress file appears. Replaying the
same Retry command in a new process makes zero steps and leaves queue/step-log
hashes unchanged. The single child lifecycle samples (2,136.150ms and 194.437ms)
are server operation timings, not browser warm-load samples. Fresh validation still
reads 1,216,793 DB rows / 703,103,126 bytes in six queries. This amplification remains
visible. Serving 18579d9 and both collector identities/start times stay unchanged.

Backend e1921d9 records the exact validation helper hash, immutable file hashes,
source/queue receipts, SQL/resource samples and runtime identities under
`artifacts/pi-history-r1/wall-public-cache-retry/`. Ordinary-view admission, rolling
reuse, leases/cancellation, derived retention and standalone-CLI pin migration
remain open. Every failed/unproven Pi acceptance gate above is unchanged.

### Consumer admission bridge component (not yet live-view acceptance)

Backend b7855e4 connects explicitly enabled discovery to the existing separate
bounded coordinator over loopback. Consumer leases share exact work, pause it on
last release/expiry, retain progress and resume without repinning. Restart waits
for fresh consumer interest. Manual/default work survives visible cancellation;
paused artifacts yield active slots while remaining within tracked/disk budgets.
Completion concurrent with last release leaves reusable ready data. Explicit Retry
tokens remain idempotent and failures cannot reset through ordinary polling.

Backend 00f11e0 adds exact admitted-job hints to avoid repeated canonical-source
hashing during build-status polling. Ready discovery still independently validates
source. Twenty-six focused and 273 full backend tests, typecheck/build pass. The
tests include actual local loopback control requests plus bounded injected source
dependencies. They do not establish genuine staging materialization or Pi UX.
Raw outputs and the read-only serving/collector observation are in backend
`artifacts/pi-history-r1/wall-consumer-admission/`.

The bridge remains disabled. Frontend consumer identity, progress polling/status,
Retry and cancellation must be wired, then the persistent worker and serving path
must receive real staging validation. Serving remains 18579d9 in the recorded
observation, with unchanged collectors. This increment does not complete ordinary
view preparation, rolling defaults, long-term retention or any failed/unproven Pi
gate. No production deployment or merge has occurred.

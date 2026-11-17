# Initial Pi history release: completion audit

This audit preserves the full requested scope. A fixture pass, worker health,
loaded prefix or completed HTTP response cannot certify full chart coverage or
interactive performance. See [the measurement report](pi-history-performance-r1.md).

| Requirement | Current evidence | Remaining release work |
|---|---|---|
| Correct past viewport before alignment; four hours per request | `footprintPastViewport`, prepared/staging tests, five real 48-bar and five real 24-bar samples in `nov5-e13-7aa-samples.jsonl` | Actual-source five-closed-plus-forming reproduction now passes; retain final dark-theme artifact and later latency series |
| All chunks accounted for; partial/empty/gapped/failed states | Prepared footprint tests and per-slot progress in raw samples | Final coverage audit must not substitute `requestComplete` alone |
| History independent of current bootstrap and footprint autofocus | Browser delayed bootstrap and ordinary-candle Totals regressions | Preserve failed/empty-current variants and real source observations |
| Rollover, reconnect, revisions, no double application | Existing unit suites; real default rollover; bounded canonical references | Late-input source-version repair deployed on 7256fd4; independent busy-hour reference passes; broader rollover/reconnect audit remains |
| Separate live/history state and scoped recovery | Client/status tests, failed Totals browser regression, in-flight Retry regression, real failed-current probes | New staging recovery and healthy-feed continuity validation |
| Independent exact bounded execution preparation | 252,017-execution restart/dedup test; independent real 333,999-execution/52-cell reference; no depth dependency test | Record final deployed identity and remaining cold-build limits |
| Fair execution jobs and recoverable failures | Separate workers, bounded pages/queues, explicit resume tests and real worker restart | Current preparation SQL lane change needs source-continuity measurements |
| Small default set through rollover | Both markets, 5m/$25 and 1h/$25 real 11:00 UTC rollover artifact | All four defaults recovered through bounded maintenance on 95017a0, then current/latest-closed version checks passed; boundary publication delay still requires measurement |
| Reserved current capacity and cancellation through path | Split tunnel/agents, gateway reservation, shared SQL admission tests, runtime interruptible-query cancellation | Ten runs captured, no collector errors; confirmation gaps worsen, gate not certified; controlled matched-background comparison remains |
| Client CPU bounded and obsolete work cancelled | Scheduler holds body/decode, yield/cancellation and consumer tests | Native history bulk import verified against the old per-bar path on Pi; startup CPU/long tasks and repeated-use resource analysis remain open |
| Incremental walls, stable identity/runs, bounded queues | Archive service/projector tests and diagnostics; bounded real legacy/display reference | Closed-reference getter regressions and 1,000 hidden updates now pass; actual retained heap/frame plateau remains open; one exact full 30h USD-M browser observation is supplemental |
| Batched exact versioned wall delivery, carry-in/watermark | Display API, timestamp closure/carry-in tests, canonical SQL reference five pairs per market | V5 exact 30h source validation/discovery and actual client part delivery implemented; all 66 USD-M pages match a fresh real canonical reference. Selected projection preserves all 23,850 walls / 104,112 points in five batches. Latest five Spot loads have exact full painted coverage but FAIL latency; USD-M has complete painted counts in five and final validation in four, still FAIL. Automatic serving preparation, disk retention, sliding reuse and warm validation remain open |
| Avoid repeated metadata and oversized SQL reads | Metadata cache and key-first FINAL query; real read-byte comparisons | Pinned route probe and end-to-end attribution; no schema changes |
| Exact profiles and incumbent settings | Existing Top Levels/Threshold/Fit/persistence suites | Latest frontend 1,114 pass / 2 skip, typecheck and staging build pass; all 11 footprint/history lifecycle browser checks pass. Backend guarded 273 pass. Never replace gaps with continuous walls |
| Actual flags/build/routes/viewport and correlated timing | Worker/request diagnostics, raw samples, main-thread paint marks, source/build records | Final build IDs, pinned identical loopback/SSH/Vite samples, evidence index |
| Five comparable prepared empty-cache loading runs | Older cohorts plus latest five samples each for current, 4h/5m and 24h/1h retained | November 7 b47457b 4h/5m and 24h/1h series PASS with all 48/24 slots painted in all ten samples; current footprint and both 30h wall scenarios still FAIL |
| Warm useful display <=1s then independent validation | One exploratory 24h footprint revisit (260.7ms useful, 1,526.2ms validation) | Five comparable footprint samples and actual wall warm-revisit evidence |
| Repeated-use plateau and real interaction timing | Retention/worker-heap probe implemented; unit retention checks | 36 correctly ranged prefix cycles release all resources, late heaps bounded; full 30h retention still unverified |
| Operational retry/rollback and collector continuity | Guarded staging rollout, exact unchanged collector IDs, rollback records, documented retry tools | Six-service rollback repair verified without execution; retain exact image/topology records and finish final source-continuity evidence |
| Independently reviewable commits, no production/main merge | Isolated `perf/pi-history-r1` branches; backend pushed; original dirty checkouts preserved | Frontend source through saved-wall restore and strict painted gates committed; complete final serving/evidence/release ledger |

## Gate policy

Keep all proposed thresholds and ranges. Report every loading sample, median
and maximum; no p95 from five samples. Full available coverage must account for
every eligible slot/interval, including explicitly covered empty regions and
source gaps. Current wall visibility failures remain failures even if a
supplemental Fit Walls measurement succeeds. A long coverage observation can
prove coverage but cannot turn a failed 10-second latency gate into a pass.

Performance acceptance remains incomplete. Source absence, actual cold builds,
ready server / empty browser cache, warm revisits, development overhead and
normal headed Pi rendering must remain distinct in the final report.


The November 6 prepared-view cohort uses frontend `4cbc827` and backend `fa7807a`.
All five actual Pi environments were verified and all five 30h loads failed to
complete within 12 seconds. The complete prepared snapshot remains available;
partial chart prefixes are not accepted coverage. See `nov6-wall-v5-gates.json`
and the evidence ledger for every sample. Latest frontend full suite: 1057 pass,
2 skip, 2 vault timing failures; history-focused 55 pass and two headed Retry UI
checks pass. These are distinct validation results, not an all-green release.


Latest wall-delivery increment: backend `18a68da` / served frontend `c467e57`.
Version 2 reduces the exact snapshot from 66 part requests to 18 bounded requests,
and all 66 hashes pass actual Chromium verification. Progressive members, truncated
tail retention, shared cancellation and immediate retry are covered by 68 focused
tests; latest full frontend 1069 pass / 2 skip, backend 237 pass. Browser lifecycle
coverage is 11 passing checks plus 2 passing scoped Retry rechecks after repairing
a simulated-source auto-recovery race. This is not one all-green 12-test run.

All five final Pi samples have verified environments and finalized traces, but
none completes 30h history within 12s. First-history paints are 8955.4,null,null,7225.3,
null ms. Both loading gates FAIL; no completion median/max/p95 is invented.
Every renderer diagnostic is canvas2d in normal headed Chromium. See
`nov6-wall-progressive-final-gates.json` and the current release ledger. Prepared
Spot 30h, automatic scheduling/retention and sliding reuse, warm/current-concurrency
and full-view memory/frame gates remain open. Earlier footprint latency failures
remain unaccepted. Keep the original scope and failed source/transport evidence.

Selected-wall preparation increment: frontend exact projector `47bd469`, backend
core `103da19` and bounded producer `ce0a208`. All 66 real canonical pages preserve
23,850 original segments / 104,112 actual points through checkpoint/closed transfer
and final public import. Producer full suite 243 pass; frontend functional
bootstrap/Retry browser checks 10 pass. The final public manifest is 383,167 bytes
and closed gzip records 3,004,574 bytes; this is stored-file correctness/size
proof on x64 staging, not a Pi loading gate. Actual gateway/client projection
transfer remains unimplemented. Serving staging stays 18a68da. Existing failed
performance gates and all previously open acceptance requirements remain open.

Latest serving/client: 18579d9 / fb11b9c. Capability negotiation fixes the actual
128 KiB metadata failure and preserves older clients. Latest comparable five-run
Pi loading series still FAILS: first paint [10594.3,null,null,null,null] ms; complete
all null. A separate recovered-history-SSH observation proves every requested
available 30h wall interval/record is imported: 23,850 walls / 104,112 points,
47 explicit canonical gaps, complete at 143.524s. This is supplemental coverage,
not a latency pass. Current SSH PID/collector identities were retained during
recovery of the task-owned history lane. Exact large-packet route diagnostics and
long render frames identify further work; no broader acceptance is claimed.

Client acdf09c native-path rendering has exact real-data pixel/reference proof,
not loading acceptance. Its actual Pi five-run first-history series is
[8389.2,null,null,9240.6,null]ms; all completions null. Both loading gates FAIL.
The supplemental 180s observation fails with HTTP 408 after first paint at
24.820s; full new-client path coverage is not proven. Headless fixture functional
checks pass nine tests. Earlier full-suite vault timeout/scoped pass remains
explicit. All original open gates, Spot preparation, scheduling/retention,
current/concurrent, warm and repeated-use requirements remain open.


November 7 current evidence: backend preparation CLI 74837d7 (247 tests/type/build
pass), serving 18579d9, measured client 7a1f6b1 (1,093 pass/two skip plus scoped
browser protocol evidence). Spot 30h server preparation/publication and independent
canonical/original-projector references now PASS for 8,293 walls / 49,154 points /
35 gaps. Requested-versus-rendered Pi coverage still FAILS: five first-paint values
[null,9591.6,null,null,null]ms, all completions null; supplemental 180s discovery
HTTP 502 with no history painted. Preserve the full viewport and every sample.
The exact source-resume comparison removes three queries and about 237MB read
bytes without changing its next page; regressed horizons cannot publish. This
provides no automatic fair wall scheduling, sliding reuse or disk retention.
All earlier failed latency/current/warm/repeated-use gates and unverified items
remain open. Do not infer full Spot browser coverage from server reference proofs.


Coordinator a6c5787 has 258 passing backend tests/type/build and supplemental
isolated staging proof: cold Spot resumes six-page progress through all 34+34
parts; default USD-M reuses complete cache in two turns. Both financial hashes
match independent original-projector references, with source gaps intact. Five
loopback current baselines and 34 during-build reads stay ready/live with no
HTTP errors; this is server capacity evidence only. Completed-queue reopen
changes neither queue metadata nor step logs. Serving/collectors stay unchanged.
It does not complete serving-triggered admission, moving-window composition,
leases/cancellation, global cache accounting/retention or any failed/unproven
Pi loading/current/warm/repeated-use gate. Standalone-CLI pin migration remains
open. Preserve the full original scope.

Retry increment bba1e67: 260 backend tests/type/build pass; both added regressions
fail on 5dd8b93. Real isolated staging Retry reuses all 66+66 USD-M parts without
private canonical progress, repinning or changing 134 immutable files. Stable
command replay after restart performs zero steps and preserves queue/log hashes.
Full pending capacity rejects ready-job Retry without damaging the receipt.
Evidence e1921d9 retains six validation queries reading 703,103,126 bytes: this
remaining cost is explicit. Server cache recovery is verified; serving admission,
rolling reuse, cancellation/leases, derived retention and every failed/unproven
Pi gate remain incomplete. Serving and collectors have not changed.

Admission bridge b7855e4 / 00f11e0 is implemented but disabled: independent bounded
loopback admission, leased cancellation/expiry, restart/resume, explicit Retry,
capacity and metadata-only build polling have 26 focused / 273 full backend tests
plus type/build passing. Local loopback protocol tests are not genuine staging or
chart validation. Frontend polling/status/Retry/cancellation wiring, real persistent
worker and serving validation remain outstanding. Rolling/default reuse, retention
and all existing failed/unproven Pi gates remain incomplete; the full objective
has not been reduced to these component proofs.

Client 9febaff / 997e383 wires admission polling, job identity, scoped release,
separate build/source versus loaded coverage status, specific failures and stable
Retry/revision commands. Final 75 focused / 1,104 full tests pass, two full skips,
typecheck/build pass. Old versions fail four flow tests and the separate revision
escalation test. A headed workspace-9 Chromium fixture verifies actual browser
fetch/abort/header/slot behavior; it renders no chart and uses no retained source.
These supersede the frontend-wiring TODO above, not real staging/financial/chart
acceptance. Persistent worker/gateway validation, rolling/default reuse, cold first
progressive content, retention and all prior failed/unproven Pi gates remain open.

Retained-source isolated backend 0ccfa7a now validates real consumer sharing,
last-release pause at three pages, worker restart, same-proof resume and actual
client import of all 34+34 Spot parts. All 8,293 walls / 49,154 runs / 35 gaps match
the original reference. This supersedes the isolated process/protocol TODO, not
serving rollout or real-chart/Pi acceptance. Raw evidence is backend 9bb4d7b.

It also reproduces an unnecessary fallback when a completed build watermark is
newer than the captured bootstrap but all financial inputs fit the older fence.
ae8e42a requires matching independent max-input/carry-in proofs and bounded page/
row cursors before rebinding transport metadata. Real before fails; after imports
the same complete data and original selected state while retaining the old cursor.
81 focused / 1,110 full client tests pass, two skips, type/build pass. Late/unproven
inputs still refuse reuse. Current samples stay ready/live only through incumbent
18780: this is shared-server/SQL evidence, not same-gateway/Pi confirmation proof.
Serving remains unchanged/disabled. Rolling/default reuse, retention and all prior
failed/unproven Pi loading/current/warm/resource gates remain incomplete.


November 7 saved-wall startup c0a1c13 / b47457b removes offscreen current/recent
requests for restored historical wall charts. Real browser fails before both
fixes and passes after; all 11 lifecycle checks pass, full frontend 1,114 pass /
two skips, typecheck/build pass. Strict reference-count/paint-revision gates
526642c replace completion-flag-only wall acceptance.

Fresh normal headed Pi, empty-browser-cache / already-prepared source cohorts:
4h/5m footprints PASS (all 48 slots in five runs; median/max 2,876.2/3,638ms),
24h/1h footprints PASS (all 24 slots in five runs; 3,608.7/4,607.8ms). These do
not erase earlier failed cohorts or prove cold preparation/current concurrency.
Spot 30h has exact complete painted/validated reference in all five runs
(8,293 walls / 49,154 points / 35 gaps), but FAIL latency: median/max
6,661.4/9,054ms and one first-history result exceeds 3s. USD-M 30h reaches
all reference counts in five runs, with only four final validations inside 12s;
FAIL latency/complete coverage within the observation bound. No early completion
or missing derived-source excuse is used.

Current gates remain FAIL: corrected footprint observation [null, null, 5544.6,
4772.4, 3596.1]ms; all five current-wall observations lack visible current
paint. The older footprint-current cohort stopped one sample prematurely; it is
retained as invalid and replaced by a distinct corrected cohort, never discarded.
ffb6e7c fixes the harness stopping condition, without rebuilding client finance.
Serving remains 18579d9 with bridge disabled; unchanged collectors reverified.
Rolling/default preparation, managed retention, warm full-wall reuse, current
visibility/freshness/concurrency, route comparisons and repeated-use resource
gates remain incomplete. See the full measurement report and raw cohort files.

Reader lifetime increment 3fc2cd4 / 9c5fe1f and backend b963ddf / 890ca89 protects
both immutable roots through transfer/final validation, with bounded independent
control admission and consumer-specific cancellation. Actual retained-source HTTP
proof spans a deliberate 16s delay and remains exactly equal to the original
8,293-wall / 49,154-point reference; final leases/requests/ports are released.
An offline headed Pi/workspace-9 browser checks two occupied data slots and
independent peer recovery. Neither proves an active GC or a Pi loading gate.

Latest validation: 279 backend tests pass; frontend 95 focused history tests,
typecheck/build pass. Full frontend run retains one vault timeout (1,118 pass,
two skips); eight focused vault tests pass. Browser batch retains one saved-view
startup timeout / ten passes; the focused saved-view rerun passes unchanged.
The fixture event-order failure and its correction are retained. No all-green
claim replaces those individual results. Serving is still unchanged/disabled;
legacy-reader protection, retirement/restart barriers, bounded eviction, rolling
reuse and final performance/resource gates remain required.

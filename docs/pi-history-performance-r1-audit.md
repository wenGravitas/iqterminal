# Initial Pi history release: completion audit

This audit preserves the full requested scope. A fixture pass, worker health,
loaded prefix or completed HTTP response cannot certify full chart coverage or
interactive performance. See [the measurement report](pi-history-performance-r1.md).

| Requirement | Current evidence | Remaining release work |
|---|---|---|
| Correct past viewport before alignment; four hours per request | `footprintPastViewport`, prepared/staging tests, five real 48-bar and five real 24-bar samples in `nov5-e13-7aa-samples.jsonl` | Actual-source five-closed-plus-forming reproduction now passes; retain final dark-theme artifact and later latency series |
| All chunks accounted for; partial/empty/gapped/failed states | Prepared footprint tests and per-slot progress in raw samples | Final coverage audit must not substitute `requestComplete` alone |
| History independent of current bootstrap and footprint autofocus | Browser delayed bootstrap and ordinary-candle Totals regressions | Preserve failed/empty-current variants and real source observations |
| Rollover, reconnect, revisions, no double application | Existing unit suites; real default rollover; bounded canonical references | Final suite/browser run on latest code; assess new bounded-tail behavior |
| Separate live/history state and scoped recovery | Client/status tests, failed Totals browser regression, in-flight Retry regression, real failed-current probes | New staging recovery and healthy-feed continuity validation |
| Independent exact bounded execution preparation | 252,017-execution restart/dedup test; independent real 333,999-execution/52-cell reference; no depth dependency test | Record final deployed identity and remaining cold-build limits |
| Fair execution jobs and recoverable failures | Separate workers, bounded pages/queues, explicit resume tests and real worker restart | Current preparation SQL lane change needs source-continuity measurements |
| Small default set through rollover | Both markets, 5m/$25 and 1h/$25 real 11:00 UTC rollover artifact | All four defaults passed the bounded readiness/retry probe on 34d7939; repeat before any later ready-current series |
| Reserved current capacity and cancellation through path | Split tunnel/agents, gateway reservation, shared SQL admission tests, runtime interruptible-query cancellation | Ten runs captured, no collector errors; confirmation gaps worsen, gate not certified; controlled matched-background comparison remains |
| Client CPU bounded and obsolete work cancelled | Scheduler holds body/decode, yield/cancellation and consumer tests | Actual long tasks/frame observations and repeated-use resource analysis |
| Incremental walls, stable identity/runs, bounded queues | Archive service/projector tests and diagnostics; bounded real legacy/display reference | Repeated current-only changes and retained heap/queue plateau evidence |
| Batched exact versioned wall delivery, carry-in/watermark | Display API, timestamp closure/carry-in tests, canonical SQL reference five pairs per market | Complete real 30h coverage, boundary/revision reuse and warm revisit measurements |
| Avoid repeated metadata and oversized SQL reads | Metadata cache and key-first FINAL query; real read-byte comparisons | Pinned route probe and end-to-end attribution; no schema changes |
| Exact profiles and incumbent settings | Existing Top Levels/Threshold/Fit/persistence suites | Full frontend 1020 pass / 2 skip and backend 186 pass; remaining real-chart checks; never replace gaps with continuous walls |
| Actual flags/build/routes/viewport and correlated timing | Worker/request diagnostics, raw samples, main-thread paint marks, source/build records | Final build IDs, pinned identical loopback/SSH/Vite samples, evidence index |
| Five comparable prepared empty-cache loading runs | Two older complete series and latest 30-run series retained | Latest series fails all performance scenarios; recovered-current series must be separate |
| Warm useful display <=1s then independent validation | One exploratory 24h footprint revisit (260.7ms useful, 1,526.2ms validation) | Five comparable footprint samples and actual wall warm-revisit evidence |
| Repeated-use plateau and real interaction timing | Retention/worker-heap probe implemented; unit retention checks | Validate probe; run actual load/pan/close cycles and inspect every sample |
| Operational retry/rollback and collector continuity | Guarded staging rollout, exact unchanged collector IDs, rollback records, documented retry tools | Include latest deployment records and source continuity in final evidence |
| Independently reviewable commits, no production/main merge | Isolated `perf/pi-history-r1` branches; backend pushed; original dirty checkouts preserved | Push remaining frontend commits and complete final evidence/release ledger |

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

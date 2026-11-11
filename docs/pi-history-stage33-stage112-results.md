# Pi staging performance: 33c7e3a / 112bf11

Release acceptance is **INCOMPLETE**. Prepared footprint history passes the two
specified full-view latency gates on the Pi/client route; both wall gates and
current footprint startup fail. Headless results do not certify normal foreground
Chromium. No production deployment or main merge occurred.

## Root causes and implemented changes

- Future viewport whitespace consumed the historical request bound. Eligible past
  coverage is computed first and split into bounded chunks, nearest useful history
  first. Four hours bounds one request, not total chart coverage. Multi-chunk
  validation and known-empty coverage determine completion independently of live
  bootstrap. Historical replacements remain separate from the live accumulator.
- Wall discovery performed a horizon read and another discovery in sequence.
  Backend112bf11 resolves eligibility in discovery and preserves the left bound;
  frontend9a526dc polls the pinned effective request. Each new measured wall view
  uses one discovery, zero separate horizon reads and one final independent source
  validation. Partial Retry retains the same eligible view. Older gateways retain
  the tested fallback. All financial validation and source-proof checks remain.
- Unsupervised manually launched SSH lanes both exited255 during the initial
  five-run cohort. The failure is preserved below. The established split tunnel
  script now supports explicit private staging port mapping, independent reconnect
  supervisors and IPQoS=none. Recovered cohorts use separate current/history TCP
  lanes. This does not isolate IPQoS as the cause of recovery.
- Growing private projection-index work is bounded by the V3 implementation.
  Worker33c7e3a is installed against a checksummed clone only; its private queue
  has advanced toV3. Rollback copies are charged against the unchanged2GiB derived
  budget with a600MiB reservation;160MiB transient headroom and20GiB disk floor
  remain. The original protocol1 root remains untouched.

## Exact measured environment

Frontend9a526dcbe5495405205b10da78c4328a6e3d6831 after the combined-flow change;
frontendce036e7a8c2e7222735916e0d7e4092b5e92108f before it. Both are production
builds with VITE_DATA_MODE=staging, VITE_HISTORY_TILES=1 and VITE_DIAGNOSTICS=1.
The diagnostic preview is loopback4194 (before4193), through split18880/18881
SSH lanes to the isolated remote gateway18880. The protected API remains18780.

Gateway112bf11cadd4f521b4b65363baf52756ecd47457, container
0f5250279212a08a3867eeed0b571d59c4722c624db174d8ebbcfa444ef655c1;
worker33c7e3a25105fdb15e28ab029765418aac08b2e8, container
246c527d7ce8aa1827445b229cab03ca97329989f295c5e9fcf15fb0d144dca6.
Before the gateway change, the same worker served gateway33c7e3a, container
5b3d983a00547c4efced88ae35deb35f68d6b572fdac0f959578466b1cb1a77a.

Actual Pi headless Chromium155.0.8059.79 uses ANGLE Broadcom V3D7.1.7.0 /
Mesa24.2.8. Charts use Canvas2D; this is not proof that each draw is accelerated.
UA architecture is not host architecture: consult client-host.json. Browser,
resource, request and build receipts are under
[staging-candidate-r1](../artifacts/pi-history-r1/staging-candidate-r1/).
No headed browser was launched in these cohorts.

## Every loading sample

Times are seconds from navigation to observed painted content. A dash is an
unobserved result, not zero, and censored cohorts have no completion median.
Five samples do not support a p95 estimate. All ranges and thresholds are unchanged.

| Cohort | Measurement | Samples 1–5 (s) | Median (s) | Maximum (s) |
| --- | --- | --- | --- | --- |
| stage33-footprint24-five | firstCurrentMs | —, —, —, —, — | — | — |
| stage33-footprint24-five | firstHistoryMs | —, —, —, —, — | — | — |
| stage33-footprint24-five | completeMs | —, —, —, —, — | — | — |
| stage33-footprint24-supervised | firstCurrentMs | 8.149, 3.913, 3.982, 2.538, 2.976 | 3.913 | 8.149 |
| stage33-footprint24-supervised | firstHistoryMs | 8.149, 3.913, 3.982, 2.538, 2.976 | 3.913 | 8.149 |
| stage33-footprint24-supervised | completeMs | 8.149, 4.216, 3.982, 2.674, 3.351 | 3.982 | 8.149 |
| stage33-footprint4-supervised | firstCurrentMs | —, —, —, —, — | — | — |
| stage33-footprint4-supervised | firstHistoryMs | 2.243, 2.666, 2.341, 2.314, 3.347 | 2.341 | 3.347 |
| stage33-footprint4-supervised | completeMs | 2.243, 2.666, 2.342, 2.314, 3.347 | 2.342 | 3.347 |
| stage33-current-footprint-supervised | firstCurrentMs | 3.413, 3.339, 3.284, 2.902, 4.313 | 3.339 | 4.313 |
| stage33-current-footprint-supervised | firstHistoryMs | 3.413, 3.339, 3.284, 2.902, 4.313 | 3.339 | 4.313 |
| stage33-current-footprint-supervised | completeMs | 3.413, 3.339, 3.284, 2.903, 4.313 | 3.339 | 4.313 |
| stage33-spot-supervised | firstCurrentMs | —, —, —, —, — | — | — |
| stage33-spot-supervised | firstHistoryMs | 3.963, 4.460, 3.749, 4.544, 3.660 | 3.963 | 4.544 |
| stage33-spot-supervised | completeMs | 7.494, 7.320, 6.986, 8.814, 7.300 | 7.320 | 8.814 |
| stage33-perp-supervised | firstCurrentMs | —, —, —, —, — | — | — |
| stage33-perp-supervised | firstHistoryMs | 4.059, 4.525, 6.735, 3.391, 3.362 | 4.059 | 6.735 |
| stage33-perp-supervised | completeMs | —, —, —, 9.685, 9.905 | — | — |
| stage112-spot-combined | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-spot-combined | firstHistoryMs | 4.700, 4.309, 3.169, 3.658, 4.270 | 4.270 | 4.700 |
| stage112-spot-combined | completeMs | 9.648, 6.360, 5.144, 5.639, 5.375 | 5.639 | 9.648 |
| stage112-perp-combined | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-perp-combined | firstHistoryMs | 3.629, 4.334, 4.024, 2.989, 3.976 | 3.976 | 4.334 |
| stage112-perp-combined | completeMs | 11.851, 11.619, 11.664, 10.132, 10.089 | 11.619 | 11.851 |
| stage112-footprint24-final | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-footprint24-final | firstHistoryMs | 4.280, 4.630, 3.111, 3.691, 3.178 | 3.691 | 4.630 |
| stage112-footprint24-final | completeMs | 4.638, 4.630, 3.254, 3.691, 3.644 | 3.691 | 4.638 |
| stage112-footprint4-final | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-footprint4-final | firstHistoryMs | 3.495, 3.129, 3.285, 3.998, 3.863 | 3.495 | 3.998 |
| stage112-footprint4-final | completeMs | 3.496, 3.129, 3.285, 3.998, 3.863 | 3.496 | 3.998 |
| stage112-future-space-final | firstCurrentMs | 4.296, 3.124, 3.766, 3.404, 3.262 | 3.404 | 4.296 |
| stage112-future-space-final | firstHistoryMs | 4.296, 3.124, 3.766, 3.404, 3.262 | 3.404 | 4.296 |
| stage112-future-space-final | completeMs | 4.296, 3.125, 3.766, 3.404, 3.262 | 3.404 | 4.296 |
| stage112-spot-footprint-regression | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-spot-footprint-regression | firstHistoryMs | 3.895, 3.666, 3.223, 4.119, 3.063 | 3.666 | 4.119 |
| stage112-spot-footprint-regression | completeMs | 3.904, 3.667, 3.224, 4.120, 3.063 | 3.667 | 4.120 |
| stage112-current-walls-final | firstCurrentMs | —, —, —, —, — | — | — |
| stage112-current-walls-final | firstHistoryMs | —, —, —, —, — | — | — |
| stage112-current-walls-final | completeMs | —, —, —, —, — | — | — |

The first five stage33-footprint24-five samples are route failures (HTTP502 /
ECONNREFUSED after SSH exited), not missing source or a passing latency cohort.
The corrected supervised cohorts are reported separately.

## Coverage and correctness

Latest prepared24h/1h footprint runs paint all24 eligible closed slots;4h/5m
runs paint all48. Spot4h/5m regression also paints all48. Independent raw FINAL
execution-cursor comparisons on bounded real bars match chart and prepared data
exactly: USD-M hourly26837 executions/16 cells, USD-M5m1457/3 and Spot5m1064/3.
These bounded comparisons are not an independent raw reconstruction of every bar.

The future-whitespace chart requests03:00–11:00 UTC on11November while the
closed boundary is08:00. All five runs paint03:00–08:00 closed history and the
independent08:00 forming candle. The wire requests07:00–08:00 first and then
03:00–07:00. No future candle is invented. This is the live-clock equivalent of
now16:19 / viewport11:00–19:00; deterministic regressions exercise that exact case.

Pinned wall visible windows are Spot10November01:10–11November07:10 UTC and
USD-M10November01:00–11November07:00, each30h. Canonical source windows include
one candle context at each side. Spot retains4507 segments/35149 value runs/13
gaps; USD-M23886/90254/1. All five after-change runs finish with exact expected
counts, no pending geometry and matching input/painted revisions. Before-change
USD-M has three incomplete12s observations, so no percentage latency reduction is
claimed. Full-field canonical folds and independent before/after source proofs
are in reference.jsonl. Canonical source queries retain FINAL.

Source gaps remain explicit. Coverage means all eligible available requested
intervals are accounted for; it does not assert continuous observed exchange depth.
These pinned past views do not prove that ordinary current-ending default views
match prepared windows. The one-candle left-bound mismatch and exact prefix reuse
remain unresolved.

Current-wall observations all received16 selected levels with live status,
no pending geometry and matched painted revisions. Zero selected levels were
inside the price viewport (73605.0125–74217.8875); selection spans68000–78384.
Those runs are unqualified for current-wall visible-paint latency. They do not
establish a current feed failure or a passing latency gate. No profile selection
or price range was changed to make the test pass.

Fresh V3 default rollover products also match complete canonical folds and
independent source proofs: Spot4237 segments/33792 runs and USD-M22178/88720.
These later windows differ from loading cohorts; see rollover-reference.jsonl.
This proves functional rollover, not cold materialization timing or default
current-ending range matching.

## Remaining costs and gates

Spot complete median improves7.320s→5.640s but misses5s. Its first useful history
median worsens3.963s→4.270s; do not describe the change as uniformly faster.
USD-M completes all five after-change observations but median11.619s and
maximum11.851s fail5s/10s. Both first-history3s gates fail. API encoded caches
were not equally cold in the before/after cohorts, limiting causal attribution.

A separate sampled run identifies main-thread GC~0.85s and worker GC~1.05s,
with substantial point-transport decode, checkpoint validation and transfer work.
These are sampled thread costs, not additive exclusive navigation phases. The
profiled sample is supplemental and excluded from release acceptance. The existing
canonical versus compact transport is being compared with unchanged snapshot
hashes and final source proof; experiment results cannot certify release gates.

| Requirement | Current result |
| --- | --- |
| Prepared24h/1h footprint, median≤5s/max≤10s | PASS, five runs |
| Prepared4h/5m footprint, median≤5s/max≤10s | PASS, five runs |
| Future whitespace/full eligible history + independent forming bar | PASS, five runs |
| Prepared30h Spot default walls | FAIL completion median and first history |
| Prepared30h USD-M default walls | FAIL completion median/max and first history |
| Current footprint median≤2s/max≤3s | FAIL |
| Qualified current-wall visible paint | UNVERIFIED |
| Warm revisit useful≤1s plus revision validation | OPEN |
| Two histories + custom profile vs current-only baseline | OPEN |
| Repeated pan/switch/open/close memory/request plateau | OPEN |
| Foreground normal Chromium on Pi | OPEN; headless only |
| Default rollover exact financial result | PASS functional; latency OPEN |
| True missing-derived builds, throughput/restart and resource gates | INCOMPLETE; separate evidence required |

The busy333999-execution footprint builds exactly through bounded resume, but
previous cold-build evidence includes~41.8s and32.8M DB read amplification.
This is a remaining cold-build limitation, not prepared-cache latency.

## Operations and release state

History Retry must retain good bars and live connections, resume only the failed
job/view and clear recovered errors. Polling is not a build-reset mechanism.
Do not reconnect healthy sockets or clear acknowledged cursors to retry history.

API-only rollback stops the exact112bf11 gateway gracefully and restarts the
stopped33c7e3a gateway against the same compatible V3 clone. Full rollback must
stop the owned112bf11 gateway and33c7e3a worker, verify released lock/leases, then
restart the original71f62d2 gateway and13730f7 worker against the untouched
original protocol1 root. Never start the old worker against the V3 clone.
Protected collector/materializer/API identities must be checked before and after.
See the backend guarded clone tool and deployment receipts for exact IDs, roots,
checksums, budget, source health and failure rollback sequence.

Source, benchmark/report changes and curated evidence are committed on
perf/pi-history-r1 in both repositories. SHA256SUMS authenticates the retained
raw files; no claim of release readiness follows from source tests or these
partial passing performance gates.

## Follow-up: transport and progressive validation

Both existing transports were tested with identical discovery interception and
one later pinned30h USD-M snapshot (22178 segments/88720 runs/1 gap). Product
completion samples are [unobserved,10.445,8.601,10.046,8.894] seconds; canonical
samples are [8.868,8.009,8.118,8.749,unobserved]. Each arm has an incomplete12s
observation, so neither has a complete-cohort median. No default transport change
is justified. These intercepted cohorts are supplemental, with all raw traces
retained in transport-comparison.json and the parent sample files.

Frontend691e68e adds validation-only progressive import. Previously each active
manifest and completed group was validated, cloned into a mutable projector and
sorted into a retention queue, then discarded. The new API drives the identical
validator without those temporary clones/queues. The final union still receives
full validation and one mutable restore. Source-equivalence checks prove every
pre-existing line of the financial core is unchanged; full source hashes remain
pinned separately from the compatible prepared identity. Backend8f70be5 carries
the same additive API but the deployed worker/gateway remain33c7e3a/112bf11.

The focused40 checks, full frontend1332 tests (two skipped), backend374 tests,
typecheck and production builds pass. The same-snapshot five-run product-transport cohort completes in
[9.767,9.737,10.441,10.859,10.218] seconds: median10.218s/max10.859s. All five
financial counts/source proofs and painted revisions validate, but the latency
gate remains failed. This demonstrates complete delivery, not a navigation-time
speed improvement. The original product cohort has a censored observation, so no
complete-cohort before/after median percentage is reported.

Representative real-chart screenshots:

- [Five closed hourly bars and the forming bar](../artifacts/pi-history-r1/stage112-future-space-final-footprint-future-space-1h-1.png).
- [24h hourly footprints](../artifacts/pi-history-r1/stage112-footprint24-final-footprint-24h-1h-1.png).
- [4h five-minute footprints](../artifacts/pi-history-r1/stage112-footprint4-final-footprint-4h-5m-1.png).
- [30h USD-M walls](../artifacts/pi-history-r1/stage112-perp-combined-walls-30h-perp-15m-5.png).

Postflight confirms all eight protected IDs/start times unchanged, source execution
and depth collectors live, history backlog empty and no source overflows observed.
The original1209 file checksums still match. All four wall roots total801215959
bytes, within the existing budget including headroom; the inactive copies remain
inside the600MiB reservation. Test consumers/readers/pins are all zero. The queue
isV3, with19 ready jobs and three retained failed `source-changed` visible-tail
requests from the earlier current-wall cohort. These failures are explicit and
require a new source revision; no healthy job was reset and no abandoned view was
retried to hide its failure. See postflight-job-audit.json. Functional default
preparation continues; these failed tail jobs do not certify current-ending
prepared reuse or recovery acceptance.

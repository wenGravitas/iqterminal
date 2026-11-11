# Warm wall reuse: Pi results and remaining gates

The release remains **INCOMPLETE**. Frontend168918c releases the completed
prepared mutable projector after its full financial proof; frontenda147714 reuses
an identical authenticated warm manifest before downloading projection parts.
Neither change modifies the financial kernel, limits, source retention, current
collector connections, native/Threshold/Fit Walls settings or production.

The new fast path passes1335 frontend tests (two skipped),88 focused checks,
typecheck and production build. Independent before/after canonical source proofs
and a full canonical fold match the new pinned projection:21261 segments,
87018 value runs and one explicit depth gap. These are exact retained local-book
records; no unobserved exchange depth or continuous wall is inferred across gaps.

## Actual cohort and every cycle

Production diagnostics build a1477141622eb428b50fa2e65a0c32b15c5e76fc, loopback4197,
VITE_DATA_MODE=staging, VITE_HISTORY_TILES=1, VITE_DIAGNOSTICS=1. The isolated
staging gateway remains112bf11 and worker33c7e3a; exact IDs and eight protected
service identities/start times are in postflight.json. No backend serving change
was required. All browsers are headless on the actual Pi; browser/GPU receipts
are retained. No normal foreground Chromium UX or60fps claim follows.

Visible interval: **2026-11-10T03:30:00+00:00 to 2026-11-11T09:30:00+00:00**, full30h.
Source context: **2026-11-10T03:15:00+00:00 to 2026-11-11T09:45:00+00:00**.
The older pinned view was retired normally; its failed lease preflight is retained.
A newer already-ready view was selected, independently checked and pinned before
this cohort. It is a separate source window, so old/new latency percentages are
not reported. `fresh-reference.jsonl` records the full-fold comparison and source
proofs. The canonical FINAL/dedup behavior remains unchanged.

One persistent page/worker, one initial view and eight close/reopen cycles, with
**no forced GC or owner enumeration** in this cohort. Timings are actual painted
content observations in the browser's monotonic clock. The loop waits for
independent validation and cache settling before heap metadata; that waiting is
not an earlier paint and does not change the12s loading target. Initial observation
and per-stage waits are diagnostic bounds, not a replacement loading gate.

| Cycle | First useful history (s) | Complete painted view (s) | Projection batch requests | Fresh source responses | Cached manifest reused |
| --- | --- | --- | --- | --- | --- |
| 0 | — | — | 0 | 0 | False |
| 1 | 9.832 | — | 4 | 1 | False |
| 2 | 3.943 | 12.107 | 4 | 1 | False |
| 3 | 1.958 | 8.106 | 0 | 1 | True |
| 4 | 1.696 | 9.733 | 0 | 1 | True |
| 5 | 3.080 | 6.195 | 0 | 1 | True |
| 6 | 0.528 | 6.181 | 0 | 1 | True |
| 7 | 0.289 | 4.166 | 0 | 1 | True |
| 8 | 0.398 | 6.030 | 0 | 1 | True |

Cycles0–2 are retained, including the initial stall and unseeded reopen. Cache
eligibility is derived from the preceding close's actual cache admission, rather
than selected from fast timings. The six genuinely cached revisits (cycles3–8)
have first-useful samples **[1.958,1.696,3.080,0.528,0.289,0.398]s**, median1.112s,
maximum3.080s. **The warm useful≤1s gate FAILS.** No p95 is inferred from these
loading samples. All six use zero projection batches and each performs a fresh
source validation; no entire-history decoder or mutable projector is needed for
those matches. Complete painted/validated times remain4.166–9.733s.

Each settled visible view retains the full21261 segments/87018 runs, with matched
input/painted revisions and no pending geometry/reference queues. The captured
helper enumerates all120 native candle slots. The report was subsequently
strengthened to require saved raw native timestamps before certifying any pass;
this cohort does not acquire a passing gate from aggregate flags. Raw timings
already contradict the warm target independently of that evidence limitation.

Some worker `response.finished()` traces remain pending even after parsed
responses. Transfer sizes are actual only where `request.sizes()` succeeded;
Content-Length elsewhere is an advertised size. The first discovery returned
HTTP200 headers, but no history painted within observation. Do not label that
missing raw source or successful loading. Header/DB timings, canceled/unconfirmed
requests and resource samples are retained for route diagnosis. No cross-host
clock subtraction or addition of overlapping phase durations is used.

## Retention observations and limits

Before early reuse, same-window controlled-GC diagnostic runs showed one registered
historical projector versus zero after release, with identical financial data.
The initial worker-heap observations were42.51MiB and24.68MiB respectively, one
sample each. Warm reopen heaps remained larger and sometimes retained a full
projector outside the registered list. Those older captures lacked active-job
metadata and had two history admissions per reopen, so they cannot prove a
quiescent leak or memory plateau. They are not natural-GC latency acceptance.

A full heap-snapshot diagnostic stopped at its160MiB capture bound; the owned
browser closed. The incomplete raw snapshot remains local and is excluded from
commits. `failed-snapshot.json` records its size/hash/failure. A bounded inspector
owner probe, first verified on a separate scratch worker, replaced that capture.
It is diagnostic evidence, not user-experience timing.

The natural cohort records used JavaScript heap with ordinary GC, registered
queues, cache counts, requests and Pi CPU/swap/memory/temperature. Used heap is
not retained heap or process RSS. **Retained-memory plateau remains INCOMPLETE**;
pan/switch/concurrent-live cycles and settled forced-GC recertification remain.
The lifecycle tool now records active/settled job identities, raw native slots,
request traces, and the executed heap-helper hash for future comparable runs.

## Other experiments and next bottleneck

The existing intermediate exact-points transport was tested on the older pinned
window: five completion observations **[10.969,10.731,unobserved,11.409,8.985]s**.
It misses the target; no complete-cohort median exists and server encoding caches
were not equally warm. No default transport changed and no financial detail was
removed. Canonical/product experiments and all failures remain available.

The new prepared manifest itself is1355550 decoded file bytes, with16 active
segments/7741 active value points and62 canonical parts totaling27308409 decoded
bytes. Manifest-file gzip is200368 bytes; complete discovery responses in the
cohort advertise about245956 gzip bytes. Reused views avoid the27MB part import
but still receive/parse that descriptor and decode the local compact cache.
`prepared-descriptor-size.json` is read-only sizing, not proof of exclusive latency
cost. A conditional unchanged-manifest descriptor and direct loopback/SSH/Vite
comparisons remain candidates; neither has been implemented or accepted here.

## Release and operational state

Footprint history's last measured passing build remains9a526dc: both24h/1h and
4h/5m targets passed five Pi runs. They require recertification on the final
release build. Current footprint startup and both30h wall loading targets remain
failed; qualified current-wall paint, natural warm revisit, concurrent current
freshness/custom work, repeated-use plateau and foreground Pi acceptance remain
unmet or incomplete. Cold materialization limits remain separate.

Postflight verifies all eight protected IDs/start times unchanged, source collectors
live with no observed overflows and an empty history backlog. Original rollback
root checksums still match; all wall roots total785722048 bytes within the existing
budget. Owned test consumers/readers/pins are zero. No collector restart, source
retention change, production deployment or main merge occurred. The frontend
rollback is a previous verified asset build; the cache is in-memory and no backend
format migration is needed. Server rollback boundaries remain in the existing
cloned-staging operational documentation.

[Raw evidence, reports, browser receipts and screenshots](../artifacts/pi-history-r1/transport-r2/).

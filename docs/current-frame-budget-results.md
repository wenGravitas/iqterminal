# Pi chart scheduling and bootstrap follow-up

Release acceptance remains incomplete. Production client038b0b485aa5a67c0549e755e0bc405d2143428d
contains the awaiting-live bootstrap fix54d080b and the shared chart scheduler's
8ms soft work budget. The font trialc170b4b was reverted in1e332e7 after mixed
production evidence. Backend serving remainsdca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51;
there was no server deployment, collector restart, production change or main merge.

Five fresh-context current-only/two-history pairs ran on the actual Pi through
preview4187 and separate history18780/current18781 SSH forwards. Scenario order
alternates by round. Staging mode, prepared history enabled, fixture false and
exact client/API builds are asserted. The pinned historical end is1794225600000
(Nov9 12:00UTC), unchanged from the earlier continuity cohort. History is already
prepared; this is not a cold materialization benchmark. Chromium is explicitly
headless; chart diagnostics report Canvas2D. Normal foreground UX is unverified.

|Observation, ms|Five samples in round order|Median|Maximum|
|---|---|---|---|
|Current-only callback gap|1064.7,1883.8,1498.6,1782.0,1161.5|1498.6|1883.8|
|Concurrent callback gap|1100.7,1643.2,1375.4,3613.5,1658.9|1643.2|3613.5|
|Current-only observed long task|63,55,72,62,85|63|85|
|Concurrent observed long task|447,424,482,425,684|447|684|
|Current-only first live status|1279.5,977.0,950.7,2429.9,1326.8|1279.5|2429.9|
|Concurrent first live status|1385.5,1290.8,1780.5,1658.8,1450.3|1450.3|1780.5|

First live status is not first current paint, and callback gaps are not exchange
gaps. Observation long tasks start at the recorded observation boundary; larger
startup page tasks remain in the raw report. These times overlap and must not be
added as exclusive phases. No p95 is inferred from five samples.

All ten current observations have advancing validated execution/ACK chains on
the same stream identity, with no observed reset, disconnect, source cursor jump
or reserved health-read failure. The maximum sampled health request was1219.6ms.
All five historical pairs paint and explicitly validate every pinned48/24closed
slot after pan-away/restore. This does not certify loading latency, because the
runner samples the final20s observation rather than a first-paint deadline.

One five-minute viewport rounded one candle wider:49explicit validated slots,
covering all48pinned slots. The original outer-bound equality verifier rejected
it. The corrected verifier proves every unchanged pinned slot from explicit
ready/validated interval records and still requires the exact48painted times.
Missing, building, conflicting, capacity-limited or unvalidated records fail its
focused regressions. The original summary remains beside the corrected summary;
no request range or acceptance threshold was shortened.

Shared scheduler budget-yield counts in loaded rounds are100,83,66,68,91.
Lifetime scheduler elapsed maxima are409.0,323.9,395.7,355.0,584.6ms. These global
counters repeat per panel and must not be summed; they include startup work and
are not CPU timings. A single draw remains synchronous. Compared with the prior
8aa cohort, the observed loaded-task median falls from536to447ms and the maximum
falls775to684ms. The callback maximum also rises2394.9to3613.5ms. This is a
sequential comparison under varying system load, not a controlled causal gain.
The change bounds multi-chart bursts structurally; overall responsiveness is
still incomplete and sustained long tasks still need work.

The3%custom wall profile advances in the recorded materializer state, but is
already prepared and processing current changes. This does not establish safety
during genuinely missing custom backfill. CPU/swap/load samples before/after each
attempt are retained; sampled one-minute host load spans9.45–13.53. The existing
user desktop remains active. One serving mid-run resource snapshot is retained,
not a continuous server observer. All seven protected collector/worker IDs and
start times match the prior continuity receipt exactly and remain running.

The separate transport-fault regression uses an isolated loopback proxy. It
forwards real staging HTTP and holds stream delivery after a valid WebSocket
upgrade; it opens no upstream stream and fabricates no execution or health
packet. Both footprint and ordinary-candle Totals display five closed08:00–13:00
UTC bars plus the independently seeded13:00forming bar, with13:00–16:00future
whitespace. Both validate5/5closed slots, retain loading/awaiting-live status,
and have zero applied execution batches/ACKs. Screenshots show actual content.
Totals uses an explicit visible-range gesture; an ordinary candle chart does
not adopt a leftover footprint-only saved range. The first harness incorrectly
removed the footprint indicator and assumed that restoration; its two failed
attempts are retained. The corrected harness passes both cases. Canceled HTTP
forwards produce two recorded socket-hang-up errors in the fault proxy; this
is not an unmodified-network or live performance observation.

Focused product validation:94tests across staging service, scheduler, delta
flips and terminal footprint pass; typecheck and production staging build pass
(existing bundle-size warning). Ten reporting/proof tests pass separately.
The browser checks above exercise the exact038build. Report/harness corrections
do not alter that product bundle. The source/control font experiment remains
replayable with explicit pinned inputs; rejected trials and all20app attempts
(18completed intervals, including separate health failures) remain recorded.

Evidence roots under `artifacts/pi-history-r1`: `current-frame-budget-r1`,
`bootstrap-confirmation-r1`, `bootstrap-confirmation-r2`, `foot-font-app-pairs-r1`,
`font-app-r1-*`, `foot-main-8aa-r1`, and `foot-font-r1`/`r2`/`r3`. They retain
executed code, requests, source health, host samples, profiles, screenshots,
original/corrected summaries and runtime identities. Root manifests hash files.

Gate status: this cohort passes the narrow same-stream current confirmation and
exact requested-slot checks. Concurrent-history performance acceptance remains
INCOMPLETE: long tasks/delivery delays persist and cold custom-backfill contention
is untested here. Initial current-paint, prepared-history loading, warm revisit,
heap plateau, rollover and normal Pi browser gates are not recertified by this
run. Existing wall loading gates remain failed; overlapping default composition,
live-tail handoff and serving integration remain outstanding. Existing cold-build
read amplification also remains. Thresholds and financial detail are unchanged.

Rollback is client-only: revert the scheduler or awaiting-live status commit and
rebuild using the existing staging configuration. No source, cursor, collector,
prepared-data deletion or server rollout is needed. Retry remains the existing
consumer-specific history retry, preserving good bars and healthy live streams.

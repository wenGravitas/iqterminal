# Wall preparation and loading follow-up, November9

Release acceptance remains incomplete. Automatic default preparation now works in
an isolated real-source coordinator, but prepared30h wall loading still fails its
latency targets. Serving remains API f82abdf; the preparation bridge/GC have not
been enabled on the serving API. Both collectors and five protected workers keep
their existing identities/start times. No production deployment or main merge.

The missing automatic generator is implemented in backend d39416f, followed by
d38385e protecting a cold build across bar cadence/restart. The existing default
lane previously required manually supplied fixed windows. Automatic ownership now
retains a desired closed window, a ready fallback and one oldest healthy in-flight
build per configuration. It releases obsolete intermediate work without cancelling
visible consumers or independent manual owners. Defaults are exactly native10%
Spot5m and USD-M15m, Top8 per side, with30h plus one interval of padding per edge.
Source lag/retention is explicit; missing source does not shorten the window.

Validation:318 backend tests/typecheck/build and47focused queue/retention tests
pass. A fresh isolated root built both real defaults: Spot17canonical/17projection
pages in46,178ms; USD-M39/39 in64,709ms from admission to ready. Both ran through
the fair bounded background scheduler. These are genuinely missing derived views
over retained source, not empty-browser-cache loading observations. Raw source/OS
caches may already have been warm. Continuity gaps remain explicit:9Spot/2USD-M.

At06:30UTC the coordinator automatically admitted replacements. A requested
graceful stop left Spot at projection15/17 and USD-M at canonical4/39. The updated
coordinator resumed Spot at projection16 and USD-M at canonical5 with identical
source keys, then completed both. Request-to-ready values for those resumed jobs
include the deliberate stopped interval and must not be reported as cold build
times. Fresh folds of the same canonical parts match all resumed segment/value
fields, episode ordering, coverage and boundary selection exactly:3,201Spot
walls/24,513points and8,282USD-M walls/64,584points. This is resume equivalence
using the shared incumbent projector, not an independent raw-depth algorithm.

The two-minute resumed-worker observer recorded24samples with no sample errors,
worker high-water RSS198,279,168bytes, sampled swap0, maximum loopback API-health
latency1041.1ms and footprint-worker-health latency10.34ms. Serving stayed f82abdf;
footprint workers stayed18579d9. This is sampled server health/resource evidence,
not browser confirmation continuity or a heap plateau. All test coordinator and
observer processes were stopped cleanly; derived checkpoints remain intact.

The initial cold builds read17,804,454rows/1,704,867,599bytes in62per-turn SQL
queries for Spot and51,360,277rows/3,583,368,493bytes in128queries for USD-M.
These totals exclude lightweight default-head polling, which the subsequently
updated runner records separately in `defaults.jsonl`. No schema/index/cap change
was made. This read amplification and overlapping-window replay remain limitations.

Five-run Pi loading cohorts used production client
6fc990f28fe9736d8b6270fd786996006da24702, staging/history enabled, fixture false,
API f82abdfae06c61f8bccff9fea0778bbaac491b5e, preview4187 and separate
history18780/current18781 SSH transports. Every browser context had an empty cache;
server history was already prepared. The fixed30h window ends1793804400000
(Nov4 15:00UTC). Chromium was explicitly headless with effective Broadcom V3D GLES;
charts use Canvas2D. This does not establish normal foreground acceptance.

|Case|All five complete observations, ms|Median|Maximum|Completion gate|
|---|---|---|---|---|
|Spot5m|5715.9,8490.0,6467.3,6360.0,5924.4|6360.0|8490.0|FAIL median<=5000|
|USD-M15m|10682.9,10431.3,9683.6,8424.6,9810.9|9810.9|10682.9|FAIL median<=5000/max<=10000|

First historical paint, all five samples in ms:

- Spot:5182.9,3291.9,3265.0,3773.7,5033.1. FAIL <=3000.
- USD-M:3646.7,4572.3,3312.0,2706.1,3258.1. FAIL <=3000.

All ten coverage checks pass: exact immutable source revisions, latest completed
paint of8,293walls/49,154points Spot and23,850/104,112USD-M,360/120validated native
slots, unchanged requested ranges and default profile. Historical gaps35/47 remain
explicit. The strict loading verifier separately tests source revision, profile,
native slots, retained wall/value counts and latest painted revision; it cannot
pass on `requestComplete` alone. Its nine tests pass. The incumbent painted-view,
settings and independently pinned-reference assertions are retained alongside
the additional raw native-slot/response-revision checks. No p95, shortened ranges or
relaxed targets are used. Native-body paint time is not separately certified.

Serving-resource observation windows contain each client cohort and capture host
CPU/swap/pressure, container usage and API health. They use their own server
monotonic clock; no server timestamp is subtracted from a client timestamp.

The first USD-M sample exposes remaining costs: discovery headers take1599.8ms
and the final source validation starts about9400ms after client navigation. Five
Brotli batches transfer2,084,084compressed bytes; per-batch DB query counts are0.
The final body ends about7814ms after navigation, with further client work before
revision validation/paint at10682.9ms. These intervals overlap and are not summed
as exclusive phases. The point codec already removes only provably redundant
numbers while retaining exact decimal strings; simply repeating that optimization
is not new work. Next investigation should profile immutable import/finalization
and overlap candidate presentation with independent revision validation, while
preserving stale-source detection and exact financial/coverage checks.

Evidence: frontend prefixes `wall6fc-f82-spot-r1`/`wall6fc-f82-perp-r1`, including
all samples, requests, actual screenshots, executed code, browser configuration
and strict summaries. Backend directories `wall-rolling-defaults-d394-r1`,
`wall-rolling-defaults-d383-resume-r1` and `wall-loading-resource-r1` retain the
executed bundles, cold-step SQL/CPU/memory records, restart observation, exact
references, identities and serving-resource windows. Backend operational/retry/
rollback instructions are in `docs/WALL-ROLLING-DEFAULTS.md`.

Remaining: exact composition/reuse across overlapping windows, a proved join of
prepared closed history with current tail, serving integration, both wall latency
gates, current-footprint median, two-history/custom-profile live safety, repeated
use/heap plateau, and foreground Pi UX. A closed view's global source watermark
can extend beyond its time cutoff; it must not be blindly used as a tail cursor.

The separate status fix f6fd6815437154671a5a2a985590b9ee4f90854e marks whether
the archive view actually subscribes to current data. Historical-only gaps now
say `Historical view` rather than `Live has a continuity gap`. Live subscriptions
retain their existing live/confirmed/gap messages. All1,224frontend unit tests
pass/two skipped, typecheck/build pass,67focused archive/lifecycle tests pass and
one explicit headless fixture UI regression passes. Its screenshot verifies the
status wording; the loading cohorts above remain measurements of6fc990f. No
financial geometry, profile, gaps, settings or source accumulation changed.
Prepared projection completion now starts the independent source-revision read
only after all immutable parts and per-part financial records have validated,
then overlaps that transport with the final full checkpoint reconstruction and
presentation digest. The final checkpoint still validates global identities and
retention sequences. Neither step can publish completion alone. Source mismatch,
abort and final reconstruction failure retain incomplete presentation; a rejected
validation promise is observed even when reconstruction fails first.

This changes client scheduling only. It adds no source connection, cache format,
financial algorithm, preparation ownership or serving configuration. Reverting
the client commit restores serial completion without invalidating prepared data.
Timing benefit remains unproven until a measured cohort; do not infer a passed
loading gate from unit tests.

A subsequent CPU-profiled diagnostic on13d30ec found repeated progressive chart
work:24draws and5082.8ms cumulative chart-reported rendering, with953.8ms sampled
GC self time. Its15189.5ms completion is a single profiled observation under
substantial other Pi application load, not an acceptance cohort or a matched
before/after speed comparison. Raw profile, requests, coverage, screenshots,
client resources and enclosing read-only serving resources are retained.

The follow-up groups subsequent validated closed records into publications of at
most eight parts, while publishing initial active state and the first closed part
immediately. The final part flushes before independent source validation. All
per-part diagnostics and client yields remain; no financial record or requested
range is reduced. The35-part regression proves exact once-only delivery in
publication boundaries1/9/17/25/33/35, with completion still held by source
validation. Revert the client commit to restore per-part publication; no server
or persistent format changes are involved.

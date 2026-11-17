# Wall projection allocation measurement

Backend `990e14630b27b96cd3b5c5188c5055b5235e2ec4` removes a redundant
canonical-page serialization after the exact decoded bytes have been hashed,
and avoids the fragment-size binary search when a conservative bound proves the
entire closed record fits. The bound includes exact decimal string lengths and
JSON escaping; oversized records keep the incumbent largest-fitting search.
Financial ordering, output hashes, part boundaries, capacity limits, checkpoint
format and source validation remain unchanged. Injected loaders still require
the full serialized content hash.

The real offline CPU profile identifies checkpoint JSON work as the largest
builder hotspot: parsing the growing private checkpoint has 1,562 position ticks,
serializing its replacement 1,215, copying its closed index 500, and enumerating
that index 381. Fragment-size probing has 336 ticks and the redundant page
serialization 295. These are V8 sample attributions, not exclusive durations;
the cgroup throttles CPU and the profile includes idle/GC and final assertion
formatting. No unmeasured claim is made about disk-scan dominance.

The profile processed 79 canonical parts in 41,865 ms of summed page calls.
Its private checkpoint matched byte-for-byte, then the harness failed comparing
optional in-memory `undefined` properties with parsed JSON. The retained failure
is in `baseline.stderr`. A read-only recovery verified both serialized files and
all compressed parts exactly, and independently revalidated the canonical DB
source token. The harness now compares serialized public metadata. The profiled
run is excluded from the comparison cohort.

## Five alternating unprofiled comparisons

|Run|Baseline ms|Candidate ms|
|---|---:|---:|
|1|42230|40233|
|2|40383|40418|
|3|41853|39598|
|4|42487|39383|
|5|38814|41280|
|Median|41853|40233|
|Maximum|42487|41280|

Each run uses the same pinned canonical source and a fresh derived output
directory, with alternating baseline/candidate order. The host filesystem is
warm; this measures the projection component. It is neither raw cold
materialization nor empty-browser-cache chart loading. All ten builds must match
the existing ready private checkpoint, public manifest and compressed members
exactly, with renewed reader leases and canonical source checks.

The component median falls 3.9%. This is a modest reduction; the fifth baseline is faster than its candidate pair, and the large checkpoint cost remains. All ten runs have checkpoint SHA `10ecf3d53f2644bbe6d727903852246cd7b53a6026f511acc7bd0995016d477f`. No chart-loading, current, warm-wall, concurrency or heap gate changes status.

Source context: USD-M, `2026-11-09T07:45:00+00:00` through `2026-11-10T14:15:00+00:00` (30.5h canonical
context), source key `0b605de942bfbffccf5664c69d8fcb85ef4375e8af3772d267d3f61940fb509f`, source token
`d9685c246b411fd5ffde761d1f6732a9cebfbcc3b2fbfe726fbf161c96aeabc6`. The scope preserves the full fixed source window;
no shorter chart view is inferred. The source API revalidates the token after
each run; its DB rows, bytes and query timing remain in the raw receipts.

## Environment and safeguards

The staging source worker remains
`13730f76752ec9db7f2253aa541fd4131e578141`, container
`dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c`.
The side API remains `71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa`.
The benchmark runs in separate network-disabled containers over read-only source
mounts: 0.5 CPU, 384 MiB memory/swap limit, 256 MiB V8 heap, user1000, read-only
root, no capabilities/restart. It uses the established immutable runtime image
`sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43`
(Node22.22.0), with exact source bundles mounted read-only. The runtime image
does not contain the new source commit. The original API and seven protected
service identities match before and after; all ten bounded containers exit0 without
OOM. Reader/consumer counts return to zero. No collector or source retention
changes occur. Backend990e146 is committed/pushed but not installed in the serving
worker by this measurement.

The retained Pi resource sample describes this component cohort without a browser.
No browser, rendering mode, frame, heap-plateau or ACK-continuity claim follows.
Normal foreground Pi validation remains unavailable while workspace isolation is
unverified; all future browser checks stay headless.

## Evidence, remaining work and rollback

[Raw evidence](../artifacts/pi-history-r1/wall-projection-cpu-r1/) includes the
V8 profile, exact executed bundles, guarded coordinators, original failure,
recovery, per-page logs, every sample, source DB rows/bytes/query timings,
protected identities, Pi resource sample and test/build logs. `analyze.py`
reconstructs the summary. The lower-level helper retains its profiling-oriented
event names; `cohort.py` invokes Node without `--cpu-prof` and explicitly labels
the ten comparison samples unprofiled.

All346 backend tests,12 focused tests, typecheck and all bundles pass. The new
corruption regressions reject modified injected pages and valid gzip/JSON with
altered compressed metadata but wrong canonical decoded bytes, preserving the
previous checkpoint. Existing long-wall fragmentation, retry, resume, exact prefix
reuse and capacity suites remain in force.

The larger repeated closed-index checkpoint work remains. Normal prepared-prefix
and live-tail composition also remains incomplete; the saved head-boundary patch
has not been applied. The 30h wall loading gates remain failed, and latest current,
warm-wall, concurrency, retained-memory and foreground Pi gates remain incomplete.
Earlier footprint passes retain their original build scope. No thresholds or
coverage windows have been relaxed. There is no production deployment or merge.

Rollback of the allocation change uses the prior worker bundle with the same
checkpoint format; no cache reset or collector restart is needed. The profiling
containers have no network/restart and own separate output roots. See backend
`docs/wall-projection-profiling.md` for bounded operation and retry conditions.

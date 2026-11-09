# Cooperative prepared-wall checkpoint import

The prepared wall reader yielded while decoding and joining fragments, but its
three checkpoint imports still synchronously validated/cloned all retained
points and sorted the global retention queue. In particular, final assembly
restored every closed wall again before returning a mutable projector. That
work ran on the same feed worker as current subscriptions. Progressive content
did not make the final task cooperative.

The portable kernel now offers `restoreCheckpointCooperatively`. It uses the
same validation predicates as synchronous restore and keeps the original
synchronous entry point as a reference. Validation and point cloning expose
work checkpoints every256points/segments. Bounded native sorts handle at most1024entries, then merge sorting exposes
checkpoints every1024queue copies/comparisons, retaining the exact global sequence order
needed by pressure eviction. The adapter checks cancellation at each work
checkpoint and yields through the existing user-visible history task scheduler
after8ms elapsed work. Candidate associations, exact decimals, scope, gaps,
sequence identity, limits and later patch behavior are unchanged.

This is a soft elapsed budget, not a hard8ms maximum or CPU-time guarantee.
Allocation, OS preemption and the work between checks can exceed it. The kernel
owns no timer, DOM, worker, socket or subscription; its caller supplies clock,
cancellation and yield functions. Input is the reader's private authenticated
immutable checkpoint, held unchanged for the duration of import. No projector
is returned until all validation, cloning and queue ordering finish. Cancellation
discards private partial state; already displayed good history remains visible.
Per-part merge metrics exclude the measured scheduler wait from active elapsed
work, while preserving that wait in yield timing. This is not exclusive CPU time.

The new source checksum is
101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383.
Checkpoint serialization and financial semantics remain compatible with the
already preparedc49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c
core. `sync-wall-projection-core.mjs` now records the actual source checksum
separately from that prepared checkpoint identity. A single hard-coded exact
source mapping preserves the existing identity for this equivalence-tested
scheduling change. Every unlisted source checksum creates its own identity;
there is no environment override or blanket compatibility fallback. Tests
verify the exact source bytes in both repositories and the mapping's rejection
of a one-character source change. Unknown advertised cores still fall back.
This preserves ready derived history without a rebuild merely for client task
scheduling. Source/content hashes, immutable part validation and independent
revision checks still apply. The two kernel copies remain byte-for-byte equal.

Validation includes exact synchronous/cooperative checkpoint equality, detached
mutable data, complete retention-queue order, continuation patches, cross-record
duplicate sequences, orphan active associations, bad financial fields, budget
validation and cancellation. Existing prepared-reader tests retain revision
validation, progressive incompleteness, quiet-head rebinding and warm-cache
mutation isolation. Tests observing restore calls now await the cooperative
entry point; their financial/reference assertions remain.

Offline Pi worker evidence compares against the old source from4e2ab28 using
the captured exact default Spot and USD-M checkpoints. Five alternating pairs
per market use fresh workers and verify every restored checkpoint field and
queue entry by matching hashes. Timed restore includes cooperative waits;
input transfer and post-import checkpoint hashing are excluded. A10msinterval
measures event-loop opportunities in that worker. It is a synthetic scheduling
probe, not an exchange/current execution subscriber or a chart loading gate.
Raw source, compiled bundle, inputs, samples and initial harness failure remain
under `artifacts/pi-history-r1/wall-import-cooperative-r*`. The first harness
concatenated a worker handler after a source-map comment without a newline,
causing a syntax error before measurements; the corrected run is separate.

Serving integration and loading/concurrent-current measurements must use a
production client build before claiming a release benefit. The owned4187
preview and API/collector processes are not changed by the offline benchmark.
Rollback: revert the client reader/kernel/compatibility changes and rebuild;
the prior prepared identity and files remain usable. No cache deletion, source
retention change, collector restart or exchange connection is required.

Default-window composition and live-tail handoff remain separate requirements.
The closed canonical reader filters timestamps but advances its terminal cursor
to the global pinned watermark. Cursor/time partitions can interleave across
regressing epoch timestamps. Therefore neither concatenating independent time
slices nor subscribing after a closed view's global watermark proves an exact
join. Implementation must prove the missing cursor interval and boundary state,
or retain explicit discontinuity and use canonical replay. This import change
does not claim that unfinished handoff or overlapping-window reuse is solved.

## Captured Pi import measurements

The final R3 source is101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383;
all20samples use user-visible postTask. Each pair matches the old source
checkpoint, queue and diagnostics exactly:8,293Spot walls/49,154points and
23,850USD-M walls/104,112points. R3 retains the same financial source as
R2 but changes sort scheduling and harness transfer/yield behavior. Compare
variants within each run; do not attribute differences between cohorts solely
to native short-run sorting.

|Market/variant|Import elapsed ms, samples1–5|Median|Maximum|
|---|---|---|---|
|spot/old|224.8,209.7,165.9,167.7,232.5|209.7|232.5|
|spot/cooperative|246.9,321.8,290.7,206.7,301.4|290.7|321.8|
|perpetual/old|752.3,983.8,851.3,535.8,613.8|752.3|983.8|
|perpetual/cooperative|1704.7,1488.2,1028.6,712.0,741.5|1028.6|1704.7|

|Market/variant|Maximum worker interval gap per sample, ms|Median|Maximum|
|---|---|---|---|
|spot/old|225.0,210.1,166.2,168.0,232.9|210.1|232.9|
|spot/cooperative|87.5,40.4,79.8,64.6,58.2|64.6|87.5|
|perpetual/old|753.5,984.8,1066.3,536.2,615.2|753.5|1066.3|
|perpetual/cooperative|195.1,158.0,166.9,116.2,130.1|158.0|195.1|

Cooperative slice maxima, all five samples in ms: Spot11.4,16.2,10.6,9.7,13.3;
USD-M81.6,110.5,104.0,82.1,59.3. These measured elapsed overruns remain explicit;
their cause is not isolated. The code offers task opportunities and operation
checkpoints; it cannot interrupt allocation/GC or OS scheduling. Stalls remain
large enough to need real current-delivery testing. Total import is slower in
this cohort. A shorter synthetic worker timer gap is not a passed current or
loading gate, and no p95 is reported.

R2 uses the earlier8333727source and setTimeout yields with repeated CDP
input serialization. All20samples match financial checkpoints/queues, but
its elapsed results are a separate harness/source experiment: Spot old/cooperative
import median185.8/272.2ms, maximum279.5/508.9ms; USD-M462.9/1099.7ms,
maximum729.7/2018.7ms. Its raw samples and stalled intervals remain available.
The unmeasured R1 worker-syntax failure is also retained.


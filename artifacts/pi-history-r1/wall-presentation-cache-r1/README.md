# Detached wall presentation cache and default-capacity proof

Implementation commit9d77c08ca8f7ac5d38606f8e33dab7fbb9606824. Full frontend suite:
1151passed/2skipped,134filespassed/2skipped; typecheck and exact staging/history /
diagnostics build pass. No headed browser was opened. The compiled client module
and its SHA in the raw samples retain exact executed source. No new backend,
collector, raw-source retention, serving or production configuration was deployed.

The warm cache no longer creates a second mutable projector. It retains validated
prepared closed presentation records, copies active replay state(including late
censorship before admission), and copies canonical fallback rows. It stores no
live accumulator, cursor/candidates, global value-run queue or sequence index.
Fresh revision validation remains independent and supplies its own projector
before cached presentation can be replaced or bridged. The incumbent two entries,
16MiB per entry,32MiB aggregate and60s TTL limits are unchanged.

Tests show exact cached content despite active replay mutation, delayed validation
without erasure, exact censorship/fallback point independence, and20reopen/close
cycles with one bounded presentation but zero mutable projectors/history consumers
after each unsubscribe. warmSegments/warmRuns and capacity/admission counters
keep cached financial content visible in diagnostics. This is not retained-heap
or browser first-paint acceptance. The two initial failed assertions in the raw
logs assumed an absent service-only currentSelection annotation and counted the
existing empty initial snapshot; they were test expectation errors, not changed
financial semantics.

The local input-spot directory is a read-only capture of an existing completed
staging projection. Every gzip and decoded content hash is verified against the
manifest before the actual production client service loads it. Captured source
proof/manifests are pinned inputs, not freshly queried source proofs. No SQL,
exchange, browser, Vite, SSH delivery timing or wall-loading gate is asserted.

All five committed-client runs preserve8293walls/49154points/35explicit gaps and
financial hash cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e.
Offline file/client elapsed samples(ms):992.9,810.1,714.5,746.2,650.4;
median746.2/max992.9. These are neither historical paint nor actual-route latency.
Each run reports warmEntries=0,warmCapacityMisses=1 and zero retained projectors /
history jobs after unsubscribe. The pre-commit exploratory five samples are kept
separately and excluded from the committed-run figures.

The old retained-object estimate rejects the default Spot view at16829440bytes,
16.0498046875MiB against16MiB. USD-M's23850/104112reference estimates38863872bytes,
37.0634765625MiB. The presentation-only implementation helps already-admissible
views but **does not fix the default30h warm revisit gate**. Spot's actual immutable
parts are13330354decoded bytes /1454262gzip bytes,34parts,16active walls /
183active points. Exact compact reuse still needs implementation/validation.
No threshold, requested range or financial point was reduced to pass a gate.

To reproduce the file/service probe, bundle the entry with existing backend
esbuild and the explicit history define(no dependency change):

```
../iqterminal-server-perf-history/node_modules/.bin/esbuild \
 scripts/wall-presentation-cache-benchmark-entry.ts --bundle --platform=node \
 --format=esm --outfile=/tmp/warm-client.mjs \
 --define:import.meta.env.VITE_HISTORY_TILES='"1"'
node scripts/verify-wall-warm-capacity.mjs /tmp/warm-client.mjs \
 artifacts/pi-history-r1/wall-presentation-cache-r1/input-spot \
 artifacts/pi-history-r1/wall-presentation-cache-r1/captured-source.json \
 /tmp/warm-capacity.json
```

The probe rejects dirty tracked implementation/runner sources before recording
the source commit. Rollback: revert9d77c08; the shared projector core/cache format
and server materializations are unchanged. Keep the full release goal active.

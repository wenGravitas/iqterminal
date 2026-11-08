# One final prepared wall restore

The old prepared reader reconstructed the full projector, cloned every segment /
value point to a checkpoint and reconstructed it again solely to change transport
cursor/epoch. The new reader supplies the already admitted fence to the final
restore. Source revalidation still precedes terminal publication. Exact financial
content, active candidates, global value-run order and shared core are unchanged.

Tests cover both newer quiet heads and older bootstrap fences, asserting one
full restore, no checkpoint clone and exact canonical reference snapshot/selected
state. Existing malformed-content, correction, revision failure, abort and gap
regressions remain. This does not change the persisted projection format/core;
no server cache migration or rebuild is needed to use this client change.

`cpu-samples.json` contains every paired Pi Node sample. It uses the captured
USD-M23850walls /104112points from `wall-paint-cache-final/input-projection.json.gz`
and an existing active checkpoint from the backend coordinator receipt. The
financial hash is de4d77b3712a30172b81c080bfad58bc6701e5c4261eb41a9d02242b2ac899c6.
The global queue sequences are constructed monotonically; this envelope is a
CPU fixture, not a canonical queue/reconnect/eviction reference. Both methods
produce the exact captured financial snapshot and identical selected state.

Five double-restore durations(ms):1148.8,1034.2,852.5,844.5,882.6;
median882.6/max1148.8. Single:474.0,527.0,366.9,346.3,409.7;
median409.7/max527.0. Methods alternate order; explicit GC runs between isolated
function calls. Pre-call heap is49.2–49.4MB. Transient measured heap growth is
115.3–121.7MB(double) versus48.0–49.4MB(single). This is not retained-heap plateau,
browser frame timing, end-to-end loading or a release acceptance gate. A remaining
single restore can still consume over500ms on this host.

`exploratory-prior-scope-samples.json` retains the earlier exploratory run. Its
loop kept an earlier projector live through the next GC, so unequal pre-call
heaps make it unsuitable for allocation comparison. It is excluded from the
reported five paired samples. The final harness scopes each call independently.

Run withNode22.23.4 on this Pi:

```
node --expose-gc --experimental-transform-types scripts/benchmark-wall-fence-restore.mjs \
 artifacts/pi-history-r1/wall-paint-cache-final/input-projection.json.gz \
 ../iqterminal-server-perf-history/artifacts/pi-history-r1/wall-preparation-coordinator/staging/nov7-wall-queue-managed/projections/a6d39a0a5e53f05455032059e17d7586fb17e6b332d648fea25701ded1c9831d/manifest.json \
 /tmp/wall-fence-restore-cpu.json
```

Rollback: revert the client change. No collector, backend serving or production
change is involved. Foreground browser validation remains pending; headed
launches are paused following the user's reported i3 workspace disruption.

Validation: full frontend suite1149passed/2skipped,134filespassed/2skipped;
typecheck passes. The focused projection/history suite passed43before the
additional older-fence variant; both newer/older variants pass in the full suite.

Exact committed client b291b02 was rebuilt with staging data mode, history tiles
and diagnostics enabled; `staging-build-b291b02.log` retains the raw output.
Raw compiler/test/browser logs preserve their original trailing whitespace;
source-only diff checks pass, but a whole-evidence whitespace check is not clean.

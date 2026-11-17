# Exact canonical overlap reuse

A default wall view advances every5minutesSpot/every15minutesUSD-M. Replaying all
30hours of database payloads on each advance discards most prepared work. This
change reuses completed canonical event pages, while rebuilding the new view's
projection from its own fresh carry-in. It does not splice projected wall slices
or acknowledge a live tail from a closed view's global terminal watermark.

The coordinator selects one completed overlapping view of the same exact market/
profile, with nondecreasing start/end and source horizon. It freshly validates
that old view's canonical FINAL source proof. A changed or unavailable old proof
leaves the ordinary canonical path available. The new job already owns its own
pinned source proof, and must still pass final source validation before publishing.
The overlap dependency is persisted with the existing checkpoint, protected from
retirement during canonical work (including pause/restart), and released when
canonical preparation completes. A new revision clears the old dependency.

For the new view, carry-in anchors/state, coverage, gaps and native metadata still
come from the incumbent canonical reader. Event candidates reuse old exact wire
patches only beyond the old initial cursor; earlier cursors use the database.
Only the canonical plural/singular side spellings are converted. Decimal prices,
quantities/notionals, entry/removal identities, rank/band/size changes, timestamp
and epoch order and all other patch fields remain intact. Content hashes and
manifest/cursor identity are validated before a prepared part is read.

Fresh database events satisfy both the new range and:

```
cursor > oldWatermark OR at >= oldEnd
```

The second predicate is essential: a time-filtered old view can finish at the
global watermark without having read future-time rows below that watermark.
The first includes late old-time rows above it. A pinned tail snapshot is stored
once per new canonical key, with exact old-source/target-proof identity and a
content hash. It holds at most5000rows/4MiB; a larger tail records an explicit
fallback and uses the ordinary bounded queries instead of truncating. Restart
revalidates the private content hash. A mutable source change still fails the
new view's final publication proof. Cached/fresh rows are disjoint,
merged in canonical cursor/kind order, and pass the incumbent timestamp-group
closure. FINAL remains enabled. The new source proof detects source changes while
the private build runs and withholds a completed revision.

Each reuse invocation retains at most two decoded parts. Scan work is bounded to
8MiBof decoded canonical content per query, below the existing part/page budgets;
exceeding it falls back to the full canonical database query. The16MiBreturned
row and5000timestamp-group bounds remain. Preparation still takes one bounded
canonical page per fair coordinator turn, in its independent background process.
No database schema/index, source retention, collector, exchange connection or
serving capacity limit changes. This first step reduces database payload replay;
it still folds the exact new projection, and does not finish live-tail bridging.

Regressions cover exact pages versus the database reference, future rows below
the old horizon, late cursors, regressing timestamps/epochs, gap/side/decimal
preservation, publication refusal after source change, byte-budget fallback,
corrupt content, fresh overlap eligibility, dependency persistence and retention.
`ops/validate-wall-overlap-staging.mjs` validates two actual default advances in
an isolated derived root against fresh canonical pages and projector state,
recording per-page SQL rows/bytes/query counts, duration, CPU and memory. Its
measurements are materialization evidence, not five-run browser acceptance.

Operational recovery uses existing history Retry/new-revision controls. Healthy
build polling never resets its source proof. If optional overlap validation is
unavailable, the job uses canonical source pages. Corrupt referenced content is
an explicit invalid-content failure; repair/retry the derived job rather than
inventing coverage or modifying canonical data. No serving deployment is part
of the initial isolated proof.

Rollback can revert this change and resume the same canonical queue/checkpoints:
older code ignores the additive `reuseSourceKey` field and reads the database;
canonical version5, projection format/core and public cache identities stay the
same. Stop the isolated owner gracefully before changing its build. Do not reset
collector state, remove source rows or restart collectors. A completed exact
canonical revision needs no cache purge.

Initial isolated real-source proof on fd3b2d6passes canonical page bytes and
projected financial/selected-state equivalence for both default advances. It also
shows repeated tail queries: Spot reference/reuse canonical work takes11.95/13.77s
and payload reads still repeat per page. The follow-up pins that tail once; new
measurements must separate deterministic query reduction from end-to-end/browser
acceptance. No overall speedup is claimed from that initial single comparison.

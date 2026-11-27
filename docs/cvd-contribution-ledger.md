# Exact CVD contribution ledger

The new decoder and `CvdContributionLedger` are worker-ready data components,
not production chart wiring. The existing numeric `CvdService`, calculator,
subscriptions, anchors and renderer remain selected. No fixture or archive data
is used as a live connectivity fallback.

The decoder consumes the backend's disabled `/v2/cvd` observations, preserving
signed decimals and UInt64 IDs/counts as text. It requires the source, version,
incarnation, revision scope, requested replacement range, retained horizon,
coverage and false financial/reconciliation/retirement flags. It refuses numeric
legacy fields, impossible record cardinality, malformed ranges, unsafe IDs and
nonempty unchanged-cursor replies. Decoded-body transport remains bounded to
2 MiB and drains actual cancellation through the existing JSON reader.

## Stable ownership and corrections

Construct one ledger per source/basis, then accept a non-awaiting full native
page. Its **first `retainedFrom`**, not its requested page or viewport, fixes the
native/archive cutover. Later rolling horizons and requested ranges do not move
it. Native owns minutes at/after that boundary; archive observations own earlier
minutes. Archive replies never race to fill a native-owned gap. Missing native
ranges need native backfill while available or separately qualified
reconciliation; expiry does not silently change ownership.

Native full snapshots replace only accepted contributions inside their requested
range. Earlier accepted minutes remain after native window pruning. Higher
revisions can correct native observations within the same incarnation; older
replies cannot overwrite newer cells. Revision/watermark consistency is checked
against the global accepted clock, each touched block and each accepted minute.
A new incarnation requires explicit reconciliation and leaves the old basis
intact. No automatic rebase/reset is implemented here.

An unknown partial native minute cannot erase a known contribution. Partial
replacement also cannot lose already observed execution count/ID bounds.
Completed, newer native observations can replace the requested range, including
verified empty minutes. These are observed native corrections, not financial
source acceptance or a rule for superseding archive publications.

Archive pages require the exact leased response contract. Earlier unseen
contributions extend the accumulated prefix once. Equal overlaps are deduplicated;
different quantities or ID/count evidence fail atomically regardless of upload
time or publication generation. Existing archive coverage/provenance is retained
on equal replay; a different publication does not automatically upgrade it.
Explicit partition gaps stay partial; unquantified partial coverage is never
treated as complete.

All arithmetic uses bounded signed-decimal BigInt coefficients. Numeric
conversion is deferred to a future presentation adapter. A known empty recorded
minute differs from an unknown minute. `sum` returns exact **observed** totals,
known/covered/observed counts and completeness; it never grants financial
acceptance. `series` also marks availability/observation, so missing history
cannot become a plotted observed zero. The caller supplies the actual anchor;
viewport edges never define a prefix. Output grids are aligned independently of
panning.

## Bounded residency and restoration

Defaults per source ledger:

- 3,660 UTC day blocks, 32,768 resident minute cells and 10,082 output points.
- Eight accepted archive roots per day and 8 MiB of encoded provenance strings.
- Decimal input limits inherited from the wire; accumulated text is capped at
  192 characters. Count/day/provenance bounds are logical bounds, not measured
  process-RSS promises.

Admission stages affected blocks and checks the complete transaction before
changing accepted data. Capacity, late overlap conflicts, impossible cardinality
and inconsistent clocks preserve the prior state. No automatic eviction is
coupled to a network request or chart subscription.

`evict(day)` removes disposable minute cells while retaining exact daily totals,
presence/recording/coverage bitmaps, ID/content checksum, native clock summary
and accepted provenance. It does **not** change the data version or total.
Current native days cannot be evicted. Whole-block prefixes and provably empty
subranges remain usable without a download. An ambiguous partial-block boundary
returns a restore requirement rather than an invented prefix.

`restoreArchive(page)` can rehydrate already accepted observations from an
equivalent immutable archive copy, including mixed native/archive days. It
checks the original canonical data hash and restores original coverage/ownership;
it adds no observations and does not upgrade financial authority. It can use an
equivalent copy in a newer publication without choosing that publication as a
correction winner. An incomplete/mismatched candidate or insufficient resident
budget leaves the old totals intact. Newly discovered observations still require
normal admission after restoration.

A full, complete newer native-owned day may replace a sealed native day using
its retained old total, without replaying old minute bytes. Partial native
corrections need the accepted block restored first. Restoration changes
residency, not the data version: an owner awaiting restoration must retry its
unavailable projection without clearing previously accepted renderer buffers.

These are CVD minute summaries. ID bounds/counts do not reconstruct individual
executions or prove complete sequence membership; no subminute/OHLC/depth
reconstruction is promised. Raw archives and recovery copies remain independent.
No source deletion is authorized by client compaction.

## Verification and remaining gates

The four focused Vitest files passed **65 checks**. Typecheck and the disabled
production build passed. Focused tests cover arrival order, overlap deduplication, earlier-prefix updates,
native corrections/pruning, fixed retained-horizon cutover, clock regressions,
restart refusal, partial data, atomic capacity/conflict failures, mixed-owner
rehydration, native whole-day replacement and a synthetic year of exact totals
with only the current native page resident. The year test is a correctness/capacity
shape, not market growth or performance evidence.

The explicit Pi Chromium dedicated-worker fixture passed **one headless check**
and additionally combines native
and leased archive observations, verifies exact quantities, evicts/rehydrates a
block and retains identical totals/data version through an origin outage and
session release. An optional backend probe loads the actual bundled ledger and
accepts a real exact page from the compiled native API/default guarded transport
against a loopback SQL fixture; all **11 compiled native checks** passed. No real ClickHouse throughput, S3 connector,
foreground chart or p50/p95 claim follows from these tests.

Still required: production worker ownership/scheduling, native backfill and
incarnation reconciliation, renderer integration preserving resident geometry,
durable basis recovery across worker restart, meaningful Pi/live/provider
performance validation and separately approved deployment. The ledger is
worker-lifetime memory; backend archive storage provides durable history.

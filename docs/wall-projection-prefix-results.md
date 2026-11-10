# Nonterminal projection-prefix validation

Release acceptance remains incomplete. Backendb0f0209implements exact forward
prefix reuse and a durable queue-protocol barrier;2ff39ccadds explicit isolated
proof recovery. The40d15aefollow-up selects a prefix when canonical input is
already prepared but its projection is missing.337backend tests,42focused tests,
typecheck and build pass on that follow-up. No production deployment or main merge.

The isolated staging proof compares independently reread canonical database pages
and complete fresh projection folds with prefix reuse. It keeps the start fixed,
extends the end by one native bar, and replays the old final page. It does not clone
a time-filtered terminal global cursor into a live accumulator. Every canonical
part, output part, identity/index, active checkpoint, financial snapshot and selected
state matches within each reference/reuse pair. Source gaps remain explicit.

|Case|Reused nonterminal pages / total target pages|Walls / value points|Gaps|Full projection observation|Reuse observation|
|---|---|---|---|---|---|
|Spot5m Top8/10%/native|16/17|3202/24556|9|2618.1ms|2496.4ms|
|USD-M15m Top8/10%/native|38/40|8380/65865|2|6497.9ms|5376.2ms|

These are ONE observation per mode/market, including25msinter-step yielding and
final source checks. Copying remains bounded to one prepared part per turn. They
are not five-run loading gates, medians, p95, complete materialization timings or
Pi browser paint measurements. Copy/checkpoint overhead remains; skipped fold
count is not a proportional speedup. Canonical preparation, base construction,
source proofs and verification are separately retained in raw step records.

Spot completed onb0f0209. USD-M's base projection then failed its FINAL source
validation because the private SQL connection closed (`UND_ERR_SOCKET`). Its
public completion was withheld and its38-page checkpoint survived. The2ff39cc
resume retained Spot evidence and the USD-M base horizon/checkpoint, reapplied
only its failed final base step, and then completed the new target comparison.
The unstarted USD-M target acquired a new explicit persisted horizon. No started
healthy target was reset. Failed setup work and the paused interval are not
omitted from an invented cold-build or end-to-end completion result.

The original and resume serving observers contain60and31samples respectively;
their terminal records and any errors remain in the summaries. They measure
resources/health, not execution ACK continuity. The proof child exited0after
resume; its owner lock was removed. No browser was launched. The initial bulk
manifest transfer after the pause exceeded30s; the completed job was not restarted.
A compressed read-only transfer retrieved exact result/manifests afterward.

Private queues upgrade durably to protocol2 BEFORE copying and never silently
downgrade after Retry. Old builders reject these queues. Rollback uses a fresh
isolated derived root or a compatible recovery owner; never edit the protocol
number or transplant partial progress into old code. Public financial cache/core
formats remain compatible. Detailed retry/rollback is in backend
`docs/wall-projection-prefix.md`.

Source/target ranges, horizons, exact hashes, executed bundles, raw observations,
transport failure, resume plan, public manifests and resource receipts are under
`artifacts/pi-history-r1/wall-prefix-staging-r1/` and
`artifacts/pi-history-r1/wall-prefix-resume-staging-r1/`.
The real proof exercises the builder with explicit verified inputs; coordinator
selection/protocol recovery is covered by focused tests. Automatic serving rollout,
verified live-tail joining, current concurrency and all previously failed browser
loading gates remain incomplete. Nothing here recertifies those gates.

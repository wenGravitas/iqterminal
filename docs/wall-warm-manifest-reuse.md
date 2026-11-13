# Early validation of prepared warm history

Warm revisits previously fetched every immutable projection part, reconstructed
all exact point objects and built a second mutable projector before comparing the
new complete manifest with the cached revision. The existing final reuse avoided
another chart snapshot, but did not avoid network, decode, GC or retention work.

The prepared reader now offers a presentation-only reuse path. It verifies the
canonical source/discovery identity and exact configuration, computes SHA256 over
the entire selected projection manifest, and asks the service for an already
authenticated cache with that exact signature. The cache remains scoped to the
same market/profile/settings and full requested range. A token match alone is
insufficient: part hashes, coverage, settings and all other manifest metadata
participate in the signature. Capacity-limited manifests use the full importer.

For a matching revision, the existing bounded cache replay still verifies every
compressed chunk and exact row/point count. Independently, the normal final source
read verifies the current canonical source token and admitted head. Both must
succeed before requestComplete. The ready cached map is shallow-copied because
releasing its replay clears the old container; immutable financial rows/points
remain shared. No mutable historical accumulator is created or attached to live
current selection. Current snapshots and their sockets/cursors remain separate.

Only an unchanged complete presentation can keep existing chart rows. A late
subscriber still receives a full authoritative snapshot. Changed manifest,
configuration or cache metadata uses the normal full authenticated importer;
failed cache decoding also falls back to that path. A failed source proof remains
an explicit failure with good cached rows retained. Explicit Retry revalidates
without resetting unrelated current feeds. Cancellation stops only the waiting
consumer; another viewer's shared replay can continue.

Focused tests cover zero projection downloads on an identical compact or small
cache, no second chart snapshot, exact financial output, delayed/failed source
proof, successful Retry, unfinished replay, failed replay fallback, metadata
corrections, late joins and independent delayed current bootstrap. They do not
certify Pi latency or a memory plateau. The Pi lifecycle evidence separately
records forced-GC versus natural measurements, active/settled jobs and retained
queues. Older lifecycle captures lacked active-job metadata and could not distinguish
a settled view from a second viewport read still running; they cannot establish quiescent
warm memory. No loading threshold, range, row/cell budget or source detail changed.

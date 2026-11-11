# Selected wall projection source contract

Prepared selected walls can now negotiate an explicit projection response without
an accompanying canonical-page manifest. Both X-IQ-Wall-Projection (the exact
financial core hash) and X-IQ-Wall-Projection-Only:1 are required. Older clients
continue receiving canonical manifests and their existing delivery capability.
A missing selected projection retains ordinary canonical discovery/build behavior.
Malformed opt-in capabilities are rejected.

The opt-in response is ready with representation=projection-v1, a freshly checked
source proof, the complete selected projection, and sourceSnapshot:

- version1 / kind wall-projection-source-v1;
- key derived from version5, market/profile, exact from/to, pinned watermark and
  source token;
- exact request, stored eligible sourceProof, pinned watermark and head.

It contains no canonical page list, page revision or continuation claim. The
canonical batch capability is omitted. The client independently validates the
source key/fence, imports all selected records with existing hashes and full
financial validation, and revalidates the source before completion. Its canonical
read method explicitly rejects use of unadvertised pages.

Quiet backward transport rebinding still requires a matching retained anchor and
maxCursor proof inside the acknowledged cursor. For a selected projection the
proof covers every financial input; no canonical page cursor can be consumed.
Malformed identity/range/head/token, changed anchor and late input must fail or
use the ordinary source path, never advance that acknowledged cursor silently.

## Scope of this change

The current server constructs this response from the incumbent complete canonical
snapshot and complete projection. Existing lookup publication, reader leases,
retention and source checks remain mandatory. This does not yet publish a
projection independently of canonical files or implement the bounded same-start
tail builder. That producer must preserve gap replay, late/corrected events,
source/anchor/epoch validation and durable dependencies before it can use this
contract. No canonical pages may be invented to satisfy the old manifest schema.

No financial kernel, profile selection, depth/time coverage, point format, source
retention, exchange connection or collector changes. This is a delivery contract,
not a claim that the cold30h latency gates pass. Five actual-route comparisons,
current-load concurrency and staging cohort validation remain required.

## Rollout and rollback

New clients accept old gateway responses when the opt-in is ignored. Old clients
do not request the new representation. Either side can therefore be rolled back
independently while existing canonical delivery remains present. Use the existing
isolated staging workflow, record exact source/build/root and collector IDs, and
retain the established bounds; no production deployment is authorized.

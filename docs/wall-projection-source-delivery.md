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

## Validation of the initial contract

Backend source d33a878cb23bc50bb979153164397fdb8919985c and frontend application
7eb4a00b60daf344188eebc0659a8a82862113e8 pass typecheck/build. Backend379 tests
and frontend1,354 tests pass (two frontend skips);105 focused importer/admission
checks pass. The financial kernel SHA256 remains
1a86cb47e20943c9c71f4614e267abe22ae507c84834cd184559ff97df041c73 in both repos.

Seven headless system-Chromium/SwiftShader browser checks pass against the exact
production build. The new explicit transport fixture holds final source validation
while authenticated historical walls actually paint, then verifies exact canonical
financial fields, healthy current status, the unchanged30h saved viewport and all
360 native closed slots. It makes no canonical-page request. Its screenshot is
labelled as a fixture; this is not financial-source, timing or foreground evidence.
The initial browser attempts exposed fixture Map-order and underfilled native-page
assumptions; their failed outputs are retained alongside the final green cohort.
The new cancellation tests also exposed and corrected an already-aborted-signal
handling omission in the old test mock, with scheduler-slot release asserted.

Raw results, request headers, compiled environment, screenshot and checksums are
in artifacts/pi-history-r1/projection-source-r1. Read-only postflight confirms
worker33c7e3a, gateway112bf11 and eight protected container identities/start times
unchanged. Neither new backend source nor the new automatic-start policy is
installed on staging yet. The isolated Pi baseline4199 and candidate4201 remain;
three older, idle, owned previews were closed after verifying no active clients.
The user's5173 client and SSH forwards were preserved.

Actual cold/warm loading samples, canonical financial references on retained real
source, default rollover and concurrent-live acceptance must be rerun after the
bounded tail producer and staged cohort are ready. This contract validation does
not replace them, and the earlier cold-wall gate remains failed.

# Isolated default preparation and serving validation

The performance release remains incomplete. A separate staging worker and side
API now exercise automatic default preparation, retention/read leases and immutable
batch delivery against real retained source. The original18780API remains on
dca1bb8; production, collectors and the five protected background services were
not replaced. This is not a production deployment or browser acceptance.

The isolated gateway listens only on127.0.0.1:18880with71f62d2code. The coordinator
control now listens only on127.0.0.1:18791with13730f7code. The older0811e74
worker was replaced after the retirement scanner rejected exact-reuse files; see
[retirement recovery evidence](wall-retention-reuse-results.md). Both use the original API's
immutable runtime image with their explicitly compiled bundles mounted read-only;
this image is not claimed to contain those commits. Bundle SHA256, exact image,
actual Nodev22.22.0runtime, container/start identities, flags, mounts and commands
are recorded. The gateway inherits the original state mount read-only and mounts
the new wall root read-only. Only the worker can write its separate derived root.

Worker CPU remains0.5, memory384MiB, V8old-space256MiB; gateway limits are1CPU/
512MiB. Both have read-only root filesystems, dropped capabilities, no-new-privileges,
no restart policy and10MiB/three-file log rotation. Neither creates exchange
connections. SQL uses the existing private admission proxy/background priority.

The sections below retain the original 71f62d2/0811e74 component observations.
Latest 13730f7 retirement, financial-reference and both-market rollover results
are recorded in the linked recovery report.

## Original cold preparation and rollover observed

The successful worker started with an empty derived root. Initial startup refused
because the launch receipt had incorrectly been put inside that root. The owned
receipt was moved outside it and only the confirmed stopped test worker was
started again. No preparation had begun; the failed startup is preserved.

Four exact jobs reached ready, with source windows unchanged:

|Profile|Requested source range, epoch ms|Canonical/projection pages|Explicit gaps|
|---|---|---|---|
|Spot5m native10% Top8|1794179100000..1794287700000|25/25|16|
|USD-M15m native10% Top8|1794177900000..1794287700000|76/76|4|
|Spot next rollover|1794179400000..1794288000000|25/25|16|
|Spot following rollover|1794179700000..1794288300000|24/24|15|

These are30hplus the existing native-bar padding, not shortened substitute views.
Coverage remains partial where the source contains gaps. New Spot work was admitted
while the oldest healthy build continued. A USD-M rollover is not yet certified.
This was missing derived history over retained canonical source; DB/OS caches may
already be warm. Raw per-turn monotonic elapsed/CPU/query/row/byte/memory records
and admission records are retained. RequestedAt/doneAt are server wall-clock fields,
not synchronized cross-host or exclusive CPU durations. No cold-build latency gate
or throughput claim is inferred from ready flags alone.

The0811e74guard reserves160MiBof transient file headroom for the extra prefix
checkpoint while retaining the2GiBtotal derived cap and20GiBfilesystem floor.
Only the owned worker was gracefully replaced to apply it: exit0, owner lock
released, same root reopened. All four existing job source/projection identities
were preserved. Bounded log configuration was then applied by recreating only the
two owned side services. Original API and all seven protected service identities
and start times matched across those operations.

## Actual serving path

Both APIs returned healthy build identities. Through the side API, each market's
ready default passed source discovery, independent reader retention, one bounded
gzip projection batch, part SHA256 membership and source-revision checks. Delivery
reported zero database queries. Reader interests were explicitly released.

|Market|Verified first-batch parts|Compressed bytes|
|---|---|---|
|Spot|21|895204|
|USD-M|19|796058|

This proves routing, source identity and bounded immutable delivery. It does not
prove all visible30hcontent was painted, first useful display, five-run loading,
current ACK continuity, warm revisit or a retained-heap plateau. No browser was
launched. Previously failed client performance gates remain failed.

## Active validation services and recovery

The active owned containers are `iqterminal-wall-serving-13730f7-r1`
(`dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c`) and
`iqterminal-wall-gateway-71f62d2-r2`
(`569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae`).
Latest launch and protected identities are in
`artifacts/pi-history-r1/wall-retention-r2/upgrade.jsonl`. The earlier
`active-services.json` is an immutable historical receipt, not the active registry.
They intentionally remain running for the next client-route validation. Verify
those IDs before stopping anything. Stop the side gateway before the worker,
allowing the worker45sto finish its bounded step and release its owner lock.
Preserve `/home/daz/iqterminal-wall-serving-71f62d2-r1` and its private protocol.
Do not remove locks on an observation timeout. Restart only the matching stopped
owned containers after checking their image, bundle hash and root ownership.
Older stopped test containers are retained as evidence and do not run.

Raw launch/recovery/upgrade receipts, mounted bundles, read checks, checkpoint/
rollover records and scoped hashes are under
`artifacts/pi-history-r1/wall-serving-worker-r1/`. The next work is to validate the
actual chart demand against these prepared ranges and measure the Pi client route;
ordinary current-tail joining and all complete release gates remain unfinished.

# Archived wall range navigation

Status: **implemented, disabled by default and undeployed**. The optional consumer loads independently authenticated archived shards through the existing native projection reader and resident presentation. It does not activate a storage provider, change recording/retention, resolve financial corrections or enable production trading.

## Selection

Build the candidate with `VITE_WALL_ARCHIVE_RANGES=1`. The server must separately select its archive, `wallRangeQueries:true` and `IQ_STORAGE_WALL_RANGES=1`. Its range plan must advertise `delivery:{version:1,archiveOnlyReads:true}`. The ordinary frontend build leaves the consumer disabled. No supplied staging script or deployed service is changed.

The path applies to the incumbent Binance spot/perpetual native 10% top-level profile with eight selected levels, no minimum notional and no confirmation duration. Other settings retain their current path. A 404 during initial metadata negotiation falls back to the incumbent exact-request flow. Malformed plans, missing capability, conflicts and provider failures are explicit failures/partial coverage; they do not select fixture data or raw replay.

Range plans are metadata only. The client validates their hash, request identity, disjoint span chain, descriptor bounds, source/key identities and explicit unverified coverage. Limits are 366 days, 512 descriptors, 1,025 spans and 1 MiB of decoded response data. The backend has its own catalogue bounds and can refuse a large/overlapping selection sooner.

## Reader and cache ownership

`ArchivedWallRangeSession` admits only completed native projection results whose original request, source token, canonical key and projection key match the selected descriptor. `requirePreparedProjection` bypasses hot eligibility resolution, negotiates archive-only reads and refuses missing/canonical-only results before raw replay or canonical prefetch. The backend refuses archive-only discovery/source/key reads when the archive entry is absent and refuses hot horizon queries. Capability negotiation prevents treating an older range endpoint as having these guarantees.

Each admitted presentation remains scoped by the existing `residentRange`. Independent shards never merge episodes, quantities, epochs or source proofs. Newly selected adjacent ownership can expand only an identical cached native presentation: the exact source token, manifest revision, financial map and status must agree. Failed admission leaves the previous ownership intact.

One metadata/native operation runs at a time per session, through the existing shared history scheduler. The nearest useful missing span is selected first. View changes coalesce while useful in-flight work finishes; they do not cancel it once per gesture. Cached original presentations can cover newly selected scopes without another native download. Already resident ranges make no metadata or payload request. Parsed immutable part caching remains owned by the existing service cache across subscription reopen.

Up to 64 small immutable owners share the **unchanged** 100,000-segment / 1,000,000-run / 307,200,000 charged-byte limits. The owner count is independent from the renderer's eight-context budget. Byte accounting is an estimate, not a measured RSS limit; full worker/large-market memory acceptance remains open. Only offscreen owners may be evicted to admit another range. A visible capacity failure preserves the displayed data and reports partial coverage. This does not promise that a year of full-resolution records fits one view.

Metadata gaps, conflicting selections, source failures and unverified new revisions leave existing chunks visible. User Retry rechecks the selection and source; it does not silently replace an overlapping financial revision. Automatic correction/supersession authority and aligned archive production remain separate backend engineering gates. A successful shard read does not turn metadata-only or truncated/gapped history into complete coverage.

## Validation

[Evidence](evidence/archived-wall-range-client-validation.json) separates protocol/model tests, actual native projection contracts, the controlled headless Chromium/Canvas fixture and builds. The fixture holds a second shard response while the first remains painted, pans through loaded ranges and reopens from immutable part caches while the batch body origin is deliberately unavailable. It uses explicit generated data and a local protocol model, not live venue data or real remote storage.

The Pi 5 test recorded zero blank frames in 30 held-download draws, zero removals of retained walls, zero additional requests during 20 resident-range pans and two total batch downloads after five cached reopens. Exact quantity strings and known source gaps were retained. Five cached fixture reopens measured p50 **14.7 ms**, p95 **19.1 ms**; this tiny uncontrolled-host sample measures the fixture consumer, not real network/server latency or foreground chart acceptance. No FPS claim follows.

Reproduce with an explicitly isolated loopback development server:

```sh
pnpm exec vite --host 127.0.0.1 --port 5197 --strictPort
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5197 pnpm exec playwright test \
  tests/browser/wall-archive-ranges.spec.ts --workers=1 --reporter=line
```

The test explicitly selects headless system Chromium. The existing headed-browser isolation guard remains enforced; do not disable it to claim foreground acceptance. The fixture creates no exchange connection and is outside normal application flows. Stop only the owned loopback test server afterward.

Still required: real staging/cold-provider end-to-end reads, aligned shard production and authoritative correction handling, realistic 24-hour/seven-day/30-day loads, mixed live/archive contention, large worker/RSS and foreground Pi interaction measurements. No paid provisioning, deployment or history deletion occurred. Rollback rebuilds with the frontend flag off and clears the independent backend selections only on an explicitly authorised candidate runtime; stored history is preserved.

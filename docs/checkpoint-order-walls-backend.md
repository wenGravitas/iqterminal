# Order Walls backend extension

Order Walls uses an additive `GET /v1/depth-observations` route in the existing
history gateway. Prepared heatmap averages cannot recover the observed entry
and exit times of a wall. This route reuses retained raw depth records, existing
market configuration, query admission, compression, caching and depth-head
notifications. It adds no collector, exchange connection, table or migration.

Requests accept `from`, `to`, `market`, `watermark`, `after` and `limit`.
`market` defaults to perpetual for compatibility; Spot and perpetual select
different source tables and feed identities. Replies include the fully qualified
instrument, a fixed durable cursor watermark, an actual checkpoint seed,
ordered observations, continuation metadata and explicit coverage. Pre-window
deltas preserve crossings between the seed and requested window. Continuations
close timestamp groups so equal-time updates are not classified separately.

Replay is bounded to 50,000 records and 64 MiB; pre-window replay is bounded to
5,000 records. The retained book is bounded to 5,000 levels per side. Missing
checkpoints, retention expiry, sequence gaps, epoch changes and capacity limits
are coverage limitations, not observations of zero liquidity. Historical
precision is collector receive time, not exchange matching-engine event time.
Raw retention can be shorter than prepared heatmap retention. The UI must not
claim complete market depth or extend walls through unavailable observations.

## Staging deployment and recovery

The gateway was deployed from `/tmp/iqterminal-server-order-walls` to
`staging:/opt/iqterminal` in recoverable tmux session
`iqterminal-order-walls-api`. Existing Spot edits were preserved. Only the
`app` service changed; collector, Spot collector, both materializers,
ClickHouse and Level Watch retained their container identities.

Recovery files are on staging in
`/home/daz/iqterminal-rollback/order-walls-2026-10-17`: the previous gateway
source archive and image archive, image inspection, source hashes, deployment
script/log, container identities and real API smoke responses. No destructive
migration was performed.

Evidence is in `artifacts/order-walls/backend-live-api.json`,
`backend-container-changes.json`, `backend-containers-before.json` and
`backend-containers-after.json`. Both markets returned HTTP 200, isolated feed
identities, an actual checkpoint, a stable watermark and ordered continuation.
This bounded two-page API smoke verifies transport and market isolation; it
does not by itself prove a complete historical window or browser performance.

The backend authoring copy passed all 63 automated tests, `pnpm typecheck`
and `pnpm build` after deployment. These checks include the preserved Spot
implementation as well as the additive observation API.

## Top-N CPU optimization and staging evidence

A follow-up CPU optimization keeps exact best-N membership with boundary and
outside-level heaps and computes patches from changed top membership. It avoids
sorting the full observed book on every delta. Ordered same-time output and
coverage behavior remain unchanged. A deterministic 1,000-delta test compares
the incremental projection and patches with a full sorted-book reference,
including entrants, evictions, removals and promotions.

The backend authoring copy passed all 63 tests, `pnpm typecheck` and `pnpm
build`. Staging measurements below are sequential HTTP checks against the
loopback API, with `limit=1000`; they are endpoint timings, not frame-rate or
platform-performance claims. The fixed historical `[from,to)` request spans
5,996,363 ms and was repeated with the same bounds before and after deployment.

| Probe | Before | After |
| --- | --- | --- |
| Fixed 100-minute range | HTTP 503, 14.037 s, `fetch failed` | HTTP 200, 1.865 s, 2,271,855 bytes, 1,036 observations including pre-window warmup, `hasMore=true`, partial=false |
| Fresh trailing 60 seconds | HTTP 200, 10.056 s, 1,666,095 bytes, 757 observations, partial=false | HTTP 200, 1.552 s, 1,648,357 bytes, 775 observations, partial=false |

The staging ClickHouse execution timeout was not changed. Only Compose service
`app` was rebuilt and replaced. All seven services are healthy; the six
non-app containers retained their IDs and start times. The before/after API
summaries, container identities, service diff, source hash and deploy log are
in `artifacts/order-walls/backend-cpu-fix-*.json` and
`artifacts/order-walls/backend-cpu-fix-deploy.txt`. The rollback image and
source archive, rollback script and complete run log are on staging at
`/home/daz/iqterminal-rollback/order-walls-topn-2026-10-17`; rollback was not
needed.

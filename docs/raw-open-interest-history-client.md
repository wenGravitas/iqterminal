# Optional observed OI historical reads

The client now has an end-to-end historical OI path through the existing chart panel, feed client, dedicated worker and historical gateway. It is disabled by default behind `VITE_OI_HISTORY=1` and requires staging data mode. No deployment, live retention change or paid provisioning is performed by this increment.

## Request and data ownership

The panel reports its visible time range through the existing single visible-frame scheduler. The data controller owns historical demand, so an OI pane need not remain visible when a script consumes its outputs. Startup uses the actual visible range, not the entire candle cache. Pan/zoom messages do not clear resident observations or restart the live poller.

The worker requests `/market-data/v2/history/raw-open-interest` in canonical four-hour source-time windows. It plans centre-first, with at most 15 windows per visible demand, rather than replaying an unbounded span from its left edge. Wider views emit explicit capacity/partial status. This is bounded raw history, not a coarse aggregate: full seven-/thirty-day overview coverage still requires an aggregate/LOD path.

Identical window/venue demands share one request and one result. A completed obsolete request can populate cache but is delivered only to consumers that still want that window. Supplied resident keys suppress redundant requests and copies. Fresh network results also reach other interested consumers that retained the prior range. The controller merges by original native key/version; it does not replace its history with a network response.

Live polling remains on `/v1/raw-open-interest`, independently of history queue state. Historical loading, partial results and errors have their own events and coverage summaries; they do not mark the live poller unavailable or remove its observations. Source context is explicit on snapshots, so changing between a development fixture and recorder data clears incompatible context while ordinary recorder resubscription preserves data.

## Bounds and failure behaviour

| Resource | Bound |
|---|---:|
| Concurrent historical fetches per worker | 1 |
| Visible raw windows per consumer | 15 |
| Historical consumers | 32 |
| Worker response cache | 16 windows / 8 MiB decoded input bytes |
| Response body | 4 MiB decoded bytes |
| Attempts per retained request key | 3, with 30-second retry spacing |
| Retry bookkeeping | 32 keys; active overflow reports capacity |
| Request deadline | 12 seconds, with actual I/O drain |
| Historical model capacity when enabled | 32,000 native keys / 15 windows |

The normal unselected live cache keeps its original four-hour/2,000-key bounds. Historical copies, conflicts and publications remain subject to the resident-cache rules in [the foundation contract](raw-open-interest-resident-history.md).

Streaming byte limits apply before JSON parsing, including bodies without a length header. UTF-8, exact observations, conflict identities, range/venue scope, catalogue-head identity, publication consistency, partial/truncation flags and bounded per-venue coverage are validated before admission. Missing intervals are checked against the supplied partition ranges. Unknown authority is not replaced with a verified/current claim. No synthetic unit verification, quantity, source epoch or retention metadata is created by the observation validator.

An HTTP 404 stops further automatic network work, while existing cache remains readable by new consumers. Retry budgets stop automatic retries after three attempts. `FeedClient.retryRawOpenInterestHistory(id)` provides explicit retry without clearing chart data; a normal user retry affordance remains a rollout task. Retired idle retry keys can leave the bounded bookkeeping set. Disabling the feature or selecting explicit fixtures clears incompatible worker state. Releasing the final consumer aborts work but preserves completed cache; close drains admitted work, including a response stream that ignores fetch cancellation.

## Coverage and clocks

The gateway's observed/publication-as-of contract retains native `observedAtMs`, source time and exact decimal strings. The client preserves original epochs, gap markers and per-venue publication/partition coverage. Native query time and archive checkpoint/generation remain separate in diagnostics. `sourceAuthorityVerified`, `currentReconciled`, `financialAccepted`, `recoveryQualified` and `retirementAuthorized` remain false.

Per-range partial coverage marks affected projected points partial and creates reset boundaries; it does not change the point quality of unrelated live ranges. Missing data is not zero and a previous level is not extended beyond the incumbent 75-second freshness ceiling. Unit verification still comes from recorder metadata: when unavailable, values stay unverified/unavailable. Archive-only first-load unit proof is not introduced here. Retained publication snapshots are as-of observations, not proof that every later correction was captured.

## Controlled qualification and rollback

For a controlled diagnostics build only:

```sh
VITE_DIAGNOSTICS=1 VITE_DATA_MODE=staging VITE_OI_HISTORY=1 pnpm build
```

The backend must separately expose its disabled-by-default OI route using the private snapshot configuration documented in `iqterminal-server/docs/storage/raw-open-interest.md`. This does not enable source recording, automatic correction resealing, financial acceptance or cleanup. Production deployment still needs separate approval and qualification.

To remove new history demand, rebuild with `VITE_OI_HISTORY=0` and reload the client worker. Existing source data and archives remain intact. The final local build for this increment explicitly restores this disabled selection.

## Evidence and open gates

[Validation evidence](evidence/raw-open-interest-history-client-validation.json) records exact commands, source hashes and limits. Focused tests cover parser refusal, cache/queue limits, shared demand, retries, obsolete responses, cancellation/drain, server-disabled cached reopen, fresh shared results, fixture context and controller coverage. Headless Chromium uses an explicitly installed deterministic staging WebSocket/HTTP transport through the real worker; it proves historical display, no additional request for the loaded window during cached navigation, stable exact records through a 1m-to-5m change and the existing OI/SMA lifecycle regression.

These are functional fixtures, not genuine venue/provider, foreground GPU, p50/p95 or concurrent live ingestion measurements. Real warm gateway/provider qualification, native SQL cancellation/coexistence, original unit-proof availability, source-time correction resealing, overview aggregates, user retry UX and foreground Raspberry Pi acceptance remain open. No claim of complete multi-day coverage or production readiness follows from this increment.

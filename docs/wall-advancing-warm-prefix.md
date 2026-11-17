# Advancing-range cached wall presentation

A cached wall view was keyed by its exact right boundary. A current-ending view
reopened seconds later therefore missed the cache even when its left boundary,
market, profile, settings and cursor fences were unchanged.

The service now looks through its existing maximum of two cache entries for a
compatible same-start prefix. Only an advancing end within one hour qualifies;
changed starts, settings, market/profile or cursor fences do not. Existing
16 MiB per-entry, 32 MiB total, two-replay and 60-second idle bounds remain.
No canonical financial rows are cropped, recomputed or extended by this lookup.

The cached projection retains its original loadedThrough and presentationThrough.
Active wall duration, means and drawn extent stay at that old fence while the
new request independently loads and validates. The requested range is reported
separately, and requestComplete/rangeComplete remain false. Fresh partial
progress cannot advance the cached presentation fence. A fully validated fresh
projection replaces it; changed-end requests cannot use identical-manifest
completion reuse. Current selection remains independently subscribed.

Shared prefix ownership keeps the old cache identity alive while either viewer
uses it. Releasing the last viewer cancels replay, clears its presentation map,
and starts the normal idle expiry. Prefix hits are counted separately as
warmPrefixHits; they are not full-revision reuse or complete-coverage evidence.

Tests exercise both retained-record and compressed caches, a delayed fresh source
proof, exact old and fresh financial output, two consumers, forced expiry while
in use, and cleanup. Negative lookups cover changed left edge, settings, market,
cursor fences, backwards end and excessive extension.

This change does not resolve cold 30h wall loading or default rolling preparation.
Different starts have range-dependent financial semantics and require exact
preparation. A future same-start server extension must preserve full gap replay
semantics as well as event cursor ordering and fresh source proofs. Existing
canonical V5 page authentication cannot be bypassed while claiming those pages
were materialized. The latest five cold-client samples remain failed against the
5-second median target; no acceptance result is inherited from this cache fix.

Rollback is frontend-only: return the isolated preview to its preceding build.
No server deployment, source-retention change or collector restart is required.

Validation on the Pi: the two new advancing-end regressions fail against the
preceding service and pass with this implementation. Focused projection/cache
checks pass, and typecheck passes. The full unit run reports 1,341 passes,
two skips and one unrelated trading-vault timeout at its existing 5-second test
limit; all eight trading-vault tests pass on isolated rerun. That first full run
is retained as a failure, rather than described as an entirely green run.
Raw logs are in artifacts/pi-history-r1/warm-prefix-r1.

Production build a6e253b0663e5829d3078f537ae51e1de0251fca passes with
VITE_DATA_MODE=staging, VITE_HISTORY_TILES=1 and diagnostics enabled. Isolated
loopback4200 preserves the established separate history18880/current18881 proxy
routes. Six native-chart browser regressions pass in headless system Chromium
with SwiftShader. These use explicit test responses and validate saved ranges,
bootstrap independence, price-cache validation and retention; they are not
financial-source or advancing-wall warm latency acceptance. The new wall-prefix
financial/fence checks are deterministic service tests. Five actual-route
advancing-range warm samples and normal foreground Pi UX remain unverified.

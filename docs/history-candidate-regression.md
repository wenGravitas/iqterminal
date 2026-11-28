# History candidate regression and startup status

Validation began against frontend `7f6c37dfa9619be716b293a653b6142345ae8b20`
on shared `dev`, and backend `bd310ed1caefe3717fbcc464affa5baceae6f540`
on `feature/tiered-history-storage`. Experimental environment flags were unset
for the ordinary source suites. No merge into main or live deployment occurred.

## Frontend checks

- Full single-worker Vitest run: 1,767 passed, one expected failure reproducing
  the legacy Canvas blanking path, and four opt-in live checks skipped.
- Typecheck, ordinary build and selected staging build passed. The selected
  build enables tiered CVD, native candle archives, OI history, history tiles and
  diagnostics. This establishes compilation, not configured archive serving.
- All 109 Node script checks and all three Python script checks passed after
  the test-only corrections below.
- Twelve isolated headless browser checks passed: four CVD, three native candle
  archive/revalidation, four wall-worker navigation/capacity, and one compact
  positioning/range-selection check. These use controlled transports and are
  not actual-provider or foreground performance acceptance.
- Shared wall projection source and compatibility metadata match the backend.

## Test-only corrections

The wall compatibility checksum check still expected the profile's old
`aggregation: string` declaration. Existing commit `1dfddf7` had widened only
that declaration to `string | number`. The regression now normalizes exactly
that reviewed annotation and retains the original executable-core checksum;
no financial projector or prepared-format identity changed.

Two development-proxy timing checks initially failed during repository watcher
startup. Warming and disabling dependency discovery did not reliably resolve
it. Disabling repository watching only in these HTTP-only fixtures made all
four dev/preview cases pass with their original one-second thresholds. The
application's Vite watcher and proxy configuration remain unchanged. The full
109-check script run then passed. Original failures remain in the raw run logs.

The initial backend run found storage fixtures selecting test-only catalogue,
archive, socket and process adapters without a test environment. The standard
`test` and `test:storage` commands now explicitly set `NODE_ENV=test`; runtime
and production guards are unchanged. The affected fixtures passed on recheck,
followed by the complete clean backend confirmation reported below.

## Actual data and candidate startup

An offline replay of the existing captured real Binance native candles passed
and removed its temporary archive. It is a captured-data replay, not a live
archive endpoint or provider test.

The bounded SELECT-only recorded-minute staging probe stopped after 19 queries
when ClickHouse refused a query at its existing eight-query concurrency limit.
It cleaned up its temporary archive and observed a clean SSH exit. This probe
failed; it is not actual-history acceptance. Post-probe spot/perpetual collector
health remained live with disk guards unpaused.

The operator confirmed that no private archive-history configuration or
inspected snapshot is configured. The production reader requires private HTTPS
object/witness endpoints, completed inspected snapshot identities and at least
40 GiB reserve. The Pi has about 11 GiB free; the staging host has sufficient
disk headroom but no configured archive resources were found in the checked
locations. Candidate archive startup is blocked on provisioning/configuring that
storage and independently publishing/reconstructing a real-data snapshot.
No paid resources, source retention, collectors or current client configuration
were changed. The existing client at port 5173 continues to use incumbent history.

## Backend checks and evidence

The clean full backend confirmation passed 1884 tests with 7 skips and zero
failures/cancellations. Typecheck, the full backend build and all twelve Python
runner checks passed. Backend application implementations are unchanged; the
test entrypoint correction is committed as `b94fca9b0226a03c5d802823879a40ddfd85665b`.

[Machine-readable evidence](evidence/history-candidate-regression.json) records
source identities, separate check results, original failures, final script
recheck, browser counts, actual-data refusal and raw-log hashes. Raw run logs
remain at `/tmp/iq-candidate-acceptance.lqhTlV` on the controller. The new
committed changes affect test commands/fixtures, the compatibility test and this report;
the tested application/backend source remains as pinned above.

Regression success supports review of the disabled candidate. Actual configured
archive serving, provider/recovery qualification and foreground performance
remain unaccepted; this is not an end-to-end rollout or permission to enable
retention/deletion.

Existing `artifacts/storage-baseline/` captures are preserved as earlier failed
benchmark evidence. They are not passing samples from this validation run.

# Recorded-minute archive client boundary

The client can now validate the backend's version-1 recorded-execution minute
response without converting decimal amounts or UInt64 identifiers to JavaScript
numbers. This is a wire decoder, not a worker subscription or chart integration.
No new request is made by importing it. Existing CVD calculations, anchors and
live polling are unchanged.

`src/feed/recorded-minute-history.ts` accepts the explicit BTCUSDT candle/CVD
namespaces for Binance spot/perpetual and Bybit perpetual. It preserves sparse
rows, OHLC, signed base/quote increments, partition source revisions, original
gaps, failures and publication provenance. Source hashes are pinned to backend
`afcc31c`'s `tradeBarDataset` identities. A changed source contract requires an
explicit client update. Recorded candles are not exchange-native klines.

Admission is bounded to one aligned UTC day, 1,440 output rows, 64 partitions,
4,096 total gaps and 4 MiB of decoded response bytes. Validation rejects
inconsistent coverage, rows outside verified partitions, unsupported source
identities, conflicting scope, invalid exact quantities and promoted authority
flags. Missing minutes are not filled with zeros. Publication generation is
preserved as provenance; it is not treated as a financial revision or a rule
for selecting between conflicting observations.

OI and minute readers share `history-json.ts` for streaming decoded-byte limits,
strict UTF-8/JSON and cancellation drain, and `history-archive-metadata.ts` for
catalogue/gap validation. OI admission, scheduling, cache ownership and retry
rules retain their incumbent behavior.

## CVD integration requirements

The existing native CVD snapshot replaces its retained source window. Archive
minutes must not enter that snapshot/revision path: doing so would allow native
pruning, navigation or cancellation to change an accumulated historical prefix.
The next integration needs a worker-owned contribution ledger and an explicit
stable basis, separate from request generations and archive publication IDs.

The backend now implements separately typed, bounded historical-observation
leases acquired from an independently latest, fully inspected publication, with
opt-in HTTP admission in `498095d`. The client transport and certificate checks
are documented in [recorded-minute sessions](recorded-minute-sessions.md). Holding an existing cohort entry does not provide
this behavior: its reads still require the independently latest witness and
refuse after publication rollover. An expected-checkpoint parameter can reject
mixed pages but cannot make the original page sequence finish. Existing
latest-only recovery and retirement guards must remain intact.

Native CVD currently carries numeric increments and process-local revisions.
Exact combined accumulation also needs a versioned native decimal/incarnation
contract and a stable native/archive ownership boundary. Earlier accepted
contributions may legitimately update the suffix once; eviction, cancelled
requests and native window pruning must not undo accepted contributions. Gaps
must remain explicit and an incomplete anchor must not be labelled complete.
The native exact/incarnation contract and contribution ledger remain
unimplemented; neither this decoder nor the session transport confers them.

## Verification

On the Raspberry Pi checkout:

- `pnpm exec vitest run tests/recorded-minute-history.test.ts tests/raw-open-interest-history-reader.test.ts tests/cvd.test.ts`: **49 passed**.
- `pnpm typecheck`: passed after correcting TypeScript control-flow narrowing.
- Explicit `VITE_DIAGNOSTICS=1 VITE_DATA_MODE=staging VITE_OI_HISTORY=1 pnpm build`: passed.
- Isolated loopback preview on 4187, system Chromium in headless mode:
  `open-interest-history.spec.ts` and `open-interest-sma.spec.ts`: **2 passed**.
  These exercise the actual worker with explicitly selected HTTP/WS fixtures,
  including retained history across navigation/origin outage and hidden source
  ownership. They are regression checks, not Hetzner, foreground paint or live
  ingestion benchmarks.

The final local build restores `VITE_OI_HISTORY=0`. No staging deployment,
retention change, archive transfer, paid provisioning or source deletion is part
of this increment.

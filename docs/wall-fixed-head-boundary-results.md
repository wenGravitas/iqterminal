# Fixed-head boundary and continuation evidence

Frontend7257c8ad972bdfa4ba382fe77d6eec81b704ea49 and backende31db8d776941a25cdc53ad2cefaa9d9ab5c92eb repair the half-open boundary validation. `[from,H+1)` includes the integer-millisecond observation at H. Admission requires `head.at >= to-1`; SQL stays `at < to`, and `confirmedTo` stays H. Existing source scope and partial-coverage reporting remain explicit.

A fresh headless Chromium/WebCrypto prepared-reader probe passes on the committed source, with VITE_DATA_MODE=staging and VITE_HISTORY_TILES=1 explicitly compiled into its deterministic harness. It checks the last same-millisecond update, manifest/part hashes and exact shared-kernel result, including a known gap. It uses no venue or serving endpoint and makes no chart-paint or latency claim. The receipt records the actual source ancestor/build diff and browser155.0.8059.79. Fresh115 focused frontend tests, typecheck and production build pass. Full current frontend-suite acceptance is not claimed; prior full-suite timeout evidence is unresolved.

The retained Nov10 real-canonical reference reads one pinned minute per market through established SQL admission in separate0.5CPU/384MiB containers. Spot112records/16segments/31points and USD-M740records/21segments/63points match the shared-kernel canonical reference exactly. These are not independent raw-book reconstructions. Only the captured progress-row adapter is pinned; canonical SQL and before/after hashes use the real database. The source coverage remains partial at the requested half-open tail and retains observed-book boundaries. No full exchange-depth claim follows.

|Market|Queries|DB read rows|DB read bytes|DB ms incl queue|SQL queue ms|
|---|---:|---:|---:|---:|---:|
|Spot|13|2480906|1146377462|2528|1372|
|USD-M|13|3922969|1494556622|2602|1232|

Queue time overlaps DB duration; do not add them as exclusive phases. These bounded correctness samples expose read amplification and do not establish interactive latency. Both containers exit0, protected service IDs remain unchanged, and serving remains worker13730f7/API71f62d2. The actual executed reference bundle was recovered read-only from staging and its SHA matches the original receipt. Empty placeholders from lost temporary logs are deliberately excluded from the evidence manifest and commit.

The request-clamp experiment is retained only as `eligible-request-withheld.patch`. It is **not applied**. Executable counterexamples show that continuing from a terminal time-filtered global cursor drops an observed wall whose timestamp lies beyond the old interval but whose cursor is below that terminal cursor. Even a quiet-tail continuation changes an exact mean from100.1 to100.10000000000001 because it inserts an integration boundary. Current selected-book equality does not prove historical continuation. Exact extension needs the verified nonterminal prefix and canonical tail replay, with matching left boundary/profile/settings, replay hashes, epoch and coverage. No shifted-start or terminal-accumulator shortcut is accepted.

Neither boundary validator is installed in serving by this check. No wall-loading, warm revisit, current ACK, concurrency, retained heap or foreground Pi gate changes status. The full release stays incomplete. Backend operational semantics are in `docs/wall-history-boundaries.md`; do not restart an old worker against a separately V3-latched root without a verified rollback snapshot.

[Selected raw receipts and runnable probes](../artifacts/pi-history-r1/head-boundary-r1/evidence-sha256.json) identify each preserved artifact and checksum. Browser automation stays headless while i3 workspace routing is unverified.

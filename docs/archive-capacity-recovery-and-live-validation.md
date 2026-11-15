# archive-capacity-recovery-and-live-validation

**FIRST and SECOND real, nonempty extensions VERIFIED:** both avoid whole-prefix canonical preparation and share unchanged selected payloads. Exact financial/coverage equality and ordinary compiled-chart delivery pass. **Release remains BLOCKED**, separately, by fresh-now/normal-route gates below.

## Changes and identity

Fixed budget:15November2026 **10:00:44UTC** start, **11:40:44** experiment cutoff, **12:00:44** deadline. Experiments ended11:16:02; candidate cleanup completed11:19. No prior budget renewed. [Manifest](../artifacts/archive-capacity-recovery-and-live-validation/manifest.json).

Observed/fetched baseline PR1 `38722d962e09628bb886b452e711edf433feed9a`; PR2 `79a72b36a278788f09886207234860d224155bd8`. Tested compiled client **5a09b80039af79051c21310a48d9fe4715f4674e**, isolated gateway/worker **63ce16c5383fb343d2b793a2c404a38f6901abdd**. Documentation tips differ from application builds.

Three supported corrections:

- Staging ClickHouse now6GiB RAM,8GiB total RAM+swap,4.5GiB global protection and bounded caches, persisted in backend compose/XML. Host headroom/commitments were checked before allocation. No restart, merge pause, collector/exchange/retention change or memory-protection disablement.
- Backend `b8be081` fixes a real false continuation rejection when the global archive head changes epoch outside a closed range while its content/anchor remain identical. All old/target source, late-row, gap, boundary and publication validation remains.
- Client `5a09b8` retains walls and validated horizon during bounded same-start historical extensions with followLive=false; the pre-fix regression cleared them. Shifted-start fallback and budgets remain.

The recovered incumbent filled the existing derived cache/queue, correctly pausing the isolated test. The user separately approved a bounded **2.5GiB isolated allowance** at~11:05. Backend `63ce16c` defaults to2GiB and rejects oversized/nonisolated overrides. Both writer reservations, incumbent remaining permitted growth and20GiB disk floor stay accounted. No useful state was deleted. [Backend diagnosis, source identities, exact settings and rollback](https://github.com/wenGravitas/iqterminal-server/blob/integration/pi-history-startup-r1/docs/ARCHIVE-CAPACITY-RECOVERY-AND-LIVE-VALIDATION.md).

## Archive availability and freshness

Five required proofs over10:44:21..10:48:22, ingestion/merging enabled: **540.60,712.24,546.69,707.72,535.71ms**, all successful. Each still reads~435MB. Global tracked memory0.977–1.030GB; collector overflow counters remainUSD-M2/Spot0. A later20s cgroup window has no new max events or OOMs; total5.56–5.65GB includes~1.96GB file cache. Primary-index effective-capacity readback has a documented config/metadata discrepancy; it is not hidden.

USD-M advanced39.32min over4min observation; Spot59.20min. At11:19 cleanup, **Spot is current (~1s lag), USD-M remains12.185h behind and catching up**. The next required retained raw epochs were verified and passed before expiry. Old3% source already outside retained bounds remains explicit and unchanged. Availability is recovered; fresh-now USD-M readiness is not established.

## Two real extensions and equality

Binance USD-M BTCUSDT15m, Top8/side,10%,native. Normal saved visible range pads to30.5h request **1794541500000..1794651300000**. Native Ctrl+wheel advances the same start to **1794653100000**, then **1794654000000**. Both are finite retained-source targets, not fresh-now or empty-tail shortcuts.

| Measure | First | Second |
|---|---:|---:|
| Additional source records |356|327|
| Canonical pages: full reference → continuation |86→0|86→0|
| Unchanged selected payload |85parts /4,465,422B shared;0copied|85parts /4,465,422B shared;0copied|
| Boundary/tail work |1old boundary +1tail page|1old boundary +1tail page|
| Coordinator turns |5|5|
| Measured monotonic step work |10.630s|12.479s|
| Coordinator elapsed estimate, same server process |~11.200s|~13.032s|
| Fresh proof callbacks /time |7 /6.354s|7 /5.825s|
| Total SQL queries /read bytes |24 /3.270GB|24 /3.272GB|
| Exact closed records (+16active each) |46,293|46,338|
| Exact financial/checkpoint/coverage comparison |PASS|PASS|
| Native control→complete painted chart |52.495s|59.588s|

Persisted plans prove the second uses the first publication directly. Neither child has a canonical manifest. Device/inode checks prove every shared payload is shared; counters alone are not substituted. Exact comparisons include selected identities/values/ranks, segments/runs, profile, active entries/order, coverage and all8genuine gaps against unchanged full-fold code71a4798 using identical pinned fences. The recorded stored horizon/request-end semantics remain explicit; no missing data becomes continuous walls.

The first target had36.55min prior intentional capacity/consumer wait; that is preserved separately from its newly enabled11.2s interval. The newly admitted second completes server publication in13.523s from admission. Its clean full-reference invocation took132.141s,271queries,7.214GB read. The first reference was interrupted by an atomic health-temp-file accounting race, then resumed preserved progress (77.02s interrupted +62.39s resumed); it is not a clean latency baseline. A rejected diagnostic upload-hash guard is also retained. No financial mismatch was found. These are sequential bounded observations, not statistical certification.

Source-proof scans dominate much of server continuation; prepared delivery/rendering dominates the remaining observed chart interval. Neither cost is hidden or described as a sub-five-second result.

## Ordinary chart, reopen and current data

Actual Pi/aarch64, headless Chromium155.0.8059.79 Debian12, `--use-angle=gles` (renderer not independently queried). `VITE_DATA_MODE=staging`, history/diagnostics1, truthful5a09build. Route4204→split18990history/18991current SSH→isolated18890gateway/18792worker, protocol5/independent publication1. Existing SSH settings were reused. Only a static worker metadata observer was prefixed; upstream financial responses were never replaced.

Ready-server parent: first historical paint by11.473s, complete available painted history33.290s from navigation. Current walls paint by5.902s. Both native end advances retain prior segments/horizon while pending, then paint the newly validated result. [Second extension screenshot](../artifacts/archive-capacity-recovery-and-live-validation/extension-2.png).

One normal workspace reopen restores the **saved parent viewport**, not the last candle zoom. Warm first paint is5.769s; fresh validation/data completion is sampled~38.5s from the reopen observation start. Completed client-cache attribution is not independently established, and final full paint was still pending at the data-complete sample. This is neither a sub-second cache pass nor proof of restoring the second zoom. [Reopen screenshot](../artifacts/archive-capacity-recovery-and-live-validation/reopen.png).

During186.7s, **252confirmed execution ACKs** advance3525758947→3525760922, longest observed gap3.305s. Current-wall confirmations also advance. No execution stall/reset/timeout was captured. Two separate level-watch1008Invalidcommand closes remain recorded; native-candle release on workspace switch is expected. Historical transport causation remains unresolved, without a new claim of repair.

Backend83focused financial/source/continuation cases +3capacity tests, frontend109focused cases, typechecks/builds and diagnostic syntax/build checks pass. R5 shifted-start fixtures and unaffected earlier footprint checks retain original scope. All harness/pre-fix failures are indexed; no lucky-run certification or protected restart suite.

## Cleanup, decisions and smallest next action

Candidate roles stopped11:18 with exit0/OOMfalse; protocol5 prepared state retained (3ready views, prior paused fallback), zero consumers/readers/pins, no lock. Temporary references/uploads, preview/tunnels and observers are stopped/removed. All35entry service identities/start times and unrelated CPU/RAM settings are unchanged. Incumbent staysf1fb0d6/protocol4/flag0 on18880/18791. Main, production, raw collectors, frozen refs and comparison branch are unchanged. ClickHouse correction remains active. The isolated route is **stopped**, not promoted.

**Archive:** available; Spot fresh, USD-M recovering. **Continuation:** VERIFIED for the stated retained range, both nonempty generations and painted ordinary delivery. **Release:** BLOCKED pending USD-M catch-up and one bounded fresh-current-ending view/reopen on the isolated route, including normal preparation-capacity status. Initial shifted-start opening, delivery latency and existing historical reliability/manual limitations remain; this task does not reopen an indefinite investigation.

Keep draft PRs. The next smallest action is that fresh-now check after catch-up, with source-proof/delivery timings visible. Foreground checking remains manual on **i3workspace9**; no unattended foreground browser. Rollback: stop isolated roles/remove its opt-in, preserving protocol5 state; if retained data exceeds2GiB, remain paused rather than delete it. For ClickHouse, lower global/cache settings first and prove usage below4GiB before shrinking its container; retain the larger allocation if unsafe. Exact operational rollback is in the backend handoff.

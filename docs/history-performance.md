# Historical loading verification

All browser measurements use the actual Raspberry Pi Chromium client, existing
loopback Vite proxy and private SSH staging route. They are not server-only or
fixture timings. The fixed Binance BTCUSDT USD-M standard-feed window is
2026-10-13 07:40–11:40 UTC (1791877200000..1791891600000), five-minute buckets,
$10 rows and $82,910–$84,330 prices. Completion includes both footprint and
heatmap history plus authoritative revision validation. Cached first display is
reported separately. Each final scenario has five samples; median and maximum
are observations, not estimated percentiles.

## Baseline and serving change

The unchanged baseline completed **0/5 full visible windows by 130 seconds after
page opening**. A left-margin clamp omitted five of the 48 heatmap columns.
Four legacy partial-completion indicators appeared at 88.994–98.500 seconds
(median 93.241 seconds); the fifth had not completed. Those indicators were not
complete visible history. Configuration itself took 6.944–11.082 seconds, so these
page-open baseline values must not be compared as identical timer boundaries to
the new viewport-start measurements.

The baseline opened approximately 51 footprint pages (about 25 hours) and 14
heatmap replay fragments for a four-hour view. Prepared history now uses bounded
indexed manifests/payloads and canonical closed footprints. The materializer
processes depth once, continuously, with persisted progress. Normal prepared
openings perform no raw depth reconstruction. Two identical panels share their
visible requests. A short live footprint bootstrap still establishes the stream
cursor; it is counted separately from the visible historical requests.

## Remaining limits

The cold five-second target has not been consistently achieved on this private
Pi route. Optimizations already measured include viewport scheduling, prepared
storage, indexed revision reads, inline clipped edge tiles, compressed Float64
transport, asynchronous individual-tile caching, coalesced cache touches and
forming-only refresh. Failed encodings that increased payload or latency were
removed. Increasing raw-replay parallelism or memory ceilings was not the remedy.

Current-view outliers include long time-to-first-byte despite short server-local
query durations. Private transport and local proxy waiting have not been fully
separated; these observations do not establish either as the sole cause. Server
and client clocks are never subtracted to manufacture a duration. First-use work
still requires an actual bounded reconstruction and takes minutes; its pending
state is not counted as completed history.

Coverage is access to recorded depth, not a deeper complete Binance snapshot.
Partial outer rows, unknown cells, sequence boundaries and RPI exclusion remain
explicit. Corrections to canonical source require the documented explicit
re-materialization command. Raw retention and supported configurations are
preserved; uncommon configurations use bounded, persisted direct accumulation.

## Reproduction and evidence

See [HISTORY-TILES.md](HISTORY-TILES.md) for exact local benchmark commands and
[../artifacts/history-tiles/](../artifacts/history-tiles/) for retained JSON evidence.
The staging counterpart documents migrations, named tmux jobs, service commands,
corrections, resource budgets and safe fallback. First-use trials evict only the
fixed benchmark's regenerable derived entries after backup; they never delete raw
history. Restart proof restarts only the materializer and verifies collector
identity/continuity, recovered progress, exact replay parity and stable revisions.

## October 13 comparable series

Each row is five successful loads. Times below start when the benchmark selects
the requested viewport, after native chart setup. Bytes are compressed visible
history response bodies; request counts exclude the independent live bootstrap.

| Scenario | First heatmap median / worst | Complete and validated median / worst | Median requests / bytes |
| --- | ---: | ---: | ---: |
| A: empty client, prepared server | 5.774 / 7.119 s | 5.935 / 7.247 s | 2 / 230,380 |
| B: warm client, revision validation | 0.532 / 0.641 s | 2.182 / 3.978 s | 2 / 5,268 |
| C: absent derived history, actual rebuild | 13.630 / 17.059 s | 272.340 / 273.210 s | 113 / 340,367 |
| D: $50k–$150k, $1k rows, two panels | 3.113 / 6.231 s | 3.324 / 6.446 s | 2 / 96,578 |
| E: current four hours, forming bucket | 4.880 / 21.256 s | 5.007 / 21.372 s | 3 / 234,611 |

The warm-display target passed all five; the cold completion target was missed.
A representative cold sample measured 197ms cache read, 399ms cache write, 44ms
wire decode and 86ms merge, with about 3.0s header wait and 3.1s transfer. A warm
sample read cache in 175ms, decoded validation in 0.8ms and reused all closed tiles
without a tile read. Full per-sample server-local admission/DB/decode/project/
serialization and client apply/heap metrics are in `release-complete-summary.json`.
The current worst sample waited 16–17s for headers despite 28ms footprint and 302ms
heatmap server processing. No prepared sample used the legacy raw heatmap path.

The five C trials preceded only the final client live-boundary/reconnect guards
and backend calculation-identity guards. Those guards do not alter fixed closed
statistics or the build algorithm. C is retained as the valid first-use series;
normal raw retention has since expired for that fixed source window. The eviction
helper now refuses that expired window instead of discarding usable prepared data.

## Correctness, coverage and resource evidence

- Client: 236 tests, typecheck and production build pass. Tests cover shared request
  references/cancellation, viewport generations, revision replacement, cache
  boundaries/eviction, forming rollover/reconnect and footprint replay overlap.
- Backend: 48 tests and typecheck pass, including 324 deterministic differential
  comparisons, atomic simultaneous coarse peaks, integer integrals, fractional
  row boundaries, zero/unknown/partial/gap/epoch behavior, duplicate input,
  persisted accumulator resume and failed-publication journal recovery.
- Eight real quiet/active five-minute comparisons at $10/$25/$100/$1,000 match
  legacy replay cells exactly, including quote units, peaks, durations and epochs.
  Prepared server reads 15.3–29.5ms versus reference 1.84–3.01s are separate evidence,
  not substituted for Pi timings. An additional 15-minute/$19 comparison after an
  actual materializer restart matched 85 cells and retained its revision on retry.
- Canonical SQL fixture:two overlapping execution batches remain two canonical
  rows; correction replaces volume with 7 instead of adding it. Source tables were
  untouched. Four admitted tile reads succeed; eight concurrent excess reads get
  503/Retry-After 1; an oversized request gets 400.
- Wide inventory: 48 buckets, 4,800 projected cells, positive recorded prices
  $50,000–$148,000. Snapshot bid floors range $83,007.6–$83,543.8 and ask ceilings
  $83,265.4–$83,810.2. There are 3,895 positive partial cells, 3,165 known-zero bid
  cells and 838 unknown ask cells. No $1,000 row is fully observed on both sides
  across the whole bucket. Two continuity epochs remain explicit.
- During 480 server samples over 43 minutes, materialized depth age was 720.5ms
  median/1,586ms maximum, execution age 730ms/4,097ms, sampled cursor lag 0, and both
  collector overflow counters 0. Materializer sampled RSS peaked 270.9MB; gateway
  sampled RSS 128.3MB. Health's lifetime peak RSS was 283.1MB/150.7MB respectively.
  Derived storage grew 108.1MB→173.1MB during repeated rebuilds; raw history was
  2.03–2.49GB. This remains far below the documented project/derived budgets.

The migration is additive and was successfully reapplied. Publication acknowledges
payload storage before manifest publication, journals drained closed buckets before
checkpoint advancement and hashes content for idempotent revisions. Restart tests
preserved collector ID. Routine rollout now verifies readiness and asserts that
collector ID/start time remain unchanged. Services use existing Compose supervision;
all data listeners remain loopback-only. No pushes or source-history deletion were
performed by this goal.

## October 16 final-source repeat

All four repeated scenarios completed five of five loads. The current scenario
uses the same $1,420 span centered on live price, with actual bounds recorded per
sample; the previous off-price trial is excluded. The Pi had other workloads
running (sampled load average 6.10, swap use 1.7GiB). These are current-condition
observations, not a controlled claim that the small correctness guards doubled
latency. The earlier series is retained separately.

| Scenario | First heatmap median / worst | Complete median / worst | Median requests / bytes | Max sampled JS heap |
| --- | ---: | ---: | ---: | ---: |
| fixed | 12.131 / 14.379 s | 12.323 / 14.798 s | 2 / 230,371 | 31.1 MiB |
| warm | 0.635 / 1.748 s | 2.225 / 3.149 s | 2 / 5,257 | 38.7 MiB |
| wide | 4.945 / 7.002 s | 5.281 / 7.158 s | 2 / 96,579 | 37.5 MiB |
| current | 11.107 / 12.613 s | 11.222 / 12.744 s | 3 / 223,449 | 47.5 MiB |

The cold target remains missed. Warm first meaningful display is sub-second at
the median, but its worst sample also misses the target. There are no hidden
raw-depth replays or heap-exhaustion retries on these prepared-history trials.
A final cold sample spent 225ms in staging processing, 3.8s waiting for headers and
8.6s transferring 203,879 compressed heatmap bytes. Client decode was 131ms, merge 58ms
and cache writes 693ms. The unisolated transport/proxy wait dominates that sample.

Each current trial held the live chart open 15s after completion. It issued 5–8
forming-only reads during that hold, with no repeated closed-history reads unless
a revision interval or bucket boundary required them. Legacy heatmap requests: 0.
Sampled final execution-delivery ages were 154–1553ms. These
client-reported ages are operational indicators; cross-host clock subtraction is
not used as a server processing benchmark.

At final service inspection, derived tables used 403.2MB and durable
materializer checkpoints 12.8MB; source data used 4.17GB, with
225.0GB free. Backlog was empty. Collector, API, materializer, ClickHouse
and Level Watch were healthy under restart-unless-stopped supervision. Their
inspected collector/API/materializer cgroups reported zero OOM/kill events.
Collector has not restarted since the intentional October 13 split. Local Vite
and the existing private SSH tunnel are running; benchmark browsers exit cleanly.

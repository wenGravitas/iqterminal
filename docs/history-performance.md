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

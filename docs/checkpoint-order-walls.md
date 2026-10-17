# Order Walls implementation checkpoint

Status: implementation and bounded staging validation are complete. Corrected
cold/warm staging cases completed on frozen sources for Order Walls with
candles, Heatmap, and both overlays. A focused 70.155-second live continuity
check after pan and rollover completed with no observed geometry clear. The
combined rollover briefly reported a 659 ms unconfirmed tail; that is an honest
coverage state, not evidence of a geometry clear. The bounded raw-observation
API is deployed on staging and the client has separate current-live and
historical replay lanes. The transport-tuned source passes all 298 tests in 42
files and
`pnpm build` (`tsc --noEmit` plus Vite); the existing main-chunk size warning
remains. The controlled Pi fixture matrix is documented separately and is not
live venue evidence.

## Source and temporal model

Prepared heatmap tiles contain bucket aggregates and cannot recover observed
wall crossings. The staging gateway's additive
`GET /market-data/v1/depth-observations` endpoint returns a bounded checkpoint
seed and cursor-ordered raw depth observations at collector receive time. It
captures a fixed cursor watermark, includes pre-window deltas needed to rebuild
the book at the viewport boundary, and closes same-millisecond groups before
pagination continues. The USD-M raw feed identity is
`usd-m-standard-diff-depth-rpi-excluded`; the client validates it through
`depthSource(market)`, not the prepared-history manifest name. Gaps, retention
loss, incomplete book scope, and capacity limits are coverage states; none is a
zero-liquidity event. See the
[backend checkpoint](checkpoint-order-walls-backend.md) and its linked
[live API evidence](../artifacts/order-walls/backend-live-api.json),
[container change record](../artifacts/order-walls/backend-container-changes.json),
[before identities](../artifacts/order-walls/backend-containers-before.json), and
[after identities](../artifacts/order-walls/backend-containers-after.json).

The staging client requests 256 observations per API page. Its current-head
bootstrap asks only for `[head.at, head.at + 1 ms)`; the gateway supplies the
nearest checkpoint and the intervening pre-window deltas needed to rebuild the
book at that head. A focused replay test confirms this retains the original
wall start when a pre-window delta crosses the threshold. The client keeps its
20-second per-request timeout; no server, collector, or socket behavior changed.

For staging replay, the worker intentionally runs two detector lanes. The
historical lane pages the requested immutable range at a fixed watermark and
is the canonical timeline. In parallel, the live lane bootstraps from the
durable depth head and catches up independently, so an active wall can appear
while older pages are still loading. That line is marked provisional until
the historical lane has replayed and caught up through the head; canonical
history then replaces/reconciles the provisional snapshot and segment IDs.
An offscreen historical viewport does not follow the current head. Both lanes
use the existing worker-owned head stream shared with Heatmap; Order Walls
opens no additional staging socket. Direct Binance USD-M mode observes the
existing `BinanceDepthService` book and is live-only, without retained replay.
Binance Spot uses the staging replay API. Hyperliquid remains explicitly
unsupported because there is no retained BTC L2 source.

Small forward moves of a live chart viewport update public coverage against
the new viewport while preserving the fixed canonical replay range and segment
IDs. Pans and zoom-outs that no longer overlap the live window start a new
bounded replay. The observer subscribes to the existing staging depth-head
stream shared with Heatmap; it adds no socket.

The detector applies absolute level replacements in cursor order. Same-epoch
checkpoints reconcile the book without fragmenting otherwise continuous walls;
a sequence gap or new epoch censors active segments at their last confirmed
observation until a replacement seed arrives. Exact quote notional is
`price * quantity`, aggregated by side and bucket. Relative mode uses the
positive per-observation book-wide bucket distribution plus the configured
USD floor; absolute mode defaults to $500,000. Entry and exit thresholds are
hysteretic, and confirmation defaults to zero so brief observed walls remain
visible. Seed-present walls have an unknown earlier start and are labeled
“Observed since”; censoring is never presented as a confirmed removal.

## Resolution and historical values

The saved aggregation setting remains `Auto` when automatic resolution is
selected. For each chart viewport, the client computes a resolved quote-price
width from the visible price span, plot height, and venue tick size. It chooses
a stable 1/2/5 increment targeting roughly 12 CSS pixels per bucket, with the
exchange tick as the minimum. That resolved width is sent to the detector and
status, then reused by the chart band and hit test. Zooming can therefore
change the effective width without silently replacing the saved `Auto`
setting; manual $10, $50, $100, and $250 widths remain explicit options.

Each segment carries bounded `valueRuns`: timestamped observed notional and
percentile samples, coalesced while both values are unchanged. The renderer
draws piecewise-constant time runs rather than coloring a whole segment from
its latest value. A hit maps the pointer to chart time and the tooltip looks up
the exact historical run at that time. The peak and time-weighted mean remain
summary fields only. Worker and renderer histories are bounded to 50,000
points globally and 2,048 per segment; if the cursor precedes retained value
history, the tooltip reports the value as unavailable rather than substituting
the mean or latest value.

## Rendering and validation

The native OpenAlgo primitive draws cached 2px horizontal bands at 85% opacity
with restrained heat or bid/ask colors. It adds no fill, glow, labels, or axis
content. Historical event timestamps use fractional chart indices, independent
of candle boundaries. Live updates patch affected segments; viewport changes
reproject visible geometry. Book state is capped at 5,000 retained levels per
side and reports whether either side is incomplete. The staging client clips a
single replay request to four hours and the source reports its actual retention
boundary; neither limit implies full-market depth.

| Area | Current state |
|---|---|
| Native indicator settings, add/remove and chart lifecycle | Implemented; focused UI and tooltip checks exist. |
| Raw Spot and USD-M staging source | Deployed and smoke-tested for both market identities; two-page sample evidence is linked above. |
| Live-first / canonical-history merge | Implemented; focused lifecycle acceptance covers delayed pages and promotion. |
| Detection, Auto resolution, value runs, and custom primitive | Implemented; captured 12-minute live page matches the full-scan oracle (14 patches / 14 segments). Detector CPU fell from 7,820 ms to 1,001–1,050 ms and wall time from 7,599 ms to 628–660 ms. The transport-tuned source passes `pnpm test` (42 files / 298 tests) and `pnpm build` (`tsc --noEmit` plus Vite; existing >500 kB main chunk warning). |
| Actual staging chart with a visible wall | Final frozen-source combined case completed cold and warm canonical promotion and a rollover. At the rollover, generation 8 promoted idle at cursor=watermark `4517171`; 136 mounted segments / 2,409 drawables remained, with live updates reporting 134 segments / 2,821–2,822 drawables. The viewport tail was 659 ms ahead of the latest confirmed time, so status correctly remained stale/partial until the source confirms that interval. A focused 70.155-second follow-up after pan and another rollover recorded 25 patch batches, 19 segment IDs added, zero removed, and no snapshots. The only zero-visible sample was an intentional 0.8-span offscreen position: two segments remained retained and returned immediately after panning back; no zero occurred after the pan. Final live status was complete/non-partial and provisional while canonical replay was pending. This is bounded continuity evidence, not a sub-frame guarantee or a full four-case live-matrix claim. |
| Raspberry Pi performance comparison | Controlled fixture validation is documented in `order-walls-performance.md`; it does not establish live-venue rendering or 60fps. `artifacts/order-walls/staging-pi.json` records an earlier failed cold attempt that closed before source requests and has no performance result. |

The 2026-10-17 live browser capture used one headless Chromium context with no
fixtures, Binance USD-M 1m, default relative p95 / $250,000 floor / Auto
settings, and an initial 12-minute viewport. All 154 observed depth API
responses were HTTP 200; the worker recorded 160 pages, 23,676 observations,
5,561,990 bytes, two cache hits, and one replay failure after Auto re-resolution.
The canonical fixed-watermark replay reached its watermark after about 81
seconds. At rollover the candle advanced from `1792252680000` to
`1792252740000`; latest confirmed wall time was `1792252741881`, beyond the
viewport tail `1792252740492`. Artifacts are
[`staging-live-positive-proof.json`](../artifacts/order-walls/staging-live-positive-proof.json)
and [`staging-live-positive-proof.png`](../artifacts/order-walls/staging-live-positive-proof.png).
The browser diagnostic reported 19,345 drawables, p95 16.3 ms, and max 156 ms
on headless SwiftShader; these host-only values are not target-device
performance evidence.

The capture's stale tail reason was `Durable depth watermark has not confirmed
the requested tail`. API v1 can set `partial=true` for expired or invalid
starts, gaps, truncated gaps, or an unconfirmed requested tail. The client now
removes only that exact tail marker from sticky page coverage and derives
current tail status from `viewport.to > confirmedTo + 1 ms`: the API's
`confirmedTo` is inclusive while the viewport end is exclusive. Gaps,
retained-start failures, and other partial reasons remain incomplete. Focused
regression tests cover later tail confirmation, the `head.at + 1 ms` complete /
`head.at + 2 ms` pending boundary, and ensure a real coverage gap remains a gap.

## Final frozen-source staging cases

The combined candles + Order Walls + Heatmap run completed both cold and warm
canonical histories and observed a candle rollover. Order Walls reached its
first visible data in 11.665 seconds cold and 5.872 seconds warm, then canonical
promotion in 163.737 seconds cold and 50.485 seconds warm. The warm replay
recorded four prefix-cache hits. Heatmap reached first visible data in 3.202
seconds cold and 0.982 seconds warm, with complete status at 9.110 seconds cold
and 19.925 seconds warm. See
[`staging-both-final-source.json`](../artifacts/order-walls/staging-both-final-source.json).

The separate bounded continuity probe ran for 70.155 seconds after pan and
through a candle rollover 35.15 seconds into the run. It observed 25 incremental
patch batches, 19 segment IDs added, zero removed, and no snapshots. The only
zero-visible sample occurred at the deliberate 0.8-span offscreen position;
two segments remained retained and reappeared immediately after panning back,
with no zero-visible sample after that pan. The final live state was complete
and non-partial but still provisional while cold canonical replay remained
pending. See
[`staging-continuity-probe.json`](../artifacts/order-walls/staging-continuity-probe.json),
[before](../artifacts/order-walls/staging-continuity-before.png), and
[after](../artifacts/order-walls/staging-continuity-after.png).

In the separate Heatmap case, canonical completion took 41.177 seconds cold and
29.622 seconds warm; first visible data appeared at 5.152 and 2.395 seconds.
The standalone Order Walls warm attach promoted in 39.929 seconds, reached
first visible data in 5.340 seconds, and recorded two overlapping-prefix cache
hits. Its artifact's post-warm harness error means its cold terminal time was
not retained, so it is not reported as a complete cold/warm pair. These are
measured history-promotion timings, not frame-rate claims. Source/runtime and
viewport guards remained stable. The bounded continuity check does not
establish an absolute sub-frame delivery guarantee or replace a full four-case
live matrix. Fixture Pi timing remains separate from these live staging
measurements.

The live API smoke evidence is bounded to one 60-second request per market,
two pages each, and verifies a stable watermark, checkpoint seed, isolated
feed identity, ordered continuation, and zero reported gaps for those sampled
windows. Its first response was approximately 231 KB for Perpetual and 513 KB
for Spot, which is material history-fetch cost and must be reported separately
from sparse renderer cost. It does not establish complete historical coverage,
wall visibility in the browser, or frame-rate acceptance. Fixture Pi images and
metrics validate controlled rendering only; they are not exchange-connectivity
or live-data evidence. See the
[recorded Pi fixture run](../artifacts/order-walls/fixture-pi-controlled.json)
and [staging attempt](../artifacts/order-walls/staging-pi.json) for those
boundaries.

A separate read-only staging transport probe explains why the earlier 1,000
observation request was not a useful browser load bound. That response contained
1,171 observations and 5,000 seed levels per side (528,642 bytes compressed,
3,107,563 bytes decoded): 30.96 seconds at the client while server processing
took 2.86 seconds. This is about 17 KB/s end-to-end transfer for that sample,
and the client has a 20-second request timeout. With the new 256 limit, a
canonical 12-minute first page returned 278 observations in 120 KB and took
3.48 seconds at the client / 0.617 seconds server-side. A current-head bootstrap
at `[head.at, head.at + 1 ms)` returned the seed plus 244 warmup observations,
with no continuation page, in 146 KB and took 11.46 seconds at the client /
0.893 seconds server-side. These are bounded single-request samples, not a
guarantee for every page or network condition. Tailscale RTT was about 1.5
seconds with retransmissions and a congestion window of two; Wi-Fi signal was
strong. Those observations do not isolate a cause for the path throughput or
attribute it to Pi CPU, Wi-Fi, or server load.

## Operational limits

The backend smoke changed only the history gateway application container;
the remaining six containers retained their identities. The before/after
identity artifacts and staging recovery details are recorded in the backend
checkpoint. No backend migration or new collector was introduced. A healthy
endpoint and passing deterministic checks are not, by themselves, evidence of
an accepted live chart or Raspberry Pi performance. Keep fixture, staging
source, and target-device evidence separate in any final acceptance report.

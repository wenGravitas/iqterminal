# Pi wall receive-ahead results

Client `87e46367e28bec68c4d310b8bb5e42f22b640767` separates bounded network
receipt from member decoding. API remains
`dca1bb8aca42fda653a003f4bd1bb9a9b6c7cb51`; no backend rollout occurred.
The production staging/prepared/diagnostics bundle is verified byte-for-byte
through the existing localhost4187 preview. Both SSH forwards and the proxy
configuration are unchanged. The seven protected collector/materializer/admission
identities and start times match before and after; health is caught up with no
reported error/backlog. The unrelated failed maintenance units are untouched.

## Mechanism and correctness

Holding the first member's hash against a zero-prefetch stream proves that the
old serial loop receives only one frame. The candidate receives all remaining
bytes while the hash is held and keeps its shared history admission. That
counterfactual fails on the old source; all93 focused history tests pass on the
candidate. Typecheck and the production build pass (existing bundle-size warning).
The helper's fixed buffer stays within the existing8MiB batch cap. No concurrency,
source, financial detail or coverage limit changes.

Earlier member hashes, progressive publication, exact canonical restoration,
terminal EOF, explicit failed tails, shared cancellation and reader-lock cleanup
remain tested. [Contracts and rollback](wall-batch-receive.md).

## Five real chart samples per scenario

Actual Raspberry Pi headless Chromium, empty browser contexts over already
prepared server history, identical pinned30h windows and references, Top8 per
side/10%/native. All ten runs paint exact full coverage and pass environment,
revision, source and native-slot checks. Screenshots, every request, browser
configuration and local CPU/swap/frame/heap samples are retained. Headless
results do not establish normal foreground Pi UX.

|Case|First useful history ms, runs1–5|Median / maximum ms|Complete ms, runs1–5|Median / maximum ms|Acceptance|
|---|---|---|---|---|---|
|Spot5m|3800.0,4516.4,9090.6,5106.3,5550.6|5106.3 /9090.6|6952.0,8054.4,9090.6,6976.0,6634.8|6976.0 /9090.6|FAIL|
|USD-M15m|3092.6,3617.7,3680.3,7174.5,3629.9|3629.9 /7174.5|10543.6,11434.7,11890.7,16304.1,10351.1|11434.7 /16304.1|FAIL|

First-useful maximum must remain<=3s; complete median<=5s and maximum<=10s.
Spot now meets the maximum completion target in this cohort, but misses median
and first history. USD-M misses all three. No target, viewport, decoded detail or
eligible range was reduced. No loading p95 is reported.

The previous2bc cohort completed at median10.62s/max22.36s Spot and
16.17s/17.09s USD-M. The new results are lower, but these sequential cohorts
are not a controlled alternating application A/B; source/network/client
conditions can differ. The test establishes independent receipt, not an exact
causal loading speedup. The bounded change is retained with that limitation.

Spot retains8293segments/49154values/360native slots and35explicit gaps;
USD-M23850/104112/120 and47gaps. Source tokens match the independent references:
Spot `d211a7666f7c1231a2deaaea305e82b27f69536628244a72fb4e516bd621e394`,
USD-M `96b070b7571b23df67826ad0c2d0364f8e891205f5d1115ee79932b96333a70e`.
Requested window is1793696400000..1793804400000, with unchanged validated padded
source ranges. Actual missing source remains explicit rather than continuous walls.

## Timing and evidence boundaries

`phase-evidence.json` retains per-run request timings/bytes, worker decoding,
main application, painted revisions, long tasks and retained heap. Body-read
metrics on the new receiver mean waiting for the next member's bytes; they do
not represent an independent total transfer phase. Fetch timing remains the
response EOF observation. Nested queue/header/server/decode/yield/render times
overlap and cannot be summed as exclusive phases or used as pure CPU time.
Cross-host timestamps are not subtracted.

Both bounded server observers have terminal end records:17Spot and19USD-M
samples, no observer errors. They record server health/resources, not live-feed
confirmation continuity. Both benchmark handles exited normally. Final i3
inventory shows zero visible test windows. No unrelated user browser was closed.

Raw evidence: `artifacts/pi-history-r1/wall-receive-ahead-r1/` and
`receive87e-dca-{spot,perp}-r1-*`. Immutable input and exact-source references
remain linked through the existing strict loading gate. Tests and raw old-source
counterfactual are retained separately from genuine chart measurements.

The overall release remains incomplete: wall loading, current latency and
confirmation under concurrent history, warm-wall completion, repeated-use
memory/interaction plateau, default rolling-window composition/live-tail
handoff, and foreground validation still need work. Footprint passes remain
scoped to their earlier tested builds; this wall cohort does not recertify them.

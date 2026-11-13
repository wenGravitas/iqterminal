# Footprint canvas font work

The8aa main-thread profile during two historical footprint loads attributes
about2.12ssampled self time to the canvas proxy setter,0.87sto text measurement,
and substantial fill/column work. A current-only profile is separate. Profiles
include observer/scheduling overhead and sampled wall time is not exclusive CPU
time or an unprofiled responsiveness result.

The rejected candidate built the native/mapped font strings once per draw, updates its
cell-text phase only on actual font writes, and skips identical native font
assignments within that synchronous draw. A new draw epoch forces fresh state;
proxy restore invalidates it. External context changes between draws are thus
respected. The wrapper's own isolated save/restore blocks do not change fonts.
No cell, number, color, coordinate, statistic, source, units or data budget changes.
Only two strings per primitive/context are retained; no extra product canvas,
worker, timer or queue is introduced.

The first getter-based trial repeatedly read the normalized native CSS font and
had mixed timings. It was replaced, with raw evidence retained. The first offline
harness also supplied aggregate counts as native individual-trade counts and
read pixels directly from drawing canvases. Those experimental limitations are
retained and corrected in later runs; they do not certify product financial or
loading behavior.

The final offline harness uses the incumbent unit projection, omits individual
trade counts, and reads pixels through a separate observer canvas so the primary
drawing contexts retain their default backend. Five alternating pairs across
16scenes preserve exact RGBA pixels and statistics. Font writes fall333/561→2in
full views. Draw timings remain mixed and are not an established whole-app gain.
All samples/warmups/flush times are retained. Native-write counts are measured in
a separate untimed pass to avoid biasing timing. This is headless actual-Pi
Canvas evidence, not normal foreground, FPS, history-loading or current acceptance.

Five alternating production-build pairs then compared control8aaab36 with
candidatec170b4b over the same pinned4h5m/24h1h windows. Within each child,
current-only precedes concurrent history; build order alternates between rounds.
There were20attempts,18completed observation intervals. Control round2 failed
preflight with two12shealth timeouts, before an execution baseline was recorded.
Candidate round4 completed its observation but its subsequent derived-health read
also timed out. Control round5 failed
before observation: the HTTP snapshot claimed live without execution delivery.
That failed attempt remains in the raw cohort, with no finite-subset median.
The separate bootstrap status fix54d080b addresses the false claim; it does not
establish the transport cause or turn that attempt into a pass.

Concurrent receive-gap maxima, control/candidate milliseconds, by round:
4601.8/1551.9,1085.7/1047.5,856.5/995.7,3595.0/8403.9,1292.1/2684.4.
Concurrent page long-task maxima:651/572,366/356,588/691,301/681,594/480.
This is mixed evidence, with no dependable whole-app responsiveness gain. The
font optimization and its trial-only test were reverted in1e332e7. Incumbent
financial/presentation tests remain. No backend, source, retention, cursor or
socket operation was required. No font optimization ships in038b0b4.

Raw profiles/offline scenes and all attempted production observations remain in
`artifacts/pi-history-r1/foot-main-8aa-r1`, `foot-font-r1`, `foot-font-r2`,
`foot-font-r3`, `foot-font-app-pairs-r1` and `font-app-r1-*`.
Resource observers cover two bounded windows with a gap, rather than the entire
cohort continuously. Per-attempt host before/after samples remain. The owned
control preview was stopped after comparison; context-close EPIPE messages were
observed in its console and are not proof of healthy current delivery.

The offline experiment can be replayed explicitly after the source revert:

```sh
IQ_FOOT_FONT_BENCH=1 \
IQ_FOOT_FONT_CANDIDATE=artifacts/pi-history-r1/foot-font-r3/candidate.ts \
node scripts/footprint-font-bench.mjs /tmp/iq-font-replay-new-directory
```

The default control ref is pinned8aaab36; `IQ_FOOT_FONT_CONTROL` overrides it.
The selected source and hashes are copied to every new output directory. This
replays the rejected experiment; it is not a product performance gate.

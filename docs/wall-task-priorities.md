# Visible wall work and optional cache preparation

The feed-worker profile on client87e identifies work in prepared batch parse/hash,
projection assembly, checkpoint validation and optional compact-cache encoding.
The sampled worker spends10.59s idle over21.72s; sampled compact encoder/stream
self time is about1.07s. Sampling adds substantial overhead (this one chart
completes at21.47s), so it is diagnostic evidence rather than latency acceptance.
The exact sampled bundle, call-frame offsets, profiles and raw sample are retained
in `artifacts/pi-history-r1/wall-worker-profile-r1/` and `profile87e-dca-perp-r1-*`.
Idle samples do not alone prove a scheduling bottleneck.

Source inspection shows a priority inversion: visible decode/import resumes with
explicit background postTask, while optional compact preparation resumes with
ordinary timers. Optional encoding can therefore compete ahead of visible
history, especially when another chart is still loading. The candidate makes
these priorities explicit:

|Work|Continuation|
|---|---|
|Visible prepared member decoding and projection import|user-visible postTask|
|Visible cached presentation replay|user-visible postTask|
|Optional compact-cache encoding, including its initial start|background postTask|

Current/input tasks can run between bounded visible slices. History never asks
for user-blocking priority. Existing8ms/256-point checkpoints, stream/payload and
retention bounds, shared admission and consumer cancellation stay in force.
This is ordinary visible priority, not a guarantee of latency or a strict bound
on native JSON/GC work. Platforms without the native scheduler retain the
cancellable timer fallback; that fallback cannot implement priority separation.

Diagnostics expose both `historyTaskYield` and `historyBackgroundYield` so the
measured path is verified. The benchmark accepts an explicit expected mode;
worker CPU sampling is separately opt-in and must not certify loading gates.
Financial code/core hashes, canonical hashes, revisions and source coverage are
unchanged. No extra worker, request lane, exchange connection or server change.

Tests check priority selection, signal/reason propagation, cancellation before
optional serialization begins, exact cached replay and the existing canonical
prepared-history suites. Actual headless Pi cohorts must still establish loading
behavior. Current confirmation, concurrency and foreground UX remain separate
acceptance gates.

Rollback: return the three visible continuation call sites to background priority
and compact presentation to its prior timers, then rebuild the client. No source
rewrite, backend deployment, live socket restart or cursor reset is needed.

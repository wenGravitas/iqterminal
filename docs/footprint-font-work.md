# Footprint canvas font work

The8aa main-thread profile during two historical footprint loads attributes
about2.12ssampled self time to the canvas proxy setter,0.87sto text measurement,
and substantial fill/column work. A current-only profile is separate. Profiles
include observer/scheduling overhead and sampled wall time is not exclusive CPU
time or an unprofiled responsiveness result.

The candidate builds the native/mapped font strings once per draw, updates its
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

Focused tests cover native font normalization, restore, external writes between
draws, DPR/font fitting, POC/VA geometry, opacity and text readability. Production
route validation must determine whether the candidate is retained. Rollback is
the font setup/epoch change alone; no backend, source, retention, cursor or socket
reset is needed.

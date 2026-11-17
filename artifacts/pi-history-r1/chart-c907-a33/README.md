# Full native Pi Order Walls chart cohorts

Production client c9073e49f2e85becd8011c753d5935ac75ba2040, then
f602673 (full source in each sample/environment diagnostic). Backend isolated
gateway a33b01ca3f50023e9b67c6ed56919b161471bc28, while incumbent18579d9 supplies
current/health via its independent SSH lane. Actual route map is in
preview-routes.json. The packaged gateway has read-only state,512MiB/oneCPU;
its293tests/type/build/image/identity/resource/stop receipts are in backend
chart-gateway-a33/. Incumbent API/collectors were not replaced or restarted.

Tests use native Chromium155 normal GLES launch on Pi arm64,1920x1080, empty
browser contexts over already-prepared server history, no Fit Walls substitute.
Actual chart renderer is Canvas2D; no GPU/FPS claim is made. Windows stay on i3
workspace9. Every sample verifies staging mode/history1/clientSHA, pinned source
revision, exact segment/value/gap counts, no capacity flags, and latest input
revision painted. Full requested window remains1793696400000..1793804400000.
The Spot padded source window is1793696100000..1793804700000; USD-M is
1793695500000..1793805300000. Preflight discovery JSON preserves actual manifests
and source proof. A wrong manually guessed USD-M feed slug first returned400;
it was corrected to the exact existing profile contract before any cohort.

All raw artifacts are siblings named chart-c907-a33-*-samples.jsonl,
*-observations.jsonl, frozen executed/trace scripts and per-run screenshots;
post-fix files are chart-f602-a33-spot-*. summary.json derives these tables.
No p95 is reported from five loading runs. Deadlines/ranges/assertions stay fixed.

| Cohort | First useful history, all five (ms) | Complete validated paint, all five (ms) | Result |
| --- | --- | --- | --- |
| c907 Spot |3484.9,6280.1,6692.8,6688,6764|5473.3,7280.5,7693,7682.6,6764.1|FAIL first3s and completion median7280.5>5000; max7693<10000|
| c907 USD-M A |7599,null,null,null,null|null,null,null,null,null|FAIL; original isolated SSH handle exited255 after keepalive timeout|
| c907 USD-M B |null,null,null,null,null|null,null,null,null,null|FAIL on fresh isolated connection; ready source not reclassified unavailable|
| f602 Spot |2921.1,1773.6,2381.9,2409.5,2238.6|5617.1,4644.3,8377.2,5320,6019.7|PASS first3s; FAIL median5617.1>5000; max8377.2<10000|

Spot imports all8293walls/49154value points/35explicit gaps in every valid run.
USD-M reference remains23850/104112/47, but neither cohort completed the visible
coverage assertion. source tokens are the pinned references, not artificial
missing data. Failed and partially observed samples are retained. c907/f602
cohorts ran sequentially across variable route conditions, so the elapsed
change is not an isolated causal estimate of the code fix.

A supplemental c907 single CPU-profile run completed5258.4ms with first history
1825ms; it is not an acceptance cohort. Its .cpuprofile identifies repeated
syncPaneLayoutControls work (~273ms self samples). Every wall callback previously
rebuilt the whole indicator/pane-control tree. f602 refreshes those controls only
when their loading state changes; all wall geometry/status updates still apply.
A headed software-rendered fixture test proves100value patches retain all101
points without an indicator/pane-control rebuild, then verifies both spinner
transitions. All9headed wall UI/pane lifecycle regressions, typecheck and build
pass. Real f602 imports record7..11total active-indicator renders including startup.

Several c907 frames paused for seconds. The local blank Canvas2D probe in
validation/ produced401frames in7seconds, median16.7/max32.6ms; inactive workspace
placement alone does not explain chart stalls. This is a diagnostic, not a chart
60fps result. Native prices only retain1000candles: f602 samples start at
1793765400000, after the requested left edge1793696400000. Screenshots show that
missing candle context although all required wall intervals are imported. This
is an additional unresolved coverage/usability limitation. The 1000-bar bound
was not raised and derived trades were not silently substituted for native OHLC.

An initial launch used an incorrect fabricated expectedSHA. Its owned process
was stopped after verifying cwd/argv/env; no timing is accepted. Its artifacts
are retained under invalid-build-chart-c907-a33-spot-* and invalid-build-launch.txt.
The maintained benchmark now refuses an unknown local commit before opening a
browser; an all-zero SHA rejection is in validation/iq-chart-build-guard.log.
Subsequent launch SHA values were read directly from Git and match diagnostics.

The original test tunnel's exit255/listener disappearance and still-running
no-OOM gateway are recorded in route-failure/. Its subsequent fresh connection
was launched only after authoritative terminal confirmation. After chart closes,
the gateway reported zero active history requests/encoders; cancellation did
release serving capacity. No new cancellation change was made without evidence.
The owned gateway, preview4182, tunnel18794 and browsers are stopped; test ports
are free and incumbent identities match. Default rolling reuse, warm revisit,
full concurrency/repeated-use gates and performance acceptance remain open.

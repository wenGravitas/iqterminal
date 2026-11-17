# Native price admission during prepared wall loading

Pinned Spot30h staging traces show visible native history waiting in the shared
history scheduler behind two eagerly acquired wall bodies:2.788s in run1,
1.979s run2,3.040s run5. The small native response is required for price context
in saved/past views outside the latest1000 native-bar bootstrap. Header/transfer
wait and later worker/render costs remain distinct. USD-M15m bootstrap often
already spans the30h view; this is not a complete explanation of its latency.

The importer now starts the next batch only after the first authenticated member
of the current batch. Native demand can enter the free history slot during the
first response wait; subsequent wall batches still pipeline. Shared concurrency,
HTTP admission, payload bounds, financial hashes, coverage, source revisions,
consumer cancellation and all wall data remain unchanged. No new connection or
financial aggregation is introduced. Completion still requires every part and
independent source validation.

The deterministic regression gates the first wall body, admits a native-price
read through the real shared scheduler, then verifies all35 parts/36 identities
arrive. The previous eager loader fails that assertion; the candidate passes.
This is admission/correctness evidence, not a loading-time pass. Fresh exact-build
Pi measurements are required before claiming an improvement. Revert the small
client importer change to roll back; no server/source/cursor reset is needed.

# Pi worker continuation comparison

Five alternating samples per variant/market; same actual captured canonical
first bounded batches and exact production decoder. Compiler exits before
Chromium. This measures a dedicated worker without a chart or API route.
Warmups are separate. All20 sampled reconstructions are byte-identical; both
real native cancellation probes succeed. Message events are synthetic8ms
heartbeat inputs and do not certify current-feed continuity.

|Market/variant|Elapsed samples ms|Median/max ms|Yield samples ms|Median/max yield ms|
|---|---|---|---|---|
|spot/timer|578.6,572.7,510.9,467.6,391.8|510.9/578.6|141.7,108.1,133.0,106.7,92.0|108.1/141.7|
|spot/background|338.3,462.4,377.3,377.3,368.7|377.3/462.4|18.6,44.8,21.1,30.4,19.6|21.1/44.8|
|perp/timer|488.7,375.3,491.2,366.3,449.7|449.7/491.2|95.3,73.5,112.1,65.5,116.0|95.3/116.0|
|perp/background|264.8,241.0,329.7,337.5,830.4|329.7/830.4|20.2,12.1,21.4,40.1,26.0|21.4/40.1|

USD-M background run5takes830.4ms, including a130.7ms maximum message-delivery
gap; it is slower than its paired timer run. Native JSON/GC and host scheduling
can exceed the soft8ms checkpoints. No strict latency, CPU-time, foreground,
whole-view loading, memory plateau or real current-feed gate passes here.
The first harness attempt fails before measurement due to a relative Blob-worker
URL; its source/error is retained separately.

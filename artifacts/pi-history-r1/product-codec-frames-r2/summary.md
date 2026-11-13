# Production codec over actual bounded frames

Candidate adds bounded per-segment price parsing and one prior product cache.
No serving deployment or browser/loading acceptance. All canonical part bytes
and expansion budgets match. Captured API build is f82; see capture.json for
exact keys, source revisions and response headers.

|Market/codec|Compressed bytes|Encode samples ms|Encode median/max ms|Decode samples ms|Decode median/max ms|
|---|---:|---|---|---|---|
|spot/v1|640872|594.3,221.5,435.7,233.9,213.2|233.9/594.3|331.3,306.5,348.5,280.9,286.8|306.5/348.5|
|spot/v2|491937|558.1,423.8,416.5,411.6,359.9|416.5/558.1|528.3,435.0,357.4,426.8,510.3|435.0/528.3|
|perp/v1|459712|339.8,211.4,349.5,183.9,182.0|211.4/349.5|283.3,536.5,238.3,210.3,214.0|238.3/536.5|
|perp/v2|409069|352.1,283.6,353.9,375.1,267.1|352.1/375.1|277.1,382.9,358.3,319.0,311.8|319.0/382.9|

Spot batch:22 actual canonical parts,8276300 original bytes; compressed640872→491937
(23.2% smaller),32329 exact product points. USD-M batch:16 parts,7879182 bytes;
459712→409069 (11.0% smaller),22994 exact product points. These are the first
bounded batches of their pinned views, not complete30h payloads.

All5 alternating samples per codec/market are retained, including compression
durations and checkpoint spans. Encode includes parsing/serialization/counting;
decode includes parsing, canonical equality and byte accounting. These CPU timings
must not be added to the old loading timings or used to predict a passed gate.
Native JSON/GC and final comparisons can exceed soft8ms checkpoints.

r1 is the earlier uncached-price candidate, not a route comparison. Its first
compile invocation used an unavailable frontend esbuild CLI; corrected compilation
and actual executed source are preserved. r2 compiles the identical shared backend
codec and runs after the full serial backend suite is terminal.


Validation: frontend focused44/44, typecheck and production build pass. Full
frontend1240pass/2skip/2vault deadline failures; isolated vault8/8pass with
unchanged deadlines. These are distinct results, not a green full-suite claim.
Backend serial321/321, typecheck and build pass; earlier parallel320/321 retains
one gateway child-shutdown deadline failure. No timeout or correctness gate was
widened. All logs are retained. No new browser or staging service was launched.

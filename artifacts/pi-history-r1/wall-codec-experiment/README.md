Rejected structural compaction experiment; no runtime code imports this codec.

Run `node --import tsx artifacts/pi-history-r1/wall-codec-experiment/benchmark.mjs`
from the frontend worktree. The pinned canonical hour is stored as gzip. All five
Pi samples are in `iq-wall-codec-bench.jsonl`; normal JSON/gzip was selected
because compact decoding was much slower. These are decoder microbenchmarks,
not browser latency, prepared delivery or 30h coverage acceptance.

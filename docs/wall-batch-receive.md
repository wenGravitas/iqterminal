# Bounded wall response receipt

The client previously read one member, parsed/expanded/hashed it, and only then
read more of the HTTP body. Cooperative decoder yields consequently also stopped
the reader. A zero-prefetch stream regression holds the first hash: the old code
pulls only one frame and fails; the new reader receives the remaining frames.
This establishes the mechanism, not the contribution to measured chart latency.

One fixed buffer receives a batch while members validate serially. Its size is
the verified transport byte declaration, at most the existing 8 MiB canonical
batch cap. Part slices share that buffer. The scheduler retains its admission
until decoding and EOF validation finish; receipt does not admit more work or
create another decoder queue. At most two admitted history batches can use this
path, adding at most 16 MiB of receive storage. Actual payloads may be smaller.
This is a bounded peak-storage tradeoff; repeated-use heap still needs measuring.

Every member retains canonical size/hash validation and financial decoding.
An early validated prefix can publish before the response finishes. The terminal
member requires exact byte count and EOF; truncation, excess bytes and network
errors fail explicitly. Canceling one shared consumer retains the peer's receive
and validation; the last consumer cancels the body, releasing its reader lock.
Reader cleanup also runs on parse/hash failure. No source, server, socket count,
retention, wall identity, coverage or numerical representation changes.

Focused regressions include blocked hashing with continued receipt and retained
admission, progressive delivery before EOF, truncated/excess/failed tails,
shared/last-consumer cancellation, lock release and buffer declaration bounds.
The original point-transport exactness and retry tests remain in force.

Rollback: revert the reader integration and helper, rebuild the client, and serve
that bundle. No backend rollback, collector restart or cursor reset is needed.
This page describes the contract; actual Pi loading results are recorded
separately and must determine whether the change is retained.

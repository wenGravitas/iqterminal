# Exact product point transport

HTTP projection-batch version3 uses `exact-points-v2`. It can replace the existing
four-field `[timeOffset,quantityExact,notionalExact,rank]` tuple with three fields
`[timeOffset,quantityExact,rank]` only when integer decimal multiplication of the
segment's `priceExact` and point's `quantityExact` reconstructs the original
notional spelling exactly. No floating-point multiplication determines money.
Unknown shapes, different spelling, non-equivalent notionals and operands longer
than128 characters keep the explicit incumbent tuple/native object.

This is a lossless presentation transport. Canonical stored parts, financial
source, hashes, revisions, point order, time/rank transitions and gaps do not
change. Decode reconstructs original numeric fields and property order; the
existing per-part byte count and SHA256 fence still validate the entire result
before publication. Three-field tuples require the new capability; older readers
reject them. Expansion accounting includes the reconstructed decimal string and
fails before exceeding the advertised canonical byte budget.

Discovery continues advertising `pointTransport:1`, adding `productTransport:1`.
Old clients keep requesting HTTP version2; new clients request version3 only
when that extra capability is advertised. New clients against old servers keep
version2. Native HTTP version1 remains unchanged. Cache/ETag identities include
the selected version, preventing cross-version reuse. Client shared-response
identity includes the transport version as well as the URL/source/parts.

All existing part/batch/row/point and cache/admission limits remain unchanged.
Exact arithmetic operands are bounded; encode/decode retain cancellation/yield
checkpoints every256 points. Each segment parses its price once and retains at
most one prior quantity/product pair, adding no history-sized cache. JSON/native operations and GC remain outside a
strict time guarantee. Encoding yields on the existing serving event loop; compression uses the existing
libuv worker pool and bounded shared cache. No exchange or database connection is added.

The candidate is not deployed. Focused codec/delivery/hash/cancellation tests,
typecheck/build and captured actual bounded-frame measurements must precede any
staging API-only rollout. Follow the existing staging workflow and preserve all
protected collector/materializer/admission identities. Real five-run Pi loading
and current/concurrency gates remain required; offline byte savings do not pass
those gates. Default rolling-window composition and tail handoff remain separate
unfinished requirements.

Rollback is an API/client revert. Capability removal causes new clients to use
version2 automatically. Older clients already use version2. No canonical cache
migration, source deletion, cursor reset or collector restart is required.


## Default preparation boundary still outstanding

`wall-rolling-defaults.ts` prepares two exact closed source windows, independently
of chart activity. Its diagnostics explicitly do not claim sliding-window
composition or live-tail bridging. `wall-source-version.ts` pins a global head
and content proof for the closed request; `order-walls-archive-service.ts` allows
a live bridge only when historical coverage itself reaches the captured join
watermark. A closed request end can precede that watermark's timestamp.
Do not seed continuation after the global cursor merely because it appears in a
closed manifest: intervening source events still require a verified handoff.
Moving a window start also changes carry-in state and can affect qualifying wall
identity. Composition must be compared against the incumbent projector across
rank transitions, timestamp groups/regressions, gaps and corrections. These
requirements are not discharged by the product transport change.


## Pi CPU evidence

`artifacts/pi-history-r1/product-codec-frames-r2/summary.md` lists every sample,
median and maximum for5 alternating samples per codec/market. Actual first
bounded batches save23.2% compressed bytes Spot and11.0% USD-M; every restored
canonical byte and expansion count matches. Extra encode/decode CPU remains;
no route or loading win is claimed. The first prototype and earlier production
codec comparison remain separately labelled. Source files remain byte-identical
between frontend and backend repositories.

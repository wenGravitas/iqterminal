# Exact compact wall presentations

Prepared closed history is presentation data. It never seeds or adds to a live
accumulator. Large prepared views can now retain an exact gzip presentation
instead of duplicating a mutable projector and its per-point queues. This fixes
the previous default-view admission failure without raising the cache budget.
Canonical fallback retains its existing small detached presentation path; large
unprepared/canonical views still load normally but have no compact cache.

The representation is private, in-memory `version1`; no backend/materialization
schema, shared financial core, source retention or production setting changes.
Its identity is the exact market/profile/settings/request range. It preserves
all segment fields, decimal strings, values and order, entry/exit identities,
unknown/censored bounds, ranks and flags. A long wall is split into exact ordered
fragments and published only after all its fragments join. This is compression,
not display-resolution reduction. SHA-256 checks every decoded chunk; totals and
fragment coverage must match before the replay settles successfully.

Limits remain two cached entries,16MiB per entry,32MiB aggregate and60s TTL.
Compact accounting includes encoded bytes, bounded chunk metadata and256KiB
reserved for bounded status/signature metadata. Existing prepared decoded caps
remain64MiB /100000segments /1000000points /100000points per segment. Each native
stream handles at most1MiB of decoded chunk data, normally128KiB, and each JSON
fragment has at most256points. A conservative flat-metadata/string bound runs
before JSON serialization; unusually large exact metadata can miss the optional
cache without serializing a whole large point array or changing the chart data.
Encoding yields after8ms of JS work and after
bounded compression. Two input builds may be retained; one encoder runs at a
time. Two decoding jobs may run; consumers of an entry share its decode. Active
replay entries remain charged to the cache budget. Expired entries reject new
hits and retire after their last consumer releases. New optional admissions can
miss rather than evict an active replay or expand a limit.

Source revision validation runs independently. Cached history can display before
a delayed current bootstrap, while the healthy current socket continues its own
lifecycle. Initial decoding reports an incomplete loaded range; decoded wall/point
counts are separate from requested coverage. Known cached gaps remain explicit
while fresh data builds or validates. Even a fully decoded cache does not set
fresh `requestComplete` or `rangeComplete`. Only a fully validated fresh revision
replaces the old presentation. Identical prepared source tokens plus active
presentation headers avoid recompressing an already validated unchanged cache;
TTL renews only after that successful independent validation.

Unsubscribe releases one consumer; the last consumer cancels its native stream
and releases the decoded map. Builders cancel on obsolete replacements/disposal.
Corrupt cached data expires that entry; a valid decoded prefix stays visible,
or an available fresh prefix can resume when no cached content arrived. Fresh
success releases the failed replay and repairs the cache. A source revision
failure clears an obsolete resume cursor before Retry; it must not resume the
old revision's page chain. Current sockets/cursors are unaffected by cache errors.
Unsupported compression or a real cache limit is an optional cache miss, not
absent historical source or a paused live connection.

Worker diagnostics expose cache bytes/walls/points, pending builds, actual active
decode jobs and replay consumers, admission/capacity/decode failures, revision
reuse and16bounded local timing records. Encode queue/elapsed and replay
elapsed/first-content durations use the same worker monotonic clock. They include
native work and yields; they are not exclusive CPU times or browser paint. Do
not add them to overlapping navigation/header/paint durations.

Validation includes fragment/hash/total/cancellation tests, shared consumers,
delayed current bootstrap, known-gap retention, corrupt-cache recovery, bounded
obsolete jobs and Retry source invalidation. File probes use full captured Spot
and USD-M prepared data and exact independent canonical financial hashes. They
are offline Pi worker/service evidence. Headless native Chromium worker checks
are correctness evidence; neither can pass the actual-route/foreground loading
or warm-paint gates. Those gates remain separate.

Rollback is the frontend feature commit revert and a client reload; cache data
is in memory and requires no storage migration or server rollback. Do not clear
or rebuild canonical/raw history to roll this back. Server rolling-default
preparation/reuse and the remaining full-release gates are separate work.

# Wall projection private index V3 results

Backend `cbe0bdcb5af1928a71e8bdfe559be5b75447b696` replaces the growing closed-entry index inside each private building checkpoint with authenticated immutable delta shards. The prior profile attributed substantial repeated work to parsing, copying and serializing this index. The financial kernel, canonical source, public V2 manifest, final checkpoint, preterminal prefix and compressed output parts retain exact ordering and bytes. Active state stays in the bounded checkpoint. Index chain, file, byte and memory bounds remain explicit; oversized private-format overhead falls back to the existing exact V2 representation.

The V3 queue latch is durably saved before every writer entry. Older workers refuse that queue format; an old-binary restart against a latched root is not rollback. No serving deployment has occurred. Backend operational details and the required snapshot/restore drill are in `docs/wall-projection-index-v3.md`.

## Five paired runs per market

Times below are offline projection component build milliseconds, excluding container startup and final validation. Each run has fresh derived output over the same leased prepared canonical source. Host filesystem caches were not cleared. These are neither raw cold materialization nor empty-browser-cache chart-load samples.

| Market | Version | Every sample ms | Median ms | Maximum ms |
|---|---|---|---:|---:|
| perpetual | baseline | 27475, 27142, 26069, 26682, 26300 | 26682 | 27475 |
| perpetual | candidate | 20965, 20954, 21435, 20369, 20256 | 20954 | 21435 |
| spot | baseline | 4366, 4589, 4238, 4500, 4495 | 4495 | 4589 |
| spot | candidate | 5349, 5743, 5897, 6453, 6145 | 5897 | 6453 |

Baseline uses backend `e4fa9b6ffa72e91e6be5f7579588217cfed76a7a` source with the same diagnostic helper as the candidate. Exact executed bundles are retained. Orders alternate, with five comparisons per market. USD-M median improves about 21.5%; Spot regresses about 31.2%. **This is not a blanket performance pass.** A separate follow-up `e6c64beda38aed64f58e6c399677e6ae225cce4b` skips redundant lstat calls for protected immutable index objects; its new controlled three-version cohort is separate from these samples. It still rejects symlink/corrupt objects on bounded no-follow reads and validates all cleanup deletion candidates before removing any.

All 20 completed builds exactly match the original final checkpoint, public serialized manifest, preterminal prefix bytes and every compressed output part. Source tokens are revalidated before/after and after each case. Missing data is not replaced with synthetic coverage. Every sample, per-page CPU/RSS/checkpoint bytes, DB query/read/timing headers, source coverage/gaps and container identity is retained in the linked raw receipts.

| Market | Version | Largest building checkpoint bytes | Largest sampled RSS MiB |
|---|---|---:|---:|
| perpetual | baseline | 7218279 | 161.7 |
| perpetual | candidate | 1174280 | 139.9 |
| spot | baseline | 1331576 | 100.1 |
| spot | candidate | 322013 | 96.5 |

RSS is sampled at page boundaries, not a continuously measured peak. CPU samples and outer process elapsed times are separately available in `cohort-summary.json`; they must not be added as exclusive phases.

## Fixed source and environment

- spot: `2026-11-09T22:15:00+00:00` to `2026-11-11T04:25:00+00:00` (half-open); profile `binance-spot-btcusdt-feed-spot-diff-depth-band-10pct-agg-native-top10-a1-s1`; source `3d9753ce2cf6b22edd93a459cee9d05aa5e259a410519ebf7498928bc3fbfd16`; projection `7bb2ccb39deebd6487fad2221da9e707c9023aa1a662abdcd96cea56779a55b9`.
- perpetual: `2026-11-09T21:45:00+00:00` to `2026-11-11T04:15:00+00:00` (half-open); profile `binance-usdm-btcusdt-feed-usd-m-standard-diff-depth-rpi-excluded-band-10pct-agg-native-top10-a1-s1`; source `21477aa19b5f6c385de5c2c5724bbbc67a36cb6f82870c7ae4fcbcb2d339aade`; projection `ec9bb6a71ccca481aa630cdc565c8d45f1e1bd0e876eaae8c45a758f72a7c325`.

The full source windows are preserved, including the existing default context padding. No shorter 30h chart range is inferred from a component result. Same immutable runtime image `sha256:3a67ff312a4924289717685b2c7aa53328e80f0dfd3af8e896bd347a3b848d43`, Node22.22.0, 0.5 CPU, 384MiB memory/swap limit, 256MiB V8 heap, read-only root, network disabled, no capabilities/restart, separate writable outputs and read-only canonical/projection source mounts. Build code is a mounted checksummed bundle; the image does not contain the candidate commit.

Serving remains worker `13730f76752ec9db7f2253aa541fd4131e578141` / container `dca671725098a47d7592f9af201b4d7b2d63887d761e5caf737799da7855123c`, side gateway `71f62d2efceb8a4ac0fadb9c8a1495bcf1eb4efa` / `569422becf7c417d91b2ca6eb90a6a8264a0c10ae49421f352e94ccd225e60ae`. The original API plus seven protected services match before/after. All benchmark containers exit0 without OOM, reader leases are released, and postflight control state is recorded. No collector, source retention, production deployment or main merge changes.

## Correctness, recovery and remaining gates

Candidate cbe0bdc passes 362 backend tests, typecheck and all bundles. Regressions cover closed/active reinsertions, tombstones, compaction, orphan crash files, hash/Bloom corruption, symlinks, exact legacy fallback at file/byte limits, final publication failure/retry, and durable queue barriers after repeated save failures. Follow-up e6c64be passes all 363 backend tests, 19 focused tests, typecheck and all builds. Its three-version comparative cohort is recorded separately when complete.

The fixed-head boundary repair is now committed in backend `e31db8d776941a25cdc53ad2cefaa9d9ab5c92eb` and frontend `7257c8ad972bdfa4ba382fe77d6eec81b704ea49`. Half-open `[from,H+1)` admits the observation at H while canonical SQL remains `at < to` and confirmedTo stays H. This repair is not installed on serving or recertified as chart performance. The request-clamp experiment remains withheld: terminal cursor continuation loses timestamp-regressing observations and can change exact floating-point means. Same-left verified nonterminal replay is required; a selected-book match alone does not prove continuation.

The release remains **INCOMPLETE**. Both latest 30h wall chart gates remain failed. Current/warm-wall/concurrency, retained heap/queues, default client-tail handoff, current-candidate footprint recertification and normal foreground Pi UX remain incomplete. Snapshot/restore rollback must be exercised before V3 serving installation. Browser checks stay headless while i3 workspace isolation is unverified. No threshold or requested range was shortened.

[Raw evidence, checksums and reproduction scripts](../artifacts/pi-history-r1/wall-projection-index-v3-r1/) include all 20 per-page logs in `page-logs-verified.tar.gz`, exact bundles, every sample, source checks, postflight, tests and build logs. Run `python3 summarize.py` in that directory to reproduce the JSON summary.

## Three-version follow-up cohort

A new fixed source per market is shared by all three variants. It does not reuse the first cohort timings across different source windows. All30 builds match the financial checkpoint, prefix, public manifest and compressed parts exactly; source checks and terminal container bounds pass.

|Market|Version|Every sample ms|Median ms|Maximum ms|
|---|---|---|---:|---:|
| perpetual | baseline | 27459, 28417, 27983, 27246, 27220 | 27459 | 28417 |
| perpetual | candidate | 21581, 22596, 21747, 21041, 21261 | 21581 | 22596 |
| perpetual | followup | 21112, 20744, 20686, 21970, 20989 | 20989 | 21970 |
| spot | baseline | 4544, 3768, 4378, 4505, 4616 | 4505 | 4616 |
| spot | candidate | 5992, 5994, 5761, 6050, 6275 | 5994 | 6275 |
| spot | followup | 6751, 5915, 5907, 6410, 5759 | 5915 | 6751 |

The lstat follow-up e6c64be helps USD-M slightly versus cbe0bdc, but does not repair Spot:5.915s median versus4.505s baseline, maximum6.751s versus4.616s. This failure remains explicit. The committed bounded-inline strategy fbd58b03097ba06f96a6ffd7071e327e4f3b662d passes all364 backend tests,20 focused tests, typecheck and builds; its performance cohort is separate and still pending. It keeps indexes inline up to2MiB and converts before the next page after that bound is crossed, retaining every financial limit. Exact fixture comparisons include inline, sharded and mid-build conversion. No serving upgrade or gate pass is inferred.

## Bounded-inline strategy cohort

All20 builds over one new pinned source per market match exactly. Baseline and candidate each have five fresh output directories per market, alternating order, with identical fixed inputs. These remain unprofiled offline component samples.

|Market|Version|Every sample ms|Median ms|Maximum ms|
|---|---|---|---:|---:|
| perpetual | baseline | 27863, 28494, 27926, 27753, 26757 | 27863 | 28494 |
| perpetual | candidate | 21617, 22069, 21551, 22090, 22153 | 22069 | 22153 |
| spot | baseline | 4564, 4193, 4337, 4651, 3945 | 4337 | 4651 |
| spot | candidate | 5225, 4911, 4651, 5743, 4947 | 4947 | 5743 |

USD-M improves about20.8% (27.863s to22.069s median). Spot remains about14.1% slower (4.337s to4.947s median; maximum4.651s to5.743s), so **the Spot regression is not resolved**. The candidate uses48 V3 pages per USD-M build and no V3 pages per Spot build. Final output and extension prefix match their exact baseline bytes in every case. No chart gate passes.

All20 terminal containers exit0 without OOM and respect the fixed resource/mount bounds. Original API plus seven protected services and the serving worker/gateway identities remain unchanged. The cohort releases all leases; postflight control state is retained. Read-only host CPU/load/memory/swap samples cover only part of this cohort, labelled as a partial window. The Pi host is aarch64 Raspberry Pi5 ModelB Rev1.0 with8GiB nominal RAM; the separately sampled staging host is not its client route. Monotonic times are interpreted only within each host. These samples do not prove foreground rendering, request latency or current ACK continuity. Both owned sampler processes terminate explicitly.

One separate CPU-profiled Spot build follows the completed comparison. It matches every financial output and source token. Its timing is excluded from the cohort. V8 sample attribution includes cgroup throttle/idle/GC and cannot be treated as exclusive CPU durations. Position ticks identify avoidable inline threshold serialization (41), rebuilding the final ordered entry object (120), and materialization/copying; canonical decode/replay hashing remain large. A follow-up reuses the exact size counter and keeps monotonic entry objects with the incumbent sort fallback. Its performance validation is pending; no claim is made that it removes the measured regression. The raw profile, executed fbd58b0 bundle and reproducible analyzer are retained.

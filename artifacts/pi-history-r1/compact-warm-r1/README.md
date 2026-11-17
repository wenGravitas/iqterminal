Latest full-data results: [final-0de9545](final-0de9545/README.md). The earlier711series below remains scoped evidence.

# Full default views in exact compact warm caches

Feature711a8d36f0fae5a38c2f033fcbb0102779e26604; render extent follow-up f965292.
Both are frontend-only R1 worktree commits. The serving build remains18579d9;
`staging-identities-health.txt` records unchanged collector/history IDs and start
 times. No backend serving, production, collector or retention change occurred.

The previous default-view warm-capacity failure is repaired: all five Spot and
all five USD-M file/service runs admit the entire view into the unchanged16MiB
entry/32MiB aggregate budget. Retained accounted bytes are1652214(Spot) and
3178252(USD-M), including bounded status metadata reserve. Every record remains:
8293walls/49154points/35gaps(hash cf9d17...afd944e), and23850/104112/47
(hash de4d77...899c6). Identical independently validated revisions reuse the
encoded cache; they do not build it again. Zero replay consumers/projectors
remain after unsubscribe. Fresh history publication does not wait for encoding.

The input proofs are captured immutable prepared files, not fresh SQL. Each gzip
and decoded content hash is checked before the actual production client service
loads it. Source profile, exact padded bounds, proof tokens and manifest keys
are retained in the JSON. Spot input is the existing sibling
`wall-presentation-cache-r1/input-spot` and its `captured-source.json`. USD-M input
is retained here in `input-perpetual`, with `canonical-perpetual.json` and its
constructed captured-proof discovery envelope. The independent canonical hash
references predate this codec. No exchange or database is queried by the runner.

Each run uses a fresh service instance; Node module/JIT and OS file conditions
warm across samples. The fresh validation path is deliberately held until every
cached record has replayed, proving the cached content is independent. Neither
cached partial nor full delivery claims fresh request/range completeness. Known
cached gaps remain explicit throughout. Fresh validation then releases the old
replay and clears its consumer. These are actual Pi offline worker/service
observations, **not browser paint, actual-route latency, cold materialization or
release acceptance**. Five samples give median/max, not p95.

| Offline phase(ms) | Every sample | Median | Maximum |
|---|---|---:|---:|
|spot · Preloaded responses → validated client history|823.8, 607.2, 541.4, 509.6, 506.2|541.4|823.8|
|spot · Optional encoding after history ready|739.9, 674.1, 695.4, 663.4, 648.6|674.1|739.9|
|spot · First cached worker content|6.3, 3.5, 3.5, 3.3, 3.4|3.5|6.3|
|spot · All cached worker content|472.7, 471.4, 441.7, 433.7, 426.7|441.7|472.7|
|spot · Independent captured-proof validation|1308.3, 1255.1, 1176.9, 1171.7, 1160.9|1176.9|1308.3|
|perpetual · Preloaded responses → validated client history|1718.9, 1401.7, 1398.5, 1390.0, 1380.5|1398.5|1718.9|
|perpetual · Optional encoding after history ready|1732.4, 1805.0, 1906.4, 1781.4, 1755.2|1781.4|1906.4|
|perpetual · First cached worker content|6.1, 3.8, 8.4, 4.2, 3.7|4.2|8.4|
|perpetual · All cached worker content|1232.8, 1133.9, 1136.9, 1093.0, 1117.9|1133.9|1232.8|
|perpetual · Independent captured-proof validation|3171.2, 3017.7, 3017.9, 2953.1, 2980.6|3017.7|3171.2|

The native headless Chromium155worker checks preserve both full canonical hashes
and confirm native CompressionStream/DecompressionStream plus cancellation after
one callback. Worker elapsed includes encoding, replay, verification hashing and
cancellation. Window round-trip includes startup/transfer as well. Their clocks
are separate monotonic origins and observations overlap; do not subtract/add them
as exclusive phases. There is one correctness run per market, not a latency
cohort. No i3 browser window was opened. Eight headless Order Walls UI checks
also pass on711a8d3; these fixture/software checks are separate from Pi foreground
acceptance. The follow-up carries77focused renderer/service/source tests and
exact build/type evidence; its eight headless checks also pass, retained in headless-ui-f965292.log.

The follow-up fixes a real boundary issue: conservative loadedThrough remained
at the requested start while cached records decoded, but the renderer needed a
separate presentationThrough to paint their known geometry. A service→primitive
regression now draws/hits a received open historical wall with requestComplete
stillfalse and loadedThrough stillatstart. No whole-view completion is inferred
from that received/painted prefix.

Full711a8d3unit suite1159pass/2skip,135filespass/2skip, typecheck/build pass.
Initial regression logs are retained: preserving cached status accidentally kept
an invalidated revision's old resume cursor, and corrupt-cache fallback retained
its consumer after fresh success. Both are repaired and regression-tested. The
initial gzip mutation test changed only an ignored header byte; it now corrupts
the trailer to test actual content rejection. Exploratory working-source samples
are excluded from the committed five-run table; one overlapped local unit work.
Raw logs preserve original whitespace. Source-only whitespace checks pass.

The compact feature does not fix rolling server-default preparation/reuse,
foreground render/paint timing, transport instability, whole release current /
concurrency, or retained browser heap/frame acceptance. The earlier full-chart
cohorts remain failed. The actual-route warm1s gate remains unproven despite the
offline first-content figures. Headed launches remain paused following the user's
workspace disruption. Operational/retry/rollback details: `docs/compact-wall-cache.md`.

Fixture file reading, gzip inflation and hash checks happen before timed service
runs. Seed timing measures preloaded in-memory responses through the client
service; it excludes disk, SSH, gateway and database work. The raw scope label
`cold/client` in this recorded runner means a fresh service object only, not a
fresh browser/worker VM or cold materialization. Future runner labels clarify it.

Source follow-up6ed9ee4 detaches encoder ownership, with current full-suite /
type/build evidence in lifecycle-6ed9ee4. Codec and renderer are unchanged there.

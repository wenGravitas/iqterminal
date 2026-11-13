# Latest committed compact-cache validation

Client0de9545(full SHA in every sample) includes711a8d3compact reuse and f965292
render extent. Five sequential samples per market, exact same pinned inputs as
the parent directory. Full suite1160pass/2skip; typecheck and exact staging /
history/diagnostics build pass. The source-only size guard rejects unusually
large flat exact metadata before serializing an unbounded point array. It does
not change financial data or raise cache/chart limits.

All ten service runs preserve exact canonical hashes and counts:
Spot8293walls/49154points/35gaps; USD-M23850/104112/47. Both default views now
fit the incumbent cache:1655229bytes and3167216bytes respectively, including
reserved metadata. A fully decoded cache still leaves fresh coverage incomplete;
the runner blocks independent validation until all cached content is verified,
then releases it and verifies unchanged-source cache reuse without recompression.
It asserts zero replay consumers/mutable projectors after unsubscribe.

These are **offline Pi worker/service timings**, using captured source proofs,
not fresh SQL proofs. Node module/JIT and OS file state warm across samples.
They do not certify browser paint, actual Pi SSH/Vite route, live concurrency,
retained browser heap, cold materialization, or the release's warm1s gate.
Every sample and resource snapshot is retained; no p95 is reported.

| Offline phase(ms) | Every sample | Median | Maximum |
|---|---|---:|---:|
|spot · Preloaded responses → validated client history|863.1, 623.6, 594.3, 524.4, 534.3|594.3|863.1|
|spot · Optional encoding after history ready|786.6, 740.5, 774.4, 745.0, 723.2|745.0|786.6|
|spot · First cached worker content|7.0, 3.9, 3.6, 3.4, 3.3|3.6|7.0|
|spot · All cached worker content|472.5, 487.6, 473.0, 437.6, 493.3|473.0|493.3|
|spot · Independent captured-proof validation|1347.7, 1241.9, 1206.2, 1229.1, 1322.0|1241.9|1347.7|
|perpetual · Preloaded responses → validated client history|1742.2, 1624.5, 1363.8, 1404.2, 1387.7|1404.2|1742.2|
|perpetual · Optional encoding after history ready|1924.3, 1946.3, 2005.8, 1900.9, 2024.4|1946.3|2024.4|
|perpetual · First cached worker content|6.1, 6.4, 3.5, 4.7, 8.4|6.1|8.4|
|perpetual · All cached worker content|1279.8, 1157.2, 1210.7, 1090.8, 1193.9|1193.9|1279.8|
|perpetual · Independent captured-proof validation|3303.6, 3037.1, 3069.2, 2980.0, 3037.1|3037.1|3303.6|

The two native headless Chromium155dedicated-worker runs preserve every financial
field and canonical hash and cancel replay after one callback. Their durations
include codec work plus verification hashing and cancellation; window round-trip
also includes message transfer/startup. Durations overlap across clock origins,
so do not combine them as exclusive phases. These are correctness checks, not
performance gates. No i3 window opens. Eight headless fixture UI tests passed on
render-extent parent f965292; subsequent0de9545only changes the bounded optional
encoder's metadata handling, and its native worker checks pass on both full views.

The current staging serving build and collector IDs remain unchanged; see the
parent's health/identity receipt. No backend or production deployment occurred.
The earlier711five-sample cohort and working-source exploratory samples remain
separate in the parent directory; this is the latest committed source series.

Fixture file reading, gzip inflation and hash checks happen before timed service
runs. Seed timing measures preloaded in-memory responses through the client
service; it excludes disk, SSH, gateway and database work. The raw scope label
`cold/client` in this recorded runner means a fresh service object only, not a
fresh browser/worker VM or cold materialization. Future runner labels clarify it.

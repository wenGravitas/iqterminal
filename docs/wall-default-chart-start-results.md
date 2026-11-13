# Default wall preparation and compiled chart range contract

Backend dbfcef4a8d948e8043245868ea03c397f2e89243 fixes a preparation/cache
identity mismatch. The planner previously padded two bars from its source end;
the chart pads one bar from the actual visible start. Source lag additionally
moved the planner's left edge. Reusing that different projection would change
range-dependent financial statistics.

The corrected planner preserves the actual requested start through source lag.
It reports the full visible/requested ranges separately from its closed prepared
subset, eligible source end and remaining tail. It does not shorten the chart
request, crop another range's financial rows, or claim current-tail completion.

The production frontend a6e253b0663e5829d3078f537ae51e1de0251fca on loopback4200
was checked against 48 deterministic backend-generated cases: Spot5m/USD-M15m,
six offsets around rollover and four source-lag values. The test invokes the
actual compiled panel.orderWallsRange method, using each fixed clock only during
that synchronous call. Every requested range and prepared start matches. The
former start differs in all48. Explicit transport fixtures isolate this contract
check; it supplies no source-data, paint-latency, server-preparation or foreground
Pi acceptance. The initial harness run expected96 instead of the actual48 cases;
that failed harness output is retained separately, and the count was corrected.

Backend validation:377/377 tests, typecheck and build pass. The dedicated lag
regression fails against the former coordinator policy and passes after the fix.
Frontend browser contract and typecheck pass. Raw outputs and the compiled method
comparisons are under artifacts/pi-history-r1/default-chart-start-r1 in each repo.

Read-only staging inspection confirms the incumbent worker33c7e3a, gateway112bf11
and eight protected services retain their exact verified IDs/start times. This
backend fix is not deployed. The current-ending exact-tail extension, ordinary
default reuse, rollover serving measurements and original release latency gates
remain incomplete. The earlier cold30h wall gate stays failed.

Backend operational and rollback details are in docs/wall-default-chart-start.md
of the server performance branch. No production deployment, main merge, collector
restart, retention change or additional exchange connection occurred.

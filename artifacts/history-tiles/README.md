# Evidence index

These files include development experiments as well as accepted measurements.
Do not pool them into one timing distribution.

- `baseline-fixed-aligned.json`: five unchanged-client full-window attempts,
  none complete by 130 seconds after page opening. `baseline-current.json` is
  the separate current-view baseline.
- `release-fixed/warm/wide/current.json`: five comparable Pi trials per scenario
  on October 13, before the final live-boundary guards. `release-first-use.json`
  contains five complete actual builds of the same fixed window, including wait.
- `verified-fixed/warm/wide/current.json`: repeat trials of the final source on
  October 16. Current trials also hold the live chart open for 15 seconds after
  completion; those extra requests are explicitly distinguishable by URL/timing.
- `reference-comparison.json`, `restart-proof.json`, `canonical-check.json`,
  `admission-check.json`: staging source parity, persisted recovery/idempotence,
  canonical duplicate/correction SQL and bounded admission evidence.
- `coverage-check.json`: full four-hour wide-window coverage inventory.
- `resource-summary.json`: 480 staging samples across the October 13 rebuild
  series, including Docker resource samples. These are observed samples, not
  continuous peak-memory profiling or claims about Pi rendering frame rate.

`prepared-*`, `edge-*`, `compact-*`, `accepted-*`, `hardened-*`, `final-fixed`,
`warm-check-*`, `validated-*`, `baseline-fixed` and old `summary-*` files are
intermediate experiments. Some include failures, incomplete coverage, different
encodings or development reloads. They are retained for provenance, not final
acceptance. `release-summary.json` predates completion of first-use trials.
Use the final report and its generated summary instead.

The fixed source window is October 13 07:40–11:40 UTC. Raw depth has normal bounded
retention and may no longer exist when reproducing later. Prepared tiles have a
separate seven-day publication TTL. Never delete an old prepared benchmark window
for a first-use retest without checking that its raw input is still retained.

`offprice-current.json/png` preserves the first October16 current-time trials
using the old fixed historical price bounds. Both histories completed, but current
footprints were vertically off-screen; this is excluded from the final ordinary
current-view series. The final current scenario keeps the same price span and
centers it on live price, recording actual bounds per sample.

# Staging footprint history repair

The 20 November 2026 investigation found two footprint history failures. The
deployed history gateway had no state mount, so prepared footprint source
validation failed with `ENOENT /state/checkpoint.json`. Its generic health check
still passed. Separately, the client stopped loading optional delta-flip reference
history as soon as the visible footprint cells were ready, even when a reference
materialization job was still building.

The client now continues polling building reference chunks at their existing
lower priority. Visible coverage stays ready, completed visible cells are not
reread, and cancellation or an unavailable reference stops optional work. A
regression failed before the change and now passes, together with tests for
cancellation and unavailable references.

## Staging configuration

The deployed `/opt/iqterminal/compose.yaml` app service now has the same mount as
the canonical server repository:

```yaml
volumes: ["./state:/state:ro"]
```

Only `app` was recreated, using the existing compose files and exact image
`iqterminal-staging:9b8cc2cafb349d6ecd29a0022e7246ec95ebc3aa`. Before recreation,
the effective image, command and configured environment were checked against the
running container. Container ID/start-time comparison then confirmed that every
other service stayed unchanged. Collectors, materializers and history files were
preserved. The replacement gateway can read both current collector checkpoints.

The pre-change compose file is retained on staging at
`/opt/iqterminal/releases/9b8cc2cafb349d6ecd29a0022e7246ec95ebc3aa/compose-before-checkpoint-mount.yaml`.
Do not restore the entire old compose file over unrelated later work. The
deployed compose file already contained unrelated changes, which were retained.
Future deployment verification should include a retained closed-bar
`/v2/history/footprints` response and its `sourceValidation`/`revisionState`, since
`/v1/health` alone did not catch the missing dependency.

Both Spot and perpetual prepared requests for 06:00–06:10 Nairobi now returned
`state: ready`, `revisionState: ready`, and two validated five-minute tiles.
The wall gateway uses a separate mounted state root; the checkpoint repair was
not established as the cause of the reported wall display cutoff.

## Real browser verification

Fresh isolated headless Chromium profiles used the current `dev` client through
`http://127.0.0.1:5173/market-data`, with real staging responses and no fixtures.
The user's existing browser storage was not changed or inspected.

- Perpetual 5m, Footprint + Footprint Totals + native Top8 / 10% Order Walls,
  20 November 00:00–07:15 Nairobi: 88 footprint bars, 139 analysis summaries,
  3,627 archive wall episodes, and 8,629 painted historical spans. The padded
  history request completed through 07:20 and painting finished.
- The 06:00 quote delta was `+26,692,273.5574`; 06:05 was
  `-81,399,481.3098`. All 50 prior reference slots validated. Their median absolute
  quote delta was `7,755,924.3855`; the 06:05 flip was strong at
  `3.4415334950018903`, matching the independently checked raw execution result.
- Expanding a two-hour wall view to the same midnight–07:15 range retained its
  existing walls during preparation and then delivered earlier history. It
  finished with 4,347 resident episodes and 8,571 painted historical spans.
  Resident chunks have separate bounded projections, so their episode count is
  not the single-range projection count.

Both wall paths retained six recorded source continuity gaps and reported
partial coverage with a completed request. No lasting two-hour cutoff was
reproduced with this configuration. The original browser's saved wall settings
remain unverified. New custom ranges can require preparation before earlier
walls appear; this verification does not establish gap-free history, foreground
frame performance, or coverage for every configuration.

Validation: all 161 tests in the six focused history/delta/totals/wall/restore
suites passed; `pnpm build` passed, including TypeScript checking.

Evidence: [combined browser result](../artifacts/history-repair/combined-live.json),
[screenshot](../artifacts/history-repair/combined-live.png),
[wall navigation](../artifacts/history-repair/walls-pan.json),
[staging mount](../artifacts/history-repair/staging-checkpoint-mount.json),
and [validation](../artifacts/history-repair/validation.json).

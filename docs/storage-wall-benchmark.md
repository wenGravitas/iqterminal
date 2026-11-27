# Historical wall benchmark admission

The newer [storage baseline preflight](storage-baseline-preflight.md) adds fixed
read-only day/week/month horizon planning and source eligibility for the selected
day. It does not recalibrate this harness's exact rendering references or bypass
the foreground browser guard. Longer-window plans and source availability are
separate from chart-load/performance acceptance.

`pi-warm-wall-route.mjs` remains an explicitly selected headless actual-route diagnostic. It does not override the repository's headed-browser isolation guard or establish normal foreground Pi acceptance.

Initial application startup intentionally discards absolute saved candle viewports and opens at the live edge. Seeding a historical viewport in startup localStorage therefore does not create a historical benchmark. The harness now boots a plain candle panel without wall history, waits for startup readiness, disposes that owned panel, and constructs the historical target through normal Dockview panel creation. Both cold and same-worker warm timing boundaries begin at their respective historical panel construction. Raw `performance.now()` timestamps and each panel's `start` remain available; console durations subtract that start. The initial bootstrap remains visible in request traces as `startup` rather than `cold` work.

Before Chromium launches, a single bounded source GET through the supplied application route verifies the exact original market/profile/range and expected source token. It never invokes discovery/preparation, creates jobs, chooses another reference or rewrites expected counts/hashes. Missing/unavailable/ineligible/revised source, malformed context, response over 64 KiB, cancellation or a 15-second deadline refuses the run and retains `source-preflight.json`. A refused setup is not a performance sample.

The checked profile IDs correspond to the benchmark's native Top Levels settings for spot/perpetual; a focused test compares them against the real native profile builder. Source fingerprint equality is a benchmark consistency check, not independent financial or source recovery authority. Paint, settled native slots, exact segment/value-run counts and the final segment hash must still pass their existing checks. No native validation or GPU acceptance criterion is relaxed.

Validation:

```sh
node --test scripts/wall-benchmark-preflight.test.mjs
pnpm exec vitest run tests/restore-bootstrap.test.ts tests/wall-benchmark-profile.test.ts
pnpm build
```

Six helper checks and 16 native bootstrap/profile cases passed; typecheck/build passed. An explicit replay of a captured real staging response ran the actual harness entry and verified stale-reference refusal before any browser launch. This replay is harness admission evidence, not a fresh network or rendering measurement.

A read-only staging check on 26 November found both stored two-hour windows and two recent closed windows eligible for source reads, but both stored reference tokens had changed. The storage report retains the raw source responses and horizon metadata. Recalibrate source, exact counts, original coverage and hashes together against a bounded retained window before running new browser measurements. Do not update only `sourceToken` or treat stale reference counts as current ground truth. Existing caller-owned artifacts and reference JSON remain unchanged.

# Pi history performance release R1

Implementation and performance acceptance are separate. No production deployment or merge is authorized by this release.

## Baselines and isolation

Frontend base: `7aedc1896805be507382b8f5feb0e00775a4aa00` (refreshed main).
Backend base: `491e7f24025ef56e4f909b593d3e9ec06321a7be` (refreshed R2 branch).
The raw-OI branch is not a dependency. New work uses `perf/pi-history-r1` in separate client/server worktrees. The main checkout's newer uncommitted UI work remains untouched.

Local host is Raspberry Pi 5 Model B Rev 1.0, arm64. See `artifacts/pi-history-r1/baseline-environment.json` and `staging-before.txt` for the initial flags, resource snapshot and collector identities. These are environment evidence, not latency acceptance.

## Root causes and first repair

- `StagingFeedService` clamped the end to the current closed-candle boundary but used the future viewport end to enforce a four-hour *total* range. The eligible past interval now precedes alignment; the four-hour bound belongs to individual HTTP requests.
- `PreparedFootprints` reported `!visiblePending` after the first ready chunk. Completion now requires every requested visible slot and chunk to validate. Explicit null tiles distinguish covered empty slots; per-slot progress carries gaps and pending/unavailable work. Chunks use the shared scheduler, newest useful visible history first; optional analysis follows visible reads.
- Prepared reads waited for a live accumulator, and the panel suppressed viewport requests until footprint autofocus. The independent initial past request and normal chart/Totals viewport requests now run without those prerequisites.
- A late live bootstrap replaced the displayed history and could relabel historical summaries with bootstrap coverage. Only bootstrap bars restore mutable execution state; closed prepared bars and their original provenance survive.
- A historical failure set live state stale, and Retry closed healthy sockets. View-specific historical errors/retries now preserve good bars, live state, sockets and acknowledged cursors. The chart footer reports history progress/range separately.

Focused coverage/lifecycle verification: 28 tests across `prepared-footprints.test.ts` and `staging-service.test.ts` pass. Typecheck/build pass. Browser and actual-route latency acceptance remain pending; these unit tests do not establish them.

## Acceptance ledger

Every proposed latency, concurrency, rollover and repeated-use gate remains **unmeasured** until five comparable samples and requested-versus-rendered coverage are recorded. No shortened range, early completion flag or current-only paint can satisfy a history gate. Headless SwiftShader evidence will be labelled separately from normal Chromium.

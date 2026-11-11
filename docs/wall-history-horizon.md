# Eligible wall-history bounds

Future chart whitespace previously entered prepared discovery as if the archive
had already observed it. A healthy current selected-book snapshot cannot prove
the archive horizon. The client now reads independent durable archive metadata
before default prepared-history discovery. Backend commit8c7b66f supplies the
optional private `/v2/history/walls/horizon` route using one bounded FINAL progress
query. Horizon reads use the shared history scheduler and the historical gateway
admission pool, preserving the current/health reserve.

The half-open eligible request is `[requestedFrom, min(requestedTo, head.at+1))`.
The left boundary is unchanged even if retention starts later. Normal discovery,
canonical records, content hashes and the final independent source proof remain
mandatory. Metadata does not establish coverage or certify empty history.
Different future whitespace with the same past request therefore loads identical
canonical content. A wholly future interval performs metadata only and reports
partial coverage with no retained-empty claim.

Status preserves the logical requested end and separately exposes `eligibleTo`
and `horizonAt`; the chart notice shows requested, eligible and loaded bounds.
`requestComplete` means eligible delivery finished, while `rangeComplete` stays
false when later requested time is uncovered. Source gaps remain in both the
financial data and status. Neither flag alone certifies painted visible coverage.
A partially loaded Retry pins the eligible end and horizon from its resume state
and still revalidates source identity; advancing archive metadata cannot expand
that mutable accumulator. New full revisions may observe a newer horizon.

Historical loading stays independent of current bootstrap. Failure propagates
through the existing history-only failure/Retry path. Good data and live sockets
are retained. The existing full validated-revision replacement contract applies;
this does not restore the unsafe terminal-cursor/live joins.

## Compatibility, operations and limitations

This behavior applies with `VITE_HISTORY_TILES=1` to the archive service's ordinary
native default profile. Standalone loader callers opt in through `eligibleHistory`.
Custom profiles still perform their existing admission path before any metadata
requirement, avoiding a progress-row dependency that would prevent creation.
Extending eligibility to admitted custom profiles remains open. A404 from an
older gateway falls back to the existing loader; other errors remain explicit.
Neither frontend nor backend is installed in staging for this change yet.

This changes no public financial kernel, source retention, collectors, execution
connections, queue format or capacity limits. Gateway rollback removes the optional
route and clients fall back on404. Frontend rollback restores the previous request
behavior while preserving derived storage. Independent preparation/index deployment
still requires its separate quiescent snapshot/restore drill.

Remaining release work includes ready-prefix discovery, exact closed-record reuse,
default prepared-range matching, periodic canonical revision refresh, admitted
custom-profile eligibility, staging deployment and actual Pi loading/concurrency/
warm-cache/memory/rollover acceptance. No loading performance gate is claimed here.

## Validation evidence

Raw logs and a headless native-chart fixture screenshot are in
`artifacts/pi-history-r1/wall-horizon-r1/`. The screenshot uses an explicit fixture,
`VITE_DATA_MODE=direct`, `VITE_HISTORY_TILES=0`, `VITE_DIAGNOSTICS=1`, production Vite
output, Chromium with SwiftShader and no mapped desktop window. It proves notice
semantics, not staging connectivity, foreground responsiveness or Pi loading.

- Backend:367 tests pass; typecheck and build pass.
- Frontend focused:73 tests pass, including pinned Retry after horizon advance.
- Headless native-chart notice check:1 pass, requested/eligible/loaded bounds and
  history/live gap separation.
- First full frontend run:1320 pass,1 vault5000ms timeout,2 skipped. This run overlapped
  the backend suite. Isolated vault rerun:8 pass with the original timeout.
- Second full run:1316 pass,6 failures,2 skipped. A fixed30ms wait in the
  footprint-batch test failed before its expected progress event and left shared
  requests open, causing the later failures. The test now waits for that event
  and aborts/awaits its work in a finally block; financial assertions are unchanged.
- Final full serial run after synchronization/cleanup:1322 pass,2 skipped
  (`frontend-full-synchronized.log`), with original timeout thresholds.
- Final typecheck/production build pass (`frontend-build-final.log`).
- Frontend typecheck and production build pass. Existing chunk-size build warnings
  remain. No thresholds or financial-data limits were changed.

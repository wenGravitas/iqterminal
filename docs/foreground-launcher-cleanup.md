# Foreground acceptance launcher: cleanup hardening

This is a tooling-only follow-up to [watch/warm acceptance](watch-ack-warm-acceptance.md). Baselines were frontend `678f2f553435ed81cab3b3e892643ab143bc18e0` and backend `7858808925cce5e84dc226884cd0eec6dfbe3d23`, verified locally and by one fetch. The tested applications remain **client `58b3ae3eb17f93c8480a4cd9598052c1bc5d684e` / backend `300fa5d00f607d7e3a990b128523ea265af363f5`**. Existing client, wall and isolated-watch bundle hashes still match their receipts. No application rebuild, financial/codec cohort, staging service action or resource change was performed. All previous performance results retain their original scope.

## What changed

Both worktrees must contain the new tooling; the launcher refuses the old non-session helper before startup. The launcher persists `remoteStartupAttempted` and a unique session UUID **before** calling startup. Timeout, nonzero exit, missing/mismatched reply, later startup error, Ctrl-C and local expiry all reach bounded reconciliation; a successful startup receipt is not required to find created roles.

Both roles are labelled `io.iqterminal.foreground-session=<UUID>`. Shutdown requires that label **and** the original build **and** exact `/wall-preparation` root mount. It inspects by name, then operates on the verified immutable container ID. Unlabelled/foreign resources are not adopted, even if their name/build matches. Existing verified application bundle files are not rewritten.

Remote session intent and a cancellation marker live under `/home/daz/iqterminal-wall-foreground-sessions/<UUID>/`, outside the prepared queue. Their small bytes are included by the existing aggregate root accounting. The marker is recorded before stop inspection and permanently fences a delayed start using that UUID. A bounded file lock distinguishes quiescent startup from a still-running creator. If that cannot be established, the report remains unconfirmed, even when currently observed roles are absent. Do not remove these ownership/cancellation records to force a retry; a new launcher invocation creates a new session.

Capture is best-effort **per owned role**, not a prerequisite to stopping it. Missing gateway, failed logs, failed stop/remove or uncertain inspection do not prevent the worker's independent cleanup. Capture is capped at2,000lines/256KiB per role with truncation/errors recorded. Docker inaccessibility is not treated as absence. Prepared state and owner locks are never deleted.

## What the result means

The launcher writes `cleanup.json` in its printed frontend evidence directory. The backend session directory also holds the scoped helper result. Per-role states distinguish:

- `removed` / `absent`: confirmed gone at reconciliation.
- `stopped-retained`: confirmed stopped, but removal failed; repeat the same scoped cleanup before another session.
- `ownership-mismatch`: left untouched. Inspect the recorded ID/owner; do not relabel or stop by name.
- `still-running` / `unconfirmed`: cleanup has not been established. Restore access and use the exact recovery command.

Overall `confirmed` additionally requires cancellation recorded, startup quiescent and no prepared-root owner lock. Local child errors are collected independently. A capture warning alone does not turn a confirmed shutdown into an unknown state. A zero helper exit without a matching session/build/root confirmation is insufficient.

The **20-minute timer is a local active window plus bounded cleanup, not an unconditional remote lifetime guarantee**. A machine crash, lost SSH, inaccessible Docker or blocked startup can leave remote state unconfirmed. Normal per-child shutdown waits5s then at most3s after kill; the stop helper has a160s SSH/action observation bound and the launcher grants190s for it. These bounds do not prove that an unreachable remote process has exited.

For unconfirmed state the launcher prints a literal recovery command, also stored with the report. Copy that command unchanged: it selects the exact backend session directory and UUID and runs `ops/watch-warm-candidate.py stop`. Stop remains available after the active window expires and needs no application bundles, allocation file, old startup receipt or log capture helper. It still needs the manifest/build identity. Repeating it is idempotent. Do **not** substitute generic `docker stop <name>`, edit ownership metadata, adopt a mismatched container, or remove a prepared lock. If a lock/identity mismatch persists, inspect that specific recorded owner and report before intervening.

## Proportionate validation

All checks are offline fixtures with fake Docker/SSH and real temporary ownership/locking files; no protected service or real watch is involved:

-10launcher checks: timed-out/failed/lost-success startup result, attempted flag persisted before invocation, normal local-window shutdown, unknown/mismatched confirmation, log-save failure, independent local cleanup.
-17remote lifecycle checks: normal/idempotent cleanup, capture failure, absent gateway, strict session/build/root checks, inaccessible daemon, failed/lost stop, retained stopped container, missing creation reply, late-start fencing, actual file-lock exclusion, failed fence write and preserved prepared lock/data.
-3CLI checks: stop without allocation/assets/deadline/capture helper, lost transport reported unknown, no adoption of legacy unlabelled sessions.

Python syntax checks pass. [Concise evidence](../artifacts/foreground-cleanup-hardening/summary.json). These are lifecycle tests, not a new live acceptance or performance certification. No TypeScript/application code changed; prior build/financial evidence is reused.

## One manual acceptance session

In the retained workspace:

```sh
cd /home/daz/workarea/iqterminal-integration-startup-r1
python3 scripts/watch-warm-foreground.py
```

The command verifies the existing tested assets/allocation, starts only its own isolated pair/tunnels/read-only watch harness/preview, and launches **no browser, build, benchmark or competing headless suite**. It refuses occupied ports or foreign resources. Manually select **i3 workspace9**, then open `http://127.0.0.1:4204` in normal Chromium.

Use the prior short [foreground checklist](watch-ack-warm-acceptance.md#foreground-handoff-ready-still-manual): current-ending30h USD-M15m Top8/side,10%,native; pan/zoom during validation; two genuine advances; Save Workspace, switch away and reopen; truthful gap/tail/completion and independent current/footprint progress. Watch traffic is the explicitly labelled empty read-only harness, not the protected real-watch service. Do not modify real watches.

Close the candidate tab and press **Ctrl-C in the launcher terminal**. Read the cleanup outcome before assuming anything is stopped. If unconfirmed, preserve both evidence directories and run the printed session-specific recovery command once access permits. Foreground usability/merge acceptance remains the user's decision. Main, production, incumbent, protected watches, collectors, prepared history and current allocation are unchanged by this tooling task.

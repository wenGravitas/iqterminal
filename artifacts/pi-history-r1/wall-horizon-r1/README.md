# Archive eligibility and pre-V3 restore evidence

Application sources:frontend ec670d9, backend8c7b66f; operation tools3c5e880.
Environment details and full identifiers are in `environment.json`.

- `frontend-focused-final.log`:73 focused checks, including pinned Retry.
- `frontend-full.log`:first run,1320 pass/one vault timeout/two skipped.
- `vault-isolated.log`:all8 vault tests pass with original timeout.
- `frontend-full-final.log`:second run,1316 pass/six failures/two skipped;
  fixed30ms footprint progress assertion failed and left shared work open.
- `footprint-batch-synchronized.log`:all8 pass after event wait/finally cleanup.
- `frontend-full-synchronized.log`:final1322 pass/two skipped, original timeouts.
- `frontend-build-final.log`:typecheck/production build pass.
- `browser.log`, `browser-results.json`, screenshot:one headless fixture notice
  check passes on the exact ec670d9 build. No actual-history loading gate claim.
- `backend/backend-full.log`:all367 backend tests pass.
- `backend/typecheck.log`, `backend/backend-build.log`:pass.
- `backend/snapshot-tests-final.log`:all5 operator-helper checks pass.
- `backend/snapshot-drill.log`, `snapshot-receipt.json`, `snapshot-postflight.log`:
  quiescent1213-file copy/restore, exact container IDs, protected continuity,
  storage/headroom and same-version owned service resume.
- `backend/executed-snapshot-drill.py`, `snapshot-script.sha256`:actual drill tool.
  Checked-in helper additionally rejects missing busy state.
- `backend/restore-{legacy,candidate}.log`, `restore-postflight.log`:both actual
  implementation readers exit0;16 views,547 canonical and547 projection parts;
  read-only/network-none containers and unchanged copied-tree checksums afterward.

The staging gateway/worker remain71f62d2/13730f7. Candidate installation,
rollback-copy byte reservation and all open Pi performance gates remain separate.

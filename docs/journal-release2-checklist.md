# Global Journal R2 acceptance record

Updated 2026-11-02. This records local acceptance for the product contract in [journal-release2.md](journal-release2.md). No production deployment or venue check was requested. Preserve unrelated worktree changes.

## Completed local gates

- [x] `pnpm exec vitest run tests/journal-*.test.ts tests/layout.test.ts tests/widget-registry.test.ts` — 9 files, 39 tests passed. This includes versioned R1-store reset/reopen, blocked/version-change behavior, unrelated-store preservation, cross-market chart-link indexing/import, per-attachment restore preparation, transactional rollback, asset GC, and Dockview/widget layout constraints.
- [x] `pnpm typecheck` — passed.
- [x] `VITE_DIAGNOSTICS=1 pnpm build` — passed. Vite retains its existing advisory that the main minified chunk is larger than 500 kB.
- [x] `pnpm exec playwright test tests/browser/global-journal.spec.ts tests/browser/global-journal-clock.spec.ts tests/browser/journal.spec.ts tests/browser/journal-restore.spec.ts` — 16/16 passed in local Chromium with the explicit diagnostic fixture and SwiftShader. Coverage includes the global feed, Today/timezone/DST behavior, optimistic edit recovery, draft resume and publish idempotence, camera flows, encoding/close/market-change freeze, DPR 1/2 composites, historical anchors, paste, marker bounds/focus, drawings, touch, and saved-chart restore.
- [x] Focused follow-up after extending the paste flow: `pnpm exec playwright test tests/browser/journal.spec.ts --grep 'paste inserts multiple inline images'` — 1/1 passed. The flow pastes two images at the caret, drops a third through the journal dropzone, previews all three, and discards the draft/assets.
- [x] Focused screenshot refresh after waiting for the durable save state: `pnpm exec playwright test tests/browser/global-journal.spec.ts --grep 'daily feed, safe Markdown'` — 1/1 passed.
- [x] Focused workspace-deletion flow: `pnpm exec playwright test tests/browser/global-journal.spec.ts --grep 'Copy chart image performs no journal write'` — 1/1 passed. The non-active Journal detour workspace is deleted while the main workspace's Journal and draft remain available.
- [x] `git diff --check` — clean.

The combined browser suite had one earlier flaky DPR 2 heatmap setup timeout; the DPR 2 case then passed alone and passed again in the final 16/16 combined run. The concurrent-edit flow passed after its assertion was corrected to require stable `(entryAt, id)` ordering rather than commit order for equal timestamps.

## Acceptance coverage

- [x] One-time R1 journal-store reset and R2 reopen persistence are verified with fake IndexedDB; blocked upgrades close older connections and permit retry. Unrelated stores remain intact in the fixture. No user-profile database was reset during these checks.
- [x] Text-only entries, safe Markdown, uploads, multiple pasted images at the caret, image dropzone handling, preview, captions/alt text, save/resume, reload, keep/discard, and unpublished-draft asset cleanup have deterministic/browser coverage.
- [x] Copy, Add, and Download semantics are covered locally: successful Copy is a stubbed `navigator.clipboard.write` path; denied Copy exercises the PNG fallback; Copy and Download do not write Journal records; Add saves a draft and publishes once only after Save. Encoding failure, quota failure, source market changes, and source-chart close are covered.
- [x] Multi-market chart links and selected-attachment restore preparation are covered in repository/model tests. Browser restore covers a saved chart attachment; marker UI/browser stress coverage uses one market and a 10,000-link synthetic fixture.
- [x] DST/date boundaries, live Today refresh, timezone changes, pinned historical dates, equal-time ID ordering, filters, and repository pagination are covered by focused tests.
- [x] Unsafe URLs/raw HTML, image content and dimension bounds, archive checksums and conflicts, transaction rollback, quota errors, optimistic edits, and reference-aware asset GC are covered by focused tests and browser cases.
- [x] Journal visibility across workspace switching, deleting a non-active workspace, close/reopen, reload, and the eight-chart limit is covered. The global-journal browser case deletes its Journal detour workspace, then confirms the active Journal and durable draft remain.
- [x] Dark desktop and narrow 390 px Ivory screenshots were refreshed and visually inspected. No blocking clipping or overflow appeared. Updated composer/preview captures show `Draft saved on this device.`.

## Evidence boundaries and remaining manual limits

- Clipboard success is validated through a stubbed browser API, and failure/download fallback through a permission-denied fixture. This does not verify the operating-system clipboard on a user's desktop.
- Drag-and-drop dispatches a browser `drop` event with a local PNG fixture; a physical pointer-driven file drop was not performed.
- Chart captures, chart fixtures, and the 10,000-link marker benchmark are deterministic local fixtures. They are not live venue data, staging or production checks, or hardware/Pi performance measurements. No 60 fps claim is made.
- The authorized R1 reset was tested against fake IndexedDB rather than an actual user profile containing R1 records. No user journal data was changed.

Suggested manual walkthrough remains: open Journal → save a text-only macro note → paste and drop images between Markdown paragraphs → preview and publish → camera Copy → camera Add, annotate and Save → verify its marker → reload and resume a draft → open the saved chart attachment. On the host browser, separately verify the real clipboard permission/result if that evidence is needed.

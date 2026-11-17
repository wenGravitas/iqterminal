# Verified wall revisions and current snapshots

Frontend8d103340b23057fbc1faf0f9069881d69634d9fc replaces terminal wall joins with full, independently fenced canonical revisions. Regression follow-up022c39c2af203f6fd6b07bf182c336a8ddd6fba5 verifies exact quiet means and history validation before current bootstrap. Follow-upa20a1986d7d1ddb1b51ce16b9eb87be0ce0ea28f keeps snapshot markers in the existing current/direct retention budget.

## Root cause and resulting behavior

A time-filtered terminal page can advance to the global cursor while omitting observations whose timestamps lie beyond its old upper bound. Continuing after that cursor loses those episodes. Integrating the old terminal accumulator also inserts an arithmetic boundary: an exact canonical mean100.1 can become100.10000000000001. Matching selected prices and quantities does not establish an exact historical continuation.

An advancing view now requests the full anchored range with after=0 and no terminal accumulator seed. Historical loading uses its own returned source fence. The existing server nonterminal-prefix verification/replay can prepare the new revision; no client continuation capsule or shared financial-kernel change is introduced. The displayed revision stays intact through preparation, decoding, validation failure and Retry. A validated replacement commits before the latest coalesced demand starts. Its coverage and gaps replace the old revision's metadata, allowing corrected gaps and records to disappear.

Current selected state is a separate frontend presentation kind, current-snapshot. Each valid point has a disjoint current-only ID, one exact quantity/notional/rank value at its source snapshot time, and zero episode duration. Its tooltip reports selected state and confirmation time. It does not claim a cumulative canonical episode mean or span. Current updates never confirm, censor, clone or remap the historical projector. Current gaps are reported separately from the canonical revision's gap metadata.

A current snapshot requires a ready, fully consumed current fence. Late joins during multipage catch-up or a transport failure cannot promote cached state to live. Scope follows the current side's book coverage; unknown coverage remains partial. Invalid/stale/reset state removes current markers. Point geometry stays at its own source time when later status confirmations arrive. The renderer's existing one-pixel minimum supports an observed point without inventing a duration.

History starts independently of current bootstrap. Retargeting an obsolete offscreen initial request preserves the current group and acknowledged cursor. The old bridge page ring is removed. Snapshot retention uses the existing current/direct budget, preserving historical capacity and keeping stale snapshot references separate from the historical value queue. No configured limits are raised.

## Correctness evidence

The original terminal-extension implementation fails the new full-range request regression. The repaired service includes a timestamp-ahead episode below the old terminal cursor and matches the full canonical reference exactly. A separate quiet revision asserts exact mean100.1 and duration14ms. Other regressions cover:

- Good history and loadedThrough retained through invalid-profile replacement failure and successful Retry, with one unchanged current bootstrap.
- Corrected gaps replaced at revision commit.
- Two charts sharing an already-ready target revision, without restoring stale loading metadata.
- Ready historical content displayed while current bootstrap remains pending.
- Catch-up, failed-poll, invalid-source and epoch-reset current marker lifecycle.
- Complete→partial→complete book scope without changing candidate identity or values.
- Byte-identical canonical rows across current updates and fixed point geometry through later confirmations.
- 7,000 snapshot replacements with unchanged canonical rows, bounded stale references and empty queues after clear. The old retention classification fails this regression.

The focused service/importer/chart/retention run passes138 tests and typecheck. Before the retention-only follow-up, the complete single-worker suite passes1314 tests with two existing skips, and all10 headless native-chart UI checks pass. The final retention follow-up passes the full1315-test single-worker suite with two existing skips, typecheck, the production build, and three targeted headless native-chart checks. The latest browser source is4615dcf62533690654dc094529b4c3956356d74a. Its snapshot-only case reports zero historical archive rows and one current row. Test timeouts and performance gates are not widened.

The shared financial kernel remains byte-identical to the backend. Profile/core hashes, canonical source, prepared public manifest format, units and saved settings are unchanged.

## Browser and operational scope

The native-chart UI check is an explicitly selected diagnostic fixture, compiled with VITE_DATA_MODE=direct, VITE_HISTORY_TILES=0 and VITE_DIAGNOSTICS=1. It verifies actual chart controls, cleanup, Fit Walls and snapshot tooltip behavior. It uses headless Chromium/SwiftShader on the Pi; it is not a staging-history, venue, foreground, frame-rate or latency acceptance result. The screenshot footer identifies FIXTURE. A preview-directory argument error is preserved separately; the corrected isolated build and preview complete successfully.

The isolated preview uses4192 and exits after testing. All new browser tests stay headless; no test window is mapped onto the user's working i3 workspace. Staging worker13730f7 and gateway71f62d2 remain unchanged. The fresh read-only postflight verifies their exact IDs and the original API plus seven protected services, with zero consumers/readers/pins. No collector, raw retention, production deployment or main merge occurs.

Retry retains the displayed good revision and healthy current subscription. A source revision failure restarts/resumes historical work through the existing explicit Retry protocol. Ordinary polling does not reset the build. Rollback restores the previous isolated frontend bundle without changing collectors or backend files; that older bundle retains the known terminal-join bug, so it is not an accepted performance release. Historical-only wall views avoid that old live join while comparing the prior build.

## Remaining release work

Eligible past-range clamping, fast ready-prefix discovery and immutable closed-record reuse across revisions remain pending. The existing batch cache shares in-flight requests; it is not a persistent cross-revision record cache. Final cooperative restoration still visits the complete history. These fixes therefore do not establish prepared30h loading acceptance.

Both latest measured30h wall gates remain failed. Current-only timing, warm revisits, concurrent history/custom profiles, retained-heap/frame measurements, current-candidate footprint recertification and normal foreground Pi UX remain incomplete. The V3 writer also needs its guarded snapshot/restore drill before serving installation. The full goal remains active and incomplete.

[Raw evidence and checksums](../artifacts/pi-history-r1/verified-wall-revisions-r1/evidence-sha256.json) include the failing counterfactuals, successful regressions, full suite, exact build environment, browser report, native-chart fixture screenshot, source refs and read-only staging identities.

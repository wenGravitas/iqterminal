# Chart journal — Release 1

IQTerminal's journal is local to this browser profile and origin. It captures a visual record and immutable chart settings, with optional reasoning and later reflections. It does not preserve market history for replay. No new market connections, server journal API, collector retention changes, provider AI calls, broker imports or execution actions are involved.

## Daily workflow

1. Draw a rectangle zone. Its Style dialog provides border color/width, fill color/opacity and **Extend zone right**. Choose **Projected path** from Lines, click its vertices and double-click to finish. Arrow uses two anchors; Brush finishes on pointer release. Escape cancels unfinished placement.
2. Click **Quick journal capture** (camera icon beside Return to latest candle), or focus the chart and press **Alt+Shift+J**. The snapshot and rendered image freeze immediately; the success toast opens the committed entry. Shift-click captures and opens the editor. Right-click the capture button also offers **Capture and annotate**. Chart/drawing context menus offer these actions at the clicked market time.
3. Open the entry and optionally fill title, note, tags, thesis, confirmation, invalidation and planned action. Save notes. Expand **Note history and reflections** to add a timestamped reflection; the original thesis and capture remain in history.
4. Successful capture enables the built-in **Journal** indicator on the originating chart. Hover or focus its marker for a lazy preview; click/tap for the entry. Cluster markers open an entry list. Escape/outside click dismisses a preview. Journal has normal picker, Object Tree visibility/settings/removal controls. Hiding/removing it never deletes entries.
5. Reload, open Journal from the footer, and filter by current/all instruments, observation date, exact tag or text. Select an entry to see its original screenshot and notes. Opening or closing the native journal aside does not recreate a chart or restart its feeds.
6. Choose **Open saved chart**. A new chart uses a fresh drawing persistence scope and remapped instance/pane/drawing/folder references. It is labelled **Restored settings · current history, not replay**. The eight-context budget still applies: free a slot if full. The originating chart and saved capture remain unchanged.
7. Download PNG for an individual visual record. **Export entry** or **Export filtered** produces a complete JSON backup including images, immutable snapshots and note revisions. Import that backup on the intended browser/origin. Matching IDs are skipped; conflicting captures fail the transaction without overwriting originals.

## Timestamp and capture semantics

All stored times are UTC epoch **milliseconds**. Native chart/drawing anchor times remain the engine's epoch **seconds**, converted explicitly at the boundary. The UI uses the existing workspace timezone; dates in filters are interpreted in that timezone, including DST.

- `createdAt` and `capturedAt` are actual entry/capture time. `updatedAt` changes only when notes/reflections are saved.
- `marketTime` is the exact chart context-menu anchor, or the latest observed candle's opening timestamp for a header capture. Header capture does not invent an execution timestamp that the candle feed has not published.
- Earlier context anchors are marked retrospective: **Observation** and **Captured** are shown separately. Capturing now while annotating yesterday is a screenshot from now.
- `dataAsOf` is the latest published chart receipt time, not a preserved raw execution cutoff. Per-layer coverage records observed ranges, quality and gaps when the provider publishes them; unknown values remain null. The last candle's OHLCV/closed flag is retained to identify a partial forming candle.

The capture action synchronously flushes existing chart/DOM indicator renderers, reads completed in-memory drawings and settings, and copies the engine's native layered canvas image before yielding. It then freezes chart-relative DOM pane headers, labels, legend/control ink and the marker lane. Encoding uses this detached frame, so subsequent live updates, market changes, closing the source or opening the editor cannot mix states. Menus, crosshair hover, transient preview portals and the editor are excluded. Unfinished drawing placement blocks capture until finished or cancelled.

The PNG includes the chart and indicator panes, axes, visible drawings and rendered native overlays (including footprint and heatmap canvas layers). Selected drawing handles are retained as visible chart ink. A metadata strip records market, interval and actual UTC capture time. DOM control SVGs are composited separately; a failed icon marks the screenshot partial and lists the warning. Capturing a hidden/empty chart is rejected. Output uses up to DPR 2 and a 32 megapixel cap. Font rasterization and browser/DPR can differ between devices.

Encoding/storage failure does not emit success. A frozen draft remains in this tab with **Retry frozen capture**, **Save note only** and **Discard capture draft**. Note-only requires that explicit choice and records the screenshot failure. Retry uses the original capture/entry IDs and frame. Double clicks share one pending capture; up to eight unresolved drafts are retained. Unsaved drafts and unsubmitted note text are memory only: resolve them before closing/reloading the browser.

## Storage, backup and recovery

`JournalRepository` is asynchronous and separate from chart persistence. IndexedDB database `iqterminal-journal-v1` stores `entries`, `captures` and image `assets`. One transaction commits a complete bundle; notifications follow transaction completion. Images are Blobs, never Dockview parameters/localStorage. Entries are keyed to exact canonical venue/market/symbol (and aggregation membership where recorded), independent of panel IDs and timeframes. Deleting a chart does not delete journal entries.

The browser may deny storage or exhaust quota. Errors remain visible; no whole-journal reset or automatic eviction occurs. **Storage use** shows image bytes/count plus available browser-origin estimates. **Keep local storage** asks the browser for persistent storage, which it may decline. Clearing browser site data can erase everything; keep exported backups outside the browser. Exports may include private analysis and captured visible account overlays, so store them accordingly.

Deletion requires confirmation and removes only the selected entry and captures/assets with no remaining reference. Note revision updates use an optimistic revision count; a second editor must reopen a concurrently changed entry. Corrupt/future records are preserved and reported, not silently repaired or erased. Backups are validated before one transactional import. Unsupported schemas, invalid PNG structure/dimensions/checksums, incomplete assets and conflicting IDs abort import. Duplicate imports preserve existing notes rather than replacing later edits.

Limits: 1,000 entries and 100 MB per backup/import, 20 MB per image, 8 MB per snapshot, 32,000 characters per note/reasoning field, 24 tags, 200 note revisions and 2 MB total note history per entry. Export/start a follow-up entry if note history reaches its cap. Search examines up to 10,000 indexed candidates per query; narrow instrument/date filters for larger journals. This is not a full-text server index. Rows/thumbnails load in pages of 100; images load lazily.

## Version 1 records

- `JournalEntry`: stable ID/capture ID, exact canonical market key, observation/capture/create/edit timestamps, retrospective annotation, current editable title/note/tags/structured reasoning, append-only original/edit/reflection revisions.
- `ChartCapture`: immutable capture ID/time, image and thumbnail asset references, complete/partial/note-only status and warnings, snapshot and replay manifest.
- `ChartSnapshot`: app/engine versions, exact market, interval/bar presentation, current full `PanelConfig` composition/studies/indicator settings and source links, stable pane membership/order, native series/style/scale descriptors, visible timestamp range, live committed drawing document, Object Tree metadata, relevant display preferences, partial candle state, layer provenance and exact script revision/hash with safe available local source. It excludes alerts, trading-account configuration, credentials and unrelated workspace panels.
- `ReplayManifest`: version, market, requested visible range, observed data cutoff, per-stream coverage/gaps/source/quality and known SMA warm-up bars. General warm-up is unknown. Screenshot/chart state are available; `retention: unpreserved`, `playback: not-implemented` are explicit. There is no enabled replay action.

Captured objects are detached/frozen and never mutated by template changes, live drawing edits or note edits. Imports render notes as text. Script source in an archive is evidence only: never installed or executed. Restoring a script requires the exact revision and hash already in the local script library; otherwise its instance remains unavailable with a warning.

## Restore boundaries

Native supported markets/timeframes are restored exactly; an unsupported market or aggregation is refused, never replaced. Current composition and linked indicator identities are remapped, pane weights/collapse and available scale modes/manual ranges restored, price source styles and timestamp viewport applied, drawing anchors/styles and tree folders copied into the new panel. Missing pane producers cause their drawings/scales to be omitted with warnings instead of being assigned to another pane. Missing history is reported; blank dates are not reconstructed. Non-time bar marker anchors are only used when an exact original timestamp exists; R1's exposed native charts use time bars.

Workspace theme, timezone and currency remain current preferences; their captured values are retained as evidence. Source axis assignments and available axis placements are restored through the native API. Opaque/unsupported native pane/scale producers may not reproduce exactly. Native indicator results recompute from currently available history; captured caches, raw ordered executions, historical heatmap observations and old script runtime state are not restored. The PNG is the visual record. Fixed-range volume profile remains follow-on; no candle-volume estimate was introduced.

## Marker performance and lifecycle

One Journal lane sits outside the plot, avoiding price autoscale and footprint totals. Exact instrument and visible timestamp range plus 10% margin are queried using compound IndexedDB indexes, debounced/quantized across forming-candle updates. A query returns at most 500 entries and the lane at most 100 clusters; a cap notice asks users to zoom in. Positions cluster by screen-space distance (12–64 px setting), not timestamp rounding. Missing candle coverage and future intervals do not receive fabricated anchors.

Existing dirty-visible-chart scheduling owns marker drawing. Keyed buttons retain focus through incremental redraws; events are delegated. Queries, timers, subscriptions and object URLs are disposed with the chart; repository changes propagate across open charts/tabs. No screenshot encoding or full-journal scan occurs on ticks. The native aside is not another Dockview contentComponent, so saved workspace versions and chart budgets are unchanged.

## Verification and evidence

Focused unit tests cover schema/UTC/canonical isolation, immutability and note history, PNG bounds, transactional IndexedDB saves/rollback/deletion/import, safe restore/remapping and native drawing contracts. `tests/browser/journal.spec.ts` uses explicit fixtures for capture/edit/reload/markers/restore, encoding and quota failures, historical annotations, switching/closing during encoding, backup round trip, native arrow/path/brush and DPR 1/2 footprint/depth/CVD composites. Existing drawing/sidebar/floating-toolbar/Object Tree/composition/layout suites provide regressions.

See `artifacts/journal-candle-cvd.png`, `artifacts/journal-footprint-heatmap-dpr1.png`, `artifacts/journal-footprint-heatmap-dpr2.png` for actual encoded output, not a screenshot of the editor. `artifacts/journal-marker-benchmark.json` records the local Chromium/SwiftShader environment, 10,000-entry synthetic fixture, indexed query latency and bounded marker diagnostics. These checks do not certify live venue connectivity, historical retention or Pi frame-rate performance.

## Follow-on contracts

Candle playback must start paused at the chosen cutoff and hide future bars and future-dependent indicators. Intrabar footprint playback requires retained ordered executions: final bar/cell totals cannot reconstruct trade order. Heatmap playback requires retained observations or consistent snapshots/deltas with explicit coverage boundaries.

Preserved replay windows need backend retention pinning that survives normal executions/OI seven-day TTL and completed-depth one-day expiry, includes indicator warm-up, has explicit byte budgets/reference cleanup and exposes gaps. Saving a history URL is not preservation. Capture-time drawings, including projections beyond the cursor, must remain frozen; later drawing revisions cannot leak into an as-of review.

Future AI review must distinguish as-of evidence from outcome-aware analysis, require opt-in submission, cite entry/evidence IDs, avoid browser-held provider secrets and state statistical limits. R1 stores reasoning/revisions for that work but makes no AI calls. Cross-device sync, retention pinning, full replay and new volume-profile computation are separate releases.

## Recorded release checks

The local release check completed with 921 unit tests passed and one existing skip (115 passing files), focused typecheck, diagnostics build and normal `pnpm build` passed. Vite's existing large-bundle advisory remains. There are 39 distinct passing selected browser checks, including 10 journal checks. The 38-case regression run reached 36 passes; the two remaining long cases passed in focused reruns after fixing their moving fixture timestamps and crowded-layout/hidden-sidebar assumptions. These are results across runs, not a claim of one uninterrupted clean 39-test run.

A startup defect found by the composition checks was fixed: saved linked-indicator rows now wait until the chart output registry exists, avoiding Dockview's fallback to a fresh layout. The selected browser checks cover that reload and independent journal restoration.

The inspected footprint/heatmap PNGs are 1286 × 831 at DPR 1 and 2572 × 1662 at DPR 2. The latest 10,001-record synthetic journal measurement returned 122 rows for a one-hour indexed query in 26 ms, with a 1.62 s bulk fixture write. The normal view used 372 queried entries/26 clusters and made no repeat query during its idle check; zooming out hit the 500-entry cap and rendered 17 clusters. These timings describe this local run only. See `artifacts/journal-verification.json` for the check inventory and `artifacts/journal-marker-benchmark.json` for raw counters.

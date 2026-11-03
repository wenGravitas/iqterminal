# Global trading journal — Release 2

Release 2 is the current local trading diary. It replaces the chart-first R1 aside with a Dockview panel that works from any workspace and can hold entries with no chart context. Each workspace can keep at most one Journal panel open; the application-level IndexedDB repository remains available while workspaces are switched, closed, duplicated, or deleted. The journal uses no chart context slot and does not start an exchange connection.

When a new Journal panel opens in a workspace narrower than 640 px, it docks below the active group to retain the full available reading width; desktop opening keeps the existing right-side placement. The Journal's date, filter, post and composer layouts also respond to the Journal pane width.

## Daily feed and entries

The feed opens on Today, with newest-first posts and an optional oldest-first view. Previous day, date input, next day, and Today change the selected date. Today remains a live mode: it advances at midnight in the selected display timezone and refreshes after timezone changes or when the tab becomes visible again. Choosing another date leaves the feed pinned to that date. Search can cover all dates; tag, kind, and explicit chart-instrument filters can be cleared independently.

An entry can contain Markdown text, one or more inline images, or both. Title and tags are optional. The default kind is Note; other kinds include Outlook, Setup, and Review, with room for future kinds. Saving an entirely empty entry is rejected. Macro notes do not need an instrument or screenshot. Chart attachments identify their exact canonical market, the chart market-time anchor, actual capture time, data-as-of time, and available layer coverage. Generic images do not acquire invented market metadata.

`entryAt` controls the daily feed position and may be edited for retrospective notes. `createdAt` records when the entry was first created and remains stable when the entry time changes. A chart attachment keeps its own immutable `marketTime` and actual `capturedAt`; these timestamps are never inferred from one another. Date queries use the selected timezone's half-open local day `[start, next midnight)`, including DST transitions. Equal `entryAt` values sort by stable entry ID. Pagination uses the same timestamp-and-ID pair, and changing sort order does not change date semantics.

## Writing and drafts

The shared new/edit composer keeps Markdown source durable and offers a preview plus common heading, list, link, and image controls. Paste, file upload, and drag-and-drop add bounded image attachments at the caret; multiple images may be interleaved with text. Alt text and captions can be changed or an attachment removed. The renderer disables raw HTML, accepts only safe URL schemes, resolves local attachment references by ID, and does not fetch remote images.

New and edited work autosaves to IndexedDB as a resumable draft. Drafts are separate from published entries and chart markers. A pending/saved/error state remains visible; storage errors preserve the draft in the editor when possible. Closing the panel or reloading does not discard a committed draft. Cancelling offers to keep or discard the draft. Edits preserve `createdAt` and use optimistic revisions; if another tab changes an entry, the composer reports the conflict and keeps the user's work recoverable instead of overwriting the newer revision.

## Chart camera and saved context

The camera menu has three actions:

- **Copy chart image** freezes the existing native compositor output and writes a PNG through `ClipboardItem` in the click gesture. Unsupported or denied clipboard writes fall back to a PNG download. A copy/download status is shown only after the image has encoded and the fallback has been started.
- **Add to journal…** synchronously freezes the screenshot and chart snapshot before opening the composer. It then encodes the detached frame and stores it as an unpublished chart attachment in a durable draft. The journal entry and marker do not exist until Save commits the entry, attachments, and assets. Cancelling and discarding the draft leaves no marker; unused image assets are collected only after all draft, entry, and retained-revision references are gone.
- **Download PNG** downloads the detached compositor result without creating a draft, entry, or marker.

All three actions are also available from the chart context menu. Alt+Shift+J opens the same Add-to-journal flow. Partial compositor warnings or encoding failures are shown with retry, explicit continue when an image is partial, and discard. Screenshot, snapshot, DOM labels, drawings, and chart overlays are frozen before asynchronous encoding, so live updates, market changes, chart closure, or dialog resizing cannot mix a later frame into the attachment.

Saved chart attachments remain immutable. **Open saved chart** creates a fresh panel, remaps local chart references, and restores settings and drawings over currently available history. This is not replay and does not extend backend retention. If the eight chart-context budget is full, restore reports the limit while the saved image and attachment details stay available.

## Markers

The existing Journal indicator reads only explicit chart-context attachments, using a dedicated index on canonical instrument and immutable chart `marketTime`. Generic images and text-only posts never create markers. Multiple captures and instruments may belong to one entry; marker clusters retain access to each attachment. Positioning uses observed chart coverage, adds no autoscale/tick work, and is bounded by the viewport query and cluster limit. Hiding or removing the indicator leaves entries and attachments intact. A marker opens its entry at the corresponding local date without forcing the instrument filter; the feed still orders by `entryAt`, not chart `marketTime`.

## Local storage, upgrade, and backups

R2 uses a versioned upgrade of `iqterminal-journal-v1`. On the first R2 open, `onupgradeneeded` clears only the existing journal `entries`, `captures`, and `assets` stores, then creates the R2 entry, draft, asset, and chart-link stores/indexes. The browser's normal IndexedDB version-change flow closes older tabs; blocked upgrades show a close-the-old-tab/retry message. There is no startup reset. Charts, drawings, templates, object trees, scripts, workspaces, settings, and trading credentials are not read or changed by this upgrade. Existing R1 exports remain external; R2 reports unsupported older archives instead of treating them as live records.

Entry/draft, attachment, and image asset references commit in transactions before the UI reports success. PNG, JPEG, and WebP uploads are content-validated, bounded, checksummed Blob assets, not base64 Markdown or Dockview parameters. Entry deletion, draft discard, and attachment removal collect only unreferenced journal assets. Quota, permission, blocked, corrupt-record, and future-schema errors are visible; no broad database deletion or automatic cache eviction is used. Cross-tab notifications refresh feeds while preserving an active editor and its selection.

R2 archives include Markdown, timestamps, tags/kinds, attachments, immutable snapshots, retained revisions, and image checksums. Import validates bounds and every asset before a transaction. Identical IDs and complete records are skipped; an ID reused for different content is reported as a conflict and never silently overwritten. Keep exported backups outside browser storage; browser site-data clearing can remove local entries. Export may include private analysis and chart overlays, so store it accordingly.

## Follow-on boundary

The journal does not sync to a server, call AI, import trades, calculate P&L, create orders, or claim playback. A future trade-event contract must identify venue, account, instrument, actual fill time, side, quantity, price, fees, source fill ID, and deduplication/grouping rules. Orders are not fills, and chart clicks are not fabricated trade events. Replay remains a separate feature requiring retained ordered source observations and explicit coverage.

## R2 local acceptance (2026-11-02)

The current local acceptance record is in [journal-release2-checklist.md](journal-release2-checklist.md). It records 39 passing focused Journal/layout/widget tests, successful typecheck and diagnostics build, a 16/16 selected Chromium fixture run, and targeted paste/drop, workspace-delete, and saved-state screenshot reruns. This evidence covers local IndexedDB, deterministic fixtures, and browser UI only. It does not certify a user's real system clipboard, live venue connectivity, production behavior, or hardware frame rate.

## Optional manual verification on your browser

The automated workflows and local results above are the completed R2 acceptance record; the items here are optional host-specific checks and do not represent unfinished implementation. Do not use a browser profile with valuable R1 journal data for the reset check: the automated upgrade test already verifies the targeted store reset and R2 reopen behavior with fake IndexedDB.

- In a disposable profile containing seeded R1 journal stores, confirm the one-time journal-only reset and R2 persistence after reload.
- In the host desktop browser, confirm a permitted Copy writes the image to the system clipboard and a denied permission starts the PNG download fallback.
- Physically drag a local PNG file into the composer dropzone. The automated browser test dispatches a `drop` event with a local image fixture.
- If desired, walk through Open Journal → save a text-only macro note → paste/drop an image → preview and publish → Camera → Copy chart image → Camera → Add to journal… → annotate and Save → confirm the chart marker → reload → resume a draft → open the saved chart attachment. No step should restart market feeds or consume a chart context slot except **Open saved chart**.

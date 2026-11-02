# Multiple workspaces and terminal footer — Release 1

## Everyday use

The left side of the footer shows the active workspace. Open it to search, create, rename, duplicate, select an icon, pin or delete a workspace. New workspaces can start empty or with the standard Binance chart. Pinned icons switch with one click; their tooltips and accessible labels use the full name. Drag icons to reorder them, or focus one and press Alt+Left/Right. Tab navigates the shortcuts.

**+ Add** opens a searchable widget menu grouped into Charts, Orderflow, Liquidity, Trading, Monitoring and Tools. It uses the actual supported constructors, the eight-context chart/comparison budget, the existing per-widget limits, and focus-existing behavior for singleton widgets. Disabled options explain their limits. OpenScript requires an available chart target. New widgets retain the existing placement and initial-size behavior.

The right side retains global Hyperliquid trading state, Notifications, monitored feed status and Market Pulse/clock/session information. The application menu contains workspace management, global settings, Journal, appearance, **Reset Current Workspace**, diagnostics when enabled, and Licences/About. These controls use their existing controllers/popovers. Reset and deletion require confirmation; normal switching and automatic saves do not.

At desktop widths the footer remains 34px. At narrow phone widths it uses two compact rows so operational status and workspace/Add controls stay accessible. Pinned shortcuts have a bounded scrollable area; the footer itself does not horizontally scroll. Dark and Ivory share the existing terminal palette, typography and square controls.

## Architecture and ownership

`WorkspaceManager` owns the registry and transitions. Dockview `toJSON()` / `fromJSON()` remain the layout foundation; every captured/opened layout goes through the existing version 1–8 validator in `src/layout.ts`, including component and panel-count restrictions. No chart budget or trading-param validation was weakened.

`src/workspaces/model.ts` defines metadata, validated layout copying, ID remapping and defaults. `manager.ts` handles migration, saves, recovery and the panel-storage port. `switcher.ts`, `icons.ts`, `menu.ts` and `footer.ts` own native DOM controls. `src/widgets/registry.ts` defines widget labels, categories, descriptions, availability, singleton policy and creation actions; `widgets/menu.ts` renders the picker. `src/main.ts` supplies the existing widget constructors and the Dockview host adapter.

FeedClient, Scheduler, TradingController/worker, signing ownership, notifications, Market Pulse, connection status, OpenScript library, global drawing templates, theme and currency preferences are created once per app. Switching clears only outgoing Dockview widgets. Chart, ticker, comparison, script editor and trading-widget disposal follows the existing contracts. The global trading controller is never disposed or disconnected by a workspace switch. Positions, orders, order attempts and notifications therefore remain global. The Journal also remains global and instrument-scoped. Level Watch's shared monitoring definitions/service remain global; the Level Watch widget instance belongs to its workspace.

The host flushes outgoing changes synchronously, suspends saves, clears outgoing widgets, updates active ownership, then restores the validated incoming layout. Clear/fromJSON events cannot autosave an intermediate empty layout. On failure, registry contents are preserved and the outgoing layout is restored where possible. If both restores fail, autosave is inhibited until a usable workspace is opened or created. There is no browser reload and no inactive live Dockview tree.

## Persistence and migration

The canonical localStorage record is **`iqterminal:workspaces:v1`**:

- Registry: schema version, revision counter, active workspace ID, workspace list.
- Workspace: stable ID, name, icon, pin state/order, UTC millisecond creation/modification times, serialized Dockview layout and `panelState` records.
- Limits: 64 workspaces; existing 100,000-character layout validation remains; registry up to 16,000,000 characters; each panel record up to 4,000,000 characters and at most 5,000 records per workspace. Browser quota commonly imposes a lower limit.

On first upgrade, a valid `basis.layout.v1` becomes **Main Workspace** with its original panel IDs. Existing drawing documents, Object Tree folders/sidebar preferences for those chart IDs are collected at the same time. The new registry, layout and sidecars commit in one localStorage write. Existing legacy layout and panel keys remain untouched as a recovery source. Subsequent launches use the registry and do not repeat migration. A failed write retains a complete session copy and displays **Session only**, with a Retry saving action. A failed/corrupt migration never writes an empty layout over the originals.

The drawing controller's original instrument keys are retained logically inside `panelState`:

- `iqterminal:drawings:<panel>:<venue:market>:<symbol>`
- `iqterminal:object-tree:v1:<panel>:<venue:market>:<symbol>`
- `iqterminal:object-tree-sidebar:v1:<panel>`

`workspacePanelStorage` is used only at these existing storage seams. It is not a global localStorage monkey patch. Native drawing validation/corrupt-record handling remains authoritative. Templates, account/signing state and other global preferences keep their original stores.

Atomic inclusion of sidecars avoids separately writing a catalog entry before all duplicated drawings have copied. A duplicate gets new workspace and instance IDs for charts, comparisons, tickers, liquidation tickers and depth matrices. Dockview panel maps, nested tab/grid references and chart-target references are remapped consistently. All saved instrument sidecars are copied to fresh chart scopes, including sidebar settings and folders. Indicator instance/source references within one chart remain intact. Fixed singleton IDs are safe because only one workspace is live and they have no mutable chart sidecar state.

Drawing documents for closed charts remain in their owning workspace, matching the incumbent retention behavior; reset replaces only the current layout and keeps those records recoverable. Explicit workspace deletion removes that workspace's registry entry and its sidecars. It never deletes another workspace, the legacy recovery keys, journal captures, global templates or trading data. Deleting the final usable workspace is refused.

## Failures and limits

Denied/full storage shows a persistent footer warning and retains complete in-memory state. Reloading before a successful retry can lose session-only changes. No automatic eviction is performed. Unsupported/corrupt registry versions are left byte-for-byte untouched and opened in a protected session recovery mode. Invalid individual layouts are retained, with another usable workspace selected and a notice when available. Unknown widgets or over-budget layouts are never silently accepted. A separate tab changing the registry is detected before writes; this tab stops overwriting storage and asks for reload/reconciliation. R1 does not provide collaborative cross-tab editing or conflict merging.

Synchronous localStorage serializes registry data on committed changes and the existing debounced layout save, not on market ticks. Very large drawing catalogs remain constrained by browser quota. A future asynchronous repository can replace this persistence seam, but R1 does not add IndexedDB/cloud workspace synchronization or import/export. The legacy originals are a recovery source, not a replacement for browser-profile backups.

## Verification

`tests/workspaces.test.ts` covers migration/idempotency, UTC metadata, empty workspaces, outgoing flush, independent panel ID/sidecar copying, pin order, rename/icon changes, deletion/reset, restore rollback, denied/quota writes, future/corrupt records, validation failure and concurrent-tab protection. `tests/widget-registry.test.ts` covers actual widget definitions, caps and singleton policy.

`tests/browser/workspaces.spec.ts` uses explicitly selected synthetic fixtures for migration, drawing/folder duplication, UI management, pin drag/keyboard reorder, rapid repeated switches, pending saves, subscription counts, stable global service identity, reset/deletion, widget limits/singletons, storage failures, recovery and Dark/Ivory desktop/narrow geometry. Existing drawing/Object Tree, floating toolbar, journal, connection-status, Market Pulse and workspace-default checks exercise the updated UI/persistence seams. `tests/browser/footer-actions.ts` centralizes the new menu interactions for incumbent tests.

Screenshots are under `artifacts/workspaces-*.png`. These are local fixture checks, not evidence of live venue connectivity, an authenticated account or Pi frame-rate performance. No backend changes, deployment, cloud sync, workspace sharing/import/export, thumbnails, templates or simultaneous active layouts are part of this release.

## Recorded release checks

- `pnpm typecheck`: passed.
- `pnpm test`: 933 passed, one existing skip; 117 passing test files.
- `pnpm build`: passed; the existing large-bundle advisory remains. Diagnostics build also passed.
- 57 distinct selected browser checks passed across the regression and focused acceptance runs. The first 45-case run had four obsolete test assumptions; all four passed after updating their fixture storage/menu interactions and the Footprint bar-count assumption. The final 20-case acceptance run passed, including 12 workspace UI checks and composition, journal restore, rectangle preview and trading regressions. The strengthened mocked-account continuity check also passed separately. This is coverage across runs, not a claim that the full Playwright suite was run.
- In the local Chromium/SwiftShader fixture check, twelve synchronous one-chart transitions took 934 ms total (about 78 ms each). All twelve outgoing engines were disposed; after adding/restoring a second chart, two active panels and two candle subscriptions remained. FeedClient, TradingController, notifications and script library identities were retained. This times synchronous construction only, not network history loading, full-frame paint latency or hardware FPS.
- A mocked account retained its principal, agent address, unlocked signing state and signing ownership during a switch away and back, with one trading worker. No real account or order execution was used.

See `artifacts/workspaces-verification.json` and `artifacts/workspaces-resources.json`. Inspected Dark/Ivory screenshots cover 1366px and 390px footers, the workspace switcher, categorized Add Widget menu and application menu. No production deployment was performed.

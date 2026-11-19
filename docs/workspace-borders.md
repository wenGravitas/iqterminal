# Four-sided workspace borders

## Architecture and decision

IQ pins `dockview-core` 8.4.1. Widget factories are native DOM renderers in
`src/main.ts`, with the catalogue in `src/widgets/registry.ts`, compact native
tabs, and the existing Basis theme. There is one Dockview instance. Floating
windows remain disabled. The footer and chart-local drawing sidebar remain
outside the docking layout.

Core ships four edge groups with native tab ordering/transfers, constrained
splitters, collapse/expand, and `edgeGroups` serialization. The declared
AutoEdgeGroup and AutoHideEdgeGroup services are not included in the installed
core bundle. Enabling those options alone would not implement the feature.

The application therefore adds a small adapter around native edge groups. It
recognizes the outer 24 pixels of the workspace during a native drag, displays
four labelled targets with active-side highlighting, and moves the existing
panel via `panel.api.moveTo`. Central docking remains native. Escape cancels a
pending drop. Empty borders are removed only after their panels have moved.
No second layout manager, React, new dependency, backend change, or migration is
introduced. [FlexLayout](https://github.com/caplin/FlexLayout) is the interaction
reference, not a runtime dependency.

## Usage and compatibility

Drag any registered widget tab to a highlighted workspace edge, between tab
strips, or back into a central pane. Tab context menus also offer all four border
destinations and “Move to central workspace”. That command creates a central
group when the workspace currently contains only borders.

Use the native splitter to resize. Newly created side borders start at 300 px;
top/bottom borders start at 240 px. Bounds are 120–800 px, further constrained by
available layout space. The minus/plus header control collapses/expands a border;
the retained tab strip can also reopen it. Empty borders occupy no space.
Temporary hover peek is deliberately deferred.

Native serialization retains dimensions, collapsed/visible state, tab order,
selection, identities, configuration and constraints. Workspace capture,
switching, duplication and reload use the existing registry. Optional border
metadata is validated for invalid sizes, missing/duplicate panel references and
central/border overlap. Legacy layouts without borders are unchanged. Corrupt
saved data follows the existing recovery path rather than being overwritten.

No widget-specific docking allowlist is added. The registry currently includes
Order Book, Level Watch, trading history, journal, charts and other existing
widgets; it does not contain a standalone watchlist widget.

## Lifecycle

Docking, resizing and tab switching retain renderer instances. Chart engines,
candle arrays and configuration are not recreated for border moves. Core's
`isVisible` does not reflect edge collapse, so a shared application helper combines
panel visibility with group collapse state. It rebinds group listeners when a
panel moves and disposes them on teardown. Charts, comparisons, order books,
trade tickers and liquidations use this effective visibility to stop hidden
rendering. Expanded border charts also participate in the restore feed plan.

Workspace switching retains its existing clear/fromJSON behavior and reconstructs
widgets. Worker-owned caches remain independent of their DOM instances. Some
expensive studies and order books release subscriptions when hidden and reconcile
on expansion. Bounded cache eviction, source changes, gaps and newly visible
history can legitimately require data; this feature does not promise indefinite
retention or eliminate all network activity.

## Validation and limits

- 116 focused unit tests pass across layout/workspace, border hit-testing,
  persistence/duplication, effective visibility, restore bootstrap, tab cycling,
  and order-wall archive/staging services.
- All 11 border browser scenarios pass: four-side save/reload, real pointer edge
  docking, cross-border moves, reorder, Escape cancellation, splitter drag,
  workspace switching, empty-center recovery, empty-border cleanup, retained
  chart instances, stopped hidden rendering, and registered-widget round trips.
- The fixture worker test combines Footprint, Order Walls and Heatmap. Resize
  retains engine, candles, settled configuration and subscriptions; resize and
  collapse/expand produce zero additional worker fetches in this scenario.
- The broader workspace batch passed 22/23 initially. Its quota-denial test had
  a race between reading the saved value and enabling denied writes; those two
  fixture actions are now atomic, and the focused rerun passes.
- Typecheck and diagnostic build pass. There is no configured lint script.
  The design detector reports no findings; independent review requested updated
  acceptance notes and explicit active-target coverage, both now addressed.

Pi 5 Chromium headless SwiftShader measurement compares the same resize workload
in central panes and a border. The latest run measured central RAF p95 150 ms,
border p95 83.4 ms, idle p95 16.8 ms. It shows no regression in this bounded
comparison, but does not certify smooth foreground rendering. Raw evidence is in
`artifacts/workspace-borders-pi-timing.json`; hardware-rendered headless validation
is recorded separately. These are explicit fixtures, not live venue
history acceptance or a 60fps claim. No merge or deployment was performed.


### Hardware Pi result and tab-render optimization

`playwright.borders-pi.config.ts` runs headless Chromium using ANGLE GLES and
records the actual renderer: Broadcom V3D 7.1.7.0. After waiting for fixture data,
each scenario warms up and measures three identical 90-frame resize workloads.
Central p95 samples were 33.4, 33.4 and 50.1 ms; border samples were 50.0, 33.5 and
33.4 ms. Median p95 was therefore 33.4 ms centrally and 33.5 ms in a border.
The unchanged relative regression gate passes. These are headless hardware
measurements, not a foreground or live-feed 60fps claim.

The tab renderer now caches its displayed-content key rather than rebuilding
labels and venue images for every layout/resize event. Title, series, position,
market and timeframe changes still update the tab. Browser coverage checks
numbering, reorder/reload and retained tab DOM during resize; independent review
found no missing displayed field in the key.

Reproduce the hardware comparison after a diagnostics build:

```sh
VITE_DIAGNOSTICS=1 pnpm build
IQ_BORDER_TIMING_FILE=artifacts/workspace-borders-pi-gpu-timing.json pnpm exec playwright test --config playwright.borders-pi.config.ts
```

Raw pre-optimization and final hardware results are retained separately. The
final artifact contains all sample intervals/long tasks and the renderer name.

## Changed-file guide

- `src/workspaces/borders.ts`, `borders.css`: native edge adapter, menus, target
  feedback, cancellation, manual controls and empty-border cleanup. Existing
  border tab-strip drops retain native insertion indices, including reverse reorder.
- `src/workspaces/border-state.ts`, `src/layout.ts`: optional border validation.
- `src/workspaces/visibility.ts` and the five existing widget renderers:
  collapse-aware rendering lifecycle without replacing their data ownership.
- `src/main.ts`, `src/feed/restore-bootstrap.ts`: docking and workspace integration.
- `src/chart-tab.ts`: retain tab DOM on geometry-only layout events.
- `tests/workspace-border-*.test.ts`, `tests/workspace-visibility.test.ts`,
  `tests/browser/workspace-borders.spec.ts`, `playwright.borders-pi.config.ts`:
  deterministic, browser and Pi validation. The existing workspace quota test
  now captures its protected baseline atomically with enabling the quota fixture.
- `DESIGN.md`: compact border control and interaction conventions.

Final focused regression reruns pass for the quota fixture, compact tabs,
worker-instrumented expensive-chart lifecycle, active edge previews, and forward
and reverse pointer tab reorder. The final focused unit rerun remains 116/116.
